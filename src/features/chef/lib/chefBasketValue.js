// Basket-value estimator - the second of the "2 big things" the economist
// asked for (see CLAUDE.md's Chef section): "try to guess what is the
// value of a basket on a calendar day," given each dish's own prize amount
// and the total chef prize.
//
// Method (an explicit heuristic, not a game-theoretic optimum - flagged
// the same way Diamond Mine's own difficulty/solver heuristics are flagged
// in CLAUDE.md, since this is a genuinely open modeling choice): spread
// each dish's prize-equivalent value evenly across every unit of ingredient
// its recipe calls for, so an ingredient that's load-bearing for several
// valuable dishes accumulates a bigger per-unit value than one that's only
// a trickle ingredient in one cheap dish. The whole-event grand-completion
// bonus (`totalChefPrize`) is spread the same way, evenly across every
// ingredient unit in the WHOLE recipe matrix - finishing any dish moves a
// player equally closer to it, regardless of which dish. A basket's own
// estimated value is then just its expected ingredient yield (per the real
// "Pricing" odds table - see chefModel.js's createBasket doc comment)
// dotted with these per-unit values.
//
// **Labeling caveat (a GPT brainstorm review's methodology critique,
// worth keeping in mind wherever this is surfaced):** this is a STATIC
// recipe-based value ALLOCATION, not a real price - it ignores
// complementarity (a unit is only worth something alongside the other
// ingredients a recipe needs), saturation (once a dish's need is met,
// another unit may be worth nothing until Recompletion), and timing. Don't
// present it as a standalone fair-price estimate. `chefSimulation.js`'s
// `estimateMarginalBasketValue` answers a sharper, causal question instead
// ("how much does ONE extra basket actually change eventual reward
// payout, under the real simulated economy") - prefer that when the
// question is "is this basket actually worth opening," and keep this
// allocation-based number for "which ingredients are structurally the
// most load-bearing across the recipe matrix," which is what it's
// actually good at.
import { expectedYieldPerBasket } from './chefSimulation'
import { dishPrizeValueForSegment } from './chefModel'

export function ingredientUnitValues({ dishes, segment, totalChefPrizeValue }) {
  let totalUnits = 0
  for (const dish of dishes) {
    totalUnits += dish.recipe.reduce((sum, r) => sum + r.count, 0)
  }
  const milestonePerUnit = totalUnits > 0 ? totalChefPrizeValue / totalUnits : 0

  const unitValue = {}
  for (const dish of dishes) {
    const dishUnits = dish.recipe.reduce((sum, r) => sum + r.count, 0)
    if (dishUnits === 0) continue
    const dishValue = dishPrizeValueForSegment(dish, segment)
    const perUnit = dishValue / dishUnits
    for (const r of dish.recipe) {
      unitValue[r.ingredientId] = (unitValue[r.ingredientId] ?? 0) + perUnit + milestonePerUnit
    }
  }
  return unitValue
}

// `weightsKey` picks which of a basket's two weight tables to value
// against - 'pricing' (the default, meant for this estimator) or
// 'gameplay' (the real player-facing odds), in case the two tables are
// ever compared side by side.
export function estimateBasketValue(basket, unitValue, weightsKey = 'pricing') {
  const weights = weightsKey === 'pricing' ? basket.pricingIngredientWeights ?? basket.ingredientWeights : basket.ingredientWeights
  const perBasket = expectedYieldPerBasket(basket, weights)
  let value = 0
  const breakdown = {}
  for (const [ingredientId, amount] of Object.entries(perBasket)) {
    const contribution = amount * (unitValue[ingredientId] ?? 0)
    breakdown[ingredientId] = contribution
    value += contribution
  }
  return { value, breakdown }
}
