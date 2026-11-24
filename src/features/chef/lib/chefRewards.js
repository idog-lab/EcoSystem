// PRIZES: what a dish and a grand prize pay, for a segment.
//
// A prize is stored as what it is made of - coins (allowance), wilds, extra
// stock, free rounds, undos - and its ALLOWANCE WORTH is worked out from the
// value table (coins 1, wild 2.5, extra stock 2, free round 1, undo 0.25).
//
// FOR A SEGMENT the base prize is scaled by the segment's EFFECTIVE FACTOR,
// prize factor x burnout:
//   coins        x the factor, whatever it is
//   free rounds  x the factor, but the factor counts as 2 at most
//   undos        the same (the limit is on the multiplier, not on the count)
//   wilds        unchanged
//   extra stock  unchanged
// A GRAND PRIZE's worth is then rounded by RoundReward - under 90 to the 5 (a
// 5 becomes 10), 90 to 200 down to the 10, above 200 to the 50 - raw and
// rounded both kept. A dish prize's worth is not rounded.
//
// WHOLE ITEMS. Scaling gives 4.8 undos. How that becomes a whole number in
// production has not been decided, so `itemRounding` is a setting ('none'
// keeps the raw target) and nothing here is a production quantity. Coins are
// never changed to make up for a rounded item.
//
// UNKNOWN STAYS UNKNOWN. A prize with no components, a component with no
// amount, or a value missing from the table makes the worth `null` and the
// valuation incomplete - never zero. A chef saved before prizes had components
// has one number per dish (`legacyWorth`): it is counted as coins, and said so.
// (The source workbook's own medium and high columns are not reused: they
// scale wilds and round each item their own way.)
import { REWARD_KEYS } from './chefModel'
import { roundReward } from '../../../lib/economy/rounding'

export const effectiveFactor = (segment) => (Number(segment?.prizeFactor) || 1) * (Number(segment?.burnout) || 1)

const CAPPED = new Set(['freeRound', 'undo'])
const UNCHANGED = new Set(['wild', 'extraStock'])

function roundItem(amount, policy) {
  if (policy === 'nearest') return Math.round(amount)
  if (policy === 'down') return Math.floor(amount + 1e-9)
  if (policy === 'up') return Math.ceil(amount - 1e-9)
  return amount
}

// The base prize scaled for a factor: { raw, items } - `raw` the scaled
// targets, `items` after the whole-item policy (coins are never rounded).
export function scaleReward(reward, factor, { cappedFactor = 2, itemRounding = 'none' } = {}) {
  if (!reward) return null
  const raw = {}
  const items = {}
  for (const key of REWARD_KEYS) {
    const base = reward[key]
    if (base == null) {
      raw[key] = null
      items[key] = null
      continue
    }
    const used = UNCHANGED.has(key) ? 1 : CAPPED.has(key) ? Math.min(factor, cappedFactor) : factor
    raw[key] = base * used
    items[key] = key === 'coins' ? raw[key] : roundItem(raw[key], itemRounding)
  }
  return { raw, items }
}

// The allowance worth of a set of amounts; null when something is not known.
export function rewardWorth(amounts, values) {
  if (!amounts) return null
  let worth = 0
  for (const key of REWARD_KEYS) {
    const amount = amounts[key]
    if (amount == null) return null
    if (amount === 0) continue
    const value = values?.[key]
    if (value == null || !Number.isFinite(Number(value))) return null
    worth += amount * Number(value)
  }
  return worth
}

const hasComponents = (reward) => !!reward && REWARD_KEYS.some((key) => reward[key] != null)

// What one dish pays a segment: { worth, raw, items, known, legacy }.
//   known false: nothing says what the dish pays - the worth is null.
//   legacy true: only the older single number exists; counted as coins.
export function dishPrize(dish, segment, rewards) {
  const factor = effectiveFactor(segment)
  const opts = { cappedFactor: rewards?.cappedFactor ?? 2, itemRounding: rewards?.itemRounding ?? 'none' }
  if (hasComponents(dish.reward)) {
    const scaled = scaleReward(dish.reward, factor, opts)
    const worth = rewardWorth(scaled.items, rewards?.values)
    return { worth, baseWorth: rewardWorth(dish.reward, rewards?.values), raw: scaled.raw, items: scaled.items, known: worth != null, legacy: false }
  }
  if (dish.legacyWorth != null && Number.isFinite(Number(dish.legacyWorth))) {
    const base = Number(dish.legacyWorth)
    return { worth: base * factor, baseWorth: base, raw: { coins: base * factor }, items: { coins: base * factor }, known: true, legacy: true }
  }
  return { worth: null, baseWorth: null, raw: null, items: null, known: false, legacy: false }
}

// A grand prize for a segment: scaled, then its worth by RoundReward (the
// economy's rule for a tier prize, src/lib/economy/rounding.js; economist,
// asked: "Yes, RoundReward"). It was the nearest 5 at every size, the
// `grandPrizeRoundTo` an older save may still carry, no longer read.
export function grandPrize(reward, segment, rewards) {
  if (!hasComponents(reward)) return { worth: null, rawWorth: null, baseWorth: null, raw: null, items: null, known: false }
  const scaled = scaleReward(reward, effectiveFactor(segment), { cappedFactor: rewards?.cappedFactor ?? 2, itemRounding: rewards?.itemRounding ?? 'none' })
  const rawWorth = rewardWorth(scaled.items, rewards?.values)
  const worth = rawWorth == null ? null : roundReward(rawWorth)
  return { worth, rawWorth, baseWorth: rewardWorth(reward, rewards?.values), raw: scaled.raw, items: scaled.items, known: worth != null }
}

// Everything a segment can be paid, worked out once: the engine reads it.
export function prizeTable(state, segment) {
  const rewards = state.rewards
  const main = (state.dishes ?? []).map((dish) => ({ dishId: dish.id, ...dishPrize(dish, segment, rewards) }))
  const rc = (state.recompletionDishes ?? []).map((dish) => ({ dishId: dish.id, ...dishPrize(dish, segment, rewards) }))
  const mainGrand = grandPrize(rewards?.grandPrize?.main, segment, rewards)
  const rcGrand = grandPrize(rewards?.grandPrize?.rc, segment, rewards)
  const missing = []
  const unknownMain = main.filter((p) => !p.known).length
  const unknownRc = rc.filter((p) => !p.known).length
  if (unknownMain) missing.push(`${unknownMain} of the ${main.length} dishes have no prize: what they pay is unknown.`)
  if (!mainGrand.known && main.length) missing.push('The grand prize of the Main round is not set: its worth is unknown.')
  if (unknownRc) missing.push(`${unknownRc} of the ${rc.length} Recompletion dishes have no prize: what they pay is unknown.`)
  if (!rcGrand.known && rc.length) missing.push('The grand prize of Recompletion is not set: its worth is unknown.')
  const legacy = [...main, ...rc].filter((p) => p.legacy).length
  if (legacy) missing.push(`${legacy} ${legacy === 1 ? 'dish has' : 'dishes have'} only the older single prize number: it is counted as coins, since what it is made of is not known.`)
  return { main, rc, mainGrand, rcGrand, factor: effectiveFactor(segment), complete: missing.length === 0, missing }
}
