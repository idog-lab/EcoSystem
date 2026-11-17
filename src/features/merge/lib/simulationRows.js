import { MIN_RANK, MAX_RANK } from './ranks'

export const RANKS = Array.from({ length: MAX_RANK - MIN_RANK + 1 }, (_, i) => i + MIN_RANK)

// Per-rank row data derived from a simulatePlaythrough result - shared by
// SimulationReport.jsx (the table) and EffortDistributionChart.jsx (the
// graph under Blocked Queue), so the two can never disagree about what
// "reached", "+DR", or "% effort" mean for the same rank. Extracted here
// specifically so the chart doesn't need its own re-derivation of the same
// "diff consecutive reachedAt entries" logic.
//
// `reachedAt` is NOT guaranteed ascending by rank number - it records the
// cumulative DR spent at the moment each rank was first seen ANYWHERE on the
// board (initial items, a merge, a generator spend, or a blocked tile
// revealed elsewhere), and reveals don't have to arrive in rank order:
// buildNoisyQueue deliberately lets the blocked queue "dip and recover"
// rather than climbing in a strict ramp (see CLAUDE.md's "Placement"
// section), and a later board pushing in as a wave can front-load a cheap
// high-rank item while a lower rank is still being separately built up via
// slower merges elsewhere. So a higher rank can genuinely be reached, in
// real DR terms, before a lower one - this shows up as a negative `drDelta`
// here, which is real data, not a bug (drSpent itself never goes backwards).
export function buildSimulationRows(result) {
  if (!result) return []
  return RANKS.map((rank) => {
    const dr = result.reachedAt[rank]
    const prevDr = result.reachedAt[rank - 1] ?? 0
    const drDelta = dr != null ? dr - prevDr : null
    const taps = result.tapsAt[rank]
    const prevTaps = result.tapsAt[rank - 1] ?? 0
    const tapsDelta = taps != null ? taps - prevTaps : null
    return {
      rank,
      dr,
      drDelta,
      pctOfEffort: drDelta != null && result.drSpent > 0 ? (drDelta / result.drSpent) * 100 : null,
      tapsDelta,
      outOfOrder: drDelta != null && drDelta < 0,
    }
  })
}
