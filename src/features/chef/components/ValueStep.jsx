import { useMemo, useRef, useState } from 'react'
import Card from '../../../components/ui/Card'
import Collapsible from '../../../components/ui/Collapsible'
import { fingerprint, oneMoreBasket } from '../lib/chefEngine'
import { basketWorthByDay } from '../lib/chefBasketWorth'
import { useEconomy } from '../../../lib/economy/economyStore'
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

// A BASKET'S WORTH, DAY BY DAY (chefBasketWorth.js): every day and every basket
// type the segment opens, one more basket played on the engine, beside the
// tier worth the economist gave (the Economy page). A reading: it changes no
// value.
const TIER_OF = { basic: 'Basic', rare: 'Rare', epic: 'Epic' }
function BasketWorth({ state }) {
  const { segments, calendar } = state
  const economy = useEconomy()
  const [segmentId, setSegmentId] = useState(segments[0]?.id ?? null)
  const [players, setPlayers] = useState(300)
  const [variation, setVariation] = useState('activity')
  const [result, setResult] = useState(null)
  const [progress, setProgress] = useState(null)
  const cancel = useRef(false)
  const segment = segments.find((s) => s.id === segmentId) ?? segments[0]
  if (!segment) return <p className="text-sm text-slate-400">No segment to play yet (step 1).</p>
  const stale = result && (result.fp !== fingerprint(state) || result.segmentId !== segment.id)

  async function handleRun() {
    cancel.current = false
    setProgress({ done: 0, of: 1 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const r = await basketWorthByDay(state, segment, { players, variation }, { onProgress: setProgress, isCancelled: () => cancel.current })
    setProgress(null)
    if (r) setResult({ ...r, fp: fingerprint(state), segmentName: segment.name })
  }

  const tierWorth = (type) => economy?.chefBaskets?.[TIER_OF[type]] ?? null
  const max = result ? Math.max(0.0001, ...result.rows.map((r) => r.worth), ...result.types.map((t) => tierWorth(t) ?? 0)) : 1
  return (
    <div className="flex flex-col gap-3" data-testid="chef-worth">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-600">
        For
        <select value={segment.id} aria-label="Segment" data-testid="chef-worth-segment" onChange={(e) => setSegmentId(e.target.value)} className={SELECT}>
          {segments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2">
          Players
          <Num aria-label="Players" value={players} min={100} max={3000} onCommit={(n) => setPlayers(Math.round(n))} className="w-20" />
        </label>
        <Toggle value={variation} onChange={setVariation} options={VARIATIONS.map((id) => [id, VARIATION_LABELS[id]])} />
        <button type="button" onClick={handleRun} disabled={!!progress || state.dishes.length === 0} data-testid="chef-worth-run" className="whitespace-nowrap rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {progress ? `Playing... ${Math.round((progress.done / Math.max(1, progress.of)) * 100)}%` : 'Play every day'}
        </button>
        {progress && (
          <button type="button" onClick={() => (cancel.current = true)} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700">
            Stop
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500" data-note>
        Every day and every basket the segment opens: the same players with one more basket that day, each compared with themself. A basket&apos;s worth that day is what it adds to what a player is paid, in
        allowance. Beside it, the tier worth on the Economy page. A reading - no value is changed by it.
      </p>
      {result && (
        <div className="flex flex-col gap-3" data-testid="chef-worth-result">
          {stale && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="chef-worth-stale">
              Out of date: the chef or the segment changed after this was played. Play it again.
            </p>
          )}
          {!result.base.complete && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="chef-worth-incomplete">
              Some prizes are not known and count as nothing, so these worths are too low. {result.base.missing?.[0] ?? ''}
            </p>
          )}
          <table className="w-full max-w-3xl border-collapse" data-dense data-testid="chef-worth-table">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={TH}>{result.segmentName}</th>
                <th className={`${TH} text-center`} title="The average over the days of the event">
                  Over the event
                </th>
                <th className={`${TH} text-center`}>Day 1</th>
                <th className={`${TH} text-center`}>Last day</th>
                <th className={`${TH} text-center`}>Worth most on</th>
                <th className={`${TH} text-center`} title="The tier worth on the Economy page (Basic 0.25, Rare 1, Epic 4 as the economist gave them)">
                  Tier worth
                </th>
              </tr>
            </thead>
            <tbody>
              {result.types.map((t) => {
                const b = result.byType[t]
                return (
                  <tr key={t} className="border-b border-slate-100 text-sm" data-worth-type={t}>
                    <td className={`${TD} font-medium text-slate-700`}>
                      <span className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-gradient-to-t ${CHEST_COLOR[t]}`} />
                      {CHEST_LABELS[t]} basket
                    </td>
                    <td className={`${TD} text-center font-semibold tabular-nums text-slate-800`} data-cell="mean">
                      {num(b.mean, 3)}
                    </td>
                    <td className={`${TD} text-center tabular-nums text-slate-600`}>{num(b.first, 3)}</td>
                    <td className={`${TD} text-center tabular-nums text-slate-600`}>{num(b.last, 3)}</td>
                    <td className={`${TD} text-center text-slate-600`}>{b.peakDay ? shortDay(calendar, b.peakDay) : '-'}</td>
                    <td className={`${TD} text-center tabular-nums text-slate-600`} data-cell="tier">
                      {tierWorth(t) ?? 'not set'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="flex h-36 items-end gap-[2px]" data-testid="chef-worth-chart">
            {Array.from({ length: calendar.totalDays }, (_, i) => i + 1).map((day) => (
              <div key={day} className="flex h-full flex-1 items-end gap-[1px]" title={dayLabel(calendar, day)}>
                {result.types.map((t) => {
                  const r = result.rows.find((x) => x.day === day && x.chestType === t)
                  return <div key={t} data-bar={t} className={`flex-1 rounded-t-sm bg-gradient-to-t ${CHEST_COLOR[t]}`} style={{ height: `${r ? Math.max((Math.max(0, r.worth) / max) * 100, 1) : 0}%` }} title={r ? `${dayLabel(calendar, day)}, one more ${CHEST_LABELS[t]} basket: ${num(r.worth, 3)} (± ${num(r.spread, 3)} with other players); ${pct(r.changedShare, 1)} of the players end differently` : ''} />
                })}
              </div>
            ))}
          </div>
          <div className="-mt-2 flex justify-between text-[10px] text-slate-400">
            <span>{shortDay(calendar, 1)}</span>
            <span>{shortDay(calendar, calendar.totalDays)}</span>
          </div>
          <Collapsible id="chef-worth-days" tone="inner" title="Day by day" summary={`${result.rows.length} plays of ${result.players} players, each with how far it would move with other players`}>
            <table className="w-full border-collapse" data-dense>
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={TH}>Day</th>
                  {result.types.map((t) => (
                    <th key={t} className={`${TH} text-center`}>
                      {CHEST_LABELS[t]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: calendar.totalDays }, (_, i) => i + 1).map((day) => (
                  <tr key={day} className="border-b border-slate-100 text-sm" data-worth-day={day}>
                    <td className={`${TD} text-slate-600`}>{dayLabel(calendar, day)}</td>
                    {result.types.map((t) => {
                      const r = result.rows.find((x) => x.day === day && x.chestType === t)
                      return (
                        <td key={t} className={`${TD} text-center tabular-nums text-slate-700`}>
                          {r ? `${num(r.worth, 3)} ± ${num(r.spread, 3)}` : '-'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Collapsible>
          <p className="text-xs text-slate-500">
            {result.players} players, {VARIATION_LABELS[result.variation].toLowerCase()}, the same players for every day (number {result.seed}). One basket changes few players, so a worth is small and moves a little with other players
            (the ± in the day-by-day table).
          </p>
        </div>
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
      <Card title="A basket's worth, day by day" subtitle="Played on the engine for every day of the event, beside the tier worth you gave. In allowance worth, not in money.">
        <BasketWorth state={state} />
      </Card>
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
            something on its own. It shows which ingredients carry the prizes; it is not a price. A basket&apos;s worth on the engine is the card above.
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
