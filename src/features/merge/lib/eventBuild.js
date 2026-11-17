// "Build configuration" - the one coordinated build behind the Build Event
// workflow. It turns the economist's inputs (board layouts and subsidy
// budgets, small-reward targets, the tile/drop split) into a complete DRAFT:
// reward items under eligible tiles, main-chain queue contents, drop groups
// and their odds, the energy subsidy credit, and the resulting DR allocation
// per board - consistent with each other, without the economist generating
// boards, generating rewards and regenerating boards by hand.
//
// It coordinates the existing generators rather than replacing them:
// placement.js builds a board's main-chain contents, smallRewardsWorkflow.js
// places reward items, generates drop groups and scores them on seeded
// simulation. What this file adds is the loop that makes them agree.
//
// THE LOOP. Collected merge energy funds free generator taps, so 80% of it is
// credited against the main-chain subsidy:
//     effective subsidy = sum(budget x (1 + CC)) - 0.80 x collectible energy
// But how much energy is collected depends on the boards, and the boards'
// contents depend on the subsidy they are built for. So, per segment:
//   1. assume a credit (first pass: 0.80 x the energy target);
//   2. allocate the subsidy after CC and that credit across the boards;
//   3. build every board's contents for its allocation, place reward items,
//      generate/keep the drops, and simulate;
//   4. read the energy the simulation actually collected; if the credit it
//      implies differs from the one assumed, go round again with it.
// It stops after MAX_PASSES and says whether it settled. It never claims
// convergence or a hit target that did not happen.
//
// A board's BUDGET (blockedValue) is never changed. Its share after CC and
// the credit is recorded in effectiveBlockedValue (see board.js), which is
// what its contents are built for. That is what "applied once" means here:
// the next build starts again from the untouched budgets.
//
// Nothing here writes to the project. The result is a draft the caller holds
// until the economist applies it.
import { regenerateBoard } from './effortTargeting'
import * as effortSim from './mergeSimulation'
import { buildSimulationRows as effortRowsOf } from './simulationRows'
import { generateSmallRewardsConfiguration, splitTargets, OFF_TARGET_TOLERANCE } from './smallRewardsWorkflow'
import {
  REWARD_TYPES,
  REWARD_MAX_RANK,
  REWARD_TARGET_LABELS,
  isMainItem,
  decodeReward,
  rewardPrizeAmount,
  hasLiteralCoinDefinitions,
  validateRewardLadder,
  COIN_TYPE,
  COIN_VALUE_SHAPE,
  coinLadderIsAuto,
  withGeneratedCoinValues,
  rewardChainAsBuildInput,
  roundRewardAmount,
  formatRewardAmount,
} from './rewardChain'
import { FIRST_BOARD_SUBSIDY_CAP_DR, firstBoardCapFor, generationTargetOf } from './board'
// The Board 1 limit of the phase being built (150 DR, or 300 for Recompletion).
let activeFirstBoardCap = FIRST_BOARD_SUBSIDY_CAP_DR
import { ENERGY_CREDIT_RATE, validateConfigAcrossRuns } from './rewardEconomy'
import { rewardSlotCapacity, rewardSemiSlots } from './rewardPlacement'
import { resizeTwisterDrops } from './rewardTargeting'
import { TWISTER_FILL_MIN_SHARE } from './dropGroups'
import { boardHasTwisterUnderTiles, targetSpinsForSegment, priceTwisterForBuild, withDefaultTwisterValues, roundTwisterValues, TWISTER_EASY_CHECKPOINT_PCT } from './twisterEconomy'
import { twisterLadderIsAuto, TWISTER_TYPE } from './rewardChain'
import { valueOf, MAX_RANK } from './ranks'
import { effectiveMinRank, effectiveMaxRank } from './rankWindow'
import { spreadSubsidy } from './subsidyBudget'

export const MAX_PASSES = 4
// The credit is "settled" when the credit implied by a pass's own simulation
// is within half a DR of the one its boards were built with - i.e. they agree
// to the nearest whole DR, which is all a whole-DR allocation can express.
// (An earlier, looser tolerance let a build stop on its first pass with the
// boards carrying a few DR more than the simulated energy justified.)
export const CREDIT_TOLERANCE_DR = 0.5
// How far the DR placed under a board's tiles may be from the DR it should
// hold before that is a problem: 5%, by explicit economist decision (asked,
// and chosen over 10% and 15% - a wider margin moves player effort too far).
// It also covers merge-energy deduction that could not be taken off, measured
// against the segment's whole DR. Reward AMOUNTS have their own, wider margin
// (smallRewardsWorkflow.js: OFF_TARGET_TOLERANCE, 15%).
export const DR_TOLERANCE = 0.05
// How many times a build may re-size the shared merge drops (see buildEvent).
export const MAX_REBALANCES = 2

// THE DEDUCTION POLICY - one explicit rule, shown wherever the credit is.
export const DEDUCTION_POLICY = {
  id: 'protect-board-1',
  label: 'Board 1 is protected; the credit comes off the later boards in proportion to their subsidy',
  detail:
    'Board 1 is the onboarding board, so the energy credit is never deducted from it. The credit is taken from every later board in proportion to the subsidy it carries after CC, in whole DR, and never below what that board needs to hold its pinned ranks and put an item under every tile. Typed budgets are never changed. Credit that cannot be deducted this way is reported as infeasible, not dropped and not taken from Board 1.',
}
// Coin rank values set by the build: how many coin ITEMS to plan for. The
// build aims for a handful of rank-4 coin collects (3 to 8, about one per 0.6
// allowance of the base target) and then sizes the coin values so each
// segment's payout lands on its own target. Returned in the provisional
// values' own units, as the target the item placement is planned against.
export function coinPlanTargetFor(baseCoinTarget) {
  if (!((baseCoinTarget ?? 0) > 0)) return 0
  const top = COIN_VALUE_SHAPE[REWARD_MAX_RANK - 1]
  const collects = Math.min(8, Math.max(3, Math.round(baseCoinTarget / top)))
  return collects * top
}

export const DEFAULT_VALIDATION_RUNS = 100
export const DEFAULT_VALIDATION_SEED = 21

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const sum = (list) => list.reduce((s, v) => s + v, 0)

export function mainChainSum(board) {
  return [...(board.blockedQueue ?? []), ...(board.semiPlacements ?? []).map((p) => p.rank)].filter(isMainItem).reduce((s, v) => s + valueOf(v), 0)
}

function subsidyTileCount(board) {
  return (board.tiles ?? []).flat().filter((t) => t === 'blocked' || t === 'semi').length
}

export function boardIsBuilt(board) {
  return subsidyTileCount(board) === 0 || (board.semiPlacements?.length ?? 0) + (board.blockedQueue?.length ?? 0) > 0
}

// --- Layout capacity (step 2) ---------------------------------------------
// What a layout can hold, independent of what is in it: this is "where items
// can go", not "which items occupy those positions".
export function layoutCapacity(board, boardIndex) {
  const flat = (board.tiles ?? []).flat()
  const blockedTiles = flat.filter((t) => t === 'blocked').length
  const semiTiles = flat.filter((t) => t === 'semi').length
  const pinnedMain = (board.forcedSemiRanks ?? []).length
  const pinnedRewards = (board.rewardQueueItems ?? []).filter((it) => !it.auto).length + (board.rewardSemiItems ?? []).filter((it) => !it.auto).length
  return {
    blockedTiles,
    semiTiles,
    openTiles: flat.length - blockedTiles - semiTiles,
    // The highest and lowest rank this board can really hold under its tiles:
    // the typed limits, within the fixed ones of its position (Board 1 never
    // above rank 8, Board 2 never above rank 11 - rankWindow.js).
    topRank: effectiveMaxRank(board.maxRank ?? 12, boardIndex),
    lowRank: effectiveMinRank(board.minRank ?? 1, boardIndex),
    // The most main-chain DR these tiles could ever carry: every blocked tile
    // at that highest rank. Board 1 semi-blocked tiles hold their own small
    // fixed items (rank 1, one rank 2), so they add next to nothing there.
    // (It used the typed limit and counted semi tiles at full rank: a
    // Recompletion Board 1 showed 32,768 DR where it can hold about 3,900.)
    maxDr: boardIndex === 0 ? blockedTiles * valueOf(effectiveMaxRank(board.maxRank ?? 12, boardIndex)) + semiTiles + 1 : (blockedTiles + semiTiles) * valueOf(effectiveMaxRank(board.maxRank ?? 12, boardIndex)),
    // How many reward items could go under tiles here while the board still
    // carries its DR exactly.
    rewardSlots: rewardSlotCapacity(board, boardIndex) + rewardSemiSlots(board, boardIndex).maxUsable,
    pinnedMain,
    pinnedRewards,
    hasContents: (board.semiPlacements?.length ?? 0) + (board.blockedQueue?.length ?? 0) > 0,
    onboardingGoal: boardIndex === 0 && board.onboardingDrBudget != null && board.onboardingTargetRank != null ? { drBudget: board.onboardingDrBudget, targetRank: board.onboardingTargetRank } : null,
  }
}

// --- Subsidy allocation -----------------------------------------------------
// The least main-chain DR a board can be built for without breaking it: every
// pinned rank at its own value, and every other blocked/semi tile holding at
// least the board's lowest allowed rank (pinned reward items take a tile and
// carry no DR). Below this, tiles are left without an item or a pin no longer
// fits - so the deduction never goes under it.
export function minFeasibleBoardValue(board, boardIndex) {
  const tiles = subsidyTileCount(board)
  if (tiles === 0) return 0
  const isSemi = (r, c) => board.tiles?.[r]?.[c] === 'semi'
  const pins = (board.forcedSemiRanks ?? []).filter((f) => isSemi(f.row, f.col))
  const pinnedValue = pins.reduce((v, f) => v + valueOf(f.rank), 0)
  const pinnedRewards = (board.rewardQueueItems ?? []).filter((it) => !it.auto).length + (board.rewardSemiItems ?? []).filter((it) => !it.auto && isSemi(it.row, it.col)).length
  const free = Math.max(0, tiles - pins.length - pinnedRewards)
  return pinnedValue + free * valueOf(effectiveMinRank(board.minRank ?? 1, boardIndex))
}

// Per board: its budget after CC ("before the credit"), and after its share
// of the energy credit, under DEDUCTION_POLICY:
//   - Board 1 is protected: nothing is deducted from it (and in a multi-board
//     list it is capped at FIRST_BOARD_SUBSIDY_CAP_DR, as in the editor).
//   - The credit comes off the later boards in proportion to what each
//     carries after CC, but never below that board's minimum feasible value;
//     a board that hits its floor stops there and the rest is re-shared among
//     the boards that still have room.
//   - A zero-budget board carries nothing and gives nothing.
//   - A design with only Board 1 has nothing to deduct from.
//   - Whatever cannot be deducted is returned as creditUnabsorbed. It is
//     never taken from Board 1, never dropped silently, and typed budgets are
//     never altered.
// Whole DR throughout; the rounding is by largest remainder and its size is
// returned (roundingResidual) rather than hidden.
export function allocateSubsidy(boards, credit, { capFirstBoard = true, firstBoardCap = FIRST_BOARD_SUBSIDY_CAP_DR } = {}) {
  const before = boards.map((b) => (b.blockedValue ?? 0) * (1 + (b.ccPercent ?? 0)))
  let firstBoardCapped = false
  if (capFirstBoard && boards.length > 1 && before[0] > firstBoardCap) {
    before[0] = firstBoardCap
    firstBoardCapped = true
  }
  const floors = boards.map((b, i) => (i === 0 ? before[0] : Math.min(before[i], minFeasibleBoardValue(b, i))))
  const deductible = boards.map((_, i) => (i === 0 ? 0 : Math.max(0, before[i] - floors[i])))
  const wanted = Math.max(0, credit)
  const deducted = boards.map(() => 0)
  let remaining = Math.min(wanted, sum(deductible))
  let active = boards.map((_, i) => i).filter((i) => deductible[i] > 1e-9)
  // Proportional water-filling: share by subsidy carried, clamp at each floor.
  for (let guard = 0; guard < boards.length + 2 && remaining > 1e-9 && active.length > 0; guard++) {
    const weight = sum(active.map((i) => before[i]))
    let clamped = false
    for (const i of [...active]) {
      const share = (remaining * before[i]) / weight
      const room = deductible[i] - deducted[i]
      if (share >= room - 1e-9) {
        deducted[i] = deductible[i]
        active = active.filter((x) => x !== i)
        clamped = true
      }
    }
    if (clamped) {
      remaining = Math.min(wanted, sum(deductible)) - sum(deducted.filter((_, i) => !active.includes(i)))
      for (const i of active) deducted[i] = 0
      continue
    }
    for (const i of active) deducted[i] = (remaining * before[i]) / weight
    remaining = 0
  }
  const taken = sum(deducted)
  const raw = before.map((v, i) => v - deducted[i])
  // Rounding. A board the credit is deducted from is given a value its
  // generator can hit EXACTLY: a whole multiple of its lowest allowed rank's
  // value (a board built from items worth at least 4 DR each cannot total
  // 2941). So each such board is rounded down to its step, then steps are
  // handed back, largest remainder first, while that brings the total closer
  // to the unrounded figure. Boards nothing is deducted from keep their own
  // value (to the nearest DR). What this rounding adds up to is returned as
  // roundingResidual, not hidden.
  const step = boards.map((b, i) => valueOf(effectiveMinRank(b.minRank ?? 1, i)))
  const touched = boards.map((_, i) => deducted[i] > 1e-9)
  const after = raw.map((v, i) => (touched[i] ? Math.max(Math.ceil(floors[i] / step[i] - 1e-9) * step[i], Math.floor(v / step[i] + 1e-9) * step[i]) : Math.round(v)))
  let error = sum(raw) - sum(after)
  const order = raw.map((v, i) => [touched[i] ? (v - after[i]) / step[i] : -1, i]).sort((a, b) => b[0] - a[0])
  for (const [remainder, i] of order) {
    if (remainder <= 0) break
    if (error >= step[i] / 2 && after[i] + step[i] <= before[i] + 1e-9) {
      after[i] += step[i]
      error -= step[i]
    }
  }
  const atFloor = boards.map((_, i) => i > 0 && deductible[i] > 0 && deducted[i] >= deductible[i] - 1e-9)
  return {
    budget: boards.map((b) => b.blockedValue ?? 0),
    before,
    floors,
    deductible,
    deducted,
    atFloor,
    after,
    totalBudget: sum(boards.map((b) => b.blockedValue ?? 0)),
    totalBefore: sum(before),
    totalDeductible: sum(deductible),
    totalAfter: sum(after),
    creditWanted: wanted,
    creditTaken: taken,
    creditUnabsorbed: wanted - taken,
    // Why some credit could not be taken, when any could not.
    unabsorbedReason: wanted - taken <= 1e-9 ? null : boards.length <= 1 ? 'only-board-1' : sum(deductible) <= 1e-9 ? 'nothing-deductible' : 'insufficient-deductible',
    // What rounding added: sum(after) - sum(before - deducted). Whole DR,
    // and whole minimum-rank steps on the boards the credit came off.
    roundingResidual: sum(after) - sum(raw),
    steps: step,
    firstBoardCapped,
  }
}

// --- What a build needs -------------------------------------------------------
// Only what the NEXT operation needs is required. Each item names the step
// that fixes it. `blocking` items stop a build; the rest are advisories.
export function buildReadiness({ phase, boards, mainBoards = null, targets = {} }) {
  const items = []
  const board0 = boards?.[0]
  const anySubsidyTiles = (boards ?? []).some((b) => subsidyTileCount(b) > 0)
  const totalBudget = sum((boards ?? []).map((b) => b.blockedValue ?? 0))
  items.push({
    ok: anySubsidyTiles,
    blocking: true,
    step: 'layouts',
    label: anySubsidyTiles ? `${boards.length} board layout${boards.length === 1 ? '' : 's'} with blocked or semi-blocked tiles` : 'No blocked or semi-blocked tiles yet - paint at least one board layout',
  })
  items.push({
    ok: totalBudget > 0,
    blocking: true,
    step: 'setup',
    label: totalBudget > 0 ? `DR on the boards: ${totalBudget.toLocaleString()} DR` : 'No main-chain subsidy yet - enter this segment\'s total demand in step 1',
  })
  for (const type of REWARD_TYPES) {
    if (!((targets?.[type] ?? 0) > 0)) continue
    const top = rewardPrizeAmount(board0?.rewardChainConfig, type, REWARD_MAX_RANK)
    if (type === COIN_TYPE && coinLadderIsAuto(board0?.rewardChainConfig)) {
      items.push({ ok: true, blocking: true, step: 'definitions', resource: type, label: 'Coin allowance: the build sets the coin rank values, for each segment' })
      continue
    }
    items.push({
      ok: top > 0,
      blocking: true,
      step: 'definitions',
      resource: type,
      label:
        top > 0
          ? `${REWARD_TARGET_LABELS[type]}: reward ranks defined`
          : `${REWARD_TARGET_LABELS[type]} has a target but no rank values - enter ${type === COIN_TYPE ? 'the allowance worth of each coin rank' : 'the value of each rank'}`,
    })
  }
  if ((targets?.coins ?? 0) > 0 && hasLiteralCoinDefinitions(board0?.rewardChainConfig)) {
    items.push({
      ok: false,
      blocking: false,
      step: 'definitions',
      resource: COIN_TYPE,
      label: 'Coin ranks are still literal coin amounts (coins:100000), not allowance worth - the coin target and results are in those old units until you switch them',
    })
  }
  if (phase === 'rc') {
    const mainBuilt = (mainBoards ?? []).length > 0 && mainBoards.every(boardIsBuilt) && mainBoards.some((b) => subsidyTileCount(b) > 0 || (b.blockedValue ?? 0) === 0)
    items.push({
      ok: mainBuilt,
      blocking: true,
      step: 'phase',
      label: mainBuilt ? 'The Normal phase is built (Recompletion is played after it)' : 'Build and apply the Normal phase first - Recompletion starts when the player reaches rank 12 on the normal boards',
    })
  }
  return { items, ready: items.every((i) => i.ok || !i.blocking) }
}

// --- Staleness keys -----------------------------------------------------------
// Everything a build of one phase depends on. Generated contents and
// generated ("auto") reward items / drop groups are NOT inputs - applying a
// draft must not make that draft look out of date.
function boardInputs(b) {
  return [
    b.rows,
    b.cols,
    b.tiles,
    b.blockedValue,
    b.ccPercent ?? 0,
    b.minRank,
    b.maxRank,
    b.forcedSemiRanks ?? [],
    b.rcEvent ?? false,
    b.onboardingDrBudget ?? null,
    b.onboardingTargetRank ?? null,
    (b.rewardQueueItems ?? []).filter((it) => !it.auto),
    (b.rewardSemiItems ?? []).filter((it) => !it.auto),
  ]
}

function sharedInputs(board0) {
  if (!board0) return null
  // A hand-written Twister rule is replaced by the build when the build
  // sizes the Twister itself, so it is not one of its inputs then.
  const kept = (board0.dropGroups ?? []).filter((g) => !g.auto && !(board0.twisterByBuild && g.twisterRule))
  const keptIds = new Set(kept.map((g) => g.id))
  return [
    rewardChainAsBuildInput(board0.rewardChainConfig),
    board0.minDropRank,
    board0.multiDropRank ?? null,
    board0.rewardLeftoverPolicy,
    board0.targetEv,
    board0.tier2UnlockRank,
    board0.tier4UnlockRank,
    kept,
    (board0.dropGroupsConfig ?? []).map((t) => [t.rank, !!t.locked, t.locked ? t.entries : t.entries.filter((e) => keptIds.has(e.groupId))]),
    ...(board0.twisterByBuild ? ['twister-by-build'] : []),
    ...(board0.tripleDropRank != null ? ['three-items-from', board0.tripleDropRank] : []),
  ]
}

// The inputs grouped by what the economist would call them, so a stale
// draft can say WHAT changed ("Reward targets changed") rather than only
// that something did.
export const INPUT_PART_LABELS = {
  layouts: 'Board layouts or pinned contents changed',
  budgets: 'Subsidy budgets or CC changed',
  targets: 'Reward targets or segment factors changed',
  split: 'The under-tiles / merge-drops split changed',
  definitions: 'Reward definitions, drop settings or generator settings changed',
  mainPhase: 'The Normal phase (played before Recompletion) changed',
}

export function buildInputParts({ phase, segments }) {
  const j = JSON.stringify
  const layoutOf = (b) => [b.rows, b.cols, b.tiles, b.minRank, b.maxRank, b.forcedSemiRanks ?? [], b.rcEvent ?? false, b.onboardingDrBudget ?? null, b.onboardingTargetRank ?? null, (b.rewardQueueItems ?? []).filter((it) => !it.auto), (b.rewardSemiItems ?? []).filter((it) => !it.auto)]
  return {
    layouts: j(segments.map((s) => s.boards.map(layoutOf))),
    budgets: j(segments.map((s) => s.boards.map((b) => [b.blockedValue, b.ccPercent ?? 0]))),
    targets: j(segments.map((s) => s.targets)),
    split: j(segments.map((s) => s.split)),
    definitions: j(segments.map((s) => sharedInputs(s.boards[0]))),
    // The RC phase is played after the main chain, so the applied main
    // boards (contents included) are an input to it.
    mainPhase: phase === 'rc' ? j(segments.map((s) => (s.mainBoards ?? []).map((b) => [boardInputs(b), b.semiPlacements, b.blockedQueue, b.dropGroups, b.dropGroupsConfig]))) : null,
  }
}

// SIZING THE TWISTER DROPS (the build puts the Twister item into the
// containers - board.twisterByBuild). By explicit economist request: "fix it
// so we will go closer to the 15 spins i gave". A price is a whole number of
// price steps, so a segment can only be priced when its player collects at
// least twists x one step; and the lower the price in steps, the coarser the
// number of twists it can land on. The build therefore raises the Twister
// drops until EVERY segment's average income is at least this many steps per
// twist, with two levers:
//   - IN HOW MANY DROPS the Twister item sits, decided before the build from
//     what the twists need (smallRewardsWorkflow.js: enough drops that rank-4
//     items could carry it - "we can let the user get a lot more drops of the
//     twister"). The rewards make room by dropping as fewer, bigger items, so
//     this does not make more drops hold two items;
//   - HOW BIG the item is, raised after the build, a step at a time, up to
//     rank 4 (resizeTwisterDrops - it changes nothing else).
// The number is this app's own.
// The most of a reward that is asked of the tiles in a build, in percent. The
// economist: "its just important that the drops will be the bigger part".
export const MAX_TILE_SHARE_PCT = 40
// THE EFFORT DISTRIBUTION THE ECONOMIST ASKED FOR (step 5: share of effort
// per rank), kept by the build. By explicit economist feedback: "the splits
// befor and after the boards build with the small rewards are extremelly off
// from each other ... it needs to protect the distribution i asked for and
// approved". The same board amounts give very different distributions
// depending on which item ends up under which tile, and a build generates
// that afresh. So when a target is known, the finished boards are generated
// again several times - same amounts, same reward items, same rules - and the
// set whose main-chain run is closest to the target is the one kept
// (pickBoardsForEffort). The target is set by the app (App.jsx) from what is
// typed in the Effort distribution step.
const effortTargets = { main: null, rc: null }
export function setEffortTargetForBuild(phase, pctByRank) {
  const out = {}
  let total = 0
  for (let rank = 1; rank <= MAX_RANK; rank++) {
    const v = Number(pctByRank?.[rank])
    out[rank] = Number.isFinite(v) && v > 0 ? v : 0
    total += out[rank]
  }
  effortTargets[phase] = total > 0 ? Object.fromEntries(Object.entries(out).map(([rank, v]) => [rank, (v / total) * 100])) : null
}
export const EFFORT_LAYOUT_TRIES = 24
// Share of effort per rank of a main-chain-only run of these boards.
export function effortCurveOf(boards) {
  const result = effortSim.simulatePlaythrough(boards, { startIndex: 0 })
  const rows = effortRowsOf(result)
  const curve = {}
  for (let rank = 1; rank <= MAX_RANK; rank++) curve[rank] = Math.max(0, rows.find((r) => r.rank === rank)?.pctOfEffort ?? 0)
  return { curve, result }
}
const effortDistance = (curve, target) => {
  let sum = 0
  for (let rank = 1; rank <= MAX_RANK; rank++) sum += (curve[rank] - (target[rank] ?? 0)) ** 2
  return sum
}
export function pickBoardsForEffort(boards, target, noise, tries = EFFORT_LAYOUT_TRIES) {
  const rewardsOf = (b) => [...b.blockedQueue, ...b.semiPlacements.map((p) => p.rank)].filter((v) => decodeReward(v)).length
  const first = effortCurveOf(boards)
  let best = { boards, curve: first.curve, distance: effortDistance(first.curve, target), reached: first.result.reachedAt?.[MAX_RANK] !== undefined }
  const start = best.distance
  for (let k = 0; k < tries; k++) {
    const candidate = boards.map((b, i) => regenerateBoard(b, i, b.blockedValue, noise))
    // Only a set that is as sound as the one the build made: the same DR
    // under every board's tiles, the same reward items, no tile left empty,
    // and Board 1's starting goal still met.
    const sound = candidate.every((b, i) => mainChainSum(b) === mainChainSum(boards[i]) && rewardsOf(b) === rewardsOf(boards[i]) && b.blockedQueue.length === boards[i].blockedQueue.length && (boards[i].onboardingStatus?.feasible === false || b.onboardingStatus?.feasible !== false))
    if (!sound) continue
    const run = effortCurveOf(candidate)
    const reached = run.result.reachedAt?.[MAX_RANK] !== undefined
    const distance = effortDistance(run.curve, target)
    if ((reached && !best.reached) || (reached === best.reached && distance < best.distance - 1e-9)) best = { boards: candidate, curve: run.curve, distance, reached }
  }
  return { ...best, startDistance: start, target }
}
export const TWISTER_PRICE_STEPS_AIM = 2
// What a player collects is about twists x the price of one (economist: "if each twist is 10 and we got 15 its a total of 150 DRs, u now give thousands"): one price step per twist, with a little room so the last twist is not lost to rounding. It was 6, then 3.
const TWISTER_VALUE_STEPS_AIM = 1.1
// How close to the energy target a pass must land for the next pass to aim
// at the target again (buildSegment).
const NEAR_TARGET_CREDIT = 0.05
// A Twister item drops as a small reward the player merges up, like the
// others - by explicit economist feedback ("it should also drop it as a small
// reward. u now just give it to the users": a rank-4 item is collected the
// moment it drops, with nothing to merge). So the build never makes it bigger
// than rank 3; what that cannot carry has to come from more drops, and what
// that cannot carry either is reported as too little.
const TWISTER_MAX_ITEM_UNITS = 4 // a rank-3 item
const MAX_TWISTER_SIZINGS = 4
const TWISTER_SIZING_RUNS = 24
// How many times more Twister DR the worst-off segment needs (1 = enough).
export function twisterIncomeNeed(rows, segments) {
  let need = 0
  for (const row of rows ?? []) {
    if (!(row.twists > 0) || row.incomeMean == null) continue
    const step = Math.max(1, Math.round(segments.find((s) => s.index === row.index)?.twisterCostStep ?? 1))
    const wanted = TWISTER_PRICE_STEPS_AIM * row.twists * step
    need = Math.max(need, row.incomeMean > 0 ? wanted / row.incomeMean : Infinity)
  }
  return need
}

// The twists asked of the Twister are NOT one of the inputs above: they do
// not change a single board, only the price of a twist, and a price is cheap
// to work out again (priceTwisterForBuild) - so changing them never makes a
// build out of date. A draft remembers which twists its prices are for
// (`twisterKey`); when they differ, the price is simply worked out again.
// (They were an input at first: typing a number in the Twister tool then
// marked the whole build out of date and blocked testing it.)
export function twisterInputsKey(segments) {
  if (!(segments ?? []).some((s) => s.twists > 0)) return 'none'
  return JSON.stringify(segments.map((s) => [s.twists ?? null, s.twisterCheckpointPct ?? null, s.twisterCostStep ?? null]))
}

// The prices of a draft, worked out again for the twists asked now.
export async function repriceTwister({ phase, draft, segments, isCancelled }) {
  const twister = await priceTwisterForBuild({ phase, segments, built: draft.segments, shared: draft.shared, isCancelled })
  // The Twister items were sized for the twists the build was given. When the
  // new twists need more than they carry, that takes a build - said, not done.
  const sizing = draft.twister?.sizing ?? null
  if (twister && sizing) twister.sizing = { ...sizing, short: false, needsRebuild: sizing.valuesByBuild ? twisterIncomeNeed(twister.rows, segments) * (TWISTER_VALUE_STEPS_AIM / TWISTER_PRICE_STEPS_AIM) > 1.05 : twisterIncomeNeed(twister.rows, segments) > 1.05 && (sizing.minShare < 1 - 1e-9 || sizing.itemUnits < TWISTER_MAX_ITEM_UNITS - 1e-9) }
  return { ...draft, twister, twisterKey: twisterInputsKey(segments) }
}

export function buildInputsKey({ phase, segments }) {
  return JSON.stringify([phase, buildInputParts({ phase, segments })])
}

// Which parts differ between a draft's inputs and the current ones.
export function changedInputParts(draftParts, currentParts) {
  return Object.keys(INPUT_PART_LABELS).filter((k) => (draftParts?.[k] ?? null) !== (currentParts?.[k] ?? null))
}

// The built contents themselves - used to tell whether the project currently
// holds exactly what a draft proposed (i.e. the draft is applied).
export function contentsKey(boards) {
  return JSON.stringify((boards ?? []).map((b) => [b.semiPlacements, b.blockedQueue, b.rewardQueueItems ?? [], b.rewardSemiItems ?? [], b.effectiveBlockedValue ?? null, b.dropGroups ?? [], b.dropGroupsConfig ?? []]))
}

// --- Is the applied design consistent with a build? ---------------------------
// Applying a build stamps every board of the list with a fingerprint of the
// design as built (board.buildStamp). Any later change to what the energy
// accounting depends on - a reward item added by the advanced Rewards tool, a
// drop weight, a budget, a tile - changes the design's fingerprint, so the
// stamp no longer matches and the design is OUT OF DATE: its boards were
// allocated for an energy income it no longer has. This is what stops an
// advanced edit from leaving a design that still looks finalized.
function hashString(text) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36)
}
export const hashOf = (value) => hashString(JSON.stringify(value))

export const DESIGN_PART_LABELS = {
  layout: 'board layouts, pins or rank limits',
  budgets: 'subsidy budgets or CC',
  contents: 'main-chain queue contents',
  rewardItems: 'reward items under tiles',
  drops: 'merge-drop groups or weights',
  definitions: 'reward definitions or drop rules',
  generator: 'generator or lucky-drop settings',
}

export function designParts(boards) {
  const b0 = boards?.[0]
  return {
    layout: hashOf((boards ?? []).map((b) => [b.rows, b.cols, b.tiles, b.minRank, b.maxRank, b.forcedSemiRanks ?? [], b.rcEvent ?? false, b.onboardingDrBudget ?? null, b.onboardingTargetRank ?? null])),
    budgets: hashOf((boards ?? []).map((b) => [b.blockedValue, b.ccPercent ?? 0])),
    contents: hashOf((boards ?? []).map((b) => [(b.semiPlacements ?? []).filter((p) => isMainItem(p.rank)), (b.blockedQueue ?? []).filter(isMainItem), b.effectiveBlockedValue ?? null])),
    rewardItems: hashOf((boards ?? []).map((b) => [(b.semiPlacements ?? []).filter((p) => !isMainItem(p.rank)), (b.blockedQueue ?? []).map((v, i) => (isMainItem(v) ? null : [i, v])).filter(Boolean), b.rewardQueueItems ?? [], b.rewardSemiItems ?? []])),
    drops: hashOf([b0?.dropGroups ?? [], b0?.dropGroupsConfig ?? []]),
    definitions: hashOf([b0?.rewardChainConfig, b0?.minDropRank, b0?.rewardLeftoverPolicy]),
    generator: hashOf([b0?.targetEv, b0?.tier2UnlockRank, b0?.tier4UnlockRank]),
  }
}

export function designSignature(boards) {
  return hashOf(designParts(boards))
}

// Whether a design has any way to collect merge energy (so that a credit
// should have been taken off its boards).
function designHasEnergyIncome(boards) {
  const isEnergy = (v) => decodeReward(v)?.type === 'energy'
  const b0 = boards?.[0]
  const energyGroups = new Set((b0?.dropGroups ?? []).filter((g) => g.items?.energy != null).map((g) => g.id))
  const dropsEnergy = (b0?.dropGroupsConfig ?? []).some((t) => t.rank >= (b0?.minDropRank ?? 1) && t.entries.some((e) => energyGroups.has(e.groupId) && e.weight > 0))
  return dropsEnergy || (boards ?? []).some((b) => (b.blockedQueue ?? []).some(isEnergy) || (b.semiPlacements ?? []).some((p) => isEnergy(p.rank)))
}

// The stamp Apply writes on every board of a built list.
export function createBuildStamp(boards, { draft, segment, validation = null }) {
  return {
    signature: designSignature(boards),
    parts: designParts(boards),
    builtAt: draft.builtAt,
    appliedAt: Date.now(),
    deductionPolicy: segment.deductionPolicy,
    reconciliation: segment.reconciliation,
    validated: validation ? { runs: validation.runs, seed: validation.seed, ok: validation.ok } : null,
  }
}

// state:
//   'consistent'  - the design is exactly what a build applied.
//   'stale'       - it was built, then changed; `changed` names what.
//   'unaccounted' - never built by Build event, yet it pays merge energy, so
//                   no energy credit has been taken off its boards.
//   'manual'      - never built by Build event and pays no merge energy:
//                   nothing to reconcile.
//   'empty'       - nothing generated yet.
export function designConsistency(boards) {
  const built = (boards ?? []).some((b) => (b.semiPlacements?.length ?? 0) + (b.blockedQueue?.length ?? 0) > 0)
  if (!built) return { state: 'empty', changed: [], stamp: null }
  const stamp = boards[0]?.buildStamp ?? null
  if (!stamp) return { state: designHasEnergyIncome(boards) ? 'unaccounted' : 'manual', changed: [], stamp: null }
  if (stamp.signature === designSignature(boards)) return { state: 'consistent', changed: [], stamp }
  const now = designParts(boards)
  return { state: 'stale', changed: Object.keys(DESIGN_PART_LABELS).filter((k) => stamp.parts?.[k] !== now[k]), stamp }
}

// Whether a design may be presented or exported as finished without the
// economist explicitly overriding.
export function designNeedsRebuild(consistency) {
  return consistency.state === 'stale' || consistency.state === 'unaccounted'
}

// The fields of a board a build produces. Apply writes ONLY these onto the
// current board, so anything edited since the build that a build does not
// own (a Twister spin cost, the lucky-drop setting, a name) is never
// overwritten by an older draft.
const BUILD_OWNED_FIELDS = ['tiles', 'semiPlacements', 'blockedQueue', 'rewardQueueItems', 'rewardSemiItems', 'effectiveBlockedValue', 'onboardingStatus']

// The boards a segment's list holds once a draft segment is applied: the
// build's contents on the current boards, the shared drops, and the stamp.
export function boardsWithDraftApplied(currentBoards, draftSegment, shared, { draft, validation = null }) {
  const twisterRow = draft?.twister?.rows?.find((r) => r.index === draftSegment.index) ?? null
  const merged = currentBoards.map((b, i) => {
    const built = draftSegment.boards[i]
    if (!built) return b
    const next = { ...b }
    for (const field of BUILD_OWNED_FIELDS) next[field] = built[field]
    // Coin rank values the build sized for THIS segment (only when the coin
    // ladder is set by the build - typed values are never overwritten).
    if (draftSegment.coinLadder && coinLadderIsAuto(b.rewardChainConfig)) next.rewardChainConfig = { ...b.rewardChainConfig, [COIN_TYPE]: draftSegment.coinLadder }
    if (shared) {
      next.dropGroups = shared.dropGroups
      next.dropGroupsConfig = shared.dropGroupsConfig
    }
    // Twister rank values the build sized (shared by every segment).
    if (draft?.shared?.twisterLadder) next.rewardChainConfig = { ...next.rewardChainConfig, [TWISTER_TYPE]: draft.shared.twisterLadder }
    // The price of a twist the build worked out for THIS segment.
    if (twisterRow?.cost != null) {
      next.twisterSpinCost = twisterRow.cost
      next.twisterCostBasis = { hash: null, source: 'build', at: draft?.builtAt ?? null }
    }
    return next
  })
  const stamp = createBuildStamp(merged, { draft, segment: draftSegment, validation })
  return merged.map((b) => ({ ...b, buildStamp: stamp }))
}

// Whether the design currently holds exactly this draft's segment.
export function draftSegmentIsApplied(currentBoards, draft) {
  const c = designConsistency(currentBoards)
  return c.state === 'consistent' && c.stamp?.builtAt === draft.builtAt
}

// The one definition of "what a build of this phase is built from", used by
// the Build Event page, the Twister tool and the persistence check alike.
// `segments`: [{ name, mainBoards, rcBoards, rewardTargets, segmentFactor,
// sourceAllocation }] - the base segment first.
export function segmentBuildInputs(segments, phase) {
  const base = segments[0]
  // Twister twists (optional): typed per segment in step 4, held on the base
  // segment's Twister plan for this phase.
  const twisterPlan = base.twisterPlan?.[phase] ?? null
  const baseTargets = base.rewardTargets?.[phase] ?? {}
  const allocation = base.sourceAllocation?.[phase] ?? {}
  const tw = allocation.tileWeight ?? 0.5
  const dw = allocation.dropWeight ?? 0.5
  // Merge drops are always the bigger part of a reward (see
  // MAX_TILE_SHARE_PCT): whatever was typed, no more than that share is asked
  // of the tiles, and the build takes less when the containers need more.
  const capTile = (v) => (Number.isFinite(v) ? Math.min(v, MAX_TILE_SHARE_PCT) : v)
  const typedPerResource = allocation.perResource ?? {}
  const split = {
    sharedTilePct: capTile(Math.round((tw + dw > 0 ? tw / (tw + dw) : 0.5) * 100)),
    perResource: Object.fromEntries(Object.entries(typedPerResource).map(([type, v]) => [type, typeof v === 'number' ? capTile(v) : v && typeof v === 'object' && 'tilePct' in v ? { ...v, tilePct: capTile(v.tilePct) } : v])),
  }
  return segments.map((seg, i) => ({
    index: i,
    name: seg.name || `Segment ${i + 1}`,
    factor: i === 0 ? 1 : (seg.segmentFactor ?? 1),
    boards: phase === 'main' ? seg.mainBoards : seg.rcBoards,
    mainBoards: phase === 'rc' ? seg.mainBoards : null,
    // Only coins may be a fraction; every other target is a whole number.
    targets: Object.fromEntries(REWARD_TYPES.map((t) => [t, roundRewardAmount(t, (baseTargets[t] ?? 0) * (i === 0 ? 1 : (seg.segmentFactor ?? 1)))])),
    split,
    twists: twisterPlan ? targetSpinsForSegment(twisterPlan, i) : null,
    twisterCheckpointPct: twisterPlan?.checkpointPct ?? TWISTER_EASY_CHECKPOINT_PCT,
    twisterCostStep: twisterPlan?.costIncrement ?? 1,
    twisterByBuild: !!(phase === 'main' ? base.mainBoards : base.rcBoards)?.[0]?.twisterByBuild,
  }))
}

// "Build whole event" builds Recompletion on top of the Normal DRAFT, before
// that draft is applied: the Recompletion inputs with every built segment's
// main boards as they will be once the Normal draft is applied. Applying the
// Normal draft afterwards yields exactly these boards, so the Recompletion
// draft built against them is then current as it stands.
export function rcInputsOnMainDraft(segments, mainDraft) {
  const shared = mainDraft?.shared
  const withDraft = segments.map((seg, i) => {
    const built = mainDraft?.segments.find((s) => s.index === i && s.status !== 'skipped')
    if (built) return { ...seg, mainBoards: boardsWithDraftApplied(seg.mainBoards, built, shared, { draft: mainDraft }) }
    // A segment the build skipped still receives the shared merge drops once
    // the base segment's are applied (drops are one set for every segment).
    return shared ? { ...seg, mainBoards: seg.mainBoards.map((b) => ({ ...b, dropGroups: shared.dropGroups, dropGroupsConfig: shared.dropGroupsConfig })) } : seg
  })
  return segmentBuildInputs(withDraft, 'rc')
}

export const draftIsUsable = (draft) => !!draft && draft.status !== 'infeasible' && draft.status !== 'nothing-built'

// Every list in the event whose applied design should not be presented or
// exported as finished: [{ segmentIndex, name, phase, state, changed }].
export function eventDesignIssues(segments) {
  const issues = []
  segments.forEach((seg, i) => {
    for (const [phase, boards] of [
      ['main', seg.mainBoards],
      ['rc', seg.rcBoards],
    ]) {
      const c = designConsistency(boards)
      if (designNeedsRebuild(c)) issues.push({ segmentIndex: i, name: seg.name || `Segment ${i + 1}`, phase, state: c.state, changed: c.changed })
    }
  })
  return issues
}

// --- Draft persistence ----------------------------------------------------------
// Drafts are kept in their own storage entry, apart from the applied project
// (which is only ever written by Save). A restored draft is marked as such
// and is never applied on its own.
export const DRAFT_STORAGE_KEY = 'merge-mania-build-drafts'
export const DRAFT_FORMAT_VERSION = 2

export function serializeDrafts({ drafts, validation }) {
  return JSON.stringify({ format: DRAFT_FORMAT_VERSION, savedAt: Date.now(), drafts, validation })
}

// Returns { drafts, validation, notice }. A stored entry from an
// incompatible format is not restored; `notice` says so. Never throws.
export function deserializeDrafts(text) {
  const empty = { drafts: { main: null, rc: null }, validation: { main: null, rc: null }, notice: null }
  if (!text) return empty
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ...empty, notice: 'A saved draft could not be read and was not restored. Your applied design is unaffected - rebuild to get a new draft.' }
  }
  if (parsed?.format !== DRAFT_FORMAT_VERSION) {
    return { ...empty, notice: 'A draft saved by an earlier version of the app is not compatible with this one and was not restored. Your applied design is unaffected - rebuild to get a new draft.' }
  }
  const mark = (d) => (d && Array.isArray(d.segments) && d.key ? { ...d, restored: true } : null)
  return { drafts: { main: mark(parsed.drafts?.main), rc: mark(parsed.drafts?.rc) }, validation: { main: parsed.validation?.main ?? null, rc: parsed.validation?.rc ?? null }, notice: null }
}

// --- Review helpers -----------------------------------------------------------
function rewardItemsOnBoard(board) {
  const counts = {}
  const add = (value, where) => {
    const info = decodeReward(value)
    if (!info) return
    const key = `${info.type}:${info.rank}:${where}`
    counts[key] = (counts[key] ?? 0) + 1
  }
  for (const v of board.blockedQueue ?? []) add(v, 'blocked')
  for (const p of board.semiPlacements ?? []) add(p.rank, 'semi')
  return Object.entries(counts).map(([key, count]) => {
    const [type, rank, where] = key.split(':')
    return { type, rank: Number(rank), where, count }
  })
}

// --- Quick fixes ---------------------------------------------------------------
// By explicit economist request ("when he says fixes are needed, lets give
// the suggestions and a quick fix for each problem"): every problem a build
// reports carries the concrete changes that would resolve it. A quick fix is
// plain data - { id, kind, label, ...params } - carried out by the workflow
// (BuildEventReview's applyFix), never by the build itself; the economist
// clicks it, and then rebuilds.
function quickFix(kind, label, params = {}) {
  return { id: `${kind}:${JSON.stringify(params)}`, kind, label, ...params }
}

// The lowest "highest rank under tiles" at which this board's tiles could
// hold its DR (reward items take a tile each and hold no DR).
function raiseMaxRankFix(board, index, target) {
  const rewardTiles = (board.blockedQueue ?? []).filter((v) => !isMainItem(v)).length + (board.semiPlacements ?? []).filter((p) => !isMainItem(p.rank)).length
  const free = subsidyTileCount(board) - rewardTiles
  for (let rank = (board.maxRank ?? 1) + 1; rank <= MAX_RANK; rank++) {
    if (free * valueOf(rank) >= target) return quickFix('setMaxRank', `Raise Board ${index + 1}'s highest rank under tiles to ${rank} (all segments)`, { boardIndex: index, value: rank })
  }
  return null
}

function boardChecksFor(board, index, allocation, { segmentIndex = 0, name = 'this segment', spreadHelps = false } = {}) {
  const spreadFix = spreadHelps ? quickFix('spreadBudget', `Spread ${name}'s DR evenly over its boards`, { segmentIndex }) : null
  const pinFix = (board.forcedSemiRanks ?? []).length > 0 ? quickFix('clearPins', `Remove the pinned ranks on Board ${index + 1} (all segments)`, { boardIndex: index }) : null
  const tiles = subsidyTileCount(board)
  const items = (board.semiPlacements?.length ?? 0) + (board.blockedQueue?.length ?? 0)
  const mainSum = mainChainSum(board)
  const target = allocation
  const floorStep = valueOf(board.minRank ?? 1)
  const exact = mainSum === target
  const roundedUp = mainSum > target && mainSum - target < Math.max(floorStep, 1)
  const withinMargin = !exact && !roundedUp && Math.abs(mainSum - target) <= DR_TOLERANCE * target
  const checks = []
  checks.push({
    id: 'exact-dr',
    ok: exact || roundedUp || withinMargin,
    label: exact
      ? `Main-chain DR is exact (${mainSum} of ${target})`
      : roundedUp
        ? `Main-chain DR ${mainSum} for a ${target} allocation - rounded up to the minimum-rank step`
        : withinMargin
          ? `Main-chain DR ${mainSum} for a ${target} allocation - within the ${Math.round(DR_TOLERANCE * 100)}% margin`
        : mainSum < target
          ? `Only ${mainSum} of ${target} DR fits: the tiles at this board's max rank cannot hold more`
          : `Carries ${mainSum} DR against a ${target} allocation - pinned contents are worth more than the board's share`,
    cause: exact || roundedUp || withinMargin ? null : mainSum < target ? 'tile-capacity' : 'pins-conflict',
    short: mainSum < target ? `its tiles can only hold ${mainSum} of the ${target} DR` : 'a pinned rank is worth more than the board\'s DR',
    fixes: exact || roundedUp || withinMargin ? [] : mainSum < target ? [raiseMaxRankFix(board, index, target)] : [pinFix],
  })
  const noBudget = tiles > 0 && target === 0
  // A tile without an item never opens: the player merges next to it and
  // nothing happens. It is always reported. (It used to be let through
  // "within the margin" - up to 5% of a board's tiles - and the economist met
  // one in play.) The generators now fill every tile whenever the board's DR
  // can, so this only fires when there truly is too little DR for the tiles.
  const emptyWithinMargin = false
  checks.push({
    id: 'tiles-filled',
    ok: items === tiles || emptyWithinMargin,
    label:
      items === tiles
        ? `Every blocked and semi-blocked tile has an item (${tiles})`
        : emptyWithinMargin
          ? `${tiles - items} of ${tiles} tiles has no item and never opens - within the margin`
        : noBudget
          ? `${tiles - items} tile${tiles - items === 1 ? '' : 's'} have no item: this board has tiles but no subsidy to put under them`
          : `${Math.abs(tiles - items)} tile${Math.abs(tiles - items) === 1 ? '' : 's'} ${items < tiles ? 'left without an item' : 'short for the items generated'}`,
    cause: items === tiles || emptyWithinMargin ? null : noBudget ? 'zero-budget' : 'tile-capacity',
    short: noBudget ? 'has blocked tiles but no DR to put under them' : `${Math.abs(tiles - items)} tile${Math.abs(tiles - items) === 1 ? '' : 's'} ${items < tiles ? 'left empty' : 'too few for the items'}`,
    fixes:
      items === tiles || emptyWithinMargin
        ? []
        : [spreadFix, !noBudget && items < tiles && (board.minRank ?? 1) > 1 ? quickFix('setMinRank', `Lower Board ${index + 1}'s lowest rank under tiles to 1 (all segments)`, { boardIndex: index, value: 1 }) : null],
  })
  if (index === 0) {
    checks.push({
      id: 'board1-cap',
      ok: mainSum <= activeFirstBoardCap,
      label: mainSum <= activeFirstBoardCap ? `Board 1 is within its ${activeFirstBoardCap} DR cap (${mainSum})` : `Board 1 carries ${mainSum} DR, above its ${activeFirstBoardCap} DR cap`,
      cause: mainSum <= activeFirstBoardCap ? null : 'pins-conflict',
      short: `holds ${mainSum} DR, above the ${activeFirstBoardCap} DR limit`,
      fixes: mainSum <= activeFirstBoardCap ? [] : [pinFix],
    })
    if (board.onboardingDrBudget != null && board.onboardingTargetRank != null) {
      const feasible = board.onboardingStatus?.feasible !== false
      checks.push({
        id: 'onboarding',
        ok: feasible,
        label: feasible
          ? `Onboarding goal holds (rank ${board.onboardingTargetRank} within ${board.onboardingDrBudget} DR)`
          : `Onboarding goal cannot be met (rank ${board.onboardingTargetRank} within ${board.onboardingDrBudget} DR)`,
        cause: feasible ? null : 'onboarding',
        short: `the starting goal (rank ${board.onboardingTargetRank} within ${board.onboardingDrBudget} DR) cannot be reached`,
        fixes: feasible
          ? []
          : [
              board.onboardingTargetRank > 2 ? quickFix('setOnboarding', `Lower the starting goal to rank ${board.onboardingTargetRank - 1}`, { segmentIndex, targetRank: board.onboardingTargetRank - 1, drBudget: board.onboardingDrBudget }) : null,
              quickFix('setOnboarding', 'Remove the starting goal', { segmentIndex, targetRank: null, drBudget: null }),
            ],
      })
    }
  }
  checks.push({
    id: 'no-twister',
    ok: !boardHasTwisterUnderTiles(board),
    label: 'No Twister item under any starting tile',
    cause: null,
  })
  return checks
}

// Where each kind of problem is fixed. `step` is a Build Event step id.
// Written for an economist, not for whoever wrote the solver: what happened,
// in the words the inputs use, and what to change.
export const CAUSES = {
  'tile-capacity': { title: 'Not enough blocked tiles', step: 'layouts', action: 'Add blocked or semi-blocked tiles to this segment\'s boards, raise a board\'s max rank, or lower the reward targets' },
  'pins-conflict': { title: 'A rank you pinned is worth more than its board can hold', step: 'layouts', action: 'Remove or lower the pinned rank, or give that board more DR' },
  'few-merges': { title: 'Too few merges to drop this many rewards', step: 'rewards', action: 'Put more of the rewards under tiles instead of merge drops, or lower the target' },
  'coarse-ladder': { title: 'A reward is paid in fixed steps, so its target cannot be hit exactly', step: 'definitions', action: 'Pick a target the rank values can add up to, or change the rank values' },
  'shared-odds': { title: 'Merge drops alone already pay more than this segment should get', step: 'rewards', action: 'Merge drops are the same for every segment. Raise this segment\'s factor, or move the base segment\'s rewards from merge drops to under tiles' },
  'no-definition': { title: 'A reward has no rank values', step: 'definitions', action: 'Enter what each rank pays' },
  'negative-subsidy': { title: 'The merge-energy deduction is bigger than the later boards can give up', step: 'setup', action: 'Give the boards after Board 1 more DR, or lower the merge energy target' },
  'only-board-1': { title: 'There is only Board 1, and nothing is ever deducted from Board 1', step: 'setup', action: 'Add a second board to take the deduction, or remove the merge energy this phase pays' },
  'zero-budget': { title: 'A board has blocked tiles but no DR to put under them', step: 'setup', action: 'Give that board DR in step 1, or clear its blocked tiles' },
  onboarding: { title: 'Board 1\'s starting goal cannot be reached', step: 'layouts', action: 'Check Board 1\'s starting goal (the rank and the DR) and its tiles' },
  'rc-not-reached': { title: 'Players never reach Recompletion', step: 'phase', action: 'Fix the Normal phase first' },
  'drop-floor': { title: 'Every merge from the start rank drops, and that alone pays more than the target', step: 'rewards', action: 'Start merge drops at a later rank, or raise the reward targets' },
  'off-target': { title: 'A reward is paid more than 15% away from its target', step: 'rewards', action: 'See the rewards table below for which one and by how much' },
}

// Merge-energy deduction that could not be taken off the boards only matters
// once it is more than the DR margin of the segment's whole DR.
function creditShortfallMatters(allocation) {
  return allocation.creditUnabsorbed > Math.max(0.5, DR_TOLERANCE * allocation.totalBefore)
}

function causesFrom({ sub, allocation, boardChecks, dropsFixed, context = {} }) {
  const { index = 0, name = 'this segment', factor = 1, baseTargets = {} } = context
  const isBase = index === 0
  const out = []
  // `short` is the one-line version for the segment overview table.
  const add = (code, detail, short, fixes = []) => {
    if (!out.some((c) => c.code === code && c.detail === detail)) out.push({ code, detail, short: short ?? CAUSES[code].title, fixes: fixes.filter(Boolean), ...CAUSES[code] })
  }
  const marginPct = Math.round(OFF_TARGET_TOLERANCE * 100)
  const off = new Set(sub.feasibility.offTarget ?? [])
  const row = (type) => sub.perResourceReview.find((r) => r.type === type)
  const amount = (type, v) => formatRewardAmount(type, v)
  // The base segment's target is typed; every other segment's is the base
  // target x its factor, so that is what a fix moves for it.
  const targetFix = (type, value, why) => {
    const v = roundRewardAmount(type, value)
    if (!(v >= 0) || v === (baseTargets[type] ?? 0)) return null
    return quickFix('setBaseTarget', `${v === 0 ? `Remove the ${REWARD_TARGET_LABELS[type].toLowerCase()} target` : `Change the ${REWARD_TARGET_LABELS[type].toLowerCase()} target to ${amount(type, v)}`}${why ? ` (${why})` : ''}`, { type, value: v })
  }
  const factorFix = (type) => {
    const r = row(type)
    if (isBase || !r || !(r.target > 0) || !(r.predicted > 0)) return null
    const value = Math.round(factor * (r.predicted / r.target) * 100) / 100
    if (!(value > 0) || value === factor) return null
    return quickFix('setFactor', `${value < factor ? 'Lower' : 'Raise'} ${name}'s reward factor from ${factor} to ${value} (what its boards can pay)`, { segmentIndex: index, value })
  }
  const meetFix = (type) => (isBase ? targetFix(type, row(type)?.predicted ?? 0, 'what this design pays') : factorFix(type))

  // Reward items are counted in rank-1 equivalents ("units"): a rank-3 item
  // is 4 of them. Said as tiles, which is what the economist can add.
  const tilesFor = (units) => Math.max(1, Math.ceil(units / 4))
  for (const type of REWARD_TYPES) {
    const plan = sub.plan[type]
    if (!(plan.target > 0)) continue
    const label = REWARD_TARGET_LABELS[type]
    if (plan.noPrize) add('no-definition', `${label} has a target, but its rank ${REWARD_MAX_RANK} pays nothing yet.`, `${label}: no rank values`)
    // Inside the margin, an item that did not fit is not a problem.
    if (!off.has(type)) continue
    const unplaced = sub.placementPerResource?.[type]?.unitsUnplaced ?? 0
    const tiles = tilesFor(unplaced)
    if (unplaced > 0 && dropsFixed) {
      add(
        'tile-capacity',
        `${label}: this segment needs about ${tiles} more blocked tile${tiles === 1 ? '' : 's'} to hide its ${label.toLowerCase()} items under. Its target is higher than what the merge drops (shared by all segments) pay, and the difference has to sit under its own tiles.`,
        `${label}: about ${tiles} more blocked tile${tiles === 1 ? '' : 's'} needed for its reward items`,
        [factorFix(type)],
      )
    } else if (unplaced > 0 && sub.feasibility.infeasibleReasons.some((r) => r.includes('neither tiles nor merge drops'))) {
      add(
        'tile-capacity',
        `${label}: about ${tiles} blocked tile${tiles === 1 ? '' : 's'} worth of ${label.toLowerCase()} items fit neither under the tiles nor in the merge drops.`,
        `${label}: no room for all of its reward items`,
        [meetFix(type)],
      )
    }
  }
  const reasons = sub.feasibility.infeasibleReasons
  if (reasons.some((r) => r.includes('not enough eligible merges'))) {
    add(
      'few-merges',
      `A player makes about ${Math.round(sub.eligibleMerges ?? 0)} merges that can drop a reward in this phase - not enough to drop everything asked of merge drops.`,
      'Too few merges for the rewards asked of merge drops',
      (sub.shortDropTypes ?? []).map(meetFix),
    )
  }
  if (reasons.some((r) => r.includes('RC phase never reached'))) add('rc-not-reached', 'No simulated player cleared the normal boards and reached Recompletion.')
  const over = REWARD_TYPES.filter((t) => off.has(t) && (row(t)?.predicted ?? 0) > (row(t)?.target ?? 0))
  if (over.length > 0 && sub.findings.some((f) => f.includes('shared drop configuration alone already delivers more'))) {
    add(
      'shared-odds',
      `${over.map((t) => REWARD_TARGET_LABELS[t]).join(', ')}: the merge drops (the same for every segment) already pay more than this segment's target, before any reward item under its tiles.`,
      `${over.map((t) => REWARD_TARGET_LABELS[t]).join(', ')}: merge drops alone pay more than this segment's target`,
      [factorFix(over[0])],
    )
  }
  // "Every merge drops" has a floor of one item per merge. When that floor
  // alone pays a reward more than its target plus the margin, the start rank
  // is not moved - the economist is told, and offered the rank that fits.
  const floored = !dropsFixed && sub.dropFloor ? REWARD_TYPES.filter((t) => off.has(t) && (row(t)?.predicted ?? 0) > (row(t)?.target ?? 0)) : []
  if (floored.length > 0) {
    const names = floored.map((t) => `${REWARD_TARGET_LABELS[t]} ${amount(t, row(t).predicted)} against ${amount(t, row(t).target)}`).join(', ')
    const fitting = sub.dropFloor.fittingStartRank
    add(
      'drop-floor',
      `Every merge that makes a rank ${sub.dropFloor.startRank} or higher item drops a reward, and a player makes about ${Math.round(sub.eligibleMerges ?? 0)} of those merges. At one item each that already pays more than was asked: ${names}.`,
      `Merge drops from rank ${sub.dropFloor.startRank} alone pay more than the targets (${names})`,
      [fitting ? quickFix('setMinDropRank', `Start merge drops at rank ${fitting} instead of ${sub.dropFloor.startRank} (all segments)`, { value: fitting }) : null, ...floored.map(meetFix)],
    )
  }
  // A target smaller than half of one rank-4 prize: the average can be made
  // to match, but only by most players collecting nothing and a few a whole
  // prize. That is worth saying even when the average lands inside the margin.
  const tooSmall = REWARD_TYPES.filter((t) => sub.plan[t].target > 0 && !sub.plan[t].noPrize && sub.plan[t].feasiblePayout === 0 && sub.plan[t].exact === false)
  for (const type of tooSmall) {
    const label = REWARD_TARGET_LABELS[type]
    const top = rewardPrizeAmount(sub.rewardChainConfig, type, REWARD_MAX_RANK)
    const asked = amount(type, sub.plan[type].target)
    add(
      'coarse-ladder',
      `${label}: a rank-${REWARD_MAX_RANK} item pays ${amount(type, top)}, which is more than the whole target of ${asked}. Most players would collect nothing and a few would collect ${amount(type, top)}.`,
      `${label}: can pay nothing or ${amount(type, top)} per player, not ${asked}`,
      [
        isBase
          ? targetFix(type, top, 'one rank-4 item')
          : quickFix('setFactor', `Raise ${name}'s reward factor from ${factor} to ${Math.ceil((factor * top * 100) / sub.plan[type].target) / 100} (one rank-${REWARD_MAX_RANK} item)`, { segmentIndex: index, value: Math.ceil((factor * top * 100) / sub.plan[type].target) / 100 }),
        sub.leftoverPolicy === 'collect' ? null : quickFix('setLeftoverPolicy', 'Pay unmerged leftover items at their own rank\'s value, so smaller amounts can be paid (all segments)', { value: 'collect' }),
      ],
    )
  }
  // A reward paid in fixed steps whose result lands outside the margin.
  const coarse = new Set(sub.feasibility.ladderLimited ?? [])
  for (const type of off) if (sub.plan[type]?.target > 0 && sub.plan[type].exact === false) coarse.add(type)
  for (const type of coarse) {
    if (tooSmall.includes(type) || floored.includes(type)) continue
    if (over.includes(type) && out.some((c) => c.code === 'shared-odds')) continue // already reported, with its fix
    const r = row(type)
    const label = REWARD_TARGET_LABELS[type]
    const top = rewardPrizeAmount(sub.rewardChainConfig, type, REWARD_MAX_RANK)
    const can = amount(type, r?.feasiblePayout ?? 0)
    const asked = amount(type, r?.target ?? 0)
    add(
      'coarse-ladder',
      `${label}: a rank-${REWARD_MAX_RANK} item pays ${amount(type, top)}${sub.leftoverPolicy === 'collect' ? '' : ', and unmerged items left at the end pay nothing'}, so the closest this can get to ${asked} is ${can} - more than ${marginPct}% away.`,
      `${label}: can pay ${can}, not ${asked} (rank ${REWARD_MAX_RANK} pays ${amount(type, top)} at a time)`,
      [
        isBase ? targetFix(type, r?.feasiblePayout ?? 0, 'the closest amount the ranks can pay') : factorFix(type),
        sub.leftoverPolicy === 'collect' ? null : quickFix('setLeftoverPolicy', 'Pay unmerged leftover items at their own rank\'s value, so finer amounts can be paid (all segments)', { value: 'collect' }),
      ],
    )
  }
  if (creditShortfallMatters(allocation)) {
    const short = allocation.creditUnabsorbed.toFixed(1)
    if (allocation.unabsorbedReason === 'only-board-1') {
      add('only-board-1', `${short} DR of energy credit has nowhere to be deducted: this phase has a single board, and Board 1 is never deducted from.`, `${short} DR of merge-energy deduction has no board to come off`, [targetFix('energy', 0)])
    } else {
      const floored = allocation.atFloor.map((f, i) => (f ? i + 1 : null)).filter(Boolean)
      // The most merge energy the later boards can pay for, as a base target.
      const affordable = Math.floor(allocation.totalDeductible / ENERGY_CREDIT_RATE / (factor || 1))
      add(
        'negative-subsidy',
        `${short} DR of the ${allocation.creditWanted.toFixed(1)} DR credit could not be deducted. The later boards can give up ${allocation.totalDeductible.toFixed(1)} DR in total before they fall below what their pinned ranks and tiles need${floored.length ? ` (board${floored.length === 1 ? '' : 's'} ${floored.join(', ')} at the minimum)` : ''}. Board 1 is protected.`,
        `${short} DR of merge-energy deduction does not fit on the later boards`,
        [affordable < (baseTargets.energy ?? 0) ? targetFix('energy', affordable, 'what the later boards can cover') : null],
      )
    }
  }
  boardChecks.forEach((checks, i) => {
    for (const c of checks) if (!c.ok && c.cause) add(c.cause, `Board ${i + 1}: ${c.label}.`, `Board ${i + 1}: ${c.short ?? c.label}`, c.fixes ?? [])
  })
  const plainOff = [...off].filter((t) => !coarse.has(t))
  if (plainOff.length && out.length === 0) {
    const names = plainOff.map((t) => REWARD_TARGET_LABELS[t]).join(', ')
    add('off-target', `${names}: the average simulated player collects more than ${marginPct}% above or below the target.`, `${names}: more than ${marginPct}% off target`, plainOff.map(meetFix))
  }
  return out
}

// --- One segment --------------------------------------------------------------
// `context` ({ index, name, factor, baseTargets }) says which segment this
// is, so a problem's quick fix can name what to change for it.
export async function buildSegment({ phase, boards: inputBoards, mainBoards = null, targets, split, dropsFixed = false, sharedDrops = null, coinPlanTarget = null, dropCapPct = null, twisterNeed = null, context = null, maxPasses = MAX_PASSES, onProgress, isCancelled }) {
  activeFirstBoardCap = firstBoardCapFor(phase)
  const ctx = { index: 0, name: 'this segment', factor: 1, baseTargets: targets ?? {}, ...(context ?? {}) }
  const noise = 0.15
  // Coin rank values set by the build: every pass starts from the same
  // provisional values (so a rebuild does not depend on the last one), and
  // the solve sizes them for this segment at the end.
  const autoCoins = (targets?.coins ?? 0) > 0 && coinLadderIsAuto(inputBoards[0]?.rewardChainConfig) ? { planTarget: coinPlanTarget ?? coinPlanTargetFor(targets.coins) } : null
  const boards = autoCoins ? inputBoards.map((b) => ({ ...b, rewardChainConfig: withGeneratedCoinValues(b.rewardChainConfig, COIN_VALUE_SHAPE) })) : inputBoards
  let credit = ENERGY_CREDIT_RATE * Math.max(0, targets?.energy ?? 0)
  const passes = []
  let best = null
  let converged = false

  // Each pass builds the boards for an assumed credit, then measures the
  // energy THAT configuration collects. The pass kept is the one whose own
  // simulation agrees best with the credit it was built with - so the
  // reported energy always belongs to the configuration being returned.
  // Reward items a pass kept off a board (they held the next board back)
  // stay off in the passes after it, so the passes settle.
  let tileCaps = null
  for (let pass = 1; pass <= maxPasses; pass++) {
    const allocation = allocateSubsidy(boards, credit, { firstBoardCap: activeFirstBoardCap })
    onProgress?.({ pass, maxPasses, label: 'Building board contents' })
    await tick()
    if (isCancelled?.()) return null
    const work = boards.map((b, i) => regenerateBoard({ ...b, effectiveBlockedValue: allocation.after[i] }, i, b.blockedValue, noise))
    const sub = await generateSmallRewardsConfiguration({
      phase,
      boards: work,
      mainBoards,
      targets,
      split,
      dropsFixed,
      sharedDrops,
      autoCoins,
      dropCapPct,
      alwaysDrop: true,
      twisterNeed,
      tileCapsStart: tileCaps,
      noise,
      onProgress: (label) => onProgress?.({ pass, maxPasses, label }),
      isCancelled,
    })
    if (!sub) return null
    tileCaps = sub.tileHold?.caps ?? tileCaps
    const energySimulated = sub.energy.expectedCollectibleEnergy
    const creditSimulated = ENERGY_CREDIT_RATE * energySimulated
    // The credit this pass could actually deduct (the rest is infeasible and
    // is not something another pass can fix).
    const gap = creditSimulated - allocation.creditWanted
    passes.push({ pass, creditAssumed: credit, creditTaken: allocation.creditTaken, energySimulated, creditSimulated, gap, allocationAfter: allocation.after })
    if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { sub, allocation, gap, pass, energySimulated, creditSimulated }
    if (Math.abs(gap) <= CREDIT_TOLERANCE_DR) {
      converged = true
      break
    }
    // The next pass. A pass that landed within a prize or so of the energy
    // TARGET is tried again for the target itself: the solve aims at the
    // target every time, so assuming it is the credit most likely to be met
    // exactly - following a near miss instead only moves the boards by a DR
    // or two and misses again on the other side. Any other result is
    // followed as it is. Either way a pass only counts as settled when its
    // own simulation agrees with the credit it was built with.
    const targetCredit = ENERGY_CREDIT_RATE * Math.max(0, targets?.energy ?? 0)
    credit = targetCredit > 0 && Math.abs(creditSimulated - targetCredit) <= targetCredit * NEAR_TARGET_CREDIT ? targetCredit : creditSimulated
  }

  const { sub, allocation } = best
  // The boards the build made, or - when the economist asked for an effort
  // distribution - the equally sound set that is closest to it.
  const effortTarget = phase === 'main' ? effortTargets.main : null
  const effortFit = effortTarget ? pickBoardsForEffort(sub.boards, effortTarget, noise) : null
  const draftBoards = effortFit ? effortFit.boards : sub.boards
  // Spreading only helps when it would actually give every later board DR.
  const spreadHelps =
    draftBoards.length > 1 &&
    allocation.totalBudget - Math.min(activeFirstBoardCap, allocation.totalBudget) >= draftBoards.length - 1 &&
    spreadSubsidy(draftBoards.length, allocation.totalBudget, phase).join() !== allocation.budget.join()
  const boardChecks = draftBoards.map((b, i) => boardChecksFor(b, i, allocation.after[i], { segmentIndex: ctx.index, name: ctx.name, spreadHelps }))
  const causes = causesFrom({ sub, allocation, boardChecks, dropsFixed, context: ctx })
  const constraintsOk = boardChecks.every((checks) => checks.every((c) => c.ok))
  // What stops a build from being usable is structural: a board that cannot
  // hold its DR, a starting goal that fails, a deduction that does not fit,
  // a reward with no values, Recompletion never reached. A reward AMOUNT that
  // ends outside its margin does not: the boards are sound, the amount can be
  // improved, and it is reported that way ("Can be improved") with its fix.
  const rewardAmountOnly = (reason) => /tile placements don't fit|neither tiles nor merge drops|not enough eligible merges/.test(reason)
  const infeasible = sub.feasibility.infeasibleReasons.some((r) => !rewardAmountOnly(r)) || creditShortfallMatters(allocation) || !constraintsOk
  const status = infeasible ? 'infeasible' : sub.feasibility.status === 'ok' && converged && causes.length === 0 ? 'ok' : 'review'

  // Exact reconciliation - no figure here is rounded to look tidy:
  //   unrounded target = subsidy after CC - 0.80 x the energy THIS
  //                      configuration collects
  //   residual         = main-chain DR actually generated - unrounded target
  // and the residual is fully accounted for by its three possible sources.
  const generatedDr = sum(draftBoards.map(mainChainSum))
  const creditCalculated = best.creditSimulated
  const unroundedTarget = allocation.totalBefore - creditCalculated
  const reconciliation = {
    budget: allocation.totalBudget,
    afterCc: allocation.totalBefore,
    energyCollected: best.energySimulated,
    creditRate: ENERGY_CREDIT_RATE,
    creditCalculated,
    unroundedTarget,
    creditDeducted: allocation.creditTaken,
    allocationTotal: allocation.totalAfter,
    generatedDr,
    residual: generatedDr - unroundedTarget,
    parts: {
      // Credit the simulation implies but the boards were not built with:
      // the convergence gap, plus any credit that could not be deducted.
      creditNotDeducted: creditCalculated - allocation.creditTaken,
      // The allocation is in whole DR.
      allocationRounding: allocation.roundingResidual,
      // Boards that could not be generated at exactly their allocation
      // (minimum-rank steps, tile capacity, pins).
      generation: generatedDr - allocation.totalAfter,
    },
  }

  return {
    status,
    feasibility: sub.feasibility,
    boards: draftBoards,
    dropGroups: sub.dropGroups,
    dropGroupsConfig: sub.dropGroupsConfig,
    generatedGroups: sub.generatedGroups,
    // Coin rank values sized for this segment (null when the economist typed
    // their own, which are shared and left alone).
    coinLadder: sub.coinValues ? sub.rewardChainConfig[COIN_TYPE] : null,
    coinValues: sub.coinValues,
    dropStartRank: sub.dropStartRank,
    multiDropRank: sub.multiDropRank ?? null,
    multiDropShort: !!sub.multiDropShort,
    tripleDropRank: sub.tripleDropRank ?? null,
    tripleDropShort: !!sub.tripleDropShort,
    twisterMinShare: sub.twisterMinShare ?? null,
    // The effort distribution asked for and what these boards give (share of
    // effort per rank, main chain alone), when one was asked.
    effortFit: effortFit ? { target: effortFit.target, curve: effortFit.curve, distance: effortFit.distance, startDistance: effortFit.startDistance } : null,
    // Reward items kept off tiles because they held the next board back.
    tileHold: sub.tileHold ? { ...sub.tileHold, caps: undefined } : null,
    dropFloor: sub.dropFloor,
    targets: { ...targets },
    resources: sub.perResourceReview,
    leftoverPolicy: sub.leftoverPolicy,
    dropsFixed,
    deductionPolicy: DEDUCTION_POLICY.id,
    reconciliation,
    subsidy: {
      budget: allocation.totalBudget,
      afterCc: allocation.totalBefore,
      energyCollected: best.energySimulated,
      creditApplied: allocation.creditTaken,
      creditSimulated: best.creditSimulated,
      effective: allocation.totalAfter,
      creditUnabsorbed: allocation.creditUnabsorbed,
      unabsorbedReason: allocation.unabsorbedReason,
      firstBoardCapped: allocation.firstBoardCapped,
      creditRate: ENERGY_CREDIT_RATE,
    },
    perBoard: draftBoards.map((b, i) => ({
      name: b.name,
      budget: allocation.budget[i],
      afterCc: allocation.before[i],
      floor: allocation.floors[i],
      deducted: allocation.deducted[i],
      atFloor: allocation.atFloor[i],
      protected: i === 0,
      allocation: allocation.after[i],
      mainSum: mainChainSum(b),
      tiles: subsidyTileCount(b),
      items: (b.semiPlacements?.length ?? 0) + (b.blockedQueue?.length ?? 0),
      rewardItems: rewardItemsOnBoard(b),
      checks: boardChecks[i],
    })),
    passes,
    passUsed: best.pass,
    converged,
    // The credit this configuration's own simulation implies, minus the
    // credit it was built with. Within half a DR when converged.
    creditGap: best.gap,
    causes,
    findings: sub.findings,
    evaluation: sub.evaluation,
    eligibleMerges: sub.eligibleMerges,
  }
}

// --- The whole event (one phase, every configured segment) --------------------
// `segments`: [{ index, name, boards, mainBoards, targets, split }] with the
// base segment (index 0) first. A segment with no subsidy budget is skipped
// and listed as such. The base segment's drops are generated; every other
// segment is solved against those same drops (shared odds), moving only its
// own tile items.
export async function buildEvent({ phase, segments, onProgress, isCancelled }) {
  const key = buildInputsKey({ phase, segments })
  // One coin-item plan for every segment (from the base target); each
  // segment's own coin VALUES then land it on its own target.
  const coinPlanTarget = coinPlanTargetFor(segments[0]?.targets?.coins)
  const active = segments.filter((s) => sum(s.boards.map((b) => b.blockedValue ?? 0)) > 0)

  // One pass over every segment. `tilePct` overrides the under-tiles share
  // per resource (see the rebalance below).
  async function buildAll(tilePct, dropCapPct, passLabel) {
    const out = []
    let shared = null
    let done = 0
    for (const seg of segments) {
      const budget = sum(seg.boards.map((b) => b.blockedValue ?? 0))
      if (!(budget > 0)) {
        out.push({ index: seg.index, name: seg.name, status: 'skipped', skipReason: 'No amount entered for this segment (no total demand, so no subsidy to build).' })
        continue
      }
      if (seg.index !== 0 && !shared) {
        out.push({ index: seg.index, name: seg.name, status: 'skipped', skipReason: 'The base segment was not built, so there are no shared merge drops to build against.' })
        continue
      }
      const readiness = buildReadiness({ phase, boards: seg.boards, mainBoards: seg.mainBoards, targets: seg.targets })
      if (!readiness.ready) {
        out.push({ index: seg.index, name: seg.name, status: 'skipped', skipReason: readiness.items.find((i) => !i.ok && i.blocking)?.label ?? 'Missing inputs.' })
        continue
      }
      const result = await buildSegment({
        phase,
        boards: seg.boards,
        mainBoards: seg.mainBoards,
        targets: seg.targets,
        split: { ...seg.split, perResource: { ...(seg.split?.perResource ?? {}), ...tilePct } },
        dropsFixed: seg.index !== 0,
        sharedDrops: seg.index !== 0 ? shared : null,
        coinPlanTarget,
        dropCapPct: seg.index === 0 ? dropCapPct : null,
        twisterNeed: seg.index === 0 ? twisterNeed : null,
        context: { index: seg.index, name: seg.name, factor: seg.factor ?? 1, baseTargets: segments[0]?.targets ?? {} },
        onProgress: (p) => onProgress?.({ ...p, label: passLabel ? `${passLabel}: ${p.label}` : p.label, segment: seg.name, segmentsDone: done, segmentsTotal: active.length }),
        isCancelled,
      })
      if (!result) return null
      done += 1
      if (seg.index === 0) shared = { dropGroups: result.dropGroups, dropGroupsConfig: result.dropGroupsConfig, dropStartRank: result.dropStartRank, multiDropRank: result.multiDropRank ?? null, multiDropShort: !!result.multiDropShort, tripleDropRank: result.tripleDropRank ?? null, tripleDropShort: !!result.tripleDropShort, twisterMinShare: result.twisterMinShare ?? null }
      out.push({ index: seg.index, name: seg.name, ...result })
    }
    return { out, shared }
  }

  // What the twists asked need of the Twister drops (see TWISTER_PRICE_STEPS_AIM):
  // the most any segment's player should have collected by the checkpoint.
  const asking = segments.filter((s2) => s2.twists > 0)
  // Twister rank values nobody typed: the build sizes the VALUES and the
  // Twister item stays a rank-1 drop in its usual share of the drops. Typed
  // values are kept, and then the drops have to carry it (more drops, and an
  // item of rank 3 at most).
  const twisterValuesByBuild = twisterLadderIsAuto(segments[0]?.boards?.[0]?.rewardChainConfig)
  const twisterNeed =
    segments[0]?.twisterByBuild && asking.length > 0 && !twisterValuesByBuild
      ? { dr: Math.max(...asking.map((s2) => TWISTER_PRICE_STEPS_AIM * s2.twists * Math.max(1, Math.round(s2.twisterCostStep ?? 1)))), checkpointPct: asking[0].twisterCheckpointPct ?? TWISTER_EASY_CHECKPOINT_PCT }
      : null
  let pass = await buildAll({}, null, null)
  if (!pass) return null

  // REBALANCING THE SHARED MERGE DROPS. Drop odds are one set for every
  // segment, sized on the base segment - but a segment with less subsidy
  // merges more, so the same odds pay it more. When the drops ALONE pay a
  // segment more than its whole target (nothing under its tiles can bring
  // that down), the base segment's merge drops for that resource are capped
  // just low enough and the event is built once more. The cap is on what the
  // drops actually carry, not on the split asked for: reward items that do
  // not fit under the base segment's tiles would otherwise spill into the
  // drops and put back what was taken out. The economist's typed split is
  // not changed; what the build used instead is reported in `adjustments`.
  // Rewards are paid in a few whole prizes per player, so resizing the drops
  // is a blunt tool: a pass can overshoot and leave the base segment short.
  // Every pass is therefore scored - blocked segments first, then how many
  // rewards sit outside their margin, then by how much in total - and the
  // BEST pass is the one returned, with the adjustments that produced it.
  const scoreOf = (segs) => {
    let blocked = 0
    let outside = 0
    let excess = 0
    for (const seg of segs) {
      if (seg.status === 'skipped') continue
      if (seg.status === 'infeasible') blocked += 1
      for (const r of seg.resources) {
        if (!(r.target > 0)) continue
        const miss = Math.abs(r.predicted - r.target) / r.target
        if (miss > OFF_TARGET_TOLERANCE) {
          outside += 1
          excess += miss - OFF_TARGET_TOLERANCE
        }
      }
    }
    return [blocked, outside, excess]
  }
  const better = (a, b) => a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2] - 1e-9
  let best = { pass, adjustments: [], score: scoreOf(pass.out) }
  let adjustments = []
  const base = segments[0]
  const asked = splitTargets(base.targets, base.split).tilePctByType
  const used = { ...asked }
  const caps = {}
  for (let round = 1; round <= MAX_REBALANCES; round++) {
    const baseBuilt = pass.out.find((s) => s.index === 0 && s.status !== 'skipped')
    if (!baseBuilt) break
    const tilePct = {}
    let moved = false
    for (const type of REWARD_TYPES) {
      if (type === COIN_TYPE && baseBuilt.coinValues) continue // coins are landed by their values
      let worst = null
      for (const s of pass.out) {
        if (s.index === 0 || s.status === 'skipped') continue
        const r = s.resources.find((x) => x.type === type)
        if (!r || !(r.target > 0)) continue
        const ratio = r.drop / r.target
        if (ratio > 1 && r.predicted > r.target * (1 + OFF_TARGET_TOLERANCE) && (!worst || ratio > worst.ratio)) worst = { ratio, name: s.name }
      }
      if (!worst) continue
      // What the base segment's drops really carry now, as a share of its
      // target; scaled so the worst segment's drops alone land just inside
      // its own target.
      const baseRow = baseBuilt.resources.find((x) => x.type === type)
      const dropPct = Math.min(caps[type] ?? 100, baseRow?.target > 0 ? Math.round((100 * baseRow.drop) / baseRow.target) : 100 - used[type])
      // Half the step the arithmetic suggests: payout is not proportional to
      // the drops (it comes in whole prizes), so a full step overshoots.
      const nextDropPct = Math.max(0, Math.floor(dropPct * (1 - 0.5 * (1 - 0.97 / worst.ratio))))
      if (nextDropPct >= dropPct) continue
      caps[type] = nextDropPct
      used[type] = 100 - nextDropPct
      moved = true
      adjustments = [...adjustments.filter((a) => a.type !== type), { type, askedTilePct: asked[type], usedTilePct: used[type], segment: worst.name }]
    }
    if (!moved) break
    for (const a of adjustments) tilePct[a.type] = a.usedTilePct
    const again = await buildAll(tilePct, { ...caps }, 'Rebalancing merge drops')
    if (!again) return null
    pass = again
    const score = scoreOf(again.out)
    if (better(score, best.score)) best = { pass: again, adjustments: [...adjustments], score }
  }
  pass = best.pass
  adjustments = best.adjustments

  let { out, shared } = pass
  const built = out.filter((s) => s.status !== 'skipped')
  // The price of a twist for every segment that asks for twists, measured on
  // exactly these boards and merge drops. When the build sizes the Twister,
  // its items are first raised until every segment's income supports the
  // twists asked (see TWISTER_PRICE_STEPS_AIM); only the Twister items'
  // ranks change, so nothing else is built again.
  onProgress?.({ label: 'Working out the price of a twist' })
  const byBuild = !!segments[0]?.twisterByBuild && !!shared
  let twister = await priceTwisterForBuild({ phase, segments, built: out, shared, runs: byBuild ? TWISTER_SIZING_RUNS : undefined, isCancelled })
  if (byBuild && twister) {
    const pristine = shared
    const size = { minShare: 0, itemUnits: 1 }
    let tier = resizeTwisterDrops(pristine, size)
    let rounds = 0
    let valueFactor = 1
    if (twisterValuesByBuild) {
      // Income is the values times what is collected, so one whole-number
      // factor on all four values lands the worst-off segment on the aim.
      // The values are always built up from this app's starting numbers,
      // so a rebuild does not compound them.
      const base = withDefaultTwisterValues({})[TWISTER_TYPE].map((r) => r.prizeAmount)
      const current = (segments[0].boards[0].rewardChainConfig[TWISTER_TYPE] ?? []).map((r) => r?.prizeAmount ?? 0)
      const already = base[3] > 0 && current[3] > 0 ? current[3] / base[3] : 1
      // Bigger values cost nothing in play; they are sized so that a player
      // collects about twists x the price of one, and written as round
      // numbers (roundTwisterValues).
      const need = twisterIncomeNeed(twister.rows, segments) * (TWISTER_VALUE_STEPS_AIM / TWISTER_PRICE_STEPS_AIM)
      valueFactor = Number.isFinite(need) ? Math.max(1, already * need) : Math.max(1, already)
      const values = roundTwisterValues(valueFactor)
      valueFactor = Math.round((values[3] / base[3]) * 10) / 10
      const ladder = values.map((v, i) => ({ ...(segments[0].boards[0].rewardChainConfig[TWISTER_TYPE]?.[i] ?? {}), prizeAmount: v, auto: true }))
      shared = { ...shared, twisterLadder: ladder }
      out = out.map((s2) => (s2.status === 'skipped' || !s2.boards ? s2 : { ...s2, boards: s2.boards.map((b) => ({ ...b, rewardChainConfig: { ...b.rewardChainConfig, [TWISTER_TYPE]: ladder } })) }))
    }
    while (!twisterValuesByBuild && rounds < MAX_TWISTER_SIZINGS) {
      const need = twisterIncomeNeed(twister.rows, segments)
      if (!(need > 1.05) || size.itemUnits >= TWISTER_MAX_ITEM_UNITS - 1e-9) break
      // One step a round, at most a doubling, then measured again: the first
      // measurement is of rank-1 items, of which a player collects almost
      // nothing, and acting on it in one go overshoots badly.
      size.itemUnits = Math.min(TWISTER_MAX_ITEM_UNITS, size.itemUnits * Math.min(2, need))
      rounds += 1
      tier = resizeTwisterDrops(pristine, size)
      shared = { ...pristine, dropGroups: tier.dropGroups, dropGroupsConfig: tier.dropGroupsConfig }
      const drops = tier
      out = out.map((s2) => (s2.status === 'skipped' || !s2.dropGroups ? s2 : { ...s2, dropGroups: drops.dropGroups, dropGroupsConfig: drops.dropGroupsConfig, ...(s2.index === 0 ? { generatedGroups: drops.dropGroups.filter((g) => g.auto) } : {}) }))
      onProgress?.({ label: 'Raising the Twister drops to fit the twists' })
      const again = await priceTwisterForBuild({ phase, segments, built: out, shared, runs: TWISTER_SIZING_RUNS, isCancelled })
      if (!again) return null
      twister = again
    }
    // The prices themselves, on the full number of simulated players.
    const final = await priceTwisterForBuild({ phase, segments, built: out, shared, isCancelled })
    if (!final) return null
    twister = final
    twister.sizing = { valuesByBuild: twisterValuesByBuild, valueFactor, values: shared.twisterLadder ? shared.twisterLadder.map((r) => r.prizeAmount) : null, byBuild: true, minShare: pristine.twisterMinShare ?? TWISTER_FILL_MIN_SHARE, itemUnits: tier.itemUnits, rank: tier.rank, higher: tier.higher, rounds, short: twister.rows.some((r) => r.tooLow), needsRebuild: false }
  }
  return {
    twister,
    twisterKey: twisterInputsKey(segments),
    phase,
    key,
    parts: buildInputParts({ phase, segments }),
    builtAt: Date.now(),
    shared,
    adjustments,
    segments: out,
    builtCount: built.length,
    skippedCount: out.length - built.length,
    status: built.length === 0 ? 'nothing-built' : built.some((s) => s.status === 'infeasible') ? 'infeasible' : built.every((s) => s.status === 'ok') ? 'ok' : 'review',
  }
}

// --- Seeded validation of a draft segment -------------------------------------
// The same simulation everything else uses, at a higher run count and a
// different seed than the solver scored on - an independent check of the
// draft, not a re-read of the solver's own numbers.
export function validateDraftSegment({ phase, draftSegment, shared, mainBoards = null, runs = DEFAULT_VALIDATION_RUNS, seed = DEFAULT_VALIDATION_SEED }) {
  const boards = draftSegment.boards
  const board0 = boards[0]
  const groups = shared?.dropGroups ?? draftSegment.dropGroups ?? []
  const tables = shared?.dropGroupsConfig ?? draftSegment.dropGroupsConfig ?? []
  const byId = new Map(groups.map((g) => [g.id, g]))
  let summary
  let payouts
  if (phase === 'rc') {
    const main0 = mainBoards[0]
    summary = validateConfigAcrossRuns(mainBoards, {
      rewardChainConfig: main0.rewardChainConfig,
      dropGroupsConfig: main0.dropGroupsConfig,
      dropGroupsById: new Map((main0.dropGroups ?? []).map((g) => [g.id, g])),
      minDropRank: main0.minDropRank,
      leftoverPolicy: main0.rewardLeftoverPolicy,
      rcBoards: boards,
      rcRewardChainConfig: board0.rewardChainConfig,
      rcDropGroupsConfig: tables,
      rcDropGroupsById: byId,
      rcMinDropRank: board0.minDropRank,
      rcLeftoverPolicy: board0.rewardLeftoverPolicy,
      runs,
      seed,
    })
    payouts = summary.payoutsRcPhase
  } else {
    summary = validateConfigAcrossRuns(boards, {
      rewardChainConfig: board0.rewardChainConfig,
      dropGroupsConfig: tables,
      dropGroupsById: byId,
      minDropRank: board0.minDropRank,
      leftoverPolicy: board0.rewardLeftoverPolicy,
      runs,
      seed,
    })
    payouts = summary.payoutsMainPhase
  }
  const resources = REWARD_TYPES.map((type) => {
    const target = draftSegment.targets?.[type] ?? 0
    const stat = payouts?.[type] ?? {}
    const estimate = draftSegment.resources.find((r) => r.type === type)?.predicted ?? 0
    return { type, target, mean: stat.mean ?? 0, p10: stat.p10 ?? 0, p50: stat.p50 ?? 0, p90: stat.p90 ?? 0, estimate, withinTolerance: target > 0 ? Math.abs((stat.mean ?? 0) - target) <= target * OFF_TARGET_TOLERANCE : true }
  })
  return {
    runs,
    seed,
    resources,
    drSpent: summary.drSpent,
    completionRate: phase === 'rc' ? summary.rcPhaseCompletionRate : summary.mainPhaseCompletionRate,
    entryRate: phase === 'rc' ? summary.rcEntryRate : 1,
    energyMean: payouts?.energy?.mean ?? 0,
    creditFromValidation: ENERGY_CREDIT_RATE * (payouts?.energy?.mean ?? 0),
    allWithinTolerance: resources.every((r) => r.withinTolerance),
  }
}

// Ladder problems for the resources that actually have a target - shown in
// the workflow where the targets are entered.
export function ladderAdvisories(rewardChainConfig, targets) {
  return REWARD_TYPES.filter((t) => (targets?.[t] ?? 0) > 0)
    .map((type) => ({ type, issues: validateRewardLadder(rewardChainConfig?.[type]) }))
    .filter((r) => r.issues.length > 0)
}

export { splitTargets, generationTargetOf }
