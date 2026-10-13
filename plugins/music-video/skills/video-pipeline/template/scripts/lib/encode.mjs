// ffmpeg / x264 arguments and ffprobe checks shared by render, draft and
// preview. Every video the scripts write is H.264 High, yuv420p, BT.709 TV
// range with the colour tags, at the lowest H.264 level whose limits fit its
// size and frame rate, and constant frame rate at pipeline fps.
import {capture, CliError} from './cli.mjs';

/**
 * H.264 levels (ITU-T H.264 Table A-1): max macroblocks per second, max frame
 * size in macroblocks, and max bitrate / CPB size in units of 1000 bits for
 * the Baseline/Main profiles (High allows 1.25x, Table A-2 cpbBrVclFactor).
 * Level 1b is left out (never the lowest fit for a frame larger than 1).
 */
export const H264_LEVELS = Object.freeze([
  {level: '1', maxMBPS: 1485, maxFS: 99, maxBR: 64, maxCPB: 175},
  {level: '1.1', maxMBPS: 3000, maxFS: 396, maxBR: 192, maxCPB: 500},
  {level: '1.2', maxMBPS: 6000, maxFS: 396, maxBR: 384, maxCPB: 1000},
  {level: '1.3', maxMBPS: 11880, maxFS: 396, maxBR: 768, maxCPB: 2000},
  {level: '2', maxMBPS: 11880, maxFS: 396, maxBR: 2000, maxCPB: 2000},
  {level: '2.1', maxMBPS: 19800, maxFS: 792, maxBR: 4000, maxCPB: 4000},
  {level: '2.2', maxMBPS: 20250, maxFS: 1620, maxBR: 4000, maxCPB: 4000},
  {level: '3', maxMBPS: 40500, maxFS: 1620, maxBR: 10000, maxCPB: 10000},
  {level: '3.1', maxMBPS: 108000, maxFS: 3600, maxBR: 14000, maxCPB: 14000},
  {level: '3.2', maxMBPS: 216000, maxFS: 5120, maxBR: 20000, maxCPB: 20000},
  {level: '4', maxMBPS: 245760, maxFS: 8192, maxBR: 20000, maxCPB: 25000},
  {level: '4.1', maxMBPS: 245760, maxFS: 8192, maxBR: 50000, maxCPB: 62500},
  {level: '4.2', maxMBPS: 522240, maxFS: 8704, maxBR: 50000, maxCPB: 62500},
  {level: '5', maxMBPS: 589824, maxFS: 22080, maxBR: 135000, maxCPB: 135000},
  {level: '5.1', maxMBPS: 983040, maxFS: 36864, maxBR: 240000, maxCPB: 240000},
  {level: '5.2', maxMBPS: 2073600, maxFS: 36864, maxBR: 240000, maxCPB: 240000},
  {level: '6', maxMBPS: 4177920, maxFS: 139264, maxBR: 240000, maxCPB: 240000},
  {level: '6.1', maxMBPS: 8355840, maxFS: 139264, maxBR: 480000, maxCPB: 480000},
  {level: '6.2', maxMBPS: 16711680, maxFS: 139264, maxBR: 800000, maxCPB: 800000},
]);

/** High-profile bitrate factor over the table's Baseline/Main limits (Table A-2). */
export const HIGH_BR_FACTOR = 1.25;

/**
 * The least High-profile max bitrate (kbit/s) a master's level must allow.
 * The lowest level that fits 1080p30 by size and macroblock rate is 4.0,
 * whose 25 Mbit/s cap trims CRF 17 in grainy passages (measured about 27
 * Mbit/s over 5 s of the reference song with the placeholder scenes). 4.1 has
 * the same size limits and allows 62.5 Mbit/s, so masters take the lowest
 * level that fits AND allows at least this; the VBV stays capped at that
 * level's limits, so the label stays valid. 2160p30 (5.1, 300 Mbit/s) is
 * unchanged. Drafts and previews keep the plain lowest fit.
 */
export const MASTER_MIN_HIGH_BR_KBPS = 50_000;

/**
 * The lowest H.264 level whose frame size (in 16x16 macroblocks, also per
 * dimension: at most sqrt(8 * MaxFS) macroblocks wide or high) and
 * macroblock rate fit width x height at fps, and whose High-profile max
 * bitrate is at least `minHighBRKbps` (0: no floor; masters pass
 * MASTER_MIN_HIGH_BR_KBPS).
 * @param {number} width
 * @param {number} height
 * @param {number} fps
 * @param {{minHighBRKbps?: number}} [o]
 * @returns {(typeof H264_LEVELS)[number]}
 */
export const h264Level = (width, height, fps, {minHighBRKbps = 0} = {}) => {
  const mbW = Math.ceil(width / 16);
  const mbH = Math.ceil(height / 16);
  const fs = mbW * mbH;
  const mbps = fs * fps;
  const fit = H264_LEVELS.find(
    (l) => fs <= l.maxFS && mbps <= l.maxMBPS && Math.max(mbW, mbH) <= Math.sqrt(8 * l.maxFS) && l.maxBR * HIGH_BR_FACTOR >= minHighBRKbps,
  );
  if (!fit) throw new CliError(`${width}x${height} at ${fps} fps is beyond every H.264 level`);
  return fit;
};

/**
 * Frame properties that tag a stream BT.709 TV range. ffmpeg 8 takes the
 * stream's colour description from the frames, not from the -color_* output
 * options: without this, frames from rawvideo (or anything else with
 * unspecified primaries and transfer) come out tagged color_primaries and
 * color_trc "unknown" even with -color_primaries bt709 -color_trc bt709
 * (measured with ffmpeg 8.1.2).
 */
export const BT709_FRAME_TAGS = 'setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709';

/** RGB (full range) to BT.709 TV-range yuv420p, tagged. */
export const RGB_TO_BT709_TV = `scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p,${BT709_FRAME_TAGS}`;

/** The colour tags written on every video stream. */
export const BT709_TAGS = Object.freeze(['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709']);

/**
 * libx264 output arguments: High profile at the level for the output size,
 * yuv420p, the BT.709 tags, a GOP of 2 s (the first frame of every encode is
 * an IDR), and either CRF or an average bitrate. The VBV is capped at the
 * level's High-profile max bitrate and CPB so the stream stays within the
 * level it is labelled with. `master` applies MASTER_MIN_HIGH_BR_KBPS to the level.
 * @param {{width: number, height: number, fps: number, preset: string, crf?: number, bitrateKbps?: number, master?: boolean}} o
 * @returns {string[]}
 */
export const x264Args = ({width, height, fps, preset, crf, bitrateKbps, master = false}) => {
  const lvl = h264Level(width, height, fps, {minHighBRKbps: master ? MASTER_MIN_HIGH_BR_KBPS : 0});
  const rate = bitrateKbps === undefined ? ['-crf', String(crf)] : ['-b:v', `${bitrateKbps}k`];
  if (bitrateKbps === undefined && crf === undefined) throw new CliError('x264Args needs crf or bitrateKbps');
  return [
    '-c:v', 'libx264',
    '-preset', preset,
    ...rate,
    '-maxrate', `${Math.round(lvl.maxBR * HIGH_BR_FACTOR)}k`,
    '-bufsize', `${Math.round(lvl.maxCPB * HIGH_BR_FACTOR)}k`,
    '-profile:v', 'high',
    '-level:v', lvl.level,
    '-pix_fmt', 'yuv420p',
    '-g', String(2 * fps),
    ...BT709_TAGS,
  ];
};

/**
 * The full ffmpeg argv (without the binary) a chunk worker runs: rgb24 frames
 * of width x height on stdin at fps, to `out` (an .mp4 with a timescale of fps,
 * so every timestamp is an exact frame). `master`: a master render's level floor (x264Args).
 * @param {{width: number, height: number, fps: number, preset: string, crf: number, out: string, master?: boolean}} o
 * @returns {string[]}
 */
export const chunkEncoderArgs = ({width, height, fps, preset, crf, out, master = false}) => [
  '-v', 'error', '-y',
  '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-framerate', String(fps), '-i', '-',
  '-an',
  '-vf', RGB_TO_BT709_TV,
  ...x264Args({width, height, fps, preset, crf, master}),
  '-video_track_timescale', String(fps),
  out,
];

/** A concat-demuxer list for `files` (absolute paths), quoting each for the demuxer. */
export const concatList = (files) => files.map((f) => `file '${f.replaceAll("'", "'\\''")}'\n`).join('');

/**
 * Concatenate verified chunks (stream copy) into `out`, video only.
 * @param {string} listFile
 * @param {number} fps
 * @param {string} out
 */
export const concatArgs = (listFile, fps, out) => [
  '-v', 'error', '-y',
  '-f', 'concat', '-safe', '0', '-i', listFile,
  '-map', '0:v:0', '-c', 'copy',
  '-video_track_timescale', String(fps),
  out,
];

/**
 * The final mux: the concatenated video (stream copy) and the source audio
 * encoded by ffmpeg's native AAC encoder straight into the MP4 (its edit list
 * carries the encoder priming, so audio starts at t = 0 sample-exactly). The
 * audio is always the span of the source the video covers, [startSeconds,
 * startSeconds + durationSeconds) with durationSeconds = frames / fps, cut on
 * the input side, so it never runs past the video (on an analysed track a
 * full render trims nothing: frames = ceil(duration * fps)). No -shortest, no
 * filters on the audio.
 * @param {{video: string, audio: string | null, audioBitrate: string, fps: number, out: string,
 *   startSeconds?: number, durationSeconds?: number}} o durationSeconds: required with audio (a silent mux has nothing to cut).
 */
export const muxArgs = ({video, audio, audioBitrate, fps, out, startSeconds = 0, durationSeconds}) => {
  if (audio !== null && !(Number.isFinite(durationSeconds) && durationSeconds > 0)) {
    throw new CliError(`muxArgs needs the video's duration to cut the audio (got ${durationSeconds})`);
  }
  const audioIn = audio === null ? [] : [
    ...(startSeconds > 0 ? ['-ss', startSeconds.toFixed(6)] : []),
    '-t', durationSeconds.toFixed(6),
    '-i', audio,
  ];
  const audioOut = audio === null ? [] : ['-map', '1:a:0', '-c:a', 'aac', '-b:a', audioBitrate];
  return [
    '-v', 'error', '-y',
    '-i', video,
    ...audioIn,
    '-map', '0:v:0', '-c:v', 'copy',
    ...audioOut,
    '-video_track_timescale', String(fps),
    '-movflags', '+faststart',
    out,
  ];
};

/**
 * Decoded frame count of the first video stream (ffprobe -count_frames), or
 * -1 when ffprobe can't read the file (a truncated chunk).
 * @param {string} ffprobeBin
 * @param {string} file
 */
export const countFrames = async (ffprobeBin, file) => {
  let out;
  try {
    out = await capture(ffprobeBin, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], {
      label: 'ffprobe',
    });
  } catch (err) {
    if (/interrupted/.test(err.message)) throw err;
    return -1;
  }
  const n = Number.parseInt(out.trim(), 10);
  return Number.isInteger(n) ? n : -1;
};

/**
 * Streams of a finished video: width, height, frame rates, frame counts
 * (decoded and container), and whether it has audio.
 * @param {string} ffprobeBin
 * @param {string} file
 */
export const probeVideo = async (ffprobeBin, file) => {
  const out = await capture(
    ffprobeBin,
    ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,avg_frame_rate,nb_frames,nb_read_frames,start_time', '-of', 'json', file],
    {label: 'ffprobe'},
  );
  let streams;
  try {
    ({streams} = JSON.parse(out));
  } catch {
    throw new CliError(`ffprobe gave no stream list for ${file}`);
  }
  const v = streams.find((s) => s.codec_type === 'video');
  if (!v) throw new CliError(`${file} has no video stream`);
  return {
    width: v.width,
    height: v.height,
    rFrameRate: v.r_frame_rate,
    avgFrameRate: v.avg_frame_rate,
    frames: Number.parseInt(v.nb_read_frames, 10),
    containerFrames: Number.parseInt(v.nb_frames, 10),
    startTime: Number.parseFloat(v.start_time),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  };
};

/** Duration of a media file in seconds, from ffprobe. */
export const probeDuration = async (ffprobeBin, file) => {
  const out = await capture(ffprobeBin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], {
    label: 'ffprobe',
  });
  const seconds = Number.parseFloat(out.trim());
  if (!Number.isFinite(seconds)) throw new CliError(`ffprobe gave no duration for ${file}`);
  return seconds;
};
