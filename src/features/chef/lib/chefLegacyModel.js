// The factories of the OLDER chef (schema 1), kept for one purpose: the two
// real chefs in `data/` hold the source workbooks as they were read, in that
// older shape, and chefMigration.js brings them to today's model the same way
// it brings an older save. Nothing else should use these.
export const RARITY = { COMMON: 'common', RARE: 'rare', SEMI_BLOCKER: 'semi-blocker', BLOCKER: 'blocker' }

export function createIngredient({ id, name, rarity = RARITY.COMMON, cap = null, art = null } = {}) {
  return { id, name, rarity, cap, art }
}
export function createDish({ id, name, recipe = [], prizeValue = 0, art = null } = {}) {
  return { id, name, recipe, prizeValue, art }
}
export function createBasket({ id, chestType = 'basic', phaseId, totalMin = 1, totalMax = 1, ingredientWeights = [], pricingIngredientWeights = null } = {}) {
  return { id, chestType, phaseId, totalMin, totalMax, ingredientWeights, pricingIngredientWeights }
}
export function createPhase({ id, label, days }) {
  return { id, label, days }
}
export function createCalendar({ startDate = null, totalDays = 1, phases = [] } = {}) {
  return { startDate, totalDays, phases }
}
export function createSegment({ id, name, avgBasketsPerDay = { basic: 0, rare: 0, epic: 0 }, prizeTier = 'low', activityShape = 'flat' } = {}) {
  return { id, name, avgBasketsPerDay, prizeTier, activityShape }
}
