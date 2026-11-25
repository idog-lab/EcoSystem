// SMALL REWARDS CC - the Small Rewards Bank and Small Reward Weights for a
// player who can no longer get some of the items (economist, 25 Nov 2026: "i
// need a CC for each option for when the player doesnt have anymore in its
// game the items that drop. when the user doesnt have a twister, when doesnt
// have a puzzle, no charms. all the options.").
//
// The economist's answers:
//   WHICH   every combination of Twister, puzzles and charms ("he can be
//           missing all except of the merge") - 7 CCs. Coins are not in it:
//           they are what a missing item becomes.
//   INSTEAD a missing puzzle or charm item becomes a coin item of the same
//           rank (puzzle-r2 -> coin-r2): the player gets as many items.
//   TWISTER a missing Twister item is simply not given ("if a container has a
//           twister and it dies we can just not give drops from it anymore") -
//           except in a container that has to give 3 rewards, where a rank-1
//           merge energy takes its place ("u can enter a rank 1 energy into
//           it"). A container that dropped only a Twister item then drops
//           nothing: it leaves the CC sheets and its weights go to NoDrop -
//           merge tier 5 (one rank-1 Twister item and nothing else) among them.
// The other containers keep their keys (ContA, ContB, ...) and weights, so a
// CC sheet reads against the normal one line for line. Built from the event's
// own containers (containers.js: containersOfEvent - merge tiers 2-14), one
// table for every segment like the normal sheets. Coin items' values are
// each segment's own, on Small Rewards.
import { containersOfEvent } from '../rewards/containers'
import { smallRewardKey } from '../rewards/rewardChain'

export const CC_TYPES = ['twister', 'puzzles', 'charms']
export const CC_TYPE_LABELS = { twister: 'Twister', puzzles: 'Puzzles', charms: 'Charms' }
const KEY_TO_TYPE = [
  ['dr-twister-r', 'twister'],
  ['puzzle-r', 'puzzles'],
  ['charm-r', 'charms'],
]

// Every combination, in a fixed order: each alone, each pair, all three. { id, n, missing, label }.
export function ccOptions() {
  const out = []
  const sets = [['twister'], ['puzzles'], ['charms'], ['twister', 'puzzles'], ['twister', 'charms'], ['puzzles', 'charms'], ['twister', 'puzzles', 'charms']]
  sets.forEach((missing, i) => out.push({ id: `cc${i + 1}`, n: i + 1, missing, label: `No ${missing.map((t) => CC_TYPE_LABELS[t]).join(', ')}` }))
  return out
}

// A container's text for a CC: { syntax, replaced: [{ from, to }] } - `to` null when the item is not given;
// syntax '' when nothing is left. "Has to give 3 rewards": a container of three items.
export function ccSyntax(syntax, missing) {
  const replaced = []
  const keys = String(syntax ?? '').split('+').filter(Boolean)
  const three = keys.length === 3
  const parts = keys
    .map((key) => {
      const hit = KEY_TO_TYPE.find(([prefix]) => key.startsWith(prefix))
      if (!hit || !missing.includes(hit[1])) return key
      const rank = Number(key.slice(hit[0].length))
      const to = hit[1] === 'twister' ? (three ? smallRewardKey('energy', 1) : null) : smallRewardKey('coins', rank)
      replaced.push({ from: key, to })
      return to
    })
    .filter(Boolean)
  return { syntax: parts.join('+'), replaced }
}

// The event's containers for a CC: { containers: [{ key, syntax, normal, replaced }], rows: [{ tier, weightsByKey,
// noDrop, toNoDrop }], startRank }.
export function ccContainers(boards, recompletionBoards, missing) {
  const model = containersOfEvent(boards, recompletionBoards ?? [])
  const all = model.containers.map((c) => {
    const { syntax, replaced } = ccSyntax(c.syntax, missing)
    return { key: c.key, syntax, normal: c.syntax, replaced }
  })
  // A container left with nothing to give drops nothing: out of the sheets, its weights to NoDrop.
  const emptied = all.filter((c) => !c.syntax)
  const containers = all.filter((c) => c.syntax)
  const startRank = model.startRank ?? 6
  const rows = model.rows.map((row) => {
    const weightsByKey = { ...(row.weightsByKey ?? {}) }
    let moved = 0
    for (const c of emptied) {
      moved += weightsByKey[c.key] ?? 0
      delete weightsByKey[c.key]
    }
    return { tier: row.tier, weightsByKey, noDrop: (row.noDrop ?? 0) + moved, toNoDrop: moved }
  })
  return { containers, emptied, rows, startRank }
}

export function buildCcBankSheet(boards, recompletionBoards, missing) {
  const m = ccContainers(boards, recompletionBoards, missing)
  return { columns: ['Key', 'Syntax'], // (A row the CC changed is highlighted, on screen and in the workbook.)
    rows: m.containers.map((c) => ({ cells: [c.key, c.syntax], replaced: c.replaced.length > 0, highlight: c.replaced.length > 0 })), source: m.containers.length ? 'model' : 'none' }
}

export function buildCcWeightsSheet(boards, recompletionBoards, missing) {
  const m = ccContainers(boards, recompletionBoards, missing)
  return {
    columns: ['Merge Tier', ...m.containers.map((c) => c.key), 'NoDrop'],
    rows: m.rows.map((row) => ({ cells: [row.tier, ...m.containers.map((c) => row.weightsByKey[c.key] ?? 0), row.noDrop], moved: row.toNoDrop > 0, highlight: row.toNoDrop > 0 })),
    source: m.containers.length ? 'model' : 'none',
  }
}

// Every CC as sheets for one workbook: an index ("CC": CC1 = No Twister ...) then each CC's bank and weights.
// (Excel names a sheet in 31 characters at most: "CC7 Small Reward Weights" fits.)
export function ccWorkbookSheets(boards, recompletionBoards) {
  const sheets = [{ name: 'CC', columns: ['CC', 'The player has no'], rows: ccOptions().map((o) => ({ cells: [`CC${o.n}`, o.missing.map((t) => CC_TYPE_LABELS[t]).join(', ')] })) }]
  for (const o of ccOptions()) {
    sheets.push({ name: `CC${o.n} Small Rewards Bank`, ...buildCcBankSheet(boards, recompletionBoards, o.missing) })
    sheets.push({ name: `CC${o.n} Small Reward Weights`, ...buildCcWeightsSheet(boards, recompletionBoards, o.missing) })
  }
  return sheets
}
