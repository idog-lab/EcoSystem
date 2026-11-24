// A BASKET'S WORTH, DAY BY DAY, PLAYED ON THE ENGINE.
//
// The economist values a Chef basket by its tier today (Basic 0.25, Rare 1,
// Epic 4 - the Economy page), "as for now ... when the chef model in the app
// will be better we will change its value daily". This is that reading: for a
// segment, every day and every basket type it opens, the same players are
// played as they are and with ONE MORE basket of that type on that day, each
// player compared with themself (every other basket rolls exactly what it
// rolled - chefEngine's keyed streams). A basket's worth that day is what it
// adds to what a player is paid, in allowance (dish prizes, grand prizes and
// Recompletion's, by the chef's value table) - thresholds, the pantry,
// catch-up presets and Recompletion included.
//
// A READING. Nothing here changes a value: the tier worths stay the
// economist's until they decide otherwise. A prize that is not known counts
// as nothing in a payout, so with unknown prizes the worth is too low - said.
// `spread`: how far the average would move with other players (the standard
// error of the players' own differences, x2).
import { CHEST_TYPES, expectedSupply } from './chefModel'
import { simulateSegment } from './chefEngine'

export const BASKET_WORTH_VERSION = 'chef-basket-worth 1.0'

// The basket types a segment opens at all.
export const typesOpenedBy = (state, segment) => {
  const supply = expectedSupply(segment, state.calendar)
  return CHEST_TYPES.filter((t) => (supply[t] ?? []).some((v) => v > 0))
}

const mean = (list) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0)
function spreadOf(diffs) {
  if (diffs.length < 2) return 0
  const m = mean(diffs)
  const variance = diffs.reduce((s, v) => s + (v - m) ** 2, 0) / (diffs.length - 1)
  return 2 * Math.sqrt(variance / diffs.length)
}

// { segmentId, players, seed, variation, base: { payout, complete, missing }, rows: [{ day, chestType, worth, spread,
// dishes, changedShare }], byType: { [type]: { mean, first, last } } } - or null when stopped.
// hooks: { onProgress({ done, of }), isCancelled(), tick() }
export async function basketWorthByDay(state, segment, { players = 300, seed = 2026, variation = 'activity', days = null, types = null } = {}, hooks = {}) {
  const tick = hooks.tick ?? (() => new Promise((resolve) => setTimeout(resolve, 0)))
  const dayList = days ?? Array.from({ length: Math.max(1, state.calendar.totalDays) }, (_, i) => i + 1)
  const typeList = (types ?? typesOpenedBy(state, segment)).filter((t) => state.baskets.some((b) => b.chestType === t))
  const of = 1 + dayList.length * typeList.length
  const base = simulateSegment(state, segment, { players, seed, variation, keepRecords: true })
  hooks.onProgress?.({ done: 1, of })
  await tick()
  const rows = []
  for (const day of dayList) {
    for (const chestType of typeList) {
      if (hooks.isCancelled?.()) return null
      const changed = simulateSegment(state, segment, { players, seed, variation, keepRecords: true, extraBaskets: [{ id: 'one-more', day, chestType }] })
      const diffs = changed.records.map((r, i) => r.payout - base.records[i].payout)
      const dishes = mean(changed.records.map((r, i) => r.mainDishes + r.rcDishes - base.records[i].mainDishes - base.records[i].rcDishes))
      rows.push({ day, chestType, worth: mean(diffs), spread: spreadOf(diffs), dishes, changedShare: diffs.filter((d, i) => d !== 0 || changed.records[i].mainDishes !== base.records[i].mainDishes).length / players })
      hooks.onProgress?.({ done: rows.length + 1, of })
      await tick()
    }
  }
  const byType = {}
  for (const t of typeList) {
    const list = rows.filter((r) => r.chestType === t)
    byType[t] = { mean: mean(list.map((r) => r.worth)), first: list[0]?.worth ?? null, last: list[list.length - 1]?.worth ?? null, peakDay: list.reduce((best, r) => (best == null || r.worth > best.worth ? r : best), null)?.day ?? null }
  }
  return { version: BASKET_WORTH_VERSION, segmentId: segment.id, players, seed, variation, base: { payout: base.payout.mean, complete: base.payout.complete, missing: base.payout.missing }, types: typeList, rows, byType }
}
