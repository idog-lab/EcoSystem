// Real seed data transcribed from `chef_Halloween_1910.xlsx` (a legacy Chef
// event the economist provided to ground this feature's data model before
// anything was built from scratch - see CLAUDE.md's Chef section for the
// full reverse-engineering notes). Exists so Phase 1 ("insert all the
// specific chef's data into it") has real data to look at rather than an
// empty shell; every later Chef event is expected to replace this, not
// extend it.
//
// Source sheets: `Chef_assumptions` (ingredients/dishes list, phases),
// `Chef - Demand` (the dish recipe matrix - baseline/x1.0 block only; the
// 0.8/1.1/1.4 "difficulty multiplier" blocks in that same sheet are real
// segment-rule data the economist confirmed exists but said isn't important
// to model yet, so only the baseline block is transcribed here),
// `Chef - Demand (2)` (confirmed by the economist to be read as this
// event's Recompletion recipe set), `Baskets` (the real per-chest-type/
// per-phase ingredient odds, both the real "Gameplay" table and the
// separate "Pricing" table used for basket-value estimation later),
// `Prize_sheet` (the Low-tier dish prize values + the universal
// reward-to-value conversion table + the Low/Medium/High segment prize
// multiplier), `User Habit` (the real per-segment avg-baskets/day rates).
import { RARITY, createIngredient, createDish, createBasket, createPhase, createCalendar, createSegment } from '../lib/chefLegacyModel'

// `startDate` is the real "Chef start" value from `Chef_assumptions`
// (an Excel serial date, 46313, converted to a calendar date).
export const CALENDAR = createCalendar({
  startDate: '2026-10-18',
  totalDays: 21,
  phases: [createPhase({ id: 'phase1', label: 'Phase 1', days: 10 }), createPhase({ id: 'phase2', label: 'Phase 2', days: 11 })],
})

// `art` is a plain emoji placeholder (see chefModel.js's createIngredient
// doc comment) - swap for real ingredient icons once they exist.
export const INGREDIENTS = [
  createIngredient({ id: 'sugar', name: 'Sugar', rarity: RARITY.COMMON, cap: 30, art: '🍬' }),
  createIngredient({ id: 'flour', name: 'Flour', rarity: RARITY.COMMON, cap: 30, art: '🌾' }),
  createIngredient({ id: 'butter', name: 'Butter', rarity: RARITY.COMMON, cap: 30, art: '🧈' }),
  createIngredient({ id: 'apple', name: 'Apple', rarity: RARITY.RARE, cap: 30, art: '🍏' }),
  createIngredient({ id: 'chocolate', name: 'Chocolate', rarity: RARITY.RARE, cap: 30, art: '🍫' }),
  createIngredient({ id: 'milk', name: 'Milk', rarity: RARITY.RARE, cap: 20, art: '🥛' }),
  // Legacy "Epic" - confirmed by the economist to be the "semi blocker" tier.
  createIngredient({ id: 'pumpkin', name: 'Pumpkin', rarity: RARITY.SEMI_BLOCKER, cap: 20, art: '🎃' }),
  createIngredient({ id: 'green-jelly', name: 'Green Jelly', rarity: RARITY.BLOCKER, cap: 15, art: '🟢' }),
]

// Baseline (x1.0 difficulty-multiplier block) recipe matrix - `Chef - Demand`.
// Each dish's prizeValue is the Low-tier value from `Prize_sheet` (its
// "Final" column); the per-segment Low/Medium/High multiplier is applied
// at calculation time (see chefModel.js's dishPrizeValueForSegment), not
// baked into this number.
// `art` is a plain emoji placeholder, same convention as the ingredients'
// own `art` field above - swap for real dish art once it exists.
export const DISHES = [
  createDish({ id: 'candied-poison-apple', name: 'Candied poison apple', prizeValue: 1, art: '🍎', recipe: [{ ingredientId: 'sugar', count: 4 }, { ingredientId: 'apple', count: 2 }] }),
  createDish({ id: 'haunted-cream-puffs', name: 'Haunted Cream Puffs', prizeValue: 3, art: '🧁', recipe: [{ ingredientId: 'sugar', count: 8 }, { ingredientId: 'flour', count: 6 }, { ingredientId: 'chocolate', count: 6 }, { ingredientId: 'pumpkin', count: 4 }] }),
  createDish({ id: 'spooky-hot-chocolate', name: 'Spooky Hot Chocolate', prizeValue: 4, art: '☕', recipe: [{ ingredientId: 'sugar', count: 10 }, { ingredientId: 'chocolate', count: 8 }, { ingredientId: 'milk', count: 8 }] }),
  createDish({ id: 'eyeball-jelly-treat', name: 'eyeball jelly treat', prizeValue: 5.5, art: '👁️', recipe: [{ ingredientId: 'sugar', count: 9 }, { ingredientId: 'apple', count: 10 }, { ingredientId: 'green-jelly', count: 3 }] }),
  createDish({ id: 'chocolate-spider-cookies', name: 'Chocolate Spider Cookies', prizeValue: 6, art: '🕷️', recipe: [{ ingredientId: 'sugar', count: 7 }, { ingredientId: 'flour', count: 14 }, { ingredientId: 'butter', count: 8 }, { ingredientId: 'chocolate', count: 5 }] }),
  createDish({ id: 'spooky-pumpkin-rolls', name: 'Spooky Pumpkin Rolls', prizeValue: 7, art: '🎃', recipe: [{ ingredientId: 'flour', count: 6 }, { ingredientId: 'butter', count: 5 }, { ingredientId: 'pumpkin', count: 6 }] }),
  createDish({ id: 'mummy-finger-puffs', name: 'Mummy finger puffs', prizeValue: 8, art: '🥖', recipe: [{ ingredientId: 'sugar', count: 9 }, { ingredientId: 'flour', count: 12 }, { ingredientId: 'apple', count: 8 }, { ingredientId: 'milk', count: 4 }] }),
  createDish({ id: 'ghost-apple-turnovers', name: 'Ghost Apple Turnovers', prizeValue: 9, art: '👻', recipe: [{ ingredientId: 'sugar', count: 13 }, { ingredientId: 'flour', count: 9 }, { ingredientId: 'butter', count: 16 }, { ingredientId: 'apple', count: 11 }] }),
  createDish({ id: 'caramel-apple-bites', name: 'Caramel Apple Bites', prizeValue: 10, art: '🍬', recipe: [{ ingredientId: 'sugar', count: 8 }, { ingredientId: 'butter', count: 10 }, { ingredientId: 'apple', count: 12 }, { ingredientId: 'milk', count: 5 }] }),
  createDish({ id: 'pumpkin-cream-tart', name: 'Pumpkin Cream Tart', prizeValue: 11, art: '🥧', recipe: [{ ingredientId: 'sugar', count: 6 }, { ingredientId: 'flour', count: 12 }, { ingredientId: 'butter', count: 7 }, { ingredientId: 'apple', count: 5 }, { ingredientId: 'pumpkin', count: 14 }] }),
  createDish({ id: 'graveyard-brownies', name: 'Graveyard Brownies', prizeValue: 12, art: '⚰️', recipe: [{ ingredientId: 'sugar', count: 9 }, { ingredientId: 'flour', count: 14 }, { ingredientId: 'butter', count: 11 }, { ingredientId: 'chocolate', count: 5 }, { ingredientId: 'milk', count: 4 }] }),
  createDish({ id: 'witchs-brew-mousse', name: "Witch's Brew Mousse", prizeValue: 14, art: '🧙', recipe: [{ ingredientId: 'sugar', count: 11 }, { ingredientId: 'chocolate', count: 13 }, { ingredientId: 'milk', count: 14 }, { ingredientId: 'green-jelly', count: 7 }] }),
]

// Total chef grand-prize value per segment prize tier (Prize_sheet's "GP" /
// "Total dish in allowance" row) - separate from any single dish's own
// prizeValue, this is the whole event's own top-level prize.
export const TOTAL_CHEF_PRIZE = { low: 90, medium: 108, high: 135 }

// `Chef - Demand (2)` - confirmed by the economist to be read as this
// event's Recompletion recipe set (same ingredients, no "Ghost Apple
// Turnovers," different per-ingredient caps). One column in the source
// sheet was blank/unlabeled but still carried real nonzero ingredient
// values (noted inline) - transcribed as-is rather than guessed at.
export const RECOMPLETION_DISHES = [
  createDish({ id: 'rc-candied-poison-apple', name: 'Candied poison apple', prizeValue: null, art: '🍎', recipe: [{ ingredientId: 'flour', count: 2 }, { ingredientId: 'butter', count: 2 }] }),
  createDish({ id: 'rc-haunted-cream-puffs', name: 'Haunted Cream Puffs', prizeValue: null, art: '🧁', recipe: [{ ingredientId: 'sugar', count: 3 }, { ingredientId: 'butter', count: 5 }, { ingredientId: 'milk', count: 2 }] }),
  createDish({ id: 'rc-spooky-hot-chocolate', name: 'Spooky Hot Chocolate', prizeValue: null, art: '☕', recipe: [{ ingredientId: 'sugar', count: 5 }, { ingredientId: 'butter', count: 3 }, { ingredientId: 'pumpkin', count: 5 }] }),
  createDish({ id: 'rc-eyeball-jelly-treat', name: 'eyeball jelly treat', prizeValue: null, art: '👁️', recipe: [{ ingredientId: 'sugar', count: 8 }, { ingredientId: 'butter', count: 10 }, { ingredientId: 'milk', count: 4 }] }),
  createDish({ id: 'rc-chocolate-spider-cookies', name: 'Chocolate Spider Cookies', prizeValue: null, art: '🕷️', recipe: [{ ingredientId: 'flour', count: 15 }, { ingredientId: 'butter', count: 8 }, { ingredientId: 'chocolate', count: 10 }] }),
  createDish({ id: 'rc-spooky-pumpkin-rolls', name: 'Spooky Pumpkin Rolls', prizeValue: null, art: '🎃', recipe: [{ ingredientId: 'sugar', count: 11 }, { ingredientId: 'butter', count: 7 }, { ingredientId: 'milk', count: 12 }] }),
  createDish({ id: 'rc-mummy-finger-puffs', name: 'Mummy finger puffs', prizeValue: null, art: '🥖', recipe: [{ ingredientId: 'sugar', count: 13 }, { ingredientId: 'flour', count: 17 }, { ingredientId: 'butter', count: 12 }, { ingredientId: 'chocolate', count: 8 }] }),
  createDish({ id: 'rc-caramel-apple-bites', name: 'Caramel Apple Bites', prizeValue: null, art: '🍬', recipe: [{ ingredientId: 'flour', count: 5 }, { ingredientId: 'apple', count: 7 }, { ingredientId: 'chocolate', count: 4 }, { ingredientId: 'pumpkin', count: 10 }] }),
  createDish({ id: 'rc-pumpkin-cream-tart', name: 'Pumpkin Cream Tart', prizeValue: null, art: '🥧', recipe: [{ ingredientId: 'sugar', count: 11 }, { ingredientId: 'flour', count: 18 }, { ingredientId: 'butter', count: 20 }, { ingredientId: 'green-jelly', count: 3 }] }),
  createDish({ id: 'rc-graveyard-brownies', name: 'Graveyard Brownies', prizeValue: null, art: '⚰️', recipe: [{ ingredientId: 'sugar', count: 7 }, { ingredientId: 'flour', count: 21 }, { ingredientId: 'butter', count: 15 }, { ingredientId: 'apple', count: 17 }, { ingredientId: 'chocolate', count: 12 }] }),
  // Source sheet's column header for this dish was blank, but the row data
  // carries real values (sugar 7, apple 10, chocolate 6, green jelly 7) -
  // transcribed under a placeholder name rather than guessed at. Likely a
  // sheet-formatting artifact (a merged/misaligned header cell), not a
  // genuinely unnamed 11th recompletion dish - flag to the economist if a
  // real name should replace this.
  createDish({ id: 'rc-unlabeled-column', name: '(unlabeled column in source sheet)', prizeValue: null, art: '❓', recipe: [{ ingredientId: 'sugar', count: 7 }, { ingredientId: 'apple', count: 10 }, { ingredientId: 'chocolate', count: 6 }, { ingredientId: 'green-jelly', count: 7 }] }),
  createDish({ id: 'rc-witchs-brew-mousse', name: "Witch's Brew Mousse", prizeValue: null, art: '🧙', recipe: [{ ingredientId: 'sugar', count: 21 }, { ingredientId: 'flour', count: 22 }, { ingredientId: 'apple', count: 18 }, { ingredientId: 'chocolate', count: 16 }, { ingredientId: 'pumpkin', count: 22 }] }),
]
export const RECOMPLETION_INGREDIENT_CAPS = { sugar: 45, flour: 99, butter: 45, apple: 45, chocolate: 30, milk: 30, pumpkin: 20, 'green-jelly': 15 }

const INGREDIENT_ORDER = ['sugar', 'flour', 'butter', 'apple', 'chocolate', 'milk', 'pumpkin', 'green-jelly']

function weights(chestType, phaseId, values) {
  return INGREDIENT_ORDER.map((ingredientId, i) => ({ ingredientId, min: 0, max: values.max[i], weight: values.weight[i] }))
}

// Real "Gameplay" basket odds - `Baskets` sheet, one row per (Chest Type,
// Phase). "Alternative type" (Undo/Allowance/Free_round/...) was confirmed
// to share identical odds within the same Chest Type+Phase, so it's not
// modeled as a separate axis here - only Chest Type x Phase produces a
// distinct basket config. `pricingIngredientWeights` is the sheet's
// separate "Pricing" table for the same (Chest Type, Phase) - different
// weight numbers, meant for basket-value estimation rather than real
// player-facing odds.
export const BASKETS = [
  createBasket({
    id: 'basic-phase1', chestType: 'basic', phaseId: 'phase1', totalMin: 3, totalMax: 5,
    ingredientWeights: weights('basic', 'phase1', { max: [3, 3, 3, 3, 2, 1, 1, 1], weight: [220, 200, 180, 160, 120, 120, 0, 0] }),
    pricingIngredientWeights: weights('basic', 'phase1', { max: [3, 3, 3, 3, 2, 1, 1, 1], weight: [160, 130, 130, 150, 180, 250, 0, 0] }),
  }),
  createBasket({
    id: 'basic-phase2', chestType: 'basic', phaseId: 'phase2', totalMin: 3, totalMax: 5,
    ingredientWeights: weights('basic', 'phase2', { max: [3, 3, 3, 3, 2, 1, 1, 1], weight: [200, 130, 130, 160, 140, 140, 100, 0] }),
    pricingIngredientWeights: weights('basic', 'phase2', { max: [3, 3, 3, 3, 2, 1, 1, 1], weight: [120, 100, 100, 100, 140, 260, 180, 0] }),
  }),
  createBasket({
    id: 'rare-phase1', chestType: 'rare', phaseId: 'phase1', totalMin: 6, totalMax: 10,
    ingredientWeights: weights('rare', 'phase1', { max: [5, 5, 5, 5, 3, 2, 2, 1], weight: [210, 190, 170, 150, 140, 140, 0, 50] }),
    pricingIngredientWeights: weights('rare', 'phase1', { max: [5, 5, 5, 5, 3, 2, 2, 1], weight: [160, 100, 110, 160, 210, 260, 0, 200] }),
  }),
  createBasket({
    id: 'rare-phase2', chestType: 'rare', phaseId: 'phase2', totalMin: 6, totalMax: 10,
    ingredientWeights: weights('rare', 'phase2', { max: [5, 5, 5, 5, 3, 2, 2, 1], weight: [170, 120, 120, 150, 160, 140, 140, 50] }),
    pricingIngredientWeights: weights('rare', 'phase2', { max: [5, 5, 5, 5, 3, 2, 2, 1], weight: [140, 80, 60, 80, 160, 270, 210, 200] }),
  }),
  createBasket({
    id: 'epic-phase1', chestType: 'epic', phaseId: 'phase1', totalMin: 12, totalMax: 20,
    ingredientWeights: weights('epic', 'phase1', { max: [6, 6, 6, 6, 4, 3, 3, 1], weight: [210, 170, 160, 160, 150, 150, 0, 50] }),
    pricingIngredientWeights: weights('epic', 'phase1', { max: [6, 6, 6, 6, 4, 3, 3, 1], weight: [140, 100, 100, 150, 210, 300, 0, 200] }),
  }),
  createBasket({
    id: 'epic-phase2', chestType: 'epic', phaseId: 'phase2', totalMin: 12, totalMax: 20,
    ingredientWeights: weights('epic', 'phase2', { max: [6, 6, 6, 6, 4, 3, 3, 1], weight: [170, 120, 100, 120, 180, 150, 160, 100] }),
    pricingIngredientWeights: weights('epic', 'phase2', { max: [6, 6, 6, 6, 4, 3, 3, 1], weight: [130, 70, 70, 70, 170, 260, 230, 250] }),
  }),
]

// Universal reward->value conversion table (`Prize_sheet`) - used to turn a
// basket's raw reward contents (coins/wild/undo/etc.) into one comparable
// value unit, same unit dish prizeValues are already expressed in. Not
// consumed by anything yet (no basket-value estimator exists so far - see
// CLAUDE.md's Chef section, "2 big things"), kept here since it's real
// source data the estimator will need.
export const REWARD_VALUE = {
  Coins: 1,
  Wild: 2.5,
  Undo: 0.25,
  'Extra Stock': 2,
  'Free Round': 1,
  'Trail Energy': 0,
  Puzzle: 0.07,
  Marketplace: 0.004,
  Quest: 0.011,
  Candy: 0,
  'Sticker Pack': 0,
}

// Real per-segment avg-baskets-opened-per-day rates (`User Habit` sheet) -
// the one lever confirmed to vary per Chef segment, mirroring Merge's own
// habit-bucketed segments (see CLAUDE.md). `prizeTier` is this app's own
// reasonable default mapping (DAU percentiles -> low, Revenue deciles ->
// progressively higher) since the source sheet didn't label a tier per row
// directly - adjust freely, it's just a starting point.
export const SEGMENTS = [
  createSegment({ id: 'p25-dau', name: 'P25 of DAU', avgBasketsPerDay: { basic: 2.6, rare: 0.3, epic: 0 }, prizeTier: 'low' }),
  createSegment({ id: 'p50-dau', name: 'P50 of DAU', avgBasketsPerDay: { basic: 2.8, rare: 0.4, epic: 0.04 }, prizeTier: 'low' }),
  createSegment({ id: 'p75-dau', name: 'P75 of DAU', avgBasketsPerDay: { basic: 3.2, rare: 0.5, epic: 0.08 }, prizeTier: 'low' }),
  createSegment({ id: 'p90-dau', name: 'P90 of DAU', avgBasketsPerDay: { basic: 3.8, rare: 0.7, epic: 0.2 }, prizeTier: 'medium' }),
  createSegment({ id: 'p99-dau', name: 'P99 of DAU', avgBasketsPerDay: { basic: 5.8, rare: 1.2, epic: 0.55 }, prizeTier: 'medium' }),
  createSegment({ id: 'rev-10', name: '10% of Revenue', avgBasketsPerDay: { basic: 11.6, rare: 3.5, epic: 0.8 }, prizeTier: 'high' }),
  createSegment({ id: 'rev-20', name: '20% of Revenue', avgBasketsPerDay: { basic: 10.4, rare: 3, epic: 0.61 }, prizeTier: 'high' }),
  createSegment({ id: 'rev-50', name: '50% of Revenue', avgBasketsPerDay: { basic: 4.6, rare: 1.5, epic: 0.5 }, prizeTier: 'medium' }),
  createSegment({ id: 'rev-100', name: '100% of Revenue', avgBasketsPerDay: { basic: 5.5, rare: 0.8, epic: 0.11 }, prizeTier: 'low' }),
]
