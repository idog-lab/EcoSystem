// THE CHEF EVENT, AS DATA (schema 2 - "Chef rebuild, build 01").
//
// Plain objects made by factory functions; the screens read and write them
// directly, the engine (chefEngine.js) plays them, and nothing else knows the
// rules. One event setup is called a chef.
//
// What an event is: for about three weeks players open BASKETS that give
// INGREDIENTS, and cook DISHES when they hold what a recipe needs. Twelve
// dishes make the Main round; cooking all of them pays a grand prize and
// starts RECOMPLETION at once - three new dishes, on the same calendar, the
// same baskets and the same pantry.
//
// THREE DIFFERENT LIMITS ON AN INGREDIENT, never to be mixed up:
//   pantry cap             the most a player can HOLD. Cooking frees room.
//                          What a basket gives beyond it is lost.
//   progression threshold  how much a player may have RECEIVED in the round
//                          so far before ordinary baskets stop giving the
//                          ingredient. Cooking frees nothing. It moves with
//                          the calendar (a schedule) and is the same for
//                          every segment.
//   most a basket          the most one basket can roll of the ingredient.

export const SCHEMA_VERSION = 2

export const RARITY = {
  COMMON: 'common',
  RARE: 'rare',
  // The source sheets call this tier "Epic".
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
export const isBlocker = (ingredient) => ingredient?.rarity === RARITY.BLOCKER

export const CHEST_TYPES = ['basic', 'rare', 'epic']
export const CHEST_LABELS = { basic: 'Basic', rare: 'Rare', epic: 'Epic' }
// What a basket of each type gives, unless typed otherwise (the confirmed sizes).
export const CHEST_SIZES = { basic: [3, 5], rare: [6, 10], epic: [12, 20] }

export const ROUNDS = ['main', 'rc']
export const ROUND_LABELS = { main: 'Main', rc: 'Recompletion' }

let idCounter = 0
export function nextId(prefix) {
  idCounter += 1
  return `${prefix}-${idCounter}-${Date.now().toString(36)}`
}

// `pantryCap`: the most a player can hold (null: no limit). `sourceCap` is the
// "Cap" column of the source sheet, kept as it was read: the sheet does not
// say which of the limits it is, so nothing plays it until the economist says.
export function createIngredient({ id, name, rarity = RARITY.COMMON, pantryCap = null, sourceCap = null, art = null } = {}) {
  return { id: id ?? nextId('ingredient'), name: name ?? 'New ingredient', rarity, pantryCap, sourceCap, art }
}

// The five things a prize is made of. A reward is one amount of each (0: none
// of it; null: not known).
export const REWARD_KEYS = ['coins', 'wild', 'extraStock', 'freeRound', 'undo']
export const REWARD_LABELS = { coins: 'Coins (allowance)', wild: 'Wild', extraStock: 'Extra stock', freeRound: 'Free round', undo: 'Undo' }
export const REWARD_SHORT = { coins: 'Coins', wild: 'Wild', extraStock: 'Stock', freeRound: 'Free round', undo: 'Undo' }
export function createReward(amounts = {}) {
  return Object.fromEntries(REWARD_KEYS.map((key) => [key, amounts[key] ?? 0]))
}

// `recipe`: [{ ingredientId, count }] at the BASE segment. An ordinary or
// semi-blocker quantity is multiplied by a segment's effort factor; a blocker
// quantity is not - `blockerBySegment[segmentId][ingredientId]` holds a whole
// number typed for that segment, else the base count stands.
// `reward`: the prize at the base segment, by component (null: not known).
// `legacyWorth`: the single prize number of a chef saved before prizes had
// components - its make-up is unknown.
// `sameForAllSegments`: the dish is never scaled by effort - every segment cooks the base quantities (economist,
// 24 November 2026, of the Black Friday chef's first dish: "Yes, dish 1 never scales").
export function createDish({ id, name, recipe = [], reward = null, legacyWorth = null, blockerBySegment = {}, art = null, sameForAllSegments = false } = {}) {
  return { id: id ?? nextId('dish'), name: name ?? 'New dish', recipe, reward, legacyWorth, blockerBySegment, art, ...(sameForAllSegments ? { sameForAllSegments: true } : {}) }
}

// One basket per chest type and per odds period (phase). A weight row is
// { ingredientId, min, max, weight }: `weight` against the others (0: never in
// this basket), `max` the most one basket gives. `min` is carried from the
// game's syntax; what a minimum above 0 does in production is not known, so
// it is stored, shown and flagged, and not played.
export function createBasket({ id, chestType = 'basic', phaseId, totalMin = null, totalMax = null, ingredientWeights = [], pricingIngredientWeights = null } = {}) {
  const [min, max] = CHEST_SIZES[chestType] ?? [1, 1]
  return { id: id ?? nextId('basket'), chestType, phaseId, totalMin: totalMin ?? min, totalMax: totalMax ?? max, ingredientWeights, pricingIngredientWeights }
}

export function createPhase({ id, label, days }) {
  return { id, label, days }
}

// `phases` are the periods of basket odds, one after the other from day 1.
// `dishMaster`: the days of the Dish Master (shared by every segment); null
// days: not set.
export function createCalendar({ startDate = null, totalDays = 1, phases = [], dishMaster = null } = {}) {
  return { startDate, totalDays, phases, dishMaster: dishMaster ?? { startDay: null, endDay: null } }
}

export function calendarDateForDay(calendar, day) {
  if (!calendar?.startDate) return null
  const date = new Date(`${calendar.startDate}T00:00:00`)
  date.setDate(date.getDate() + (day - 1))
  return date
}
export function formatCalendarDate(date) {
  if (!date) return null
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
export function phaseDayRange(calendar, phaseId) {
  let cursor = 0
  for (const phase of calendar.phases) {
    const startDay = cursor + 1
    cursor += phase.days
    if (phase.id === phaseId) return { startDay, endDay: cursor }
  }
  return null
}
export function phaseForDay(calendar, day) {
  let cursor = 0
  for (const phase of calendar.phases) {
    cursor += phase.days
    if (day <= cursor) return phase
  }
  return calendar.phases[calendar.phases.length - 1] ?? null
}
export function basketsForPhase(baskets, phaseId) {
  const byChestType = {}
  for (const b of baskets) if (b.phaseId === phaseId) byChestType[b.chestType] = b
  return byChestType
}

// --- Segments -----------------------------------------------------------
//
// Everything about a segment is typed by the economist: its name, its daily
// Brut Wins range (kept for the record: nothing here turns Brut Wins into
// baskets), its effort factor (multiplies recipe quantities), its prize factor
// and burnout (their product multiplies prizes), and its basket supply.
//
// SUPPLY is what the segment opens, on average, of each basket type - either
// one average a day for the whole event, or a number of its own for every
// day. Nothing is taken off a typed average for inactivity.
export const ACTIVITY_SHAPES = ['flat', 'ramp-up', 'taper', 'weekend-boost']
export const ACTIVITY_SHAPE_LABELS = {
  flat: 'Flat',
  'ramp-up': 'Slow start',
  taper: 'Fading end',
  'weekend-boost': 'Weekend lift',
}
export function createSupply({ mode = 'average', average = { basic: 0, rare: 0, epic: 0 }, daily = null } = {}) {
  return { mode, average: { basic: 0, rare: 0, epic: 0, ...average }, daily }
}
export function createSegment({ id, name, brutWinsMin = null, brutWinsMax = null, effortFactor = 1, prizeFactor = 1, burnout = 1, supply = null, activityShape = 'flat', definition = null } = {}) {
  return { id: id ?? nextId('segment'), name: name ?? 'New segment', brutWinsMin, brutWinsMax, effortFactor, prizeFactor, burnout, supply: supply ?? createSupply(), activityShape, ...(definition ? { definition } : {}) }
}

// THE LIVE SEGMENTS (economist, 24 November 2026: "the segments we got are not the segments we are holding in the
// app" - pasted from the game's segment keys). Daily Brut Wins = 0.7 x the last 3 days' daily average + 0.3 x the
// last 14 days' (fn_DailyBrutWins_m4(3, ...) * 0.7 + fn_DailyBrutWins_m4(14, ...) * 0.3), inside A/B test 1109;
// Chef_control is everyone outside that test (asked: it is a segment here). A band's "to" is inclusive, its "from"
// exclusive (> 10 and <= 20). Only the names, ranges and definitions are given: effort, prize factor and burnout
// start at 1 and the baskets at 0, for the economist to type - nothing here is a production value.
export const BRUT_WINS_FORMULA = 'Daily Brut Wins = 0.7 x the daily average of the last 3 days + 0.3 x that of the last 14 days'
export const LIVE_SEGMENT_SET = [
  { name: 'Chef_control', min: null, max: null, definition: 'Players outside A/B test 1109 - not split by Brut Wins.' },
  { name: 'Chef_BW_0_10', min: 0, max: 10 },
  { name: 'Chef_BW_10_20', min: 10, max: 20 },
  { name: 'Chef_BW_20_40', min: 20, max: 40 },
  { name: 'Chef_BW_40_60', min: 40, max: 60 },
  { name: 'Chef_BW_60_100', min: 60, max: 100 },
  { name: 'Chef_BW_100_150', min: 100, max: 150 },
  { name: 'Chef_BW_150_240', min: 150, max: 240 },
  { name: 'Chef_BW_240_Plus', min: 240, max: null },
]
export function liveSegments() {
  return LIVE_SEGMENT_SET.map((s) =>
    createSegment({
      id: s.name.toLowerCase().replace(/_/g, '-'),
      name: s.name,
      brutWinsMin: s.min,
      brutWinsMax: s.max,
      definition: s.definition ?? `In A/B test 1109, with daily Brut Wins ${s.max == null ? `above ${s.min}` : s.min === 0 ? `of at most ${s.max}` : `above ${s.min} and at most ${s.max}`}. ${BRUT_WINS_FORMULA}.`,
    }),
  )
}

function rawShape(shape, calendar, day) {
  switch (shape) {
    case 'ramp-up': {
      const rampDays = Math.min(5, calendar.totalDays)
      return day > rampDays ? 1 : 0.4 + 0.6 * (day / rampDays)
    }
    case 'taper': {
      const taperDays = Math.min(5, calendar.totalDays)
      const fromEnd = calendar.totalDays - day
      return fromEnd >= taperDays ? 1 : 0.4 + 0.6 * (fromEnd / taperDays)
    }
    case 'weekend-boost': {
      const date = calendarDateForDay(calendar, day)
      if (!date) return 1
      const weekday = date.getDay()
      return weekday === 0 || weekday === 6 ? 1.3 : 1
    }
    default:
      return 1
  }
}
// A SHAPE ONLY MOVES BASKETS BETWEEN DAYS: its weights average exactly 1 over
// the event, so the typed average stays the segment's real average. (Before
// the rebuild a shape also changed the total: slow start -5.7%, fade -8.6%,
// weekend boost +8.6% over 21 days.)
export function shapeWeights(shape, calendar) {
  const days = Math.max(1, calendar.totalDays)
  const raw = Array.from({ length: days }, (_, i) => rawShape(shape, calendar, i + 1))
  const mean = raw.reduce((sum, v) => sum + v, 0) / days
  return raw.map((v) => (mean > 0 ? v / mean : 1))
}
// What the segment is expected to open on every day: { basic: [day 1, ...], rare, epic }.
export function expectedSupply(segment, calendar) {
  const days = Math.max(1, calendar.totalDays)
  const supply = segment.supply ?? createSupply()
  if (supply.mode === 'daily' && supply.daily) {
    return Object.fromEntries(CHEST_TYPES.map((type) => [type, Array.from({ length: days }, (_, i) => Math.max(0, Number(supply.daily[type]?.[i]) || 0))]))
  }
  const weights = shapeWeights(segment.activityShape ?? 'flat', calendar)
  return Object.fromEntries(CHEST_TYPES.map((type) => [type, weights.map((w) => Math.max(0, Number(supply.average?.[type]) || 0) * w)]))
}
export const supplyTotal = (perDay) => Object.fromEntries(CHEST_TYPES.map((type) => [type, (perDay[type] ?? []).reduce((sum, v) => sum + v, 0)]))

// --- Recipes for a segment -----------------------------------------------
//
// Ordinary and semi-blocker quantities: base x the segment's effort factor,
// rounded to the nearest whole number, never below 1 (the rounding is this
// tool's own; it is said on the screen). Blocker quantities: the number typed
// for the segment, else the base number - the effort factor never touches them.
// A BLANK quantity (`count: null`) means "this ingredient is in the recipe, the
// quantity is still to be generated" - not zero (zero is "not in the recipe").
// It stays blank for every segment; a dish with a blank is never cooked.
// A dish marked `sameForAllSegments` is cooked at its base quantities by every segment (rule 'fixed').
export const recipeIsComplete = (dish) => dish.recipe.every((r) => r.count != null)
export function recipeForSegment(dish, segment, ingredientsById) {
  const factor = dish.sameForAllSegments ? 1 : Number(segment?.effortFactor) > 0 ? Number(segment.effortFactor) : 1
  return dish.recipe
    .map((r) => {
      if (r.count == null) return { ingredientId: r.ingredientId, count: null, base: null, rule: 'blank' }
      if (isBlocker(ingredientsById[r.ingredientId])) {
        const own = dish.blockerBySegment?.[segment?.id]?.[r.ingredientId]
        return { ingredientId: r.ingredientId, count: own ?? r.count, base: r.count, rule: own != null ? 'segment' : 'base' }
      }
      return { ingredientId: r.ingredientId, count: Math.max(1, Math.round(r.count * factor)), base: r.count, rule: dish.sameForAllSegments ? 'fixed' : 'effort' }
    })
    .filter((r) => r.count == null || r.count > 0)
}
export const recipeUnits = (recipe) => recipe.reduce((sum, r) => sum + (r.count ?? 0), 0)

// --- Progression thresholds ------------------------------------------------
//
// One schedule per ingredient and round: `steps` is [{ fromDay, limit }], in
// force from that day until the next step. `limit: null` lifts the
// restriction. Before the first step there is none. The same for every
// segment.
export function createThreshold({ id, ingredientId, round = 'main', steps = null } = {}) {
  return { id: id ?? nextId('threshold'), ingredientId, round, steps: steps ?? [{ fromDay: 1, limit: 0 }] }
}
// The limit in force on a day: a number, or null when nothing restricts.
export function thresholdLimitOn(threshold, day) {
  let limit = null
  let from = -Infinity
  for (const step of threshold?.steps ?? []) {
    if (step.fromDay <= day && step.fromDay >= from) {
      from = step.fromDay
      limit = step.limit
    }
  }
  return limit
}

// --- Special sources and jokers ---------------------------------------------
//
// Something handed out besides the baskets: a sale, an event reward, a joker.
// `kind: 'ingredient'` gives `amount` of one ingredient; `kind: 'joker'` gives
// `amount` jokers. `coveragePct`: the share of the players who get it;
// `segmentIds`: the segments it is for (null: all). `bypassThreshold`: whether
// it may give an ingredient past its progression threshold - off unless set.
export const SOURCE_KINDS = ['ingredient', 'joker']
export function createSource({ id, label = '', kind = 'ingredient', day = 1, ingredientId = null, amount = 0, coveragePct = 100, segmentIds = null, bypassThreshold = false } = {}) {
  return { id: id ?? nextId('source'), label, kind, day, ingredientId, amount, coveragePct, segmentIds, bypassThreshold }
}

// --- Catch-up presets --------------------------------------------------------
//
// A player who qualifies opens the same basket and gets other contents:
// guaranteed, not drawn. It takes the place of a basket; it is not one more.
//   size      'by-total': the basket's size is rolled as always and
//             `allocations[total]` says what a basket of that size holds;
//             'fixed': the basket always holds `fixedContents`, `fixedTotal`
//             ingredients in all (inside the type's range).
//   who       `eligibility`, read at the moment the basket is opened: dishes
//             cooked in the round, an ingredient still missing for the dishes
//             left, an ingredient's receipts so far. Nothing about the future.
//   when      `startDay` to `endDay` (null: the last day), `round`,
//             `segmentIds` (null: all), at most `maxUses` times a player.
//   overlap   the lowest `priority` number first, then the order of the list.
//   fallback  when the contents cannot be given (a progression threshold, the
//             pantry): 'next' tries the next preset that fits, 'ordinary'
//             goes straight to the ordinary basket.
// A preset never gives past a progression threshold and never overfills the
// pantry: it has no permission to.
export function createPreset({ id, name = 'Catch-up', enabled = true, chestType = 'basic', round = 'main', startDay = 1, endDay = null, priority = 1, segmentIds = null, eligibility = null, maxUses = 1, sizeMode = 'by-total', allocations = {}, fixedTotal = null, fixedContents = {}, fallback = 'next' } = {}) {
  return {
    id: id ?? nextId('preset'),
    name,
    enabled,
    chestType,
    round,
    startDay,
    endDay,
    priority,
    segmentIds,
    eligibility: { dishesMin: null, dishesMax: null, missingIngredientId: null, missingMin: null, receiptsIngredientId: null, receiptsMax: null, ...(eligibility ?? {}) },
    maxUses,
    sizeMode,
    allocations,
    fixedTotal,
    fixedContents,
    fallback,
  }
}

// --- Targets -----------------------------------------------------------------
//
// `mainFuDay`: the calendar day on which `mainFuSharePct` of each segment
// should be sitting in Main FU (null: not set). `checkpoints`: "at least
// `dishes` dishes by day `day`, for `sharePct` of the players".
export function createCheckpoint({ id, day = 1, dishes = 1, sharePct = 80 } = {}) {
  return { id: id ?? nextId('checkpoint'), day, dishes, sharePct }
}
export function createTargets({ mainFuDay = null, mainFuSharePct = 80, checkpoints = [] } = {}) {
  return { mainFuDay, mainFuSharePct, checkpoints }
}

// --- Rewards -----------------------------------------------------------------
export const DEFAULT_REWARD_VALUES = { coins: 1, wild: 2.5, extraStock: 2, freeRound: 1, undo: 0.25 }
export const ITEM_ROUNDINGS = ['none', 'nearest', 'down', 'up']
export const ITEM_ROUNDING_LABELS = { none: 'Not rounded (raw targets)', nearest: 'To the nearest whole item', down: 'Down', up: 'Up' }
export function createRewards({ values = null, grandPrize = null, itemRounding = 'none', cappedFactor = 2, grandPrizeRoundTo = 5 } = {}) {
  return { values: { ...DEFAULT_REWARD_VALUES, ...(values ?? {}) }, grandPrize: { main: null, rc: null, ...(grandPrize ?? {}) }, itemRounding, cappedFactor, grandPrizeRoundTo }
}

// --- The rules that are not settled yet, as settings --------------------------
//
// Each of these is a choice the game's real behaviour has not confirmed. They
// are typed, shown beside what they change, and listed in the Simulate step.
export const THRESHOLD_POLICIES = ['before-basket', 'before-basket-inclusive', 'stop-at-threshold']
export const THRESHOLD_POLICY_LABELS = {
  'before-basket': 'Checked before each basket: stops once the limit is reached (a basket can go over)',
  'before-basket-inclusive': 'Checked before each basket: still given AT the limit (the sheet\'s "<=")',
  'stop-at-threshold': 'Stops exactly at the limit, inside a basket too',
}
export const THRESHOLD_COUNTS = ['accepted', 'attempted']
export const THRESHOLD_COUNT_LABELS = { accepted: 'What reached the pantry', attempted: 'Everything rolled, lost overflow too' }
export const COOK_TIMINGS = ['delivery', 'day-end']
export const COOK_TIMING_LABELS = { delivery: 'After every basket and every other delivery', 'day-end': 'Once, at the end of the day' }
export const COOK_ORDERS = ['list-order', 'prize-first']
export const COOK_ORDER_LABELS = { 'list-order': 'The order of the list', 'prize-first': 'The biggest prize first' }
export const JOKER_POLICIES = ['blocker-then-deficit', 'deficit']
export const JOKER_POLICY_LABELS = { 'blocker-then-deficit': 'The blocker while it is needed, then what is most missing', deficit: 'What is most missing' }
export const RECIPIENT_MODES = ['nested', 'independent']
export const RECIPIENT_LABELS = { nested: 'The same players first (a 20% source reaches part of a 50% one)', independent: 'Drawn again for every source' }
export const VARIATIONS = ['baskets', 'activity']
export const VARIATION_LABELS = { baskets: 'Basket luck only', activity: 'Player activity and basket luck' }

export function createSettings(overrides = {}) {
  return {
    thresholdPolicy: 'before-basket',
    thresholdCounts: 'accepted',
    cookTiming: 'delivery',
    cookOrder: 'list-order',
    jokerPolicy: 'blocker-then-deficit',
    jokerAmount: 10,
    jokerBlockerAmount: 1,
    recipients: 'nested',
    // How many ordinary ingredients may be paced with a threshold (kept for the
    // suggestions of a later build; nothing reads it yet).
    pacingOrdinaryIngredients: 0,
    // The design reference for the Main recipes of the base segment.
    recipeBudgetReference: 250,
    recipeBudgetDays: 21,
    // How players differ, when a run varies activity. Assumptions, not measured.
    activity: { multiplierMin: 0.4, multiplierMax: 1.6, activeShareMin: 0.55, activeShareMax: 1, persistence: 0.5 },
    ...overrides,
    ...(overrides.activity ? { activity: { multiplierMin: 0.4, multiplierMax: 1.6, activeShareMin: 0.55, activeShareMax: 1, persistence: 0.5, ...overrides.activity } } : {}),
  }
}

export function blankChefState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    ingredients: [],
    dishes: [],
    recompletionDishes: [],
    baskets: [],
    calendar: createCalendar({ startDate: null, totalDays: 21, phases: [{ id: 'phase1', label: 'Phase 1', days: 21 }] }),
    segments: [],
    thresholds: [],
    sources: [],
    presets: [],
    targets: createTargets(),
    rewards: createRewards(),
    settings: createSettings(),
    migration: null,
  }
}

// The Main recipe budget the design refers to, for this event's length.
export function recipeBudgetReference(state) {
  const { recipeBudgetReference: units = 250, recipeBudgetDays: days = 21 } = state.settings ?? {}
  return days > 0 ? Math.round((units * (state.calendar?.totalDays ?? days)) / days) : units
}

// Removing an ingredient takes it out of everything that names it.
export function removeIngredientEverywhere(ingredientId, state) {
  const stripRecipe = (list) => (list ?? []).map((d) => ({ ...d, recipe: d.recipe.filter((r) => r.ingredientId !== ingredientId) }))
  const stripContents = (contents) => Object.fromEntries(Object.entries(contents ?? {}).filter(([id]) => id !== ingredientId))
  return {
    ...state,
    ingredients: state.ingredients.filter((i) => i.id !== ingredientId),
    dishes: stripRecipe(state.dishes),
    recompletionDishes: stripRecipe(state.recompletionDishes),
    baskets: (state.baskets ?? []).map((basket) => ({
      ...basket,
      ingredientWeights: basket.ingredientWeights.filter((w) => w.ingredientId !== ingredientId),
      pricingIngredientWeights: basket.pricingIngredientWeights?.filter((w) => w.ingredientId !== ingredientId) ?? null,
    })),
    thresholds: (state.thresholds ?? []).filter((t) => t.ingredientId !== ingredientId),
    sources: (state.sources ?? []).filter((s) => s.kind !== 'ingredient' || s.ingredientId !== ingredientId),
    presets: (state.presets ?? []).map((p) => ({
      ...p,
      allocations: Object.fromEntries(Object.entries(p.allocations ?? {}).map(([total, contents]) => [total, stripContents(contents)])),
      fixedContents: stripContents(p.fixedContents),
      eligibility: {
        ...p.eligibility,
        ...(p.eligibility?.missingIngredientId === ingredientId ? { missingIngredientId: null, missingMin: null } : {}),
        ...(p.eligibility?.receiptsIngredientId === ingredientId ? { receiptsIngredientId: null, receiptsMax: null } : {}),
      },
    })),
  }
}
