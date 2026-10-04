// The mod driven through the engine: the test's hooks stand for the engine
// beneath the plugin (tool results, agent list, files, usage).

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  agentTool,
  DIR,
  finish,
  LEDGER,
  mainTool,
  measure,
  NUDGE,
  nudges,
  OPUS,
  OVERSEER,
  paneTexts,
  PLUGIN,
  spawn,
  start,
  summary,
  world,
} from './world'

describe('I1 inert_outside_overseer', () => {
  for (const agentType of ['general-purpose', undefined]) {
    test(`agent_type ${agentType ?? 'missing'}: no status, no context, nothing factory-specific`, async ($, on) => {
      const w = world(on)
      await start($, 'startup', agentType)
      await measure($, { tokens: 199_000, window: 200_000, percent: 99 })
      const tool = await mainTool($)
      await $.prompt.submit({ text: 'hi', wait: false } as never)

      expect(w.statuses.every(text => text === undefined)).toBe(true)
      expect(nudges(tool)).toEqual([])
      expect(w.prompts).toEqual([undefined])
      expect(w.commands).toEqual([])
      expect(w.reads).toEqual([])
      expect(w.usageCalls).toBe(0)
      expect(await paneTexts($)).toEqual(['Not a factory overseer session.'])
    })
  }
})

describe('I2 hooks_never_throw_and_pass_through', () => {
  test('tool.call results pass through unchanged, error and deny included', async ($, on) => {
    const w = world(on)
    await start($, 'startup', OVERSEER)
    for (const result of [
      { result: { stdout: 'x' }, text: 'x' },
      { isError: true, result: 'boom', text: 'boom' },
      { deny: 'not allowed' },
    ]) {
      w.toolResult = result
      expect(await mainTool($)).toEqual(result)
      expect(await agentTool($, 'a9')).toEqual(result)
    }
  })

  test('agent.spawn and turn.complete results pass through unchanged', async ($, on) => {
    world(on)
    await start($, 'startup', OVERSEER)
    expect(await spawn($, 'a1')).toEqual({ model: 'claude-opus-4-5', agentId: 'a1' })
    expect(await finish($, 'a1', 'answer', OPUS)).toEqual({ text: '' })
    expect(await finish($, undefined, 'error')).toEqual({ text: '' })
  })

  test('a throwing fs read or a missing ledger still renders status from roster and usage', async ($, on) => {
    const w = world(on)
    w.files = {}
    w.agents = [{ id: 'a1', description: 'Build', type: 'little-planet-factory:worker', status: 'running' }]
    await start($, 'startup', OVERSEER)
    await measure($, { tokens: 100_000, window: 200_000, percent: 50 })
    expect(await summary($)).toMatchObject({ running: 1, ctx: '50%' })
    expect(await paneTexts($)).toContain('  No factory ledger yet.')
  })
})

describe('I2 hooks_never_throw_and_pass_through (listing)', () => {
  test('a rejected scratchpad listing still reads the overseer ledger', async ($, on) => {
    const w = world(on)
    w.listFails = true
    w.files[`${DIR}/factory-ledger-api.md`] = '## Next step\nWire the API\n'
    await start($, 'startup', OVERSEER)
    expect(w.lists).toEqual([DIR])
    expect((await summary($)).next).toBe('Inspect core once it reports.')
    expect((await paneTexts($)).some(text => text.includes('manager'))).toBe(false)
  })
})

describe('I3 nudge_once_per_crossing', () => {
  test('two measurements above the threshold inject exactly once, main loop only', async ($, on) => {
    world(on)
    await start($, 'startup', OVERSEER)
    await measure($, { tokens: 160_000, window: 200_000, percent: 80 })
    await measure($, { tokens: 164_000, window: 200_000, percent: 82 })
    expect(nudges(await agentTool($, 'a1'))).toEqual([])
    const first = await mainTool($)
    expect(nudges(first)).toEqual([
      'Factory mod: context is at 82% and auto-compaction is near. Update the factory ledger now (Units, Background work, Next step).',
    ])
    expect(nudges(await mainTool($))).toEqual([])
    await measure($, { tokens: 170_000, window: 200_000, percent: 85 })
    expect(nudges(await mainTool($))).toEqual([])
  })

  test('re-armed after compaction', async ($, on) => {
    world(on)
    await start($, 'startup', OVERSEER)
    await measure($, { window: 200_000, percent: 80 })
    expect(nudges(await mainTool($))).toHaveLength(1)
    await start($, 'compact', OVERSEER)
    await measure($, { window: 200_000, percent: 80 })
    expect(nudges(await mainTool($))).toHaveLength(1)
  })

  test('re-armed only after dropping 10 points below the threshold', async ($, on) => {
    world(on)
    await start($, 'startup', OVERSEER)
    await measure($, { window: 200_000, percent: 80 })
    expect(nudges(await mainTool($))).toHaveLength(1)
    await measure($, { window: 200_000, percent: 70 })
    await measure($, { window: 200_000, percent: 80 })
    expect(nudges(await mainTool($))).toHaveLength(0)
    await measure($, { window: 200_000, percent: 60 })
    await measure($, { window: 200_000, percent: 80 })
    expect(nudges(await mainTool($))).toHaveLength(1)
  })

  test('a denied tool call keeps the nudge pending for the next one', async ($, on) => {
    const w = world(on)
    await start($, 'startup', OVERSEER)
    await measure($, { window: 200_000, percent: 80 })
    w.toolResult = { deny: 'not allowed' }
    expect(await mainTool($)).toEqual({ deny: 'not allowed' })
    w.toolResult = { result: 'ok', text: 'ok' }
    expect(nudges(await mainTool($))).toHaveLength(1)
  })

  for (const answer of ['drop', 'throw'] as const) {
    test(`a prompt that is refused (${answer}) gives the nudge back to the next tool call`, async ($, on) => {
      const w = world(on)
      await start($, 'startup', OVERSEER)
      await measure($, { window: 200_000, percent: 80 })
      w.promptAnswer = answer
      const submitted = $.prompt.submit({ text: 'hi', wait: false } as never)
      if (answer === 'drop') expect(await submitted).toEqual({ drop: 'blocked by a settings hook' })
      else await expect(submitted).rejects.toThrow()
      expect((w.prompts[0] ?? []).filter(text => NUDGE.test(text))).toHaveLength(1)
      expect(nudges(await mainTool($))).toHaveLength(1)
      expect(nudges(await mainTool($))).toHaveLength(0)
    })
  }

  test('a tool call that rejects keeps the nudge pending for the next one', async ($, on) => {
    const w = world(on)
    await start($, 'startup', OVERSEER)
    await measure($, { window: 200_000, percent: 80 })
    w.toolThrows = true
    await expect(mainTool($)).rejects.toThrow()
    w.toolThrows = false
    expect(nudges(await mainTool($))).toHaveLength(1)
  })

  test('a pending nudge rides the next prompt when no tool call comes first', async ($, on) => {
    const w = world(on)
    await start($, 'startup', OVERSEER)
    await measure($, { window: 200_000, percent: 80 })
    await $.prompt.submit({ text: 'hi', wait: false } as never)
    expect((w.prompts[0] ?? []).filter(text => NUDGE.test(text))).toHaveLength(1)
    expect(nudges(await mainTool($))).toEqual([])
  })
})

describe('I4 nudge_threshold_sources', () => {
  test('uses 90% of autoCompactThreshold when present', async ($, on) => {
    const w = world(on)
    w.threshold = 190_000
    await start($, 'startup', OVERSEER)
    // 76% of the window is past the 75% fallback but under 90% of 190k (171k).
    await measure($, { tokens: 152_000, window: 200_000, percent: 76 })
    expect(nudges(await mainTool($))).toEqual([])
    await measure($, { tokens: 172_000, window: 200_000, percent: 86 })
    expect(nudges(await mainTool($))).toHaveLength(1)
  })

  test('falls back to percent >= 75 without a threshold', async ($, on) => {
    world(on)
    await start($, 'startup', OVERSEER)
    await measure($, { window: 200_000, percent: 74 })
    expect(nudges(await mainTool($))).toEqual([])
    await measure($, { window: 200_000, percent: 75 })
    expect(nudges(await mainTool($))).toHaveLength(1)
  })

  test('does nothing when neither is known', async ($, on) => {
    world(on)
    await start($, 'startup', OVERSEER)
    await measure($, { window: 200_000 })
    expect(nudges(await mainTool($))).toEqual([])
  })

  test('reads the breakdown only on session.measure, never per tool call', async ($, on) => {
    const w = world(on)
    await start($, 'startup', OVERSEER)
    await mainTool($)
    await agentTool($, 'a1')
    expect(w.usageCalls).toBe(0)
    await measure($, { window: 200_000, percent: 10 })
    expect(w.usageCalls).toBe(1)
  })
})

describe('I6 roster_lifecycle', () => {
  test('spawn, finish, fail and wake up, from events alone', async ($, on) => {
    const w = world(on)
    w.agents = null
    await start($, 'startup', OVERSEER)
    await spawn($, 'a1')
    await spawn($, 'a2')
    await spawn($, 'a3')
    expect(await summary($)).toMatchObject({ running: 3 })
    await w.clock.advance(5_000)
    await finish($, 'a1', 'answer', OPUS)
    await finish($, 'a2', 'error')
    await finish($, 'a3', 'aborted')
    expect(await summary($)).toMatchObject({ running: 0, done: 1, failed: 2 })
    expect(await paneTexts($, 80)).toContain('    ✓ worker · a1 · opus-4-5 · 5s')
    await agentTool($, 'a1')
    expect(await summary($)).toMatchObject({ running: 1, done: 0, failed: 2 })
  })

  test('the agent list wins for status, and lists agents spawned before load', async ($, on) => {
    const w = world(on)
    w.agents = [{ id: 'old', description: 'Earlier', type: 'little-planet-factory:researcher', status: 'running' }]
    await start($, 'startup', OVERSEER)
    expect(await paneTexts($)).toContain('    ● researcher · Earlier')
    w.agents = [...w.agents, { id: 'a1', description: 'a1', type: 'little-planet-factory:worker', status: 'completed' }]
    await spawn($, 'a1')
    expect(await summary($)).toMatchObject({ running: 1, done: 1 })
  })

  test('an agent the list prunes keeps its own status, and unknown ids never appear', async ($, on) => {
    const w = world(on)
    w.agents = [
      { id: 'a1', description: 'a1', type: 'little-planet-factory:worker', status: 'running' },
      { id: 'a2', description: 'a2', type: 'little-planet-factory:worker', status: 'running' },
    ]
    await start($, 'startup', OVERSEER)
    await spawn($, 'a1')
    await spawn($, 'a2')
    w.agents = [w.agents[1]!]
    await finish($, 'a1', 'answer', OPUS)
    await finish($, 'compaction-fork', 'answer', OPUS)
    expect(await summary($)).toMatchObject({ running: 1, done: 1 })
    const texts = await paneTexts($, 80)
    expect(texts).toContain('    ✓ worker · a1 · opus-4-5 · 0s')
    expect(texts.some(text => text.includes('compaction-fork'))).toBe(false)
  })

  test('an agent known only from the list records its finished run', async ($, on) => {
    const w = world(on)
    w.agents = [{ id: 'old', description: 'Earlier', type: 'little-planet-factory:researcher', status: 'running' }]
    await start($, 'startup', OVERSEER)
    w.agents = [{ ...w.agents[0]!, status: 'completed' }]
    await finish($, 'old', 'answer', OPUS)
    expect(await paneTexts($, 80)).toContain('    ✓ researcher · Earlier · opus-4-5')
  })

  test('nested managers form a tree and an unknown parent sits at the top', async ($, on) => {
    const w = world(on)
    w.agents = [
      { id: 'm', description: 'Sub-task', type: 'little-planet-factory:manager', status: 'running' },
      { id: 'w1', description: 'Unit', type: 'little-planet-factory:worker', status: 'running', parentId: 'm' },
      { id: 'w2', description: 'Orphan', type: 'little-planet-factory:worker', status: 'running', parentId: 'ghost' },
    ]
    await start($, 'startup', OVERSEER)
    const texts = await paneTexts($)
    const agents = texts.slice(texts.indexOf('  ◉ overseer'), texts.indexOf('Ledger'))
    expect(agents).toEqual(['  ◉ overseer', '    ● manager · Sub-task', '      ● worker · Unit', '    ● worker · Orphan'])
  })
})

describe('I7 survives_reload', () => {
  test('existing state keeps activation, scratchpad and roster; one poll runs', async ($, on) => {
    const w = world(on)
    w.agents = null
    await start($, 'startup', OVERSEER)
    await spawn($, 'a1')
    // A reload runs session.start again; the module's poll guard keeps one timer.
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    expect(await summary($)).toMatchObject({ running: 1 })
    const ledgerReads = () => w.reads.filter(path => path === `${DIR}/factory-ledger.md`).length
    const before = ledgerReads()
    await w.clock.advance(15_000)
    expect(ledgerReads()).toBe(before + 1)
    await w.clock.advance(15_000)
    expect(ledgerReads()).toBe(before + 2)
  })
})

describe('I7 survives_reload (fresh module)', () => {
  test('a module loaded over existing state resumes from session.start with one poll', async ($, on) => {
    const w = world(on)
    w.agents = null
    // The session state a previous load left: this load has run register and
    // nothing else, and reads these back.
    const kept: Record<string, unknown> = {
      session: { active: true, scratchpadDir: DIR },
      details: { a1: { description: 'a1', status: 'running', startedAt: 0 } },
    }
    on('state.get', ($, e, next) => (e.key in kept ? { value: { value: kept[e.key], version: 1 } } : next(e)) as never)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    expect(w.commands).toEqual(['factory'])
    expect(await summary($)).toMatchObject({ running: 1, next: 'Inspect core once it reports.' })
    const before = w.reads.length
    await w.clock.advance(15_000)
    expect(w.reads.length).toBe(before + 1)
  })
})

describe('no status line', () => {
  test('an active session clears the status line on activation and never sets one', async ($, on) => {
    const w = world(on)
    w.agents = [{ id: 'a', description: 'auth', type: 'little-planet-factory:worker', status: 'running' }]
    await start($, 'startup', OVERSEER)
    await measure($, { tokens: 100_000, window: 200_000, percent: 50 }, { rateLimits: [{ kind: 'five_hour', percentUsed: 41 }] })
    await w.clock.advance(15_000)
    expect(w.statuses.length).toBeGreaterThan(0)
    expect(w.statuses.every(text => text === undefined)).toBe(true)
  })
})

describe('refresh writes only what changed', () => {
  test('an unchanged poll writes neither the agent list nor the ledgers', async ($, on) => {
    const w = world(on)
    const writes: string[] = []
    on('state.set', ($, e, next) => (writes.push(e.key), next(e)))
    await start($, 'startup', OVERSEER)
    writes.length = 0
    await w.clock.advance(15_000)
    expect(writes.filter(key => key === 'agents' || key === 'ledgers')).toEqual([])
    w.files[`${DIR}/factory-ledger.md`] = '## Next step\nSomething new\n'
    await w.clock.advance(15_000)
    expect(writes).toContain('ledgers')
    expect((await summary($)).next).toBe('Something new')
  })
})

describe('the poll redraws while agents run', () => {
  for (const [label, status, redraws] of [
    ['a running agent', 'running', 1],
    ['no running agent', 'completed', 0],
  ] as const) {
    test(`${label}: ${redraws} redraw per poll`, async ($, on) => {
      const w = world(on)
      const invalidated: string[] = []
      on('ui.invalidate', ($, e) => (invalidated.push(e.event), { value: undefined }))
      w.agents = [{ id: 'a', description: 'auth', type: 'little-planet-factory:worker', status }]
      await start($, 'startup', OVERSEER)
      await w.clock.advance(15_000)
      expect(invalidated.filter(event => event === 'ui.render')).toHaveLength(redraws)
    })
  }
})

describe('the poll redraws while a reset countdown shows', () => {
  for (const [label, resetsAt, redraws] of [
    ['a 5h limit with a reset time', '2026-10-04T18:00:00.000Z', 1],
    ['a 5h limit with no reset time', undefined, 0],
  ] as const) {
    test(`no running agents and ${label}: ${redraws} redraw per poll`, async ($, on) => {
      const w = world(on)
      const invalidated: string[] = []
      on('ui.invalidate', ($, e) => (invalidated.push(e.event), { value: undefined }))
      w.agents = []
      await start($, 'startup', OVERSEER)
      const limit = { kind: 'five_hour', percentUsed: 41, ...(resetsAt === undefined ? {} : { resetsAt }) }
      await measure($, { window: 200_000, percent: 10 }, { rateLimits: [limit] })
      await w.clock.advance(15_000)
      expect(invalidated.filter(event => event === 'ui.render')).toHaveLength(redraws)
    })
  }
})

describe('I8 session_sources_reseed', () => {
  test('clear resets the roster and re-reads the scratchpad', async ($, on) => {
    const w = world(on)
    w.agents = null
    await start($, 'startup', OVERSEER)
    await spawn($, 'a1')
    w.files['/scratch/s2/factory-ledger.md'] = '## Next step\nFresh start\n'
    await start($, 'clear', OVERSEER, '/scratch/s2')
    expect(await summary($)).toMatchObject({ running: 0, next: 'Fresh start' })
    expect(w.reads).toContain('/scratch/s2/factory-ledger.md')
  })

  for (const source of ['resume', 'fork', 'compact'] as const) {
    test(`${source} moves to the new scratchpad and keeps activation and roster`, async ($, on) => {
      const w = world(on)
      w.agents = null
      await start($, 'startup', OVERSEER)
      await spawn($, 'a1')
      w.files['/scratch/s3/factory-ledger.md'] = '## Next step\nCarry on\n'
      await start($, source, OVERSEER, '/scratch/s3')
      expect(await summary($)).toMatchObject({ running: 1, next: 'Carry on' })
    })
  }
})

describe('I9 reads_only_inside_scratchpad', () => {
  test('reads the ledger and exact manager-ledger names only, and writes nothing', async ($, on) => {
    const w = world(on)
    w.files = {
      [`${DIR}/factory-ledger.md`]: LEDGER,
      [`${DIR}/factory-ledger-api.md`]: '## Next step\nWire the API\n',
      [`${DIR}/factory-ledger-.md`]: 'no slug',
      [`${DIR}/factory-ledger-x.md.bak`]: 'backup',
      [`${DIR}/notes.md`]: 'notes',
      '/elsewhere/factory-ledger.md': 'outside',
    }
    await start($, 'startup', OVERSEER)
    expect([...new Set(w.reads)].sort()).toEqual([`${DIR}/factory-ledger-api.md`, `${DIR}/factory-ledger.md`])
    expect([...new Set(w.lists)]).toEqual([DIR])
    expect(w.writes).toEqual([])
    expect(await paneTexts($)).toContain('  manager api: Wire the API')
  })
})

describe('I9 reads_only_inside_scratchpad (symlinks)', () => {
  test('a ledger that resolves outside the scratchpad is never read', async ($, on) => {
    const w = world(on)
    w.files = { '/elsewhere/secret.md': '## Next step\nLeaked\n', [`${DIR}/notes.md`]: 'notes' }
    w.links = { [`${DIR}/factory-ledger.md`]: '/elsewhere/secret.md', [`${DIR}/factory-ledger-evil.md`]: '/elsewhere/secret.md' }
    await start($, 'startup', OVERSEER)
    expect(w.reads).toEqual([])
    expect((await summary($)).next).toBeUndefined()
    const texts = await paneTexts($)
    expect(texts).toContain('  No factory ledger yet.')
    expect(texts.join('\n')).not.toMatch(/Leaked|evil/)
  })

  test('a symlink to a file inside the scratchpad is read, as factory-ledger.mjs allows', async ($, on) => {
    const w = world(on)
    w.files = { [`${DIR}/ledger-v2.md`]: '## Next step\nFrom the link\n', [`${DIR}/api-ledger.md`]: '## Next step\nWire the API\n' }
    w.links = { [`${DIR}/factory-ledger.md`]: `${DIR}/ledger-v2.md`, [`${DIR}/factory-ledger-api.md`]: `${DIR}/api-ledger.md` }
    await start($, 'startup', OVERSEER)
    expect([...new Set(w.reads)].sort()).toEqual([`${DIR}/api-ledger.md`, `${DIR}/ledger-v2.md`])
    expect((await summary($)).next).toBe('From the link')
    expect(await paneTexts($)).toContain('  manager api: Wire the API')
  })

  test('a scratchpad reached through a symlinked directory still reads its ledger', async ($, on) => {
    const w = world(on)
    w.files = { [`/private${DIR}/factory-ledger.md`]: '## Next step\nThrough /private\n' }
    w.links = { '/scratch': '/private/scratch' }
    await start($, 'startup', OVERSEER)
    expect(w.reads).toEqual([`/private${DIR}/factory-ledger.md`])
    expect((await summary($)).next).toBe('Through /private')
  })
})

describe('I9 reads_only_inside_scratchpad (Windows paths)', () => {
  const WIN = 'C:\\Users\\k\\scratch'

  test('a backslash realPath directly inside the scratchpad is read', async ($, on) => {
    const w = world(on)
    w.files = { [`${WIN}\\factory-ledger.md`]: '## Next step\nOn Windows\n' }
    w.realPaths = { [WIN]: `${WIN}\\`, [`${WIN}/factory-ledger.md`]: `${WIN}\\factory-ledger.md` }
    await start($, 'startup', OVERSEER, WIN)
    expect(w.reads).toEqual([`${WIN}\\factory-ledger.md`])
    expect((await summary($)).next).toBe('On Windows')
  })

  test('a backslash realPath outside the scratchpad is not read', async ($, on) => {
    const w = world(on)
    w.files = { 'C:\\Users\\k\\other\\factory-ledger.md': '## Next step\nLeaked\n' }
    w.realPaths = { [WIN]: WIN, [`${WIN}/factory-ledger.md`]: 'C:\\Users\\k\\other\\factory-ledger.md' }
    await start($, 'startup', OVERSEER, WIN)
    expect(w.stats).toContain(`${WIN}/factory-ledger.md`)
    expect(w.reads).toEqual([])
    expect(await paneTexts($)).toContain('  No factory ledger yet.')
  })
})

describe('I10 missing_usage_fields', () => {
  test('unknown usage leaves its segments out, never NaN or undefined', async ($, on) => {
    const w = world(on)
    w.files = {}
    await start($, 'startup', OVERSEER)
    await measure($, { window: 200_000 })
    expect(await summary($)).toMatchObject({ ctx: undefined, fiveHour: undefined })
    const texts = await paneTexts($)
    expect(texts).toContain('  no usage reported yet')
    expect(texts.join('\n')).not.toMatch(/NaN|undefined/)
  })

  test('a rate limit without a reset time and no cost', async ($, on) => {
    const w = world(on)
    w.files = {}
    await start($, 'startup', OVERSEER)
    await measure($, { tokens: 50_000, window: 200_000 }, { rateLimits: [{ kind: 'five_hour', percentUsed: 41 }] })
    expect(await summary($)).toMatchObject({ ctx: '25%', fiveHour: '41%', next: undefined })
    const texts = await paneTexts($)
    expect(texts).toContain('  context ███░░░░░░░ 25% · 50.0k / 200.0k tokens')
    expect(texts).toContain('  5h ████░░░░░░ 41%')
    expect(texts.join('\n')).not.toMatch(/NaN|undefined|cost/)
  })

  test('the full usage section', async ($, on) => {
    const w = world(on)
    w.threshold = 180_000
    await start($, 'startup', OVERSEER)
    await measure(
      $,
      { tokens: 124_000, window: 200_000, percent: 62 },
      {
        rateLimits: [
          { kind: 'five_hour', percentUsed: 41, resetsAt: new Date(1_000_000 + 2 * 3_600_000 + 600_000).toISOString() },
          { kind: 'seven_day', percentUsed: 12.5 },
        ],
        cost: { usd: 3.2 },
      },
    )
    expect(await summary($)).toMatchObject({ ctx: '62%', fiveHour: '41%', next: 'Inspect core once it reports.' })
    const texts = await paneTexts($, 100)
    expect(texts.slice(0, 5)).toEqual([
      'Usage',
      '  context ██████░░░░ 62% · 124.0k / 200.0k tokens · 56.0k left before auto-compaction',
      '  5h ████░░░░░░ 41% · resets in 2h10m',
      '  7d █░░░░░░░░░ 13%',
      '  cost $3.20',
    ])
    expect(texts.slice(texts.indexOf('Ledger'))).toEqual([
      'Ledger',
      '  status active',
      '  next: Inspect core once it reports.',
      '  open questions: 1',
      '    Which base branch?',
      '  units: 1 mid-edit · 1 done',
      '  background:',
      '    PR watch task bg7',
    ])
  })
})

describe('I11 render_fits_width', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`no line exceeds bodyColumns and every Text stays under 10,000 characters on ${surface}`, async ($, on) => {
      const w = world(on)
      const long = 'y'.repeat(12_000)
      w.files[`${DIR}/factory-ledger.md`] = `${LEDGER}\n## Open questions for the user\n${long}\n`
      w.agents = [{ id: 'a1', description: long, type: 'little-planet-factory:worker', status: 'running' }]
      await start($, 'startup', OVERSEER)
      for (const columns of [12, 40, 20_000]) {
        const texts = await paneTexts($, columns, surface)
        expect(texts.length).toBeGreaterThan(10)
        for (const text of texts) {
          expect([...text].length).toBeLessThanOrEqual(columns)
          expect(text.length).toBeLessThan(10_000)
        }
      }
    })
  }

  test('/factory opens the pane', async ($, on) => {
    const w = world(on)
    await start($, 'startup', OVERSEER)
    expect(w.commands).toContain('factory')
    expect(await $.command.run({ command: 'factory' } as never)).toEqual({})
  })
})
