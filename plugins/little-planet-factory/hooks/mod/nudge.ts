// When the overseer's context nears auto-compaction, the mod tells it once to
// bring its ledger up to date. Levels are percent of the context window.

import type { FactoryLimit, FactoryNudge, FactoryUsage } from '../../types'

export const ARMED: FactoryNudge = { phase: 'armed', percent: 0 }
const FALLBACK_TRIGGER = 75
const HYSTERESIS = 10

// The fill and the trigger: 90% of the auto-compaction threshold when the
// engine reports one, else 75%. Undefined when the fill isn't known.
export function contextLevel(usage: FactoryUsage): { percent: number; trigger: number } | undefined {
  const context = usage.context
  if (context === undefined) return undefined
  const { tokens, window, percent } = context
  if (usage.autoCompactThreshold !== undefined && tokens !== undefined && window > 0) {
    return { percent: (tokens / window) * 100, trigger: (90 * usage.autoCompactThreshold) / window }
  }
  return percent === undefined ? undefined : { percent, trigger: FALLBACK_TRIGGER }
}

export function nextNudge(nudge: FactoryNudge, usage: FactoryUsage): FactoryNudge {
  const level = contextLevel(usage)
  if (level === undefined) return nudge
  if (level.percent < level.trigger - HYSTERESIS) return ARMED
  if (level.percent < level.trigger || nudge.phase === 'fired') return nudge
  return { phase: 'pending', percent: level.percent }
}

export const nudgeText = (percent: number): string =>
  `Factory mod: context is at ${Math.round(percent)}% and auto-compaction is near. ` +
  'Update the factory ledger now (Units, Background work, Next step).'

// A rate-limit window's toast fires once at 80% and re-arms below 70% or when
// the window resets (its reset time moves).
export function nextLimit(
  limit: FactoryLimit | undefined,
  reading: { percentUsed: number; resetsAt?: string },
): { limit: FactoryLimit; isFired: boolean } {
  const hasReset = limit?.resetsAt !== undefined && reading.resetsAt !== undefined && reading.resetsAt !== limit.resetsAt
  const isArmed = (limit?.isArmed ?? true) || hasReset || reading.percentUsed < 70
  const isFired = isArmed && reading.percentUsed >= 80
  const resetsAt = reading.resetsAt === undefined ? {} : { resetsAt: reading.resetsAt }
  return { limit: { isArmed: isArmed && !isFired, ...resetsAt }, isFired }
}
