// CHEF PRIZES AS REWARD TEXT - the game's syntax, by the economy's rules
// (src/lib/economy; docs/economy-rules.md). A Chef prize is a prize on a
// feature's tier, so its text follows those rules: coins written to 2
// decimals as allowance(coins:X), then free_wild / free_stock / free_undo /
// free_entry, whole numbers only.
//
// A READING: nothing is exported or written anywhere; there is no Chef export
// layout (docs/chef-overview.md, section 9). What cannot be written is said,
// never hidden: a prize that is not known, or (should one ever come) an amount
// that is not a whole item - then that prize gets no text at all. Scaled
// amounts are rounded down to whole items (the economist's rule, chefRewards),
// and a grand prize's coins are set so it is worth its rounded worth.
import { REWARD_LABELS } from './chefModel'
import { dishPrize, grandPrize } from './chefRewards'
import { rewardSyntax } from '../../../lib/economy/syntax'
import { roundTo } from '../../../lib/economy/rounding'
import { checkReward } from '../../../lib/economy/parse'

const RESOURCE_KEYS = ['wild', 'extraStock', 'freeRound', 'undo']

// One prize's text: { text, problems, coinsRounded } - text '' when it cannot be written.
export function prizeText(items) {
  if (!items) return { text: '', problems: ['The prize is not known.'] }
  const problems = []
  for (const key of RESOURCE_KEYS) {
    const n = items[key]
    if (n != null && n !== 0 && !Number.isInteger(n)) problems.push(`${Math.round(n * 100) / 100} ${REWARD_LABELS[key]}: not a whole item.`)
  }
  if (problems.length) return { text: '', problems }
  const coins = items.coins ?? 0
  const text = rewardSyntax({ coins, wild: items.wild ?? 0, stock: items.extraStock ?? 0, undo: items.undo ?? 0, freeRound: items.freeRound ?? 0 })
  return { text, problems, coinsRounded: coins > 0 && roundTo(coins, 2) !== coins ? { from: coins, to: roundTo(coins, 2) } : null }
}

// Every prize of a chef for a segment (null: the base): [{ id, round, kind, name, worth, text, problems, issues, coinsRounded, note }].
export function chefPrizeTexts(state, segment, economy = null) {
  const rows = []
  const add = (row) => {
    const { issues } = row.text ? checkReward(row.text, { economy }) : { issues: [] }
    rows.push({ ...row, issues })
  }
  for (const [round, list] of [['main', state.dishes], ['rc', state.recompletionDishes]]) {
    for (const dish of list ?? []) {
      const p = dishPrize(dish, segment, state.rewards)
      const written = p.legacy ? { text: '', problems: ['Only the older single prize number is known for this dish - its parts (coins, wilds ...) are not.'] } : prizeText(p.known ? p.items : null)
      add({ id: dish.id, round, kind: 'dish', name: dish.name, worth: p.worth, ...written })
    }
    const g = grandPrize(state.rewards?.grandPrize?.[round], segment, state.rewards)
    if (round === 'main' || state.recompletionDishes?.length) {
      const written = prizeText(g.known ? g.items : null)
      add({ id: `grand-${round}`, round, kind: 'grand', name: round === 'main' ? 'Main grand prize' : 'Recompletion grand prize', worth: g.worth, rawWorth: g.rawWorth, ...written, note: !g.known || g.rawWorth === g.worth ? null : g.unmatched ? `Rounded by RoundReward to ${g.worth}, but its items add up to ${Math.round(g.rawWorth * 100) / 100}: it holds no coins to take up the difference.` : `Scaled, its items add up to ${Math.round(g.rawWorth * 100) / 100}; the coins are set so it is worth ${g.worth} (RoundReward - the player gets the rounded worth).` })
    }
  }
  return rows
}
