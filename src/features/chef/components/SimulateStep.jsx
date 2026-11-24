import { useState } from 'react'
import { CheckCircle2, PlayCircle } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Collapsible from '../../../components/ui/Collapsible'
import { ENGINE_VERSION, comparePresets, simulateSegmentAsync, supplySweep, tracePlayer } from '../lib/chefEngine'
import { randomSeed, shareInterval } from '../lib/chefRng'
import { CHEST_LABELS, CHEST_TYPES, ROUND_LABELS, THRESHOLD_COUNT_LABELS, VARIATIONS, VARIATION_LABELS } from '../lib/chefModel'
import { SEVERITY_LABELS, SEVERITY_ORDER } from '../lib/chefValidation'
import { dayLabel, shortDay, num, pct } from '../lib/chefFormat'
import { Finding, Num, Pills, Toggle, TD, TH } from './chefUi'

const DEFAULT_PLAYERS = 300

// A share of the players with how sure it is: "62% (56-67)". The range is where
// the share would land 19 times in 20 with other players; it is not how far
// the players are from each other.
function Share({ share, n, className = '' }) {
  if (share == null) return <span className="text-slate-400">-</span>
  const i = shareInterval(Math.round(share * n), n)
  return (
    <span className={`whitespace-nowrap tabular-nums ${className}`} title={`Between ${pct(i.low, 1)} and ${pct(i.high, 1)} with other players (${n.toLocaleString()} played). This is how well the share is known, not the spread of the players.`}>
      {pct(share)}
      <span className="text-[11px] font-normal text-slate-400">
        {' '}
        ({Math.round(i.low * 100)}-{Math.round(i.high * 100)})
      </span>
    </span>
  )
}

const Mark = ({ met }) => (met == null ? null : <span className={`ml-1.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${met ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{met ? 'met' : 'not met'}</span>)

// One segment, day by day: the solid bar is the middle player's dishes, the
// lighter band runs from the slow players to the fast ones.
function SegmentCurve({ segment, result, calendar }) {
  const last = result.days[result.days.length - 1]
  const total = result.mainCount
  const pctOf = (v) => (total > 0 ? (v / total) * 100 : 0)
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/70 p-3" data-curve={segment.id}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-800">{segment.name}</span>
        <span className="text-xs text-slate-500">
          {last.p50} of {total} dishes at the end, most players {last.p10} to {last.p90}
        </span>
      </div>
      <div className="flex h-28 items-end gap-[2px]">
        {result.days.map((d) => (
          <div key={d.day} className="relative h-full flex-1" title={`${dayLabel(calendar, d.day)}: the middle player has ${d.p50} of ${total}, most players ${d.p10} to ${d.p90}; in FU ${pct(d.inFu)}, finished ${pct(d.finished)}`}>
            {result.fuTarget?.day === d.day && <div className="absolute -left-px bottom-0 top-0 z-10 w-px bg-rose-400" />}
            <div className="absolute left-0 right-0 rounded-sm bg-purple-200/60" style={{ bottom: `${pctOf(d.p10)}%`, height: `${Math.max(pctOf(d.p90) - pctOf(d.p10), 1)}%` }} />
            <div className="absolute bottom-0 left-0 right-0 rounded-t-sm bg-gradient-to-t from-purple-600 to-fuchsia-500" style={{ height: `${Math.max(pctOf(d.p50), 2)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400">
        <span>{shortDay(calendar, 1)}</span>
        <span>{shortDay(calendar, result.days.length)}</span>
      </div>
    </div>
  )
}

// How many dishes the players have on each day: a column a day, a row a number of dishes, darker = more players.
function DishesByDay({ result, calendar }) {
  const counts = Array.from({ length: result.mainCount + 1 }, (_, i) => result.mainCount - i)
  return (
    <div className="overflow-x-auto" data-testid="chef-dist">
      <table className="border-collapse text-[10px] tabular-nums">
        <tbody>
          {counts.map((count) => (
            <tr key={count}>
              <td className="pr-2 text-right text-slate-500">{count}</td>
              {result.days.map((d) => {
                const share = d.dist[count] ?? 0
                return <td key={d.day} className="h-4 w-6 border border-white" style={{ background: share > 0 ? `rgba(147, 51, 234, ${Math.max(0.06, share)})` : '#f8fafc' }} title={`${dayLabel(calendar, d.day)}: ${pct(share, 1)} of the players have exactly ${count} ${count === 1 ? 'dish' : 'dishes'}`} />
              })}
            </tr>
          ))}
          <tr>
            <td className="pr-2 text-right text-slate-400">day</td>
            {result.days.map((d) => (
              <td key={d.day} className="text-center text-slate-400">
                {d.day}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function DishTable({ title, dishes, stats, n, calendar }) {
  if (dishes.length === 0) return null
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/70 p-3">
      <h4 className="mb-2 text-sm font-semibold text-slate-800">{title}</h4>
      <table className="w-full border-collapse" data-dense data-testid="chef-dish-timing">
        <thead>
          <tr className="border-b border-slate-200">
            <th className={TH}>Dish</th>
            <th className={`${TH} text-center`} title="The share of all the players who cook this dish before the event ends.">
              Players who cook it
            </th>
            <th className={`${TH} text-center`} title="Only among the players who cook it: the day the fast ones do (1 in 10 is earlier), the middle one, and the slow ones (1 in 10 is later). The players who never cook it are in the share beside, not here.">
              When, among them: fast · middle · slow
            </th>
          </tr>
        </thead>
        <tbody>
          {dishes.map((dish) => {
            const stat = stats.find((s) => s.dishId === dish.id)
            if (!stat) return null
            return (
              <tr key={dish.id} className="border-b border-slate-100 text-sm">
                <td className={`${TD} whitespace-nowrap font-medium text-slate-700`}>
                  <span aria-hidden="true">{dish.art ?? ''}</span> {dish.name}
                </td>
                <td className={`${TD} text-center text-slate-600`}>
                  <Share share={stat.share} n={n} />
                </td>
                <td className={`${TD} whitespace-nowrap text-center text-slate-500`}>{stat.p50 == null ? 'nobody' : `${shortDay(calendar, stat.p10)} · ${shortDay(calendar, stat.p50)} · ${shortDay(calendar, stat.p90)}`}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function IngredientTable({ result, byId }) {
  const n = result.meta.players
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" data-dense data-testid="chef-ingredient-flow">
        <thead>
          <tr>
            <th className={TH} />
            <th className={`${TH} border-b border-slate-200 text-center`} colSpan={5}>
              A player, on average, over the event
            </th>
            <th className={`${TH} border-b border-slate-200 text-center`} colSpan={2} title="Ingredients lost because the pantry was full when a basket gave them.">
              Lost to the pantry cap
            </th>
            <th className={`${TH} border-b border-slate-200 text-center`} colSpan={2} title="Among the players who did not finish the Main round: who lacks this ingredient for the dishes left, and how much.">
              Players who did not finish
            </th>
            <th className={TH} />
          </tr>
          <tr className="border-b border-slate-200">
            <th className={TH}>Ingredient</th>
            <th className={`${TH} text-center`} title="Everything baskets and other sources gave, lost or not.">
              Given
            </th>
            <th className={`${TH} text-center`} title="What reached the pantry.">
              Kept
            </th>
            <th className={`${TH} text-center`}>Cooked</th>
            <th className={`${TH} text-center`} title="In the pantry when the event ends.">
              Left over
            </th>
            <th className={`${TH} text-center`} title="What a special source could not give because of the progression threshold.">
              Held back
            </th>
            <th className={`${TH} text-center`}>A player</th>
            <th className={`${TH} text-center`}>Players</th>
            <th className={`${TH} text-center`}>Lack it</th>
            <th className={`${TH} text-center`}>By</th>
            <th className={`${TH} text-center`} title="Players whose basket took them past a progression threshold (the limit is checked before a basket, so the last basket can go over), and the most any player went over.">
              Past a limit
            </th>
          </tr>
        </thead>
        <tbody>
          {result.ingredients.map((row) => (
            <tr key={row.id} className="border-b border-slate-100 text-sm tabular-nums text-slate-600" data-flow={row.id}>
              <td className={`${TD} whitespace-nowrap font-medium text-slate-700`}>
                <span aria-hidden="true">{byId[row.id]?.art ?? ''}</span> {byId[row.id]?.name ?? row.id}
              </td>
              <td className={`${TD} text-center`}>{num(row.rolled)}</td>
              <td className={`${TD} text-center`}>{num(row.accepted)}</td>
              <td className={`${TD} text-center`}>{num(row.consumed)}</td>
              <td className={`${TD} text-center`}>{num(row.onHand)}</td>
              <td className={`${TD} text-center`}>{row.withheld > 0 ? num(row.withheld, 2) : '-'}</td>
              <td className={`${TD} text-center ${row.lost > 0 ? 'font-semibold text-amber-700' : ''}`}>{row.lost > 0 ? num(row.lost) : '-'}</td>
              <td className={`${TD} text-center`}>{row.lostShare > 0 ? <Share share={row.lostShare} n={n} /> : '-'}</td>
              <td className={`${TD} text-center`}>{row.missingShare > 0 ? pct(row.missingShare) : '-'}</td>
              <td className={`${TD} text-center`}>{row.missingShare > 0 ? num(row.missingMean) : '-'}</td>
              <td className={`${TD} text-center`}>{row.overshootShare > 0 ? `${pct(row.overshootShare)}, by up to ${row.overshootMax}` : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// One segment in full: against the targets, day by day, dish by dish, every ingredient, Recompletion, prizes.
function SegmentDetail({ result, other = null, otherLabel = null, state, calendar }) {
  const n = result.meta.players
  const byId = Object.fromEntries(state.ingredients.map((i) => [i.id, i]))
  const t = result.fuTarget
  const box = 'rounded-2xl border border-slate-200 bg-white/70 p-3'
  const fact = (label, value, title) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1 text-sm last:border-0" title={title}>
      <span className="text-slate-600">{label}</span>
      <span className="text-right font-semibold text-slate-800">{value}</span>
    </div>
  )
  return (
    <div className="flex flex-col gap-4" data-testid="chef-detail">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:items-start">
        <div className={box} data-testid="chef-detail-targets">
          <h4 className="mb-1 text-sm font-semibold text-slate-800">Against the targets</h4>
          {t ? (
            <>
              <p className="mb-1 text-xs text-slate-500">
                On {dayLabel(calendar, t.day)} the aim is {pct(t.target)} of the players sitting in FU. <Mark met={t.met} />
              </p>
              {fact('Sitting in FU that day', <Share share={t.inFu} n={n} />, 'One dish left, only blockers missing, the blocker threshold reached.')}
              {fact('Already finished the Main round', <Share share={t.finished} n={n} />, 'Finished players are not in FU.')}
              {fact('Not there yet', <Share share={t.before} n={n} />, 'Fewer dishes, an ordinary ingredient missing, or still below the blocker threshold.')}
              {fact('Have been in FU by that day', <Share share={t.everFu} n={n} />, 'In FU on that day or any day before - some have finished since.')}
              {fact('Blockers a player in FU is short of', t.shortage == null ? '-' : num(t.shortage, 2))}
              {other?.fuTarget && otherLabel && (
                <div data-testid="chef-detail-other-view">{fact(`Sitting in FU that day, with ${otherLabel}`, <Share share={other.fuTarget.inFu} n={n} />, 'The same players played the other way: a reading only, the mark above uses the view the targets are judged on.')}</div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500">No day is set for the FU target (step 1).</p>
          )}
          {result.checkpoints.map((c) => (
            <div key={c.id} data-checkpoint-result={c.id}>
              {fact(
                `At least ${c.dishes} dishes by ${shortDay(calendar, c.day)} (aim ${pct(c.target)})`,
                <>
                  <Share share={c.share} n={n} />
                  <Mark met={c.met} />
                </>,
                'The share of the players with at least that many dishes - not the average number of dishes.',
              )}
            </div>
          ))}
          {fact('Ever in FU during the event', <Share share={result.fu.everShare} n={n} />)}
          {fact('In FU when the event ends', <Share share={result.fu.inAtEnd} n={n} />)}
          {fact('Finish the Main round', <Share share={result.finish.share} n={n} />)}
          {fact('...the day they do, among them: fast · middle · slow', result.finish.p50 == null ? 'nobody' : `${shortDay(calendar, result.finish.p10)} · ${shortDay(calendar, result.finish.p50)} · ${shortDay(calendar, result.finish.p90)}`, 'Only among the players who finish. Those who do not are the share below.')}
          {fact('Do not finish it', <Share share={result.finish.unfinishedShare} n={n} />)}
        </div>

        <div className={box} data-testid="chef-detail-rc">
          <h4 className="mb-1 text-sm font-semibold text-slate-800">Recompletion</h4>
          {result.rcCount === 0 ? (
            <p className="text-sm text-slate-500">No Recompletion dishes (step 2).</p>
          ) : (
            <>
              <p className="mb-1 text-xs text-slate-500">It starts the moment the last Main dish is cooked, with the pantry as it is and the baskets that are left.</p>
              {fact('Enter it', <Share share={result.rc.enteredShare} n={n} />)}
              {fact('...the day they do, among them: fast · middle · slow', result.rc.entryP50 == null ? 'nobody' : `${shortDay(calendar, result.rc.entryP10)} · ${shortDay(calendar, result.rc.entryP50)} · ${shortDay(calendar, result.rc.entryP90)}`)}
              {fact('Reach its FU', <Share share={result.rc.fuEverShare} n={n} />, 'All its dishes but one cooked, only blockers missing, its blocker threshold reached.')}
              {fact('...days after entering, among them: middle · slow', result.rc.daysToFuP50 == null ? '-' : `${result.rc.daysToFuP50} · ${result.rc.daysToFuP90}`)}
              {fact('Finish it', <Share share={result.rc.doneShare} n={n} />)}
              <p className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Straight from the pantry carried over</p>
              {fact('Cook a Recompletion dish at once', <Share share={result.rc.cookedAtEntryShare} n={n} />, 'Before another basket is opened. Nothing is taken from the pantry to prevent this: whether it should be possible is an open question.')}
              {fact('Are in its FU at once', <Share share={result.rc.fuAtEntryShare} n={n} />)}
              {fact('Finish it at once', <Share share={result.rc.doneAtEntryShare} n={n} />)}
            </>
          )}
        </div>

        <div className={box} data-testid="chef-detail-payout">
          <h4 className="mb-1 text-sm font-semibold text-slate-800">What a player is paid (allowance worth)</h4>
          {fact('On average', num(result.payout.mean, 2))}
          {fact('The middle player; most players', `${num(result.payout.p50, 1)}; ${num(result.payout.p10, 1)} to ${num(result.payout.p90, 1)}`, 'Most players: 1 in 10 is paid less than the first figure, 1 in 10 more than the second. The spread of the players - not how sure the average is.')}
          {fact('...the Main dishes', num(result.payout.mainDishes, 2))}
          {fact('...the Main grand prize', num(result.payout.mainGrand, 2))}
          {fact('...the Recompletion dishes', num(result.payout.rcDishes, 2))}
          {fact('...the Recompletion grand prize', num(result.payout.rcGrand, 2))}
          {!result.payout.complete && (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-amber-800" data-testid="chef-payout-incomplete">
              <li className="list-none font-semibold">Incomplete: what is not known is not counted.</li>
              {result.payout.missing.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
          <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Pace</p>
          {fact('First dish: fast · middle · slow', result.firstCook.p50 == null ? 'never' : `${shortDay(calendar, result.firstCook.p10)} · ${shortDay(calendar, result.firstCook.p50)} · ${shortDay(calendar, result.firstCook.p90)}`, 'Among the players who cook at least one dish.')}
          {result.firstCook.neverShare > 0 && fact('Never cook a dish', <Share share={result.firstCook.neverShare} n={n} />)}
          {fact('Longest wait between dishes: middle · slow', result.gap.p50 == null ? '-' : `${result.gap.p50} · ${result.gap.p90} days`, 'The longest run of days without a Main dish; the days after the last dish count.')}
          <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Baskets opened (expected)</p>
          {CHEST_TYPES.map((type) => (
            <div key={type}>{fact(CHEST_LABELS[type], `${num(result.supply.opened[type], 2)} (${num(result.supply.expected[type], 2)})`)}</div>
          ))}
          {result.baskets.shortMean > 0 && fact('Baskets that came up short, a player', num(result.baskets.shortMean, 2), 'A basket whose ingredients ran out of room - every other one was held back by a threshold or at its most for the basket.')}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
        <div className={box}>
          <h4 className="mb-1 text-sm font-semibold text-slate-800">How many dishes, day by day</h4>
          <p className="mb-2 text-xs text-slate-500">A column a day, a row a number of Main dishes; the darker, the more players have exactly that many. Point at a cell for the share.</p>
          <DishesByDay result={result} calendar={calendar} />
        </div>
        <div className={box}>
          <h4 className="mb-2 text-sm font-semibold text-slate-800">The shares, day by day</h4>
          <div className="max-h-72 overflow-auto">
            <table className="w-full border-collapse" data-dense data-testid="chef-days-table">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={TH}>Day</th>
                  <th className={`${TH} text-center`} title="The middle player's Main dishes; most players from - to.">
                    Dishes
                  </th>
                  <th className={`${TH} text-center`}>In FU</th>
                  <th className={`${TH} text-center`} title="In FU that day or before.">
                    Ever FU
                  </th>
                  <th className={`${TH} text-center`}>Finished</th>
                  <th className={`${TH} text-center`} title="In Recompletion's FU / finished Recompletion.">
                    Recompletion: FU / done
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.days.map((d) => (
                  <tr key={d.day} className={`border-b border-slate-100 text-sm tabular-nums text-slate-600 ${t?.day === d.day ? 'bg-rose-50/70' : ''}`}>
                    <td className={`${TD} whitespace-nowrap`}>{shortDay(calendar, d.day)}</td>
                    <td className={`${TD} text-center`}>
                      {d.p50} <span className="text-xs text-slate-400">({d.p10}-{d.p90})</span>
                    </td>
                    <td className={`${TD} text-center`}>{pct(d.inFu)}</td>
                    <td className={`${TD} text-center`}>{pct(d.everFu)}</td>
                    <td className={`${TD} text-center`}>{pct(d.finished)}</td>
                    <td className={`${TD} text-center`}>
                      {pct(d.rcInFu)} / {pct(d.rcDone)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className={box}>
        <h4 className="mb-2 text-sm font-semibold text-slate-800">Every ingredient: given, kept, lost, cooked, left - and what the unfinished players lack</h4>
        <IngredientTable result={result} byId={byId} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
        <DishTable title="When each Main dish is cooked" dishes={state.dishes} stats={result.dishes.main} n={n} calendar={calendar} />
        <DishTable title="When each Recompletion dish is cooked" dishes={state.recompletionDishes} stats={result.dishes.rc} n={n} calendar={calendar} />
      </div>
    </div>
  )
}

// The event with and without its catch-up presets, on the same players.
function PresetComparison({ state, segment, run }) {
  const [cmp, setCmp] = useState(null)
  const [busy, setBusy] = useState(false)
  const byId = Object.fromEntries(state.ingredients.map((i) => [i.id, i]))
  if ((state.presets ?? []).filter((p) => p.enabled !== false).length === 0) return <p className="text-sm text-slate-500">This chef has no catch-up preset in use (step 3).</p>
  const go = () => {
    setBusy(true)
    setTimeout(() => {
      setCmp(comparePresets(state, segment, { players: Math.min(run.players, 400), seed: run.seed, variation: run.variation }))
      setBusy(false)
    }, 20)
  }
  const delta = (a, b, digits = 0) => `${pct(a, digits)} → ${pct(b, digits)}`
  return (
    <div className="flex flex-col gap-3" data-testid="chef-preset-compare">
      <p className="text-sm text-slate-600" data-note>
        {segment.name}, the same players twice: once with ordinary baskets only, once with the presets. Every basket a preset does not take is rolled exactly as before, so the difference is what the presets did.
      </p>
      <button type="button" onClick={go} disabled={busy} data-testid="chef-preset-run" className="self-start rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
        {busy ? 'Playing...' : 'Play it both ways'}
      </button>
      {cmp && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start" data-testid="chef-preset-result">
          <table className="w-full border-collapse" data-dense>
            <thead>
              <tr className="border-b border-slate-200">
                <th className={TH}>{cmp.players.toLocaleString()} players</th>
                <th className={`${TH} text-center`}>Ordinary → with presets</th>
              </tr>
            </thead>
            <tbody className="text-sm text-slate-700">
              <tr className="border-b border-slate-100">
                <td className={TD}>Players who got a preset basket</td>
                <td className={`${TD} text-center font-semibold`}>{pct(cmp.changed.presets.affectedShare)}</td>
              </tr>
              {cmp.changed.presets.byPreset.map((p) => (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className={`${TD} pl-5 text-slate-500`}>{p.name}</td>
                  <td className={`${TD} text-center`}>
                    {pct(p.playersShare)} of players, {num(p.usesMean, 2)} baskets each
                  </td>
                </tr>
              ))}
              {cmp.base.fuTarget && (
                <tr className="border-b border-slate-100">
                  <td className={TD}>In FU on the target day</td>
                  <td className={`${TD} text-center`}>{delta(cmp.base.fuTarget.inFu, cmp.changed.fuTarget.inFu)}</td>
                </tr>
              )}
              {cmp.finishedByFuDay.base != null && (
                <tr className="border-b border-slate-100" title="Players who finished the Main round on or before the day the segment should be sitting in FU: too early for the design.">
                  <td className={TD}>Already finished on the target day (too early)</td>
                  <td className={`${TD} text-center`}>{delta(cmp.finishedByFuDay.base, cmp.finishedByFuDay.changed)}</td>
                </tr>
              )}
              {cmp.base.checkpoints.map((c, i) => (
                <tr key={c.id} className="border-b border-slate-100">
                  <td className={TD}>
                    At least {c.dishes} dishes by day {c.day}
                  </td>
                  <td className={`${TD} text-center`}>{delta(c.share, cmp.changed.checkpoints[i].share)}</td>
                </tr>
              ))}
              <tr className="border-b border-slate-100">
                <td className={TD}>Finish the Main round</td>
                <td className={`${TD} text-center`}>{delta(cmp.base.finish.share, cmp.changed.finish.share)}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className={TD}>Paid, a player (allowance worth)</td>
                <td className={`${TD} text-center`}>
                  {num(cmp.base.payout.mean, 2)} → {num(cmp.changed.payout.mean, 2)} ({cmp.payoutDelta >= 0 ? '+' : ''}
                  {num(cmp.payoutDelta, 2)})
                </td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className={TD}>Players who end differently</td>
                <td className={`${TD} text-center`}>{pct(cmp.changedShare)}</td>
              </tr>
            </tbody>
          </table>
          <table className="w-full border-collapse" data-dense>
            <thead>
              <tr className="border-b border-slate-200">
                <th className={TH}>Ingredient, a player</th>
                <th className={`${TH} text-center`}>Kept: ordinary → with</th>
                <th className={`${TH} text-center`}>Lost: ordinary → with</th>
              </tr>
            </thead>
            <tbody className="text-sm tabular-nums text-slate-600">
              {cmp.base.ingredients.map((row, i) => (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className={`${TD} font-medium text-slate-700`}>{byId[row.id]?.name ?? row.id}</td>
                  <td className={`${TD} text-center`}>
                    {num(row.accepted)} → {num(cmp.changed.ingredients[i].accepted)}
                  </td>
                  <td className={`${TD} text-center`}>
                    {num(row.lost)} → {num(cmp.changed.ingredients[i].lost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// One player's event, step by step.
function PlayerStory({ state, segment, run, calendar }) {
  const [player, setPlayer] = useState(1)
  const byId = Object.fromEntries(state.ingredients.map((i) => [i.id, i]))
  const dishName = Object.fromEntries([...state.dishes, ...state.recompletionDishes].map((d) => [d.id, d.name]))
  const story = tracePlayer(state, segment, { seed: run.seed, variation: run.variation, player: Math.max(0, player - 1) })
  const list = (amounts) =>
    Object.entries(amounts ?? {})
      .filter(([, n]) => n > 0)
      .map(([id, n]) => `${byId[id]?.name ?? id} ${n}`)
      .join(', ') || 'nothing'
  const line = (e) => {
    switch (e.kind) {
      case 'start':
        return ['Start', `The pantry is empty. Baskets this player opens over the event: ${CHEST_TYPES.map((t) => `${e.opens[t].reduce((s, v) => s + v, 0)} ${CHEST_LABELS[t]}`).join(', ')}.`]
      case 'threshold':
        return ['Threshold', `${ROUND_LABELS[e.round]}: ${byId[e.ingredientId]?.name ?? e.ingredientId} ${e.limit == null ? 'is no longer held back' : `may be received up to ${e.limit} in all`}.`]
      case 'source':
      case 'joker':
        return [
          e.kind === 'joker' ? 'Joker' : 'Special source',
          `${e.label ? `${e.label}: ` : ''}${e.given.map((g) => `${byId[g.ingredientId]?.name ?? g.ingredientId} ${g.accepted}${g.lost ? ` (${g.lost} lost, pantry full)` : ''}${g.withheld ? ` (${g.withheld} held back by the threshold)` : ''}`).join(', ')}${e.bypass ? ' - allowed past the threshold' : ''}.`,
        ]
      case 'basket':
        if (e.missing) return ['Basket', `No ${CHEST_LABELS[e.chestType]} basket is set for this day: nothing.`]
        return [
          `${CHEST_LABELS[e.chestType]} basket`,
          `${e.preset ? `Preset "${e.preset.name}" in its place` : `Rolled ${e.rolledSize}`}: ${list(e.rolled)}.${Object.keys(e.lost).length ? ` Lost, pantry full: ${list(e.lost)}.` : ''}${e.excluded.length ? ` Held back by a threshold, so left out: ${e.excluded.map((id) => byId[id]?.name ?? id).join(', ')}.` : ''}${e.short ? ` Came up ${e.short} short: no ingredient had room.` : ''}${e.skipped.map((s) => ` Preset "${s.name}" not given: ${s.reason}.`).join('')}`,
        ]
      case 'cook':
        return ['Cooks', `${dishName[e.dishId] ?? e.dishId}${e.round === 'rc' ? ' (Recompletion)' : ''} - uses ${list(e.used)}; pays ${e.prize == null ? 'an unknown prize' : num(e.prize, 2)}.`]
      case 'main-done':
        return ['Main round done', `Every Main dish is cooked: grand prize ${e.prize == null ? 'unknown' : num(e.prize, 2)}.`]
      case 'rc-enter':
        return ['Recompletion begins', `At once, with the pantry as it is (${list(e.pantry)}). The count of what was received starts again at zero.`]
      case 'rc-done':
        return ['Recompletion done', `Grand prize ${e.prize == null ? 'unknown' : num(e.prize, 2)}. It is not played again.`]
      case 'fu':
        return ['In FU', `${ROUND_LABELS[e.round]}: one dish left, ${e.shortage} ${e.shortage === 1 ? 'blocker' : 'blockers'} short, the threshold reached.`]
      default:
        return [e.kind, '']
    }
  }
  return (
    <div className="flex flex-col gap-3" data-testid="chef-trace">
      <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        {segment.name}, player number
        <Num aria-label="Player number" data-testid="chef-trace-player" value={player} min={1} max={run.players} onCommit={(n) => setPlayer(Math.round(n))} className="w-20" />
        of {run.players.toLocaleString()} - ends with {story.mainDishes} of {state.dishes.length} dishes{story.rcEntryDay != null ? `, ${story.rcDishes} of ${state.recompletionDishes.length} in Recompletion` : ''}, paid {num(story.payout, 2)}
      </label>
      <div className="max-h-96 overflow-auto rounded-xl border border-slate-200">
        <table className="w-full border-collapse" data-dense>
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-200">
              <th className={TH}>Day</th>
              <th className={TH}>What</th>
              <th className={TH}>What happened</th>
            </tr>
          </thead>
          <tbody>
            {story.events.map((e, i) => {
              const [what, text] = line(e)
              const strong = e.kind === 'cook' || e.kind === 'rc-enter' || e.kind === 'fu' || e.kind === 'main-done' || e.kind === 'rc-done'
              return (
                <tr key={i} className={`border-b border-slate-100 align-top text-sm ${strong ? 'bg-purple-50/50' : ''}`} data-event={e.kind}>
                  <td className={`${TD} whitespace-nowrap text-slate-500`}>{e.day < 1 ? '' : shortDay(calendar, e.day)}</td>
                  <td className={`${TD} whitespace-nowrap font-medium text-slate-700`}>{what}</td>
                  <td className={`${TD} text-slate-600`}>{text}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function WhatIfBaskets({ state, segment, run }) {
  const [sweep, setSweep] = useState(null)
  const [running, setRunning] = useState(false)
  const go = () => {
    setRunning(true)
    setTimeout(() => {
      setSweep(supplySweep(state, segment, { players: 150, seed: run.seed, variation: run.variation }))
      setRunning(false)
    }, 20)
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-600" data-note>
        How the Main dishes move when {segment.name} opens more or fewer baskets than typed - every basket type by the same share, the same 150 players each time.
      </p>
      <button type="button" onClick={go} disabled={running} data-testid="chef-whatif-run" className="self-start rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
        {running ? 'Playing...' : 'Play it seven ways'}
      </button>
      {sweep && (
        <div className="flex h-32 items-end gap-3" data-testid="chef-whatif-chart">
          {sweep.map((s) => (
            <div key={s.delta} className="flex h-full flex-1 flex-col items-center gap-1" title={`${s.delta >= 0 ? '+' : ''}${s.delta}% baskets: ${num(s.meanDishes, 2)} dishes on average, ${pct(s.finished)} finish`}>
              <span className="text-[11px] font-semibold tabular-nums text-slate-600">{num(s.meanDishes, 1)}</span>
              <div className="flex w-full flex-1 items-end">
                <div className={`w-full rounded-t-sm ${s.delta === 0 ? 'bg-gradient-to-t from-purple-600 to-fuchsia-500' : 'bg-purple-200'}`} style={{ height: `${s.mainCount > 0 ? Math.max((s.meanDishes / s.mainCount) * 100, 2) : 2}%` }} />
              </div>
              <span className="text-[10px] text-slate-500">{s.delta === 0 ? 'as typed' : `${s.delta > 0 ? '+' : ''}${s.delta}%`}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// What is not settled about the real game, and what the simulation does meanwhile.
function OpenRules({ state, onGoTo, stepLabels }) {
  const s = state.settings
  const row = (what, now, where) => (
    <tr className="border-b border-slate-100 align-top text-sm">
      <td className={`${TD} font-medium text-slate-700`}>{what}</td>
      <td className={`${TD} text-slate-600`}>{now}</td>
      <td className={`${TD} whitespace-nowrap text-right`}>{where}</td>
    </tr>
  )
  const link = (step) => (
    <button type="button" onClick={() => onGoTo(step)} className="text-xs font-semibold text-purple-700 underline decoration-dotted underline-offset-2">
      {stepLabels[step]}
    </button>
  )
  return (
    <table className="w-full border-collapse" data-dense data-testid="chef-open-rules">
      <thead>
        <tr className="border-b border-slate-200">
          <th className={TH}>Not confirmed</th>
          <th className={TH}>What the simulation does for now</th>
          <th className={TH} />
        </tr>
      </thead>
      <tbody>
        {row('Whether overflow lost to the pantry counts toward a threshold', `Counted: ${THRESHOLD_COUNT_LABELS[s.thresholdCounts].toLowerCase()}. Both figures are tracked. (You said: "the caps will always be a lot more than the threshold so practically it doesn't matter".)`, link('baskets'))}
        {row('Whether the pantry carried into Recompletion may cook a dish, or reach FU, at once', 'It may: nothing is taken from the pantry and no dish is held back. The run counts how often it happens.', null)}
        {row('What a basket minimum above 0 does', 'Kept and flagged, not played.', link('baskets'))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={3} className="px-2 pt-2 text-xs text-slate-500" data-testid="chef-settled-rules">
            Settled with you, and played as rules: a threshold stops a player exactly at the limit, inside a basket too; a player cooks at once, in the order of the list (never saving ingredients for a later
            dish); a joker goes to the blocker while it is needed, then to what is most missing; a special source reaches the same players first; a scaled prize is rounded down to whole items.
          </td>
        </tr>
      </tfoot>
    </table>
  )
}

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

// STEP 4 - SIMULATE: the event played by many players, against its targets.
// One button; the summary leads - one row a segment, the FU target first -
// and everything else is folded. A run is kept by ChefApp with what it was
// played on, and is marked out of date once the chef has changed.
export default function SimulateStep({ state, findings, stepLabels, configKey, sim, onSim, onGoTo, runKept = true }) {
  const { segments, calendar } = state
  const [leftOut, setLeftOut] = useState(() => new Set())
  const [players, setPlayers] = useState(DEFAULT_PLAYERS)
  const [seed, setSeed] = useState(null)
  const [variation, setVariation] = useState('activity')
  const [progress, setProgress] = useState(null)
  const [detailId, setDetailId] = useState(null)

  const blocking = findings.filter((f) => f.severity === 'block')
  const chosen = segments.filter((s) => !leftOut.has(s.id))
  const running = progress != null
  const nothingToCook = state.dishes.length === 0 && state.recompletionDishes.length === 0

  const toggle = (id) =>
    setLeftOut((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // A segment at a time, a few players at a time, so the bar moves and the page stays alive.
  async function handleRun() {
    const list = chosen
    const used = seed ?? randomSeed()
    const run = { key: configKey, engine: ENGINE_VERSION, players, seed: used, seedTyped: seed != null, variation, at: new Date().toISOString(), results: [] }
    setProgress({ done: 0, of: list.length })
    await new Promise((resolve) => setTimeout(resolve, 20))
    // Both views of the players, on the same players' number: the one the targets are judged on, and the other
    // (economist: show both - the 80% targets depend on the activity assumptions, which are not measured).
    const otherVariation = variation === 'activity' ? 'baskets' : 'activity'
    run.otherVariation = otherVariation
    for (let i = 0; i < list.length; i += 1) {
      const result = await simulateSegmentAsync(state, list[i], { players, seed: used, variation }, (part) => setProgress({ done: i + part / 2, of: list.length }))
      const other = await simulateSegmentAsync(state, list[i], { players, seed: used, variation: otherVariation }, (part) => setProgress({ done: i + 0.5 + part / 2, of: list.length }))
      run.results.push({ segment: list[i], result, other })
      setProgress({ done: i + 1, of: list.length })
    }
    onSim(run)
    setDetailId(run.results[0]?.segment.id ?? null)
    setProgress(null)
  }

  const results = sim?.results ?? null
  // (A run kept from another visit can be of an earlier simulation too: out of date as well, and said why.)
  const olderEngine = !!sim && sim.engine !== ENGINE_VERSION
  const outOfDate = !!sim && (sim.key !== configKey || olderEngine)
  const detail = results?.find((r) => r.segment.id === detailId) ?? results?.[0] ?? null
  // The folds below a run play the chef as it is now, for the segment as it is now.
  const liveSegment = detail ? (segments.find((s) => s.id === detail.segment.id) ?? null) : null
  const checkpoints = results?.[0]?.result.checkpoints ?? []
  const fuDay = results?.[0]?.result.fuTarget?.day ?? null

  function showDetail(id) {
    setDetailId(id)
    const fold = document.querySelector('[data-collapsible="chef-sim-detail"]')
    if (fold) {
      fold.open = true
      fold.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }

  const playsText = `${players.toLocaleString()} players a segment · ${chosen.length === segments.length ? `all ${segments.length} segments` : `${chosen.length} of ${segments.length} segments`} · targets judged with ${VARIATION_LABELS[variation].toLowerCase()}, and also played with ${VARIATION_LABELS[variation === 'activity' ? 'baskets' : 'activity'].toLowerCase()} · the Main round, then Recompletion`
  // The other view of a run made before both were played is not there.
  const otherLabel = sim?.otherVariation ? VARIATION_LABELS[sim.otherVariation].toLowerCase() : null
  const otherCols = otherLabel ? (fuDay != null ? 1 : 0) + checkpoints.length : 0

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
            disabled={running || chosen.length === 0 || nothingToCook}
            data-testid="chef-run"
            className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-purple-500/30 disabled:opacity-50"
          >
            <PlayCircle size={15} /> {running ? 'Playing...' : results ? 'Run the simulation again' : 'Run the simulation'}
          </button>
          <p className="min-w-0 flex-1 text-sm text-slate-600" data-testid="chef-run-plays">
            {segments.length === 0 ? 'No segment to play yet (step 1).' : nothingToCook ? 'No dishes to cook yet (step 2).' : chosen.length === 0 ? 'Pick at least one segment.' : playsText}
          </p>
        </div>
        {running && (
          <div className="mt-3" data-testid="chef-run-progress">
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-purple-600 to-fuchsia-500 transition-all" style={{ width: `${progress.of > 0 ? (progress.done / progress.of) * 100 : 0}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Segment {Math.min(Math.floor(progress.done) + 1, progress.of)} of {progress.of}
            </p>
          </div>
        )}
        <details className="mt-3" data-collapsible="chef-run-options">
          <summary className="cursor-pointer text-xs font-semibold text-purple-700">Change what is played</summary>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600" title="Both views are played every run, on the same players; this one decides met / not met and the detail. Basket luck only: every player opens the baskets expected of the segment (whole baskets; a fraction such as 0.4 a day is 8 or 9 over 21 days, never none), and only what the baskets give differs. Player activity too: players also open more or fewer baskets, on other days (the assumptions are in step 1). The baskets expected on each day are what you typed either way.">
                Targets judged with
                <Toggle data-testid="chef-run-variation" value={variation} onChange={setVariation} options={VARIATIONS.map((id) => [id, VARIATION_LABELS[id]])} />
              </label>
              <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                Players a segment
                <Num data-testid="chef-run-players" value={players} min={10} max={5000} onCommit={(n) => setPlayers(Math.round(n))} className="w-20" />
              </label>
              <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600" title="Type any whole number to play the very same players again: two runs then differ only by what you changed in the event. Empty: new players each run (their number is shown with the result).">
                The same players every run
                <Num data-testid="chef-run-seed" value={seed} allowEmpty min={0} max={2147483647} placeholder="new each run" onCommit={(n) => setSeed(n == null ? null : Math.round(n))} className="w-32" />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2" data-testid="chef-run-segments">
              <span className="text-sm text-slate-600">Segments</span>
              {segments.map((s) => (
                <button key={s.id} type="button" aria-pressed={!leftOut.has(s.id)} onClick={() => toggle(s.id)} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${leftOut.has(s.id) ? 'border border-slate-200 bg-white/70 text-slate-500' : 'bg-purple-600 text-white'}`}>
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
              {olderEngine && sim.key === configKey
                ? 'Out of date: this run was played by an earlier version of the simulation. The figures below are what it gave then - run the simulation again.'
                : 'Out of date: the event was changed after this run. The figures below are for the event as it was - run the simulation again.'}
            </p>
          )}
          <Card title="The event, simulated" subtitle={fuDay != null ? `The FU target is read on ${dayLabel(calendar, fuDay)}. A share is followed by the range it would land in with other players.` : 'No day is set for the FU target (step 1), so the shares at the end of the event lead.'}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse" data-dense data-testid="chef-sim-summary">
                <thead>
                  <tr>
                    <th className={TH} />
                    {fuDay != null && (
                      <th className={`${TH} border-b border-slate-200 text-center`} colSpan={3} title="Three different figures: sitting in FU that day, already finished (not in FU), and neither.">
                        On the FU day
                      </th>
                    )}
                    {checkpoints.length > 0 && (
                      <th className={`${TH} border-b border-slate-200 text-center`} colSpan={checkpoints.length} title="The share of the players with at least that many dishes by that day - not the average number of dishes.">
                        Checkpoints
                      </th>
                    )}
                    {otherCols > 0 && (
                      <th className={`${TH} border-b border-slate-200 bg-sky-50/60 text-center`} colSpan={otherCols} data-testid="chef-sim-other-head" title={`The same players, played with ${otherLabel}. A reading only: met / not met uses ${VARIATION_LABELS[sim.variation].toLowerCase()}.`}>
                        With {otherLabel}
                      </th>
                    )}
                    <th className={`${TH} border-b border-slate-200 text-center`} colSpan={4}>
                      When the event ends
                    </th>
                    <th className={TH} colSpan={2} />
                  </tr>
                  <tr className="border-b border-slate-200">
                    <th className={TH}>Segment</th>
                    {fuDay != null && (
                      <>
                        <th className={`${TH} text-center`} title="One dish left, only blockers missing, the blocker's threshold reached.">
                          In FU
                        </th>
                        <th className={`${TH} text-center`} title="Finished the Main round already. Not counted as in FU.">
                          Finished
                        </th>
                        <th className={`${TH} text-center`} title="In FU that day or on any day before.">
                          Ever in FU
                        </th>
                      </>
                    )}
                    {checkpoints.map((c) => (
                      <th key={c.id} className={`${TH} text-center`}>
                        {c.dishes}+ by day {c.day}
                      </th>
                    ))}
                    {otherCols > 0 && fuDay != null && (
                      <th className={`${TH} bg-sky-50/60 text-center`} title="Sitting in FU on the FU day.">
                        In FU
                      </th>
                    )}
                    {otherCols > 0 &&
                      checkpoints.map((c) => (
                        <th key={`other-${c.id}`} className={`${TH} bg-sky-50/60 text-center`}>
                          {c.dishes}+ by day {c.day}
                        </th>
                      ))}
                    <th className={`${TH} text-center`} title="The Main dishes of the middle player; most players from - to (1 in 10 cooks fewer, 1 in 10 more).">
                      Dishes
                    </th>
                    <th className={`${TH} text-center`}>Finish Main</th>
                    <th className={`${TH} text-center`} title="Enter Recompletion / finish it.">
                      Recompletion
                    </th>
                    <th className={`${TH} text-center`} title="What a player is paid on average, in allowance worth. A star: some prizes are not known and are not counted.">
                      Paid
                    </th>
                    <th className={TH} aria-label="Detail" />
                  </tr>
                </thead>
                <tbody>
                  {results.map(({ segment, result, other }) => {
                    const last = result.days[result.days.length - 1]
                    const n = result.meta.players
                    return (
                      <tr key={segment.id} className="border-b border-slate-100 text-sm" data-sim-segment={segment.id}>
                        <td className={`${TD} whitespace-nowrap font-semibold text-slate-800`}>{segment.name}</td>
                        {fuDay != null && (
                          <>
                            <td className={`${TD} text-center font-semibold ${result.fuTarget?.met ? 'text-emerald-700' : 'text-slate-800'}`} data-cell="in-fu">
                              <Share share={result.fuTarget?.inFu} n={n} />
                              <Mark met={result.fuTarget?.met} />
                            </td>
                            <td className={`${TD} text-center text-slate-600`} data-cell="finished-fu-day">
                              {pct(result.fuTarget?.finished)}
                            </td>
                            <td className={`${TD} text-center text-slate-600`}>{pct(result.fuTarget?.everFu)}</td>
                          </>
                        )}
                        {result.checkpoints.map((c) => (
                          <td key={c.id} className={`${TD} text-center ${c.met ? 'text-emerald-700' : 'text-slate-700'}`} data-cell="checkpoint">
                            <Share share={c.share} n={n} />
                          </td>
                        ))}
                        {otherCols > 0 && fuDay != null && (
                          <td className={`${TD} bg-sky-50/40 text-center text-slate-700`} data-cell="other-in-fu">
                            <Share share={other?.fuTarget?.inFu} n={n} />
                          </td>
                        )}
                        {otherCols > 0 &&
                          result.checkpoints.map((c) => (
                            <td key={`other-${c.id}`} className={`${TD} bg-sky-50/40 text-center text-slate-700`} data-cell="other-checkpoint">
                              <Share share={other?.checkpoints.find((x) => x.id === c.id)?.share} n={n} />
                            </td>
                          ))}
                        <td className={`${TD} whitespace-nowrap text-center tabular-nums text-slate-700`} data-cell="dishes">
                          {last.p50} of {result.mainCount} <span className="text-xs text-slate-400">({last.p10}-{last.p90})</span>
                        </td>
                        <td className={`${TD} text-center text-slate-700`} data-cell="every-dish">
                          <Share share={result.finish.share} n={n} />
                        </td>
                        <td className={`${TD} whitespace-nowrap text-center tabular-nums text-slate-600`}>{result.rcCount ? `${pct(result.rc.enteredShare)} / ${pct(result.rc.doneShare)}` : '-'}</td>
                        <td className={`${TD} whitespace-nowrap text-center tabular-nums text-slate-600`} data-cell="paid">
                          {num(result.payout.mean, 1)}
                          {!result.payout.complete && (
                            <span className="text-amber-700" title={result.payout.missing.join(' ')}>
                              *
                            </span>
                          )}
                        </td>
                        <td className={`${TD} text-right`}>
                          <button type="button" onClick={() => showDetail(segment.id)} className="whitespace-nowrap text-xs font-semibold text-purple-600 hover:text-purple-800">
                            In detail
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-slate-500" data-testid="chef-sim-legend" data-note>
              These are simulated players: another run gives slightly different figures - the range after a share says by how much. "Most players" is something else: how far apart the players are. Recipes,
              baskets and catch-up presets are played as they are - typed by you, or a suggestion you applied in step 4; this step proposes nothing.
            </p>
            <p className="mt-1 text-sm text-slate-600" data-testid="chef-sim-views" data-note>
              {otherLabel
                ? `Both views of the players: met / not met uses ${VARIATION_LABELS[sim.variation].toLowerCase()}; the blue columns play the same players with ${otherLabel}. The gap between the two is how much the result rests on the activity assumptions of step 1, which are not measured.`
                : 'This run was made before both views of the players were played. Run it again to see both.'}
            </p>
            <p className="mt-1 text-xs text-slate-400" data-testid="chef-sim-identity">
              Played on chef {sim.key} · {sim.engine} · {sim.players.toLocaleString()} players a segment · players number {sim.seed}
              {sim.seedTyped ? '' : ' (new this run)'} · {VARIATION_LABELS[sim.variation].toLowerCase()} · played {new Date(sim.at).toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-slate-400" data-testid="chef-sim-kept">
              {runKept ? 'Kept in this browser: it is here when the chef is opened again (the last run of the 4 chefs played most recently).' : 'Not kept: this browser has no room left for it, so it is here for this visit only.'}
            </p>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
            {detail && (
              <Collapsible id="chef-sim-detail" className="scroll-mt-4 xl:open:col-span-2" title={`${detail.segment.name} in detail`} summary="Against the targets, day by day, every ingredient (given, kept, lost, missing), Recompletion, and what a player is paid">
                <div className="flex flex-col gap-4">
                  <Pills data-testid="chef-detail-segments" value={detail.segment.id} onChange={setDetailId} options={results.map(({ segment }) => [segment.id, segment.name])} />
                  <SegmentDetail result={detail.result} other={detail.other} otherLabel={otherLabel} state={state} calendar={calendar} />
                </div>
              </Collapsible>
            )}

            <Collapsible id="chef-sim-curves" className="xl:open:col-span-2" title="Day by day, each segment" summary="The Main dishes cooked on every day: the middle player, and from the slow players to the fast ones">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                {results.map(({ segment, result }) => (
                  <SegmentCurve key={segment.id} segment={segment} result={result} calendar={calendar} />
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-500">The solid bar is the middle player; the lighter band runs from the slow players to the fast ones. A red line marks the FU day.</p>
            </Collapsible>

            {liveSegment && (
              <Collapsible id="chef-sim-presets" className="xl:open:col-span-2" title={`${liveSegment.name}: with and without the catch-up presets`} summary="The same players played both ways: who got a preset, what it changed, who finished too early">
                <PresetComparison key={`${liveSegment.id}-${configKey}`} state={state} segment={liveSegment} run={sim} />
              </Collapsible>
            )}
            {liveSegment && (
              <Collapsible id="chef-sim-trace" className="xl:open:col-span-2" title={`${liveSegment.name}: one player's event, step by step`} summary="Every basket with what was rolled, kept and lost, the dishes, the thresholds, the move to Recompletion">
                <PlayerStory key={`${liveSegment.id}-${configKey}`} state={state} segment={liveSegment} run={sim} calendar={calendar} />
              </Collapsible>
            )}
            {liveSegment && (
              <Collapsible id="chef-sim-whatif" title={`${liveSegment.name}: more or fewer baskets`} summary="Play the event with 30% fewer to 30% more baskets a day">
                <WhatIfBaskets key={`${liveSegment.id}-${configKey}`} state={state} segment={liveSegment} run={sim} />
              </Collapsible>
            )}
          </div>
        </>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
        <Collapsible id="chef-open-rules" className="xl:open:col-span-2" title="What is not settled about the real game" summary="Three rules the simulation has to choose for now - each a setting; the rest are settled with you">
          <OpenRules state={state} onGoTo={onGoTo} stepLabels={stepLabels} />
        </Collapsible>
        <Collapsible
          id="chef-checks"
          className="xl:open:col-span-2"
          title="All the checks"
          summary={
            findings.length === 0
              ? 'Nothing found'
              : SEVERITY_ORDER.map((severity) => [severity, findings.filter((f) => f.severity === severity).length])
                  .filter(([, count]) => count > 0)
                  .map(([severity, count]) => `${count} ${SEVERITY_LABELS[severity].toLowerCase()}`)
                  .join(' · ')
          }
        >
          <AllChecks findings={findings} stepLabels={stepLabels} onGoTo={onGoTo} />
        </Collapsible>
      </div>
    </div>
  )
}
