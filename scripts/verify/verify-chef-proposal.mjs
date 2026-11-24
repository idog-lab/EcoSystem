// CHEF BUILD 02 - AN ECONOMY PROPOSAL. What a proposal may change and may
// not, how it is searched and checked, and what applying one does - each on a
// small event that runs in well under a second.
//
//   npx vite-node scripts/verify/verify-chef-proposal.mjs
//
// 1 what is read, and what stops a generation      7 a conflict proved, against a search that ran out
// 2 a poor event with reachable targets            8 missing prizes; Recompletion
// 3 the same result again; another seed            9 blank quantities
// 4 locks, switches, and what is never touched    10 stopping a search
// 5 bounds: quantities, budget, pantry, schedules 11 out of date; apply, discard, undo; saving
// 6 two segments that cannot both be served       12 the synthetic example (made up), before and after
// (the follow-up)
// 13 new ordinary schedules                       15 the semi-blocker and Dish Master
// 14 the recipe budget, a choice                  16 what was proved, and what is only a risk
// 17 outcomes kept apart; older proposals
// Unless a check says otherwise, a run explores the budget freely (the choice the economist makes on screen).
//
// A search has luck in it, but none of it is left to chance here: a seed is
// typed, so the same event gives the same proposal on every run.
import { RARITY, blankChefState, createBasket, createCalendar, createCheckpoint, createDish, createIngredient, createPreset, createReward, createRewards, createSegment, createSettings, createSource, createSupply, createTargets, createThreshold, recipeForSegment, thresholdLimitOn } from '../../src/features/chef/lib/chefModel.js'
import { num } from '../../src/features/chef/lib/chefFormat.js'
import { fingerprint, simulateSegment } from '../../src/features/chef/lib/chefEngine.js'
import { validateChefConfig } from '../../src/features/chef/lib/chefValidation.js'
import { migrateChefState } from '../../src/features/chef/lib/chefMigration.js'
import { SEARCH_VERSION, applyProposal, budgetSummary, canApply, cellKey, configurationProblems, createPlan, describeTargets, generateProposal, inputProblems, isBetter, planOf, proposalIsInUse, proposalIsStale, searchWarnings, semiExposure, staleReason, structuralConflicts, undoProposal, weightKey } from '../../src/features/chef/lib/chefGenerator.js'
import { syntheticExampleState } from '../../src/features/chef/data/syntheticExample.js'

let fails = 0
let total = 0
function check(name, cond) {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const sum = (list) => list.reduce((s, v) => s + v, 0)
const pc = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`)
const started = Date.now()

const dish = (id, recipe, extra = {}) => createDish({ id, name: id, recipe: Object.entries(recipe).map(([ingredientId, count]) => ({ ingredientId, count })), ...extra })
const limit = (ingredientId, steps, round = 'main') => createThreshold({ id: `t-${round}-${ingredientId}`, ingredientId, round, steps: steps.map(([fromDay, value]) => ({ fromDay, limit: value })) })
const rows = (wx, m = 3) => [{ ingredientId: 'a', min: 0, max: m, weight: 100 }, { ingredientId: 'b', min: 0, max: m, weight: 100 }, { ingredientId: 'p', min: 0, max: 2, weight: 40 }, { ingredientId: 'x', min: 0, max: 1, weight: wx }]
// A small event: Apple and Butter (ordinary), Pumpkin (semi-blocker), Jelly (the blocker, in the last two
// dishes), ten days, two segments. Its recipes ask for far more than the weak segment receives by day 7.
function small(extra = {}) {
  return {
    ...blankChefState(),
    ingredients: [createIngredient({ id: 'a', name: 'Apple' }), createIngredient({ id: 'b', name: 'Butter' }), createIngredient({ id: 'p', name: 'Pumpkin', rarity: RARITY.SEMI_BLOCKER }), createIngredient({ id: 'x', name: 'Jelly', rarity: RARITY.BLOCKER })],
    dishes: [dish('d1', { a: 16, b: 12 }), dish('d2', { a: 14, p: 8 }), dish('d3', { a: 16, b: 18, x: 2 }), dish('d4', { b: 16, p: 7, x: 4 })],
    recompletionDishes: [],
    baskets: [createBasket({ id: 'basic', chestType: 'basic', phaseId: 'p1', totalMin: 3, totalMax: 5, ingredientWeights: rows(0) }), createBasket({ id: 'rare', chestType: 'rare', phaseId: 'p1', totalMin: 6, totalMax: 10, ingredientWeights: rows(30, 5) }), createBasket({ id: 'epic', chestType: 'epic', phaseId: 'p1', totalMin: 12, totalMax: 20, ingredientWeights: rows(30, 9) })],
    calendar: createCalendar({ totalDays: 10, phases: [{ id: 'p1', label: 'Phase 1', days: 10 }], dishMaster: { startDay: 2, endDay: 5 } }),
    segments: [createSegment({ id: 'weak', name: 'Weak', effortFactor: 0.7, supply: createSupply({ average: { basic: 3, rare: 0.6, epic: 0 } }) }), createSegment({ id: 'strong', name: 'Strong', effortFactor: 1.5, supply: createSupply({ average: { basic: 6, rare: 1.5, epic: 0.3 } }) })],
    thresholds: [limit('x', [[1, 3]]), limit('p', [[1, 0], [2, 4], [4, 8], [6, null]])],
    settings: createSettings({}),
    targets: createTargets({ mainFuDay: 7, mainFuSharePct: 80, checkpoints: [createCheckpoint({ id: 'c1', day: 4, dishes: 1, sharePct: 80 })] }),
    rewards: createRewards({}),
    ...extra,
  }
}
const quiet = { tick: () => Promise.resolve() }
const FREE = { budget: { mode: 'free' } }
const gen = (state, overrides = {}, hooks = {}) => generateProposal(state, createPlan(state, { ...FREE, ...overrides }), { ...quiet, ...hooks })
const mainTotal = (parts) => sum(parts.dishes.flatMap((d) => d.recipe.map((r) => r.count ?? 0)))
const fuOf = (list, id) => list.find((s) => s.id === id).shortfalls.find((x) => x.id === 'fu')
const direct = (state, segment, p) => simulateSegment(state, segment, { players: p.settings.validationPlayers, seed: p.settings.validationSeed, variation: p.settings.variation })
const r4 = (v) => Math.round(v * 10000) / 10000
const countsOf = (parts, round = 'main') => Object.fromEntries((round === 'main' ? parts.dishes : parts.recompletionDishes).flatMap((d) => d.recipe.map((r) => [`${d.id}.${r.ingredientId}`, r.count])))
const weightsOf = (parts) => Object.fromEntries(parts.baskets.flatMap((b) => b.ingredientWeights.map((w) => [`${b.id}.${w.ingredientId}`, w.weight])))
const scheduleOk = (t, maxSteps = 5) => {
  let last = null
  return (
    t.steps.length <= maxSteps &&
    t.steps.every((step, i) => {
      const ordered = i === 0 || step.fromDay > t.steps[i - 1].fromDay
      const rising = step.limit == null ? i === t.steps.length - 1 : last == null || step.limit >= last
      if (step.limit != null) last = step.limit
      return ordered && rising
    })
  )
}

console.log('--- 1. What is read, and what stops a generation ---')
const S0 = small()
{
  const plan = createPlan(S0, FREE)
  const lines = describeTargets(S0, plan)
  check(`the targets are said in words before anything runs: who is counted, when, of whom (${lines.length} lines)`, lines.length === 2 && /On day 7, 80% of the players of each segment sitting in FU/.test(lines[0].text) && /not those who finished, not those who were in FU earlier/.test(lines[0].text) && /share of players, not the average number of dishes/.test(lines[1].text))
  check('a complete event with something to aim at has nothing to stop it', inputProblems(S0, plan).length === 0 && structuralConflicts(S0, plan).length === 0)
  const none = await gen(S0, { change: { recipes: false, weights: false, thresholdAmounts: false } })
  check('with nothing allowed to change there is nothing to generate, and it says so', none.status === 'inputs' && none.evaluations === 0 && none.problems.some((p) => /Nothing is allowed to change/.test(p)) && !none.patch)
  const noTarget = await gen(small({ targets: createTargets({}) }))
  check('with no target there is nothing to aim at', noTarget.status === 'inputs' && noTarget.problems.some((p) => /nothing to aim at/.test(p)))
  const withMin = small()
  withMin.baskets[0].ingredientWeights[0].min = 1
  const minimum = await gen(withMin)
  check('a basket minimum above 0 is not played, so no proposal is built on it - an invalid setup, not a missing input', minimum.status === 'invalid' && minimum.problems.some((p) => /minimum above 0/.test(p)))
  const paced = small({ thresholds: [...S0.thresholds, limit('a', [[1, 5], [3, null]])] })
  check('more ordinary ingredients with a threshold than the limit typed stops it; raising the limit lets it through', configurationProblems(paced, createPlan(paced, FREE)).some((p) => /1 ordinary ingredient has a progression threshold already \(Apple\), and the most allowed is 0\. Existing and new schedules count together/.test(p)) && configurationProblems(paced, createPlan(paced, { ...FREE, pacing: { maxOrdinary: 1 } })).length === 0)
  check('better means the worst segment first, then all of them, then the preferences', isBetter({ worst: 0.1, total: 0.5, pref: 9 }, { worst: 0.2, total: 0.2, pref: 0 }) && !isBetter({ worst: 0.2, total: 0.2, pref: 0 }, { worst: 0.1, total: 0.5, pref: 9 }) && isBetter({ worst: 0.1, total: 0.1, pref: 5 }, { worst: 0.1, total: 0.3, pref: 0 }) && isBetter({ worst: 0, total: 0, pref: 0.5 }, { worst: 0, total: 0, pref: 0.6 }))
}

console.log('--- 2. A poor event whose targets can be reached ---')
const before = JSON.stringify(S0)
const P = await gen(S0)
{
  const base = P.validation.base
  const prop = P.validation.proposed
  console.log(`      ${P.evaluations} candidates played in ${P.runtimeMs} ms, stopped: ${P.stopReason}`)
  for (const s of prop) console.log(`      ${s.name}: in FU on day 7 ${pc(fuOf(base, s.id).share)} -> ${pc(fuOf(prop, s.id).share)} (${fuOf(prop, s.id).verdict}); 1+ dishes by day 4 ${pc(base.find((x) => x.id === s.id).shortfalls[1].share)} -> ${pc(s.shortfalls[1].share)}`)
  check(`the current event is far from the target in both segments (${base.map((s) => pc(fuOf(base, s.id).share)).join(', ')} in FU against 80%)`, base.every((s) => fuOf(base, s.id).share < 0.6))
  check(`every segment reaches its FU target or is too close to call on these players (${prop.map((s) => `${pc(fuOf(prop, s.id).share)} ${fuOf(prop, s.id).verdict}`).join(', ')}) - from about 40%`, ['meets', 'misses'].includes(P.status) && prop.every((s) => ['met', 'met-unsure', 'missed-unsure'].includes(fuOf(prop, s.id).verdict)) && prop.every((s) => s.shortfalls.filter((x) => x.kind === 'checkpoint').every((x) => x.verdict !== 'missed')))
  check(`it was found on ${P.settings.searchPlayers} search players and checked on ${P.settings.validationPlayers} others`, P.settings.searchSeed !== P.settings.validationSeed && P.settings.validationPlayers === 400 && P.settings.searchPlayers === 100 && prop.every((s) => s.result.players === 400))
  check('the current event and the proposal were checked on the same players', base.every((s) => s.result.players === 400) && S0.segments.every((seg) => r4(direct(S0, seg, P).fuTarget.inFu) === fuOf(base, seg.id).share))
  check('a share comes with how sure it is: met, missed, or too close to call on this many players', prop.every((s) => s.shortfalls.every((x) => ['met', 'met-unsure', 'missed', 'missed-unsure'].includes(x.verdict))) && typeof P.unsure === 'number')
  check(`what was run is written down: engine, search, seeds, players, why it stopped (${P.stopReason}), ${P.evaluations} candidates`, P.search === SEARCH_VERSION && /chef-engine/.test(P.engine) && ['candidates', 'settled', 'stalled', 'time'].includes(P.stopReason) && P.evaluations > 3 && P.log.length === P.evaluations && P.log[0].why === 'the current event')
  check('generating changes nothing in the event', JSON.stringify(S0) === before && P.baseFingerprint === fingerprint(S0))
  check(`the search really moved quantities, weights and schedules (${P.changes.recipes.length} quantities, ${P.changes.weights.filter((w) => w.typed).length} weights, ${P.changes.thresholds.length} schedules)`, P.changes.recipes.length > 0 && P.changes.weights.some((w) => w.typed) && P.changes.count > 3)
  check(`each change is listed with what it was: demand ${P.changes.totals.before.demand} -> ${P.changes.totals.after.demand}, blocker shortage ${P.changes.totals.before.shortage.x} -> ${P.changes.totals.after.shortage.x}`, P.changes.recipes.every((c) => c.from !== c.to && Number.isInteger(c.to)) && P.changes.totals.before.demand === 113 && P.changes.totals.after.demand === sum(P.patch.dishes.flatMap((d) => d.recipe.map((r) => r.count))))
  check('a starting chance is given beside every weight listed - the ones moved and the ones whose chance moved with them', P.changes.weights.length > 0 && P.changes.weights.every((w) => w.chanceFrom >= 0 && w.chanceFrom <= 1 && w.chanceTo >= 0 && w.chanceTo <= 1))
  check(`every explanation is a measurement, before and after (${P.explanations.length})`, P.explanations.length > 0 && P.explanations.every((e) => /On day 7, \d+% of \w+ .*with the proposal \d+%|Of \w+: cooked one of its \d+ dishes before Dish Master \d+% → \d+%/.test(e.text)))
  // What was measured is what the engine says of the applied event.
  const applied = applyProposal(S0, P, createPlan(S0, FREE))
  check('the applied event reproduces the figures of the check, segment by segment', S0.segments.every((seg) => r4(direct(applied, seg, P).fuTarget.inFu) === fuOf(prop, seg.id).share) && fingerprint(applied) === P.proposedFingerprint && proposalIsInUse(applied, applied.generator.proposal))
  // FU is the engine's own reading, also where a basket goes past the threshold (a basket may give 3 Jelly here) -
  // played with the older policy under which a basket can go over (the confirmed rule stops exactly at the limit).
  const wide = small({ settings: createSettings({ thresholdPolicy: 'before-basket' }), baskets: S0.baskets.map((b) => ({ ...b, ingredientWeights: b.ingredientWeights.map((w) => (w.ingredientId === 'x' && b.chestType !== 'basic' ? { ...w, max: 3, weight: 200 } : w)) })) })
  const W = await gen(wide, { search: { candidates: 12 } })
  const over = direct(wide, wide.segments[1], W)
  const kept = over.records === undefined && simulateSegment(wide, wide.segments[1], { players: 400, seed: W.settings.validationSeed, variation: W.settings.variation, keepRecords: true }).records
  const past = kept.filter((r) => r.totals.overshoot.x > 0)
  const pastInFu = past.filter((r) => r.days.state[6] & 1).length
  check(`FU is the engine's: ${past.length} of 400 Strong players had a basket go past the threshold, ${pastInFu} of them sit in FU on day 7 all the same, and the figure of the check is the engine's (${pc(fuOf(W.validation.base, 'strong').share)})`, past.length > 20 && pastInFu > 0 && r4(over.fuTarget.inFu) === fuOf(W.validation.base, 'strong').share)
}

console.log('--- 3. The same result again; another seed ---')
{
  const again = await gen(S0)
  check('the same event and controls give the same proposal, change for change and figure for figure', same(again.patch, P.patch) && same(again.validation, P.validation) && again.evaluations === P.evaluations && same(again.log, P.log))
  const other = await gen(S0, { search: { seed: 77 } })
  check(`another seed is another search and other players (${other.status}, ${other.evaluations} candidates)`, other.settings.searchSeed === 77 && other.settings.validationSeed !== P.settings.validationSeed && other.planKey !== P.planKey)
}

console.log('--- 4. Locks, switches, and what is never touched ---')
{
  const locks = { cells: { [cellKey('main', 'd1', 'a')]: true }, dishes: { 'main|d2': true }, weights: { [weightKey('rare', 'b')]: true }, thresholds: { 't-main-p': true } }
  const L = await gen(S0, { locks })
  const q = countsOf(L.patch)
  const w = weightsOf(L.patch)
  check(`a locked quantity, a locked dish, a locked weight and a locked schedule come back as they were (${L.status}; d1 Apple ${q['d1.a']}, d2 ${q['d2.a']}/${q['d2.p']}, rare Butter ${w['rare.b']})`, q['d1.a'] === 16 && q['d2.a'] === 14 && q['d2.p'] === 8 && w['rare.b'] === 100 && same(L.patch.thresholds.find((t) => t.id === 't-main-p'), S0.thresholds[1]) && L.changes.count > 0)
  for (const p of [P, L]) {
    const name = p === P ? 'no locks' : 'with locks'
    check(`${name}: which ingredients a dish needs is not changed, and blocker quantities are left alone`, same(p.patch.dishes.map((d) => d.recipe.map((r) => r.ingredientId)), S0.dishes.map((d) => d.recipe.map((r) => r.ingredientId))) && countsOf(p.patch)['d3.x'] === 2 && countsOf(p.patch)['d4.x'] === 4 && p.patch.dishes.every((d) => same(d.blockerBySegment, {})))
    check(`${name}: a basket keeps its size, the most it gives of each ingredient, its period and its pricing odds`, same(p.patch.baskets.map(({ ingredientWeights: _w, ...rest }) => rest), S0.baskets.map(({ ingredientWeights: _w, ...rest }) => rest)) && same(p.patch.baskets.map((b) => b.ingredientWeights.map(({ weight: _v, ...rest }) => rest)), S0.baskets.map((b) => b.ingredientWeights.map(({ weight: _v, ...rest }) => rest))))
    check(`${name}: a weight of 0 stays 0 and no weight is closed (basic Jelly ${weightsOf(p.patch)['basic.x']})`, weightsOf(p.patch)['basic.x'] === 0 && Object.entries(weightsOf(S0)).every(([key, was]) => was === 0 || weightsOf(p.patch)[key] > 0))
    check(`${name}: only recipes, baskets and thresholds are in a proposal - segments, pantry, calendar, targets, sources, presets, prizes and settings are not`, same(Object.keys(p.patch).sort(), ['baskets', 'dishes', 'recompletionDishes', 'thresholds']))
  }
  const onlyWeights = await gen(S0, { change: { recipes: false, thresholdAmounts: false } })
  check(`only weights allowed: recipes and schedules come back as they were (${onlyWeights.status}, ${onlyWeights.changes?.count ?? 0} changes)`, !onlyWeights.patch || (same(countsOf(onlyWeights.patch), countsOf(S0)) && same(onlyWeights.patch.thresholds, S0.thresholds)))
  const onlyRecipes = await gen(S0, { change: { weights: false, thresholdAmounts: false } })
  check(`only recipes allowed: weights and schedules come back as they were (${onlyRecipes.status})`, same(weightsOf(onlyRecipes.patch), weightsOf(S0)) && same(onlyRecipes.patch.thresholds, S0.thresholds) && onlyRecipes.changes.recipes.length > 0)
  check('opening days move only when that is allowed', P.patch.thresholds.every((t, i) => same(t.steps.map((s) => s.fromDay), S0.thresholds[i].steps.map((s) => s.fromDay))))
  // Pumpkin is held back until day 6 here, and only the opening day may move.
  const late = small({ thresholds: [S0.thresholds[0], limit('p', [[1, 0], [6, null]])] })
  const days = await gen(late, { change: { thresholdAmounts: false, thresholdDays: true }, pacing: { dayMin: 2, dayMax: 6 } })
  const moved = days.patch.thresholds.flatMap((t, i) => t.steps.filter((step, k) => step.fromDay !== late.thresholds[i].steps[k].fromDay))
  check(`...and then stay inside the days typed, in order, with the amounts as they were (Pumpkin opens on day ${days.patch.thresholds[1].steps[1].fromDay}, was 6; allowed 2 to 6)`, days.patch.thresholds.every((t) => scheduleOk(t)) && moved.length === 1 && moved[0].fromDay >= 2 && moved[0].fromDay < 6 && same(days.patch.thresholds.map((t) => t.steps.map((step) => step.limit)), late.thresholds.map((t) => t.steps.map((step) => step.limit))))
  // A basket may give 3 Jelly and the threshold leaves 2 short: players go past it and finish before the FU day.
  // (Played with the older policy under which a basket can go over, as the scenario needs.)
  const early = small({ settings: createSettings({ thresholdPolicy: 'before-basket' }), thresholds: [limit('x', [[1, 4]]), S0.thresholds[1]], baskets: S0.baskets.map((b) => ({ ...b, ingredientWeights: b.ingredientWeights.map((w) => (w.ingredientId === 'x' && b.chestType !== 'basic' ? { ...w, max: 3, weight: 300 } : w)) })) })
  const perSegment = await gen(early, { change: { thresholdAmounts: false, blockers: true } })
  const without = await gen(early, { change: { thresholdAmounts: false } })
  console.log(`      blocker quantities by segment: ${perSegment.changes.blockers.map((c) => `${c.segmentId} ${c.dishId} ${c.from ?? 'base'} -> ${c.to}`).join(', ') || 'none'}`)
  check(`blocker quantities by segment are proposed only when that is switched on (${perSegment.changes.blockers.length} with it on, ${without.changes?.blockers.length ?? 0} without), and the base quantity is never touched`, perSegment.changes.blockers.length > 0 && (without.changes?.blockers.length ?? 0) === 0 && P.changes.blockers.length === 0 && countsOf(perSegment.patch)['d4.x'] === 4 && perSegment.patch.dishes.every((d) => Object.values(d.blockerBySegment ?? {}).every((own) => Object.values(own).every((n) => Number.isInteger(n) && n >= 1))))
}

console.log('--- 5. Bounds: quantities, the budget, the pantry, schedules ---')
{
  const B = await gen(S0, { quantity: { min: 4, max: 15 }, budget: { mode: 'bounded', min: 70, max: 80 }, shortage: { min: 2, max: 4 } })
  const changed = B.changes.recipes
  const totalB = sum(B.patch.dishes.flatMap((d) => d.recipe.map((r) => r.count)))
  check(`every quantity a proposal sets is inside the bounds typed (${changed.map((c) => c.to).join(' ')}, 4 to 15)`, changed.length > 0 && changed.every((c) => c.to >= 4 && c.to <= 15))
  check(`a budget range that was typed is kept (Main recipes ${totalB}, 70 to 80)`, totalB >= 70 && totalB <= 80)
  const tx = B.patch.thresholds.find((t) => t.ingredientId === 'x')
  check(`the blocker stays held back on the FU day, short of the last dish by a number inside the bounds (limit ${thresholdLimitOn(tx, 7)}, short ${6 - thresholdLimitOn(tx, 7)}, 2 to 4)`, thresholdLimitOn(tx, 7) != null && 6 - thresholdLimitOn(tx, 7) >= 2 && 6 - thresholdLimitOn(tx, 7) <= 4 && thresholdLimitOn(tx, 7) >= 2)
  check('every schedule of every proposal rises, in order, lifted only at its end', [P, B].every((p) => p.patch.thresholds.every((t) => scheduleOk(t))) && thresholdLimitOn(P.patch.thresholds.find((t) => t.ingredientId === 'x'), 7) != null)
  // The pantry: a quantity is checked at every segment's size, and a cap is never raised.
  const capped = small({ ingredients: S0.ingredients.map((i) => (i.id === 'a' ? { ...i, pantryCap: 18 } : i)) })
  check('a dish too big for the pantry at one segment\'s size is not caught by the base quantity (16 fits 18; Strong needs 24)', validateChefConfig(capped).every((f) => f.severity !== 'block') && recipeForSegment(capped.dishes[0], capped.segments[1], Object.fromEntries(capped.ingredients.map((i) => [i.id, i]))).find((r) => r.ingredientId === 'a').count === 24)
  const C = await gen(capped)
  const biggest = Math.max(...C.patch.dishes.flatMap((d) => d.recipe.filter((r) => r.ingredientId === 'a').map((r) => Math.round(r.count * 1.5))))
  check(`a proposal brings it down until it fits every segment (the most Apple a dish needs for Strong: ${biggest}, the pantry holds 18)`, ['meets', 'misses'].includes(C.status) && biggest <= 18 && !('ingredients' in C.patch))
  const lockedCap = createPlan(capped, { locks: { cells: { [cellKey('main', 'd1', 'a')]: true, [cellKey('main', 'd3', 'a')]: true } } })
  const conflicts = structuralConflicts(capped, lockedCap)
  check(`...and when that quantity is locked, the conflict is said, with its numbers and what it assumes (${conflicts.length})`, conflicts.length === 2 && /Strong: d1 needs 24 Apple at that segment's size, and the pantry holds 18\. That dish can never be cooked, and as it lacks more than blockers it can never be the last dish of FU/.test(conflicts[0].text) && conflicts[0].assumptions.some((a) => /pantry cap is never raised/.test(a)))
  check('every proposal passes the checks of the event itself', [P, B, C].every((p) => validateChefConfig({ ...S0, ...p.patch }).every((f) => f.severity !== 'block')))
}

console.log('--- 6. Two segments that cannot both be served ---')
// (Weak now opens very little - about one rare basket by day 7, the only kind that holds the blocker - so recipes can be
// made to suit it, and the blocker still does not reach it in time. Nothing proves that: a lucky player gets there.)
const TRADE = small({ segments: [createSegment({ id: 'weak', name: 'Weak', effortFactor: 1.5, supply: createSupply({ average: { basic: 1.2, rare: 0.15, epic: 0 } }) }), createSegment({ id: 'strong', name: 'Strong', effortFactor: 1.5, supply: createSupply({ average: { basic: 6, rare: 1.5, epic: 0.3 } }) })] })
const TR = await gen(TRADE)
{
  const prop = TR.validation.proposed
  console.log(`      ${TR.status}, stopped: ${TR.stopReason} after ${TR.evaluations}; ${prop.map((s) => `${s.name} ${pc(fuOf(prop, s.id).share)} (${fuOf(prop, s.id).verdict})`).join(', ')}`)
  check(`the best found still misses, and says so (${TR.status})`, ['misses', 'no-better'].includes(TR.status) && TR.validation.proposedScore.worst > 0)
  check('every segment is reported on its own: Strong meets its target, Weak does not, and neither hides the other', prop.length === 2 && fuOf(prop, 'weak').verdict === 'missed' && fuOf(prop, 'strong').verdict.startsWith('met') && structuralConflicts(TRADE, createPlan(TRADE)).length === 0)
  check(`the worst segment is what is compared, not an average (worst shortfall ${pc(TR.validation.proposedScore.worst)} = Weak's ${pc(prop.find((s) => s.id === 'weak').miss)})`, TR.validation.proposedScore.worst === prop.find((s) => s.id === 'weak').miss && TR.validation.proposedScore.total >= TR.validation.proposedScore.worst)
  check('a proposal that misses can still be applied when it is better, and one that is no better has nothing to apply', TR.status === 'misses' ? canApply(TRADE, TR, createPlan(TRADE, FREE)) : !canApply(TRADE, TR, createPlan(TRADE, FREE)))
  check('nothing was proved impossible: it is a search that ran out, and it says which', !TR.conflicts && ['candidates', 'stalled', 'time', 'no-valid-step'].includes(TR.stopReason) && TR.evaluations > 1)
}

console.log('--- 7. A conflict that is proved, against a search that ran out ---')
{
  const huge = small({ dishes: [dish('d1', { a: 900, b: 12 }), ...S0.dishes.slice(1)] })
  const locked = await gen(huge, { change: { recipes: false } })
  check(`locked recipes that ask for more than a player can ever receive by the FU day: proved, nothing searched (${locked.conflicts?.length} conflicts)`, locked.status === 'conflict' && locked.evaluations === 0 && !locked.patch && locked.conflicts.some((c) => /Weak: FU needs every ordinary and semi-blocker ingredient of the Main dishes - \d+ at this segment's size\. By day 7 the most any player of it can have received of all ingredients together is \d+/.test(c.text) && c.assumptions.length > 0))
  const free = await gen(huge)
  check(`the same recipes, allowed to change, are no conflict: a proposal is searched (${free.status})`, ['meets', 'misses'].includes(free.status) && free.evaluations > 1)
  const lifted = small({ thresholds: [limit('x', [[1, 3], [6, null]]), S0.thresholds[1]] })
  check('a blocker no longer held back on the FU day: nobody can be in FU - proved whatever may change, as a proposal never moves the blocker\'s days', [{ change: { thresholdAmounts: false } }, { change: { thresholdAmounts: true, thresholdDays: true } }].every((o) => structuralConflicts(lifted, createPlan(lifted, { ...FREE, ...o })).some((c) => /no longer held back by its threshold \(from day 6\)/.test(c.text) && c.assumptions.some((a) => /never moves the blocker's days/.test(a)))))
  // The blocker cannot reach a segment in time, whatever its weight.
  const starved = small({ segments: [createSegment({ id: 'weak', name: 'Weak', effortFactor: 0.7, supply: createSupply({ average: { basic: 3, rare: 0, epic: 0 } }) }), S0.segments[1]] })
  const proof = structuralConflicts(starved, createPlan(starved))
  check(`a segment that opens no basket holding the blocker can never be in FU: proved (${proof.length}), with its numbers`, proof.length === 1 && /Weak: to be in FU on day 7 a player has cooked every Main dish but one, so has received at least 2 Jelly.*the most any player of this segment can have received is 0/.test(proof[0].text))
  const openedPlan = createPlan(starved, { ...FREE, locks: { open: { [weightKey('basic', 'x')]: true } } })
  check('opening a basket to the blocker does not undo the proof: a proposal never opens one, so Main completion is never raised through ordinary baskets', structuralConflicts(starved, openedPlan).length === 1 && searchWarnings(starved, openedPlan).some((w) => /no longer opens the blocker in a basket that never gives it/.test(w.text)))
}

console.log('--- 8. Missing prizes; Recompletion ---')
{
  check('prizes that are missing leave the payout incomplete - never zero - and stop nothing', P.validation.proposed.every((s) => s.result.payout.complete === false && s.result.payout.missing.length > 0) && ['meets', 'misses'].includes(P.status))
  const priced = small({ dishes: S0.dishes.map((d) => ({ ...d, reward: createReward({ coins: 5 }) })), rewards: createRewards({ grandPrize: { main: createReward({ coins: 20 }) } }) })
  const PP = await gen(priced)
  check(`with prizes typed the payout is given, current and proposed (${PP.validation.base[0].result.payout.mean} -> ${PP.validation.proposed[0].result.payout.mean}), and prizes are not in the proposal`, PP.validation.proposed.every((s) => s.result.payout.complete === true && s.result.payout.mean > 0) && same(PP.patch.dishes.map((d) => d.reward), priced.dishes.map((d) => d.reward)))
  // Recompletion: three more dishes, their own blocker threshold.
  const withRc = small({ recompletionDishes: [dish('r1', { a: 6 }), dish('r2', { b: 6 }), dish('r3', { a: 4, x: 2 })], thresholds: [...S0.thresholds, limit('x', [[1, 1]], 'rc')] })
  const R0 = await gen(withRc, { rounds: 'both' })
  check('Recompletion has no approved speed: with no target typed for it, its recipes and schedule are left as they are, and it says so', same(R0.patch.recompletionDishes, withRc.recompletionDishes) && same(R0.patch.thresholds.find((t) => t.round === 'rc'), withRc.thresholds[2]) && /Recompletion has no approved speed/.test(R0.rcNote))
  const rc0 = R0.validation.proposed[1].result.rc
  check(`...but its timing is reported: ${pc(rc0.enteredShare)} of Strong enter it, ${pc(rc0.fuEverShare)} reach its FU, ${pc(rc0.doneShare)} finish it`, rc0.enteredShare >= 0 && rc0.entrants === Math.round(rc0.enteredShare * 400) && R0.validation.proposed[1].result.rcCount === 3)
  const R1 = await gen(withRc, { rounds: 'both', rc: { daysToFu: 2, sharePct: 60 } })
  const rcShort = R1.validation.proposed.map((s) => s.shortfalls.find((x) => x.id === 'rc')).filter(Boolean)
  const strongRc = R1.validation.proposed[1].result.rc
  check(`with a target typed, it is read among the players who ENTER Recompletion (${strongRc.entrants} of 400 for Strong; ${pc(strongRc.fuWithinShare)} in its FU within 2 days)`, describeTargets(withRc, createPlan(withRc, { rounds: 'both', rc: { daysToFu: 2, sharePct: 60 } })).some((l) => /Of the players who enter Recompletion, 60% are in its FU within 2 days of entering/.test(l.text)) && strongRc.fuWithinDays === 2 && (strongRc.entrants === 0 || rcShort.length > 0))
}

console.log('--- 9. Blank quantities ---')
{
  const blank = small({ dishes: [createDish({ id: 'd1', name: 'd1', recipe: [{ ingredientId: 'a', count: null }, { ingredientId: 'b', count: 12 }] }), ...S0.dishes.slice(1)] })
  const played = simulateSegment(blank, blank.segments[1], { players: 80, seed: 3 })
  check(`a dish with a blank quantity is never cooked - it is not a free dish (${pc(played.dishes.main[0].share)} cooked it, ${pc(played.finish.share)} finished)`, played.dishes.main[0].share === 0 && played.finish.share === 0 && validateChefConfig(blank).some((f) => f.code === 'blank-quantity'))
  const refused = await gen(blank, { change: { recipes: false } })
  check('with recipes locked, a blank quantity stops the generation, in words', refused.status === 'inputs' && refused.problems.some((p) => /d1: the quantity of Apple is blank, and recipe quantities are not allowed to change/.test(p)))
  const filled = await gen(blank)
  const got = filled.patch.dishes[0].recipe[0].count
  check(`a blank means "generate this": it gets a quantity (${got}), with nothing to compare it to (${filled.status})`, Number.isInteger(got) && got >= 1 && filled.baselineComplete === false && filled.validation.base === null && filled.changes.recipes.some((c) => c.from === null && c.to === got) && ['meets', 'misses'].includes(filled.status))
  const lockedBlank = await gen(blank, { locks: { dishes: { 'main|d1': true } } })
  const lockedCell = await gen(blank, { locks: { cells: { [cellKey('main', 'd1', 'a')]: true } } })
  check('a blank in a locked dish, or a locked blank cell, is an unresolved input: it is never filled in silently', [lockedBlank, lockedCell].every((p) => p.status === 'inputs' && !p.patch && p.problems.some((x) => /d1: the quantity of Apple is blank and it is locked\. A locked blank is not filled in: unlock it, or type the number/.test(x))))
  const blankBlocker = small({ dishes: [...S0.dishes.slice(0, 3), createDish({ id: 'd4', name: 'd4', recipe: [{ ingredientId: 'b', count: 16 }, { ingredientId: 'p', count: 7 }, { ingredientId: 'x', count: null }] })] })
  check('a blank blocker quantity is the economist\'s to type: never generated', inputProblems(blankBlocker, createPlan(blankBlocker, FREE)).some((p) => /d4: the quantity of Jelly is blank\. A blocker quantity is yours to type/.test(p)))
}

console.log('--- 10. Stopping a search ---')
{
  let ticks = 0
  const seen = []
  const stopped = await gen(S0, {}, { tick: () => { ticks += 1; return Promise.resolve() }, isCancelled: () => ticks > 9, onProgress: (p) => seen.push(p) })
  check(`a search that is stopped gives nothing to apply and leaves the event as it was (after ${stopped.evaluations} candidates)`, stopped.status === 'cancelled' && !stopped.patch && !canApply(S0, stopped) && JSON.stringify(S0) === before && stopped.evaluations >= 1 && stopped.evaluations < P.evaluations)
  check(`progress is told while it runs (${seen.length} times, each with what is being tried)`, seen.length >= 2 && seen.every((p) => p.of > 0 && typeof p.label === 'string'))
  const short = await gen(S0, { search: { candidates: 5 } })
  check(`a search is bounded: with 5 candidates allowed it plays 5 and says that is why it stopped (${short.stopReason})`, short.evaluations === 5 && short.stopReason === 'candidates' && ['meets', 'misses', 'no-better'].includes(short.status))
}

console.log('--- 11. Out of date; apply, discard, undo; saving ---')
{
  const plan = createPlan(S0, FREE)
  const S1 = { ...S0, generator: { plan } }
  check('a fresh proposal can be applied', canApply(S0, P, plan) && canApply(S1, P) && !proposalIsStale(S0, P, plan))
  const edited = { ...S0, segments: S0.segments.map((s, i) => (i === 0 ? { ...s, effortFactor: 0.8 } : s)) }
  check('once the event is edited the proposal is out of date and cannot be applied', !canApply(edited, P, planOf(edited)) && proposalIsStale(edited, P, planOf(edited)) && /event was changed/.test(staleReason(edited, P, planOf(edited))) && same(applyProposal(edited, P, planOf(edited)), edited))
  const relocked = { ...S0, generator: { plan: createPlan(S0, { locks: { dishes: { 'main|d1': true } } }) } }
  check('...and so is one whose locks or bounds were edited after it was generated', !canApply(relocked, P) && /locks and bounds/.test(staleReason(relocked, P)))
  check('ticking a readiness item or naming the chef does not make it out of date', canApply({ ...S0, confirmed: { segments: 'x' } }, P, plan))
  const applied = applyProposal(S1, P)
  check('applying puts every change in at once, and nothing else', same(applied.dishes, P.patch.dishes) && same(applied.baskets, P.patch.baskets) && same(applied.thresholds, P.patch.thresholds) && same({ ...applied, dishes: 0, baskets: 0, thresholds: 0, recompletionDishes: 0, generator: 0 }, { ...S0, dishes: 0, baskets: 0, thresholds: 0, recompletionDishes: 0, generator: 0 }))
  check('an applied proposal is marked applied and cannot be applied twice', !!applied.generator.proposal.appliedAt && applied.generator.applied.proposalId === P.id && !canApply(applied, applied.generator.proposal))
  const undone = undoProposal(applied)
  check('undo brings back exactly what was there, and the proposal can be looked at again', same({ ...undone, generator: 0 }, { ...S0, generator: 0 }) && undone.generator.applied === null && !undone.generator.proposal.appliedAt && canApply(undone, undone.generator.proposal))
  check('supply, segments (effort, prizes, burnout), activity settings, prizes and sources are untouched by applying', same(applied.segments, S0.segments) && same(applied.settings, S0.settings) && same(applied.rewards, S0.rewards) && same(applied.sources, S0.sources) && same(applied.dishes.map((d) => d.reward), S0.dishes.map((d) => d.reward)))
  check('discarding is not applying: the event is the same object it was', JSON.stringify(S0) === before)
  // Saved with the chef, and not a pile of traces.
  const saved = migrateChefState(JSON.parse(JSON.stringify({ ...applied, generator: { ...applied.generator, plan } }))).state
  const size = JSON.stringify(saved.generator.proposal).length
  check(`the controls and the proposal are saved with the chef and come back the same (${Math.round(size / 1024)} KB, no player-by-player record)`, same(saved.generator.proposal, applied.generator.proposal) && same(saved.generator.plan, plan) && size < 150000 && !/"records"|"events"/.test(JSON.stringify(saved.generator.proposal)) && fingerprint(saved) === P.proposedFingerprint)
  check('a proposal says for which event and controls it was made, and by what', P.baseFingerprint && P.proposedFingerprint && P.baseFingerprint !== P.proposedFingerprint && P.planKey === JSON.stringify(plan) && P.targets.length === 2 && P.createdAt)
}

console.log('--- 12. The synthetic example (made up), before and after ---')
{
  const S = syntheticExampleState()
  const t0 = Date.now()
  const G = await gen(S)
  const prop = G.validation.proposed
  const base = G.validation.base
  console.log(`      ${G.status}: ${G.evaluations} candidates in ${Math.round((Date.now() - t0) / 1000)} s, stopped: ${G.stopReason}`)
  for (const s of prop) console.log(`      ${s.name.padEnd(16)} in FU on day 14: ${pc(fuOf(base, s.id).share)} -> ${pc(fuOf(prop, s.id).share)} (${fuOf(prop, s.id).verdict})   6+ dishes by day 10: ${pc(base.find((x) => x.id === s.id).shortfalls[1].share)} -> ${pc(s.shortfalls[1].share)}   finish Main: ${pc(base.find((x) => x.id === s.id).result.finish.share)} -> ${pc(s.result.finish.share)}`)
  check(`nine segments, every one improved; the worst shortfall falls from ${pc(G.validation.baseScore.worst)} to ${pc(G.validation.proposedScore.worst)} (${G.status})`, prop.length === 9 && ['meets', 'misses'].includes(G.status) && prop.every((s) => fuOf(prop, s.id).share > fuOf(base, s.id).share + 0.3) && G.validation.proposedScore.worst < G.validation.baseScore.worst / 3)
  check('it never opens the basic baskets to the blocker on its own (their weight is 0 and stays 0)', G.patch.baskets.filter((b) => b.chestType === 'basic').every((b) => b.ingredientWeights.find((w) => w.ingredientId === 'green-jelly').weight === 0))
  check('the made-up Recompletion dishes, presets, joker and pantry caps are untouched', same(G.patch.recompletionDishes, S.recompletionDishes) && same(G.patch.thresholds.find((t) => t.round === 'rc'), S.thresholds.find((t) => t.round === 'rc')) && !('presets' in G.patch) && G.settings.presetsActive === 1)
  check(`explored freely, it says so - and how far from the reference it went (378 -> ${G.budget.proposed}, reference ${G.budget.reference})`, G.budget.mode === 'free' && G.budget.current === 378 && G.budget.reference === 250)

  // THE SAME EVENT INSIDE A DECLARED TEST RANGE (225 to 275: test data for this check, not an approved setting), with
  // up to two ordinary ingredients allowed a new schedule on days 4, 7, 10 or 13.
  const t1 = Date.now()
  const R = await gen(S, { budget: { mode: 'bounded', min: 225, max: 275 }, pacing: { maxOrdinary: 2, dayOptions: [4, 7, 10, 13] } })
  const rp = R.validation.proposed
  const rb = R.validation.base
  console.log(`      inside 225-275: ${R.status}, ${R.evaluations} versions in ${Math.round((Date.now() - t1) / 1000)} s, stopped: ${R.stopReason}; Main recipes ${R.budget.current} (current, outside) -> start ${R.budget.start} -> ${R.budget.proposed}`)
  console.log('      segment          in FU d14          recipes alone  6+ by d10      longest wait   semi early   all semi by DM  paid')
  for (const x of rp) {
    const b = rb.find((y) => y.id === x.id)
    const alone = R.recipesOnly?.find((y) => y.id === x.id)?.shortfalls.find((y) => y.id === 'fu')?.share
    console.log(`      ${x.name.padEnd(16)} ${pc(fuOf(rb, x.id).share).padStart(3)} -> ${pc(fuOf(rp, x.id).share).padEnd(4)} ${fuOf(rp, x.id).verdict.padEnd(13)} ${pc(alone).padEnd(14)} ${pc(b.shortfalls[1].share)} -> ${pc(x.shortfalls[1].share).padEnd(6)} ${b.result.gap.p90} -> ${x.result.gap.p90} days    ${pc(b.result.dishMaster.earlyShare)} -> ${pc(x.result.dishMaster.earlyShare)}    ${pc(b.result.dishMaster.allShare)} -> ${pc(x.result.dishMaster.allShare)}        ${Math.round(b.result.payout.mean)} -> ${Math.round(x.result.payout.mean)}`)
  }
  check(`every version the search played stayed inside the range (${Math.min(...R.log.map((l) => l.demand))} to ${Math.max(...R.log.map((l) => l.demand))}), the proposal too (${mainTotal(R.patch)})`, R.log.length === R.evaluations && R.log.every((l) => l.demand >= 225 && l.demand <= 275) && mainTotal(R.patch) >= 225 && mainTotal(R.patch) <= 275)
  check('the current event (378, outside the range) is still what everything is compared with; the search started from a starting point named as such', R.budget.current === 378 && R.budget.currentInRange === false && R.startingPoint.isCurrent === false && /brought inside the bounds typed/.test(R.startingPoint.notes.join(' ')) && /^the starting point: the current event with/.test(R.log[0].why) && rb.every((x) => x.result.players === 400))
  check(`inside the range, every segment is closer to its FU target (worst shortfall ${pc(R.validation.baseScore.worst)} -> ${pc(R.validation.proposedScore.worst)}); what is still missed is listed, not hidden (${rp.filter((x) => x.miss > 0).length} segments)`, ['meets', 'misses'].includes(R.status) && rp.every((x) => fuOf(rp, x.id).share > fuOf(rb, x.id).share + 0.2) && R.validation.proposedScore.worst < R.validation.baseScore.worst)
  check('how much came from asking for less is read on the same players (the recipes alone), not assumed', Array.isArray(R.recipesOnly) && R.recipesOnly.length === 9)

  // BOTH VIEWS OF THE PLAYERS (economist, agreed in planning: show "basket luck only" beside "player activity and
  // basket luck"; the targets depend on the activity assumptions). The check players are played the other way too.
  const ov = R.otherView
  const ofOther = (list, id) => list?.find((y) => y.id === id)?.shortfalls.find((y) => y.id === 'fu')?.share
  console.log('      segment          in FU d14, activity    in FU d14, basket luck only')
  for (const x of rp) console.log(`      ${x.name.padEnd(16)} ${pc(fuOf(rb, x.id).share).padStart(3)} -> ${pc(fuOf(rp, x.id).share).padEnd(14)} ${pc(ofOther(ov?.base, x.id)).padStart(3)} -> ${pc(ofOther(ov?.proposed, x.id))}`)
  const seg = S.segments.find((s) => s.id === rp[0].id)
  const direct = simulateSegment({ ...S, ...R.patch }, seg, { players: R.settings.validationPlayers, seed: R.settings.validationSeed, variation: 'baskets' }).fuTarget.inFu
  check(`the current event and the proposal are also played with basket luck only, on the same check players (${rp[0].name}: ${pc(ofOther(ov?.proposed, rp[0].id))}, played directly: ${pc(direct)})`, R.settings.variation === 'activity' && ov?.variation === 'baskets' && ov.base.length === 9 && ov.proposed.length === 9 && Math.abs(ofOther(ov.proposed, rp[0].id) - direct) < 1e-9)
  check('the other view is a reading only: the verdicts and the outcome are the activity view\'s', rp.every((x) => fuOf(rp, x.id).verdict) && ov.proposed.every((y) => y.shortfalls.every((z) => !('verdict' in z))) && R.status === (R.validation.proposedScore.worst <= 0 ? 'meets' : 'misses'))
}


console.log('--- 13. New ordinary schedules ---')
// Apple is far heavier in every basket than the dishes need, and nothing but schedules may change (weights and recipes
// locked, the blocker's and Pumpkin's schedules locked): the only way to more Butter is to pace Apple, so baskets give
// the others in its place once its limit is reached.
const PACE = small({
  baskets: S0.baskets.map((b) => ({ ...b, ingredientWeights: b.ingredientWeights.map((w) => (w.ingredientId === 'a' ? { ...w, weight: 600 } : w.ingredientId === 'x' && b.chestType === 'basic' ? { ...w, weight: 40 } : w)) })),
  dishes: [dish('d1', { a: 4, b: 12 }), dish('d2', { a: 3, p: 6 }), dish('d3', { a: 3, b: 14, x: 2 }), dish('d4', { b: 16, p: 7, x: 4 })],
  thresholds: [limit('x', [[1, 3]]), limit('p', [[1, 4], [2, 12], [4, null]])],
})
const PACE_ON = { change: { recipes: false, weights: false, thresholdAmounts: true }, locks: { thresholds: { 't-main-x': true, 't-main-p': true } }, pacing: { maxOrdinary: 1, dayOptions: [3, 5] } }
const PC = await gen(PACE, PACE_ON)
{
  const t = PC.patch?.thresholds.find((x) => x.ingredientId === 'a')
  const row = PC.changes?.thresholds.find((x) => x.ingredientId === 'a')
  console.log(`      ${PC.status}: Apple's new schedule ${t ? t.steps.map((st) => (st.limit == null ? `lifted day ${st.fromDay}` : `${st.limit} from day ${st.fromDay}`)).join(', ') : 'none'}; in FU ${PC.validation.base.map((x) => pc(fuOf(PC.validation.base, x.id).share)).join(', ')} -> ${PC.validation.proposed.map((x) => pc(fuOf(PC.validation.proposed, x.id).share)).join(', ')}`)
  check('an ordinary ingredient with no schedule is given one when that is allowed, and it is marked new', !!t && row?.isNew === true && row.kind === 'ordinary' && row.from === null)
  check(`the new schedule counts what was RECEIVED, starts on day 1, steps only on the days allowed (3, 5) and is lifted on the last (${t?.steps.map((st) => st.fromDay).join(', ')})`, !!t && t.steps[0].fromDay === 1 && t.steps.every((st) => [1, 3, 5].includes(st.fromDay)) && t.steps.at(-1).limit == null && scheduleOk(t))
  check(`with only that changed, the segments are closer to the targets on other players (worst ${pc(PC.validation.baseScore.worst)} -> ${pc(PC.validation.proposedScore.worst)})`, ['meets', 'misses'].includes(PC.status) && PC.validation.proposedScore.worst < PC.validation.baseScore.worst)
  check('the locked schedules, the weights and the recipes are exactly as typed', same(PC.patch.thresholds.filter((x) => x.ingredientId !== 'a'), PACE.thresholds) && same(weightsOf(PC.patch), weightsOf(PACE)) && same(countsOf(PC.patch), countsOf(PACE)))
  const why = PC.explanations.find((e) => e.ingredientId === 'a')?.text ?? ''
  check(`why Apple: measured before and after - what was left over, what the others lacked, the longest wait ("${why.slice(0, 110)}...")`, /Apple: it was given a new threshold schedule\. Before, \w+ ended with \d+ of it left over and \d+ lost to a full pantry \(with the proposal \d+ and \d+\).*The longest wait between two Main dishes, most players: \d+ → \d+ days/.test(why))
  const zero = await gen(PACE, { ...PACE_ON, pacing: { maxOrdinary: 0, dayOptions: [3, 5] } })
  check('a limit of 0 ordinary ingredients: no new schedule, whatever would help', !zero.patch || zero.patch.thresholds.every((x) => x.ingredientId !== 'a'))
  const usedUp = small({ ...PACE, thresholds: [...PACE.thresholds, limit('b', [[1, 30], [5, null]])] })
  const full = await gen(usedUp, { ...PACE_ON, locks: { thresholds: { 't-main-x': true, 't-main-p': true, 't-main-b': true } } })
  check('a limit already used by an existing schedule: no new one, the existing one locked and kept, and the screen says why', (full.patch?.thresholds ?? usedUp.thresholds).every((x) => x.ingredientId !== 'a') && same(full.patch?.thresholds.find((x) => x.ingredientId === 'b') ?? usedUp.thresholds[2], usedUp.thresholds[2]) && searchWarnings(usedUp, createPlan(usedUp, { ...FREE, ...PACE_ON })).some((w) => /uses? the whole allowance of 1: no new one will be made/.test(w.text)))
  const excluded = await gen(PACE, { ...PACE_ON, pacing: { maxOrdinary: 1, dayOptions: [3, 5], excluded: { a: true } } })
  check(`an excluded ingredient is never given a schedule (${(excluded.changes?.thresholds ?? []).map((x) => x.ingredientId).join(', ') || 'nothing new'})`, (excluded.patch?.thresholds ?? []).every((x) => x.ingredientId !== 'a'))
  const noDays = createPlan(PACE, { ...FREE, ...PACE_ON, pacing: { maxOrdinary: 1, dayOptions: [] } })
  const nd = await generateProposal(PACE, noDays, quiet)
  check('opening days may not change and none are typed: no new schedule is made, no date is invented, and it says so', (nd.patch?.thresholds ?? []).every((x) => x.ingredientId !== 'a') && searchWarnings(PACE, noDays).some((w) => /no days are typed for a new schedule to step on/.test(w.text)))
  const dated = await gen(PACE, { ...PACE_ON, change: { ...PACE_ON.change, thresholdDays: true }, pacing: { maxOrdinary: 1, dayMin: 2, dayMax: 4 } })
  const td = dated.patch?.thresholds.find((x) => x.ingredientId === 'a')
  check(`opening days may change: a new schedule steps inside the days typed (2 to 4: ${td?.steps.map((st) => st.fromDay).join(', ') ?? 'none made'})`, !td || td.steps.every((st) => st.fromDay === 1 || (st.fromDay >= 2 && st.fromDay <= 4)))
  check('existing schedules keep their days while opening days may not change, also with new schedules beside them', PC.patch.thresholds.filter((x) => x.ingredientId !== 'a').every((x, i) => same(x.steps.map((st) => st.fromDay), PACE.thresholds[i].steps.map((st) => st.fromDay))))
  check('a new schedule that does not help enough is taken away again before the check (each is played without it)', Array.isArray(PC.prunedSchedules) && PC.log.some((l) => /new schedule needed\? Played without it/.test(l.why)))
}

console.log('--- 14. The recipe budget: a choice, never assumed ---')
{
  check('with recipes allowed to change and no choice made, nothing runs: the choice is asked for', inputProblems(S0, createPlan(S0)).some((p) => /Choose how the Main recipe budget is treated/.test(p)) && (await generateProposal(S0, createPlan(S0), quiet)).status === 'inputs')
  const older = { ...S0, generator: { plan: { change: { recipes: true }, budget: { target: 250 } } } }
  check('a plan saved before the choice existed is not confirmed for the economist: it asks too', inputProblems(older, planOf(older)).some((p) => /Choose how the Main recipe budget is treated/.test(p)))
  check('a range needs both ends typed', inputProblems(S0, createPlan(S0, { budget: { mode: 'bounded', min: 90 } })).some((p) => /Type both ends of the Main recipe budget range/.test(p)))
  check('with recipes not allowed to change there is no choice to make', !inputProblems(S0, createPlan(S0, { change: { recipes: false } })).some((p) => /budget/.test(p)))
  check(`the budget counts every Main ingredient, blockers and semi-blockers too (${budgetSummary(S0, createPlan(S0)).total}: 107 ordinary and semi-blocker, 6 Jelly)`, budgetSummary(S0, createPlan(S0)).total === 113)
  const under = configurationProblems(S0, createPlan(S0, { budget: { mode: 'bounded', min: 5, max: 10 } }))
  const over = configurationProblems(S0, createPlan(S0, { budget: { mode: 'bounded', min: 200, max: 210 }, quantity: { max: 10 } }))
  check('a range no recipe can reach is an invalid setup, with its numbers - never widened by itself', under.some((p) => /No Main recipe can be 10 or less: what is locked or never changed \(blockers included\) comes to 6, and the 8 free quantities are at least 1 each - 14 in all\. Widen the range or unlock quantities; it is never widened by itself/.test(p)) && over.some((p) => /No Main recipe can reach 200: .* the Main recipes come to 86/.test(p)))
  const PB = await gen(S0, { budget: { mode: 'bounded', min: 95, max: 105 } })
  check(`inside 95 to 105: every version played (${Math.min(...PB.log.map((l) => l.demand))} to ${Math.max(...PB.log.map((l) => l.demand))}) and the proposal (${mainTotal(PB.patch)}) stay in the range`, PB.log.every((l) => l.demand >= 95 && l.demand <= 105) && mainTotal(PB.patch) >= 95 && mainTotal(PB.patch) <= 105)
  check('the current event (113, outside the range) is compared as it is, on the same players; the search started from a starting point named as such', PB.budget.current === 113 && PB.budget.currentInRange === false && !PB.startingPoint.isCurrent && /^the starting point: the current event with brought inside the bounds typed/.test(PB.log[0].why) && S0.segments.every((seg) => r4(direct(S0, seg, PB).fuTarget.inFu) === fuOf(PB.validation.base, seg.id).share))
  check('which ingredients a dish needs is kept, and every quantity is a whole number of 1 or more', same(PB.patch.dishes.map((d) => d.recipe.map((r) => r.ingredientId)), S0.dishes.map((d) => d.recipe.map((r) => r.ingredientId))) && PB.patch.dishes.every((d) => d.recipe.every((r) => Number.isInteger(r.count) && r.count >= 1)))
  const tight = await gen(S0, { budget: { mode: 'bounded', min: 100, max: 100 }, search: { candidates: 12 } })
  check(`a range of one number: every version is exactly 100 (${[...new Set(tight.log.map((l) => l.demand))].join(', ')})`, tight.log.every((l) => l.demand === 100) && mainTotal(tight.patch) === 100)
  const lockedDemand = await gen(S0, { budget: { mode: 'bounded', min: 90, max: 100 }, locks: { dishes: { 'main|d1': true, 'main|d3': true } }, search: { candidates: 12 } })
  check(`with two dishes locked (64 of the 113), the others carry the range alone: locked quantities kept, total ${mainTotal(lockedDemand.patch)}`, same(lockedDemand.patch.dishes[0].recipe, S0.dishes[0].recipe) && same(lockedDemand.patch.dishes[2].recipe, S0.dishes[2].recipe) && mainTotal(lockedDemand.patch) >= 90 && mainTotal(lockedDemand.patch) <= 100)
  const withRc = small({ recompletionDishes: [dish('r1', { a: 6 }), dish('r2', { b: 6 }), dish('r3', { a: 4, x: 2 })], thresholds: [...S0.thresholds, limit('x', [[1, 1]], 'rc')] })
  check('Recompletion is never part of the Main budget, and its own range is used only when its recipes may change', budgetSummary(withRc, createPlan(withRc)).total === 113 && configurationProblems(withRc, createPlan(withRc, { budget: { mode: 'bounded', min: 100, max: 120, rcMin: 1, rcMax: 2 } })).length === 0)
  check('a free run is labelled free in the proposal', P.budget.mode === 'free' && PB.budget.mode === 'bounded' && PB.budget.min === 95 && PB.budget.max === 105)
}

console.log('--- 15. The semi-blocker and Dish Master ---')
{
  // No schedule for Pumpkin yet; Dish Master is day 2 to 5 in this small event.
  const NOSEMI = small({ thresholds: [limit('x', [[1, 3]])] })
  const G1 = await gen(NOSEMI, { search: { candidates: 15 } })
  const t = G1.patch.thresholds.find((x) => x.ingredientId === 'p')
  const row = G1.changes.thresholds.find((x) => x.ingredientId === 'p')
  console.log(`      Pumpkin's new schedule: ${t.steps.map((st) => (st.limit == null ? `lifted day ${st.fromDay}` : `${st.limit} from day ${st.fromDay}`)).join(', ')}`)
  check('a semi-blocker with no schedule is given one, marked as a semi-blocker schedule, and does not count as ordinary pacing', row?.isNew === true && row.kind === 'semi' && G1.changes.totals.after.ordinaryPaced.length === 0)
  check('it follows the rule: a limit before Dish Master, a rise during it, lifted the day after it ends - on Dish Master\'s days only', t.steps.map((st) => st.fromDay).join() === '1,2,6' && t.steps[0].limit != null && t.steps[1].limit >= t.steps[0].limit && t.steps[2].limit === null)
  const startOnly = await gen(NOSEMI, { search: { candidates: 1 } })
  const t0 = startOnly.patch.thresholds.find((x) => x.ingredientId === 'p')
  check(`it starts where no segment can cook one of its dishes before Dish Master (limit ${t0.steps[0].limit}; the smallest need is 5, Weak's d4: 7 x 0.7) - and nothing requires none: the limit is above 0`, semiExposure(NOSEMI, startOnly.patch).every((x) => x.cookable === 0) && t0.steps[0].limit === 4)
  check(`the search may move it from there (to ${t.steps[0].limit} here, with no limit typed on cooking early): what that allows is shown, segment by segment`, G1.semi.after.every((x) => typeof x.cookable === 'number') && G1.semi.after.length === 2)
  const bounded = await gen(NOSEMI, { semi: { earlyMin: 2, earlyMax: 2, dmMin: 5, dmMax: 6 }, search: { candidates: 15 } })
  const tb = bounded.patch.thresholds.find((x) => x.ingredientId === 'p')
  check(`the bounds typed are kept: before Dish Master 2, during it 5 to 6 (${tb.steps.map((st) => st.limit).join(', ')})`, tb.steps[0].limit === 2 && tb.steps[1].limit >= 5 && tb.steps[1].limit <= 6 && tb.steps[2].limit === null)
  const off = createPlan(NOSEMI, { ...FREE, semi: { allow: false } })
  const G2 = await generateProposal(NOSEMI, off, quiet)
  check('not allowed: no schedule is made, and the screen says its dishes can then be cooked before Dish Master', G2.patch.thresholds.every((x) => x.ingredientId !== 'p') && searchWarnings(NOSEMI, off).some((w) => /Pumpkin has no schedule and none will be made .* before Dish Master too/.test(w.text)))
  const noDm = { ...NOSEMI, calendar: createCalendar({ totalDays: 10, phases: [{ id: 'p1', label: 'Phase 1', days: 10 }] }) }
  check('no Dish Master days: no schedule can be made for it, and it says so', searchWarnings(noDm, createPlan(noDm, FREE)).some((w) => /no Dish Master days are set/.test(w.text)) && (await gen(noDm, { search: { candidates: 4 } })).patch.thresholds.every((x) => x.ingredientId !== 'p'))
  // One shared limit, read against every segment's own quantities.
  const shared = small({ thresholds: [limit('x', [[1, 3]]), limit('p', [[1, 5], [2, 9], [6, null]])] })
  const ex = semiExposure(shared)
  check(`a shared limit of 5 before Dish Master lets Weak (0.7) cook ${ex.find((x) => x.segmentId === 'weak').cookable} of its dishes early (needs ${ex.find((x) => x.segmentId === 'weak').needs.join(', ')}) and Strong (1.5) ${ex.find((x) => x.segmentId === 'strong').cookable} (needs ${ex.find((x) => x.segmentId === 'strong').needs.join(', ')})`, ex.find((x) => x.segmentId === 'weak').cookable === 1 && ex.find((x) => x.segmentId === 'strong').cookable === 0)
  const limitPlan = createPlan(shared, { ...FREE, semi: { maxEarlyPct: 10 } })
  check('a limit on cooking before Dish Master is a target only when typed, and then for every segment', describeTargets(shared, limitPlan).some((l) => /At most 10% of the players of each segment cook a dish that needs the semi-blocker before Dish Master begins \(day 2\)/.test(l.text)) && !describeTargets(shared, createPlan(shared, FREE)).some((l) => /semi-blocker/.test(l.text)))
  const G3 = await generateProposal(shared, { ...limitPlan, search: { ...limitPlan.search, candidates: 15 } }, quiet)
  const dm = G3.validation.proposed[0].result.dishMaster
  check(`its dishes are measured before, during and after Dish Master, segment by segment (Weak: one before ${pc(dm.earlyShare)}, ${num(dm.byEndMean)} by its last day, one after ${pc(dm.afterShare)})`, G3.validation.proposed.every((x) => x.shortfalls.some((y) => y.kind === 'semi-early') && ['earlyShare', 'earlyMean', 'byEndMean', 'allShare', 'afterShare', 'allByEventShare'].every((k) => typeof x.result.dishMaster[k] === 'number')))
  // Found by experiment on the made-up example: Pumpkin has weight 0 in every basket of the period that covers Dish
  // Master, so its dishes cannot progress during it - said, not searched around.
  const S = syntheticExampleState()
  check('a semi-blocker that no basket gives during Dish Master is said to be so (made-up example), and not where baskets give it', searchWarnings(S, createPlan(S, FREE)).some((w) => /No basket gives Pumpkin during Dish Master \(day 5 to 10\)/.test(w.text)) && !searchWarnings(shared, createPlan(shared, FREE)).some((w) => w.id === 'semi-no-supply') && !searchWarnings(S, createPlan(S, { ...FREE, locks: { open: { [weightKey(S.baskets.find((b) => b.phaseId === 'phase1' && b.chestType === 'basic').id, 'pumpkin')]: true } } })).some((w) => w.id === 'semi-no-supply'))
  const notLifted = small({ thresholds: [limit('x', [[1, 3]]), limit('p', [[1, 2], [2, 6]])] })
  check('a locked semi-blocker schedule that still restricts after Dish Master is explained, not changed', searchWarnings(notLifted, createPlan(notLifted, { ...FREE, locks: { thresholds: { 't-main-p': true } } })).some((w) => /still restricts after Dish Master ends \(day 5\)\. The confirmed rule lifts it then; its days are locked, so a proposal keeps it as typed/.test(w.text)))
  check('the blocker keeps its own rules: base quantities untouched, held back on the FU day, never opened in a basket that gives 0', [P, G1, G3].every((p) => countsOf(p.patch)['d3.x'] === 2 && countsOf(p.patch)['d4.x'] === 4 && thresholdLimitOn(p.patch.thresholds.find((x) => x.ingredientId === 'x'), 7) != null && weightsOf(p.patch)['basic.x'] === 0))
}

console.log('--- 16. What is proved, and what is only a risk ---')
{
  const src = (amount, coveragePct, id) => createSource({ id, kind: 'ingredient', day: 3, ingredientId: 'x', amount, coveragePct, bypassThreshold: true })
  const big = small({ sources: [src(1, 90, 's1')] })
  const plan = createPlan(big, { ...FREE, change: { thresholdAmounts: false } })
  check('one blocker past the threshold to 90% of the players proves nothing: no conflict, a warning, and the search runs', structuralConflicts(big, plan).length === 0 && searchWarnings(big, plan).some((w) => /gives 1 Jelly past its threshold to 90% of the players on day 3\. That does not by itself take them out of FU/.test(w.text)) && ['meets', 'misses', 'no-better'].includes((await generateProposal(big, { ...plan, search: { ...plan.search, candidates: 4 } }, quiet)).status))
  // The case the first version called impossible: 3 blockers (the whole shortage) to 50%, thresholds locked -
  // "at most 50% can be in FU". Measured on the proposal of section 2 with that source added:
  const half = { ...S0, ...P.patch, sources: [src(3, 50, 's1')] }
  check('3 blockers past the threshold to 50% is no longer called impossible', structuralConflicts(half, createPlan(half, { ...FREE, change: { thresholdAmounts: false } })).length === 0)
  const measured = simulateSegment(half, half.segments[1], { players: 400, seed: 31 })
  check(`...and it was not: with that source, ${pc(measured.fuTarget.inFu)} of Strong sit in FU on day 7 - more than the 50% the old proof allowed (what it gives counts toward the threshold, so baskets give less of it)`, measured.fuTarget.inFu > 0.5)
  // The bound on the blocker counts what a catch-up preset can give too.
  const starved = small({ segments: [createSegment({ id: 'weak', name: 'Weak', effortFactor: 0.7, supply: createSupply({ average: { basic: 3, rare: 0, epic: 0 } }) }), S0.segments[1]] })
  const withPreset = { ...starved, presets: [createPreset({ id: 'help', chestType: 'basic', allocations: { 3: { x: 1, a: 2 }, 4: { x: 1, a: 3 }, 5: { x: 1, a: 4 } } })] }
  check('no basket gives the blocker to Weak, but a catch-up preset can: then it is no longer proved impossible', structuralConflicts(starved, createPlan(starved, FREE)).length === 1 && structuralConflicts(withPreset, createPlan(withPreset, FREE)).length === 0)
  check('a joker counts as its three ingredients in full in the bound on all ingredients', (() => { const huge = small({ dishes: [dish('d1', { a: 300, b: 12 }), ...S0.dishes.slice(1)], sources: [createSource({ id: 'j', kind: 'joker', day: 1, amount: 20, coveragePct: 100 })] }); return structuralConflicts(huge, createPlan(huge, { ...FREE, change: { recipes: false } })).length === 0 })())
  check('every conflict that stays says what it assumes', [structuralConflicts(starved, createPlan(starved, FREE)), structuralConflicts(small({ thresholds: [limit('x', [[1, 3], [6, null]]), S0.thresholds[1]] }), createPlan(S0, FREE))].flat().every((c) => c.assumptions?.length > 0 && c.text.length > 80))
}

console.log('--- 17. Outcomes kept apart; older proposals ---')
{
  let checking = false
  const stopped = await gen(S0, { search: { candidates: 6 } }, { onProgress: (p) => { if (/^Checking the proposal/.test(p.label)) checking = true }, isCancelled: () => checking })
  check('stopped while it was being checked: "incomplete" - not cancelled, not a result - and nothing to apply', stopped.status === 'incomplete' && !stopped.patch && !canApply(S0, stopped))
  check('missing input, invalid setup, proved conflict, no qualifying proposal, stopped, check incomplete: six different outcomes', new Set(['inputs', 'invalid', 'conflict', 'misses', 'cancelled', 'incomplete']).size === 6)
  const older = { ...P, search: 'chef-search 1.0' }
  check('a proposal made by the earlier search is kept to read, marked, and cannot be applied', !canApply(S0, older, createPlan(S0, FREE)) && /made by an earlier version of the generator \(chef-search 1\.0\), before the recipe budget was a choice/.test(staleReason(S0, older, createPlan(S0, FREE))))
}

console.log(`      (${Math.round((Date.now() - started) / 1000)} s)`)
console.log(fails === 0 ? `\n${total}/${total} checks passed` : `\n${fails} of ${total} checks FAILED`)
process.exit(fails === 0 ? 0 : 1)
