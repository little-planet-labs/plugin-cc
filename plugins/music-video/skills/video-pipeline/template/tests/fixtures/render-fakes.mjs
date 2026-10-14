// Fakes for the fast render / pool tests: a fake "python" that plays both the
// page-info call (capture.py --info) and the chunk worker (render_chunk.py),
// and fake ffmpeg / ffprobe that pass frame counts around in tiny text files
// ("frames=N;size=WxH;audio=0|1"), so the whole render pipeline runs without
// Chromium or a real encoder. Every fake appends JSON lines to a shared log
// (one per event, small enough for O_APPEND writes to stay whole).
import {readFileSync} from 'node:fs';
import {fakeBin} from './cli-fakes.mjs';

/** Parse a fake media file. */
export const readFake = (file) => Object.fromEntries(readFileSync(file, 'utf8').split(';').map((kv) => kv.split('=')));

/** Read the shared log: one object per line. */
export const readLog = (log) => {
  try {
    return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
};

/** The largest number of [start, end] intervals that overlap at one instant. */
export const maxOverlap = (intervals) => {
  const events = intervals.flatMap(({start, end}) => [[start, 1], [end, -1]]);
  // At equal times count ends first: a worker that ended exactly when another started did not overlap it.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let live = 0;
  let max = 0;
  for (const [, d] of events) {
    live += d;
    max = Math.max(max, live);
  }
  return max;
};

/** Per worker run: {pid, from, to, start, end, code} from the log's start/end events. */
export const workerRuns = (log) => {
  const entries = readLog(log);
  const ends = new Map(entries.filter((e) => e.event === 'end').map((e) => [e.pid, e]));
  return entries.filter((e) => e.event === 'start').map((s) => ({...s, start: s.time, end: ends.get(s.pid)?.time ?? Infinity, code: ends.get(s.pid)?.code}));
};

/** How many times each chunk (by its first frame) was launched. */
export const launchesByChunk = (log) => {
  const counts = {};
  for (const r of workerRuns(log)) counts[r.from] = (counts[r.from] ?? 0) + 1;
  return counts;
};

/**
 * A fake python. `--info` logs {event: 'info', flags} and prints the page info ({fps, frames, cuts, blurWindows}); otherwise it is a chunk
 * worker: logs {event: 'start', pid, from, to, attempt, encoder}, sleeps `sleepMs`, writes the chunk named
 * at the end of --encoder, logs {event: 'end'} and exits. `behaviour` is a JS expression evaluated per
 * worker with `from` and `attempt` (1-based, counted from the log) in scope, giving
 * {code = 0, frames = to - from, write = true}: e.g. `from === 30 && attempt === 1 ? {code: 1} : {}`.
 * With `grandchildren`, the worker first starts a sleeping child in its own process group (like ffmpeg)
 * and a detached one in a new group that ignores SIGTERM (like Playwright's Chromium); each logs
 * {event: 'grandchild', pid, group: 'same' | 'own'} once it is set up. With `holdFile`, a worker finishes only
 * once that file exists (after `sleepMs`), so a test decides when the running workers may end.
 */
export const fakePython = ({log, frames, fps = 30, cuts = [], blurWindows = [], sleepMs = 200, behaviour = '{}', grandchildren = false, holdFile = null}) =>
  fakeBin(
    'python',
    `const {spawn} = require('node:child_process');
const now = () => performance.timeOrigin + performance.now();
const flags = args.slice(1);
const get = (n) => flags[flags.indexOf(n) + 1];
const log = ${JSON.stringify(log)};
const say = (o) => fs.appendFileSync(log, JSON.stringify({...o, pid: o.pid ?? process.pid, time: now()}) + '\\n');
if (flags.includes('--info')) {
  say({event: 'info', flags});
  process.stdout.write(JSON.stringify({info: {fps: ${fps}, frames: ${frames}, cuts: ${JSON.stringify(cuts)}, blurWindows: ${JSON.stringify(blurWindows)}, warnings: []}}) + '\\n');
  process.exit(0);
}
const from = Number(get('--from'));
const to = Number(get('--to'));
const encoder = JSON.parse(get('--encoder'));
const out = encoder[encoder.length - 1];
const size = encoder[encoder.indexOf('-s') + 1];
let attempt = 1;
try {
  attempt += fs.readFileSync(log, 'utf8').split('\\n').filter((l) => l.includes('"event":"start"') && l.includes('"from":' + from + ',')).length;
} catch {}
const b = Object.assign({code: 0, frames: to - from, write: true}, (${behaviour}));
say({event: 'start', from, to, attempt, encoder, flags});
if (${grandchildren}) {
  // Each grandchild logs itself once it is set up (the detached one after installing its SIGTERM handler).
  const ready = "require('node:fs').appendFileSync(process.argv[1], JSON.stringify({event: 'grandchild', pid: process.pid, group: process.argv[2]}) + '\\\\n'); setInterval(() => {}, 1000);";
  spawn(process.execPath, ['-e', ready, log, 'same'], {stdio: 'ignore'});
  spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); " + ready, log, 'own'], {stdio: 'ignore', detached: true});
}
const finish = () => {
  if (b.write) fs.writeFileSync(out, 'frames=' + b.frames + ';size=' + size + ';audio=0');
  say({event: 'end', code: b.code});
  process.exit(b.code);
};
const hold = ${JSON.stringify(holdFile)};
setTimeout(() => {
  if (hold === null) return finish();
  const t = setInterval(() => {
    if (fs.existsSync(hold)) {
      clearInterval(t);
      finish();
    }
  }, 10);
}, ${sleepMs});`,
  );

/**
 * A fake ffmpeg for concat, mux, preview and contact-sheet calls (its output is its last argument):
 * concat sums the listed chunks' frames (logging {event: 'concat', files: [{file, frames}]}); the mux copies
 * the video's frames and size and records whether an audio input was given (logging {event: 'mux', args}).
 * `failOn` ('concat' | 'mux' | null) makes that step exit 1 after writing a partial file; `concatShort` makes
 * the concat drop one frame (and still exit 0).
 */
export const fakeFfmpeg = ({log, failOn = null, concatShort = false}) =>
  fakeBin(
    'ffmpeg',
    `const log = ${JSON.stringify(log)};
const say = (o) => fs.appendFileSync(log, JSON.stringify(o) + '\\n');
const read = (f) => Object.fromEntries(fs.readFileSync(f, 'utf8').split(';').map((kv) => kv.split('=')));
const out = args[args.length - 1];
const inputs = args.flatMap((a, i) => (a === '-i' ? [args[i + 1]] : []));
if (args.includes('concat')) {
  const files = fs.readFileSync(inputs[0], 'utf8').trim().split('\\n').map((l) => l.replace(/^file '(.*)'$/, '$1').replaceAll("'\\\\''", "'"));
  const listed = files.map((f) => ({file: f, frames: Number(read(f).frames)}));
  say({event: 'concat', files: listed});
  fs.writeFileSync(out, 'frames=' + (listed.reduce((s, x) => s + x.frames, 0) - (${concatShort} ? 1 : 0)) + ';size=' + read(files[0]).size + ';audio=0');
  process.exit(${JSON.stringify(failOn)} === 'concat' ? 1 : 0);
}
const v = read(inputs[0]);
say({event: 'mux', args});
fs.writeFileSync(out, 'frames=' + v.frames + ';size=' + v.size + ';audio=' + (inputs.length > 1 ? 1 : 0));
process.exit(${JSON.stringify(failOn)} === 'mux' ? 1 : 0);`,
  );

/** A fake ffprobe reading the fake media files: -count_frames csv (countFrames) or the JSON stream list (probeVideo). */
export const fakeFfprobe = ({fps = 30} = {}) =>
  fakeBin(
    'ffprobe',
    `const file = args[args.length - 1];
let m;
try {
  m = Object.fromEntries(fs.readFileSync(file, 'utf8').split(';').map((kv) => kv.split('=')));
} catch {
  process.stderr.write(file + ': No such file\\n');
  process.exit(1);
}
if (args.includes('csv=p=0')) {
  process.stdout.write(m.frames + '\\n');
  process.exit(0);
}
const [w, h] = m.size.split('x').map(Number);
const streams = [{codec_type: 'video', width: w, height: h, r_frame_rate: '${fps}/1', avg_frame_rate: '${fps}/1', nb_frames: m.frames, nb_read_frames: m.frames, start_time: '0.000000'}];
if (m.audio === '1') streams.push({codec_type: 'audio'});
process.stdout.write(JSON.stringify({streams}));`,
  );
