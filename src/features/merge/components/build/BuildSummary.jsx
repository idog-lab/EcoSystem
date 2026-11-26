import { ArrowRight, Hammer, TriangleAlert } from 'lucide-react'
import Button from '../../../../components/ui/Button'
import { Panel, StatusChip, MatchChip, SegmentTag } from './buildUi'
import { REWARD_TYPES, REWARD_TARGET_LABELS, COIN_TYPE, formatRewardAmount } from '../../lib/rewards/rewardChain'
import { offTargetToleranceFor } from '../../lib/rewards/smallRewardsWorkflow'
import { TWISTER_WINDOW_MARGIN_PTS } from '../../lib/rewards/twisterCadence'
import { CLOSE_REWARD_SHARE, rewardMatch, spendMatch, twisterMatch } from '../../lib/build/resultMatch'

// THE FIRST THING SHOWN AFTER A BUILD (economist: "lead with the information
// needed to judge a build"): for every built segment, what the player was
// asked to spend and collect against what the average simulated player does,
// when the twists are reached, anything that is off, and the next thing to do.
// Everything else the build reports - the subsidy accounting, the containers,
// the Twister detail, the boards - is below it, folded.
// "Close" and "Within margin" are two different words here (resultMatch.js),
// and the panel says that these are averages: a design with nothing to look
// at is not a promise that every player gets exactly this.
const signedPct = (value) => `${value >= 0.05 ? '+' : value <= -0.05 ? '−' : '±'}${Math.abs(value).toFixed(Math.abs(value) < 10 ? 1 : 0)}%`
const whole = (value) => Math.round(value).toLocaleString()

function segmentChip(seg) {
  if (seg.status === 'skipped') return { kind: 'none', label: 'Not built' }
  if (seg.status === 'infeasible') return { kind: 'infeasible', label: 'Needs a fix' }
  if (seg.status === 'review' && (seg.causes?.length ?? 0) > 0) return { kind: 'review', label: 'Can be improved' }
  return { kind: 'applied', label: 'Ready' }
}

function Figure({ asked, got, diffPct, match, title, hints }) {
  return (
    <div className="leading-tight" title={title}>
      <div className="whitespace-nowrap">
        <span className="font-semibold text-slate-800" data-part="got">
          {got}
        </span>
        <span className="text-slate-400"> of {asked}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1">
        <MatchChip kind={match} title={hints?.[match]} />
        <span className={`text-[11px] ${match === 'off' ? 'font-semibold text-amber-700' : 'text-slate-500'}`}>{signedPct(diffPct)}</span>
      </div>
    </div>
  )
}

export default function BuildSummary({ result, shownSegments = null, phase, activeSegmentIndex, onSelectSegment, current, applied, tested, running, onNext, onRebuild, onShowSegment }) {
  if (!result?.segments?.length) return null
  const built = result.segments.filter((s) => s.status !== 'skipped')
  // (Only the segments in sight are named as not built.)
  const skipped = result.segments.filter((s) => s.status === 'skipped' && (!shownSegments || shownSegments.includes(s.index)))
  if (built.length === 0) return null
  const window = result.twister?.window ?? [70, 75]
  const twisterRows = new Map((result.twister?.rows ?? []).map((r) => [r.index, r]))
  const anyTwister = built.some((s) => (twisterRows.get(s.index)?.twists ?? 0) > 0)
  const targeted = REWARD_TYPES.filter((t) => built.some((s) => (s.resources ?? []).some((r) => r.type === t && r.target > 0)))
  const count = (kind) => built.filter((s) => segmentChip(s).kind === kind).length
  const needsFix = built.filter((s) => s.status === 'infeasible')
  const improvable = count('review')
  const rewardMarginPct = Math.round(offTargetToleranceFor(phase) * 100)
  const players = built[0]?.evaluation?.runs ?? built[0]?.demandFit?.players ?? null
  // What the three words mean, said where they are shown: in the hover of each chip.
  const hints = {
    close: `Close: within ${Math.round(CLOSE_REWARD_SHARE * 100)}% of a reward amount, or inside the build's own margin for the DR demand.`,
    within: `Within margin: accepted but not close - up to ${rewardMarginPct}% for a reward; for the DR, 5% of the demand or 30 DR, whichever is smaller.`,
    off: 'Off target: outside the accepted margin.',
  }
  const open = (index) => {
    onSelectSegment(index)
    onShowSegment?.()
  }

  const headline =
    needsFix.length > 0
      ? `${needsFix.length} of ${built.length} segment${built.length === 1 ? '' : 's'} need${needsFix.length === 1 ? 's' : ''} a fix before this can be applied.`
      : improvable > 0
        ? `${built.length} segment${built.length === 1 ? '' : 's'} built and usable. ${improvable} can be improved - see "What to look at".`
        : `${built.length} segment${built.length === 1 ? '' : 's'} built. Nothing to look at: every figure is inside its margin.`

  return (
    <Panel
      title={`How the ${phase === 'rc' ? 'Recompletion' : 'normal event'} build turned out`}
      subtitle="What you asked for against what the average simulated player pays and collects. Click a segment to see it in detail below."
      tag={<SegmentTag />}
      data-testid="build-summary"
    >
      <div
        className={`mb-3 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${needsFix.length > 0 ? 'border-red-200 bg-red-50' : !current ? 'border-amber-200 bg-amber-50' : improvable > 0 ? 'border-amber-200 bg-amber-50/60' : 'border-emerald-200 bg-emerald-50'}`}
        data-testid="build-summary-verdict"
        data-verdict={needsFix.length > 0 ? 'needs-fix' : !current ? 'stale' : improvable > 0 ? 'improvable' : 'ready'}
      >
        {(needsFix.length > 0 || !current) && <TriangleAlert size={16} className="shrink-0 text-amber-700" />}
        <div className="min-w-[16rem] flex-1 text-sm text-slate-800">
          <div className="font-semibold">{!current ? 'These results are out of date: an input changed after the build.' : headline}</div>
          <div className="mt-0.5 text-xs text-slate-600" data-testid="build-summary-next">
            {!current
              ? 'Nothing was erased, and what is in use is still this build. Build again to bring it up to date.'
              : needsFix.length > 0
                ? `Open ${needsFix[0].name}: each problem there comes with a quick fix. Then build again. This build is not in use.`
                : applied
                  ? tested
                    ? 'This build is in use: the Play tester and Syntax use it.'
                    : 'This build is in use: the Play tester and Syntax use it. Next: test it on players with real luck, or play it yourself.'
                  : 'This build is not in use - step 6 can put it in use.'}
          </div>
        </div>
        {!running &&
          (!current ? (
            <Button variant="primary" icon={Hammer} onClick={onRebuild} data-testid="build-summary-action">
              Build again
            </Button>
          ) : needsFix.length > 0 ? (
            <Button variant="primary" onClick={() => open(needsFix[0].index)} data-testid="build-summary-action">
              Show what to fix
            </Button>
          ) : (
            <Button variant="primary" icon={ArrowRight} onClick={onNext} data-testid="build-summary-action">
              Next: test and export
            </Button>
          ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[60rem] text-sm tabular-nums" data-testid="build-summary-table">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              <th className="py-2 pr-3">Segment</th>
              <th className="py-2 pr-3">Result</th>
              <th className="py-2 pr-3">
                Player spends <span className="normal-case tracking-normal font-normal">(DR, against the demand)</span>
              </th>
              {targeted.map((t) => (
                <th key={t} className="py-2 pr-3">
                  {REWARD_TARGET_LABELS[t]}
                  {t === COIN_TYPE && <span className="normal-case tracking-normal font-normal"> (× allowance)</span>}
                </th>
              ))}
              {anyTwister && <th className="py-2 pr-3">Twister</th>}
              <th className="py-2 pr-3">What to look at</th>
            </tr>
          </thead>
          <tbody>
            {built.map((s) => {
              const chip = segmentChip(s)
              const fit = s.demandFit
              const spend = spendMatch(fit)
              const tw = twisterRows.get(s.index)
              const t = tw?.demandTiming ?? null
              const outside = t?.reachPct == null ? null : t.reachPct < window[0] ? window[0] - t.reachPct : t.reachPct > window[1] ? t.reachPct - window[1] : 0
              return (
                <tr
                  key={s.index}
                  className={`cursor-pointer border-b border-slate-100 align-top ${s.index === activeSegmentIndex ? 'bg-purple-50/60' : 'hover:bg-slate-50'}`}
                  onClick={() => open(s.index)}
                  data-summary-segment={s.index}
                >
                  <td className="py-2 pr-3 font-semibold whitespace-nowrap text-slate-700">
                    {s.name}
                    {s.index === 0 && <span className="ml-1.5 text-[11px] text-purple-600">base</span>}
                  </td>
                  <td className="py-2 pr-3">
                    <StatusChip kind={chip.kind}>{chip.label}</StatusChip>
                  </td>
                  <td className="py-2 pr-3" data-cell="spend" data-match={spend ?? 'none'}>
                    {spend ? (
                      <Figure asked={`${whole(fit.configured)} DR`} got={whole(fit.paid.mean)} diffPct={fit.differencePct} match={spend} hints={hints} title="What the average simulated player pays in this phase, against the DR demand you typed" />
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  {targeted.map((type) => {
                    const r = (s.resources ?? []).find((x) => x.type === type)
                    const match = rewardMatch(r, phase)
                    return (
                      <td key={type} className="py-2 pr-3" data-cell={`reward-${type}`} data-match={match ?? 'none'}>
                        {match ? (
                          <Figure asked={formatRewardAmount(type, r.target)} got={formatRewardAmount(type, r.predicted)} diffPct={((r.predicted - r.target) / r.target) * 100} match={match} hints={hints} title="What the average simulated player collects, against the amount this segment was asked to get" />
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    )
                  })}
                  {anyTwister && (
                    <td className="py-2 pr-3" data-cell="twister" data-verdict={t?.verdict ?? 'none'} data-match={twisterMatch(t) ?? 'none'}>
                      {!tw || !(tw.twists > 0) || !t ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <div className="leading-tight">
                          <div className="whitespace-nowrap">
                            <span className="font-semibold text-slate-800">{tw.twists} twists</span>
                            <span className="text-slate-400"> {t.reachPct == null ? 'not reached' : `by ${Math.round(t.reachPct)}% of demand`}</span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            <MatchChip
                              kind={twisterMatch(t) ?? 'off'}
                              title={
                                twisterMatch(t) === 'close'
                                  ? `Close: the twists are reached inside the ${window[0]}-${window[1]}% window.`
                                  : twisterMatch(t) === 'within'
                                    ? `Within margin: up to ${TWISTER_WINDOW_MARGIN_PTS} points outside the window passes (${window[0] - TWISTER_WINDOW_MARGIN_PTS}-${window[1] + TWISTER_WINDOW_MARGIN_PTS}% of the DR demand).`
                                    : `Off target: more than ${TWISTER_WINDOW_MARGIN_PTS} points outside the ${window[0]}-${window[1]}% window, or not reached.`
                              }
                            >
                              {t.verdict === 'in-window' ? `In the ${window[0]}-${window[1]}% window` : t.verdict === 'never' ? 'Not reached' : `${outside < 1 ? 'under 1 pt' : `${Math.round(outside)} pts`} ${t.verdict}`}
                            </MatchChip>
                            {t.chances != null && (
                              <span className="text-[11px] text-slate-500 whitespace-nowrap">
                                {t.chances} chances to spin × {t.twistsPerChance != null ? t.twistsPerChance.toFixed(1) : '—'}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </td>
                  )}
                  <td className="py-2 pr-3 text-xs text-slate-600" data-cell="look-at">
                    {s.causes?.length ? (
                      <ul className="ml-4 list-disc">
                        {s.causes.slice(0, 3).map((c, i) => (
                          <li key={i}>{c.short ?? c.title}</li>
                        ))}
                        {s.causes.length > 3 && <li className="list-none text-slate-400">and {s.causes.length - 3} more</li>}
                        {s.causes.some((c) => (c.fixes ?? []).length > 0) && <li className="list-none font-medium text-purple-700">Quick fixes - click the row</li>}
                      </ul>
                    ) : (
                      <span className="text-slate-400">Nothing</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {skipped.length > 0 && (
        <p className="mt-2 text-xs text-slate-400" data-testid="build-summary-skipped">
          Not built: {skipped.map((s) => s.name).join(', ')} - {skipped.length === 1 ? 'it has' : 'they have'} no DR demand in step 1.
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500" data-testid="build-summary-legend">
        Every figure is the average of {players ?? 'the'} simulated players with average luck - one player differs from the next. Step 6 plays players with their own luck and says how many of
        them land near. Point at a chip to see what Close, Within margin and Off target mean.
      </p>
    </Panel>
  )
}
