// The mod driven through the engine: the test's hooks stand for the engine
// beneath the plugin (tool results, agent list, files, usage).

import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'little-planet-factory'
const OVERSEER = 'little-planet-factory:overseer'
const DIR = '/scratch/s1'
const LEDGER = `# Factory ledger
Status: active
## Units
- core; worker; state: mid-edit
- readme; worker; state: done
## Background work
- PR watch task bg7
## Open questions for the user
- Which base branch?
## Next step
Inspect core once it reports.
`
const NUDGE = /^Factory mod: context is at \d+% and auto-compaction is near\./
const OPUS = { model: 'claude-opus-4-5', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 8000, cache_creation_input_tokens: 500 }

type Agent = { id: string; description: string; type: string; status: string; parentId?: string }

// The world beneath the plugin, editable by each test. `links` maps a
// symlink's path to its target, a file or a directory.
function world(on: On) {
  const w = {
    clock: mock.clock(on, { now: 1_000_000 }),
    statuses: [] as (string | undefined)[],
    files: { [`${DIR}/factory-ledger.md`]: LEDGER } as Record<string, string>,
    links: {} as Record<string, string>,
    // What fs.stat reports as realPath for a path, verbatim (native Windows spellings).
    realPaths: {} as Record<string, string>,
    reads: [] as string[],
    stats: [] as string[],
    lists: [] as string[],
    writes: [] as string[],
    commands: [] as string[],
    agents: [] as Agent[] | null,
    usageCalls: 0,
    threshold: undefined as number | undefined,
    toolResult: { result: 'ok', text: 'ok' } as object,
    toolThrows: false,
    listFails: false,
    promptAnswer: 'enter' as 'enter' | 'drop' | 'throw',
    prompts: [] as (readonly string[] | undefined)[],
    status: () => w.statuses[w.statuses.length - 1],
  }
  const resolve = (path: string): string => {
    const link = w.links[path]
    if (link !== undefined) return resolve(link)
    const dir = Object.keys(w.links).find(key => path.startsWith(`${key}/`))
    return dir === undefined ? path : resolve(`${w.links[dir]}${path.slice(dir.length)}`)
  }
  // This host (POSIX) makes a Windows spelling relative to the cwd before a
  // hook sees it; strip that back to what a Windows host would pass.
  const native = (path: string): string => path.slice(Math.max(0, path.indexOf('C:\\')))
  const children = (dir: string) =>
    Object.keys(w.files)
      .filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/'))
      .map(path => path.slice(dir.length + 1))
  on('ui.status', ($, e) => (w.statuses.push(e.text), { value: undefined }))
  on('command.register', ($, e) => (w.commands.push(e.name), { value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', ($, e) => {
    const path = native(e.path)
    w.reads.push(path)
    const text = w.files[resolve(path)]
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.stat', ($, e) => {
    const path = native(e.path)
    w.stats.push(path)
    const reported = w.realPaths[path]
    const realPath = reported ?? resolve(path)
    const kind =
      w.files[realPath] !== undefined ? 'file' : reported !== undefined || children(realPath).length > 0 ? 'dir' : undefined
    if (kind === undefined) throw new Error(`ENOENT: ${path}`)
    const isLink = w.links[path] !== undefined
    return { value: { kind, size: 1, mtimeMs: 0, isLink, ...(e.resolve ? { realPath } : {}) } }
  })
  on('fs.list', ($, e) => {
    w.lists.push(e.path)
    if (w.listFails) throw new Error('EACCES')
    const files = children(resolve(e.path)).map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }))
    const links = Object.keys(w.links)
      .filter(path => path.startsWith(`${e.path}/`) && !path.slice(e.path.length + 1).includes('/'))
      .map(path => ({ name: path.slice(e.path.length + 1), kind: 'other' as const, size: 0, mtimeMs: 0, isLink: true }))
    return { value: [...files, ...links] }
  })
  on('fs.write', ($, e) => (w.writes.push(e.path), { value: undefined }))
  on('agent.list', () => {
    if (w.agents === null) throw new Error('no agent list')
    return { value: w.agents }
  })
  on('session.usage', () => {
    w.usageCalls += 1
    return {
      value: {
        startedAt: 0,
        context: { window: 200_000, breakdown: { autoCompactThreshold: w.threshold, isAutoCompactEnabled: true } },
        rateLimits: [],
      } as never,
    }
  })
  on('classic.SessionStart', () => ({}))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('tool.call', () => {
    if (w.toolThrows) throw new Error('tool crashed')
    return w.toolResult as never
  })
  on('agent.spawn', ($, e) => ({ model: 'claude-opus-4-5', agentId: e.description }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', ($, e) => {
    w.prompts.push(e.context)
    if (w.promptAnswer === 'throw') throw new Error('prompt crashed')
    return w.promptAnswer === 'drop' ? { drop: 'blocked by a settings hook' } : { text: e.text, context: e.context }
  })
  return w
}

const start = ($: Engine, source: 'startup' | 'resume' | 'clear' | 'compact' | 'fork', agentType?: string, dir = DIR) =>
  $.classic.SessionStart({ source, agent_type: agentType, scratchpad_dir: dir } as never)

const measure = ($: Engine, context: { tokens?: number; window: number; percent?: number }, rest: object = {}) =>
  $.session.measure({ context, rateLimits: [], changed: ['context'], ...rest } as never)

const mainTool = ($: Engine) => $.tool.call({ tool: 'Bash', command: 'ls' } as never)
const agentTool = ($: Engine, agentId: string) => $.tool.call({ tool: 'Bash', command: 'ls', agentId } as never)

const nudges = (result: unknown) => ((result as { context?: string[] }).context ?? []).filter(text => NUDGE.test(text))

const finish = ($: Engine, agentId: string | undefined, reason: 'answer' | 'error' | 'aborted', usage?: typeof OPUS) =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId: 't', agentId, reason, usage } as never)

const spawn = ($: Engine, description: string) =>
  $.agent.spawn({ prompt: 'p', description, subagentType: 'little-planet-factory:worker' } as never)

const PANE_PROPS = (bodyColumns: number) => ({
  title: 'Factory',
  isFocused: false,
  bodyColumns,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
})

async function paneTexts($: Engine, bodyColumns = 60, surface: 'terminal' | 'desktop' = 'terminal'): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'factory', props: PANE_PROPS(bodyColumns) })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  await ui.unmount()
  return texts
}

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
    expect(w.status()).toBe('1 running · ctx 50%')
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
    expect(w.status()).toBe('next: Inspect core once it reports.')
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
    expect(w.status()).toMatch(/^3 running/)
    await w.clock.advance(5_000)
    await finish($, 'a1', 'answer', OPUS)
    await finish($, 'a2', 'error')
    await finish($, 'a3', 'aborted')
    expect(w.status()).toMatch(/^1 done · 2 failed/)
    expect(await paneTexts($, 80)).toContain('    ✓ worker · a1 · opus-4-5 · 5s · 10.0k tok')
    await agentTool($, 'a1')
    expect(w.status()).toMatch(/^1 running · 2 failed/)
  })

  test('the agent list wins for status, and lists agents spawned before load', async ($, on) => {
    const w = world(on)
    w.agents = [{ id: 'old', description: 'Earlier', type: 'little-planet-factory:researcher', status: 'running' }]
    await start($, 'startup', OVERSEER)
    expect(await paneTexts($)).toContain('    ● researcher · Earlier')
    w.agents = [...w.agents, { id: 'a1', description: 'a1', type: 'little-planet-factory:worker', status: 'completed' }]
    await spawn($, 'a1')
    expect(w.status()).toMatch(/^1 running · 1 done/)
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
    expect(w.status()).toMatch(/^1 running · 1 done ·/)
    const texts = await paneTexts($, 80)
    expect(texts).toContain('    ✓ worker · a1 · opus-4-5 · 0s · 10.0k tok')
    expect(texts.some(text => text.includes('compaction-fork'))).toBe(false)
  })

  test('an agent known only from the list records its finished run', async ($, on) => {
    const w = world(on)
    w.agents = [{ id: 'old', description: 'Earlier', type: 'little-planet-factory:researcher', status: 'running' }]
    await start($, 'startup', OVERSEER)
    w.agents = [{ ...w.agents[0]!, status: 'completed' }]
    await finish($, 'old', 'answer', OPUS)
    expect(await paneTexts($, 80)).toContain('    ✓ researcher · Earlier · opus-4-5 · 10.0k tok')
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
    const agents = texts.slice(texts.indexOf('  overseer'), texts.indexOf('Ledger'))
    expect(agents).toEqual(['  overseer', '    ● manager · Sub-task', '      ● worker · Unit', '    ● worker · Orphan'])
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
    expect(w.status()).toMatch(/^1 running/)
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
    expect(w.status()).toBe('1 running · next: Inspect core once it reports.')
    const before = w.reads.length
    await w.clock.advance(15_000)
    expect(w.reads.length).toBe(before + 1)
  })
})

describe('I8 session_sources_reseed', () => {
  test('clear resets the roster and re-reads the scratchpad', async ($, on) => {
    const w = world(on)
    w.agents = null
    await start($, 'startup', OVERSEER)
    await spawn($, 'a1')
    w.files['/scratch/s2/factory-ledger.md'] = '## Next step\nFresh start\n'
    await start($, 'clear', OVERSEER, '/scratch/s2')
    expect(w.status()).toBe('next: Fresh start')
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
      expect(w.status()).toBe('1 running · next: Carry on')
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
    expect(w.status()).toBeUndefined()
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
    expect(w.status()).toBe('next: From the link')
    expect(await paneTexts($)).toContain('  manager api: Wire the API')
  })

  test('a scratchpad reached through a symlinked directory still reads its ledger', async ($, on) => {
    const w = world(on)
    w.files = { [`/private${DIR}/factory-ledger.md`]: '## Next step\nThrough /private\n' }
    w.links = { '/scratch': '/private/scratch' }
    await start($, 'startup', OVERSEER)
    expect(w.reads).toEqual([`/private${DIR}/factory-ledger.md`])
    expect(w.status()).toBe('next: Through /private')
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
    expect(w.status()).toBe('next: On Windows')
  })

  test('a backslash realPath outside the scratchpad is not read', async ($, on) => {
    const w = world(on)
    w.files = { 'C:\\Users\\k\\other\\factory-ledger.md': '## Next step\nLeaked\n' }
    w.realPaths = { [WIN]: WIN, [`${WIN}/factory-ledger.md`]: 'C:\\Users\\k\\other\\factory-ledger.md' }
    await start($, 'startup', OVERSEER, WIN)
    expect(w.stats).toContain(`${WIN}/factory-ledger.md`)
    expect(w.reads).toEqual([])
    expect(w.status()).toBeUndefined()
  })
})

describe('I10 missing_usage_fields', () => {
  test('unknown usage leaves its segments out, never NaN or undefined', async ($, on) => {
    const w = world(on)
    w.files = {}
    await start($, 'startup', OVERSEER)
    await measure($, { window: 200_000 })
    expect(w.status()).toBeUndefined()
    const texts = await paneTexts($)
    expect(texts).toContain('  no usage reported yet')
    expect(texts.join('\n')).not.toMatch(/NaN|undefined/)
  })

  test('a rate limit without a reset time and no cost', async ($, on) => {
    const w = world(on)
    w.files = {}
    await start($, 'startup', OVERSEER)
    await measure($, { tokens: 50_000, window: 200_000 }, { rateLimits: [{ kind: 'five_hour', percentUsed: 41 }] })
    expect(w.status()).toBe('ctx 25% · 5h 41%')
    const texts = await paneTexts($)
    expect(texts).toContain('  context 25% · 50.0k / 200.0k tokens')
    expect(texts).toContain('  5h 41%')
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
    expect(w.status()).toBe('ctx 62% · 5h 41% · next: Inspect core once it reports.')
    const texts = await paneTexts($, 100)
    expect(texts.slice(0, 5)).toEqual([
      'Usage',
      '  context 62% · 124.0k / 200.0k tokens · 56.0k left before auto-compaction',
      '  5h 41% · resets in 2h10m',
      '  7d 13%',
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
