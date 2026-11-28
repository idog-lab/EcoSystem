import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Download, Map as MapIcon } from 'lucide-react'
import Card from '../../../components/ui/Card'
import SheetGrid from '../../../components/SheetGrid'
import { withRest } from '../../../lib/sheetGrid'
import { useEconomy } from '../../../lib/economy/economyStore'
import { checkReward, parseReward, prizeCount } from '../../../lib/economy/parse'
import { ALLOC_ITEMS, FILLER_ITEMS, SECTIONS, allocate } from '../../../lib/economy/allocate'
import { CHEF_BASKET_TIER, MINI_GAMES, currencyChoices, liveMiniGame, miniGameOf, poolFor, presetValue } from '../../../lib/economy/economyModel'
import { FALLBACK_KINDS, presetsByKind, presetsFromKinds, readPrize, writePrize } from '../../../lib/economy/prizeParts'
import { presetFor } from '../../../lib/economy/syntax'
import { prizeAgainstWorth } from '../../../lib/economy/prizeWorth'
import { setForFeature, useSegmentSets } from '../../../lib/economy/segmentSets'
import { teamData } from '../../../lib/teamData'
import { carryThrough, FEATURE_NAME, FEATURE_RULES_KEY, LANES, MAX_TIERS, STORAGE_KEY, normalizeFeatureRules, normalizeState, placeKey, prizeOf, progressAt, resolveEfforts, stepStatus, withTierCount, workOut } from '../lib/wickedTrails'
import { OPS_HEADERS, SHEET_NAMES, UNUSED, buildExport, exportFileName, exportWorkbook, rowSyntax } from '../lib/wickedTrailsExport'

// WICKED TRAILS (lib/wickedTrails.js): the event built step by step (economist: "the flow of the wicked trails is not
// good. it should be intuitive how i go on with the event build") - the segments, the rules, the tiers, the prizes
// against what each should be worth, a mock to look at, and the export for Ops. Each step says what it is for and
// what it still needs; Next leads on.
const STEP_KEY = 'superplay-wicked-trails-view'
const STEPS = [
  { id: 'feature', label: 'Feature rules', purpose: 'Filled once for the feature, kept for every event: how many items a tier holds, and the chest each gameplay section\'s prizes come in. The economy builder follows them.' },
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
    // A first visit starts at the feature's rules until they were kept once.
    return STEPS.some((s) => s.id === kept) ? kept : load(FEATURE_RULES_KEY, null) ? 'segments' : 'feature'
  })
  const [shown, setShown] = useState(null)
  const economy = useEconomy()
  // The feature's rules: kept for the feature, not with an event (their own key, shared with the team).
  const [featureRules, setFeatureRules] = useState(() => normalizeFeatureRules(load(FEATURE_RULES_KEY, null)))
  const changeRules = (fn) => {
    setFeatureRules((r) => {
      const next = normalizeFeatureRules(fn(r))
      try {
        window.localStorage.setItem(FEATURE_RULES_KEY, JSON.stringify(next))
        teamData.changed(FEATURE_RULES_KEY)
      } catch {
        // Not kept between visits; the page works without it.
      }
      return next
    })
  }
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
  const status = { ...parts, feature: { done: true, missing: [] }, tiers: { done: parts.tiers.done && parts.prizes.done, missing: [...parts.tiers.missing, ...parts.prizes.missing] } }
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
        {/* The step in one line: what it is for in its hover, what it still needs in a few words (the whole list in the hover). */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-testid="wt-step-head" title={current.purpose}>
          <span className="text-xs font-semibold uppercase tracking-wide text-purple-600" data-testid="wt-step-purpose" data-purpose={current.purpose}>
            Step {at + 1} of {STEPS.length} · {current.label}
          </span>
          {missing.length > 0 && (
            <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800" title={missing.join('\n')} data-testid="wt-step-missing" data-missing={missing.join('\n')}>
              Still needed: {missingSummary(missing)}
            </span>
          )}
        </div>

        {needsSegments ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-6 text-center text-sm text-slate-500" data-testid="wt-no-segments">
            No segments yet: take them from a segment set in step 1.
          </p>
        ) : (
          <>
            {step === 'feature' && <FeatureRulesStep rules={featureRules} changeRules={changeRules} economy={economy} />}
            {step === 'segments' && <SegmentsStep state={state} change={change} />}
            {step === 'rules' && <RulesStep state={state} change={change} economy={economy} />}
            {step === 'tiers' && <TiersStep state={state} change={change} index={index} setShown={setShown} economy={economy} featureRules={featureRules} />}
            {step === 'mock' && <MockStep state={state} index={index} setShown={setShown} />}
            {step === 'export' && <ExportStep state={state} index={index} setShown={setShown} />}
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

// What a step still needs, in a few words: the prizes not typed counted, the first other thing named.
function missingSummary(missing) {
  const prizes = missing.filter((m) => /no prize yet/.test(m)).length
  const rest = missing.filter((m) => !/no prize yet/.test(m))
  const parts = [...(rest.length ? [rest[0]] : []), ...(prizes ? [`${prizes} prize${prizes === 1 ? '' : 's'} to type`] : [])]
  const more = rest.length - 1
  return `${parts.join(' · ')}${more > 0 ? ` · and ${more} more` : ''}`
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

  return (
    <Card title="The segments">
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

// ---------------------------------------------------------------- 0. The feature's rules (lib normalizeFeatureRules)
const prizeLimits = (fr) => ({ tier: fr.items.tier.max, final: fr.items.final.max })
const CHEST_SECTIONS = [
  { id: 'easy', label: 'Easy' },
  { id: 'mid', label: 'Mid' },
  { id: 'hard', label: 'Hard', sub: 'the Final Prize' },
]
function FeatureRulesStep({ rules, changeRules, economy }) {
  const chestKeys = (economy?.keys?.chests ?? []).map((k) => k.key).filter(Boolean)
  const whole = (_, v) => (v == null || (Number.isInteger(v) && v >= 1) ? null : 'A whole number, 1 or more')
  const itemRows = [
    { id: 'tier', what: 'A tier', ...rules.items.tier },
    { id: 'final', what: 'The Final Prize', ...rules.items.final },
  ]
  const itemColumns = [
    { key: 'what', label: 'Items in', width: 130, type: 'text', sticky: true, value: (r) => r.what },
    { key: 'min', label: 'Min', width: 70, type: 'number', align: 'right', editable: true, value: (r) => r.min, check: whole, title: () => 'The builder gives at least this many items' },
    { key: 'max', label: 'Max', width: 70, type: 'number', align: 'right', editable: true, value: (r) => r.max, check: whole, title: () => 'The builder gives at most this many; a prize with more is flagged' },
  ]
  const commitItems = (changes) =>
    changeRules((r) => {
      const items = { tier: { ...r.items.tier }, final: { ...r.items.final } }
      for (const { row, key, value } of changes) if (value != null) items[row.id][key] = value
      // Min above max: the other end follows.
      for (const k of ['tier', 'final']) {
        const changed = changes.filter((c) => c.row.id === k).map((c) => c.key)
        if (items[k].min > items[k].max) {
          if (changed.includes('max')) items[k].min = items[k].max
          else items[k].max = items[k].min
        }
      }
      return { ...r, items }
    })
  const chestRows = CHEST_SECTIONS.map((s) => ({ ...s, chest: rules.chests[s.id] ?? '' }))
  const chestColumns = [
    { key: 'what', label: 'Gameplay', width: 150, type: 'text', sticky: true, value: (r) => r.label, display: (r) => (r.sub ? `${r.label} - ${r.sub}` : r.label) },
    { key: 'chest', label: 'Chest', width: 140, type: 'select', editable: true, clearTo: '', value: (r) => r.chest, options: () => [{ value: '', label: 'No chest' }, ...chestKeys.map((k) => ({ value: k, label: k }))], display: (r) => r.chest || <span className="text-slate-400">No chest</span> },
  ]
  const commitChests = (changes) => changeRules((r) => ({ ...r, chests: changes.reduce((acc, { row, value }) => ({ ...acc, [row.id]: value || '' }), r.chests) }))
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
      <Card title="Items in a tier">
        <div title="How many items the builder puts in a prize. A prize with more than the max is flagged in the sheet." data-testid="wt-feature-items">
          <SheetGrid testid="wt-feature-items-sheet" columns={itemColumns} rows={itemRows} onCommit={commitItems} />
        </div>
      </Card>
      <Card title="Chests">
        <div title="The chest the builder wraps a tier's prize in, by its gameplay section. A lane's last tier is always in its silver or golden chest." data-testid="wt-feature-chests">
          <SheetGrid testid="wt-feature-chests-sheet" columns={chestColumns} rows={chestRows} onCommit={commitChests} />
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- 2. Rules
// The mini game the feature uses: the calendar's on its first day, else the one picked here.
const miniGameUsed = (state, economy) => liveMiniGame(economy, state.startDate) ?? (state.miniGame || null)

function RulesStep({ state, change, economy }) {
  const fromCalendar = liveMiniGame(economy, state.startDate)
  const used = miniGameUsed(state, economy)
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
      <Card title="When">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3" data-testid="wt-when">
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500" title="The DR values (puzzle, pet, the mini game) are read from the calendar on the feature's days; a value that changes over them is averaged">
            First day
            <input type="date" value={state.startDate ?? ''} onChange={(e) => change((s) => ({ ...s, startDate: e.target.value }))} className={INPUT} data-testid="wt-start-date" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Days
            <Num value={state.days} onCommit={(v) => v != null && v >= 1 && change((s) => ({ ...s, days: Math.round(v) }))} className="w-16" data-testid="wt-days" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500" title={fromCalendar ? 'Live on these days by the calendar (Economy page)' : 'The calendar (Economy page) does not say which is live on these days: pick it'}>
            Mini game
            {fromCalendar ? (
              <span className="flex h-[34px] items-center gap-1.5 text-sm font-semibold normal-case tracking-normal text-slate-800" data-testid="wt-mini-game" data-mini-game={fromCalendar}>
                {miniGameOf(fromCalendar)?.label} <span className="text-[11px] font-normal text-slate-400">calendar</span>
              </span>
            ) : (
              <select value={state.miniGame} onChange={(e) => change((s) => ({ ...s, miniGame: e.target.value }))} className={INPUT} data-testid="wt-mini-game" data-mini-game={used ?? ''}>
                <option value="">Pick one</option>
                {MINI_GAMES.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            )}
          </label>
        </div>
      </Card>
      <Card title="The ROE">
        <div data-testid="wt-rules-roe">{field('roe', 'ROE', 'Rate of economy: the allowance worth of prizes a player gets from one Brut Win', 'allowance a Brut Win')}</div>
      </Card>
      <Card title="How it is shared">
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
// Off by, the lane so far: the prize's worth against its target plus the carry from the tiers before (lib carryThrough).
function OffBy({ check, carried, empty }) {
  if (empty) return <span className="text-slate-300">no prize</span>
  if (check && !check.ok) return <span className="text-rose-700">{check.issues.find((x) => x.level === 'error')?.message ?? 'Cannot be read'}</span>
  if (check && check.worth == null) return <span className="text-amber-700">no worth yet{check.unknown.length ? `: ${check.unknown.join(', ')}` : ''}</span>
  if (!carried || carried.aim == null) return <span className="text-slate-400">{carried?.carry == null ? 'carry not known' : 'no target'}</span>
  const off = carried.off
  const pct = carried.aim > 0 ? Math.round((off / carried.aim) * 1000) / 10 : 0
  const tone = Math.abs(pct) <= 5 ? 'text-emerald-700' : Math.abs(pct) <= 15 ? 'text-amber-700' : 'text-rose-700'
  return <span className={`font-semibold ${tone}`} data-gap-pct={pct}>{`${off > 0 ? '+' : ''}${fmt(off)} (${pct > 0 ? '+' : ''}${pct}%)`}</span>
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

// THE ECONOMY BUILDER (lib/economy/allocate.js): its rules - hard totals by gameplay section, fillers in order with a
// max a tier, balance every Nth tier - in two small sheets (a new row is typed in the empty last one; Delete on its item
// takes it out), and Build: the ticked tiers of the base segment are filled; Undo puts their prizes back.
const PCT = ['easy', 'mid', 'hard']
function Builder({ state, change, economy, rows, index, miniGame, featureRules }) {
  const items = featureRules.items
  const b = state.builder
  const [result, setResult] = useState(null)
  const setB = (patch) => change((s) => ({ ...s, builder: { ...s.builder, ...patch } }))
  const itemOptions = (list) => [{ value: '', label: '-' }, ...list.map((i) => ({ value: i.id, label: i.label }))]

  const hardRows = [...b.hard.map((h, i) => ({ id: `h${i}`, i, ...h })), { id: 'h-new', i: b.hard.length, item: '', total: null, pct: null }]
  const hardColumns = [
    { key: 'item', label: 'Hard total', sub: 'a resource', width: 120, type: 'select', editable: true, clearTo: '', value: (r) => r.item, options: () => itemOptions(ALLOC_ITEMS) },
    { key: 'total', label: 'Total', sub: 'over the event', width: 84, type: 'number', align: 'right', editable: (r) => !!r.item, value: (r) => r.total },
    ...PCT.map((p, k) => ({ key: p, label: SECTIONS[k].label, sub: k === 2 ? '% - the Final Prize' : '%', width: 74, type: 'number', align: 'right', editable: (r) => !!r.item && k < 2, value: (r) => r.pct?.[p] ?? null, display: (r) => (r.pct ? (k === 2 ? `${fmt(r.pct.hard)} rest` : fmt(r.pct[p])) : '') })),
  ]
  const commitHard = (changes) =>
    change((s) => {
      let hard = [...s.builder.hard]
      for (const { row, key, value } of changes) {
        if (key === 'item') {
          if (!value) {
            if (row.i < hard.length) hard[row.i] = null
          } else if (row.i >= hard.length) hard.push({ item: value, total: null, pct: { easy: 33.33, mid: 33.33, hard: 33.34 } })
          else hard[row.i] = { ...hard[row.i], item: value }
        } else if (row.i < hard.length && hard[row.i]) {
          if (key === 'total') hard[row.i] = { ...hard[row.i], total: value }
          else {
            const [easy, mid, hrd] = withRest(PCT.map((p) => hard[row.i].pct?.[p] ?? 0), PCT.indexOf(key), value ?? 0)
            hard[row.i] = { ...hard[row.i], pct: { easy, mid, hard: hrd } }
          }
        }
      }
      return { ...s, builder: { ...s.builder, hard: hard.filter(Boolean) } }
    })

  const fillerRows = [...b.fillers.map((x, i) => ({ id: `f${i}`, i, ...x })), { id: 'f-new', i: b.fillers.length, item: '', max: null }]
  const fillerColumns = [
    { key: 'item', label: 'Filler', sub: 'in this order', width: 120, type: 'select', editable: true, clearTo: '', value: (r) => r.item, options: () => itemOptions(FILLER_ITEMS) },
    { key: 'max', label: 'Max', sub: 'a tier', width: 74, type: 'number', align: 'right', editable: (r) => !!r.item, value: (r) => r.max },
  ]
  const commitFillers = (changes) =>
    change((s) => {
      let fillers = [...s.builder.fillers]
      for (const { row, key, value } of changes) {
        if (key === 'item') {
          if (!value) {
            if (row.i < fillers.length) fillers[row.i] = null
          } else if (row.i >= fillers.length) fillers.push({ item: value, max: null })
          else fillers[row.i] = { ...fillers[row.i], item: value }
        } else if (row.i < fillers.length && fillers[row.i]) fillers[row.i] = { ...fillers[row.i], max: value }
      }
      return { ...s, builder: { ...s.builder, fillers: fillers.filter(Boolean) } }
    })

  // How the builder reads and changes a prize here: the parts of the prize sheet, worth by the economy on the feature's
  // days, puzzle and mini game as the presets that exist.
  const ctx = { date: state.startDate || null, days: state.days, miniGame }
  const io = {
    worthOf: (parts) => {
      const text = writePrize(parts)
      if (!text) return 0
      const r = prizeAgainstWorth(text, null, economy, ctx)
      return r?.ok ? r.worth : null
    },
    unitWorth: (item) => {
      const v = Number(economy?.resources?.[item])
      return Number.isFinite(v) && v > 0 ? v : null
    },
    get: (parts, item) =>
      item === 'puzzle'
        ? (presetsByKind(parts.presets).puzzle?.amount ?? 0)
        : item === 'mini'
          ? (presetsByKind(parts.presets).mini?.amount ?? 0)
          : item === 'pack'
            ? (parts.pack ? 1 : 0)
            : item === 'basket'
              ? parts.presets.filter((k) => CHEF_BASKET_TIER.test(k)).length
              : (parts[item] ?? 0),
    set: (parts, item, amount) => {
      const p = { ...parts, presets: [...parts.presets] }
      const kinds = presetsByKind(p.presets)
      // A pool item is only taken out here (a built tier starts without one); it is put in by add.
      if (item === 'pack') return amount ? p : { ...p, pack: '', packAlt: null, packCoins: null }
      if (item === 'basket') return amount ? p : { ...p, presets: p.presets.filter((k) => !CHEF_BASKET_TIER.test(k)) }
      if (item === 'puzzle') p.presets = presetsFromKinds({ ...kinds, puzzle: amount > 0 ? (presetFor('puzzle', amount, kinds.puzzle?.fallback ?? '', economy) ?? null) : null })
      else if (item === 'mini') p.presets = presetsFromKinds({ ...kinds, mini: amount > 0 ? (presetFor('mini_game', amount, kinds.mini?.kind ?? 'allowance', economy) ?? null) : null })
      else p[item] = amount > 0 ? amount : null
      return p
    },
    count: (parts) => {
      const text = writePrize(parts)
      return text ? prizeCount(parseReward(text).node) : 0
    },
    // The feature's rules: the least and most items a tier (and the Final Prize) holds.
    limit: (t) => (t.group === 'final' ? items.final.max : items.tier.max),
    minItems: (t) => (t.group === 'final' ? items.final.min : items.tier.min),
    // The pools (the Economy page's Pools tab), by the tier's gameplay section: the next pack of the album in turn; the
    // biggest basket whose worth still fits.
    pick: (item, tier, need) => {
      if (item === 'pack') {
        const keys = poolFor(economy, 'album', tier.section)
        if (!keys.length) return null
        const turn = turns[tier.section] ?? 0
        turns[tier.section] = turn + 1
        return keys[turn % keys.length]
      }
      const fits = poolFor(economy, 'baskets', tier.section)
        .map((key) => ({ key, worth: presetValue(economy, key, ctx)?.value }))
        .filter((b) => b.worth != null && b.worth <= need + 1e-9)
        .sort((a, b) => b.worth - a.worth)
      return fits[0]?.key ?? null
    },
    add: (parts, item, key) => (item === 'pack' ? { ...parts, pack: key, packCounter: true, packAlt: { kind: 'coins', amount: PACK_FALLBACK_COINS }, packCoins: null } : { ...parts, presets: [...parts.presets, key] }),
    keyWorth: (item, key) => (item === 'basket' ? (presetValue(economy, key, ctx)?.value ?? 0) : 0),
  }
  // The pack each section is at, for this build.
  const turns = {}

  function build() {
    for (const k of Object.keys(turns)) delete turns[k]
    const tiers = rows.map((r) => ({ id: r.place, group: r.laneId ?? 'final', section: r.section, target: r.target, auto: r.auto, parts: r.parts }))
    const out = allocate({ tiers, hard: b.hard.filter((h) => h.total > 0), fillers: b.fillers, balanceEvery: b.balanceEvery, io })
    const built = tiers.filter((t) => t.auto)
    const before = Object.fromEntries(built.map((t) => [t.id, rows.find((r) => r.place === t.id).prize.text]))
    // The feature's chest for the tier's gameplay section ('' none); a lane's last tier keeps the export's silver /
    // golden chest, so the rule does not touch it.
    const chestOf = (t) => (rows.find((r) => r.place === t.id)?.last ? out.parts[t.id].chest : (featureRules.chests[t.section] ?? ''))
    change((s) => built.reduce((acc, t) => prizeChange(acc, index, t.id, writePrize({ ...out.parts[t.id], chest: chestOf(t) })), s))
    setResult({ report: out.report, before, count: built.length })
  }
  function undo() {
    if (!result?.before) return
    change((s) => Object.entries(result.before).reduce((acc, [place, text]) => prizeChange(acc, index, place, text), s))
    setResult(null)
  }
  const ticked = rows.filter((r) => r.auto).length
  const lane = (g) => (g === 'final' ? 'Final Prize' : LANES.find((l) => l.id === g)?.label ?? g)

  return (
    <Card title="Economy builder">
      <div className="flex flex-col gap-3" data-testid="wt-builder">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start">
          <SheetGrid testid="wt-hard" columns={hardColumns} rows={hardRows} onCommit={commitHard} />
          <SheetGrid testid="wt-fillers" columns={fillerColumns} rows={fillerRows} onCommit={commitFillers} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700" title="The fillers bring the lane back close to balance at every Nth built tier (and at its last)">
            Balance every
            <Num value={b.balanceEvery} onCommit={(v) => v != null && v >= 1 && setB({ balanceEvery: Math.round(v) })} className="w-14" data-testid="wt-balance-every" />
            tiers
          </label>
          <button type="button" className={PRIMARY} onClick={build} disabled={!ticked} title={ticked ? `Builds the ${ticked} ticked tier${ticked === 1 ? '' : 's'}` : 'Tick Auto on the tiers to build'} data-testid="wt-build">
            Build {ticked ? `${ticked} tier${ticked === 1 ? '' : 's'}` : ''}
          </button>
          {result && (
            <button type="button" className={BUTTON} onClick={undo} data-testid="wt-build-undo">
              Undo the build
            </button>
          )}
        </div>
        {result && (
          <div className="flex flex-col gap-0.5 text-sm" data-testid="wt-build-report">
            <span className="text-slate-700">
              {result.report.hard.map((h) => `${ALLOC_ITEMS.find((i) => i.id === h.item)?.label} ${fmt(h.placed)} of ${fmt(h.total)}`).concat(result.report.groups.map((g) => `${lane(g.group)} ${g.off == null ? '?' : `${g.off > 0 ? '+' : ''}${fmt(g.off)}`}`)).join(' · ')}
            </span>
            {result.report.notes.map((n) => (
              <span key={n} className="text-xs text-amber-700">
                {n}
              </span>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

// THE ROW WE ARE ON, AS OPS GETS IT (economist, 26 Nov 2026: "we will see under the events table a live syntax of the
// row we are on"): its Req and Res in Config OPS and Config RC OPS, written by the export's own builders - the tier's
// trigger and, on a lane's last tier, its chest - with what the checker finds, and a copy button.
function RowSyntax({ state, index, place, economy, tone, limits }) {
  const row = place ? rowSyntax(state, index, place) : null
  const [copied, setCopied] = useState(null)
  if (!row) return null
  const copy = (text, what) => {
    const done = () => setCopied(what)
    try {
      navigator.clipboard.writeText(String(text)).then(done, done)
    } catch {
      done()
    }
  }
  const res = row.cells.find((c) => c.column.endsWith('_Res'))
  const findings = res?.ops ? checkReward(String(res.ops), { economy, prizeMode: 'custom', prizeLimit: place === 'final' ? limits.final + 1 : limits.tier + 1 }).issues : []
  return (
    <div className={`rounded-xl border border-slate-200 border-l-4 ${tone?.edge ?? ''} bg-white px-3 py-2`} data-testid="wt-row-syntax" data-row-place={place}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wide text-purple-700">As Ops gets it</span>
        <span className="font-semibold text-slate-700" data-testid="wt-row-syntax-title">
          {row.title}
        </span>
      </div>
      <table className="mt-1 w-full border-collapse text-sm" data-dense>
        <thead>
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            <th className="w-64 py-1 pr-3">Column</th>
            <th className="py-1 pr-3">Config OPS</th>
          </tr>
        </thead>
        <tbody>
          {row.cells.map((c) => (
            <tr key={c.column} className="border-t border-slate-100 align-top" data-syntax-column={c.column}>
              <td className="py-1 pr-3 font-mono text-[11.5px] text-slate-500">{c.column}</td>
              {/* Config OPS only (economist: RC taken out of this panel; it stays in the export). */}
              {['ops'].map((which) => (
                <td key={which} className="py-1 pr-3">
                  <div className="flex items-start gap-1.5">
                    <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-slate-800" data-syntax={which}>
                      {c[which] == null || c[which] === '' ? <span className="text-slate-400">-</span> : String(c[which])}
                    </code>
                    {c[which] != null && c[which] !== '' && (
                      <button type="button" onClick={() => copy(c[which], `${c.column}-${which}`)} className="shrink-0 rounded-md px-1.5 text-[11px] font-semibold text-purple-700 ring-1 ring-purple-200 hover:bg-purple-50" data-syntax-copy={which}>
                        {copied === `${c.column}-${which}` ? 'Copied' : 'Copy'}
                      </button>
                    )}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {findings.length > 0 && (
        <ul className="mt-1 text-[11.5px]" data-testid="wt-row-syntax-findings">
          {findings.map((x) => (
            <li key={x.message} className={x.level === 'error' ? 'text-rose-700' : 'text-amber-700'}>
              {x.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
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
const FALLBACK_OPTIONS = [{ value: '', label: '-' }, ...FALLBACK_KINDS]
// A puzzle's fallback is the ending of its preset's name (economist: "the puzzle and mini game has the fallback logic in
// the text of the preset"): none, or puzzle_gameplay_<n>_undo / _entry / _stock / _wild.
// The plain preset (no ending) is the coins one: the default (economist: "make the default value of fallbacks to be
// coins"), as a mini game's starts on _allowance.
const PACK_FALLBACK_COINS = 0.25
const PUZZLE_FALLBACKS = [
  { value: '', label: 'Coins' },
  { value: 'undo', label: 'Undo' },
  { value: 'entry', label: 'Free round' },
  { value: 'stock', label: 'Extra stock' },
  { value: 'wild', label: 'Wild' },
]
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
function TiersStep({ state, change, index, setShown, economy, featureRules }) {
  const limits = prizeLimits(featureRules)
  const seg = state.segments[index]
  const w = workOut(state, seg)
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
        const L = state.lanes[lane.id]
        return { id: place, place, laneId: lane.id, lane: lane.label, tier: i + 1, last: i === L.shares.length - 1, share, t, target: t?.target ?? null, prize, parts, kinds: presetsByKind(parts.presets), section: L.sections?.[i] ?? 'easy', auto: !!L.auto?.[i] }
      }),
    ),
    (() => {
      const prize = prizeOf(state, index, 'final')
      const parts = readPrize(prize.text).parts
      return { id: 'final', place: 'final', laneId: null, lane: 'Final Prize', tier: '', last: false, share: null, t: null, target: w.finalTarget, prize, parts, kinds: presetsByKind(parts.presets), section: 'hard', auto: !!state.finalAuto }
    })(),
  ]
  const miniGame = miniGameUsed(state, economy)
  const checkOf = (row) => (row.prize.text ? prizeAgainstWorth(row.prize.text, row.target, economy, { date: state.startDate || null, days: state.days, miniGame, prizeMode: 'custom', prizeLimit: row.place === 'final' ? limits.final : limits.tier }) : null)
  // The carry along each lane: what a tier leaves (over or under its aim) moves to the next one; the Final Prize has
  // its own pool and carries nothing. A tier with no prize gives 0; a worth not known stops the carry.
  const carried = new Map()
  for (const laneId of [...LANES.map((l) => l.id), null]) {
    const lane = rows.filter((r) => r.laneId === laneId)
    const items = lane.map((r) => {
      const c = checkOf(r)
      return { target: r.target, worth: !r.prize.text ? 0 : c?.ok ? c.worth : null }
    })
    carryThrough(items).forEach((x, k) => carried.set(lane[k].place, x))
  }
  const anyMore = rows.some((r) => r.parts.currencies.length || r.parts.triggers.length || r.parts.extra.length || r.parts.packCoins != null)
  const [showLane, setShowLane] = useState(false)
  const [showMore, setShowMore] = useState(anyMore)
  // The row the active cell is on: its syntax is shown under the sheet, live.
  const [activePlace, setActivePlace] = useState('easy-0')
  const more = showMore || anyMore
  const own = (r) => (r.prize.own ? '' : 'italic !text-slate-400')
  const whole = (_, v) => (v != null && !Number.isInteger(v) ? 'a whole number' : null)

  const columns = [
    { key: 'lane', group: 'The tier', label: 'Lane', width: 96, sticky: true, display: (r) => <span className={r.place === 'final' ? 'font-semibold text-purple-700' : 'font-semibold text-slate-700'}>{r.lane}</span> },
    { key: 'tier', group: 'The tier', label: 'Tier', width: 44, sticky: true },
    // Which tiers the economy builder fills (economist: "i dont understand the auto column" - so it is named for what it
    // does): ticked, Build (under the sheet) fills its prize from the rules; not ticked, the prize typed is left alone.
    { key: 'auto', group: 'The tier', label: 'Build', sub: 'by rules', width: 56, type: 'toggle', align: 'right', editable: () => index === state.baseIndex, value: (r) => r.auto, title: (r) => (r.auto ? 'Ticked: Build (the economy builder, under the sheet) fills this prize from its rules. Space to untick' : 'Not ticked: the prize you type is left alone. Space to tick, and Build fills it from the rules') },
    {
      key: 'section',
      group: 'The tier',
      label: 'Section',
      width: 66,
      type: 'select',
      editable: (r) => r.place !== 'final' && index === state.baseIndex,
      value: (r) => r.section,
      options: () => SECTIONS.filter((x) => x.id !== 'hard').map((x) => ({ value: x.id, label: x.label })),
      display: (r) => SECTIONS.find((x) => x.id === r.section)?.label ?? '',
      title: (r) => (r.place === 'final' ? 'The Final Prize is the hard section' : 'Its gameplay section, for the builder\'s hard totals'),
    },
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
    {
      key: 'carry',
      group: 'Against the target',
      label: 'Carry',
      sub: 'from the tiers before',
      width: 84,
      type: 'number',
      align: 'right',
      value: (r) => carried.get(r.place)?.carry ?? null,
      display: (r) => {
        const c = carried.get(r.place)?.carry
        if (r.place === 'final') return <span className="text-slate-300">-</span>
        if (c == null) return <span className="text-amber-700" title="A tier before has a part with no worth yet: what it leaves is not known">?</span>
        return <span className={c > 0 ? 'text-emerald-700' : c < 0 ? 'text-rose-700' : 'text-slate-400'}>{`${c > 0 ? '+' : ''}${fmt(c)}`}</span>
      },
      title: () => 'What the tiers before it in the lane left: + more to give here, - less',
    },
    { key: 'worth', group: 'Against the target', label: 'Worth', sub: 'of the prize', width: 70, type: 'number', align: 'right', value: (r) => checkOf(r)?.worth ?? null },
    {
      key: 'off',
      group: 'Against the target',
      label: 'Off by',
      sub: 'the lane so far',
      width: 130,
      value: (r) => carried.get(r.place)?.off ?? null,
      title: (r) => (checkOf(r)?.unknown?.length ? 'No worth yet on the Economy page: ' + checkOf(r).unknown.join(', ') : 'Its worth against its target plus the carry: the lane so far'),
      display: (r) => <OffBy check={checkOf(r)} carried={carried.get(r.place)} empty={!r.prize.text} />,
    },
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
      check: (r, v) => (v != null && !presetFor('puzzle', v, r.kinds.puzzle?.fallback ?? '', economy) ? 'no puzzle preset of that kind on the Economy page' : null),
      title: (r) => r.kinds.puzzle?.key ?? 'A puzzle preset: the nearest amount on the Economy page is taken',
      tone: own,
    },
    {
      key: 'puzzleFallback',
      // Delete brings a fallback back to coins (economist: "the fallbacks should support using delete on them that will take it back to coins").
      clearTo: '',
      group: 'The prize',
      label: 'Fallback',
      sub: 'puzzle',
      width: 92,
      type: 'select',
      editable: (r) => !!r.kinds.puzzle,
      value: (r) => r.kinds.puzzle?.fallback ?? '',
      options: () => PUZZLE_FALLBACKS,
      // A row with no puzzle has no fallback to show.
      display: (r) => (r.kinds.puzzle ? PUZZLE_FALLBACKS.find((o) => o.value === (r.kinds.puzzle.fallback ?? ''))?.label : ''),
      check: (r, v) => (r.kinds.puzzle && !presetFor('puzzle', r.kinds.puzzle.amount, v, economy) ? 'no puzzle preset with that fallback on the Economy page' : null),
      title: (r) => (r.kinds.puzzle ? `${r.kinds.puzzle.key} - the fallback is in the preset's name. Ctrl+Down / Ctrl+Up go through the choices` : undefined),
      tone: own,
    },
    {
      key: 'mini',
      group: 'The prize',
      label: miniGameOf(miniGame)?.label ?? 'Mini game',
      sub: miniGame ? 'mini game' : 'pick it in Rules',
      width: 70,
      type: 'number',
      align: 'right',
      editable: true,
      value: (r) => r.kinds.mini?.amount ?? null,
      check: (r, v) => (v != null && !presetFor('mini_game', v, r.kinds.mini?.kind ?? 'allowance', economy) ? 'no mini game preset on the Economy page' : null),
      title: (r) => r.kinds.mini?.key ?? 'A mini game preset: the nearest amount on the Economy page is taken',
      tone: own,
    },
    {
      key: 'miniKind',
      clearTo: 'allowance',
      group: 'The prize',
      label: 'Fallback',
      sub: 'mini game',
      width: 92,
      type: 'select',
      editable: (r) => !!r.kinds.mini,
      value: (r) => r.kinds.mini?.kind ?? '',
      options: () => MINI_KINDS,
      title: (r) => (r.kinds.mini ? `${r.kinds.mini.key} - the fallback is in the preset's name. Ctrl+Down / Ctrl+Up go through the choices` : undefined),
      tone: own,
    },
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
      key: 'packAlt',
      clearTo: 'coins',
      display: (r) => (r.parts.pack ? (FALLBACK_OPTIONS.find((o) => o.value === (r.parts.packAlt?.kind ?? ''))?.label ?? '') : ''),
      group: 'The prize',
      label: 'Fallback',
      sub: 'pack',
      width: 86,
      type: 'select',
      editable: (r) => !!(r.parts.pack),
      value: (r) => (r.parts.packAlt)?.kind ?? '',
      options: () => FALLBACK_OPTIONS,
      title: () => 'What the player gets when the pack cannot be had. Ctrl+Down / Ctrl+Up go through the choices',
      tone: own,
    },
    { key: 'packAltN', group: 'The prize', label: 'Amount', sub: 'pack fallback', width: 60, type: 'number', align: 'right', editable: (r) => !!(r.parts.packAlt)?.kind && (r.parts.packAlt).kind !== 'hidden', value: (r) => (r.parts.packAlt)?.amount ?? null, check: (r, v) => (v != null && (r.parts.packAlt)?.kind !== 'coins' && !Number.isInteger(v) ? 'a whole number' : null), tone: own },
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
          { key: 'text', group: 'More', label: 'The text', sub: 'as Ops gets it; can be pasted whole', width: 380, type: 'text', editable: true, value: (r) => r.prize.text, title: (r) => r.prize.text || undefined, tone: (r) => `font-mono text-[11.5px] ${own(r)}` },
        ]
      : []),
  ]

  // A cell of the prize changed: the text is written again from its parts.
  function withPart(parts, key, value) {
    const p = { ...parts, presets: [...parts.presets] }
    const kinds = presetsByKind(p.presets)
    // A fallback changed to another kind starts at its default amount: coins 0.25, a resource 1; Delete on its amount
    // brings it back to coins 0.25.
    const setAlt = (cur, kind) => (kind ? { kind, amount: kind === 'hidden' ? null : cur?.kind === kind ? cur.amount : kind === 'coins' ? PACK_FALLBACK_COINS : 1 } : null)
    const setAltN = (cur, n) => (n == null ? { kind: 'coins', amount: PACK_FALLBACK_COINS } : { kind: cur?.kind ?? 'coins', amount: n })
    if (key === 'packAlt') {
      p.packAlt = setAlt(parts.packAlt, value)
      p.packCoins = null
    } else if (key === 'packAltN') {
      p.packAlt = setAltN(parts.packAlt, value)
      p.packCoins = null
    } else if (key === 'coins') p.coins = value == null ? null : Math.round(value * 100) / 100
    else if (['wild', 'stock', 'undo', 'entry'].includes(key)) p[key] = value
    else if (key === 'puzzle' || (key === 'puzzleFallback' && kinds.puzzle)) {
      // A puzzle preset of that amount with that fallback (the nearest amount that has one).
      const next = key === 'puzzle' ? (value == null ? null : (presetFor('puzzle', value, kinds.puzzle?.fallback ?? '', economy) ?? kinds.puzzle)) : (presetFor('puzzle', kinds.puzzle.amount, value, economy) ?? kinds.puzzle)
      p.presets = presetsFromKinds({ ...kinds, puzzle: next })
    } else if (key === 'mini' || (key === 'miniKind' && kinds.mini)) {
      const next = key === 'mini' ? (value == null ? null : (presetFor('mini_game', value, kinds.mini?.kind ?? 'allowance', economy) ?? kinds.mini)) : (presetFor('mini_game', kinds.mini.amount, value, economy) ?? kinds.mini)
      p.presets = presetsFromKinds({ ...kinds, mini: next })
    }
    else if (key === 'presets') p.presets = presetsFromKinds({ ...kinds, others: listOf(value) })
    else if (key === 'pack') {
      p.pack = value || ''
      if (!value) {
        p.packCoins = null
        p.packAlt = null
      } else if (!parts.pack) {
        // A new pack: its counter, and a fallback of coins to start (economist: "make the default value of fallbacks to
        // be coins" - 0.25 allowance, their number).
        p.packCounter = true
        if (!parts.packAlt) p.packAlt = { kind: 'coins', amount: PACK_FALLBACK_COINS }
      }
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
        if (key === 'auto') {
          out = row.laneId ? { ...out, lanes: { ...out.lanes, [row.laneId]: { ...out.lanes[row.laneId], auto: out.lanes[row.laneId].shares.map((_, j) => (j === row.tier - 1 ? !!value : !!out.lanes[row.laneId].auto?.[j])) } } } : { ...out, finalAuto: !!value }
          continue
        }
        if (key === 'section' && row.laneId) {
          out = { ...out, lanes: { ...out.lanes, [row.laneId]: { ...out.lanes[row.laneId], sections: out.lanes[row.laneId].shares.map((_, j) => (j === row.tier - 1 ? value : (out.lanes[row.laneId].sections?.[j] ?? 'easy'))) } } }
          continue
        }
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
      <SegmentChips state={state} index={index} setShown={setShown} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2" data-testid="wt-tier-counts">
        {LANES.map((lane) => (
          <label key={lane.id} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            {lane.label} ({lane.dr}): tiers
            <Num value={state.lanes[lane.id].shares.length} onCommit={(v) => v != null && setLane(lane.id, withTierCount(state.lanes[lane.id], v))} className="w-14" aria-label={`${lane.label}: how many tiers`} title={`1 to ${MAX_TIERS}, split evenly`} data-tier-count={lane.id} />
          </label>
        ))}
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={showLane} onChange={(e) => setShowLane(e.target.checked)} className="accent-purple-600" data-testid="wt-show-lane" />
          Lane numbers
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600" title={anyMore ? 'Shown: a prize here has DRs, triggers or a part with no column' : undefined}>
          <input type="checkbox" checked={more} disabled={anyMore} onChange={(e) => setShowMore(e.target.checked)} className="accent-purple-600" data-testid="wt-show-more" />
          DRs, triggers, text
        </label>
      </div>
      {w.lanes ? (
        <p className="text-sm text-slate-600" data-testid="wt-totals">
          {fmt(w.E)} BW x {fmt(state.rules.roe, 4)} = <span className="font-semibold text-slate-800">{fmt(w.total)}</span> · easy {fmt(w.lanes.easy.totalDR, 0)} silver · hard {fmt(w.lanes.hard.totalDR, 0)} gold · Final Prize pool{' '}
          <span data-field="pool">{fmt(w.pool)}</span> → <span data-field="final-target">{fmt(w.finalTarget)}</span>
        </p>
      ) : (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1 text-sm text-amber-800" data-testid="wt-prizes-blocked">
          {seg.name} cannot be worked out yet: {w.problems.join(' ')}
        </p>
      )}
      <SheetGrid testid="wt-tiers" columns={columns} rows={rows} onCommit={commit} rowTone={(r) => LANE_TONE[r.laneId ?? 'final']} onActive={(row) => row && setActivePlace(row.place)} />
      {index === state.baseIndex && <Builder state={state} change={change} economy={economy} rows={rows} index={index} miniGame={miniGame} featureRules={featureRules} />}
      <RowSyntax limits={limits} state={state} index={index} place={rows.some((r) => r.place === activePlace) ? activePlace : rows[0]?.place} economy={economy} tone={LANE_TONE[rows.find((r) => r.place === activePlace)?.laneId ?? (activePlace === 'final' ? 'final' : 'easy')]} />
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
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------- 6. Export
function ExportStep({ state, index, setShown }) {
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
      <Card title="The workbook">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
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
        </div>
      </Card>
      {state.segments.length > 0 && (
        <Card title="What a row holds">
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
