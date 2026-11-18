import { REWARD_TYPES } from './rewardChain'

// "I want a graph that shows the progression of the drops with the merges
// the user is doing" - turns a session's own event log (playSession.js) into
// one cumulative-collection series per resource type, keyed by merge count
// (not wall-clock time or DR spent - merges are the thing that actually
// produces a drop, so that's the natural x-axis). Pure data transform, kept
// separate from RewardProgressionChart.jsx's own rendering so it can be
// unit-verified directly against a hand-built event log.
export function buildSeries(events) {
  let mergeCount = 0
  const cumulative = { coins: 0, puzzles: 0, energy: 0, charms: 0 }
  // (Twister DR has its own widget readout - this chart is the four
  // source-allocated resources; a twister collect is skipped below.)
  const series = { coins: [[0, 0]], puzzles: [[0, 0]], energy: [[0, 0]], charms: [[0, 0]] }
  for (const e of events) {
    if (e.type === 'merge') mergeCount += 1
    if (e.type === 'collect' && e.rewardType && series[e.rewardType]) {
      cumulative[e.rewardType] = (cumulative[e.rewardType] ?? 0) + (e.amount ?? 0)
      series[e.rewardType].push([mergeCount, cumulative[e.rewardType]])
    }
  }
  // Extend every series to the final merge count, flat, so all four charts
  // share the same x-axis extent even if a type's last collect happened
  // well before the player's most recent merge.
  for (const type of REWARD_TYPES) {
    const last = series[type][series[type].length - 1]
    if (last[0] < mergeCount) series[type].push([mergeCount, last[1]])
  }
  return { series, mergeCount, totals: cumulative }
}
