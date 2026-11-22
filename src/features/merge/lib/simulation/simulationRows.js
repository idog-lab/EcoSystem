import { MIN_RANK, MAX_RANK, RC_MAX_RANK } from '../core/ranks'

export const RANKS = Array.from({ length: MAX_RANK - MIN_RANK + 1 }, (_, i) => i + MIN_RANK)
// Recompletion's chart runs to rank 14 (see the simulator's rcEffort).
export const RC_RANKS = Array.from({ length: RC_MAX_RANK - MIN_RANK + 1 }, (_, i) => i + MIN_RANK)

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
export function buildSimulationRows(result, ranks = RANKS) {
  if (!result) return []
  return ranks.map((rank) => {
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

// THE CLIMB (Recompletion's chart). In Recompletion the ranks are not made in
// order: big items under the tiles skip ranks (a second rank 12 opened from a
// tile is merged into, never made), and a small generator tap late on makes a
// rank 1 long after rank 11 exists. Read the way the rows above are, that put
// more than 100% on the chart in one case and "-136 DR, -12%" on rank 3 in
// another. So here a rank is PART OF THE CLIMB when no higher rank was made
// before it, and its cost is what was paid since the last rank of the climb
// below it - never negative, and the costs add up to all that was paid by the
// time the top rank is made. A rank first made after a higher one is `aside`:
// its moment is shown, it has no cost of its own. A rank never made has
// nothing. This app's own way of reading it.
export function buildClimbRows(result, ranks = RC_RANKS) {
  if (!result) return []
  const made = (rank) => result.reachedAt[rank] !== undefined
  // Earlier than, or at the same moment as, every higher rank that was made.
  const notAfter = (rank, other) => result.reachedAt[rank] < result.reachedAt[other] || (result.reachedAt[rank] === result.reachedAt[other] && (result.tapsAt[rank] ?? 0) <= (result.tapsAt[other] ?? 0))
  let prevDr = 0
  let prevTaps = 0
  return ranks.map((rank) => {
    if (!made(rank)) return { rank, dr: undefined, drDelta: null, pctOfEffort: null, tapsDelta: null, outOfOrder: false, aside: false }
    const dr = result.reachedAt[rank]
    const taps = result.tapsAt[rank] ?? 0
    const inClimb = ranks.filter((other) => other > rank && made(other)).every((other) => notAfter(rank, other))
    if (!inClimb) return { rank, dr, drDelta: null, pctOfEffort: null, tapsDelta: null, outOfOrder: false, aside: true }
    const row = { rank, dr, drDelta: dr - prevDr, pctOfEffort: result.drSpent > 0 ? ((dr - prevDr) / result.drSpent) * 100 : null, tapsDelta: taps - prevTaps, outOfOrder: false, aside: false }
    prevDr = dr
    prevTaps = taps
    return row
  })
}
