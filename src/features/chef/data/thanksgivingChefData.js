// Real seed data transcribed from `chef_Thanksgiving_0911_copy.xlsx` (a
// second real chef event the economist added to the repo, alongside the
// Halloween one - see halloweenChefData.js for the original reverse-
// engineering notes, which this file follows the exact same conventions
// of). Same sheet set as the Halloween workbook (`Chef_assumptions`,
// `Baskets`, `Chef - Demand`, `Chef - Demand (2)`, `Prize_sheet`,
// `User Habit`), plus one new sheet this workbook has that Halloween's
// didn't - `Suggestions`.
//
// **`Suggestions` is the recipe matrix actually used here - by explicit
// economist correction** ("the suggestions are the actual data we are
// using"), not `Chef - Demand`. The two sheets hold genuinely DIFFERENT
// recipe matrices (verified directly, not assumed): `Chef - Demand`'s own
// per-dish totals match `Chef_assumptions`' "Total demand" column exactly,
// while `Suggestions`' own per-dish totals are smaller and don't match
// either - e.g. dish 1 "Mashed Potatoes" totals 6 in `Chef - Demand` vs
// just 4 in `Suggestions`. Every dish's own recipe below is transcribed
// from `Suggestions` specifically. `Suggestions` ALSO carries a per-dish
// "target vs simulated completion day" table (scaled from a "3-week
// baseline chef" down to this 14-day chef via its own 0.667 scale factor)
// - not imported here, since using it (e.g. as a simulator calibration
// target) is a separate, explicit ask the economist hasn't made yet.
//
// `Prize_sheet` and `User Habit` are BYTE-IDENTICAL to the Halloween
// workbook's own copies (diffed directly, not assumed) - this chef reuses
// the same universal reward-value table, the same Low/Medium/High segment
// prize multiplier, and the same real per-segment avg-baskets/day rates.
//
// One thing worth flagging rather than silently trusting: `Chef start`
// (Excel serial 46313) is the exact same serial Halloween's own sheet
// used, converting to the same 2026-10-18 date - almost certainly a
// leftover template value never updated for this (Thanksgiving-themed,
// 14-day) chef, not a real start date. Transcribed as-is; update it in the
// Calendar tab once the real date is known.
import { RARITY, createIngredient, createDish, createBasket, createPhase, createCalendar, createSegment } from '../lib/chefLegacyModel'

export const CALENDAR = createCalendar({
  startDate: '2026-10-18', // see file header note - likely a stale template value, not this chef's real date
  totalDays: 14,
  phases: [createPhase({ id: 'phase1', label: 'Phase 1', days: 10 }), createPhase({ id: 'phase2', label: 'Phase 2', days: 4 })],
})

export const INGREDIENTS = [
  createIngredient({ id: 'potato', name: 'Potato', rarity: RARITY.COMMON, cap: 30, art: '🥔' }),
  createIngredient({ id: 'cream', name: 'Cream', rarity: RARITY.COMMON, cap: 30, art: '🥛' }),
  createIngredient({ id: 'pumpkin', name: 'Pumpkin', rarity: RARITY.COMMON, cap: 30, art: '🎃' }),
  createIngredient({ id: 'turkey', name: 'Turkey', rarity: RARITY.RARE, cap: 30, art: '🦃' }),
  createIngredient({ id: 'flour', name: 'Flour', rarity: RARITY.RARE, cap: 30, art: '🌾' }),
  createIngredient({ id: 'sugar', name: 'Sugar', rarity: RARITY.RARE, cap: 20, art: '🍬' }),
  // Legacy "Epic" - confirmed (same mapping as the Halloween chef) to be
  // the "semi blocker" tier.
  createIngredient({ id: 'cranberries', name: 'Cranberries', rarity: RARITY.SEMI_BLOCKER, cap: 20, art: '🍒' }),
  createIngredient({ id: 'sweet-potato', name: 'Sweet Potato', rarity: RARITY.BLOCKER, cap: 15, art: '🍠' }),
]

// Real recipe matrix - `Suggestions` sheet (confirmed by the economist to
// be the actual data in use, NOT `Chef - Demand`'s own matrix - see the
// file header note for the verification that these are genuinely two
// different matrices). Each dish's prizeValue is still the Low-tier value
// from `Prize_sheet` (its "Final" column, byte-identical to Halloween's
// own) - the per-segment Low/Medium/High multiplier applies at calculation
// time (chefModel.js's dishPrizeValueForSegment), not baked into this
// number; `Suggestions` has no prize data of its own.
export const DISHES = [
  createDish({ id: 'mashed-potatoes', name: 'Mashed Potatoes', prizeValue: 1, art: '🥔', recipe: [{ ingredientId: 'potato', count: 2 }, { ingredientId: 'cream', count: 2 }] }),
  createDish({
    id: 'stuffed-pumpkin',
    name: 'Stuffed Pumpkin',
    prizeValue: 3,
    art: '🎃',
    recipe: [{ ingredientId: 'potato', count: 5 }, { ingredientId: 'pumpkin', count: 6 }, { ingredientId: 'turkey', count: 3 }],
  }),
  createDish({
    id: 'pumpkin-dinner-rolls',
    name: 'Pumpkin Dinner Rolls',
    prizeValue: 4,
    art: '🥐',
    recipe: [{ ingredientId: 'pumpkin', count: 5 }, { ingredientId: 'flour', count: 2 }, { ingredientId: 'sugar', count: 3 }],
  }),
  createDish({
    id: 'turkey-sandwich',
    name: 'Turkey Sandwich',
    prizeValue: 5.5,
    art: '🥪',
    recipe: [{ ingredientId: 'turkey', count: 5 }, { ingredientId: 'flour', count: 2 }, { ingredientId: 'cranberries', count: 3 }],
  }),
  createDish({
    id: 'twice-baked-potatoes',
    name: 'Twice Baked Potatoes',
    prizeValue: 6,
    art: '🥔',
    recipe: [{ ingredientId: 'potato', count: 8 }, { ingredientId: 'cream', count: 9 }, { ingredientId: 'flour', count: 6 }],
  }),
  createDish({
    id: 'cranberry-cream-tart',
    name: 'Cranberry Cream Tart',
    prizeValue: 7,
    art: '🍰',
    recipe: [{ ingredientId: 'cream', count: 7 }, { ingredientId: 'flour', count: 4 }, { ingredientId: 'sugar', count: 6 }, { ingredientId: 'cranberries', count: 4 }],
  }),
  createDish({
    id: 'turkey-pot-pie',
    name: 'Turkey Pot Pie',
    prizeValue: 8,
    art: '🥧',
    recipe: [{ ingredientId: 'potato', count: 9 }, { ingredientId: 'pumpkin', count: 6 }, { ingredientId: 'turkey', count: 7 }, { ingredientId: 'flour', count: 4 }],
  }),
  createDish({
    id: 'turkey-roulade',
    name: 'Turkey Roulade',
    prizeValue: 9,
    art: '🍗',
    recipe: [
      { ingredientId: 'potato', count: 8 },
      { ingredientId: 'turkey', count: 6 },
      { ingredientId: 'flour', count: 3 },
      { ingredientId: 'sweet-potato', count: 3 },
    ],
  }),
  createDish({
    id: 'stuffed-turkey',
    name: 'Stuffed Turkey',
    prizeValue: 10,
    art: '🦃',
    recipe: [{ ingredientId: 'potato', count: 10 }, { ingredientId: 'turkey', count: 8 }, { ingredientId: 'cranberries', count: 3 }],
  }),
  createDish({
    id: 'cranberry-brie-pull-apart-bread',
    name: 'Cranberry Brie Pull-Apart Bread',
    prizeValue: 11,
    art: '🍞',
    recipe: [{ ingredientId: 'cream', count: 8 }, { ingredientId: 'flour', count: 3 }, { ingredientId: 'sugar', count: 5 }, { ingredientId: 'cranberries', count: 4 }],
  }),
  createDish({
    id: 'pumpkin-pie',
    name: 'Pumpkin Pie',
    prizeValue: 12,
    art: '🥧',
    recipe: [{ ingredientId: 'pumpkin', count: 10 }, { ingredientId: 'cream', count: 12 }, { ingredientId: 'flour', count: 8 }, { ingredientId: 'sugar', count: 5 }],
  }),
  createDish({
    id: 'sweet-potato-casserole',
    name: 'Sweet Potato Casserole',
    prizeValue: 14,
    art: '🍠',
    recipe: [
      { ingredientId: 'potato', count: 12 },
      { ingredientId: 'cream', count: 10 },
      { ingredientId: 'flour', count: 11 },
      { ingredientId: 'sweet-potato', count: 7 },
    ],
  }),
]

// Total chef grand-prize value per segment prize tier (Prize_sheet's "GP" /
// "Total dish in allowance" row) - byte-identical to the Halloween chef's
// own Prize_sheet.
export const TOTAL_CHEF_PRIZE = { low: 90, medium: 108, high: 135 }

// `Chef - Demand (2)` - same Recompletion-round convention as the
// Halloween chef (confirmed by the economist to be read that way there;
// this sheet has the identical shape here, down to the same blank/
// unlabeled dish column carrying real nonzero values and the same missing
// Epic dish - "Turkey Roulade" here, "Ghost Apple Turnovers" there).
export const RECOMPLETION_DISHES = [
  createDish({ id: 'rc-mashed-potatoes', name: 'Mashed Potatoes', prizeValue: null, art: '🥔', recipe: [{ ingredientId: 'cream', count: 2 }, { ingredientId: 'pumpkin', count: 2 }] }),
  createDish({
    id: 'rc-stuffed-pumpkin',
    name: 'Stuffed Pumpkin',
    prizeValue: null,
    art: '🎃',
    recipe: [{ ingredientId: 'potato', count: 3 }, { ingredientId: 'pumpkin', count: 5 }, { ingredientId: 'sugar', count: 2 }],
  }),
  createDish({
    id: 'rc-pumpkin-dinner-rolls',
    name: 'Pumpkin Dinner Rolls',
    prizeValue: null,
    art: '🥐',
    recipe: [{ ingredientId: 'potato', count: 5 }, { ingredientId: 'pumpkin', count: 3 }, { ingredientId: 'cranberries', count: 5 }],
  }),
  createDish({
    id: 'rc-turkey-sandwich',
    name: 'Turkey Sandwich',
    prizeValue: null,
    art: '🥪',
    recipe: [{ ingredientId: 'potato', count: 8 }, { ingredientId: 'pumpkin', count: 10 }, { ingredientId: 'sugar', count: 4 }],
  }),
  createDish({
    id: 'rc-twice-baked-potatoes',
    name: 'Twice Baked Potatoes',
    prizeValue: null,
    art: '🥔',
    recipe: [{ ingredientId: 'cream', count: 15 }, { ingredientId: 'pumpkin', count: 8 }, { ingredientId: 'flour', count: 10 }],
  }),
  createDish({
    id: 'rc-cranberry-cream-tart',
    name: 'Cranberry Cream Tart',
    prizeValue: null,
    art: '🍰',
    recipe: [{ ingredientId: 'potato', count: 11 }, { ingredientId: 'pumpkin', count: 7 }, { ingredientId: 'sugar', count: 12 }],
  }),
  createDish({
    id: 'rc-turkey-pot-pie',
    name: 'Turkey Pot Pie',
    prizeValue: null,
    art: '🥧',
    recipe: [{ ingredientId: 'potato', count: 13 }, { ingredientId: 'cream', count: 17 }, { ingredientId: 'pumpkin', count: 12 }, { ingredientId: 'flour', count: 8 }],
  }),
  createDish({
    id: 'rc-stuffed-turkey',
    name: 'Stuffed Turkey',
    prizeValue: null,
    art: '🦃',
    recipe: [{ ingredientId: 'cream', count: 5 }, { ingredientId: 'turkey', count: 7 }, { ingredientId: 'flour', count: 4 }, { ingredientId: 'cranberries', count: 10 }],
  }),
  createDish({
    id: 'rc-cranberry-brie-pull-apart-bread',
    name: 'Cranberry Brie Pull-Apart Bread',
    prizeValue: null,
    art: '🍞',
    recipe: [{ ingredientId: 'potato', count: 11 }, { ingredientId: 'cream', count: 18 }, { ingredientId: 'pumpkin', count: 20 }, { ingredientId: 'sweet-potato', count: 3 }],
  }),
  createDish({
    id: 'rc-pumpkin-pie',
    name: 'Pumpkin Pie',
    prizeValue: null,
    art: '🥧',
    recipe: [
      { ingredientId: 'potato', count: 7 },
      { ingredientId: 'cream', count: 21 },
      { ingredientId: 'pumpkin', count: 15 },
      { ingredientId: 'turkey', count: 17 },
      { ingredientId: 'flour', count: 12 },
    ],
  }),
  // Source sheet's column header for this dish was blank, but the row data
  // carries real values - transcribed under a placeholder name rather than
  // guessed at, same as the Halloween chef's own unlabeled recompletion
  // column.
  createDish({
    id: 'rc-unlabeled-column',
    name: '(unlabeled column in source sheet)',
    prizeValue: null,
    art: '❓',
    recipe: [
      { ingredientId: 'potato', count: 7 },
      { ingredientId: 'pumpkin', count: 11 },
      { ingredientId: 'turkey', count: 10 },
      { ingredientId: 'flour', count: 6 },
      { ingredientId: 'sweet-potato', count: 7 },
    ],
  }),
  createDish({
    id: 'rc-sweet-potato-casserole',
    name: 'Sweet Potato Casserole',
    prizeValue: null,
    art: '🍠',
    recipe: [
      { ingredientId: 'potato', count: 21 },
      { ingredientId: 'cream', count: 22 },
      { ingredientId: 'turkey', count: 18 },
      { ingredientId: 'flour', count: 16 },
      { ingredientId: 'cranberries', count: 22 },
    ],
  }),
]
export const RECOMPLETION_INGREDIENT_CAPS = { potato: 45, cream: 99, pumpkin: 45, turkey: 45, flour: 30, sugar: 30, cranberries: 20, 'sweet-potato': 15 }

const INGREDIENT_ORDER = ['potato', 'cream', 'pumpkin', 'turkey', 'flour', 'sugar', 'cranberries', 'sweet-potato']

function weights(values) {
  return INGREDIENT_ORDER.map((ingredientId, i) => ({ ingredientId, min: 0, max: values.max[i], weight: values.weight[i] }))
}

// Real "Gameplay" basket odds - `Baskets` sheet, one row per (Chest Type,
// Phase). "Alternative type" confirmed identical odds within the same
// Chest Type+Phase, same as Halloween - not modeled as a separate axis.
// `pricingIngredientWeights` is the sheet's separate "Pricing" table for
// the same (Chest Type, Phase).
export const BASKETS = [
  createBasket({
    id: 'basic-phase1', chestType: 'basic', phaseId: 'phase1', totalMin: 3, totalMax: 5,
    ingredientWeights: weights({ max: [3, 3, 3, 3, 2, 1, 1, 1], weight: [200, 200, 180, 150, 110, 110, 50, 0] }),
    pricingIngredientWeights: weights({ max: [3, 3, 3, 3, 2, 1, 1, 1], weight: [120, 120, 120, 120, 120, 200, 200, 0] }),
  }),
  createBasket({
    id: 'basic-phase2', chestType: 'basic', phaseId: 'phase2', totalMin: 3, totalMax: 5,
    ingredientWeights: weights({ max: [3, 3, 3, 3, 2, 1, 1, 1], weight: [200, 130, 130, 160, 140, 140, 100, 0] }),
    pricingIngredientWeights: weights({ max: [3, 3, 3, 3, 2, 1, 1, 1], weight: [120, 100, 100, 100, 140, 260, 180, 0] }),
  }),
  createBasket({
    id: 'rare-phase1', chestType: 'rare', phaseId: 'phase1', totalMin: 6, totalMax: 10,
    ingredientWeights: weights({ max: [5, 5, 5, 5, 3, 2, 2, 1], weight: [160, 160, 160, 130, 130, 130, 80, 50] }),
    pricingIngredientWeights: weights({ max: [5, 5, 5, 5, 3, 2, 2, 1], weight: [120, 120, 120, 120, 120, 200, 200, 0] }),
  }),
  createBasket({
    id: 'rare-phase2', chestType: 'rare', phaseId: 'phase2', totalMin: 6, totalMax: 10,
    ingredientWeights: weights({ max: [5, 5, 5, 5, 3, 2, 2, 1], weight: [170, 120, 120, 150, 160, 140, 140, 50] }),
    pricingIngredientWeights: weights({ max: [5, 5, 5, 5, 3, 2, 2, 1], weight: [140, 80, 60, 80, 160, 270, 210, 200] }),
  }),
  createBasket({
    id: 'epic-phase1', chestType: 'epic', phaseId: 'phase1', totalMin: 12, totalMax: 20,
    ingredientWeights: weights({ max: [6, 6, 6, 6, 4, 3, 3, 1], weight: [140, 140, 140, 130, 140, 140, 120, 50] }),
    pricingIngredientWeights: weights({ max: [6, 6, 6, 6, 4, 3, 3, 1], weight: [120, 120, 120, 120, 120, 200, 200, 0] }),
  }),
  createBasket({
    id: 'epic-phase2', chestType: 'epic', phaseId: 'phase2', totalMin: 12, totalMax: 20,
    ingredientWeights: weights({ max: [6, 6, 6, 6, 4, 3, 3, 1], weight: [170, 120, 100, 120, 180, 150, 160, 100] }),
    pricingIngredientWeights: weights({ max: [6, 6, 6, 6, 4, 3, 3, 1], weight: [130, 70, 70, 70, 170, 260, 230, 250] }),
  }),
]

// Universal reward->value conversion table (`Prize_sheet`) - byte-
// identical to the Halloween chef's own copy.
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
// byte-identical to the Halloween chef's own copy (diffed directly).
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
