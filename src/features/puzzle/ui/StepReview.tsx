import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../../platform/api/client'
import { ENGINE_VERSION, computeAll, fingerprint } from '../engine/compute'
import { buildExportPlan, exportTitle, TEMPLATES, type ExportPlan } from '../engine/exportPlan'
import type { PuzzleEvent } from '../engine/model'
import { exportToGoogleSheets, folderIdOf } from '../export/googleExport'
import { Btn, Label, Note, Panel, Pill, Table, Text } from './kit'
import { fmt, td } from './format'
import { changedPaths } from './format'
import { usePuzzle } from './shared'

type ExportRow = { id: string; revision: number; kind: string; target: { url?: string; title?: string }; fingerprint: string; by: string; createdAt: string }

export function StepReview() {
  const { ev, results, docId, revision, dirty, base } = usePuzzle()
  const blocks = results.problems.filter((p) => p.level === 'block')
  const warns = results.problems.filter((p) => p.level === 'warn')
  const plan = useMemo(() => buildExportPlan(ev, results), [ev, results])
  const [exports, setExports] = useState<ExportRow[]>([])
  const [prev, setPrev] = useState<PuzzleEvent | null>(null)
  const [folder, setFolder] = useState('')
  const [name, setName] = useState('')
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'done' | 'error'; text?: string; url?: string }>({ kind: 'idle' })
  const docBase = base && docId ? `${base}/${docId}` : null

  const load = useCallback(async () => {
    if (!docBase) return
    const r = await api<{ exports: ExportRow[] }>(`${docBase}/exports`)
    if (r.ok) setExports(r.data.exports)
    if (revision && revision > 1) {
      const p = await api<{ revision: { payload: PuzzleEvent } }>(`${docBase}/revisions/${revision - 1}`)
      if (p.ok) setPrev(p.data.revision.payload)
    }
  }, [docBase, revision])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading from the server
    void load()
  }, [load])

  const current = fingerprint(ev)
  const changes = prev ? changedPaths(prev, ev) : []
  const canExport = plan.template !== null && plan.problems.length === 0 && !dirty && !!docId && revision != null

  const run = async () => {
    if (plan.template === null || !docBase || revision == null) return
    const id = folderIdOf(folder)
    if (!id) return setState({ kind: 'error', text: 'Paste the Drive folder link (or its id) the file goes to.' })
    setState({ kind: 'busy', text: 'Copying the template and filling it…' })
    try {
      // The plan is rebuilt from the saved event, so what is sent is exactly the revision it names.
      const fresh = buildExportPlan(ev, computeAll(ev)) as ExportPlan
      const out = await exportToGoogleSheets(fresh, id, name.trim() || fresh.title)
      await api(`${docBase}/exports`, {
        method: 'POST',
        body: { revision, kind: 'google-sheets', target: { url: out.url, title: out.title, folderId: id, template: TEMPLATES[fresh.template].url }, engineVersion: ENGINE_VERSION, fingerprint: current, snapshot: fresh },
      })
      setState({ kind: 'done', text: `Created "${out.title}".`, url: out.url })
      void load()
    } catch (e) {
      setState({ kind: 'error', text: (e as Error).message })
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Panel title="Checks" testId="review-checks">
          {blocks.length === 0 && warns.length === 0 && <Note tone="green">Nothing to fix.</Note>}
          {blocks.map((p, i) => (
            <Note key={`b${i}`} tone="red">
              {p.text}
            </Note>
          ))}
          <div className="mt-2 flex flex-col gap-2">
            {warns.map((p, i) => (
              <Note key={`w${i}`} tone="amber">
                {p.text}
              </Note>
            ))}
          </div>
        </Panel>
        <Panel title="Segments side by side">
          <Table head={['Segment', 'Wins', 'Puzzle DR', 'Board 6', 'Rewards worth', 'Targets set']}>
            {results.regular.map((r) => (
              <tr key={r.segment}>
                <td className={td}>{r.segment}</td>
                <td className={td}>{r.winsForEconomy}</td>
                <td className={td}>{fmt(r.totalCost)}</td>
                <td className={td}>{fmt(r.tiers[5]!.cost)}</td>
                <td className={td}>{fmt(r.rewards.reduce((a, x) => a + x.actual, 0), 2)}</td>
                <td className={td}>{r.rewards.filter((x) => x.target != null).length} / 6</td>
              </tr>
            ))}
          </Table>
        </Panel>
        <Panel title={revision ? `Changed since revision ${revision - 1}` : 'Changes'}>
          {!prev ? <p className="text-xs text-slate-500">No earlier revision to compare with.</p> : changes.length === 0 ? <p className="text-xs text-slate-500">Nothing changed.</p> : (
            <ul className="list-disc pl-5 text-xs text-slate-600">
              {changes.slice(0, 40).map((c) => (
                <li key={c} className="font-mono">{c}</li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <div className="flex flex-col gap-4">
        <Panel title="Export to Google Sheets" subtitle="A copy of the approved template of this mode, filled with this event, in a Drive folder you choose. The templates themselves are never changed." testId="review-export">
          {plan.template === null ? (
            <Note tone="amber">{plan.problems[0]}</Note>
          ) : (
            <>
              <p className="text-xs text-slate-600">
                Template: <a className="text-purple-700 underline" href={TEMPLATES[plan.template].url} target="_blank" rel="noreferrer">{plan.template === 'price-cut' ? 'Price Cut' : 'Maleficent'}</a> · {plan.writes.length} ranges
              </p>
              <div className="mt-3 grid gap-3">
                <label>
                  <Label>Drive folder (link or id)</Label>
                  <Text testId="export-folder" value={folder} onChange={setFolder} placeholder="https://drive.google.com/drive/folders/…" />
                </label>
                <label>
                  <Label>File name</Label>
                  <Text testId="export-name" value={name} onChange={setName} placeholder={exportTitle(ev)} />
                </label>
              </div>
              {dirty && <Note tone="amber">Save first: an export is made from a saved revision.</Note>}
              {plan.problems.map((p, i) => (
                <Note key={i} tone="red">
                  {p}
                </Note>
              ))}
              <div className="mt-3 flex items-center gap-3">
                <Btn variant="primary" testId="export-run" disabled={!canExport || state.kind === 'busy'} onClick={run}>
                  Export to Google Sheets
                </Btn>
                {state.text && <span className={`text-xs ${state.kind === 'error' ? 'text-red-600' : 'text-slate-600'}`}>{state.text}</span>}
              </div>
              {state.url && (
                <p className="mt-2 text-sm">
                  <a className="text-purple-700 underline" href={state.url} target="_blank" rel="noreferrer" data-testid="export-link">
                    Open the new sheet
                  </a>
                </p>
              )}
              <p className="mt-3 text-xs text-slate-500" data-note>
                Signs in with Google for Drive and Sheets access. This has not been tried end to end yet; the cells it writes are checked by tests.
              </p>
            </>
          )}
        </Panel>
        <Panel title="Exports of this event">
          {exports.length === 0 ? <p className="text-xs text-slate-500">None yet.</p> : (
            <Table head={['When', 'Revision', 'File', 'Status']}>
              {exports.map((x) => {
                const fresh = x.revision === revision && x.fingerprint === current && !dirty
                return (
                  <tr key={x.id}>
                    <td className={td}>{new Date(x.createdAt).toLocaleString('en-GB')}</td>
                    <td className={td}>{x.revision}</td>
                    <td className={td}>{x.target.url ? <a className="text-purple-700 underline" href={x.target.url} target="_blank" rel="noreferrer">{x.target.title ?? 'sheet'}</a> : x.kind}</td>
                    <td className={td}>{fresh ? <Pill tone="green">Current</Pill> : <Pill tone="amber" title="The event changed after this export.">Out of date</Pill>}</td>
                  </tr>
                )
              })}
            </Table>
          )}
        </Panel>
      </div>
    </div>
  )
}
