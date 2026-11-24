// CHEF - SPECIAL-EVENT SUGGESTIONS.
//
// From the planning (economist): "we should make sure the users has all the
// other ingredients for the chef when they are on FU. if the model will sence
// a danger for somehting missing, he can suggest in the calender to do a
// special event that will give the players those ingredients." The tool reads
// what players lack on the target days and suggests special events - a day, an
// ingredient, an amount and the share of players it reaches - played as the
// engine plays a special source: never past a progression threshold (no
// permission to pass it), reaching its share by the chef's "who gets a special
// source" setting, the same for everyone it reaches.
//
// The economist's answers (24 Nov 2026):
//   WHO       "A share the tool finds": each event says what share of the
//             players it reaches, and the search looks for the smallest that works.
//   WHAT      "Also the semi-blocker": common, rare and the semi-blocker - never
//             the blocker. (The semi-blocker is still held by its threshold.)
//   PREFER    "Fewest ingredients given": between two sets that meet the targets
//             equally well, the one that hands out fewer ingredients in all (as
//             played: what the events really gave a player, on average); then
//             fewer events.
//   SEGMENTS  "Same event for all": one calendar - an event has one day, one
//             ingredient, one amount and one share for every segment.
//
// The targets, shortfalls, order of "better" and verdicts are build 02's, on
// the same players (chefGenerator.js); every number of the controls is this
// tool's own default and the screen says so. The economist's own sources are
// played as they are; suggestions are added after (`origin`), one undo takes
// them out.
import { RARITY, VARIATION_LABELS, createSource, formatCalendarDate, calendarDateForDay } from './chefModel'
import { ENGINE_VERSION, fingerprint, simulateSegment } from './chefEngine'
import { describeTargets, generatorContext, isBetter, measureSegment, planOf, verdictOf } from './chefGenerator'
import { validateChefConfig } from './chefValidation'
import { createRng } from './chefRng'

export const EVENTS_VERSION = 'chef-events 1.0'
export const EVENTS_ORIGIN = 'events-suggested'
export const EVENTS_STATUS_LABELS = {
  meets: 'With the suggested special events every segment meets its targets, on the players it was checked on',
  misses: 'The best special events found still miss targets',
  'no-better': 'No special event that helps was found',
  already: 'The targets are already met: no special event is needed',
  inputs: 'Something is missing before special events can be suggested',
  cancelled: 'Stopped before it was checked',
  incomplete: 'Stopped while it was being checked',
}

export function createEventsPlan(_state, overrides = {}) {
  const plan = {
    maxEvents: 3,
    // The most one event may give a player, and the share of players it may reach.
    maxAmount: 30,
    shareMinPct: 10,
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
export const eventsPlanOf = (state) => createEventsPlan(state, state?.generator?.eventsPlan ?? {})
const planKeyOf = (eplan, tplan) => JSON.stringify({ eplan, segmentIds: tplan.segmentIds, tolerancePts: tplan.tolerancePts, gap: tplan.gap, rc: tplan.rc, semi: tplan.semi.maxEarlyPct, variation: tplan.search.variation, aim: tplan.search.aimPts })

const clone = (value) => JSON.parse(JSON.stringify(value))
const sum = (values) => values.reduce((s, v) => s + v, 0)
const ALLOWED = new Set([RARITY.COMMON, RARITY.RARE, RARITY.SEMI_BLOCKER])
export const isSuggestedEvent = (s) => s?.origin === EVENTS_ORIGIN
const allowedInRecipes = (state) => state.ingredients.filter((i) => ALLOWED.has(i.rarity) && [...state.dishes, ...state.recompletionDishes].some((d) => d.recipe.some((r) => r.ingredientId === i.id)))

export function eventsProblems(state, eplan = eventsPlanOf(state), tplan = planOf(state)) {
  const ctx = generatorContext(state, tplan)
  const problems = []
  if (ctx.segments.length === 0) problems.push('No segment is selected ("Judged on", in the proposal\'s controls).')
  if (state.dishes.length === 0) problems.push('There are no Main dishes (step 2).')
  if (describeTargets(state, tplan).filter((t) => t.id === 'fu' || ctx.checkpoints.some((c) => c.id === t.id)).length === 0) problems.push('No FU day and no checkpoint is set, so there is no day to bring the missing ingredients by: type one (step 1).')
  if (allowedInRecipes(state).length === 0) problems.push('No common, rare or semi-blocker ingredient is in the recipes, and a suggested event gives only those.')
  for (const f of validateChefConfig(state)) if (f.severity === 'block') problems.push(f.message)
  if (!(eplan.maxEvents >= 1)) problems.push('At most 0 events: allow at least one.')
  if (!(eplan.maxAmount >= 1)) problems.push('An event may give at most 0: allow at least 1.')
  return problems
}

// A spec: { day, ingredientId, amount, sharePct, why }.
function sourceOf(spec, index, byId, idBase) {
  return createSource({ id: `${idBase}-${index + 1}`, label: `Suggested event: ${spec.amount} ${byId[spec.ingredientId]?.name ?? '?'}`, kind: 'ingredient', day: spec.day, ingredientId: spec.ingredientId, amount: spec.amount, coveragePct: spec.sharePct, segmentIds: null, bypassThreshold: false, origin: EVENTS_ORIGIN })
}
function sourcesOf(specs, state, byId) {
  const used = new Set((state.sources ?? []).map((s) => s.id))
  let n = 1
  while (used.has(`event-${n}-1`)) n += 1
  return specs.map((spec, i) => sourceOf(spec, i, byId, `event-${n}`))
}

export function describeEvent(spec, state) {
  const byId = Object.fromEntries(state.ingredients.map((i) => [i.id, i]))
  const ing = byId[spec.ingredientId]
  const date = formatCalendarDate(calendarDateForDay(state.calendar, spec.day))
  const kind = ing?.rarity === RARITY.SEMI_BLOCKER ? ' (the semi-blocker - still held by its threshold)' : ''
  return { text: `On day ${spec.day}${date ? ` (${date})` : ''}, a special event gives ${spec.amount} ${ing?.name ?? '?'}${kind} to ${spec.sharePct}% of the players of every segment.`, day: spec.day, ingredient: ing?.name ?? '?', amount: spec.amount, sharePct: spec.sharePct }
}

// What the special sources of the event gave a player on average, per ingredient (as played).
const specialOf = (result) => Object.fromEntries(result.ingredients.map((i) => [i.id, i.special ?? 0]))

async function assessSpecs(state, specs, tplan, ctx, byId, base, { players, seed, aim = 0, variation = ctx.variation }, run) {
  const sources = sourcesOf(specs, state, byId)
  const full = { ...state, sources: [...(state.sources ?? []), ...sources] }
  const segments = []
  const given = []
  for (const segment of ctx.segments) {
    const result = simulateSegment(full, segment, { players, seed, variation, probeDays: ctx.probeDays, gapLimit: ctx.gapLimit, rcFuWithin: ctx.rcFuWithin })
    const measured = measureSegment(state, tplan, ctx, segment, result, aim)
    // What the suggested events really gave (the same players with and without them, so the economist's own
    // sources cancel out): units a player, on average.
    const before = base?.[segment.id] ?? {}
    const special = specialOf(result)
    const gave = sum(Object.keys(special).map((id) => Math.max(0, special[id] - (before[id] ?? 0))))
    segments.push({ ...measured, events: { given: gave } })
    given.push(gave)
    await run.tick()
    if (run.cancelled()) return null
  }
  return { specs, sources, segments, worst: Math.max(0, ...segments.map((s) => s.miss)), total: sum(segments.map((s) => s.miss)), given: given.length ? sum(given) / given.length : 0, count: specs.length }
}

// Better: the worst segment, then all segments; then fewer ingredients given (economist); then fewer events.
export function eventsIsBetter(a, b) {
  if (isBetter({ worst: a.worst, total: a.total, pref: 0 }, { worst: b.worst, total: b.total, pref: 0 })) return true
  if (isBetter({ worst: b.worst, total: b.total, pref: 0 }, { worst: a.worst, total: a.total, pref: 0 })) return false
  if (a.given < b.given - 0.05) return true
  if (a.given > b.given + 0.05) return false
  return a.count < b.count
}

const roundShare = (pct, min) => Math.max(min, Math.min(100, Math.round(pct / 5) * 5))

function newSpec(state, eplan, ctx, assessed, rng) {
  const rows = assessed.segments
    .flatMap((s) => s.shortfalls.filter((x) => x.miss > 0 && (x.kind === 'fu' || x.kind === 'checkpoint')).map((x) => ({ segment: s, shortfall: x })))
    .sort((a, b) => b.shortfall.miss - a.shortfall.miss)
  if (!rows.length) return null
  const { shortfall } = rows[rng() < 0.7 ? 0 : Math.floor(rng() * rows.length)]
  const day = shortfall.day
  const allowed = new Set(allowedInRecipes(state).map((i) => i.id))
  // What players lack that day, over every segment judged (one calendar for all).
  const lack = {}
  for (const s of assessed.segments) for (const row of s.result.probes?.[day]?.lack ?? []) if (allowed.has(row.id) && row.share > 0) (lack[row.id] ??= []).push(row)
  const ranked = Object.entries(lack)
    .map(([id, list]) => ({ id, share: sum(list.map((r) => r.share)) / assessed.segments.length, mean: sum(list.map((r) => r.mean * r.share)) / Math.max(1e-9, sum(list.map((r) => r.share))) }))
    .sort((a, b) => b.share * b.mean - a.share * a.mean)
  if (!ranked.length) return null
  const pick = ranked[rng() < 0.7 ? 0 : Math.floor(rng() * Math.min(3, ranked.length))]
  const amount = Math.max(1, Math.min(eplan.maxAmount, Math.round(Math.max(1, pick.mean) * (0.6 + rng() * 0.7))))
  const sharePct = roundShare(pick.share * 100 * (1 + rng() * 0.4), eplan.shareMinPct)
  return { day: Math.max(1, day - 1 - Math.floor(rng() * 5)), ingredientId: pick.id, amount, sharePct, why: `${shortfall.label} (${Math.round(shortfall.share * 100)}% against ${Math.round(shortfall.target * 100)}%): ${Math.round(pick.share * 100)}% of the players lack it then` }
}

function mutate(spec, eplan, ctx, rng) {
  const s = clone(spec)
  const ops = ['day', 'amount', 'amount', 'share', 'share']
  const op = ops[Math.floor(rng() * ops.length)]
  const step = () => (rng() < 0.5 ? -1 : 1) * (1 + Math.floor(rng() * 2))
  if (op === 'day') s.day = Math.min(ctx.totalDays, Math.max(1, s.day + step()))
  else if (op === 'amount') s.amount = Math.min(eplan.maxAmount, Math.max(1, rng() < 0.5 ? s.amount + step() : Math.round(s.amount * (0.7 + rng() * 0.6))))
  else s.sharePct = roundShare(s.sharePct + (rng() < 0.5 ? -1 : 1) * (5 + Math.floor(rng() * 3) * 5), eplan.shareMinPct)
  return { spec: s, what: op === 'day' ? 'its day' : op === 'amount' ? 'its amount' : 'its share of players' }
}

function nextSpecs(state, best, eplan, ctx, rng) {
  const specs = best.specs
  const r = rng()
  if (specs.length === 0 || (specs.length < eplan.maxEvents && r < 0.35)) {
    const spec = newSpec(state, eplan, ctx, best, rng)
    return spec ? { specs: [...specs, spec], why: `an event added for ${spec.why}` } : null
  }
  if (r < 0.9 || specs.length === 1) {
    const i = Math.floor(rng() * specs.length)
    const moved = mutate(specs[i], eplan, ctx, rng)
    return { specs: specs.map((s, j) => (j === i ? moved.spec : s)), why: `event ${i + 1}: ${moved.what} moved` }
  }
  const i = Math.floor(rng() * specs.length)
  return { specs: specs.filter((_, j) => j !== i), why: `event ${i + 1} taken away` }
}

function judged(assessed, ctx) {
  return assessed.segments.map((s) => ({ ...s, shortfalls: s.shortfalls.map((x) => ({ ...x, verdict: verdictOf(x, s.result.players, ctx.tolerance) })) }))
}

// Generates a special-event suggestion. Never changes `state`. hooks: { onProgress({ done, of, label }), isCancelled(), tick() }.
export async function generateEvents(state, eplan = eventsPlanOf(state), hooks = {}) {
  const started = Date.now()
  const tplan = planOf(state)
  const ctx = generatorContext(state, tplan)
  const byId = ctx.byId
  const tick = hooks.tick ?? (() => new Promise((resolve) => setTimeout(resolve, 0)))
  const run = { tick, cancelled: () => !!hooks.isCancelled?.() }
  const of = eplan.search.candidates + 6
  const progress = (done, label) => hooks.onProgress?.({ done, of, label })
  const stamp = (extra) => ({
    id: `events-${started.toString(36)}`,
    createdAt: new Date(started).toISOString(),
    engine: ENGINE_VERSION,
    search: EVENTS_VERSION,
    baseFingerprint: fingerprint(state),
    planKey: planKeyOf(eplan, tplan),
    targets: describeTargets(state, tplan),
    settings: { searchPlayers: eplan.search.players, validationPlayers: eplan.search.validationPlayers, searchSeed: eplan.search.seed, validationSeed: eplan.search.seed + 7919, variation: ctx.variation, yours: (state.sources ?? []).filter((s) => !isSuggestedEvent(s)).length, earlier: (state.sources ?? []).filter(isSuggestedEvent).length, recipients: state.settings?.recipients ?? 'same' },
    segmentIds: ctx.segments.map((s) => s.id),
    runtimeMs: Date.now() - started,
    ...extra,
  })
  const problems = eventsProblems(state, eplan, tplan)
  if (problems.length) return stamp({ status: 'inputs', problems, evaluations: 0 })

  // What the economist's own sources give, on each set of players: the suggestions are measured against it.
  const baseSpecial = async (opts) => {
    const out = {}
    for (const segment of ctx.segments) {
      out[segment.id] = specialOf(simulateSegment(state, segment, { players: opts.players, seed: opts.seed, variation: opts.variation ?? ctx.variation }))
      await run.tick()
      if (run.cancelled()) return null
    }
    return out
  }
  const searchOn = { players: eplan.search.players, seed: eplan.search.seed, aim: (Number(tplan.search.aimPts) || 0) / 100 }
  const validateOn = { players: eplan.search.validationPlayers, seed: eplan.search.seed + 7919 }
  const searchBase = await baseSpecial(searchOn)
  if (!searchBase) return stamp({ status: 'cancelled', evaluations: 0 })
  const log = []
  const tried = new Set()
  let evaluations = 0
  const play = async (specs, why) => {
    const key = JSON.stringify(specs.map(({ why: _why, ...rest }) => rest))
    if (tried.has(key)) return { rejected: 'played already' }
    tried.add(key)
    const assessed = await assessSpecs(state, specs, tplan, ctx, byId, searchBase, searchOn, run)
    if (!assessed) return null
    evaluations += 1
    log.push({ n: evaluations, why, worst: assessed.worst, total: assessed.total, given: assessed.given, events: specs.length })
    progress(evaluations, why)
    return assessed
  }

  progress(0, 'The event as it is')
  const base = await play([], 'the event as it is, with no suggested special event')
  if (base === null) return stamp({ status: 'cancelled', evaluations })
  let best = base
  let cancelled = false
  let stopReason = 'candidates'
  if (base.worst <= 0) {
    const checkBase = await baseSpecial(validateOn)
    const checked = checkBase && (await assessSpecs(state, [], tplan, ctx, byId, checkBase, validateOn, run))
    if (!checked) return stamp({ status: 'incomplete', evaluations })
    if (checked.worst <= 0) return stamp({ status: 'already', evaluations, log, validation: { base: judged(checked, ctx), proposed: null } })
  }
  const rng = createRng(eplan.search.seed)
  let idle = 0
  let failures = 0
  while (evaluations < eplan.search.candidates) {
    if ((Date.now() - started) / 1000 > eplan.search.seconds) {
      stopReason = 'time'
      break
    }
    const next = nextSpecs(state, best, eplan, ctx, rng)
    const assessed = next ? await play(next.specs, next.why) : { rejected: 'nothing' }
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
    if (eventsIsBetter(assessed, best)) {
      best = assessed
      idle = 0
    } else idle += 1
    if (best.worst <= 0 && idle >= 8) {
      stopReason = 'settled'
      break
    }
    if (idle >= eplan.search.patience) {
      stopReason = 'stalled'
      break
    }
  }
  // Each event has to earn its place.
  const pruned = []
  for (let i = best.specs.length - 1; i >= 0 && !cancelled; i -= 1) {
    const without = best.specs.filter((_, j) => j !== i)
    const assessed = await play(without, `is event ${i + 1} needed? Played without it`)
    if (assessed === null) {
      cancelled = true
      break
    }
    if (assessed.rejected) continue
    if (assessed.worst <= best.worst + 0.005 && assessed.total <= best.total + 0.005) {
      pruned.push(describeEvent(best.specs[i], state).text)
      best = assessed
    }
  }
  if (cancelled) return stamp({ status: 'cancelled', evaluations, log: log.slice(-60), note: 'Stopped before anything was checked on other players. The event is as it was.' })

  const incomplete = () => stamp({ status: 'incomplete', evaluations, log: log.slice(-60), note: 'Stopped while the suggestion was being checked on other players. Nothing can be applied: the check did not finish.' })
  progress(of - 5, 'Checking the event as it is on other players')
  const checkBase = await baseSpecial(validateOn)
  if (!checkBase) return incomplete()
  const baseValidated = await assessSpecs(state, [], tplan, ctx, byId, checkBase, validateOn, run)
  if (!baseValidated) return incomplete()
  progress(of - 4, 'Checking the suggestion on other players')
  const proposedValidated = best.specs.length ? await assessSpecs(state, best.specs, tplan, ctx, byId, checkBase, validateOn, run) : baseValidated
  if (!proposedValidated) return incomplete()
  const otherVariation = ctx.variation === 'activity' ? 'baskets' : 'activity'
  progress(of - 2, `Playing both with ${VARIATION_LABELS[otherVariation].toLowerCase()}`)
  const otherBaseSpecial = await baseSpecial({ ...validateOn, variation: otherVariation })
  if (!otherBaseSpecial) return incomplete()
  const baseOther = await assessSpecs(state, [], tplan, ctx, byId, otherBaseSpecial, { ...validateOn, variation: otherVariation }, run)
  if (!baseOther) return incomplete()
  const proposedOther = best.specs.length ? await assessSpecs(state, best.specs, tplan, ctx, byId, otherBaseSpecial, { ...validateOn, variation: otherVariation }, run) : baseOther
  if (!proposedOther) return incomplete()
  const brief = (a) => a.segments.map((s) => ({ id: s.id, shortfalls: s.shortfalls.map((x) => ({ id: x.id, kind: x.kind, share: x.share, target: x.target })), finish: s.result.finish.share, given: s.events.given }))

  const noBetter = best.specs.length === 0 || !eventsIsBetter(proposedValidated, baseValidated) || !(proposedValidated.worst < baseValidated.worst - 0.005 || proposedValidated.total < baseValidated.total - 0.005)
  const status = noBetter ? 'no-better' : proposedValidated.worst <= 0 ? 'meets' : 'misses'
  const sources = sourcesOf(best.specs, state, byId)
  return stamp({
    status,
    stopReason,
    evaluations,
    runtimeMs: Date.now() - started,
    log: log.slice(-80),
    specs: best.specs,
    patch: noBetter ? null : { sources },
    proposedFingerprint: noBetter ? null : fingerprint({ ...state, sources: [...(state.sources ?? []), ...sources] }),
    described: best.specs.map((spec, i) => ({ id: sources[i].id, aim: spec.why, ...describeEvent(spec, state) })),
    pruned,
    validation: { base: judged(baseValidated, ctx), proposed: judged(proposedValidated, ctx), baseScore: { worst: baseValidated.worst, total: baseValidated.total }, proposedScore: { worst: proposedValidated.worst, total: proposedValidated.total, given: proposedValidated.given } },
    otherView: { variation: otherVariation, base: brief(baseOther), proposed: brief(proposedOther) },
  })
}

// --- Apply, discard, undo -------------------------------------------------------

export const eventsIsStale = (state, suggestion) => !!suggestion?.patch && !suggestion.appliedAt && (suggestion.search !== EVENTS_VERSION || suggestion.baseFingerprint !== fingerprint(state) || suggestion.planKey !== planKeyOf(eventsPlanOf(state), planOf(state)))
export const eventsStaleReason = (state, suggestion) =>
  !eventsIsStale(state, suggestion) ? null : suggestion.baseFingerprint !== fingerprint(state) ? 'The event was changed after this suggestion was made, so its figures are no longer about this event.' : 'The controls (here or in the proposal\'s targets and segments) were changed after this suggestion was made.'
export const canApplyEvents = (state, suggestion) => !!suggestion?.patch && ['meets', 'misses'].includes(suggestion.status) && !suggestion.appliedAt && !eventsIsStale(state, suggestion)
export const eventsIsInUse = (state, suggestion) => !!suggestion?.appliedAt && suggestion.proposedFingerprint === fingerprint(state)
export function applyEvents(state, suggestion) {
  if (!canApplyEvents(state, suggestion)) return state
  const appliedAt = new Date().toISOString()
  return { ...state, sources: [...(state.sources ?? []), ...clone(suggestion.patch.sources)], generator: { ...(state.generator ?? {}), events: { ...suggestion, appliedAt }, eventsApplied: { id: suggestion.id, at: appliedAt, previousSources: clone(state.sources ?? []) } } }
}
export function undoEvents(state) {
  const applied = state.generator?.eventsApplied
  if (!applied) return state
  const { appliedAt: _appliedAt, ...suggestion } = state.generator.events ?? {}
  return { ...state, sources: clone(applied.previousSources), generator: { ...state.generator, eventsApplied: null, events: state.generator.events ? suggestion : null } }
}
