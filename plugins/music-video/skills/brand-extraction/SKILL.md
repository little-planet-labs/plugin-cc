---
name: brand-extraction
description: How the music-video company researcher pulls a company's brand into a video project: finding colour and type tokens in a design-system repo or, without one, in the website's CSS; mapping them onto the src/brand.json schema; checking the font licence and falling back to a Google font through @remotion/google-fonts; finding the logo SVG and baking it into on-dark and on-light variants with no CSS variables left; and citing a source for every token. Use when writing src/brand.json or public/brand/ for a music video.
user-invocable: false
---

# Brand extraction

The video's colours, type, and logo come from the company's real brand, and every value says where it came from. You write `src/brand.json`, `public/brand/logo.svg` and its variants, and a **Brand** section in `creative/research.md`. `theme.ts` reads `brand.json`; scenes never hard-code a brand value.

## Find the tokens

### With a repo (`brief.repo`)

Design-system source beats compiled CSS, and compiled CSS beats what an app happens to use. Search in that order:

1. **Design-system packages**: `packages/*/src/theme.{ts,js}`, `tokens.{json,ts}`, `colors.{ts,js}`, `**/design-tokens/**`, Style Dictionary output. Kizen's were in `react-app/packages/kds/src/theme.ts`: named scales such as `'deepteal-900': '#002A2C'`, `'teal-300'`, `'blue-600'`, `'neutral-500'`, plus `'brand-100': '#0C595C'`.
2. **Tailwind**: `tailwind.config.*` `theme.extend.colors` and `fontFamily`, or `@theme` blocks in CSS for Tailwind 4.
3. **CSS custom properties**: `:root { --color-… }` in global styles.
4. **Fonts**: `@font-face` rules, font imports (Kizen's `apps/react-app/src/app/typography.jsx` imports `ProximaNova-*.woff2`), and `fontFamily` tokens.

```sh
rg --files <repo> -g '!**/node_modules/**' -g '!**/dist/**' | rg -i '(theme|tokens?|colou?rs?)\.(ts|js|json)$'
rg -n --glob '!**/node_modules/**' -e '--color-[a-z-]+\s*:' <repo> | head -50
rg -n --glob '!**/node_modules/**' -i '@font-face|fontFamily|font-family' <repo> | head -30
```

### Without a repo

1. Fetch the homepage HTML and its linked stylesheets with `curl -fsSL` so you get the raw text. **Inferring (unverified):** a fetch tool that summarises pages can drop CSS values, so don't rely on one for tokens.
2. Collect `:root` custom properties, `<meta name="theme-color">`, and the most frequent colours on buttons, links, headers, and backgrounds.
3. Read `font-family` stacks and the font hosts in `<link>` tags (`fonts.googleapis.com` means a Google font; `use.typekit.net` or a self-hosted commercial file means it isn't).
4. A public brand or press page, when there is one, outranks inferred CSS colours.

## Map onto brand.json

```json
{
  "name": "Kizen",
  "colors": {
    "background": "#002A2C",
    "surface": "#004B4E",
    "primary": "#0C595C",
    "primaryDeep": "#001819",
    "accent": "#1183FF",
    "accentAlt": "#4BC7B4",
    "text": "#FFFFFF",
    "textMuted": "#E1F5F5",
    "neutral": {"50": "#F3F4F6", "300": "#C4C7CE", "500": "#858A93", "700": "#4B525C", "900": "#1E2227"}
  },
  "fonts": {
    "display": {"family": "Open Sans", "source": "google", "weights": [300, 600, 800]},
    "body": {"family": "Open Sans", "source": "google", "weights": [400, 600]}
  },
  "logo": {"path": "public/brand/logo.svg", "onDark": "public/brand/logo-on-dark.svg", "onLight": "public/brand/logo-on-light.svg"}
}
```

| Slot | Pick |
|---|---|
| `background` | The darkest brand colour that still reads as the brand, not black. Video type sits on it, so it must be dark enough for white text. |
| `surface` | One step lighter than `background` from the same scale: cards, tiles, panels. |
| `primary` | The logo or primary brand colour. |
| `primaryDeep` | The darkest step of the primary scale, for vignettes and depth. |
| `accent` | The one colour for beat hits. It must contrast with **both** `background` and `primary`. Kizen's teal-300 sat too close to the teal backgrounds, so the accent became blue-600. |
| `accentAlt` | A second accent for lines and glows, from a different hue family where the brand has one. |
| `text` / `textMuted` | Type on `background`. `text` contrast with `background` is at least 4.5:1; `textMuted` at least 3:1. |
| `neutral` | The source's grey scale, keys as the source's step numbers as strings. At least a light, a middle, and a dark step. |

Use the source's exact hex values; never adjust or invent a colour to fill a slot. When the brand has no candidate for a slot, reuse the nearest real token and say so in the Brand section.

Check contrast before writing the file (WCAG relative luminance):

```sh
node -e 'const L=h=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]};const r=(a,b)=>{const[x,y]=[L(a),L(b)].sort((p,q)=>q-p);return((x+.05)/(y+.05)).toFixed(2)};console.log(r(process.argv[1],process.argv[2]))' '#FFFFFF' '#002A2C'
```

## Fonts and licences

Having the font files doesn't mean the company may render them into a video. Kizen's repo ships Proxima Nova `.woff2` files, a commercial font, so the video used Open Sans.

- **Google font** (served from Google Fonts, or listed on fonts.google.com): `"source": "google"`. Use it.
- **Commercial or unknown licence** (Typekit/Adobe Fonts, a foundry licence, files with no licence text): don't embed it. Pick a Google font with the same structure and record both names. Suggested pairings, a matter of taste rather than metrics: geometric sans (Proxima Nova, Gotham, Circular) to Montserrat or Figtree; humanist sans to Open Sans or Source Sans 3; grotesk (Helvetica, Graphik) to Inter; transitional serif to Source Serif 4.
- **`"source": "local"`** only when the licence text in the repo explicitly allows embedding in rendered media, and the user confirms. Copy the files under `public/fonts/` and list them in the font's `files` map, weight to path (`{"400": "public/fonts/Brand-Regular.woff2"}`); every weight in `files` must also be in `weights`. `src/lib/brand.ts` in the project is the schema.

Confirm the Google family exists in `@remotion/google-fonts` at the project's pinned Remotion version, and which weights it has. Run in the project:

```sh
node --input-type=module -e "const m = await import('@remotion/google-fonts/Montserrat'); console.log(m.getInfo().fontFamily, Object.keys(m.getInfo().fonts.normal))"
```

The module name is the family without spaces. `ERR_MODULE_NOT_FOUND` means the family isn't in the package. List only weights the command printed.

## Logo

### Find it

- **Repo:** `rg --files <repo> -g '*.svg' | rg -i 'logo|word-?mark|brand'`, plus components named `Logo*` with an inline `<svg>`. Kizen's was `apps/react-app/src/components/Kizen/kizen-word-mark.svg`.
- **Website:** the `<svg>` or `<img src="*.svg">` inside the header's home link, then `/favicon.svg`, then a press-kit SVG.
- Prefer the wordmark or full lockup over the icon. A raster logo (PNG) is the last resort: say so in the report, because it blurs when scaled for a hit.

### Bake it

Logos built for apps often colour themselves from CSS. Kizen's had `fill="var(--color-logo-primary)"` on 9 paths, and the variable was set nowhere in the repo's source or compiled CSS. In a rendered video nothing defines it, so the logo renders black or not at all.

1. Replace every `var(--…)`, `currentColor`, and class-based fill with a literal hex. Resolve each variable to the token it stands for and cite it; when the value is defined nowhere, use the brand token of the same role (Kizen: `brand-100`, `#0C595C`) and label that "Inferring" in research.md.
2. Write three files: `logo.svg` (brand colours, for neutral backgrounds), `logo-on-dark.svg` (light or white fills, plus any brand accent that still contrasts), and `logo-on-light.svg` (brand or dark fills).
3. Keep the `viewBox`. Drop fixed `width` and `height` so scenes size it. Keep `clip-path` ids and make them unique per file if two variants could appear in one frame.
4. Check that nothing external is left:

```sh
rg -n 'var\(|currentColor|class=|<style|href="http' public/brand/*.svg   # must print nothing
```

## Cite every token

The Brand section of `research.md` is a table: slot, value, source token name, and where it came from, each labelled **Confirmed by** `<repo path:line>` or `<URL>`, or **Inferring** with the reason. Include the font licence verdict with its evidence and the logo's source path. A value with no source doesn't go in `brand.json`.
