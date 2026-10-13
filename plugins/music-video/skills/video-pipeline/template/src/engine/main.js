// Page entry: reads the query (render=1, textonly=1, scenes=<module>,
// t=<seconds>), boots the engine and fills window.__mv (the interface the
// capture scripts drive; index.html creates it with ready false). Any boot
// failure sets window.__mv.error with a plain reason and leaves ready false.
// The preview HUD (the only clock) loads only without render=1.
import {validateScenesPath} from '../lib/registry.js';
import {createEngine} from './engine.js';

const mv = window.__mv;
const q = new URLSearchParams(location.search);
const render = q.get('render') === '1';
const textonly = q.get('textonly') === '1';

const fail = (err) => {
  mv.ready = false;
  mv.error = err instanceof Error ? err.message : String(err);
  console.error(`music-video: ${mv.error}`);
  if (!render) {
    const box = document.getElementById('err');
    if (box) {
      box.textContent = mv.error;
      box.style.display = 'block';
    }
  }
};

try {
  const scenesPath = validateScenesPath(q.get('scenes') ?? 'src/scenes/index.js');
  const engine = createEngine({render, textonly, scenesPath, scenesUrl: new URL(scenesPath, document.baseURI).href});
  const t0 = render ? 0 : Math.max(0, Number.parseFloat(q.get('t') ?? '0') || 0);
  await engine.boot(t0);
  Object.assign(mv, engine.info);
  mv.warnings = [...engine.warnings];
  mv.seek = (t) => engine.seek(t);
  mv.subframes = (n) => engine.subframes(n);
  mv.cuts = () => engine.cuts();
  mv.blurWindows = () => engine.blurWindows();
  mv.lines = () => engine.lines();
  window.seek = mv.seek;
  mv.ready = true;
  if (!render) {
    const {startPreview} = await import('./preview.js');
    startPreview(engine, t0);
  }
} catch (err) {
  fail(err);
}
