import { useMemo, useState } from 'react'
import Card from '../../../components/ui/Card'
import Collapsible from '../../../components/ui/Collapsible'
import { oneMoreBasket } from '../lib/chefEngine'
import { ingredientUnitValues, estimateBasketValue } from '../lib/chefBasketValue'
import { CHEST_LABELS, CHEST_TYPES, VARIATIONS, VARIATION_LABELS, basketsForPhase, phaseForDay } from '../lib/chefModel'
import { dayLabel, shortDay, num, pct } from '../lib/chefFormat'
import { Num, Toggle, SELECT, TD, TH } from './chefUi'

const CHEST_COLOR = {
  basic: 'from-sky-500 to-sky-400',
  rare: 'from-violet-500 to-violet-400',
  epic: 'from-fuchsia-600 to-purple-500',
}

// ONE MORE BASKET, PLAYED. The same players are played twice on the rule
// engine - as they are, and with one more basket of a type on a day - and each
// player is compared with themself. Every other basket rolls exactly what it
// rolled (each basket has random streams of its own), so the difference is
// what that one basket did: thresholds, the pantry, presets and Recompletion
// included. (Before the rebuild the extra basket shifted the luck of every
// basket after it, and the figure moved from run to run by more than itself.)
function OneMoreBasket({ state }) {
  const { segments, calendar } = state
  const [segmentId, setSegmentId] = useState(segments[0]?.id ?? null)
  const [chestType, setChestType] = useState('basic')
  const [day, setDay] = useState(1)
  const [players, setPlayers] = useState(300)
  const [variation, setVariation] = useState('activity')
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)
  const segment = segments.find((s) => s.id === segmentId) ?? segments[0]

  if (!segment) return <p className="text-sm text-slate-400">No segment to play yet (step 1).</p>

  function handleRun() {
    setRunning(true)
    setTimeout(() => {
      const figures = oneMoreBasket(state, segment, { chestType, day, players, variation })
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
        <button type="button" onClick={handleRun} disabled={running || state.dishes.length === 0} data-testid="chef-more-run" className="whitespace-nowrap rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {running ? 'Playing...' : 'Play it both ways'}
        </button>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Players
          <Num aria-label="Players" value={players} min={50} max={5000} onCommit={(n) => setPlayers(Math.round(n))} className="w-20" />
        </label>
        <Toggle value={variation} onChange={setVariation} options={VARIATIONS.map((id) => [id, VARIATION_LABELS[id]])} />
      </div>
      <p className="text-xs text-slate-500" data-testid="chef-more-caveat" data-note>
        Each player is played twice and compared with themself; every other basket rolls exactly what it rolled, so the figure is what this one basket changes. It is an average over the players played: with
        other players it moves a little, and most single players are not changed at all by one basket.
      </p>
      {result && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700" data-testid="chef-more-result" title={`The players of this run: number ${result.seed}`}>
          One more {CHEST_LABELS[result.chestType]} basket for {result.segmentName} on {dayLabel(calendar, result.day)} changes what a player is paid by <span className="font-semibold">{signed(result.payoutDelta, 3)}</span> on average (from{' '}
          {num(result.base.payout.mean, 2)} to {num(result.changed.payout.mean, 2)}, in allowance worth), and the dishes cooked by <span className="font-semibold">{signed(result.dishesDelta, 3)}</span>.{' '}
          <span className="font-semibold">{pct(result.changedShare, 1)}</span> of the players end differently; the share who finish the Main round goes from {pct(result.base.finish.share, 1)} to {pct(result.changed.finish.share, 1)}.{' '}
          {result.players.toLocaleString()} players, each played twice.
          {!result.base.payout.complete && <span className="text-amber-800"> Some prizes are unknown and are not counted.</span>}
        </p>
      )}
    </div>
  )
}

// STEP 5 - BASKET VALUE.
//   One more basket, played: on the rule engine, a clean comparison (above).
//   The older estimate ("the sharing-out"): kept from before the rebuild and
//   labelled as such - it ignores thresholds, the pantry, presets, special
//   sources and Recompletion. A basket valuation on the new engine is a
//   later build.
export default function ValueStep({ state }) {
  const { segments, baskets, calendar, ingredients } = state
  const [segmentId, setSegmentId] = useState(segments[0]?.id ?? null)
  const [round, setRound] = useState('main')
  const segment = segments.find((s) => s.id === segmentId) ?? segments[0] ?? null
  const { unitValue, incomplete } = useMemo(() => (segment ? ingredientUnitValues(state, segment, round) : { unitValue: {}, incomplete: false }), [state, segment, round])

  const byDay = useMemo(() => {
    const days = []
    for (let day = 1; day <= calendar.totalDays; day += 1) {
      const phase = phaseForDay(calendar, day)
      const byType = basketsForPhase(baskets, phase?.id)
      days.push({ day, phase, perChestType: Object.fromEntries(CHEST_TYPES.map((type) => [type, byType[type] ? estimateBasketValue(byType[type], unitValue) : null])) })
    }
    return days
  }, [baskets, calendar, unitValue])

  const maxValue = Math.max(0, ...byDay.flatMap((d) => Object.values(d.perChestType).map((v) => v?.value ?? 0)))
  const byPhase = calendar.phases.map((phase) => ({ phase, perChestType: byDay.find((d) => d.phase?.id === phase.id)?.perChestType ?? {} }))
  const valued = [...ingredients].sort((a, b) => (unitValue[b.id] ?? 0) - (unitValue[a.id] ?? 0))

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] xl:items-start">
        <Card title="5. One more basket: what it changes" subtitle="The same players, played twice on the event as it is - thresholds, pantry, presets and Recompletion included. In allowance worth, not in money.">
          <OneMoreBasket state={state} />
        </Card>

        <Card
          title="The older estimate: a sharing-out, day by day"
          subtitle="Kept from before the rebuild, and not rebuilt. Each dish's prize is shared over the ingredients its recipe needs; a basket counts for what it gives on average with its pricing odds."
        >
          <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="chef-value-legacy" data-note>
            An older estimate, out of step with the rebuilt event: it does not know progression thresholds, pantry caps, catch-up presets, special sources or Recompletion, and it counts an ingredient as worth
            something on its own. It shows which ingredients carry the prizes; it is not a price. A basket valuation on the new engine is a later build.
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              Against
              <Toggle
                data-testid="chef-value-dishes"
                value={round}
                onChange={setRound}
                options={[
                  ['main', 'The dishes'],
                  ['rc', 'The Recompletion dishes'],
                ]}
              />
            </label>
            {segment && (
              <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                For
                <select value={segment.id} data-testid="chef-value-segment" aria-label="Segment" onChange={(e) => setSegmentId(e.target.value)} className={SELECT}>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {incomplete && <span className="text-xs font-medium text-amber-700">Some prizes are unknown: they are counted as nothing here.</span>}
          </div>
          {maxValue > 0 ? (
            <>
              <div className="flex h-32 items-end gap-[2px]" data-testid="chef-value-chart">
                {byDay.map((d, i) => (
                  <div key={d.day} className="relative flex h-full flex-1 items-end gap-[1px]" title={`${dayLabel(calendar, d.day)}${d.phase ? `, ${d.phase.label}` : ''}`}>
                    {i > 0 && d.phase?.id !== byDay[i - 1].phase?.id && <div className="absolute -left-px bottom-0 top-0 w-px bg-slate-300" />}
                    {CHEST_TYPES.map((chestType) => {
                      const v = d.perChestType[chestType]
                      return <div key={chestType} data-bar={chestType} className={`flex-1 rounded-t-sm bg-gradient-to-t ${CHEST_COLOR[chestType]}`} style={{ height: `${v ? Math.max((v.value / maxValue) * 100, 2) : 0}%` }} title={`${dayLabel(calendar, d.day)}, ${CHEST_LABELS[chestType]} basket: ${v ? v.value.toFixed(2) : 'no basket set'}`} />
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
              Nothing to show: the dishes of this round have no known prizes, or no basket gives an ingredient a dish needs.
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
      </div>

      <Collapsible id="chef-unit-values" title="The older estimate: what one of each ingredient counts for" summary="The share of the prizes that falls on one unit of each ingredient - what the chart above is made from">
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
