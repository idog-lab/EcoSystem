// THE OLDER BASKET ESTIMATE ("the sharing-out") - LEGACY.
//
// Kept from before the rebuild and NOT rebuilt: each dish's prize is shared
// evenly over the units its recipe needs, the grand prize over all the units
// of all recipes, and a basket is worth what it gives on average (with its
// pricing odds) times those unit values. It knows nothing of progression
// thresholds, pantry caps, catch-up presets, special sources or Recompletion,
// and it treats a unit as worth something on its own. The screens label it as
// an older estimate. A basket valuation on the new engine is a later build;
// "one more basket" (chefEngine.js: oneMoreBasket) already is on it.
import { recipeForSegment } from './chefModel'
import { prizeTable } from './chefRewards'

// What one basket gives on average, per ingredient: the middle of its size
// range, shared by weight, capped at each ingredient's most per basket.
export function expectedYieldPerBasket(basket, weights = basket.ingredientWeights) {
  const totalAvg = (basket.totalMin + basket.totalMax) / 2
  const sumWeight = weights.reduce((sum, w) => sum + w.weight, 0)
  const byIngredient = {}
  for (const w of weights) byIngredient[w.ingredientId] = Math.min(sumWeight > 0 ? (totalAvg * w.weight) / sumWeight : 0, w.max)
  return byIngredient
}

// What one unit of each ingredient "counts for", for a segment and a round.
// `incomplete`: a prize that is not known was counted as nothing.
export function ingredientUnitValues(state, segment, round = 'main') {
  const byId = Object.fromEntries(state.ingredients.map((i) => [i.id, i]))
  const list = round === 'main' ? state.dishes : state.recompletionDishes
  const prizes = prizeTable(state, segment)
  const dishPrizes = round === 'main' ? prizes.main : prizes.rc
  const grand = round === 'main' ? prizes.mainGrand : prizes.rcGrand
  const recipes = list.map((dish) => recipeForSegment(dish, segment, byId))
  const totalUnits = recipes.reduce((sum, recipe) => sum + recipe.reduce((s, r) => s + r.count, 0), 0)
  const grandPerUnit = totalUnits > 0 ? (grand.worth ?? 0) / totalUnits : 0
  const unitValue = {}
  recipes.forEach((recipe, i) => {
    const units = recipe.reduce((s, r) => s + r.count, 0)
    if (units === 0) return
    const perUnit = (dishPrizes[i].worth ?? 0) / units
    for (const r of recipe) unitValue[r.ingredientId] = (unitValue[r.ingredientId] ?? 0) + perUnit + grandPerUnit
  })
  return { unitValue, incomplete: dishPrizes.some((p) => !p.known) || !grand.known }
}

export function estimateBasketValue(basket, unitValue, weightsKey = 'pricing') {
  const weights = weightsKey === 'pricing' ? (basket.pricingIngredientWeights ?? basket.ingredientWeights) : basket.ingredientWeights
  const perBasket = expectedYieldPerBasket(basket, weights)
  let value = 0
  const breakdown = {}
  for (const [ingredientId, amount] of Object.entries(perBasket)) {
    breakdown[ingredientId] = amount * (unitValue[ingredientId] ?? 0)
    value += breakdown[ingredientId]
  }
  return { value, breakdown }
}
