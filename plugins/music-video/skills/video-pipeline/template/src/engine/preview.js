// The director's interactive preview HUD: the ONLY place a clock runs, and
// only without render=1 (main.js never loads this module in capture mode).
// `pnpm check` allows requestAnimationFrame in this file alone.
//
//   Space          play / pause (with the track, when there is one)
//   Left / Right   one frame back / forward (Shift: 0.5 s)
//   R              back to the start
//   scrubber       click to seek; ?t=<seconds> deep-links
//
// The controls follow the howseen-ai/claude-motion-design skill (Space, arrows,
// R, scrubber, ?t= deep link; MIT, see NOTICE.md); the code follows the
// earlier adaptation.
import {getBeatState} from '../lib/timing.js';
import {toPageUrl} from '../lib/brand.js';
import {layers} from './layers.js';

/**
 * @param {ReturnType<typeof import('./engine.js').createEngine>} engine
 * @param {number} t0
 */
export const startPreview = (engine, t0) => {
  const P = engine.project;
  const {fps, duration} = P;
  const hud = document.getElementById('hud');
  const scrub = document.getElementById('scrub');
  const bar = scrub?.firstElementChild;
  if (!hud || !scrub || !bar) return;
  hud.style.display = 'block';
  scrub.style.display = 'block';
  const {stage} = layers();
  const audio = P.audio ? new Audio(toPageUrl(`public/${P.audio}`)) : null;
  if (audio) audio.preload = 'auto';

  let t = t0;
  let playing = false;
  let busy = false;
  let lastStamp = null;

  const fit = () => {
    const s = Math.min(window.innerWidth / P.width, window.innerHeight / P.height);
    stage.style.transformOrigin = '0 0';
    stage.style.transform = `scale(${s})`;
  };
  fit();
  window.addEventListener('resize', fit);

  const show = () => {
    const frame = Math.round(t * fps);
    const beat = getBeatState(P.analysis, frame, fps);
    const section = P.sections.find((s) => frame >= s.from && frame < s.to);
    hud.textContent = `${t.toFixed(3)}s  f${frame}  bar ${beat.barIndex + 1}  ${section?.id ?? ''}  ${playing ? 'playing' : 'paused'}`;
    bar.style.width = `${(t / duration) * 100}%`;
  };

  // One seek at a time; a request that arrives mid-seek is drawn right after it.
  let dirty = false;
  const redraw = async () => {
    dirty = true;
    if (busy) return;
    busy = true;
    try {
      while (dirty) {
        dirty = false;
        await engine.seek(t);
        show();
      }
    } finally {
      busy = false;
    }
  };

  const go = (v) => {
    t = Math.min(Math.max(v, 0), duration);
    if (audio && playing) audio.currentTime = t;
    return redraw();
  };

  // Each play starts a new generation; a frame callback from an earlier play stops instead of running a second chain.
  let generation = 0;
  const tick = async (gen, stamp) => {
    if (!playing || gen !== generation) return;
    if (audio) t = audio.currentTime;
    else if (lastStamp !== null) t += (stamp - lastStamp) / 1000;
    lastStamp = stamp;
    if (t >= duration) {
      t = duration;
      playing = false;
      audio?.pause();
    }
    await redraw();
    if (playing && gen === generation) requestAnimationFrame((s) => tick(gen, s));
  };

  const toggle = () => {
    playing = !playing;
    lastStamp = null;
    generation++;
    if (playing) {
      if (t >= duration) t = 0;
      if (audio) {
        audio.currentTime = t;
        audio.play().catch((err) => console.warn(`music-video: audio did not start (${err.message})`));
      }
      const gen = generation;
      requestAnimationFrame((s) => tick(gen, s));
    } else {
      audio?.pause();
      show();
    }
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      toggle();
    } else if (e.code === 'ArrowRight') go(t + (e.shiftKey ? 0.5 : 1 / fps));
    else if (e.code === 'ArrowLeft') go(t - (e.shiftKey ? 0.5 : 1 / fps));
    else if (e.code === 'KeyR') go(0);
  });
  scrub.addEventListener('click', (e) => go((e.clientX / window.innerWidth) * duration));
  if (engine.warnings.length) console.warn(`music-video: ${engine.warnings.length} warning(s); see above`);
  show();
};
