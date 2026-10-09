// The agent roster: $.agent.list() gives each agent's status and parent; the
// details the mod collects from events add model, times and tokens.

import type { FactoryAgent, FactoryAgentDetail } from '../../types'

export type RosterEntry = Omit<FactoryAgentDetail, 'status'> & { id: string; status: 'running' | 'done' | 'failed' | 'other' }

const LISTED: Record<string, RosterEntry['status']> = {
  running: 'running',
  completed: 'done',
  failed: 'failed',
  killed: 'failed',
}

// What a finished run's reason means for the agent.
export const endStatus = (reason: string): 'done' | 'failed' => (reason === 'answer' ? 'done' : 'failed')

// Listed agents take the list's status; an agent the mod saw that the list
// no longer names (it may prune finished ones) keeps its own.
export function mergeRoster(
  agents: readonly FactoryAgent[] | null,
  details: Readonly<Record<string, FactoryAgentDetail>>,
): RosterEntry[] {
  const listed = (agents ?? []).map(agent => ({
    ...details[agent.id],
    id: agent.id,
    description: agent.description,
    type: agent.type,
    parentId: agent.parentId,
    status: LISTED[agent.status] ?? details[agent.id]?.status ?? 'other',
  }))
  const ids = new Set(listed.map(entry => entry.id))
  const unlisted = Object.entries(details)
    .filter(([id]) => !ids.has(id))
    .map(([id, detail]) => ({ ...detail, id, status: detail.status ?? ('other' as const) }))
  return [...listed, ...unlisted]
}

// Depth-first order under the overseer. An agent whose parent isn't in the
// roster sits at the top level.
export function rosterTree(entries: readonly RosterEntry[]): { entry: RosterEntry; depth: number }[] {
  const ids = new Set(entries.map(entry => entry.id))
  const children = new Map<string | undefined, RosterEntry[]>()
  for (const entry of entries) {
    const parent = entry.parentId !== undefined && ids.has(entry.parentId) ? entry.parentId : undefined
    children.set(parent, [...(children.get(parent) ?? []), entry])
  }
  const out: { entry: RosterEntry; depth: number }[] = []
  const walk = (parent: string | undefined, depth: number): void => {
    for (const entry of children.get(parent) ?? []) {
      out.push({ entry, depth })
      walk(entry.id, depth + 1)
    }
  }
  walk(undefined, 1)
  return out
}

// Claude Code's own figure for an agent's tokens (the Agent result's
// `totalTokens`): one request's input, cache writes, cache reads and output,
// taken from the agent's last request. Summing these over every request would
// count the cached context again on each one.
export const requestTokens = (usage: {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number | null
  cache_creation_input_tokens: number | null
}): number => usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + usage.output_tokens
