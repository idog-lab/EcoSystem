// Recovery of an older second Recompletion list ("Recompletion B").
//
// There is one Recompletion mode. A project saved when a second list existed
// keeps that list in segment.legacyRecompletionB - inactive: not played, not
// built, not exported. Bringing it back is an explicit, previewed operation;
// nothing here ever runs on its own, and every recovery records a snapshot
// (segment.recompletionRecovery) it can be undone from.
//
// What a recovered board keeps: its own layout, budget, rank limits, pinned
// ranks, pinned reward items and CC. What it does NOT bring: its old reward
// definitions, merge drops and generator settings - those are one shared
// configuration per list, so a recovered board adopts the current
// Recompletion list's. Its generated contents are cleared (they were built
// for a different configuration), which leaves the list to be rebuilt.

// The list-shared fields a board takes from the list it joins.
const LIST_SHARED_FIELDS = [
  'targetEv',
  'tier2UnlockRank',
  'tier4UnlockRank',
  'rewardRanks',
  'rewardSyntax',
  'rewardChainConfig',
  'dropGroups',
  'dropGroupsConfig',
  'smallRewardsBankConfig',
  'smallRewardWeightsConfig',
  'minDropRank',
  'rewardLeftoverPolicy',
  'twisterSpinCost',
  'twisterSpinObjective',
  'twisterCostBasis',
]

function adopt(board, currentBoard0, { asWave }) {
  const shared = {}
  for (const field of LIST_SHARED_FIELDS) if (currentBoard0?.[field] !== undefined) shared[field] = JSON.parse(JSON.stringify(currentBoard0[field]))
  const rows = asWave ? Math.min(board.rows, 3) : board.rows
  return {
    ...board,
    ...shared,
    id: crypto.randomUUID(),
    rows,
    tiles: board.tiles.slice(0, rows),
    forcedSemiRanks: (board.forcedSemiRanks ?? []).filter((f) => f.row < rows),
    rewardQueueItems: (board.rewardQueueItems ?? []).filter((it) => !it.auto),
    rewardSemiItems: (board.rewardSemiItems ?? []).filter((it) => !it.auto && it.row < rows),
    semiPlacements: [],
    blockedQueue: [],
    onboardingStatus: null,
    effectiveBlockedValue: null,
    buildStamp: null,
  }
}

const describe = (b, from) => ({
  name: b.name,
  rows: b.rows,
  cols: b.cols,
  budget: b.blockedValue ?? 0,
  rewardPins: (b.rewardQueueItems ?? []).filter((it) => !it.auto).length + (b.rewardSemiItems ?? []).filter((it) => !it.auto).length,
  from,
})

export function recoveredBoards({ action, currentBoards, legacy }) {
  const board0 = currentBoards[0]
  if (action === 'append') return [...currentBoards, ...legacy.boards.map((b) => adopt(b, board0, { asWave: true }))]
  if (action === 'replace') return legacy.boards.map((b, i) => adopt(b, board0, { asWave: i > 0 }))
  return currentBoards
}

// What an action would do, without doing it.
export function planLegacyRecovery({ action, currentBoards, legacy }) {
  const next = recoveredBoards({ action, currentBoards, legacy })
  const before = currentBoards.map((b) => describe(b, 'current'))
  const after =
    action === 'append'
      ? [...before, ...next.slice(currentBoards.length).map((b) => describe(b, 'legacy'))]
      : action === 'replace'
        ? next.map((b) => describe(b, 'legacy'))
        : before
  const total = (list) => list.reduce((s, b) => s + b.budget, 0)
  const legacyGroups = legacy.boards[0]?.dropGroups?.length ?? 0
  const trimmed = action === 'discard' ? 0 : legacy.boards.filter((b, i) => (action === 'append' || i > 0) && b.rows > 3).length
  const effects = []
  if (action === 'discard') {
    effects.push('The current Recompletion boards are not changed.')
    effects.push('The older list is removed from this project (it stays in the recovery snapshot until you dismiss that).')
  } else {
    effects.push(
      action === 'append'
        ? `The ${legacy.boards.length} recovered board${legacy.boards.length === 1 ? ' is' : 's are'} added after the current ${currentBoards.length}, to be played in sequence. Recompletion stays one mode.`
        : `The current ${currentBoards.length} Recompletion board${currentBoards.length === 1 ? ' is' : 's are'} replaced by the ${legacy.boards.length} recovered one${legacy.boards.length === 1 ? '' : 's'}.`,
    )
    effects.push(`Subsidy budget goes from ${total(before)} DR to ${total(after)} DR. Each recovered board keeps its own budget, rank limits, pinned ranks and pinned reward items.`)
    effects.push(
      `Reward definitions, merge drops and generator settings stay those of the current Recompletion list${legacyGroups ? ` - the older list's own ${legacyGroups} drop group${legacyGroups === 1 ? '' : 's'} and reward values are not brought in` : ''}.`,
    )
    if (trimmed) effects.push(`${trimmed} recovered board${trimmed === 1 ? '' : 's'} taller than 3 rows will be cut to 3 rows, because every board after the first pushes in as a strip of at most 3.`)
    effects.push('The recovered boards come in without generated contents, so Recompletion will need rebuilding in Build event before it can be tested or exported.')
  }
  return { action, before, after, beforeTotal: total(before), afterTotal: total(after), effects }
}

// Performs a confirmed recovery. Writes the snapshot first.
export function applyLegacyRecovery({ action, segment, list }) {
  const legacy = segment.legacyRecompletionB
  if (!legacy) return
  segment.setRecompletionRecovery({
    at: Date.now(),
    action,
    previous: { boards: list.boards, presets: list.presets, targetSubsidy: list.targetSubsidy },
    legacy,
  })
  if (action !== 'discard') {
    list.replaceAll({
      boards: recoveredBoards({ action, currentBoards: list.boards, legacy }),
      presets: list.presets,
      targetSubsidy: action === 'replace' ? (legacy.targetSubsidy ?? null) : list.targetSubsidy,
    })
  }
  segment.setLegacyRecompletionB(null)
}

// Puts both lists back exactly as the snapshot recorded them.
export function undoLegacyRecovery({ segment, list }) {
  const recovery = segment.recompletionRecovery
  if (!recovery) return
  list.replaceAll(recovery.previous)
  segment.setLegacyRecompletionB(recovery.legacy)
  segment.setRecompletionRecovery(null)
}
