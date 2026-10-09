// The company logo from brand.json's `logo` paths (files under public/). Which
// of those files exist is probed once, in the composition's calculateMetadata,
// and provided through LogoFilesContext; a missing file renders nothing.
import {createContext, useContext, type CSSProperties} from 'react';
import {Img, staticFile} from 'remotion';
import {toStaticPath} from '../lib/brand';

export type LogoVariant = 'default' | 'onDark' | 'onLight';

/** For each variant, its path relative to public/ when the file exists, else null. */
export type LogoFiles = Record<LogoVariant, string | null>;

export const NO_LOGO_FILES: LogoFiles = {default: null, onDark: null, onLight: null};

/** Logo files that exist. Defaults to none (tests, or nothing probed). */
export const LogoFilesContext = createContext<LogoFiles>(NO_LOGO_FILES);

/** brand.json logo paths -> the static (public-relative) path of each variant, before probing. */
export const logoCandidates = (logo: {path: string; onDark?: string; onLight?: string}): LogoFiles => ({
  default: toStaticPath(logo.path),
  onDark: logo.onDark === undefined ? null : toStaticPath(logo.onDark),
  onLight: logo.onLight === undefined ? null : toStaticPath(logo.onLight),
});

/** The file to show for `variant`: that variant if it exists, else the default logo, else null. */
export const pickLogo = (files: LogoFiles, variant: LogoVariant): string | null => files[variant] ?? files.default;

export type LogoProps = {
  /** Which brand.json logo to prefer; falls back to the default `path`. Default 'default'. */
  variant?: LogoVariant;
  /** Rendered height in px; width follows the file's aspect ratio. Default 96. */
  height?: number;
  style?: CSSProperties;
};

/** The brand logo as an image, or nothing when brand.json's logo file isn't in public/. */
export const Logo = ({variant = 'default', height = 96, style}: LogoProps) => {
  const file = pickLogo(useContext(LogoFilesContext), variant);
  if (file === null) return null;
  return <Img src={staticFile(file)} style={{display: 'block', height, width: 'auto', ...style}} />;
};
