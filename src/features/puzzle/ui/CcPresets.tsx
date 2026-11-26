import { useMemo, useState } from 'react'
import { CC_STATES, ccDays, ccProblems, ccState, presetBase, presetMatrix, presetValues, type CcState } from '../engine/cc'
import { Choice, Label, Note, Num, Panel, Table, Text } from './kit'
import { fmt, pct, td } from './format'
import { dayLabel, usePuzzle } from './shared'

const COLORS: Record<CcState, string> = { 'Strong Push': '#7c3aed', Push: '#c4b5fd', Normal: '#e2e8f0', Stall: '#fcd34d', 'Strong Stall': '#f59e0b' }
type Sub = 'bands' | 'values' | 'test'

export function CcPresets() {
  const [sub, setSub] = useState<Sub>('bands')
  return (
    <div className="flex flex-col gap-4" data-testid="cc-presets">
      <div className="rounded-3xl border border-white bg-white/85 px-5 py-3 shadow-sm">
        <Choice
          testId="cc-steps"
          value={sub}
          onChange={setSub}
          options={[
            { value: 'bands', label: '1 Pace & Bands' },
            { value: 'values', label: '2 Preset Values' },
            { value: 'test', label: '3 Test & Export' },
          ]}
        />
        <p className="mt-2 text-xs text-slate-600" data-note>
          CC depends only on the event's days and daily progression and on these settings - not on prices, rewards, inflation or Wins for Economy.
        </p>
      </div>
      {sub === 'bands' ? <Bands /> : sub === 'values' ? <Values /> : <Tester />}
    </div>
  )
}

function Heatmap({ days }: { days: ReturnType<typeof ccDays> }) {
  const steps = 50
  const cellW = 100 / days.length
  return (
    <svg viewBox={`0 0 100 ${steps}`} preserveAspectRatio="none" className="h-64 w-full rounded-xl" data-testid="cc-heatmap" role="img" aria-label="State by day and progress">
      {days.map((d, i) =>
        Array.from({ length: steps }, (_, j) => {
          const progress = 1 - (j + 0.5) / steps
          return <rect key={`${i}-${j}`} x={i * cellW} y={j} width={cellW + 0.05} height={1.05} fill={COLORS[ccState(days, d.day, progress)]} />
        }),
      )}
      <polyline fill="none" stroke="#0f172a" strokeWidth={0.6} vectorEffect="non-scaling-stroke" points={days.map((d, i) => `${(i + 0.5) * cellW},${(1 - d.expectedStart) * steps}`).join(' ')} />
    </svg>
  )
}

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
      {CC_STATES.map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded" style={{ background: COLORS[s] }} /> {s}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-0.5 w-4 bg-slate-900" /> planned progress at day start
      </span>
    </div>
  )
}

function Bands() {
  const { ev, edit } = usePuzzle()
  const days = useMemo(() => ccDays(ev.economy.progression, ev.cc), [ev.economy.progression, ev.cc])
  const problems = ccProblems(days)
  const b = ev.cc.bands
  const ov = (i: number, k: 'pushNormal' | 'pushStrong' | 'stallNormal' | 'stallStrong') => (
    <Num width="w-16" allowBlank scale={100} digits={3} value={ev.cc.days[i]?.[k] ?? null} onChange={(v) => edit((e) => void (e.cc.days[i]![k] = v))} />
  )
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Panel title="Band widths (days of pace)" subtitle={`From the event: ${ev.setup.days} days, its daily progression (Economy & progression).`}>
          <div className="flex flex-wrap gap-4">
            {(
              [
                ['normalBehind', 'Normal - behind'],
                ['pushBand', 'Push band'],
                ['normalAhead', 'Normal - ahead'],
                ['stallBand', 'Stall band'],
              ] as const
            ).map(([k, label]) => (
              <label key={k}>
                <Label>{label}</Label>
                <Num testId={`cc-${k}`} value={b[k]} min={0} onChange={(v) => edit((e) => void (e.cc.bands[k] = v!))} />
              </label>
            ))}
          </div>
        </Panel>
        <Panel title="Day by day" subtitle="Boundaries in points of progress from the plan at day start. Overrides: blank = automatic, 0 is a value. Day 1 is always Normal; the last day has no Stall.">
          <Table head={['Day', 'Plan at start', 'Normal width x', 'Push at', 'Strong Push at', 'Stall at', 'Strong Stall at', 'Push ovr', 'S.Push ovr', 'Stall ovr', 'S.Stall ovr']}>
            {days.map((d, i) => (
              <tr key={d.day}>
                <td className={td}>{dayLabel(ev.setup.start, d.day)}</td>
                <td className={td}>{pct(d.expectedStart)}</td>
                <td className={td}>{i === 0 ? '–' : <Num width="w-14" min={0} value={ev.cc.days[i]?.normalWidth ?? 1} onChange={(v) => edit((e) => void (e.cc.days[i]!.normalWidth = v!))} />}</td>
                <td className={td}>-{pct(d.pushNormal, 2)}</td>
                <td className={td}>-{pct(d.pushStrong, 2)}</td>
                <td className={td}>{d.day === days.length ? 'none' : `+${pct(d.stallNormal, 2)}`}</td>
                <td className={td}>{d.day === days.length ? 'none' : `+${pct(d.stallStrong, 2)}`}</td>
                {i === 0 ? <td className={td} colSpan={4} /> : (
                  <>
                    <td className={td}>{ov(i, 'pushNormal')}</td>
                    <td className={td}>{ov(i, 'pushStrong')}</td>
                    <td className={td}>{ov(i, 'stallNormal')}</td>
                    <td className={td}>{ov(i, 'stallStrong')}</td>
                  </>
                )}
              </tr>
            ))}
          </Table>
          {problems.map((p, i) => (
            <Note key={i} tone="red">
              {p} Fix it before export.
            </Note>
          ))}
        </Panel>
      </div>
      <Panel title="Who is in which state" subtitle="Day across, progress (economic effort) up.">
        <Heatmap days={days} />
        <Legend />
      </Panel>
    </div>
  )
}

function Values() {
  const { ev, edit } = usePuzzle()
  const [q, setQ] = useState('')
  const m = useMemo(() => presetMatrix(ev.cc), [ev.cc])
  const shown = m.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Panel title="Multipliers and rounding" subtitle="Rounding is chosen by the value after its multiplier.">
        <Table head={['State', 'Multiplier', 'Rounding']}>
          {CC_STATES.map((s, i) => (
            <tr key={s}>
              <td className={td}>{s}</td>
              <td className={td}>
                <Num testId={`cc-mult-${i}`} min={0} value={ev.cc.multipliers[i]!} onChange={(v) => edit((e) => void (e.cc.multipliers[i] = v!))} />
              </td>
              <td className={td}>{['nearest', 'up', 'none', 'down', 'down'][i]}</td>
            </tr>
          ))}
        </Table>
        <Table head={['From', 'Step']}>
          {ev.cc.ladder.map((r, i) => (
            <tr key={i}>
              <td className={td}>{r[0]}</td>
              <td className={td}>
                <Num width="w-14" min={0.0001} value={r[1]} onChange={(v) => edit((e) => void (e.cc.ladder[i]![1] = v!))} />
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
      <Panel
        title={`Presets (${m.length})`}
        subtitle="The workbook's working list (puzzle_N). Its mapping to the game's preset names (gameplay / pricing, suffixes) is not confirmed, so this is not a production CC export."
        action={<Text width="w-48" testId="cc-search" placeholder="Search" value={q} onChange={setQ} />}
      >
        <Table testId="cc-matrix" head={['Preset', 'Normal DR', ...CC_STATES]}>
          {shown.map((p) => (
            <tr key={p.name}>
              <td className={`${td} font-mono text-xs`}>{p.name}</td>
              <td className={td}>{p.base ?? '–'}</td>
              {CC_STATES.map((s, i) => {
                const v = p.values?.[i]
                return (
                  <td key={s} className={`${td} ${p.sameAsNeighbour.includes(s) ? 'bg-amber-50 text-amber-800' : ''}`} title={v ? `${fmt(v.raw, 3)} -> ${v.method}${v.step ? ` to ${v.step}` : ''}` : ''}>
                    {v ? fmt(v.value, 2) : '–'}
                  </td>
                )
              })}
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-slate-500" data-note>
          Highlighted: rounding gave the same DR as the state before it. Hover a value for its raw number and rounding.
        </p>
      </Panel>
    </div>
  )
}

function Tester() {
  const { ev } = usePuzzle()
  const days = useMemo(() => ccDays(ev.economy.progression, ev.cc), [ev.economy.progression, ev.cc])
  const [day, setDay] = useState(Math.min(7, ev.setup.days))
  const [progress, setProgress] = useState(0.3)
  const [preset, setPreset] = useState(ev.cc.presets.includes('puzzle_50') ? 'puzzle_50' : (ev.cc.presets[0] ?? ''))
  const d = days[day - 1]
  const state = ccState(days, day, progress)
  const base = presetBase(preset)
  const values = base == null ? null : presetValues(base, ev.cc)
  const v = values?.[CC_STATES.indexOf(state)]
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Test a player" subtitle="Progress is economic-effort progress, not a percentile.">
        <div className="flex flex-wrap gap-4">
          <label>
            <Label>Day</Label>
            <Num testId="cc-test-day" value={day} min={1} max={ev.setup.days} digits={0} onChange={(x) => setDay(Math.round(x!))} />
          </label>
          <label>
            <Label>Progress</Label>
            <Num testId="cc-test-progress" value={progress} scale={100} suffix="%" min={0} max={1} onChange={(x) => setProgress(x!)} />
          </label>
          <label>
            <Label>Preset</Label>
            <select data-testid="cc-test-preset" className="rounded-lg border border-slate-200 px-2 py-1 text-sm" value={preset} onChange={(e) => setPreset(e.target.value)}>
              {ev.cc.presets.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
        </div>
      </Panel>
      <Panel title="Result" testId="cc-test-result">
        {d && (
          <Table head={['', '']}>
            <tr><td className={td}>Planned at day start</td><td className={td}>{pct(d.expectedStart, 2)}</td></tr>
            <tr><td className={td}>Distance from plan</td><td className={td}>{(progress - d.expectedStart >= 0 ? '+' : '') + pct(progress - d.expectedStart, 2)}</td></tr>
            <tr><td className={td}>Boundaries</td><td className={td}>Strong Push ≤ -{pct(d.pushStrong, 2)}, Push ≤ -{pct(d.pushNormal, 2)}, Stall ≥ +{pct(d.stallNormal, 2)}, Strong Stall ≥ +{pct(d.stallStrong, 2)}</td></tr>
            <tr><td className={td}>State</td><td className={`${td} font-semibold`} data-testid="cc-test-state">{state}</td></tr>
            <tr><td className={td}>Multiplier</td><td className={td}>{v ? v.multiplier : '–'}</td></tr>
            <tr><td className={td}>Rounding</td><td className={td}>{v ? `${fmt(v.raw, 3)} ${v.method}${v.step ? ` to ${v.step}` : ''}` : '–'}</td></tr>
            <tr><td className={td}>DR given</td><td className={`${td} font-semibold`} data-testid="cc-test-dr">{v ? fmt(v.value, 2) : '–'}</td></tr>
          </Table>
        )}
        <Note tone="amber">There is no CC export yet: the game's preset names and how a state is chosen in production are not confirmed. Nothing CC is added to the Puzzle templates.</Note>
      </Panel>
    </div>
  )
}
