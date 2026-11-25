// THE ECONOMY'S RULES (src/lib/economy): what everything is worth, how reward
// text is built, read and checked, the rounding of the sheets, and segment
// conditions - held to the economist's own examples ("Economy Rules & Reward
// Syntax", sections 1 to 7).
//
//   npx vite-node scripts/verify/verify-economy.mjs
//
// 1 the value table          4 the economist's four real rewards   7 worth of a reward
// 2 rounding                 5 the builders                        8 segment conditions
// 3 reading and checking     6 empty input gives nothing           9 Chef reads the same table
import { mround, roundTo, roundReward, mergeRoundReward, roundCost, roundAltDrAmount, roundPuzzleFallback, roundCoins } from '../../src/lib/economy/rounding.js'
import { chefBasketKeys, createEconomy, createCurrency, createKey, normalizeEconomy, resourceIdOf, currencyValue, parseDailyValues, presetValue, chefValuesFromEconomy, DEFAULT_RESOURCE_VALUES, applyTaught, notTaught, notTaughtMessage, currencyChoices, CORE_CURRENCIES, coreCurrency, parsePeriods, formatPeriods, overlapping, cleanPeriods } from '../../src/lib/economy/economyModel.js'
import { TAUGHT_CHEF_BASKETS, TAUGHT_CURRENCIES, TAUGHT_KEYS, TAUGHT_RESOURCES } from '../../src/lib/economy/taught.js'
import { parseReward, formatReward, checkReward, rewardWorth } from '../../src/lib/economy/parse.js'
import { altReward, chefBasketSyntax, chestSyntax, coinsSyntax, counterSyntax, drSyntax, joinPlus, packSyntax, presetFor, presetSyntax, resourceSyntax, rewardSyntax, tierSyntax } from '../../src/lib/economy/syntax.js'
import { bandsFromCuts, buildSegments, checkBands, segmentCondition, segmentKey, segmentName, weightedExpression } from '../../src/lib/economy/segments.js'
import { SEGMENT_FUNCTIONS, progressionCondition, readCondition } from '../../src/lib/economy/segmentFunctions.js'
import { REAL_EXAMPLES } from '../../src/lib/economy/examples.js'
import { balanceTiers, parseTierRows } from '../../src/lib/economy/balance.js'
import { DEFAULT_REWARD_VALUES } from '../../src/features/chef/lib/chefModel.js'
import { LIVE_SEGMENT_SET } from '../../src/features/chef/lib/chefModel.js'

let fails = 0
let total = 0
function check(label, ok, detail = '') {
  total++
  if (!ok) fails++
  console.log(`${ok ? '  OK ' : 'FAIL'}  ${label}${!ok && detail ? ` (${detail})` : ''}`)
}
const eq = (label, got, want) => check(label, Object.is(got, want) || got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
const section = (t) => console.log(`--- ${t} ---`)

const economy = createEconomy()

section('1. The value table')
eq('coins are 1 a unit', economy.resources.coins, 1)
eq('a wild is 2.5', economy.resources.wild, 2.5)
eq('extra stock is 2', economy.resources.stock, 2)
eq('an undo is 0.25', economy.resources.undo, 0.25)
eq('a free round is 1', economy.resources.entry, 1)
check('energy is not on the table (economist: "u can remove this energy"), and an older save\'s is dropped', !('energy' in economy.resources) && !('energy' in normalizeEconomy({ resources: { energy: 0.3, wild: 3 } }).resources))
eq('"Extra Stock" is free_stock', resourceIdOf('Extra Stock'), 'stock')
eq('"ExtraStock" is free_stock', resourceIdOf('ExtraStock'), 'stock')
eq('"FreeRound" is free_entry', resourceIdOf('FreeRound'), 'entry')
eq('"Entry" is free_entry', resourceIdOf('Entry'), 'entry')
eq('"Undo" is free_undo', resourceIdOf('Undo'), 'undo')
eq('"Wild" is free_wild', resourceIdOf('Wild'), 'wild')
eq('an unknown name is not guessed', resourceIdOf('Gems'), null)
eq('dr-hidden is worth 0', currencyValue(economy.currencies.find((c) => c.name === 'dr-hidden')).value, 0)
eq('the pack counter is worth 0 (economist: "packs are prices with 0")', currencyValue(economy.currencies.find((c) => c.name === 'dr-pack-counter')).value, 0)
check('no other currency has a worth nobody gave', economy.currencies.filter((c) => c.name !== 'dr-hidden' && c.name !== 'dr-pack-counter').every((c) => currencyValue(c) == null))
check('dr-twister is the game\'s own name (economist: "its the name of it")', economy.currencies.find((c) => c.name === 'dr-twister')?.ownName === false)
{
  const older = normalizeEconomy({ version: 1, currencies: [createCurrency({ name: 'dr-twister', ownName: true }), createCurrency({ name: 'dr-pack-counter' }), createCurrency({ name: 'dr-x', valueGameplay: 3 })] })
  check('an economy saved before is brought up to date: dr-twister confirmed, the pack counter 0, a typed worth kept', older.currencies[0].ownName === false && older.currencies[1].valueGameplay === 0 && older.currencies[2].valueGameplay === 3)
  const v2 = normalizeEconomy({ version: 2, currencies: [{ name: 'dr-basket-counter', valueGameplay: 0 }, { name: 'dr-x', valueGameplay: 1, valuePricing: 2 }] })
  check('an economy saved before is brought up to date: the basket counter gone, no pricing worth kept', !v2.currencies.some((c) => c.name === 'dr-basket-counter') && v2.currencies[0].name === 'dr-x' && v2.currencies.every((c) => !('valuePricing' in c)))
  check('the starting economy has no basket counter and no pricing worth', !economy.currencies.some((c) => c.name === 'dr-basket-counter') && economy.currencies.every((c) => !('valuePricing' in c)))
}

section('1b. What was taught (taught.js) wins over a browser\'s own')
{
  // A browser that typed its own worths before they were taught.
  const here = normalizeEconomy({ version: 4, resources: { wild: 3 }, chefBaskets: { Rare: 2 }, currencies: [createCurrency({ name: 'dr-pack-counter', valueGameplay: 0.5 }), createCurrency({ name: 'dr-x', valueGameplay: 3 })] })
  check('a taught value wins: the wild is 2.5, the Rare basket 1, the pack counter 0, whatever this browser typed', here.resources.wild === 2.5 && here.chefBaskets.Rare === 1 && here.currencies.find((c) => c.name === 'dr-pack-counter').valueGameplay === 0)
  check(`...and what it replaced is said once (${here.replacedHere.map((r) => r.what).join('; ')})`, here.replacedHere.length === 3 && here.replacedHere.some((r) => r.what === 'Wild: worth of one' && r.here === 3 && r.taught === 2.5))
  check('...but never written down: not in a saved copy, not in a file', !('replacedHere' in JSON.parse(JSON.stringify(here))) && !Object.keys({ ...here }).includes('replacedHere'))
  check('a taught currency a browser removed comes back (dr-hidden)', here.currencies.some((c) => c.name === 'dr-hidden' && c.valueGameplay === 0))
  check('a worth nobody taught stays as typed (dr-x 3)', here.currencies.find((c) => c.name === 'dr-x').valueGameplay === 3)
  eq('a browser with nothing of its own has nothing replaced', createEconomy().replacedHere.length, 0)
  // Taught keys, on a made-up set of what was taught.
  const said = { said: 'made up for the check', on: '2026-11-25', by: 'check' }
  const taught = {
    resources: {},
    chefBaskets: {},
    currencies: [{ name: 'dr-sugar-gp', valueGameplay: 0.4, ...said }, { name: 'dr-new', daily: '2026-12-01=0.5|2026-12-02=0.4', ...said }],
    keys: { presets: [{ key: 'pick_3', value: 6, ...said }, { key: 'New_Preset', value: 2, note: 'taught', ...said }], packs: [], chests: [{ key: 'blue-chest', ...said }], triggers: [], buckets: [] },
  }
  const t = applyTaught(createEconomy({ keys: { ...economy.keys, presets: [createKey({ key: 'pick_3', value: 9 })] } }), taught)
  check('a taught preset worth wins (pick_3: 6 over the 9 typed), and is said', t.keys.presets.find((k) => k.key === 'pick_3').value === 6 && t.replacedHere.some((r) => r.what === 'preset:pick_3'))
  check('a taught key a list does not have is added (New_Preset worth 2, blue-chest)', t.keys.presets.find((k) => k.key === 'New_Preset')?.value === 2 && t.keys.chests.some((k) => k.key === 'blue-chest'))
  check('a taught currency is added with its values by date, and a date reads them', currencyValue(t.currencies.find((c) => c.name === 'dr-new'), { date: '2026-12-02' })?.value === 0.4 && t.currencies.find((c) => c.name === 'dr-sugar-gp').valueGameplay === 0.4)
  // What this browser holds that was not taught.
  const mine = normalizeEconomy({ version: 4, currencies: [createCurrency({ name: 'dr-sugar-gp', valueGameplay: 0.7 }), createCurrency({ name: 'dr-mine' }), createCurrency({ name: 'dr-pack-counter', valueGameplay: 0.5 })], keys: { presets: [createKey({ key: 'pick_1', value: 5 }), createKey({ key: 'pick_2' })], triggers: [createKey({ key: 'my_trigger' })] } })
  const list = notTaught(mine)
  check(`what was typed here and not taught is listed: ${list.map((x) => x.name).join(', ')}`, list.length === 4 && ['dr-sugar-gp', 'dr-mine', 'pick_1', 'my_trigger'].every((n) => list.some((x) => x.name === n)) && !list.some((x) => x.name === 'dr-pack-counter' || x.name === 'pick_2'))
  eq('the starting economy has nothing that was not taught', notTaught(createEconomy()).length, 0)
  const fewer = createEconomy({ currencies: createEconomy().currencies.filter((c) => c.name !== 'dr-sugar-gp' && c.name !== 'dr-hidden') })
  const all = currencyChoices(createEconomy())
  check(`the drop list offers the game's currencies the table does not hold (${all.length}: ${all.slice(0, 3).join(', ')}, ...)`, all.length === 99 && all.includes('dr-villains-queen') && all.includes('dr-cascade') && new Set(all).size === all.length && !all.includes('dr-twister') && !all.includes('dr-pack-counter'))
  check('...one taken out of the table is offered again, a name added here is not on it', currencyChoices(fewer).includes('dr-sugar-gp') && !currencyChoices(fewer).includes('dr-hidden') && !all.includes('dr-sugar-gp') && !currencyChoices(mine).includes('dr-mine'))
  check('the basket counter, on the game\'s list but removed by the economist, is never offered', !all.includes('dr-basket-counter'))
  const msg = notTaughtMessage(list)
  check('...and it is written as a message to send in chat', /dr-sugar-gp: worth 0\.7/.test(msg) && /preset:pick_1: worth 5/.test(msg) && /dr-mine: a currency added here/.test(msg) && /trigger:my_trigger: a key added here/.test(msg))
  check('every taught entry says who said it, when and what (taught.js)', [...Object.values(TAUGHT_RESOURCES), ...Object.values(TAUGHT_CHEF_BASKETS), ...TAUGHT_CURRENCIES, ...Object.values(TAUGHT_KEYS).flat()].every((e) => e.said && /^\d{4}-\d{2}-\d{2}$/.test(e.on) && e.by))
  check('every taught currency name is the game\'s pattern (dr- and lower case)', TAUGHT_CURRENCIES.every((c) => /^dr-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.name)))
}

section('2. Rounding, as the sheets do it')
eq('MROUND halves go away from zero: 2.5 to 1 is 3', mround(2.5, 1), 3)
eq('...and -2.5 is -3', mround(-2.5, 1), -3)
eq('MROUND(12.5, 5) is 15', mround(12.5, 5), 15)
eq('ROUND(4.655, 2) is 4.66 (no float slip)', roundTo(4.655, 2), 4.66)
for (const [x, want] of [[2, 0], [2.5, 10], [3, 10], [7, 10], [8, 10], [12.5, 15], [42, 40], [88, 90], [89.9, 90], [90, 90], [95, 90], [199, 190], [200, 200], [201, 200], [225, 250], [230, 250], [1260, 1250], [-42, -40], [-95, -90]]) eq(`RoundReward(${x}) = ${want}`, roundReward(x), want)
for (const [x, want] of [[0.2, 2], [1, 2], [13, 14], [30, 30], [31, 30], [147, 145], [148, 150], [178, 180], [260, 250], [275, 300]]) eq(`MergeRoundReward(${x}) = ${want}`, mergeRoundReward(x), want)
for (const [x, want] of [[0.4, 1], [9, 9], [10, 10], [13, 14], [26, 26], [27, 25], [104, 100], [105, 110]]) eq(`spin or point cost ${x} -> ${want}`, roundCost(x), want)
for (const [x, want] of [[0.3, 1], [6.4, 6], [8, 8], [8.4, 10], [12, 10], [23, 25]]) eq(`alternative DR amount ${x} -> ${want}`, roundAltDrAmount(x), want)
eq('puzzle fallback 2 -> 5 (at least 5)', roundPuzzleFallback(2), 5)
eq('puzzle fallback 12 -> 10', roundPuzzleFallback(12), 10)
eq('puzzle fallback 38 -> 40', roundPuzzleFallback(38), 40)
eq('puzzle fallback at a step of 10: 12 -> 10, 3 -> 10', `${roundPuzzleFallback(12, 10)} ${roundPuzzleFallback(3, 10)}`, '10 10')
eq('coins to 2 decimals: 0.125 -> 0.13', roundCoins(0.125), 0.13)
eq('coins to 2 decimals: 3.14159 -> 3.14', roundCoins(3.14159), 3.14)

section('3. Reading and checking reward text')
const issuesOf = (t, o = {}) => checkReward(t, { economy, ...o }).issues
const codes = (t, o) => issuesOf(t, o).map((i) => i.code)
check('a "+" with nothing after it is an error', codes('allowance(coins:3)+').includes('empty-part'))
check('a "+" with nothing before it is an error', codes('+free_wild:1').includes('empty-part'))
check('an empty "|" part is an error', codes('[dynamic(dr-puzzle:5)||allowance(coins:3)]').includes('empty-part'))
check('a "[" never closed is an error', codes('[dynamic(dr-puzzle:5)').includes('unbalanced'))
check('a ")" with nothing to close is an error', codes('free_wild:1)').includes('unbalanced'))
check('a space is an error', codes('allowance(coins:3) + free_wild:1').includes('space'))
check('a wild of 1.5 is an error (whole numbers)', codes('free_wild:1.5').includes('not-whole'))
check('free_wild:0 is an error', codes('free_wild:0').includes('amount-below-1'))
check('dynamic(:0) is an error twice over', ['dr-name', 'amount-below-1'].every((c) => codes('dynamic(:0)').includes(c)))
check('a currency not written dr-kebab-case is an error', codes('[dynamic(dr_puzzle:5)]').includes('dr-name'))
check('a kind of item the game does not read is an error', codes('gems:5').includes('unknown-atom'))
check('a decimal comma is an error', codes('allowance(coins:0,5)').includes('comma-decimal'))
check('a preset not on the list is a warning, not an error', checkReward('preset:mini_game_999_gameplay_es', { economy }).ok && codes('preset:mini_game_999_gameplay_es').includes('unknown-key'))
check('a currency not on the list is a warning', codes('[dynamic(dr-made-up:5)]').includes('unknown-key'))
eq('dr-twister reads with nothing to say', codes('[dynamic(dr-twister:5)]').length, 0)
check('coins with 3 decimals are named on a tier prize', codes('allowance(coins:0.125)').includes('coin-decimals'))
check('...and allowed where 3 are (Merge Mania\'s small rewards)', !codes('allowance(coins:0.125)', { coinDecimals: 3 }).includes('coin-decimals'))
check('the order of the parts is never a finding', checkReward('preset:puzzle_gameplay_250+allowance(coins:3)+trigger:Pity', { economy }).issues.length === 0)
check('a Chef basket on the list reads with nothing to say', checkReward('preset:Chef__Rare_Phase_2_Free_round', { economy }).issues.length === 0)
check('...and one the list does not hold is named, even in the Chef__ shape (a Basic basket of wilds does not exist)', codes('preset:Chef__Basic_Phase_1_Wild').includes('unknown-key'))
check('...and a near miss is not', codes('preset:Chef__Mega_Phase_2_Free_round').includes('unknown-key'))
eq('an empty text is nothing, with no finding', checkReward('', { economy }).issues.length, 0)
check('Missing(DrawA,2) reads', checkReward('Missing(DrawA,2)', { economy }).ok)

section('3b. A chest wraps the whole reward')
{
  const inner = 'allowance:milestone(coins:3)+free_wild:1+[sticker_pack:Joker_Pack|allowance(coins:0.5)]+[dynamic(dr-puzzle:5)|[dynamic(dr-hidden:1)]]'
  const wrapped = chestSyntax(inner, 'my-new-chest')
  eq('chest:<name>(<the whole reward>)', wrapped, `chest:my-new-chest(${inner})`)
  const r = checkReward(wrapped, { economy })
  check('a chest around +, [a|b] and nested fallbacks reads, and writes back exactly', r.ok && r.roundTrip && r.node.type === 'chest' && r.node.name === 'my-new-chest' && r.node.inner.type === 'all' && r.node.inner.parts.length === 4)
  check('a chest name typed by the economist, not on the list, is not named', !codes(wrapped).includes('unknown-key'))
  eq('a chest is worth what is in it', rewardWorth(chestSyntax('free_wild:2+allowance(coins:1)', 'x'), economy).worth, 6)
  eq('no chest name: the reward as it is, no wrapper', chestSyntax(inner, ''), inner)
  check('a chest never closed, or with nothing in it, is an error', !checkReward('chest:x(free_wild:1', { economy }).ok && codes('chest:x()').includes('empty-part'))
  check('a chest name with a space or a bracket in it is an error', codes('chest:my chest(free_wild:1)').includes('space') && !checkReward('chest:a[b(free_wild:1)', { economy }).ok)
  check('tierSyntax wraps everything of the tier, triggers included', tierSyntax({ triggers: ['Pity'], reward: { coins: 2 }, chest: 'gold-chest' }, economy) === 'chest:gold-chest(trigger:Pity+allowance(coins:2))')
}

section('4. The economist\'s four real rewards (section 2.4)')
const REAL = REAL_EXAMPLES
REAL.forEach((text, i) => {
  const r = checkReward(text, { economy })
  check(`example ${i + 1}: read with no finding at all`, r.issues.length === 0, JSON.stringify(r.issues))
  check(`example ${i + 1}: written back exactly as it was`, r.roundTrip && formatReward(parseReward(text).node) === text)
})
check('the nested example of 2.2 reads and writes back', checkReward('[dynamic(dr-puzzle:5)|[dynamic(dr-puzzle:100)|allowance(coins:3)]]').roundTrip)

section('5. The builders make the economist\'s examples')
eq('example 1, built from its parts', joinPlus(rewardSyntax({ coins: 0.8, undo: 1 }), drSyntax({ name: 'dr-puzzle', amount: 5, noRegularAlt: true }), packSyntax({ packKey: 'Common_T4_1_1C_Low_Vague_Game', allowance: 0.5 }), counterSyntax('dr-pack-counter'), chefBasketSyntax('Basic', 1, 'Undo')), REAL[0])
eq('example 2, built as a tier in the standard order', tierSyntax({ triggers: ['sugar_rush_tier_gp'], reward: { coins: 2.9, allowanceBucket: 'milestone' }, presets: ['puzzle_gameplay_250', 'mini_game_40_gameplay_es'], pack: { packKey: 'Royal_T1_1_1R_Vague_Royal_Quest_GP', allowance: 1, alt: 'FreeRound' } }, economy), REAL[1])
eq('example 3, in a chest', chestSyntax(joinPlus(resourceSyntax('wild', 1), presetSyntax('Chef__Epic_Phase_1_Extra_stock')), 'yellow-chest'), REAL[2])
eq('example 4, from its parts', joinPlus(rewardSyntax({ coins: 4.65, allowanceBucket: 'milestone', wild: 1, stock: 1 }), packSyntax({ packKey: 'Golden_T1_1_3G_mid_Rarity_Game_champ', allowance: 1, alt: 'Free Round' }, economy), presetSyntax('mf_90_gameplay_entry_cross')), REAL[3])
eq('a currency worth 3 falls back to its coins', drSyntax({ name: 'dr-x', amount: 5, value: 0.6 }), '[dynamic(dr-x:5)|allowance(coins:3)]')
eq('an allowance of 5 given as wilds is free_wild:2', altReward(5, 'Wild', null, economy), 'free_wild:2')
eq('...capped at 1', altReward(5, 'Wild', 1, economy), 'free_wild:1')
eq('an allowance of 0.1 as wilds is at least 1', altReward(0.1, 'Wild', null, economy), 'free_wild:1')
eq('the hidden fallback', drSyntax({ name: 'dr-x', amount: 3, alt: 'hidden' }), '[dynamic(dr-x:3)|[dynamic(dr-hidden:1)]]')
eq('a second currency goes inside, with the last fallback (economist: "it should be inside")', drSyntax({ name: 'dr-x', amount: 5, value: 0.6, altDrName: 'dr-puzzle', altDrAmount: 100 }), '[dynamic(dr-x:5)|[dynamic(dr-puzzle:100)|allowance(coins:3)]]')
for (const [alt, want] of [['Undo', 'free_undo:12'], ['Free Round', 'free_entry:3'], ['Extra Stock', 'free_stock:2'], ['Wild', 'free_wild:1']]) eq(`...the last can be any core resource: ${alt} for a worth of 3 is ${want}`, drSyntax({ name: 'dr-x', amount: 5, value: 0.6, altDrName: 'dr-puzzle', altDrAmount: 100, alt }, economy), `[dynamic(dr-x:5)|[dynamic(dr-puzzle:100)|${want}]]`)
eq('a second currency worked out: 3 / 0.03 = 100 units, to the 5', drSyntax({ name: 'dr-x', amount: 5, value: 0.6, altDrName: 'dr-puzzle', altDrValue: 0.03, noRegularAlt: true }), '[dynamic(dr-x:5)|[dynamic(dr-puzzle:100)]]')
eq('...0.2 / 0.03 = 6.7 units, to the 1', drSyntax({ name: 'dr-x', amount: 1, value: 0.2, altDrName: 'dr-puzzle', altDrValue: 0.03, noRegularAlt: true }), '[dynamic(dr-x:1)|[dynamic(dr-puzzle:7)]]')
eq('...and capped', drSyntax({ name: 'dr-x', amount: 5, value: 0.6, altDrName: 'dr-puzzle', altDrValue: 0.03, altDrCap: 50, noRegularAlt: true }), '[dynamic(dr-x:5)|[dynamic(dr-puzzle:50)]]')
eq('the puzzle fallback rounds to the 5, at least 5', drSyntax({ name: 'dr-x', amount: 1, value: 0.06, altDrName: 'dr-puzzle', altDrValue: 0.03, altDrRounding: 'puzzle', noRegularAlt: true }), '[dynamic(dr-x:1)|[dynamic(dr-puzzle:5)]]')
eq('a counter with its hidden fallback', counterSyntax('dr-pack-counter'), '[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]')
eq('a Chef basket, with no counter after it (economist: "that logic is not up to date")', chefBasketSyntax('Rare', 2, 'Wild'), 'preset:Chef__Rare_Phase_2_Wild')
eq('coins are written to 2 decimals in a tier', coinsSyntax(4.655), 'allowance(coins:4.66)')
const presets = createEconomy({ keys: { presets: ['mini_game_5_gameplay_es', 'mini_game_40_gameplay_es', 'mini_game_25_gameplay_allowance'].map((key) => createKey({ key })) } })
eq('a mini-game preset snaps to the nearest amount on the list (30 -> 40)', presetFor('mini_game', 30, 'es', presets)?.key, 'mini_game_40_gameplay_es')
eq('...(20 -> 5)', presetFor('mini_game', 20, 'es', presets)?.key, 'mini_game_5_gameplay_es')
check('...and falls back to its _allowance when the kind is not listed', presetFor('mini_game', 30, 'wild', presets)?.key === 'mini_game_25_gameplay_allowance' && presetFor('mini_game', 30, 'wild', presets).fellBack)
eq('a preset no key exists for is not made up', presetFor('puzzle', 100, '', presets), null)
eq('a pet preset of the list is found', presetFor('mf', 85, 'entry', economy, { cross: true })?.key, 'mf_90_gameplay_entry_cross')

section('6. Empty or invalid input gives nothing - never a broken fragment')
eq('no currency name', drSyntax({ name: '', amount: 5 }), '')
eq('an amount of 0', drSyntax({ name: 'dr-x', amount: 0 }), '')
eq('an amount that is not a number', drSyntax({ name: 'dr-x', amount: 'abc' }), '')
eq('no rewards at all', rewardSyntax({}), '')
eq('a wild of 0', rewardSyntax({ wild: 0 }), '')
eq('a wild of 1.5 is not written', resourceSyntax('wild', 1.5), '')
eq('coins of 0', coinsSyntax(0), '')
eq('no pack key', packSyntax({ allowance: 3 }), '')
eq('no counter name', counterSyntax(''), '')
eq('a chest of nothing', chestSyntax('', 'pink-chest'), '')
eq('a currency whose worth is not known has no coin fallback', drSyntax({ name: 'dr-x', amount: 5 }), '[dynamic(dr-x:5)]')
eq('an alternative that is not a core resource is not given', altReward(5, 'Energy', null, economy), '')
for (const text of [rewardSyntax({ coins: 0, wild: 1 }), tierSyntax({ triggers: [''], reward: { coins: 1 }, presets: ['', 'puzzle_gameplay_250'] }, economy)]) check(`nothing broken in "${text}"`, !/^\+|\+$|\+\+|\|\||\[\||\|\]/.test(text) && checkReward(text, { economy }).ok)

section('7. The worth of a reward')
const priced = createEconomy({
  currencies: [
    createCurrency({ name: 'dr-puzzle', daily: '2026-11-30=0.0376875|2026-12-01=0.0333518|2026-12-02=0.0295148' }),
    createCurrency({ name: 'dr-pack-counter', valueGameplay: 0 }),
    createCurrency({ name: 'dr-hidden', valueGameplay: 0 }),
  ],
  keys: { packs: [createKey({ key: 'Common_T4_1_1C_Low_Vague_Game', value: 0.5 })], presets: [createKey({ key: 'mf_90_gameplay_entry_cross', value: 3 })] },
})
check('a date that does not exist (30 Feb, month 13) is never read as one', (() => { const r = parseDailyValues('2026-02-30=1|2026-13-01=2|2026-03-01=3'); return r.entries.length === 1 && r.entries[0].date === '2026-03-01' && r.bad.length === 2 })())
eq('the dated values are read in order', parseDailyValues('2026-12-01=2|2026-11-30=1').entries.map((e) => e.value).join(','), '1,2')
eq('the puzzle\'s values saved in the older writing become one day each', JSON.stringify(priced.currencies[0].periods.map((p) => [p.from, p.to])), JSON.stringify([['2026-11-30', '2026-11-30'], ['2026-12-01', '2026-12-01'], ['2026-12-02', '2026-12-02']]))
eq('a day reads its own value', currencyValue(priced.currencies[0], { date: '2026-12-01' }).value, 0.0333518)
check('a date before the first or after the last has no value: unknown, never the nearest (economist: "Unknown")', currencyValue(priced.currencies[0], { date: '2026-11-01' }) === null && currencyValue(priced.currencies[0], { date: '2027-01-01' }) === null)
{
  const ev = createCurrency({ name: 'dr-sugar-gp', daily: '2026-12-01=2|2026-12-05=1' })
  check('an event currency\'s dates: between two reads the one before; outside them unknown', currencyValue(ev, { date: '2026-12-03' }).value === 2 && currencyValue(ev, { date: '2026-12-05' }).value === 1 && currencyValue(ev, { date: '2026-11-30' }) === null && currencyValue(ev, { date: '2026-12-06' }) === null)
}

section('7a. The chests')
{
  eq('the chests are the four the economist gave, by name alone (chest:wooden(...))', economy.keys.chests.map((k) => k.key).join(' '), 'wooden silver golden purple')
  check('...each one taught, with the economist\'s words', ['wooden', 'silver', 'golden', 'purple'].every((k) => TAUGHT_KEYS.chests.some((t) => t.key === k && /wooden, silver,golden purple/.test(t.said))))
  const saved = normalizeEconomy({ version: 4, keys: { ...economy.keys, chests: [createKey({ key: 'pink-chest' }), createKey({ key: 'yellow-chest' }), createKey({ key: 'my-chest' })] } })
  eq('a list saved before gives up pink-chest and yellow-chest ("Only the four"), gets the four, keeps a chest of its own', saved.keys.chests.map((k) => k.key).join(' '), 'my-chest wooden silver golden purple')
  check('chest:wooden(...) reads with nothing to fix, worth what is in it', checkReward('chest:wooden(allowance(coins:3)+free_wild:1)', { economy }).issues.length === 0 && rewardWorth('chest:wooden(allowance(coins:3)+free_wild:1)', economy).worth === 5.5)
  eq('...and is built so', chestSyntax('allowance(coins:3)', 'golden'), 'chest:golden(allowance(coins:3))')
}

section('7b. The currencies always in the game')
{
  eq('puzzle, merge, picks and pet: a day, one fixed worth, one fixed worth, a week (economist: "as for the picks and merge, we can give a fixed value for now")', CORE_CURRENCIES.map((c) => `${c.name}:${c.step}`).join(' '), 'dr-puzzle:day dr-merge:fixed dr-pickaxe:fixed dr-pet:week')
  check('they are always on the page, even in a save that lost one, and never on the drop list', CORE_CURRENCIES.every((c) => normalizeEconomy({ version: 4, currencies: [] }).currencies.some((x) => x.name === c.name)) && !currencyChoices(normalizeEconomy({ version: 4, currencies: [] })).some((n) => coreCurrency(n)))
  const pet = createCurrency({ name: 'dr-pet', valueGameplay: 9, periods: parsePeriods('2026-12-01=0.4|2026-12-15=0.35', 'week').periods })
  check(`a pet week runs 7 days from the day typed (${formatPeriods(pet.periods)})`, formatPeriods(pet.periods) === '2026-12-01..2026-12-07=0.4|2026-12-15..2026-12-21=0.35')
  check('a day in a live week reads that week; a week it is not live is unknown - and a worth without dates is not used', currencyValue(pet, { date: '2026-12-07' }).value === 0.4 && currencyValue(pet, { date: '2026-12-16' }).value === 0.35 && currencyValue(pet, { date: '2026-12-10' }) === null && currencyValue(createCurrency({ name: 'dr-pet', valueGameplay: 9 })) === null)
  // (From a date to a date: no currency uses it now; kept for when one does.)
  const ranges = parsePeriods('2026-12-01..2026-12-14=0.3\n2026-12-15\t2026-12-31\t0.25\n2026-12-20..2026-12-10=1\nnonsense', 'range')
  check(`periods from a date to a date: from..to=value, or three columns; a period ending before it starts is not read (${ranges.bad.length} not read)`, ranges.periods.length === 2 && ranges.periods[1].to === '2026-12-31' && ranges.bad.length === 2)
  check('two periods sharing a day are found', overlapping(ranges.periods, '2026-12-10', '2026-12-16')?.from === '2026-12-01' && overlapping(ranges.periods, '2027-01-01', '2027-01-07') === null)
  check('a period that is not one is never kept (to before from, 30 Feb, no value)', cleanPeriods([{ from: '2026-12-05', to: '2026-12-01', value: 1 }, { from: '2026-02-30', to: '2026-03-01', value: 1 }, { from: '2026-12-01', to: '2026-12-01', value: '' }]).length === 0)
  // Picks: one fixed worth - dates typed for it before are not used.
  const pick = createCurrency({ name: 'dr-pickaxe', valueGameplay: 0.3, periods: ranges.periods })
  check('picks are one fixed worth on every date, with or without a date, dates typed before not used', currencyValue(pick).value === 0.3 && currencyValue(pick, { date: '2026-12-15' }).value === 0.3 && currencyValue(pick, { date: '2030-01-01' }).value === 0.3 && currencyValue(createCurrency({ name: 'dr-merge', periods: ranges.periods }), { date: '2026-12-02' }) === null)
  const eco = createEconomy({ currencies: [pick, pet] })
  check('10 picks are worth 3 on any date', rewardWorth('dynamic(dr-pickaxe:10)', eco, { date: '2027-02-01' }).worth === 3 && rewardWorth('dynamic(dr-pickaxe:10)', eco).worth === 3)
  const w = rewardWorth('dynamic(dr-pet:10)', eco, { date: '2026-12-10' })
  check(`a prize on a date with no value is unknown (a week the pet is not live), and says the date (${w.lines[0]?.note})`, w.worth === null && /no value given for 2026-12-10/.test(w.lines[0]?.note ?? ''))
  check('...and on a date with one, it is counted and its dates said', rewardWorth('dynamic(dr-pet:10)', eco, { date: '2026-12-02' }).worth === 4 && /from 2026-12-01 to 2026-12-07/.test(rewardWorth('dynamic(dr-pet:10)', eco, { date: '2026-12-02' }).lines[0].note))
  const typed = notTaught(eco)
  check(`what is typed here and not taught is listed to send: the pet's weeks, the picks' worth - not a pet worth without dates, not the picks' old dates (${notTaughtMessage(typed).replace(/\n/g, ' / ')})`, typed.length === 2 && /dr-pet: values by date 2026-12-01\.\.2026-12-07=0\.4/.test(notTaughtMessage(typed)) && /dr-pickaxe: worth 0\.3$/m.test(notTaughtMessage(typed)) && !/worth 9/.test(notTaughtMessage(typed)))
}
eq('example 1 on 1 Dec: 0.8 + 0.25 + 5 x 0.0333518 + 0.5 + 0.25 (a Basic basket)', rewardWorth(REAL[0], priced, { date: '2026-12-01' }).worth, 1.966759)
eq('example 3: a wild and an Epic basket = 6.5', rewardWorth(REAL[2], priced).worth, 6.5)
const ex4 = rewardWorth(REAL[3], priced)
check('example 4 with its pack allowance not given: the worth is unknown, not a smaller number', ex4.worth === null && ex4.known === 4.65 + 2.5 + 2 + 3 && ex4.unknown.length === 1, JSON.stringify(ex4))
eq('a trigger is worth nothing', rewardWorth('trigger:Pity', priced).worth, 0)
eq('of [a|b] the first is what the player gets', rewardWorth('[allowance(coins:2)|free_wild:4]', priced).worth, 2)
check('energy:5 is not an item the game reads any more', codes('energy:5').includes('unknown-atom'))
eq('a preset\'s typed worth is used', presetValue(priced, 'mf_90_gameplay_entry_cross').value, 3)

section('8. Segment conditions (section 4)')
const BW = '(fn_DailyBrutWins_m4(3,1m,2m,4m,8m)*0.7m+fn_DailyBrutWins_m4(14,1m,2m,4m,8m)*0.3m)'
const MODE = '(fn_DailyAvgModeMultiplier_m4(3,1m,2m,4m,8m)*0.7m+fn_DailyAvgModeMultiplier_m4(14,1m,2m,4m,8m)*0.3m)'
eq('weighted Brut Wins, the standard', weightedExpression(), BW)
eq('the economist\'s example (9 to 18, mode under 3), to the character', segmentCondition({ min: 9, max: 18, mode: 'low' }), `${BW} > 9 && ${BW} <= 18 && (${MODE} < 3m)`)
eq('the first band has only its upper end', segmentCondition({ min: 0, max: 9 }), `${BW} <= 9`)
eq('the last band has only its lower end', segmentCondition({ min: 240, max: null }), `${BW} > 240`)
eq('a decimal threshold takes "m"', segmentCondition({ min: 0, max: 2.5 }), `${BW} <= 2.5m`)
eq('the high mode block', segmentCondition({ min: 240, mode: 'high' }), `${BW} > 240 && (${MODE} >= 3m)`)
eq('a name with mode', segmentName('Disco', { min: 18, max: 40, mode: 'high' }), 'Disco_BW_18_40_Mode_3_plus')
eq('a last band\'s name', segmentName('Disco', { min: 240 }), 'Disco_BW_240_Plus')
eq('a key', segmentKey(segmentName('Disco', { min: 0, max: 9, mode: 'low' })), 'def_Disco_BW_0_9_Mode_0_3')
const bands = bandsFromCuts([40, 9, 18])
eq('bands from the cuts typed, in order', bands.map((b) => `${b.min}-${b.max ?? 'Plus'}`).join(' '), '0-9 9-18 18-40 40-Plus')
eq('...cover 0 to no end, with no gap or overlap', checkBands(bands).length, 0)
check('a gap is found', checkBands([{ min: 0, max: 9 }, { min: 10, max: null }]).some((s) => /gap/i.test(s)))
check('an overlap is found', checkBands([{ min: 0, max: 10 }, { min: 9, max: null }]).some((s) => /overlap/i.test(s)))
check('a last band with an end is found', checkBands([{ min: 0, max: 10 }]).some((s) => /nothing covers/i.test(s)))
eq('split by mode: two segments a band', buildSegments('Disco', bands, { splitByMode: true }).length, 8)
check('the Chef live segments follow the same naming', LIVE_SEGMENT_SET.filter((s) => s.min != null).every((s) => s.name === segmentName('Chef', { min: s.min, max: s.max })))

section('8a. The functions segments are made of (segmentFunctions.js)')
{
  eq('the functions taught: Brut Wins, the mode multiplier, Diamond Mine and Merge progression', SEGMENT_FUNCTIONS.map((f) => f.name).join(' '), 'fn_DailyBrutWins_m4 fn_DailyAvgModeMultiplier_m4 fn_DiamondMine_Progression fn_Merge_Progression')
  check('each says who explained it, when and in what words, with an example that reads with nothing to fix', SEGMENT_FUNCTIONS.every((f) => f.said && /^\d{4}-\d{2}-\d{2}$/.test(f.on) && f.by && readCondition(f.example).ok && !readCondition(f.example).issues.length))
  eq('a progression condition, the economist\'s example to the character', progressionCondition({ feature: 'diamond-mine', eventId: '57634', op: '>', percent: 95 }).condition, 'fn_DiamondMine_Progression(57634U) > 95')
  eq('...Merge, an id typed with its U, a decimal % with m', progressionCondition({ feature: 'merge', eventId: '61200U', op: '<=', percent: 50.5 }).condition, 'fn_Merge_Progression(61200U) <= 50.5m')
  const bad = progressionCondition({ feature: 'merge', eventId: '57a', percent: 120 })
  check(`...nothing written while the id is not digits or the % is not 0 to 100 (${bad.problems.join(' ')})`, bad.condition === '' && bad.problems.length === 2)
  const r = readCondition('fn_DiamondMine_Progression(57634U) > 95')
  eq('read in words: "Diamond Mine progression in event 57634 is above 95%"', r.clauses.join(' | '), 'Diamond Mine progression in event 57634 is above 95%')
  const band = readCondition(`${segmentCondition({ min: 9, max: 18, mode: 'low' })} && fn_Merge_Progression(61200U) >= 50`)
  check(`a Brut Wins band split by mode, with a progression: four parts in words (${band.clauses.join(' | ')})`, band.ok && band.clauses.length === 4 && /weighted Daily Brut Wins \(0\.7 x the last 3 days \+ 0\.3 x the last 14 days\) is above 9/.test(band.clauses[0]) && /Average mode multiplier .* is below 3/.test(band.clauses[2]) && /Merge progression in event 61200 is at least 50%/.test(band.clauses[3]))
  check('an event id without its U must be fixed', !readCondition('fn_DiamondMine_Progression(57634) > 95').ok && readCondition('fn_DiamondMine_Progression(57634) > 95').issues.some((i) => i.code === 'event-id'))
  const unknown = readCondition('fn_Something_New(3) > 2')
  check('a function the app does not know is named, never guessed at - a warning, the rest still read', unknown.ok && unknown.issues.some((i) => i.code === 'unknown-function' && /fn_Something_New/.test(i.text)))
  check('a condition that cannot be read says why (a bracket left open, an "&&" with nothing after)', /expected/.test(readCondition('(fn_Merge_Progression(1U) > 95').issues[0].text) && /ends too soon/.test(readCondition('fn_Merge_Progression(1U) > 95 &&').issues[0].text))
  check('every segment the Segments tab writes reads with nothing to fix', buildSegments('Disco', bands, { splitByMode: true }).every((s) => readCondition(s.condition).ok && !readCondition(s.condition).issues.length))
}

section('8b. The game keys (given 24 Nov 2026)')
eq('608 sticker packs, every one worth 0 (economist: "0 for every pack")', `${economy.keys.packs.length} ${economy.keys.packs.every((k) => k.value === 0)}`, '608 true')
eq('the presets of the two lists and the four of the examples', economy.keys.presets.length, 81 + 21 + 4)
check('a pack reads as known, worth 0', checkReward('[sticker_pack:Joker_Pack|allowance(coins:1)]', { economy }).issues.length === 0 && rewardWorth('[sticker_pack:Joker_Pack|allowance(coins:1)]', economy).worth === 0)
eq('Chef_Dish1_Complete and the Inject keys are presets', ['Chef_Dish1_Complete', 'Chef_Inject_Blocker_Epic', 'pick_20', 'joker_basket'].filter((k) => codes(`preset:${k}`).length === 0).length, 4)
eq('a Chef basket is worth its tier: Basic 0.25, Rare 1, Epic 4 (Free_round3 too)', ['Chef__Basic_Phase_2_Free_round', 'Chef__Rare_Phase_1_Extra_stock', 'Chef__Epic_Phase_1_Free_round3'].map((k) => presetValue(economy, k)?.value).join(' '), '0.25 1 4')
eq('the other presets have no worth until one is given', presetValue(economy, 'pick_3'), null)
eq('the Chef baskets offered to build with are the game-play ones (no _pricing_)', chefBasketKeys(economy).length, 17)
{
  const older = normalizeEconomy({ version: 3, keys: { packs: [createKey({ key: 'My_Pack', value: 2 }), createKey({ key: 'Joker_Pack' })], presets: [createKey({ key: 'pick_1', value: 5 })] } })
  check('an economy saved before gets the game keys added, keeps its own, and a typed worth stays', older.keys.packs.length === 609 && older.keys.packs.find((k) => k.key === 'My_Pack').value === 2 && older.keys.packs.find((k) => k.key === 'Joker_Pack').value === 0 && older.keys.presets.find((k) => k.key === 'pick_1').value === 5 && older.keys.presets.length === 106)
}

section('8c. Balancing a feature\'s tiers (section 6)')
{
  const eco = createEconomy({ currencies: [createCurrency({ name: 'dr-x', valueGameplay: 0.1 })] })
  const B = balanceTiers(
    [
      { tier: 'T1', target: 5, text: 'allowance(coins:3)+free_wild:1' },
      { tier: 'T2', target: 10, text: 'allowance(coins:2)+[dynamic(dr-x:20)]' },
      { tier: 'Grand', target: 25, text: 'allowance(coins:20)+free_wild:2' },
    ],
    { economy: eco, flagPct: 5, currency: 'dr-x' },
  )
  const [t1, t2, g] = B.rows
  eq('a tier\'s worth is its text read by the economy: 3 coins + a wild = 5.5', t1.worth, 5.5)
  check(`gap = worth - target, and its %: +0.5, +10% - flagged beyond the typed 5% (${t1.gap}, ${t1.gapPct}%)`, t1.gap === 0.5 && t1.gapPct === 10 && t1.flagged)
  check(`a tier short of its target: 4 against 10, -60% (${t2.gap}, ${t2.gapPct}%)`, t2.worth === 4 && t2.gap === -6 && t2.gapPct === -60 && t2.flagged)
  check(`cumulative: 9.5 against 15 after two tiers (${t2.cumGapPct}%)`, t2.cumWorth === 9.5 && t2.cumTarget === 15 && Math.abs(t2.cumGapPct - -36.6667) < 0.001)
  check(`the currency to close a gap: round((target - worth without it) / its worth) = (10 - 2) / 0.1 = ${t2.suggest?.amount}, written ${t2.suggest?.text}`, t2.suggest?.amount === 80 && t2.suggest.text === 'dynamic(dr-x:80)' && t2.suggest.without === 2)
  check('a tier already above its target needs none', t1.suggest?.amount === 0 && t1.suggest.text === null)
  check(`the grand prize's share: ${g.worth} of ${B.totals.worth} worth, ${g.target} of ${B.totals.target} target`, g.worth === 25 && B.totals.worth === 34.5 && Math.abs(B.totals.grandShareOfWorth - 25 / 34.5) < 1e-9 && B.totals.grandShareOfTarget === 25 / 40)
  const U = balanceTiers([{ target: 5, text: 'allowance(coins:3)' }, { target: 5, text: 'preset:pick_3' }, { target: 5, text: 'allowance(coins:5)' }], { economy: eco })
  check('a tier with a part that has no worth: worth and gap unknown, never smaller - and the running total unknown from there', U.rows[1].worth === null && U.rows[1].gap === null && U.rows[1].unknown.length === 1 && U.rows[2].cumWorth === null && U.totals.worth === null && U.rows[0].cumWorth === 3)
  const P = parseTierRows('T1\t5\tallowance(coins:3)\n10\tfree_wild:4\nnot a row')
  check('tiers pasted from a sheet: tier, target, text - or target, text - one a line; what cannot be read is said', P.rows.length === 2 && P.rows[0].tier === 'T1' && P.rows[0].target === 5 && P.rows[1].target === 10 && P.rows[1].text === 'free_wild:4' && P.bad.length === 1)
}

section('9. Chef reads the same table')
const chefValues = chefValuesFromEconomy(economy)
check('the Chef value table is the economy\'s, item for item', Object.keys(DEFAULT_REWARD_VALUES).every((k) => DEFAULT_REWARD_VALUES[k] === chefValues[k]), JSON.stringify({ chefValues, DEFAULT_REWARD_VALUES }))
check('...and the defaults are the economist\'s', DEFAULT_RESOURCE_VALUES.wild === 2.5 && DEFAULT_RESOURCE_VALUES.undo === 0.25)

console.log(fails ? `THE ECONOMY: ${fails} OF ${total} CHECKS FAILED` : `THE ECONOMY: ALL ${total} CHECKS PASSED`)
process.exit(fails ? 1 : 0)
