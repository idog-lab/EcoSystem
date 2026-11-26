import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../platform/api/client'
import { Btn, Label, Note, Num, Panel, Table, Text } from './kit'
import { fmt, td } from './format'
import { usePuzzle } from './shared'

type LiveRun = { id: string; eventId: string; revision: number | null; effectiveFrom: string; note: string; by: string }
type Result = { id: string; eventId: string; segment: number | null; metric: string; value: number | null; sampleSize: number | null; population: string; windowStart: string; windowEnd: string; source: string; liveRevisions: { revision: number }[] }

const TARGETS = [
  ['revshareFinished', 'Revshare finished'],
  ['payingFinished', 'Paying users finished'],
  ['revshareBeforeWeekend', 'Revshare finished before weekend'],
  ['fuBeforeWeekend', 'FU before weekend'],
] as const

const CSV_HEAD = 'eventId,segment,metric,value,sampleSize,population,windowStart,windowEnd,source,refreshedAt'

export function Optimize() {
  const { ev, edit, docId, revision, base } = usePuzzle()
  const docBase = base && docId ? `${base}/${docId}` : null
  const [runs, setRuns] = useState<LiveRun[]>([])
  const [results, setResults] = useState<Result[]>([])
  const [runFrom, setRunFrom] = useState('')
  const [runRev, setRunRev] = useState<number | null>(revision)
  const [runNote, setRunNote] = useState('')
  const [csv, setCsv] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    if (!docBase) return
    const [a, b] = await Promise.all([api<{ liveRuns: LiveRun[] }>(`${docBase}/live-runs`), api<{ results: Result[] }>(`${docBase}/results`)])
    if (a.ok) setRuns(a.data.liveRuns)
    if (b.ok) setResults(b.data.results)
  }, [docBase])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading from the server
    void load()
  }, [load])

  const addRun = async (ended: boolean) => {
    if (!docBase) return
    if (!ev.optimize.eventId) return setMsg('Type the game\'s event ID first.')
    if (!runFrom) return setMsg('When did it start running?')
    const r = await api(`${docBase}/live-runs`, { method: 'POST', body: { eventId: ev.optimize.eventId, revision: ended ? null : runRev, effectiveFrom: `${runFrom}:00Z`, note: runNote } })
    setMsg(r.ok ? 'Recorded.' : r.message)
    void load()
  }

  const importCsv = async () => {
    if (!docBase) return
    const lines = csv.trim().split(/\r?\n/).filter(Boolean)
    const head = lines[0]?.split(',').map((s) => s.trim())
    if (head?.join(',') !== CSV_HEAD) return setMsg(`The first line has to be: ${CSV_HEAD}`)
    const rows = lines.slice(1).map((l) => {
      const c = l.split(',').map((s) => s.trim())
      const n = (s: string) => (s === '' ? null : Number(s))
      return { eventId: c[0]!, segment: n(c[1]!), metric: c[2]!, value: n(c[3]!), sampleSize: n(c[4]!), population: c[5]!, windowStart: c[6]!, windowEnd: c[7]!, source: c[8]!, refreshedAt: c[9]! }
    })
    const r = await api<{ added: number; unlinked: number }>(`${docBase}/results`, { method: 'POST', body: { rows } })
    setMsg(r.ok ? `${r.data.added} results stored; ${r.data.unlinked} had no recorded live run and are kept out of any learning.` : r.message)
    if (r.ok) setCsv('')
    void load()
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2" data-testid="optimize">
      <div className="flex flex-col gap-4">
        <Panel title="Targets" subtitle="Saved with the event, beside its Wins for Economy and the whole configuration.">
          <div className="grid gap-3 sm:grid-cols-2">
            {TARGETS.map(([k, label]) => (
              <label key={k}>
                <Label>{label}</Label>
                <Num testId={`target-${k}`} allowBlank scale={100} suffix="%" min={0} max={1} value={ev.optimize.targets[k]} onChange={(v) => edit((e) => void (e.optimize.targets[k] = v))} />
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label>
              <Label hint="A player is FU (frustrated) when their economic-effort completion is inside this range at the weekend cutoff.">FU range: from</Label>
              <Num testId="fu-from" scale={100} suffix="%" min={0} max={1} value={ev.optimize.fuRange.from} onChange={(v) => edit((e) => void (e.optimize.fuRange.from = v!))} />
            </label>
            <label>
              <Label>to</Label>
              <Num testId="fu-to" scale={100} suffix="%" min={0} max={1} value={ev.optimize.fuRange.to} onChange={(v) => edit((e) => void (e.optimize.fuRange.to = v!))} />
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-500" data-note>
            FU before weekend = the share of the measured players INSIDE the range at the weekend cutoff ({ev.setup.weekendCutoff ? ev.setup.weekendCutoff.replace('T', ' ') + ' UTC' : 'not set yet'}) - not everyone who ever passed through it.
            The other metrics, their populations and denominators are Looker's; their field mapping is not connected yet.
          </p>
        </Panel>
        <Panel title="Recommendations">
          <Note>
            No recommendation yet. One needs completed events with a recorded live revision, their Wins for Economy and Looker results; older events from the sheets have no Wins for Economy and are
            never used as examples. Until there are enough comparable events, tune by hand.
          </Note>
        </Panel>
      </div>
      <div className="flex flex-col gap-4">
        <Panel title="What ran live" subtitle="Record which saved revision really ran, from when - a change during the event is a new line.">
          <label className="block">
            <Label>Game event ID</Label>
            <Text testId="event-id" value={ev.optimize.eventId} onChange={(v) => edit((e) => void (e.optimize.eventId = v.trim()))} />
          </label>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label>
              <Label>Revision</Label>
              <Num width="w-16" digits={0} min={1} value={runRev} onChange={(v) => setRunRev(v)} />
            </label>
            <label>
              <Label>Live from (UTC)</Label>
              <input type="datetime-local" className="rounded-lg border border-slate-200 px-2 py-1 text-sm" value={runFrom} onChange={(e) => setRunFrom(e.target.value)} />
            </label>
            <label className="min-w-[10rem] flex-1">
              <Label>Note</Label>
              <Text value={runNote} onChange={setRunNote} />
            </label>
            <Btn small onClick={() => addRun(false)} disabled={!docBase}>Record</Btn>
            <Btn small variant="ghost" onClick={() => addRun(true)} disabled={!docBase}>Record the end</Btn>
          </div>
          {msg && <p className="mt-2 text-xs text-slate-600">{msg}</p>}
          <Table head={['Event', 'Revision', 'From', 'By', 'Note']}>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className={td}>{r.eventId}</td>
                <td className={td}>{r.revision ?? 'ended'}</td>
                <td className={td}>{r.effectiveFrom.replace('T', ' ').slice(0, 16)}</td>
                <td className={td}>{r.by}</td>
                <td className={td}>{r.note}</td>
              </tr>
            ))}
          </Table>
        </Panel>
        <Panel title="Results (Looker or a file)" subtitle="Paste rows; each is joined to the live revisions of its window when stored.">
          <textarea data-testid="results-csv" rows={4} className="w-full rounded-lg border border-slate-200 px-2 py-1 font-mono text-xs" placeholder={CSV_HEAD} value={csv} onChange={(e) => setCsv(e.target.value)} />
          <div className="mt-2">
            <Btn small onClick={importCsv} disabled={!docBase || !csv.trim()}>Store results</Btn>
          </div>
          <Table head={['Event', 'Seg', 'Metric', 'Value', 'Players', 'Window', 'Live revision']}>
            {results.map((r) => (
              <tr key={r.id}>
                <td className={td}>{r.eventId}</td>
                <td className={td}>{r.segment ?? 'all'}</td>
                <td className={td}>{r.metric}</td>
                <td className={td}>{fmt(r.value, 4)}</td>
                <td className={td}>{fmt(r.sampleSize)}</td>
                <td className={td}>{r.windowStart.slice(0, 10)} → {r.windowEnd.slice(0, 10)}</td>
                <td className={td}>{r.liveRevisions.length ? r.liveRevisions.map((l) => l.revision).join(', ') : <span className="text-amber-700">none recorded</span>}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      </div>
    </div>
  )
}
