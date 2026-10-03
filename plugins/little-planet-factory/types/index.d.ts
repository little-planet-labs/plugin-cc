// The factory status mod's session state ($.state), one value per key.

export type FactorySession = { active: boolean; scratchpadDir: string | null }

// One subagent as $.agent.list() last reported it.
export type FactoryAgent = { id: string; description: string; type: string; status: string; parentId?: string }

// What the mod learned about a subagent from its events, keyed by agent id.
export type FactoryAgentDetail = {
  description?: string
  type?: string
  parentId?: string
  model?: string
  startedAt?: number
  endedAt?: number
  tokens?: number
  status?: 'running' | 'done' | 'failed'
}

export type FactoryUsage = {
  context?: { tokens?: number; window: number; percent?: number }
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  costUsd?: number
  autoCompactThreshold?: number
}

export type FactoryLedger = {
  status?: string
  next?: string
  questions: string[]
  units: Record<string, number>
  background: string[]
}

export type FactoryLedgers = {
  main: FactoryLedger | null
  managers: { slug: string; next?: string }[]
}

// armed: waiting for the threshold; pending: crossed, not yet delivered; fired: delivered.
export type FactoryNudge = { phase: 'armed' | 'pending' | 'fired'; percent: number }

declare module 'claude-code' {
  interface PluginState {
    'little-planet-factory': {
      session: FactorySession
      agents: FactoryAgent[] | null
      details: Record<string, FactoryAgentDetail>
      usage: FactoryUsage
      ledgers: FactoryLedgers
      nudge: FactoryNudge
    }
  }
}
