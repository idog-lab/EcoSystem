// CHEF BUILD 02 - AN ECONOMY PROPOSAL (with the follow-up: new pacing
// schedules, an explicit recipe budget, the semi-blocker schedule, and only
// proved conflicts called impossible).
//
// The economist defines the event, says what may change, and asks for a
// proposal: base recipe quantities, basket weights and progression-threshold
// schedules that bring every segment closer to the targets. Nothing here
// changes the event: a proposal is a draft to review, then apply or discard.
//
// WHAT IT NEVER TOUCHES: which ingredients are in a recipe, a blocker's base
// quantity, segments (effort, prize factor, burnout), basket supply and
// activity, basket sizes, the most a basket gives, pantry caps, prizes,
// special sources and jokers, the event's days, Dish Master days, targets,
// catch-up presets, pricing odds, and every rule setting. It never adds
// baskets, players' engagement, purchases or ingredients. A weight of 0 stays
// 0 unless the economist opens it - and a basket that never gives the blocker
// is never opened to it. The blocker's dates, and its steps after the FU day,
// are left as typed: a proposal never raises Main completion by letting the
// blocker through ordinary baskets.
//
// THE RECIPE BUDGET IS THE ECONOMIST'S CHOICE. Before recipes may change, the
// economist picks: a range for the Main recipes at the base (every candidate
// stays inside it, from the first fit to the last step), or a free search that
// is labelled as such. Nothing is assumed in between.
//
// PACING. A proposal tunes the schedules that are typed and may CREATE: the
// blocker's Main schedule if there is none; the semi-blocker's (limited before
// Dish Master, a mild rise during it, lifted after - the confirmed rule); and
// schedules for ordinary ingredients the economist allows, up to the number
// typed. A new schedule must earn its place: one that does not help enough is
// removed before the check.
//
// HOW IT SEARCHES (bounded, reproducible; not a claim of the best possible):
//   1. Missing inputs, an invalid setup and conflicts that can be PROVED from
//      the inputs stop it, each said in words. What is only a risk is a
//      warning, and the search goes on.
//   2. A starting point is made from the current event (blanks filled,
//      missing schedules added, brought inside the bounds) and named as such:
//      the current event itself is only ever the event as it is.
//   3. Recipes are first fitted to what players receive by the FU day (inside
//      the budget range when there is one), then candidates are played on the
//      REAL engine on a small set of "search players" and improved a step at
//      a time. A step reads why the segment furthest from its targets misses
//      and changes what answers that; some steps are random.
//   4. The best candidate and the current event are played again on OTHER
//      players, more of them, the same ones for both. Only those figures are
//      reported. Nothing is tuned after that.
//
// WHAT COUNTS AS BETTER, in this order (no hidden score): the worst segment's
// shortfall; then all segments' shortfalls added up; then the typed
// preferences. A strong segment never hides a weak one.
import { RARITY, isBlocker, expectedSupply, phaseForDay, recipeBudgetReference, recipeForSegment, thresholdLimitOn, createThreshold, CHEST_TYPES, VARIATION_LABELS } from './chefModel'
import { ENGINE_VERSION, fingerprint, simulateSegment } from './chefEngine'
import { validateChefConfig } from './chefValidation'
import { createRng, shareInterval } from './chefRng'

// 1.1: the recipe budget is a choice; new ordinary and semi-blocker schedules; only proved conflicts stop it.
export const SEARCH_VERSION = 'chef-search 1.1'
export const CHANGE_LABELS = {
  recipes: 'Base recipe quantities',
  weights: 'Basket weights',
  thresholdAmounts: 'Threshold amounts (and new schedules)',
  thresholdDays: 'Threshold opening days',
  blockers: 'Blocker quantities by segment',
}
export const STATUS_LABELS = {
  meets: 'Meets the targets, on the players it was checked on',
  misses: 'The best proposal found still misses targets',
  'no-better': 'Nothing better than the current event was found',
  conflict: 'The targets cannot be met with these inputs',
  invalid: 'The setup has to be fixed before a proposal can be generated',
  inputs: 'Something is missing before a proposal can be generated',
  cancelled: 'Stopped before it was checked',
  incomplete: 'Stopped while it was being checked',
}
export const BUDGET_MODES = {
  bounded: 'Within a range I type',
  free: 'Explore freely',
}

// The controls of a generation. Every number that is not the economist's is a
// convenience default of this tool, and the screen says so. The budget mode has
// NO default: it is chosen on screen before recipes may change.
export function createPlan(state, overrides = {}) {
  const plan = {
    rounds: 'main',
    change: { recipes: true, weights: true, thresholdAmounts: true, thresholdDays: false, blockers: false },
    // dishes[round|dishId], cells[round|dishId|ingredientId], weights[basketId|ingredientId], thresholds[id]: true = locked.
    // open[basketId|ingredientId]: true = a weight of 0 that may be given a weight (never the blocker's).
    locks: { dishes: {}, cells: {}, weights: {}, thresholds: {}, open: {} },
    segmentIds: null,
    tolerancePts: 0,
    // mode: 'bounded' | 'free' | null (not chosen). min/max: the range of the Main recipes at the base, all of
    // their ingredients (blockers and semi-blockers too). rcMin/rcMax: Recompletion's own, optional.
    budget: { mode: null, target: null, min: null, max: null, rcMin: null, rcMax: null },
    quantity: { min: 1, max: null },
    // The most a weight may grow: so many times what it is (a weight of 0 that was opened: up to the basket's largest).
    weight: { maxFactor: 8 },
    // maxOrdinary: ordinary ingredients with a schedule, existing and new together. excluded[id]: may not be
    // GIVEN a new schedule (an existing schedule is locked with locks.thresholds instead). dayOptions: the days
    // a new schedule may step on while opening days may not change.
    pacing: { maxOrdinary: state?.settings?.pacingOrdinaryIngredients ?? 0, maxSteps: 5, dayMin: 1, dayMax: null, excluded: {}, dayOptions: [] },
    // The semi-blocker: allow = it may be given a schedule when it has none. early*: the limit before Dish
    // Master; dm*: during it. maxEarlyPct: a target, typed or not at all - the share of players who may have
    // cooked one of its dishes before Dish Master begins.
    semi: { allow: true, earlyMin: null, earlyMax: null, dmMin: null, dmMax: null, maxEarlyPct: null },
    shortage: { preferred: 3, min: null, max: null },
    gap: { maxDays: null, maxSharePct: null },
    rc: { daysToFu: null, sharePct: null },
    // schedule: what one more ordinary schedule costs among the preferences (only used between candidates that
    // meet the targets equally well).
    weights: { budget: 1, shortage: 0.5, waste: 0.5, change: 0.5, schedule: 0.05 },
    // (`aimPts`: while searching, a target counts as met only this many points ABOVE it, so that the check on
    // other players has room. It is not used in that check, nor in anything reported.)
    search: { players: 100, validationPlayers: 400, candidates: 60, patience: 25, seconds: 180, seed: 2026, variation: 'activity', aimPts: 3 },
  }
  const merge = (base, extra) => {
    for (const [key, value] of Object.entries(extra ?? {})) {
      if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) merge(base[key], value)
      else base[key] = value
    }
    return base
  }
  return merge(plan, overrides)
}

// The controls in force for a chef: what was typed, over the defaults.
export const planOf = (state) => createPlan(state, state?.generator?.plan ?? {})
export const planKeyOf = (plan) => JSON.stringify(plan)

const clone = (value) => JSON.parse(JSON.stringify(value))
const pickParts = (state) => clone({ dishes: state.dishes, recompletionDishes: state.recompletionDishes, baskets: state.baskets, thresholds: state.thresholds })
const listOf = (parts, round) => (round === 'main' ? parts.dishes : parts.recompletionDishes)
export const cellKey = (round, dishId, ingredientId) => `${round}|${dishId}|${ingredientId}`
export const weightKey = (basketId, ingredientId) => `${basketId}|${ingredientId}`
const sum = (values) => values.reduce((s, v) => s + v, 0)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const factorOf = (segment) => (Number(segment?.effortFactor) > 0 ? Number(segment.effortFactor) : 1)
const isOrdinary = (ing) => ing?.rarity === RARITY.COMMON || ing?.rarity === RARITY.RARE
const isSemi = (ing) => ing?.rarity === RARITY.SEMI_BLOCKER

// Everything a generation needs to know about the event, worked out once.
function context(state, plan) {
  const byId = Object.fromEntries(state.ingredients.map((i) => [i.id, i]))
  const segments = state.segments.filter((s) => !plan.segmentIds || plan.segmentIds.includes(s.id))
  const totalDays = state.calendar.totalDays
  const fuDay = state.targets?.mainFuDay ?? null
  const checkpoints = (state.targets?.checkpoints ?? []).filter((c) => c.day >= 1 && c.day <= totalDays)
  const rounds = plan.rounds === 'both' ? ['main', 'rc'] : [plan.rounds]
  // Recompletion has no approved speed: its values are searched only when a target for it was typed.
  const rcTargeted = plan.rc.daysToFu != null && plan.rc.sharePct != null
  const dm = state.calendar.dishMaster ?? {}
  const dayMin = Math.max(1, plan.pacing.dayMin ?? 1)
  const dayMax = Math.min(totalDays, plan.pacing.dayMax ?? totalDays)
  const dayOptions = [...new Set((plan.pacing.dayOptions ?? []).map(Number).filter((d) => Number.isInteger(d) && d > 1 && d <= totalDays))].sort((a, b) => a - b)
  const range = []
  for (let d = Math.max(2, dayMin); d <= dayMax; d += 1) range.push(d)
  return {
    byId,
    segments,
    totalDays,
    fuDay,
    checkpoints,
    blockers: state.ingredients.filter(isBlocker),
    semis: state.ingredients.filter(isSemi),
    ordinary: state.ingredients.filter(isOrdinary),
    rounds,
    freeRounds: rounds.filter((r) => r === 'main' || rcTargeted),
    rcTargeted,
    dm: dm.startDay != null && dm.endDay != null ? { start: dm.startDay, end: dm.endDay } : null,
    tolerance: (Number(plan.tolerancePts) || 0) / 100,
    probeDays: [...new Set([fuDay, ...checkpoints.map((c) => c.day)].filter((d) => d != null))],
    gapLimit: plan.gap.maxDays != null && plan.gap.maxSharePct != null ? plan.gap.maxDays : null,
    rcFuWithin: rcTargeted ? plan.rc.daysToFu : null,
    reference: recipeBudgetReference(state),
    budgetTarget: plan.budget.target ?? recipeBudgetReference(state),
    bounded: plan.change.recipes && plan.budget.mode === 'bounded' && plan.budget.min != null && plan.budget.max != null,
    dayMin,
    dayMax,
    // The days a NEW ordinary schedule may step on (day 1, the event's first day, is where every schedule begins).
    newDays: plan.change.thresholdDays ? range : dayOptions,
    variation: plan.search.variation ?? 'activity',
  }
}

// How each target is read, in words (shown before generating and with every result).
export function describeTargets(state, plan) {
  const ctx = context(state, plan)
  const tol = plan.tolerancePts > 0 ? `, ${plan.tolerancePts} points allowed below` : ''
  const lines = []
  if (ctx.fuDay != null) lines.push({ id: 'fu', text: `On day ${ctx.fuDay}, ${state.targets.mainFuSharePct}% of the players of each segment sitting in FU${tol}. Counted: players in FU at the end of that day - not those who finished, not those who were in FU earlier, not an average of dishes.` })
  for (const c of ctx.checkpoints) lines.push({ id: c.id, text: `By day ${c.day}, ${c.sharePct}% of the players of each segment with at least ${c.dishes} Main dishes${tol}. Counted: the share of players, not the average number of dishes.` })
  if (ctx.gapLimit != null) lines.push({ id: 'gap', text: `At most ${plan.gap.maxSharePct}% of the players of each segment go more than ${plan.gap.maxDays} days without a Main dish.` })
  if (ctx.rcTargeted) lines.push({ id: 'rc', text: `Of the players who enter Recompletion, ${plan.rc.sharePct}% are in its FU within ${plan.rc.daysToFu} days of entering.` })
  if (plan.semi.maxEarlyPct != null && ctx.dm) lines.push({ id: 'semi-early', text: `At most ${plan.semi.maxEarlyPct}% of the players of each segment cook a dish that needs the semi-blocker before Dish Master begins (day ${ctx.dm.start}).` })
  return lines
}

const baseMainTotal = (parts) => sum(parts.dishes.map((d) => sum(d.recipe.map((r) => r.count ?? 0))))
const baseRcTotal = (parts) => sum(parts.recompletionDishes.map((d) => sum(d.recipe.map((r) => r.count ?? 0))))
const blockerNeeds = (parts, blockerId) => parts.dishes.map((d) => d.recipe.find((r) => r.ingredientId === blockerId)?.count ?? 0).filter((n) => n > 0)
// ...and for one segment (a blocker quantity can be typed, or proposed, for a segment of its own).
const blockerNeedsOf = (parts, blockerId, segment) => parts.dishes.map((d) => (d.recipe.some((r) => r.ingredientId === blockerId) ? (d.blockerBySegment?.[segment.id]?.[blockerId] ?? d.recipe.find((r) => r.ingredientId === blockerId).count ?? 0) : 0)).filter((n) => n > 0)
// To be in FU a player has cooked every dish but one: the threshold has to let through all the blocker dishes but the largest.
const lowestLimitFor = (needs) => sum(needs) - Math.max(...needs)
// What the Main dishes of a segment need of an ingredient, in all.
const needOf = (parts, ingredientId, segment, byId) => sum(parts.dishes.map((d) => recipeForSegment(d, segment, byId).find((r) => r.ingredientId === ingredientId)?.count ?? 0))
const mainScheduleOf = (parts, ingredientId) => parts.thresholds.find((t) => t.round === 'main' && t.ingredientId === ingredientId) ?? null
const ordinaryPacedIds = (parts, ctx) => [...new Set(parts.thresholds.filter((t) => isOrdinary(ctx.byId[t.ingredientId])).map((t) => t.ingredientId))]
const isNewSchedule = (state, t) => !state.thresholds.some((x) => x.id === t.id)

// The largest base quantity of an ingredient that fits its pantry at every segment's size.
function capCountFor(ctx, ingredientId) {
  const cap = ctx.byId[ingredientId]?.pantryCap
  if (cap == null) return Infinity
  let n = cap
  while (n > 1 && Math.max(...ctx.segments.map((s) => Math.max(1, Math.round(n * factorOf(s))))) > cap) n -= 1
  return n
}

// --- What may change ---------------------------------------------------------

// A cell the proposal may set: an ordinary or semi-blocker quantity, recipes allowed to change, not locked.
// (A blank in a locked dish is NOT free: it is an unresolved input, said before anything runs.)
function freeCells(state, parts, plan, ctx) {
  if (!plan.change.recipes) return []
  const cells = []
  for (const round of ctx.freeRounds) {
    listOf(parts, round).forEach((dish, dishIndex) => {
      if (plan.locks.dishes[`${round}|${dish.id}`]) return
      dish.recipe.forEach((r, rowIndex) => {
        if (isBlocker(ctx.byId[r.ingredientId]) || plan.locks.cells[cellKey(round, dish.id, r.ingredientId)]) return
        cells.push({ round, dishIndex, rowIndex, ingredientId: r.ingredientId, blank: listOf(state, round)[dishIndex]?.recipe[rowIndex]?.count == null })
      })
    })
  }
  return cells
}
// A weight that may change. A weight of 0 only when the economist opened it, and never the blocker's.
function freeWeights(parts, plan, ctx) {
  if (!plan.change.weights) return []
  const rows = []
  parts.baskets.forEach((basket, basketIndex) => {
    basket.ingredientWeights.forEach((w, rowIndex) => {
      const key = weightKey(basket.id, w.ingredientId)
      if (plan.locks.weights[key] || !(w.max > 0)) return
      if (w.weight > 0 || (plan.locks.open[key] && !isBlocker(ctx.byId[w.ingredientId]))) rows.push({ basketIndex, rowIndex, ingredientId: w.ingredientId })
    })
  })
  return rows
}
// The limits and days that may move. The blocker's days never move, nor its steps after the FU day; a new
// semi-blocker schedule keeps the Dish Master days; a new ordinary schedule's days move only as allowed.
function freeSteps(state, parts, plan, ctx) {
  const limits = []
  const days = []
  parts.thresholds.forEach((t, thresholdIndex) => {
    if (plan.locks.thresholds[t.id] || !ctx.freeRounds.includes(t.round)) return
    const ing = ctx.byId[t.ingredientId]
    const fresh = isNewSchedule(state, t)
    t.steps.forEach((step, stepIndex) => {
      const afterFu = isBlocker(ing) && ctx.fuDay != null && step.fromDay > ctx.fuDay
      if (plan.change.thresholdAmounts && step.limit != null && !afterFu) limits.push({ thresholdIndex, stepIndex, ingredientId: t.ingredientId, round: t.round })
      if (plan.change.thresholdDays && step.fromDay > 1 && !isBlocker(ing) && !(fresh && isSemi(ing))) days.push({ thresholdIndex, stepIndex, ingredientId: t.ingredientId, round: t.round })
    })
  })
  return { limits, days }
}
function freeBlockers(parts, plan, ctx) {
  if (!plan.change.blockers) return []
  const cells = []
  for (const round of ctx.freeRounds) {
    listOf(parts, round).forEach((dish, dishIndex) => {
      for (const r of dish.recipe) {
        if (!isBlocker(ctx.byId[r.ingredientId]) || plan.locks.dishes[`${round}|${dish.id}`]) continue
        for (const segment of ctx.segments) cells.push({ round, dishIndex, ingredientId: r.ingredientId, segmentId: segment.id, base: r.count })
      }
    })
  }
  return cells
}
// Ordinary ingredients that may still be given a new schedule, and how many more may be.
function pacingRoom(parts, plan, ctx) {
  const used = ordinaryPacedIds(parts, ctx).length
  const room = plan.change.thresholdAmounts ? Math.max(0, (plan.pacing.maxOrdinary ?? 0) - used) : 0
  const candidates = ctx.ordinary.filter((i) => !plan.pacing.excluded?.[i.id] && !mainScheduleOf(parts, i.id) && parts.dishes.some((d) => d.recipe.some((r) => r.ingredientId === i.id)))
  return { room: ctx.newDays.length ? room : 0, candidates, used }
}

// --- What stops a generation ------------------------------------------------

// MISSING INPUTS: what has to be typed or chosen before anything can run (plain sentences).
export function inputProblems(state, plan) {
  const ctx = context(state, plan)
  const problems = []
  if (ctx.segments.length === 0) problems.push('No segment is selected (step 1).')
  if (state.dishes.length === 0) problems.push('There are no Main dishes (step 2).')
  if (describeTargets(state, plan).length === 0) problems.push('No target is set, so there is nothing to aim at: type the FU day or a checkpoint (step 1).')
  if (!Object.values(plan.change).some(Boolean)) problems.push('Nothing is allowed to change: switch on at least one of the things a proposal may change.')
  if (plan.change.recipes && plan.budget.mode !== 'bounded' && plan.budget.mode !== 'free') problems.push('Choose how the Main recipe budget is treated (Recipe budget, above): kept within a range you type, or explored freely.')
  if (plan.change.recipes && plan.budget.mode === 'bounded' && (plan.budget.min == null || plan.budget.max == null)) problems.push('Type both ends of the Main recipe budget range, or choose to explore freely.')
  // Blank quantities: generated only where recipes may change and the cell is free.
  const free = new Set(freeCells(state, pickParts(state), plan, ctx).map((c) => cellKey(c.round, listOf(state, c.round)[c.dishIndex].id, c.ingredientId)))
  for (const round of ['main', 'rc']) {
    for (const dish of listOf(state, round)) {
      for (const r of dish.recipe) {
        if (r.count != null) continue
        const name = ctx.byId[r.ingredientId]?.name ?? '?'
        const where = `${dish.name}${round === 'rc' ? ' (Recompletion)' : ''}`
        if (free.has(cellKey(round, dish.id, r.ingredientId))) continue
        if (isBlocker(ctx.byId[r.ingredientId])) problems.push(`${where}: the quantity of ${name} is blank. A blocker quantity is yours to type (step 2); a proposal never sets it.`)
        else if (!plan.change.recipes) problems.push(`${where}: the quantity of ${name} is blank, and recipe quantities are not allowed to change. Type it, or allow the change.`)
        else if (round === 'rc' && !ctx.freeRounds.includes('rc')) problems.push(`${where}: the quantity of ${name} is blank. Recompletion's recipes are changed only with a target for it (Bounds), so type it in step 2 or set that target.`)
        else problems.push(`${where}: the quantity of ${name} is blank and it is locked. A locked blank is not filled in: unlock it, or type the number (step 2).`)
      }
    }
  }
  if (ctx.fuDay != null) {
    const mainBlockers = ctx.blockers.filter((b) => blockerNeeds(state, b.id).length > 0)
    if (mainBlockers.length === 0) problems.push('No Main dish needs a blocker, so no player can sit in FU: the FU target cannot be read.')
    for (const b of mainBlockers) {
      if (!mainScheduleOf(state, b.id) && !plan.change.thresholdAmounts) problems.push(`${b.name} has no progression threshold in the Main round and threshold amounts are not allowed to change: nobody can sit in FU.`)
    }
  }
  return problems
}

// AN INVALID SETUP: inputs that are there but cannot be used as they are.
export function configurationProblems(state, plan) {
  const ctx = context(state, plan)
  const problems = []
  for (const f of validateChefConfig(state)) if (f.severity === 'block' && f.code !== 'blank-quantity') problems.push(f.message)
  if (state.baskets.some((b) => b.ingredientWeights.some((w) => (w.min ?? 0) > 0))) problems.push('A basket has a minimum above 0 for an ingredient. What that does in the game is not known and it is not played, so a proposal would rest on a basket that does not exist: set it to 0 first (step 3).')
  const paced = ordinaryPacedIds(state, ctx)
  if (paced.length > (plan.pacing.maxOrdinary ?? 0)) problems.push(`${paced.length} ordinary ${paced.length === 1 ? 'ingredient has' : 'ingredients have'} a progression threshold already (${paced.map((id) => ctx.byId[id]?.name).join(', ')}), and the most allowed is ${plan.pacing.maxOrdinary ?? 0}. Existing and new schedules count together.`)
  const long = state.thresholds.filter((t) => (t.steps ?? []).length > plan.pacing.maxSteps)
  if (long.length) problems.push(`${long.map((t) => ctx.byId[t.ingredientId]?.name ?? '?').join(', ')}: more steps than the ${plan.pacing.maxSteps} allowed for a schedule.`)
  const pair = (lo, hi, what) => lo != null && hi != null && lo > hi && problems.push(`${what}: the lower bound (${lo}) is above the upper one (${hi}).`)
  pair(plan.semi.earlyMin, plan.semi.earlyMax, 'The semi-blocker limit before Dish Master')
  pair(plan.semi.dmMin, plan.semi.dmMax, 'The semi-blocker limit during Dish Master')
  pair(plan.quantity.min, plan.quantity.max, 'A quantity in a recipe')
  pair(plan.budget.rcMin, plan.budget.rcMax, 'The Recompletion recipe budget')
  if (plan.change.recipes && plan.budget.mode === 'bounded' && plan.budget.min != null && plan.budget.max != null) {
    if (plan.budget.min > plan.budget.max) problems.push(`The Main recipe budget: the lower end (${plan.budget.min}) is above the upper one (${plan.budget.max}).`)
    else {
      // Whether ANY recipe inside the locks, the quantity bounds and the pantry caps can land in the range.
      const parts = pickParts(state)
      const cells = freeCells(state, parts, plan, ctx).filter((c) => c.round === 'main')
      const freeKeys = new Set(cells.map((c) => `${c.dishIndex}|${c.rowIndex}`))
      let fixed = 0
      parts.dishes.forEach((d, i) => d.recipe.forEach((r, k) => !freeKeys.has(`${i}|${k}`) && (fixed += r.count ?? 0)))
      const qMin = plan.quantity.min ?? 1
      const lowest = fixed + cells.length * qMin
      const highest = fixed + sum(cells.map((c) => Math.min(plan.quantity.max ?? Infinity, capCountFor(ctx, c.ingredientId))))
      if (lowest > plan.budget.max) problems.push(`No Main recipe can be ${plan.budget.max} or less: what is locked or never changed (blockers included) comes to ${fixed}, and the ${cells.length} free quantities are at least ${qMin} each - ${lowest} in all. Widen the range or unlock quantities; it is never widened by itself.`)
      if (highest < plan.budget.min) problems.push(`No Main recipe can reach ${plan.budget.min}: with the locked quantities (${fixed}) and every free quantity at the most its pantry and the quantity bound allow, the Main recipes come to ${highest}. Widen the range or unlock quantities; it is never widened by itself.`)
    }
  }
  return problems
}

// The most a player of a segment can have received by a day - of anything, or of one ingredient. An upper
// bound that no player can pass under the supply model in force (used for proofs only):
//   baskets      every basket the segment can open at its largest; one more basket than the expected count
//                (whole baskets: 'basket luck' rounds the running total from a start below 1; 'activity'
//                opens at most the day's expectation x the largest multiplier / the smallest active share,
//                rounded up, on every day);
//   one row      an ingredient: the most its row allows in a basket that gives it (weight above 0 - a proposal
//                never opens a blocker row), or the most a catch-up preset of that basket type holds of it;
//   sources      every special source in full, a joker as its three ingredients in full.
function maxUnitsBy(state, segment, day, variation, ingredientId = null, openable = () => false) {
  const supply = expectedSupply(segment, state.calendar)
  const a = state.settings?.activity ?? {}
  const boost = variation === 'activity' ? (Number(a.multiplierMax ?? 1.6) / ((Number(a.multiplierMin ?? 0.4) + Number(a.multiplierMax ?? 1.6)) / 2)) / Math.max(0.01, Number(a.activeShareMin ?? 0.55)) : 1
  const presetMost = (type) =>
    Math.max(
      0,
      ...(state.presets ?? [])
        .filter((p) => p.enabled !== false && p.chestType === type && (!p.segmentIds || p.segmentIds.includes(segment.id)))
        .flatMap((p) => [p.fixedContents ?? {}, ...Object.values(p.allocations ?? {})])
        .map((contents) => (ingredientId == null ? sum(Object.values(contents).map((n) => Math.max(0, Number(n) || 0))) : Math.max(0, Number(contents[ingredientId]) || 0))),
    )
  const perBasket = (basket) => {
    if (ingredientId == null) return basket.totalMax
    const row = basket.ingredientWeights.find((w) => w.ingredientId === ingredientId)
    return row && (row.weight > 0 || openable(basket, row)) ? Math.min(row.max ?? 0, basket.totalMax) : 0
  }
  let units = 0
  for (const type of CHEST_TYPES) {
    const biggest = Math.max(0, presetMost(type), ...state.baskets.filter((b) => b.chestType === type).map(perBasket))
    // (A type the segment never opens gives nothing; otherwise one more basket than the expected count, a day or in all.)
    if (variation === 'activity') for (let d = 0; d < day; d += 1) units += supply[type][d] > 0 ? (Math.floor(supply[type][d] * boost) + 1) * biggest : 0
    else units += sum(supply[type].slice(0, day)) > 0 ? (Math.floor(sum(supply[type].slice(0, day)) + 1e-9) + 1) * biggest : 0
  }
  const jokerAmount = state.settings?.jokerAmount ?? 10
  const jokerBlocker = state.settings?.jokerBlockerAmount ?? 1
  for (const s of state.sources ?? []) {
    if (s.day > day || (s.segmentIds && !s.segmentIds.includes(segment.id))) continue
    if (s.kind === 'joker') units += Math.max(0, s.amount) * (ingredientId == null ? 3 * Math.max(jokerAmount, jokerBlocker) : isBlocker(state.ingredients.find((i) => i.id === ingredientId)) ? jokerBlocker : jokerAmount)
    else if (ingredientId == null || s.ingredientId === ingredientId) units += Math.max(0, s.amount)
  }
  return units
}

// PROVED CONFLICTS: each holds for EVERY event a proposal may make under the locks and bounds in force, and
// says its assumptions and numbers. What is only a risk is a warning instead (`searchWarnings`).
export function structuralConflicts(state, plan) {
  const ctx = context(state, plan)
  const conflicts = []
  if (ctx.fuDay == null) return conflicts
  const target = state.targets.mainFuSharePct / 100 - ctx.tolerance
  if (!(target > 0)) return conflicts
  const supplyWords = ctx.variation === 'activity' ? 'the most active player the activity settings allow (step 1)' : 'one basket more than the segment is expected to open'
  for (const blocker of ctx.blockers) {
    if (blockerNeeds(state, blocker.id).length === 0) continue
    const t = mainScheduleOf(state, blocker.id)
    // 1. Lifted on the FU day: the engine reads a player waiting for a blocker that is not held back as NOT in FU,
    //    and a proposal never turns a lifted step back into a limit, nor moves the blocker's days.
    if (t && thresholdLimitOn(t, ctx.fuDay) == null) {
      conflicts.push({
        id: 'blocker-lifted',
        text: `On day ${ctx.fuDay} ${blocker.name} is no longer held back by its threshold (from day ${[...t.steps].reverse().find((s) => s.fromDay <= ctx.fuDay)?.fromDay}). In FU means the last dish lacks only blockers AND the threshold in force has been reached; with no threshold in force nobody is in FU, so every segment is at 0% against ${state.targets.mainFuSharePct}%.`,
        assumptions: ['A proposal never moves the blocker\'s days and never turns a lifted step back into a limit.', 'The rule of FU is the engine\'s (section 3 of the briefing).'],
      })
    }
    // 2. Even the luckiest player cannot have received enough of the blocker by the FU day.
    for (const segment of ctx.segments) {
      // (A dish whose blocker quantity may change for a segment is counted at 1, the least it can be.)
      const needs = state.dishes
        .filter((d) => d.recipe.some((r) => r.ingredientId === blocker.id))
        .map((d) => (plan.change.blockers && !plan.locks.dishes[`main|${d.id}`] ? 1 : (d.blockerBySegment?.[segment.id]?.[blocker.id] ?? d.recipe.find((r) => r.ingredientId === blocker.id).count ?? 0)))
        .filter((n) => n > 0)
      if (!needs.length) continue
      const amountsFree = plan.change.thresholdAmounts && !(t && plan.locks.thresholds[t.id])
      const limitNow = t ? thresholdLimitOn(t, ctx.fuDay) : null
      const needed = amountsFree ? lowestLimitFor(needs) : Math.max(limitNow ?? 0, lowestLimitFor(needs))
      const most = maxUnitsBy(state, segment, ctx.fuDay, ctx.variation, blocker.id)
      if (needed > 0 && most < needed) {
        conflicts.push({
          id: `blocker-${segment.id}`,
          text: `${segment.name}: to be in FU on day ${ctx.fuDay} a player has cooked every Main dish but one, so has received at least ${needed} ${blocker.name}${amountsFree ? '' : ` (and reached the threshold of ${limitNow})`}. By that day the most any player of this segment can have received is ${most}: every basket that gives it at its largest, ${supplyWords}, every source and joker in full. No player of it can be in FU, against a target of ${state.targets.mainFuSharePct}%.`,
          assumptions: ['Baskets are not added, and the most a basket gives is not changed.', 'A proposal never opens a basket that gives 0 of the blocker.', plan.change.blockers ? 'Blocker quantities by segment may change: counted as low as 1 a dish.' : 'Blocker quantities are as typed.'],
        })
      }
    }
  }
  // 3. A Main dish that, at a segment's size, needs more of an ordinary or semi-blocker ingredient than the pantry
  //    can hold, at the smallest quantity a proposal may set: a player can never hold all of it, so that dish is
  //    never cooked and, missing more than blockers, never the last dish of FU either.
  const free = new Set(freeCells(state, pickParts(state), plan, ctx).map((c) => cellKey(c.round, listOf(state, c.round)[c.dishIndex].id, c.ingredientId)))
  for (const dish of state.dishes) {
    for (const segment of ctx.segments) {
      for (const r of dish.recipe) {
        const ing = ctx.byId[r.ingredientId]
        const isFree = free.has(cellKey('main', dish.id, r.ingredientId))
        if (isBlocker(ing) || ing?.pantryCap == null || (r.count == null && !isFree)) continue
        const smallest = isFree ? (plan.quantity.min ?? 1) : r.count
        const atSize = Math.max(1, Math.round(smallest * (dish.sameForAllSegments ? 1 : factorOf(segment))))
        if (atSize <= ing.pantryCap) continue
        conflicts.push({
          id: `pantry-${segment.id}-${dish.id}-${r.ingredientId}`,
          text: `${segment.name}: ${dish.name} needs ${atSize} ${ing.name} at that segment's size${isFree ? ` even at the smallest quantity allowed (${smallest})` : ''}, and the pantry holds ${ing.pantryCap}. That dish can never be cooked, and as it lacks more than blockers it can never be the last dish of FU: no player of this segment can be in FU.`,
          assumptions: [isFree ? 'The quantity may change, but not below the lower bound typed.' : 'The quantity is locked or may not change.', 'A pantry cap is never raised by a proposal.'],
        })
      }
    }
  }
  // 4. Locked recipes asking for more than any player can have received by the FU day (FU needs every ordinary and
  //    semi-blocker ingredient of every Main dish: cooked, or held for the last one).
  if (!plan.change.recipes) {
    for (const segment of ctx.segments) {
      const need = sum(state.dishes.map((d) => sum(recipeForSegment(d, segment, ctx.byId).filter((r) => !isBlocker(ctx.byId[r.ingredientId])).map((r) => r.count ?? 0))))
      const most = maxUnitsBy(state, segment, ctx.fuDay, ctx.variation)
      if (need > most) {
        conflicts.push({
          id: `supply-${segment.id}`,
          text: `${segment.name}: FU needs every ordinary and semi-blocker ingredient of the Main dishes - ${need} at this segment's size. By day ${ctx.fuDay} the most any player of it can have received of all ingredients together is ${most} (every basket at its largest, ${supplyWords}, every source and joker in full). No player of it can be in FU.`,
          assumptions: ['Recipe quantities may not change.', 'Baskets are not added and basket sizes are not changed.'],
        })
      }
    }
  }
  return conflicts
}

// RISKS AND NOTES: said on screen, never a reason to stop.
export function searchWarnings(state, plan) {
  const ctx = context(state, plan)
  const warnings = []
  // A special source that gives the blocker past its threshold. It does NOT prove a share of players finishes or
  // leaves FU: what it gives counts toward the threshold, so baskets may then give less of it; a player may still lack
  // ordinary ingredients; and when it comes matters. The run measures it.
  for (const blocker of ctx.blockers) {
    for (const s of state.sources ?? []) {
      if (s.kind !== 'ingredient' || s.ingredientId !== blocker.id || !s.bypassThreshold) continue
      warnings.push({ id: `bypass-${s.id}`, text: `${s.label || 'A special source'} gives ${s.amount} ${blocker.name} past its threshold to ${s.coveragePct}% of the players on day ${s.day}. That does not by itself take them out of FU or finish them: it counts toward the threshold, and they may still lack other ingredients. Its effect is measured in every run, not assumed.` })
    }
  }
  for (const semi of ctx.semis) {
    const used = state.dishes.filter((d) => d.recipe.some((r) => r.ingredientId === semi.id)).length
    if (!used) continue
    const t = mainScheduleOf(state, semi.id)
    if (!t && plan.semi.allow && plan.change.thresholdAmounts && !ctx.dm) warnings.push({ id: 'semi-no-dm', text: `${semi.name} has no schedule, and no Dish Master days are set (step 1): its schedule follows Dish Master, so none can be made.` })
    if (!t && (!plan.semi.allow || !plan.change.thresholdAmounts)) warnings.push({ id: 'semi-none', text: `${semi.name} has no schedule and none will be made (${!plan.change.thresholdAmounts ? 'threshold amounts may not change' : 'it is not allowed to be given one'}): its dishes can be cooked as soon as players have its ingredients, before Dish Master too.` })
    if (t && ctx.dm) {
      const liftedAfter = thresholdLimitOn(t, ctx.dm.end + 1) == null || ctx.dm.end >= ctx.totalDays
      const fixed = plan.locks.thresholds[t.id] || !plan.change.thresholdDays
      if (!liftedAfter && fixed) warnings.push({ id: 'semi-not-lifted', text: `${semi.name}'s schedule still restricts after Dish Master ends (day ${ctx.dm.end}). The confirmed rule lifts it then; its days are ${plan.locks.thresholds[t.id] ? 'locked' : 'not allowed to change'}, so a proposal keeps it as typed.` })
    }
  }
  const { candidates, used } = pacingRoom(pickParts(state), plan, ctx)
  const room = plan.change.thresholdAmounts ? Math.max(0, (plan.pacing.maxOrdinary ?? 0) - used) : 0
  if (room > 0 && ctx.newDays.length === 0) warnings.push({ id: 'pacing-no-days', text: `Up to ${room} more ordinary ${room === 1 ? 'ingredient' : 'ingredients'} may be paced, but opening days may not change and no days are typed for a new schedule to step on (Pacing), so none can be made.` })
  if (room > 0 && ctx.newDays.length && candidates.length === 0) warnings.push({ id: 'pacing-none', text: `Up to ${room} more ordinary ${room === 1 ? 'ingredient' : 'ingredients'} may be paced, but every one is excluded or already has a schedule.` })
  if (used > 0 && room === 0 && plan.change.thresholdAmounts && candidates.length) warnings.push({ id: 'pacing-full', text: `The ${used} ordinary ${used === 1 ? 'schedule that exists uses' : 'schedules that exist use'} the whole allowance of ${plan.pacing.maxOrdinary}: no new one will be made.` })
  // No basket gives the semi-blocker on any day of Dish Master (its weight is 0 in every period that covers it, and
  // nothing was opened): its dishes cannot progress during Dish Master, whatever the schedule says.
  if (ctx.dm) {
    for (const semi of ctx.semis) {
      if (!state.dishes.some((d) => d.recipe.some((r) => r.ingredientId === semi.id))) continue
      let gives = false
      for (let d = ctx.dm.start; d <= ctx.dm.end && !gives; d += 1) {
        const phase = phaseForDay(state.calendar, d)
        gives = state.baskets.some((b) => b.phaseId === phase?.id && b.ingredientWeights.some((w) => w.ingredientId === semi.id && w.max > 0 && (w.weight > 0 || (plan.change.weights && plan.locks.open[weightKey(b.id, semi.id)]))))
      }
      if (!gives) warnings.push({ id: 'semi-no-supply', text: `No basket gives ${semi.name} during Dish Master (day ${ctx.dm.start} to ${ctx.dm.end}): its weight is 0 in every basket of the odds period that covers those days. Its dishes cannot progress during Dish Master, whatever its schedule says - open it in a basket of that period (Locks) to let a proposal give it a weight, or change the weights in step 3.` })
    }
  }
  const openedBlockers = Object.keys(plan.locks.open ?? {}).filter((key) => isBlocker(ctx.byId[key.split('|')[1]]))
  if (openedBlockers.length) warnings.push({ id: 'blocker-opened', text: `${openedBlockers.length} basket ${openedBlockers.length === 1 ? 'row' : 'rows'} of the blocker with a weight of 0 ${openedBlockers.length === 1 ? 'was' : 'were'} opened in an earlier session. A proposal no longer opens the blocker in a basket that never gives it, so ${openedBlockers.length === 1 ? 'it stays' : 'they stay'} at 0.` })
  return warnings
}

// How much of the semi-blocker's dishes a segment can cook before Dish Master begins, read off the schedule: with
// the limit in force the day before, the most of its dishes (smallest first, at the segment's size) a player can
// have received enough for. Sources that pass the threshold are added. An upper bound, not a forecast.
export function semiExposure(state, parts = state) {
  const byId = Object.fromEntries(state.ingredients.map((i) => [i.id, i]))
  const dm = state.calendar.dishMaster
  if (dm?.startDay == null) return []
  const rows = []
  for (const semi of state.ingredients.filter(isSemi)) {
    const dishes = parts.dishes.filter((d) => d.recipe.some((r) => r.ingredientId === semi.id))
    if (!dishes.length) continue
    const t = mainScheduleOf(parts, semi.id)
    const limit = dm.startDay > 1 ? (t ? thresholdLimitOn(t, dm.startDay - 1) : null) : 0
    for (const segment of state.segments) {
      const bypass = sum((state.sources ?? []).filter((s) => s.kind === 'ingredient' && s.ingredientId === semi.id && s.bypassThreshold && s.day < dm.startDay && (!s.segmentIds || s.segmentIds.includes(segment.id))).map((s) => s.amount))
      const needs = dishes.map((d) => recipeForSegment(d, segment, byId).find((r) => r.ingredientId === semi.id)?.count ?? 0).sort((a, b) => a - b)
      let room = limit == null ? Infinity : limit + bypass
      let cookable = 0
      for (const n of needs) {
        if (n > room) break
        room -= n
        cookable += 1
      }
      rows.push({ ingredientId: semi.id, segmentId: segment.id, name: segment.name, limit, needs, cookable, dishes: needs.length })
    }
  }
  return rows
}

// The recipe budget in numbers, for the screen.
export function budgetSummary(state, plan, parts = state) {
  const ctx = context(state, plan)
  const total = parts.dishes.every((d) => d.recipe.every((r) => r.count != null)) ? baseMainTotal(parts) : null
  return { mode: plan.change.recipes ? plan.budget.mode : 'locked', reference: ctx.reference, min: plan.budget.min, max: plan.budget.max, total, inRange: total != null && plan.budget.min != null && plan.budget.max != null ? total >= plan.budget.min && total <= plan.budget.max : null }
}

// --- What a candidate has to respect -----------------------------------------

function semiBoundsBroken(plan, ctx, t, fresh) {
  if (!ctx.dm) return fresh ? 'no Dish Master days for a semi-blocker schedule' : null
  for (const step of t.steps) {
    if (step.limit == null) continue
    const early = step.fromDay < ctx.dm.start
    const during = step.fromDay >= ctx.dm.start && step.fromDay <= ctx.dm.end
    if (early && ((plan.semi.earlyMin != null && step.limit < plan.semi.earlyMin) || (plan.semi.earlyMax != null && step.limit > plan.semi.earlyMax))) return 'a semi-blocker limit before Dish Master is outside its bounds'
    if (during && ((plan.semi.dmMin != null && step.limit < plan.semi.dmMin) || (plan.semi.dmMax != null && step.limit > plan.semi.dmMax))) return 'a semi-blocker limit during Dish Master is outside its bounds'
    if (fresh && step.fromDay > ctx.dm.end) return 'a new semi-blocker schedule restricts after Dish Master'
  }
  if (fresh) {
    const allowed = new Set([1, ctx.dm.start, ctx.dm.end + 1])
    if (t.steps.some((s) => !allowed.has(s.fromDay))) return 'a new semi-blocker schedule steps on a day that is not Dish Master\'s'
    if (ctx.dm.end + 1 <= ctx.totalDays && thresholdLimitOn(t, ctx.dm.end + 1) != null) return 'a new semi-blocker schedule is not lifted after Dish Master'
  }
  return null
}

// Why a candidate may not be played (null: it may).
function infeasible(state, parts, plan, ctx) {
  const full = { ...state, ...parts }
  const qMin = plan.quantity.min ?? 1
  const qMax = plan.quantity.max ?? Infinity
  for (const round of ['main', 'rc']) {
    for (const dish of listOf(parts, round)) {
      for (const r of dish.recipe) {
        if (r.count == null) return 'a quantity is still blank'
        if (!Number.isInteger(r.count) || r.count < 1) return 'a quantity is not a whole number of 1 or more'
        const was = listOf(state, round).find((d) => d.id === dish.id)?.recipe.find((x) => x.ingredientId === r.ingredientId)?.count
        if (was !== r.count && (r.count < qMin || r.count > qMax)) return 'a quantity is outside the bounds typed'
      }
      for (const segment of ctx.segments) {
        for (const r of recipeForSegment(dish, segment, ctx.byId)) {
          const cap = ctx.byId[r.ingredientId]?.pantryCap
          const was = listOf(state, round).find((d) => d.id === dish.id)?.recipe.find((x) => x.ingredientId === r.ingredientId)?.count
          if (cap != null && r.count > cap && was !== r.base) return `a dish would need more ${ctx.byId[r.ingredientId].name} than the pantry holds`
        }
      }
    }
  }
  if (ctx.bounded) {
    const total = baseMainTotal(parts)
    if (total < plan.budget.min) return 'the Main recipes fall below the budget range'
    if (total > plan.budget.max) return 'the Main recipes go above the budget range'
  }
  if (ctx.freeRounds.includes('rc') && plan.change.recipes) {
    const rcTotal = baseRcTotal(parts)
    if (plan.budget.rcMin != null && rcTotal < plan.budget.rcMin) return 'the Recompletion recipes fall below their range'
    if (plan.budget.rcMax != null && rcTotal > plan.budget.rcMax) return 'the Recompletion recipes go above their range'
  }
  // Schedules: in order, rising, lifted only at the end; existing ones keep their days unless days may change.
  for (const t of parts.thresholds) {
    if (t.steps.length > plan.pacing.maxSteps) return 'a schedule has too many steps'
    let last = null
    for (let i = 0; i < t.steps.length; i += 1) {
      const step = t.steps[i]
      if (i > 0 && step.fromDay <= t.steps[i - 1].fromDay) return 'a schedule is out of order'
      if (step.fromDay < 1 || step.fromDay > ctx.totalDays) return 'a step is outside the event'
      if (step.limit == null) {
        if (i !== t.steps.length - 1) return 'a schedule is lifted and then restricted again'
      } else {
        if (step.limit < 0 || !Number.isInteger(step.limit)) return 'a limit is not a whole number'
        if (last != null && step.limit < last) return 'a limit goes down'
        last = step.limit
      }
    }
    const ing = ctx.byId[t.ingredientId]
    const typed = state.thresholds.find((x) => x.id === t.id)
    if (typed) {
      if (plan.locks.thresholds[t.id] && JSON.stringify(typed.steps) !== JSON.stringify(t.steps)) return 'a locked schedule changed'
      const sameDays = typed.steps.length === t.steps.length && typed.steps.every((s, k) => s.fromDay === t.steps[k].fromDay)
      if (!sameDays && (!plan.change.thresholdDays || isBlocker(ing))) return 'a schedule\'s days changed'
      if (isBlocker(ing) && ctx.fuDay != null && t.steps.some((s, k) => s.fromDay > ctx.fuDay && s.limit !== typed.steps[k].limit)) return 'the blocker changed after the FU day'
      if (isSemi(ing) && !plan.locks.thresholds[t.id]) {
        const broken = semiBoundsBroken(plan, ctx, t, false)
        if (broken) return broken
      }
    } else {
      // A new schedule: only in Main, only for what may be given one, on the days allowed.
      if (t.round !== 'main' || t.steps[0]?.fromDay !== 1) return 'a new schedule does not start on day 1 of Main'
      if (isSemi(ing)) {
        if (!plan.semi.allow) return 'the semi-blocker may not be given a schedule'
        const broken = semiBoundsBroken(plan, ctx, t, true)
        if (broken) return broken
      } else if (isOrdinary(ing)) {
        if (plan.pacing.excluded?.[t.ingredientId]) return 'an excluded ingredient was given a schedule'
        const allowed = new Set([1, ...ctx.newDays])
        if (t.steps.some((s) => !allowed.has(s.fromDay))) return 'a new schedule steps on a day that is not allowed'
      } else if (!isBlocker(ing)) return 'an unknown schedule'
    }
  }
  if (ordinaryPacedIds(parts, ctx).length > Math.max(plan.pacing.maxOrdinary ?? 0, ordinaryPacedIds(state, ctx).length)) return 'more ordinary ingredients are paced than allowed'
  // The blocker stays held back through the FU day, and leaves the last Main dish short.
  if (ctx.fuDay != null) {
    for (const blocker of ctx.blockers) {
      if (blockerNeeds(parts, blocker.id).length === 0) continue
      const t = mainScheduleOf(parts, blocker.id)
      if (!t) return 'the blocker has no threshold'
      const limit = thresholdLimitOn(t, ctx.fuDay)
      const was = state.thresholds.find((x) => x.id === t.id)
      if (limit == null) {
        if (was && thresholdLimitOn(was, ctx.fuDay) == null) continue // as typed; not the proposal's doing
        return 'the blocker would not be held back on the FU day'
      }
      for (const segment of ctx.segments) {
        const own = blockerNeedsOf(parts, blocker.id, segment)
        const shortage = sum(own) - limit
        if (shortage <= 0 || limit < lowestLimitFor(own)) return 'the blocker threshold would not leave exactly the last dish short'
        if (plan.shortage.min != null && shortage < plan.shortage.min) return 'the blocker shortage falls below the bound'
        if (plan.shortage.max != null && shortage > plan.shortage.max) return 'the blocker shortage goes above the bound'
      }
    }
  }
  for (const basket of parts.baskets) {
    const typed = state.baskets.find((b) => b.id === basket.id)
    for (const w of basket.ingredientWeights) {
      const was = typed?.ingredientWeights.find((x) => x.ingredientId === w.ingredientId)?.weight ?? 0
      if (!Number.isFinite(w.weight) || w.weight < 0) return 'a weight is not a number'
      if (was > 0 && !(w.weight > 0)) return 'a weight was closed'
      if (!(was > 0) && w.weight > 0 && (isBlocker(ctx.byId[w.ingredientId]) || !plan.locks.open[weightKey(basket.id, w.ingredientId)])) return 'a basket was opened to an ingredient it never gives'
    }
    if (sum(basket.ingredientWeights.filter((w) => w.weight > 0).map((w) => w.max)) < basket.totalMax) return 'a basket could not give its size'
  }
  if (validateChefConfig(full).some((f) => f.severity === 'block')) return 'the checks find something to fix'
  return null
}

// --- Measuring a candidate -------------------------------------------------

const rounded = (value) => JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 10000) / 10000 : v)))
const compact = (result) =>
  rounded({
    players: result.meta.players,
    mainCount: result.mainCount,
    rcCount: result.rcCount,
    fuTarget: result.fuTarget,
    checkpoints: result.checkpoints,
    finish: result.finish,
    everFu: result.fu.everShare,
    gap: result.gap,
    rc: { enteredShare: result.rc.enteredShare, entrants: result.rc.entrants, fuEverShare: result.rc.fuEverShare, daysToFuP50: result.rc.daysToFuP50, daysToFuP90: result.rc.daysToFuP90, doneShare: result.rc.doneShare, fuWithinShare: result.rc.fuWithinShare, fuWithinDays: result.rc.fuWithinDays, cookedAtEntryShare: result.rc.cookedAtEntryShare },
    payout: { mean: result.payout.mean, complete: result.payout.complete, missing: result.payout.missing },
    probes: result.probes,
    dishMaster: result.dishMaster,
    ingredients: result.ingredients.map((i) => ({ id: i.id, rolled: i.rolled, lost: i.lost, onHand: i.onHand, consumed: i.consumed })),
    presets: { affectedShare: result.presets.affectedShare },
    days: result.days.map((d) => ({ p50: d.p50, mean: d.mean, inFu: d.inFu, everFu: d.everFu, finished: d.finished, rcEntered: d.rcEntered, rcDone: d.rcDone })),
  })

// One segment against every target: the shortfalls, in share of players.
function measure(state, plan, ctx, segment, result, aim = 0) {
  const shortfalls = []
  const push = (id, kind, label, day, target, share) => shortfalls.push({ id, kind, label, day, target, share, miss: Math.max(0, Math.min(1, target - ctx.tolerance + aim) - share) })
  // (A limit rather than a floor: the smaller the share over it, the better.)
  const pushLimit = (id, kind, label, day, limit, share) => shortfalls.push({ id, kind, label, day, target: limit, share, miss: Math.max(0, share - Math.max(0, limit + ctx.tolerance - aim)) })
  if (result.fuTarget) push('fu', 'fu', `In FU on day ${result.fuTarget.day}`, result.fuTarget.day, result.fuTarget.target, result.fuTarget.inFu)
  for (const c of result.checkpoints) push(c.id, 'checkpoint', `${c.dishes}+ dishes by day ${c.day}`, c.day, c.target, c.share)
  if (ctx.gapLimit != null) pushLimit('gap', 'gap', `No more than ${plan.gap.maxSharePct}% wait over ${plan.gap.maxDays} days`, ctx.fuDay, plan.gap.maxSharePct / 100, result.gap.overShare)
  if (ctx.rcTargeted && result.rc.fuWithinShare != null) push('rc', 'rc', `In Recompletion's FU within ${plan.rc.daysToFu} days of entering`, ctx.fuDay, plan.rc.sharePct / 100, result.rc.fuWithinShare)
  if (plan.semi.maxEarlyPct != null && result.dishMaster?.earlyShare != null) pushLimit('semi-early', 'semi-early', `No more than ${plan.semi.maxEarlyPct}% cook a Dish Master dish before Dish Master`, ctx.dm?.start ?? ctx.fuDay, plan.semi.maxEarlyPct / 100, result.dishMaster.earlyShare)
  return { id: segment.id, name: segment.name, result: compact(result), shortfalls, miss: sum(shortfalls.map((s) => s.miss)) }
}

function preferences(state, parts, plan, ctx, segments, baseline) {
  const terms = {}
  const total = baseMainTotal(parts)
  terms.budget = ctx.budgetTarget > 0 ? Math.abs(total - ctx.budgetTarget) / ctx.budgetTarget : 0
  terms.shortage = 0
  if (plan.shortage.preferred != null && ctx.fuDay != null) {
    for (const blocker of ctx.blockers) {
      const needs = blockerNeeds(parts, blocker.id)
      const t = mainScheduleOf(parts, blocker.id)
      const limit = t ? thresholdLimitOn(t, ctx.fuDay) : null
      if (needs.length && limit != null) terms.shortage += Math.abs(sum(needs) - limit - plan.shortage.preferred) / Math.max(1, plan.shortage.preferred)
    }
  }
  // Waste: what was lost to the pantry or left over, as a share of what was given.
  terms.waste = segments.length ? sum(segments.map((s) => { const given = sum(s.result.ingredients.map((i) => i.rolled)); return given > 0 ? sum(s.result.ingredients.map((i) => i.lost + i.onHand)) / given : 0 })) / segments.length : 0
  // How much was changed: the average relative change of the things that may change.
  const changes = []
  for (const round of ['main', 'rc']) listOf(parts, round).forEach((dish, i) => dish.recipe.forEach((r, k) => { const was = listOf(baseline, round)[i]?.recipe[k]?.count; if (was != null) changes.push(Math.abs(r.count - was) / Math.max(1, was)) }))
  parts.baskets.forEach((b, i) => b.ingredientWeights.forEach((w, k) => { const was = baseline.baskets[i].ingredientWeights[k].weight; if (was > 0 || w.weight > 0) changes.push(Math.abs(w.weight - was) / Math.max(1, was, w.weight)) }))
  terms.change = changes.length ? sum(changes) / changes.length : 0
  // Complexity: the ordinary schedules a proposal adds.
  terms.schedules = parts.thresholds.filter((t) => isNewSchedule(state, t) && isOrdinary(ctx.byId[t.ingredientId])).length
  const w = plan.weights
  return { terms, total: (w.budget ?? 0) * terms.budget + (w.shortage ?? 0) * terms.shortage + (w.waste ?? 0) * terms.waste + (w.change ?? 0) * terms.change + (w.schedule ?? 0) * terms.schedules }
}

async function assess(state, parts, plan, ctx, baseline, { players, seed, aim = 0, variation = ctx.variation }, hooks) {
  const full = { ...state, ...parts }
  const segments = []
  for (const segment of ctx.segments) {
    const result = simulateSegment(full, segment, { players, seed, variation, probeDays: ctx.probeDays, gapLimit: ctx.gapLimit, rcFuWithin: ctx.rcFuWithin })
    segments.push(measure(state, plan, ctx, segment, result, aim))
    await hooks.tick()
    if (hooks.cancelled()) return null
  }
  const pref = preferences(state, parts, plan, ctx, segments, baseline)
  return { parts, segments, worst: Math.max(0, ...segments.map((s) => s.miss)), total: sum(segments.map((s) => s.miss)), pref: pref.total, terms: pref.terms }
}

// The order of "better": the worst segment, then all segments, then the preferences.
export function isBetter(a, b) {
  if (a.worst < b.worst - 0.005) return true
  if (a.worst > b.worst + 0.005) return false
  if (a.total < b.total - 0.005) return true
  if (a.total > b.total + 0.005) return false
  return a.pref < b.pref - 0.002
}

// --- Making candidates -----------------------------------------------------

const roundWeight = (w) => Math.max(5, Math.round(w / 5) * 5)

// Blank quantities that may be generated get a first value: the average of the dish's other ingredients, else of
// the ingredient elsewhere.
function fillBlanks(state, parts, plan, ctx) {
  const next = clone(parts)
  for (const c of freeCells(state, next, plan, ctx)) {
    const dish = listOf(next, c.round)[c.dishIndex]
    const r = dish.recipe[c.rowIndex]
    if (r.count != null) continue
    const own = dish.recipe.filter((x) => x.count != null).map((x) => x.count)
    const elsewhere = listOf(next, c.round).flatMap((d) => d.recipe.filter((x) => x.ingredientId === r.ingredientId && x.count != null).map((x) => x.count))
    const guess = own.length ? sum(own) / own.length : elsewhere.length ? sum(elsewhere) / elsewhere.length : 5
    r.count = clamp(Math.round(guess), plan.quantity.min ?? 1, Math.min(plan.quantity.max ?? 999, capCountFor(ctx, r.ingredientId)))
  }
  return next
}

// A free quantity that, at some segment's size, would not fit the pantry is brought down until it does.
function fitPantry(state, parts, plan, ctx) {
  for (const c of freeCells(state, parts, plan, ctx)) {
    const row = listOf(parts, c.round)[c.dishIndex].recipe[c.rowIndex]
    row.count = Math.max(1, Math.min(row.count, capCountFor(ctx, c.ingredientId)))
  }
  return parts
}

// INSIDE THE BUDGET RANGE: free Main quantities are moved one unit at a time until the total is in the range. Units
// are added first to the ingredients `prefer` names (players have them left over) and never to those just made
// smaller (`before` says what they were); taken first from the others. Locked quantities, quantity bounds, pantry
// caps and which ingredients are in a dish are all kept. Only in a bounded run.
function rebalance(state, parts, plan, ctx, before = null, prefer = []) {
  if (!ctx.bounded) return parts
  const cells = freeCells(state, parts, plan, ctx).filter((c) => c.round === 'main')
  if (!cells.length) return parts
  const rowOf = (c) => parts.dishes[c.dishIndex].recipe[c.rowIndex]
  const start = cells.map((c) => rowOf(c).count)
  const wasOf = (c) => before?.dishes[c.dishIndex]?.recipe[c.rowIndex]?.count ?? null
  const lo = plan.quantity.min ?? 1
  const hiOf = (c) => Math.min(plan.quantity.max ?? 999, capCountFor(ctx, c.ingredientId))
  const rank = (id) => (prefer.includes(id) ? prefer.indexOf(id) : prefer.length)
  for (let guard = 0; guard < 4000; guard += 1) {
    const total = baseMainTotal(parts)
    const up = total < plan.budget.min
    const down = total > plan.budget.max
    if (!up && !down) break
    let pick = -1
    let key = null
    cells.forEach((c, i) => {
      const n = rowOf(c).count
      if (up ? n >= hiOf(c) : n <= lo) return
      const was = wasOf(c)
      // Never against what this step just did, if anything else can move; then, adding, the ingredients players
      // have most left over first - taking, those they have least of first; then spread evenly.
      const against = was != null && (up ? n < was : n > was)
      const spread = n / Math.max(1, start[i])
      const k = [against ? 1 : 0, up ? rank(c.ingredientId) : -rank(c.ingredientId), up ? spread : -spread]
      if (key == null || k[0] < key[0] || (k[0] === key[0] && (k[1] < key[1] || (k[1] === key[1] && k[2] < key[2])))) {
        key = k
        pick = i
      }
    })
    if (pick < 0) break
    rowOf(cells[pick]).count += up ? 1 : -1
  }
  return parts
}

// The ingredients players of a segment have the most of left over or lost to a full pantry: where units can go.
// (Ranked by how few of its players lack the ingredient on the FU day, then by what is left over or lost.)
const surplusRank = (segment, ctx) => {
  if (!segment) return []
  const lack = Object.fromEntries((segment.result.probes[ctx.fuDay]?.lack ?? []).map((l) => [l.id, l.share]))
  return [...segment.result.ingredients].sort((a, b) => (lack[a.id] ?? 0) - (lack[b.id] ?? 0) || b.lost + b.onHand - (a.lost + a.onHand)).map((i) => i.id)
}

// The starting point of the search may need the bounds typed (quantities, the budget range, the blocker shortage,
// the semi-blocker's bounds). It is made from the current event and named as such: never called the current event.
function intoBounds(state, parts, plan, ctx) {
  const next = clone(parts)
  if (plan.change.recipes) {
    for (const c of freeCells(state, next, plan, ctx)) {
      const row = listOf(next, c.round)[c.dishIndex].recipe[c.rowIndex]
      row.count = clamp(row.count, plan.quantity.min ?? 1, plan.quantity.max ?? 999)
    }
    fitPantry(state, next, plan, ctx)
    if (ctx.bounded) {
      // Scaled together toward the range first (so no ingredient carries it alone), then unit by unit.
      const total = baseMainTotal(next)
      const aim = total < plan.budget.min ? plan.budget.min : total > plan.budget.max ? plan.budget.max : null
      const cells = freeCells(state, next, plan, ctx).filter((c) => c.round === 'main')
      const free = sum(cells.map((c) => next.dishes[c.dishIndex].recipe[c.rowIndex].count))
      if (aim != null && free > 0) {
        const factor = Math.max(0, aim - (total - free)) / free
        for (const c of cells) {
          const row = next.dishes[c.dishIndex].recipe[c.rowIndex]
          row.count = clamp(Math.round(row.count * factor), plan.quantity.min ?? 1, Math.min(plan.quantity.max ?? 999, capCountFor(ctx, c.ingredientId)))
        }
      }
      rebalance(state, next, plan, ctx)
    }
  }
  if (plan.change.thresholdAmounts) {
    next.thresholds.forEach((t, thresholdIndex) => {
      if (plan.locks.thresholds[t.id]) return
      const ing = ctx.byId[t.ingredientId]
      if (isBlocker(ing) && ctx.fuDay != null && t.round === 'main') {
        const needs = blockerNeeds(next, ing.id)
        const index = t.steps.reduce((found, step, i) => (step.fromDay <= ctx.fuDay ? i : found), -1)
        if (!needs.length || index < 0 || t.steps[index].limit == null) return
        const total = sum(needs)
        const lo = Math.max(lowestLimitFor(needs), plan.shortage.max != null ? total - plan.shortage.max : 0)
        const hi = total - Math.max(1, plan.shortage.min ?? 1)
        moveLimit(next, { thresholdIndex, stepIndex: index }, clamp(t.steps[index].limit, lo, Math.max(lo, hi)) - t.steps[index].limit)
      }
      if (isSemi(ing) && t.round === 'main' && ctx.dm) {
        t.steps.forEach((step) => {
          if (step.limit == null) return
          const early = step.fromDay < ctx.dm.start
          const during = step.fromDay >= ctx.dm.start && step.fromDay <= ctx.dm.end
          if (early) step.limit = clamp(step.limit, plan.semi.earlyMin ?? 0, plan.semi.earlyMax ?? Infinity)
          if (during) step.limit = clamp(step.limit, plan.semi.dmMin ?? 0, plan.semi.dmMax ?? Infinity)
        })
        for (let i = 1; i < t.steps.length; i += 1) if (t.steps[i].limit != null && t.steps[i].limit < t.steps[i - 1].limit) t.steps[i].limit = t.steps[i - 1].limit
      }
    })
  }
  return next
}

// A NEW SEMI-BLOCKER SCHEDULE (the confirmed rule): a limit before Dish Master, a mild rise during it, lifted the day
// after. The limit before starts where no segment can cook one of its dishes yet (the smallest of them at the
// smallest size, less one) - kept inside the bounds typed - and the search moves it from there.
function semiSchedule(state, parts, plan, ctx, semi) {
  if (!ctx.dm) return null
  const needs = ctx.segments.flatMap((s) => parts.dishes.map((d) => recipeForSegment(d, s, ctx.byId).find((r) => r.ingredientId === semi.id)?.count ?? 0)).filter((n) => n > 0)
  if (!needs.length) return null
  const baseNeeds = parts.dishes.map((d) => d.recipe.find((r) => r.ingredientId === semi.id)?.count ?? 0).filter((n) => n > 0)
  const early = clamp(Math.min(...needs) - 1, plan.semi.earlyMin ?? 0, plan.semi.earlyMax ?? Infinity)
  const during = Math.max(early, clamp(Math.round(sum(baseNeeds) * 0.6), plan.semi.dmMin ?? 0, plan.semi.dmMax ?? Infinity))
  const steps = []
  if (ctx.dm.start > 1) steps.push({ fromDay: 1, limit: early })
  steps.push({ fromDay: ctx.dm.start, limit: during })
  if (ctx.dm.end + 1 <= ctx.totalDays) steps.push({ fromDay: ctx.dm.end + 1, limit: null })
  return createThreshold({ id: `gen-main-${semi.id}`, ingredientId: semi.id, round: 'main', steps })
}

// A NEW ORDINARY SCHEDULE: from day 1, a few steps on the days allowed, lifted on the last of them. Each step lets
// through a share of what the most demanding segment's Main dishes need in all, rising with the days - so the
// ingredient comes more slowly early on and baskets give the others in its place (a basket keeps its size).
function ordinarySchedule(state, parts, plan, ctx, ingredientId, rng) {
  const days = ctx.newDays
  if (!days.length) return null
  const need = Math.max(...ctx.segments.map((s) => needOf(parts, ingredientId, s, ctx.byId)))
  if (!(need > 0)) return null
  const before = ctx.fuDay != null ? days.filter((d) => d <= ctx.fuDay) : days
  const pool = before.length ? before : days
  const count = 1 + Math.floor(rng() * Math.min(Math.max(1, plan.pacing.maxSteps - 1), pool.length, 3))
  const chosen = [...pool].sort(() => rng() - 0.5).slice(0, count).sort((a, b) => a - b)
  const lift = chosen.at(-1)
  const share = 0.45 + rng() * 0.45
  const starts = [1, ...chosen.slice(0, -1)]
  const steps = starts.map((d, i) => {
    const until = (i + 1 < starts.length ? starts[i + 1] : lift) - 1
    return { fromDay: d, limit: Math.max(1, Math.ceil(need * Math.min(1, share * (until / Math.max(1, lift - 1))))) }
  })
  for (let i = 1; i < steps.length; i += 1) steps[i].limit = Math.max(steps[i].limit, steps[i - 1].limit)
  steps.push({ fromDay: lift, limit: null })
  return createThreshold({ id: `gen-main-${ingredientId}`, ingredientId, round: 'main', steps })
}

// Schedules that have to exist for a proposal to be read: the blocker's Main one; the semi-blocker's (the rule, when
// allowed). Only when threshold amounts may change.
function addMissingSchedules(state, parts, plan, ctx) {
  if (!plan.change.thresholdAmounts) return { parts, added: [] }
  const next = clone(parts)
  const added = []
  for (const blocker of ctx.blockers) {
    const needs = blockerNeeds(next, blocker.id)
    if (needs.length < 1 || mainScheduleOf(next, blocker.id)) continue
    const total = sum(needs)
    const shortage = clamp(plan.shortage.preferred ?? Math.max(...needs), 1, Math.max(...needs))
    next.thresholds.push(createThreshold({ id: `gen-main-${blocker.id}`, ingredientId: blocker.id, round: 'main', steps: [{ fromDay: 1, limit: Math.max(lowestLimitFor(needs), total - shortage) }] }))
    added.push(blocker.id)
  }
  if (plan.semi.allow) {
    for (const semi of ctx.semis) {
      if (mainScheduleOf(next, semi.id)) continue
      const t = semiSchedule(state, next, plan, ctx, semi)
      if (!t) continue
      next.thresholds.push(t)
      added.push(semi.id)
    }
  }
  return { parts: next, added }
}

// THE FIRST FIT (an estimate, never reported as a result). For each ordinary ingredient, what the Main dishes may
// ask for at the base: what the slower players (1 in 5 has less) of the weakest segment had received by the FU day,
// a little less for safety. In a bounded run the total is then set inside the range - shared in proportion to what
// players receive, never fitted to the weakest segment below the range.
function fitRecipes(state, assessed, plan, ctx, margin = 0.92) {
  if (ctx.fuDay == null) return null
  const cells = freeCells(state, assessed.parts, plan, ctx).filter((c) => c.round === 'main')
  if (cells.length === 0) return null
  const next = clone(assessed.parts)
  const ids = [...new Set(cells.map((c) => c.ingredientId))]
  const supported = {}
  for (const id of ids) {
    supported[id] = Math.min(...assessed.segments.map((s) => (s.result.probes[ctx.fuDay]?.lack.find((l) => l.id === id)?.receivedLow ?? 0) / factorOf(state.segments.find((x) => x.id === s.id)))) * margin
  }
  const freeOf = (id) => cells.filter((c) => c.ingredientId === id)
  const freeTotalOf = (id) => sum(freeOf(id).map((c) => next.dishes[c.dishIndex].recipe[c.rowIndex].count))
  const fixed = baseMainTotal(next) - sum(ids.map(freeTotalOf))
  const lockedOf = (id) => sum(next.dishes.map((d) => d.recipe.find((r) => r.ingredientId === id)?.count ?? 0)) - freeTotalOf(id)
  const supportedFree = Object.fromEntries(ids.map((id) => [id, Math.max(cells.filter((c) => c.ingredientId === id).length, supported[id] - lockedOf(id))]))
  const allSupported = sum(Object.values(supportedFree))
  const room = ctx.bounded ? clamp(allSupported, plan.budget.min - fixed, plan.budget.max - fixed) : Math.min(allSupported, Math.max(0, ctx.budgetTarget - fixed))
  for (const id of ids) {
    const aim = allSupported > 0 ? (room * supportedFree[id]) / allSupported : 0
    const now = freeTotalOf(id)
    if (!(now > 0)) continue
    for (const c of freeOf(id)) {
      const row = next.dishes[c.dishIndex].recipe[c.rowIndex]
      row.count = clamp(Math.max(1, Math.round((row.count * aim) / now)), plan.quantity.min ?? 1, Math.min(plan.quantity.max ?? 999, capCountFor(ctx, id)))
    }
  }
  return rebalance(state, fitPantry(state, next, plan, ctx), plan, ctx, null, surplusRank([...assessed.segments].sort((a, b) => b.miss - a.miss)[0], ctx))
}

const scaleCells = (parts, cells, factor, plan) => {
  for (const c of cells) {
    const row = listOf(parts, c.round)[c.dishIndex].recipe[c.rowIndex]
    const scaled = Math.round(row.count * factor)
    row.count = clamp(scaled === row.count ? row.count + (factor > 1 ? 1 : -1) : scaled, plan.quantity.min ?? 1, plan.quantity.max ?? 999)
  }
}
// (`capOf`: the most a row's weight may be - see `weightCap`.)
const scaleWeights = (parts, rows, factor, capOf = () => Infinity) => {
  for (const r of rows) {
    const w = parts.baskets[r.basketIndex].ingredientWeights[r.rowIndex]
    w.weight = Math.min(roundWeight((w.weight > 0 ? w.weight : 20) * factor), Math.max(5, capOf(r)))
  }
}
const weightCap = (state, plan) => (r) => {
  const typed = state.baskets[r.basketIndex].ingredientWeights
  const was = typed[r.rowIndex].weight
  return was > 0 ? roundWeight(was * (plan.weight?.maxFactor ?? 8)) : Math.max(5, ...typed.map((w) => w.weight))
}
// A limit moved by `by`, keeping the schedule rising.
function moveLimit(parts, target, by) {
  const steps = parts.thresholds[target.thresholdIndex].steps
  steps[target.stepIndex].limit = Math.max(0, steps[target.stepIndex].limit + by)
  for (let i = target.stepIndex + 1; i < steps.length; i += 1) if (steps[i].limit != null && steps[i].limit < steps[i - 1].limit) steps[i].limit = steps[i - 1].limit
  for (let i = target.stepIndex - 1; i >= 0; i -= 1) if (steps[i].limit != null && steps[i].limit > steps[i + 1].limit) steps[i].limit = steps[i + 1].limit
}
// How far a limit moves in one step: a unit or two for a blocker or semi-blocker, about a tenth for an ordinary one.
const limitStep = (parts, target, ctx, rng) => {
  const t = parts.thresholds[target.thresholdIndex]
  if (!isOrdinary(ctx.byId[t.ingredientId])) return rng() < 0.7 ? 1 : 2
  return Math.max(1, Math.round((t.steps[target.stepIndex].limit ?? 10) * (0.06 + rng() * 0.12)))
}
function moveDay(parts, target, by, ctx) {
  const steps = parts.thresholds[target.thresholdIndex].steps
  const lo = Math.max(ctx.dayMin, 2, (steps[target.stepIndex - 1]?.fromDay ?? 0) + 1)
  const hi = Math.min(ctx.dayMax, (steps[target.stepIndex + 1]?.fromDay ?? Infinity) - 1)
  steps[target.stepIndex].fromDay = clamp(steps[target.stepIndex].fromDay + by, lo, Math.max(lo, hi))
}

// One step from the best candidate so far. Returns { parts, why } or null when nothing may change.
// A GUIDED step reads the segment furthest from its targets on the day it misses: which ingredients its players lack
// for the dishes left, who is still counted below the blocker's threshold, who has already finished - and answers up
// to three of those at once. The rest of the steps are RANDOM, more of them the longer nothing improves.
function nextCandidate(state, best, plan, ctx, rng, idle = 0) {
  const parts = clone(best.parts)
  const cells = freeCells(state, parts, plan, ctx)
  const weights = freeWeights(parts, plan, ctx)
  const { limits, days } = freeSteps(state, parts, plan, ctx)
  const blockerCells = freeBlockers(parts, plan, ctx)
  const pacing = pacingRoom(parts, plan, ctx)
  const generatedOrdinary = parts.thresholds.filter((t) => isNewSchedule(state, t) && isOrdinary(ctx.byId[t.ingredientId]))
  const canPace = pacing.room > 0 && pacing.candidates.length > 0
  const canReday = !plan.change.thresholdDays && generatedOrdinary.length > 0 && ctx.newDays.length > 1
  if (cells.length + weights.length + limits.length + days.length + blockerCells.length === 0 && !canPace && !generatedOrdinary.length) return null
  const any = (list) => list[Math.floor(rng() * list.length)]
  const between = (lo, hi) => lo + rng() * (hi - lo)
  const isBlockerId = (id) => isBlocker(ctx.byId[id])
  const capOf = weightCap(state, plan)
  const pct = (v) => `${Math.round(v * 100)}%`
  const worstSegment = [...best.segments].sort((x, y) => y.miss - x.miss)[0]
  const surplus = surplusRank(worstSegment, ctx)
  // A new ordinary schedule for one of the allowed ingredients, those players have the most of left over first.
  // (Pacing an ingredient holds it back so baskets give the others: the ones players are least short of come first, and
  // one a fifth or more of them lack on the day missed is not paced by a guided step.)
  const lackOn = Object.fromEntries((worstSegment?.result.probes[ctx.fuDay]?.lack ?? []).map((l) => [l.id, l.share]))
  const pace = (reason, from = pacing.candidates) => {
    const pool = reason && !/random/.test(reason) ? from.filter((i) => (lackOn[i.id] ?? 0) < 0.2) : from
    if (!pool.length) return null
    const ranked = [...pool].sort((a, b) => surplus.indexOf(a.id) - surplus.indexOf(b.id))
    const ing = ranked[Math.floor(rng() ** 2 * Math.min(3, ranked.length))]
    const t = ordinarySchedule(state, parts, plan, ctx, ing.id, rng)
    if (!t) return null
    parts.thresholds.push(t)
    const row = worstSegment?.result.ingredients.find((i) => i.id === ing.id)
    return `${ing.name} is given a schedule (${t.steps.map((s) => (s.limit == null ? `lifted day ${s.fromDay}` : `${s.limit} from day ${s.fromDay}`)).join(', ')})${row ? ` - ${worstSegment.name} ended with ${Math.round(row.onHand)} of it left over and ${Math.round(row.lost)} lost to a full pantry` : ''}${reason ? `; ${reason}` : ''}`
  }

  const random = () => {
    const canSwap = generatedOrdinary.length > 0 && pacing.candidates.length > 0
    const kinds = [cells.length && 'cell', weights.length && 'weight', limits.length && 'limit', days.length && 'day', blockerCells.length && 'blocker', canPace && 'pace', canPace && 'pace', generatedOrdinary.length && 'unpace', canReday && 'reday', canSwap && 'swap', canSwap && 'swap'].filter(Boolean)
    if (!kinds.length) return null
    const kind = any(kinds)
    if (kind === 'cell') {
      const c = any(cells)
      scaleCells(parts, cells.filter((x) => x.ingredientId === c.ingredientId && x.round === c.round), rng() < 0.5 ? between(0.75, 0.95) : between(1.05, 1.25), plan)
      return `a random step: the quantities of ${ctx.byId[c.ingredientId].name}`
    }
    if (kind === 'weight') {
      const w = any(weights)
      scaleWeights(parts, weights.filter((x) => x.ingredientId === w.ingredientId), rng() < 0.5 ? between(0.6, 0.85) : between(1.2, 1.8), capOf)
      return `a random step: the weight of ${ctx.byId[w.ingredientId].name}`
    }
    if (kind === 'limit') {
      const l = any(limits)
      moveLimit(parts, l, (rng() < 0.5 ? -1 : 1) * limitStep(parts, l, ctx, rng))
      return `a random step: a limit of ${ctx.byId[l.ingredientId].name}`
    }
    if (kind === 'day') {
      const d = any(days)
      moveDay(parts, d, rng() < 0.5 ? -1 : 1, ctx)
      return `a random step: an opening day of ${ctx.byId[d.ingredientId].name}`
    }
    if (kind === 'pace') return pace('a random step')
    if (kind === 'unpace') {
      const t = any(generatedOrdinary)
      parts.thresholds = parts.thresholds.filter((x) => x.id !== t.id)
      return `a random step: ${ctx.byId[t.ingredientId].name}'s new schedule is taken away again`
    }
    if (kind === 'swap') {
      // Another ingredient in place of one given a new schedule: alternatives are compared, not only added.
      const t = any(generatedOrdinary)
      parts.thresholds = parts.thresholds.filter((x) => x.id !== t.id)
      const said = pace('a random step', pacing.candidates)
      return said ? `a random step: in place of ${ctx.byId[t.ingredientId].name}'s new schedule, ${said.replace(/; a random step$/, '')}` : null
    }
    if (kind === 'reday') {
      const t = any(generatedOrdinary)
      parts.thresholds = parts.thresholds.filter((x) => x.id !== t.id)
      const again = ordinarySchedule(state, parts, plan, ctx, t.ingredientId, rng)
      if (!again) return null
      parts.thresholds.push(again)
      return `a random step: ${ctx.byId[t.ingredientId].name}'s new schedule on other days allowed (${again.steps.map((s) => s.fromDay).join(', ')})`
    }
    const b = any(blockerCells)
    const dish = listOf(parts, b.round)[b.dishIndex]
    const own = { ...(dish.blockerBySegment?.[b.segmentId] ?? {}) }
    own[b.ingredientId] = Math.max(1, (own[b.ingredientId] ?? b.base) + (rng() < 0.5 ? -1 : 1))
    dish.blockerBySegment = { ...(dish.blockerBySegment ?? {}), [b.segmentId]: own }
    return 'a random step: a blocker quantity of one segment'
  }
  const finish = (why) => (why ? { parts: rebalance(state, fitPantry(state, parts, plan, ctx), plan, ctx, best.parts, surplus), why } : null)

  // (A quarter of the steps are random; the longer nothing improves, the more of them are.)
  if (rng() < Math.min(0.7, 0.25 + idle * 0.03)) return finish(random())

  // Every target is met on the search players: move toward the preferences instead.
  if (!worstSegment || worstSegment.miss <= 0) {
    const total = baseMainTotal(parts)
    const mainCells = cells.filter((c) => c.round === 'main')
    if (mainCells.length && Math.abs(total - ctx.budgetTarget) / Math.max(1, ctx.budgetTarget) > 0.03 && rng() < 0.6) {
      const up = total < ctx.budgetTarget
      const lead = [...best.segments].sort((x, y) => x.result.finish.share - y.result.finish.share)[0]
      const ranked = [...new Set(mainCells.map((c) => c.ingredientId))].map((id) => ({ id, left: lead.result.ingredients.find((i) => i.id === id)?.onHand ?? 0 })).sort((x, y) => (up ? y.left - x.left : x.left - y.left))
      const id = ranked[Math.floor(rng() * Math.min(3, ranked.length))].id
      scaleCells(parts, mainCells.filter((c) => c.ingredientId === id), up ? between(1.04, 1.12) : between(0.9, 0.96), plan)
      return finish(`toward the recipe budget: ${up ? 'more' : 'less'} ${ctx.byId[id].name} in the dishes`)
    }
    if (generatedOrdinary.length && rng() < 0.3) {
      const t = any(generatedOrdinary)
      parts.thresholds = parts.thresholds.filter((x) => x.id !== t.id)
      return finish(`fewer schedules: ${ctx.byId[t.ingredientId].name}'s new schedule is taken away to see whether it is needed`)
    }
    if (weights.length && rng() < 0.5) {
      const ranked = [...new Set(weights.map((w) => w.ingredientId))].filter((id) => !isBlockerId(id)).map((id) => ({ id, left: worstSegment.result.ingredients.find((i) => i.id === id)?.onHand ?? 0 })).sort((x, y) => y.left - x.left)
      if (ranked.length >= 2) {
        scaleWeights(parts, weights.filter((w) => w.ingredientId === ranked[0].id), 0.9, capOf)
        scaleWeights(parts, weights.filter((w) => w.ingredientId === ranked.at(-1).id), 1.1, capOf)
        return finish(`less left over: weight from ${ctx.byId[ranked[0].id].name} to ${ctx.byId[ranked.at(-1).id].name}`)
      }
    }
    return finish(random())
  }

  const worst = worstSegment
  const missed = [...worst.shortfalls].sort((x, y) => y.miss - x.miss)[0]
  const probe = worst.result.probes[missed.day] ?? worst.result.probes[ctx.fuDay]
  if (!probe) return finish(random())
  const fixes = []
  const mainLimits = (id) => limits.filter((l) => l.ingredientId === id && l.round === 'main')
  if (missed.kind === 'semi-early') {
    for (const semi of ctx.semis) {
      const early = mainLimits(semi.id).filter((l) => parts.thresholds[l.thresholdIndex].steps[l.stepIndex].fromDay < (ctx.dm?.start ?? 1))
      if (early.length) fixes.push({ size: missed.miss, run: () => (moveLimit(parts, any(early), -limitStep(parts, early[0], ctx, rng)), `${pct(missed.share)} cooked a ${semi.name} dish before Dish Master - its limit before Dish Master is lowered`) })
    }
  }
  if (missed.kind === 'fu' || missed.kind === 'checkpoint') {
    for (const blocker of ctx.blockers) {
      const row = probe.lack.find((l) => l.id === blocker.id)
      const ownWeights = weights.filter((w) => w.ingredientId === blocker.id)
      const ownLimits = mainLimits(blocker.id)
      if (missed.kind === 'fu' && probe.reasons.finished >= 0.05 && ownLimits.length) {
        fixes.push({ size: probe.reasons.finished, run: () => (moveLimit(parts, any(ownLimits), -1), `${pct(probe.reasons.finished)} had already finished - ${blocker.name} is held back sooner`) })
      }
      const ownCells = blockerCells.filter((c) => c.round === 'main' && c.ingredientId === blocker.id && c.segmentId === worst.id)
      if (missed.kind === 'fu' && probe.reasons.finished >= 0.05 && ownCells.length) {
        fixes.push({
          size: probe.reasons.finished,
          run: () => {
            const quantityOf = (c) => parts.dishes[c.dishIndex].blockerBySegment?.[c.segmentId]?.[c.ingredientId] ?? c.base
            const last = [...ownCells].sort((x, y) => quantityOf(y) - quantityOf(x))[0]
            const target = parts.dishes[last.dishIndex]
            target.blockerBySegment = { ...(target.blockerBySegment ?? {}), [worst.id]: { ...(target.blockerBySegment?.[worst.id] ?? {}), [blocker.id]: quantityOf(last) + 1 } }
            return `${pct(probe.reasons.finished)} had already finished - for this segment ${target.name} asks for one more ${blocker.name}`
          },
        })
      }
      // Still counted below the threshold (so not in FU, whatever else they hold), or lacking it for a dish before the last.
      const below = missed.kind === 'fu' ? Math.max(row?.belowLimit ?? 0, probe.reasons.waiting) : (row?.share ?? 0)
      if (below >= 0.05 && (ownWeights.length || (missed.kind === 'fu' && ownLimits.length))) {
        fixes.push({
          size: below,
          run: () => {
            if (ownWeights.length && (missed.kind !== 'fu' || !ownLimits.length || rng() < 0.7)) {
              scaleWeights(parts, ownWeights, clamp(1 + 2.5 * below, 1.2, 3), capOf)
              return `${pct(below)} had too little ${blocker.name} - baskets give it more often`
            }
            moveLimit(parts, any(ownLimits), -1)
            return `${pct(below)} were still below the threshold of ${blocker.name} - it is reached sooner`
          },
        })
      }
    }
  }
  // An ordinary or semi-blocker ingredient is lacking for the dishes left: ask for less, give more, let it through
  // earlier - or pace one players have in surplus, so baskets give the lacking ones in its place.
  const lacking = probe.lack.filter((x) => !isBlockerId(x.id) && x.share >= 0.05)
  for (const l of lacking) {
    const own = cells.filter((c) => c.ingredientId === l.id && c.round === 'main')
    const ownWeights = weights.filter((w) => w.ingredientId === l.id)
    const ownLimits = mainLimits(l.id)
    const ownDays = days.filter((x) => x.ingredientId === l.id && x.round === 'main')
    const options = [...(own.length ? ['recipe', 'recipe'] : []), ...(ownWeights.length ? ['weight'] : []), ...(ownLimits.length ? ['limit'] : []), ...(ownDays.length ? ['day'] : [])]
    if (options.length === 0) continue
    const name = ctx.byId[l.id].name
    fixes.push({
      size: l.share,
      run: () => {
        const option = any(options)
        if (option === 'recipe') {
          scaleCells(parts, own, clamp(1 - l.share * between(0.2, 0.5), 0.6, 0.97), plan)
          return `${pct(l.share)} lacked ${name} - the dishes ask for less of it${ctx.bounded ? ' (the units go to others, the budget range kept)' : ''}`
        }
        if (option === 'weight') {
          scaleWeights(parts, ownWeights, clamp(1 + l.share * between(0.5, 1.5), 1.1, 2.2), capOf)
          return `${pct(l.share)} lacked ${name} - baskets give it more often`
        }
        if (option === 'limit') {
          const inForce = ownLimits.filter((x) => parts.thresholds[x.thresholdIndex].steps[x.stepIndex].fromDay <= missed.day)
          const pick = any(inForce.length ? inForce : ownLimits)
          moveLimit(parts, pick, limitStep(parts, pick, ctx, rng))
          return `${pct(l.share)} lacked ${name} - its threshold lets more through`
        }
        moveDay(parts, any(ownDays), -1, ctx)
        return `${pct(l.share)} lacked ${name} - its threshold opens a day earlier`
      },
    })
  }
  if (canPace && lacking.length) {
    const top = [...lacking].sort((a, b) => b.share - a.share)[0]
    fixes.push({ size: top.share * 0.6, run: () => pace(`${pct(top.share)} lacked ${ctx.byId[top.id].name}`) })
  }
  if (fixes.length === 0) return finish(random())
  fixes.sort((x, y) => y.size - x.size)
  const chosen = rng() < 0.35 ? [fixes[Math.floor(rng() * Math.min(2, fixes.length))]] : fixes.slice(0, 3)
  const said = chosen.map((fix) => fix.run()).filter(Boolean)
  return finish(said.length ? `${worst.name}, day ${missed.day}: ${said.join('; ')}` : random())
}

// --- What changed, and why ---------------------------------------------------

function diff(state, before, after, ctx) {
  const changes = { recipes: [], weights: [], thresholds: [], blockers: [] }
  for (const round of ['main', 'rc']) {
    listOf(after, round).forEach((dish, i) => {
      const was = listOf(before, round)[i]
      dish.recipe.forEach((r, k) => {
        const from = listOf(state, round)[i]?.recipe[k]?.count ?? null
        if (from !== r.count) changes.recipes.push({ round, dishId: dish.id, ingredientId: r.ingredientId, from, to: r.count })
      })
      for (const [segmentId, own] of Object.entries(dish.blockerBySegment ?? {})) {
        for (const [ingredientId, to] of Object.entries(own ?? {})) {
          const from = was?.blockerBySegment?.[segmentId]?.[ingredientId] ?? null
          if (from !== to) changes.blockers.push({ round, dishId: dish.id, segmentId, ingredientId, from, to })
        }
      }
    })
  }
  after.baskets.forEach((basket, i) => {
    const total = (b) => sum(b.ingredientWeights.map((w) => w.weight))
    basket.ingredientWeights.forEach((w, k) => {
      const from = before.baskets[i].ingredientWeights[k].weight
      const chanceFrom = total(before.baskets[i]) > 0 ? from / total(before.baskets[i]) : 0
      const chanceTo = total(basket) > 0 ? w.weight / total(basket) : 0
      if (from !== w.weight || Math.abs(chanceFrom - chanceTo) > 0.0005) changes.weights.push({ basketId: basket.id, chestType: basket.chestType, phaseId: basket.phaseId, ingredientId: w.ingredientId, from, to: w.weight, chanceFrom, chanceTo, typed: from !== w.weight })
    })
  })
  for (const t of after.thresholds) {
    const was = before.thresholds.find((x) => x.id === t.id)
    const ing = ctx.byId[t.ingredientId]
    if (!was || JSON.stringify(was.steps) !== JSON.stringify(t.steps)) changes.thresholds.push({ id: t.id, ingredientId: t.ingredientId, round: t.round, from: was ? was.steps : null, to: t.steps, isNew: !was, kind: isBlocker(ing) ? 'blocker' : isSemi(ing) ? 'semi' : 'ordinary' })
  }
  const totals = (parts) => {
    const out = { demand: baseMainTotal(parts), rcDemand: baseRcTotal(parts), shortage: {}, ordinaryPaced: ordinaryPacedIds(parts, ctx) }
    for (const blocker of ctx.blockers) {
      const needs = blockerNeeds(parts, blocker.id)
      const t = mainScheduleOf(parts, blocker.id)
      const limit = t && ctx.fuDay != null ? thresholdLimitOn(t, ctx.fuDay) : null
      out.shortage[blocker.id] = needs.length && limit != null ? sum(needs) - limit : null
    }
    return out
  }
  changes.totals = { before: totals(before), after: totals(after) }
  changes.count = changes.recipes.length + changes.weights.filter((w) => w.typed).length + changes.thresholds.length + changes.blockers.length
  return changes
}

// Each material change with what was MEASURED around it (validation players, the segment furthest from the target
// before). A sentence says what moved together; it does not claim more than that.
function explain(state, changes, base, proposed, ctx) {
  if (!base || !proposed || ctx.fuDay == null) return []
  const lines = []
  const worst = [...base.segments].sort((a, b) => b.miss - a.miss)[0]
  const after = proposed.segments.find((s) => s.id === worst.id)
  const pct = (v) => `${Math.round((v ?? 0) * 100)}%`
  const num = (v) => `${Math.round(v ?? 0)}`
  const day = ctx.fuDay
  const lackOf = (seg, id) => seg.result.probes[day]?.lack.find((l) => l.id === id)?.share ?? 0
  const ingOf = (seg, id) => seg.result.ingredients.find((i) => i.id === id)
  const ids = [...new Set([...changes.recipes.filter((c) => c.round === 'main').map((c) => c.ingredientId), ...changes.weights.filter((w) => w.typed).map((w) => w.ingredientId), ...changes.thresholds.map((t) => t.ingredientId)])]
  for (const id of ids) {
    const ing = ctx.byId[id]
    const parts = []
    const cells = changes.recipes.filter((c) => c.round === 'main' && c.ingredientId === id)
    if (cells.length) parts.push(`the Main dishes ask for ${sum(cells.map((c) => c.to))} of it in ${cells.length} ${cells.length === 1 ? 'dish' : 'dishes'} where they asked for ${sum(cells.map((c) => c.from ?? 0))}`)
    const w = changes.weights.filter((x) => x.typed && x.ingredientId === id)
    if (w.length) parts.push(`its weight ${sum(w.map((x) => x.to)) > sum(w.map((x) => x.from)) ? 'rose' : 'fell'} in ${w.length} ${w.length === 1 ? 'basket' : 'baskets'}`)
    const t = changes.thresholds.filter((x) => x.ingredientId === id)
    if (t.length) parts.push(t[0].isNew ? 'it was given a new threshold schedule' : 'its threshold schedule changed')
    const rowOf = (seg) => seg.result.probes[day]?.lack.find((l) => l.id === id)
    let evidence
    if (isBlocker(ing)) {
      evidence = `On day ${day}, ${pct(rowOf(worst)?.belowLimit)} of ${worst.name} were still counted below its threshold (${rowOf(worst)?.limit ?? 'none'}) and ${pct(worst.result.probes[day]?.reasons.finished)} had already finished; with the proposal ${pct(rowOf(after)?.belowLimit)} are below its threshold (${rowOf(after)?.limit ?? 'none'}) and ${pct(after.result.probes[day]?.reasons.finished)} have finished.`
    } else if (isSemi(ing) && worst.result.dishMaster && after.result.dishMaster) {
      const a = worst.result.dishMaster
      const b = after.result.dishMaster
      evidence = `Of ${worst.name}: cooked one of its ${a.dishes} dishes before Dish Master ${pct(a.earlyShare)} → ${pct(b.earlyShare)}; all of them by its last day ${pct(a.allShare)} → ${pct(b.allShare)}; one after it ended ${pct(a.afterShare)} → ${pct(b.afterShare)}. On day ${day}, ${pct(lackOf(worst, id))} lacked it → ${pct(lackOf(after, id))}.`
    } else if (t.some((x) => x.isNew)) {
      // Why a NEW ordinary schedule: what players had of it, and what the others lacked, before and after.
      const others = (worst.result.probes[day]?.lack ?? []).filter((l) => l.id !== id && !isBlocker(ctx.byId[l.id]) && l.share >= 0.05).sort((x, y) => y.share - x.share).slice(0, 2)
      evidence = `Before, ${worst.name} ended with ${num(ingOf(worst, id)?.onHand)} of it left over and ${num(ingOf(worst, id)?.lost)} lost to a full pantry (with the proposal ${num(ingOf(after, id)?.onHand)} and ${num(ingOf(after, id)?.lost)})${others.length ? `, while on day ${day} ${others.map((l) => `${pct(l.share)} lacked ${ctx.byId[l.id].name} (→ ${pct(lackOf(after, l.id))})`).join(' and ')}` : ''}. The longest wait between two Main dishes, most players: ${worst.result.gap.p90 ?? '-'} → ${after.result.gap.p90 ?? '-'} days.`
    } else {
      evidence = `On day ${day}, ${pct(lackOf(worst, id))} of ${worst.name} lacked it for the dishes left; with the proposal ${pct(lackOf(after, id))}.`
    }
    lines.push({ ingredientId: id, text: `${ing.name}: ${parts.join('; ')}. ${evidence}` })
  }
  return lines
}

// --- Generate ---------------------------------------------------------------

const verdictOf = (shortfall, players, tolerance) => {
  if (shortfall.kind === 'gap' || shortfall.kind === 'semi-early') return shortfall.miss > 0 ? 'missed' : 'met'
  const need = shortfall.target - tolerance
  const i = shareInterval(Math.round(shortfall.share * players), players)
  if (i.low >= need) return 'met'
  if (i.high < need) return 'missed'
  return shortfall.share >= need ? 'met-unsure' : 'missed-unsure'
}

// Generates a proposal. Never changes `state`. `hooks`: { onProgress({ done, of, label }), isCancelled(), tick() }.
export async function generateProposal(state, plan, hooks = {}) {
  const started = Date.now()
  const ctx = context(state, plan)
  const tick = hooks.tick ?? (() => new Promise((resolve) => setTimeout(resolve, 0)))
  const run = { tick, cancelled: () => !!hooks.isCancelled?.() }
  const progress = (done, label) => hooks.onProgress?.({ done, of: plan.search.candidates + 8, label })
  const warnings = searchWarnings(state, plan)
  const stamp = (extra) => ({
    id: `proposal-${started.toString(36)}`,
    createdAt: new Date(started).toISOString(),
    engine: ENGINE_VERSION,
    search: SEARCH_VERSION,
    baseFingerprint: fingerprint(state),
    planKey: planKeyOf(plan),
    targets: describeTargets(state, plan),
    settings: { searchPlayers: plan.search.players, validationPlayers: plan.search.validationPlayers, searchSeed: plan.search.seed, validationSeed: plan.search.seed + 7919, variation: ctx.variation, presetsActive: (state.presets ?? []).filter((p) => p.enabled !== false).length },
    budgetMode: plan.change.recipes ? plan.budget.mode : 'locked',
    segmentIds: ctx.segments.map((s) => s.id),
    warnings,
    runtimeMs: Date.now() - started,
    ...extra,
  })

  const problems = inputProblems(state, plan)
  if (problems.length) return stamp({ status: 'inputs', problems, evaluations: 0, stopReason: 'inputs' })
  const invalid = configurationProblems(state, plan)
  if (invalid.length) return stamp({ status: 'invalid', problems: invalid, evaluations: 0, stopReason: 'invalid' })
  const conflicts = structuralConflicts(state, plan)
  if (conflicts.length) return stamp({ status: 'conflict', conflicts, evaluations: 0, stopReason: 'conflict' })

  // THE CURRENT EVENT is the event as it is, and is what every result is compared with. The search starts from a
  // STARTING POINT made from it - named as such whenever it differs.
  const baseline = pickParts(state)
  const baselineComplete = [...baseline.dishes, ...baseline.recompletionDishes].every((d) => d.recipe.every((r) => r.count != null))
  const notes = []
  let start = fillBlanks(state, baseline, plan, ctx)
  if (!baselineComplete) notes.push('the blank quantities filled in')
  const withSchedules = addMissingSchedules(state, start, plan, ctx)
  start = withSchedules.parts
  for (const id of withSchedules.added) notes.push(`a schedule for ${ctx.byId[id].name} added`)
  const outside = infeasible(state, start, plan, ctx)
  if (outside) {
    const before = baseMainTotal(start)
    start = intoBounds(state, start, plan, ctx)
    notes.push(`brought inside the bounds typed (${outside}${ctx.bounded && before !== baseMainTotal(start) ? `: Main recipes ${before} → ${baseMainTotal(start)}` : ''})`)
  }
  const startingPoint = { isCurrent: notes.length === 0, notes, total: baseMainTotal(start) }
  // The preferences are measured against where the search starts when the current event cannot be played.
  const anchor = baselineComplete ? baseline : start
  const searchOn = { players: plan.search.players, seed: plan.search.seed, aim: (Number(plan.search.aimPts) || 0) / 100 }
  const log = []
  // (Every version played is remembered, so a version met again is never played twice - its result is reused.)
  const tried = new Map()
  let evaluations = 0
  const play = async (parts, why) => {
    const key = JSON.stringify(parts)
    if (tried.has(key)) return { rejected: 'played already', cached: tried.get(key) }
    tried.set(key, null)
    const reason = infeasible(state, parts, plan, ctx)
    if (reason) return { rejected: reason }
    const assessed = await assess(state, parts, plan, ctx, anchor, searchOn, run)
    if (!assessed) return null
    tried.set(key, assessed)
    evaluations += 1
    log.push({ n: evaluations, why, worst: assessed.worst, total: assessed.total, pref: assessed.pref, demand: baseMainTotal(parts) })
    progress(evaluations, why)
    return assessed
  }

  progress(0, startingPoint.isCurrent ? 'The current event' : 'The starting point')
  let best = await play(start, startingPoint.isCurrent ? 'the current event' : `the starting point: the current event with ${notes.join('; ')}`)
  if (best === null) return stamp({ status: 'cancelled', stopReason: 'cancelled', evaluations, startingPoint })
  if (best.rejected) return stamp({ status: 'invalid', problems: [`No starting point inside the bounds typed could be made from this event (${best.rejected}). Widen a bound, or allow more to change; nothing is widened by itself.`], evaluations, stopReason: 'invalid', startingPoint })
  const startAssessed = best
  let stopReason = 'candidates'
  let cancelled = false
  // (Testing each new schedule without it comes after, one version each - at most the number of schedules allowed.)
  const searchBudget = Math.max(1, plan.search.candidates)

  if (plan.change.recipes) {
    for (let i = 0; i < 3 && evaluations < searchBudget; i += 1) {
      const fitted = fitRecipes(state, best, plan, ctx, 0.92 - i * 0.04)
      if (!fitted) break
      const assessed = await play(fitted, ctx.bounded ? `recipes fitted to what players receive, inside the budget range ${plan.budget.min}-${plan.budget.max}` : 'recipes fitted to what the slower players of the weakest segment receive (free budget)')
      if (assessed === null) {
        cancelled = true
        break
      }
      if (assessed.rejected) continue
      if (isBetter(assessed, best)) best = assessed
    }
  }
  const rng = createRng(plan.search.seed)
  let failures = 0
  let idle = 0
  while (!cancelled && evaluations < searchBudget) {
    if ((Date.now() - started) / 1000 > plan.search.seconds) {
      stopReason = 'time'
      break
    }
    const candidate = nextCandidate(state, best, plan, ctx, rng, idle)
    if (!candidate) {
      failures += 1
      if (failures > 300) {
        stopReason = 'nothing-to-change'
        break
      }
      continue
    }
    const assessed = await play(candidate.parts, candidate.why)
    if (assessed === null) {
      cancelled = true
      break
    }
    if (assessed.rejected) {
      failures += 1
      if (failures > 300) {
        stopReason = 'no-valid-step'
        break
      }
      continue
    }
    if (isBetter(assessed, best)) {
      best = assessed
      idle = 0
    } else idle += 1
    if (best.worst <= 0 && idle >= 12) {
      stopReason = 'settled'
      break
    }
    if (idle >= (plan.search.patience ?? 25)) {
      stopReason = 'stalled'
      break
    }
  }
  // A NEW ordinary schedule has to earn its place: each is taken away in turn, and stays away when the targets do
  // not suffer (the worst segment and all segments within half a point).
  const pruned = []
  for (const t of best.parts.thresholds.filter((x) => isNewSchedule(state, x) && isOrdinary(ctx.byId[x.ingredientId]))) {
    if (cancelled) break
    const without = clone(best.parts)
    without.thresholds = without.thresholds.filter((x) => x.id !== t.id)
    const why = `is ${ctx.byId[t.ingredientId].name}'s new schedule needed? Played without it`
    let assessed = await play(without, why)
    // (Played already during the search: that result is read again, and said so.)
    if (assessed?.rejected === 'played already' && assessed.cached) {
      assessed = assessed.cached
      log.push({ n: evaluations, why: `${why} (played before, read again)`, worst: assessed.worst, total: assessed.total, pref: assessed.pref, demand: baseMainTotal(without) })
    }
    if (assessed === null) {
      cancelled = true
      break
    }
    if (assessed.rejected) continue
    if (assessed.worst <= best.worst + 0.005 && assessed.total <= best.total + 0.005) {
      best = assessed
      pruned.push(t.ingredientId)
    }
  }
  if (cancelled) {
    return stamp({ status: 'cancelled', stopReason: 'cancelled', evaluations, log: log.slice(-60), startingPoint, note: 'Stopped before the best candidate was checked on other players. The event is as it was; nothing can be applied from a search that was not checked.' })
  }

  // The check on OTHER players: the current event and the proposal, the same players for both.
  const validateOn = { players: plan.search.validationPlayers, seed: plan.search.seed + 7919 }
  const incomplete = () => stamp({ status: 'incomplete', stopReason: 'cancelled', evaluations, log: log.slice(-60), startingPoint, note: 'Stopped while the proposal was being checked on other players. Nothing was applied, and nothing can be: the check did not finish.' })
  progress(plan.search.candidates + 1, 'Checking the current event on other players')
  const baseValidated = baselineComplete ? await assess(state, baseline, plan, ctx, anchor, validateOn, run) : null
  if (baselineComplete && baseValidated === null) return incomplete()
  progress(plan.search.candidates + 3, 'Checking the proposal on other players')
  const changed = JSON.stringify(best.parts) !== JSON.stringify(baseline)
  const proposedValidated = changed ? await assess(state, best.parts, plan, ctx, anchor, validateOn, run) : baseValidated
  if (proposedValidated === null) return incomplete()

  const changes = diff(state, baseline, best.parts, ctx)
  // WHERE THE GAIN CAME FROM (a reading, on the same players; nothing is chosen with it): the current event with only
  // the proposal's recipes, when the proposal also changed weights or schedules.
  let recipesOnly = null
  if (baseValidated && changes.recipes.length && changes.count > changes.recipes.length) {
    progress(plan.search.candidates + 5, 'Reading how much came from the recipes alone')
    const only = { ...clone(baseline), dishes: clone(best.parts.dishes), recompletionDishes: clone(best.parts.recompletionDishes) }
    const assessed = await assess(state, only, plan, ctx, anchor, validateOn, run)
    if (assessed === null) return incomplete()
    recipesOnly = assessed.segments.map((s) => ({ id: s.id, shortfalls: s.shortfalls.map((x) => ({ id: x.id, share: x.share })), finish: s.result.finish.share }))
  }
  // THE OTHER VIEW OF THE PLAYERS (economist: show both views - "basket luck only" and "player activity and basket
  // luck" - since the 80% targets depend on the activity assumptions). The current event and the proposal are played
  // on the same check players the other way too. A reading only: the search and the verdicts use the view chosen.
  const otherVariation = ctx.variation === 'activity' ? 'baskets' : 'activity'
  const compact = (assessed) => assessed && assessed.segments.map((s) => ({ id: s.id, shortfalls: s.shortfalls.map((x) => ({ id: x.id, kind: x.kind, share: x.share, target: x.target })), finish: s.result.finish.share }))
  progress(plan.search.candidates + 6, `Playing the current event and the proposal with ${VARIATION_LABELS[otherVariation].toLowerCase()}`)
  const baseOther = baselineComplete ? await assess(state, baseline, plan, ctx, anchor, { ...validateOn, variation: otherVariation }, run) : null
  if (baselineComplete && baseOther === null) return incomplete()
  const proposedOther = changed ? await assess(state, best.parts, plan, ctx, anchor, { ...validateOn, variation: otherVariation }, run) : baseOther
  if (proposedOther === null) return incomplete()
  const otherView = { variation: otherVariation, base: compact(baseOther), proposed: compact(proposedOther) }

  const noBetter = !!baseValidated && (!changed || !isBetter(proposedValidated, baseValidated))
  const status = noBetter ? 'no-better' : proposedValidated.worst <= 0 ? 'meets' : 'misses'
  const judged = (assessed) => assessed && assessed.segments.map((s) => ({ ...s, shortfalls: s.shortfalls.map((x) => ({ ...x, verdict: verdictOf(x, s.result.players, ctx.tolerance) })) }))
  const proposedSegments = judged(proposedValidated)
  const unsure = proposedSegments.flatMap((s) => s.shortfalls).filter((x) => x.verdict.endsWith('unsure')).length
  const proposedState = { ...state, ...best.parts }
  const current = baselineComplete ? baseMainTotal(baseline) : null
  return stamp({
    status,
    stopReason,
    evaluations,
    runtimeMs: Date.now() - started,
    log: log.slice(-80),
    patch: best.parts,
    proposedFingerprint: fingerprint(proposedState),
    changes,
    baselineComplete,
    startingPoint,
    addedSchedules: withSchedules.added,
    prunedSchedules: pruned,
    budget: { mode: plan.change.recipes ? plan.budget.mode : 'locked', reference: ctx.reference, min: ctx.bounded ? plan.budget.min : null, max: ctx.bounded ? plan.budget.max : null, current, start: startingPoint.total, proposed: baseMainTotal(best.parts), changePct: current ? (baseMainTotal(best.parts) - current) / current : null, currentInRange: ctx.bounded && current != null ? current >= plan.budget.min && current <= plan.budget.max : null },
    semi: { before: semiExposure(state, baseline), after: semiExposure(state, best.parts) },
    recipesOnly,
    otherView,
    validation: { base: judged(baseValidated), proposed: proposedSegments, baseScore: baseValidated && { worst: baseValidated.worst, total: baseValidated.total, pref: baseValidated.pref, terms: baseValidated.terms }, proposedScore: { worst: proposedValidated.worst, total: proposedValidated.total, pref: proposedValidated.pref, terms: proposedValidated.terms } },
    searchScore: { start: { worst: startAssessed.worst, total: startAssessed.total }, best: { worst: best.worst, total: best.total } },
    unsure,
    explanations: explain(state, changes, baseValidated, proposedValidated, ctx),
    rcNote: ctx.rounds.includes('rc') && !ctx.rcTargeted ? 'Recompletion has no approved speed, so its recipes and thresholds were left as they are. Type a target for it (days to its FU after entering, and a share of the players who enter) to let a proposal change them.' : null,
  })
}

// --- Apply, discard, undo ------------------------------------------------------

// A proposal can be applied while the event AND the controls are the ones it was generated for, and when it was made
// by this version of the search. One that misses targets can still be applied (with its warnings).
export const madeByOlderSearch = (proposal) => !!proposal && proposal.search !== SEARCH_VERSION
export const proposalIsStale = (state, proposal, plan = planOf(state)) => !!proposal?.patch && !proposal.appliedAt && (madeByOlderSearch(proposal) || proposal.baseFingerprint !== fingerprint(state) || proposal.planKey !== planKeyOf(plan))
export const staleReason = (state, proposal, plan = planOf(state)) =>
  !proposalIsStale(state, proposal, plan)
    ? null
    : madeByOlderSearch(proposal)
      ? `It was made by an earlier version of the generator (${proposal.search}), before the recipe budget was a choice and before new schedules could be made, so it does not carry what this one checks.`
      : proposal.baseFingerprint !== fingerprint(state)
        ? 'The event was changed after this proposal was generated, so its figures are no longer about this event.'
        : 'What a proposal may change was edited after this one was generated, so it may no longer respect the locks and bounds on screen.'
export const canApply = (state, proposal, plan = planOf(state)) => !!proposal?.patch && ['meets', 'misses'].includes(proposal.status) && !proposal.appliedAt && !proposalIsStale(state, proposal, plan)
// Whether the event in use is exactly the one the proposal's figures were measured on.
export const proposalIsInUse = (state, proposal) => !!proposal?.appliedAt && proposal.proposedFingerprint === fingerprint(state)

// The event with the proposal applied, all of it at once. What was there before is kept for one undo.
export function applyProposal(state, proposal, plan = planOf(state)) {
  if (!canApply(state, proposal, plan)) return state
  const previous = pickParts(state)
  const appliedAt = new Date().toISOString()
  return { ...state, ...clone(proposal.patch), generator: { ...(state.generator ?? {}), proposal: { ...proposal, appliedAt }, applied: { proposalId: proposal.id, at: appliedAt, previous } } }
}
export function undoProposal(state) {
  const applied = state.generator?.applied
  if (!applied) return state
  const { appliedAt: _appliedAt, ...proposal } = state.generator.proposal ?? {}
  return { ...state, ...clone(applied.previous), generator: { ...state.generator, applied: null, proposal: state.generator.proposal ? proposal : null } }
}

// The proposal played without the catch-up presets (a diagnostic; the presets themselves are not touched).
export function withoutPresets(state, proposal, plan) {
  const ctx = context(state, plan)
  const full = { ...state, ...(proposal.appliedAt ? {} : proposal.patch) }
  return ctx.segments.map((segment) => {
    const r = simulateSegment(full, segment, { players: proposal.settings.validationPlayers, seed: proposal.settings.validationSeed, variation: proposal.settings.variation, usePresets: false })
    return { id: segment.id, name: segment.name, inFu: r.fuTarget?.inFu ?? null, finished: r.finish.share }
  })
}

// What build 03 (catch-up suggestions, chefCatchup.js) reads the same way a proposal does: the targets, a
// segment's shortfalls against them, the order of "better", and a verdict on the check players.
export { context as generatorContext, measure as measureSegment, verdictOf }

// The phases a basket's weights belong to are not created or moved by a proposal; this says when more would help.
export function periodNote(state) {
  const fuDay = state.targets?.mainFuDay
  if (fuDay == null) return null
  const phase = phaseForDay(state.calendar, fuDay)
  return state.calendar.phases.length < 2 ? 'This event has one period of basket odds, so a weight is the same on every day. A proposal changes weights inside the periods that exist; it does not add one.' : `Basket odds change only between the ${state.calendar.phases.length} periods typed in step 1 (the FU day is in ${phase?.label}). A proposal changes weights inside them and does not add or move a period.`
}

// The days the existing schedules step on (offered on screen as days a new schedule may use - typed, not assumed).
export const existingStepDays = (state) => [...new Set(state.thresholds.flatMap((t) => t.steps.map((s) => s.fromDay)).filter((d) => d > 1))].sort((a, b) => a - b)
