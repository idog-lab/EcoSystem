import { useState } from 'react'
import Card from '../../../components/ui/Card'
import Collapsible from '../../../components/ui/Collapsible'
import { ITEM_ROUNDINGS, ITEM_ROUNDING_LABELS, RARITY, RARITY_LABELS, RARITY_ORDER, REWARD_KEYS, REWARD_LABELS, REWARD_SHORT, createDish, createIngredient, createReward, isBlocker, recipeBudgetReference, recipeForSegment, recipeUnits, removeIngredientEverywhere } from '../lib/chefModel'
import { dishPrize, effectiveFactor, grandPrize, rewardWorth } from '../lib/chefRewards'
import { AddButton, Num, Pills, RowActions, Toggle, NAME_INPUT, SELECT, TD, TH } from './chefUi'
import { num } from '../lib/chefFormat'

const RARITY_COLOR = {
  [RARITY.COMMON]: 'bg-slate-100 text-slate-600',
  [RARITY.RARE]: 'bg-sky-100 text-sky-700',
  [RARITY.SEMI_BLOCKER]: 'bg-violet-100 text-violet-700',
  [RARITY.BLOCKER]: 'bg-rose-100 text-rose-700',
}

// THE RECIPES. One row a dish, one column an ingredient.
//   Base quantities   typed here. The economist says which ingredients are in
//                     a recipe; nothing adds, removes or swaps one.
//   A segment's       read off the base: ordinary and semi-blocker quantities
//                     x the segment's effort factor, to the nearest whole
//                     number (never below 1). The blocker's quantity is not
//                     scaled: it is the base number unless a whole number is
//                     typed for that segment - which is done in this view.
function RecipeTable({ dishes, ingredients, byId, segment, onRecipe, onBlocker, onName, onFixed, onDuplicate, onRemove }) {
  const totals = Object.fromEntries(ingredients.map((ing) => [ing.id, 0]))
  let all = 0
  const rows = dishes.map((dish) => {
    const recipe = segment ? recipeForSegment(dish, segment, byId) : dish.recipe
    for (const r of recipe) {
      totals[r.ingredientId] = (totals[r.ingredientId] ?? 0) + r.count
      all += r.count
    }
    return { dish, recipe }
  })
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
            <th className={`${TH} text-center`} title="The ingredients the dish needs, in all.">
              In all
            </th>
            {!segment && <th className={TH} aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ dish, recipe }) => (
            <tr key={dish.id} className="border-b border-slate-100" data-dish={dish.id}>
              <td className={`${TD} whitespace-nowrap`}>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true">{dish.art ?? ''}</span>
                  {segment ? <span className="text-sm font-semibold text-slate-800">{dish.name}</span> : <input value={dish.name} aria-label="Dish name" onChange={(e) => onName(dish.id, e.target.value)} className={`${NAME_INPUT} min-w-[9rem]`} />}
                  {/* A dish every segment cooks at its base quantities (never scaled by effort). */}
                  {segment ? (
                    dish.sameForAllSegments && (
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600" data-same-for-all title="This dish is the same for every segment: its base quantities, not scaled by effort.">
                        same for all
                      </span>
                    )
                  ) : (
                    <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-500" title="Same for every segment: the base quantities, never scaled by a segment's effort.">
                      <input type="checkbox" data-field="same-for-all" checked={!!dish.sameForAllSegments} onChange={(e) => onFixed(dish.id, e.target.checked)} />
                      all
                    </label>
                  )}
                </span>
              </td>
              {ingredients.map((ing) => {
                const row = recipe.find((r) => r.ingredientId === ing.id)
                const count = row?.count ?? 0
                // A BLANK quantity: the ingredient is in the recipe, the number is left to a proposal (step 4).
                const blank = !!row && row.count == null
                const cell = blank ? 'border-dashed border-amber-300 bg-amber-50 font-semibold text-amber-800 placeholder:text-amber-700' : count > 0 ? 'border-purple-200 bg-purple-50/60 font-semibold text-purple-800' : 'text-slate-300'
                if (!segment) {
                  return (
                    <td key={ing.id} className={`${TD} text-center`}>
                      <Num
                        aria-label={`${dish.name}: ${ing.name}`}
                        value={blank ? null : count}
                        allowEmpty={!!row}
                        placeholder={blank ? '?' : undefined}
                        title={blank ? 'Blank: this ingredient is in the recipe and a proposal (step 4) generates the quantity. Until then the dish cannot be cooked.' : undefined}
                        data-blank={blank || undefined}
                        onCommit={(n) => onRecipe(dish.id, ing.id, n == null ? null : Math.round(n))}
                        className={`w-12 ${cell}`}
                      />
                    </td>
                  )
                }
                if (blank) {
                  return (
                    <td key={ing.id} className={`${TD} text-center text-sm font-semibold text-amber-700`} title="Blank at the base: a proposal (step 4) generates the quantity.">
                      ?
                    </td>
                  )
                }
                // A segment's view: the blocker is typed (empty: the base number), the rest is read off the effort factor.
                if (isBlocker(ing) && dish.recipe.some((r) => r.ingredientId === ing.id)) {
                  const own = dish.blockerBySegment?.[segment.id]?.[ing.id] ?? null
                  return (
                    <td key={ing.id} className={`${TD} text-center`}>
                      <Num aria-label={`${dish.name}: ${ing.name} for ${segment.name}`} data-blocker-cell value={own} allowEmpty placeholder={String(row?.base ?? 0)} onCommit={(n) => onBlocker(dish.id, segment.id, ing.id, n == null ? null : Math.round(n))} className="w-12 border-rose-200 bg-rose-50/60 font-semibold text-rose-800" />
                    </td>
                  )
                }
                return (
                  <td key={ing.id} className={`${TD} text-center text-sm tabular-nums ${count > 0 ? 'font-semibold text-purple-800' : 'text-slate-300'}`} title={row && row.count !== row.base ? `${row.base} at the base segment` : undefined}>
                    {count}
                  </td>
                )
              })}
              <td className={`${TD} text-center text-sm tabular-nums text-slate-600`}>{recipeUnits(recipe)}</td>
              {!segment && (
                <td className={`${TD} text-right`}>
                  <RowActions what={dish.name} onDuplicate={() => onDuplicate(dish.id)} onRemove={() => onRemove(dish.id)} />
                </td>
              )}
            </tr>
          ))}
          {dishes.length === 0 && (
            <tr>
              <td colSpan={ingredients.length + 3} className="px-2 py-3 text-sm text-slate-400">
                No dishes yet.
              </td>
            </tr>
          )}
          {dishes.length > 0 && (
            <tr className="border-t border-slate-200 bg-slate-50/60 text-sm font-semibold text-slate-600" data-testid="chef-recipe-totals">
              <td className={TD}>In all</td>
              {ingredients.map((ing) => (
                <td key={ing.id} className={`${TD} text-center tabular-nums`}>
                  {totals[ing.id] || ''}
                </td>
              ))}
              <td className={`${TD} text-center tabular-nums text-slate-800`} data-cell="total">
                {all}
              </td>
              {!segment && <td />}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// What each dish pays at the base segment, by component, and what that is
// worth; for a segment in view, what it becomes.
function PrizeTable({ dishes, rewards, segment, onReward }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" data-dense data-testid="chef-prizes">
        <thead>
          <tr className="border-b border-slate-200">
            <th className={TH}>Dish</th>
            {REWARD_KEYS.map((key) => (
              <th key={key} className={`${TH} text-center`} title={`${REWARD_LABELS[key]}: worth ${rewards.values[key]} each`}>
                {REWARD_SHORT[key]}
              </th>
            ))}
            <th className={`${TH} text-center`} title="The allowance worth of the prize at the base segment, from the value table below.">
              Worth
            </th>
            {segment && (
              <th className={`${TH} text-center`} title={`For ${segment.name}: coins x${num(effectiveFactor(segment), 2)}; free rounds and undos x${num(Math.min(effectiveFactor(segment), rewards.cappedFactor), 2)}; wilds and extra stock unchanged.`}>
                For {segment.name}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {dishes.map((dish) => {
            const base = dishPrize(dish, null, rewards)
            const own = segment ? dishPrize(dish, segment, rewards) : null
            return (
              <tr key={dish.id} className="border-b border-slate-100" data-prize={dish.id}>
                <td className={`${TD} whitespace-nowrap text-sm font-medium text-slate-700`}>
                  <span aria-hidden="true">{dish.art ?? ''}</span> {dish.name}
                </td>
                {REWARD_KEYS.map((key) => (
                  <td key={key} className={`${TD} text-center`}>
                    <Num aria-label={`${dish.name}: ${REWARD_LABELS[key]}`} data-reward={key} value={dish.reward?.[key] ?? null} allowEmpty step="any" onCommit={(n) => onReward(dish.id, key, n)} className={`w-14 ${dish.reward?.[key] > 0 ? 'border-purple-200 bg-purple-50/60 font-semibold text-purple-800' : 'text-slate-300'}`} />
                  </td>
                ))}
                <td className={`${TD} whitespace-nowrap text-center text-sm tabular-nums`} data-cell="worth">
                  {base.known ? <span className="font-semibold text-slate-700">{num(base.worth, 2)}</span> : <span className="text-amber-700">unknown</span>}
                  {base.legacy && (
                    <span className="ml-1 text-xs text-amber-700" title="This chef had one prize number per dish and nothing saying what it is made of. It is counted as coins until the components are typed.">
                      as coins
                    </span>
                  )}
                </td>
                {segment && (
                  <td className={`${TD} whitespace-nowrap text-center text-sm tabular-nums text-slate-600`} title={own.items ? REWARD_KEYS.filter((k) => own.items[k]).map((k) => `${REWARD_SHORT[k]} ${num(own.items[k], 2)}`).join(', ') : undefined}>
                    {own.known ? num(own.worth, 2) : 'unknown'}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// STEP 2 - INGREDIENTS AND DISHES: what players collect (and how much of each
// the pantry holds), what they cook with it, and what a dish pays.
export default function DishesStep({ state, update }) {
  const { ingredients, dishes, recompletionDishes, segments, rewards } = state
  const [view, setView] = useState('main')
  const [segmentView, setSegmentView] = useState('base')
  const byId = Object.fromEntries(ingredients.map((i) => [i.id, i]))
  const listKey = view === 'main' ? 'dishes' : 'recompletionDishes'
  const activeDishes = state[listKey]
  const segment = segments.find((s) => s.id === segmentView) ?? null
  const sheetCaps = ingredients.filter((i) => i.sourceCap != null)
  const uncapped = sheetCaps.filter((i) => i.pantryCap == null)

  const setIngredient = (id, patch) => update((s) => ({ ...s, ingredients: s.ingredients.map((ing) => (ing.id === id ? { ...ing, ...patch } : ing)) }))
  const setList = (fn) => update((s) => ({ ...s, [listKey]: fn(s[listKey]) }))
  const setDish = (id, patch) => setList((list) => list.map((d) => (d.id === id ? { ...d, ...(typeof patch === 'function' ? patch(d) : patch) } : d)))
  const setRecipe = (dishId, ingredientId, count) =>
    setDish(dishId, (d) => {
      const recipe = d.recipe.filter((r) => r.ingredientId !== ingredientId)
      // (null: left blank - in the recipe, the quantity to be generated. 0: not in the recipe.)
      if (count == null || count > 0) recipe.push({ ingredientId, count })
      // Kept in the order of the ingredients, so a recipe reads the same wherever it is shown.
      const order = new Map(ingredients.map((ing, i) => [ing.id, i]))
      recipe.sort((a, b) => (order.get(a.ingredientId) ?? 99) - (order.get(b.ingredientId) ?? 99))
      return { recipe }
    })
  const setBlocker = (dishId, segmentId, ingredientId, count) =>
    setDish(dishId, (d) => {
      const own = { ...(d.blockerBySegment?.[segmentId] ?? {}) }
      if (count == null) delete own[ingredientId]
      else own[ingredientId] = count
      return { blockerBySegment: { ...(d.blockerBySegment ?? {}), [segmentId]: own } }
    })
  // A prize component: an emptied field is "none of it"; a prize with nothing typed at all is "not known".
  const setReward = (dishId, key, value) =>
    setDish(dishId, (d) => {
      const next = { ...(d.reward ?? createReward()), [key]: value ?? 0 }
      const empty = REWARD_KEYS.every((k) => !next[k])
      return { reward: empty && value == null ? null : next, legacyWorth: empty && value == null ? d.legacyWorth : null }
    })
  const setRewards = (patch) => update((s) => ({ ...s, rewards: { ...s.rewards, ...patch } }))
  const setGrand = (round, key, value) => {
    const next = { ...(rewards.grandPrize?.[round] ?? createReward()), [key]: value ?? 0 }
    const empty = REWARD_KEYS.every((k) => !next[k])
    setRewards({ grandPrize: { ...rewards.grandPrize, [round]: empty && value == null ? null : next } })
  }

  const mainUnits = dishes.reduce((sum, d) => sum + recipeUnits(d.recipe), 0)
  const reference = recipeBudgetReference(state)
  const baseWorth = (list) => list.reduce((sum, d) => sum + (dishPrize(d, null, rewards).worth ?? 0), 0)
  const unknownPrizes = [...dishes, ...recompletionDishes].filter((d) => !dishPrize(d, null, rewards).known).length
  const mainGrandBase = rewardWorth(rewards.grandPrize?.main, rewards.values)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(29rem,4fr)_minmax(0,11fr)] xl:items-start">
        <Card
          title="2. Ingredients"
          subtitle="Removing one takes it out of every recipe, basket, threshold, source and preset."
          action={
            <AddButton onClick={() => update((s) => ({ ...s, ingredients: [...s.ingredients, createIngredient({ name: `Ingredient ${s.ingredients.length + 1}` })] }))} data-testid="chef-add-ingredient">
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
                  <th className={`${TH} text-center`} title="The most of it a player can hold. Cooking frees room. What a basket gives beyond it is lost, with nothing in its place. Empty: no limit. It is not the progression threshold (step 3), which counts what was received.">
                    Pantry cap
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
                        <input value={ing.name} aria-label="Ingredient name" onChange={(e) => setIngredient(ing.id, { name: e.target.value })} className={`${NAME_INPUT} min-w-[5.5rem]`} />
                      </span>
                    </td>
                    <td className={TD}>
                      <select value={ing.rarity} aria-label={`${ing.name}: kind`} onChange={(e) => setIngredient(ing.id, { rarity: e.target.value })} className={`rounded-full border-0 px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-purple-300 ${RARITY_COLOR[ing.rarity]}`}>
                        {RARITY_ORDER.map((r) => (
                          <option key={r} value={r}>
                            {RARITY_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={`${TD} text-center`}>
                      <Num aria-label={`${ing.name}: pantry cap`} data-field="pantry-cap" value={ing.pantryCap} allowEmpty placeholder="none" onCommit={(n) => setIngredient(ing.id, { pantryCap: n == null ? null : Math.round(n) })} className="w-16" />
                    </td>
                    <td className={`${TD} text-right`}>
                      <RowActions what={ing.name} onDuplicate={() => update((s) => ({ ...s, ingredients: [...s.ingredients, createIngredient({ ...ing, id: undefined, name: `${ing.name} copy` })] }))} onRemove={() => update((s) => removeIngredientEverywhere(ing.id, s))} />
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
          {sheetCaps.length > 0 && (
            <p className="mt-3 text-xs text-slate-500" data-testid="chef-source-caps" data-note>
              The source sheet has a "Cap" for each ingredient ({sheetCaps.map((i) => `${i.name} ${i.sourceCap}`).join(', ')}). It does not say whether that is the pantry cap or the progression threshold, so it is not
              played.{' '}
              {uncapped.length > 0 && (
                <button type="button" className="font-semibold text-purple-700 underline decoration-dotted underline-offset-2" data-testid="chef-use-source-caps" onClick={() => update((s) => ({ ...s, ingredients: s.ingredients.map((i) => (i.pantryCap == null && i.sourceCap != null ? { ...i, pantryCap: i.sourceCap } : i)) }))}>
                  Use them as pantry caps
                </button>
              )}
            </p>
          )}
        </Card>

        <Card
          title={view === 'main' ? 'Dishes: what each one needs' : 'Recompletion dishes: what each one needs'}
          subtitle={segment ? `For ${segment.name}: ordinary and semi-blocker quantities x${num(segment.effortFactor, 2)}, to the nearest whole number. The blocker is not scaled - type a whole number for this segment, or leave it at the base number.` : 'The base quantities. Recompletion starts the moment the last dish is cooked, with the same ingredients and the same pantry.'}
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
              {!segment && (
                <AddButton onClick={() => setList((list) => [...list, createDish({ name: `Dish ${list.length + 1}` })])} data-testid="chef-add-dish">
                  Add a dish
                </AddButton>
              )}
            </span>
          }
        >
          {segments.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              Quantities for
              <Pills data-testid="chef-recipe-segment" value={segment ? segment.id : 'base'} onChange={setSegmentView} options={[['base', 'The base (typed)'], ...segments.map((s) => [s.id, `${s.name}${s.effortFactor !== 1 ? ` x${num(s.effortFactor, 2)}` : ''}`])]} />
            </div>
          )}
          <RecipeTable
            dishes={activeDishes}
            ingredients={ingredients}
            byId={byId}
            segment={segment}
            onRecipe={setRecipe}
            onBlocker={setBlocker}
            onName={(id, name) => setDish(id, { name })}
            onFixed={(id, on) => setDish(id, (d) => { const { sameForAllSegments: _was, ...rest } = d; return on ? { ...rest, sameForAllSegments: true } : rest })}
            onDuplicate={(id) => setList((list) => [...list, createDish({ ...JSON.parse(JSON.stringify(list.find((d) => d.id === id))), id: undefined, name: `${list.find((d) => d.id === id).name} copy` })])}
            onRemove={(id) => setList((list) => list.filter((d) => d.id !== id))}
          />
          {view === 'main' && dishes.length > 0 && (
            <p className="mt-3 text-sm text-slate-600" data-testid="chef-recipe-budget" data-note>
              At the base the Main dishes ask for <span className="font-semibold text-slate-800">{mainUnits}</span> ingredients in all. The design reference is about {reference} for an event of {state.calendar.totalDays} days ({state.settings.recipeBudgetReference} for{' '}
              {state.settings.recipeBudgetDays}) - a reference, not a rule: nothing is changed to meet it.
            </p>
          )}
          {!segment && (
            <p className="mt-1 text-xs text-slate-500" data-testid="chef-recipe-blank-note" data-note>
              Empty a quantity to leave it blank: the ingredient stays in the recipe and a proposal (step 4) generates the number. 0 takes the ingredient out of the recipe.
            </p>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
        <Collapsible
          id="chef-prizes"
          className="xl:open:col-span-2"
          title="Prizes: what a dish pays, and the grand prizes"
          summary={`The ${dishes.length} dishes are worth ${num(baseWorth(dishes), 2)} at the base; the Main grand prize ${mainGrandBase == null ? 'is not set' : num(mainGrandBase, 2)}${unknownPrizes ? ` · ${unknownPrizes} ${unknownPrizes === 1 ? 'prize is' : 'prizes are'} unknown` : ''}`}
          openWhen={dishes.length > 0 && dishes.some((d) => !dishPrize(d, null, rewards).known)}
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-600" data-note>
              A prize is typed as what it is made of, at the base segment; its allowance worth comes from the value table. A segment's prize is the base one times its prize factor and burnout: coins by all of
              it, free rounds and undos by {rewards.cappedFactor} at most, wilds and extra stock not at all. An empty prize is unknown, not zero.
            </p>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start">
              <div className="flex flex-col gap-2">
                <PrizeTable dishes={activeDishes} rewards={rewards} segment={segment} onReward={setReward} />
                <table className="w-full border-collapse" data-dense data-testid="chef-grand-prizes">
                  <tbody>
                    {['main', 'rc'].map((round) => {
                      const gp = rewards.grandPrize?.[round] ?? null
                      const base = rewardWorth(gp, rewards.values)
                      return (
                        <tr key={round} className="border-b border-slate-100" data-grand={round}>
                          <td className={`${TD} whitespace-nowrap text-sm font-semibold text-slate-700`} title="Paid once, to a player who cooks every dish of the round.">
                            Grand prize, {round === 'main' ? 'Main' : 'Recompletion'}
                          </td>
                          {REWARD_KEYS.map((key) => (
                            <td key={key} className={`${TD} text-center`}>
                              <Num aria-label={`Grand prize ${round}: ${REWARD_LABELS[key]}`} data-reward={key} value={gp?.[key] ?? null} allowEmpty step="any" onCommit={(n) => setGrand(round, key, n)} className={`w-16 ${gp?.[key] > 0 ? 'border-purple-200 bg-purple-50/60 font-semibold text-purple-800' : 'text-slate-300'}`} />
                            </td>
                          ))}
                          <td className={`${TD} whitespace-nowrap text-center text-sm tabular-nums`}>{base == null ? <span className="text-amber-700">unknown</span> : <span className="font-semibold text-slate-700">{num(base, 2)}</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-3">
                <table className="w-full border-collapse" data-dense data-testid="chef-segment-prizes">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className={TH}>Segment</th>
                      <th className={`${TH} text-center`}>Prizes x</th>
                      <th className={`${TH} text-center`} title="The worth of all the Main dishes for this segment. Dish prizes are not rounded.">
                        Dishes
                      </th>
                      <th className={`${TH} text-center`} title={`The Main grand prize for this segment: scaled, then its worth rounded to the nearest ${rewards.grandPrizeRoundTo}. The figure before rounding is beside it.`}>
                        Grand prize
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {segments.map((seg) => {
                      const gp = grandPrize(rewards.grandPrize?.main, seg, rewards)
                      const list = dishes.map((d) => dishPrize(d, seg, rewards))
                      return (
                        <tr key={seg.id} className="border-b border-slate-100 text-sm" data-segment-prize={seg.id}>
                          <td className={`${TD} font-medium text-slate-700`}>{seg.name}</td>
                          <td className={`${TD} text-center tabular-nums text-slate-600`}>x{num(effectiveFactor(seg), 2)}</td>
                          <td className={`${TD} text-center tabular-nums text-slate-600`}>
                            {num(list.reduce((sum, p) => sum + (p.worth ?? 0), 0), 2)}
                            {list.some((p) => !p.known) && <span className="text-amber-700"> +?</span>}
                          </td>
                          <td className={`${TD} whitespace-nowrap text-center tabular-nums text-slate-600`} data-cell="grand">
                            {gp.known ? (
                              <>
                                <span className="font-semibold text-slate-800">{gp.worth}</span> <span className="text-xs text-slate-400">(raw {num(gp.rawWorth, 2)})</span>
                              </>
                            ) : (
                              <span className="text-amber-700">unknown</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="flex flex-wrap items-end gap-x-3 gap-y-2" data-testid="chef-reward-values">
                  <span className="pb-1.5 text-sm font-semibold text-slate-700">Worth of one</span>
                  {REWARD_KEYS.map((key) => (
                    <label key={key} className="flex flex-col items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {REWARD_SHORT[key]}
                      <Num aria-label={`Worth of one ${REWARD_LABELS[key]}`} value={rewards.values[key]} step="any" onCommit={(n) => setRewards({ values: { ...rewards.values, [key]: n } })} className="w-16" />
                    </label>
                  ))}
                </div>
                <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600" title="Scaling gives 4.8 undos. How that becomes a whole number in the game has not been decided, so this is a setting, and the amounts shown are targets - not quantities for production. Coins are never changed to make up for a rounded item.">
                  Whole items (not decided yet)
                  <select value={rewards.itemRounding} data-testid="chef-item-rounding" onChange={(e) => setRewards({ itemRounding: e.target.value })} className={SELECT}>
                    {ITEM_ROUNDINGS.map((id) => (
                      <option key={id} value={id}>
                        {ITEM_ROUNDING_LABELS[id]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>
        </Collapsible>

        <Collapsible id={`chef-dish-cards-${view}`} className="xl:open:col-span-2" title={view === 'main' ? 'The dishes as cards' : 'The Recompletion dishes as cards'} summary={`${activeDishes.length} ${activeDishes.length === 1 ? 'dish' : 'dishes'}, each with what it needs by name`}>
          {activeDishes.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {activeDishes.map((dish) => (
                <div key={dish.id} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/70 p-3">
                  <div className="flex items-center gap-2">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-lg" aria-hidden="true">
                      {dish.art ?? '•'}
                    </span>
                    <span className="text-sm font-semibold leading-tight text-slate-800">{dish.name}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(segment ? recipeForSegment(dish, segment, byId) : dish.recipe).map((r) => (
                      <span key={r.ingredientId} className="flex items-center gap-1 rounded-full border border-purple-100 bg-purple-50 px-2 py-0.5 text-xs text-purple-800">
                        <span aria-hidden="true">{byId[r.ingredientId]?.art ?? '•'}</span>
                        {byId[r.ingredientId]?.name ?? r.ingredientId} x {r.count}
                      </span>
                    ))}
                    {dish.recipe.length === 0 && <span className="text-xs text-slate-400">Needs nothing yet</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No dishes yet.</p>
          )}
        </Collapsible>
      </div>
    </div>
  )
}
