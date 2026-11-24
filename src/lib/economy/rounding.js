// THE ECONOMY'S ROUNDING RULES (economist, "Economy Rules & Reward Syntax",
// section 5). They have to match the sheets exactly.
//
// Where they apply (economist): "all the rules u got now are applied only on
// prizes we will add to the tiers in the features. all the rules we got from
// befor for small reweards and twister are untouched." So Merge's small
// rewards and the Twister keep their own rounding (rewardChain.js,
// twisterCadence.js); these are for the prizes on a feature's tiers.

const EPS = 1e-9

// Excel's MROUND: the nearest multiple of `multiple`, a half rounded away
// from zero. (A small allowance for float error, so 2.5 / 5 is a half.)
export function mround(x, multiple) {
  const n = Number(x)
  const m = Math.abs(Number(multiple))
  if (!Number.isFinite(n) || !(m > 0)) return NaN
  const q = Math.abs(n) / m
  const r = Math.floor(q + 0.5 + EPS) * m
  return clean(Math.sign(n) * r)
}

// Excel's ROUND to `digits` decimals, a half away from zero.
export function roundTo(x, digits = 0) {
  const n = Number(x)
  if (!Number.isFinite(n)) return NaN
  const f = 10 ** digits
  return clean((Math.sign(n) * Math.floor(Math.abs(n) * f + 0.5 + EPS)) / f)
}

// Float noise off a result (0.30000000000000004 -> 0.3).
function clean(x) {
  return Number.parseFloat(Number(x).toPrecision(12)) + 0
}

// RoundReward - reward and threshold values of a tier:
//   |x| < 90         nearest 5, and a 5 becomes 10 (5 is never shown)
//   90 <= |x| <= 200 down to the 10
//   |x| > 200        nearest 50
// The sign is kept.
export function roundReward(x) {
  const n = Number(x)
  if (!Number.isFinite(n)) return NaN
  const a = Math.abs(n)
  let r
  if (a < 90) {
    r = mround(a, 5)
    if (r === 5) r = 10
  } else if (a <= 200) {
    r = Math.floor(a / 10 + EPS) * 10
  } else {
    r = mround(a, 50)
  }
  return clean(Math.sign(n) * r)
}

// MergeRoundReward:
//   x <= 30   nearest 2, at least 2
//   x <= 150  nearest 5, at least 5
//   x <= 200  nearest 10
//   else      nearest 50
// (A tier prize rule. Merge's small rewards keep their own rounding.)
export function mergeRoundReward(x) {
  const n = Number(x)
  if (!Number.isFinite(n)) return NaN
  if (n <= 30) return Math.max(2, mround(n, 2))
  if (n <= 150) return Math.max(5, mround(n, 5))
  if (n <= 200) return mround(n, 10)
  return mround(n, 50)
}

// The step of a spin or point cost: 10 above 100, 5 above 26, 2 above 10,
// otherwise 1.
export function costStep(x) {
  const n = Number(x)
  if (n > 100) return 10
  if (n > 26) return 5
  if (n > 10) return 2
  return 1
}
// A spin or point cost: max(1, MROUND(x, step)).
export function roundCost(x) {
  const n = Number(x)
  if (!Number.isFinite(n)) return NaN
  return Math.max(1, mround(n, costStep(n)))
}

// An alternative DR's amount: MROUND to 5 above 8 units, else to 1; at least 1.
export function roundAltDrAmount(x) {
  const n = Number(x)
  if (!Number.isFinite(n)) return NaN
  return Math.max(1, mround(n, n > 8 ? 5 : 1))
}

// Puzzle pieces as a fallback: MROUND to 5, at least 5 (some features use 10).
export function roundPuzzleFallback(x, step = 5) {
  const n = Number(x)
  if (!Number.isFinite(n)) return NaN
  return Math.max(step, mround(n, step))
}

// A resource given instead of an allowance: round(allowance / value), at
// least 1, then the cap.
export function resourceCount(allowance, value, cap = null) {
  const a = Number(allowance)
  const v = Number(value)
  if (!Number.isFinite(a) || !(v > 0)) return NaN
  const n = Math.max(roundTo(a / v, 0), 1)
  return cap != null && Number(cap) > 0 ? Math.min(n, Number(cap)) : n
}

// Coins in syntax: 2 decimals.
export const roundCoins = (x) => roundTo(x, 2)

// The rules as the Economy page lists them, with where each is used.
export const ROUNDING_RULES = [
  { id: 'roundReward', name: 'RoundReward', fn: roundReward, rule: 'Under 90: nearest 5, and 5 becomes 10. 90 to 200: down to the 10. Above 200: nearest 50. Sign kept.', usedFor: 'Reward and threshold values of a tier. The Chef grand prize.', examples: [3, 7, 42, 88, 95, 199, 230, 1260] },
  { id: 'mergeRoundReward', name: 'MergeRoundReward', fn: mergeRoundReward, rule: 'Up to 30: nearest 2, at least 2. Up to 150: nearest 5, at least 5. Up to 200: nearest 10. Above: nearest 50.', usedFor: 'Tier prizes of a Merge feature. Not Merge Mania\'s small rewards - they keep their own rounding.', examples: [1, 13, 31, 147, 178, 260] },
  { id: 'roundCost', name: 'Spin or point cost', fn: roundCost, rule: 'Step 10 above 100, 5 above 26, 2 above 10, else 1. At least 1.', usedFor: 'A feature\'s spin or point cost. Not the Twister\'s price, which can be any whole number.', examples: [0.4, 9, 13, 27, 104] },
  { id: 'roundAltDrAmount', name: 'Alternative DR amount', fn: roundAltDrAmount, rule: 'Above 8 units: to the 5. Else to the 1. At least 1.', usedFor: 'The amount of a second currency given instead of the first.', examples: [0.3, 6.4, 12, 23] },
  { id: 'roundPuzzleFallback', name: 'Puzzle pieces as a fallback', fn: roundPuzzleFallback, rule: 'To the 5, at least 5 (some features use 10).', usedFor: 'Puzzle pieces given when a feature\'s currency cannot be.', examples: [2, 12, 38] },
  { id: 'roundCoins', name: 'Coins in syntax', fn: roundCoins, rule: '2 decimals.', usedFor: 'Coins written into a tier prize. Merge Mania\'s small rewards keep up to 3 decimals when they are small (economist).', examples: [0.125, 3.14159, 4.655] },
]
