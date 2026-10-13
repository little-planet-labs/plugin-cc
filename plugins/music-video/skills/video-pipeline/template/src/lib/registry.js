// Scene registry and lyric registration rules, as pure validators the page's
// boot calls (and the tests and `pnpm check` call directly). Pure ES module
// (no DOM, no node: imports).

/**
 * @typedef {object} SceneDefinition
 * @property {(ctx: object) => (void | Promise<void>)} [setup] Runs once per section that uses the scene.
 * @property {(t: number, ctx: object) => void} draw Runs on every seek while the section is active.
 * @property {number} [pre] Seconds before the section start that draw already runs. Default 0.
 * @property {number} [post] Seconds after the section end that draw still runs. Default 0.
 * @property {boolean} [cut] Every section of this scene starts with a hard cut.
 *
 * @typedef {{SCENES: Record<string, SceneDefinition>, DEFAULT_SCENE: SceneDefinition | null}} SceneRegistry
 */

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validate one scene definition; throws naming the key.
 * @param {unknown} def
 * @param {string} key
 * @returns {SceneDefinition}
 */
export const validateScene = (def, key) => {
  if (!isRecord(def)) throw new Error(`scene "${key}" must be an object with a draw(t, ctx) function`);
  if (typeof def.draw !== 'function') throw new Error(`scene "${key}" has no draw(t, ctx) function`);
  if (def.setup !== undefined && typeof def.setup !== 'function') throw new Error(`scene "${key}": setup must be a function`);
  for (const k of ['pre', 'post']) {
    if (def[k] !== undefined && !(typeof def[k] === 'number' && def[k] >= 0)) throw new Error(`scene "${key}": ${k} must be seconds >= 0`);
  }
  if (def.cut !== undefined && typeof def.cut !== 'boolean') throw new Error(`scene "${key}": cut must be true or false`);
  return def;
};

/**
 * Validate a scene registry module's exports: SCENES (an object of scene
 * definitions) and DEFAULT_SCENE (a scene definition or null).
 * @param {unknown} mod
 * @param {string} [name] Module path, for messages.
 * @returns {SceneRegistry}
 */
export const validateRegistry = (mod, name = 'scene registry') => {
  if (!isRecord(mod)) throw new Error(`${name} must be an ES module`);
  const {SCENES, DEFAULT_SCENE} = /** @type {any} */ (mod);
  if (!isRecord(SCENES)) throw new Error(`${name} must export SCENES (an object of scene key -> scene definition)`);
  if (DEFAULT_SCENE === undefined) throw new Error(`${name} must export DEFAULT_SCENE (a scene definition, or null)`);
  for (const [key, def] of Object.entries(SCENES)) validateScene(def, key);
  if (DEFAULT_SCENE !== null) validateScene(DEFAULT_SCENE, 'DEFAULT_SCENE');
  return {SCENES, DEFAULT_SCENE};
};

/**
 * The scene definition for a sections.json scene key: SCENES[key], else
 * DEFAULT_SCENE, else an error naming the key, the section and the known keys.
 * @param {SceneRegistry} registry
 * @param {string} key
 * @param {string} [sectionId]
 * @returns {SceneDefinition}
 */
export const resolveScene = (registry, key, sectionId) => {
  if (Object.hasOwn(registry.SCENES, key)) return registry.SCENES[key];
  if (registry.DEFAULT_SCENE) return registry.DEFAULT_SCENE;
  const known = Object.keys(registry.SCENES);
  throw new Error(
    `unknown scene key "${key}"${sectionId ? ` (section "${sectionId}")` : ''} in sections.json, and DEFAULT_SCENE is null. ` +
      `Known keys: ${known.length ? known.join(', ') : '(none)'}. Add "${key}" to SCENES or set DEFAULT_SCENE.`,
  );
};

/**
 * Tracks which lyric lines scenes registered: register() throws on an unknown
 * id or a second registration of the same id (naming both sections), and
 * missing() lists the lines nobody registered.
 */
export class LyricRegistrations {
  /** @param {readonly {id?: string, text: string}[]} lines */
  constructor(lines) {
    this.ids = new Set(lines.map((l) => l.id));
    /** @type {Map<string, {section: string, options: object}>} */
    this.byId = new Map();
  }

  /**
   * @param {string} id
   * @param {string} section The registering section's id.
   * @param {object} options
   */
  register(id, section, options) {
    if (typeof id !== 'string' || !this.ids.has(id)) {
      throw new Error(`lyric "${id}" (section "${section}") is not a line id in lyrics.json`);
    }
    const prev = this.byId.get(id);
    if (prev) throw new Error(`lyric "${id}" is registered twice (sections "${prev.section}" and "${section}"); register each line once`);
    this.byId.set(id, {section, options});
  }

  /**
   * Ids of lines (with words) that no scene registered, in lyrics.json order.
   * @param {readonly {id?: string, text: string}[]} lines
   * @returns {string[]}
   */
  missing(lines) {
    return lines.filter((l) => l.text.trim() !== '' && !this.byId.has(l.id)).map((l) => l.id);
  }

  /** @returns {Map<string, object>} id -> options */
  options() {
    return new Map([...this.byId].map(([id, r]) => [id, r.options]));
  }
}

/**
 * The boot error for unregistered lines in render mode, or null.
 * @param {readonly string[]} missing
 * @returns {string | null}
 */
export const unregisteredLinesError = (missing) =>
  missing.length === 0
    ? null
    : `lyric line${missing.length > 1 ? 's' : ''} not registered by any scene: ${missing.join(', ')}. ` +
      'Register every sung line with ctx.lyric(id, style) in a scene setup.';

/**
 * Validate the `scenes` query parameter / --scenes flag: a project-relative
 * path to a .js or .mjs module, inside the project (no leading "/", no ".."
 * segment, no scheme, no backslash). Returns it without a leading "./".
 * @param {string} p
 * @returns {string}
 */
export const validateScenesPath = (p) => {
  const s = String(p ?? '').replace(/^\.\//, '');
  if (s === '' || s.startsWith('/') || s.includes('\\') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) || s.split('/').includes('..')) {
    throw new Error(`scenes must be a project-relative module path like "src/scenes/index.js" (got ${JSON.stringify(p)})`);
  }
  if (!/\.m?js$/.test(s)) throw new Error(`scenes must name a .js or .mjs module (got ${JSON.stringify(p)})`);
  return s;
};
