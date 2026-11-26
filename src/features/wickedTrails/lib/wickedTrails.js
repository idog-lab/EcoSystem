// WICKED TRAILS (economist, 26 Nov 2026): a level feature with two lanes - Easy (silver DR) and Hard (gold DR) - and
// one Final Prize for finishing both. "the feature has 2 progress bars in it. each one is filled using the DR u can see
// in the side of the progress bar. each DR as we said is given through a brut win ... the calculation is through (in
// levels feature) ROE, rate of economy is the allowance worth of prizes a player gets from a BW. it should let us pick
// the amount of tiers in each row, and to put prizes in the grand prize." Asked, and answered:
//   - both lanes fill together, each from Brut Wins by its own multiplier ("Two per segment": silver DR per BW, gold
//     DR per BW); "first each BW will split the ROE between the 2 DRs" by a share typed ("A share I type"), and "when
//     one lane is finished, the economy of the first one is given to the DR of the 2nd one";
//   - the easy lane's length against the hard one is a share typed ("A share I type"); the hard lane lasts the
//     segment's whole effort;
//   - a lane's tiers are shares of the lane that add up to 100% ("Shares of the lane");
//   - "each feature gets a ROE": one ROE for Wicked Trails;
//   - the Final Prize by the sheet's rule ("Sheet's rule: 20% / 40% take"): the easy lane gives 20% of what it earns to
//     the Final Prize, the hard lane 40%; the tiers get the rest; the Final Prize is counted at 50% of its worth
//     against that pool (so its worth should be the pool / 50%).
// Segments come from a segment set (Economy page), each with its effort in Brut Wins. Prizes are typed on the base
// segment; another segment's are the base's times its effort against the base's (worth follows effort), unless typed.
import { scaleReward } from '../../../lib/economy/prizeWorth'

export const STORAGE_KEY = 'superplay-wicked-trails'
export const FEATURE_NAME = 'Wicked_Trails'
export const LANES = [
  { id: 'easy', label: 'Easy lane', currency: 'dr-wicked-trails-dr-silver', dr: 'silver DR', perBW: 'silverPerBW' },
  { id: 'hard', label: 'Hard lane', currency: 'dr-wicked-trails-dr-gold', dr: 'gold DR', perBW: 'goldPerBW' },
]
// 1 to 8 tiers a lane: the export has milestones 0-7 (this app's own limit, from the old sheet's export).
export const MAX_TIERS = 8
// The sheet's check on how many prizes a reward holds: 4 in a tier, 5 in the Final Prize - a warning, not a rule.
export const PRIZE_LIMIT = { tier: 4, final: 5 }

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const round2 = (x) => Math.round(x * 100) / 100
const evenShares = (n) => {
  const base = Math.floor((100 / n) * 100) / 100
  const out = Array.from({ length: n }, () => base)
  out[n - 1] = round2(100 - base * (n - 1))
  return out
}

// The rules of the feature, in %. Starting values: the old sheet's (easy lane half the hard one, so a third of each
// BW's ROE while both fill; takes 20% and 40%; the Final Prize counted at 50%) - shown as such, typed over freely.
export function createRules() {
  return { roe: null, easyShare: 33.33, easySize: 50, takeEasy: 20, takeHard: 40, finalCounted: 50 }
}
export function createState() {
  return {
    rules: createRules(),
    lanes: { easy: { shares: evenShares(3), prizes: ['', '', ''] }, hard: { shares: evenShares(3), prizes: ['', '', ''] } },
    finalPrize: '',
    segments: [],
    baseIndex: 0,
    segmentSet: null,
  }
}
function normalizeLane(raw) {
  const shares = (Array.isArray(raw?.shares) ? raw.shares : []).map((s) => num(s) ?? 0).slice(0, MAX_TIERS)
  const n = shares.length || 3
  const prizes = Array.from({ length: n }, (_, i) => String(raw?.prizes?.[i] ?? ''))
  return { shares: shares.length ? shares : evenShares(3), prizes }
}
export function normalizeState(raw) {
  const fresh = createState()
  if (!raw || typeof raw !== 'object') return fresh
  return {
    rules: { ...fresh.rules, ...Object.fromEntries(Object.entries(raw.rules ?? {}).map(([k, v]) => [k, num(v)])) },
    lanes: { easy: normalizeLane(raw.lanes?.easy), hard: normalizeLane(raw.lanes?.hard) },
    finalPrize: String(raw.finalPrize ?? ''),
    segments: (Array.isArray(raw.segments) ? raw.segments : []).map((s) => ({
      name: String(s.name ?? ''),
      key: String(s.key ?? ''),
      condition: String(s.condition ?? ''),
      effortBW: num(s.effortBW),
      silverPerBW: num(s.silverPerBW),
      goldPerBW: num(s.goldPerBW),
      own: s.own && typeof s.own === 'object' ? Object.fromEntries(Object.entries(s.own).map(([k, v]) => [k, String(v ?? '')])) : {},
    })),
    baseIndex: Number.isInteger(raw.baseIndex) ? raw.baseIndex : 0,
    segmentSet: raw.segmentSet && typeof raw.segmentSet === 'object' ? raw.segmentSet : null,
  }
}

// A lane with `n` tiers: the shares split evenly again, the prizes kept by place.
export function withTierCount(lane, n) {
  const count = Math.min(MAX_TIERS, Math.max(1, Math.round(n)))
  return { shares: evenShares(count), prizes: Array.from({ length: count }, (_, i) => lane.prizes[i] ?? '') }
}

// What is wrong with the rules or a lane, in words.
export function ruleProblems(state) {
  const r = state.rules
  const out = []
  if (!(num(r.roe) > 0)) out.push('Type the ROE: the allowance worth of prizes a player gets from one Brut Win.')
  if (!(num(r.easyShare) >= 0 && num(r.easyShare) <= 100)) out.push('The easy lane\'s share of each Brut Win is 0 to 100%.')
  if (!(num(r.easySize) > 0 && num(r.easySize) <= 100)) out.push('The easy lane is more than 0% and at most 100% of the hard one.')
  for (const k of ['takeEasy', 'takeHard']) if (!(num(r[k]) >= 0 && num(r[k]) < 100)) out.push('What a lane gives the Final Prize is 0 to under 100%.')
  if (!(num(r.finalCounted) > 0 && num(r.finalCounted) <= 100)) out.push('The Final Prize is counted at more than 0% and at most 100%.')
  for (const lane of LANES) {
    const shares = state.lanes[lane.id].shares
    const sum = round2(shares.reduce((a, b) => a + b, 0))
    if (shares.some((s) => !(s > 0))) out.push(`${lane.label}: every tier needs a share above 0%.`)
    if (Math.abs(sum - 100) > 0.01) out.push(`${lane.label}: the tiers add up to ${sum}%, not 100%.`)
  }
  return [...new Set(out)]
}

// ONE SEGMENT, WORKED OUT. E Brut Wins; the easy lane finishes after easySize x E, the hard lane at E. While both
// fill, each BW's ROE goes easyShare to the easy lane and the rest to the hard lane; after the easy lane is done, all
// of it to the hard lane. A tier earns what its lane earned between the tier before and itself; the lane gives its
// take of that to the Final Prize and the tier's target is the rest.
// Returns { problems, E, lanes: { easy, hard }, pool, finalTarget, total } - each lane { totalDR, doneAtBW, earned,
// tiers: [{ share, cumShare, dr, drTotal, bwFrom, bwTo, earned, take, target }] }.
export function workOut(state, seg) {
  const problems = ruleProblems(state)
  const E = num(seg?.effortBW)
  if (!(E > 0)) problems.push('Needs its effort in Brut Wins.')
  for (const lane of LANES) if (!(num(seg?.[lane.perBW]) > 0)) problems.push(`Needs its ${lane.dr} per Brut Win.`)
  if (problems.length) return { problems, E, lanes: null, pool: null, finalTarget: null, total: null }
  const r = state.rules
  const roe = num(r.roe)
  const a = num(r.easyShare) / 100
  const easyEnd = (num(r.easySize) / 100) * E
  // What a lane earns between two moments (in Brut Wins played).
  // (Easy: its share of every BW until it is done. Hard: the whole ROE of every BW less what the easy lane took.)
  const easyEarn = (b0, b1) => roe * a * (Math.min(b1, easyEnd) - Math.min(b0, easyEnd))
  const earn = { easy: easyEarn, hard: (b0, b1) => roe * (b1 - b0) - easyEarn(b0, b1) }
  const lanes = {}
  let poolExact = 0
  for (const lane of LANES) {
    const end = lane.id === 'easy' ? easyEnd : E
    const perBW = num(seg[lane.perBW])
    const totalDR = end * perBW
    const take = num(lane.id === 'easy' ? r.takeEasy : r.takeHard) / 100
    let cum = 0
    let prevDR = 0
    const tiers = state.lanes[lane.id].shares.map((share) => {
      const from = cum
      cum = round2(cum + share)
      const bwFrom = (from / 100) * end
      const bwTo = (Math.min(cum, 100) / 100) * end
      const drTotal = Math.round((Math.min(cum, 100) / 100) * totalDR)
      const dr = drTotal - prevDR
      prevDR = drTotal
      const earned = earn[lane.id](bwFrom, bwTo)
      poolExact += earned * take
      return { share, cumShare: cum, dr, drTotal, bwFrom: round2(bwFrom), bwTo: round2(bwTo), earned: round2(earned), take: round2(earned * take), target: round2(earned * (1 - take)) }
    })
    lanes[lane.id] = { totalDR: Math.round(totalDR), doneAtBW: round2(end), earned: round2(earn[lane.id](0, end)), tiers }
  }
  return { problems: [], E, lanes, pool: round2(poolExact), finalTarget: round2(poolExact / (num(r.finalCounted) / 100)), total: round2(roe * E) }
}

// The prize of a place ('easy-0', 'hard-2', 'final') for a segment: its own where typed, else the base's times the
// segment's effort against the base's. { text, own }.
export const placeKey = (laneId, i) => `${laneId}-${i}`
export function baseText(state, place) {
  if (place === 'final') return state.finalPrize
  const [laneId, i] = place.split('-')
  return state.lanes[laneId]?.prizes?.[Number(i)] ?? ''
}
export function prizeOf(state, index, place) {
  const seg = state.segments[index]
  const own = String(seg?.own?.[place] ?? '').trim()
  if (own) return { text: own, own: true }
  const text = String(baseText(state, place) ?? '').trim()
  if (!text) return { text: '', own: false }
  if (index === state.baseIndex) return { text, own: true }
  const base = state.segments[state.baseIndex]
  const factor = num(seg?.effortBW) > 0 && num(base?.effortBW) > 0 ? num(seg.effortBW) / num(base.effortBW) : null
  return { text: factor ? scaleReward(text, factor) : text, own: false, factor }
}

// WHERE A PLAYER IS after `bw` Brut Wins (the mock): per lane the DR collected, the tiers done, the tier being filled
// and how far into it; and whether both lanes are done.
export function progressAt(work, seg, bw) {
  if (!work?.lanes) return null
  const out = {}
  for (const lane of LANES) {
    const l = work.lanes[lane.id]
    const played = Math.max(0, Math.min(bw, l.doneAtBW))
    const collected = Math.min(l.totalDR, Math.round(played * num(seg[lane.perBW])))
    const done = l.tiers.filter((t) => collected >= t.drTotal).length
    const current = l.tiers[done] ?? null
    const into = current ? collected - (current.drTotal - current.dr) : 0
    out[lane.id] = { collected, done, finished: done === l.tiers.length, into, need: current?.dr ?? 0 }
  }
  out.lanesDone = LANES.filter((l) => out[l.id].finished).length
  return out
}
