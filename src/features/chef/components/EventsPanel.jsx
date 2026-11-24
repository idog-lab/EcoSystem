import { useMemo, useRef, useState } from 'react'
import { Check as CheckIcon, RotateCcw, Sparkles, Square, Trash2 } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Collapsible from '../../../components/ui/Collapsible'
import { VARIATION_LABELS } from '../lib/chefModel'
import { shareInterval } from '../lib/chefRng'
import { describeTargets, planOf } from '../lib/chefGenerator'
import { EVENTS_STATUS_LABELS, applyEvents, canApplyEvents, eventsIsInUse, eventsPlanOf, eventsProblems, eventsStaleReason, generateEvents, isSuggestedEvent, undoEvents } from '../lib/chefEvents'
import { num, pct } from '../lib/chefFormat'
import { Num, TD, TH } from './chefUi'
import { WhyPanel } from './CatchupPanel'

// STEP 4, THE THIRD CHOICE - SPECIAL-EVENT SUGGESTIONS (chefEvents.js). From
// the planning: when players are in danger of missing something, the tool
// suggests a special event in the calendar that gives it. On the economist's
// answers: a share of players the tool finds; common, rare and the
// semi-blocker; the fewest ingredients given between equals; one event for
// every segment. Nothing changes until Apply; one undo takes it out.

const VERDICT = {
  met: ['Met', 'bg-emerald-50 text-emerald-700'],
  'met-unsure': ['Met, too close to call', 'bg-amber-50 text-amber-800'],
  'missed-unsure': ['Missed, too close to call', 'bg-amber-50 text-amber-800'],
  missed: ['Missed', 'bg-rose-50 text-rose-700'],
}

function Share({ now, next, n }) {
  if (next == null) return <span className="text-slate-400">-</span>
  const i = shareInterval(Math.round(next * n), n)
  const diff = now == null ? null : Math.round((next - now) * 100)
  return (
    <span className="whitespace-nowrap tabular-nums" title={`With the suggestion between ${pct(i.low, 1)} and ${pct(i.high, 1)} with other players (${n} played).${now == null ? '' : ` Now ${pct(now, 1)}.`}`}>
      {now != null && <span className="text-slate-500">{pct(now)} → </span>}
      <span className="font-semibold text-slate-800">{pct(next)}</span>
      {diff != null && diff !== 0 && <span className={`ml-1 text-[11px] font-semibold ${diff > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{diff > 0 ? `+${diff}` : diff}</span>}
    </span>
  )
}

export default function EventsPanel({ state, update, onGoTo }) {
  const eplan = useMemo(() => eventsPlanOf(state), [state])
  const tplan = useMemo(() => planOf(state), [state])
  const suggestion = state.generator?.events ?? null
  const applied = state.generator?.eventsApplied ?? null
  const [progress, setProgress] = useState(null)
  const cancel = useRef(false)
  const running = progress != null && !progress.cancelled
  const problems = useMemo(() => eventsProblems(state, eplan, tplan), [state, eplan, tplan])
  const targets = useMemo(() => describeTargets(state, tplan), [state, tplan])
  const yours = (state.sources ?? []).filter((s) => !isSuggestedEvent(s))
  const setPlan = (fn) => update((s) => ({ ...s, generator: { ...(s.generator ?? {}), eventsPlan: fn(eventsPlanOf(s)) } }))

  async function handleGenerate() {
    cancel.current = false
    setProgress({ done: 0, of: eplan.search.candidates + 6, label: 'Starting' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    const result = await generateEvents(state, eplan, { onProgress: setProgress, isCancelled: () => cancel.current })
    if (result.status === 'cancelled' || result.status === 'incomplete') setProgress({ cancelled: true, incomplete: result.status === 'incomplete', evaluations: result.evaluations })
    else {
      update((s) => ({ ...s, generator: { ...(s.generator ?? {}), eventsPlan: eventsPlanOf(s), events: result } }))
      setProgress(null)
    }
  }
  const stale = suggestion ? eventsStaleReason(state, suggestion) : null
  const applicable = suggestion && canApplyEvents(state, suggestion)
  const inUse = suggestion && eventsIsInUse(state, suggestion)
  const base = suggestion?.validation?.base ?? []
  const prop = suggestion?.validation?.proposed ?? null
  const other = suggestion?.otherView
  const otherOf = (list, segId, id) => list?.find((s) => s.id === segId)?.shortfalls.find((x) => x.id === id)?.share ?? null

  return (
    <div className="flex flex-col gap-4" data-testid="chef-events">
      <Card>
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 xl:grid-cols-2">
          <div data-testid="chef-events-rules">
            <p className="mb-2 text-sm font-semibold text-slate-800">What a suggested special event may be</p>
            <ul className="flex flex-col gap-1 text-sm text-slate-600">
              <li>A day in the calendar, one ingredient and an amount, for every segment alike - made where players are in danger of missing something on a target day.</li>
              <li>It reaches a share of the players that the search finds - the smallest that works - by the chef&apos;s rule of who gets a special source (step 5).</li>
              <li>Common, rare or the semi-blocker - never the blocker. Like every special source, never past a threshold.</li>
              <li>
                Your {yours.length === 1 ? 'special source is' : `${yours.length} special sources are`} played as {yours.length === 1 ? 'it is' : 'they are'}; nothing of {yours.length === 1 ? 'it' : 'them'} is changed. Suggestions are added after,
                marked &quot;Suggested&quot; in step 3.
              </li>
              <li>When two sets meet the targets equally well, the one that hands out fewer ingredients in all.</li>
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600" data-testid="chef-events-controls">
              <label className="flex items-center gap-1.5">
                At most
                <Num aria-label="At most this many events" value={eplan.maxEvents} min={1} max={6} onCommit={(n) => setPlan((p) => ({ ...p, maxEvents: Math.round(n) }))} className="w-12" />
                events
              </label>
              <label className="flex items-center gap-1.5">
                each giving at most
                <Num aria-label="An event gives at most" value={eplan.maxAmount} min={1} max={500} onCommit={(n) => setPlan((p) => ({ ...p, maxAmount: Math.round(n) }))} className="w-14" />
              </label>
              <label className="flex items-center gap-1.5">
                to at least
                <Num aria-label="An event reaches at least this share" value={eplan.shareMinPct} min={5} max={100} onCommit={(n) => setPlan((p) => ({ ...p, shareMinPct: Math.round(n) }))} className="w-12" />
                % of the players
              </label>
            </div>
            <p className="mt-2 text-xs text-slate-500" data-note>
              These numbers are this tool&apos;s own defaults. A suggestion is the best of a bounded search on simulated players - not the best possible, and not confirmed design values.
            </p>
          </div>
          <div data-testid="chef-events-targets">
            <p className="mb-2 text-sm font-semibold text-slate-800">What it aims at - the same as a proposal</p>
            {targets.length === 0 ? (
              <p className="text-sm text-amber-700">No target is set yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm text-slate-600">
                {targets.map((t) => (
                  <li key={t.id}>{t.text}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-slate-500">
              Judged on {tplan.segmentIds ? `${tplan.segmentIds.length} of ${state.segments.length} segments` : 'every segment'}, with {VARIATION_LABELS[tplan.search.variation].toLowerCase()} - set in the proposal&apos;s controls.{' '}
              <button type="button" onClick={() => onGoTo('event')} className="font-semibold text-purple-700 underline decoration-dotted underline-offset-2">
                Change the targets (step 1)
              </button>
            </p>
          </div>
        </div>
        {problems.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="chef-events-problems">
            <li className="font-semibold">Missing before special events can be suggested:</li>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          <button type="button" onClick={handleGenerate} disabled={running || problems.length > 0} data-testid="chef-events-generate" className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-purple-500/30 disabled:opacity-50">
            <Sparkles size={15} /> {running ? 'Searching...' : suggestion ? 'Suggest again' : 'Suggest special events'}
          </button>
          {running && (
            <button type="button" onClick={() => (cancel.current = true)} className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
              <Square size={13} /> Stop
            </button>
          )}
          <p className="min-w-0 flex-1 text-sm text-slate-600">
            Up to {eplan.maxEvents} events of at most {eplan.maxAmount} an event, each reaching at least {eplan.shareMinPct}% of the players. Tries up to {eplan.search.candidates} sets on {eplan.search.players} players a segment, then checks the best on{' '}
            {eplan.search.validationPlayers} others. The event is not changed until you apply.
          </p>
        </div>
        {running && (
          <div className="mt-3" data-testid="chef-events-progress">
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-purple-600 to-fuchsia-500 transition-all" style={{ width: `${progress.of > 0 ? Math.min(100, (progress.done / progress.of) * 100) : 0}%` }} />
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">{progress.label}</p>
          </div>
        )}
        {progress?.cancelled && (
          <p className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {progress.incomplete ? 'Stopped while the suggestion was being checked: there is nothing to apply.' : `Stopped after ${progress.evaluations} sets, before anything was checked.`} The event is as it was.
            <button type="button" onClick={() => setProgress(null)} className="text-xs font-semibold text-purple-700 underline decoration-dotted underline-offset-2">
              Got it
            </button>
          </p>
        )}
      </Card>

      {suggestion && (
        <Card title="The suggestion" subtitle={`${new Date(suggestion.createdAt).toLocaleString()} · ${suggestion.evaluations} sets played`}>
          <div className="flex flex-col gap-3" data-testid="chef-events-result" data-status={suggestion.status}>
            <p className={`text-sm font-semibold ${suggestion.status === 'meets' || suggestion.status === 'already' ? 'text-emerald-700' : suggestion.status === 'misses' ? 'text-amber-800' : 'text-slate-700'}`}>{EVENTS_STATUS_LABELS[suggestion.status]}</p>
            {suggestion.problems && (
              <ul className="text-sm text-amber-900">
                {suggestion.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {stale && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="chef-events-stale">
                Out of date: {stale} Suggest again to see it on the event as it is.
              </p>
            )}
            {inUse && (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" data-testid="chef-events-in-use">
                In use: the event is exactly the one these figures were measured on.
              </p>
            )}
            {suggestion.described?.length > 0 && (
              <ol className="flex flex-col gap-2" data-testid="chef-events-list">
                {suggestion.described.map((d, i) => (
                  <li key={d.id} className="rounded-xl border border-sky-100 bg-sky-50/50 px-3 py-2 text-sm text-slate-700" data-event={d.id}>
                    <span className="mr-1.5 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">{i + 1}. Special event</span>
                    {d.text}
                    <span className="mt-1 block text-xs text-slate-500">Made for {d.aim}.</span>
                  </li>
                ))}
              </ol>
            )}
            {suggestion.validation && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse" data-dense data-testid="chef-events-table">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className={TH} />
                      <th className={`${TH} text-center`} colSpan={base[0]?.shortfalls.length ?? 1}>
                        The targets, now → with the suggestion
                      </th>
                      {other && (
                        <th className={`${TH} text-center text-sky-700`} colSpan={base[0]?.shortfalls.length ?? 1} title="The same players, played the other way - a reading only.">
                          With {VARIATION_LABELS[other.variation].toLowerCase()}
                        </th>
                      )}
                      <th className={`${TH} text-center`} title="What the suggested events really gave a player, on average (a threshold can hold some back). Fewer is better (economist: fewest ingredients given).">
                        Given
                      </th>
                    </tr>
                    <tr className="border-b border-slate-200">
                      <th className={TH}>Segment</th>
                      {(base[0]?.shortfalls ?? []).map((x) => (
                        <th key={x.id} className={`${TH} text-center`}>
                          {x.label}
                        </th>
                      ))}
                      {other &&
                        (base[0]?.shortfalls ?? []).map((x) => (
                          <th key={`o-${x.id}`} className={`${TH} text-center text-sky-700`}>
                            {x.label}
                          </th>
                        ))}
                      <th className={`${TH} text-center`}>A player</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(prop ?? base).map((s) => {
                      const b = base.find((x) => x.id === s.id)
                      return (
                        <tr key={s.id} className="border-b border-slate-100 text-sm" data-events-segment={s.id}>
                          <td className={`${TD} whitespace-nowrap font-medium text-slate-700`}>{s.name}</td>
                          {s.shortfalls.map((x) => {
                            const [label, tone] = VERDICT[x.verdict] ?? ['', '']
                            return (
                              <td key={x.id} className={`${TD} text-center`} data-cell={`target-${x.id}`}>
                                <Share now={b?.shortfalls.find((y) => y.id === x.id)?.share ?? null} next={prop ? x.share : null} n={s.result.players} />
                                {prop && <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}>{label}</span>}
                              </td>
                            )
                          })}
                          {other &&
                            s.shortfalls.map((x) => (
                              <td key={`o-${x.id}`} className={`${TD} whitespace-nowrap text-center tabular-nums text-sky-800`}>
                                {pct(otherOf(other.base, s.id, x.id))} → {pct(otherOf(other.proposed, s.id, x.id))}
                              </td>
                            ))}
                          <td className={`${TD} text-center tabular-nums text-slate-700`} data-cell="given">
                            {prop ? num(s.events.given, 1) : '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {suggestion.validation && <WhyPanel suggestion={suggestion} state={state} what="events" />}
            <div className="flex flex-wrap items-center gap-2">
              {applicable && (
                <button type="button" onClick={() => update((s) => applyEvents(s, s.generator?.events))} data-testid="chef-events-apply" className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm">
                  <CheckIcon size={14} /> Apply: add {suggestion.patch.sources.length === 1 ? 'this event' : `these ${suggestion.patch.sources.length} events`}
                </button>
              )}
              {applied && suggestion.appliedAt && (
                <button type="button" onClick={() => update(undoEvents)} data-testid="chef-events-undo" className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                  <RotateCcw size={14} /> Undo: take them out again
                </button>
              )}
              {!suggestion.appliedAt && (
                <button type="button" onClick={() => update((s) => ({ ...s, generator: { ...(s.generator ?? {}), events: null } }))} className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600">
                  <Trash2 size={14} /> Discard
                </button>
              )}
            </div>
            {suggestion.pruned?.length > 0 && <p className="text-xs text-slate-500">Taken away because the targets did not need {suggestion.pruned.length === 1 ? 'it' : 'them'}: {suggestion.pruned.join(' ')}</p>}
            {suggestion.log?.length > 0 && (
              <Collapsible id="chef-events-log" tone="inner" title="What the search tried" summary={`${suggestion.log.length} sets, each with what it changed and how far it was from the targets`}>
                <table className="w-full border-collapse" data-dense>
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className={TH}>#</th>
                      <th className={TH}>What was tried</th>
                      <th className={`${TH} text-right`}>Worst segment short</th>
                      <th className={`${TH} text-right`}>Given a player</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suggestion.log.map((l) => (
                      <tr key={l.n} className="border-b border-slate-100 text-xs text-slate-600">
                        <td className={TD}>{l.n}</td>
                        <td className={TD}>{l.why}</td>
                        <td className={`${TD} text-right tabular-nums`}>{pct(l.worst)}</td>
                        <td className={`${TD} text-right tabular-nums`}>{num(l.given, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Collapsible>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
