import { useRef, useState } from 'react'
import { Plus, Trash2, TriangleAlert, CircleCheck, Gift, ClipboardPaste, Lock, LockOpen } from 'lucide-react'
import Card from '../../../../components/ui/Card'
import NumberField from '../../../../components/ui/NumberField'
import Button from '../../../../components/ui/Button'
import InfoHint from '../../../../components/ui/InfoHint'
import {
  REWARD_TYPES,
  ALL_REWARD_TYPES,
  TWISTER_TYPE,
  COIN_TYPE,
  REWARD_TYPE_LABELS,
  REWARD_MAX_RANK,
  validateRewardChainConfig,
  coinAllowanceSyntax,
  coinSyntaxFollowsWorth,
  hasLiteralCoinDefinitions,
  withManualCoinLadder,
  withTypedRewardValues,
  rewardLadderIsBuildValued,
  BUILD_VALUED_TYPES,
  formatRewardAmount,
  withTypedLadders,
} from '../../lib/rewards/rewardChain'
import { validateDropGroupsConfig, validateDropGroup, groupResourceCount, MAX_GROUP_ITEMS, DEFAULT_MIN_DROP_RANK } from '../../lib/rewards/dropGroups'
import { parseRewardDefinitionRows } from '../../lib/rewards/rewardDefinitionsPaste'
import { RC_MAX_RANK } from '../../lib/core/ranks'
import { estimateExpectedCollectibleRewards, computeRankContributions } from '../../lib/rewards/rewardEconomy'
import { regenerateBoard } from '../../lib/simulation/effortTargeting'
import { rewardSlotCapacity, rewardSemiSlots } from '../../lib/rewards/rewardPlacement'
import SmallRewardsWorkflowCard from './SmallRewardsWorkflowCard'
import { DesignStatusBanner } from '../build/DesignStatus'

// V2's economist-facing surface for the small-reward economy. The PRIMARY
// screen is SmallRewardsWorkflowCard (targets -> source split -> generate ->
// review and apply); everything below it - the reward-chain definitions,
// Small Rewards Bank/Weights (real Ops schema), drop groups, per-rank weight
// tables, and the manual preview/suggest tools - lives inside one collapsed
// "Reward definitions and advanced settings" section, so routine target
// changes never require touching raw syntax, while advanced manual editing
// stays fully available.
//
// `list` is one of App.jsx's useBoardListState instances (main, or the
// SELECTED RC variant's - recompletion/recompletion2); `mainList` is always
// the main list, which the RC-phase solver needs since the real RC phase
// only ever runs after the main chain.
export default function RewardsPage({
  list,
  mainList = null,
  phaseLabel,
  phase,
  variantLabel = null,
  segment,
  segmentName,
  isBaseSegment,
  baseTargets,
  onUpdateRewardTargets,
  onUpdateSegmentFactor,
  onUpdateSourceAllocation,
  allSegments = null,
  legacyListKey = null,
  designStatus = null,
  onRebuild = null,
}) {
  const board0 = list.boards[0]
  const minDropRank = board0?.minDropRank ?? DEFAULT_MIN_DROP_RANK
  const [openRank, setOpenRank] = useState(minDropRank)
  const [rankPreview, setRankPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [pasteDraft, setPasteDraft] = useState('')
  const [pasteFeedback, setPasteFeedback] = useState(null)
  const [addItemDraft, setAddItemDraft] = useState({ type: 'coins', rank: REWARD_MAX_RANK - 1, where: 'queue' })
  const advancedRef = useRef(null)
  if (!board0) return null

  // The definitions as typed: rank values a build changed to reach an amount
  // are a result of that build (rewardChain.js: "RANK VALUES THE BUILD MAY
  // CHANGE"), and editing here always edits the typed definition.
  const appliedRewardChainConfig = board0.rewardChainConfig
  const rewardChainConfig = withTypedRewardValues(appliedRewardChainConfig)
  const buildValuedTypes = BUILD_VALUED_TYPES.filter((t) => rewardLadderIsBuildValued(appliedRewardChainConfig, t))
  const dropGroups = board0.dropGroups ?? []
  const dropGroupsConfig = board0.dropGroupsConfig ?? []
  const bankConfig = board0.smallRewardsBankConfig ?? []
  const weightsConfig = board0.smallRewardWeightsConfig ?? []

  function openAdvancedSection(sectionId) {
    setAdvancedOpen(true)
    setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  function updateRewardRank(type, rankIndex, patch) {
    const next = JSON.parse(JSON.stringify(rewardChainConfig))
    // Coins: the value is an allowance worth and the payout syntax is
    // allowance(coins:<worth>) - kept in step automatically unless the
    // economist has written a syntax of their own for that rank.
    if (type === COIN_TYPE && 'prizeAmount' in patch && coinSyntaxFollowsWorth(next[type][rankIndex].syntax)) {
      patch = { ...patch, syntax: coinAllowanceSyntax(patch.prizeAmount) }
    }
    next[type][rankIndex] = { ...next[type][rankIndex], ...patch }
    // Typing a coin value makes the coin ranks the economist's own: the build
    // stops sizing them per segment (rewardChain.js: coinLadderIsAuto).
    if (type === COIN_TYPE && 'prizeAmount' in patch) {
      list.syncRewardConfig({ rewardChainConfig: withManualCoinLadder(next) })
      return
    }
    list.syncRewardConfig({ rewardChainConfig: withTypedLadders(rewardChainConfig, next) })
  }

  // Bulk entry: paste tab-separated rows straight from Excel/Google Sheets.
  // Accepted row shape: Resource | Rank | Syntax | Prize [| Asset] - resource
  // by label ("Merge Energy") or key ("energy"), case-insensitive. Rows that
  // fail validation are reported with their line numbers and NOTHING is
  // applied (all-or-nothing, so a half-applied paste can't silently mix old
  // and new definitions); the pasted text stays in the box for fixing.
  function applyPaste() {
    const result = parseRewardDefinitionRows(pasteDraft, rewardChainConfig)
    setPasteFeedback({ ok: result.ok, messages: result.messages })
    if (!result.ok) return
    list.syncRewardConfig({ rewardChainConfig: withTypedLadders(rewardChainConfig, result.rewardChainConfig) })
    setPasteDraft('')
  }

  // Manual authoring of a board's reward items (the mixed queue). Adding or
  // removing regenerates that one board through the real pipeline right
  // away (effortTargeting.js's regenerateBoard - same per-board settings
  // path as "Generate items"), so the saved queue can never disagree with
  // the list shown here. Pin/unpin only flips the solver-replaceable flag -
  // the queue itself is unchanged, so no regeneration.
  function writeRewardItems(boardIndex, nextItems, { regenerate = true } = {}) {
    const board = list.boards[boardIndex]
    const withItems = { ...board, rewardQueueItems: nextItems }
    list.updateBoard(regenerate ? regenerateBoard(withItems, boardIndex, board.blockedValue, 0.15) : withItems)
  }

  function addRewardItemAt(boardIndex, where) {
    const board = list.boards[boardIndex]
    if (where === 'queue') {
      writeRewardItems(boardIndex, [...(board.rewardQueueItems ?? []), { type: addItemDraft.type, rank: addItemDraft.rank }])
      return
    }
    // A semi-blocked tile: "row,col" of one of this board's eligible semi
    // cells (see rewardPlacement.js's rewardSemiSlots for what's eligible).
    const [row, col] = where.split(',').map(Number)
    const next = [...(board.rewardSemiItems ?? []).filter((it) => !(it.row === row && it.col === col)), { row, col, type: addItemDraft.type, rank: addItemDraft.rank }]
    list.updateBoard(regenerateBoard({ ...board, rewardSemiItems: next }, boardIndex, board.blockedValue, 0.15))
    setAddItemDraft((d) => ({ ...d, where: 'queue' }))
  }

  function removeRewardSemiItem(boardIndex, itemIndex) {
    const board = list.boards[boardIndex]
    const next = (board.rewardSemiItems ?? []).filter((_, k) => k !== itemIndex)
    list.updateBoard(regenerateBoard({ ...board, rewardSemiItems: next }, boardIndex, board.blockedValue, 0.15))
  }

  function toggleRewardSemiItemPin(boardIndex, itemIndex) {
    const board = list.boards[boardIndex]
    const next = (board.rewardSemiItems ?? []).map((it, k) => {
      if (k !== itemIndex) return it
      if (it.auto) {
        const { auto: _auto, ...pinned } = it
        return pinned
      }
      return { ...it, auto: true }
    })
    list.updateBoard({ ...board, rewardSemiItems: next })
  }

  // A generated drop group is replaced by the next Generate; locking it
  // (dropping its `auto` flag) keeps its contents and its odds instead.
  function toggleGroupLock(group) {
    if (group.auto) {
      const { auto: _auto, ...locked } = group
      list.syncRewardConfig({ dropGroups: dropGroups.map((g) => (g.id === group.id ? locked : g)) })
    } else {
      updateDropGroup(group.id, { auto: true })
    }
  }

  function removeRewardItem(boardIndex, itemIndex) {
    const items = list.boards[boardIndex].rewardQueueItems ?? []
    writeRewardItems(boardIndex, items.filter((_, k) => k !== itemIndex))
  }

  function toggleRewardItemPin(boardIndex, itemIndex) {
    const items = list.boards[boardIndex].rewardQueueItems ?? []
    const next = items.map((it, k) => {
      if (k !== itemIndex) return it
      if (it.auto) {
        const { auto: _auto, ...pinned } = it
        return pinned
      }
      return { ...it, auto: true }
    })
    writeRewardItems(boardIndex, next, { regenerate: false })
  }

  // "Small Rewards Bank" (real Ops schema) - see smallRewardsBank.js's own
  // header comment for why this is a separate, free-text-syntax config from
  // dropGroups above, not the same model.
  function addBankContainer() {
    const id = `cont-${Date.now()}`
    list.syncRewardConfig({ smallRewardsBankConfig: [...bankConfig, { id, name: `Cont${bankConfig.length + 1}`, syntax: '' }] })
  }

  function updateBankContainer(id, patch) {
    list.syncRewardConfig({ smallRewardsBankConfig: bankConfig.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
  }

  function removeBankContainer(id) {
    list.syncRewardConfig({
      smallRewardsBankConfig: bankConfig.filter((c) => c.id !== id),
      smallRewardWeightsConfig: weightsConfig.map((row) => {
        const { [id]: _removed, ...rest } = row.weights
        return { ...row, weights: rest }
      }),
    })
  }

  function updateWeightsCell(tierIndex, containerId, value) {
    const next = weightsConfig.map((row, i) => (i === tierIndex ? { ...row, weights: { ...row.weights, [containerId]: value } } : row))
    list.syncRewardConfig({ smallRewardWeightsConfig: next })
  }

  function updateNoDropCell(tierIndex, value) {
    const next = weightsConfig.map((row, i) => (i === tierIndex ? { ...row, noDropWeight: value } : row))
    list.syncRewardConfig({ smallRewardWeightsConfig: next })
  }

  function addDropGroup() {
    const id = `group-${Date.now()}`
    list.syncRewardConfig({ dropGroups: [...dropGroups, { id, name: `Group ${dropGroups.length + 1}`, items: {} }] })
  }

  function updateDropGroup(id, patch) {
    list.syncRewardConfig({ dropGroups: dropGroups.map((g) => (g.id === id ? { ...g, ...patch } : g)) })
  }

  function removeDropGroup(id) {
    list.syncRewardConfig({
      dropGroups: dropGroups.filter((g) => g.id !== id),
      dropGroupsConfig: dropGroupsConfig.map((t) => ({ ...t, entries: t.entries.filter((e) => e.groupId !== id) })),
    })
  }

  function toggleGroupResource(group, type, checked) {
    const items = { ...group.items }
    // A group carries at most MAX_GROUP_ITEMS items (and, being keyed by
    // resource, at most one of each - so never two Twister items).
    if (checked && groupResourceCount(group) >= MAX_GROUP_ITEMS) return
    if (checked) items[type] = 1
    else delete items[type]
    updateDropGroup(group.id, { items })
  }

  function updateRankTable(rankIndex, patch) {
    list.syncRewardConfig({ dropGroupsConfig: dropGroupsConfig.map((t, i) => (i === rankIndex ? { ...t, ...patch } : t)) })
  }

  function addTableEntry(rankIndex) {
    if (dropGroups.length === 0) return
    const table = dropGroupsConfig[rankIndex]
    updateRankTable(rankIndex, { entries: [...table.entries, { groupId: dropGroups[0].id, weight: 1 }] })
  }

  function updateTableEntry(rankIndex, entryIndex, patch) {
    const entries = dropGroupsConfig[rankIndex].entries.map((e, i) => (i === entryIndex ? { ...e, ...patch } : e))
    updateRankTable(rankIndex, { entries })
  }

  function removeTableEntry(rankIndex, entryIndex) {
    updateRankTable(rankIndex, { entries: dropGroupsConfig[rankIndex].entries.filter((_, i) => i !== entryIndex) })
  }

  function toggleLockRank(rankIndex) {
    updateRankTable(rankIndex, { locked: !dropGroupsConfig[rankIndex].locked })
  }

  function updateMinDropRank(value) {
    const v = Math.min(RC_MAX_RANK, Math.max(1, Math.round(Number(value) || DEFAULT_MIN_DROP_RANK)))
    list.syncRewardConfig({ minDropRank: v })
    if (openRank < v) setOpenRank(v)
  }

  // "Generate the blocked queue with the amount of merges on a specific
  // rank (7 merges of rank 7, 5 of rank 8...), then give each rank the drop
  // groups that will give it an EV toward the segment's target" - this is
  // that sequence made visible, independent of running the solver: a plain
  // preview of the CURRENT config's own predicted merges/EV/contribution
  // per rank, so the economist can see where today's numbers come from
  // before asking the search to change anything.
  function runRankPreview() {
    setPreviewing(true)
    setRankPreview(null)
    setTimeout(() => {
      const groupsById = new Map(dropGroups.map((g) => [g.id, g]))
      const { mergeCountsByRank } = estimateExpectedCollectibleRewards(list.boards, { rewardChainConfig, dropGroupsConfig, dropGroupsById: groupsById, minDropRank })
      setRankPreview(computeRankContributions(mergeCountsByRank, dropGroupsConfig, groupsById, rewardChainConfig, { minDropRank }))
      setPreviewing(false)
    }, 20)
  }

  const groupsById = new Map(dropGroups.map((g) => [g.id, g]))
  const chainFindings = validateRewardChainConfig(rewardChainConfig)
  const tableFindings = validateDropGroupsConfig(dropGroupsConfig, groupsById, { minDropRank })
  const activeTable = dropGroupsConfig[Math.max(openRank, minDropRank) - 1]

  const legacyConfig = legacyListKey ? segment?.legacyRewardConfig?.[legacyListKey] : null
  function discardLegacyConfig() {
    const { [legacyListKey]: _gone, ...rest } = segment.legacyRewardConfig ?? {}
    segment.setLegacyRewardConfig(Object.keys(rest).length ? rest : null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-2.5 text-xs text-slate-600" data-testid="rewards-advanced-note">
        <span className="font-semibold text-slate-700">Advanced reward tools.</span> This page edits the same configuration as the <span className="font-semibold">Build event</span>{' '}
        tab, in detail: item syntax and values, pinned reward items, drop groups, weights and locks. Anything changed here that affects what a player collects - including
        this page&apos;s own Generate and Apply - changes rewards only. It does not rebuild main-chain queues or re-take the energy credit, so the design is marked out of date
        until it is rebuilt.
      </div>
      {designStatus && <DesignStatusBanner consistency={designStatus} onRebuild={onRebuild} scopeLabel={`${segmentName ?? 'This segment'}, ${phaseLabel}`} />}
      {legacyConfig && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex flex-wrap items-center gap-3" data-testid="legacy-reward-config">
          <TriangleAlert size={16} className="shrink-0" />
          <span className="flex-1 min-w-[18rem]">
            This segment had its own reward configuration ({legacyConfig.dropGroups?.length ?? 0} drop group
            {(legacyConfig.dropGroups?.length ?? 0) === 1 ? '' : 's'}) from before reward definitions and drop odds became shared. Segment 1&apos;s configuration is
            used now; the earlier one was not deleted - it is kept in your saved data and in backups (under <span className="font-mono">legacyRewardConfig</span>) until you
            discard it.
          </span>
          <Button variant="secondary" size="sm" onClick={discardLegacyConfig}>
            Discard the kept copy
          </Button>
        </div>
      )}
      {segment && (
        <SmallRewardsWorkflowCard
          phase={phase}
          phaseLabel={phaseLabel}
          variantLabel={variantLabel}
          list={list}
          mainList={mainList}
          segment={segment}
          segmentName={segmentName}
          isBaseSegment={isBaseSegment}
          baseTargets={baseTargets}
          onUpdateRewardTargets={onUpdateRewardTargets}
          onUpdateSegmentFactor={onUpdateSegmentFactor}
          onUpdateSourceAllocation={onUpdateSourceAllocation}
          onOpenAdvanced={openAdvancedSection}
          allSegments={allSegments}
        />
      )}

      <details
        ref={advancedRef}
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen(e.target.open)}
        className="rounded-3xl border border-slate-200 bg-white/60 shadow-sm"
      >
        <summary className="cursor-pointer select-none px-5 py-4 font-display font-semibold text-slate-700">
          Reward definitions and advanced settings
          <span className="ml-2 text-xs font-sans font-normal text-slate-400">
            item syntax &amp; prizes, drop groups, per-rank weights, merge-rank eligibility, Ops bank/weights, manual tools
          </span>
        </summary>
        <div className="px-4 pb-4 flex flex-col gap-4">
          {!isBaseSegment && (
            <div className="rounded-2xl border border-purple-200 bg-purple-50/70 px-4 py-2.5 text-sm text-purple-800">
              Reward definitions, drop groups, drop odds, the drop start rank and the Ops bank/weights are one shared configuration across
              all segments - synced from Segment 1 and read-only here. What is this segment's own: the reward items under its tiles.
            </div>
          )}
          <fieldset disabled={!isBaseSegment} className="flex flex-col gap-4 min-w-0 border-0 p-0 m-0" data-shared-config="definitions">
          <Card
            icon={Gift}
            title={`Reward chain - ${phaseLabel}`}
            subtitle="Coins, puzzles, merge energy, charms and Twister DR - each a 4-rank merge chain, shared across every board in this list"
          >
            {buildValuedTypes.length > 0 && (
              <div className="mb-3 rounded-2xl border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-800" data-testid="build-valued-note">
                These are the rank values as you typed them. The applied build changed some to reach an amount with the drop rules as set:{' '}
                {buildValuedTypes.map((t) => `${REWARD_TYPE_LABELS[t]} ${appliedRewardChainConfig[t].map((r) => formatRewardAmount(t, r.prizeAmount)).join(' / ')}`).join('; ')}. Those are what
                is played and exported; the next build starts again from the values here.
              </div>
            )}
            <div id="reward-definitions" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {ALL_REWARD_TYPES.map((type) => (
                <div key={type} className="rounded-2xl border border-slate-100 p-3" data-reward-ladder={type}>
                  <div className="font-display font-semibold text-slate-700 mb-2">
                    {REWARD_TYPE_LABELS[type]}
                    {type === TWISTER_TYPE && (
                      <span className="ml-2 text-[11px] font-sans font-normal text-slate-400">
                        merge drops only - never under tiles; its value is Twister DR, not merge energy
                      </span>
                    )}
                    {type === COIN_TYPE && (
                      <span className="ml-2 text-[11px] font-sans font-normal text-slate-400">
                        value = allowance worth (0.12 = 12% of the player&apos;s coin allowance), paid as allowance(coins:0.12) - not a coin count
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-[2rem_1fr_1fr_6rem] gap-2 items-center text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
                    <span>Rank</span>
                    <span>Item syntax</span>
                    <span>Asset ID</span>
                    <span />
                  </div>
                  <div className="flex flex-col gap-2">
                    {Array.from({ length: REWARD_MAX_RANK }, (_, i) => i + 1).map((rank) => (
                      <div key={rank} className="grid grid-cols-[2rem_1fr_1fr_6rem] gap-2 items-center">
                        <span className="text-xs text-slate-400">R{rank}</span>
                        <input
                          className="min-w-0 border border-slate-200 rounded-xl px-2 py-1.5 text-sm bg-white/70"
                          placeholder="Ops syntax"
                          value={rewardChainConfig[type][rank - 1].syntax}
                          onChange={(e) => updateRewardRank(type, rank - 1, { syntax: e.target.value })}
                        />
                        <input
                          className="min-w-0 border border-slate-200 rounded-xl px-2 py-1.5 text-sm bg-white/70"
                          placeholder="Asset ID"
                          value={rewardChainConfig[type][rank - 1].asset}
                          onChange={(e) => updateRewardRank(type, rank - 1, { asset: e.target.value })}
                        />
                        <NumberField
                          label={type === COIN_TYPE ? 'Allowance worth' : 'Prize'}
                          step={type === COIN_TYPE ? 0.01 : 1}
                          value={rewardChainConfig[type][rank - 1].prizeAmount}
                          onChange={(e) => updateRewardRank(type, rank - 1, { prizeAmount: Number(e.target.value) || 0 })}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {hasLiteralCoinDefinitions(rewardChainConfig) && (
              <div className="mt-3 flex items-start gap-2 text-sm text-amber-600" data-testid="literal-coins-warning">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                <span>
                  Coin ranks here are still written as literal coin amounts (for example <span className="font-mono">coins:100000</span>). Coins are now paid as an
                  allowance worth with the syntax <span className="font-mono">allowance(coins:0.12)</span>. These values were kept exactly as saved - enter each
                  rank&apos;s allowance worth to switch over; until then every coin figure in the app is in the old literal amounts, not allowances.
                </span>
              </div>
            )}
            {chainFindings.length > 0 ? (
              <div className="mt-3 flex flex-col gap-1">
                {chainFindings.map((f) => (
                  <div key={f.type} className="flex items-start gap-2 text-sm text-amber-600" data-ladder-finding={f.type}>
                    <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                    <span>
                      <span className="font-semibold">{REWARD_TYPE_LABELS[f.type]}:</span> {f.message}
                    </span>
                  </div>
                ))}
                <p className="text-xs text-slate-500">
                  Values are reported as entered and never changed for you. Every prediction assumes the player merges toward rank{' '}
                  {REWARD_MAX_RANK}; where a ladder is flagged, a player who collects earlier would receive more than predicted.
                </p>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2 text-sm text-emerald-600">
                <CircleCheck size={14} />
                <span>Every configured ladder rewards merging: rank {REWARD_MAX_RANK} beats cashing out its items earlier, and no merge step loses value.</span>
              </div>
            )}

            <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-600 mb-1">
                <ClipboardPaste size={14} /> Paste from a spreadsheet
              </div>
              <p className="text-xs text-slate-500 mb-2">
                Tab-separated rows: <span className="font-mono">Resource &nbsp; Rank &nbsp; Item syntax &nbsp; Prize &nbsp; [Asset ID]</span> - resource
                by label ("Merge Energy", "Twister DR") or key ("energy", "twister"). All rows must be valid before anything is applied; a failed paste keeps your text
                here for fixing.
              </p>
              <textarea
                value={pasteDraft}
                onChange={(e) => {
                  setPasteDraft(e.target.value)
                  setPasteFeedback(null)
                }}
                rows={3}
                placeholder={'coins\t1\tcoins:100000\t100000\nenergy\t4\t[dynamic(dr-merge:75)]\t75'}
                className="w-full border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-mono bg-white/80"
              />
              <div className="mt-2 flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={applyPaste} disabled={pasteDraft.trim() === ''}>
                  Apply pasted rows
                </Button>
                {pasteFeedback && (
                  <div className={`text-xs ${pasteFeedback.ok ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {pasteFeedback.messages.map((m, i) => (
                      <div key={i}>{m}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>
          </fieldset>

          <Card
            title={`Reward items under tiles - ${phaseLabel}`}
            subtitle="Which reward items sit in each board's blocked queue - one item per blocked tile, alongside (never instead of) the main chain's own exact DR sum"
          >
            <div id="reward-items" className="flex flex-col gap-3">
              {list.boards.map((b, i) => {
                const items = b.rewardQueueItems ?? []
                const semiItems = b.rewardSemiItems ?? []
                const freeSlots = rewardSlotCapacity(b, i) - items.filter((it) => it.auto).length
                // Semi cells still open to a manual placement: eligible ones
                // not already holding a (solver-placed) reward item.
                const semiTaken = new Set(semiItems.map((it) => `${it.row},${it.col}`))
                const openSemiCells = rewardSemiSlots(b, i).cells.filter((c) => !semiTaken.has(`${c.row},${c.col}`))
                const where = addItemDraft.where === 'queue' || openSemiCells.some((c) => `${c.row},${c.col}` === addItemDraft.where) ? addItemDraft.where : 'queue'
                const canAdd = where === 'queue' ? freeSlots > 0 : true
                return (
                  <div key={b.id} className="rounded-2xl border border-slate-100 p-3">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="font-display font-semibold text-slate-700">{b.name}</span>
                      <span className="text-xs text-slate-400">
                        {items.length} under blocked tiles · {semiItems.length} on semi-blocked tiles · {Math.max(0, freeSlots)} free blocked slot
                        {freeSlots === 1 ? '' : 's'} and {openSemiCells.length} open semi tile{openSemiCells.length === 1 ? '' : 's'} left
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {items.length === 0 && semiItems.length === 0 && (
                        <span className="text-xs text-slate-400">None - add one below, or let "Generate configuration" place them.</span>
                      )}
                      {semiItems.map((it, k) => (
                        <span
                          key={`semi-${k}`}
                          className={`inline-flex items-center gap-1 text-xs font-semibold rounded-lg pl-2 pr-1 py-1 border border-dashed ${
                            it.auto ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-purple-50 border-purple-300 text-purple-800'
                          }`}
                          title={`On the semi-blocked tile at row ${it.row + 1}, column ${it.col + 1} - visible and usable from the start. ${
                            it.auto ? 'Placed by the solver - replaced on the next Generate.' : 'Pinned - every solve preserves it.'
                          }`}
                        >
                          {REWARD_TYPE_LABELS[it.type]} R{it.rank} @ semi r{it.row + 1}c{it.col + 1}
                          <button type="button" className="px-1 rounded hover:bg-white/70 text-[10px] uppercase tracking-wide" onClick={() => toggleRewardSemiItemPin(i, k)}>
                            {it.auto ? 'pin' : 'pinned'}
                          </button>
                          <button type="button" className="px-1 rounded hover:bg-white/70 hover:text-red-600" title="Remove" onClick={() => removeRewardSemiItem(i, k)}>
                            ×
                          </button>
                        </span>
                      ))}
                      {items.map((it, k) => (
                        <span
                          key={k}
                          className={`inline-flex items-center gap-1 text-xs font-semibold rounded-lg pl-2 pr-1 py-1 border ${
                            it.auto ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-purple-50 border-purple-200 text-purple-800'
                          }`}
                          title={it.auto ? 'Placed by the solver - replaced on the next Generate. Pin it to keep it.' : 'Pinned - every solve preserves this and deducts its payout from the target first.'}
                        >
                          {REWARD_TYPE_LABELS[it.type]} R{it.rank}
                          <button
                            type="button"
                            className="px-1 rounded hover:bg-white/70 text-[10px] uppercase tracking-wide"
                            onClick={() => toggleRewardItemPin(i, k)}
                          >
                            {it.auto ? 'pin' : 'pinned'}
                          </button>
                          <button type="button" className="px-1 rounded hover:bg-white/70 hover:text-red-600" title="Remove" onClick={() => removeRewardItem(i, k)}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <select
                        className="border border-slate-200 rounded-lg px-1.5 py-1 text-xs bg-white/70"
                        value={addItemDraft.type}
                        onChange={(e) => setAddItemDraft((d) => ({ ...d, type: e.target.value }))}
                      >
                        {REWARD_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {REWARD_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                      <select
                        className="border border-slate-200 rounded-lg px-1.5 py-1 text-xs bg-white/70"
                        value={addItemDraft.rank}
                        onChange={(e) => setAddItemDraft((d) => ({ ...d, rank: Number(e.target.value) }))}
                      >
                        {Array.from({ length: REWARD_MAX_RANK - 1 }, (_, r) => r + 1).map((r) => (
                          <option key={r} value={r}>
                            Rank {r}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Where to place it"
                        className="border border-slate-200 rounded-lg px-1.5 py-1 text-xs bg-white/70"
                        value={where}
                        onChange={(e) => setAddItemDraft((d) => ({ ...d, where: e.target.value }))}
                      >
                        <option value="queue">Under a blocked tile</option>
                        {openSemiCells.map((c) => (
                          <option key={`${c.row},${c.col}`} value={`${c.row},${c.col}`}>
                            Semi tile row {c.row + 1}, col {c.col + 1}
                          </option>
                        ))}
                      </select>
                      <Button variant="ghost" size="sm" icon={Plus} onClick={() => addRewardItemAt(i, where)} disabled={!canAdd}>
                        Add pinned item
                      </Button>
                      {!canAdd && <span className="text-[11px] text-amber-600">No free blocked slot - the main chain needs the rest.</span>}
                    </div>
                  </div>
                )
              })}
            </div>
            <InfoHint>
              Adding or removing an item regenerates that board's layout immediately, so it always matches what's listed here. An item under
              a blocked tile is revealed when a merge next to it opens the tile; an item on a semi-blocked tile is visible and usable from the
              start (the two fixed anchor cells, a cell you forced a main rank onto, and board 1's semi tiles while an onboarding goal is set
              are not offered). Items
              merge pairwise up their own chain and pay out at rank {REWARD_MAX_RANK} (which is why rank {REWARD_MAX_RANK} itself isn't
              placeable - it never sits on the board). Two same-type rank-{REWARD_MAX_RANK - 1} items make one collect; an unpaired item only
              pays if the player collects it by hand.
            </InfoHint>
          </Card>

          <fieldset disabled={!isBaseSegment} className="flex flex-col gap-4 min-w-0 border-0 p-0 m-0" data-shared-config="drops">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="bank-superseded">
            The two hand-typed tables below are <span className="font-semibold">no longer exported and never played</span>. The Small Rewards Bank and Small Reward Weights
            sheets now hold the containers the model makes (see "Containers" in Build event). These tables are kept only so nothing you typed is lost.
          </div>
          <Card
            title={`Small Rewards Bank - ${phaseLabel}`}
            subtitle='The real Ops "Small Rewards Bank" sheet - each container is a free-text syntax expression over the Small Rewards keys above (e.g. coin-r1+dr-r1+puzzle-r1+charm-r1)'
          >
            <div className="flex flex-col gap-2">
              {bankConfig.map((c) => (
                <div key={c.id} className="grid grid-cols-[8rem_1fr_2rem] gap-2 items-center">
                  <input
                    className="min-w-0 border border-slate-200 rounded-xl px-2 py-1.5 text-sm font-semibold bg-white/70"
                    value={c.name}
                    onChange={(e) => updateBankContainer(c.id, { name: e.target.value })}
                  />
                  <input
                    className="min-w-0 border border-slate-200 rounded-xl px-2 py-1.5 text-sm bg-white/70"
                    placeholder="Syntax (e.g. coin-r1+dr-r1:2)"
                    value={c.syntax}
                    onChange={(e) => updateBankContainer(c.id, { syntax: e.target.value })}
                  />
                  <button className="text-slate-400 hover:text-red-500" onClick={() => removeBankContainer(c.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <Button variant="ghost" icon={Plus} onClick={addBankContainer}>
                Add container
              </Button>
            </div>
          </Card>

          <Card
            title={`Small Reward Weights - ${phaseLabel}`}
            subtitle='The real Ops "Small Reward Weights" sheet - per-merge-tier odds of each bank container above, plus NoDrop'
          >
            {bankConfig.length === 0 ? (
              <p className="text-sm text-slate-500">Add a Small Rewards Bank container above first.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="text-sm border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-2 py-1">Tier</th>
                      {bankConfig.map((c) => (
                        <th key={c.id} className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-2 py-1">
                          {c.name}
                        </th>
                      ))}
                      <th className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-2 py-1">NoDrop</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weightsConfig.map((row, i) => (
                      <tr key={row.tier}>
                        <td className="px-2 py-1 font-semibold text-slate-600">{row.tier}</td>
                        {bankConfig.map((c) => (
                          <td key={c.id} className="px-2 py-1">
                            <input
                              type="number"
                              className="w-16 border border-slate-200 rounded-lg px-1.5 py-1 text-sm bg-white/70"
                              value={row.weights[c.id] ?? 0}
                              onChange={(e) => updateWeightsCell(i, c.id, Number(e.target.value) || 0)}
                            />
                          </td>
                        ))}
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            className="w-16 border border-slate-200 rounded-lg px-1.5 py-1 text-sm bg-white/70"
                            value={row.noDropWeight}
                            onChange={(e) => updateNoDropCell(i, Number(e.target.value) || 0)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card
            title={`Drop groups - ${phaseLabel}`}
            subtitle={`A group bundles up to ${MAX_GROUP_ITEMS} items, at most one per resource (Twister DR included), dropping together as a joint outcome`}
          >
            <div id="drop-groups" className="flex flex-col gap-3">
              {dropGroups.map((group) => (
                <div key={group.id} className="rounded-2xl border border-slate-100 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      className="min-w-0 flex-1 border border-slate-200 rounded-xl px-2 py-1.5 text-sm font-semibold bg-white/70"
                      value={group.name}
                      onChange={(e) => updateDropGroup(group.id, { name: e.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => toggleGroupLock(group)}
                      className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-lg px-2 py-1 border ${
                        group.auto ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-purple-200 bg-purple-50 text-purple-700'
                      }`}
                      title={
                        group.auto
                          ? 'Generated - the next Generate replaces it. Click to lock it: its contents and odds are then kept.'
                          : 'Locked - Generate keeps this group and its odds as they are, and works around it. Click to hand it back to the generator.'
                      }
                    >
                      {group.auto ? <LockOpen size={11} /> : <Lock size={11} />}
                      {group.auto ? 'Generated' : 'Locked'}
                    </button>
                    <button className="text-slate-400 hover:text-red-500" onClick={() => removeDropGroup(group.id)} title="Delete group">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {ALL_REWARD_TYPES.map((type) => (
                      <label key={type} className="flex items-center gap-2 text-sm text-slate-600">
                        <input
                          type="checkbox"
                          checked={group.items[type] != null}
                          disabled={group.items[type] == null && groupResourceCount(group) >= MAX_GROUP_ITEMS}
                          title={group.items[type] == null && groupResourceCount(group) >= MAX_GROUP_ITEMS ? `A group carries at most ${MAX_GROUP_ITEMS} items` : undefined}
                          onChange={(e) => toggleGroupResource(group, type, e.target.checked)}
                        />
                        {REWARD_TYPE_LABELS[type]}
                        {group.items[type] != null && (
                          <select
                            className="border border-slate-200 rounded-lg px-1 py-0.5 text-xs bg-white/70"
                            value={group.items[type]}
                            onChange={(e) => updateDropGroup(group.id, { items: { ...group.items, [type]: Number(e.target.value) } })}
                          >
                            {Array.from({ length: REWARD_MAX_RANK }, (_, i) => i + 1).map((r) => (
                              <option key={r} value={r}>
                                R{r}
                              </option>
                            ))}
                          </select>
                        )}
                      </label>
                    ))}
                  </div>
                  {validateDropGroup(group)
                    .filter(() => groupResourceCount(group) > 0)
                    .map((m) => (
                      <div key={m} className="mt-1 text-xs text-amber-600">
                        {m}
                      </div>
                    ))}
                </div>
              ))}
              <Button variant="ghost" icon={Plus} onClick={addDropGroup}>
                Add group
              </Button>
            </div>
          </Card>

          <Card
            title={`Drop weights per resulting rank - ${phaseLabel}`}
            subtitle="Each resulting main-chain merge rank rolls its own weighted table (plus an explicit no-drop weight)"
          >
            <div className="flex items-end gap-3 mb-2">
              <NumberField
                label="Drops start at resulting rank"
                value={minDropRank}
                onChange={(e) => updateMinDropRank(e.target.value)}
                className="max-w-[12rem]"
              />
              <InfoHint>
                The engine hard-gates merge drops below this resulting rank - a table configured there can never fire. Default{' '}
                {DEFAULT_MIN_DROP_RANK} ("drops only start at rank {DEFAULT_MIN_DROP_RANK}", the original economist decision), now
                configurable per board list; older saves keep the default. From this rank onward, every table should offer a path to all
                four resource types somewhere across its own groups - the validation below flags a rank that can't reach one.
              </InfoHint>
            </div>
            <div className="flex flex-wrap gap-2 mb-3 mt-2">
              {Array.from({ length: RC_MAX_RANK - minDropRank + 1 }, (_, i) => i + minDropRank).map((rank) => (
                <button
                  key={rank}
                  onClick={() => setOpenRank(rank)}
                  className={`px-2.5 py-1 rounded-lg text-sm font-semibold ${Math.max(openRank, minDropRank) === rank ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white' : 'bg-slate-100 text-slate-500'}`}
                >
                  R{rank}
                </button>
              ))}
            </div>
            {activeTable && (
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm text-slate-500">
                  <input type="checkbox" checked={!!activeTable.locked} onChange={() => toggleLockRank(activeTable.rank - 1)} />
                  Lock this rank (excluded from the solvers' weight search)
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-500 w-28">No-drop weight</span>
                  <NumberField label="Weight" value={activeTable.noDropWeight} onChange={(e) => updateRankTable(activeTable.rank - 1, { noDropWeight: Number(e.target.value) || 0 })} />
                </div>
                {activeTable.entries.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      className="min-w-0 flex-1 border border-slate-200 rounded-xl px-2 py-1.5 text-sm bg-white/70"
                      value={entry.groupId}
                      onChange={(e) => updateTableEntry(activeTable.rank - 1, i, { groupId: e.target.value })}
                    >
                      {dropGroups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                    <NumberField label="Weight" value={entry.weight} onChange={(e) => updateTableEntry(activeTable.rank - 1, i, { weight: Number(e.target.value) || 0 })} />
                    <button className="text-slate-400 hover:text-red-500" onClick={() => removeTableEntry(activeTable.rank - 1, i)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <Button variant="ghost" icon={Plus} onClick={() => addTableEntry(activeTable.rank - 1)} disabled={dropGroups.length === 0}>
                  Add entry
                </Button>
              </div>
            )}
            {tableFindings.length > 0 && (
              <div className="mt-3 flex flex-col gap-1">
                {tableFindings.map((msg, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-amber-600">
                    <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                    <span>{msg}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          </fieldset>

          <Card
            title={`Merges & EV per rank - ${phaseLabel}`}
            subtitle="Predicted merges at each resulting rank, what one roll of that rank's drop table is worth once merged up (as a share of the rank-4 prize), and the two multiplied together"
          >
            <Button variant="secondary" onClick={runRankPreview} disabled={previewing}>
              {previewing ? 'Calculating…' : 'Preview merges & EV per rank'}
            </Button>
            {rankPreview && <RankContributionsTable rows={rankPreview} minDropRank={minDropRank} className="mt-4" />}
          </Card>

        </div>
      </details>
    </div>
  )
}

// Shared by the standalone "Merges & EV per rank" preview and the solver's
// own result panel - both describe the exact same underlying calculation
// (computeRankContributions), just at a different moment (before vs. after
// searching), so they share one rendering rather than two copies that could
// drift in presentation.
function RankContributionsTable({ rows, minDropRank = DEFAULT_MIN_DROP_RANK, className = '' }) {
  const activeRows = rows.filter((r) => r.merges > 0 || REWARD_TYPES.some((t) => r.perRollEv[t] > 0))
  if (activeRows.length === 0) {
    return <p className={`text-sm text-slate-500 ${className}`}>No predicted merges at rank {minDropRank}+ yet - this board's queue may not reach that far.</p>
  }
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="text-sm border-collapse w-full">
        <thead>
          <tr>
            <th className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-2 py-1">Rank</th>
            <th className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-2 py-1">Merges</th>
            {REWARD_TYPES.map((t) => (
              <th key={t} className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-2 py-1">
                {REWARD_TYPE_LABELS[t]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {activeRows.map((row) => (
            <tr key={row.rank}>
              <td className="px-2 py-1 font-semibold text-slate-600">{row.rank}</td>
              <td className="px-2 py-1 text-slate-600">{row.merges.toFixed(1)}</td>
              {REWARD_TYPES.map((t) => (
                <td key={t} className="px-2 py-1 text-slate-600">
                  {row.contribution[t] > 0 ? (
                    <span>
                      {row.contribution[t].toFixed(1)}
                      <span className="text-xs text-slate-400"> ({row.perRollEv[t].toFixed(2)}/roll)</span>
                    </span>
                  ) : (
                    <span className="text-slate-300">-</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
