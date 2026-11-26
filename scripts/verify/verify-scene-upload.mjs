// THE SCENE UPLOAD (src/features/sceneUpload): the model's formulas, held to
// values read off the economist's model and DCX on 26 Nov 2026. (The full
// check - all 12,000 levels of Config - Levels and all 6,750 rows of Resource
// allowances, equal to the last digit - was run against the files themselves,
// which are not kept in this repository.)
//
//   npx vite-node scripts/verify/verify-scene-upload.mjs
import {
  albumValue, allowanceRows, coinsOf, levelCosts, levelValues, mfValue, mround, newLevelRows, rewardText,
  sceneReward, suggestRequirements, taskPrefixOf,
} from '../../src/features/sceneUpload/lib/sceneEngine.js'
import { STAR_BANDS } from '../../src/features/sceneUpload/lib/sceneRules.js'
import { assetFor, dcxFilesOf, findArea, latestVersionFolders, linkInMessage, parseDate, parseSchedule, upcomingRows } from '../../src/features/sceneUpload/lib/sceneSources.js'

let fails = 0
let total = 0
function check(label, ok, detail = '') {
  total++
  if (!ok) fails++
  console.log(`${ok ? '  OK ' : 'FAIL'}  ${label}${!ok && detail ? ` (${detail})` : ''}`)
}

console.log('1 level costs (Level Cost tab)')
const costs = levelCosts(12150)
check('level 1 costs 1,000', costs.cost[1] === 1000)
check('level 6 is typed: 1,000', costs.cost[6] === 1000)
check('level 4304: 27749.99999999967 rounds to 27,500 (Excel, no tolerance)', costs.cost[4304] === 27500, costs.cost[4304])
check('level 5647 costs 50,500', costs.cost[5647] === 50500, costs.cost[5647])
check('level 12000 costs 211,000, before rounding 211131.3', costs.cost[12000] === 211000 && Math.abs(costs.before[12000] - 211131.3) < 1e-6)
check('level 12150 costs 215,000 (+25.3 a level)', costs.cost[12150] === 215000, costs.cost[12150])
check('MROUND rounds a half away from zero', mround(2.5, 1) === 3 && mround(-2.5, 1) === -3)

console.log('2 level values (Config - Levels)')
const v = levelValues(12000, 211000, false)
check('level 12000: 211000 / 528000 / 53000 / 422000 / 2110 / 211 / 211000 / 21100',
  [v.entry, v.wild, v.undo, v.stock, v.leftover, v.match, v.completion, v.streak].join() === '211000,528000,53000,422000,2110,211,211000,21100', JSON.stringify(v))
check('a puzzle layout pays 10% less on completion (level 11364: 175,500)', levelValues(11364, 195000, true).completion === 175500)
const rows = newLevelRows({ fromLevel: 12001, toLevel: 12002, costs, layoutOf: (l) => `L${l}`, puzzleLayouts: new Set(), copied: [5, 710, 9120, 9210, 9320, 9410, 9520, 9610, 7] })
check('new rows end with the columns copied from the DCX', rows[0].length === 19 && rows[0].slice(10).join() === '5,710,9120,9210,9320,9410,9520,9610,7')

console.log('3 the scene reward (Area Rewards - Test)')
const raya = sceneReward({ kind: 'regular', stars: 150, endLevel: 12000, costs, previousCoins: 620000, stickerPack: 'Golden_T1_1_3G_mid_Vague_Area_Bonus_6' })
check("Raya: the DCX's completion reward to the character", raya.text ===
  'coins:635000+free_wild:1+free_stock:1+free_undo:3+free_entry:1+[sticker_pack:Golden_T1_1_3G_mid_Vague_Area_Bonus_6]+[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]+[dynamic(dr-puzzle:100)|allowance(coins:1)]+[dynamic(dr-mf-charm-uncapped:100)|allowance(coins:1)]+[dynamic(dr-hidden-charm-blitz:100)|[dynamic(dr-hidden:1)]]+trigger:scene_completion', raya.text)
check('Raya: the model gives 633,000, to the nearest 5,000', raya.modelCoins === 633000 && raya.coins === 635000)
const bonus = sceneReward({ kind: 'bonus', stars: 50, endLevel: 11850, costs, previousCoins: 615000, stickerPack: 'Royal_T1_1_1R_Vague_Royal_Scene' })
check("bonus #26: the DCX's completion reward", bonus.text ===
  'coins:620000+[sticker_pack:Royal_T1_1_1R_Vague_Royal_Scene]+[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]+[dynamic(dr-puzzle:50)|allowance(coins:0.5)]+[dynamic(dr-mf-charm-uncapped:50)|allowance(coins:0.5)]+[dynamic(dr-hidden-charm-blitz:50)|[dynamic(dr-hidden:1)]]+trigger:scene_completion+trigger:bonus_scene_ended', bonus.text)
check('coins are always above the scene before', sceneReward({ kind: 'regular', stars: 150, endLevel: 12000, costs, previousCoins: 635000 }).coins === 640000)
check('a scene before a bonus enters it', rewardText({ coins: 1, kind: 'regular', nextIsBonus: true }).endsWith('+trigger:scene_completion+trigger:entered_bonus_scene'))
check('coins read back from a reward', coinsOf('coins:635000+free_wild:1') === 635000)
check('task names from the Area ID', taskPrefixOf('Area_80_Aladdin_Market') === 'AladdinMarket' && taskPrefixOf('BonusArea_27_BonusScene_27_figures_07') === 'BonusScene27Figures07')

console.log('4 missions')
const stars = [1, 3, 2, 2, 3, 1, 5, 3, 4, 3, 4]
const req = suggestRequirements({ stars, count: 11, total: 150, seed: 'x' })
check('the suggestion adds up to 150', req.reduce((a, b) => a + b, 0) === 150, req.join())
check('every mission inside its star range', req.every((r, i) => r >= STAR_BANDS[stars[i]].low - 2 && r <= STAR_BANDS[stars[i]].high + 2), req.join())
check('the same scene gets the same suggestion', suggestRequirements({ stars, count: 11, total: 150, seed: 'x' }).join() === req.join())
check('never the list of the scene before', suggestRequirements({ stars, count: 11, total: 150, seed: 'x', previous: req }).join() !== req.join())
const b = suggestRequirements({ stars: null, count: 7, total: 50, seed: 'b' })
check('a bonus scene: 50 over its missions', b.reduce((a, c) => a + c, 0) === 50 && b.length === 7, b.join())

console.log('5 Resource allowances (Config - Allowance)')
const c12000 = levelCosts(12000)
check('album at level 11976 is capped at the last level (211,000)', albumValue(11976, c12000, 12000) === 211000)
check('MF reward past the last level grows the curve (220,000, no #N/A)', mfValue(11976, c12000) === 220000)
const al = allowanceRows({ costs: c12000, maxLevel: 12000 })
check('375 costs x 18 groups = 6,750 rows', al.rows.length === 6750 && al.uniqueCosts === 375)
check('harvest is one level earlier', al.rows.find((r) => r[0] === 'harvest' && r[3] === 1200)?.[2] === 13)
const grown = allowanceRows({ costs, maxLevel: 12150, baseline: al.rows })
check('150 more levels: 4 new costs in every group, album rows look further', grown.rows.length === 6822 && grown.changed.some((x) => x.group === 'album_reward' && x.before === 211000))

console.log('6 sources')
const sched = parseSchedule([['n', 'name', 'date'], ['80', 'Aladdin - Market', '26/11/2026'], ['81', 'The Aristocats - Jazz Night', '3/12/2026'], ['81.5', '#27 Bonus Scene', '3/12/2026'], ['85', 'The Muppet Show - Main Stage', '14/1/2027'], ['86', 'Wish - Rosas', 46043]])
check('dates read day first, and as sheet numbers', parseDate('3/12/2026') === '2026-12-03' && sched.find((s) => s.number === 86).date === '2026-01-21')
check('a .5 scene is the bonus with its number', sched.find((s) => s.number === 81.5).isBonus && sched.find((s) => s.number === 81.5).bonusNo === 27)
check('the draft link in a Slack message', linkInMessage('Configured in [V1.29.0](https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz/edit?gid=1#gid=1)') === 'https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz/edit?gid=1#gid=1')
check('Area 80 and bonus 27 found in an Area list', findArea([['Area ID'], ['Area_80_Aladdin_Market', 'aladdin_market'], ['BonusArea_27_BonusScene_27_figures_07', 'b']], sched[2])?.areaId === 'BonusArea_27_BonusScene_27_figures_07')
check('postcards matched by film name', assetFor('Toy Story - Pizza Planet', ['upcoming_toy_story']) === 'upcoming_toy_story' && assetFor('Onward - Ian\'s Room', ['upcoming_onward_ian']) === 'upcoming_onward_ian')
check('a missing postcard is named, not guessed', assetFor('The Aristocats - Jazz Night', ['upcoming_the_aristocrats']) === null)
const up = upcomingRows({ schedule: sched, afterNumber: 80, assets: ['upcoming_wish'], missing: 'blank' })
check('upcoming: bonus scenes left out, a missing one kept as an empty row when asked', up.rows.map((r) => r.asset).join() === ',,upcoming_wish' && up.notFound.length === 2)
const folders = latestVersionFolders([{ name: 'WR decrease - HB treatment  1.28.0', f: 1 }, { name: 'DCX 1.20', f: 1 }, { name: 'WR decrease - HB treatment  1.29.0', f: 1 }, { name: 'Internal DCX', f: 1 }], (x) => x.f)
check('the two newest version folders', folders.map((f) => f.name.slice(-6)).join() === '1.29.0,1.28.0')
check('only Low, medium and High DCX files', dcxFilesOf([{ name: 'High_dcx_1.29.0_treatment' }, { name: 'Copy of medium_dcx_1.29.0_treatment' }, { name: 'Low_dcx_1.29.0_treatment' }, { name: '1.28.0 moral test' }], () => true).map((f) => f.name.split('_')[0]).join() === 'Low,High')

console.log(`\n${total - fails} of ${total} checks passed`)
if (fails) process.exit(1)
