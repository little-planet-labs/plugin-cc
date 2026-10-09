// Reads the overseer's factory ledger (agents/overseer.md, "Ledger"). A model
// writes it, so the parse is loose: sections are found by heading text in any
// order, bullets and bold are stripped, and anything unrecognised is ignored.

import type { FactoryLedger } from '../../types'

export const UNIT_STATES = ['queued', 'dispatching', 'mid-edit', 'stopped unfinished', 'done'] as const

// Scan order when a line has no explicit `state:` token: the most specific
// first and "done" last, so "stopped unfinished" never counts as done.
const SCAN = ['stopped unfinished', 'mid-edit', 'dispatching', 'queued', 'done'] as const
const EXPLICIT = /\bstate\s*[:=]\s*(queued|dispatching|mid-edit|stopped unfinished|done)\b/i
const NONE = /^\(?(none|n\/a|nothing)\b/i

const clean = (line: string): string =>
  line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/[*`]/g, '')
    .trim()

export function unitState(line: string): string | undefined {
  const explicit = EXPLICIT.exec(line)
  if (explicit) return explicit[1]!.toLowerCase()
  const text = line.toLowerCase()
  return SCAN.find(state => new RegExp(`(^|[^a-z-])${state}([^a-z-]|$)`).test(text))
}

export function parseLedger(text: string): FactoryLedger {
  const ledger: FactoryLedger = { questions: [], units: {}, background: [] }
  let section = ''

  for (const raw of text.split(/\r?\n/)) {
    const heading = /^\s*##\s+(.*)$/.exec(raw)
    if (heading) {
      section = clean(heading[1]!).toLowerCase()
      continue
    }
    const line = clean(raw)
    if (line === '' || line.startsWith('#')) continue

    if (section === '') {
      const status = /^status\s*:\s*(\S+)/i.exec(line)
      if (status) ledger.status = status[1]!.toLowerCase()
    } else if (section.startsWith('next step')) {
      ledger.next ??= line
    } else if (section.startsWith('open questions')) {
      if (!NONE.test(line)) ledger.questions.push(line)
    } else if (section.startsWith('background work')) {
      if (!NONE.test(line)) ledger.background.push(line)
    } else if (section.startsWith('units')) {
      const state = unitState(line)
      if (state) ledger.units[state] = (ledger.units[state] ?? 0) + 1
    }
  }
  return ledger
}
