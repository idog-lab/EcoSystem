import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Download, Map as MapIcon } from 'lucide-react'
import Card from '../../../components/ui/Card'
import SheetGrid from '../../../components/SheetGrid'
import { withRest } from '../../../lib/sheetGrid'
import { useEconomy } from '../../../lib/economy/economyStore'
import { checkReward, parseReward } from '../../../lib/economy/parse'
import { currencyChoices } from '../../../lib/economy/economyModel'
import { presetsByKind, presetsFromKinds, readPrize, writePrize } from '../../../lib/economy/prizeParts'
import { presetFor } from '../../../lib/economy/syntax'
import { prizeAgainstWorth } from '../../../lib/economy/prizeWorth'
import { setForFeature, useSegmentSets } from '../../../lib/economy/segmentSets'
import { teamData } from '../../../lib/teamData'
import { FEATURE_NAME, LANES, MAX_TIERS, PRIZE_LIMIT, STORAGE_KEY, normalizeState, placeKey, prizeOf, progressAt, resolveEfforts, stepStatus, withTierCount, workOut } from '../lib/wickedTrails'
import { END_TRIGGER, FINAL_FILTER, FINAL_TRIGGER, OPS_HEADERS, RC_FINAL_COINS, RC_TIER_EFFORT, SHEET_NAMES, UNUSED, buildExport, exportFileName, exportWorkbook, triggerOf } from '../lib/wickedTrailsExport'

// WICKED TRAILS (lib/wickedTrails.js): the event built step by step (economist: "the flow of the wicked trails is not
// good. it should be intuitive how i go on with the event build") - the segments, the rules, the tiers, the prizes
// against what each should be worth, a mock to look at, and the export for Ops. Each step says what it is for and
// what it still needs; Next leads on.
const STEP_KEY = 'superplay-wicked-trails-view'
const STEPS = [
  { id: 'segments', label: 'Segments', purpose: 'Take the segments from a segment set. Give each its effort in Brut Wins - typed, or a factor of another segment - and how much silver and gold DR one Brut Win gives it. Pick the base: its prizes are the ones you type.' },
  { id: 'rules', label: 'Rules', purpose: 'Type the feature\'s ROE - the allowance worth of prizes a player gets from one Brut Win - and check how it is shared between the lanes and the Final Prize.' },
  { id: 'tiers', label: 'Tiers and prizes', purpose: 'One sheet: how many tiers each lane has, where they sit (shares of the lane), and the prize of every tier and of the Final Prize, beside the worth it should give. Move with the arrows, type over a cell, paste from Excel.' },
  { id: 'mock', label: 'Mock', purpose: 'Play the event for a segment, a Brut Win at a time, and see the lanes fill.' },
  { id: 'export', label: 'Export', purpose: 'Pick the event\'s first day and download the workbook for Ops: the segments, Config OPS and Config RC OPS.' },
]
const INPUT = 'rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-200'
const BUTTON = 'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-purple-300 hover:text-purple-700'
const PRIMARY = 'inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-purple-700 disabled:opacity-40'
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

export default function WickedTrailsApp({ onHome }) {
  const [state, setState] = useState(() => normalizeState(load(STORAGE_KEY, null)))
  // (A step remembered from before the sheet: Prizes is now part of Tiers and prizes.)
  const [step, setStepState] = useState(() => {
    const kept = load(STEP_KEY, null) === 'prizes' ? 'tiers' : load(STEP_KEY, null)
    return STEPS.some((s) => s.id === kept) ? kept : 'segments'
  })
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
  const goTo = (id) => {
    setStepState(id)
    window.scrollTo({ top: 0 })
    try {
      window.localStorage.setItem(STEP_KEY, JSON.stringify(id))
    } catch {
      // Not remembered; nothing else depends on it.
    }
  }
  // Every change works the efforts out again (a segment may follow another's).
  const change = (fn) => setState((s) => resolveEfforts(fn(s)))
  const index = shown != null && shown < state.segments.length ? shown : Math.min(state.baseIndex, Math.max(0, state.segments.length - 1))
  const parts = stepStatus(state, (text) => checkReward(text, { economy }).ok)
  // Tiers and prizes are one step: done when both are.
  const status = { ...parts, tiers: { done: parts.tiers.done && parts.prizes.done, missing: [...parts.tiers.missing, ...parts.prizes.missing] } }
  const at = STEPS.findIndex((s) => s.id === step)
  const current = STEPS[at]
  const missing = status[step]?.missing ?? []
  const needsSegments = ['tiers', 'prizes', 'mock', 'export'].includes(step) && !state.segments.length

  return (
    <div className="min-h-screen">
      <div className="app-backdrop" aria-hidden="true" />
      <header className="mx-auto flex max-w-[1760px] flex-wrap items-center gap-x-4 gap-y-2 px-6 pb-2 pt-4" data-testid="wt-header">
        <button type="button" onClick={onHome} aria-label="Back to the features" title="Back to the features" className="grid h-9 w-9 place-items-center rounded-xl border border-white bg-white/80 text-slate-500 ring-1 ring-slate-200/70 transition-colors hover:text-purple-600">
          <ArrowLeft size={16} />
        </button>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-purple-600 to-fuchsia-500 text-white shadow-md shadow-purple-500/30">
          <MapIcon size={18} strokeWidth={2.25} />
        </span>
        <h1 className="font-display text-xl font-bold tracking-tight text-slate-900">Wicked Trails</h1>
        <span className="text-sm text-slate-500">A level feature: two lanes filled by Brut Wins, and a Final Prize for finishing both.</span>
      </header>
      <main className="mx-auto flex max-w-[1760px] flex-col gap-4 px-6 pb-10">
        <nav className="flex flex-wrap items-center gap-1" aria-label="The steps of the build" data-testid="wt-steps">
          {STEPS.map((s, i) => {
            const done = status[s.id]?.done
            return (
              <div key={s.id} className="flex items-center gap-1">
                {i > 0 && <ArrowRight size={14} className="text-slate-300" />}
                <button
                  type="button"
                  onClick={() => goTo(s.id)}
                  aria-current={step === s.id ? 'step' : undefined}
                  data-step={s.id}
                  data-done={done ? 'true' : undefined}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold ring-1 transition-colors ${step === s.id ? 'bg-slate-800 text-white ring-slate-800' : 'bg-white/80 text-slate-600 ring-slate-200 hover:text-purple-700'}`}
                >
                  <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${done ? 'bg-emerald-500 text-white' : step === s.id ? 'bg-white text-slate-800' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                  {s.label}
                  {done && <Check size={14} strokeWidth={3} className={step === s.id ? 'text-emerald-300' : 'text-emerald-600'} aria-label="done" />}
                </button>
              </div>
            )
          })}
        </nav>
        <div className="rounded-2xl border border-purple-100 bg-white/85 px-4 py-3 shadow-sm" data-testid="wt-step-head">
          <div className="text-xs font-semibold uppercase tracking-wide text-purple-600">
            Step {at + 1} of {STEPS.length} · {current.label}
          </div>
          <p className="mt-0.5 text-sm text-slate-700" data-testid="wt-step-purpose">
            {current.purpose}
          </p>
          {missing.length > 0 && (
            <div className="mt-2 flex flex-col gap-0.5" data-testid="wt-step-missing">
              <span className="text-xs font-semibold text-amber-700">Still needed:</span>
              <ul className="ml-4 list-disc text-xs text-amber-800">
                {missing.slice(0, 8).map((m) => (
                  <li key={m}>{m}</li>
                ))}
                {missing.length > 8 && <li>and {missing.length - 8} more</li>}
              </ul>
            </div>
          )}
        </div>

        {needsSegments ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-6 text-center text-sm text-slate-500" data-testid="wt-no-segments">
            No segments yet: take them from a segment set in step 1.
          </p>
        ) : (
          <>
            {step === 'segments' && <SegmentsStep state={state} change={change} />}
            {step === 'rules' && <RulesStep state={state} change={change} />}
            {step === 'tiers' && <TiersStep state={state} change={change} index={index} setShown={setShown} economy={economy} />}
            {step === 'mock' && <MockStep state={state} index={index} setShown={setShown} />}
            {step === 'export' && <ExportStep state={state} change={change} index={index} setShown={setShown} />}
          </>
        )}

        <div className="flex items-center justify-between border-t border-slate-200/70 pt-3" data-testid="wt-step-nav">
          {at > 0 ? (
            <button type="button" className={BUTTON} onClick={() => goTo(STEPS[at - 1].id)} data-testid="wt-back">
              Back: {STEPS[at - 1].label}
            </button>
          ) : (
            <span />
          )}
          {at < STEPS.length - 1 && (
            <button type="button" className={PRIMARY} onClick={() => goTo(STEPS[at + 1].id)} data-testid="wt-next">
              Next: {STEPS[at + 1].label} <ArrowRight size={15} />
            </button>
          )}
        </div>
      </main>
    </div>
  )
}

function SegmentChips({ state, index, setShown, note = null }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap gap-1.5" data-testid="wt-segment-chips">
        {state.segments.map((seg, i) => (
          <button key={seg.key || i} type="button" onClick={() => setShown(i)} aria-pressed={index === i} data-wt-chip={i} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ${index === i ? 'bg-purple-600 text-white ring-purple-600' : 'bg-white text-slate-600 ring-slate-200 hover:text-purple-700'}`}>
            {seg.name}
            {state.baseIndex === i ? ' (base)' : ''}
          </button>
        ))}
      </div>
      {note && <span className="text-xs text-slate-500">{note}</span>}
    </div>
  )
}

// ---------------------------------------------------------------- 1. Segments
function SegmentsStep({ state, change }) {
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
      // What was typed for a segment is kept by its key when the set is taken again (its effort comes from the set).
      const kept = new Map(s.segments.map((x) => [x.key, x]))
      const keys = new Set(r.segments.map((x) => x.key))
      return {
        ...s,
        segments: r.segments.map((x) => {
          const k = kept.get(x.key)
          // A segment that follows another in the set follows it here too (x its factor); else a link made here is kept.
          const follows = !x.effortOf && k?.effortOf && keys.has(k.effortOf)
          const effortOf = x.effortOf ?? (follows ? k.effortOf : null)
          const effortFactor = x.effortOf ? x.effortFactor : follows ? k.effortFactor : null
          return { name: x.name, key: x.key, condition: x.condition, effortTyped: x.effort, effortOf, effortFactor, silverPerBW: k?.silverPerBW ?? null, goldPerBW: k?.goldPerBW ?? null, own: k?.own ?? {} }
        }),
        baseIndex: Math.min(s.baseIndex, r.segments.length - 1),
        segmentSet: { id: set.id, name: set.name, updatedAt: set.updatedAt },
      }
    })
    setMessage(`${r.segments.length} segments taken from "${set.name}", named ${FEATURE_NAME}_, ${r.segments.filter((x) => x.effort != null).length} with an effort in Brut Wins.`)
  }
  const setAll = (field, v) => change((s) => ({ ...s, segments: s.segments.map((x) => ({ ...x, [field]: v })) }))

  return (
    <Card title="The segments" subtitle="Effort: typed (from the set, or your own number), or another segment's times a factor - it then follows that segment.">
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
        {state.segments.length > 0 && <SegmentsSheet state={state} change={change} />}
        {state.segments.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600" data-testid="wt-fill-all">
            Same for every segment:
            <Num value={null} onCommit={(v) => v != null && v >= 0 && setAll('silverPerBW', v)} className="w-16" placeholder="silver" aria-label="Silver DR per Brut Win for every segment" data-field="all-silver" />
            <Num value={null} onCommit={(v) => v != null && v >= 0 && setAll('goldPerBW', v)} className="w-16" placeholder="gold" aria-label="Gold DR per Brut Win for every segment" data-field="all-gold" />
            <span className="text-slate-400">DR per Brut Win</span>
          </div>
        )}
      </div>
    </Card>
  )
}

// The segments as a sheet: the base (a tick), where the effort comes from (Typed, or x another segment), the effort
// typed or the factor, silver and gold DR per Brut Win; the rest worked out.
function SegmentsSheet({ state, change }) {
  const rows = state.segments.map((seg, i) => ({ id: seg.key || `seg-${i}`, i, seg, w: workOut(state, seg) }))
  const columns = [
    { key: 'base', label: 'Base', width: 56, type: 'toggle', editable: true, value: (r) => state.baseIndex === r.i, align: 'right', title: () => 'The base: its prizes are the ones typed; Space to make a segment the base' },
    { key: 'name', label: 'Segment', width: 240, value: (r) => r.seg.name, title: (r) => r.seg.condition || undefined, tone: () => 'font-semibold !text-slate-800' },
    {
      key: 'from',
      label: 'Effort from',
      sub: 'Enter to pick',
      width: 210,
      type: 'select',
      editable: true,
      value: (r) => r.seg.effortOf ?? '',
      options: (r) => [{ value: '', label: 'Typed' }, ...state.segments.filter((o) => o.key !== r.seg.key).map((o) => ({ value: o.key, label: `x ${o.name}` }))],
    },
    { key: 'typed', label: 'Effort', sub: 'Brut Wins, typed', width: 96, type: 'number', align: 'right', editable: (r) => !r.seg.effortOf, value: (r) => (r.seg.effortOf ? null : r.seg.effortTyped) },
    { key: 'factor', label: 'Factor', sub: 'x the segment', width: 80, type: 'number', align: 'right', editable: (r) => !!r.seg.effortOf, value: (r) => (r.seg.effortOf ? r.seg.effortFactor : null) },
    { key: 'effort', label: 'Effort', sub: 'in force', width: 86, type: 'number', align: 'right', value: (r) => r.seg.effortBW, tone: (r) => (r.seg.effortProblem ? '!text-amber-700' : 'font-semibold !text-purple-700'), title: (r) => r.seg.effortProblem ?? undefined },
    { key: 'silver', label: 'Silver DR', sub: 'per Brut Win', width: 90, type: 'number', align: 'right', editable: true, value: (r) => r.seg.silverPerBW },
    { key: 'gold', label: 'Gold DR', sub: 'per Brut Win', width: 90, type: 'number', align: 'right', editable: true, value: (r) => r.seg.goldPerBW },
    // (A lane's length needs no ROE: the easy lane is its share of the effort x silver, the hard lane the effort x gold.)
    { key: 'easy', label: 'Easy lane', sub: 'silver DR', width: 84, type: 'number', align: 'right', value: (r) => (r.seg.effortBW > 0 && r.seg.silverPerBW > 0 && state.rules.easySize > 0 ? Math.round((state.rules.easySize / 100) * r.seg.effortBW * r.seg.silverPerBW) : null) },
    { key: 'hard', label: 'Hard lane', sub: 'gold DR', width: 84, type: 'number', align: 'right', value: (r) => (r.seg.effortBW > 0 && r.seg.goldPerBW > 0 ? Math.round(r.seg.effortBW * r.seg.goldPerBW) : null) },
    { key: 'worth', label: 'Worth', sub: 'allowance', width: 84, type: 'number', align: 'right', value: (r) => (r.seg.effortBW > 0 && state.rules.roe > 0 ? Math.round(r.seg.effortBW * state.rules.roe * 100) / 100 : null), title: () => 'Effort x ROE (step 2)' },
  ]
  const FIELD = { typed: 'effortTyped', factor: 'effortFactor', silver: 'silverPerBW', gold: 'goldPerBW' }
  const commit = (changes) =>
    change((s) => {
      let out = s
      for (const { row, key, value } of changes) {
        if (key === 'base') {
          if (value) out = { ...out, baseIndex: row.i }
          continue
        }
        const patch = key === 'from' ? (value ? { effortOf: value, effortFactor: out.segments[row.i].effortFactor ?? 1 } : { effortOf: null, effortTyped: out.segments[row.i].effortBW ?? out.segments[row.i].effortTyped }) : FIELD[key] ? { [FIELD[key]]: value != null && value < 0 ? null : value } : null
        if (patch) out = { ...out, segments: out.segments.map((x, j) => (j === row.i ? { ...x, ...patch } : x)) }
      }
      return out
    })
  return <SheetGrid testid="wt-segments" columns={columns} rows={rows} onCommit={commit} />
}

// ---------------------------------------------------------------- 2. Rules
function RulesStep({ state, change }) {
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
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="The ROE" subtitle="This feature's own rate of economy.">
        <div data-testid="wt-rules-roe">{field('roe', 'ROE', 'Rate of economy: the allowance worth of prizes a player gets from one Brut Win', 'allowance a Brut Win')}</div>
      </Card>
      <Card title="How it is shared" subtitle="These five start at the old sheet's values - type yours over them.">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3" data-testid="wt-rules">
          {field('easyShare', 'Easy lane\'s share', 'While both lanes fill, this share of each Brut Win\'s ROE goes to the easy lane, the rest to the hard lane. Once the easy lane is done, all of it goes to the hard lane.', '% of a BW')}
          {field('easySize', 'Easy lane\'s length', 'The easy lane is done after this share of the effort; the hard lane lasts the whole effort', '% of the hard')}
          {field('takeEasy', 'Easy to the Final Prize', 'The share of what the easy lane earns that goes to the Final Prize; its tiers get the rest')}
          {field('takeHard', 'Hard to the Final Prize', 'The share of what the hard lane earns that goes to the Final Prize; its tiers get the rest')}
          {field('finalCounted', 'Final Prize counted at', 'The Final Prize is counted at this share of its worth against the pool: its worth should be the pool divided by it')}
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- 3. Tiers and prizes, one sheet
// How far a prize is from its target, in words and colour.
function OffBy({ check, target }) {
  if (!check) return <span className="text-slate-300">-</span>
  if (!check.ok) return <span className="text-rose-700">{check.issues.find((x) => x.level === 'error')?.message ?? 'Cannot be read'}</span>
  if (check.worth == null) return <span className="text-amber-700">no worth yet{check.unknown.length ? `: ${check.unknown.join(', ')}` : ''}</span>
  if (target == null) return <span className="text-slate-400">no target</span>
  const pct = Math.abs(check.gapPct ?? 0)
  const tone = pct <= 5 ? 'text-emerald-700' : pct <= 15 ? 'text-amber-700' : 'text-rose-700'
  return <span className={`font-semibold ${tone}`} data-gap-pct={check.gapPct}>{`${check.gap > 0 ? '+' : ''}${fmt(check.gap)} (${check.gapPct > 0 ? '+' : ''}${check.gapPct}%)`}</span>
}

// What a prize change does: on the base it is every segment's; on another segment it is that segment's own (empty:
// the base's again).
function prizeChange(s, index, place, text) {
  const t = String(text ?? '').trim()
  if (index === s.baseIndex) {
    if (place === 'final') return { ...s, finalPrize: t }
    const [laneId, i] = place.split('-')
    return { ...s, lanes: { ...s.lanes, [laneId]: { ...s.lanes[laneId], prizes: s.lanes[laneId].prizes.map((x, j) => (j === Number(i) ? t : x)) } } }
  }
  // The base's prize, scaled for this segment, is not "its own": it follows the base again.
  const scaled = prizeOf({ ...s, segments: s.segments.map((x, j) => (j === index ? { ...x, own: { ...x.own, [place]: '' } } : x)) }, index, place).text
  return { ...s, segments: s.segments.map((x, j) => (j === index ? { ...x, own: { ...x.own, [place]: t === scaled ? '' : t } } : x)) }
}

// Each lane's colour in the sheet (the colours of its DR in the mock), the Final Prize's its own; solid, so a sticky
// cell sits on it (economist: "maybe to have coloring to differ between the lanes").
const LANE_TONE = {
  easy: { edit: 'bg-fuchsia-50', fixed: 'bg-fuchsia-100', edge: 'border-l-fuchsia-400' },
  hard: { edit: 'bg-teal-50', fixed: 'bg-teal-100', edge: 'border-l-teal-500' },
  final: { edit: 'bg-amber-50', fixed: 'bg-amber-100', edge: 'border-l-amber-400' },
}

// A list typed in one cell: "a, b" -> ['a', 'b'].
const listOf = (v) =>
  String(v ?? '')
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
const MINI_KINDS = [
  { value: 'allowance', label: 'Coins' },
  { value: 'undo', label: 'Undo' },
  { value: 'es', label: 'Extra stock' },
  { value: 'wild', label: 'Wild' },
  { value: 'entry', label: 'Free round' },
]
const RESOURCE_COLUMNS = [
  { key: 'wild', label: 'Wild' },
  { key: 'stock', label: 'Extra stock' },
  { key: 'undo', label: 'Undo' },
  { key: 'entry', label: 'Free round' },
]

// THE PRIZE IN THE TABLE (economist: "we need to be able in the table to insert the prizes, not in the prize builder.
// i think the best way is to have in the table the core resources, with presets and stickers options, puzzle and mini
// games, and to have an option to add DRs and triggers if needed, and then wrap it with chests if needed also. we are
// supposed to also see as we said the calculation of the tier vs the amount that should actually be there"): one
// column a part, the text written from them (lib/economy/prizeParts.js), the target, the worth and how far it is.
function TiersStep({ state, change, index, setShown, economy }) {
  const seg = state.segments[index]
  const w = workOut(state, seg)
  const isBase = index === state.baseIndex
  const keys = (list) => (economy?.keys?.[list] ?? []).map((k) => k.key).filter(Boolean)
  const presetKeys = keys('presets')
  const packKeys = keys('packs')
  const chestKeys = keys('chests')
  const currencyNames = [...new Set([...(economy?.currencies ?? []).map((c) => c.name), ...currencyChoices(economy ?? {})])].filter((n) => n && n !== 'dr-hidden' && n !== 'dr-pack-counter')
  const setLane = (laneId, lane) => change((s) => ({ ...s, lanes: { ...s.lanes, [laneId]: lane } }))
  const rows = [
    ...LANES.flatMap((lane) =>
      state.lanes[lane.id].shares.map((share, i) => {
        const t = w.lanes?.[lane.id].tiers[i]
        const place = placeKey(lane.id, i)
        const prize = prizeOf(state, index, place)
        const parts = readPrize(prize.text).parts
        return { id: place, place, laneId: lane.id, lane: lane.label, tier: i + 1, last: i === state.lanes[lane.id].shares.length - 1, share, t, target: t?.target ?? null, prize, parts, kinds: presetsByKind(parts.presets) }
      }),
    ),
    (() => {
      const prize = prizeOf(state, index, 'final')
      const parts = readPrize(prize.text).parts
      return { id: 'final', place: 'final', laneId: null, lane: 'Final Prize', tier: '', last: false, share: null, t: null, target: w.finalTarget, prize, parts, kinds: presetsByKind(parts.presets) }
    })(),
  ]
  const checkOf = (row) => (row.prize.text ? prizeAgainstWorth(row.prize.text, row.target, economy, { prizeMode: 'custom', prizeLimit: row.place === 'final' ? PRIZE_LIMIT.final : PRIZE_LIMIT.tier }) : null)
  const anyMore = rows.some((r) => r.parts.currencies.length || r.parts.triggers.length || r.parts.extra.length || r.parts.packCoins != null)
  const [showLane, setShowLane] = useState(false)
  const [showMore, setShowMore] = useState(anyMore)
  const more = showMore || anyMore
  const own = (r) => (r.prize.own ? '' : 'italic !text-slate-400')
  const whole = (_, v) => (v != null && !Number.isInteger(v) ? 'a whole number' : null)

  const columns = [
    { key: 'lane', group: 'The tier', label: 'Lane', width: 96, sticky: true, display: (r) => <span className={r.place === 'final' ? 'font-semibold text-purple-700' : 'font-semibold text-slate-700'}>{r.lane}</span> },
    { key: 'tier', group: 'The tier', label: 'Tier', width: 44, sticky: true },
    {
      key: 'share',
      group: 'The tier',
      label: 'Share',
      sub: '% of lane',
      width: 82,
      type: 'number',
      align: 'right',
      // The last tier of a lane is the rest of it: worked out, never typed - the lane always adds up to 100%.
      editable: (r) => r.place !== 'final' && !r.last,
      display: (r) => (r.place === 'final' ? '' : r.last && r.tier > 1 ? <span title="The rest of the lane: 100% less the tiers before it">{fmt(r.share)} <span className="text-[10px] text-slate-400">rest</span></span> : fmt(r.share)),
      title: () => "The tier's share of the lane. The last tier is the rest, so a lane always adds up to 100%",
    },
    { key: 'drTotal', group: 'The tier', label: 'DR', sub: 'in all', width: 72, type: 'number', align: 'right', value: (r) => r.t?.drTotal ?? null, title: () => 'The DR in all to the end of the tier - what Ops gets' },
    ...(showLane
      ? [
          { key: 'dr', group: 'The tier', label: 'DR', sub: 'this tier', width: 72, type: 'number', align: 'right', value: (r) => r.t?.dr ?? null },
          { key: 'bw', group: 'The tier', label: 'Brut Wins', sub: 'from - to', width: 90, align: 'right', value: (r) => (r.t ? `${fmt(r.t.bwFrom, 1)} - ${fmt(r.t.bwTo, 1)}` : '') },
          { key: 'earned', group: 'The tier', label: 'Earned', width: 70, type: 'number', align: 'right', value: (r) => (r.place === 'final' ? w.pool : (r.t?.earned ?? null)) },
        ]
      : []),
    { key: 'target', group: 'Against the target', label: 'Target', sub: 'allowance', width: 76, type: 'number', align: 'right', tone: () => 'font-semibold !text-purple-700' },
    { key: 'worth', group: 'Against the target', label: 'Worth', sub: 'of the prize', width: 70, type: 'number', align: 'right', value: (r) => checkOf(r)?.worth ?? null },
    { key: 'off', group: 'Against the target', label: 'Off by', width: 130, value: (r) => checkOf(r)?.gap ?? null, title: (r) => (checkOf(r)?.unknown?.length ? 'No worth yet on the Economy page: ' + checkOf(r).unknown.join(', ') : undefined), display: (r) => <OffBy check={checkOf(r)} target={r.target} /> },
    { key: 'coins', group: 'The prize', label: 'Coins', sub: 'allowance', width: 76, type: 'number', align: 'right', editable: true, value: (r) => r.parts.coins, tone: own },
    ...RESOURCE_COLUMNS.map((c) => ({ key: c.key, group: 'The prize', label: c.label, width: c.key === 'stock' || c.key === 'entry' ? 70 : 58, type: 'number', align: 'right', editable: true, value: (r) => r.parts[c.key], check: whole, tone: own })),
    {
      key: 'puzzle',
      group: 'The prize',
      label: 'Puzzle',
      sub: 'pieces',
      width: 66,
      type: 'number',
      align: 'right',
      editable: true,
      value: (r) => r.kinds.puzzle?.amount ?? null,
      check: (_, v) => (v != null && !presetFor('puzzle', v, '', economy) ? 'no puzzle preset on the Economy page' : null),
      title: (r) => r.kinds.puzzle?.key ?? 'A puzzle preset: the nearest amount on the Economy page is taken',
      tone: own,
    },
    {
      key: 'mini',
      group: 'The prize',
      label: 'Mini game',
      sub: 'amount',
      width: 70,
      type: 'number',
      align: 'right',
      editable: true,
      value: (r) => r.kinds.mini?.amount ?? null,
      check: (r, v) => (v != null && !presetFor('mini_game', v, r.kinds.mini?.kind ?? 'allowance', economy) ? 'no mini game preset on the Economy page' : null),
      title: (r) => r.kinds.mini?.key ?? 'A mini game preset: the nearest amount on the Economy page is taken',
      tone: own,
    },
    { key: 'miniKind', group: 'The prize', label: 'Mini game', sub: 'gives', width: 92, type: 'select', editable: (r) => !!r.kinds.mini, value: (r) => r.kinds.mini?.kind ?? '', options: () => MINI_KINDS, tone: own },
    {
      key: 'presets',
      group: 'The prize',
      label: 'Other presets',
      sub: 'type to search; a, b',
      width: 190,
      type: 'text',
      editable: true,
      value: (r) => r.kinds.others.join(', '),
      suggestions: () => presetKeys,
      check: (_, v) => listOf(v).find((k) => !presetKeys.includes(k)) && `"${listOf(v).find((k) => !presetKeys.includes(k))}" is not a preset on the Economy page`,
      title: (r) => r.kinds.others.join(', ') || undefined,
      tone: (r) => `font-mono text-[11.5px] ${own(r)}`,
    },
    {
      key: 'pack',
      group: 'The prize',
      label: 'Sticker pack',
      sub: 'type to search',
      width: 220,
      type: 'text',
      editable: true,
      value: (r) => r.parts.pack,
      suggestions: () => packKeys,
      check: (_, v) => (v && !packKeys.includes(v) ? `"${v}" is not a sticker pack on the Economy page` : null),
      title: (r) => r.parts.pack || undefined,
      tone: (r) => `font-mono text-[11.5px] ${own(r)}`,
    },
    {
      key: 'chest',
      group: 'The prize',
      label: 'Chest',
      sub: 'wraps it',
      width: 92,
      type: 'select',
      editable: true,
      value: (r) => r.parts.chest,
      options: () => [{ value: '', label: '-' }, ...chestKeys.map((k) => ({ value: k, label: k }))],
      display: (r) => r.parts.chest || (r.last ? <span className="text-slate-300" title="The export puts the lane's last tier in its chest">{r.laneId === 'easy' ? 'silver*' : 'golden*'}</span> : ''),
      tone: own,
    },
    ...(more
      ? [
          {
            key: 'drs',
            group: 'More',
            label: 'DRs',
            sub: 'dr-name:amount, ...',
            width: 200,
            type: 'text',
            editable: true,
            value: (r) => r.parts.currencies.map((c) => `${c.name}:${c.amount}`).join(', '),
            suggestions: () => currencyNames.map((n) => `${n}:`),
            check: (_, v) => {
              for (const item of listOf(v)) {
                const [name, amount] = item.split(':').map((x) => x.trim())
                if (!currencyNames.includes(name)) return `"${name}" is not a currency on the Economy page`
                if (!(Number(amount) >= 1) || !Number.isInteger(Number(amount))) return `${name}: a whole amount of 1 or more`
              }
              return null
            },
            tone: (r) => `font-mono text-[11.5px] ${own(r)}`,
          },
          { key: 'triggers', group: 'More', label: 'Triggers', sub: 'a, b - the export adds the tier\'s own', width: 170, type: 'text', editable: true, value: (r) => r.parts.triggers.join(', '), check: (_, v) => listOf(v).find((t) => !/^[a-z0-9_]+$/.test(t)) && 'a trigger is lower case letters, digits and "_"', tone: (r) => `font-mono text-[11.5px] ${own(r)}` },
          { key: 'packCoins', group: 'More', label: 'Pack or coins', sub: 'allowance', width: 80, type: 'number', align: 'right', editable: (r) => !!r.parts.pack, value: (r) => r.parts.packCoins, title: () => 'Coins given instead of the pack when the player cannot get it', tone: own },
          { key: 'text', group: 'More', label: 'The text', sub: 'as Ops gets it; can be pasted whole', width: 380, type: 'text', editable: true, value: (r) => r.prize.text, title: (r) => r.prize.text || undefined, tone: (r) => `font-mono text-[11.5px] ${own(r)}` },
        ]
      : []),
  ]

  // A cell of the prize changed: the text is written again from its parts.
  function withPart(parts, key, value) {
    const p = { ...parts, presets: [...parts.presets] }
    const kinds = presetsByKind(p.presets)
    if (key === 'coins') p.coins = value == null ? null : Math.round(value * 100) / 100
    else if (['wild', 'stock', 'undo', 'entry'].includes(key)) p[key] = value
    else if (key === 'puzzle') p.presets = presetsFromKinds({ ...kinds, puzzle: value == null ? null : (presetFor('puzzle', value, '', economy) ?? kinds.puzzle) })
    else if (key === 'mini') p.presets = presetsFromKinds({ ...kinds, mini: value == null ? null : (presetFor('mini_game', value, kinds.mini?.kind ?? 'allowance', economy) ?? kinds.mini) })
    else if (key === 'miniKind' && kinds.mini) p.presets = presetsFromKinds({ ...kinds, mini: presetFor('mini_game', kinds.mini.amount, value, economy) ?? kinds.mini })
    else if (key === 'presets') p.presets = presetsFromKinds({ ...kinds, others: listOf(value) })
    else if (key === 'pack') {
      p.pack = value || ''
      if (!value) p.packCoins = null
      else if (!parts.pack) p.packCounter = true
    } else if (key === 'packCoins') p.packCoins = value
    else if (key === 'chest') p.chest = value || ''
    else if (key === 'triggers') p.triggers = listOf(value)
    else if (key === 'drs')
      p.currencies = listOf(value).map((item) => {
        const [name, amount] = item.split(':').map((x) => x.trim())
        return { name, amount: Number(amount) }
      })
    return p
  }
  const commit = (changes) =>
    change((s) => {
      let out = s
      for (const { row, key, value } of changes) {
        if (key === 'share' && row.laneId) {
          const lane = out.lanes[row.laneId]
          out = { ...out, lanes: { ...out.lanes, [row.laneId]: { ...lane, shares: withRest(lane.shares, row.tier - 1, value) } } }
          continue
        }
        const current = prizeOf(out, index, row.place).text
        const text = key === 'text' ? value : writePrize(withPart(readPrize(current).parts, key, value))
        out = prizeChange(out, index, row.place, text)
      }
      return out
    })

  return (
    <>
      <SegmentChips state={state} index={index} setShown={setShown} note={isBase ? "The base: its prizes are every segment's, times its effort against the base's." : "Its prizes are the base's times its effort against the base's (grey) - type in a row to give it its own."} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2" data-testid="wt-tier-counts">
        {LANES.map((lane) => (
          <label key={lane.id} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            {lane.label} ({lane.dr}): tiers
            <Num value={state.lanes[lane.id].shares.length} onCommit={(v) => v != null && setLane(lane.id, withTierCount(state.lanes[lane.id], v))} className="w-14" aria-label={`${lane.label}: how many tiers`} data-tier-count={lane.id} />
            <span className="text-xs font-normal text-slate-400">1 to {MAX_TIERS}</span>
          </label>
        ))}
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={showLane} onChange={(e) => setShowLane(e.target.checked)} className="accent-purple-600" data-testid="wt-show-lane" />
          the lane&apos;s numbers (DR this tier, Brut Wins, earned)
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600" title={anyMore ? 'Shown: a prize here has DRs, triggers or a part with no column' : undefined}>
          <input type="checkbox" checked={more} disabled={anyMore} onChange={(e) => setShowMore(e.target.checked)} className="accent-purple-600" data-testid="wt-show-more" />
          DRs, triggers and the text
        </label>
      </div>
      {w.lanes ? (
        <p className="text-sm text-slate-700" data-testid="wt-totals">
          <span className="font-semibold">{seg.name}</span>: {fmt(w.E)} Brut Wins x ROE {fmt(state.rules.roe, 4)} = <span className="font-semibold">{fmt(w.total)}</span> allowance. The easy lane: {fmt(w.lanes.easy.totalDR, 0)} silver DR
          over {fmt(w.lanes.easy.doneAtBW, 1)} Brut Wins; the hard lane: {fmt(w.lanes.hard.totalDR, 0)} gold DR over {fmt(w.lanes.hard.doneAtBW, 1)}. The Final Prize&apos;s pool <span data-field="pool">{fmt(w.pool)}</span>, counted at {fmt(state.rules.finalCounted)}%: its target{' '}
          <span data-field="final-target">{fmt(w.finalTarget)}</span>.
        </p>
      ) : (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1 text-sm text-amber-800" data-testid="wt-prizes-blocked">
          {seg.name} cannot be worked out yet: {w.problems.join(' ')}
        </p>
      )}
      <SheetGrid testid="wt-tiers" columns={columns} rows={rows} onCommit={commit} rowTone={(r) => LANE_TONE[r.laneId ?? 'final']} />
      <p className="text-xs text-slate-500" data-note>
        Puzzle and mini game take the nearest amount that has a preset on the Economy page. Worth is read by the Economy page, in allowance; a part with no worth there
        (most presets, for now) leaves the prize&apos;s worth unknown. Off by: green within 5% of the target, amber within 15% - this app&apos;s own reading. At most{' '}
        {PRIZE_LIMIT.tier} prizes in a tier, {PRIZE_LIMIT.final} in the Final Prize (the sheet&apos;s check). * The export puts each lane&apos;s last tier in its chest and adds each
        tier&apos;s trigger.
      </p>
    </>
  )
}

// ---------------------------------------------------------------- 5. Mock
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
            <div className="break-all text-[11px] font-bold text-amber-200">{p.label}</div>
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

function MockStep({ state, index, setShown }) {
  const seg = state.segments[index]
  const w = useMemo(() => workOut(state, seg), [state, seg])
  const end = w.E ?? 0
  const [bw, setBw] = useState(0)
  const played = Math.min(bw, end)
  const p = progressAt(w, seg, played)
  return (
    <>
      <SegmentChips state={state} index={index} setShown={setShown} />
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
            A sketch of the event for {seg.name}, played by the rules of the steps before - not the game&apos;s artwork. The easy lane is done after {fmt(w.lanes.easy.doneAtBW, 1)} Brut Wins, the hard lane after{' '}
            {fmt(w.lanes.hard.doneAtBW, 1)}.
          </p>
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------- 6. Export
function ExportStep({ state, change, index, setShown }) {
  const data = useMemo(() => buildExport(state), [state])
  const [message, setMessage] = useState(null)
  const seg = state.segments[index]
  const rowIndex = data.ops.findIndex((r) => r[0] === (seg?.key || `def_${seg?.name}`))
  const fileName = exportFileName(state.startDate)
  // The columns that say something for this segment: the event's, and each lane's tiers in use.
  const shownColumns = OPS_HEADERS.map((h, c) => ({ h, c })).filter(({ h, c }) => {
    if (rowIndex < 0) return false
    const v = data.ops[rowIndex][c]
    return !(String(h).includes('Milestone_') && (v === UNUSED.req || v === UNUSED.res))
  })

  async function download() {
    try {
      const { workbook } = await exportWorkbook(state)
      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
      setMessage({ tone: 'ok', text: `Downloaded ${fileName}: ${data.ops.length} segments on each config sheet.` })
    } catch (e) {
      setMessage({ tone: 'error', text: `Not downloaded: ${e?.message ?? e}` })
    }
  }

  return (
    <>
      <Card title="The workbook" subtitle={`Three sheets, as the example: "${SHEET_NAMES.segments}", "${SHEET_NAMES.ops}" and "${SHEET_NAMES.rc}" - one row per segment.`}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              The event&apos;s first day
              <input type="date" value={state.startDate ?? ''} onChange={(e) => change((s) => ({ ...s, startDate: e.target.value }))} className={INPUT} data-testid="wt-start-date" />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">File</span>
              <span className="font-mono text-sm text-slate-700" data-testid="wt-file-name">
                {fileName}
              </span>
            </div>
            <button type="button" className={PRIMARY} onClick={download} disabled={!data.ops.length} data-testid="wt-download">
              <Download size={15} /> Download the workbook
            </button>
          </div>
          {message && (
            <p className={`text-xs ${message.tone === 'error' ? 'text-rose-700' : 'text-emerald-700'}`} data-testid="wt-export-message">
              {message.text}
            </p>
          )}
          {data.problems.length > 0 && (
            <div className="flex flex-col gap-0.5" data-testid="wt-export-problems">
              <span className="text-xs font-semibold text-amber-700">Worth a look before sending:</span>
              <ul className="ml-4 list-disc text-xs text-amber-800">
                {data.problems.slice(0, 10).map((p) => (
                  <li key={p}>{p}</li>
                ))}
                {data.problems.length > 10 && <li>and {data.problems.length - 10} more</li>}
              </ul>
            </div>
          )}
          <ul className="ml-4 list-disc text-xs text-slate-600" data-testid="wt-export-rules">
            <li>
              Right is the silver lane, Left the gold lane; a tier asks for the DR in all to its end. A milestone with no tier is {UNUSED.req} and {UNUSED.res}.
            </li>
            <li>
              Each tier&apos;s prize starts with its own trigger - {triggerOf('easy', 0)}, {triggerOf('hard', 0)}, ..., {FINAL_TRIGGER} for the Final Prize (this app&apos;s names, as you asked). The last
              tier of each lane is in its chest: silver, golden. The end trigger is {END_TRIGGER}; the Final Prize&apos;s filter {FINAL_FILTER}.
            </li>
            <li>
              Config RC OPS: every tier asks for {Math.round((RC_TIER_EFFORT - 1) * 100)}% more, and the Final Prize&apos;s coins are {Math.round((RC_FINAL_COINS - 1) * 100)}% more (your rule for a from-level event).
            </li>
          </ul>
        </div>
      </Card>
      {state.segments.length > 0 && (
        <Card title="What a row holds" subtitle="The segment picked, as Ops gets it. The tiers not in use are left out here; the file has all of them.">
          <div className="flex flex-col gap-3">
            <SegmentChips state={state} index={index} setShown={setShown} />
            {rowIndex < 0 ? (
              <p className="text-sm text-amber-700">This segment is left out of the export until it can be worked out.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm" data-testid="wt-export-preview" data-dense>
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className={TH}>Column</th>
                      <th className={TH}>{SHEET_NAMES.ops}</th>
                      <th className={TH}>{SHEET_NAMES.rc}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownColumns.map(({ h, c }) => (
                      <tr key={h} className="border-b border-slate-100" data-export-column={h}>
                        <td className={`${TD} whitespace-nowrap font-mono text-[11.5px] text-slate-500`}>{h}</td>
                        <td className={`${TD} break-all font-mono text-[12px] text-slate-800`} data-export-ops>
                          {String(data.ops[rowIndex][c])}
                        </td>
                        <td className={`${TD} break-all font-mono text-[12px] text-slate-800`} data-export-rc>
                          {String(data.rc[rowIndex][c])}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      )}
    </>
  )
}
