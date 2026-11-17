// Merge-drop groups (V2) - each RESULTING main-chain merge rank (1..14, see
// ranks.js/rewardChain.js for the 12-vs-14 split) has its own weighted table
// of drop groups. A group is a bundle of at most one item per reward
// resource type (coins/puzzles/energy/charms - rewardChain.js), dropping
// together as a joint outcome, plus an explicit "no drop" weight.
//
// A merge drop is a real reward ITEM, exactly like a tile-placed one: each
// item in the rolled group lands on a free board cell (or the inventory when
// the board is full) at its own reward rank, merges with ANY same-type
// same-rank reward item regardless of where that one came from, and pays out
// through the same merge-to-rank-4 / manual-collect lifecycle
// (mergeSimulation.js's performMerge). A rank-4 drop collects on the spot,
// since rank 4 never sits on the board. An earlier version credited drops
// straight to the collected balance instead - that was a stated modeling
// shortcut, and it was wrong for the economy: it made the two sources
// unable to combine (a tile rank-1 could never pair with a dropped rank-1),
// which forced each source to be rounded into whole rank-4 prizes on its
// own. Payout is now computed across the combined inventory.

import { ALL_REWARD_TYPES, REWARD_MAX_RANK } from './rewardChain'

// The most reward items one drop group may carry. Five resources can now
// appear in a group (the four small rewards plus Twister DR), but the cap
// stays at four items - the limit the configuration has always had - until a
// production schema is confirmed to carry more.
export const MAX_GROUP_ITEMS = 4

// Merge-drop groups only ever roll starting at this RESULTING main-chain
// rank - by explicit economist decision ("drops only start at rank 6 -
// ranks 2-5 never roll a drop at all, main-chain-only"). Enforced in the
// engine itself (mergeSimulation.js's performMerge), not just as a UI
// default/suggestion, so a misconfigured table at rank <6 can never
// accidentally fire - see MIN_DROP_RANK's own call site for why this is a
// hard gate, not a soft convention.
// From the merge that makes this rank, every drop holds two or more items;
// below it the chance of that rises rank by rank from the first dropping rank
// (rewardTargeting.js: buildAlwaysDropConfiguration). The economist asked for
// the behaviour; the rank it reaches 100% at is theirs to set, and 10 is this
// app's starting value.
export const DEFAULT_MULTI_DROP_RANK = 8
// From the merge that makes this rank, every drop holds THREE or more items;
// between the two-item rank and this one the chance of three rises rank by
// rank (by explicit economist request: "we should also add some containers
// with more than 2 resources. the really high merges should have a chance to
// give those and lets say rank 10 and 11 have to give more than 2"). 10 is
// the economist's number. The two-item rank is always at least one rank
// before it.
export const DEFAULT_TRIPLE_DROP_RANK = 10
export const tripleDropRankOf = (board) => board?.tripleDropRank ?? DEFAULT_TRIPLE_DROP_RANK
export const multiDropRankOf = (board) => Math.min(board?.multiDropRank ?? DEFAULT_MULTI_DROP_RANK, tripleDropRankOf(board) - 1)

// When the build puts the Twister item into the containers (board.
// twisterByBuild), it is in at least this share of the drops at every rank
// (more when the twists asked need more - smallRewardsWorkflow.js). This
// app's own number.
export const TWISTER_FILL_MIN_SHARE = 0.8

export const DEFAULT_MIN_DROP_RANK = 6
export const MIN_DROP_RANK = DEFAULT_MIN_DROP_RANK

// id is a stable string the economist can reuse across multiple ranks'
// weight tables ("shareable across ranks where useful, while supporting
// per-rank differences" - the weight lives per-rank, the group's own
// contents are defined once and referenced by id).
export function createDropGroup({ id, name = '', items = {} } = {}) {
  // items: { [rewardType]: rank } - at most one entry per ALL_REWARD_TYPES
  // member (so at most one Twister item, by construction), each naming which
  // rank of that resource drops. Absent type = not included in this group.
  return { id, name, items: { ...items } }
}

export function groupResourceCount(group) {
  return ALL_REWARD_TYPES.filter((t) => group.items[t] != null).length
}

export function validateDropGroup(group) {
  const findings = []
  const label = group.name || group.id
  const count = groupResourceCount(group)
  if (count < 1 || count > MAX_GROUP_ITEMS) {
    findings.push(`Group "${label}" must include 1-${MAX_GROUP_ITEMS} reward items (has ${count}).`)
  }
  for (const [type, rank] of Object.entries(group.items ?? {})) {
    if (rank == null) continue
    if (!ALL_REWARD_TYPES.includes(type)) findings.push(`Group "${label}" names an unknown resource "${type}".`)
    else if (!(rank >= 1 && rank <= REWARD_MAX_RANK)) findings.push(`Group "${label}" has an invalid rank ${rank} for ${type}.`)
  }
  return findings
}

// One weighted table for one resulting main-chain rank: a list of
// {groupId, weight} entries plus an explicit noDropWeight. Weights don't
// need to be pre-normalized by the economist - rollDrop below normalizes
// at roll time - but normalization is surfaced to the UI so an obviously
// mis-entered table (e.g. every weight 0) is visible rather than silently
// always rolling "no drop".
export function createRankDropTable(rank) {
  // `locked` (V2 section 9): when true, rewardTargeting.js's solver treats
  // this rank's own table as a fixed input - "respect locked inputs," the
  // economist's own per-rank opt-out of the automatic weight search.
  return { rank, noDropWeight: 100, entries: [], locked: false }
}

export function createDropGroupsConfig(maxRank) {
  return Array.from({ length: maxRank }, (_, i) => createRankDropTable(i + 1))
}

export function validateDropGroupsConfig(config, groupsById, { minDropRank: minDropRankOpt } = {}) {
  const effectiveMinDropRank = minDropRankOpt ?? MIN_DROP_RANK
  const findings = []
  for (const table of config) {
    // Ranks below the configured minDropRank are INTENTIONALLY dead (the
    // engine hard-gates them), so a zero-weight table there isn't a
    // misconfiguration to flag. Entries configured there anyway still get
    // their own reference/negative-weight checks below.
    if (table.rank >= effectiveMinDropRank) {
      const totalWeight = table.noDropWeight + table.entries.reduce((s, e) => s + e.weight, 0)
      if (totalWeight <= 0) {
        findings.push(`Rank ${table.rank}'s drop table has zero total weight - it can never resolve to anything.`)
      }
      // (No "every rank must cover all four resources" finding any more: a
      // resource with no target needs no drops at all, and the generator
      // only creates groups for what is actually targeted.)
    }
    for (const entry of table.entries) {
      if (!groupsById.has(entry.groupId)) {
        findings.push(`Rank ${table.rank} references unknown drop group "${entry.groupId}".`)
      }
      if (entry.weight < 0) {
        findings.push(`Rank ${table.rank}'s group "${entry.groupId}" has a negative weight.`)
      }
    }
  }
  return findings
}

// Weighted roll over one rank's table. `rng` defaults to Math.random but
// accepts a seeded generator (seedable PRNG convention this app already
// uses nowhere explicitly, but matches "use SEEDED stochastic simulation"
// from the spec - callers doing multi-run validation should pass a seeded
// rng here). Returns null for "no drop", or the resolved group's `items`
// map (resourceType -> rank) on a hit.
export function rollDrop(table, groupsById, rng = Math.random) {
  if (!table || table.entries.length === 0) return null
  const totalWeight = table.noDropWeight + table.entries.reduce((s, e) => s + e.weight, 0)
  if (totalWeight <= 0) return null
  let roll = rng() * totalWeight
  if (roll < table.noDropWeight) return null
  roll -= table.noDropWeight
  for (const entry of table.entries) {
    if (roll < entry.weight) {
      const group = groupsById.get(entry.groupId)
      return group ? group.items : null
    }
    roll -= entry.weight
  }
  return null
}

// Deterministic counterpart to rollDrop - the same shape luckyDrop.js's
// createEvScheduler gives the generator's lucky drops: a deficit round-robin
// per rank table, so over n rolls of one table each outcome fires within one
// of n x its probability, with no randomness at all. This is what
// `dropMode: 'expected'` runs on now that a merge drop is a real reward ITEM
// on the board (it merges with tile-placed items, so a fractional "expected
// amount" has nothing to merge with) - the prediction is an actual,
// reproducible playthrough rather than probability-weighted arithmetic.
// Credits start at 0.5 so each outcome rounds to nearest rather than always
// trailing its expectation. One scheduler per run; tables are keyed by their
// own rank, so the main and RC phases' tables never share a deficit.
export function createDropScheduler() {
  const creditsByKey = new Map()
  return function next(table, groupsById, key = table?.rank) {
    if (!table || table.entries.length === 0) return null
    const weights = [table.noDropWeight, ...table.entries.map((e) => (groupsById.has(e.groupId) ? e.weight : 0))].map((w) => Math.max(0, w))
    const total = weights.reduce((s, w) => s + w, 0)
    if (total <= 0) return null
    let credits = creditsByKey.get(key)
    if (!credits || credits.length !== weights.length) {
      credits = weights.map(() => 0.5)
      creditsByKey.set(key, credits)
    }
    let pick = 0
    for (let i = 0; i < weights.length; i++) {
      credits[i] += weights[i] / total
      if (credits[i] > credits[pick]) pick = i
    }
    credits[pick] -= 1
    if (pick === 0) return null
    return groupsById.get(table.entries[pick - 1].groupId)?.items ?? null
  }
}
