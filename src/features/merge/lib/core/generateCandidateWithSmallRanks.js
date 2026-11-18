import { valueOf, MIN_RANK, MAX_RANK } from './ranks'
import { decompose, splitToCount } from './generateCandidate'
import { splitOversized, raiseUndersized, popcount, decomposeInWindow, padToCount } from './rankWindow'

// Ranks guaranteed present in the placed-item pool for board index 0, so
// early merges always have small pieces to combine - three ascending ranks
// starting AT minRank (not hardcoded to 1/2/3 - see the "Item generation"
// note below for why that used to be a real bug), so the guarantee still
// respects whatever floor the economist configured instead of contradicting
// it. Degrades to fewer entries (down to just [minRank]) when the
// [minRank, maxRank] window is too narrow for three distinct ranks. Scoped
// to board 0 only — do not apply this to any other board in the list.
function guaranteedRanksFor(minRank, maxRank) {
  const ranks = []
  for (let r = minRank; r < minRank + 3 && r <= maxRank; r++) ranks.push(r)
  return ranks.length > 0 ? ranks : [minRank]
}

function reservedSum(ranks) {
  return ranks.reduce((sum, r) => sum + valueOf(r), 0)
}

// A reservation is only usable if the leftover (target - reservedSum) can
// actually be decomposed within the leftover tile budget — checked via
// popcount, since subtracting the reservation can unluckily need more items
// than the target's own decomposition would (e.g. 2048 - 7 = 2041 needs 9
// items even though 2048 alone needs only 1).
function canReserve(reserved, target, desiredCount) {
  const sum = reservedSum(reserved)
  return target >= sum && desiredCount >= reserved.length && popcount(target - sum) <= desiredCount - reserved.length
}

// Same exact-sum contract as generateCandidate, but reserves a small
// ascending set of ranks up front (see guaranteedRanksFor) and never splits
// them away - the board-0 small-rank guarantee. Also reserves one item at
// maxRank if it isn't already in that set, so setting a top rank on board 0
// is still guaranteed to show up at least once - same best-effort spirit as
// generateCandidateInRange's min/max reservation, just layered on top of
// the small-rank set instead of replacing it.
//
// The [minRank, maxRank] window is a HARD floor/ceiling on every branch here
// (raiseUndersized, not the old best-effort mergeUndersized/plain
// generateCandidate) — by explicit economist request: a configured minRank
// should never be silently violated just to hit the exact DR target - this
// board's blockedValue may overallocate slightly instead, the same
// "overallocate rather than undershoot the floor" precedent
// generateCandidateInRange already established for every other board. This
// was a real bug, not just an inconsistency: GUARANTEED_RANKS used to be
// hardcoded to [1, 2, 3] regardless of minRank, and the final fallback
// branch (reservation infeasible even for the small-rank set alone) used to
// call plain generateCandidate with no rank-window enforcement at all —
// both could put a rank 1 or 2 item on the board even with minRank set to
// 3+.
//
// Reservation degrades gracefully if it isn't feasible: max-rank first, then
// the small-rank guarantee itself, always preserving the exact sum (up to
// the overallocation raiseUndersized may add).
//
// `canReserve`'s popcount check only predicts feasibility assuming NO rank
// ceiling — it has no idea whether the ceiling (splitOversized, forced by a
// low maxRank) will need MORE items than it guessed, so each reservation
// attempt's REAL result length is validated before being trusted, same fix
// as generateCandidateInRange's own (see that file's comment for the bug
// this closes — a low maxRank could silently explode a reservation's item
// count well past desiredCount, and the caller used to just keep the
// smallest `desiredCount` of the result and drop the rest, stranding most
// of a board's configured DR with no clear warning). Both reservation tiers
// now fall through to decomposeInWindow (which enforces the ceiling before
// ever padding toward desiredCount, so it can never overshoot) instead of
// the old unguarded final fallback.
export function generateCandidateWithSmallRanks(target, desiredCount, minRank = MIN_RANK, maxRank = MAX_RANK) {
  const guaranteed = guaranteedRanksFor(minRank, maxRank)
  const withMax = guaranteed.includes(maxRank) ? guaranteed : [...guaranteed, maxRank]

  for (const reserved of [withMax, guaranteed]) {
    if (!canReserve(reserved, target, desiredCount)) continue
    const remainderTarget = target - reservedSum(reserved)
    const remainderDesired = Math.max(0, desiredCount - reserved.length)
    const remainderRanks = splitToCount(decompose(remainderTarget), remainderDesired, { randomize: true })
    // Raise first, then split: raising merges stray small items into bigger
    // ones, which can come out ABOVE the max rank (on a narrow window - found
    // by the randomized check in verify-event-build.mjs); the split after it
    // brings them back under the ceiling. The other generator already runs
    // them in this order.
    raiseUndersized(remainderRanks, minRank)
    splitOversized(remainderRanks, maxRank)
    // Only a reservation that puts an item under EVERY tile is kept (see
    // rankWindow.js: padToCount). With the max rank reserved, what is left
    // can be too little to fill the board (150 DR, max rank 8: the rank 8
    // takes 128 and the other 29 tiles get 12 DR between them) - the next
    // reservation, without the max rank, then fills it.
    const candidate = padToCount(reserved, remainderRanks, desiredCount, minRank).sort((a, b) => a - b)
    if (candidate.length === desiredCount) return candidate
  }

  return decomposeInWindow(target, desiredCount, minRank, maxRank)
}
