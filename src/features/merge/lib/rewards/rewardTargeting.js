// Drop-configuration GENERATOR (V2) - builds drop-group contents and their
// per-rank weights together, so the Small Rewards workflow needs nothing
// from the economist beyond valid reward definitions. (It replaces an
// earlier search that could only nudge the weights of groups someone had
// already authored by hand.)
//
// The sizing is direct rather than a blind search, because the quantity
// that matters has a closed form: a group dropping a rank-r item of some
// resource delivers 2^(r-1) source units of it per hit, so over M eligible
// merges a per-merge probability p delivers M x p x 2^(r-1) expected units.
// Given how many units each resource still needs from drops, the generator
// picks item ranks and probabilities to match - and the caller
// (smallRewardsWorkflow.js) then scores the result on real seeded
// simulation and refines. Two candidate STRUCTURES are offered, and the
// workflow keeps whichever simulates closer (fewer groups on a tie):
//   'separate' - one single-resource group per resource.
//   'bundle'   - one group carrying every needed resource together (their
//                ranks chosen so the bundle's hit rate fits all of them),
//                plus single-resource top-ups for whatever the bundle's
//                shared hit rate leaves short.
//
// What it never touches: a group without `auto: true` (hand-authored, or a
// generated one the economist chose to lock) keeps its contents AND its
// current odds in every table; a table whose rank is `locked` is left
// exactly as it is; and ranks below the configured minDropRank are never
// given entries (the engine would ignore them anyway).
import { REWARD_TYPES, ALL_REWARD_TYPES, REWARD_TYPE_LABELS, REWARD_MAX_RANK, TWISTER_TYPE } from './rewardChain'
import { MIN_DROP_RANK, MAX_GROUP_ITEMS, TWISTER_FIRST_DROP_RANK, TWISTER_PAIR_RANK } from './dropGroups'
import { RC_MAX_RANK } from '../core/ranks'

// Tables are written with this total weight, so a weight reads directly as
// "out of 1000" - the same convention the Generator Weights sheet uses.
export const DROP_TABLE_TOTAL_WEIGHT = 1000
// One generated group never claims more than this share of a rank's rolls,
// and the generated groups together leave at least a sliver of no-drop.
const PER_GROUP_PROBABILITY_CAP = 0.5
const TOTAL_PROBABILITY_HEADROOM = 0.98

const unitsOf = (rank) => 2 ** (Math.min(rank, REWARD_MAX_RANK) - 1)
// The biggest reward item a drop holds when rewards are put into fewer drops.
const SQUEEZED_TOP_RANK = REWARD_MAX_RANK - 1
// Tallies cover every reward item type so a kept group that carries Twister
// DR is counted cleanly. The generator SIZES the four source-allocated
// resources (REWARD_TYPES); a Twister item has no target and is only ever
// added by buildAlwaysDropConfiguration's `twister` option, as a filler.
const zeroByType = () => Object.fromEntries(ALL_REWARD_TYPES.map((t) => [t, 0]))

function tableTotal(table) {
  return (table?.noDropWeight ?? 0) + (table?.entries ?? []).reduce((s, e) => s + Math.max(0, e.weight), 0)
}

// Which ranks' tables the generator may write: eligible (>= minDropRank),
// present, and not locked by the economist.
export function writableDropRanks(dropGroupsConfig, minDropRank = MIN_DROP_RANK) {
  const ranks = []
  for (let rank = minDropRank; rank <= RC_MAX_RANK; rank++) {
    const table = dropGroupsConfig?.[rank - 1]
    if (table && !table.locked) ranks.push(rank)
  }
  return ranks
}

// Expected source units per resource that a set of tables delivers over a
// phase, given how many merges land on each resulting rank. `groupFilter`
// selects which groups count (e.g. only the hand-authored ones).
export function expectedDropUnits(dropGroupsConfig, dropGroups, mergesByRank, minDropRank = MIN_DROP_RANK, groupFilter = () => true) {
  const groupsById = new Map((dropGroups ?? []).map((g) => [g.id, g]))
  const units = zeroByType()
  for (let rank = minDropRank; rank <= RC_MAX_RANK; rank++) {
    const table = dropGroupsConfig?.[rank - 1]
    const merges = mergesByRank?.[rank] ?? 0
    const total = tableTotal(table)
    if (!table || merges <= 0 || total <= 0) continue
    for (const entry of table.entries) {
      const group = groupsById.get(entry.groupId)
      if (!group || !groupFilter(group) || entry.weight <= 0) continue
      const p = entry.weight / total
      for (const [type, itemRank] of Object.entries(group.items)) units[type] += merges * p * unitsOf(itemRank)
    }
  }
  return units
}

function groupName(items) {
  const parts = ALL_REWARD_TYPES.filter((t) => items[t] != null).map((t) => `${REWARD_TYPE_LABELS[t]} R${items[t]}`)
  return `${parts.length > 1 ? 'Auto bundle' : 'Auto'}: ${parts.join(' + ')}`
}

function groupId(items) {
  return `auto-${ALL_REWARD_TYPES.filter((t) => items[t] != null)
    .map((t) => `${t}${items[t]}`)
    .join('-')}`
}

// A Twister item that carries `itemUnits` source units on average: one rank,
// or two neighbouring ranks mixed (`higher` = the share at rank + 1).
function twisterRankMix(itemUnits) {
  const units = Math.max(1, Math.min(unitsOf(REWARD_MAX_RANK), Number.isFinite(itemUnits) ? itemUnits : 1))
  const rank = Math.min(REWARD_MAX_RANK, Math.floor(Math.log2(units) + 1e-9) + 1)
  const higher = rank >= REWARD_MAX_RANK ? 0 : Math.min(1, Math.max(0, units / unitsOf(rank) - 1))
  return { rank, higher: higher < 1e-6 ? 0 : higher }
}

// Sizes single-resource groups for `need` (units per resource) against
// `merges` eligible merges and `mass` available probability: starts every
// resource at rank 1 (the finest-grained, lowest-variance choice) and raises
// the rank of whichever resource is asking for the most rolls until the set
// fits. Returns [{items, p}] plus any units that genuinely can't be
// delivered even at the top rank.
function sizeSeparate(need, merges, mass) {
  const types = REWARD_TYPES.filter((t) => need[t] > 0)
  const rank = Object.fromEntries(types.map((t) => [t, 1]))
  const prob = (t) => need[t] / (merges * unitsOf(rank[t]))
  for (let guard = 0; guard < 16; guard++) {
    const total = types.reduce((s, t) => s + prob(t), 0)
    const worst = [...types].sort((a, b) => prob(b) - prob(a))[0]
    if (!worst) break
    const fits = total <= mass && prob(worst) <= PER_GROUP_PROBABILITY_CAP
    if (fits) break
    const raisable = [...types].filter((t) => rank[t] < REWARD_MAX_RANK).sort((a, b) => prob(b) - prob(a))[0]
    if (!raisable) break
    rank[raisable] += 1
  }
  let scale = 1
  const total = types.reduce((s, t) => s + prob(t), 0)
  if (total > mass && total > 0) scale = mass / total
  const short = zeroByType()
  const groups = types.map((t) => {
    const p = Math.min(PER_GROUP_PROBABILITY_CAP, prob(t) * scale)
    short[t] = Math.max(0, need[t] - p * merges * unitsOf(rank[t]))
    return { items: { [t]: rank[t] }, p }
  })
  return { groups, short }
}

// One bundle group covering every needed resource, plus top-ups. Ranks are
// chosen so each resource's units-per-hit is proportional to how much of it
// is needed (nearest power of two), which lets one shared hit rate serve
// them all; the bundle's rate is the largest one no resource overshoots at.
function sizeBundle(need, merges, mass) {
  const types = REWARD_TYPES.filter((t) => need[t] > 0)
  if (types.length < 2) return sizeSeparate(need, merges, mass)
  const least = Math.min(...types.map((t) => need[t]))
  const rank = Object.fromEntries(types.map((t) => [t, Math.min(REWARD_MAX_RANK, Math.max(1, 1 + Math.round(Math.log2(need[t] / least))))]))
  const rate = () => Math.min(...types.map((t) => need[t] / (merges * unitsOf(rank[t]))))
  for (let guard = 0; guard < 4 && rate() > Math.min(mass, PER_GROUP_PROBABILITY_CAP) && types.every((t) => rank[t] < REWARD_MAX_RANK); guard++) {
    for (const t of types) rank[t] += 1
  }
  const p = Math.min(rate(), mass, PER_GROUP_PROBABILITY_CAP)
  const rest = zeroByType()
  for (const t of types) rest[t] = Math.max(0, need[t] - p * merges * unitsOf(rank[t]))
  // Top up only what is meaningfully short - a fraction of a unit is noise.
  for (const t of types) if (rest[t] < 0.5) rest[t] = 0
  const topUps = sizeSeparate(rest, merges, Math.max(0, mass - p))
  return { groups: [{ items: { ...rank }, p }, ...topUps.groups.filter((g) => g.p > 0)], short: topUps.short }
}

// EVERY ELIGIBLE MERGE DROPS - by explicit economist rule ("i want that the
// rule for when we start getting small rewards will always give us drops";
// asked, and confirmed as "every eligible merge drops"; "we have buckets of
// drops, each can drop several items and in different ranks").
//
// From the start rank up, a merge always drops exactly one BUCKET - there is
// no "nothing" outcome. What is tuned is therefore not a chance but:
//   - the START RANK is the economist's own "merge drops start at rank",
//     exactly: with 6, the merge that MAKES a rank 6 (two rank 5s) is the
//     first one that drops, and every merge above it drops too. It is never
//     moved. (A first version started later when rank 6 would have paid more
//     than was wanted, so 5 + 5 -> 6 dropped nothing - reported by the
//     economist as wrong: "when i say rank6 drops, i mean the merge that
//     will give a merge 6 will drop".) When that many drops pay more than is
//     wanted of them, the caller takes rewards out from under the tiles
//     instead (smallRewardsWorkflow.js) - `deliverableUnits` says what the
//     drops will really deliver;
//   - WHAT IS IN THE BUCKETS: each resource appears in the share of drops,
//     and at the rank(s), that deliver its units. A resource that needs less
//     than one unit per drop is in only some buckets; one that needs more is
//     in every bucket at a higher rank (two neighbouring ranks mixed to land
//     on the amount). Laying those shares end to end over the drops is what
//     makes the buckets: each carries one to four items, in different ranks.
// Kept (hand-authored or locked) groups keep their odds; the buckets fill
// what is left of each table. Tables below the start rank get no bucket.
//
// `multiDropRank` - how often a drop holds SEVERAL items, by merge rank (by
// explicit economist request: "a container can hold more than 1 resource ...
// i want to see containers with more than 1 item, and sometimes we will get
// them. as the merge in a higher rank the % of a multi item drop will go
// higher and from a specific rank it will be 100% more than 1").
// The share of drops that hold two or more items rises in equal steps from
// the first dropping rank and is 100% from `multiDropRank` (drops from rank
// 6, 100% from rank 10: 20%, 40%, 60%, 80%, then 100%). Each rank gets its
// own buckets, made the same way, with the resources' shares stretched until
// that much of the line is covered twice - laid end to end, a line covered
// 1.4 times is covered twice on exactly 40% of it. Where the targets already
// make more multi-item drops than the ramp asks, they are left alone.
// It takes two resources that drop; with only one, a bucket cannot hold two
// different items and `multiDropShort` is returned true. The extra items are
// extra payout - `deliverableUnits` counts it, so the caller's sizing sees it.
// (A first version switched from the plain buckets to "all two or more" at
// the rank, with no rise before it.)
//
// `twister` ({ minShare, itemUnits }) - the Twister item, put into the
// buckets BY THE BUILD (by explicit economist request: "we can let the user
// get a lot more drops of the twister ... it can make the economy for u
// easier with the multiplied drops from merges"). A Twister item has no
// payout target - the price of a twist is set afterwards from what a player
// collects - so it is the one item that can be added freely. It is used as
// the FILLER:
//   - a drop that would hold nothing (the rewards together want less than one
//     item per merge) holds a Twister item, instead of the rewards being
//     stretched over every drop and paid more than asked;
//   - the second item of a multi-item container is the Twister item, instead
//     of an extra reward item.
// So with it the rewards stay at exactly the shares their amounts ask for,
// and only when the Twister item is already in every drop of a rank and the
// rise still asks for more are the rewards stretched. It is in at least
// `minShare` of the drops at every rank. `itemUnits` is what one Twister
// item carries on average (1 = rank 1; 3 = ranks 2 and 3 mixed) - see
// resizeTwisterDrops. A Twister rule written by hand (`twisterRule` groups)
// is replaced; any other hand-made group that carries a Twister item is kept.
//
// `steady` - STEADY CONTAINERS: every merge of a rank drops the SAME items.
// Economist: "we need to make sure we will know that the resources the user
// gets will be some what close to what we wanted him to get". Measured with
// 300 simulated players (and a robot on the real play engine, which agrees
// with the simulator to 1-2%): the AVERAGES were right, but one player was
// not near them. Each merge rolled one of 5 to 8 containers, a reward sat in
// only some of them, and it got 15 to 40 items a phase - so a single player's
// puzzles moved by 17%, merge energy by 32%, and (merge energy being free
// taps) the DR they spent by 23%. Only 4 players in 10 landed within 15% of
// the merge energy asked.
// With steady containers nothing about WHICH reward drops is left to chance:
//   - the first dropping rank (one item): always a rank-1 item of the reward
//     under the tiles (it used to be 60% of them);
//   - a rank that drops one or two items: one reward in every drop, and the
//     Twister item as the second one in the share the rise gives;
//   - a two-item rank: one reward and the Twister item in every drop (two
//     rewards when the build does not place the Twister);
//   - a three-item rank: three rewards in every drop (the Twister item or the
//     filler where there are fewer rewards).
// Which reward sits where: the one with the least so far, merge energy first
// (it decides how much is played). How big an item is: one rank per reward
// and merge rank, chosen so the reward's units come to what was asked. The
// same prototype put 98-99% of players within 15% on puzzles, merge energy
// and charms, and brought the DR spread from 23% to about 10%.
// What it takes: the amounts are no longer steered by how OFTEN a reward
// drops - so it is only used when every reward's rank values are the model's
// to give (they land each segment on its amount). Otherwise, with a group or
// table kept by hand, or with too few different rewards to fill a rank, the
// containers are made as before. This app's own design, switched off in step
// 4 ("Every merge of a rank drops the same items").
export function buildAlwaysDropConfiguration({ dropUnits, unitsPerDrop = null, mergesByRank, dropGroups = [], dropGroupsConfig = [], minDropRank = MIN_DROP_RANK, multiDropRank = null, tripleDropRank = null, guaranteedTypes = null, twister = null, maxItems = null, soloRank = null, focus = null, steady = false } = {}) {
  // SINGLE-ITEM RANKS - see the block further down. `soloRank`: merges that
  // make this rank or a lower one drop ONE item; every higher rank keeps the
  // containers with several items. `maxItems: 1`: every rank does.
  const soloTop = maxItems === 1 ? Infinity : Number.isFinite(soloRank) ? soloRank : null
  const isSolo = (rank) => soloTop != null && rank <= soloTop
  // The reward whose items fill what the others leave at the single-item
  // ranks: coins whose values the build sets, so how many coin items drop is
  // free and their value does the rest.
  const elasticType = soloTop != null && focus?.elastic && REWARD_TYPES.includes(focus.type) ? focus.type : null
  const twisterOn = !!twister
  const twisterMin = twisterOn ? Math.min(1, Math.max(0, twister.minShare ?? 0)) : 0
  const twisterMix = twisterRankMix(twister?.itemUnits ?? 1)
  const writableRanks = writableDropRanks(dropGroupsConfig, minDropRank)
  const lockedRefs = new Set()
  dropGroupsConfig.forEach((table) => {
    if (table?.locked) for (const e of table.entries) lockedRefs.add(e.groupId)
  })
  const keptGroups = dropGroups.filter((g) => (!g.auto && !(twisterOn && g.twisterRule)) || lockedRefs.has(g.id))
  const keptIds = new Set(keptGroups.map((g) => g.id))
  const keptMass = (rank) => {
    const table = dropGroupsConfig[rank - 1]
    const total = tableTotal(table)
    if (total <= 0) return 0
    return table.entries.filter((e) => keptIds.has(e.groupId)).reduce((s, e) => s + Math.max(0, e.weight), 0) / total
  }

  // `unitsPerDrop` (endless mode): what one drop carries on average, given
  // directly. The buckets are then sized per drop, with no phase total and
  // no merge prediction behind them.
  const perDropGiven = unitsPerDrop != null
  // What is asked of the drops in all (`need0`); further down, `need` is what
  // is left for the ranks whose containers hold several items.
  const need0 = zeroByType()
  for (const t of REWARD_TYPES) need0[t] = Math.max(0, (perDropGiven ? unitsPerDrop[t] : dropUnits?.[t]) ?? 0)
  const types0 = REWARD_TYPES.filter((t) => need0[t] > 0)
  const wanted0 = types0.reduce((s, t) => s + need0[t], 0)

  // Drops available from a start rank: its merges and every later rank's,
  // less the share kept groups already take.
  const slotsAt = (rank) => (mergesByRank?.[rank] ?? 0) * Math.max(0, 1 - keptMass(rank))
  const slotsFrom = (start) => writableRanks.filter((r) => r >= start).reduce((s, r) => s + slotsAt(r), 0)
  const withMerges = writableRanks.filter((r) => slotsAt(r) > 0)
  const startRank = (wanted0 > 0 || twisterOn || elasticType) && writableRanks.length > 0 ? writableRanks[0] : null
  const short = zeroByType()
  const uniqueId = (base) => {
    let id = base
    for (let n = 2; keptIds.has(id); n++) id = `${base}-${n}`
    return id
  }
  const asGroups = (buckets) => buckets.map((bucket) => ({ id: uniqueId(groupId(bucket.items)), name: groupName(bucket.items), items: bucket.items, auto: true, p: bucket.p }))
  // Which of the dropping ranks are single-item, and which hold several.
  const ranksFromStart = startRank == null ? [] : writableRanks.filter((r) => r >= startRank)
  const soloRanks = ranksFromStart.filter(isSolo)
  const multiRanks = ranksFromStart.filter((r) => !isSolo(r))
  const allSolo = soloRanks.length > 0 && multiRanks.length === 0
  const soloDelivered = zeroByType()
  let soloStretched = false
  // THE SINGLE-ITEM RANKS - by explicit economist rule: the merges that make
  // a rank 6 drop ONE item, and every rank above keeps the containers with
  // several items ("i wanted that only rank6 will be a solo reward drops. the
  // others should act like befor. with tier of when 2 items and when 3
  // items"). A first version made EVERY rank single-item - a misreading of
  // "we need a rule for max of 1 drop from a merge"; that is still what
  // `maxItems: 1` does, and nothing in the app asks for it by default.
  // At a single-item rank each container is one item, and the rank's drops
  // are shared out between the rewards (and the Twister item):
  //   - `focus` ({ type, share, elastic }): at the FIRST dropping rank the
  //     focus reward - the one that sits under the tiles - takes `share` of
  //     the drops as rank-1 items, the item that opens a reward under a tile
  //     ("lets make the rank 6 merges focus on the blocked tiles of the small
  //     rewards on the board"). A reward with a typed target takes only as
  //     much as its target allows. With `elastic` (coins whose values the
  //     build sets) it also fills every drop the other rewards leave empty,
  //     at every rank - so there is no "one item per merge is too much"
  //     floor: more coin items just means a smaller coin value.
  //   - the other rewards share what is left of the rank's drops in
  //     proportion to what they need, as RANK-1 items. With ranks above that
  //     hold several items, a single-item rank only carries its own part of
  //     each reward (its share of all the drops), never bigger items: what
  //     that leaves is carried by the ranks above, and `need` below is that
  //     remainder. Only when EVERY rank is single-item do the items get
  //     bigger (from the top merge rank downward, rank 3 at most) and can the
  //     amounts come out short.
  //   - a drop nobody needs holds the elastic reward, else the Twister item,
  //     else the rewards are stretched over it and pay more than asked
  //     (`floorExceedsWanted`, as before).
  //   - the Twister item is `twister.soloShare` (else `minShare`) of a
  //     single-item rank's drops.
  let singleFocus = null
  // When the rewards do not fit into one item per merge: the highest start
  // rank from which they would (null: none does, or they fit).
  let singleLowerStartRank = null
  const singleLayouts = new Map() // merge rank -> its single-item buckets
  if (soloRanks.length > 0) {
    // Bigger items only where no rank above can carry the rest.
    const top = allSolo || perDropGiven ? unitsOf(SQUEEZED_TOP_RANK) : 1
    const predicted = !perDropGiven && soloRanks.some((r) => slotsAt(r) > 0)
    // With no prediction (or sizing per drop) there is one layout for all.
    const planRanks = predicted ? soloRanks.filter((r) => slotsAt(r) > 0) : [soloRanks[0]]
    const slots = (r) => (predicted ? slotsAt(r) : perDropGiven ? 1 : Math.max(1, wanted0))
    const twShare = twisterOn ? Math.min(1, Math.max(0, twister.soloShare ?? twisterMin)) : 0
    const focusType = focus?.type && (types0.includes(focus.type) || elasticType === focus.type) && !perDropGiven ? focus.type : null
    const focusRank = planRanks[0]
    // These ranks' own part of each reward: all of it when every rank is
    // single-item, else their share of all the drops.
    const allSlots = slotsFrom(startRank)
    const part = allSolo || perDropGiven || !predicted || !(allSlots > 0) ? 1 : Math.min(1, planRanks.reduce((sum, r) => sum + slotsAt(r), 0) / allSlots)
    const left = Object.fromEntries(Object.entries(need0).map(([t, v]) => [t, v * part]))
    if (elasticType) left[elasticType] = 0
    let focusShare = 0
    if (focusType) {
      const most = Math.min(Math.max(0, focus.share ?? 0), 1 - twShare)
      // The reward under the tiles is concentrated here: it may take its
      // share of this rank's drops out of its WHOLE amount, not only this
      // rank's part of it. With ranks above, that is all it takes here.
      focusShare = elasticType === focusType ? most : Math.min(most, slots(focusRank) > 0 ? need0[focusType] / slots(focusRank) : 0)
      if (elasticType !== focusType) left[focusType] = allSolo ? Math.max(0, need0[focusType] - focusShare * slots(focusRank)) : 0
    }
    // The part of a rank's drops open to the rewards that are being placed.
    const lineOf = (r) => Math.max(0, 1 - twShare - (r === focusRank ? focusShare : 0))
    const capOf = (r) => slots(r) * lineOf(r)
    const capTotal = planRanks.reduce((sum, r) => sum + capOf(r), 0)
    // With ranks above: drops these ranks' own part leaves empty are filled
    // with more of the same rewards (out of their whole amounts - the ranks
    // above then carry that much less), before anything else fills them.
    if (part < 1) {
      const own = REWARD_TYPES.reduce((sum, t) => sum + left[t], 0)
      const whole = REWARD_TYPES.reduce((sum, t) => sum + (left[t] > 0 ? need0[t] : 0), 0)
      if (own > 1e-9 && own < capTotal) {
        const scale = Math.min(whole, capTotal) / own
        for (const t of REWARD_TYPES) left[t] = Math.min(need0[t], left[t] * scale)
      }
    }
    const placing = REWARD_TYPES.filter((t) => left[t] > 1e-9)
    const total = placing.reduce((sum, t) => sum + left[t], 0)
    // As rank-1 items the rewards take this share of the open line...
    const used = capTotal > 0 ? Math.min(1, total / capTotal) : 0
    // ...and what does not fit makes the items bigger, top merge rank first.
    const level = new Map(planRanks.map((r) => [r, 1]))
    let deficit = Math.max(0, total - capTotal)
    for (const r of [...planRanks].reverse()) {
      if (!(deficit > 1e-9)) break
      const add = Math.min(deficit, capOf(r) * (top - 1))
      if (capOf(r) > 0) level.set(r, 1 + add / capOf(r))
      deficit -= add
    }
    if (allSolo && deficit > 1e-9 && total > 0) for (const t of placing) short[t] = (deficit * left[t]) / total
    if (allSolo && deficit > 0.5 && predicted) {
      singleLowerStartRank = singleItemStartRankThatFits({ needUnits: total, mergesByRank, startRank, twisterShare: twShare, focusShare: focusType ? Math.min(Math.max(0, focus.share ?? 0), 1 - twShare) : 0 })
    }

    for (const r of planRanks) {
      const byKey = new Map()
      const add = (type, rank, p) => {
        if (!(p > 1e-9)) return
        const items = { [type]: rank }
        const key = groupId(items)
        byKey.set(key, { items, p: (byKey.get(key)?.p ?? 0) + p })
      }
      const line = lineOf(r)
      const units = level.get(r)
      const low = Math.min(SQUEEZED_TOP_RANK, Math.floor(Math.log2(units) + 1e-9) + 1)
      const higher = low >= SQUEEZED_TOP_RANK ? 0 : Math.min(1, Math.max(0, units / unitsOf(low) - 1))
      const shares = Object.fromEntries(placing.map((t) => [t, total > 0 ? line * used * (left[t] / total) : 0]))
      const rewardsShare = placing.reduce((sum, t) => sum + shares[t], 0)
      const spare = Math.max(0, line - rewardsShare)
      let focusHere = r === focusRank ? focusShare : 0
      let twisterShare = twShare
      let stretch = 1
      if (spare > 1e-9) {
        if (elasticType) focusHere += spare
        else if (twisterOn) twisterShare += spare
        else if (rewardsShare + focusHere > 1e-9) {
          stretch = (rewardsShare + focusHere + spare) / (rewardsShare + focusHere)
          if (spare > 0.02) soloStretched = true
        }
      }
      if (focusType ?? elasticType) add(focusType ?? elasticType, 1, focusHere * stretch)
      for (const t of placing) {
        add(t, low, shares[t] * stretch * (1 - higher))
        add(t, low + 1, shares[t] * stretch * higher)
      }
      if (twisterShare > 1e-9) {
        const lower = twisterShare * (1 - twisterMix.higher)
        add(TWISTER_TYPE, twisterMix.rank, lower)
        add(TWISTER_TYPE, twisterMix.rank + 1, twisterShare - lower)
      }
      const sum = [...byKey.values()].reduce((acc, b) => acc + b.p, 0)
      const set = asGroups([...byKey.values()].map((b) => ({ items: b.items, p: sum > 0 ? b.p / sum : 0 })))
      singleLayouts.set(r, set)
      // What this rank's single items deliver, taken off what the ranks above have to carry.
      if (predicted) for (const g of set) for (const [type, itemRank] of Object.entries(g.items)) soloDelivered[type] = (soloDelivered[type] ?? 0) + slotsAt(r) * g.p * unitsOf(itemRank)
    }
    if (focusType) {
      const first = singleLayouts.get(focusRank) ?? []
      singleFocus = { type: focusType, rank: focusRank, share: first.filter((g) => g.items[focusType] != null).reduce((sum, g) => sum + g.p, 0), elastic: elasticType === focusType }
    }
  }
  // A rank with no layout of its own (no merges predicted there) uses the
  // nearest planned rank below it, else the first one.
  const singleSetFor = (rank) => {
    if (singleLayouts.has(rank)) return singleLayouts.get(rank)
    const planned = [...singleLayouts.keys()].sort((x, y) => x - y)
    const below = planned.filter((r) => r < rank)
    return singleLayouts.get(below.length > 0 ? below[below.length - 1] : planned[0]) ?? []
  }


  // What is left for the ranks whose containers hold several items. (Coins
  // the build values are not counted off: how many coin items drop is free.)
  const mixed = soloRanks.length > 0 && !allSolo && !perDropGiven
  const need = zeroByType()
  // (Every merge above still drops, so a little of each reward - 2% of what
  // was asked - is always left for those ranks, even when the single-item
  // rank alone already delivers everything.)
  for (const t of REWARD_TYPES) need[t] = !mixed ? need0[t] : t === elasticType ? 0 : Math.max(need0[t] * 0.02, need0[t] - soloDelivered[t])
  // COINS THE BUILD VALUES ARE THE FILLER ABOVE THE SINGLE-ITEM RANKS. With
  // the item counts hard, a drop's two or three places are scarce, and a coin
  // item is the one item whose amount does not matter (its value is sized
  // afterwards). So above the single-item rank coins ask for nothing; they
  // take a place only where the other rewards leave one empty - which is also
  // what makes the third item at rank 10+ when only two other rewards drop.
  const filler = mixed && elasticType ? elasticType : null
  const types = REWARD_TYPES.filter((t) => need[t] > 1e-9)
  const wanted = types.reduce((sum, t) => sum + need[t], 0)
  const allDrops = startRank == null ? 0 : perDropGiven ? 1 : slotsFrom(startRank) || wanted0 || (twisterOn ? 1 : 0)
  // With no merges predicted at all there is nothing to size against; the
  // buckets are still defined (one unit per drop) so that a merge drops.
  const drops = startRank == null ? 0 : perDropGiven ? 1 : (mixed ? multiRanks.reduce((sum, r) => sum + slotsAt(r), 0) : slotsFrom(startRank)) || wanted || (twisterOn ? 1 : 0)

  // Each resource's share of the drops, as stretches of the 0..1 line, laid
  // end to end (wrapping round) - so every point of the line is covered by a
  // whole number of resources, and the pieces between the cut points are the
  // buckets. `stretch` scales the shares of the resources that are in only
  // some drops (a resource in every drop is not touched): above 1 they are in
  // more drops, below 1 in fewer.
  const perDrop = drops > 0 ? Object.fromEntries(types.map((t) => [t, need[t] / drops])) : {}
  // How many resources cover an average drop at a stretch, and the smallest
  // stretch that covers every drop `cover` times (each resource covers a
  // drop at most once, so it takes at least that many resources).
  const coverAt = (f) => types.reduce((sum, t) => sum + (perDrop[t] > 1 ? 1 : Math.min(1, perDrop[t] * f)), 0)
  const minStretch = (cover) => {
    if (types.length < cover - 1e-9) return Infinity
    const above = coverAt(1) < cover - 1e-9
    let lo = above ? 1 : 0
    let hi = above ? 2 : 1
    while (coverAt(hi) < cover - 1e-9 && hi < 1e9) hi *= 2
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      if (coverAt(mid) < cover - 1e-9) lo = mid
      else hi = mid
    }
    return hi
  }
  // `cover`: how many items an average drop may hold AT MOST (1 + that
  // rank's share of multi-item drops). When the rewards (and the Twister
  // item) would cover the drops more often than that, the rewards are put
  // into fewer drops as bigger items - the same units, in fewer containers -
  // so single-item containers stay as common as the rise says they should.
  // By explicit economist request: "we should have also some containers of
  // only 1 drop. not 80% of the more than 1". A reward item is at most rank
  // 4, which bounds how far this can go.
  // `rotate`: which reward the line starts with. The Twister item lands on
  // the rewards at the start of the line, so starting somewhere else at each
  // merge rank pairs it with a different reward each time ("only 1 container
  // has the twister, it looks a bit weird").
  // `low` ({ guaranteed }): the layout of the FIRST TWO DROPPING RANKS, where
  // most merges happen (by explicit economist request: "we need to give the
  // lower ranks to drop rank 1 small rewards ... i got a blocked item of
  // rank1 for alot of time and i get drops of a higher rank"; "the drops of
  // the rank6 and 7 maybe will guarentee give them so the blocked tiles will
  // not do harm"). There every reward item is rank 1 - the item that opens a
  // reward under a tile - nothing is squeezed into bigger items, and the
  // `guaranteed` rewards (the ones that sit under tiles) are stretched until
  // every drop holds one of them.
  const layout = (stretch, twisterShare = 0, cover = null, rotate = 0, low = null) => {
    const stretches = [] // { type, from, to, rank }
    const lay = (type, start, length, rank) => {
      if (!(length > 1e-9)) return
      const from = ((start % 1) + 1) % 1
      if (from + length > 1 + 1e-9) {
        stretches.push({ type, from, to: 1, rank })
        stretches.push({ type, from: 0, to: from + length - 1, rank })
      } else {
        stretches.push({ type, from, to: Math.min(1, from + length), rank })
      }
    }
    // Each reward's share of the drops and the units it carries per drop.
    const natural = {}
    const carried = {}
    for (const t of types) {
      natural[t] = perDrop[t] > 1 ? 1 : Math.min(1, perDrop[t] * stretch)
      carried[t] = perDrop[t] > 1 ? perDrop[t] : natural[t]
    }
    const sure = low ? (low.guaranteed ?? []).filter((t) => types.includes(t)) : []
    if (low) {
      for (const t of types) carried[t] = natural[t]
      const sureCover = sure.reduce((sum, t) => sum + natural[t], 0)
      if (sureCover > 0 && sureCover < 1) {
        for (const t of sure) {
          natural[t] = Math.min(1, natural[t] / sureCover)
          carried[t] = natural[t]
        }
      }
    }
    const rewardCover = types.reduce((sum, t) => sum + natural[t], 0)
    const squeeze = !low && cover != null && rewardCover > 0 && rewardCover + twisterShare > cover + 1e-9 ? Math.max(0, (cover - twisterShare) / rewardCover) : 1
    // THE ITEM COUNTS ARE HARD RULES (by explicit economist decision: "i dont
    // want those ranks to hold so many resources. only rank10+ should drop 3
    // ... we need to try and stay on the rules we give"). A rank's drops hold
    // exactly `cover` items on average - one, or two where its rule says two,
    // three where it says three - and never more. So the rewards get
    // `cover - twisterShare` of the line and no more: they go from rank-1
    // items in many drops (`most`) to rank-3 items in few (`least`) as far as
    // that takes, and what even rank-3 items in that many drops cannot carry
    // is NOT dropped (the result's `shortUnits`; the build then changes the
    // reward's rank values instead - smallRewardsWorkflow.js). An earlier
    // version let a reward keep more drops than its rule gave it, which is
    // how rank 7 came to hold three items.
    const hard = !low && cover != null
    const topUnits = unitsOf(SQUEEZED_TOP_RANK)
    const hardShare = {}
    if (hard) {
      const allowed = Math.max(0, cover - twisterShare)
      const most = Object.fromEntries(types.map((t) => [t, natural[t]]))
      const least = Object.fromEntries(types.map((t) => [t, Math.min(natural[t], carried[t] / topUnits)]))
      const hi = types.reduce((sum, t) => sum + most[t], 0)
      const lo = types.reduce((sum, t) => sum + least[t], 0)
      for (const t of types) {
        if (hi <= allowed + 1e-9) hardShare[t] = most[t]
        else if (lo >= allowed - 1e-9) hardShare[t] = lo > 0 ? (least[t] * allowed) / lo : 0
        else hardShare[t] = least[t] + ((most[t] - least[t]) * (allowed - lo)) / (hi - lo)
      }
    }
    const turn = types.length > 0 ? ((rotate % types.length) + types.length) % types.length : 0
    const order = low && sure.length > 0 ? [...sure, ...types.filter((t) => !sure.includes(t))] : turn ? [...types.slice(turn), ...types.slice(0, turn)] : types
    let offset = 0
    for (const t of order) {
      // Fewer drops, bigger items: the share shrinks, the units stay.
      // A squeezed reward item is rank 3 at most (a rank-4 item would pay a
      // whole prize from one merge, with nothing left to merge), so a reward
      // that needs a lot keeps more drops than the squeeze asks.
      const top = hard || squeeze < 1 - 1e-9 ? SQUEEZED_TOP_RANK : REWARD_MAX_RANK
      const share = hard ? hardShare[t] : Math.min(1, Math.max(natural[t] * squeeze, carried[t] / unitsOf(top), carried[t] > unitsOf(top) ? 1 : 0))
      if (!(share > 1e-9)) continue
      // (Under the hard rule an item is rank 3 at most: what that leaves out is short.)
      const each = hard ? Math.min(topUnits, carried[t] / share) : carried[t] / share
      if ((hard || squeeze < 1 - 1e-9) && each > 1 + 1e-9 && each <= unitsOf(top) + 1e-9) {
        // Squeezed: part of the reward's drops stay rank-1 items and the
        // rest are one bigger rank. A rank-1 item is what opens a reward
        // item under a tile (they are placed as chains that start at rank 1
        // - rewardPlacement.js), so it has to keep dropping at every rank.
        const big = Math.min(top, Math.max(2, Math.ceil(Math.log2(each) - 1e-9) + 1))
        const bigShare = Math.min(share, (each * share - share) / (unitsOf(big) - 1))
        lay(t, offset, share - bigShare, 1)
        lay(t, offset + (share - bigShare), bigShare, big)
      } else {
        const rank = Math.min(REWARD_MAX_RANK, Math.floor(Math.log2(each) + 1e-9) + 1)
        const higher = rank >= REWARD_MAX_RANK ? 0 : Math.min(1, Math.max(0, each / unitsOf(rank) - 1))
        lay(t, offset, share * (1 - higher), rank)
        lay(t, offset + share * (1 - higher), share * higher, rank + 1)
      }
      offset = (offset + share) % 1
    }
    // The filler (coins the build values) takes the places the rewards leave.
    if (hard && filler) {
      const usedByRewards = types.reduce((sum, t) => sum + (hardShare[t] ?? 0), 0)
      const fillShare = Math.min(1, Math.max(0, cover - twisterShare - usedByRewards))
      if (fillShare > 1e-9) {
        lay(filler, offset, fillShare, 1)
        offset = (offset + fillShare) % 1
      }
    }
    // The Twister item, right after the rewards: it covers what they leave
    // empty first, and what is left of it lands on top of them.
    if (twisterShare > 1e-9) {
      const lower = twisterShare * (1 - twisterMix.higher)
      lay(TWISTER_TYPE, offset, lower, twisterMix.rank)
      lay(TWISTER_TYPE, offset + lower, twisterShare - lower, twisterMix.rank + 1)
    }
    // The buckets: between every two neighbouring cut points, the items of
    // the stretches that cover that piece.
    const cuts = [...new Set([0, 1, ...stretches.flatMap((x) => [x.from, x.to])].map((v) => Math.round(v * 1e9) / 1e9))].sort((x, y) => x - y)
    const byKey = new Map()
    for (let i = 0; i < cuts.length - 1; i++) {
      const width = cuts[i + 1] - cuts[i]
      if (!(width > 1e-9)) continue
      const mid = (cuts[i] + cuts[i + 1]) / 2
      const items = {}
      for (const x of stretches) if (x.from <= mid && mid < x.to) items[x.type] = x.rank
      // A container holds four items at most: the Twister item gives way.
      if (Object.keys(items).length > MAX_GROUP_ITEMS) delete items[TWISTER_TYPE]
      if (Object.keys(items).length === 0) continue
      const key = groupId(items)
      byKey.set(key, { items, p: (byKey.get(key)?.p ?? 0) + width })
    }
    const totalP = [...byKey.values()].reduce((sum, bucket) => sum + bucket.p, 0)
    return [...byKey.values()].filter((bucket) => bucket.p > 0).map((bucket) => ({ items: bucket.items, p: totalP > 0 ? bucket.p / totalP : 0 }))
  }
  // What even a rank-4 item on every drop cannot deliver.
  if (!allSolo) for (const t of types) short[t] = drops > 0 ? Math.max(0, need[t] - drops * unitsOf(REWARD_MAX_RANK)) : need[t]

  // The share of drops that must hold two or more items, per merge rank.
  // `tripleDropRank`: from that rank every drop holds THREE or more items,
  // and between the two-item rank and it the share that does rises in equal
  // steps (two-item rank 8, three-item rank 10: half the drops at rank 9).
  // The two-item rank is always at least one rank before it.
  const tripleFrom = Number.isFinite(tripleDropRank) && tripleDropRank > 0 && startRank != null ? Math.max(startRank + 1, tripleDropRank) : null
  const twoFrom = Number.isFinite(multiDropRank) && multiDropRank > 0 && startRank != null ? Math.max(startRank, multiDropRank) : null
  const multiFrom = tripleFrom == null ? twoFrom : Math.max(startRank, Math.min(twoFrom ?? tripleFrom - 1, tripleFrom - 1))
  // The share of two-item drops rises from the first dropping rank.
  const riseBase = multiFrom == null ? null : Math.min(multiFrom, startRank)
  const multiShareAt = (rank) => (multiFrom == null || rank < riseBase ? 0 : Math.min(1, Math.max(0, (rank - riseBase + 1) / (multiFrom - riseBase + 1))))
  // Three items ONLY from the three-item rank (by explicit economist rule:
  // "only rank10+ should drop 3"); an earlier version let the share of
  // three-item drops rise between the two ranks (half of them at rank 9).
  const tripleShareAt = (rank) => (tripleFrom == null || rank < tripleFrom ? 0 : 1)
  // Kept groups (a Twister rule, a locked group) take part of each table and
  // are not ours to change. A kept single-item group counts against the
  // share, so the generated buckets carry more of it - as far as they can.
  const keptMultiMass = (rank) => {
    const table = dropGroupsConfig[rank - 1]
    const total = tableTotal(table)
    if (total <= 0) return 0
    const sizeOf = new Map(keptGroups.map((g) => [g.id, Object.keys(g.items ?? {}).length]))
    return table.entries.filter((e) => (sizeOf.get(e.groupId) ?? 0) >= 2).reduce((s, e) => s + Math.max(0, e.weight), 0) / total
  }
  const generatedShareAt = (rank) => {
    const want = multiShareAt(rank)
    if (want >= 1 || want <= 0) return want
    const free = 1 - keptMass(rank)
    return free > 0 ? Math.min(1, Math.max(0, (want - keptMultiMass(rank)) / free)) : 0
  }
  // The stretch each rank's buckets are made with. Every rank needs at least
  // the one that covers its drops as often as the rise asks (`floorOf`). More
  // items at the higher ranks is more payout, so where there is room the
  // lower ranks carry a little less: one common stretch `level` is found
  // (each rank uses it, or its own floor when that is higher) at which the
  // drops deliver, over the predicted merges, what they would with no rise
  // at all. When even the floors alone deliver more than that - small
  // targets, one item per merge already too much - the floors are used and
  // the drops pay more; `deliverableUnits` says how much.
  const coverOf = (rank) => Math.round((1 + generatedShareAt(rank) + tripleShareAt(rank)) * 1000) / 1000
  // The Twister item's share of a rank's drops: what the rewards leave short
  // of that rank's cover, and never less than its minimum.
  const twisterShareOf = (rank) => (twisterOn ? Math.round(Math.min(1, Math.max(twisterMin, coverOf(rank) - coverAt(1) - (filler ? 1 : 0))) * 1000) / 1000 : 0)
  // How much of a rank's line the rewards that ask for something have to
  // cover themselves (the filler can cover up to one place of it).
  const rewardCoverOf = (rank) => Math.max(0, coverOf(rank) - twisterShareOf(rank) - (filler ? 1 : 0))
  const plainStretch = Math.max(1, minStretch(1))
  const rampRanks = mixed ? multiRanks : ranksFromStart
  const floorOf = new Map(rampRanks.map((r) => [r, minStretch(rewardCoverOf(r))]))
  const smallUnitsAt = (f) => types.reduce((sum, t) => sum + (perDrop[t] > 1 ? 0 : Math.min(1, perDrop[t] * f)), 0)
  const balanced = !twisterOn && !filler && multiFrom != null && !perDropGiven && rampRanks.some((r) => slotsAt(r) > 0)
  let level = plainStretch
  if (balanced) {
    const deliveredAt = (l) => rampRanks.reduce((sum, r) => sum + slotsAt(r) * smallUnitsAt(Math.max(l, floorOf.get(r))), 0)
    const goal = rampRanks.reduce((sum, r) => sum + slotsAt(r) * smallUnitsAt(plainStretch), 0)
    if (deliveredAt(0) >= goal - 1e-9) level = 0
    else {
      let lo = 0
      let hi = plainStretch
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2
        if (deliveredAt(mid) < goal) lo = mid
        else hi = mid
      }
      level = hi
    }
  }
  const stretchOf = (rank) => {
    const floor = floorOf.get(rank) ?? minStretch(rewardCoverOf(rank))
    return balanced ? Math.max(level, floor) : Math.max(1, floor)
  }
  const sets = new Map() // stretch (and Twister share) -> its buckets
  singleLayouts.forEach((set, rank) => sets.set(`single|${rank}`, set))
  const multiSetFor = (rank) => {
    const stretch = stretchOf(rank)
    const share = twisterShareOf(rank)
    // With a rise set, a rank's drops hold exactly as many items as the rise
    // says (see `cover` and `rotate` above); without one they are left as
    // the amounts make them.
    // The "first two ranks" layout is only for a list with no single-item
    // rank: with one, that rank is what feeds the reward under the tiles, and
    // every rank above it follows the two- and three-item ranks as set.
    const low = Array.isArray(guaranteedTypes) && soloRanks.length === 0 && rank <= startRank + 1 ? { guaranteed: guaranteedTypes } : null
    const cover = multiFrom == null || low ? null : coverOf(rank)
    const rotate = multiFrom == null || types.length < 2 || low ? 0 : (rank - startRank) % types.length
    const key = `${Number.isFinite(stretch) ? Math.round(stretch * 1e6) / 1e6 : 'all'}|${share}|${cover}|${rotate}|${low ? `low:${(guaranteedTypes ?? []).join(",")}` : ""}`
    if (!sets.has(key)) sets.set(key, drops > 0 ? asGroups(layout(stretch, share, cover, rotate, low)) : [])
    return sets.get(key)
  }
  const setFor = (rank) => (isSolo(rank) && singleLayouts.size > 0 ? singleSetFor(rank) : multiSetFor(rank))
  const generatedGroups = startRank != null ? setFor(startRank) : []
  // The two- and three-item ranks are judged at the first rank that can hold several.
  const firstMulti = multiRanks[0] ?? null
  const multiDropShort = !allSolo && multiFrom != null && (types.length + (twisterOn ? 1 : 0) + (filler ? 1 : 0) < 2 || multiSetFor(Math.max(multiFrom, firstMulti ?? multiFrom)).some((g) => Object.keys(g.items).length < 2))

  let nextTables = dropGroupsConfig.map((table) => {
    if (!table) return table
    if (table.locked) return table
    if (!writableRanks.includes(table.rank)) return { ...table, entries: table.entries.filter((e) => keptIds.has(e.groupId)) }
    const total = tableTotal(table)
    const keptEntries = table.entries
      .filter((e) => keptIds.has(e.groupId))
      .map((e) => ({ groupId: e.groupId, weight: total > 0 ? Math.round((Math.max(0, e.weight) / total) * DROP_TABLE_TOTAL_WEIGHT) : 0 }))
    const free = Math.max(0, DROP_TABLE_TOTAL_WEIGHT - keptEntries.reduce((sum, e) => sum + e.weight, 0))
    if (startRank == null || table.rank < startRank) return { ...table, entries: keptEntries, noDropWeight: free }
    const set = setFor(table.rank)
    if (set.length === 0) return { ...table, entries: keptEntries, noDropWeight: free }
    // Whole weights that add up to exactly what is free: no "nothing" left.
    const exact = set.map((g) => g.p * free)
    const weights = exact.map(Math.floor)
    let left = free - weights.reduce((sum, w) => sum + w, 0)
    const byRemainder = exact.map((v, i) => [v - Math.floor(v), i]).sort((x, y) => y[0] - x[0])
    for (let k = 0; left > 0 && byRemainder.length > 0; k++, left--) weights[byRemainder[k % byRemainder.length][1]] += 1
    const autoEntries = set.map((g, i) => ({ groupId: g.id, weight: weights[i] })).filter((e) => e.weight > 0)
    return { ...table, entries: [...keptEntries, ...autoEntries], noDropWeight: 0 }
  })

  // One list of groups: every bucket any rank uses, once.
  const allGenerated = []
  const generatedIds = new Set()
  for (const set of sets.values()) {
    for (const g of set) {
      if (generatedIds.has(g.id)) continue
      generatedIds.add(g.id)
      allGenerated.push(g)
    }
  }
  let nextGroups = [...keptGroups, ...allGenerated.map(({ p: _p, ...g }) => g)]

  // STEADY CONTAINERS (see the note above this function).
  let steadyPlan = null
  const steadyRewards = REWARD_TYPES.filter((t) => need0[t] > 0 && t !== elasticType)
  const steadyKinds = steadyRewards.length + (elasticType ? 1 : 0) + (twisterOn ? 1 : 0)
  if (steady && !perDropGiven && keptGroups.length === 0 && !dropGroupsConfig.some((t) => t?.locked) && startRank != null && soloRanks.length === 1 && multiRanks.length > 0 && multiFrom != null && tripleFrom != null && steadyRewards.length >= 1 && steadyKinds >= 3) {
    // Merge energy first, then the reward that asks for most.
    const order = [...steadyRewards].sort((a, b) => (b === 'energy') - (a === 'energy') || need0[b] - need0[a])
    const soloType = focus?.type && (steadyRewards.includes(focus.type) || elasticType === focus.type) ? focus.type : (elasticType ?? order[0])
    const got = Object.fromEntries(order.map((t) => [t, 0]))
    const leastServed = (count, taken = []) =>
      order
        .filter((t) => !taken.includes(t))
        .sort((a, b) => got[a] - got[b] || order.indexOf(a) - order.indexOf(b))
        .slice(0, count)
    // What each rank's drops hold: `always` in every drop, `extra` in `extraShare` of them.
    const layoutOf = new Map()
    let twoItemRanks = 0
    for (const r of multiRanks) {
      let always = []
      let extra = null
      let extraShare = 0
      if (r < multiFrom) {
        always = leastServed(1)
        if (twisterOn && r === TWISTER_PAIR_RANK) {
          // Economist: "A main-chain merge creating rank 7 always drops two
          // items: its existing non-Twister reward plus its Twister item."
          always.push(TWISTER_TYPE)
        } else {
          extraShare = generatedShareAt(r)
          extra = twisterOn ? TWISTER_TYPE : (elasticType ?? [...order].reverse().find((t) => !always.includes(t)) ?? null)
        }
      } else if (r < tripleFrom) {
        twoItemRanks += 1
        // The Twister item sits in every two-item drop: the economist's worry
        // about the Twister is its pace, and an item that is always there
        // (and not in a quarter of the drops, at random) arrives evenly.
        const twisterHere = twisterOn
        always = leastServed(twisterHere ? 1 : 2)
        if (twisterHere) always.push(TWISTER_TYPE)
        if (always.length < 2 && elasticType) always.push(elasticType)
        if (always.length < 2 && twisterOn && !always.includes(TWISTER_TYPE)) always.push(TWISTER_TYPE)
      } else {
        always = leastServed(3)
        if (always.length < 3 && twisterOn) always.push(TWISTER_TYPE)
        if (always.length < 3 && elasticType) always.push(elasticType)
      }
      const merges = slotsAt(r)
      for (const t of always) if (t in got) got[t] += merges
      if (extra && extra in got) got[extra] += merges * extraShare
      layoutOf.set(r, { always, extra: extraShare > 1e-9 ? extra : null, extraShare })
    }
    // The item each reward drops at each rank: one rank per reward and merge
    // rank (1 to 3), walking its ranks from the busiest down and keeping what
    // has been given as close as it can to its share of what was asked.
    const sizeOf = new Map()
    for (const t of order) {
      const places = multiRanks
        .map((r) => ({ r, weight: slotsAt(r) * (layoutOf.get(r).always.includes(t) ? 1 : layoutOf.get(r).extra === t ? layoutOf.get(r).extraShare : 0) }))
        .filter((p) => layoutOf.get(p.r).always.includes(t) || layoutOf.get(p.r).extra === t)
        .sort((a, b) => b.weight - a.weight)
      const total = places.reduce((sum, p) => sum + p.weight, 0)
      const asked = Math.max(0, need0[t] - (soloType === t ? slotsAt(startRank) : 0))
      let doneWeight = 0
      let doneUnits = 0
      for (const p of places) {
        const wanted = total > 0 ? (asked * (doneWeight + p.weight)) / total : 0
        let best = 1
        for (const units of [2, unitsOf(SQUEEZED_TOP_RANK)]) if (Math.abs(doneUnits + p.weight * units - wanted) < Math.abs(doneUnits + p.weight * best - wanted) - 1e-9) best = units
        sizeOf.set(`${t}|${p.r}`, Math.round(Math.log2(best)) + 1)
        doneWeight += p.weight
        doneUnits += p.weight * best
      }
    }
    const itemRankOf = (t, r) => (t === elasticType ? 1 : (sizeOf.get(`${t}|${r}`) ?? 1))
    // THE TWISTER ITEM, ONE RANK PER MERGE RANK. Its size is asked as an
    // average (twister.itemUnits, e.g. 1.5 = half rank 1, half rank 2). Mixed
    // inside one rank's drops that is a coin toss at every merge; here the
    // bigger item goes to whole merge ranks instead - the set of them whose
    // share of the Twister drops is closest to the share asked, the higher
    // merge ranks first - so two players get the same Twister items too.
    const twisterPlaces = multiRanks
      .map((r) => ({ r, weight: slotsAt(r) * (layoutOf.get(r).always.includes(TWISTER_TYPE) ? 1 : layoutOf.get(r).extra === TWISTER_TYPE ? layoutOf.get(r).extraShare : 0) }))
      .filter((p) => p.weight > 1e-9)
      .sort((a, b) => b.r - a.r)
    const twisterBigAt = new Set()
    if (twisterMix.higher > 0 && twisterPlaces.length > 0 && twisterPlaces.length <= 12) {
      const total = twisterPlaces.reduce((sum, p) => sum + p.weight, 0)
      let bestMask = 0
      let bestGap = Infinity
      for (let mask = 0; mask < 1 << twisterPlaces.length; mask++) {
        let weight = 0
        for (let k = 0; k < twisterPlaces.length; k++) if (mask & (1 << k)) weight += twisterPlaces[k].weight
        const gap = Math.abs(weight / total - twisterMix.higher)
        // (places are sorted from the highest merge rank: a lower mask with
        // the same gap holds the higher ranks.)
        if (gap < bestGap - 1e-9) {
          bestGap = gap
          bestMask = mask
        }
      }
      twisterPlaces.forEach((p, k) => bestMask & (1 << k) && twisterBigAt.add(p.r))
    }
    const twisterRankAt = (r) => Math.min(REWARD_MAX_RANK, twisterMix.rank + (twisterBigAt.has(r) ? 1 : 0))
    const made = new Map()
    const idOf = (items) => {
      const id = uniqueId(groupId(items))
      if (!made.has(id)) made.set(id, { id, name: groupName(items), items, auto: true })
      return id
    }
    // [items, share of the rank's drops].
    const rowsOf = new Map([[startRank, [[{ [soloType]: 1 }, 1]]]])
    for (const r of multiRanks) {
      const { always, extra, extraShare } = layoutOf.get(r)
      const base = {}
      for (const t of always) if (t !== TWISTER_TYPE) base[t] = itemRankOf(t, r)
      const twisterAlways = always.includes(TWISTER_TYPE)
      const variants = []
      const add = (items, share, withTwister) => {
        if (!(share > 1e-9) || Object.keys(items).length + (withTwister ? 1 : 0) === 0) return
        variants.push([withTwister ? { ...items, [TWISTER_TYPE]: twisterRankAt(r) } : items, share])
      }
      if (extra) {
        add(base, 1 - extraShare, twisterAlways)
        if (extra === TWISTER_TYPE) add(base, extraShare, true)
        else add({ ...base, [extra]: itemRankOf(extra, r) }, extraShare, twisterAlways)
      } else add(base, 1, twisterAlways)
      rowsOf.set(r, variants.filter(([, share]) => share > 1e-9))
    }
    nextTables = nextTables.map((table) => {
      const variants = rowsOf.get(table?.rank)
      if (!variants || variants.length === 0) return table
      const exact = variants.map(([, share]) => share * DROP_TABLE_TOTAL_WEIGHT)
      const weights = exact.map(Math.floor)
      let left = DROP_TABLE_TOTAL_WEIGHT - weights.reduce((sum, w) => sum + w, 0)
      const byRemainder = exact.map((v, i) => [v - Math.floor(v), i]).sort((x, y) => y[0] - x[0])
      for (let k = 0; left > 0 && byRemainder.length > 0; k++, left--) weights[byRemainder[k % byRemainder.length][1]] += 1
      return { ...table, entries: variants.map(([items], i) => ({ groupId: idOf(items), weight: weights[i] })).filter((e) => e.weight > 0), noDropWeight: 0 }
    })
    nextGroups = [...made.values()]
    steadyPlan = {
      generatedGroups: (nextTables[startRank - 1]?.entries ?? []).map((e) => ({ ...made.get(e.groupId), p: e.weight / DROP_TABLE_TOTAL_WEIGHT })),
      focus: { type: soloType, rank: startRank, share: 1, elastic: elasticType === soloType },
    }
  }
  // THE TWISTER'S TWO RULES (economist), on whichever table was made above:
  //   - a merge that makes rank 5 drops exactly one rank-1 Twister item (only
  //     the Twister starts there; the rewards' start rank is not moved);
  //   - a merge that makes rank 7 always drops two items: its reward and the
  //     Twister item (when rank 7 is a "one or two items" rank, as it is with
  //     the usual single-item rank 6 and two items from rank 8).
  if (twisterOn && !perDropGiven && startRank != null) {
    const made = new Map()
    const byId = new Map(nextGroups.map((g) => [g.id, g]))
    const idOf = (items) => {
      const id = uniqueId(groupId(items))
      if (!made.has(id)) made.set(id, { id, name: groupName(items), items, auto: true })
      return id
    }
    nextTables = nextTables.map((table) => {
      if (!table || table.locked) return table
      if (table.rank === TWISTER_FIRST_DROP_RANK && table.rank < startRank) {
        return { ...table, noDropWeight: 0, entries: [{ groupId: idOf({ [TWISTER_TYPE]: 1 }), weight: DROP_TABLE_TOTAL_WEIGHT }], belowStart: true }
      }
      if (allSolo || multiFrom == null || table.rank !== TWISTER_PAIR_RANK || !(table.rank > startRank && table.rank < multiFrom) || isSolo(table.rank)) return table
      const sizeHere = (table.entries ?? []).map((e) => byId.get(e.groupId)?.items?.[TWISTER_TYPE]).find((r) => r != null) ?? 1
      const merged = new Map()
      for (const e of table.entries ?? []) {
        const g = byId.get(e.groupId)
        if (!g) continue
        const id = g.auto && g.items[TWISTER_TYPE] == null && Object.keys(g.items).length === 1 ? idOf({ ...g.items, [TWISTER_TYPE]: sizeHere }) : e.groupId
        merged.set(id, (merged.get(id) ?? 0) + e.weight)
      }
      // A drop that was the Twister item alone has no reward to go with it:
      // its share goes to the rank's reward-and-Twister drops, in proportion.
      const itemsOf = (id) => made.get(id)?.items ?? byId.get(id)?.items ?? {}
      const alone = [...merged].filter(([id]) => Object.keys(itemsOf(id)).join() === TWISTER_TYPE)
      const paired = [...merged].filter(([id]) => Object.keys(itemsOf(id)).length >= 2)
      const pairedWeight = paired.reduce((sum, [, w]) => sum + w, 0)
      if (alone.length > 0 && pairedWeight > 0) {
        const extra = alone.reduce((sum, [, w]) => sum + w, 0)
        for (const [id] of alone) merged.delete(id)
        let given = 0
        paired.forEach(([id, w], k) => {
          const add = k === paired.length - 1 ? extra - given : Math.round((extra * w) / pairedWeight)
          given += add
          merged.set(id, w + add)
        })
      }
      return { ...table, entries: [...merged].map(([id, weight]) => ({ groupId: id, weight })) }
    })
    if (made.size > 0) {
      const used = new Set(nextTables.flatMap((t) => (t?.entries ?? []).map((e) => e.groupId)))
      nextGroups = [...nextGroups.filter((g) => !g.auto || used.has(g.id) || !made.has(g.id)), ...[...made.values()].filter((g) => !byId.has(g.id))].filter((g) => !g.auto || used.has(g.id))
    }
  }
  // When one item per merge is already more than was wanted, the drops pay
  // more than asked. The start rank is NOT moved; the rank from which the
  // drops would fit is only reported, so it can be offered as a choice.
  // (With a Twister item filling the empty drops there is no such floor.)
  const floorExceedsWanted = !twisterOn && !(allSolo && elasticType) && !perDropGiven && startRank != null && (drops > wanted + 0.5 || soloStretched)
  const fittingStartRank = floorExceedsWanted ? (withMerges.find((r) => r > startRank && slotsFrom(r) <= wanted0) ?? null) : null
  const deliverableUnits = expectedDropUnits(nextTables, nextGroups, mergesByRank, minDropRank, (g) => g.auto && !lockedRefs.has(g.id))
  // With the item counts hard, a reward is short by whatever the drops its
  // rules allow do not carry of what was asked.
  if (!allSolo && !perDropGiven && (multiFrom != null || soloRanks.length > 0)) {
    for (const t of REWARD_TYPES) short[t] = t === elasticType ? 0 : Math.max(0, need0[t] - (deliverableUnits[t] ?? 0))
  }
  return {
    dropGroups: nextGroups,
    dropGroupsConfig: nextTables,
    generatedGroups,
    deliverableUnits,
    shortUnits: short,
    eligibleMerges: allDrops,
    writableRanks,
    startRank,
    floorExceedsWanted,
    fittingStartRank,
    // One item per merge: no several-item rule is in force.
    maxItems: allSolo ? 1 : null,
    // The single-item ranks ([first, last]; null when there are none).
    soloRanks: soloRanks.length > 0 && !allSolo ? [soloRanks[0], soloRanks[soloRanks.length - 1]] : null,
    focus: singleFocus,
    lowerStartRank: singleLowerStartRank,
    multiDropRank: allSolo ? null : multiFrom,
    multiDropShort,
    tripleDropRank: allSolo ? null : tripleFrom,
    // Three items take three different rewards (the Twister item counts).
    tripleDropShort: !allSolo && tripleFrom != null && (types.length + (twisterOn ? 1 : 0) + (filler ? 1 : 0) < 3 || multiSetFor(Math.max(tripleFrom, firstMulti ?? tripleFrom)).some((g) => Object.keys(g.items).length < 3)),
    twisterFill: twisterOn,
    // Steady containers were made (every merge of a rank drops the same items).
    steady: !!steadyPlan,
    ...(steadyPlan ? { generatedGroups: steadyPlan.generatedGroups, focus: steadyPlan.focus, multiDropShort: false, tripleDropShort: false, floorExceedsWanted: false, fittingStartRank: null } : {}),
  }
}

// One item per merge, and `needUnits` of rewards do not fit from
// `startRank`: the highest earlier start rank from which they would (null
// when none does). An estimate - every reward drop a rank-3 item, the Twister
// item keeping its share of the drops and the reward under the tiles its
// share of the new first dropping rank.
export function singleItemStartRankThatFits({ needUnits, mergesByRank, startRank, twisterShare = 0, focusShare = 0 } = {}) {
  const top = unitsOf(SQUEEZED_TOP_RANK)
  for (let start = startRank - 1; start >= 2; start--) {
    let room = 0
    for (let r = start; r <= RC_MAX_RANK; r++) room += (mergesByRank?.[r] ?? 0) * Math.max(0, 1 - twisterShare - (r === start ? focusShare : 0)) * top
    if (room >= needUnits) return start
  }
  return null
}

// Changes how much Twister the GENERATED containers carry, and nothing
// else. This is how the build raises a segment's Twister income to fit the
// twists asked, after everything else is built:
//   minShare   the Twister item is in at least this share of each rank's
//              generated drops: containers without one are moved, in
//              proportion, to the same container WITH one (a container that
//              already holds four items is left alone);
//   itemUnits  what a Twister item carries on average: its rank, or two
//              neighbouring ranks split by weight.
// Every container keeps its reward items and its weight, so no reward, no
// board and no drop odds change - nothing else has to be built again. (Two
// Twister items of a rank merge at once, so even one in every drop leaves at
// most three on the board.) Hand-made groups and locked tables are untouched.
// Always applied to the build's own output, never to an already resized one.
//   steady     (steady containers) an in-between size is not two ranks mixed
//              inside one merge rank's drops - a coin toss at every merge -
//              but whole merge ranks with the bigger item: the set of them
//              whose share of the Twister drops is closest to the share
//              asked, the higher merge ranks first. How many merges a rank
//              gets is not known here, so each rank counts half the one
//              below it (what the chain gives when nothing is subsidised);
//              the size is a knob the build turns and measures again, so
//              that is close enough.
export function resizeTwisterDrops({ dropGroups = [], dropGroupsConfig = [] } = {}, { itemUnits = 1, minShare = 0, steady = false } = {}) {
  const mix = twisterRankMix(itemUnits)
  const share = Math.min(1, Math.max(0, minShare))
  const byId = new Map(dropGroups.map((g) => [g.id, g]))
  const lockedRefs = new Set()
  for (const table of dropGroupsConfig) if (table?.locked) for (const e of table.entries) lockedRefs.add(e.groupId)
  const generated = (g) => !!g?.auto && !lockedRefs.has(g.id)
  const withTwister = (g) => generated(g) && g.items?.[TWISTER_TYPE] != null
  const kept = dropGroups.filter((g) => !withTwister(g))
  const keptIds = new Set(kept.map((g) => g.id))
  const made = new Map()
  const variant = (others, rank) => {
    const items = { ...others, [TWISTER_TYPE]: rank }
    let id = groupId(items)
    for (let n = 2; keptIds.has(id); n++) id = `${groupId(items)}-${n}`
    if (!made.has(id)) made.set(id, { id, name: groupName(items), items, auto: true })
    return id
  }
  const pending = [] // steady: { index, pooled } - the Twister containers of each table, ranked afterwards
  const tables = dropGroupsConfig.map((table, index) => {
    // (the rank-5 row is "exactly one rank-1 Twister item": never resized)
    if (!table || table.locked || table.belowStart === true) return table
    const rest = [] // entries that are not ours to change
    const plain = [] // generated, no Twister item: { entry, group }
    const pooled = new Map() // the other items of a Twister container -> weight
    const pool = (others, weight) => {
      if (!(weight > 0)) return
      const key = groupId(others)
      pooled.set(key, { others, weight: (pooled.get(key)?.weight ?? 0) + weight })
    }
    for (const e of table.entries) {
      const g = byId.get(e.groupId)
      if (withTwister(g)) {
        const { [TWISTER_TYPE]: _rank, ...others } = g.items
        pool(others, Math.max(0, e.weight))
      } else if (generated(g) && e.weight > 0) plain.push({ entry: e, group: g })
      else rest.push(e)
    }
    if (pooled.size === 0 && plain.length === 0) return table
    // Move weight from containers without a Twister item to the same
    // container with one, until its share of the generated drops is reached.
    const have = [...pooled.values()].reduce((sum, p) => sum + p.weight, 0)
    const all = have + plain.reduce((sum, p) => sum + p.entry.weight, 0)
    const room = plain.filter((p) => Object.keys(p.group.items).length < MAX_GROUP_ITEMS)
    const roomWeight = room.reduce((sum, p) => sum + p.entry.weight, 0)
    let move = Math.min(roomWeight, Math.max(0, Math.round(share * all) - have))
    const entries = [...rest]
    const taken = new Map()
    if (move > 0) {
      const exact = room.map((p) => (p.entry.weight * move) / roomWeight)
      const whole = exact.map(Math.floor)
      let left = move - whole.reduce((sum, w) => sum + w, 0)
      const order = exact.map((v, i) => [v - Math.floor(v), i]).sort((x, y) => y[0] - x[0])
      for (let k = 0; left > 0 && k < order.length; k++) {
        const i = order[k][1]
        if (whole[i] < room[i].entry.weight) {
          whole[i] += 1
          left -= 1
        }
      }
      room.forEach((p, i) => taken.set(p.entry, whole[i]))
    }
    for (const p of plain) {
      const gone = taken.get(p.entry) ?? 0
      if (p.entry.weight - gone > 0) entries.push({ ...p.entry, weight: p.entry.weight - gone })
      pool(p.group.items, gone)
    }
    if (steady) {
      pending.push({ index, pooled: [...pooled.values()], total: all })
      return { ...table, entries }
    }
    for (const { others, weight } of pooled.values()) {
      const high = Math.round(weight * mix.higher)
      if (weight - high > 0) entries.push({ groupId: variant(others, mix.rank), weight: weight - high })
      if (high > 0) entries.push({ groupId: variant(others, mix.rank + 1), weight: high })
    }
    return { ...table, entries }
  })
  if (steady) {
    // Which merge ranks get the bigger item.
    const places = pending
      .map((p) => ({ ...p, rank: tables[p.index].rank ?? p.index + 1 }))
      .map((p) => ({ ...p, mass: (p.total > 0 ? p.pooled.reduce((sum, x) => sum + x.weight, 0) / p.total : 0) * 2 ** -p.rank }))
      .filter((p) => p.mass > 0)
      .sort((a, b) => b.rank - a.rank)
    const big = new Set()
    if (mix.higher > 0 && places.length > 0 && places.length <= 14) {
      const totalMass = places.reduce((sum, p) => sum + p.mass, 0)
      let bestMask = 0
      let bestGap = Infinity
      for (let mask = 0; mask < 1 << places.length; mask++) {
        let mass = 0
        for (let k = 0; k < places.length; k++) if (mask & (1 << k)) mass += places[k].mass
        const gap = Math.abs(mass / totalMass - mix.higher)
        if (gap < bestGap - 1e-9) {
          bestGap = gap
          bestMask = mask
        }
      }
      places.forEach((p, k) => bestMask & (1 << k) && big.add(p.index))
    }
    for (const p of pending) {
      const rank = Math.min(REWARD_MAX_RANK, mix.rank + (big.has(p.index) ? 1 : 0))
      const entries = [...tables[p.index].entries]
      for (const { others, weight } of p.pooled) if (weight > 0) entries.push({ groupId: variant(others, rank), weight })
      tables[p.index] = { ...tables[p.index], entries }
    }
  }
  // Containers no table uses any more are dropped from the list.
  const used = new Set(tables.flatMap((t) => (t?.entries ?? []).map((e) => e.groupId)))
  const groups = [...kept.filter((g) => !g.auto || used.has(g.id) || lockedRefs.has(g.id)), ...made.values()]
  return { dropGroups: groups, dropGroupsConfig: tables, minShare: share, itemUnits: mix.higher > 0 ? unitsOf(mix.rank) * (1 + mix.higher) : unitsOf(mix.rank), rank: mix.rank, higher: mix.higher }
}

// Builds the proposed drop groups + tables.
//   dropUnits      {type: expected source units the GENERATED groups should
//                  deliver over the phase}
//   mergesByRank   {rank: predicted merge count} for this phase
//   structure      'separate' | 'bundle'
// Returns { dropGroups, dropGroupsConfig, generatedGroups, deliverableUnits,
// shortUnits, eligibleMerges, writableRanks }.
export function buildDropConfiguration({ dropUnits, mergesByRank, dropGroups = [], dropGroupsConfig = [], minDropRank = MIN_DROP_RANK, structure = 'separate' } = {}) {
  const writableRanks = writableDropRanks(dropGroupsConfig, minDropRank)
  const eligibleMerges = writableRanks.reduce((s, rank) => s + (mergesByRank?.[rank] ?? 0), 0)

  // Groups to keep: everything not generated, plus any generated group a
  // locked table still points at (a locked table is never rewritten, so its
  // groups must survive).
  const lockedRefs = new Set()
  dropGroupsConfig.forEach((table) => {
    if (table?.locked) for (const e of table.entries) lockedRefs.add(e.groupId)
  })
  const keptGroups = dropGroups.filter((g) => !g.auto || lockedRefs.has(g.id))
  const keptIds = new Set(keptGroups.map((g) => g.id))

  // Probability the kept groups already claim, per writable rank - their
  // odds are preserved, so the generator only has the remainder to work in.
  const keptMass = (rank) => {
    const table = dropGroupsConfig[rank - 1]
    const total = tableTotal(table)
    if (total <= 0) return 0
    return table.entries.filter((e) => keptIds.has(e.groupId)).reduce((s, e) => s + Math.max(0, e.weight), 0) / total
  }
  const mass = writableRanks.length ? Math.max(0, Math.min(...writableRanks.map((r) => 1 - keptMass(r))) * TOTAL_PROBABILITY_HEADROOM) : 0

  const need = zeroByType()
  for (const t of REWARD_TYPES) need[t] = Math.max(0, dropUnits?.[t] ?? 0)
  const anyNeed = REWARD_TYPES.some((t) => need[t] > 0)

  let sized = { groups: [], short: { ...need } }
  if (anyNeed && eligibleMerges > 0 && mass > 0) {
    sized = structure === 'bundle' ? sizeBundle(need, eligibleMerges, mass) : sizeSeparate(need, eligibleMerges, mass)
  } else if (!anyNeed) {
    sized = { groups: [], short: zeroByType() }
  }

  // Ids are derived from the contents (stable across re-generations), with
  // a suffix when a KEPT group already owns that id - e.g. a generated group
  // the economist locked keeps its id, and a fresh one with the same
  // contents must not collide with it.
  const uniqueId = (base) => {
    let id = base
    for (let n = 2; keptIds.has(id); n++) id = `${base}-${n}`
    return id
  }
  const generatedGroups = sized.groups
    .filter((g) => g.p > 0)
    .map((g) => ({ id: uniqueId(groupId(g.items)), name: groupName(g.items), items: g.items, auto: true, p: g.p }))

  const nextTables = dropGroupsConfig.map((table) => {
    if (!table) return table
    const writable = writableRanks.includes(table.rank)
    if (!writable) {
      // Untouched - except that an unlocked, ineligible table must not keep
      // pointing at generated groups that no longer exist.
      if (table.locked) return table
      return { ...table, entries: table.entries.filter((e) => keptIds.has(e.groupId)) }
    }
    const total = tableTotal(table)
    const keptEntries = table.entries
      .filter((e) => keptIds.has(e.groupId))
      .map((e) => ({ groupId: e.groupId, weight: total > 0 ? Math.round((Math.max(0, e.weight) / total) * DROP_TABLE_TOTAL_WEIGHT) : 0 }))
    const autoEntries = generatedGroups.map((g) => ({ groupId: g.id, weight: Math.max(1, Math.round(g.p * DROP_TABLE_TOTAL_WEIGHT)) }))
    const used = [...keptEntries, ...autoEntries].reduce((s, e) => s + e.weight, 0)
    return { ...table, entries: [...keptEntries, ...autoEntries], noDropWeight: Math.max(0, DROP_TABLE_TOTAL_WEIGHT - used) }
  })

  const nextGroups = [...keptGroups, ...generatedGroups.map(({ p: _p, ...g }) => g)]
  const deliverableUnits = expectedDropUnits(nextTables, nextGroups, mergesByRank, minDropRank, (g) => g.auto && !lockedRefs.has(g.id))

  return {
    dropGroups: nextGroups,
    dropGroupsConfig: nextTables,
    generatedGroups,
    deliverableUnits,
    shortUnits: sized.short,
    eligibleMerges,
    writableRanks,
  }
}
