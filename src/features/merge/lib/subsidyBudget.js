// A segment's AMOUNT, and how it becomes per-board budgets.
//
// The economist states an amount per segment as TOTAL DEMAND: the DR the
// player is expected to spend themselves. The subsidy the boards must hand
// out is what is left of the chain: subsidy = 2048 - demand. That subsidy is
// the list's existing `targetSubsidy` (useBoardListState) - the same field
// the board editor's "Total subsidy" card edits; this file only holds the
// arithmetic so the Build Event workflow and the editor apply one rule.
//
// Per-board budgets under a target, exactly as the board editor does it:
//   - Board 1 never carries more than FIRST_BOARD_SUBSIDY_CAP_DR (when there
//     is a later board to take the rest);
//   - the LAST board is not typed: it takes whatever closes the gap to the
//     target.
import { MAX_RANK, RC_MAX_RANK, valueOf } from './ranks'
import { firstBoardCapFor } from './board'

export const CHAIN_VALUE_DR = valueOf(MAX_RANK)

// WHAT A PHASE'S CHASE HAS TO COVER - demand + subsidy always add up to this.
//   Normal:        rank 12 from nothing                      = 2,048 DR
//   Recompletion:  rank 14, arriving with a rank 12 in hand  = 8,192 - 2,048 = 6,144 DR
// (An earlier version converted Recompletion's demand against 2,048 as well.)
export function chaseValue(phase = 'main') {
  return phase === 'rc' ? valueOf(RC_MAX_RANK) - valueOf(MAX_RANK) : CHAIN_VALUE_DR
}

const clampTo = (v, phase) => Math.min(chaseValue(phase), Math.max(0, v))

export function subsidyForDemand(demand, phase = 'main') {
  return clampTo(chaseValue(phase) - demand, phase)
}

export function demandForSubsidy(subsidy, phase = 'main') {
  return clampTo(chaseValue(phase) - subsidy, phase)
}

// RECOMPLETION'S DEMAND IS THE SEGMENT'S NORMAL-EVENT DEMAND - by explicit
// economist request ("in the RC the demand should be the same as the demand
// of the segment in the normal event"). It is not typed a second time: the
// Recompletion list's subsidy is worked out from the normal list's.
//   normal:        subsidy = 2,048 - demand
//   Recompletion:  subsidy = 6,144 - the same demand
// Null (no rule to follow) while the normal list has no amount.
export function rcSubsidyForMainSubsidy(mainTargetSubsidy) {
  if (mainTargetSubsidy == null) return null
  return subsidyForDemand(demandForSubsidy(mainTargetSubsidy, 'main'), 'rc')
}

// The budgets a list should hold for a target: Board 1 capped, the last
// board closing the gap. Every other typed value is kept as it is.
export function fillLastBoard(budgets, targetSubsidy, phase = 'main') {
  const next = budgets.map((v) => Math.max(0, v ?? 0))
  if (targetSubsidy == null || next.length === 0) return next
  if (next.length > 1 && next[0] > firstBoardCapFor(phase)) next[0] = firstBoardCapFor(phase)
  const last = next.length - 1
  const others = next.slice(0, last).reduce((s, v) => s + v, 0)
  next[last] = clampTo(targetSubsidy - others, phase)
  return next
}

// A starting split for a segment whose boards have no budget yet: Board 1
// takes up to its cap, the rest is shared evenly across the later boards
// (whole DR; the last board takes the remainder). Only a starting point -
// every board but the last stays editable afterwards.
export function spreadSubsidy(boardCount, targetSubsidy, phase = 'main') {
  if (boardCount <= 0) return []
  const total = clampTo(targetSubsidy ?? 0, phase)
  if (boardCount === 1) return [total]
  const first = Math.min(firstBoardCapFor(phase), total)
  const later = boardCount - 1
  const each = Math.floor((total - first) / later)
  const budgets = [first, ...Array.from({ length: later }, () => each)]
  budgets[boardCount - 1] = total - first - each * (later - 1)
  return budgets
}

// How far the typed budgets are from the target (0 when they add up).
export function budgetGap(budgets, targetSubsidy) {
  if (targetSubsidy == null) return 0
  return budgets.reduce((s, v) => s + (v ?? 0), 0) - targetSubsidy
}
