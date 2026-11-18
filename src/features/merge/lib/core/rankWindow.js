import { MIN_RANK, valueOf } from './ranks'
import { decompose, splitToCount } from './generateCandidate'

// Board-position-specific hard floors, independent of whatever `minRank` the
// economist has configured for that board — by explicit request, Board 2
// (index 1) never generates rank 1, Board 3 (index 2) never generates rank 1
// or rank 2. Positional, not main-list-specific — applies to any board list
// by index (Recompletion included), the same way the wave-board row cap
// (isFirstBoard ? 20 : 3, see BoardEditor.jsx) is keyed off position rather
// than which list it's in. Board 0 (Board 1) is untouched by this map — its
// own small-rank guarantee and rank-1 semi rule are separate, pre-existing
// rules (see placement.js's isFirstBoard branch). Only these two positions
// carry a hardcoded floor; every board beyond index 2 is unaffected and
// governed purely by its own configured minRank, same as before this rule
// existed.
const HARD_MIN_RANK_BY_BOARD_INDEX = { 1: 2, 2: 3 }

// The raw hardcoded floor for a board position, or undefined if none — used
// to build an explanatory hint in the UI (BoardList.jsx) without duplicating
// the index-to-floor mapping there.
export function hardMinRankFloor(boardIndex) {
  return HARD_MIN_RANK_BY_BOARD_INDEX[boardIndex]
}

// The minRank actually enforced during generation for a given board
// position: whichever is stricter of the economist's own configured
// minRank and this position's hardcoded floor. Never LOWERS minRank below
// what's configured — a board manually set to minRank 5 on position 2 stays
// at 5, not 2. Used everywhere generation, the sum/variety checks, and the
// overallocation note need to agree on what the real floor is, so none of
// them can drift out of sync with what generation actually produces.
export function effectiveMinRank(minRank, boardIndex) {
  const floor = hardMinRankFloor(boardIndex)
  return floor != null ? Math.max(minRank, floor) : minRank
}

// The mirror-image hard CEILING, by explicit economist report: a board's
// blocked queue could generate items as high as rank ~10 just to hit a
// large blockedValue target, which meant actually CLEARING board 1 (every
// locked/semi tile revealed and merged away) could require the player's
// own merge chain to climb almost as high as rank 10 - defeating the
// point of a first/second board being an early, approachable chunk of the
// event. Board 0 (Board 1) is hard-capped at rank 8, Board 1 (Board 2) at
// rank 11 - every board beyond that is unaffected and governed purely by
// its own configured maxRank, same as before this rule existed. Same
// precedent as HARD_MIN_RANK_BY_BOARD_INDEX above: positional, not
// main-list-specific (Recompletion's own board 0/1 get it too), and
// Math.min only ever TIGHTENS a configured maxRank, never loosens one a
// board was manually set below this ceiling.
const HARD_MAX_RANK_BY_BOARD_INDEX = { 0: 8, 1: 11 }

export function hardMaxRankCeiling(boardIndex) {
  return HARD_MAX_RANK_BY_BOARD_INDEX[boardIndex]
}

export function effectiveMaxRank(maxRank, boardIndex) {
  const ceiling = hardMaxRankCeiling(boardIndex)
  return ceiling != null ? Math.min(maxRank, ceiling) : maxRank
}

// The minimum number of power-of-two-valued items that can sum to `target`
// (repetition allowed) is provably its population count: any representation
// with a duplicate value could always merge that pair into one larger item,
// so a minimal representation never has duplicates, which is exactly the
// standard binary form. Used to check whether a reservation (subtracting a
// fixed sum before decomposing the remainder) is even satisfiable within a
// tile budget before committing to it — subtracting a small amount from a
// round number can unluckily flip many bits (e.g. 2048 - 7 = 2041 needs 9
// items even though 2048 alone needs only 1).
export function popcount(n) {
  let count = 0
  let x = n
  while (x > 0) {
    count += x & 1
    x >>= 1
  }
  return count
}

// Split every item above maxRank down into rank-1 pairs until none remain.
export function splitOversized(ranks, maxRank) {
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < ranks.length; i++) {
      if (ranks[i] > maxRank) {
        const r = ranks[i] - 1
        ranks.splice(i, 1, r, r)
        changed = true
        break
      }
    }
  }
}

// Merge pairs of equal-rank items below minRank up one rank at a time.
// A lone item with no matching pair is left below minRank (best-effort) -
// used where item count needs to stay exactly as generated (board 0's
// small-rank guarantee already puts a rank-1/2/3 floor in place regardless,
// so a leftover odd one out there isn't the problem raiseUndersized exists
// for below).
export function mergeUndersized(ranks, minRank) {
  let changed = true
  while (changed) {
    changed = false
    for (let r = MIN_RANK; r < minRank; r++) {
      const idxs = []
      for (let i = 0; i < ranks.length; i++) {
        if (ranks[i] === r) idxs.push(i)
      }
      if (idxs.length >= 2) {
        const [i1, i2] = idxs
        ranks.splice(i2, 1)
        ranks.splice(i1, 1)
        ranks.push(r + 1)
        changed = true
        break
      }
    }
  }
}

// Removes every item below minRank and replaces them with a clean
// decomposition of their combined value - rounded UP to the nearest
// multiple of valueOf(minRank) if it isn't one already, since a value that
// isn't such a multiple can never be exactly represented using only
// minRank-or-above (power-of-two) items. Unlike mergeUndersized (which
// leaves an unpaired leftover below minRank), this makes the rank floor a
// hard constraint - the sum may overallocate by at most valueOf(minRank) - 1
// as the price of that, on top of whatever it's called on. Item count is
// unaffected by the rest of the list; the replacement decomposition's own
// count is whatever decompose() needs (its minimum, one item per set bit).
export function raiseUndersized(ranks, minRank) {
  const minValue = valueOf(minRank)
  let strayValue = 0
  for (let i = ranks.length - 1; i >= 0; i--) {
    if (ranks[i] < minRank) {
      strayValue += valueOf(ranks[i])
      ranks.splice(i, 1)
    }
  }
  if (strayValue === 0) return
  const roundedValue = Math.ceil(strayValue / minValue) * minValue
  ranks.push(...decompose(roundedValue))
}

// The minimum number of items, each within [minRank, maxRank], that can sum
// to exactly `units` multiples of valueOf(minRank) (repetition allowed).
// Working in these units rather than raw DR value is what makes the ceiling
// exact: as many maxRank ("maxUnit"-sized") items as fit, plus one item per
// set bit of whatever's left over (which is by construction smaller than a
// single maxRank item, so its own binary decomposition never needs anything
// above the ceiling). This is a real combinatorial floor, not merely a
// "value fits under capacity" heuristic — found live: 31 DR cannot be built
// from 8 items each capped at value 4, even though 31 < 8*4 = 32 (the naive
// capacity bound), because reaching an odd sum forces at least one item
// below the ceiling, and no single swap-down within {1,2,4} ever costs
// exactly 1 unit of sum — every achievable total below 32 in 8 such items
// jumps by at least 2. Verified against a brute-force search over every
// (count, sum) combination before relying on this formula anywhere.
function minItemCount(units, maxUnit) {
  const full = Math.floor(units / maxUnit)
  return full + popcount(units - full * maxUnit)
}

// Public form of minItemCount in DR terms: the smallest number of items that
// can hold `target` DR within [minRank, maxRank] (after the same
// round-up-to-a-minRank-multiple rule decomposeInWindow itself applies).
// Used by the reward-placement solver (rewardPlacement.js) to know how many
// of a board's blocked tiles the main chain genuinely needs, so reward items
// only ever claim the slots left over.
export function minMainItemCount(target, minRank, maxRank) {
  if (target <= 0) return 0
  const unit = valueOf(minRank)
  const units = Math.ceil(Math.max(target, 0) / unit)
  const maxUnit = valueOf(maxRank) / unit
  return minItemCount(units, maxUnit)
}

// The safe replacement for "decompose → split to desiredCount → enforce the
// maxRank ceiling afterward" — this is the ORDER that made
// generateCandidateInRange/generateCandidateWithSmallRanks vulnerable to
// silently stranding DR (see their own comments): splitting to reach a item
// COUNT before the rank CEILING is enforced means the later ceiling-driven
// split can blow the result back past desiredCount, and nothing downstream
// ever re-checks that. `decomposeInWindow` enforces the ceiling FIRST
// (working in units of valueOf(minRank), via minItemCount above) so it
// always knows the true minimum item count before ever padding for variety —
// exactly the order onboardingGoal.js's decomposeReserved already used
// safely (splitOversized before splitToCount), generalized and given a
// real feasibility check instead of trusting popcount alone.
//
// Exact sum unless either of two well-documented, honestly-reported
// roundings applies:
// - `target` isn't a multiple of valueOf(minRank): rounds UP to the nearest
//   one that is (same "at most valueOf(minRank)-1 DR of overallocation,
//   never rounds down" contract raiseUndersized already established).
// - `desiredCount` items at maxRank each genuinely cannot hold this much
//   value (checked via minItemCount, not a naive value-vs-capacity bound —
//   see that function's own comment for why the naive version is wrong):
//   returns exactly `desiredCount` items, all at maxRank — the most this
//   tile budget can ever deliver — rather than generating more items than
//   there's room for and leaving the caller to silently drop whichever ones
//   didn't fit (which is exactly what used to happen: the tail of an
//   oversized queue, sorted smallest-first, got silently truncated away,
//   taking most of the board's configured DR with it).
// EVERY TILE GETS AN ITEM WHEN THE DR ALLOWS IT. A blocked tile with nothing
// under it never opens - the player merges next to it and nothing happens
// (found live: "i had a problem in the normal run of a merge that did not
// reveal a semi blocked tile"; the board's queue was one item short).
// Both range generators reserve a "variety" item first (the board's max
// rank, and on later boards its min rank) and build the rest around it; that
// rest can come out with FEWER items than there are tiles (the reserved max
// item swallowed most of the DR, or raising undersized items merged some
// away), and the short result used to be accepted as it was.
// padToCount splits the non-reserved items (never below minRank) until the
// count is reached, and reports whether it got there; the callers only keep
// a reservation that fills every tile, and otherwise fall back to
// decomposeInWindow, which fills as many tiles as the DR can.
export function padToCount(reserved, rest, desiredCount, minRank) {
  splitToCount(rest, desiredCount - reserved.length, { floorRank: minRank, randomize: true })
  return [...reserved, ...rest]
}

export function decomposeInWindow(target, desiredCount, minRank, maxRank) {
  if (desiredCount <= 0) return []

  const unit = valueOf(minRank)
  const roundedTarget = Math.ceil(Math.max(target, 0) / unit) * unit
  const units = Math.round(roundedTarget / unit)
  const maxUnit = valueOf(maxRank) / unit

  if (minItemCount(units, maxUnit) > desiredCount) {
    return Array(desiredCount).fill(maxRank)
  }

  const full = Math.floor(units / maxUnit)
  const remainderUnits = units - full * maxUnit
  // decompose() works in the same unit space (its own "rank 1" = 1 unit =
  // valueOf(minRank) real DR), so its ranks shift up by (minRank - 1) to
  // land in real rank space. remainderUnits < maxUnit by construction, so
  // every rank this produces is already <= maxRank on its own — no separate
  // splitOversized pass needed for it.
  const ranks = [...Array(full).fill(maxRank), ...decompose(remainderUnits).map((r) => r + minRank - 1)]

  // Slack: desiredCount may exceed the minimal count above (this is the
  // common case — most boards have far more tiles than the bare minimum
  // needed). Pad via the shared splitToCount (randomized — this is real,
  // player-visible queue generation, the same class of "make it not all the
  // same rank" ask generateCandidate's own randomized path addresses) —
  // safe here specifically because every item is already <= maxRank, so
  // splitting only ever produces something smaller, never re-crossing the
  // ceiling. floorRank is this board's own `minRank`, not the global
  // MIN_RANK — this path must respect the board's configured floor, not
  // just the absolute rank-1 minimum.
  splitToCount(ranks, desiredCount, { floorRank: minRank, randomize: true })

  return ranks.sort((a, b) => a - b)
}
