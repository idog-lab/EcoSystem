import { valueOf } from './ranks'
import { generateCandidate } from './generateCandidate'
import { splitOversized, raiseUndersized, popcount, decomposeInWindow, padToCount } from './rankWindow'

// Rank-window variant of generateCandidate. The [minRank, maxRank] window is
// a hard floor/ceiling; item count is still soft. Sum is exact UNLESS the
// target isn't a multiple of valueOf(minRank), in which case there is no
// exact decomposition using only minRank-or-above items at all (every such
// item's value is itself a multiple of valueOf(minRank), so anything they
// sum to is too) — raiseUndersized rounds up by the smallest amount that
// fixes that (at most valueOf(minRank) - 1) rather than leaving an
// out-of-window item behind. Never rounds down, so the board's subsidy
// never comes in under what was configured, only (rarely) slightly over.
//
// When minRank < maxRank (an actual range, not a fixed rank), one item at
// minRank and one at maxRank are reserved up front so the result always
// shows variety across the window instead of collapsing to a cluster of
// similar ranks. Reservation is itself best-effort: it's skipped if there
// isn't enough sum, or if the remainder can't be decomposed within its
// leftover tile budget at all (checked via popcount — subtracting the
// reservation can unluckily need more items than plain decomposition would).
//
// That popcount pre-check only predicts feasibility assuming NO rank
// ceiling at all — it has no idea whether the ceiling (splitOversized,
// forced by a low maxRank) will need MORE items than it guessed. Real bug,
// found live: with a low maxRank and a tile-count/blockedValue combination
// that pushed splitOversized to explode the remainder well past
// desiredCount, the caller (placement.js) silently kept only the smallest
// `desiredCount` of the oversized result and dropped the rest — up to 84%
// of a board's configured DR, in the case that surfaced this — while the
// editor's own "Sum vs. target" check still showed a false-positive green
// checkmark on Board 1 (whose blockedQueue isn't truncated at generation
// time at all, so the full miscounted array got saved, and only the
// SIMULATOR's own reveal cap silently ate the excess during actual play).
// The fix: validate the reservation's REAL result length before trusting
// it, and fall back to decomposeInWindow (which enforces the ceiling before
// ever padding toward desiredCount, so it can never overshoot) whenever it
// doesn't fit — same safety net either way, reservation attempted first
// purely for its variety guarantee when it's actually achievable.
//
// `skipMinReserve`/`skipMaxReserve` let a caller say "don't bother reserving
// this side — it's already guaranteed some other way." placement.js uses
// this for a board.forcedSemiRanks entry that already sits at exactly
// minRank or maxRank: without this, the reservation here would try to ALSO
// carve out a redundant second item at that same rank from an
// ALREADY-reduced remainder budget (the forced item's own value/slot
// already came out of it) — often failing where it would have succeeded
// with the full budget, which starved the OTHER side (the one that
// genuinely still needed reserving) of a chance to succeed at all. Default
// `false`/`false` reproduces the exact original behavior for every other
// caller (`ccManagement.js`'s `suggestQueues`), which never passes this.
export function generateCandidateInRange(target, desiredCount, minRank, maxRank, { skipMinReserve = false, skipMaxReserve = false } = {}) {
  const reserved = []
  if (minRank < maxRank) {
    if (!skipMinReserve) reserved.push(minRank)
    if (!skipMaxReserve) reserved.push(maxRank)
  }

  if (reserved.length > 0 && desiredCount >= reserved.length) {
    const reservedSum = reserved.reduce((s, r) => s + valueOf(r), 0)
    const remainderTarget = target - reservedSum
    const remainderDesired = desiredCount - reserved.length
    if (remainderTarget >= 0 && popcount(remainderTarget) <= remainderDesired) {
      const remainderRanks = generateCandidate(remainderTarget, remainderDesired)
      raiseUndersized(remainderRanks, minRank)
      splitOversized(remainderRanks, maxRank)
      // Only a reservation that puts an item under EVERY tile is kept (see
      // padToCount) - a short one used to be returned as it was.
      const candidate = padToCount(reserved, remainderRanks, desiredCount, minRank).sort((a, b) => a - b)
      if (candidate.length === desiredCount) return candidate
    }
  }

  return decomposeInWindow(target, desiredCount, minRank, maxRank)
}
