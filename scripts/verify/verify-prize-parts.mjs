// A PRIZE AS PARTS (src/lib/economy/prizeParts.js): the economist's real prizes read into parts and written back the
// same; parts picked give the text the Economy page would build.
//   npx vite-node scripts/verify/verify-prize-parts.mjs
import { emptyParts, presetsByKind, presetsFromKinds, readPrize, writePrize } from '../../src/lib/economy/prizeParts.js'

let fails = 0
let total = 0
const check = (name, cond, extra = '') => {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}${!cond && extra ? `  [${extra}]` : ''}`)
}

// From the economist's Wicked Trails export (the trigger left out - the export adds it).
const real = [
  'preset:mini_game_3_gameplay_allowance',
  'chest:golden(allowance(coins:0.66)+preset:puzzle_gameplay_20+preset:mini_game_5_gameplay_allowance)',
  '[sticker_pack:Common_T3_1_2C_Low_Rarity_Game|allowance(coins:0.2)]+[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]',
  'allowance:milestone(coins:4)+free_entry:1+preset:puzzle_gameplay_100+[sticker_pack:Golden_T1_1_3G_high_Vague_Game]+[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]+preset:Chef__Epic_Phase_1_Extra_stock',
]
for (const text of real) {
  const back = writePrize(readPrize(text).parts)
  // The builder writes in the order of 2.3, so a preset written after the pack comes back before it.
  const same = (a) => a.split('+').sort().join('+')
  check(`read and written back, nothing lost: ${text.slice(0, 70)}${text.length > 70 ? '...' : ''}`, same(back) === same(text) || back === text, back)
}
const gp = readPrize(real[3]).parts
check(`the Final Prize read into parts (coins ${gp.coins} in ${gp.bucket}, free round ${gp.entry}, ${gp.presets.length} presets, pack ${gp.pack}, counter ${gp.packCounter})`, gp.coins === 4 && gp.bucket === 'milestone' && gp.entry === 1 && gp.presets.length === 2 && gp.pack === 'Golden_T1_1_3G_high_Vague_Game' && gp.packCounter && gp.extra.length === 0)
const pk = readPrize(real[2]).parts
check('a pack with a coin alternative', pk.pack === 'Common_T3_1_2C_Low_Rarity_Game' && pk.packCoins === 0.2 && pk.packCounter)
check('a chest is read and kept', readPrize(real[1]).parts.chest === 'golden' && writePrize(readPrize(real[1]).parts) === real[1])

// Picked from nothing.
const picked = { ...emptyParts(), coins: 1.5, wild: 2, undo: 3, presets: ['puzzle_gameplay_10'], pack: 'Common_T3_1_2C_Low_Rarity_Game', currencies: [{ name: 'dr-puzzle', amount: 5 }] }
check(`parts picked give the text (${writePrize(picked)})`, writePrize(picked) === 'allowance(coins:1.5)+free_wild:2+free_undo:3+preset:puzzle_gameplay_10+[sticker_pack:Common_T3_1_2C_Low_Rarity_Game]+[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]+[dynamic(dr-puzzle:5)]')
check('no pack counter when it is switched off', !writePrize({ ...picked, packCounter: false }).includes('dr-pack-counter'))
check('0 or nothing gives no part, never a broken one', writePrize({ ...emptyParts(), coins: 0, wild: 0, currencies: [{ name: 'dr-puzzle', amount: 0 }] }) === '')
check('a chest around the parts', writePrize({ ...emptyParts(), undo: 2, chest: 'silver' }) === 'chest:silver(free_undo:2)')
check('a trigger is read and written first', readPrize('free_wild:1+trigger:x').parts.triggers[0] === 'x' && writePrize(readPrize('trigger:x+free_wild:1').parts) === 'trigger:x+free_wild:1')
const kinds = presetsByKind(['mf_25_gameplay_undo', 'puzzle_gameplay_20', 'mini_game_5_gameplay_allowance', 'puzzle_gameplay_10'])
check('presets by kind: the puzzle, the mini game, the others', kinds.puzzle.amount === 20 && kinds.mini.amount === 5 && kinds.mini.kind === 'allowance' && kinds.others.join() === 'mf_25_gameplay_undo,puzzle_gameplay_10' && presetsFromKinds(kinds).join() === 'puzzle_gameplay_20,mini_game_5_gameplay_allowance,mf_25_gameplay_undo,puzzle_gameplay_10')
check('a text that cannot be read is kept whole', readPrize('free_wild:(').readable === false && writePrize(readPrize('free_wild:(').parts) === 'free_wild:(')

console.log(`\nPRIZE PARTS: ${total - fails} of ${total} checks passed`)
process.exit(fails ? 1 : 0)
