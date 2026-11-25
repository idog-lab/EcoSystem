// Twister widget economy - engine and analysis checks.
// Run with: npx vite-node scripts/verify/verify-twister.mjs
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { placeItems } from '../../src/features/merge/lib/core/placement.js'
import { buildInitialState, performMerge, simulatePlaythrough, mainChainValueInPlay, mainChainProgress, pickMergeByStrategy, findLowestRewardCell } from '../../src/features/merge/lib/simulation/mergeSimulation.js'
import {
  REWARD_TYPES,
  REWARD_TYPE_LABELS,
  ALL_REWARD_TYPES,
  TWISTER_TYPE,
  encodeReward,
  decodeReward,
  isMainItem,
  createRewardChainConfig,
  ensureRewardChainConfig,
  validateRewardLadder,
  validateRewardChainConfig,
  smallRewardKey,
} from '../../src/features/merge/lib/rewards/rewardChain.js'
import { createDropGroup, createDropGroupsConfig, validateDropGroup, MAX_GROUP_ITEMS } from '../../src/features/merge/lib/rewards/dropGroups.js'
import { MAX_RANK, RC_MAX_RANK, valueOf } from '../../src/features/merge/lib/core/ranks.js'
import {
  applyTwisterDropRule,
  readTwisterDropRule,
  twisterDropOdds,
  hasTwisterDrops,
  analyzeTwisterIncome,
  suggestSpinCost,
  evaluateSpinCost,
  availableSpins,
  boardHasTwisterUnderTiles,
  stripTwisterFromTiles,
  stripTwisterFromGroups,
  twisterIsConfigured,
  twisterAnalysisKey,
  targetSpinsForSegment,
  createTwisterPlan,
} from '../../src/features/merge/lib/rewards/twisterEconomy.js'
import { createPlaySession, spendGenerator, canSpendGenerator, placeFromInventory, mergeItems, collectRewardItem, twisterBalance, twisterEarned, canSpinTwister, spinTwister, sessionProgress, sessionHasTwister, canSpendEnergy } from '../../src/features/merge/lib/simulation/playSession.js'
import { computeEffectiveSubsidy, mulberry32 } from '../../src/features/merge/lib/rewards/rewardEconomy.js'
import { proposeRewardPlacements } from '../../src/features/merge/lib/rewards/rewardPlacement.js'
import { generateSmallRewardsConfiguration } from '../../src/features/merge/lib/rewards/smallRewardsWorkflow.js'
import { buildDropConfiguration } from '../../src/features/merge/lib/rewards/rewardTargeting.js'
import { buildWorkbook, buildAllSheetsAsValueRows, buildAllSegmentsSheetsAsValueRows, buildAllSegmentsWorkbook, buildBlockedQueueSheet, buildBoardLayoutsSheet, buildV2TwisterSheet, buildV2RewardChainSheet, buildV2DropGroupsSheet } from '../../src/features/merge/lib/export/eventSheets.js'
import { validateSheetsPayload } from '../../src/features/merge/lib/export/googleSheetsExport.js'
import { encodeStage, decodeStage } from '../../src/features/merge/lib/share/stageShare.js'
import { encodePlan, decodePlan } from '../../src/features/merge/lib/share/planShare.js'

let failures = 0
let count = 0
function check(name, cond) {
  count += 1
  if (cond) console.log(`  OK  ${name}`)
  else {
    failures++
    console.log(`FAIL  ${name}`)
  }
}

const TWISTER_LADDER = [2, 5, 12, 30]
function withTwister(board, { ladder = TWISTER_LADDER } = {}) {
  const config = createRewardChainConfig()
  config[TWISTER_TYPE] = ladder.map((prizeAmount, i) => ({ syntax: `test-twister:${prizeAmount}`, asset: 'test-twister-asset', prizeAmount, displayName: '', art: null, rankIndex: i }))
  return { ...board, rewardChainConfig: config }
}

// A generated chain: `count` boards, board 1 the full grid, the rest waves.
function mkChain({ boards = 3, values = [150, 500, 500], cols = 8, perMille = 150, itemRank = 1, minDropRank = 6 } = {}) {
  const list = []
  for (let i = 0; i < boards; i++) {
    const rows = i === 0 ? 5 : 3
    const b = createBoard(`Board ${i + 1}`, { rows, cols })
    const blockedFrom = i === 0 ? 3 : 1
    b.tiles = b.tiles.map((row, r) => row.map(() => (r >= blockedFrom ? 'blocked' : 'open')))
    if (i === 0) b.tiles[2][4] = 'semi'
    b.blockedValue = values[i] ?? 300
    const g = placeItems(b, { isFirstBoard: i === 0, boardIndex: i })
    list.push({ ...b, semiPlacements: g.semiPlacements, blockedQueue: g.blockedQueue })
  }
  let shared = withTwister(list[0])
  const rule = applyTwisterDropRule({ dropGroups: [], dropGroupsConfig: createDropGroupsConfig(RC_MAX_RANK), minDropRank, itemRank, perMille })
  return list.map((b) => ({ ...b, rewardChainConfig: shared.rewardChainConfig, dropGroups: rule.dropGroups, dropGroupsConfig: rule.dropGroupsConfig, minDropRank }))
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

console.log('--- 1. Twister is its own reward type ---')
for (let rank = 1; rank <= 4; rank++) {
  const v = encodeReward(TWISTER_TYPE, rank)
  check(`encode/decode twister r${rank}`, !isMainItem(v) && decodeReward(v).type === TWISTER_TYPE && decodeReward(v).rank === rank)
}
check('Twister does not collide with any other reward encoding', new Set(ALL_REWARD_TYPES.flatMap((t) => [1, 2, 3, 4].map((r) => encodeReward(t, r)))).size === 20)
check('existing encodings are unchanged (coins r1 = 1001, charms r4 = 1034)', encodeReward('coins', 1) === 1001 && encodeReward('charms', 4) === 1034)
check('Twister is NOT one of the four source-allocated resources', !REWARD_TYPES.includes(TWISTER_TYPE) && REWARD_TYPES.length === 4 && ALL_REWARD_TYPES.length === 5)
check('Twister is labelled distinctly from merge energy', REWARD_TYPE_LABELS.twister === 'Twister DR' && REWARD_TYPE_LABELS.energy === 'Merge Energy' && smallRewardKey(TWISTER_TYPE, 2) === 'dr-twister-r2' && smallRewardKey('energy', 2) === 'dr-r2')
{
  const fresh = createRewardChainConfig()
  check('a fresh Twister ladder has no syntax or value invented; its asset is the one the economist gave (merge-config-twister-v2)', fresh.twister.every((r) => r.syntax === '' && r.asset === 'merge-config-twister-v2' && r.prizeAmount === 0) && !twisterIsConfigured(fresh))
  const { twister: _t, ...legacy } = createRewardChainConfig()
  legacy.coins[2].prizeAmount = 4242
  const ensured = ensureRewardChainConfig(legacy)
  check('a pre-Twister config gains a blank Twister ladder and keeps every existing value', ensured.twister.length === 4 && ensured.coins[2].prizeAmount === 4242 && ensured.energy[3].prizeAmount === 75)
  check('...and a config that already has it is returned untouched', ensureRewardChainConfig(fresh) === fresh)
}

console.log('--- 2. Reward ladders must reward merging ---')
{
  const ladder = (values) => values.map((prizeAmount) => ({ prizeAmount }))
  check('2/5/12/30 rewards merging (no finding)', validateRewardLadder(ladder([2, 5, 12, 30])).length === 0)
  check('rank 4 must be STRICTLY above 2 x rank 3', validateRewardLadder(ladder([1, 3, 8, 16])).some((i) => i.code === 'top-rank-not-best' && i.rank === 3))
  check('rank 4 must be above 4 x rank 2', validateRewardLadder(ladder([1, 10, 15, 35])).some((i) => i.code === 'top-rank-not-best' && i.rank === 2))
  check('rank 4 must be above 8 x rank 1', validateRewardLadder(ladder([5, 6, 13, 30])).some((i) => i.code === 'top-rank-not-best' && i.rank === 1))
  check('an intermediate merge that loses value is flagged', validateRewardLadder(ladder([4, 6, 20, 50])).some((i) => i.code === 'merge-step-loses-value' && i.rank === 1))
  check('an unconfigured (all-zero) ladder is not judged', validateRewardLadder(ladder([0, 0, 0, 0])).length === 0)
  const reference = createRewardChainConfig()
  const before = JSON.stringify(reference)
  const findings = validateRewardChainConfig(reference)
  const flagged = findings.map((f) => f.type).sort()
  check('the existing reference ladders are checked too: puzzles and charms are flagged, energy is not (coins are unconfigured)', JSON.stringify(flagged) === JSON.stringify(['charms', 'puzzles']))
  check('validation never changes a value', JSON.stringify(reference) === before)
}

console.log('--- 3. Drop groups: Twister eligible, one per group, four items at most ---')
{
  check('a group of Twister + three other resources is valid (4 items)', validateDropGroup(createDropGroup({ id: 'a', name: 'a', items: { coins: 1, puzzles: 1, energy: 1, twister: 2 } })).length === 0)
  check('a group of all five resources is rejected (the limit stays 4)', MAX_GROUP_ITEMS === 4 && validateDropGroup(createDropGroup({ id: 'b', name: 'b', items: { coins: 1, puzzles: 1, energy: 1, charms: 1, twister: 1 } })).length === 1)
  check('a group holds at most one Twister item by construction', Object.keys(createDropGroup({ id: 'c', items: { twister: 1 } }).items).filter((t) => t === TWISTER_TYPE).length === 1)
  check('an invalid Twister rank is rejected', validateDropGroup(createDropGroup({ id: 'd', name: 'd', items: { twister: 5 } })).length === 1)
}

console.log('--- 4. The shared drop rule ---')
{
  const base = createDropGroupsConfig(RC_MAX_RANK)
  const r = applyTwisterDropRule({ dropGroups: [], dropGroupsConfig: base, minDropRank: 6, itemRank: 2, perMille: 150 })
  check('creates one single-item Twister group', r.dropGroups.length === 1 && r.dropGroups[0].items.twister === 2 && Object.keys(r.dropGroups[0].items).length === 1)
  check('the group is kept (not auto) so Small Rewards Generate does not replace it', !r.dropGroups[0].auto)
  check('ranks below the drop start rank get nothing', r.dropGroupsConfig.slice(0, 5).every((t) => t.entries.length === 0))
  check('every eligible rank gets 150 of 1000, taken from no-drop', r.dropGroupsConfig.slice(5).every((t) => t.entries.length === 1 && t.entries[0].weight === 150 && t.noDropWeight === 850))
  const odds = twisterDropOdds(r.dropGroups, r.dropGroupsConfig, { minDropRank: 6, rewardChainConfig: withTwister(createBoard('x')).rewardChainConfig, maxRank: MAX_RANK })
  check('odds report 15% and the raw item DR per merge (0.15 x 5)', odds.length === 7 && odds.every((o) => Math.abs(o.probability - 0.15) < 1e-9 && Math.abs(o.rawValuePerMerge - 0.75) < 1e-9))
  check('reading the rule back gives rank 2 at 150', JSON.stringify(readTwisterDropRule(r.dropGroups, r.dropGroupsConfig, 6)) === JSON.stringify({ groupId: 'twister-r2', itemRank: 2, perMille: 150, mixed: false }))
  const again = applyTwisterDropRule({ dropGroups: r.dropGroups, dropGroupsConfig: r.dropGroupsConfig, minDropRank: 6, itemRank: 2, perMille: 150 })
  check('re-applying is idempotent', JSON.stringify(again.dropGroupsConfig) === JSON.stringify(r.dropGroupsConfig) && again.dropGroups.length === 1)
  const changed = applyTwisterDropRule({ dropGroups: r.dropGroups, dropGroupsConfig: r.dropGroupsConfig, minDropRank: 6, itemRank: 1, perMille: 400 })
  check('changing the rule replaces the old group and weight', changed.dropGroups.length === 1 && changed.dropGroups[0].items.twister === 1 && changed.dropGroupsConfig[6].entries.length === 1 && changed.dropGroupsConfig[6].entries[0].weight === 400 && changed.dropGroupsConfig[6].noDropWeight === 600)
  const removed = applyTwisterDropRule({ dropGroups: r.dropGroups, dropGroupsConfig: r.dropGroupsConfig, minDropRank: 6, itemRank: 2, perMille: 0 })
  check('0 removes the rule and returns its weight to no-drop', removed.dropGroups.length === 0 && removed.dropGroupsConfig.every((t) => t.entries.length === 0) && removed.dropGroupsConfig[7].noDropWeight === 1000 && !hasTwisterDrops(removed.dropGroups, removed.dropGroupsConfig, 6))

  // Other groups keep their odds; locked tables are untouched; clamps are reported.
  const tables = createDropGroupsConfig(RC_MAX_RANK)
  const coin = createDropGroup({ id: 'hand-coin', name: 'Coins', items: { coins: 1 } })
  tables[6].entries = [{ groupId: 'hand-coin', weight: 30 }] // rank 7: 30 of 130 on the old scale
  tables[7].locked = true
  tables[7].entries = [{ groupId: 'hand-coin', weight: 5 }]
  tables[8].noDropWeight = 100
  tables[8].entries = [{ groupId: 'hand-coin', weight: 900 }] // rank 9: only 100 of 1000 free
  const mixed = applyTwisterDropRule({ dropGroups: [coin], dropGroupsConfig: tables, minDropRank: 6, itemRank: 1, perMille: 200 })
  const rank7 = mixed.dropGroupsConfig[6]
  const coinShareBefore = 30 / 130
  const coinShareAfter = rank7.entries.find((e) => e.groupId === 'hand-coin').weight / (rank7.noDropWeight + rank7.entries.reduce((s, e) => s + e.weight, 0))
  check('a hand-made group keeps its odds (rescaled to 1000, same share)', Math.abs(coinShareAfter - coinShareBefore) < 0.002 && mixed.dropGroups.some((g) => g.id === 'hand-coin'))
  check('a locked rank table is left exactly as it was', JSON.stringify(mixed.dropGroupsConfig[7]) === JSON.stringify(tables[7]))
  check('a rank with too little free no-drop weight is clamped and reported', mixed.dropGroupsConfig[8].entries.find((e) => e.groupId === 'twister-r1').weight === 100 && mixed.findings.some((m) => m.includes('Rank 9')))
  check('...as are the rescale and the skipped locked table', mixed.findings.some((m) => m.includes('rescaled')) && mixed.findings.some((m) => m.includes('locked')))

  // The Small Rewards generator keeps the rule group and its odds.
  const gen = buildDropConfiguration({ dropUnits: { coins: 40, puzzles: 0, energy: 24, charms: 0 }, mergesByRank: { 6: 20, 7: 20, 8: 15, 9: 10, 10: 8, 11: 4, 12: 1 }, dropGroups: r.dropGroups, dropGroupsConfig: r.dropGroupsConfig, minDropRank: 6, structure: 'separate' })
  check('Small Rewards generation keeps the Twister group', gen.dropGroups.some((g) => g.id === 'twister-r2' && g.items.twister === 2))
  check('...keeps its 150 per mille in every eligible rank', gen.dropGroupsConfig.slice(5).every((t) => t.entries.find((e) => e.groupId === 'twister-r2')?.weight === 150))
  check('...and never generates a Twister group of its own', gen.generatedGroups.every((g) => g.items.twister == null))
  const stripped = stripTwisterFromGroups(gen.dropGroups)
  check('the without-Twister baseline removes Twister items and leaves every other group alone', stripped.every((g) => g.items.twister == null) && stripped.filter((g) => g.auto).length === gen.generatedGroups.length)
}

console.log('--- 5. Twister only ever comes from merge drops ---')
{
  // Generation ignores a Twister entry in the tile-side reward data.
  const b = createBoard('b', { rows: 5, cols: 8 })
  b.tiles = b.tiles.map((row, r) => row.map(() => (r >= 3 ? 'blocked' : 'open')))
  b.tiles[2][4] = 'semi'
  b.tiles[2][0] = 'semi'
  b.blockedValue = 150
  b.rewardQueueItems = [{ type: 'twister', rank: 2 }, { type: 'coins', rank: 1 }]
  b.rewardSemiItems = [{ row: 2, col: 0, type: 'twister', rank: 1 }]
  const g = placeItems(b, { isFirstBoard: true, boardIndex: 0 })
  const generated = { ...b, semiPlacements: g.semiPlacements, blockedQueue: g.blockedQueue }
  const hasTwisterValue = (list) => list.some((v) => decodeReward(v)?.type === TWISTER_TYPE)
  check('generation never puts a Twister item in the blocked queue', !hasTwisterValue(g.blockedQueue) && g.blockedQueue.some((v) => decodeReward(v)?.type === 'coins'))
  check('generation never puts a Twister item on a semi tile', !hasTwisterValue(g.semiPlacements.map((p) => p.rank)))
  check('main-chain DR is still exact (150)', [...g.blockedQueue, ...g.semiPlacements.map((p) => p.rank)].filter(isMainItem).reduce((s, v) => s + valueOf(v), 0) === 150)
  check('the stray authored entries are detected...', boardHasTwisterUnderTiles(b))
  const cleaned = stripTwisterFromTiles({ ...generated, blockedQueue: [...generated.blockedQueue, encodeReward('twister', 1)] })
  check('...and removed on load, leaving the other reward items', !boardHasTwisterUnderTiles(cleaned) && cleaned.rewardQueueItems.length === 1 && cleaned.rewardQueueItems[0].type === 'coins')
  check('a clean board is returned untouched', stripTwisterFromTiles(cleaned) === cleaned)

  // Placement proposals and the full Small Rewards generation never use Twister.
  const chain = mkChain()
  const proposal = proposeRewardPlacements(chain, { tileUnits: { coins: 8, puzzles: 4, energy: 8, charms: 0 } })
  check('reward placement proposals never contain Twister', proposal.boards.every((bd) => !boardHasTwisterUnderTiles(bd)))
  const solved = await generateSmallRewardsConfiguration({ phase: 'main', boards: chain, targets: { coins: 0, puzzles: 0, energy: 150, charms: 0 }, split: { sharedTilePct: 50 }, evalRuns: 6 })
  check('Small Rewards generation leaves no Twister under any tile', solved.boards.every((bd) => !boardHasTwisterUnderTiles(bd)))
  check('...keeps the shared Twister drop', solved.dropGroups.some((gr) => gr.items.twister != null) && hasTwisterDrops(solved.dropGroups, solved.dropGroupsConfig, 6))
  check('...and has no Twister target, split or review row', !('twister' in (solved.perResourceReview ?? {})) && !('twister' in (solved.targets ?? {})))
  const mainSum = (bd) => [...bd.blockedQueue, ...bd.semiPlacements.map((p) => p.rank)].filter(isMainItem).reduce((s, v) => s + valueOf(v), 0)
  check('every board still carries its exact main-chain DR after generation', solved.boards.every((bd, i) => mainSum(bd) === mainSum(chain[i])))
  check('Board 1 still carries its 150 DR', mainSum(solved.boards[0]) === 150 && solved.boards[0].blockedValue === 150)
}

console.log('--- 6. Drops land on the board, merge and collect ---')
{
  const collected = []
  const onCollect = (type, rank) => collected.push(`${type}${rank}`)
  const groups = new Map([['tw', createDropGroup({ id: 'tw', items: { twister: 1 } })]])
  const tables = createDropGroupsConfig(RC_MAX_RANK)
  for (const t of tables) {
    t.noDropWeight = 0
    t.entries = [{ groupId: 'tw', weight: 1 }]
  }
  const opts = { onCollect, dropGroupsConfig: tables, dropGroupsById: groups, minDropRank: 6, inventory: [] }
  const state = tinyState(3, 4)
  state.itemAt[0][0] = 5
  state.itemAt[0][1] = 5
  performMerge(state, { mover: [0, 0], receiver: [0, 1], rank: 5 }, () => {}, null, opts)
  const tw1 = encodeReward('twister', 1)
  const countOf = (v) => state.itemAt.flat().filter((x) => x === v).length
  check('a main merge to rank 6 drops a Twister item onto a board cell', countOf(tw1) === 1 && collected.length === 0)
  state.itemAt[1][0] = 4
  state.itemAt[1][1] = 4
  performMerge(state, { mover: [1, 0], receiver: [1, 1], rank: 4 }, () => {}, null, opts)
  check('a main merge below the drop start rank drops nothing', countOf(tw1) === 1)
  // Two Twister rank-1 items merge; the reward merge itself drops nothing.
  state.itemAt[2][0] = tw1
  const cells = []
  state.itemAt.forEach((row, r) => row.forEach((v, c) => v === tw1 && cells.push([r, c])))
  performMerge(state, { mover: cells[0], receiver: cells[1], rank: tw1 }, () => {}, null, opts)
  check('two Twister items merge into rank 2, and that merge causes no drop', countOf(encodeReward('twister', 2)) === 1 && countOf(tw1) === 0)
  // Rank 3 + rank 3 -> rank 4 auto-collects.
  const tw3 = encodeReward('twister', 3)
  const s2 = tinyState(1, 3)
  s2.itemAt[0][0] = tw3
  s2.itemAt[0][1] = tw3
  performMerge(s2, { mover: [0, 0], receiver: [0, 1], rank: tw3 }, () => {}, null, opts)
  check('two rank-3 Twister items auto-collect as rank 4', collected.join() === 'twister4' && s2.itemAt.flat().every((v) => v == null))
  // A full board sends the drop to the inventory instead of losing it.
  const full = tinyState(1, 2)
  full.itemAt[0][0] = 6
  full.itemAt[0][1] = 6
  const inv = []
  performMerge(full, { mover: [0, 0], receiver: [0, 1], rank: 6 }, () => {}, null, { ...opts, inventory: inv })
  check('with one free cell after the merge the drop lands there', full.itemAt[0][0] === tw1 && inv.length === 0)
}

console.log('--- 7. Twister DR is not energy and earns no credit ---')
{
  const chain = mkChain({ perMille: 400, itemRank: 2 })
  const b0 = chain[0]
  const run = simulatePlaythrough(chain, { rewardChainConfig: b0.rewardChainConfig, dropGroupsConfig: b0.dropGroupsConfig, dropGroupsById: new Map(b0.dropGroups.map((g) => [g.id, g])), dropMode: 'expected', minDropRank: 6 })
  check('a run with only Twister drops collects Twister DR', run.collected.twister > 0)
  check('...and no merge energy at all', run.collected.energy === 0 && run.energySpent === 0 && run.energyBalance === 0)
  check('Twister never funds a generator tap (every tap was paid in DR)', run.drSpent > 0 && run.energySpent === 0)
  const noDrops = simulatePlaythrough(chain, { rewardChainConfig: b0.rewardChainConfig, dropMode: 'expected', minDropRank: 6 })
  check('the 80% energy credit ignores Twister: effective subsidy is the same with and without it', computeEffectiveSubsidy(1150, 0, run.collected.energy).effectiveSubsidy === computeEffectiveSubsidy(1150, 0, noDrops.collected.energy).effectiveSubsidy)
  check('the credit formula itself is unchanged (1000,0,100 -> 920; 1000,0.10,100 -> 1020)', computeEffectiveSubsidy(1000, 0, 100).effectiveSubsidy === 920 && Math.abs(computeEffectiveSubsidy(1000, 0.1, 100).effectiveSubsidy - 1020) < 1e-9)
  check('raw dropped value and item count are tracked separately from collected income', run.droppedItems.twister > 0 && run.droppedRawValue.twister === run.droppedItems.twister * 5)
  check('collected income never exceeds what merging the dropped items to rank 4 could pay', run.collected.twister <= (run.droppedItems.twister * 2 * 30) / 8 + 1e-9)
  // The four-resource economy is untouched when Twister is absent.
  const { twister: _t, ...oldChain } = b0.rewardChainConfig
  const plainBoards = chain.map((b) => ({ ...b, rewardChainConfig: oldChain, dropGroups: [], dropGroupsConfig: createDropGroupsConfig(RC_MAX_RANK) }))
  const a = simulatePlaythrough(plainBoards, { dropMode: 'expected' })
  const c = simulatePlaythrough(plainBoards.map((b) => ({ ...b, rewardChainConfig: ensureRewardChainConfig(oldChain) })), { dropMode: 'expected' })
  check('adding the (blank) Twister ladder changes nothing in an existing run', a.drSpent === c.drSpent && JSON.stringify(a.reachedAt) === JSON.stringify(c.reachedAt) && REWARD_TYPES.every((t) => a.collected[t] === c.collected[t]))
}

console.log('--- 8. Main-chain DR progression ---')
{
  const s = tinyState(2, 4)
  s.itemAt[0][0] = 5
  s.itemAt[0][1] = 5
  s.itemAt[1][0] = encodeReward('twister', 3)
  s.itemAt[1][1] = encodeReward('coins', 2)
  check('value in play counts main items only (16 + 16), never reward items', mainChainValueInPlay(s, []) === 32)
  check('inventory main items count; inventory reward items do not', mainChainValueInPlay(s, [3, encodeReward('energy', 3)]) === 36)
  performMerge(s, { mover: [0, 0], receiver: [0, 1], rank: 5 }, () => {}, null, {})
  check('merging does not change it (two rank 5 -> one rank 6, still 32)', mainChainValueInPlay(s, []) === 32)
  s.locked[1][3] = true
  s.itemAt[1][3] = 9
  check('value behind a locked tile is excluded', mainChainValueInPlay(s, []) === 32)
  s.stuck[0][1] = true
  check('a revealed-but-stuck subsidy item is included', mainChainValueInPlay(s, []) === 32)
  check('progress = value / 2048 in the main phase, / 8192 in RC', mainChainProgress(s, [], 'main') === 32 / 2048 && mainChainProgress(s, [], 'rc') === 32 / 8192)
  const big = tinyState(1, 4)
  big.itemAt[0] = [11, 11, 11, 11]
  check('it is capped at 1, and a reached goal reports exactly 1', mainChainProgress(big, [], 'main') === 1 && mainChainProgress(s, [], 'main', true) === 1)

  // Monotonic through a real session played with the automatic merge order.
  const chain = mkChain({ perMille: 300 })
  const session = createPlaySession(chain, 0)
  let last = sessionProgress(session)
  let monotonic = true
  let maxSeen = last
  for (let step = 0; step < 6000 && session.reachedAt[MAX_RANK] === undefined; step++) {
    const merge = pickMergeByStrategy(session.state, 'free-free-first')
    if (merge) mergeItems(session, merge.mover, merge.receiver)
    else if (session.inventory.length && canSpendGenerator(session)) placeFromInventory(session, 0)
    else if (canSpendGenerator(session)) spendGenerator(session)
    else {
      const cell = findLowestRewardCell(session.state)
      if (!cell) break
      collectRewardItem(session, cell)
    }
    const now = sessionProgress(session)
    if (now + 1e-12 < last) monotonic = false
    last = now
    maxSeen = Math.max(maxSeen, now)
  }
  check('progress never decreases across a whole played phase', monotonic && session.reachedAt[MAX_RANK] !== undefined)
  check('...and reads exactly 100% once rank 12 is held', sessionProgress(session) === 1)
  check('the session starts at its visible semi value, not 0 and not above it', sessionProgress(createPlaySession(chain, 0)) === mainChainValueInPlay(createPlaySession(chain, 0).state, []) / 2048)
}

console.log('--- 9. The checkpoint is an observation ---')
{
  const chain = mkChain({ perMille: 300, itemRank: 1 })
  const b0 = chain[0]
  const base = () => ({ rewardChainConfig: b0.rewardChainConfig, dropGroupsConfig: b0.dropGroupsConfig, dropGroupsById: new Map(b0.dropGroups.map((g) => [g.id, g])), dropMode: 'stochastic', minDropRank: 6 })
  const plain = simulatePlaythrough(chain, { ...base(), dropRng: mulberry32(5) })
  const observed = simulatePlaythrough(chain, { ...base(), dropRng: mulberry32(5), checkpoint: { phase: 'main', fraction: 0.7 } })
  check('observing a checkpoint changes nothing about the run', plain.drSpent === observed.drSpent && plain.collected.twister === observed.collected.twister && JSON.stringify(plain.reachedAt) === JSON.stringify(observed.reachedAt))
  const cp = observed.checkpoint
  check('the checkpoint is reached at or just past the threshold', cp && cp.progress >= 0.7 && cp.progress < 0.85)
  check('income at the checkpoint is cumulative and not above the end-of-run income', cp.collected.twister <= observed.collected.twister)
  // Whether any Twister item happens to be sitting unmerged at the exact
  // moment of a checkpoint depends on the run (boards are generated with
  // randomness), so this is checked across several seeds rather than on one:
  // an earlier single-seed version of this check failed about one run in six.
  const observations = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => simulatePlaythrough(chain, { ...base(), dropRng: mulberry32(seed), checkpoint: { phase: 'main', fraction: 0.7 } }).checkpoint)
  check('nothing is force-collected: uncollected Twister items are reported at the checkpoint, not cashed in', observations.some((o) => o.twisterUncollected.items > 0 && o.twisterUncollected.value > 0) && observations.every((o) => o.twisterUncollected.items >= 0 && (o.twisterUncollected.items > 0) === (o.twisterUncollected.value > 0)))
  const fractions = [0.2, 0.4, 0.6, 0.8, 0.95]
  const spends = fractions.map((f) => simulatePlaythrough(chain, { ...base(), dropRng: mulberry32(5), checkpoint: { phase: 'main', fraction: f } }).checkpoint.drSpent)
  check('a later checkpoint is never reached on less spend', spends.every((v, i) => i === 0 || v >= spends[i - 1]))
  check('a run that never asks for a checkpoint reports none', plain.checkpoint === null)
  check('the furthest progress of the main phase is reported (1 after finishing)', observed.progress.main === 1 && observed.progress.rc === null)

  // RC: phase-relative, fresh RC board.
  const rc = mkChain({ boards: 2, values: [150, 2000], perMille: 300 })
  const rcRun = simulatePlaythrough(chain, { ...base(), dropRng: mulberry32(5), rcBoards: rc, checkpoint: { phase: 'rc', fraction: 0.5 } })
  check('an RC checkpoint is observed in the RC phase', rcRun.rcEntered && rcRun.checkpoint?.phase === 'rc' && rcRun.checkpoint.progress >= 0.5)
  check('RC income is counted from the start of the RC round', rcRun.checkpoint.collectedInPhase.twister <= rcRun.checkpoint.collected.twister && rcRun.checkpoint.collectedInPhase.twister >= 0 && rcRun.checkpoint.collected.twister - rcRun.checkpoint.collectedInPhase.twister === rcRun.collectedMainPhase.twister - rcRun.carriedIntoRc.twister)
  check('RC progress is measured against rank 14 from the fresh RC board', rcRun.progress.rc === 1 && rcRun.secondGrandPrizeAwarded)
}

console.log('--- 10. Income analysis ---')
{
  const low = mkChain({ values: [150, 200, 200], perMille: 300, itemRank: 2 })
  const high = mkChain({ values: [150, 600, 700], perMille: 300, itemRank: 2 })
  const a1 = await analyzeTwisterIncome({ boards: low, checkpointPct: 70, runs: 40, seed: 3 })
  const a2 = await analyzeTwisterIncome({ boards: low, checkpointPct: 70, runs: 40, seed: 3 })
  const a3 = await analyzeTwisterIncome({ boards: low, checkpointPct: 70, runs: 40, seed: 4 })
  const h = await analyzeTwisterIncome({ boards: high, checkpointPct: 70, runs: 40, seed: 3 })
  check('the same seed reproduces the analysis exactly', JSON.stringify(a1.samples) === JSON.stringify(a2.samples))
  check('a different seed gives different draws', JSON.stringify(a1.samples) !== JSON.stringify(a3.samples))
  check('every run reaches a 70% checkpoint on a healthy chain', a1.reachRate === 1 && a1.endedBeforeCount === 0 && a1.samples.length === 40)
  check('mean and percentiles are reported and ordered', a1.income.mean > 0 && a1.income.p10 <= a1.income.p50 && a1.income.p50 <= a1.income.p90)
  check('the same shared drops give the two segments different income', Math.abs(a1.income.mean - h.income.mean) > 1)
  check('the low-subsidy segment (more of its own effort, more merges) collects more', a1.income.mean > h.income.mean)
  check('income at the checkpoint is below income by the end of the phase', a1.income.mean < a1.incomeAtPhaseEnd.mean)
  check('uncollected inventory and raw dropped value are reported', a1.uncollectedItems.mean >= 0 && a1.rawDropped.mean > 0)
  check('with every run reaching it, conditional and all-run figures agree', a1.income.mean === a1.incomeAllRuns.mean)
  check('the existing economy is revalidated with and without Twister', a1.withoutTwister && REWARD_TYPES.every((t) => a1.withoutTwister.payouts[t].mean != null) && Number.isFinite(a1.effectiveSubsidy) && Number.isFinite(a1.withoutTwister.effectiveSubsidy))
  check('...and Twister changes no energy credit on a chain with no energy drops', a1.effectiveSubsidy === a1.withoutTwister.effectiveSubsidy && a1.effectiveSubsidy === 550)

  // Runs that end before the checkpoint are counted, not dropped.
  const stuck = createBoard('stuck', { rows: 1, cols: 2 })
  stuck.tiles = [['semi', 'semi']]
  stuck.semiPlacements = [{ row: 0, col: 0, rank: 1 }, { row: 0, col: 1, rank: 2 }]
  stuck.blockedQueue = []
  const stuckBoard = withTwister(stuck)
  const rule = applyTwisterDropRule({ dropGroups: [], dropGroupsConfig: createDropGroupsConfig(RC_MAX_RANK), minDropRank: 6, itemRank: 1, perMille: 100 })
  const dead = await analyzeTwisterIncome({ boards: [{ ...stuckBoard, dropGroups: rule.dropGroups, dropGroupsConfig: rule.dropGroupsConfig }], checkpointPct: 50, runs: 10, seed: 1, compareWithoutTwister: false })
  check('runs that end before the checkpoint are reported with their reason', dead.reachRate === 0 && dead.endedBeforeCount === 10 && dead.endedBeforeByReason['no-legal-move'] === 10)
  check('...excluded from the conditional figures and kept in the all-run ones', dead.income.n === 0 && dead.income.mean === null && dead.incomeAllRuns.n === 10 && dead.incomeAllRuns.mean === 0)
  check('a suggestion with no reaching run says so instead of pricing', suggestSpinCost({ samples: dead.samples, targetSpins: 3 }).status === 'no-data')

  // Cancellable and reports progress.
  let ticks = 0
  let cancelled = false
  const stopped = await analyzeTwisterIncome({ boards: low, runs: 40, seed: 3, onProgress: () => (ticks += 1), isCancelled: () => (cancelled = ticks >= 2) })
  check('the analysis yields progress and stops when cancelled', stopped === null && cancelled && ticks >= 2 && ticks < 10)

  // RC analysis.
  const rc = mkChain({ boards: 2, values: [150, 2000], perMille: 300, itemRank: 2 })
  const rcA = await analyzeTwisterIncome({ boards: low, rcBoards: rc, phase: 'rc', checkpointPct: 60, runs: 12, seed: 2, compareWithoutTwister: false })
  check('RC analysis measures RC-round income for runs that reach the RC checkpoint', rcA.phase === 'rc' && rcA.reachRate === 1 && rcA.income.mean > 0)

  // Staleness key.
  const key = (over = {}) => twisterAnalysisKey({ boards: low, phase: 'main', checkpointPct: 70, runs: 40, seed: 3, ...over })
  const repriced = low.map((b) => ({ ...b, twisterSpinCost: 99 }))
  const reodds = low.map((b) => ({ ...b, dropGroupsConfig: applyTwisterDropRule({ dropGroups: b.dropGroups, dropGroupsConfig: b.dropGroupsConfig, minDropRank: 6, itemRank: 2, perMille: 100 }).dropGroupsConfig }))
  check('the staleness key changes with checkpoint, runs, seed, boards and drops', new Set([key(), key({ checkpointPct: 60 }), key({ runs: 41 }), key({ seed: 9 }), key({ boards: high }), key({ boards: reodds })]).size === 6)
  check('...but not with the cost per spin (a price never invalidates measured income)', key({ boards: repriced }) === key())

  console.log('--- 11. Spin cost ---')
  check('available spins = floor(earned / cost)', availableSpins(29, 10) === 2 && availableSpins(30, 10) === 3 && availableSpins(0, 10) === 0 && availableSpins(50, 0) === 0)
  const samples = a1.samples
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length
  const sug = suggestSpinCost({ samples, samplesAllRuns: a1.samplesAllRuns, targetSpins: 5, increment: 1 })
  check('the indicative cost is mean income / target spins', Math.abs(sug.indicative - mean / 5) < 1e-9)
  check('the suggested cost is a whole number of at least 1', Number.isInteger(sug.suggested.cost) && sug.suggested.cost >= 1)
  const direct = samples.filter((e) => Math.floor(e / sug.suggested.cost) >= 5).length / samples.length
  check('target attainment equals the share of simulated players with >= target spins', sug.suggested.attainment === direct)
  const spins = samples.map((e) => Math.floor(e / sug.suggested.cost)).sort((x, y) => x - y)
  check('the reported average spins match the simulated spin counts', Math.abs(sug.suggested.spins.mean - spins.reduce((s, v) => s + v, 0) / spins.length) < 1e-9)
  check('no other candidate has a median closer to the target', sug.candidates.every((c) => Math.abs(c.spins.p50 - 5) >= Math.abs(sug.suggested.spins.p50 - 5)))
  check('remaining DR = earned - spins x cost, never negative and below one cost', sug.suggested.remainder.min >= 0 && sug.suggested.remainder.max < sug.suggested.cost)
  const stepped = suggestSpinCost({ samples, targetSpins: 5, increment: 5 })
  check('a cost step of 5 only ever offers multiples of 5', stepped.candidates.every((c) => c.cost % 5 === 0) && stepped.suggested.cost % 5 === 0 && stepped.suggested.cost >= 5)
  const tooMany = suggestSpinCost({ samples, targetSpins: 100000, increment: 1 })
  check('an unreachable target still never suggests a cost below 1, and explains', tooMany.suggested.cost === 1 && tooMany.status === 'approximate' && /too low/i.test(tooMany.message))
  check('zero income gives no suggestion and says why', suggestSpinCost({ samples: [0, 0, 0], targetSpins: 3 }).suggested === null && suggestSpinCost({ samples: [0, 0, 0], targetSpins: 3 }).status === 'no-income')
  check('no target gives no suggestion (an empty target is never read as zero)', suggestSpinCost({ samples, targetSpins: null }).status === 'no-target')
  const hSug = suggestSpinCost({ samples: h.samples, targetSpins: 5 })
  check('different segment incomes lead to different suggested costs', hSug.suggested.cost !== sug.suggested.cost && hSug.suggested.cost < sug.suggested.cost)
  const fixed = evaluateSpinCost(samples, 10, 5, a1.samplesAllRuns)
  check('a manual cost is evaluated on the same simulated players', fixed.cost === 10 && fixed.attainment === samples.filter((e) => Math.floor(e / 10) >= 5).length / samples.length && fixed.attainmentAllRuns === fixed.attainment)

  const plan = createTwisterPlan()
  check('the target is required: unset until entered', targetSpinsForSegment(plan, 0) === null && plan.targetSpins === null)
  check('one shared target by default, a per-segment override wins, a widget length is the fallback', targetSpinsForSegment({ ...plan, targetSpins: 6 }, 3) === 6 && targetSpinsForSegment({ ...plan, targetSpins: 6, targetSpinsOverrides: { 3: 9 } }, 3) === 9 && targetSpinsForSegment(plan, 0, 12) === 12)
}

console.log('--- 12. Spins in a play session ---')
{
  const b = withTwister(createBoard('s', { rows: 2, cols: 3 }))
  b.tiles = b.tiles.map((row) => row.map(() => 'open'))
  b.twisterSpinCost = 5
  b.twisterSpinObjective = 4
  const session = createPlaySession([b], 0)
  check('a session reads the played segment\'s cost and the widget objective from its boards', session.twisterSpinCost === 5 && session.twisterSpinObjective === 4 && sessionHasTwister(session))
  check('no spin with an empty balance', !canSpinTwister(session) && spinTwister(session).spinsUsed === 0)
  session.state.itemAt[0][0] = encodeReward('twister', 3)
  collectRewardItem(session, [0, 0])
  check('collecting a rank-3 item by hand credits its 12 DR', twisterEarned(session) === 12 && twisterBalance(session) === 12 && session.energyBalance === 0)
  spinTwister(session)
  check('a spin deducts exactly its cost once', twisterBalance(session) === 7 && session.spinsUsed === 1 && session.twisterSpent === 5)
  check('earned Twister DR is unchanged by spending', twisterEarned(session) === 12 && session.collected.twister === 12)
  spinTwister(session)
  check('a second spin deducts once more', twisterBalance(session) === 2 && session.spinsUsed === 2)
  spinTwister(session)
  check('a third is refused: 2 DR is below the cost', twisterBalance(session) === 2 && session.spinsUsed === 2 && !canSpinTwister(session))
  check('spinning never touches merge energy or generator spend', session.energyBalance === 0 && session.drSpent === 0 && !canSpendEnergy(session))
  check('each spin is logged once', session.events.filter((e) => e.type === 'twister-spin').length === 2)
  // Rank-4 auto-collect credits the same balance.
  const tw3 = encodeReward('twister', 3)
  session.state.itemAt[1][0] = tw3
  session.state.itemAt[1][1] = tw3
  mergeItems(session, [1, 0], [1, 1])
  check('rank-4 auto-collection credits the same balance (30 DR)', twisterEarned(session) === 42 && twisterBalance(session) === 32)
  const unset = createPlaySession([{ ...b, twisterSpinCost: null }], 0)
  unset.collected.twister = 100
  check('with no cost configured, no spin is possible (never treated as free)', !canSpinTwister(unset) && spinTwister(unset).spinsUsed === 0)
  const plain = createBoard('plain', { rows: 2, cols: 2 })
  plain.tiles = plain.tiles.map((row) => row.map(() => 'open'))
  check('a stage with no Twister at all shows no widget', !sessionHasTwister(createPlaySession([plain], 0)))
}

console.log('--- 13. Sharing and exports ---')
{
  const chain = mkChain({ perMille: 200, itemRank: 2 }).map((b) => ({ ...b, twisterSpinCost: 7, twisterSpinObjective: 10 }))
  const rcA = mkChain({ boards: 1, values: [150], perMille: 100 }).map((b) => ({ ...b, twisterSpinCost: 11 }))
  const decoded = decodeStage(encodeStage(chain, { rcBoards: rcA }))
  check('a play link carries the cost per spin, objective, ladder and drops for both phases', decoded.boards[0].twisterSpinCost === 7 && decoded.boards[0].twisterSpinObjective === 10 && decoded.rcBoards[0].twisterSpinCost === 11 && decoded.boards[0].rewardChainConfig.twister[3].prizeAmount === 30 && decoded.boards[0].dropGroups[0].items.twister === 2)
  const session = createPlaySession(decoded.boards, 0, { rcBoards: decoded.rcBoards })
  check('a session created from the link needs no options to price a spin', session.twisterSpinCost === 7 && session.rcBoards[0].twisterSpinCost === 11)
  const plan = { main: { ...createTwisterPlan(), targetSpins: 6, targetSpinsOverrides: { 1: 9 } }, rc: createTwisterPlan() }
  const planRound = decodePlan(encodePlan([{ name: 'S1', boards: chain, twisterPlan: plan, twisterCosts: { main: 7, rc: 11 } }]))
  check('a planning link carries the costs and the design inputs', planRound[0].twisterCosts.rc === 11 && planRound[0].twisterPlan.main.targetSpins === 6)

  const sheet = buildV2TwisterSheet(chain, rcA, [], { twisterPlan: plan, segmentIndex: 1 })
  const rows = sheet.rows.map((r) => r.cells)
  check('V2 Twister lists this segment\'s cost for Main and RC as runtime', ['Main', 'RC'].every((l, i) => rows.some((r) => r[0] === 'Runtime - segment-specific' && r[1] === l && r[3] === [7, 11][i])))
  check('...the shared widget rule separately', rows.some((r) => r[0] === 'Runtime - shared across segments' && r[1] === 'Main' && r[3] === 10) && rows.some((r) => r[0] === 'Runtime - shared across segments' && r[1] === 'RC' && String(r[4]).includes('not configured')))
  check('...and the analysis targets as design metadata, using this segment\'s override', rows.some((r) => r[0] === 'Design metadata - not runtime' && r[2].startsWith('Target spins') && r[3] === 9) && rows.some((r) => r[0] === 'Design metadata - not runtime' && r[2].startsWith('Progression checkpoint') && r[3] === 70))
  check('no drop definition is duplicated into the cost sheet', rows.every((r) => !String(r[2]).toLowerCase().includes('weight')))

  const chainSheet = buildV2RewardChainSheet(chain, rcA).rows.map((r) => r.cells)
  // (Two lists that hold the same definitions are listed once, as "Main + RC"; a list that differs is listed on its own.)
  check('the shared Twister ladder is exported with the reward definitions', chainSheet.filter((r) => r[1] === 'Twister DR').length === 4 * new Set(chainSheet.map((r) => r[0])).size && chainSheet.some((r) => /Main/.test(r[0]) && r[3] === 'dr-twister-r4' && r[6] === 30))
  const dropSheet = buildV2DropGroupsSheet(chain, rcA)
  const twCol = dropSheet.columns.indexOf('Twister DR rank')
  check('the shared Twister drop is exported with the drop groups', twCol === 8 && dropSheet.rows.some((r) => r.cells[0] === 'Main' && r.cells[twCol] === 2 && r.cells[3] === 200))

  const dirty = [{ ...chain[0], blockedQueue: [...chain[0].blockedQueue, encodeReward('twister', 2)], semiPlacements: [...chain[0].semiPlacements, { row: 2, col: 0, rank: encodeReward('twister', 1) }], tiles: chain[0].tiles.map((row, r) => row.map((t, c) => (r === 2 && c === 0 ? 'semi' : t))) }]
  const queue = buildBlockedQueueSheet(dirty).rows.map((r) => r.cells)
  check('Twister is never exported as blocked-queue content, even from hand-edited data', queue.every((r) => !String(r[2]).includes('twister')) && queue.length === chain[0].blockedQueue.length && queue.every((r, i) => r[0] === i + 1))
  check('...or as starting-board content', buildBoardLayoutsSheet(dirty).sections[0].rows.flat().every((cell) => !String(cell).includes('twister')))

  const single = buildAllSheetsAsValueRows(chain, rcA, '', [], { twisterPlan: plan, segmentIndex: 0 })
  // (Economist: "remove the reward chain, drop groups, twister, and economy". The Twister page's builder
  // is still read above; the output no longer carries it - so the price of a twist is not exported.)
  check('the per-segment Google Sheets payload has no Twister page any more, and is valid', !single.some((s) => /Twister/.test(s.title)) && validateSheetsPayload(single).length === 0)
  const segs = [
    { name: 'One', boards: chain, recompletionBoards: rcA },
    { name: 'Two', boards: chain.map((b) => ({ ...b, twisterSpinCost: 21 })), recompletionBoards: rcA },
  ]
  const combined = buildAllSegmentsSheetsAsValueRows(segs, { twisterPlan: plan })
  check('the combined payload has no Twister page either', !combined.some((s) => /Twister/.test(s.title)))
  check('the combined payload is valid for Sheets', validateSheetsPayload(combined).length === 0)
  const wb = buildWorkbook(chain, rcA, [], { twisterPlan: plan, segmentIndex: 0 })
  const all = buildAllSegmentsWorkbook(segs, { twisterPlan: plan })
  check('neither workbook carries a Twister page or a page named V2', !wb.worksheets.some((w) => /Twister|V2/.test(w.name)) && !all.worksheets.some((w) => /Twister|V2/.test(w.name)) && all.worksheets.every((w) => w.name.length <= 31))
  check('the Ops pages keep their order, the endless rules last before the CC sheets', wb.worksheets[0].name === 'Event Data' && wb.worksheets[wb.worksheets.length - 16].name === 'Endless' && wb.worksheets[wb.worksheets.length - 15].name === 'CC')
}

console.log(failures === 0 ? `\nALL ${count} TWISTER CHECKS PASSED` : `\n${failures} OF ${count} TWISTER CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
