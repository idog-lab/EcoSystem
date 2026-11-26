// A PRIZE AGAINST THE WORTH IT SHOULD HAVE, and a prize scaled for another segment - shared by every feature that
// works its prizes out from effort (Merge's Prizes step, Wicked Trails' tiers). Moved here from Merge's prizeLadder.js
// unchanged, so a feature need not reach into another feature.
import { formatReward, parseReward, checkReward, rewardWorth } from './parse'
import { featureDays } from './economyModel'

const round2 = (x) => Math.round(x * 100) / 100
const NUMBER = /^\d+(?:\.\d+)?$/

// A prize text with every amount times `factor`: coins to 2 decimals, a resource or a currency to a whole number of
// at least 1; a preset, a pack, a chest's name or a trigger as it is. A text that cannot be read comes back as is.
export function scaleReward(text, factor) {
  const src = String(text ?? '').trim()
  if (!src || !(factor > 0) || factor === 1) return src
  const { node } = parseReward(src)
  if (!node) return src
  const whole = (v) => (NUMBER.test(v) ? String(Math.max(1, Math.round(Number(v) * factor))) : v)
  const walk = (n) => {
    switch (n.type) {
      case 'all':
        return { ...n, parts: n.parts.map(walk) }
      case 'first':
        return { ...n, options: n.options.map(walk) }
      case 'chest':
        return { ...n, inner: walk(n.inner) }
      case 'allowance':
        return NUMBER.test(n.coins) ? { ...n, coins: String(Math.max(0.01, round2(Number(n.coins) * factor))) } : n
      case 'resource':
      case 'dynamic':
        return { ...n, amount: whole(n.amount) }
      default:
        return n
    }
  }
  return formatReward(walk(node))
}

// How far a typed prize is from the worth it should have: { ok (readable), issues, worth (null when a part has no
// worth), known, gap, gapPct }. `days`: the feature's days (from its first day) - a DR whose value changes over them is
// taken at the average (economist, 26 Nov 2026: "if there is a change in values of DRs we take the average of them"),
// so the worth is the average of the days' worths; `miniGame`: the mini game the feature uses.
export function prizeAgainstWorth(text, target, economy, { date = null, days = 1, miniGame = null, prizeMode = 'normal', prizeLimit = null } = {}) {
  const src = String(text ?? '').trim()
  if (!src) return null
  const check = checkReward(src, { economy, prizeMode, prizeLimit })
  const dates = date && days > 1 ? featureDays(date, days) : [date]
  const each = check.node ? dates.map((d) => rewardWorth(check.node, economy, { date: d, miniGame })) : []
  const w = each[0] ?? null
  const average = each.length && each.every((x) => x.worth != null) ? round2(each.reduce((s, x) => s + x.worth, 0) / each.length) : null
  if (w && each.length > 1) w.worth = average
  if (w && each.length > 1) w.unknown = [...new Set(each.flatMap((x) => x.unknown))]
  const worth = w?.worth ?? null
  const gap = worth != null && target != null ? round2(worth - target) : null
  return { ok: check.ok, issues: check.issues, worth, known: w?.known ?? null, unknown: w?.unknown ?? [], gap, gapPct: gap != null && target > 0 ? Math.round((gap / target) * 1000) / 10 : null }
}
