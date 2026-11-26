import { useState } from 'react'
import { REGULAR_PIECES, RC_PIECES, uniformProgression, type EventMode } from '../engine/model'
import { effortShares, pieceWorthOf } from '../engine/regular'
import { Choice, Label, Note, Num, Panel, Table, Text, Btn } from './kit'
import { fmt, pct, td, parsePasted } from './format'
import { dayLabel, setDays, setLength, usePuzzle } from './shared'

const MODES: { value: EventMode; label: string; hint: string }[] = [
  { value: 'standard', label: 'Standard', hint: 'Regular prices.' },
  { value: 'price-cut', label: 'Price Cut', hint: 'Boards 5 and 6 cost 15% and 30% more, RC board 3 15% more; rewards unchanged.' },
  { value: 'maleficent', label: 'Maleficent', hint: 'The boss wheel: filling the Boss Bar removes pieces.' },
]

export function StepSetup() {
  const { ev, edit, results } = usePuzzle()
  const s = ev.setup
  const usual = s.length === 'week' ? 7 : 14
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Panel title="The event" subtitle="Name, dates and the kind of event. Times are UTC.">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <Label>Event name</Label>
            <Text testId="setup-name" value={s.name} onChange={(v) => edit((e) => void (e.setup.name = v))} />
          </label>
          <label>
            <Label>Starts (UTC)</Label>
            <input data-testid="setup-start" type="datetime-local" className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm" value={s.start} onChange={(e) => edit((x) => void (x.setup.start = e.target.value))} />
          </label>
          <label>
            <Label hint="Where the players are; the times above stay UTC.">Time zone</Label>
            <Text value={s.timezone} onChange={(v) => edit((e) => void (e.setup.timezone = v))} />
          </label>
          <label>
            <Label hint="FU before weekend is measured at this moment.">Weekend cutoff (UTC)</Label>
            <input data-testid="setup-weekend" type="datetime-local" className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm" value={s.weekendCutoff} onChange={(e) => edit((x) => void (x.setup.weekendCutoff = e.target.value))} />
          </label>
          <div>
            <Label>Ends</Label>
            <p className="py-1 text-sm text-slate-700">{dayLabel(s.start, s.days)} (day {s.days})</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <Label>Length</Label>
            <Choice
              testId="setup-length"
              value={s.length}
              options={[
                { value: 'week', label: 'One week' },
                { value: 'two-weeks', label: 'Two weeks' },
              ]}
              onChange={(v) => edit((e) => setLength(e, v))}
            />
          </div>
          <div>
            <Label hint="The usual days of the length, one more or one less.">Days</Label>
            <Choice
              testId="setup-days"
              value={String(s.days)}
              options={[usual - 1, usual, usual + 1].map((d) => ({ value: String(d), label: String(d) }))}
              onChange={(v) => edit((e) => setDays(e, Number(v)))}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500" data-note>
          Changing the length puts in the workbook's values for it (inflation, MTX baseline, Wins for Economy, CC bands); changing the days evens the daily progression.
        </p>
      </Panel>
      <Panel title="Economy and mode">
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <Label hint="Daily growth of what a piece costs.">Inflation a day</Label>
            <Num testId="setup-inflation" value={s.inflation} scale={100} digits={3} suffix="%" onChange={(v) => edit((e) => void (e.setup.inflation = v!))} />
          </label>
          <label>
            <Label hint="DR a day from purchases at the event's start (Puzzle!R4).">MTX baseline</Label>
            <Num testId="setup-mtx" value={s.mtxBaseline} onChange={(v) => edit((e) => void (e.setup.mtxBaseline = v!))} />
          </label>
        </div>
        <div className="mt-4">
          <Label>Event mode (one only)</Label>
          <Choice testId="setup-mode" value={s.mode} options={MODES} onChange={(v) => edit((e) => void (e.setup.mode = v))} />
          <p className="mt-2 text-xs text-slate-500" data-note>
            {MODES.find((m) => m.value === s.mode)!.hint} Boost is not part of this tool.
          </p>
        </div>
        <div className="mt-4">
          <Table head={['Segment', 'Wins / day', 'Puzzle DR', 'Board 6 ends']}>
            {results.regular.map((r) => (
              <tr key={r.segment}>
                <td className={td}>{r.segment}</td>
                <td className={td}>{r.winsForEconomy}</td>
                <td className={td}>{fmt(r.totalCost)}</td>
                <td className={td}>day {r.tiers[5]!.endDay}</td>
              </tr>
            ))}
          </Table>
        </div>
      </Panel>
    </div>
  )
}

function PasteBox({ label, onPaste, testId }: { label: string; onPaste: (n: number[]) => string | null; testId: string }) {
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  return (
    <div className="mt-2 flex flex-wrap items-start gap-2">
      <textarea data-testid={testId} rows={2} placeholder={label} className="min-w-[12rem] flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs" value={text} onChange={(e) => setText(e.target.value)} />
      <Btn
        small
        onClick={() => {
          const n = parsePasted(text)
          if (!n.length || n.some((x) => !Number.isFinite(x))) return setMsg('Only numbers can be pasted here.')
          const err = onPaste(n)
          setMsg(err ?? `${n.length} values put in.`)
          if (!err) setText('')
        }}
      >
        Put in
      </Btn>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </div>
  )
}

export function StepEconomy() {
  const { ev, edit, results, phase, segment } = usePuzzle()
  if (phase === 'rc') return <RcEconomy />
  const seg = results.regular[segment - 1]!
  const rates = effortShares(ev)
  const progSum = ev.economy.progression.reduce((a, b) => a + b, 0)
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Panel title="Wins for Economy" subtitle="Daily brut wins asked of each segment. This is not who belongs to a segment (that is in Event mechanics).">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
            {ev.economy.segments.map((s, i) => (
              <label key={i}>
                <Label>Seg {i + 1}</Label>
                <Num testId={`wins-${i + 1}`} width="w-16" min={0} value={s.winsForEconomy} onChange={(v) => edit((e) => void (e.economy.segments[i]!.winsForEconomy = v!))} />
              </label>
            ))}
          </div>
          <PasteBox testId="wins-paste" label="Paste 9 numbers (a column from a sheet)" onPaste={(n) => (n.length !== 9 ? `Nine values are needed; ${n.length} were pasted.` : (edit((e) => n.forEach((v, i) => void (e.economy.segments[i]!.winsForEconomy = v))), null))} />
        </Panel>
        <Panel title="Effort across the six boards" subtitle="Each board's share of the puzzle's economic effort. Board 6 takes what is left.">
          <Table head={['Board', 'Size', 'Pieces', 'Effort']}>
            {REGULAR_PIECES.map((n, i) => (
              <tr key={i}>
                <td className={td}>{i + 1}</td>
                <td className={td}>{['2 x 3', '3 x 3', '3 x 4', '4 x 4', '4 x 5', '4 x 6'][i]}</td>
                <td className={td}>{n}</td>
                <td className={td}>
                  {i < 5 ? <Num testId={`effort-${i + 1}`} value={ev.economy.effort[i]!} scale={100} digits={2} suffix="%" min={0} max={1} onChange={(v) => edit((e) => void (e.economy.effort[i] = v!))} /> : <span data-testid="effort-6">{pct(rates[5], 2)}</span>}
                </td>
              </tr>
            ))}
          </Table>
          {rates[5]! <= 0 && <Note tone="red">The first five boards take 100% or more.</Note>}
        </Panel>
        <Panel
          title="Daily progression"
          subtitle="Share of the puzzle's effort planned for each day."
          action={
            <Btn small onClick={() => edit((e) => void (e.economy.progression = uniformProgression(e.setup.days)))}>
              Even
            </Btn>
          }
        >
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {ev.economy.progression.map((p, i) => (
              <label key={i}>
                <Label>{dayLabel(ev.setup.start, i + 1)}</Label>
                <Num testId={`prog-${i + 1}`} width="w-16" value={p} scale={100} digits={2} min={0} max={1} onChange={(v) => edit((e) => void (e.economy.progression[i] = v!))} />
              </label>
            ))}
          </div>
          <p className={`mt-2 text-xs ${Math.abs(progSum - 1) > 1e-6 ? 'font-semibold text-red-600' : 'text-slate-500'}`} data-testid="prog-sum">
            Adds up to {pct(progSum, 2)}
            {Math.abs(progSum - 1) > 1e-6 ? ' - it has to be 100%.' : '.'}
          </p>
          <PasteBox testId="prog-paste" label={`Paste ${ev.setup.days} shares (percent or fractions)`} onPaste={(n) => {
            if (n.length !== ev.setup.days) return `${ev.setup.days} values are needed; ${n.length} were pasted.`
            const f = n.some((x) => x > 1) ? 100 : 1
            edit((e) => void (e.economy.progression = n.map((x) => x / f)))
            return null
          }} />
        </Panel>
        <details className="rounded-3xl border border-white bg-white/80 px-5 py-3 ring-1 ring-slate-200/70" data-collapsible>
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Advanced: DR sources, mode mixes, piece worth</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {(['levelWin', 'wheel', 'areaReward'] as const).map((k) => (
              <label key={k}>
                <Label>{{ levelWin: 'Level win DR / day', wheel: 'Wheel DR / day', areaReward: 'Area reward DR / day' }[k]}</Label>
                <Num value={ev.economy.sources[k]} onChange={(v) => edit((e) => void (e.economy.sources[k] = v!))} />
              </label>
            ))}
          </div>
          <div className="mt-3">
            <Table head={['Segment', 'Mode x1', 'x2', 'x4', 'x8', 'Piece worth (2 weeks)']}>
              {ev.economy.segments.map((s, i) => (
                <tr key={i}>
                  <td className={td}>{i + 1}</td>
                  {s.modeMix.map((m, j) => (
                    <td key={j} className={td}>
                      <Num width="w-16" value={m} digits={4} min={0} onChange={(v) => edit((e) => void (e.economy.segments[i]!.modeMix[j] = v!))} />
                    </td>
                  ))}
                  <td className={td}>
                    <Num width="w-20" value={ev.economy.pieceWorthTwoWeeks[i]!} digits={6} min={0} onChange={(v) => edit((e) => void (e.economy.pieceWorthTwoWeeks[i] = v!))} />
                  </td>
                </tr>
              ))}
            </Table>
            <p className="mt-1 text-xs text-slate-500" data-note>
              A one-week event's piece worth is the two-week worth x {ev.economy.weekWorthFactor} (the workbook's rule).
            </p>
          </div>
        </details>
      </div>
      <div className="flex flex-col gap-4">
        <Panel title={`Segment ${segment}: the six boards`} subtitle={`${seg.winsForEconomy} wins a day x ${ev.setup.days} days x ${seg.basePointsFactor} = ${fmt(seg.points, 1)} points. Piece worth ${pieceWorthOf(ev, segment)}.`} testId="economy-boards">
          <Table head={['Board', 'Pieces', 'Effort', 'Cost (DR)', 'Days', 'Avg piece']}>
            {seg.tiers.map((t) => (
              <tr key={t.tier}>
                <td className={td}>{t.tier}</td>
                <td className={td}>{t.pieces}</td>
                <td className={td}>{pct(t.rate)}</td>
                <td className={td} data-testid={`board-cost-${t.tier}`}>{fmt(t.cost)}</td>
                <td className={td}>{t.startDay === t.endDay ? `day ${t.startDay}` : `days ${t.startDay}-${t.endDay}`}</td>
                <td className={td}>{fmt(t.cost / t.pieces, 1)}</td>
              </tr>
            ))}
            <tr>
              <td className={`${td} font-semibold`} colSpan={3}>Whole puzzle</td>
              <td className={`${td} font-semibold`} data-testid="puzzle-total">{fmt(seg.totalCost)}</td>
              <td className={td} colSpan={2} />
            </tr>
          </Table>
        </Panel>
        <Panel title="Day by day" subtitle={`Segment ${segment}.`}>
          <Table head={['Day', 'Date', 'Planned', 'Planned total', 'Inflation', 'Piece worth', 'Mode x']}>
            {seg.days.map((d) => (
              <tr key={d.day}>
                <td className={td}>{d.day}</td>
                <td className={td}>{dayLabel(ev.setup.start, d.day)}</td>
                <td className={td}>{pct(d.progress)}</td>
                <td className={td}>{pct(d.cumulative)}</td>
                <td className={td}>{fmt(d.inflation, 3)}</td>
                <td className={td}>{fmt(d.pieceValue, 4)}</td>
                <td className={td}>{fmt(d.modeMultiplier, 3)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
        <Panel title="All segments">
          <Table head={['Segment', 'Wins', 'Board 1', 'Board 3', 'Board 6', 'Puzzle DR']}>
            {results.regular.map((r) => (
              <tr key={r.segment} className={r.segment === segment ? 'bg-purple-50/60' : ''}>
                <td className={td}>{r.segment}</td>
                <td className={td}>{r.winsForEconomy}</td>
                <td className={td}>{fmt(r.tiers[0]!.cost)}</td>
                <td className={td}>{fmt(r.tiers[2]!.cost)}</td>
                <td className={td}>{fmt(r.tiers[5]!.cost)}</td>
                <td className={td}>{fmt(r.totalCost)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      </div>
    </div>
  )
}

function RcEconomy() {
  const { ev, edit, results, segment } = usePuzzle()
  const seg = results.rc[segment - 1]!
  const totals = ev.rc.totals[ev.setup.length]
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Panel title={`Recompletion DR budget (${ev.setup.length === 'week' ? 'one week' : 'two weeks'})`} subtitle="A stored number per RC segment - typed, not worked out by a formula.">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-11">
            {totals.map((t, i) => (
              <label key={i}>
                <Label>RC {i + 1}</Label>
                <Num testId={`rc-total-${i + 1}`} width="w-20" min={0} value={t} onChange={(v) => edit((e) => void (e.rc.totals[e.setup.length][i] = v!))} />
              </label>
            ))}
          </div>
          <PasteBox testId="rc-total-paste" label="Paste 11 numbers" onPaste={(n) => (n.length !== 11 ? `Eleven values are needed; ${n.length} were pasted.` : (edit((e) => void (e.rc.totals[e.setup.length] = n)), null))} />
        </Panel>
        <Panel title="The three RC boards" subtitle="Budget share, and the factor a board's value is multiplied by.">
          <Table head={['Board', 'Pieces', 'Share', 'Value factor']}>
            {ev.rc.tiers.map((t, i) => (
              <tr key={i}>
                <td className={td}>{i + 1}</td>
                <td className={td}>{RC_PIECES[i]}</td>
                <td className={td}>
                  <Num value={t.share} scale={100} digits={2} suffix="%" min={0} max={1} onChange={(v) => edit((e) => void (e.rc.tiers[i]!.share = v!))} />
                </td>
                <td className={td}>
                  <Num value={t.valueFactor} digits={3} min={0} onChange={(v) => edit((e) => void (e.rc.tiers[i]!.valueFactor = v!))} />
                </td>
              </tr>
            ))}
          </Table>
          {Math.abs(ev.rc.tiers.reduce((a, t) => a + t.share, 0) - 1) > 1e-6 && <Note tone="red">The shares have to add up to 100%.</Note>}
          <label className="mt-3 block">
            <Label hint="As the RC Simulator: the last day's piece worth of regular segment 9 (economist, 26 Nov 2026: the amounts should match the simulator). Change it only on purpose.">Piece worth taken from regular segment</Label>
            <Num value={ev.rc.pieceValueSegment} min={1} max={9} digits={0} onChange={(v) => edit((e) => void (e.rc.pieceValueSegment = Math.round(v!)))} />
          </label>
        </Panel>
      </div>
      <Panel title={`RC segment ${segment}: ${seg.key}`} testId="rc-boards">
        <Table head={['Board', 'Pieces', 'Tier DR', 'Priced at', 'Board total']}>
          {seg.tiers.map((t) => (
            <tr key={t.tier}>
              <td className={td}>{t.tier}</td>
              <td className={td}>{t.pieces}</td>
              <td className={td}>{fmt(t.tierDr, 1)}</td>
              <td className={td}>{fmt(t.tierDrPriced, 1)}</td>
              <td className={td}>{fmt(t.total)}</td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-slate-500" data-note>
          A piece's price is the board's DR x its rank / (n(n+1)/2), rounded. A player reaches RC when board 6 of the regular puzzle is done.
        </p>
      </Panel>
    </div>
  )
}
