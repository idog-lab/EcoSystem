import { useState } from 'react'
import Card from '../../../components/ui/Card'
import Collapsible from '../../../components/ui/Collapsible'
import { RARITY, RARITY_LABELS, RARITY_ORDER, PRIZE_TIERS } from '../lib/chefModel'
import { AddButton, Num, RowActions, Toggle, NAME_INPUT, TD, TH } from './chefUi'

const RARITY_COLOR = {
  [RARITY.COMMON]: 'bg-slate-100 text-slate-600',
  [RARITY.RARE]: 'bg-sky-100 text-sky-700',
  [RARITY.SEMI_BLOCKER]: 'bg-violet-100 text-violet-700',
  [RARITY.BLOCKER]: 'bg-rose-100 text-rose-700',
}

// The table a dish list is typed in: one row a dish, one column an
// ingredient, the number the recipe needs. A count of 0 takes the
// ingredient out of the recipe. The Recompletion list has one more row, the
// demand cap of each ingredient in that round (data kept from the source
// sheet; the simulator does not read it).
function RecipeTable({ dishes, ingredients, caps, onUpdate, list, onUpdateCap, onDuplicate, onRemove }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" data-dense data-testid="chef-recipes">
        <thead>
          <tr className="border-b border-slate-200">
            <th className={TH}>Dish</th>
            {ingredients.map((ing) => (
              <th key={ing.id} className="px-1 py-1.5 text-center text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-500" title={`${ing.name} (${RARITY_LABELS[ing.rarity]})`}>
                <span className="block" aria-hidden="true">
                  {ing.art ?? ''}
                </span>
                {ing.name}
              </th>
            ))}
            <th className={`${TH} text-center`} title="The dish's prize at the low prize size. A segment's prize size multiplies it (step 1).">
              Prize
            </th>
            <th className={TH} aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {dishes.map((dish) => (
            <tr key={dish.id} className="border-b border-slate-100" data-dish={dish.id}>
              <td className={`${TD} whitespace-nowrap`}>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true">{dish.art ?? ''}</span>
                  <input value={dish.name} aria-label="Dish name" onChange={(e) => onUpdate(dish.id, { name: e.target.value }, list)} className={`${NAME_INPUT} min-w-[9rem]`} />
                </span>
              </td>
              {ingredients.map((ing) => {
                const count = dish.recipe.find((r) => r.ingredientId === ing.id)?.count ?? 0
                return (
                  <td key={ing.id} className={`${TD} text-center`}>
                    <Num
                      aria-label={`${dish.name}: ${ing.name}`}
                      value={count}
                      onCommit={(n) => {
                        const next = Math.round(n)
                        const recipe = dish.recipe.filter((r) => r.ingredientId !== ing.id)
                        if (next > 0) recipe.push({ ingredientId: ing.id, count: next })
                        onUpdate(dish.id, { recipe }, list)
                      }}
                      className={`w-12 ${count > 0 ? 'border-purple-200 bg-purple-50/60 font-semibold text-purple-800' : 'text-slate-300'}`}
                    />
                  </td>
                )
              })}
              <td className={`${TD} text-center`}>
                <Num aria-label={`${dish.name}: prize`} value={dish.prizeValue} allowEmpty step="any" onCommit={(n) => onUpdate(dish.id, { prizeValue: n }, list)} className="w-16" />
              </td>
              <td className={`${TD} text-right`}>
                <RowActions what={dish.name} onDuplicate={() => onDuplicate(dish.id, list)} onRemove={() => onRemove(dish.id, list)} />
              </td>
            </tr>
          ))}
          {dishes.length === 0 && (
            <tr>
              <td colSpan={ingredients.length + 3} className="px-2 py-3 text-sm text-slate-400">
                No dishes yet.
              </td>
            </tr>
          )}
          {caps && (
            <tr className="border-t border-slate-200 bg-slate-50/60" data-testid="chef-recompletion-caps">
              <td className={`${TD} text-sm font-semibold text-slate-500`}>Demand cap</td>
              {ingredients.map((ing) => (
                <td key={ing.id} className={`${TD} text-center`}>
                  <Num aria-label={`Demand cap: ${ing.name}`} value={caps[ing.id] ?? null} allowEmpty onCommit={(n) => onUpdateCap(ing.id, n)} className="w-12" />
                </td>
              ))}
              <td colSpan={2} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// The dishes as cards: each dish with what it needs, by name. For reading -
// the table above is where a recipe is typed.
function DishGallery({ dishes, ingredientsById }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {dishes.map((dish) => (
        <div key={dish.id} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/70 p-3">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-lg" aria-hidden="true">
              {dish.art ?? '•'}
            </span>
            <span className="text-sm font-semibold leading-tight text-slate-800">{dish.name}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dish.recipe.map((r) => {
              const ing = ingredientsById[r.ingredientId]
              return (
                <span key={r.ingredientId} className="flex items-center gap-1 rounded-full border border-purple-100 bg-purple-50 px-2 py-0.5 text-xs text-purple-800">
                  <span aria-hidden="true">{ing?.art ?? '•'}</span>
                  {ing?.name ?? r.ingredientId} x {r.count}
                </span>
              )
            })}
            {dish.recipe.length === 0 && <span className="text-xs text-slate-400">Needs nothing yet</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

// STEP 2 - INGREDIENTS AND DISHES: what players collect, and what they cook
// with it. Typed: the ingredients (name, kind, demand cap), each dish's
// recipe and prize - for the dishes and for the Recompletion dishes - and
// the prize for cooking every dish. Folded: the dishes as cards.
export default function DishesStep({
  ingredients,
  dishes,
  recompletionDishes,
  recompletionCaps,
  totalChefPrize,
  onUpdateIngredient,
  onAddIngredient,
  onDuplicateIngredient,
  onRemoveIngredient,
  onUpdateDish,
  onAddDish,
  onDuplicateDish,
  onRemoveDish,
  onUpdateRecompletionCap,
  onUpdateTotalPrize,
}) {
  const [view, setView] = useState('main')
  const ingredientsById = Object.fromEntries(ingredients.map((i) => [i.id, i]))
  const activeDishes = view === 'main' ? dishes : recompletionDishes

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(29rem,4fr)_minmax(0,11fr)] xl:items-start">
        <Card
          title="2. Ingredients"
          subtitle="Removing one takes it out of every recipe, basket and sale."
          action={
            <AddButton onClick={onAddIngredient} data-testid="chef-add-ingredient">
              Add
            </AddButton>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" data-dense data-testid="chef-ingredients">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={TH}>Ingredient</th>
                  <th className={TH}>Kind</th>
                  <th className={`${TH} text-center`} title="The most of it the dishes ever ask for. Kept from the source sheet; the simulator does not read it.">
                    Demand cap
                  </th>
                  <th className={TH} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {ingredients.map((ing) => (
                  <tr key={ing.id} className="border-b border-slate-100" data-ingredient={ing.id}>
                    <td className={TD}>
                      <span className="flex items-center gap-1.5">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-slate-100 text-sm" aria-hidden="true">
                          {ing.art ?? '•'}
                        </span>
                        <input value={ing.name} aria-label="Ingredient name" onChange={(e) => onUpdateIngredient(ing.id, { name: e.target.value })} className={`${NAME_INPUT} min-w-[5.5rem]`} />
                      </span>
                    </td>
                    <td className={TD}>
                      <select
                        value={ing.rarity}
                        aria-label={`${ing.name}: kind`}
                        onChange={(e) => onUpdateIngredient(ing.id, { rarity: e.target.value })}
                        className={`rounded-full border-0 px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-purple-300 ${RARITY_COLOR[ing.rarity]}`}
                      >
                        {RARITY_ORDER.map((r) => (
                          <option key={r} value={r}>
                            {RARITY_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={`${TD} text-center`}>
                      <Num aria-label={`${ing.name}: demand cap`} value={ing.cap ?? 0} onCommit={(n) => onUpdateIngredient(ing.id, { cap: Math.round(n) })} className="w-14" />
                    </td>
                    <td className={`${TD} text-right`}>
                      <RowActions what={ing.name} onDuplicate={() => onDuplicateIngredient(ing.id)} onRemove={() => onRemoveIngredient(ing.id)} />
                    </td>
                  </tr>
                ))}
                {ingredients.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-3 text-sm text-slate-400">
                      No ingredients yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title={view === 'main' ? 'Dishes: what each one needs' : 'Recompletion dishes: what each one needs'}
          subtitle="One row a dish, one column an ingredient. Recompletion is the round players cook after the dishes are done."
          action={
            <span className="flex flex-wrap items-center gap-3">
              <Toggle
                data-testid="chef-dish-list"
                value={view}
                onChange={setView}
                options={[
                  ['main', `Dishes (${dishes.length})`],
                  ['recompletion', `Recompletion (${recompletionDishes.length})`],
                ]}
              />
              <AddButton onClick={() => onAddDish(view)} data-testid="chef-add-dish">
                Add a dish
              </AddButton>
            </span>
          }
        >
          <RecipeTable
            dishes={activeDishes}
            ingredients={ingredients}
            caps={view === 'main' ? null : recompletionCaps}
            onUpdate={onUpdateDish}
            onUpdateCap={onUpdateRecompletionCap}
            onDuplicate={onDuplicateDish}
            onRemove={onRemoveDish}
            list={view}
          />
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3" data-testid="chef-total-prize">
            <span className="text-sm font-semibold text-slate-700" title="Paid once, on top of the dishes' own prizes, to a player who cooks every dish of the list. One value a prize size.">
              Prize for cooking every dish
            </span>
            {PRIZE_TIERS.map((tier) => (
              <label key={tier} className="flex items-center gap-1.5 text-sm text-slate-600">
                <span className="capitalize">{tier}</span>
                <Num aria-label={`Prize for cooking every dish: ${tier}`} data-tier={tier} step="any" value={totalChefPrize[tier] ?? 0} onCommit={(n) => onUpdateTotalPrize(tier, n)} className="w-20" />
              </label>
            ))}
          </div>
        </Card>
      </div>

      <Collapsible
        id={`chef-dish-cards-${view}`}
        title={view === 'main' ? 'The dishes as cards' : 'The Recompletion dishes as cards'}
        summary={`${activeDishes.length} ${activeDishes.length === 1 ? 'dish' : 'dishes'}, each with what it needs by name`}
      >
        {activeDishes.length > 0 ? <DishGallery dishes={activeDishes} ingredientsById={ingredientsById} /> : <p className="text-sm text-slate-400">No dishes yet.</p>}
      </Collapsible>
    </div>
  )
}
