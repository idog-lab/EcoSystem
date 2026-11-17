import { useMemo, useState } from 'react'
import Card from '../../../components/ui/Card'
import NumberField from '../../../components/ui/NumberField'
import { phaseForDay, basketsForPhase, estimateMarginalBasketValue } from '../lib/chefSimulation'
import { ingredientUnitValues, estimateBasketValue } from '../lib/chefBasketValue'
import { CHEST_LABELS, PRIZE_TIERS, SEGMENT_PRIZE_MULTIPLIER, createSegment, calendarDateForDay, formatCalendarDate } from '../lib/chefModel'

const CHEST_COLOR = {
  basic: 'from-sky-500 to-sky-400',
  rare: 'from-violet-500 to-violet-400',
  epic: 'from-fuchsia-600 to-purple-500',
}

// Paired-simulation marginal value - by explicit economist brainstorm ask
// (a GPT review's methodology critique of the allocation-based estimate
// above): "if this segment got ONE extra basket on this exact day, how
// much more REWARD does it end up with." See chefSimulation.js's
// estimateMarginalBasketValue doc comment for the full reasoning - this is
// an incremental IN-GAME reward estimate, not a real-money fair price.
function MarginalValuePanel({ segment, dishes, baskets, calendar, grants, totalChefPrize }) {
  const [chestType, setChestType] = useState('basic')
  const [day, setDay] = useState(1)
  const [runs, setRuns] = useState(300)
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)

  function handleRun() {
    setRunning(true)
    setTimeout(() => {
      setResult(
        estimateMarginalBasketValue({
          segment,
          dishes,
          baskets,
          calendar,
          grants,
          totalChefPrizeValue: totalChefPrize[segment.prizeTier] ?? 0,
          chestType,
          day,
          runs,
        })
      )
      setRunning(false)
    }, 20)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Basket type</span>
          <select value={chestType} onChange={(e) => setChestType(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-2 bg-white/70">
            {Object.entries(CHEST_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <NumberField label="On day" min={1} max={calendar.totalDays} value={day} onChange={(e) => setDay(Number(e.target.value) || 1)} className="w-24" />
        <NumberField label="Runs (paired)" min={50} max={5000} value={runs} onChange={(e) => setRuns(Number(e.target.value) || 300)} className="w-28" />
        <button type="button" onClick={handleRun} disabled={running} className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-purple-600 text-white disabled:opacity-50">
          {running ? 'Running…' : 'Run paired simulation'}
        </button>
      </div>
      {result && (
        <div className="text-sm bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-emerald-900">
          One extra {CHEST_LABELS[chestType].toLowerCase()} basket for {segment.name} on day {day} changes mean reward payout by{' '}
          <span className="font-semibold">{result.meanPayoutDelta >= 0 ? '+' : ''}{result.meanPayoutDelta.toFixed(3)}</span>
          {' '}(baseline {result.baselineMeanPayout.toFixed(2)} → {result.treatmentMeanPayout.toFixed(2)}), and full-clear probability by{' '}
          <span className="font-semibold">
            {result.fullClearDelta >= 0 ? '+' : ''}
            {(result.fullClearDelta * 100).toFixed(1)} pts
          </span>{' '}
          — {result.runs} paired runs, seed {result.seed}.
        </div>
      )}
    </div>
  )
}

export default function BasketValueTab({ dishes, recompletionDishes, baskets, calendar, totalChefPrize, ingredients, segments, grants }) {
  const [tier, setTier] = useState('low')
  const [dishSet, setDishSet] = useState('main')
  const [marginalSegmentId, setMarginalSegmentId] = useState(segments[0]?.id ?? null)
  const activeDishes = dishSet === 'main' ? dishes : recompletionDishes
  const marginalSegment = segments.find((s) => s.id === marginalSegmentId) ?? segments[0]
  const tierSegment = useMemo(() => createSegment({ id: 'tier-preview', name: tier, prizeTier: tier }), [tier])

  const unitValue = useMemo(
    () => ingredientUnitValues({ dishes: activeDishes, segment: tierSegment, totalChefPrizeValue: totalChefPrize[tier] ?? 0 }),
    [activeDishes, tierSegment, totalChefPrize, tier]
  )

  const byDay = useMemo(() => {
    const days = []
    for (let day = 1; day <= calendar.totalDays; day += 1) {
      const phase = phaseForDay(calendar, day)
      const basketsByChestType = basketsForPhase(baskets, phase?.id)
      const perChestType = {}
      for (const chestType of Object.keys(CHEST_LABELS)) {
        const basket = basketsByChestType[chestType]
        perChestType[chestType] = basket ? estimateBasketValue(basket, unitValue) : null
      }
      days.push({ day, phaseId: phase?.id, perChestType })
    }
    return days
  }, [baskets, calendar, unitValue])

  const maxValue = Math.max(1, ...byDay.flatMap((d) => Object.values(d.perChestType).map((v) => v?.value ?? 0)))

  return (
    <div className="flex flex-col gap-4">
      <Card title="Dish set" subtitle="Value ingredients against the main dish list, or the Recompletion round's own recipes.">
        <div className="flex gap-2">
          {[
            ['main', 'Dishes'],
            ['recompletion', 'Recompletion dishes'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setDishSet(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${dishSet === id ? 'bg-purple-600 text-white' : 'bg-white/70 text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Prize tier" subtitle="Which segment prize tier's dish values to estimate against — see Segments tab for which segments use which tier.">
        <div className="flex gap-2">
          {PRIZE_TIERS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTier(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${tier === t ? 'bg-purple-600 text-white' : 'bg-white/70 text-slate-600'}`}
            >
              {t} (×{SEGMENT_PRIZE_MULTIPLIER[t]})
            </button>
          ))}
        </div>
      </Card>

      <Card
        title="Estimated basket value by calendar day (allocation-based)"
        subtitle='Static recipe-based value allocation, not a real price — ignores complementarity, saturation, and timing. Good for "which ingredients are structurally load-bearing," not for "is this basket worth opening." See the paired-simulation estimate below for that.'
      >
        <div className="flex items-end gap-[2px] h-40">
          {byDay.map((d) => (
            <div
              key={d.day}
              className="flex-1 flex items-end gap-[1px] relative"
              title={`${formatCalendarDate(calendarDateForDay(calendar, d.day)) ?? `Day ${d.day}`} (${d.phaseId})`}
            >
              {d.day > 1 && d.phaseId !== byDay[d.day - 2].phaseId && <div className="absolute -left-px top-0 bottom-0 w-px bg-slate-300" />}
              {Object.entries(d.perChestType).map(([chestType, v]) => (
                <div
                  key={chestType}
                  className={`flex-1 rounded-t-sm bg-gradient-to-t ${CHEST_COLOR[chestType]}`}
                  style={{ height: `${v ? Math.max((v.value / maxValue) * 100, 2) : 0}%` }}
                  title={`${CHEST_LABELS[chestType]}: ${v?.value?.toFixed(2) ?? '—'}`}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-slate-400 mt-1">
          <span>{formatCalendarDate(calendarDateForDay(calendar, 1)) ?? 'Day 1'}</span>
          <span>{formatCalendarDate(calendarDateForDay(calendar, calendar.totalDays)) ?? `Day ${calendar.totalDays}`}</span>
        </div>
        <div className="flex gap-4 mt-3 text-xs text-slate-500">
          {Object.entries(CHEST_LABELS).map(([chestType, label]) => (
            <span key={chestType} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm bg-gradient-to-t ${CHEST_COLOR[chestType]}`} /> {label}
            </span>
          ))}
        </div>
      </Card>

      <Card title="Per-ingredient unit value" subtitle="Each ingredient's estimated prize-equivalent value per single unit, at the selected tier — what the basket chart above is built from.">
        <table className="min-w-full text-xs">
          <thead>
            <tr>
              <th className="text-left font-semibold text-slate-500 px-2 py-1">Ingredient</th>
              <th className="text-center font-semibold text-slate-500 px-2 py-1">Value / unit</th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map((ing) => (
              <tr key={ing.id} className="border-t border-slate-100">
                <td className="px-2 py-1 font-medium text-slate-700">{ing.name}</td>
                <td className="px-2 py-1 text-center text-slate-600">{(unitValue[ing.id] ?? 0).toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card
        title="Marginal basket value (paired simulation)"
        subtitle='The sharper question: "how much does ONE extra basket actually change eventual reward payout," under the real simulated economy, inventory, competing recipes, and grants — not a static allocation.'
      >
        <div className="flex gap-2 mb-3">
          {segments.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setMarginalSegmentId(s.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${marginalSegmentId === s.id ? 'bg-purple-600 text-white' : 'bg-white/70 text-slate-500 border border-slate-200'}`}
            >
              {s.name}
            </button>
          ))}
        </div>
        {marginalSegment && (
          <MarginalValuePanel segment={marginalSegment} dishes={activeDishes} baskets={baskets} calendar={calendar} grants={grants} totalChefPrize={totalChefPrize} />
        )}
      </Card>
    </div>
  )
}
