import { useState } from 'react'
import { CheckCircle2, PlayCircle } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Collapsible from '../../../components/ui/Collapsible'
import { simulateMonteCarlo, runSensitivitySweep, solveRequiredBasketRate } from '../lib/chefSimulation'
import { ingredientUnitValues, estimateBasketValue } from '../lib/chefBasketValue'
import { CHEST_LABELS, CHEST_TYPES } from '../lib/chefModel'
import { SEVERITY_LABELS, SEVERITY_ORDER } from '../lib/chefValidation'
import { dayLabel, shortDay } from '../lib/chefFormat'
import { Finding, Num, Toggle, SELECT, TD, TH } from './chefUi'

const DEFAULT_PLAYERS = 300
const OVERLAY_COLORS = ['#9333ea', '#db2777', '#0284c7', '#059669', '#d97706', '#dc2626', '#4f46e5', '#0d9488', '#65a30d']
const STRATEGY_LABELS = { 'list-order': 'cooks whatever they can, in the order of the list', 'prize-first': 'goes for the biggest prize first' }

// One segment, day by day: the solid bar is the middle player, the lighter
// band runs from the slow players to the fast ones (1 in 10 is below the
// band, 1 in 10 above).
function SegmentCurve({ segment, result, totalDishes, calendar }) {
  const last = result.days[result.days.length - 1]
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/70 p-3" data-curve={segment.id}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-800">{segment.name}</span>
        <span className="text-xs text-slate-500">
          {last.p50} of {totalDishes} dishes at the end, most players {last.p10} to {last.p90}
        </span>
      </div>
      <div className="flex h-28 items-end gap-[2px]">
        {result.days.map((d) => {
          const pct = (v) => (totalDishes > 0 ? (v / totalDishes) * 100 : 0)
          const phaseBoundary = d.day > 1 && d.phaseId !== result.days[d.day - 2].phaseId
          return (
            <div key={d.day} className="relative h-full flex-1" title={`${dayLabel(calendar, d.day)}: the middle player has ${d.p50} of ${totalDishes}, most players ${d.p10} to ${d.p90}, the average ${d.mean.toFixed(1)}`}>
              {phaseBoundary && <div className="absolute -left-px bottom-0 top-0 z-10 w-px bg-slate-300" />}
              <div className="absolute left-0 right-0 rounded-sm bg-purple-200/60" style={{ bottom: `${pct(d.p10)}%`, height: `${Math.max(pct(d.p90) - pct(d.p10), 1)}%` }} />
              <div className="absolute bottom-0 left-0 right-0 rounded-t-sm bg-gradient-to-t from-purple-600 to-fuchsia-500" style={{ height: `${Math.max(pct(d.p50), 2)}%` }} />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400">
        <span>{shortDay(calendar, 1)}</span>
        <span>{shortDay(calendar, result.days.length)}</span>
      </div>
    </div>
  )
}

// Every segment's middle player on one chart. Plain inline SVG - a handful
// of straight lines does not need a charting library.
function OverlayChart({ results, totalDishes, calendar }) {
  const totalDays = results[0]?.result.days.length ?? 1
  return (
    <div className="flex flex-col gap-2">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-44 w-full rounded-xl border border-slate-200 bg-slate-50" role="img" aria-label="Dishes cooked by the middle player of each segment, day by day">
        {results.map(({ segment, result }, i) => {
          const points = result.days.map((d) => `${totalDays > 1 ? ((d.day - 1) / (totalDays - 1)) * 100 : 0},${40 - (totalDishes > 0 ? (d.p50 / totalDishes) * 40 : 0)}`).join(' ')
          return <polyline key={segment.id} points={points} fill="none" stroke={OVERLAY_COLORS[i % OVERLAY_COLORS.length]} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-400">
        <span>{shortDay(calendar, 1)}</span>
        <span>
          top of the chart = all {totalDishes} dishes · {shortDay(calendar, totalDays)}
        </span>
      </div>
      <div className="flex flex-wrap gap-3">
        {results.map(({ segment }, i) => (
          <span key={segment.id} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: OVERLAY_COLORS[i % OVERLAY_COLORS.length] }} />
            {segment.name}
          </span>
        ))}
      </div>
    </div>
  )
}

function DishTimingTable({ dishes, result, calendar }) {
  return (
    <table className="w-full border-collapse" data-dense data-testid="chef-dish-timing">
      <thead>
        <tr className="border-b border-slate-200">
          <th className={TH}>Dish</th>
          <th className={`${TH} text-center`} title="The share of the players who cook this dish before the event ends, with how far that figure can be off for this number of players.">
            Players who cook it
          </th>
          <th className={`${TH} text-center`} title="Among the players who cook it: the day the fast players do (1 in 10 is earlier), the middle player, and the slow players (1 in 10 is later).">
            When: fast · middle · slow
          </th>
        </tr>
      </thead>
      <tbody>
        {dishes.map((dish) => {
          const stat = result.dishStats.find((s) => s.dishId === dish.id)
          if (!stat) return null
          return (
            <tr key={dish.id} className="border-b border-slate-100 text-sm">
              <td className={`${TD} whitespace-nowrap font-medium text-slate-700`}>
                <span aria-hidden="true">{dish.art ?? ''}</span> {dish.name}
              </td>
              <td className={`${TD} text-center tabular-nums text-slate-600`}>
                {(stat.reachedFraction * 100).toFixed(0)}%{stat.reachedMarginOfError != null && <span className="text-slate-400"> ± {(stat.reachedMarginOfError * 100).toFixed(1)}</span>}
              </td>
              <td className={`${TD} whitespace-nowrap text-center text-slate-500`}>
                {stat.p50 == null ? 'nobody' : `${shortDay(calendar, stat.p10)} · ${shortDay(calendar, stat.p50)} · ${shortDay(calendar, stat.p90)}`}
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
  if (sorted.length === 0) return <p className="text-sm text-slate-400">Nothing is left over: every ingredient a basket gave was used.</p>
  return (
    <table className="w-full border-collapse" data-dense>
      <thead>
        <tr className="border-b border-slate-200">
          <th className={TH}>Ingredient</th>
          <th className={`${TH} text-center`}>Left unused, on average</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((s) => (
          <tr key={s.ingredientId} className="border-b border-slate-100 text-sm">
            <td className={`${TD} font-medium text-slate-700`}>
              <span aria-hidden="true">{ingredientsById[s.ingredientId]?.art ?? ''}</span> {ingredientsById[s.ingredientId]?.name ?? s.ingredientId}
            </td>
            <td className={`${TD} text-center tabular-nums text-slate-600`}>{s.mean.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function NearMissTable({ result, ingredientsById }) {
  if (result.nearMissStats.length === 0) return <p className="text-sm text-slate-400">No player ended with a dish that lacked a single ingredient: either everything is cooked, or a dish lacks several at once.</p>
  return (
    <table className="w-full border-collapse" data-dense>
      <thead>
        <tr className="border-b border-slate-200">
          <th className={TH}>Ingredient</th>
          <th className={`${TH} text-center`}>Players stopped by it alone</th>
        </tr>
      </thead>
      <tbody>
        {result.nearMissStats.map((s) => (
          <tr key={s.ingredientId} className="border-b border-slate-100 text-sm">
            <td className={`${TD} font-medium text-slate-700`}>
              <span aria-hidden="true">{ingredientsById[s.ingredientId]?.art ?? ''}</span> {ingredientsById[s.ingredientId]?.name ?? s.ingredientId}
            </td>
            <td className={`${TD} text-center tabular-nums text-slate-600`}>{(s.runFraction * 100).toFixed(0)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BasketRoiTable({ segment, dishes, baskets, calendar, totalChefPrize }) {
  const unitValue = ingredientUnitValues({ dishes, segment, totalChefPrizeValue: totalChefPrize[segment.prizeTier] ?? 0 })
  const ranked = baskets.map((basket) => ({ basket, value: estimateBasketValue(basket, unitValue, 'gameplay').value })).sort((a, b) => b.value - a.value)
  return (
    <table className="w-full border-collapse" data-dense>
      <thead>
        <tr className="border-b border-slate-200">
          <th className={TH}>Basket</th>
          <th className={`${TH} text-center`} title="What one basket gives on average with its real odds, counted in prize value (the sharing-out of step 5 - not a price).">
            Worth a basket
          </th>
        </tr>
      </thead>
      <tbody>
        {ranked.map(({ basket, value }) => (
          <tr key={basket.id} className="border-b border-slate-100 text-sm">
            <td className={`${TD} font-medium text-slate-700`}>
              {CHEST_LABELS[basket.chestType]} basket, {calendar.phases.find((p) => p.id === basket.phaseId)?.label ?? 'no phase'}
            </td>
            <td className={`${TD} text-center tabular-nums text-slate-600`}>{value.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// What if the segment opened more or fewer baskets than typed: every basket
// type moved by the same share, the event played again for each.
function WhatIfBaskets({ segment, dishes, baskets, calendar, grants, strategy }) {
  const [sweep, setSweep] = useState(null)
  const [running, setRunning] = useState(false)

  function handleRun() {
    setRunning(true)
    setTimeout(() => {
      setSweep(runSensitivitySweep({ segment, dishes, baskets, calendar, grants, strategy }))
      setRunning(false)
    }, 20)
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-600" data-note>
        How the dishes cooked move when {segment.name} opens more or fewer baskets than typed - every basket type by the same share, 150 players each.
      </p>
      <button type="button" onClick={handleRun} disabled={running} data-testid="chef-whatif-run" className="self-start rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
        {running ? 'Playing...' : 'Play it seven ways'}
      </button>
      {sweep && (
        <div className="flex h-32 items-end gap-3" data-testid="chef-whatif-chart">
          {sweep.map((s) => (
            <div key={s.delta} className="flex h-full flex-1 flex-col items-center gap-1" title={`${s.delta >= 0 ? '+' : ''}${s.delta}% baskets: the middle player cooks ${s.medianCompleted} of ${s.totalDishes}`}>
              <span className="text-[11px] font-semibold tabular-nums text-slate-600">{s.medianCompleted}</span>
              <div className="flex w-full flex-1 items-end">
                <div className={`w-full rounded-t-sm ${s.delta === 0 ? 'bg-gradient-to-t from-purple-600 to-fuchsia-500' : 'bg-purple-200'}`} style={{ height: `${s.totalDishes > 0 ? Math.max((s.medianCompleted / s.totalDishes) * 100, 2) : 2}%` }} />
              </div>
              <span className="text-[10px] text-slate-500">{s.delta === 0 ? 'as typed' : `${s.delta > 0 ? '+' : ''}${s.delta}%`}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// The other way round: how many baskets a day it would take to cook a share
// of the dishes by a day. Worked out on averages (no luck), from baskets
// alone - sales and events are not counted, so the answer is on the safe side.
function WhatItTakes({ segment, dishes, baskets, calendar, strategy }) {
  const [targetDay, setTargetDay] = useState(calendar.totalDays)
  const [targetPercent, setTargetPercent] = useState(100)
  const [solution, setSolution] = useState(null)

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-600" data-note>
        How many baskets a day {segment.name} would need. Worked out on averages, from baskets alone: sales and events are not counted, so the answer is on the safe side.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        Cook
        <Num aria-label="Share of the dishes, in %" value={targetPercent} min={1} max={100} onCommit={(n) => setTargetPercent(Math.round(n))} className="w-16" />
        % of the dishes by day
        <Num aria-label="By day" value={targetDay} min={1} max={Math.max(1, calendar.totalDays)} onCommit={(n) => setTargetDay(Math.round(n))} className="w-16" />
        <span className="text-slate-400">({dayLabel(calendar, targetDay)})</span>
        <button
          type="button"
          data-testid="chef-solve"
          onClick={() => setSolution(solveRequiredBasketRate({ segment, dishes, baskets, calendar, targetDay, targetFraction: targetPercent / 100, strategy }))}
          className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white"
        >
          Work it out
        </button>
      </div>
      {solution && !solution.feasible && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="chef-solve-result">
          Not by that day, even with 20 times the baskets {segment.name} opens now.
        </p>
      )}
      {solution?.feasible && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="chef-solve-result">
          It takes about {solution.factor.toFixed(2)} times what {segment.name} opens now: {CHEST_TYPES.map((t) => `${solution.scaledRate[t] ?? 0} ${CHEST_LABELS[t]}`).join(', ')} baskets a day.
        </p>
      )}
    </div>
  )
}

function copyAsTable(results, calendar) {
  const header = ['Day', 'Date', ...results.map(({ segment }) => segment.name)]
  const totalDays = results[0]?.result.days.length ?? 0
  const rows = [header]
  for (let d = 0; d < totalDays; d += 1) rows.push([d + 1, dayLabel(calendar, d + 1), ...results.map(({ result }) => result.days[d].p50)])
  navigator.clipboard?.writeText(rows.map((r) => r.join('\t')).join('\n'))
}

// Every finding of the checks, by kind, each with the way to its step.
function AllChecks({ findings, stepLabels, onGoTo }) {
  if (findings.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
        <CheckCircle2 size={16} className="shrink-0" /> The checks found nothing.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {SEVERITY_ORDER.map((severity) => {
        const items = findings.filter((f) => f.severity === severity)
        if (items.length === 0) return null
        return (
          <div key={severity} className="flex flex-col gap-2" data-checks={severity}>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {SEVERITY_LABELS[severity]} ({items.length})
            </h4>
            {items.map((f, i) => (
              <Finding key={i} finding={f} stepLabel={stepLabels[f.step]} onGoTo={() => onGoTo(f.step)} />
            ))}
          </div>
        )
      })}
    </div>
  )
}

// STEP 4 - SIMULATE: the event played by many players, to see who cooks
// what, and when. One button; what it plays is said beside it and changed
// in a fold. After a run the summary leads - one row a segment - and the
// rest is folded: day by day, the segment in detail, the what-ifs, the full
// list of checks.
//
// The run is kept by ChefApp (`sim`) with a fingerprint of the chef it was
// played on, so it is still there after a look at another step, and is
// marked out of date - never dropped, never shown as current - once the chef
// has been changed.
export default function SimulateStep({ segments, dishes, recompletionDishes, baskets, calendar, grants, ingredients, totalChefPrize, findings, stepLabels, configKey, sim, onSim, onGoTo }) {
  const [leftOut, setLeftOut] = useState(() => new Set())
  const [players, setPlayers] = useState(DEFAULT_PLAYERS)
  const [seed, setSeed] = useState(null)
  const [strategy, setStrategy] = useState('list-order')
  const [dishSet, setDishSet] = useState('main')
  const [progress, setProgress] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [copied, setCopied] = useState(false)

  const ingredientsById = Object.fromEntries(ingredients.map((i) => [i.id, i]))
  const blocking = findings.filter((f) => f.severity === 'block')
  const chosen = segments.filter((s) => !leftOut.has(s.id))
  const dishesOf = (set) => (set === 'main' ? dishes : recompletionDishes)
  const running = progress != null

  function toggle(id) {
    setLeftOut((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // One segment at a time, with a breath between them, so the bar moves and
  // the page stays alive (a run is a plain loop on the page's own thread).
  function handleRun() {
    const list = chosen
    const playDishes = dishesOf(dishSet)
    const run = { dishSet, strategy, players, seed, key: configKey, dishes: playDishes, results: [] }
    setProgress({ done: 0, of: list.length })
    const step = (i) => {
      if (i >= list.length) {
        onSim(run)
        setDetailId(run.results[0]?.segment.id ?? null)
        setProgress(null)
        return
      }
      run.results.push({ segment: list[i], result: simulateMonteCarlo({ segment: list[i], dishes: playDishes, baskets, calendar, grants, runs: players, strategy, seed }) })
      setProgress({ done: i + 1, of: list.length })
      setTimeout(() => step(i + 1), 15)
    }
    setTimeout(() => step(0), 20)
  }

  const results = sim?.results ?? null
  const outOfDate = !!sim && sim.key !== configKey
  const simDishes = sim?.dishes ?? []
  const detail = results?.find((r) => r.segment.id === detailId) ?? results?.[0] ?? null
  // The what-ifs play the chef as it is now, for the segment as it is now.
  const liveSegment = detail ? (segments.find((s) => s.id === detail.segment.id) ?? detail.segment) : null

  function showDetail(id) {
    setDetailId(id)
    const fold = document.querySelector('[data-collapsible="chef-sim-detail"]')
    if (fold) {
      fold.open = true
      fold.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }

  const playsText = `${players.toLocaleString()} players a segment · ${chosen.length === segments.length ? `all ${segments.length} segments` : `${chosen.length} of ${segments.length} segments`} · ${
    dishSet === 'main' ? 'the dishes' : 'the Recompletion dishes'
  } · a player ${STRATEGY_LABELS[strategy]}`

  return (
    <div className="flex flex-col gap-4">
      <Card>
        {blocking.length > 0 && (
          <div className="mb-4 flex flex-col gap-2" data-testid="chef-sim-missing">
            <p className="text-sm font-semibold text-slate-800">
              {blocking.length === 1 ? 'One thing needs a fix' : `${blocking.length} things need a fix`} before this event can ship. The simulation still runs, on the event as it is.
            </p>
            {blocking.map((f, i) => (
              <Finding key={i} finding={f} stepLabel={stepLabels[f.step]} onGoTo={() => onGoTo(f.step)} />
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <button
            type="button"
            onClick={handleRun}
            disabled={running || chosen.length === 0 || dishesOf(dishSet).length === 0}
            data-testid="chef-run"
            className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-purple-500/30 disabled:opacity-50"
          >
            <PlayCircle size={15} /> {running ? 'Playing...' : results ? 'Run the simulation again' : 'Run the simulation'}
          </button>
          <p className="min-w-0 flex-1 text-sm text-slate-600" data-testid="chef-run-plays">
            {segments.length === 0 ? 'No segment to play yet (step 1).' : dishesOf(dishSet).length === 0 ? 'No dishes to cook yet (step 2).' : chosen.length === 0 ? 'Pick at least one segment.' : playsText}
          </p>
        </div>
        {running && (
          <div className="mt-3" data-testid="chef-run-progress">
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-purple-600 to-fuchsia-500 transition-all" style={{ width: `${progress.of > 0 ? (progress.done / progress.of) * 100 : 0}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Segment {Math.min(progress.done + 1, progress.of)} of {progress.of}
            </p>
          </div>
        )}
        <details className="mt-3" data-collapsible="chef-run-options">
          <summary className="cursor-pointer text-xs font-semibold text-purple-700">Change what is played</summary>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                Cooking
                <Toggle
                  data-testid="chef-run-dishes"
                  value={dishSet}
                  onChange={setDishSet}
                  options={[
                    ['main', 'The dishes'],
                    ['recompletion', 'The Recompletion dishes'],
                  ]}
                />
              </label>
              <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                A player
                <select value={strategy} data-testid="chef-run-strategy" onChange={(e) => setStrategy(e.target.value)} className={SELECT}>
                  {Object.entries(STRATEGY_LABELS).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                Players a segment
                <Num data-testid="chef-run-players" value={players} min={10} max={5000} onCommit={(n) => setPlayers(Math.round(n))} className="w-20" />
              </label>
              <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600" title="Type any whole number to play the very same players again: two runs then differ only by what you changed in the event. Empty: new players each run.">
                The same players every run
                <Num data-testid="chef-run-seed" value={seed} allowEmpty min={0} max={2147483647} placeholder="new each run" onCommit={(n) => setSeed(n == null ? null : Math.round(n))} className="w-32" />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2" data-testid="chef-run-segments">
              <span className="text-sm text-slate-600">Segments</span>
              {segments.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={!leftOut.has(s.id)}
                  onClick={() => toggle(s.id)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${leftOut.has(s.id) ? 'border border-slate-200 bg-white/70 text-slate-500' : 'bg-purple-600 text-white'}`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        </details>
      </Card>

      {!results && !running && <p className="text-sm text-slate-500">Nothing has been simulated yet for this chef.</p>}

      {results && (
        <>
          {outOfDate && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="chef-sim-out-of-date">
              Out of date: the event was changed after this run. The figures below are for the event as it was - run the simulation again.
            </p>
          )}
          <Card
            title={sim.dishSet === 'main' ? 'The event, simulated' : 'The Recompletion round, simulated'}
            subtitle={`${sim.players.toLocaleString()} players a segment; a player ${STRATEGY_LABELS[sim.strategy]}.`}
            action={
              <button
                type="button"
                onClick={() => {
                  copyAsTable(results, calendar)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
                title="The dishes the middle player of each segment has cooked, day by day - to paste into a spreadsheet."
                className="whitespace-nowrap text-xs font-semibold text-purple-600 hover:text-purple-800"
              >
                {copied ? 'Copied' : 'Copy day by day'}
              </button>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse" data-dense data-testid="chef-sim-summary">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className={TH}>Segment</th>
                    <th className={`${TH} text-center`} title="The dishes the middle player has cooked when the event ends: half the players cook more, half fewer.">
                      Dishes cooked
                    </th>
                    <th className={`${TH} text-center`} title="From the slow players to the fast ones: 1 player in 10 cooks fewer than the first figure, 1 in 10 more than the second.">
                      Most players
                    </th>
                    <th className={`${TH} text-center`} title="The share of the players who cook every dish, with how far that figure can be off for this number of players.">
                      Cook every dish
                    </th>
                    <th className={`${TH} text-center`} title="The day the middle player cooks a first dish.">
                      First dish
                    </th>
                    <th className={`${TH} text-center`} title="The longest run of days without a dish, for the middle player (the days after the last dish count).">
                      Longest wait
                    </th>
                    <th className={TH} aria-label="Detail" />
                  </tr>
                </thead>
                <tbody>
                  {results.map(({ segment, result }) => {
                    const last = result.days[result.days.length - 1]
                    const stalled = result.stalledStats
                    return (
                      <tr key={segment.id} className="border-b border-slate-100 text-sm" data-sim-segment={segment.id}>
                        <td className={`${TD} font-semibold text-slate-800`}>{segment.name}</td>
                        <td className={`${TD} text-center tabular-nums text-slate-700`} data-cell="dishes">
                          {last.p50} of {result.totalDishes}
                        </td>
                        <td className={`${TD} text-center tabular-nums text-slate-500`}>
                          {last.p10} to {last.p90}
                        </td>
                        <td className={`${TD} text-center tabular-nums text-slate-700`} data-cell="every-dish">
                          {(last.fullClearFraction * 100).toFixed(0)}%{last.fullClearMarginOfError != null && <span className="text-slate-400"> ± {(last.fullClearMarginOfError * 100).toFixed(1)}</span>}
                        </td>
                        <td className={`${TD} whitespace-nowrap text-center text-slate-600`}>
                          {stalled.firstCraftDayP50 == null ? 'never' : shortDay(calendar, stalled.firstCraftDayP50)}
                          {stalled.neverCraftedFraction > 0 && stalled.firstCraftDayP50 != null && <span className="text-amber-700"> ({(stalled.neverCraftedFraction * 100).toFixed(0)}% never)</span>}
                        </td>
                        <td className={`${TD} text-center tabular-nums text-slate-600`}>{stalled.longestGapP50 == null ? '-' : `${stalled.longestGapP50} ${stalled.longestGapP50 === 1 ? 'day' : 'days'}`}</td>
                        <td className={`${TD} text-right`}>
                          <button type="button" onClick={() => showDetail(segment.id)} className="whitespace-nowrap text-xs font-semibold text-purple-600 hover:text-purple-800">
                            Dish by dish
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-slate-500" data-testid="chef-sim-legend" data-note>
              These are simulated players, each with their own luck and their own days of play: one player differs from the next, and another run gives slightly different figures. Point at a column head for what it means.
            </p>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
            <Collapsible id="chef-sim-curves" className="xl:open:col-span-2" title="Day by day, each segment" summary="The dishes cooked on every day of the event: the middle player, and from the slow players to the fast ones">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                {results.map(({ segment, result }) => (
                  <SegmentCurve key={segment.id} segment={segment} result={result} totalDishes={result.totalDishes} calendar={calendar} />
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-500">The solid bar is the middle player; the lighter band runs from the slow players to the fast ones. A thin line marks a new phase.</p>
            </Collapsible>

            {results.length > 1 && (
              <Collapsible id="chef-sim-overlay" className="xl:open:col-span-2" title="All segments on one chart" summary="The middle player of every segment, to compare them">
                <OverlayChart results={results} totalDishes={results[0].result.totalDishes} calendar={calendar} />
              </Collapsible>
            )}

            {detail && (
              <Collapsible
                id="chef-sim-detail"
                className="scroll-mt-4 xl:open:col-span-2"
                title={`${detail.segment.name}: dish by dish`}
                summary="When each dish is cooked, what is left over, what stops players, and which basket gives the most"
              >
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-2" data-testid="chef-detail-segments">
                    <span className="text-sm text-slate-600">Segment</span>
                    {results.map(({ segment }) => (
                      <button
                        key={segment.id}
                        type="button"
                        aria-pressed={detail.segment.id === segment.id}
                        onClick={() => setDetailId(segment.id)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${detail.segment.id === segment.id ? 'bg-purple-600 text-white' : 'border border-slate-200 bg-white/70 text-slate-500'}`}
                      >
                        {segment.name}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
                    <div className="rounded-2xl border border-slate-200 bg-white/70 p-3">
                      <h4 className="mb-2 text-sm font-semibold text-slate-800">When each dish is cooked</h4>
                      <DishTimingTable dishes={simDishes} result={detail.result} calendar={calendar} />
                    </div>
                    <div className="flex flex-col gap-4">
                      <div className="rounded-2xl border border-slate-200 bg-white/70 p-3">
                        <h4 className="mb-1 text-sm font-semibold text-slate-800">What stops a player</h4>
                        <p className="mb-2 text-xs text-slate-500">Players who end the event with a dish that lacks one ingredient only - and which one.</p>
                        <NearMissTable result={detail.result} ingredientsById={ingredientsById} />
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white/70 p-3">
                        <h4 className="mb-1 text-sm font-semibold text-slate-800">Left over when the event ends</h4>
                        <p className="mb-2 text-xs text-slate-500">A lot left over means the baskets give more of an ingredient than the dishes need.</p>
                        <LeftoverTable result={detail.result} ingredientsById={ingredientsById} />
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white/70 p-3">
                        <h4 className="mb-1 text-sm font-semibold text-slate-800">Which basket gives the most</h4>
                        <p className="mb-2 text-xs text-slate-500">With the real odds, for this segment's prize size.</p>
                        <BasketRoiTable segment={detail.segment} dishes={simDishes} baskets={baskets} calendar={calendar} totalChefPrize={totalChefPrize} />
                      </div>
                    </div>
                  </div>
                </div>
              </Collapsible>
            )}

            {liveSegment && (
              <Collapsible id="chef-sim-whatif" title={`${liveSegment.name}: more or fewer baskets`} summary="Play the event with 30% fewer to 30% more baskets a day">
                <WhatIfBaskets key={liveSegment.id} segment={liveSegment} dishes={dishesOf(sim.dishSet)} baskets={baskets} calendar={calendar} grants={grants} strategy={sim.strategy} />
              </Collapsible>
            )}
            {liveSegment && (
              <Collapsible id="chef-sim-takes" title={`${liveSegment.name}: what it would take`} summary="The baskets a day needed to cook a share of the dishes by a day">
                <WhatItTakes key={liveSegment.id} segment={liveSegment} dishes={dishesOf(sim.dishSet)} baskets={baskets} calendar={calendar} strategy={sim.strategy} />
              </Collapsible>
            )}
          </div>
        </>
      )}

      <Collapsible
        id="chef-checks"
        title="All the checks"
        summary={
          findings.length === 0
            ? 'Nothing found'
            : SEVERITY_ORDER.map((severity) => [severity, findings.filter((f) => f.severity === severity).length])
                .filter(([, n]) => n > 0)
                .map(([severity, n]) => `${n} ${SEVERITY_LABELS[severity].toLowerCase()}`)
                .join(' · ')
        }
      >
        <AllChecks findings={findings} stepLabels={stepLabels} onGoTo={onGoTo} />
      </Collapsible>
    </div>
  )
}
