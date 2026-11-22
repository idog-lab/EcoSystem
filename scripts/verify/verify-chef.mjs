// THE CHEF MODEL, HELD AS IT IS. The Chef feature had no checks of its own;
// these pin down what its engine does today, so that work on its screens - or
// a later change to the model, made on purpose - can be told from an accident.
//
//   npx vite-node scripts/verify/verify-chef.mjs
//
// Holds: the two real chefs load whole and pass their own checks; a finding
// names the step that puts it right, in the economist's words; a basket roll
// keeps its rules; the same players give the same result, to the last digit;
// more baskets and sales never cook fewer dishes; the figures of a run are in
// order; the what-ifs answer what they are asked; a backup and an older save
// come back; removing an ingredient takes it out everywhere.
// It also writes down, as checks, two LIMITS of the model that the screens
// state and nobody has decided to change (section 8): if one of them stops
// holding, the model was changed - update the screen text with it.
import * as halloween from '../../src/features/chef/data/halloweenChefData.js'
import * as thanksgiving from '../../src/features/chef/data/thanksgivingChefData.js'
import { validateChefConfig, SEVERITY_LABELS } from '../../src/features/chef/lib/chefValidation.js'
import { simulateMonteCarlo, simulateCompletion, rollBasket, expectedYieldPerBasket, runSensitivitySweep, solveRequiredBasketRate, estimateMarginalBasketValue, phaseForDay, basketsForPhase } from '../../src/features/chef/lib/chefSimulation.js'
import { ingredientUnitValues, estimateBasketValue } from '../../src/features/chef/lib/chefBasketValue.js'
import { createBasket, createGrant, createSegment, dailyActivityMultiplier, phaseDayRange, removeIngredientEverywhere, dishPrizeValueForSegment, RARITY, CHEST_TYPES, SEGMENT_PRIZE_MULTIPLIER } from '../../src/features/chef/lib/chefModel.js'
import { createRng, createRngStreams } from '../../src/features/chef/lib/chefRng.js'
import { parseImportedLibrary, createConfigEntry } from '../../src/features/chef/lib/chefPersistence.js'

let fails = 0
let total = 0
function check(name, cond) {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const stateOf = (mod) => ({ ingredients: mod.INGREDIENTS, dishes: mod.DISHES, recompletionDishes: mod.RECOMPLETION_DISHES, recompletionCaps: mod.RECOMPLETION_INGREDIENT_CAPS, baskets: mod.BASKETS, calendar: mod.CALENDAR, segments: mod.SEGMENTS, totalChefPrize: mod.TOTAL_CHEF_PRIZE, grants: [] })
const H = stateOf(halloween)
const T = stateOf(thanksgiving)
const world = (s, extra = {}) => ({ dishes: s.dishes, baskets: s.baskets, calendar: s.calendar, grants: s.grants, ...extra })
const last = (result) => result.days[result.days.length - 1]

console.log('--- 1. The two real chefs ---')
for (const [name, s] of [['Halloween', H], ['Thanksgiving', T]]) {
  const findings = validateChefConfig(s)
  const phases = s.calendar.phases.reduce((sum, p) => sum + p.days, 0)
  check(`${name}: ${s.ingredients.length} ingredients, ${s.dishes.length} dishes, ${s.recompletionDishes.length} Recompletion dishes, ${s.baskets.length} baskets, ${s.segments.length} segments, ${s.calendar.totalDays} days in ${s.calendar.phases.length} phases`, s.ingredients.length === 8 && s.dishes.length === 12 && s.recompletionDishes.length === 12 && s.baskets.length === 6 && s.segments.length === 9 && phases === s.calendar.totalDays)
  check(`...one basket for every basket type in every phase, each with pricing odds of its own`, s.calendar.phases.every((p) => CHEST_TYPES.every((t) => s.baskets.filter((b) => b.phaseId === p.id && b.chestType === t).length === 1)) && s.baskets.every((b) => Array.isArray(b.pricingIngredientWeights)))
  const weightIn = (ing, phase) => s.baskets.filter((b) => b.phaseId === phase.id).reduce((sum, b) => sum + (b.ingredientWeights.find((w) => w.ingredientId === ing.id)?.weight ?? 0), 0)
  const semi = s.ingredients.filter((i) => i.rarity === RARITY.SEMI_BLOCKER)
  const hard = s.ingredients.filter((i) => i.rarity === RARITY.BLOCKER)
  check(`...its semi-blocker (${semi.map((i) => i.name).join(", ")}) has less weight in the first phase than in the last, in every basket type (${semi.map((ing) => `${weightIn(ing, s.calendar.phases[0])} against ${weightIn(ing, s.calendar.phases.at(-1))}`).join(", ")})`, semi.length === 1 && semi.every((ing) => CHEST_TYPES.every((t) => { const w = (phase) => s.baskets.find((x) => x.phaseId === phase.id && x.chestType === t).ingredientWeights.find((x) => x.ingredientId === ing.id).weight; return w(s.calendar.phases[0]) < w(s.calendar.phases.at(-1)) })))
  check(`...its blocker (${hard.map((i) => i.name).join(', ')}) is never in a Basic basket, and has less weight in the first phase than in the last (${hard.map((ing) => `${weightIn(ing, s.calendar.phases[0])} against ${weightIn(ing, s.calendar.phases.at(-1))}`).join(', ')})`, hard.length === 1 && hard.every((ing) => weightIn(ing, s.calendar.phases[0]) < weightIn(ing, s.calendar.phases.at(-1)) && s.baskets.filter((b) => b.chestType === 'basic').every((b) => b.ingredientWeights.find((w) => w.ingredientId === ing.id).weight === 0)))
  check(`...the checks find nothing to fix and nothing to look at (${findings.length} good to know)`, findings.every((f) => f.severity === 'info'))
  check(`...the prize for cooking every dish follows the prize sizes (${JSON.stringify(s.totalChefPrize)})`, Math.abs(s.totalChefPrize.medium / s.totalChefPrize.low - SEGMENT_PRIZE_MULTIPLIER.medium) < 1e-9 && Math.abs(s.totalChefPrize.high / s.totalChefPrize.low - SEGMENT_PRIZE_MULTIPLIER.high) < 1e-9)
}

console.log('--- 2. The checks: the step that puts a finding right, in plain words ---')
{
  const noEpic = { ...H, baskets: H.baskets.filter((b) => !(b.chestType === 'epic' && b.phaseId === 'phase2')) }
  const missing = validateChefConfig(noEpic).filter((f) => f.severity === 'block')
  check(`a basket type with no basket in a phase needs a fix, in the Baskets step ("${missing[0]?.message}")`, missing.length === 1 && missing[0].step === 'baskets' && /No Epic basket is set for Phase 2/.test(missing[0].message))
  const gap = validateChefConfig({ ...H, calendar: { ...H.calendar, totalDays: 20 } }).filter((f) => f.severity === 'block')
  check(`phases that do not add up to the event need a fix, in the Event step ("${gap[0]?.message}")`, gap.length === 1 && gap[0].step === 'event' && /add up to 21 days, but the event runs 20/.test(gap[0].message))
  const ghost = { ...H, dishes: H.dishes.map((d, i) => (i === 0 ? { ...d, recipe: [...d.recipe, { ingredientId: 'gone', count: 2 }] } : d)) }
  const unknown = validateChefConfig(ghost).filter((f) => f.severity === 'block')
  check('a recipe that needs an ingredient that no longer exists needs a fix, in the Dishes step', unknown.length === 1 && unknown[0].step === 'dishes' && unknown[0].entityId === H.dishes[0].id)
  const blocker = H.ingredients.find((i) => i.rarity === RARITY.BLOCKER)
  const never = { ...H, baskets: H.baskets.map((b) => ({ ...b, ingredientWeights: b.ingredientWeights.map((w) => (w.ingredientId === blocker.id ? { ...w, weight: 0 } : w)) })) }
  const lost = validateChefConfig(never).find((f) => f.entityId === blocker.id && f.severity === 'review')
  check(`a blocker that no basket and no sale gives is worth a look, in the Baskets step ("${lost?.message}")`, !!lost && lost.step === 'baskets' && lost.message.includes(blocker.name))
  const granted = validateChefConfig({ ...never, grants: [createGrant({ day: 12, ingredientId: blocker.id, amount: 3, coveragePct: 50 })] })
  check('...and is only good to know once a sale or an event gives it', granted.some((f) => f.entityId === blocker.id && f.severity === 'info' && f.step === 'baskets') && !granted.some((f) => f.severity !== 'info'))
  const badGrant = validateChefConfig({ ...H, grants: [createGrant({ day: 40, ingredientId: blocker.id, amount: -1, coveragePct: 120 })] }).filter((f) => f.area === 'Grants')
  check('a sale on a day outside the event, of an amount below zero, to more than all the players: three things to fix, in the Baskets step', badGrant.length === 3 && badGrant.every((f) => f.severity === 'block' && f.step === 'baskets'))
  const tooMany = validateChefConfig({ ...H, baskets: H.baskets.map((b, i) => (i === 0 ? { ...b, totalMax: 999 } : b)) }).filter((f) => f.severity === 'block')
  check('a basket set to give more than its ingredients allow in one basket needs a fix', tooMany.length === 1 && /can never give that many/.test(tooMany[0].message))
  const everything = [...missing, ...gap, ...unknown, lost, ...badGrant, ...tooMany, ...validateChefConfig(H)]
  check('no finding calls a thing that exists by its internal id (a basket is "Epic basket, Phase 2", an ingredient its name)', everything.every((f) => !/phase[0-9]|green-jelly|\bbasic \/|\bepic \//.test(f.message)))
  check('every finding has a step of the flow and one of the three kinds', everything.every((f) => ['event', 'dishes', 'baskets'].includes(f.step) && SEVERITY_LABELS[f.severity]))
}

console.log('--- 3. A basket roll keeps its rules ---')
{
  const rng = createRng(5)
  let ok = true
  let zeroSeen = false
  const totals = new Set()
  for (const basket of H.baskets) {
    const allowed = new Map(basket.ingredientWeights.map((w) => [w.ingredientId, w]))
    for (let i = 0; i < 400; i++) {
      const got = rollBasket(basket, basket.ingredientWeights, rng, rng)
      const sum = Object.values(got).reduce((a, b) => a + b, 0)
      totals.add(`${basket.id}:${sum}`)
      if (sum < basket.totalMin || sum > basket.totalMax) ok = false
      for (const [id, n] of Object.entries(got)) {
        if (n > allowed.get(id).max) ok = false
        if (allowed.get(id).weight === 0) zeroSeen = true
      }
    }
  }
  check('2,400 rolls of the six Halloween baskets: every one gives a number of ingredients inside its range, and no ingredient more than its most per basket', ok)
  check('...an ingredient with a weight of 0 never comes out', !zeroSeen)
  check('...and every number of the range comes up', H.baskets.every((b) => Array.from({ length: b.totalMax - b.totalMin + 1 }, (_, k) => b.totalMin + k).every((n) => totals.has(`${b.id}:${n}`))))
  const basic = H.baskets[0]
  const average = expectedYieldPerBasket(basic)
  check(`on average a basket gives the middle of its range, shared by weight (${Object.values(average).reduce((a, b) => a + b, 0).toFixed(2)} for ${basic.totalMin} to ${basic.totalMax})`, Math.abs(Object.values(average).reduce((a, b) => a + b, 0) - (basic.totalMin + basic.totalMax) / 2) < 1e-9)
  check('the phase of a day, and the baskets of a phase, follow the calendar', phaseForDay(H.calendar, 10).id === 'phase1' && phaseForDay(H.calendar, 11).id === 'phase2' && same(phaseDayRange(H.calendar, 'phase2'), { startDay: 11, endDay: 21 }) && Object.keys(basketsForPhase(H.baskets, 'phase2')).length === 3)
}

console.log('--- 4. The same players, the same result ---')
const seg = H.segments[3]
{
  const a = simulateMonteCarlo({ segment: seg, ...world(H), runs: 200, seed: 42 })
  const b = simulateMonteCarlo({ segment: seg, ...world(H), runs: 200, seed: 42 })
  const c = simulateMonteCarlo({ segment: seg, ...world(H), runs: 200, seed: 43 })
  check('two runs with the same players are the same to the last digit (every day, every dish, what is left over)', same(a, b))
  check('...other players give other figures', !same(a.days, c.days))
  const streams = createRngStreams(9)
  const again = createRngStreams(9)
  check('the four kinds of luck (days of play, sales, how much a basket gives, which ingredients) each have their own stream', new Set(Object.values(streams).map((rng) => rng())).size === 4 && same(Object.values(again).map((rng) => rng()), Object.values(createRngStreams(9)).map((rng) => rng())))
  // A change to the odds does not change who plays on which day: the activity stream is its own.
  const otherOdds = H.baskets.map((b) => ({ ...b, ingredientWeights: b.ingredientWeights.map((w) => ({ ...w, max: w.max + 1 })) }))
  const neverPlays = { ...seg, avgBasketsPerDay: { basic: 0, rare: 0, epic: 0 } }
  check('a segment that opens no baskets cooks nothing, whatever the odds', last(simulateMonteCarlo({ segment: neverPlays, ...world(H, { baskets: otherOdds }), runs: 50, seed: 1 })).max === 0)
}

console.log('--- 5. The figures of a run are in order ---')
{
  const r = simulateMonteCarlo({ segment: seg, ...world(H), runs: 300, seed: 7, totalChefPrizeValue: H.totalChefPrize[seg.prizeTier] })
  check(`a run has one line a day (${r.days.length}), with the slow players at or below the middle player at or below the fast ones`, r.days.length === H.calendar.totalDays && r.days.every((d) => d.min <= d.p10 && d.p10 <= d.p50 && d.p50 <= d.p90 && d.p90 <= d.max && d.max <= r.totalDishes))
  check('...dishes cooked never go down from one day to the next', r.days.every((d, i) => i === 0 || (d.p50 >= r.days[i - 1].p50 && d.mean >= r.days[i - 1].mean - 1e-9 && d.fullClearFraction >= r.days[i - 1].fullClearFraction - 1e-9)))
  check(`...the share who cook every dish comes with how far it can be off (${(last(r).fullClearFraction * 100).toFixed(0)}% ± ${(last(r).fullClearMarginOfError * 100).toFixed(1)})`, last(r).fullClearFraction >= 0 && last(r).fullClearFraction <= 1 && last(r).fullClearMarginOfError >= 0 && last(r).fullClearMarginOfError < 0.07 && r.finalFullClearFraction === last(r).fullClearFraction)
  check('...every dish has its share of players and its days, fast to slow', r.dishStats.length === H.dishes.length && r.dishStats.every((s) => s.reachedFraction >= 0 && s.reachedFraction <= 1 && (s.p50 == null || (s.p10 <= s.p50 && s.p50 <= s.p90 && s.p90 <= H.calendar.totalDays))))
  check(`...the first dish and the longest wait are days of the event (first dish day ${r.stalledStats.firstCraftDayP50}, longest wait ${r.stalledStats.longestGapP50} days)`, r.stalledStats.firstCraftDayP10 <= r.stalledStats.firstCraftDayP50 && r.stalledStats.firstCraftDayP50 <= r.stalledStats.firstCraftDayP90 && r.stalledStats.longestGapP50 <= r.stalledStats.longestGapP90 && r.stalledStats.longestGapP90 <= H.calendar.totalDays)
  check('...the prizes of a player are the prizes of the dishes cooked, at the segment\'s prize size, plus the prize for cooking them all', r.payoutStats.p10 <= r.payoutStats.p50 && r.payoutStats.p50 <= r.payoutStats.p90 && r.payoutStats.p90 <= H.dishes.reduce((sum, d) => sum + dishPrizeValueForSegment(d, seg), 0) + H.totalChefPrize[seg.prizeTier] + 1e-9)
  check('...what stops a player and what is left over name real ingredients', [...r.nearMissStats, ...r.leftoverStats].every((s) => H.ingredients.some((i) => i.id === s.ingredientId)))
  const prizeFirst = simulateMonteCarlo({ segment: seg, ...world(H), runs: 300, seed: 7, strategy: 'prize-first' })
  check(`a player who goes for the biggest prize first is another player (middle player ${last(prizeFirst).p50} against ${last(r).p50} of ${r.totalDishes})`, !same(prizeFirst.dishStats, r.dishStats))
  const rc = simulateMonteCarlo({ segment: seg, dishes: H.recompletionDishes, baskets: H.baskets, calendar: H.calendar, runs: 100, seed: 7 })
  check('the Recompletion dishes are played the same way, on the same baskets', rc.totalDishes === H.recompletionDishes.length && rc.days.length === H.calendar.totalDays)
}

console.log('--- 6. More baskets, a sale: never fewer dishes ---')
{
  const by = (factor) => ({ ...seg, avgBasketsPerDay: Object.fromEntries(Object.entries(seg.avgBasketsPerDay).map(([k, v]) => [k, v * factor])) })
  const half = last(simulateMonteCarlo({ segment: by(0.5), ...world(H), runs: 300, seed: 3 }))
  const typed = last(simulateMonteCarlo({ segment: seg, ...world(H), runs: 300, seed: 3 }))
  const triple = last(simulateMonteCarlo({ segment: by(3), ...world(H), runs: 300, seed: 3 }))
  check(`half the baskets, the baskets typed, three times the baskets: ${half.mean.toFixed(1)}, ${typed.mean.toFixed(1)}, ${triple.mean.toFixed(1)} dishes on average`, half.mean < typed.mean && typed.mean < triple.mean)
  const segments = [...H.segments].sort((a, b) => a.avgBasketsPerDay.basic - b.avgBasketsPerDay.basic)
  const light = last(simulateMonteCarlo({ segment: segments[0], ...world(H), runs: 300, seed: 3 }))
  const heavy = last(simulateMonteCarlo({ segment: segments.at(-1), ...world(H), runs: 300, seed: 3 }))
  check(`the segment that opens the most baskets cooks more than the one that opens the fewest (${segments.at(-1).name} ${heavy.mean.toFixed(1)}, ${segments[0].name} ${light.mean.toFixed(1)})`, heavy.mean > light.mean)
  const blocker = H.ingredients.find((i) => i.rarity === RARITY.BLOCKER)
  const sale = (coveragePct) => simulateMonteCarlo({ segment: seg, ...world(H, { grants: [createGrant({ day: 2, ingredientId: blocker.id, amount: 15, coveragePct })] }), runs: 300, seed: 3 })
  const none = simulateMonteCarlo({ segment: seg, ...world(H), runs: 300, seed: 3 })
  const some = sale(40)
  const all = sale(100)
  check(`a sale of the blocker on day 2 - to nobody, to 40% of the players, to all: ${(none.finalFullClearFraction * 100).toFixed(0)}%, ${(some.finalFullClearFraction * 100).toFixed(0)}%, ${(all.finalFullClearFraction * 100).toFixed(0)}% cook every dish`, same(sale(0).days, none.days) && some.days.every((d, i) => d.mean >= none.days[i].mean - 1e-9 && all.days[i].mean >= d.mean - 1e-9) && all.finalFullClearFraction > none.finalFullClearFraction)
}

console.log('--- 7. The what-ifs, and the basket value ---')
{
  const sweep = runSensitivitySweep({ segment: seg, ...world(H), runs: 120 })
  check(`"more or fewer baskets" plays the event seven ways, from 30% fewer to 30% more (${sweep.map((s) => s.medianCompleted).join(', ')} dishes)`, same(sweep.map((s) => s.delta), [-30, -20, -10, 0, 10, 20, 30]) && sweep[0].meanCompleted < sweep.at(-1).meanCompleted)
  const average = simulateCompletion({ segment: seg, dishes: H.dishes, baskets: H.baskets, calendar: H.calendar })
  const needs = solveRequiredBasketRate({ segment: seg, dishes: H.dishes, baskets: H.baskets, calendar: H.calendar, targetDay: H.calendar.totalDays, targetFraction: 1 })
  const at = (factor) => simulateCompletion({ segment: seg, dishes: H.dishes, baskets: H.baskets, calendar: H.calendar, avgBasketsPerDayOverride: Object.fromEntries(Object.entries(seg.avgBasketsPerDay).map(([k, v]) => [k, v * factor])) }).dishesCompleted
  check(`"what it would take": on averages ${seg.name} cooks ${average.dishesCompleted} of ${average.totalDishes}; every dish takes ${needs.factor.toFixed(2)} times its baskets - and that many do it, a little fewer do not`, needs.feasible && at(needs.factor) === H.dishes.length && at(needs.factor * 0.97) < H.dishes.length)
  const cannot = solveRequiredBasketRate({ segment: seg, dishes: H.dishes, baskets: H.baskets, calendar: H.calendar, targetDay: 5, targetFraction: 1 })
  check('...every dish by day 5, before the blocker opens, is not possible with any number of baskets, and it says so', cannot.feasible === false)
  const low = createSegment({ prizeTier: 'low' })
  const unit = ingredientUnitValues({ dishes: H.dishes, segment: low, totalChefPrizeValue: H.totalChefPrize.low })
  check('the day-by-day basket value shares out prizes over the ingredients the recipes need: an ingredient no dish needs counts for nothing', Object.keys(unit).length > 0 && Object.keys(unit).every((id) => H.dishes.some((d) => d.recipe.some((r) => r.ingredientId === id))) && Object.values(unit).every((v) => v > 0))
  const values = CHEST_TYPES.map((t) => estimateBasketValue(H.baskets.find((b) => b.chestType === t && b.phaseId === 'phase1'), unit).value)
  check(`...a Basic basket is worth less than a Rare one, a Rare one less than an Epic one (${values.map((v) => v.toFixed(2)).join(', ')})`, values[0] < values[1] && values[1] < values[2])
  const high = ingredientUnitValues({ dishes: H.dishes, segment: createSegment({ prizeTier: 'high' }), totalChefPrizeValue: H.totalChefPrize.high })
  check('...and a bigger prize size makes every ingredient count for more, by that size', Object.keys(unit).every((id) => Math.abs(high[id] / unit[id] - SEGMENT_PRIZE_MULTIPLIER.high) < 1e-9))
  const more = estimateMarginalBasketValue({ segment: seg, ...world(H), totalChefPrizeValue: H.totalChefPrize[seg.prizeTier], chestType: 'epic', day: 12, runs: 200, seed: 5 })
  const moreAgain = estimateMarginalBasketValue({ segment: seg, ...world(H), totalChefPrizeValue: H.totalChefPrize[seg.prizeTier], chestType: 'epic', day: 12, runs: 200, seed: 5 })
  check('"one more basket" gives the same figure for the same players', same(more, moreAgain) && more.runs === 200 && more.seed === 5)
}

console.log('--- 8. Two limits of the model, stated on the screens and not changed ---')
{
  // 8a. "One more basket": the two plays do not differ by that basket alone.
  const empty = H.baskets.map((b) => (b.chestType === 'epic' ? createBasket({ ...b, ingredientWeights: b.ingredientWeights.map((w) => ({ ...w, weight: 0 })) }) : b))
  const noEpic = { ...seg, avgBasketsPerDay: { ...seg.avgBasketsPerDay, epic: 0 } }
  const nothing = estimateMarginalBasketValue({ segment: noEpic, dishes: H.dishes, baskets: empty, calendar: H.calendar, totalChefPrizeValue: H.totalChefPrize[seg.prizeTier], chestType: 'epic', day: 3, runs: 300, seed: 11 })
  check(`LIMIT: one more basket that gives nothing still moves the average prize (${nothing.meanPayoutDelta >= 0 ? '+' : ''}${nothing.meanPayoutDelta.toFixed(3)}): the baskets opened after it roll differently in the second play. Step 5 says the figure is rough.`, Math.abs(nothing.meanPayoutDelta) > 1e-6)
  // 8b. An activity shape other than Flat changes the number of baskets opened.
  const effect = (shape) => {
    let sum = 0
    for (let day = 1; day <= H.calendar.totalDays; day++) sum += dailyActivityMultiplier(shape, H.calendar, day)
    return sum / H.calendar.totalDays - 1
  }
  check(`LIMIT: over the ${H.calendar.totalDays} days of the Halloween chef a slow start opens ${(effect('ramp-up') * 100).toFixed(1)}% baskets, a fade ${(effect('taper') * 100).toFixed(1)}%, a weekend boost +${(effect('weekend-boost') * 100).toFixed(1)}% against Flat. Step 1 shows the figure beside the shape.`, effect('flat') === 0 && effect('ramp-up') < -0.05 && effect('taper') < -0.08 && effect('weekend-boost') > 0.08)
}

console.log('--- 9. Saving, backups, and taking an ingredient away ---')
{
  const library = { configs: [createConfigEntry('Halloween chef', H), createConfigEntry('Thanksgiving chef', T)], activeConfigId: null }
  const back = parseImportedLibrary(JSON.stringify(library))
  check('a backup holds every chef and comes back whole', back.configs.length === 2 && same(back.configs[1].state.dishes, T.dishes) && back.configs[0].name === 'Halloween chef')
  const older = parseImportedLibrary(JSON.stringify(H))
  check('a save from before there was a library - one chef, no wrapper - comes back as a library of one', older.configs.length === 1 && same(older.configs[0].state.ingredients, H.ingredients) && older.activeConfigId === older.configs[0].id)
  check('a file that is not a Chef backup is refused, not half read', parseImportedLibrary('{"segments":[]}') === null && parseImportedLibrary('not json') === null && parseImportedLibrary(JSON.stringify({ configs: [{ id: 'x', state: {} }] })) === null)
  const sugar = H.ingredients[0]
  const gone = removeIngredientEverywhere(sugar.id, { dishes: H.dishes, recompletionDishes: H.recompletionDishes, baskets: H.baskets, grants: [createGrant({ ingredientId: sugar.id, amount: 2 }), createGrant({ ingredientId: H.ingredients[1].id, amount: 2 })] })
  const mentions = JSON.stringify(gone).split(`"${sugar.id}"`).length - 1
  check(`removing an ingredient takes it out of every recipe, every basket - real odds and pricing odds - and every sale (${H.dishes.filter((d) => d.recipe.some((r) => r.ingredientId === sugar.id)).length} dishes needed ${sugar.name})`, mentions === 0 && gone.grants.length === 1 && gone.dishes.length === H.dishes.length && gone.baskets.length === H.baskets.length)
  check('...and what is left still passes the checks with nothing to fix', validateChefConfig({ ...H, ingredients: H.ingredients.filter((i) => i.id !== sugar.id), ...gone }).every((f) => f.severity !== 'block'))
}

console.log(`\n${total - fails}/${total} checks passed`)
if (fails) process.exitCode = 1
