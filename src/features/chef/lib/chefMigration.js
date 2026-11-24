// FROM THE OLDER CHEF (schema 1) TO THE REBUILT ONE (schema 2).
//
// Nothing the older chef held is thrown away, and nothing it did not hold is
// made up. What the new model needs and the old one never had - progression
// thresholds, pantry caps, the Dish Master, the FU target, jokers, catch-up
// presets, burnout - starts EMPTY, and `notes` says so in plain words (they
// are shown on screen until dismissed). The chef as it was is kept beside the
// new one (chefPersistence.js: `legacy`) and can be downloaded.
import { SCHEMA_VERSION, createCalendar, createReward, createRewards, createSettings, createSource, createSupply, createTargets, createThreshold, createPreset, DEFAULT_REWARD_VALUES, REWARD_KEYS } from './chefModel'

// The earlier tool's own guess for a segment's "prize size".
export const LEGACY_PRIZE_FACTOR = { low: 1, medium: 1.2, high: 1.5 }

// What each of the 12 dishes pays at the base segment, read from the
// "Prize_sheet" of the two source workbooks (the same in both), by position.
export const SOURCE_DISH_REWARDS = [
  { coins: 1 },
  { coins: 2, freeRound: 1 },
  { coins: 3, undo: 4 },
  { coins: 3, wild: 1 },
  { coins: 6 },
  { coins: 5, extraStock: 1 },
  { coins: 8 },
  { coins: 6, freeRound: 3 },
  { coins: 10 },
  { coins: 6, wild: 2 },
  { coins: 8, extraStock: 2 },
  { coins: 14 },
]
const worthOf = (reward) => REWARD_KEYS.reduce((sum, key) => sum + (reward[key] ?? 0) * DEFAULT_REWARD_VALUES[key], 0)
// The older single numbers are the sheet's own when all twelve agree with it.
const matchesSource = (dishes) => dishes.length === SOURCE_DISH_REWARDS.length && dishes.every((d, i) => Number(d.prizeValue) === worthOf(SOURCE_DISH_REWARDS[i]))

function migrateDish(dish, reward) {
  const { prizeValue, ...rest } = dish
  return { ...rest, recipe: (dish.recipe ?? []).map((r) => ({ ...r })), blockerBySegment: dish.blockerBySegment ?? {}, reward: reward ? createReward(reward) : null, legacyWorth: reward ? null : (prizeValue ?? null) }
}

function fromV1(raw) {
  const notes = []
  const dishes = raw.dishes ?? []
  const sourcePrizes = matchesSource(dishes)
  const calendar = createCalendar({ ...(raw.calendar ?? {}), dishMaster: null })
  const grants = raw.grants ?? []
  const totalPrize = raw.totalChefPrize ?? null
  const state = {
    schemaVersion: SCHEMA_VERSION,
    ingredients: (raw.ingredients ?? []).map(({ cap, ...ing }) => ({ ...ing, pantryCap: null, sourceCap: cap ?? null })),
    dishes: dishes.map((d, i) => migrateDish(d, sourcePrizes ? SOURCE_DISH_REWARDS[i] : null)),
    recompletionDishes: (raw.recompletionDishes ?? []).map((d) => migrateDish(d, null)),
    baskets: JSON.parse(JSON.stringify(raw.baskets ?? [])),
    calendar,
    segments: (raw.segments ?? []).map(({ avgBasketsPerDay, prizeTier, ...seg }) => ({
      ...seg,
      brutWinsMin: null,
      brutWinsMax: null,
      effortFactor: 1,
      prizeFactor: LEGACY_PRIZE_FACTOR[prizeTier] ?? 1,
      burnout: 1,
      supply: createSupply({ mode: 'average', average: avgBasketsPerDay ?? {} }),
      activityShape: seg.activityShape ?? 'flat',
    })),
    thresholds: [],
    sources: grants.map((g) => createSource({ id: g.id, label: g.label ?? '', kind: 'ingredient', day: g.day, ingredientId: g.ingredientId, amount: g.amount, coveragePct: g.coveragePct ?? 100 })),
    presets: [],
    targets: createTargets(),
    rewards: createRewards({ grandPrize: { main: totalPrize?.low != null ? createReward({ coins: totalPrize.low }) : null, rc: null } }),
    settings: createSettings(),
    // The source sheet's Recompletion "Cap" row, kept as read; nothing plays it.
    sourceRecompletionCaps: raw.recompletionCaps ?? null,
    migration: null,
  }

  if ((raw.ingredients ?? []).some((i) => i.cap != null)) {
    notes.push('Each ingredient had a "Cap" from the source sheet. It is kept beside the ingredient and not played: the sheet does not say whether it is the pantry cap or the progression threshold. Set pantry caps in step 2 and thresholds in step 3 (one click copies the sheet\'s number into the pantry cap).')
  }
  notes.push('This chef had no progression thresholds, no Dish Master days, no day for the FU target, no checkpoints, no jokers and no catch-up presets. None were made up: they start empty. Until the blocker has a threshold, no player can be counted as sitting in FU.')
  if ((raw.segments ?? []).length) {
    notes.push('A segment\'s "prize size" (low, medium, high) became a prize factor of 1, 1.2 or 1.5 - the earlier guess of this tool, not a figure from the sheet. Effort factor and burnout start at 1; Brut Wins is empty.')
  }
  if ((raw.segments ?? []).some((s) => (s.activityShape ?? 'flat') !== 'flat')) {
    notes.push('An activity shape now only moves baskets between days: the baskets a day you typed are the real average. Before, a shape also changed the total, so a run of this chef gives other figures than it did.')
  }
  if (dishes.length) {
    notes.push(
      sourcePrizes
        ? 'Dish prizes were one number each. They match the prize sheet of the source workbook, so what each prize is made of (coins, wilds, extra stock, free rounds, undos) was read from that sheet.'
        : 'Dish prizes were one number each, with nothing saying what a prize is made of. Each is counted as coins until its components are typed (step 2).',
    )
  }
  if (totalPrize) {
    notes.push(`The prize for cooking every dish had one value a prize size (${['low', 'medium', 'high'].map((t) => totalPrize[t]).filter((v) => v != null).join(' / ')}). The first is now the Main grand prize, in coins; a segment's own is worked out from its prize factor and burnout, and rounded to the nearest 5.`)
  }
  const rc = raw.recompletionDishes ?? []
  if (rc.length && rc.length !== 3) {
    notes.push(`Recompletion has ${rc.length} dishes here. The rule is three new dishes; the list is kept as it was, and it is yours to cut.`)
  }
  if (rc.some((d) => d.prizeValue == null)) {
    notes.push('The Recompletion dishes have no prizes, and Recompletion has no grand prize: what that round pays is unknown, not zero.')
  }
  notes.push('Recompletion is now played after the Main round, on the same days and with the same pantry - not as an event of its own from day 1.')
  if (grants.length) notes.push('What was given outside the baskets is now a list of special sources. None may pass a progression threshold unless you allow it.')
  state.migration = { fromVersion: 1, notes }
  return state
}

const fillDish = (d) => ({ ...d, blockerBySegment: d.blockerBySegment ?? {}, reward: d.reward ?? null, legacyWorth: d.legacyWorth ?? null })

// Fills in whatever a schema-2 chef lacks (a save from an earlier day of this build).
function normalizeV2(raw) {
  return {
    ...raw,
    schemaVersion: SCHEMA_VERSION,
    // (What is there keeps its place; only what is missing is added.)
    ingredients: (raw.ingredients ?? []).map((i) => ({ ...i, pantryCap: i.pantryCap ?? null, sourceCap: i.sourceCap ?? null })),
    dishes: (raw.dishes ?? []).map(fillDish),
    recompletionDishes: (raw.recompletionDishes ?? []).map(fillDish),
    baskets: raw.baskets ?? [],
    calendar: createCalendar(raw.calendar ?? {}),
    segments: (raw.segments ?? []).map((s) => ({ ...s, brutWinsMin: s.brutWinsMin ?? null, brutWinsMax: s.brutWinsMax ?? null, effortFactor: s.effortFactor ?? 1, prizeFactor: s.prizeFactor ?? 1, burnout: s.burnout ?? 1, supply: createSupply(s.supply ?? {}), activityShape: s.activityShape ?? 'flat' })),
    thresholds: (raw.thresholds ?? []).map((t) => createThreshold(t)),
    sources: (raw.sources ?? []).map((s) => createSource(s)),
    presets: (raw.presets ?? []).map((p) => createPreset(p)),
    targets: createTargets(raw.targets ?? {}),
    rewards: createRewards(raw.rewards ?? {}),
    settings: createSettings(raw.settings ?? {}),
    migration: raw.migration ?? null,
  }
}

// A chef of any age, as a schema-2 chef. `migrated`: whether it was an older one.
export function migrateChefState(raw) {
  if (!raw || typeof raw !== 'object') return null
  if ((raw.schemaVersion ?? 1) >= SCHEMA_VERSION) return { state: normalizeV2(raw), migrated: false }
  return { state: fromV1(raw), migrated: true }
}

// A chef from one of the real chefs' data modules (they hold the source sheet as it was read).
export function chefFromSource(mod) {
  const { state } = migrateChefState({
    ingredients: mod.INGREDIENTS,
    dishes: mod.DISHES,
    recompletionDishes: mod.RECOMPLETION_DISHES,
    recompletionCaps: mod.RECOMPLETION_INGREDIENT_CAPS,
    baskets: mod.BASKETS,
    calendar: mod.CALENDAR,
    segments: mod.SEGMENTS,
    totalChefPrize: mod.TOTAL_CHEF_PRIZE,
    grants: [],
  })
  return JSON.parse(JSON.stringify(state))
}
