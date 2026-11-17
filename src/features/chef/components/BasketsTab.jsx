import { useState } from 'react'
import { Plus, Copy, Trash2 } from 'lucide-react'
import Card from '../../../components/ui/Card'
import NumberField from '../../../components/ui/NumberField'
import { CHEST_LABELS, CHEST_TYPES } from '../lib/chefModel'

function WeightTable({ basket, weightsKey, ingredientsById, onUpdate }) {
  const weights = basket[weightsKey] ?? basket.ingredientWeights
  const total = weights.reduce((sum, w) => sum + w.weight, 0)

  function updateRow(ingredientId, patch) {
    const next = weights.map((w) => (w.ingredientId === ingredientId ? { ...w, ...patch } : w))
    onUpdate(basket.id, { [weightsKey]: next })
  }

  return (
    <table className="min-w-full text-xs border-collapse">
      <thead>
        <tr>
          <th className="text-left font-semibold text-slate-500 px-2 py-1">Ingredient</th>
          <th className="text-center font-semibold text-slate-500 px-2 py-1">Weight</th>
          <th className="text-center font-semibold text-slate-500 px-2 py-1">Odds</th>
          <th className="text-center font-semibold text-slate-500 px-2 py-1">Max / open</th>
        </tr>
      </thead>
      <tbody>
        {weights.map((w) => (
          <tr key={w.ingredientId} className="border-t border-slate-100">
            <td className="px-2 py-1 font-medium text-slate-700 whitespace-nowrap">{ingredientsById[w.ingredientId]?.name ?? w.ingredientId}</td>
            <td className="px-1 py-1 text-center">
              <input
                type="number"
                min={0}
                value={w.weight}
                onChange={(e) => updateRow(w.ingredientId, { weight: Number(e.target.value) || 0 })}
                className={`w-16 text-center border rounded-md px-1 py-0.5 ${w.weight === 0 ? 'border-slate-200 text-slate-300' : 'border-purple-200 bg-purple-50/50 font-semibold text-purple-800'}`}
              />
            </td>
            <td className="px-2 py-1 text-center text-slate-500">{total > 0 ? `${((w.weight / total) * 100).toFixed(1)}%` : '—'}</td>
            <td className="px-1 py-1 text-center">
              <input
                type="number"
                min={0}
                value={w.max}
                onChange={(e) => updateRow(w.ingredientId, { max: Number(e.target.value) || 0 })}
                className="w-14 text-center border border-slate-200 rounded-md px-1 py-0.5"
              />
            </td>
          </tr>
        ))}
        {weights.length === 0 && (
          <tr>
            <td colSpan={4} className="px-2 py-2 text-slate-400">
              No ingredients configured on this basket yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

// Each basket's roll is: pick a TOTAL ingredient count uniformly in
// [totalMin,totalMax], then distribute that total across ingredients via a
// weighted draw capped at each ingredient's own per-open max - see
// chefModel.js's createBasket doc comment, reverse-engineered from the
// legacy Ops "Reward String" syntax. A weight of 0 is how a semi-blocker/
// blocker ingredient "opens" at a later phase - set it above 0 on that
// phase's own basket to open it, rather than a separate unlock field.
export default function BasketsTab({ ingredients, baskets, calendar, onUpdate, onAdd, onDuplicate, onRemove }) {
  const [oddsView, setOddsView] = useState('gameplay')
  const ingredientsById = Object.fromEntries(ingredients.map((i) => [i.id, i]))
  const weightsKey = oddsView === 'gameplay' ? 'ingredientWeights' : 'pricingIngredientWeights'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
          {[
            ['gameplay', 'Gameplay odds'],
            ['pricing', 'Pricing odds (for value estimation)'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setOddsView(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${oddsView === id ? 'bg-purple-600 text-white' : 'bg-white/70 text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onAdd} className="flex items-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-800">
          <Plus size={13} /> Add basket
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {baskets.map((basket) => (
          <Card
            key={basket.id}
            title={
              <span className="flex items-center gap-2">
                <select
                  value={basket.chestType}
                  onChange={(e) => onUpdate(basket.id, { chestType: e.target.value })}
                  className="text-sm font-semibold bg-transparent border-b border-transparent focus:border-purple-300 focus:outline-none"
                >
                  {CHEST_TYPES.map((ct) => (
                    <option key={ct} value={ct}>
                      {CHEST_LABELS[ct]}
                    </option>
                  ))}
                </select>
                <span className="text-slate-400">—</span>
                <select
                  value={basket.phaseId ?? ''}
                  onChange={(e) => onUpdate(basket.id, { phaseId: e.target.value })}
                  className="text-sm font-semibold bg-transparent border-b border-transparent focus:border-purple-300 focus:outline-none"
                >
                  {calendar.phases.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </span>
            }
            action={
              <div className="flex items-center">
                <button type="button" title="Duplicate" onClick={() => onDuplicate(basket.id)} className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                  <Copy size={13} />
                </button>
                <button type="button" title="Remove" onClick={() => onRemove(basket.id)} className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50">
                  <Trash2 size={13} />
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-2 gap-2 mb-3">
              <NumberField label="Total min" min={0} value={basket.totalMin} onChange={(e) => onUpdate(basket.id, { totalMin: Number(e.target.value) || 0 })} />
              <NumberField label="Total max" min={0} value={basket.totalMax} onChange={(e) => onUpdate(basket.id, { totalMax: Number(e.target.value) || 0 })} />
            </div>
            <WeightTable basket={basket} weightsKey={weightsKey} ingredientsById={ingredientsById} onUpdate={onUpdate} />
          </Card>
        ))}
        {baskets.length === 0 && <p className="text-sm text-slate-400">No baskets yet — click "Add basket" to start.</p>}
      </div>
    </div>
  )
}
