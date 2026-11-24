// THE CHEF RULE ENGINE (Chef rebuild, build 01). Each rule the economist
// confirmed has a check of its own here, on a small event made for it, so that
// a later change to a rule is made on purpose.
//
//   npx vite-node scripts/verify/verify-chef.mjs
//
// 1 the two real chefs, brought to the new model     7 Main -> Recompletion
// 2 the three limits: pantry, threshold, per basket  8 prizes and the grand prize
// 3 a basket keeps its size; nothing loops           9 the same players; paired plays
// 4 FU                                              10 supply, both ways of typing it
// 5 schedules, special sources, jokers              11 saving, older saves, the checks
// 6 catch-up presets                                12 the figures of a run
// 13 the cases of the build-01 review, each on a small event that can be followed by hand
// 14 what an event still needs; a reference chef; the synthetic example
import * as halloween from '../../src/features/chef/data/halloweenChefData.js'
import * as thanksgiving from '../../src/features/chef/data/thanksgivingChefData.js'
import { RARITY, SCHEMA_VERSION, blankChefState, createBasket, createCalendar, createCheckpoint, createDish, createIngredient, createPreset, createReward, createRewards, createSegment, createSettings, createSource, createSupply, createTargets, createThreshold, expectedSupply, recipeForSegment, removeIngredientEverywhere, shapeWeights, supplyTotal, thresholdLimitOn, liveSegments, ACTIVITY_SHAPES, CHEST_TYPES } from '../../src/features/chef/lib/chefModel.js'
import { ENGINE_VERSION, comparePaired, comparePresets, fingerprint, oneMoreBasket, prepareWorld, simulatePlayer, simulateSegment, supplySweep, tracePlayer } from '../../src/features/chef/lib/chefEngine.js'
import { dishPrize, effectiveFactor, grandPrize, prizeTable, rewardWorth, scaleReward } from '../../src/features/chef/lib/chefRewards.js'
import { chefFromSource, migrateChefState, SOURCE_DISH_REWARDS } from '../../src/features/chef/lib/chefMigration.js'
import { migrateLibrary, parseImportedLibrary } from '../../src/features/chef/lib/chefPersistence.js'
import { validateChefConfig, SEVERITY_LABELS } from '../../src/features/chef/lib/chefValidation.js'
import { keyedRng, shareInterval } from '../../src/features/chef/lib/chefRng.js'
import { ingredientUnitValues, estimateBasketValue } from '../../src/features/chef/lib/chefBasketValue.js'
import { readiness } from '../../src/features/chef/lib/chefReadiness.js'
import { syntheticExampleState, SYNTHETIC_NOTE } from '../../src/features/chef/data/syntheticExample.js'
import { blackFridayChefState } from '../../src/features/chef/data/blackFridayChefData.js'

let fails = 0
let total = 0
function check(name, cond) {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const sum = (list) => list.reduce((s, v) => s + v, 0)
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance

// A small event: ingredients a and b (ordinary) and x (the blocker), one odds
// period, one segment. Everything else is what a check passes.
function chef({ days = 5, ingredients = null, dishes = [], rc = [], baskets = null, supply = { basic: 0, rare: 0, epic: 0 }, segment = {}, thresholds = [], sources = [], presets = [], settings = {}, targets = {}, rewards = {} } = {}) {
  const ing = ingredients ?? [createIngredient({ id: 'a', name: 'Apple' }), createIngredient({ id: 'b', name: 'Butter' }), createIngredient({ id: 'x', name: 'Jelly', rarity: RARITY.BLOCKER })]
  const row = (ingredientId, weight = 1, max = 3) => ({ ingredientId, min: 0, max, weight })
  return {
    ...blankChefState(),
    ingredients: ing,
    // (An event with no dish at all has no round to play: a check that needs none gets one nobody can cook.)
    dishes: dishes.length || rc.length ? dishes : [createDish({ id: 'never', name: 'never', recipe: [{ ingredientId: ing[0].id, count: 9999 }] })],
    recompletionDishes: rc,
    baskets: baskets ?? CHEST_TYPES.map((chestType) => createBasket({ id: chestType, chestType, phaseId: 'p', ingredientWeights: ing.map((i) => row(i.id, 1, 6)) })),
    calendar: createCalendar({ totalDays: days, phases: [{ id: 'p', label: 'Phase 1', days }] }),
    segments: [createSegment({ id: 's', name: 'Base', supply: createSupply({ average: supply }), ...segment })],
    thresholds,
    sources,
    presets,
    settings: createSettings(settings),
    targets: createTargets(targets),
    rewards: createRewards(rewards),
  }
}
const dish = (id, recipe, extra = {}) => createDish({ id, name: id, recipe: Object.entries(recipe).map(([ingredientId, count]) => ({ ingredientId, count })), ...extra })
const give = (day, ingredientId, amount, extra = {}) => createSource({ id: `src-${day}-${ingredientId}-${amount}-${extra.bypassThreshold ? 'b' : 'n'}`, day, ingredientId, amount, ...extra })
const limit = (ingredientId, steps, round = 'main') => createThreshold({ id: `t-${round}-${ingredientId}`, ingredientId, round, steps: steps.map(([fromDay, value]) => ({ fromDay, limit: value })) })
const play = (state, opts = {}) => simulatePlayer(prepareWorld(state, state.segments[0]), { seed: 7, player: 0, variation: 'baskets', trace: true, ...opts })
const basketsOf = (record) => record.events.filter((e) => e.kind === 'basket')

console.log('--- 1. The two real chefs, brought to the new model ---')
const H = chefFromSource(halloween)
const T = chefFromSource(thanksgiving)
for (const [name, s] of [['Halloween', H], ['Thanksgiving', T]]) {
  const findings = validateChefConfig(s)
  check(`${name}: nothing needs a fix (${findings.filter((f) => f.severity === 'block').length} to fix, ${findings.filter((f) => f.severity === 'review').length} worth a look)`, findings.filter((f) => f.severity === 'block').length === 0)
  check(`${name}: schema ${s.schemaVersion}, ${s.dishes.length} dishes, ${s.recompletionDishes.length} Recompletion dishes, ${s.segments.length} segments, ${s.baskets.length} baskets`, s.schemaVersion === SCHEMA_VERSION && s.dishes.length === 12 && s.segments.length === 9 && s.baskets.length === 6)
  check(`${name}: what the sheet never said starts empty - no thresholds, sources, presets, FU day, Dish Master, pantry caps`, s.thresholds.length === 0 && s.sources.length === 0 && s.presets.length === 0 && s.targets.mainFuDay == null && s.calendar.dishMaster.startDay == null && s.ingredients.every((i) => i.pantryCap == null))
  check(`${name}: the sheet's "Cap" is kept beside each ingredient, not played (${s.ingredients.map((i) => i.sourceCap).join(' ')})`, s.ingredients.every((i) => i.sourceCap > 0))
  check(`${name}: the migration says what is missing, in plain words (${s.migration.notes.length} notes)`, s.migration.fromVersion === 1 && s.migration.notes.length >= 5 && s.migration.notes.every((n) => !/schema|null|undefined|migrat/i.test(n)))
  const prizes = prizeTable(s, s.segments[0])
  check(`${name}: dish prizes are the prize sheet's components, worth what the sheet says (${prizes.main.map((p) => p.worth).join(' ')})`, same(prizes.main.map((p) => p.worth), [1, 3, 4, 5.5, 6, 7, 8, 9, 10, 11, 12, 14]) && s.dishes[2].reward.undo === 4 && s.dishes[3].reward.wild === 1 && s.dishes.every((d) => d.legacyWorth == null))
  check(`${name}: the Recompletion prizes are unknown, not zero, and the valuation says it is incomplete`, prizes.rc.every((p) => p.worth === null && !p.known) && !prizes.complete && prizes.missing.some((m) => /Recompletion/.test(m)))
}
check('the reward components of the 12 dishes come from the prize sheet (12 rows)', SOURCE_DISH_REWARDS.length === 12)

console.log('--- 2. Three different limits: the pantry cap, the progression threshold, the most a basket ---')
{
  const ingredients = [createIngredient({ id: 'a', name: 'Apple', pantryCap: 5 }), createIngredient({ id: 'b', name: 'Butter' }), createIngredient({ id: 'x', name: 'Jelly', rarity: RARITY.BLOCKER })]
  const base = { ingredients, dishes: [dish('d1', { a: 5 }), dish('d2', { b: 99 })], thresholds: [limit('a', [[1, 8]])], sources: [give(1, 'a', 5), give(2, 'a', 5), give(3, 'a', 9, { bypassThreshold: true })] }
  const r = play(chef(base))
  check(`cooking frees room in the pantry: 5 received, cooked, then 3 more fit an empty pantry (accepted ${r.totals.accepted.a - 2}, on hand after day 2: 3)`, r.dishDay.main.d1 === 1 && r.events.find((e) => e.kind === 'source' && e.day === 2).given[0].accepted === 3)
  check(`...but not the progression threshold: of the 5 offered on day 2 only 3 are given, the limit of 8 received is reached (2 held back)`, r.events.find((e) => e.kind === 'source' && e.day === 2).given[0].withheld === 2 && r.totals.withheld.a === 2)
  const day3 = r.events.find((e) => e.kind === 'source' && e.day === 3).given[0]
  check(`what does not fit the pantry is lost, with nothing in its place: 9 given into room for 2 - ${day3.accepted} kept, ${day3.lost} lost`, day3.accepted === 2 && day3.lost === 7 && r.pantry.a === 5)
  check(`every unit is accounted for: given ${r.totals.rolled.a} = kept ${r.totals.accepted.a} + lost ${r.totals.lost.a}; kept = cooked ${r.totals.consumed.a} + on hand ${r.pantry.a}`, r.totals.rolled.a === r.totals.accepted.a + r.totals.lost.a && r.totals.accepted.a === r.totals.consumed.a + r.pantry.a)
  check(`a source allowed to pass the threshold does, and that is counted apart (${r.totals.bypassed.a} past the limit; a basket's overshoot: ${r.totals.overshoot.a})`, r.totals.bypassed.a === 2 && r.totals.overshoot.a === 0)
  const attempted = play(chef({ ...base, settings: { thresholdCounts: 'attempted' } }))
  check(`whether lost overflow counts toward the threshold is a setting, and both counts are kept (received ${r.received.main.a}, rolled ${r.attempted.main.a}; the count is ${r.counter.main.a} or ${attempted.counter.main.a})`, r.counter.main.a === 10 && attempted.counter.main.a === 17 && r.received.main.a === 10 && r.attempted.main.a === 17)
  // The most a basket: one basket never gives more of an ingredient than its row allows.
  const capped = chef({ days: 6, supply: { basic: 3 }, baskets: [createBasket({ id: 'basic', chestType: 'basic', phaseId: 'p', totalMin: 5, totalMax: 5, ingredientWeights: [{ ingredientId: 'a', min: 0, max: 2, weight: 50 }, { ingredientId: 'b', min: 0, max: 6, weight: 1 }] })] })
  const rolls = basketsOf(play(capped))
  check(`the most a basket holds of an ingredient is kept however heavy its weight (most Apple in one of ${rolls.length} baskets: ${Math.max(...rolls.map((e) => e.rolled.a ?? 0))})`, rolls.length === 18 && rolls.every((e) => (e.rolled.a ?? 0) <= 2 && sum(Object.values(e.rolled)) === 5))
}

console.log('--- 3. A basket keeps its size when an ingredient is held back; nothing loops ---')
{
  const rows = (ids) => ids.map((ingredientId) => ({ ingredientId, min: 0, max: 3, weight: 1 }))
  const basket = () => [createBasket({ id: 'basic', chestType: 'basic', phaseId: 'p', totalMin: 5, totalMax: 5, ingredientWeights: rows(['a', 'b', 'x']) })]
  const held = play(chef({ supply: { basic: 4 }, baskets: basket(), thresholds: [limit('x', [[1, 0]])] }))
  const b = basketsOf(held)
  check(`with the blocker held back, every basket still gives its 5 - from the others (${b.length} baskets, Jelly in none)`, b.length === 20 && b.every((e) => sum(Object.values(e.rolled)) === 5 && e.rolled.x === undefined && e.excluded.includes('x') && e.short === 0))
  const open = basketsOf(play(chef({ supply: { basic: 4 }, baskets: basket() })))
  check('without the threshold the same baskets do give the blocker', open.some((e) => e.rolled.x > 0))
  const tight = play(chef({ supply: { basic: 4 }, baskets: basket(), thresholds: [limit('a', [[1, 0]]), limit('b', [[1, 0]])] }))
  check(`a basket with no room left for its size stops, gives what it can and is counted (each gives ${basketsOf(tight)[0].size - basketsOf(tight)[0].short} of 5; ${tight.shortBaskets} short baskets)`, basketsOf(tight).every((e) => sum(Object.values(e.rolled)) === 3 && e.short === 2) && tight.shortBaskets === 20 && tight.shortUnits === 40)
  const none = play(chef({ supply: { basic: 4 }, baskets: basket(), thresholds: [limit('a', [[1, 0]]), limit('b', [[1, 0]]), limit('x', [[1, 0]])] }))
  check('a basket in which everything is held back gives nothing and the run still ends', basketsOf(none).length === 20 && basketsOf(none).every((e) => sum(Object.values(e.rolled)) === 0 && e.short === 5))
  const findings = validateChefConfig(chef({ supply: { basic: 4 }, baskets: basket(), thresholds: [limit('a', [[1, 0]]), limit('b', [[1, 0]])] }))
  check('the checks say beforehand that such a basket comes up short', findings.some((f) => f.severity === 'review' && /comes up short/.test(f.message) && f.step === 'baskets'))
  const weird = chef({ supply: { basic: 2, rare: 2, epic: 1 }, baskets: [createBasket({ id: 'basic', chestType: 'basic', phaseId: 'p', totalMin: 9, totalMax: 3, ingredientWeights: [{ ingredientId: 'a', min: 0, max: 0, weight: 5 }, { ingredientId: 'gone', min: 0, max: 3, weight: 5 }] })] })
  const t0 = Date.now()
  const w = simulateSegment(weird, weird.segments[0], { players: 50, seed: 3 })
  check(`an event typed wrong (a size range upside down, a row for an ingredient that is gone, no Rare basket) is still played to the end (${Date.now() - t0} ms)`, w.days.length === 5 && validateChefConfig(weird).filter((f) => f.severity === 'block').length >= 3)
}

console.log('--- 4. FU: one dish left, only blockers missing, the threshold reached ---')
{
  const fu = (sources, extra = {}) => play(chef({ dishes: [dish('first', { x: 3, a: 1 }), dish('last', { x: 6, a: 1 })], thresholds: [limit('x', [[1, 6]])], sources, targets: { mainFuDay: 2 }, ...extra }))
  const r = fu([give(1, 'a', 2), give(1, 'x', 6)])
  check(`a shared threshold of 6, two blocker dishes needing 3 and 6: with the first cooked, 3 blockers held and the rest of the last dish in the pantry, the player is in FU, 3 blockers short (in FU from day ${r.firstFuDay}, short ${r.days.fuShort[1]})`, r.mainDishes === 1 && r.pantry.x === 3 && r.firstFuDay === 1 && (r.days.state[1] & 1) === 1 && r.days.fuShort[1] === 3)
  const noApple = fu([give(1, 'a', 1), give(1, 'x', 6)])
  check('all dishes but one cooked is not FU while an ordinary ingredient is missing', noApple.mainDishes === 1 && noApple.firstFuDay === null && (noApple.days.state[4] & 1) === 0)
  const below = fu([give(1, 'a', 2), give(1, 'x', 5)])
  check('...nor while the player has received fewer blockers than the threshold allows (still waiting for supply)', below.mainDishes === 1 && below.pantry.x === 2 && below.firstFuDay === null)
  const done = fu([give(1, 'a', 2), give(1, 'x', 9, { bypassThreshold: true })])
  check('a player who finished the Main round is not in FU', done.mainDishes === 2 && (done.days.state[4] & 1) === 0 && (done.days.state[4] & 2) === 2)
  const noLimit = play(chef({ dishes: [dish('first', { x: 3, a: 1 }), dish('last', { x: 6, a: 1 })], sources: [give(1, 'a', 2), give(1, 'x', 6)] }))
  check('with no threshold on the blocker nobody is counted in FU (nothing holds the blocker back)', noLimit.mainDishes === 1 && noLimit.firstFuDay === null)
  // A segment: in FU now, ever in FU, finished - three figures, never one for another.
  const event = chef({ days: 6, dishes: [dish('first', { x: 3, a: 1 }), dish('last', { x: 6, a: 1 })], thresholds: [limit('x', [[1, 6], [5, null]])], supply: { basic: 3 }, baskets: [createBasket({ id: 'basic', chestType: 'basic', phaseId: 'p', totalMin: 4, totalMax: 4, ingredientWeights: [{ ingredientId: 'a', min: 0, max: 2, weight: 1 }, { ingredientId: 'x', min: 0, max: 2, weight: 1 }] })], targets: { mainFuDay: 4, checkpoints: [createCheckpoint({ id: 'c1', day: 2, dishes: 1, sharePct: 80 })] } })
  const s = simulateSegment(event, event.segments[0], { players: 200, seed: 11, variation: 'baskets' })
  const t = s.fuTarget
  check(`on the target day: in FU ${(t.inFu * 100).toFixed(0)}%, finished ${(t.finished * 100).toFixed(0)}%, not there yet ${(t.before * 100).toFixed(0)}% - they add up; ever in FU ${(t.everFu * 100).toFixed(0)}%`, near(t.inFu + t.finished + t.before, 1, 1e-9) && t.everFu >= t.inFu && t.inFu > 0.5 && t.finished === 0)
  check(`once the threshold is lifted the same players finish: finished ${(s.finish.share * 100).toFixed(0)}% at the end, in FU ${(s.fu.inAtEnd * 100).toFixed(0)}%, ever in FU ${(s.fu.everShare * 100).toFixed(0)}%`, s.finish.share > 0.5 && s.fu.inAtEnd === 0 && s.fu.everShare >= t.everFu)
  check(`the average shortage of the players in FU is tracked (${t.shortage})`, t.shortage === 3)
  check(`a checkpoint is the share with at least N dishes by a day, not the average dishes (${(s.checkpoints[0].share * 100).toFixed(0)}% have 1 dish by day 2; the average is ${s.days[1].mean.toFixed(2)})`, s.checkpoints[0].share === s.days[1].dist.slice(1).reduce((a, b) => a + b, 0) && s.checkpoints[0].met === s.checkpoints[0].share >= 0.8)
}

console.log('--- 5. Schedules, special sources, jokers ---')
{
  const basket = [createBasket({ id: 'basic', chestType: 'basic', phaseId: 'p', totalMin: 3, totalMax: 3, ingredientWeights: [{ ingredientId: 'a', min: 0, max: 5, weight: 1 }, { ingredientId: 'x', min: 0, max: 2, weight: 5 }] })]
  const schedule = [limit('x', [[1, 0], [3, 2], [5, null]])]
  const cumulative = (record, uptoDay) => sum(basketsOf(record).filter((e) => e.day <= uptoDay).map((e) => e.rolled.x ?? 0))
  const exact = play(chef({ days: 6, supply: { basic: 3 }, baskets: basket, thresholds: schedule, settings: { thresholdPolicy: 'stop-at-threshold' } }))
  check(`a schedule with several steps: none before day 3, then up to 2, then free (Jelly received by day 2 / 4 / 6: ${cumulative(exact, 2)} / ${cumulative(exact, 4)} / ${cumulative(exact, 6)})`, cumulative(exact, 2) === 0 && cumulative(exact, 4) === 2 && cumulative(exact, 6) > 2)
  check('the limit in force on a day is read off the schedule', thresholdLimitOn(schedule[0], 2) === 0 && thresholdLimitOn(schedule[0], 4) === 2 && thresholdLimitOn(schedule[0], 6) === null && thresholdLimitOn(limit('x', [[3, 4]]), 1) === null)
  const loose = play(chef({ days: 6, supply: { basic: 3 }, baskets: basket, thresholds: schedule, settings: { thresholdPolicy: 'before-basket' } }))
  check(`checked before each basket, a basket can go past the limit, and the overshoot is recorded (received ${cumulative(loose, 4)} against 2: ${loose.totals.overshoot.x} over)`, cumulative(loose, 4) >= 2 && cumulative(loose, 4) <= 3 && loose.totals.overshoot.x === cumulative(loose, 4) - 2)
  const inclusive = play(chef({ days: 6, supply: { basic: 3 }, baskets: basket, thresholds: [limit('x', [[1, 2]])], settings: { thresholdPolicy: 'before-basket-inclusive' } }))
  const strict = play(chef({ days: 6, supply: { basic: 3 }, baskets: basket, thresholds: [limit('x', [[1, 2]])], settings: { thresholdPolicy: 'before-basket' } }))
  check(`the sheet's "<=" check gives one basket more at the limit than the stop-at-the-limit reading (${inclusive.counter.main.x} against ${strict.counter.main.x}) - the policy is a setting`, inclusive.counter.main.x > strict.counter.main.x && strict.counter.main.x <= 3)
  // Special receipts count toward the threshold; passing it needs a permission.
  const counted = play(chef({ days: 6, supply: { basic: 3 }, baskets: basket, thresholds: [limit('x', [[1, 3]])], sources: [give(1, 'x', 2)], settings: { thresholdPolicy: 'stop-at-threshold' } }))
  check(`what a special source gives counts toward the threshold: 2 from a sale, so the baskets give 1 more (3 in all)`, counted.counter.main.x === 3 && cumulative(counted, 6) === 1)
  const over = play(chef({ days: 6, supply: { basic: 3 }, baskets: basket, thresholds: [limit('x', [[1, 3]])], sources: [give(1, 'x', 5)], settings: { thresholdPolicy: 'stop-at-threshold' } }))
  const allowed = play(chef({ days: 6, supply: { basic: 3 }, baskets: basket, thresholds: [limit('x', [[1, 3]])], sources: [give(1, 'x', 5, { bypassThreshold: true })], settings: { thresholdPolicy: 'stop-at-threshold' } }))
  check(`a source stops at the limit unless it is allowed to pass it (5 offered: ${over.counter.main.x} given and ${over.totals.withheld.x} held back; allowed: ${allowed.counter.main.x})`, over.counter.main.x === 3 && over.totals.withheld.x === 2 && allowed.counter.main.x === 5 && cumulative(allowed, 6) === 0)
  // Who gets a source.
  const sale = chef({ days: 3, dishes: [dish('d', { a: 99 })], sources: [createSource({ id: 'twenty', day: 1, ingredientId: 'a', amount: 1, coveragePct: 20 }), createSource({ id: 'fifty', day: 1, ingredientId: 'b', amount: 1, coveragePct: 50 })] })
  const world = prepareWorld(sale, sale.segments[0])
  const got = Array.from({ length: 400 }, (_, player) => simulatePlayer(world, { seed: 5, player, variation: 'baskets' }).pantry)
  const share = (key) => got.filter((p) => p[key] > 0).length / got.length
  check(`a source reaches the share of players typed (20%: ${(share('a') * 100).toFixed(0)}%, 50%: ${(share('b') * 100).toFixed(0)}%), the same players first: whoever gets the 20% one gets the 50% one`, near(share('a'), 0.2, 0.06) && near(share('b'), 0.5, 0.07) && got.every((p) => !(p.a > 0) || p.b > 0))
  const indep = prepareWorld({ ...sale, settings: createSettings({ recipients: 'independent' }) }, sale.segments[0])
  const got2 = Array.from({ length: 400 }, (_, player) => simulatePlayer(indep, { seed: 5, player, variation: 'baskets' }).pantry)
  check('...or drawn again for every source, when that is the assumption chosen', got2.some((p) => p.a > 0 && !(p.b > 0)))
  const forOther = play(chef({ sources: [createSource({ id: 'o', day: 1, ingredientId: 'a', amount: 4, segmentIds: ['someone-else'] })] }))
  check('a source for other segments gives this one nothing', forOther.pantry.a === 0)
  // Jokers.
  const joker = play(chef({ dishes: [dish('d1', { a: 4, b: 30, x: 2 })], sources: [createSource({ id: 'j', kind: 'joker', day: 1, amount: 1 })] }))
  const picks = joker.events.find((e) => e.kind === 'joker').given
  check(`a joker gives three different ingredients: 10 of each ordinary one, 1 of the blocker (${picks.map((g) => `${g.ingredientId} ${g.given}`).join(', ')})`, picks.length === 3 && new Set(picks.map((g) => g.ingredientId)).size === 3 && picks.find((g) => g.ingredientId === 'x').given === 1 && picks.filter((g) => g.ingredientId !== 'x').every((g) => g.given === 10))
  check('...the blocker first while a dish still needs it (an assumption about how players choose, shown as one)', picks[0].ingredientId === 'x')
  const noNeed = play(chef({ ingredients: [...chef().ingredients, createIngredient({ id: 'c', name: 'Cream' })], dishes: [dish('d1', { a: 4, b: 30, c: 2 })], sources: [createSource({ id: 'j', kind: 'joker', day: 1, amount: 1 })] }))
  check('...and not the blocker when no dish needs it', !noNeed.events.find((e) => e.kind === 'joker').given.some((g) => g.ingredientId === 'x'))
  const blockedJoker = play(chef({ dishes: [dish('d1', { a: 4, b: 30, x: 2 })], thresholds: [limit('x', [[1, 0]])], sources: [createSource({ id: 'j', kind: 'joker', day: 1, amount: 1 })] }))
  check('a joker without the permission does not give an ingredient held back by its threshold', blockedJoker.pantry.x === 0)
}

console.log('--- 6. Catch-up presets: guaranteed contents in the place of a basket ---')
{
  const basket = [createBasket({ id: 'basic', chestType: 'basic', phaseId: 'p', totalMin: 3, totalMax: 4, ingredientWeights: [{ ingredientId: 'a', min: 0, max: 4, weight: 1 }, { ingredientId: 'b', min: 0, max: 4, weight: 1 }] })]
  const byTotal = createPreset({ id: 'P1', name: 'Blocker help', priority: 2, maxUses: 1, allocations: { 3: { x: 1, a: 2 }, 4: { x: 2, a: 2 } } })
  const fixed = createPreset({ id: 'P2', name: 'Butter help', priority: 1, maxUses: 1, sizeMode: 'fixed', fixedTotal: 3, fixedContents: { b: 3 } })
  const base = { days: 4, supply: { basic: 2 }, baskets: basket, dishes: [dish('d', { a: 99 })], presets: [byTotal, fixed] }
  const r = play(chef(base))
  const b = basketsOf(r)
  check(`overlap: the lower priority number first - basket 1 is "${b[0].preset?.name}", basket 2 "${b[1].preset?.name}", then ordinary baskets`, b[0].preset?.id === 'P2' && b[1].preset?.id === 'P1' && b.slice(2).every((e) => e.preset === null))
  check('the contents are guaranteed, not drawn: exactly what the preset says', same(b[0].rolled, { b: 3 }) && same(b[1].rolled, b[1].rolledSize === 3 ? { x: 1, a: 2 } : { x: 2, a: 2 }))
  check(`"by size": the basket's size is rolled as always and the preset says what a basket of that size holds (rolled ${b[1].rolledSize}, gave ${sum(Object.values(b[1].rolled))}); "fixed": always its own total (3)`, sum(Object.values(b[1].rolled)) === b[1].rolledSize && b[0].size === 3)
  check('at most the uses typed: each preset once for this player', r.presetUses.P1 === 1 && r.presetUses.P2 === 1 && r.presetBaskets === 2)
  const off = play(chef(base), { usePresets: false })
  check(`it takes the place of a basket, it is not one more: ${basketsOf(off).length} baskets without presets, ${b.length} with`, basketsOf(off).length === b.length && b.length === 8 && off.presetBaskets === 0 && off.pantry.x === 0)
  check('the baskets a preset did not take are rolled exactly as without presets', same(b.slice(2).map((e) => e.rolled), basketsOf(off).slice(2).map((e) => e.rolled)))
  // Restrictions.
  const capped = play(chef({ ...base, thresholds: [limit('x', [[1, 1]])], presets: [{ ...byTotal, maxUses: null }] }))
  const skipped = basketsOf(capped).flatMap((e) => e.skipped)
  check(`a preset never passes a progression threshold: with a limit of 1 the player ends with ${capped.counter.main.x}, and a basket it could not fill falls back to the ordinary one ("${skipped[0]?.reason}")`, capped.counter.main.x <= 1 && skipped.length > 0 && /threshold/.test(skipped[0].reason) && basketsOf(capped).filter((e) => e.skipped.length).every((e) => e.preset === null && sum(Object.values(e.rolled)) === e.rolledSize))
  const pantry = play(chef({ ...base, ingredients: [createIngredient({ id: 'a', name: 'Apple', pantryCap: 1 }), createIngredient({ id: 'b', name: 'Butter' }), createIngredient({ id: 'x', name: 'Jelly', rarity: RARITY.BLOCKER })], presets: [byTotal] }))
  check(`...and never overfills the pantry ("${basketsOf(pantry)[0].skipped[0]?.reason}")`, pantry.presetBaskets === 0 && /pantry/.test(basketsOf(pantry)[0].skipped[0].reason))
  const straight = play(chef({ ...base, thresholds: [limit('x', [[1, 0]])], presets: [{ ...byTotal, priority: 1, fallback: 'ordinary' }, { ...fixed, priority: 2 }] }))
  const next = play(chef({ ...base, thresholds: [limit('x', [[1, 0]])], presets: [{ ...byTotal, priority: 1, fallback: 'next' }, { ...fixed, priority: 2 }] }))
  check('the fallback is a setting: "ordinary" goes straight to the ordinary basket, "next" tries the next preset that fits', basketsOf(straight)[0].preset === null && straight.presetBaskets === 0 && basketsOf(next)[0].preset?.id === 'P2')
  // Who qualifies, read at the moment the basket is opened.
  const who = (eligibility, sources = []) => play(chef({ ...base, dishes: [dish('d1', { a: 1 }), dish('d2', { x: 4, b: 99 })], sources, presets: [{ ...byTotal, maxUses: null, eligibility: { ...byTotal.eligibility, ...eligibility } }] }))
  check('eligibility by dishes cooked: not before the first dish is cooked', who({ dishesMin: 1 }).presetBaskets > 0 && basketsOf(who({ dishesMin: 1 }))[0].preset === null)
  check('eligibility by what is still missing: a player who already holds the blockers does not qualify', who({ missingIngredientId: 'x', missingMin: 1 }, [give(1, 'x', 4)]).presetBaskets === 0 && who({ missingIngredientId: 'x', missingMin: 1 }).presetBaskets > 0)
  check('eligibility by what was received so far', who({ receiptsIngredientId: 'x', receiptsMax: 0 }).presetUses.P1 === 1)
  check('eligibility by days and by segment', play(chef({ ...base, presets: [{ ...byTotal, startDay: 3, endDay: 3 }] })).events.filter((e) => e.kind === 'basket' && e.preset).every((e) => e.day === 3) && play(chef({ ...base, presets: [{ ...byTotal, segmentIds: ['other'] }] })).presetBaskets === 0)
  // The checks, before a run.
  const bad = validateChefConfig(chef({ ...base, thresholds: [limit('x', [[1, 0]])], presets: [createPreset({ id: 'B1', name: 'Bad sum', allocations: { 3: { a: 2 }, 4: { a: 4 } } }), createPreset({ id: 'B2', name: 'Blocked', allocations: { 3: { x: 1, a: 2 }, 4: { x: 1, a: 3 } } }), createPreset({ id: 'B3', name: 'Too big', sizeMode: 'fixed', fixedTotal: 9, fixedContents: { a: 9 } })] })).filter((f) => f.area === 'Presets')
  check(`the checks catch contents that do not add up, contents a threshold forbids on every day, and a total outside the basket's range (${bad.length} findings)`, bad.some((f) => /add up to 2/.test(f.message)) && bad.some((f) => /can never be given/.test(f.message)) && bad.some((f) => /outside what a Basic basket gives/.test(f.message)) && bad.every((f) => f.severity === 'block' && f.step === 'baskets'))
  // With and without, the same players.
  const helped = chef({ days: 6, supply: { basic: 3 }, baskets: basket, dishes: [dish('d1', { a: 4, b: 4 }), dish('d2', { a: 4, x: 2 })], presets: [{ ...byTotal, maxUses: 2 }], targets: { mainFuDay: 3 } })
  const cmp = comparePresets(helped, helped.segments[0], { players: 150, seed: 21, variation: 'baskets' })
  check(`compared on the same players: ${(cmp.changed.presets.affectedShare * 100).toFixed(0)}% got a preset, finishing went from ${(cmp.base.finish.share * 100).toFixed(0)}% to ${(cmp.changed.finish.share * 100).toFixed(0)}%, Jelly delivered ${cmp.base.ingredients[2].accepted} -> ${cmp.changed.ingredients[2].accepted.toFixed(2)}`, cmp.base.presets.affectedShare === 0 && cmp.changed.presets.affectedShare > 0.9 && cmp.changed.finish.share > cmp.base.finish.share && cmp.base.ingredients[2].accepted === 0 && cmp.changed.ingredients[2].accepted > 0)
  check(`...with the players who had already finished on the FU day told apart (${cmp.finishedByFuDay.base} without, ${cmp.finishedByFuDay.changed} with)`, cmp.finishedByFuDay.base === 0 && cmp.finishedByFuDay.changed >= 0)
}

console.log('--- 7. Main to Recompletion: at once, the same pantry, a new count, cooked once ---')
{
  const event = chef({ days: 5, dishes: [dish('main', { a: 2 })], rc: [dish('rc1', { a: 1 }), dish('rc2', { x: 1 })], thresholds: [limit('x', [[1, 0]], 'rc')], sources: [give(1, 'a', 5), give(2, 'x', 1), give(3, 'x', 1, { bypassThreshold: true }), give(4, 'a', 5), give(4, 'x', 3, { bypassThreshold: true })] })
  const r = play(event)
  const enter = r.events.find((e) => e.kind === 'rc-enter')
  check(`Recompletion starts the moment the last Main dish is cooked (Main done day ${r.mainDoneDay}, Recompletion from day ${r.rcEntryDay})`, r.mainDoneDay === 1 && r.rcEntryDay === 1 && enter.day === 1)
  check(`the pantry is carried over (3 Apples left after the Main dish) and a Recompletion dish is cooked from it at once - which is flagged (${r.rcCookedAtEntry} dish at entry)`, enter.pantry.a === 3 && r.dishDay.rc.rc1 === 1 && r.rcCookedAtEntry === 1)
  check(`the count of what was received starts again: Main received 5 Apples, Recompletion 0 until day 4, while the pantry was never emptied`, r.received.main.a === 5 && r.received.rc.a === 5 && r.events.filter((e) => e.kind === 'source' && e.day === 4)[0].given[0].accepted === 5)
  check('the Recompletion thresholds apply: its blocker is held back until a source may pass the limit', r.events.find((e) => e.kind === 'source' && e.day === 2).given[0].withheld === 1 && r.dishDay.rc.rc2 === 3)
  check(`it is cooked once: finished on day ${r.rcDoneDay}, and what comes after is cooked into nothing (${r.rcDishes} dishes, ${r.pantry.a} Apples and ${r.pantry.x} Jelly left)`, r.rcDoneDay === 3 && r.rcDishes === 2 && r.mainDishes === 1 && r.pantry.a === 7 && r.pantry.x === 3 && r.events.filter((e) => e.kind === 'cook').length === 3)
  check('Recompletion FU: all its dishes but one cooked, only blockers missing, the threshold reached', r.rcFuDay === 1 && (r.days.state[1] & 4) === 4 && (r.days.state[4] & 8) === 8)
  // The same event, the same days: no basket is added for Recompletion.
  const withRc = { ...H, thresholds: [], targets: createTargets({ mainFuDay: 14 }) }
  const noRc = { ...withRc, recompletionDishes: [] }
  const seg = withRc.segments[5]
  const a = simulateSegment(withRc, seg, { players: 120, seed: 9, keepRecords: true })
  const b = simulateSegment(noRc, seg, { players: 120, seed: 9, keepRecords: true })
  check(`Recompletion uses the baskets left in the same event, not an event of its own: the same baskets are opened with or without it (${a.supply.opened.basic.toFixed(1)} Basic a player)`, same(a.records.map((r) => r.opened), b.records.map((r) => r.opened)) && same(a.records.map((r) => r.mainDoneDay), b.records.map((r) => r.mainDoneDay)))
  check(`...and nobody cooks a Recompletion dish before finishing the Main round (${(a.rc.enteredShare * 100).toFixed(0)}% enter it, ${(a.rc.cookedAtEntryShare * 100).toFixed(0)}% cook one at once from the pantry carried over)`, a.rc.enteredShare > 0 && a.records.every((r) => Object.values(r.dishDay.rc).every((day) => r.rcEntryDay != null && day >= r.rcEntryDay)) && near(a.rc.enteredShare, a.finish.share, 1e-9))
}

console.log('--- 8. Prizes: components, the segment\'s factor, the grand prize by RoundReward ---')
{
  const values = createRewards().values
  const reward = createReward({ coins: 10, wild: 1, extraStock: 2, freeRound: 3, undo: 4 })
  const seg = createSegment({ id: 'big', name: 'Big', prizeFactor: 2, burnout: 1.5 })
  const scaled = scaleReward(reward, effectiveFactor(seg))
  check(`a factor of 3 (prize 2 x burnout 1.5): coins x3 (${scaled.raw.coins}), free rounds and undos x2 at most (${scaled.raw.freeRound}, ${scaled.raw.undo}), wilds and extra stock unchanged (${scaled.raw.wild}, ${scaled.raw.extraStock})`, same(scaled.raw, { coins: 30, wild: 1, extraStock: 2, freeRound: 6, undo: 8 }))
  check(`its allowance worth comes from the value table (${rewardWorth(scaled.raw, values)})`, rewardWorth(scaled.raw, values) === 30 + 2.5 + 4 + 6 + 2)
  const small = scaleReward(reward, 1.2)
  check(`the limit is on the multiplier, not on the count: x1.2 gives ${small.raw.undo} undos and ${small.raw.freeRound} free rounds`, near(small.raw.undo, 4.8, 1e-9) && near(small.raw.freeRound, 3.6, 1e-9))
  check(`whole items are a setting, raw targets by default (4.8 undos: ${scaleReward(reward, 1.2, { itemRounding: 'nearest' }).items.undo} to the nearest, ${scaleReward(reward, 1.2, { itemRounding: 'down' }).items.undo} down, ${scaleReward(reward, 1.2, { itemRounding: 'up' }).items.undo} up), and coins are never changed to make up for it`, scaleReward(reward, 1.2, { itemRounding: 'nearest' }).items.undo === 5 && scaleReward(reward, 1.2, { itemRounding: 'down' }).items.undo === 4 && scaleReward(reward, 1.2, { itemRounding: 'up' }).items.undo === 5 && scaleReward(reward, 1.2, { itemRounding: 'nearest' }).items.coins === 12 && small.items.undo === small.raw.undo)
  const gp = grandPrize(createReward({ coins: 90 }), createSegment({ prizeFactor: 1.37 }), createRewards())
  check(`a grand prize's worth is rounded by RoundReward after scaling (90 to 200: down to the 10), raw kept beside it (${gp.rawWorth.toFixed(1)} -> ${gp.worth})`, near(gp.rawWorth, 123.3, 1e-9) && gp.worth === 120)
  const gpSmall = grandPrize(createReward({ coins: 4 }), createSegment({ prizeFactor: 1.2 }), createRewards())
  const gpBig = grandPrize(createReward({ coins: 230 }), createSegment({ prizeFactor: 1 }), createRewards())
  check(`...under 90 to the 5, and a 5 becomes 10 (4.8 -> ${gpSmall.worth}); above 200 to the 50 (230 -> ${gpBig.worth})`, gpSmall.worth === 10 && gpBig.worth === 250)
  check('...and an older save\'s "round to" is not read', grandPrize(createReward({ coins: 90 }), createSegment({ prizeFactor: 1.37 }), { ...createRewards(), grandPrizeRoundTo: 5 }).worth === 120)
  const d = dishPrize(dish('d', { a: 1 }, { reward: createReward({ coins: 7, undo: 1 }) }), createSegment({ prizeFactor: 1.37 }), createRewards())
  check(`a dish prize is not rounded that way (${d.worth.toFixed(4)})`, near(d.worth, 7 * 1.37 + 1.37 * 0.25, 1e-9))
  check('a prize that is not known is unknown, not zero', dishPrize(dish('d', { a: 1 }), seg, createRewards()).worth === null && grandPrize(null, seg, createRewards()).worth === null && rewardWorth({ coins: 1, wild: null, extraStock: 0, freeRound: 0, undo: 0 }, values) === null && rewardWorth(createReward({ wild: 1 }), { ...values, wild: null }) === null)
  const legacy = dishPrize(dish('d', { a: 1 }, { legacyWorth: 4 }), seg, createRewards())
  check('an older single prize number is counted as coins, and marked as such', legacy.worth === 12 && legacy.legacy === true)
  const table = prizeTable(chef({ dishes: [dish('d1', { a: 1 }, { reward }), dish('d2', { a: 1 })], rewards: { grandPrize: { main: createReward({ coins: 90 }) } } }), seg)
  check(`the payout of a run counts what is known and says what is not ("${table.missing[0]}")`, !table.complete && table.missing.length === 1 && table.main[0].worth === 44.5 && table.mainGrand.worth === 250)
  const paid = play(chef({ dishes: [dish('d1', { a: 1 }, { reward: createReward({ coins: 5 }) }), dish('d2', { a: 1 }, { reward: createReward({ coins: 3, undo: 4 }) })], rc: [dish('r1', { b: 1 }, { reward: createReward({ coins: 2 }) })], rewards: { grandPrize: { main: createReward({ coins: 90 }), rc: createReward({ coins: 20 }) } }, segment: { prizeFactor: 1.2 }, sources: [give(1, 'a', 2), give(2, 'b', 1)] }))
  check(`a player is paid each dish cooked, the grand prize on the last Main dish, and Recompletion's own (${paid.worth.main.toFixed(2)} + ${paid.worth.mainGrand} + ${paid.worth.rc.toFixed(2)} + ${paid.worth.rcGrand})`, near(paid.worth.main, 6 + 3.6 + 1.2, 1e-9) && paid.worth.mainGrand === 100 && near(paid.worth.rc, 2.4, 1e-9) && paid.worth.rcGrand === 25 && near(paid.payout, paid.worth.main + 100 + 2.4 + 25, 1e-9))
}

console.log('--- 9. The same players; a change moves nothing but what it changes ---')
{
  const event = { ...H, thresholds: [limit('green-jelly', [[1, 6]])], targets: createTargets({ mainFuDay: 14 }) }
  const seg = event.segments[4]
  const a = simulateSegment(event, seg, { players: 150, seed: 42 })
  const b = simulateSegment(event, seg, { players: 150, seed: 42 })
  const c = simulateSegment(event, seg, { players: 150, seed: 43 })
  check('the same players give the same result to the last digit; other players do not', same(a, b) && !same(a.days, c.days))
  check(`a run says what it was played with (${a.meta.engine}, ${a.meta.players} players, players number ${a.meta.seed}, ${a.meta.variation})`, a.meta.engine === ENGINE_VERSION && a.meta.players === 150 && a.meta.seed === 42 && a.meta.variation === 'activity' && a.meta.usePresets === true)
  const none = comparePaired(event, seg, {}, {}, { players: 120, seed: 5 })
  check('a change that changes nothing gives the very same players: every pantry, every prize', none.identical && none.payoutDelta === 0 && none.changedShare === 0)
  const never = { ...event, presets: [createPreset({ id: 'never', name: 'Never fits', eligibility: { dishesMin: 99 }, allocations: { 3: { sugar: 3 }, 4: { sugar: 4 }, 5: { sugar: 5 } } })], sources: [createSource({ id: 'nobody', day: 3, ingredientId: 'sugar', amount: 50, coveragePct: 0 })] }
  const zero = comparePaired(event, seg, {}, { state: never }, { players: 120, seed: 5 })
  check('...and so does a preset nobody qualifies for, or a sale that reaches 0% of the players', zero.identical && zero.changedShare === 0)
  // One more basket: every other basket rolls what it rolled.
  const plain = { ...H, thresholds: [] }
  const w = prepareWorld(plain, seg)
  const before = basketsOf(simulatePlayer(w, { seed: 8, player: 3, trace: true }))
  const after = basketsOf(simulatePlayer(w, { seed: 8, player: 3, trace: true, extraBaskets: [{ id: 'one-more', day: 2, chestType: 'basic' }] }))
  const key = (e) => `${e.day}|${e.chestType}|${JSON.stringify(e.rolled)}`
  const extraIndex = after.findIndex((e, i) => key(e) !== key(before[i] ?? {}))
  const without = [...after.slice(0, extraIndex), ...after.slice(extraIndex + 1)]
  check(`one more basket on day 2 changes no other basket of the event: all ${before.length} roll exactly what they rolled`, after.length === before.length + 1 && same(without.map(key), before.map(key)) && after[extraIndex].day === 2)
  const more = oneMoreBasket(plain, seg, { chestType: 'epic', day: 1, players: 200, seed: 8 })
  check(`so "one more basket" is a clean comparison: ${(more.changedShare * 100).toFixed(0)}% of the players end differently, worth ${more.payoutDelta.toFixed(2)} a player on average, and never fewer dishes`, more.payoutDelta >= 0 && more.dishesDelta >= 0 && more.changedShare > 0 && more.changedShare < 1)
  const stream = (parts) => Array.from({ length: 3 }, keyedRng(1, ...parts))
  check('a random stream is named by what it is for: the same name, the same numbers; another name, others', same(stream([4, 'size', 2]), stream([4, 'size', 2])) && !same(stream([4, 'size', 2]), stream([4, 'size', 3])) && !same(stream([4, 'size', 2]), stream([5, 'size', 2])))
}

console.log('--- 10. Supply: an average a day or a number for each day, kept in both kinds of run ---')
{
  for (const shape of ACTIVITY_SHAPES) {
    const weights = shapeWeights(shape, H.calendar)
    check(`"${shape}" only moves baskets between days: its weights add up to the event's ${H.calendar.totalDays} days (${sum(weights).toFixed(6)})`, near(sum(weights), H.calendar.totalDays, 1e-9) && (shape === 'flat' ? weights.every((v) => v === 1) : new Set(weights.map((v) => v.toFixed(6))).size > 1))
  }
  const seg = { ...H.segments[3], activityShape: 'taper' }
  const expected = supplyTotal(expectedSupply(seg, H.calendar))
  check(`an average a day is spread over the event without changing its total (3.8 Basic x 21 days = ${expected.basic.toFixed(2)})`, near(expected.basic, 3.8 * 21, 1e-9) && near(expected.rare, 0.7 * 21, 1e-9) && near(expected.epic, 0.2 * 21, 1e-9))
  const state = { ...H, segments: [seg] }
  for (const variation of ['baskets', 'activity']) {
    const r = simulateSegment(state, seg, { players: 1500, seed: 77, variation, keepRecords: true })
    const per = r.records.map((x) => x.opened.basic)
    const spread = Math.max(...per) - Math.min(...per)
    check(
      `${variation === 'baskets' ? 'basket luck only' : 'player activity too'}: players open what was typed on average (Basic ${r.supply.opened.basic.toFixed(2)} of ${expected.basic.toFixed(2)}, Rare ${r.supply.opened.rare.toFixed(2)} of ${expected.rare.toFixed(2)}, Epic ${r.supply.opened.epic.toFixed(2)} of ${expected.epic.toFixed(2)}); from the lightest player to the heaviest: ${spread} baskets`,
      near(r.supply.opened.basic, expected.basic, variation === 'baskets' ? 0.5 : expected.basic * 0.03) && near(r.supply.opened.rare, expected.rare, variation === 'baskets' ? 0.5 : expected.rare * 0.05) && near(r.supply.opened.epic, expected.epic, variation === 'baskets' ? 0.5 : expected.epic * 0.08) && (variation === 'baskets' ? spread <= 1 : spread > 20),
    )
  }
  const tiny = createSegment({ id: 'tiny', name: 'Tiny', supply: createSupply({ average: { epic: 0.04 } }) })
  const few = simulateSegment({ ...H, segments: [tiny] }, tiny, { players: 2000, seed: 3, variation: 'baskets' })
  check(`a rate too small for a whole basket is not dropped: 0.04 Epic a day is ${few.supply.expected.epic.toFixed(2)} over the event, and players open ${few.supply.opened.epic.toFixed(2)} on average`, near(few.supply.opened.epic, 0.84, 0.04))
  // A number for every day.
  const daily = { basic: Array.from({ length: 21 }, (_, i) => (i < 7 ? 6 : 1)), rare: new Array(21).fill(0), epic: new Array(21).fill(0) }
  const typed = createSegment({ id: 'typed', name: 'Typed', activityShape: 'taper', supply: createSupply({ mode: 'daily', average: { basic: 99 }, daily }) })
  const exp = expectedSupply(typed, H.calendar)
  check('typed day by day, the days are played as typed - no shape and no average on top', same(exp.basic, daily.basic) && sum(exp.rare) === 0)
  const world = prepareWorld({ ...H, segments: [typed] }, typed)
  for (const variation of ['baskets', 'activity']) {
    const perDay = new Array(21).fill(0)
    const players = 1500
    for (let player = 0; player < players; player += 1) for (const e of basketsOf(simulatePlayer(world, { seed: 13, player, variation, trace: true }))) perDay[e.day - 1] += 1 / players
    check(`...in a run with ${variation === 'baskets' ? 'basket luck only' : 'player activity'}: day 1 ${perDay[0].toFixed(2)} of 6, day 7 ${perDay[6].toFixed(2)} of 6, day 8 ${perDay[7].toFixed(2)} of 1, day 21 ${perDay[20].toFixed(2)} of 1`, perDay.every((v, i) => near(v, daily.basic[i], variation === 'baskets' ? 1e-9 : daily.basic[i] * 0.08)))
  }
  const sweep = supplySweep(H, H.segments[2], { players: 120, seed: 4, variation: 'baskets' })
  check(`more baskets never cook fewer dishes on average (${sweep.map((s) => s.meanDishes.toFixed(1)).join(' ')})`, sweep.every((s, i) => i === 0 || s.meanDishes >= sweep[i - 1].meanDishes - 0.05) && sweep[6].meanDishes > sweep[0].meanDishes)
  const base = createSegment({ id: 'b', effortFactor: 1 })
  const hard = createSegment({ id: 'h', effortFactor: 1.4 })
  const byId = Object.fromEntries(H.ingredients.map((i) => [i.id, i]))
  const witch = H.dishes[11]
  const typedBlocker = { ...witch, blockerBySegment: { h: { 'green-jelly': 9 } } }
  check(
    `effort scales ordinary and semi-blocker quantities, never the blocker (x1.4: ${recipeForSegment(witch, hard, byId).map((r) => r.count).join('/')} from ${recipeForSegment(witch, base, byId).map((r) => r.count).join('/')}); a blocker quantity is typed per segment (${recipeForSegment(typedBlocker, hard, byId).at(-1).count})`,
    same(recipeForSegment(witch, base, byId).map((r) => r.count), [11, 13, 14, 7]) && same(recipeForSegment(witch, hard, byId).map((r) => r.count), [15, 18, 20, 7]) && recipeForSegment(typedBlocker, hard, byId).at(-1).count === 9 && recipeForSegment(typedBlocker, base, byId).at(-1).count === 7 && recipeForSegment(H.dishes[1], hard, byId).find((r) => r.ingredientId === 'pumpkin').count === 6,
  )
}

console.log('--- 11. Saving, older saves, and the checks in plain words ---')
{
  const v1 = { ingredients: halloween.INGREDIENTS, dishes: halloween.DISHES, recompletionDishes: halloween.RECOMPLETION_DISHES, recompletionCaps: halloween.RECOMPLETION_INGREDIENT_CAPS, baskets: halloween.BASKETS, calendar: halloween.CALENDAR, segments: halloween.SEGMENTS, totalChefPrize: halloween.TOTAL_CHEF_PRIZE, grants: [{ id: 'g1', day: 4, ingredientId: 'pumpkin', amount: 6, coveragePct: 40, label: 'sale' }] }
  const oldLibrary = { configs: [{ id: 'cfg-1', name: 'My Halloween', updatedAt: '2026-11-01T00:00:00.000Z', state: v1 }], activeConfigId: 'cfg-1' }
  const lib = migrateLibrary(JSON.parse(JSON.stringify(oldLibrary)))
  const entry = lib.configs[0]
  check('an older library opens: the same chef id and name, every ingredient, dish, basket and segment id as it was', entry.id === 'cfg-1' && entry.name === 'My Halloween' && same(entry.state.ingredients.map((i) => i.id), v1.ingredients.map((i) => i.id)) && same(entry.state.dishes.map((d) => d.id), v1.dishes.map((d) => d.id)) && same(entry.state.baskets, JSON.parse(JSON.stringify(v1.baskets))) && same(entry.state.segments.map((s) => s.id), v1.segments.map((s) => s.id)))
  check('...the chef as it was is kept beside it, untouched, to download', same(entry.legacy.state, JSON.parse(JSON.stringify(v1))) && entry.legacy.schemaVersion === 1)
  check(`...its sale became a special source that may not pass a threshold; its baskets a day became the segment's supply (${entry.state.segments[0].supply.average.basic} Basic)`, entry.state.sources.length === 1 && entry.state.sources[0].bypassThreshold === false && entry.state.sources[0].coveragePct === 40 && entry.state.segments[0].supply.average.basic === 2.6 && entry.state.segments[3].prizeFactor === 1.2 && entry.state.segments[5].prizeFactor === 1.5)
  const again = migrateLibrary(JSON.parse(JSON.stringify(lib)))
  check('saved and opened again it is the same, and is not converted a second time', same(again.configs[0].state, lib.configs[0].state) && same(again.configs[0].legacy, lib.configs[0].legacy))
  const single = migrateLibrary(JSON.parse(JSON.stringify(v1)))
  check('the oldest save - one chef, no library - opens too', single.configs.length === 1 && single.configs[0].state.schemaVersion === SCHEMA_VERSION && single.configs[0].legacy)
  check('a file that is not a Chef backup is refused whole', parseImportedLibrary('not json') === null && parseImportedLibrary('{"configs":[]}') === null && parseImportedLibrary('{"configs":[{"id":"x","state":{}}]}') === null && parseImportedLibrary('{"segments":[]}') === null)
  check('a backup of today comes back as it was', same(parseImportedLibrary(JSON.stringify(lib)).configs[0].state, lib.configs[0].state))
  const custom = migrateChefState({ ...v1, dishes: v1.dishes.map((d, i) => (i === 0 ? { ...d, prizeValue: 2 } : d)) }).state
  check('dish prizes that are not the sheet\'s keep their single number, counted as coins - no components are made up', custom.dishes.every((d) => d.reward === null) && custom.dishes[0].legacyWorth === 2 && prizeTable(custom, custom.segments[0]).missing.some((m) => /older single prize number/.test(m)))
  check('a chef is told from another by a fingerprint, which changes with any edit', fingerprint(H) === fingerprint(JSON.parse(JSON.stringify(H))) && fingerprint(H) !== fingerprint({ ...H, targets: createTargets({ mainFuDay: 12 }) }))
  const removed = removeIngredientEverywhere('x', chef({ dishes: [dish('d', { a: 1, x: 2 })], thresholds: [limit('x', [[1, 2]])], sources: [give(1, 'x', 1), give(1, 'a', 1)], presets: [createPreset({ id: 'p', allocations: { 3: { x: 1, a: 2 } }, eligibility: { missingIngredientId: 'x', missingMin: 1 } })] }))
  check('removing an ingredient takes it out of every recipe, basket, threshold, source and preset', removed.ingredients.length === 2 && removed.dishes[0].recipe.length === 1 && removed.thresholds.length === 0 && removed.sources.length === 1 && same(removed.presets[0].allocations, { 3: { a: 2 } }) && removed.presets[0].eligibility.missingIngredientId === null && removed.baskets.every((b) => b.ingredientWeights.every((w) => w.ingredientId !== 'x')))
  // The checks.
  const messy = chef({ days: 5, dishes: [dish('d', { a: 9 })], rc: [dish('r1', { a: 1 })], ingredients: [createIngredient({ id: 'a', name: 'Apple', pantryCap: 4 }), createIngredient({ id: 'b', name: 'Butter' }), createIngredient({ id: 'x', name: 'Jelly', rarity: RARITY.BLOCKER })], thresholds: [limit('a', [[4, 3], [2, 5]]), limit('b', [[9, 1]])], sources: [give(9, 'a', 1)], targets: { mainFuDay: 12, checkpoints: [createCheckpoint({ day: 2, dishes: 5 })] } })
  messy.baskets[0].ingredientWeights[0].min = 1
  messy.calendar.dishMaster = { startDay: 4, endDay: 2 }
  const findings = validateChefConfig(messy)
  const has = (re, severity, step) => findings.some((f) => re.test(f.message) && f.severity === severity && f.step === step)
  check('a dish that needs more than the pantry can hold needs a fix, in the dishes step', has(/more than the pantry can hold/, 'block', 'dishes'))
  check('a schedule out of order, a step or a source outside the event, need a fix in the baskets step', has(/not in the order of their days/, 'block', 'baskets') && has(/outside the event's 5 days/, 'block', 'baskets'))
  check('an FU day, a checkpoint or Dish Master days that cannot be need a fix in the event step', has(/FU target is set for day 12/, 'block', 'event') && has(/asks for 5 dishes/, 'block', 'event') && has(/Dish Master runs from day 4 to day 2/, 'block', 'event'))
  check('a basket minimum above 0 is kept, flagged and not played', has(/minimum of 1 a basket/, 'review', 'baskets') && play(messy, {}).events.length > 0)
  check('Recompletion with other than three dishes is worth a look', has(/the rule is three new dishes/, 'review', 'dishes'))
  check('findings are written in plain words, with the names on screen', findings.every((f) => !/undefined|NaN|null|\bid\b/.test(f.message)) && Object.keys(SEVERITY_LABELS).length === 3)
  const blockerNotes = validateChefConfig({ ...H, thresholds: [limit('green-jelly', [[1, 6]])], targets: createTargets({ mainFuDay: 14 }) }).filter((f) => /Green Jelly/.test(f.message) && f.area === 'Thresholds')
  check(`the checks say what a blocker's threshold leaves the last dish short of ("${blockerNotes[0]?.message.slice(0, 96)}...")`, blockerNotes.length === 1 && /leaves the last one 4 short/.test(blockerNotes[0].message))
}

console.log('--- 12. The figures of a run ---')
{
  const event = { ...H, ingredients: H.ingredients.map((i) => ({ ...i, pantryCap: i.sourceCap })), thresholds: [limit('green-jelly', [[1, 6]]), limit('pumpkin', [[1, 0], [6, 8], [11, null]]), limit('green-jelly', [[1, 3]], 'rc')], targets: createTargets({ mainFuDay: 16, checkpoints: [createCheckpoint({ id: 'c', day: 10, dishes: 6, sharePct: 80 })] }), sources: [createSource({ id: 'j', kind: 'joker', day: 12, amount: 1, coveragePct: 30 })] }
  const seg = event.segments[5]
  const t0 = Date.now()
  const r = simulateSegment(event, seg, { players: 400, seed: 2026, keepRecords: true })
  const ms = Date.now() - t0
  check(`400 players of a heavy segment through 21 days in ${ms} ms`, ms < 5000)
  const conserved = r.records.every((p) => event.ingredients.every((i) => p.totals.rolled[i.id] === p.totals.accepted[i.id] + p.totals.lost[i.id] && p.totals.accepted[i.id] === p.totals.consumed[i.id] + p.pantry[i.id] && p.pantry[i.id] <= i.pantryCap && p.pantry[i.id] >= 0))
  check('for every player and every ingredient: rolled = kept + lost, kept = cooked + on hand, and the pantry never above its cap', conserved)
  check('every day: the shares by number of dishes add up to 1, dishes never go down, finished and ever-in-FU never go down', r.days.every((d, i) => near(sum(d.dist), 1, 1e-9) && (i === 0 || (d.mean >= r.days[i - 1].mean && d.finished >= r.days[i - 1].finished && d.everFu >= r.days[i - 1].everFu && d.rcEntered >= r.days[i - 1].rcEntered))))
  check(`in FU now, ever in FU and finished are three figures (day 16: ${(r.fuTarget.inFu * 100).toFixed(0)}% / ${(r.fuTarget.everFu * 100).toFixed(0)}% / ${(r.fuTarget.finished * 100).toFixed(0)}%), and a player in FU has not finished`, r.fuTarget.inFu + r.fuTarget.finished <= 1 + 1e-9 && r.fuTarget.everFu >= r.fuTarget.inFu && r.records.every((p) => !Array.from(p.days.state).some((s) => (s & 1) && (s & 2))))
  check(`when finishers finished is told among finishers, with those who did not kept in sight (${(r.finish.share * 100).toFixed(0)}% finish, middle finisher day ${r.finish.p50}; ${(r.finish.unfinishedShare * 100).toFixed(0)}% do not)`, near(r.finish.share + r.finish.unfinishedShare, 1, 1e-9) && (r.finish.share === 0 || r.finish.p50 >= 1))
  const missing = r.ingredients.filter((i) => i.missingShare > 0)
  check(`what the unfinished players lack, ingredient by ingredient (${missing.map((i) => `${i.id} ${(i.missingShare * 100).toFixed(0)}% lack ${i.missingMean.toFixed(1)}`).join(', ') || 'none unfinished'})`, r.unfinishedCount === 0 || missing.length > 0)
  check(`what the pantry cap cost (lost a player: ${r.ingredients.map((i) => i.lost.toFixed(1)).join(' ')}) and what is left over (${r.ingredients.map((i) => i.onHand.toFixed(0)).join(' ')})`, r.ingredients.every((i) => i.lost >= 0 && near(i.rolled, i.accepted + i.lost, 1e-6) && near(i.accepted, i.consumed + i.onHand, 1e-6)) && r.ingredients.some((i) => i.lost > 0))
  check(`Recompletion: ${(r.rc.enteredShare * 100).toFixed(0)}% enter it (middle day ${r.rc.entryP50}), ${(r.rc.fuEverShare * 100).toFixed(0)}% reach its FU ${r.rc.daysToFuP50} days after entering (middle), ${(r.rc.doneShare * 100).toFixed(0)}% finish it; at entry from the pantry carried over: a dish ${(r.rc.cookedAtEntryShare * 100).toFixed(0)}%, FU ${(r.rc.fuAtEntryShare * 100).toFixed(0)}%, all of it ${(r.rc.doneAtEntryShare * 100).toFixed(0)}%`, r.rc.enteredShare >= r.rc.doneShare && r.rc.cookedAtEntryShare <= r.rc.enteredShare && (r.rc.daysToFuP50 == null || r.rc.daysToFuP50 >= 0))
  check(`the payout counts the Main dishes, the grand prize and what is known of Recompletion, and says it is incomplete (${r.payout.mean.toFixed(1)} a player: ${r.payout.mainDishes.toFixed(1)} + ${r.payout.mainGrand.toFixed(1)} + ${r.payout.rcDishes} + ${r.payout.rcGrand})`, near(r.payout.mean, r.payout.mainDishes + r.payout.mainGrand + r.payout.rcDishes + r.payout.rcGrand, 1e-6) && !r.payout.complete && r.payout.rcDishes === 0 && near(r.payout.mainGrand, r.finish.share * 135, 1e-6))
  const interval = shareInterval(240, 300)
  check(`a share comes with how sure it is for the players played, which is not the spread of the players (80% of 300: ${(interval.low * 100).toFixed(1)}% to ${(interval.high * 100).toFixed(1)}%; 0 of 50: up to ${(shareInterval(0, 50).high * 100).toFixed(1)}%)`, interval.low > 0.75 && interval.low < 0.8 && interval.high > 0.8 && interval.high < 0.85 && shareInterval(0, 50).low === 0 && shareInterval(0, 50).high > 0.05 && shareInterval(0, 0).share === null)
  const story = tracePlayer(event, seg, { seed: 2026, player: 0 })
  const kinds = new Set(story.events.map((e) => e.kind))
  check(`one player's story: the opening pantry, every basket with what was rolled, kept and lost, the dishes, the threshold changes, the move to Recompletion (${story.events.length} lines: ${[...kinds].join(', ')})`, story.events[0].kind === 'start' && ['basket', 'cook', 'threshold'].every((k) => kinds.has(k)) && same(story.pantry, r.records[0].pantry) && story.payout === r.records[0].payout)
  // The older estimate still answers, labelled as what it is.
  const unit = ingredientUnitValues(H, H.segments[0])
  check(`the older basket estimate still works, and says when prizes are missing (a Basic basket of phase 1 "counts for" ${estimateBasketValue(H.baskets[0], unit.unitValue).value.toFixed(2)})`, estimateBasketValue(H.baskets[0], unit.unitValue).value > 0 && unit.incomplete === false && ingredientUnitValues(H, H.segments[0], 'rc').incomplete === true)
}

console.log('--- 13. The review of build 01: small cases, expected against observed ---')
{
  // (Each line says what is EXPECTED and prints what was OBSERVED.)
  const stats = (values) => {
    const mean = sum(values) / values.length
    const sd = Math.sqrt(sum(values.map((v) => (v - mean) ** 2)) / (values.length - 1))
    return { mean, se: sd / Math.sqrt(values.length), min: Math.min(...values), max: Math.max(...values) }
  }
  // A sample mean is allowed 4 standard errors from the expectation: a true mean lands outside that about once in 16,000 checks.
  const within = (st, expected) => Math.abs(st.mean - expected) <= 4 * st.se + 1e-9
  const opensOf = (segment, variation, players = 3000, type = 'epic') => {
    const world = prepareWorld({ ...H, segments: [segment] }, segment)
    return Array.from({ length: players }, (_, player) => simulatePlayer(world, { seed: 31, player, variation }).opened[type])
  }

  // 13.1 Fractional supply.
  const epic = createSegment({ id: 'e', name: 'E', supply: createSupply({ average: { epic: 0.4 } }) })
  const lucky = opensOf(epic, 'baskets')
  const st = stats(lucky)
  check(`0.4 Epic a day, basket luck only - expected 8.4 a player over 21 days, never none, whole baskets: observed ${st.mean.toFixed(3)} (each player ${st.min} or ${st.max}; ${((lucky.filter((v) => v === 9).length / lucky.length) * 100).toFixed(0)}% open 9)`, within(st, 8.4) && st.min === 8 && st.max === 9 && lucky.every(Number.isInteger) && near(lucky.filter((v) => v === 9).length / lucky.length, 0.4, 0.04))
  const active = stats(opensOf(epic, 'activity'))
  check(`...with player activity - expected 8.4 on average, players far apart: observed ${active.mean.toFixed(3)} +- ${active.se.toFixed(3)} (players from ${active.min} to ${active.max})`, within(active, 8.4) && active.max - active.min > 10 && opensOf(epic, 'activity', 200).every(Number.isInteger))
  const basic = createSegment({ id: 'b', name: 'B', supply: createSupply({ average: { basic: 2.6 } }), activityShape: 'weekend-boost' })
  const b1 = stats(opensOf(basic, 'baskets', 3000, 'basic'))
  const b2 = stats(opensOf(basic, 'activity', 3000, 'basic'))
  check(`2.6 Basic a day with a weekend shape - expected 54.6 in both kinds of run: observed ${b1.mean.toFixed(3)} (each player ${b1.min} or ${b1.max}) and ${b2.mean.toFixed(2)} +- ${b2.se.toFixed(2)}`, within(b1, 54.6) && b1.min === 54 && b1.max === 55 && within(b2, 54.6))
  const pattern = Array.from({ length: 21 }, (_, i) => [0.4, 0, 1.5][i % 3])
  const typed = createSegment({ id: 't', name: 'T', supply: createSupply({ mode: 'daily', daily: { basic: [], rare: [], epic: pattern } }) })
  for (const variation of ['baskets', 'activity']) {
    const world = prepareWorld({ ...H, segments: [typed] }, typed)
    const perDay = Array.from({ length: 21 }, () => [])
    const players = 3000
    for (let player = 0; player < players; player += 1) {
      const counts = new Array(21).fill(0)
      for (const e of basketsOf(simulatePlayer(world, { seed: 31, player, variation, trace: true }))) counts[e.day - 1] += 1
      counts.forEach((c, d) => perDay[d].push(c))
    }
    const days = perDay.map(stats)
    check(`typed day by day as 0.4 / 0 / 1.5, ${variation === 'baskets' ? 'basket luck only' : 'player activity'} - expected each day's own number, and nothing on a day of 0: observed day 1 ${days[0].mean.toFixed(3)}, day 2 ${days[1].mean}, day 3 ${days[2].mean.toFixed(3)}`, days.every((d, i) => (pattern[i] === 0 ? d.max === 0 : within(d, pattern[i]))))
  }
  check('the same players open the same baskets on the same days; other players do not', same(opensOf(epic, 'activity', 300), opensOf(epic, 'activity', 300)) && !same(opensOf(epic, 'activity', 300), Array.from({ length: 300 }, (_, player) => simulatePlayer(prepareWorld({ ...H, segments: [epic] }, epic), { seed: 32, player, variation: 'activity' }).opened.epic)))

  // 13.2 FU when the last basket went past the threshold.
  const fuEvent = (sources) => play(chef({ dishes: [dish('first', { x: 3, a: 1 }), dish('last', { x: 6, a: 1 })], thresholds: [limit('x', [[1, 6]])], sources, targets: { mainFuDay: 2 } }))
  const at6 = fuEvent([give(1, 'a', 2), give(1, 'x', 6)])
  const at7 = fuEvent([give(1, 'a', 2), give(1, 'x', 7, { bypassThreshold: true })])
  check(`dishes need 3 and 6 blockers, threshold 6. At 6 received - expected FU, holding 3, short 3: observed in FU ${(at6.days.state[1] & 1) === 1}, holding ${at6.pantry.x}, short ${at6.days.fuShort[1]}`, (at6.days.state[1] & 1) === 1 && at6.pantry.x === 3 && at6.days.fuShort[1] === 3 && at6.counter.main.x === 6)
  check(`...at 7 received (one past the threshold) - expected FU all the same, holding 4, short 2: observed in FU ${(at7.days.state[1] & 1) === 1}, holding ${at7.pantry.x}, short ${at7.days.fuShort[1]}`, (at7.days.state[1] & 1) === 1 && at7.pantry.x === 4 && at7.days.fuShort[1] === 2 && at7.counter.main.x === 7)
  // The same from ordinary baskets, where the overshoot comes from a basket and not from a source.
  const over = chef({ days: 4, dishes: [dish('first', { x: 3, a: 1 }), dish('last', { x: 6, a: 1 })], thresholds: [limit('x', [[1, 6]])], supply: { basic: 3 }, baskets: [createBasket({ id: 'basic', chestType: 'basic', phaseId: 'p', totalMin: 3, totalMax: 3, ingredientWeights: [{ ingredientId: 'a', min: 0, max: 3, weight: 1 }, { ingredientId: 'x', min: 0, max: 3, weight: 1 }] })] })
  const overWorld = prepareWorld(over, over.segments[0])
  const overs = Array.from({ length: 300 }, (_, player) => simulatePlayer(overWorld, { seed: 4, player, variation: 'baskets' })).filter((r) => r.counter.main.x > 6)
  check(`...and when a basket itself goes past the threshold (${overs.length} of 300 players end above 6, up to ${Math.max(...overs.map((r) => r.counter.main.x))}): each is in FU, short of what the two dishes need (9) less what was received`, overs.length > 20 && overs.every((r) => (r.days.state[3] & 1) === 1 && r.days.fuShort[3] === 9 - r.counter.main.x && r.totals.overshoot.x === r.counter.main.x - 6))
  check('a player missing an ordinary ingredient, one still below the threshold, and one who finished are not in FU', (fuEvent([give(1, 'a', 1), give(1, 'x', 6)]).days.state[1] & 1) === 0 && (fuEvent([give(1, 'a', 2), give(1, 'x', 5)]).days.state[1] & 1) === 0 && (fuEvent([give(1, 'a', 2), give(1, 'x', 9, { bypassThreshold: true })]).days.state[1] & 3) === 2)
  const two = { ...over, days: 4, segments: [createSegment({ id: 'slow', name: 'Slow', supply: createSupply({ average: { basic: 1 } }) }), createSegment({ id: 'fast', name: 'Fast', supply: createSupply({ average: { basic: 4 } }) })], targets: createTargets({ mainFuDay: 3 }) }
  const [slow, fast] = two.segments.map((seg) => simulateSegment(two, seg, { players: 300, seed: 6, variation: 'baskets' }))
  check(`the target is read for each segment on its own, and "in FU now", "ever in FU" and "finished" stay three figures (slow ${(slow.fuTarget.inFu * 100).toFixed(0)}% / ${(slow.fuTarget.everFu * 100).toFixed(0)}% / ${(slow.fuTarget.finished * 100).toFixed(0)}%, fast ${(fast.fuTarget.inFu * 100).toFixed(0)}% / ${(fast.fuTarget.everFu * 100).toFixed(0)}% / ${(fast.fuTarget.finished * 100).toFixed(0)}%)`, fast.fuTarget.inFu > slow.fuTarget.inFu && slow.fuTarget.met === false && fast.fuTarget.met === fast.fuTarget.inFu >= 0.8 && fast.fuTarget.finished === 0 && fast.fuTarget.everFu >= fast.fuTarget.inFu)

  // 13.3 The limits, and Main to Recompletion.
  const sugar = [createIngredient({ id: 'a', name: 'Sugar', pantryCap: 40 }), createIngredient({ id: 'b', name: 'Butter' }), createIngredient({ id: 'x', name: 'Jelly', rarity: RARITY.BLOCKER })]
  const onlySugar = [createBasket({ id: 'basic', chestType: 'basic', phaseId: 'p', totalMin: 3, totalMax: 3, ingredientWeights: [{ ingredientId: 'a', min: 0, max: 3, weight: 1 }] })]
  const full = (settings = {}, thresholds = []) => play(chef({ days: 1, ingredients: sugar, baskets: onlySugar, supply: { basic: 2 }, sources: [give(1, 'a', 39)], thresholds, settings }))
  const first = basketsOf(full())[0]
  check(`holding 39 sugar with a pantry cap of 40, a basket rolls 3 - expected 1 kept, 2 lost, nothing in their place: observed rolled ${first.rolled.a}, kept ${first.accepted.a}, lost ${first.lost.a}, pantry ${full().pantry.a}`, first.rolled.a === 3 && first.accepted.a === 1 && first.lost.a === 2 && sum(Object.values(first.rolled)) === 3 && full().pantry.a === 40)
  const r0 = full()
  check(`rolled, kept, lost, cooked and left add up (given ${r0.totals.rolled.a} = kept ${r0.totals.accepted.a} + lost ${r0.totals.lost.a}; kept = cooked ${r0.totals.consumed.a} + left ${r0.pantry.a})`, r0.totals.rolled.a === 45 && r0.totals.accepted.a === 40 && r0.totals.lost.a === 5 && r0.totals.accepted.a === r0.totals.consumed.a + r0.pantry.a)
  const counted = full({ thresholdCounts: 'accepted' }, [limit('a', [[1, 41]])])
  const attempted = full({ thresholdCounts: 'attempted' }, [limit('a', [[1, 41]])])
  check(`whether the 2 lost count toward a threshold of 41 follows the setting: counting what reached the pantry the count is ${counted.counter.main.a} and the next basket still rolls sugar (${basketsOf(counted)[1].rolled.a}); counting everything rolled it is 42 and the next basket is held back (${basketsOf(attempted)[1].rolled.a ?? 0}, ${basketsOf(attempted)[1].short} short)`, counted.counter.main.a === 40 && basketsOf(counted)[1].rolled.a === 3 && attempted.counter.main.a === 42 && (basketsOf(attempted)[1].rolled.a ?? 0) === 0 && basketsOf(attempted)[1].short === 3 && attempted.shortBaskets === 1)
  // Main is finished by the first of three baskets of a day: the other two belong to Recompletion.
  const through = play(chef({ days: 2, baskets: onlySugar, supply: { basic: 3 }, dishes: [dish('main', { a: 3 })], rc: [dish('rc1', { a: 3 }), dish('rc2', { a: 3 }), dish('rc3', { a: 3, b: 99 })] }))
  const day1 = basketsOf(through).filter((e) => e.day === 1)
  check(`three baskets on the day Main is finished by the first - expected Recompletion to begin at once and take the other two, none added and none dropped: observed ${day1.length} baskets that day, Main received ${through.received.main.a}, Recompletion ${through.received.rc.a} in all, 2 of its 3 dishes on day 1 (${through.dishDay.rc.rc1}, ${through.dishDay.rc.rc2})`, day1.length === 3 && through.mainDoneDay === 1 && through.rcEntryDay === 1 && through.received.main.a === 3 && through.received.rc.a === 15 && through.totals.rolled.a === 18 && through.opened.basic === 6 && through.dishDay.rc.rc1 === 1 && through.dishDay.rc.rc2 === 1 && through.rcDishes === 2 && through.rcDoneDay === null)
  check('the round that follows Main is one round of three dishes, cooked once each', through.events.filter((e) => e.kind === 'rc-enter').length === 1 && new Set(Object.keys(through.dishDay.rc)).size === 2 && through.events.filter((e) => e.kind === 'cook' && e.round === 'rc').length === 2)

  // 13.4 A guaranteed catch-up preset: one player who qualifies, one who does not, the same basket.
  const presetEvent = chef({ days: 2, supply: { basic: 2 }, baskets: [createBasket({ id: 'basic', chestType: 'basic', phaseId: 'p', totalMin: 3, totalMax: 4, ingredientWeights: [{ ingredientId: 'a', min: 0, max: 4, weight: 1 }, { ingredientId: 'b', min: 0, max: 4, weight: 1 }] })], dishes: [dish('d1', { a: 99 }), dish('d2', { x: 2, b: 99 })], sources: [createSource({ id: 'half', day: 1, ingredientId: 'x', amount: 2, coveragePct: 50 })], presets: [createPreset({ id: 'P', name: 'Blocker help', maxUses: 1, eligibility: { missingIngredientId: 'x', missingMin: 1 }, allocations: { 3: { x: 1, a: 2 }, 4: { x: 1, a: 3 } } })] })
  const pw = prepareWorld(presetEvent, presetEvent.segments[0])
  const pair = Array.from({ length: 60 }, (_, player) => ({ helped: simulatePlayer(pw, { seed: 12, player, variation: 'baskets', trace: true }), plain: simulatePlayer(pw, { seed: 12, player, variation: 'baskets', trace: true, usePresets: false }) }))
  const hadBlockers = pair.filter((p) => p.helped.totals.special.x === 2)
  const lacked = pair.filter((p) => p.helped.totals.special.x === 0)
  const firstOf = (r) => basketsOf(r)[0]
  check(`a player who lacks the blocker qualifies and gets the guaranteed contents in the place of the first basket (${lacked.length} of 60 players): 1 Jelly and the rest Apple, as many as the basket rolled`, lacked.length > 10 && lacked.every((p) => firstOf(p.helped).preset?.id === 'P' && same(firstOf(p.helped).rolled, { x: 1, a: firstOf(p.helped).rolledSize - 1 }) && sum(Object.values(firstOf(p.helped).rolled)) === firstOf(p.helped).rolledSize))
  check(`a player who was given the blockers does not qualify and opens the ordinary basket (${hadBlockers.length} of 60): the very basket of the play without presets`, hadBlockers.length > 10 && hadBlockers.every((p) => firstOf(p.helped).preset === null && same(basketsOf(p.helped).map((e) => e.rolled), basketsOf(p.plain).map((e) => e.rolled)) && p.helped.presetBaskets === 0))
  check('no basket is added: every player opens the same 4 baskets with and without the preset, each of the size it rolled', pair.every((p) => basketsOf(p.helped).length === 4 && basketsOf(p.plain).length === 4 && same(basketsOf(p.helped).map((e) => e.rolledSize), basketsOf(p.plain).map((e) => e.rolledSize))))
  check('the ordinary draws are the same in both plays: every basket the preset did not take holds exactly what it held without it', lacked.every((p) => same(basketsOf(p.helped).slice(1).map((e) => e.rolled), basketsOf(p.plain).slice(1).map((e) => e.rolled)) && p.helped.presetUses.P === 1))
  check('...while what the player ends with may differ, because the pantry does: a helped player holds a blocker the other play never gave', lacked.every((p) => p.helped.pantry.x === 1 && p.plain.pantry.x === 0))
  // What a preset does to later baskets is real: with a threshold it can use up the allowance an ordinary basket would have had.
  const tight = { ...presetEvent, sources: [], thresholds: [limit('x', [[1, 1]])], baskets: [createBasket({ id: 'basic', chestType: 'basic', phaseId: 'p', totalMin: 3, totalMax: 4, ingredientWeights: [{ ingredientId: 'a', min: 0, max: 4, weight: 1 }, { ingredientId: 'x', min: 0, max: 1, weight: 1 }] })] }
  const tw = prepareWorld(tight, tight.segments[0])
  const tp = Array.from({ length: 60 }, (_, player) => ({ helped: simulatePlayer(tw, { seed: 12, player, variation: 'baskets', trace: true }), plain: simulatePlayer(tw, { seed: 12, player, variation: 'baskets', trace: true, usePresets: false }) }))
  check(`a preset can legitimately change later baskets - having given the 1 blocker the threshold allows, later ordinary baskets leave it out - while their sizes stay the same draws (${tp.filter((p) => !same(basketsOf(p.helped).slice(1).map((e) => e.rolled), basketsOf(p.plain).slice(1).map((e) => e.rolled))).length} of 60 players differ later; nobody ends above the threshold)`, tp.every((p) => same(basketsOf(p.helped).map((e) => e.rolledSize), basketsOf(p.plain).map((e) => e.rolledSize)) && p.helped.counter.main.x <= 1 && p.plain.counter.main.x <= 1) && tp.some((p) => !same(basketsOf(p.helped).slice(1).map((e) => e.rolled), basketsOf(p.plain).slice(1).map((e) => e.rolled))))
}

console.log('--- 14. What an event still needs; a reference chef; the synthetic example ---')
{
  const r = readiness(H)
  const status = Object.fromEntries(r.items.map((i) => [i.id, i.status]))
  const missing = r.items.filter((i) => i.status === 'missing').map((i) => i.id)
  check(`a historical chef is listed as incomplete, input by input (${missing.join(', ')})`, same(missing, ['threshold-blocker', 'threshold-semi', 'threshold-rc', 'dish-master', 'fu-target', 'rc-recipes', 'rc-prizes', 'grand-rc']))
  check('every item says where it is typed, and a missing one says what it stops', r.items.every((i) => ['event', 'dishes', 'baskets', 'simulate'].includes(i.step)) && r.items.filter((i) => i.status === 'missing').every((i) => i.stops.length > 10 && i.detail.length > 5))
  check('what is there but was never confirmed is to confirm, not done: the segments\' factors (a guess of the earlier tool), the supply, the pantry caps, the special sources, the unconfirmed rules', ['segments', 'supply', 'pantry-caps', 'sources', 'open-rules'].every((id) => status[id] === 'confirm') && /earlier tool's guess/.test(r.items.find((i) => i.id === 'segments').detail))
  check('Brut Wins and checkpoints are optional; the Main prizes are done', status['brut-wins'] === 'optional' && status.checkpoints === 'optional' && status['main-prizes'] === 'done' && status['grand-main'] === 'done')
  check('missing prizes make the valuation incomplete and stop no simulation', r.valuationComplete === false && r.canSimulate === true && !r.complete && simulateSegment(H, H.segments[4], { players: 60, seed: 1 }).payout.complete === false)
  const item = r.items.find((i) => i.id === 'segments')
  const ticked = readiness({ ...H, confirmed: { segments: item.mark } })
  const edited = readiness({ ...H, confirmed: { segments: item.mark }, segments: H.segments.map((seg, i) => (i === 0 ? { ...seg, burnout: 0.9 } : seg)) })
  check('a tick is the economist\'s, and is asked again once the values it was given for change', ticked.items.find((i) => i.id === 'segments').status === 'done' && ticked.toConfirm === r.toConfirm - 1 && edited.items.find((i) => i.id === 'segments').status === 'confirm')
  check('ticking an item, or marking a chef as a reference, does not make a run out of date', fingerprint({ ...H, confirmed: { segments: item.mark }, reference: { basedOn: 'Halloween chef' } }) === fingerprint(H))
  check('an empty chef cannot be simulated, and the list says why', readiness(blankChefState()).canSimulate === false && readiness(blankChefState()).items.find((i) => i.id === 'segments').status === 'missing')
  // The synthetic example: every input present, all of it made up and labelled so.
  const S = syntheticExampleState()
  const rs = readiness(S)
  check(`the synthetic example is marked as made up, has every input, and nothing in it is marked as confirmed (${rs.missing} missing, ${rs.toConfirm} to confirm)`, S.synthetic === true && /not an approved economy/.test(SYNTHETIC_NOTE) && rs.missing === 0 && rs.toConfirm === 5 && S.recompletionDishes.length === 3 && S.recompletionDishes.every((d) => /Made-up/.test(d.name)) && !S.confirmed)
  check(`...and passes the checks (${validateChefConfig(S).filter((x) => x.severity === 'block').length} to fix)`, validateChefConfig(S).filter((x) => x.severity === 'block').length === 0)
  check('the historical chef it starts from is untouched by it', same(chefFromSource(halloween), H) && H.recompletionDishes.length === 12 && H.thresholds.length === 0)
  const top = simulateSegment(S, S.segments[5], { players: 300, seed: 2 })
  // (As typed it is far from its FU target - bringing it there is what a proposal is for: verify-chef-proposal.mjs.)
  check(`on it the whole flow can be followed: in FU on the target day ${(top.fuTarget.inFu * 100).toFixed(0)}% and at some point ${(top.fu.everShare * 100).toFixed(0)}%, finish Main ${(top.finish.share * 100).toFixed(0)}%, enter Recompletion ${(top.rc.enteredShare * 100).toFixed(0)}%, reach its FU ${(top.rc.fuEverShare * 100).toFixed(0)}%, a preset for ${(top.presets.affectedShare * 100).toFixed(0)}%, the payout complete (${top.payout.complete})`, top.fuTarget.day === 14 && top.fu.everShare > 0.1 && top.finish.share > 0.3 && top.rc.enteredShare > 0.3 && top.rcCount === 3 && top.payout.complete === true && top.payout.rcDishes > 0)
}

console.log('--- 15. The live segments (the game\'s segment keys, 24 November 2026) ---')
{
  const live = liveSegments()
  check(`nine: Chef_control and the 8 Brut Wins bands, in order (${live.map((s) => s.name.replace('Chef_', '')).join(', ')})`, live.length === 9 && live[0].name === 'Chef_control' && live.slice(1).map((s) => `${s.brutWinsMin}-${s.brutWinsMax}`).join(' ') === '0-10 10-20 20-40 40-60 60-100 100-150 150-240 240-null' && new Set(live.map((s) => s.id)).size === 9)
  check('only names, ranges and definitions are given: effort, prize factor and burnout 1, no baskets - for the economist to type', live.every((s) => s.effortFactor === 1 && s.prizeFactor === 1 && s.burnout === 1 && CHEST_TYPES.every((t) => s.supply.average[t] === 0) && s.definition) && /outside A\/B test 1109/.test(live[0].definition) && /above 10 and at most 20/.test(live[2].definition) && /above 240\./.test(live[8].definition))
  const S = { ...syntheticExampleState(), segments: live }
  const R = readiness(S)
  check('the readiness list does not call the open-ended band or the control "Brut Wins not typed", and says no segment opens a basket yet', R.items.find((i) => i.id === 'brut-wins').status === 'done' && R.items.find((i) => i.id === 'supply').status === 'missing')
  const before = { ...S, segmentsBefore: { at: 'x', segments: syntheticExampleState().segments, planSegmentIds: null } }
  check('the segments kept for the undo are not part of what is played (the same fingerprint)', fingerprint(before) === fingerprint(S))
  const saved = migrateChefState(JSON.parse(JSON.stringify(before))).state
  // A dish the same for every segment (economist, of Black Friday's first dish: "Yes, dish 1 never scales").
  const fixed = createDish({ name: 'First', recipe: [{ ingredientId: 'a', count: 4 }, { ingredientId: 'x', count: 2 }], sameForAllSegments: true })
  const scaled = createDish({ name: 'Other', recipe: [{ ingredientId: 'a', count: 4 }] })
  const ids = { a: createIngredient({ id: 'a', name: 'A' }), x: createIngredient({ id: 'x', name: 'X', rarity: RARITY.SEMI_BLOCKER }) }
  const heavy = createSegment({ effortFactor: 1.4 })
  check('a dish marked "same for every segment" keeps its base quantities, semi-blocker too; another dish is scaled', recipeForSegment(fixed, heavy, ids).map((r) => `${r.count}${r.rule}`).join(' ') === '4fixed 2fixed' && recipeForSegment(scaled, heavy, ids)[0].count === 6 && migrateChefState(JSON.parse(JSON.stringify({ ...S, dishes: [fixed] }))).state.dishes[0].sameForAllSegments === true)
  check('saved and opened again, the definitions and the segments kept for the undo come back', saved.segments.every((s, i) => s.definition === live[i].definition) && saved.segmentsBefore.segments.length === 9)
}

console.log('--- 16. The Black Friday chef, read from its workbook; the Dish Master dishes picked ---')
{
  const B = blackFridayChefState()
  const byId = Object.fromEntries(B.ingredients.map((i) => [i.id, i]))
  const seg = (name) => B.segments.find((s) => s.name === name)
  const qty = (segment, dishName, ing) => recipeForSegment(B.dishes.find((d) => d.name === dishName), segment, byId).find((r) => r.ingredientId === ing)?.count
  check(`12 Main dishes asking for ${B.dishes.reduce((a, d) => a + d.recipe.reduce((b, r) => b + r.count, 0), 0)} at the base, as "Chef - Demand"; Gold flakes in 5, Caviar in 2 (4 + 8)`, B.dishes.length === 12 && B.dishes.reduce((a, d) => a + d.recipe.reduce((b, r) => b + r.count, 0), 0) === 297 && B.dishes.filter((d) => d.recipe.some((r) => r.ingredientId === 'gold-flakes')).length === 5 && B.dishes.flatMap((d) => d.recipe.filter((r) => r.ingredientId === 'caviar').map((r) => r.count)).join('+') === '4+8')
  check('a segment\'s recipes are the workbook\'s segment tabs (Chef_BW_0_10 x0.8, Chef_BW_240_Plus x1.4), Caviar never scaled, Golden Chocolate Cubes the same for all', qty(seg('Chef_BW_0_10'), 'Sale Fortune Cookies', 'flour') === 6 && qty(seg('Chef_BW_0_10'), 'Sale Fortune Cookies', 'eggs') === 3 && qty(seg('Chef_BW_0_10'), 'Glitzy Glazed Donuts', 'gold-flakes') === 6 && qty(seg('Chef_BW_240_Plus'), 'Sale Fortune Cookies', 'flour') === 10 && qty(seg('Chef_BW_240_Plus'), 'Chocolate Mousse Cups', 'gold-flakes') === 6 && qty(seg('Chef_BW_240_Plus'), 'Devilled Eggs', 'caviar') === 8 && qty(seg('Chef_BW_240_Plus'), 'Golden Chocolate Cubes', 'chocolate') === 4 && qty(seg('Chef_BW_0_10'), 'Golden Chocolate Cubes', 'gold-flakes') === 2)
  check('nine live segments: effort and baskets a day from the workbook, Chef_control empty; pantry caps 40/40/40/40/40/30/30/15', B.segments.length === 9 && seg('Chef_BW_60_100').effortFactor === 1.2 && seg('Chef_BW_60_100').supply.average.basic === 4.2 && seg('Chef_BW_240_Plus').supply.average.rare === 4 && seg('Chef_control').supply.average.basic === 0 && B.ingredients.map((i) => i.pantryCap).join('/') === '40/40/40/40/40/30/30/15')
  check('the baskets are the production strings: Basic never gives Caviar, Gold flakes 50 in period 1', B.baskets.length === 6 && B.baskets.filter((b) => b.chestType === 'basic').every((b) => b.ingredientWeights.find((w) => w.ingredientId === 'caviar').weight === 0) && B.baskets.find((b) => b.id === 'epic-phase2').ingredientWeights.find((w) => w.ingredientId === 'caviar').weight === 100 && B.baskets.find((b) => b.id === 'rare-phase1').ingredientWeights.find((w) => w.ingredientId === 'gold-flakes').weight === 50)
  const R = readiness(B)
  const status = (id) => R.items.find((i) => i.id === id).status
  check(`nothing missing was made up: the Dish Master days and dishes, the FU day, thresholds and Recompletion are listed as missing (${['dish-master', 'dish-master-dishes', 'fu-target', 'threshold-blocker', 'rc-recipes'].map(status).join(', ')})`, ['dish-master', 'dish-master-dishes', 'fu-target', 'threshold-blocker', 'rc-recipes'].every((id) => status(id) === 'missing') && validateChefConfig(B).filter((f) => f.severity === 'block').length === 0 && /five dishes and no Dish Master dishes are picked|is in 5 Main dishes/.test(validateChefConfig(B).map((f) => f.message).join(' ')))
  const DM = { ...B, calendar: { ...B.calendar, dishMaster: { startDay: 8, endDay: 12, dishIds: ['bf-gold-macarons', 'bf-sale-chocolate-cake', 'bf-chocolate-mousse-cups'] } } }
  const r = simulateSegment(DM, seg('Chef_BW_40_60'), { players: 100, seed: 3 })
  const r5 = simulateSegment({ ...DM, calendar: { ...DM.calendar, dishMaster: { startDay: 8, endDay: 12 } } }, seg('Chef_BW_40_60'), { players: 100, seed: 3 })
  check(`with three Dish Master dishes picked, Dish Master is read on those three (${r.dishMaster.dishes}, picked); with none, on all five with Gold flakes (${r5.dishMaster.dishes})`, r.dishMaster.dishes === 3 && r.dishMaster.picked === true && r5.dishMaster.dishes === 5 && r5.dishMaster.picked === false && status('dish-master-dishes') === 'missing' && readiness(DM).items.find((i) => i.id === 'dish-master-dishes').status === 'done')
  const two = { ...DM, calendar: { ...DM.calendar, dishMaster: { ...DM.calendar.dishMaster, dishIds: ['bf-gold-macarons', 'bf-sugar-cookies'] } } }
  check('two picked, one of them without Gold flakes: the checks say so', /2 dishes are picked for the Dish Master; the rule is three/.test(validateChefConfig(two).map((f) => f.message).join(' ')) && /Sugar Cookies is picked for the Dish Master but needs no semi-blocker/.test(validateChefConfig(two).map((f) => f.message).join(' ')))
}

console.log(fails === 0 ? `\n${total}/${total} checks passed` : `\n${fails} of ${total} checks FAILED`)
process.exit(fails === 0 ? 0 : 1)
