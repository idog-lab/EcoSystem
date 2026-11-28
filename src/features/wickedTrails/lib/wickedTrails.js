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
    lanes: { easy: newLane(3), hard: newLane(3) },
    finalPrize: '',
    // The economy builder (lib/economy/allocate.js): whether it builds the Final Prize, and its rules - hard totals by
    // gameplay section, fillers in order with a max a tier, the lane close to balance every Nth built tier.
    finalAuto: false,
    builder: createBuilder(),
    segments: [],
    baseIndex: 0,
    segmentSet: null,
    startDate: '',
    // The feature's days, from its first day (DR values that change over them are averaged); this app's own start: 2.
    days: 2,
    // The mini game it uses when the calendar does not say ('merge' | 'diamond-mine').
    miniGame: '',
  }
}
// A tier's gameplay section, to start: the first half of a lane easy, the rest mid ("hard is only the GP").
export const defaultSection = (i, n) => (i < Math.ceil(n / 2) ? 'easy' : 'mid')
const newLane = (n) => ({ shares: evenShares(n), prizes: Array(n).fill(''), sections: Array.from({ length: n }, (_, i) => defaultSection(i, n)), auto: Array(n).fill(false) })
export function createBuilder() {
  return { hard: [], fillers: [{ item: 'coins', max: null }], balanceEvery: 2 }
}
function normalizeBuilder(raw) {
  const b = createBuilder()
  if (!raw || typeof raw !== 'object') return b
  const pct = (p) => ({ easy: num(p?.easy) ?? 0, mid: num(p?.mid) ?? 0, hard: num(p?.hard) ?? 0 })
  return {
    hard: (Array.isArray(raw.hard) ? raw.hard : []).filter((h) => h && h.item).map((h) => ({ item: String(h.item), total: num(h.total), pct: pct(h.pct) })),
    fillers: (Array.isArray(raw.fillers) ? raw.fillers : b.fillers).filter((x) => x && x.item).map((x) => ({ item: String(x.item), max: num(x.max) })),
    balanceEvery: Number.isInteger(raw.balanceEvery) && raw.balanceEvery >= 1 ? raw.balanceEvery : 2,
  }
}
function normalizeLane(raw) {
  const shares = (Array.isArray(raw?.shares) ? raw.shares : []).map((s) => num(s) ?? 0).slice(0, MAX_TIERS)
  const n = shares.length || 3
  const prizes = Array.from({ length: n }, (_, i) => String(raw?.prizes?.[i] ?? ''))
  const sections = Array.from({ length: n }, (_, i) => (['easy', 'mid'].includes(raw?.sections?.[i]) ? raw.sections[i] : defaultSection(i, n)))
  const auto = Array.from({ length: n }, (_, i) => raw?.auto?.[i] === true)
  return { shares: shares.length ? shares : evenShares(3), prizes, sections, auto }
}
export function normalizeState(raw) {
  const fresh = createState()
  if (!raw || typeof raw !== 'object') return fresh
  return resolveEfforts({
    rules: { ...fresh.rules, ...Object.fromEntries(Object.entries(raw.rules ?? {}).map(([k, v]) => [k, num(v)])) },
    lanes: { easy: normalizeLane(raw.lanes?.easy), hard: normalizeLane(raw.lanes?.hard) },
    finalPrize: String(raw.finalPrize ?? ''),
    segments: (Array.isArray(raw.segments) ? raw.segments : []).map((s) => ({
      name: String(s.name ?? ''),
      key: String(s.key ?? ''),
      condition: String(s.condition ?? ''),
      // The effort typed (or copied from the set) - or, when `effortOf` names another segment, that segment's x
      // `effortFactor`. `effortBW` is the effort in force, worked out by resolveEfforts.
      effortTyped: num(s.effortTyped ?? s.effortBW),
      effortOf: typeof s.effortOf === 'string' && s.effortOf ? s.effortOf : null,
      effortFactor: num(s.effortFactor),
      effortBW: num(s.effortBW),
      silverPerBW: num(s.silverPerBW),
      goldPerBW: num(s.goldPerBW),
      own: s.own && typeof s.own === 'object' ? Object.fromEntries(Object.entries(s.own).map(([k, v]) => [k, String(v ?? '')])) : {},
    })),
    baseIndex: Number.isInteger(raw.baseIndex) ? raw.baseIndex : 0,
    segmentSet: raw.segmentSet && typeof raw.segmentSet === 'object' ? raw.segmentSet : null,
    startDate: typeof raw.startDate === 'string' ? raw.startDate : '',
    finalAuto: raw.finalAuto === true,
    builder: normalizeBuilder(raw.builder),
    days: Number.isInteger(raw.days) && raw.days >= 1 ? raw.days : 2,
    miniGame: raw.miniGame === 'merge' || raw.miniGame === 'diamond-mine' ? raw.miniGame : '',
  })
}

// A SEGMENT'S EFFORT (economist, 26 Nov 2026: "we should let a segment have an effort that is a factor of another
// segment if we want, and an option to hard code the effort"): typed, or another segment's (by key) x a factor -
// that one may itself follow a third. A chain that comes back to itself, or names a segment not there, has no effort.
// Returns the state with every segment's `effortBW` the effort in force, and `effortProblem` where it has none.
export function resolveEfforts(state) {
  const byKey = new Map(state.segments.map((s) => [s.key, s]))
  const memo = new Map()
  const effortOf = (seg, seen) => {
    if (memo.has(seg.key)) return memo.get(seg.key)
    if (!seg.effortOf) return { value: num(seg.effortTyped), problem: null }
    if (seen.has(seg.key)) return { value: null, problem: 'Its effort follows a segment that follows it back.' }
    const from = byKey.get(seg.effortOf)
    if (!from) return { value: null, problem: 'It follows a segment that is not here any more.' }
    if (num(seg.effortFactor) == null || num(seg.effortFactor) < 0) return { value: null, problem: `Type its factor of ${from.name}.` }
    const r = effortOf(from, new Set([...seen, seg.key]))
    const out = r.value == null ? { value: null, problem: r.problem ?? `${from.name} has no effort yet.` } : { value: round2(r.value * num(seg.effortFactor)), problem: null }
    memo.set(seg.key, out)
    return out
  }
  return {
    ...state,
    segments: state.segments.map((s) => {
      const r = effortOf(s, new Set())
      return { ...s, effortBW: r.value, effortProblem: r.problem }
    }),
  }
}

// A lane with `n` tiers: the shares split evenly again, the prizes kept by place.
export function withTierCount(lane, n) {
  const count = Math.min(MAX_TIERS, Math.max(1, Math.round(n)))
  return {
    shares: evenShares(count),
    prizes: Array.from({ length: count }, (_, i) => lane.prizes[i] ?? ''),
    sections: Array.from({ length: count }, (_, i) => lane.sections?.[i] ?? defaultSection(i, count)),
    auto: Array.from({ length: count }, (_, i) => lane.auto?.[i] ?? false),
  }
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
    // The last tier is the rest of the lane: when the ones before take it all, the last has nothing.
    const before = round2(shares.slice(0, -1).reduce((a, b) => a + b, 0))
    if (shares.length > 1 && !(shares.at(-1) > 0)) out.push(`${lane.label}: the tiers before the last take ${before}% - the last has nothing left.`)
    else if (shares.some((s) => !(s > 0))) out.push(`${lane.label}: every tier needs a share above 0%.`)
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
  if (!(E > 0)) problems.push(seg?.effortProblem ?? 'Needs its effort in Brut Wins.')
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

// THE CARRY BETWEEN A LANE'S TIERS (economist, 26 Nov 2026: "the off by also, should be cumulative, if we are -1 from
// the last tier, we got 1 more allowance to give in the next tier. there is a carry to + or - in the prizes of the
// tiers"). items: a lane's tiers in order, [{ target, worth }] - worth null when it is not known (a part with no worth),
// 0 for a tier with no prize. Each tier's carry is what the tiers before it left (+ more to give, - less); its aim is
// its target plus the carry; off by is its worth against the aim - the lane's running total. Once a worth is not known
// the carry from there on is not known either. Returns [{ carry, aim, off }].
export function carryThrough(items) {
  let carry = 0
  return items.map(({ target, worth }) => {
    if (carry == null || target == null) {
      const out = { carry, aim: null, off: null }
      if (target == null) carry = null
      return out
    }
    const aim = round2(target + carry)
    const off = worth == null ? null : round2(worth - aim)
    // (+ 0: nothing carried reads 0, never -0.)
    const out = { carry: round2(carry) + 0, aim, off: off == null ? null : off + 0 }
    carry = off == null ? null : round2(-off) + 0
    return out
  })
}

// THE BUILD, STEP BY STEP (economist: "the flow of the wicked trails is not good. it should be intuitive how i go on
// with the event build"): what each step still needs, in words. `readable(text)` says whether a prize can be read
// (the economy's checker, passed in). { segments, rules, tiers, prizes } -> { done, missing: [text] }.
export function stepStatus(state, readable = () => true) {
  const segs = state.segments
  const segMissing = []
  if (!segs.length) segMissing.push('Take the segments from a segment set.')
  for (const s of segs) {
    if (!(num(s.effortBW) > 0)) segMissing.push(`${s.name}: ${s.effortProblem ?? 'its effort in Brut Wins.'}`)
    if (!(num(s.silverPerBW) > 0) || !(num(s.goldPerBW) > 0)) segMissing.push(`${s.name}: its silver and gold DR per Brut Win.`)
  }
  const problems = ruleProblems(state)
  const laneProblem = (p) => LANES.some((l) => p.startsWith(`${l.label}:`))
  // The first day: the DR values (puzzle, pet, the mini game) are read from the calendar on the feature's days.
  const rulesMissing = [...(state.startDate ? [] : ["Pick the first day: the DR values are read on the feature's days."]), ...problems.filter((p) => !laneProblem(p))]
  const tiersMissing = problems.filter(laneProblem)
  const prizesMissing = []
  const places = [...LANES.flatMap((l) => state.lanes[l.id].shares.map((_, i) => placeKey(l.id, i))), 'final']
  const label = (place) => (place === 'final' ? 'the Final Prize' : `${LANES.find((l) => place.startsWith(l.id)).label}, tier ${Number(place.split('-')[1]) + 1}`)
  for (const place of places) {
    const text = String(baseText(state, place) ?? '').trim()
    if (!text) prizesMissing.push(`${label(place)}: no prize yet.`)
    else if (!readable(text)) prizesMissing.push(`${label(place)}: the prize cannot be read.`)
  }
  return {
    segments: { done: segMissing.length === 0, missing: segMissing },
    rules: { done: rulesMissing.length === 0, missing: rulesMissing },
    tiers: { done: tiersMissing.length === 0, missing: tiersMissing },
    prizes: { done: prizesMissing.length === 0, missing: prizesMissing },
  }
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
