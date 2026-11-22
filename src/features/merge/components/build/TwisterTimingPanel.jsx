import { Fragment, useRef, useState } from 'react'
import { FlaskConical, Square } from 'lucide-react'
import Button from '../../../../components/ui/Button'
import { StatusChip, Panel, SegmentTag } from './buildUi'

// Inside a folded section the panel has no card of its own: just its text.
function Shell({ embedded, title, subtitle, tag, children }) {
  if (!embedded) return <Panel title={title} subtitle={subtitle} tag={tag}>{children}</Panel>
  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">{subtitle}</p>
      {children}
    </div>
  )
}
import { boardsWithDraftApplied } from '../../lib/build/eventBuild'
import { REWARD_TYPES, REWARD_TARGET_LABELS } from '../../lib/rewards/rewardChain'
import { candidateById, measureCandidate, timingOf, builtTwisterOf, twisterMark, TWISTER_WINDOW_PCT, TWISTER_WINDOW_MARGIN_PTS, DEMAND_MARKS } from '../../lib/rewards/twisterCadence'

// THE TWISTER OF A BUILD (economist: the twists asked should be reached
// "around 70-75% of their segment's DR demand spent", in steady, recurring
// chances to spin). For every segment the build fits its own four Twister
// values and its own price of a twist on the final boards (twisterCadence.js:
// fitTwisterForBuild); this panel shows the result, timed on the DR the
// player has paid:
//   - WHEN the twists are reached (the window) and HOW they arrive (chances
//     to spin, twists a chance, the longest wait) are two different things
//     and are shown apart;
//   - what is reached during play is kept apart from what only the phase-end
//     collection gives;
//   - a segment outside the window says how far, and where it CAN land.
// The comparison at the bottom is an EXPERIMENT: it changes nothing.
const VERDICT = {
  'in-window': { kind: 'validated', label: 'In the window', pace: 'On track' },
  early: { kind: 'review', label: 'Early', pace: 'Early' },
  late: { kind: 'review', label: 'Late', pace: 'Late' },
  never: { kind: 'infeasible', label: 'Not reached', pace: 'Short' },
}
const EXPERIMENTS = [candidateById('current'), candidateById('bigger79')]
const EXPERIMENT_RUNS = 150
const pct = (v) => (v == null ? '—' : `${Math.round(v)}%`)
const points = (v) => `${v} point${v === 1 ? '' : 's'}`
const share = (v) => (v == null ? '—' : `${Math.round(v * 100)} of 100`)
// How far outside the window, in points of demand (0 inside it).
const distance = (reach, window) => (reach == null ? null : reach < window[0] ? window[0] - reach : reach > window[1] ? reach - window[1] : 0)

export default function TwisterTimingPanel({ phase, draft, segments, activeSegmentIndex, embedded = false }) {
  const rows = draft?.twister?.rows ?? []
  const [results, setResults] = useState(null)
  const [running, setRunning] = useState(null)
  const cancelled = useRef(false)
  if (rows.length === 0) return null
  const window = draft.twister.window ?? TWISTER_WINDOW_PCT
  const timed = rows.filter((r) => r.demandTiming)
  const asked = timed.filter((r) => r.twists > 0)
  const inWindow = asked.filter((r) => r.demandTiming.verdict === 'in-window')
  const outside = asked.filter((r) => r.demandTiming.verdict !== 'in-window')
  const row = timed.find((r) => r.index === activeSegmentIndex) ?? timed[0] ?? null
  const draftSeg = row ? draft.segments.find((s) => s.index === row.index) : null

  const compare = async () => {
    cancelled.current = false
    const seg = segments[row.index]
    const mine = boardsWithDraftApplied((phase === 'rc' ? seg.recompletion : seg.main).boards, draftSeg, draft.shared, { draft }).map((b) => ({ ...b, twisterSpinCost: row.cost }))
    const segment = { name: row.name, boards: phase === 'rc' ? seg.main.boards : mine, rcBoards: phase === 'rc' ? mine : null, twists: { main: phase === 'main' ? row.twists : null, rc: phase === 'rc' ? row.twists : null }, step: row.step ?? 1 }
    const out = []
    for (let i = 0; i < EXPERIMENTS.length; i++) {
      setRunning({ done: i, total: EXPERIMENTS.length })
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (cancelled.current) break
      // Recompletion plays the normal event's Twister values: only its price is fitted.
      const m = measureCandidate({ segment, candidate: EXPERIMENTS[i], runs: EXPERIMENT_RUNS, phases: [phase], lockedValues: phase === 'rc' || row.valuesLocked ? builtTwisterOf(mine).values : null })
      const part = m[phase]
      out.push({ id: EXPERIMENTS[i].id, label: EXPERIMENTS[i].label, changes: EXPERIMENTS[i].changes, rules: EXPERIMENTS[i].rules, fit: part?.fit ?? null, timing: timingOf(part?.atFit), summary: part?.atFit ?? null })
    }
    setRunning(null)
    if (!cancelled.current) setResults({ index: row.index, phase, rows: out })
  }
  const base = results?.rows[0]?.summary ?? null
  const versus = (summary, type) => (base?.payouts[type].mean > 0 && summary ? Math.round((100 * summary.payouts[type].mean) / base.payouts[type].mean) : null)

  return (
    <Shell
      embedded={embedded}
      title="Twister: values, the price of a twist, and when the twists are reached"
      subtitle={`Each segment gets its own four Twister values and its own price, fitted on these boards so that its typical player reaches the twists you asked for when they have paid ${window[0]}-${window[1]}% of the segment's DR demand. Progress is paid generator DR ÷ the DR demand (free merge-energy taps add nothing; it is not clamped at 100%). Played by ${draft.twister.runs} players per segment, each with their own luck. These values and prices are part of the build.`}
      tag={<SegmentTag />}
    >
      <p
        className={`mb-2 rounded-xl border px-3 py-2 text-sm font-semibold ${asked.length > 0 && outside.length === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}
        data-testid="twister-track"
        data-on-track={asked.length > 0 && outside.length === 0 ? 'yes' : 'no'}
        data-in-window={inWindow.length}
        data-asked={asked.length}
      >
        {asked.length === 0
          ? 'No twists were typed, so there is nothing to time.'
          : outside.length === 0
            ? `On track: in all ${asked.length} segment${asked.length === 1 ? '' : 's'} the typical player reaches the twists inside the ${window[0]}-${window[1]}% window.`
            : `${inWindow.length} of ${asked.length} segment${asked.length === 1 ? '' : 's'} reach the twists inside the ${window[0]}-${window[1]}% window. Outside it: ${outside
                .map((r) => (r.demandTiming.reachPct == null ? `${r.name} (not reached)` : `${r.name} at ${Math.round(r.demandTiming.reachPct)}% (${Math.round(distance(r.demandTiming.reachPct, window))} points ${r.demandTiming.reachPct < window[0] ? 'early' : 'late'}${twisterMark(r.demandTiming) === 'near' ? ', inside the margin' : ''})`))
                .join(', ')}.`}
        {asked.length > 0 && ` A segment passes when its twists are reached within ${TWISTER_WINDOW_MARGIN_PTS} points of the window (${window[0] - TWISTER_WINDOW_MARGIN_PTS}-${window[1] + TWISTER_WINDOW_MARGIN_PTS}%).`}
      </p>
      {/* Fifteen columns with a sentence for a head each were squeezed to a
          word a line. The heads are grouped (what you asked, what the build
          gave, when the player has the twists, how they arrive), each column
          is as wide as its numbers, and the note has a line of its own. */}
      <div className="overflow-x-auto" data-testid="twister-demand-timing">
        <table className="w-full text-sm tabular-nums" data-testid="build-twister-prices">
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              <th rowSpan={2} className="border-b border-slate-200 py-1.5 pr-4 align-bottom">
                Segment
              </th>
              <th rowSpan={2} className="border-b border-slate-200 py-1.5 pr-3 text-right align-bottom" title="The twists you asked for in step 3">
                Twists asked
              </th>
              <th colSpan={2} className="border-b border-slate-100 py-1 pr-4 text-right">
                The build gave
              </th>
              <th colSpan={DEMAND_MARKS.length + 3} className="border-b border-slate-100 py-1 pr-4 text-right">
                Twists the typical player has, by how much of the DR demand is paid
              </th>
              <th colSpan={3} className="border-b border-slate-100 py-1 pr-3 text-right">
                How the twists arrive
              </th>
            </tr>
            <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              <th className="whitespace-nowrap py-1.5 pr-3 text-right" title="The four Twister DR values of this segment, ranks 1 to 4">
                Values
              </th>
              <th className="whitespace-nowrap py-1.5 pr-3 text-right" title="The price of a twist, in Twister DR">
                Price
              </th>
              {DEMAND_MARKS.map((mark) => (
                <th key={mark} className="whitespace-nowrap py-1.5 pr-3 text-right" title={`Twists the typical player has when they have paid ${mark}% of the DR demand`}>
                  {mark}%
                </th>
              ))}
              <th className="whitespace-nowrap py-1.5 pr-4 text-right" title="Twists the typical player has when the phase ends">
                By the end
              </th>
              <th className="py-1.5 pr-3 text-right" title="How much of the DR demand the typical player has paid when they can buy the last of the twists you asked for">
                All of them at
              </th>
              <th className="py-1.5 pr-3">
                Target {window[0]}-{window[1]}%
              </th>
              <th className="min-w-[5.5rem] py-1.5 pr-3 text-right" title="Of 100 players: reach the twists during play / only with what is collected when the phase ends / never">
                In play / at the end / never
              </th>
              <th className="whitespace-nowrap py-1.5 pr-4 text-right" title="How many separate times the typical player can spin during play, how many twists each one pays for, and when the first one comes">
                Chances to spin
              </th>
              <th className="py-1.5 pr-3 text-right" title="The longest stretch with no new twist, in points of demand">
                Longest wait
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const t = r.demandTiming
              const verdict = t?.verdict ? VERDICT[t.verdict] : null
              const note = r.message ?? (t ? `${Math.round(t.finishedItems)} finished Twister items in play; the phase ends at ${pct(t.endPct)} of the demand.` : '')
              return (
                <Fragment key={r.index}>
                  <tr className="align-top" data-twister-price={r.index} data-demand-timing={r.index} data-verdict={t?.verdict ?? ''}>
                    <td className="whitespace-nowrap pt-1.5 pr-4 font-semibold text-slate-700">{r.name}</td>
                    <td className="pt-1.5 pr-4 text-right">{r.twists ?? '—'}</td>
                    <td className="whitespace-nowrap pt-1.5 pr-4 text-right" data-field="values">
                      {r.values ? r.values.join(' / ') : '—'}
                      {r.valuesLocked && <span className="block text-[11px] text-slate-500">{r.valuesLocked === 'typed' ? 'as you typed them' : "the normal event's"}</span>}
                    </td>
                    <td className="whitespace-nowrap pt-1.5 pr-4 text-right font-semibold text-purple-700" data-field="price">
                      {r.cost == null ? '—' : `${r.cost} Twister DR`}
                    </td>
                    {DEMAND_MARKS.map((mark) => {
                      const at = t?.spinsAt?.[mark]
                      return (
                        <td key={mark} className="whitespace-nowrap pt-1.5 pr-3 text-right" data-mark={mark}>
                          {!at ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <>
                              <span className={`font-semibold ${r.twists > 0 && at.typical >= r.twists ? 'text-emerald-700' : 'text-slate-700'}`} data-field="twists">
                                {Math.round(at.typical)}
                                <span className="sr-only"> twist{Math.round(at.typical) === 1 ? '' : 's'}</span>
                              </span>
                              {at.finishedBefore > 0.5 && (
                                <span className="text-slate-400" title="Most players have finished the phase by then" data-finished="yes">
                                  *
                                </span>
                              )}
                            </>
                          )}
                        </td>
                      )
                    })}
                    <td className="whitespace-nowrap pt-1.5 pr-4 text-right" data-field="typical">
                      {r.spinsMedian == null ? '—' : r.spinsMedian}
                      {r.spinsMedian != null && r.attainment != null && <span className="block text-[11px] text-slate-500">{Math.round(r.attainment * 100)}% get all {r.twists}</span>}
                    </td>
                    <td className="whitespace-nowrap pt-1.5 pr-4 text-right font-semibold text-slate-700" data-field="finish">
                      {!t || !(r.twists > 0) ? '—' : t.reachPct == null ? <span className="text-amber-700">not by the end</span> : pct(t.reachPct)}
                      {t && r.twists > 0 && t.reachP10 != null && (
                        <span className="block text-[11px] font-normal text-slate-500">
                          {pct(t.reachP10)} to {pct(t.reachP90)}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap pt-1.5 pr-4" data-field="pace" data-pace={r.pace ?? ''}>
                      {verdict ? <StatusChip kind={verdict.kind}>{verdict.pace}</StatusChip> : '—'}
                      {t?.reachPct != null && t.verdict !== 'in-window' && <span className="block text-[11px] text-slate-500">{points(Math.round(distance(t.reachPct, window)))} {t.reachPct < window[0] ? 'early' : 'late'}</span>}
                    </td>
                    <td className="whitespace-nowrap pt-1.5 pr-4 text-right" data-field="by">
                      {t?.inPlay == null ? '—' : `${Math.round(t.inPlay * 100)} / ${Math.round((t.onlyAtEnd ?? 0) * 100)} / ${Math.round((t.never ?? 0) * 100)}`}
                    </td>
                    <td className="whitespace-nowrap pt-1.5 pr-4 text-right" data-field="chances">
                      {t?.chances == null ? '—' : `${Math.round(t.chances)} × ${t.twistsPerChance == null ? '—' : t.twistsPerChance.toFixed(1)} twists`}
                      <span className={`block text-[11px] ${t?.twistsPerChance >= 1.6 ? 'text-amber-700' : 'text-slate-500'}`}>
                        {t?.twistsPerChance >= 1.6 ? 'in jumps · ' : ''}
                        {t?.firstSpinPct == null ? '' : `first at ${pct(t.firstSpinPct)}`}
                      </span>
                    </td>
                    <td className="whitespace-nowrap pt-1.5 pr-3 text-right">{t?.longestGap == null ? '—' : points(Math.round(t.longestGap))}</td>
                  </tr>
                  <tr className="border-b border-slate-100" data-twister-note={r.index}>
                    <td />
                    <td colSpan={DEMAND_MARKS.length + 9} className={`pb-1.5 pr-3 text-xs ${r.message ? 'text-amber-700' : 'text-slate-400'}`} data-field="note">
                      {note}
                    </td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">* most players have finished the phase by then. Hover a column head for what it counts.</p>
      <p className="mt-2 text-xs text-slate-600" data-testid="twister-sized">
        The Twister drops are one table for every segment and both phases: a merge that makes rank 5 drops one rank-1 Twister item, and from rank 7 to rank 9 the Twister item drops with the reward. What differs per segment is the four
        values and the price. Twister DR is its own currency (not merge energy, not the DR of the boards): only the ratio of a value to the price changes anything a player sees, so the fit takes the simplest numbers that land in the
        window - values not under 2 / 5 / 12 / 30, then the lowest whole price that fits (or the lowest in your steps, if you asked for rounding in step 3). &quot;All of them at&quot; is the middle player; the smaller line is where 8 in 10 players fall. What is merged up and tapped when the top
        rank is made counts at that moment (&quot;at the end&quot;), never earlier.
      </p>
      {draft.twister.sizing?.short && (
        <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800" data-testid="twister-short">
          In at least one segment the typical player does not reach the twists at any supported price: there are too few Twister items in its phase. Ask for fewer twists there, or use smaller price steps.
        </p>
      )}

      {row && row.twists > 0 && (
        <div className="mt-4 rounded-2xl border border-purple-100 bg-purple-50/40 px-3 py-3" data-testid="twister-experiments">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-800">An experiment: bigger Twister items at ranks 7 to 9, for {row.name}</div>
              <div className="text-xs text-slate-600" data-note>
                Plays this build&apos;s drops and the same drops with the Twister item of the merges that make ranks 7, 8 and 9 one rank higher (rank 3 at most) - rank 5 keeps its one rank-1 item - {EXPERIMENT_RUNS} players each with
                the same luck, and fits values and price to each. More finished items means more, smaller chances to spin. Nothing here changes the build or a drop rule.
              </div>
            </div>
            {running ? (
              <Button variant="ghost" icon={Square} onClick={() => (cancelled.current = true)} data-testid="twister-experiments-stop">
                Stop ({running.done} of {running.total})
              </Button>
            ) : (
              <Button variant="secondary" icon={FlaskConical} onClick={compare} data-testid="twister-experiments-run">
                Compare for {row.name}
              </Button>
            )}
          </div>
          {results && results.index === row.index && results.phase === phase && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[64rem] text-sm tabular-nums" data-testid="twister-experiments-table">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="py-1.5 pr-3">Drops</th>
                    <th className="py-1.5 pr-3">Values and price that fit</th>
                    <th className="py-1.5 pr-3 text-right">Has them all at</th>
                    <th className="py-1.5 pr-3 text-right" title="Points of demand outside the 70-75% window (0 = inside)">Outside the window by</th>
                    <th className="py-1.5 pr-3 text-right" title="Players who reach the twists within 10 points of the window">Near it</th>
                    <th className="py-1.5 pr-3 text-right">First spin</th>
                    <th className="py-1.5 pr-3 text-right">Chances to spin</th>
                    <th className="py-1.5 pr-3 text-right">Longest wait</th>
                    <th className="py-1.5 pr-3 text-right" title="What the other rewards pay, against this build's drops (100 = the same)">Other rewards</th>
                    <th className="py-1.5 pr-3 text-right">DR paid</th>
                  </tr>
                </thead>
                <tbody>
                  {results.rows.map((x) => {
                    const t = x.timing
                    const others = REWARD_TYPES.map((type) => versus(x.summary, type))
                    return (
                      <tr key={x.id} className="border-b border-slate-100 align-top" data-experiment={x.id} data-in-window={x.fit?.inWindow ? 'yes' : 'no'}>
                        <td className="max-w-xs py-1.5 pr-3">
                          <div className="font-semibold text-slate-700">{x.id === 'current' ? 'This build' : x.label}</div>
                          <div className="text-[11px] text-slate-500">{x.changes}</div>
                        </td>
                        <td className="whitespace-nowrap py-1.5 pr-3">{x.fit ? `${x.fit.values.join(' / ')} · ${x.fit.cost} DR a twist` : '—'}</td>
                        <td className="py-1.5 pr-3 text-right font-semibold text-slate-700" data-field="reach">{t?.reachPct == null ? 'not reached' : pct(t.reachPct)}</td>
                        <td className="py-1.5 pr-3 text-right" data-field="distance">{t?.reachPct == null ? '—' : points(Math.round(distance(t.reachPct, window) * 10) / 10)}</td>
                        <td className="py-1.5 pr-3 text-right">{share(t?.near)}</td>
                        <td className="py-1.5 pr-3 text-right">{pct(t?.firstSpinPct)}</td>
                        <td className="py-1.5 pr-3 text-right" data-field="chances">{t?.chances == null ? '—' : `${Math.round(t.chances)} × ${t.twistsPerChance?.toFixed(1) ?? '—'}`}</td>
                        <td className="py-1.5 pr-3 text-right">{t?.longestGap == null ? '—' : points(Math.round(t.longestGap))}</td>
                        <td className="whitespace-nowrap py-1.5 pr-3 text-right text-slate-600" data-field="others" title={REWARD_TYPES.map((type) => REWARD_TARGET_LABELS[type]).join(' / ')}>
                          {others.map((v) => (v == null ? '—' : v)).join(' / ')}
                        </td>
                        <td className="py-1.5 pr-3 text-right">{x.summary && base ? `${Math.round((100 * x.summary.drSpent.mean) / base.drSpent.mean)}%` : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-slate-500">
                Other rewards: {REWARD_TYPES.map((type) => REWARD_TARGET_LABELS[type]).join(' / ')}, as measured with these drops against this build&apos;s (100 = the same amount). One batch of simulated players: a few points between
                two rows is within the noise.
              </p>
            </div>
          )}
        </div>
      )}
    </Shell>
  )
}
