import { useMemo, useState } from 'react'
import { computeAll } from '../engine/compute'
import { buildExportPlan, TEMPLATES, type Cell, type TemplateKind } from '../engine/exportPlan'
import { Btn, Choice, Label, Note, Panel } from './kit'
import { usePuzzle } from './shared'

/** The output exactly as it would be written: pick a tab of the template, see its cells. */
export function ConfigPreview() {
  const { ev, results } = usePuzzle()
  const plan = useMemo(() => buildExportPlan(ev, results), [ev, results])
  const [kind, setKind] = useState<TemplateKind>(plan.template ?? 'price-cut')
  const shownPlan = useMemo(() => {
    if (plan.template === kind) return plan
    const other = { ...ev, setup: { ...ev.setup, mode: kind } }
    return buildExportPlan(other, computeAll(other))
  }, [plan, kind, ev])
  const sheets = TEMPLATES[kind].sheets
  const [sheet, setSheet] = useState('Seg 1')
  const writes = shownPlan.template ? shownPlan.writes.filter((w) => w.range.startsWith(`'${sheet}'!`)) : []
  const [copied, setCopied] = useState('')
  const tsv = (values: Cell[][]) => values.map((r) => r.map((c) => String(c).replace(/\t/g, ' ')).join('\t')).join('\n')
  return (
    <div className="flex flex-col gap-4" data-testid="config-preview">
      <Panel title="Config preview" subtitle="The cells an export writes into the template, tab by tab. Everything else in the copy stays as the template has it.">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <Label>Template</Label>
            <Choice value={kind} onChange={setKind} options={[{ value: 'price-cut', label: 'Price Cut' }, { value: 'maleficent', label: 'Maleficent' }]} />
          </div>
          <label>
            <Label>Tab</Label>
            <select data-testid="preview-sheet" className="rounded-lg border border-slate-200 px-2 py-1 text-sm" value={sheet} onChange={(e) => setSheet(e.target.value)}>
              {sheets.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        {plan.template !== kind && <Note tone="amber">This event is {ev.setup.mode === 'standard' ? 'Standard' : ev.setup.mode === 'price-cut' ? 'Price Cut' : 'Maleficent'}: this is how it would look in the other template.</Note>}
      </Panel>
      {writes.length === 0 ? (
        <Note>Nothing is written to "{sheet}": it is kept exactly as the template has it.</Note>
      ) : (
        writes.map((w) => (
          <Panel key={w.range} title={w.range} action={<Btn small onClick={() => navigator.clipboard?.writeText(tsv(w.values)).then(() => setCopied(w.range))}>{copied === w.range ? 'Copied' : 'Copy'}</Btn>}>
            <div className="overflow-x-auto">
              <table className="border-collapse font-mono text-[11px]" data-dense>
                <tbody>
                  {w.values.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j} className={`max-w-[28rem] border border-slate-100 px-1.5 py-0.5 align-top ${typeof c === 'number' ? 'text-right text-slate-800' : 'text-slate-600'} [overflow-wrap:anywhere]`}>
                          {c === '' ? <span className="text-slate-300">·</span> : String(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ))
      )}
    </div>
  )
}
