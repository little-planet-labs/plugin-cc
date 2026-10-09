// What the mod shows: the band above the prompt, the spinner's summary,
// agent rows, toasts and the /factory pane. Every segment
// whose figure is unknown is left out.

import type { FactoryLedgers, FactoryUsage } from '../../types'
import { UNIT_STATES } from './ledger'
import type { RosterEntry } from './roster'
import { rosterTree } from './roster'
import type { Row, Seg } from './style'
import { COLOR, fitRow, gauge, joinRows, levelColor, rowWidth, seg, textWidth, truncate, truncateMiddle } from './style'

export type View = { roster: RosterEntry[]; usage: FactoryUsage; ledgers: FactoryLedgers; now: number }

const PREFIX = 'little-planet-factory:'
const TITLE = 'Little Planet Factory'
export const MARKS: Record<RosterEntry['status'], string> = { running: '●', done: '✓', failed: '✗', other: '·' }
const STATUS_COLORS: Record<RosterEntry['status'], string | undefined> = {
  running: COLOR.accent,
  done: COLOR.good,
  failed: COLOR.bad,
  other: undefined,
}
const WINDOWS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }
// The band draws its own collapse control at its right edge.
export const COLLAPSE_COLUMNS = 5
// Room for the band's `1: /factory` Button and a gap before it.
export const BUTTON_COLUMNS = 12
// Wider than any terminal; keeps each Text well under the 10,000-character limit.
export const MAX_ROW_COLUMNS = 1000

const percent = (n: number): string => `${Math.round(n)}%`

export function tokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  return n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(1)}M`
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
  return `${Math.floor(s / 86_400)}d${Math.floor((s % 86_400) / 3600)}h`
}

export const contextPercent = ({ context }: FactoryUsage): number | undefined =>
  context?.percent ??
  (context?.tokens !== undefined && context.window > 0 ? (context.tokens / context.window) * 100 : undefined)

const resetIn = (resetsAt: string | undefined, now: number): string | undefined => {
  const at = resetsAt === undefined ? NaN : Date.parse(resetsAt)
  return Number.isNaN(at) ? undefined : duration(at - now)
}

const counts = (roster: readonly RosterEntry[]): Record<RosterEntry['status'], number> => {
  const out = { running: 0, done: 0, failed: 0, other: 0 }
  for (const entry of roster) out[entry.status] += 1
  return out
}

const shortType = (entry: RosterEntry): string => (entry.type ?? 'agent').replace(PREFIX, '')

const elapsedOf = (entry: RosterEntry, now: number): number | undefined =>
  entry.startedAt === undefined
    ? undefined
    : entry.status === 'running'
      ? now - entry.startedAt
      : entry.endedAt === undefined
        ? undefined
        : entry.endedAt - entry.startedAt

// One agent: status dot, type, description, model, elapsed time and tokens.
// The card above an Agent row leaves tokens out: the engine's row under it
// shows its own count, which is figured differently.
export function agentRow(entry: RosterEntry, now: number, withTokens = true): Row {
  const elapsed = elapsedOf(entry, now)
  const rest = [
    entry.description,
    entry.model?.replace(/^claude-/, ''),
    elapsed === undefined ? undefined : duration(elapsed),
    entry.tokens === undefined || !withTokens ? undefined : `${tokens(entry.tokens)} tok`,
  ].filter((part): part is string => part !== undefined && part !== '')
  const color = STATUS_COLORS[entry.status]
  // Descriptions come from the model: bounded, control characters replaced.
  return fitRow(
    [
      seg(`${MARKS[entry.status]} `, color === undefined ? { dim: true } : { color }),
      seg(shortType(entry), { bold: true }),
      ...rest.map((part, index) => seg(` · ${part}`, index === 0 ? {} : { dim: true })),
    ],
    MAX_ROW_COLUMNS,
  )
}

export function finishToast(entry: RosterEntry, now: number): string {
  const elapsed = elapsedOf(entry, now)
  return [
    `${MARKS[entry.status]} ${shortType(entry)} · ${entry.description ?? entry.id} ${entry.status === 'done' ? 'done' : 'failed'}`,
    ...(elapsed === undefined ? [] : [duration(elapsed)]),
    ...(entry.tokens === undefined ? [] : [`${tokens(entry.tokens)} tok`]),
  ].join(' · ')
}

export function limitToast(kind: string, percentUsed: number, resetsAt: string | undefined, now: number): string {
  const resets = resetIn(resetsAt, now)
  return `${WINDOWS[kind] ?? kind} limit at ${percent(percentUsed)}${resets === undefined ? '' : ` · resets in ${resets}`}`
}

export function spinnerSummary({ roster, ledgers }: View): string | undefined {
  const { running } = counts(roster)
  if (running === 0) return undefined
  const next = ledgers.main?.next
  return `${running} agent${running === 1 ? '' : 's'} running${next === undefined ? '' : ` · next: ${truncate(next, 40)}`}`
}

// The band: a framed card when there is room, else fewer rows, down to one.
// The last row carries the Button, so it leaves BUTTON_COLUMNS free.

function gaugesRow({ usage, now }: View, width: number): Row {
  const ctx = contextPercent(usage)
  const limit = (kind: string) => usage.rateLimits.find(one => one.kind === kind)
  const fiveHour = limit('five_hour')
  const sevenDay = limit('seven_day')
  const build = (bar: number, withReset: boolean, withSevenDay: boolean, withFiveHour = true): Row => {
    const reset = withReset ? resetIn(fiveHour?.resetsAt, now) : undefined
    return joinRows(
      [
        ctx === undefined ? [] : gauge('ctx', ctx, bar),
        fiveHour === undefined || !withFiveHour
          ? []
          : [...gauge('5h', fiveHour.percentUsed, bar), ...(reset === undefined ? [] : [seg(` ↻${reset}`, { dim: true })])],
        sevenDay === undefined || !withSevenDay ? [] : gauge('7d', sevenDay.percentUsed, bar),
      ],
      seg('   '),
    )
  }
  // Drop the 7d gauge first, then the reset time, then shorten the bars, then
  // the 5h gauge. A figure is never cut: with no room even for ctx, no row.
  const tries = [
    build(8, true, true),
    build(8, true, false),
    build(8, false, false),
    build(4, false, false),
    build(0, false, false),
    build(0, false, false, false),
  ]
  return tries.find(row => rowWidth(row) <= width) ?? []
}

// The cells each description gets out of `room`, shared fairly: none gets
// more than its own width, and what a short one leaves goes to the rest.
export function shareWidths(widths: readonly number[], room: number): number[] {
  const out = widths.map(() => 0)
  let left = room
  let open = widths.map((_, index) => index).filter(index => widths[index]! > 0)
  while (open.length > 0 && left >= open.length) {
    const each = Math.floor(left / open.length)
    for (const index of open) {
      const give = Math.min(each, widths[index]! - out[index]!)
      out[index]! += give
      left -= give
    }
    open = open.filter(index => out[index]! < widths[index]!)
  }
  return out
}

// A description is shown only if it gets at least this many cells (or all of
// a shorter one); otherwise fewer chips are shown and the rest fold into +N.
// Fewer readable chips beat many cut to a few letters.
const MIN_DESCRIPTION = 12

// One chip per type, description and status, running first; identical agents
// share a chip with ×N, and what doesn't fit folds into +N.
function chipsRow({ roster }: View, width: number): Row {
  const order: RosterEntry['status'][] = ['running', 'failed', 'done', 'other']
  const groups: { entry: RosterEntry; count: number }[] = []
  for (const entry of order.flatMap(status => roster.filter(one => one.status === status))) {
    const same = groups.find(
      group =>
        group.entry.status === entry.status && shortType(group.entry) === shortType(entry) && group.entry.description === entry.description,
    )
    if (same === undefined) groups.push({ entry, count: 1 })
    else same.count += 1
  }
  const total = roster.length
  for (let shown = groups.length; shown >= 1; shown -= 1) {
    const visible = groups.slice(0, shown)
    const hidden = total - visible.reduce((sum, group) => sum + group.count, 0)
    const more = hidden === 0 ? 0 : textWidth(`  +${hidden}`)
    const fixed = visible.reduce(
      (sum, { entry, count }, index) =>
        sum +
        (index === 0 ? 0 : 2) +
        textWidth(`${MARKS[entry.status]} ${shortType(entry)}`) +
        (entry.description ? 1 : 0) +
        (count > 1 ? textWidth(` ×${count}`) : 0),
      0,
    )
    const widths = visible.map(({ entry }) => textWidth(entry.description ?? ''))
    const shares = shareWidths(widths, width - fixed - more)
    const isEnough = fixed + more <= width && widths.every((full, index) => shares[index]! >= Math.min(full, MIN_DESCRIPTION))
    if (!isEnough) continue
    return [
      ...visible.flatMap(({ entry, count }, index) => [
        ...(index === 0 ? [] : [seg('  ')]),
        seg(`${MARKS[entry.status]} `, { color: STATUS_COLORS[entry.status] ?? COLOR.head }),
        seg(`${shortType(entry)}${entry.description ? `·${truncateMiddle(entry.description, shares[index]!)}` : ''}`),
        ...(count > 1 ? [seg(` ×${count}`, { dim: true })] : []),
      ]),
      ...(hidden === 0 ? [] : [seg(`  +${hidden}`, { dim: true })]),
    ]
  }
  return total === 0 || textWidth(`+${total}`) > width ? [] : [seg(`+${total}`, { dim: true })]
}

function nextRow({ ledgers }: View): Row {
  if (ledgers.main === null) return [seg('No factory ledger yet.', { dim: true })]
  const next = ledgers.main.next
  return next === undefined ? [] : [seg('next ', { dim: true }), seg('▸ ', { color: COLOR.accent }), seg(next)]
}

function headerRow({ ledgers }: View, width: number): Row {
  const title: Row = [seg('◉ ', { color: COLOR.accent }), seg(TITLE, { color: COLOR.accent, bold: true })]
  const status = ledgers.main?.status
  const right: Row =
    status === undefined ? [] : [seg(status, status === 'active' ? { color: COLOR.good } : { dim: true })]
  const gap = width - rowWidth(title) - rowWidth(right)
  return gap < 1 ? fitRow(title, width) : [...title, seg(' '.repeat(gap)), ...right]
}

function footerRow({ ledgers }: View): Row {
  if (ledgers.main === null) return []
  const open = ledgers.main.questions.length
  return open === 0
    ? [seg('no open questions', { dim: true })]
    : [seg(`${open} open question${open === 1 ? '' : 's'}`, { color: COLOR.warn })]
}

// One line for a short band. Figures (ctx, 5h, the running count) go in that
// order and are dropped whole, with everything after them, never cut; only
// prose (the next step, or the title when nothing is known) may be truncated.
function oneLine(view: View, width: number): Row {
  const ctx = contextPercent(view.usage)
  const fiveHour = view.usage.rateLimits.find(limit => limit.kind === 'five_hour')
  const { running } = counts(view.roster)
  const next = view.ledgers.main?.next
  const figures: Row[] = [
    ctx === undefined ? [] : [seg('ctx '), seg(percent(ctx), { color: levelColor(ctx) })],
    fiveHour === undefined ? [] : [seg('5h '), seg(percent(fiveHour.percentUsed), { color: levelColor(fiveHour.percentUsed) })],
    running === 0 ? [] : [seg(`${running} running`, { color: COLOR.accent })],
  ].filter(figure => figure.length > 0)
  const glyph: Row = [seg('◉', { color: COLOR.accent })]
  const separator = (row: Row): Seg => (row === glyph ? seg(' ') : seg(' · ', { dim: true }))
  let row = glyph
  for (const figure of figures) {
    const longer = [...row, separator(row), ...figure]
    if (rowWidth(longer) > width) return row
    row = longer
  }
  // With nothing to show, the title or the empty-ledger line stands in.
  const prose: Row =
    figures.length > 0
      ? next === undefined
        ? []
        : [seg('▸ ', { color: COLOR.accent }), seg(next)]
      : view.ledgers.main === null
        ? nextRow(view)
        : [seg(TITLE, { color: COLOR.accent, bold: true })]
  const lead = separator(row)
  const room = width - rowWidth(row) - rowWidth([lead])
  return prose.length === 0 || room < 4 ? row : [...row, lead, ...fitRow(prose, room)]
}

// The band for `columns` cells and `maxRows` rows. No rows means there is no
// room to draw. The last row carries the Button where it fits.
export function bandLayout(
  view: View,
  columns: number,
  maxRows: number,
): { isFramed: boolean; rows: Row[]; hasButton: boolean } {
  const width = columns - COLLAPSE_COLUMNS
  if (maxRows < 1 || width < 1) return { isFramed: false, rows: [], hasButton: false }
  if (maxRows >= 7 && width >= 48) {
    const inner = width - 4 // border and padding
    const middle = [gaugesRow(view, inner), chipsRow(view, inner), fitRow(nextRow(view), inner)].filter(row => row.length > 0)
    return {
      isFramed: true,
      rows: [headerRow(view, inner), ...middle, fitRow(footerRow(view), inner - BUTTON_COLUMNS)],
      hasButton: true,
    }
  }
  // Each row is built for its own width, so the last is built narrower for
  // the Button rather than cut afterwards.
  const builders: ((room: number) => Row)[] =
    width >= 30 && maxRows >= 3
      ? [room => gaugesRow(view, room), room => chipsRow(view, room), room => fitRow(nextRow(view), room)]
      : width >= 30 && maxRows >= 2
        ? [room => gaugesRow(view, room), room => fitRow(nextRow(view), room)]
        : []
  const kept = builders.filter(build => build(width).length > 0)
  if (kept.length > 0) {
    return {
      isFramed: false,
      rows: kept.map((build, index) => build(index === kept.length - 1 ? width - BUTTON_COLUMNS : width)),
      hasButton: true,
    }
  }
  // One line: the Button stays only if something beyond the glyph fits beside
  // it; otherwise the line takes the whole width.
  const beside = width >= BUTTON_COLUMNS ? oneLine(view, width - BUTTON_COLUMNS) : []
  return beside.length > 1
    ? { isFramed: false, rows: [beside], hasButton: true }
    : { isFramed: false, rows: [oneLine(view, width)], hasButton: false }
}

// The /factory pane.

function usageRows(usage: FactoryUsage, now: number): Row[] {
  const rows: Row[] = []
  const ctx = contextPercent(usage)
  const context = usage.context
  if (ctx !== undefined && context !== undefined) {
    const parts: string[] = []
    if (context.tokens !== undefined) {
      parts.push(`${tokens(context.tokens)} / ${tokens(context.window)} tokens`)
      if (usage.autoCompactThreshold !== undefined) {
        parts.push(`${tokens(Math.max(0, usage.autoCompactThreshold - context.tokens))} left before auto-compaction`)
      }
    }
    rows.push([...gauge('context', ctx, 10), ...parts.map(part => seg(` · ${part}`, { dim: true }))])
  }
  for (const limit of usage.rateLimits) {
    const resets = resetIn(limit.resetsAt, now)
    rows.push([
      ...gauge(WINDOWS[limit.kind] ?? limit.kind, limit.percentUsed, 10),
      ...(resets === undefined ? [] : [seg(` · resets in ${resets}`, { dim: true })]),
    ])
  }
  if (usage.costUsd !== undefined) rows.push([seg(`cost $${usage.costUsd.toFixed(2)}`)])
  return rows
}

function ledgerRows({ main, managers }: FactoryLedgers): Row[] {
  if (main === null) return [[seg('No factory ledger yet.', { dim: true })]]
  const units = UNIT_STATES.filter(state => main.units[state]).map(state => `${main.units[state]} ${state}`)
  const open = main.questions.length
  return [
    ...(main.status === undefined
      ? []
      : [[seg('status '), seg(main.status, main.status === 'active' ? { color: COLOR.good } : { dim: true })]]),
    ...(main.next === undefined ? [] : [[seg('next: '), seg(main.next, { color: COLOR.accent })]]),
    [seg('open questions: '), open === 0 ? seg('none', { dim: true }) : seg(String(open), { color: COLOR.warn })],
    ...main.questions.map(question => [seg(`  ${question}`)]),
    [seg(`units: ${units.length === 0 ? 'none' : units.join(' · ')}`)],
    ...(main.background.length === 0 ? [] : [[seg('background:')]]),
    ...main.background.map(line => [seg(`  ${line}`, { dim: true })]),
    ...managers.map(manager => [seg(`manager ${manager.slug}: `), seg(manager.next ?? 'no next step', { dim: true })]),
  ]
}

export function paneRows(view: View, columns: number): Row[] {
  const usage = usageRows(view.usage, view.now)
  const heading = (text: string): Row => [seg(text, { color: COLOR.head, bold: true })]
  const indent = (row: Row, depth: number): Row => [seg('  '.repeat(depth)), ...row]
  const rows: Row[] = [
    heading('Usage'),
    ...(usage.length === 0 ? [[seg('  no usage reported yet', { dim: true })]] : usage.map(row => indent(row, 1))),
    heading('Agents'),
    [seg('  ◉ ', { color: COLOR.accent }), seg('overseer', { bold: true })],
    ...rosterTree(view.roster).map(({ entry, depth }) => indent(agentRow(entry, view.now), depth + 1)),
    heading('Ledger'),
    ...ledgerRows(view.ledgers).map(row => indent(row, 1)),
  ]
  return rows.map(row => fitRow(row, columns))
}

