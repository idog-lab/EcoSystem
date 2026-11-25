// THE FLOW OF BUILDING A FEATURE'S SEGMENTS (economist, 25 Nov 2026: "we need first to let the user give the
// feature name, then ... we pick the number of segments then we give the rule for each segment. we need to let the
// model be able to know the base of the segment. then specific, or duplication. a specific will just be added to
// the specific segments that the user picks. duplications will be used for now with the average modes. we will
// pick which segments will get mode splits and what splits").
//
//   1. The feature's name.
//   2. The BASE: the Brut Wins bands (the band ends give the number of segments and each one's rule - "the brut
//      wins bands are pretty nicelly built").
//   3. SPECIFICS: a condition of parts (segmentFunctions.js) added with && to the segments picked; its TAG, typed,
//      is added to their names (asked: "A tag I type is added") - Disco_BW_0_9 -> Disco_BW_0_9_OOC.
//   4. DUPLICATIONS (the average mode, for now): the segments picked are split by mode at the values given - one
//      split value makes two segments of one, as the rules' _Mode_0_3 / _Mode_3_plus; more values, more.
// Name: <Feature>_BW_<min>_<max|Plus>[_<tag>...][_Mode_<lo>_<hi|plus>] - a tag before the mode (this app's own
// order, said on screen). A specific leaves out the players of its segments who do not match it - a hole in the
// segments: warned, nothing added (economist: "it shouldnt add a segments for the rest, but it should warn when
// there are holes i nthe segments").

import { MODE_FN, STANDARD_WEIGHTS, bandsFromCuts, checkBands, decimalLiteral, segmentCondition, segmentKey, segmentName, weightedExpression } from './segments'
import { buildCondition, readCondition } from './segmentFunctions'

const TAG = /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*$/

export const createSpecific = (n = 1) => ({ id: `specific-${Date.now().toString(36)}-${n}`, tag: '', parts: [{ kind: 'balance', eventId: '', op: '<', value: 2 }], segments: [] })
export const createSplit = (n = 1) => ({ id: `split-${Date.now().toString(36)}-${n}`, values: '3', segments: [] })
export const createPlan = () => ({ feature: 'Disco', cuts: '9, 18, 40, 60, 100, 150, 240', weights: STANDARD_WEIGHTS, specifics: [], splits: [] })

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

// The base segments: one a Brut Wins band. [{ index, min, max, name, condition }]
export function baseSegments(plan) {
  const feature = String(plan.feature ?? '').trim().replace(/\s+/g, '_')
  const cuts = String(plan.cuts ?? '').split(/[\s,;]+/).filter(Boolean)
  const bands = bandsFromCuts(cuts)
  const weights = String(plan.weights ?? STANDARD_WEIGHTS).replace(/\s+/g, '')
  return bands.map((b, index) => ({ index, ...b, name: segmentName(feature || 'Feature', b), condition: segmentCondition({ ...b, weights }) }))
}

// Every segment of the plan, and what is wrong or worth a look.
// Returns { base, segments: [{ name, key, condition, base, tags, mode }], errors: [text], warnings: [text] }
export function buildPlan(plan) {
  const errors = []
  const warnings = []
  const feature = String(plan.feature ?? '').trim()
  if (!feature) errors.push('Type the feature\'s name.')
  else if (!/^[A-Za-z0-9_ ]+$/.test(feature)) errors.push('A feature\'s name is letters, digits and "_".')
  const cutList = String(plan.cuts ?? '').split(/[\s,;]+/).filter(Boolean)
  const badCuts = cutList.filter((c) => !(Number(c) > 0))
  if (badCuts.length) errors.push(`Not a band end: ${badCuts.join(', ')}.`)
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
