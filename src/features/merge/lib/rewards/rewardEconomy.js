// V2: the energy-credit subsidy formula, collectible-payout math over the
// combined reward inventory, deterministic prediction, and the seeded
// multi-run evaluator that both the configuration solver and the
// "Validate with simulation" action run on.
import { simulatePlaythrough } from '../simulation/mergeSimulation'
import { MAX_RANK, RC_MAX_RANK } from '../core/ranks'
import { MIN_DROP_RANK } from './dropGroups'
import { REWARD_TYPES, ALL_REWARD_TYPES, REWARD_MAX_RANK, rewardPrizeAmount, roundRewardAmount, DEFAULT_LEFTOVER_POLICY } from './rewardChain'

// "Deduct 80% of expected collectible reward ENERGY from the main-chain
// subsidy... apply CC before the deduction: effective subsidy = base subsidy
// x (1 + CC%) - 0.80 x expected collectible energy." A fixed, specified
// rule - never substitute a generator-EV conversion for this flat 0.80x
// deduction. Verified against both worked examples in the spec:
//   computeEffectiveSubsidy(1000, 0, 100)    === 920
//   computeEffectiveSubsidy(1000, 0.10, 100) === 1020
export const ENERGY_CREDIT_RATE = 0.8

export function computeEffectiveSubsidy(baseSubsidy, ccPercent, expectedCollectibleEnergy) {
  const ccAdjusted = baseSubsidy * (1 + ccPercent)
  const energyCredit = ENERGY_CREDIT_RATE * expectedCollectibleEnergy
  const effectiveSubsidy = ccAdjusted - energyCredit
  return {
    baseSubsidy,
    ccPercent,
    ccAdjusted,
    expectedCollectibleEnergy,
    energyCredit,
    effectiveSubsidy,
  }
}

// --- Collectible payout across the combined inventory -------------------
// Tile-placed and merge-dropped reward items of one resource merge with each
// other freely, so what a phase pays is a function of the TOTAL source units
// that resource receives (a rank-r item is 2^(r-1) units), not of each
// source rounded on its own: every 8 units completes one rank-4 collect, and
// whatever is left over sits on the board as the binary remainder (4 units =
// a rank 3, 2 = a rank 2, 1 = a rank 1).
//
// What that remainder pays is the LEFTOVER POLICY, an explicit economist
// choice rather than something assumed:
//   'forfeit' - nothing. Payout comes only in whole rank-4 prizes.
//   'collect' - the player hand-collects each leftover item at its own
//               rank's configured prize when the phase ends.
// No fractional prize ever exists either way - a payout is always a sum of
// real, configured prize amounts.
const UNITS_PER_COLLECT = 2 ** (REWARD_MAX_RANK - 1)

export function payoutForUnits(units, rewardChainConfig, type, leftoverPolicy = DEFAULT_LEFTOVER_POLICY) {
  const whole = Math.floor(units / UNITS_PER_COLLECT)
  let payout = whole * rewardPrizeAmount(rewardChainConfig, type, REWARD_MAX_RANK)
  if (leftoverPolicy === 'collect') {
    const rest = units - whole * UNITS_PER_COLLECT
    for (let rank = REWARD_MAX_RANK - 1; rank >= 1; rank--) {
      if (rest & (2 ** (rank - 1))) payout += rewardPrizeAmount(rewardChainConfig, type, rank)
    }
  }
  return payout
}

// The whole number of source units whose payout lands closest to `target`
// (ties go to the smaller, cheaper count). When the target can't be hit
// exactly - it's under half of the smallest payable step, or it falls
// between two steps of the configured prize ladder - `exact` is false and
// `payout` is the closest feasible result, which the workflow reports as a
// limitation of the ladder rather than papering over.
export function closestUnitsForTarget(target, rewardChainConfig, type, leftoverPolicy = DEFAULT_LEFTOVER_POLICY) {
  if (!(target > 0)) return { units: 0, payout: 0, exact: true }
  const prize4 = rewardPrizeAmount(rewardChainConfig, type, REWARD_MAX_RANK)
  if (!(prize4 > 0)) return { units: 0, payout: 0, exact: false, noPrize: true }
  // Only the neighbourhood of target/prize4 collects can ever be closest, so
  // the scan stays a few dozen candidates however large the target is.
  const baseCollects = Math.floor(target / prize4)
  const minUnits = Math.max(0, baseCollects - 1) * UNITS_PER_COLLECT
  const maxUnits = (baseCollects + 2) * UNITS_PER_COLLECT
  let best = { units: minUnits, payout: payoutForUnits(minUnits, rewardChainConfig, type, leftoverPolicy) }
  for (let u = minUnits + 1; u <= maxUnits; u++) {
    const payout = payoutForUnits(u, rewardChainConfig, type, leftoverPolicy)
    if (Math.abs(payout - target) < Math.abs(best.payout - target)) best = { units: u, payout }
  }
  return { ...best, exact: Math.abs(best.payout - target) < 1e-9 }
}

// A single DETERMINISTIC playthrough (dropMode 'expected' = the scheduled
// drop sequence, no randomness) - the cheap prediction used for per-board
// readouts, merge-count sizing, and anything that must give the same answer
// twice. It is a real run: drops land as items, merge with tile items, and
// collected energy funds free taps. Not a substitute for evaluateAcrossRuns
// when variance matters (a single schedule has none).
export function estimateExpectedCollectibleRewards(
  boards,
  {
    rewardChainConfig,
    dropGroupsConfig,
    dropGroupsById,
    drBudget = Infinity,
    rcBoards = undefined,
    minDropRank: minDropRankOpt,
    leftoverPolicy,
    // RC-phase overrides, forwarded verbatim to simulatePlaythrough's own
    // rc* options (which otherwise re-read the RC board 0's saved config at
    // the transition) - lets a solver evaluate a CANDIDATE RC config without
    // writing it onto the boards first.
    rcRewardChainConfig = undefined,
    rcDropGroupsConfig = undefined,
    rcDropGroupsById = undefined,
    rcMinDropRank = undefined,
    rcLeftoverPolicy = undefined,
  } = {},
) {
  const result = simulatePlaythrough(boards, {
    drBudget,
    rewardChainConfig,
    dropGroupsConfig,
    dropGroupsById,
    dropMode: 'expected',
    rcBoards,
    minDropRank: minDropRankOpt,
    leftoverPolicy,
    rcRewardChainConfig,
    rcDropGroupsConfig,
    rcDropGroupsById,
    rcMinDropRank,
    rcLeftoverPolicy,
  })
  return { collected: result.collected, collectedBySource: result.collectedBySource, mergeCountsByRank: result.mergeCountsByRank, result }
}

// What ONE roll of a rank's drop table is worth per resource, expressed as
// rank-4-equivalent value: a dropped rank-r item is 2^(r-1) of the 8 source
// units a full rank-4 collect needs, so it is worth that fraction of the
// rank-4 prize once merged up. (Not its own rank's hand-collect prize - the
// intended strategy is merging toward rank 4.)
export function expectedDropValuePerRoll(table, groupsById, rewardChainConfig) {
  const amounts = Object.fromEntries(ALL_REWARD_TYPES.map((t) => [t, 0]))
  if (!table || table.entries.length === 0) return amounts
  const totalWeight = table.noDropWeight + table.entries.reduce((s, e) => s + e.weight, 0)
  if (totalWeight <= 0) return amounts
  for (const entry of table.entries) {
    const group = groupsById.get(entry.groupId)
    if (!group) continue
    const p = entry.weight / totalWeight
    for (const [type, rank] of Object.entries(group.items)) {
      amounts[type] += (p * 2 ** (Math.min(rank, REWARD_MAX_RANK) - 1) * rewardPrizeAmount(rewardChainConfig, type, REWARD_MAX_RANK)) / UNITS_PER_COLLECT
    }
  }
  return amounts
}

// "7 merges of rank 7, 5 of rank 8 ... give each rank the drop groups that
// will give it an EV toward the segment's target" - one row per eligible
// rank: how many merges produce that rank, what one roll of its table is
// worth (rank-4 equivalent - see expectedDropValuePerRoll), and the product.
// A transparency report over the same inputs the generator sizes against.
export function computeRankContributions(mergeCountsByRank, dropGroupsConfig, dropGroupsById, rewardChainConfig, { minDropRank: minDropRankOpt } = {}) {
  const startRank = minDropRankOpt ?? MIN_DROP_RANK
  const rows = []
  for (let rank = startRank; rank <= RC_MAX_RANK; rank++) {
    const merges = mergeCountsByRank?.[rank] ?? 0
    const table = dropGroupsConfig?.[rank - 1]
    const perRollEv = expectedDropValuePerRoll(table, dropGroupsById, rewardChainConfig)
    const contribution = Object.fromEntries(REWARD_TYPES.map((t) => [t, perRollEv[t] * merges]))
    rows.push({ rank, merges, perRollEv, contribution })
  }
  return rows
}

// --- Segment reward targets ---
// Segment 0 (the base segment) holds the real, absolute target for each
// resource; every other segment's own REQUESTED target is base x that
// segment's own segmentFactor (one multiplier across all four resources).
// Only coins may be a fraction: every other resource's target is rounded to
// the nearest whole number (roundRewardAmount) - for the base segment too, so
// an older saved fractional target is never built against as typed.
export function effectiveRewardTargets(baseTargets, segmentFactor = 1) {
  return Object.fromEntries(Object.entries(baseTargets ?? {}).map(([type, value]) => [type, roundRewardAmount(type, (value ?? 0) * segmentFactor)]))
}

// --- Seeded multi-run evaluation ---
// A small, dependency-free seeded PRNG (mulberry32) - deterministic from
// `seed`, so a reported run is exactly reproducible, unlike Math.random.
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
  return sorted[idx]
}

function summarizeNumbers(values) {
  if (values.length === 0) return { mean: null, p10: null, p50: null, p90: null, min: null, max: null }
  const sorted = [...values].sort((a, b) => a - b)
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  return { mean, p10: percentile(sorted, 10), p50: percentile(sorted, 50), p90: percentile(sorted, 90), min: sorted[0], max: sorted[sorted.length - 1] }
}

// Every reward item type, Twister DR included - callers that only care about
// the four source-allocated resources read those keys and ignore the rest.
const perType = () => Object.fromEntries(ALL_REWARD_TYPES.map((t) => [t, []]))

// Runs `runs` independent, seeded (reproducible) playthroughs with genuine
// per-merge drop rolls - real variance, the same mechanics and prize
// definitions real play uses - and reports, per resource: whole-run payouts,
// each phase's own payouts, each phase's tile/drop attribution, forfeited
// leftovers, plus completion rates and DR spend. This ONE function is both
// the solver's scoring function (a fixed seed makes it a deterministic
// function of the config, so candidates compare fairly) and what "Validate
// with simulation" shows, so an estimate and its validation can never be
// two different models.
export function validateConfigAcrossRuns(
  boards,
  {
    rewardChainConfig,
    dropGroupsConfig,
    dropGroupsById,
    rcBoards,
    runs = 100,
    seed = 1,
    drBudget = Infinity,
    minDropRank: minDropRankOpt,
    leftoverPolicy,
    rcRewardChainConfig,
    rcDropGroupsConfig,
    rcDropGroupsById,
    rcMinDropRank,
    rcLeftoverPolicy,
    // How the simulated players take the small rewards ('merge' | 'best' |
    // 'all' - mergeSimulation.js: findTapCollectCell). A tapping player can
    // stay on one board for ever, so such runs get a longer leash.
    collectPolicy = 'merge',
    maxSteps = undefined,
    // Every simulated player rolls their own lucky drops, like a real one
    // (mergeSimulation.js: options.luckRng). Off by default: an average is
    // steadier when all players have the same luck.
    randomLuck = false,
    // The players merge without looking (mergeSimulation.js: options.mergeRng).
    carelessMerges = false,
    // Also return every player's own amounts ({ main, rc, whole }: per
    // resource, one number a player; and drSpent), for "how many players
    // land near the amount asked".
    keepSamples = false,
  } = {},
) {
  const rng = mulberry32(seed)
  const whole = perType()
  const main = perType()
  const rc = perType()
  const mainTile = perType()
  const mainDrop = perType()
  const rcTile = perType()
  const rcDrop = perType()
  const forfeited = perType()
  let mainReached = 0
  let rcEntered = 0
  let rcReached = 0
  // How much of each phase's subsidy the player reaches, and on which board
  // a run stopped when it did not reach them all.
  const delivery = { main: { shares: [], stoppedOn: [] }, rc: { shares: [], stoppedOn: [] } }
  const noteDelivery = (bucket, stats) => {
    if (!stats || !(stats.subsidyConfigured > 0)) return
    bucket.shares.push(stats.subsidyDelivered / stats.subsidyConfigured)
    if (stats.boardsReached < stats.boardsTotal) bucket.stoppedOn[stats.boardsReached - 1] = (bucket.stoppedOn[stats.boardsReached - 1] ?? 0) + 1
  }
  const drSpentSamples = []
  const drMainSamples = []
  const drRcSamples = []
  const energySpentSamples = []
  const spaceCollectSamples = []

  for (let i = 0; i < runs; i++) {
    const result = simulatePlaythrough(boards, {
      drBudget,
      rewardChainConfig,
      dropGroupsConfig,
      dropGroupsById,
      rcBoards,
      dropMode: 'stochastic',
      dropRng: rng,
      minDropRank: minDropRankOpt,
      leftoverPolicy,
      rcRewardChainConfig,
      rcDropGroupsConfig,
      rcDropGroupsById,
      rcMinDropRank,
      rcLeftoverPolicy,
      collectPolicy,
      ...(maxSteps ? { maxSteps } : {}),
      ...(randomLuck ? { luckRng: rng } : {}),
      ...(carelessMerges ? { mergeRng: rng } : {}),
    })
    for (const type of ALL_REWARD_TYPES) {
      whole[type].push(result.collected[type] ?? 0)
      // A run that never entered RC contributes 0 to every RC sample rather
      // than being skipped, so RC figures honestly include "never got
      // there".
      main[type].push(result.collectedMainPhase?.[type] ?? 0)
      mainTile[type].push(result.collectedBySourceMainPhase?.tile?.[type] ?? 0)
      mainDrop[type].push(result.collectedBySourceMainPhase?.drop?.[type] ?? 0)
      if (rcBoards) {
        rc[type].push(result.collectedRcPhase?.[type] ?? 0)
        rcTile[type].push(result.collectedBySourceRcPhase?.tile?.[type] ?? 0)
        rcDrop[type].push(result.collectedBySourceRcPhase?.drop?.[type] ?? 0)
      }
      forfeited[type].push(result.leftoverForfeited?.[type] ?? 0)
    }
    if (result.reachedAt[MAX_RANK] !== undefined) mainReached += 1
    if (result.rcEntered) rcEntered += 1
    if (result.secondGrandPrizeAwarded) rcReached += 1
    noteDelivery(delivery.main, result)
    noteDelivery(delivery.rc, result.rcPhase)
    drSpentSamples.push(result.drSpent)
    drMainSamples.push(result.drSpentMainPhase ?? result.drSpent)
    if (result.drSpentRcPhase != null) drRcSamples.push(result.drSpentRcPhase)
    energySpentSamples.push(result.energySpent)
    spaceCollectSamples.push(result.spaceCollects)
  }

  const summarizeMap = (map) => Object.fromEntries(Object.entries(map).map(([type, values]) => [type, summarizeNumbers(values)]))
  return {
    runs,
    seed,
    payouts: summarizeMap(whole),
    payoutsMainPhase: summarizeMap(main),
    payoutsRcPhase: rcBoards ? summarizeMap(rc) : null,
    payoutsMainPhaseBySource: { tile: summarizeMap(mainTile), drop: summarizeMap(mainDrop) },
    payoutsRcPhaseBySource: rcBoards ? { tile: summarizeMap(rcTile), drop: summarizeMap(rcDrop) } : null,
    ...(keepSamples ? { samples: { whole, main, rc: rcBoards ? rc : null, drSpent: drSpentSamples } } : {}),
    leftoverForfeited: summarizeMap(forfeited),
    subsidyReached: Object.fromEntries(
      Object.entries(delivery).map(([phase, d]) => [phase, { share: d.shares.length ? d.shares.reduce((s, v) => s + v, 0) / d.shares.length : null, stoppedOn: Array.from(d.stoppedOn, (n) => n ?? 0) }]),
    ),
    drSpent: summarizeNumbers(drSpentSamples),
    // The same per phase: the normal event's own spend, and Recompletion's
    // counted from the moment it began (over the runs that entered it).
    drSpentMainPhase: summarizeNumbers(drMainSamples),
    drSpentRcPhase: rcBoards ? summarizeNumbers(drRcSamples) : null,
    energySpent: summarizeNumbers(energySpentSamples),
    spaceCollects: summarizeNumbers(spaceCollectSamples),
    mainPhaseCompletionRate: mainReached / runs,
    rcEntryRate: rcBoards ? rcEntered / runs : null,
    rcPhaseCompletionRate: rcBoards ? rcReached / runs : null,
  }
}
