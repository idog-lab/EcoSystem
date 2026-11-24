// SEGMENT CONDITIONS (economist, "Economy Rules & Reward Syntax", section 4):
// the server-side expression that decides which config a player gets.
//
// Weighted Brut Wins (the standard):
//   (fn_DailyBrutWins_m4(3,1m,2m,4m,8m)*0.7m+fn_DailyBrutWins_m4(14,1m,2m,4m,8m)*0.3m)
// The average mode multiplier is the same with fn_DailyAvgModeMultiplier_m4.
// Decimal literals take "m" (0.7m, 3m); integer thresholds stay bare (<= 9).
// A band's lower end is exclusive, its upper end inclusive:
//   first (min 0)  BW <= max
//   middle         BW > min && BW <= max
//   last (no max)  BW > min
//   mode block     ... && (MODE < 3m)   or   ... && (MODE >= 3m)
// Names: <Feature>_BW_<min>_<max|Plus>[_Mode_0_3|_Mode_3_plus]; key def_<name>.

export const STANDARD_WEIGHTS = '1m,2m,4m,8m'
export const BRUT_WINS_FN = 'fn_DailyBrutWins_m4'
export const MODE_FN = 'fn_DailyAvgModeMultiplier_m4'

// A decimal literal: 0.7 -> "0.7m", 3 -> "3m".
export const decimalLiteral = (n) => `${Number(n)}m`
// A threshold in a comparison: bare when whole, else a decimal literal.
export const thresholdLiteral = (n) => (Number.isInteger(Number(n)) ? String(Number(n)) : decimalLiteral(n))

export function weightedExpression(fn = BRUT_WINS_FN, { weights = STANDARD_WEIGHTS, shortDays = 3, longDays = 14, shortWeight = 0.7, longWeight = 0.3 } = {}) {
  return `(${fn}(${shortDays},${weights})*${decimalLiteral(shortWeight)}+${fn}(${longDays},${weights})*${decimalLiteral(longWeight)})`
}

// One band's condition. mode: null, 'low' (MODE < split) or 'high' (MODE >= split).
export function segmentCondition({ min = 0, max = null, mode = null, modeSplit = 3, weights = STANDARD_WEIGHTS } = {}) {
  const bw = weightedExpression(BRUT_WINS_FN, { weights })
  const parts = []
  const lo = min == null ? 0 : Number(min)
  if (lo > 0) parts.push(`${bw} > ${thresholdLiteral(lo)}`)
  if (max != null && max !== '') parts.push(`${bw} <= ${thresholdLiteral(max)}`)
  // (a band of every player has no Brut Wins condition - the rules give none for it)
  if (mode === 'low' || mode === 'high') {
    const md = weightedExpression(MODE_FN, { weights })
    parts.push(`(${md} ${mode === 'low' ? '<' : '>='} ${decimalLiteral(modeSplit)})`)
  }
  return parts.join(' && ')
}

export function segmentName(feature, { min = 0, max = null, mode = null, modeSplit = 3 } = {}) {
  const base = `${feature}_BW_${min ?? 0}_${max == null || max === '' ? 'Plus' : max}`
  if (mode === 'low') return `${base}_Mode_0_${modeSplit}`
  if (mode === 'high') return `${base}_Mode_${modeSplit}_plus`
  return base
}
export const segmentKey = (name) => `def_${name}`

// Bands from the upper ends typed ("9, 18, 40, 240"): 0-9, 9-18, ..., 240-Plus.
export function bandsFromCuts(cuts) {
  const list = [...new Set(cuts.map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b)
  const bands = []
  let lo = 0
  for (const c of list) {
    bands.push({ min: lo, max: c })
    lo = c
  }
  bands.push({ min: lo, max: null })
  return bands
}

// Every segment of a feature: each band, split by mode when asked.
export function buildSegments(feature, bands, { splitByMode = false, modeSplit = 3, weights = STANDARD_WEIGHTS } = {}) {
  const out = []
  for (const band of bands) {
    const modes = splitByMode ? ['low', 'high'] : [null]
    for (const mode of modes) {
      const name = segmentName(feature, { ...band, mode, modeSplit })
      out.push({ ...band, mode, name, key: segmentKey(name), condition: segmentCondition({ ...band, mode, modeSplit, weights }) })
    }
  }
  return out
}

// Bands that leave a gap, overlap, or do not cover 0 to no end.
export function checkBands(bands) {
  const issues = []
  if (!bands.length) return ['No band.']
  const sorted = [...bands].sort((a, b) => Number(a.min ?? 0) - Number(b.min ?? 0))
  if (Number(sorted[0].min ?? 0) !== 0) issues.push(`The first band starts at ${sorted[0].min}, not 0.`)
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i]
    if (b.max != null && Number(b.max) <= Number(b.min ?? 0)) issues.push(`${b.min} to ${b.max}: the end is not above the start.`)
    const next = sorted[i + 1]
    if (!next) continue
    if (b.max == null) issues.push(`${b.min} to Plus is not the last band.`)
    else if (Number(next.min) > Number(b.max)) issues.push(`A gap between ${b.max} and ${next.min}.`)
    else if (Number(next.min) < Number(b.max)) issues.push(`${next.min} to ${next.max ?? 'Plus'} overlaps ${b.min} to ${b.max}.`)
  }
  if (sorted[sorted.length - 1].max != null) issues.push(`The last band ends at ${sorted[sorted.length - 1].max}: nothing covers the players above it.`)
  return issues
}
