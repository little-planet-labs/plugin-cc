import type {CSSProperties, ReactNode} from 'react';
import {theme} from '../../theme';

export type KineticTextProps = {
  children?: ReactNode;
  /** Font size in px at 1920x1080. Body lyrics >= theme.sizes.lyricSmall (72); hits 160-300 (theme.sizes.hit / hitMax). */
  size: number;
  /** Font weight; use one brand.json loads (see theme.weights). Default theme.weights.extraBold, or theme.weights.light when `cinematic`. */
  weight?: number;
  /** Letter spacing in em. Default -0.02 (tight display), or 0.32 when `cinematic`. */
  tracking?: number;
  /** Text color. Default theme.colors.text. */
  color?: string;
  /** Cinematic style: wide-tracked uppercase in a light weight. Explicit weight/tracking still win. */
  cinematic?: boolean;
  /** Force uppercase. Default true when `cinematic`, else false. */
  uppercase?: boolean;
  /** Text alignment. Default 'center'. */
  align?: CSSProperties['textAlign'];
  /** Line height (unitless). Default 1.05, or 1.25 when `cinematic`. */
  lineHeight?: number;
  /** Extra styles, applied last (they override the props above). */
  style?: CSSProperties;
};

/**
 * The base text style every scene uses: the brand display font from the theme, consistent
 * weights, tracking and line height. Multi-line text is balanced. Positive
 * tracking is offset with matching left padding so centered text stays
 * optically centered.
 */
export const KineticText = ({
  children,
  size,
  weight,
  tracking,
  color = theme.colors.text,
  cinematic = false,
  uppercase,
  align = 'center',
  lineHeight,
  style,
}: KineticTextProps) => {
  const letterSpacing = tracking ?? (cinematic ? 0.32 : -0.02);
  return (
    <div
      style={{
        fontFamily: theme.fonts.display,
        fontSize: size,
        fontWeight: weight ?? (cinematic ? theme.weights.light : theme.weights.extraBold),
        letterSpacing: `${letterSpacing}em`,
        paddingLeft: letterSpacing > 0 ? `${letterSpacing}em` : undefined,
        textTransform: (uppercase ?? cinematic) ? 'uppercase' : undefined,
        lineHeight: lineHeight ?? (cinematic ? 1.25 : 1.05),
        color,
        textAlign: align,
        textWrap: 'balance',
        ...style,
      }}
    >
      {children}
    </div>
  );
};
