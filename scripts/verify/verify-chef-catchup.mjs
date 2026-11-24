// CHEF BUILD 03 - CATCH-UP SUGGESTIONS. What a suggestion may and may not do,
// how it is judged (build 02's targets and order, then the fewest players
// touched), and what applying one does - on small events.
//
//   npx vite-node scripts/verify/verify-chef-catchup.mjs
//
// 1 what stops a suggestion                 5 the same result again
// 2 a poor event: the targets lifted        6 apply, undo, out of date
// 3 what a suggested preset may hold        7 nothing needed; stopping
// 4 the economist's presets untouched       8 the order of "better"
import { RARITY, blankChefState, createBasket, createCalendar, createCheckpoint, createDish, createIngredient, createPreset, createRewards, createSegment, createSettings, createSupply, createTargets, createThreshold } from '../../src/features/chef/lib/chefModel.js'
import { fingerprint, simulateSegment } from '../../src/features/chef/lib/chefEngine.js'
import { CATCHUP_ORIGIN, CATCHUP_VERSION, applyCatchup, canApplyCatchup, catchupIsBetter, catchupIsInUse, catchupIsStale, catchupProblems, contentsFor, createCatchupPlan, generateCatchup, undoCatchup } from '../../src/features/chef/lib/chefCatchup.js'

let fails = 0
let total = 0
function check(name, cond) {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}`)
}
const pc = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`)
const r4 = (v) => Math.round(v * 10000) / 10000
const dish = (id, recipe) => createDish({ id, name: id, recipe: Object.entries(recipe).map(([ingredientId, count]) => ({ ingredientId, count })) })
const limit = (ingredientId, steps) => createThreshold({ id: `t-${ingredientId}`, ingredientId, round: 'main', steps: steps.map(([fromDay, value]) => ({ fromDay, limit: value })) })
const rows = (m = 3) => [{ ingredientId: 'a', min: 0, max: m, weight: 100 }, { ingredientId: 'b', min: 0, max: m, weight: 60 }, { ingredientId: 'c', min: 0, max: m, weight: 20 }, { ingredientId: 'p', min: 0, max: 2, weight: 30 }, { ingredientId: 'x', min: 0, max: 1, weight: 20 }]
// A small event: Apple, Butter (common) and Cherry (rare, given rarely), Pumpkin (semi-blocker), Jelly (the blocker,
// in the last two dishes), ten days, two segments. Cherry is what holds most players back.
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
const gen = (state, overrides = {}, hooks = {}) => generateCatchup(state, createCatchupPlan(state, overrides), { ...quiet, ...hooks })
const fuOf = (list, id) => list.find((s) => s.id === id).shortfalls.find((x) => x.id === 'fu')
const started = Date.now()

console.log('--- 1. What stops a suggestion ---')
const S0 = small()
{
  check('a complete event with an FU day and a checkpoint has nothing to stop it', catchupProblems(S0, createCatchupPlan(S0)).length === 0)
  const noTarget = await gen(small({ targets: createTargets({}) }))
  check('with no FU day and no checkpoint there is no pace to bring players back to', noTarget.status === 'inputs' && noTarget.problems.some((p) => /no pace to bring players back to/.test(p)) && !noTarget.patch && noTarget.evaluations === 0)
  const noKind = await gen(S0, { kinds: { pace: false, stuck: false } })
  check('with neither kind of player allowed, it says so', noKind.status === 'inputs' && noKind.problems.some((p) => /Neither kind of player/.test(p)))
  const noType = await gen(S0, { chestTypes: { basic: false, rare: false, epic: false } })
  check('with no basket allowed to be replaced, it says so', noType.status === 'inputs' && noType.problems.some((p) => /No basket type may be replaced/.test(p)))
  const epicOnly = small({ segments: [createSegment({ id: 'weak', name: 'Weak', supply: createSupply({ average: { basic: 2, rare: 0, epic: 0 } }) })] })
  check('a segment that never opens the basket allowed would never be given one: said', catchupProblems(epicOnly, createCatchupPlan(epicOnly, { chestTypes: { basic: false, rare: true } })).some((p) => /opens a Rare basket/.test(p)))
  const allSpecial = small({ ingredients: S0.ingredients.map((i) => (i.rarity === RARITY.COMMON || i.rarity === RARITY.RARE ? { ...i, rarity: RARITY.SEMI_BLOCKER } : i)) })
  check('with no common or rare ingredient in the recipes there is nothing a suggestion may hold', catchupProblems(allSpecial, createCatchupPlan(allSpecial)).some((p) => /No common or rare ingredient/.test(p)))
  check('the defaults are this tool\'s own: 3 presets, twice a player, Basic and Rare baskets, both kinds of player', (() => { const p = createCatchupPlan(S0); return p.maxPresets === 3 && p.maxUses === 2 && p.chestTypes.basic && p.chestTypes.rare && !p.chestTypes.epic && p.kinds.pace && p.kinds.stuck })())
}

console.log('--- 2. A poor event: the targets lifted ---')
const mine = createPreset({ id: 'mine', name: 'My catch-up', chestType: 'rare', startDay: 9, endDay: 10, priority: 1, eligibility: { dishesMax: 1 }, sizeMode: 'fixed', fixedTotal: 6, fixedContents: { a: 3, b: 3 } })
const S1 = small({ presets: [mine] })
const before = JSON.stringify(S1)
const C = await gen(S1)
{
  const base = C.validation.base
  const prop = C.validation.proposed
  console.log(`      ${C.evaluations} sets played in ${C.runtimeMs} ms, stopped: ${C.stopReason}; ${C.specs?.length ?? 0} presets suggested`)
  for (const s of prop ?? []) console.log(`      ${s.name}: in FU on day 8 ${pc(fuOf(base, s.id).share)} -> ${pc(fuOf(prop, s.id).share)} (${fuOf(prop, s.id).verdict}); touched ${pc(s.catchup.playersShare)}`)
  for (const d of C.described ?? []) console.log(`      ${d.text}`)
  check(`the event as it is misses its FU target (${base.map((s) => pc(fuOf(base, s.id).share)).join(', ')} against 80%)`, base.some((s) => fuOf(base, s.id).share < 0.7))
  check(`a suggestion is made and lifts the worst segment (${C.status}; worst shortfall ${pc(C.validation.baseScore.worst)} -> ${pc(C.validation.proposedScore.worst)})`, ['meets', 'misses'].includes(C.status) && C.validation.proposedScore.worst < C.validation.baseScore.worst - 0.02)
  check('it was found on 100 search players and checked on 400 others, the same for the event and the suggestion', C.settings.searchPlayers === 100 && prop.every((s) => s.result.players === 400) && base.every((s) => s.result.players === 400) && C.settings.validationSeed !== C.settings.searchSeed)
  check('the check figures are the engine\'s own on the applied event', (() => { const applied = applyCatchup(S1, C); return S1.segments.every((seg) => r4(simulateSegment(applied, seg, { players: 400, seed: C.settings.validationSeed, variation: C.settings.variation }).fuTarget.inFu) === fuOf(prop, seg.id).share) })())
  check(`the share of players who ever get a suggested basket is reported per segment (${prop.map((s) => pc(s.catchup.playersShare)).join(', ')}), not counting the economist's preset`, prop.every((s) => s.catchup.playersShare > 0 && s.catchup.playersShare <= 1) && prop.every((s) => s.catchup.byPreset.every((p) => p.id !== 'mine')))
  check('every share comes with a verdict: met, missed, or too close to call', prop.every((s) => s.shortfalls.every((x) => ['met', 'met-unsure', 'missed', 'missed-unsure'].includes(x.verdict))))
  check('the other view of the players is played too, on the same players (a reading)', C.otherView && C.otherView.variation !== C.settings.variation && C.otherView.base.length === 2 && C.otherView.proposed.length === 2)
  check(`what was run is written down: version, seeds, why it stopped (${C.stopReason})`, C.search === CATCHUP_VERSION && /chef-engine/.test(C.engine) && C.log[0].why.startsWith('the event as it is') && C.log.length === C.evaluations)
  check('each preset is said in words: who, which segments, which days, how often, what a basket holds', C.described.length === C.specs.length && C.described.every((d) => /^In .+ on days \d+ to \d+: .+ basket.* hold.*\(a basket of \d+: /.test(d.text)))
  check('suggesting changes nothing in the event', JSON.stringify(S1) === before && C.baseFingerprint === fingerprint(S1))
}

console.log('--- 3. What a suggested preset may hold ---')
{
  const presets = C.patch.presets
  const ordinary = new Set(['a', 'b', 'c'])
  check(`at most 3 presets, each marked as suggested (${presets.length})`, presets.length >= 1 && presets.length <= 3 && presets.every((p) => p.origin === CATCHUP_ORIGIN))
  check('only common and rare ingredients, never Pumpkin (semi-blocker) or Jelly (blocker), in every basket size', presets.every((p) => Object.values(p.allocations).every((c) => Object.keys(c).every((id) => ordinary.has(id)))))
  check('a basket of every size of its type holds exactly that many', presets.every((p) => { const b = S1.baskets.find((x) => x.chestType === p.chestType); const sizes = Object.keys(p.allocations).map(Number); return sizes.length === b.totalMax - b.totalMin + 1 && sizes.every((n) => Object.values(p.allocations[n]).reduce((s, v) => s + v, 0) === n) }))
  check('only the baskets allowed (Basic and Rare - not Epic), at most twice a player, in the Main round', presets.every((p) => ['basic', 'rare'].includes(p.chestType) && p.maxUses >= 1 && p.maxUses <= 2 && p.round === 'main'))
  check('who qualifies is one of the two kinds: at most N dishes, or still missing N of a common or rare ingredient', presets.every((p) => (p.eligibility.dishesMax != null && !p.eligibility.missingIngredientId) || (ordinary.has(p.eligibility.missingIngredientId) && p.eligibility.missingMin >= 1)))
  check('a window of days that ends on or before the last day', presets.every((p) => p.startDay >= 1 && p.endDay >= p.startDay && p.endDay <= 10))
  const capped = { c: { pantryCap: 3 }, a: {}, b: {} }
  check('what a basket holds never exceeds an ingredient\'s pantry', Object.values(contentsFor(10, { kind: 'stuck', ingredientId: 'c', focus: 1, mix: { a: 1, b: 1, c: 5 } }, capped)).reduce((s, v) => s + v, 0) === 10 && contentsFor(10, { kind: 'stuck', ingredientId: 'c', focus: 1, mix: { a: 1, b: 1, c: 5 } }, capped).c === 3)
  const plan2 = await gen(S1, { maxPresets: 1, maxUses: 1, chestTypes: { basic: true, rare: false }, kinds: { pace: true, stuck: false } })
  check(`the controls are kept: one preset, once a player, Basic only, behind pace only (${plan2.status})`, !plan2.patch || (plan2.patch.presets.length === 1 && plan2.patch.presets.every((p) => p.maxUses === 1 && p.chestType === 'basic' && p.eligibility.dishesMax != null)))
}

console.log('--- 4. The economist\'s presets are never touched ---')
{
  const applied = applyCatchup(S1, C)
  check('applying adds the suggestions after the economist\'s, which stays exactly as it was', JSON.stringify(applied.presets[0]) === JSON.stringify(mine) && applied.presets.length === 1 + C.patch.presets.length)
  check('the economist\'s preset keeps going first: every suggestion has a later priority', applied.presets.slice(1).every((p) => p.priority > mine.priority))
  check('the suggestions\' ids are their own', new Set(applied.presets.map((p) => p.id)).size === applied.presets.length)
}

console.log('--- 5. The same result again ---')
{
  const again = await gen(S1)
  check('the same event and controls give the same suggestion, preset for preset and figure for figure', JSON.stringify(again.patch) === JSON.stringify(C.patch) && JSON.stringify(again.validation) === JSON.stringify(C.validation) && again.evaluations === C.evaluations)
}

console.log('--- 6. Apply, undo, out of date ---')
{
  check('a fresh suggestion can be applied', canApplyCatchup(S1, C))
  const applied = applyCatchup(S1, C)
  check('applied: the event is the one that was checked, and says so', fingerprint(applied) === C.proposedFingerprint && catchupIsInUse(applied, applied.generator.catchup))
  check('it cannot be applied twice', !canApplyCatchup(applied, applied.generator.catchup) && applyCatchup(applied, applied.generator.catchup) === applied)
  const undone = undoCatchup(applied)
  check('one undo takes the suggestions out, and the economist\'s preset is as it was', JSON.stringify(undone.presets) === JSON.stringify(S1.presets) && fingerprint(undone) === fingerprint(S1) && !undone.generator.catchupApplied)
  const edited = { ...S1, segments: S1.segments.map((s, i) => (i === 0 ? { ...s, effortFactor: 1.2 } : s)) }
  check('after the event is changed the suggestion is out of date and cannot be applied', catchupIsStale(edited, C) && !canApplyCatchup(edited, C))
  const otherControls = { ...S1, generator: { catchupPlan: { maxPresets: 1 } } }
  check('after the controls are changed it is out of date too', catchupIsStale(otherControls, C))
  check('a later suggestion is made on the event with the earlier one in it, after it', (() => { const next = applyCatchup(S1, C); return next.presets.filter((p) => p.origin === CATCHUP_ORIGIN).length === C.patch.presets.length })())
}

console.log('--- 7. Nothing needed; stopping ---')
{
  const rich = small({ segments: [createSegment({ id: 'rich', name: 'Rich', supply: createSupply({ average: { basic: 12, rare: 4, epic: 1 } }) })], targets: createTargets({ mainFuDay: 9, mainFuSharePct: 50, checkpoints: [] }) })
  const R = await gen(rich)
  check(`targets already met: nothing is suggested, and it says so (${R.status})`, R.status === 'already' && !R.patch && R.validation.base.every((s) => s.shortfalls.every((x) => x.miss === 0)))
  const stopped = await gen(S1, {}, { isCancelled: () => true })
  check('stopped: nothing to apply, and it says so', stopped.status === 'cancelled' && !stopped.patch)
}

console.log('--- 8. The order of "better" ---')
{
  const a = { worst: 0.1, total: 0.2, touched: 0.5, count: 1, baskets: 1 }
  check('the worst segment first', catchupIsBetter({ ...a, worst: 0.05, touched: 0.9 }, a))
  check('then all segments', catchupIsBetter({ ...a, total: 0.1, touched: 0.9 }, a))
  check('then the fewest players touched (economist: "Fewest players touched")', catchupIsBetter({ ...a, touched: 0.3, count: 3 }, a) && !catchupIsBetter({ ...a, touched: 0.7 }, a))
  check('then the fewest presets, then the fewest baskets', catchupIsBetter({ ...a, count: 0 }, a) && catchupIsBetter({ ...a, baskets: 0.5 }, a))
}

console.log(`(${Math.round((Date.now() - started) / 1000)} s)`)
console.log(fails ? `${fails} of ${total} checks FAILED` : `${total}/${total} checks passed`)
process.exit(fails ? 1 : 0)
