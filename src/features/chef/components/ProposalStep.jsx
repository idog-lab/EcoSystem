import { useMemo, useRef, useState } from 'react'
import { Check as CheckIcon, Lock, LockOpen, RotateCcw, Sparkles, Square, Trash2 } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Collapsible from '../../../components/ui/Collapsible'
import { CHEST_LABELS, RARITY, ROUND_LABELS, VARIATIONS, VARIATION_LABELS, isBlocker, recipeBudgetReference, recipeForSegment } from '../lib/chefModel'
import { shareInterval } from '../lib/chefRng'
import { CHANGE_LABELS, STATUS_LABELS, applyProposal, budgetSummary, canApply, cellKey, configurationProblems, describeTargets, existingStepDays, generateProposal, inputProblems, periodNote, planOf, proposalIsInUse, searchWarnings, semiExposure, staleReason, structuralConflicts, undoProposal, weightKey, withoutPresets } from '../lib/chefGenerator'
import { dayLabel, num, pct, shortDay } from '../lib/chefFormat'
import { Check, Num, Pills, Toggle, TD, TH } from './chefUi'
import CatchupPanel from './CatchupPanel'
import EventsPanel from './EventsPanel'

// STEP 4 - A PROPOSAL. The economist says what may change, the tool searches
// for recipes, basket weights and threshold schedules that bring every
// segment closer to the targets, and shows the current event beside the
// proposal. Nothing is changed until "Apply"; one undo brings it back.
// The search and every rule of it are in lib/chefGenerator.js - this file
// only shows them.

const CHANGE_HINTS = {
  recipes: 'How many of each ordinary and semi-blocker ingredient a dish needs, at the base. Which ingredients a dish needs is never changed.',
  weights: 'The gameplay weights of each basket, inside the odds periods that exist. A weight of 0 stays 0 unless you open it (Locks). Pricing odds are not touched.',
  thresholdAmounts: 'The limits of the progression-threshold schedules, and new schedules where Pacing allows them. The blocker stays held back through the FU day.',
  thresholdDays: 'The days on which the steps of a schedule start.',
  blockers: 'A blocker quantity of a segment\'s own, where its players finish too soon. The base quantity is never changed.',
}
const STOP_REASONS = {
  candidates: 'it played every version it was allowed',
  settled: 'every target was met and a dozen more tries improved nothing',
  stalled: 'many tries in a row improved nothing',
  time: 'the time allowed ran out',
  'nothing-to-change': 'nothing is free to change',
  'no-valid-step': 'no further step stayed inside the bounds',
  cancelled: 'it was stopped',
}
const VERDICTS = {
  met: ['Met', 'bg-emerald-100 text-emerald-800', 'Above its target, also at the low end of the range.'],
  'met-unsure': ['Met, close', 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', 'At or above its target on these players, but the range reaches below it: with other players it could miss.'],
  'missed-unsure': ['Missed, close', 'bg-amber-100 text-amber-800', 'Below its target on these players, but the range reaches it: with other players it could meet.'],
  missed: ['Missed', 'bg-rose-100 text-rose-800', 'Below its target, also at the high end of the range.'],
}

const Verdict = ({ verdict }) => {
  const [label, className, title] = VERDICTS[verdict] ?? VERDICTS.missed
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${className}`} title={title} data-verdict={verdict}>
      {label}
    </span>
  )
}

// A share now and with the proposal: "3% -> 88% (84-91)". The range is how well the proposed share is known.
function Shares({ now, next, n, lowerIsBetter = false }) {
  if (next == null) return <span className="text-slate-400">-</span>
  const i = shareInterval(Math.round(next * n), n)
  const diff = now == null ? null : Math.round((next - now) * 100)
  const good = diff == null || diff === 0 ? 'text-slate-400' : diff > 0 !== lowerIsBetter ? 'text-emerald-700' : 'text-rose-700'
  return (
    <span className="whitespace-nowrap tabular-nums" title={`With the proposal between ${pct(i.low, 1)} and ${pct(i.high, 1)} with other players (${n} played).${now == null ? '' : ` Now ${pct(now, 1)}.`}`}>
      {now != null && <span className="text-slate-500">{pct(now)} → </span>}
      <span className="font-semibold text-slate-800">{pct(next)}</span>
      <span className="text-[11px] text-slate-400">
        {' '}
        ({Math.round(i.low * 100)}-{Math.round(i.high * 100)})
      </span>
      {diff != null && diff !== 0 && (
        <span className={`ml-1 text-[11px] font-semibold ${good}`}>
          {diff > 0 ? '+' : ''}
          {diff}
        </span>
      )}
    </span>
  )
}

// Two or three lines over the days of the event, with what the economist marks on it.
function DayChart({ title, series, days, yMax, yFormat, calendar, band, lines = [], dots = [], ticks = [], height = 150, bare = false, ...props }) {
  const W = 560
  const pad = bare ? { l: 6, r: 6, t: 8, b: 6 } : { l: 34, r: 10, t: 10, b: 20 }
  const x = (day) => pad.l + ((day - 1) / Math.max(1, days - 1)) * (W - pad.l - pad.r)
  const y = (v) => pad.t + (1 - Math.min(1, v / yMax)) * (height - pad.t - pad.b)
  const path = (values) => values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <figure className="min-w-0" {...props}>
      {title && <figcaption className="mb-1 text-xs font-semibold text-slate-700">{title}</figcaption>}
      <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={title}>
        {band && <rect x={x(band[0])} y={pad.t} width={Math.max(2, x(band[1]) - x(band[0]))} height={height - pad.t - pad.b} fill="#fde68a" opacity="0.35" />}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(yMax * f)} y2={y(yMax * f)} stroke="#e2e8f0" strokeWidth="1" />
            {!bare && (
              <text x={pad.l - 5} y={y(yMax * f) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">
                {yFormat(yMax * f)}
              </text>
            )}
          </g>
        ))}
        {lines.map((l) => (
          <g key={`${l.day}-${l.label}`}>
            <line x1={x(l.day)} x2={x(l.day)} y1={pad.t} y2={height - pad.b} stroke={l.color ?? '#fb7185'} strokeWidth="1.2" strokeDasharray={l.dash ?? '4 3'} />
            {!bare && (
              <text x={x(l.day) + (l.day > days * 0.8 ? -4 : 4)} y={pad.t + 9} textAnchor={l.day > days * 0.8 ? 'end' : 'start'} fontSize="10" fill={l.color ?? '#e11d48'}>
                {l.label}
              </text>
            )}
          </g>
        ))}
        {ticks.map((day) => (
          <path key={day} d={`M${x(day) - 4},${height - pad.b} L${x(day) + 4},${height - pad.b} L${x(day)},${height - pad.b - 7} Z`} fill="#7c3aed" opacity="0.8">
            <title>{`A threshold step starts on ${dayLabel(calendar, day)}`}</title>
          </path>
        ))}
        {series.map((s) => (
          <path key={s.id} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dash} strokeLinejoin="round" data-series={s.id} />
        ))}
        {dots.map((d) => (
          <g key={`${d.day}-${d.value}`}>
            <circle cx={x(d.day)} cy={y(d.value)} r="4" fill="#fff" stroke={d.color ?? '#e11d48'} strokeWidth="2" />
            <title>{d.label}</title>
          </g>
        ))}
        {!bare && (
          <>
            <text x={pad.l} y={height - 5} fontSize="10" fill="#94a3b8">
              {shortDay(calendar, 1)}
            </text>
            <text x={W - pad.r} y={height - 5} textAnchor="end" fontSize="10" fill="#94a3b8">
              {shortDay(calendar, days)}
            </text>
          </>
        )}
      </svg>
    </figure>
  )
}
const Legend = ({ items }) => (
  <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500" data-note>
    {items.map(([label, color, dash]) => (
      <span key={label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <svg width="22" height="6" aria-hidden="true">
          <line x1="0" x2="22" y1="3" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dash} />
        </svg>
        {label}
      </span>
    ))}
  </p>
)
const NOW = '#94a3b8'
const NEXT = '#9333ea'
const DONE = '#10b981'

// --- What a proposal may change, and inside which bounds -------------------

const Row = ({ label, title, children }) => (
  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-slate-600" title={title}>
    <span className="w-52 shrink-0 font-medium text-slate-700">{label}</span>
    {children}
  </div>
)
const N = (props) => <Num allowEmpty className="w-16" {...props} />
const L = ({ children, title }) => (
  <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600" title={title}>
    {children}
  </label>
)

function Bounds({ state, plan, setPlan }) {
  const reference = recipeBudgetReference(state)
  const set = (group, key) => (value) => setPlan((p) => ({ ...p, [group]: { ...p[group], [key]: value } }))
  return (
    <div className="flex flex-col gap-2.5" data-testid="chef-proposal-bounds">
      <p className="text-xs text-slate-500" data-note>
        An empty field is no bound. The numbers filled in here to start with are this tool's own starting points, not approved design values: change them freely.
      </p>
      <Row label="Main recipes: lean toward" title={`Inside the budget chosen above, what the search leans toward when the targets are met either way. Empty: the design reference, about ${reference} for this event.`}>
        <N data-testid="chef-bound-budget" value={plan.budget.target} placeholder={String(reference)} onCommit={set('budget', 'target')} min={1} /> ingredients in all (a preference, not a limit)
      </Row>
      <Row label="Recompletion recipes, in all" title="Optional, and only used when Recompletion's recipes may change (with a Recompletion target, below). Never part of the Main budget.">
        from <N data-testid="chef-bound-rc-min" value={plan.budget.rcMin} onCommit={set('budget', 'rcMin')} min={1} /> to <N data-testid="chef-bound-rc-max" value={plan.budget.rcMax} onCommit={set('budget', 'rcMax')} min={1} />
      </Row>
      <Row label="A quantity in a recipe" title="The smallest and the largest number a proposal may set for one ingredient of one dish, at the base. Quantities it does not change are left alone.">
        from <N data-testid="chef-bound-qmin" value={plan.quantity.min} onCommit={(v) => set('quantity', 'min')(v ?? 1)} min={1} allowEmpty={false} />
        to <N data-testid="chef-bound-qmax" value={plan.quantity.max} onCommit={set('quantity', 'max')} min={1} />
      </Row>
      <Row label="A basket weight" title="How far a proposal may raise a weight. A weight of 0 that you opened may go up to the largest weight of its basket.">
        at most <N data-testid="chef-bound-weight" value={plan.weight?.maxFactor ?? 8} onCommit={(v) => setPlan((p) => ({ ...p, weight: { maxFactor: v ?? 8 } }))} min={1} max={100} allowEmpty={false} /> times what it is
      </Row>
      <Row label="Blocker the last dish is short of" title="On the FU day: what the two blocker dishes need in all, less the blocker's threshold. The preferred number is leaned toward when the targets are met either way; from - to is a hard limit.">
        prefer <N data-testid="chef-bound-shortage" value={plan.shortage.preferred} onCommit={set('shortage', 'preferred')} min={1} />
        from <N value={plan.shortage.min} onCommit={set('shortage', 'min')} min={1} />
        to <N value={plan.shortage.max} onCommit={set('shortage', 'max')} min={1} />
      </Row>
      <Row label="Waiting between two dishes" title="Optional. When both are typed it becomes a target of its own: at most this share of a segment's players go longer than this without cooking a Main dish.">
        at most <N data-testid="chef-bound-gap-share" value={plan.gap.maxSharePct} onCommit={set('gap', 'maxSharePct')} max={100} />% of the players wait more than <N data-testid="chef-bound-gap-days" value={plan.gap.maxDays} onCommit={set('gap', 'maxDays')} min={1} max={state.calendar.totalDays} /> days
      </Row>
      <Row label="Recompletion" title="Recompletion has no approved speed. With nothing typed its recipes and thresholds are left as they are and its timing is only reported. With both typed, it is a target read among the players who enter Recompletion - and its values may then change.">
        <N data-testid="chef-bound-rc-share" value={plan.rc.sharePct} onCommit={set('rc', 'sharePct')} max={100} />% of the players who enter it in its FU within <N data-testid="chef-bound-rc-days" value={plan.rc.daysToFu} onCommit={set('rc', 'daysToFu')} max={state.calendar.totalDays} /> days of entering
      </Row>
      <Row label="Allowed below a target" title="A target counts as met when the share is no more than this many points under it. 0: the target itself.">
        <N value={plan.tolerancePts} onCommit={(v) => setPlan((p) => ({ ...p, tolerancePts: v ?? 0 }))} max={50} allowEmpty={false} /> points
      </Row>
    </div>
  )
}

// THE RECIPE BUDGET: chosen, never assumed. A range is kept by every candidate; a free search is labelled as such.
function RecipeBudget({ state, plan, setPlan }) {
  const reference = recipeBudgetReference(state)
  const summary = budgetSummary(state, plan)
  const mode = plan.budget.mode
  const setBudget = (patch) => setPlan((p) => ({ ...p, budget: { ...p.budget, ...patch } }))
  const example = [Math.round(reference * 0.9), Math.round(reference * 1.1)]
  if (!plan.change.recipes) {
    return (
      <p className="text-sm text-slate-600" data-testid="chef-proposal-budget" data-mode="locked" data-note>
        <span className="font-semibold text-slate-800">Recipe budget.</span> Recipe quantities may not change, so the Main recipes stay at {summary.total ?? 'what is typed'} ingredients in all (the design reference is about {reference}).
      </p>
    )
  }
  return (
    <div data-testid="chef-proposal-budget" data-mode={mode ?? 'none'}>
      <p className="text-sm font-semibold text-slate-800">
        Recipe budget <span className="font-normal text-slate-500">- the Main recipes at the base, all their ingredients (blockers and semi-blockers too)</span>
      </p>
      <p className="mb-2 mt-0.5 text-sm text-slate-600" data-note>
        Now <span className="font-semibold text-slate-800">{summary.total ?? 'not known (blank quantities)'}</span>. The design reference is about {reference} ({state.settings.recipeBudgetReference} for {state.settings.recipeBudgetDays} days, scaled to {state.calendar.totalDays}). Choose before recipes may change:
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
          <label className="inline-flex items-center gap-2 font-semibold">
            <input type="radio" name="chef-budget-mode" checked={mode === 'bounded'} onChange={() => setBudget({ mode: 'bounded' })} data-testid="chef-budget-bounded" />
            Within a range I type:
          </label>
          from <N data-testid="chef-budget-min" value={plan.budget.min} onCommit={(v) => setBudget({ min: v, mode: 'bounded' })} min={1} />
          to <N data-testid="chef-budget-max" value={plan.budget.max} onCommit={(v) => setBudget({ max: v, mode: 'bounded' })} min={1} />
          <button type="button" onClick={() => setBudget({ mode: 'bounded', min: example[0], max: example[1] })} className="whitespace-nowrap text-xs font-semibold text-purple-700 underline decoration-dotted underline-offset-2" data-testid="chef-budget-example" title="Fills the two fields with an example to edit. It is not an approved range.">
            fill in {example[0]} to {example[1]} (the reference ±10%, an example to edit)
          </button>
        </div>
        <label className="inline-flex flex-wrap items-center gap-2 text-sm text-slate-700">
          <input type="radio" name="chef-budget-mode" checked={mode === 'free'} onChange={() => setBudget({ mode: 'free' })} data-testid="chef-budget-free" />
          <span className="font-semibold">Explore freely</span>
          <span className="text-amber-800">- the recipes may land far from the reference; a proposal made this way says so</span>
        </label>
      </div>
      {mode == null && <p className="mt-2 text-xs font-semibold text-amber-800">Not chosen yet: nothing is generated until it is.</p>}
      {mode === 'bounded' && summary.total != null && summary.inRange === false && (
        <p className="mt-2 text-xs text-amber-800" data-testid="chef-budget-outside" data-note>
          The current event ({summary.total}) is outside this range. It stays the event every result is compared with; the search starts from a separate starting point inside the range, and says so.
        </p>
      )}
    </div>
  )
}

// PACING: what may be given a NEW schedule, on which days; and the semi-blocker.
function Pacing({ state, plan, setPlan }) {
  const set = (group, key) => (value) => setPlan((p) => ({ ...p, [group]: { ...p[group], [key]: value } }))
  const used = (id) => state.dishes.some((d) => d.recipe.some((r) => r.ingredientId === id))
  const ordinary = state.ingredients.filter((i) => (i.rarity === RARITY.COMMON || i.rarity === RARITY.RARE) && used(i.id))
  const semis = state.ingredients.filter((i) => i.rarity === RARITY.SEMI_BLOCKER && used(i.id))
  const scheduleOf = (id) => state.thresholds.find((t) => t.round === 'main' && t.ingredientId === id) ?? null
  const pacedNow = new Set(state.thresholds.filter((t) => ordinary.some((i) => i.id === t.ingredientId)).map((t) => t.ingredientId)).size
  const dm = state.calendar.dishMaster?.startDay != null && state.calendar.dishMaster?.endDay != null ? state.calendar.dishMaster : null
  const stepDays = existingStepDays(state)
  const [daysText, setDaysText] = useState((plan.pacing.dayOptions ?? []).join(', '))
  const commitDays = (text) => {
    const list = [...new Set(String(text).split(/[^0-9]+/).filter(Boolean).map(Number).filter((d) => d > 1 && d <= state.calendar.totalDays))].sort((a, b) => a - b)
    setDaysText(list.join(', '))
    set('pacing', 'dayOptions')(list)
  }
  const exposure = semiExposure(state)
  return (
    <div className="flex flex-col gap-3" data-testid="chef-proposal-pacing">
      <p className="text-xs text-slate-500" data-note>
        A schedule limits how much of an ingredient a player may have RECEIVED in the round by a day - not what they hold. While it is reached, baskets give the other ingredients in its place (a basket keeps its size). A proposal tunes the schedules typed in step 3 and may make new ones as allowed here; a new ordinary schedule that does not help enough is taken away again. No dish is ever locked by date.
      </p>
      <Row label="Ordinary ingredients paced" title="Existing and new schedules count together. 0: none.">
        at most <N data-testid="chef-pacing-max" value={plan.pacing.maxOrdinary} onCommit={(v) => set('pacing', 'maxOrdinary')(v ?? 0)} allowEmpty={false} /> ({pacedNow} {pacedNow === 1 ? 'has' : 'have'} a schedule now)
      </Row>
      <Row label="Steps in a schedule">
        at most <N value={plan.pacing.maxSteps} onCommit={(v) => set('pacing', 'maxSteps')(v ?? 5)} min={1} allowEmpty={false} />
      </Row>
      {plan.change.thresholdDays ? (
        <Row label="Days a step may start on" title="Opening days may change: steps of existing schedules move, and new ones step, inside these days.">
          from day <N value={plan.pacing.dayMin} onCommit={(v) => set('pacing', 'dayMin')(v ?? 1)} min={1} max={state.calendar.totalDays} allowEmpty={false} /> to day <N value={plan.pacing.dayMax} placeholder={String(state.calendar.totalDays)} onCommit={set('pacing', 'dayMax')} min={1} max={state.calendar.totalDays} />
        </Row>
      ) : (
        <Row label="Days a new schedule may use" title="Opening days may not change: existing schedules keep theirs, and a new schedule steps only on the days typed here (it starts on day 1, the first day of the event). Empty: no new schedule can be made.">
          <input value={daysText} onChange={(e) => setDaysText(e.target.value)} onBlur={(e) => commitDays(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} placeholder="none - e.g. 5, 9, 13" data-testid="chef-pacing-days" className="w-44 rounded-lg border border-slate-200 bg-white/80 px-2 py-1 text-sm text-slate-800 focus:border-purple-400 focus:outline-none" />
          {stepDays.length > 0 && (
            <button type="button" onClick={() => commitDays(stepDays.join(','))} className="whitespace-nowrap text-xs font-semibold text-purple-700 underline decoration-dotted underline-offset-2" data-testid="chef-pacing-use-days">
              use the days existing schedules step on ({stepDays.join(', ')})
            </button>
          )}
        </Row>
      )}
      <div>
        <p className="mb-1 text-sm font-medium text-slate-700">Ordinary ingredients that may be given a new schedule</p>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5" data-testid="chef-pacing-ingredients">
          {ordinary.map((ing) =>
            scheduleOf(ing.id) ? (
              <span key={ing.id} className="text-sm text-slate-500" title="It has a schedule already (step 3). To keep that one exactly as it is, lock it in Locks." data-pacing-has={ing.id}>
                {ing.name}: has a schedule
              </span>
            ) : (
              <span key={ing.id} data-pacing-allow={ing.id}>
                <Check checked={!plan.pacing.excluded?.[ing.id]} onChange={(on) => setPlan((p) => { const excluded = { ...(p.pacing.excluded ?? {}) }; if (on) delete excluded[ing.id]; else excluded[ing.id] = true; return { ...p, pacing: { ...p.pacing, excluded } } })}>
                  {ing.name}
                </Check>
              </span>
            ),
          )}
        </div>
      </div>
      {semis.map((semi) => {
        const t = scheduleOf(semi.id)
        const rows = exposure.filter((x) => x.ingredientId === semi.id)
        return (
          <div key={semi.id} className="flex flex-col gap-2 rounded-xl border border-violet-100 bg-violet-50/40 p-3" data-testid="chef-pacing-semi">
            <p className="text-sm font-medium text-slate-700">
              {semi.name}, the semi-blocker{' '}
              <span className="font-normal text-slate-500">
                {t ? `- has a schedule (${t.steps.map((st) => (st.limit == null ? `lifted day ${st.fromDay}` : `${st.limit} from day ${st.fromDay}`)).join(', ')})` : '- no schedule yet'}
              </span>
            </p>
            {dm ? (
              <p className="text-xs text-slate-500" data-note>
                Dish Master is day {dm.startDay} to {dm.endDay} (step 1). The confirmed rule: a limited amount before it, a mild rise during it, no restriction after it - nothing requires none before it. A new schedule steps on those days only; the pantry cap and the most a basket gives stay as they are. Does not count toward the ordinary ingredients above.
              </p>
            ) : (
              <p className="text-xs font-semibold text-amber-800">No Dish Master days are set (step 1): no schedule can be made for it.</p>
            )}
            {!t && (
              <Check checked={plan.semi.allow} onChange={set('semi', 'allow')} data-testid="chef-semi-allow">
                May be given a schedule
              </Check>
            )}
            <Row label="Limit before Dish Master" title="Received before Dish Master begins. Empty: no bound beyond the rule.">
              from <N data-testid="chef-semi-early-min" value={plan.semi.earlyMin} onCommit={set('semi', 'earlyMin')} /> to <N data-testid="chef-semi-early-max" value={plan.semi.earlyMax} onCommit={set('semi', 'earlyMax')} />
            </Row>
            <Row label="Limit during Dish Master" title="Received by a day of Dish Master. Empty: no bound beyond the rule.">
              from <N data-testid="chef-semi-dm-min" value={plan.semi.dmMin} onCommit={set('semi', 'dmMin')} /> to <N data-testid="chef-semi-dm-max" value={plan.semi.dmMax} onCommit={set('semi', 'dmMax')} />
            </Row>
            <Row label="Cooked before Dish Master" title="Optional. When typed it is a target of its own, for every segment; when empty nothing about it is aimed at.">
              at most <N data-testid="chef-semi-early-pct" value={plan.semi.maxEarlyPct} onCommit={set('semi', 'maxEarlyPct')} max={100} />% of a segment's players cook one of its dishes before Dish Master
            </Row>
            {rows.length > 0 && (
              <p className="text-xs text-slate-600" data-testid="chef-semi-exposure" data-note>
                <span className="font-semibold">With the schedule as typed</span> ({rows[0].limit == null ? 'no limit before Dish Master' : `${rows[0].limit} before Dish Master`}), the most of its {rows[0].dishes} dishes a player can have received enough for before Dish Master, at each segment's size:{' '}
                {rows.map((r) => `${r.name} ${r.cookable}`).join(' · ')}. One shared limit, read against every segment's own quantities.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Locks({ state, plan, setPlan }) {
  const { ingredients, calendar } = state
  const [round, setRound] = useState('main')
  const dishes = round === 'main' ? state.dishes : state.recompletionDishes
  const toggle = (group, key) => () =>
    setPlan((p) => {
      const next = { ...p.locks[group] }
      if (next[key]) delete next[key]
      else next[key] = true
      return { ...p, locks: { ...p.locks, [group]: next } }
    })
  const lockedCount = Object.keys(plan.locks.cells).length + Object.keys(plan.locks.dishes).length + Object.keys(plan.locks.weights).length + Object.keys(plan.locks.thresholds).length
  const cellClass = (locked) => `inline-flex min-w-[2.6rem] items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-xs font-semibold tabular-nums ${locked ? 'border-slate-300 bg-slate-200/80 text-slate-700' : 'border-purple-200 bg-white text-purple-800 hover:bg-purple-50'}`
  return (
    <div className="flex flex-col gap-4" data-testid="chef-proposal-locks">
      <p className="text-xs text-slate-500" data-note>
        Click a number to lock it: a locked value comes back exactly as it is. {lockedCount === 0 ? 'Nothing is locked.' : `${lockedCount} locked.`} A quantity left blank in step 2 is always generated.
      </p>
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-slate-700">Recipe quantities</span>
          {state.recompletionDishes.length > 0 && <Toggle value={round} onChange={setRound} options={[['main', 'Main'], ['rc', 'Recompletion']]} />}
        </div>
        <div className="overflow-x-auto">
          <table className="border-collapse" data-dense data-testid="chef-lock-recipes">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={TH}>Dish</th>
                {ingredients.map((ing) => (
                  <th key={ing.id} className={`${TH} text-center`}>
                    {ing.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dishes.map((dish) => {
                const dishLocked = !!plan.locks.dishes[`${round}|${dish.id}`]
                return (
                  <tr key={dish.id} className="border-b border-slate-100" data-lock-dish={dish.id}>
                    <td className={`${TD} whitespace-nowrap`}>
                      <button type="button" onClick={toggle('dishes', `${round}|${dish.id}`)} aria-pressed={dishLocked} title={dishLocked ? 'The whole dish is locked. Click to free it.' : 'Lock every quantity of this dish.'} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                        {dishLocked ? <Lock size={12} className="text-slate-500" /> : <LockOpen size={12} className="text-slate-300" />}
                        {dish.name}
                      </button>
                    </td>
                    {ingredients.map((ing) => {
                      const row = dish.recipe.find((r) => r.ingredientId === ing.id)
                      if (!row) return <td key={ing.id} className={`${TD} text-center text-slate-300`} />
                      if (row.count == null) {
                        return (
                          <td key={ing.id} className={`${TD} text-center`}>
                            <span className="inline-block min-w-[2.6rem] rounded-lg border border-dashed border-amber-300 bg-amber-50 px-1.5 py-1 text-xs font-semibold text-amber-800" title="Blank: a proposal generates this quantity.">
                              ?
                            </span>
                          </td>
                        )
                      }
                      if (isBlocker(ing)) {
                        return (
                          <td key={ing.id} className={`${TD} text-center text-xs font-semibold tabular-nums text-rose-700`} title="A blocker quantity at the base is never changed by a proposal.">
                            {row.count}
                          </td>
                        )
                      }
                      const key = cellKey(round, dish.id, ing.id)
                      const locked = dishLocked || !!plan.locks.cells[key]
                      return (
                        <td key={ing.id} className={`${TD} text-center`}>
                          <button type="button" disabled={dishLocked} onClick={toggle('cells', key)} aria-pressed={locked} aria-label={`${dish.name}: ${ing.name} ${row.count}, ${locked ? 'locked' : 'free'}`} data-lock-cell={key} className={cellClass(locked)}>
                            {locked && <Lock size={10} />}
                            {row.count}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-slate-700">Basket weights</p>
        <p className="mb-2 text-xs text-slate-500" data-note>
          A weight of 0 means the basket never gives that ingredient, and a proposal keeps it so. Click a 0 to open it: the proposal may then give it a weight. {periodNote(state)}
        </p>
        <div className="overflow-x-auto">
          <table className="border-collapse" data-dense data-testid="chef-lock-weights">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={TH}>Basket</th>
                {ingredients.map((ing) => (
                  <th key={ing.id} className={`${TH} text-center`}>
                    {ing.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.baskets.map((basket) => (
                <tr key={basket.id} className="border-b border-slate-100">
                  <td className={`${TD} whitespace-nowrap text-sm font-semibold text-slate-800`}>
                    {CHEST_LABELS[basket.chestType]}, {calendar.phases.find((p) => p.id === basket.phaseId)?.label ?? 'no period'}
                  </td>
                  {ingredients.map((ing) => {
                    const row = basket.ingredientWeights.find((w) => w.ingredientId === ing.id)
                    if (!row) return <td key={ing.id} className={`${TD} text-center text-slate-300`} />
                    const key = weightKey(basket.id, ing.id)
                    if (!(row.weight > 0)) {
                      const open = !!plan.locks.open[key] && !isBlocker(ing)
                      const can = row.max > 0 && !isBlocker(ing)
                      return (
                        <td key={ing.id} className={`${TD} text-center`}>
                          <button type="button" disabled={!can} onClick={toggle('open', key)} aria-pressed={open} data-open-weight={key} title={isBlocker(ing) ? 'The blocker is paced by its threshold: a proposal never opens a basket that never gives it, so Main completion is not raised through ordinary baskets.' : !can ? 'This basket can hold none of it (its most is 0).' : open ? 'Opened: a proposal may give it a weight. Click to close it again.' : 'Closed: this basket never gives it. Click to let a proposal give it a weight.'} className={`inline-flex min-w-[2.6rem] items-center justify-center rounded-lg border px-1.5 py-1 text-xs font-semibold ${open ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
                            {open ? '0 · open' : '0'}
                          </button>
                        </td>
                      )
                    }
                    const locked = !!plan.locks.weights[key]
                    return (
                      <td key={ing.id} className={`${TD} text-center`}>
                        <button type="button" onClick={toggle('weights', key)} aria-pressed={locked} data-lock-weight={key} className={cellClass(locked)}>
                          {locked && <Lock size={10} />}
                          {row.weight}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {state.thresholds.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2" data-testid="chef-lock-thresholds">
          <span className="text-sm font-semibold text-slate-700">Threshold schedules</span>
          {state.thresholds.map((t) => (
            <Check key={t.id} checked={!!plan.locks.thresholds[t.id]} onChange={toggle('thresholds', t.id)}>
              Lock {ingredients.find((i) => i.id === t.ingredientId)?.name ?? '?'} ({ROUND_LABELS[t.round]})
            </Check>
          ))}
        </div>
      )}
    </div>
  )
}

function SearchSettings({ plan, setPlan }) {
  const set = (key) => (value) => setPlan((p) => ({ ...p, search: { ...p.search, [key]: value } }))
  const setWeight = (key) => (value) => setPlan((p) => ({ ...p, weights: { ...p.weights, [key]: value ?? 0 } }))
  return (
    <div className="flex flex-col gap-3" data-testid="chef-proposal-search">
      <p className="text-sm text-slate-600" data-note>
        The current event is played first. Then versions of it are tried one at a time on a small set of players: each reads why the segment furthest from its targets misses - an ingredient lacking, the blocker still under its threshold, too many finished - and changes what answers that; some tries are random. The best one is then played again on other, more players, and only those figures are shown.
      </p>
      <p className="text-sm text-slate-600" data-note>
        <span className="font-semibold text-slate-700">What counts as better, in this order:</span> the shortfall of the worst segment; then the shortfalls of all segments added up; then the preferences below. A strong segment never makes up for a weak one. It is the best of a bounded search - not a proof that nothing better exists.
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5">
        <L title="How many versions of the event are played while searching. More takes longer and can find more.">
          Versions tried, at most <Num data-testid="chef-search-candidates" className="w-16" value={plan.search.candidates} min={1} max={400} onCommit={(v) => set('candidates')(Math.round(v))} />
        </L>
        <L title="The search stops when this many tries in a row improve nothing.">
          Stop after <Num className="w-14" value={plan.search.patience} min={3} max={200} onCommit={(v) => set('patience')(Math.round(v))} /> tries with no gain
        </L>
        <L title="A safety limit: the search stops when it has run this long.">
          or <Num className="w-16" value={plan.search.seconds} min={5} max={1800} onCommit={(v) => set('seconds')(Math.round(v))} /> seconds
        </L>
        <L title="The players a version is tried on while searching. Fewer is faster and less sure.">
          Players a segment: searching <Num data-testid="chef-search-players" className="w-16" value={plan.search.players} min={20} max={1000} onCommit={(v) => set('players')(Math.round(v))} />
        </L>
        <L title="Other players, on whom the current event and the proposal are both played at the end. The figures of a proposal are these.">
          checking <Num data-testid="chef-search-validation" className="w-16" value={plan.search.validationPlayers} min={50} max={5000} onCommit={(v) => set('validationPlayers')(Math.round(v))} />
        </L>
        <L title="While searching, a target counts as met only this many points above it, so the check on other players has room. Not used in the check itself.">
          Aim above a target by <Num className="w-14" value={plan.search.aimPts} min={0} max={20} onCommit={(v) => set('aimPts')(v)} /> points while searching
        </L>
        <L title="The same number gives the same search and the same players: the same proposal again.">
          Number of this search <Num data-testid="chef-search-seed" className="w-24" value={plan.search.seed} min={0} max={2147483000} onCommit={(v) => set('seed')(Math.round(v))} />
        </L>
        <L title="Basket luck only: every player opens the baskets expected of the segment. Player activity too: players also open more or fewer, on other days (the assumptions are in step 1).">
          What varies <Toggle value={plan.search.variation} onChange={set('variation')} options={VARIATIONS.map((id) => [id, VARIATION_LABELS[id]])} />
        </L>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 text-sm text-slate-600" title="Only used between versions that meet the targets equally well. 0 switches one off. The numbers are this tool's own.">
        <span className="font-medium text-slate-700">Preferences, how much each weighs</span>
        <L>
          close to the recipe budget <Num className="w-14" value={plan.weights.budget} min={0} max={10} onCommit={setWeight('budget')} />
        </L>
        <L>
          close to the preferred blocker shortage <Num className="w-14" value={plan.weights.shortage} min={0} max={10} onCommit={setWeight('shortage')} />
        </L>
        <L>
          little lost or left over <Num className="w-14" value={plan.weights.waste} min={0} max={10} onCommit={setWeight('waste')} />
        </L>
        <L>
          few changes <Num className="w-14" value={plan.weights.change} min={0} max={10} onCommit={setWeight('change')} />
        </L>
      </div>
    </div>
  )
}

// --- The review: the current event beside the proposal ---------------------

function SegmentTable({ proposal, segmentId, onPick }) {
  const { base, proposed } = proposal.validation
  const first = proposed[0]
  const fu = first.shortfalls.find((x) => x.kind === 'fu')
  const checkpoints = first.shortfalls.filter((x) => x.kind === 'checkpoint')
  const extra = first.shortfalls.filter((x) => x.kind === 'gap' || x.kind === 'rc')
  const hasRc = first.result.rcCount > 0
  const alone = proposal.recipesOnly ?? null
  // The other view of the players (both views, side by side): the same check players, played the other way.
  const other = proposal.otherView ?? null
  const otherIds = other ? [...(fu ? ['fu'] : []), ...checkpoints.map((c) => c.id)] : []
  const otherShare = (list, segId, id) => list?.find((x) => x.id === segId)?.shortfalls.find((x) => x.id === id)?.share
  const worstId = [...proposed].sort((a, b) => b.miss - a.miss)[0]?.miss > 0 ? [...proposed].sort((a, b) => b.miss - a.miss)[0].id : null
  const of = (list, id) => list?.find((s) => s.id === id) ?? null
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" data-dense data-testid="chef-proposal-segments">
        <thead>
          <tr>
            <th className={TH} />
            {fu && (
              <th className={`${TH} border-b border-slate-200 text-center`} colSpan={alone ? 5 : 4} title={`The target: ${pct(fu.target)} of the players of each segment sitting in FU at the end of day ${fu.day}.`}>
                On the FU day (day {fu.day}, target {pct(fu.target)})
              </th>
            )}
            {checkpoints.length > 0 && (
              <th className={`${TH} border-b border-slate-200 text-center`} colSpan={checkpoints.length} title="The share of the players with at least that many Main dishes by that day.">
                Checkpoints
              </th>
            )}
            {otherIds.length > 0 && (
              <th className={`${TH} border-b border-slate-200 bg-sky-50/60 text-center`} colSpan={otherIds.length} data-testid="chef-proposal-other-head" title={`The same check players, played with ${VARIATION_LABELS[other.variation].toLowerCase()}: now → with the proposal. A reading only - the verdicts use ${VARIATION_LABELS[proposal.settings.variation].toLowerCase()}.`}>
                With {VARIATION_LABELS[other.variation].toLowerCase()}
              </th>
            )}
            {extra.length > 0 && <th className={`${TH} border-b border-slate-200 text-center`} colSpan={extra.length} />}
            <th className={`${TH} border-b border-slate-200 text-center`} colSpan={hasRc ? 4 : 3}>
              When the event ends
            </th>
          </tr>
          <tr className="border-b border-slate-200">
            <th className={TH}>Segment</th>
            {fu && (
              <>
                <th className={`${TH} text-center`} title="Now → with the proposal (the range it would land in with other players), and the difference in points.">
                  In FU
                </th>
                <th className={TH} />
                <th className={`${TH} text-center`} title="Already finished the Main round on that day - not counted as in FU.">
                  Finished
                </th>
                <th className={`${TH} text-center`} title="In FU on that day or on any day before.">
                  Ever in FU
                </th>
                {alone && (
                  <th className={`${TH} text-center`} title="In FU on that day with ONLY the proposal's recipe quantities - weights and schedules as they are now - on the same players. How much of the change came from asking for less.">
                    Recipes alone
                  </th>
                )}
              </>
            )}
            {checkpoints.map((c) => (
              <th key={c.id} className={`${TH} text-center`} title={`Target ${pct(c.target)}`}>
                {c.label.replace(' dishes', '')}
              </th>
            ))}
            {otherIds.map((id) => (
              <th key={`other-${id}`} className={`${TH} bg-sky-50/60 text-center`} title={id === 'fu' ? 'In FU on the FU day: now → with the proposal.' : `${checkpoints.find((c) => c.id === id)?.label}: now → with the proposal.`}>
                {id === 'fu' ? 'In FU' : checkpoints.find((c) => c.id === id)?.label.replace(' dishes', '')}
              </th>
            ))}
            {extra.map((x) => (
              <th key={x.id} className={`${TH} text-center`} title={x.label}>
                {x.kind === 'gap' ? 'Long waits' : 'RC FU in time'}
              </th>
            ))}
            <th className={`${TH} text-center`} title="The longest stretch without cooking a Main dish, for most players (9 in 10 wait less), in days: now → with the proposal.">
              Longest wait
            </th>
            <th className={`${TH} text-center`} title="The share of the players who finish the Main round by the last day.">
              Finish Main
            </th>
            {hasRc && (
              <th className={`${TH} text-center`} title="Of all the players: enter Recompletion / reach its FU / finish it, with the proposal.">
                Recompletion
              </th>
            )}
            <th className={`${TH} text-center`} title="What the average player is paid, in the worth of the prizes. Incomplete while prizes are missing.">
              Paid
            </th>
          </tr>
        </thead>
        <tbody>
          {proposed.map((s) => {
            const b = of(base, s.id)
            const n = s.result.players
            const short = (list, id) => list?.shortfalls.find((x) => x.id === id) ?? null
            const sFu = short(s, 'fu')
            const day = sFu ? sFu.day - 1 : null
            return (
              <tr key={s.id} className={`border-b border-slate-100 ${segmentId === s.id ? 'bg-purple-50/50' : ''}`} data-segment={s.id}>
                <td className={`${TD} whitespace-nowrap`}>
                  <button type="button" onClick={() => onPick(s.id)} className="text-sm font-semibold text-slate-800 underline decoration-dotted underline-offset-2 hover:decoration-solid" title="Show this segment in the graphs below">
                    {s.name}
                  </button>
                  {worstId === s.id && (
                    <span className="ml-1.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800" data-worst title="The segment furthest from its targets with the proposal. It is what the search compares first.">
                      furthest
                    </span>
                  )}
                </td>
                {sFu && (
                  <>
                    <td className={`${TD} text-center`} data-cell="fu">
                      <Shares now={short(b, 'fu')?.share} next={sFu.share} n={n} />
                    </td>
                    <td className={TD}>
                      <Verdict verdict={sFu.verdict} />
                    </td>
                    <td className={`${TD} text-center text-sm tabular-nums text-slate-600`}>
                      {b ? `${pct(b.result.fuTarget.finished)} → ` : ''}
                      {pct(s.result.fuTarget.finished)}
                    </td>
                    <td className={`${TD} text-center text-sm tabular-nums text-slate-600`}>
                      {b ? `${pct(b.result.days[day].everFu)} → ` : ''}
                      {pct(s.result.days[day].everFu)}
                    </td>
                    {alone && (
                      <td className={`${TD} text-center text-sm tabular-nums text-slate-600`} data-cell="recipes-alone">
                        {pct(alone.find((x) => x.id === s.id)?.shortfalls.find((x) => x.id === 'fu')?.share)}
                      </td>
                    )}
                  </>
                )}
                {checkpoints.map((c) => (
                  <td key={c.id} className={`${TD} text-center`}>
                    <Shares now={short(b, c.id)?.share} next={short(s, c.id).share} n={n} /> {short(s, c.id).miss > 0 && <Verdict verdict={short(s, c.id).verdict} />}
                  </td>
                ))}
                {otherIds.map((id) => {
                  const now = otherShare(other.base, s.id, id)
                  const next = otherShare(other.proposed, s.id, id)
                  return (
                    <td key={`other-${id}`} className={`${TD} whitespace-nowrap bg-sky-50/40 text-center text-sm tabular-nums text-slate-600`} data-cell={id === 'fu' ? 'other-fu' : 'other-checkpoint'}>
                      {now != null ? `${pct(now)} → ` : ''}
                      <span className="font-semibold text-slate-800">{pct(next)}</span>
                    </td>
                  )
                })}
                {extra.map((x) => (
                  <td key={x.id} className={`${TD} text-center`}>
                    {short(s, x.id) ? (
                      <>
                        <Shares now={short(b, x.id)?.share} next={short(s, x.id).share} n={x.kind === 'rc' ? Math.max(1, s.result.rc.entrants) : n} lowerIsBetter={x.kind === 'gap'} />
                        {x.kind === 'rc' && <span className="ml-1 text-[11px] text-slate-400">of {s.result.rc.entrants}</span>}
                      </>
                    ) : (
                      <span className="text-[11px] text-slate-400" title="Nobody of this segment entered Recompletion, so there is no one to read it on.">
                        no one entered
                      </span>
                    )}
                  </td>
                ))}
                <td className={`${TD} text-center text-sm tabular-nums text-slate-600`} data-cell="wait">
                  {b ? `${b.result.gap.p90 ?? '-'} → ` : ''}
                  {s.result.gap.p90 ?? '-'}
                </td>
                <td className={`${TD} text-center text-sm tabular-nums text-slate-600`}>
                  {b ? `${pct(b.result.finish.share)} → ` : ''}
                  <span className="font-semibold text-slate-800">{pct(s.result.finish.share)}</span>
                </td>
                {hasRc && (
                  <td className={`${TD} text-center text-sm tabular-nums text-slate-600`} title={`With the proposal, of all ${n} players: ${pct(s.result.rc.enteredShare)} enter Recompletion (${s.result.rc.entrants} players), ${pct(s.result.rc.fuEverShare)} reach its FU${s.result.rc.daysToFuP50 != null ? ` (the middle one ${s.result.rc.daysToFuP50} days after entering)` : ''}, ${pct(s.result.rc.doneShare)} finish it.${b ? ` Now: ${pct(b.result.rc.enteredShare)} / ${pct(b.result.rc.fuEverShare)} / ${pct(b.result.rc.doneShare)}.` : ''}`}>
                    {pct(s.result.rc.enteredShare)} / {pct(s.result.rc.fuEverShare)} / {pct(s.result.rc.doneShare)}
                  </td>
                )}
                <td className={`${TD} text-center text-sm tabular-nums text-slate-600`}>
                  {s.result.payout.complete ? (
                    <>
                      {b ? `${num(b.result.payout.mean)} → ` : ''}
                      <span className="font-semibold text-slate-800">{num(s.result.payout.mean)}</span>
                    </>
                  ) : (
                    <span className="text-amber-700" title={`Prizes are missing, so what a player is paid is not known - not zero: ${s.result.payout.missing.join('; ')}`} data-payout="incomplete">
                      incomplete
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Graphs({ state, proposal, segmentId, onPick }) {
  const { calendar } = state
  const { base, proposed } = proposal.validation
  const s = proposed.find((x) => x.id === segmentId) ?? proposed[0]
  const b = base?.find((x) => x.id === s.id) ?? null
  const days = s.result.days.length
  const fu = s.shortfalls.find((x) => x.kind === 'fu')
  const dm = calendar.dishMaster?.startDay != null && calendar.dishMaster?.endDay != null ? [calendar.dishMaster.startDay, calendar.dishMaster.endDay] : null
  const ticks = [...new Set(proposal.patch.thresholds.filter((t) => t.round === 'main').flatMap((t) => t.steps.map((step) => step.fromDay)).filter((d) => d > 1 && d <= days))]
  const fuLine = fu ? [{ day: fu.day, label: 'FU day' }] : []
  const checkpoints = s.shortfalls.filter((x) => x.kind === 'checkpoint')
  const state2 = { ...state, ...proposal.patch }
  const dishDots = checkpoints.map((c) => ({ day: c.day, value: (state2.targets.checkpoints ?? []).find((t) => t.id === c.id)?.dishes ?? 0, label: `Checkpoint: ${c.label} for ${pct(c.target)} of the players` }))
  const series = (key, scale = 1) => [...(b ? [{ id: 'now', values: b.result.days.map((d) => d[key] * scale), color: NOW, dash: '5 4' }] : []), { id: 'proposed', values: s.result.days.map((d) => d[key] * scale), color: NEXT }]
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        One segment in detail
        <Pills data-testid="chef-proposal-segment" value={s.id} onChange={onPick} options={proposed.map((x) => [x.id, x.name])} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="chef-proposal-chart">
        <DayChart title={`${s.name}: Main dishes cooked, the average player`} calendar={calendar} days={days} yMax={s.result.mainCount} yFormat={(v) => num(v, 0)} band={dm} lines={fuLine} ticks={ticks} dots={dishDots} series={series('mean')} data-chart="dishes" />
        <DayChart title={`${s.name}: players sitting in FU, day by day`} calendar={calendar} days={days} yMax={1} yFormat={(v) => pct(v)} band={dm} lines={fuLine} ticks={ticks} dots={fu ? [{ day: fu.day, value: fu.target, label: `The FU target: ${pct(fu.target)} on day ${fu.day}` }] : []} series={[...series('inFu'), { id: 'finished', values: s.result.days.map((d) => d.finished), color: DONE, width: 1.5, dash: '2 3' }]} data-chart="fu" />
      </div>
      <Legend
        items={[
          ...(b ? [['The current event', NOW, '5 4']] : []),
          ['With the proposal', NEXT],
          ['Finished Main, with the proposal', DONE, '2 3'],
          ['FU day', '#fb7185', '4 3'],
        ]}
      />
      <p className="text-[11px] text-slate-500" data-note>
        {dm ? `The shaded days are Dish Master (${shortDay(calendar, dm[0])} to ${shortDay(calendar, dm[1])}). ` : ''}A ring is a target: a checkpoint (so many dishes by that day) on the left, the FU target on the right. A small triangle on the bottom line is a day on which a threshold step of the proposal starts.
        {s.result.dishMaster ? ` By the last day of Dish Master, ${pct(s.result.dishMaster.allShare)} of ${s.name} have cooked all ${s.result.dishMaster.dishes} Dish Master dishes${b?.result.dishMaster ? ` (now ${pct(b.result.dishMaster.allShare)})` : ''}.` : ''}
      </p>
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-700">Every segment: players sitting in FU, day by day</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="chef-proposal-overview">
          {proposed.map((x) => {
            const bx = base?.find((y) => y.id === x.id)
            const f = x.shortfalls.find((y) => y.kind === 'fu')
            return (
              <div key={x.id} role="button" tabIndex={0} onClick={() => onPick(x.id)} onKeyDown={(e) => e.key === 'Enter' && onPick(x.id)} className={`cursor-pointer rounded-xl border p-2 text-left ${x.id === s.id ? 'border-purple-300 bg-purple-50/40' : 'border-slate-200 bg-white/70 hover:border-purple-200'}`} data-overview={x.id}>
                <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-700">
                  <span className="truncate">{x.name}</span>
                  {f && <span className="whitespace-nowrap tabular-nums text-slate-500">{bx ? `${pct(bx.shortfalls.find((y) => y.kind === 'fu').share)} → ` : ''}{pct(f.share)}</span>}
                </span>
                <DayChart bare calendar={calendar} days={days} yMax={1} yFormat={(v) => pct(v)} height={120} lines={f ? [{ day: f.day, label: '' }] : []} dots={f ? [{ day: f.day, value: f.target, label: `Target ${pct(f.target)}` }] : []} series={[...(bx ? [{ id: 'now', values: bx.result.days.map((d) => d.inFu), color: NOW, dash: '5 4', width: 3 }] : []), { id: 'proposed', values: x.result.days.map((d) => d.inFu), color: NEXT, width: 3.5 }]} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const Arrow = ({ from, to, className = '' }) => (
  <span className={`whitespace-nowrap tabular-nums ${className}`}>
    <span className="text-slate-400">{from ?? '?'} → </span>
    <span className="font-semibold text-purple-800">{to}</span>
  </span>
)
const stepsText = (steps) => (steps ?? []).map((step) => `from day ${step.fromDay}: ${step.limit == null ? 'lifted' : step.limit}`).join(' · ')

function Changes({ state, proposal, segmentId }) {
  const { ingredients, segments, calendar } = state
  const { changes, patch } = proposal
  const [view, setView] = useState('base')
  const byId = Object.fromEntries(ingredients.map((i) => [i.id, i]))
  const segment = segments.find((x) => x.id === view) ?? null
  const rounds = [['main', state.dishes, patch.dishes], ...(changes.recipes.some((c) => c.round === 'rc') ? [['rc', state.recompletionDishes, patch.recompletionDishes]] : [])]
  const typedWeights = changes.weights.filter((w) => w.typed)
  const changedBaskets = [...new Set(changes.weights.map((w) => w.basketId))]
  const s = proposal.validation.proposed.find((x) => x.id === segmentId) ?? proposal.validation.proposed[0]
  const b = proposal.validation.base?.find((x) => x.id === s.id) ?? null
  const fuDay = s.shortfalls.find((x) => x.kind === 'fu')?.day
  const blockerNames = Object.keys(changes.totals.after.shortage).filter((id) => changes.totals.after.shortage[id] != null)
  return (
    <div className="flex flex-col gap-5" data-testid="chef-proposal-changes">
      <p className="text-sm text-slate-600" data-testid="chef-proposal-totals" data-note>
        Main recipes at the base ask for <Arrow from={proposal.baselineComplete ? changes.totals.before.demand : '?'} to={changes.totals.after.demand} /> ingredients in all (the design reference is about {recipeBudgetReference(state)}).
        {blockerNames.map((id) => (
          <span key={id}>
            {' '}
            On the FU day the last dish is short of <Arrow from={changes.totals.before.shortage[id]} to={changes.totals.after.shortage[id]} /> {byId[id]?.name}.
          </span>
        ))}
      </p>

      {changes.recipes.length > 0 && (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-slate-700">Recipe quantities ({changes.recipes.length} changed)</span>
            <Pills data-testid="chef-proposal-recipe-view" value={view} onChange={setView} options={[['base', 'The base'], ...segments.map((x) => [x.id, `${x.name}${x.effortFactor !== 1 ? ` x${num(x.effortFactor, 2)}` : ''}`])]} />
          </div>
          {rounds.map(([round, before, after]) => (
            <div key={round} className="overflow-x-auto">
              <table className="mb-2 border-collapse" data-dense data-testid={`chef-proposal-recipes-${round}`}>
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className={TH}>{ROUND_LABELS[round]} dish</th>
                    {ingredients.map((ing) => (
                      <th key={ing.id} className={`${TH} text-center`}>
                        {ing.name}
                      </th>
                    ))}
                    <th className={`${TH} text-center`}>In all</th>
                  </tr>
                </thead>
                <tbody>
                  {after.map((dish, i) => {
                    const was = segment ? recipeForSegment(before[i], segment, byId) : before[i].recipe
                    const now = segment ? recipeForSegment(dish, segment, byId) : dish.recipe
                    const total = (list) => list.reduce((sum, r) => sum + (r.count ?? 0), 0)
                    return (
                      <tr key={dish.id} className="border-b border-slate-100">
                        <td className={`${TD} whitespace-nowrap text-sm font-semibold text-slate-800`}>{dish.name}</td>
                        {ingredients.map((ing) => {
                          const from = was.find((r) => r.ingredientId === ing.id)?.count
                          const to = now.find((r) => r.ingredientId === ing.id)?.count
                          if (to === undefined) return <td key={ing.id} className={TD} />
                          return (
                            <td key={ing.id} className={`${TD} text-center text-sm`} data-changed={from !== to || undefined}>
                              {from !== to ? <Arrow from={from} to={to} /> : <span className="tabular-nums text-slate-400">{to}</span>}
                            </td>
                          )
                        })}
                        <td className={`${TD} text-center text-sm`}>{total(was) !== total(now) ? <Arrow from={before[i].recipe.some((r) => r.count == null) ? '?' : total(was)} to={total(now)} /> : <span className="tabular-nums text-slate-400">{total(now)}</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
          {segment && (
            <p className="text-[11px] text-slate-500" data-note>
              {segment.name}'s quantities are read off the base: x{num(segment.effortFactor, 2)}, to the nearest whole number, never below 1. Blocker quantities are not scaled.
            </p>
          )}
        </div>
      )}

      {changes.blockers.length > 0 && (
        <div data-testid="chef-proposal-blockers">
          <p className="mb-1 text-sm font-semibold text-slate-700">Blocker quantities of a segment's own</p>
          <ul className="ml-4 list-disc text-sm text-slate-600">
            {changes.blockers.map((c) => (
              <li key={`${c.dishId}-${c.segmentId}-${c.ingredientId}`}>
                {segments.find((x) => x.id === c.segmentId)?.name}: {[...state.dishes, ...state.recompletionDishes].find((d) => d.id === c.dishId)?.name} needs <Arrow from={c.from ?? `${state.dishes.find((d) => d.id === c.dishId)?.recipe.find((r) => r.ingredientId === c.ingredientId)?.count ?? '?'} (the base)`} to={c.to} /> {byId[c.ingredientId]?.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {changedBaskets.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-semibold text-slate-700">Basket weights ({typedWeights.length} changed)</p>
          <p className="mb-2 text-[11px] text-slate-500" data-note>
            Under each weight: the chance that the first ingredient drawn from the basket is this one. It also moves for an ingredient whose weight was not touched, because the others changed.
          </p>
          <div className="overflow-x-auto">
            <table className="border-collapse" data-dense data-testid="chef-proposal-weights">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={TH}>Basket</th>
                  {ingredients.map((ing) => (
                    <th key={ing.id} className={`${TH} text-center`}>
                      {ing.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {patch.baskets
                  .filter((basket) => changedBaskets.includes(basket.id))
                  .map((basket) => (
                    <tr key={basket.id} className="border-b border-slate-100">
                      <td className={`${TD} whitespace-nowrap text-sm font-semibold text-slate-800`}>
                        {CHEST_LABELS[basket.chestType]}, {calendar.phases.find((p) => p.id === basket.phaseId)?.label ?? 'no period'}
                      </td>
                      {ingredients.map((ing) => {
                        const row = basket.ingredientWeights.find((w) => w.ingredientId === ing.id)
                        const c = changes.weights.find((w) => w.basketId === basket.id && w.ingredientId === ing.id)
                        if (!row) return <td key={ing.id} className={TD} />
                        return (
                          <td key={ing.id} className={`${TD} text-center text-sm leading-tight`} data-changed={c?.typed || undefined}>
                            {c?.typed ? <Arrow from={c.from} to={c.to} /> : <span className="tabular-nums text-slate-400">{row.weight}</span>}
                            {c && (
                              <span className="block text-[10px] tabular-nums text-slate-400">
                                {pct(c.chanceFrom, 1)} → {pct(c.chanceTo, 1)}
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {changes.thresholds.length > 0 && (
        <div data-testid="chef-proposal-thresholds">
          <p className="mb-1 text-sm font-semibold text-slate-700">Threshold schedules</p>
          {(proposal.prunedSchedules ?? []).length > 0 && (
            <p className="mb-1 text-xs text-slate-500" data-note>
              Tried and taken away again, as the targets did not suffer without them: {proposal.prunedSchedules.map((id) => byId[id]?.name).join(', ')}.
            </p>
          )}
          <ul className="flex flex-col gap-1 text-sm text-slate-600">
            {changes.thresholds.map((t) => (
              <li key={t.id} data-schedule={t.ingredientId}>
                <span className="font-semibold text-slate-800">
                  {byId[t.ingredientId]?.name} ({ROUND_LABELS[t.round]})
                </span>
                {t.isNew && (
                  <span className="ml-1.5 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-800" data-new-schedule={t.ingredientId}>
                    new {t.kind === 'semi' ? 'semi-blocker' : t.kind === 'blocker' ? 'blocker' : 'ordinary'} schedule
                  </span>
                )}
                <span className="block text-slate-500">was: {t.from ? stepsText(t.from) : 'no schedule'}</span>
                <span className="block text-purple-800">proposed: {stepsText(t.to)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-1 text-sm font-semibold text-slate-700">{s.name}: what happens to the ingredients, the average player</p>
        <div className="overflow-x-auto">
          <table className="border-collapse" data-dense data-testid="chef-proposal-ingredients">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={TH}>Ingredient</th>
                <th className={`${TH} text-center`} title="What the baskets and the sources rolled for the player over the whole event.">
                  Given
                </th>
                <th className={`${TH} text-center`} title="Rolled into a full pantry and lost.">
                  Lost, pantry full
                </th>
                <th className={`${TH} text-center`} title="In the pantry when the event ends.">
                  Left over
                </th>
                {fuDay != null && (
                  <th className={`${TH} text-center`} title={`The share of the players who, on day ${fuDay}, lack it for the Main dishes they have left. For the blocker: the share still counted below its threshold - lacking the blocker for the last dish is what FU is.`}>
                    Lacking on the FU day
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {s.result.ingredients.map((row) => {
                const was = b?.result.ingredients.find((x) => x.id === row.id)
                const lack = (seg) => {
                  const l = seg?.result.probes[fuDay]?.lack.find((x) => x.id === row.id)
                  return isBlocker(byId[row.id]) ? l?.belowLimit : l?.share
                }
                const cell = (key) => (was ? <Arrow from={num(was[key])} to={num(row[key])} /> : num(row[key]))
                return (
                  <tr key={row.id} className="border-b border-slate-100">
                    <td className={`${TD} text-sm font-semibold text-slate-800`}>
                      {byId[row.id]?.name}
                      {isBlocker(byId[row.id]) && <span className="ml-1 text-[10px] font-normal text-slate-400">(below its threshold)</span>}
                    </td>
                    <td className={`${TD} text-center text-sm`}>{cell('rolled')}</td>
                    <td className={`${TD} text-center text-sm`}>{cell('lost')}</td>
                    <td className={`${TD} text-center text-sm`}>{cell('onHand')}</td>
                    {fuDay != null && <td className={`${TD} text-center text-sm`}>{was ? <Arrow from={pct(lack(b))} to={pct(lack(s))} /> : pct(lack(s))}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// Which targets got better, worse, or are still not met - segment by segment.
// The recipe budget of a proposal, in sight: the current event, the range, the proposal, and the change.
function BudgetLine({ proposal }) {
  const b = proposal.budget
  if (!b) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="chef-proposal-budget-line" data-mode="unknown">
        Made before the recipe budget was a choice: whether it stayed in an effort range you chose is not recorded.
      </p>
    )
  }
  const free = b.mode === 'free'
  const sign = b.changePct == null ? '' : ` (${b.changePct > 0 ? '+' : ''}${Math.round(b.changePct * 100)}%)`
  return (
    <div className={`rounded-xl border px-3 py-2 text-sm ${free ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700'}`} data-testid="chef-proposal-budget-line" data-mode={b.mode}>
      <span className={`mr-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${free ? 'bg-amber-200 text-amber-900' : b.mode === 'bounded' ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-700'}`}>
        {free ? 'Free budget exploration' : b.mode === 'bounded' ? `Kept within ${b.min} to ${b.max}` : 'Recipes not changed'}
      </span>{' '}
      Main recipes at the base: the current event {b.current ?? 'not known (blank quantities)'}
      {b.currentInRange === false ? ' (outside the range)' : ''} → the proposal <span className="font-semibold">{b.proposed}</span>
      {sign}. The design reference is about {b.reference}.{free ? ' Explored freely: the recipes were allowed anywhere, so this is not a proposal inside an effort range you chose.' : ''}
    </div>
  )
}

// The semi-blocker's three dishes, before, during and after Dish Master - measured on the players of the check.
function SemiTable({ proposal }) {
  const { base, proposed } = proposal.validation
  const first = proposed[0]?.result.dishMaster
  if (!first) return <p className="text-sm text-slate-600">No Dish Master days are set, or no Main dish needs the semi-blocker: there is nothing to read.</p>
  const pair = (now, next, f) => (now == null ? f(next) : `${f(now)} → ${f(next)}`)
  const exposure = (list, id) => list?.filter((x) => x.segmentId === id) ?? []
  return (
    <div className="flex flex-col gap-2" data-testid="chef-proposal-semi">
      <p className="text-xs text-slate-500" data-note>
        Dish Master is day {first.startDay} to {first.endDay}; {first.dishes} Main dishes {first.picked ? 'are picked for it (step 1)' : 'need the semi-blocker'}. Measured, not aimed at unless a limit on cooking before Dish Master was typed (Pacing). "Most cookable before" reads the schedule: with the limit in force the day before Dish Master, the most of those dishes a player of the segment can have received enough for, at its own size.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" data-dense>
          <thead>
            <tr className="border-b border-slate-200">
              <th className={TH}>Segment</th>
              <th className={`${TH} text-center`} title="The share of players who cooked one of them before Dish Master began.">Cooked one before</th>
              <th className={`${TH} text-center`} title="Of the schedule: the most of them a player could have received enough for before Dish Master.">Most cookable before</th>
              <th className={`${TH} text-center`} title="How many of them the average player has cooked by the last day of Dish Master.">By its last day, average</th>
              <th className={`${TH} text-center`} title="The share who cooked all of them by the last day of Dish Master.">All by its last day</th>
              <th className={`${TH} text-center`} title="The share who cooked one of them after Dish Master ended - the catch-up once supply opens.">One after it</th>
              <th className={`${TH} text-center`} title="The share who cooked all of them by the end of the event.">All by the end</th>
            </tr>
          </thead>
          <tbody>
            {proposed.map((s) => {
              const b = base?.find((x) => x.id === s.id)?.result.dishMaster ?? null
              const d = s.result.dishMaster
              const eb = exposure(proposal.semi?.before, s.id)[0]
              const ea = exposure(proposal.semi?.after, s.id)[0]
              return (
                <tr key={s.id} className="border-b border-slate-100 text-sm tabular-nums text-slate-600" data-semi-segment={s.id}>
                  <td className={`${TD} font-semibold text-slate-800`}>{s.name}</td>
                  <td className={`${TD} text-center`}>{pair(b?.earlyShare, d.earlyShare, pct)}</td>
                  <td className={`${TD} text-center`}>{ea ? pair(eb?.cookable, ea.cookable, (v) => `${v} of ${ea.dishes}`) : '-'}</td>
                  <td className={`${TD} text-center`}>{pair(b?.byEndMean, d.byEndMean, (v) => num(v, 1))}</td>
                  <td className={`${TD} text-center`}>{pair(b?.allShare, d.allShare, pct)}</td>
                  <td className={`${TD} text-center`}>{pair(b?.afterShare, d.afterShare, pct)}</td>
                  <td className={`${TD} text-center`}>{pair(b?.allByEventShare, d.allByEventShare, pct)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TargetMoves({ proposal }) {
  const { base, proposed } = proposal.validation
  const rows = proposed.flatMap((s) => s.shortfalls.map((x) => ({ segment: s.name, ...x, was: base?.find((b) => b.id === s.id)?.shortfalls.find((y) => y.id === x.id) ?? null })))
  const better = (r) => (r.kind === 'gap' ? r.share < r.was.share - 0.005 : r.share > r.was.share + 0.005)
  const worse = (r) => (r.kind === 'gap' ? r.share > r.was.share + 0.005 : r.share < r.was.share - 0.005)
  const improved = rows.filter((r) => r.was && better(r))
  const worsened = rows.filter((r) => r.was && worse(r))
  const unmet = rows.filter((r) => r.miss > 0)
  const list = (items) => items.map((r) => `${r.segment}: ${r.label} (${r.was ? `${pct(r.was.share)} → ` : ''}${pct(r.share)}, target ${pct(r.target)})`).join('; ')
  return (
    <ul className="flex flex-col gap-1 text-sm text-slate-600" data-testid="chef-proposal-moves">
      {base && (
        <li data-moves="improved">
          <span className="font-semibold text-emerald-700">{improved.length} better</span>
          {improved.length > 0 && improved.length <= 6 ? `: ${list(improved)}` : improved.length > 6 ? ' (see the table above)' : ''}
        </li>
      )}
      {base && (
        <li data-moves="worse">
          <span className={`font-semibold ${worsened.length ? 'text-rose-700' : 'text-slate-600'}`}>{worsened.length} worse</span>
          {worsened.length > 0 ? `: ${list(worsened)}` : ''}
        </li>
      )}
      <li data-moves="unmet">
        <span className={`font-semibold ${unmet.length ? 'text-rose-700' : 'text-emerald-700'}`}>{unmet.length} still not met</span>
        {unmet.length > 0 ? `: ${list(unmet)}` : ''}
      </li>
    </ul>
  )
}

const kindMemory = { value: 'proposal' }

export default function ProposalStep({ state, update, onGoTo }) {
  const plan = useMemo(() => planOf(state), [state])
  const proposal = state.generator?.proposal ?? null
  const applied = state.generator?.applied ?? null
  const [progress, setProgress] = useState(null)
  const [segmentId, setSegmentId] = useState(null)
  const [noPresets, setNoPresets] = useState(null)
  // (Which kind is in view is remembered for the visit, like a folded section.)
  const [kind, setKindState] = useState(() => kindMemory.value)
  const setKind = (value) => {
    kindMemory.value = value
    setKindState(value)
  }
  const cancel = useRef(false)
  const running = progress != null

  const setPlan = (fn) => update((s) => ({ ...s, generator: { ...(s.generator ?? {}), plan: fn(planOf(s)) } }))
  const setChange = (key) => (value) => setPlan((p) => ({ ...p, change: { ...p.change, [key]: value } }))
  const problems = useMemo(() => inputProblems(state, plan), [state, plan])
  const invalid = useMemo(() => (problems.length ? [] : configurationProblems(state, plan)), [state, plan, problems])
  const conflicts = useMemo(() => (problems.length || invalid.length ? [] : structuralConflicts(state, plan)), [state, plan, problems, invalid])
  const warnings = useMemo(() => searchWarnings(state, plan), [state, plan])
  const targets = useMemo(() => describeTargets(state, plan), [state, plan])
  const selected = state.segments.filter((s) => !plan.segmentIds || plan.segmentIds.includes(s.id))
  const toggleSegment = (id) =>
    setPlan((p) => {
      const now = new Set(p.segmentIds ?? state.segments.map((s) => s.id))
      if (now.has(id)) now.delete(id)
      else now.add(id)
      const ids = state.segments.map((s) => s.id).filter((x) => now.has(x))
      return { ...p, segmentIds: ids.length === state.segments.length ? null : ids }
    })

  async function handleGenerate() {
    cancel.current = false
    setNoPresets(null)
    setProgress({ done: 0, of: plan.search.candidates + 6, label: 'Starting' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    const result = await generateProposal(state, plan, { onProgress: setProgress, isCancelled: () => cancel.current })
    // (A search that was stopped leaves the proposal that was there.)
    if (result.status === 'cancelled' || result.status === 'incomplete') setProgress({ cancelled: true, incomplete: result.status === 'incomplete', evaluations: result.evaluations })
    else {
      update((s) => ({ ...s, generator: { ...(s.generator ?? {}), plan: planOf(s), proposal: result } }))
      setProgress(null)
    }
  }
  const handleApply = () => update((s) => applyProposal(s, s.generator?.proposal, planOf(s)))
  const handleUndo = () => update(undoProposal)
  const handleDiscard = () => {
    setNoPresets(null)
    update((s) => ({ ...s, generator: { ...(s.generator ?? {}), proposal: null } }))
  }

  const stale = proposal ? staleReason(state, proposal, plan) : null
  const applicable = proposal && canApply(state, proposal, plan)
  const inUse = proposal && proposalIsInUse(state, proposal)
  const editedSince = proposal?.appliedAt && !inUse
  const hasReview = !!proposal?.validation
  const unmet = hasReview ? proposal.validation.proposed.flatMap((s) => s.shortfalls.filter((x) => x.miss > 0).map((x) => ({ ...x, segment: s.name }))) : []
  const changeSummary = Object.entries(CHANGE_LABELS)
    .filter(([key]) => plan.change[key])
    .map(([, label]) => label.toLowerCase())
  const boundsSummary = [`recipes lean toward ${plan.budget.target ?? recipeBudgetReference(state)}`, `a quantity from ${plan.quantity.min}${plan.quantity.max != null ? ` to ${plan.quantity.max}` : ''}`, `blocker shortage near ${plan.shortage.preferred ?? '-'}`, plan.rc.daysToFu != null && plan.rc.sharePct != null ? 'a Recompletion target' : 'Recompletion only reported'].join(' · ')
  const semiCount = state.ingredients.filter((i) => i.rarity === RARITY.SEMI_BLOCKER).length
  const pacingSummary = [`at most ${plan.pacing.maxOrdinary} ordinary ingredients paced`, plan.change.thresholdDays ? `steps from day ${plan.pacing.dayMin} to ${plan.pacing.dayMax ?? state.calendar.totalDays}` : (plan.pacing.dayOptions ?? []).length ? `new schedules may use days ${plan.pacing.dayOptions.join(', ')}` : 'no days typed for a new schedule', semiCount ? (plan.semi.allow ? 'the semi-blocker may be given a schedule' : 'the semi-blocker is not given one') : null].filter(Boolean).join(' · ')
  const lockCount = Object.keys(plan.locks.cells).length + Object.keys(plan.locks.dishes).length + Object.keys(plan.locks.weights).length + Object.keys(plan.locks.thresholds).length
  const openCount = Object.keys(plan.locks.open).length

  // Two kinds of suggestion share this step: a proposal (build 02) and catch-up presets (build 03).
  const switcher = (
    <div className="flex flex-wrap items-center gap-2" data-testid="chef-step4-kind">
      <span className="text-sm font-semibold text-slate-700">Suggest</span>
      <Pills value={kind} onChange={setKind} options={[['proposal', 'Recipes, weights and thresholds'], ['catchup', 'Catch-up presets'], ['events', 'Special events']]} />
    </div>
  )
  if (kind === 'events')
    return (
      <div className="flex flex-col gap-4">
        {switcher}
        <EventsPanel state={state} update={update} onGoTo={onGoTo} />
      </div>
    )
  if (kind === 'catchup')
    return (
      <div className="flex flex-col gap-4">
        {switcher}
        <CatchupPanel state={state} update={update} onGoTo={onGoTo} />
      </div>
    )

  return (
    <div className="flex flex-col gap-4">
      {switcher}
      <Card>
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 xl:grid-cols-2">
          <div data-testid="chef-proposal-may-change">
            <p className="mb-2 text-sm font-semibold text-slate-800">What a proposal may change</p>
            <div className="flex flex-col gap-1.5">
              {Object.entries(CHANGE_LABELS).map(([key, label]) => (
                <span key={key} title={CHANGE_HINTS[key]}>
                  <Check checked={plan.change[key]} onChange={setChange(key)} data-testid={`chef-proposal-change-${key}`}>
                    {label}
                  </Check>
                </span>
              ))}
            </div>
            {state.recompletionDishes.length > 0 && (
              <label className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600" title="Recompletion's own recipes and thresholds are changed only when a target for it is typed (Bounds). Its timing is reported either way.">
                Rounds
                <Toggle data-testid="chef-proposal-rounds" value={plan.rounds === 'both' ? 'both' : 'main'} onChange={(v) => setPlan((p) => ({ ...p, rounds: v }))} options={[['main', 'Main'], ['both', 'Main and Recompletion']]} />
              </label>
            )}
            <p className="mt-3 text-xs text-slate-500" data-note>
              Never changed: which ingredients a dish needs, the segments and what they open, basket sizes and the most a basket gives, pantry caps, prizes, special sources and jokers, the dates, the targets, catch-up presets, pricing odds. Nothing is added: no basket, no purchase, no grant.
            </p>
          </div>
          <div data-testid="chef-proposal-targets">
            <p className="mb-2 text-sm font-semibold text-slate-800">What it aims at, in every segment</p>
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
              <button type="button" onClick={() => onGoTo('event')} className="font-semibold text-purple-700 underline decoration-dotted underline-offset-2">
                Change the targets (step 1)
              </button>
            </p>
            {state.segments.length > 1 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="chef-proposal-judged">
                <span className="mr-1 text-sm text-slate-600">Judged on</span>
                {state.segments.map((s) => {
                  const on = !plan.segmentIds || plan.segmentIds.includes(s.id)
                  return (
                    <button key={s.id} type="button" aria-pressed={on} onClick={() => toggleSegment(s.id)} className={`whitespace-nowrap rounded-lg px-2 py-0.5 text-[11px] font-semibold ${on ? 'bg-purple-600 text-white' : 'border border-slate-200 bg-white/70 text-slate-500'}`}>
                      {s.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-4">
          <RecipeBudget state={state} plan={plan} setPlan={setPlan} />
        </div>

        {problems.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="chef-proposal-problems">
            <li className="font-semibold">Missing before a proposal can be generated:</li>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {invalid.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1.5 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900" data-testid="chef-proposal-invalid">
            <li className="font-semibold">The setup has to be fixed first:</li>
            {invalid.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {conflicts.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900" data-testid="chef-proposal-conflicts">
            <li className="font-semibold">Proved impossible: this holds for every event a proposal may make under the locks and bounds in force, so nothing is searched.</li>
            {conflicts.map((c) => (
              <li key={c.id}>
                {c.text}
                {c.assumptions?.length > 0 && <span className="mt-0.5 block text-xs text-rose-800/80">Assumed: {c.assumptions.join(' ')}</span>}
              </li>
            ))}
          </ul>
        )}
        {warnings.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="chef-proposal-warnings">
            <li className="font-semibold">Good to know (a risk or a limit, not a reason to stop):</li>
            {warnings.map((w) => (
              <li key={w.id}>{w.text}</li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          <button type="button" onClick={handleGenerate} disabled={running && !progress.cancelled ? true : problems.length > 0 || invalid.length > 0 || conflicts.length > 0 || selected.length === 0} data-testid="chef-proposal-generate" className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-purple-500/30 disabled:opacity-50">
            <Sparkles size={15} /> {running && !progress.cancelled ? 'Searching...' : proposal ? 'Generate another proposal' : 'Generate a proposal'}
          </button>
          {running && !progress.cancelled && (
            <button type="button" onClick={() => (cancel.current = true)} data-testid="chef-proposal-cancel" className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
              <Square size={13} /> Stop
            </button>
          )}
          <p className="min-w-0 flex-1 text-sm text-slate-600" data-testid="chef-proposal-plan">
            May change {changeSummary.length ? changeSummary.join(', ') : 'nothing'}. Tries up to {plan.search.candidates} versions on {plan.search.players} players a segment, then checks the best on {plan.search.validationPlayers} others. The event is not changed until you apply.
          </p>
        </div>
        {running && !progress.cancelled && (
          <div className="mt-3" data-testid="chef-proposal-progress">
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-purple-600 to-fuchsia-500 transition-all" style={{ width: `${progress.of > 0 ? Math.min(100, (progress.done / progress.of) * 100) : 0}%` }} />
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">
              {Math.min(progress.done, plan.search.candidates)} of at most {plan.search.candidates}: {progress.label}
            </p>
          </div>
        )}
        {progress?.cancelled && (
          <p className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="chef-proposal-cancelled">
            {progress.incomplete ? `Stopped while the best of ${progress.evaluations} versions was being checked on other players: the check did not finish, so there is nothing to apply.` : `Stopped after ${progress.evaluations} versions, before anything was checked on other players.`} The event is as it was{proposal ? ', and the proposal from before is still below' : ''}.
            <button type="button" onClick={() => setProgress(null)} className="text-xs font-semibold text-purple-700 underline decoration-dotted underline-offset-2">
              Got it
            </button>
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
        <Collapsible id="chef-proposal-bounds" className="xl:open:col-span-2" title="Bounds and optional targets" summary={boundsSummary}>
          <Bounds state={state} plan={plan} setPlan={setPlan} />
        </Collapsible>
        <Collapsible id="chef-proposal-pacing" className="xl:open:col-span-2" title="Pacing: new schedules, and the semi-blocker" summary={pacingSummary}>
          <Pacing state={state} plan={plan} setPlan={setPlan} />
        </Collapsible>
        <Collapsible id="chef-proposal-locks" className="xl:open:col-span-2" title="Locks: what must stay exactly as it is" summary={`${lockCount === 0 ? 'Nothing locked' : `${lockCount} locked`} · ${openCount === 0 ? 'a weight of 0 stays 0' : `${openCount} closed ${openCount === 1 ? 'weight' : 'weights'} opened`}`}>
          <Locks state={state} plan={plan} setPlan={setPlan} />
        </Collapsible>
        <Collapsible id="chef-proposal-search" className="xl:open:col-span-2" title="How it searches" summary={`Up to ${plan.search.candidates} versions · ${plan.search.players} players to search, ${plan.search.validationPlayers} to check · search number ${plan.search.seed} · the worst segment first`}>
          <SearchSettings plan={plan} setPlan={setPlan} />
        </Collapsible>
      </div>

      {!proposal && !running && <p className="text-sm text-slate-500">No proposal has been generated yet for this chef.</p>}

      {proposal && (
        <Card
          title={proposal.appliedAt ? 'The proposal that was applied' : 'The proposal'}
          subtitle={`Generated ${new Date(proposal.createdAt).toLocaleString()} · ${proposal.evaluations} versions played in ${num(proposal.runtimeMs / 1000, 1)} s · ${proposal.engine}, ${proposal.search}`}
          action={
            <span className="flex flex-wrap items-center gap-2">
              {!proposal.appliedAt && hasReview && (
                <button type="button" onClick={handleApply} disabled={!applicable} data-testid="chef-proposal-apply" title={applicable ? 'Puts every change of the proposal into the event at once. One undo brings the event back.' : (stale ?? 'There is nothing to apply.')} className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-40">
                  <CheckIcon size={14} /> Apply this proposal
                </button>
              )}
              {proposal.appliedAt && applied && (
                <button type="button" onClick={handleUndo} disabled={editedSince} data-testid="chef-proposal-undo" title={editedSince ? 'The event was edited after the proposal was applied: undoing would also throw those edits away.' : 'Brings back the recipes, basket weights and thresholds from before the proposal.'} className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 disabled:opacity-40">
                  <RotateCcw size={14} /> Undo: back to the event before
                </button>
              )}
              {!proposal.appliedAt && (
                <button type="button" onClick={handleDiscard} data-testid="chef-proposal-discard" className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600">
                  <Trash2 size={13} /> Discard
                </button>
              )}
            </span>
          }
        >
          <div className="flex flex-col gap-4">
            <div className={`rounded-xl border px-3 py-2 text-sm ${proposal.status === 'meets' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : proposal.status === 'misses' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`} data-testid="chef-proposal-status" data-status={proposal.status}>
              <p className="font-semibold">{STATUS_LABELS[proposal.status]}.</p>
              {proposal.status === 'meets' && (
                <p data-note>
                  Every target is met in each of the {proposal.validation.proposed.length} segments, on {proposal.settings.validationPlayers} players a segment the search never saw. Other players would land a little differently{proposal.unsure > 0 ? `: ${proposal.unsure} of the figures ${proposal.unsure === 1 ? 'is' : 'are'} too close to the target to call (marked "close")` : ''}.
                </p>
              )}
              {proposal.status === 'misses' && (
                <p data-note>
                  {unmet.length} {unmet.length === 1 ? 'target is' : 'targets are'} still missed, in {[...new Set(unmet.map((u) => u.segment))].join(', ')}.{proposal.validation.baseScore ? ` It is closer than the current event: the furthest segment was ${num(proposal.validation.baseScore.worst * 100, 1)} points short of its targets in all and is now ${num(proposal.validation.proposedScore.worst * 100, 1)}.` : ''} It can be applied as it is, with those misses.
                </p>
              )}
              {proposal.status === 'no-better' && <p data-note>On the players it was checked on, no version tried was closer to the targets than the event as it is. There is nothing to apply. Allowing more to change, or widening a bound, gives the search more room.</p>}
              {(proposal.status === 'inputs' || proposal.status === 'invalid') && (
                <ul className="ml-4 list-disc">
                  {(proposal.problems ?? []).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              {proposal.status === 'conflict' && (
                <ul className="ml-4 list-disc">
                  {(proposal.conflicts ?? []).map((c) => (
                    <li key={c.id}>
                      {c.text}
                      {c.assumptions?.length > 0 && <span className="block text-xs opacity-80">Assumed: {c.assumptions.join(' ')}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {hasReview && (
                <p className="mt-1 text-[13px] opacity-90" data-testid="chef-proposal-how" data-note>
                  The search stopped because {STOP_REASONS[proposal.stopReason] ?? proposal.stopReason}. It is the best of {proposal.evaluations} versions tried - not a proof that nothing better exists. Search number {proposal.settings.searchSeed}; {VARIATION_LABELS[proposal.settings.variation].toLowerCase()}.
                  {proposal.settings.presetsActive > 0 ? ` ${proposal.settings.presetsActive} catch-up ${proposal.settings.presetsActive === 1 ? 'preset is' : 'presets are'} switched on and played in every figure here; the presets themselves are not changed.` : ' No catch-up preset is switched on.'}
                </p>
              )}
            </div>
            {stale && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="chef-proposal-stale">
                Out of date: {stale} It cannot be applied - generate another one.
              </p>
            )}
            {proposal.appliedAt && (
              <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900" data-testid="chef-proposal-applied" data-note>
                Applied {new Date(proposal.appliedAt).toLocaleString()}. {editedSince ? 'The event has been edited since, so the figures below are no longer about the event as it is.' : 'The event is now exactly the one these figures were measured on.'} The values a proposal sets are suggestions, not confirmed values: the list of what the event still needs asks for them as before.
              </p>
            )}
            {hasReview && <BudgetLine proposal={proposal} />}
            {hasReview && proposal.startingPoint && !proposal.startingPoint.isCurrent && (
              <p className="text-sm text-slate-600" data-testid="chef-proposal-start" data-note>
                The search started from a <span className="font-semibold">starting point</span> made from the current event: {proposal.startingPoint.notes.join('; ')}. It is not the current event - every comparison here is with the current event itself.
              </p>
            )}
            {hasReview && (proposal.warnings ?? []).length > 0 && (
              <ul className="flex flex-col gap-1 text-sm text-slate-600" data-testid="chef-proposal-review-warnings">
                {proposal.warnings.map((w) => (
                  <li key={w.id}>{w.text}</li>
                ))}
              </ul>
            )}
            {proposal.rcNote && (
              <p className="text-sm text-slate-600" data-testid="chef-proposal-rc-note" data-note>
                {proposal.rcNote}
              </p>
            )}
            {proposal.baselineComplete === false && (
              <p className="text-sm text-slate-600" data-note>
                The current event has blank quantities, so it cannot be played and there is nothing to compare the proposal with: only the proposal's figures are shown.
              </p>
            )}

            {hasReview && (
              <>
                <SegmentTable proposal={proposal} segmentId={segmentId ?? proposal.validation.proposed[0].id} onPick={setSegmentId} />
                <p className="text-[13px] text-slate-600" data-testid="chef-proposal-views" data-note>
                  {proposal.otherView
                    ? `Both views of the players: the search and every verdict use ${VARIATION_LABELS[proposal.settings.variation].toLowerCase()}; the blue columns play the same check players with ${VARIATION_LABELS[proposal.otherView.variation].toLowerCase()}. The gap between the two is how much the result rests on the activity assumptions of step 1, which are not measured.`
                    : 'This proposal was made before both views of the players were played, so only one is shown. Generate again to see both.'}
                </p>
                <TargetMoves proposal={proposal} />
                <Graphs state={state} proposal={proposal} segmentId={segmentId} onPick={setSegmentId} />
              </>
            )}
          </div>
        </Card>
      )}

      {hasReview && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
          <Collapsible id="chef-proposal-changes" className="xl:open:col-span-2" title="Every change, with what it was" summary={`${proposal.changes.recipes.length} recipe quantities · ${proposal.changes.weights.filter((w) => w.typed).length} basket weights · ${proposal.changes.thresholds.length} threshold schedules${proposal.changes.blockers.length ? ` · ${proposal.changes.blockers.length} blocker quantities by segment` : ''}`}>
            {proposal.changes.count === 0 ? <p className="text-sm text-slate-600">Nothing is changed.</p> : <Changes state={state} proposal={proposal} segmentId={segmentId} />}
          </Collapsible>
          <Collapsible id="chef-proposal-semi" className="xl:open:col-span-2" title="The semi-blocker and Dish Master" summary="Its dishes before, during and after Dish Master, now and with the proposal, segment by segment">
            <SemiTable proposal={proposal} />
          </Collapsible>
          <Collapsible id="chef-proposal-why" className="xl:open:col-span-2" title="Why these changes" summary={`${proposal.explanations.length} measured reasons, on the segment that was furthest from its targets`}>
            <ul className="flex flex-col gap-1.5 text-sm text-slate-600" data-testid="chef-proposal-explanations">
              {proposal.explanations.length === 0 && <li>Nothing to explain: there is no current event to measure against, or nothing changed.</li>}
              {proposal.explanations.map((e) => (
                <li key={e.ingredientId}>{e.text}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500" data-note>
              Each line says what changed and what was measured before and after on the players of the check. It says what moved together, not that one alone caused the other: the changes were made together.
            </p>
          </Collapsible>
          <Collapsible id="chef-proposal-presets" className="xl:open:col-span-2" title="The proposal without catch-up presets" summary={proposal.settings.presetsActive > 0 ? 'A check on the side: the same players, the presets switched off' : 'No preset is switched on, so there is nothing to take away'}>
            <div className="flex flex-col gap-3" data-testid="chef-proposal-no-presets">
              <p className="text-sm text-slate-600" data-note>
                Plays the proposal on the same players of the check with every catch-up preset switched off, to see what the recipes, weights and thresholds do on their own. It changes nothing.
              </p>
              <div>
                <button type="button" disabled={stale != null || editedSince} onClick={() => setNoPresets(withoutPresets(state, proposal, plan))} data-testid="chef-proposal-no-presets-run" className="whitespace-nowrap rounded-xl border border-purple-200 bg-white px-3 py-1.5 text-sm font-semibold text-purple-700 disabled:opacity-40">
                  Play it without presets
                </button>
              </div>
              {noPresets && (
                <table className="border-collapse" data-dense>
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className={TH}>Segment</th>
                      <th className={`${TH} text-center`}>In FU on the FU day, with presets</th>
                      <th className={`${TH} text-center`}>without</th>
                      <th className={`${TH} text-center`}>Finish Main, with presets</th>
                      <th className={`${TH} text-center`}>without</th>
                    </tr>
                  </thead>
                  <tbody>
                    {noPresets.map((row) => {
                      const s = proposal.validation.proposed.find((x) => x.id === row.id)
                      return (
                        <tr key={row.id} className="border-b border-slate-100">
                          <td className={`${TD} text-sm font-semibold text-slate-800`}>{row.name}</td>
                          <td className={`${TD} text-center text-sm tabular-nums`}>{pct(s?.result.fuTarget?.inFu)}</td>
                          <td className={`${TD} text-center text-sm font-semibold tabular-nums`}>{pct(row.inFu)}</td>
                          <td className={`${TD} text-center text-sm tabular-nums`}>{pct(s?.result.finish.share)}</td>
                          <td className={`${TD} text-center text-sm font-semibold tabular-nums`}>{pct(row.finished)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </Collapsible>
          <Collapsible id="chef-proposal-log" className="xl:open:col-span-2" title="What the search tried" summary={`${proposal.log?.length ?? 0} versions, each with what it changed and how far it was from the targets`}>
            <div className="max-h-80 overflow-auto">
              <table className="w-full border-collapse" data-dense data-testid="chef-proposal-log">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className={TH}>#</th>
                    <th className={`${TH} text-center`} title="The shortfall of the segment furthest from its targets, in points, on the search players (with the aim above the target).">
                      Worst
                    </th>
                    <th className={`${TH} text-center`} title="The shortfalls of all segments added up, in points.">
                      All
                    </th>
                    <th className={TH}>What was tried</th>
                  </tr>
                </thead>
                <tbody>
                  {(proposal.log ?? []).map((l) => (
                    <tr key={l.n} className="border-b border-slate-100 text-sm text-slate-600">
                      <td className={`${TD} tabular-nums`}>{l.n}</td>
                      <td className={`${TD} text-center tabular-nums`}>{num(l.worst * 100, 0)}</td>
                      <td className={`${TD} text-center tabular-nums`}>{num(l.total * 100, 0)}</td>
                      <td className={TD}>{l.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Collapsible>
        </div>
      )}
    </div>
  )
}
