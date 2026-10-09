// Shape of src/data/sections.json (which scene plays when) and how sections
// become frame ranges. Pure (no runtime imports) so Node's test runner loads
// it directly. The composition renders one <Sequence> per placed section.

/**
 * A scene key: any non-empty string. `pnpm align` writes the section kind from
 * the lyric tags (intro, verse, preChorus, chorus, postChorus, hook, bridge,
 * outro, instrumental, ...); src/scenes/registry.ts maps keys to components.
 */
export type SceneKey = string;

/**
 * One entry of sections.json. A section runs from `start` until the next
 * section's start (the last runs to the end of the video).
 *
 * `variant` is free text the scene interprets. `pnpm align` writes:
 * - a repeated kind (verse, chorus, ...): its occurrence, "1", "2", ...
 * - instrumental: "lead-in" | "break" | "tail".
 */
export type SectionSpec = {
  /** Unique, non-empty; used as the <Sequence> name. */
  id: string;
  scene: SceneKey;
  /** Seconds from track start. The first section starts at 0; starts strictly ascend. */
  start: number;
  variant?: string;
};

/** A section placed on the video's frame timeline. */
export type PlacedSection = SectionSpec & {
  /** First frame: Math.round(start * fps). */
  from: number;
  /** Next section's `from` minus this `from`; the last section runs to the video's end. Always >= 1. */
  durationInFrames: number;
  /** Seconds: the next section's start, or the video's end for the last section. */
  end: number;
};

/**
 * What plays when sections.json is `[]` (before `pnpm align` has run): one
 * section over the whole video. Its scene key isn't in the registry on
 * purpose, so it resolves to the registry's DEFAULT_SCENE.
 */
export const WHOLE_SONG_SECTION: SectionSpec = {id: 'song', scene: 'song', start: 0};

/** `specs`, or [WHOLE_SONG_SECTION] when there are none. */
export const withWholeSongSection = (specs: readonly SectionSpec[]): readonly SectionSpec[] =>
  specs.length === 0 ? [WHOLE_SONG_SECTION] : specs;

const ALLOWED_KEYS = new Set(['id', 'scene', 'start', 'variant', '$comment']);

const fail = (path: string, expected: string): never => {
  throw new Error(`sections.json: ${path} must be ${expected}`);
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validate raw JSON into section specs: an array (empty is allowed: nothing
 * aligned yet), first start 0, starts strictly ascending, unique non-empty
 * ids, non-empty scene keys, string variants. Whether a scene key has a
 * component is checked by the registry (resolveScene), not here. Unknown keys (other than "$comment") are rejected so a typo fails
 * loudly. Errors name the offending index and field.
 */
export const parseSections = (raw: unknown): SectionSpec[] => {
  if (!Array.isArray(raw)) return fail('root', 'an array of sections');
  const ids = new Map<string, number>();
  const out: SectionSpec[] = [];
  raw.forEach((item: unknown, i) => {
    const path = `[${i}]`;
    if (!isRecord(item)) return fail(path, 'an object');
    for (const key of Object.keys(item)) {
      if (!ALLOWED_KEYS.has(key)) fail(`${path}.${key}`, `one of ${[...ALLOWED_KEYS].join(', ')} (unknown key)`);
    }
    const {id, scene, start, variant} = item;
    if (typeof id !== 'string' || id.trim() === '') return fail(`${path}.id`, 'a non-empty string');
    const dup = ids.get(id);
    if (dup !== undefined) fail(`${path}.id`, `unique ("${id}" duplicates [${dup}].id)`);
    ids.set(id, i);
    if (typeof scene !== 'string' || scene.trim() === '') {
      return fail(`${path}.scene`, `a non-empty string (got ${JSON.stringify(scene)})`);
    }
    if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) {
      return fail(`${path}.start`, 'a number of seconds >= 0');
    }
    if (i === 0 && start !== 0) fail(`${path}.start`, `0 for the first section (got ${start})`);
    const prev = out[i - 1];
    if (prev && start <= prev.start) {
      fail(`${path}.start`, `greater than [${i - 1}].start (${prev.start}); sections must be sorted by start`);
    }
    if (variant !== undefined && typeof variant !== 'string') fail(`${path}.variant`, 'a string when present');
    const spec: SectionSpec = {id, scene, start};
    if (variant !== undefined) spec.variant = variant as string;
    out.push(spec);
  });
  return out;
};

/**
 * Place parsed sections on a video of `durationInFrames` frames. Each `from`
 * is Math.round(start * fps); each duration runs to the next `from`; the last
 * runs to `durationInFrames`. The result tiles [0, durationInFrames) exactly.
 *
 * Throws, naming the section, when a section starts at or after the end
 * (sections.json is stale for this track) or rounds to <= 0 frames.
 */
export const placeSections = (
  specs: readonly SectionSpec[],
  fps: number,
  durationInFrames: number,
): PlacedSection[] => {
  if (specs.length === 0) throw new Error('placeSections: no sections to place');
  const froms = specs.map((s) => Math.round(s.start * fps));
  if (froms[0] !== 0) {
    throw new Error(`placeSections: the first section "${specs[0]?.id}" must start at frame 0 (got ${froms[0]})`);
  }
  const endSeconds = durationInFrames / fps;
  specs.forEach((s, i) => {
    const from = froms[i] as number;
    if (from >= durationInFrames) {
      throw new Error(
        `placeSections: section "${s.id}" starts at ${s.start}s (frame ${from}), at or after the end of the video ` +
          `(${durationInFrames} frames, ${endSeconds.toFixed(2)}s). sections.json doesn't match this track; update it.`,
      );
    }
  });
  return specs.map((s, i) => {
    const from = froms[i] as number;
    const next = specs[i + 1];
    const to = next === undefined ? durationInFrames : (froms[i + 1] as number);
    const length = to - from;
    if (length <= 0) {
      throw new Error(
        `placeSections: section "${s.id}" (${s.start}s) rounds to ${length} frames at ${fps}fps; ` +
          `move it or "${next?.id}" apart`,
      );
    }
    return {...s, from, durationInFrames: length, end: next === undefined ? endSeconds : next.start};
  });
};

/**
 * Sections that start before the end of a `durationInFrames` video. The
 * composition uses this ONLY when the timing in effect isn't the analyzed
 * track's (the no-track default or the fallback grid, both 60 s), where
 * sections.json can't fit and strict placement would stop every preview.
 * With a real analyzed track the composition places strictly and throws.
 */
export const sectionsWithinDuration = (
  specs: readonly SectionSpec[],
  fps: number,
  durationInFrames: number,
): SectionSpec[] => specs.filter((s) => Math.round(s.start * fps) < durationInFrames);
