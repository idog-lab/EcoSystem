import { useMemo, useRef, useState } from 'react'
import { Check as CheckIcon, RotateCcw, Sparkles, Square, Trash2 } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Collapsible from '../../../components/ui/Collapsible'
import { CHEST_LABELS, CHEST_TYPES, VARIATION_LABELS } from '../lib/chefModel'
import { shareInterval } from '../lib/chefRng'
import { describeTargets, planOf } from '../lib/chefGenerator'
import { CATCHUP_KIND_LABELS, CATCHUP_STATUS_LABELS, applyCatchup, canApplyCatchup, catchupIsInUse, catchupPlanOf, catchupProblems, catchupStaleReason, generateCatchup, isSuggestedPreset, undoCatchup } from '../lib/chefCatchup'
import { num, pct } from '../lib/chefFormat'
import { Check, Num, TD, TH } from './chefUi'

// STEP 4, THE OTHER HALF - CATCH-UP SUGGESTIONS (build 03, chefCatchup.js).
// The tool suggests catch-up presets for players behind pace or stuck on an
// ingredient, judged on the same targets and segments as a proposal. The
// economist's rules (asked): both kinds of player, common and rare
// ingredients only, the fewest players touched, their own presets never
// touched. Nothing changes until Apply; one undo takes the suggestion out.

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

function ResultTable({ suggestion }) {
  const base = suggestion.validation.base
  const prop = suggestion.validation.proposed ?? base
  const ids = prop[0]?.shortfalls.map((x) => ({ id: x.id, label: x.label })) ?? []
  const other = suggestion.otherView
  const otherOf = (list, segId, id) => list?.find((s) => s.id === segId)?.shortfalls.find((x) => x.id === id)?.share ?? null
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" data-dense data-testid="chef-catchup-table">
        <thead>
          <tr className="border-b border-slate-100">
            <th className={TH} />
            <th className={`${TH} text-center`} colSpan={ids.length}>
              The targets, now → with the suggestion
            </th>
            {other && (
              <th className={`${TH} text-center text-sky-700`} colSpan={ids.length} data-testid="chef-catchup-other-head" title="The same players, played the other way - a reading only; the verdicts use the view chosen.">
                With {VARIATION_LABELS[other.variation].toLowerCase()}
              </th>
            )}
            <th className={`${TH} text-center`} colSpan={2}>
              Suggested baskets
            </th>
          </tr>
          <tr className="border-b border-slate-200">
            <th className={TH}>Segment</th>
            {ids.map((x) => (
              <th key={x.id} className={`${TH} text-center`} title={x.label}>
                {x.label}
              </th>
            ))}
            {other &&
              ids.map((x) => (
                <th key={`o-${x.id}`} className={`${TH} text-center text-sky-700`} title={x.label}>
                  {x.label}
                </th>
              ))}
            <th className={`${TH} text-center`} title="The share of players who get at least one suggested catch-up basket. Fewer is better (economist: the fewest players touched).">
              Players
            </th>
            <th className={`${TH} text-center`} title="How many suggested baskets a player gets on average.">
              A player
            </th>
          </tr>
        </thead>
        <tbody>
          {prop.map((s) => {
            const b = base.find((x) => x.id === s.id)
            return (
              <tr key={s.id} className="border-b border-slate-100 text-sm" data-catchup-segment={s.id}>
                <td className={`${TD} whitespace-nowrap font-medium text-slate-700`}>{s.name}</td>
                {s.shortfalls.map((x) => {
                  const [label, tone] = VERDICT[x.verdict] ?? ['', '']
                  return (
                    <td key={x.id} className={`${TD} text-center`} data-cell={`target-${x.id}`}>
                      <Share now={b?.shortfalls.find((y) => y.id === x.id)?.share ?? null} next={suggestion.validation.proposed ? x.share : null} n={s.result.players} />
                      {suggestion.validation.proposed && <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}>{label}</span>}
                    </td>
                  )
                })}
                {other &&
                  s.shortfalls.map((x) => (
                    <td key={`o-${x.id}`} className={`${TD} whitespace-nowrap text-center tabular-nums text-sky-800`} data-cell={`other-${x.id}`}>
                      {pct(otherOf(other.base, s.id, x.id))} → {pct(otherOf(other.proposed, s.id, x.id))}
                    </td>
                  ))}
                <td className={`${TD} text-center tabular-nums text-slate-700`} data-cell="touched">
                  {suggestion.validation.proposed ? pct(s.catchup.playersShare) : '-'}
                </td>
                <td className={`${TD} text-center tabular-nums text-slate-700`}>{suggestion.validation.proposed ? num(s.catchup.basketsMean, 1) : '-'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// WHAT HOLDS PLAYERS BACK on the FU day, with the suggestion: where the players are (the engine's own probe of that
// day) and what they lack, by kind. A catch-up gives only common and rare ingredients, so what is lacking of the
// semi-blocker or the blocker it cannot give - said here rather than left to be guessed from a "Missed".
const REASON_LABELS = { fu: 'in FU', finished: 'finished', waiting: 'waiting for the blocker', ordinary: 'one dish left, short of an ordinary ingredient', behind: 'more than one dish left' }
const RARITY_WORDS = { common: 'common', rare: 'rare', 'semi-blocker': 'semi-blocker', blocker: 'blocker' }
// `what`: 'catchup' (it may not give the semi-blocker) or 'events' (it may, but never past its threshold).
const WHY_WORDS = {
  catchup: {
    id: 'chef-catchup-why',
    summary: 'which a catch-up does not give',
    note: 'A suggested catch-up holds only common and rare ingredients (your rule). Where players lack the semi-blocker most, a catch-up cannot bring them to FU: it is paced by its threshold - a proposal (the other kind of suggestion) or the schedule in step 3 is where it moves.',
  },
  events: {
    id: 'chef-events-why',
    summary: 'which an event gives only up to its threshold',
    note: 'A suggested event may give the semi-blocker, but never past its threshold (no permission to pass it). Where players lack the semi-blocker most, the threshold is what holds them back: a proposal (the first kind of suggestion) or the schedule in step 3 is where it moves.',
  },
}
export function WhyPanel({ suggestion, state, what = 'catchup' }) {
  const words = WHY_WORDS[what] ?? WHY_WORDS.catchup
  const day = state.targets?.mainFuDay
  const rows = (suggestion.validation.proposed ?? suggestion.validation.base).map((s) => ({ s, probe: s.result.probes?.[day] })).filter((r) => r.probe)
  if (day == null || !rows.length) return null
  const byId = Object.fromEntries(state.ingredients.map((i) => [i.id, i]))
  const giveable = (id) => ['common', 'rare'].includes(byId[id]?.rarity)
  let notGiveable = 0
  // (The blocker is left out: lacking only the blocker is what FU is - the last dish waits for it.)
  const lines = rows.map(({ s, probe }) => {
    const lack = probe.lack.filter((l) => l.share >= 0.02 && byId[l.id]?.rarity !== 'blocker').sort((a, b) => b.share - a.share)
    const top = lack.slice(0, 4)
    if (top[0] && !giveable(top[0].id)) notGiveable += 1
    const reasons = Object.entries(probe.reasons).filter(([, v]) => v >= 0.01).sort((a, b) => b[1] - a[1])
    return { s, top, reasons }
  })
  return (
    <Collapsible id={words.id} tone="inner" openWhen={notGiveable > 0} title={`What holds players back on day ${day}, with the suggestion`} summary={notGiveable > 0 ? `In ${notGiveable} of ${lines.length} segments what players lack most is the semi-blocker, ${words.summary}` : 'Where the players are that day, and what they lack'}>
      <div className="flex flex-col gap-2" data-testid={words.id}>
        {notGiveable > 0 && (
          <p className="text-sm text-amber-900" data-note>
            {words.note}
          </p>
        )}
        <table className="w-full border-collapse" data-dense>
          <thead>
            <tr className="border-b border-slate-200">
              <th className={TH}>Segment</th>
              <th className={TH}>Where the players are</th>
              <th className={TH} title="The blocker is not listed: lacking only the blocker is what FU is.">
                Lacking, besides the blocker
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ s, top, reasons }) => (
              <tr key={s.id} className="border-b border-slate-100 align-top text-sm" data-catchup-why={s.id}>
                <td className={`${TD} whitespace-nowrap font-medium text-slate-700`}>{s.name}</td>
                <td className={`${TD} text-slate-600`}>{reasons.map(([k, v]) => `${pct(v)} ${REASON_LABELS[k] ?? k}`).join(' · ')}</td>
                <td className={`${TD} text-slate-600`}>
                  {top.length === 0
                    ? 'nothing'
                    : top.map((l, i) => (
                        <span key={l.id} className={giveable(l.id) ? '' : 'font-semibold text-amber-800'}>
                          {i > 0 && ' · '}
                          {byId[l.id]?.name ?? l.id} ({RARITY_WORDS[byId[l.id]?.rarity] ?? '?'}) {pct(l.share)}
                        </span>
                      ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Collapsible>
  )
}

export default function CatchupPanel({ state, update, onGoTo }) {
  const cplan = useMemo(() => catchupPlanOf(state), [state])
  const tplan = useMemo(() => planOf(state), [state])
  const suggestion = state.generator?.catchup ?? null
  const applied = state.generator?.catchupApplied ?? null
  const [progress, setProgress] = useState(null)
  const cancel = useRef(false)
  const running = progress != null && !progress.cancelled
  const problems = useMemo(() => catchupProblems(state, cplan, tplan), [state, cplan, tplan])
  const targets = useMemo(() => describeTargets(state, tplan), [state, tplan])
  const yours = (state.presets ?? []).filter((p) => !isSuggestedPreset(p))
  const earlier = (state.presets ?? []).filter(isSuggestedPreset)
  const setPlan = (fn) => update((s) => ({ ...s, generator: { ...(s.generator ?? {}), catchupPlan: fn(catchupPlanOf(s)) } }))

  async function handleGenerate() {
    cancel.current = false
    setProgress({ done: 0, of: cplan.search.candidates + 6, label: 'Starting' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    const result = await generateCatchup(state, cplan, { onProgress: setProgress, isCancelled: () => cancel.current })
    if (result.status === 'cancelled' || result.status === 'incomplete') setProgress({ cancelled: true, incomplete: result.status === 'incomplete', evaluations: result.evaluations })
    else {
      update((s) => ({ ...s, generator: { ...(s.generator ?? {}), catchupPlan: catchupPlanOf(s), catchup: result } }))
      setProgress(null)
    }
  }
  const handleApply = () => update((s) => applyCatchup(s, s.generator?.catchup))
  const handleUndo = () => update(undoCatchup)
  const handleDiscard = () => update((s) => ({ ...s, generator: { ...(s.generator ?? {}), catchup: null } }))

  const stale = suggestion ? catchupStaleReason(state, suggestion) : null
  const applicable = suggestion && canApplyCatchup(state, suggestion)
  const inUse = suggestion && catchupIsInUse(state, suggestion)
  const typesOn = CHEST_TYPES.filter((t) => cplan.chestTypes[t])

  return (
    <div className="flex flex-col gap-4" data-testid="chef-catchup">
      <Card>
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 xl:grid-cols-2">
          <div data-testid="chef-catchup-rules">
            <p className="mb-2 text-sm font-semibold text-slate-800">What a suggested catch-up preset may be</p>
            <ul className="flex flex-col gap-1 text-sm text-slate-600">
              <li>For players behind pace (at most so many dishes before a target day) or stuck on an ingredient (still missing so many of it) - the search tries both and keeps what lifts the targets most.</li>
              <li>It holds only common and rare ingredients the Main recipes use - never the semi-blocker or the blocker. Like every preset, never past a threshold and never over the pantry.</li>
              <li>
                Your {yours.length === 1 ? 'preset is' : `${yours.length} presets are`} played as {yours.length === 1 ? 'it is and goes' : 'they are and go'} first; nothing of {yours.length === 1 ? 'it' : 'them'} is changed. Suggestions are added after, marked
                &quot;Suggested&quot; in step 3.{earlier.length > 0 && ` ${earlier.length} suggested ${earlier.length === 1 ? 'preset is' : 'presets are'} in the event already, from before: played as they are.`}
              </li>
              <li>When two sets meet the targets equally well, the one that fewer players ever get a suggested basket from.</li>
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600" data-testid="chef-catchup-controls">
              <label className="flex items-center gap-1.5" title="This tool's own default.">
                At most
                <Num aria-label="At most this many presets" value={cplan.maxPresets} min={1} max={6} onCommit={(n) => setPlan((p) => ({ ...p, maxPresets: Math.round(n) }))} className="w-12" />
                presets
              </label>
              <label className="flex items-center gap-1.5" title="This tool's own default.">
                a player at most
                <Num aria-label="A player at most this many times" value={cplan.maxUses} min={1} max={5} onCommit={(n) => setPlan((p) => ({ ...p, maxUses: Math.round(n) }))} className="w-12" />
                times
              </label>
              <span className="flex flex-wrap items-center gap-2" title="The baskets a suggestion may take the place of. Epic is off to start with (this tool's own default): it holds 12-20 ingredients.">
                In the place of
                {CHEST_TYPES.map((t) => (
                  <Check key={t} checked={cplan.chestTypes[t]} onChange={(v) => setPlan((p) => ({ ...p, chestTypes: { ...p.chestTypes, [t]: v } }))} data-testid={`chef-catchup-type-${t}`}>
                    {CHEST_LABELS[t]}
                  </Check>
                ))}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {Object.entries(CATCHUP_KIND_LABELS).map(([k, label]) => (
                  <Check key={k} checked={cplan.kinds[k]} onChange={(v) => setPlan((p) => ({ ...p, kinds: { ...p.kinds, [k]: v } }))} data-testid={`chef-catchup-kind-${k}`}>
                    {label}
                  </Check>
                ))}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500" data-note>
              These numbers are this tool&apos;s own defaults. A suggestion is the best of a bounded search on simulated players - not the best possible, and not confirmed design values.
            </p>
          </div>
          <div data-testid="chef-catchup-targets">
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
          <ul className="mt-4 flex flex-col gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="chef-catchup-problems">
            <li className="font-semibold">Missing before catch-up presets can be suggested:</li>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          <button type="button" onClick={handleGenerate} disabled={running || problems.length > 0} data-testid="chef-catchup-generate" className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-purple-500/30 disabled:opacity-50">
            <Sparkles size={15} /> {running ? 'Searching...' : suggestion ? 'Suggest again' : 'Suggest catch-up presets'}
          </button>
          {running && (
            <button type="button" onClick={() => (cancel.current = true)} data-testid="chef-catchup-cancel" className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
              <Square size={13} /> Stop
            </button>
          )}
          <p className="min-w-0 flex-1 text-sm text-slate-600" data-testid="chef-catchup-plan">
            Up to {cplan.maxPresets} presets in the place of {typesOn.map((t) => CHEST_LABELS[t]).join(' or ') || 'no'} baskets, each given to a player at most {cplan.maxUses} {cplan.maxUses === 1 ? 'time' : 'times'}. Tries up to {cplan.search.candidates} sets on {cplan.search.players} players a segment, then checks the best on {cplan.search.validationPlayers} others. The event is not changed until you apply.
          </p>
        </div>
        {running && (
          <div className="mt-3" data-testid="chef-catchup-progress">
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-purple-600 to-fuchsia-500 transition-all" style={{ width: `${progress.of > 0 ? Math.min(100, (progress.done / progress.of) * 100) : 0}%` }} />
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">{progress.label}</p>
          </div>
        )}
        {progress?.cancelled && (
          <p className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="chef-catchup-cancelled">
            {progress.incomplete ? 'Stopped while the suggestion was being checked on other players: there is nothing to apply.' : `Stopped after ${progress.evaluations} sets, before anything was checked on other players.`} The event is as it was.
            <button type="button" onClick={() => setProgress(null)} className="text-xs font-semibold text-purple-700 underline decoration-dotted underline-offset-2">
              Got it
            </button>
          </p>
        )}
      </Card>

      {suggestion && (
        <Card title="The suggestion" subtitle={`${new Date(suggestion.createdAt).toLocaleString()} · ${suggestion.evaluations} sets played`}>
          <div className="flex flex-col gap-3" data-testid="chef-catchup-result" data-status={suggestion.status}>
            <p className={`text-sm font-semibold ${suggestion.status === 'meets' || suggestion.status === 'already' ? 'text-emerald-700' : suggestion.status === 'misses' ? 'text-amber-800' : 'text-slate-700'}`} data-testid="chef-catchup-status">
              {CATCHUP_STATUS_LABELS[suggestion.status]}
            </p>
            {suggestion.problems && (
              <ul className="text-sm text-amber-900">
                {suggestion.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {stale && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="chef-catchup-stale">
                Out of date: {stale} Suggest again to see it on the event as it is.
              </p>
            )}
            {inUse && (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" data-testid="chef-catchup-in-use">
                In use: the event is exactly the one these figures were measured on.
              </p>
            )}
            {suggestion.appliedAt && !inUse && (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">Applied, then the event was changed: the figures below are of the event as it was then.</p>
            )}
            {suggestion.described?.length > 0 && (
              <ol className="flex flex-col gap-2" data-testid="chef-catchup-presets">
                {suggestion.described.map((d, i) => {
                  const shares = (suggestion.validation.proposed ?? []).map((s) => s.catchup.byPreset.find((p) => p.id === d.id)?.playersShare ?? 0)
                  const mean = shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : 0
                  return (
                    <li key={d.id} className="rounded-xl border border-sky-100 bg-sky-50/50 px-3 py-2 text-sm text-slate-700" data-catchup-preset={d.id}>
                      <span className="mr-1.5 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                        {i + 1}. {CATCHUP_KIND_LABELS[d.kind]}
                      </span>
                      {d.text}
                      <span className="mt-1 block text-xs text-slate-500">
                        Given to {pct(mean)} of the players on average over the segments. Made for {d.aim}.
                      </span>
                    </li>
                  )
                })}
              </ol>
            )}
            {suggestion.validation && <ResultTable suggestion={suggestion} />}
            {suggestion.validation && <WhyPanel suggestion={suggestion} state={state} />}
            {suggestion.validation?.proposed && (
              <p className="text-xs text-slate-500" data-note>
                Checked on {suggestion.settings.validationPlayers} players a segment that the search never saw, the same for the event as it is and with the suggestion. The verdict says whether a target is met, missed, or too close to call
                on this many players.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {applicable && (
                <button type="button" onClick={handleApply} data-testid="chef-catchup-apply" className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm">
                  <CheckIcon size={14} /> Apply: add {suggestion.patch.presets.length === 1 ? 'this preset' : `these ${suggestion.patch.presets.length} presets`}
                </button>
              )}
              {applied && suggestion.appliedAt && (
                <button type="button" onClick={handleUndo} data-testid="chef-catchup-undo" className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                  <RotateCcw size={14} /> Undo: take them out again
                </button>
              )}
              {!suggestion.appliedAt && (
                <button type="button" onClick={handleDiscard} data-testid="chef-catchup-discard" className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600">
                  <Trash2 size={14} /> Discard
                </button>
              )}
            </div>
            {suggestion.pruned?.length > 0 && <p className="text-xs text-slate-500">Taken away because the targets did not need {suggestion.pruned.length === 1 ? 'it' : 'them'}: {suggestion.pruned.join(' ')}</p>}
            {suggestion.log?.length > 0 && (
              <Collapsible id="chef-catchup-log" tone="inner" title="What the search tried" summary={`${suggestion.log.length} sets, each with what it changed and how far it was from the targets`}>
                <table className="w-full border-collapse" data-dense>
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className={TH}>#</th>
                      <th className={TH}>What was tried</th>
                      <th className={`${TH} text-right`}>Worst segment short</th>
                      <th className={`${TH} text-right`}>Players touched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suggestion.log.map((l) => (
                      <tr key={l.n} className="border-b border-slate-100 text-xs text-slate-600">
                        <td className={TD}>{l.n}</td>
                        <td className={TD}>{l.why}</td>
                        <td className={`${TD} text-right tabular-nums`}>{pct(l.worst)}</td>
                        <td className={`${TD} text-right tabular-nums`}>{pct(l.touched)}</td>
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
