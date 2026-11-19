import { useState } from 'react'
import { withMinRankFloor, withListPhase, createBoard, cloneBoard } from '../core/board'
import { DEFAULT_TARGET_EV } from '../core/luckyDrop'
import { DEFAULT_TIER2_UNLOCK_RANK, DEFAULT_TIER4_UNLOCK_RANK } from '../core/generatorTier'
import { createRewardChainConfig } from '../rewards/rewardChain'
import { createDropGroupsConfig, DEFAULT_MIN_DROP_RANK } from '../rewards/dropGroups'
import { createSmallRewardsBankConfig, createSmallRewardWeightsConfig } from '../rewards/smallRewardsBank'
import { RC_MAX_RANK } from '../core/ranks'

// Everything App.jsx's EditorApp needs to own one ordered board list (which
// board's active, add/duplicate/remove/reorder, bulk board-count, saved
// presets, an optional target-subsidy goal) - extracted so a second,
// independent board list (Recompletion) can reuse the exact same CRUD
// behavior instead of duplicating ~80 lines of handlers verbatim. Every
// method here is copied as-is from EditorApp's original inline
// implementation, just parameterized over this hook's own state slice -
// the main board list's behavior is unchanged, not just "similar."
export function useBoardListState({ boards: initialBoards, presets: initialPresets = [], targetSubsidy: initialTargetSubsidy = null }, { minRankFloor = 1, phase = null } = {}) {
  // A list can have a lowest rank its boards may never go below (the
  // Recompletion list: rank 3 - see board.js). Applied to EVERY write of the
  // list, so no editor, sync, quick fix or import can leave a board under it.
  // The list also stamps its phase on every board ('rc' for Recompletion -
  // see board.js: isRecompletionBoard).
  const floorAll = (bs) => {
    if (!(minRankFloor > 1) && !phase) return bs
    const next = bs.map((b) => withListPhase(minRankFloor > 1 ? withMinRankFloor(b, minRankFloor) : b, phase))
    return next.every((b, i) => b === bs[i]) ? bs : next
  }
  const [boards, setBoardsRaw] = useState(() => floorAll(initialBoards))
  const setBoards = (next) => setBoardsRaw((prev) => floorAll(typeof next === 'function' ? next(prev) : next))
  const [presets, setPresets] = useState(initialPresets)
  const [targetSubsidy, setTargetSubsidy] = useState(initialTargetSubsidy)
  const [activeId, setActiveId] = useState(() => initialBoards[0].id)

  const activeIndex = boards.findIndex((b) => b.id === activeId)
  const activeBoard = boards[activeIndex] ?? boards[0]

  function updateBoard(updated) {
    setBoards((bs) => bs.map((b) => (b.id === updated.id ? updated : b)))
  }

  // The fields that are ONE shared value across this whole list rather than
  // per-board dials (see syncTargetEv / syncRankRewards below). A freshly
  // created board has to inherit them from board 0 instead of falling back
  // to createBoard's plain defaults, or it would immediately break that
  // invariant the moment it's added.
  function sharedFields() {
    return {
      targetEv: boards[0]?.targetEv ?? DEFAULT_TARGET_EV,
      rewardRanks: [...(boards[0]?.rewardRanks ?? [])],
      rewardSyntax: { ...(boards[0]?.rewardSyntax ?? {}) },
      tier2UnlockRank: boards[0]?.tier2UnlockRank ?? DEFAULT_TIER2_UNLOCK_RANK,
      tier4UnlockRank: boards[0]?.tier4UnlockRank ?? DEFAULT_TIER4_UNLOCK_RANK,
      // V2: reward-chain ladder + drop-group tables are event-level, shared
      // across this whole list - same reasoning as targetEv/rewardRanks
      // above. Deep-cloned (JSON round-trip) so a new board never shares a
      // mutable reference with board 0's own config.
      rewardChainConfig: JSON.parse(JSON.stringify(boards[0]?.rewardChainConfig ?? createRewardChainConfig())),
      dropGroups: JSON.parse(JSON.stringify(boards[0]?.dropGroups ?? [])),
      dropGroupsConfig: JSON.parse(JSON.stringify(boards[0]?.dropGroupsConfig ?? createDropGroupsConfig(RC_MAX_RANK))),
      smallRewardsBankConfig: JSON.parse(JSON.stringify(boards[0]?.smallRewardsBankConfig ?? createSmallRewardsBankConfig())),
      smallRewardWeightsConfig: JSON.parse(JSON.stringify(boards[0]?.smallRewardWeightsConfig ?? createSmallRewardWeightsConfig())),
      minDropRank: boards[0]?.minDropRank ?? DEFAULT_MIN_DROP_RANK,
      multiDropRank: boards[0]?.multiDropRank ?? null,
      tripleDropRank: boards[0]?.tripleDropRank ?? null,
      soloDropRank: boards[0]?.soloDropRank ?? null,
      rankValuesByBuild: boards[0]?.rankValuesByBuild ?? null,
      tileRewardType: boards[0]?.tileRewardType ?? null,
      twisterByBuild: boards[0]?.twisterByBuild ?? null,
      twisterSteady: boards[0]?.twisterSteady ?? null,
      steadyDrops: boards[0]?.steadyDrops ?? null,
      rewardLeftoverPolicy: boards[0]?.rewardLeftoverPolicy ?? 'collect',
      twisterSpinCost: boards[0]?.twisterSpinCost ?? null,
      twisterSpinObjective: boards[0]?.twisterSpinObjective ?? null,
    }
  }

  function addBoard() {
    // Always appended, so never board 0 - it'll be pushed in as a wave once
    // an earlier board clears out (see CLAUDE.md's Play Tester section),
    // and waves are capped at 3 rows.
    const board = { ...createBoard(`Board ${boards.length + 1}`, { rows: 3 }), ...sharedFields() }
    setBoards((bs) => [...bs, board])
    setActiveId(board.id)
  }

  function duplicateBoard(id) {
    const board = boards.find((b) => b.id === id)
    const copy = cloneBoard(board)
    const idx = boards.findIndex((b) => b.id === id)
    setBoards((bs) => [...bs.slice(0, idx + 1), copy, ...bs.slice(idx + 1)])
    setActiveId(copy.id)
  }

  function removeBoard(id) {
    if (boards.length <= 1) return
    setBoards((bs) => bs.filter((b) => b.id !== id))
    if (activeId === id) {
      const remaining = boards.filter((b) => b.id !== id)
      setActiveId(remaining[0].id)
    }
  }

  function moveBoard(from, to) {
    if (to < 0 || to >= boards.length) return
    setBoards((bs) => {
      const next = [...bs]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  // Bulk add/remove from the end to reach `count` - same never-touch-board-0
  // rule as addBoard/removeBoard, just applied N times at once from the
  // Total Subsidy card instead of one board at a time from the sidebar.
  function setBoardCount(count) {
    const target = Math.max(1, count)
    if (target === boards.length) return
    if (target > boards.length) {
      const shared = sharedFields()
      const additions = Array.from({ length: target - boards.length }, (_, i) => ({
        ...createBoard(`Board ${boards.length + i + 1}`, { rows: 3 }),
        ...shared,
      }))
      setBoards((bs) => [...bs, ...additions])
      return
    }
    const next = boards.slice(0, target)
    setBoards(next)
    if (!next.some((b) => b.id === activeId)) setActiveId(next[0].id)
  }

  function savePreset(preset) {
    setPresets((ps) => [...ps, preset])
  }

  function removePreset(id) {
    setPresets((ps) => ps.filter((p) => p.id !== id))
  }

  function updateTargetSubsidy(value) {
    setTargetSubsidy(value)
  }

  // Lucky-drop target EV is meant to be one shared value across every board
  // in this list, by explicit economist request - reversing the earlier
  // per-board-variation design (see CLAUDE.md's "Lucky drops" section).
  // Writes the same value onto every board at once rather than just the
  // active one, so there's nothing left to "enter again" on another board.
  function syncTargetEv(value) {
    setBoards((bs) => bs.map((b) => ({ ...b, targetEv: value })))
  }

  // Rank rewards (`rewardRanks` - which ranks are reward checkpoints - and
  // `rewardSyntax` - what each one actually gives) are likewise one shared
  // set across every board in this list, by explicit economist request:
  // every board in a list belongs to the same interval of the same event, so
  // a milestone reward hangs off the event's own 1-12 rank ladder, not off
  // whichever physical board the player happened to be standing on when they
  // hit that rank. Takes a partial patch (either field, or both) and writes
  // it onto every board at once, same one-write-path shape as syncTargetEv.
  // Like targetEv, this never invalidates a generated layout - neither field
  // feeds generation, placement or simulation at all.
  function syncRankRewards(patch) {
    setBoards((bs) => bs.map((b) => ({ ...b, ...patch })))
  }

  // Generator tier unlock ranks (tier2UnlockRank/tier4UnlockRank - which
  // rank the x2/x4 generator tiers unlock at) are likewise one shared pair
  // of values across every board in this list, by explicit economist
  // request - same reasoning and same mechanism as targetEv/rewardRanks
  // above: every board here plays through the same generator-tier ladder,
  // so a customized unlock rank belongs to the event/segment, not to
  // whichever physical board happens to be active. Feeds generation/
  // placement not at all (this only ever governs the generator at PLAY
  // time - mergeSimulation.js/playSession.js), so, like syncTargetEv, this
  // never invalidates an already-generated layout.
  function syncGeneratorTiers(patch) {
    setBoards((bs) => bs.map((b) => ({ ...b, ...patch })))
  }

  // V2: reward-chain ladder + drop-group tables, same one-shared-value-per-
  // list mechanism as syncTargetEv/syncRankRewards/syncGeneratorTiers above.
  // Like those, feeds neither generation nor placement - purely a config
  // surface consumed at play/simulation time and by Ops export.
  function syncRewardConfig(patch) {
    setBoards((bs) => bs.map((b) => ({ ...b, ...patch })))
  }

  // V2: CC (Config Change) percent is per-board, NOT shared across the list
  // - it's a per-board planning lever (section 8), unlike targetEv/
  // rewardRanks/the reward-chain config above.
  function updateCcPercent(boardId, ccPercent) {
    setBoards((bs) => bs.map((b) => (b.id === boardId ? { ...b, ccPercent } : b)))
  }

  // Wholesale swap of this entire board list's state - used by backup
  // restore (App.jsx's import handler) to replace everything in one shot
  // rather than reconciling against whatever's currently loaded. Not used
  // by any incremental editing path.
  function replaceAll({ boards: nextBoards, presets: nextPresets = [], targetSubsidy: nextTargetSubsidy = null }) {
    setBoards(nextBoards)
    setPresets(nextPresets)
    setTargetSubsidy(nextTargetSubsidy)
    setActiveId(nextBoards[0]?.id)
  }

  return {
    boards,
    presets,
    targetSubsidy,
    activeId,
    activeBoard,
    activeIndex,
    setActiveId,
    updateBoard,
    addBoard,
    duplicateBoard,
    removeBoard,
    moveBoard,
    setBoardCount,
    savePreset,
    removePreset,
    updateTargetSubsidy,
    syncTargetEv,
    syncRankRewards,
    syncGeneratorTiers,
    syncRewardConfig,
    updateCcPercent,
    replaceAll,
  }
}
