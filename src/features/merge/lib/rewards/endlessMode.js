// Endless mode - what play becomes once the player holds rank 14.
//
// By explicit economist request: "the user gets rank 14 and the boards goes
// to endless mode", with three changes to the merge drops - "higher EV from
// the drops", "take down the rank u get the drops from by 1", and "most of
// the drops should be coins and energy".
//
// Nothing else changes when it starts: the board, every item on it, the
// inventory, the generator and its lucky drops, and the Twister balance all
// carry on exactly as they were. There is no goal and no end; the rank 14
// stays on the board (there is no rank 15, so two rank 14s do not merge).
//
// The endless drops are DERIVED at that moment from the drops the player was
// already getting (the Recompletion list's), never stored and never
// exported:
//   1. START RANK   one lower than before (ENDLESS_DROP_RANK_SHIFT). The rank
//                   is the rank the merge MAKES, as everywhere else.
//   2. VALUE        an average drop carries ENDLESS_DROP_VALUE_MULTIPLIER
//                   times the source units it carried before (and never less
//                   than ENDLESS_MIN_UNITS_PER_DROP before the multiplier).
//                   With the lower start rank there are also about twice as
//                   many drops, so the value per DR rises by more than this.
//   3. MIX          ENDLESS_COIN_ENERGY_SHARE of those units are coins and
//                   merge energy, split evenly between the two; the rest is
//                   shared by the other resources in the proportions they
//                   had before. A resource with no rank values is left out
//                   (its items would pay nothing), and so is a non-priority
//                   resource that was not dropping before.
// Every merge from the start rank up still drops a bucket (no "nothing"
// outcome), and a bucket still holds one to four items in different ranks -
// the same buckets rule as the build (buildAlwaysDropConfiguration).
// Twister is left exactly as it was: its groups keep their odds, and the new
// lowest rank takes the Twister odds of the rank above it.
//
// THE THREE NUMBERS ARE THIS APP'S CHOICE. The economist gave the direction,
// not the amounts; they are named constants here so they are easy to find
// and change, and the play screens show what they produce.
import { REWARD_TYPES, TWISTER_TYPE, REWARD_MAX_RANK, rewardPrizeAmount, rewardChainForNextPhase, bestUnitValue } from './rewardChain'
import { DEFAULT_TARGET_EV } from '../core/luckyDrop'
import { MIN_DROP_RANK, multiDropRankOf, tripleDropRankOf, soloDropRankOf, TWISTER_FILL_MIN_SHARE, TWISTER_SINGLE_ITEM_SHARE } from './dropGroups'
import { RC_MAX_RANK } from '../core/ranks'
import { buildAlwaysDropConfiguration, DROP_TABLE_TOTAL_WEIGHT } from './rewardTargeting'

export const ENDLESS_DROP_RANK_SHIFT = 1
export const ENDLESS_DROP_VALUE_MULTIPLIER = 1.5
export const ENDLESS_COIN_ENERGY_SHARE = 0.8
export const ENDLESS_PRIORITY_TYPES = ['coins', 'energy']
export const ENDLESS_MIN_UNITS_PER_DROP = 1
// MERGE ENERGY MAY NEVER PAY FOR ITSELF. One merge energy is one free tap, and
// in endless every tap leads to merges that drop more merge energy. With 40%
// of 1.5x drops as merge energy that loop gave back MORE taps than it used:
// a player who reached endless never needed DR again and the rewards never
// stopped (found by playing a shared stage: 45 DR spent, 28,000 free taps,
// 44,000 merge energy and 4,300 puzzles collected - economist: "he ended up
// with crazy rewards from the small rewards"). So the merge energy in the
// endless drops is held to what pays back at most this share of the taps:
// 0.5 = for every 100 taps (paid or free) about 50 free taps come back, so
// 100 DR buys about 200 taps and no more. What is taken off the merge energy
// goes to coins, so a drop still carries 1.5x and is still mostly coins and
// merge energy. This app's own number, like the three above.
export const ENDLESS_ENERGY_PAYBACK_MAX = 0.5
// A merge always makes at least a rank 2, so the start rank never goes lower.
const LOWEST_MERGE_RESULT = 2

const unitsOf = (rank) => 2 ** (Math.min(rank, REWARD_MAX_RANK) - 1)
const zeroByType = () => Object.fromEntries(REWARD_TYPES.map((t) => [t, 0]))
const carriesTwister = (group) => group?.items?.[TWISTER_TYPE] != null
const tableTotal = (table) => (table?.noDropWeight ?? 0) + (table?.entries ?? []).reduce((s, e) => s + Math.max(0, e.weight), 0)

// What an average drop of these tables carries, per resource, in source
// units (a rank-r item is 2^(r-1) units) and in items - averaged over the
// ranks from `fromRank` up whose table can drop anything. `countGroup`
// selects which groups count.
// `rankWeight(rank)`: how much each rank's table counts (default: equally).
// The containers differ by rank now (more items at higher ranks), so "what a
// player's average drop holds" has to weight each rank by how often a merge
// makes it - see describeEndlessDrops.
export function averageDrop(dropGroupsConfig, dropGroups, fromRank, countGroup = () => true, rankWeight = () => 1) {
  const byId = new Map((dropGroups ?? []).map((g) => [g.id, g]))
  const units = zeroByType()
  const items = zeroByType()
  let tables = 0
  for (let rank = fromRank; rank <= RC_MAX_RANK; rank++) {
    const table = dropGroupsConfig?.[rank - 1]
    const total = tableTotal(table)
    if (!table || total <= 0) continue
    const weight = rankWeight(rank)
    tables += weight
    for (const entry of table.entries) {
      const group = byId.get(entry.groupId)
      if (!group || entry.weight <= 0 || !countGroup(group)) continue
      const p = (weight * entry.weight) / total
      for (const type of REWARD_TYPES) {
        const itemRank = group.items?.[type]
        if (itemRank == null) continue
        units[type] += p * unitsOf(itemRank)
        items[type] += p
      }
    }
  }
  if (tables > 0) {
    for (const type of REWARD_TYPES) {
      units[type] /= tables
      items[type] /= tables
    }
  }
  return { units, items }
}

// The endless drops, derived from the drops in force when rank 14 is
// reached. Returns { dropGroups, dropGroupsConfig, minDropRank } ready for
// the play engine, plus what they were derived from (for display).
// Merge energy paid back per DR of generator output by these drops: a DR of
// output is `targetEv` DR of item value, an item of rank r is worth 2^(r-1)
// DR and making one takes one merge, so a DR is about targetEv / 2^(r-1)
// merges that make rank r - each paying what that rank's table holds of
// merge energy, at the best a unit of it pays.
export function energyBackPerDr({ dropGroups = [], dropGroupsConfig = [], minDropRank = MIN_DROP_RANK }, rewardChainConfig, targetEv = DEFAULT_TARGET_EV) {
  const byId = new Map(dropGroups.map((g) => [g.id, g]))
  const unitValue = bestUnitValue(rewardChainConfig, 'energy')
  let back = 0
  for (let rank = minDropRank; rank <= RC_MAX_RANK; rank++) {
    const table = dropGroupsConfig?.[rank - 1]
    const total = tableTotal(table)
    if (!table || total <= 0) continue
    let units = 0
    for (const e of table.entries) {
      const itemRank = byId.get(e.groupId)?.items?.energy
      if (itemRank != null && e.weight > 0) units += (e.weight / total) * unitsOf(itemRank)
    }
    back += (targetEv / 2 ** (rank - 1)) * units * unitValue
  }
  return back
}

export function buildEndlessDrops({ dropGroups = [], dropGroupsConfig = [], minDropRank = MIN_DROP_RANK, rewardChainConfig = null, multiDropRank = null, tripleDropRank = null, soloRank = null, targetEv = DEFAULT_TARGET_EV } = {}) {
  const baseStartRank = minDropRank ?? MIN_DROP_RANK
  const startRank = Math.max(LOWEST_MERGE_RESULT, baseStartRank - ENDLESS_DROP_RANK_SHIFT)
  const groups = dropGroups ?? []
  const config = dropGroupsConfig ?? []

  // A Twister group made by hand keeps its own odds; everything else is
  // replaced by the endless buckets. Twister items the BUILD put into the
  // containers carry on the same way: as the filler of the endless buckets,
  // each carrying what it carried on average.
  const filled = (g) => carriesTwister(g) && !!g.auto
  const keptGroups = groups.filter((g) => carriesTwister(g) && !g.auto)
  const keptIds = new Set(keptGroups.map((g) => g.id))
  let twister = null
  if (groups.some(filled)) {
    const byId = new Map(groups.map((g) => [g.id, g]))
    let weight = 0
    let units = 0
    for (let rank = baseStartRank; rank <= RC_MAX_RANK; rank++) {
      for (const e of config[rank - 1]?.entries ?? []) {
        const g = byId.get(e.groupId)
        if (!filled(g) || !(e.weight > 0)) continue
        weight += e.weight
        units += e.weight * unitsOf(g.items[TWISTER_TYPE])
      }
    }
    twister = { minShare: TWISTER_FILL_MIN_SHARE, soloShare: TWISTER_SINGLE_ITEM_SHARE, itemUnits: weight > 0 ? units / weight : 1 }
  }

  const base = averageDrop(config, groups, baseStartRank, (g) => !carriesTwister(g) || !!g.auto)
  const payable = REWARD_TYPES.filter((t) => rewardPrizeAmount(rewardChainConfig, t, REWARD_MAX_RANK) > 0)
  const priority = ENDLESS_PRIORITY_TYPES.filter((t) => payable.includes(t))
  const others = payable.filter((t) => !priority.includes(t) && base.units[t] > 0)
  const baseTotal = REWARD_TYPES.reduce((s, t) => s + base.units[t], 0)
  const total = payable.length > 0 ? Math.max(baseTotal, ENDLESS_MIN_UNITS_PER_DROP) * ENDLESS_DROP_VALUE_MULTIPLIER : 0

  const unitsPerDrop = zeroByType()
  const priorityShare = priority.length === 0 ? 0 : others.length === 0 ? 1 : ENDLESS_COIN_ENERGY_SHARE
  // To three decimals: the base is measured off whole-number weights, and a
  // stray 1.0002 would otherwise ask for a rank-2 item on 0.02% of drops.
  const tidy = (v) => Math.round(v * 1000) / 1000
  for (const t of priority) unitsPerDrop[t] = tidy((total * priorityShare) / priority.length)
  const othersBase = others.reduce((s, t) => s + base.units[t], 0)
  for (const t of others) unitsPerDrop[t] = tidy(total * (1 - priorityShare) * (base.units[t] / othersBase))

  // One table per rank, holding only what is kept (Twister). The new lowest
  // rank had no drops before, so it takes the kept odds of the old lowest.
  const tables = Array.from({ length: RC_MAX_RANK }, (_, i) => {
    const rank = i + 1
    const source = rank >= startRank && rank < baseStartRank ? config[baseStartRank - 1] : config[i]
    const totalWeight = tableTotal(source)
    const entries = (source?.entries ?? [])
      .filter((e) => keptIds.has(e.groupId) && e.weight > 0 && totalWeight > 0)
      .map((e) => ({ groupId: e.groupId, weight: Math.round((e.weight / totalWeight) * DROP_TABLE_TOTAL_WEIGHT) }))
    return { rank, locked: false, entries, noDropWeight: DROP_TABLE_TOTAL_WEIGHT - entries.reduce((s, e) => s + e.weight, 0) }
  })

  // The "at least two items from rank N" rule carries on in endless as it is,
  // and the single-item rank moves down with the start rank (the first rank
  // that drops stays the single-item one).
  const make = () => buildAlwaysDropConfiguration({ unitsPerDrop, dropGroups: keptGroups, dropGroupsConfig: tables, minDropRank: startRank, multiDropRank, tripleDropRank, twister, soloRank: Number.isFinite(soloRank) ? soloRank - ENDLESS_DROP_RANK_SHIFT : null })
  let built = make()
  // Merge energy is held to what can never pay for itself
  // (ENDLESS_ENERGY_PAYBACK_MAX); what is taken off it goes to coins.
  const energyUnitsAsked = unitsPerDrop.energy
  const backOf = () => energyBackPerDr({ dropGroups: built.dropGroups, dropGroupsConfig: built.dropGroupsConfig, minDropRank: startRank }, rewardChainConfig, targetEv)
  for (let round = 0; round < 6 && unitsPerDrop.energy > 0; round++) {
    const back = backOf()
    if (!(back > ENDLESS_ENERGY_PAYBACK_MAX + 1e-6)) break
    const next = tidy(unitsPerDrop.energy * (ENDLESS_ENERGY_PAYBACK_MAX / back) * 0.98)
    const moved = unitsPerDrop.energy - next
    unitsPerDrop.energy = next
    // To coins; with no coin values, to the other rewards in the proportions
    // they already have (so a drop still carries what it should).
    const takers = payable.includes('coins') ? ['coins'] : others.filter((t) => unitsPerDrop[t] > 0)
    const takersTotal = takers.reduce((s, t) => s + unitsPerDrop[t], 0)
    for (const t of takers) unitsPerDrop[t] = tidy(unitsPerDrop[t] + (takersTotal > 0 ? (moved * unitsPerDrop[t]) / takersTotal : moved / takers.length))
    built = make()
  }
  const energyBack = backOf()
  // A container whose weight rounded to nothing can never drop: leave it out.
  const live = new Set(built.dropGroupsConfig.flatMap((t) => t.entries.filter((e) => e.weight > 0).map((e) => e.groupId)))
  return {
    dropGroups: built.dropGroups.filter((g) => live.has(g.id)),
    dropGroupsConfig: built.dropGroupsConfig,
    minDropRank: startRank,
    baseMinDropRank: baseStartRank,
    unitsPerDrop,
    // Merge energy back per 100 DR of generator output, and whether it was
    // held down to stay under the limit (what was asked before, in units).
    energyBackPer100Dr: energyBack * 100,
    energyHeld: unitsPerDrop.energy < energyUnitsAsked - 1e-9,
    energyUnitsAsked,
    targetEv,
    baseUnitsPerDrop: base.units,
    types: [...priority, ...others],
    hasDrops: priority.length + others.length > 0,
  }
}

// Endless mode as a DESIGN will play it, before anyone plays: derived from
// the Recompletion list's drops with the reward values Recompletion plays
// with (its own, or the normal list's where it has none - the same rule a
// session applies). This is what the Build event flow shows and what the
// endless sheets export, so they cannot disagree with a played session.
// Null when the design has no Recompletion list (then there is no endless).
export function endlessOfDesign(mainBoards, rcBoards) {
  const rc = rcBoards?.[0]
  if (!rc) return null
  const rewardChainConfig = rewardChainForNextPhase(mainBoards?.[0]?.rewardChainConfig ?? null, rc.rewardChainConfig ?? null)
  // (The lucky-drop EV a session plays Recompletion with - playSession.js.)
  const targetEv = rc.targetEv ?? DEFAULT_TARGET_EV
  const endless = buildEndlessDrops({ dropGroups: rc.dropGroups ?? [], dropGroupsConfig: rc.dropGroupsConfig ?? [], minDropRank: rc.minDropRank ?? undefined, rewardChainConfig, multiDropRank: multiDropRankOf(rc), tripleDropRank: tripleDropRankOf(rc), soloRank: soloDropRankOf(rc), targetEv })
  return { ...endless, rewardChainConfig, targetEv, builtFromDrops: (rc.dropGroups ?? []).length > 0 }
}

// What the endless drops come to, in the terms an economist reads:
//   perDrop[type]   { items, units, payout } an average drop
//   coinEnergyShare the share of dropped items that are coins or merge energy
//   mergesPer100Dr  merges that drop, per 100 DR of generator output (below)
//   energyPer100Dr  merge energy paid back per 100 DR of generator output
// A drop's payout assumes its items are merged up to rank 4 in the end, which
// is where endless play takes them (nothing is ever forfeited: it has no end).
//
// Merges per DR is an ESTIMATE, not a simulation: every DR of generator
// output is `targetEv` DR of item value (lucky drops are open in endless),
// an item of rank r is worth 2^(r-1) DR, and making one takes one merge - so
// a DR of output is about targetEv / 2^(r-1) merges that make rank r. One
// merge energy funds one x1 tap, so `energyPer100Dr` of 100 or more would
// mean endless play pays for itself - which buildEndlessDrops no longer lets
// happen (ENDLESS_ENERGY_PAYBACK_MAX).
export function describeEndlessDrops(endless, rewardChainConfig, { targetEv = 1 } = {}) {
  // An average over the drops a player gets: a merge that makes rank r
  // happens about half as often as one that makes rank r - 1.
  const { units, items } = averageDrop(endless.dropGroupsConfig, endless.dropGroups, endless.minDropRank, () => true, (rank) => 2 ** -(rank - 1))
  const perDrop = {}
  for (const type of REWARD_TYPES) {
    const unitValue = rewardPrizeAmount(rewardChainConfig, type, REWARD_MAX_RANK) / unitsOf(REWARD_MAX_RANK)
    perDrop[type] = { items: items[type], units: units[type], payout: units[type] * unitValue }
  }
  const allItems = REWARD_TYPES.reduce((s, t) => s + items[t], 0)
  const priorityItems = ENDLESS_PRIORITY_TYPES.reduce((s, t) => s + (items[t] ?? 0), 0)
  let mergesPerDr = 0
  for (let rank = endless.minDropRank; rank <= RC_MAX_RANK; rank++) mergesPerDr += targetEv / 2 ** (rank - 1)
  return {
    perDrop,
    itemsPerDrop: allItems,
    coinEnergyShare: allItems > 0 ? priorityItems / allItems : 0,
    mergesPer100Dr: mergesPerDr * 100,
    energyPer100Dr: energyBackPerDr(endless, rewardChainConfig, targetEv) * 100,
  }
}
