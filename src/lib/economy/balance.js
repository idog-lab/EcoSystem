// BALANCING A FEATURE'S TIERS (economist, "Economy Rules & Reward Syntax",
// section 6, "Balancing checks the app should run"):
//   Gap = worth - tier target, and gap % per tier and cumulative; flag anything
//   beyond +-X%. The grand prize (last tier) gets a separate share of the budget.
//   Suggested DR amount to close a gap = round((target - worthWithoutDR) / DR_value).
// A tier's worth is its reward text read by the economy (parse.js rewardWorth):
// a part with no worth makes it unknown - never a smaller number - and then no
// gap is worked out for it. X is not given in the rules: it is typed.
import { parseReward, rewardWorth, formatReward } from './parse'
import { currencyValue, findCurrency } from './economyModel'
import { roundTo } from './rounding'

const clean = (x) => (x == null ? null : Number.parseFloat(Number(x).toPrecision(12)) + 0)

// The worth of the parts of a reward that are the currency `name` (as the player gets them: first options).
function currencyPartWorth(node, name, value) {
  if (!node) return 0
  switch (node.type) {
    case 'all':
      return node.parts.reduce((s, p) => s + currencyPartWorth(p, name, value), 0)
    case 'first':
      return currencyPartWorth(node.options[0], name, value)
    case 'chest':
      return currencyPartWorth(node.inner, name, value)
    case 'dynamic':
      return node.name === name && Number.isFinite(Number(node.amount)) ? Number(node.amount) * value : 0
    default:
      return 0
  }
}

// rows: [{ tier, target, text }]. options: { economy, date, flagPct, currency } (currency: a name to suggest with).
// Returns { rows: [{ tier, target, text, worth, unknown, gap, gapPct, cumWorth, cumTarget, cumGapPct, flagged,
// suggest }], totals: { worth, target, gap, gapPct, grandShareOfWorth, grandShareOfTarget }, currency }.
export function balanceTiers(rows, { economy, date = null, flagPct = 10, currency = '' } = {}) {
  const cv = currency ? currencyValue(findCurrency(economy, currency), { date }) : null
  let cumWorth = 0
  let cumTarget = 0
  let cumKnown = true
  const out = rows.map((row, i) => {
    const target = Number.isFinite(Number(row.target)) && row.target !== '' && row.target != null ? Number(row.target) : null
    const { node } = parseReward(row.text ?? '', { economy })
    const w = node ? rewardWorth(node, economy, { date }) : { worth: 0, unknown: [], lines: [] }
    const worth = w.worth
    if (worth == null) cumKnown = false
    cumWorth += worth ?? 0
    cumTarget += target ?? 0
    const gap = worth != null && target != null ? clean(worth - target) : null
    const gapPct = gap != null && target > 0 ? clean((gap / target) * 100) : null
    const cumGapPct = cumKnown && cumTarget > 0 ? clean(((cumWorth - cumTarget) / cumTarget) * 100) : null
    let suggest = null
    if (cv && cv.value > 0 && target != null && worth != null) {
      const without = worth - currencyPartWorth(node, currency, cv.value)
      const amount = roundTo((target - without) / cv.value, 0)
      suggest = { amount: Math.max(0, amount), value: cv.value, without: clean(without), text: amount >= 1 ? `dynamic(${currency}:${amount})` : null }
    }
    return {
      tier: row.tier || `Tier ${i + 1}`,
      target,
      text: node ? formatReward(node) : '',
      worth: clean(worth),
      unknown: w.unknown ?? [],
      gap,
      gapPct,
      cumWorth: cumKnown ? clean(cumWorth) : null,
      cumTarget: clean(cumTarget),
      cumGapPct,
      flagged: gapPct != null && Math.abs(gapPct) > flagPct,
      suggest,
    }
  })
  const totalTarget = out.reduce((s, r) => s + (r.target ?? 0), 0)
  const allKnown = out.every((r) => r.worth != null)
  const totalWorth = allKnown ? out.reduce((s, r) => s + r.worth, 0) : null
  const last = out[out.length - 1]
  return {
    rows: out,
    totals: {
      worth: clean(totalWorth),
      target: clean(totalTarget),
      gap: totalWorth != null ? clean(totalWorth - totalTarget) : null,
      gapPct: totalWorth != null && totalTarget > 0 ? clean(((totalWorth - totalTarget) / totalTarget) * 100) : null,
      // The grand prize - the last tier - as a share of the whole.
      grandShareOfWorth: last && totalWorth > 0 && last.worth != null ? clean(last.worth / totalWorth) : null,
      grandShareOfTarget: last && totalTarget > 0 && last.target != null ? clean(last.target / totalTarget) : null,
    },
    currency: cv ? { name: currency, value: cv.value, dated: !!cv.dated } : currency ? { name: currency, value: null } : null,
  }
}

// Rows pasted from a sheet: "target<TAB>text" or "tier<TAB>target<TAB>text", one a line. { rows, bad }.
export function parseTierRows(text) {
  const rows = []
  const bad = []
  for (const line of String(text ?? '').split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim())) {
    const cells = line.split('\t').map((c) => c.trim())
    if (cells.length >= 3 && Number.isFinite(Number(cells[1]))) rows.push({ tier: cells[0], target: Number(cells[1]), text: cells.slice(2).join('') })
    else if (cells.length === 2 && Number.isFinite(Number(cells[0]))) rows.push({ tier: '', target: Number(cells[0]), text: cells[1] })
    else bad.push(line)
  }
  return { rows, bad }
}
