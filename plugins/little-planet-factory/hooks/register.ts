// The factory status mod: in a factory overseer session it draws a band
// above the prompt, puts a summary card above Agent rows, adds a summary to the
// spinner, shows toasts, opens a /factory pane (usage, agents, ledger), and
// tells the overseer once to update its ledger when auto-compaction is near.
//
// Read-only: it reads the ledgers in the session's scratchpad and never
// writes a file. In any other session it shows nothing and injects nothing.
// Every chain hook returns what `next` resolved, adding only the nudge's
// context.

import { update } from 'claude-code'
import type { BoxProps, ElementConstructor, EngineInterface, Register, RenderElement, TextProps, Timer } from 'claude-code'

import type { FactoryLedgers, FactoryUsage } from '../types'
import { parseLedger } from './mod/ledger'
import { ARMED, nextLimit, nextNudge, nudgeText } from './mod/nudge'
import { endStatus, mergeRoster, requestTokens } from './mod/roster'
import type { Row } from './mod/style'
import { COLOR, rowsOf, seg } from './mod/style'
import type { View } from './mod/view'
import {
  agentRow,
  bandLayout,
  COLLAPSE_COLUMNS,
  finishToast,
  limitToast,
  MAX_ROW_COLUMNS,
  paneRows,
  spinnerSummary,
} from './mod/view'

const OVERSEER = 'little-planet-factory:overseer'
const PANE = 'factory'
const POLL_MS = 15_000
const LEDGER = 'factory-ledger.md'
const MANAGER_LEDGER = /^factory-ledger-([A-Za-z0-9._-]+)\.md$/

// Either separator, so native Windows paths compare too.
const trimSeparators = (path: string): string => path.replace(/[\\/]+$/, '')
const parentOf = (path: string): string => trimSeparators(path.replace(/[\\/][^\\/]*$/, ''))

const SESSION = { plugin: 'little-planet-factory', key: 'session' } as const
const AGENTS = { plugin: 'little-planet-factory', key: 'agents' } as const
const DETAILS = { plugin: 'little-planet-factory', key: 'details' } as const
const USAGE = { plugin: 'little-planet-factory', key: 'usage' } as const
const LEDGERS = { plugin: 'little-planet-factory', key: 'ledgers' } as const
const NUDGE = { plugin: 'little-planet-factory', key: 'nudge' } as const
const STEP_TOKENS = { plugin: 'little-planet-factory', key: 'stepTokens' } as const
const LIMITS = { plugin: 'little-planet-factory', key: 'limits' } as const
const LIMIT_KINDS = ['five_hour', 'seven_day']

const NO_USAGE: FactoryUsage = { rateLimits: [] }
const NO_LEDGERS: FactoryLedgers = { main: null, managers: [] }

type Engine = EngineInterface

type Kit = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

// One row of styled segments as a Box holding one truncating Text, with an
// optional element (the band's Button) at its right.
function rowElement({ Box, Text }: Kit, row: Row, key: string, end?: RenderElement): RenderElement {
  const text = Text({
    wrap: 'truncate-end',
    children: row.map(part =>
      part.color === undefined && part.dim === undefined && part.bold === undefined
        ? part.text
        : Text({
            ...(part.color === undefined ? {} : { color: part.color }),
            ...(part.dim === undefined ? {} : { dimColor: true }),
            ...(part.bold === undefined ? {} : { bold: true }),
            children: part.text,
          }),
    ),
  })
  return end === undefined ? Box({ key, children: text }) : Box({ key, justifyContent: 'space-between', children: [text, end] })
}

const isSame = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

const isActive = async ($: Engine): Promise<boolean> => (await $.state.get(SESSION)).value?.active === true

// Only the overseer's ledger and exact manager-ledger names from a
// non-recursive listing of the scratchpad are read, and only when the name
// resolves to a regular file directly inside the scratchpad, both resolved
// the same way. A symlink to a file in the scratchpad is read, as
// factory-ledger.mjs allows; one that leads anywhere else is not.
async function readLedgers($: Engine, scratchpadDir: string | null): Promise<FactoryLedgers> {
  if (scratchpadDir === null) return NO_LEDGERS
  const dir = trimSeparators(scratchpadDir)
  const resolved = (await $.fs.stat(dir, { resolve: true }).catch(() => undefined))?.realPath
  if (resolved === undefined) return NO_LEDGERS
  const root = trimSeparators(resolved)
  const read = async (name: string) => {
    const target = (await $.fs.stat(`${dir}/${name}`, { resolve: true }).catch(() => undefined))
    const realPath = target?.kind === 'file' ? target.realPath : undefined
    if (realPath === undefined || parentOf(realPath) !== root) return null
    return $.fs.read(realPath).then(parseLedger, () => null)
  }
  const [main, entries] = await Promise.all([read(LEDGER), $.fs.list(dir).catch(() => [])])
  const names = entries
    .filter(entry => entry.kind !== 'dir' && MANAGER_LEDGER.test(entry.name))
    .map(entry => entry.name)
    .sort()
  const managers = await Promise.all(
    names.map(async name => {
      const ledger = await read(name)
      const slug = MANAGER_LEDGER.exec(name)![1]!
      return ledger === null ? [] : [ledger.next === undefined ? { slug } : { slug, next: ledger.next }]
    }),
  )
  return { main, managers: managers.flat() }
}

async function view($: Engine): Promise<View> {
  const [agents, details, usage, ledgers, now] = await Promise.all([
    $.state.get(AGENTS),
    $.state.get(DETAILS),
    $.state.get(USAGE),
    $.state.get(LEDGERS),
    $.clock.now(),
  ])
  return {
    roster: mergeRoster(agents.value ?? null, details.value ?? {}),
    usage: usage.value ?? NO_USAGE,
    ledgers: ledgers.value ?? NO_LEDGERS,
    now,
  }
}


async function refresh($: Engine): Promise<void> {
  const session = (await $.state.get(SESSION)).value
  if (session?.active !== true) return
  const [agents, ledgers] = await Promise.all([
    $.agent.list().then(
      list =>
        list.map(({ id, description, type, status, parentId }) =>
          parentId === undefined ? { id, description, type, status } : { id, description, type, status, parentId },
        ),
      () => null,
    ),
    readLedgers($, session.scratchpadDir),
  ])
  // An unchanged value isn't written, so its readers aren't drawn again.
  const [currentAgents, currentLedgers] = await Promise.all([$.state.get(AGENTS), $.state.get(LEDGERS)])
  await Promise.all([
    isSame(currentAgents.value, agents) ? undefined : $.state.set(AGENTS, agents),
    isSame(currentLedgers.value, ledgers) ? undefined : $.state.set(LEDGERS, ledgers),
  ])
}

// The poll: unchanged values aren't written, so while an agent runs the
// drawings are asked to redraw anyway, to move its elapsed time on.
async function tick($: Engine): Promise<void> {
  await refresh($)
  await foldStepTokens($)
  // Elapsed times and reset countdowns move with the clock, not with state.
  const { roster, usage } = await view($)
  if (roster.some(entry => entry.status === 'running') || usage.rateLimits.some(limit => limit.resetsAt !== undefined)) {
    $.ui.invalidate('ui.render')
  }
}

// A step's token figure goes to a key no drawing reads, so a subagent's
// requests don't redraw anything; the poll and turn.complete fold it in.
async function recordStep($: Engine, agentId: string, tokens: number): Promise<void> {
  if (await isActive($)) await update($, STEP_TOKENS, steps => ({ ...steps, [agentId]: tokens }))
}

// Moves the steps' figures into the agents' details, for agents the mod knows
// (the engine's own forks are dropped), writing only what changed.
async function foldStepTokens($: Engine): Promise<void> {
  const steps = (await $.state.get(STEP_TOKENS)).value ?? {}
  const ids = Object.keys(steps)
  if (ids.length === 0) return
  const listed = new Set(((await $.state.get(AGENTS)).value ?? []).map(agent => agent.id))
  const details = (await $.state.get(DETAILS)).value ?? {}
  const changed = ids.filter(id => (details[id] !== undefined || listed.has(id)) && details[id]?.tokens !== steps[id])
  if (changed.length > 0) {
    await update($, DETAILS, current => ({
      ...current,
      ...Object.fromEntries(changed.map(id => [id, { ...current?.[id], tokens: steps[id]! }])),
    }))
  }
  // A step recorded since the read stays for the next fold.
  await update($, STEP_TOKENS, current => Object.fromEntries(Object.entries(current ?? {}).filter(([id, tokens]) => steps[id] !== tokens)))
}

// Records an agent's token figure, for an agent the mod knows: one it saw
// spawn or the agent list names (the engine's own forks are neither). Used
// for a completed Agent result's own total, which is rare.
async function setAgentTokens($: Engine, agentId: string, tokens: number): Promise<void> {
  const isListed = (await $.state.get(AGENTS)).value?.some(agent => agent.id === agentId) === true
  await update($, DETAILS, details => {
    const detail = details?.[agentId]
    return detail === undefined && !isListed ? (details ?? {}) : { ...details, [agentId]: { ...detail, tokens } }
  })
}

// A completed foreground Agent call carries Claude Code's own `totalTokens`;
// it wins over what the mod worked out from the steps.
async function recordEngineTokens($: Engine, record: unknown): Promise<void> {
  const { status, agentId, totalTokens } = (record ?? {}) as { status?: unknown; agentId?: unknown; totalTokens?: unknown }
  if (status === 'completed' && typeof agentId === 'string' && typeof totalTokens === 'number') {
    await setAgentTokens($, agentId, totalTokens)
  }
}

// Takes a pending nudge for delivery; undefined when none is pending.
async function claimNudge($: Engine): Promise<number | undefined> {
  if ((await $.state.get(NUDGE)).value?.phase !== 'pending') return undefined
  let claimed: number | undefined
  await update($, NUDGE, nudge => {
    claimed = nudge?.phase === 'pending' ? nudge.percent : undefined
    return claimed === undefined ? (nudge ?? ARMED) : { phase: 'fired' as const, percent: claimed }
  })
  return claimed
}

// Puts back a nudge whose delivery didn't happen, unless something has
// changed it since it was claimed.
async function unclaimNudge($: Engine, percent: number): Promise<void> {
  await update($, NUDGE, nudge =>
    nudge?.phase === 'fired' && nudge.percent === percent ? { phase: 'pending' as const, percent } : (nudge ?? ARMED),
  )
}

async function openPane($: Engine) {
  return $.ui.open({ id: PANE, title: 'Factory', closeOnEscape: true })
}

// A reload cancels the old module's timers and loads this at undefined, so
// one poll runs per load.
let poll: Timer | undefined

async function activate($: Engine): Promise<void> {
  // Clears a status line an older version of the mod left.
  $.ui.status(undefined)
  poll ??= $.clock.every(POLL_MS, () => void tick($).catch(() => undefined))
  await $.command.register({ name: 'factory', description: 'Show factory status: usage, agents, and the ledger' })
  await refresh($)
}

export const register: Register = on => {
  // Fires at load and at every reload, not after /clear. With the state kept
  // from before a reload, the session picks up where it was.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    if (await isActive($)) await activate($)
    return result
  })

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.agent_id !== undefined) return result
    if (e.agent_type !== OVERSEER) {
      poll?.cancel()
      poll = undefined
      await $.state.set(SESSION, { active: false, scratchpadDir: null })
      $.ui.status(undefined)
      return result
    }
    // Every classic event but PreToolUse carries scratchpad_dir; the types
    // don't declare it.
    const scratchpadDir = (e as { scratchpad_dir?: unknown }).scratchpad_dir
    if (e.source === 'clear') {
      await Promise.all([
        $.state.set(AGENTS, null),
        $.state.set(DETAILS, {}),
        $.state.set(USAGE, NO_USAGE),
        $.state.set(LEDGERS, NO_LEDGERS),
        $.state.set(NUDGE, ARMED),
        $.state.set(STEP_TOKENS, {}),
      ])
      // Rate limits are the account's, so their toasts aren't re-armed here.
    }
    if (e.source === 'compact') await $.state.set(NUDGE, ARMED)
    await $.state.set(SESSION, {
      active: true,
      scratchpadDir: typeof scratchpadDir === 'string' && scratchpadDir !== '' ? scratchpadDir : null,
    })
    await activate($)
    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (!(await isActive($))) return result
    // The threshold comes from the local estimate, which sends no request.
    const autoCompactThreshold = e.changed.includes('context')
      ? (await $.session.usage({ breakdown: 'summary' }).catch(() => undefined))?.context.breakdown?.autoCompactThreshold
      : (await $.state.get(USAGE)).value?.autoCompactThreshold
    const usage: FactoryUsage = {
      context: e.context,
      rateLimits: e.rateLimits,
      ...(e.cost === undefined ? {} : { costUsd: e.cost.usd }),
      ...(autoCompactThreshold === undefined ? {} : { autoCompactThreshold }),
    }
    await $.state.set(USAGE, usage)
    await update($, NUDGE, nudge => nextNudge(nudge ?? ARMED, usage))
    const limits = { ...(await $.state.get(LIMITS)).value }
    const now = await $.clock.now()
    for (const reading of e.rateLimits.filter(one => LIMIT_KINDS.includes(one.kind))) {
      const step = nextLimit(limits[reading.kind], reading)
      limits[reading.kind] = step.limit
      if (step.isFired) $.ui.toast(limitToast(reading.kind, reading.percentUsed, reading.resetsAt, now))
    }
    await $.state.set(LIMITS, limits)
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const { agentId, model } = result
    if (agentId === undefined || model === undefined || !(await isActive($))) return result
    const startedAt = await $.clock.now()
    const detail = {
      description: e.description,
      type: e.subagentType,
      model,
      startedAt,
      status: 'running' as const,
      toolUseId: e.tool_use_id,
    }
    await update($, DETAILS, details => ({
      ...details,
      [agentId]: e.parentAgentId === undefined ? detail : { ...detail, parentId: e.parentAgentId },
    }))
    await refresh($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!(await isActive($))) return result
    const { agentId, usage } = e
    if (agentId !== undefined) {
      const endedAt = await $.clock.now()
      await foldStepTokens($)
      // Only agents the mod knows: the engine's own forks (compaction, memory)
      // run turns under ids no list names.
      const isListed = (await $.state.get(AGENTS)).value?.some(agent => agent.id === agentId) === true
      await update($, DETAILS, details => {
        const detail = details?.[agentId]
        if (detail === undefined && !isListed) return details ?? {}
        // Tokens come from the run's last request (turn.step), not this sum.
        const model = detail?.model ?? usage?.model
        return { ...details, [agentId]: { ...detail, ...(model === undefined ? {} : { model }), endedAt, status: endStatus(e.reason) } }
      })
      await refresh($)
      // Only a known agent is in the roster. The list may not have caught up,
      // so the toast tells the run's own outcome.
      const entry = (await view($)).roster.find(one => one.id === agentId)
      if (entry !== undefined) {
        $.ui.toast(finishToast({ ...entry, status: endStatus(e.reason), endedAt }, endedAt))
      }
      return result
    }
    await refresh($)
    return result
  })

  on('tool.call', async ($, e, next) => {
    if (!(await isActive($))) return next(e)
    const { agentId } = e
    if (agentId !== undefined) {
      // A finished background agent that calls a tool has woken up again.
      const status = (await $.state.get(DETAILS)).value?.[agentId]?.status
      if (status === 'done' || status === 'failed') {
        await update($, DETAILS, details => {
          const { endedAt: _, ...detail } = details?.[agentId] ?? {}
          return { ...details, [agentId]: { ...detail, status: 'running' as const } }
        })
        await refresh($)
      }
    }
    // Claimed only once the call has answered: a call that rejects or is
    // denied leaves the nudge pending for the next one.
    const result = await next(e)
    if (e.tool === 'Agent') await recordEngineTokens($, result.deny === undefined && result.isError !== true ? result.result : undefined)
    if (agentId !== undefined || result.deny !== undefined) return result
    const percent = await claimNudge($)
    return percent === undefined ? result : { ...result, context: [...(result.context ?? []), nudgeText(percent)] }
  })

  // Each subagent request's usage gives Claude Code's own token figure for the
  // agent: its last request's total. The main loop's steps (no agentId) don't
  // match, so they never pass through this module. The figure is recorded
  // without waiting, so the step's result reaches the subagent at once. (The
  // step's usage doesn't say whether a request was unmetered, so none is
  // skipped.)
  on('turn.step', { agentId: /./ }, async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId !== undefined && result.usage !== null) {
      void recordStep($, e.agentId, requestTokens(result.usage)).catch(() => undefined)
    }
    return result
  })

  // The fallback when the overseer makes no tool call before the next prompt.
  // The claim comes before `next` here, since context rides in on the way
  // down; a prompt that doesn't enter gives the nudge back.
  on('prompt.submit', async ($, e, next) => {
    const percent = (await isActive($)) ? await claimNudge($) : undefined
    if (percent === undefined) return next(e)
    try {
      const result = await next({ ...e, context: [...(e.context ?? []), nudgeText(percent)] })
      if (result.drop !== undefined) await unclaimNudge($, percent)
      return result
    } catch (error) {
      await unclaimNudge($, percent)
      throw error
    }
  })

  on('command.run', { command: 'factory' }, async $ => {
    const opened = await openPane($)
    return opened.isPlaced ? {} : { text: `Factory pane not shown: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)
    const columns = Math.min(MAX_ROW_COLUMNS, Math.max(1, Math.floor(e.props.bodyColumns)))
    const rows = (await isActive($))
      ? paneRows(await view($), columns)
      : [[seg('Not a factory overseer session.', { dim: true })]]
    return kit.Box({ flexDirection: 'column', children: rows.map((row, index) => rowElement(kit, row, `line-${index}`)) })
  })

  // The band above the prompt is shared: other mods' drawing (`next`) stays,
  // under ours, and ours takes only the rows it leaves. A tree taller than
  // `maxRows` scrolls, and Buttons scrolled out of view lose their hotkeys.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey || !(await isActive($))) return below
    const kit = $.ui.resolve(e)
    const columns = Math.min(MAX_ROW_COLUMNS, Math.max(1, Math.floor(e.props.bodyColumns)))
    const { isFramed, rows, hasButton } = bandLayout(await view($), columns, e.props.maxRows - rowsOf(below, columns))
    if (rows.length === 0) return below
    const button = hasButton
      ? kit.Button({ key: 'open-factory', hotkey: '1', plain: true, label: '/factory', onPress: () => void openPane($) })
      : undefined
    const lines = rows.map((row, index) => rowElement(kit, row, `band-${index}`, index === rows.length - 1 ? button : undefined))
    const band = isFramed
      ? kit.Box({ flexDirection: 'column', borderStyle: 'round', borderColor: COLOR.accent, paddingX: 1, children: lines })
      : kit.Box({ flexDirection: 'column', children: lines })
    return kit.Box({ flexDirection: 'column', children: [kit.Box({ paddingRight: COLLAPSE_COLUMNS, children: band }), below] })
  })

  // A one-line card heads each known Agent row, and the engine's own row
  // (live progress, ctrl+o detail, other plugins' drawing) stays beneath it.
  // With nothing known of the agent, the row is the engine's alone. No other
  // tool's row reaches this hook.
  on('ui.render', { component: 'ToolUse', props: { tool: 'Agent' } }, async ($, e, next) => {
    if (!(await isActive($))) return next(e)
    const current = await view($)
    const entry = current.roster.find(one => one.toolUseId === e.props.tool_use_id)
    if (entry === undefined) return next(e)
    const kit = $.ui.resolve(e)
    return kit.Box({ flexDirection: 'column', children: [rowElement(kit, agentRow(entry, current.now, false), 'agent'), await next(e)] })
  })

  // The engine's spinner stays; the summary rides after its ellipsis.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const summary = (await isActive($)) ? spinnerSummary(await view($)) : undefined
    return next(summary === undefined ? e : { ...e, props: { ...e.props, suffix: `${e.props.suffix} · ${summary}` } })
  })
}
