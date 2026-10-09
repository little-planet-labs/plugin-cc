// `pnpm analyze`        – analyze public/audio/track.(wav|mp3) into src/data/audio-analysis.json
// `pnpm analyze:reset`  – restore the checked-in no-track default analysis
//
// Decoding goes through ffmpeg (any format Suno exports; MP3 encoder delay is
// removed by ffmpeg's gapless handling), analysis through librosa in the
// project-local .venv (created by `pnpm setup:audio`).
import {copyFileSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CliError, run, runCli} from './lib/cli.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Analyze the project's track. All scratch files live in one temp dir that is
 * registered in `cleanup` as soon as it exists. The result is written next to
 * the target and renamed into place only on success, so a failure never leaves
 * a half-written audio-analysis.json.
 */
export const analyze = async (
  {
    root = projectRoot,
    tmpRoot = tmpdir(),
    ffmpegBin = 'ffmpeg',
    pythonBin = join(root, '.venv/bin/python'),
    reset = false,
  },
  cleanup,
) => {
  // Shared with the composition (src/MusicVideo.tsx).
  const pipeline = JSON.parse(readFileSync(join(root, 'src/pipeline.json'), 'utf8'));
  const outPath = join(root, 'src/data/audio-analysis.json');

  if (reset) {
    copyFileSync(join(root, 'src/data/audio-analysis.default.json'), outPath);
    console.log('analyze: restored default (no-track) analysis');
    return;
  }

  const found = pipeline.audioCandidates.filter((p) => existsSync(join(root, 'public', p)));
  if (found.length === 0) {
    throw new CliError(
      `no track found. Put the song at ${pipeline.audioCandidates.map((p) => `public/${p}`).join(' or ')} ` +
        '(or run `pnpm analyze:reset` to restore the no-track default).',
    );
  }
  if (found.length > 1) {
    throw new CliError(`${found.map((p) => `public/${p}`).join(' and ')} all exist; keep exactly one.`);
  }
  const source = found[0];
  if (!existsSync(pythonBin)) throw new CliError('Python venv missing. Run `pnpm setup:audio` first.');

  const tmp = mkdtempSync(join(tmpRoot, 'music-video-analyze-'));
  cleanup.add(() => rmSync(tmp, {recursive: true, force: true}));
  const wav = join(tmp, 'decoded.wav');
  const json = join(tmp, 'audio-analysis.json');

  await run(
    ffmpegBin,
    ['-v', 'error', '-y', '-i', join(root, 'public', source), '-map', '0:a:0', '-ac', '1', '-ar', '22050', '-c:a', 'pcm_s16le', wav],
    {label: 'ffmpeg'},
  );
  await run(
    pythonBin,
    [join(root, 'scripts/analyze_audio.py'), wav, '--source', source, '--fps', String(pipeline.fps), '--out', json],
    {label: 'analysis (python)'},
  );
  // Same filesystem is not guaranteed (tmpdir vs project), so copy then swap.
  const staged = `${outPath}.tmp-${process.pid}`;
  cleanup.add(() => rmSync(staged, {force: true}));
  copyFileSync(json, staged);
  renameSync(staged, outPath);
  console.log(`analyze: wrote ${outPath} from public/${source}`);
};

export const main = (argv, overrides = {}) =>
  runCli('analyze', (cleanup) => analyze({reset: argv.includes('--reset'), ...overrides}, cleanup));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
