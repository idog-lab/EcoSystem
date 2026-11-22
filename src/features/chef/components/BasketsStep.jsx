import { useState } from 'react'
import Card from '../../../components/ui/Card'
import Collapsible from '../../../components/ui/Collapsible'
import { CHEST_LABELS, CHEST_TYPES, RARITY, RARITY_LABELS, calendarDateForDay, formatCalendarDate, phaseDayRange } from '../lib/chefModel'
import { dayLabel } from '../lib/chefFormat'
import { AddButton, Num, RowActions, Toggle, SELECT, TD, TH } from './chefUi'

const RARITY_COLOR = {
  [RARITY.SEMI_BLOCKER]: 'bg-violet-100 text-violet-700',
  [RARITY.BLOCKER]: 'bg-rose-100 text-rose-700',
}

// One basket's odds. `weightsKey` is the table in view: the real odds
// (`ingredientWeights`) or the pricing odds (`pricingIngredientWeights`, a
// separate table from the source sheet that only the basket-value estimate
// of step 5 reads). A basket with no pricing table shows its real odds
// there, and the first edit gives it a pricing table of its own.
// A ROW FOR EVERY INGREDIENT OF THE CHEF. An ingredient added after the basket
// was made is not in the basket's table. It is shown with a weight of 0 -
// which is what it is: the basket never gives it - and the first edit puts it
// in the table. (Before, such an ingredient had no row, so it could never be
// given a weight in a basket that already existed.)
function WeightTable({ basket, weightsKey, ingredients, ingredientsById, onUpdate }) {
  const weights = basket[weightsKey] ?? basket.ingredientWeights
  const total = weights.reduce((sum, w) => sum + w.weight, 0)
  const inTable = new Set(weights.map((w) => w.ingredientId))
  const rows = [...weights, ...ingredients.filter((ing) => !inTable.has(ing.id)).map((ing) => ({ ingredientId: ing.id, min: 0, max: 1, weight: 0 }))]

  function updateRow(ingredientId, patch) {
    const next = rows.filter((w) => inTable.has(w.ingredientId) || w.ingredientId === ingredientId).map((w) => (w.ingredientId === ingredientId ? { ...w, ...patch } : w))
    onUpdate(basket.id, { [weightsKey]: next })
  }

  return (
    <table className="w-full border-collapse" data-dense>
      <thead>
        <tr className="border-b border-slate-200">
          <th className={TH}>Ingredient</th>
          <th className={`${TH} text-center`} title="How likely each ingredient is against the others. 0 keeps it out of this basket.">
            Weight
          </th>
          <th className={`${TH} text-center`} title="The weight as a share of all the weights of this basket.">
            Chance
          </th>
          <th className={`${TH} text-center`} title="The most of this ingredient one basket can give.">
            Most a basket
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((w) => {
          const ing = ingredientsById[w.ingredientId]
          return (
            <tr key={w.ingredientId} className="border-b border-slate-100" data-weight-row={w.ingredientId}>
              <td className={`${TD} whitespace-nowrap text-sm font-medium text-slate-700`}>
                <span aria-hidden="true">{ing?.art ?? ''}</span> {ing?.name ?? w.ingredientId}
              </td>
              <td className={`${TD} text-center`}>
                <Num
                  aria-label={`${ing?.name ?? w.ingredientId}: weight`}
                  value={w.weight}
                  step="any"
                  onCommit={(n) => updateRow(w.ingredientId, { weight: n })}
                  className={`w-16 ${w.weight === 0 ? 'text-slate-300' : 'border-purple-200 bg-purple-50/60 font-semibold text-purple-800'}`}
                />
              </td>
              <td className={`${TD} text-center text-sm tabular-nums text-slate-500`}>{total > 0 && w.weight > 0 ? `${((w.weight / total) * 100).toFixed(1)}%` : '-'}</td>
              <td className={`${TD} text-center`}>
                <Num aria-label={`${ing?.name ?? w.ingredientId}: most a basket`} value={w.max} onCommit={(n) => updateRow(w.ingredientId, { max: Math.round(n) })} className="w-14" />
              </td>
            </tr>
          )
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={4} className="px-2 py-2 text-sm text-slate-400">
              No ingredients on this basket yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

function BasketCard({ basket, calendar, weightsKey, ingredients, ingredientsById, onUpdate, onDuplicate, onRemove }) {
  const pricing = weightsKey === 'pricingIngredientWeights'
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          <select value={basket.chestType} aria-label="Basket type" onChange={(e) => onUpdate(basket.id, { chestType: e.target.value })} className={`${SELECT} font-semibold`}>
            {CHEST_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {CHEST_LABELS[ct]} basket
              </option>
            ))}
          </select>
          <select value={basket.phaseId ?? ''} aria-label="The phase this basket is for" onChange={(e) => onUpdate(basket.id, { phaseId: e.target.value })} className={SELECT}>
            {!calendar.phases.some((p) => p.id === basket.phaseId) && <option value={basket.phaseId ?? ''}>No phase</option>}
            {calendar.phases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </span>
      }
      action={<RowActions what="this basket" onDuplicate={() => onDuplicate(basket.id)} onRemove={() => onRemove(basket.id)} />}
    >
      <div data-basket={`${basket.chestType}-${basket.phaseId}`}>
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          Gives from
          <Num aria-label="Fewest ingredients a basket gives" data-field="total-min" value={basket.totalMin} onCommit={(n) => onUpdate(basket.id, { totalMin: Math.round(n) })} className="w-14" />
          to
          <Num aria-label="Most ingredients a basket gives" data-field="total-max" value={basket.totalMax} onCommit={(n) => onUpdate(basket.id, { totalMax: Math.round(n) })} className="w-14" />
          ingredients
        </p>
        {pricing && !basket.pricingIngredientWeights && <p className="mb-2 text-xs text-slate-500">No pricing odds of its own: these are its real odds. A change here gives it pricing odds.</p>}
        <WeightTable basket={basket} weightsKey={weightsKey} ingredients={ingredients} ingredientsById={ingredientsById} onUpdate={onUpdate} />
      </div>
    </Card>
  )
}

// What is handed to players outside the baskets: a sale bundle, an event
// reward. A grant is { day, ingredient, amount, share of players }. The
// share is one group of players for every grant (the most engaged first), so
// a 50% grant reaches everyone a 20% grant reaches.
function Grants({ grants, calendar, ingredients, onAdd, onUpdate, onRemove }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-600" data-note>
        Ingredients the business hands out besides the baskets - a sale bundle, an event reward. The share is the part of the players who get it, the most engaged first: whoever gets a 20%
        one also gets a 50% one.
      </p>
      {grants.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" data-dense data-testid="chef-grants">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={`${TH} text-center`}>Day</th>
                <th className={TH}>Date</th>
                <th className={TH}>Ingredient</th>
                <th className={`${TH} text-center`}>Amount</th>
                <th className={`${TH} text-center`}>Share of players</th>
                <th className={TH}>Note</th>
                <th className={TH} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {grants.map((grant) => (
                <tr key={grant.id} className="border-b border-slate-100">
                  <td className={`${TD} text-center`}>
                    <Num aria-label="Day" value={grant.day} min={1} max={Math.max(1, calendar.totalDays)} onCommit={(n) => onUpdate(grant.id, { day: Math.round(n) })} className="w-14" />
                  </td>
                  <td className={`${TD} whitespace-nowrap text-sm text-slate-500`}>{dayLabel(calendar, grant.day)}</td>
                  <td className={TD}>
                    <select value={grant.ingredientId ?? ''} aria-label="Ingredient" onChange={(e) => onUpdate(grant.id, { ingredientId: e.target.value })} className={SELECT}>
                      {ingredients.map((ing) => (
                        <option key={ing.id} value={ing.id}>
                          {ing.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={`${TD} text-center`}>
                    <Num aria-label="Amount" value={grant.amount} onCommit={(n) => onUpdate(grant.id, { amount: Math.round(n) })} className="w-16" />
                  </td>
                  <td className={`${TD} text-center`}>
                    <span className="inline-flex items-center gap-1 text-sm text-slate-500">
                      <Num aria-label="Share of players, in %" value={grant.coveragePct} max={100} onCommit={(n) => onUpdate(grant.id, { coveragePct: n })} className="w-16" />%
                    </span>
                  </td>
                  <td className={TD}>
                    <input
                      value={grant.label ?? ''}
                      aria-label="Note"
                      placeholder="sale, event..."
                      onChange={(e) => onUpdate(grant.id, { label: e.target.value })}
                      className="w-full min-w-[8rem] rounded-lg border border-slate-200 bg-white/80 px-2 py-1 text-sm text-slate-700 focus:border-purple-400 focus:outline-none"
                    />
                  </td>
                  <td className={`${TD} text-right`}>
                    <RowActions what="this line" onRemove={() => onRemove(grant.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <AddButton onClick={onAdd} data-testid="chef-add-grant" disabled={ingredients.length === 0}>
          Add a sale or event reward
        </AddButton>
      </div>
    </div>
  )
}

// Every way a player gets a blocker or semi-blocker, and when: read off the
// baskets and the grants, nothing of its own.
function BlockerSources({ ingredients, baskets, calendar, grants }) {
  const blockers = ingredients.filter((i) => i.rarity === RARITY.SEMI_BLOCKER || i.rarity === RARITY.BLOCKER)
  if (blockers.length === 0) return <p className="text-sm text-slate-400">No ingredient is a blocker or a semi-blocker (step 2).</p>
  const phaseOrder = new Map(calendar.phases.map((p, i) => [p.id, i]))
  const ordered = [...baskets].sort((a, b) => (phaseOrder.get(a.phaseId) ?? 99) - (phaseOrder.get(b.phaseId) ?? 99) || CHEST_TYPES.indexOf(a.chestType) - CHEST_TYPES.indexOf(b.chestType))
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {blockers.map((ing) => {
        const own = grants.filter((g) => g.ingredientId === ing.id)
        return (
          <div key={ing.id} className="rounded-2xl border border-slate-200 bg-white/70 p-3" data-blocker={ing.id}>
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <span aria-hidden="true">{ing.art ?? '•'}</span>
              {ing.name}
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${RARITY_COLOR[ing.rarity]}`}>{RARITY_LABELS[ing.rarity]}</span>
            </p>
            <table className="w-full border-collapse" data-dense>
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={TH}>From</th>
                  <th className={TH}>When</th>
                  <th className={`${TH} text-center`}>Chance</th>
                  <th className={`${TH} text-center`}>Most a basket</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((basket) => {
                  const row = basket.ingredientWeights.find((w) => w.ingredientId === ing.id)
                  const sum = basket.ingredientWeights.reduce((s, w) => s + w.weight, 0)
                  const range = phaseDayRange(calendar, basket.phaseId)
                  const from = range ? calendarDateForDay(calendar, range.startDay) : null
                  const to = range ? calendarDateForDay(calendar, range.endDay) : null
                  const available = (row?.weight ?? 0) > 0
                  const phase = calendar.phases.find((p) => p.id === basket.phaseId)
                  return (
                    <tr key={basket.id} className={`border-b border-slate-100 text-sm ${available ? 'text-slate-700' : 'text-slate-400'}`}>
                      <td className={`${TD} whitespace-nowrap`}>
                        {CHEST_LABELS[basket.chestType]} basket, {phase?.label ?? 'no phase'}
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>{from ? `${formatCalendarDate(from)} to ${formatCalendarDate(to)}` : range ? `Day ${range.startDay} to ${range.endDay}` : '-'}</td>
                      <td className={`${TD} text-center tabular-nums`}>{available && sum > 0 ? `${((row.weight / sum) * 100).toFixed(1)}%` : 'not yet'}</td>
                      <td className={`${TD} text-center tabular-nums`}>{available ? row.max : '-'}</td>
                    </tr>
                  )
                })}
                {own.map((grant) => (
                  <tr key={grant.id} className="border-b border-slate-100 text-sm text-slate-700">
                    <td className={`${TD} whitespace-nowrap`}>{grant.label || 'Sale or event'}</td>
                    <td className={`${TD} whitespace-nowrap`}>{dayLabel(calendar, grant.day)}</td>
                    <td className={`${TD} text-center tabular-nums`}>{grant.coveragePct}% of players</td>
                    <td className={`${TD} text-center tabular-nums`}>{grant.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {own.length === 0 && <p className="mt-2 text-xs text-slate-500">Nothing from sales or events.</p>}
          </div>
        )
      })}
    </div>
  )
}

// STEP 3 - BASKETS: what a basket gives in each phase, and what is handed
// out besides. One phase is in view at a time, its three baskets side by
// side. A basket's roll: a number of ingredients between its smallest and
// largest, each drawn by weight, no ingredient more than its most per
// basket (chefModel.js's createBasket). A weight of 0 keeps an ingredient
// out - that is how a blocker opens in a later phase.
export default function BasketsStep({ ingredients, baskets, calendar, grants, findings = [], onUpdateBasket, onAddBasket, onDuplicateBasket, onRemoveBasket, onAddGrant, onUpdateGrant, onRemoveGrant }) {
  const [phaseInView, setPhaseInView] = useState(calendar.phases[0]?.id ?? null)
  const [oddsView, setOddsView] = useState('gameplay')
  const ingredientsById = Object.fromEntries(ingredients.map((i) => [i.id, i]))
  const weightsKey = oddsView === 'gameplay' ? 'ingredientWeights' : 'pricingIngredientWeights'
  const phaseId = calendar.phases.some((p) => p.id === phaseInView) ? phaseInView : (calendar.phases[0]?.id ?? null)
  const byType = (a, b) => CHEST_TYPES.indexOf(a.chestType) - CHEST_TYPES.indexOf(b.chestType)
  const inView = baskets.filter((b) => b.phaseId === phaseId).sort(byType)
  const noPhase = baskets.filter((b) => !calendar.phases.some((p) => p.id === b.phaseId)).sort(byType)
  const blockers = ingredients.filter((i) => i.rarity === RARITY.SEMI_BLOCKER || i.rarity === RARITY.BLOCKER)
  const grantTrouble = findings.some((f) => f.area === 'Grants' && f.severity !== 'info')
  const phaseText = (phase) => {
    const range = phaseDayRange(calendar, phase.id)
    return range ? `${phase.label} (day ${range.startDay} to ${range.endDay})` : phase.label
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="min-w-0 rounded-3xl border border-white bg-white/90 px-5 py-3.5 shadow-lg shadow-purple-950/5 ring-1 ring-slate-200/70" data-testid="chef-baskets-head">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <h2 className="font-display text-[0.95rem] font-semibold tracking-tight text-slate-800">3. Baskets</h2>
          <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            Phase
            <Toggle data-testid="chef-basket-phase" value={phaseId} onChange={setPhaseInView} options={calendar.phases.map((p) => [p.id, phaseText(p)])} />
          </label>
          <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            Odds
            <Toggle
              data-testid="chef-basket-odds"
              value={oddsView}
              onChange={setOddsView}
              options={[
                ['gameplay', 'Real odds'],
                ['pricing', 'Pricing odds'],
              ]}
            />
          </label>
          <span className="ml-auto">
            <AddButton onClick={() => onAddBasket(phaseId)} data-testid="chef-add-basket" disabled={!phaseId}>
              Add a basket
            </AddButton>
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-500" data-note>
          A basket gives a number of ingredients; each is drawn by weight, and no ingredient more than its most per basket. A weight of 0 keeps an ingredient out of a phase - that is how a blocker
          opens later.{oddsView === 'pricing' && ' Pricing odds are only read by the basket value of step 5; players get the real odds.'}
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3" data-testid="chef-baskets">
        {inView.map((basket) => (
          <BasketCard key={basket.id} basket={basket} calendar={calendar} weightsKey={weightsKey} ingredients={ingredients} ingredientsById={ingredientsById} onUpdate={onUpdateBasket} onDuplicate={onDuplicateBasket} onRemove={onRemoveBasket} />
        ))}
        {inView.length === 0 && <p className="text-sm text-slate-400">No basket is set for this phase yet.</p>}
      </div>

      {noPhase.length > 0 && (
        <div className="flex flex-col gap-3" data-testid="chef-baskets-no-phase">
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {noPhase.length === 1 ? 'One basket belongs' : `${noPhase.length} baskets belong`} to a phase that is not in the calendar, so no player ever opens {noPhase.length === 1 ? 'it' : 'them'}. Pick a
            phase for {noPhase.length === 1 ? 'it' : 'each'}, or remove {noPhase.length === 1 ? 'it' : 'them'}.
          </p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {noPhase.map((basket) => (
              <BasketCard key={basket.id} basket={basket} calendar={calendar} weightsKey={weightsKey} ingredients={ingredients} ingredientsById={ingredientsById} onUpdate={onUpdateBasket} onDuplicate={onDuplicateBasket} onRemove={onRemoveBasket} />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
        <Collapsible
          id="chef-grants"
          className="xl:open:col-span-2"
          title="Given outside the baskets: sales and events"
          summary={grants.length === 0 ? 'Nothing: every ingredient comes from a basket' : `${grants.length} ${grants.length === 1 ? 'line' : 'lines'}: ${[...new Set(grants.map((g) => ingredientsById[g.ingredientId]?.name ?? '?'))].join(', ')}`}
          openWhen={grantTrouble}
        >
          <Grants grants={grants} calendar={calendar} ingredients={ingredients} onAdd={onAddGrant} onUpdate={onUpdateGrant} onRemove={onRemoveGrant} />
        </Collapsible>
        <Collapsible
          id="chef-blockers"
          className="xl:open:col-span-2"
          title="Where each blocker comes from, and when"
          summary={blockers.length === 0 ? 'No blocker or semi-blocker ingredient' : `${blockers.map((b) => b.name).join(', ')}: every basket and sale that gives it`}
        >
          <BlockerSources ingredients={ingredients} baskets={baskets} calendar={calendar} grants={grants} />
        </Collapsible>
      </div>
    </div>
  )
}
