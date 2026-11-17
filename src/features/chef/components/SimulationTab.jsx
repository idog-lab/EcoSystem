import { useState } from 'react'
import { PlayCircle } from 'lucide-react'
import Card from '../../../components/ui/Card'
import NumberField from '../../../components/ui/NumberField'
import { simulateMonteCarlo, runSensitivitySweep, solveRequiredBasketRate } from '../lib/chefSimulation'
import { ingredientUnitValues, estimateBasketValue } from '../lib/chefBasketValue'
import { calendarDateForDay, formatCalendarDate, CHEST_LABELS } from '../lib/chefModel'

const DEFAULT_RUNS = 300
const SWEEP_DELTAS = [-30, -20, -10, 0, 10, 20, 30]
const OVERLAY_COLORS = ['#9333ea', '#db2777', '#0284c7', '#059669', '#d97706', '#dc2626', '#4f46e5', '#0d9488', '#65a30d']

// A band-plus-median bar per day - the p10-p90 spread (lighter) behind a
// solid median bar, the same "don't just show the average, show the
// spread" principle as Merge's own lucky-drop Monte Carlo sim (mean AND
// min-max AND a zero-count, not just a mean - see CLAUDE.md's "Lucky-drop
// simulator" section).
function SegmentCurve({ segment, result, totalDishes, calendar }) {
  const lastDay = result.days[result.days.length - 1]
  const fullClearPct = (lastDay.fullClearFraction * 100).toFixed(0)
  const marginPct = lastDay.fullClearMarginOfError != null ? (lastDay.fullClearMarginOfError * 100).toFixed(1) : null
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/70 p-3">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm text-slate-800">{segment.name}</span>
        <span className="text-xs text-slate-500">
          median {lastDay.p50}/{totalDishes} dishes (P10 {lastDay.p10} – P90 {lastDay.p90})
        </span>
      </div>
      <div className="text-xs text-slate-500">
        Full clear: <span className="font-semibold text-slate-700">{fullClearPct}%</span>
        {marginPct != null && ` ± ${marginPct} pts (95%, n=${result.runs})`}
      </div>
      <div className="flex items-end gap-[2px] h-28">
        {result.days.map((d) => {
          const pct = (v) => (totalDishes > 0 ? (v / totalDishes) * 100 : 0)
          const phaseBoundary = d.day > 1 && d.phaseId !== result.days[d.day - 2].phaseId
          const date = calendarDateForDay(calendar, d.day)
          const label = formatCalendarDate(date) ?? `Day ${d.day}`
          return (
            <div
              key={d.day}
              className="flex-1 relative h-full"
              title={`${label}: median ${d.p50}, mean ${d.mean.toFixed(1)}, P10–P90 ${d.p10}–${d.p90} (of ${totalDishes})`}
            >
              {phaseBoundary && <div className="absolute -left-px top-0 bottom-0 w-px bg-slate-300 z-10" />}
              <div className="absolute left-0 right-0 bg-purple-200/60 rounded-sm" style={{ bottom: `${pct(d.p10)}%`, height: `${Math.max(pct(d.p90) - pct(d.p10), 1)}%` }} />
              <div className="absolute left-0 right-0 bottom-0 bg-gradient-to-t from-purple-600 to-fuchsia-500 rounded-t-sm" style={{ height: `${Math.max(pct(d.p50), 2)}%` }} />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400">
        <span>{formatCalendarDate(calendarDateForDay(calendar, 1)) ?? 'Day 1'}</span>
        <span>{formatCalendarDate(calendarDateForDay(calendar, result.days.length)) ?? `Day ${result.days.length}`}</span>
      </div>
    </div>
  )
}

// All selected segments' own median curves overlaid on one chart - by
// explicit economist brainstorm ask ("segment-vs-segment overlay") - faster
// cross-segment comparison than scanning several small per-segment charts.
// Plain inline SVG, not a charting library (see CLAUDE.md's "Style/stack
// notes" - this app deliberately has none) - a handful of straight
// polylines doesn't need one.
function OverlayChart({ results, totalDishes }) {
  const totalDays = results[0]?.result.days.length ?? 1
  return (
    <div className="flex flex-col gap-2">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-40 bg-slate-50 rounded-xl border border-slate-200">
        {results.map(({ segment, result }, i) => {
          const points = result.days
            .map((d) => `${totalDays > 1 ? ((d.day - 1) / (totalDays - 1)) * 100 : 0},${40 - (totalDishes > 0 ? (d.p50 / totalDishes) * 40 : 0)}`)
            .join(' ')
          return <polyline key={segment.id} points={points} fill="none" stroke={OVERLAY_COLORS[i % OVERLAY_COLORS.length]} strokeWidth={0.6} />
        })}
      </svg>
      <div className="flex flex-wrap gap-3">
        {results.map(({ segment }, i) => (
          <span key={segment.id} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: OVERLAY_COLORS[i % OVERLAY_COLORS.length] }} />
            {segment.name}
          </span>
        ))}
      </div>
    </div>
  )
}

function DishTimingTable({ dishes, result, calendar }) {
  return (
    <table className="min-w-full text-xs">
      <thead>
        <tr>
          <th className="text-left font-semibold text-slate-500 px-2 py-1">Dish</th>
          <th className="text-center font-semibold text-slate-500 px-2 py-1">% of runs that finish it</th>
          <th className="text-center font-semibold text-slate-500 px-2 py-1">Typical day (P10–P50–P90)</th>
        </tr>
      </thead>
      <tbody>
        {dishes.map((dish) => {
          const stat = result.dishStats.find((s) => s.dishId === dish.id)
          if (!stat) return null
          const fmt = (day) => (day == null ? '—' : formatCalendarDate(calendarDateForDay(calendar, day)) ?? `Day ${day}`)
          return (
            <tr key={dish.id} className="border-t border-slate-100">
              <td className="px-2 py-1 font-medium text-slate-700 whitespace-nowrap">
                <span aria-hidden="true">{dish.art ?? ''}</span> {dish.name}
              </td>
              <td className="px-2 py-1 text-center text-slate-600">
                {(stat.reachedFraction * 100).toFixed(0)}%
                {stat.reachedMarginOfError != null && <span className="text-slate-400"> ± {(stat.reachedMarginOfError * 100).toFixed(1)}</span>}
              </td>
              <td className="px-2 py-1 text-center text-slate-500 whitespace-nowrap">
                {stat.p50 == null ? '—' : `${fmt(stat.p10)} – ${fmt(stat.p50)} – ${fmt(stat.p90)}`}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function LeftoverTable({ result, ingredientsById }) {
  const sorted = [...result.leftoverStats].sort((a, b) => b.mean - a.mean)
  if (sorted.length === 0) return <p className="text-sm text-slate-400">No leftover ingredients — every basket unit ended up used.</p>
  return (
    <table className="min-w-full text-xs">
      <thead>
        <tr>
          <th className="text-left font-semibold text-slate-500 px-2 py-1">Ingredient</th>
          <th className="text-center font-semibold text-slate-500 px-2 py-1">Avg leftover at event end</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((s) => (
          <tr key={s.ingredientId} className="border-t border-slate-100">
            <td className="px-2 py-1 font-medium text-slate-700">
              <span aria-hidden="true">{ingredientsById[s.ingredientId]?.art ?? ''}</span> {ingredientsById[s.ingredientId]?.name ?? s.ingredientId}
            </td>
            <td className="px-2 py-1 text-center text-slate-600">{s.mean.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function NearMissTable({ result, ingredientsById }) {
  if (result.nearMissStats.length === 0) {
    return <p className="text-sm text-slate-400">No runs ended exactly one ingredient short of a dish — either everything clears, or shortfalls span several ingredients at once.</p>
  }
  return (
    <table className="min-w-full text-xs">
      <thead>
        <tr>
          <th className="text-left font-semibold text-slate-500 px-2 py-1">Ingredient</th>
          <th className="text-center font-semibold text-slate-500 px-2 py-1">% of runs stuck one short on it</th>
        </tr>
      </thead>
      <tbody>
        {result.nearMissStats.map((s) => (
          <tr key={s.ingredientId} className="border-t border-slate-100">
            <td className="px-2 py-1 font-medium text-slate-700">
              <span aria-hidden="true">{ingredientsById[s.ingredientId]?.art ?? ''}</span> {ingredientsById[s.ingredientId]?.name ?? s.ingredientId}
            </td>
            <td className="px-2 py-1 text-center text-slate-600">{(s.runFraction * 100).toFixed(0)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function StalledProgressPanel({ result, calendar }) {
  const s = result.stalledStats
  const fmt = (day) => (day == null ? '—' : formatCalendarDate(calendarDateForDay(calendar, day)) ?? `Day ${day}`)
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
      <div className="rounded-xl border border-slate-200 bg-white/70 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">First craft</div>
        <div className="text-slate-700">
          {fmt(s.firstCraftDayP10)} – {fmt(s.firstCraftDayP50)} – {fmt(s.firstCraftDayP90)} (P10–P50–P90)
        </div>
        {s.neverCraftedFraction > 0 && <div className="text-xs text-amber-700 mt-1">{(s.neverCraftedFraction * 100).toFixed(0)}% of runs never craft anything.</div>}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white/70 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Longest stretch without a craft</div>
        <div className="text-slate-700">
          {s.longestGapP50} days typical, up to {s.longestGapP90} days for a P90 run
        </div>
      </div>
    </div>
  )
}

function BasketRoiTable({ segment, dishes, baskets, totalChefPrize }) {
  const unitValue = ingredientUnitValues({ dishes, segment, totalChefPrizeValue: totalChefPrize[segment.prizeTier] ?? 0 })
  const ranked = baskets
    .map((basket) => ({ basket, value: estimateBasketValue(basket, unitValue, 'gameplay').value }))
    .sort((a, b) => b.value - a.value)
  return (
    <table className="min-w-full text-xs">
      <thead>
        <tr>
          <th className="text-left font-semibold text-slate-500 px-2 py-1">Basket</th>
          <th className="text-center font-semibold text-slate-500 px-2 py-1">Expected value / open (real odds)</th>
        </tr>
      </thead>
      <tbody>
        {ranked.map(({ basket, value }) => (
          <tr key={basket.id} className="border-t border-slate-100">
            <td className="px-2 py-1 font-medium text-slate-700">
              {CHEST_LABELS[basket.chestType]} — {basket.phaseId}
            </td>
            <td className="px-2 py-1 text-center text-slate-600">{value.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SensitivitySweep({ segment, dishes, baskets, calendar, grants, strategy }) {
  const [sweep, setSweep] = useState(null)
  const [running, setRunning] = useState(false)

  function handleRun() {
    setRunning(true)
    setTimeout(() => {
      setSweep(runSensitivitySweep({ segment, dishes, baskets, calendar, grants, strategy }))
      setRunning(false)
    }, 20)
  }

  const maxCompleted = sweep ? Math.max(1, ...sweep.map((s) => s.medianCompleted)) : 1

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={handleRun}
        disabled={running}
        className="self-start px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 text-white disabled:opacity-50"
      >
        {running ? 'Running…' : `Run sensitivity sweep for ${segment.name}`}
      </button>
      {sweep && (
        <div className="flex items-end gap-3 h-28">
          {sweep.map((s) => (
            <div key={s.delta} className="flex-1 flex flex-col items-center gap-1" title={`${s.delta >= 0 ? '+' : ''}${s.delta}%: median ${s.medianCompleted}/${s.totalDishes}`}>
              <div className="w-full flex-1 flex items-end">
                <div
                  className={`w-full rounded-t-sm ${s.delta === 0 ? 'bg-gradient-to-t from-purple-600 to-fuchsia-500' : 'bg-purple-200'}`}
                  style={{ height: `${(s.medianCompleted / maxCompleted) * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-slate-500">
                {s.delta >= 0 ? '+' : ''}
                {s.delta}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function WhatWouldItTakeSolver({ segment, dishes, baskets, calendar, strategy }) {
  const [targetDay, setTargetDay] = useState(calendar.totalDays)
  const [targetPercent, setTargetPercent] = useState(100)
  const [solution, setSolution] = useState(null)

  function handleSolve() {
    setSolution(solveRequiredBasketRate({ segment, dishes, baskets, calendar, targetDay, targetFraction: targetPercent / 100, strategy }))
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-500">Deterministic (expected-value) search — doesn't model ingredient grants, so a solved rate is a from-baskets-alone answer.</p>
      <div className="flex flex-wrap items-end gap-3">
        <NumberField label="By day" min={1} max={calendar.totalDays} value={targetDay} onChange={(e) => setTargetDay(Number(e.target.value) || 1)} className="w-24" />
        <NumberField label="Target completion %" min={1} max={100} value={targetPercent} onChange={(e) => setTargetPercent(Number(e.target.value) || 1)} className="w-32" />
        <button type="button" onClick={handleSolve} className="px-3 py-2.5 rounded-xl text-sm font-semibold bg-purple-600 text-white">
          Solve
        </button>
      </div>
      {solution && !solution.feasible && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Not reachable even at 20× {segment.name}'s current basket rate by that day.
        </p>
      )}
      {solution?.feasible && (
        <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          Needs ~{solution.factor.toFixed(2)}× {segment.name}'s current rate — basic {solution.scaledRate.basic}, rare {solution.scaledRate.rare}, epic{' '}
          {solution.scaledRate.epic} baskets/day.
        </p>
      )}
    </div>
  )
}

function copyResultsAsTsv(results, calendar) {
  const header = ['Day', 'Date', ...results.map(({ segment }) => segment.name)]
  const totalDays = results[0]?.result.days.length ?? 0
  const rows = [header]
  for (let d = 0; d < totalDays; d += 1) {
    const day = d + 1
    const date = formatCalendarDate(calendarDateForDay(calendar, day)) ?? ''
    rows.push([day, date, ...results.map(({ result }) => result.days[d].p50)])
  }
  const tsv = rows.map((r) => r.join('\t')).join('\n')
  navigator.clipboard?.writeText(tsv)
}

// By explicit economist request: show, by day, when a segment reaches what
// dish-completion level, given its avg-baskets-opened-per-day rate and the
// calendar's own per-phase basket-odds rules - and do it with "a lot of
// runs, averaged" (simulateMonteCarlo in chefSimulation.js) rather than a
// single deterministic curve, since real basket rolls are genuinely
// random and the question is really "how do REAL players, with real
// variance, spread out over this calendar."
export default function SimulationTab({ segments, dishes, recompletionDishes, baskets, calendar, grants, ingredients, totalChefPrize }) {
  const [selectedIds, setSelectedIds] = useState(() => new Set(segments.map((s) => s.id)))
  const [runs, setRuns] = useState(DEFAULT_RUNS)
  const [seedText, setSeedText] = useState('')
  const [strategy, setStrategy] = useState('list-order')
  const [dishSet, setDishSet] = useState('main')
  const [results, setResults] = useState(null)
  const [running, setRunning] = useState(false)
  const [detailSegmentId, setDetailSegmentId] = useState(null)
  const [copied, setCopied] = useState(false)

  const activeDishes = dishSet === 'main' ? dishes : recompletionDishes
  const ingredientsById = Object.fromEntries(ingredients.map((i) => [i.id, i]))

  function toggle(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleRun() {
    setRunning(true)
    // Defer one tick so the "Running..." disabled state actually paints
    // before the synchronous Monte Carlo loop blocks the main thread - the
    // same reasoning Merge's own Effort-target search defers its call (see
    // CLAUDE.md's "Effort target" UI section).
    setTimeout(() => {
      const seed = seedText.trim() === '' ? null : Number(seedText)
      const next = segments
        .filter((s) => selectedIds.has(s.id))
        .map((segment) => ({ segment, result: simulateMonteCarlo({ segment, dishes: activeDishes, baskets, calendar, grants, runs, strategy, seed }) }))
      setResults(next)
      setDetailSegmentId(next[0]?.segment.id ?? null)
      setRunning(false)
    }, 20)
  }

  const detailResult = results?.find((r) => r.segment.id === detailSegmentId)

  return (
    <div className="flex flex-col gap-4">
      <Card title="Dish set" subtitle="Simulate the main dish list, or the Recompletion round players cycle through afterward — same economy (ingredients/baskets/calendar/segments), different recipes.">
        <div className="flex gap-2">
          {[
            ['main', 'Dishes'],
            ['recompletion', 'Recompletion dishes'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setDishSet(id)
                setResults(null)
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${dishSet === id ? 'bg-purple-600 text-white' : 'bg-white/70 text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      <Card
        title="Segments to show"
        subtitle="Monte Carlo simulation — many simulated players, each with their own persistent activity level and active/inactive day streaks (not just the segment average), rolling real random baskets day by day."
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2 flex-1">
            {segments.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => toggle(s.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${selectedIds.has(s.id) ? 'bg-purple-600 text-white' : 'bg-white/70 text-slate-500 border border-slate-200'}`}
              >
                {s.name}
              </button>
            ))}
          </div>
          <label className="text-xs flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Crafting strategy</span>
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-2 bg-white/70">
              <option value="list-order">Craft as soon as possible</option>
              <option value="prize-first">Chase highest prize first</option>
            </select>
          </label>
          <NumberField label="Runs" min={10} max={5000} value={runs} onChange={(e) => setRuns(Number(e.target.value) || DEFAULT_RUNS)} className="w-28" />
          <label className="text-xs flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Seed (optional)</span>
            <input
              type="text"
              placeholder="random"
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              title="Leave blank for fresh randomness each run. Set a number to make this run reproducible — the same seed + run count always produces the same result, which is what lets two configs be compared fairly."
              className="w-24 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-medium bg-white/70 focus:outline-none focus:ring-4 focus:ring-purple-200/60 focus:border-purple-400 transition-shadow"
            />
          </label>
          <button
            type="button"
            onClick={handleRun}
            disabled={running || selectedIds.size === 0}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-purple-600 to-fuchsia-500 text-white shadow-md shadow-purple-500/30 disabled:opacity-50"
          >
            <PlayCircle size={15} /> {running ? 'Running…' : 'Run simulation'}
          </button>
        </div>
      </Card>

      {results && (
        <>
          <Card
            title="Dish completion over the event"
            subtitle={`${results[0]?.result.runs ?? runs} simulated players per segment — solid bar is the median, the lighter band is the P10–P90 spread.`}
            action={
              <button
                type="button"
                onClick={() => {
                  copyResultsAsTsv(results, calendar)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
                className="text-xs font-semibold text-purple-600 hover:text-purple-800"
              >
                {copied ? 'Copied!' : 'Copy medians as TSV'}
              </button>
            }
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {results.map(({ segment, result }) => (
                <SegmentCurve key={segment.id} segment={segment} result={result} totalDishes={activeDishes.length} calendar={calendar} />
              ))}
            </div>
          </Card>

          {results.length > 1 && (
            <Card title="All segments overlaid" subtitle="Each line is one segment's own median completion %, so curves can be compared side by side.">
              <OverlayChart results={results} totalDishes={activeDishes.length} />
            </Card>
          )}

          <Card title="Segment detail" subtitle="Pick a segment for the breakdowns below.">
            <div className="flex gap-2">
              {results.map(({ segment }) => (
                <button
                  key={segment.id}
                  type="button"
                  onClick={() => setDetailSegmentId(segment.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${detailSegmentId === segment.id ? 'bg-purple-600 text-white' : 'bg-white/70 text-slate-500 border border-slate-200'}`}
                >
                  {segment.name}
                </button>
              ))}
            </div>
          </Card>

          {detailResult && (
            <>
              <Card title="When do players finish each dish?" subtitle="% of runs that ever complete it, and the typical (P10–P50–P90) day.">
                <DishTimingTable dishes={activeDishes} result={detailResult.result} calendar={calendar} />
              </Card>

              <Card title="Leftover ingredients at event end" subtitle="A big leftover average means that ingredient's basket odds are over-indexed versus what any dish actually needs.">
                <LeftoverTable result={detailResult.result} ingredientsById={ingredientsById} />
              </Card>

              <Card title="Near-miss diagnostics" subtitle="Among runs that didn't fully clear, which single ingredient most often left a dish exactly one short.">
                <NearMissTable result={detailResult.result} ingredientsById={ingredientsById} />
              </Card>

              <Card title="Stalled progress" subtitle="When a typical run gets its first craft, and the longest stretch any run goes without completing anything.">
                <StalledProgressPanel result={detailResult.result} calendar={calendar} />
              </Card>

              <Card title="Basket ROI" subtitle="Expected prize-equivalent value per basket OPEN, using the real Gameplay odds (not the Pricing table) — which basket type is the best use of this segment's time.">
                <BasketRoiTable segment={detailResult.segment} dishes={activeDishes} baskets={baskets} totalChefPrize={totalChefPrize} />
              </Card>

              <Card title="Sensitivity sweep" subtitle="How final completion moves if this segment were more/less engaged than assumed — every chest type scaled by the same %.">
                <SensitivitySweep segment={detailResult.segment} dishes={activeDishes} baskets={baskets} calendar={calendar} grants={grants} strategy={strategy} />
              </Card>

              <Card title='"What would it take" solver' subtitle="Inverse of the simulator — given a target completion %, solve the basket rate needed to reach it.">
                <WhatWouldItTakeSolver segment={detailResult.segment} dishes={activeDishes} baskets={baskets} calendar={calendar} strategy={strategy} />
              </Card>
            </>
          )}
        </>
      )}

      {!results && <p className="text-sm text-slate-400">Pick segments and click "Run simulation."</p>}
    </div>
  )
}
