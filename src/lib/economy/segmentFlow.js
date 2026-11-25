// THE FLOW OF BUILDING A FEATURE'S SEGMENTS (economist, 25 Nov 2026: "we need first to let the user give the
// feature name, then ... we pick the number of segments then we give the rule for each segment. we need to let the
// model be able to know the base of the segment. then specific, or duplication. a specific will just be added to
// the specific segments that the user picks. duplications will be used for now with the average modes. we will
// pick which segments will get mode splits and what splits").
//
//   1. The feature's name.
//   2. The BASE: the bands of one rule (the band ends give the number of segments and each one's rule) - Brut
//      Wins most of the time ("the brut wins bands are pretty nicelly built"), but any rule of BASE_RULES ("the
//      base is not 100% of the time will be brutwins").
//   3. SPECIFICS: a condition of parts (segmentFunctions.js) added with && to the segments picked; its TAG, typed,
//      is added to their names (asked: "A tag I type is added") - Disco_BW_0_9 -> Disco_BW_0_9_OOC.
//   4. DUPLICATIONS (the average mode, for now): the segments picked are split by mode at the values given - one
//      split value makes two segments of one, as the rules' _Mode_0_3 / _Mode_3_plus; more values, more.
// Name: <Feature>_<code>_<min>_<max|Plus>[_<tag>...][_Mode_<lo>_<hi|plus>] (code: BW, Level, ...) - a tag before the mode (this app's own
// order, said on screen). A specific leaves out the players of its segments who do not match it - a hole in the
// segments: warned, nothing added (economist: "it shouldnt add a segments for the rest, but it should warn when
// there are holes i nthe segments").

import { BRUT_WINS_FN, MODE_FN, STANDARD_WEIGHTS, bandsFromCuts, checkBands, decimalLiteral, segmentKey, thresholdLiteral, weightedExpression } from './segments'
import { buildCondition, readCondition } from './segmentFunctions'

const TAG = /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*$/

export const createSpecific = (n = 1) => ({ id: `specific-${Date.now().toString(36)}-${n}`, tag: '', parts: [{ kind: 'balance', eventId: '', op: '<', value: 2 }], segments: [] })
export const createSplit = (n = 1) => ({ id: `split-${Date.now().toString(36)}-${n}`, values: '3', segments: [] })
// baseRule: the rule the segments are cut by (BASE_RULES); cuts: its band ends; cutsByRule: the band ends typed
// for the other rules, kept while another is the base; baseDays / baseEventId: the win rate's days, a
// progression's event.
export const createPlan = () => ({ feature: 'Disco', baseRule: 'bw', cuts: '9, 18, 40, 60, 100, 150, 240', cutsByRule: {}, baseDays: 7, baseEventId: '', weights: STANDARD_WEIGHTS, specifics: [], splits: [] })

// The plan with another rule as the base: the band ends of the one before are kept for it.
export function withBaseRule(plan, id) {
  const next = baseRule(id)
  const cutsByRule = { ...(plan.cutsByRule ?? {}), [baseRule(plan.baseRule).id]: plan.cuts }
  return { ...plan, baseRule: next.id, cuts: cutsByRule[next.id] ?? next.cuts, cutsByRule }
}

// "3" or "2, 4" -> [2, 4]; what is not a number above 0 is `bad`.
export function parseSplitValues(text) {
  const raw = String(text ?? '').split(/[\s,;]+/).filter(Boolean)
  const bad = raw.filter((v) => !(Number(v) > 0))
  const values = [...new Set(raw.map(Number).filter((n) => n > 0))].sort((a, b) => a - b)
  return { values, bad }
}

// The mode ranges of a split at [2, 4]: 0-2, 2-4, 4-plus; their conditions and name parts.
export function modeRanges(values, weights = STANDARD_WEIGHTS) {
  const md = weightedExpression(MODE_FN, { weights })
  const ranges = []
  let lo = 0
  for (const v of [...values, null]) {
    const parts = []
    if (lo > 0) parts.push(`(${md} >= ${decimalLiteral(lo)})`)
    if (v != null) parts.push(`(${md} < ${decimalLiteral(v)})`)
    ranges.push({ lo, hi: v, name: v == null ? `Mode_${lo}_plus` : `Mode_${lo}_${v}`, condition: parts.join(' && ') })
    lo = v
  }
  return ranges
}

// THE RULES THAT CAN BE THE BASE (economist, 25 Nov 2026: "the base is not 100% of the time will be brutwins. a
// rule should be toggalable as base or not"; asked: one rule at a time, cut into "Bands, like Brut Wins", named by
// "Fixed codes per rule" - "Use these codes"). A band is above its start and at most its end, as Brut Wins.
//   code: the name's part (Disco_Level_100_300); literal: how a band end is written; whole: whole numbers only;
//   max: the highest band end; needsDays / needsEvent: an input of the function; cuts: a starting example (this
//   app's own, to be typed over).
const bare = (n) => String(Number(n))
export const BASE_RULES = [
  { id: 'bw', code: 'BW', label: 'Brut Wins', literal: thresholdLiteral, cuts: '9, 18, 40, 60, 100, 150, 240', weighted: true },
  { id: 'mode', code: 'Mode', label: 'Average mode multiplier', literal: decimalLiteral, cuts: '2, 4', weighted: true },
  { id: 'balance', code: 'Balance', label: 'Balance (allowance)', literal: thresholdLiteral, cuts: '2, 10, 50' },
  { id: 'level', code: 'Level', label: 'Current level', literal: thresholdLiteral, cuts: '100, 300, 519', whole: true },
  // (The win rate's share is written with no m - economist: "0.9 without m is right".)
  { id: 'winrate', code: 'WinRate', label: 'Average win rate', literal: bare, cuts: '0.5, 0.9', max: 1, needsDays: true },
  { id: 'dm-progression', code: 'DMProg', label: 'Diamond Mine progression (%)', literal: thresholdLiteral, cuts: '50, 95', max: 100, needsEvent: true },
  { id: 'merge-progression', code: 'MergeProg', label: 'Merge progression (%)', literal: thresholdLiteral, cuts: '50, 95', max: 100, needsEvent: true },
  // Chef dishes finished in an event. Its code is this app's own (economist: "no namds for the chef. put someting
  // looks good in the naming"); each comparison in brackets, as their example: (...?.Count() > 10).
  { id: 'chef-dishes', code: 'ChefDishes', label: 'Chef dishes finished', literal: thresholdLiteral, cuts: '10, 30', whole: true, needsEvent: true, wrap: true },
]
export const baseRule = (id) => BASE_RULES.find((r) => r.id === id) ?? BASE_RULES[0]

// What a base rule measures, as written in a condition.
function baseExpression(rule, plan) {
  const weights = String(plan.weights ?? STANDARD_WEIGHTS).replace(/\s+/g, '')
  const id = String(plan.baseEventId ?? '').trim().replace(/U$/i, '')
  switch (rule.id) {
    case 'bw':
      return weightedExpression(BRUT_WINS_FN, { weights })
    case 'mode':
      return weightedExpression(MODE_FN, { weights })
    case 'balance':
      return 'CoinsInAllowance'
    case 'level':
      return 'CurrentLevel'
    case 'winrate':
      return `fn_Avg_winrate(${Number(plan.baseDays ?? 7)})`
    case 'dm-progression':
      return `fn_DiamondMine_Progression(${id}U)`
    case 'merge-progression':
      return `fn_Merge_Progression(${id}U)`
    case 'chef-dishes':
      return `GetMTXEventDataListAsStr(${id}U, "CompletedItems")?.Count()`
    default:
      return ''
  }
}

// One band of a base rule: the first "at most" its end, the last "above" its start, the others both.
function bandCondition(expr, rule, { min, max }) {
  const parts = []
  if (Number(min ?? 0) > 0) parts.push(`${expr} > ${rule.literal(min)}`)
  if (max != null && max !== '') parts.push(`${expr} <= ${rule.literal(max)}`)
  return parts.map((x) => (rule.wrap ? `(${x})` : x)).join(' && ')
}

// The base segments: one a band of the base rule. [{ index, min, max, name, condition }]
export function baseSegments(plan) {
  const feature = String(plan.feature ?? '').trim().replace(/\s+/g, '_') || 'Feature'
  const rule = baseRule(plan.baseRule)
  const cuts = String(plan.cuts ?? '').split(/[\s,;]+/).filter(Boolean)
  const bands = bandsFromCuts(cuts)
  const expr = baseExpression(rule, plan)
  return bands.map((b, index) => ({ index, ...b, name: `${feature}_${rule.code}_${b.min ?? 0}_${b.max == null ? 'Plus' : b.max}`, condition: bandCondition(expr, rule, b) }))
}

// Every segment of the plan, and what is wrong or worth a look.
// Returns { base, segments: [{ name, key, condition, base, tags, mode }], errors: [text], warnings: [text] }
export function buildPlan(plan) {
  const errors = []
  const warnings = []
  const feature = String(plan.feature ?? '').trim()
  if (!feature) errors.push('Type the feature\'s name.')
  else if (!/^[A-Za-z0-9_ ]+$/.test(feature)) errors.push('A feature\'s name is letters, digits and "_".')
  const rule = baseRule(plan.baseRule)
  const cutList = String(plan.cuts ?? '').split(/[\s,;]+/).filter(Boolean)
  const badCuts = cutList.filter((c) => !(Number(c) > 0))
  if (badCuts.length) errors.push(`Not a band end: ${badCuts.join(', ')}.`)
  const nums = cutList.map(Number).filter((n) => n > 0)
  if (rule.whole && nums.some((n) => !Number.isInteger(n))) errors.push(`${rule.label}: band ends are whole numbers.`)
  if (rule.max != null && nums.some((n) => n >= rule.max)) errors.push(`${rule.label}: band ends are below ${rule.max}.`)
  if (rule.needsDays && !(Number.isInteger(Number(plan.baseDays)) && Number(plan.baseDays) >= 1)) errors.push(`${rule.label}: the last days are a whole number, at least 1.`)
  if (rule.needsEvent) {
    const id = String(plan.baseEventId ?? '').trim().replace(/U$/i, '')
    if (!id) errors.push(`${rule.label}: type the event id.`)
    else if (!/^\d+$/.test(id)) errors.push(`${rule.label}: "${plan.baseEventId}" is not an event id - digits only.`)
  }
  const base = baseSegments(plan)
  errors.push(...checkBands(base))
  const weights = String(plan.weights ?? STANDARD_WEIGHTS).replace(/\s+/g, '')
  const inRange = (i) => Number.isInteger(i) && i >= 0 && i < base.length

  // Specifics: a tag and a condition each.
  const specifics = (plan.specifics ?? []).map((s, n) => {
    const label = s.tag ? `"${s.tag}"` : `Specific ${n + 1}`
    const { condition, problems } = buildCondition(s.parts)
    if (!s.tag) errors.push(`${label}: type its tag - it is added to the names of its segments.`)
    else if (!TAG.test(s.tag)) errors.push(`${label}: a tag is letters and digits, with "_" between words.`)
    if (!(s.parts ?? []).length) errors.push(`${label}: it has no part.`)
    else if (problems.length) errors.push(`${label}: ${problems.map((p) => `part ${p.index + 1} - ${p.problems.join(' ')}`).join('; ')}`)
    const picked = (s.segments ?? []).filter(inRange)
    if (!picked.length) warnings.push(`${label} is added to no segment yet: pick its segments.`)
    return { ...s, label, condition, picked }
  })
  const tags = specifics.map((s) => s.tag).filter(Boolean)
  const twice = tags.filter((t, i) => tags.indexOf(t) !== i)
  if (twice.length) errors.push(`The tag "${twice[0]}" is given to two specifics: one each.`)

  // Duplications: the mode splits.
  const splitOf = new Map()
  const splits = (plan.splits ?? []).map((d, n) => {
    const label = `Mode split ${n + 1}`
    const { values, bad } = parseSplitValues(d.values)
    if (bad.length) errors.push(`${label}: not a split value: ${bad.join(', ')}.`)
    if (!values.length) errors.push(`${label}: type where the mode is split (3, or 2, 4).`)
    const picked = (d.segments ?? []).filter(inRange)
    if (!picked.length) warnings.push(`${label} splits no segment yet: pick its segments.`)
    for (const i of picked) {
      if (splitOf.has(i)) errors.push(`${base[i].name} is in two mode splits (${splitOf.get(i).label} and ${label}): one each.`)
      else splitOf.set(i, { label, values })
    }
    return { ...d, label, values, picked }
  })

  // The segments.
  const segments = []
  for (const b of base) {
    const mine = specifics.filter((s) => s.picked.includes(b.index))
    const extra = mine.map((s) => s.condition).filter(Boolean)
    const tagged = [b.name, ...mine.map((s) => s.tag).filter(Boolean)].join('_')
    const condition = [b.condition, ...extra].filter(Boolean).join(' && ')
    if (mine.length) {
      const words = mine.flatMap((s) => (s.condition ? readCondition(s.condition).clauses : [])).join(' and ')
      if (words) warnings.push(`A hole in ${b.name}: its players who are not "${words}" are in no segment - ${tagged} holds only those who are.`)
    }
    const split = splitOf.get(b.index)
    if (split && split.values.length) {
      for (const r of modeRanges(split.values, weights)) {
        const name = `${tagged}_${r.name}`
        segments.push({ name, key: segmentKey(name), condition: [condition, r.condition].filter(Boolean).join(' && '), base: b.index, tags: mine.map((s) => s.tag), mode: r })
      }
    } else segments.push({ name: tagged, key: segmentKey(tagged), condition, base: b.index, tags: mine.map((s) => s.tag), mode: null })
  }
  const names = segments.map((s) => s.name)
  const clash = names.find((n, i) => names.indexOf(n) !== i)
  if (clash) errors.push(`Two segments are named ${clash}.`)
  return { base, segments, specifics, splits, errors: [...new Set(errors)], warnings: [...new Set(warnings)] }
}

// The segments as a table to paste into a sheet.
export const planTable = (segments) => ['Name\tKey\tCondition', ...segments.map((s) => `${s.name}\t${s.key}\t${s.condition}`)].join('\n')
