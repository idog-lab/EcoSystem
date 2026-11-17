import Card from '../../../components/ui/Card'
import { RARITY, RARITY_LABELS, CHEST_LABELS, calendarDateForDay, formatCalendarDate, phaseDayRange } from '../lib/chefModel'

const RARITY_COLOR = {
  [RARITY.SEMI_BLOCKER]: 'bg-violet-100 text-violet-700',
  [RARITY.BLOCKER]: 'bg-rose-100 text-rose-700',
}

function BasketSourceTable({ ingredientId, baskets, calendar }) {
  const rows = baskets.map((basket) => {
    const weightRow = basket.ingredientWeights.find((w) => w.ingredientId === ingredientId)
    const sumWeight = basket.ingredientWeights.reduce((sum, w) => sum + w.weight, 0)
    const range = phaseDayRange(calendar, basket.phaseId)
    const startDate = range ? calendarDateForDay(calendar, range.startDay) : null
    const endDate = range ? calendarDateForDay(calendar, range.endDay) : null
    return { basket, weightRow, sumWeight, startDate, endDate }
  })

  return (
    <table className="min-w-full text-xs">
      <thead>
        <tr>
          <th className="text-left font-semibold text-slate-500 px-2 py-1">Basket</th>
          <th className="text-left font-semibold text-slate-500 px-2 py-1">When</th>
          <th className="text-center font-semibold text-slate-500 px-2 py-1">Odds</th>
          <th className="text-center font-semibold text-slate-500 px-2 py-1">Max / open</th>
          <th className="text-center font-semibold text-slate-500 px-2 py-1">Available?</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ basket, weightRow, sumWeight, startDate, endDate }) => {
          const available = (weightRow?.weight ?? 0) > 0
          return (
            <tr key={basket.id} className="border-t border-slate-100">
              <td className="px-2 py-1 font-medium text-slate-700 whitespace-nowrap">
                {CHEST_LABELS[basket.chestType]} — {basket.phaseId}
              </td>
              <td className="px-2 py-1 text-slate-500 whitespace-nowrap">
                {startDate ? `${formatCalendarDate(startDate)} – ${formatCalendarDate(endDate)}` : basket.phaseId}
              </td>
              <td className="px-2 py-1 text-center text-slate-600">{available && sumWeight > 0 ? `${((weightRow.weight / sumWeight) * 100).toFixed(1)}%` : '—'}</td>
              <td className="px-2 py-1 text-center text-slate-600">{available ? weightRow.max : '—'}</td>
              <td className="px-2 py-1 text-center">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${available ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                  {available ? 'Available' : 'Not yet'}
                </span>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function GrantSourceTable({ ingredientId, grants, calendar }) {
  const rows = grants.filter((g) => g.ingredientId === ingredientId)
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400">No sales/event grants configured for this ingredient yet — see the Calendar tab to add one.</p>
  }
  return (
    <table className="min-w-full text-xs">
      <thead>
        <tr>
          <th className="text-left font-semibold text-slate-500 px-2 py-1">When</th>
          <th className="text-center font-semibold text-slate-500 px-2 py-1">Amount</th>
          <th className="text-center font-semibold text-slate-500 px-2 py-1">Coverage</th>
          <th className="text-left font-semibold text-slate-500 px-2 py-1">Label</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((grant) => (
          <tr key={grant.id} className="border-t border-slate-100">
            <td className="px-2 py-1 text-slate-700 whitespace-nowrap">{formatCalendarDate(calendarDateForDay(calendar, grant.day)) ?? `Day ${grant.day}`}</td>
            <td className="px-2 py-1 text-center text-slate-600">{grant.amount}</td>
            <td className="px-2 py-1 text-center text-slate-600">{grant.coveragePct}%</td>
            <td className="px-2 py-1 text-slate-500">{grant.label || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// A single consolidated place answering "every way a player can get a
// blocker/semi-blocker ingredient, and when" - by explicit economist
// request. Two sources exist in this data model: real basket odds
// (chefModel.js's createBasket - a weight of 0 on an early phase's basket
// IS how an ingredient "isn't available yet"), and ingredient grants
// (chefModel.js's createGrant - direct sale bundles or event rewards,
// configured in the Calendar tab). This tab doesn't introduce a third data
// source of its own; it's a read-only, ingredient-centric view over the
// same two the Baskets and Calendar tabs already edit.
export default function BlockerSourcesTab({ ingredients, baskets, calendar, grants }) {
  const blockerIngredients = ingredients.filter((i) => i.rarity === RARITY.SEMI_BLOCKER || i.rarity === RARITY.BLOCKER)

  if (blockerIngredients.length === 0) {
    return <p className="text-sm text-slate-400">No semi-blocker/blocker ingredients configured — see the Ingredients tab.</p>
  }

  return (
    <div className="flex flex-col gap-4">
      {blockerIngredients.map((ing) => (
        <Card
          key={ing.id}
          title={
            <span className="flex items-center gap-2">
              <span aria-hidden="true">{ing.art ?? '•'}</span>
              {ing.name}
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${RARITY_COLOR[ing.rarity]}`}>{RARITY_LABELS[ing.rarity]}</span>
            </span>
          }
          subtitle="Every basket and every sale/event grant that can hand a player this ingredient, and when."
        >
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">From baskets</h3>
              <BasketSourceTable ingredientId={ing.id} baskets={baskets} calendar={calendar} />
            </div>
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">From events & offers</h3>
              <GrantSourceTable ingredientId={ing.id} grants={grants} calendar={calendar} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
