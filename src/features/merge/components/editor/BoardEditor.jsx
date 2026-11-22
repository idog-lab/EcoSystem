import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Wand2,
  BookmarkPlus,
  CheckCircle2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Grid2x2,
  ListOrdered,
  Layers,
  Sparkles,
  Gift,
  PiggyBank,
  Dice5,
  CalendarDays,
  Trash2,
  Zap,
  Target,
  Link2,
} from 'lucide-react'
import BoardGrid from './BoardGrid'
import SimulationReport from './SimulationReport'
import EffortDistributionChart from './EffortDistributionChart'
import Card from '../../../../components/ui/Card'
import Button from '../../../../components/ui/Button'
import NumberField from '../../../../components/ui/NumberField'
import Slider from '../../../../components/ui/Slider'
import InfoHint from '../../../../components/ui/InfoHint'
import {
  resizeTiles,
  invalidateLayout,
  applyForcedSemiCell,
  applyForcedHighestRankCell,
  FORCED_SEMI_CELL,
  FORCED_HIGHEST_RANK_CELL,
  FIRST_BOARD_SUBSIDY_CAP_DR,
  RC_FIRST_BOARD_SUBSIDY_CAP_DR,
  RC_MIN_RANK_UNDER_TILES,
  generationTargetOf,
} from '../../lib/core/board'
import { effectiveMinRank, effectiveMaxRank } from '../../lib/core/rankWindow'
import { gridWidthRem } from '../../../../lib/gridWidth'
import { placeItems } from '../../lib/core/placement'
import { simulatePlaythrough } from '../../lib/simulation/mergeSimulation'
import { suggestBoardValuesForEffortTarget } from '../../lib/simulation/effortTargeting'
import { MIN_RANK, MAX_RANK, colorForRank, valueOf } from '../../lib/core/ranks'
import { chaseValue } from '../../lib/core/subsidyBudget'
import { applyPresetToBoard, createPreset } from '../../lib/core/presets'
import { DEFAULT_TARGET_EV, MIN_TARGET_EV, MAX_TARGET_EV, computeProbs, simulateLuckyDrops } from '../../lib/core/luckyDrop'
import { computeEffectiveSubsidy, estimateExpectedCollectibleRewards } from '../../lib/rewards/rewardEconomy'
import { isMainItem, decodeReward, REWARD_TYPE_LABELS } from '../../lib/rewards/rewardChain'

const LUCKY_SIM_TAPS = 450
const LUCKY_SIM_RUNS = 1000

const ALL_RANKS = Array.from({ length: MAX_RANK - MIN_RANK + 1 }, (_, i) => i + MIN_RANK)

// Per-board pass/fail badge for an effort-target suggestion, by explicit
// economist request ("a bubble that shows V for each board between all
// segments boards if it did a good job"). `report` is one entry of
// effortTargeting.js's own `boardReports` - see boardChecks there for exactly
// what "good job" means (at most 5 extra DR, every tile holding an item, rank
// rules satisfied). Renders as a check or a warning triangle, with the real
// reasons on hover rather than a bare red mark the economist then has to go
// hunt the cause of. A board with no blocked/semi tiles at all passes
// trivially (nothing to get wrong) and is shown muted, not green, so a whole
// row of ticks can't read as "great" when half of them are empty boards.
function BoardVerdict({ report }) {
  if (!report) return null
  if (report.tileCount === 0) {
    return (
      <span className="text-[10px] text-slate-300 shrink-0" title="No blocked or semi tiles on this board — nothing to check.">
        —
      </span>
    )
  }
  const notes = report.notes?.length ? `\n\nAlso worth knowing:\n${report.notes.join('\n')}` : ''
  if (report.ok) {
    return (
      <CheckCircle2
        size={14}
        className="text-emerald-500 shrink-0"
        title={`Good: ${report.itemCount}/${report.tileCount} tiles filled, ${report.sum} DR placed, rank rules satisfied.${notes}`}
      />
    )
  }
  return <AlertTriangle size={14} className="text-amber-500 shrink-0" title={report.reasons.join('\n') + notes} />
}

// "3 / 4 boards good" plus, when something failed, the first real reason -
// so the economist can tell at a glance whether applying is safe without
// hovering every badge individually.
function VerdictSummary({ reports, className = 'text-xs' }) {
  if (!reports?.length) return null
  const checkable = reports.filter((r) => r.tileCount > 0)
  if (!checkable.length) return null
  const good = checkable.filter((r) => r.ok).length
  if (good === checkable.length) {
    return (
      <p className={`${className} text-emerald-600 flex items-center gap-1.5`}>
        <CheckCircle2 size={13} className="shrink-0" />
        All {checkable.length} board{checkable.length === 1 ? '' : 's'} came out clean — every tile filled, subsidy on
        target, rank rules satisfied.
      </p>
    )
  }
  const firstBad = checkable.find((r) => !r.ok)
  return (
    <p className={`${className} text-amber-600 flex items-start gap-1.5`}>
      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
      <span>
        {good} / {checkable.length} boards came out clean. First problem: {firstBad.reasons[0]}.
      </span>
    </p>
  )
}

// A chain-level warning `VerdictSummary` can never show on its own, since
// every individual board can look perfectly clean (every tile filled, exact
// sum, rank rules satisfied) while this suggestion STILL strands a real
// chunk of the segment's subsidy - boards that never push in because an
// earlier one never fully clears (see "Board chaining" in CLAUDE.md). Found
// live: a suggestion repeatedly converged to a split that stranded ~6% of a
// segment's total while every per-board badge showed green - the economist
// had no way to see this without separately running the Playthrough
// simulation card afterward. `strandedIssue`/`strandedDr` are already
// folded into `result.issues` (so "N Placement-card warnings" below is
// still accurate), but this gets its own specific, actionable line rather
// than hiding inside a generic count.
function StrandedWarning({ strandedIssue, strandedDr, className = 'text-xs' }) {
  if (!strandedIssue) return null
  return (
    <p className={`${className} text-amber-600 flex items-start gap-1.5`}>
      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
      <span>
        {strandedDr} DR of this segment's subsidy never reaches the player with this split — a board never fully
        clears, so a later one never pushes in. Shift more weight onto the earlier board(s), or lower the later
        board's own value.
      </span>
    </p>
  )
}

// V2 (sections 7/8): per-board CC (Config Change) percent + the energy-
// credit subsidy formula's full breakdown, plus a "Rebuild queue" action
// that regenerates this board's layout against the resulting effective
// subsidy. Deliberately a separate, self-contained card appended after the
// rest of this already-very-large component's own two-row layout, rather
// than threaded into it - this is new, independent V2 machinery that
// doesn't need to participate in the existing layout-locking/sync
// machinery the rest of this file carefully maintains.
function V2EconomyCard({ board, onUpdateBoard, isFirstBoard, noise, boardIndex, readOnly }) {
  const [preview, setPreview] = useState(null)

  const onboarding =
    board.onboardingDrBudget != null && board.onboardingTargetRank != null
      ? { drBudget: board.onboardingDrBudget, targetRank: board.onboardingTargetRank }
      : null

  const { collected } = useMemo(
    () => estimateExpectedCollectibleRewards([board], { rewardChainConfig: board.rewardChainConfig, dropGroupsConfig: board.dropGroupsConfig, dropGroupsById: new Map((board.dropGroups ?? []).map((g) => [g.id, g])), drBudget: 1e6 }),
    [board],
  )
  const subsidy = computeEffectiveSubsidy(board.blockedValue, board.ccPercent ?? 0, collected.energy)

  function updateCcPercent(e) {
    const v = Number(e.target.value)
    onUpdateBoard({ ...board, ccPercent: Number.isFinite(v) ? v / 100 : 0 })
  }

  function previewRebuild() {
    const target = Math.max(0, Math.round(subsidy.effectiveSubsidy))
    const candidate = invalidateLayout(board, { blockedValue: target })
    const generated = placeItems(candidate, { isFirstBoard, noise, onboarding, boardIndex, rcEvent: board.rcEvent })
    setPreview({ target, generated })
  }

  function applyRebuild() {
    if (!preview) return
    onUpdateBoard({ ...board, blockedValue: preview.target, ...preview.generated })
    setPreview(null)
  }

  return (
    <Card
      title="Config Change (CC) — V2"
      subtitle="A per-board subsidy factor, credited against expected collectible energy, before regenerating this board's queue"
      className="mt-4"
    >
      <InfoHint>
        "CC+10% means 10% MORE subsidy (1000×1.10=1100), not allocating 10% of the segment's subsidy to this board."
        Effective subsidy = base × (1 + CC%) − 0.80 × expected collectible energy (predicted by running this board's
        own mixed queue through the simulator, not assumed to hit a target perfectly).
      </InfoHint>
      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="CC %" value={Math.round((board.ccPercent ?? 0) * 100)} onChange={updateCcPercent} disabled={readOnly} />
        <div className="text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Base subsidy</div>
          <div className="font-display font-semibold text-slate-700">{subsidy.baseSubsidy} DR</div>
        </div>
        <div className="text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">CC-adjusted</div>
          <div className="font-display font-semibold text-slate-700">{Math.round(subsidy.ccAdjusted)} DR</div>
        </div>
        <div className="text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Expected energy</div>
          <div className="font-display font-semibold text-slate-700">{subsidy.expectedCollectibleEnergy.toFixed(2)}</div>
        </div>
        <div className="text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Energy credit (80%)</div>
          <div className="font-display font-semibold text-slate-700">−{Math.round(subsidy.energyCredit)} DR</div>
        </div>
        <div className="text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Final effective subsidy</div>
          <div className="font-display font-bold text-purple-700">{Math.round(subsidy.effectiveSubsidy)} DR</div>
        </div>
      </div>
      {!readOnly && (
        <div className="mt-4 flex flex-col gap-2">
          <Button variant="secondary" onClick={previewRebuild}>
            Preview rebuilt queue at effective subsidy
          </Button>
          {preview && (
            <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-3 text-sm">
              <p className="text-slate-600">
                Rebuilding at <strong>{preview.target} DR</strong> (was {board.blockedValue} DR) — new queue sums to{' '}
                <strong>{preview.generated.sum} DR</strong> across {preview.generated.itemCount} items (
                {preview.generated.tileCount} tiles).
              </p>
              <div className="mt-2 flex gap-2">
                <Button variant="primary" size="sm" onClick={applyRebuild}>
                  Apply rebuilt queue
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
                  Discard
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export default function BoardEditor({
  board,
  boards,
  boardIndex,
  isFirstBoard,
  isRecompletion = false,
  presets,
  onChange,
  onUpdateBoard,
  onSavePreset,
  onDeletePreset,
  onUpdateTargetEv,
  onUpdateRankRewards,
  onUpdateGeneratorTiers,
  targetSubsidy,
  onUpdateTargetSubsidy,
  // Recompletion only: the demand is this segment's normal-event demand
  // (App.jsx keeps it in step), so it is shown here and changed there.
  demandFollowsNormal = false,
  onSetBoardCount,
  eventStartDate,
  eventDurationDays,
  onUpdateEventStartDate,
  onUpdateEventDurationDays,
  layoutLocked = false,
  readOnly = false,
  allSegments,
  targetPctInputs,
  onTargetPctInputsChange,
  rcBoards,
  rcVariant,
  onRcVariantChange,
}) {
  // `readOnly`: the "Share planning" link (App.jsx's PlanApp) - a coworker
  // viewing a read-only snapshot, not an economist editing. Folded into the
  // same `locked` gate `layoutLocked` already drives (rows/cols, paint/
  // fill-all, board count, rank rewards) since every one of those needs the
  // identical "don't let this look editable" treatment either way - the two
  // reasons never coexist in practice (PlanApp never passes `layoutLocked`,
  // EditorApp never passes `readOnly`), they just get their own banner copy,
  // since "synced from Segment 1" would be flatly wrong on a shared plan.
  // Everything `layoutLocked` does NOT already cover (Total subsidy's demand
  // field and per-board DR inputs, Generator tiers, Lucky drops' target EV,
  // the Blocked Queue's reorder arrows, Placement's Generate buttons and RC
  // toggle) checks `readOnly` directly instead, since those were never
  // part of the Segment-1-sync feature to begin with. The Effort target and
  // Suggestions cards are hidden outright under `readOnly` - both are
  // iteration tools (redistribute DR, save/apply a layout) with nothing to
  // offer a reviewer, and their own "Apply" actions mutate boards, which
  // doesn't belong in a read-only review link even against a local-only
  // decoded copy. "Run simulation"/"Run lucky-drop simulation" stay fully
  // interactive either way - both are pure, local computations that never
  // write back into the shared board data, and running them on demand is
  // the entire point of "see the full simulator."
  const locked = layoutLocked || readOnly
  const [noise, setNoise] = useState(0.15)
  const [presetName, setPresetName] = useState('')
  const [luckyDropSim, setLuckyDropSim] = useState(null)
  // Committed on blur/Enter only, not per-keystroke like NumberField's other
  // fields - this one adds/removes whole boards, so committing "1" while
  // someone's still typing "15" would delete boards out from under them.
  const [boardCountDraft, setBoardCountDraft] = useState(String(boards.length))

  useEffect(() => setBoardCountDraft(String(boards.length)), [boards.length])

  function commitBoardCount() {
    const n = Math.max(1, Number(boardCountDraft) || boards.length)
    setBoardCountDraft(String(n))
    onSetBoardCount(n)
  }

  const blockedTileCount = useMemo(
    () => board.tiles.flat().filter((s) => s === 'blocked' || s === 'semi').length,
    [board.tiles],
  )

  // Board 2 / Board 3's hardcoded rank floors (rankWindow.js) raise the
  // effective minRank regardless of what's configured — used below instead
  // of the raw board.minRank so the variety check and the overallocation
  // note can't disagree with what generation actually enforced.
  const minRankFloor = effectiveMinRank(board.minRank, boardIndex)
  // Board 1 / Board 2's hardcoded rank ceilings (rankWindow.js) lower the
  // effective maxRank regardless of what's configured — used below instead
  // of the raw board.maxRank so the variety check and the "Short by..."
  // note can't disagree with what generation actually enforced.
  const maxRankCeiling = effectiveMaxRank(board.maxRank, boardIndex)

  const stats = useMemo(() => {
    // itemCount includes reward items (V2 mixed queues) - each occupies a
    // real tile, so the "Items vs. tiles" check must count them. The DR sum
    // counts MAIN items only: a reward item contributes zero main-chain DR
    // (and valueOf(an encoded reward value >= 1000) would be an astronomical
    // 2^1000-class number, exactly the failure mode placement.js's own
    // isMainItem guards already document).
    const itemCount = board.semiPlacements.length + board.blockedQueue.length
    const sum =
      board.semiPlacements.reduce((s, p) => s + (isMainItem(p.rank) ? valueOf(p.rank) : 0), 0) +
      board.blockedQueue.reduce((s, r) => s + (isMainItem(r) ? valueOf(r) : 0), 0)
    // Board 0 only guarantees small ranks (1-3) plus maxRank, not minRank —
    // its variety check is max-only; other boards check both ends.
    const isRange = minRankFloor < maxRankCeiling
    const allRanks = [...board.semiPlacements.map((p) => p.rank), ...board.blockedQueue]
    const hasMax = allRanks.includes(maxRankCeiling)
    const hasRangeVariety = !isRange ? null : isFirstBoard ? hasMax : hasMax && allRanks.includes(minRankFloor)
    return {
      hasLayout: itemCount > 0,
      itemCount,
      sum,
      hasRangeVariety,
      rewardItemCount: board.blockedQueue.filter((r) => !isMainItem(r)).length,
    }
  }, [board.semiPlacements, board.blockedQueue, minRankFloor, maxRankCeiling, isFirstBoard])

  // Board 1's FORCED_SEMI_CELL — and, when rcEvent is on, the adjacent
  // FORCED_HIGHEST_RANK_CELL too (board.js) — are hard invariants of the
  // tile grid itself, not just of generation: re-applied on every tile edit
  // (paint, fill-all, resize, preset-apply, all of which funnel through
  // here) so a brush stroke or preset can never quietly paint over either.
  function forceCells(tiles) {
    const withSemi = applyForcedSemiCell(tiles)
    return board.rcEvent ? applyForcedHighestRankCell(withSemi) : withSemi
  }

  function updateBoard(patch) {
    const nextPatch = isFirstBoard && patch.tiles ? { ...patch, tiles: forceCells(patch.tiles) } : patch
    onChange(invalidateLayout(board, nextPatch))
  }

  function handleDimensionChange(rows, cols) {
    updateBoard({ rows, cols, tiles: resizeTiles(board.tiles, rows, cols) })
  }

  // `semiRank` (only meaningful when state === 'semi') is BoardGrid's
  // "insert a specific rank into a cell as semi blocked" picker - it's
  // stored as a durable forcedSemiRanks override (board.js), not just a
  // one-off paint, so it survives "Generate items" instead of being
  // recomputed away by it (see placement.js's generatePlacement). Every
  // paint - forced or not - first prunes any existing override at (r,c): a
  // cell repainted away from semi can't keep a stale one, and repainting
  // semi with "Auto" (semiRank null) is how the economist clears a
  // previously-forced rank and hands the cell back to generation.
  // FORCED_SEMI_CELL/FORCED_HIGHEST_RANK_CELL are excluded outright - those
  // two pre-existing rules always win at their own fixed cells regardless
  // of anything painted here (see generatePlacement's own matching guard).
  function handlePaint(r, c, state, semiRank) {
    const tiles = board.tiles.map((row) => [...row])
    tiles[r][c] = state
    const isReservedCell =
      isFirstBoard &&
      ((r === FORCED_SEMI_CELL.row && c === FORCED_SEMI_CELL.col) ||
        (r === FORCED_HIGHEST_RANK_CELL.row && c === FORCED_HIGHEST_RANK_CELL.col))
    const forcedSemiRanks = (board.forcedSemiRanks ?? []).filter((f) => !(f.row === r && f.col === c))
    if (state === 'semi' && semiRank != null && !isReservedCell) {
      forcedSemiRanks.push({ row: r, col: c, rank: semiRank })
    }
    updateBoard({ tiles, forcedSemiRanks })
  }

  function handleFillAll(state) {
    const tiles = Array.from({ length: board.rows }, () => Array.from({ length: board.cols }, () => state))
    // Nothing painted by "Fill all" is ever semi (only Open/Blocked are
    // offered), so every existing forced-rank override is necessarily
    // stale afterward.
    updateBoard({ tiles, forcedSemiRanks: [] })
  }

  function handleGenerate() {
    // Belt-and-suspenders alongside updateBoard's own enforcement above — a
    // board that was created and never had its tiles touched (still the
    // plain all-open default from createBoard) would otherwise generate
    // once before the forced cell(s) ever got applied.
    const tiles = isFirstBoard ? forceCells(board.tiles) : board.tiles
    const boardForGeneration = tiles === board.tiles ? board : { ...board, tiles }
    const onboarding =
      isFirstBoard && board.onboardingDrBudget != null && board.onboardingTargetRank != null
        ? { drBudget: board.onboardingDrBudget, targetRank: board.onboardingTargetRank }
        : null
    const rcEvent = isFirstBoard && board.rcEvent
    const generated = placeItems(boardForGeneration, { isFirstBoard, noise, onboarding, boardIndex, rcEvent })
    onChange({
      ...board,
      tiles,
      semiPlacements: generated.semiPlacements,
      blockedQueue: generated.blockedQueue,
      onboardingStatus: generated.onboardingStatus,
    })
  }

  // "Generate items" only ever regenerated the single active board - by
  // explicit economist request ("a placement generate items will generate
  // items for all boards"), this runs the exact same per-board pipeline
  // once per board in the list instead, at this board's own currently-set
  // noise value. A standalone forceCells-equivalent (forceCellsFor) is
  // needed rather than reusing the closure's own forceCells/isFirstBoard,
  // since those are scoped to whichever board is currently ACTIVE - here
  // every board in the loop needs its OWN isFirstBoard-ness (only index 0),
  // its OWN onboarding goal (board 0 only), and its OWN rcEvent, exactly
  // mirroring handleGenerate's own per-board logic rather than assuming the
  // active board's settings apply to all of them. Each board is updated via
  // onUpdateBoard (not the active-board-only onChange) - calling it once per
  // board, synchronously, in a loop is safe: useBoardListState's updateBoard
  // uses React's functional setState form, so N calls in one event handler
  // compose correctly instead of each clobbering the last.
  function handleGenerateAll() {
    boards.forEach((b, i) => {
      const isFirst = i === 0
      const forceCellsFor = (tiles) => {
        const withSemi = applyForcedSemiCell(tiles)
        return b.rcEvent ? applyForcedHighestRankCell(withSemi) : withSemi
      }
      const tiles = isFirst ? forceCellsFor(b.tiles) : b.tiles
      const boardForGeneration = tiles === b.tiles ? b : { ...b, tiles }
      const onboarding =
        isFirst && b.onboardingDrBudget != null && b.onboardingTargetRank != null
          ? { drBudget: b.onboardingDrBudget, targetRank: b.onboardingTargetRank }
          : null
      const rcEvent = isFirst && b.rcEvent
      const generated = placeItems(boardForGeneration, { isFirstBoard: isFirst, noise, onboarding, boardIndex: i, rcEvent })
      onUpdateBoard({
        ...b,
        tiles,
        semiPlacements: generated.semiPlacements,
        blockedQueue: generated.blockedQueue,
        onboardingStatus: generated.onboardingStatus,
      })
    })
  }

  function moveQueueItem(from, to) {
    if (to < 0 || to >= board.blockedQueue.length) return
    const next = [...board.blockedQueue]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    // The onboarding guarantee (if any) was validated against a specific
    // front-loaded order — a manual reorder may no longer honor it, so don't
    // keep claiming it does.
    onChange({ ...board, blockedQueue: next, onboardingStatus: null })
  }

  // Target EV is one shared value across every board in this list, by
  // explicit economist request (see useBoardListState.js's syncTargetEv) -
  // unlike updateBoard's other callers, this writes to EVERY board at once,
  // not just the active one, and never invalidates an already-generated
  // layout (targetEv doesn't affect item generation/placement at all - it's
  // purely a generator-RNG parameter read at play time).
  function updateTargetEv(targetEv) {
    onUpdateTargetEv(targetEv)
  }

  // Generator tier unlock ranks are one shared pair of values across every
  // board in this list, same targetEv/rewardRanks precedent (see
  // useBoardListState.js's syncGeneratorTiers) - every board in a list plays
  // through the same generator ladder, so a customized unlock rank belongs
  // to the event, not to whichever physical board happens to be active.
  // Clamped to the real rank range (never below MIN_RANK or above MAX_RANK)
  // but deliberately NOT forced to keep tier4 above tier2 - unlockedTiers/
  // currentTier (generatorTier.js) pick the highest-cost unlocked tier
  // independently per tier, so an unconventional order (x4 unlocking before
  // x2) still resolves correctly, just unusually; not worth fighting the
  // input over.
  function updateGeneratorTiers(patch) {
    const clamp = (r) => Math.min(Math.max(Math.round(r), MIN_RANK), MAX_RANK)
    const clamped = {}
    if (patch.tier2UnlockRank != null) clamped.tier2UnlockRank = clamp(patch.tier2UnlockRank)
    if (patch.tier4UnlockRank != null) clamped.tier4UnlockRank = clamp(patch.tier4UnlockRank)
    onUpdateGeneratorTiers(clamped)
  }

  // Rank rewards are one shared set across every board in this list, same as
  // targetEv above (see useBoardListState.js's syncRankRewards) - every board
  // covers the same interval of the same event, so a milestone reward belongs
  // to the event's rank ladder rather than to one physical board. Both
  // writers go through onUpdateRankRewards, which writes to EVERY board at
  // once; neither affects generation/placement.
  function toggleRewardRank(rank) {
    const rewardRanks = board.rewardRanks.includes(rank)
      ? board.rewardRanks.filter((r) => r !== rank)
      : [...board.rewardRanks, rank].sort((a, b) => a - b)
    onUpdateRankRewards({ rewardRanks })
  }

  // The actual reward content for a reward rank (e.g. "coins:50") - free
  // text, purely for the "Item Ladder" Ops export (eventSheets.js). Doesn't
  // clear when a rank is un-toggled, so accidentally toggling a rank off
  // and back on doesn't lose whatever was already typed.
  function updateRewardSyntax(rank, syntax) {
    onUpdateRankRewards({ rewardSyntax: { ...board.rewardSyntax, [rank]: syntax } })
  }

  function handleApplyPreset(preset) {
    updateBoard({ tiles: applyPresetToBoard(preset, board.rows, board.cols) })
  }

  function handleSavePreset() {
    if (!presetName.trim()) return
    onSavePreset(createPreset(presetName.trim(), board))
    setPresetName('')
  }

  // The playthrough simulation's own run state lives here, not inside
  // SimulationReport.jsx - EffortDistributionChart.jsx (rendered under the
  // Blocked Queue card) needs the exact same `result` the table does, by
  // explicit economist request ("under the blocked queue... a graph that
  // will show the data from the playthrough simulator"). Lifting it up here
  // is what lets both read one shared run instead of the chart either
  // triggering its own separate simulation (wasteful, and could disagree
  // with the table on DR budget) or duplicating this whole state/effect
  // pair a second time.
  const [simDrBudgetInput, setSimDrBudgetInput] = useState('')
  const [simResult, setSimResult] = useState(null)

  // A stale report (from before ANY board's layout changed) would be
  // misleading - the run spans the whole list, so a later wave board being
  // regenerated invalidates it just as much as board 1 being regenerated.
  // Factored into a named function (not inlined twice) since
  // handleApplySuggestion below needs to compute the SAME key for a board
  // list it's ABOUT to apply, before that list has actually landed in the
  // `boards` prop - the two call sites must never drift apart, or the
  // "already have a fresh result for this exact layout" check below silently
  // stops matching.
  const layoutKeyFor = (list) => list.map((b) => `${b.semiPlacements.length}:${b.blockedQueue.join(',')}`).join('|')
  const simLayoutKey = layoutKeyFor(boards)
  // Tracks which simLayoutKey the CURRENT simResult actually corresponds to
  // - null means "no known-good key" (the ordinary case, where any layout
  // change should invalidate). Set alongside simResult whenever
  // handleApplySuggestion populates it directly from an already-computed
  // suggestion result (see below) - the boards written by that same apply
  // are guaranteed to land at exactly this key on the next render, so the
  // invalidation effect below can recognize "this is the layout I already
  // have a fresh, correct result for" instead of nulling out the very
  // result the economist just asked to see.
  const simResultLayoutKeyRef = useRef(null)
  useEffect(() => {
    if (simResultLayoutKeyRef.current === simLayoutKey) return
    simResultLayoutKeyRef.current = null
    setSimResult(null)
    // A stale effort-target suggestion (see below) is just as misleading as
    // a stale playthrough result once any board's layout has changed out
    // from under it - the suggestion's own `boards` were regenerated
    // against whatever the layout looked like at the moment "Suggest" ran.
    setSuggestion(null)
  }, [simLayoutKey])

  // Same check, but across every board the run will actually walk through -
  // an ungenerated wave board halfway down the list would silently push in
  // as an empty strip and under-report the climb.
  const simUngenerated = boards.filter(
    (b) =>
      b.tiles.some((row) => row.some((s) => s === 'blocked' || s === 'semi')) &&
      b.semiPlacements.length === 0 &&
      b.blockedQueue.length === 0,
  )
  const simNeedsGeneration = simUngenerated.length > 0

  function handleRunSimulation() {
    const trimmed = simDrBudgetInput.trim()
    const drBudget = trimmed === '' ? Infinity : Number(trimmed) || 0
    // 'expected' = the deterministic drop schedule: pressing Run twice on
    // the same boards gives the same report.
    const simOpts = { startIndex: 0, drBudget, dropMode: 'expected' }
    if (rcBoards && rcBoards.length) {
      simOpts.rcBoards = rcBoards
      const rcBoard0 = rcBoards[0]
      simOpts.rewardChainConfig = board.rewardChainConfig
      simOpts.rcRewardChainConfig = rcBoard0.rewardChainConfig
      simOpts.dropGroupsConfig = board.dropGroupsConfig
      simOpts.dropGroupsById = new Map((board.dropGroups ?? []).map((g) => [g.id, g]))
      simOpts.rcDropGroupsConfig = rcBoard0.dropGroupsConfig
      simOpts.rcDropGroupsById = new Map((rcBoard0.dropGroups ?? []).map((g) => [g.id, g]))
    }
    setSimResult(simulatePlaythrough(boards, simOpts))
  }

  // "Effort target": the economist types a target %-per-rank curve and gets
  // suggested board blockedValues (regenerated layouts included) that
  // approach it - see effortTargeting.js's own comment for why this is a
  // search, not a closed-form solve. `targetPctInputs`/`onTargetPctInputsChange`
  // are owned by App.jsx now, not local state here - see its own comment
  // (emptyTargetPctInputs) for why: this component remounts every time the
  // active board changes, and a curve meant to apply across the WHOLE list
  // (or every segment) shouldn't vanish just because the economist clicked a
  // different board in the sidebar to go check something. Values are kept as
  // strings (not numbers) for the same reason NumberField does - an empty
  // field shouldn't snap to 0 mid-edit.
  const [suggestion, setSuggestion] = useState(null)
  // "Apply to all segments" - by explicit economist request ("move the
  // effort target to also apply to all segments"). Off by default (a
  // single click shouldn't touch 3 segments the economist didn't ask
  // about) - when on, the search runs independently once per segment
  // (each keeps its OWN total blocked value; segments are meant to differ
  // in subsidy, so this never pools their DR together) instead of once for
  // just the active one. `multiSuggestion` is a parallel array to
  // `allSegments`, one entry per segment - `suggestion` (above) stays the
  // single-segment shape and is unused while this mode is on.
  const [applyToAllSegments, setApplyToAllSegments] = useState(false)
  const [multiSuggestion, setMultiSuggestion] = useState(null)
  // What "Apply to all segments" actually wrote, kept around so each
  // segment's own effort distribution is visible right here without
  // switching segment tabs - by explicit economist request ("after running
  // the apply to all 4 segments i want to see on each segment what is the
  // effort distribution"). Before this, only the CURRENTLY ACTIVE segment's
  // chart got populated immediately (via showAppliedResult below) - the
  // other three only updated their own EffortDistributionChart the next
  // time their own BoardEditor happened to mount, which in practice meant
  // the economist had to click into each segment one at a time and often
  // hit a blank chart (simResult starts null on every fresh mount) until
  // they manually clicked "Run" again. Same shape as `multiSuggestion`
  // (parallel to `allSegments`, one `{name, result}` per segment) so no new
  // rendering logic was needed beyond reusing EffortDistributionChart per
  // entry - see the render below.
  const [appliedMultiResults, setAppliedMultiResults] = useState(null)
  const [suggesting, setSuggesting] = useState(false)
  const targetPctSum = ALL_RANKS.reduce((sum, rank) => sum + (Number(targetPctInputs[rank]) || 0), 0)
  const totalBoardValue = boards.reduce((sum, b) => sum + b.blockedValue, 0)
  const anySegmentHasValue =
    applyToAllSegments && allSegments
      ? allSegments.some((seg) => seg.boards.reduce((sum, b) => sum + b.blockedValue, 0) > 0)
      : totalBoardValue > 0

  function toggleApplyToAllSegments(checked) {
    setApplyToAllSegments(checked)
    setSuggestion(null)
    setMultiSuggestion(null)
    setAppliedMultiResults(null)
  }

  function handleSuggestEffortTarget() {
    const targetPctByRank = {}
    ALL_RANKS.forEach((rank) => {
      targetPctByRank[rank] = Number(targetPctInputs[rank]) || 0
    })
    setSuggesting(true)
    setSuggestion(null)
    setMultiSuggestion(null)
    setAppliedMultiResults(null)
    // The search itself is synchronous and can take up to ~1.5s per segment
    // (effortTargeting.js's own DEADLINE_MS) - deferred one tick so the
    // "Searching…" disabled-button state actually paints first, rather
    // than the click just freezing with no feedback until it's done.
    setTimeout(() => {
      if (applyToAllSegments && allSegments) {
        setMultiSuggestion(
          allSegments.map((seg) => {
            const segTotal = seg.boards.reduce((sum, b) => sum + b.blockedValue, 0)
            return {
              name: seg.name,
              result: segTotal > 0 ? suggestBoardValuesForEffortTarget(seg.boards, targetPctByRank, { noise }) : null,
            }
          }),
        )
      } else {
        setSuggestion(suggestBoardValuesForEffortTarget(boards, targetPctByRank, { noise }))
      }
      setSuggesting(false)
    }, 20)
  }

  // Populates the "Effort distribution" chart (and the Playthrough
  // simulation table right under it) with the just-applied suggestion's OWN
  // already-computed run, instead of leaving them blank until the economist
  // clicks "Run" a second time - by explicit economist request ("when i
  // apply the spread suggestion, i want to see somewhere on the segment the
  // effort distribution"). `result` here is the raw, unbudgeted
  // simulatePlaythrough() output effortTargeting.js's own search already
  // ran on this exact suggestion (see its `result` field) - reusing it costs
  // nothing extra and can't disagree with what "Apply" is about to write.
  // simDrBudgetInput resets to '' (Unlimited) so the visible budget field
  // matches what's actually being shown - a leftover custom budget from an
  // earlier manual "Run" would otherwise make the chart look artificially
  // truncated right after applying a fresh suggestion.
  function showAppliedResult(appliedBoards, result) {
    simResultLayoutKeyRef.current = layoutKeyFor(appliedBoards)
    setSimResult(result)
    setSimDrBudgetInput('')
  }

  function handleApplySuggestion() {
    if (applyToAllSegments && multiSuggestion && allSegments) {
      // Which entry of allSegments (if any) is the list THIS BoardEditor is
      // currently showing - found by reference, since App.jsx passes the
      // exact same `boards` array both as this component's own prop and as
      // that segment's entry in allSegments. Only that one entry's result
      // (if it has one - a segment with nothing to redistribute has
      // `result: null`, see handleSuggestEffortTarget) gets shown here; the
      // other three segments' own charts update next time THEIR BoardEditor
      // mounts, the same way any other cross-segment write already works.
      const myIndex = allSegments.findIndex((seg) => seg.boards === boards)
      multiSuggestion.forEach(({ result }, i) => {
        if (!result) return
        result.boards.forEach((b) => allSegments[i].onUpdateBoard(b))
        if (i === myIndex) showAppliedResult(result.boards, result.result)
      })
      // Keep every segment's own applied result around (not just the active
      // one) so the per-segment effort-distribution charts below can render
      // immediately - see appliedMultiResults' own comment.
      setAppliedMultiResults(multiSuggestion)
      setMultiSuggestion(null)
      return
    }
    if (!suggestion) return
    suggestion.boards.forEach((b) => onUpdateBoard(b))
    showAppliedResult(suggestion.boards, suggestion.result)
    setSuggestion(null)
  }

  // Sum can legitimately come in ABOVE target (never below) - see
  // generateCandidateInRange/raiseUndersized: when target isn't a multiple
  // of valueOf(minRank), there's no exact way to keep every item at or
  // above minRank, so it rounds up by the smallest amount that fixes that.
  // What the contents were built for: the board's allocation after CC and
  // the energy credit when "Build configuration" set one, else its budget.
  const buildTarget = generationTargetOf(board)
  const hasAllocation = board.effectiveBlockedValue != null && board.effectiveBlockedValue !== board.blockedValue
  const sumOk = stats.hasLayout && stats.sum >= buildTarget
  const overallocated = stats.hasLayout && stats.sum > buildTarget
  const countOk = stats.hasLayout && stats.itemCount === blockedTileCount
  const varietyOk = stats.hasRangeVariety !== false

  const targetEv = board.targetEv ?? DEFAULT_TARGET_EV
  const [pNormal, pPlus1, pPlus2] = computeProbs(targetEv)

  // A cached simulation result would silently go stale the moment targetEv
  // changes underneath it - clear it so a shown result can never be for a
  // different EV than what's currently configured.
  useEffect(() => setLuckyDropSim(null), [targetEv])

  function runLuckyDropSimulation() {
    setLuckyDropSim(simulateLuckyDrops(targetEv, { taps: LUCKY_SIM_TAPS, runs: LUCKY_SIM_RUNS }))
  }

  const totalSubsidy = boards.reduce((sum, b) => sum + b.blockedValue, 0)
  const subsidyGoalMet = targetSubsidy != null && totalSubsidy === targetSubsidy
  const lastBoardInList = boards[boards.length - 1]

  // The Total Subsidy card's own input field is typed/displayed in DEMAND
  // space, not subsidy space directly - by explicit economist request ("the
  // target total subsidy will be something else... the app will calculate
  // the subsidy needed. if i give u 500, the app does 2048-500"). `boards`'
  // own stored `targetSubsidy` field is UNCHANGED underneath (still the real
  // subsidy DR amount the auto-fill effect/progress bar/BoardList's disabled
  // last-board field all already read) - only this component's own
  // input/display converts to and from demand space at the boundary, via
  // the value chain's own total (valueOf(MAX_RANK) = 2048). This is a
  // lossless round-trip (demand = 2048 - subsidy, subsidy = 2048 - demand;
  // applying both in sequence returns the original integer exactly), so no
  // new persisted field or migration was needed - an older save's own
  // `targetSubsidy` number is reinterpreted at the SAME real subsidy value
  // it always was, just displayed/edited in the other unit from now on.
  // What this list's chase has to cover: 2,048 DR for the normal boards;
  // 6,144 DR for Recompletion (rank 14, arriving with a rank 12 in hand).
  const chainValue = chaseValue(isRecompletion ? 'rc' : 'main')
  const targetDemand = targetSubsidy == null ? '' : chainValue - targetSubsidy
  function updateTargetDemand(rawDemand) {
    if (rawDemand === '') {
      onUpdateTargetSubsidy(null)
      return
    }
    const demand = Math.min(Math.max(Number(rawDemand) || 0, 0), chainValue)
    onUpdateTargetSubsidy(chainValue - demand)
  }

  // Auto-fill the LAST board's blockedValue to whatever's needed to hit the
  // target subsidy, by explicit economist request ("auto fill the amount
  // needed to the last board to get to the target subsidy") - so dialing in
  // every OTHER board's own value is enough; the last board becomes an
  // automatic "balancing" figure rather than something manually
  // back-calculated. Deliberately NOT gated on isFirstBoard - this needs to
  // stay correct regardless of which specific board's page happens to be
  // open right now (editing an earlier board's value from ITS OWN page, or
  // the target itself from board 1's Total Subsidy card, both need to
  // re-sync the last board even when it isn't the board currently being
  // viewed - since BoardEditor remounts per selected board, this effect
  // re-runs and catches up the moment the economist navigates back to it
  // too). Clamped to [0, valueOf(MAX_RANK)] matching every other
  // blockedValue edit path; only writes when the computed value actually
  // differs, so this can't loop (recomputing after the write yields the
  // same number, since it only depends on the OTHER boards' sum, which
  // didn't change).
  useEffect(() => {
    if (targetSubsidy == null || !lastBoardInList) return
    const othersSum = boards.slice(0, -1).reduce((sum, b) => sum + b.blockedValue, 0)
    const needed = Math.min(Math.max(targetSubsidy - othersSum, 0), chainValue)
    if (lastBoardInList.blockedValue !== needed) {
      onUpdateBoard(invalidateLayout(lastBoardInList, { blockedValue: needed }))
    }
  }, [targetSubsidy, boards, lastBoardInList, onUpdateBoard, chainValue])

  // Board 1 never carries more than FIRST_BOARD_SUBSIDY_CAP_DR of DR - by
  // explicit economist report: even with a hard per-item rank ceiling
  // (rankWindow.js's effectiveMaxRank), a board with only a handful of tiles
  // still has to pack a lot of value into each one to hit a big blockedValue
  // target, so several items landed at mid-to-high ranks anyway and board 1
  // still took a long climb to clear. Capping board 1's own total (not just
  // its per-item rank ceiling) is what actually keeps its average item
  // small. A fixed DR amount rather than a % of the target, by explicit
  // follow-up request - board 1 should feel the same regardless of how big
  // the segment's own subsidy target is.
  //
  // This is a soft ceiling, not a fixed value - the economist can still
  // freely type anything from 0 up to the cap; only a value ABOVE it snaps
  // back down, the same "only ever tightens, never raises" contract the
  // rank ceiling already uses. The freed-up DR doesn't just vanish - it
  // flows into the LAST board for free, via the auto-fill effect just
  // above (reducing board 1 lowers `othersSum`, so that effect's own
  // `targetSubsidy - othersSum` recompute picks up the difference on its
  // very next run) - no separate redistribution logic needed. Skipped
  // entirely for a single-board list (board 0 IS the last board there, and
  // there's nothing to redistribute the excess to).
  const firstBoardInList = boards[0]
  useEffect(() => {
    if (targetSubsidy == null || boards.length < 2 || !firstBoardInList) return
    const cap = isRecompletion ? RC_FIRST_BOARD_SUBSIDY_CAP_DR : FIRST_BOARD_SUBSIDY_CAP_DR
    if (firstBoardInList.blockedValue > cap) {
      onUpdateBoard(invalidateLayout(firstBoardInList, { blockedValue: cap }))
    }
  }, [targetSubsidy, boards, firstBoardInList, onUpdateBoard, isRecompletion])

  return (
    <div className="flex flex-col gap-6">
      {/* Board 1's grid used to sit alone in a narrow left column, leaving a
          big stretch of empty space beside it on any wide screen while
          Total subsidy/Event schedule - arguably the two most important
          "where does this stage stand" summaries - waited further down the
          page. By explicit economist request ("the upper part now is empty,
          we can take some of the important bubble into this place"), those
          two cards now render in this same top row, filling that space
          instead of only appearing after a scroll. */}
      <div className="flex flex-wrap items-start gap-6">
        <Card
          title={board.name}
          subtitle={`${blockedTileCount} blocked/semi tile${blockedTileCount === 1 ? '' : 's'} to fill`}
          icon={Grid2x2}
          className="shrink-0"
        >
          {layoutLocked && (
            <div className="flex items-start gap-2 text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded-xl px-2.5 py-2 mb-4">
              <Link2 size={13} className="shrink-0 mt-0.5" />
              <span>This board's layout and rank window are synced from Segment 1 — switch there to paint tiles or resize.</span>
            </div>
          )}
          {readOnly && (
            <div className="flex items-start gap-2 text-xs text-slate-600 bg-slate-100 border border-slate-200 rounded-xl px-2.5 py-2 mb-4">
              <Link2 size={13} className="shrink-0 mt-0.5" />
              <span>Read-only shared plan — editing is disabled.</span>
            </div>
          )}
          <div className="flex flex-wrap gap-4 mb-4">
            <NumberField
              label="Rows"
              min={1}
              max={isFirstBoard ? 20 : 3}
              hint={readOnly ? 'Read-only shared plan' : layoutLocked ? 'Synced from Segment 1' : isFirstBoard ? undefined : 'Boards after the first push in as a wave of rows once the previous board clears out — capped at 3'}
              value={board.rows}
              disabled={locked}
              onChange={(e) => handleDimensionChange(Math.min(Number(e.target.value) || 1, isFirstBoard ? 20 : 3), board.cols)}
              className="w-36"
            />
            <NumberField
              label="Columns"
              min={1}
              max={20}
              hint={readOnly ? 'Read-only shared plan' : layoutLocked ? 'Synced from Segment 1' : isFirstBoard ? undefined : "Keep this matching Board 1's columns so the pushed-in rows line up cleanly"}
              value={board.cols}
              disabled={locked}
              onChange={(e) => handleDimensionChange(board.rows, Number(e.target.value) || 1)}
              className="w-36"
            />
          </div>
          <BoardGrid maxBrushRank={isRecompletion ? MAX_RANK + 1 : MAX_RANK} minBrushRank={isRecompletion ? RC_MIN_RANK_UNDER_TILES : 1}
            tiles={board.tiles}
            placements={board.semiPlacements}
            forcedRanks={board.forcedSemiRanks}
            onPaint={locked ? undefined : handlePaint}
            onFillAll={locked ? undefined : handleFillAll}
          />
        </Card>

        {isFirstBoard && (
          <Card
            title="Total subsidy"
            subtitle="Set how much DR the player should spend themselves — the app works out the subsidy needed for the rest, and the last board auto-fills to close the gap"
            icon={PiggyBank}
            className="flex-1 min-w-64"
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-4">
                <label className="text-sm flex flex-col gap-1.5 w-36">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Number of boards</span>
                  <input
                    type="number"
                    min={1}
                    value={boardCountDraft}
                    disabled={locked}
                    title={readOnly ? 'Read-only shared plan' : layoutLocked ? 'Board count is synced from Segment 1 — switch there to change it' : undefined}
                    onChange={(e) => setBoardCountDraft(e.target.value)}
                    onBlur={commitBoardCount}
                    onKeyDown={(e) => e.key === 'Enter' && commitBoardCount()}
                    className="border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-medium bg-white/70 focus:outline-none focus:ring-4 focus:ring-purple-200/60 focus:border-purple-400 transition-shadow disabled:bg-purple-50/50 disabled:text-purple-700 disabled:cursor-not-allowed"
                  />
                </label>
                <NumberField
                  label="Total demand (DR)"
                  min={0}
                  max={chainValue}
                  hint={
                    readOnly
                      ? 'Read-only shared plan'
                      : demandFollowsNormal
                        ? "Same as this segment's demand in the normal event — change it on the Editor tab (or in Build event, Normal phase)"
                        : 'Optional — how much DR the player is expected to spend out of their own effort; the subsidy needed to cover the rest of the chain is computed automatically'
                  }
                  value={targetDemand}
                  disabled={readOnly || demandFollowsNormal}
                  onChange={(e) => updateTargetDemand(e.target.value.trim())}
                  className="w-44"
                />
              </div>
              {targetSubsidy != null && (
                <div className="flex items-center justify-between rounded-xl bg-purple-50/60 border border-purple-100 px-3 py-2 text-sm">
                  <span className="text-slate-600">
                    Subsidy needed ({chainValue.toLocaleString()} − {targetDemand} demand)
                  </span>
                  <span className="font-semibold text-purple-700 tabular-nums">{targetSubsidy} DR</span>
                </div>
              )}
              <InfoHint>
                Board 1 always stays first — boards are added or removed from the end; removing a board deletes its
                layout. When a demand is set, the last board's own value is auto-filled (and locked) to whatever
                subsidy closes the gap — set every other board first.
              </InfoHint>

              <div className="flex items-center justify-between rounded-xl bg-gradient-to-br from-purple-50 to-fuchsia-50 border border-purple-200 px-3 py-2.5">
                <span className="text-sm text-slate-600">Total (all boards)</span>
                <span className="font-display text-2xl font-bold text-purple-700 tabular-nums">{totalSubsidy} DR</span>
              </div>

              {targetSubsidy != null && (
                <div className="flex flex-col gap-1.5">
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        subsidyGoalMet ? 'bg-emerald-500' : 'bg-gradient-to-r from-purple-500 to-fuchsia-500'
                      }`}
                      style={{ width: `${targetSubsidy > 0 ? Math.min(100, (totalSubsidy / targetSubsidy) * 100) : 100}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Goal</span>
                    <span className={`flex items-center gap-1 font-medium ${subsidyGoalMet ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {subsidyGoalMet ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                      {totalSubsidy} / {targetSubsidy} DR
                    </span>
                  </div>
                  {!subsidyGoalMet && (
                    <p className="text-xs text-amber-600">
                      {totalSubsidy < targetSubsidy
                        ? `${targetSubsidy - totalSubsidy} DR short of the target — allocate more to reach it.`
                        : `${totalSubsidy - targetSubsidy} DR over the target — trim some boards' blocked value.`}
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-1">
                {boards.map((b, i) => {
                  // The last board auto-fills to whatever's needed to hit
                  // the target (see the effect above) - its own field is
                  // read-only while a target is set, so it can't look
                  // editable and then silently snap back on the next
                  // render.
                  const isAutoFilled = targetSubsidy != null && i === boards.length - 1
                  const isCapped = targetSubsidy != null && i === 0 && boards.length >= 2
                  const firstBoardCap = isCapped ? (isRecompletion ? RC_FIRST_BOARD_SUBSIDY_CAP_DR : FIRST_BOARD_SUBSIDY_CAP_DR) : null
                  return (
                    <div key={b.id} className="flex items-center justify-between gap-2 text-sm px-1">
                      <span className={`text-slate-600 truncate ${b.id === board.id ? 'font-semibold text-purple-700' : ''}`}>
                        {b.name}
                        <span className="text-slate-400 font-normal"> {i === 0 ? '(start)' : `(wave ${i})`}</span>
                        {isAutoFilled && <span className="text-purple-400 font-normal"> (auto)</span>}
                        {isCapped && <span className="text-purple-400 font-normal"> (≤{firstBoardCap} DR)</span>}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <input
                          type="number"
                          min={0}
                          max={isCapped ? firstBoardCap : chainValue}
                          value={b.blockedValue}
                          disabled={isAutoFilled || readOnly}
                          title={
                            readOnly
                              ? 'Read-only shared plan'
                              : isAutoFilled
                                ? 'Auto-filled to hit the target subsidy — edit an earlier board or the target instead'
                                : isCapped
                                  ? `Board 1 never carries more than ${firstBoardCap} DR — a higher value snaps back down, and the rest flows to the last board`
                                  : undefined
                          }
                          onChange={(e) =>
                            onUpdateBoard(
                              invalidateLayout(b, {
                                blockedValue: Math.min(Math.max(Number(e.target.value) || 0, 0), chainValue),
                              }),
                            )
                          }
                          className={`w-20 text-right border rounded-lg px-2 py-1 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-purple-200/60 focus:border-purple-400 ${
                            isAutoFilled
                              ? 'border-purple-100 bg-purple-50/50 text-purple-700 cursor-not-allowed'
                              : 'border-slate-200 bg-white/70 text-slate-800'
                          }`}
                        />
                        <span className="text-xs text-slate-400 w-5">DR</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </Card>
        )}

        {isFirstBoard && onUpdateEventStartDate && (
          <Card
            title="Event schedule"
            subtitle="When this event runs — feeds the Ops workbook's download filename"
            icon={CalendarDays}
            className="flex-1 min-w-64"
          >
            {layoutLocked && (
              <div className="flex items-start gap-2 text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded-xl px-2.5 py-2 mb-4">
                <Link2 size={13} className="shrink-0 mt-0.5" />
                <span>
                  The event schedule is one date range for the whole event, synced from Segment 1 — switch there to
                  change it.
                </span>
              </div>
            )}
            {readOnly && (
              <div className="flex items-start gap-2 text-xs text-slate-600 bg-slate-100 border border-slate-200 rounded-xl px-2.5 py-2 mb-4">
                <Link2 size={13} className="shrink-0 mt-0.5" />
                <span>Read-only shared plan — editing is disabled.</span>
              </div>
            )}
            <div className="flex flex-wrap gap-4">
              <label className="text-sm flex flex-col gap-1.5 w-44">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Event start date</span>
                <input
                  type="date"
                  value={eventStartDate ?? ''}
                  disabled={locked}
                  onChange={(e) => onUpdateEventStartDate(e.target.value === '' ? null : e.target.value)}
                  className="border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-medium bg-white/70 focus:outline-none focus:ring-4 focus:ring-purple-200/60 focus:border-purple-400 transition-shadow disabled:bg-purple-50/50 disabled:text-purple-700 disabled:cursor-not-allowed"
                />
              </label>
              <NumberField
                label="Number of days"
                min={1}
                value={eventDurationDays ?? 7}
                disabled={locked}
                hint={readOnly ? 'Read-only shared plan' : layoutLocked ? 'Synced from Segment 1' : undefined}
                onChange={(e) => onUpdateEventDurationDays(Math.max(1, Number(e.target.value) || 1))}
                className="w-36"
              />
            </div>
            {!eventStartDate && (
              <p className="text-xs text-slate-400 mt-3">
                Optional — leave unset and the workbook download keeps its plain filename with no dates.
              </p>
            )}
          </Card>
        )}

        {/* Generator tiers/Lucky drops moved up here from the second row -
            by explicit economist request ("the generate tiers and lucky
            drops might be able to go up"). Neither is isFirstBoard-gated
            (both are shared settings across the whole board list, same as
            Total subsidy/Event schedule in spirit), so they now render in
            this same top row on every board's page, not just board 1's. */}
        <Card
          title="Generator tiers"
          subtitle="Rank at which the x2/x4 generator multipliers unlock. Shared across every board in this list."
          icon={Zap}
          className="flex-1 min-w-64"
        >
          <div className="flex flex-col gap-4">
            <NumberField
              label="x2 unlocks at rank"
              min={MIN_RANK}
              max={MAX_RANK}
              step={1}
              hint={readOnly ? 'Read-only shared plan' : '2 DR → a rank-2 item, once the player holds an item at this rank. Also gates lucky drops (below).'}
              value={board.tier2UnlockRank}
              disabled={readOnly}
              onChange={(e) => updateGeneratorTiers({ tier2UnlockRank: Number(e.target.value) || MIN_RANK })}
            />
            <NumberField
              label="x4 unlocks at rank"
              min={MIN_RANK}
              max={MAX_RANK}
              step={1}
              hint={readOnly ? 'Read-only shared plan' : '4 DR → a rank-3 item, once the player holds an item at this rank.'}
              value={board.tier4UnlockRank}
              disabled={readOnly}
              onChange={(e) => updateGeneratorTiers({ tier4UnlockRank: Number(e.target.value) || MIN_RANK })}
            />
            <InfoHint>
              x1 (1 DR → rank 1) is always available and has no unlock rank. These same ranks feed the Ops
              "Multipliers"/"Generator Weights" sheets (Syntax tab) and every play mode (Play Tester, Play Stage, the
              automatic simulator) — nothing reads a fixed rank 7/10 anymore.
            </InfoHint>
          </div>
        </Card>

        <Card
          title="Lucky drops"
          subtitle="Chance the generator drops a higher rank than normal"
          icon={Sparkles}
          className="flex-1 min-w-64"
        >
          <div className="flex flex-col gap-4">
            <NumberField
              label="Target EV multiple"
              min={MIN_TARGET_EV}
              max={MAX_TARGET_EV}
              step={0.01}
              disabled={locked}
              hint={
                readOnly
                  ? 'Read-only shared plan'
                  : layoutLocked
                    ? 'Synced from Segment 1 — lucky-drop EV is one shared value for the whole event, not per segment. Switch there to edit it.'
                    : `Shared across every board in this list — 1.1 = generator taps are worth 10% more value on average, once unlocked — can't exceed ${MAX_TARGET_EV.toFixed(2)} (the model's own ceiling)`
              }
              value={targetEv}
              onChange={(e) => {
                const raw = Math.min(Math.max(Number(e.target.value) || DEFAULT_TARGET_EV, MIN_TARGET_EV), MAX_TARGET_EV)
                // Round to 2dp for display - MAX_TARGET_EV (7/3) isn't a
                // clean decimal, so clamping straight to it would otherwise
                // show "2.3333333333333335" the moment someone types past it.
                updateTargetEv(Math.round(raw * 100) / 100)
              }}
            />

            <div className="flex flex-col gap-2 text-sm bg-slate-50/80 border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Normal (same rank)</span>
                <span className="font-semibold text-slate-800 tabular-nums">{(pNormal * 100).toFixed(1)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">+1 rank</span>
                <span className="font-semibold text-emerald-600 tabular-nums">{(pPlus1 * 100).toFixed(1)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">+2 ranks</span>
                <span className="font-semibold text-purple-600 tabular-nums">{(pPlus2 * 100).toFixed(1)}%</span>
              </div>
            </div>

            <InfoHint>
              Only unlocks once the player holds a rank-{board.tier2UnlockRank} item — same threshold as the x2
              generator tier (see "Generator tiers" above). Every tap before that is a guaranteed normal roll.
            </InfoHint>

            <div className="flex flex-col gap-2 pt-3 border-t border-slate-100">
              <Button variant="secondary" size="sm" icon={Dice5} onClick={runLuckyDropSimulation}>
                Try it: {LUCKY_SIM_TAPS} taps × {LUCKY_SIM_RUNS} players
              </Button>
              {!luckyDropSim ? (
                <InfoHint>
                  Simulates {LUCKY_SIM_TAPS} generator taps at the shared target EV, {LUCKY_SIM_RUNS} times, and
                  averages how many of each type come up — assumes the rank-{board.tier2UnlockRank} gate is already
                  unlocked for the whole run, not a real playthrough reaching it partway through.
                </InfoHint>
              ) : (
                <div className="flex flex-col gap-1.5 text-sm bg-slate-50/80 border border-slate-200 rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Normal (same rank)</span>
                    <span className="font-semibold text-slate-800 tabular-nums">
                      ~{luckyDropSim.normal.mean.toFixed(1)} taps ({luckyDropSim.normal.min}–{luckyDropSim.normal.max})
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">+1 rank</span>
                    <span className="font-semibold text-emerald-600 tabular-nums">
                      ~{luckyDropSim.plus1.mean.toFixed(1)} taps ({luckyDropSim.plus1.min}–{luckyDropSim.plus1.max})
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">+2 ranks</span>
                    <span className="font-semibold text-purple-600 tabular-nums">
                      ~{luckyDropSim.plus2.mean.toFixed(1)} taps ({luckyDropSim.plus2.min}–{luckyDropSim.plus2.max})
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-200">
                    <span className="text-slate-500">Players with zero +1 drops</span>
                    <span className="font-semibold text-emerald-600 tabular-nums">
                      {luckyDropSim.plus1.zeroCount} / {luckyDropSim.runs} ({((luckyDropSim.plus1.zeroCount / luckyDropSim.runs) * 100).toFixed(1)}%)
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Players with zero +2 drops</span>
                    <span className="font-semibold text-purple-600 tabular-nums">
                      {luckyDropSim.plus2.zeroCount} / {luckyDropSim.runs} ({((luckyDropSim.plus2.zeroCount / luckyDropSim.runs) * 100).toFixed(1)}%)
                    </span>
                  </div>

                  <InfoHint className="pt-1">
                    Average over {luckyDropSim.runs} runs of {luckyDropSim.taps} taps each; range shows the min–max
                    across those runs. "Zero drops" counts how many simulated players never saw that bonus at all
                    across all {luckyDropSim.taps} taps — a shut-out rate the average alone can hide.
                  </InfoHint>
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        {/* min-w-0 + a FIXED width (not just a cap): without min-w-0, a flex
            item defaults to min-width:auto (its content's own min-content
            size), so once SimulationReport's table (moved into this column,
            see below) populates with a real result, its `overflow-x-auto`
            table tried to force this WHOLE column wider rather than
            scrolling within its own allotted width - squeezing the cards
            column beside it and visibly resizing every card in THIS column
            too. min-w-0 alone only fixes that under a cramped viewport
            though (nothing stops it from happily expanding into any extra
            room the page does have) - and even a max-w cap still leaves a
            gap between "shrink-to-fit before a result exists" and "hits the
            cap once one does." A genuinely FIXED width (w-[48rem], not
            max-w) closes that gap: this column is exactly the same width
            whether or not SimulationReport has ever been run, so clicking
            "Run" can only fill bars in, never resize or reposition anything
            on the page. Found live, from an economist report that clicking
            "Run" visibly resized/repositioned every card on the page. */}
        <div className="flex flex-col gap-6 min-w-0 w-[48rem] shrink-0">
          <Card title="Blocked queue" subtitle="Reveal order for blocked tiles — reorder to control pacing" icon={ListOrdered}>
            {board.blockedQueue.length === 0 ? (
              <p className="text-sm text-slate-400">Generate items to populate the queue.</p>
            ) : (
              <div className="flex flex-wrap gap-2" style={{ maxWidth: `${gridWidthRem(board.cols)}rem` }}>
                {board.blockedQueue.map((rank, i) => {
                  // A mixed queue's reward entries (V2) render as their own
                  // gold chip - reward type initial + reward rank, never
                  // valueOf (a reward item carries zero main-chain DR).
                  const reward = decodeReward(rank)
                  return (
                  <div key={i} className="flex flex-col items-center gap-1 border border-slate-200 rounded-xl p-1.5 w-16 bg-slate-50/60 hover:border-purple-200 transition-colors">
                    {reward ? (
                      <span
                        className="w-9 h-9 rounded-lg flex flex-col items-center justify-center text-amber-900 text-[10px] font-bold leading-none bg-gradient-to-br from-amber-200 to-yellow-300 shadow-[inset_0_2px_0_rgba(255,255,255,0.5)]"
                        title={`${REWARD_TYPE_LABELS[reward.type]} reward, rank ${reward.rank} - counts toward the collectible payout, not main-chain DR`}
                      >
                        {REWARD_TYPE_LABELS[reward.type].slice(0, 4)}
                        <span className="text-[8px] font-semibold opacity-85">R{reward.rank}</span>
                      </span>
                    ) : (
                    <span
                      className="w-9 h-9 rounded-lg flex flex-col items-center justify-center text-white text-xs font-bold leading-none shadow-[inset_0_2px_0_rgba(255,255,255,0.35)]"
                      style={{ backgroundColor: colorForRank(rank) }}
                    >
                      {rank}
                      <span className="text-[8px] font-semibold opacity-85">{valueOf(rank)}</span>
                    </span>
                    )}
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        title={readOnly ? 'Read-only shared plan' : 'Move earlier'}
                        disabled={i === 0 || readOnly}
                        onClick={() => moveQueueItem(i, i - 1)}
                        className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-20"
                      >
                        <ChevronLeft size={12} />
                      </button>
                      <span className="text-[10px] text-slate-400">{i + 1}</span>
                      <button
                        type="button"
                        title={readOnly ? 'Read-only shared plan' : 'Move later'}
                        disabled={i === board.blockedQueue.length - 1 || readOnly}
                        onClick={() => moveQueueItem(i, i + 1)}
                        className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-20"
                      >
                        <ChevronRight size={12} />
                      </button>
                    </div>
                  </div>
                  )
                })}
              </div>
            )}
          </Card>

          <EffortDistributionChart result={simResult} />

          {/* By explicit economist request ("if we can somehow give the
              simulator around the effort distribution for each rank and to
              get suggestions for blocked queues or board layouts") - an
              inverse-design tool sitting right next to the chart it's
              targeting, so the economist can eyeball the current curve
              above, type a target shape here, and see the achieved curve
              land right below. See effortTargeting.js's own comment for the
              full algorithm writeup (a hill-climb search, same shape
              Diamond Mine's own board generator already uses for its
              analogous "no closed-form inverse" problem) - it only ever
              redistributes the CURRENT total blocked value across boards
              (Total Subsidy, above, owns the total itself), never claims an
              exact hit, and always reports what it actually achieved. Hidden
              entirely under `readOnly` (the "Share planning" link) - it's an
              iteration tool whose own "Apply" mutates board values, which
              has no place in a read-only review link; a reviewer gets the
              simulation results below instead, not the tool for reshaping
              them. */}
          {!readOnly && (
          <Card
            title="Effort target"
            subtitle="Type a target %-per-rank curve and get suggested board values to approach it"
            icon={Target}
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-1.5">
                {ALL_RANKS.map((rank) => (
                  <label key={rank} className="flex flex-col items-center gap-1 w-12">
                    <span
                      className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold"
                      style={{ backgroundColor: colorForRank(rank) }}
                    >
                      {rank}
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      placeholder="0"
                      value={targetPctInputs[rank]}
                      onChange={(e) => onTargetPctInputsChange((prev) => ({ ...prev, [rank]: e.target.value }))}
                      className="w-full text-center border border-slate-200 rounded-lg px-1 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-purple-200/60 focus:border-purple-400"
                    />
                  </label>
                ))}
              </div>
              <p className={`text-xs -mt-1 ${Math.abs(targetPctSum - 100) < 0.5 ? 'text-slate-400' : 'text-amber-600'}`}>
                Typed total: {targetPctSum.toFixed(1)}%
                {Math.abs(targetPctSum - 100) >= 0.5 && " — doesn't need to sum to exactly 100, only the relative shape matters"}
              </p>

              {allSegments && (
                <label className="flex items-center gap-2 text-xs text-slate-500 -mt-1">
                  <input
                    type="checkbox"
                    checked={applyToAllSegments}
                    onChange={(e) => toggleApplyToAllSegments(e.target.checked)}
                    className="rounded border-slate-300 text-purple-600 focus:ring-purple-400"
                  />
                  Apply to all {allSegments.length} segments — each redistributes its own total, independently
                </label>
              )}

              <Button
                variant="primary"
                icon={Target}
                onClick={handleSuggestEffortTarget}
                disabled={suggesting || !anySegmentHasValue}
              >
                {suggesting
                  ? 'Searching…'
                  : applyToAllSegments
                    ? `Suggest board values for all ${allSegments?.length ?? 0} segments`
                    : 'Suggest board values'}
              </Button>
              {!anySegmentHasValue && (
                <p className="text-xs text-amber-600 -mt-2">
                  {applyToAllSegments
                    ? "None of the segments have any DR to redistribute yet — set at least one board's blocked value above 0 somewhere first."
                    : "Set at least one board's blocked value above 0 first (see Total subsidy) — there's no DR to redistribute yet."}
                </p>
              )}

              <InfoHint>
                Redistributes the CURRENT total blocked value across boards — it never changes the total, only where
                it lands. A randomized hill-climb search (up to 400 tries, ~1.5s budget per segment) regenerates and
                re-simulates each candidate using this board's noise value ({noise.toFixed(2)}). Not guaranteed to
                hit the target exactly — closer is better, and the result below always reports what it actually
                achieved rather than claiming a perfect match. With "Apply to all segments" on, each segment's OWN
                total blocked value is redistributed independently — segments are never pooled together, since
                they're meant to differ in subsidy.
              </InfoHint>

              {suggestion && (
                <div className="flex flex-col gap-3 pt-3 border-t border-slate-100">
                  <div className="grid grid-cols-[3rem_1fr_1fr] gap-x-2 gap-y-1 items-center text-xs">
                    <span />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 text-right">Target</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 text-right">Achieved</span>
                    {ALL_RANKS.map((rank) => {
                      const achieved = suggestion.rows.find((r) => r.rank === rank)?.pctOfEffort
                      return (
                        <div key={rank} className="contents">
                          <span className="flex items-center gap-1.5 text-slate-500">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colorForRank(rank) }} />
                            {rank}
                          </span>
                          <span className="text-right tabular-nums text-slate-500">
                            {(Number(targetPctInputs[rank]) || 0).toFixed(1)}%
                          </span>
                          <span className="text-right tabular-nums font-medium text-slate-700">
                            {achieved != null ? `${achieved.toFixed(1)}%` : '—'}
                          </span>
                        </div>
                      )
                    })}
                  </div>

                  <div className="flex flex-col gap-1">
                    {suggestion.boards.map((b, i) => {
                      const before = boards[i]?.blockedValue
                      const changed = before !== b.blockedValue
                      return (
                        <div key={b.id} className="flex items-center justify-between gap-2 text-sm px-1">
                          <span className="flex items-center gap-1.5 min-w-0">
                            <BoardVerdict report={suggestion.boardReports?.[i]} />
                            <span className="text-slate-600 truncate">{b.name}</span>
                          </span>
                          <span className={`tabular-nums font-medium shrink-0 ${changed ? 'text-purple-700' : 'text-slate-400'}`}>
                            {before} → {b.blockedValue} DR
                          </span>
                        </div>
                      )
                    })}
                  </div>

                  <VerdictSummary reports={suggestion.boardReports} />
                  <StrandedWarning strandedIssue={suggestion.strandedIssue} strandedDr={suggestion.strandedDr} />

                  <p className="text-xs text-slate-400">
                    {suggestion.iterations} search iterations
                    {!suggestion.reachedMaxRank &&
                      " — this run's own playthrough stopped before reaching rank 12, so the achieved %s only reflect what it got through"}
                    .
                  </p>
                  {/* Told BEFORE applying, not discovered on the board after -
                      see effortTargeting.js's own `issues` comment. */}
                  {suggestion.issues > 0 && (
                    <p className="text-xs text-amber-600">
                      Heads up: {suggestion.issues} Placement-card warning{suggestion.issues === 1 ? '' : 's'} would
                      still remain after applying this — no arrangement the search could reach avoids them (usually a
                      board whose own tile count and rank window can't represent the DR it needs to hold). Check each
                      board's "Sum vs. target"/"Items vs. tiles" after applying, or adjust that board's tiles/max rank
                      first.
                    </p>
                  )}

                  <div className="flex gap-2">
                    <Button variant="primary" onClick={handleApplySuggestion} className="flex-1">
                      Apply suggested values
                    </Button>
                    <Button variant="secondary" onClick={() => setSuggestion(null)}>
                      Discard
                    </Button>
                  </div>
                </div>
              )}

              {/* Multi-segment mode skips the full per-rank target/achieved
                  table above (12 rows × up to 8 segments would be a lot of
                  scrolling for what's meant to be a quick batch action) and
                  just shows each segment's own before → after board values,
                  same as the single-segment view's own board list. */}
              {multiSuggestion && (
                <div className="flex flex-col gap-4 pt-3 border-t border-slate-100">
                  {multiSuggestion.map(({ name, result }, i) => (
                    <div key={i} className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold text-purple-700">{name}</span>
                      {!result ? (
                        <p className="text-xs text-slate-400">No DR to redistribute — every board's blocked value is 0.</p>
                      ) : (
                        <>
                          <div className="flex flex-col gap-1">
                            {result.boards.map((b, bi) => {
                              const before = allSegments[i].boards[bi]?.blockedValue
                              const changed = before !== b.blockedValue
                              return (
                                <div key={b.id} className="flex items-center justify-between gap-2 text-sm px-1">
                                  <span className="flex items-center gap-1.5 min-w-0">
                                    <BoardVerdict report={result.boardReports?.[bi]} />
                                    <span className="text-slate-600 truncate">{b.name}</span>
                                  </span>
                                  <span className={`tabular-nums font-medium shrink-0 ${changed ? 'text-purple-700' : 'text-slate-400'}`}>
                                    {before} → {b.blockedValue} DR
                                  </span>
                                </div>
                              )
                            })}
                          </div>

                          <VerdictSummary reports={result.boardReports} className="text-[11px]" />
                          <StrandedWarning
                            strandedIssue={result.strandedIssue}
                            strandedDr={result.strandedDr}
                            className="text-[11px]"
                          />
                          <p className="text-[11px] text-slate-400">
                            {result.iterations} search iterations
                            {!result.reachedMaxRank && ' — stopped before reaching rank 12'}.
                          </p>
                          {result.issues > 0 && (
                            <p className="text-[11px] text-amber-600">
                              {result.issues} Placement-card warning{result.issues === 1 ? '' : 's'} would remain on
                              this segment after applying.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  ))}

                  <div className="flex gap-2">
                    <Button variant="primary" onClick={handleApplySuggestion} className="flex-1">
                      Apply to all segments
                    </Button>
                    <Button variant="secondary" onClick={() => setMultiSuggestion(null)}>
                      Discard
                    </Button>
                  </div>
                </div>
              )}

              {/* One full effort-distribution chart per segment, right here
                  - by explicit economist request ("after running the apply
                  to all 4 segments i want to see on each segment what is the
                  effort distribution"). Reuses EffortDistributionChart as-is
                  (same component the single-segment flow already populates
                  via showAppliedResult) rather than inventing a condensed
                  variant - a segment with nothing to redistribute (`result:
                  null`) is skipped here too, matching the before-apply
                  preview's own skip. */}
              {appliedMultiResults && (
                <div className="flex flex-col gap-4 pt-3 border-t border-slate-100">
                  <p className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
                    <CheckCircle2 size={13} className="shrink-0" />
                    Applied — each segment's own resulting effort distribution:
                  </p>
                  {appliedMultiResults.map(({ name, result }, i) =>
                    result ? (
                      <div key={i} className="flex flex-col gap-2">
                        <span className="text-xs font-semibold text-purple-700">{name}</span>
                        <EffortDistributionChart result={result.result} />
                      </div>
                    ) : null,
                  )}
                  <Button variant="secondary" onClick={() => setAppliedMultiResults(null)} className="self-start">
                    Hide
                  </Button>
                </div>
              )}
            </div>
          </Card>
          )}

          {/* Playthrough simulation and Suggestions moved into this same
              stacked column, right under the chart - by explicit economist
              request ("the graphs appear and push all the blocks to
              different places... move the playthrough and suggestions
              under it"). Always runs the whole chain from board 1, not from
              whichever board happens to be selected - so this card reads
              identically on every board in the list. See SimulationReport's
              own comment. Run state itself lives up here now (simResult
              etc.) so EffortDistributionChart, right above, can share the
              exact same result. */}
          {rcVariant && onRcVariantChange && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 font-semibold uppercase tracking-wide">RC variant for simulation</span>
              <div className="flex gap-1">
                {[{ id: 'a', label: 'Recompletion A' }, { id: 'b', label: 'Recompletion B' }].map((v) => (
                  <button
                    key={v.id}
                    onClick={() => onRcVariantChange(v.id)}
                    className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                      rcVariant === v.id
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <SimulationReport
            boards={boards}
            drBudgetInput={simDrBudgetInput}
            onDrBudgetInputChange={setSimDrBudgetInput}
            result={simResult}
            onRun={handleRunSimulation}
            needsGeneration={simNeedsGeneration}
            ungenerated={simUngenerated}
          />

          {/* Hidden entirely under `readOnly` - presets are a local
              iteration aid (save a layout you like, apply it elsewhere), and
              a shared plan's payload never includes them in the first place
              (see planShare.js), so this card would only ever show its own
              empty state there anyway. */}
          {!readOnly && (
          <Card
            title="Suggestions"
            subtitle="Save a layout you like, apply it elsewhere"
            icon={Layers}
          >
            <div className="flex flex-col gap-3">
              {presets.length === 0 ? (
                <p className="text-sm text-slate-400">No saved suggestions yet — design a layout, then save it below.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {presets.map((preset) => (
                    <div
                      key={preset.id}
                      className="group flex items-center gap-1 border border-slate-200 rounded-xl pl-3 pr-1.5 py-2 hover:border-purple-300 hover:bg-purple-50/50 transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => handleApplyPreset(preset)}
                        className="flex-1 min-w-0 text-left text-sm flex items-center justify-between"
                      >
                        <span className="text-slate-700 font-medium truncate">{preset.name}</span>
                        <span className="text-xs text-slate-400 shrink-0 ml-2">{preset.rows}×{preset.cols}</span>
                      </button>
                      {onDeletePreset && (
                        <button
                          type="button"
                          title="Delete suggestion"
                          onClick={() => onDeletePreset(preset.id)}
                          className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shrink-0"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Name this layout..."
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSavePreset()}
                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-4 focus:ring-purple-200/60 focus:border-purple-400"
                />
                <Button icon={BookmarkPlus} onClick={handleSavePreset}>
                  Save
                </Button>
              </div>
            </div>
          </Card>
          )}
        </div>

        <div className="flex flex-wrap gap-6 flex-1 min-w-72">
          <Card
            title="Rank rewards"
            subtitle={
              readOnly
                ? 'Read-only shared plan'
                : layoutLocked
                  ? 'Synced from Segment 1 — switch there to edit which ranks reward, or what they give'
                  : 'Optional — mark ranks that give the player a reward on first reaching them. Shared across every board in this list.'
            }
            icon={Gift}
            className="flex-1 min-w-64"
          >
            <div className={`flex flex-wrap gap-2 ${locked ? 'opacity-70' : ''}`}>
              {ALL_RANKS.map((rank) => {
                const active = board.rewardRanks.includes(rank)
                return (
                  <button
                    key={rank}
                    type="button"
                    disabled={locked}
                    onClick={() => toggleRewardRank(rank)}
                    title={
                      readOnly
                        ? 'Read-only shared plan'
                        : layoutLocked
                          ? 'Synced from Segment 1 — switch there to edit it'
                          : active
                            ? `Rank ${rank} gives a reward — click to remove`
                            : `Mark rank ${rank} as a reward rank`
                    }
                    className={`relative w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold shadow-[inset_0_2px_0_rgba(255,255,255,0.35)] transition-all ${
                      active ? 'ring-2 ring-offset-2 ring-offset-white ring-amber-400' : 'opacity-40 hover:opacity-70'
                    } ${locked ? 'cursor-not-allowed' : ''}`}
                    style={{ backgroundColor: colorForRank(rank) }}
                  >
                    {rank}
                    {active && (
                      <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-amber-400 text-white flex items-center justify-center shadow">
                        <Gift size={10} strokeWidth={3} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {board.rewardRanks.length === 0 ? (
              <p className="text-xs text-slate-400 mt-3">No reward ranks set — entirely optional, doesn't affect generation.</p>
            ) : (
              <div className="flex flex-col gap-2 mt-4 pt-3 border-t border-slate-100">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Milestone reward syntax
                </span>
                {board.rewardRanks.map((rank) => (
                  <label key={rank} className="flex items-center gap-2 text-sm">
                    <span
                      className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: colorForRank(rank) }}
                    >
                      {rank}
                    </span>
                    <input
                      type="text"
                      placeholder="e.g. coins:50 or coins:1500,sticker-r2:1"
                      value={board.rewardSyntax[rank] ?? ''}
                      disabled={locked}
                      onChange={(e) => updateRewardSyntax(rank, e.target.value)}
                      className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-4 focus:ring-purple-200/60 focus:border-purple-400 transition-shadow disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                    />
                  </label>
                ))}
              </div>
            )}
          </Card>

          <Card
            title="Placement"
            subtitle="Generate items and place them by distance-to-player"
            icon={Wand2}
            className="flex-1 min-w-64"
          >
            <div className="flex flex-col gap-4">
              {isFirstBoard && isRecompletion && (
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    disabled={readOnly}
                    title={readOnly ? 'Read-only shared plan' : undefined}
                    onClick={() => updateBoard({ rcEvent: !board.rcEvent })}
                    className={`flex items-center justify-between gap-2 text-sm font-semibold px-3 py-2.5 rounded-xl border transition-colors ${
                      board.rcEvent
                        ? 'border-purple-300 bg-gradient-to-r from-purple-50 to-fuchsia-50 text-purple-700'
                        : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                    } ${readOnly ? 'cursor-not-allowed opacity-70' : ''}`}
                  >
                    <span>RC event mode</span>
                    <span
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                        board.rcEvent ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          board.rcEvent ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </span>
                  </button>
                  <InfoHint>
                    Row 2 / col 4 keeps its fixed rank 2 either way. When on, the cell right next to it (row 2 /
                    col 5) is also forced semi-blocked and holds the highest-rank item that would've gone in the
                    blocked queue — visible from the start instead of hidden.
                  </InfoHint>
                </div>
              )}

              {!readOnly && (
                <>
                  <Slider
                    label="Noise"
                    valueLabel={noise.toFixed(2)}
                    min={0}
                    max={1}
                    step={0.05}
                    value={noise}
                    onChange={(e) => setNoise(Number(e.target.value))}
                  />
                  <Button variant="primary" icon={Wand2} onClick={handleGenerate} className="w-full">
                    Generate items
                  </Button>

                  <Button variant="secondary" icon={Wand2} onClick={handleGenerateAll} className="w-full">
                    Generate items for all {boards.length} boards
                  </Button>
                  <InfoHint>
                    Regenerates every board in this list at once, each with its own settings (onboarding goal, RC
                    event, forced ranks) — using this board's noise value ({noise.toFixed(2)}) for all of them.
                  </InfoHint>
                </>
              )}

              {stats.hasLayout && (
                <div className="flex flex-col gap-2 text-sm bg-slate-50/80 border border-slate-200 rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Sum vs. target</span>
                    <span className={`flex items-center gap-1 font-medium ${sumOk ? 'text-emerald-600' : 'text-red-600'}`}>
                      {sumOk ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                      {stats.sum} / {buildTarget}
                      {hasAllocation && (
                        <span className="ml-1 text-[11px] font-normal text-slate-400" title="Built by Build configuration: the budget after CC and the 80% energy credit">
                          (budget {board.blockedValue}, built allocation {buildTarget})
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Items vs. tiles</span>
                    <span className={`flex items-center gap-1 font-medium ${countOk ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {countOk ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                      {stats.itemCount} / {blockedTileCount}
                    </span>
                  </div>
                  {stats.hasRangeVariety !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">{isFirstBoard ? 'Max tier present' : 'Min & max both present'}</span>
                      <span className={`flex items-center gap-1 font-medium ${varietyOk ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {varietyOk ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                        {varietyOk ? 'yes' : 'no'}
                      </span>
                    </div>
                  )}
                  {overallocated && (
                    <p className="text-xs text-amber-600">
                      Rounded up by {stats.sum - buildTarget} DR — {buildTarget} isn't a multiple of{' '}
                      {valueOf(minRankFloor)} (this board's min rank's value), so keeping every item at rank{' '}
                      {minRankFloor}+ needs slightly more than the exact target.
                    </p>
                  )}
                  {stats.hasLayout && !sumOk && !overallocated && (
                    <p className="text-xs text-red-600">
                      Short by {buildTarget - stats.sum} DR — this board's tile count and max rank ({maxRankCeiling}
                      {maxRankCeiling !== board.maxRank && `, hard-capped from ${board.maxRank} at this board position`}) can
                      together only ever hold {stats.sum} DR at most. Raise max rank, add more blocked/semi tiles, or lower
                      this board's target value to close the gap.
                    </p>
                  )}
                  {!countOk && <p className="text-xs text-amber-600">Best-effort undershoot — rank window couldn't be fully satisfied.</p>}
                  {!varietyOk && (
                    <p className="text-xs text-amber-600">
                      {isFirstBoard
                        ? 'Not enough DR to reserve the small-rank set plus a max-rank item.'
                        : 'Not enough DR to reserve one min-rank and one max-rank item on this board.'}
                    </p>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
      <V2EconomyCard
        board={board}
        onUpdateBoard={onUpdateBoard}
        isFirstBoard={isFirstBoard}
        noise={noise}
        boardIndex={boardIndex}
        readOnly={readOnly}
      />
    </div>
  )
}
