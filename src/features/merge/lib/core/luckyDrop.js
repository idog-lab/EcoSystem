export const DEFAULT_TARGET_EV = 1.1

// The decay model (see solveK below) only has a valid root in [0, 1] for
// targetEv in [1, 7/3] - at k=0, EV=1 (never a bonus); at k=1,
// EV=(1+2+4)/(1+1+1)=7/3 (as close to evenly-split as the model allows).
// Past that ceiling there's no valid 3-outcome distribution at all. This
// ceiling holds regardless of BONUS2_BLEND below - both endpoints (k=0 and
// k=1) are fixed points of the blend, only the interior curve shape moves.
// MIN_TARGET_EV/MAX_TARGET_EV are exported so UI callers (the editor's
// "Lucky drops" card) can cap input at the source, not just downstream.
export const MIN_TARGET_EV = 1
export const MAX_TARGET_EV = 7 / 3

// p(+1 rank) = p(normal)*k, same as always. p(+2 ranks) used to be a strict
// p(normal)*k^2 (pure geometric decay, so +2 always fell off exactly as
// steeply as +1 did) - by explicit economist request, +2 now gets more of
// the probability mass: p(+2) = p(normal) * (BONUS2_BLEND*k +
// (1-BONUS2_BLEND)*k^2), a linear blend between "decays no faster than +1"
// (BONUS2_BLEND=1, p(+2)=p(+1) always) and the original pure-geometric
// curve (BONUS2_BLEND=0, recovers the exact old formula/output bit-for-bit
// - verified). 0.2 was picked after 0.5 was tried and rejected live - it
// pulled +1 and +2 too close together (~2x apart at typical targetEv values,
// down from the original ~20x+ gap); 0.2 keeps +2 clearly the rarer of the
// two bonus tiers (roughly 3-4.5x rarer than +1 at typical targetEv) while
// still giving it a real, noticeable boost (~2-3.3x more likely than the
// original pure-geometric curve at the same targetEv). This is a fixed
// internal constant, not economist-facing - the ask was to reshape the
// curve itself, not add a second per-board dial (targetEv stays the single
// free parameter). Effect fades toward ~1x (no difference from the original
// curve) as targetEv approaches the 7/3 ceiling, where the distribution is
// already forced close to uniform regardless of blend. Must stay strictly
// less than 1 - at BONUS2_BLEND=1 the quadratic's `a` coefficient (below)
// collapses to 0, degenerating to a linear equation solveK doesn't handle.
const BONUS2_BLEND = 0.2

// Solve (1 + 2k + 4*p2Weight) / (1 + k + p2Weight) = targetEv for the
// positive root in [0, 1], where p2Weight = BONUS2_BLEND*k +
// (1-BONUS2_BLEND)*k^2 is p(+2 ranks)/p(normal) - see the BONUS2_BLEND
// comment above for why. Rearranged into a quadratic in k: A*k^2 + B*k + C
// = 0 with A=(1-BONUS2_BLEND)*(4-targetEv), B=(2+4*BONUS2_BLEND) -
// targetEv*(1+BONUS2_BLEND), C=1-targetEv (setting BONUS2_BLEND=0 recovers
// the original A=4-targetEv, B=2-targetEv, C=1-targetEv exactly). See
// CLAUDE.md's lucky-drop section.
//
// targetEv is clamped to [MIN_TARGET_EV, MAX_TARGET_EV] before solving -
// outside that range the quadratic has no root in [0,1] at all, and would
// otherwise silently return something outside it (negative k, or k>1),
// which turns into a negative or >100% "probability" downstream. This
// isn't just a defensive-for-no-reason clamp: targetEv is a live,
// user-editable board field (and CC Management's +30%/+50% EV suggestions
// can push even a moderate base value past the ceiling), so an
// out-of-range input is a real, easy-to-hit case now, not a hypothetical.
export function solveK(targetEv) {
  const clamped = Math.min(Math.max(targetEv, MIN_TARGET_EV), MAX_TARGET_EV)
  const a = (1 - BONUS2_BLEND) * (4 - clamped)
  const b = 2 + 4 * BONUS2_BLEND - clamped * (1 + BONUS2_BLEND)
  const c = 1 - clamped
  const disc = b * b - 4 * a * c
  const sqrtDisc = Math.sqrt(disc)
  const root1 = (-b + sqrtDisc) / (2 * a)
  const root2 = (-b - sqrtDisc) / (2 * a)
  // At clamped === MAX_TARGET_EV exactly, the true root1 is exactly 1 - but
  // MAX_TARGET_EV (7/3) isn't exactly representable in floating point, so
  // root1 can come out a hair above 1 (e.g. 1.0000000000000002) and fail a
  // strict `<= 1` check, wrongly falling through to root2 (a genuinely
  // different, negative root) instead of the intended "clamp the tiny
  // overshoot back to 1". The epsilon absorbs that float noise at both
  // boundaries; the final clamp below still snaps the tiny overshoot itself.
  const EPS = 1e-9
  const k = root1 >= -EPS && root1 <= 1 + EPS ? root1 : root2
  return Math.min(Math.max(k, 0), 1)
}

// [p(normal), p(+1 rank), p(+2 ranks)], summing to 1.
export function computeProbs(targetEv) {
  const k = solveK(targetEv)
  const p2Weight = BONUS2_BLEND * k + (1 - BONUS2_BLEND) * k * k
  const denom = 1 + k + p2Weight
  return [1 / denom, k / denom, p2Weight / denom]
}

// A single true-random roll of 0/1/2 bonus rank steps, weighted by `probs` -
// for the interactive play tester, where a real player expects genuine
// unpredictability on every tap, not a converging sequence. Deliberately
// separate from createEvScheduler below (used by the automatic simulator,
// which wants reproducible aggregate EV math, not player-facing randomness).
export function rollBonus(probs, rng = Math.random) {
  const roll = rng()
  if (roll < probs[0]) return 0
  if (roll < probs[0] + probs[1]) return 1
  return 2
}

// Deterministic deficit round-robin scheduler: repeated calls emit 0/1/2
// (bonus rank steps) whose long-run frequency converges to `probs`, with no
// randomness — the simulation stays fully reproducible instead of needing
// Monte Carlo sampling, per the app's existing expected-value convention.
export function createEvScheduler(probs) {
  const counts = probs.map(() => 0)
  let total = 0
  return function next() {
    total += 1
    let bestIdx = 0
    let bestDeficit = -Infinity
    for (let i = 0; i < probs.length; i++) {
      const deficit = probs[i] * total - counts[i]
      if (deficit > bestDeficit) {
        bestDeficit = deficit
        bestIdx = i
      }
    }
    counts[bestIdx] += 1
    return bestIdx
  }
}

// Monte Carlo sanity-check tool for the economist: "if the generator gets
// tapped `taps` times, how many of each lucky-drop type should I expect?"
// Deliberately a fixed, board-agnostic tap count rather than a real
// playthrough - it always rolls against `probs` directly (as if the rank-7
// gate were already unlocked for the whole run), not a simulated board
// reaching rank 7 partway through. Uses the same true-random `rollBonus`
// the play tester uses, run `runs` independent times so the UI can show
// both the average and the run-to-run spread (min/max), not just a single
// noisy sample.
export function simulateLuckyDrops(targetEv, { taps = 450, runs = 1000 } = {}) {
  const probs = computeProbs(targetEv)
  const normalCounts = []
  const plus1Counts = []
  const plus2Counts = []
  for (let r = 0; r < runs; r++) {
    let normal = 0
    let plus1 = 0
    let plus2 = 0
    for (let t = 0; t < taps; t++) {
      const bonus = rollBonus(probs)
      if (bonus === 0) normal += 1
      else if (bonus === 1) plus1 += 1
      else plus2 += 1
    }
    normalCounts.push(normal)
    plus1Counts.push(plus1)
    plus2Counts.push(plus2)
  }

  const summarize = (samples) => ({
    mean: samples.reduce((sum, v) => sum + v, 0) / samples.length,
    min: Math.min(...samples),
    max: Math.max(...samples),
    // How many of the `runs` simulated players never saw this bonus at all
    // across their `taps` taps - the average can look reassuring while
    // still hiding a real shut-out rate at low targetEv, so this is surfaced
    // as its own number rather than left implicit in "min: 0".
    zeroCount: samples.filter((v) => v === 0).length,
  })

  return { runs, taps, probs, normal: summarize(normalCounts), plus1: summarize(plus1Counts), plus2: summarize(plus2Counts) }
}
