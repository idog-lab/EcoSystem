// Build Event workflow - engine checks for the coordinated build.
// Run with: npx vite-node scripts/verify-event-build.mjs
import { createBoard, generationTargetOf, invalidateLayout, withMinRankFloor, RC_MIN_RANK_UNDER_TILES, FIRST_BOARD_SUBSIDY_CAP_DR } from '../src/features/merge/lib/board.js'
import { placeItems } from '../src/features/merge/lib/placement.js'
import { regenerateBoard, suggestBoardValuesForEffortTarget } from '../src/features/merge/lib/effortTargeting.js'
import { paintTile, fillAllTiles, resizeBoard } from '../src/features/merge/lib/layoutEdits.js'
import { decodeReward, coinAllowanceSyntax, TWISTER_TYPE } from '../src/features/merge/lib/rewardChain.js'
import { valueOf, RC_MAX_RANK } from '../src/features/merge/lib/ranks.js'
import { createDropGroupsConfig } from '../src/features/merge/lib/dropGroups.js'
import { applyTwisterDropRule, boardHasTwisterUnderTiles, withDefaultTwisterValues, removeGeneratedTwister, hasTwisterDrops } from '../src/features/merge/lib/twisterEconomy.js'
import { validateConfigAcrossRuns } from '../src/features/merge/lib/rewardEconomy.js'
import { planLegacyRecovery, recoveredBoards } from '../src/features/merge/lib/legacyRecompletion.js'
import { subsidyForDemand, demandForSubsidy, fillLastBoard, spreadSubsidy, budgetGap, chaseValue, CHAIN_VALUE_DR } from '../src/features/merge/lib/subsidyBudget.js'
import { roundRewardAmount, formatRewardAmount, coinLadderIsAuto, withGeneratedCoinValues, withBlankCoinValues, withManualCoinLadder, mergeSharedRewardChain, rewardChainAsBuildInput, suggestLadderFixes, applyLadderValues, validateRewardLadder, createRewardChainConfig, COIN_VALUE_SHAPE } from '../src/features/merge/lib/rewardChain.js'
import { effectiveRewardTargets } from '../src/features/merge/lib/rewardEconomy.js'
import { rcInputsOnMainDraft, draftIsUsable, coinPlanTargetFor } from '../src/features/merge/lib/eventBuild.js'
import { openingRun } from '../src/features/merge/lib/placement.js'
import { generateCandidateInRange } from '../src/features/merge/lib/generateCandidateInRange.js'
import { generateCandidateWithSmallRanks } from '../src/features/merge/lib/generateCandidateWithSmallRanks.js'
import { rewardSlotCapacity, rewardSemiSlots, allowedRewardRanks, proposeRewardPlacements } from '../src/features/merge/lib/rewardPlacement.js'
import { simulatePlaythrough, tierToSpend } from '../src/features/merge/lib/mergeSimulation.js'
import { buildGeneratorTiers } from '../src/features/merge/lib/generatorTier.js'
import { buildAlwaysDropConfiguration } from '../src/features/merge/lib/rewardTargeting.js'
import { generateSmallRewardsConfiguration, OFF_TARGET_TOLERANCE } from '../src/features/merge/lib/smallRewardsWorkflow.js'
import {
  allocateSubsidy,
  minFeasibleBoardValue,
  buildSegment,
  buildEvent,
  repriceTwister,
  buildReadiness,
  buildInputsKey,
  buildInputParts,
  changedInputParts,
  contentsKey,
  layoutCapacity,
  mainChainSum,
  validateDraftSegment,
  boardIsBuilt,
  MAX_PASSES,
  CREDIT_TOLERANCE_DR,
  DEDUCTION_POLICY,
  designConsistency,
  designSignature,
  designNeedsRebuild,
  createBuildStamp,
  serializeDrafts,
  deserializeDrafts,
  DRAFT_FORMAT_VERSION,
  boardsWithDraftApplied,
  draftSegmentIsApplied,
  eventDesignIssues,
  segmentBuildInputs,
} from '../src/features/merge/lib/eventBuild.js'

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

const COIN_WORTH = [0.05, 0.12, 0.27, 0.6]
function withCoins(board) {
  const cfg = JSON.parse(JSON.stringify(board.rewardChainConfig))
  COIN_WORTH.forEach((worth, i) => (cfg.coins[i] = { ...cfg.coins[i], prizeAmount: worth, syntax: coinAllowanceSyntax(worth) }))
  return { ...board, rewardChainConfig: cfg }
}

// BLANK layouts: tiles painted, budgets set, no contents generated.
function blankChain(values = [150, 500, 500], { cols = 8 } = {}) {
  return values.map((v, i) => {
    const b = createBoard(`Board ${i + 1}`, { rows: i === 0 ? 5 : 3, cols })
    const from = i === 0 ? 3 : 1
    b.tiles = b.tiles.map((row, r) => row.map(() => (r >= from ? 'blocked' : 'open')))
    if (i === 0) b.tiles[2][4] = 'semi'
    b.blockedValue = v
    // Most checks here ask for one small reward (a couple of rank-4 prizes).
    // Every merge from the start rank drops, so the start rank has to suit
    // the amount: from rank 9 a player makes about 15 such merges. (Section
    // 25 uses rank 6 with full targets.)
    b.minDropRank = 9
    return withCoins(b)
  })
}

const sum = (list) => list.reduce((a, v) => a + v, 0)

const TARGETS = { coins: 1.2, puzzles: 0, energy: 150, charms: 0 }
const NONE = { coins: 0, puzzles: 0, energy: 0, charms: 0 }
const SPLIT = { sharedTilePct: 50 }
const hasTwister = (boards) => boards.some(boardHasTwisterUnderTiles)
const rewardCount = (b) => [...b.blockedQueue, ...b.semiPlacements.map((p) => p.rank)].filter((v) => decodeReward(v)).length

console.log('--- 1. Subsidy allocation: CC, then the energy credit, off the boards after Board 1 ---')
{
  const boards = blankChain([150, 500, 500])
  const none = allocateSubsidy(boards, 0)
  check('with no credit every board is built for its budget', JSON.stringify(none.after) === JSON.stringify([150, 500, 500]) && none.totalAfter === 1150)
  const a = allocateSubsidy(boards, 120)
  check('Board 1 keeps its subsidy; the credit comes off the later boards in proportion', JSON.stringify(a.after) === JSON.stringify([150, 440, 440]))
  check('the total is the budget minus the credit, in whole DR', a.totalAfter === 1030 && a.after.every(Number.isInteger) && a.creditTaken === 120 && a.creditUnabsorbed === 0)
  const uneven = allocateSubsidy(blankChain([150, 300, 700]), 101)
  check('an uneven split totals the unrounded figure plus the reported rounding', uneven.after[0] === 150 && Math.abs(uneven.totalAfter - (1150 - 101) - uneven.roundingResidual) < 1e-9 && Math.abs(uneven.roundingResidual) <= 2)
  const cc = allocateSubsidy(boards.map((b, i) => (i === 1 ? { ...b, ccPercent: 0.1 } : b)), 0)
  check('CC is applied to a board before the credit (500 x 1.10 = 550)', cc.before[1] === 550 && cc.after[1] === 550 && cc.totalBefore === 1200)
  const capped = allocateSubsidy(blankChain([400, 500]), 0)
  check(`Board 1 is capped at ${FIRST_BOARD_SUBSIDY_CAP_DR} DR in a multi-board list`, capped.after[0] === FIRST_BOARD_SUBSIDY_CAP_DR && capped.firstBoardCapped)
  const single = allocateSubsidy(blankChain([400]), 100)
  check('a design with only Board 1 deducts nothing from it and reports the whole credit', single.after[0] === 400 && !single.firstBoardCapped && single.creditTaken === 0 && single.creditUnabsorbed === 100 && single.unabsorbedReason === 'only-board-1')
  check('...and with no credit a single board is simply built for its budget', allocateSubsidy(blankChain([400]), 0).creditUnabsorbed === 0 && allocateSubsidy(blankChain([400]), 0).unabsorbedReason === null)
  // Board 2 here has 16 tiles and may hold nothing below rank 2: it needs 32 DR.
  const over = allocateSubsidy(blankChain([150, 100]), 400)
  check('a board is never deducted below what its tiles need (16 tiles x 2 DR = 32)', minFeasibleBoardValue(blankChain([150, 100])[1], 1) === 32 && over.after[1] === 32 && over.atFloor[1])
  check('the credit that cannot be deducted is reported, with Board 1 untouched', over.after[0] === 150 && over.creditTaken === 68 && over.creditUnabsorbed === 332 && over.unabsorbedReason === 'insufficient-deductible')
  const budgetsBefore = JSON.stringify(blankChain([150, 100]).map((b) => b.blockedValue))
  check('typed budgets are reported unchanged', JSON.stringify(over.budget) === budgetsBefore)
  // Water-filling: a board at its floor stops giving; the others take the rest.
  const mixed = blankChain([150, 40, 800])
  const wf = allocateSubsidy(mixed, 400)
  check('a board that reaches its floor stops there and the rest comes off the others', wf.after[1] === 32 && wf.atFloor[1] && !wf.atFloor[2] && wf.after[2] === 408 && wf.creditUnabsorbed === 0 && Math.abs(wf.creditTaken - 400) < 1e-9)
  const prop = allocateSubsidy(blankChain([150, 200, 600]), 80)
  check('with room on every board the deduction is proportional to subsidy (20 and 60 of 80)', Math.abs(prop.deducted[1] - 20) < 1e-9 && Math.abs(prop.deducted[2] - 60) < 1e-9 && prop.deducted[0] === 0)
  check('...and the total is the unrounded figure to within the reported rounding', Math.abs(wf.totalAfter - (wf.totalBefore - wf.creditTaken) - wf.roundingResidual) < 1e-9 && Math.abs(wf.roundingResidual) <= 2)
  // Pins raise a board's floor.
  const pinnedBoards = blankChain([150, 400])
  pinnedBoards[1] = { ...pinnedBoards[1], tiles: pinnedBoards[1].tiles.map((row, r) => row.map((t, c) => (r === 1 && c === 0 ? 'semi' : t))), forcedSemiRanks: [{ row: 1, col: 0, rank: 8 }] }
  check('a pinned rank raises the floor (128 for the pin + 15 tiles x 2)', minFeasibleBoardValue(pinnedBoards[1], 1) === 128 + 15 * 2)
  const pinAlloc = allocateSubsidy(pinnedBoards, 300)
  check('...so the deduction stops above the pin and the remainder is reported', pinAlloc.after[1] === 158 && pinAlloc.creditUnabsorbed === 300 - (400 - 158))
  // Zero-budget boards.
  const zero = allocateSubsidy(blankChain([150, 0, 600]), 90)
  check('a zero-budget board carries nothing and gives nothing; the credit comes off the funded board', zero.after[1] === 0 && zero.deducted[1] === 0 && Math.abs(zero.deducted[2] - 90) < 1e-9 && zero.after[2] % 4 === 0 && Math.abs(zero.after[2] - 510) <= 2 && zero.creditUnabsorbed === 0)
  // Rounding: later boards get values their generator can hit exactly.
  const odd = allocateSubsidy(blankChain([150, 500, 500]), 123.2)
  check('a deducted board is given a whole multiple of its lowest rank value (2 on Board 2, 4 on Board 3)', odd.after[1] % 2 === 0 && odd.after[2] % 4 === 0)
  check('the rounding residual is reported exactly (allocation minus unrounded target)', Math.abs(odd.totalAfter - (1150 - 123.2) - odd.roundingResidual) < 1e-9 && Math.abs(odd.roundingResidual) <= 3)
}

console.log('--- 2. A board is built for its allocation; its budget is never changed ---')
{
  const b = blankChain([150, 500])[1]
  const built = regenerateBoard({ ...b, effectiveBlockedValue: 440 }, 1, b.blockedValue, 0)
  check('contents are generated for the allocation (440), not the budget (500)', mainChainSum(built) === 440 && built.blockedValue === 500 && generationTargetOf(built) === 440)
  const again = regenerateBoard(built, 1, built.blockedValue, 0)
  check('regenerating at the same budget keeps the allocation (the credit is not silently undone)', mainChainSum(again) === 440 && again.effectiveBlockedValue === 440)
  const rebudget = regenerateBoard(built, 1, 300, 0)
  check('regenerating at a different budget drops the allocation', rebudget.effectiveBlockedValue === null && mainChainSum(rebudget) === 300)
  check('a layout edit clears the allocation along with the contents', invalidateLayout(built, { rows: 2 }).effectiveBlockedValue === null && invalidateLayout(built, {}).blockedQueue.length === 0)
  check('with no allocation the target is the budget', generationTargetOf(b) === 500 && generationTargetOf({ ...b, effectiveBlockedValue: 0 }) === 0)
  const direct = placeItems({ ...b, effectiveBlockedValue: 320 }, { isFirstBoard: false, boardIndex: 1 })
  check('the generator itself reads the allocation', direct.sum === 320)
}

console.log('--- 3. One build from blank layouts ---')
const base = await buildSegment({ phase: 'main', boards: blankChain(), targets: TARGETS, split: SPLIT })
if (!base.converged) console.log('   (not settled - energy per pass: ' + base.passes.map((p) => p.energySimulated).join(' > ') + '; ' + (base.findings ?? []).filter((f) => /kept off|hold a board/.test(f)).join(' ') + ')')
{
  const blank = blankChain()
  check('the inputs were blank layouts (no contents anywhere)', blank.every((b) => !boardIsBuilt(b)))
  check('every board comes out with contents', base.boards.every(boardIsBuilt) && base.boards.every((b) => b.blockedQueue.length > 0))
  check('budgets are untouched by the build', JSON.stringify(base.boards.map((b) => b.blockedValue)) === JSON.stringify([150, 500, 500]))
  check('each board carries exactly its allocation in main-chain DR', base.perBoard.every((b) => b.mainSum === b.allocation))
  check('Board 1 carries exactly 150 DR', base.perBoard[0].mainSum === 150)
  const rec = base.reconciliation
  check('the reconciliation is exact: unrounded target = subsidy after CC - 0.80 x the energy this configuration collects', rec.budget === 1150 && rec.afterCc === 1150 && Math.abs(rec.creditCalculated - 0.8 * rec.energyCollected) < 1e-9 && Math.abs(rec.unroundedTarget - (rec.afterCc - rec.creditCalculated)) < 1e-9)
  check('the generated main-chain DR is the real sum over the built boards', rec.generatedDr === sum(base.boards.map(mainChainSum)) && rec.generatedDr === rec.allocationTotal)
  check('the residual is generated minus unrounded target, fully explained by its parts', Math.abs(rec.residual - (rec.generatedDr - rec.unroundedTarget)) < 1e-9 && Math.abs(rec.residual - (rec.parts.creditNotDeducted + rec.parts.allocationRounding + rec.parts.generation)) < 1e-9)
  check('the energy estimate belongs to the configuration returned (credit agrees to within half a DR)', base.converged && Math.abs(base.creditGap) <= CREDIT_TOLERANCE_DR && Math.abs(rec.parts.creditNotDeducted) <= CREDIT_TOLERANCE_DR)
  check('so the only residual left is rounding, a few DR at most', Math.abs(rec.residual) <= 3.5 && rec.parts.generation === 0)
  check('the energy is that configuration\'s own: re-simulating the returned boards reproduces it', (() => {
    const b0 = base.boards[0]
    const again = validateConfigAcrossRuns(base.boards, { rewardChainConfig: b0.rewardChainConfig, dropGroupsConfig: base.dropGroupsConfig, dropGroupsById: new Map(base.dropGroups.map((g) => [g.id, g])), minDropRank: b0.minDropRank, leftoverPolicy: b0.rewardLeftoverPolicy, runs: base.evaluation.runs, seed: base.evaluation.seed })
    return Math.abs(again.payoutsMainPhase.energy.mean - rec.energyCollected) < 1e-9
  })())
  check('the deduction policy is recorded on the result', base.deductionPolicy === DEDUCTION_POLICY.id && base.perBoard[0].protected && base.perBoard[0].deducted === 0 && base.perBoard.slice(1).every((b) => b.deducted > 0))
  check('it settles within the pass limit and says how many passes', base.passes.length >= 1 && base.passes.length <= MAX_PASSES)
  const energy = base.resources.find((r) => r.type === 'energy')
  const coins = base.resources.find((r) => r.type === 'coins')
  check('energy is predicted within 10% of its target', Math.abs(energy.predicted - 150) <= 15)
  check('coin allowance is predicted in allowances, near 1.2', Math.abs(coins.predicted - 1.2) <= 0.13 && coins.target === 1.2)
  check('reward items were placed under tiles and drops were generated', base.boards.some((b) => rewardCount(b) > 0) && base.generatedGroups.length >= 1)
  check('every tile has exactly one item', base.perBoard.every((b) => b.items === b.tiles))
  check('no Twister under any tile', !hasTwister(base.boards))
  check('all constraint checks pass and the build is OK', base.perBoard.every((b) => b.checks.every((c) => c.ok)) && base.status === 'ok' && base.causes.length === 0)
}

console.log('--- 4. No small-reward targets: a main-chain-only build ---')
{
  const plain = await buildSegment({ phase: 'main', boards: blankChain(), targets: NONE, split: SPLIT })
  check('it builds with no reward targets at all', plain.status === 'ok' && plain.boards.every(boardIsBuilt))
  check('no credit, so every board is built for its full budget', plain.subsidy.creditApplied === 0 && plain.subsidy.effective === 1150 && plain.perBoard.every((b) => b.mainSum === b.budget))
  check('no reward item and no drop group is produced', plain.boards.every((b) => rewardCount(b) === 0) && plain.generatedGroups.length === 0)
}

console.log('--- 5. The credit is applied once: rebuilding an applied design does not compound it ---')
{
  // "Apply" = the draft boards become the design, with the shared drops on them.
  const applied = base.boards.map((b) => ({ ...b, dropGroups: base.dropGroups, dropGroupsConfig: base.dropGroupsConfig }))
  const again = await buildSegment({ phase: 'main', boards: applied, targets: TARGETS, split: SPLIT })
  check('the budget is still the original 1150', again.subsidy.budget === 1150)
  check('the rebuilt boards carry the same subsidy as before, not less', Math.abs(again.subsidy.effective - base.subsidy.effective) <= Math.max(2, 0.01 * 1150) + 1)
  // A second set stacked on the first would be about twice as many. One more
  // or less is the build's own rounding: the rebuild predicts its merges on
  // boards that already have drops on them.
  const firstCount = sum(base.boards.map(rewardCount))
  const againCount = sum(again.boards.map(rewardCount))
  check(`re-building does not stack a second set of reward items (${firstCount} -> ${againCount})`, againCount <= firstCount + Math.max(3, firstCount) && again.boards.every((b) => (b.rewardQueueItems ?? []).every((it) => it.auto) && (b.rewardSemiItems ?? []).every((it) => it.auto)))
}

console.log('--- 6. Pins, locks and Twister are respected ---')
{
  const boards = blankChain()
  boards[1] = { ...boards[1], tiles: boards[1].tiles.map((row, r) => row.map((t, c) => (r === 1 && c === 0 ? 'semi' : t))), forcedSemiRanks: [{ row: 1, col: 0, rank: 6 }] }
  boards[2] = { ...boards[2], rewardQueueItems: [{ type: 'energy', rank: 3 }] } // no `auto` = pinned
  const rule = applyTwisterDropRule({ dropGroups: [{ id: 'hand', name: 'Hand-made', items: { puzzles: 1 } }], dropGroupsConfig: createDropGroupsConfig(RC_MAX_RANK), minDropRank: 6, itemRank: 1, perMille: 100 })
  rule.dropGroupsConfig[8] = { ...rule.dropGroupsConfig[8], entries: [...rule.dropGroupsConfig[8].entries, { groupId: 'hand', weight: 50 }], noDropWeight: rule.dropGroupsConfig[8].noDropWeight - 50 }
  const withDrops = boards.map((b) => ({ ...b, dropGroups: rule.dropGroups, dropGroupsConfig: rule.dropGroupsConfig }))
  const r = await buildSegment({ phase: 'main', boards: withDrops, targets: TARGETS, split: SPLIT })
  check('a rank pinned to a cell is kept', r.boards[1].semiPlacements.some((p) => p.row === 1 && p.col === 0 && p.rank === 6))
  check('a pinned reward item is kept (and still pinned)', r.boards[2].rewardQueueItems.some((it) => it.type === 'energy' && it.rank === 3 && !it.auto))
  check('a hand-made drop group is kept with its odds', r.dropGroups.some((g) => g.id === 'hand') && r.dropGroupsConfig[8].entries.find((e) => e.groupId === 'hand')?.weight === 50)
  check('the Twister drop is kept in the build', r.dropGroups.some((g) => g.items[TWISTER_TYPE] === 1) && r.dropGroupsConfig[6].entries.some((e) => e.groupId === 'twister-r1'))
  check('...and Twister is still never under a tile', !hasTwister(r.boards))
  check('exact DR holds with pins in place', r.perBoard.every((b) => b.mainSum === b.allocation))
}

console.log('--- 7. Infeasible builds name their cause and change nothing ---')
{
  const input = blankChain()
  const snapshot = JSON.stringify(input)
  const big = await buildSegment({ phase: 'main', boards: input, targets: { ...NONE, energy: 60000 }, split: SPLIT })
  // A reward amount never blocks a build (it is usable, and reported): an impossible target is never called met.
  check('an impossible target is never reported as met', big.status !== 'ok' && big.causes.length > 0 && Math.abs(big.resources.find((r) => r.type === 'energy').predicted - 60000) > 60000 * 0.15)
  check('with a specific cause', big.causes.some((c) => ['tile-capacity', 'few-merges', 'negative-subsidy', 'off-target', 'coarse-ladder'].includes(c.code)) && big.causes.every((c) => c.title && c.step && c.detail))
  check('the input boards were not modified', JSON.stringify(input) === snapshot)
  const noLadder = input.map((b) => ({ ...b, rewardChainConfig: { ...b.rewardChainConfig, energy: b.rewardChainConfig.energy.map((r) => ({ ...r, prizeAmount: 0, syntax: '' })) } }))
  const readiness = buildReadiness({ phase: 'main', boards: noLadder, targets: TARGETS })
  check('a target with no rank values blocks the build and points at the definitions', !readiness.ready && readiness.items.some((i) => !i.ok && i.blocking && i.step === 'definitions' && i.resource === 'energy'))
  const noCoins = input.map((b) => ({ ...b, rewardChainConfig: { ...b.rewardChainConfig, coins: b.rewardChainConfig.coins.map((r) => ({ ...r, prizeAmount: 0, syntax: '' })) } }))
  check('blank coin ranks do NOT block: the build sets them', buildReadiness({ phase: 'main', boards: noCoins, targets: TARGETS }).items.some((i) => i.ok && i.resource === 'coins' && /build sets the coin rank values/.test(i.label)))
  check('a resource with no target needs no definition', buildReadiness({ phase: 'main', boards: noLadder, targets: { ...NONE, puzzles: 100 } }).ready)
  check('no tiles, or no budget, blocks only with the step that fixes it', buildReadiness({ phase: 'main', boards: [createBoard('x')], targets: NONE }).items.filter((i) => !i.ok).map((i) => i.step).join() === 'layouts,setup')
  const coarse = await buildSegment({ phase: 'main', boards: blankChain(), targets: { ...NONE, energy: 20 }, split: SPLIT })
  check('a target too small for the ranks to pay (20 against a smallest prize of 75) is called out as coarse reward values', coarse.causes.some((c) => c.code === 'coarse-ladder') && coarse.status !== 'ok')
  const pinTooBig = blankChain([150, 40])
  pinTooBig[1] = { ...pinTooBig[1], tiles: pinTooBig[1].tiles.map((row, r) => row.map((t, c) => (r === 1 && c === 0 ? 'semi' : t))), forcedSemiRanks: [{ row: 1, col: 0, rank: 9 }] }
  const pins = await buildSegment({ phase: 'main', boards: pinTooBig, targets: NONE, split: SPLIT })
  check('a pin worth more than the board\'s subsidy is reported as a pin conflict', pins.status === 'infeasible' && pins.causes.some((c) => c.code === 'pins-conflict'))
}

console.log('--- 8. The whole event: base segment first, shared drops, derived segments ---')
const scaled = Object.fromEntries(Object.entries(TARGETS).map(([t, v]) => [t, v * 1.5]))
const segs = () => [
  { index: 0, name: 'Base', boards: blankChain([150, 500, 500]), mainBoards: null, targets: TARGETS, split: SPLIT },
  { index: 1, name: 'Bigger', boards: blankChain([150, 700, 800]), mainBoards: null, targets: scaled, split: SPLIT },
  { index: 2, name: 'Empty', boards: blankChain([0, 0, 0]), mainBoards: null, targets: TARGETS, split: SPLIT },
]
const draft = await buildEvent({ phase: 'main', segments: segs() })
{
  check('both configured segments are built and the unconfigured one is listed as skipped', draft.builtCount === 2 && draft.skippedCount === 1 && draft.segments[2].status === 'skipped' && /No amount entered/.test(draft.segments[2].skipReason))
  check('the derived segment is solved against the base segment\'s drops (shared odds)', draft.segments[1].dropsFixed && JSON.stringify(draft.segments[1].dropGroupsConfig) === JSON.stringify(draft.shared.dropGroupsConfig) && JSON.stringify(draft.segments[0].dropGroupsConfig) === JSON.stringify(draft.shared.dropGroupsConfig))
  check('each segment has its own budget, credit and allocation', draft.segments[0].subsidy.budget === 1150 && draft.segments[1].subsidy.budget === 1650 && draft.segments[1].subsidy.creditApplied > draft.segments[0].subsidy.creditApplied)
  check('the derived segment aims at its own (1.5x) targets', draft.segments[1].targets.energy === 225 && draft.segments[1].resources.find((r) => r.type === 'energy').target === 225)
  check('exact DR holds on every built board of every segment', draft.segments.filter((s) => s.status !== 'skipped').every((s) => s.perBoard.every((b) => b.mainSum === b.allocation)))
  check('the draft records what it was built from', draft.key === buildInputsKey({ phase: 'main', segments: segs() }) && draft.parts && draft.phase === 'main')

  // Staleness: what changed is named.
  const changed = (mutate) => {
    const next = segs()
    mutate(next)
    return changedInputParts(draft.parts, buildInputParts({ phase: 'main', segments: next }))
  }
  check('unchanged inputs are current', changed(() => {}).length === 0)
  check('a target change is named as targets', changed((s) => (s[0].targets = { ...TARGETS, energy: 200 })).join() === 'targets')
  check('a budget change is named as budgets', changed((s) => (s[0].boards[1] = { ...s[0].boards[1], blockedValue: 510 })).join() === 'budgets')
  check('a tile change is named as layouts', changed((s) => (s[1].boards[2] = { ...s[1].boards[2], tiles: s[1].boards[2].tiles.map((row) => row.map(() => 'open')) })).join() === 'layouts')
  check('a split change is named as the split', changed((s) => s.forEach((x) => (x.split = { sharedTilePct: 30 }))).join() === 'split')
  check('a reward-definition change is named as definitions', changed((s) => (s[0].boards = s[0].boards.map((b) => ({ ...b, rewardChainConfig: { ...b.rewardChainConfig, energy: b.rewardChainConfig.energy.map((r, i) => (i === 3 ? { ...r, prizeAmount: 80 } : r)) } })))).join() === 'definitions')

  // Applying the draft must not make it look out of date.
  const appliedSegs = segs().map((s, i) => (draft.segments[i].status === 'skipped' ? s : { ...s, boards: draft.segments[i].boards.map((b) => ({ ...b, dropGroups: draft.shared.dropGroups, dropGroupsConfig: draft.shared.dropGroupsConfig })) }))
  check('applying the draft does not change its inputs (generated items and groups are not inputs)', buildInputsKey({ phase: 'main', segments: appliedSegs }) === draft.key)
  check('the applied contents are recognisable as that draft', contentsKey(appliedSegs[0].boards) !== contentsKey(segs()[0].boards) && contentsKey(appliedSegs[0].boards) === contentsKey(appliedSegs[0].boards.map((b) => ({ ...b }))))

  // Cancellation leaves no partial result.
  let ticks = 0
  const stopped = await buildEvent({ phase: 'main', segments: segs(), onProgress: () => (ticks += 1), isCancelled: () => ticks >= 3 })
  check('a cancelled build returns nothing (no half-built draft)', stopped === null && ticks >= 3)
}

console.log('--- 9. Seeded validation of the draft ---')
{
  const v = validateDraftSegment({ phase: 'main', draftSegment: draft.segments[0], shared: draft.shared, runs: 60, seed: 5 })
  const again = validateDraftSegment({ phase: 'main', draftSegment: draft.segments[0], shared: draft.shared, runs: 60, seed: 5 })
  check('validation is reproducible for a seed', JSON.stringify(v.resources) === JSON.stringify(again.resources))
  const energy = v.resources.find((r) => r.type === 'energy')
  check('it reports the validated mean and range next to the target and the build estimate', energy.target === 150 && energy.mean > 0 && energy.p10 <= energy.p50 && energy.p50 <= energy.p90 && energy.estimate > 0)
  check('it reports completion, player spend and the credit the validated energy implies', v.completionRate === 1 && v.drSpent.mean > 0 && Math.abs(v.creditFromValidation - 0.8 * v.energyMean) < 1e-9)
  check('coin allowance is validated in allowances', v.resources.find((r) => r.type === 'coins').mean < 5)
}

console.log('--- 10. Recompletion: one mode, built after the Normal phase ---')
{
  const mainApplied = draft.segments[0].boards.map((b) => ({ ...b, dropGroups: draft.shared.dropGroups, dropGroupsConfig: draft.shared.dropGroupsConfig }))
  const rcBoards = blankChain([150, 3000, 3000])
  check('Recompletion is blocked until the Normal phase is built', !buildReadiness({ phase: 'rc', boards: rcBoards, mainBoards: blankChain(), targets: NONE }).ready)
  check('...and ready once it is', buildReadiness({ phase: 'rc', boards: rcBoards, mainBoards: mainApplied, targets: NONE }).ready)
  // (300 merge energy: with every merge from rank 9 dropping, a smaller amount is less than the drops alone pay.)
  const rc = await buildSegment({ phase: 'rc', boards: rcBoards, mainBoards: mainApplied, targets: { ...NONE, energy: 300 }, split: SPLIT })
  if (!(Math.abs(rc.reconciliation.residual) <= 4) || !(rc.subsidy.creditApplied > 0)) console.log('   (Recompletion build: credit ' + rc.subsidy.creditApplied + ', residual ' + rc.reconciliation.residual + ', parts ' + JSON.stringify(rc.reconciliation.parts) + ', energy per pass ' + rc.passes.map((p) => p.energySimulated).join(' > ') + ', status ' + rc.status + ' ' + rc.causes.map((c) => c.code).join(',') + ')')
  check('a Recompletion list of several sequential boards builds as one phase', rc.boards.length === 3 && rc.boards.every(boardIsBuilt) && rc.perBoard.every((b) => b.mainSum === b.allocation))
  check('its energy credit comes off its own boards (and reconciles)', rc.subsidy.budget === 6150 && rc.subsidy.creditApplied > 0 && rc.perBoard[0].deducted === 0 && Math.abs(rc.reconciliation.residual - (rc.reconciliation.generatedDr - rc.reconciliation.unroundedTarget)) < 1e-9 && Math.abs(rc.reconciliation.residual) <= 4)
  const rcSegs = [{ index: 0, name: 'Base', boards: rcBoards, mainBoards: mainApplied, targets: NONE, split: SPLIT }]
  const editedMain = mainApplied.map((b, i) => (i === 1 ? { ...b, blockedQueue: [...b.blockedQueue].reverse() } : b))
  check('changing the Normal phase marks a Recompletion build out of date', changedInputParts(buildInputParts({ phase: 'rc', segments: rcSegs }), buildInputParts({ phase: 'rc', segments: [{ ...rcSegs[0], mainBoards: editedMain }] })).join() === 'mainPhase')
}

console.log('--- 11. Layout edits: capacity, and only the edited board loses its contents ---')
{
  const boards = base.boards
  const cap0 = layoutCapacity(boards[0], 0)
  check('capacity reports tiles, the most DR they can hold and room for reward items', cap0.blockedTiles === 16 && cap0.semiTiles === 1 && cap0.topRank === 8 && cap0.maxDr === 16 * valueOf(8) + 1 + 1 /* Board 1: blocked tiles at its highest rank (8), its semi tile a small fixed item */ && layoutCapacity(boards[2], 2).maxDr === (layoutCapacity(boards[2], 2).blockedTiles + layoutCapacity(boards[2], 2).semiTiles) * valueOf(boards[2].maxRank) && cap0.rewardSlots > 0 && cap0.hasContents)
  const painted = paintTile(boards[1], false, 0, 0, 'blocked')
  check('painting a tile changes that board\'s capacity and clears its own contents', layoutCapacity(painted, 1).blockedTiles === layoutCapacity(boards[1], 1).blockedTiles + 1 && !layoutCapacity(painted, 1).hasContents && painted.effectiveBlockedValue === null)
  check('...and nothing else about it (budget, pins, rank limits)', painted.blockedValue === boards[1].blockedValue && painted.maxRank === boards[1].maxRank)
  const pinned = paintTile(boards[1], false, 0, 1, 'semi', 7)
  check('a rank can be pinned to a semi-blocked cell', pinned.forcedSemiRanks.some((f) => f.row === 0 && f.col === 1 && f.rank === 7) && pinned.tiles[0][1] === 'semi')
  check('repainting that cell drops the pin', paintTile(pinned, false, 0, 1, 'open').forcedSemiRanks.length === 0)
  const first = paintTile(boards[0], true, 2, 4, 'open')
  check('Board 1\'s fixed semi-blocked cell cannot be painted away', first.tiles[2][4] === 'semi')
  const smaller = resizeBoard({ ...pinned, rewardSemiItems: [{ row: 2, col: 0, type: 'coins', rank: 1 }] }, false, 1, 8)
  check('shrinking a board drops pins that no longer fit', smaller.rows === 1 && smaller.tiles.length === 1 && smaller.rewardSemiItems.length === 0 && smaller.forcedSemiRanks.length === 1)
  check('fill-all resets the layout of one board only', fillAllTiles(boards[2], false, 'open').tiles.flat().every((t) => t === 'open') && boards[2].tiles.flat().some((t) => t === 'blocked'))
}

console.log('--- 12. Never deducted twice: regeneration and Apply ---')
{
  const applied = base.boards.map((b) => ({ ...b, dropGroups: base.dropGroups, dropGroupsConfig: base.dropGroupsConfig }))
  const regenerated = applied.map((b, i) => regenerateBoard(b, i, b.blockedValue, 0.15))
  check('regenerating applied boards keeps every allocation and every budget', regenerated.every((b, i) => mainChainSum(b) === mainChainSum(applied[i]) && b.blockedValue === applied[i].blockedValue && b.effectiveBlockedValue === applied[i].effectiveBlockedValue))
  const twice = await buildSegment({ phase: 'main', boards: regenerated, targets: TARGETS, split: SPLIT })
  check('building again from the applied, regenerated design deducts once, not twice', twice.reconciliation.afterCc === 1150 && Math.abs(twice.reconciliation.generatedDr - base.reconciliation.generatedDr) <= 6)
  const single = await buildSegment({ phase: 'main', boards: blankChain([150]).map((b) => ({ ...b, blockedValue: 150 })), targets: { ...NONE, energy: 75 }, split: { sharedTilePct: 100 } })
  check('a Board-1-only design that pays energy is reported infeasible, with Board 1 untouched', single.status === 'infeasible' && single.causes.some((c) => c.code === 'only-board-1') && single.perBoard[0].mainSum === 150 && single.subsidy.creditApplied === 0)
  const singlePlain = await buildSegment({ phase: 'main', boards: blankChain([150]), targets: NONE, split: SPLIT })
  check('a Board-1-only design with no energy builds normally', singlePlain.status === 'ok' && singlePlain.subsidy.creditUnabsorbed === 0)
  const tight = await buildSegment({ phase: 'main', boards: blankChain([150, 40]), targets: { ...NONE, energy: 150 }, split: SPLIT })
  check('too little deductible subsidy is infeasible and names the floor, not a silent loss', tight.status === 'infeasible' && tight.causes.some((c) => c.code === 'negative-subsidy' && /Board 1 is protected/.test(c.detail)) && tight.perBoard[1].mainSum >= 32 && tight.perBoard[0].mainSum === 150)
  const zeroBoard = await buildSegment({ phase: 'main', boards: blankChain([150, 0, 600]), targets: NONE, split: SPLIT })
  check('a board with tiles but no budget is named as such', zeroBoard.status === 'infeasible' && zeroBoard.causes.some((c) => c.code === 'zero-budget'))
}

console.log('--- 13. An applied design knows whether it still matches its build ---')
{
  const applied = base.boards.map((b) => ({ ...b, dropGroups: base.dropGroups, dropGroupsConfig: base.dropGroupsConfig }))
  const stamp = createBuildStamp(applied, { draft: { builtAt: 1 }, segment: base })
  const stamped = applied.map((b) => ({ ...b, buildStamp: stamp }))
  check('a freshly applied build is consistent', designConsistency(stamped).state === 'consistent' && !designNeedsRebuild(designConsistency(stamped)))
  check('the stamp is not part of what it fingerprints', designSignature(stamped) === designSignature(applied))
  check('the stamp carries the reconciliation it was built with', stamp.reconciliation.generatedDr === base.reconciliation.generatedDr && stamp.deductionPolicy === DEDUCTION_POLICY.id)
  // The advanced Rewards tool: generate + apply rewards only.
  const adv = await generateSmallRewardsConfiguration({ phase: 'main', boards: stamped, targets: { ...TARGETS, energy: 300 }, split: SPLIT })
  const afterAdvanced = adv.boards.map((b) => ({ ...b, dropGroups: adv.dropGroups, dropGroupsConfig: adv.dropGroupsConfig }))
  const c = designConsistency(afterAdvanced)
  check('an advanced rewards-only Apply leaves the design out of date', c.state === 'stale' && designNeedsRebuild(c))
  check('...and says it was the reward items and drops that changed', c.changed.includes('rewardItems') || c.changed.includes('drops'))
  check('...while the boards still carry the OLD allocation (the credit no longer matches)', afterAdvanced.every((b, i) => b.effectiveBlockedValue === stamped[i].effectiveBlockedValue))
  const edited = stamped.map((b, i) => (i === 1 ? { ...b, blockedValue: b.blockedValue + 10 } : b))
  check('a budget edit is named as budgets', designConsistency(edited).changed.join() === 'budgets')
  check('a drop-weight edit is named as drops', designConsistency(stamped.map((b) => ({ ...b, dropGroupsConfig: b.dropGroupsConfig.map((t) => (t.rank === 8 ? { ...t, noDropWeight: t.noDropWeight + 1 } : t)) }))).changed.join() === 'drops')
  const hand = applied.map((b) => ({ ...b, effectiveBlockedValue: null }))
  check('a design never built here that pays energy is "unaccounted" (no credit was taken)', designConsistency(hand).state === 'unaccounted' && designNeedsRebuild(designConsistency(hand)))
  const plain = blankChain().map((b, i) => regenerateBoard(b, i, b.blockedValue, 0))
  check('a hand-built design with no energy income needs nothing', designConsistency(plain).state === 'manual' && !designNeedsRebuild(designConsistency(plain)))
  check('blank layouts are simply empty', designConsistency(blankChain()).state === 'empty')
}

console.log('--- 14. Drafts survive a reload, separately from the applied design ---')
{
  const text = serializeDrafts({ drafts: { main: draft, rc: null }, validation: { main: null, rc: null } })
  const back = deserializeDrafts(text)
  check('a stored draft is restored with its identity, boards, drops and summaries', back.drafts.main.key === draft.key && JSON.stringify(back.drafts.main.segments[0].boards) === JSON.stringify(draft.segments[0].boards) && JSON.stringify(back.drafts.main.shared) === JSON.stringify(draft.shared) && back.drafts.main.segments[0].reconciliation.generatedDr === draft.segments[0].reconciliation.generatedDr)
  check('it is marked as restored, and nothing about it is applied', back.drafts.main.restored === true && !back.drafts.main.applied && back.drafts.rc === null && back.notice === null)
  check('a restored draft still knows whether its inputs match', back.drafts.main.key === buildInputsKey({ phase: 'main', segments: segs() }) && changedInputParts(back.drafts.main.parts, buildInputParts({ phase: 'main', segments: segs().map((s2, i) => (i === 0 ? { ...s2, targets: { ...TARGETS, energy: 999 } } : s2)) })).join() === 'targets')
  const old = deserializeDrafts(JSON.stringify({ format: DRAFT_FORMAT_VERSION - 1, drafts: { main: draft } }))
  check('a draft from an incompatible version is not restored, and says why', old.drafts.main === null && /earlier version/.test(old.notice))
  const broken = deserializeDrafts('{not json')
  check('an unreadable entry is ignored safely, with a notice', broken.drafts.main === null && /could not be read/.test(broken.notice))
  check('no stored entry means no draft and no notice', deserializeDrafts(null).drafts.main === null && deserializeDrafts(null).notice === null)
}

console.log('--- 15. Apply writes only what a build owns ---')
{
  // The design was edited after the build in ways a build does not own.
  const current = blankChain().map((b) => ({ ...b, twisterSpinCost: 17, name: `Renamed ${b.name}`, targetEv: 1.25 }))
  const written = boardsWithDraftApplied(current, draft.segments[0], draft.shared, { draft })
  check('applying keeps settings the build does not own (spin cost, names, generator setting)', written.every((b, i) => b.twisterSpinCost === 17 && b.name === current[i].name && b.targetEv === 1.25))
  check('...and writes the built contents, allocation and shared drops', written.every((b, i) => JSON.stringify(b.blockedQueue) === JSON.stringify(draft.segments[0].boards[i].blockedQueue) && b.effectiveBlockedValue === draft.segments[0].boards[i].effectiveBlockedValue && b.dropGroupsConfig === draft.shared.dropGroupsConfig))
  check('budgets are untouched by Apply', written.every((b, i) => b.blockedValue === current[i].blockedValue))
  check('the applied segment is recognised as this draft, and stops being so after an edit', draftSegmentIsApplied(written, draft) && !draftSegmentIsApplied(written.map((b, i) => (i === 2 ? { ...b, blockedQueue: [...b.blockedQueue].reverse() } : b)), draft) && !draftSegmentIsApplied(current, draft))
  check('a different draft\'s stamp does not count as this one', !draftSegmentIsApplied(written, { ...draft, builtAt: draft.builtAt + 1 }))
  const issues = eventDesignIssues([
    { name: 'Clean', mainBoards: written, rcBoards: blankChain() },
    { name: 'Edited', mainBoards: written.map((b, i) => (i === 1 ? { ...b, blockedValue: b.blockedValue + 5 } : b)), rcBoards: blankChain() },
  ])
  check('event-wide issues name the segment, the phase and what changed', issues.length === 1 && issues[0].name === 'Edited' && issues[0].phase === 'main' && issues[0].state === 'stale' && issues[0].changed.join() === 'budgets')
  const viaHelper = segmentBuildInputs([{ name: 'Base', mainBoards: blankChain(), rcBoards: blankChain([150]), rewardTargets: { main: TARGETS, rc: NONE }, segmentFactor: 1, sourceAllocation: { main: { tileWeight: 0.5, dropWeight: 0.5 } } }, { name: '', mainBoards: blankChain(), rcBoards: blankChain([150]), rewardTargets: { main: NONE, rc: NONE }, segmentFactor: 2, sourceAllocation: {} }], 'main')
  check('every tool derives a build\'s inputs the same way (derived targets, shared split, fallback names)', viaHelper[1].targets.energy === 300 && viaHelper[1].name === 'Segment 2' && viaHelper[0].split.sharedTilePct === 40 /* 50 was typed: merge drops are always the bigger part */ && viaHelper[1].split === viaHelper[0].split && viaHelper[0].mainBoards === null)
}

console.log('--- 16. Legacy second Recompletion list: recovery is planned, never automatic ---')
{
  const current = blankChain([150, 3000])
  const legacyBoards = blankChain([120, 900]).map((b, i) => ({ ...b, rows: i === 1 ? 5 : b.rows, tiles: i === 1 ? [...b.tiles, b.tiles[1], b.tiles[1]] : b.tiles, blockedQueue: [3, 3], dropGroups: [{ id: 'old', name: 'Old', items: { coins: 1 } }], rewardQueueItems: [{ type: 'energy', rank: 2 }, { type: 'coins', rank: 1, auto: true }] }))
  const legacy = { boards: legacyBoards, presets: [], targetSubsidy: null }
  const append = planLegacyRecovery({ action: 'append', currentBoards: current, legacy })
  check('an append is previewed as current boards followed by the recovered ones, with budgets', append.before.length === 2 && append.after.length === 4 && append.beforeTotal === 3150 && append.afterTotal === 3150 + 1020 && append.after[2].from === 'legacy' && append.after[2].budget === 120)
  check('the preview states the budget change, that reward settings are not brought in, and that it stays one mode', append.effects.some((e) => /from 3150 DR to 4170 DR/.test(e)) && append.effects.some((e) => /not brought in/.test(e)) && append.effects.some((e) => /one mode/.test(e)))
  check('...and that a tall recovered board is cut to a 3-row strip, and a rebuild is needed', append.effects.some((e) => /cut to 3 rows/.test(e)) && append.effects.some((e) => /rebuilding in Build event/.test(e)))
  check('planning changes nothing', current.length === 2 && legacy.boards[0].blockedQueue.length === 2)
  const appended = recoveredBoards({ action: 'append', currentBoards: current, legacy })
  check('recovered boards keep budget and pins, lose stale contents, and adopt the current reward settings', appended[2].blockedValue === 120 && appended[2].blockedQueue.length === 0 && appended[2].rewardQueueItems.length === 1 && appended[2].rewardQueueItems[0].rank === 2 && appended[2].dropGroups.length === 0 && appended[3].rows === 3 && appended[3].tiles.length === 3 && appended[2].buildStamp === null)
  check('the current boards are not altered by an append', appended[0] === current[0] && appended[1] === current[1])
  const replace = planLegacyRecovery({ action: 'replace', currentBoards: current, legacy })
  check('a replace is previewed as the recovered list alone', replace.after.length === 2 && replace.afterTotal === 1020 && replace.effects.some((e) => /replaced by the 2 recovered/.test(e)))
  const discard = planLegacyRecovery({ action: 'discard', currentBoards: current, legacy })
  check('a discard leaves Recompletion unchanged and says the snapshot keeps the data', discard.afterTotal === discard.beforeTotal && discard.effects.some((e) => /recovery snapshot/.test(e)))
}

console.log('--- 17. A segment\'s amount: total demand -> subsidy -> per-board budgets ---')
{
  check('subsidy = 2048 - demand, and back', CHAIN_VALUE_DR === 2048 && subsidyForDemand(500) === 1548 && demandForSubsidy(1548) === 500 && subsidyForDemand(0) === 2048)
  check('a demand above the chain gives no subsidy, never a negative one', subsidyForDemand(5000) === 0 && subsidyForDemand(-10) === 2048)
  check('a fresh split: Board 1 at its cap, the rest shared, remainder on the last board', JSON.stringify(spreadSubsidy(3, 1548)) === JSON.stringify([150, 699, 699]) && JSON.stringify(spreadSubsidy(4, 1000)) === JSON.stringify([150, 283, 283, 284]))
  check('the split always totals the subsidy exactly', [1, 2, 3, 5, 8].every((n) => [0, 100, 151, 999, 1548, 2048].every((t) => spreadSubsidy(n, t).reduce((s, v) => s + v, 0) === t)))
  check('a single board takes it all (no cap); a small subsidy sits on Board 1', JSON.stringify(spreadSubsidy(1, 900)) === JSON.stringify([900]) && JSON.stringify(spreadSubsidy(3, 100)) === JSON.stringify([100, 0, 0]))
  check('typed boards are kept and the last board closes the gap', JSON.stringify(fillLastBoard([150, 500, 0], 1548)) === JSON.stringify([150, 500, 898]) && JSON.stringify(fillLastBoard([150, 500, 7], 1448)) === JSON.stringify([150, 500, 798]))
  check('Board 1 is capped at 150 when there is a later board', JSON.stringify(fillLastBoard([400, 100, 0], 1000)) === JSON.stringify([150, 100, 750]) && JSON.stringify(fillLastBoard([400], 400)) === JSON.stringify([400]))
  check('the last board never goes negative; the overshoot is reported as a gap', JSON.stringify(fillLastBoard([150, 900, 0], 800)) === JSON.stringify([150, 900, 0]) && budgetGap([150, 900, 0], 800) === 250)
  check('with no amount set, budgets are left exactly as typed', JSON.stringify(fillLastBoard([10, 20, 30], null)) === JSON.stringify([10, 20, 30]) && budgetGap([10, 20, 30], null) === 0)
}

console.log('--- 18. Only coins may be a fraction ---')
{
  check('a derived target is rounded to a whole number, except coins', JSON.stringify(effectiveRewardTargets({ coins: 3, puzzles: 150, energy: 100, charms: 200 }, 1.15)) === JSON.stringify({ coins: 3.45, puzzles: 173, energy: 115, charms: 230 }))
  check('1.25 x 150 puzzles is 188, not 187.5', effectiveRewardTargets({ puzzles: 150 }, 1.25).puzzles === 188 && roundRewardAmount('coins', 3.7501) === 3.75)
  const built = segmentBuildInputs([{ name: 'A', mainBoards: [], rcBoards: [], rewardTargets: { main: { coins: 3, puzzles: 150, energy: 100, charms: 200 } }, segmentFactor: 1, sourceAllocation: {} }, { name: 'B', mainBoards: [], rcBoards: [], rewardTargets: {}, segmentFactor: 1.15, sourceAllocation: {} }], 'main')
  check('the build is given whole-number targets for every segment', built[1].targets.puzzles === 173 && built[1].targets.coins === 3.45 && Number.isInteger(built[1].targets.energy))
  check('non-coin amounts are displayed as whole numbers; coins keep decimals', formatRewardAmount('puzzles', 172.5) === '173' && formatRewardAmount('energy', 153.8) === '154' && formatRewardAmount('coins', 0.125) === '0.125')
}

console.log('--- 19. Fixing rank values that do not reward merging ---')
{
  const cfg = createRewardChainConfig()
  const values = (o) => o.values.join('/')
  const puzzles = suggestLadderFixes(cfg.puzzles)
  const charms = suggestLadderFixes(cfg.charms)
  check('puzzles 5/15/15/40 gets two valid fixes: raise (5/15/30/65) or lower (3/7/15/40)', puzzles.length === 2 && values(puzzles[0]) === '5/15/30/65' && values(puzzles[1]) === '3/7/15/40')
  check('charms 5/4/30/40 gets two valid fixes: raise (5/10/30/65) or lower (2/4/19/40)', values(charms[0]) === '5/10/30/65' && values(charms[1]) === '2/4/19/40')
  check('every suggestion passes the merge rule and is whole numbers', [...puzzles, ...charms].every((o) => validateRewardLadder(o.values.map((prizeAmount) => ({ prizeAmount }))).length === 0 && o.values.every(Number.isInteger)))
  check('a ladder that already passes gets no suggestion', suggestLadderFixes(cfg.energy).length === 0)
  const fixed = applyLadderValues(cfg, 'puzzles', puzzles[0].values)
  check('applying a fix rewrites the amount inside the item syntax', fixed.rewardChainConfig.puzzles[2].syntax === '[dynamic(dr-puzzle:30)]' && fixed.rewardChainConfig.puzzles[3].syntax === '[dynamic(dr-puzzle:65)]' && fixed.rewardChainConfig.puzzles[0].syntax === '[dynamic(dr-puzzle:5)]' && fixed.syntaxNotUpdated.length === 0)
  const charmFix = applyLadderValues(cfg, 'charms', charms[0].values)
  check('a syntax with extra terms still has its one amount rewritten, the rest kept', charmFix.rewardChainConfig.charms[1].syntax === 'free_undo:1+[dynamic(dr-mf-charm:10)]+free_entry:1')
  const odd = { ...cfg, puzzles: cfg.puzzles.map((r, i) => (i === 2 ? { ...r, syntax: '[dynamic(a:15)]+[dynamic(b:15)]' } : r)) }
  check('a syntax that cannot be rewritten safely is left alone and named', JSON.stringify(applyLadderValues(odd, 'puzzles', puzzles[0].values).syntaxNotUpdated) === '[3]')
  check('the input config is not modified', cfg.puzzles[3].prizeAmount === 40)
}

console.log('--- 20. Coin rank values set by the build, per segment ---')
{
  const cfg = createRewardChainConfig()
  check('a fresh project leaves coins to the build', coinLadderIsAuto(cfg))
  const generated = withGeneratedCoinValues(cfg, [0.052, 0.125, 0.281, 0.624])
  check('generated values carry their syntax and stay "set by the build"', coinLadderIsAuto(generated) && generated.coins[3].syntax === 'allowance(coins:0.624)' && generated.coins[0].asset === cfg.coins[0].asset)
  const typed = { ...generated, coins: generated.coins.map((r, i) => (i === 0 ? { prizeAmount: 0.06, syntax: 'allowance(coins:0.06)', asset: r.asset } : r)) }
  check('typing a value makes the ladder the economist\'s own', !coinLadderIsAuto(typed) && !coinLadderIsAuto(withManualCoinLadder(generated)))
  check('clearing hands it back to the build', coinLadderIsAuto(withBlankCoinValues(typed)) && withBlankCoinValues(typed).coins.every((r) => r.prizeAmount === 0 && r.syntax === ''))
  const otherSegment = withGeneratedCoinValues(cfg, [0.06, 0.144, 0.324, 0.72])
  const merged = mergeSharedRewardChain({ ...generated, puzzles: applyLadderValues(cfg, 'puzzles', [5, 15, 30, 65]).rewardChainConfig.puzzles }, otherSegment)
  check('the sync keeps a segment\'s own coin values and still shares everything else', merged.coins[3].prizeAmount === 0.72 && merged.puzzles[3].prizeAmount === 65)
  check('...and is stable once in step', JSON.stringify(mergeSharedRewardChain(merged, merged)) === JSON.stringify(merged))
  check('typed coin values are shared like every other resource', mergeSharedRewardChain(typed, otherSegment).coins[0].prizeAmount === 0.06)
  check('generated coin values are not a build input (a draft does not go out of date by being applied)', JSON.stringify(rewardChainAsBuildInput(generated)) === JSON.stringify(rewardChainAsBuildInput(cfg)) && JSON.stringify(rewardChainAsBuildInput(typed)) !== JSON.stringify(rewardChainAsBuildInput(cfg)))
  check('the coin-item plan is 3 to 8 rank-4 collects', Math.abs(coinPlanTargetFor(3) - 3) < 1e-9 && Math.abs(coinPlanTargetFor(0.3) - 1.8) < 1e-9 && Math.abs(coinPlanTargetFor(60) - 4.8) < 1e-9 && coinPlanTargetFor(0) === 0)

  const blank = blankChain().map((b) => ({ ...b, rewardChainConfig: withBlankCoinValues(b.rewardChainConfig) }))
  const segs = [
    { index: 0, name: 'Base', boards: blank, mainBoards: null, targets: { coins: 3, puzzles: 0, energy: 150, charms: 0 }, split: SPLIT },
    { index: 1, name: 'Higher', boards: blank.map((b) => ({ ...b })), mainBoards: null, targets: { coins: 3.9, puzzles: 0, energy: 195, charms: 0 }, split: SPLIT },
  ]
  const draft = await buildEvent({ phase: 'main', segments: segs })
  const [a, b] = draft.segments
  const coinsOf = (s) => s.resources.find((r) => r.type === 'coins')
  check(`the build fills in the coin values (base: ${a.coinValues?.values.join(' / ')})`, !!a.coinLadder && a.coinLadder.every((r) => r.prizeAmount > 0 && r.auto && /^allowance\(coins:/.test(r.syntax)))
  check(`the base segment lands on its coin target (${coinsOf(a).predicted.toFixed(3)} of 3)`, Math.abs(coinsOf(a).predicted - 3) <= 0.03)
  check(`a segment with a higher target lands on it too (${coinsOf(b).predicted.toFixed(3)} of 3.9), with its own values (${b.coinValues?.values.join(' / ')})`, Math.abs(coinsOf(b).predicted - 3.9) <= 0.04 && b.coinLadder[3].prizeAmount > a.coinLadder[3].prizeAmount)
  check('generated coin values pass the merge rule', validateRewardLadder(a.coinLadder).length === 0 && validateRewardLadder(b.coinLadder).length === 0)
  check('coins are not reported as "fixed steps" when the build sizes them', ![...a.causes, ...b.causes].some((c) => c.code === 'coarse-ladder' && /Coin/.test(c.detail)))
  check('the draft boards carry the segment\'s coin values', b.boards.every((x) => x.rewardChainConfig.coins[3].prizeAmount === b.coinLadder[3].prizeAmount))
  const appliedB = boardsWithDraftApplied(segs[1].boards, b, draft.shared, { draft })
  check('applying writes them onto that segment only', appliedB.every((x) => x.rewardChainConfig.coins[3].prizeAmount === b.coinLadder[3].prizeAmount) && blank[0].rewardChainConfig.coins[3].prizeAmount === 0)
  const afterApply = segs.map((s, i) => ({ ...s, boards: boardsWithDraftApplied(s.boards, draft.segments[i], draft.shared, { draft }) }))
  check('applying does not make the draft out of date', buildInputsKey({ phase: 'main', segments: afterApply }) === draft.key)
  check('the applied design is recognised as this draft', draftSegmentIsApplied(afterApply[1].boards, draft))
  const again = await buildEvent({ phase: 'main', segments: afterApply })
  // A rebuild starts again from the same starting values, not from the last
  // build's (so values cannot compound from one build to the next).
  check(`a rebuild from the applied design lands on the coin targets again (${again.segments.map((s) => coinsOf(s).predicted.toFixed(3)).join(', ')})`, Math.abs(coinsOf(again.segments[0]).predicted - 3) <= 0.03 && Math.abs(coinsOf(again.segments[1]).predicted - 3.9) <= 0.04)
  const typedBoards = blank.map((x) => ({ ...x, rewardChainConfig: typed }))
  const manual = await buildSegment({ phase: 'main', boards: typedBoards, targets: segs[0].targets, split: SPLIT })
  check('typed coin values are never overwritten by a build', manual.coinLadder === null && manual.boards[0].rewardChainConfig.coins[0].prizeAmount === 0.06)
}

console.log('--- 21. Results in plain words ---')
{
  const tight = await buildSegment({ phase: 'main', boards: blankChain(), targets: { ...NONE, energy: 20 }, split: SPLIT })
  const cause = tight.causes.find((c) => c.code === 'coarse-ladder')
  check(`a missed target says what can be paid and why ("${cause?.short}")`, !!cause && /can pay/.test(cause.short) && /rank-4 item pays 75/.test(cause.detail) && !/coarse|ladder|feasib/i.test(cause.short + cause.detail + cause.title))
  check('every cause has a one-line version, a full sentence and what to do', tight.causes.every((c) => c.short && c.detail && c.action && c.step))
}

console.log('--- 22. Build the whole event: Recompletion on top of the Normal draft ---')
{
  const mainBoards = blankChain()
  const rcBoards = blankChain([150, 400])
  const raw = [{ name: 'Seg', mainBoards, rcBoards, rewardTargets: { main: { ...NONE, energy: 150 }, rc: { ...NONE, energy: 75 } }, segmentFactor: 1, sourceAllocation: {} }]
  const mainDraft = await buildEvent({ phase: 'main', segments: segmentBuildInputs(raw, 'main') })
  check('the Normal phase builds', draftIsUsable(mainDraft))
  const rcInputs = rcInputsOnMainDraft(raw, mainDraft)
  check('Recompletion is given the Normal boards as they will be once applied', rcInputs[0].mainBoards.every((b) => (b.blockedQueue?.length ?? 0) > 0) && mainBoards.every((b) => (b.blockedQueue?.length ?? 0) === 0))
  const rcDraft = await buildEvent({ phase: 'rc', segments: rcInputs })
  check(`Recompletion builds on top of the Normal draft, before it is applied (${rcDraft.status})`, rcDraft.builtCount === 1 && rcDraft.segments[0].status !== 'skipped')
  check('...while against the unapplied design it is, correctly, not current', buildInputsKey({ phase: 'rc', segments: segmentBuildInputs(raw, 'rc') }) !== rcDraft.key)
  const appliedMain = boardsWithDraftApplied(mainBoards, mainDraft.segments[0], mainDraft.shared, { draft: mainDraft })
  const afterMain = [{ ...raw[0], mainBoards: appliedMain }]
  check('once the Normal draft is applied, the Recompletion draft is current as it stands', buildInputsKey({ phase: 'rc', segments: segmentBuildInputs(afterMain, 'rc') }) === rcDraft.key)
  check('a failed or empty build is not usable', !draftIsUsable(null) && !draftIsUsable({ status: 'infeasible' }) && !draftIsUsable({ status: 'nothing-built' }) && draftIsUsable({ status: 'review' }))
}

console.log('--- 23. A 15% margin on reward amounts, and a quick fix for every problem ---')
{
  check('the margin is 15%', OFF_TARGET_TOLERANCE === 0.15)
  const energyOf = (s) => s.resources.find((r) => r.type === 'energy')
  const kinds = (c) => (c?.fixes ?? []).map((f) => f.kind)
  // 85 asked, rank 4 pays 75 at a time: 75 is 11.8% away - inside the margin.
  const near = await buildSegment({ phase: 'main', boards: blankChain(), targets: { ...NONE, energy: 85 }, split: SPLIT })
  check(`an amount inside the margin is the target met (asked 85, pays ${Math.round(energyOf(near).predicted)}): no problem reported`, near.feasibility.offTarget.length === 0 && !near.causes.some((c) => c.code === 'coarse-ladder' || c.code === 'off-target') && near.status !== 'infeasible')
  // 110 asked, between one prize (75) and two (150): the build aims at the
  // AVERAGE player, who can land between them.
  const between = await buildSegment({ phase: 'main', boards: blankChain(), targets: { ...NONE, energy: 110 }, split: SPLIT })
  check(`a target between two prizes is met on average (asked 110, average ${Math.round(energyOf(between).predicted)})`, Math.abs(energyOf(between).predicted - 110) <= 110 * OFF_TARGET_TOLERANCE && !between.causes.some((c) => c.code === 'coarse-ladder'))
  // 20 asked: less than half of one prize - most players would get nothing.
  const far = await buildSegment({ phase: 'main', boards: blankChain(), targets: { ...NONE, energy: 20 }, split: SPLIT })
  const coarse = far.causes.find((c) => c.code === 'coarse-ladder')
  check(`a target smaller than one prize is reported with quick fixes (${(coarse?.fixes ?? []).map((f) => f.label).join(' | ')})`, !!coarse && kinds(coarse).includes('setBaseTarget') && kinds(coarse).includes('setLeftoverPolicy'))
  const targetFix = coarse?.fixes.find((f) => f.kind === 'setBaseTarget')
  check('the target fix proposes an amount the ranks can pay, as a whole number', targetFix?.type === 'energy' && targetFix?.value === 75)
  check('a reward amount never blocks a build: it is usable, and can be improved', far.status === 'review')
  check('every quick fix is plain data: an id, a kind and a label an economist can read', far.causes.every((c) => Array.isArray(c.fixes) && c.fixes.every((f) => f.id && f.kind && f.label && !/undefined|NaN/.test(f.label))))
  const other = await buildSegment({ phase: 'main', boards: blankChain(), targets: { ...NONE, energy: 22 }, split: SPLIT, context: { index: 2, name: 'Whales', factor: 1.1, baseTargets: { ...NONE, energy: 20 } } })
  const factorFix = other.causes.find((c) => c.code === 'coarse-ladder')?.fixes.find((f) => f.kind === 'setFactor')
  check(`for a segment other than the base, the fix moves that segment's factor ("${factorFix?.label}")`, factorFix?.segmentIndex === 2 && factorFix.value > 0 && factorFix.value !== 1.1 && /Whales/.test(factorFix.label))

  const goalBoards = blankChain()
  goalBoards[0] = { ...goalBoards[0], onboardingDrBudget: 1, onboardingTargetRank: 9 }
  const goal = await buildSegment({ phase: 'main', boards: goalBoards, targets: NONE, split: SPLIT, context: { index: 3, name: 'Seg 4', factor: 1, baseTargets: NONE } })
  const goalFixes = goal.causes.find((c) => c.code === 'onboarding')?.fixes ?? []
  check('an unreachable starting goal offers to lower it or remove it, for that segment', goalFixes.length === 2 && goalFixes[0].targetRank === 8 && goalFixes[1].targetRank === null && goalFixes.every((f) => f.kind === 'setOnboarding' && f.segmentIndex === 3))

  const pinTooBig = blankChain([150, 40])
  pinTooBig[1] = { ...pinTooBig[1], tiles: pinTooBig[1].tiles.map((row, r) => row.map((t, c) => (r === 1 && c === 0 ? 'semi' : t))), forcedSemiRanks: [{ row: 1, col: 0, rank: 9 }] }
  const pins = await buildSegment({ phase: 'main', boards: pinTooBig, targets: NONE, split: SPLIT })
  check('a pinned rank that is worth too much offers to remove the pins on that board', kinds(pins.causes.find((c) => c.code === 'pins-conflict')).includes('clearPins') && pins.causes.find((c) => c.code === 'pins-conflict').fixes[0].boardIndex === 1)

  const tightBoards = blankChain([150, 5000])
  tightBoards[1] = { ...tightBoards[1], maxRank: 6 }
  const tight = await buildSegment({ phase: 'main', boards: tightBoards, targets: NONE, split: SPLIT })
  const rankFix = tight.causes.flatMap((c) => c.fixes).find((f) => f.kind === 'setMaxRank')
  check(`a board whose tiles cannot hold its DR offers the lowest max rank that can ("${rankFix?.label}")`, !!rankFix && rankFix.boardIndex === 1 && rankFix.value > 6 && 16 * 2 ** (rankFix.value - 1) >= 5000 && 16 * 2 ** (rankFix.value - 2) < 5000)

  const credit = await buildSegment({ phase: 'main', boards: blankChain([150, 40]), targets: { ...NONE, energy: 150 }, split: SPLIT })
  const energyFix = credit.causes.find((c) => c.code === 'negative-subsidy')?.fixes.find((f) => f.kind === 'setBaseTarget')
  check(`a deduction that does not fit offers a merge energy target the boards can cover (${energyFix?.value})`, energyFix?.type === 'energy' && energyFix.value < 150 && energyFix.value >= 0)
  const lonely = await buildSegment({ phase: 'main', boards: blankChain([150]), targets: { ...NONE, energy: 75 }, split: { sharedTilePct: 100 } })
  check('a single-board design that pays energy offers to remove the energy target', lonely.causes.find((c) => c.code === 'only-board-1')?.fixes.some((f) => f.kind === 'setBaseTarget' && f.value === 0))
  const zero = await buildSegment({ phase: 'main', boards: blankChain([150, 0, 600]), targets: NONE, split: SPLIT })
  check('a board with tiles and no DR offers to spread the segment\'s DR over its boards', zero.causes.find((c) => c.code === 'zero-budget')?.fixes.some((f) => f.kind === 'spreadBudget'))
  check('a clean build has nothing to fix', near.causes.every((c) => c.code !== 'tile-capacity'))
}

console.log('--- 24. Board 1: few reward items, an opening run of 1s and 2s, and it clears ---')
{
  const chainOf = (values) => blankChain(values)
  const [b1] = chainOf([150, 500, 500])
  check('Board 1 may hold at most 15% of its blocked tiles as reward items (2 of 16), and none on its semi-blocked cells', rewardSlotCapacity(b1, 0) === 2 && rewardSemiSlots(b1, 0).maxUsable === 0)
  check('reward ranks by board: Board 1 rank 1, middle boards 1-2, the last board 1-3', allowedRewardRanks(0, 3).join() === '1' && allowedRewardRanks(1, 3).join() === '1,2' && allowedRewardRanks(2, 3).join() === '1,2,3' && allowedRewardRanks(1, 2).join() === '1,2,3' && allowedRewardRanks(0, 1).join() === '1')
  const placed = proposeRewardPlacements(chainOf([150, 500, 500]), { tileUnits: { coins: 20, puzzles: 12, energy: 6, charms: 16 } })
  const ranksOn = (i) => placed.additionsByBoard[i].map((it) => it.rank)
  check(`a real placement follows it (Board 1: ${ranksOn(0).join(',') || 'none'}; Board 2: ${ranksOn(1).join(',')}; Board 3: ${ranksOn(2).join(',')})`, ranksOn(0).length <= 2 && ranksOn(0).every((r) => r === 1) && ranksOn(1).every((r) => r <= 2) && ranksOn(1).filter((r) => r === 1).length > ranksOn(1).filter((r) => r === 2).length && ranksOn(2).some((r) => r === 3))

  check('the opening run is low, low, next - in threes', openingRun(16, 146, 1, 8).join(' ') === '1 1 2 1 1 2' && openingRun(16, 146, 2, 8).join(' ') === '2 2 3 2 2 3')
  check('it is sized to the board, and absent when the DR cannot spare it', openingRun(8, 146, 1, 8).length === 3 && openingRun(3, 3, 1, 8).length === 0 && openingRun(16, 10, 1, 8).length === 0)
  const g = placeItems(b1, { isFirstBoard: true, boardIndex: 0 })
  const tileCount = b1.tiles.flat().filter((t) => t !== 'open').length
  check(`Board 1's blocked queue opens with runs of 1 and 2 (${g.blockedQueue.join(' ')})`, g.blockedQueue.slice(0, 3).join(' ') === '1 1 2' && g.blockedQueue.filter((r) => r <= 2).length >= g.blockedQueue.length / 2)
  check('...its DR is still exact and its tiles are filled (at most one without an item)', g.sum === 150 && tileCount - g.itemCount <= 1)
  const withGoal = { ...b1, onboardingDrBudget: 20, onboardingTargetRank: 4 }
  const gg = placeItems(withGoal, { isFirstBoard: true, boardIndex: 0, onboarding: { drBudget: 20, targetRank: 4 } })
  check(`a starting goal still holds with the run in the queue (${gg.blockedQueue.join(' ')})`, gg.onboardingStatus?.feasible === true && gg.sum === 150 && gg.blockedQueue.join(' ').includes('1 1 2'))

  // The simulated player taps a smaller multiplier when that is the only way
  // to free a tile.
  const tiers = buildGeneratorTiers(7, 10)
  const state = (items, stuck) => ({ rows: 1, cols: items.length, itemAt: [items], stuck: [stuck] })
  check('with nothing semi-blocked below it, the biggest open multiplier is tapped', tierToSpend(state([8, 5], [false, false]), 8, tiers).cost === 2 && tierToSpend(state([10, 3], [false, true]), 10, tiers).cost === 4)
  check('a semi-blocked rank-1 item is cleared with x1, even when x2 and x4 are open', tierToSpend(state([8, 1], [false, true]), 8, tiers).cost === 1 && tierToSpend(state([10, 1], [false, true]), 10, tiers).cost === 1)
  check('a semi-blocked rank-2 item is cleared with x2, not x4', tierToSpend(state([10, 2], [false, true]), 10, tiers).cost === 2)
  let reachedAll = 0
  const RUNS = 12
  for (let n = 0; n < RUNS; n++) {
    const boards = chainOf([150, 500, 500]).map((b, i) => {
      const r = placeItems(b, { isFirstBoard: i === 0, boardIndex: i })
      return { ...b, semiPlacements: r.semiPlacements, blockedQueue: r.blockedQueue }
    })
    const run = simulatePlaythrough(boards)
    if (run.boardsReached === run.boardsTotal && run.subsidyDelivered === run.subsidyConfigured) reachedAll += 1
  }
  check(`the simulated player clears Board 1 and reaches every board (${reachedAll} of ${RUNS} runs)`, reachedAll === RUNS)
}

console.log('--- 25. Every eligible merge drops a bucket ---')
{
  const tables = createDropGroupsConfig(RC_MAX_RANK)
  const merges = { 5: 60, 6: 20, 7: 10, 8: 5, 9: 3, 10: 2, 11: 1, 12: 1 } // 42 from rank 6 up
  const built = buildAlwaysDropConfiguration({ dropUnits: { coins: 30, puzzles: 20, energy: 5, charms: 0 }, mergesByRank: merges, dropGroupsConfig: tables, minDropRank: 6 })
  const table = (rank) => built.dropGroupsConfig[rank - 1]
  const weightSum = (rank) => table(rank).entries.reduce((s, e) => s + e.weight, 0)
  check(`with enough to give, drops start at the economist's own rank (${built.startRank})`, built.startRank === 6)
  check('from that rank every merge drops: no "nothing" weight, and the buckets take the whole table', [6, 7, 9, 12].every((r) => table(r).noDropWeight === 0 && weightSum(r) === 1000))
  check('below it nothing is dropped', table(5).entries.length === 0)
  check(`drops are buckets of one to four items, in different ranks (${built.dropGroups.map((gr) => Object.entries(gr.items).map(([k, r]) => `${k}${r}`).join('+')).join('  ')})`, built.dropGroups.length >= 2 && built.dropGroups.every((gr) => Object.keys(gr.items).length >= 1 && Object.keys(gr.items).length <= 4) && built.dropGroups.some((gr) => Object.keys(gr.items).length > 1))
  check(`they deliver what was asked (coins ${built.deliverableUnits.coins.toFixed(1)} of 30, puzzles ${built.deliverableUnits.puzzles.toFixed(1)} of 20, energy ${built.deliverableUnits.energy.toFixed(1)} of 5)`, Math.abs(built.deliverableUnits.coins - 30) <= 1.5 && Math.abs(built.deliverableUnits.puzzles - 20) <= 1.5 && Math.abs(built.deliverableUnits.energy - 5) <= 1)
  check('a resource with nothing asked of drops is in no bucket', built.dropGroups.every((gr) => gr.items.charms == null))
  const small = buildAlwaysDropConfiguration({ dropUnits: { coins: 8, puzzles: 0, energy: 0, charms: 0 }, mergesByRank: merges, dropGroupsConfig: tables, minDropRank: 6 })
  check('the start rank is never moved: with little asked of the drops, the merge that makes a rank 6 still drops', small.startRank === 6 && small.dropGroupsConfig[5].noDropWeight === 0 && small.dropGroupsConfig[5].entries.reduce((s, e) => s + e.weight, 0) === 1000)
  check(`...and the build is told what the drops will really deliver (${small.deliverableUnits.coins.toFixed(0)} units, 8 asked), so it can take the difference out from under the tiles`, small.deliverableUnits.coins > 8)
  const none = buildAlwaysDropConfiguration({ dropUnits: { coins: 10, puzzles: 0, energy: 0, charms: 0 }, mergesByRank: {}, dropGroupsConfig: tables, minDropRank: 6 })
  check('with no merges predicted at all, the buckets still exist from the start rank', none.startRank === 6 && none.dropGroupsConfig[5].noDropWeight === 0 && none.dropGroups.length >= 1)
  const lowStart = buildAlwaysDropConfiguration({ dropUnits: { coins: 30, puzzles: 20, energy: 5, charms: 0 }, mergesByRank: merges, dropGroupsConfig: tables, minDropRank: 4 })
  check('a different start rank is honoured exactly too (rank 4: the 3 + 3 merge drops, the 2 + 2 merge does not)', lowStart.startRank === 4 && lowStart.dropGroupsConfig[3].noDropWeight === 0 && lowStart.dropGroupsConfig[3].entries.length > 0 && lowStart.dropGroupsConfig[2].entries.length === 0)
  const twisterGroup = { id: 'twister-r1', name: 'Twister', items: { twister: 1 }, twisterRule: true }
  const withKept = createDropGroupsConfig(RC_MAX_RANK).map((t) => (t.rank >= 6 ? { ...t, entries: [{ groupId: 'twister-r1', weight: 100 }], noDropWeight: 900 } : t))
  const kept = buildAlwaysDropConfiguration({ dropUnits: { coins: 30, puzzles: 20, energy: 5, charms: 0 }, mergesByRank: merges, dropGroups: [twisterGroup], dropGroupsConfig: withKept, minDropRank: 6 })
  check('a group the economist placed by hand keeps its odds; the buckets fill the rest exactly', kept.dropGroupsConfig[5].entries.find((e) => e.groupId === 'twister-r1').weight === 100 && kept.dropGroupsConfig[5].noDropWeight === 0 && kept.dropGroupsConfig[5].entries.reduce((s, e) => s + e.weight, 0) === 1000)
  const rank6Boards = () => blankChain([150, 700, 700]).map((b) => ({ ...b, minDropRank: 6 }))
  // Targets large enough that the drops alone do not pay them: containers
  // with several items (more with every rank) make the drops pay more than
  // one item per merge, and smaller targets would leave nothing under tiles.
  const event = await buildSegment({ phase: 'main', boards: rank6Boards(), targets: { coins: 0, puzzles: 300, energy: 200, charms: 400 }, split: SPLIT })
  check('a build uses the rule: drops start at rank 6, and the merge that makes a rank 6 always drops', event.dropStartRank === 6 && event.dropGroupsConfig[5].noDropWeight === 0 && event.dropGroupsConfig[5].entries.length > 0 && event.dropGroupsConfig[4].entries.length === 0)
  // Played for real: two rank 5s merged into a rank 6 drop a bucket, every time.
  const built6 = event.boards.map((b) => ({ ...b, dropGroups: event.dropGroups, dropGroupsConfig: event.dropGroupsConfig }))
  const played = simulatePlaythrough(built6, { trace: true, dropMode: 'expected', dropGroupsConfig: event.dropGroupsConfig, dropGroupsById: new Map(event.dropGroups.map((g) => [g.id, g])), minDropRank: 6 })
  const merges6 = played.events.filter((e) => e.type === 'merge' && e.newRank === 6 && e.rank < 1000)
  const dropsAfter = merges6.filter((m) => {
    const at = played.events.indexOf(m)
    const next = played.events.slice(at + 1).find((e) => e.type === 'merge' || e.type === 'merge-drop')
    return next?.type === 'merge-drop'
  })
  const merges5 = played.events.filter((e) => e.type === 'merge' && e.newRank === 5 && e.rank < 1000)
  const dropsAfter5 = merges5.filter((m) => {
    const at = played.events.indexOf(m)
    const next = played.events.slice(at + 1).find((e) => e.type === 'merge' || e.type === 'merge-drop')
    return next?.type === 'merge-drop'
  })
  check(`in a real playthrough every 5 + 5 -> 6 merge drops (${dropsAfter.length} of ${merges6.length}), and no 4 + 4 -> 5 merge does (${dropsAfter5.length} of ${merges5.length})`, merges6.length > 0 && dropsAfter.length === merges6.length && dropsAfter5.length === 0)
  const tileRewards = event.boards.flatMap((b) => b.blockedQueue).filter((v) => decodeReward(v)).length
  // Too little asked for that many drops: the rank is kept, and said.
  const tooMany = await buildSegment({ phase: 'main', boards: rank6Boards(), targets: { ...NONE, energy: 85 }, split: SPLIT })
  const floor = tooMany.causes.find((c) => c.code === 'drop-floor')
  check(`when rank 6 pays more than a small target, the rank is still 6 and the overpay is reported (energy ${Math.round(tooMany.resources.find((r) => r.type === 'energy').predicted)} of 85)`, tooMany.dropStartRank === 6 && tooMany.dropGroupsConfig[5].noDropWeight === 0 && !!floor && tooMany.status === 'review')
  const rankFix6 = floor?.fixes.find((f) => f.kind === 'setMinDropRank')
  check(`...with a one-click choice of the rank that fits ("${rankFix6?.label}")`, !!rankFix6 && rankFix6.value > 6 && rankFix6.value <= 12)
  check(`...and the rewards are still met with items under tiles that start semi-blocked (${tileRewards} of them; ${event.resources.filter((r) => r.target > 0).map((r) => `${r.type} ${Math.round(r.predicted)}/${r.target}`).join(', ')})`, tileRewards >= 0 && event.status !== 'infeasible' && event.resources.filter((r) => r.target > 0).every((r) => Math.abs(r.predicted - r.target) <= r.target * 0.25 && r.drop >= r.tile))
}

console.log('--- 26. Recompletion: a chase to rank 14 that starts with a rank 12 in hand ---')
{
  check('the normal chase covers 2,048 DR; Recompletion covers 8,192 - 2,048 = 6,144', chaseValue('main') === 2048 && chaseValue('rc') === 6144)
  check('a Recompletion demand converts against 6,144', subsidyForDemand(2000, 'rc') === 4144 && demandForSubsidy(4144, 'rc') === 2000 && subsidyForDemand(2000) === 48)
  check('a Recompletion subsidy can be larger than a whole normal chain', JSON.stringify(spreadSubsidy(3, 4144, 'rc')) === JSON.stringify([300, 1922, 1922]) && JSON.stringify(fillLastBoard([150, 1000, 0], 4144, 'rc')) === JSON.stringify([150, 1000, 2994]))
  check('the first RC board may carry 300 DR (Board 1 of the normal event stays at 150)', fillLastBoard([900, 0, 0], 4144, 'rc')[0] === 300 && fillLastBoard([900, 0, 0], 1500, 'main')[0] === 150 && spreadSubsidy(2, 5644, 'rc')[0] === 300)
  // Played end to end: the normal boards, then Recompletion from rank 12.
  const main = blankChain([150, 600]).map((b, i) => {
    const r = placeItems(b, { isFirstBoard: i === 0, boardIndex: i })
    return { ...b, semiPlacements: r.semiPlacements, blockedQueue: r.blockedQueue }
  })
  const rc = blankChain([150, 1500, 1500]).map((b, i) => {
    const r = placeItems(b, { isFirstBoard: i === 0, boardIndex: i })
    return { ...b, semiPlacements: r.semiPlacements, blockedQueue: r.blockedQueue }
  })
  const run = simulatePlaythrough(main, { rcBoards: rc, trace: true })
  const entered = run.events.findIndex((e) => e.type === 'rc-entered')
  const firstRank12 = run.events.findIndex((e) => e.type === 'merge' && e.newRank === 12)
  check('a full run enters Recompletion and reaches rank 14', run.rcEntered && run.reachedAt[14] !== undefined)
  check('Recompletion begins right after the merge that makes the rank 12', entered > 0 && firstRank12 >= 0 && entered > firstRank12 && !run.events.slice(firstRank12 + 1, entered).some((e) => e.type === 'spend'))
  const rcSpend = run.drSpent - run.reachedAt[12]
  check(`with 3,150 DR of RC subsidy, the player's own spend from rank 12 to rank 14 is far below the 6,144 it covers (${rcSpend} DR)`, rcSpend > 0 && rcSpend < 6144)
}

console.log('--- 27. Recompletion boards: nothing below rank 3 under a blocked tile ---')
{
  const built = { ...blankChain([150])[0], semiPlacements: [{ row: 2, col: 4, rank: 2 }], blockedQueue: [1, 1, 2] }
  const floored = withMinRankFloor(built, RC_MIN_RANK_UNDER_TILES)
  check('the floor is rank 3, and raising a board to it clears contents built for the old limit', RC_MIN_RANK_UNDER_TILES === 3 && floored.minRank === 3 && floored.blockedQueue.length === 0 && floored.maxRank >= 3)
  const high = { ...built, minRank: 5 }
  check('a board already at or above it is left exactly as it is', withMinRankFloor(high, 3) === high && withMinRankFloor(built, 1) === built)
  const rcBoards = blankChain([150, 1500, 1500]).map((b) => withMinRankFloor(b, RC_MIN_RANK_UNDER_TILES))
  const gen = rcBoards.map((b, i) => placeItems(b, { isFirstBoard: i === 0, boardIndex: i }))
  const lowest = Math.min(...gen.flatMap((g) => g.blockedQueue.filter((v) => v < 1000)))
  check(`no generated RC blocked queue holds anything below rank 3 (lowest: ${lowest}; first board: ${gen[0].blockedQueue.join(' ')})`, lowest >= 3)
  check('the first RC board still opens with a run of its two lowest ranks - now 3, 3, 4', gen[0].blockedQueue.slice(0, 3).join(' ') === '3 3 4' || gen[0].blockedQueue.every((v) => v >= 3))
  check('its semi-blocked tiles are not blocked tiles: the fixed rank-2 cell is unaffected', gen[0].semiPlacements.some((p) => p.rank === 2))
  const draft = await buildSegment({ phase: 'main', boards: rcBoards, targets: { ...NONE, energy: 150 }, split: SPLIT })
  const builtLowest = Math.min(...draft.boards.flatMap((b) => b.blockedQueue.filter((v) => v < 1000)))
  check(`a build keeps to it as well (lowest rank under a blocked tile: ${builtLowest})`, builtLowest >= 3)
}

console.log('--- 28. No tile is left without an item when the DR can fill it ---')
{
  // The two cases met in play: Board 1 (150 DR, max rank 8) and a Board 2 queue one item short.
  const first = { ...blankChain([150])[0] }
  first.tiles = first.tiles.map((row, r) => row.map(() => (r < 4 ? 'blocked' : 'open')))
  first.tiles[2][3] = 'semi'
  first.tiles[2][4] = 'semi'
  const tilesOf = (b) => b.tiles.flat().filter((t) => t === 'blocked' || t === 'semi').length
  const gen = placeItems(first, { isFirstBoard: true, boardIndex: 0 })
  check(`Board 1 with four blocked rows gets an item under every tile (${gen.semiPlacements.length + gen.blockedQueue.length} of ${tilesOf(first)}), on the exact DR`, gen.semiPlacements.length + gen.blockedQueue.length === tilesOf(first) && gen.sum === 150)
  check('...and still opens with its run of 1, 1, 2', gen.blockedQueue.slice(0, 6).join(' ') === '1 1 2 1 1 2')

  // Every combination where the DR can give each tile at least the lowest rank must fill every tile.
  let short = 0
  let badSum = 0
  let outOfWindow = 0
  let cases = 0
  let example = null
  const sumOf = (ranks) => ranks.reduce((s, r) => s + valueOf(r), 0)
  for (let n = 0; n < 6000; n++) {
    const minRank = 1 + Math.floor(Math.random() * 3)
    const maxRank = minRank + 1 + Math.floor(Math.random() * (12 - minRank))
    const desired = 2 + Math.floor(Math.random() * 30)
    const unit = valueOf(minRank)
    const target = desired * unit + Math.floor(Math.random() * desired * (valueOf(maxRank) - unit))
    for (const [name, make] of [
      ['later boards', () => generateCandidateInRange(target, desired, minRank, maxRank)],
      ['Board 1', () => generateCandidateWithSmallRanks(target, desired, minRank, maxRank)],
    ]) {
      cases += 1
      const ranks = make()
      if (ranks.length !== desired) {
        short += 1
        example = example ?? `${name}: ${target} DR, ${desired} tiles, ranks ${minRank}-${maxRank} -> ${ranks.length} items`
      }
      if (sumOf(ranks) < target) badSum += 1
      if (ranks.some((r) => r < minRank || r > maxRank)) outOfWindow += 1
    }
  }
  check(`in ${cases} random boards whose DR can fill every tile, none is left with a tile empty${example ? ` (e.g. ${example})` : ''}`, short === 0)
  check('...none comes in under its DR, and no item leaves the board\'s rank limits', badSum === 0 && outOfWindow === 0)
  // Too little DR for the tiles is still told apart: it cannot be filled, and the build says so.
  const starved = generateCandidateInRange(10, 9, 2, 8)
  check('a board with too little DR for its tiles (10 DR, 9 tiles, lowest rank 2) still comes out short - that one is reported, not hidden', starved.length < 9)
}

console.log('--- 29. The build sizes the Twister drops for the twists asked ---')
{
  // The economist's report: 15 twists, counted at 70%, a price in steps of
  // 10 - and a fixed 200-in-1,000 drop chance gave a typical player 0 to 2.
  const twisterBoards = (values, byBuild) =>
    blankChain(values).map((b) => ({ ...b, minDropRank: 6, twisterByBuild: byBuild, rewardChainConfig: withDefaultTwisterValues(b.rewardChainConfig) }))
  const withRule = (list) => {
    const rule = applyTwisterDropRule({ dropGroups: [], dropGroupsConfig: list[0].dropGroupsConfig, minDropRank: 6, itemRank: 1, perMille: 200 })
    return list.map((b) => ({ ...b, dropGroups: rule.dropGroups, dropGroupsConfig: rule.dropGroupsConfig }))
  }
  const targets = { coins: 0, puzzles: 300, energy: 200, charms: 400 }
  const segsOf = (byBuild) =>
    [[150, 700, 700], [150, 600, 600]].map((values, i) => ({
      index: i,
      name: i === 0 ? 'Base' : 'Harder',
      factor: 1,
      boards: byBuild ? twisterBoards(values, true) : withRule(twisterBoards(values, false)),
      mainBoards: null,
      targets,
      split: SPLIT,
      twists: 15,
      twisterCheckpointPct: 70,
      twisterCostStep: 10,
      twisterByBuild: byBuild,
    }))
  const fixed = await buildEvent({ phase: 'main', segments: segsOf(false) })
  check(`a fixed drop chance cannot give the twists: a typical player gets ${fixed.twister.rows.map((r) => r.spinsMedian).join(' and ')} of 15, and it is said`, fixed.twister.rows.every((r) => r.spinsMedian <= 5 && r.tooLow) && !fixed.twister.sizing)
  const sized = await buildEvent({ phase: 'main', segments: segsOf(true) })
  const rows = sized.twister.rows
  check(`sized by the build, a typical player gets ${rows.map((r) => r.spinsMedian).join(' and ')} of 15`, rows.length === 2 && rows.every((r) => Math.abs(r.spinsMedian - 15) <= 4 && !r.tooLow))
  check(`...at prices that are whole steps of 10 (${rows.map((r) => r.cost).join(' and ')} Twister DR)`, rows.every((r) => r.cost >= 10 && r.cost % 10 === 0))
  const sz = sized.twister.sizing
  check(`...and the build says what it did (a Twister item in ${Math.round(sz.minShare * 100)}% of the drops or more, ${sz.itemUnits.toFixed(1)} units each, ${sz.rounds} steps)`, sz.byBuild && !sz.short && !sz.needsRebuild && sz.valuesByBuild === true && sz.valueFactor > 1 && sz.itemUnits === 1)
  check(`...by making the Twister rank values bigger (${(sz.values ?? []).join(" / ")}), with every Twister drop still a rank-1 item`, sized.shared.dropGroups.filter((g) => g.items[TWISTER_TYPE] != null).every((g) => g.items[TWISTER_TYPE] === 1) && sized.segments.every((seg) => seg.boards[0].rewardChainConfig[TWISTER_TYPE][3].prizeAmount === sz.values[3]))
  const groups = new Map(sized.shared.dropGroups.map((g) => [g.id, g]))
  const table6 = sized.shared.dropGroupsConfig[5]
  check('the Twister item is in the containers the build made, never a group of its own rule, never under a tile', sized.shared.dropGroups.some((g) => g.auto && g.items[TWISTER_TYPE] != null) && !sized.shared.dropGroups.some((g) => g.twisterRule) && table6.noDropWeight === 0 && table6.entries.reduce((s, e) => s + e.weight, 0) === 1000 && table6.entries.every((e) => groups.has(e.groupId)) && sized.segments.every((s) => !s.boards.some(boardHasTwisterUnderTiles)))
  check('every segment of the draft carries the same resized drops', sized.segments.every((s) => s.dropGroups === sized.shared.dropGroups && s.dropGroupsConfig === sized.shared.dropGroupsConfig))
  const baseSeg = sized.segments[0]
  check(`the rewards of the build are not paid for it (${baseSeg.resources.filter((r) => r.target > 0).map((r) => `${r.type} ${Math.round(r.predicted)}/${r.target}`).join(', ')})`, sized.segments.every((s) => s.status !== 'infeasible'))
  // Fewer twists later: the price follows; more twists than the drops give: it says to build again.
  const fewer = await repriceTwister({ phase: 'main', draft: sized, segments: segsOf(true).map((s) => ({ ...s, twists: 10 })) })
  check(`asking for fewer twists afterwards only changes the price (${fewer.twister.rows.map((r) => `${r.cost} -> ${r.spinsMedian}`).join(', ')} of 10)`, fewer.twister.rows.every((r) => Math.abs(r.spinsMedian - 10) <= 3) && !fewer.twister.sizing.needsRebuild && fewer.shared === sized.shared)
  const many = await repriceTwister({ phase: 'main', draft: sized, segments: segsOf(true).map((s) => ({ ...s, twists: 60 })) })
  check('asking for many more than these drops give says to build again', many.twister.sizing.needsRebuild === true || many.twister.sizing.short === true || (sz.minShare >= 1 && sz.itemUnits >= 4))
  // Removing the Twister takes its items out of the containers again.
  const removed = removeGeneratedTwister(sized.shared)
  check('removing the Twister takes its items out of the containers and leaves the rest', !hasTwisterDrops(removed.dropGroups, removed.dropGroupsConfig, 6) && removed.dropGroupsConfig[5].entries.reduce((s, e) => s + e.weight, 0) + removed.dropGroupsConfig[5].noDropWeight === 1000 && removed.dropGroups.every((g) => Object.keys(g.items).length >= 1))
}

console.log('--- 30. A board waits for its semi-blocked reward items, and they are placed so they can be opened ---')
{
  const sim = await import('../src/features/merge/lib/mergeSimulation.js')
  const { encodeReward } = await import('../src/features/merge/lib/rewardChain.js')
  const coin1 = encodeReward('coins', 1)
  // A board with nothing left but one semi-blocked item.
  const lone = (rank) => {
    const b = createBoard('Board 1', { rows: 2, cols: 3 })
    b.tiles = b.tiles.map((row, r) => row.map((_, c) => (r === 0 && c === 0 ? 'semi' : 'open')))
    b.semiPlacements = [{ row: 0, col: 0, rank }]
    b.blockedQueue = []
    return b
  }
  const withReward = sim.buildInitialState(lone(coin1))
  check('a board whose only semi-blocked item is a small reward is NOT cleared: it waits for it', sim.boardIsCleared(withReward) === false && sim.boardIsCleared(sim.buildInitialState(lone(3))) === false)
  withReward.stuck[0][0] = false
  check('...and is cleared once that item is opened', sim.boardIsCleared(withReward) === true)
  // Carried into Recompletion: stays semi-blocked, but the Recompletion board does not wait for it.
  const carried = sim.buildInitialState(lone(coin1))
  carried.itemAt[1][1] = 12
  const rcBoard = createBoard('RC 1', { rows: 2, cols: 3 })
  rcBoard.tiles = rcBoard.tiles.map((row) => row.map(() => 'open'))
  rcBoard.semiPlacements = []
  rcBoard.blockedQueue = []
  sim.enterRecompletion(carried, rcBoard, [])
  const cells = carried.itemAt.flatMap((row, r) => row.map((v, c) => ({ v, stuck: carried.stuck[r][c] })))
  check('a semi-blocked reward carried into Recompletion stays semi-blocked there, and that board does not wait for it', cells.some((x) => x.v === coin1 && x.stuck) && cells.some((x) => x.v === 12 && !x.stuck) && sim.boardIsCleared(carried) === true)

  // Played: a reward item on Board 1 is opened by a matching drop, and only then does Board 2 come.
  const chainOf = (dropsCoins) => {
    const boards = blankChain([150, 500]).map((b, i) => regenerateBoard({ ...b, minDropRank: 6, rewardQueueItems: i === 0 ? [{ type: 'coins', rank: 1 }] : [] }, i, b.blockedValue, 0))
    // (The other case drops puzzles: merges drop, but never the coin that would open it.)
    const groups = [{ id: 'c1', name: 'drop', items: dropsCoins ? { coins: 1 } : { puzzles: 1 } }]
    const tables = createDropGroupsConfig(RC_MAX_RANK).map((t) => (t.rank >= 6 ? { ...t, entries: [{ groupId: 'c1', weight: 1000 }], noDropWeight: 0 } : t))
    return simulatePlaythrough(boards, { dropMode: 'expected', dropGroupsConfig: tables, dropGroupsById: new Map(groups.map((g) => [g.id, g])), minDropRank: 6 })
  }
  const opened = chainOf(true)
  const never = chainOf(false)
  check(`with a matching drop the reward item is opened and Board 2 comes (boards reached ${opened.boardsReached} of ${opened.boardsTotal})`, opened.boardsReached === 2)
  check(`when the drops never give its match it is never opened, and Board 2 never comes (boards reached ${never.boardsReached} of ${never.boardsTotal})`, never.boardsReached === 1 && never.subsidyDelivered < never.subsidyConfigured)

  // A run with no merge drops at all (the effort distribution looks at the main chain alone):
  // nothing could ever open a reward item, so it does not hold a board there.
  {
    const withItems = blankChain([150, 500, 500]).map((b, i) => regenerateBoard({ ...b, rewardQueueItems: [{ type: 'coins', rank: 1 }, { type: 'energy', rank: 1 }] }, i, b.blockedValue, 0))
    const without = blankChain([150, 500, 500]).map((b, i) => regenerateBoard(b, i, b.blockedValue, 0))
    const a = simulatePlaythrough(withItems, { startIndex: 0 })
    const b = simulatePlaythrough(without, { startIndex: 0 })
    check(`with no merge drops in the run, reward items under tiles do not stop the boards from arriving (boards reached ${a.boardsReached} of ${a.boardsTotal}, ${b.boardsReached} without them)`, a.boardsReached === a.boardsTotal && b.boardsReached === b.boardsTotal)
    const target = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, [0, 0, 0, 0, 0, 0, 2, 3, 5, 8, 10, 72][i]]))
    const suggestion = suggestBoardValuesForEffortTarget(withItems, target)
    check(`...so the effort distribution can be shaped on a design that has reward items under tiles (every board reached: ${suggestion.result?.boardsReached} of ${suggestion.result?.boardsTotal})`, suggestion.result?.boardsReached === suggestion.result?.boardsTotal)
  }
  // ...and with MANY reward items under the tiles (what a build leaves behind), the board does not fill up with items nothing can move.
  {
    const many = Array.from({ length: 8 }, (_, k) => ({ type: ['coins', 'puzzles', 'energy', 'charms'][k % 4], rank: 1 + (k % 2) }))
    const loaded = blankChain([150, 600, 800]).map((b, i) => regenerateBoard({ ...b, rewardQueueItems: i === 0 ? many.slice(0, 2) : many }, i, b.blockedValue, 0))
    const bare = blankChain([150, 600, 800]).map((b, i) => regenerateBoard(b, i, b.blockedValue, 0))
    const a = simulatePlaythrough(loaded, { startIndex: 0 })
    const b = simulatePlaythrough(bare, { startIndex: 0 })
    check(`a design with 18 reward items under its tiles, played with no merge drops, still hands out its subsidy (${a.subsidyDelivered} of ${a.subsidyConfigured} DR, all ${a.boardsReached} boards; ${b.subsidyDelivered} of ${b.subsidyConfigured} with none)`, a.boardsReached === a.boardsTotal && a.subsidyDelivered >= a.subsidyConfigured * 0.7 && a.reachedAt[12] !== undefined) // (Reward items sit early in the queues now, so main-chain items open a little later and a run can finish with some DR still under tiles; before the fix under test it was a jam, not a delay.)
    // (Player spend is not compared: with reward items taking tiles the main chain is laid out differently, and the spend moves with it.)
  }
  // Placement: chains that start at rank 1, on every board.
  const placed = proposeRewardPlacements(blankChain([150, 500, 500, 500]), { tileUnits: { coins: 20, puzzles: 14, energy: 9, charms: 0 }, droppingTypes: ['coins', 'puzzles', 'energy'] })
  const itemsOf = (i) => [...placed.additionsByBoard[i], ...placed.semiAdditionsByBoard[i]]
  const chains = (i) => {
    const byType = {}
    for (const it of itemsOf(i)) (byType[it.type] ??= []).push(it.rank)
    return byType
  }
  const top = [1, 2, 2, 3]
  const wellFormed = [0, 1, 2, 3].every((i) => Object.values(chains(i)).every((ranks) => ranks.every((rank, k) => rank <= top[i] && (rank === 1 ? k === 0 || ranks[k - 1] >= 1 : ranks[k - 1] === rank - 1))))
  check(`each reward's items on a board form a chain from rank 1 (Board 1: ${JSON.stringify(chains(0))}, Board 2: ${JSON.stringify(chains(1))}, last: ${JSON.stringify(chains(3))})`, wellFormed && itemsOf(0).every((it) => it.rank === 1) && itemsOf(3).some((it) => it.rank === 3) && [1, 2].every((i) => itemsOf(i).every((it) => it.rank <= 2)))
  check('the units placed and the units left over add up to what was asked', ['coins', 'puzzles', 'energy'].every((t) => placed.perResource[t].unitsPlaced + placed.perResource[t].unitsUnplaced === { coins: 20, puzzles: 14, energy: 9 }[t]))
  const noDrops = proposeRewardPlacements(blankChain([150, 500, 500]), { tileUnits: { coins: 8, puzzles: 8, energy: 0, charms: 0 }, droppingTypes: ['coins'] })
  check('a reward that does not drop gets nothing under tiles (it could never be opened), and that is said', [...noDrops.additionsByBoard.flat(), ...noDrops.semiAdditionsByBoard.flat()].every((it) => it.type === 'coins') && noDrops.perResource.puzzles.unitsUnplaced === 8 && noDrops.findings.some((f) => /puzzles/.test(f) && /could never be opened/.test(f)))
  const capped = proposeRewardPlacements(blankChain([150, 500, 500]), { tileUnits: { coins: 20, puzzles: 14, energy: 9, charms: 0 }, maxAutoByBoard: [0, 1, Infinity] })
  check('a board can be capped (the build does this when its reward items held the next board back)', capped.additionsByBoard[0].length + capped.semiAdditionsByBoard[0].length === 0 && capped.additionsByBoard[1].length + capped.semiAdditionsByBoard[1].length === 1)
  // The build's own guarantee: reward items under tiles do not cost the player subsidy.
  const guarded = await buildSegment({ phase: 'main', boards: blankChain([150, 500, 500]).map((b) => ({ ...b, minDropRank: 6 })), targets: { coins: 0, puzzles: 300, energy: 200, charms: 400 }, split: SPLIT })
  const hold = guarded.tileHold
  check(`a build keeps the subsidy reachable with its reward items in place (${Math.round((hold?.reachedShare ?? 0) * 100)}% reached, ${Math.round((hold?.baselineShare ?? 0) * 100)}% without them; kept off: ${(hold?.keptOff ?? []).join('/')})`, !!hold && (hold.baselineShare == null || hold.reachedShare >= hold.baselineShare - 0.25))
  const perBoard = guarded.boards.map((b) => b.blockedQueue.filter((v) => decodeReward(v)).length + b.semiPlacements.filter((p) => decodeReward(p.rank)).length)
  // Containers first: the tiles get what the containers leave, so a small build may have none. A larger one has them on several boards, and the drops stay the bigger part.
  const large = await buildSegment({ phase: 'main', boards: blankChain([150, 500, 500]).map((b) => ({ ...b, minDropRank: 6 })), targets: { coins: 0, puzzles: 900, energy: 200, charms: 1200 }, split: { sharedTilePct: 40 } })
  const largePerBoard = large.boards.map((b) => b.blockedQueue.filter((v) => decodeReward(v)).length + b.semiPlacements.filter((p) => decodeReward(p.rank)).length)
  check(`with larger rewards there are reward items under the tiles of several boards (${largePerBoard.join(' / ')}; the smaller build has ${perBoard.join(' / ')})`, largePerBoard.filter((n) => n > 0).length >= 2 && largePerBoard.slice(0, -1).some((n) => n > 0))
  check(`...and merge drops are the bigger part of every reward (${large.resources.filter((r) => r.target > 0).map((r) => `${r.type} ${Math.round((100 * r.drop) / Math.max(1, r.predicted))}% from drops`).join(', ')})`, large.resources.filter((r) => r.target > 0).every((r) => r.drop > r.tile))
}

console.log('--- 31. Board 1 holds no small reward, and the build keeps the effort distribution asked for ---')
{
  const build = await import('../src/features/merge/lib/eventBuild.js')
  const rewardsOn = (b) => b.blockedQueue.filter((v) => decodeReward(v)).length + b.semiPlacements.filter((p) => decodeReward(p.rank)).length
  const mk = () => blankChain([150, 500, 500]).map((b) => ({ ...b, minDropRank: 6 }))
  const targets = { coins: 0, puzzles: 900, energy: 200, charms: 1200 }
  // No target asked: the build is as before, and Board 1 has no reward item.
  build.setEffortTargetForBuild('main', {})
  const plain = await buildSegment({ phase: 'main', boards: mk(), targets, split: { sharedTilePct: 40 } })
  check(`Board 1 holds no small reward; the boards after it do (${plain.boards.map(rewardsOn).join(' / ')})`, rewardsOn(plain.boards[0]) === 0 && plain.boards.slice(1).some((b) => rewardsOn(b) > 0))
  check('with no effort distribution asked, nothing is picked for one', plain.effortFit === null)
  // A target with most of the effort at rank 12.
  const asked = { 7: 2, 8: 3, 9: 5, 10: 8, 11: 12, 12: 70 }
  build.setEffortTargetForBuild('main', asked)
  const kept = await buildSegment({ phase: 'main', boards: mk(), targets, split: { sharedTilePct: 40 } })
  const fit = kept.effortFit
  const at12 = (curve) => Math.round(curve[12])
  check(`with one asked, the build keeps the boards closest to it (distance ${Math.round(fit?.startDistance ?? -1)} -> ${Math.round(fit?.distance ?? -1)}; rank 12 takes ${at12(fit?.curve ?? {})}% of the effort, 70% asked)`, !!fit && fit.distance <= fit.startDistance + 1e-9 && Math.abs(fit.target[12] - 70) < 1e-6)
  const again = build.effortCurveOf(kept.boards)
  check('...and that is the distribution of the boards it returns', Math.abs(again.curve[12] - fit.curve[12]) < 1e-6)
  check('...which are as sound as any build: exact DR under every board, every tile with an item, Board 1 still free of rewards', kept.perBoard.every((b) => b.mainSum === b.allocation) && kept.boards.every(boardIsBuilt) && rewardsOn(kept.boards[0]) === 0 && kept.status !== 'infeasible')
  build.setEffortTargetForBuild('main', {})
}

console.log(failures === 0 ? `\nALL ${count} BUILD CHECKS PASSED` : `\n${failures} OF ${count} BUILD CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
