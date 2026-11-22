import { useMemo, useState } from 'react'
import { LineChart, Wand2, Check } from 'lucide-react'
import Button from '../../../../components/ui/Button'
import BoardGrid from '../editor/BoardGrid'
import EffortDistributionChart from '../editor/EffortDistributionChart'
import { CommitNumber, SharedTag, SegmentTag, FieldLabel, LinkButton } from './buildUi'
import { MAX_RANK, MIN_RANK, colorForRank } from '../../lib/core/ranks'
import { FIRST_BOARD_SUBSIDY_CAP_DR } from '../../lib/core/board'
import { buildGeneratorTiers, DEFAULT_TIER2_UNLOCK_RANK, DEFAULT_TIER4_UNLOCK_RANK } from '../../lib/core/generatorTier'
import { computeProbs, DEFAULT_TARGET_EV, MIN_TARGET_EV, MAX_TARGET_EV } from '../../lib/core/luckyDrop'
import { regenerateBoard, suggestBoardValuesForEffortTarget } from '../../lib/simulation/effortTargeting'
import { simulatePlaythrough } from '../../lib/simulation/mergeSimulation'
import { buildSimulationRows, buildClimbRows, RANKS, RC_RANKS } from '../../lib/simulation/simulationRows'
import { decodeReward, REWARD_TYPE_LABELS } from '../../lib/rewards/rewardChain'

// The parts of the board editor that are not a board's own tiles, as steps of
// the Build Event flow (by explicit economist request: "the editor should be
// broken into steps that will be in the builder ... the distribution, the
// lucky drops, the multipliers. everything"). Like every other step they edit
// the same canonical state the editor's own cards edit - nothing is copied.

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
const pctText = (p) => `${(p * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
const dr = (v) => (v == null || !Number.isFinite(v) ? '—' : `${Math.round(v).toLocaleString()} DR`)
const sum = (xs) => xs.reduce((s, v) => s + v, 0)
const CHART_CAPTION = 'For each rank: the DR the player has spent by then, what that rank cost, its share of all their effort, and the generator taps it took'

// A part of a folded section: a heading and what belongs to it, without a card
// of its own (these were whole steps once, each a row of cards).
function Section({ title, subtitle, tag, children, first = false }) {
  return (
    <section className={first ? '' : 'border-t border-slate-100 pt-4'}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {tag}
      </header>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------- Generator and lucky drops
// (The bottom section of step 1, folded: every value here has a working default.)
export function GeneratorStep({ segments, base, baseList, activeSeg, activeList, activeSegmentIndex, phase, phaseLabel, listOf }) {
  const board0 = activeList.boards[0]
  const t2 = board0?.tier2UnlockRank ?? DEFAULT_TIER2_UNLOCK_RANK
  const t4 = board0?.tier4UnlockRank ?? DEFAULT_TIER4_UNLOCK_RANK
  const tiers = buildGeneratorTiers(t2, t4)
  const targetEv = baseList.boards[0]?.targetEv ?? DEFAULT_TARGET_EV
  const probs = computeProbs(targetEv)
  const segName = activeSeg.name || `Segment ${activeSegmentIndex + 1}`
  const others = segments.filter((seg) => seg !== activeSeg)
  const tiersDiffer = others.some((seg) => (listOf(seg).boards[0]?.tier2UnlockRank ?? DEFAULT_TIER2_UNLOCK_RANK) !== t2 || (listOf(seg).boards[0]?.tier4UnlockRank ?? DEFAULT_TIER4_UNLOCK_RANK) !== t4)
  const copyToAll = () => others.forEach((seg) => listOf(seg).syncGeneratorTiers({ tier2UnlockRank: t2, tier4UnlockRank: t4 }))
  const OUTCOMES = ['The normal item', 'One rank higher (+1)', 'Two ranks higher (+2)']

  return (
    <div className="flex flex-col gap-4">
      <Section
        first
        title="Generator multipliers"
        subtitle={`What a tap on the generator costs and gives, and when the bigger multipliers open - ${phaseLabel.toLowerCase()} phase.`}
        tag={<SegmentTag>{segName}</SegmentTag>}
      >
        <table className="text-sm tabular-nums" data-testid="generator-tiers">
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-200">
              <th className="py-2 pr-8">Multiplier</th>
              <th className="py-2 pr-8">One tap costs</th>
              <th className="py-2 pr-8">One tap gives</th>
              <th className="py-2 pr-8">Opens when the player holds</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier, i) => (
              <tr key={tier.cost} className="border-b border-slate-100">
                <td className="py-2 pr-8 font-display font-bold text-purple-700">×{tier.cost}</td>
                <td className="py-2 pr-8">{tier.cost} DR</td>
                <td className="py-2 pr-8">a rank-{tier.normalRank} item</td>
                <td className="py-2 pr-8">
                  {i === 0 ? (
                    <span className="text-slate-500">always open</span>
                  ) : (
                    <span className="flex items-center gap-2">
                      rank
                      <CommitNumber
                        value={i === 1 ? t2 : t4}
                        min={MIN_RANK}
                        max={MAX_RANK}
                        integer
                        onCommit={(v) => activeList.syncGeneratorTiers(i === 1 ? { tier2UnlockRank: v } : { tier4UnlockRank: v })}
                        className="w-20"
                        aria-label={`×${tier.cost} unlocks at rank`}
                        data-field={`tier${tier.cost}-unlock`}
                      />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500 max-w-3xl">
          A multiplier is open only while the player holds a free item of that rank - if that item is merged away, the multiplier closes again. These ranks are set per
          segment; every board of the segment uses them.
        </p>
        {tiersDiffer && (
          <LinkButton className="mt-1 text-xs" onClick={copyToAll} data-testid="tiers-copy-all">
            Use these unlock ranks for every segment
          </LinkButton>
        )}
      </Section>

      <Section title="Lucky drops" subtitle="Sometimes a tap gives a higher rank than it should. One setting, the same for every segment and every multiplier." tag={<SharedTag />}>
        <div className="flex flex-wrap items-start gap-8">
          <label className="flex flex-col gap-1">
            <FieldLabel hint={`(${MIN_TARGET_EV} to ${MAX_TARGET_EV.toFixed(2)})`}>Average value of a tap</FieldLabel>
            <div className="flex items-center gap-2">
              <CommitNumber value={targetEv} min={MIN_TARGET_EV} max={MAX_TARGET_EV} step={0.01} onCommit={(v) => baseList.syncTargetEv(v)} className="w-28" aria-label="Lucky-drop value multiple" data-field="target-ev" />
              <span className="text-sm text-slate-500">× the normal item</span>
            </div>
            <span className="text-[11px] text-slate-400 max-w-[16rem]">1.1 means a tap is worth 10% more than its normal item on average. 1 turns lucky drops off.</span>
          </label>
          <table className="text-sm tabular-nums" data-testid="lucky-probs">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-200">
                <th className="py-2 pr-8">A tap gives</th>
                <th className="py-2 pr-8">Chance</th>
              </tr>
            </thead>
            <tbody>
              {OUTCOMES.map((label, i) => (
                <tr key={label} className="border-b border-slate-100" data-lucky-outcome={i}>
                  <td className="py-1.5 pr-8 text-slate-700">{label}</td>
                  <td className="py-1.5 pr-8 font-semibold text-slate-800">{pctText(probs[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500" data-testid="lucky-start">
          Lucky drops start once the player holds a rank-{t2} item (the rank that opens ×2 for {segName}).
        </p>
      </Section>

      <Section title="Event dates and CC" subtitle="Dates name the export file. CC raises or lowers a board's subsidy before the merge-energy deduction.">
        <div className="flex flex-wrap items-end gap-5">
          {phase === 'main' && (
            <>
              <label className="flex flex-col gap-1">
                <FieldLabel hint="(shared)">Event start date</FieldLabel>
                <input type="date" value={base.eventStartDate ?? ''} onChange={(e) => base.setEventStartDate(e.target.value || null)} className="border border-slate-200 rounded-xl px-2.5 py-1.5 text-sm text-slate-800 bg-white/80" data-field="event-start" />
              </label>
              <label className="flex flex-col gap-1">
                <FieldLabel hint="(shared)">Duration (days)</FieldLabel>
                <CommitNumber value={base.eventDurationDays ?? 7} min={1} max={60} integer onCommit={(v) => base.setEventDurationDays(v)} className="w-20" data-field="event-days" />
              </label>
            </>
          )}
          {activeList.boards.map((b, i) => (
            <label key={b.id} className="flex flex-col gap-1">
              <FieldLabel hint={`(${segName})`}>Board {i + 1} CC %</FieldLabel>
              <CommitNumber value={Math.round((b.ccPercent ?? 0) * 100)} min={-100} max={500} onCommit={(v) => activeList.updateCcPercent(b.id, v / 100)} className="w-20" data-field="cc" />
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Subsidy after CC = the board&apos;s DR × (1 + CC). Leave CC at 0 if you do not use it.</p>
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------- Effort distribution
// Where the player's own DR goes: the share of it spent to get from each rank
// to the next. The economist types a target shape; the search (the board
// editor's own "Effort target") moves each segment's subsidy BETWEEN its
// boards - never changing the segment's total - to get as close as it can.
// The order of items under the tiles is partly random, and it decides how
// much of the subsidy reaches the player - so one generated layout is not a
// fair picture of a split. Several are tried and the one that delivers the
// most subsidy (then costs the player least) is shown, which is also how the
// suggestion below judges a split.
const CURRENT_SPLIT_TRIES = 5
function distributionOf(boards) {
  let best = null
  for (let n = 0; n < CURRENT_SPLIT_TRIES; n++) {
    const built = boards.map((b, i) => regenerateBoard(b, i, b.blockedValue ?? 0, 0.15))
    const result = simulatePlaythrough(built)
    if (!best || result.subsidyDelivered > best.subsidyDelivered || (result.subsidyDelivered === best.subsidyDelivered && result.drSpent < best.drSpent)) best = result
  }
  return best
}

export function EffortStep({ segments, activeSeg, activeSegmentIndex, onSelectSegment, phase, phaseLabel, listOf, targetPctInputs, onTargetPctInputsChange }) {
  const [progress, setProgress] = useState(null)
  const [suggestion, setSuggestion] = useState(null)
  const [current, setCurrent] = useState(null)
  const segName = (seg, i) => seg.name || `Segment ${i + 1}`
  const budgetsOf = (seg) => listOf(seg).boards.map((b) => b.blockedValue ?? 0)
  const stateKey = JSON.stringify([phase, segments.map((seg) => [budgetsOf(seg), listOf(seg).boards.map((b) => [b.tiles, b.minRank, b.maxRank])])])
  const activeBoards = listOf(activeSeg).boards
  const activeTotal = sum(budgetsOf(activeSeg))
  const target = Object.fromEntries(RANKS.map((r) => [r, Math.max(0, Number(targetPctInputs?.[r]) || 0)]))
  const targetTotal = sum(Object.values(target))
  const hasTarget = targetTotal > 0
  const withAmount = segments.map((seg, i) => ({ seg, i })).filter(({ seg }) => sum(budgetsOf(seg)) > 0)

  // The distribution of the current split is only valid for the boards it
  // was computed from.
  const currentShown = current && current.key === stateKey && current.segment === activeSegmentIndex ? current : null
  const suggestionFresh = suggestion && (suggestion.key === stateKey || suggestion.appliedKey === stateKey)
  const applied = !!suggestion && suggestion.appliedKey === stateKey

  function showCurrent() {
    setCurrent({ key: stateKey, segment: activeSegmentIndex, result: distributionOf(activeBoards) })
  }

  async function suggest() {
    setSuggestion(null)
    const items = []
    for (let n = 0; n < withAmount.length; n++) {
      const { seg, i } = withAmount[n]
      setProgress(`${segName(seg, i)} (${n + 1} of ${withAmount.length})`)
      await tick(30)
      const boards = listOf(seg).boards
      const result = boards.length > 1 ? suggestBoardValuesForEffortTarget(boards, target, { firstBoardCap: FIRST_BOARD_SUBSIDY_CAP_DR }) : null
      items.push({ index: i, name: segName(seg, i), before: budgetsOf(seg), result })
    }
    setSuggestion({ key: stateKey, items })
    setProgress(null)
  }

  function apply() {
    for (const item of suggestion.items) {
      if (!item.result) continue
      const list = listOf(segments[item.index])
      list.boards.forEach((b, i) => {
        const value = item.result.suggestedValues[i]
        if ((b.blockedValue ?? 0) !== value) list.updateBoard({ ...b, blockedValue: value, effectiveBlockedValue: null })
      })
    }
    // The key the boards will have once these budgets are written.
    const after = JSON.stringify([
      phase,
      segments.map((seg, si) => {
        const item = suggestion.items.find((x) => x.index === si && x.result)
        return [item ? item.result.suggestedValues : budgetsOf(seg), listOf(seg).boards.map((b) => [b.tiles, b.minRank, b.maxRank])]
      }),
    ])
    setSuggestion({ ...suggestion, appliedKey: after })
  }

  const activeItem = suggestionFresh ? suggestion.items.find((x) => x.index === activeSegmentIndex) : null
  const achieved = activeItem?.result ? buildSimulationRows(activeItem.result.result) : null

  return (
    <div className="flex flex-col gap-4">
      <Section
        first
        title="The effort shape"
        subtitle={`Where the player's own DR goes: the share of it spent to climb from each rank to the next - ${phaseLabel.toLowerCase()} phase.`}
        tag={<SharedTag />}
      >
        <p className="text-xs text-slate-500 max-w-3xl mb-3" data-testid="effort-scope">
          Type the shape you want - for example 2 for the early ranks and 30 for rank 12; only the proportions matter. The build then picks the boards closest to it. You can
          also let the tool move each segment&apos;s subsidy between its boards first: a segment&apos;s total never changes, and Board 1 stays within {FIRST_BOARD_SUBSIDY_CAP_DR} DR.
          That search looks at the main-chain items only; the build adds the reward items and shows the final distribution of what it built. Leave it empty to keep the split
          from step 1.
        </p>
        <div className="flex flex-wrap gap-2" data-testid="effort-target">
          {RANKS.map((rank) => (
            <label key={rank} className="flex flex-col items-center gap-1">
              <span className="w-9 h-7 grid place-items-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: colorForRank(rank) }}>
                {rank}
              </span>
              <input
                type="number"
                min={0}
                value={targetPctInputs?.[rank] ?? ''}
                onChange={(e) => onTargetPctInputsChange((prev) => ({ ...prev, [rank]: e.target.value }))}
                className="w-14 border border-slate-200 rounded-lg px-1.5 py-1 text-sm text-center tabular-nums bg-white/80"
                placeholder="%"
                aria-label={`Target share of effort for rank ${rank}`}
                data-effort-rank={rank}
              />
              <span className="text-[10px] text-slate-400 tabular-nums h-3">{hasTarget && target[rank] > 0 ? `${Math.round((target[rank] / targetTotal) * 100)}%` : ''}</span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={Wand2} onClick={suggest} disabled={!hasTarget || withAmount.length === 0 || progress != null} data-testid="effort-suggest">
            {progress ? `Searching: ${progress}` : `Suggest the board split for ${withAmount.length} segment${withAmount.length === 1 ? '' : 's'}`}
          </Button>
          <Button variant="secondary" icon={LineChart} onClick={showCurrent} disabled={activeTotal <= 0 || progress != null} data-testid="effort-current">
            Show the distribution of the current split
          </Button>
          {!hasTarget && <span className="text-xs text-slate-400">Type at least one number above to get a suggestion.</span>}
          {withAmount.length === 0 && <span className="text-xs text-amber-700">No segment has a DR demand yet - type them in step 1.</span>}
        </div>
      </Section>

      {currentShown && (
        <Section title={`Current split: ${segName(activeSeg, activeSegmentIndex)}`} subtitle={`Boards hold ${budgetsOf(activeSeg).join(' / ')} DR. The best of ${CURRENT_SPLIT_TRIES} generated layouts - the order of items under the tiles is partly random.`} tag={<SegmentTag />}>
          <div className="mb-3 text-sm text-slate-600" data-testid="effort-current-summary">
            The player spends <span className="font-semibold">{dr(currentShown.result.drSpent)}</span> of their own to{' '}
            {currentShown.result.reachedAt[MAX_RANK] !== undefined ? `reach rank ${MAX_RANK}` : `get as far as rank ${currentShown.result.maxRankReached}`}. {dr(currentShown.result.subsidyDelivered)} of{' '}
            {dr(currentShown.result.subsidyConfigured)} subsidy reaches them, over {currentShown.result.boardsReached} of {currentShown.result.boardsTotal} boards.
          </div>
          <EffortDistributionChart result={currentShown.result} subtitle={CHART_CAPTION} />
        </Section>
      )}

      {suggestion && !suggestionFresh && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="effort-stale">
          The boards changed since the last suggestion, so it was put aside. Run it again.
        </div>
      )}

      {suggestionFresh && (
        <Section
          title="Suggested split"
          subtitle="Each segment keeps its total; only how it is divided between the boards changes."
          tag={applied ? <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1"><Check size={13} /> Applied</span> : <SegmentTag />}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" data-testid="effort-suggestion">
              <thead>
                <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-200">
                  <th className="py-2 pr-4">Segment</th>
                  <th className="py-2 pr-4">Boards now (DR)</th>
                  <th className="py-2 pr-4">Suggested (DR)</th>
                  <th className="py-2 pr-4">Player spends</th>
                  <th className="py-2 pr-4">Notes</th>
                </tr>
              </thead>
              <tbody>
                {suggestion.items.map((item) => (
                  <tr key={item.index} className={`border-b border-slate-100 cursor-pointer ${item.index === activeSegmentIndex ? 'bg-purple-50/60' : 'hover:bg-slate-50'}`} onClick={() => onSelectSegment(item.index)} data-effort-segment={item.index}>
                    <td className="py-1.5 pr-4 font-semibold text-slate-700 whitespace-nowrap">{item.name}</td>
                    <td className="py-1.5 pr-4">{item.before.join(' / ')}</td>
                    <td className="py-1.5 pr-4 font-semibold text-purple-800" data-cell="suggested">
                      {item.result ? item.result.suggestedValues.join(' / ') : '—'}
                    </td>
                    <td className="py-1.5 pr-4">{item.result ? dr(item.result.result.drSpent) : '—'}</td>
                    <td className="py-1.5 pr-4 text-xs text-slate-500">
                      {!item.result
                        ? 'Only one board, so there is nothing to move between boards.'
                        : [
                            item.result.reachedMaxRank ? null : `the playthrough stops before rank ${MAX_RANK}`,
                            item.result.strandedIssue ? `${Math.round(item.result.strandedDr)} DR of subsidy would never reach the player` : null,
                            item.result.issues > (item.result.strandedIssue ? 1 : 0) ? 'a board would not fit its tiles exactly' : null,
                          ]
                            .filter(Boolean)
                            .join('; ') ||
                          (item.result.suggestedValues.join('/') === item.before.join('/')
                            ? `no change - this is already the closest split${item.before.length === 2 ? ' (with two boards and Board 1 at its limit there is little to move)' : ''}`
                            : 'fits')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="primary" icon={Check} onClick={apply} disabled={applied || !suggestion.items.some((x) => x.result)} data-testid="effort-apply">
              {applied ? 'Split applied' : 'Use this split'}
            </Button>
            <span className="text-xs text-slate-500">
              {applied ? 'The board amounts in step 1 now hold this split. The build uses them.' : 'This changes the board amounts in step 1. Nothing is built yet.'}
            </span>
          </div>
          {achieved && (
            <div className="mt-4" data-testid="effort-achieved">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{activeItem.name}: what you asked for and what the suggestion gives (share of effort per rank)</div>
              <div className="flex flex-wrap gap-2 mb-3">
                {achieved.map((row) => (
                  <div key={row.rank} className="flex flex-col items-center gap-0.5 text-[11px] tabular-nums">
                    <span className="w-9 h-6 grid place-items-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: colorForRank(row.rank) }}>
                      {row.rank}
                    </span>
                    <span className="text-slate-400">{hasTarget ? `${Math.round((target[row.rank] / targetTotal) * 100)}%` : '—'}</span>
                    <span className="font-semibold text-slate-700">{row.pctOfEffort != null ? `${Math.round(row.pctOfEffort)}%` : '—'}</span>
                  </div>
                ))}
                <div className="flex flex-col justify-end gap-0.5 text-[11px] text-slate-400 pl-1">
                  <span>asked</span>
                  <span className="font-semibold text-slate-600">gets</span>
                </div>
              </div>
              <EffortDistributionChart result={activeItem.result.result} subtitle={CHART_CAPTION} />
            </div>
          )}
        </Section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Build review: the boards and the effort they give
const itemLabel = (value) => {
  const reward = decodeReward(value)
  return reward ? `${REWARD_TYPE_LABELS[reward.type]} R${reward.rank}` : String(value)
}

// What a built segment's boards hold, as the editor shows a board: the grid
// with its semi-blocked items, and the blocked queue in the order tiles open.
export function BuiltBoards({ boards }) {
  return (
    <div className="flex flex-wrap gap-5" data-testid="built-boards">
      {boards.map((b, i) => (
        <div key={b.id ?? i} className="min-w-0" data-built-board={i}>
          <div className="text-xs font-semibold text-slate-600 mb-1.5">{b.name || `Board ${i + 1}`}</div>
          <BoardGrid tiles={b.tiles} placements={b.semiPlacements} />
          <div className="mt-2 max-w-[26rem]">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Blocked queue ({b.blockedQueue?.length ?? 0}) - first to open on the left</div>
            <div className="flex flex-wrap gap-1" data-cell="queue">
              {(b.blockedQueue ?? []).map((value, qi) => {
                const reward = decodeReward(value)
                return (
                  <span
                    key={qi}
                    className={`px-1.5 h-6 min-w-6 grid place-items-center rounded-md text-[11px] font-bold ${reward ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'text-white'}`}
                    style={reward ? undefined : { backgroundColor: colorForRank(Math.min(value, MAX_RANK)) }}
                    title={reward ? `Reward item: ${itemLabel(value)}` : `Rank ${value}`}
                  >
                    {itemLabel(value)}
                  </span>
                )
              })}
              {(b.blockedQueue ?? []).length === 0 && <span className="text-xs text-slate-400">empty</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// Recompletion's effort: what the player pays in Recompletion, rank by rank,
// from rank 1 to 14 - the DR paid since Recompletion began when they first
// MAKE an item of each rank there (by a merge or from the generator). What
// they carry in from the normal event, the rank 12 among them, is not made
// there, so the second rank 12 - and then 13 and 14 - show what they cost.
function BuiltRcEffort({ result }) {
  const rc = result.rcEffort
  if (!rc) {
    return (
      <p className="text-sm text-amber-700" data-testid="built-effort" data-phase="rc">
        In this playthrough the player never reaches rank {MAX_RANK}, so Recompletion never begins and has no effort to show.
      </p>
    )
  }
  const stats = result.rcPhase
  const top = RC_RANKS.at(-1)
  const rows = buildClimbRows(rc, RC_RANKS)
  const aside = rows.filter((row) => row.aside).map((row) => row.rank)
  return (
    <div data-testid="built-effort" data-phase="rc">
      <p className="mb-3 text-xs text-slate-500" data-note>
        Counted from the moment Recompletion begins: for each rank, the DR the player has paid in Recompletion when they first make an item of it there - by a merge or
        from the generator. The rank {MAX_RANK} they bring from the normal event does not count, so rank {MAX_RANK} here is the second one they make. A rank&apos;s cost is
        what was paid since the last rank climbed to before it.{aside.length > 0 ? ` Rank${aside.length === 1 ? '' : 's'} ${aside.join(', ')} ${aside.length === 1 ? 'was' : 'were'} first made after a higher rank, so ${aside.length === 1 ? 'it is' : 'they are'} not part of the climb and ${aside.length === 1 ? 'has' : 'have'} no cost.` : ''}
      </p>
      <div className="mb-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Player spends in Recompletion</div>
          <div className="font-display font-semibold text-slate-700 tabular-nums" data-cell="dr-spent">{dr(rc.drSpent)}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Subsidy that reaches them</div>
          <div className="font-display font-semibold text-slate-700 tabular-nums">{stats ? `${dr(stats.subsidyDelivered)} of ${dr(stats.subsidyConfigured)}` : '—'}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Boards reached</div>
          <div className="font-display font-semibold text-slate-700 tabular-nums">{stats ? `${stats.boardsReached} of ${stats.boardsTotal}` : '—'}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Rank {top}</div>
          <div className="font-display font-semibold text-slate-700" data-cell="rc-top">{rc.reachedAt[top] !== undefined ? `at ${dr(rc.reachedAt[top])}` : 'not reached'}</div>
        </div>
      </div>
      <EffortDistributionChart
        result={rc}
        rows={rows}
        ranks={RC_RANKS}
        title="Effort distribution - Recompletion"
        subtitle={`${CHART_CAPTION} - in Recompletion only`}
        footnote="DR, +DR and Taps use a log scale; % effort is linear and adds up to 100% at rank 14. A dash is a rank never made, or one that is not part of the climb. Hover any bar for its exact value."
      />
    </div>
  )
}

// The effort distribution of a built segment: one deterministic playthrough
// of exactly the boards the build produced.
export function BuiltEffort({ boards, mainBoards = null, cacheKey }) {
  const result = useMemo(() => {
    if (!boards?.length) return null
    const b0 = boards[0]
    try {
      if (mainBoards) return simulatePlaythrough(mainBoards, { dropMode: 'expected', rcBoards: boards })
      return simulatePlaythrough(boards, { dropMode: 'expected', rewardChainConfig: b0.rewardChainConfig, dropGroupsConfig: b0.dropGroupsConfig, dropGroupsById: new Map((b0.dropGroups ?? []).map((g) => [g.id, g])), minDropRank: b0.minDropRank })
    } catch {
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey])
  if (!result) return null
  // Recompletion: its own climb, counted from the moment it begins (economist:
  // "i want to be able to see the effort distribution on the RC also"). The
  // whole run's chart showed only ranks 1-12, all reached in the normal event.
  if (mainBoards) return <BuiltRcEffort result={result} />
  return (
    <div data-testid="built-effort">
      <div className="mb-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Player spends</div>
          <div className="font-display font-semibold text-slate-700 tabular-nums" data-cell="dr-spent">{dr(result.drSpent)}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Subsidy that reaches them</div>
          <div className="font-display font-semibold text-slate-700 tabular-nums">
            {dr(result.subsidyDelivered)} of {dr(result.subsidyConfigured)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Boards reached</div>
          <div className="font-display font-semibold text-slate-700 tabular-nums">
            {result.boardsReached} of {result.boardsTotal}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Rank {MAX_RANK}</div>
          <div className="font-display font-semibold text-slate-700">{result.reachedAt[MAX_RANK] !== undefined ? `at ${dr(result.reachedAt[MAX_RANK])}` : 'not reached'}</div>
        </div>
      </div>
      <EffortDistributionChart result={result} subtitle={CHART_CAPTION} />
    </div>
  )
}
