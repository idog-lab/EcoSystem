import { MIN_RANK } from './ranks'

// Decompose target into powers of two -> ranks, descending (highest rank first).
export function decompose(target) {
  const ranks = []
  let remaining = target
  let bit = 1
  let rank = 1
  while (remaining > 0) {
    if (remaining & bit) {
      ranks.push(rank)
      remaining -= bit
    }
    bit <<= 1
    rank += 1
  }
  return ranks.sort((a, b) => b - a)
}

// Mutates `ranks` in place: repeatedly splits a splittable item (rank >
// `floorRank`) in half until length reaches desiredCount, or nothing is left
// splittable. Sum is unaffected by construction (2^(r-1) = 2 * 2^(r-2)).
//
// `randomize` (default false, so every existing caller is byte-for-byte
// unchanged) picks WHICH splittable item gets split next via a
// weight-by-rank random draw instead of always the single current largest —
// by explicit economist request ("make the simulator not make just all of
// the items in there the same"). Always picking the exact largest converges
// fast toward one dominant repeated rank: each split halves the current
// max, and the piece it just produced is usually the new "largest" again
// next time around, so a board with many more tiles than the original
// decompose() had bits tends to end up mostly one rank with only the
// original few odd-sized leftovers standing out (the literal "[1, 6, 6, 6,
// 6, ...]" shape this was reported against). Weighting by rank (not
// uniform-random) keeps the same "split the big ones, let small ones
// settle at the floor" bias that avoids needlessly bottoming out every item
// at `floorRank` — it only changes WHICH of the current big items gets
// picked, not whether big items keep getting picked over small ones.
// Deliberately NOT the default: `onboardingGoal.js`'s `decomposeReserved`
// calls this directly as part of an exhaustive feasibility search that
// needs the SAME inputs to produce the SAME decomposition on repeat calls
// (see that search's own "NOT monotonic" notes) — randomizing it there
// would make feasibility itself flaky from one call to the next for
// identical inputs, a correctness regression this fix must not introduce.
export function splitToCount(ranks, desiredCount, { floorRank = MIN_RANK, randomize = false } = {}) {
  while (ranks.length < desiredCount) {
    if (!randomize) {
      let largestIdx = -1
      for (let i = 0; i < ranks.length; i++) {
        if (ranks[i] > floorRank && (largestIdx === -1 || ranks[i] > ranks[largestIdx])) {
          largestIdx = i
        }
      }
      if (largestIdx === -1) break // nothing left to split
      const splitRank = ranks[largestIdx] - 1
      ranks.splice(largestIdx, 1, splitRank, splitRank)
      continue
    }

    const splittable = []
    for (let i = 0; i < ranks.length; i++) if (ranks[i] > floorRank) splittable.push(i)
    if (splittable.length === 0) break // nothing left to split

    let weightLeft = Math.random() * splittable.reduce((s, i) => s + ranks[i], 0)
    let chosen = splittable[splittable.length - 1]
    for (const i of splittable) {
      weightLeft -= ranks[i]
      if (weightLeft <= 0) {
        chosen = i
        break
      }
    }
    const splitRank = ranks[chosen] - 1
    ranks.splice(chosen, 1, splitRank, splitRank)
  }
  return ranks
}

// Exact-sum decomposition of `target` into `desiredCount` items (ranks).
// Always preserves sum(valueOf(rank)) === target. Item count is best-effort:
// if every item bottoms out at MIN_RANK before reaching desiredCount, the
// loop stops early rather than breaking the sum. Randomized splitting (see
// splitToCount's own comment) - this is the general-purpose path real board
// generation goes through, where variety is the actual ask.
export function generateCandidate(target, desiredCount) {
  const ranks = splitToCount(decompose(target), desiredCount, { randomize: true })
  return ranks.sort((a, b) => a - b)
}
