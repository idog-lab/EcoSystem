// Containers - the Ops name for what a merge drops.
//
// By explicit economist request ("we are also missing the containers. we
// need to create the containers and give them weights, each container with a
// different drop. those need to be in the syntax generation of the model and
// of course be taken into account in the model").
//
// A CONTAINER IS A DROP GROUP. The model already rolls drop groups ("buckets":
// one to four items that drop together, each its own resource and rank), and
// the Ops "Small Rewards Bank" sheet describes exactly that - a named
// container (ContA, ContB, ...) whose syntax is Small Rewards keys joined by
// "+" (coin-r1+dr-r1+puzzle-r1+charm-r1) - with the "Small Reward Weights"
// sheet giving each container's weight per merge tier, plus NoDrop. They used
// to be two unrelated things here: the model's groups (played, simulated,
// built) and a hand-typed bank (exported, never played). This file makes them
// one: the containers Ops receives ARE the groups the model built and plays.
//
//   key       ContA, ContB, ... in the order the list holds its groups
//   syntax    the group's items as Small Rewards keys, in the reference's own
//             order (coin, dr, puzzle, charm)
//   weights   per merge tier, straight from the group's weight in that
//             rank's drop table; a tier below the drop start rank can never
//             drop (the engine gates it), so it is written as NoDrop only.
//
// Only containers that can actually drop are listed (a positive weight at an
// eligible tier). Merge tiers run 2 to 12 for the normal list and 2 to 14 for
// Recompletion - a rank-1 item comes from the generator, never from a merge.
//
// UNVERIFIED: a container that carries Twister DR is written with the
// `dr-twister-r{n}` key, which is this app's own pattern (rewardChain.js);
// no Ops reference confirms it.
import { REWARD_TYPE_LABELS, TWISTER_TYPE, smallRewardKey } from './rewardChain'
import { MIN_DROP_RANK } from './dropGroups'
import { MAX_RANK, RC_MAX_RANK } from '../core/ranks'

// The reference writes a container as coin, dr (merge energy), puzzle, charm.
const SYNTAX_ORDER = ['coins', 'energy', 'puzzles', 'charms', TWISTER_TYPE]
// What a tier that cannot drop is written as: NoDrop takes the whole table.
export const NO_DROP_ONLY_WEIGHT = 1000
export const FIRST_MERGE_TIER = 2
export const lastMergeTier = (phase = 'main') => (phase === 'rc' ? RC_MAX_RANK : MAX_RANK)

// 0 -> ContA ... 25 -> ContZ, 26 -> ContAA.
export function containerKey(index) {
  let n = index
  let letters = ''
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return `Cont${letters}`
}

const itemsInOrder = (group) => SYNTAX_ORDER.filter((t) => group?.items?.[t] != null).map((t) => [t, group.items[t]])

export const containerSyntax = (group) => itemsInOrder(group).map(([type, rank]) => smallRewardKey(type, rank)).join('+')
export const containerContents = (group) => itemsInOrder(group).map(([type, rank]) => `${REWARD_TYPE_LABELS[type]} R${rank}`).join(' + ')

// The containers of one list and their weights per merge tier.
//   containers  [{ key, id, items, syntax, contents, carriesTwister }]
//   rows        [{ tier, eligible, weights: {groupId: weight}, noDrop, total }]
export function modelContainers({ dropGroups = [], dropGroupsConfig = [], minDropRank = MIN_DROP_RANK, phase = 'main' } = {}) {
  const startRank = minDropRank ?? MIN_DROP_RANK
  const byId = new Map((dropGroups ?? []).map((g) => [g.id, g]))
  const rows = []
  const used = new Set()
  for (let tier = FIRST_MERGE_TIER; tier <= lastMergeTier(phase); tier++) {
    const table = dropGroupsConfig?.[tier - 1]
    const weights = {}
    let noDrop = Math.max(0, table?.noDropWeight ?? 0)
    if (tier >= startRank && table) {
      for (const entry of table.entries ?? []) {
        if (!(entry.weight > 0)) continue
        // An entry pointing at a group that no longer exists can never drop.
        if (!byId.has(entry.groupId)) {
          noDrop += entry.weight
          continue
        }
        weights[entry.groupId] = (weights[entry.groupId] ?? 0) + entry.weight
        used.add(entry.groupId)
      }
    }
    const dropping = Object.values(weights).reduce((s, w) => s + w, 0)
    const eligible = dropping > 0
    rows.push({ tier, eligible, weights: eligible ? weights : {}, noDrop: eligible ? noDrop : NO_DROP_ONLY_WEIGHT, total: eligible ? dropping + noDrop : NO_DROP_ONLY_WEIGHT })
  }
  const containers = (dropGroups ?? [])
    .filter((g) => used.has(g.id))
    .map((g, i) => ({ key: containerKey(i), id: g.id, items: g.items, syntax: containerSyntax(g), contents: containerContents(g), carriesTwister: g.items?.[TWISTER_TYPE] != null }))
  return { containers, rows, startRank }
}

// The same, read off a board list (its first board holds the list's drops).
export function containersOfBoards(boards, phase = 'main') {
  const board = boards?.[0]
  if (!board) return { containers: [], rows: [], startRank: MIN_DROP_RANK }
  return modelContainers({ dropGroups: board.dropGroups ?? [], dropGroupsConfig: board.dropGroupsConfig ?? [], minDropRank: board.minDropRank ?? MIN_DROP_RANK, phase })
}

// ONE EVENT: the normal list and Recompletion happen one after the other, so
// the Ops "Small Rewards Bank" and "Small Reward Weights" of an event run to
// merge tier 14 (economist: "the small rewards should hold a drop for the
// rank13 and 14 merge"). Tiers 2 to 12 are the normal list's own; tiers 13
// and 14 can only be made in Recompletion, so they are what the Recompletion
// list drops there (the normal list's own rows for them when there is no
// Recompletion list to play). A Recompletion container that the normal
// list does not have is added after the normal ones (ContA, ContB, ... carry
// on); one that holds exactly the same items is the same container.
// Rows carry `weightsByKey` (container key -> weight).
export function containersOfEvent(boards, recompletionBoards = []) {
  const main = containersOfBoards(boards, 'main')
  const rc0 = recompletionBoards?.[0]
  // A Recompletion list that is played (it has drops, or boards with items
  // under their tiles) is the source - also when it drops nothing, which is
  // then exactly what tiers 13 and 14 say (NoDrop). Only with no such list do
  // the normal list's own rows for those tiers stand in.
  const rcPlays = !!rc0 && ((rc0.dropGroups ?? []).length > 0 || recompletionBoards.some((b) => (b?.blockedQueue?.length ?? 0) > 0))
  const source = rcPlays ? rc0 : boards?.[0]
  const top = source ? modelContainers({ dropGroups: source.dropGroups ?? [], dropGroupsConfig: source.dropGroupsConfig ?? [], minDropRank: source.minDropRank ?? MIN_DROP_RANK, phase: 'rc' }) : { containers: [], rows: [] }
  const containers = main.containers.map((c) => ({ ...c }))
  const keyBySyntax = new Map(containers.map((c) => [c.syntax, c.key]))
  const keyOfMainId = new Map(main.containers.map((c) => [c.id, c.key]))
  const rows = main.rows.map((row) => ({ ...row, weightsByKey: Object.fromEntries(Object.entries(row.weights).map(([id, w]) => [keyOfMainId.get(id), w])) }))
  const topById = new Map(top.containers.map((c) => [c.id, c]))
  for (const row of top.rows.filter((r) => r.tier > MAX_RANK)) {
    const weightsByKey = {}
    for (const [id, weight] of Object.entries(row.weights)) {
      const c = topById.get(id)
      if (!c) continue
      if (!keyBySyntax.has(c.syntax)) {
        const key = containerKey(containers.length)
        containers.push({ ...c, key, fromRecompletion: true })
        keyBySyntax.set(c.syntax, key)
      }
      const key = keyBySyntax.get(c.syntax)
      weightsByKey[key] = (weightsByKey[key] ?? 0) + weight
    }
    rows.push({ ...row, weightsByKey })
  }
  return { containers, rows, startRank: main.startRank, topTiersFrom: source === rc0 ? 'rc' : 'main' }
}

// Runs of neighbouring tiers that share exactly the same weights, for a
// compact display ("ranks 6 to 12"). Each run: { from, to, row }.
export function groupContainerRows(rows) {
  const runs = []
  const same = (a, b) => a.noDrop === b.noDrop && a.eligible === b.eligible && JSON.stringify(Object.entries(a.weights).sort()) === JSON.stringify(Object.entries(b.weights).sort())
  for (const row of rows) {
    const last = runs[runs.length - 1]
    if (last && same(last.row, row)) last.to = row.tier
    else runs.push({ from: row.tier, to: row.tier, row })
  }
  return runs
}
