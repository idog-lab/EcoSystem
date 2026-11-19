import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, TriangleAlert, ClipboardPaste } from 'lucide-react'
import Button from '../../../../components/ui/Button'
import BoardGrid from '../editor/BoardGrid'
import { CommitNumber, StatusChip, SharedTag, SegmentTag, Panel, FieldLabel, CheckLine, LinkButton } from './buildUi'
import { BuildStep, FinalizeStep } from './BuildEventReview'
import ContainersTable from './ContainersTable'
import { GeneratorStep, EffortStep } from './BuildEventSteps'
import {
  REWARD_TYPES,
  REWARD_TARGET_LABELS,
  REWARD_TYPE_LABELS,
  REWARD_AMOUNT_UNIT,
  REWARD_MAX_RANK,
  COIN_TYPE,
  COIN_VALUE_SHAPE,
  TWISTER_TYPE,
  formatRewardAmount,
  rewardPrizeAmount,
  hasLiteralCoinDefinitions,
  roundRewardAmount,
  coinLadderIsAuto,
  withBlankCoinValues,
  withManualCoinLadder,
  suggestLadderFixes,
  applyLadderValues,
  withTypedRewardValues,
  rewardLadderIsBuildValued,
  multiResourceSyntaxes,
  withTypedLadders,
} from '../../lib/rewards/rewardChain'
import { MAX_RANK, MIN_RANK, RC_MAX_RANK, colorForRank } from '../../lib/core/ranks'
import { MIN_DROP_RANK, multiDropRankOf, tripleDropRankOf, soloDropRankOf, tileRewardTypeOf, TILE_REWARD_FOCUS_SHARE } from '../../lib/rewards/dropGroups'
import { firstBoardCapFor, RC_MIN_RANK_UNDER_TILES, invalidateLayout } from '../../lib/core/board'
import { paintTile, fillAllTiles, resizeBoard, setRankWindow } from '../../lib/core/layoutEdits'
import { parseRewardDefinitionRows } from '../../lib/rewards/rewardDefinitionsPaste'
import { buildInputsKey, buildInputParts, changedInputParts, draftSegmentIsApplied, segmentBuildInputs, rcInputsOnMainDraft, layoutCapacity, ladderAdvisories, splitTargets, twisterInputsKey, repriceTwister, INPUT_PART_LABELS } from '../../lib/build/eventBuild'
import { TWISTER_MIN_COLLECTS, twisterIsConfigured, hasTwisterDrops, applyTwisterDropRule, readTwisterDropRule, removeGeneratedTwister, withDefaultTwisterValues, targetSpinsForSegment, TWISTER_EASY_CHECKPOINT_PCT, DEFAULT_CHECKPOINT_PCT } from '../../lib/rewards/twisterEconomy'
import { chaseValue, subsidyForDemand, demandForSubsidy, fillLastBoard, spreadSubsidy, budgetGap } from '../../lib/core/subsidyBudget'

// The board editor, broken into steps (by explicit economist request): the
// amounts, the boards, the generator and lucky drops, the effort distribution,
// the rewards - then one build and the tests.
const STEPS = [
  { id: 'setup', label: 'Segment amounts' },
  { id: 'layouts', label: 'Board layouts' },
  { id: 'generator', label: 'Generator and lucky drops' },
  // Rewards come BEFORE the effort distribution: reward items take tiles and
  // merge energy takes DR off the boards, so the effort picture is only worth
  // looking at once the rewards are known.
  { id: 'rewards', label: 'Small rewards' },
  { id: 'effort', label: 'Effort distribution' },
  { id: 'build', label: 'Build boards' },
  { id: 'finalize', label: 'Test and finalize' },
]
const PHASES = [
  { id: 'main', label: 'Normal' },
  { id: 'rc', label: 'Recompletion' },
]

// The guided Build Event workflow: one workspace, five steps, all editing the
// same canonical configuration the advanced tabs edit (there is no second
// copy of the design here). Steps can be revisited freely; nothing is erased
// by moving between them. Shared settings and per-segment settings are kept
// visibly apart, and the base segment is configured first.
export default function BuildEventPage({
  segments,
  activeSegmentIndex,
  onSelectSegment,
  phase,
  onPhaseChange,
  step,
  onStepChange,
  drafts,
  onDraftsChange,
  validation,
  onValidationChange,
  onOpenTool,
  onPlay,
  playOverride,
  designIssues = [],
  exportOverride = false,
  onExportOverride,
  onOpenTwister,
  draftNotice = null,
  targetPctInputs,
  onTargetPctInputsChange,
}) {
  const listOf = (seg) => (phase === 'main' ? seg.main : seg.recompletion)
  const base = segments[0]
  const baseList = listOf(base)
  const activeSeg = segments[activeSegmentIndex]
  const activeList = listOf(activeSeg)
  const baseTargets = base.rewardTargets[phase]
  const allocation = base.sourceAllocation[phase] ?? {}
  const tw = allocation.tileWeight ?? 0.5
  const dw = allocation.dropWeight ?? 0.5
  const sharedTilePct = Math.round((tw + dw > 0 ? tw / (tw + dw) : 0.5) * 100)
  const perResource = allocation.perResource ?? {}
  const splitKey = JSON.stringify([sharedTilePct, perResource])
  const split = useMemo(() => ({ sharedTilePct, perResource: JSON.parse(splitKey)[1] }), [sharedTilePct, splitKey])

  const targetsFor = (i) => Object.fromEntries(REWARD_TYPES.map((t) => [t, roundRewardAmount(t, (baseTargets[t] ?? 0) * (i === 0 ? 1 : (segments[i].segmentFactor ?? 1)))]))
  const rawSegs = segments.map((seg) => ({ name: seg.name, mainBoards: seg.main.boards, rcBoards: seg.recompletion.boards, rewardTargets: seg.rewardTargets, segmentFactor: seg.segmentFactor, sourceAllocation: seg.sourceAllocation, twisterPlan: seg.twisterPlan }))
  const inputsFor = { main: segmentBuildInputs(rawSegs, 'main'), rc: segmentBuildInputs(rawSegs, 'rc') }
  const keyFor = { main: buildInputsKey({ phase: 'main', segments: inputsFor.main }), rc: buildInputsKey({ phase: 'rc', segments: inputsFor.rc }) }
  const listFor = (seg, p) => (p === 'main' ? seg.main : seg.recompletion)
  // "Applied" is read off the design itself: every built segment's boards
  // carry this draft's stamp and still match it. It therefore survives a
  // reload, and stops being true the moment the applied design is edited.
  const isApplied = (p) => {
    const d = drafts[p]
    const built = d ? d.segments.filter((s) => s.status !== 'skipped') : []
    return built.length > 0 && built.every((s) => draftSegmentIsApplied(listFor(segments[s.index], p).boards, d))
  }
  const appliedFor = { main: isApplied('main'), rc: isApplied('rc') }
  const mainDraftCurrent = !!drafts.main && drafts.main.key === keyFor.main
  // "Build whole event" builds Recompletion on top of the Normal DRAFT. Until
  // that Normal draft is applied, the Recompletion draft is current against
  // it rather than against the applied Normal boards.
  const rcOnMainDraft =
    !!drafts.rc && drafts.rc.key !== keyFor.rc && mainDraftCurrent && !appliedFor.main && drafts.rc.key === buildInputsKey({ phase: 'rc', segments: rcInputsOnMainDraft(rawSegs, drafts.main) })
  const currentFor = { main: mainDraftCurrent, rc: !!drafts.rc && (drafts.rc.key === keyFor.rc || rcOnMainDraft) }
  const segInputs = inputsFor[phase]
  const inputsKey = keyFor[phase]
  const draft = drafts[phase] ?? null
  const draftCurrent = currentFor[phase]
  const changedParts = draft && !draftCurrent ? changedInputParts(draft.parts, buildInputParts({ phase, segments: segInputs })) : []
  const applied = appliedFor[phase]
  const phaseValidation = validation[phase]?.builtAt === draft?.builtAt ? validation[phase] : null

  // A segment with an amount keeps its boards adding up to the subsidy
  // needed whatever else changes (a board added or removed, a budget synced
  // in): Board 1 within its cap, the last board closing the gap - the same
  // rule the board editor applies, kept true here while the workflow is open.
  const budgetKey = JSON.stringify(segments.map((seg) => [listOf(seg).targetSubsidy, listOf(seg).boards.map((b) => b.blockedValue ?? 0)]))
  useEffect(() => {
    for (const seg of segments) {
      const list = listOf(seg)
      if (list.targetSubsidy == null) continue
      const next = fillLastBoard(list.boards.map((b) => b.blockedValue ?? 0), list.targetSubsidy, phase)
      list.boards.forEach((b, i) => {
        if ((b.blockedValue ?? 0) !== next[i]) list.updateBoard({ ...b, blockedValue: next[i], effectiveBlockedValue: null })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetKey, phase])

  // The price of a twist follows the twists typed, without a rebuild: when a
  // current draft's prices are for other twists than are asked now, they are
  // worked out again on the draft's own boards. If that draft is already
  // applied, the new prices are written straight to the design as well (a
  // price is not part of what a build stamps, so nothing goes out of date).
  const twisterWants = { main: twisterInputsKey(inputsFor.main), rc: twisterInputsKey(inputsFor.rc) }
  const repricing = useRef({})
  useEffect(() => {
    for (const p of ['main', 'rc']) {
      const d = drafts[p]
      if (!d || !currentFor[p] || (d.twisterKey ?? 'none') === twisterWants[p]) continue
      const token = `${d.builtAt}|${twisterWants[p]}`
      if (repricing.current[p] === token) continue
      repricing.current[p] = token
      const inputs = p === 'rc' && rcOnMainDraft ? rcInputsOnMainDraft(rawSegs, drafts.main) : inputsFor[p]
      repriceTwister({ phase: p, draft: d, segments: inputs, isCancelled: () => repricing.current[p] !== token }).then((next) => {
        if (repricing.current[p] !== token) return
        onDraftsChange((latest) => (latest[p]?.builtAt === d.builtAt ? { ...latest, [p]: { ...latest[p], twister: next.twister, twisterKey: next.twisterKey } } : latest))
        if (appliedFor[p]) {
          for (const row of next.twister?.rows ?? []) {
            if (row.cost == null) continue
            const list = p === 'main' ? segments[row.index].main : segments[row.index].recompletion
            if (list.boards[0]?.twisterSpinCost !== row.cost) list.syncRewardConfig({ twisterSpinCost: row.cost, twisterCostBasis: { hash: null, source: 'build', at: d.builtAt } })
          }
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twisterWants.main, twisterWants.rc, drafts.main?.builtAt, drafts.rc?.builtAt, currentFor.main, currentFor.rc])

  // Quick fixes already clicked, keyed by the build they belong to. Held here
  // so the "rebuild to see the result" prompt survives moving between steps.
  const [fixed, setFixed] = useState(() => new Set())

  const draftState = !draft ? 'none' : !draftCurrent ? 'stale' : draft.status === 'infeasible' ? 'infeasible' : null
  const phaseLabel = PHASES.find((p) => p.id === phase).label
  const stepIndex = STEPS.findIndex((s) => s.id === step)

  // Step completion, for the stepper's ticks. Nothing here gates navigation.
  const totalBudget = baseList.boards.reduce((s, b) => s + (b.blockedValue ?? 0), 0)
  const hasTiles = baseList.boards.some((b) => b.tiles.flat().some((t) => t !== 'open'))
  const hasTargets = REWARD_TYPES.some((t) => (baseTargets[t] ?? 0) > 0)
  // The generator and effort steps have working defaults, so they count as
  // done once the step before them is.
  const done = { setup: totalBudget > 0, layouts: hasTiles, generator: hasTiles, effort: hasTiles && totalBudget > 0, rewards: hasTargets, build: draftCurrent, finalize: applied && draftCurrent }

  const goTo = (id, anchor) => {
    onStepChange(id === 'definitions' ? 'rewards' : id === 'phase' ? 'setup' : id)
    const target = anchor ?? (id === 'definitions' ? 'build-definitions' : null)
    if (target) setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }

  const shared = { segments, base, baseList, activeSeg, activeList, activeSegmentIndex, onSelectSegment, phase, phaseLabel, listOf, onOpenTool, goTo }

  return (
    <div className="flex flex-col gap-4 w-full" data-testid="build-event">
      <div className="rounded-3xl border border-white bg-white/85 shadow-sm px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900 leading-tight">Build event</h2>
            <p className="text-xs text-slate-500">Enter each segment&apos;s amount, lay the boards out, set reward targets, then build and test everything together.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="build-scope">
            <span className="text-slate-500">Phase</span>
            <div className="inline-flex bg-slate-100 rounded-xl p-0.5">
              {PHASES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={phase === p.id}
                  onClick={() => onPhaseChange(p.id)}
                  className={`px-3 py-1 rounded-lg font-semibold whitespace-nowrap ${phase === p.id ? 'bg-white text-purple-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <span className="text-slate-500 ml-1">Segment</span>
            <span className="font-semibold text-slate-800 whitespace-nowrap" data-testid="build-scope-segment">
              {activeSeg.name || `Segment ${activeSegmentIndex + 1}`}
              {activeSegmentIndex === 0 ? ' (base)' : ` (×${activeSeg.segmentFactor ?? 1} of base)`}
            </span>
            {draftState ? <StatusChip kind={draftState} /> : <StatusChip kind={applied ? 'applied' : 'draft'} />}
            {draft && draftCurrent && draft.status !== 'infeasible' && <StatusChip kind={phaseValidation ? 'validated' : 'estimated'} />}
          </div>
        </div>

        <ol className="mt-3 flex flex-wrap gap-1.5" aria-label="Build event steps">
          {STEPS.map((s, i) => {
            const current = s.id === step
            return (
              <li key={s.id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onStepChange(s.id)}
                  aria-current={current ? 'step' : undefined}
                  data-step={s.id}
                  className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                    current ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <span
                    className={`grid place-items-center w-5 h-5 rounded-full text-[11px] font-bold ${
                      done[s.id] ? 'bg-emerald-500 text-white' : current ? 'bg-white/25 text-white' : 'bg-white text-slate-500'
                    }`}
                  >
                    {done[s.id] ? <Check size={12} strokeWidth={3} /> : i + 1}
                  </span>
                  {s.label}
                </button>
                {i < STEPS.length - 1 && <ChevronRight size={14} className="text-slate-300" />}
              </li>
            )
          })}
        </ol>

        {draftNotice && (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="draft-notice">
            {draftNotice}
          </div>
        )}
        {draft?.restored && (
          <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800" data-testid="draft-restored">
            This draft was restored from your last session. {applied ? 'It is the applied design.' : 'It has not been applied - nothing is applied until you choose to in step 5.'}
            {!draftCurrent && ' It was built from inputs that differ from the project as it is now, so it needs rebuilding before it can be tested or applied.'}
          </div>
        )}
        {draft && !draftCurrent && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="build-stale">
            <TriangleAlert size={15} className="shrink-0" />
            <span className="flex-1 min-w-[16rem]">
              The built {phaseLabel.toLowerCase()} configuration is out of date: {changedParts.length ? changedParts.map((p) => INPUT_PART_LABELS[p].toLowerCase()).join('; ') : 'an input changed'}.
              Nothing was erased - rebuild to bring it up to date.
            </span>
            <Button variant="secondary" size="sm" onClick={() => onStepChange('build')}>
              Go to Build boards
            </Button>
          </div>
        )}
      </div>

      {step === 'setup' && <SetupStep {...shared} />}
      {step === 'layouts' && <LayoutsStep {...shared} />}
      {step === 'generator' && <GeneratorStep {...shared} />}
      {step === 'effort' && <EffortStep {...shared} targetPctInputs={targetPctInputs} onTargetPctInputsChange={onTargetPctInputsChange} />}
      {step === 'rewards' && <RewardsStep {...shared} baseTargets={baseTargets} targetsFor={targetsFor} sharedTilePct={sharedTilePct} perResource={perResource} split={split} draft={draft} draftCurrent={draftCurrent} />}
      {step === 'build' && (
        <BuildStep
          {...shared}
          segInputs={segInputs}
          inputsKey={inputsKey}
          draft={draft}
          draftCurrent={draftCurrent}
          changedParts={changedParts}
          applied={applied}
          onDraft={(next) => onDraftsChange({ ...drafts, [phase]: next })}
          rawSegs={rawSegs}
          inputsFor={inputsFor}
          drafts={drafts}
          onDraftsChange={onDraftsChange}
          rcOnMainDraft={rcOnMainDraft}
          fixed={fixed}
          setFixed={setFixed}
        />
      )}
      {step === 'finalize' && (
        <FinalizeStep
          {...shared}
          draft={draft}
          draftCurrent={draftCurrent}
          applied={applied}
          drafts={drafts}
          onDraftsChange={onDraftsChange}
          currentFor={currentFor}
          appliedFor={appliedFor}
          validationAll={validation}
          rcOnMainDraft={phase === 'rc' && rcOnMainDraft}
          validation={phaseValidation}
          onValidation={(v) => onValidationChange({ ...validation, [phase]: v })}
          onDraft={(next) => onDraftsChange({ ...drafts, [phase]: next })}
          onPlay={onPlay}
          playOverride={playOverride}
          designIssues={designIssues}
          exportOverride={exportOverride}
          onExportOverride={onExportOverride}
          onOpenTwister={onOpenTwister}
        />
      )}

      <div className="flex items-center justify-between">
        <Button variant="secondary" size="sm" disabled={stepIndex === 0} onClick={() => onStepChange(STEPS[stepIndex - 1].id)}>
          Back
        </Button>
        {stepIndex < STEPS.length - 1 && (
          <Button variant="primary" size="sm" onClick={() => onStepChange(STEPS[stepIndex + 1].id)} data-testid="build-next">
            Next: {STEPS[stepIndex + 1].label}
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Step 1
// The first thing the economist enters: each segment's AMOUNT - the total
// demand, i.e. the DR the player spends themselves - and how many boards the
// phase has. The subsidy the boards must hand out follows (2,048 - demand) and
// is split into per-board budgets. Everything else about the event (generator,
// lucky drops, dates, CC) has working defaults and sits collapsed below.
function SetupStep({ segments, baseList, activeSegmentIndex, onSelectSegment, phase, phaseLabel, listOf }) {
  const boardCount = baseList.boards.length

  // Writes budgets without discarding a board's built contents: a budget
  // change makes the build out of date, it does not erase it.
  function writeBudgets(list, budgets) {
    list.boards.forEach((b, i) => {
      if ((b.blockedValue ?? 0) !== budgets[i]) list.updateBoard({ ...b, blockedValue: budgets[i], effectiveBlockedValue: null })
    })
  }

  function setDemand(seg, demand) {
    const list = listOf(seg)
    if (demand == null) {
      // No amount: budgets stay as typed and every board becomes editable.
      list.updateTargetSubsidy(null)
      return
    }
    const subsidy = subsidyForDemand(demand, phase)
    list.updateTargetSubsidy(subsidy)
    const current = list.boards.map((b) => b.blockedValue ?? 0)
    // Boards with no budget yet get a starting split; boards that already
    // have budgets keep them, and the last board closes the gap.
    writeBudgets(list, current.every((v) => v === 0) ? spreadSubsidy(current.length, subsidy, phase) : fillLastBoard(current, subsidy, phase))
  }

  function setBudget(seg, boardIndex, value) {
    const list = listOf(seg)
    const budgets = list.boards.map((b) => b.blockedValue ?? 0)
    budgets[boardIndex] = boardIndex === 0 && budgets.length > 1 ? Math.min(value, firstBoardCapFor(phase)) : value
    writeBudgets(list, list.targetSubsidy == null ? budgets : fillLastBoard(budgets, list.targetSubsidy, phase))
  }

  function respread(seg) {
    const list = listOf(seg)
    if (list.targetSubsidy != null) writeBudgets(list, spreadSubsidy(list.boards.length, list.targetSubsidy, phase))
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="1. Segment amounts"
        subtitle={`Start here: how much each segment's player has to spend themselves in the ${phaseLabel.toLowerCase()} phase. The app works out the subsidy the boards must hand out.`}
        tag={<SegmentTag />}
      >
        <p className="text-xs text-slate-500 mb-3 max-w-3xl">
          {phase === 'main'
            ? 'The first completion: ranks 1 to 12 across the normal boards.'
            : 'Recompletion starts the moment the player reaches rank 12, on its own boards. They arrive with the rank 12 and the other free items they hold, and chase rank 14.'}{' '}
          {phase === 'main'
            ? `The whole chain is worth ${chaseValue('main').toLocaleString()} DR.`
            : `Rank 14 is worth 8,192 DR and the rank 12 they arrive with already counts for 2,048, so the chase has ${chaseValue('rc').toLocaleString()} DR left to cover.`}{' '}
          <span className="font-semibold text-slate-700">Total demand</span> is the part the player pays for; the rest is subsidy placed under the board tiles:{' '}
          <span className="font-mono" data-testid="chase-formula">
            subsidy = {chaseValue(phase).toLocaleString()} − demand
          </span>
          .
        </p>
        {phase === 'rc' && (
          <p className="text-xs text-purple-800 bg-purple-50 border border-purple-100 rounded-xl px-3 py-2 mb-3 max-w-3xl" data-testid="rc-demand-follows">
            A segment's demand in Recompletion is <span className="font-semibold">the same as its demand in the normal event</span>, so it is not typed here. Change it in the Normal phase and
            this follows.
          </p>
        )}

        <div className="mb-3 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <FieldLabel>Number of {phaseLabel.toLowerCase()} boards</FieldLabel>
            <CommitNumber value={boardCount} min={1} max={40} integer onCommit={(v) => baseList.setBoardCount(v)} className="w-24" data-field="setup-board-count" />
          </label>
          <p className="text-xs text-slate-500 max-w-xl">
            The same for every segment. Set it before the amounts so the subsidy has boards to go on; their size and tiles are drawn next, in step 2.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm" data-testid="setup-segments">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-200">
                <th className="py-2 pr-3">Segment</th>
                <th className="py-2 pr-3">Total demand (DR)</th>
                <th className="py-2 pr-3">Subsidy needed</th>
                {baseList.boards.map((b, i) => (
                  <th key={b.id} className="py-2 pr-2">
                    Board {i + 1} (DR)
                  </th>
                ))}
                <th className="py-2 pr-3">Boards total</th>
                <th className="py-2 pr-3">Reward factor</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((seg, i) => {
                const list = listOf(seg)
                const target = list.targetSubsidy
                const budgets = list.boards.map((b) => b.blockedValue ?? 0)
                const total = budgets.reduce((s, v) => s + v, 0)
                const gap = budgetGap(budgets, target)
                const name = seg.name || `Segment ${i + 1}`
                // Recompletion's demand is the normal event's (App.jsx keeps
                // the subsidy in step); with no normal amount there is nothing
                // to follow and the field stays free.
                const follows = phase === 'rc' && seg.main.targetSubsidy != null
                return (
                  <tr key={i} className={`border-b border-slate-100 align-top ${i === activeSegmentIndex ? 'bg-purple-50/50' : ''}`} data-setup-segment={i}>
                    <td className="py-1.5 pr-3">
                      <button type="button" className="font-semibold text-slate-700 hover:text-purple-700 whitespace-nowrap" onClick={() => onSelectSegment(i)}>
                        {name}
                      </button>
                      {i === 0 && <span className="ml-1.5 text-[11px] text-purple-600 font-semibold">base</span>}
                    </td>
                    <td className="py-1.5 pr-3">
                      <CommitNumber
                        value={target == null ? null : demandForSubsidy(target, phase)}
                        allowEmpty
                        min={0}
                        max={chaseValue(phase)}
                        integer
                        onCommit={(v) => setDemand(seg, v)}
                        className="w-32"
                        placeholder="amount"
                        aria-label={`${name} total demand`}
                        data-field="demand"
                        disabled={follows}
                        title={follows ? 'Same as this segment in the normal event - change it in the Normal phase' : undefined}
                      />
                      {follows && <div className="mt-0.5 text-[10px] font-semibold text-purple-600">same as Normal</div>}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums" data-field="subsidy-needed">
                      {target == null ? <span className="text-slate-400 text-xs">set a demand</span> : <span className="font-semibold text-purple-700">{target.toLocaleString()} DR</span>}
                    </td>
                    {baseList.boards.map((_, bi) => {
                      const board = list.boards[bi]
                      if (!board) return <td key={bi} className="py-1.5 pr-2 text-slate-300">—</td>
                      const capped = bi === 0 && list.boards.length > 1
                      const auto = target != null && bi === list.boards.length - 1
                      return (
                        <td key={bi} className="py-1.5 pr-2">
                          <CommitNumber
                            value={board.blockedValue ?? 0}
                            min={0}
                            max={capped ? firstBoardCapFor(phase) : chaseValue(phase)}
                            integer
                            disabled={auto}
                            onCommit={(v) => setBudget(seg, bi, v)}
                            className="w-24"
                            aria-label={`${name} board ${bi + 1} subsidy budget`}
                            title={auto ? 'Filled in automatically: whatever is left of the subsidy needed' : capped ? `Board 1 carries at most ${firstBoardCapFor(phase)} DR` : undefined}
                            data-field="budget"
                          />
                          {auto && <div className="text-[10px] text-slate-400">auto</div>}
                        </td>
                      )
                    })}
                    <td className="py-1.5 pr-3 tabular-nums" data-field="total">
                      <span className="font-semibold text-slate-700">{total.toLocaleString()} DR</span>
                      {target != null && Math.abs(gap) > 0 && (
                        <div className="text-[11px] text-amber-700" data-field="gap">
                          {gap > 0 ? `${gap} over` : `${-gap} short`} of the subsidy needed
                        </div>
                      )}
                      {target != null && list.boards.length > 1 && (
                        <button type="button" className="block text-[11px] text-purple-700 hover:underline" onClick={() => respread(seg)} data-field="respread">
                          spread evenly
                        </button>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">
                      {i === 0 ? (
                        <span className="text-slate-400 text-xs">1 (base)</span>
                      ) : (
                        <CommitNumber value={seg.segmentFactor ?? 1} min={0} max={100} step={0.05} onCommit={(v) => seg.setSegmentFactor(v)} className="w-20" aria-label={`Reward factor for ${name}`} data-field="factor" />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[11px] text-slate-500 leading-relaxed max-w-4xl">
          Enter a segment&apos;s total demand and its subsidy is split across the boards for you: Board 1 takes up to {firstBoardCapFor(phase)} DR and the rest is shared
          evenly. Change any board and the last board adjusts so the boards always add up to the subsidy needed. This is the same amount the board editor shows as
          &quot;Total demand&quot; - one number, edited in either place. Reward factor scales the base segment&apos;s small-reward targets (step 4). Leave the demand empty to type
          every board&apos;s budget by hand.
        </div>
      </Panel>

      <p className="text-xs text-slate-500 px-1" data-testid="setup-next-steps">
        Next: lay out the boards (step 2), set the generator multipliers and lucky drops (step 3), set the rewards (step 4) and shape the effort per rank (step 5). Each
        is a part of the board editor, in the order you need it.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------- Step 2
function LayoutsStep({ baseList, activeSegmentIndex, phase, phaseLabel, onOpenTool }) {
  const boards = baseList.boards
  const [selectedId, setSelectedId] = useState(boards[0]?.id)
  const index = Math.max(0, boards.findIndex((b) => b.id === selectedId))
  const board = boards[index]
  const isFirst = index === 0
  const capacities = boards.map((b, i) => layoutCapacity(b, i))
  const write = (next) => baseList.updateBoard(next)

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="2. Board layouts"
        subtitle="Where items can go. This sets capacity - it does not decide which items go there (that is step 4)."
        tag={<SharedTag />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl bg-slate-50/70 border border-slate-100 px-4 py-3">
            <div className="font-semibold text-slate-700">Layout</div>
            <p className="text-xs text-slate-500 mt-0.5">
              The boards, their size, which tiles are blocked or semi-blocked, rank limits, and anything you pin to a cell. You set this.
            </p>
          </div>
          <div className="rounded-2xl bg-slate-50/70 border border-slate-100 px-4 py-3">
            <div className="font-semibold text-slate-700">Contents</div>
            <p className="text-xs text-slate-500 mt-0.5">
              Which main-chain and reward items sit under those tiles, and in what order they are revealed. The build generates this from the layout, the budgets and
              the reward targets.
            </p>
          </div>
        </div>
        {activeSegmentIndex !== 0 && (
          <p className="mt-3 rounded-2xl border border-purple-200 bg-purple-50/70 px-4 py-2 text-xs text-purple-800">
            Layouts are one shared design: this edits Segment 1&apos;s boards and every segment follows. Segments differ in their budgets and reward items, not their tiles.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <FieldLabel>Number of {phaseLabel.toLowerCase()} boards</FieldLabel>
            <CommitNumber value={boards.length} min={1} max={40} integer onCommit={(v) => baseList.setBoardCount(v)} className="w-24" data-field="board-count" />
          </label>
          <p className="text-xs text-slate-500 max-w-xl">
            Board 1 is the board the player starts on. Each later board pushes in from the top (up to 3 rows) once the board before it is fully cleared, in this order.
          </p>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm" data-testid="layout-capacity">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-200">
                <th className="py-2 pr-3">Board</th>
                <th className="py-2 pr-3">Size</th>
                <th className="py-2 pr-3">Blocked</th>
                <th className="py-2 pr-3">Semi-blocked</th>
                <th className="py-2 pr-3">Rank limits</th>
                <th className="py-2 pr-3">Most DR it can hold</th>
                <th className="py-2 pr-3">Room for reward items</th>
                <th className="py-2 pr-3">Pinned</th>
                <th className="py-2 pr-3">Contents</th>
              </tr>
            </thead>
            <tbody>
              {boards.map((b, i) => {
                const cap = capacities[i]
                return (
                  <tr
                    key={b.id}
                    className={`border-b border-slate-100 cursor-pointer ${i === index ? 'bg-purple-50/60' : 'hover:bg-slate-50'}`}
                    onClick={() => setSelectedId(b.id)}
                    data-layout-board={i}
                  >
                    <td className="py-1.5 pr-3 font-semibold text-slate-700 whitespace-nowrap">Board {i + 1}</td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {b.rows} × {b.cols}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums" data-cell="blocked">
                      {cap.blockedTiles}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">{cap.semiTiles}</td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {cap.lowRank}–{cap.topRank}
                      {(cap.lowRank !== b.minRank || cap.topRank !== b.maxRank) && <span className="ml-1 text-[11px] text-slate-400">(typed {b.minRank}–{b.maxRank})</span>}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">{cap.maxDr.toLocaleString()} DR</td>
                    <td className="py-1.5 pr-3 tabular-nums" data-cell="reward-slots">
                      {cap.rewardSlots}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-slate-500">
                      {cap.pinnedMain + cap.pinnedRewards === 0 ? '—' : `${cap.pinnedMain} rank${cap.pinnedMain === 1 ? '' : 's'}, ${cap.pinnedRewards} reward`}
                      {cap.onboardingGoal && <div>goal: rank {cap.onboardingGoal.targetRank} in {cap.onboardingGoal.drBudget} DR</div>}
                    </td>
                    <td className="py-1.5 pr-3 text-xs" data-cell="contents">
                      {cap.blockedTiles + cap.semiTiles === 0 ? (
                        <span className="text-slate-400">no tiles</span>
                      ) : cap.hasContents ? (
                        <span className="text-emerald-600">has contents</span>
                      ) : (
                        <span className="text-slate-400">blank - built in step 4</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {board && (
        <Panel title={`Board ${index + 1} layout`} subtitle={isFirst ? 'The starting board.' : 'A wave board: it pushes in as up to 3 rows.'} tag={<SharedTag />}>
          <div className="flex flex-wrap items-end gap-4 mb-4">
            <label className="flex flex-col gap-1">
              <FieldLabel>Rows</FieldLabel>
              <CommitNumber value={board.rows} min={1} max={isFirst ? 20 : 3} integer onCommit={(v) => write(resizeBoard(board, isFirst, v, board.cols))} className="w-20" data-field="rows" />
            </label>
            <label className="flex flex-col gap-1">
              <FieldLabel>Columns</FieldLabel>
              <CommitNumber value={board.cols} min={1} max={20} integer onCommit={(v) => write(resizeBoard(board, isFirst, board.rows, v))} className="w-20" data-field="cols" />
            </label>
            <label className="flex flex-col gap-1">
              <FieldLabel hint={phase === 'rc' ? '(never below 3 in Recompletion)' : undefined}>Lowest rank under tiles</FieldLabel>
              <CommitNumber value={board.minRank} min={phase === 'rc' ? RC_MIN_RANK_UNDER_TILES : MIN_RANK} max={board.maxRank} integer onCommit={(v) => write(setRankWindow(board, isFirst, { minRank: v }))} className="w-20" />
            </label>
            <label className="flex flex-col gap-1">
              <FieldLabel>Highest rank under tiles</FieldLabel>
              <CommitNumber value={board.maxRank} min={board.minRank} max={phase === 'rc' ? MAX_RANK + 1 : MAX_RANK} integer onCommit={(v) => write(setRankWindow(board, isFirst, { maxRank: v }))} className="w-20" />
            </label>
            {isFirst && phase !== 'rc' && (
              <>
                <label className="flex flex-col gap-1">
                  <FieldLabel hint="(optional)">Onboarding: DR the player gets</FieldLabel>
                  <CommitNumber value={board.onboardingDrBudget} allowEmpty min={1} max={10000} integer onCommit={(v) => write(invalidateLayout(board, { onboardingDrBudget: v }))} className="w-28" placeholder="none" />
                </label>
                <label className="flex flex-col gap-1">
                  <FieldLabel hint="(optional)">…should reach rank</FieldLabel>
                  <CommitNumber value={board.onboardingTargetRank} allowEmpty min={MIN_RANK + 1} max={MAX_RANK} integer onCommit={(v) => write(invalidateLayout(board, { onboardingTargetRank: v }))} className="w-24" placeholder="none" />
                </label>
              </>
            )}
            {isFirst && phase === 'rc' && (
              <label className="flex items-center gap-2 text-sm text-slate-600 pb-1.5" title="Puts the highest rank of this board's queue on the semi-blocked cell next to the fixed rank-2 cell">
                <input type="checkbox" checked={!!board.rcEvent} onChange={(e) => write(invalidateLayout(board, { rcEvent: e.target.checked }))} className="accent-purple-600" data-field="rc-event" />
                RC event mode (highest rank shown next to the rank-2 cell)
              </label>
            )}
          </div>
          <div data-testid="layout-grid">
            <BoardGrid
              tiles={board.tiles}
              placements={board.semiPlacements}
              maxBrushRank={phase === 'rc' ? MAX_RANK + 1 : MAX_RANK}
              minBrushRank={phase === 'rc' ? RC_MIN_RANK_UNDER_TILES : 1}
              forcedRanks={board.forcedSemiRanks}
              onPaint={(r, c, state, semiRank) => write(paintTile(board, isFirst, r, c, state, semiRank))}
              onFillAll={(state) => write(fillAllTiles(board, isFirst, state))}
            />
          </div>
          <p className="mt-3 text-xs text-slate-500 leading-relaxed">
            Paint tiles blocked, semi-blocked or open. With the semi-blocked brush you can also pin a specific rank to a cell - the build keeps it.
            {isFirst && ' One cell on Board 1 is always semi-blocked and holds rank 2.'} Changing a board&apos;s tiles, size or rank limits clears that one board&apos;s
            built contents (they no longer fit the layout); every other board keeps its contents, and step 6 rebuilds what is missing.
          </p>
          <LinkButton className="mt-1 text-xs" onClick={() => onOpenTool(phase === 'main' ? 'editor' : 'recompletion')}>
            Advanced board editor: saved layout presets, reorder or duplicate boards, per-board checks
          </LinkButton>
        </Panel>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Step 3
function RewardsStep({ segments, base, baseList, activeSegmentIndex, onSelectSegment, phase, phaseLabel, onOpenTool, goTo, baseTargets, targetsFor, sharedTilePct, perResource, split, draft = null, draftCurrent = false }) {
  const board0 = baseList.boards[0]
  // The reward definitions as the economist typed them. Rank values a build
  // changed to reach an amount are a RESULT (shown beside them, and in step
  // 6); what is edited here is always the typed definition.
  const appliedConfig = board0?.rewardChainConfig
  const config = withTypedRewardValues(appliedConfig)
  const valuesByBuild = board0?.rankValuesByBuild !== false
  const allocation = base.sourceAllocation[phase] ?? {}
  const [showOverrides, setShowOverrides] = useState(Object.values(perResource).some((v) => v != null))
  const [pasteDraft, setPasteDraft] = useState('')
  const [pasteFeedback, setPasteFeedback] = useState(null)

  const setTarget = (type, value) => base.setRewardTargets({ ...base.rewardTargets, [phase]: { ...baseTargets, [type]: roundRewardAmount(type, value ?? 0) } })
  const [editing, setEditing] = useState({})
  const [ladderNote, setLadderNote] = useState(null)
  const listOfSeg = (seg) => (phase === 'main' ? seg.main : seg.recompletion)
  const setAllocation = (next) => base.setSourceAllocation({ ...base.sourceAllocation, [phase]: next })
  const setShared = (pct) => {
    const p = Math.min(100, Math.max(0, Math.round(pct)))
    setAllocation({ ...allocation, tileWeight: p / 100, dropWeight: (100 - p) / 100 })
  }
  const setOverride = (type, pct) => {
    const next = { ...perResource }
    if (pct == null) delete next[type]
    else next[type] = Math.min(100, Math.max(0, Math.round(pct)))
    setAllocation({ ...allocation, perResource: next })
  }
  const { tileTargets } = splitTargets(baseTargets, split)
  const targeted = REWARD_TYPES.filter((t) => (baseTargets[t] ?? 0) > 0)
  const coinAuto = coinLadderIsAuto(config)
  const missing = targeted.filter((t) => !(rewardPrizeAmount(config, t, REWARD_MAX_RANK) > 0) && !(t === COIN_TYPE && coinAuto))
  const coinRows = segments.map((seg, i) => ({ index: i, name: seg.name || `Segment ${i + 1}`, values: (listOfSeg(seg).boards[0]?.rewardChainConfig?.[COIN_TYPE] ?? []).map((r) => r?.prizeAmount ?? 0) })).filter((r) => r.values.some((v) => v > 0))
  const minDropRank = board0?.minDropRank ?? MIN_DROP_RANK
  const leftoverPolicy = board0?.rewardLeftoverPolicy ?? 'collect'
  const topRank = phase === 'main' ? MAX_RANK : RC_MAX_RANK
  const rewardRanks = board0?.rewardRanks ?? []
  const rewardSyntax = board0?.rewardSyntax ?? {}
  const toggleMilestone = (rank) => baseList.syncRankRewards({ rewardRanks: rewardRanks.includes(rank) ? rewardRanks.filter((r) => r !== rank) : [...rewardRanks, rank].sort((a, b) => a - b) })
  const advisories = ladderAdvisories(config, baseTargets)
  const literalCoins = hasLiteralCoinDefinitions(config)
  // The containers to show here: the last build's (even if not applied), else
  // the applied design's. Nothing until something has been built.
  const draftDrops = (draft?.shared?.dropGroups ?? []).length > 0 ? draft.shared : null
  const appliedDrops = (board0?.dropGroups ?? []).some((g) => g.auto) ? { dropGroups: board0.dropGroups, dropGroupsConfig: board0.dropGroupsConfig } : null
  const shownContainers = draftDrops ? { ...draftDrops, from: draftCurrent ? 'draft' : 'stale-draft' } : appliedDrops ? { ...appliedDrops, from: 'applied' } : null

  // --- Twister, the easy way: twists in, price out (the build prices it) ---
  const twisterPlan = base.twisterPlan?.[phase] ?? { targetSpins: null, targetSpinsOverrides: {}, checkpointPct: TWISTER_EASY_CHECKPOINT_PCT }
  const setTwisterPlan = (next) => base.setTwisterPlan({ ...base.twisterPlan, [phase]: next })
  const twisterRule = readTwisterDropRule(board0?.dropGroups ?? [], board0?.dropGroupsConfig ?? [], minDropRank)
  // The build puts the Twister item into the containers and sizes it for the
  // twists (twisterByBuild); or its drops are a rule written by hand in the
  // Twister tool, which the build keeps as it is.
  const twisterByBuild = !!board0?.twisterByBuild
  const twisterOn = twisterIsConfigured(config) && (twisterByBuild || hasTwisterDrops(board0?.dropGroups, board0?.dropGroupsConfig, board0?.minDropRank))
  const twisterValues = (config?.[TWISTER_TYPE] ?? []).map((r) => r?.prizeAmount ?? 0)
  const anyTwists = segments.some((_, i) => targetSpinsForSegment(twisterPlan, i) > 0)
  // From the "two or more items" rank the Twister item drops together with a
  // reward item (coins when they have a target, else the first reward that
  // has one), so that no drop there is a lone Twister item.
  const twisterCompanion = (targeted.includes(COIN_TYPE) ? COIN_TYPE : targeted[0]) ?? null
  const twisterRuleWith = (perMille, multiRank) =>
    applyTwisterDropRule({
      dropGroups: board0?.dropGroups ?? [],
      dropGroupsConfig: board0?.dropGroupsConfig ?? [],
      minDropRank,
      itemRank: twisterRule?.itemRank ?? 1,
      perMille,
      fromAuto: true,
      bundleFromRank: multiRank ?? null,
      bundleWith: twisterCompanion ? { type: twisterCompanion, rank: 1 } : null,
    })
  const writeTwisterRule = (perMille, nextConfig = config) => {
    const out = twisterRuleWith(perMille, multiDropRankOf(board0))
    baseList.syncRewardConfig({ rewardChainConfig: nextConfig, dropGroups: out.dropGroups, dropGroupsConfig: out.dropGroupsConfig })
  }
  // The single-item rank (merges that make it, or a lower rank, drop one
  // item) and the one reward that sits under the tiles (dropGroups.js).
  const soloDropRank = soloDropRankOf(board0)
  const hasSoloRank = soloDropRank >= minDropRank
  const soloRanksText = !hasSoloRank ? null : soloDropRank === minDropRank ? `a rank ${minDropRank}` : `a rank ${minDropRank} to ${soloDropRank}`
  const tileRewardType = tileRewardTypeOf(board0)
  const setMultiDropRank = (value) => {
    // The Twister rule is written again with it, so its bundle starts at the same rank.
    const out = twisterRule?.perMille ? twisterRuleWith(twisterRule.perMille, value) : null
    baseList.syncRewardConfig({ multiDropRank: value, ...(out ? { dropGroups: out.dropGroups, dropGroupsConfig: out.dropGroupsConfig } : {}) })
  }
  const turnTwisterOn = () => {
    // The build sets the drops: a rule written by hand is taken out.
    const cleared = twisterRule ? twisterRuleWith(0, null) : null
    baseList.syncRewardConfig({ rewardChainConfig: withDefaultTwisterValues(config), twisterByBuild: true, ...(cleared ? { dropGroups: cleared.dropGroups, dropGroupsConfig: cleared.dropGroupsConfig } : {}) })
    // A plan nobody has touched counts the twists at the end of the phase.
    if (twisterPlan.targetSpins == null && twisterPlan.checkpointPct === DEFAULT_CHECKPOINT_PCT) setTwisterPlan({ ...twisterPlan, checkpointPct: TWISTER_EASY_CHECKPOINT_PCT })
  }
  const turnTwisterOff = () => {
    const cleared = removeGeneratedTwister(twisterRuleWith(0, null))
    baseList.syncRewardConfig({ twisterByBuild: false, dropGroups: cleared.dropGroups, dropGroupsConfig: cleared.dropGroupsConfig })
  }
  const setTwisterRate = (perMille) => writeTwisterRule(perMille)
  const setTwists = (i, value) => {
    if (i === 0) return setTwisterPlan({ ...twisterPlan, targetSpins: value })
    const overrides = { ...(twisterPlan.targetSpinsOverrides ?? {}) }
    if (value == null) delete overrides[i]
    else overrides[i] = value
    setTwisterPlan({ ...twisterPlan, targetSpinsOverrides: overrides })
  }

  // Writes rank values. The number inside each rank's item syntax follows
  // when that is safe; where it is not, the rank is named so it can be edited
  // by hand. Typing a coin value makes the coin ranks the economist's own.
  function writeLadder(type, values) {
    const from = type === COIN_TYPE ? withManualCoinLadder(config) : config
    const { rewardChainConfig: next, syntaxNotUpdated } = applyLadderValues(from, type, values)
    baseList.syncRewardConfig({ rewardChainConfig: next })
    setLadderNote(syntaxNotUpdated.length ? { type, ranks: syntaxNotUpdated } : null)
  }
  function setRankValue(type, rankIndex, value) {
    const values = config[type].map((r) => r.prizeAmount ?? 0)
    values[rankIndex] = roundRewardAmount(type, value ?? 0)
    writeLadder(type, values)
  }
  function applyPaste() {
    const result = parseRewardDefinitionRows(pasteDraft, config)
    setPasteFeedback({ ok: result.ok, messages: result.messages })
    if (!result.ok) return
    baseList.syncRewardConfig({ rewardChainConfig: withTypedLadders(config, result.rewardChainConfig) })
    setPasteDraft('')
  }

  return (
    <div className="flex flex-col gap-4">
      {phase === 'rc' && (
        <div className="rounded-2xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-900" data-testid="rc-one-table">
          <span className="font-semibold">Recompletion plays the normal event&apos;s merge drops and rank values.</span> The game has one drop table and one set of rank values
          for the whole event, so a merge drops the same in Recompletion and an item pays the same. The drop rules, the rank values and the Twister item are therefore set in
          the <span className="font-semibold">Normal</span> phase; anything typed for them here is not used. What you set here is what a Recompletion player should collect -
          the build shows next to it what they really get, and can only nudge that with the reward under Recompletion&apos;s own tiles and the two merges that make rank 13 and 14.
        </div>
      )}
      <Panel
        title="4. Small rewards"
        subtitle={`What a base-segment player should collect during the ${phaseLabel.toLowerCase()} phase, and where it should come from.`}
        tag={<SegmentTag>Base segment sets the targets</SegmentTag>}
      >
        <p className="text-xs text-slate-500 mb-3 max-w-3xl">
          A target is the total a player actually <span className="font-semibold text-slate-700">collects</span> in this phase - the payout - not a number of reward
          items. Leave a resource empty if this phase should not pay it. Coins are measured in <span className="font-semibold text-slate-700">allowances</span>: 1.5
          means one and a half times the player&apos;s own coin allowance, not 1.5 coins. Coins are the only amount that can be a fraction - puzzles, merge energy and
          charms are always whole numbers. The build treats a target as met when it lands within {phase === 'rc' ? 25 : 15}% of it{phase === 'rc' ? ' (Recompletion is looser than the normal event)' : ''}.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="reward-targets">
          {REWARD_TYPES.map((type) => (
            <label key={type} className="flex flex-col gap-1 rounded-2xl border border-slate-100 bg-slate-50/50 p-3">
              <FieldLabel>{REWARD_TARGET_LABELS[type]} target</FieldLabel>
              <div className="flex items-center gap-2">
                <CommitNumber
                  value={baseTargets[type] ?? 0}
                  allowEmpty
                  min={0}
                  max={1e12}
                  step={type === COIN_TYPE ? 0.05 : 1}
                  whole={type !== COIN_TYPE}
                  onCommit={(v) => setTarget(type, v)}
                  className="w-full"
                  placeholder="none"
                  aria-label={`${REWARD_TARGET_LABELS[type]} target`}
                  data-target={type}
                />
                <span className={`text-xs whitespace-nowrap ${type === COIN_TYPE ? 'font-semibold text-amber-700' : 'text-slate-400'}`}>{type === COIN_TYPE ? '× allowance' : REWARD_AMOUNT_UNIT[type]}</span>
              </div>
              {(baseTargets[type] ?? 0) > 0 && (
                <span className="text-[11px] text-slate-500" data-source-of={type}>
                  {type === tileRewardType
                    ? type === COIN_TYPE && coinLadderIsAuto(config)
                      ? 'under tiles and from merge drops - the build sets how many'
                      : `up to ${formatRewardAmount(type, tileTargets[type])} under tiles · the rest from merge drops`
                    : 'all from merge drops'}
                </span>
              )}
            </label>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-slate-100 p-4">
          <FieldLabel>Where it comes from</FieldLabel>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-600 whitespace-nowrap">Under tiles</span>
            <input type="range" min={0} max={100} value={sharedTilePct} onChange={(e) => setShared(Number(e.target.value))} className="flex-1 min-w-[10rem] accent-purple-600" aria-label="Percent under tiles (slider)" />
            <span className="text-sm text-slate-600 whitespace-nowrap">Merge drops</span>
            <CommitNumber value={sharedTilePct} min={0} max={100} integer onCommit={setShared} className="w-20" aria-label="Percent under tiles" data-field="tile-pct" />
            <span className="text-sm text-slate-600 whitespace-nowrap">
              % under tiles · <span className="font-semibold">{100 - sharedTilePct}%</span> from merge drops
            </span>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            &quot;Under tiles&quot; are reward items the build places in blocked cells. &quot;Merge drops&quot; land on the board when main-chain items merge. Both kinds
            merge with each other. Only <span className="font-semibold text-slate-700">one reward</span> goes under tiles (picked just below), so this slider is about
            that reward; every other reward comes from merge drops. The build never asks more than 40% of a reward of the tiles.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-5" data-testid="tile-reward-rules">
            <div className="flex flex-col gap-1">
              <FieldLabel hint="(shared)">The reward under the tiles</FieldLabel>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="The reward under the tiles" data-field="tile-reward-type">
                {REWARD_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={tileRewardType === type}
                    onClick={() => baseList.syncRewardConfig({ tileRewardType: type })}
                    data-tile-reward={type}
                    className={`rounded-xl px-3 py-1.5 text-sm font-semibold whitespace-nowrap border transition-colors ${tileRewardType === type ? 'border-purple-500 bg-purple-600 text-white' : 'border-slate-200 bg-white/80 text-slate-600 hover:border-purple-300'}`}
                  >
                    {REWARD_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex flex-col gap-1">
              <FieldLabel hint="(shared - merges that make this rank or a lower one)">One item only, up to rank</FieldLabel>
              <CommitNumber
                value={soloDropRank}
                min={1}
                max={topRank}
                integer
                onCommit={(v) => baseList.syncRewardConfig({ soloDropRank: v })}
                className="w-20"
                aria-label="Merges up to this rank drop one item only"
                data-field="solo-drop-rank"
              />
            </label>
          </div>
          <p className="mt-1.5 text-xs text-slate-500" data-testid="tile-reward-how">
            Every reward item the build puts under a tile is <span className="font-semibold text-slate-700">{REWARD_TYPE_LABELS[tileRewardType].toLowerCase()}</span>.{' '}
            {hasSoloRank ? (
              <>
                A merge that makes {soloRanksText} drops <span className="font-semibold text-slate-700">one item only</span>, and about{' '}
                {Math.round(TILE_REWARD_FOCUS_SHARE * 100)}% of those drops are a rank-1 {REWARD_TYPE_LABELS[tileRewardType].toLowerCase()} item - the item that opens a reward
                under a tile. Every merge above that drops a container by the two ranks below: two items, and three only from the last rank.
              </>
            ) : (
              <>No merge is limited to one item (the rank above is below the rank merge drops start at): every merge drops a container by the two ranks below.</>
            )}{' '}
            Board 1 holds no reward item, Board 2 may hold rank 1 and rank 2, every later board rank 1 only.{' '}
            {tileRewardType === COIN_TYPE && coinLadderIsAuto(config)
              ? 'Coins fit this best: the build sets the coin values, so it can drop as many coin items as the boards need and size their value afterwards.'
              : `${REWARD_TYPE_LABELS[tileRewardType]} has a typed target, so it can only drop as often as that target allows - with a small target fewer of those drops are ${REWARD_TYPE_LABELS[tileRewardType].toLowerCase()}.`}
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-5" data-testid="drop-rules">
            <label className="flex flex-col gap-1">
              <FieldLabel hint="(shared - the earliest)">Merge drops start at rank</FieldLabel>
              <CommitNumber value={minDropRank} min={2} max={topRank} integer onCommit={(v) => baseList.syncRewardConfig({ minDropRank: v })} className="w-20" aria-label="Merge drops start at rank" data-field="min-drop-rank" />
            </label>
            <label className="flex flex-col gap-1">
              <FieldLabel hint="(shared - before it the chance rises rank by rank)">Every drop holds 2 items from rank</FieldLabel>
              <CommitNumber
                value={Math.max(minDropRank, multiDropRankOf(board0))}
                min={minDropRank}
                max={topRank}
                integer
                onCommit={setMultiDropRank}
                className="w-20"
                aria-label="Every drop holds two items from rank"
                data-field="multi-drop-rank"
              />
            </label>
            <label className="flex flex-col gap-1">
              <FieldLabel hint="(shared - three items only from this rank up)">Every drop holds 3 items from rank</FieldLabel>
              <CommitNumber
                value={Math.max(minDropRank + 1, tripleDropRankOf(board0))}
                min={minDropRank + 1}
                max={topRank}
                integer
                onCommit={(v) => baseList.syncRewardConfig({ tripleDropRank: v })}
                className="w-20"
                aria-label="Every drop holds three items from rank"
                data-field="triple-drop-rank"
              />
            </label>
            <label className="flex flex-col gap-1">
              <FieldLabel hint="(shared)">Unmerged reward items left at the end</FieldLabel>
              <select value={leftoverPolicy} onChange={(e) => baseList.syncRewardConfig({ rewardLeftoverPolicy: e.target.value })} className="border border-slate-200 rounded-xl px-2.5 py-1.5 text-sm bg-white/80" aria-label="Leftover reward items" data-field="leftover-policy">
                <option value="collect">are tapped and collected at their own rank&apos;s value</option>
                <option value="forfeit">pay nothing (only rank {REWARD_MAX_RANK} pays)</option>
              </select>
            </label>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            The rank is the rank the merge <span className="font-semibold text-slate-700">makes</span>: with 6, merging two rank-5 items into a rank 6 is the first merge
            that drops. From there, <span className="font-semibold text-slate-700">every merge drops</span> - there is no
            &quot;nothing&quot; outcome.{' '}
            {hasSoloRank ? `A merge that makes ${soloRanksText} drops one item. Above that a` : 'A'} container can hold several rewards: the chance that a drop holds two items rises
            with every rank and is 100% from the rank in the second box; only from the rank in the third box does a drop hold three. These counts are rules: a drop never
            holds more than its rank allows. When your amounts need more than that carries, the items get bigger first (rank 3 at most), and then the build changes that
            reward's rank values instead of adding items (see "Reward definitions" below).{' '}
            Dropped items land free, ready to merge or collect. The build makes the containers and gives each a weight (you see them in step 6), and never moves this rank. The second setting decides which totals can be paid: when leftovers pay nothing, a reward is only ever paid in whole rank-{REWARD_MAX_RANK} amounts.
          </p>
          <label className="mt-2 flex items-start gap-2 rounded-2xl border border-purple-100 bg-purple-50/50 px-3 py-2 text-sm text-slate-700" data-testid="steady-drops">
            <input
              type="checkbox"
              className="mt-0.5 accent-purple-600"
              checked={board0?.steadyDrops !== false}
              onChange={(e) => baseList.syncRewardConfig({ steadyDrops: e.target.checked })}
              data-field="steady-drops"
            />
            <span>
              <span className="font-semibold">Every merge of a rank drops the same items.</span>{' '}
              <span className="text-slate-500">
                Nothing about which reward a merge drops is left to chance, so every player ends close to the amounts you ask for - not only the average player. Measured on a
                test event (one build, 200 players): with it, 100 of 100 players land within 15% of every amount at once; with containers picked at random, 28 of 100 did. The
                item counts stay your rules (one item at rank {minDropRank}, two items, three items). Switch it off for the more varied containers of before. It needs the build to
                give the rank values (below); this tool&apos;s own design. Step 7 shows the number for your own event.
              </span>
            </span>
          </label>
          <p className="mt-1.5 text-xs text-slate-500" data-testid="tile-reward-rule">
            Only a reward item <span className="font-semibold text-slate-700">under a tile</span> is{' '}
            <span className="font-semibold text-slate-700">semi-blocked when its tile opens</span>, like any other item under a tile: the player frees it by merging a
            matching dropped item into it. So every reward needs some merge drops - with nothing from drops, the items under tiles are never freed.
          </p>
          <LinkButton className="mt-2 text-xs" onClick={() => setShowOverrides((v) => !v)}>
            {showOverrides ? 'Hide per-resource splits' : 'Use a different split for one resource'}
          </LinkButton>
          {showOverrides && (
            <div className="mt-2 grid grid-cols-2 lg:grid-cols-4 gap-3">
              {REWARD_TYPES.map((type) => (
                <label key={type} className="flex flex-col gap-1">
                  <FieldLabel hint="% under tiles">{REWARD_TARGET_LABELS[type]}</FieldLabel>
                  <CommitNumber value={perResource[type] ?? null} allowEmpty min={0} max={100} integer onCommit={(v) => setOverride(type, v)} placeholder={`${sharedTilePct} (shared)`} className="w-full" aria-label={`${REWARD_TARGET_LABELS[type]} percent under tiles`} />
                </label>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Other segments" subtitle="Derived from the base targets - nothing to type per resource." tag={<SegmentTag />}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm" data-testid="derived-targets">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-200">
                <th className="py-2 pr-3">Segment</th>
                <th className="py-2 pr-3">Factor</th>
                {REWARD_TYPES.map((t) => (
                  <th key={t} className="py-2 pr-3">
                    {REWARD_TARGET_LABELS[t]}
                    {t === COIN_TYPE && <span className="normal-case tracking-normal font-normal"> (× allowance)</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {segments.map((seg, i) => {
                const targets = targetsFor(i)
                return (
                  <tr key={i} className={`border-b border-slate-100 ${i === activeSegmentIndex ? 'bg-purple-50/50' : ''}`} data-derived-segment={i}>
                    <td className="py-1.5 pr-3">
                      <button type="button" className="font-semibold text-slate-700 hover:text-purple-700 whitespace-nowrap" onClick={() => onSelectSegment(i)}>
                        {seg.name || `Segment ${i + 1}`}
                      </button>
                    </td>
                    <td className="py-1.5 pr-3">
                      {i === 0 ? <span className="text-xs text-purple-600 font-semibold">base</span> : <CommitNumber value={seg.segmentFactor ?? 1} min={0} max={100} step={0.05} onCommit={(v) => seg.setSegmentFactor(v)} className="w-20" aria-label={`Reward factor for ${seg.name || `Segment ${i + 1}`}`} />}
                    </td>
                    {REWARD_TYPES.map((t) => (
                      <td key={t} className="py-1.5 pr-3 tabular-nums text-slate-600" data-derived={t}>
                        {targets[t] > 0 ? formatRewardAmount(t, targets[t]) : '—'}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Each amount is the base target × the segment&apos;s factor. Puzzles, merge energy and charms are rounded to the nearest whole number; only coins keep a
          fraction. Merge-drop odds are the same for every segment, so the other segments reach their own targets through the reward items under their own tiles - and,
          for coins, through what a coin item is worth in that segment.
        </p>
      </Panel>

      <Panel title="Reward definitions" subtitle="What each reward rank pays. Reused automatically once they are valid." tag={<SharedTag />}>
        <div id="build-definitions" className="flex flex-col gap-2" data-testid="definitions-status">
          <label className="flex items-start gap-2 rounded-2xl border border-purple-100 bg-purple-50/50 px-3 py-2 text-sm text-slate-700" data-testid="values-by-build">
            <input
              type="checkbox"
              className="mt-0.5 accent-purple-600"
              checked={valuesByBuild}
              onChange={(e) => baseList.syncRewardConfig({ rankValuesByBuild: e.target.checked })}
              data-field="rank-values-by-build"
            />
            <span>
              <span className="font-semibold">The build may change a reward&apos;s rank values to reach its amount.</span>{' '}
              <span className="text-slate-500">
                The drop rules stay as you set them (one item at rank {minDropRank}, two items, three items). The build gives every segment its own four rank values for each reward,
                so each segment&apos;s average lands on its own amount: round amounts (5 / 15 / 35 / 75, not 8 / 23 / 23 / 61), and each rank worth more than the items it is made of, so
                tapping an item early never pays more than merging it. Step 6 shows them. Your typed values stay here as the definition. Switch this off to keep your values whatever
                happens - then every segment plays the values typed here and what that pays is reported.
              </span>
            </span>
          </label>
          {targeted.length === 0 && <p className="text-sm text-slate-500">No resource has a target yet, so no definitions are needed.</p>}
          {targeted.map((type) => {
            const ok = !missing.includes(type)
            const isAutoCoins = type === COIN_TYPE && coinAuto
            const showInputs = !ok || editing[type]
            return (
              <div key={type} className="rounded-2xl border border-slate-100 px-3 py-2" data-definition={type} data-coin-mode={type === COIN_TYPE ? (coinAuto ? 'auto' : 'manual') : undefined}>
                <CheckLine
                  ok={ok}
                  action={
                    ok && (
                      <LinkButton className="text-xs" onClick={() => setEditing((e) => ({ ...e, [type]: !e[type] }))} data-edit-ranks={type}>
                        {editing[type] ? 'Done' : isAutoCoins ? 'Type my own values' : 'Change values'}
                      </LinkButton>
                    )
                  }
                >
                  <span className="font-semibold">{REWARD_TARGET_LABELS[type]}</span>{' '}
                  {isAutoCoins
                    ? '- the build sets what each coin rank is worth, separately for each segment, so every segment lands on its own coin target.'
                    : ok
                      ? `- ranks 1 to ${REWARD_MAX_RANK} pay ${config[type].map((r) => formatRewardAmount(type, r.prizeAmount)).join(' / ')}${type === COIN_TYPE ? ' allowance (typed by you, the same for every segment)' : ''}`
                      : type === COIN_TYPE
                        ? '- some coin ranks have no value yet. Fill all four, or let the build set them.'
                        : `- needs the value of each rank (1 to ${REWARD_MAX_RANK}). Whole numbers.`}
                </CheckLine>
                {isAutoCoins && (
                  <div className="mt-1.5 ml-6 text-xs text-slate-500" data-testid="coin-values">
                    {coinRows.length === 0 ? (
                      <span>
                        The values appear here after the build. The four ranks keep the proportions {COIN_VALUE_SHAPE.join(' : ')} and are sized up or down per segment. Syntax{' '}
                        <span className="font-mono">allowance(coins:…)</span> is written for you.
                      </span>
                    ) : (
                      <table className="tabular-nums">
                        <thead>
                          <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            <th className="pr-4 py-0.5">Coin rank values (× allowance)</th>
                            {[1, 2, 3, 4].map((r) => (
                              <th key={r} className="pr-4 py-0.5">
                                Rank {r}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {coinRows.map((row) => (
                            <tr key={row.index} data-coin-row={row.index}>
                              <td className="pr-4 py-0.5 font-semibold text-slate-600">{row.name}</td>
                              {row.values.map((v, i) => (
                                <td key={i} className="pr-4 py-0.5">
                                  {formatRewardAmount(COIN_TYPE, v)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
                {showInputs && (
                  <div className="mt-2 ml-6 flex flex-wrap items-end gap-2">
                    {config[type].map((entry, i) => (
                      <label key={i} className="flex flex-col gap-1">
                        <FieldLabel>Rank {i + 1}</FieldLabel>
                        <CommitNumber value={isAutoCoins ? 0 : (entry.prizeAmount ?? 0)} allowEmpty min={0} max={1e12} step={type === COIN_TYPE ? 0.01 : 1} whole={type !== COIN_TYPE} onCommit={(v) => setRankValue(type, i, v)} className="w-24" aria-label={`${REWARD_TARGET_LABELS[type]} rank ${i + 1} value`} data-rank-value={`${type}-${i + 1}`} />
                      </label>
                    ))}
                    {type === COIN_TYPE && !coinAuto && (
                      <LinkButton className="text-xs pb-2" onClick={() => baseList.syncRewardConfig({ rewardChainConfig: withBlankCoinValues(config) })} data-testid="coins-back-to-auto">
                        Let the build set the coin values
                      </LinkButton>
                    )}
                    {isAutoCoins && <span className="text-xs text-slate-400 pb-2">Typing a value here switches the coin ranks to your own values, shared by every segment.</span>}
                  </div>
                )}
                {type !== COIN_TYPE && rewardLadderIsBuildValued(appliedConfig, type) && (
                  <div className="mt-1.5 ml-6 text-xs text-purple-700" data-build-values={type}>
                    The applied build changed these to {appliedConfig[type].map((r) => formatRewardAmount(type, r.prizeAmount)).join(' / ')} to reach the amount with the drop rules as
                    set. The next build starts again from your values above.
                  </div>
                )}
                {multiResourceSyntaxes({ [type]: config[type] }).length > 0 && (
                  <div className="mt-1.5 ml-6 text-xs text-amber-700" data-multi-resource={type}>
                    One item should pay one resource. Rank{' '}
                    {multiResourceSyntaxes({ [type]: config[type] })
                      .map((x) => `${x.rank} (${x.syntax})`)
                      .join(', ')}{' '}
                    is written to pay more than one - edit its item syntax in the advanced Rewards tab.
                  </div>
                )}
                {ladderNote?.type === type && (
                  <div className="mt-1.5 ml-6 text-xs text-amber-700" data-testid="syntax-not-updated">
                    The item syntax of rank {ladderNote.ranks.join(', ')} holds more than one amount, so it was not rewritten - update it by hand in the advanced Rewards tab.
                  </div>
                )}
              </div>
            )
          })}
          {literalCoins && (
            <div className="flex items-start gap-2 text-sm text-amber-700" data-testid="build-literal-coins">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <span>
                The coin ranks are still literal coin amounts (such as <span className="font-mono">coins:100000</span>) from an older configuration. Coins are paid as an
                allowance worth now. They were kept as saved; until you enter allowance worths, the coin target above is in those old amounts.
              </span>
            </div>
          )}
          {advisories.map((a) => {
            const fixes = suggestLadderFixes(config[a.type], { whole: a.type !== COIN_TYPE })
            return (
              <div key={a.type} className="rounded-2xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800" data-ladder-problem={a.type}>
                <div className="flex items-start gap-2">
                  <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold">{REWARD_TARGET_LABELS[a.type]}: merging does not pay off with these rank values.</div>
                    <ul className="list-disc ml-4 mt-0.5">
                      {a.issues.map((issue, i) => (
                        <li key={i}>{issue.message}</li>
                      ))}
                    </ul>
                    <div className="mt-1">
                      Why it matters: the build assumes players merge up to rank {REWARD_MAX_RANK}. With these values a player who collects earlier gets more than the build
                      predicts. A valid set has every rank worth at least double the one below it, and rank {REWARD_MAX_RANK} worth more than the items it is made of.
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {fixes.map((f) => (
                        <Button key={f.id} variant="secondary" size="sm" onClick={() => writeLadder(a.type, f.values)} data-ladder-fix={`${a.type}-${f.id}`}>
                          {f.label}: {f.values.map((v) => formatRewardAmount(a.type, v)).join(' / ')}
                        </Button>
                      ))}
                      <LinkButton className="text-xs" onClick={() => setEditing((e) => ({ ...e, [a.type]: true }))}>
                        Type other values
                      </LinkButton>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <details className="mt-3 rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3">
          <summary className="cursor-pointer select-none flex items-center gap-2 text-sm font-semibold text-slate-600">
            <ClipboardPaste size={14} /> Paste definitions from a spreadsheet
          </summary>
          <p className="text-xs text-slate-500 my-2">
            Tab-separated rows: <span className="font-mono">Resource &nbsp; Rank &nbsp; Item syntax &nbsp; Value &nbsp; [Asset ID]</span>. For coins the value is the allowance
            worth and the syntax looks like <span className="font-mono">allowance(coins:0.12)</span>. Nothing is applied unless every row is valid.
          </p>
          <textarea value={pasteDraft} onChange={(e) => { setPasteDraft(e.target.value); setPasteFeedback(null) }} rows={4} aria-label="Paste reward definitions" className="w-full border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-mono bg-white/80" />
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
        </details>
        <LinkButton className="mt-3 text-xs" onClick={() => onOpenTool('rewards')}>
          Advanced: item syntax, asset IDs, drop groups, per-rank weights, locks and pinned reward items
        </LinkButton>
      </Panel>

      <Panel title="Milestone rewards (optional)" subtitle="A reward the player gets the first time they reach a rank. Exported in the Item Ladder sheet." tag={<SharedTag />}>
        <div className="flex flex-wrap gap-1.5" data-testid="milestone-ranks">
          {Array.from({ length: topRank }, (_, i) => i + 1).map((rank) => {
            const on = rewardRanks.includes(rank)
            return (
              <button
                key={rank}
                type="button"
                aria-pressed={on}
                onClick={() => toggleMilestone(rank)}
                title={on ? `Rank ${rank} gives a reward - click to remove` : `Click to give a reward at rank ${rank}`}
                className={`w-9 h-9 rounded-xl text-sm font-bold border-2 ${on ? 'text-white border-transparent shadow' : 'text-slate-500 border-slate-200 bg-white hover:border-purple-300'}`}
                style={on ? { backgroundColor: colorForRank(Math.min(rank, MAX_RANK)) } : undefined}
                data-milestone-rank={rank}
              >
                {rank}
              </button>
            )
          })}
        </div>
        {rewardRanks.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No milestone reward yet. Click a rank to add one.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {rewardRanks.map((rank) => (
              <label key={rank} className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span className="w-16 font-semibold">Rank {rank}</span>
                <input
                  className="flex-1 min-w-[16rem] border border-slate-200 rounded-xl px-2.5 py-1.5 text-sm font-mono bg-white/80"
                  placeholder="reward syntax, as Ops writes it"
                  value={rewardSyntax[rank] ?? ''}
                  onChange={(e) => baseList.syncRankRewards({ rewardSyntax: { ...rewardSyntax, [rank]: e.target.value } })}
                  aria-label={`Milestone reward syntax for rank ${rank}`}
                  data-milestone-syntax={rank}
                />
              </label>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-400">These do not change the build - they are part of what is exported. The same set applies to every segment.</p>
      </Panel>

      <Panel
        title="Twister (optional)"
        subtitle="Type how many twists each segment's player should get. The build works out the price of a twist for each segment (you see it in step 6)."
        tag={<SegmentTag />}
        data-testid="build-twister"
      >
        {!twisterOn ? (
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <StatusChip kind="none">No Twister in this phase</StatusChip>
            <span className="flex-1 min-w-[16rem] text-xs text-slate-500">
              A Twister is a separate widget: merges drop Twister items, the player collects Twister DR from them and spends it on twists. It never goes under tiles and never
              blocks a build.
            </span>
            <Button variant="primary" size="sm" onClick={turnTwisterOn} data-testid="twister-add">
              Add a Twister
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="overflow-x-auto">
              <table className="text-sm" data-testid="twister-twists">
                <thead>
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-200">
                    <th className="py-1.5 pr-4">Segment</th>
                    <th className="py-1.5 pr-4">Twists the player should get</th>
                    <th className="py-1.5 pr-4">Price of a twist now</th>
                  </tr>
                </thead>
                <tbody>
                  {segments.map((seg, i) => {
                    const own = i === 0 ? twisterPlan.targetSpins : (twisterPlan.targetSpinsOverrides?.[i] ?? null)
                    const cost = listOfSeg(seg).boards[0]?.twisterSpinCost ?? null
                    return (
                      <tr key={i} className={`border-b border-slate-100 ${i === activeSegmentIndex ? 'bg-purple-50/50' : ''}`} data-twister-segment={i}>
                        <td className="py-1.5 pr-4 font-semibold text-slate-700 whitespace-nowrap">
                          {seg.name || `Segment ${i + 1}`}
                          {i === 0 && <span className="ml-1.5 text-[11px] text-purple-600 font-semibold">base</span>}
                        </td>
                        <td className="py-1.5 pr-4">
                          <CommitNumber
                            value={own}
                            allowEmpty
                            min={1}
                            max={100000}
                            integer
                            onCommit={(v) => setTwists(i, v)}
                            className="w-28"
                            placeholder={i === 0 ? 'twists' : twisterPlan.targetSpins ? `${twisterPlan.targetSpins} (as base)` : 'as base'}
                            aria-label={`${seg.name || `Segment ${i + 1}`} twists`}
                            data-field="twists"
                          />
                        </td>
                        <td className="py-1.5 pr-4 text-xs text-slate-500 tabular-nums" data-field="twist-price">
                          {cost == null ? 'not set yet - the build sets it' : `${cost} Twister DR`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              {twisterByBuild ? (
                <div className="flex flex-col gap-1" data-testid="twister-by-build">
                  <FieldLabel>How many Twister items drop</FieldLabel>
                  <span className="rounded-lg bg-purple-50 px-2.5 py-1.5 text-xs font-semibold text-purple-700">Set by the build, to fit the twists</span>
                </div>
              ) : (
                <label className="flex flex-col gap-1">
                  <FieldLabel hint="(out of 1,000 merges that drop - your own fixed chance)">How often a merge drops a Twister item</FieldLabel>
                  <CommitNumber value={twisterRule?.perMille ?? null} min={1} max={900} integer onCommit={setTwisterRate} className="w-28" data-field="twister-rate" />
                </label>
              )}
              <label className="flex flex-col gap-1">
                <FieldLabel hint="(Twister DR; 1 = any whole number)">The price moves in steps of</FieldLabel>
                <CommitNumber value={twisterPlan.costIncrement ?? 1} min={1} max={100000} integer onCommit={(v) => setTwisterPlan({ ...twisterPlan, costIncrement: v })} className="w-28" data-field="twister-step" />
              </label>
              <label className="flex flex-col gap-1">
                <FieldLabel hint="(% of the phase played; 100 = by the end)">Twists counted when the player is at</FieldLabel>
                <CommitNumber value={twisterPlan.checkpointPct} min={1} max={100} integer onCommit={(v) => setTwisterPlan({ ...twisterPlan, checkpointPct: v })} className="w-28" data-field="twister-checkpoint" />
              </label>
              {!twisterByBuild && (
                <Button variant="secondary" size="sm" onClick={turnTwisterOn} data-testid="twister-let-build">
                  Let the build set the Twister drops
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={turnTwisterOff} data-testid="twister-remove">
                Remove the Twister
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onOpenTool('twister')}>
                Advanced: open the Twister tool
              </Button>
            </div>
            {twisterByBuild && (
              <label className="flex items-start gap-2 rounded-2xl border border-purple-100 bg-purple-50/50 px-3 py-2 text-sm text-slate-700 max-w-3xl" data-testid="twister-steady">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-purple-600"
                  checked={board0?.twisterSteady !== false}
                  onChange={(e) => baseList.syncRewardConfig({ twisterSteady: e.target.checked })}
                  data-field="twister-steady"
                />
                <span>
                  <span className="font-semibold">Keep every segment&apos;s Twister steady.</span>{' '}
                  <span className="text-slate-500">
                    Twister DR is only paid when a Twister item is finished (rank 4). A segment with a lot of subsidy merges little, finishes one item, and gets every twist in
                    one jump - at 50% of the phase in one segment, at 100% in another. With this on, the build makes the Twister items bigger (rank 3 at most, never a finished
                    item) until every segment&apos;s typical player finishes at least {TWISTER_MIN_COLLECTS} and no segment has all its twists early, so twists arrive in steps and the last one lands near the end in every
                    segment. Switch it off to keep the Twister items at rank 1-2 whatever happens. ({TWISTER_MIN_COLLECTS} is this tool&apos;s own number.)
                  </span>
                </span>
              </label>
            )}
            <p className="text-xs text-slate-500 max-w-3xl" data-testid="twister-how">
              {twisterByBuild ? (
                <>
                  How it works: the build makes the Twister item one of the things a merge can drop
                  : a Twister item is one of the items in a quarter of the drops at every rank (it takes a reward item's place - it is never an extra item), more where the rewards leave places empty. Then it plays every segment and sizes
                  the four Twister DR values: the smallest round values at which every segment has a price that fits its twists. Last, it sets each segment{"'"}s price: the highest one at
                  which its typical player still gets the twists you typed, so the last twist comes close to the point twists are counted - in every segment alike (step 6 shows when). A
                  Twister item is worth {twisterValues.map((v) => formatRewardAmount(TWISTER_TYPE, v)).join(' / ')} Twister DR at ranks 1 to 4. A segment that merges
                  more collects more, so it gets a higher price for the same twists.{' '}
                </>
              ) : (
                <>
                  How it works: every merge from the drop start rank has your fixed chance of dropping a rank-1 Twister item; four of them merged up are worth{' '}
                  {twisterValues.map((v) => formatRewardAmount(TWISTER_TYPE, v)).join(' / ')} Twister DR at ranks 1 to 4. The build keeps that chance as it is and only sets a
                  price - when a player collects too little for the twists, it cannot help. &quot;Let the build set the Twister drops&quot; lets it.{' '}
                </>
              )}
              <span className="text-slate-400">
                The four values and counting at the end are this tool's starting numbers, not confirmed game values - the price adapts to whatever you set. A smaller price step
                lets the price land closer to your twists.
              </span>
            </p>
            {twisterByBuild && !hasTwisterDrops(board0?.dropGroups, board0?.dropGroupsConfig, board0?.minDropRank) && (
              <p className="text-xs text-purple-700" data-testid="twister-rebuild-note">
                Containers that were built before you added the Twister do not hold it yet. Build (step 6): the build makes the containers again, with the Twister item in
                them, and sets the price.
              </p>
            )}
            {!anyTwists && (
              <p className="text-xs text-amber-700" data-testid="twister-needs-twists">
                Type the twists for the base segment, or the build has no price to work out.
              </p>
            )}
          </div>
        )}
      </Panel>

      <Panel
        title="Containers: what a merge drops"
        subtitle="A container is one drop: one to four reward items that fall together. The build makes them from your targets and gives each a weight per merge rank - you do not type them."
        tag={<SharedTag />}
        data-testid="rewards-containers"
      >
        {shownContainers ? (
          <>
            <p className="mb-2 text-xs text-slate-500" data-testid="rewards-containers-source">
              {shownContainers.from === 'draft'
                ? 'From the last build (not applied yet).'
                : shownContainers.from === 'stale-draft'
                  ? 'From the last build - your inputs have changed since, so the next build will make them again.'
                  : 'From the applied design.'}{' '}
              They are exported as the Small Rewards Bank and Small Reward Weights sheets.
            </p>
            <ContainersTable dropGroups={shownContainers.dropGroups} dropGroupsConfig={shownContainers.dropGroupsConfig} minDropRank={minDropRank} phase={phase} testid="rewards-container-table" />
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600" data-testid="rewards-containers-empty">
            <span className="flex-1 min-w-[16rem] text-xs text-slate-500">
              No containers yet. They are made when you build (step 6): one per different drop, each with a weight for every merge rank from the drop start rank up. They then show
              here, in the build results, and in the Syntax tab.
            </span>
            <Button variant="secondary" size="sm" onClick={() => goTo('build')}>
              Go to Build boards
            </Button>
          </div>
        )}
      </Panel>

    </div>
  )
}
