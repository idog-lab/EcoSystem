import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../platform/api/client'
import { REGULAR_PIECES } from '../engine/model'
import { positionAt, readProgress, weekendDay, type ProgressProvider, type QuantileRow } from '../engine/simulator'
import { Btn, Choice, Label, Note, Num, Pill, Text } from './kit'
import { fmt, pct } from './format'
import { dayLabel, usePuzzle } from './shared'

const KEY = 'puzzle-progress-quantiles'
type Mode = 'data' | 'manual'

/**
 * The side window: a player of a segment, at a percentile of progression
 * WITHIN that segment, on a day. The percentile becomes economic-effort
 * progress only through imported data; without it the window says so and
 * offers a manual scenario, labelled as an assumption. Opening it, or moving
 * the day or percentile, never changes prices, the piece order or the config.
 */
export function SimulatorPanel({ onClose, wide, onWide }: { onClose: () => void; wide: boolean; onWide: () => void }) {
  const { ev, results, base } = usePuzzle()
  const workspace = base?.replace(/\/documents$/, '') ?? null
  const [segment, setSegment] = useState(1)
  const [percentile, setPercentile] = useState(50)
  const [day, setDay] = useState(Math.min(weekendDay(ev) ?? 1, ev.setup.days))
  const [mode, setMode] = useState<Mode>('data')
  const [manual, setManual] = useState(0.5)
  const [provider, setProvider] = useState<ProgressProvider | null>(null)
  const [provRev, setProvRev] = useState(0)
  const [importText, setImportText] = useState('')
  const [meta, setMeta] = useState({ source: '', asOf: '', population: '' })
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    if (!workspace) return
    const r = await api<{ assumptionSet: { payload: Omit<ProgressProvider, 'kind'>; revision: number } }>(`${workspace}/assumptions/${KEY}`)
    if (r.ok) {
      setProvider({ kind: 'historical-quantiles', ...r.data.assumptionSet.payload })
      setProvRev(r.data.assumptionSet.revision)
    }
  }, [workspace])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading from the server
    void load()
  }, [load])

  const seg = results.regular[segment - 1]!
  const reading = mode === 'manual' ? ({ status: 'manual', progress: manual, note: 'A scenario you typed - not data, not a prediction.' } as const) : readProgress(provider, segment, day, percentile)
  const pos = reading.status === 'unavailable' ? null : positionAt(ev, seg, seg.rewards, day, reading.progress)
  const wd = weekendDay(ev)

  const importRows = async () => {
    if (!workspace) return
    const rows: QuantileRow[] = importText
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.trim() && !/^segment/i.test(l))
      .map((l) => {
        const [s, d, p, v] = l.split(/[,\t]/).map((x) => Number(x.trim().replace(/%$/, '')))
        return { segment: s!, day: d!, percentile: p!, progress: v! > 1 ? v! / 100 : v! }
      })
    const r = await api(`${workspace}/assumptions/${KEY}`, { method: 'PUT', body: { expectedRevision: provRev, schemaVersion: 1, payload: { ...meta, rows } } })
    setMsg(r.ok ? `${rows.length} rows stored.` : r.message)
    if (r.ok) {
      setImportText('')
      void load()
    }
  }

  return (
    <aside data-testid="simulator" className={`flex flex-col gap-3 overflow-y-auto border-l border-white bg-white/95 p-4 shadow-xl ${wide ? 'w-[42rem]' : 'w-[26rem]'} max-w-full`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-slate-800">Player simulator</h2>
        <span className="flex gap-1">
          <Btn small variant="ghost" onClick={onWide}>{wide ? 'Narrow' : 'Wider'}</Btn>
          <Btn small variant="ghost" onClick={onClose} testId="simulator-close">Close</Btn>
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label>
          <Label>Segment</Label>
          <Num testId="sim-segment" width="w-16" min={1} max={9} digits={0} value={segment} onChange={(v) => setSegment(Math.round(v!))} />
        </label>
        <label>
          <Label hint="The player's place among the players of THIS segment by progression - not % complete, not a brut-wins percentile.">Percentile in segment</Label>
          <Num testId="sim-percentile" width="w-16" min={0} max={100} digits={0} value={percentile} onChange={(v) => setPercentile(Math.round(v!))} />
        </label>
        <label>
          <Label>Day (end of day)</Label>
          <Num testId="sim-day" width="w-16" min={1} max={ev.setup.days} digits={0} value={day} onChange={(v) => setDay(Math.round(v!))} />
        </label>
      </div>
      <input type="range" min={1} max={ev.setup.days} value={day} onChange={(e) => setDay(Number(e.target.value))} aria-label="Day" />
      <p className="text-xs text-slate-500">{dayLabel(ev.setup.start, day)}, end of the day{wd === day ? ' - the weekend cutoff day' : ''}.</p>
      <Choice value={mode} onChange={setMode} options={[{ value: 'data', label: 'From data' }, { value: 'manual', label: 'Manual scenario' }]} />
      {mode === 'manual' && (
        <label>
          <Label>Assumed economic-effort progress</Label>
          <Num testId="sim-manual" scale={100} suffix="%" min={0} max={1} value={manual} onChange={(v) => setManual(v!)} />
        </label>
      )}
      {reading.status === 'unavailable' && (
        <Note tone="amber" testId="sim-unavailable">
          No prediction: {reading.reason} A percentile is not a completion percentage, so nothing is guessed. Import progression data below, or use a manual scenario.
        </Note>
      )}
      {reading.status === 'historical' && (
        <Note>
          From data: {reading.source} ({reading.asOf}), {reading.population}. {reading.note}
        </Note>
      )}
      {reading.status === 'manual' && <Note tone="amber">{reading.note}</Note>}
      {pos && (
        <div data-testid="sim-result" className="flex flex-col gap-2">
          <div className="grid grid-cols-6 gap-1.5">
            {REGULAR_PIECES.map((n, i) => {
              const board = i + 1
              const done = board <= pos.boardsDone
              const current = board === pos.currentBoard
              return (
                <div key={board} className={`rounded-xl border p-1.5 text-center text-[11px] ${done ? 'border-emerald-200 bg-emerald-50' : current ? 'border-purple-300 bg-purple-50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="font-semibold">Board {board}</div>
                  <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${[3, 3, 4, 4, 5, 6][i]}, minmax(0,1fr))` }}>
                    {Array.from({ length: n }, (_, k) => (
                      <span key={k} className={`h-1.5 rounded-sm ${done || (current && k < pos.piecesDoneOnBoard) ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          <table className="text-xs" data-dense>
            <tbody>
              <tr><td className="pr-3 text-slate-500">Economic effort done</td><td className="font-semibold" data-testid="sim-progress">{pct(pos.progress)}</td></tr>
              <tr><td className="pr-3 text-slate-500">Planned by this day</td><td>{pct(pos.plannedEnd)} ({pos.vsPlan >= 0 ? '+' : ''}{pct(pos.vsPlan)})</td></tr>
              <tr><td className="pr-3 text-slate-500">Board</td><td>{pos.reachedRc ? 'all six done - Recompletion reached' : `board ${pos.currentBoard}, ${pos.piecesDoneOnBoard} of ${pos.piecesOnBoard} pieces`}</td></tr>
              <tr><td className="pr-3 text-slate-500">DR paid for pieces</td><td>{fmt(pos.drSpent)}</td></tr>
              <tr><td className="pr-3 text-slate-500">dr-puzzle from rewards</td><td>{fmt(pos.drFromRewards)}</td></tr>
              <tr><td className="pr-3 text-slate-500">Rewards collected</td><td>{pos.rewards.length ? `boards ${pos.rewards.map((r) => r.board).join(', ')} (worth ${fmt(pos.rewards.reduce((a, r) => a + r.worth, 0), 2)})` : 'none yet'}</td></tr>
              <tr>
                <td className="pr-3 text-slate-500">FU ({pct(ev.optimize.fuRange.from, 0)}-{pct(ev.optimize.fuRange.to, 0)})</td>
                <td>
                  {pos.fu == null ? 'no weekend cutoff set' : pos.fu.measured ? <Pill tone={pos.fu.state === 'within' ? 'red' : 'green'}>{pos.fu.state} the range at the weekend cutoff</Pill> : <span className="text-slate-500">{pos.fu.state} the range (FU is measured on day {wd} only)</span>}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="text-[11px] text-slate-500" data-note>
            Assumes pieces are bought in the order their effort comes, at the prices of the config; DR not yet spent is not shown as progress.
          </p>
        </div>
      )}
      <details className="mt-2 rounded-2xl border border-slate-200 px-3 py-2" data-collapsible>
        <summary className="cursor-pointer text-xs font-semibold text-slate-600">Progression data ({provider ? `${provider.rows.length} rows from ${provider.source}` : 'none'})</summary>
        <p className="mt-2 text-xs text-slate-500" data-note>
          Rows of segment, day, percentile, progress (economic effort at the end of the day) from a past event - shared with the workspace and versioned. Only exact rows are used; nothing is filled in between.
        </p>
        <div className="mt-2 grid gap-2">
          <Text placeholder="Source (event, query)" value={meta.source} onChange={(v) => setMeta({ ...meta, source: v })} />
          <Text placeholder="Data as of (date)" value={meta.asOf} onChange={(v) => setMeta({ ...meta, asOf: v })} />
          <Text placeholder="Population" value={meta.population} onChange={(v) => setMeta({ ...meta, population: v })} />
          <textarea rows={4} className="rounded-lg border border-slate-200 px-2 py-1 font-mono text-xs" placeholder="segment,day,percentile,progress" value={importText} onChange={(e) => setImportText(e.target.value)} />
          <Btn small onClick={importRows} disabled={!importText.trim() || !meta.source || !meta.asOf || !meta.population}>Store data</Btn>
          {msg && <span className="text-xs text-slate-600">{msg}</span>}
        </div>
      </details>
    </aside>
  )
}
