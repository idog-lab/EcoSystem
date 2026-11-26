import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Map as MapIcon } from 'lucide-react'
import Card from '../../../components/ui/Card'
import { useEconomy } from '../../../lib/economy/economyStore'
import { parseReward } from '../../../lib/economy/parse'
import { prizeAgainstWorth } from '../../../lib/economy/prizeWorth'
import { setForFeature, useSegmentSets } from '../../../lib/economy/segmentSets'
import { teamData } from '../../../lib/teamData'
import { FEATURE_NAME, LANES, MAX_TIERS, PRIZE_LIMIT, STORAGE_KEY, baseText, normalizeState, placeKey, prizeOf, progressAt, ruleProblems, withTierCount, workOut } from '../lib/wickedTrails'

// WICKED TRAILS (lib/wickedTrails.js): the segments with their effort in Brut Wins and DR per Brut Win, the prizes of
// both lanes' tiers and of the Final Prize beside what each should be worth, and a mock of the event to look at.
const VIEW_KEY = 'superplay-wicked-trails-view'
const VIEWS = [
  { id: 'segments', label: '1. Segments' },
  { id: 'prizes', label: '2. Prizes' },
  { id: 'mock', label: '3. Mock' },
]
const INPUT = 'rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-200'
const BUTTON = 'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-purple-300 hover:text-purple-700'
const TH = 'px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap align-bottom'
const TD = 'px-2 py-1.5 align-top'
const fmt = (v, d = 2) => (v == null ? '-' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }))

function load(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

// A number field that takes its value on leaving it (or Enter); empty is "not given".
function Num({ value, onCommit, className = 'w-20', ...props }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => setText(value == null ? '' : String(value)), [value])
  const commit = () => {
    const t = text.trim()
    if (t === '') return onCommit(null)
    const n = Number(t.replace(/,/g, ''))
    if (Number.isFinite(n)) onCommit(n)
    else setText(value == null ? '' : String(value))
  }
  return <input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className={`${INPUT} ${className} tabular-nums`} {...props} />
}
// A text field that takes its value on leaving it.
function Text({ value, onCommit, className = '', ...props }) {
  const [text, setText] = useState(value ?? '')
  useEffect(() => setText(value ?? ''), [value])
  return <input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== (value ?? '') && onCommit(text)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className={`${INPUT} ${className}`} {...props} />
}

export default function WickedTrailsApp({ onHome }) {
  const [state, setState] = useState(() => normalizeState(load(STORAGE_KEY, null)))
  const [view, setViewState] = useState(() => (VIEWS.some((v) => v.id === load(VIEW_KEY, null)) ? load(VIEW_KEY, null) : 'segments'))
  const [shown, setShown] = useState(null)
  const economy = useEconomy()
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      teamData.changed(STORAGE_KEY)
    } catch {
      // Not kept between visits; the page works without it.
    }
  }, [state])
  const setView = (v) => {
    setViewState(v)
    try {
      window.localStorage.setItem(VIEW_KEY, JSON.stringify(v))
    } catch {
      // Not remembered; nothing else depends on it.
    }
  }
  const change = (fn) => setState((s) => fn(s))
  const index = shown != null && shown < state.segments.length ? shown : Math.min(state.baseIndex, Math.max(0, state.segments.length - 1))

  return (
    <div className="min-h-screen">
      <div className="app-backdrop" aria-hidden="true" />
      <header className="mx-auto flex max-w-[1760px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 pb-2 pt-4" data-testid="wt-header">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <button type="button" onClick={onHome} aria-label="Back to the features" title="Back to the features" className="grid h-9 w-9 place-items-center rounded-xl border border-white bg-white/80 text-slate-500 ring-1 ring-slate-200/70 transition-colors hover:text-purple-600">
            <ArrowLeft size={16} />
          </button>
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-purple-600 to-fuchsia-500 text-white shadow-md shadow-purple-500/30">
            <MapIcon size={18} strokeWidth={2.25} />
          </span>
          <h1 className="font-display text-xl font-bold tracking-tight text-slate-900">Wicked Trails</h1>
          <span className="text-sm text-slate-500">A level feature: two lanes filled by Brut Wins, and a Final Prize for finishing both.</span>
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Wicked Trails" data-testid="wt-views">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)} data-wt-view={v.id} className={`rounded-lg px-3 py-1 text-sm font-semibold ring-1 transition-colors ${view === v.id ? 'bg-slate-800 text-white ring-slate-800' : 'bg-white/80 text-slate-600 ring-slate-200 hover:text-purple-700'}`}>
              {v.label}
            </button>
          ))}
        </div>
      </header>
      <main className="mx-auto flex max-w-[1760px] flex-col gap-4 px-6 pb-10">
        {view === 'segments' && <SegmentsView state={state} change={change} />}
        {view !== 'segments' && !state.segments.length && (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-6 text-center text-sm text-slate-500" data-testid="wt-no-segments">
            No segments yet: take them from a segment set in 1. Segments.
          </p>
        )}
        {view === 'prizes' && state.segments.length > 0 && <PrizesView state={state} change={change} index={index} setShown={setShown} economy={economy} />}
        {view === 'mock' && state.segments.length > 0 && <MockView state={state} index={index} setShown={setShown} />}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------- 1. Segments
function SegmentsView({ state, change }) {
  const sets = useSegmentSets()
  const [message, setMessage] = useState(null)
  const picked = state.segmentSet ? sets.find((s) => s.id === state.segmentSet.id) : null
  const changedSince = picked && picked.updatedAt !== state.segmentSet.updatedAt

  function take(id) {
    const set = sets.find((s) => s.id === id)
    if (!set) return
    const r = setForFeature(set, FEATURE_NAME)
    if (r.errors.length) return setMessage(`"${set.name}" has something to fix first: ${r.errors[0]}`)
    change((s) => {
      // The multipliers typed for a segment are kept by its key when the set is taken again.
      const kept = new Map(s.segments.map((x) => [x.key, x]))
      return {
        ...s,
        segments: r.segments.map((x) => ({ name: x.name, key: x.key, condition: x.condition, effortBW: x.effort, silverPerBW: kept.get(x.key)?.silverPerBW ?? null, goldPerBW: kept.get(x.key)?.goldPerBW ?? null, own: kept.get(x.key)?.own ?? {} })),
        baseIndex: Math.min(s.baseIndex, r.segments.length - 1),
        segmentSet: { id: set.id, name: set.name, updatedAt: set.updatedAt },
      }
    })
    setMessage(`${r.segments.length} segments taken from "${set.name}", named ${FEATURE_NAME}_, ${r.segments.filter((x) => x.effort != null).length} with an effort in Brut Wins.`)
  }
  const setSeg = (i, patch) => change((s) => ({ ...s, segments: s.segments.map((x, j) => (j === i ? { ...x, ...patch } : x)) }))

  return (
    <Card title="The segments" subtitle="Taken from a segment set (Economy page, Segments), each with its effort in Brut Wins for the feature. Type how much silver and gold DR one Brut Win gives each segment, and pick the base: its prizes are the ones typed.">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value="" onChange={(e) => e.target.value && take(e.target.value)} className={`${INPUT} min-w-64`} data-testid="wt-segment-set" aria-label="Take the segments from a set">
            <option value="">{sets.length ? 'Take the segments from a set' : 'No segment set yet - make one on the Economy page'}</option>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} - {s.segments.length} segments
              </option>
            ))}
          </select>
          {state.segmentSet && <span className="text-xs text-slate-500">Copied from &ldquo;{state.segmentSet.name}&rdquo;</span>}
        </div>
        {message && (
          <p className="text-xs text-emerald-700" data-testid="wt-segments-message">
            {message}
          </p>
        )}
        {changedSince && (
          <p className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-sm text-amber-800" data-testid="wt-set-changed">
            &ldquo;{picked.name}&rdquo; has changed since it was taken. These are the numbers it had then.
            <button type="button" className={BUTTON} onClick={() => take(picked.id)} data-testid="wt-set-retake">
              Take its new numbers
            </button>
          </p>
        )}
        {state.segments.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" data-testid="wt-segments" data-dense>
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={TH}>Base</th>
                  <th className={TH}>Segment</th>
                  <th className={TH} title="What this segment's player does in the feature, in Brut Wins (from the set, or typed)">
                    Effort
                    <span className="block font-normal normal-case tracking-normal">(Brut Wins)</span>
                  </th>
                  <th className={TH}>
                    Silver DR
                    <span className="block font-normal normal-case tracking-normal">per Brut Win</span>
                  </th>
                  <th className={TH}>
                    Gold DR
                    <span className="block font-normal normal-case tracking-normal">per Brut Win</span>
                  </th>
                  <th className={TH} title="The easy lane's length in silver DR: its Brut Wins (the easy lane's share of the effort) x silver per Brut Win">
                    Easy lane
                    <span className="block font-normal normal-case tracking-normal">(silver DR)</span>
                  </th>
                  <th className={TH} title="The hard lane's length in gold DR: the whole effort x gold per Brut Win">
                    Hard lane
                    <span className="block font-normal normal-case tracking-normal">(gold DR)</span>
                  </th>
                  <th className={TH} title="Effort x ROE: the allowance worth of everything the segment's player gets in the feature">
                    Worth
                    <span className="block font-normal normal-case tracking-normal">(allowance)</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.segments.map((seg, i) => {
                  const w = workOut(state, seg)
                  return (
                    <tr key={seg.key || i} className="border-b border-slate-100" data-wt-segment={i}>
                      <td className={`${TD} text-center`}>
                        <input type="radio" name="wt-base" checked={state.baseIndex === i} onChange={() => change((s) => ({ ...s, baseIndex: i }))} aria-label={`${seg.name} is the base`} data-field="base" />
                      </td>
                      <td className={`${TD} max-w-[24rem]`}>
                        <div className="whitespace-nowrap font-semibold text-slate-800">{seg.name}</div>
                        <div className="truncate font-mono text-[10.5px] text-slate-400" title={seg.condition} data-cut-ok>
                          {seg.condition}
                        </div>
                      </td>
                      <td className={TD}>
                        <Num value={seg.effortBW} onCommit={(v) => setSeg(i, { effortBW: v != null && v >= 0 ? v : null })} placeholder="-" aria-label={`${seg.name} effort in Brut Wins`} data-field="effort-bw" />
                      </td>
                      <td className={TD}>
                        <Num value={seg.silverPerBW} onCommit={(v) => setSeg(i, { silverPerBW: v != null && v >= 0 ? v : null })} placeholder="-" aria-label={`${seg.name} silver DR per Brut Win`} data-field="silver-per-bw" />
                      </td>
                      <td className={TD}>
                        <Num value={seg.goldPerBW} onCommit={(v) => setSeg(i, { goldPerBW: v != null && v >= 0 ? v : null })} placeholder="-" aria-label={`${seg.name} gold DR per Brut Win`} data-field="gold-per-bw" />
                      </td>
                      <td className={`${TD} tabular-nums`} data-field="easy-total">
                        {w.lanes ? fmt(w.lanes.easy.totalDR, 0) : '-'}
                      </td>
                      <td className={`${TD} tabular-nums`} data-field="hard-total">
                        {w.lanes ? fmt(w.lanes.hard.totalDR, 0) : '-'}
                      </td>
                      <td className={`${TD} tabular-nums`} data-field="worth">
                        {w.lanes ? fmt(w.total) : <span className="text-[11px] text-amber-700">{w.problems.find((p) => /Needs/.test(p)) ?? 'See 2. Prizes'}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- 2. Prizes
function SegmentChips({ state, index, setShown }) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="wt-segment-chips">
      {state.segments.map((seg, i) => (
        <button key={seg.key || i} type="button" onClick={() => setShown(i)} aria-pressed={index === i} data-wt-chip={i} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ${index === i ? 'bg-purple-600 text-white ring-purple-600' : 'bg-white text-slate-600 ring-slate-200 hover:text-purple-700'}`}>
          {seg.name}
          {state.baseIndex === i ? ' (base)' : ''}
        </button>
      ))}
    </div>
  )
}

function Gap({ check, target }) {
  if (!check) return <span className="text-slate-300">-</span>
  if (!check.ok) return <span className="text-rose-700">{check.issues.find((x) => x.level === 'error')?.message ?? 'Cannot be read'}</span>
  if (check.worth == null) return <span className="text-amber-700" title={check.unknown.join(', ')}>A part has no worth yet{check.unknown.length ? `: ${check.unknown.join(', ')}` : ''}</span>
  if (target == null) return <span>{fmt(check.worth)}</span>
  const pct = Math.abs(check.gapPct ?? 0)
  const tone = pct <= 5 ? 'text-emerald-700' : pct <= 15 ? 'text-amber-700' : 'text-rose-700'
  return (
    <span className={tone} data-gap-pct={check.gapPct}>
      {fmt(check.worth)} <span className="text-[11px]">({check.gap > 0 ? '+' : ''}{fmt(check.gap)}, {check.gapPct > 0 ? '+' : ''}{check.gapPct}%)</span>
    </span>
  )
}

function PrizeField({ state, change, index, place, economy, target, limit, className = 'min-w-[16rem]' }) {
  const p = prizeOf(state, index, place)
  const isBase = index === state.baseIndex
  const check = p.text ? prizeAgainstWorth(p.text, target, economy, { prizeMode: 'custom', prizeLimit: limit }) : null
  const warn = check?.issues.filter((x) => x.level === 'warning') ?? []
  const commit = (text) =>
    change((s) => {
      if (isBase) {
        if (place === 'final') return { ...s, finalPrize: text.trim() }
        const [laneId, i] = place.split('-')
        return { ...s, lanes: { ...s.lanes, [laneId]: { ...s.lanes[laneId], prizes: s.lanes[laneId].prizes.map((x, j) => (j === Number(i) ? text.trim() : x)) } } }
      }
      return { ...s, segments: s.segments.map((x, j) => (j === index ? { ...x, own: { ...x.own, [place]: text.trim() } } : x)) }
    })
  return (
    <div className={`flex ${className} flex-col gap-0.5`}>
      <Text value={p.text} onCommit={commit} placeholder={isBase ? 'Type the prize: free_undo:5+allowance(coins:2)' : 'The base\'s, scaled'} className="w-full font-mono text-[12.5px]" aria-label={`Prize ${place}`} data-prize-input={place} />
      <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
        <span data-prize-gap={place}>
          <Gap check={check} target={target} />
        </span>
        {!isBase && !p.own && p.text && <span className="text-purple-600" data-from-base>the base&apos;s x {fmt(p.factor, 3)}</span>}
        {!isBase && p.own && String(baseText(state, place)).trim() && (
          <button type="button" className="text-purple-700 hover:underline" onClick={() => commit('')} data-reset-to-base={place}>
            Use the base&apos;s
          </button>
        )}
        {warn.map((x) => (
          <span key={x.message} className="text-amber-700">
            {x.message}
          </span>
        ))}
      </div>
    </div>
  )
}

function Rules({ state, change }) {
  const r = state.rules
  const set = (k) => (v) => change((s) => ({ ...s, rules: { ...s.rules, [k]: v } }))
  const field = (k, label, title, suffix = '%') => (
    <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500" title={title}>
      {label}
      <span className="flex items-center gap-1 normal-case tracking-normal">
        <Num value={r[k]} onCommit={set(k)} className="w-20" data-rule={k} />
        <span className="text-xs font-normal text-slate-500">{suffix}</span>
      </span>
    </label>
  )
  return (
    <Card title="The rules of the feature" subtitle="The ROE is this feature's own. The other five start at the old sheet's values - type yours over them.">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3" data-testid="wt-rules">
        {field('roe', 'ROE', 'Rate of economy: the allowance worth of prizes a player gets from one Brut Win', 'allowance a Brut Win')}
        {field('easyShare', 'Easy lane\'s share', 'While both lanes fill, this share of each Brut Win\'s ROE goes to the easy lane, the rest to the hard lane. Once the easy lane is done, all of it goes to the hard lane.', '% of a BW')}
        {field('easySize', 'Easy lane\'s length', 'The easy lane is done after this share of the effort; the hard lane lasts the whole effort', '% of the hard')}
        {field('takeEasy', 'Easy to the Final Prize', 'The share of what the easy lane earns that goes to the Final Prize; its tiers get the rest')}
        {field('takeHard', 'Hard to the Final Prize', 'The share of what the hard lane earns that goes to the Final Prize; its tiers get the rest')}
        {field('finalCounted', 'Final Prize counted at', 'The Final Prize is counted at this share of its worth against the pool: its worth should be the pool divided by it')}
      </div>
    </Card>
  )
}

function PrizesView({ state, change, index, setShown, economy }) {
  const seg = state.segments[index]
  const w = workOut(state, seg)
  const problems = [...new Set([...ruleProblems(state), ...w.problems])]
  const setLane = (laneId, lane) => change((s) => ({ ...s, lanes: { ...s.lanes, [laneId]: lane } }))
  const tierSum = () => (w.lanes ? w.lanes.easy.tiers.concat(w.lanes.hard.tiers).reduce((a, x) => a + x.target, 0) : 0)
  return (
    <>
      <Rules state={state} change={change} />
      <div className="flex flex-wrap items-center gap-3">
        <SegmentChips state={state} index={index} setShown={setShown} />
        <span className="text-xs text-slate-500" data-testid="wt-prizes-who">
          {index === state.baseIndex ? 'The base: the prizes typed here are every segment\'s, times its effort against the base\'s.' : 'A segment\'s prize is the base\'s times its effort against the base\'s - type one to give it its own.'}
        </span>
      </div>
      {problems.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="wt-problems">
          {problems.map((p) => (
            <p key={p} className="rounded-lg bg-amber-50 px-2.5 py-1 text-sm text-amber-800">
              {p}
            </p>
          ))}
        </div>
      )}
      {w.lanes && (
        <p className="text-sm text-slate-700" data-testid="wt-totals">
          <span className="font-semibold">{seg.name}</span>: {fmt(w.E)} Brut Wins x ROE {fmt(state.rules.roe, 4)} = <span className="font-semibold">{fmt(w.total)}</span> allowance - the tiers {fmt(tierSum())} and the Final Prize&apos;s pool {fmt(w.pool)}.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        {LANES.map((lane) => {
          const l = state.lanes[lane.id]
          const lw = w.lanes?.[lane.id]
          const take = lane.id === 'easy' ? state.rules.takeEasy : state.rules.takeHard
          return (
            <Card
              key={lane.id}
              title={`${lane.label} (${lane.dr})`}
              subtitle={lw ? `${fmt(lw.totalDR, 0)} ${lane.dr} over ${fmt(lw.doneAtBW)} Brut Wins; earns ${fmt(lw.earned)} allowance, ${fmt(take)}% of it to the Final Prize.` : `Tiers as shares of the lane, adding up to 100%.`}
              action={
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                  Tiers
                  <Num value={l.shares.length} onCommit={(v) => v != null && setLane(lane.id, withTierCount(l, v))} className="w-14" aria-label={`${lane.label}: how many tiers`} data-tier-count={lane.id} />
                  <span className="font-normal text-slate-400">1 to {MAX_TIERS}</span>
                </label>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm" data-testid={`wt-lane-${lane.id}`} data-dense>
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className={TH}>Tier</th>
                      <th className={TH} title="The tier's share of the lane; the shares add up to 100%">
                        Share
                        <span className="block font-normal normal-case tracking-normal">(of the lane)</span>
                      </th>
                      <th className={TH} title={`The ${lane.dr} this tier asks for, on its own (and in all, to the end of it)`}>
                        DR
                        <span className="block font-normal normal-case tracking-normal">(this tier)</span>
                      </th>
                      <th className={TH} title="The Brut Wins between the tier before and this one">
                        Brut Wins
                        <span className="block font-normal normal-case tracking-normal">(from - to)</span>
                      </th>
                      <th className={TH} title="What the lane earns between the tier before and this one, in allowance (its share of those Brut Wins' ROE)">
                        Earned
                      </th>
                      <th className={TH} title="Its target worth: what it earned less the lane's share to the Final Prize">
                        Target
                        <span className="block font-normal normal-case tracking-normal">(allowance)</span>
                      </th>
                      <th className={TH}>
                        Prize
                        <span className="block font-normal normal-case tracking-normal">its worth and how far from the target</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {l.shares.map((share, i) => {
                      const t = lw?.tiers[i]
                      return (
                        <tr key={i} className="border-b border-slate-100" data-tier={placeKey(lane.id, i)}>
                          <td className={`${TD} font-semibold text-slate-700`}>{i + 1}</td>
                          <td className={TD}>
                            <Num value={share} onCommit={(v) => v != null && setLane(lane.id, { ...l, shares: l.shares.map((x, j) => (j === i ? v : x)) })} className="w-16" aria-label={`${lane.label} tier ${i + 1} share`} data-field="share" />
                          </td>
                          <td className={`${TD} tabular-nums`} data-field="dr" title={t ? `${fmt(t.drTotal, 0)} in all by the end of it` : undefined}>
                            {t ? fmt(t.dr, 0) : '-'}
                          </td>
                          <td className={`${TD} whitespace-nowrap tabular-nums text-slate-600`}>{t ? `${fmt(t.bwFrom, 1)} - ${fmt(t.bwTo, 1)}` : '-'}</td>
                          <td className={`${TD} tabular-nums text-slate-600`}>{t ? fmt(t.earned) : '-'}</td>
                          <td className={`${TD} font-semibold tabular-nums text-purple-700`} data-field="target">
                            {t ? fmt(t.target) : '-'}
                          </td>
                          <td className={TD}>
                            <PrizeField state={state} change={change} index={index} place={placeKey(lane.id, i)} economy={economy} target={t?.target ?? null} limit={PRIZE_LIMIT.tier} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        })}
      </div>
      <Card title="The Final Prize" subtitle={`For finishing both lanes. Its pool is what both lanes give it; it is counted at ${fmt(state.rules.finalCounted)}% of its worth against the pool, so its worth should be the pool / ${fmt(state.rules.finalCounted)}%.`}>
        <div className="flex flex-wrap items-start gap-x-8 gap-y-3" data-testid="wt-final">
          <div className="text-sm text-slate-700">
            <div>
              Pool: <span className="font-semibold tabular-nums" data-field="pool">{fmt(w.pool)}</span>
            </div>
            <div>
              Target worth: <span className="font-semibold tabular-nums text-purple-700" data-field="final-target">{fmt(w.finalTarget)}</span>
            </div>
          </div>
          <PrizeField state={state} change={change} index={index} place="final" economy={economy} target={w.finalTarget} limit={PRIZE_LIMIT.final} className="min-w-[20rem] max-w-3xl flex-1" />
        </div>
      </Card>
      <p className="text-xs text-slate-500" data-note>
        Worth is read by the Economy page, in allowance; a currency with no worth there makes a prize&apos;s worth unknown. Green within 5% of the target, amber within 15%
        - this app&apos;s own reading, not a pass mark. The sheet&apos;s check: at most {PRIZE_LIMIT.tier} prizes in a tier, {PRIZE_LIMIT.final} in the Final Prize.
      </p>
    </>
  )
}

// ---------------------------------------------------------------- 3. Mock
const RESOURCE_LABEL = { free_wild: 'Wild', free_stock: 'Extra stock', free_undo: 'Undo', free_entry: 'Free round' }
const short = (n) => (n >= 1000 ? `${fmt(n / 1000, 1)}K` : fmt(n))
// The parts of a prize, as the mock shows them: [{ label, amount }].
function prizeParts(text) {
  const { node } = parseReward(String(text ?? ''))
  if (!node) return text ? [{ label: text, amount: '' }] : []
  const out = []
  const walk = (n) => {
    if (!n) return
    if (n.type === 'all') return n.parts.forEach(walk)
    if (n.type === 'first') return walk(n.options[0])
    if (n.type === 'chest') return out.push({ label: `Chest ${n.name}`, amount: '' })
    // (Coins are written as an allowance worth; how many coins that is in the game is not taught - shown as written.)
    if (n.type === 'allowance') return out.push({ label: 'Coins', amount: `${short(Number(n.coins) || 0)} allow.` })
    if (n.type === 'resource') return out.push({ label: RESOURCE_LABEL[n.token] ?? n.token, amount: `x${n.amount}` })
    if (n.type === 'dynamic') return out.push({ label: n.name.replace(/^dr-/, ''), amount: `x${n.amount}` })
    if (n.type === 'pack') return out.push({ label: 'Sticker pack', amount: '' })
    if (n.type === 'preset') return out.push({ label: n.key, amount: '' })
  }
  walk(node)
  return out
}
function PrizeBox({ text, done, wide = false }) {
  const parts = prizeParts(text)
  return (
    <div className={`relative flex ${wide ? 'w-full' : 'w-24'} shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl bg-indigo-950/70 px-1.5 py-2 text-center ring-2 ${done ? 'ring-emerald-400/70' : 'ring-white/15'}`} data-mock-prize>
      {parts.length ? (
        parts.map((p, i) => (
          <div key={i} className="leading-tight">
            <div className="text-[11px] font-bold text-amber-200">{p.label}</div>
            {p.amount && <div className="text-xs font-extrabold text-white">{p.amount}</div>}
          </div>
        ))
      ) : (
        <div className="text-[11px] text-white/40">no prize</div>
      )}
      {done && (
        <span className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-emerald-400 text-indigo-950">
          <Check size={13} strokeWidth={3} />
        </span>
      )}
    </div>
  )
}
const LANE_LOOK = {
  easy: { ring: 'ring-sky-200', gem: 'bg-fuchsia-500', bar: 'bg-gradient-to-r from-fuchsia-500 to-pink-400' },
  hard: { ring: 'ring-amber-400', gem: 'bg-teal-400', bar: 'bg-gradient-to-r from-teal-500 to-emerald-300' },
}

function MockView({ state, index, setShown }) {
  const seg = state.segments[index]
  const w = useMemo(() => workOut(state, seg), [state, seg])
  const end = w.E ?? 0
  const [bw, setBw] = useState(0)
  const played = Math.min(bw, end)
  const p = progressAt(w, seg, played)
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentChips state={state} index={index} setShown={setShown} />
      </div>
      {!w.lanes ? (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1 text-sm text-amber-800" data-testid="wt-mock-missing">
          The mock needs this segment worked out first: {w.problems.join(' ')}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700" data-testid="wt-mock-controls">
            <span className="font-semibold">Brut Wins played</span>
            <input type="range" min={0} max={Math.ceil(end)} step={1} value={played} onChange={(e) => setBw(Number(e.target.value))} className="w-72 accent-purple-600" aria-label="Brut Wins played" data-testid="wt-mock-bw" />
            <span className="tabular-nums" data-testid="wt-mock-bw-value">
              {fmt(played, 0)} of {fmt(end, 0)}
            </span>
            <button type="button" className={BUTTON} onClick={() => setBw((b) => Math.min(end, b + 1))} data-testid="wt-mock-win">
              Win a level (+1 BW)
            </button>
            <button type="button" className={BUTTON} onClick={() => setBw(0)}>
              Start again
            </button>
          </div>
          <div className="overflow-x-auto">
            <div className="relative min-w-[760px] rounded-[28px] bg-gradient-to-b from-purple-700 via-purple-800 to-indigo-900 p-5 text-white shadow-xl ring-4 ring-amber-400/80" data-testid="wt-mock">
              <div className="text-center">
                <div className="font-display text-3xl font-black tracking-wide text-amber-300 drop-shadow">WICKED TRAILS</div>
                <div className="text-sm font-bold uppercase tracking-wide text-white/90">Complete both trails to win the final prize!</div>
              </div>
              <div className="mt-4 grid grid-cols-[minmax(0,1fr)_170px] gap-4">
                <div className="flex flex-col justify-center gap-6 rounded-3xl bg-indigo-950/40 p-4">
                  {LANES.map((lane) => {
                    const lp = p[lane.id]
                    const look = LANE_LOOK[lane.id]
                    return (
                      <div key={lane.id} className="flex items-center gap-2" data-mock-lane={lane.id}>
                        <div className="flex w-16 shrink-0 flex-col items-center gap-1">
                          <span className={`grid h-11 w-11 place-items-center rounded-full bg-indigo-950 ring-4 ${look.ring}`}>
                            <span className={`h-5 w-5 rounded-full ${look.gem}`} />
                          </span>
                          <span className="rounded-md bg-indigo-950/80 px-1.5 text-[11px] font-bold tabular-nums" title={`${lane.dr} collected`}>
                            {fmt(lp.collected, 0)}
                          </span>
                        </div>
                        {w.lanes[lane.id].tiers.map((t, i) => {
                          const isDone = i < lp.done
                          const isCurrent = i === lp.done
                          const fill = isDone ? 100 : isCurrent && t.dr > 0 ? Math.min(100, (lp.into / t.dr) * 100) : 0
                          return (
                            <div key={i} className="flex min-w-0 flex-1 items-center gap-2">
                              <div className="relative h-6 min-w-[60px] flex-1 overflow-hidden rounded-full bg-black/40 ring-2 ring-white/10">
                                <div className={`h-full ${look.bar}`} style={{ width: `${fill}%` }} />
                                <span className="absolute inset-0 grid place-items-center text-[11px] font-bold tabular-nums" data-mock-bar={`${lane.id}-${i}`}>
                                  {isDone ? <Check size={14} strokeWidth={3} /> : `${isCurrent ? fmt(lp.into, 0) : 0}/${fmt(t.dr, 0)}`}
                                </span>
                              </div>
                              <PrizeBox text={prizeOf(state, index, placeKey(lane.id, i)).text} done={isDone} />
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
                <div className="flex flex-col items-center gap-2 rounded-[26px] bg-gradient-to-b from-sky-500 to-indigo-700 p-3 ring-4 ring-amber-400" data-mock-final>
                  <div className="text-center font-display text-lg font-black leading-tight text-amber-200">FINAL PRIZE</div>
                  <PrizeBox text={prizeOf(state, index, 'final').text} done={p.lanesDone === 2} wide />
                  <div className="rounded-full bg-indigo-950/80 px-3 py-0.5 text-sm font-bold tabular-nums" data-testid="wt-mock-lanes-done">
                    {p.lanesDone}/2
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500" data-note>
            A sketch of the event for {seg.name}, played by the rules of 2. Prizes - not the game&apos;s artwork. The easy lane is done after {fmt(w.lanes.easy.doneAtBW, 1)} Brut Wins, the hard lane after {fmt(w.lanes.hard.doneAtBW, 1)}.
          </p>
        </>
      )}
    </>
  )
}
