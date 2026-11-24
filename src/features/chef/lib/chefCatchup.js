// CHEF BUILD 03 - CATCH-UP SUGGESTIONS.
//
// The tool suggests targeted catch-up presets that bring the segments closer to
// their targets, the way build 02 suggests recipes, weights and thresholds. The
// economist's rules for it (asked, 24 Nov 2026, each the recommended answer):
//   WHO       "Tool picks, both kinds": a suggested preset goes to players
//             behind pace (at most N Main dishes cooked, in a window of days
//             before a target day) or to players stuck on one ingredient (still
//             missing at least N of it for the dishes left) - the search tries
//             both and keeps what lifts the targets most.
//   CONTENTS  "Common and rare only": only ordinary ingredients the Main
//             recipes use - never the semi-blocker or the blocker, so their
//             pacing stays exactly as typed. (And as every preset: never past a
//             progression threshold, never over the pantry - the engine's rule.)
//   PREFER    "Fewest players touched": between two sets that meet the targets
//             equally well, the one fewer players ever get a suggested catch-up
//             basket from; then fewer presets; then fewer such baskets.
//   YOURS     "Never touch them": the economist's presets are played as they
//             are and keep going first; suggestions are added after them, with
//             their own mark (`origin: 'build-03'`), and one undo takes them out.
//
// The targets, a segment's shortfalls against them, the order of "better" and
// the verdicts are build 02's (chefGenerator.js), on the same players: a
// suggestion is judged exactly like a proposal. Every number of the controls
// is this tool's own default, and the screen says so. A suggestion is the best
// of a bounded search on simulated players - never "the best possible", and
// its presets are suggestions, not confirmed design values.
//
// HOW IT SEARCHES (bounded, reproducible):
//   1. What is missing stops it, said in words. Targets already met on the
//      check players: nothing is suggested, and it says so.
//   2. Sets of presets are played on the REAL engine on "search players" and
//      improved a step at a time: a step reads which segment is furthest from
//      which target, and adds a preset for it, or moves one (its days, who
//      qualifies, how often, the basket it replaces, what it holds), or takes
//      one away.
//   3. Each preset left has to earn its place: taken away in turn, it stays
//      away when the targets do not suffer.
//   4. The event as it is and the event with the suggestion are played again
//      on OTHER players, more of them, the same for both, and in the other
//      view of the players too. Only those figures are reported.
import { CHEST_LABELS, CHEST_TYPES, RARITY, VARIATION_LABELS, createPreset, expectedSupply, recipeForSegment } from './chefModel'
import { ENGINE_VERSION, fingerprint, simulateSegment } from './chefEngine'
import { describeTargets, generatorContext, isBetter, measureSegment, planOf, verdictOf } from './chefGenerator'
import { validateChefConfig } from './chefValidation'
import { createRng } from './chefRng'

export const CATCHUP_VERSION = 'chef-catchup 1.0'
export const CATCHUP_ORIGIN = 'build-03'
export const CATCHUP_STATUS_LABELS = {
  meets: 'With the suggested catch-up presets every segment meets its targets, on the players it was checked on',
  misses: 'The best catch-up presets found still miss targets',
  'no-better': 'No catch-up preset that helps was found',
  already: 'The targets are already met: no catch-up preset is needed',
  inputs: 'Something is missing before catch-up presets can be suggested',
  cancelled: 'Stopped before it was checked',
  incomplete: 'Stopped while it was being checked',
}
export const CATCHUP_KIND_LABELS = { pace: 'Behind pace', stuck: 'Stuck on an ingredient' }

// The controls. Every number is this tool's own default (the screen says so).
export function createCatchupPlan(_state, overrides = {}) {
  const plan = {
    maxPresets: 3,
    // The most times one player may get a suggested preset's basket.
    maxUses: 2,
    // The baskets a suggestion may replace. An Epic basket holds 12-20 ingredients: off to start with.
    chestTypes: { basic: true, rare: true, epic: false },
    kinds: { pace: true, stuck: true },
    search: { players: 100, validationPlayers: 400, candidates: 40, patience: 15, seconds: 180, seed: 2026 },
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
export const catchupPlanOf = (state) => createCatchupPlan(state, state?.generator?.catchupPlan ?? {})
const planKeyOf = (cplan, tplan) => JSON.stringify({ cplan, segmentIds: tplan.segmentIds, tolerancePts: tplan.tolerancePts, gap: tplan.gap, rc: tplan.rc, semi: tplan.semi.maxEarlyPct, variation: tplan.search.variation, aim: tplan.search.aimPts })

const clone = (value) => JSON.parse(JSON.stringify(value))
const sum = (values) => values.reduce((s, v) => s + v, 0)
const isOrdinary = (ing) => ing?.rarity === RARITY.COMMON || ing?.rarity === RARITY.RARE
export const isSuggestedPreset = (p) => p?.origin === CATCHUP_ORIGIN

// The ordinary ingredients the Main recipes use: all a suggestion may hold.
const ordinaryInRecipes = (state) => state.ingredients.filter((i) => isOrdinary(i) && state.dishes.some((d) => d.recipe.some((r) => r.ingredientId === i.id)))
// Every basket size of a type, over its periods of odds.
function sizesOf(state, type) {
  const sizes = new Set()
  for (const b of state.baskets.filter((x) => x.chestType === type)) for (let n = b.totalMin; n <= b.totalMax; n += 1) sizes.add(n)
  return [...sizes].sort((a, b) => a - b)
}
const typesAllowed = (state, cplan) => CHEST_TYPES.filter((t) => cplan.chestTypes?.[t] && sizesOf(state, t).length > 0)
// The basket types a segment opens at all.
const typesOpened = (state, segment) => {
  const supply = expectedSupply(segment, state.calendar)
  return CHEST_TYPES.filter((t) => sum(supply[t] ?? []) > 0)
}

// --- What stops a suggestion -------------------------------------------------

export function catchupProblems(state, cplan = catchupPlanOf(state), tplan = planOf(state)) {
  const ctx = generatorContext(state, tplan)
  const problems = []
  if (ctx.segments.length === 0) problems.push('No segment is selected ("Judged on", in the proposal\'s controls).')
  if (state.dishes.length === 0) problems.push('There are no Main dishes (step 2).')
  if (describeTargets(state, tplan).filter((t) => t.id === 'fu' || ctx.checkpoints.some((c) => c.id === t.id)).length === 0) problems.push('No FU day and no checkpoint is set, so a catch-up has no pace to bring players back to: type one (step 1).')
  if (ordinaryInRecipes(state).length === 0) problems.push('No common or rare ingredient is in the Main recipes, and a suggested preset holds only those.')
  if (!cplan.kinds.pace && !cplan.kinds.stuck) problems.push('Neither kind of player is allowed: switch on "behind pace" or "stuck on an ingredient".')
  const types = typesAllowed(state, cplan)
  if (types.length === 0) problems.push('No basket type may be replaced, or none of those allowed exists: allow Basic, Rare or Epic.')
  else if (!ctx.segments.some((s) => typesOpened(state, s).some((t) => types.includes(t)))) problems.push(`No selected segment opens a ${types.map((t) => CHEST_LABELS[t]).join(' or ')} basket, so a suggestion would never be given.`)
  for (const f of validateChefConfig(state)) if (f.severity === 'block') problems.push(f.message)
  if (!(cplan.maxPresets >= 1)) problems.push('At most 0 presets: allow at least one.')
  if (!(cplan.maxUses >= 1)) problems.push('A player may get a suggested basket 0 times: allow at least once.')
  return problems
}

// --- A suggestion as data ------------------------------------------------------
//
// A spec: { kind, segmentIds, chestType, startDay, endDay, maxUses, dishesMax | (ingredientId, missingMin, focus),
// mix: { ingredientId: weight } } - turned into a preset of the engine by presetOf.

// What a basket of `size` holds: the focus ingredient's share first (stuck), the rest by the mix, whole units,
// never more of one ingredient than its pantry holds.
export function contentsFor(size, spec, byId) {
  const out = {}
  let left = size
  const capOf = (id) => (byId[id]?.pantryCap != null ? byId[id].pantryCap : Infinity)
  if (spec.kind === 'stuck' && spec.ingredientId) {
    const n = Math.min(left, capOf(spec.ingredientId), Math.max(1, Math.ceil(size * (spec.focus ?? 1))))
    out[spec.ingredientId] = n
    left -= n
  }
  const entries = Object.entries(spec.mix ?? {}).filter(([id, w]) => w > 0 && byId[id] && (out[id] ?? 0) < capOf(id))
  const total = sum(entries.map(([, w]) => w))
  if (left > 0 && total > 0) {
    const shares = entries.map(([id, w]) => ({ id, exact: (left * w) / total }))
    for (const s of shares) {
      const room = capOf(s.id) - (out[s.id] ?? 0)
      const n = Math.min(room, Math.floor(s.exact))
      out[s.id] = (out[s.id] ?? 0) + n
      left -= n
    }
    // (The units left go to the largest remainders, then to whoever still has room.)
    const order = [...shares].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || b.exact - a.exact)
    for (let pass = 0; left > 0 && pass < 3; pass += 1)
      for (const s of order) {
        if (left <= 0) break
        if ((out[s.id] ?? 0) < capOf(s.id)) {
          out[s.id] = (out[s.id] ?? 0) + 1
          left -= 1
        }
      }
  }
  if (left > 0 && spec.kind === 'stuck' && spec.ingredientId) out[spec.ingredientId] += left
  return Object.fromEntries(Object.entries(out).filter(([, n]) => n > 0))
}

function nameOf(spec, byId) {
  return spec.kind === 'pace' ? `Suggested catch-up: at most ${spec.dishesMax} ${spec.dishesMax === 1 ? 'dish' : 'dishes'}, days ${spec.startDay}-${spec.endDay}` : `Suggested catch-up: missing ${byId[spec.ingredientId]?.name ?? '?'}, days ${spec.startDay}-${spec.endDay}`
}

function presetOf(spec, index, state, byId, firstPriority, idBase) {
  const allocations = {}
  for (const size of sizesOf(state, spec.chestType)) allocations[size] = contentsFor(size, spec, byId)
  return createPreset({
    id: `${idBase}-${index + 1}`,
    name: nameOf(spec, byId),
    chestType: spec.chestType,
    round: 'main',
    startDay: spec.startDay,
    endDay: spec.endDay,
    priority: firstPriority + index,
    segmentIds: spec.segmentIds,
    eligibility: spec.kind === 'pace' ? { dishesMax: spec.dishesMax } : { missingIngredientId: spec.ingredientId, missingMin: spec.missingMin },
    maxUses: spec.maxUses,
    sizeMode: 'by-total',
    allocations,
    fallback: 'next',
    origin: CATCHUP_ORIGIN,
  })
}

// The presets of a set of specs, after the economist's (theirs keep going first).
function presetsOf(specs, state, byId) {
  const firstPriority = Math.max(0, ...(state.presets ?? []).map((p) => Number(p.priority) || 0)) + 1
  const used = new Set((state.presets ?? []).map((p) => p.id))
  let n = 1
  while (used.has(`catchup-${n}-1`)) n += 1
  return specs.map((spec, i) => presetOf(spec, i, state, byId, firstPriority, `catchup-${n}`))
}

// In words: who gets it, when, and what a basket of the middle size holds.
export function describeSpec(spec, state) {
  const byId = Object.fromEntries(state.ingredients.map((i) => [i.id, i]))
  const who = spec.kind === 'pace' ? `players who have cooked at most ${spec.dishesMax} Main ${spec.dishesMax === 1 ? 'dish' : 'dishes'}` : `players who still miss at least ${spec.missingMin} ${byId[spec.ingredientId]?.name ?? '?'} for the dishes they have left`
  const segs = spec.segmentIds ? spec.segmentIds.map((id) => state.segments.find((s) => s.id === id)?.name ?? id).join(', ') : 'every segment'
  const sizes = sizesOf(state, spec.chestType)
  const mid = sizes[Math.floor(sizes.length / 2)]
  const contents = contentsFor(mid, spec, byId)
  const holds = Object.entries(contents)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${n} ${byId[id]?.name ?? id}`)
    .join(', ')
  return {
    who,
    segments: segs,
    when: `days ${spec.startDay} to ${spec.endDay}`,
    uses: spec.maxUses,
    basket: CHEST_LABELS[spec.chestType],
    holds: `a basket of ${mid} holds ${holds}`,
    text: `In ${segs}, ${who} on days ${spec.startDay} to ${spec.endDay}: ${spec.maxUses === 1 ? 'one' : `up to ${spec.maxUses}`} of their ${CHEST_LABELS[spec.chestType]} baskets ${spec.maxUses === 1 ? 'holds' : 'hold'} guaranteed ingredients instead (${`a basket of ${mid}: ${holds}`}).`,
  }
}

// --- Playing a set of presets ----------------------------------------------------

async function assessSpecs(state, specs, tplan, ctx, byId, { players, seed, aim = 0, variation = ctx.variation }, run) {
  const presets = presetsOf(specs, state, byId)
  const full = { ...state, presets: [...(state.presets ?? []), ...presets] }
  const segments = []
  const touched = []
  const baskets = []
  for (const segment of ctx.segments) {
    const result = simulateSegment(full, segment, { players, seed, variation, probeDays: ctx.probeDays, gapLimit: ctx.gapLimit, rcFuWithin: ctx.rcFuWithin })
    const measured = measureSegment(state, tplan, ctx, segment, result, aim)
    const byPreset = result.presets.byPreset.filter((p) => presets.some((x) => x.id === p.id))
    segments.push({ ...measured, catchup: { playersShare: result.presets.suggestedShare, basketsMean: result.presets.suggestedBasketsMean, byPreset, presetsShare: result.presets.affectedShare } })
    touched.push(result.presets.suggestedShare)
    baskets.push(result.presets.suggestedBasketsMean)
    await run.tick()
    if (run.cancelled()) return null
  }
  return { specs, presets, segments, worst: Math.max(0, ...segments.map((s) => s.miss)), total: sum(segments.map((s) => s.miss)), touched: touched.length ? sum(touched) / touched.length : 0, baskets: baskets.length ? sum(baskets) / baskets.length : 0, count: specs.length }
}

// Better: the worst segment, then all segments (build 02's order); then fewer players touched (economist: "Fewest
// players touched"); then fewer presets; then fewer suggested baskets.
export function catchupIsBetter(a, b) {
  if (isBetter({ worst: a.worst, total: a.total, pref: 0 }, { worst: b.worst, total: b.total, pref: 0 })) return true
  if (isBetter({ worst: b.worst, total: b.total, pref: 0 }, { worst: a.worst, total: a.total, pref: 0 })) return false
  if (a.touched < b.touched - 0.005) return true
  if (a.touched > b.touched + 0.005) return false
  if (a.count !== b.count) return a.count < b.count
  return a.baskets < b.baskets - 0.01
}

// --- Making candidates ------------------------------------------------------------

// The target a new preset aims at: the segment furthest from its FU or checkpoint targets, and that target.
function aimOf(assessed, rng) {
  const rows = assessed.segments
    .flatMap((s) => s.shortfalls.filter((x) => x.miss > 0 && (x.kind === 'fu' || x.kind === 'checkpoint')).map((x) => ({ segment: s, shortfall: x })))
    .sort((a, b) => b.shortfall.miss - a.shortfall.miss)
  if (!rows.length) return null
  // (Mostly the largest miss; now and then another, so a second segment or target gets its turn.)
  return rows[rng() < 0.7 ? 0 : Math.floor(rng() * rows.length)]
}

// What the players of a segment lack of each ordinary ingredient on a day (probe), as weights.
function mixFor(state, assessedSegment, day, ordinaryIds, segment, byId) {
  const lack = assessedSegment.result.probes?.[day]?.lack ?? []
  const mix = {}
  for (const row of lack) if (ordinaryIds.has(row.id) && row.share > 0) mix[row.id] = Math.round(row.share * Math.max(1, row.mean) * 1000) / 1000
  if (Object.keys(mix).length) return mix
  // (Nobody lacks anything that day: what the Main recipes of the segment need.)
  for (const dish of state.dishes) for (const r of recipeForSegment(dish, segment, byId)) if (ordinaryIds.has(r.ingredientId)) mix[r.ingredientId] = (mix[r.ingredientId] ?? 0) + (r.count ?? 0)
  return mix
}

function newSpec(state, cplan, ctx, byId, assessed, rng) {
  const aim = aimOf(assessed, rng)
  if (!aim) return null
  const { segment: measured, shortfall } = aim
  const segment = ctx.segments.find((s) => s.id === measured.id)
  const types = typesAllowed(state, cplan).filter((t) => typesOpened(state, segment).includes(t))
  if (!types.length) return null
  const ordinaryIds = new Set(ordinaryInRecipes(state).map((i) => i.id))
  const day = shortfall.day
  const dishesNeeded = shortfall.kind === 'checkpoint' ? (ctx.checkpoints.find((c) => c.id === shortfall.id)?.dishes ?? 1) : Math.max(1, measured.result.mainCount - 1)
  const mix = mixFor(state, measured, day, ordinaryIds, segment, byId)
  const kinds = ['pace', 'stuck'].filter((k) => cplan.kinds[k])
  let kind = kinds[Math.floor(rng() * kinds.length)]
  const lack = (measured.result.probes?.[day]?.lack ?? []).filter((x) => ordinaryIds.has(x.id) && x.share > 0).sort((a, b) => b.share * b.mean - a.share * a.mean)
  if (kind === 'stuck' && !lack.length) kind = kinds.includes('pace') ? 'pace' : null
  if (!kind) return null
  const missing = assessed.segments.filter((s) => s.shortfalls.some((x) => x.id === shortfall.id && x.miss > 0)).map((s) => s.id)
  const segmentIds = rng() < 0.7 || missing.length <= 1 ? [segment.id] : missing.length === ctx.segments.length && ctx.segments.length === state.segments.length ? null : missing
  const startDay = Math.max(1, day - 2 - Math.floor(rng() * 6))
  const spec = { kind, segmentIds, chestType: types[Math.floor(rng() * types.length)], startDay, endDay: day, maxUses: 1, mix }
  if (kind === 'pace') spec.dishesMax = Math.max(0, dishesNeeded - 1 - Math.floor(rng() * 2))
  else {
    const pick = lack[rng() < 0.7 ? 0 : Math.floor(rng() * Math.min(3, lack.length))]
    spec.ingredientId = pick.id
    spec.missingMin = Math.max(1, Math.round(Math.max(1, pick.mean) * (0.3 + rng() * 0.5)))
    spec.focus = rng() < 0.5 ? 0.5 : 1
  }
  spec.why = `${measured.name}: ${shortfall.label} (${Math.round(shortfall.share * 100)}% against ${Math.round(shortfall.target * 100)}%)`
  return spec
}

function mutate(spec, state, cplan, ctx, rng) {
  const s = clone(spec)
  const totalDays = ctx.totalDays
  const ops = ['window', 'window', 'uses', 'chest', 'segments', 'mix', spec.kind === 'pace' ? 'dishes' : 'missing']
  const op = ops[Math.floor(rng() * ops.length)]
  const step = () => (rng() < 0.5 ? -1 : 1) * (1 + Math.floor(rng() * 2))
  if (op === 'window') {
    if (rng() < 0.6) s.startDay = Math.min(s.endDay, Math.max(1, s.startDay + step()))
    else s.endDay = Math.min(totalDays, Math.max(s.startDay, s.endDay + step()))
  } else if (op === 'uses') s.maxUses = Math.min(cplan.maxUses, Math.max(1, s.maxUses + (rng() < 0.5 ? -1 : 1)))
  else if (op === 'chest') {
    const types = typesAllowed(state, cplan)
    s.chestType = types[Math.floor(rng() * types.length)] ?? s.chestType
  } else if (op === 'segments') {
    if (s.segmentIds && s.segmentIds.length > 1) s.segmentIds = [s.segmentIds[Math.floor(rng() * s.segmentIds.length)]]
    else if (s.segmentIds) s.segmentIds = ctx.segments.length === state.segments.length ? null : ctx.segments.map((x) => x.id)
    else s.segmentIds = [ctx.segments[Math.floor(rng() * ctx.segments.length)].id]
  } else if (op === 'mix') {
    if (s.kind === 'stuck' && rng() < 0.5) s.focus = s.focus === 1 ? 0.5 : 1
    else s.mix = Object.fromEntries(Object.entries(s.mix).map(([id, w]) => [id, Math.round(w * (0.6 + rng() * 0.8) * 1000) / 1000]))
  } else if (op === 'dishes') s.dishesMax = Math.max(0, s.dishesMax + (rng() < 0.5 ? -1 : 1))
  else if (op === 'missing') s.missingMin = Math.max(1, s.missingMin + step())
  // (`why` - the target it was made for - stays with it; what moved is said in the log.)
  return { spec: s, what: op === 'window' ? 'its days' : op === 'uses' ? 'how often' : op === 'chest' ? 'the basket it replaces' : op === 'segments' ? 'its segments' : op === 'mix' ? 'what it holds' : 'who qualifies' }
}

function nextSpecs(state, best, cplan, ctx, byId, rng) {
  const specs = best.specs
  const r = rng()
  if (specs.length === 0 || (specs.length < cplan.maxPresets && r < 0.35)) {
    const spec = newSpec(state, cplan, ctx, byId, best, rng)
    return spec ? { specs: [...specs, spec], why: `a preset added for ${spec.why}` } : null
  }
  if (r < 0.9 || specs.length === 1) {
    const i = Math.floor(rng() * specs.length)
    const moved = mutate(specs[i], state, cplan, ctx, rng)
    return { specs: specs.map((s, j) => (j === i ? moved.spec : s)), why: `preset ${i + 1}: ${moved.what} moved` }
  }
  const i = Math.floor(rng() * specs.length)
  return { specs: specs.filter((_, j) => j !== i), why: `preset ${i + 1} taken away` }
}

// --- The suggestion ---------------------------------------------------------------

// Generates a catch-up suggestion. Never changes `state`. `hooks`: { onProgress({ done, of, label }), isCancelled(), tick() }.
export async function generateCatchup(state, cplan = catchupPlanOf(state), hooks = {}) {
  const started = Date.now()
  const tplan = planOf(state)
  const ctx = generatorContext(state, tplan)
  const byId = ctx.byId
  const tick = hooks.tick ?? (() => new Promise((resolve) => setTimeout(resolve, 0)))
  const run = { tick, cancelled: () => !!hooks.isCancelled?.() }
  const of = cplan.search.candidates + 6
  const progress = (done, label) => hooks.onProgress?.({ done, of, label })
  const stamp = (extra) => ({
    id: `catchup-${started.toString(36)}`,
    createdAt: new Date(started).toISOString(),
    engine: ENGINE_VERSION,
    search: CATCHUP_VERSION,
    baseFingerprint: fingerprint(state),
    planKey: planKeyOf(cplan, tplan),
    targets: describeTargets(state, tplan),
    settings: { searchPlayers: cplan.search.players, validationPlayers: cplan.search.validationPlayers, searchSeed: cplan.search.seed, validationSeed: cplan.search.seed + 7919, variation: ctx.variation, yours: (state.presets ?? []).filter((p) => p.enabled !== false && !isSuggestedPreset(p)).length, earlier: (state.presets ?? []).filter(isSuggestedPreset).length },
    segmentIds: ctx.segments.map((s) => s.id),
    runtimeMs: Date.now() - started,
    ...extra,
  })

  const problems = catchupProblems(state, cplan, tplan)
  if (problems.length) return stamp({ status: 'inputs', problems, evaluations: 0 })

  const searchOn = { players: cplan.search.players, seed: cplan.search.seed, aim: (Number(tplan.search.aimPts) || 0) / 100 }
  const validateOn = { players: cplan.search.validationPlayers, seed: cplan.search.seed + 7919 }
  const log = []
  const tried = new Map()
  let evaluations = 0
  const play = async (specs, why) => {
    const key = JSON.stringify(specs.map(({ why: _why, ...rest }) => rest))
    if (tried.has(key)) return { rejected: 'played already' }
    tried.set(key, true)
    const assessed = await assessSpecs(state, specs, tplan, ctx, byId, searchOn, run)
    if (!assessed) return null
    evaluations += 1
    log.push({ n: evaluations, why, worst: assessed.worst, total: assessed.total, touched: assessed.touched, presets: specs.length })
    progress(evaluations, why)
    return assessed
  }

  progress(0, 'The event as it is')
  const base = await play([], 'the event as it is, with no suggested preset')
  if (base === null) return stamp({ status: 'cancelled', evaluations })
  let best = base
  let cancelled = false
  let stopReason = 'candidates'

  // Already met on the search players: checked on the others before saying so.
  if (base.worst <= 0) {
    progress(of - 2, 'Checking the event on other players')
    const checked = await assessSpecs(state, [], tplan, ctx, byId, validateOn, run)
    if (checked === null) return stamp({ status: 'incomplete', evaluations })
    if (checked.worst <= 0) return stamp({ status: 'already', evaluations, log, validation: { base: judged(checked, ctx), proposed: null } })
  }

  const rng = createRng(cplan.search.seed)
  let idle = 0
  let failures = 0
  while (evaluations < cplan.search.candidates) {
    if ((Date.now() - started) / 1000 > cplan.search.seconds) {
      stopReason = 'time'
      break
    }
    const next = nextSpecs(state, best, cplan, ctx, byId, rng)
    if (!next) {
      if (++failures > 200) {
        stopReason = 'nothing-to-try'
        break
      }
      continue
    }
    const assessed = await play(next.specs, next.why)
    if (assessed === null) {
      cancelled = true
      break
    }
    if (assessed.rejected) {
      if (++failures > 200) {
        stopReason = 'nothing-to-try'
        break
      }
      continue
    }
    if (catchupIsBetter(assessed, best)) {
      best = assessed
      idle = 0
    } else idle += 1
    if (best.worst <= 0 && idle >= 8) {
      stopReason = 'settled'
      break
    }
    if (idle >= cplan.search.patience) {
      stopReason = 'stalled'
      break
    }
  }
  // Each preset has to earn its place: taken away in turn, it stays away when the targets do not suffer.
  const pruned = []
  for (let i = best.specs.length - 1; i >= 0 && !cancelled; i -= 1) {
    const without = best.specs.filter((_, j) => j !== i)
    const assessed = await play(without, `is preset ${i + 1} needed? Played without it`)
    if (assessed === null) {
      cancelled = true
      break
    }
    if (assessed.rejected) continue
    if (assessed.worst <= best.worst + 0.005 && assessed.total <= best.total + 0.005) {
      pruned.push(describeSpec(best.specs[i], state).text)
      best = assessed
    }
  }
  if (cancelled) return stamp({ status: 'cancelled', evaluations, log: log.slice(-60), note: 'Stopped before anything was checked on other players. The event is as it was; nothing can be applied from a search that was not checked.' })

  const incomplete = () => stamp({ status: 'incomplete', evaluations, log: log.slice(-60), note: 'Stopped while the suggestion was being checked on other players. Nothing was applied, and nothing can be: the check did not finish.' })
  progress(of - 5, 'Checking the event as it is on other players')
  const baseValidated = await assessSpecs(state, [], tplan, ctx, byId, validateOn, run)
  if (baseValidated === null) return incomplete()
  progress(of - 4, 'Checking the suggestion on other players')
  const proposedValidated = best.specs.length ? await assessSpecs(state, best.specs, tplan, ctx, byId, validateOn, run) : baseValidated
  if (proposedValidated === null) return incomplete()
  // THE OTHER VIEW OF THE PLAYERS - a reading only, the verdicts use the view chosen (as for a proposal).
  const otherVariation = ctx.variation === 'activity' ? 'baskets' : 'activity'
  progress(of - 2, `Playing both with ${VARIATION_LABELS[otherVariation].toLowerCase()}`)
  const baseOther = await assessSpecs(state, [], tplan, ctx, byId, { ...validateOn, variation: otherVariation }, run)
  if (baseOther === null) return incomplete()
  const proposedOther = best.specs.length ? await assessSpecs(state, best.specs, tplan, ctx, byId, { ...validateOn, variation: otherVariation }, run) : baseOther
  if (proposedOther === null) return incomplete()
  const brief = (a) => a.segments.map((s) => ({ id: s.id, shortfalls: s.shortfalls.map((x) => ({ id: x.id, kind: x.kind, share: x.share, target: x.target })), finish: s.result.finish.share, touched: s.catchup.playersShare }))

  const noBetter = best.specs.length === 0 || !catchupIsBetter(proposedValidated, baseValidated) || !(proposedValidated.worst < baseValidated.worst - 0.005 || proposedValidated.total < baseValidated.total - 0.005)
  const status = noBetter ? 'no-better' : proposedValidated.worst <= 0 ? 'meets' : 'misses'
  const presets = presetsOf(best.specs, state, byId)
  return stamp({
    status,
    stopReason,
    evaluations,
    runtimeMs: Date.now() - started,
    log: log.slice(-80),
    specs: best.specs,
    patch: noBetter ? null : { presets },
    proposedFingerprint: noBetter ? null : fingerprint({ ...state, presets: [...(state.presets ?? []), ...presets] }),
    described: best.specs.map((spec, i) => ({ id: presets[i].id, kind: spec.kind, aim: spec.why, ...describeSpec(spec, state) })),
    pruned,
    validation: { base: judged(baseValidated, ctx), proposed: judged(proposedValidated, ctx), baseScore: { worst: baseValidated.worst, total: baseValidated.total }, proposedScore: { worst: proposedValidated.worst, total: proposedValidated.total, touched: proposedValidated.touched, baskets: proposedValidated.baskets } },
    otherView: { variation: otherVariation, base: brief(baseOther), proposed: brief(proposedOther) },
    searchScore: { start: { worst: base.worst, total: base.total }, best: { worst: best.worst, total: best.total, touched: best.touched } },
  })
}

function judged(assessed, ctx) {
  return assessed.segments.map((s) => ({ ...s, shortfalls: s.shortfalls.map((x) => ({ ...x, verdict: verdictOf(x, s.result.players, ctx.tolerance) })) }))
}

// --- Apply, discard, undo ------------------------------------------------------------

export const catchupIsStale = (state, suggestion) => !!suggestion?.patch && !suggestion.appliedAt && (suggestion.search !== CATCHUP_VERSION || suggestion.baseFingerprint !== fingerprint(state) || suggestion.planKey !== planKeyOf(catchupPlanOf(state), planOf(state)))
export const catchupStaleReason = (state, suggestion) =>
  !catchupIsStale(state, suggestion)
    ? null
    : suggestion.search !== CATCHUP_VERSION
      ? `It was made by an earlier version of the catch-up search (${suggestion.search}).`
      : suggestion.baseFingerprint !== fingerprint(state)
        ? 'The event was changed after this suggestion was made, so its figures are no longer about this event.'
        : 'The controls (here or in the proposal\'s targets and segments) were changed after this suggestion was made.'
export const canApplyCatchup = (state, suggestion) => !!suggestion?.patch && ['meets', 'misses'].includes(suggestion.status) && !suggestion.appliedAt && !catchupIsStale(state, suggestion)
export const catchupIsInUse = (state, suggestion) => !!suggestion?.appliedAt && suggestion.proposedFingerprint === fingerprint(state)

// The event with the suggested presets added after the economist's. What was there before is kept for one undo.
export function applyCatchup(state, suggestion) {
  if (!canApplyCatchup(state, suggestion)) return state
  const appliedAt = new Date().toISOString()
  return {
    ...state,
    presets: [...(state.presets ?? []), ...clone(suggestion.patch.presets)],
    generator: { ...(state.generator ?? {}), catchup: { ...suggestion, appliedAt }, catchupApplied: { id: suggestion.id, at: appliedAt, previousPresets: clone(state.presets ?? []) } },
  }
}
export function undoCatchup(state) {
  const applied = state.generator?.catchupApplied
  if (!applied) return state
  const { appliedAt: _appliedAt, ...suggestion } = state.generator.catchup ?? {}
  return { ...state, presets: clone(applied.previousPresets), generator: { ...state.generator, catchupApplied: null, catchup: state.generator.catchup ? suggestion : null } }
}
