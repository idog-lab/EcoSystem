// Repeatable randomness for the Chef engine.
//
// KEYED STREAMS. Every random thing a player meets has an identity of its own
// - this player's activity, this player's place among the recipients of a
// sale, the size of the 2nd Rare basket of day 7, the draws inside that basket
// - and takes its numbers from a stream made from that identity alone
// (`keyedRng`). So a change to the event (one more basket, a catch-up preset,
// other odds) never moves the numbers any OTHER basket rolls with: two plays
// of the same players differ by what was changed and by nothing else. Before
// this the engine had four streams shared by everything in a run, and one more
// basket shifted every basket opened after it (an extra basket that gave
// nothing moved the average prize by 0.63).
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

function mix(h, n) {
  h = (h ^ (n | 0)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  h ^= h >>> 16
  return h >>> 0
}

// A text (an id, a tag) as a number.
export function hashText(text) {
  let h = 2166136261
  const s = String(text)
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

// A stream for one identity: the seed and the parts of the identity (numbers,
// or texts - a text is hashed). The same parts always give the same stream.
export function keyedRng(seed, ...parts) {
  let h = mix(0x9e3779b9, seed)
  for (const part of parts) h = mix(h, typeof part === 'number' ? part : hashText(part))
  return mulberry32(h)
}

export function createRng(seed) {
  return mulberry32(seed >>> 0)
}

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31)
}

// HOW SURE A SHARE IS. A share measured on a few hundred simulated players is
// an estimate: with other players it would come out a little different. This
// is the range the true share is in, 19 times in 20 (the Wilson interval -
// unlike the plain "plus or minus", it stays honest at 0% and 100% and with
// few players). It is NOT the spread of the players' outcomes: "most players
// cook 9 to 12" describes players; this describes how well a share is known.
export function shareInterval(count, n) {
  if (!(n > 0)) return { share: null, low: null, high: null, n: 0 }
  const z = 1.96
  const p = count / n
  const denom = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom
  return { share: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half), n }
}

// The older "plus or minus" (kept for the callers that still show one number).
export function binomialMarginOfError(p, n) {
  if (n <= 0) return null
  return 1.96 * Math.sqrt((p * (1 - p)) / n)
}
