import { useState, useRef, useEffect } from 'react'
import { setEffortTargetForBuild } from './features/merge/lib/build/eventBuild'
import { laddersOfEvent } from './features/merge/lib/build/prizeLadder'
import { Save, Puzzle, LayoutGrid, RotateCcw, Gamepad2, Boxes, FileCode2, Share2, Eye, Check, TriangleAlert, ArrowLeft, Download, Upload, Trash2, Gift, Tornado, Hammer, Menu, Info, Plus, CalendarDays } from 'lucide-react'
import BoardList from './features/merge/components/editor/BoardList'
import BoardEditor from './features/merge/components/editor/BoardEditor'
import PlayTester from './features/merge/components/play/PlayTester'
import CCManagement from './features/merge/components/editor/CCManagement'
import SyntaxPage from './features/merge/components/export/SyntaxPage'
import RewardsPage from './features/merge/components/rewards/RewardsPage'
import TwisterPage from './features/merge/components/rewards/TwisterPage'
import BuildEventPage from './features/merge/components/build/BuildEventPage'
import LegacyRecompletionRecovery from './features/merge/components/build/LegacyRecompletionRecovery'
import PlayStage from './features/merge/components/play/PlayStage'
import { loadEconomy, saveEconomy } from './lib/economy/economyStore'
import { normalizeEconomy } from './lib/economy/economyModel'
import Button from './components/ui/Button'
import Card from './components/ui/Card'
import { RC_MIN_RANK_UNDER_TILES, RC_FIRST_BOARD_SUBSIDY_CAP_DR, createBoard, invalidateLayout } from './features/merge/lib/core/board'
import { rcSubsidyForMainSubsidy, spreadSubsidy, fillLastBoard } from './features/merge/lib/core/subsidyBudget'
import { useBoardListState } from './features/merge/lib/state/useBoardListState'
import { loadState, saveState, clearState } from './features/merge/lib/state/persistence'
import { listSavedEvents, saveEvent, loadEvent, renameEvent, deleteEvent, openEventId, setOpenEventId } from './features/merge/lib/state/savedEvents'
import SavedEventsPanel from './features/merge/components/SavedEventsPanel'
import EventSwitcher from './features/merge/components/EventSwitcher'
import { DEFAULT_TARGET_EV } from './features/merge/lib/core/luckyDrop'
import { DEFAULT_TIER2_UNLOCK_RANK, DEFAULT_TIER4_UNLOCK_RANK } from './features/merge/lib/core/generatorTier'
import { encodeStage, decodeStage, MAX_SAFE_STAGE_CHARS } from './features/merge/lib/share/stageShare'
import { encodePlan, decodePlan, MAX_SAFE_PLAN_CHARS } from './features/merge/lib/share/planShare'
import { createDefaultStage } from './features/merge/data/defaultStage'
import { MIN_RANK, MAX_RANK, RC_MAX_RANK } from './features/merge/lib/core/ranks'
import { createRewardChainConfig, ensureRewardChainConfig, mergeSharedRewardChain, roundRewardAmount } from './features/merge/lib/rewards/rewardChain'
import { effectiveRewardTargets } from './features/merge/lib/rewards/rewardEconomy'
import { createTwisterPlan, normalizeTwisterPlan, stripTwisterFromTiles } from './features/merge/lib/rewards/twisterEconomy'
import { buildInputsKey, segmentBuildInputs, eventDesignIssues, designConsistency, serializeDrafts, deserializeDrafts, DRAFT_STORAGE_KEY, boardIsBuilt, draftSegmentIsApplied } from './features/merge/lib/build/eventBuild'
import { createDropGroupsConfig, DEFAULT_MIN_DROP_RANK } from './features/merge/lib/rewards/dropGroups'
import { createSmallRewardsBankConfig, createSmallRewardWeightsConfig } from './features/merge/lib/rewards/smallRewardsBank'

// "Share stage" always targets this, never window.location.href - see
// handleShare's comment for why.
// (The work repo's site since 25 Nov 2026. Links made before point at
// https://idoggk.github.io/Merge/ and open there as long as that site stays.)
const PRODUCTION_ORIGIN = 'https://idog-lab.github.io/EcoSystem/'

// "Build event" is the guided workflow and the place to start; every tab
// after it is an advanced tool that edits the same canonical configuration
// (there is no second copy of the design anywhere).
// THE MAIN PATH is three tabs: build the event, play it, export it. The
// other five are advanced tools over the same configuration and sit apart,
// under their own caption, so a first visit is not asked to choose between
// eight things of equal weight ("Recompletion" there is the Recompletion
// board editor - the Recompletion PHASE is built in Build event).
// A row of the "More" menu. (A plain button, so it is found by its name like any other.)
function MenuItem({ icon: Icon, children, danger = false, ...props }) {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold whitespace-nowrap ${danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-100'}`}
      {...props}
    >
      {Icon && <Icon size={14} strokeWidth={2.25} className="shrink-0" />}
      {children}
    </button>
  )
}

const MODES = [
  { id: 'build', label: 'Build event', icon: Hammer, hint: 'The guided flow: enter the event, build it, test and apply it' },
  { id: 'play', label: 'Play tester', icon: Gamepad2, hint: 'Play a segment yourself' },
  { id: 'syntax', label: 'Syntax', icon: FileCode2, hint: 'The Ops export of the event in use' },
  { id: 'editor', label: 'Editor', icon: LayoutGrid, advanced: true, hint: 'Advanced: the normal event board editor' },
  { id: 'recompletion', label: 'Recompletion', icon: RotateCcw, advanced: true, hint: 'Advanced: the Recompletion board editor' },
  { id: 'rewards', label: 'Rewards (V2)', icon: Gift, advanced: true, hint: 'Advanced: reward definitions, drop groups, pinned reward items' },
  { id: 'twister', label: 'Twister', icon: Tornado, advanced: true, hint: 'Advanced: a closer look at Twister income' },
  { id: 'cc', label: 'CC management', icon: Boxes, advanced: true, hint: 'Advanced: CC per board' },
]

// Eight player segments (bucketed by daily Brut Win habit - see CLAUDE.md's
// domain model), each with its own fully independent set of boards, presets,
// subsidy target, and event schedule - originally built at 4 by explicit
// economist request ("4 different configurations for 4 different
// segments"), raised to 8 by a later explicit request ("let me support 8
// segments"). The count is a fixed constant, not economist-configurable,
// matching the literal ask: all eight always exist. Which of them are IN
// SIGHT is another matter (see segmentInUse below) - the bar shows the ones
// in use and "Add segment" brings the next one in; none is ever removed. `segmentsFromPersisted` below already migrates an older 4-segment
// save/backup cleanly onto this - `parsed.segments[i] ?? {}` falls back to a
// fresh segment for any index the old save didn't have, so segments 5-8
// simply start blank rather than erroring or losing segments 1-4's data.
const SEGMENT_COUNT = 8
const DEFAULT_SEGMENT_NAMES = Array.from({ length: SEGMENT_COUNT }, (_, i) => `Segment ${i + 1}`)

// The main board list's "board layout" fields that get synced from Segment 1
// (index 0) to every other segment - by explicit economist request ("the
// board layout I build in the first segment[s] will go through to all
// segments, also the rank reward"). This is the domain model catching up to
// itself: CLAUDE.md's own "Segments" section has always said segments
// "do NOT differ in: board size, chain length..." - only Full Parity's
// independent-copy implementation let them silently diverge on this in the
// first place. `blockedValue`/onboarding goal/`rcEvent` stay OUT of this
// list on purpose - those are exactly the things segments SHOULD differ on
// (subsidy amount, the per-segment DR/rank onboarding goal).
const SYNCED_LAYOUT_FIELDS = ['rows', 'cols', 'tiles', 'minRank', 'maxRank', 'forcedSemiRanks']

// The small-reward configuration that is ONE shared value across segments,
// synced from Segment 1 exactly like the lucky-drop targetEv: the reward
// definitions (item syntax + prizes), the drop groups and their per-rank
// odds, the Ops bank/weights, the merge-drop gate, and the leftover policy.
// This is the domain model's own rule ("segments do NOT differ in ...
// lucky-drop odds/EV" - drop odds are odds), and it is what the real Ops
// schema can express: its Small Rewards / Bank / Weights sheets are single
// tables with no segment dimension. Segments differ in their reward TARGETS
// (base x factor) and reach them through what genuinely is per-segment:
// which reward items sit under their own tiles (rewardQueueItems /
// rewardSemiItems are deliberately NOT in this list). Before this, every
// segment carried an independent copy, so eight independently-solved
// segments produced eight different drop tables that no single shared
// configuration could represent.
const SYNCED_REWARD_FIELDS = [
  'rewardChainConfig',
  'dropGroups',
  'dropGroupsConfig',
  'smallRewardsBankConfig',
  'smallRewardWeightsConfig',
  'minDropRank',
  'multiDropRank',
  'tripleDropRank',
  'soloDropRank',
  'rankValuesByBuild',
  'tileRewardType',
  'twisterByBuild',
  'twisterSteady',
  'steadyDrops',
  'rewardLeftoverPolicy',
  // Twister: the rank ladder rides in rewardChainConfig and the drops in
  // dropGroups/dropGroupsConfig above, so both are shared already. The
  // optional widget length is a widget rule, not a price, so it is shared
  // too. twisterSpinCost is deliberately NOT here - the DR cost per spin is
  // THE segment-specific Twister lever.
  'twisterSpinObjective',
]

// The actual sync logic (Segment 1's list is the source of truth for
// everyone else's layout/rank-rewards), factored out so the main list and
// Recompletion's list can both run it without duplicating the body - by
// explicit economist request ("I want the same logic of copying between
// segments to apply in the recompletion also"), extending what used to be
// main-list-only. `listKey` is `'main'` or `'recompletion'`, selecting which
// of a segment's two independent `useBoardListState` instances to read/
// write - the two lists are never mixed (a call with `listKey: 'main'`
// never touches any segment's `recompletion`, and vice versa).
function syncSegmentListLayout(sourceBoards, targetSegments, listKey) {
  const sourceRewardRanks = sourceBoards[0]?.rewardRanks ?? []
  const sourceRewardSyntax = sourceBoards[0]?.rewardSyntax ?? {}
  const sourceTargetEv = sourceBoards[0]?.targetEv

  for (const seg of targetSegments) {
    const list = seg[listKey]
    const targetBoards = list.boards

    if (targetBoards.length !== sourceBoards.length) {
      list.setBoardCount(sourceBoards.length)
      continue // field sync below catches up once this segment's own board count re-renders to match
    }

    sourceBoards.forEach((sourceBoard, i) => {
      const targetBoard = targetBoards[i]
      const patch = {}
      let changed = false
      for (const field of SYNCED_LAYOUT_FIELDS) {
        if (JSON.stringify(targetBoard[field]) !== JSON.stringify(sourceBoard[field])) {
          patch[field] = sourceBoard[field]
          changed = true
        }
      }
      if (changed) list.updateBoard(invalidateLayout(targetBoard, patch))
    })

    const target0 = targetBoards[0]
    if (
      target0 &&
      (JSON.stringify(target0.rewardRanks) !== JSON.stringify(sourceRewardRanks) ||
        JSON.stringify(target0.rewardSyntax) !== JSON.stringify(sourceRewardSyntax))
    ) {
      list.syncRankRewards({ rewardRanks: sourceRewardRanks, rewardSyntax: sourceRewardSyntax })
    }

    // Lucky-drop target EV, same mechanism as rank rewards just above (one
    // shared value per list, compared on board 0 since syncTargetEv already
    // keeps every board in a list identical) - by explicit economist request
    // ("the lucky drop EV and the dates should be the same for all
    // segments"). This one is the domain model catching up to itself for a
    // second time: the "Segments" section at the top of CLAUDE.md has always
    // said segments "do NOT differ in: board size, chain length, or
    // lucky-drop odds/EV" - Full Parity's independent-copy implementation
    // just never enforced the EV half of that sentence. Never routed through
    // invalidateLayout: targetEv is a play-time generator-RNG parameter that
    // doesn't feed item generation at all, so syncing it must not wipe an
    // already-generated board.
    if (target0 && sourceTargetEv != null && target0.targetEv !== sourceTargetEv) {
      list.syncTargetEv(sourceTargetEv)
    }

    // Shared small-reward configuration - see SYNCED_REWARD_FIELDS. Like
    // targetEv, never routed through invalidateLayout: none of these feed
    // item generation, so syncing them must not wipe a generated board.
    if (target0 && sourceBoards[0]) {
      const patch = {}
      let changed = false
      for (const field of SYNCED_REWARD_FIELDS) {
        if (sourceBoards[0][field] === undefined) continue
        // Reward definitions are shared - except coin rank values set by the
        // build, which each segment keeps for itself (mergeSharedRewardChain).
        const wanted = field === 'rewardChainConfig' ? mergeSharedRewardChain(sourceBoards[0][field], target0[field]) : sourceBoards[0][field]
        if (JSON.stringify(target0[field]) !== JSON.stringify(wanted)) {
          patch[field] = JSON.parse(JSON.stringify(wanted))
          changed = true
        }
      }
      if (changed) list.syncRewardConfig(patch)
    }
  }
}

// "Effort target"'s typed %-per-rank curve used to live as local useState
// inside BoardEditor.jsx itself - which meant it was wiped the instant that
// component remounted, and it remounts on every active-board switch
// (`key={activeBoard.id}` in EditorApp below). Since the whole point of the
// feature is a single curve applied across the WHOLE list (and, since
// "apply to all segments" shipped, potentially across every segment too),
// losing it just from clicking a different board in the sidebar - something
// an economist would naturally do to go check what a board looks like
// before or after applying - read as "applying deleted the numbers I typed"
// even though nothing about Apply itself touched them. Lifting this state up
// here, one level above the per-board remount, is what actually fixes that:
// it now survives switching the active board AND switching segments, only
// ever clearing if the economist clears it themselves. Two independent
// instances (not one) - the main list and Recompletion are separate lists
// with separate boards, so a typed curve for one shouldn't silently apply
// to the other.
function emptyTargetPctInputs() {
  return Object.fromEntries(Array.from({ length: MAX_RANK - MIN_RANK + 1 }, (_, i) => [i + MIN_RANK, '']))
}
// The typed curve is kept across a reload, in its own storage entry (like the
// build drafts - it is not part of the project save). A build keeps the
// effort distribution asked for (eventBuild.js: setEffortTargetForBuild), and
// it used to live in memory only: after a reload nothing was protected until
// it was typed again, with nothing on screen to say so.
const EFFORT_TARGET_STORAGE_KEY = 'merge-mania-effort-target'
function storedTargetPctInputs(which) {
  const blank = emptyTargetPctInputs()
  try {
    const saved = JSON.parse(localStorage.getItem(EFFORT_TARGET_STORAGE_KEY) ?? 'null')?.[which]
    if (!saved || typeof saved !== 'object') return blank
    for (const rank of Object.keys(blank)) if (typeof saved[rank] === 'string') blank[rank] = saved[rank]
    return blank
  } catch {
    return blank
  }
}

// Older saved boards may predate a field added since - backfill defaults so
// a stale save doesn't crash on a field that's now assumed to exist.
function normalizeBoards(rawBoards) {
  const withDefaults = rawBoards.map((b) => ({
    semiPlacements: [],
    blockedQueue: [],
    onboardingDrBudget: null,
    onboardingTargetRank: null,
    onboardingStatus: null,
    targetEv: DEFAULT_TARGET_EV,
    rewardRanks: [],
    rewardSyntax: {},
    rcEvent: false,
    tier2UnlockRank: DEFAULT_TIER2_UNLOCK_RANK,
    tier4UnlockRank: DEFAULT_TIER4_UNLOCK_RANK,
    forcedSemiRanks: [],
    // V2: a save from before these fields existed at all has none of them -
    // back-filled here the same way every other field in this function
    // already is, so an older save loads without crashing the Rewards page
    // (RewardsPage.jsx reads board.rewardChainConfig[type][rank] directly,
    // with no defensive optional-chaining of its own, matching this app's
    // existing convention that normalizeBoards is where migration safety
    // lives, not every individual reader).
    ccPercent: 0,
    rewardChainConfig: createRewardChainConfig(),
    dropGroups: [],
    dropGroupsConfig: createDropGroupsConfig(RC_MAX_RANK),
    smallRewardsBankConfig: createSmallRewardsBankConfig(),
    smallRewardWeightsConfig: createSmallRewardWeightsConfig(),
    minDropRank: DEFAULT_MIN_DROP_RANK,
    multiDropRank: null,
    rewardQueueItems: [],
    rewardSemiItems: [],
    rewardLeftoverPolicy: 'collect',
    twisterSpinCost: null,
    twisterSpinObjective: null,
    effectiveBlockedValue: null,
    // Written by Build event's Apply: a fingerprint of the design as built,
    // so every tool can tell whether it still matches (eventBuild.js).
    buildStamp: null,
    // What a Twister spin cost was derived from (draft or applied design).
    twisterCostBasis: null,
    ...b,
  }))
    // Twister DR may only come from merge drops - an imported or hand-edited
    // board that somehow carries one under a tile has it removed.
    .map(stripTwisterFromTiles)
  // targetEv, the rank rewards (which ranks are reward checkpoints, and each
  // one's reward syntax), and the generator tier unlock ranks are all one
  // shared value across a whole list now (see useBoardListState.js's
  // syncTargetEv/syncRankRewards/syncGeneratorTiers), not per-board dials -
  // force every board to match the first board's on load/import, so a save
  // from before those rules existed (each board carrying its own
  // independently-set values, or predating the field entirely) doesn't keep
  // that per-board variation alive. rewardChainConfig/dropGroups/
  // dropGroupsConfig (V2) are shared the same way - see
  // useBoardListState.js's syncRewardConfig.
  const first = withDefaults[0]
  const shared = {
    targetEv: first?.targetEv ?? DEFAULT_TARGET_EV,
    rewardRanks: first?.rewardRanks ?? [],
    rewardSyntax: first?.rewardSyntax ?? {},
    tier2UnlockRank: first?.tier2UnlockRank ?? DEFAULT_TIER2_UNLOCK_RANK,
    tier4UnlockRank: first?.tier4UnlockRank ?? DEFAULT_TIER4_UNLOCK_RANK,
    // ensureRewardChainConfig backfills a ladder the save predates (Twister,
    // blank) and leaves every existing value exactly as it was.
    rewardChainConfig: ensureRewardChainConfig(first?.rewardChainConfig),
    dropGroups: first?.dropGroups ?? [],
    dropGroupsConfig: first?.dropGroupsConfig ?? createDropGroupsConfig(RC_MAX_RANK),
    smallRewardsBankConfig: first?.smallRewardsBankConfig ?? createSmallRewardsBankConfig(),
    smallRewardWeightsConfig: first?.smallRewardWeightsConfig ?? createSmallRewardWeightsConfig(),
    minDropRank: first?.minDropRank ?? DEFAULT_MIN_DROP_RANK,
    multiDropRank: first?.multiDropRank ?? null,
    tripleDropRank: first?.tripleDropRank ?? null,
    soloDropRank: first?.soloDropRank ?? null,
    rankValuesByBuild: first?.rankValuesByBuild ?? null,
    tileRewardType: first?.tileRewardType ?? null,
    // Decided for the whole project in migrateTwisterByBuild (below).
    twisterByBuild: first?.twisterByBuild ?? null,
    twisterSteady: first?.twisterSteady ?? null,
    steadyDrops: first?.steadyDrops ?? null,
    rewardLeftoverPolicy: first?.rewardLeftoverPolicy ?? 'collect',
    twisterSpinCost: first?.twisterSpinCost ?? null,
    twisterSpinObjective: first?.twisterSpinObjective ?? null,
  }
  return withDefaults.map((b) => ({ ...b, ...shared }))
}

// Recompletion is a second, fully independent board list — same shape as
// the main one ({ boards, presets, targetSubsidy }) — for the board(s) a
// player cycles through after reaching the event's Last Tier (see
// eventSheets.js's EVENT_DATA_TEMPLATE, "triggers recompletion"). Its own
// board 0 gets the exact same "board 1" treatment as the main list's board
// 0 (onboarding goal, small-rank guarantee, rank-1-only semi tiles,
// uncapped rows) - by explicit request, recompletion's editor is meant to
// behave identically to the main editor, just against a separate board set.
// Every segment carries its own independent copy of this whole shape - see
// segmentsFromPersisted below.
// V2 (section 6): per-resource collectible targets for one phase (Normal or
// RC) - "a target represents TOTAL collectible payout from BOTH sources
// (tile placements + merge-generated drops), not raw item count."
function createRewardTargets() {
  return { coins: 0, puzzles: 0, energy: 0, charms: 0 }
}

// "Provide configurable source-allocation weights (tile vs. drop split)
// defined in expected collectible VALUE terms." A plain 0-1 split,
// normalized at the point of use rather than forced to sum to 1 here -
// matches this app's existing "treat as preferences, report when
// infeasible" convention (effortTargeting.js's own target-%-per-rank input
// doesn't need to sum to 100 either).
function createSourceAllocation() {
  return { tileWeight: 0.5, dropWeight: 0.5 }
}

function freshSegment(name) {
  return {
    name,
    boards: [createBoard('Board 1')],
    presets: [],
    targetSubsidy: null,
    recompletionBoards: [createBoard('Board 1')],
    recompletionPresets: [],
    recompletionTargetSubsidy: null,
    // There is ONE Recompletion mode (a list of sequential boards). A save
    // from when a second list ("Recompletion B") existed keeps that list
    // here, untouched and unused, until the economist decides what to do
    // with it - see normalizeSegment.
    legacyRecompletionB: null,
    eventStartDate: null,
    eventDurationDays: 7,
    // V2: one set of targets/allocation per phase. Only the BASE segment's
    // own values (segment0 - "Segment 1", economist-chosen, not
    // configurable) are read as absolute targets; every other segment's own
    // REQUESTED target is segment0's value times that segment's own
    // segmentFactor (a single multiplier applied uniformly across all four
    // resources - a deliberate simplification of "configurable factors"
    // rather than a full per-resource-per-segment matrix, kept simple since
    // nothing in the spec asked for per-resource segment scaling
    // specifically). segmentFactor defaults to 1 (segment reads the base
    // segment's own targets unscaled) and is only ever read/edited on
    // segments 1-7 (index >= 1) - segment0 IS the base, so its own factor is
    // never shown or applied.
    rewardTargets: { main: createRewardTargets(), rc: createRewardTargets() },
    segmentFactor: 1,
    sourceAllocation: { main: createSourceAllocation(), rc: createSourceAllocation() },
    // Twister price analysis inputs (checkpoint, target spins, overrides,
    // cost increment, runs, seed) per phase - DESIGN METADATA, not runtime
    // config. One shared plan: only the base segment's copy is read, the
    // same way only its rewardTargets are absolute.
    twisterPlan: { main: createTwisterPlan(), rc: createTwisterPlan() },
    // SEGMENTS AND PRIZES (economist, 26 Nov 2026: "add segmentation into the merge and also the prizes"):
    // the segment's condition and key from the segment plan (lib/economy/segmentFlow.js), and its own prize
    // ladder - { main: { [rank]: text }, rc } - written from the base segment's times its multiplier, then its own.
    condition: '',
    segmentKey: '',
    prizeLadder: { main: {}, rc: {} },
    // Event-level, read on Segment 1 only (like the dates): the segment plan the segments were made from, the
    // allowance worth of one merge DR ("Per Merge event"), and which segment the prizes are worked out on.
    segmentPlan: null,
    drWorth: null,
    prizeBase: 0,
  }
}

// Whether a saved board list holds anything a person actually built, as
// opposed to the single untouched default board every list starts with.
function isAuthoredBoardList(boards) {
  if (!Array.isArray(boards) || boards.length === 0) return false
  if (boards.length > 1) return true
  const b = boards[0]
  return (b.blockedValue ?? 0) > 0 || (b.semiPlacements?.length ?? 0) > 0 || (b.blockedQueue?.length ?? 0) > 0 || (b.tiles ?? []).some((row) => row.some((t) => t !== 'open'))
}

// Copies text to the clipboard. The clipboard API only works in a secure
// page that has focus, and when it refuses nothing used to happen at all -
// the economist pressed "Share stage" and no link was copied. So: try the
// API, then the older select-and-copy way, and say whether it worked.
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the older way
  }
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}

function normalizeSegment(raw, defaultName) {
  return {
    name: raw.name ?? defaultName,
    boards: normalizeBoards(raw.boards?.length ? raw.boards : [createBoard('Board 1')]),
    presets: raw.presets ?? [],
    targetSubsidy: raw.targetSubsidy ?? null,
    recompletionBoards: normalizeBoards(raw.recompletionBoards?.length ? raw.recompletionBoards : [createBoard('Board 1')]),
    recompletionPresets: raw.recompletionPresets ?? [],
    recompletionTargetSubsidy: raw.recompletionTargetSubsidy ?? null,
    // The app used to keep a second Recompletion list ("Recompletion B").
    // There is one Recompletion mode now. An older save's B list is never
    // dropped: if it holds anything a person built (generated contents, a
    // subsidy, or more than the single default board) it is carried in
    // `legacyRecompletionB`, saved and backed up as-is, and offered back on
    // the Recompletion tab (append / replace / discard).
    legacyRecompletionB:
      raw.legacyRecompletionB ??
      (isAuthoredBoardList(raw.recompletionBoards2)
        ? { boards: normalizeBoards(raw.recompletionBoards2), presets: raw.recompletionPresets2 ?? [], targetSubsidy: raw.recompletionTargetSubsidy2 ?? null }
        : null),
    // The snapshot a legacy-list recovery leaves behind (both lists as they
    // were), so it can be undone - see legacyRecompletion.js.
    recompletionRecovery: raw.recompletionRecovery ?? null,
    // Whole-event scheduling (start date + how many days it runs) - a
    // single value per segment (not per-board), same "one canonical value"
    // precedent as targetSubsidy. Feeds the Ops workbook's download filename
    // (SyntaxPage.jsx) so a batch of exports taken across different events
    // don't all collide on the same generic name. 7-day default matches
    // CLAUDE.md's own "7-day timed live-ops event" framing; startDate stays
    // null (unset) until the economist picks one.
    eventStartDate: raw.eventStartDate ?? null,
    eventDurationDays: raw.eventDurationDays ?? 7,
    // V2: an older save (from before this feature existed) has none of
    // these fields at all - back-filled with fresh defaults here rather
    // than crashing on `undefined`, same migration-safety precedent every
    // other field in this function already follows.
    rewardTargets: {
      main: { ...createRewardTargets(), ...(raw.rewardTargets?.main ?? {}) },
      rc: { ...createRewardTargets(), ...(raw.rewardTargets?.rc ?? {}) },
    },
    segmentFactor: raw.segmentFactor ?? 1,
    sourceAllocation: {
      main: { ...createSourceAllocation(), ...(raw.sourceAllocation?.main ?? {}) },
      rc: { ...createSourceAllocation(), ...(raw.sourceAllocation?.rc ?? {}) },
    },
    twisterPlan: { main: normalizeTwisterPlan(raw.twisterPlan?.main), rc: normalizeTwisterPlan(raw.twisterPlan?.rc) },
    // See preserveDivergentRewardConfig.
    legacyRewardConfig: raw.legacyRewardConfig ?? null,
    // Segments and prizes (see freshSegment); a save from before has none.
    condition: typeof raw.condition === 'string' ? raw.condition : '',
    segmentKey: typeof raw.segmentKey === 'string' ? raw.segmentKey : '',
    prizeLadder: { main: { ...(raw.prizeLadder?.main ?? {}) }, rc: { ...(raw.prizeLadder?.rc ?? {}) } },
    segmentPlan: raw.segmentPlan && typeof raw.segmentPlan === 'object' ? raw.segmentPlan : null,
    drWorth: Number.isFinite(Number(raw.drWorth)) && raw.drWorth !== null && raw.drWorth !== '' ? Number(raw.drWorth) : null,
    prizeBase: Number.isInteger(raw.prizeBase) ? raw.prizeBase : 0,
  }
}

// Turns a parsed JSON blob (from localStorage OR an imported backup file -
// both go through this one function, so the two paths can never drift out
// of sync) into exactly SEGMENT_COUNT normalized segments, or null if the
// blob has nothing usable at all. Two real shapes handled:
// - Current: `{ segments: [...] }`, SEGMENT_COUNT entries.
// - Pre-segments (any save/backup made before this feature shipped): a flat
//   `{ boards, presets, targetSubsidy, recompletionBoards, ... }` with no
//   `segments` key at all - migrated into Segment 1 rather than discarded,
//   with every other segment starting fresh. Never silently loses a real
//   save this way, matching this app's existing "durable backup"
//   philosophy. The same leniency (`parsed.segments[i] ?? {}`) also covers
//   loading an older 4-segment save/backup after SEGMENT_COUNT was raised to
//   8 - segments 1-4 keep their real data, 5-8 just start fresh.
// Reward configuration is one shared set synced from Segment 1 (see
// SYNCED_REWARD_FIELDS). A save made while every segment still carried its
// own copy can hold a DIFFERENT configuration on segments 2-8, and the sync
// replaces it on first load. So that this is never destructive, any such
// divergent configuration is copied aside here - before the sync runs - into
// the segment's own `legacyRewardConfig` (one entry per list), where it stays
// in the saved data and in backups until the economist discards it. Only a
// configuration someone actually built is kept (it has drop groups, or reward
// values that differ from a fresh default); an untouched default is not.
const LEGACY_LIST_KEYS = ['boards', 'recompletionBoards']

function rewardConfigOf(board) {
  return Object.fromEntries(SYNCED_REWARD_FIELDS.map((field) => [field, board?.[field]]))
}

function preserveDivergentRewardConfig(segments) {
  const base = segments[0]
  const defaultChain = JSON.stringify(createRewardChainConfig())
  return segments.map((seg, i) => {
    if (i === 0) return seg
    let legacy = seg.legacyRewardConfig
    for (const key of LEGACY_LIST_KEYS) {
      if (legacy?.[key]) continue
      const own = rewardConfigOf(seg[key]?.[0])
      const shared = rewardConfigOf(base[key]?.[0])
      // A segment's own build-sized coin values are not a divergence.
      shared.rewardChainConfig = mergeSharedRewardChain(shared.rewardChainConfig, own.rewardChainConfig)
      if (JSON.stringify(own) === JSON.stringify(shared)) continue
      const authored = (own.dropGroups?.length ?? 0) > 0 || JSON.stringify(own.rewardChainConfig) !== defaultChain
      if (!authored) continue
      legacy = { ...(legacy ?? {}), [key]: JSON.parse(JSON.stringify(own)) }
    }
    return legacy === seg.legacyRewardConfig ? seg : { ...seg, legacyRewardConfig: legacy }
  })
}

// "The build sizes the Twister drops" (board.twisterByBuild) for a save from
// before that existed. Such a save has a Twister drop RULE: a fixed chance.
// Where twists were also typed for that phase, the fixed chance is exactly
// what could not give them (reported by the economist: 0 to 2 twists of the
// 15 asked), so the build takes the drops over and its next build replaces
// the rule. A rule with no twists asked is someone's own setting and is
// kept. A choice already made (true or false) is never changed. The flag is
// one per list for the whole project, so it is set on every segment alike.
function migrateTwisterByBuild(segments) {
  const base = segments[0]
  if (!base) return segments
  const decided = {}
  for (const [key, phase] of [
    ['boards', 'main'],
    ['recompletionBoards', 'rc'],
  ]) {
    const b0 = base[key]?.[0]
    if (!b0) continue
    if (b0.twisterByBuild != null) decided[key] = !!b0.twisterByBuild
    else {
      const plan = base.twisterPlan?.[phase]
      const twistsAsked = plan?.targetSpins > 0 || Object.values(plan?.targetSpinsOverrides ?? {}).some((v) => v > 0)
      decided[key] = twistsAsked && (b0.dropGroups ?? []).some((g) => g?.twisterRule === true)
    }
  }
  return segments.map((seg) => {
    let next = seg
    for (const [key, value] of Object.entries(decided)) {
      if ((seg[key] ?? []).every((b) => b.twisterByBuild === value)) continue
      next = { ...next, [key]: seg[key].map((b) => ({ ...b, twisterByBuild: value })) }
    }
    return next
  })
}

// LEFTOVERS ARE COLLECTED. Until this rule, every list was saved with
// "unmerged reward items left at the end pay nothing" - the tool's assumption,
// never something the economist chose (it was an open question). The economist
// then said what the simulator should do: "after getting to rank 12, merges
// all the small rewards and collect them. to understand how much really the
// user got". So a project saved BEFORE the rule (no `leftoverRule` mark) is
// switched to 'collect' when it is opened, on every list of every segment; a
// project saved since keeps whatever step 3 was set to.
const LEFTOVER_RULE_MARK = 'collect-by-default'
function migrateLeftoverRule(segments, parsed) {
  if (parsed?.leftoverRule === LEFTOVER_RULE_MARK) return segments
  const fix = (boards) => (Array.isArray(boards) ? boards.map((b) => (b.rewardLeftoverPolicy === 'collect' ? b : { ...b, rewardLeftoverPolicy: 'collect' })) : boards)
  return segments.map((seg) => ({ ...seg, boards: fix(seg.boards), recompletionBoards: fix(seg.recompletionBoards) }))
}

function segmentsFromPersisted(parsed) {
  if (!parsed) return null
  if (Array.isArray(parsed.segments) && parsed.segments.length) {
    return migrateLeftoverRule(preserveDivergentRewardConfig(migrateTwisterByBuild(DEFAULT_SEGMENT_NAMES.map((name, i) => normalizeSegment(parsed.segments[i] ?? {}, name)))), parsed)
  }
  if (Array.isArray(parsed.boards) && parsed.boards.length) {
    const migrated = normalizeSegment({ ...parsed, name: DEFAULT_SEGMENT_NAMES[0] }, DEFAULT_SEGMENT_NAMES[0])
    return migrateLeftoverRule(migrateTwisterByBuild([migrated, ...DEFAULT_SEGMENT_NAMES.slice(1).map(freshSegment)]), parsed)
  }
  return null
}

function initialState() {
  return { segments: segmentsFromPersisted(loadState()) ?? DEFAULT_SEGMENT_NAMES.map(freshSegment) }
}

// Bundles all SEGMENT_COUNT segments' live state into the one JSON shape
// both handleSave (-> localStorage) and handleExportBackup (-> downloaded
// file) write - kept as one function so the two paths can never drift.
function buildSaveShape(segments) {
  return {
    // Marks a project saved since leftovers are collected by default (see
    // migrateLeftoverRule): its leftover setting is the economist's own.
    leftoverRule: LEFTOVER_RULE_MARK,
    segments: segments.map((seg) => ({
      name: seg.name,
      boards: seg.main.boards,
      presets: seg.main.presets,
      targetSubsidy: seg.main.targetSubsidy,
      recompletionBoards: seg.recompletion.boards,
      recompletionPresets: seg.recompletion.presets,
      recompletionTargetSubsidy: seg.recompletion.targetSubsidy,
      ...(seg.legacyRecompletionB ? { legacyRecompletionB: seg.legacyRecompletionB } : {}),
      ...(seg.recompletionRecovery ? { recompletionRecovery: seg.recompletionRecovery } : {}),
      eventStartDate: seg.eventStartDate,
      eventDurationDays: seg.eventDurationDays,
      rewardTargets: seg.rewardTargets,
      segmentFactor: seg.segmentFactor,
      sourceAllocation: seg.sourceAllocation,
      twisterPlan: seg.twisterPlan,
      ...(seg.legacyRewardConfig ? { legacyRewardConfig: seg.legacyRewardConfig } : {}),
      condition: seg.condition,
      segmentKey: seg.segmentKey,
      prizeLadder: seg.prizeLadder,
      segmentPlan: seg.segmentPlan,
      drWorth: seg.drWorth,
      prizeBase: seg.prizeBase,
    })),
  }
}

// Everything one segment owns: its own main + Recompletion board lists (the
// same useBoardListState hook Main/Recompletion already used, called twice
// per segment - fully independent CRUD, presets, and subsidy target for
// each), its own editable name, and its own event schedule. Called a fixed
// SEGMENT_COUNT times, unconditionally, every render (see EditorApp below) -
// legal under the Rules of Hooks since the call count never varies, only
// which segment's data ends up shown depends on activeSegmentIndex.
function useSegment(initial) {
  const main = useBoardListState({ boards: initial.boards, presets: initial.presets, targetSubsidy: initial.targetSubsidy })
  const recompletion = useBoardListState(
    {
      boards: initial.recompletionBoards,
      presets: initial.recompletionPresets,
      targetSubsidy: initial.recompletionTargetSubsidy,
    },
    // Nothing below rank 3 under a Recompletion board's blocked tiles, and
    // every board knows it is a Recompletion board (board.js: isRecompletionBoard).
    { minRankFloor: RC_MIN_RANK_UNDER_TILES, phase: 'rc' },
  )
  const [legacyRecompletionB, setLegacyRecompletionB] = useState(initial.legacyRecompletionB ?? null)
  const [recompletionRecovery, setRecompletionRecovery] = useState(initial.recompletionRecovery ?? null)
  const [name, setName] = useState(initial.name)
  const [eventStartDate, setEventStartDate] = useState(initial.eventStartDate)
  const [eventDurationDays, setEventDurationDays] = useState(initial.eventDurationDays)
  // V2 (section 6): reward targets/factor/source-allocation - see
  // freshSegment's own comment for what each means.
  const [rewardTargets, setRewardTargets] = useState(initial.rewardTargets)
  const [segmentFactor, setSegmentFactor] = useState(initial.segmentFactor)
  const [sourceAllocation, setSourceAllocation] = useState(initial.sourceAllocation)
  const [twisterPlan, setTwisterPlan] = useState(initial.twisterPlan)
  const [legacyRewardConfig, setLegacyRewardConfig] = useState(initial.legacyRewardConfig ?? null)
  // Segments and prizes (see freshSegment).
  const [condition, setCondition] = useState(initial.condition ?? '')
  const [segmentKey, setSegmentKey] = useState(initial.segmentKey ?? '')
  const [prizeLadder, setPrizeLadder] = useState(initial.prizeLadder ?? { main: {}, rc: {} })
  const [segmentPlan, setSegmentPlan] = useState(initial.segmentPlan ?? null)
  const [drWorth, setDrWorth] = useState(initial.drWorth ?? null)
  const [prizeBase, setPrizeBase] = useState(initial.prizeBase ?? 0)
  return {
    condition,
    setCondition,
    segmentKey,
    setSegmentKey,
    prizeLadder,
    setPrizeLadder,
    segmentPlan,
    setSegmentPlan,
    drWorth,
    setDrWorth,
    prizeBase,
    setPrizeBase,
    main,
    recompletion,
    legacyRecompletionB,
    setLegacyRecompletionB,
    recompletionRecovery,
    setRecompletionRecovery,
    name,
    setName,
    eventStartDate,
    setEventStartDate,
    eventDurationDays,
    setEventDurationDays,
    rewardTargets,
    setRewardTargets,
    segmentFactor,
    setSegmentFactor,
    sourceAllocation,
    setSourceAllocation,
    twisterPlan,
    setTwisterPlan,
    legacyRewardConfig,
    setLegacyRewardConfig,
  }
}

// A shared stage link (?s=<encoded boards>, see stageShare.js; before the
// short link it was ?play&stage=<encoded boards>, which still opens, and a
// bare ?play is the demo) renders the stripped-down player view instead of the
// economist app entirely, so a friend opening the link never sees the
// editor/CC-management/syntax tooling. No stage param falls back to the
// baked-in defaultStage.js demo, so a bare "?play" link is still meaningful.
//
// A stage param that's PRESENT but fails to decode (cut off by a chat app,
// mangled by copy-paste, etc. - see stageShare.js/CLAUDE.md for the CDN
// URL-length ceiling this is guarding against) is deliberately NOT treated
// the same as "no stage param at all" - silently substituting the default
// demo there would look identical to "nothing went wrong," which is exactly
// what made this bug hard to diagnose from a bug report alone. `linkBroken`
// surfaces it instead.
export function PlayApp() {
  const [{ boards, rcBoards, linkBroken }] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const stageParam = params.get('s') ?? params.get('stage')
    const demo = { boards: createDefaultStage().boards, rcBoards: null }
    if (!stageParam) return { ...demo, linkBroken: false }
    const decoded = decodeStage(stageParam)
    // Shared boards go through the same field back-fill a saved board does,
    // so a link made before a field existed still plays.
    return decoded
      ? { boards: normalizeBoards(decoded.boards), rcBoards: decoded.rcBoards ? normalizeBoards(decoded.rcBoards) : null, linkBroken: false }
      : { ...demo, linkBroken: true }
  })

  return (
    <div className="min-h-screen">
      <div className="app-backdrop" aria-hidden="true" />
      <main className="max-w-[1760px] mx-auto px-3 py-4 sm:px-6 sm:py-10 play-compact-py">
        {/* The stage shows the notice itself: on a phone held sideways it
            fills the screen, and a banner out here would sit behind it. */}
        <PlayStage
          boards={boards}
          rcBoards={rcBoards}
          notice={linkBroken ? "This share link looks broken or got cut off along the way, so we're showing the demo stage instead — ask whoever sent it to re-share the link." : null}
        />
      </main>
    </div>
  )
}

// "Share planning" link (?plan=<encoded segments> - see planShare.js)
// renders this stripped-down READ-ONLY view instead of the economist app
// entirely — by explicit request ("I want to just have a read-only option
// to send to co workers to see the full simulator"), the counterpart to
// PlayApp above but for review rather than play: every segment's own main
// list, Total subsidy, Generator tiers, Lucky drops, Placement, Blocked
// queue, Rank rewards, and the Playthrough simulation/Effort Distribution
// chart, all visible, nothing editable. A hard component-level separation
// (not a mode flag inside EditorApp) for the same reason PlayApp already is
// one — a link meant for someone outside this editing session must never
// expose editing affordances, even inert ones, by a stray code path.
//
// There's no sensible fallback the way a bare "?play" link falls back to
// the baked-in demo stage — a plan link only ever exists because someone
// explicitly shared one, so a missing or malformed `plan` param gets its
// own explicit message instead of silently rendering something that could
// be mistaken for real data.
export function PlanApp() {
  const [{ segments, linkBroken }] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const planParam = params.get('plan')
    if (!planParam) return { segments: null, linkBroken: false }
    const decoded = decodePlan(planParam)
    return decoded ? { segments: decoded, linkBroken: false } : { segments: null, linkBroken: true }
  })
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0)

  if (!segments) {
    return (
      <div className="min-h-screen">
        <div className="app-backdrop" aria-hidden="true" />
        <main className="max-w-2xl mx-auto px-6 py-16">
          <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
            <TriangleAlert size={16} className="shrink-0 mt-0.5" />
            <span className="text-sm">
              {linkBroken
                ? "This planning link looks broken or got cut off along the way — ask whoever sent it to re-share it."
                : 'No shared plan was found in this link.'}
            </span>
          </div>
        </main>
      </div>
    )
  }

  const activeSegment = segments[activeSegmentIndex]

  return (
    <div className="min-h-screen">
      <div className="app-backdrop" aria-hidden="true" />

      <header className="bg-white/80 backdrop-blur-md border-b border-white sticky top-0 z-30 shadow-sm shadow-purple-950/5">
        <div className="max-w-[1760px] mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-purple-600 to-fuchsia-500 text-white rounded-xl p-2 shadow-md shadow-purple-500/30">
              <Puzzle size={20} strokeWidth={2.25} />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-slate-900 leading-tight tracking-tight">Merge Mania Board Simulator</h1>
              <p className="text-xs text-slate-400 leading-tight">Shared plan — view and simulate only, nothing here can be edited</p>
            </div>
          </div>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-3 py-1.5 shrink-0">
            <Eye size={13} /> Read-only
          </span>
        </div>

        <div className="max-w-[1760px] mx-auto px-6 pb-3 flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 shrink-0">Segment</span>
          <div className="flex items-center gap-1 bg-slate-100/80 rounded-xl p-1 flex-wrap">
            {segments.map((seg, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setActiveSegmentIndex(i)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all duration-150 ${
                  activeSegmentIndex === i
                    ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-sm shadow-purple-500/30'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {seg.name}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-[1760px] mx-auto px-6 py-4 flex gap-8">
        <PlanSegmentView
          key={activeSegmentIndex}
          segment={activeSegment}
          baseSegment={segments[0]}
          isBaseSegment={activeSegmentIndex === 0}
        />
      </main>
    </div>
  )
}

// One segment's own read-only Editor view - a thin wrapper around the exact
// same useBoardListState hook + BoardList/BoardEditor pair EditorApp's own
// Editor tab uses (see EditorApp's `mode === 'editor'` branch below), so
// this can never structurally drift from what the real Editor looks like -
// every card/field a reviewer sees is the genuine component, just with
// `readOnly` passed through (see BoardEditor.jsx/BoardList.jsx's own
// comments on what that disables/hides). Mounted fresh
// (key={activeSegmentIndex} on the caller) on every segment switch, so its
// own board-selection state always starts back at board 0 rather than
// carrying over whatever was selected on the previous segment.
//
// `onUpdateEventStartDate`/`onUpdateEventDurationDays` are real (if inert)
// no-op functions, not omitted — the Event Schedule card's own JSX only
// renders at all when `onUpdateEventStartDate` is truthy (see
// BoardEditor.jsx), and "everything in the Editor tab, read-only" means
// that card should still be visible (just disabled via `readOnly`), not
// hidden by omission the way Effort target/Suggestions deliberately are.
// Read-only reward-economy summary for a shared plan (V2): the segment's
// own targets (derived via its factor for non-base segments), the configured
// tile-vs-drop source split, and the per-board CC/min-drop-rank levers -
// enough for a reviewing coworker to understand what the reward economy is
// configured to do, without exposing any of the workflow's editing actions.
// A plan saved before these fields existed simply shows the summary's own
// "not configured" fallbacks - decodePlan output is normalized nowhere else.
function PlanRewardSummary({ segment, baseSegment, isBaseSegment }) {
  const factor = segment.segmentFactor ?? 1
  const phases = [
    { id: 'main', label: 'Normal phase' },
    { id: 'rc', label: 'RC phase' },
  ]
  const types = ['coins', 'puzzles', 'energy', 'charms']
  const labels = { coins: 'Coins', puzzles: 'Puzzles', energy: 'Merge Energy', charms: 'Charms' }
  const anyTargets = phases.some((p) => types.some((t) => ((isBaseSegment ? segment : baseSegment)?.rewardTargets?.[p.id]?.[t] ?? 0) > 0))
  return (
    <Card title="Small Rewards economy" subtitle={isBaseSegment ? 'Base segment - other segments derive their targets from these via their own factor' : `Derived from the base segment's targets × this segment's factor (${factor})`}>
      {!anyTargets ? (
        <p className="text-sm text-slate-400">No reward targets configured in this plan.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {phases.map((p) => {
            const base = (isBaseSegment ? segment : baseSegment)?.rewardTargets?.[p.id] ?? {}
            const alloc = segment.sourceAllocation?.[p.id] ?? {}
            const tw = alloc.tileWeight ?? 0.5
            const dw = alloc.dropWeight ?? 0.5
            const tilePct = Math.round((tw + dw > 0 ? tw / (tw + dw) : 0.5) * 100)
            return (
              <div key={p.id} className="rounded-2xl border border-slate-100 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">{p.label}</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  {types.map((t) => (
                    <div key={t}>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{labels[t]}</div>
                      <div className="font-display font-semibold text-slate-700 tabular-nums">
                        {roundRewardAmount(t, (base[t] ?? 0) * (isBaseSegment ? 1 : factor)).toLocaleString(undefined, { maximumFractionDigits: 3 })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-slate-500 mt-1.5">
                  Source split: {tilePct}% under tiles · {100 - tilePct}% from merge drops
                </div>
              </div>
            )
          })}
          <p className="text-[11px] text-slate-400">
            Per-board CC % and the merge-drop gate are on each board's own cards below; reward items configured under tiles show in the
            Blocked queue as gold chips.
          </p>
        </div>
      )}
      <PlanTwisterSummary segment={segment} baseSegment={baseSegment} />
    </Card>
  )
}

// Read-only Twister summary for a shared plan: this segment's own cost per
// spin for each list, and the shared design inputs it was derived from. A
// plan link made before Twister existed has neither and shows nothing.
function PlanTwisterSummary({ segment, baseSegment }) {
  const costs = segment.twisterCosts
  const plan = (baseSegment ?? segment).twisterPlan
  if (!costs && !plan) return null
  const lists = [
    ['Normal phase', costs?.main],
    ['Recompletion', costs?.rc ?? costs?.rcA],
  ]
  const configured = (segment.boards?.[0]?.rewardChainConfig?.twister ?? []).some((r) => (r?.prizeAmount ?? 0) > 0)
  return (
    <div className="mt-3 rounded-2xl border border-teal-100 bg-teal-50/50 p-3" data-testid="plan-twister-summary">
      <div className="text-xs font-semibold uppercase tracking-wide text-teal-800 mb-1.5">Twister widget</div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        {lists.map(([label, cost]) => (
          <div key={label}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cost per spin · {label}</div>
            <div className="font-display font-semibold text-slate-700 tabular-nums">{cost == null ? 'not set' : `${cost} DR`}</div>
          </div>
        ))}
      </div>
      <div className="text-xs text-slate-500 mt-1.5">
        {configured ? 'Twister rank values and drops are shared across segments.' : 'Twister rank values are not configured.'}
        {plan?.main && (
          <>
            {' '}
            Design inputs (normal phase): checkpoint {plan.main.checkpointPct}% of main-chain DR progress, target{' '}
            {plan.main.targetSpins ?? 'not entered'} spins.
          </>
        )}
      </div>
    </div>
  )
}

function PlanSegmentView({ segment, baseSegment, isBaseSegment }) {
  const main = useBoardListState({ boards: segment.boards, presets: [], targetSubsidy: segment.targetSubsidy })
  return (
    <>
      <BoardList
        boards={main.boards}
        activeId={main.activeBoard?.id}
        onSelect={main.setActiveId}
        onUpdateBoard={main.updateBoard}
        targetSubsidy={main.targetSubsidy}
        readOnly
      />
      {main.activeBoard && (
        <div className="flex flex-col gap-6 flex-1 min-w-0">
        <PlanRewardSummary segment={segment} baseSegment={baseSegment} isBaseSegment={isBaseSegment} />
        <BoardEditor
          key={main.activeBoard.id}
          board={main.activeBoard}
          boards={main.boards}
          boardIndex={main.activeIndex}
          isFirstBoard={main.activeIndex === 0}
          presets={main.presets}
          onChange={main.updateBoard}
          onUpdateBoard={main.updateBoard}
          onUpdateTargetEv={main.syncTargetEv}
          onUpdateRankRewards={main.syncRankRewards}
          onUpdateGeneratorTiers={main.syncGeneratorTiers}
          targetSubsidy={main.targetSubsidy}
          onUpdateTargetSubsidy={main.updateTargetSubsidy}
          onSetBoardCount={main.setBoardCount}
          eventStartDate={segment.eventStartDate}
          eventDurationDays={segment.eventDurationDays}
          onUpdateEventStartDate={() => {}}
          onUpdateEventDurationDays={() => {}}
          targetPctInputs={{}}
          onTargetPctInputsChange={() => {}}
          readOnly
        />
        </div>
      )}
    </>
  )
}

export function EditorApp({ onHome }) {
  const [initial] = useState(initialState)
  // Fixed SEGMENT_COUNT (8) calls, unconditionally - see useSegment's own
  // comment on why this is safe. `segments[activeSegmentIndex]` is the one
  // everything below actually reads/writes; the other seven keep their own
  // state alive in the background so switching segments never loses work.
  const segment0 = useSegment(initial.segments[0])
  const segment1 = useSegment(initial.segments[1])
  const segment2 = useSegment(initial.segments[2])
  const segment3 = useSegment(initial.segments[3])
  const segment4 = useSegment(initial.segments[4])
  const segment5 = useSegment(initial.segments[5])
  const segment6 = useSegment(initial.segments[6])
  const segment7 = useSegment(initial.segments[7])
  const segments = [segment0, segment1, segment2, segment3, segment4, segment5, segment6, segment7]
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0)
  const activeSegment = segments[activeSegmentIndex]
  const { main, recompletion, eventStartDate, setEventStartDate, eventDurationDays, setEventDurationDays } = activeSegment

  // Segment 1's board layout + rank rewards are the one source of truth for
  // every other segment now - see SYNCED_LAYOUT_FIELDS's/
  // syncSegmentListLayout's own comments. Two independent effects, one per
  // board list (main, Recompletion) - each only ever reads/writes its own
  // list, so a change to one can never leak into the other. Board COUNT is
  // part of "layout" too (a board that only exists in one segment isn't the
  // same layout) - `setBoardCount` first, then the per-board field patch on
  // a later pass once lengths line up (each effect re-fires whenever ANY
  // segment's own boards reference changes for that list, including as a
  // result of its own writes, so it converges over a couple of renders
  // rather than needing to do everything in one pass). Every comparison
  // inside `syncSegmentListLayout` is a real value diff (JSON.stringify), so
  // once segments 2-4 actually match segment 1, both effects are a no-op
  // every render - they only ever write when something genuinely differs.
  const otherSegments = [segment1, segment2, segment3, segment4, segment5, segment6, segment7]

  useEffect(() => {
    syncSegmentListLayout(segment0.main.boards, otherSegments, 'main')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    segment0.main.boards,
    segment1.main.boards,
    segment2.main.boards,
    segment3.main.boards,
    segment4.main.boards,
    segment5.main.boards,
    segment6.main.boards,
    segment7.main.boards,
  ])

  useEffect(() => {
    syncSegmentListLayout(segment0.recompletion.boards, otherSegments, 'recompletion')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    segment0.recompletion.boards,
    segment1.recompletion.boards,
    segment2.recompletion.boards,
    segment3.recompletion.boards,
    segment4.recompletion.boards,
    segment5.recompletion.boards,
    segment6.recompletion.boards,
    segment7.recompletion.boards,
  ])

  // The event schedule is one whole-event value, not a per-segment one - by
  // explicit economist request ("the lucky drop EV and the dates should be
  // the same for all segments"). All segments describe the same 7-day
  // live-ops event, so a start date/duration that differs between them was
  // never meaningful; it only ever fed the Ops workbook's download filename
  // (see "Real Ops sheets"), which is per-export anyway. Kept as its own
  // effect rather than folded into either board-list sync above: these two
  // live on `useSegment` itself, not on a `useBoardListState` instance, and
  // they're main-list-only concepts (the "Event schedule" card never renders
  // for Recompletion).
  useEffect(() => {
    for (const seg of otherSegments) {
      if (seg.eventStartDate !== segment0.eventStartDate) seg.setEventStartDate(segment0.eventStartDate)
      if (seg.eventDurationDays !== segment0.eventDurationDays) seg.setEventDurationDays(segment0.eventDurationDays)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    segment0.eventStartDate,
    segment0.eventDurationDays,
    segment1.eventStartDate,
    segment1.eventDurationDays,
    segment2.eventStartDate,
    segment2.eventDurationDays,
    segment3.eventStartDate,
    segment3.eventDurationDays,
    segment4.eventStartDate,
    segment4.eventDurationDays,
    segment5.eventStartDate,
    segment5.eventDurationDays,
    segment6.eventStartDate,
    segment6.eventDurationDays,
    segment7.eventStartDate,
    segment7.eventDurationDays,
  ])

  // Recompletion's demand is the segment's normal-event demand (see
  // subsidyBudget.js: rcSubsidyForMainSubsidy). Whenever a segment has a
  // normal amount, its Recompletion list's subsidy is set from it, and its
  // boards are kept adding up to that: an untouched list gets a starting
  // split, a list with budgets keeps them and the last board closes the gap.
  // A budget change keeps a board's built contents (they are flagged out of
  // date by the build status), exactly as typing a budget does.
  const rcDemandKey = JSON.stringify(segments.map((seg) => [seg.main.targetSubsidy, seg.recompletion.targetSubsidy, seg.recompletion.boards.map((b) => b.blockedValue ?? 0)]))
  useEffect(() => {
    for (const seg of segments) {
      const wanted = rcSubsidyForMainSubsidy(seg.main.targetSubsidy)
      if (wanted == null) continue
      const list = seg.recompletion
      if (list.targetSubsidy !== wanted) list.updateTargetSubsidy(wanted)
      const current = list.boards.map((b) => b.blockedValue ?? 0)
      const next = current.every((v) => v === 0) ? spreadSubsidy(current.length, wanted, 'rc') : fillLastBoard(current, wanted, 'rc')
      list.boards.forEach((b, i) => {
        if ((b.blockedValue ?? 0) !== next[i]) list.updateBoard({ ...b, blockedValue: next[i], effectiveBlockedValue: null })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rcDemandKey])

  const [savedAt, setSavedAt] = useState(null)
  const [mode, setMode] = useState('build')
  // Build Event workflow state, held here so it survives moving between
  // tabs: which step is open, the DRAFT build per phase (never written to
  // the design until applied), its seeded validation, and - when the
  // economist opens the Play Tester on a draft - what the Play Tester is
  // playing instead of the applied design. None of it is persisted: the
  // inputs it was built from are, so a reload only needs a rebuild.
  const [buildStep, setBuildStep] = useState('setup')
  // Drafts are restored from their own storage entry (never the project
  // save) and are marked as restored; restoring applies nothing.
  const [restoredDrafts] = useState(() => {
    try {
      return deserializeDrafts(localStorage.getItem(DRAFT_STORAGE_KEY))
    } catch {
      return deserializeDrafts(null)
    }
  })
  const [buildDrafts, setBuildDrafts] = useState(restoredDrafts.drafts)
  const [buildValidation, setBuildValidation] = useState(restoredDrafts.validation)
  const [draftNotice, setDraftNotice] = useState(restoredDrafts.notice)
  const [playOverride, setPlayOverride] = useState(null)
  // Explicit, visible, session-only: export an out-of-date applied design anyway.
  const [exportOverride, setExportOverride] = useState(false)
  // Which configuration the Twister tool analyzes: the applied design or the draft.
  const [twisterSource, setTwisterSource] = useState('applied')
  // Twister analyses and suggestions, kept across tab switches and tied to
  // the configuration each was measured on (see TwisterPage's slot ids).
  const [twisterResults, setTwisterResults] = useState({ analysis: {}, suggestions: {} })
  useEffect(() => {
    try {
      if (buildDrafts.main || buildDrafts.rc) localStorage.setItem(DRAFT_STORAGE_KEY, serializeDrafts({ drafts: buildDrafts, validation: buildValidation }))
      else localStorage.removeItem(DRAFT_STORAGE_KEY)
    } catch {
      setDraftNotice('The results of this build are too large to keep in this browser, so the results (not the event itself) will be gone after a reload. Build again to see them.')
    }
  }, [buildDrafts, buildValidation])
  function resetBuildWorkflow() {
    setBuildDrafts({ main: null, rc: null })
    setBuildValidation({ main: null, rc: null })
    setPlayOverride(null)
    setExportOverride(false)
    setTwisterSource('applied')
    setTwisterResults({ analysis: {}, suggestions: {} })
    setDraftNotice(null)
    setBuildStep('setup')
    setAddedSegments(new Set())
  }
  function goRebuild(phase) {
    if (phase) setRewardsPhase(phase)
    setBuildStep('build')
    setMode('build')
  }
  // The Recompletion list (one mode, one or more sequential boards) that
  // the simulator, Play Tester, Rewards and Twister RC phases all use.
  const activeRcBoards = recompletion.boards
  // Rewards tab: which phase's workflow is on screen (Normal vs RC) - one
  // page at a time with explicit tabs, rather than both phases stacked into
  // one very long scroll.
  const [rewardsPhase, setRewardsPhase] = useState('main')
  // Bumped whenever the whole project is replaced underneath the UI (backup
  // import, Clear data) so the Rewards tab remounts and re-reads its typed
  // target drafts from the new state instead of showing the old ones.
  const [dataEpoch, setDataEpoch] = useState(0)
  const [shareCopied, setShareCopied] = useState(false)
  const [shareWarning, setShareWarning] = useState(null)
  // The link of the last "Share stage" / "Share planning", shown in a box
  // the economist can copy from by hand. Some browsers (an editor's built-in
  // preview, a locked-down clipboard) report the copy as done and copy
  // nothing - reported live: "it just shows link copied and i got nothing on
  // my clip board".
  const [shareLink, setShareLink] = useState(null)
  const [planCopied, setPlanCopied] = useState(false)
  const [planWarning, setPlanWarning] = useState(null)
  const [importError, setImportError] = useState(null)
  const [backupInfo, setBackupInfo] = useState(false)
  // THE "MORE" MENU (economist: "the app is very heavy in text and buttons";
  // and of the five advanced tools: "i use only the builder as for the last
  // runs"). The header keeps what is used all the time - the three tools of
  // the main path, Share stage and Save. The project actions (planning link,
  // backup, clear) and the five advanced tools sit in one menu. An advanced
  // tool that is open shows as a tab while it is open, so the header always
  // says where you are.
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef(null)
  useEffect(() => {
    if (!moreOpen) return undefined
    const onDown = (e) => {
      if (!moreRef.current?.contains(e.target)) setMoreOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])
  const fromMenu = (action) => () => {
    setMoreOpen(false)
    action()
  }
  // THE SEGMENTS IN SIGHT. Eight segments exist; the bar (and step 1) show the
  // ones in use: a segment with a DR demand or DR on its boards, one given a
  // name of its own, the one selected, and any brought in with "Add segment"
  // (kept for the visit). Segment 1 is always there. Nothing is removed - a
  // segment out of sight keeps whatever it holds and comes back the moment it
  // is added or given a demand.
  const [addedSegments, setAddedSegments] = useState(() => new Set())
  const segmentInUse = (seg, i) =>
    i === 0 ||
    seg.main.targetSubsidy != null ||
    seg.recompletion.targetSubsidy != null ||
    seg.main.boards.some((b) => (b.blockedValue ?? 0) > 0) ||
    (!!seg.name && seg.name !== DEFAULT_SEGMENT_NAMES[i])
  const shownSegments = segments.map((_, i) => i).filter((i) => segmentInUse(segments[i], i) || i === activeSegmentIndex || addedSegments.has(i))
  const nextHiddenSegment = segments.findIndex((_, i) => !shownSegments.includes(i))
  // (From the bar the new segment is also selected, ready to be named; from step 1 it is only added as a row.)
  const addSegment = (select = true) => {
    if (nextHiddenSegment < 0) return
    setAddedSegments((prev) => new Set(prev).add(nextHiddenSegment))
    if (select) setActiveSegmentIndex(nextHiddenSegment)
  }
  const importInputRef = useRef(null)

  // Board layout/rank rewards are read-only on every segment but the first
  // now - editing them here would just get overwritten by the sync effect
  // above on the very next render, which would be a confusing silent
  // revert rather than a clear "this is locked" signal. One flag per list,
  // matching the two independent sync effects above - `layoutLocked` for
  // the main list, `recompletionLayoutLocked` for Recompletion's own.
  const layoutLocked = mode === 'editor' && activeSegmentIndex !== 0
  const recompletionLayoutLocked = mode === 'recompletion' && activeSegmentIndex !== 0

  // Lets BoardEditor's "Effort target" card offer "apply to all segments" -
  // by explicit economist request ("move the effort target to also apply
  // to all segments"). Each segment keeps its own total blocked value
  // (segments are meant to differ in subsidy), so the search still runs
  // independently per segment - this just hands BoardEditor every
  // segment's own boards + its own real updateBoard function so it can
  // loop over all segments instead of only ever touching the active one. One pair
  // for the main list, one for Recompletion (its own separate board list
  // per segment) - by explicit follow-up request ("make the recompletion
  // apply to all segments also... like the normal one"), so the
  // Recompletion editor's own Effort target card gets the identical
  // checkbox/behavior, just pointed at `recompletion` instead of `main`.
  const allSegmentsForEffortTarget = segments.map((seg) => ({ name: seg.name, boards: seg.main.boards, onUpdateBoard: seg.main.updateBoard }))
  const allSegmentsForRecompletionEffortTarget = segments.map((seg) => ({
    name: seg.name,
    boards: seg.recompletion.boards,
    onUpdateBoard: seg.recompletion.updateBoard,
  }))
  // See emptyTargetPctInputs' own comment above - lifted out of
  // BoardEditor.jsx's local state so it survives switching the active
  // board or segment, not just Suggest/Apply.
  const [mainTargetPctInputs, setMainTargetPctInputs] = useState(() => storedTargetPctInputs('main'))
  // The build keeps the effort distribution typed in the Effort distribution step (eventBuild.js).
  useEffect(() => {
    setEffortTargetForBuild('main', mainTargetPctInputs)
  }, [mainTargetPctInputs])
  const [recompletionTargetPctInputs, setRecompletionTargetPctInputs] = useState(() => storedTargetPctInputs('rc'))
  useEffect(() => {
    try {
      localStorage.setItem(EFFORT_TARGET_STORAGE_KEY, JSON.stringify({ main: mainTargetPctInputs, rc: recompletionTargetPctInputs }))
    } catch {
      // Storage full or blocked: the curve just lasts for this visit.
    }
  }, [mainTargetPctInputs, recompletionTargetPctInputs])

  // Plain data about every segment, for the helpers that reason about the
  // whole event (what a build is built from; which applied designs are out of
  // date). One definition, used by Build event, Twister and the exports.
  const segmentData = segments.map((seg, i) => ({
    name: seg.name || `Segment ${i + 1}`,
    mainBoards: seg.main.boards,
    rcBoards: seg.recompletion.boards,
    rewardTargets: seg.rewardTargets,
    segmentFactor: seg.segmentFactor,
    sourceAllocation: seg.sourceAllocation,
    twisterPlan: seg.twisterPlan,
  }))
  const designIssues = eventDesignIssues(segmentData)
  // Phases with a build waiting in Build event that is not applied: the
  // Syntax tab exports the applied design only, and says so when a newer
  // build exists (the economist once saw four containers there while the
  // build on screen had thirty).
  const pendingBuilds = [
    ['main', 'Normal'],
    ['rc', 'Recompletion'],
  ]
    .filter(([phase]) => {
      const draft = buildDrafts[phase]
      const built = (draft?.segments ?? []).filter((seg) => seg.status !== 'skipped')
      return built.length > 0 && !built.every((seg) => segments[seg.index] && draftSegmentIsApplied(phase === 'main' ? segments[seg.index].main.boards : segments[seg.index].recompletion.boards, draft))
    })
    .map(([, label]) => label)

  // UNSAVED CHANGES. The project is written by Save only, and nothing used
  // to say that what is on screen differs from what a reload would bring
  // back. The whole project is compared with its last saved (or loaded) form
  // a moment after the screen settles - not on every render: it is large.
  // What counts as "saved" on arrival is the project as it stands shortly
  // after it opened (once the loaded data has been brought up to date), taken
  // on its own clock so a busy first second cannot push it past a first edit.
  const savedSignature = useRef(null)
  const latestSegments = useRef(segments)
  latestSegments.current = segments
  const [unsaved, setUnsaved] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (savedSignature.current != null) return
      try {
        savedSignature.current = JSON.stringify(buildSaveShape(latestSegments.current))
      } catch {
        // Left unset: the next comparison takes it.
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [])
  useEffect(() => {
    const timer = setTimeout(() => {
      let signature
      try {
        signature = JSON.stringify(buildSaveShape(segments))
      } catch {
        return
      }
      if (savedSignature.current == null) savedSignature.current = signature
      setUnsaved(signature !== savedSignature.current)
    }, 700)
    return () => clearTimeout(timer)
  })
  function handleSave() {
    const shape = buildSaveShape(segments)
    saveState(shape)
    savedSignature.current = JSON.stringify(shape)
    setUnsaved(false)
    setSavedAt(new Date())
  }

  // SAVED EVENTS (savedEvents.js): whole events kept in this browser, named by
  // their dates. Saving one also saves the project as Save does, so "Unsaved
  // changes" means changed since the last save of either kind.
  const [savedEventsShown, setSavedEventsShown] = useState(false)
  const [savedEvents, setSavedEvents] = useState(() => listSavedEvents())
  const [openSavedId, setOpenSavedId] = useState(() => openEventId())
  const [savedEventsMessage, setSavedEventsMessage] = useState(null)
  const eventDates = { startDate: segments[0].eventStartDate ?? null, days: segments[0].eventDurationDays ?? null }
  // Each segment's prizes (step 5, Prizes) on its first boards' milestone texts, for the Item Ladder sheet: its own
  // where typed, else the base segment's times its multiplier. Nothing typed there leaves the boards as they are.
  const withPrizes = laddersOfEvent(segments, segments[0].prizeBase, (s) => s.main.boards, (s) => s.recompletion.boards)
  function storeEvent({ id = null, name }) {
    const result = saveEvent({ id, name, ...eventDates, payload: backupPayload() })
    if (!result.ok) {
      setSavedEventsMessage({ ok: false, text: result.message })
      return
    }
    handleSave()
    setOpenEventId(result.event.id)
    setOpenSavedId(result.event.id)
    setSavedEvents(listSavedEvents())
    setSavedEventsMessage({ ok: true, text: id ? `"${result.event.name}" is updated.` : `Saved as "${result.event.name}".` })
  }
  function openSavedEvent(event) {
    if (unsaved && !window.confirm(`Open "${event.name}"?\n\nIt replaces what is open now, which has changes that are not saved. To keep them, close this and save first.`)) return
    const payload = loadEvent(event.id)
    if (!payload || !applyBackup(payload)) {
      setSavedEventsMessage({ ok: false, text: `"${event.name}" could not be read. Nothing was changed.` })
      return
    }
    // What was opened is the project now, as if it had just been saved.
    saveState({ leftoverRule: payload.leftoverRule, segments: payload.segments })
    savedSignature.current = null
    setUnsaved(false)
    setSavedAt(null)
    setOpenEventId(event.id)
    setOpenSavedId(event.id)
    setSavedEventsMessage({ ok: true, text: `"${event.name}" is open.` })
  }
  function deleteSavedEvent(event) {
    if (!window.confirm(`Delete "${event.name}" from the saved events?\n\nIt cannot be brought back unless you downloaded it as a file.${event.id === openSavedId ? ' What is open now stays open.' : ''}`)) return
    deleteEvent(event.id)
    if (event.id === openSavedId) setOpenSavedId(null)
    setSavedEvents(listSavedEvents())
    setSavedEventsMessage({ ok: true, text: `"${event.name}" is deleted.` })
  }
  function downloadSavedEvent(event) {
    const payload = loadEvent(event.id)
    if (!payload) {
      setSavedEventsMessage({ ok: false, text: `"${event.name}" could not be read.` })
      return
    }
    // "August - test A" -> "August-test-A.json"
    downloadPayload(payload, `${event.name.replace(/[^\w]+/g, ' ').trim().replace(/\s+/g, '-') || 'merge-mania-event'}.json`)
  }
  const openSavedEvent_ = savedEvents.find((e) => e.id === openSavedId) ?? null
  // A message of the header's event switcher fades after a few seconds (the Saved events panel keeps its own).
  useEffect(() => {
    if (!savedEventsMessage || savedEventsShown) return undefined
    const timer = setTimeout(() => setSavedEventsMessage(null), 5000)
    return () => clearTimeout(timer)
  }, [savedEventsMessage, savedEventsShown])

  // Encodes the current (main) board list into the URL and copies a
  // shareable player link - recompletion boards aren't part of a shared
  // player stage, only the main list is. The recipient's browser never
  // touches this app's localStorage, so the boards have to travel in the
  // link itself. Still copies the link even when it's long (the economist's
  // call whether to send it anyway) - MAX_SAFE_STAGE_CHARS is a warning
  // threshold, not a hard block, since we can't know the recipient's actual
  // network/client ahead of time.
  //
  // Always targets PRODUCTION_ORIGIN, NEVER window.location.href - found
  // live: this app is naturally designed/tinkered with via `npm run dev`
  // (localhost), and a plain window.location.href-based link would silently
  // copy a `localhost:5173/...` URL there - which looks completely normal
  // to the person who copied it (it's still just a link) but can never work
  // for literally anyone else, since "localhost" means "whichever machine
  // opens this" on every computer, not "the sender's machine." The stage
  // data itself is fully self-contained in the URL regardless of origin, so
  // hardcoding the real deployed host costs nothing and removes an entire
  // class of "it works for me but not for them" reports.
  async function handleShare() {
    // The link carries the main chain AND the RC variant currently selected
    // for testing (the same A/B choice the simulator and Play Tester use), so
    // a shared stage plays through the gated transition into that variant.
    // A board with tiles and nothing under them cannot be played: its tiles
    // never open. (Editing a layout clears that board's contents until it is
    // built again - the economist once shared such a stage and found
    // Recompletion "completely broken".) An unbuilt normal board stops the
    // share; an unbuilt Recompletion list is left out of the link, and said.
    const unbuiltMain = main.boards.map((b, i) => (boardIsBuilt(b) ? null : i + 1)).filter(Boolean)
    if (unbuiltMain.length > 0) {
      setShareLink(null)
      setShareWarning(`No link was made: Board ${unbuiltMain.join(', ')} has tiles but nothing under them, so it cannot be played. Build the event (Build event, step 4) and share again.`)
      return
    }
    const unbuiltRc = activeRcBoards.map((b, i) => (boardIsBuilt(b) ? null : i + 1)).filter(Boolean)
    const rcForLink = unbuiltRc.length > 0 ? null : activeRcBoards
    let encoded
    try {
      encoded = encodeStage(main.boards, rcForLink ? { rcBoards: rcForLink } : {})
    } catch (error) {
      setShareWarning(`The stage link could not be made: ${error?.message ?? error}`)
      return
    }
    // "?s=" and not "?play&stage=": nine characters less in every link (the
    // older address still opens - see App below).
    const fullUrl = `${PRODUCTION_ORIGIN}?s=${encoded}`
    setShareLink(fullUrl)
    if (!(await copyText(fullUrl))) {
      setShareWarning(`The browser did not allow copying. Select and copy the link here: ${fullUrl}`)
      return
    }
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 2000)
    setShareWarning(
      unbuiltRc.length > 0
        ? `The link plays the normal event only: Recompletion Board ${unbuiltRc.join(', ')} has tiles but nothing under them (its layout was changed after the last build), so Recompletion was left out. Build and apply Recompletion, then share again to include it.`
        : fullUrl.length > MAX_SAFE_STAGE_CHARS
        ? `Heads up: this link is long (${main.boards.length} boards plus the Recompletion boards) - some chat apps, email clients, or corporate networks may fail to open it for your recipient. If it doesn't open, try trimming boards.`
        : null,
    )
  }

  // "Share planning" — a read-only link for coworkers to see the economist's
  // actual configured design (every segment's own main-list boards, subsidy
  // demand, generator tiers, lucky drops, rank rewards) AND run the same
  // Playthrough simulation / Effort Distribution chart / lucky-drop Monte
  // Carlo the economist themselves would, without being able to edit
  // anything — by explicit request ("I want to just have a read-only option
  // to send to co workers to see the full simulator"), distinct from "Share
  // stage" (a PLAYABLE single board chain for players, main list of the
  // ACTIVE segment only). Same URL-link mechanism as Share stage
  // (gzip+base64url via planShare.js, factored to share urlCodec.js with
  // stageShare.js) rather than a downloaded file, and rendered by PlanApp
  // (see App()'s own routing) rather than the live EditorApp — a hard
  // component-level separation, the same reasoning PlayApp already
  // established: a link meant for someone outside this editing session must
  // never accidentally expose editing affordances, even inert ones.
  //
  // Deliberately EVERY segment's own main list, not just the active one —
  // by explicit request ("all segments in one link") — each segment carries
  // its own name/boards/targetSubsidy/event schedule; Recompletion and
  // presets are left out, matching Share Stage's own existing scope exactly
  // (recompletion boards were never asked to be shareable, and presets are
  // an iteration aid with nothing to show a reviewer).
  //
  // A plan is expected to run meaningfully bigger than a single shared stage
  // (it carries every segment's own board list, not one), so
  // MAX_SAFE_PLAN_CHARS is a lower, more conservative warning threshold than
  // MAX_SAFE_STAGE_CHARS — still just a warning, not a hard block, same as
  // Share stage: the link still copies either way, it's the economist's own
  // call whether to send it regardless.
  async function handleSharePlan() {
    const plan = segments.map((seg) => ({
      name: seg.name,
      boards: seg.main.boards,
      targetSubsidy: seg.main.targetSubsidy,
      eventStartDate: seg.eventStartDate,
      eventDurationDays: seg.eventDurationDays,
      // V2 reward economy (the boards above already carry the reward-chain/
      // drop-group config and per-board ccPercent/minDropRank/
      // rewardQueueItems) - these three are segment-level state a reviewer
      // needs to understand the configured targets and source split.
      rewardTargets: seg.rewardTargets,
      segmentFactor: seg.segmentFactor,
      sourceAllocation: seg.sourceAllocation,
      // Twister: each segment's own cost per spin (main list) and the shared
      // design inputs. Costs for the RC lists travel as plain numbers since
      // the plan link doesn't carry RC boards.
      twisterPlan: segments[0].twisterPlan,
      twisterCosts: {
        main: seg.main.boards[0]?.twisterSpinCost ?? null,
        rc: seg.recompletion.boards[0]?.twisterSpinCost ?? null,
      },
    }))
    const encoded = encodePlan(plan)
    const fullUrl = `${PRODUCTION_ORIGIN}?plan=${encoded}`
    setShareLink(fullUrl)
    await copyText(fullUrl)
    setPlanCopied(true)
    setTimeout(() => setPlanCopied(false), 2000)
    setPlanWarning(
      fullUrl.length > MAX_SAFE_PLAN_CHARS
        ? `Heads up: this link is long (${segments.length} segments) - some chat apps, email clients, or corporate networks may fail to open it for your recipient. If it doesn't open, try trimming boards.`
        : null,
    )
  }

  // Durable backup, fully independent of localStorage - so board data
  // survives clearing site data, a dev-server port mismatch masking a save
  // under a different origin (see vite.config.js), or just moving to a
  // different machine/browser. Exports every segment's full state in one
  // file, same shape handleSave writes (buildSaveShape) since they're
  // already saved together. This is ADDITIONAL to handleSave/localStorage,
  // not a replacement for it.
  // Besides the project: the drafts waiting in Build event and the effort
  // shape typed in step 4 (both live outside the project save), so a file
  // sent to reproduce an issue opens on the same draft, not on a new build.
  // A saved event (Saved events, in the "More" menu) holds exactly this too.
  function backupPayload() {
    return {
      ...buildSaveShape(segments),
      ...(buildDrafts.main || buildDrafts.rc ? { buildDrafts: JSON.parse(serializeDrafts({ drafts: buildDrafts, validation: buildValidation })) } : {}),
      effortTargets: { main: mainTargetPctInputs, rc: recompletionTargetPctInputs },
      // The Economy page's economy, so a file sent to reproduce an issue
      // values things the same way (restored from a file only when asked).
      economy: loadEconomy(),
    }
  }
  function downloadPayload(payload, fileName) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
  }
  function handleExportBackup() {
    downloadPayload(backupPayload(), `merge-mania-backup-${new Date().toISOString().slice(0, 10)}.json`)
  }

  // Reads a file produced by handleExportBackup (current 4-segment shape, OR
  // an older pre-segments/pre-Recompletion export - segmentsFromPersisted
  // handles both, same migration a localStorage load already uses). Never
  // partially applies - a malformed/corrupted file leaves every segment
  // untouched and just surfaces an error banner.
  async function handleImportFile(file) {
    let parsed
    try {
      const text = await file.text()
      parsed = JSON.parse(text)
    } catch {
      setImportError('That file looks invalid or corrupted - it could not be read as backup JSON. Nothing was changed.')
      return
    }
    if (!applyBackup(parsed)) {
      setImportError('That file looks invalid or corrupted - it does not contain any segment/board data. Nothing was changed.')
      return
    }
    // What is open now came from a file, not from the list of saved events.
    setOpenEventId(null)
    setOpenSavedId(null)
    // The economy (the Economy page: worth, currencies, keys) is the whole
    // app's, Chef's too: a file's is put in use only when the economist says
    // so. (A saved event opened from the switcher never touches it.)
    if (parsed.economy && typeof parsed.economy === 'object') {
      const theirs = JSON.stringify({ ...normalizeEconomy(parsed.economy), updatedAt: null })
      const ours = JSON.stringify({ ...loadEconomy(), updatedAt: null })
      if (theirs !== ours && window.confirm('The file also holds an economy (what everything is worth, the currencies and keys) that differs from this browser\'s. It is used by every feature, Chef too. Replace this browser\'s economy with the file\'s?')) saveEconomy(parsed.economy)
    }
  }

  // Puts the contents of a backup (a file, or a saved event) on screen.
  // False, and nothing changed, when it holds no segment data.
  function applyBackup(parsed) {
    const imported = segmentsFromPersisted(parsed)
    if (!imported) return false

    segments.forEach((seg, i) => {
      const data = imported[i]
      seg.main.replaceAll({ boards: data.boards, presets: data.presets, targetSubsidy: data.targetSubsidy })
      seg.recompletion.replaceAll({
        boards: data.recompletionBoards,
        presets: data.recompletionPresets,
        targetSubsidy: data.recompletionTargetSubsidy,
      })
      seg.setLegacyRecompletionB(data.legacyRecompletionB ?? null)
      seg.setRecompletionRecovery(data.recompletionRecovery ?? null)
      seg.setName(data.name)
      seg.setEventStartDate(data.eventStartDate)
      seg.setEventDurationDays(data.eventDurationDays)
      // V2 fields - restored here too (a real, pre-existing gap found while
      // adding "Recompletion B": these were never restored on import at
      // all, so an Import Backup silently kept whatever reward
      // targets/factor/allocation happened to already be in memory instead
      // of the file's own saved values).
      seg.setRewardTargets(data.rewardTargets)
      seg.setSegmentFactor(data.segmentFactor)
      seg.setSourceAllocation(data.sourceAllocation)
      seg.setTwisterPlan(data.twisterPlan)
      seg.setLegacyRewardConfig(data.legacyRewardConfig ?? null)
      // The segment plan, conditions and prizes (step 1 and step 5).
      seg.setCondition(data.condition)
      seg.setSegmentKey(data.segmentKey)
      seg.setPrizeLadder(data.prizeLadder)
      seg.setSegmentPlan(data.segmentPlan)
      seg.setDrWorth(data.drWorth)
      seg.setPrizeBase(data.prizeBase)
    })
    setActiveSegmentIndex(0)
    setDataEpoch((n) => n + 1)
    resetBuildWorkflow()
    // A backup made since drafts travel with it brings them back, marked as
    // restored (nothing is applied by that), and the effort distribution too.
    if (parsed.buildDrafts) {
      const restored = deserializeDrafts(JSON.stringify(parsed.buildDrafts))
      setBuildDrafts(restored.drafts)
      setBuildValidation(restored.validation)
      setDraftNotice(restored.notice)
    }
    for (const [which, set] of [['main', setMainTargetPctInputs], ['rc', setRecompletionTargetPctInputs]]) {
      const typed = parsed.effortTargets?.[which]
      const blank = emptyTargetPctInputs()
      if (typed && typeof typed === 'object') for (const rank of Object.keys(blank)) if (typeof typed[rank] === 'string') blank[rank] = typed[rank]
      set(blank)
    }
    setImportError(null)
    return true
  }

  function handleImportChange(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later and still get a change event
    if (file) handleImportFile(file)
  }

  // Wipes the saved localStorage blob AND every segment's in-memory state
  // back to a single fresh board each - the same shape initialState() falls
  // back to for a first-ever load. Unlike every other delete in this app
  // (board remove, preset remove - see CLAUDE.md's no-confirm-delete
  // convention), this one confirms first: those are narrow, one-item-out-of-
  // a-list actions, while this discards the entire project (every segment's
  // board lists, presets, subsidy targets, and event schedule) in one shot
  // with no undo. replaceAll (already used by backup restore) does each
  // segment's in-memory swap; clearState removes the localStorage key so a
  // stale reload can't bring old data back.
  function handleClearData() {
    if (
      !window.confirm(
        'Clear everything? This empties all 8 segments: demands, boards, rewards, Twister and the drafts.\n\nA backup file of what you have now is downloaded first, so you can bring it back with "Import backup".',
      )
    ) {
      return
    }
    // The way back: what is being cleared, as a backup file.
    handleExportBackup()
    clearState()
    setOpenEventId(null)
    setOpenSavedId(null)
    // What is left after clearing is the new starting point, not an unsaved change.
    savedSignature.current = null
    segments.forEach((seg, i) => {
      seg.main.replaceAll({ boards: [createBoard('Board 1')], presets: [], targetSubsidy: null })
      seg.recompletion.replaceAll({ boards: [createBoard('Board 1')], presets: [], targetSubsidy: null })
      seg.setLegacyRecompletionB(null)
      seg.setRecompletionRecovery(null)
      seg.setName(DEFAULT_SEGMENT_NAMES[i])
      seg.setEventStartDate(null)
      seg.setEventDurationDays(7)
      // Same pre-existing V2 gap fixed in handleImportFile above - these
      // were never reset here either.
      seg.setRewardTargets({ main: createRewardTargets(), rc: createRewardTargets() })
      seg.setSegmentFactor(1)
      seg.setSourceAllocation({ main: createSourceAllocation(), rc: createSourceAllocation() })
      seg.setTwisterPlan({ main: createTwisterPlan(), rc: createTwisterPlan() })
      seg.setLegacyRewardConfig(null)
      seg.setCondition('')
      seg.setSegmentKey('')
      seg.setPrizeLadder({ main: {}, rc: {} })
      seg.setSegmentPlan(null)
      seg.setDrWorth(null)
      seg.setPrizeBase(0)
    })
    setActiveSegmentIndex(0)
    setDataEpoch((n) => n + 1)
    resetBuildWorkflow()
    setMainTargetPctInputs(emptyTargetPctInputs())
    setRecompletionTargetPctInputs(emptyTargetPctInputs())
    setSavedAt(null)
    setImportError(null)
    setShareWarning(null)
  }

  return (
    <div className="min-h-screen merge-app">
      <div className="app-backdrop" aria-hidden="true" />

      <header className="bg-white/80 backdrop-blur-md border-b border-white sticky top-0 z-30 shadow-sm shadow-purple-950/5">
        {/* Two rows, none of which is ever asked to shrink its text: the title
            with Share stage, the "More" menu and Save; then the tools and the
            segments. Every label is whitespace-nowrap, and a row that runs
            out of room wraps whole items instead. */}
        <div className="max-w-[1760px] mx-auto px-6 pt-3 pb-2 flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
          <div className="flex items-center gap-3 shrink-0">
            <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onHome} className="whitespace-nowrap">
              Features
            </Button>
            <div className="bg-gradient-to-br from-purple-600 to-fuchsia-500 text-white rounded-xl p-2 shadow-md shadow-purple-500/30 shrink-0">
              <Puzzle size={20} strokeWidth={2.25} />
            </div>
            <h1 className="font-display text-lg font-bold text-slate-900 leading-tight tracking-tight whitespace-nowrap">Merge Mania Board Simulator</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <EventSwitcher
              events={savedEvents}
              openId={openSavedId}
              current={eventDates}
              unsaved={unsaved}
              message={savedEventsShown ? null : savedEventsMessage}
              onOpen={openSavedEvent}
              onSaveNew={(name) => storeEvent({ name })}
              onUpdate={() => storeEvent({ id: openSavedId, name: openSavedEvent_?.name })}
              onManage={() => { setSavedEvents(listSavedEvents()); setSavedEventsMessage(null); setSavedEventsShown(true) }}
            />
            {unsaved ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 whitespace-nowrap" data-testid="unsaved-changes" title="The project is kept in this browser only when you press Save">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                Unsaved changes
              </span>
            ) : (
              savedAt && <span className="text-xs text-slate-400 whitespace-nowrap">Saved {savedAt.toLocaleTimeString()}</span>
            )}
            <Button variant="secondary" size="sm" icon={shareCopied ? Check : Share2} onClick={handleShare} className="whitespace-nowrap">
              {shareCopied ? 'Link copied!' : 'Share stage'}
            </Button>
            <div className="relative" ref={moreRef}>
              <Button variant="secondary" size="sm" icon={Menu} onClick={() => setMoreOpen((v) => !v)} className="whitespace-nowrap" aria-expanded={moreOpen} aria-haspopup="true" data-testid="more-menu" title="Planning link, backup, clear data, and the advanced tools">
                More
              </Button>
              {moreOpen && (
                <div className="absolute right-0 top-full z-40 mt-2 w-60 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl shadow-purple-950/10" data-testid="more-menu-panel">
                  <div className="px-2.5 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Project</div>
                  <MenuItem icon={CalendarDays} onClick={fromMenu(() => { setSavedEvents(listSavedEvents()); setSavedEventsMessage(null); setSavedEventsShown(true) })} title="Whole events kept in this browser, by their dates: save this one, open another" data-testid="saved-events-toggle">
                    Saved events
                  </MenuItem>
                  <MenuItem icon={planCopied ? Check : Eye} onClick={fromMenu(handleSharePlan)} title="A read-only link for coworkers to see every segment's design and run the full simulator — no editing">
                    Share planning
                  </MenuItem>
                  <MenuItem icon={Download} onClick={fromMenu(handleExportBackup)} title="Saves everything to a file: all 8 segments, the event in use, and the results of the last builds.">
                    Export backup
                  </MenuItem>
                  <MenuItem icon={Upload} onClick={fromMenu(() => importInputRef.current?.click())}>
                    Import backup
                  </MenuItem>
                  <MenuItem icon={Info} onClick={fromMenu(() => setBackupInfo(true))} data-testid="backup-contents-toggle">
                    What a backup holds
                  </MenuItem>
                  <MenuItem icon={Trash2} danger onClick={fromMenu(handleClearData)}>
                    Clear data
                  </MenuItem>
                  <div className="mt-1.5 border-t border-slate-100 px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400" data-testid="advanced-tools-label">
                    Advanced tools
                  </div>
                  {MODES.filter((m) => m.advanced && m.id !== mode).map(({ id, label, icon, hint }) => (
                    <MenuItem key={id} icon={icon} onClick={fromMenu(() => setMode(id))} title={hint} data-mode={id} data-advanced="yes" aria-pressed={false}>
                      {label}
                    </MenuItem>
                  ))}
                </div>
              )}
            </div>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={handleImportChange}
            />
            <Button variant="dark" size="sm" icon={Save} onClick={handleSave} className="whitespace-nowrap">
              Save
            </Button>
          </div>
        </div>

        <div className="max-w-[1760px] mx-auto px-6 pb-3 flex items-center gap-x-6 gap-y-2 flex-wrap">
          <div className="inline-flex items-center gap-1 bg-slate-100/80 rounded-xl p-1 flex-wrap max-w-full" aria-label="Tool">
            {MODES.filter((m) => !m.advanced || m.id === mode).map(({ id, label, icon: Icon, advanced, hint }) => (
              <button
                key={id}
                type="button"
                aria-pressed={mode === id}
                onClick={() => setMode(id)}
                title={hint}
                data-mode={id}
                data-advanced={advanced ? 'yes' : 'no'}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap transition-all duration-150 ${
                  mode === id ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-sm shadow-purple-500/30' : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                <Icon size={14} strokeWidth={2.25} className="shrink-0" />
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 shrink-0">Segment</span>
            <div className="flex items-center gap-1 bg-slate-100/80 rounded-xl p-1 flex-wrap" data-testid="segment-bar">
              {shownSegments.map((i) => {
                const seg = segments[i]
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActiveSegmentIndex(i)}
                    title={i === activeSegmentIndex ? 'Editing this segment’s name' : `Switch to ${seg.name}`}
                    data-segment-tab={i}
                    className={`flex items-center text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap transition-all duration-150 ${
                      activeSegmentIndex === i ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-sm shadow-purple-500/30' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {activeSegmentIndex === i ? (
                      <input
                        value={seg.name}
                        onChange={(e) => seg.setName(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        placeholder={DEFAULT_SEGMENT_NAMES[i]}
                        className="bg-transparent outline-none w-28 text-white placeholder-white/60"
                      />
                    ) : (
                      seg.name
                    )}
                  </button>
                )
              })}
              {nextHiddenSegment >= 0 && (
                <button
                  type="button"
                  onClick={() => addSegment(true)}
                  title={`Bring in ${DEFAULT_SEGMENT_NAMES[nextHiddenSegment]}. A segment is shown once it has a DR demand; up to ${SEGMENT_COUNT}.`}
                  className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg whitespace-nowrap text-purple-700 hover:bg-white"
                  data-testid="add-segment"
                >
                  <Plus size={13} strokeWidth={2.5} /> Add segment
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {savedEventsShown && (
        <SavedEventsPanel
          events={savedEvents}
          openId={openSavedId}
          current={eventDates}
          unsaved={unsaved}
          message={savedEventsMessage}
          onSaveNew={(name) => storeEvent({ name })}
          onUpdate={() => storeEvent({ id: openSavedId, name: openSavedEvent_?.name })}
          onOpen={openSavedEvent}
          onRename={(id, name) => { renameEvent(id, name); setSavedEvents(listSavedEvents()) }}
          onDownload={downloadSavedEvent}
          onDelete={deleteSavedEvent}
          onClose={() => setSavedEventsShown(false)}
        />
      )}
      {backupInfo && (
        <div className="mx-auto mt-2 mb-2 flex max-w-5xl flex-wrap items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 shadow-sm" data-testid="backup-contents">
          <div className="min-w-[16rem] flex-1 leading-relaxed">
            <div className="font-semibold text-slate-800">What a backup file holds</div>
            <ul className="mt-1 ml-4 list-disc">
              <li>All 8 segments: DR demand and board subsidy, board layouts, what is under every tile, reward targets and rules, rank values, the Twister, dates.</li>
              <li>The event in use - the normal event and Recompletion, exactly as the Play tester and the exports use it.</li>
              <li>The results of the last build of each phase with its test on players, the build before it (for &quot;Go back to the previous build&quot;), and the effort shape typed in step 4.</li>
              <li>The Economy page (what everything is worth, the currencies and keys). Importing asks before it replaces this browser&apos;s, since every feature uses it.</li>
            </ul>
            <div className="mt-1">
              Not in it: results of the advanced Twister tool, and which tab or step you were on. <span className="font-semibold text-slate-700">To reproduce an issue</span>, export a backup right
              when you see it and send the file - &quot;Import backup&quot; opens it on the same boards and the same build results. Importing replaces everything that is open; it is not saved in this
              browser until you press Save.
            </div>
          </div>
          <button type="button" className="rounded-lg px-2 py-1 font-semibold text-purple-700 hover:bg-purple-50" onClick={() => setBackupInfo(false)}>
            Close
          </button>
        </div>
      )}
      {shareLink && (
        <div className="mx-auto mb-2 flex max-w-5xl flex-wrap items-center gap-2 rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-900" data-testid="share-link-box">
          <span className="font-semibold whitespace-nowrap">Link:</span>
          <input
            readOnly
            value={shareLink}
            autoFocus
            onFocus={(e) => e.target.select()}
            onClick={(e) => e.target.select()}
            className="min-w-[12rem] flex-1 rounded-lg border border-purple-200 bg-white px-2 py-1 font-mono text-[11px] text-slate-700"
            aria-label="The link to copy"
            data-testid="share-link"
          />
          <span className="text-purple-700">If pasting gives nothing, click the link and press Ctrl+C.</span>
          {/* For a browser where copying does not work at all (an editor preview pane, a locked clipboard): open the link, or save it as a file. */}
          <a href={shareLink} target="_blank" rel="noreferrer" className="rounded-lg px-2 py-1 font-semibold text-purple-700 underline hover:bg-purple-100" data-testid="share-link-open">
            Open it
          </a>
          <button
            type="button"
            className="rounded-lg px-2 py-1 font-semibold text-purple-700 hover:bg-purple-100"
            data-testid="share-link-save"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([shareLink], { type: 'text/plain' }))
              const link = document.createElement('a')
              link.href = url
              link.download = 'merge-mania-link.txt'
              document.body.appendChild(link)
              link.click()
              document.body.removeChild(link)
              URL.revokeObjectURL(url)
            }}
          >
            Save as a file
          </button>
          <button type="button" className="rounded-lg px-2 py-1 font-semibold text-purple-700 hover:bg-purple-100" onClick={() => setShareLink(null)}>
            Close
          </button>
        </div>
      )}
      {shareWarning && (
        <div className="max-w-[1760px] mx-auto px-6 pt-4">
          <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
            <TriangleAlert size={16} className="shrink-0 mt-0.5" />
            <span className="text-sm flex-1">{shareWarning}</span>
            <button
              type="button"
              onClick={() => setShareWarning(null)}
              className="text-amber-600 hover:text-amber-800 text-xs font-semibold"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {planWarning && (
        <div className="max-w-[1760px] mx-auto px-6 pt-4">
          <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
            <TriangleAlert size={16} className="shrink-0 mt-0.5" />
            <span className="text-sm flex-1">{planWarning}</span>
            <button
              type="button"
              onClick={() => setPlanWarning(null)}
              className="text-amber-600 hover:text-amber-800 text-xs font-semibold"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {importError && (
        <div className="max-w-[1760px] mx-auto px-6 pt-4">
          <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
            <TriangleAlert size={16} className="shrink-0 mt-0.5" />
            <span className="text-sm flex-1">{importError}</span>
            <button
              type="button"
              onClick={() => setImportError(null)}
              className="text-amber-600 hover:text-amber-800 text-xs font-semibold"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main className="max-w-[1760px] mx-auto px-6 py-4 flex gap-8">
        {mode === 'build' ? (
          <BuildEventPage
            key={dataEpoch}
            segments={segments}
            activeSegmentIndex={activeSegmentIndex}
            onSelectSegment={setActiveSegmentIndex}
            shownSegments={shownSegments}
            onAddSegment={nextHiddenSegment >= 0 ? () => addSegment(false) : null}
            phase={rewardsPhase}
            onPhaseChange={setRewardsPhase}
            step={buildStep}
            onStepChange={setBuildStep}
            drafts={buildDrafts}
            onDraftsChange={setBuildDrafts}
            validation={buildValidation}
            onValidationChange={setBuildValidation}
            onOpenTool={setMode}
            designIssues={designIssues}
            exportOverride={exportOverride}
            onExportOverride={setExportOverride}
            draftNotice={draftNotice}
            targetPctInputs={rewardsPhase === 'main' ? mainTargetPctInputs : recompletionTargetPctInputs}
            onTargetPctInputsChange={rewardsPhase === 'main' ? setMainTargetPctInputs : setRecompletionTargetPctInputs}
            playOverride={playOverride}
            onPlay={(override) => {
              setPlayOverride(override)
              setMode('play')
            }}
          />
        ) : mode === 'recompletion' ? (
          <>
            <BoardList
              maxRankUnderTiles={13}
              firstBoardCap={RC_FIRST_BOARD_SUBSIDY_CAP_DR}
              boards={recompletion.boards}
              activeId={recompletion.activeBoard?.id}
              onSelect={recompletion.setActiveId}
              onAdd={recompletion.addBoard}
              onDuplicate={recompletion.duplicateBoard}
              onRemove={recompletion.removeBoard}
              onMove={recompletion.moveBoard}
              onUpdateBoard={recompletion.updateBoard}
              targetSubsidy={recompletion.targetSubsidy}
              layoutLocked={recompletionLayoutLocked}
            />
            <div className="flex flex-col gap-4 flex-1 min-w-0">
            <LegacyRecompletionRecovery segment={activeSegment} list={recompletion} isBaseSegment={activeSegmentIndex === 0} />
            {recompletion.activeBoard && (
              <BoardEditor
                key={recompletion.activeBoard.id}
                board={recompletion.activeBoard}
                boards={recompletion.boards}
                boardIndex={recompletion.activeIndex}
                isFirstBoard={recompletion.activeIndex === 0}
                isRecompletion
                presets={recompletion.presets}
                onChange={recompletion.updateBoard}
                onUpdateBoard={recompletion.updateBoard}
                onSavePreset={recompletion.savePreset}
                onDeletePreset={recompletion.removePreset}
                onUpdateTargetEv={recompletion.syncTargetEv}
                onUpdateRankRewards={recompletion.syncRankRewards}
                onUpdateGeneratorTiers={recompletion.syncGeneratorTiers}
                targetSubsidy={recompletion.targetSubsidy}
                onUpdateTargetSubsidy={recompletion.updateTargetSubsidy}
                demandFollowsNormal={main.targetSubsidy != null}
                onSetBoardCount={recompletion.setBoardCount}
                allSegments={allSegmentsForRecompletionEffortTarget}
                targetPctInputs={recompletionTargetPctInputs}
                onTargetPctInputsChange={setRecompletionTargetPctInputs}
                layoutLocked={recompletionLayoutLocked}
              />
            )}
            </div>
          </>
        ) : (
          <>
            {mode !== 'syntax' && (
            <BoardList
              boards={main.boards}
              activeId={main.activeBoard?.id}
              onSelect={main.setActiveId}
              onAdd={main.addBoard}
              onDuplicate={main.duplicateBoard}
              onRemove={main.removeBoard}
              onMove={main.moveBoard}
              onUpdateBoard={main.updateBoard}
              targetSubsidy={main.targetSubsidy}
              layoutLocked={layoutLocked}
              pickOnly={mode === 'play'}
            />
            )}
            {main.activeBoard && mode === 'editor' && (
              <BoardEditor
                key={main.activeBoard.id}
                board={main.activeBoard}
                boards={main.boards}
                boardIndex={main.activeIndex}
                isFirstBoard={main.activeIndex === 0}
                presets={main.presets}
                onChange={main.updateBoard}
                onUpdateBoard={main.updateBoard}
                onSavePreset={main.savePreset}
                onDeletePreset={main.removePreset}
                onUpdateTargetEv={main.syncTargetEv}
                onUpdateRankRewards={main.syncRankRewards}
                onUpdateGeneratorTiers={main.syncGeneratorTiers}
                targetSubsidy={main.targetSubsidy}
                onUpdateTargetSubsidy={main.updateTargetSubsidy}
                onSetBoardCount={main.setBoardCount}
                eventStartDate={eventStartDate}
                eventDurationDays={eventDurationDays}
                onUpdateEventStartDate={setEventStartDate}
                onUpdateEventDurationDays={setEventDurationDays}
                layoutLocked={layoutLocked}
                allSegments={allSegmentsForEffortTarget}
                targetPctInputs={mainTargetPctInputs}
                onTargetPctInputsChange={setMainTargetPctInputs}
                rcBoards={activeRcBoards}
              />
            )}
            {main.activeBoard && mode === 'play' && (
              <div className="flex flex-col gap-3 flex-1 min-w-0">
                {/* Always says what is being played - a draft is never
                    silently substituted for the applied design, or back. */}
                <div
                  className={`flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-2 text-sm ${
                    playOverride ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white/70 text-slate-600'
                  }`}
                  data-testid="play-source"
                >
                  <span className="flex-1 min-w-[16rem]">
                    {playOverride ? (
                      <>
                        Playing <span className="font-semibold">{playOverride.label}</span>
                        {playOverride.builtAt ? `, built at ${new Date(playOverride.builtAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}. The exports hold what is in use, not this - step 6 can
                        put it in use.
                      </>
                    ) : (
                      (() => {
                        const design = designConsistency(main.boards)
                        const builtTime = design.stamp?.builtAt ? new Date(design.stamp.builtAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null
                        return (
                          <>
                            Playing <span className="font-semibold">{activeSegment.name || `Segment ${activeSegmentIndex + 1}`}</span>
                            <span data-play-design={design.state}>
                              {design.state === 'consistent'
                                ? `: the build${builtTime ? ` of ${builtTime}` : ''}, in use.`
                                : design.state === 'stale'
                                  ? `: the boards in use. They were edited after the build${builtTime ? ` of ${builtTime}` : ''}, so they no longer match it.`
                                  : design.state === 'empty'
                                    ? ': nothing is built on these boards yet. Build the event first (Build event, step 4).'
                                    : ': the boards in use. They were made by hand, not by a build.'}
                            </span>
                            {pendingBuilds.includes('Normal') && <span className="font-semibold text-amber-700"> Another build is kept that is not in use (step 6) - this is not it.</span>}
                          </>
                        )
                      })()
                    )}
                  </span>
                  {playOverride && (
                    <Button variant="secondary" size="sm" onClick={() => setPlayOverride(null)}>
                      Play what is in use
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setBuildStep(playOverride || pendingBuilds.length > 0 ? 'finalize' : 'build')
                      setMode('build')
                    }}
                    data-testid="play-back-to-build"
                  >
                    {playOverride || pendingBuilds.length > 0 ? 'Back to test and export (step 6)' : 'Back to the build results (step 4)'}
                  </Button>
                </div>
                {playOverride ? (
                  <PlayTester key={`draft-${playOverride.builtAt}`} boards={playOverride.boards} boardIndex={0} rcBoards={playOverride.rcBoards} />
                ) : (
                  <PlayTester key={main.activeBoard.id} boards={main.boards} boardIndex={main.activeIndex} rcBoards={activeRcBoards} />
                )}
              </div>
            )}
            {mode === 'cc' && <CCManagement boards={main.boards} />}
            {mode === 'rewards' && (
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                {/* Phase tabs + (for RC) the variant picker - one phase on
                    screen at a time. RC targets are SHARED by variants A and
                    B (one rewardTargets.rc per segment); the variant picker
                    only selects which RC board list the workflow solves and
                    applies to - mirroring "Ops chooses which variant players
                    receive," never an automatic routing decision here. */}
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { id: 'main', label: 'Normal phase' },
                    { id: 'rc', label: 'RC phase' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setRewardsPhase(p.id)}
                      className={`px-3 py-1.5 rounded-xl text-sm font-semibold transition-colors ${
                        rewardsPhase === p.id ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow' : 'bg-white/70 text-slate-600 hover:bg-white'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <RewardsPage
                  key={`${rewardsPhase}-${activeSegmentIndex}-${dataEpoch}`}
                  list={rewardsPhase === 'main' ? main : recompletion}
                  mainList={main}
                  phaseLabel={rewardsPhase === 'main' ? 'Normal phase' : 'RC phase'}
                  phase={rewardsPhase}
                  variantLabel={null}
                  legacyListKey={rewardsPhase === 'main' ? 'boards' : 'recompletionBoards'}
                  designStatus={designConsistency((rewardsPhase === 'main' ? main : recompletion).boards)}
                  onRebuild={() => goRebuild(rewardsPhase)}
                  segment={activeSegment}
                  segmentName={activeSegment.name || `Segment ${activeSegmentIndex + 1}`}
                  isBaseSegment={activeSegmentIndex === 0}
                  baseTargets={segments[0].rewardTargets[rewardsPhase]}
                  onUpdateRewardTargets={(v) => activeSegment.setRewardTargets({ ...activeSegment.rewardTargets, [rewardsPhase]: v })}
                  onUpdateSegmentFactor={activeSegment.setSegmentFactor}
                  onUpdateSourceAllocation={(v) => activeSegment.setSourceAllocation({ ...activeSegment.sourceAllocation, [rewardsPhase]: v })}
                  // Every segment's own inputs for this phase - the base
                  // segment's absolute targets, everyone else's derived as
                  // base x their own segmentFactor (never an invented
                  // ratio), each against its own boards/config and its own
                  // saved source split.
                  allSegments={segments.map((seg, i) => ({
                    name: seg.name || `Segment ${i + 1}`,
                    list: rewardsPhase === 'main' ? seg.main : seg.recompletion,
                    mainList: seg.main,
                    targets: effectiveRewardTargets(segments[0].rewardTargets[rewardsPhase], i === 0 ? 1 : (seg.segmentFactor ?? 1)),
                    allocation: seg.sourceAllocation[rewardsPhase],
                  }))}
                />
              </div>
            )}
            {mode === 'twister' && (
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { id: 'main', label: 'Normal phase' },
                    { id: 'rc', label: 'RC phase' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setRewardsPhase(p.id)}
                      className={`px-3 py-1.5 rounded-xl text-sm font-semibold transition-colors ${
                        rewardsPhase === p.id ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow' : 'bg-white/70 text-slate-600 hover:bg-white'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <TwisterPage
                  key={`${rewardsPhase}-${dataEpoch}`}
                  phase={rewardsPhase}
                  phaseLabel={rewardsPhase === 'main' ? 'Normal phase' : 'Recompletion phase'}
                  activeSegmentIndex={activeSegmentIndex}
                  // Shared definitions and drops are edited on Segment 1's
                  // list for this phase and sync to every other segment.
                  baseList={rewardsPhase === 'main' ? segments[0].main : segments[0].recompletion}
                  plan={segments[0].twisterPlan[rewardsPhase]}
                  onUpdatePlan={(next) => segments[0].setTwisterPlan({ ...segments[0].twisterPlan, [rewardsPhase]: next })}
                  segments={segments.map((seg, i) => ({
                    name: seg.name || `Segment ${i + 1}`,
                    list: rewardsPhase === 'main' ? seg.main : seg.recompletion,
                    mainList: seg.main,
                  }))}
                  onOpenRewards={() => setMode('rewards')}
                  source={twisterSource}
                  onSourceChange={setTwisterSource}
                  results={twisterResults}
                  onResultsChange={setTwisterResults}
                  draft={buildDrafts[rewardsPhase]}
                  draftCurrent={!!buildDrafts[rewardsPhase] && buildDrafts[rewardsPhase].key === buildInputsKey({ phase: rewardsPhase, segments: segmentBuildInputs(segmentData, rewardsPhase) })}
                  onRebuild={() => goRebuild(rewardsPhase)}
                />
              </div>
            )}
            {mode === 'syntax' && (
              <SyntaxPage
                boards={withPrizes[activeSegmentIndex].main}
                recompletionBoards={withPrizes[activeSegmentIndex].rc}
                eventStartDate={eventStartDate}
                eventDurationDays={eventDurationDays}
                twisterPlan={segments[0].twisterPlan}
                segmentIndex={activeSegmentIndex}
                designIssues={designIssues}
                exportOverride={exportOverride}
                onExportOverride={setExportOverride}
                onRebuild={() => goRebuild(designIssues[0]?.phase)}
                pendingBuilds={pendingBuilds}
                onOpenBuild={() => setMode('build')}
                allSegments={segments.map((seg, i) => ({
                  name: seg.name,
                  boards: withPrizes[i].main,
                  recompletionBoards: withPrizes[i].rc,
                }))}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}

// The routing that lived here (play link, plan link, the old home page, one
// feature at a time) moved to src/platform/shell/PlatformApp.tsx. This file
// now only exports the Merge Mania screens it always held.
