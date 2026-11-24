// CHEF PRIZES AS REWARD TEXT (chefPrizeText.js): written by the economy's rules,
// and what cannot be written is said, never dropped or rounded.
//   npx vite-node scripts/verify/verify-chef-prize-text.mjs
import { chefPrizeTexts, prizeText } from '../../src/features/chef/lib/chefPrizeText.js'
import { syntheticExampleState } from '../../src/features/chef/data/syntheticExample.js'
import { checkReward } from '../../src/lib/economy/parse.js'
import { createEconomy } from '../../src/lib/economy/economyModel.js'

let fails = 0
let total = 0
const check = (name, cond) => {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}`)
}
const economy = createEconomy()
check('a prize is written coins, wilds, extra stock, undos, free rounds - the economy\'s order', prizeText({ coins: 3, wild: 1, extraStock: 2, freeRound: 1, undo: 4 }).text === 'allowance(coins:3)+free_wild:1+free_stock:2+free_undo:4+free_entry:1')
check('coins are written to 2 decimals, and the rounding is said', (() => { const t = prizeText({ coins: 9.589, wild: 0, extraStock: 0, freeRound: 0, undo: 0 }); return t.text === 'allowance(coins:9.59)' && t.coinsRounded?.to === 9.59 })())
check('an amount that is not a whole item (should one ever come): no text at all, and why', (() => { const t = prizeText({ coins: 3, wild: 0, extraStock: 0, freeRound: 0, undo: 4.8 }); return t.text === '' && /4.8 Undo: not a whole item/.test(t.problems[0]) })())
check('a prize that is not known: no text, said', prizeText(null).text === '' && /not known/.test(prizeText(null).problems[0]))
const s = syntheticExampleState()
const base = chefPrizeTexts(s, null, economy)
check(`at the base every prize of the made-up example is written, and reads with nothing to fix (${base.filter((r) => r.text).length} of ${base.length})`, base.every((r) => r.text) && base.every((r) => checkReward(r.text, { economy }).ok))
check('the dishes of both rounds and both grand prizes are there', base.some((r) => r.round === 'rc' && r.kind === 'dish') && base.some((r) => r.id === 'grand-main') && base.some((r) => r.id === 'grand-rc'))
const scaled = s.segments.find((seg) => (Number(seg.prizeFactor) || 1) * (Number(seg.burnout) || 1) !== 1)
const rows = chefPrizeTexts(s, scaled, economy)
const spooky = rows.find((r) => r.name === 'Spooky Hot Chocolate')
check(`for a scaled segment (${scaled?.name}) every prize is written: scaled amounts round down to whole items (4 undos x1.2 = 4.8 -> ${spooky?.text})`, rows.every((r) => r.text) && /free_undo:4$/.test(spooky?.text ?? ''))
const g = rows.find((r) => r.id === 'grand-main')
check(`a grand prize is its rounded worth: its coins are set to it, and it says so (${g?.text}: ${g?.note})`, g?.text === 'allowance(coins:100)' && g.worth === 100 && /the coins are set so it is worth 100/.test(g.note))
const older = { ...s, rewards: { ...s.rewards, itemRounding: 'nearest' } }
check('an older "to the nearest" setting in a save is not read: still rounded down', chefPrizeTexts(older, scaled, economy).find((r) => r.name === 'Spooky Hot Chocolate')?.text === spooky?.text)
console.log(fails ? `${fails} of ${total} checks FAILED` : `${total}/${total} checks passed`)
process.exit(fails ? 1 : 0)
