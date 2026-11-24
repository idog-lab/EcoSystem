// CHEF - SPECIAL-EVENT SUGGESTIONS (chefEvents.js): what a suggested event may
// and may not be, how it is judged (build 02's targets and order, then the
// fewest ingredients given), and what applying one does - on small events.
//   npx vite-node scripts/verify/verify-chef-events.mjs
import { RARITY, blankChefState, createBasket, createCalendar, createCheckpoint, createDish, createIngredient, createRewards, createSegment, createSettings, createSource, createSupply, createTargets, createThreshold } from '../../src/features/chef/lib/chefModel.js'
import { fingerprint, simulateSegment } from '../../src/features/chef/lib/chefEngine.js'
import { EVENTS_ORIGIN, EVENTS_VERSION, applyEvents, canApplyEvents, createEventsPlan, eventsIsBetter, eventsIsInUse, eventsIsStale, eventsProblems, generateEvents, undoEvents } from '../../src/features/chef/lib/chefEvents.js'

let fails = 0
let total = 0
const check = (name, cond) => {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}`)
}
const pc = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`)
const r4 = (v) => Math.round(v * 10000) / 10000
const dish = (id, recipe) => createDish({ id, name: id, recipe: Object.entries(recipe).map(([ingredientId, count]) => ({ ingredientId, count })) })
const limit = (ingredientId, steps) => createThreshold({ id: `t-${ingredientId}`, ingredientId, round: 'main', steps: steps.map(([fromDay, value]) => ({ fromDay, limit: value })) })
const rows = (m = 3) => [{ ingredientId: 'a', min: 0, max: m, weight: 100 }, { ingredientId: 'b', min: 0, max: m, weight: 60 }, { ingredientId: 'c', min: 0, max: m, weight: 20 }, { ingredientId: 'p', min: 0, max: 2, weight: 30 }, { ingredientId: 'x', min: 0, max: 1, weight: 20 }]
function small(extra = {}) {
  return {
    ...blankChefState(),
    ingredients: [createIngredient({ id: 'a', name: 'Apple' }), createIngredient({ id: 'b', name: 'Butter' }), createIngredient({ id: 'c', name: 'Cherry', rarity: RARITY.RARE }), createIngredient({ id: 'p', name: 'Pumpkin', rarity: RARITY.SEMI_BLOCKER }), createIngredient({ id: 'x', name: 'Jelly', rarity: RARITY.BLOCKER })],
    dishes: [dish('d1', { a: 8, b: 6 }), dish('d2', { a: 6, c: 6, p: 3 }), dish('d3', { b: 6, c: 8, x: 1 }), dish('d4', { a: 6, c: 6, x: 3 })],
    recompletionDishes: [],
    baskets: [createBasket({ id: 'basic', chestType: 'basic', phaseId: 'p1', totalMin: 3, totalMax: 5, ingredientWeights: rows() }), createBasket({ id: 'rare', chestType: 'rare', phaseId: 'p1', totalMin: 6, totalMax: 10, ingredientWeights: rows(5) }), createBasket({ id: 'epic', chestType: 'epic', phaseId: 'p1', totalMin: 12, totalMax: 20, ingredientWeights: rows(9) })],
    calendar: createCalendar({ totalDays: 10, phases: [{ id: 'p1', label: 'Phase 1', days: 10 }] }),
    segments: [createSegment({ id: 'weak', name: 'Weak', supply: createSupply({ average: { basic: 2, rare: 0.4, epic: 0 } }) }), createSegment({ id: 'strong', name: 'Strong', supply: createSupply({ average: { basic: 4, rare: 1, epic: 0.2 } }) })],
    thresholds: [limit('x', [[1, 1]])],
    settings: createSettings({}),
    targets: createTargets({ mainFuDay: 8, mainFuSharePct: 80, checkpoints: [createCheckpoint({ id: 'c1', day: 5, dishes: 1, sharePct: 80 })] }),
    rewards: createRewards({}),
    ...extra,
  }
}
const quiet = { tick: () => Promise.resolve() }
const gen = (state, overrides = {}, hooks = {}) => generateEvents(state, createEventsPlan(state, overrides), { ...quiet, ...hooks })
const fuOf = (list, id) => list.find((s) => s.id === id).shortfalls.find((x) => x.id === 'fu')

console.log('--- 1. What stops a suggestion ---')
const S0 = small()
check('a complete event with targets has nothing to stop it', eventsProblems(S0, createEventsPlan(S0)).length === 0)
const noTarget = await gen(small({ targets: createTargets({}) }))
check('with no FU day and no checkpoint there is no day to bring the ingredients by', noTarget.status === 'inputs' && noTarget.problems.some((p) => /no day to bring/.test(p)))
const onlyBlocker = small({ ingredients: S0.ingredients.map((i) => (i.id === 'x' ? i : { ...i, rarity: RARITY.BLOCKER })) })
check('with only blockers in the recipes there is nothing an event may give', eventsProblems(onlyBlocker, createEventsPlan(onlyBlocker)).some((p) => /No common, rare or semi-blocker/.test(p)))
check('the defaults are this tool\'s own: 3 events, at most 30 an event, a share from 10%', (() => { const p = createEventsPlan(S0); return p.maxEvents === 3 && p.maxAmount === 30 && p.shareMinPct === 10 })())

console.log('--- 2. A poor event: the targets lifted ---')
const mine = createSource({ id: 'mine', label: 'My event', day: 9, ingredientId: 'a', amount: 4, coveragePct: 50 })
const S1 = small({ sources: [mine] })
const before = JSON.stringify(S1)
const E = await gen(S1)
const base = E.validation.base
const prop = E.validation.proposed
console.log(`      ${E.evaluations} sets played, stopped: ${E.stopReason}; ${E.specs?.length ?? 0} events`)
for (const s of prop ?? []) console.log(`      ${s.name}: in FU on day 8 ${pc(fuOf(base, s.id).share)} -> ${pc(fuOf(prop, s.id).share)} (${fuOf(prop, s.id).verdict}); ${s.events.given.toFixed(2)} ingredients a player`)
for (const d of E.described ?? []) console.log(`      ${d.text}`)
check(`a suggestion is made and lifts the worst segment (${E.status}; worst shortfall ${pc(E.validation.baseScore.worst)} -> ${pc(E.validation.proposedScore.worst)})`, ['meets', 'misses'].includes(E.status) && E.validation.proposedScore.worst < E.validation.baseScore.worst - 0.02)
check('checked on 400 other players, the same for the event and the suggestion', prop.every((s) => s.result.players === 400) && base.every((s) => s.result.players === 400) && E.settings.validationSeed !== E.settings.searchSeed)
check('the check figures are the engine\'s own on the applied event', (() => { const applied = applyEvents(S1, E); return S1.segments.every((seg) => r4(simulateSegment(applied, seg, { players: 400, seed: E.settings.validationSeed, variation: E.settings.variation }).fuTarget.inFu) === fuOf(prop, seg.id).share) })())
check(`what the events really gave a player is measured, the economist's own event not counted (${prop.map((s) => s.events.given.toFixed(2)).join(', ')})`, prop.every((s) => s.events.given > 0) && base.every((s) => s.events.given === 0))
check('every share comes with a verdict', prop.every((s) => s.shortfalls.every((x) => ['met', 'met-unsure', 'missed', 'missed-unsure'].includes(x.verdict))))
check('the other view of the players is played too (a reading)', E.otherView && E.otherView.variation !== E.settings.variation && E.otherView.proposed.length === 2)
check('each event is said in words: the day, the amount, the ingredient, the share of every segment', E.described.length === E.specs.length && E.described.every((d) => /^On day \d+.*, a special event gives \d+ \w+.* to \d+% of the players of every segment\.$/.test(d.text)))
check(`what was run is written down (${E.search})`, E.search === EVENTS_VERSION && E.log[0].why.startsWith('the event as it is'))
check('suggesting changes nothing in the event', JSON.stringify(S1) === before && E.baseFingerprint === fingerprint(S1))

console.log('--- 3. What a suggested event may be ---')
const sources = E.patch.sources
check(`at most 3 events, each marked as suggested (${sources.length})`, sources.length >= 1 && sources.length <= 3 && sources.every((s) => s.origin === EVENTS_ORIGIN))
check('common, rare or the semi-blocker - never the blocker', sources.every((s) => ['a', 'b', 'c', 'p'].includes(s.ingredientId)))
check('the same event for every segment (economist: "Same event for all")', sources.every((s) => s.segmentIds === null))
check('never past a threshold: no permission to pass it', sources.every((s) => s.bypassThreshold === false && s.kind === 'ingredient'))
check('an amount from 1 to 30, a share from 10% to 100% in steps of 5, a day of the event', sources.every((s) => s.amount >= 1 && s.amount <= 30 && s.coveragePct >= 10 && s.coveragePct <= 100 && s.coveragePct % 5 === 0 && s.day >= 1 && s.day <= 10))
const one = await gen(S1, { maxEvents: 1, maxAmount: 5 })
check(`the controls are kept: one event, at most 5 (${one.status})`, !one.patch || (one.patch.sources.length === 1 && one.patch.sources[0].amount <= 5))

console.log('--- 4. The economist\'s events are never touched ---')
{
  const applied = applyEvents(S1, E)
  check('applying adds the suggestions after the economist\'s, which stays exactly as it was', JSON.stringify(applied.sources[0]) === JSON.stringify(mine) && applied.sources.length === 1 + sources.length)
  check('the suggestions\' ids are their own', new Set(applied.sources.map((s) => s.id)).size === applied.sources.length)
}

console.log('--- 5. The same result again ---')
const again = await gen(S1)
check('the same event and controls give the same suggestion', JSON.stringify(again.patch) === JSON.stringify(E.patch) && JSON.stringify(again.validation) === JSON.stringify(E.validation))

console.log('--- 6. Apply, undo, out of date ---')
{
  check('a fresh suggestion can be applied', canApplyEvents(S1, E))
  const applied = applyEvents(S1, E)
  check('applied: the event is the one that was checked', fingerprint(applied) === E.proposedFingerprint && eventsIsInUse(applied, applied.generator.events))
  check('it cannot be applied twice', !canApplyEvents(applied, applied.generator.events))
  const undone = undoEvents(applied)
  check('one undo takes the suggestions out', JSON.stringify(undone.sources) === JSON.stringify(S1.sources) && fingerprint(undone) === fingerprint(S1))
  const edited = { ...S1, segments: S1.segments.map((s, i) => (i === 0 ? { ...s, effortFactor: 1.2 } : s)) }
  check('after the event is changed it is out of date and cannot be applied', eventsIsStale(edited, E) && !canApplyEvents(edited, E))
  check('after the controls are changed it is out of date too', eventsIsStale({ ...S1, generator: { eventsPlan: { maxEvents: 1 } } }, E))
}

console.log('--- 7. Nothing needed; stopping ---')
{
  const rich = small({ segments: [createSegment({ id: 'rich', name: 'Rich', supply: createSupply({ average: { basic: 12, rare: 4, epic: 1 } }) })], targets: createTargets({ mainFuDay: 9, mainFuSharePct: 50, checkpoints: [] }) })
  const R = await gen(rich)
  check(`targets already met: nothing is suggested, and it says so (${R.status})`, R.status === 'already' && !R.patch)
  const stopped = await gen(S1, {}, { isCancelled: () => true })
  check('stopped: nothing to apply', stopped.status === 'cancelled' && !stopped.patch)
}

console.log('--- 8. The order of "better" ---')
{
  const a = { worst: 0.1, total: 0.2, given: 5, count: 1 }
  check('the worst segment first, then all segments', eventsIsBetter({ ...a, worst: 0.05, given: 50 }, a) && eventsIsBetter({ ...a, total: 0.1, given: 50 }, a))
  check('then the fewest ingredients given (economist: "Fewest ingredients given"), then the fewest events', eventsIsBetter({ ...a, given: 3, count: 3 }, a) && !eventsIsBetter({ ...a, given: 7 }, a) && eventsIsBetter({ ...a, count: 0 }, a))
}

console.log(fails ? `${fails} of ${total} checks FAILED` : `${total}/${total} checks passed`)
process.exit(fails ? 1 : 0)
