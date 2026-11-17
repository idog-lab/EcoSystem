// A small seedable PRNG (mulberry32) - by explicit economist request
// (channeling a GPT brainstorm review), for reproducible Monte Carlo runs.
// `Math.random()` can never be replayed, which makes it impossible to
// cleanly A/B two configs ("did this change really help, or is that just
// noise") - a fixed seed makes two runs bit-for-bit comparable.
function mulberry32(seed) {
  let a = seed >>> 0
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(seed, salt) {
  let h = (seed ^ salt) >>> 0
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  h ^= h >>> 16
  return h >>> 0
}

export function createRng(seed) {
  return mulberry32(seed >>> 0)
}

// Four INDEPENDENT streams, one per "axis" of randomness in the simulator -
// by explicit design note (a real risk GPT's review caught): if every roll
// shared one stream, changing a basket's odds would change how many random
// numbers that config consumes, which would shift every LATER roll
// (activity, grants, whatever comes next) even though nothing about THEM
// changed - silently breaking the "same seed = fair paired comparison"
// guarantee for anything downstream. Separating by axis means a change to
// basket odds can only ever desync the `basketSize`/`ingredientPick`
// streams, leaving `activity` and `grants` bit-identical across the two
// configs being compared.
export function createRngStreams(seed) {
  return {
    activity: createRng(hashSeed(seed, 1)),
    grants: createRng(hashSeed(seed, 2)),
    basketSize: createRng(hashSeed(seed, 3)),
    ingredientPick: createRng(hashSeed(seed, 4)),
  }
}

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31)
}

// A rough 95% margin for a sampled proportion `p` over `n` independent
// trials (normal approximation to the binomial - good enough at the
// run-counts this simulator uses, not meant for tiny n). By explicit
// economist request (GPT's review): P10/P50/P90 describe the spread of
// player OUTCOMES, not the uncertainty of the estimate itself - a rate
// measured from a few hundred runs should always be shown with how much
// it could plausibly be off by.
export function binomialMarginOfError(p, n) {
  if (n <= 0) return null
  return 1.96 * Math.sqrt((p * (1 - p)) / n)
}
