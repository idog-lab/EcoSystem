// Twister widget economy.
//
// Design direction (it replaces an earlier one where a fixed DR requirement
// drove drop generation): the economist configures the SHARED Twister drops,
// the app measures how much Twister DR each segment actually collects by a
// chosen main-chain progression checkpoint, and the balancing lever is the
// segment-specific DR COST PER SPIN. Twister drop odds are never tuned per
// segment to compensate - they are shared, exactly like every other drop odd
// (App.jsx's SYNCED_REWARD_FIELDS); segments still collect different amounts
// because their boards, subsidy and effort differ.
//
// Three quantities that must not be confused (and are labelled distinctly
// wherever they are shown):
//   raw item DR value   - what dropped Twister items are worth at their own
//                         ranks, before any merging or collecting;
//   collectible income  - the Twister DR actually credited under the
//                         simulated merge/collection policy (this is what
//                         prices are suggested from);
//   DR per spin         - the segment's configured spending cost.
// None of them is the value of what a spin awards: no spin-prize table is
// specified, so a spin has no outcome here and the analysis excludes any
// resources a spin might feed back into Merge.
import { simulatePlaythrough } from '../simulation/mergeSimulation'
import { mulberry32 } from './rewardEconomy'
import { REWARD_TYPES, ALL_REWARD_TYPES, TWISTER_TYPE, REWARD_MAX_RANK, rewardPrizeAmount, rewardLadderIsConfigured } from './rewardChain'
import { DEFAULT_MIN_DROP_RANK, tableDrops, firstDropRank } from './dropGroups'
import { DROP_TABLE_TOTAL_WEIGHT } from './rewardTargeting'
import { RC_MAX_RANK } from '../core/ranks'
import { computeEffectiveSubsidy } from './rewardEconomy'

export const DEFAULT_CHECKPOINT_PCT = 70
// THE EASY WAY (Build event, step 3) - by explicit economist request: "maybe
// ill give u the amount of twists for each segment and ull give the price of
// a twist. maybe that should be done before the blocked queue". The economist
// types the twists per segment; everything else has a working default and
// the BUILD works out each segment's price (priceTwisterForBuild, below).
// These defaults are this app's own, not confirmed game values, and say so
// where they are shown:
//   - the four Twister DR rank values (valid under the merge rule). Twister
//     DR is its own currency and the price of a twist is measured in it, so
//     the size of these numbers changes the price and nothing else;
//   - how often a merge drops a rank-1 Twister item (out of 1000). More often
//     means a smoother income, not a different number of twists;
//   - when the twists are counted: by the end of the phase.
// 2 / 5 / 12 / 30 is the economist's own suggestion ("we need the amount in
// the twister to be more rounded, lets say to 5 with the same multilication
// logic. maybe somehting like 2, 5, 12, 30"). It was 1 / 3 / 7 / 16.
export const TWISTER_DEFAULT_VALUES = [2, 5, 12, 30]

// The four Twister DR values at `factor` times the starting ones, as ROUND
// numbers: a value of 10 or more is a multiple of 5, a smaller one a whole
// number (factor 1 gives 2 / 5 / 12 / 30 back; factor 5 gives 10 / 25 / 60 /
// 150). Rounding must not break the merge rule, so each rank is then raised,
// if it has to be, until merging up never loses value and rank 4 is worth
// strictly more than cashing out early.
export function roundTwisterValues(factor = 1) {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1
  if (f <= 1 + 1e-9) return [...TWISTER_DEFAULT_VALUES] // the starting values as they are
  const nice = (v) => (v >= 10 ? Math.round(v / 5) * 5 : Math.max(1, Math.round(v)))
  const niceUp = (v) => (v >= 10 ? Math.ceil(v / 5 - 1e-9) * 5 : Math.max(1, Math.ceil(v - 1e-9)))
  const out = TWISTER_DEFAULT_VALUES.map((v) => nice(v * f))
  // Every merge strictly pays more (rewardChain.js: validateRewardLadder).
  out[1] = Math.max(out[1], niceUp(2 * out[0] + 1))
  out[2] = Math.max(out[2], niceUp(2 * out[1] + 1))
  out[3] = Math.max(out[3], niceUp(Math.max(2 * out[2], 4 * out[1], 8 * out[0]) + 1))
  return out
}
export const TWISTER_EASY_CHECKPOINT_PCT = 100
// The progress points at which every segment's collected Twister DR is shown
// (economist: "how much each segment got twisters when they get to 70-75%
// progression"). Observed in the same runs that set the price.
export const PROGRESS_MARKS = [70, 75]
// ON TRACK (economist: "in some segments ... the user get the twister final
// amount in 100% progression and some at 50 ... i need the model to be the
// smart one"). Every simulated player's Twister DR is recorded every 5% of
// the phase, so the build can say WHEN a typical player of each segment has
// all the twists, and what they hold on the way (PACE_MARKS, shown in step 4).
//   on track  the typical player has all the twists by the point they are
//             counted, and not more than TWISTER_ON_TRACK_WINDOW_PCT points
//             of progress before it;
//   early     has them all sooner than that;
//   late      does not have them all when they are counted.
// Twister DR is credited when a Twister item is finished (rank 4), so it
// arrives in steps. A segment whose typical player finishes only one or two
// items gets every twist in one or two jumps, wherever in the phase those
// fall - that is what "at 50" was. TWISTER_MIN_COLLECTS is how many finished
// items the build wants of every segment's typical player (it makes the
// Twister items bigger until then, rank 3 at most).
// All three numbers are this app's own.
export const PACE_MARKS = [25, 50, 70, 75, 100]
export const TRACK_MARKS = Array.from({ length: 20 }, (_, k) => (k + 1) * 5)
const TRACK_FRACTIONS = TRACK_MARKS.map((pct) => pct / 100)
export const TWISTER_ON_TRACK_WINDOW_PCT = 20
export const TWISTER_MIN_COLLECTS = 3
// A price is "a fit" when the typical player ends with the twists asked or up
// to this much more (prices move in whole steps, so exact is rarely possible).
export const TWISTER_OVER_TOLERANCE = 0.25
export const DEFAULT_TWISTER_RUNS = 60
export const DEFAULT_TWISTER_SEED = 11
// Simulated runs per yield back to the event loop (keeps progress painting
// and Cancel responsive).
const RUNS_PER_CHUNK = 4

export function createTwisterPlan() {
  return {
    // Design metadata for the price analysis - NOT runtime configuration.
    checkpointPct: DEFAULT_CHECKPOINT_PCT,
    // Required before a price can be derived; null = not entered yet (an
    // empty field is never read as zero).
    targetSpins: null,
    // Explicit per-segment overrides of targetSpins, keyed by segment index.
    targetSpinsOverrides: {},
    // A price step: costs are whole multiples of this many DR. The advanced
    // Twister tool uses it for its own suggestions. A BUILD uses it only when
    // `roundPrice` is on (see below).
    costIncrement: 1,
    // THE PRICE OF A TWIST IS WHATEVER MAKES IT WORK (economist: "the twister
    // spin cost isnt hard on the 10, the model can give any price for the spin
    // to make it work"). A build fits any whole price. Rounding the price to
    // steps is an option that has to be switched on by typing a step in step
    // 4; a step saved before this rule (a project that still carries 10) is
    // not used.
    roundPrice: false,
    runs: DEFAULT_TWISTER_RUNS,
    seed: DEFAULT_TWISTER_SEED,
  }
}

export function normalizeTwisterPlan(raw) {
  const base = createTwisterPlan()
  const plan = { ...base, ...(raw ?? {}) }
  plan.targetSpinsOverrides = { ...(raw?.targetSpinsOverrides ?? {}) }
  return plan
}

export function targetSpinsForSegment(plan, segmentIndex, spinObjective = null) {
  const override = plan?.targetSpinsOverrides?.[segmentIndex]
  if (Number.isFinite(override) && override > 0) return override
  if (Number.isFinite(plan?.targetSpins) && plan.targetSpins > 0) return plan.targetSpins
  // A configured widget length is the natural target when no explicit one
  // was typed - never invented when it isn't configured.
  if (Number.isFinite(spinObjective) && spinObjective > 0) return spinObjective
  return null
}

// --- Twister definitions and drop rules --------------------------------

export function twisterIsConfigured(rewardChainConfig) {
  return rewardLadderIsConfigured(rewardChainConfig, TWISTER_TYPE)
}

export function groupHasTwister(group) {
  return group?.items?.[TWISTER_TYPE] != null
}

const tableTotal = (table) => (table?.noDropWeight ?? 0) + (table?.entries ?? []).reduce((s, e) => s + Math.max(0, e.weight), 0)

// Per eligible resulting main-chain rank: the chance one merge drops a
// Twister item, and the raw DR value of that roll (item value at its own
// rank x chance). Rows cover every rank from minDropRank up; a rank below it
// never rolls a drop at all (engine gate).
export function twisterDropOdds(dropGroups, dropGroupsConfig, { minDropRank = DEFAULT_MIN_DROP_RANK, rewardChainConfig = null, maxRank = RC_MAX_RANK } = {}) {
  const byId = new Map((dropGroups ?? []).map((g) => [g.id, g]))
  const rows = []
  for (let rank = firstDropRank(dropGroupsConfig, minDropRank); rank <= maxRank; rank++) {
    const table = dropGroupsConfig?.[rank - 1]
    if (!tableDrops(table, minDropRank)) continue
    const total = tableTotal(table)
    let probability = 0
    let rawValuePerMerge = 0
    const groups = []
    if (table && total > 0) {
      for (const entry of table.entries) {
        const group = byId.get(entry.groupId)
        if (!groupHasTwister(group) || !(entry.weight > 0)) continue
        const p = entry.weight / total
        const itemRank = Math.min(group.items[TWISTER_TYPE], REWARD_MAX_RANK)
        probability += p
        rawValuePerMerge += p * (rewardChainConfig ? rewardPrizeAmount(rewardChainConfig, TWISTER_TYPE, itemRank) : 0)
        groups.push({ groupId: group.id, name: group.name, itemRank, probability: p, weight: entry.weight })
      }
    }
    rows.push({ rank, locked: !!table?.locked, total, probability, rawValuePerMerge, groups })
  }
  return rows
}

export function hasTwisterDrops(dropGroups, dropGroupsConfig, minDropRank = DEFAULT_MIN_DROP_RANK) {
  return twisterDropOdds(dropGroups, dropGroupsConfig, { minDropRank }).some((r) => r.probability > 0)
}

export function twisterRuleGroupId(itemRank) {
  return `twister-r${itemRank}`
}

// The simple shared drop rule: "one rank-R Twister item on N per mille of
// eligible merges". Writes a dedicated single-item group into every eligible,
// unlocked rank table, taking its weight from that table's no-drop weight so
// every other group's odds stay exactly as they were.
//
// The group is deliberately NOT marked `auto`: the Small Rewards generator
// replaces `auto` groups on every Generate and keeps everything else with its
// odds, so a Twister rule survives regenerating the other four resources
// (which then size themselves in the probability that is left).
//
// Respected, never overridden: a locked rank table is left exactly as it is;
// hand-made groups (including ones that bundle Twister with other resources)
// are untouched; ranks below minDropRank get nothing. perMille 0 removes the
// rule. Tables are written with a total of 1000 - a table on another scale is
// rescaled first (same odds, rounded to whole weights) and that is reported.
// `fromAuto`: when a table has no free no-drop weight (a built design: every
// merge drops a container), the rest is taken from the GENERATED containers,
// each in proportion - they are rebuilt by the next build anyway. Without it
// the rule could not be set on a built design at all.
//
// `bundleFromRank` + `bundleWith` ({ type, rank }): from the merge that makes
// that rank up, the Twister item does not drop alone - it drops together
// with that reward item, at the same odds. This is what keeps the "from rank
// N every drop holds two or more items" rule (board.multiDropRank) true for
// the Twister container as well; without it a lone Twister item would still
// be 20% of those drops. It is written here, as part of the rule, and not by
// the build: the Twister groups are kept (never generated), so they have to
// be right before the build runs.
export function applyTwisterDropRule({ dropGroups = [], dropGroupsConfig = [], minDropRank = DEFAULT_MIN_DROP_RANK, itemRank = 1, perMille = 0, fromAuto = false, bundleFromRank = null, bundleWith = null } = {}) {
  const autoIds = new Set(dropGroups.filter((g) => g?.auto).map((g) => g.id))
  const rank = Math.max(1, Math.min(REWARD_MAX_RANK, Math.round(itemRank)))
  const want = Math.max(0, Math.min(DROP_TABLE_TOTAL_WEIGHT, Math.round(perMille)))
  const findings = []
  const isRuleGroup = (g) => g?.twisterRule === true
  const ruleIds = new Set(dropGroups.filter(isRuleGroup).map((g) => g.id))
  const newId = twisterRuleGroupId(rank)
  const bundles = Number.isFinite(bundleFromRank) && bundleFromRank > 0 && bundleWith?.type && bundleWith.type !== TWISTER_TYPE
  const bundleId = bundles ? `${newId}-with-${bundleWith.type}${bundleWith.rank ?? 1}` : null
  const idFor = (tableRank) => (bundles && tableRank >= bundleFromRank ? bundleId : newId)
  const usedIds = new Set()

  let rescaled = 0
  const clamped = []
  let lockedSkipped = 0
  const lockedRuleRefs = new Set()
  const nextTables = dropGroupsConfig.map((table) => {
    if (!table) return table
    if (table.locked) {
      for (const e of table.entries) if (ruleIds.has(e.groupId)) lockedRuleRefs.add(e.groupId)
      if (table.rank >= minDropRank) lockedSkipped += 1
      return table
    }
    // Rule entries never survive on an ineligible rank, or when replaced.
    const isRuleEntry = (e) => ruleIds.has(e.groupId) || e.groupId === newId || e.groupId === bundleId
    let entries = table.entries.filter((e) => !isRuleEntry(e))
    const removedWeight = table.entries.filter(isRuleEntry).reduce((s, e) => s + Math.max(0, e.weight), 0)
    let noDropWeight = (table.noDropWeight ?? 0) + removedWeight
    if (table.rank < minDropRank) return removedWeight > 0 ? { ...table, entries, noDropWeight } : table
    if (want <= 0) return removedWeight > 0 ? { ...table, entries, noDropWeight } : table

    const total = noDropWeight + entries.reduce((s, e) => s + Math.max(0, e.weight), 0)
    if (total !== DROP_TABLE_TOTAL_WEIGHT) {
      if (total > 0) {
        entries = entries.map((e) => ({ ...e, weight: Math.round((Math.max(0, e.weight) / total) * DROP_TABLE_TOTAL_WEIGHT) }))
        if (entries.length) rescaled += 1
      }
      noDropWeight = Math.max(0, DROP_TABLE_TOTAL_WEIGHT - entries.reduce((s, e) => s + e.weight, 0))
    }
    let weight = Math.min(want, noDropWeight)
    noDropWeight -= weight
    if (fromAuto && weight < want) {
      const autoTotal = entries.filter((e) => autoIds.has(e.groupId)).reduce((s, e) => s + Math.max(0, e.weight), 0)
      const need = Math.min(want - weight, autoTotal)
      if (need > 0) {
        const scale = (autoTotal - need) / autoTotal
        entries = entries.map((e) => (autoIds.has(e.groupId) ? { ...e, weight: Math.floor(Math.max(0, e.weight) * scale) } : e)).filter((e) => e.weight > 0 || !autoIds.has(e.groupId))
        const freed = autoTotal - entries.filter((e) => autoIds.has(e.groupId)).reduce((s, e) => s + e.weight, 0)
        weight += need
        noDropWeight += freed - need // whole-number rounding left over
      }
    }
    if (weight < want) clamped.push({ rank: table.rank, weight })
    if (weight <= 0) return { ...table, entries, noDropWeight }
    usedIds.add(idFor(table.rank))
    return { ...table, entries: [...entries, { groupId: idFor(table.rank), weight }], noDropWeight }
  })

  const keptGroups = dropGroups.filter((g) => !isRuleGroup(g) || lockedRuleRefs.has(g.id)).filter((g) => (g.id !== newId && g.id !== bundleId) || lockedRuleRefs.has(g.id))
  const nextGroups = [...keptGroups]
  if (want > 0 && usedIds.has(newId) && !nextGroups.some((g) => g.id === newId)) {
    nextGroups.push({ id: newId, name: `Twister DR R${rank}`, items: { [TWISTER_TYPE]: rank }, twisterRule: true })
  }
  if (want > 0 && bundles && usedIds.has(bundleId) && !nextGroups.some((g) => g.id === bundleId)) {
    nextGroups.push({ id: bundleId, name: `Twister DR R${rank} + ${bundleWith.type} R${bundleWith.rank ?? 1}`, items: { [bundleWith.type]: bundleWith.rank ?? 1, [TWISTER_TYPE]: rank }, twisterRule: true })
  }

  if (rescaled) findings.push(`${rescaled} rank table${rescaled === 1 ? ' was' : 's were'} rescaled to a total weight of ${DROP_TABLE_TOTAL_WEIGHT} (same odds, rounded to whole weights).`)
  if (clamped.length) {
    findings.push(
      `Rank${clamped.length === 1 ? '' : 's'} ${clamped.map((c) => c.rank).join(', ')}: only ${clamped.map((c) => c.weight).join(', ')} per mille of no-drop weight was free, so the Twister drop there is lower than the ${want} requested. Lower another group's weight to make room.`,
    )
  }
  if (lockedSkipped) findings.push(`${lockedSkipped} locked rank table${lockedSkipped === 1 ? ' was' : 's were'} left unchanged.`)
  return { dropGroups: nextGroups, dropGroupsConfig: nextTables, findings, groupId: want > 0 ? newId : null }
}

// The Twister rank values the easy way starts from, written only where a
// rank has no value yet (a typed value is never replaced). Syntax and asset
// are left as they are: this app does not invent production syntax.
export function withDefaultTwisterValues(rewardChainConfig) {
  const ladder = (rewardChainConfig?.[TWISTER_TYPE] ?? []).slice(0, REWARD_MAX_RANK)
  if (ladder.some((r) => (r?.prizeAmount ?? 0) > 0)) return rewardChainConfig
  const next = Array.from({ length: REWARD_MAX_RANK }, (_, i) => ({ syntax: '', asset: '', displayName: '', art: null, ...(ladder[i] ?? {}), prizeAmount: TWISTER_DEFAULT_VALUES[i], auto: true }))
  return { ...rewardChainConfig, [TWISTER_TYPE]: next }
}

// The current rule, read back from the config (null when no rule group
// exists): which item rank it drops and its per-mille weight - a single
// number when every eligible unlocked rank agrees, otherwise `mixed`.
export function readTwisterDropRule(dropGroups, dropGroupsConfig, minDropRank = DEFAULT_MIN_DROP_RANK) {
  // The rule may be written as two groups: the Twister item on its own, and
  // (from the "two or more items" rank) bundled with a reward item.
  const ruleGroups = (dropGroups ?? []).filter((g) => g?.twisterRule === true)
  const group = ruleGroups[0]
  if (!group) return null
  const ruleIds = new Set(ruleGroups.map((g) => g.id))
  const weights = []
  for (const table of dropGroupsConfig ?? []) {
    if (!table || table.locked || table.rank < minDropRank) continue
    const total = tableTotal(table)
    const weight = table.entries.filter((e) => ruleIds.has(e.groupId)).reduce((sum, e) => sum + Math.max(0, e.weight), 0)
    weights.push(total > 0 ? Math.round((weight / total) * DROP_TABLE_TOTAL_WEIGHT) : 0)
  }
  const uniform = weights.every((w) => w === weights[0])
  return { groupId: group.id, itemRank: group.items[TWISTER_TYPE], perMille: weights.length ? (uniform ? weights[0] : null) : 0, mixed: !uniform }
}

// The same tables with every Twister item taken out, odds otherwise
// untouched (a Twister-only group still occupies its weight but drops
// nothing) - the "without Twister" baseline for the revalidation.
export function stripTwisterFromGroups(dropGroups) {
  return (dropGroups ?? []).map((g) => {
    if (!groupHasTwister(g)) return g
    const { [TWISTER_TYPE]: _dropped, ...rest } = g.items
    return { ...g, items: rest }
  })
}

// Takes the Twister items the BUILD put into the containers out again (the
// Twister was removed): each generated container keeps its other items and
// its weight; one that held only a Twister item is removed and its weight
// becomes "nothing". Hand-made groups are untouched.
export function removeGeneratedTwister({ dropGroups = [], dropGroupsConfig = [] } = {}) {
  const emptied = new Set()
  const groups = []
  for (const g of dropGroups) {
    if (!g?.auto || !groupHasTwister(g)) {
      groups.push(g)
      continue
    }
    const { [TWISTER_TYPE]: _rank, ...rest } = g.items
    if (Object.keys(rest).length === 0) emptied.add(g.id)
    else groups.push({ ...g, items: rest })
  }
  const tables = dropGroupsConfig.map((table) => {
    if (!table || !table.entries.some((e) => emptied.has(e.groupId))) return table
    const gone = table.entries.filter((e) => emptied.has(e.groupId)).reduce((s, e) => s + Math.max(0, e.weight), 0)
    return { ...table, entries: table.entries.filter((e) => !emptied.has(e.groupId)), noDropWeight: (table.noDropWeight ?? 0) + gone }
  })
  return { dropGroups: groups, dropGroupsConfig: tables }
}

// Twister must never sit under a starting tile: not in the authored reward
// items, not in a generated blocked queue or semi placement.
export function boardHasTwisterUnderTiles(board) {
  const twisterValue = (value) => value >= 1000 && Math.floor((value - 1000) / 10) === ALL_REWARD_TYPES.indexOf(TWISTER_TYPE)
  return (
    (board.rewardQueueItems ?? []).some((it) => it?.type === TWISTER_TYPE) ||
    (board.rewardSemiItems ?? []).some((it) => it?.type === TWISTER_TYPE) ||
    (board.blockedQueue ?? []).some(twisterValue) ||
    (board.semiPlacements ?? []).some((p) => twisterValue(p.rank))
  )
}

// Removes any Twister entry from a board's tile-side reward data (import /
// older-data safety net - nothing in the app writes one).
export function stripTwisterFromTiles(board) {
  if (!boardHasTwisterUnderTiles(board)) return board
  const twisterIndex = ALL_REWARD_TYPES.indexOf(TWISTER_TYPE)
  const isTwisterValue = (value) => value >= 1000 && Math.floor((value - 1000) / 10) === twisterIndex
  return {
    ...board,
    rewardQueueItems: (board.rewardQueueItems ?? []).filter((it) => it?.type !== TWISTER_TYPE),
    rewardSemiItems: (board.rewardSemiItems ?? []).filter((it) => it?.type !== TWISTER_TYPE),
    blockedQueue: (board.blockedQueue ?? []).filter((v) => !isTwisterValue(v)),
    semiPlacements: (board.semiPlacements ?? []).filter((p) => !isTwisterValue(p.rank)),
  }
}

// --- Statistics ---------------------------------------------------------

function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
  return sorted[idx]
}

export function summarize(values) {
  if (!values.length) return { n: 0, mean: null, p10: null, p50: null, p90: null, min: null, max: null }
  const sorted = [...values].sort((a, b) => a - b)
  return {
    n: values.length,
    mean: values.reduce((s, v) => s + v, 0) / values.length,
    p10: percentile(sorted, 10),
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  }
}

// --- Income analysis ----------------------------------------------------

// One seeded run of the real engine, observed at the checkpoint. `phase` is
// 'main' (boards = the main list) or 'rc' (boards = the main list, rcBoards =
// the selected RC variant; income is counted from the start of the RC phase).
function runOnce({ boards, rcBoards, phase, fraction, rng, dropGroups, dropGroupsConfig }) {
  const board0 = boards[0]
  const rc0 = rcBoards?.[0]
  const mainGroups = phase === 'main' && dropGroups ? dropGroups : board0.dropGroups ?? []
  const mainTables = phase === 'main' && dropGroupsConfig ? dropGroupsConfig : board0.dropGroupsConfig
  const options = {
    rewardChainConfig: board0.rewardChainConfig,
    dropGroupsConfig: mainTables,
    dropGroupsById: new Map(mainGroups.map((g) => [g.id, g])),
    dropMode: 'stochastic',
    dropRng: rng,
    minDropRank: board0.minDropRank,
    leftoverPolicy: board0.rewardLeftoverPolicy,
    checkpoint: { phase, fraction },
    checkpointFractions: TRACK_FRACTIONS,
  }
  if (phase === 'rc') {
    options.rcBoards = rcBoards
    if (dropGroups) options.rcDropGroupsById = new Map(dropGroups.map((g) => [g.id, g]))
    if (dropGroupsConfig) options.rcDropGroupsConfig = dropGroupsConfig
    else if (rc0?.dropGroupsConfig) options.rcDropGroupsConfig = rc0.dropGroupsConfig
  }
  const result = simulatePlaythrough(boards, options)
  const cp = result.checkpoint
  const phaseCollected = phase === 'rc' ? result.collectedRcPhase : result.collectedMainPhase
  const entered = phase === 'rc' ? result.rcEntered : true
  return {
    reached: !!cp,
    entered,
    stopReason: result.stopReason,
    progress: (phase === 'rc' ? result.progress.rc : result.progress.main) ?? 0,
    // Twister DR credited by the checkpoint, counted from the phase start.
    earnedAtCheckpoint: cp ? cp.collectedInPhase[TWISTER_TYPE] ?? 0 : null,
    // ...and by the end of the phase (after the phase-end leftover policy).
    earnedAtEnd: phaseCollected?.[TWISTER_TYPE] ?? 0,
    uncollectedItems: cp ? cp.twisterUncollected.items : null,
    uncollectedValue: cp ? cp.twisterUncollected.value : null,
    rawDroppedAtCheckpoint: cp ? cp.droppedRawValue[TWISTER_TYPE] ?? 0 : null,
    // Twister DR collected at each progress mark (null: never got that far).
    earnedAtMarks: Object.fromEntries(PACE_MARKS.map((pct) => [pct, result.checkpointsAt?.[TRACK_FRACTIONS[TRACK_MARKS.indexOf(pct)]]?.collectedInPhase?.[TWISTER_TYPE] ?? null])),
    // The same every 5% of the phase (TRACK_MARKS). A run that ended before a
    // mark keeps what it had: that player never gets further.
    earnedTrack: (() => {
      let last = 0
      return TRACK_FRACTIONS.map((fr) => (last = result.checkpointsAt?.[fr]?.collectedInPhase?.[TWISTER_TYPE] ?? last))
    })(),
    drSpentAtCheckpoint: cp ? cp.drSpent : null,
    drSpent: result.drSpent,
    energySpent: result.energySpent,
    spaceCollects: result.spaceCollects,
    payouts: Object.fromEntries(REWARD_TYPES.map((t) => [t, phaseCollected?.[t] ?? 0])),
  }
}

function summarizeRuns(records, { phase, fraction, runs, seed }) {
  const reached = records.filter((r) => r.reached)
  const notReached = records.filter((r) => !r.reached)
  const byStopReason = {}
  for (const r of notReached) {
    const reason = phase === 'rc' && !r.entered ? 'never-entered-rc' : r.stopReason
    byStopReason[reason] = (byStopReason[reason] ?? 0) + 1
  }
  // All-run series: a run that reached the checkpoint counts what it had
  // there; a run that ended first counts what it had when it ended. No run
  // is dropped.
  const allRunSamples = records.map((r) => (r.reached ? r.earnedAtCheckpoint : r.earnedAtEnd))
  const conditionalSamples = reached.map((r) => r.earnedAtCheckpoint)
  return {
    phase,
    fraction,
    runs,
    seed,
    reachedCount: reached.length,
    reachRate: records.length ? reached.length / records.length : 0,
    endedBeforeCount: notReached.length,
    endedBeforeByReason: byStopReason,
    // Conditional on reaching the checkpoint.
    income: summarize(conditionalSamples),
    // Every run, reached or not.
    incomeAllRuns: summarize(allRunSamples),
    samples: conditionalSamples,
    samplesAllRuns: allRunSamples,
    uncollectedItems: summarize(reached.map((r) => r.uncollectedItems)),
    uncollectedValue: summarize(reached.map((r) => r.uncollectedValue)),
    rawDropped: summarize(reached.map((r) => r.rawDroppedAtCheckpoint)),
    // Twister DR collected at 70% and 75% of the phase, over the runs that got there.
    incomeAtMarks: Object.fromEntries(PACE_MARKS.map((pct) => {
      const values = records.map((r) => r.earnedAtMarks?.[pct]).filter((v) => v != null)
      return [pct, { ...summarize(values), reachRate: records.length ? values.length / records.length : 0 }]
    })),
    // Every run's Twister DR at each 5% of the phase (twisterPace reads it).
    tracks: records.map((r) => r.earnedTrack),
    drSpentAtCheckpoint: summarize(reached.map((r) => r.drSpentAtCheckpoint)),
    incomeAtPhaseEnd: summarize(records.map((r) => r.earnedAtEnd)),
    drSpent: summarize(records.map((r) => r.drSpent)),
    energySpent: summarize(records.map((r) => r.energySpent)),
    spaceCollects: summarize(records.map((r) => r.spaceCollects)),
    payouts: Object.fromEntries(REWARD_TYPES.map((t) => [t, summarize(records.map((r) => r.payouts[t]))])),
  }
}

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0))

// Measures one segment's Twister income at the checkpoint over `runs` seeded
// runs of the real engine - the actual shared drop groups, this segment's
// own boards, reward items landing on the board and taking space, merging
// and collecting under the automatic policy, the energy feedback loop, and
// the configured phase-transition and leftover policies.
//
// With `compareWithoutTwister`, the same seed is run a second time with the
// Twister items removed from the drops, so the effect of adding Twister on
// the other four resources, player DR spend and the energy/subsidy
// calculation can be reported rather than assumed.
//
// Async and chunked: yields after every few runs, calls onProgress(done,
// total), and stops early (returning null) when isCancelled() turns true.
export async function analyzeTwisterIncome({
  boards,
  rcBoards = null,
  phase = 'main',
  checkpointPct = DEFAULT_CHECKPOINT_PCT,
  runs = DEFAULT_TWISTER_RUNS,
  seed = DEFAULT_TWISTER_SEED,
  compareWithoutTwister = true,
  onProgress,
  isCancelled,
} = {}) {
  const fraction = Math.max(0, Math.min(1, checkpointPct / 100))
  const phaseBoards = phase === 'rc' ? rcBoards : boards
  if (!boards?.length || !phaseBoards?.length) return null
  const total = runs * (compareWithoutTwister ? 2 : 1)
  let done = 0

  const collect = async (override) => {
    const rng = mulberry32(seed)
    const records = []
    for (let i = 0; i < runs; i++) {
      records.push(runOnce({ boards, rcBoards, phase, fraction, rng, ...override }))
      done += 1
      if ((i + 1) % RUNS_PER_CHUNK === 0 || i === runs - 1) {
        onProgress?.(done, total)
        await nextTick()
        if (isCancelled?.()) return null
      }
    }
    return records
  }

  const withRecords = await collect({})
  if (!withRecords) return null
  const summary = summarizeRuns(withRecords, { phase, fraction, runs, seed })

  const phaseBoard0 = phaseBoards[0]
  const subsidyBase = phaseBoards.reduce((s, b) => s + (b.blockedValue ?? 0) * (1 + (b.ccPercent ?? 0)), 0)
  // The 80% energy credit, applied once, to MERGE ENERGY only. Twister DR
  // is a different currency and never enters this formula.
  const energyCredit = (s) => computeEffectiveSubsidy(subsidyBase, 0, s.payouts.energy.mean ?? 0).effectiveSubsidy
  summary.effectiveSubsidy = energyCredit(summary)
  summary.subsidyBase = subsidyBase

  if (compareWithoutTwister) {
    const strippedGroups = stripTwisterFromGroups(phaseBoard0.dropGroups ?? [])
    const withoutRecords = await collect({ dropGroups: strippedGroups, dropGroupsConfig: phaseBoard0.dropGroupsConfig })
    if (!withoutRecords) return null
    const without = summarizeRuns(withoutRecords, { phase, fraction, runs, seed })
    summary.withoutTwister = {
      payouts: without.payouts,
      drSpent: without.drSpent,
      energySpent: without.energySpent,
      spaceCollects: without.spaceCollects,
      effectiveSubsidy: energyCredit(without),
    }
  }
  return summary
}

// --- Spin cost ----------------------------------------------------------

// With one fixed cost and no other Twister spending (the only rule that is
// specified): available spins = floor(cumulative earned Twister DR / cost).
export function availableSpins(earned, cost) {
  if (!(cost > 0)) return 0
  return Math.floor((earned + 1e-9) / cost)
}

// What a given cost does to a set of simulated players. `samples` are the
// runs that reached the checkpoint; `samplesAllRuns` (optional) is every run.
export function evaluateSpinCost(samples, cost, targetSpins, samplesAllRuns = null) {
  const spins = samples.map((e) => availableSpins(e, cost))
  const attained = (list) => (list.length ? list.filter((e) => availableSpins(e, cost) >= targetSpins).length / list.length : null)
  return {
    cost,
    spins: summarize(spins),
    // Share of the runs that reached the checkpoint holding >= target spins.
    attainment: attained(samples),
    // The same over every run, reached or not.
    attainmentAllRuns: samplesAllRuns ? attained(samplesAllRuns) : null,
    // DR left over after taking every available spin.
    remainder: summarize(samples.map((e) => e - availableSpins(e, cost) * cost)),
  }
}

// Suggests a DR cost per spin for one segment.
//   indicative cost = mean collected Twister DR at the checkpoint / target spins
// is only the starting point: spin counts are whole numbers and income
// varies run to run, so every permitted cost near it (whole multiples of
// `increment`, never below one increment) is scored on the simulated
// outcomes themselves. Chosen: THE DEAREST COST AT WHICH THE TYPICAL (median)
// PLAYER STILL HAS THE TARGET SPINS - so that player gets what was asked, as
// late as the price steps allow, in every segment alike. (It used to be the
// cost whose median was closest to the target from either side: on a test
// event that priced one segment so its typical player never got the last two
// twists, and another so it had them all halfway through.) Only when no
// supported cost gives the typical player the target is the closest one
// taken, and that is said. Attainment says how many players reach the target.
export function suggestSpinCost({ samples = [], samplesAllRuns = null, targetSpins, increment = 1 } = {}) {
  const step = Math.max(1, Math.round(increment))
  if (!(targetSpins > 0)) return { status: 'no-target', suggested: null, candidates: [], indicative: null, message: 'Enter a target number of spins first.' }
  if (!samples.length) return { status: 'no-data', suggested: null, candidates: [], indicative: null, message: 'No simulated run reached the checkpoint, so there is no income to price against.' }
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length
  if (!(mean > 0)) {
    return { status: 'no-income', suggested: null, candidates: [], indicative: 0, message: 'No Twister DR is collected by this checkpoint, so no cost can give the target spins. Check the Twister rank values and drops.' }
  }
  const indicative = mean / targetSpins
  const lowest = step
  // The typical player can sit far from the average (income arrives in whole
  // item collects), so the range covers the cost that player can afford too.
  const sortedSamples = [...samples].sort((a, b) => a - b)
  const typicalIncome = percentile(sortedSamples, 50) ?? 0
  const typicalCost = Math.floor((typicalIncome / targetSpins + 1e-9) / step) * step
  const from = Math.max(lowest, Math.min(Math.floor((indicative * 0.5) / step) * step, typicalCost - 2 * step))
  const to = Math.max(from + step, Math.ceil((indicative * 1.6) / step) * step, typicalCost + 2 * step)
  let costs = []
  for (let cost = from; cost <= to; cost += step) costs.push(cost)
  if (costs.length > 80) {
    const centre = Math.max(lowest, Math.round(indicative / step) * step)
    costs = costs.filter((c) => Math.abs(c - centre) <= 40 * step || Math.abs(c - typicalCost) <= 2 * step)
  }
  const candidates = costs.map((cost) => evaluateSpinCost(samples, cost, targetSpins, samplesAllRuns))
  const score = (c) => [Math.abs(c.spins.p50 - targetSpins), Math.abs(c.spins.mean - targetSpins), -(c.attainment ?? 0), c.cost]
  const better = (a, b) => {
    const sa = score(a)
    const sb = score(b)
    for (let i = 0; i < sa.length; i++) if (Math.abs(sa[i] - sb[i]) > 1e-9) return sa[i] < sb[i]
    return false
  }
  const enough = candidates.filter((c) => c.spins.p50 >= targetSpins)
  let suggested = candidates[0]
  if (enough.length > 0) suggested = enough.reduce((a, b) => (b.cost > a.cost ? b : a))
  else for (const c of candidates) if (better(c, suggested)) suggested = c
  const close = suggested.spins.p50 >= targetSpins && suggested.spins.p50 <= targetSpins * (1 + TWISTER_OVER_TOLERANCE) + 1e-9
  let message = null
  let tooLow = false
  if (!close && suggested.spins.p50 > targetSpins) {
    message = `At ${suggested.cost} DR the typical player has ${suggested.spins.p50} spins - more than the ${targetSpins} asked - and at the next price up (${suggested.cost + step} DR) fewer than ${targetSpins}.${step > 1 ? ` Prices move in steps of ${step} DR; a smaller step lands closer.` : ''}`
  } else if (!close) {
    // "Too low" is said of the TYPICAL player, the one every other figure
    // here is about. Twister DR comes in whole rank-4 collects, so the average
    // can sit under one price step per twist while the typical player has
    // enough (many players with one collect, some with none): that used to
    // be reported as too low beside "a typical player gets 16 of 15".
    if (indicative < lowest && suggested.spins.p50 < targetSpins) {
      message = `Income is too low for this target: even the lowest supported cost (${lowest} DR) gives a typical player ${suggested.spins.p50} spin${suggested.spins.p50 === 1 ? '' : 's'}, not ${targetSpins}. Raise the Twister drops or lower the target.`
      tooLow = true
    } else {
      message = `Closest supported cost: at ${suggested.cost} DR the typical (median) player has ${suggested.spins.p50} spin${suggested.spins.p50 === 1 ? '' : 's'} and the average is ${suggested.spins.mean.toFixed(1)} - no cost puts both on ${targetSpins}. Twister DR arrives in lumps (whole item collects), so spin counts jump.${step > 1 ? ` Costs also move in steps of ${step} DR.` : ''}`
    }
  }
  return { status: close ? 'ok' : 'approximate', suggested, candidates, indicative, mean, increment: step, message, tooLow }
}

// WHEN a typical player has all the twists. `tracks`: every run's Twister DR
// at each 5% of the phase (summary.tracks); `need`: twists x price.
//   finishPct  the progress (a TRACK_MARKS value) by which at least half the
//              players have collected `need`; null when fewer than half ever do
//   status     'on-track' | 'early' | 'late' (see PACE_MARKS above)
export function twisterPace({ tracks = [], need, checkpointPct = TWISTER_EASY_CHECKPOINT_PCT, window = TWISTER_ON_TRACK_WINDOW_PCT } = {}) {
  if (!tracks.length || !(need > 0)) return { finishPct: null, status: null }
  const finishes = tracks
    .map((track) => {
      const k = track.findIndex((v) => v >= need - 1e-9)
      return k < 0 ? Infinity : TRACK_MARKS[k]
    })
    .sort((a, b) => a - b)
  const middle = finishes[Math.floor((finishes.length - 1) / 2)]
  const finishPct = Number.isFinite(middle) ? middle : null
  // The point twists are counted, on the 5% grid the runs are observed on.
  const counted = Math.min(100, Math.ceil(checkpointPct / 5 - 1e-9) * 5)
  const status = finishPct == null || finishPct > counted ? 'late' : finishPct < counted - window ? 'early' : 'on-track'
  return { finishPct, status }
}

// The price of a twist for every segment of a build - what the easy way
// promises ("give me the twists, get the price"). For each built segment
// that asks for twists, the same seeded income analysis the Twister tool runs
// is run on exactly the boards and merge drops the build produced, and the
// price is the one suggestSpinCost picks for that segment's twists.
//   segments  the build inputs (segmentBuildInputs): { index, name, twists,
//             twisterCheckpointPct, twisterCostStep, mainBoards }
//   built     the build's per-segment results ({ index, status, boards })
//   shared    the build's shared merge drops
// Returns null when no segment asks for twists; otherwise
// { checkpointPct, runs, seed, rows: [{ index, name, twists, status, cost,
//   incomeMean, spinsMedian, spinsMean, attainment, message, topValue,
//   collectsMedian, finishPct, pace }] } with status
//   'ok' | 'approximate' (closest supported price) | 'no-income' | 'no-data'
//   | 'not-set-up' (no Twister values or drops) | 'not-built'.
//   topValue        what a finished (rank 4) Twister item is worth
//   collectsMedian  how many of them the typical player has finished when
//                   twists are counted (income / topValue)
//   finishPct/pace  when that player has all the twists (twisterPace)
export async function priceTwisterForBuild({ phase, segments, built, shared, runs = DEFAULT_TWISTER_RUNS, seed = DEFAULT_TWISTER_SEED, onProgress, isCancelled } = {}) {
  const asking = (segments ?? []).filter((s) => s.twists > 0)
  if (asking.length === 0) return null
  const checkpointPct = asking[0].twisterCheckpointPct ?? TWISTER_EASY_CHECKPOINT_PCT
  const rows = []
  let done = 0
  // EVERY built segment is measured, not only the ones twists were typed for:
  // the economist wants to see what each segment has at 70-75% progression
  // (incomeAtMarks). A segment with no twists asked gets no price.
  const measured = (segments ?? []).filter((s) => (built ?? []).some((o) => o.index === s.index && o.status !== 'skipped'))
  for (const seg of measured) {
    // A segment the build skipped (no amount) has no boards to price on.
    const segOut = (built ?? []).find((o) => o.index === seg.index && o.status !== 'skipped')
    if (!segOut) continue
    const row = { index: seg.index, name: seg.name, twists: seg.twists, status: 'not-set-up', cost: null, incomeMean: null, spinsMedian: null, spinsMean: null, attainment: null, message: null }
    rows.push(row)
    const boards = segOut.boards.map((b) => ({ ...b, dropGroups: shared?.dropGroups ?? b.dropGroups, dropGroupsConfig: shared?.dropGroupsConfig ?? b.dropGroupsConfig }))
    const b0 = boards[0]
    if (!twisterIsConfigured(b0?.rewardChainConfig) || !hasTwisterDrops(b0?.dropGroups, b0?.dropGroupsConfig, b0?.minDropRank)) {
      row.status = 'not-set-up'
      row.message = 'Twister has no rank values or no drops in this phase.'
      continue
    }
    const analysis = await analyzeTwisterIncome({
      boards: phase === 'rc' ? seg.mainBoards : boards,
      rcBoards: phase === 'rc' ? boards : null,
      phase,
      checkpointPct,
      runs,
      seed,
      compareWithoutTwister: false,
      onProgress: (n) => onProgress?.(done + n, measured.length * runs),
      isCancelled,
    })
    done += runs
    if (!analysis) return null // cancelled
    row.incomeAtMarks = analysis.incomeAtMarks ?? null
    row.topValue = rewardPrizeAmount(b0.rewardChainConfig, TWISTER_TYPE, REWARD_MAX_RANK) || null
    row.collectsMedian = row.topValue > 0 && analysis.income.p50 != null ? analysis.income.p50 / row.topValue : null
    if (!(seg.twists > 0)) {
      row.status = 'no-twists'
      row.message = 'No twists were typed for this segment, so it has no price.'
      row.incomeMean = analysis.income.mean
      row.incomeMedian = analysis.income.p50 ?? null
      continue
    }
    const suggestion = suggestSpinCost({ samples: analysis.samples, samplesAllRuns: analysis.samplesAllRuns, targetSpins: seg.twists, increment: seg.twisterCostStep ?? 1 })
    row.status = suggestion.status
    row.message = suggestion.message
    row.tooLow = !!suggestion.tooLow
    row.step = suggestion.increment ?? null
    row.incomeMean = analysis.income.mean
    row.incomeMedian = analysis.income.p50 ?? null
    row.reachRate = analysis.reachRate
    if (suggestion.suggested) {
      row.cost = suggestion.suggested.cost
      row.spinsMedian = suggestion.suggested.spins.p50
      row.spinsMean = suggestion.suggested.spins.mean
      row.attainment = suggestion.suggested.attainment
      const pace = twisterPace({ tracks: analysis.tracks, need: row.cost * seg.twists, checkpointPct })
      row.finishPct = pace.finishPct
      // "Late" is said of the same player the price is: the one in the middle.
      row.pace = row.spinsMedian < seg.twists ? 'late' : pace.status === 'late' ? 'on-track' : pace.status
    }
  }
  return { checkpointPct, runs, seed, rows }
}

// A stable fingerprint of everything an income analysis depends on for one
// segment+phase. A stored result whose key no longer matches is out of date.
export function twisterAnalysisKey({ boards, rcBoards = null, phase, checkpointPct, runs, seed }) {
  const boardPart = (list) =>
    (list ?? []).map((b) => [b.rows, b.cols, b.tiles, b.blockedValue, b.ccPercent, b.semiPlacements, b.blockedQueue, b.targetEv, b.tier2UnlockRank, b.tier4UnlockRank])
  const cfg = (b) => (b ? [b.rewardChainConfig, b.dropGroups, b.dropGroupsConfig, b.minDropRank, b.rewardLeftoverPolicy] : null)
  return JSON.stringify([phase, checkpointPct, runs, seed, boardPart(boards), cfg(boards?.[0]), phase === 'rc' ? [boardPart(rcBoards), cfg(rcBoards?.[0])] : null])
}
