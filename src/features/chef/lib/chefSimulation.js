import { dishPrizeValueForSegment, dailyActivityMultiplier } from './chefModel'
import { createRngStreams, randomSeed, binomialMarginOfError } from './chefRng'

// Day-by-day dish-completion simulator - the first of the "2 big things"
// the economist asked for (see CLAUDE.md's Chef section): given a segment's
// own avg-baskets-opened-per-day rate, walk the event's calendar day by
// day and report when that segment reaches what dish-completion level.
//
// Deterministic expected-value math, not Monte Carlo - same precedent
// Merge's own `simulatePlaythrough`/`createEvScheduler` already set for
// this kind of planning tool (see CLAUDE.md's "Push/stall"/"Lucky drops"
// sections): a real per-basket roll is genuinely random (see
// chefModel.js's createBasket doc comment), but this simulator cares about
// the SHAPE of the completion curve a segment's average behavior produces,
// not player-to-player variance - a Monte Carlo pass can be added later as
// a separate "run N simulated players" button if variance specifically
// becomes the question, the same way Merge's own lucky-drop Monte Carlo
// sits alongside its deterministic playthrough simulator rather than
// replacing it.

// Expected ingredient yield from ONE basket open, per ingredient - the
// basket's own total-count range collapses to its midpoint, then that
// expected total is split across ingredients proportionally to weight,
// clamped at each ingredient's own real per-open max (the cap a single
// basket open can ever hand out of one ingredient, regardless of how the
// weighted math would split it). At the weight/max ratios seen in every
// real basket transcribed so far, the clamp rarely binds at the midpoint
// total - it exists so a future basket config with a tighter max doesn't
// silently return an impossible expectation.
// `weights` defaults to the basket's real player-facing odds
// (`ingredientWeights`) but accepts an override - the basket-value
// estimator (chefBasketValue.js) passes `pricingIngredientWeights` instead,
// since that's a separate weight table meant specifically for value
// estimation rather than real play.
export function expectedYieldPerBasket(basket, weights = basket.ingredientWeights) {
  const totalAvg = (basket.totalMin + basket.totalMax) / 2
  const sumWeight = weights.reduce((sum, w) => sum + w.weight, 0)
  const byIngredient = {}
  for (const w of weights) {
    const share = sumWeight > 0 ? (totalAvg * w.weight) / sumWeight : 0
    byIngredient[w.ingredientId] = Math.min(share, w.max)
  }
  return byIngredient
}

// Which phase (and which basket config per chest type) is active on a
// given 1-indexed calendar day.
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
  for (const b of baskets) {
    if (b.phaseId === phaseId) byChestType[b.chestType] = b
  }
  return byChestType
}

// Greedily completes dishes the instant the running ingredient pool can
// afford one - consuming its recipe from the pool when it does. `strategy`
// picks the ORDER candidates are tried in each pass:
// - `'list-order'` (default): try dishes in their own list order - "craft
//   whatever you can, in the order they're defined," the simplest honest
//   reading of "when does this segment reach what dish-completion level."
// - `'prize-first'`: by explicit economist brainstorm ask (crafting
//   strategy comparison) - try the highest-prize-value-for-this-segment
//   dish first each pass, modeling a player who deliberately chases the
//   biggest reward before anything else. Needs `segment` to resolve each
//   dish's own segment-tiered prize value (see dishPrizeValueForSegment).
// Either strategy can only ever change the ORDER/TIMING dishes complete
// in, never the event's own total completable-dish count - every recipe
// still draws from the same shared pool either way.
function tryCompleteDishes(pool, dishes, alreadyCompleted, strategy = 'list-order', segment = null) {
  const newlyCompleted = []
  let progress = true
  while (progress) {
    progress = false
    const candidates =
      strategy === 'prize-first'
        ? [...dishes].sort((a, b) => dishPrizeValueForSegment(b, segment) - dishPrizeValueForSegment(a, segment))
        : dishes
    for (const dish of candidates) {
      if (alreadyCompleted.has(dish.id)) continue
      const canAfford = dish.recipe.every((r) => (pool[r.ingredientId] ?? 0) >= r.count)
      if (!canAfford) continue
      for (const r of dish.recipe) pool[r.ingredientId] -= r.count
      alreadyCompleted.add(dish.id)
      newlyCompleted.push(dish.id)
      progress = true
    }
  }
  return newlyCompleted
}

// Runs the full calendar for one segment using plain expected-value math
// (no randomness at all) - cheap, deterministic, and exactly reproducible,
// which makes it the right tool for things that need to be stable across
// re-renders (the Basket value tab's own day-by-day chart builds on
// `expectedYieldPerBasket` the same way). `avgBasketsPerDayOverride`
// (optional, same `{basic, rare, epic}` shape as `segment.avgBasketsPerDay`)
// lets a caller try a hypothetical rate without mutating the segment
// itself. See `simulateMonteCarlo` below for the real-random-rolls version
// this feeds into the Simulation tab's own chart - that one captures
// player-to-player VARIANCE (e.g. "how likely is a typical P50 player to
// have finished the mid-blocker dishes by day 10"), which this
// single-deterministic-line version cannot, by construction.
export function simulateCompletion({ segment, dishes, baskets, calendar, avgBasketsPerDayOverride = null, strategy = 'list-order' }) {
  const rate = avgBasketsPerDayOverride ?? segment.avgBasketsPerDay
  const pool = {}
  const completed = new Set()
  const days = []

  for (let day = 1; day <= calendar.totalDays; day += 1) {
    const phase = phaseForDay(calendar, day)
    const basketsByChestType = basketsForPhase(baskets, phase?.id)
    const activityMultiplier = dailyActivityMultiplier(segment.activityShape, calendar, day)

    for (const chestType of Object.keys(rate)) {
      const basket = basketsByChestType[chestType]
      const opensPerDay = (rate[chestType] ?? 0) * activityMultiplier
      if (!basket || opensPerDay <= 0) continue
      const perBasket = expectedYieldPerBasket(basket)
      for (const [ingredientId, amount] of Object.entries(perBasket)) {
        pool[ingredientId] = (pool[ingredientId] ?? 0) + amount * opensPerDay
      }
    }

    const newlyCompleted = tryCompleteDishes(pool, dishes, completed, strategy, segment)
    days.push({
      day,
      phaseId: phase?.id ?? null,
      ingredientPool: { ...pool },
      dishesCompletedCount: completed.size,
      newlyCompletedDishIds: newlyCompleted,
    })
  }

  return { days, totalDishes: dishes.length, dishesCompleted: completed.size }
}

// --- Monte Carlo engine -----------------------------------------------
//
// By explicit economist request ("we need to do a lot of runs and get the
// average, I guess"): a single deterministic EV line answers "what's the
// expected shape," but it can't answer "how spread out are real players
// around that shape" - and a real basket roll genuinely IS random (see
// createBasket's own doc comment). This engine simulates many independent
// "virtual players," each rolling REAL random baskets day by day, then
// reports the mean plus a spread (P10/P50/P90) per day across all of them -
// the same "don't just show the average, show the shape of outcomes"
// principle Merge's own lucky-drop Monte Carlo sim already follows
// (CLAUDE.md's "Lucky-drop simulator" section - mean AND min-max AND a
// zero-count, not just a mean).

// One real, random basket open: roll a TOTAL count in [totalMin,totalMax],
// then hand it out one unit at a time via a weighted draw across
// ingredients - excluding an ingredient the instant it hits ITS OWN max
// for this basket open and redistributing the remaining odds across what's
// left, the same "exclude once capped, redistribute" shape this app's own
// ingredient-cap rules already use elsewhere. This is a faithful
// per-basket roll, not an averaged approximation - `expectedYieldPerBasket`
// above is the cheap EV shortcut; this is the real mechanic.
// `rngSize`/`rngPick` default to `Math.random` so every existing caller
// that doesn't care about reproducibility is unaffected - `simulateOnePlaythrough`
// below is the one real caller, and it always passes its own seeded
// streams (see chefRng.js's createRngStreams doc comment for why total-
// count rolls and per-unit ingredient picks are kept on SEPARATE streams).
export function rollBasket(basket, weights = basket.ingredientWeights, rngSize = Math.random, rngPick = Math.random) {
  const total = basket.totalMin + Math.floor(rngSize() * (basket.totalMax - basket.totalMin + 1))
  const remainingMax = {}
  for (const w of weights) remainingMax[w.ingredientId] = w.max
  const counts = {}
  let remaining = total
  while (remaining > 0) {
    const eligible = weights.filter((w) => w.weight > 0 && remainingMax[w.ingredientId] > 0)
    if (eligible.length === 0) break
    const sumWeight = eligible.reduce((sum, w) => sum + w.weight, 0)
    let r = rngPick() * sumWeight
    let chosen = eligible[eligible.length - 1]
    for (const w of eligible) {
      if (r < w.weight) {
        chosen = w
        break
      }
      r -= w.weight
    }
    counts[chosen.ingredientId] = (counts[chosen.ingredientId] ?? 0) + 1
    remainingMax[chosen.ingredientId] -= 1
    remaining -= 1
  }
  return counts
}

// A fractional avg-baskets/day (e.g. 2.6) can't literally open 2.6 baskets
// on any one day - this samples an integer open-count whose LONG-RUN
// average across many days converges exactly to `rate` (floor every day,
// plus one more with probability equal to the fractional remainder), the
// standard "stochastic rounding" trick for turning a rate into a count.
function sampleDailyOpens(rate, rng = Math.random) {
  const whole = Math.floor(rate)
  const frac = rate - whole
  return whole + (rng() < frac ? 1 : 0)
}

// Per-PLAYER activity variance - the single highest-ranked model
// improvement from a GPT brainstorm review: "a daily activity shape
// controls WHEN the segment's expected activity happens - it doesn't
// represent differences between players. Two players averaging two
// baskets daily could actually be one player opening four and another
// opening none." Without this, every simulated player behaves identically
// on any given day (same rate, same shape), so the Monte Carlo spread
// (P10/P90) only ever came from basket-roll randomness, never from real
// player-to-player behavioral differences - understating true variance.
//
// Two persistent traits are drawn ONCE per player (not resampled daily):
// - `activityMultiplier` (uniform 0.4-1.6, mean exactly 1.0): some
//   players are just heavier/lighter than the segment's own average,
//   consistently, for their whole run - not a fresh dice roll each day.
// - `activeDayProbability` (uniform 0.55-1.0): this player's own long-run
//   fraction of days they engage with Chef at all.
//
// `ACTIVITY_PERSISTENCE` (0.5) makes active/inactive STREAK across
// consecutive days (a simple two-state Markov chain, not an independent
// coin flip per day) - by explicit design note ("persistent differences
// and consecutive missed days matter"). The transition probabilities
// below are the standard construction that holds the chain's stationary
// probability exactly at `activeDayProbability` regardless of the
// persistence constant (verified algebraically: substituting these into
// the stationary-distribution formula for a 2-state Markov chain reduces
// to exactly `activeDayProbability`, for any persistence in [0,1)) - so
// turning up streakiness never secretly shifts how often a player is
// active overall, only how clustered those active days are.
//
// Expected-value preservation (both per-player and population-wide): the
// basket rate is divided by `activeDayProbability` on active days and
// zeroed on inactive ones, so ONE player's own long-run average across
// many days is exactly `rate * activityMultiplier` regardless of their own
// `activeDayProbability` - streakiness changes variance, never the mean.
// Averaging `activityMultiplier` over many players (mean 1.0 by
// construction) then recovers the segment's own configured rate exactly,
// so this is a pure variance-adding change - it cannot silently shift a
// segment's overall expected completion the way a biased draw would.
const ACTIVITY_MULTIPLIER_RANGE = [0.4, 1.6]
const ACTIVE_DAY_PROBABILITY_RANGE = [0.55, 1.0]
const ACTIVITY_PERSISTENCE = 0.5

function sampleUniform(rng, [min, max]) {
  return min + rng() * (max - min)
}

function createPlayerActivityTraits(rng) {
  const activityMultiplier = sampleUniform(rng, ACTIVITY_MULTIPLIER_RANGE)
  const activeDayProbability = sampleUniform(rng, ACTIVE_DAY_PROBABILITY_RANGE)
  let active = rng() < activeDayProbability
  const stayActive = activeDayProbability + ACTIVITY_PERSISTENCE * (1 - activeDayProbability)
  const stayInactive = 1 - activeDayProbability + ACTIVITY_PERSISTENCE * activeDayProbability
  return {
    activityMultiplier,
    activeDayProbability,
    // Returns whether THIS day is active, then advances the chain's
    // internal state for the next call.
    nextDayActive() {
      const today = active
      active = rng() < (active ? stayActive : stayInactive)
      return today
    },
  }
}

// One simulated player's full run through the calendar, with real random
// basket rolls - returns the per-day cumulative dishes-completed count
// plus which day each individual dish got completed (not the full
// ingredient pool/history every day), since a Monte Carlo run only needs
// those two things and keeping more would multiply memory use by `runs`
// for no benefit.
//
// `grants` (see chefModel.js's createGrant) model ingredients the business
// hands out OUTSIDE the basket economy entirely - direct sales bundles or
// event rewards - by explicit economist observation ("after [some days in
// phase 1] we expect many users... to finish the mid blocker dishes
// because we also sell them and give them in events"). Each grant is
// `{day, ingredientId, amount, coveragePct}`.
//
// Grant eligibility is CORRELATED across grants for the same player, not
// independent per grant per day - a real risk a GPT brainstorm review
// caught: "if two grants each reach 20% of players, are they going to the
// same spenders or independent groups?" Rolling independently would answer
// "independent groups" by construction, silently understating how
// concentrated real sale/event targeting usually is (the same whales tend
// to buy every bundle). Modeled here with the simplest directional fix:
// each player gets ONE persistent `engagementPercentile` for the whole run
// (lower = more engaged/likely to convert), and a grant with `coveragePct`
// N reaches every player whose percentile is below N/100 - so a 50%-
// coverage grant is a strict superset of a 20%-coverage grant's audience,
// the same player, every time, rather than a fresh independent roll per
// grant. This is a first-pass correlation model (perfectly rank-correlated
// by one axis), not a full purchase-behavior simulation - revisit if real
// grant-attach telemetry ever shows a different shape.
function simulateOnePlaythrough({
  segment,
  dishes,
  baskets,
  calendar,
  grants = [],
  avgBasketsPerDayOverride = null,
  strategy = 'list-order',
  rngStreams = createRngStreams(randomSeed()),
  extraBasket = null,
}) {
  const rate = avgBasketsPerDayOverride ?? segment.avgBasketsPerDay
  const pool = {}
  const completed = new Set()
  const perDayCompletedCount = []
  const dishDayCompleted = {}
  const engagementPercentile = rngStreams.grants()
  const playerTraits = createPlayerActivityTraits(rngStreams.activity)
  let lastCraftDay = 0
  let longestGapSinceLastCraft = 0

  for (let day = 1; day <= calendar.totalDays; day += 1) {
    const phase = phaseForDay(calendar, day)
    const basketsByChestType = basketsForPhase(baskets, phase?.id)
    const dayShapeMultiplier = dailyActivityMultiplier(segment.activityShape, calendar, day)
    const isActiveToday = playerTraits.nextDayActive()

    for (const chestType of Object.keys(rate)) {
      const basket = basketsByChestType[chestType]
      if (!basket) continue
      const baseRate = (rate[chestType] ?? 0) * dayShapeMultiplier * playerTraits.activityMultiplier
      const effectiveRate = isActiveToday ? baseRate / playerTraits.activeDayProbability : 0
      const opens = sampleDailyOpens(effectiveRate, rngStreams.activity)
      for (let i = 0; i < opens; i += 1) {
        const rolled = rollBasket(basket, basket.ingredientWeights, rngStreams.basketSize, rngStreams.ingredientPick)
        for (const [ingredientId, amount] of Object.entries(rolled)) {
          pool[ingredientId] = (pool[ingredientId] ?? 0) + amount
        }
      }
      // The basket-value estimator's paired-simulation marginal-value
      // method (see estimateMarginalBasketValue below) injects exactly one
      // extra basket open on a specific day/chest-type, everything else
      // identical (same seed, same streams) - isolating that one basket's
      // own causal effect on eventual payout.
      if (extraBasket && extraBasket.day === day && extraBasket.chestType === chestType) {
        const rolled = rollBasket(basket, basket.ingredientWeights, rngStreams.basketSize, rngStreams.ingredientPick)
        for (const [ingredientId, amount] of Object.entries(rolled)) {
          pool[ingredientId] = (pool[ingredientId] ?? 0) + amount
        }
      }
    }

    for (const grant of grants) {
      if (grant.day !== day) continue
      if (engagementPercentile < (grant.coveragePct ?? 100) / 100) {
        pool[grant.ingredientId] = (pool[grant.ingredientId] ?? 0) + grant.amount
      }
    }

    const newlyCompleted = tryCompleteDishes(pool, dishes, completed, strategy, segment)
    for (const dishId of newlyCompleted) dishDayCompleted[dishId] = day
    if (newlyCompleted.length > 0) {
      // "Longest period without a craft" - by explicit economist
      // brainstorm ask (stalled-progress diagnostics): a segment can look
      // fine on mean completion while actually spending a long stretch of
      // the event completely stuck, which a day-by-day completion COUNT
      // alone doesn't surface - this measures the gap directly.
      longestGapSinceLastCraft = Math.max(longestGapSinceLastCraft, day - lastCraftDay - 1)
      lastCraftDay = day
    }
    perDayCompletedCount.push(completed.size)
  }
  longestGapSinceLastCraft = Math.max(longestGapSinceLastCraft, calendar.totalDays - lastCraftDay)
  const firstCraftDay = Object.values(dishDayCompleted).length > 0 ? Math.min(...Object.values(dishDayCompleted)) : null

  // Near-miss diagnostics - by explicit economist brainstorm ask: for
  // every dish NOT completed by event end, is it blocked on exactly ONE
  // ingredient (every other requirement already satisfied)? A dish that's
  // one short on a single ingredient is a very different design problem
  // ("that one ingredient is slightly too scarce") than one that's short
  // on everything ("this dish was never realistically reachable").
  const nearMissIngredientByDish = {}
  for (const dish of dishes) {
    if (completed.has(dish.id)) continue
    const shortIngredients = dish.recipe.filter((r) => (pool[r.ingredientId] ?? 0) < r.count)
    if (shortIngredients.length === 1) nearMissIngredientByDish[dish.id] = shortIngredients[0].ingredientId
  }

  // Leftover ingredients still sitting in the pool once the event ends -
  // by explicit economist brainstorm ask (waste/stockout tracking): a big
  // leftover average for some ingredient means its basket odds are
  // over-indexed relative to what any dish actually needs of it.
  return { perDayCompletedCount, dishDayCompleted, finalPool: pool, nearMissIngredientByDish, totalDishes: dishes.length, firstCraftDay, longestGapSinceLastCraft }
}

// Sum of every completed dish's own segment-tiered prize value, plus the
// whole-event grand-completion bonus if every dish got completed - the
// real in-game REWARD payout a run produced, as opposed to a bare
// dishes-completed count. Feeds `simulateMonteCarlo`'s optional payout
// stats and `estimateMarginalBasketValue` below.
function totalPayoutValue(completedDishIds, dishes, segment, totalChefPrizeValue = 0) {
  const completedSet = new Set(completedDishIds)
  let total = 0
  for (const dish of dishes) {
    if (completedSet.has(dish.id)) total += dishPrizeValueForSegment(dish, segment)
  }
  if (completedSet.size === dishes.length && dishes.length > 0) total += totalChefPrizeValue
  return total
}

function percentile(sortedValues, p) {
  const idx = Math.min(sortedValues.length - 1, Math.floor(p * sortedValues.length))
  return sortedValues[idx]
}

// Runs `runs` independent simulated players (default 300 - enough for a
// stable P10/P50/P90 read without taking noticeably long; bump it from the
// UI if a tighter read is needed) and reports:
// - per-day mean + P10/P50/P90 + min/max dishes-completed-count across all
//   of them (the completion-curve chart), plus a per-day `fullClearFraction`
//   + `fullClearMarginOfError` - by explicit economist brainstorm ask
//   ("mean dish completion can conceal everyone-at-80% vs 80%-at-100%-and-
//   20%-at-0%"), the fraction of runs that had ALL dishes done by that day,
//   not just the average count, with a 95% sampling margin so a rate read
//   off a few hundred runs isn't mistaken for an exact number;
// - per-DISH completion-day stats (`dishStats`) - for each real dish, what
//   fraction of runs ever completed it at all, and the P10/P50/P90 day it
//   happened on among the runs that did;
// - `nearMissStats` - across every run that did NOT fully clear, which
//   single ingredient most often left a dish exactly one short; and
// - `payoutStats` (only when `totalChefPrizeValue` is passed) - the real
//   reward VALUE a run produced (see `totalPayoutValue`), not just a dish
//   count, needed by `estimateMarginalBasketValue` below.
//
// `seed` makes the whole run reproducible (see chefRng.js) - two calls with
// the same seed and the same `runs` count produce bit-identical results,
// which is what makes `estimateMarginalBasketValue`'s paired comparison
// valid. Omit it for ordinary exploratory use, where fresh randomness each
// click is the expected, honest behavior.
export function simulateMonteCarlo({
  segment,
  dishes,
  baskets,
  calendar,
  grants = [],
  runs = 300,
  avgBasketsPerDayOverride = null,
  strategy = 'list-order',
  seed = null,
  totalChefPrizeValue = null,
  extraBasket = null,
}) {
  const streams = createRngStreams(seed ?? randomSeed())
  const allRuns = []
  for (let i = 0; i < runs; i += 1) {
    allRuns.push(simulateOnePlaythrough({ segment, dishes, baskets, calendar, grants, avgBasketsPerDayOverride, strategy, rngStreams: streams, extraBasket }))
  }

  const days = []
  for (let d = 0; d < calendar.totalDays; d += 1) {
    const values = allRuns.map((run) => run.perDayCompletedCount[d]).sort((a, b) => a - b)
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length
    const fullClearFraction = values.filter((v) => v === dishes.length).length / runs
    days.push({
      day: d + 1,
      mean,
      p10: percentile(values, 0.1),
      p50: percentile(values, 0.5),
      p90: percentile(values, 0.9),
      min: values[0],
      max: values[values.length - 1],
      fullClearFraction,
      fullClearMarginOfError: binomialMarginOfError(fullClearFraction, runs),
    })
  }

  const dishStats = dishes.map((dish) => {
    const completionDays = allRuns.map((run) => run.dishDayCompleted[dish.id]).filter((d) => d != null).sort((a, b) => a - b)
    const reachedFraction = completionDays.length / runs
    return {
      dishId: dish.id,
      reachedFraction,
      reachedMarginOfError: binomialMarginOfError(reachedFraction, runs),
      p10: completionDays.length ? percentile(completionDays, 0.1) : null,
      p50: completionDays.length ? percentile(completionDays, 0.5) : null,
      p90: completionDays.length ? percentile(completionDays, 0.9) : null,
    }
  })

  const leftoverIngredientIds = new Set()
  for (const run of allRuns) for (const ingredientId of Object.keys(run.finalPool)) leftoverIngredientIds.add(ingredientId)
  const leftoverStats = [...leftoverIngredientIds].map((ingredientId) => {
    const total = allRuns.reduce((sum, run) => sum + (run.finalPool[ingredientId] ?? 0), 0)
    return { ingredientId, mean: total / runs }
  })

  const nearMissCounts = {}
  for (const run of allRuns) {
    for (const ingredientId of new Set(Object.values(run.nearMissIngredientByDish))) {
      nearMissCounts[ingredientId] = (nearMissCounts[ingredientId] ?? 0) + 1
    }
  }
  const nearMissStats = Object.entries(nearMissCounts)
    .map(([ingredientId, count]) => ({ ingredientId, runFraction: count / runs }))
    .sort((a, b) => b.runFraction - a.runFraction)

  // Stalled-progress stats - by explicit economist brainstorm ask: how
  // long before a typical player's first craft, and the longest stretch
  // any run went without completing anything (the gap after the last
  // craft through event end counts too, so a run that crafts early and
  // then goes completely quiet isn't scored as "no gap").
  const firstCraftDays = allRuns.map((run) => run.firstCraftDay).filter((d) => d != null).sort((a, b) => a - b)
  const gaps = allRuns.map((run) => run.longestGapSinceLastCraft).sort((a, b) => a - b)
  const stalledStats = {
    firstCraftDayP10: firstCraftDays.length ? percentile(firstCraftDays, 0.1) : null,
    firstCraftDayP50: firstCraftDays.length ? percentile(firstCraftDays, 0.5) : null,
    firstCraftDayP90: firstCraftDays.length ? percentile(firstCraftDays, 0.9) : null,
    neverCraftedFraction: (runs - firstCraftDays.length) / runs,
    longestGapP50: gaps.length ? percentile(gaps, 0.5) : null,
    longestGapP90: gaps.length ? percentile(gaps, 0.9) : null,
  }

  let payoutStats = null
  if (totalChefPrizeValue != null) {
    const payouts = allRuns.map((run) => totalPayoutValue(Object.keys(run.dishDayCompleted), dishes, segment, totalChefPrizeValue)).sort((a, b) => a - b)
    payoutStats = {
      mean: payouts.reduce((sum, v) => sum + v, 0) / payouts.length,
      p10: percentile(payouts, 0.1),
      p50: percentile(payouts, 0.5),
      p90: percentile(payouts, 0.9),
    }
  }

  const finalFullClear = days[days.length - 1]?.fullClearFraction ?? 0

  return {
    days,
    runs,
    totalDishes: dishes.length,
    dishStats,
    leftoverStats,
    nearMissStats,
    payoutStats,
    stalledStats,
    finalFullClearFraction: finalFullClear,
    finalFullClearMarginOfError: binomialMarginOfError(finalFullClear, runs),
  }
}

// --- Sensitivity sweep --------------------------------------------------
//
// By explicit economist brainstorm ask: instead of reading one avg-
// baskets/day number as gospel, sweep it by a range of % deltas and show
// how final completion moves - answers "how sensitive is this segment's
// outcome to the engagement assumption" in one view, rather than needing
// to re-run the whole simulator by hand for each guess. Scales every chest
// type's rate by the same factor (a pure "more/less engaged overall"
// assumption, not "more Epic opens specifically") - if a lopsided
// sensitivity (e.g. "what if only Epic opens double") is ever needed,
// that's a different, explicit ask.
export function runSensitivitySweep({ segment, dishes, baskets, calendar, grants = [], runs = 150, deltas = [-30, -20, -10, 0, 10, 20, 30], strategy = 'list-order' }) {
  return deltas.map((delta) => {
    const factor = 1 + delta / 100
    const avgBasketsPerDayOverride = Object.fromEntries(Object.entries(segment.avgBasketsPerDay).map(([chestType, rate]) => [chestType, rate * factor]))
    const result = simulateMonteCarlo({ segment, dishes, baskets, calendar, grants, runs, avgBasketsPerDayOverride, strategy })
    const last = result.days[result.days.length - 1]
    return { delta, factor, medianCompleted: last.p50, meanCompleted: last.mean, totalDishes: result.totalDishes }
  })
}

// --- Inverse solver: "what would it take" -------------------------------
//
// By explicit economist brainstorm ask - the inverse of the simulator
// itself, mirroring Merge's own "Effort target" inverse-design tool
// (CLAUDE.md): given a target completion fraction by a target day, binary-
// search the smallest uniform scale-up of the segment's own avg-baskets/
// day that reaches it. Built on the cheap DETERMINISTIC `simulateCompletion`
// (not Monte Carlo) specifically because a search needs a stable, repeat-
// able answer for the same input to converge at all - a noisy MC result
// would make the binary search chase random variance instead of the real
// midpoint. This is also why it does NOT model `grants`: `simulateCompletion`
// has no grant support (grants are coverage-% randomized, which is exactly
// the kind of noise a deterministic solver can't have) - a solved rate is
// therefore a (slightly pessimistic) answer for "from baskets alone,"
// before accounting for any grants that would only help further.
export function solveRequiredBasketRate({ segment, dishes, baskets, calendar, targetDay, targetFraction, strategy = 'list-order', maxFactor = 20 }) {
  function completionFractionAt(factor) {
    const avgBasketsPerDayOverride = Object.fromEntries(Object.entries(segment.avgBasketsPerDay).map(([chestType, rate]) => [chestType, rate * factor]))
    const result = simulateCompletion({ segment, dishes, baskets, calendar, avgBasketsPerDayOverride, strategy })
    const day = result.days.find((d) => d.day === targetDay) ?? result.days[result.days.length - 1]
    return day.dishesCompletedCount / result.totalDishes
  }

  if (completionFractionAt(maxFactor) < targetFraction) return { feasible: false, factor: null, scaledRate: null }

  let lo = 0
  let hi = maxFactor
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2
    if (completionFractionAt(mid) >= targetFraction) hi = mid
    else lo = mid
  }

  return {
    feasible: true,
    factor: hi,
    scaledRate: Object.fromEntries(Object.entries(segment.avgBasketsPerDay).map(([chestType, rate]) => [chestType, +(rate * hi).toFixed(3)])),
  }
}

// --- Marginal basket value (paired simulation) --------------------------
//
// By explicit economist brainstorm ask (a GPT review's methodology
// critique of the original allocation-based basket-value estimate, see
// chefBasketValue.js): "allocating each dish's prize evenly across its
// required units is well-defined within that dish... summing those
// contributions into one universal unit price can overstate value" -
// because it ignores complementarity (an ingredient is only worth
// something alongside the OTHER ingredients a recipe needs), saturation
// (once a dish's own need is met, another unit of that ingredient may be
// worth nothing until Recompletion), and timing (the same blocker can be
// valuable near the deadline and useless if its partners never arrive).
//
// This answers a different, more honest question: "if this segment got
// ONE extra basket of this type on this exact day, how much more REWARD
// VALUE do they end up with by the end of the event, on average" - a
// marginal, causal estimate under the real crafting policy, inventory,
// competing recipes, caps, and grants, rather than a static per-unit
// price. It is an estimate of incremental IN-GAME reward, not real-money
// willingness to pay.
//
// Uses the IDENTICAL seed for the baseline and the treatment run (see
// chefRng.js's createRngStreams) so every other source of randomness -
// activity, grants, every other basket roll - lines up exactly between
// the two; the only difference the comparison can ever see is the one
// extra basket itself.
export function estimateMarginalBasketValue({
  segment,
  dishes,
  baskets,
  calendar,
  grants = [],
  totalChefPrizeValue,
  chestType,
  day,
  runs = 300,
  seed = randomSeed(),
  strategy = 'list-order',
}) {
  const baseline = simulateMonteCarlo({ segment, dishes, baskets, calendar, grants, runs, strategy, seed, totalChefPrizeValue })
  const treatment = simulateMonteCarlo({
    segment,
    dishes,
    baskets,
    calendar,
    grants,
    runs,
    strategy,
    seed,
    totalChefPrizeValue,
    extraBasket: { day, chestType },
  })

  return {
    seed,
    runs,
    baselineMeanPayout: baseline.payoutStats.mean,
    treatmentMeanPayout: treatment.payoutStats.mean,
    meanPayoutDelta: treatment.payoutStats.mean - baseline.payoutStats.mean,
    fullClearDelta: treatment.finalFullClearFraction - baseline.finalFullClearFraction,
  }
}
