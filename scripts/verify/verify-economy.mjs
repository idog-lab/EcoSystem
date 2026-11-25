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
import { BASE_RULES, buildPlan, createPlan, modeRanges, parseSplitValues, withBaseRule } from '../../src/lib/economy/segmentFlow.js'
import { SEGMENT_FUNCTIONS, MODE_MULTIPLIERS, buildCondition, partCondition, progressionCondition, readCondition } from '../../src/lib/economy/segmentFunctions.js'
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
check('a preset not on the list is an error (the validator\'s rule)', !checkReward('preset:mini_game_999_gameplay_es', { economy }).ok && codes('preset:mini_game_999_gameplay_es').includes('unknown-key'))
check('a currency not known is an error (the validator\'s rule)', !checkReward('[dynamic(dr-made-up:5)]', { economy }).ok && codes('[dynamic(dr-made-up:5)]').includes('unknown-key'))
eq('dr-twister reads with nothing to say', codes('[dynamic(dr-twister:5)]').length, 0)
check('coins with 3 decimals are named on a tier prize', codes('allowance(coins:0.125)').includes('coin-decimals'))
check('...and allowed where 3 are (Merge Mania\'s small rewards)', !codes('allowance(coins:0.125)', { coinDecimals: 3 }).includes('coin-decimals'))
check('the order of the parts is never a finding', checkReward('preset:puzzle_gameplay_250+allowance(coins:3)+trigger:dailyreward_lowhabit', { economy }).issues.length === 0)

section('3a. The validator\'s rules (Reward Scanner Pro; economist: "The validator\'s")')
{
  const ok = (t, o) => checkReward(t, { economy, ...o }).ok
  check(`the four real examples read with nothing to fix, and with the prizes the validator counts (${REAL_EXAMPLES.map((t) => checkReward(t, { economy }).prizes)})`, REAL_EXAMPLES.every((t) => ok(t)) && REAL_EXAMPLES.map((t) => checkReward(t, { economy }).prizes).join() === '5,4,1,5')
  check('a dynamic(...) stands in brackets: bare, it must be fixed - in a chest too', codes('dynamic(dr-puzzle:5)').includes('dynamic-bare') && codes('chest:wooden(dynamic(dr-puzzle:5))').includes('dynamic-bare') && ok('[dynamic(dr-puzzle:5)]'))
  check('a [ ] group starts with dynamic(...) or sticker_pack:...', codes('[allowance(coins:2)|free_wild:4]').includes('group-start') && ok('[sticker_pack:Joker_Pack|allowance(coins:1)]'))
  check('one item alone in brackets is only a dynamic(...) or a pack', codes('[free_wild:1]').includes('group-redundant') && ok('[sticker_pack:Joker_Pack]'))
  check('no preset inside brackets, wherever it stands', codes('[preset:pick_1|allowance(coins:1)]').includes('group-preset') && codes('[dynamic(dr-puzzle:5)|preset:pick_1]').includes('group-preset'))
  check('a second dynamic goes in a group of its own, at the end', codes('[dynamic(dr-puzzle:5)|dynamic(dr-pet:2)]').includes('group-nesting') && codes('[dynamic(dr-puzzle:5)|[dynamic(dr-pet:2)]|allowance(coins:1)]').includes('group-nesting') && ok('[dynamic(dr-puzzle:5)|[dynamic(dr-pet:2)|allowance(coins:1)]]'))
  check('no option twice in a group, no "+" inside an option, no brackets around one item inside brackets', codes('[sticker_pack:Joker_Pack|free_wild:1|free_wild:1]').includes('group-duplicate') && codes('[dynamic(dr-puzzle:5)|allowance(coins:1)+free_wild:1]').includes('group-plus') && codes('[sticker_pack:Joker_Pack|[free_wild:1]]').includes('group-redundant'))
  check('a currency amount is whole - only coins take decimals', codes('[dynamic(dr-puzzle:2.5)]').includes('not-whole') && ok('allowance(coins:2.5)'))
  check('a trigger is lower case letters, digits and "_"; upper case only when allowed', codes('trigger:Pity').includes('trigger-name') && codes('trigger:sugar-rush').includes('trigger-name') && ok('trigger:Pity', { allowUppercaseTrigger: true }) && ok('trigger:_diamond_mine_tier_3'))
  check('a currency the game is known to have, though not in the table, is known (the game\'s list, the validator\'s)', ok('[dynamic(dr-villains-queen:1)]') && ok('[dynamic(dr-snowflake:1)]'))
  check('an allowance bucket not known is an error; pricing and milestone are known (the validator\'s)', codes('allowance:mystery(coins:1)').includes('unknown-key') && ok('allowance:pricing(coins:1)') && ok('allowance:milestone(coins:1)'))
  check('a pack or a trigger off the list stays a warning - the validator does not check those', ok('sticker_pack:Unknown_Pack_X') && codes('sticker_pack:Unknown_Pack_X').includes('unknown-key') && ok('trigger:some_new_trigger'))
  check('where the validator is looser the app\'s own rule stays: an amount of 0', codes('free_wild:0').includes('amount-below-1'))
  check('Missing(...) and Duplicate(...) are read, with a note that the validator reads them only if added there', ok('Missing(bucket,1)') && codes('Missing(bucket,1)').includes('draw-validator'))
  // The prize count.
  eq('prizes: triggers and hidden counters are not counted; a group whose every option is hidden is not', checkReward('trigger:dailyreward_lowhabit+allowance(coins:1)+[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]+[dynamic(dr-mission-2-hidden:1)]+free_wild:1', { economy }).prizes, 2)
  check('a chest, a pack and a preset are a prize each', checkReward('chest:wooden(free_wild:1+free_stock:1)', { economy }).prizes === 1 && checkReward('sticker_pack:Joker_Pack+preset:pick_1', { economy }).prizes === 2)
  check('0 prizes is worth a look (only triggers or hidden items)', codes('trigger:dailyreward_lowhabit').includes('no-prizes') && ok('trigger:dailyreward_lowhabit'))
  const eleven = Array.from({ length: 11 }, (_, i) => `sticker_pack:Joker_Pack${i}`).join('+')
  check('normal: more than 10 is worth a look; 10 is not', codes(eleven).includes('prize-count') && !codes(Array.from({ length: 10 }, (_, i) => `sticker_pack:P${i}`).join('+')).includes('prize-count'))
  const three = 'allowance(coins:1)+free_wild:1+free_stock:1'
  check('challenge: 3 or more is worth a look; tournament: more than 3 must be fixed', codes(three, { prizeMode: 'challenge' }).includes('prize-count') && ok(three, { prizeMode: 'tournament' }) && !ok(`${three}+free_undo:1`, { prizeMode: 'tournament' }))
  check('a limit of your own: more than it is worth a look', codes(three, { prizeMode: 'custom', prizeLimit: 2 }).includes('prize-count') && !codes(three, { prizeMode: 'custom', prizeLimit: 3 }).includes('prize-count'))
  check('the prize count is not judged on a text that cannot be read', !codes('trigger:Pity').includes('no-prizes'))
}
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
  eq('the functions taught: Brut Wins, the mode multiplier, balance, level, win rate, cohort, Chef dishes, Diamond Mine and Merge progression', SEGMENT_FUNCTIONS.map((f) => f.name).join(' '), 'fn_DailyBrutWins_m4 fn_DailyAvgModeMultiplier_m4 CoinsInAllowance CurrentLevel fn_Avg_winrate PjCohorts.ContainsCohort GetMTXEventDataListAsStr fn_DiamondMine_Progression fn_Merge_Progression')
  // The cohort (economist: "it just gives true or false if the user is in the cohort", PjCohorts.ContainsCohort(####)).
  const co = readCondition('PjCohorts.ContainsCohort(1234)')
  check(`a cohort stands alone, true or false, a dot in its name (${co.clauses[0]})`, co.ok && !co.issues.length && co.clauses[0] === 'In cohort 1234')
  const notIn = readCondition('!PjCohorts.ContainsCohort(1234)')
  check(`not in a cohort (economist: "yes"), written with ! and read so (${notIn.clauses[0]})`, notIn.ok && !notIn.issues.length && notIn.clauses[0] === 'Not in cohort 1234' && partCondition({ kind: 'cohort', cohortId: '1234', negate: true }).text === '!PjCohorts.ContainsCohort(1234)')
  eq('...written by the flow with its id and no U, as the example', partCondition({ kind: 'cohort', cohortId: '1109' }).text, 'PjCohorts.ContainsCohort(1109)')
  check('...a cohort id that is not digits must be fixed', /digits only/.test(partCondition({ kind: 'cohort', cohortId: '11a' }).problems[0]) && /Type the cohort id/.test(partCondition({ kind: 'cohort' }).problems[0]))
  // Chef dishes finished (economist: "(GetMTXEventDataListAsStr(53524U, "CompletedItems")?.Count() > 10) ... returns how many dishes the user finished in the chef feature").
  const chef = readCondition('(GetMTXEventDataListAsStr(53524U, “CompletedItems”)?.Count() > 10)')
  check(`the Chef example, its curly quotes as a chat writes them, in words (${chef.clauses[0]})`, chef.ok && !chef.issues.length && chef.clauses[0] === 'Chef dishes finished in event 53524 is above 10 dishes')
  eq('...written by the flow as the example, in its brackets, plain quotes', partCondition({ kind: 'chef-dishes', eventId: '53524', op: '>', value: 10 }).text, '(GetMTXEventDataListAsStr(53524U, "CompletedItems")?.Count() > 10)')
  check('...without ?.Count() it must be fixed; an event id without U too; another list than "CompletedItems" is named', readCondition('GetMTXEventDataListAsStr(53524U, "CompletedItems") > 10').issues.some((i) => i.code === 'form') && readCondition('(GetMTXEventDataListAsStr(53524, "CompletedItems")?.Count() > 10)').issues.some((i) => i.code === 'event-id') && readCondition('(GetMTXEventDataListAsStr(53524U, "Other")?.Count() > 10)').issues.some((i) => /"CompletedItems" only/.test(i.text)))
  check('...a number of dishes is whole', /whole number/.test(partCondition({ kind: 'chef-dishes', eventId: '1', op: '>', value: 2.5 }).problems[0]))
  const all = readCondition('PjCohorts.ContainsCohort(1234) && (GetMTXEventDataListAsStr(53524U, "CompletedItems")?.Count() > 10) && CurrentLevel > 519')
  check(`a cohort, Chef dishes and a level in one condition, part by part (${all.clauses.join(' | ')})`, all.ok && all.clauses.length === 3)
  eq('the modes and their multipliers (economist: "mode 1 - 1, mode 2 - 2, mode 3 - 4, mode 4 - 8") - the 1m,2m,4m,8m', MODE_MULTIPLIERS.map((m) => `${m.mode}:x${m.multiplier}`).join(' '), '1:x1 2:x2 3:x4 4:x8')
  check('...so the Brut Wins functions have nothing left unconfirmed, their mode inputs named by mode', ['fn_DailyBrutWins_m4', 'fn_DailyAvgModeMultiplier_m4'].every((n) => { const f = SEGMENT_FUNCTIONS.find((x) => x.name === n); return !f.open && f.args.slice(1).map((a) => `${a.mode}=${a.name}`).join(' ') === '1=1m 2=2m 3=4m 4=8m' }))
  const ooc = readCondition('CoinsInAllowance < 2 && CurrentLevel > 519')
  eq('the economist\'s balance and level example, in words', ooc.clauses.join(' | '), 'Balance is below 2 allowance | Current level is above 519')
  check('a name written alone is called with brackets by mistake, or a function without them: must be fixed', readCondition('CurrentLevel() > 5').issues.some((i) => i.code === 'form') && readCondition('fn_Merge_Progression > 5').issues.some((i) => i.code === 'form'))
  check('a name the app does not know is named, never guessed at (PayerTier)', readCondition('PayerTier > 2').ok && readCondition('PayerTier > 2').issues.some((i) => i.code === 'unknown-function' && /PayerTier/.test(i.text)))
  const wr = readCondition('fn_Avg_winrate(7) > 0.9')
  check(`the win rate, the economist's example: "in the last 7 days if the win rate is more than 90%" (${wr.clauses[0]})`, wr.ok && !wr.issues.length && wr.clauses[0] === 'Average win rate over the last 7 days is above 0.9 (90%)')
  eq('...written by the flow as the example writes it - the share with no m', partCondition({ kind: 'winrate', days: 7, op: '>', value: 0.9 }).text, 'fn_Avg_winrate(7) > 0.9')
  check('...its days a whole number, its share 0 to 1', /whole number/.test(partCondition({ kind: 'winrate', days: 2.5, op: '>', value: 0.9 }).problems[0]) && /from 0 to 1/.test(partCondition({ kind: 'winrate', days: 7, op: '>', value: 90 }).problems[0]) && readCondition('fn_Avg_winrate(7U) > 0.9').issues.some((i) => /whole number/.test(i.text)))
  eq('parts joined with && (economist: "they are added up with &&"): the balance and level example to the character', buildCondition([{ kind: 'balance', op: '<', value: 2 }, { kind: 'level', op: '>', value: 519 }]).condition, 'CoinsInAllowance < 2 && CurrentLevel > 519')
  eq('...a progression, a balance with decimals (m)', buildCondition([{ kind: 'dm-progression', eventId: '57634', op: '>', value: 95 }, { kind: 'balance', op: '<', value: 2.5 }]).condition, 'fn_DiamondMine_Progression(57634U) > 95 && CoinsInAllowance < 2.5m')
  const half = buildCondition([{ kind: 'balance', op: '<', value: 2 }, { kind: 'level', op: '>', value: 5.5 }])
  check(`...nothing written while a part is wrong, and which part says why (${JSON.stringify(half.problems)})`, half.condition === '' && half.problems.length === 1 && half.problems[0].index === 1 && /whole number/.test(half.problems[0].problems[0]))
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

section('8c. The flow of building segments (segmentFlow.js)')
{
  const plan = { ...createPlan(), feature: 'Disco', cuts: '9, 18, 40, 60, 100, 150, 240' }
  const only = buildPlan(plan)
  const eight = buildSegments('Disco', bandsFromCuts([9, 18, 40, 60, 100, 150, 240]))
  check(`the base: the Brut Wins bands, one segment a band, as before (${only.segments.length})`, only.segments.length === 8 && only.errors.length === 0 && only.segments.every((s, i) => s.name === eight[i].name && s.condition === eight[i].condition))
  // The economist's example: the first three segments get a mode split - three more segments.
  const split = buildPlan({ ...plan, splits: [{ values: '3', segments: [0, 1, 2] }] })
  check(`a mode split on the first three: 3 new segments (${split.segments.length}), in the order of the base`, split.segments.length === 11 && split.segments.slice(0, 6).map((s) => s.name).join(' ') === 'Disco_BW_0_9_Mode_0_3 Disco_BW_0_9_Mode_3_plus Disco_BW_9_18_Mode_0_3 Disco_BW_9_18_Mode_3_plus Disco_BW_18_40_Mode_0_3 Disco_BW_18_40_Mode_3_plus' && split.segments[6].name === 'Disco_BW_40_60')
  const rules = buildSegments('Disco', bandsFromCuts([9, 18, 40, 60, 100, 150, 240]), { splitByMode: true })
  check('...each to the character of the rules\' mode split (Disco_BW_9_18_Mode_0_3 and _Mode_3_plus)', ['Disco_BW_9_18_Mode_0_3', 'Disco_BW_9_18_Mode_3_plus'].every((n) => split.segments.find((s) => s.name === n).condition === rules.find((s) => s.name === n).condition))
  const two = buildPlan({ ...plan, splits: [{ values: '2, 4', segments: [7] }] })
  const top = two.segments.filter((s) => s.base === 7)
  check(`two split values make three (${top.map((s) => s.name).join(', ')})`, top.map((s) => s.name).join(' ') === 'Disco_BW_240_Plus_Mode_0_2 Disco_BW_240_Plus_Mode_2_4 Disco_BW_240_Plus_Mode_4_plus' && /\(.*fn_DailyAvgModeMultiplier_m4.* >= 2m\) && \(.*< 4m\)$/.test(top[1].condition))
  // A specific: a tag and a condition, on the segments picked.
  const ooc = buildPlan({ ...plan, specifics: [{ tag: 'OOC', parts: [{ kind: 'balance', op: '<', value: 2 }], segments: [0, 1] }], splits: [{ values: '3', segments: [0] }] })
  check(`a specific is added with && to its segments only, its tag in their names, before the mode (${ooc.segments.slice(0, 3).map((s) => s.name).join(', ')})`, ooc.segments[0].name === 'Disco_BW_0_9_OOC_Mode_0_3' && ooc.segments[2].name === 'Disco_BW_9_18_OOC' && ooc.segments[2].condition.endsWith('<= 18 && CoinsInAllowance < 2') && ooc.segments[0].condition.includes('<= 9 && CoinsInAllowance < 2 && (') && ooc.segments[3].name === 'Disco_BW_18_40' && !ooc.segments[3].condition.includes('CoinsInAllowance'))
  check(`...and the holes it leaves - the players of those bands it leaves out - are warned, nothing added (economist: "it shouldnt add a segments for the rest, but it should warn when there are holes") (${ooc.warnings[0]})`, ooc.warnings.length === 2 && /A hole in Disco_BW_0_9: its players who are not "Balance is below 2 allowance" are in no segment - Disco_BW_0_9_OOC holds only those who are/.test(ooc.warnings.join(' ')))
  check('every segment of the flow reads with nothing to fix', ooc.segments.every((s) => readCondition(s.condition).ok && !readCondition(s.condition).issues.length))
  const wrong = buildPlan({ ...plan, feature: '', specifics: [{ tag: '', parts: [{ kind: 'dm-progression', eventId: '', op: '>', value: 95 }], segments: [] }], splits: [{ values: 'x', segments: [0] }, { values: '3', segments: [0] }] })
  check(`what must be fixed is said: no feature, a specific without a tag or event id, a segment in two mode splits, a split value that is not one (${wrong.errors.length})`, ['feature\'s name', 'type its tag', 'event id', 'two mode splits', 'not a split value'].every((w) => wrong.errors.some((e) => e.includes(w))) && wrong.warnings.some((w) => /added to no segment/.test(w)))
  check('two specifics with one tag clash', buildPlan({ ...plan, specifics: [1, 2].map(() => ({ tag: 'X', parts: [{ kind: 'level', op: '>', value: 5 }], segments: [0] })) }).errors.some((e) => /given to two specifics/.test(e)))
  // The base is one rule, toggled (economist: "the base is not 100% of the time will be brutwins"), in bands, named
  // by its fixed code.
  eq('the rules that can be the base and their codes (ChefDishes this app\'s own: "put someting looks good in the naming")', BASE_RULES.map((r) => r.code).join(' '), 'BW Mode Balance Level WinRate DMProg MergeProg ChefDishes')
  const chefBase = buildPlan({ ...withBaseRule(plan, 'chef-dishes'), baseEventId: '53524' })
  check(`a Chef dishes base: bands of dishes finished, each comparison in brackets as the example (${chefBase.segments.map((s) => `${s.name}: ${s.condition}`).join(' | ')})`, chefBase.errors.length === 0 && chefBase.segments.map((s) => s.name).join(' ') === 'Disco_ChefDishes_0_10 Disco_ChefDishes_10_30 Disco_ChefDishes_30_Plus' && chefBase.segments[1].condition === '(GetMTXEventDataListAsStr(53524U, "CompletedItems")?.Count() > 10) && (GetMTXEventDataListAsStr(53524U, "CompletedItems")?.Count() <= 30)')
  check('...its event id needed, its band ends whole', buildPlan(withBaseRule(plan, 'chef-dishes')).errors.some((e) => /type the event id/.test(e)) && buildPlan({ ...withBaseRule(plan, 'chef-dishes'), baseEventId: '1', cuts: '2.5' }).errors.some((e) => /whole numbers/.test(e)))
  check('a plan saved before the base could change is a Brut Wins base, as it was', buildPlan({ feature: 'Disco', cuts: '9, 18', weights: '1m,2m,4m,8m', specifics: [], splits: [] }).segments.map((s) => s.name).join(' ') === 'Disco_BW_0_9 Disco_BW_9_18 Disco_BW_18_Plus')
  const level = buildPlan(withBaseRule(plan, 'level'))
  check(`a level base: bands of the current level, named Disco_Level_ (${level.segments.map((s) => `${s.name}: ${s.condition}`).join(' | ')})`, level.errors.length === 0 && level.segments.map((s) => s.name).join(' ') === 'Disco_Level_0_100 Disco_Level_100_300 Disco_Level_300_519 Disco_Level_519_Plus' && level.segments[1].condition === 'CurrentLevel > 100 && CurrentLevel <= 300' && level.segments[3].condition === 'CurrentLevel > 519')
  const wrBase = buildPlan({ ...withBaseRule(plan, 'winrate'), baseDays: 14 })
  check(`a win-rate base: its days, its shares with no m (${wrBase.segments.map((s) => s.name).join(', ')})`, wrBase.segments[1].name === 'Disco_WinRate_0.5_0.9' && wrBase.segments[1].condition === 'fn_Avg_winrate(14) > 0.5 && fn_Avg_winrate(14) <= 0.9')
  const dm = buildPlan({ ...withBaseRule(plan, 'dm-progression'), baseEventId: '57634' })
  check('a progression base: the event id written with U, named DMProg', dm.segments[2].name === 'Disco_DMProg_95_Plus' && dm.segments[2].condition === 'fn_DiamondMine_Progression(57634U) > 95' && buildPlan(withBaseRule(plan, 'dm-progression')).errors.some((e) => /type the event id/.test(e)))
  check('a mode base: written with m, like the mode split', buildPlan(withBaseRule(plan, 'mode')).segments[1].condition.endsWith('> 2m && (fn_DailyAvgModeMultiplier_m4(3,1m,2m,4m,8m)*0.7m+fn_DailyAvgModeMultiplier_m4(14,1m,2m,4m,8m)*0.3m) <= 4m'))
  check('band ends that do not fit the rule must be fixed: a level of 5.5, a win rate of 1 or more, a progression of 100 or more', buildPlan({ ...withBaseRule(plan, 'level'), cuts: '5.5' }).errors.some((e) => /whole numbers/.test(e)) && buildPlan({ ...withBaseRule(plan, 'winrate'), cuts: '0.5, 1.2' }).errors.some((e) => /below 1/.test(e)) && buildPlan({ ...withBaseRule(plan, 'merge-progression'), baseEventId: '1', cuts: '100' }).errors.some((e) => /below 100/.test(e)))
  const back = withBaseRule({ ...withBaseRule(plan, 'level'), cuts: '50, 150' }, 'bw')
  check('switching the base and back keeps what was typed for each rule', back.cuts === plan.cuts && withBaseRule(back, 'level').cuts === '50, 150')
  check('specifics and mode splits work on any base: a level base, OOC on the first, the last split', (() => { const p = buildPlan({ ...withBaseRule(plan, 'level'), specifics: [{ tag: 'OOC', parts: [{ kind: 'balance', op: '<', value: 2 }], segments: [0] }], splits: [{ values: '3', segments: [3] }] }); return p.errors.length === 0 && p.segments.map((s) => s.name).join(' ') === 'Disco_Level_0_100_OOC Disco_Level_100_300 Disco_Level_300_519 Disco_Level_519_Plus_Mode_0_3 Disco_Level_519_Plus_Mode_3_plus' })())
  check('every base writes conditions that read with nothing to fix', BASE_RULES.every((r) => buildPlan({ ...withBaseRule(plan, r.id), baseEventId: '57634' }).segments.every((s) => readCondition(s.condition).ok && !readCondition(s.condition).issues.length)))
  eq('split values read: "2, 4" and junk', JSON.stringify(parseSplitValues('4, 2, x, 0')), JSON.stringify({ values: [2, 4], bad: ['x', '0'] }))
  eq('mode ranges of one split: the rules\' names', modeRanges([3]).map((r) => r.name).join(' '), 'Mode_0_3 Mode_3_plus')
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
  check(`the currency to close a gap: round((target - worth without it) / its worth) = (10 - 2) / 0.1 = ${t2.suggest?.amount}, written ${t2.suggest?.text}`, t2.suggest?.amount === 80 && t2.suggest.text === '[dynamic(dr-x:80)]' && t2.suggest.without === 2)
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
