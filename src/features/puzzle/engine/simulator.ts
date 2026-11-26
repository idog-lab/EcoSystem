// PLAYER SIMULATOR: where a player of a segment, at a percentile of
// PROGRESSION WITHIN that segment, stands on a day of the event.
//
// A percentile is not a completion percentage and not a brut-wins
// percentile (economist). It has to be mapped to economic-effort progress by
// a provider - a historical quantile table of a comparable event, labelled
// with its source. Without one there is no prediction: the panel says so and
// offers a manual scenario, labelled as an assumption. The position on the
// board then uses the same prices, rewards and days as the config.

import type { PuzzleEvent } from './model'
import type { RegularSegment } from './regular'
import type { TierRewardRow } from './rewards'

export type QuantileRow = { segment: number; day: number; percentile: number; progress: number }
export type ProgressProvider = {
  kind: 'historical-quantiles'
  /** Where the numbers come from (event, query, export), as typed when imported. */
  source: string
  asOf: string
  population: string
  rows: QuantileRow[]
}

export type ProgressReading =
  | { status: 'unavailable'; reason: string }
  | { status: 'historical'; progress: number; source: string; asOf: string; population: string; note: string }
  | { status: 'manual'; progress: number; note: string }

/**
 * The provider's progress for (segment, day, percentile), END of the day.
 * Only exact rows of the table: no interpolation between percentiles or
 * segments is presented as behaviour (economist).
 */
export function readProgress(provider: ProgressProvider | null, segment: number, day: number, percentile: number): ProgressReading {
  if (!provider) return { status: 'unavailable', reason: 'No progression data is connected for this event profile.' }
  const row = provider.rows.find((r) => r.segment === segment && r.day === day && r.percentile === percentile)
  if (!row) return { status: 'unavailable', reason: `The data has no row for segment ${segment}, day ${day}, percentile ${percentile}.` }
  return {
    status: 'historical',
    progress: row.progress,
    source: provider.source,
    asOf: provider.asOf,
    population: provider.population,
    note: 'Historical progression of a past event; this event may play differently.',
  }
}

export type PlayerPosition = {
  progress: number
  plannedEnd: number
  /** progress - planned progress at the end of the day. */
  vsPlan: number
  completedPieces: number
  totalPieces: number
  currentBoard: number | null
  piecesDoneOnBoard: number
  piecesOnBoard: number
  boardsDone: number
  /** DR paid for the completed pieces (in the order of their effort). */
  drSpent: number
  /** Rewards of the completed boards, and their dr-puzzle. */
  rewards: { board: number; syntax: string; worth: number }[]
  drFromRewards: number
  reachedRc: boolean
  fu: { measured: boolean; state: 'below' | 'within' | 'above' } | null
}

/** The day the weekend cutoff falls on (1-based), or null when there is none. */
export function weekendDay(ev: PuzzleEvent): number | null {
  if (!ev.setup.weekendCutoff) return null
  const ms = Date.parse(`${ev.setup.weekendCutoff}Z`) - Date.parse(`${ev.setup.start}Z`)
  if (!Number.isFinite(ms) || ms < 0) return null
  return Math.min(ev.setup.days, Math.floor(ms / 86_400_000) + 1)
}

export function positionAt(ev: PuzzleEvent, seg: RegularSegment, rewards: TierRewardRow[], day: number, progress: number): PlayerPosition {
  const p = Math.max(0, Math.min(1, progress))
  const done = seg.pieces.filter((x) => x.aggRate <= p + 1e-12)
  const next = seg.pieces[done.length]
  const boardsDone = seg.tiers.filter((t) => done.filter((x) => x.tier === t.tier).length === t.pieces).length
  const plannedEnd = seg.days[day - 1]?.cumulative ?? 1
  const wd = weekendDay(ev)
  const fuState = p < ev.optimize.fuRange.from ? 'below' : p > ev.optimize.fuRange.to ? 'above' : 'within'
  return {
    progress: p,
    plannedEnd,
    vsPlan: p - plannedEnd,
    completedPieces: done.length,
    totalPieces: seg.pieces.length,
    currentBoard: next?.tier ?? null,
    piecesDoneOnBoard: next ? done.filter((x) => x.tier === next.tier).length : 0,
    piecesOnBoard: next ? (seg.tiers[next.tier - 1]?.pieces ?? 0) : 0,
    boardsDone,
    drSpent: done.reduce((a, x) => a + x.cost, 0),
    rewards: rewards.slice(0, boardsDone).map((r) => ({ board: r.tier, syntax: r.syntax, worth: r.actual })),
    drFromRewards: (ev.rewards.regular[seg.segment - 1] ?? []).slice(0, boardsDone).reduce((a, t) => a + t.drAmount, 0),
    reachedRc: done.length === seg.pieces.length,
    fu: wd == null ? null : { measured: day === wd, state: fuState },
  }
}
