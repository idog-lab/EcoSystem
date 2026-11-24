// THE BLACK FRIDAY CHEF, as read from the economist's workbook `chef_BlackFriday_2411.xlsx` (24 November 2026).
//
// Straight into the rebuilt model (schema 2) - not through the older shape the Halloween and Thanksgiving chefs keep.
// Every number below is the workbook's; where its sheets disagreed the economist chose (24 November 2026):
//   - recipes: "Chef - Demand", the base (297 Main ingredients). Its first dish, Golden Chocolate Cubes, is the
//     same in every segment tab: "Yes, dish 1 never scales" (`sameForAllSegments`);
//   - pantry caps: "Chef - Demand" (40/40/40/40/40/30/30/15), chosen over the segment tabs' 30/30/30/30/30/20/20/15;
//   - baskets: the production strings of the "Baskets" sheet (gameplay and pricing) - "the basket production is not
//     100% finished yet", so they are a draft (the "Chest Assumptions" segment blocks give Gold flakes 0 in period 1);
//   - segments: the nine live segments; effort from the "Segments" sheet (0.8 / 0.8 / 1.1 / 1.1 / 1.2 / 1.2 / 1.2 /
//     1.4), baskets a day from "Chest Assumptions" by the older supply group each band uses (0-40, 40-100, 100-160,
//     160+). Chef_control has nothing in the workbook;
//   - prizes: the "Prize_sheet" components (the same list as Halloween's: 90.5 for the twelve dishes, a grand prize of
//     90 coins), while "Chef_assumptions" says a dish prize of 70 and a grand prize of 70 - to check in step 2.
// Not in the workbook, so EMPTY (never made up): Dish Master days and dishes, the FU day, checkpoints, thresholds,
// the three Recompletion dishes and their prizes, the Recompletion grand prize, prize factors and burnout, jokers,
// special sources, catch-up presets.
import { RARITY, SCHEMA_VERSION, createBasket, createCalendar, createDish, createIngredient, createPhase, createReward, createRewards, createSettings, createSupply, createTargets, liveSegments } from '../lib/chefModel'

export const BLACK_FRIDAY_NAME = 'Black Friday chef'
export const BLACK_FRIDAY_SOURCE = 'chef_BlackFriday_2411.xlsx'

const ORDER = ['flour', 'cream', 'sugar', 'eggs', 'salmon', 'chocolate', 'gold-flakes', 'caviar']
const weights = (max, weight) => ORDER.map((ingredientId, i) => ({ ingredientId, min: 0, max: max[i], weight: weight[i] }))
const MAX = { basic: [3, 3, 3, 3, 2, 1, 1, 1], rare: [5, 5, 5, 5, 3, 2, 2, 1], epic: [6, 6, 6, 6, 4, 3, 3, 1] }
// [gameplay, pricing] weights per chest type and odds period, from the "Baskets" sheet's reward strings.
const ODDS = {
  basic: { phase1: [[220, 200, 180, 160, 120, 120, 50, 0], [160, 130, 130, 150, 180, 250, 50, 0]], phase2: [[200, 130, 130, 160, 140, 140, 100, 0], [120, 100, 100, 100, 140, 260, 180, 0]] },
  rare: { phase1: [[210, 190, 170, 150, 140, 140, 50, 50], [160, 100, 110, 160, 210, 260, 50, 200]], phase2: [[170, 120, 120, 150, 160, 140, 140, 50], [140, 80, 60, 80, 160, 270, 210, 200]] },
  epic: { phase1: [[210, 170, 160, 160, 150, 150, 50, 50], [140, 100, 100, 150, 210, 300, 50, 200]], phase2: [[170, 120, 100, 120, 180, 150, 160, 100], [130, 70, 70, 70, 170, 260, 230, 250]] },
}
// Effort ("Segments" sheet) and baskets a day ("Chest Assumptions", by the supply group the band uses).
const SUPPLY_GROUP = { '0-40': { basic: 3.2, rare: 1.5, epic: 0.3 }, '40-100': { basic: 4.2, rare: 2.1, epic: 0.4 }, '100-160': { basic: 5, rare: 2.7, epic: 0.5 }, '160+': { basic: 6, rare: 4, epic: 0.7 } }
const BANDS = {
  Chef_BW_0_10: [0.8, '0-40'],
  Chef_BW_10_20: [0.8, '0-40'],
  Chef_BW_20_40: [1.1, '0-40'],
  Chef_BW_40_60: [1.1, '40-100'],
  Chef_BW_60_100: [1.2, '40-100'],
  Chef_BW_100_150: [1.2, '100-160'],
  Chef_BW_150_240: [1.2, '160+'],
  Chef_BW_240_Plus: [1.4, '160+'],
}

const recipe = (amounts) => Object.entries(amounts).map(([ingredientId, count]) => ({ ingredientId, count }))

export function blackFridayChefState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    ingredients: [
      createIngredient({ id: 'flour', name: 'Flour', rarity: RARITY.COMMON, pantryCap: 40, art: '🌾' }),
      createIngredient({ id: 'cream', name: 'Cream', rarity: RARITY.COMMON, pantryCap: 40, art: '🥛' }),
      createIngredient({ id: 'sugar', name: 'Sugar', rarity: RARITY.COMMON, pantryCap: 40, art: '🍬' }),
      createIngredient({ id: 'eggs', name: 'Eggs', rarity: RARITY.COMMON, pantryCap: 40, art: '🥚' }),
      createIngredient({ id: 'salmon', name: 'Salmon', rarity: RARITY.RARE, pantryCap: 40, art: '🐟' }),
      createIngredient({ id: 'chocolate', name: 'Chocolate', rarity: RARITY.RARE, pantryCap: 30, art: '🍫' }),
      createIngredient({ id: 'gold-flakes', name: 'Gold flakes', rarity: RARITY.SEMI_BLOCKER, pantryCap: 30, art: '✨' }),
      createIngredient({ id: 'caviar', name: 'Caviar', rarity: RARITY.BLOCKER, pantryCap: 15, art: '⚫' }),
    ],
    dishes: [
      createDish({ id: 'bf-golden-chocolate-cubes', name: 'Golden Chocolate Cubes', art: '🧈', recipe: recipe({ chocolate: 4, 'gold-flakes': 2 }), reward: createReward({ coins: 1 }), sameForAllSegments: true }),
      createDish({ id: 'bf-sale-fortune-cookies', name: 'Sale Fortune Cookies', art: '🥠', recipe: recipe({ flour: 7, sugar: 5, eggs: 4 }), reward: createReward({ coins: 2, freeRound: 1 }) }),
      createDish({ id: 'bf-crispy-salmon-bites', name: 'Crispy Salmon Bites', art: '🍣', recipe: recipe({ cream: 8, eggs: 6, salmon: 6 }), reward: createReward({ coins: 3, undo: 4 }) }),
      createDish({ id: 'bf-creme-brulee', name: 'Creme Brulee', art: '🍮', recipe: recipe({ cream: 8, sugar: 7, eggs: 10 }), reward: createReward({ coins: 3, wild: 1 }) }),
      createDish({ id: 'bf-gold-macarons', name: 'Gold Macarons', art: '🍪', recipe: recipe({ flour: 6, sugar: 8, eggs: 5, 'gold-flakes': 2 }), reward: createReward({ coins: 6 }) }),
      createDish({ id: 'bf-sugar-cookies', name: 'Sugar Cookies', art: '🍪', recipe: recipe({ flour: 6, sugar: 10, eggs: 7, chocolate: 6 }), reward: createReward({ coins: 5, extraStock: 1 }) }),
      createDish({ id: 'bf-smoked-salmon-profiteroles', name: 'Smoked Salmon Profiteroles', art: '🥐', recipe: recipe({ flour: 9, cream: 12, eggs: 8, salmon: 4 }), reward: createReward({ coins: 8 }) }),
      createDish({ id: 'bf-sale-chocolate-cake', name: 'Sale Chocolate Cake', art: '🎂', recipe: recipe({ flour: 8, eggs: 7, chocolate: 7, 'gold-flakes': 3 }), reward: createReward({ coins: 6, freeRound: 3 }) }),
      createDish({ id: 'bf-sashimi-caviar', name: 'Sashimi Caviar', art: '🍱', recipe: recipe({ salmon: 12, caviar: 4 }), reward: createReward({ coins: 10 }) }),
      createDish({ id: 'bf-chocolate-mousse-cups', name: 'Chocolate Mousse Cups', art: '🍫', recipe: recipe({ cream: 14, chocolate: 10, 'gold-flakes': 4 }), reward: createReward({ coins: 6, wild: 2 }) }),
      createDish({ id: 'bf-glitzy-glazed-donuts', name: 'Glitzy Glazed Donuts', art: '🍩', recipe: recipe({ flour: 14, eggs: 11, chocolate: 5, 'gold-flakes': 8 }), reward: createReward({ coins: 8, extraStock: 2 }) }),
      createDish({ id: 'bf-devilled-eggs', name: 'Devilled Eggs', art: '🥚', recipe: recipe({ cream: 10, sugar: 12, eggs: 10, caviar: 8 }), reward: createReward({ coins: 14 }) }),
    ],
    recompletionDishes: [],
    baskets: ['basic', 'rare', 'epic'].flatMap((chestType) =>
      ['phase1', 'phase2'].map((phaseId) => createBasket({ id: `${chestType}-${phaseId}`, chestType, phaseId, ingredientWeights: weights(MAX[chestType], ODDS[chestType][phaseId][0]), pricingIngredientWeights: weights(MAX[chestType], ODDS[chestType][phaseId][1]) })),
    ),
    calendar: createCalendar({ startDate: '2026-11-24', totalDays: 21, phases: [createPhase({ id: 'phase1', label: 'Phase 1', days: 10 }), createPhase({ id: 'phase2', label: 'Phase 2', days: 11 })] }),
    segments: liveSegments().map((segment) => {
      const band = BANDS[segment.name]
      return band ? { ...segment, effortFactor: band[0], supply: createSupply({ mode: 'average', average: SUPPLY_GROUP[band[1]] }) } : segment
    }),
    thresholds: [],
    sources: [],
    presets: [],
    targets: createTargets(),
    rewards: createRewards({ grandPrize: { main: createReward({ coins: 90 }), rc: null } }),
    settings: createSettings(),
    migration: {
      fromWorkbook: BLACK_FRIDAY_SOURCE,
      notes: [
        'Read from chef_BlackFriday_2411.xlsx: 8 ingredients, 12 Main dishes (the base of "Chef - Demand", 297 ingredients), the baskets of both odds periods, the nine live segments with their effort and baskets a day, the dish prizes and the grand prize.',
        'Golden Chocolate Cubes is the same for every segment ("all" in step 2), as in every segment tab of the workbook.',
        'The baskets are your production strings, which you said are not finished: a draft. Gold flakes there has weight 50 in odds period 1; the "Chest Assumptions" segment blocks give it 0.',
        'The prizes are the workbook\'s Prize_sheet (90.5 for the twelve dishes, a grand prize of 90 coins). Chef_assumptions says a dish prize of 70 and a grand prize of 70 - check them in step 2.',
        'Gold flakes is in five dishes: pick the three Dish Master dishes in step 1.',
        'Not in the workbook, so empty - nothing was made up: the Dish Master days and dishes, the FU day, checkpoints, the Caviar and Gold flakes thresholds, the three Recompletion dishes with their prizes, the Recompletion grand prize, prize factors and burnout, Chef_control\'s effort and baskets, jokers and special sources.',
      ],
    },
  }
}
