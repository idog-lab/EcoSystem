import { useEffect, useRef, useState } from 'react'
import { Hammer, Square, TriangleAlert, CircleCheck, FlaskConical, Check, Undo2, Download, Gamepad2, Wrench } from 'lucide-react'
import Button from '../../../../components/ui/Button'
import { StatusChip, SharedTag, SegmentTag, Panel, CheckLine, LinkButton, Collapsible, ProgressBar } from './buildUi'
import BuildSummary from './BuildSummary'
import { REWARD_TYPES, REWARD_TARGET_LABELS, REWARD_TYPE_LABELS, COIN_TYPE, formatRewardAmount } from '../../lib/rewards/rewardChain'
import { allowedRewardRanks } from '../../lib/rewards/rewardPlacement'
import { buildEvent, buildReadiness, boardsWithDraftApplied, draftSegmentIsApplied, mainChainSum, validateDraftSegment, rcInputsOnMainDraft, draftIsUsable, INPUT_PART_LABELS, MAX_PASSES, DEFAULT_VALIDATION_RUNS, DEFAULT_VALIDATION_SEED, DEDUCTION_POLICY } from '../../lib/build/eventBuild'
import { ExportGate } from './DesignStatus'
import TwisterTimingPanel from './TwisterTimingPanel'
import { offTargetToleranceFor } from '../../lib/rewards/smallRewardsWorkflow'
import { invalidateLayout } from '../../lib/core/board'
import { setRankWindow } from '../../lib/core/layoutEdits'
import { spreadSubsidy } from '../../lib/core/subsidyBudget'
import { BuiltBoards, BuiltEffort, EffortStep } from './BuildEventSteps'
import { buildAllSegmentsWorkbook } from '../../lib/export/eventSheets'
import { EndlessPreview } from '../play/EndlessMode'
import ContainersTable from './ContainersTable'

const dr = (v) => (v == null || !Number.isFinite(v) ? '—' : `${Math.round(v).toLocaleString()} DR`)
// Exact to one decimal - used wherever a figure is not a whole number, so a
// rounded value is never shown as if it were exact.
const dr1 = (v) => (v == null || !Number.isFinite(v) ? '—' : `${(Math.round(v * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(Math.round(v * 10) / 10) ? 0 : 1, maximumFractionDigits: 1 })} DR`)
const signed1 = (v) => `${v > 0.04 ? '+' : v < -0.04 ? '−' : ''}${Math.abs(Math.round(v * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })} DR`
const pct = (v) => (v == null ? '—' : `${Math.round(v)}%`)
// What a segment's result is called - plain words, by explicit economist
// feedback ("I don't know those words"):
//   Ready            - everything asked for was met (rewards within the margin).
//   Can be improved  - built and usable, but something is outside what was
//                      asked for; it comes with quick fixes.
//   Needs a fix      - something asked for does not fit, so it cannot be applied.
//   Not built        - the segment has no amount.
// A build whose merge-energy figure was still moving by a DR or two between
// passes, with nothing else to report, is simply Ready.
function segmentChip(seg) {
  if (seg.status === 'skipped') return { kind: 'none', label: 'Not built' }
  if (seg.status === 'infeasible') return { kind: 'infeasible', label: 'Needs a fix' }
  if (seg.status === 'review' && (seg.causes?.length ?? 0) > 0) return { kind: 'review', label: 'Can be improved' }
  return { kind: 'applied', label: 'Ready' }
}


// Each problem with what to do about it: one-click quick fixes where the
// build could work one out, and a link to the input otherwise. A fix changes
// an input, so the result only shows after a rebuild.
function CauseList({ causes, goTo, onFix, fixedIds, onRebuild }) {
  if (!causes?.length) return null
  const anyFixed = causes.some((c) => (c.fixes ?? []).some((f) => fixedIds?.has(f.id)))
  return (
    <div className="flex flex-col gap-2" data-testid="build-causes">
      {anyFixed && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 flex flex-wrap items-center gap-3" data-testid="fixes-applied">
          <span className="flex-1 min-w-[14rem]">Quick fix applied. The numbers below are still from before it - rebuild to see the result.</span>
          {onRebuild && (
            <Button variant="primary" size="sm" icon={Hammer} onClick={onRebuild} data-testid="fixes-rebuild">
              Rebuild now
            </Button>
          )}
        </div>
      )}
      {causes.map((c, i) => (
        <div key={`${c.code}-${i}`} className="rounded-2xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900" data-cause={c.code}>
          <div className="font-semibold flex items-center gap-1.5">
            <TriangleAlert size={14} className="shrink-0" /> {c.title}
          </div>
          <div className="text-xs mt-0.5">{c.detail}</div>
          {(c.fixes ?? []).length > 0 && onFix && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2" data-cause-fixes={c.code}>
              <span className="text-xs font-semibold text-amber-900 flex items-center gap-1">
                <Wrench size={12} /> Quick fix:
              </span>
              {c.fixes.map((f) => {
                const done = fixedIds?.has(f.id)
                return (
                  <Button key={f.id} variant="secondary" size="sm" icon={done ? Check : undefined} disabled={done} onClick={() => onFix(f)} data-quick-fix={f.kind}>
                    {done ? `Done: ${f.label}` : f.label}
                  </Button>
                )
              })}
            </div>
          )}
          <div className="text-xs mt-1 flex flex-wrap items-center gap-2">
            <span className="text-amber-800/80">{(c.fixes ?? []).length > 0 ? 'Or do it yourself' : 'What to do'}: {c.action}.</span>
            <LinkButton onClick={() => goTo(c.step)} data-cause-link={c.step}>
              Take me there
            </LinkButton>
          </div>
        </div>
      ))}
    </div>
  )
}

// The review of ONE built segment: concise first, detail on demand.
// THE SAME EVENT, PLAYED THREE WAYS. What a player collects depends on what
// they do with a reward item - merge it on, or tap it to collect it - and the
// build sizes the rewards for the first. The other two are played as well so
// the economist sees, before a link is sent, what a friend who taps would end
// up with (economist: "he ended up with crazy rewards from the small rewards").
const PLAY_STYLE_LABEL = {
  merge: { name: 'Merges every reward item', note: 'the player the build sizes for' },
  careless: { name: 'Merges without looking', note: 'merges free items with each other while a semi-blocked one of their rank waits' },
  best: { name: 'Taps an item when that pays more than merging', note: 'the most a player can make of the same drops' },
  all: { name: 'Taps every reward item as it lands', note: 'never merges a reward' },
}
function PlayStylesPanel({ v, segmentName, phase, goTo }) {
  const targeted = v.resources.filter((r) => r.target > 0).map((r) => r.type)
  const merge = v.styles.find((st) => st.id === 'merge')
  const best = v.styles.find((st) => st.id === 'best')
  const all = v.styles.find((st) => st.id === 'all')
  const pctOf = (style, type) => {
    const r = style.resources.find((x) => x.type === type)
    return r && r.target > 0 ? (r.mean / r.target) * 100 : null
  }
  const most = (style) => Math.max(0, ...targeted.map((t) => pctOf(style, t) ?? 0))
  const tolerance = (phase === 'rc' ? 25 : 15) + 100
  const over = (style) => !!style && !style.sameAsMerge && most(style) > Math.max(tolerance, most(merge) + 10)
  const tapNames = [...new Set((v.tapPays ?? []).map((x) => x.type))].map((type) => `${REWARD_TARGET_LABELS[type]} (rank ${v.tapPays.filter((x) => x.type === type).map((x) => x.rank).join(' and ')})`)
  const moreDr = all && merge.drSpent > 0 ? all.drSpent / merge.drSpent : 1
  const careless = v.styles.find((st) => st.id === 'careless')
  const carelessDr = careless && merge.drSpent > 0 ? careless.drSpent / merge.drSpent : 1
  const carelessMore = careless ? Math.max(0, ...targeted.map((t) => (pctOf(careless, t) ?? 0) - (pctOf(merge, t) ?? 0))) : 0
  // The status is about the second player: can a tap beat a merge? (The third
  // gets more for another reason - they spend more DR - said below the table.)
  const anyOver = over(best)
  return (
    <Collapsible
      id={`finalize-styles-${phase}`}
      className="xl:open:col-span-3"
      title={`The same event, played by different players: ${segmentName}`}
      summary="The careful player the build is sized for, one who merges without looking, one who taps when it pays, and one who taps everything."
      tag={<StatusChip kind={anyOver ? 'review' : 'validated'}>{anyOver ? 'Tapping pays more' : 'Merging pays best'}</StatusChip>}
      openWhen={anyOver || tapNames.length > 0}
    >
      <p className="mb-3 text-xs text-slate-500">{`What a player ends up with depends on how they play: whether they open the semi-blocked items first, and whether they merge a reward item on or tap it. The build sizes the rewards for a careful player who merges; the others are played on ${v.styleRuns} to ${Math.max(v.styleRuns, 100)} simulated players each.`}</p>
      <table className="w-full text-sm tabular-nums" data-testid="play-styles">
        <thead>
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            <th className="py-1 pr-3">Player</th>
            {targeted.map((t) => (
              <th key={t} className="py-1 pr-3">
                {REWARD_TARGET_LABELS[t]}
              </th>
            ))}
            <th className="py-1 pr-3">DR spent</th>
          </tr>
        </thead>
        <tbody>
          {v.styles.map((style) => (
            <tr key={style.id} className="border-t border-slate-100 align-top" data-style={style.id} data-same={style.sameAsMerge ? 'yes' : 'no'}>
              <td className="py-1 pr-3">
                <div className="font-semibold text-slate-700">{PLAY_STYLE_LABEL[style.id].name}</div>
                <div className="text-[11px] text-slate-500">{style.sameAsMerge ? 'with these rank values a tap never pays more than a merge: the same as the row above' : PLAY_STYLE_LABEL[style.id].note}</div>
              </td>
              {targeted.map((t) => {
                const p = pctOf(style, t)
                const r = style.resources.find((x) => x.type === t)
                const high = style.id !== 'merge' && !style.sameAsMerge && p != null && p > Math.max(tolerance, (pctOf(merge, t) ?? 0) + 10)
                return (
                  <td key={t} className="py-1 pr-3" data-reward={t}>
                    <span className={`font-semibold ${high ? 'text-amber-700' : 'text-slate-700'}`} data-field="pct">
                      {p == null ? '-' : `${Math.round(p)}%`}
                    </span>{' '}
                    <span className="text-xs text-slate-500" data-field="amount">
                      {formatRewardAmount(t, r?.mean ?? 0)}
                    </span>
                  </td>
                )
              })}
              <td className="py-1 pr-3" data-field="dr">
                {dr(style.drSpent)}
                {style.id !== 'merge' && merge.drSpent > 0 && style.drSpent > merge.drSpent * 1.25 && <span className="ml-1 text-xs text-amber-700">{(style.drSpent / merge.drSpent).toFixed(1)}×</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-slate-500">Each number is what that player collects, as a share of the amount you asked for. Checked against a robot playing the real play screen.</p>
      {tapNames.length > 0 && (
        <div className="mt-2 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800" data-testid="play-styles-tap">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          <span className="flex-1">
            With these rank values a tap pays more than a merge for {tapNames.join(', ')}: the item is worth more per piece there than a rank 4 is. A player who notices gets the second row. Let the build give
            the rank values (step 3: &quot;The build may change a reward&apos;s rank values&quot;) - its values always reward merging - or fix them there yourself, and the first two rows become the same.{' '}
            {goTo && (
              <LinkButton className="text-xs" onClick={() => goTo('rewards')}>
                Go to step 3
              </LinkButton>
            )}
          </span>
        </div>
      )}
      {careless && (carelessDr > 1.1 || carelessMore > 5) && (
        <p className="mt-2 text-xs text-slate-600" data-testid="play-styles-careless">
          The player who merges without looking spends about {carelessDr.toFixed(1)}× the DR and collects up to {Math.round(carelessMore)} points more of a reward: an item still semi-blocked when the top rank is
          made is subsidy that was never used, so they pay for it in DR and merge more on the way. It shows most in a segment that gets a lot of subsidy. Real players fall between the first two rows.
        </p>
      )}
      {all && moreDr > 1.25 && (
        <p className="mt-2 text-xs text-slate-600" data-testid="play-styles-dr">
          The player who taps everything spends about {moreDr.toFixed(1)}× the DR: a reward under a tile only opens when a matching item is merged into it, so their board never clears and the next boards, with their
          subsidy, never arrive. In the game that costs them DR. On a shared play link taps are free, so nothing stops them - that is how a run on a link can end with far more than the amounts above.
        </p>
      )}
    </Collapsible>
  )
}


// (What there is to look at - the causes with their quick fixes - is shown above the folded details, by the Build step.)
function SegmentReview({ seg, appliedBoards }) {
  const phase = seg.phase ?? 'main'
  const MARGIN_PCT = Math.round(offTargetToleranceFor(phase) * 100)
  const sub = seg.subsidy
  const rec = seg.reconciliation
  const anyTarget = seg.resources.some((r) => r.target > 0)
  return (
    <div className="flex flex-col gap-4" data-testid="segment-review">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-100 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Small rewards: asked for and expected</div>
          {!anyTarget ? (
            <p className="text-sm text-slate-500">No reward target for this segment - the boards were built with main-chain items only.</p>
          ) : (
            <table className="w-full text-sm tabular-nums" data-testid="review-resources">
              <thead>
                <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="py-1 pr-3">Resource</th>
                  <th className="py-1 pr-3">You asked for</th>
                  <th className="py-1 pr-3">Expected</th>
                  <th className="py-1 pr-3">Under tiles</th>
                  <th className="py-1 pr-3">From merge drops</th>
                </tr>
              </thead>
              <tbody>
                {seg.resources
                  .filter((r) => r.target > 0)
                  .map((r) => {
                    const off = Math.abs(r.diff) > r.target * offTargetToleranceFor(phase)
                    return (
                      <tr key={r.type} className="border-t border-slate-100" data-resource={r.type}>
                        <td className="py-1 pr-3 font-semibold text-slate-700">
                          {REWARD_TARGET_LABELS[r.type]}
                          {r.type === COIN_TYPE && <span className="ml-1 text-[10px] font-normal text-amber-700">× allowance</span>}
                        </td>
                        <td className="py-1 pr-3" data-cell="requested">
                          {formatRewardAmount(r.type, r.target)}
                        </td>
                        <td className={`py-1 pr-3 font-semibold ${off ? 'text-amber-700' : 'text-emerald-700'}`} data-cell="predicted">
                          {formatRewardAmount(r.type, r.predicted)}
                          {!r.exactlyPayable && <div className="text-[10px] font-normal text-slate-400">closest payable {formatRewardAmount(r.type, r.feasiblePayout)}</div>}
                        </td>
                        <td className="py-1 pr-3" data-cell="tile">
                          {formatRewardAmount(r.type, r.tile)}
                          <div className="text-[10px] text-slate-400">
                            {pct(r.achievedTilePct)}
                            {r.requestedTilePct != null && ` (asked ${pct(r.requestedTilePct)})`}
                          </div>
                        </td>
                        <td className="py-1 pr-3" data-cell="drop">
                          {formatRewardAmount(r.type, r.drop)}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          )}
          {seg.coinValues && (
            <p className="mt-2 text-xs text-slate-600" data-testid="review-coin-values">
              Coin ranks 1 to 4 are worth <span className="font-semibold">{seg.coinValues.values.map((v) => formatRewardAmount(COIN_TYPE, v)).join(' / ')}</span> × allowance in this
              segment. The build set these so the coin target is met with the merge drops every segment shares.
            </p>
          )}
          {seg.dropsFixed && anyTarget && (
            <p className="mt-2 text-[11px] text-slate-400">Merge drops are shared with the base segment, so this segment has no split of its own: its tile items make up the difference.</p>
          )}
          <p className="mt-2 text-[11px] text-slate-500" data-testid="review-margin">
            A reward counts as met when the expected amount is within {MARGIN_PCT}% of what you asked for (green). Outside that it is shown in amber, with a fix.
            Expected = the average of {seg.evaluation?.runs ?? '—'} simulated players.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-100 p-4" data-testid="review-subsidy">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">DR on the boards</div>
          <table className="w-full text-sm tabular-nums">
            <tbody>
              <tr>
                <td className="py-0.5 pr-3 text-slate-500">DR you gave the boards</td>
                <td className="py-0.5 text-right font-semibold text-slate-700" data-cell="budget">
                  {dr1(rec.budget)}
                </td>
              </tr>
              <tr>
                <td className="py-0.5 pr-3 text-slate-500">After CC{sub.firstBoardCapped ? ' (Board 1 limited to 150)' : ''}</td>
                <td className="py-0.5 text-right text-slate-700" data-cell="after-cc">
                  {dr1(rec.afterCc)}
                </td>
              </tr>
              <tr>
                <td className="py-0.5 pr-3 text-slate-500">Merge energy the player collects</td>
                <td className="py-0.5 text-right text-slate-700" data-cell="energy">
                  {(Math.round(rec.energyCollected * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                </td>
              </tr>
              <tr>
                <td className="py-0.5 pr-3 text-slate-500">Taken off for it (80%)</td>
                <td className="py-0.5 text-right text-slate-700" data-cell="credit">
                  − {dr1(rec.creditCalculated)}
                </td>
              </tr>
              {seg.demandFit?.calibrated && (
                <tr>
                  <td className="py-0.5 pr-3 text-slate-500">{seg.demandFit.calibration >= 0 ? 'Taken off so the player pays the demand' : 'Added so the player pays the demand'}</td>
                  <td className="py-0.5 text-right text-slate-700" data-cell="calibration" data-sign={seg.demandFit.calibration >= 0 ? 'off' : 'on'}>
                    {seg.demandFit.calibration >= 0 ? '−' : '+'} {dr1(Math.abs(seg.demandFit.calibration))}
                  </td>
                </tr>
              )}
              <tr className="border-t border-slate-200">
                <td className="py-0.5 pr-3 text-slate-600">DR to place under tiles</td>
                <td className="py-0.5 text-right font-semibold text-slate-700" data-cell="unrounded">
                  {dr1(rec.unroundedTarget)}
                </td>
              </tr>
              <tr>
                <td className="py-0.5 pr-3 text-slate-700 font-semibold">DR placed under tiles</td>
                <td className="py-0.5 text-right font-bold text-purple-700" data-cell="effective">
                  {dr1(rec.generatedDr)}
                </td>
              </tr>
              <tr>
                <td className="py-0.5 pr-3 text-slate-600">Difference (placed − to place)</td>
                <td className={`py-0.5 text-right font-semibold ${Math.abs(rec.residual) > 4 ? 'text-amber-700' : 'text-slate-700'}`} data-cell="residual">
                  {signed1(rec.residual)}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-600" data-testid="review-dr-summary">
            {Math.abs(rec.residual) < 0.05
              ? 'The boards hold exactly the DR worked out above.'
              : `The boards hold ${Math.abs(Math.round(rec.residual * 10) / 10)} DR ${rec.residual > 0 ? 'more' : 'less'} than the exact figure - a board can only hold whole item values.`}
            {!seg.converged && ' The merge-energy figure was still moving slightly between build passes.'}
          </p>
          {seg.demandFit?.paid && (
            <div className={`mt-2 rounded-xl border px-3 py-2 text-xs ${(seg.demandFit.inMargin ?? seg.demandFit.within) ? 'border-emerald-200 bg-emerald-50/60 text-slate-700' : 'border-amber-200 bg-amber-50/60 text-amber-800'}`} data-testid="review-demand" data-within={seg.demandFit.within ? 'yes' : 'no'} data-passes={(seg.demandFit.inMargin ?? seg.demandFit.within) ? 'yes' : 'no'}>
              <div className="font-semibold">What the player pays in this phase{seg.phase === 'rc' ? ' (counted from the moment Recompletion begins)' : ''}</div>
              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 tabular-nums">
                <span>DR demand you typed</span>
                <span className="text-right font-semibold" data-cell="demand">{dr(seg.demandFit.configured)}</span>
                <span>Average player pays</span>
                <span className="text-right font-semibold" data-cell="paid">{dr(Math.round(seg.demandFit.paid.mean))}</span>
                <span>Middle player pays</span>
                <span className="text-right" data-cell="paid-median">{dr(Math.round(seg.demandFit.paid.p50))}</span>
                <span>Difference</span>
                <span className="text-right" data-cell="demand-difference">
                  {signed1(seg.demandFit.difference)} ({seg.demandFit.differencePct >= 0 ? '+' : ''}
                  {seg.demandFit.differencePct.toFixed(1)}%)
                </span>
                <span>Finish the phase</span>
                <span className="text-right">{seg.demandFit.completionRate == null ? '—' : pct(seg.demandFit.completionRate * 100)}</span>
              </div>
              <p className="mt-1 text-[11px]">
                {seg.demandFit.calibration >= 0
                  ? `The build took ${dr1(seg.demandFit.calibration)} more off the later boards`
                  : `The build put ${dr1(Math.abs(seg.demandFit.calibration))} back on the later boards`}{' '}
                (besides the merge-energy 80%) until the average of {seg.demandFit.players} simulated players paid the demand. Those players all have average luck; step 5 shows the spread with real luck.
                {seg.demandFit.constraint === 'no-subsidy-left' && ' A proven limit: the later boards have no more subsidy to give within their rank limits, so the player cannot be made to pay more.'}
                {seg.demandFit.constraint === 'boards-full' && ' A proven limit: the later boards hold all the subsidy their tiles can, so the player cannot be made to pay less.'}
                {seg.demandFit.constraint === 'not-settled' && !seg.demandFit.jump && ' Not a limit: the search did not settle closer than this in its passes; building again usually does.'}
                {seg.demandFit.constraint === 'not-settled' &&
                  seg.demandFit.jump &&
                  ` Not a limit of the boards - the spend moves in jumps here: two sets of boards with almost the same subsidy (${dr(Math.round(seg.demandFit.jump.subsidyApart))} apart) had the player pay ${dr(Math.round(seg.demandFit.jump.paidUnder))} and ${dr(Math.round(seg.demandFit.jump.paidOver))}, so the search did not settle on the demand. Building again draws other boards and can land closer.`}
                {seg.demandFit.constraint && seg.demandFit.spendRange && ` The passes found a player paying between ${dr(Math.round(seg.demandFit.spendRange.low))} and ${dr(Math.round(seg.demandFit.spendRange.high))}.`}
              </p>
            </div>
          )}
          <details className="mt-2" data-testid="review-how">
            <summary className="cursor-pointer select-none text-xs font-semibold text-slate-500 hover:text-purple-700">How these numbers were worked out</summary>
          {/* Two different things, kept visibly apart:
              - the RESIDUAL is a feasible-allocation difference: what the
                boards can actually hold versus the unrounded target;
              - CONVERGENCE is stability between build passes: whether the
                credit the boards were built with still matches the credit
                their own simulation implies.
              A build can be fully converged and still have a residual. */}
          <div className="mt-2 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-[11px] text-slate-600 leading-relaxed" data-testid="residual-parts">
            <span className="font-semibold text-slate-700">Residual {signed1(rec.residual)} - a feasible-allocation difference, not a convergence error.</span> It is the
            gap between the unrounded target and what the boards can actually be built to hold: rounding to values the boards can hold exactly{' '}
            {signed1(rec.parts.allocationRounding)}
            {Math.abs(rec.parts.generation) > 0.04 && <> · boards that could not be generated at their share {signed1(rec.parts.generation)}</>}
            {Math.abs(rec.parts.creditNotDeducted) > 0.04 && (
              <>
                {' '}
                · credit not deducted {signed1(rec.parts.creditNotDeducted)}
                {sub.creditUnabsorbed > 0.5 ? ' (no deductible subsidy left for it)' : ' (the build had not converged - see below)'}
              </>
            )}
            .
          </div>
          <div className="mt-1.5 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-[11px] text-slate-600 leading-relaxed" data-testid="convergence">
            <span className="font-semibold text-slate-700">
              Convergence: {seg.converged ? 'stable' : 'not stable'} (pass {seg.passUsed} of {seg.passes.length}, difference {signed1(seg.creditGap)}).
            </span>{' '}
            This measures stability between build passes only: the credit these boards were built with and the credit their own simulation implies{' '}
            {seg.converged ? 'agree to within half a DR' : 'still differ by more than half a DR, and that difference appears above as credit not deducted'}. The half-DR tolerance
            says nothing about rounding - the residual above is separate from it. The energy figure is the one this exact configuration collects.
          </div>
          <p className="mt-2 text-[11px] text-slate-500 leading-relaxed" data-testid="deduction-policy">
            <span className="font-semibold text-slate-600">Deduction policy:</span> {DEDUCTION_POLICY.label}. Typed budgets are never changed, and the credit is taken
            once - a rebuild starts again from the budgets.
          </p>
          </details>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Boards</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm tabular-nums" data-testid="review-boards">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <th className="py-1 pr-3">Board</th>
                <th className="py-1 pr-3">DR you gave</th>
                <th className="py-1 pr-3">Taken off for merge energy</th>
                <th className="py-1 pr-3">DR to place</th>
                <th className="py-1 pr-3">DR placed</th>
                <th className="py-1 pr-3">Tiles / items</th>
                <th className="py-1 pr-3">Reward items under tiles</th>
                <th className="py-1 pr-3">In your design now</th>
                <th className="py-1 pr-3">Checks</th>
              </tr>
            </thead>
            <tbody>
              {seg.perBoard.map((b, i) => {
                const failing = b.checks.filter((c) => !c.ok)
                const appliedBoard = appliedBoards?.[i]
                const appliedSum = appliedBoard ? mainChainSum(appliedBoard) : null
                const appliedHas = appliedBoard && (appliedBoard.semiPlacements?.length ?? 0) + (appliedBoard.blockedQueue?.length ?? 0) > 0
                return (
                  <tr key={i} className="border-t border-slate-100 align-top" data-review-board={i}>
                    <td className="py-1.5 pr-3 font-semibold text-slate-700 whitespace-nowrap">Board {i + 1}</td>
                    <td className="py-1.5 pr-3" data-cell="budget">
                      {b.budget}
                    </td>
                    <td className="py-1.5 pr-3 text-xs" data-cell="deducted">
                      {b.protected ? (
                        <span className="text-purple-600 font-semibold">protected</span>
                      ) : b.deducted > 0.04 ? (
                        <>
                          − {(Math.round(b.deducted * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                          {b.atFloor && <div className="text-amber-700">at its minimum ({b.floor} DR)</div>}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-1.5 pr-3" data-cell="allocation">
                      {b.allocation}
                    </td>
                    <td className={`py-1.5 pr-3 font-semibold ${b.mainSum === b.allocation ? 'text-emerald-700' : 'text-amber-700'}`} data-cell="placed">
                      {b.mainSum}
                    </td>
                    <td className="py-1.5 pr-3">
                      {b.tiles} / {b.items}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-slate-600" data-cell="rewards">
                      {b.rewardItems.length === 0
                        ? '—'
                        : b.rewardItems.map((it) => `${it.count}× ${REWARD_TYPE_LABELS[it.type]} R${it.rank}${it.where === 'semi' ? ' (semi)' : ''}`).join(', ')}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-slate-500" data-cell="applied">
                      {appliedHas ? `${appliedSum} DR` : 'blank'}
                    </td>
                    <td className="py-1.5 pr-3 text-xs">
                      {failing.length === 0 ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <CircleCheck size={13} /> all {b.checks.length} pass
                        </span>
                      ) : (
                        <span className="text-amber-700">{failing.map((c) => c.label).join('; ')}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <details className="rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3" data-testid="review-details">
        <summary className="cursor-pointer select-none text-sm font-semibold text-slate-600">Details: checks, build passes, drops and notes</summary>
        <div className="mt-3 flex flex-col gap-4 text-xs text-slate-600">
          <div>
            <div className="font-semibold text-slate-700 mb-1">Constraint checks</div>
            {seg.perBoard.map((b, i) => (
              <div key={i} className="mb-1.5">
                <div className="text-slate-500">Board {i + 1}</div>
                {b.checks.map((c) => (
                  <CheckLine key={c.id} ok={c.ok}>
                    <span className="text-xs">{c.label}</span>
                  </CheckLine>
                ))}
              </div>
            ))}
          </div>
          <div>
            <div className="font-semibold text-slate-700 mb-1">Build passes (energy credit)</div>
            <table className="tabular-nums">
              <thead>
                <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="pr-4">Pass</th>
                  <th className="pr-4">Credit the boards were built with</th>
                  <th className="pr-4">Energy the simulation collected</th>
                  <th className="pr-4">Credit that implies</th>
                </tr>
              </thead>
              <tbody>
                {seg.passes.map((p) => (
                  <tr key={p.pass}>
                    <td className="pr-4">{p.pass}</td>
                    <td className="pr-4">{dr(p.creditAssumed)}</td>
                    <td className="pr-4">{Math.round(p.energySimulated)}</td>
                    <td className="pr-4">{dr(p.creditSimulated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-slate-400">The build stops when two passes agree, or after {MAX_PASSES} passes.</p>
          </div>
          <div>
            <div className="font-semibold text-slate-700 mb-1">Merge drops {seg.dropsFixed ? '(shared, set by the base segment)' : 'generated for this build'}</div>
            {seg.generatedGroups?.length ? (
              <ul className="list-disc ml-5">
                {seg.generatedGroups.map((g) => (
                  <li key={g.id}>
                    {g.name} - about {Math.round((g.p ?? 0) * 1000) / 10}% of eligible merges
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500">No group was generated in this build{seg.dropsFixed ? '' : ' (no merge-drop share was needed, or kept groups already cover it)'}.</p>
            )}
            <p className="mt-1 text-slate-400">About {Math.round(seg.eligibleMerges ?? 0)} merges in this phase can roll a drop.</p>
          </div>
          {seg.findings?.length > 0 && (
            <div>
              <div className="font-semibold text-slate-700 mb-1">Notes from the build</div>
              <ul className="list-disc ml-5">
                {seg.findings.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
    </div>
  )
}

function CoverageTable({ result, activeSegmentIndex, onSelectSegment }) {
  const MARGIN_PCT = Math.round(offTargetToleranceFor(result?.phase ?? 'main') * 100)
  return (
    <div className="overflow-x-auto">
      <div className="mb-3 grid grid-cols-1 lg:grid-cols-4 gap-2 text-xs text-slate-600" data-testid="coverage-legend">
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <span className="font-semibold text-slate-700">DR you gave the boards</span> - the subsidy from step 1: what the chase has to cover, minus the segment&apos;s total demand.
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <span className="font-semibold text-slate-700">Taken off for merge energy</span> - merge energy the player collects pays for free generator taps, so 80% of it is
          removed from the boards. Otherwise the player would be helped twice.
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <span className="font-semibold text-slate-700">DR placed under tiles</span> - what the built boards really hold in main-chain items. It should be the first number
          minus what was taken off for merge energy, minus or plus the demand calibration.
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <span className="font-semibold text-slate-700">Player pays</span> - the demand is the DR a player really pays. Lucky drops and free taps change what a player pays, so the
          build moves the subsidy on the later boards down (−) or up (+) until the average simulated player pays the demand. The amounts you typed are never rewritten.
        </div>
      </div>
      <table className="w-full min-w-[58rem] text-sm tabular-nums" data-testid="build-coverage">
        <thead>
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-200">
            <th className="py-2 pr-3">Segment</th>
            <th className="py-2 pr-3">Result</th>
            <th className="py-2 pr-3">DR you gave the boards</th>
            <th className="py-2 pr-3">Taken off for merge energy</th>
            <th className="py-2 pr-3">Demand calibration</th>
            <th className="py-2 pr-3">DR placed under tiles</th>
            <th className="py-2 pr-3">DR demand</th>
            <th className="py-2 pr-3">Player pays</th>
            <th className="py-2 pr-3">What to look at</th>
          </tr>
        </thead>
        <tbody>
          {result.segments.map((s) => (
            <tr
              key={s.index}
              className={`border-b border-slate-100 cursor-pointer ${s.index === activeSegmentIndex ? 'bg-purple-50/60' : 'hover:bg-slate-50'} ${s.status === 'skipped' ? 'text-slate-400' : ''}`}
              onClick={() => onSelectSegment(s.index)}
              data-coverage-segment={s.index}
            >
              <td className={`pr-3 font-semibold whitespace-nowrap ${s.status === 'skipped' ? 'py-1 text-slate-400 font-medium' : 'py-1.5 text-slate-700'}`}>
                {s.name}
                {s.index === 0 && <span className="ml-1.5 text-[11px] text-purple-600">base</span>}
              </td>
              <td className="py-1.5 pr-3">
                <StatusChip kind={segmentChip(s).kind}>{segmentChip(s).label}</StatusChip>
              </td>
              <td className="py-1.5 pr-3">{s.subsidy ? dr(s.subsidy.budget) : '—'}</td>
              <td className="py-1.5 pr-3">{s.reconciliation ? `− ${dr1(s.reconciliation.creditCalculated)}` : '—'}</td>
              <td className="py-1.5 pr-3" data-cell="calibration">{s.demandFit?.calibrated ? `${s.demandFit.calibration >= 0 ? '−' : '+'} ${dr1(Math.abs(s.demandFit.calibration))}` : '—'}</td>
              <td className="py-1.5 pr-3 font-semibold text-slate-700">{s.reconciliation ? dr1(s.reconciliation.generatedDr) : '—'}</td>
              <td className="py-1.5 pr-3" data-cell="demand">{s.demandFit ? dr(s.demandFit.configured) : '—'}</td>
              <td className={`py-1.5 pr-3 font-semibold ${s.demandFit?.paid && !(s.demandFit.inMargin ?? s.demandFit.within) ? 'text-amber-700' : 'text-slate-700'}`} data-cell="paid" data-within={s.demandFit?.within ? 'yes' : 'no'} data-passes={(s.demandFit?.inMargin ?? s.demandFit?.within) ? 'yes' : 'no'}>
                {s.demandFit?.paid ? `${dr(Math.round(s.demandFit.paid.mean))} (${s.demandFit.differencePct >= 0 ? '+' : ''}${s.demandFit.differencePct.toFixed(1)}%)` : '—'}
              </td>
              <td className="py-1.5 pr-3 text-xs text-slate-600" data-cell="notes">
                {s.status === 'skipped' ? (
                  <span className="text-slate-400">{s.skipReason.startsWith('No amount entered') ? 'No DR demand typed in step 1' : s.skipReason}</span>
                ) : s.causes?.length ? (
                  <ul className="list-disc ml-4">
                    {s.causes.slice(0, 4).map((c, i) => (
                      <li key={i}>{c.short ?? c.title}</li>
                    ))}
                    {s.causes.length > 4 && <li className="list-none text-slate-400">and {s.causes.length - 4} more - click the row</li>}
                    {s.causes.some((c) => (c.fixes ?? []).length > 0) && <li className="list-none text-purple-700 font-medium">Quick fixes available - click the row</li>}
                  </ul>
                ) : s.converged ? (
                  `Nothing - everything asked for was met (rewards within ${MARGIN_PCT}%)`
                ) : (
                  'Nothing - everything asked for was met (the merge-energy figure still moves by a DR or two between build passes)'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------- Step 4
export function BuildStep({ segments, listOf, activeSegmentIndex, onSelectSegment, shownSegments = null, phase, phaseLabel, goTo, targetPctInputs, onTargetPctInputsChange, segInputs, draft, draftCurrent, changedParts, applied, onUse, rawSegs, inputsFor, drafts, onDraftsChange, rcOnMainDraft, fixed, setFixed }) {
  const [progress, setProgress] = useState(null)
  const [failed, setFailed] = useState(null)
  const [error, setError] = useState(null)
  const [allNote, setAllNote] = useState(null)
  // (A segment that is not in the segment bar is not counted as left out: only the ones in sight.)
  const skippedInSight = (r) => r.segments.filter((x) => x.status === 'skipped' && (!shownSegments || shownSegments.includes(x.index))).length

  // A quick fix changes an INPUT - the same state the steps edit - and never
  // the draft. Layout fixes go to the base segment's board, because layouts
  // and rank limits are one shared set that every segment follows.
  function applyFix(f, builtAt) {
    const base = segments[0]
    const baseList = listOf(base)
    switch (f.kind) {
      case 'setBaseTarget':
        base.setRewardTargets({ ...base.rewardTargets, [phase]: { ...base.rewardTargets[phase], [f.type]: f.value } })
        break
      case 'setFactor':
        segments[f.segmentIndex].setSegmentFactor(f.value)
        break
      case 'setLeftoverPolicy':
        baseList.syncRewardConfig({ rewardLeftoverPolicy: f.value })
        break
      case 'setMinDropRank':
        baseList.syncRewardConfig({ minDropRank: f.value })
        break
      case 'setTilePct': {
        const allocation = base.sourceAllocation[phase] ?? {}
        base.setSourceAllocation({ ...base.sourceAllocation, [phase]: { ...allocation, perResource: { ...(allocation.perResource ?? {}), [f.type]: f.value } } })
        break
      }
      case 'setMaxRank':
      case 'setMinRank': {
        const board = baseList.boards[f.boardIndex]
        if (board) baseList.updateBoard(setRankWindow(board, f.boardIndex === 0, f.kind === 'setMaxRank' ? { maxRank: f.value } : { minRank: f.value }))
        break
      }
      case 'clearPins': {
        const board = baseList.boards[f.boardIndex]
        if (board) baseList.updateBoard(invalidateLayout(board, { forcedSemiRanks: [] }))
        break
      }
      case 'spreadBudget': {
        const list = listOf(segments[f.segmentIndex])
        const total = list.targetSubsidy ?? list.boards.reduce((s, b) => s + (b.blockedValue ?? 0), 0)
        const next = spreadSubsidy(list.boards.length, total, phase)
        list.boards.forEach((b, i) => {
          if ((b.blockedValue ?? 0) !== next[i]) list.updateBoard({ ...b, blockedValue: next[i], effectiveBlockedValue: null })
        })
        break
      }
      case 'setOnboarding': {
        const list = listOf(segments[f.segmentIndex])
        const board = list.boards[0]
        if (board) list.updateBoard(invalidateLayout(board, { onboardingTargetRank: f.targetRank, onboardingDrBudget: f.drBudget }))
        break
      }
      default:
        return
    }
    setFixed((prev) => new Set(prev).add(`${builtAt}:${f.id}`))
  }
  const mainReadiness = buildReadiness({ phase: 'main', boards: inputsFor.main[0].boards, mainBoards: null, targets: inputsFor.main[0].targets })

  // One action for the whole event: the Normal phase, then Recompletion built
  // on top of that Normal draft (Recompletion is played after it). Both come
  // back as drafts; step 5 puts them in use together.
  async function handleBuildAll() {
    cancelRef.current = false
    setError(null)
    setFailed(null)
    setAllNote(null)
    const isCancelled = () => cancelRef.current
    const count = (r) => `${r.builtCount} segment${r.builtCount === 1 ? '' : 's'} built${skippedInSight(r) ? `, ${skippedInSight(r)} without a DR demand` : ''}`
    setProgress({ label: 'Starting', segment: inputsFor.main[0].name, segmentsDone: 0, segmentsTotal: 1, phaseLabel: 'Normal event', phaseIndex: 0, phaseCount: 2 })
    try {
      const mainResult = await buildEvent({ phase: 'main', segments: inputsFor.main, onProgress: (p) => setProgress({ ...p, phaseLabel: 'Normal event', phaseIndex: 0, phaseCount: 2 }), isCancelled })
      if (!mainResult) {
        setProgress(null)
        return
      }
      if (!draftIsUsable(mainResult)) {
        // A build that needs a fix is never put in use, and never replaces
        // the results of one that is.
        if (draftIsUsable(drafts.main)) {
          if (phase === 'main') setFailed(mainResult)
        } else {
          onDraftsChange({ ...drafts, main: mainResult })
        }
        setAllNote({ ok: false, text: 'The Normal phase needs a fix first, so Recompletion was not built and nothing was put in use. Switch to the Normal phase to see what to change.' })
        setProgress(null)
        return
      }
      const rcResult = await buildEvent({ phase: 'rc', segments: rcInputsOnMainDraft(rawSegs, mainResult), onProgress: (p) => setProgress({ ...p, phaseLabel: 'Recompletion', phaseIndex: 1, phaseCount: 2 }), isCancelled })
      // Both go into use in the same moment (a Recompletion that needs a fix
      // is kept to say what to fix, and is not put in use).
      onUse({ main: mainResult, ...(rcResult && rcResult.builtCount > 0 ? { rc: rcResult } : {}) })
      setAllNote({
        ok: !rcResult || rcResult.builtCount === 0 || draftIsUsable(rcResult),
        text: `Normal: ${count(mainResult)}. ${
          !rcResult
            ? 'Recompletion: cancelled.'
            : rcResult.builtCount === 0
              ? 'Recompletion: no DR demand for any segment, so only the Normal phase was built.'
              : `Recompletion: ${count(rcResult)}${draftIsUsable(rcResult) ? '' : ' - it needs a fix (switch to the Recompletion phase to see what)'}.`
        } ${!rcResult || rcResult.builtCount === 0 || !draftIsUsable(rcResult) ? 'The normal event is in use' : 'Both are in use'}.`,
      })
    } catch (e) {
      setError(e?.message ?? String(e))
    }
    setProgress(null)
  }
  const cancelRef = useRef(false)
  useEffect(() => () => (cancelRef.current = true), [])

  const readiness = buildReadiness({ phase, boards: segInputs[0].boards, mainBoards: segInputs[0].mainBoards, targets: segInputs[0].targets })
  const running = progress != null
  const hasTargets = REWARD_TYPES.some((t) => (segInputs[0].targets[t] ?? 0) > 0)

  async function handleBuild() {
    cancelRef.current = false
    setError(null)
    setFailed(null)
    setProgress({ label: 'Starting', segment: segInputs[0].name, segmentsDone: 0, segmentsTotal: 1 })
    try {
      const result = await buildEvent({ phase, segments: segInputs, onProgress: (p) => setProgress(p), isCancelled: () => cancelRef.current })
      if (result) {
        // A build that needs a fix is not put in use and does not replace the
        // results of one that is; any other build is in use at once.
        const usableDraft = draft && draft.status !== 'infeasible' && draft.status !== 'nothing-built'
        if ((result.status === 'infeasible' || result.status === 'nothing-built') && usableDraft) setFailed(result)
        else onUse({ [phase]: result })
      }
    } catch (e) {
      setError(e?.message ?? String(e))
    }
    setProgress(null)
  }

  const shown = failed ?? draft
  const shownSeg = shown?.segments.find((s) => s.index === activeSegmentIndex)
  // How far a running build is: the phases of a whole-event build are halves,
  // a phase is its segments, a segment its tries (a try often ends early, so
  // the bar can jump ahead - it never goes back).
  const progressShare = !progress
    ? 0
    : ((progress.phaseIndex ?? 0) + Math.min(1, ((progress.segmentsDone ?? 0) + (progress.pass ? (progress.pass - 1) / (progress.maxPasses ?? 1) : 0)) / Math.max(1, progress.segmentsTotal ?? 1))) / (progress.phaseCount ?? 1)
  // (The segment's detail is folded while there is nothing to look at: open it on the way.)
  const showSegmentDetail = () =>
    setTimeout(() => {
      const fold = document.querySelector(`details[data-collapsible="build-segment-${phase}"]`)
      if (fold) fold.open = true
      fold?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  const shapeTyped = Object.values(targetPctInputs ?? {}).some((v) => Number(v) > 0)
  const missing = readiness.items.filter((item) => !item.ok)

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        {/* What is ready is not listed: only what is missing, or worth knowing before the build. */}
        {(missing.length > 0 || !hasTargets) && (
          <div className="flex flex-col gap-1.5 mb-4" data-testid="build-readiness">
            {missing.map((item, i) => (
              <CheckLine key={i} ok={false} action={<LinkButton className="text-xs" onClick={() => goTo(item.step)}>Fix this</LinkButton>}>
                {item.label}
                {!item.blocking && <span className="ml-1 text-xs text-slate-400">(does not stop the build)</span>}
              </CheckLine>
            ))}
            {!hasTargets && (
              <CheckLine ok>
                No small-reward target is set - the build will fill the boards with main-chain items only. <LinkButton className="text-xs" onClick={() => goTo('rewards')}>Add targets</LinkButton>
              </CheckLine>
            )}
          </div>
        )}


        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[auto_minmax(0,1fr)] xl:items-center">
        <div className="flex flex-wrap items-center gap-3">
          {!running ? (
            <>
              <Button
                variant="primary"
                icon={Hammer}
                onClick={handleBuildAll}
                disabled={!mainReadiness.ready}
                data-testid="build-whole-event"
                title="Builds the normal event and then Recompletion on top of it, for every segment that has a DR demand. Everything you pinned or limited by hand is kept."
              >
                {draft && !draftCurrent ? 'Build the event again' : 'Build the event'}
              </Button>
              {/* (One phase alone is the smaller choice: one click away.) */}
              <details className="text-xs" data-collapsible="build-one-phase">
                <summary className="cursor-pointer list-none font-semibold text-purple-700 hover:underline [&::-webkit-details-marker]:hidden">or one phase only</summary>
                <div className="mt-2">
                  <Button variant="secondary" size="sm" icon={Hammer} onClick={handleBuild} disabled={!readiness.ready} data-testid="build-configuration">
                    {draft && !draftCurrent ? `Rebuild ${phaseLabel} only` : `Build ${phaseLabel} only`}
                  </Button>
                </div>
              </details>
            </>
          ) : (
            <Button variant="dark" icon={Square} onClick={() => (cancelRef.current = true)} data-testid="build-cancel">
              Cancel
            </Button>
          )}
          {running && (
            <div className="flex min-w-[18rem] flex-1 flex-col gap-1.5" data-testid="build-progress">
              <ProgressBar value={progressShare} label="Build progress" />
              <span className="text-sm text-slate-600">
                <span className="font-semibold text-slate-800">{Math.round(progressShare * 100)}%</span> · {progress.phaseLabel ? `${progress.phaseLabel} · ` : ''}
                {progress.segment} (segment {Math.min((progress.segmentsDone ?? 0) + 1, progress.segmentsTotal ?? 1)} of {progress.segmentsTotal ?? 1}) · {progress.label}
                {progress.pass ? ` · try ${progress.pass} of up to ${progress.maxPasses}` : ''}
              </span>
              <span className="text-[11px] text-slate-400">A whole event usually takes a few minutes. You can cancel; nothing is changed until a build finishes.</span>
            </div>
          )}
          {!running && draft && (
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500" data-testid="build-status">
              <StatusChip kind={!draftCurrent ? 'stale' : draft.status === 'infeasible' ? 'infeasible' : applied ? 'applied' : 'draft'} />
              {draftCurrent ? `${draft.builtCount} segment${draft.builtCount === 1 ? '' : 's'} built${skippedInSight(draft) ? `, ${skippedInSight(draft)} without a DR demand` : ''}.` : null}
              {draftCurrent && !applied && draft.status !== 'infeasible' && ' This build is not in use - step 5 can put it in use.'}
              {draftCurrent && draft.status === 'infeasible' && ' It is not in use.'}
            </span>
          )}
        </div>
        <Collapsible
          id="build-effort-shape"
          tone="inner"
          className="xl:open:col-span-2"
          title="Optional: shape how the player's DR is spread over the ranks"
          summary={shapeTyped ? 'A shape is typed: of the boards it makes, the build picks the ones closest to it.' : 'No shape typed - the build keeps the split from step 1.'}
        >
          <EffortStep
            segments={segments}
            activeSeg={segments[activeSegmentIndex]}
            activeSegmentIndex={activeSegmentIndex}
            onSelectSegment={onSelectSegment}
            phase={phase}
            phaseLabel={phaseLabel}
            listOf={listOf}
            targetPctInputs={targetPctInputs}
            onTargetPctInputsChange={onTargetPctInputsChange}
          />
        </Collapsible>
        </div>
        {allNote && !running && (
          <div className={`mt-3 rounded-2xl border px-3 py-2 text-sm ${allNote.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`} data-testid="build-all-result">
            {allNote.text}
          </div>
        )}
        {phase === 'rc' && rcOnMainDraft && !running && (
          <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800" data-testid="rc-on-main-draft">
            This Recompletion build was made on top of a Normal build that is not in use yet. Put the whole event in use in step 5 to use them together.
          </div>
        )}

        {draft && !draftCurrent && !running && (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="build-needs-rebuild">
            Out of date since it was built: {changedParts.length ? changedParts.map((p) => INPUT_PART_LABELS[p].toLowerCase()).join('; ') : 'an input changed'}. The numbers below
            describe the earlier inputs. Rebuild to update them.
          </div>
        )}
        {error && (
          <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="build-error">
            The build stopped with an error: {error}. Nothing was changed: your event is as it was.
          </div>
        )}
        {failed && (
          <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex flex-wrap items-center gap-2" data-testid="build-failed">
            <span className="flex-1 min-w-[16rem]">
              This build needs a fix, so it was not put in use: your event is still the build from before. The reasons are below.
            </span>
            <Button variant="secondary" size="sm" onClick={() => setFailed(null)}>
              Show the build in use
            </Button>
          </div>
        )}
      </Panel>

      {shown && shown.segments.length > 0 && (
        <BuildSummary
          result={shown}
          shownSegments={shownSegments}
          phase={phase}
          activeSegmentIndex={activeSegmentIndex}
          onSelectSegment={onSelectSegment}
          current={!!failed || draftCurrent}
          applied={!failed && applied}
          tested={false}
          running={running}
          onNext={() => goTo('finalize')}
          onRebuild={mainReadiness.ready ? handleBuildAll : handleBuild}
          onShowSegment={showSegmentDetail}
        />
      )}

      {/* WHAT TO LOOK AT stays in sight: a cause, with its quick fix, is never inside a folded section. (The segment's
          whole detail opened by itself for this, and a segment whose twists land a few points late made the page three
          screens tall.) */}
      {shownSeg && shownSeg.status !== 'skipped' && (shownSeg.causes?.length ?? 0) > 0 && (
        <Panel title={`${shownSeg.name}: what to look at`} tag={<StatusChip kind={segmentChip(shownSeg).kind}>{segmentChip(shownSeg).label}</StatusChip>} data-testid="segment-causes">
          <CauseList
            causes={shownSeg.causes}
            goTo={goTo}
            onFix={(f) => applyFix(f, shown.builtAt)}
            fixedIds={new Set([...fixed].filter((id) => id.startsWith(`${shown.builtAt}:`)).map((id) => id.slice(String(shown.builtAt).length + 1)))}
            onRebuild={running ? null : mainReadiness.ready ? handleBuildAll : handleBuild}
          />
        </Panel>
      )}
      {/* The details: two in a row on a wide window, and one that is opened takes the full width. */}
      <div className="grid grid-cols-1 gap-4 empty:hidden xl:grid-cols-2 xl:items-start">
      {shownSeg && shownSeg.status !== 'skipped' && (
        <Collapsible
          id={`build-segment-${phase}`}
          className="scroll-mt-44 xl:open:col-span-2"
          title={`${shownSeg.name} in detail`}
          summary={
            shownSeg.status === 'infeasible'
              ? 'Something you asked for does not fit - see above. The full figures are here.'
              : segmentChip(shownSeg).kind === 'review'
                ? 'Built and usable. What is outside what you asked for is listed above; the full figures are here.'
                : 'Everything you asked for was met: rewards asked for and expected, the DR on the boards, what the player pays, board by board.'
          }
          tag={<StatusChip kind={segmentChip(shownSeg).kind}>{segmentChip(shownSeg).label}</StatusChip>}
          data-testid="segment-detail-fold"
        >
          <SegmentReview seg={shownSeg} appliedBoards={listOf(segments[shownSeg.index]).boards} />
          {(shownSeg.tileHold?.keptOff ?? []).some((n) => n > 0) && (
            <p className="mt-2 text-xs text-slate-600" data-testid="tile-hold-note">
              A reward item under a tile is semi-blocked when its tile opens, and its board waits until a matching item dropped from a merge opens it. The build kept{' '}
              {shownSeg.tileHold.keptOff
                .map((n, i) => (n > 0 ? `${n} reward item${n === 1 ? '' : 's'} off Board ${i + 1}` : null))
                .filter(Boolean)
                .join(', ')}
              , because there the match often came too late and the next board with it. Those rewards come from merge drops instead.
            </p>
          )}
          {shownSeg.tileHold?.holds && (
            <p className="mt-2 text-xs text-amber-700" data-testid="tile-hold-warning">
              Every board keeps some reward items under its tiles, and a board waits for them. With them a player reaches{' '}
              {Math.round((shownSeg.tileHold.reachedShare ?? 0) * 100)}% of this phase's DR under tiles, against {Math.round((shownSeg.tileHold.baselineShare ?? 0) * 100)}%
              with no reward item under tiles: sometimes the match for one comes late, and the next board with it. Taking more of those rewards from merge drops makes the
              match come sooner.
            </p>
          )}
        </Collapsible>
      )}

      {shown && shown.segments.length > 0 && (
        <Collapsible
          id={`build-accounting-${phase}`}
          className="xl:open:col-span-2"
          title="How the board subsidy was worked out"
          summary="Per segment: the subsidy you gave, what was taken off for merge energy, the demand calibration, and what the boards hold. Plus the drop rules in force."
          tag={<SegmentTag />}
        >
          <CoverageTable result={shown} activeSegmentIndex={activeSegmentIndex} onSelectSegment={onSelectSegment} />
          {shown.shared?.dropStartRank != null && (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700" data-testid="drop-start" data-note>
              <span className="font-semibold">Merge drops:</span> every merge that makes a rank {shown.shared.dropStartRank} or higher item drops{' '}
              {shown.shared.oneItemOnly ? 'exactly one item' : 'one container of reward items'} ({shown.shared.dropGroups.filter((g) => g.auto).length} different
              {shown.shared.oneItemOnly ? ' items' : ' containers'}, the same for every segment).
              {shown.shared.soloRanks && (
                <span data-testid="solo-rank-note">
                  {' '}
                  A merge that makes a rank {shown.shared.soloRanks[0]}
                  {shown.shared.soloRanks[1] !== shown.shared.soloRanks[0] ? ` to ${shown.shared.soloRanks[1]}` : ''} drops one item only.
                </span>
              )}
              {shown.shared.tileType && (
                <span data-testid="tile-reward-note">
                  {' '}
                  The reward under the tiles is {REWARD_TYPE_LABELS[shown.shared.tileType].toLowerCase()}
                  {shown.shared.tileTypeAsked && shown.shared.tileTypeAsked !== shown.shared.tileType
                    ? ` (${REWARD_TYPE_LABELS[shown.shared.tileTypeAsked].toLowerCase()} was picked, but it has no amount here or does not drop)`
                    : ''}
                  {shown.shared.dropFocus
                    ? `: of the merges that make a rank ${shown.shared.dropFocus.rank}, ${Math.round(shown.shared.dropFocus.share * 100)}% drop a rank-1 ${REWARD_TYPE_LABELS[shown.shared.tileType].toLowerCase()} item, the item that opens them.`
                    : '.'}
                  {shown.shared.dropFocus && !shown.shared.dropFocus.elastic && shown.shared.dropFocus.share < 0.5
                    ? ` That is less than half: ${REWARD_TYPE_LABELS[shown.shared.tileType].toLowerCase()} has a typed target and cannot drop more often without paying more than you asked.`
                    : ''}
                </span>
              )}
              {shown.shared.multiDropRank != null && !shown.shared.multiDropShort && (
                <span data-testid="multi-drop-note">
                  {' '}
                  {shown.shared.soloRanks ? 'Above that a' : 'A'} container can hold several rewards: the chance that a drop holds two items rises with every rank, and from the merge that makes rank{' '}
                  {shown.shared.multiDropRank} every drop does (see the table below).
                  {shown.shared.tripleDropRank != null &&
                    (shown.shared.tripleDropShort
                      ? ` From rank ${shown.shared.tripleDropRank} every drop should hold three, but fewer than three different rewards drop from merges in this build.`
                      : ` Only from the merge that makes rank ${shown.shared.tripleDropRank} does a drop hold three. No drop holds more than its rank allows.`)}
                </span>
              )}
              {shown.shared.multiDropRank != null && shown.shared.multiDropShort && (
                <span className="text-slate-500" data-testid="multi-drop-note">
                  {' '}
                  Only one reward drops from merges in this build, so every container holds one item. Give a second reward a target with some share from merge drops to get
                  containers with several items.
                </span>
              )}
            </div>
          )}
          {Object.keys(shownSeg?.rankValues ?? {}).length > 0 && (
            <div className="mt-3 rounded-2xl border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-900" data-testid="rank-values-note" data-note>
              <span className="font-semibold">Rank values the build gave {shownSeg.name}.</span> The drop rules stayed exactly as you set them. The build gives every segment its own
              four rank values for each reward - round amounts, each rank worth more than the items it is made of, so merging always pays - sized so this segment&apos;s average lands on
              its amount:
              <ul className="mt-1 list-disc pl-4">
                {Object.entries(shownSeg.rankValues).map(([type, v]) => (
                  <li key={type} data-rank-values={type}>
                    <span className="font-semibold">{REWARD_TYPE_LABELS[type]}</span>: <span data-field="to">{v.to.join(' / ')}</span> (you typed {v.from.join(' / ')}
                    {v.reason === 'smaller-than-a-prize' ? '; the amount asked is smaller than one top prize at those values' : ''}).{v.limited ? ' That is the most the build changes values by, and it is still not enough - see the segment below.' : ''}
                  </li>
                ))}
              </ul>
              Your typed values stay in step 3 as the definition. To keep them whatever happens, switch off &quot;The build may change a reward&apos;s rank values&quot; there.
            </div>
          )}
          {(shown.adjustments ?? []).length > 0 && (
            <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900" data-testid="build-adjustments" data-note>
              <span className="font-semibold">The build adjusted where rewards come from, so every segment could land on its target:</span>{' '}
              {shown.adjustments.map((a) => `${REWARD_TARGET_LABELS[a.type].toLowerCase()} ${a.usedTilePct}% under tiles (you asked for ${a.askedTilePct}%)`).join('; ')}. Merge drops
              are the same for every segment, and a segment with less DR on its boards merges more, so it collects more drops - {shown.adjustments[0].segment} was getting
              more than its target from drops alone. Your own setting in step 3 is unchanged.
            </div>
          )}
        </Collapsible>
      )}

      {shown && (shown.shared?.dropGroups ?? []).length > 0 && (
        <Collapsible
          id={`build-containers-${phase}`}
          className="xl:open:col-span-2"
          title="What a merge drops (containers)"
          summary={`${shown.shared.dropGroups.filter((g) => g.auto).length} containers, each with a weight per merge rank - what the simulator plays and the Small Rewards Bank and Weights sheets export.`}
          tag={<SharedTag />}
        >
          <p className="mb-3 text-xs text-slate-500">
            The build made these and gave each a weight. Every container is a different drop. They are what the model plays and simulates, and what the Small Rewards Bank and Small
            Reward Weights sheets export.
          </p>
          <ContainersTable dropGroups={shown.shared.dropGroups} dropGroupsConfig={shown.shared.dropGroupsConfig} minDropRank={shown.shared.dropStartRank ?? listOf(segments[0]).boards[0]?.minDropRank} phase={phase} testid="build-containers" />
        </Collapsible>
      )}

      {shown?.twister && (
        <Collapsible
          id={`build-twister-${phase}`}
          className="xl:open:col-span-2"
          title="Twister in detail: values, the price of a twist, timing and chances to spin"
          summary="Each segment's four Twister values and price, when the twists are reached and how they arrive - and an experiment with bigger Twister items."
          tag={<SegmentTag />}
        >
          <TwisterTimingPanel phase={phase} draft={shown} segments={segments} activeSegmentIndex={activeSegmentIndex} current={shown === draft ? draftCurrent : false} embedded />
        </Collapsible>
      )}

      {shownSeg && shownSeg.status !== 'skipped' && (
        <Collapsible id={`build-boards-${phase}`} className="xl:open:col-span-2" title={`The built boards: ${shownSeg.name}`} summary="What is under every tile, and the order the blocked tiles hand their items out.">
          <p className="mb-3 text-xs text-slate-500">
            {`What is under every tile, and the order the blocked tiles hand their items out. A reward item under a tile is semi-blocked until a matching dropped item opens it, and the board waits for it; Reward items under tiles: ${shownSeg.boards
              .map((_, i) => (i === 0 && shownSeg.boards.length > 1 ? 'Board 1 none' : `Board ${i + 1} rank ${allowedRewardRanks(i, shownSeg.boards.length).join(' and ')}`))
              .join(', ')}. On Board 2 they come as a rank 1 and a rank 2 together, so one dropped rank-1 item opens both.`}
          </p>
          <BuiltBoards boards={shownSeg.boards} />
        </Collapsible>
      )}
      {shownSeg && shownSeg.status !== 'skipped' && (phase === 'main' || !rcOnMainDraft) && (
        <Collapsible id={`build-effort-${phase}`} className="xl:open:col-span-2" title={`Effort distribution of this build: ${shownSeg.name}`} summary="Where the player's own DR goes, rank by rank - one playthrough of exactly these boards.">
          {phase === 'main' && shownSeg.effortFit && (
            <p className="mb-2 text-xs text-slate-600" data-testid="effort-fit-note">
              You typed an effort shape (above the Build button), so the build generated these boards several times - same DR, same reward items - and kept the layout closest to
              it: rank 12 takes {Math.round(shownSeg.effortFit.curve?.[12] ?? 0)}% of the effort here, against {Math.round(shownSeg.effortFit.target?.[12] ?? 0)}% asked
              {shownSeg.effortFit.startDistance > shownSeg.effortFit.distance + 1e-9 ? ' (the first layout was further off)' : ''}.
            </p>
          )}
          {phase === 'main' && !shownSeg.effortFit && (
            <p className="mb-2 text-xs text-slate-500" data-testid="effort-fit-note">
              No effort shape was typed for this build, so the boards were generated once and this is simply what they give.
            </p>
          )}
          <BuiltEffort
            boards={shownSeg.boards.map((b) => ({ ...b, dropGroups: shown.shared?.dropGroups ?? b.dropGroups, dropGroupsConfig: shown.shared?.dropGroupsConfig ?? b.dropGroupsConfig }))}
            mainBoards={phase === 'rc' ? segments[shownSeg.index].main.boards : null}
            cacheKey={`${phase}:${shown.builtAt}:${shownSeg.index}`}
          />
        </Collapsible>
      )}
      </div>
      {shownSeg && shownSeg.status === 'skipped' && (
        <Panel title={`${shownSeg.name} in detail`}>
          <p className="text-sm text-slate-600" data-testid="segment-skipped">
            Not built: {shownSeg.skipReason.startsWith('No amount entered') ? 'no DR demand was typed for this segment (step 1).' : shownSeg.skipReason}{' '}
            <LinkButton onClick={() => goTo('setup')}>Go to step 1</LinkButton>
          </p>
        </Panel>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Step 5
export function FinalizeStep({ segments, base, listOf, activeSegmentIndex, phase, phaseLabel, goTo, draft, draftCurrent, applied, validation, onValidation, onUse, onGoBack, onPlay, designIssues = [], exportOverride = false, onExportOverride, drafts = {}, currentFor = {}, appliedFor = {}, rcOnMainDraft = false }) {
  const [validating, setValidating] = useState(false)
  // Phases with a draft that can be applied right now and is not yet.
  const PHASE_NAMES = { main: 'Normal', rc: 'Recompletion' }
  const pendingPhases = ['main', 'rc'].filter((p) => draftIsUsable(drafts[p]) && currentFor[p] && !appliedFor[p])

  const builtSegments = draft ? draft.segments.filter((s) => s.status !== 'skipped') : []
  const draftSeg = draft?.segments.find((s) => s.index === activeSegmentIndex && s.status !== 'skipped') ?? null
  // A Recompletion draft built on the not-yet-applied Normal draft can be
  // applied (together with it) but not tested on its own: testing plays the
  // applied Normal boards first, and those are not this build's yet.
  const usable = !!draft && draftCurrent && draft.status !== 'infeasible' && draft.status !== 'nothing-built' && !rcOnMainDraft

  // Draft boards as they would be once applied: the shared drops on every board.
  const withShared = (boards) => boards.map((b) => ({ ...b, dropGroups: draft.shared?.dropGroups ?? b.dropGroups, dropGroupsConfig: draft.shared?.dropGroupsConfig ?? b.dropGroupsConfig }))
  const appliedSegments = builtSegments.filter((s) => draftSegmentIsApplied(listOf(segments[s.index]).boards, draft)).length

  function handleValidate() {
    setValidating(true)
    setTimeout(() => {
      const bySegment = {}
      for (const s of builtSegments) {
        bySegment[s.index] = validateDraftSegment({ phase, draftSegment: s, shared: draft.shared, mainBoards: phase === 'rc' ? segments[s.index].main.boards : null })
      }
      const next = { builtAt: draft.builtAt, bySegment, runs: DEFAULT_VALIDATION_RUNS, seed: DEFAULT_VALIDATION_SEED }
      onValidation(next)
      // If this draft is already the applied design, record on the design
      // itself that it has been validated.
      if (applied) writeApplied(next)
      setValidating(false)
    }, 30)
  }

  // Writes the draft onto the design: only what a build owns, plus the
  // stamp that lets every tool tell this design still matches its build.
  function writeApplied(validationForStamp) {
    for (const s of builtSegments) {
      const list = listOf(segments[s.index])
      const v = validationForStamp?.bySegment?.[s.index]
      const written = boardsWithDraftApplied(list.boards, s, draft.shared, {
        draft,
        validation: v ? { runs: validationForStamp.runs, seed: validationForStamp.seed, ok: v.allWithinTolerance } : null,
      })
      written.forEach((b) => list.updateBoard(b))
    }
  }

  function handlePlayDraft() {
    const seg = segments[activeSegmentIndex]
    const boards = withShared(draftSeg.boards)
    onPlay(
      phase === 'main'
        ? { boards, rcBoards: seg.recompletion.boards, label: `a ${phaseLabel.toLowerCase()} build of ${draftSeg.name} that is NOT in use`, builtAt: draft.builtAt }
        : { boards: seg.main.boards, rcBoards: boards, label: `the Normal boards in use with a Recompletion build of ${draftSeg.name} that is NOT in use`, builtAt: draft.builtAt },
    )
  }

  async function handleExport() {
    const workbook = buildAllSegmentsWorkbook(
      segments.map((seg, i) => ({ name: seg.name || `Segment ${i + 1}`, boards: seg.main.boards, recompletionBoards: seg.recompletion.boards })),
      { twisterPlan: base.twisterPlan },
    )
    const buffer = await workbook.xlsx.writeBuffer()
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `merge-mania-ops-export-all-segments_${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const v = validation?.bySegment?.[activeSegmentIndex]
  // WHAT IS IN USE, in one of five states (BuildEventPage.jsx: a finished
  // build is in use at once; "not in use" is left for a build kept from an
  // earlier session, one that came with a backup, or boards edited by hand
  // after the build).
  const builtTime = draft?.builtAt ? new Date(draft.builtAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null
  const useState_ = !draft ? 'none' : !draftCurrent ? 'stale' : !draftIsUsable(draft) ? 'needs-fix' : applied ? 'in-use' : 'not-in-use'
  const phaseState = (p) => (!drafts[p] ? 'not built' : !currentFor[p] ? 'out of date' : !draftIsUsable(drafts[p]) ? 'needs a fix' : appliedFor[p] ? 'in use' : 'built, not in use')
  // Applying everything at once is THE action when another phase waits too;
  // applying this phase alone is then the smaller choice.

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div
          className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${useState_ === 'in-use' ? 'border-emerald-200 bg-emerald-50' : useState_ === 'none' ? 'border-slate-200 bg-slate-50' : 'border-amber-200 bg-amber-50'}`}
          data-testid="finalize-in-use"
          data-state={useState_}
          data-built-at={draft?.builtAt ?? ''}
        >
          {useState_ !== 'in-use' && useState_ !== 'none' && <TriangleAlert size={16} className="shrink-0 text-amber-700" />}
          <div className="min-w-[16rem] flex-1">
            <div className="text-sm font-semibold text-slate-800">
              {useState_ === 'none'
                ? 'Nothing is built yet.'
                : useState_ === 'stale'
                  ? 'Your inputs changed after the last build.'
                  : useState_ === 'needs-fix'
                    ? 'The last build needs a fix, so it is not in use.'
                    : useState_ === 'in-use'
                      ? `In use: the ${phaseLabel.toLowerCase()} build of ${builtTime} (${builtSegments.length} segment${builtSegments.length === 1 ? '' : 's'}).`
                      : 'This build is not in use.'}
            </div>
            <div className="mt-0.5 text-xs text-slate-600">
              {useState_ === 'none'
                ? 'Build the event in step 4. It is in use as soon as it finishes.'
                : useState_ === 'stale'
                  ? 'What is in use is still the build from before the change. Build again in step 4 to bring it up to date.'
                  : useState_ === 'needs-fix'
                    ? 'Step 4 says what to change. Until then your event is whatever was in use before.'
                    : useState_ === 'in-use'
                      ? 'The Play tester plays it and the Syntax export holds it. Nothing else has to be done for that.'
                      : draft.applied
                        ? `${appliedSegments === 0 ? 'The boards no longer match this build' : `Only ${appliedSegments} of ${builtSegments.length} segments still match this build`}: they were edited after it went into use, or the project was reloaded from an earlier save.`
                        : 'It was kept from an earlier session or came with a backup file. The Play tester and Syntax still use what was in use before.'}
            </div>
            <div className="mt-1 text-[11px] text-slate-500" data-testid="finalize-whole-event">
              Normal: {phaseState('main')} · Recompletion: {phaseState('rc')}
            </div>
          </div>
          {pendingPhases.length > 0 && (
            <Button variant="primary" icon={Check} onClick={() => onUse(Object.fromEntries(pendingPhases.map((p) => [p, drafts[p]])))} data-testid="finalize-apply">
              {pendingPhases.length > 1 ? 'Put the whole event in use' : `Put this ${PHASE_NAMES[pendingPhases[0]].toLowerCase()} build in use`}
            </Button>
          )}
          {(useState_ === 'none' || useState_ === 'stale' || useState_ === 'needs-fix') && (
            <Button variant="secondary" onClick={() => goTo('build')} data-testid="finalize-to-build">
              Go to step 4
            </Button>
          )}
        </div>
        {rcOnMainDraft && (
          <div className="mt-3 text-sm text-sky-800" data-testid="finalize-rc-on-main-draft">
            This Recompletion build was made on a Normal build that is not in use yet. Put the whole event in use above; after that it can be tested and played here.
          </div>
        )}

        {/* Three things to do with a build, as three buttons (each said what it does in a card of its own; that is in the hover now). */}
        <div className="mt-4 flex flex-wrap items-center gap-3" data-testid="finalize-actions">
          <Button
            variant="primary"
            icon={FlaskConical}
            onClick={handleValidate}
            disabled={!usable || validating}
            data-testid="finalize-validate"
            title={`${DEFAULT_VALIDATION_RUNS} simulated players, each with their own luck. Says how many of them land near what you asked - not only the average.`}
          >
            {validating ? 'Playing…' : validation ? `Test again on ${DEFAULT_VALIDATION_RUNS} players` : `Test on ${DEFAULT_VALIDATION_RUNS} simulated players`}
          </Button>
          <Button
            variant="secondary"
            icon={Gamepad2}
            onClick={() => (applied || !usable || !draftSeg ? onPlay(null) : handlePlayDraft())}
            data-testid="finalize-play"
            title={`Opens the Play tester on ${segments[activeSegmentIndex]?.name || `Segment ${activeSegmentIndex + 1}`}. It says at the top what it is playing.`}
          >
            {usable && !applied && draftSeg ? 'Play this build (not in use)' : 'Play it'}
          </Button>
          <Button
            variant="secondary"
            icon={Undo2}
            onClick={() => onGoBack(phase)}
            disabled={!draft?.applied}
            data-testid="finalize-revert"
            title="Puts back what was in use before this build: the build before it, or the boards as they were. One step back."
          >
            Go back to the previous build
          </Button>
        </div>
      </Panel>

      {v && draftSeg && (
        <Panel
          title={`Tested on players: ${draftSeg.name}`}
          subtitle={`${validation.runs} simulated players, each rolling their own lucky drops like a real one - a separate run, not the one the build measured itself on. (Run number ${validation.seed}: the same test gives the same players again.)`}
          tag={<StatusChip kind={v.allWithinTolerance ? 'validated' : 'review'}>{v.allWithinTolerance ? 'Averages within margin' : 'Tested - an average is off target'}</StatusChip>}
        >
          <table className="w-full text-sm tabular-nums" data-testid="validation-table">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <th className="py-1 pr-3">Resource</th>
                <th className="py-1 pr-3">You asked for</th>
                <th className="py-1 pr-3">The build expected</th>
                <th className="py-1 pr-3">Average of these players</th>
                <th className="py-1 pr-3">8 in 10 players land between</th>
                <th className="py-1 pr-3">Players within {Math.round((v.margin ?? (phase === 'rc' ? 0.25 : 0.15)) * 100)}%</th>
              </tr>
            </thead>
            <tbody>
              {v.resources
                .filter((r) => r.target > 0)
                .map((r) => (
                  <tr key={r.type} className="border-t border-slate-100" data-validation={r.type}>
                    <td className="py-1 pr-3 font-semibold text-slate-700">
                      {REWARD_TARGET_LABELS[r.type]}
                      {r.type === COIN_TYPE && <span className="ml-1 text-[10px] font-normal text-amber-700">× allowance</span>}
                    </td>
                    <td className="py-1 pr-3">{formatRewardAmount(r.type, r.target)}</td>
                    <td className="py-1 pr-3">{formatRewardAmount(r.type, r.estimate)}</td>
                    <td className={`py-1 pr-3 font-semibold ${r.withinTolerance ? 'text-emerald-700' : 'text-amber-700'}`} data-cell="mean">
                      {formatRewardAmount(r.type, r.mean)}
                    </td>
                    <td className="py-1 pr-3 text-slate-500">
                      {formatRewardAmount(r.type, r.p10)} – {formatRewardAmount(r.type, r.p90)}
                    </td>
                    <td className={`py-1 pr-3 font-semibold ${r.nearShare == null ? 'text-slate-400' : r.nearShare >= 0.9 ? 'text-emerald-700' : r.nearShare >= 0.6 ? 'text-slate-700' : 'text-amber-700'}`} data-cell="near">
                      {r.nearShare == null ? '-' : `${Math.round(r.nearShare * 100)} of 100`}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {v.resources.every((r) => !(r.target > 0)) && <p className="text-sm text-slate-500">This segment has no reward amounts to test.</p>}
          {v.allNearShare != null && (
            <p className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="validation-closeness">
              <span className="font-semibold" data-field="all-near">
                {Math.round(v.allNearShare * 100)} of 100 players
              </span>{' '}
              end within {Math.round((v.margin ?? 0.15) * 100)}% of the amount asked on every reward at once. The average says where the middle player lands; this says how many players are near it.
              {draft?.shared?.steadyDrops
                ? ' Every merge of a rank drops the same items in this build, so what still differs between two players is their luck with the generator.'
                : ' The containers of this build are picked at random at each merge, so two players can end far apart - step 3 has "Every merge of a rank drops the same items".'}
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            {phase === 'rc' ? `${pct(v.entryRate * 100)} of players reached Recompletion; ` : ''}
            {pct(v.completionRate * 100)} finished the phase. The average player spent {dr(v.drSpent.mean)}
            {draftSeg.demandFit?.configured > 0 ? ` against a DR demand of ${dr(draftSeg.demandFit.configured)}` : ''}. Merge energy collected: {Math.round(v.energyMean)} - 80% of that is{' '}
            {dr(v.creditFromValidation)}, against the {dr(draftSeg.subsidy.creditApplied)} taken off the boards for it.
          </p>
        </Panel>
      )}

      {/* Under the test: the other players, endless mode and the export, side by side on a wide window. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:items-start">
      {v && draftSeg && (v.styles?.length ?? 0) > 1 && <PlayStylesPanel v={v} segmentName={draftSeg.name} phase={phase} goTo={goTo} />}

      <Collapsible id="finalize-endless" className="xl:open:col-span-3" title="After rank 14: endless mode" summary="What play becomes once the second grand prize is won. You can play it in the Play Tester.">
        <p className="mb-3 text-xs text-slate-500">What play becomes once the second grand prize is won. Read from this segment&apos;s Recompletion boards in use; you can play it in the Play tester.</p>
        <EndlessPreview mainBoards={segments[activeSegmentIndex]?.main?.boards} rcBoards={segments[activeSegmentIndex]?.recompletion?.boards} />
      </Collapsible>

      <Panel title="Export" subtitle="The Ops workbook for every segment, from the event in use.">
        <ExportGate issues={designIssues} override={exportOverride} onOverride={onExportOverride} onRebuild={() => goTo('build')}>
          {(allowed) => (
            <div className="flex flex-wrap items-center gap-3" data-testid="finalize-export">
              <Button variant="secondary" icon={Download} onClick={handleExport} disabled={!allowed} data-testid="finalize-download">
                Download the event (all segments)
              </Button>
              {draft && draftCurrent && !applied && draft.status !== 'infeasible' && (
                <span className="text-xs text-amber-700" data-testid="export-warning">
                  A download holds the event in use, and the last build is not in use - so it is not what this downloads.
                </span>
              )}
            </div>
          )}
        </ExportGate>
      </Panel>
      </div>
    </div>
  )
}

