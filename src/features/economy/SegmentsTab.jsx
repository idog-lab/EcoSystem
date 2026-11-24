import { useState } from 'react'
import Card from '../../components/ui/Card'
import { STANDARD_WEIGHTS, bandsFromCuts, buildSegments, checkBands } from '../../lib/economy/segments'
import { CopyButton, INPUT, MONO, Num, TD, TH } from './economyUi'

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
    </div>
  )
}
