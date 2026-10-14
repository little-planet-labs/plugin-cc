// The engine: boot (data, timing, fonts, theme, scenes, lyrics, transitions,
// cuts, blur windows) and seek(t), which draws the whole page as a pure
// function of t. No clock runs here: no Date, no timers, no
// requestAnimationFrame (the preview HUD in ./preview.js is the only clock).
// The seek(t) method itself comes from the howseen-ai/claude-motion-design
// engine (MIT, see NOTICE.md).
import {parseAudioAnalysis, parseTimingOverrides} from '../lib/analysis.js';
import {parseBrand, toPageUrl} from '../lib/brand.js';
import {parseLyrics} from '../lib/lyrics.js';
import {checkAlternatePipeline, DEFAULT_PIPELINE_PATH, parsePipeline, scenesInEffect} from '../lib/pipeline.js';
import {resolveProject} from '../lib/project.js';
import {resolveScene, validateRegistry} from '../lib/registry.js';
import {parseSections} from '../lib/sections.js';
import {snapToFrame, subframeTimes, validateBlurWindows} from '../lib/subframes.js';
import {normalizeTransition, transitionFrame} from '../lib/transitions.js';
import {makeContext} from './context.js';
import {fontWarnings, loadFonts} from './fonts.js';
import {FxLayer} from './fx.js';
import {initLayers, layers, makeEl, setStyle} from './layers.js';
import {LyricLayer} from './text.js';
import {ENTER_LEAD_FRAMES} from '../lib/exits.js';
import {revealFrameOpacity} from '../lib/text-motion.js';
import {buildTheme} from './theme.js';

const fetchJson = async (path) => {
  let res;
  try {
    res = await fetch(path, {cache: 'no-store'});
  } catch (err) {
    throw new Error(`${path} could not be loaded (${err.message})`);
  }
  if (!res.ok) throw new Error(`${path} could not be loaded (HTTP ${res.status})`);
  try {
    return await res.json();
  } catch (err) {
    throw new Error(`${path} is not valid JSON (${err.message})`);
  }
};

const exists = async (path) => {
  try {
    return (await fetch(path, {method: 'HEAD', cache: 'no-store'})).ok;
  } catch {
    return false;
  }
};

/** parsePipeline, with errors naming `path` (the parser's own messages say "pipeline.json"). */
const parsePipelineAt = (raw, path) => {
  try {
    return parsePipeline(raw);
  } catch (err) {
    throw path === DEFAULT_PIPELINE_PATH ? err : new Error(err.message.replace(/^pipeline\.json:/, `${path}:`));
  }
};

/**
 * Every data file, parsed, plus the timing in effect. `pipelinePath` (validated by main.js) is the config:
 * src/pipeline.json, or an alternate one, which is checked against src/pipeline.json (same fps, own outputName).
 */
const loadProject = async (pipelinePath) => {
  const alternate = pipelinePath !== DEFAULT_PIPELINE_PATH;
  const [pipelineRaw, brandRaw, analysisRaw, defaultRaw, overridesRaw, lyricsRaw, sectionsRaw, baseRaw] = await Promise.all(
    [
      pipelinePath,
      'src/brand.json',
      'src/data/audio-analysis.json',
      'src/data/audio-analysis.default.json',
      'src/data/timing-overrides.json',
      'src/data/lyrics.json',
      'src/data/sections.json',
      ...(alternate ? [DEFAULT_PIPELINE_PATH] : []),
    ].map(fetchJson),
  );
  const pipeline = parsePipelineAt(pipelineRaw, pipelinePath);
  if (alternate) checkAlternatePipeline(pipeline, parsePipeline(baseRaw), pipelinePath);
  const brand = parseBrand(brandRaw);
  const present = [];
  await Promise.all(
    pipeline.audioCandidates.map(async (p) => {
      if (await exists(toPageUrl(`public/${p}`))) present.push(p);
    }),
  );
  const project = resolveProject({
    pipeline,
    analysis: parseAudioAnalysis(analysisRaw),
    defaultAnalysis: parseAudioAnalysis(defaultRaw),
    overrides: parseTimingOverrides(overridesRaw),
    lyrics: parseLyrics(lyricsRaw),
    sections: parseSections(sectionsRaw),
    present: pipeline.audioCandidates.filter((p) => present.includes(p)),
  });
  return {pipeline, brand, project};
};

/**
 * @param {{render: boolean, textonly: boolean, pipelinePath: string, scenesPath: string | null, toUrl: (path: string) => string}} mode
 *   scenesPath null: the config's `scenes`, else src/scenes/index.js. toUrl turns a project path into the URL to import.
 */
export const createEngine = (mode) => {
  let ready = false;
  /** @type {any} */
  let P = null;
  let shutter = 0.5;
  /** @type {any[]} */
  let instances = [];
  /** @type {LyricLayer} */
  let lyricLayer;
  /** @type {FxLayer} */
  let fx;
  const cutList = [];
  const blurList = [];
  const warnings = [];
  let inSetup = false;
  let cutsSorted = [];
  let blurSorted = [];

  const seek = async (tIn) => {
    if (!ready) throw new Error('seek() called before the page is ready');
    const t = Math.min(Math.max(Number(tIn) || 0, 0), P.duration);
    fx.reset();
    for (const inst of instances) {
      const active = t >= inst.win.start && t < inst.win.end;
      if (!active) {
        if (inst.on !== false) {
          inst.root.style.display = 'none';
          for (const c of inst.canvases) c.release();
          inst.on = false;
        }
        if (inst.ring) setStyle(inst.ring, 'display', 'none');
        if (inst.blade) setStyle(inst.blade, 'display', 'none');
        continue;
      }
      if (inst.on !== true) {
        inst.root.style.display = 'block';
        inst.on = true;
      }
      applyRoot(inst, t);
      try {
        inst.def.draw(t, inst.ctx);
      } catch (err) {
        throw new Error(`scene "${inst.section.scene}" (section "${inst.section.id}") failed to draw at ${t}s: ${err.message}`);
      }
    }
    lyricLayer.draw(t);
    fx.draw(t);
  };

  /** The section root's clip / opacity / transform / filter from its own and the next section's transitions. */
  const applyRoot = (inst, t) => {
    const page = {width: P.width, height: P.height};
    const own = inst.transition ? transitionFrame(inst.transition, t, page) : null;
    const next = instances[inst.index + 1]?.transition;
    const out = next && t >= next.at && t < next.end ? transitionFrame(next, t, page).outgoing : null;
    const inc = own?.incoming;
    const join = (a, b) => [a, b].filter(Boolean).join(' ');
    const opacity = [inc?.opacity, out?.opacity].filter(Boolean).reduce((acc, v) => acc * Number(v), 1);
    setStyle(inst.root, 'clipPath', inc?.clipPath ?? '');
    setStyle(inst.root, 'opacity', opacity === 1 ? '' : String(Number(opacity.toFixed(4))));
    setStyle(inst.root, 'transform', join(out?.transform, inc?.transform));
    setStyle(inst.root, 'filter', join(out?.filter, inc?.filter));
    if (inst.ring) {
      setStyle(inst.ring, 'display', own?.ring ? 'block' : 'none');
      if (own?.ring) {
        setStyle(inst.ring, 'clipPath', own.ring.clipPath);
        setStyle(inst.ring, 'background', own.ring.background);
      }
    }
    if (inst.blade) {
      const b = own?.blade;
      setStyle(inst.blade, 'display', b ? 'block' : 'none');
      if (b) {
        setStyle(inst.blade, 'left', `${b.left.toFixed(2)}px`);
        setStyle(inst.blade, 'top', `${b.top.toFixed(2)}px`);
        setStyle(inst.blade, 'width', `${b.width}px`);
        setStyle(inst.blade, 'height', `${b.height}px`);
        setStyle(inst.blade, 'background', b.background);
      }
    }
  };

  /** Fill transition defaults, validate timing, create ring / blade elements, register their cuts and blur windows. */
  const finalizeTransitions = () => {
    const {fps} = P;
    instances.forEach((inst, i) => {
      if (!inst.transition) {
        // A section that starts with no incoming transition starts with a hard cut.
        if (i > 0) cutList.push({t: inst.section.from / fps, label: `start of section "${inst.section.id}", which has no incoming transition`});
        return;
      }
      const where = `section "${inst.section.id}" transition`;
      const s = normalizeTransition(inst.transition, where);
      const start = inst.section.from / fps;
      const at = s.at === undefined ? start - s.dur : snapToFrame(s.at, fps);
      const end = s.at === undefined ? start : at + s.dur;
      const prev = instances[i - 1];
      if (prev && at < prev.section.from / fps) {
        throw new Error(`${where} starts at ${at.toFixed(3)}s, before the previous section "${prev.section.id}" starts; shorten it`);
      }
      inst.transition = {...s, at, end};
      const {world} = layers();
      const z = Number(inst.root.style.zIndex);
      if (s.kind === 'circle' && s.ring) {
        inst.ring = makeEl(world, 'div', {z: z - 1, style: `inset:0;width:${P.width}px;height:${P.height}px;display:none`});
      }
      if (s.kind === 'wipe' && s.edge) inst.blade = makeEl(world, 'div', {z: z + 1, style: 'display:none'});
      if (s.kind === 'cut') cutList.push({t: snapToFrame(at, fps), label: where});
      if (s.blur !== undefined) {
        const a = Math.floor(at * fps + 1e-6) / fps;
        let b = Math.ceil(end * fps - 1e-6) / fps;
        if (b <= a) b = a + 1 / fps;
        blurList.push({a: Math.max(0, a), b, samples: s.blur, label: where});
      }
    });
  };

  /** Each section draws from its start (or its transition start, or start - pre) until the next section's transition is over (or end + post). */
  const computeWindows = () => {
    const {fps} = P;
    instances.forEach((inst, i) => {
      const start = inst.section.from / fps;
      const end = inst.section.to / fps;
      let a = start - (inst.def.pre ?? 0);
      if (inst.transition) a = Math.min(a, inst.transition.at);
      let b = end + (inst.def.post ?? 0);
      const next = instances[i + 1];
      if (next?.transition && next.transition.kind !== 'cut') {
        b = Math.max(b, next.transition.contractTo ? next.transition.contractTo.at + next.transition.contractTo.dur : next.transition.end);
      }
      if (i === instances.length - 1) b = Infinity;
      inst.win = {start: a, end: b};
    });
  };

  const boot = async (initialT) => {
    const data = await loadProject(mode.pipelinePath);
    P = data.project;
    shutter = data.pipeline.render.shutter;
    warnings.push(...P.warnings);
    const {brand} = data;
    initLayers({width: P.width, height: P.height, textonly: mode.textonly, background: brand.colors.background});
    await loadFonts(brand);
    warnings.push(...fontWarnings(brand));
    const theme = buildTheme(brand, {width: P.width, height: P.height});
    const L = layers();
    fx = new FxLayer(L, P.fps, theme.colors.flash);
    // Lyrics are bound to the audio: a line is gone by the end of the audio, not the end of a tail (pipeline.json tailSeconds).
    lyricLayer = new LyricLayer({txt: L.txt, lines: P.lyrics, theme, page: {width: P.width, height: P.height}, fps: P.fps, duration: P.audioEnd});

    const scenesPath = scenesInEffect(data.pipeline, mode.scenesPath);
    let mod;
    try {
      mod = await import(mode.toUrl(scenesPath));
    } catch (err) {
      throw new Error(`scene registry ${scenesPath} failed to load: ${err.message}`);
    }
    const registry = validateRegistry(mod, scenesPath);
    const pending = [];
    const host = {
      project: P,
      theme,
      brand,
      mode,
      lyrics: lyricLayer,
      fx,
      addCut: (t, label) => cutList.push({t, label}),
      addBlur: (w) => blurList.push(w),
      addPending: (p) => pending.push(p),
      warn: (msg) => warnings.push(msg),
      inSetup: () => inSetup,
    };
    instances = P.sections.map((section, index) => {
      const def = resolveScene(registry, section.scene, section.id);
      const root = makeEl(L.world, 'div', {
        className: 'scene',
        z: 3 * (index + 1),
        // transform-origin 0 0: transition transforms carry their own pivot (src/lib/transitions.js).
        style: `inset:0;width:${P.width}px;height:${P.height}px;overflow:hidden;display:none;transform-origin:0px 0px`,
      });
      root.dataset.section = section.id;
      const inst = {index, def, section, root, canvases: [], transition: null, ring: null, blade: null, on: null, win: null, ctx: null};
      inst.ctx = makeContext({section, index, root, host, inst});
      if (def.cut) cutList.push({t: section.from / P.fps, label: `scene "${section.scene}" (section "${section.id}")`});
      return inst;
    });

    inSetup = true;
    for (const inst of instances) {
      try {
        await inst.def.setup?.(inst.ctx);
      } catch (err) {
        throw new Error(`scene "${inst.section.scene}" (section "${inst.section.id}") setup failed: ${err.message}`);
      }
    }
    inSetup = false;
    await Promise.all(pending);

    warnings.push(...lyricLayer.finalize({render: mode.render}));
    // A word is on screen on its reveal frame unless its line must be gone by then (src/lib/exits.js).
    const unseen = (w) => w.exitEnd <= w.reveal + 1e-7;
    for (const s of lyricLayer.sched.values()) {
      if (s.words.every(unseen)) {
        warnings.push(
          `lyric "${s.id}" can never be shown: it must be gone (${s.exitEnd.toFixed(3)}s) before its first word (${s.first.toFixed(3)}s); ` +
            'check its exitBy, or the next line starts within 2 frames of it',
        );
        continue;
      }
      const style = lyricLayer.reg.options().get(s.id) ?? {};
      s.words.forEach((w, k) => {
        // On screen for a single frame at an opacity that rounds to 0 in 8 bits: it won't show either.
        const oneFrame = w.exitEnd - w.reveal <= 1 / P.fps + 1e-7;
        if (!unseen(w) && oneFrame && w.reveal < w.settled && revealFrameOpacity(style, w.sung, ENTER_LEAD_FRAMES / P.fps) < 0.5 / 255) {
          warnings.push(
            `lyric "${s.id}" word ${k + 1} "${w.text}" is on screen for one frame at almost zero opacity ` +
              `(enter "${style.enter ?? 'rise'}", enterEase "${typeof style.enterEase === 'string' ? style.enterEase : style.enterEase ? 'custom' : 'o5'}"); ` +
              'use a faster easing or a later exit',
          );
        }
        if (unseen(w)) {
          warnings.push(
            `lyric "${s.id}" word ${k + 1} "${w.text}" can never be shown: the line must be gone (${w.exitEnd.toFixed(3)}s) by its reveal ` +
              `(${w.reveal.toFixed(3)}s); check its exitBy, or the next line starts within 2 frames of it`,
          );
        }
      });
    }
    finalizeTransitions();
    computeWindows();
    cutsSorted = [...new Set(cutList.map((c) => c.t).filter((t) => t > 0 && t < P.duration))].sort((a, b) => a - b);
    blurSorted = blurList.map(({a, b, samples, label}) => ({a, b, samples, label})).sort((x, y) => x.a - y.a || x.b - y.b);
    const cutLabel = (t) => cutList.filter((c) => Math.abs(c.t - t) < 1e-9).map((c) => c.label).join('; ');
    validateBlurWindows(blurSorted, cutsSorted, P.fps, cutLabel);

    ready = true;
    try {
      await seek(initialT);
    } catch (err) {
      ready = false;
      throw err;
    }
    for (const w of warnings) console.warn(`music-video: ${w}`);
  };

  return {
    boot,
    seek,
    get info() {
      return P === null
        ? null
        : {fps: P.fps, width: P.width, height: P.height, duration: P.duration, frames: P.frames, audioEnd: P.audioEnd, audioFrames: P.audioFrames, audio: P.audio, timing: P.timing};
    },
    get project() {
      return P;
    },
    get instances() {
      return instances;
    },
    warnings,
    subframes: (n) => subframeTimes(n, {fps: P.fps, shutter, windows: blurSorted, cuts: cutsSorted}),
    cuts: () => [...cutsSorted],
    blurWindows: () => blurSorted.map(({a, b, samples}) => ({a, b, samples})),
    lines: () => lyricLayer.schedules(),
  };
};
