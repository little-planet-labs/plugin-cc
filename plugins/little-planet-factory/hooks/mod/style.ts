// Styled text the band, the pane and the agent rows share: a row is a list
// of segments, each drawn as a Text in a theme color, so light and dark
// themes both read.

export type Seg = { text: string; color?: string; dim?: true; bold?: true }
export type Row = Seg[]

// Claude Code's own theme keys.
export const COLOR = { accent: 'claude', head: 'suggestion', good: 'success', warn: 'warning', bad: 'error' } as const

export const seg = (text: string, style: Omit<Seg, 'text'> = {}): Seg => ({ text, ...style })

// Display cells: wide East Asian characters and emoji take two. Common
// ranges only; anything else counts one.
const WIDE: [number, number][] = [
  [0x1100, 0x115f],
  // Emoji-presentation symbols the terminal draws wide: ⌚⌛, ⏩–⏳, ☔☕,
  // ✅, ❌, ❓–❕, ❗, ➕–➗, ⭐; the ambiguous rest of U+2600–27BF stays at one.
  [0x231a, 0x231b],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x2614, 0x2615],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x2b50, 0x2b50],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f000, 0x1f2ff],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd],
]
const cells = (char: string): number => {
  const code = char.codePointAt(0)!
  return WIDE.some(([low, high]) => code >= low && code <= high) ? 2 : 1
}
export const textWidth = (text: string): number => [...text].reduce((sum, char) => sum + cells(char), 0)

// Control characters would make the surface refuse the whole tree.
const sanitize = (text: string): string => text.replace(/[\u0000-\u001f\u007f]+/g, ' ')

// The leading characters of `chars` that fit in `width` cells.
const lead = (chars: readonly string[], width: number): string => {
  let out = ''
  let used = 0
  for (const char of chars) {
    if (used + cells(char) > width) break
    out += char
    used += cells(char)
  }
  return out
}

// Cuts text to `width` cells, ending in an ellipsis when it was cut.
export function truncate(text: string, width: number): string {
  const clean = sanitize(text)
  if (textWidth(clean) <= width) return clean
  return width <= 0 ? '' : `${lead([...clean], width - 1)}…`
}

// Cuts text to `width` cells with the ellipsis in the middle, keeping both
// ends, so names that share a prefix still differ.
export function truncateMiddle(text: string, width: number): string {
  const clean = sanitize(text)
  if (textWidth(clean) <= width || width <= 2) return truncate(clean, width)
  const head = lead([...clean], Math.ceil((width - 1) / 2))
  const tail = [...lead([...clean].reverse(), width - 1 - textWidth(head))].reverse().join('')
  return `${head}…${tail}`
}

export const rowText = (row: Row): string => row.map(part => part.text).join('')
export const rowWidth = (row: Row): number => textWidth(rowText(row))

// Cuts a row to `width` cells: the segment that crosses it ends in an ellipsis.
export function fitRow(row: Row, width: number): Row {
  const out: Row = []
  let used = 0
  for (const part of row) {
    const text = truncate(part.text, width - used)
    if (text === '') break
    out.push({ ...part, text })
    used += textWidth(text)
    if (text !== sanitize(part.text)) break
  }
  return out
}

// Joins rows with a separator, skipping empty ones.
export const joinRows = (rows: Row[], separator: Seg): Row =>
  rows.filter(row => row.length > 0).flatMap((row, index) => (index === 0 ? row : [separator, ...row]))

// Green under 60%, yellow under 80%, red from 80%.
export const levelColor = (percent: number): string => (percent < 60 ? COLOR.good : percent < 80 ? COLOR.warn : COLOR.bad)

export function gauge(label: string, percent: number, bar: number): Row {
  const color = levelColor(percent)
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * bar)
  return [
    seg(`${label} `),
    ...(bar > 0 ? [seg('█'.repeat(filled), { color }), seg('░'.repeat(bar - filled), { dim: true })] : []),
    seg(`${bar > 0 ? ' ' : ''}${Math.round(percent)}%`, { color }),
  ].filter(part => part.text !== '')
}

// How many rows a drawn tree takes in `columns` cells, estimated from its
// shape: what another mod drew in the band. It errs high where it must guess,
// since too low lets the band overflow. Core's own empty drawing
// (`type: 'engine'`) takes none.
type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

// Every string inside a Text, nested Texts included, as it reads.
const textOf = (node: unknown): string =>
  typeof node === 'string' || typeof node === 'number'
    ? String(node)
    : Array.isArray(node)
      ? node.map(textOf).join('')
      : typeof node === 'object' && node !== null && (node as Drawn).type === 'Text'
        ? textOf((node as Drawn).children ?? [])
        : ''

// Rows of text: one per line, and a line wider than `columns` wraps unless
// its Text truncates.
const textRows = (text: string, columns: number, isTruncated: boolean): number =>
  text
    .split('\n')
    .reduce((sum, line) => sum + (isTruncated ? 1 : Math.max(1, Math.ceil(textWidth(line) / Math.max(1, columns)))), 0)

export function rowsOf(node: unknown, columns: number): number {
  if (node === null || node === undefined || typeof node === 'boolean') return 0
  if (typeof node !== 'object') return textRows(String(node), columns, false)
  if (Array.isArray(node)) return node.reduce((sum: number, child) => sum + rowsOf(child, columns), 0)
  const { type, props = {}, children = [] } = node as Drawn
  if (type === 'engine') return 0
  if (type === 'Text') return textRows(textOf(children), columns, String(props.wrap ?? '').startsWith('truncate'))
  if (type === 'Markdown' || type === 'Code') return textRows(String(props.text ?? props.source ?? ''), columns, false)
  if (type !== 'Box') return 1
  if (props.display === 'none') return 0
  const num = (key: string) => (typeof props[key] === 'number' ? (props[key] as number) : 0)
  const border = props.borderStyle === undefined ? 0 : 2
  const outer = typeof props.width === 'number' ? Math.min(columns, props.width) : columns
  const inner = Math.max(1, outer - 2 * (num('paddingX') + num('padding')) - num('paddingLeft') - num('paddingRight') - border)
  const shown = children.filter(child => child !== null && child !== undefined && typeof child !== 'boolean')
  const kids = shown.map(child => rowsOf(child, inner))
  const isRow = props.flexDirection === undefined || String(props.flexDirection).startsWith('row')
  const gap = isRow ? 0 : (num('rowGap') || num('gap')) * Math.max(0, shown.length - 1)
  const content = isRow ? Math.max(0, ...kids) : kids.reduce((sum, rows) => sum + rows, 0) + gap
  const padding = num('paddingTop') + num('paddingBottom') + 2 * (num('paddingY') + num('padding'))
  const margin = num('marginTop') + num('marginBottom') + 2 * (num('marginY') + num('margin'))
  if (typeof props.height === 'number') return props.height + margin
  return Math.max(num('minHeight'), content + padding + border) + margin
}
