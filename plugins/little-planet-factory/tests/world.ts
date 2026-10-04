// The world beneath the plugin for the mod's engine-level tests: the test's
// hooks stand for the engine (tool results, agent list, files, usage).

import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

export const PLUGIN = 'little-planet-factory'
export const OVERSEER = 'little-planet-factory:overseer'
export const DIR = '/scratch/s1'
export const LEDGER = `# Factory ledger
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
export const NUDGE = /^Factory mod: context is at \d+% and auto-compaction is near\./
export const OPUS = { model: 'claude-opus-4-5', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 8000, cache_creation_input_tokens: 500 }

export type Agent = { id: string; description: string; type: string; status: string; parentId?: string }

// The world beneath the plugin, editable by each test. `links` maps a
// symlink's path to its target, a file or a directory.
export function world(on: On) {
  const w = {
    clock: mock.clock(on, { now: 1_000_000 }),
    statuses: [] as (string | undefined)[],
    toasts: [] as string[],
    opened: [] as string[],
    spawned: [] as string[],
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
  on('ui.toast', ($, e) => (w.toasts.push(e.text), { value: undefined }))
  on('command.register', ($, e) => (w.commands.push(e.name), { value: { command: e.name } }))
  on('ui.open', ($, e) => (w.opened.push(e.id), { value: { isPlaced: true } }))
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
    // Cast: the status union differs between Claude Code builds.
    return { value: w.agents as never }
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
  on('agent.spawn', ($, e) => (w.spawned.push(e.tool_use_id), { model: 'claude-opus-4-5', agentId: e.description }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', ($, e) => {
    w.prompts.push(e.context)
    if (w.promptAnswer === 'throw') throw new Error('prompt crashed')
    return w.promptAnswer === 'drop' ? { drop: 'blocked by a settings hook' } : { text: e.text, context: e.context }
  })
  return w
}

export const start = ($: Engine, source: 'startup' | 'resume' | 'clear' | 'compact' | 'fork', agentType?: string, dir = DIR) =>
  $.classic.SessionStart({ source, agent_type: agentType, scratchpad_dir: dir } as never)

export const measure = ($: Engine, context: { tokens?: number; window: number; percent?: number }, rest: object = {}) =>
  $.session.measure({ context, rateLimits: [], changed: ['context'], ...rest } as never)

export const mainTool = ($: Engine) => $.tool.call({ tool: 'Bash', command: 'ls' } as never)
export const agentTool = ($: Engine, agentId: string) => $.tool.call({ tool: 'Bash', command: 'ls', agentId } as never)

export const nudges = (result: unknown) => ((result as { context?: string[] }).context ?? []).filter(text => NUDGE.test(text))

export const finish = ($: Engine, agentId: string | undefined, reason: 'answer' | 'error' | 'aborted', usage?: typeof OPUS) =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId: 't', agentId, reason, usage } as never)

export const spawn = ($: Engine, description: string) =>
  $.agent.spawn({ prompt: 'p', description, subagentType: 'little-planet-factory:worker', tool_use_id: `tu-${description}` } as never)

export const PANE_PROPS = (bodyColumns: number) => ({
  title: 'Factory',
  isFocused: false,
  bodyColumns,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
})

export async function paneTexts($: Engine, bodyColumns = 60, surface: 'terminal' | 'desktop' = 'terminal'): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'factory', props: PANE_PROPS(bodyColumns) })
  const texts = (await ui.findAll({ type: 'Box' })).filter(found => found.key?.startsWith('line-')).map(found => found.text)
  await ui.unmount()
  return texts
}


// What the pane says, in brief: agents by status, the next step, and the
// context and 5h figures, each undefined when the pane shows none.
export async function summary($: Engine) {
  const texts = await paneTexts($, 200)
  const agents = texts.slice(texts.indexOf('Agents') + 2, texts.indexOf('Ledger'))
  const count = (mark: string) => agents.filter(text => text.trimStart().startsWith(mark)).length
  const pick = (pattern: RegExp) => texts.map(text => pattern.exec(text)?.[1]).find(value => value !== undefined)
  return {
    running: count('●'),
    done: count('✓'),
    failed: count('✗'),
    next: pick(/^  next: (.*)$/),
    ctx: pick(/^  context [█░]* ?(\d+%)/),
    fiveHour: pick(/^  5h [█░]* ?(\d+%)/),
  }
}
