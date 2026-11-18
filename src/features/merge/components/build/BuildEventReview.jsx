import { useEffect, useRef, useState } from 'react'
import { Hammer, Square, TriangleAlert, CircleCheck, Play, FlaskConical, Check, Undo2, Download, Gamepad2, Tornado, Wrench } from 'lucide-react'
import Button from '../../../../components/ui/Button'
import { StatusChip, SharedTag, SegmentTag, Panel, CheckLine, LinkButton } from './buildUi'
import { REWARD_TYPES, REWARD_TARGET_LABELS, REWARD_TYPE_LABELS, COIN_TYPE, formatRewardAmount } from '../../lib/rewards/rewardChain'
import { allowedRewardRanks } from '../../lib/rewards/rewardPlacement'
import { buildEvent, buildReadiness, boardsWithDraftApplied, draftSegmentIsApplied, mainChainSum, validateDraftSegment, rcInputsOnMainDraft, draftIsUsable, INPUT_PART_LABELS, MAX_PASSES, DEFAULT_VALIDATION_RUNS, DEFAULT_VALIDATION_SEED, DEDUCTION_POLICY } from '../../lib/build/eventBuild'
import { ExportGate } from './DesignStatus'
import { offTargetToleranceFor } from '../../lib/rewards/smallRewardsWorkflow'
import { invalidateLayout } from '../../lib/core/board'
import { setRankWindow } from '../../lib/core/layoutEdits'
import { spreadSubsidy } from '../../lib/core/subsidyBudget'
import { BuiltBoards, BuiltEffort } from './BuildEventSteps'
import { buildAllSegmentsWorkbook } from '../../lib/export/eventSheets'
import { twisterIsConfigured, hasTwisterDrops, PACE_MARKS, TWISTER_ON_TRACK_WINDOW_PCT } from '../../lib/rewards/twisterEconomy'
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
// One short line per segment in the Twister price table.
function twisterNote(row, sizing) {
  if (row.cost == null || row.spinsMedian == null) return row.message ?? ''
  if (row.tooLow) {
    return sizing?.byBuild
      ? `Too little Twister DR for ${row.twists} twists: at the lowest price a typical player gets ${row.spinsMedian}.`
      : `Too little Twister DR for ${row.twists} twists: at the lowest price a typical player gets ${row.spinsMedian}. The drop chance here is your own fixed one - "Let the build set the Twister drops" in step 4 lets the build raise it.`
  }
  const step = row.step > 1 ? ` Prices move in steps of ${row.step} Twister DR; a smaller step lands closer.` : ''
  const items = row.collectsMedian != null ? Math.round(row.collectsMedian) : null
  const inSteps = items != null ? `Its Twister DR comes in ${items} finished Twister item${items === 1 ? '' : 's'}` : null
  if (row.pace === 'late') return `A typical player gets ${row.spinsMedian} of ${row.twists}.${step}`
  if (row.pace === 'early') {
    if (items != null && items <= 2) return `${inSteps}, so the twists come in ${items === 1 ? 'one jump' : 'two jumps'} wherever ${items === 1 ? 'it is' : 'they are'} finished.${sizing?.byBuild && sizing?.steady === false ? ' "Keep every segment\'s Twister steady" in step 4 fixes this.' : ''}`
    return `At this price a typical player ends with ${row.spinsMedian}, so the ${row.twists} asked are reached early; the next price up gives fewer than ${row.twists}.${step}`
  }
  return inSteps ? `${inSteps}.` : 'On target.'
}

// "Are we on track": one line for the whole Twister of a build.
function twisterTrack(twister) {
  const asked = (twister?.rows ?? []).filter((r) => r.twists > 0 && r.cost != null && r.pace)
  if (asked.length === 0) return null
  const off = asked.filter((r) => r.pace !== 'on-track')
  const finishes = asked.map((r) => r.finishPct).filter((v) => v != null)
  if (off.length === 0) {
    const from = Math.min(...finishes)
    const to = Math.max(...finishes)
    return { ok: true, text: `On track: in ${asked.length === 1 ? 'this segment' : `all ${asked.length} segments`} the typical player has the last twist ${from === to ? `at ${from}%` : `between ${from}% and ${to}%`} of the phase.` }
  }
  const early = off.filter((r) => r.pace === 'early')
  const late = off.filter((r) => r.pace === 'late')
  const parts = []
  if (early.length) parts.push(`${early.map((r) => `${r.name} (at ${r.finishPct}%)`).join(', ')} ${early.length === 1 ? 'has' : 'have'} all the twists early`)
  if (late.length) parts.push(`${late.map((r) => `${r.name} (${r.spinsMedian} of ${r.twists})`).join(', ')} ${late.length === 1 ? 'does' : 'do'} not get them all`)
  return { ok: false, text: `Not on track yet: ${parts.join('; ')}. The other ${asked.length - off.length} ${asked.length - off.length === 1 ? 'segment is' : 'segments are'} on track.` }
}
const PACE_LABEL = { 'on-track': 'On track', early: 'Early', late: 'Short' }
const PACE_CHIP = { 'on-track': 'validated', early: 'review', late: 'infeasible' }

function SegmentReview({ seg, appliedBoards, goTo, onFix, fixedIds, onRebuild }) {
  const phase = seg.phase ?? 'main'
  const MARGIN_PCT = Math.round(offTargetToleranceFor(phase) * 100)
  const sub = seg.subsidy
  const rec = seg.reconciliation
  const anyTarget = seg.resources.some((r) => r.target > 0)
  return (
    <div className="flex flex-col gap-4" data-testid="segment-review">
      <CauseList causes={seg.causes} goTo={goTo} onFix={onFix} fixedIds={fixedIds} onRebuild={onRebuild} />

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
      <div className="mb-3 grid grid-cols-1 lg:grid-cols-3 gap-2 text-xs text-slate-600" data-testid="coverage-legend">
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <span className="font-semibold text-slate-700">DR you gave the boards</span> - the subsidy from step 1: what the chase has to cover, minus the segment&apos;s total demand.
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <span className="font-semibold text-slate-700">Taken off for merge energy</span> - merge energy the player collects pays for free generator taps, so 80% of it is
          removed from the boards. Otherwise the player would be helped twice.
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <span className="font-semibold text-slate-700">DR placed under tiles</span> - what the built boards really hold in main-chain items. It should be the first number
          minus the second.
        </div>
      </div>
      <table className="w-full min-w-[40rem] text-sm tabular-nums" data-testid="build-coverage">
        <thead>
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-200">
            <th className="py-2 pr-3">Segment</th>
            <th className="py-2 pr-3">Result</th>
            <th className="py-2 pr-3">DR you gave the boards</th>
            <th className="py-2 pr-3">Taken off for merge energy</th>
            <th className="py-2 pr-3">DR placed under tiles</th>
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
              <td className="py-1.5 pr-3 font-semibold text-slate-700">{s.reconciliation ? dr1(s.reconciliation.generatedDr) : '—'}</td>
              <td className="py-1.5 pr-3 text-xs text-slate-600" data-cell="notes">
                {s.status === 'skipped' ? (
                  <span className="text-slate-400">{s.skipReason.startsWith('No amount entered') ? 'No amount entered in step 1' : s.skipReason}</span>
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
export function BuildStep({ segments, listOf, activeSegmentIndex, onSelectSegment, phase, phaseLabel, goTo, segInputs, draft, draftCurrent, changedParts, applied, onDraft, rawSegs, inputsFor, drafts, onDraftsChange, rcOnMainDraft, fixed, setFixed }) {
  const [progress, setProgress] = useState(null)
  const [failed, setFailed] = useState(null)
  const [error, setError] = useState(null)
  const [allNote, setAllNote] = useState(null)

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
  // back as drafts; step 7 applies them together.
  async function handleBuildAll() {
    cancelRef.current = false
    setError(null)
    setFailed(null)
    setAllNote(null)
    const isCancelled = () => cancelRef.current
    const count = (r) => `${r.builtCount} segment${r.builtCount === 1 ? '' : 's'} built${r.skippedCount ? `, ${r.skippedCount} without an amount` : ''}`
    setProgress({ label: 'Starting', segment: inputsFor.main[0].name, segmentsDone: 0, segmentsTotal: 1, phaseLabel: 'Normal' })
    try {
      const mainResult = await buildEvent({ phase: 'main', segments: inputsFor.main, onProgress: (p) => setProgress({ ...p, phaseLabel: 'Normal' }), isCancelled })
      if (!mainResult) {
        setProgress(null)
        return
      }
      if (!draftIsUsable(mainResult)) {
        // A failed build never replaces a usable draft.
        if (draftIsUsable(drafts.main)) {
          if (phase === 'main') setFailed(mainResult)
        } else {
          onDraftsChange({ ...drafts, main: mainResult })
        }
        setAllNote({ ok: false, text: 'The Normal phase needs a fix first, so Recompletion was not built. Switch to the Normal phase to see what to change.' })
        setProgress(null)
        return
      }
      const next = { ...drafts, main: mainResult }
      const rcResult = await buildEvent({ phase: 'rc', segments: rcInputsOnMainDraft(rawSegs, mainResult), onProgress: (p) => setProgress({ ...p, phaseLabel: 'Recompletion' }), isCancelled })
      if (rcResult && rcResult.builtCount > 0) next.rc = rcResult
      onDraftsChange(next)
      setAllNote({
        ok: !rcResult || rcResult.builtCount === 0 || draftIsUsable(rcResult),
        text: `Normal: ${count(mainResult)}. ${
          !rcResult
            ? 'Recompletion: cancelled.'
            : rcResult.builtCount === 0
              ? 'Recompletion: no amount entered for any segment, so only the Normal phase was built.'
              : `Recompletion: ${count(rcResult)}${draftIsUsable(rcResult) ? '' : ' - it needs a fix (switch to the Recompletion phase to see what)'}.`
        } Both are drafts - apply them together in step 7.`,
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
        // A failed build never replaces a usable draft, and no build ever
        // touches the applied design.
        const usableDraft = draft && draft.status !== 'infeasible' && draft.status !== 'nothing-built'
        if ((result.status === 'infeasible' || result.status === 'nothing-built') && usableDraft) setFailed(result)
        else onDraft(result)
      }
    } catch (e) {
      setError(e?.message ?? String(e))
    }
    setProgress(null)
  }

  const shown = failed ?? draft
  const shownSeg = shown?.segments.find((s) => s.index === activeSegmentIndex)

  return (
    <div className="flex flex-col gap-4">
      <Panel title="6. Build boards" subtitle={`One build for the whole ${phaseLabel.toLowerCase()} phase: what sits under every tile, the reward items, the merge drops and the merge-energy deduction, worked out together.`}>
        <div className="flex flex-col gap-1.5 mb-4" data-testid="build-readiness">
          {readiness.items.map((item, i) => (
            <CheckLine key={i} ok={item.ok} action={!item.ok && <LinkButton className="text-xs" onClick={() => goTo(item.step)}>Fix this</LinkButton>}>
              {item.label}
              {!item.ok && !item.blocking && <span className="ml-1 text-xs text-slate-400">(does not stop the build)</span>}
            </CheckLine>
          ))}
          {!hasTargets && (
            <CheckLine ok>
              No small-reward target is set - the build will fill the boards with main-chain items only. <LinkButton className="text-xs" onClick={() => goTo('rewards')}>Add targets</LinkButton>
            </CheckLine>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!running ? (
            <>
              <Button variant="primary" icon={Hammer} onClick={handleBuildAll} disabled={!mainReadiness.ready} data-testid="build-whole-event">
                Build whole event (Normal + Recompletion)
              </Button>
              <Button variant="secondary" icon={Hammer} onClick={handleBuild} disabled={!readiness.ready} data-testid="build-configuration">
                {draft && !draftCurrent ? `Rebuild ${phaseLabel} only` : `Build ${phaseLabel} only`}
              </Button>
            </>
          ) : (
            <Button variant="dark" icon={Square} onClick={() => (cancelRef.current = true)} data-testid="build-cancel">
              Cancel
            </Button>
          )}
          {running && (
            <span className="text-sm text-slate-600" data-testid="build-progress">
              {progress.phaseLabel ? `${progress.phaseLabel}: ` : ''}
              {progress.segment} - {progress.label}
              {progress.pass ? ` (pass ${progress.pass} of ${progress.maxPasses})` : ''} · segment {Math.min((progress.segmentsDone ?? 0) + 1, progress.segmentsTotal ?? 1)} of {progress.segmentsTotal ?? 1}
            </span>
          )}
          {!running && draft && (
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500" data-testid="build-status">
              <StatusChip kind={!draftCurrent ? 'stale' : draft.status === 'infeasible' ? 'infeasible' : applied ? 'applied' : 'draft'} />
              {draftCurrent ? `${draft.builtCount} segment${draft.builtCount === 1 ? '' : 's'} built${draft.skippedCount ? `, ${draft.skippedCount} not configured` : ''}.` : null}
              {draftCurrent && !applied && draft.status !== 'infeasible' && ' This is a draft - your applied design is unchanged until you apply it in step 7.'}
            </span>
          )}
        </div>
        {allNote && !running && (
          <div className={`mt-3 rounded-2xl border px-3 py-2 text-sm ${allNote.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`} data-testid="build-all-result">
            {allNote.text}
          </div>
        )}
        {phase === 'rc' && rcOnMainDraft && !running && (
          <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800" data-testid="rc-on-main-draft">
            This Recompletion draft was built on top of the Normal draft, which is not applied yet. Apply the whole event in step 7 to use them together.
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500 max-w-3xl">
          &quot;Build whole event&quot; builds the Normal phase and then Recompletion on top of it, for every segment that has an amount.{' '}
          The build never writes to your design. It produces a draft you review here and apply in step 7. Pinned contents, locked drop groups, rank limits, the
          Board 1 cap and onboarding goals are kept. Twister is never placed under a tile.
        </p>

        {draft && !draftCurrent && !running && (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="build-needs-rebuild">
            Out of date since it was built: {changedParts.length ? changedParts.map((p) => INPUT_PART_LABELS[p].toLowerCase()).join('; ') : 'an input changed'}. The numbers below
            describe the earlier inputs. Rebuild to update them.
          </div>
        )}
        {error && (
          <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="build-error">
            The build stopped with an error: {error}. Your draft and applied design are unchanged.
          </div>
        )}
        {failed && (
          <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex flex-wrap items-center gap-2" data-testid="build-failed">
            <span className="flex-1 min-w-[16rem]">
              This build could not produce a workable configuration, so it did not replace your earlier draft. The reasons are below. Your applied design is unchanged.
            </span>
            <Button variant="secondary" size="sm" onClick={() => setFailed(null)}>
              Show the earlier draft
            </Button>
          </div>
        )}
      </Panel>

      {shown && shown.segments.length > 0 && (
        <Panel title="Result for each segment" subtitle="One row per segment. Click a row to see that segment in detail below." tag={<SegmentTag />}>
          <CoverageTable result={shown} activeSegmentIndex={activeSegmentIndex} onSelectSegment={onSelectSegment} />
          {shown.shared?.dropStartRank != null && (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700" data-testid="drop-start">
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
          {Object.keys(shown.shared?.rankValues ?? {}).length > 0 && (
            <div className="mt-3 rounded-2xl border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-900" data-testid="rank-values-note">
              <span className="font-semibold">Rank values the build changed.</span> The drop rules stayed exactly as you set them. With them, these rewards could not reach
              their amount at the values you typed, so the build changed their four rank values (the same for every segment):
              <ul className="mt-1 list-disc pl-4">
                {Object.entries(shown.shared.rankValues).map(([type, v]) => (
                  <li key={type} data-rank-values={type}>
                    <span className="font-semibold">{REWARD_TYPE_LABELS[type]}</span>: {v.from.join(' / ')} became {v.to.join(' / ')}{' '}
                    {v.paidBefore == null ? '(the amount asked is smaller than one top prize at your values).' : `(at your values the same drops paid ${formatRewardAmount(type, v.paidBefore)}).`}{v.limited ? ' That is the most the build changes values by, and it is still not enough - see the segment below.' : ''}
                  </li>
                ))}
              </ul>
              Your typed values stay in step 4 as the definition. To keep them whatever happens, switch off &quot;The build may change a reward&apos;s rank values&quot; there.
            </div>
          )}
          {(shown.adjustments ?? []).length > 0 && (
            <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900" data-testid="build-adjustments">
              <span className="font-semibold">The build adjusted where rewards come from, so every segment could land on its target:</span>{' '}
              {shown.adjustments.map((a) => `${REWARD_TARGET_LABELS[a.type].toLowerCase()} ${a.usedTilePct}% under tiles (you asked for ${a.askedTilePct}%)`).join('; ')}. Merge drops
              are the same for every segment, and a segment with less DR on its boards merges more, so it collects more drops - {shown.adjustments[0].segment} was getting
              more than its target from drops alone. Your own setting in step 4 is unchanged.
            </div>
          )}
        </Panel>
      )}

      {shown && (shown.shared?.dropGroups ?? []).length > 0 && (
        <Panel
          title="Containers: what a merge drops"
          subtitle="The build made these and gave each a weight. Every container is a different drop. They are what the model plays and simulates, and what the Small Rewards Bank and Small Reward Weights sheets export once the build is applied."
          tag={<SharedTag />}
        >
          <ContainersTable dropGroups={shown.shared.dropGroups} dropGroupsConfig={shown.shared.dropGroupsConfig} minDropRank={shown.shared.dropStartRank ?? listOf(segments[0]).boards[0]?.minDropRank} phase={phase} testid="build-containers" />
        </Panel>
      )}

      {shown?.twister && (
        <Panel
          title="Twister: the price of a twist, and whether it is on track"
          subtitle={`Worked out for each segment from the twists you typed in step 4, by playing these boards (${shown.twister.runs} simulated players each). Applying the build sets these prices. The "At ..." columns are the twists a typical player of the segment can have bought that far into the phase.`}
          tag={<SegmentTag />}
        >
          {(() => {
            const track = twisterTrack(shown.twister)
            return track ? (
              <p className={`mb-2 rounded-xl border px-3 py-2 text-sm font-semibold ${track.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`} data-testid="twister-track" data-on-track={track.ok ? 'yes' : 'no'}>
                {track.text}
              </p>
            ) : null
          })()}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-sm tabular-nums" data-testid="build-twister-prices">
              <thead>
                <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-200">
                  <th className="py-1.5 pr-3">Segment</th>
                  <th className="py-1.5 pr-3 text-right">Twists you asked for</th>
                  <th className="py-1.5 pr-3 text-right">Price of a twist</th>
                  <th className="py-1.5 pr-3 text-right">Twists a typical player gets</th>
                  {PACE_MARKS.map((pct) => (
                    <th key={pct} className="py-1.5 pr-3 text-right whitespace-nowrap" title={`What a typical player of the segment has collected when they are ${pct}% through the phase, and the twists that buys`}>
                      At {pct}%
                    </th>
                  ))}
                  <th className="py-1.5 pr-3 text-right whitespace-nowrap" title="How far into the phase the typical player is when they can buy the last of the twists you asked for">
                    Has them all at
                  </th>
                  <th className="py-1.5 pr-3">Pace</th>
                  <th className="py-1.5 pr-3">Note</th>
                </tr>
              </thead>
              <tbody>
                {shown.twister.rows.map((row) => (
                  <tr key={row.index} className="border-b border-slate-100 align-top" data-twister-price={row.index}>
                    <td className="py-1.5 pr-3 font-semibold text-slate-700 whitespace-nowrap">{row.name}</td>
                    <td className="py-1.5 pr-3 text-right">{row.twists ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-right font-semibold text-purple-700" data-field="price">
                      {row.cost == null ? '—' : `${row.cost} Twister DR`}
                    </td>
                    <td className="py-1.5 pr-3 text-right" data-field="typical">
                      {row.spinsMedian == null ? '—' : `${row.spinsMedian}${row.attainment != null ? ` · ${Math.round(row.attainment * 100)}% get all ${row.twists}` : ''}`}
                    </td>
                    {PACE_MARKS.map((pct) => {
                      const at = row.incomeAtMarks?.[pct]
                      const typical = at?.p50
                      const twistsThere = row.cost > 0 && typical != null ? Math.floor(typical / row.cost) : null
                      return (
                        <td key={pct} className="py-1.5 pr-3 text-right whitespace-nowrap" data-mark={pct}>
                          {at === undefined ? (
                            <span className="text-slate-400">—</span>
                          ) : typical == null ? (
                            <span className="text-slate-400">not reached</span>
                          ) : (
                            <>
                              {twistsThere != null && (
                                <span className={`block font-semibold ${row.twists > 0 && twistsThere >= row.twists ? 'text-emerald-700' : 'text-slate-700'}`} data-field="twists">
                                  {twistsThere} twist{twistsThere === 1 ? '' : 's'}
                                </span>
                              )}
                              <span className="block text-xs text-slate-500" data-field="dr">
                                {formatRewardAmount('twister', typical)} DR
                              </span>
                            </>
                          )}
                        </td>
                      )
                    })}
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap" data-field="finish">
                      {row.cost == null || !(row.twists > 0) ? '—' : row.finishPct == null ? <span className="text-amber-700">not by the end</span> : `${row.finishPct}%`}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap" data-field="pace" data-pace={row.pace ?? ''}>
                      {row.pace ? <StatusChip kind={PACE_CHIP[row.pace]}>{PACE_LABEL[row.pace]}</StatusChip> : '—'}
                    </td>
                    <td className={`py-1.5 pr-3 text-xs max-w-md ${row.tooLow || (row.pace && row.pace !== 'on-track') ? 'text-amber-700' : 'text-slate-500'}`} data-field="note">
                      {twisterNote(row, shown.twister.sizing)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.twister.sizing?.byBuild && (
            <p className="mt-2 text-xs text-slate-600" data-testid="twister-sized">
              {shown.shared?.oneItemOnly
                ? `${Math.round(shown.twister.sizing.minShare * 100)}% of the merges that drop, drop a Twister item`
                : `The build put a Twister item into ${shown.twister.sizing.minShare >= 0.999 ? 'every drop' : `at least ${Math.round(shown.twister.sizing.minShare * 100)}% of the drops`}`}
              {shown.twister.sizing.higher > 0
                ? `, at rank ${shown.twister.sizing.rank} or ${shown.twister.sizing.rank + 1}`
                : `, at rank ${shown.twister.sizing.rank}`}
              {shown.twister.sizing.rounds > 0
                ? shown.twister.sizing.steady && shown.twister.sizing.sizedForCollects > 0
                  ? ` - the items were made bigger so that every segment's typical player finishes at least ${shown.twister.sizing.minCollects} Twister items${shown.twister.sizing.collectsMin != null ? ` (the fewest now: ${Math.round(shown.twister.sizing.collectsMin)})` : ''}. With one or two, all the twists arrive in one or two jumps ("Keep every segment's Twister steady", step 4).`
                  : ' - the items were made bigger, because otherwise the typical player of one segment would not have finished a single Twister item by the time twists are counted.'
                : '.'}{' '}
              You can see it in the containers above.
              {shown.twister.sizing.valuesByBuild && shown.twister.sizing.values && (
                <span data-testid="twister-values">
                  {' '}
                  {shown.twister.sizing.higher > 0 || shown.twister.sizing.rank > 1 ? 'Twister drops stay small items the player merges up.' : 'Every Twister drop stays a rank-1 item the player merges up.'} The build set the four Twister DR values to{' '}
                  {shown.twister.sizing.values.join(' / ')} (ranks 1 to 4){shown.twister.sizing.valueFactor > 1 ? `, ${shown.twister.sizing.valueFactor} times the starting 2 / 5 / 12 / 30, as round numbers` : ''} - the smallest values at which
                  every segment has a price, in your price steps, that fits its twists. Type your own values in the reward definitions and the build keeps them.
                </span>
              )}
              {shown.twister.sizing.minShare >= 0.999 && ' With a Twister item in every drop, every drop that holds a reward holds two items, at every rank.'}
            </p>
          )}
          {shown.twister.rows.some((r) => r.cost != null && r.twists > 0 && !r.pace) && (
            <p className="mt-1 text-xs text-amber-700" data-testid="twister-no-pace">
              This build was made before the tool checked the Twister's pace. Build again to see when each segment's player has the last twist.
            </p>
          )}
          {shown.twister.sizing?.short && (
            <p className="mt-1 text-xs text-amber-700" data-testid="twister-short">
              Even with the biggest Twister item the build uses (rank 3 - it stays an item the player merges) in this many drops, a segment collects too little for its
              twists. Ask for fewer twists, use a smaller price step, count the twists
              later in the phase, or raise the Twister rank values (step 4).
            </p>
          )}
          {shown.twister.sizing?.needsRebuild && (
            <p className="mt-1 text-xs text-amber-700" data-testid="twister-needs-rebuild">
              The twists you typed since this build need more Twister DR than its drops give. Build again and the build raises the Twister drops to fit.
            </p>
          )}
          <p className="mt-2 text-[11px] text-slate-500">
            Counted when the player is {shown.twister.checkpointPct}% through the phase{shown.twister.checkpointPct >= 100 ? ' (by the end)' : ''}. The price is the highest one, in your price steps, at
            which the typical player still gets the twists you asked for. "On track" means that player can buy the last of them in the {TWISTER_ON_TRACK_WINDOW_PCT} points of progress before
            twists are counted ({TWISTER_ON_TRACK_WINDOW_PCT} is this tool's own number); "Early" means sooner; "Short" means not all of them. The price is in Twister DR, the Twister's own
            currency - not merge energy and not the DR of the boards. Twister DR arrives in whole item collects, so twists come in steps: the typical player lands on your number, not every player.
          </p>
        </Panel>
      )}

      {shownSeg && shownSeg.status !== 'skipped' && (
        <Panel
          title={`Review: ${shownSeg.name}`}
          subtitle={
            shownSeg.status === 'infeasible'
              ? 'Something you asked for does not fit. Each problem below comes with a quick fix.'
              : segmentChip(shownSeg).kind === 'review'
                ? 'Built and usable. Something is outside what you asked for - a quick fix is offered below.'
                : 'Everything you asked for was met.'
          }
          tag={<StatusChip kind={segmentChip(shownSeg).kind}>{segmentChip(shownSeg).label}</StatusChip>}
        >
          <SegmentReview
            seg={shownSeg}
            appliedBoards={listOf(segments[shownSeg.index]).boards}
            goTo={goTo}
            onFix={(f) => applyFix(f, shown.builtAt)}
            fixedIds={new Set([...fixed].filter((id) => id.startsWith(`${shown.builtAt}:`)).map((id) => id.slice(String(shown.builtAt).length + 1)))}
            onRebuild={running ? null : mainReadiness.ready ? handleBuildAll : handleBuild}
          />
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
        </Panel>
      )}
      {shownSeg && shownSeg.status !== 'skipped' && (
        <Panel
          title={`The built boards: ${shownSeg.name}`}
          subtitle={`What is under every tile, and the order the blocked tiles hand their items out. A reward item under a tile is semi-blocked until a matching dropped item opens it, and the board waits for it; Reward items under tiles: ${shownSeg.boards
            .map((_, i) => (i === 0 && shownSeg.boards.length > 1 ? 'Board 1 none' : `Board ${i + 1} rank ${allowedRewardRanks(i, shownSeg.boards.length).join(' and ')}`))
            .join(', ')}. On Board 2 they come as a rank 1 and a rank 2 together, so one dropped rank-1 item opens both.`}
        >
          <BuiltBoards boards={shownSeg.boards} />
        </Panel>
      )}
      {shownSeg && shownSeg.status !== 'skipped' && (phase === 'main' || !rcOnMainDraft) && (
        <Panel title={`Effort distribution of this build: ${shownSeg.name}`} subtitle="Where the player's own DR goes, rank by rank - one playthrough of exactly these boards.">
          {phase === 'main' && shownSeg.effortFit && (
            <p className="mb-2 text-xs text-slate-600" data-testid="effort-fit-note">
              You asked for an effort distribution in step 5, so the build generated these boards several times - same DR, same reward items - and kept the layout closest to
              it: rank 12 takes {Math.round(shownSeg.effortFit.curve?.[12] ?? 0)}% of the effort here, against {Math.round(shownSeg.effortFit.target?.[12] ?? 0)}% asked
              {shownSeg.effortFit.startDistance > shownSeg.effortFit.distance + 1e-9 ? ' (the first layout was further off)' : ''}.
            </p>
          )}
          {phase === 'main' && !shownSeg.effortFit && (
            <p className="mb-2 text-xs text-slate-500" data-testid="effort-fit-note">
              No effort distribution was typed in step 5 for this build, so the boards were generated once and this is simply what they give.
            </p>
          )}
          <BuiltEffort
            boards={shownSeg.boards.map((b) => ({ ...b, dropGroups: shown.shared?.dropGroups ?? b.dropGroups, dropGroupsConfig: shown.shared?.dropGroupsConfig ?? b.dropGroupsConfig }))}
            mainBoards={phase === 'rc' ? segments[shownSeg.index].main.boards : null}
            cacheKey={`${phase}:${shown.builtAt}:${shownSeg.index}`}
          />
        </Panel>
      )}
      {shownSeg && shownSeg.status === 'skipped' && (
        <Panel title={`Review: ${shownSeg.name}`}>
          <p className="text-sm text-slate-600" data-testid="segment-skipped">
            Not built: {shownSeg.skipReason} <LinkButton onClick={() => goTo('setup')}>Open Event setup</LinkButton>
          </p>
        </Panel>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Step 5
export function FinalizeStep({ segments, base, listOf, activeSegmentIndex, phase, phaseLabel, goTo, onOpenTool, draft, draftCurrent, applied, validation, onValidation, onDraft, onPlay, playOverride, designIssues = [], exportOverride = false, onExportOverride, onOpenTwister, drafts = {}, onDraftsChange, currentFor = {}, appliedFor = {}, validationAll = {}, rcOnMainDraft = false }) {
  const [validating, setValidating] = useState(false)
  // Phases with a draft that can be applied right now and is not yet.
  const PHASE_NAMES = { main: 'Normal', rc: 'Recompletion' }
  const pendingPhases = ['main', 'rc'].filter((p) => draftIsUsable(drafts[p]) && currentFor[p] && !appliedFor[p])
  const readyPhases = ['main', 'rc'].filter((p) => draftIsUsable(drafts[p]) && currentFor[p])

  // Applies every pending phase: Normal first, then Recompletion (which was
  // built on top of it). Each phase keeps its own snapshot, so each can be
  // reverted on its own.
  function handleApplyAll() {
    const next = { ...drafts }
    for (const p of pendingPhases) {
      const d = drafts[p]
      const v = validationAll[p]?.builtAt === d.builtAt ? validationAll[p] : null
      const snapshot = {}
      for (const s of d.segments.filter((x) => x.status !== 'skipped')) {
        const list = p === 'main' ? segments[s.index].main : segments[s.index].recompletion
        snapshot[s.index] = list.boards
        const sv = v?.bySegment?.[s.index]
        boardsWithDraftApplied(list.boards, s, d.shared, { draft: d, validation: sv ? { runs: v.runs, seed: v.seed, ok: sv.allWithinTolerance } : null }).forEach((b) => list.updateBoard(b))
      }
      next[p] = { ...d, applied: { snapshot, at: Date.now() } }
    }
    onDraftsChange(next)
  }
  const builtSegments = draft ? draft.segments.filter((s) => s.status !== 'skipped') : []
  const draftSeg = draft?.segments.find((s) => s.index === activeSegmentIndex && s.status !== 'skipped') ?? null
  // A Recompletion draft built on the not-yet-applied Normal draft can be
  // applied (together with it) but not tested on its own: testing plays the
  // applied Normal boards first, and those are not this build's yet.
  const usable = !!draft && draftCurrent && draft.status !== 'infeasible' && draft.status !== 'nothing-built' && !rcOnMainDraft
  const board0 = listOf(base).boards[0]
  const twisterReady = twisterIsConfigured(board0?.rewardChainConfig) && hasTwisterDrops(board0?.dropGroups, board0?.dropGroupsConfig, board0?.minDropRank)

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

  function handleApply() {
    const snapshot = {}
    for (const s of builtSegments) snapshot[s.index] = listOf(segments[s.index]).boards
    writeApplied(validation)
    onDraft({ ...draft, applied: { snapshot, at: Date.now() } })
  }

  function handleRevert() {
    if (!draft?.applied) return
    for (const [index, boards] of Object.entries(draft.applied.snapshot)) {
      const list = listOf(segments[Number(index)])
      boards.forEach((b) => list.updateBoard(b))
    }
    const { applied: _applied, ...rest } = draft
    onDraft(rest)
  }

  function handlePlayDraft() {
    const seg = segments[activeSegmentIndex]
    const boards = withShared(draftSeg.boards)
    onPlay(
      phase === 'main'
        ? { boards, rcBoards: seg.recompletion.boards, label: `the DRAFT ${phaseLabel.toLowerCase()} build of ${draftSeg.name}`, builtAt: draft.builtAt }
        : { boards: seg.main.boards, rcBoards: boards, label: `the applied Normal boards with the DRAFT Recompletion build of ${draftSeg.name}`, builtAt: draft.builtAt },
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
  const playingDraft = !!playOverride && playOverride.builtAt === draft?.builtAt

  return (
    <div className="flex flex-col gap-4">
      <Panel title="7. Test and finalize" subtitle="Check the draft, then apply it. Nothing reaches the Play Tester default or the exports until it is applied.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="finalize-sources">
          <div className="rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">The draft</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {!draft ? (
                <StatusChip kind="none">No draft built</StatusChip>
              ) : (
                <>
                  <StatusChip kind={!draftCurrent ? 'stale' : draft.status === 'infeasible' ? 'infeasible' : applied ? 'applied' : 'draft'} />
                  {draftCurrent && draft.status !== 'infeasible' && <StatusChip kind={validation ? 'validated' : 'estimated'} />}
                </>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {!draft
                ? 'Build a configuration in step 6 first.'
                : !draftCurrent
                  ? 'Inputs changed since it was built. Rebuild before testing or applying.'
                  : applied
                    ? 'This draft is the applied design.'
                    : draft.status === 'infeasible'
                      ? 'This build has a problem that needs a fix - step 6 says what to change.'
                      : 'Built and ready to test. Not applied yet.'}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3" data-testid="source-play">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Play Tester is using</div>
            <div className="mt-1 text-sm font-semibold text-slate-700">{playingDraft ? 'The draft' : 'The applied design'}</div>
            <p className="mt-1 text-xs text-slate-500">{playingDraft ? `It is playing ${playOverride.label}.` : 'It plays whatever is applied unless you open it on the draft below.'}</p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3" data-testid="source-export">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Exports are using</div>
            <div className="mt-1 text-sm font-semibold text-slate-700">The applied design</div>
            <p className="mt-1 text-xs text-slate-500">
              {applied && draftCurrent ? 'That is this draft.' : draft && draftCurrent ? 'Not this draft - apply it first if you want it exported.' : 'A draft is never exported.'}
            </p>
          </div>
        </div>

        {readyPhases.length > 0 && (
          <div className="mt-3 rounded-2xl border border-purple-200 bg-purple-50/70 px-4 py-3 flex flex-wrap items-center gap-3" data-testid="finalize-whole-event">
            <div className="flex-1 min-w-[16rem] text-sm text-slate-700">
              <div className="font-semibold text-purple-900">The whole event</div>
              <div className="text-xs text-slate-600">
                {['main', 'rc']
                  .map((p) => `${PHASE_NAMES[p]}: ${!drafts[p] ? 'not built' : !currentFor[p] ? 'out of date' : !draftIsUsable(drafts[p]) ? 'needs a fix' : appliedFor[p] ? 'applied' : 'built, not applied'}`)
                  .join(' · ')}
                . Applying writes the built boards, reward items, merge drops and coin values into your design; the export below then holds every sheet.
              </div>
            </div>
            <Button variant="primary" icon={Check} onClick={handleApplyAll} disabled={pendingPhases.length === 0} data-testid="finalize-apply-all">
              {pendingPhases.length === 0 ? 'Whole event applied' : `Apply whole event (${pendingPhases.map((p) => PHASE_NAMES[p]).join(' + ')})`}
            </Button>
          </div>
        )}
        {rcOnMainDraft && (
          <div className="mt-3 text-sm text-sky-800" data-testid="finalize-rc-on-main-draft">
            This Recompletion draft was built on the Normal draft, which is not applied yet. Apply the whole event above; after that it can be validated and played here.
          </div>
        )}
        {!usable && !rcOnMainDraft && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-amber-700" data-testid="finalize-blocked">
            <TriangleAlert size={15} className="shrink-0" />
            <span>{!draft ? 'There is no draft to test yet.' : !draftCurrent ? 'The draft is out of date.' : 'The last build needs a fix first (see step 6), so there is nothing to apply.'}</span>
            <LinkButton onClick={() => goTo('build')}>Go to Build boards</LinkButton>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={FlaskConical} onClick={handleValidate} disabled={!usable || validating} data-testid="finalize-validate">
            {validating ? 'Simulating…' : `Run seeded validation (${DEFAULT_VALIDATION_RUNS} players)`}
          </Button>
          <Button variant="secondary" icon={Gamepad2} onClick={handlePlayDraft} disabled={!usable || !draftSeg} data-testid="finalize-play">
            Open Play Tester on the draft
          </Button>
          <span className="flex-1" />
          <Button variant="primary" icon={Check} onClick={handleApply} disabled={!usable || applied} data-testid="finalize-apply">
            {applied ? 'Applied' : `Apply to ${builtSegments.length} segment${builtSegments.length === 1 ? '' : 's'}`}
          </Button>
          <Button variant="ghost" icon={Undo2} onClick={handleRevert} disabled={!draft?.applied} data-testid="finalize-revert">
            Revert the application
          </Button>
        </div>
        {draft?.applied && !applied && (
          <p className="mt-2 text-xs text-amber-700" data-testid="finalize-edited-after-apply">
            {appliedSegments === 0 ? 'The applied design no longer matches this draft' : `Only ${appliedSegments} of ${builtSegments.length} segments still match this draft`} - it was edited after
            it was applied (or the project was reloaded from an earlier save). Reverting restores the design from before the application.
          </p>
        )}
      </Panel>

      {v && draftSeg && (
        <Panel
          title={`Seeded validation: ${draftSeg.name}`}
          subtitle={`${validation.runs} simulated players, seed ${validation.seed} - an independent run, not the one the build scored itself on.`}
          tag={<StatusChip kind={v.allWithinTolerance ? 'validated' : 'review'}>{v.allWithinTolerance ? 'Simulation validated' : 'Validated - off target'}</StatusChip>}
        >
          <table className="w-full text-sm tabular-nums" data-testid="validation-table">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <th className="py-1 pr-3">Resource</th>
                <th className="py-1 pr-3">Requested</th>
                <th className="py-1 pr-3">Build estimate</th>
                <th className="py-1 pr-3">Validated average</th>
                <th className="py-1 pr-3">Range (p10 – p90)</th>
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
                  </tr>
                ))}
            </tbody>
          </table>
          {v.resources.every((r) => !(r.target > 0)) && <p className="text-sm text-slate-500">No reward targets to validate for this segment.</p>}
          <p className="mt-2 text-xs text-slate-500">
            {phase === 'rc' ? `${pct(v.entryRate * 100)} of players reached Recompletion; ` : ''}
            {pct(v.completionRate * 100)} finished the phase. Average player spend {dr(v.drSpent.mean)}. Energy collected {Math.round(v.energyMean)} - that implies a credit of{' '}
            {dr(v.creditFromValidation)} against the {dr(draftSeg.subsidy.creditApplied)} the boards were built with.
          </p>
        </Panel>
      )}

      <Panel title="Twister spin costs" subtitle="Optional. If you typed twists in step 4, the build has already priced them and Apply sets the prices. The Twister tool is for a closer look." tag={<SharedTag />}>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600" data-testid="finalize-twister">
          <Tornado size={16} className="text-teal-600 shrink-0" />
          <span className="flex-1 min-w-[16rem] text-xs text-slate-500">
            {!twisterReady
              ? 'Twister is not set up for this phase. That does not affect this build - set it up whenever you need it.'
              : 'Twister income is measured on exactly the configuration you pick. A proposal does not have to be applied to see its Twister economy.'}
          </span>
          {twisterReady && (
            <Button variant="secondary" size="sm" onClick={() => onOpenTwister('draft')} disabled={!usable} data-testid="finalize-twister-draft">
              Analyze Twister on the draft
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => (twisterReady ? onOpenTwister('applied') : onOpenTool('twister'))} data-testid="finalize-open-twister">
            {twisterReady ? 'Analyze Twister on the applied design' : 'Set up Twister'}
          </Button>
        </div>
      </Panel>

      <Panel title="After rank 14: endless mode" subtitle="What play becomes once the second grand prize is won. Read from this segment's applied Recompletion design; you can play it in the Play Tester.">
        <EndlessPreview mainBoards={segments[activeSegmentIndex]?.main?.boards} rcBoards={segments[activeSegmentIndex]?.recompletion?.boards} />
      </Panel>

      <Panel title="Export" subtitle="The Ops workbook for every segment, from the applied design.">
        <ExportGate issues={designIssues} override={exportOverride} onOverride={onExportOverride} onRebuild={() => goTo('build')}>
          {(allowed) => (
            <div className="flex flex-wrap items-center gap-3" data-testid="finalize-export">
              <Button variant="secondary" icon={Download} onClick={handleExport} disabled={!allowed} data-testid="finalize-download">
                Download the applied configuration (all segments)
              </Button>
              <Button variant="ghost" size="sm" icon={Play} onClick={() => onOpenTool('syntax')}>
                Open the Syntax tool
              </Button>
              {draft && draftCurrent && !applied && draft.status !== 'infeasible' && (
                <span className="text-xs text-amber-700" data-testid="export-warning">
                  The draft you are reviewing is NOT applied, so it is not what this downloads.
                </span>
              )}
            </div>
          )}
        </ExportGate>
      </Panel>
    </div>
  )
}

