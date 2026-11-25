import { useState } from 'react'
import Card from '../../components/ui/Card'
import { STANDARD_WEIGHTS, bandsFromCuts, buildSegments, checkBands } from '../../lib/economy/segments'
import { COMPARISONS, PROGRESSION_FEATURES, SEGMENT_FUNCTIONS, progressionCondition, readCondition } from '../../lib/economy/segmentFunctions'
import { CopyButton, INPUT, MONO, Num, TD, TH, TaughtMark } from './economyUi'

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
                    {f.name}({f.args.map((a) => (a.kind === 'eventId' ? '<event id>U' : a.kind === 'days' ? '<days>' : a.name)).join(',')})
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
    </Card>
  )
}

// A PROGRESSION CONDITION: a player's progression in a Diamond Mine or Merge event, by the event's id.
function ProgressionCard() {
  const [feature, setFeature] = useState('diamond-mine')
  const [eventId, setEventId] = useState('')
  const [op, setOp] = useState('>')
  const [percent, setPercent] = useState(95)
  const { condition, problems } = progressionCondition({ feature, eventId, op, percent })
  const words = condition ? readCondition(condition).clauses[0] : ''
  return (
    <Card title="Progression in an event" subtitle="Players by how far they got in a Diamond Mine or Merge event, in %. What matters is the event's id.">
      <div className="flex flex-col gap-3" data-testid="economy-seg-progression">
        <div className="flex flex-wrap items-end gap-3">
          <label className={LABEL}>
            Feature
            <select value={feature} onChange={(e) => setFeature(e.target.value)} className={`${INPUT} w-40`} data-testid="economy-prog-feature">
              {PROGRESSION_FEATURES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Event id
            <input value={eventId} onChange={(e) => setEventId(e.target.value.trim())} placeholder="57634" inputMode="numeric" className={`${INPUT} w-32 font-mono`} data-testid="economy-prog-event" />
          </label>
          <label className={LABEL}>
            Progression
            <select value={op} onChange={(e) => setOp(e.target.value)} className={`${INPUT} w-28`} data-testid="economy-prog-op">
              {COMPARISONS.map((c) => (
                <option key={c.op} value={c.op}>
                  {c.words}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            %
            <Num aria-label="Progression %" value={percent} allowEmpty max={100} onCommit={setPercent} className="w-20" data-testid="economy-prog-percent" />
          </label>
        </div>
        {condition ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <code className={`${MONO} rounded-lg bg-slate-50 px-2 py-1 text-slate-800`} data-testid="economy-prog-condition">
                {condition}
              </code>
              <CopyButton text={condition} label="Copy" data-testid="economy-prog-copy" />
            </div>
            <span className="text-sm text-slate-600">{words}</span>
          </div>
        ) : (
          <p className="text-sm text-slate-500" data-testid="economy-prog-problems">
            {problems.join(' ')}
          </p>
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
        <ProgressionCard />
        <ReadCard />
      </div>
      <FunctionsCard />
    </div>
  )
}
