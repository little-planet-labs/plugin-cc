// The factory status mod: in a factory overseer session it shows a status
// line under the prompt, a /factory pane (usage, agents, ledger), and tells
// the overseer once to update its ledger when auto-compaction is near.
//
// Read-only: it reads the ledgers in the session's scratchpad and never
// writes a file. In any other session it shows nothing and injects nothing.
// Every chain hook returns what `next` resolved, adding only the nudge's
// context.

import { update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { FactoryLedgers, FactoryUsage } from '../types'
import { parseLedger } from './mod/ledger'
import { ARMED, nextNudge, nudgeText } from './mod/nudge'
import { endStatus, mergeRoster } from './mod/roster'
import type { View } from './mod/view'
import { paneLines, statusLine, truncate } from './mod/view'

const OVERSEER = 'little-planet-factory:overseer'
const PANE = 'factory'
const POLL_MS = 15_000
// Wider than any terminal; keeps each Text well under the 10,000-character limit.
const MAX_COLUMNS = 1000
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

const NO_USAGE: FactoryUsage = { rateLimits: [] }
const NO_LEDGERS: FactoryLedgers = { main: null, managers: [] }

type Engine = EngineInterface

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

async function paint($: Engine): Promise<void> {
  $.ui.status(statusLine(await view($)))
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
  await Promise.all([$.state.set(AGENTS, agents), $.state.set(LEDGERS, ledgers)])
  await paint($)
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

// A reload cancels the old module's timers and loads this at undefined, so
// one poll runs per load.
let poll: Timer | undefined

async function activate($: Engine): Promise<void> {
  poll ??= $.clock.every(POLL_MS, () => void refresh($).catch(() => undefined))
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
      ])
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
    await paint($)
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const { agentId, model } = result
    if (agentId === undefined || model === undefined || !(await isActive($))) return result
    const startedAt = await $.clock.now()
    const detail = { description: e.description, type: e.subagentType, model, startedAt, status: 'running' as const }
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
      // Only agents the mod knows: the engine's own forks (compaction, memory)
      // run turns under ids no list names.
      const isListed = (await $.state.get(AGENTS)).value?.some(agent => agent.id === agentId) === true
      await update($, DETAILS, details => {
        const detail = details?.[agentId]
        if (detail === undefined && !isListed) return details ?? {}
        const spent = usage === undefined
          ? {}
          : {
              model: detail?.model ?? usage.model,
              tokens:
                (detail?.tokens ?? 0) +
                usage.input_tokens +
                usage.output_tokens +
                usage.cache_read_input_tokens +
                usage.cache_creation_input_tokens,
            }
        return { ...details, [agentId]: { ...detail, ...spent, endedAt, status: endStatus(e.reason) } }
      })
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
      return next(e)
    }
    // Claimed only once the call has answered: a call that rejects or is
    // denied leaves the nudge pending for the next one.
    const result = await next(e)
    if (result.deny !== undefined) return result
    const percent = await claimNudge($)
    return percent === undefined ? result : { ...result, context: [...(result.context ?? []), nudgeText(percent)] }
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
    const opened = await $.ui.open({ id: PANE, title: 'Factory', closeOnEscape: true })
    return opened.isPlaced ? {} : { text: `Factory pane not shown: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const columns = Math.min(MAX_COLUMNS, Math.max(1, Math.floor(e.props.bodyColumns)))
    const lines = (await isActive($))
      ? paneLines(await view($), columns)
      : [{ text: truncate('Not a factory overseer session.', columns), style: 'dim' as const }]
    return Box({
      flexDirection: 'column',
      children: lines.map(line =>
        Text({ bold: line.style === 'heading', dimColor: line.style === 'dim', wrap: 'truncate-end', children: line.text }),
      ),
    })
  })
}
