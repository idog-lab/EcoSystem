// SMALL REWARDS CC (smallRewardsCc.js): the bank and weights for a player who
// can no longer get some of the items - on a small event shaped like a built one.
//   npx vite-node scripts/verify/verify-small-rewards-cc.mjs
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { buildCcBankSheet, buildCcWeightsSheet, ccOptions, ccSyntax, ccWorkbookSheets } from '../../src/features/merge/lib/export/smallRewardsCc.js'
import { buildSmallRewardsBankSheet, buildSmallRewardWeightsSheet, buildCcWorkbook, buildWorkbook, buildAllSegmentsWorkbook, buildAllSheetsAsValueRows, buildAllSegmentsSheetsAsValueRows } from '../../src/features/merge/lib/export/eventSheets.js'

let fails = 0
let total = 0
const check = (name, cond) => {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}`)
}
const group = (id, items) => ({ id, name: id, items })
const groups = [
  group('t1', { twister: 1 }),
  group('c1', { coins: 1 }),
  group('p1', { puzzles: 1 }),
  group('p1t2', { puzzles: 1, twister: 2 }),
  group('c1t1', { coins: 1, twister: 1 }),
  group('e2ch1t2', { energy: 2, charms: 1, twister: 2 }),
]
const rows = [
  { rank: 5, noDropWeight: 0, entries: [{ groupId: 't1', weight: 1000 }], belowStart: true },
  { rank: 6, noDropWeight: 0, entries: [{ groupId: 'c1', weight: 500 }, { groupId: 'p1', weight: 250 }, { groupId: 't1', weight: 250 }] },
  { rank: 7, noDropWeight: 0, entries: [{ groupId: 'p1t2', weight: 700 }, { groupId: 'c1t1', weight: 300 }] },
  { rank: 10, noDropWeight: 0, entries: [{ groupId: 'e2ch1t2', weight: 1000 }] },
]
const board = { dropGroups: groups, dropGroupsConfig: [1, 2, 3, 4].map((rank) => ({ rank, noDropWeight: 100, entries: [] })).concat(rows), minDropRank: 6 }
const boards = [board]
const rc = []

const opts = ccOptions()
check(`seven CCs: each of Twister, puzzles and charms alone, each pair, all three (${opts.map((o) => `CC${o.n} ${o.label}`).join('; ')})`, opts.length === 7 && opts[0].label === 'No Twister' && opts[6].label === 'No Twister, Puzzles, Charms' && opts.every((o) => !o.missing.includes('energy')))
check('a missing puzzle or charm becomes a coin item of the same rank; merge energy and coins are never touched', ccSyntax('puzzle-r2+charm-r3', ['puzzles', 'charms']).syntax === 'coin-r2+coin-r3' && ccSyntax('coin-r3+dr-r1', ['twister', 'puzzles', 'charms']).syntax === 'coin-r3+dr-r1')
check('a missing Twister item is not given (economist: "we can just not give drops from it anymore")', ccSyntax('puzzle-r1+dr-twister-r2', ['twister']).syntax === 'puzzle-r1' && ccSyntax('dr-twister-r1', ['twister']).syntax === '')
check('...in a container that has to give 3 rewards, a rank-1 merge energy takes its place (economist: "u can enter a rank 1 energy into it")', ccSyntax('dr-r2+charm-r1+dr-twister-r2', ['twister']).syntax === 'dr-r2+charm-r1+dr-r1' && ccSyntax('dr-r2+charm-r1+dr-twister-r2', ['twister', 'charms']).syntax === 'dr-r2+coin-r1+dr-r1')

const normalBank = buildSmallRewardsBankSheet(boards, { recompletionBoards: rc })
const normalWeights = buildSmallRewardWeightsSheet(boards, { recompletionBoards: rc })
const bank = (missing) => buildCcBankSheet(boards, rc, missing)
const weights = (missing) => buildCcWeightsSheet(boards, rc, missing)
const syntaxOf = (sheet) => sheet.rows.map((r) => r.cells[1])
const tier = (sheet, t) => sheet.rows.find((r) => r.cells[0] === t)?.cells

console.log(`      normal: ${syntaxOf(normalBank).join(' | ')}`)
console.log(`      no Twister: ${syntaxOf(bank(['twister'])).join(' | ')}`)
const onlyTwister = normalBank.rows.filter((r) => /^dr-twister-r\d$/.test(r.cells[1])).map((r) => r.cells[0])
check(`no Twister: a container that dropped only a Twister item drops nothing and leaves the sheets (${onlyTwister.join(', ')}); the others keep their keys, in order`, onlyTwister.length === 1 && bank(['twister']).rows.map((r) => r.cells[0]).join() === normalBank.rows.map((r) => r.cells[0]).filter((k) => !onlyTwister.includes(k)).join())
check('no Twister: no Twister item is left, none became a coin, and the three-item container got its rank-1 energy', syntaxOf(bank(['twister'])).every((s) => !/dr-twister/.test(s)) && syntaxOf(bank(['twister'])).includes('puzzle-r1') && syntaxOf(bank(['twister'])).includes('coin-r1') && syntaxOf(bank(['twister'])).includes('dr-r2+charm-r1+dr-r1') && !syntaxOf(bank(['twister'])).includes('coin-r1+coin-r1'))
const wt = weights(['twister'])
check(`no Twister: merge tier 5 drops nothing - its weights go to NoDrop (${tier(wt, 5).join(' ')})`, tier(wt, 5).slice(1, -1).every((w) => w === 0) && tier(wt, 5).at(-1) === 1000)
check(`...at merge tier 6 the Twister-only container's 250 goes to NoDrop (${tier(wt, 6).join(' ')})`, tier(wt, 6).at(-1) === 250 && tier(wt, 6).slice(1).reduce((s, w) => s + w, 0) === 1000)
check('...the other tiers keep their weights exactly, and every tier still adds up to 1000', [7, 10].every((t) => JSON.stringify(tier(wt, t).slice(-1)) === JSON.stringify(tier(normalWeights, t).slice(-1))) && wt.rows.filter((r) => r.cells[0] >= 5).every((r) => r.cells.slice(1).reduce((s, w) => s + w, 0) === 1000))
check('no puzzles: puzzle items are coins; tier 5 still drops its Twister item', syntaxOf(bank(['puzzles'])).every((s) => !/puzzle/.test(s)) && JSON.stringify(tier(weights(['puzzles']), 5)) === JSON.stringify(tier(normalWeights, 5)))
const all = bank(['twister', 'puzzles', 'charms'])
check(`all three: only coins and merge energy are left (${syntaxOf(all).join(' | ')})`, syntaxOf(all).every((s) => s.split('+').every((k) => /^(coin|dr)-r\d$/.test(k))) && syntaxOf(all).includes('dr-r2+coin-r1+dr-r1'))
check('the rows a CC changes are marked to be highlighted, and only those', bank(['charms']).rows.filter((r) => r.highlight).length === 1 && wt.rows.filter((r) => r.highlight).map((r) => r.cells[0]).join() === '5,6')

const sheets = ccWorkbookSheets(boards, rc)
check(`one workbook: an index, then each CC's bank and weights (${sheets.length} sheets), every name short enough for Excel`, sheets.length === 15 && sheets[0].name === 'CC' && sheets[0].rows.length === 7 && sheets[0].rows[0].cells.join() === 'CC1,Twister' && sheets.every((s) => s.name.length <= 31) && sheets[13].name === 'CC7 Small Rewards Bank')
const wb = buildCcWorkbook(boards, rc)
check('the workbook is written with those sheets', wb.worksheets.length === 15 && wb.worksheets[2].name === 'CC1 Small Reward Weights')
const real = [{ ...createBoard('Board 1', { rows: 5, cols: 8 }), dropGroups: groups, dropGroupsConfig: board.dropGroupsConfig, minDropRank: 6 }]
const mainNames = buildWorkbook(real, rc).worksheets.map((w) => w.name)
const allNames = buildAllSegmentsWorkbook([{ name: 'S', boards: real, recompletionBoards: rc }]).worksheets.map((w) => w.name)
const valueNames = buildAllSheetsAsValueRows(real, rc).map((s) => s.title)
const allValueNames = buildAllSegmentsSheetsAsValueRows([{ name: 'S', boards: real, recompletionBoards: rc }]).map((s) => s.title)
const tail = sheets.map((s) => s.name).join()
check(`the main outputs (workbook and Google Sheet, this segment and all segments) end with the 15 CC sheets, after Endless (economist: "Add to main output")`, [mainNames, allNames, valueNames, allValueNames].every((names) => names.slice(-15).join() === tail && names.at(-16) === 'Endless'))

console.log(fails ? `${fails} of ${total} checks FAILED` : `${total}/${total} checks passed`)
process.exit(fails ? 1 : 0)
