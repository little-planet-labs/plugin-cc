import {createContext, useContext, type CSSProperties, type ReactNode} from 'react';
import {AbsoluteFill, getInputProps, getRemotionEnvironment} from 'remotion';
import {theme} from '../../theme';

/**
 * Forces textOnly mode on or off for a subtree (tests, previews). null (the
 * default) means "read the composition's input props".
 */
export const TextOnlyContext = createContext<boolean | null>(null);

/**
 * The `textOnly` input prop, read with Remotion's getInputProps(). Outside the
 * Studio and a render it is false: on the server (window undefined, where
 * getInputProps() warns and returns {}) and in a <Player>, where
 * getInputProps() throws.
 */
const textOnlyInputProp = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (getRemotionEnvironment().isPlayer) return false;
  return (getInputProps() as {textOnly?: unknown}).textOnly === true;
};

/**
 * True when the composition renders in textOnly mode: the input prop
 * `textOnly` is true (`--props='{"textOnly":true}'`), unless a TextOnlyContext
 * provider overrides it. In that mode WorldLayer draws plain black and
 * LyricLayer draws as usual, so a render shows the lyric alone, for measuring
 * held-text stillness.
 */
export const useTextOnly = (): boolean => {
  const forced = useContext(TextOnlyContext);
  return forced ?? textOnlyInputProp();
};

/**
 * Styles a layer may take: layout, background, colour. No transform, scale,
 * rotate, translate, filter, clip, mask, opacity, blend or z-index: camera
 * moves, blur and transitions belong on wrappers INSIDE WorldLayer, never on
 * the layers themselves.
 */
export type LayerStyle = Omit<
  CSSProperties,
  | 'transform'
  | 'transformOrigin'
  | 'scale'
  | 'rotate'
  | 'translate'
  | 'perspective'
  | 'filter'
  | 'backdropFilter'
  | 'clipPath'
  | 'mask'
  | 'maskImage'
  | 'opacity'
  | 'mixBlendMode'
  | 'zIndex'
>;

export type LayerProps = {
  children?: ReactNode;
  style?: LayerStyle;
};

/** Stacking order: the world creates its own stacking context at 0, the lyric sits above it. */
const WORLD_Z = 0;
const LYRIC_Z = 10;

/**
 * Everything that is not the lyric: backdrops, shots, camera moves, ShotTimeline
 * transitions, SubframeBlur, Shatter, grain and vignette. useShotCamera's scale,
 * SubframeBlur, ShotTimeline and Shatter go INSIDE it. It applies no transform
 * of its own. In textOnly mode it renders an opaque black fill instead of its
 * children (theme.colors.black, pure #000, which keeps a bright-pixel
 * measurement of the lyric clean).
 */
export const WorldLayer = ({children, style}: LayerProps) => {
  const textOnly = useTextOnly();
  if (textOnly) return <AbsoluteFill data-layer="world" style={{zIndex: WORLD_Z, background: theme.colors.black}} />;
  return (
    <AbsoluteFill data-layer="world" style={{overflow: 'hidden', ...style, zIndex: WORLD_Z}}>
      {children}
    </AbsoluteFill>
  );
};

/**
 * The lyric (MaskedWords and the like), above the world. Render it as a SIBLING
 * after WorldLayer, never inside it, so no camera scale, blur or transition
 * applied to the world reaches the text. It ignores pointer events, applies no
 * transform, and renders the same in textOnly mode.
 */
export const LyricLayer = ({children, style}: LayerProps) => (
  <AbsoluteFill data-layer="lyric" style={{...style, zIndex: LYRIC_Z, pointerEvents: 'none'}}>
    {children}
  </AbsoluteFill>
);
