// What the mod shows: the one-line status under the prompt and the lines of
// the /factory pane. Every segment whose figure is unknown is left out.

import type { FactoryLedgers, FactoryUsage } from '../../types'
import { UNIT_STATES } from './ledger'
import type { RosterEntry } from './roster'
import { rosterTree } from './roster'

export type View = { roster: RosterEntry[]; usage: FactoryUsage; ledgers: FactoryLedgers; now: number }
export type Line = { text: string; style?: 'heading' | 'dim' }

const PREFIX = 'little-planet-factory:'
const MARKS: Record<RosterEntry['status'], string> = { running: '●', done: '✓', failed: '✗', other: '·' }
const WINDOWS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

export function truncate(text: string, width: number): string {
  // Control characters would make the surface refuse the whole tree.
  const chars = [...text.replace(/[\u0000-\u001f\u007f]+/g, ' ')]
  if (chars.length <= width) return chars.join('')
  return width <= 0 ? '' : `${chars.slice(0, width - 1).join('')}…`
}

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

const contextPercent = ({ context }: FactoryUsage): number | undefined =>
  context?.percent ??
  (context?.tokens !== undefined && context.window > 0 ? (context.tokens / context.window) * 100 : undefined)

const counts = (roster: readonly RosterEntry[]): Record<RosterEntry['status'], number> => {
  const out = { running: 0, done: 0, failed: 0, other: 0 }
  for (const entry of roster) out[entry.status] += 1
  return out
}

export function statusLine({ roster, usage, ledgers }: View): string | undefined {
  const { running, done, failed } = counts(roster)
  const ctx = contextPercent(usage)
  const fiveHour = usage.rateLimits.find(limit => limit.kind === 'five_hour')
  const next = ledgers.main?.next
  const segments = [
    running > 0 && `${running} running`,
    done > 0 && `${done} done`,
    failed > 0 && `${failed} failed`,
    ctx !== undefined && `ctx ${percent(ctx)}`,
    fiveHour !== undefined && `5h ${percent(fiveHour.percentUsed)}`,
    next !== undefined && `next: ${truncate(next, 60)}`,
  ].filter((segment): segment is string => typeof segment === 'string')
  return segments.length > 0 ? segments.join(' · ') : undefined
}

function usageLines(usage: FactoryUsage, now: number): string[] {
  const lines: string[] = []
  const ctx = contextPercent(usage)
  const context = usage.context
  if (ctx !== undefined && context !== undefined) {
    const parts = [`context ${percent(ctx)}`]
    if (context.tokens !== undefined) {
      parts.push(`${tokens(context.tokens)} / ${tokens(context.window)} tokens`)
      if (usage.autoCompactThreshold !== undefined) {
        parts.push(`${tokens(Math.max(0, usage.autoCompactThreshold - context.tokens))} left before auto-compaction`)
      }
    }
    lines.push(parts.join(' · '))
  }
  for (const limit of usage.rateLimits) {
    const resetsAt = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)
    const resets = Number.isNaN(resetsAt) ? '' : ` · resets in ${duration(resetsAt - now)}`
    lines.push(`${WINDOWS[limit.kind] ?? limit.kind} ${percent(limit.percentUsed)}${resets}`)
  }
  if (usage.costUsd !== undefined) lines.push(`cost $${usage.costUsd.toFixed(2)}`)
  return lines
}

function agentLine(entry: RosterEntry, now: number): string {
  const elapsed =
    entry.startedAt === undefined
      ? undefined
      : entry.status === 'running'
        ? now - entry.startedAt
        : entry.endedAt === undefined
          ? undefined
          : entry.endedAt - entry.startedAt
  return [
    `${MARKS[entry.status]} ${(entry.type ?? 'agent').replace(PREFIX, '')}`,
    entry.description,
    entry.model?.replace(/^claude-/, ''),
    elapsed === undefined ? undefined : duration(elapsed),
    entry.tokens === undefined ? undefined : `${tokens(entry.tokens)} tok`,
  ]
    .filter(part => part !== undefined && part !== '')
    .join(' · ')
}

function ledgerLines({ main, managers }: FactoryLedgers): Line[] {
  if (main === null) return [{ text: '  No factory ledger yet.', style: 'dim' }]
  const units = UNIT_STATES.filter(state => main.units[state]).map(state => `${main.units[state]} ${state}`)
  return [
    ...(main.status === undefined ? [] : [{ text: `  status ${main.status}` }]),
    ...(main.next === undefined ? [] : [{ text: `  next: ${main.next}` }]),
    { text: `  open questions: ${main.questions.length === 0 ? 'none' : main.questions.length}` },
    ...main.questions.map(question => ({ text: `    ${question}` })),
    { text: `  units: ${units.length === 0 ? 'none' : units.join(' · ')}` },
    ...(main.background.length === 0 ? [] : [{ text: '  background:' }]),
    ...main.background.map(line => ({ text: `    ${line}` })),
    ...managers.map(manager => ({ text: `  manager ${manager.slug}: ${manager.next ?? 'no next step'}` })),
  ]
}

export function paneLines(view: View, columns: number): Line[] {
  const usage = usageLines(view.usage, view.now)
  const agents = rosterTree(view.roster)
  const lines: Line[] = [
    { text: 'Usage', style: 'heading' },
    ...(usage.length === 0 ? [{ text: '  no usage reported yet', style: 'dim' as const }] : usage.map(text => ({ text: `  ${text}` }))),
    { text: 'Agents', style: 'heading' },
    { text: '  overseer' },
    ...agents.map(({ entry, depth }) => ({
      text: `${'  '.repeat(depth + 1)}${agentLine(entry, view.now)}`,
      style: entry.status === 'running' ? undefined : ('dim' as const),
    })),
    { text: 'Ledger', style: 'heading' },
    ...ledgerLines(view.ledgers),
  ]
  return lines.map(line => ({ ...line, text: truncate(line.text, columns) }))
}
