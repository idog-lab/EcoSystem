import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import Card from '../../components/ui/Card'
import { COMPARISONS, CONDITION_PARTS, MODE_MULTIPLIERS, SEGMENT_FUNCTIONS, conditionPart, partCondition, readCondition } from '../../lib/economy/segmentFunctions'
import { BASE_RULES, baseRule, baseSegments, buildPlan, createPlan, createSplit, createSpecific, planTable, withBaseRule } from '../../lib/economy/segmentFlow'
import { BUTTON, CopyButton, INPUT, MONO, Num, TD, TH, TaughtMark } from './economyUi'
import { teamData } from '../../lib/teamData'
import SegmentSetsCard from './SegmentSetsCard'

const LABEL = 'flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500'
const REMOVE = 'grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30'
const STEP = 'grid h-6 w-6 shrink-0 place-items-center rounded-full bg-purple-600 text-xs font-bold text-white'

// The plan is kept in this browser between visits (a convenience; nothing else reads it).
const PLAN_KEY = 'economy-segment-plan'
function loadPlan() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PLAN_KEY))
    return raw && typeof raw === 'object' ? { ...createPlan(), ...raw } : createPlan()
  } catch {
    return createPlan()
  }
}

// THE ECONOMY PAGE'S SEGMENTS TAB: the flow, a condition read in words, the functions known.
export default function SegmentsTab() {
  const [plan, setPlan] = useState(loadPlan)
  useEffect(() => {
    try {
      window.localStorage.setItem(PLAN_KEY, JSON.stringify(plan))
      // Shared with the team when connected (lib/teamData.js); sent only when it differs from what was sent.
      teamData.changed(PLAN_KEY)
    } catch {
      // Not kept between visits; the page works without it.
    }
  }, [plan])
  return (
    <div className="flex flex-col gap-4">
      <SegmentPlanEditor plan={plan} setPlan={setPlan} aside={<ReadCard />} />
      <SegmentSetsCard plan={plan} setPlan={setPlan} />
      <FunctionsCard />
    </div>
  )
}

// THE FLOW (lib/economy/segmentFlow.js; economist, 25 Nov 2026): the feature, the base (one rule's bands),
// specifics added to the segments picked, mode splits that duplicate the segments picked - and the segments.
// Shared by the Economy page and Merge Mania's Segments step (`setPlan` takes a function, as React's does).
// `aside`: a card beside the mode splits; `action`: a button beside "Copy as a table" (Merge's "Use these segments").
export function SegmentPlanEditor({ plan, setPlan, aside = null, action = null }) {
  const patch = (p) => setPlan((x) => ({ ...x, ...p }))
  const result = buildPlan(plan)
  const base = baseSegments(plan)
  const rule = baseRule(plan.baseRule)
  const setSpecific = (i, p) => patch({ specifics: plan.specifics.map((s, j) => (j === i ? { ...s, ...p } : s)) })
  const setSplit = (i, p) => patch({ splits: plan.splits.map((s, j) => (j === i ? { ...s, ...p } : s)) })

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
        <Card title={<StepTitle n={1} text="The feature and the base" />} subtitle="The base cuts the players into segments by one rule, in bands: a band is above its start and at most its end. Brut Wins is weighted: 0.7 x the last 3 days + 0.3 x the last 14.">
          <div className="flex flex-col gap-3">
            <label className={`${LABEL} self-start`}>
              Feature
              <input value={plan.feature} onChange={(e) => patch({ feature: e.target.value })} className={`${INPUT} w-36`} data-testid="economy-seg-feature" />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">The base rule</span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="The base rule" data-testid="economy-base-rules">
                {BASE_RULES.map((r) => (
                  <button key={r.id} type="button" role="radio" aria-checked={rule.id === r.id} onClick={() => setPlan((x) => withBaseRule(x, r.id))} data-base-rule={r.id} title={`Names: ${plan.feature || 'Feature'}_${r.code}_...`} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 transition-colors ${rule.id === r.id ? 'bg-purple-600 text-white ring-purple-600' : 'bg-white text-slate-600 ring-slate-200 hover:text-purple-700'}`}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className={LABEL}>
                Band ends
                <input value={plan.cuts} onChange={(e) => patch({ cuts: e.target.value })} className={`${INPUT} w-72`} data-testid="economy-seg-cuts" />
              </label>
              {rule.weighted && (
                <label className={LABEL} title="The multipliers of the modes inside the functions: mode 1 x1, mode 2 x2, mode 3 x4, mode 4 x8.">
                  Mode multipliers
                  <input value={plan.weights} onChange={(e) => patch({ weights: e.target.value })} className={`${INPUT} w-36 font-mono`} data-testid="economy-seg-weights" />
                </label>
              )}
              {rule.needsDays && (
                <label className={LABEL}>
                  Last days
                  <Num aria-label="The base's days" value={plan.baseDays ?? 7} allowEmpty min={1} integer onCommit={(v) => patch({ baseDays: v })} className="w-16" data-testid="economy-base-days" />
                </label>
              )}
              {rule.needsEvent && (
                <label className={LABEL}>
                  Event id
                  <input value={plan.baseEventId ?? ''} onChange={(e) => patch({ baseEventId: e.target.value.trim() })} placeholder="57634" inputMode="numeric" className={`${INPUT} w-28 font-mono`} data-testid="economy-base-event" />
                </label>
              )}
            </div>
            <p className="text-sm text-slate-700" data-testid="economy-seg-base">
              <span className="font-semibold">
                {base.length} segments in the base, by {rule.label}:
              </span> {base.map((b) => `${b.index + 1}. ${b.min}-${b.max ?? 'Plus'}`).join(' · ')}
            </p>
          </div>
        </Card>

        <Card title={<StepTitle n={2} text="Specifics" />} subtitle="A condition added with && to the segments you pick. Its tag is added to their names: Disco_BW_0_9 becomes Disco_BW_0_9_OOC.">
          <div className="flex flex-col gap-3" data-testid="economy-seg-specifics">
            {plan.specifics.map((s, i) => (
              <div key={s.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3" data-specific={i}>
                <div className="flex flex-wrap items-end gap-2">
                  <button type="button" aria-label={`Remove specific ${i + 1}`} title="Remove this specific" className={`${REMOVE} mb-0.5`} onClick={() => patch({ specifics: plan.specifics.filter((_, j) => j !== i) })}>
                    <Trash2 size={14} />
                  </button>
                  <label className={LABEL}>
                    Tag
                    <input value={s.tag} onChange={(e) => setSpecific(i, { tag: e.target.value.trim() })} placeholder="OOC" className={`${INPUT} w-32 font-mono`} data-testid={`economy-specific-tag-${i}`} />
                  </label>
                </div>
                <PartsEditor parts={s.parts} onChange={(parts) => setSpecific(i, { parts })} prefix={`s${i}`} />
                <SegmentPicker base={base} picked={s.segments} onChange={(segments) => setSpecific(i, { segments })} testid={`economy-specific-segments-${i}`} />
              </div>
            ))}
            <button type="button" className={`${BUTTON} self-start`} onClick={() => patch({ specifics: [...plan.specifics, createSpecific(plan.specifics.length + 1)] })} data-testid="economy-specific-add">
              Add a specific
            </button>
          </div>
        </Card>

        <Card title={<StepTitle n={3} text="Mode splits (duplication)" />} subtitle="The segments you pick are split by the average mode multiplier: one split value makes two segments of one (_Mode_0_3, _Mode_3_plus), two values make three.">
          <div className="flex flex-col gap-3" data-testid="economy-seg-splits">
            {plan.splits.map((d, i) => (
              <div key={d.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3" data-split={i}>
                <div className="flex flex-wrap items-end gap-2">
                  <button type="button" aria-label={`Remove mode split ${i + 1}`} title="Remove this mode split" className={`${REMOVE} mb-0.5`} onClick={() => patch({ splits: plan.splits.filter((_, j) => j !== i) })}>
                    <Trash2 size={14} />
                  </button>
                  <label className={LABEL}>
                    Split the mode at
                    <input value={d.values} onChange={(e) => setSplit(i, { values: e.target.value })} placeholder="3" className={`${INPUT} w-32 font-mono`} data-testid={`economy-split-values-${i}`} />
                  </label>
                </div>
                <SegmentPicker base={base} picked={d.segments} onChange={(segments) => setSplit(i, { segments })} testid={`economy-split-segments-${i}`} />
              </div>
            ))}
            <button type="button" className={`${BUTTON} self-start`} onClick={() => patch({ splits: [...plan.splits, createSplit(plan.splits.length + 1)] })} data-testid="economy-split-add">
              Add a mode split
            </button>
          </div>
        </Card>

        {aside}
      </div>

      <Card
        title={<StepTitle n={4} text={`${result.segments.length} segments`} />}
        subtitle="Names put a specific's tag before the mode: Disco_BW_0_9_OOC_Mode_0_3 (this app's order)."
        action={
          <span className="flex flex-wrap items-center gap-2">
            {action}
            <CopyButton text={result.errors.length || !result.segments.length ? '' : planTable(result.segments)} label="Copy as a table" data-testid="economy-seg-copy" />
          </span>
        }
      >
        <div className="flex flex-col gap-2">
          {result.errors.map((e) => (
            <p key={e} className="rounded-lg bg-rose-50 px-2.5 py-1 text-sm text-rose-800" data-plan-error>
              {e}
            </p>
          ))}
          {result.warnings.map((w) => (
            <p key={w} className="rounded-lg bg-amber-50 px-2.5 py-1 text-sm text-amber-800" data-plan-warning>
              {w}
            </p>
          ))}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" data-testid="economy-seg-table">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={TH}>Name</th>
                  <th className={TH}>Key</th>
                  <th className={TH}>Condition</th>
                </tr>
              </thead>
              <tbody>
                {result.segments.map((s) => (
                  <tr key={s.key} className="border-b border-slate-100 align-top text-sm" data-segment={s.name}>
                    <td className={`${TD} whitespace-nowrap font-medium text-slate-800`}>{s.name}</td>
                    <td className={`${TD} whitespace-nowrap font-mono text-[12.5px] text-slate-600`}>{s.key}</td>
                    <td className={`${TD} ${MONO} text-slate-700`}>{s.condition || <span className="font-sans text-slate-400">every player - no condition</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  )
}

function StepTitle({ n, text }) {
  return (
    <span className="flex items-center gap-2">
      <span className={STEP}>{n}</span>
      {text}
    </span>
  )
}

// The base segments to pick from, as numbered chips; "All" and "None" a click away.
function SegmentPicker({ base, picked, onChange, testid }) {
  const set = new Set(picked)
  const toggle = (i) => onChange(set.has(i) ? picked.filter((x) => x !== i) : [...picked, i].sort((a, b) => a - b))
  return (
    <div className="flex flex-col gap-1" data-testid={testid}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Segments it applies to</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {base.map((b) => (
          <button key={b.index} type="button" aria-pressed={set.has(b.index)} onClick={() => toggle(b.index)} title={b.name} data-pick={b.index} className={`rounded-lg px-2 py-0.5 text-xs font-semibold ring-1 transition-colors ${set.has(b.index) ? 'bg-purple-600 text-white ring-purple-600' : 'bg-white text-slate-600 ring-slate-200 hover:text-purple-700'}`}>
            {b.index + 1}. {b.min}-{b.max ?? 'Plus'}
          </button>
        ))}
        <button type="button" className="px-1 text-xs font-semibold text-purple-700 hover:underline" onClick={() => onChange(base.map((b) => b.index))} data-pick="all">
          All
        </button>
        <button type="button" className="px-1 text-xs font-semibold text-slate-500 hover:underline" onClick={() => onChange([])} data-pick="none">
          None
        </button>
      </div>
    </div>
  )
}

// The parts of a condition - progression in an event, balance, level - joined with && (economist: "they are
// added up with &&"). Each part: what it checks, the event id when it needs one, a comparison and a number.
const DEFAULT_VALUE = { 'dm-progression': 95, 'merge-progression': 95, balance: 2, level: 519, winrate: 0.9, 'chef-dishes': 10 }
const DEFAULT_OP = { 'dm-progression': '>', 'merge-progression': '>', balance: '<', level: '>', winrate: '>', 'chef-dishes': '>' }
const newPart = (kind = 'balance') => ({ kind, eventId: '', cohortId: '', days: 7, op: DEFAULT_OP[kind] ?? '>', value: DEFAULT_VALUE[kind] ?? null })
const VALUE_LABEL = { '%': '%', level: 'Level', allowance: 'Allowance', share: 'Share (0-1)', dishes: 'Dishes' }

function PartsEditor({ parts, onChange, prefix }) {
  const set = (i, patch) => onChange(parts.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  return (
    <div className="flex flex-col gap-2">
      {parts.map((p, i) => {
        const def = conditionPart(p.kind)
        const { problems } = partCondition(p)
        return (
          <div key={i} className="flex flex-col gap-1" data-part={`${prefix}-${i}`}>
            <div className="flex flex-wrap items-end gap-2">
              <button type="button" aria-label={`Remove part ${i + 1}`} title="Remove this part" disabled={parts.length === 1} className={`${REMOVE} mb-0.5`} onClick={() => onChange(parts.filter((_, j) => j !== i))}>
                <Trash2 size={14} />
              </button>
              <span className="mb-1.5 w-5 font-mono text-xs font-semibold text-slate-500">{i > 0 ? '&&' : ''}</span>
              <label className={LABEL}>
                Checks
                <select value={p.kind} onChange={(e) => set(i, newPart(e.target.value))} className={`${INPUT} w-48`} data-testid={`economy-part-kind-${prefix}-${i}`}>
                  {CONDITION_PARTS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              {def?.needsEvent && (
                <label className={LABEL}>
                  Event id
                  <input value={p.eventId} onChange={(e) => set(i, { eventId: e.target.value.trim() })} placeholder="57634" inputMode="numeric" className={`${INPUT} w-28 font-mono`} data-testid={`economy-part-event-${prefix}-${i}`} />
                </label>
              )}
              {def?.needsCohort && (
                <label className={LABEL}>
                  The player is
                  <select value={p.negate ? 'not' : 'in'} onChange={(e) => set(i, { negate: e.target.value === 'not' })} className={`${INPUT} w-28`} data-testid={`economy-part-negate-${prefix}-${i}`}>
                    <option value="in">in</option>
                    <option value="not">not in</option>
                  </select>
                </label>
              )}
              {def?.needsCohort && (
                <label className={LABEL}>
                  Cohort id
                  <input value={p.cohortId ?? ''} onChange={(e) => set(i, { cohortId: e.target.value.trim() })} placeholder="1234" inputMode="numeric" className={`${INPUT} w-28 font-mono`} data-testid={`economy-part-cohort-${prefix}-${i}`} />
                </label>
              )}
              {def?.needsDays && (
                <label className={LABEL}>
                  Last days
                  <Num aria-label={`Part ${i + 1}: days`} value={p.days ?? 7} allowEmpty min={1} integer onCommit={(v) => set(i, { days: v })} className="w-16" data-testid={`economy-part-days-${prefix}-${i}`} />
                </label>
              )}
              {!def?.boolean && (
                <>
                  <label className={LABEL}>
                    Is
                    <select value={p.op} onChange={(e) => set(i, { op: e.target.value })} className={`${INPUT} w-28`} data-testid={`economy-part-op-${prefix}-${i}`}>
                      {COMPARISONS.map((c) => (
                        <option key={c.op} value={c.op}>
                          {c.words}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={LABEL}>
                    {VALUE_LABEL[def?.unit] ?? 'Value'}
                    <Num aria-label={`Part ${i + 1}: ${def?.unit}`} value={p.value} allowEmpty max={def?.max ?? Infinity} integer={!!def?.whole} onCommit={(v) => set(i, { value: v })} className="w-24" data-testid={`economy-part-value-${prefix}-${i}`} />
                  </label>
                </>
              )}
            </div>
            {problems.length > 0 && (
              <p className="pl-14 text-xs text-slate-500" data-part-problems={`${prefix}-${i}`}>
                {problems.join(' ')}
              </p>
            )}
          </div>
        )
      })}
      <button type="button" className="self-start text-xs font-semibold text-purple-700 hover:underline" onClick={() => onChange([...parts, newPart('balance')])} data-testid={`economy-part-add-${prefix}`}>
        + Add a part (&amp;&amp;)
      </button>
    </div>
  )
}

// READ A CONDITION: any segment condition, in words, with what is wrong or not known.
function ReadCard() {
  const [text, setText] = useState('')
  const result = text.trim() ? readCondition(text) : null
  return (
    <Card title="Read a condition" subtitle="Paste a segment condition from the game: it is said in words, and a function the app does not know is named.">
      <div className="flex flex-col gap-3" data-testid="economy-seg-read">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="fn_DiamondMine_Progression(57634U) > 95" aria-label="Condition to read" className={`${INPUT} font-mono text-[12.5px]`} data-testid="economy-seg-read-input" />
        {result && (
          <div className="flex flex-col gap-1.5" data-ok={result.ok ? 'yes' : 'no'} data-testid="economy-seg-read-result">
            {result.clauses.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-slate-700" data-testid="economy-seg-read-words">
                {result.clauses.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
            {result.issues.map((i) => (
              <p key={i.text} className={`rounded-lg px-2.5 py-1 text-sm ${i.level === 'error' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'}`} data-level={i.level}>
                {i.text}
              </p>
            ))}
            {result.ok && !result.issues.length && <p className="text-xs text-emerald-700">Readable, and every function in it is known.</p>}
          </div>
        )}
      </div>
    </Card>
  )
}

// THE FUNCTIONS THE APP KNOWS (lib/economy/segmentFunctions.js), each as the economist explained it.
function FunctionsCard() {
  return (
    <Card title="Functions the app knows" subtitle="What a segment condition is made of. Each was explained in chat; a function not here is named when a condition is read.">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" data-dense data-testid="economy-seg-functions">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={TH}>Function</th>
              <th className={TH}>Returns</th>
              <th className={TH}>Example</th>
            </tr>
          </thead>
          <tbody>
            {SEGMENT_FUNCTIONS.map((f) => (
              <tr key={f.name} className="border-b border-slate-100 align-top text-sm" data-seg-function={f.name}>
                <td className={TD}>
                  <span className="font-medium text-slate-800">{f.label}</span>
                  <TaughtMark taught={f} />
                  <div className={`${MONO} text-slate-500`}>
                    {f.form === 'value' ? f.name : `${f.name}(${f.args.map((a) => (a.kind === 'eventId' ? '<event id>U' : a.kind === 'days' ? '<days>' : a.name)).join(',')})`}
                  </div>
                </td>
                <td className={`${TD} text-slate-700`}>
                  {f.returns}, in {f.unit}
                  {f.open && <div className="text-[11px] text-amber-800">Not confirmed: {f.open}</div>}
                </td>
                <td className={`${TD} ${MONO} text-slate-600`}>{f.example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500" data-testid="economy-seg-modes" data-note>
        The modes and their multipliers (the 1m,2m,4m,8m of Brut Wins): {MODE_MULTIPLIERS.map((m) => `mode ${m.mode} x${m.multiplier}`).join(', ')}. A Net Win is a level won; a Brut Win is a Net Win x the multiplier of its mode.
      </p>
    </Card>
  )
}
