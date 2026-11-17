// The Small Rewards configuration workflow's one orchestration entry point:
// Targets -> Source split -> Generate -> (Review payload). Needs nothing
// from the economist beyond valid reward definitions - it generates the
// reward-item placements AND the drop groups + per-rank weights itself.
//
// How a target becomes a configuration:
//  1. Each resource's target is turned into a whole number of reward SOURCE
//     UNITS (rewardEconomy.js's closestUnitsForTarget) - the count whose
//     payout, under the list's leftover policy, lands closest to the target.
//     Tile and drop items merge with each other, so this is ONE budget per
//     resource, not one per source; when the configured prize ladder can't
//     pay the target exactly, the closest feasible payout is reported.
//  2. The source split divides that unit budget: the tile share is placed as
//     real items (rewardPlacement.js), the rest is asked of merge drops.
//  3. Drop groups and weights are generated for the drop share
//     (rewardTargeting.js), in two candidate structures.
//  4. Every candidate is scored on the SAME seeded multi-run simulation the
//     "Validate with simulation" action uses (rewardEconomy.js's
//     validateConfigAcrossRuns, fixed seed) and refined against it, so the
//     numbers in the review are simulated outcomes, not arithmetic that
//     simulation might later contradict.
//
// Async with a yield after every simulation batch: the progress label
// repaints and a cancel request lands within one batch. Nothing is written
// anywhere - the caller applies the returned boards/config explicitly.
import { REWARD_TYPES, REWARD_MAX_RANK, COIN_TYPE, TWISTER_TYPE, rewardPrizeAmount, rewardLadderIsConfigured, coinValuesForScale, withGeneratedCoinValues, coinLadderIsAuto } from './rewardChain'
import { proposeRewardPlacements } from './rewardPlacement'
import { buildDropConfiguration, buildAlwaysDropConfiguration, expectedDropUnits } from './rewardTargeting'
import { estimateExpectedCollectibleRewards, validateConfigAcrossRuns, closestUnitsForTarget, ENERGY_CREDIT_RATE } from './rewardEconomy'
import { MIN_DROP_RANK, multiDropRankOf, tripleDropRankOf, TWISTER_FILL_MIN_SHARE } from './dropGroups'
import { RC_MAX_RANK } from './ranks'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

// How far a simulated payout may sit from its target (as a fraction of the
// target) before the solve is called "off target".
// 15%, by explicit economist decision ("lets give anyways the model a 15%
// margin for the diff of the amount in all the small rewards"): a payout
// inside the margin IS the target met. Nothing about a reward amount is
// reported as a problem while its result is inside it.
export const OFF_TARGET_TOLERANCE = 0.15
// The solver's own scoring batch: a fixed seed makes "mean over these runs"
// a deterministic function of the candidate config, so two candidates are
// compared on identical luck.
export const SOLVER_EVAL_RUNS = 20
export const SOLVER_EVAL_SEED = 7
const MAX_REFINEMENTS = 5
// A reward item under a tile is semi-blocked until a matching dropped item
// frees it, and its board waits for that. When the generated reward items
// make the player reach this much less of the subsidy than without them (the
// next board came too late), some are taken back - at most this many times.
const HOLD_TOLERANCE = 0.05
const MAX_TAKE_BACKS = 6
const MAX_REWARD_TILES_BEFORE_LAST = 4
const ROUNDS_AFTER_TAKE_BACK = 4
// Merge energy is steered closer than the other rewards: the DR taken off
// the boards for it is worked out from it, and a build only settles when two
// passes agree on it.
const ENERGY_CONVERGED_TOLERANCE = 0.01
const ENERGY_EXTRA_ROUNDS = 4
// Room left when working out in how many drops the Twister item must sit.
const TWISTER_SHARE_ROOM = 2
const CONVERGED_TOLERANCE = 0.03
const UNITS_PER_COLLECT = 2 ** (REWARD_MAX_RANK - 1)

const zeroByType = () => Object.fromEntries(REWARD_TYPES.map((t) => [t, 0]))

// Value-space view of the split, for display ("Under tiles: 150"). The
// solve itself splits source units, not prize values.
export function splitTargets(targets, split) {
  const sharedTilePct = clampPct(split?.sharedTilePct ?? 50)
  const tileTargets = {}
  const dropTargets = {}
  const tilePctByType = {}
  for (const type of REWARD_TYPES) {
    const overridden = split?.perResource?.[type]
    const tilePct = clampPct(overridden ?? sharedTilePct)
    tilePctByType[type] = tilePct
    const target = targets?.[type] ?? 0
    tileTargets[type] = (target * tilePct) / 100
    dropTargets[type] = (target * (100 - tilePct)) / 100
  }
  return { tileTargets, dropTargets, tilePctByType }
}

function clampPct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 50
  return Math.min(100, Math.max(0, n))
}

// One seeded scoring batch for this phase. Main phase: the main list on its
// own. RC phase: the FULL main+RC run with the candidate RC config passed as
// rc* overrides, reading the RC phase's own tallies - the RC list is never
// scored as if it were a standalone event (it only exists after the main
// chain, and a standalone run would stop at rank 12).
function evaluatePhase({ phase, boards, mainBoards, config, runs, seed }) {
  const groupsById = new Map(config.dropGroups.map((g) => [g.id, g]))
  if (phase === 'main') {
    const summary = validateConfigAcrossRuns(boards, {
      rewardChainConfig: config.rewardChainConfig,
      dropGroupsConfig: config.dropGroupsConfig,
      dropGroupsById: groupsById,
      minDropRank: config.minDropRank,
      leftoverPolicy: config.leftoverPolicy,
      runs,
      seed,
    })
    return { summary, payouts: summary.payoutsMainPhase, bySource: summary.payoutsMainPhaseBySource, entryRate: 1 }
  }
  const main0 = mainBoards[0]
  const summary = validateConfigAcrossRuns(mainBoards, {
    rewardChainConfig: main0.rewardChainConfig,
    dropGroupsConfig: main0.dropGroupsConfig,
    dropGroupsById: new Map((main0.dropGroups ?? []).map((g) => [g.id, g])),
    minDropRank: main0.minDropRank,
    leftoverPolicy: main0.rewardLeftoverPolicy,
    rcBoards: boards,
    rcRewardChainConfig: config.rewardChainConfig,
    rcDropGroupsConfig: config.dropGroupsConfig,
    rcDropGroupsById: groupsById,
    rcMinDropRank: config.minDropRank,
    rcLeftoverPolicy: config.leftoverPolicy,
    runs,
    seed,
  })
  return { summary, payouts: summary.payoutsRcPhase, bySource: summary.payoutsRcPhaseBySource, entryRate: summary.rcEntryRate }
}

function distanceToTargets(payouts, targets) {
  let sum = 0
  for (const type of REWARD_TYPES) {
    const target = targets?.[type] ?? 0
    if (target <= 0) continue
    const diff = ((payouts?.[type]?.mean ?? 0) - target) / target
    sum += diff * diff
  }
  return sum
}

export async function generateSmallRewardsConfiguration({
  phase, // 'main' | 'rc'
  boards, // the phase's own board list (main list, or the selected RC variant's)
  mainBoards = null, // RC phase only: the main list the real run plays through first
  targets,
  split,
  // Drop odds are ONE shared configuration across segments (set on the base
  // segment). A non-base segment therefore solves with the drops FIXED -
  // only its own tile placements move to reach its own derived target.
  // `sharedDrops` supplies the base segment's (possibly just-proposed, not
  // yet applied) groups/tables to solve against.
  dropsFixed = false,
  sharedDrops = null,
  // Coin rank values set by the build (rewardChain.js: COIN_VALUE_SHAPE).
  // `{ planTarget }`: the boards arrive carrying the provisional coin values;
  // the solve places coin items for `planTarget` (the same for every segment,
  // so every segment gets about the same coin items), then sizes the coin
  // values so THIS segment's simulated coin payout equals its own target.
  autoCoins = null,
  // The most of a resource's units merge drops may carry, as a % of its unit
  // budget ({ type: pct }). Set by the build when shared drops overpay
  // another segment: reward units that do not fit under this segment's tiles
  // then stay unplaced instead of spilling into the drops.
  dropCapPct = null,
  // Every eligible merge drops a bucket (rewardTargeting.js:
  // buildAlwaysDropConfiguration) instead of drops being a chance.
  alwaysDrop = false,
  // What the twists asked need (Build event): { dr, checkpointPct } - the
  // Twister DR the worst-off segment's player should have collected by the
  // checkpoint. It decides in how many drops the Twister item sits.
  twisterNeed = null,
  // Per-board caps on generated reward items from an earlier pass of the
  // same build (see the take-back below), so a later pass starts from them.
  tileCapsStart = null,
  noise = 0.15,
  evalRuns = SOLVER_EVAL_RUNS,
  evalSeed = SOLVER_EVAL_SEED,
  onProgress = null,
  isCancelled = null,
} = {}) {
  const board0 = boards[0]
  const rewardChainConfig = board0.rewardChainConfig
  const minDropRank = board0.minDropRank ?? MIN_DROP_RANK
  const leftoverPolicy = board0.rewardLeftoverPolicy ?? 'forfeit'
  // The Twister item is put into the containers by the build when the list
  // says so and the Twister has rank values (rewardTargeting.js).
  const twisterOn = alwaysDrop && !!board0.twisterByBuild && rewardLadderIsConfigured(rewardChainConfig, TWISTER_TYPE)
  let twisterFill = twisterOn ? { minShare: TWISTER_FILL_MIN_SHARE, itemUnits: 1 } : null
  const existingGroups = sharedDrops?.dropGroups ?? board0.dropGroups ?? []
  const existingTables = sharedDrops?.dropGroupsConfig ?? board0.dropGroupsConfig ?? []
  const { tilePctByType } = splitTargets(targets, split)
  const fitCoins = !!autoCoins && (targets?.coins ?? 0) > 0
  // What the solve steers toward. With coin values set by the build, coin
  // ITEMS are placed for the planning target and the values do the rest.
  const solveTargets = fitCoins ? { ...targets, [COIN_TYPE]: autoCoins.planTarget } : targets
  const findings = []
  const cancelled = async (label) => {
    onProgress?.(label)
    await tick()
    return isCancelled?.() === true
  }

  // 1. Unit budget per resource.
  const plan = {}
  for (const type of REWARD_TYPES) {
    const target = solveTargets?.[type] ?? 0
    const closest = closestUnitsForTarget(target, rewardChainConfig, type, leftoverPolicy)
    // The solve aims at the TARGET, not at the nearest whole prize. One
    // player is always paid in whole prizes, but merge drops are random, so
    // the AVERAGE player can land between two prizes (some collect one
    // rank-4 item, some two) - and the average is what a target means here.
    // So the starting unit count is simply target / value-per-unit, and the
    // refinement below steers the simulated average onto the target.
    // `feasiblePayout` / `exact` stay as information: what a single player
    // can be paid.
    const perUnit = rewardPrizeAmount(rewardChainConfig, type, REWARD_MAX_RANK) / UNITS_PER_COLLECT
    // (A target the ranks can pay exactly keeps its exact unit count, and so
    // does any target when leftover items are collected: there the unit
    // count already lands on the amount.)
    const average = target > 0 && perUnit > 0 && !closest.exact && leftoverPolicy !== 'collect'
    const units = average ? Math.max(1, Math.round(target / perUnit)) : closest.units
    plan[type] = { target, units, feasiblePayout: closest.payout, exact: closest.exact, noPrize: !!closest.noPrize }
    if (fitCoins && type === COIN_TYPE) continue
    if (target > 0 && closest.noPrize) {
      findings.push(
        type === COIN_TYPE && coinLadderIsAuto(rewardChainConfig)
          ? 'coins: the coin rank values are not set yet - Build event sets them for you, or type them in the reward definitions.'
          : `${type}: no rank-${REWARD_MAX_RANK} prize is defined, so nothing can pay this target out - set one in the reward definitions.`,
      )
    } else if (target > 0 && !closest.exact) {
      const step = rewardPrizeAmount(rewardChainConfig, type, REWARD_MAX_RANK)
      findings.push(
        closest.units === 0
          ? `${type}: the target (${target}) is too small for this prize ladder - the smallest payable amount${leftoverPolicy === 'forfeit' ? ` is one rank-${REWARD_MAX_RANK} prize (${step})` : ' is larger'}, so the closest feasible result is 0.`
          : `${type}: the prize ladder can't pay exactly ${target} - the closest feasible payout is ${closest.payout}${leftoverPolicy === 'forfeit' ? ` (whole rank-${REWARD_MAX_RANK} prizes of ${step}; leftovers below rank ${REWARD_MAX_RANK} are forfeited under the current leftover policy)` : ''}.`,
      )
    }
  }

  // 2. How many eligible merges this phase really produces (one
  // deterministic run of the current boards + config) - what the drop odds
  // get sized against.
  if (await cancelled('Measuring merges per rank…')) return null
  const keptOnly = { rewardChainConfig, dropGroups: existingGroups, dropGroupsConfig: existingTables, minDropRank, leftoverPolicy }
  let mergesByRank = {}
  {
    const groupsById = new Map(existingGroups.map((g) => [g.id, g]))
    if (phase === 'main') {
      const { result } = estimateExpectedCollectibleRewards(boards, { rewardChainConfig, dropGroupsConfig: existingTables, dropGroupsById: groupsById, minDropRank, leftoverPolicy })
      mergesByRank = result.mergeCountsMainPhase ?? {}
    } else {
      const main0 = mainBoards[0]
      const { result } = estimateExpectedCollectibleRewards(mainBoards, {
        rewardChainConfig: main0.rewardChainConfig,
        dropGroupsConfig: main0.dropGroupsConfig,
        dropGroupsById: new Map((main0.dropGroups ?? []).map((g) => [g.id, g])),
        minDropRank: main0.minDropRank,
        leftoverPolicy: main0.rewardLeftoverPolicy,
        rcBoards: boards,
        rcRewardChainConfig: rewardChainConfig,
        rcDropGroupsConfig: existingTables,
        rcDropGroupsById: groupsById,
        rcMinDropRank: minDropRank,
        rcLeftoverPolicy: leftoverPolicy,
      })
      mergesByRank = result.mergeCountsRcPhase ?? {}
    }
  }

  // The Twister item's share of the drops. Its rank is raised after the
  // build (eventBuild.js) up to rank 4, which carries 8 units; so it has to
  // be in enough drops that rank-4 items by the checkpoint can carry what the
  // twists need - with some room, since not every item is collected by then.
  if (twisterFill && twisterNeed?.dr > 0) {
    const perUnit = rewardPrizeAmount(rewardChainConfig, TWISTER_TYPE, REWARD_MAX_RANK) / UNITS_PER_COLLECT
    let dropsByCheckpoint = 0
    for (let rank = minDropRank; rank <= RC_MAX_RANK; rank++) dropsByCheckpoint += mergesByRank?.[rank] ?? 0
    dropsByCheckpoint *= Math.min(100, Math.max(1, twisterNeed.checkpointPct ?? 100)) / 100
    if (perUnit > 0 && dropsByCheckpoint > 0) {
      // Sized as if every Twister item were rank 2: the item is a small
      // reward the player merges up, so it should rather be in more drops
      // than be a big item (see TWISTER_MAX_ITEM_UNITS in eventBuild.js).
      const share = (TWISTER_SHARE_ROOM * twisterNeed.dr) / perUnit / (2 * dropsByCheckpoint)
      twisterFill = { ...twisterFill, minShare: Math.min(1, Math.max(TWISTER_FILL_MIN_SHARE, Math.round(share * 100) / 100)) }
    }
  }

  // Units the drops that are NOT being generated already deliver: every
  // kept (hand-authored / locked) group, or ALL groups when drops are fixed.
  const fixedDropUnits = expectedDropUnits(existingTables, existingGroups, mergesByRank, minDropRank, (g) => dropsFixed || !g.auto)

  // 3. Tile share of the unit budget, placed as real items.
  const tileUnitsFor = (unitBudget) => {
    const out = zeroByType()
    for (const type of REWARD_TYPES) {
      out[type] = dropsFixed
        ? Math.max(0, Math.round(unitBudget[type] - fixedDropUnits[type]))
        : Math.round((unitBudget[type] * tilePctByType[type]) / 100)
    }
    return out
  }
  const unitBudget = Object.fromEntries(REWARD_TYPES.map((t) => [t, plan[t].units]))
  if (await cancelled('Placing reward items under tiles…')) return null
  let tileUnits = tileUnitsFor(unitBudget)
  // Only a reward that drops can have items under tiles (see rewardPlacement.js).
  const droppingTypes = REWARD_TYPES.filter((t) => fixedDropUnits[t] > 0 || (!dropsFixed && tilePctByType[t] < 100))
  // In a build, a board before the last holds at most this many reward items
  // (economist: "guarentee to get the lets say 4 blocked ones fro mthe rank 6
  // we merge. im ok with being a bit stuck in the last board but not on the
  // first ones"): two rewards, a chain of two each, opened by the rank-1 items
  // the first dropping ranks always drop. The last board is not limited.
  const tileCaps = boards.map((_, i) => tileCapsStart?.[i] ?? (alwaysDrop && boards.length > 1 && i < boards.length - 1 ? MAX_REWARD_TILES_BEFORE_LAST : Infinity))
  // TWO rewards go under tiles - the two with the most to give - and the
  // first two dropping ranks always drop a rank-1 item of one of them, so a
  // reward item that waits semi-blocked on a board gets its match quickly
  // (economist: "we cna maybe pick a specific 2 types of small rewards that
  // are blocked ... where the drops of the rank6 and 7 maybe will guarentee
  // give them so the blocked tiles will not do harm"). Only in a build
  // (alwaysDrop); the advanced Rewards tool places every reward as before.
  const tileTypes = alwaysDrop ? [...droppingTypes].sort((x, y) => unitBudget[y] - unitBudget[x] || (x < y ? -1 : 1)).slice(0, 2) : droppingTypes
  const propose = (units) => proposeRewardPlacements(boards, { tileUnits: units, noise, droppingTypes, earlyTypes: alwaysDrop ? tileTypes : null, maxAutoByBoard: tileCaps })
  let placement = propose(tileUnits)
  const autoTilesOf = (p) => p.additionsByBoard.map((list, i) => list.length + p.semiAdditionsByBoard[i].length)
  const reachedOf = (evaluation) => evaluation.summary?.subsidyReached?.[phase] ?? null
  // What the player reaches of the subsidy with no generated reward item
  // under any tile - what the reward items must not make worse.
  let baselineReached = null
  if (autoTilesOf(placement).some((n) => n > 0)) {
    if (await cancelled('Measuring the boards without reward items…')) return null
    const plain = proposeRewardPlacements(boards, { tileUnits: zeroByType(), noise })
    baselineReached = reachedOf(evaluatePhase({ phase, boards: plain.boards, mainBoards, config: { rewardChainConfig, dropGroups: existingGroups, dropGroupsConfig: existingTables, minDropRank, leftoverPolicy }, runs: evalRuns, seed: evalSeed }))?.share ?? null
  }
  let riseOfRound = null
  let takeBacks = 0
  const keptOff = boards.map(() => 0)
  // What the placement gave each board before anything was taken back.
  const firstAutoTiles = autoTilesOf(placement)
  const placedTileUnits = (p) => Object.fromEntries(REWARD_TYPES.map((t) => [t, p.perResource[t].pinnedUnits + p.perResource[t].unitsPlaced]))

  // 4. Generate + score. With drops fixed there is one candidate (the shared
  // config as it stands) and the refinement moves tile units; otherwise each
  // structure is generated, scored, and refined on its drop units.
  const dropCapUnits = (t) => (dropCapPct?.[t] != null ? Math.max(0, (unitBudget[t] * dropCapPct[t]) / 100 - fixedDropUnits[t]) : Infinity)
  const dropNeedFor = (p) => {
    const placed = placedTileUnits(p)
    return Object.fromEntries(REWARD_TYPES.map((t) => [t, Math.min(dropCapUnits(t), Math.max(0, unitBudget[t] - placed[t] - fixedDropUnits[t]))]))
  }
  const needsDrops = !dropsFixed && REWARD_TYPES.some((t) => dropNeedFor(placement)[t] > 0)
  const structures = dropsFixed ? ['fixed'] : alwaysDrop ? ['always'] : needsDrops && REWARD_TYPES.filter((t) => dropNeedFor(placement)[t] > 0).length > 1 ? ['separate', 'bundle'] : ['separate']

  const valuePerUnit = (type) => rewardPrizeAmount(rewardChainConfig, type, REWARD_MAX_RANK) / UNITS_PER_COLLECT
  let best = null
  let evaluations = 0
  const totalEvaluations = structures.length * (1 + MAX_REFINEMENTS)

  for (const structure of structures) {
    let dropUnits = dropNeedFor(placement)
    let candidatePlacement = placement
    let candidateTileUnits = { ...tileUnits }
    // With a merge-energy target the steering gets a few more rounds, in
    // smaller steps: energy has to land on its target itself (see
    // ENERGY_CONVERGED_TOLERANCE), not merely near it.
    const lastRound = MAX_REFINEMENTS + ((plan.energy?.target ?? 0) > 0 ? ENERGY_EXTRA_ROUNDS : 0)
    for (let round = 0; round <= lastRound; round++) {
      let built = dropsFixed
        ? { dropGroups: existingGroups, dropGroupsConfig: existingTables, generatedGroups: [], shortUnits: zeroByType(), eligibleMerges: null }
        : structure === 'always'
          ? buildAlwaysDropConfiguration({ dropUnits, mergesByRank, dropGroups: existingGroups, dropGroupsConfig: existingTables, minDropRank, multiDropRank: multiDropRankOf(boards[0]), tripleDropRank: tripleDropRankOf(boards[0]), guaranteedTypes: tileTypes, twister: twisterFill })
          : buildDropConfiguration({ dropUnits, mergesByRank, dropGroups: existingGroups, dropGroupsConfig: existingTables, minDropRank, structure })
      // Every eligible merge drops, so the drops have a floor: at least one
      // item per merge. When that floor is more than was asked of the drops,
      // the difference comes out from under the tiles - the reward's total
      // stays on target and the drop rule stays exactly as the economist set it.
      // CONTAINERS FIRST. The containers a merge drops are always made as
      // set (several items rising with the rank, three from the top ranks),
      // and what that makes the drops pay comes out from under the tiles just
      // below - by explicit economist decision: "u can even give the
      // distribution in anyway u think is best. its just important that the
      // drops will be the bigger part". (Two rounds of making the containers
      // rarer to protect the tiles came before this; they made the result
      // flip between builds and were removed.)
      riseOfRound = null
      if (structure === 'always') {
        const lowered = { ...candidateTileUnits }
        let changed = false
        for (const t of REWARD_TYPES) {
          const floor = built.deliverableUnits?.[t] ?? 0
          if (!(floor > dropUnits[t] + 0.5) || !(candidateTileUnits[t] > 0)) continue
          const next = Math.max(0, Math.round(unitBudget[t] - fixedDropUnits[t] - floor))
          if (next < candidateTileUnits[t]) {
            lowered[t] = next
            changed = true
          }
        }
        if (changed) {
          candidateTileUnits = lowered
          candidatePlacement = propose(candidateTileUnits)
        }
      }
      evaluations += 1
      if (await cancelled(`Simulating candidate ${evaluations} of ${totalEvaluations}…`)) return null
      const config = { ...keptOnly, dropGroups: built.dropGroups, dropGroupsConfig: built.dropGroupsConfig }
      const evaluation = evaluatePhase({ phase, boards: candidatePlacement.boards, mainBoards, config, runs: evalRuns, seed: evalSeed })
      const distance = distanceToTargets(evaluation.payouts, solveTargets)
      // Do the reward items under tiles hold a board back?
      const reached = reachedOf(evaluation)
      const autoTiles = autoTilesOf(candidatePlacement)
      const holds = baselineReached != null && reached?.share != null && autoTiles.some((n) => n > 0) && reached.share < baselineReached - HOLD_TOLERANCE
      // Merge energy off its target comes before the other rewards' distance:
      // the DR taken off the boards follows it, and a build whose passes land
      // on different energy never settles.
      const energyTarget = plan.energy?.target ?? 0
      const energyOff = energyTarget > 0 && Math.abs((evaluation.payouts?.energy?.mean ?? 0) - energyTarget) > energyTarget * ENERGY_CONVERGED_TOLERANCE
      const candidate = { structure, built, config, evaluation, distance, placement: candidatePlacement, groupCount: built.dropGroups.length, holds, energyOff, reachedShare: reached?.share ?? null, rise: riseOfRound }
      const rankOf = (c) => (c.holds ? 2 : 0) + (c.energyOff ? 1 : 0)
      const better = !best || rankOf(candidate) < rankOf(best) || (rankOf(candidate) === rankOf(best) && (distance < best.distance - 1e-9 || (Math.abs(distance - best.distance) <= 1e-9 && candidate.groupCount < best.groupCount)))
      if (better) best = candidate
      // Half the generated reward items come off the board most runs stopped
      // on (the earliest board that can give some up, when that is unclear),
      // and the candidate is built again. Their units go to the drops.
      // A board is never emptied, though, and never loses more than half of
      // what the placement first gave it (by explicit economist feedback: "u
      // took all the small rewards in the tiles to the last board. it cant be
      // like that, the logic should be a bit like the last one"): Board 1
      // keeps at least one reward item and every board between it and the
      // last at least two (one chain). The last board holds nobody back, so
      // nothing is ever taken off it.
      const keepAtLeast = (i) => Math.max(i === 0 ? 1 : 2, Math.ceil((firstAutoTiles[i] ?? 0) / 2))
      let target = -1
      if (holds && takeBacks < MAX_TAKE_BACKS) {
        let most = 0
        autoTiles.forEach((n, i) => {
          if (i < boards.length - 1 && n > keepAtLeast(i) && (reached.stoppedOn[i] ?? 0) > most) {
            most = reached.stoppedOn[i]
            target = i
          }
        })
        if (target < 0) target = autoTiles.findIndex((n, i) => i < boards.length - 1 && n > keepAtLeast(i))
      }
      if (target >= 0) {
        tileCaps[target] = Math.max(keepAtLeast(target), Math.floor(autoTiles[target] / 2))
        keptOff[target] += autoTiles[target] - tileCaps[target]
        takeBacks += 1
        candidatePlacement = propose(candidateTileUnits)
        if (!dropsFixed) dropUnits = dropNeedFor(candidatePlacement)
        // A take-back is not a refinement round, and what is left is given
        // room to be steered back onto its targets (the rewards taken off
        // the tiles now have to come from the drops).
        round = Math.min(round, MAX_REFINEMENTS - ROUNDS_AFTER_TAKE_BACK) - 1
        continue
      }

      // Converged, or nothing left to steer with.
      const errors = Object.fromEntries(
        REWARD_TYPES.map((t) => [t, plan[t].target > 0 ? plan[t].target - (evaluation.payouts?.[t]?.mean ?? 0) : 0]),
      )
      const converged = REWARD_TYPES.every((t) => plan[t].target <= 0 || Math.abs(errors[t]) <= plan[t].target * (t === 'energy' ? ENERGY_CONVERGED_TOLERANCE : CONVERGED_TOLERANCE))
      if (converged || round === lastRound) break
      const stepSize = round >= MAX_REFINEMENTS ? 0.6 : 1

      // Steer by the simulated error, converted back into source units (one
      // unit is worth 1/8 of a rank-4 prize once merged up).
      if (dropsFixed) {
        for (const t of REWARD_TYPES) {
          if (plan[t].target <= 0 || !(valuePerUnit(t) > 0)) continue
          candidateTileUnits[t] = Math.max(0, Math.round(candidateTileUnits[t] + (stepSize * errors[t]) / valuePerUnit(t)))
        }
        candidatePlacement = propose(candidateTileUnits)
      } else {
        const next = { ...dropUnits }
        for (const t of REWARD_TYPES) {
          if (plan[t].target <= 0 || !(valuePerUnit(t) > 0)) continue
          // With "every merge drops" a resource that has a target always
          // stays in the buckets: steering it to nothing would turn the
          // drops off, which the rule forbids.
          next[t] = Math.min(dropCapUnits(t), Math.max(structure === 'always' ? 0.5 : 0, dropUnits[t] + (stepSize * errors[t]) / valuePerUnit(t)))
        }
        dropUnits = next
      }
    }
  }
  placement = best.placement
  tileUnits = Object.fromEntries(REWARD_TYPES.map((t) => [t, placement.perResource[t].unitsWanted]))
  findings.push(...placement.findings)
  const riseUsed = best.rise ?? null
  if (riseUsed) {
    findings.push(
      riseUsed === 'none'
        ? 'Containers with several items were left out: every such drop carries a reward item, and the rewards asked of merge drops are too few for that without taking the rewards off the tiles. Ask more of the rewards, or take a larger part of them from merge drops.'
        : `Containers with several items start later than asked (${riseUsed}): every such drop carries a reward item, most merges are at the low ranks, and the rewards asked of merge drops are too few to fill those without taking the rewards off the tiles. Ask more of the rewards, or take a larger part of them from merge drops, to have them from an earlier rank.`,
    )
  }
  keptOff.forEach((n, i) => {
    if (n > 0) findings.push(`Board ${i + 1}: ${n} reward item${n === 1 ? ' was' : 's were'} kept off its tiles. A reward item under a tile stays semi-blocked until a matching item drops from a merge, and the board waits for it; here the match often came too late and the next board with it. Those rewards come from merge drops instead.`)
  })
  if (best.holds) {
    findings.push(
      `Every board keeps some reward items under its tiles, and a board waits for them: the player reaches ${Math.round((best.reachedShare ?? 0) * 100)}% of this phase's subsidy, against ${Math.round((baselineReached ?? 0) * 100)}% with no reward item under tiles. Taking more of those rewards from merge drops makes their match come sooner.`,
    )
  }

  // 4b. Size the coin values. A coin payout is linear in the coin values (the
  // simulated player never decides anything by a prize's size), so scaling
  // all four ranks together moves this segment's coin payout onto its target
  // without changing a single item or drop. Re-simulated with the rounded
  // values on the same seed, so the review shows what those values really pay.
  let coinValues = null
  if (fitCoins) {
    const simulated = best.evaluation.payouts?.[COIN_TYPE]?.mean ?? 0
    if (simulated > 0) {
      const scale = targets[COIN_TYPE] / simulated
      const values = coinValuesForScale(scale)
      if (await cancelled('Sizing coin values…')) return null
      const fittedConfig = { ...best.config, rewardChainConfig: withGeneratedCoinValues(rewardChainConfig, values) }
      const fittedEvaluation = evaluatePhase({ phase, boards: placement.boards, mainBoards, config: fittedConfig, runs: evalRuns, seed: evalSeed })
      best = { ...best, config: fittedConfig, evaluation: fittedEvaluation }
      plan[COIN_TYPE] = { ...plan[COIN_TYPE], target: targets[COIN_TYPE], feasiblePayout: targets[COIN_TYPE], exact: true, fitted: true }
      coinValues = { values, scale, planTarget: autoCoins.planTarget }
    } else {
      plan[COIN_TYPE] = { ...plan[COIN_TYPE], target: targets[COIN_TYPE] }
      findings.push('coins: no coin item was collected in the simulation, so the coin rank values could not be sized to the target. They were left at their starting values.')
    }
  }

  // 5. Review payload, all read off the winning candidate's simulation.
  const { evaluation, built, config } = best
  const perResourceReview = REWARD_TYPES.map((type) => {
    const target = targets?.[type] ?? 0
    const stats = evaluation.payouts?.[type]
    const predicted = stats?.mean ?? 0
    const tile = evaluation.bySource?.tile?.[type]?.mean ?? 0
    const drop = evaluation.bySource?.drop?.[type]?.mean ?? 0
    return {
      type,
      target,
      predicted,
      p10: stats?.p10 ?? 0,
      p90: stats?.p90 ?? 0,
      diff: predicted - target,
      tile,
      drop,
      feasiblePayout: plan[type].feasiblePayout,
      exactlyPayable: plan[type].exact,
      forfeited: evaluation.summary.leftoverForfeited?.[type]?.mean ?? 0,
      requestedTilePct: dropsFixed ? null : tilePctByType[type],
      achievedTilePct: tile + drop > 0 ? (tile / (tile + drop)) * 100 : null,
    }
  })

  // Energy credit: CC applies per board BEFORE the one deduction - Σ
  // blockedValue×(1+cc) − 0.80×expected collectible energy, once per phase,
  // on the SIMULATED mean (not on the requested target). Never clamped.
  const finalBoards = coinValues ? placement.boards.map((b) => ({ ...b, rewardChainConfig: config.rewardChainConfig })) : placement.boards
  const baseSubsidy = finalBoards.reduce((s, b) => s + b.blockedValue, 0)
  const ccAdjusted = finalBoards.reduce((s, b) => s + b.blockedValue * (1 + (b.ccPercent ?? 0)), 0)
  const expectedCollectibleEnergy = evaluation.payouts?.energy?.mean ?? 0
  const energyCredit = ENERGY_CREDIT_RATE * expectedCollectibleEnergy
  const effectiveSubsidy = ccAdjusted - energyCredit

  const rcNeverEntered = phase === 'rc' && !(evaluation.entryRate > 0)
  if (rcNeverEntered) {
    findings.push(
      'No simulated run reached the RC phase - the main chain was not fully cleared (rank 12 plus every blocked/semi tile) before the runs ended, so every RC payout reads zero. Fix the main chain first, then re-generate.',
    )
  } else if (phase === 'rc' && evaluation.entryRate < 1) {
    findings.push(`Only ${Math.round(evaluation.entryRate * 100)}% of simulated runs reached the RC phase - RC averages include the runs that never got there.`)
  }
  const shortDropUnits = REWARD_TYPES.filter((t) => (built.shortUnits?.[t] ?? 0) > 0.5)
  if (!dropsFixed && shortDropUnits.length > 0) {
    findings.push(
      `Not enough eligible merges to deliver the merge-drop share for ${shortDropUnits.join(', ')}: this phase produces about ${Math.round(built.eligibleMerges ?? 0)} merges at rank ${minDropRank}+ on unlocked ranks. Lower the "drops start at" rank, unlock ranks, shift the split toward tiles, or lower the target.`,
    )
  }
  if (dropsFixed) {
    const over = REWARD_TYPES.filter((t) => plan[t].target > 0 && fixedDropUnits[t] > unitBudget[t] + 0.5)
    if (over.length > 0) {
      findings.push(
        `The shared drop configuration alone already delivers more than this segment's target for ${over.join(', ')} - drop odds are shared across segments, so this segment can only come down by changing the base segment's drops or raising this segment's factor.`,
      )
    }
  }
  if (effectiveSubsidy < 0) {
    findings.push(
      `Effective subsidy is negative (${Math.round(effectiveSubsidy)} DR): the 80% credit on ${Math.round(expectedCollectibleEnergy)} expected energy exceeds the CC-adjusted subsidy (${Math.round(ccAdjusted)} DR). Lower the energy target or raise the subsidy - this is reported, not clamped.`,
    )
  }
  if (phase === 'main' && evaluation.summary.mainPhaseCompletionRate < 1) {
    findings.push(`Only ${Math.round(evaluation.summary.mainPhaseCompletionRate * 100)}% of simulated runs reached rank 12 - the averages include runs that stopped early.`)
  }

  // One plain-language verdict per solve.
  // A reward that could not be placed or dropped in full is only a problem
  // when its payout actually ends outside the margin.
  const offTarget = perResourceReview.filter((r) => r.target > 0 && Math.abs(r.diff) > r.target * OFF_TARGET_TOLERANCE).map((r) => r.type)
  const shortAndOff = shortDropUnits.filter((t) => offTarget.includes(t))
  const infeasibleReasons = []
  for (const type of REWARD_TYPES) {
    if (plan[type].target > 0 && plan[type].noPrize) infeasibleReasons.push(`${type}: no rank-${REWARD_MAX_RANK} prize defined`)
    if (dropsFixed && placement.perResource[type].unitsUnplaced > 0 && offTarget.includes(type)) infeasibleReasons.push(`${type}: tile placements don't fit`)
  }
  if (!dropsFixed && shortAndOff.length > 0 && REWARD_TYPES.some((t) => placement.perResource[t].unitsUnplaced > 0 && offTarget.includes(t))) infeasibleReasons.push('neither tiles nor merge drops have room for the target')
  else if (!dropsFixed && shortAndOff.length > 0) infeasibleReasons.push('not enough eligible merges for the drop share')
  if (effectiveSubsidy < 0) infeasibleReasons.push('effective subsidy is negative')
  if (rcNeverEntered) infeasibleReasons.push('RC phase never reached')
  // "Off target" purely because the ladder can't pay the number asked for is
  // its own, milder verdict - the configuration is as close as it can get.
  const ladderLimited = offTarget.filter((t) => !plan[t].exact && Math.abs(perResourceReview.find((r) => r.type === t).predicted - plan[t].feasiblePayout) <= plan[t].target * OFF_TARGET_TOLERANCE)
  const feasibility = {
    status: infeasibleReasons.length > 0 ? 'infeasible' : offTarget.length > ladderLimited.length ? 'off-target' : ladderLimited.length > 0 ? 'ladder-limited' : 'ok',
    infeasibleReasons,
    offTarget,
    ladderLimited,
  }

  return {
    phase,
    feasibility,
    dropsFixed,
    leftoverPolicy,
    targets: { ...targets },
    plan,
    split: { tilePctByType },
    boards: finalBoards,
    additionsByBoard: placement.additionsByBoard,
    semiAdditionsByBoard: placement.semiAdditionsByBoard,
    placementPerResource: placement.perResource,
    dropGroups: config.dropGroups,
    dropGroupsConfig: config.dropGroupsConfig,
    rewardChainConfig: config.rewardChainConfig,
    coinValues,
    shortDropTypes: shortAndOff,
    // The rank from which every merge drops a bucket (null: chance-based drops, or none).
    dropStartRank: built.startRank ?? null,
    multiDropRank: built.multiDropRank ?? null,
    multiDropShort: !!built.multiDropShort,
    tripleDropRank: built.tripleDropRank ?? null,
    tripleDropShort: !!built.tripleDropShort,
    tileTypes: alwaysDrop ? tileTypes : null,
    riseUsed,
    twisterMinShare: twisterFill?.minShare ?? null,
    tileHold: { keptOff, caps: [...tileCaps], holds: !!best.holds, reachedShare: best.reachedShare ?? null, baselineShare: baselineReached },
    // Set when one item per merge already pays more than was asked of the
    // drops: the rank from which they would fit (null if no rank does).
    dropFloor: built.floorExceedsWanted ? { startRank: built.startRank, fittingStartRank: built.fittingStartRank ?? null } : null,
    generatedGroups: built.generatedGroups,
    structure: best.structure,
    eligibleMerges: built.eligibleMerges,
    evaluations,
    evaluation: { runs: evalRuns, seed: evalSeed, summary: evaluation.summary, entryRate: evaluation.entryRate },
    perResourceReview,
    energy: { baseSubsidy, ccAdjusted, expectedCollectibleEnergy, energyCredit, effectiveSubsidy, creditRate: ENERGY_CREDIT_RATE },
    findings,
  }
}
