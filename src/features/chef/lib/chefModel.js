// Core domain types for the Chef feature. Mirrors Merge's "plain data +
// factory function" convention (see board.js's createBoard) rather than
// classes - everything here is a plain object the UI reads/writes directly.

export const RARITY = {
  COMMON: 'common',
  RARE: 'rare',
  // The legacy Ops sheet calls this tier "Epic" - confirmed by the economist
  // to be the same thing as "semi blocker" from the original domain
  // description (an ingredient that's throttled, not fully gated, across
  // the calendar - see each basket's own per-phase weight for how that
  // throttling actually shows up, below).
  SEMI_BLOCKER: 'semi-blocker',
  BLOCKER: 'blocker',
}

export const RARITY_LABELS = {
  [RARITY.COMMON]: 'Common',
  [RARITY.RARE]: 'Rare',
  [RARITY.SEMI_BLOCKER]: 'Semi-blocker',
  [RARITY.BLOCKER]: 'Blocker',
}

export const RARITY_ORDER = [RARITY.COMMON, RARITY.RARE, RARITY.SEMI_BLOCKER, RARITY.BLOCKER]

export const CHEST_TYPES = ['basic', 'rare', 'epic']

export const CHEST_LABELS = {
  basic: 'Basic',
  rare: 'Rare',
  epic: 'Epic',
}

let idCounter = 0
export function nextId(prefix) {
  idCounter += 1
  return `${prefix}-${idCounter}-${Date.now().toString(36)}`
}

// `art` is a plain emoji string standing in for real ingredient art, the
// same explicit "placeholder, swap for the real thing later" convention
// Diamond Mine's own GEM_COLOR_RAMP already uses for gem art (see
// CLAUDE.md's Diamond Mine section) - not meant to be final.
export function createIngredient({ id, name, rarity = RARITY.COMMON, cap = null, art = null } = {}) {
  return { id: id ?? nextId('ingredient'), name: name ?? 'New ingredient', rarity, cap, art }
}

// `recipe` is a list of { ingredientId, count } - how much of each
// ingredient this dish needs. `prizeValue` is the dish's baseline (Low
// segment tier) prize-equivalent value - see `SEGMENT_PRIZE_MULTIPLIER`
// below for how a segment scales this at calculation time. Real chef data
// (Prize_sheet) computes this from each dish's own reward components
// (coins/undo/wild/etc.) via REWARD_VALUE - `prizeValue` is that already-
// computed total, not re-derived live, so a dish can be entered directly
// from a prize-value number without needing its raw reward breakdown.
export function createDish({ id, name, recipe = [], prizeValue = 0, art = null } = {}) {
  return { id: id ?? nextId('dish'), name: name ?? 'New dish', recipe, prizeValue, art }
}

// A basket/chest's real roll algorithm (reverse-engineered from the legacy
// Ops "Reward String" syntax, e.g.
// `random_group(3,5,TrueRandom,dynamic(sugar)(0,3,220),...)`): first roll a
// TOTAL ingredient count in [totalMin, totalMax], then distribute that total
// across ingredients via a weighted draw, where each ingredient can
// contribute at most `max` units to any single basket open (`min` is
// always 0 in every real basket seen so far, but kept as a field since the
// syntax carries one). `weight` of 0 means "never appears from this basket
// in this phase" - this is also how a semi-blocker/blocker ingredient
// "opens" over the calendar: its weight is 0 in an early phase's basket and
// nonzero in a later phase's, not a separate cap/unlock schedule.
export function createBasket({ id, chestType = 'basic', phaseId, totalMin = 1, totalMax = 1, ingredientWeights = [], pricingIngredientWeights = null } = {}) {
  return {
    id: id ?? nextId('basket'),
    chestType,
    phaseId,
    totalMin,
    totalMax,
    ingredientWeights, // [{ ingredientId, min, max, weight }]
    pricingIngredientWeights, // same shape, optional - feeds the basket-value estimator, not real player-facing odds
  }
}

export function createPhase({ id, label, days }) {
  return { id, label, days }
}

// A Chef event has its own real start date + duration, the same pattern
// Merge's own event schedule (eventStartDate/eventDurationDays) already
// uses - by explicit economist request ("the calendar should be one with
// dates... the chef should have dates and duration"). `totalDays` is the
// event's own duration; `phases` still carry their own day-COUNTS (not
// dates directly), since a phase boundary is defined relative to the
// event's start, not as an independent absolute date - moving the whole
// event's start date should shift every phase's dates with it for free.
export function createCalendar({ startDate = null, totalDays = 1, phases = [] } = {}) {
  return { startDate, totalDays, phases }
}

// 1-indexed `day` (day 1 = the event's own start date) -> a real Date, or
// null if no start date has been set yet (a calendar can exist and be
// edited before the economist has picked a real date for it).
export function calendarDateForDay(calendar, day) {
  if (!calendar?.startDate) return null
  const start = new Date(`${calendar.startDate}T00:00:00`)
  const date = new Date(start)
  date.setDate(date.getDate() + (day - 1))
  return date
}

export function formatCalendarDate(date) {
  if (!date) return null
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// The 1-indexed [startDay, endDay] (inclusive) a given phase spans, derived
// from every phase's own day-count up to and including it - the single
// source of truth both the simulator (chefSimulation.js's `phaseForDay`)
// and any date-range display should agree with.
export function phaseDayRange(calendar, phaseId) {
  let cursor = 0
  for (const phase of calendar.phases) {
    const startDay = cursor + 1
    cursor += phase.days
    if (phase.id === phaseId) return { startDay, endDay: cursor }
  }
  return null
}

// A Chef segment - by explicit economist request, mirrors Merge's own
// habit-bucketed segment logic (see CLAUDE.md's "Segments" section) without
// sharing any of Merge's actual domain rules. The real legacy data (User
// Habit sheet) buckets players by DAU percentile and by Revenue decile,
// each with its own real avg-baskets-opened-per-day rate split by chest
// type - that's the one lever confirmed to vary per segment. `prizeTier`
// additionally varies dish prize VALUES per segment (confirmed by the
// economist - "we will calculate differently for each segment at the
// end"), via SEGMENT_PRIZE_MULTIPLIER below - a segment's own recipes/
// calendar/basket odds stay shared, only its basket-opening rate and its
// own prize-value multiplier differ.
// `activityShape` models that real players don't open baskets at a
// perfectly flat daily rate all event long - by explicit economist
// brainstorm ask ("come up with ideas to make the simulator the best it
// can be"). `avgBasketsPerDay` stays the segment's own TRUE average rate;
// the shape only reweights which days that average gets spent on, via
// `dailyActivityMultiplier` below - it never changes the segment's total
// basket count across the whole event.
export const ACTIVITY_SHAPES = ['flat', 'ramp-up', 'taper', 'weekend-boost']
export const ACTIVITY_SHAPE_LABELS = {
  flat: 'Flat (same every day)',
  'ramp-up': 'Ramp-up (slower start)',
  taper: 'Taper (fades near the end)',
  'weekend-boost': 'Weekend boost (real Sat/Sun)',
}

export function createSegment({ id, name, avgBasketsPerDay = { basic: 0, rare: 0, epic: 0 }, prizeTier = 'low', activityShape = 'flat' } = {}) {
  return { id: id ?? nextId('segment'), name: name ?? 'New segment', avgBasketsPerDay, prizeTier, activityShape }
}

// Reweights a single day's basket-opening rate for a given shape - always
// averages back to 1 across the whole event for 'flat'/'weekend-boost'
// (weekend-boost raises 2 days in 7 and leaves the other 5 untouched,
// which is itself an honest modeling choice: it assumes weekend players
// open MORE, not that weekday opens get suppressed to compensate) and for
// 'ramp-up'/'taper' is a straight-line ease over the first/last few days.
// `calendar` is needed (not just `day`) because 'weekend-boost' reads the
// REAL calendar date (see calendarDateForDay above) rather than assuming
// day 1 is any particular weekday.
export function dailyActivityMultiplier(shape, calendar, day) {
  switch (shape) {
    case 'ramp-up': {
      const rampDays = Math.min(5, calendar.totalDays)
      if (day > rampDays) return 1
      return 0.4 + 0.6 * (day / rampDays)
    }
    case 'taper': {
      const taperDays = Math.min(5, calendar.totalDays)
      const daysFromEnd = calendar.totalDays - day
      if (daysFromEnd >= taperDays) return 1
      return 0.4 + 0.6 * (daysFromEnd / taperDays)
    }
    case 'weekend-boost': {
      const date = calendarDateForDay(calendar, day)
      if (!date) return 1
      const weekday = date.getDay()
      return weekday === 0 || weekday === 6 ? 1.3 : 1
    }
    case 'flat':
    default:
      return 1
  }
}

// Ingredients the business hands a player OUTSIDE the basket economy
// entirely - a direct sale bundle, or an event reward - by explicit
// economist observation ("we also sell [mid-blocker ingredients] and give
// them in events" - the simulator's own basket-RNG model alone would
// otherwise undercount how many players actually clear a mid-blocker
// dish by some point in the calendar). `coveragePct` (0-100) is the share
// of players assumed to receive this grant on `day` - not every player
// buys the bundle or completes the event, so this isn't "everyone gets
// `amount` for free on this day," it's "roll a `coveragePct` chance per
// player" - see chefSimulation.js's Monte Carlo engine for how this feeds
// into the per-day variance it reports.
export function createGrant({ id, day = 1, ingredientId, amount = 0, coveragePct = 100, label = '' } = {}) {
  return { id: id ?? nextId('grant'), day, ingredientId, amount, coveragePct, label }
}

export const PRIZE_TIERS = ['low', 'medium', 'high']
export const SEGMENT_PRIZE_MULTIPLIER = { low: 1, medium: 1.2, high: 1.5 }

export function dishPrizeValueForSegment(dish, segment) {
  const multiplier = SEGMENT_PRIZE_MULTIPLIER[segment?.prizeTier] ?? 1
  return dish.prizeValue * multiplier
}

// How much of `ingredientId` a dish's own recipe still needs, given what's
// already been collected - used by the (future) simulator, kept here since
// it's pure recipe math with no simulation state of its own.
export function recipeNeed(dish, ingredientId) {
  return dish.recipe.find((r) => r.ingredientId === ingredientId)?.count ?? 0
}

// Deleting an ingredient cascades everywhere it's referenced - mirrors
// Diamond Mine's own `removeGemEverywhere` ("no confirmation dialog,
// matching this app's existing no-confirm delete conventions" - see
// CLAUDE.md's Diamond Mine section), a GPT brainstorm review's
// "reference-aware deletion" ask resolved the way this codebase already
// resolves it elsewhere: cascade the removal rather than leave a dangling
// reference for the Validation tab to catch after the fact. Strips the
// ingredient from every dish's recipe (both lists), every basket's weight
// tables, and removes any grant that targeted it outright.
export function removeIngredientEverywhere(ingredientId, { dishes, recompletionDishes, baskets, grants }) {
  const stripRecipe = (dishList) => dishList.map((d) => ({ ...d, recipe: d.recipe.filter((r) => r.ingredientId !== ingredientId) }))
  const stripBasket = (basket) => ({
    ...basket,
    ingredientWeights: basket.ingredientWeights.filter((w) => w.ingredientId !== ingredientId),
    pricingIngredientWeights: basket.pricingIngredientWeights?.filter((w) => w.ingredientId !== ingredientId) ?? null,
  })
  return {
    dishes: stripRecipe(dishes),
    recompletionDishes: stripRecipe(recompletionDishes),
    baskets: baskets.map(stripBasket),
    grants: grants.filter((g) => g.ingredientId !== ingredientId),
  }
}
