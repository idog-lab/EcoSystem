import { useState } from 'react'
import Card from '../../components/ui/Card'
import { STANDARD_WEIGHTS, bandsFromCuts, buildSegments, checkBands } from '../../lib/economy/segments'
import { Trash2 } from 'lucide-react'
import { COMPARISONS, CONDITION_PARTS, MODE_MULTIPLIERS, SEGMENT_FUNCTIONS, buildCondition, conditionPart, partCondition, readCondition } from '../../lib/economy/segmentFunctions'
import { BUTTON, CopyButton, INPUT, MONO, Num, TD, TH, TaughtMark } from './economyUi'

const LABEL = 'flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500'

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

// BUILD A CONDITION: parts - progression in an event, balance, level - joined with && (economist: "they are
// added up with &&"). Each part: what it checks, the event id when it needs one, a comparison and a number.
const DEFAULT_VALUE = { 'dm-progression': 95, 'merge-progression': 95, balance: 2, level: 519 }
const DEFAULT_OP = { 'dm-progression': '>', 'merge-progression': '>', balance: '<', level: '>' }
const newPart = (kind = 'balance') => ({ kind, eventId: '', op: DEFAULT_OP[kind], value: DEFAULT_VALUE[kind] })

function ConditionCard() {
  const [parts, setParts] = useState([newPart('dm-progression')])
  const set = (i, patch) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const { condition } = buildCondition(parts)
  const words = condition ? readCondition(condition).clauses : []
  return (
    <Card title="Build a condition" subtitle="Progression in an event, balance, level: each part is checked, and the parts are joined with &&.">
      <div className="flex flex-col gap-3" data-testid="economy-seg-builder">
        {parts.map((p, i) => {
          const def = conditionPart(p.kind)
          const { problems } = partCondition(p)
          return (
            <div key={i} className="flex flex-col gap-1 border-b border-slate-100 pb-2" data-part={i}>
              <div className="flex flex-wrap items-end gap-2">
                <button type="button" aria-label={`Remove part ${i + 1}`} title="Remove this part" disabled={parts.length === 1} className="mb-0.5 grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}>
                  <Trash2 size={14} />
                </button>
                <span className="mb-1.5 w-5 font-mono text-xs font-semibold text-slate-500">{i > 0 ? '&&' : ''}</span>
                <label className={LABEL}>
                  Checks
                  <select value={p.kind} onChange={(e) => set(i, newPart(e.target.value))} className={`${INPUT} w-52`} data-testid={`economy-part-kind-${i}`}>
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
                    <input value={p.eventId} onChange={(e) => set(i, { eventId: e.target.value.trim() })} placeholder="57634" inputMode="numeric" className={`${INPUT} w-28 font-mono`} data-testid={`economy-part-event-${i}`} />
                  </label>
                )}
                <label className={LABEL}>
                  Is
                  <select value={p.op} onChange={(e) => set(i, { op: e.target.value })} className={`${INPUT} w-28`} data-testid={`economy-part-op-${i}`}>
                    {COMPARISONS.map((c) => (
                      <option key={c.op} value={c.op}>
                        {c.words}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={LABEL}>
                  {def?.unit === '%' ? '%' : def?.unit === 'level' ? 'Level' : 'Allowance'}
                  <Num aria-label={`Part ${i + 1}: ${def?.unit}`} value={p.value} allowEmpty max={def?.max ?? Infinity} integer={!!def?.whole} onCommit={(v) => set(i, { value: v })} className="w-24" data-testid={`economy-part-value-${i}`} />
                </label>
              </div>
              {problems.length > 0 && (
                <p className="text-xs text-slate-500" data-part-problems={i}>
                  {problems.join(' ')}
                </p>
              )}
            </div>
          )
        })}
        <button type="button" className={`${BUTTON} self-start`} onClick={() => setParts((ps) => [...ps, newPart('balance')])} data-testid="economy-part-add">
          Add a part (&amp;&amp;)
        </button>
        {condition && (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <code className={`${MONO} rounded-lg bg-slate-50 px-2 py-1 text-slate-800`} data-testid="economy-built-condition">
                {condition}
              </code>
              <CopyButton text={condition} label="Copy" data-testid="economy-built-copy" />
            </div>
            <ul className="list-disc pl-5 text-sm text-slate-600" data-testid="economy-built-words">
              {words.map((w, j) => (
                <li key={j}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
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

// SEGMENT CONDITIONS: a feature's Brut Wins bands as the server's expressions,
// names and keys, from the upper ends typed.
export default function SegmentsTab() {
  const [feature, setFeature] = useState('Disco')
  const [cuts, setCuts] = useState('9, 18, 40, 60, 100, 150, 240')
  const [split, setSplit] = useState(false)
  const [modeSplit, setModeSplit] = useState(3)
  const [weights, setWeights] = useState(STANDARD_WEIGHTS)
  const cutList = cuts.split(/[\s,;]+/).filter(Boolean)
  const badCuts = cutList.filter((c) => !(Number(c) > 0))
  const bands = bandsFromCuts(cutList)
  const issues = checkBands(bands)
  const name = feature.trim().replace(/\s+/g, '_')
  const segments = name ? buildSegments(name, bands, { splitByMode: split, modeSplit, weights: weights.replace(/\s+/g, '') }) : []
  const tsv = ['Name\tKey\tCondition', ...segments.map((s) => `${s.name}\t${s.key}\t${s.condition}`)].join('\n')
  return (
    <div className="flex flex-col gap-4">
      <Card title="A feature's segments" subtitle="Weighted Brut Wins: 0.7 x the last 3 days + 0.3 x the last 14. A band is above its start and at most its end.">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Feature
              <input value={feature} onChange={(e) => setFeature(e.target.value)} className={`${INPUT} w-36`} data-testid="economy-seg-feature" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Band ends
              <input value={cuts} onChange={(e) => setCuts(e.target.value)} className={`${INPUT} w-72`} data-testid="economy-seg-cuts" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500" title="The game-mode weights inside the functions. The standard is 1m,2m,4m,8m.">
              Mode weights
              <input value={weights} onChange={(e) => setWeights(e.target.value)} className={`${INPUT} w-36 font-mono`} data-testid="economy-seg-weights" />
            </label>
            <label className="flex items-center gap-2 pb-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} data-testid="economy-seg-split" />
              Split each band by mode at
            </label>
            <Num aria-label="Mode split" value={modeSplit} min={0.01} onCommit={setModeSplit} className="mb-0.5 w-14" disabled={!split} />
          </div>
          {badCuts.length > 0 && <p className="text-sm text-rose-700">Not a band end: {badCuts.join(', ')}</p>}
          {issues.map((s) => (
            <p key={s} className="text-sm text-rose-700">
              {s}
            </p>
          ))}
          <p className="text-xs text-slate-500" data-note>
            The first band is &quot;at most&quot; its end, the last &quot;above&quot; its start. Names are Feature_BW_min_max (Plus for the last), with _Mode_0_3 or _Mode_3_plus; a key is def_ and the name.
          </p>
        </div>
      </Card>
      <Card title={`${segments.length} segments`} action={<CopyButton text={segments.length ? tsv : ''} label="Copy as a table" data-testid="economy-seg-copy" />}>
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
              {segments.map((s) => (
                <tr key={s.key} className="border-b border-slate-100 align-top text-sm" data-segment={s.name}>
                  <td className={`${TD} whitespace-nowrap font-medium text-slate-800`}>{s.name}</td>
                  <td className={`${TD} whitespace-nowrap font-mono text-[12.5px] text-slate-600`}>{s.key}</td>
                  <td className={`${TD} ${MONO} text-slate-700`}>{s.condition || <span className="font-sans text-slate-400">every player - no condition</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
        <ConditionCard />
        <ReadCard />
      </div>
      <FunctionsCard />
    </div>
  )
}
