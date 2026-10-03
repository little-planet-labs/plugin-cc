import { describe, expect, test } from 'claude-code/testing'

import { parseLedger, unitState } from '../hooks/mod/ledger'
import { contextLevel, nextNudge } from '../hooks/mod/nudge'
import { mergeRoster, rosterTree } from '../hooks/mod/roster'
import { duration, paneLines, statusLine, tokens, truncate } from '../hooks/mod/view'

const LEDGER = `# Factory ledger
Status: active
Updated: 2026-10-03T10:00:00Z

## Request
Build the status mod; request file /s/factory-request.md

## Policy and skills
none; full; quality-bar

## Units
- mod-core; little-planet-factory:worker, 10:02, id a1; hooks/register.ts; state: mid-edit; inspection round 1; signoff round 0; foundational yes
- readme; worker, 10:05, id a2; README.md; done; inspection 0
- parser; worker; mentions done in its description; state: mid-edit
- docs; worker; stopped unfinished
- tests; worker; queued

## Background work
- Copilot wait task bg1

## Open questions for the user
None.

## Next step
Inspect mod-core once it reports.
`

describe('I5 ledger_parser_tolerant', () => {
  test('reads a well-formed ledger', () => {
    expect(parseLedger(LEDGER)).toEqual({
      status: 'active',
      next: 'Inspect mod-core once it reports.',
      questions: [],
      units: { 'mid-edit': 2, done: 1, 'stopped unfinished': 1, queued: 1 },
      background: ['Copilot wait task bg1'],
    })
  })

  test('an empty file parses to nothing', () => {
    expect(parseLedger('')).toEqual({ questions: [], units: {}, background: [] })
  })

  test('missing sections leave their fields empty', () => {
    expect(parseLedger('# Factory ledger\nStatus: closed\n')).toEqual({
      status: 'closed',
      questions: [],
      units: {},
      background: [],
    })
  })

  test('CRLF line endings parse the same', () => {
    expect(parseLedger(LEDGER.replace(/\n/g, '\r\n'))).toEqual(parseLedger(LEDGER))
  })

  test('reordered sections and bold markup still parse', () => {
    const text = [
      '# Factory ledger',
      '**Status:** closed',
      '## Next step',
      '- `Report` to the user',
      '## Open questions for the user',
      '- Which base branch?',
      '## Units',
      '- a; state: done',
    ].join('\n')
    expect(parseLedger(text)).toEqual({
      status: 'closed',
      next: 'Report to the user',
      questions: ['Which base branch?'],
      units: { done: 1 },
      background: [],
    })
  })

  test('the explicit state token wins over "done" in a description', () => {
    expect(unitState('parser; worker; got done with half of it; state: mid-edit')).toBe('mid-edit')
    expect(unitState('core; worker; was mid-edit last round; state: done')).toBe('done')
  })

  test('"stopped unfinished" never counts as done', () => {
    expect(unitState('docs; worker; stopped unfinished; done 2 of 3 files')).toBe('stopped unfinished')
    expect(parseLedger('## Units\n- docs; stopped unfinished\n').units).toEqual({ 'stopped unfinished': 1 })
  })

  test('very long lines are truncated when drawn', () => {
    const long = 'x'.repeat(12_000)
    const ledger = parseLedger(`## Next step\n${long}\n## Open questions for the user\n${long}\n`)
    const view = { roster: [], usage: { rateLimits: [] }, ledgers: { main: ledger, managers: [] }, now: 0 }
    for (const line of paneLines(view, 80)) expect([...line.text].length).toBeLessThanOrEqual(80)
    expect(statusLine(view)!.length).toBeLessThan(80)
  })
})

describe('formatting', () => {
  test('truncate keeps indentation, strips control characters, ends with an ellipsis', () => {
    expect(truncate('    abc', 10)).toBe('    abc')
    expect(truncate('a\tb\u0007c', 10)).toBe('a b c')
    expect(truncate('abcdef', 4)).toBe('abc…')
  })

  test('tokens and durations', () => {
    expect(tokens(950)).toBe('950')
    expect(tokens(12_345)).toBe('12.3k')
    expect(tokens(2_500_000)).toBe('2.5M')
    expect(duration(45_000)).toBe('45s')
    expect(duration(12 * 60_000)).toBe('12m')
    expect(duration(65 * 60_000)).toBe('1h05m')
    expect(duration(26 * 3_600_000)).toBe('1d2h')
  })
})

describe('pure nudge and roster rules', () => {
  test('contextLevel prefers the auto-compaction threshold, then percent', () => {
    expect(contextLevel({ rateLimits: [], context: { tokens: 100, window: 200, percent: 50 }, autoCompactThreshold: 160 })).toEqual({
      percent: 50,
      trigger: 72,
    })
    expect(contextLevel({ rateLimits: [], context: { window: 200, percent: 50 } })).toEqual({ percent: 50, trigger: 75 })
    expect(contextLevel({ rateLimits: [], context: { window: 200 } })).toBeUndefined()
  })

  test('nextNudge fires once per crossing with 10 points of hysteresis', () => {
    const at = (percent: number) => ({ rateLimits: [], context: { window: 100, percent } })
    let nudge = nextNudge({ phase: 'armed', percent: 0 }, at(80))
    expect(nudge).toEqual({ phase: 'pending', percent: 80 })
    nudge = nextNudge({ ...nudge, phase: 'fired' }, at(90))
    expect(nudge.phase).toBe('fired')
    expect(nextNudge(nudge, at(66)).phase).toBe('fired')
    expect(nextNudge(nudge, at(64)).phase).toBe('armed')
  })

  test('rosterTree nests by parent and puts an unknown parent at the top', () => {
    const roster = mergeRoster(
      [
        { id: 'm', description: 'Sub-task', type: 'little-planet-factory:manager', status: 'running' },
        { id: 'w', description: 'Unit', type: 'little-planet-factory:worker', status: 'completed', parentId: 'm' },
        { id: 'x', description: 'Orphan', type: 'Explore', status: 'killed', parentId: 'gone' },
      ],
      {},
    )
    expect(rosterTree(roster).map(({ entry, depth }) => [entry.id, entry.status, depth])).toEqual([
      ['m', 'running', 1],
      ['w', 'done', 2],
      ['x', 'failed', 1],
    ])
  })
})
