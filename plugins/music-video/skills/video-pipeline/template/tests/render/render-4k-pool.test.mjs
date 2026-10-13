// The DPR path and the pool cap for real: a 2 s chunked render at scale 2
// (3840x2160 from a 1920x1080 page) with pool 2 and 4 chunks, sampled with
// `ps` every ~0.5 s. Peak chunk workers, ffmpeg encoders and Chromium browser
// processes (each tracked by pid from first sighting, whatever its parent
// later) stay at or under 2 (and the workers do reach 2), the output is
// 3840x2160, and every frame decodes to its time code.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {setInterval, clearInterval} from 'node:timers';
import {FAMILY_ENV} from '../../scripts/lib/cli.mjs';
import {PROJECT_ROOT} from '../../scripts/lib/env.mjs';
import {main as renderMain} from '../../scripts/render.mjs';
import {quiet} from '../fixtures/cli-fakes.mjs';
import {captureEnvMissing, makeProject} from '../fixtures/engine-project.mjs';
import {frameProbe, probeTimeline} from '../fixtures/render-real.mjs';

const missing = captureEnvMissing();

/**
 * A census of this render's processes, sampled with `ps -A -ww -E`. Each chunk worker carries its spawnGroup
 * family token (FAMILY_ENV) in its environment, and everything it starts inherits it. A Chromium main
 * process (no --type= switch) and an ffmpeg encoder are recorded by pid at first sighting, found by family
 * token or under a worker, and counted in every later sample while alive and not a zombie, whatever their
 * parent is by then (a process whose parent died is re-parented to launchd).
 */
const makeCensus = (root) => {
  const tokens = new Set();
  const browsers = new Set();
  const encoders = new Set();
  const mark = new RegExp(`(?:^|\\s)${FAMILY_ENV}=(\\S+)`);
  return () => {
    const rows = execFileSync('ps', ['-A', '-ww', '-E', '-o', 'pid=,ppid=,state=,command='], {encoding: 'utf8', maxBuffer: 1 << 28})
      .split('\n')
      .map((l) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(l))
      .filter(Boolean)
      .map(([, pid, ppid, state, command]) => ({pid: Number(pid), ppid: Number(ppid), zombie: state.startsWith('Z'), command, token: mark.exec(command)?.[1]}));
    const byPid = new Map(rows.map((r) => [r.pid, r]));
    const workers = rows.filter((r) => !r.zombie && r.command.includes('render_chunk.py') && r.command.includes(`--root ${root}`));
    for (const w of workers) if (w.token) tokens.add(w.token);
    const workerPids = new Set(workers.map((w) => w.pid));
    const ours = (r) => {
      if (r.token && tokens.has(r.token)) return true;
      for (let p = r.ppid, hops = 0; p > 1 && hops < 20; p = byPid.get(p)?.ppid ?? 0, hops++) if (workerPids.has(p)) return true;
      return false;
    };
    for (const r of rows) {
      if (r.zombie || !ours(r)) continue;
      const exe = r.command.split(' ')[0];
      if (/chrome-headless-shell$|headless_shell$/.test(exe) && !/\s--type=/.test(r.command)) browsers.add(r.pid);
      if (/(^|\/)ffmpeg$/.test(exe) && r.command.includes('rawvideo')) encoders.add(r.pid);
    }
    const alive = (set) => [...set].filter((pid) => byPid.has(pid) && !byPid.get(pid).zombie);
    const show = (pid) => `${pid}<${byPid.get(pid).ppid} ${byPid.get(pid).command.split(' ')[0].split('/').pop()}`;
    return {
      workers: workers.length,
      encoders: alive(encoders).length,
      browsers: alive(browsers).length,
      seen: [...workers.map((r) => r.pid), ...alive(encoders), ...alive(browsers)].map(show),
      tracked: {browsers: browsers.size, encoders: encoders.size},
    };
  };
};

describe('4K chunked render under the pool cap', {skip: missing ?? false}, () => {
  let proj;
  before(() => {
    proj = makeProject({
      pipeline: {width: 1920, height: 1080, fallbackSeconds: 2, render: {scale: 2, chunkSeconds: 0.5, pool: 2}},
      sections: [{id: 's1', scene: 'timecode', start: 0}],
    });
  });
  after(() => proj?.cleanup());

  it('peak workers, encoders and Chromium browsers stay <= 2 (workers reach 2); the output is 3840x2160 and frame-exact', {timeout: 600_000}, async () => {
    const out = join(proj.root, 'out/4k.mp4');
    const peak = {workers: 0, encoders: 0, browsers: 0};
    let busiest = null;
    let last = null;
    const census = makeCensus(proj.root);
    const samples = [];
    const sample = () => {
      const c = census();
      last = c;
      samples.push(c);
      for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], c[k]);
      if (!busiest || c.browsers + c.encoders + c.workers > busiest.browsers + busiest.encoders + busiest.workers) busiest = c;
    };
    const timer = setInterval(sample, 500);
    let result;
    let output;
    try {
      ({result, output} = await quiet(() =>
        renderMain(['--scenes=tests/fixtures/scenes/timecode.js', '--out', out, '--pool=2'], {root: proj.root, envRoot: PROJECT_ROOT}),
      ));
    } finally {
      clearInterval(timer);
    }
    assert.equal(result, 0, output.join('\n'));
    assert.ok(output.some((l) => /3840x2160, 4 chunk\(s\), pool 2/.test(l)), output.join('\n'));
    console.log(`4K census: ${samples.length} samples, peak ${JSON.stringify(peak)}; ${output.filter((l) => /wrote/.test(l)).join(' ')}`);
    assert.ok(samples.length >= 4, 'the sampler ran during the render');
    assert.deepEqual(last.tracked, {browsers: 4, encoders: 4}, 'one Chromium and one encoder recorded per chunk (4 chunks)');
    assert.ok(peak.workers <= 2, `peak workers ${peak.workers}`);
    assert.ok(peak.encoders <= 2, `peak encoders ${peak.encoders}`);
    assert.ok(peak.browsers <= 2, `peak Chromium browsers ${peak.browsers}; busiest sample: ${busiest?.seen.join(' | ')}`);
    assert.equal(peak.workers, 2, 'the pool reached its cap');
    const {stream} = probeTimeline(out);
    assert.deepEqual([stream.width, stream.height, Number(stream.nb_frames)], [3840, 2160, 60]);
    const {codes} = frameProbe('timecodes', out);
    assert.deepEqual(codes, codes.map((_, n) => 4 * n));
  });
});
