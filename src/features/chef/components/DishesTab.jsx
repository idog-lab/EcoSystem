import { useState } from 'react'
import { Plus, Copy, Trash2 } from 'lucide-react'
import Card from '../../../components/ui/Card'

// A visual "dish + its ingredients, by name" gallery - by explicit
// economist request, a more legible companion to the dense recipe matrix
// below it (good for bulk-editing many dishes at once, but hard to read
// one dish's own recipe out of at a glance). Art is a plain emoji
// placeholder (see chefModel.js's createDish/createIngredient doc
// comments) - swap for real art once it exists.
function DishGallery({ dishes, ingredientsById, list, onDuplicate, onRemove }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {dishes.map((dish) => (
        <div key={dish.id} className="group relative flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/70 p-3">
          <div className="absolute top-2 right-2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <button type="button" title="Duplicate" onClick={() => onDuplicate(dish.id, list)} className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100">
              <Copy size={13} />
            </button>
            <button type="button" title="Remove" onClick={() => onRemove(dish.id, list)} className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50">
              <Trash2 size={13} />
            </button>
          </div>
          <div className="flex items-center gap-2 pr-12">
            <span className="grid place-items-center w-9 h-9 rounded-xl bg-slate-100 text-lg shrink-0" aria-hidden="true">
              {dish.art ?? '•'}
            </span>
            <span className="font-semibold text-sm text-slate-800 leading-tight">{dish.name}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dish.recipe.map((r) => {
              const ing = ingredientsById[r.ingredientId]
              return (
                <span key={r.ingredientId} className="flex items-center gap-1 text-xs bg-purple-50 text-purple-800 border border-purple-100 rounded-full px-2 py-0.5">
                  <span aria-hidden="true">{ing?.art ?? '•'}</span>
                  {ing?.name ?? r.ingredientId} × {r.count}
                </span>
              )
            })}
            {dish.recipe.length === 0 && <span className="text-xs text-slate-400">No ingredients set</span>}
          </div>
        </div>
      ))}
      {dishes.length === 0 && <p className="text-sm text-slate-400">No dishes yet — add one below.</p>}
    </div>
  )
}

function RecipeTable({ dishes, ingredients, caps, onUpdate, list, onUpdateCap }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left font-semibold text-slate-500 uppercase tracking-wide px-2 py-2 sticky left-0 bg-white/90">Dish</th>
            {ingredients.map((ing) => (
              <th key={ing.id} className="text-center font-semibold text-slate-500 px-2 py-2 whitespace-nowrap">
                <span aria-hidden="true">{ing.art ?? ''}</span> {ing.name}
              </th>
            ))}
            <th className="text-center font-semibold text-slate-500 px-2 py-2">Prize</th>
          </tr>
        </thead>
        <tbody>
          {dishes.map((dish) => (
            <tr key={dish.id} className="border-t border-slate-100">
              <td className="px-2 py-1.5 font-medium text-slate-700 sticky left-0 bg-white/90 whitespace-nowrap">
                <span aria-hidden="true">{dish.art ?? ''}</span>{' '}
                <input
                  value={dish.name}
                  onChange={(e) => onUpdate(dish.id, { name: e.target.value }, list)}
                  className="bg-transparent border-b border-transparent focus:border-purple-300 focus:outline-none"
                />
              </td>
              {ingredients.map((ing) => {
                const count = dish.recipe.find((r) => r.ingredientId === ing.id)?.count ?? 0
                return (
                  <td key={ing.id} className="px-1 py-1 text-center">
                    <input
                      type="number"
                      min={0}
                      value={count}
                      onChange={(e) => {
                        const next = Number(e.target.value) || 0
                        const recipe = dish.recipe.filter((r) => r.ingredientId !== ing.id)
                        if (next > 0) recipe.push({ ingredientId: ing.id, count: next })
                        onUpdate(dish.id, { recipe }, list)
                      }}
                      className={`w-12 text-center border rounded-md px-1 py-0.5 ${count > 0 ? 'border-purple-200 bg-purple-50/50 font-semibold text-purple-800' : 'border-slate-200 text-slate-300'}`}
                    />
                  </td>
                )
              })}
              <td className="px-1 py-1 text-center">
                <input
                  type="number"
                  value={dish.prizeValue ?? ''}
                  onChange={(e) => onUpdate(dish.id, { prizeValue: e.target.value === '' ? null : Number(e.target.value) }, list)}
                  className="w-16 text-center border border-slate-200 rounded-md px-1 py-0.5"
                />
              </td>
            </tr>
          ))}
          {caps && (
            <tr className="border-t border-slate-200 bg-slate-50/60">
              <td className="px-2 py-1.5 font-semibold text-slate-500 sticky left-0 bg-slate-50/90">Demand cap</td>
              {ingredients.map((ing) => (
                <td key={ing.id} className="px-1 py-1 text-center">
                  <input
                    type="number"
                    min={0}
                    value={caps[ing.id] ?? ''}
                    onChange={(e) => onUpdateCap(ing.id, e.target.value === '' ? null : Number(e.target.value))}
                    className="w-12 text-center border border-slate-200 rounded-md px-1 py-0.5 text-slate-600 bg-white/70"
                  />
                </td>
              ))}
              <td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default function DishesTab({ ingredients, dishes, recompletionDishes, recompletionCaps, totalChefPrize, onUpdate, onUpdateRecompletionCap, onAdd, onDuplicate, onRemove }) {
  const [view, setView] = useState('main')
  const ingredientsById = Object.fromEntries(ingredients.map((i) => [i.id, i]))
  const activeDishes = view === 'main' ? dishes : recompletionDishes

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {[
          ['main', 'Dishes'],
          ['recompletion', 'Recompletion dishes'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${view === id ? 'bg-purple-600 text-white' : 'bg-white/70 text-slate-600'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <Card
        title={view === 'main' ? 'Dishes' : 'Dishes (Recompletion)'}
        subtitle="Each dish with the ingredients (and amounts) its recipe needs, by name. Rename/edit recipe amounts in the matrix below."
        action={
          <button type="button" onClick={() => onAdd(view)} className="flex items-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-800">
            <Plus size={13} /> Add dish
          </button>
        }
      >
        <DishGallery dishes={activeDishes} ingredientsById={ingredientsById} list={view} onDuplicate={onDuplicate} onRemove={onRemove} />
      </Card>

      <Card
        title={view === 'main' ? 'Recipe matrix' : 'Recipe matrix (Recompletion)'}
        subtitle="Prize values are the Low-tier number — a segment's own prize tier multiplier applies on top (see Segments tab)."
      >
        {view === 'main' ? (
          <RecipeTable dishes={dishes} ingredients={ingredients} onUpdate={onUpdate} list="main" />
        ) : (
          <RecipeTable
            dishes={recompletionDishes}
            ingredients={ingredients}
            caps={recompletionCaps}
            onUpdate={onUpdate}
            onUpdateCap={onUpdateRecompletionCap}
            list="recompletion"
          />
        )}
      </Card>

      <Card title="Total chef prize" subtitle="The whole event's own grand-prize value, by segment prize tier — separate from any one dish's prizeValue.">
        <div className="flex gap-6 text-sm">
          {Object.entries(totalChefPrize).map(([tier, value]) => (
            <div key={tier} className="flex flex-col">
              <span className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">{tier}</span>
              <span className="font-display text-lg font-bold text-slate-800">{value}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
