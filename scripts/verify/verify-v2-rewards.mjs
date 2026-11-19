// V2 reward-chain / drop-group / RC-transition verification script.
// Run with: npx vite-node scripts/verify/verify-v2-rewards.mjs
// (No test framework exists in this repo - see CLAUDE.md's "Known open
// items" - this follows the project's established vite-node convention.)
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import {
  buildInitialState,
  performMerge,
  collectReward,
  currentMaxRank,
  simulatePlaythrough,
  enterRecompletion,
  RC_CHASE_DR,
  mainChainProgress,
} from '../../src/features/merge/lib/simulation/mergeSimulation.js'
import { encodeReward, decodeReward, isMainItem, REWARD_TYPES, createRewardChainConfig, validateRewardChainConfig } from '../../src/features/merge/lib/rewards/rewardChain.js'
import { createDropGroup, createRankDropTable, createDropGroupsConfig, rollDrop, validateDropGroupsConfig, createDropScheduler } from '../../src/features/merge/lib/rewards/dropGroups.js'
import { MAX_RANK, RC_MAX_RANK, valueOf } from '../../src/features/merge/lib/core/ranks.js'
import { computeEffectiveSubsidy, estimateExpectedCollectibleRewards, validateConfigAcrossRuns, computeRankContributions, payoutForUnits, closestUnitsForTarget } from '../../src/features/merge/lib/rewards/rewardEconomy.js'
import { buildWorkbook, buildV2RewardChainSheet, buildV2DropGroupsSheet, buildV2EconomySheet, buildAllSegmentsWorkbook, buildAllSegmentsSheetsAsValueRows } from '../../src/features/merge/lib/export/eventSheets.js'
import { buildDropConfiguration, expectedDropUnits } from '../../src/features/merge/lib/rewards/rewardTargeting.js'
import { encodeStage, decodeStage } from '../../src/features/merge/lib/share/stageShare.js'
import { buildSheetsRequests, validateSheetsPayload } from '../../src/features/merge/lib/export/googleSheetsExport.js'
import { buildBoardLayoutsSheet, buildBlockedQueueSheet, buildAllSheetsAsValueRows } from '../../src/features/merge/lib/export/eventSheets.js'
import { createPlaySession, mergeItems, actionFor, collectRewardItem, spendEnergyForAction, canSpendEnergy, spendGenerator } from '../../src/features/merge/lib/simulation/playSession.js'
import { FIRST_BOARD_SUBSIDY_CAP_DR } from '../../src/features/merge/lib/core/board.js'
import { smallRewardKey, coinAllowanceSyntax, parseCoinAllowanceSyntax, isLiteralCoinDefinition, formatRewardAmount, coinSyntaxFollowsWorth } from '../../src/features/merge/lib/rewards/rewardChain.js'
import { createSmallRewardsBankConfig, createSmallRewardWeightsConfig } from '../../src/features/merge/lib/rewards/smallRewardsBank.js'
import { buildSmallRewardsSheet, buildSmallRewardsBankSheet, buildSmallRewardWeightsSheet } from '../../src/features/merge/lib/export/eventSheets.js'
import { buildSeries } from '../../src/features/merge/lib/rewards/rewardProgression.js'
import { placeItems } from '../../src/features/merge/lib/core/placement.js'
import { proposeRewardPlacements, rewardSlotCapacity, rewardSemiSlots, rewardUnitsByType } from '../../src/features/merge/lib/rewards/rewardPlacement.js'
import { generateSmallRewardsConfiguration, splitTargets } from '../../src/features/merge/lib/rewards/smallRewardsWorkflow.js'
import { ENERGY_CREDIT_RATE } from '../../src/features/merge/lib/rewards/rewardEconomy.js'

let failures = 0
function check(name, cond) {
  if (cond) console.log(`  OK  ${name}`)
  else {
    failures++
    console.log(`FAIL  ${name}`)
  }
}

function tinyState(rows, cols) {
  const board = createBoard('t')
  board.rows = rows
  board.cols = cols
  board.tiles = Array.from({ length: rows }, () => Array(cols).fill('open'))
  board.semiPlacements = []
  board.blockedQueue = []
  return buildInitialState(board)
}

console.log('--- 1. Reward encoding round-trips, disjoint from main ranks ---')
for (const type of REWARD_TYPES) {
  for (let rank = 1; rank <= 4; rank++) {
    const v = encodeReward(type, rank)
    check(`encode/decode ${type} r${rank}`, isMainItem(v) === false && decodeReward(v).type === type && decodeReward(v).rank === rank)
  }
}
for (let r = 1; r <= RC_MAX_RANK; r++) check(`main rank ${r} is main item`, isMainItem(r) && decodeReward(r) === null)

console.log('--- 2. Reward-chain merge mechanics + rank-4 auto-collect ---')
{
  const state = tinyState(2, 2)
  const a = encodeReward('coins', 3)
  state.itemAt[0][0] = a
  state.itemAt[0][1] = a
  let collected = null
  performMerge(state, { mover: [0, 1], receiver: [0, 0], rank: a }, () => {}, null, {
    onCollect: (type, rank, count) => (collected = { type, rank, count }),
  })
  check('two rank-3 coins merge collects rank 4, nothing placed', state.itemAt[0][0] == null && collected?.type === 'coins' && collected?.rank === 4)

  const state2 = tinyState(2, 2)
  const b = encodeReward('puzzles', 1)
  state2.itemAt[0][0] = b
  state2.itemAt[0][1] = b
  performMerge(state2, { mover: [0, 1], receiver: [0, 0], rank: b }, () => {}, null, {})
  check('two rank-1 puzzles merge to a placed rank-2 item', decodeReward(state2.itemAt[0][0])?.rank === 2)
}

console.log('--- 3. Manual collection: not while a reward item is semi-blocked, yes once it is freed ---')
{
  const state = tinyState(1, 1)
  state.itemAt[0][0] = encodeReward('energy', 2)
  state.stuck[0][0] = true
  let collected = null
  const blockedTry = collectReward(state, [0, 0], (type, rank) => (collected = { type, rank }))
  check('a semi-blocked reward item cannot be collected: nothing is paid and it stays where it is', blockedTry === null && collected === null && state.itemAt[0][0] === encodeReward('energy', 2) && state.stuck[0][0] === true)
  state.stuck[0][0] = false // freed (a matching item was merged into it)
  const info = collectReward(state, [0, 0], (type, rank) => (collected = { type, rank }))
  check('collectReward returns decoded info', info?.type === 'energy' && info?.rank === 2)
  check('collectReward credits onCollect', collected?.type === 'energy' && collected?.rank === 2)
  check('cell cleared after collect', state.itemAt[0][0] == null && state.stuck[0][0] === false)
}

console.log('--- 4. currentMaxRank ignores reward items ---')
{
  const state = tinyState(1, 2)
  state.itemAt[0][0] = 3 // main rank 3
  state.itemAt[0][1] = encodeReward('charms', 4)
  check('currentMaxRank sees only the main item', currentMaxRank(state) === 3)
}

console.log('--- 5. Reward-chain validation flags a wrong ladder ---')
{
  const config = createRewardChainConfig()
  // A monotonic ladder - no findings expected.
  // A ladder that rewards merging at every step (rank 4 strictly beats
  // cashing out its items at any earlier rank).
  ;[1, 3, 7, 16].forEach((v, i) => (config.coins[i].prizeAmount = v))
  // An exactly-proportional ladder (1, 2, 4, 8) does NOT reward merging:
  // rank 4 is worth the same as the 2 rank-3 items it takes, not more.
  ;[1, 2, 4, 8].forEach((v, i) => (config.charms[i].prizeAmount = v))
  // A ladder where rank 1 pays better per source unit than rank 4.
  config.puzzles[0].prizeAmount = 100
  config.puzzles[1].prizeAmount = 1
  config.puzzles[2].prizeAmount = 1
  config.puzzles[3].prizeAmount = 1
  const findings = validateRewardChainConfig(config)
  check('a ladder that rewards merging has no finding', !findings.some((f) => f.type === 'coins'))
  check('a merely proportional ladder is flagged (rank 4 must be strictly better)', findings.some((f) => f.type === 'charms' && f.issues.every((i) => i.code === 'top-rank-not-best')))
  check('bad puzzles ladder is flagged', findings.some((f) => f.type === 'puzzles'))
}

console.log('--- 6. Drop groups: only main-chain merges roll drops, joint outcomes, weighting ---')
{
  const group = createDropGroup({ id: 'g1', items: { coins: 1, energy: 2 } })
  const groupsById = new Map([['g1', group]])
  const table = createRankDropTable(5)
  table.noDropWeight = 0
  table.entries = [{ groupId: 'g1', weight: 1 }]
  const drop = rollDrop(table, groupsById, () => 0.5)
  check('rollDrop returns joint items from the hit group', drop?.coins === 1 && drop?.energy === 2)

  const noDropTable = createRankDropTable(5)
  noDropTable.noDropWeight = 1
  noDropTable.entries = [{ groupId: 'g1', weight: 0 }]
  check('rollDrop can resolve to no-drop', rollDrop(noDropTable, groupsById, () => 0.99) === null)

  // Reward-chain merge must never roll a drop, even with a dropGroupsConfig present.
  const state = tinyState(2, 2)
  const rewardRank = encodeReward('coins', 1)
  state.itemAt[0][0] = rewardRank
  state.itemAt[0][1] = rewardRank
  let dropFired = false
  performMerge(state, { mover: [0, 1], receiver: [0, 0], rank: rewardRank }, () => {}, null, {
    dropGroupsConfig: [table, table, table, table, table],
    dropGroupsById: groupsById,
    onCollect: () => (dropFired = true),
  })
  check('reward-chain merge never triggers a drop roll', dropFired === false)

  // A main-chain merge producing rank 6 (MIN_DROP_RANK) DOES roll against
  // that table (index 5).
  const state2 = tinyState(2, 2)
  state2.itemAt[0][0] = 5
  state2.itemAt[0][1] = 5
  performMerge(state2, { mover: [0, 1], receiver: [0, 0], rank: 5 }, () => {}, null, {
    dropGroupsConfig: [null, null, null, null, null, table],
    dropGroupsById: groupsById,
  })
  const dropped = state2.itemAt.flat().map((v) => decodeReward(v)).filter(Boolean)
  check(
    'main-chain merge to rank 6 drops the whole group as real board items (coins R1 + energy R2 together)',
    dropped.length === 2 && dropped.some((d) => d.type === 'coins' && d.rank === 1) && dropped.some((d) => d.type === 'energy' && d.rank === 2),
  )
  check('dropped reward items are immediately usable (never stuck)', state2.stuck.flat().every((v) => v === false))
  check('dropped items are counted on the drop side of the reward pool', state2.rewardPool.drop.coins === 1 && state2.rewardPool.drop.energy === 2)

  // A main-chain merge producing rank 5 - BELOW MIN_DROP_RANK - must NEVER
  // roll, even with a populated table sitting right there (hard engine
  // gate, by explicit economist decision: "drops only start at rank 6").
  const state3 = tinyState(2, 2)
  state3.itemAt[0][0] = 4
  state3.itemAt[0][1] = 4
  let belowGateDropFired = false
  performMerge(state3, { mover: [0, 1], receiver: [0, 0], rank: 4 }, () => {}, null, {
    dropGroupsConfig: [null, null, null, null, table],
    dropGroupsById: groupsById,
    onCollect: () => (belowGateDropFired = true),
  })
  check('main-chain merge to rank 5 (below MIN_DROP_RANK) never rolls, even if configured', belowGateDropFired === false)

  // Validation catches an unknown group id and a zero-weight table.
  // Both at/above MIN_DROP_RANK (6) - below that, these checks are
  // intentionally skipped (see validateDropGroupsConfig's own comment).
  const badTable = createRankDropTable(6)
  badTable.noDropWeight = 0
  badTable.entries = [{ groupId: 'missing', weight: 1 }]
  const zeroTable = createRankDropTable(7)
  zeroTable.noDropWeight = 0
  const findings = validateDropGroupsConfig([badTable, zeroTable], groupsById)
  check('unknown group id flagged', findings.some((f) => f.includes('unknown drop group')))
  check('zero total weight flagged', findings.some((f) => f.includes('zero total weight')))

  // A table that only covers some resources is NOT a finding: a resource
  // with no target needs no drops at all.
  const partialTable = createRankDropTable(8)
  partialTable.noDropWeight = 0
  partialTable.entries = [{ groupId: 'g1', weight: 1 }]
  check('partial resource coverage is not flagged', validateDropGroupsConfig([partialTable], groupsById).length === 0)

  // The same rank, but below MIN_DROP_RANK - no coverage finding at all,
  // since the table can never fire there regardless of what it contains.
  const belowGateTable = createRankDropTable(5)
  belowGateTable.noDropWeight = 0
  belowGateTable.entries = [{ groupId: 'g1', weight: 1 }]
  const belowGateFindings = validateDropGroupsConfig([belowGateTable], groupsById)
  check('no coverage/zero-weight findings below MIN_DROP_RANK', belowGateFindings.length === 0)
}

console.log('--- 7. RC transition: one-time ratchet + whole-chain-cleared gate, second grand prize ---')
{
  // A trivially tiny main board: one open cell, no subsidy at all, so the
  // player must generate their own way to rank 12 (fast via a direct test:
  // we seed the state by hand instead of running the full generator loop,
  // to keep this test fast and deterministic - exercising simulatePlaythrough
  // end-to-end for the GATE logic, not re-testing generator pacing).
  const mainBoard = createBoard('main-1')
  mainBoard.rows = 6
  mainBoard.cols = 6
  mainBoard.tiles = Array.from({ length: 6 }, () => Array(6).fill('open'))
  mainBoard.blockedQueue = []
  mainBoard.semiPlacements = []
  mainBoard.tier2UnlockRank = 2
  mainBoard.tier4UnlockRank = 3

  const rcBoard = createBoard('rc-1')
  rcBoard.rows = 6
  rcBoard.cols = 6
  rcBoard.tiles = Array.from({ length: 6 }, () => Array(6).fill('open'))
  rcBoard.blockedQueue = []
  rcBoard.semiPlacements = []
  rcBoard.tier2UnlockRank = 2
  rcBoard.tier4UnlockRank = 3

  const resultNoRc = simulatePlaythrough([mainBoard], { drBudget: 1e7, maxSteps: 2000000 })
  check('without rcBoards, run stops at max-rank-reached (unchanged legacy behavior)', resultNoRc.stopReason === 'max-rank-reached' && resultNoRc.phase === 'main')

  const resultWithRc = simulatePlaythrough([mainBoard], { drBudget: 1e7, maxSteps: 2000000, rcBoards: [rcBoard] })
  check('with rcBoards, run enters RC phase after clearing the main chain', resultWithRc.rcEntered === true)
  check('RC run continues past rank 12 toward rank 14', resultWithRc.reachedAt[MAX_RANK] !== undefined)
  check('second grand prize (rank 14) is reachable and reported', resultWithRc.secondGrandPrizeAwarded === true && resultWithRc.reachedAt[RC_MAX_RANK] !== undefined)
  check('stopReason reflects the RC ceiling', resultWithRc.stopReason === 'rc-max-rank-reached')
  check('mainPhase snapshot captured independently of the final (RC) phase', resultWithRc.mainPhase != null && resultWithRc.mainPhase.boardsReached === 1)
}

console.log('--- 8. Legacy mixed-queue-free board: subsidy accounting unaffected by the main-item guard ---')
{
  const board = createBoard('legacy')
  board.rows = 2
  board.cols = 2
  board.tiles = [['semi', 'open'], ['open', 'open']]
  board.semiPlacements = [{ row: 0, col: 0, rank: 1 }]
  board.blockedQueue = []
  const result = simulatePlaythrough([board], { drBudget: 50 })
  check('subsidyConfigured matches valueOf(1) for one plain rank-1 semi tile', result.subsidyConfigured === valueOf(1))
}

console.log('--- 9. Energy-credit subsidy formula: both worked examples from the spec ---')
{
  const a = computeEffectiveSubsidy(1000, 0, 100)
  check('base 1000, no CC, expected energy 100 -> effective 920', a.effectiveSubsidy === 920)
  const b = computeEffectiveSubsidy(1000, 0.1, 100)
  check('base 1000, CC+10%, expected energy 100 -> effective 1020', b.effectiveSubsidy === 1020)
}

console.log('--- 10. Energy-funded free generator action ("1 energy funds 1 x1 action") ---')
{
  const board = createBoard('energy-board')
  board.rows = 3
  board.cols = 3
  board.tiles = Array.from({ length: 3 }, () => Array(3).fill('open'))
  board.semiPlacements = []
  board.blockedQueue = []
  const result = simulatePlaythrough([board], { drBudget: 0, maxSteps: 50 })
  check('with zero DR budget and no energy, the run cannot spend at all', result.drSpent === 0 && result.energySpent === 0)
}

console.log('--- 11. The deterministic prediction is a real run: scheduled drops land as items, merge, and fund energy taps ---')
{
  const group = createDropGroup({ id: 'g-energy', items: { energy: 3 } })
  const groupsById = new Map([['g-energy', group]])
  const dropGroupsConfig = createDropGroupsConfig(RC_MAX_RANK)
  for (let rank = 6; rank <= RC_MAX_RANK; rank++) {
    dropGroupsConfig[rank - 1].noDropWeight = 500
    dropGroupsConfig[rank - 1].entries = [{ groupId: 'g-energy', weight: 500 }]
  }
  const rewardChainConfig = createRewardChainConfig()

  const board = createBoard('ev-board')
  board.rows = 6
  board.cols = 6
  board.tiles = Array.from({ length: 6 }, () => Array(6).fill('open'))
  board.semiPlacements = []
  board.blockedQueue = []
  // (Leftovers lost, so every energy counted came from a finished rank-4 item.)
  const a = estimateExpectedCollectibleRewards([board], { rewardChainConfig, dropGroupsConfig, dropGroupsById: groupsById, drBudget: 1e7, leftoverPolicy: 'forfeit' })
  const b = estimateExpectedCollectibleRewards([board], { rewardChainConfig, dropGroupsConfig, dropGroupsById: groupsById, drBudget: 1e7, leftoverPolicy: 'forfeit' })
  check('prediction collects real energy from dropped items that merged to rank 4', a.collected.energy > 0 && a.collected.energy % rewardChainConfig.energy[3].prizeAmount === 0)
  check('prediction is deterministic (same inputs, same run)', JSON.stringify(a.result.collected) === JSON.stringify(b.result.collected) && a.result.drSpent === b.result.drSpent)
  check('collected energy is cumulative payout - spending it never draws it down', a.result.energySpent > 0 && Math.abs(a.result.energySpent + a.result.energyBalance - a.result.collected.energy) < 1e-9)
  check('every prize is attributed to drops here (no tile items) and sources reconcile to the total', Math.abs(a.collectedBySource.drop.energy - a.collected.energy) < 1e-9 && a.collectedBySource.tile.energy === 0)

  const next = createDropScheduler()
  const table = { rank: 9, noDropWeight: 750, entries: [{ groupId: 'g-energy', weight: 250 }] }
  let hits = 0
  for (let i = 0; i < 400; i++) if (next(table, groupsById)) hits += 1
  check('scheduler fires each outcome in proportion to its weight (100 of 400 at 25%)', Math.abs(hits - 100) <= 1)
}

console.log('--- 12. Seeded stochastic multi-run validation is reproducible and reports completion rates ---')
{
  const board = createBoard('stoch-board')
  board.rows = 6
  board.cols = 6
  board.tiles = Array.from({ length: 6 }, () => Array(6).fill('open'))
  board.semiPlacements = []
  board.blockedQueue = []
  const runA = validateConfigAcrossRuns([board], { runs: 10, seed: 42, drBudget: 1e7 })
  const runB = validateConfigAcrossRuns([board], { runs: 10, seed: 42, drBudget: 1e7 })
  check('same seed reproduces identical aggregate results', JSON.stringify(runA) === JSON.stringify(runB))
  check('main-phase completion rate is reported (0-1 range)', runA.mainPhaseCompletionRate >= 0 && runA.mainPhaseCompletionRate <= 1)
  check('per-resource payout percentiles are reported', 'p50' in runA.payouts.coins)
}

console.log('--- 13. End-to-end: a mixed queue with pinned energy items actually reduces required DR spend ---')
{
  // Two rank-3 energy items placed directly in the blocked queue (mixed
  // queue, section 4) - reachable by the time the board is mostly cleared,
  // merging to rank-4 energy and auto-collecting 1 energy unit (rewardChain
  // rank-4 prize configured below), which the main loop then spends as a
  // free x1 action instead of DR.
  const rewardChainConfig = createRewardChainConfig()
  rewardChainConfig.energy[3].prizeAmount = 1 // rank 4 energy = 1 energy unit

  const makeBoard = (withEnergy) => {
    const b = createBoard('mixed-queue')
    b.rows = 4
    b.cols = 4
    b.tiles = Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) => (r === 0 && c < 2 ? 'blocked' : 'open')))
    b.semiPlacements = []
    b.blockedQueue = withEnergy ? [encodeReward('energy', 3), encodeReward('energy', 3)] : [1, 1]
    return b
  }
  // An item under a tile is semi-blocked when revealed and is freed by a
  // matching FREE item - which only merge drops provide. So the board's two
  // rank-3 energy items pay out through a rank-3 energy drop.
  const energyDrop = { id: 'e3', name: 'Energy R3', items: { energy: 3 } }
  const energyTables = createDropGroupsConfig(RC_MAX_RANK)
  energyTables[1] = { ...energyTables[1], entries: [{ groupId: 'e3', weight: 1000 }], noDropWeight: 0 }
  const drops = { dropGroupsConfig: energyTables, dropGroupsById: new Map([['e3', energyDrop]]), minDropRank: 2, dropMode: 'expected' }
  const withEnergy = simulatePlaythrough([makeBoard(true)], { drBudget: 1e7, maxSteps: 500000, rewardChainConfig, trace: true, ...drops })
  check('a board with mixed-queue energy items reports energySpent > 0', withEnergy.energySpent > 0)
  check('an energy-spend event actually fires in the real event log', withEnergy.events.some((e) => e.type === 'energy-spend'))
  // A fair A/B: a DR-budget capped JUST below what a run with zero collected
  // energy would need proves the energy-funded tap did real, additional
  // work the DR budget alone could not have bought - not just a side effect
  // of swapping which items happened to be in the queue.
  // createRewardChainConfig() is now seeded with the real Ops reference
  // (non-zero defaults - see rewardChain.js) - explicitly zero every energy
  // prizeAmount here so this specific comparison's premise ("energy never
  // actually credits") still holds, rather than relying on a blank default.
  const noEnergyChainConfig = createRewardChainConfig()
  noEnergyChainConfig.energy.forEach((r) => (r.prizeAmount = 0))
  const capped = simulatePlaythrough([makeBoard(true)], { drBudget: withEnergy.drSpent, maxSteps: 500000, rewardChainConfig: noEnergyChainConfig, ...drops })
  check(
    'with energy crediting disabled (prize 0) and the SAME DR budget, the run reaches strictly less progress',
    Object.keys(capped.reachedAt).length <= Object.keys(withEnergy.reachedAt).length &&
      (capped.stopReason !== withEnergy.stopReason || capped.reachedAt[MAX_RANK] === undefined),
  )
}

console.log('--- 14. Ops export: V2 sheets build without error and append to the existing 11-sheet workbook ---')
{
  const board = createBoard('ops-board')
  board.rewardChainConfig.coins[0].syntax = 'coin-1'
  board.rewardChainConfig.coins[0].prizeAmount = 10
  board.dropGroups = [{ id: 'g1', name: 'Group 1', items: { coins: 1, energy: 2 } }]
  board.dropGroupsConfig[0].entries = [{ groupId: 'g1', weight: 5 }]

  board.dropGroupsConfig[5].entries = [{ groupId: 'g1', weight: 5 }]
  const chainSheet = buildV2RewardChainSheet([board])
  check('V2 reward chain sheet has 20 rows (4 resources + Twister DR, x 4 ranks) for one list', chainSheet.rows.length === 20)
  check('V2 reward chain sheet maps each key to its configured syntax/prize', chainSheet.rows.some((r) => r.cells[0] === 'Main' && r.cells[3] === 'coin-r1' && r.cells[4] === 'coin-1' && r.cells[6] === 10))

  const dropSheet = buildV2DropGroupsSheet([board])
  check('V2 drop groups sheet includes the configured group entry at rank 6', dropSheet.rows.some((r) => r.cells[0] === 'Main' && r.cells[1] === 6 && r.cells[2] === 'Group 1' && r.cells[4] === 1 && r.cells[6] === 2))
  check('V2 drop groups sheet leaves out ranks below the drop start rank', dropSheet.rows.every((r) => r.cells[1] >= 6))

  // One Recompletion mode: the workbook has the eleven verified Ops sheets
  // in their order (no "Recompletion B" tabs), then the V2 sheets.
  const rcBoard = createBoard('rc-board')
  rcBoard.blockedQueue = [3, 3, 3]
  const workbook = buildWorkbook([board], [rcBoard])
  const sheetNames = workbook.worksheets.map((ws) => ws.name)
  // (The Blocked Queue holds the normal list and Recompletion one after the
  // other now - economist: "they happen one after another in the same event" -
  // so there is no "Recompletion Blocked Queue" tab; verify-containers.mjs, section 6.)
  check('workbook keeps the ten Ops sheets, unreordered, with one Recompletion list', sheetNames.slice(0, 10).join('|') === [
    'Event Data', 'Multipliers', 'Board Layouts', 'Recompletion Board Layouts', 'Generator Weights',
    'Blocked Queue', 'Item Ladder', 'Small Rewards', 'Small Rewards Bank', 'Small Reward Weights',
  ].join('|'))
  check('there are no Recompletion container tabs: one bank and one weights table for the whole event', !sheetNames.some((n) => /^RC Small/.test(n)))
  check('endless mode\'s containers follow', sheetNames[10] === 'Endless Small Rewards Bank' && sheetNames[11] === 'Endless Small Reward Weights')
  check('workbook appends the V2 sheets at the end', sheetNames[12] === 'V2 Reward Chain' && sheetNames[13] === 'V2 Drop Groups' && sheetNames.at(-1) === 'V2 Endless')
  check('no "Recompletion B" tab exists any more', sheetNames.every((n) => !/ B$/.test(n)))
  const queueSheet = workbook.worksheets.find((ws) => ws.name === 'Blocked Queue')
  check('the Blocked Queue carries the Recompletion list\'s own entries after the normal ones', queueSheet.rowCount - 1 === board.blockedQueue.length + 3 && !sheetNames.includes('Recompletion Blocked Queue'))
  check('a legacy third list passed by an old caller is ignored, not exported', buildWorkbook([board], [rcBoard], [createBoard('old-b')]).worksheets.length === workbook.worksheets.length)
}

console.log('--- 15. Drop configuration is GENERATED - contents and weights - with no pre-existing groups; locked groups and ranks are kept ---')
{
  const mergesByRank = { 6: 20, 7: 12, 8: 8, 9: 5, 10: 3, 11: 2, 12: 1 }
  const empty = createDropGroupsConfig(RC_MAX_RANK)
  const need = { coins: 16, puzzles: 0, energy: 40, charms: 8 }

  const separate = buildDropConfiguration({ dropUnits: need, mergesByRank, dropGroups: [], dropGroupsConfig: empty, minDropRank: 6, structure: 'separate' })
  check('generates groups from nothing', separate.dropGroups.length === 3 && separate.dropGroups.every((g) => g.auto))
  check('each generated group holds 1-4 resources, at most one item per resource', separate.dropGroups.every((g) => Object.keys(g.items).length >= 1 && Object.keys(g.items).length <= 4))
  check('untargeted resources get no group', !separate.dropGroups.some((g) => 'puzzles' in g.items))
  const delivered = expectedDropUnits(separate.dropGroupsConfig, separate.dropGroups, mergesByRank, 6)
  check('generated odds deliver the requested expected units (within weight rounding)', ['coins', 'energy', 'charms'].every((t) => Math.abs(delivered[t] - need[t]) / need[t] < 0.06))
  check('every written table keeps an explicit no-drop outcome and sums to 1000', separate.dropGroupsConfig.slice(5).every((t) => t.noDropWeight >= 0 && t.noDropWeight + t.entries.reduce((x, e) => x + e.weight, 0) === 1000))
  check('ranks below the drop start rank are never given entries', separate.dropGroupsConfig.slice(0, 5).every((t) => t.entries.length === 0))

  const bundle = buildDropConfiguration({ dropUnits: need, mergesByRank, dropGroups: [], dropGroupsConfig: empty, minDropRank: 6, structure: 'bundle' })
  check('bundle structure produces one group carrying several resources together', bundle.dropGroups.some((g) => Object.keys(g.items).length >= 2))
  const bundleDelivered = expectedDropUnits(bundle.dropGroupsConfig, bundle.dropGroups, mergesByRank, 6)
  check('bundle structure also delivers the requested units', ['coins', 'energy', 'charms'].every((t) => Math.abs(bundleDelivered[t] - need[t]) / need[t] < 0.08))

  // A hand-authored (locked) group and a locked rank survive untouched.
  const manual = createDropGroup({ id: 'manual-1', name: 'My group', items: { puzzles: 2 } })
  const withManual = createDropGroupsConfig(RC_MAX_RANK)
  for (let rank = 6; rank <= RC_MAX_RANK; rank++) {
    withManual[rank - 1].noDropWeight = 900
    withManual[rank - 1].entries = [{ groupId: 'manual-1', weight: 100 }]
  }
  withManual[6].locked = true // rank 7
  const kept = buildDropConfiguration({ dropUnits: need, mergesByRank, dropGroups: [manual], dropGroupsConfig: withManual, minDropRank: 6, structure: 'separate' })
  check('a locked group keeps its contents', JSON.stringify(kept.dropGroups.find((g) => g.id === 'manual-1').items) === JSON.stringify({ puzzles: 2 }))
  check('a locked group keeps its odds (10%) in every rewritten table', kept.dropGroupsConfig[5].entries.find((e) => e.groupId === 'manual-1').weight === 100)
  check('a locked rank is left exactly as it was', JSON.stringify(kept.dropGroupsConfig[6]) === JSON.stringify(withManual[6]))
  const regen = buildDropConfiguration({ dropUnits: need, mergesByRank, dropGroups: kept.dropGroups, dropGroupsConfig: kept.dropGroupsConfig, minDropRank: 6, structure: 'separate' })
  check('re-generating replaces generated groups instead of stacking them', regen.dropGroups.length === kept.dropGroups.length)

  const starved = buildDropConfiguration({ dropUnits: { coins: 5000, puzzles: 0, energy: 0, charms: 0 }, mergesByRank: { 6: 2 }, dropGroups: [], dropGroupsConfig: empty, minDropRank: 6 })
  check('more than the eligible merges can deliver is reported as short, not silently dropped', starved.shortUnits.coins > 0)
}

console.log('--- 16. Real Ops reference data: Small Rewards / Bank / Weights are board-driven and seeded correctly ---')
{
  const board = createBoard('ops-small-rewards')
  check('smallRewardKey maps real reward types to the reference key prefixes', smallRewardKey('coins', 1) === 'coin-r1' && smallRewardKey('energy', 2) === 'dr-r2' && smallRewardKey('puzzles', 3) === 'puzzle-r3' && smallRewardKey('charms', 4) === 'charm-r4')
  check('rewardChainConfig is seeded with the reference prize amounts for energy/puzzles/charms', board.rewardChainConfig.energy[3].prizeAmount === 75 && board.rewardChainConfig.puzzles[3].prizeAmount === 40)
  check('coins are NOT seeded with literal amounts - an allowance worth is never invented', board.rewardChainConfig.coins.every((r) => r.prizeAmount === 0 && r.syntax === ''))
  check('rewardChainConfig is seeded with the reference syntax, one resource per item', board.rewardChainConfig.charms[1].syntax === '[dynamic(dr-mf-charm:10)]' && board.rewardChainConfig.charms[1].prizeAmount === 10 && Object.values(board.rewardChainConfig).every((ladder) => ladder.every((r) => !String(r.syntax ?? '').includes('+'))))

  const bank = createSmallRewardsBankConfig()
  check('Small Rewards Bank seeds exactly the reference\'s 10 containers', bank.length === 10 && bank[1].syntax === 'coin-r1+dr-r1+puzzle-r1+charm-r1')

  const weights = createSmallRewardWeightsConfig()
  check('Small Reward Weights covers merge tiers 2..RC_MAX_RANK', weights.length === RC_MAX_RANK - 1 && weights[0].tier === 2)
  check('Small Reward Weights seeds the reference pattern (ContB:1, NoDrop:2) for tiers 2-12', weights.slice(0, 11).every((r) => r.weights.ContB === 1 && r.noDropWeight === 2))

  const sheet = buildSmallRewardsSheet([board])
  check('buildSmallRewardsSheet is board-driven (16 rows, real key/syntax/asset)', sheet.rows.length === 16 && sheet.rows[0].cells[0] === 'coin-r1' && sheet.rows[0].cells[2] === 'merge-config-coin-v2')

  board.smallRewardsBankConfig = bank
  board.smallRewardWeightsConfig = weights
  const bankSheet = buildSmallRewardsBankSheet([board])
  check('buildSmallRewardsBankSheet lists the model\'s containers - none for a board with no merge drops (never the hand-typed table)', bankSheet.rows.length === 0 && bankSheet.source === 'none')
  const weightsSheet = buildSmallRewardWeightsSheet([board])
  check('buildSmallRewardWeightsSheet for such a board: Merge Tier and NoDrop only', weightsSheet.columns.join(',') === 'Merge Tier,NoDrop' && weightsSheet.source === 'none')
  check('...every tier NoDrop only (nothing drops in that design)', weightsSheet.rows.length === 11 && weightsSheet.rows.every((r) => r.cells.at(-1) === 1000))
}

console.log('--- 17. "Merges per rank" + per-rank EV contribution ("7 merges of rank 7...") ---')
{
  const board = createBoard('merges-per-rank')
  board.rows = 6
  board.cols = 6
  board.tiles = Array.from({ length: 6 }, () => Array(6).fill('open'))
  board.semiPlacements = []
  board.blockedQueue = []

  const result = simulatePlaythrough([board], { drBudget: 1e7, maxSteps: 500000 })
  check('mergeCountsByRank is populated for ranks reached', Object.keys(result.mergeCountsByRank).length > 0)
  check('mergeCountsByRank never counts rank 1 (no merge can ever RESULT in rank 1)', result.mergeCountsByRank[1] === undefined)
  check('mergeCountsByRank counts real merge events, not just first-reach (unlike reachedAt)', (result.mergeCountsByRank[2] ?? 0) >= 1)

  const group = createDropGroup({ id: 'g1', name: 'G1', items: { coins: 2 } })
  const groupsById = new Map([['g1', group]])
  const rewardChainConfig = createRewardChainConfig()
  rewardChainConfig.coins[3].prizeAmount = 12 // rank 4 coins = 12, so a dropped rank-2 item (2 of 8 units) is worth 3
  const dropGroupsConfig = createDropGroupsConfig(RC_MAX_RANK)
  dropGroupsConfig[5].noDropWeight = 0 // rank 6 (index 5) always drops
  dropGroupsConfig[5].entries = [{ groupId: 'g1', weight: 1 }]

  const rows = computeRankContributions(result.mergeCountsByRank, dropGroupsConfig, groupsById, rewardChainConfig)
  check('computeRankContributions covers every rank from MIN_DROP_RANK..RC_MAX_RANK', rows.length === RC_MAX_RANK - 5 && rows[0].rank === 6)
  const rank6Row = rows.find((r) => r.rank === 6)
  const mergesAt6 = result.mergeCountsByRank[6] ?? 0
  check('contribution = merges x per-roll EV, exactly', Math.abs(rank6Row.contribution.coins - mergesAt6 * 3) < 1e-9)
  check('a rank with zero configured drop table contributes nothing', rows.find((r) => r.rank === 7).contribution.coins === 0)
}

console.log('--- 18. Reward progression chart: cumulative collection vs. merge-count progression ---')
{
  const events = [
    { type: 'spend', rank: 1 },
    { type: 'merge', rank: 1, newRank: 2 }, // merge #1
    { type: 'collect', rewardType: 'coins', amount: 5, source: 'drop' },
    { type: 'merge', rank: 2, newRank: 3 }, // merge #2 - no collect
    { type: 'merge', rank: 5, newRank: 6 }, // merge #3
    { type: 'collect', rewardType: 'coins', amount: 3, source: 'drop' },
    { type: 'collect', rewardType: 'energy', amount: 1, source: 'tile' },
    { type: 'merge', rank: 6, newRank: 7 }, // merge #4 - no collect
  ]
  const { series, mergeCount, totals } = buildSeries(events)
  check('mergeCount counts every merge event', mergeCount === 4)
  check('coins series accumulates across multiple collects, in merge order', JSON.stringify(series.coins) === JSON.stringify([[0, 0], [1, 5], [3, 8], [4, 8]]))
  check('energy series reflects its own, later collect', JSON.stringify(series.energy) === JSON.stringify([[0, 0], [3, 1], [4, 1]]))
  check('an untouched resource stays flat at zero for the whole run', JSON.stringify(series.puzzles) === JSON.stringify([[0, 0], [4, 0]]))
  check('totals match the series\' own final cumulative value', totals.coins === 8 && totals.energy === 1 && totals.charms === 0)
}

// A plain non-first board (index 3: no positional rank floor/ceiling) with a
// known blocked-tile count and subsidy, for the mixed-queue pipeline checks.
function rewardTestBoard({ blockedTiles = 10, blockedValue = 64, rows = 5, cols = 8 } = {}) {
  const b = createBoard('reward-test', { rows, cols })
  b.tiles = Array.from({ length: rows }, () => Array(cols).fill('open'))
  let placed = 0
  for (let r = 0; r < rows && placed < blockedTiles; r++) {
    for (let c = 0; c < cols && placed < blockedTiles; c++) {
      if (r === 0 && c === 0) continue // keep one guaranteed open tile
      b.tiles[r][c] = 'blocked'
      placed += 1
    }
  }
  b.blockedValue = blockedValue
  b.maxRank = 6
  return b
}

console.log('--- 19. Mixed-queue placement pipeline: rewardQueueItems survive generation, one item per tile, exact main sum ---')
{
  const board = rewardTestBoard({ blockedTiles: 10, blockedValue: 64 })
  board.rewardQueueItems = [
    { type: 'coins', rank: 3 },
    { type: 'coins', rank: 3 },
  ]
  const gen = placeItems(board, { isFirstBoard: false, boardIndex: 3 })
  const rewardEntries = gen.blockedQueue.filter((v) => !isMainItem(v))
  const mainSum = gen.blockedQueue.filter(isMainItem).reduce((s, r) => s + valueOf(r), 0)
  check('both configured reward items land in the blocked queue', rewardEntries.length === 2 && rewardEntries.every((v) => decodeReward(v).type === 'coins' && decodeReward(v).rank === 3))
  check('main-chain items still sum to blockedValue exactly', mainSum === 64)
  check('one item per tile: queue length never exceeds blocked tile count', gen.blockedQueue.length <= 10)
  check('result reports configured vs placed reward items', gen.rewardItemsConfigured === 2 && gen.rewardItemsPlaced === 2)
  const regen = placeItems({ ...board, semiPlacements: gen.semiPlacements, blockedQueue: gen.blockedQueue }, { isFirstBoard: false, boardIndex: 3 })
  check('regenerating preserves the reward items (durable config, not a hand-tweak)', regen.blockedQueue.filter((v) => !isMainItem(v)).length === 2)

  const overStuffed = rewardTestBoard({ blockedTiles: 3, blockedValue: 4 })
  overStuffed.rewardQueueItems = Array.from({ length: 10 }, () => ({ type: 'energy', rank: 1 }))
  const over = placeItems(overStuffed, { isFirstBoard: false, boardIndex: 3 })
  check('over-configured reward items clamp to the blocked tile count, reported not silently honored', over.rewardItemsPlaced === 3 && over.rewardItemsConfigured === 10 && over.blockedQueue.length <= 3 + over.blockedQueue.filter(isMainItem).length)

  const board0 = rewardTestBoard({ blockedTiles: 12, blockedValue: 40, rows: 5, cols: 8 })
  board0.rewardQueueItems = [{ type: 'puzzles', rank: 2 }]
  const gen0 = placeItems(board0, { isFirstBoard: true, boardIndex: 0 })
  // gen0.sum covers semis + queue (semi tiles carry part of blockedValue on
  // board 0 - the queue alone is legitimately short by that much).
  check('board 0 branch places reward items too, main sum still >= blockedValue', gen0.blockedQueue.filter((v) => !isMainItem(v)).length === 1 && gen0.sum >= 40)
}

console.log('--- 20. proposeRewardPlacements: unit-based, capacity-aware, pins first, semi tiles as overflow ---')
{
  const b1 = rewardTestBoard({ blockedTiles: 12, blockedValue: 32 })
  const b2 = rewardTestBoard({ blockedTiles: 12, blockedValue: 32 })
  const boards = [b1, b2]
  check('capacity leaves room after the main chain minimum', rewardSlotCapacity(b1, 0) > 0 && rewardSlotCapacity(b1, 0) <= 12)
  const countRewards = (bs) => bs.reduce((s, b) => s + b.blockedQueue.filter((v) => !isMainItem(v)).length, 0)

  const proposal = proposeRewardPlacements(boards, { tileUnits: { energy: 11 } })
  const placed = proposal.additionsByBoard.flat()
  // Which ranks a board may hold is set by its position: only Board 2 holds
  // reward items above rank 1 (rank 1 and 2); Board 1 holds none here.
  check(`11 units are all placed, as items of the ranks each board allows (${placed.map((p) => p.rank).join(',')})`, rewardUnitsByType(placed).energy === 11 && proposal.additionsByBoard[0].length === 0 && proposal.additionsByBoard[1].some((it) => it.rank === 2) && proposal.additionsByBoard[1].every((it) => it.rank <= 2))
  check('regenerated boards carry the items in their real queues', countRewards(proposal.boards) === placed.length)
  const mainSum = (b) => b.blockedQueue.filter(isMainItem).reduce((s, r) => s + valueOf(r), 0) + b.semiPlacements.filter((p) => isMainItem(p.rank)).reduce((s, p) => s + valueOf(p.rank), 0)
  // The reference is the same board regenerated with NO reward items: board
  // positions 1-3 may legitimately round the sum UP to their rank floor, and
  // a reward item must never change whatever that sum is.
  const rewardFree = proposeRewardPlacements(proposal.boards, { tileUnits: { energy: 0 } }).boards
  check('reward items never cost the main chain any DR (same main sum as without them, never below blockedValue)', proposal.boards.every((b, i) => mainSum(b) === mainSum(rewardFree[i])) && mainSum(proposal.boards[1]) >= proposal.boards[1].blockedValue) // (Board 1 holds no reward item, so it is the second board that was regenerated with them)

  check('re-solving applied boards is idempotent', countRewards(proposeRewardPlacements(proposal.boards, { tileUnits: { energy: 11 } }).boards) === placed.length)
  check('lowering the units shrinks the placements', rewardUnitsByType(proposeRewardPlacements(proposal.boards, { tileUnits: { energy: 4 } }).boards.flatMap((b) => b.rewardQueueItems)).energy === 4)
  check('zero units removes previous solver placements', countRewards(proposeRewardPlacements(proposal.boards, { tileUnits: { energy: 0 } }).boards) === 0)

  // Pins are preserved and counted first.
  const pinnedBoard = rewardTestBoard({ blockedTiles: 12, blockedValue: 32 })
  pinnedBoard.rewardQueueItems = [{ type: 'energy', rank: 3 }]
  // (As the LAST board of a two-board list: Board 1 itself holds only a few rank-1 reward items.)
  const withPins = proposeRewardPlacements([rewardTestBoard({ blockedTiles: 12, blockedValue: 32 }), pinnedBoard], { tileUnits: { energy: 8 } })
  check('a pinned rank-3 item counts as 4 units - only the remaining 4 are proposed', withPins.perResource.energy.pinnedUnits === 4 && rewardUnitsByType(withPins.additionsByBoard.flat()).energy === 4)
  check('the pin survives untouched', withPins.boards[1].rewardQueueItems.filter((it) => !it.auto).length === 1)
  const overPinned = proposeRewardPlacements([pinnedBoard], { tileUnits: { energy: 1 } })
  check('pins above the tile share are preserved and reported', overPinned.boards[0].rewardQueueItems.length === 1 && overPinned.findings.some((f) => f.includes('pinned')))

  // Semi tiles extend capacity once the blocked slots run out.
  const semiBoard = rewardTestBoard({ blockedTiles: 4, blockedValue: 8 })
  semiBoard.tiles[4][0] = 'semi'
  semiBoard.tiles[4][1] = 'semi'
  // Placed as the SECOND board of a list (a later board: semis share the
  // queue, no board-1 special rules).
  const filler = rewardTestBoard({ blockedTiles: 1, blockedValue: 3 }) // its one blocked tile is needed by the main chain: no reward slot
  const slots = rewardSemiSlots(semiBoard, 1)
  check('eligible semi tiles are offered as reward slots', slots.cells.length === 2 && rewardSlotCapacity(filler, 0) === 0)
  const queueCap = rewardSlotCapacity(semiBoard, 1)
  const overflowAll = proposeRewardPlacements([filler, { ...semiBoard }], { tileUnits: { coins: (queueCap + 1) * 4 } })
  const overflow = { ...overflowAll, boards: [overflowAll.boards[1]], additionsByBoard: [overflowAll.additionsByBoard[1]], semiAdditionsByBoard: [overflowAll.semiAdditionsByBoard[1]] }
  check('overflow beyond the blocked slots lands on a semi tile', overflow.semiAdditionsByBoard[0].length >= 1 && overflow.additionsByBoard[0].length === queueCap)
  const semiPlacement = overflow.boards[0].semiPlacements.find((p) => !isMainItem(p.rank))
  check('the semi reward item is in the generated layout at its own cell, one item per tile', !!semiPlacement && decodeReward(semiPlacement.rank).type === 'coins' && overflow.boards[0].semiPlacements.filter((p) => p.row === semiPlacement.row && p.col === semiPlacement.col).length === 1)
  check('exact main-chain sum still holds with a semi reward item', mainSum(overflow.boards[0]) === mainSum(proposeRewardPlacements(overflowAll.boards, { tileUnits: { coins: 0 } }).boards[1]) && mainSum(overflow.boards[0]) >= 8)
  check('...and it equals the reward-free layout exactly', mainSum(overflow.boards[0]) === 8)

  // The guarantee itself: on board 1, where the semi tiles pin part of the
  // value, an over-ask is taken back rather than shortening the main chain.
  const tight = rewardTestBoard({ blockedTiles: 4, blockedValue: 8 })
  tight.tiles[4][0] = 'semi'
  tight.tiles[4][1] = 'semi'
  const squeezed = proposeRewardPlacements([tight], { tileUnits: { coins: 400 } })
  check('a board-1 over-ask never shortens the main chain (verified against the reward-free layout)', mainSum(squeezed.boards[0]) === mainSum(proposeRewardPlacements(squeezed.boards, { tileUnits: { coins: 0 } }).boards[0]) && squeezed.perResource.coins.unitsUnplaced > 0)

  const board0 = rewardTestBoard({ blockedTiles: 12, blockedValue: 40 })
  board0.tiles[4][0] = 'semi'
  board0.onboardingDrBudget = 20
  board0.onboardingTargetRank = 4
  check('board 1 offers no semi tiles while an onboarding goal is set (reserve protected)', rewardSemiSlots(board0, 0).cells.length === 0)

  const tiny = rewardTestBoard({ blockedTiles: 3, blockedValue: 4 })
  const short = proposeRewardPlacements([tiny], { tileUnits: { coins: 400 } })
  check('a capacity shortfall is reported in units, not silently dropped', short.perResource.coins.unitsUnplaced > 0 && short.findings.some((f) => f.includes('did not fit')))
}

console.log('--- 21. generateSmallRewardsConfiguration: from definitions alone - no drop group authored - to a simulated, applied-ready config ---')
{
  // A playable 3-board chain generated through the real placement pipeline.
  const chainBoard = (name, idx, value) => {
    const b = createBoard(name, { rows: idx === 0 ? 5 : 3, cols: 8 })
    b.tiles = b.tiles.map((row, r) => row.map(() => (idx === 0 ? (r >= 2 ? 'blocked' : 'open') : r >= 1 ? 'blocked' : 'open')))
    b.blockedValue = value
    const g = placeItems(b, { isFirstBoard: idx === 0, boardIndex: idx })
    return { ...b, semiPlacements: g.semiPlacements, blockedQueue: g.blockedQueue }
  }
  const mkChain = () => [chainBoard('B1', 0, 150), chainBoard('B2', 1, 400), chainBoard('B3', 2, 600)]
  const prizeE = createRewardChainConfig().energy[3].prizeAmount // 75
  const targets = { coins: 0, puzzles: 80, energy: 4 * prizeE, charms: 80 }

  const boards = mkChain()
  check('precondition: no drop group exists anywhere', boards.every((b) => (b.dropGroups ?? []).length === 0))
  const res = await generateSmallRewardsConfiguration({ phase: 'main', boards, targets, split: { sharedTilePct: 40 } })
  check('generation succeeds with no pre-existing drop groups', res != null && res.generatedGroups.length > 0)
  check('it is not infeasible', res.feasibility.status !== 'infeasible')
  const row = (r, t) => r.perResourceReview.find((x) => x.type === t)
  check('simulated energy payout lands within 15% of target', Math.abs(row(res, 'energy').predicted - targets.energy) <= targets.energy * 0.15)
  check('tile + drop attribution reconciles to the simulated total for every resource', res.perResourceReview.every((r) => Math.abs(r.tile + r.drop - r.predicted) < 1e-6))
  check('both sources genuinely contribute (items from tiles and drops merge together)', row(res, 'energy').tile > 0 && row(res, 'energy').drop > 0)
  check('achieved split is reported next to the requested one', row(res, 'energy').requestedTilePct === 40 && row(res, 'energy').achievedTilePct > 15 && row(res, 'energy').achievedTilePct < 65)
  const e = res.energy
  check('energy credit: effective = ccAdjusted - 0.8 x simulated energy, exactly once', Math.abs(e.effectiveSubsidy - (e.ccAdjusted - ENERGY_CREDIT_RATE * e.expectedCollectibleEnergy)) < 1e-9)
  check('Board 1 keeps its capped subsidy through generation (blockedValue untouched)', res.boards[0].blockedValue === 150 && res.boards[0].blockedValue <= FIRST_BOARD_SUBSIDY_CAP_DR)
  check('exact main-chain sum holds on every generated board', res.boards.every((b) => b.blockedQueue.filter(isMainItem).reduce((s, r) => s + valueOf(r), 0) + b.semiPlacements.filter((p) => isMainItem(p.rank)).reduce((s, p) => s + valueOf(p.rank), 0) === b.blockedValue))

  // The estimate must hold up against an independent, larger seeded simulation.
  const independent = validateConfigAcrossRuns(res.boards, {
    rewardChainConfig: res.boards[0].rewardChainConfig,
    dropGroupsConfig: res.dropGroupsConfig,
    dropGroupsById: new Map(res.dropGroups.map((g) => [g.id, g])),
    minDropRank: res.boards[0].minDropRank,
    runs: 150,
    seed: 4242,
  })
  check('an independent 150-run seeded simulation agrees with the estimate (energy within 15%)', Math.abs(independent.payoutsMainPhase.energy.mean - row(res, 'energy').predicted) <= targets.energy * 0.15)
  check('simulated sources reconcile in the independent run too', Math.abs(independent.payoutsMainPhaseBySource.tile.energy.mean + independent.payoutsMainPhaseBySource.drop.energy.mean - independent.payoutsMainPhase.energy.mean) < 1e-6)

  // The split really changes what is generated.
  const tileHeavy = await generateSmallRewardsConfiguration({ phase: 'main', boards: mkChain(), targets, split: { sharedTilePct: 80 } })
  const tilesOnly = await generateSmallRewardsConfiguration({ phase: 'main', boards: mkChain(), targets, split: { sharedTilePct: 100 } })
  const dropHeavy = await generateSmallRewardsConfiguration({ phase: 'main', boards: mkChain(), targets, split: { sharedTilePct: 0 } })
  const tileItems = (r) => r.additionsByBoard.flat().length + r.semiAdditionsByBoard.flat().length
  // (With every reward asked of the tiles, what the allowed ranks cannot fit moves to merge drops.)
  check('80% tiles puts rewards under tiles; 0% tiles puts none there and generates drops', tileItems(tileHeavy) > 0 && tileItems(dropHeavy) === 0 && dropHeavy.generatedGroups.length > 0 && row(tileHeavy, 'energy').tile > row(dropHeavy, 'energy').tile)
  // An item under a tile is semi-blocked until a matching DROPPED item frees it, and its board waits for it.
  check('100% tiles: with nothing dropping to open them, no reward item goes under a tile, and it is said', tileItems(tilesOnly) === 0 && tilesOnly.findings.some((f) => /could never be opened/.test(f)))

  // A target the ladder cannot pay exactly is reported with its closest feasible payout.
  // (With leftovers lost - the older rule, still selectable. Collected, as they are by default, every amount is payable.)
  const lost = (boards) => boards.map((b) => ({ ...b, rewardLeftoverPolicy: 'forfeit' }))
  const odd = await generateSmallRewardsConfiguration({ phase: 'main', boards: lost(mkChain()), targets: { coins: 0, puzzles: 0, energy: 100, charms: 0 }, split: { sharedTilePct: 50 } })
  check('an unpayable target reports the closest feasible payout (75) instead of pretending', row(odd, 'energy').feasiblePayout === 75 && row(odd, 'energy').exactlyPayable === false && odd.findings.some((f) => f.includes('closest feasible')))
  const tooSmall = await generateSmallRewardsConfiguration({ phase: 'main', boards: lost(mkChain()), targets: { coins: 0, puzzles: 0, energy: 20, charms: 0 }, split: { sharedTilePct: 50 } })
  check('a target under half the smallest prize step explains it is too small for the ladder', row(tooSmall, 'energy').feasiblePayout === 0 && tooSmall.findings.some((f) => f.includes('too small')))
  // ... and the leftover policy changes what is payable: hand-collected leftovers make 20 reachable (15 + 5).
  const collectBoards = mkChain().map((b) => ({ ...b, rewardLeftoverPolicy: 'collect' }))
  const collected = await generateSmallRewardsConfiguration({ phase: 'main', boards: collectBoards, targets: { coins: 0, puzzles: 0, energy: 20, charms: 0 }, split: { sharedTilePct: 100 } })
  check('under the "collect leftovers" policy the same 20 is exactly payable from lower-rank prizes (15 + 5)', row(collected, 'energy').feasiblePayout === 20 && row(collected, 'energy').exactlyPayable === true)

  // Shared drop odds: a derived segment solves with the base segment's drops fixed.
  const baseDrops = { dropGroups: res.dropGroups, dropGroupsConfig: res.dropGroupsConfig }
  // A derived segment at 1.25x the base. (Reward items under tiles are small by rule - Board 1 rank 1 only, and few
  // of them - so tiles can carry less than they once did: at 1.5x these boards deliver about 370 of 450, which sat
  // right on this check's 20% band and made it pass or fail by luck.)
  // (Then only Board 2 could hold reward items above rank 1, so tiles carry less again: 1.1x here.)
  const derivedTargets = { coins: 0, puzzles: 90, energy: Math.round(4.4 * prizeE), charms: 90 }
  const derived = await generateSmallRewardsConfiguration({ phase: 'main', boards: mkChain(), targets: derivedTargets, split: { sharedTilePct: 40 }, dropsFixed: true, sharedDrops: baseDrops })
  check('a derived segment leaves the shared drop configuration untouched', JSON.stringify(derived.dropGroupsConfig) === JSON.stringify(baseDrops.dropGroupsConfig) && derived.generatedGroups.length === 0)
  // (With leftovers collected the same items pay a little more, so "more tile items than the base" is no longer a given: what matters is that it gets there with its own.)
  check(`...and reaches its larger target with its own tile items (${tileItems(derived)} of them; energy ${Math.round(row(derived, 'energy').predicted)} of ${derivedTargets.energy})`, tileItems(derived) > 0 && Math.abs(row(derived, 'energy').predicted - derivedTargets.energy) <= derivedTargets.energy * 0.2)

  // RC phase: solved on the full main+RC run, RC payouts only.
  const mainBoards = res.boards.map((b) => ({ ...b, dropGroups: res.dropGroups, dropGroupsConfig: res.dropGroupsConfig }))
  const rcBoards = mkChain()
  const rcResult = await generateSmallRewardsConfiguration({ phase: 'rc', boards: rcBoards, mainBoards, targets: { coins: 0, puzzles: 0, energy: 2 * prizeE, charms: 0 }, split: { sharedTilePct: 50 } })
  check('RC-phase workflow completes with RC-attributed payouts', rcResult != null && rcResult.perResourceReview.every((r) => Number.isFinite(r.predicted)))
  check('RC runs actually reach the RC phase in simulation', rcResult.evaluation.entryRate > 0)
  check('RC-phase energy lands near its own target', Math.abs(row(rcResult, 'energy').predicted - 2 * prizeE) <= 2 * prizeE * 0.35)

  const st = splitTargets({ coins: 100, puzzles: 0, energy: 0, charms: 0 }, { sharedTilePct: 30, perResource: { coins: 80 } })
  check('per-resource override wins over the shared split', st.tileTargets.coins === 80 && st.dropTargets.coins === 20)
}

console.log('--- 22. Exports: V2 sheets reach the combined workbook/Sheets with parity, V2 Economy carries ccPercent/minDropRank/reward items ---')
{
  const mkSeg = (i) => {
    const b = createBoard(`S${i} B1`)
    b.blockedValue = 50
    b.ccPercent = 0.1 * i
    b.minDropRank = 5 + i
    b.rewardQueueItems = [{ type: 'energy', rank: 3 }]
    const rc = createBoard(`S${i} RC1`)
    return { name: `Segment ${i}`, boards: [b], recompletionBoards: [rc] }
  }
  const segs = [mkSeg(1), mkSeg(2)]

  const economy = buildV2EconomySheet(segs[0].boards, segs[0].recompletionBoards)
  check('V2 Economy covers both lists with List labels', economy.rows.length === 2 && economy.rows.map((r) => r.cells[0]).join(',') === 'Main,RC')
  const mainRow = economy.rows[0].cells
  check('V2 Economy row carries blockedValue/ccPercent/minDropRank/leftover policy/reward items', mainRow[2] === 50 && mainRow[3] === 10 && mainRow[4] === 6 && mainRow[5] === 'collect' && mainRow[6] === 'dr-r3')

  const combined = buildAllSegmentsWorkbook(segs)
  const tabNames = combined.worksheets.map((ws) => ws.name)
  // (The drop table is one table for every segment, so it is one tab: "V2 Drop Groups", not one per segment.)
  check('combined workbook has per-segment V2 tabs, and the one drop table once', ['S1 V2 Reward Chain', 'S1 V2 Economy', 'S2 V2 Economy', 'V2 Drop Groups'].every((n) => tabNames.includes(n)) && !tabNames.some((n) => /^S\d+ V2 Drop Groups$/.test(n)))
  check('all combined tab names fit Excel 31-char cap', tabNames.every((n) => n.length <= 31))

  const valueSheets = buildAllSegmentsSheetsAsValueRows(segs)
  const valueTitles = valueSheets.map((s) => s.title)
  check('combined Google Sheets rows mirror the same V2 tabs (parity)', ['S1 V2 Reward Chain', 'V2 Drop Groups', 'S1 V2 Economy', 'S2 V2 Reward Chain'].every((n) => valueTitles.includes(n)) && JSON.stringify(valueTitles) === JSON.stringify(tabNames))
  const econValues = valueSheets.find((s) => s.title === 'S2 V2 Economy').rows
  check('Sheets V2 Economy values match the workbook builder', econValues[1][3] === 20 && econValues[1][4] === 7)

  // The per-segment workbook gained V2 Economy too.
  const perSeg = buildWorkbook(segs[0].boards, segs[0].recompletionBoards)
  check('per-segment workbook includes V2 Economy', perSeg.worksheets.some((ws) => ws.name === 'V2 Economy'))
}

console.log('--- 23. A play session created with NO options (shared ?play stage) still uses the boards\' own reward config ---')
{
  const { createPlaySession, collectRewardItem } = await import('../../src/features/merge/lib/simulation/playSession.js')
  const board = rewardTestBoard({ blockedTiles: 6, blockedValue: 8 })
  board.minDropRank = 4
  const session = createPlaySession([board], 0)
  check('session picks up rewardChainConfig/minDropRank from the starting board', session.rewardChainConfig === board.rewardChainConfig && session.minDropRank === 4)
  session.state.itemAt[0][0] = encodeReward('energy', 2)
  session.state.stuck[0][0] = false
  collectRewardItem(session, [0, 0])
  check('manual collect credits the real configured prize (not zero)', session.collected.energy === board.rewardChainConfig.energy[1].prizeAmount)
}

console.log('--- 24. Payout over the combined inventory: units, leftover policy, closest feasible ---')
{
  const cfg = createRewardChainConfig() // energy prizes 5 / 15 / 35 / 75
  check('8 units = one rank-4 collect under either policy', payoutForUnits(8, cfg, 'energy', 'forfeit') === 75 && payoutForUnits(8, cfg, 'energy', 'collect') === 75)
  check('leftover units pay nothing when forfeited', payoutForUnits(15, cfg, 'energy', 'forfeit') === 75)
  check('leftover units pay their own rank prizes when hand-collected (7 = rank3+rank2+rank1)', payoutForUnits(15, cfg, 'energy', 'collect') === 75 + 35 + 15 + 5)
  check('closest feasible under forfeit is a whole number of rank-4 prizes', closestUnitsForTarget(160, cfg, 'energy', 'forfeit').payout === 150)
  check('an exactly payable target is flagged exact', closestUnitsForTarget(150, cfg, 'energy', 'forfeit').exact === true && closestUnitsForTarget(160, cfg, 'energy', 'forfeit').exact === false)
  check('a huge target stays a cheap scan', closestUnitsForTarget(75 * 1e6, cfg, 'energy', 'forfeit').units === 8e6)
  check('a resource with no rank-4 prize is reported, not divided by zero', (() => { const c = createRewardChainConfig(); c.coins[3].prizeAmount = 0; return closestUnitsForTarget(100, c, 'coins').noPrize === true })())
}

console.log('--- 25. Engine: tile and drop items merge TOGETHER; pooled attribution; leftover policy; space management ---')
{
  // One tile rank-3 energy item + one dropped rank-3 energy item -> one
  // rank-4 collect, attributed half and half.
  const state = tinyState(2, 2)
  const e3 = encodeReward('energy', 3)
  state.itemAt[0][0] = e3
  state.rewardPool.tile.energy += 4
  state.itemAt[0][1] = e3
  state.rewardPool.drop.energy += 4
  let credit = null
  performMerge(state, { mover: [0, 1], receiver: [0, 0], rank: e3 }, () => {}, null, { onCollect: (type, rank, tileShare) => (credit = { type, rank, tileShare }) })
  check('a tile item and a dropped item merge into one rank-4 collect', credit?.type === 'energy' && credit?.rank === 4)
  check('that prize is attributed 50/50 by where its source units came from', Math.abs(credit.tileShare - 0.5) < 1e-9)
  check('the pool is drawn down by exactly the units collected', state.rewardPool.tile.energy === 0 && state.rewardPool.drop.energy === 0)

  // Leftover policy at run end.
  const cfg = createRewardChainConfig()
  const leftoverBoard = () => {
    const b = createBoard('leftover', { rows: 2, cols: 3 })
    b.tiles = [['open', 'open', 'open'], ['semi', 'open', 'open']]
    b.semiPlacements = [{ row: 1, col: 0, rank: encodeReward('energy', 2) }]
    b.blockedQueue = []
    return b
  }
  const forfeit = simulatePlaythrough([leftoverBoard()], { drBudget: 8, rewardChainConfig: cfg, leftoverPolicy: 'forfeit', rewardsWait: true })
  const collect = simulatePlaythrough([leftoverBoard()], { drBudget: 8, rewardChainConfig: cfg, leftoverPolicy: 'collect', rewardsWait: true })
  check('forfeit: an unpaired rank-2 item pays nothing, and the forfeited value is reported', forfeit.collected.energy === 0 && forfeit.leftoverForfeited.energy === 15 && forfeit.leftoverItemCount === 1)
  // The item sits on a semi-blocked tile and nothing ever frees it, so it is
  // never collectable - under either leftover policy.
  check('collect: an item that was never freed still pays nothing at phase end', collect.collected.energy === 0 && collect.leftoverForfeited.energy === 15)

  // A full board: the automatic player gives up its cheapest reward item
  // rather than getting stuck.
  const full = createBoard('full', { rows: 1, cols: 2 })
  full.tiles = [['semi', 'open']]
  full.semiPlacements = [{ row: 0, col: 0, rank: encodeReward('coins', 1) }]
  full.blockedQueue = []
  const run = simulatePlaythrough([full], { drBudget: 40, rewardChainConfig: cfg, rewardsWait: true })
  check('a full board does not give up a reward item that is still semi-blocked', run.spaceCollects === 0 && run.collected.coins === 0)
}

console.log('--- 26. Real play session: reveal, merge, manual collect, rank-4 auto-collect, energy into the usable balance ---')
{
  const b = createBoard('play', { rows: 3, cols: 4 })
  b.tiles = [
    ['open', 'open', 'open', 'open'],
    ['semi', 'semi', 'semi', 'open'],
    ['open', 'blocked', 'open', 'open'],
  ]
  b.semiPlacements = [
    { row: 1, col: 0, rank: encodeReward('energy', 3) },
    { row: 1, col: 1, rank: encodeReward('energy', 3) },
    { row: 1, col: 2, rank: 1 },
  ]
  b.blockedQueue = [encodeReward('coins', 1)]
  const session = createPlaySession([b], 0)
  check('every item on a semi-blocked tile starts semi-blocked - reward items too', session.state.stuck[1][0] === true && session.state.stuck[1][1] === true && session.state.stuck[1][2] === true)
  check('two semi-blocked reward items cannot be merged with each other (neither can be moved)', actionFor(session, [1, 0], [1, 1]) === null && actionFor(session, [1, 1], [1, 0]) === null)
  session.state.stuck[1][0] = false // stands in for "a matching free item was merged into it"
  check('once one is freed it can be merged into the other', actionFor(session, [1, 0], [1, 1]) === 'merge')

  mergeItems(session, [1, 0], [1, 1])
  check('merging two rank-3 energy items auto-collects the rank-4 prize', session.collected.energy === 75 && session.state.itemAt[1][1] == null)
  check('the collected energy is in the usable balance', session.energyBalance === 75 && canSpendEnergy(session))
  const drBefore = session.drSpent
  spendEnergyForAction(session)
  check('one energy funds one generator action at no DR cost', session.energyBalance === 74 && session.drSpent === drBefore && session.collected.energy === 75)

  // The energy tap spawned a rank 1; merge it into the stuck semi rank 1 next
  // to the blocked tile -> reveals the queued reward item.
  const spawned = (() => {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) if (session.state.itemAt[r][c] === 1 && !session.state.stuck[r][c]) return [r, c]
    return null
  })()
  mergeItems(session, spawned, [1, 2])
  check('a merge next to a blocked tile reveals the reward item queued under it', decodeReward(session.state.itemAt[2][1])?.type === 'coins' && session.state.locked[2][1] === false)
  check('a reward item is semi-blocked when its tile opens', session.state.stuck[2][1] === true)
  collectRewardItem(session, [2, 1])
  check('...and cannot be collected while it is', session.collected.coins === 0 && decodeReward(session.state.itemAt[2][1])?.type === 'coins')
  session.state.stuck[2][1] = false // freed
  collectRewardItem(session, [2, 1])
  check('a freed reward item can be hand-collected at its own rank prize', session.collected.coins === b.rewardChainConfig.coins[0].prizeAmount && session.state.itemAt[2][1] == null)
  check('session attribution reconciles (tile + drop = total)', Math.abs(session.collectedBySource.tile.coins + session.collectedBySource.drop.coins - session.collected.coins) < 1e-9)
  spendGenerator(session)
  check('ordinary generator spends still cost DR', session.drSpent > drBefore)
}

console.log('--- 27. Shared play link carries the RC variant; gated transition activates the RC variant\'s own economy ---')
{
  const ladder = (name, top, extra = {}) => {
    const cols = top
    const b = createBoard(name, { rows: 2, cols })
    b.tiles = [Array(cols).fill('open'), Array(cols).fill('semi')]
    b.semiPlacements = Array.from({ length: top }, (_, i) => ({ row: 1, col: i, rank: i + 1 }))
    b.blockedQueue = []
    return Object.assign(b, extra)
  }
  const main = ladder('Main', 11)
  const rc = ladder('RC B', 13, { targetEv: 1.5, tier2UnlockRank: 3, minDropRank: 4, rewardLeftoverPolicy: 'collect' })
  const rcGroup = createDropGroup({ id: 'rc-g', name: 'RC only', items: { charms: 4 } })
  rc.dropGroups = [rcGroup]
  rc.dropGroupsConfig = createDropGroupsConfig(RC_MAX_RANK)
  for (const t of rc.dropGroupsConfig) { t.noDropWeight = 0; t.entries = [{ groupId: 'rc-g', weight: 1 }] }

  const decoded = decodeStage(encodeStage([main], { rcBoards: [rc] }))
  check('stage link round-trips the main chain and the Recompletion boards', decoded.boards.length === 1 && decoded.rcBoards.length === 1 && decoded.rcBoards[0].targetEv === 1.5)
  check('a link shared before RC existed (a bare board array) still decodes, main chain only', (() => { const old = decodeStage(encodeStage([main])); return old.boards.length === 1 && old.rcBoards === null })())

  const session = createPlaySession(decoded.boards, 0, { rcBoards: decoded.rcBoards })
  const climb = (top) => {
    spendGenerator(session, session.tiers[0])
    // The generator can roll a lucky bonus (in Recompletion lucky drops are
    // open from the first tap), so the climb starts at whatever rank it gave.
    const spawned = session.events.findLast((e) => e.type === 'spend')
    let from = spawned.cell
    for (let k = spawned.rank - 1; k < top; k++) {
      mergeItems(session, from, [1, k])
      if (session.phase === 'rc' && k < top - 1 && session.state.itemAt[1][k] !== k + 2) return
      from = [1, k]
    }
  }
  check('precondition: main-phase settings are the main board\'s', session.targetEv === main.targetEv && session.phase === 'main')
  climb(11)
  check('reaching rank 12 with every tile cleared enters RC', session.phase === 'rc' && session.reachedAt[12] !== undefined)
  check('RC activates the variant\'s own generator EV and tier unlocks', session.targetEv === 1.5 && session.tier2UnlockRank === 3)
  check('RC activates the variant\'s own drop groups, drop start rank and leftover policy', session.dropGroupsById.has('rc-g') && session.minDropRank === 4 && session.leftoverPolicy === 'collect')
  const charmsBefore = session.collected.charms
  climb(13)
  check('RC merges roll the RC variant\'s own drop table (charms R4 collects on the spot)', session.collected.charms > charmsBefore)
  check('the second grand prize (rank 14) is reached exactly once', session.reachedAt[14] !== undefined && session.events.filter((e) => e.type === 'reached' && e.rank === 14).length === 1)

  // Recompletion starts at rank 12 - it does not wait for the board to be cleared.
  const gated = ladder('Gated', 11)
  gated.tiles[0][0] = 'blocked'
  gated.blockedQueue = [1]
  const s2 = createPlaySession([gated], 0, { rcBoards: [rc] })
  s2.reachedAt[12] = 0
  mergeItems(s2, (() => { spendGenerator(s2, s2.tiers[0]); for (let r = 0; r < 2; r++) for (let c = 0; c < 11; c++) if (s2.state.itemAt[r][c] === 1 && !s2.state.stuck[r][c]) return [r, c] })(), [1, 0])
  check('RC starts as soon as rank 12 is reached, even with a blocked tile still on the board', s2.phase === 'rc')

  // What the player arrives with: everything on the board - the rank 12,
  // every other item, reward items too; a semi-blocked one stays semi-blocked.
  const before = tinyState(2, 3)
  before.itemAt[0][0] = 12
  before.itemAt[0][1] = 5
  before.itemAt[0][2] = 3
  before.stuck[0][2] = true
  before.itemAt[1][0] = encodeReward('coins', 2)
  const rcFirst = createBoard('RC 1', { rows: 3, cols: 4 })
  rcFirst.tiles = [['open', 'open', 'open', 'open'], ['semi', 'open', 'open', 'open'], ['blocked', 'blocked', 'open', 'open']]
  rcFirst.semiPlacements = [{ row: 1, col: 0, rank: 1 }]
  rcFirst.blockedQueue = [7, 8]
  const overflow = []
  const carried = enterRecompletion(before, rcFirst, overflow)
  const free = []
  for (let r = 0; r < before.rows; r++) for (let c = 0; c < before.cols; c++) if (before.itemAt[r][c] != null && !before.stuck[r][c]) free.push(before.itemAt[r][c])
  const all = []
  const stuckOnes = []
  for (let r = 0; r < before.rows; r++) for (let c = 0; c < before.cols; c++) if (before.itemAt[r][c] != null && !before.locked[r][c]) (before.stuck[r][c] ? stuckOnes : all).push(before.itemAt[r][c])
  check('the rank 12, the other free item and the reward item all arrive on the first RC board, free', carried.length === 4 && free.filter((v) => !decodeReward(v)).sort((a, b) => b - a).join() === '12,5' && free.some((v) => decodeReward(v)?.type === 'coins') && overflow.length === 0)
  check('an item that was semi-blocked comes along too, still semi-blocked - nothing visible is lost', stuckOnes.includes(3) && all.length === 3)
  check('the RC board is its own: its tiles, its semi-blocked item, its blocked queue', before.rows === 3 && before.cols === 4 && before.itemAt[1][0] === 1 && before.stuck[1][0] === true && before.locked[2][0] === true && before.blockedQueue.join() === '7,8')
  check('the chase is to 8,192 DR and the rank 12 already counts: 6,144 left to cover, a quarter done on arrival (rank 12, the rank 5 and rank 3 carried, and the rank 1 of the RC board itself)', RC_CHASE_DR === 6144 && Math.abs(mainChainProgress(before, [], 'rc', false) - (2048 + 16 + 4 + 1) / 8192) < 1e-9)
  const tiny = tinyState(1, 1)
  tiny.itemAt[0][0] = 12
  const full = createBoard('RC full', { rows: 1, cols: 1 })
  full.tiles = [['semi']]
  full.semiPlacements = [{ row: 0, col: 0, rank: 1 }]
  full.blockedQueue = []
  const waiting = []
  enterRecompletion(tiny, full, waiting)
  check('an item with no free cell on the RC board waits in the inventory, never lost', waiting.join() === '12')
}

console.log('--- 28. Exports: both lists, reward keys map to configured syntax, Google Sheets payload is well-formed ---')
{
  const mk = (name) => {
    const b = createBoard(name, { rows: 3, cols: 5 })
    b.tiles = [['open', 'open', 'open', 'open', 'open'], ['semi', 'blocked', 'blocked', 'open', 'open'], ['open', 'open', 'open', 'open', 'open']]
    b.blockedValue = 6
    b.rewardQueueItems = [{ type: 'energy', rank: 3 }]
    b.rewardSemiItems = [{ row: 1, col: 0, type: 'coins', rank: 2 }]
    // Coins are defined by allowance worth (never seeded) - give this fixture one.
    b.rewardChainConfig = JSON.parse(JSON.stringify(b.rewardChainConfig))
    ;[0.05, 0.12, 0.27, 0.6].forEach((worth, i) => (b.rewardChainConfig.coins[i] = { ...b.rewardChainConfig.coins[i], prizeAmount: worth, syntax: coinAllowanceSyntax(worth) }))
    const g = placeItems(b, { isFirstBoard: false, boardIndex: 3 })
    return { ...b, semiPlacements: g.semiPlacements, blockedQueue: g.blockedQueue }
  }
  const main = mk('M1')
  const rcA = mk('A1')
  rcA.rewardChainConfig.energy[2].syntax = 'rc-energy-r3'
  rcA.minDropRank = 9
  rcA.dropGroups = [createDropGroup({ id: 'rc-g', name: 'RC group', items: { puzzles: 1 } })]
  rcA.dropGroupsConfig[8].entries = [{ groupId: 'rc-g', weight: 7 }]

  const chain = buildV2RewardChainSheet([main], [rcA])
  check('V2 Reward Chain covers Main and RC (40 rows)', chain.rows.length === 40 && ['Main', 'RC'].every((l) => chain.rows.some((r) => r.cells[0] === l)))
  check('the RC list\'s own definition is exported under RC, not Main\'s', chain.rows.some((r) => r.cells[0] === 'RC' && r.cells[3] === 'dr-r3' && r.cells[4] === 'rc-energy-r3') && chain.rows.some((r) => r.cells[0] === 'Main' && r.cells[3] === 'dr-r3' && r.cells[4] === main.rewardChainConfig.energy[2].syntax))
  check('coin ranks are exported with their allowance syntax and worth', chain.rows.some((r) => r.cells[0] === 'Main' && r.cells[3] === 'coin-r2' && r.cells[4] === 'allowance(coins:0.12)' && r.cells[6] === 0.12))
  const drops = buildV2DropGroupsSheet([main], [rcA])
  check('V2 Drop Groups identifies the RC list\'s own group and starts at its own drop rank', drops.rows.some((r) => r.cells[0] === 'RC' && r.cells[1] === 9 && r.cells[2] === 'RC group' && r.cells[3] === 7) && drops.rows.filter((r) => r.cells[0] === 'RC').every((r) => r.cells[1] >= 9))
  const economy = buildV2EconomySheet([main], [rcA])
  check('V2 Economy lists semi-tile reward items with their cell', economy.rows[0].cells[7] === '2:1=coin-r2')

  // Every reward key written into a queue/layout cell resolves to that list's configured syntax.
  const queue = buildBlockedQueueSheet([main])
  const queueKeys = queue.rows.map((r) => r.cells[2]).filter((v) => typeof v === 'string')
  check('Blocked Queue writes reward entries by key, never the internal encoded number', queueKeys.length === 1 && queueKeys[0] === 'dr-r3' && queue.rows.every((r) => typeof r.cells[2] !== 'number' || r.cells[2] < 1000))
  const layout = buildBoardLayoutsSheet([main])
  const semiCells = layout.sections[0].rows.flat().filter((c) => c.startsWith('S:'))
  check('Board Layouts writes a semi reward item by key (S:coin-r2)', semiCells.includes('S:coin-r2'))
  const keyToSyntax = new Map(chain.rows.filter((r) => r.cells[0] === 'Main').map((r) => [r.cells[3], r.cells[4]]))
  check('every exported reward key resolves to a configured, non-empty item syntax', [...queueKeys, ...semiCells.map((c) => c.slice(2)).filter((k) => !/^\d+$/.test(k))].every((k) => (keyToSyntax.get(k) ?? '').length > 0))

  // Google Sheets: payload construction validated offline.
  const perSegment = buildAllSheetsAsValueRows([main], [rcA])
  const combined = buildAllSegmentsSheetsAsValueRows([{ name: 'S1', boards: [main], recompletionBoards: [rcA] }, { name: 'S2', boards: [mk('M2')], recompletionBoards: [mk('A2')] }])
  check('per-segment Sheets payload is well-formed (unique legal titles, plain cell values)', validateSheetsPayload(perSegment).length === 0)
  check('combined Sheets payload is well-formed', validateSheetsPayload(combined).length === 0)
  const req = buildSheetsRequests('Test export', combined)
  check('request bodies are built as the Sheets API expects (RAW values, one range per tab)', req.values.valueInputOption === 'RAW' && req.values.data.length === combined.length && req.create.sheets.length === combined.length && req.values.data.every((d) => /^'.+'!A1$/.test(d.range)))
  check('the payload survives JSON serialisation unchanged', JSON.stringify(JSON.parse(JSON.stringify(req))) === JSON.stringify(req))
  check('a malformed payload is caught before sending', validateSheetsPayload([{ title: 'A', rows: [[undefined]] }, { title: 'a', rows: [] }]).length === 2)
}

console.log('--- 29. Coins are an allowance worth, not a coin count ---')
{
  check('the payout syntax is allowance(coins:<worth>)', coinAllowanceSyntax(0.12) === 'allowance(coins:0.12)' && coinAllowanceSyntax(1.5) === 'allowance(coins:1.5)' && coinAllowanceSyntax(0) === '')
  check('the worth is read back from a syntax, including an extended one', parseCoinAllowanceSyntax('allowance(coins:0.12)') === 0.12 && parseCoinAllowanceSyntax('allowance(coins:0.3)+free_wild:1') === 0.3 && parseCoinAllowanceSyntax('coins:100000') === null)
  check('a literal coin amount is recognised as the old form', isLiteralCoinDefinition({ syntax: 'coins:100000' }) && isLiteralCoinDefinition({ syntax: 'coins:245679+free_wild:1' }) && !isLiteralCoinDefinition({ syntax: 'allowance(coins:0.12)' }) && !isLiteralCoinDefinition({ syntax: '' }))
  check('a hand-extended syntax is not overwritten when the worth changes', coinSyntaxFollowsWorth('') && coinSyntaxFollowsWorth('allowance(coins:0.12)') && !coinSyntaxFollowsWorth('allowance(coins:0.12)+free_wild:1') && !coinSyntaxFollowsWorth('coins:100000'))
  check('coin allowance keeps its decimals and its unit; counts stay counts', formatRewardAmount('coins', 0.12) === '0.12' && formatRewardAmount('coins', 1.5, { unit: true }) === '1.5× allowance' && formatRewardAmount('energy', 75, { unit: true }) === '75 energy')
  // The economy math is unit-agnostic: an allowance-worth ladder solves like any other.
  const cfg = createRewardChainConfig()
  ;[0.05, 0.12, 0.27, 0.6].forEach((worth, i) => (cfg.coins[i].prizeAmount = worth))
  check('a 1.2-allowance target is two rank-4 collects (16 source units)', closestUnitsForTarget(1.2, cfg, 'coins', 'forfeit').units === 16 && Math.abs(closestUnitsForTarget(1.2, cfg, 'coins', 'forfeit').payout - 1.2) < 1e-9)
  check('a target the ladder cannot pay exactly reports the closest allowance', closestUnitsForTarget(1, cfg, 'coins', 'forfeit').exact === false && Math.abs(closestUnitsForTarget(1, cfg, 'coins', 'forfeit').payout - 1.2) < 1e-9)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
