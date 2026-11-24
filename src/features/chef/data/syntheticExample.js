// A SYNTHETIC EXAMPLE - NOT AN APPROVED ECONOMY, NOT A REFERENCE FOR PRODUCTION.
//
// The historical chefs lack what the rebuilt event needs (thresholds, Dish
// Master days, an FU target, three Recompletion dishes with prizes), so with
// them alone the whole flow - FU, Recompletion, presets, payouts - cannot be
// tried. This takes the Halloween chef as it was read and adds MADE-UP values
// for everything it lacks, so the flow can be walked and checked end to end.
//
// Every number added here is invented for that purpose: the thresholds, the
// dates, the three Recompletion recipes and their prizes, the pantry caps,
// the segments' effort factors, the joker, the catch-up preset. None was chosen or approved by the
// economist, none says anything about a real event, and the chef carries
// `synthetic: true` so the screens say so wherever it is open. It is never
// the base of a reference chef's values: a reference is completed by hand.
import * as halloween from './halloweenChefData'
import { chefFromSource } from '../lib/chefMigration'
import { createCheckpoint, createDish, createPreset, createReward, createSource, createThreshold } from '../lib/chefModel'

export const SYNTHETIC_NAME = 'Synthetic example (made up)'
export const SYNTHETIC_NOTE =
  'A synthetic example. Its thresholds, dates, Recompletion dishes and prizes, pantry caps, effort factors, joker and catch-up preset are made up so the whole flow can be tried. It is not an approved economy and says nothing about a real event.'

const SYNTHETIC_EFFORT = [0.5, 0.6, 0.75, 1, 1.7, 3.5, 3, 1.6, 1.25]

export function syntheticExampleState() {
  const base = chefFromSource(halloween)
  const recipe = (amounts) => Object.entries(amounts).map(([ingredientId, count]) => ({ ingredientId, count }))
  return {
    ...base,
    synthetic: true,
    migration: null,
    // (Made-up effort factors, roughly in step with how many baskets each segment opens: the source has
    // none, and with one size of recipe for all no base recipe can suit both the weakest and the strongest.)
    segments: base.segments.map((s, i) => ({ ...s, effortFactor: SYNTHETIC_EFFORT[i] ?? 1 })),
    ingredients: base.ingredients.map((i) => ({ ...i, pantryCap: i.id === 'green-jelly' ? 15 : i.id === 'pumpkin' ? 60 : 80 })),
    recompletionDishes: [
      createDish({ id: 'syn-rc-1', name: 'Made-up dish 1', art: '🧪', recipe: recipe({ sugar: 10, flour: 8 }), reward: createReward({ coins: 5 }) }),
      createDish({ id: 'syn-rc-2', name: 'Made-up dish 2', art: '🧪', recipe: recipe({ butter: 9, apple: 9, chocolate: 6 }), reward: createReward({ coins: 8, undo: 2 }) }),
      createDish({ id: 'syn-rc-3', name: 'Made-up dish 3', art: '🧪', recipe: recipe({ milk: 8, pumpkin: 6, 'green-jelly': 4 }), reward: createReward({ coins: 12, wild: 1 }) }),
    ],
    calendar: { ...base.calendar, dishMaster: { startDay: 5, endDay: 10 } },
    targets: { mainFuDay: 14, mainFuSharePct: 80, checkpoints: [createCheckpoint({ id: 'syn-checkpoint', day: 10, dishes: 6, sharePct: 80 })] },
    thresholds: [
      createThreshold({ id: 'syn-jelly-main', ingredientId: 'green-jelly', round: 'main', steps: [{ fromDay: 1, limit: 6 }, { fromDay: 17, limit: null }] }),
      createThreshold({ id: 'syn-pumpkin-main', ingredientId: 'pumpkin', round: 'main', steps: [{ fromDay: 1, limit: 0 }, { fromDay: 5, limit: 2 }, { fromDay: 7, limit: 4 }, { fromDay: 9, limit: 6 }, { fromDay: 11, limit: null }] }),
      createThreshold({ id: 'syn-jelly-rc', ingredientId: 'green-jelly', round: 'rc', steps: [{ fromDay: 1, limit: 2 }] }),
    ],
    sources: [createSource({ id: 'syn-joker', label: 'made-up joker', kind: 'joker', day: 15, amount: 1, coveragePct: 20 })],
    presets: [
      createPreset({
        id: 'syn-preset',
        name: 'Made-up blocker help',
        chestType: 'basic',
        round: 'main',
        startDay: 17,
        priority: 1,
        maxUses: 2,
        eligibility: { dishesMin: 10, missingIngredientId: 'green-jelly', missingMin: 1 },
        allocations: { 3: { 'green-jelly': 1, sugar: 2 }, 4: { 'green-jelly': 1, sugar: 3 }, 5: { 'green-jelly': 1, sugar: 4 } },
      }),
    ],
    rewards: { ...base.rewards, grandPrize: { ...base.rewards.grandPrize, rc: createReward({ coins: 30 }) } },
  }
}
