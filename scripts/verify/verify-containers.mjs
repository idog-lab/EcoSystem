// Containers (lib/containers.js) and the sheets that export them.
// Run with: npx vite-node scripts/verify/verify-containers.mjs
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { createDropGroup, createDropGroupsConfig } from '../../src/features/merge/lib/rewards/dropGroups.js'
import { RC_MAX_RANK } from '../../src/features/merge/lib/core/ranks.js'
import { TWISTER_TYPE } from '../../src/features/merge/lib/rewards/rewardChain.js'
import { buildAlwaysDropConfiguration, resizeTwisterDrops } from '../../src/features/merge/lib/rewards/rewardTargeting.js'
import { applyTwisterDropRule, readTwisterDropRule } from '../../src/features/merge/lib/rewards/twisterEconomy.js'
import { containerKey, containerSyntax, containerContents, modelContainers, containersOfBoards, groupContainerRows, NO_DROP_ONLY_WEIGHT } from '../../src/features/merge/lib/rewards/containers.js'
import { buildSmallRewardsBankSheet, buildSmallRewardWeightsSheet, buildEndlessBankSheet, buildEndlessWeightsSheet, buildV2EndlessSheet, buildWorkbook, buildAllSegmentsWorkbook, buildAllSheetsAsValueRows, buildAllSegmentsSheetsAsValueRows } from '../../src/features/merge/lib/export/eventSheets.js'
import { endlessOfDesign, averageDrop } from '../../src/features/merge/lib/rewards/endlessMode.js'
import { rewardChainForNextPhase } from '../../src/features/merge/lib/rewards/rewardChain.js'
import { spendGenerator } from '../../src/features/merge/lib/simulation/playSession.js'
import { createPlaySession, mergeItems } from '../../src/features/merge/lib/simulation/playSession.js'

let failures = 0
let count = 0
const check = (name, cond) => {
  count += 1
  if (!cond) failures += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}`)
}

// A list whose drops were made the way a build makes them.
function builtList(minDropRank = 6, dropUnits = { coins: 60, puzzles: 40, energy: 30, charms: 20 }) {
  const mergesByRank = Object.fromEntries(Array.from({ length: RC_MAX_RANK }, (_, i) => [i + 1, i + 1 >= minDropRank ? 10 : 0]))
  const built = buildAlwaysDropConfiguration({ dropUnits, mergesByRank, dropGroups: [], dropGroupsConfig: createDropGroupsConfig(RC_MAX_RANK), minDropRank })
  const board = createBoard('Board 1', { rows: 3, cols: 6 })
  board.tiles = board.tiles.map((row) => row.map(() => 'open'))
  return [Object.assign(board, { semiPlacements: [], blockedQueue: [], dropGroups: built.dropGroups, dropGroupsConfig: built.dropGroupsConfig, minDropRank, targetEv: 1 })]
}

console.log('--- 1. Names and syntax ---')
{
  check('keys run ContA, ContB ... ContZ, ContAA', containerKey(0) === 'ContA' && containerKey(1) === 'ContB' && containerKey(25) === 'ContZ' && containerKey(26) === 'ContAA' && containerKey(27) === 'ContAB')
  const group = createDropGroup({ id: 'g', items: { charms: 1, puzzles: 2, energy: 3, coins: 1 } })
  check(`a container is written in the reference's own order: coin, dr, puzzle, charm (${containerSyntax(group)})`, containerSyntax(group) === 'coin-r1+dr-r3+puzzle-r2+charm-r1')
  check(`...and described in words (${containerContents(group)})`, containerContents(group) === 'Coins R1 + Merge Energy R3 + Puzzles R2 + Charms R1')
  check('a single-item container is just its key', containerSyntax(createDropGroup({ id: 'x', items: { energy: 2 } })) === 'dr-r2')
  check('a Twister item uses the (unverified) dr-twister key', containerSyntax(createDropGroup({ id: 't', items: { [TWISTER_TYPE]: 1, coins: 2 } })) === 'coin-r2+dr-twister-r1')
}

console.log('--- 2. The containers are the model\'s drops, with their weights ---')
{
  const boards = builtList(6)
  const { containers, rows, startRank } = containersOfBoards(boards, 'main')
  const board = boards[0]
  check(`the build's drops become containers (${containers.map((c) => `${c.key}=${c.syntax}`).join(', ')})`, containers.length >= 2 && containers.length === board.dropGroups.length && startRank === 6)
  check('every container is a different drop', new Set(containers.map((c) => c.syntax)).size === containers.length)
  check('merge tiers run 2 to 12 for the normal list', rows[0].tier === 2 && rows[rows.length - 1].tier === 12 && rows.length === 11)
  check('a tier below the drop start rank is NoDrop only', rows.filter((r) => r.tier < 6).every((r) => !r.eligible && r.noDrop === NO_DROP_ONLY_WEIGHT && Object.keys(r.weights).length === 0))
  const table = (tier) => board.dropGroupsConfig[tier - 1]
  check('from the start rank, each container carries exactly its weight in that rank\'s drop table', rows.filter((r) => r.tier >= 6).every((r) => r.eligible && r.noDrop === table(r.tier).noDropWeight && table(r.tier).entries.every((e) => r.weights[e.groupId] === e.weight)))
  check('...and those weights add up to the whole table (1000): every merge drops', rows.filter((r) => r.tier >= 6).every((r) => r.total === 1000 && r.noDrop === 0))
  check('Recompletion runs to tier 14', containersOfBoards(boards, 'rc').rows.length === 13 && containersOfBoards(boards, 'rc').rows.at(-1).tier === 14)
  const runs = groupContainerRows(rows)
  check(`neighbouring tiers with the same weights are shown as one stretch (${runs.map((r) => `${r.from}-${r.to}`).join(', ')})`, runs.length === 2 && runs[0].from === 2 && runs[0].to === 5 && runs[1].from === 6 && runs[1].to === 12)

  // A group nothing points at, and an entry pointing at nothing, never drop.
  const odd = modelContainers({
    dropGroups: [...board.dropGroups, createDropGroup({ id: 'unused', items: { charms: 3 } })],
    dropGroupsConfig: board.dropGroupsConfig.map((t) => (t.rank === 7 ? { ...t, entries: [...t.entries, { groupId: 'ghost', weight: 50 }] } : t)),
    minDropRank: 6,
  })
  check('a group with no weight anywhere is not a container', !odd.containers.some((c) => c.id === 'unused') && odd.containers.length === containers.length)
  check('an entry pointing at a missing group is counted as NoDrop, not lost', odd.rows.find((r) => r.tier === 7).noDrop === 50 && odd.rows.find((r) => r.tier === 7).total === 1050)
}

console.log('--- 3. What is played is a container ---')
{
  const boards = builtList(2)
  const { containers } = containersOfBoards(boards, 'main')
  const session = createPlaySession(boards, 0)
  const state = session.state
  const seen = new Set()
  for (let i = 0; i < 60; i++) {
    for (let r = 0; r < state.rows; r++) for (let c = 0; c < state.cols; c++) state.itemAt[r][c] = null
    session.inventory.length = 0
    state.itemAt[0][0] = 1
    state.itemAt[0][1] = 1
    const before = session.events.length
    mergeItems(session, [0, 0], [0, 1])
    const dropped = session.events.slice(before).filter((e) => e.type === 'merge-drop')
    const syntax = containerSyntax({ items: Object.fromEntries(dropped.map((e) => [e.rewardType, e.rank])) })
    seen.add(syntax)
  }
  const known = new Set(containers.map((c) => c.syntax))
  check(`every drop in play was exactly one of the containers (${[...seen].join(' | ')})`, [...seen].every((s) => known.has(s)) && seen.size >= 2)
}

console.log('--- 4. The sheets ---')
{
  const boards = builtList(6)
  const { containers } = containersOfBoards(boards, 'main')
  const bank = buildSmallRewardsBankSheet(boards)
  const weights = buildSmallRewardWeightsSheet(boards)
  check('Small Rewards Bank: Key + Syntax, one row per container, from the model', bank.source === 'model' && bank.columns.join(',') === 'Key,Syntax' && bank.rows.length === containers.length && bank.rows.every((r, i) => r.cells[0] === containers[i].key && r.cells[1] === containers[i].syntax))
  check(`Small Reward Weights: Merge Tier, one column per container, NoDrop (${weights.columns.join(' | ')})`, weights.source === 'model' && weights.columns[0] === 'Merge Tier' && weights.columns.at(-1) === 'NoDrop' && weights.columns.length === containers.length + 2)
  check('...rows for merge tiers 2 to 12, in order', weights.rows.map((r) => r.cells[0]).join(',') === '2,3,4,5,6,7,8,9,10,11,12')
  check('...a tier that cannot drop is all zeros and NoDrop', weights.rows[0].cells.slice(1, -1).every((v) => v === 0) && weights.rows[0].cells.at(-1) === NO_DROP_ONLY_WEIGHT)
  check('...a tier that drops carries the table weights, whole numbers', weights.rows[4].cells.slice(1).reduce((s, v) => s + v, 0) === 1000 && weights.rows.every((r) => r.cells.every((v) => Number.isInteger(v))))
  check('the Recompletion sheets run to tier 14', buildSmallRewardWeightsSheet(boards, { phase: 'rc' }).rows.length === 13)

  // A list with no drops has no containers - it does not show an older hand-typed table as if the model had made it.
  const plain = [createBoard('Board 1')]
  const emptyBank = buildSmallRewardsBankSheet(plain)
  const emptyWeights = buildSmallRewardWeightsSheet(plain)
  check('a list with no merge drops has no containers: an empty bank, and every tier NoDrop only', emptyBank.source === 'none' && emptyBank.rows.length === 0 && emptyWeights.source === 'none' && emptyWeights.columns.join(',') === 'Merge Tier,NoDrop' && emptyWeights.rows.length === 11 && emptyWeights.rows.every((r) => r.cells[1] === NO_DROP_ONLY_WEIGHT))

  const rc = builtList(4, { coins: 30, energy: 30 })
  const sheetNames = (wb) => wb.worksheets.map((w) => w.name)
  const wb = buildWorkbook(boards, rc)
  const names = sheetNames(wb)
  check('the workbook keeps the reference tabs in order, then adds the two Recompletion tabs', names.indexOf('Small Rewards') < names.indexOf('Small Rewards Bank') && names.indexOf('Small Reward Weights') + 1 === names.indexOf('RC Small Rewards Bank') && names.indexOf('RC Small Rewards Bank') + 1 === names.indexOf('RC Small Reward Weights'))
  check('...then the two endless tabs, and the endless rules at the very end', names.indexOf('RC Small Reward Weights') + 1 === names.indexOf('Endless Small Rewards Bank') && names.indexOf('Endless Small Rewards Bank') + 1 === names.indexOf('Endless Small Reward Weights') && names.at(-1) === 'V2 Endless')
  check('no tab name is over Excel\'s 31 characters', names.every((n) => n.length <= 31))
  const read = (name) => {
    const ws = wb.getWorksheet(name)
    const out = []
    ws.eachRow((row) => out.push(row.values.slice(1)))
    return out
  }
  check('the workbook\'s Small Rewards Bank holds the model\'s containers', read('Small Rewards Bank').slice(1).every((r, i) => r[0] === containers[i].key && r[1] === containers[i].syntax))
  const rcBank = read('RC Small Rewards Bank')
  check(`Recompletion has its own containers (${rcBank.slice(1).map((r) => r.join('=')).join(', ')})`, rcBank.length >= 2 && rcBank.slice(1).every((r) => !/puzzle|charm/.test(r[1])))
  check('...and its weights start at its own drop rank (tier 4) and run to 14', read('RC Small Reward Weights').length === 14 && read('RC Small Reward Weights')[2].at(-1) === NO_DROP_ONLY_WEIGHT && read('RC Small Reward Weights')[3].at(-1) === 0)

  const values = buildAllSheetsAsValueRows(boards, rc)
  check('the Google Sheets export carries the same container sheets, endless included', ['Small Rewards Bank', 'Small Reward Weights', 'RC Small Rewards Bank', 'RC Small Reward Weights', 'Endless Small Rewards Bank', 'Endless Small Reward Weights', 'V2 Endless'].every((t) => values.some((v) => v.title === t)) && values.find((v) => v.title === 'Small Rewards Bank').rows[1][0] === 'ContA')
  const segments = [{ name: 'Segment 1', boards, recompletionBoards: rc }, { name: 'Segment 2', boards, recompletionBoards: rc }]
  const combined = sheetNames(buildAllSegmentsWorkbook(segments))
  check('the combined workbook has them once (containers are shared by every segment)', ['Small Rewards Bank', 'Small Reward Weights', 'RC Small Rewards Bank', 'RC Small Reward Weights', 'Endless Small Rewards Bank', 'Endless Small Reward Weights', 'V2 Endless'].every((t) => combined.filter((n) => n === t).length === 1) && combined.every((n) => n.length <= 31))
  check('...and so does the combined Google Sheets export', buildAllSegmentsSheetsAsValueRows(segments).filter((v) => /Small Reward/.test(v.title)).length === 7)
}

console.log('--- 4b. From a chosen rank, every drop holds two or more items ---')
{
  const mergesByRank = Object.fromEntries(Array.from({ length: RC_MAX_RANK }, (_, i) => [i + 1, i + 1 >= 6 ? 10 : 0]))
  const make = (dropUnits, multiDropRank) => buildAlwaysDropConfiguration({ dropUnits, mergesByRank, dropGroups: [], dropGroupsConfig: createDropGroupsConfig(RC_MAX_RANK), minDropRank: 6, multiDropRank })
  // Small drops: on their own most containers hold one item.
  const units = { coins: 20, puzzles: 15, energy: 12, charms: 8 }
  const plain = make(units, null)
  const multi = make(units, 9)
  const sizesAt = (built, rank) => built.dropGroupsConfig[rank - 1].entries.filter((e) => e.weight > 0).map((e) => Object.keys(new Map(built.dropGroups.map((g) => [g.id, g])).get(e.groupId).items).length)
  // The share of drops (out of 1000) that hold two or more items, at a merge rank.
  const multiShare = (built, rank) => {
    const groups = new Map(built.dropGroups.map((g) => [g.id, g]))
    return built.dropGroupsConfig[rank - 1].entries.reduce((sum, e) => sum + (Object.keys(groups.get(e.groupId).items).length >= 2 ? e.weight : 0), 0) / 10
  }
  const shares = [6, 7, 8, 9, 10, 12, 14].map((r) => multiShare(multi, r))
  check(`without a rank, these small drops are all single items (${multiShare(plain, 6)}% multi at rank 6, ${multiShare(plain, 12)}% at rank 12)`, multiShare(plain, 6) === 0 && multiShare(plain, 12) === 0)
  check(`with 100% from rank 9, containers with several items appear from the first dropping rank and get more likely each rank (${shares.slice(0, 4).join('%, ')}%)`, Math.abs(shares[0] - 25) <= 1 && Math.abs(shares[1] - 50) <= 1 && Math.abs(shares[2] - 75) <= 1 && shares[0] < shares[1] && shares[1] < shares[2] && shares[2] < shares[3])
  check(`...and from rank 9 every drop holds two or more (${shares.slice(3).join('%, ')}%)`, shares.slice(3).every((v) => v === 100) && [9, 10, 11, 12, 13, 14].every((r) => sizesAt(multi, r).length > 0 && sizesAt(multi, r).every((n) => n >= 2)) && multi.multiDropShort === false && multi.multiDropRank === 9)
  check('...with single-item containers still there below it (it is a chance, not a switch)', [6, 7, 8].every((r) => sizesAt(multi, r).some((n) => n === 1) && sizesAt(multi, r).some((n) => n >= 2)))
  check('every rank still drops 100% of the time: no "nothing", weights add up to 1000', [6, 7, 9, 12, 14].every((r) => multi.dropGroupsConfig[r - 1].noDropWeight === 0 && multi.dropGroupsConfig[r - 1].entries.reduce((sum, e) => sum + e.weight, 0) === 1000))
  check('every container is a different drop, of at most four items', new Set(multi.dropGroups.map((g) => containerSyntax(g))).size === multi.dropGroups.length && multi.dropGroups.every((g) => Object.keys(g.items).length <= 4))
  const perMerge = (built, rank) => built.dropGroupsConfig[rank - 1].entries.reduce((sum, e) => sum + (e.weight / 1000) * Object.values(new Map(built.dropGroups.map((g) => [g.id, g])).get(e.groupId).items).reduce((x, r) => x + 2 ** (r - 1), 0), 0)
  check(`a drop carries more as the rank rises, and the build is told (${[6, 8, 10].map((r) => perMerge(multi, r).toFixed(2)).join(' -> ')} units per merge)`, perMerge(multi, 6) < perMerge(multi, 8) && perMerge(multi, 8) < perMerge(multi, 10) && perMerge(multi, 10) >= 2 - 1e-9 && multi.deliverableUnits.coins + multi.deliverableUnits.energy > plain.deliverableUnits.coins + plain.deliverableUnits.energy)
  // Rich drops: the rewards go into fewer drops as bigger items, so single-item containers stay as common as the rise says.
  const rich = make({ coins: 80, puzzles: 70, energy: 60, charms: 50 }, 12)
  const richPlain = make({ coins: 80, puzzles: 70, energy: 60, charms: 50 }, null)
  const richRanks = (rank) => rich.dropGroupsConfig[rank - 1].entries.filter((e) => e.weight > 0).flatMap((e) => Object.values(new Map(rich.dropGroups.map((g) => [g.id, g])).get(e.groupId).items))
  check(`rich drops do not make every drop a multi-item one: ${multiShare(richPlain, 6)}% at rank 6 without the rise, ${multiShare(rich, 6)}% with it (rising to ${multiShare(rich, 9)}% and ${multiShare(rich, 12)}%)`, multiShare(richPlain, 6) > 90 && Math.abs(multiShare(rich, 6) - 100 / 7) <= 1 && multiShare(rich, 6) < multiShare(rich, 9) && multiShare(rich, 12) === 100)
  check('...the same rewards, as fewer and bigger items (rank 3 at most), with rank-1 items still dropping', ['coins', 'puzzles', 'energy', 'charms'].every((t) => Math.abs(rich.deliverableUnits[t] - richPlain.deliverableUnits[t]) <= 0.5) && richRanks(6).includes(1) && richRanks(6).includes(3) && Math.max(...richRanks(6)) === 3 && sizesAt(rich, 6).some((n) => n === 1))
  // With room in the drops, the rise costs nothing: lower ranks carry a little less, the total is the same.
  const roomy = { coins: 54, puzzles: 45, energy: 36, charms: 27 }
  const even = make(roomy, null)
  const risen = make(roomy, 14)
  const totalOf = (built) => Object.values(built.deliverableUnits).reduce((sum, v) => sum + v, 0)
  const risenShares = [6, 8, 10, 12, 14].map((r) => multiShare(risen, r))
  check(`with room in the drops the rise is paid for by the lower ranks: same total (${totalOf(even).toFixed(1)} -> ${totalOf(risen).toFixed(1)} units), the share still rising to 100% (${risenShares.join('%, ')}%)`, Math.abs(totalOf(risen) - totalOf(even)) <= totalOf(even) * 0.01 && risenShares.every((v, i) => i === 0 || v >= risenShares[i - 1]) && risenShares[0] < multiShare(even, 6) && risenShares.at(-1) === 100 && ['coins', 'puzzles', 'energy', 'charms'].every((t) => Math.abs(risen.deliverableUnits[t] - even.deliverableUnits[t]) <= even.deliverableUnits[t] * 0.03))
  // The sheets show one column of weights per rank of the rise, then the 100% stretch.
  const board = createBoard('Board 1')
  Object.assign(board, { dropGroups: multi.dropGroups, dropGroupsConfig: multi.dropGroupsConfig, minDropRank: 6 })
  const runs = groupContainerRows(containersOfBoards([board], 'main').rows)
  check(`the weights show the rise rank by rank, then one stretch at 100% (${runs.map((r) => `${r.from}-${r.to}`).join(', ')})`, runs.map((r) => `${r.from}-${r.to}`).join(',') === '2-5,6-6,7-7,8-8,9-12')
  // A rule set below the drop start rank starts where the drops start.
  check('a rule set below the drop start rank applies from the first drop', make(units, 3).multiDropRank === 6 && sizesAt(make(units, 3), 6).every((n) => n >= 2))
  // A Twister rule on top: from the same rank its item is bundled with a reward item, at the same odds.
  const rule = applyTwisterDropRule({ dropGroups: [], dropGroupsConfig: createDropGroupsConfig(RC_MAX_RANK), minDropRank: 6, itemRank: 1, perMille: 200, bundleFromRank: 9, bundleWith: { type: 'coins', rank: 1 } })
  const withTwister = buildAlwaysDropConfiguration({ dropUnits: units, mergesByRank, dropGroups: rule.dropGroups, dropGroupsConfig: rule.dropGroupsConfig, minDropRank: 6, multiDropRank: 9 })
  const groupOf = new Map(withTwister.dropGroups.map((g) => [g.id, g]))
  const entriesAt = (rank) => withTwister.dropGroupsConfig[rank - 1].entries.filter((e) => e.weight > 0).map((e) => ({ weight: e.weight, items: groupOf.get(e.groupId).items }))
  const twisterWeightAt = (rank) => entriesAt(rank).filter((e) => e.items[TWISTER_TYPE] != null).reduce((s, e) => s + e.weight, 0)
  check('with a Twister rule: below the rank its item drops alone, from it bundled with a coin item', entriesAt(7).some((e) => e.items[TWISTER_TYPE] != null && Object.keys(e.items).length === 1) && entriesAt(10).filter((e) => e.items[TWISTER_TYPE] != null).every((e) => Object.keys(e.items).length === 2 && e.items.coins === 1))
  check(`...at the same odds everywhere (${twisterWeightAt(7)} and ${twisterWeightAt(10)} of 1000), read back as one rule`, twisterWeightAt(7) === 200 && twisterWeightAt(10) === 200 && readTwisterDropRule(withTwister.dropGroups, withTwister.dropGroupsConfig, 6).perMille === 200 && readTwisterDropRule(withTwister.dropGroups, withTwister.dropGroupsConfig, 6).mixed === false)
  check('...so from that rank EVERY container holds two or more items, the Twister one included', [9, 10, 12, 14].every((r) => entriesAt(r).every((e) => Object.keys(e.items).length >= 2) && entriesAt(r).reduce((s, e) => s + e.weight, 0) === 1000))
  const withShares = [6, 7, 8, 9].map((r) => multiShare(withTwister, r))
  check(`...and below it the lone Twister item does not hold the rise back: the other containers make up for it (${withShares.join('%, ')}%)`, Math.abs(withShares[0] - 25) <= 1 && Math.abs(withShares[1] - 50) <= 1 && Math.abs(withShares[2] - 75) <= 1 && withShares[3] === 100)
  const rebuilt = buildAlwaysDropConfiguration({ dropUnits: units, mergesByRank, dropGroups: withTwister.dropGroups, dropGroupsConfig: withTwister.dropGroupsConfig, minDropRank: 6, multiDropRank: 9 })
  check('building again leaves the Twister rule exactly as it was', JSON.stringify(rebuilt.dropGroupsConfig) === JSON.stringify(withTwister.dropGroupsConfig) && JSON.stringify(rebuilt.dropGroups) === JSON.stringify(withTwister.dropGroups))
  const unbundled = applyTwisterDropRule({ dropGroups: withTwister.dropGroups, dropGroupsConfig: withTwister.dropGroupsConfig, minDropRank: 6, itemRank: 1, perMille: 200, fromAuto: true })
  check('taking the rank away puts the Twister item back on its own', unbundled.dropGroups.filter((g) => g.twisterRule).every((g) => Object.keys(g.items).length === 1) && readTwisterDropRule(unbundled.dropGroups, unbundled.dropGroupsConfig, 6).perMille === 200)

  // Only one resource dropping: a container cannot hold two different items, and that is said.
  const one = make({ coins: 30 }, 9)
  check('with only one resource dropping the rule cannot be met, and that is reported', one.multiDropShort === true && sizesAt(one, 10).every((n) => n === 1))
}

console.log('--- 4c. The Twister item, put into the containers by the build ---')
{
  const mergesByRank = Object.fromEntries(Array.from({ length: RC_MAX_RANK }, (_, i) => [i + 1, i + 1 >= 6 ? 10 : 0]))
  const tables = () => createDropGroupsConfig(RC_MAX_RANK)
  const make = (dropUnits, opts = {}) => buildAlwaysDropConfiguration({ dropUnits, mergesByRank, dropGroups: [], dropGroupsConfig: tables(), minDropRank: 6, multiDropRank: 9, ...opts })
  const fill = { minShare: 0.2, itemUnits: 1 }
  // 55 units asked of 90 drops: without a Twister the rewards are stretched over every drop.
  const units = { coins: 20, puzzles: 15, energy: 12, charms: 8 }
  const REWARDS = ['coins', 'puzzles', 'energy', 'charms']
  const total = (built) => REWARDS.reduce((sum, t) => sum + built.deliverableUnits[t], 0)
  const without = make(units)
  const withT = make(units, { twister: fill })
  const groupsOf = (built) => new Map(built.dropGroups.map((g) => [g.id, g]))
  const entries = (built, rank) => built.dropGroupsConfig[rank - 1].entries.filter((e) => e.weight > 0).map((e) => ({ weight: e.weight, items: groupsOf(built).get(e.groupId).items }))
  const share = (built, rank, test) => entries(built, rank).filter((e) => test(e.items)).reduce((s, e) => s + e.weight, 0) / 10
  const multi = (built, rank) => share(built, rank, (items) => Object.keys(items).length >= 2)
  const tw = (built, rank) => share(built, rank, (items) => items[TWISTER_TYPE] != null)
  // Reward units one merge drops, at a rank. Asked: 55 units over 90 drops = 0.61.
  const rewardUnitsAt = (built, rank) => entries(built, rank).reduce((s, e) => s + (e.weight / 1000) * REWARDS.reduce((x, t) => x + (e.items[t] != null ? 2 ** (e.items[t] - 1) : 0), 0), 0)
  check(`without a Twister a merge has to drop a reward item (${rewardUnitsAt(without, 6).toFixed(2)} units at rank 6, 0.61 asked); with it the rewards drop what was asked (${rewardUnitsAt(withT, 6).toFixed(2)}, ${rewardUnitsAt(withT, 7).toFixed(2)})`, rewardUnitsAt(without, 6) >= 1.2 && [6, 7].every((r) => Math.abs(rewardUnitsAt(withT, r) - 55 / 90) <= 0.01) && withT.floorExceedsWanted === false)
  check(`...a reward item is only needed in as many drops as must hold two items: 75% at rank 8, every drop from rank 9 (${rewardUnitsAt(withT, 8).toFixed(2)}, ${rewardUnitsAt(withT, 9).toFixed(2)}) - still far less than without (${total(withT).toFixed(0)} against ${total(without).toFixed(0)} units in all)`, Math.abs(rewardUnitsAt(withT, 8) - 0.75) <= 0.01 && Math.abs(rewardUnitsAt(withT, 9) - 1) <= 0.01 && total(withT) < total(without) * 0.6)
  check('every merge still drops a container: no "nothing", weights add up to 1000', [6, 8, 10, 14].every((r) => withT.dropGroupsConfig[r - 1].noDropWeight === 0 && entries(withT, r).reduce((s, e) => s + e.weight, 0) === 1000))
  check(`the Twister item fills the drops the rewards leave empty, and is the second item of the multi-item ones (in ${[6, 7, 8, 9].map((r) => tw(withT, r)).join('%, ')}% of drops)`, [6, 7, 8, 9, 12].every((r) => tw(withT, r) >= 20) && tw(withT, 6) < tw(withT, 9))
  check(`containers with several items still rise with the rank to 100% (${[6, 7, 8, 9, 12].map((r) => multi(withT, r)).join('%, ')}%)`, Math.abs(multi(withT, 6) - 25) <= 1 && Math.abs(multi(withT, 7) - 50) <= 1 && Math.abs(multi(withT, 8) - 75) <= 1 && multi(withT, 9) === 100 && multi(withT, 12) === 100 && withT.multiDropShort === false)
  // One reward only: the Twister item is what makes a container hold two.
  const one = make({ coins: 30 }, { twister: fill })
  check('with one reward dropping, the Twister item makes the second item: 100% two or more from the rank', one.multiDropShort === false && multi(one, 10) === 100 && multi(one, 6) < 100)
  // No reward at all from drops: the merges drop the Twister item alone.
  const none = make({}, { twister: fill })
  check('with no reward from merge drops, every merge drops a Twister item', none.startRank === 6 && [6, 10].every((r) => tw(none, r) === 100 && none.dropGroupsConfig[r - 1].noDropWeight === 0))
  // Four rewards in every drop: a container holds four items at most.
  const rich = make({ coins: 200, puzzles: 190, energy: 180, charms: 170 }, { twister: fill })
  check('a container never holds more than four items (the Twister item gives way)', rich.dropGroups.every((g) => Object.keys(g.items).length <= 4))
  // A rule written by hand is replaced; another hand-made Twister group is kept.
  const rule = applyTwisterDropRule({ dropGroups: [{ id: 'mine', name: 'Mine', items: { coins: 2, [TWISTER_TYPE]: 2 } }], dropGroupsConfig: tables().map((t) => (t.rank >= 6 ? { ...t, entries: [{ groupId: 'mine', weight: 50 }], noDropWeight: 950 } : t)), minDropRank: 6, itemRank: 1, perMille: 200 })
  const replaced = buildAlwaysDropConfiguration({ dropUnits: units, mergesByRank, dropGroups: rule.dropGroups, dropGroupsConfig: rule.dropGroupsConfig, minDropRank: 6, multiDropRank: 9, twister: fill })
  check('a fixed-chance Twister rule is replaced by the build; a Twister group made by hand keeps its odds', !replaced.dropGroups.some((g) => g.twisterRule) && replaced.dropGroupsConfig[5].entries.find((e) => e.groupId === 'mine')?.weight === 50 && replaced.dropGroupsConfig[5].entries.reduce((s, e) => s + e.weight, 0) === 1000)

  // Resizing: more Twister, nothing else changed.
  const rewardsPart = (built, rank) => {
    const out = {}
    for (const e of entries(built, rank)) {
      const { [TWISTER_TYPE]: _t, ...rest } = e.items
      const key = JSON.stringify(Object.entries(rest).sort())
      out[key] = (out[key] ?? 0) + e.weight
    }
    return JSON.stringify(Object.entries(out).sort())
  }
  const bigger = resizeTwisterDrops(withT, { itemUnits: 3, minShare: 0.2 })
  const ranksAt = (built, rank) => [...new Set(entries(built, rank).filter((e) => e.items[TWISTER_TYPE] != null).map((e) => e.items[TWISTER_TYPE]))].sort()
  const avgUnits = (built, rank) => entries(built, rank).filter((e) => e.items[TWISTER_TYPE] != null).reduce((s, e) => s + e.weight * 2 ** (e.items[TWISTER_TYPE] - 1), 0) / (tw(built, rank) * 10)
  check(`a bigger Twister item: ranks ${ranksAt(bigger, 9).join(' and ')}, ${avgUnits(bigger, 9).toFixed(2)} units on average (3 asked), in the same drops`, JSON.stringify(ranksAt(bigger, 9)) === '[2,3]' && Math.abs(avgUnits(bigger, 9) - 3) <= 0.05 && [6, 9, 12].every((r) => tw(bigger, r) === tw(withT, r)))
  check('...and no reward, no weight and no rank of a reward item changes', [6, 7, 9, 12, 14].every((r) => rewardsPart(bigger, r) === rewardsPart(withT, r)) && [6, 9].every((r) => bigger.dropGroupsConfig[r - 1].entries.reduce((s, e) => s + e.weight, 0) === 1000))
  const more = resizeTwisterDrops(withT, { itemUnits: 1, minShare: 0.95 })
  check(`a Twister item in more of the drops (95% asked: ${[6, 7, 9].map((r) => tw(more, r)).join('%, ')}%, from ${[6, 7, 9].map((r) => tw(withT, r)).join('%, ')}%), rewards untouched`, [6, 7].every((r) => Math.abs(tw(more, r) - 95) <= 0.2 && tw(withT, r) < 95) && tw(more, 9) === 100 && [6, 7, 9, 12].every((r) => rewardsPart(more, r) === rewardsPart(withT, r)))
  const all = resizeTwisterDrops(withT, { itemUnits: 8, minShare: 1 })
  check('up to a rank-4 Twister item in every drop', [6, 9, 14].every((r) => tw(all, r) === 100 && JSON.stringify(ranksAt(all, r)) === '[4]') && [6, 9].every((r) => rewardsPart(all, r) === rewardsPart(withT, r)))
  const same = resizeTwisterDrops(withT, { itemUnits: 1, minShare: 0.2 })
  const written = (built, rank) => built.dropGroupsConfig[rank - 1].entries.filter((e) => e.weight > 0).map((e) => `${containerSyntax(groupsOf(built).get(e.groupId))}:${e.weight}`).sort().join(' ')
  check('asking for what is already there changes nothing', [6, 7, 9, 12].every((r) => written(same, r) === written(withT, r)))
  check(`the Twister item is on its own in some containers and with different rewards in others (rank 6: ${written(withT, 6)})`, entries(withT, 6).some((e) => Object.keys(e.items).length === 1 && e.items[TWISTER_TYPE] != null) && new Set([6, 7, 8].flatMap((r) => entries(withT, r).filter((e) => e.items[TWISTER_TYPE] != null && Object.keys(e.items).length === 2).map((e) => Object.keys(e.items).find((k) => k !== TWISTER_TYPE)))).size >= 3)
  const kept = resizeTwisterDrops(replaced, { itemUnits: 4, minShare: 1 })
  check('a hand-made group is never resized', kept.dropGroups.find((g) => g.id === 'mine')?.items[TWISTER_TYPE] === 2 && kept.dropGroupsConfig[5].entries.find((e) => e.groupId === 'mine')?.weight === 50)
  // Written the way Ops reads it.
  check(`the containers are written with the Twister item's own key (${[...new Set(bigger.dropGroups.filter((g) => g.items[TWISTER_TYPE] != null).map((g) => containerSyntax(g)))].slice(0, 3).join(' | ')})`, bigger.dropGroups.filter((g) => g.items[TWISTER_TYPE] != null).every((g) => /dr-twister-r[23]/.test(containerSyntax(g))))
}

console.log('--- 4d. Containers with three or more items at the high ranks ---')
{
  const mergesByRank = Object.fromEntries(Array.from({ length: RC_MAX_RANK }, (_, i) => [i + 1, i + 1 >= 6 ? 10 : 0]))
  const make = (dropUnits, opts = {}) => buildAlwaysDropConfiguration({ dropUnits, mergesByRank, dropGroups: [], dropGroupsConfig: createDropGroupsConfig(RC_MAX_RANK), minDropRank: 6, multiDropRank: 8, tripleDropRank: 10, ...opts })
  const share = (built, rank, atLeast) => {
    const groups = new Map(built.dropGroups.map((g) => [g.id, g]))
    return built.dropGroupsConfig[rank - 1].entries.reduce((s, e) => s + (Object.keys(groups.get(e.groupId).items).length >= atLeast ? e.weight : 0), 0) / 10
  }
  const units = { coins: 20, puzzles: 15, energy: 12, charms: 8 }
  const four = make(units)
  check(`two or more: ${[6, 7, 8].map((r) => share(four, r, 2)).join('%, ')}% at ranks 6-8, every drop from rank 8`, Math.abs(share(four, 6, 2) - 33.3) <= 1 && Math.abs(share(four, 7, 2) - 66.7) <= 1 && [8, 9, 10, 12].every((r) => share(four, r, 2) === 100))
  check(`three or more: none below rank 10 (rank 9: ${share(four, 9, 3)}%), every drop at ranks 10 and 11 and above (${[10, 11, 14].map((r) => share(four, r, 3)).join('%, ')}%)`, [6, 7, 8, 9].every((r) => share(four, r, 3) === 0) && [10, 11, 12, 14].every((r) => share(four, r, 3) === 100) && four.tripleDropShort === false && four.tripleDropRank === 10 && four.multiDropRank === 8)
  check('no container holds more than four items, and every merge still drops', four.dropGroups.every((g) => Object.keys(g.items).length <= 4) && [6, 9, 10, 14].every((r) => four.dropGroupsConfig[r - 1].noDropWeight === 0 && four.dropGroupsConfig[r - 1].entries.reduce((s, e) => s + e.weight, 0) === 1000))
  const withTwister = make({ coins: 20, puzzles: 15 }, { twister: { minShare: 0.4, itemUnits: 1 } })
  check('two rewards and the Twister item make three: not short', withTwister.tripleDropShort === false && share(withTwister, 10, 3) === 100 && share(withTwister, 6, 3) === 0)
  const two = make({ coins: 20, puzzles: 15 })
  check('with only two rewards dropping, three items cannot be met, and that is reported', two.tripleDropShort === true && share(two, 10, 3) === 0 && share(two, 10, 2) === 100)
  const late = make(units, { multiDropRank: 12 })
  check('the two-item rank is always before the three-item rank (12 asked, 9 used)', late.multiDropRank === 9 && share(late, 9, 2) === 100 && share(late, 10, 3) === 100)
  const off = make(units, { tripleDropRank: null, multiDropRank: 9 })
  check('without a three-item rank nothing changes', off.tripleDropRank === null && [9, 12].every((r) => share(off, r, 2) === 100) && share(off, 12, 3) === 0)
}

console.log('--- 4e. One item per merge, and the first dropping rank feeds the reward under the tiles ---')
{
  // 20 merges make a rank 6, 10 a rank 7, 5 a rank 8, 3 a rank 9, 2 a rank 10.
  const mergesByRank = { 6: 20, 7: 10, 8: 5, 9: 3, 10: 2 }
  const slots = 40
  const make = (dropUnits, opts = {}) => buildAlwaysDropConfiguration({ dropUnits, mergesByRank, dropGroups: [], dropGroupsConfig: createDropGroupsConfig(RC_MAX_RANK), minDropRank: 6, multiDropRank: 8, tripleDropRank: 10, maxItems: 1, ...opts })
  const groupsOf = (built) => new Map(built.dropGroups.map((g) => [g.id, g]))
  const shareOf = (built, rank, type, itemRank = null) => {
    const groups = groupsOf(built)
    return built.dropGroupsConfig[rank - 1].entries.reduce((sum, e) => sum + (groups.get(e.groupId).items[type] != null && (itemRank == null || groups.get(e.groupId).items[type] === itemRank) ? e.weight : 0), 0) / 10
  }
  const fullTables = (built) => [6, 7, 8, 9, 10].every((r) => built.dropGroupsConfig[r - 1].noDropWeight === 0 && built.dropGroupsConfig[r - 1].entries.reduce((sum, e) => sum + e.weight, 0) === 1000)
  const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol

  // Coins whose values the build sets fill the drops: 60% of the first rank, and whatever the others leave.
  const coins = make({ coins: 0, puzzles: 6, energy: 4, charms: 0 }, { focus: { type: 'coins', share: 0.6, elastic: true } })
  check('every container holds exactly one item, and every merge from rank 6 still drops', coins.dropGroups.every((g) => Object.keys(g.items).length === 1) && fullTables(coins) && coins.maxItems === 1 && coins.multiDropRank === null && coins.tripleDropRank === null)
  check(`the reward under the tiles takes the first dropping rank: ${shareOf(coins, 6, 'coins', 1)}% of rank-6 drops are a rank-1 coin item (60% asked, plus what the others leave)`, shareOf(coins, 6, 'coins', 1) >= 60 && coins.focus.type === 'coins' && coins.focus.rank === 6 && coins.focus.elastic === true)
  check('the other rewards drop as rank-1 items while their amounts fit, and are delivered in full', coins.dropGroups.filter((g) => g.items.coins == null).every((g) => Object.values(g.items)[0] === 1) && near(coins.deliverableUnits.puzzles, 6, 0.3) && near(coins.deliverableUnits.energy, 4, 0.3) && coins.shortUnits.puzzles === 0)
  check('with coins filling the empty drops there is no "one item per merge is too much" floor', coins.floorExceedsWanted === false && shareOf(coins, 9, 'coins', 1) > 50)

  // A reward with a typed target only takes what its target allows.
  const energy = make({ coins: 0, puzzles: 10, energy: 6, charms: 0 }, { focus: { type: 'energy', share: 0.6, elastic: false }, twister: { minShare: 0.25, itemUnits: 1 } })
  check(`a reward with a typed amount takes only what that amount allows (6 units over 20 rank-6 merges: ${shareOf(energy, 6, 'energy', 1)}% of them)`, near(shareOf(energy, 6, 'energy', 1), 30) && energy.focus.share < 0.5 && near(energy.deliverableUnits.energy, 6, 0.3))
  check(`the Twister item is a drop of its own, in a quarter of the drops and in what the rewards leave (${shareOf(energy, 6, 'twister')}% at rank 6, ${shareOf(energy, 10, 'twister')}% at rank 10)`, shareOf(energy, 6, 'twister') >= 25 && shareOf(energy, 10, 'twister') >= 25 && energy.floorExceedsWanted === false && fullTables(energy))

  // Amounts that do not fit as rank-1 items get bigger from the top merge rank down, rank 3 at most.
  const big = make({ coins: 0, puzzles: 30, energy: 0, charms: 22 }, { focus: { type: 'coins', share: 0.6, elastic: true } })
  const ranksAt = (built, rank, type) => [1, 2, 3, 4].filter((r) => shareOf(built, rank, type, r) > 0)
  check(`amounts that need more than one unit a drop are bigger items at the higher merge ranks first (puzzle ranks: rank 6 ${ranksAt(big, 6, 'puzzles').join('/')}, rank 7 ${ranksAt(big, 7, 'puzzles').join('/')}, rank 10 ${ranksAt(big, 10, 'puzzles').join('/')})`, Math.max(...ranksAt(big, 10, 'puzzles')) === 3 && Math.max(...ranksAt(big, 6, 'puzzles')) <= Math.max(...ranksAt(big, 7, 'puzzles')) && big.dropGroups.every((g) => Object.values(g.items)[0] <= 3))
  check('...and they are still delivered in full, with the first rank still mostly the reward under the tiles', near(big.deliverableUnits.puzzles, 30, 0.6) && near(big.deliverableUnits.charms, 22, 0.6) && shareOf(big, 6, 'coins', 1) >= 59 && big.shortUnits.puzzles === 0)
  const huge = make({ coins: 0, puzzles: 150, energy: 0, charms: 100 }, { focus: { type: 'coins', share: 0.6, elastic: true } })
  check(`amounts that do not fit even as rank-3 items are reported short (${Math.round(huge.shortUnits.puzzles + huge.shortUnits.charms)} of 250 units), never dropped as a rank 4`, huge.shortUnits.puzzles > 1 && huge.shortUnits.charms > 1 && huge.dropGroups.every((g) => Object.values(g.items)[0] <= 3) && fullTables(huge))
  const lower = buildAlwaysDropConfiguration({ dropUnits: { coins: 0, puzzles: 150, energy: 0, charms: 100 }, mergesByRank: { 4: 80, 5: 40, ...mergesByRank }, dropGroups: [], dropGroupsConfig: createDropGroupsConfig(RC_MAX_RANK), minDropRank: 6, maxItems: 1, focus: { type: 'coins', share: 0.6, elastic: true } })
  check(`...and the start rank from which they would fit is named (rank ${lower.lowerStartRank})`, lower.lowerStartRank === 5 || lower.lowerStartRank === 4)

  // No Twister and no coins to fill: every merge still drops, so the rewards are stretched and that is said.
  const floor = make({ coins: 0, puzzles: 8, energy: 4, charms: 0 }, { focus: { type: 'energy', share: 0.6, elastic: false } })
  check('with nothing to fill the empty drops the rewards are stretched over them, and the floor is reported', floor.floorExceedsWanted === true && fullTables(floor) && floor.deliverableUnits.puzzles + floor.deliverableUnits.energy > slots - 1)

  // Asked for several items again: the containers with several items are back.
  const several = buildAlwaysDropConfiguration({ dropUnits: { coins: 20, puzzles: 15, energy: 12, charms: 8 }, mergesByRank, dropGroups: [], dropGroupsConfig: createDropGroupsConfig(RC_MAX_RANK), minDropRank: 6, multiDropRank: 8, tripleDropRank: 10 })
  check('without the one-item rule the containers with several items are made as before', several.dropGroups.some((g) => Object.keys(g.items).length >= 3) && several.maxItems === null && several.multiDropRank === 8)
}

console.log('--- 4f. Rank 6 drops one item; the ranks above keep their two- and three-item containers ---')
{
  const mergesByRank = { 6: 20, 7: 10, 8: 5, 9: 3, 10: 2 }
  const tables = () => createDropGroupsConfig(RC_MAX_RANK)
  const make = (dropUnits, opts = {}) => buildAlwaysDropConfiguration({ dropUnits, mergesByRank, dropGroups: [], dropGroupsConfig: tables(), minDropRank: 6, multiDropRank: 8, tripleDropRank: 10, soloRank: 6, ...opts })
  const groupsOf = (built) => new Map(built.dropGroups.map((g) => [g.id, g]))
  const entriesAt = (built, rank) => built.dropGroupsConfig[rank - 1].entries.map((e) => ({ items: groupsOf(built).get(e.groupId).items, weight: e.weight }))
  const sizeShare = (built, rank, atLeast) => entriesAt(built, rank).reduce((sum, e) => sum + (Object.keys(e.items).length >= atLeast ? e.weight : 0), 0) / 10
  const typeShare = (built, rank, type, itemRank = null) => entriesAt(built, rank).reduce((sum, e) => sum + (e.items[type] != null && (itemRank == null || e.items[type] === itemRank) ? e.weight : 0), 0) / 10
  const full = (built) => [6, 7, 8, 9, 10].every((r) => built.dropGroupsConfig[r - 1].noDropWeight === 0 && built.dropGroupsConfig[r - 1].entries.reduce((sum, e) => sum + e.weight, 0) === 1000)

  const units = { coins: 12, puzzles: 9, energy: 6, charms: 5 }
  const built = make(units, { focus: { type: 'coins', share: 0.6, elastic: true }, twister: { minShare: 0.8, soloShare: 0.25, itemUnits: 1 } })
  check('at rank 6 every container is a single item, and every merge still drops', entriesAt(built, 6).every((e) => Object.keys(e.items).length === 1) && full(built) && JSON.stringify(built.soloRanks) === '[6,6]' && built.maxItems === null)
  check(`...mostly the reward under the tiles as a rank-1 item (${typeShare(built, 6, 'coins', 1)}% coins, ${typeShare(built, 6, 'twister')}% a Twister item), the other rewards rank 1 too`, typeShare(built, 6, 'coins', 1) >= 60 && Math.abs(typeShare(built, 6, 'twister') - 25) <= 1 && entriesAt(built, 6).every((e) => Object.values(e.items)[0] === 1))
  check(`above it the containers hold several items as set: two or more in ${sizeShare(built, 7, 2)}% of rank-7 drops, in every drop from rank 8 (${[8, 9, 10].map((r) => sizeShare(built, r, 2)).join('%, ')}%)`, sizeShare(built, 7, 2) >= 60 && [8, 9, 10, 12].every((r) => sizeShare(built, r, 2) === 100) && built.multiDropRank === 8)
  check(`...and three or more in every drop from rank 10 (${[9, 10, 12].map((r) => sizeShare(built, r, 3)).join('%, ')}%)`, [10, 11, 12, 14].every((r) => sizeShare(built, r, 3) === 100) && sizeShare(built, 6, 3) === 0 && built.tripleDropRank === 10 && built.tripleDropShort === false)
  check(`what rank 6 does not carry is carried by the ranks above: puzzles ${built.deliverableUnits.puzzles.toFixed(1)} of 9 asked, energy ${built.deliverableUnits.energy.toFixed(1)} of 6 (never less)`, built.deliverableUnits.puzzles >= 9 - 0.4 && built.deliverableUnits.energy >= 6 - 0.4 && built.deliverableUnits.charms >= 5 - 0.4)

  // The item counts are hard rules: however much is asked, a rank never holds more items than its rule says.
  const sizesAt = (b, rank) => entriesAt(b, rank).map((e) => Object.keys(e.items).length)
  const within = (b) => sizesAt(b, 6).every((n) => n === 1) && [7, 8, 9].every((r) => sizesAt(b, r).every((n) => n <= 2)) && [10, 11, 12, 14].every((r) => sizesAt(b, r).every((n) => n <= 3))
  check(`no rank holds more items than its rule: two at most at ranks 7 to 9, three only from rank 10 (two-item drops at rank 7: ${sizeShare(built, 7, 2)}%)`, within(built) && Math.abs(sizeShare(built, 7, 2) - 66.7) <= 1 && [8, 9].every((r) => sizesAt(built, r).every((n) => n === 2)) && sizesAt(built, 10).every((n) => n === 3))
  const heavy = make({ coins: 12, puzzles: 90, energy: 60, charms: 150 }, { focus: { type: 'coins', share: 0.6, elastic: true }, twister: { minShare: 0.25, soloShare: 0.25, itemUnits: 1 } })
  const heavyItems = heavy.dropGroups.flatMap((g) => Object.entries(g.items))
  check(`asked for far more than the rules can carry, the counts still hold: nothing is added, the items are rank 3 at most, and the rest is reported short (${Math.round(heavy.shortUnits.puzzles + heavy.shortUnits.energy + heavy.shortUnits.charms)} of 300 units)`, within(heavy) && Math.abs(sizeShare(heavy, 7, 2) - 66.7) <= 1 && heavyItems.every(([, rank]) => rank <= 3) && heavy.shortUnits.charms > 5 && heavy.shortUnits.puzzles > 5 && full(heavy))
  check('...and the Twister item keeps its quarter of every rank', [6, 7, 8, 10].every((r) => Math.abs(typeShare(heavy, r, 'twister') - 25) <= 1.5))

  // A reward with a typed amount under the tiles, and no Twister.
  const energy = make({ coins: 8, puzzles: 9, energy: 6, charms: 5 }, { focus: { type: 'energy', share: 0.6, elastic: false } })
  check(`a reward with a typed amount takes only what that amount allows of rank 6 (${typeShare(energy, 6, 'energy', 1)}% of 20 merges for 6 units)`, Math.abs(typeShare(energy, 6, 'energy', 1) - 30) <= 2 && entriesAt(energy, 6).every((e) => Object.keys(e.items).length === 1) && [8, 10].every((r) => sizeShare(energy, r, 2) === 100))

  // The rank can be moved, or switched off.
  const same = (a, b) => JSON.stringify(a.dropGroupsConfig) === JSON.stringify(b.dropGroupsConfig)
  const off = make(units, { soloRank: 5 })
  const plain = buildAlwaysDropConfiguration({ dropUnits: units, mergesByRank, dropGroups: [], dropGroupsConfig: tables(), minDropRank: 6, multiDropRank: 8, tripleDropRank: 10 })
  check('a single-item rank below the rank drops start at changes nothing: the containers are exactly as before', same(off, plain) && off.soloRanks === null)
  const two = make(units, { soloRank: 7, focus: { type: 'coins', share: 0.6, elastic: true } })
  check('set to rank 7, ranks 6 and 7 are both single-item and rank 8 still holds two or more', [6, 7].every((r) => entriesAt(two, r).every((e) => Object.keys(e.items).length === 1)) && sizeShare(two, 8, 2) === 100 && JSON.stringify(two.soloRanks) === '[6,7]')
}

console.log('--- 4g. The Twister rows of the Small Rewards sheet carry their amounts ---')
{
  const { buildSmallRewardsSheet } = await import('../../src/features/merge/lib/export/eventSheets.js')
  const { withDefaultTwisterValues } = await import('../../src/features/merge/lib/rewards/twisterEconomy.js')
  const { syntaxWithAmount } = await import('../../src/features/merge/lib/rewards/rewardChain.js')
  const board = createBoard('B')
  board.rewardChainConfig = withDefaultTwisterValues(board.rewardChainConfig)
  board.dropGroups = [createDropGroup({ id: 't', items: { [TWISTER_TYPE]: 1 } })]
  const rowsOf = (b) => buildSmallRewardsSheet([b]).rows.map((r) => r.cells).filter((c) => c[0].startsWith('dr-twister'))
  const rows = rowsOf(board)
  check(`with no syntax typed, each Twister rank is written with its amount (${rows.map((r) => r[1]).join(' ')})`, rows.length === 4 && rows.map((r) => r[1]).join() === '[dynamic(dr-twister:2)],[dynamic(dr-twister:5)],[dynamic(dr-twister:12)],[dynamic(dr-twister:30)]')
  const typed = JSON.parse(JSON.stringify(board))
  typed.rewardChainConfig[TWISTER_TYPE][3].syntax = 'my-twister:30'
  check('a syntax typed by hand is kept as typed', rowsOf(typed)[3][1] === 'my-twister:30')
  check('a syntax holding one amount follows a new value (the build resizing the Twister)', syntaxWithAmount('[dynamic(dr-twister:30)]', 165) === '[dynamic(dr-twister:165)]' && syntaxWithAmount('a:1+b:2', 5) === 'a:1+b:2')
}

console.log('--- 5. Endless mode\'s containers, for Ops ---')
{
  const withCoins = (boards) => {
    ;[0.05, 0.12, 0.27, 0.6].forEach((worth, i) => (boards[0].rewardChainConfig.coins[i] = { ...boards[0].rewardChainConfig.coins[i], prizeAmount: worth }))
    return boards
  }
  const main = withCoins(builtList(6))
  const rc = builtList(6) // Recompletion has no coin values of its own
  const endless = endlessOfDesign(main, rc)
  const bank = buildEndlessBankSheet(main, rc)
  const weights = buildEndlessWeightsSheet(main, rc)
  check(`the endless bank lists the endless containers (${bank.rows.map((r) => r.cells.join('=')).join(', ')})`, bank.rows.length === endless.dropGroups.length && bank.rows[0].cells[0] === 'ContA' && bank.columns.join(',') === 'Key,Syntax')
  check('...every one a different drop', new Set(bank.rows.map((r) => r.cells[1])).size === bank.rows.length)
  check('the endless weights run over merge tiers 2 to 14', weights.rows.length === 13 && weights.columns[0] === 'Merge Tier' && weights.columns.at(-1) === 'NoDrop')
  check('...starting one rank lower than Recompletion (tier 5 drops, tier 4 does not)', weights.rows[2].cells.at(-1) === NO_DROP_ONLY_WEIGHT && weights.rows[3].cells.at(-1) === 0 && weights.rows[3].cells.slice(1).reduce((s, v) => s + v, 0) === 1000)
  const rcBank = buildSmallRewardsBankSheet(rc, { phase: 'rc' })
  check('they are not the Recompletion containers: mostly coins and merge energy', JSON.stringify(bank.rows) !== JSON.stringify(rcBank.rows) && (endless.unitsPerDrop.coins + endless.unitsPerDrop.energy) / Object.values(endless.unitsPerDrop).reduce((a, v) => a + v, 0) >= 0.75)

  // Coins have values in the normal event only: carried into Recompletion and endless, they still pay.
  const chain = rewardChainForNextPhase(main[0].rewardChainConfig, rc[0].rewardChainConfig)
  check('a resource Recompletion has no values for keeps the normal event\'s (coins)', chain.coins[3].prizeAmount === 0.6 && chain.energy === rc[0].rewardChainConfig.energy && rewardChainForNextPhase(null, rc[0].rewardChainConfig) === rc[0].rewardChainConfig)
  check('...so endless drops coins for this design', averageDrop(endless.dropGroupsConfig, endless.dropGroups, endless.minDropRank).units.coins > 0)

  // The export is what a session plays: same containers at rank 14.
  const ladder = (name, top, extra) => {
    const b = createBoard(name, { rows: 2, cols: top })
    b.tiles = [Array(top).fill('open'), Array(top).fill('semi')]
    b.semiPlacements = Array.from({ length: top }, (_, i) => ({ row: 1, col: i, rank: i + 1 }))
    b.blockedQueue = []
    return Object.assign(b, { targetEv: 1, ...extra })
  }
  const pick = ({ rewardChainConfig, dropGroups, dropGroupsConfig, minDropRank }) => ({ rewardChainConfig, dropGroups, dropGroupsConfig, minDropRank })
  const mainLadder = [ladder('Main', 11, { rewardChainConfig: main[0].rewardChainConfig })]
  const rcLadder = [ladder('RC', 13, { ...pick(rc[0]), tier2UnlockRank: 3 })]
  const session = createPlaySession(mainLadder, 0, { rcBoards: rcLadder })
  const climb = (from, to) => {
    for (let rank = from; rank <= to; rank++) {
      const cells = []
      for (let r = 0; r < session.state.rows; r++) for (let c = 0; c < session.state.cols; c++) if (session.state.itemAt[r][c] === rank) cells.push([r, c, session.state.stuck[r][c]])
      const mover = cells.find((x) => !x[2])
      const target = cells.find((x) => x[2])
      mergeItems(session, [mover[0], mover[1]], [target[0], target[1]])
    }
  }
  spendGenerator(session, session.tiers[0])
  climb(1, 11)
  spendGenerator(session)
  climb(3, 13)
  const played = [...session.dropGroupsById.values()].map((g) => containerSyntax(g)).sort()
  const exported = buildEndlessBankSheet(mainLadder, rcLadder).rows.map((r) => r.cells[1]).sort()
  check(`a session at rank 14 plays exactly the exported endless containers (${exported.join(', ')})`, session.phase === 'endless' && JSON.stringify(played) === JSON.stringify(exported))
  check('...and a coin item collected in Recompletion pays the normal event\'s coin value', session.rewardChainConfig.coins[3].prizeAmount === 0.6)

  const rules = buildV2EndlessSheet(main, rc)
  const value = (name) => rules.rows.find((r) => r.cells[0].startsWith(name))?.cells[1]
  check('the endless rules sheet states when it starts and where drops start', value('Starts when') === 14 && value('Merge drops start at rank (endless)') === 5 && value('Merge drops start at rank (Recompletion)') === 6 && value('Containers') === bank.rows.length)
  check('...and marks the two amounts as this tool\'s own', rules.rows.filter((r) => /not a confirmed game value/.test(r.cells[2])).length === 2)
  check('a design with no Recompletion list has no endless mode, and says so', buildEndlessBankSheet(main, []).rows.length === 0 && buildEndlessWeightsSheet(main, []).rows.length === 0 && buildV2EndlessSheet(main, []).rows[0].cells[1] === 'none')
}

console.log(failures === 0 ? `\nALL ${count} CONTAINER CHECKS PASSED` : `\n${failures} OF ${count} CONTAINER CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
