import { useMemo, useState } from 'react'
import Card from '../../../components/ui/Card'
import Collapsible from '../../../components/ui/Collapsible'
import { phaseForDay, basketsForPhase, estimateMarginalBasketValue } from '../lib/chefSimulation'
import { ingredientUnitValues, estimateBasketValue } from '../lib/chefBasketValue'
import { CHEST_LABELS, CHEST_TYPES, PRIZE_TIERS, SEGMENT_PRIZE_MULTIPLIER, createSegment } from '../lib/chefModel'
import { dayLabel, shortDay } from '../lib/chefFormat'
import { Num, Toggle, SELECT, TD, TH } from './chefUi'

const CHEST_COLOR = {
  basic: 'from-sky-500 to-sky-400',
  rare: 'from-violet-500 to-violet-400',
  epic: 'from-fuchsia-600 to-purple-500',
}

// ONE MORE BASKET: WHAT IT CHANGES. The same players are played twice - once
// as they are, once with one more basket of a type on a day
// (estimateMarginalBasketValue) - and the prizes they end with are compared.
// A figure in prize value, not in money.
// A ROUGH FIGURE, AND THE SCREEN SAYS SO. The two plays share their players
// and their days of play, but not the luck of the baskets: the extra basket
// takes its rolls from the same stream as every other basket, so every
// basket opened after it - by that player and by all the players after -
// rolls differently in the second play. Measured on the Halloween chef, 300
// players: one more basket that gives NOTHING moved the average prize by
// 0.63, and one more Basic basket on day 1 gave +3.4, +3.9, +3.5, +6.4, -0.6
// and +2.4 on six sets of players. Giving the extra basket a stream of its
// own (chefRng.js) would make the two plays differ by that basket alone; it
// is a change to the model and was not made - written down for the economist.
function OneMoreBasket({ segments, dishes, baskets, calendar, grants, totalChefPrize }) {
  const [segmentId, setSegmentId] = useState(segments[0]?.id ?? null)
  const [chestType, setChestType] = useState('basic')
  const [day, setDay] = useState(1)
  const [players, setPlayers] = useState(300)
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)
  const segment = segments.find((s) => s.id === segmentId) ?? segments[0]

  if (!segment) return <p className="text-sm text-slate-400">No segment to play yet (step 1).</p>

  function handleRun() {
    setRunning(true)
    setTimeout(() => {
      const figures = estimateMarginalBasketValue({ segment, dishes, baskets, calendar, grants, totalChefPrizeValue: totalChefPrize[segment.prizeTier] ?? 0, chestType, day, runs: players })
      setResult({ ...figures, segmentName: segment.name, chestType, day })
      setRunning(false)
    }, 20)
  }

  const signed = (n, digits) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        One more
        <select value={chestType} aria-label="Basket type" data-testid="chef-more-type" onChange={(e) => setChestType(e.target.value)} className={SELECT}>
          {CHEST_TYPES.map((id) => (
            <option key={id} value={id}>
              {CHEST_LABELS[id]}
            </option>
          ))}
        </select>
        basket for
        <select value={segment.id} aria-label="Segment" data-testid="chef-more-segment" onChange={(e) => setSegmentId(e.target.value)} className={SELECT}>
          {segments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        on day
        <Num aria-label="Day" data-testid="chef-more-day" value={day} min={1} max={Math.max(1, calendar.totalDays)} onCommit={(n) => setDay(Math.round(n))} className="w-16" />
        <span className="text-slate-400">({dayLabel(calendar, day)})</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={handleRun} disabled={running || dishes.length === 0} data-testid="chef-more-run" className="whitespace-nowrap rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {running ? 'Playing...' : 'Play it both ways'}
        </button>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Players
          <Num aria-label="Players" value={players} min={50} max={5000} onCommit={(n) => setPlayers(Math.round(n))} className="w-20" />
        </label>
      </div>
      <p className="text-xs text-slate-500" data-testid="chef-more-caveat" data-note>
        A rough figure: in the second play the baskets opened after the extra one get other luck too, so the result moves from run to run - with few players by more than the figure itself. Play it a
        few times, or with more players, before reading it.
      </p>
      {result && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700" data-testid="chef-more-result" title={`The players of this run: number ${result.seed}`}>
          One more {CHEST_LABELS[result.chestType]} basket for {result.segmentName} on {dayLabel(calendar, result.day)} changes the prizes a player ends with by{' '}
          <span className="font-semibold">{signed(result.meanPayoutDelta, 3)}</span> on average (from {result.baselineMeanPayout.toFixed(2)} to {result.treatmentMeanPayout.toFixed(2)}), and the share who cook
          every dish by <span className="font-semibold">{signed(result.fullClearDelta * 100, 1)} points</span>. {result.runs.toLocaleString()} players, played twice.
        </p>
      )}
    </div>
  )
}

// STEP 5 - BASKET VALUE: what a basket is worth to a player, two ways.
//   - Day by day, a SHARING-OUT (chefBasketValue.js): each dish's prize, and
//     the prize for cooking every dish, is spread over the ingredients its
//     recipe needs, and a basket is worth what it gives on average with its
//     pricing odds. It shows which ingredients carry the prizes. It is not a
//     price: it does not know that an ingredient is only worth something
//     with the others a recipe needs, or that a dish already cooked needs no
//     more of it.
//   - One more basket, PLAYED: see OneMoreBasket above (a rough figure).
export default function ValueStep({ dishes, recompletionDishes, baskets, calendar, totalChefPrize, ingredients, segments, grants }) {
  const [tier, setTier] = useState('low')
  const [dishSet, setDishSet] = useState('main')
  const activeDishes = dishSet === 'main' ? dishes : recompletionDishes
  const tierSegment = useMemo(() => createSegment({ id: 'tier-preview', name: tier, prizeTier: tier }), [tier])
  const unitValue = useMemo(() => ingredientUnitValues({ dishes: activeDishes, segment: tierSegment, totalChefPrizeValue: totalChefPrize[tier] ?? 0 }), [activeDishes, tierSegment, totalChefPrize, tier])

  const byDay = useMemo(() => {
    const days = []
    for (let day = 1; day <= calendar.totalDays; day += 1) {
      const phase = phaseForDay(calendar, day)
      const basketsByChestType = basketsForPhase(baskets, phase?.id)
      const perChestType = {}
      for (const chestType of CHEST_TYPES) {
        const basket = basketsByChestType[chestType]
        perChestType[chestType] = basket ? estimateBasketValue(basket, unitValue) : null
      }
      days.push({ day, phase, perChestType })
    }
    return days
  }, [baskets, calendar, unitValue])

  const maxValue = Math.max(0, ...byDay.flatMap((d) => Object.values(d.perChestType).map((v) => v?.value ?? 0)))
  // One line a phase: within a phase a basket is worth the same every day.
  const byPhase = calendar.phases.map((phase) => ({ phase, perChestType: byDay.find((d) => d.phase?.id === phase.id)?.perChestType ?? {} }))
  const valued = [...ingredients].sort((a, b) => (unitValue[b.id] ?? 0) - (unitValue[a.id] ?? 0))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          Valued against
          <Toggle
            data-testid="chef-value-dishes"
            value={dishSet}
            onChange={setDishSet}
            options={[
              ['main', 'The dishes'],
              ['recompletion', 'The Recompletion dishes'],
            ]}
          />
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          Prize size
          <Toggle data-testid="chef-value-tier" value={tier} onChange={setTier} options={PRIZE_TIERS.map((t) => [t, `${t} (x${SEGMENT_PRIZE_MULTIPLIER[t]})`])} />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start">
        <Card
          title="5. What a basket is worth, day by day"
          subtitle="Each dish's prize, and the prize for cooking every dish, shared out over the ingredients its recipe needs; a basket is worth what it gives on average with its pricing odds. It shows which ingredients carry the prizes - it is not a price."
        >
          {maxValue > 0 ? (
            <>
              <div className="flex h-40 items-end gap-[2px]" data-testid="chef-value-chart">
                {byDay.map((d, i) => (
                  <div key={d.day} className="relative flex h-full flex-1 items-end gap-[1px]" title={`${dayLabel(calendar, d.day)}${d.phase ? `, ${d.phase.label}` : ''}`}>
                    {i > 0 && d.phase?.id !== byDay[i - 1].phase?.id && <div className="absolute -left-px bottom-0 top-0 w-px bg-slate-300" />}
                    {CHEST_TYPES.map((chestType) => {
                      const v = d.perChestType[chestType]
                      return (
                        <div
                          key={chestType}
                          data-bar={chestType}
                          className={`flex-1 rounded-t-sm bg-gradient-to-t ${CHEST_COLOR[chestType]}`}
                          style={{ height: `${v ? Math.max((v.value / maxValue) * 100, 2) : 0}%` }}
                          title={`${dayLabel(calendar, d.day)}, ${CHEST_LABELS[chestType]} basket: ${v ? v.value.toFixed(2) : 'no basket set'}`}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                <span>{shortDay(calendar, 1)}</span>
                <span>{shortDay(calendar, calendar.totalDays)}</span>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400" data-testid="chef-value-empty">
              Nothing to show yet: the dishes have no prizes, or no basket gives an ingredient a dish needs.
            </p>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse" data-dense data-testid="chef-value-table">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={TH}>Phase</th>
                  {CHEST_TYPES.map((chestType) => (
                    <th key={chestType} className={`${TH} text-center`}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`h-2.5 w-2.5 rounded-sm bg-gradient-to-t ${CHEST_COLOR[chestType]}`} /> {CHEST_LABELS[chestType]} basket
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byPhase.map(({ phase, perChestType }) => (
                  <tr key={phase.id} className="border-b border-slate-100 text-sm">
                    <td className={`${TD} font-medium text-slate-700`}>{phase.label}</td>
                    {CHEST_TYPES.map((chestType) => (
                      <td key={chestType} className={`${TD} text-center tabular-nums text-slate-600`}>
                        {perChestType[chestType] ? perChestType[chestType].value.toFixed(2) : 'no basket'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="One more basket: what it changes"
          subtitle="The same players are played twice - as they are, and with one more basket on the day you pick - and the prizes they end with are compared. In prize value, not in money."
        >
          <OneMoreBasket segments={segments} dishes={activeDishes} baskets={baskets} calendar={calendar} grants={grants} totalChefPrize={totalChefPrize} />
        </Card>
      </div>

      <Collapsible id="chef-unit-values" title="What one of each ingredient counts for" summary="The share of the prizes that falls on one unit of each ingredient - what the chart above is made from">
        <table className="w-full max-w-xl border-collapse" data-dense data-testid="chef-unit-values">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={TH}>Ingredient</th>
              <th className={`${TH} text-center`}>Counts for, a unit</th>
            </tr>
          </thead>
          <tbody>
            {valued.map((ing) => (
              <tr key={ing.id} className="border-b border-slate-100 text-sm">
                <td className={`${TD} font-medium text-slate-700`}>
                  <span aria-hidden="true">{ing.art ?? ''}</span> {ing.name}
                </td>
                <td className={`${TD} text-center tabular-nums text-slate-600`}>{(unitValue[ing.id] ?? 0).toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Collapsible>
    </div>
  )
}
