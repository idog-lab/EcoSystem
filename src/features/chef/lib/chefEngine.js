// THE CHEF RULE ENGINE. One place plays the rules of the event; the
// simulation, the comparisons and (later builds) the suggestions all go
// through it.
//
// ONE PLAYER, DAY BY DAY (`simulatePlayer`):
//   1. What is handed out that day besides the baskets (special sources and
//      jokers), in the order of the list.
//   2. The day's baskets: Basic, then Rare, then Epic. For each basket:
//        - its size is rolled (evenly between its smallest and largest);
//        - if a catch-up preset fits the player right now, the basket holds
//          the preset's guaranteed contents instead (it replaces the basket);
//        - else its units are drawn one at a time by weight among the
//          ingredients that are in the basket, have not reached their most
//          for this basket, and are not held back by their progression
//          threshold. An ingredient held back is left out and the others take
//          its place: the basket keeps its size while they have room;
//        - what does not fit the pantry is lost, with nothing in its place.
//   3. Cooking: as soon as a recipe is affordable (after every delivery, or
//      once a day - a setting), in the order of the list (or the biggest
//      prize first - a setting). A player never holds a dish back.
//   4. When the last Main dish is cooked the grand prize is paid and
//      RECOMPLETION begins at that moment: the pantry is kept, the count of
//      what was received starts again at zero, the Recompletion thresholds
//      apply, its dishes can be cooked at once, and it is cooked one time.
//
// FU ("final unlock" - sitting one dish short, waiting for blockers): every
// dish of the round but one is cooked, the last one lacks ONLY blockers, and
// the player has received as many blockers as the threshold in force allows.
// A player missing an ordinary ingredient is not in FU; a player who finished
// is not in FU.
//
// RANDOMNESS is keyed (chefRng.js): each basket of each player has streams of
// its own, so one more basket, or a preset, never changes what another basket
// rolls. Two plays of the same players differ only by what was changed.
import { CHEST_TYPES, isBlocker, expectedSupply, phaseForDay, basketsForPhase, recipeForSegment, thresholdLimitOn } from './chefModel'
import { keyedRng, hashText, randomSeed } from './chefRng'
import { prizeTable } from './chefRewards'

export const ENGINE_VERSION = 'chef-engine 1.0'

const K_SIZE = 11
const K_PICK = 12
const K_ACTIVITY = 13
const K_GRANT = 14
const K_SOURCE = 15
const K_OFFSET = 16

// Everything the engine needs about one segment's event, worked out once.
export function prepareWorld(state, segment, { supplyFactor = 1, probeDays = null } = {}) {
  const calendar = state.calendar
  const days = Math.max(1, calendar.totalDays)
  const ingredients = state.ingredients ?? []
  const byId = Object.fromEntries(ingredients.map((i) => [i.id, i]))
  const blocker = Object.fromEntries(ingredients.map((i) => [i.id, isBlocker(i)]))
  const pantryCap = Object.fromEntries(ingredients.map((i) => [i.id, i.pantryCap == null ? null : Math.max(0, Number(i.pantryCap))]))
  const basketByDay = [null]
  for (let day = 1; day <= days; day += 1) basketByDay.push(basketsForPhase(state.baskets ?? [], phaseForDay(calendar, day)?.id))
  // (A dish with a blank quantity is incomplete: it is in the round, and can never be cooked - not a free dish.)
  const recipesOf = (list) => (list ?? []).map((dish) => ({ id: dish.id, name: dish.name, recipe: recipeForSegment(dish, segment, byId).filter((r) => r.count != null), incomplete: dish.recipe.some((r) => r.count == null) }))
  const thresholds = { main: {}, rc: {} }
  for (const t of state.thresholds ?? []) if (thresholds[t.round]) thresholds[t.round][t.ingredientId] = t
  const sourcesByDay = {}
  for (const source of state.sources ?? []) {
    if (source.segmentIds && !source.segmentIds.includes(segment.id)) continue
    ;(sourcesByDay[source.day] ??= []).push(source)
  }
  const presets = (state.presets ?? [])
    .map((preset, index) => ({ preset, index }))
    .filter(({ preset }) => preset.enabled !== false && (!preset.segmentIds || preset.segmentIds.includes(segment.id)))
    .sort((a, b) => (a.preset.priority ?? 0) - (b.preset.priority ?? 0) || a.index - b.index)
    .map(({ preset }) => preset)
  const supply = expectedSupply(segment, calendar)
  for (const type of CHEST_TYPES) supply[type] = supply[type].map((v) => v * supplyFactor)
  const prizes = prizeTable(state, segment)
  return {
    state,
    segment,
    calendar,
    days,
    ingredients,
    byId,
    blocker,
    pantryCap,
    basketOn: (day, type) => basketByDay[day]?.[type] ?? null,
    recipes: { main: recipesOf(state.dishes), rc: recipesOf(state.recompletionDishes) },
    thresholds,
    limit: (round, ingredientId, day) => {
      const t = thresholds[round]?.[ingredientId]
      return t ? thresholdLimitOn(t, day) : null
    },
    sourcesByDay,
    presets,
    supply,
    prizes,
    prizeOf: { main: Object.fromEntries(prizes.main.map((p) => [p.dishId, p.worth])), rc: Object.fromEntries(prizes.rc.map((p) => [p.dishId, p.worth])) },
    // Days on which every player's standing is written down (see `probes` in summarize).
    probeDays: probeDays && probeDays.length ? new Set(probeDays) : null,
    settings: state.settings ?? {},
  }
}

// How many baskets of each type the player opens on each day.
// A player opens whole baskets; what is typed is an expectation (0.4 Epic a
// day is 8.4 over 21 days). Neither mode rounds the rate: both keep the
// expected count of every day exactly, and a run reports expected and opened
// side by side.
//   'baskets'   the expected count runs up day by day (0.4, 0.8, 1.2 ...) and
//               a basket is opened each time the running total passes a whole
//               number - counted from a starting point of the player's own,
//               drawn evenly between 0 and 1. So with 0.4 a day every player
//               opens 8 or 9 baskets (9 for 4 players in 10: 8.4 on average),
//               about one every two or three days, and the players differ
//               only in which days. A fraction is never dropped.
//   'activity'  players also differ: a lasting multiplier of the player's own
//               (it averages 1), and days played or missed in streaks (a
//               two-state chain; on a played day the rate is divided by the
//               player's share of days played). The expected count of every
//               day is still exactly what was typed.
function openingPlan(world, seed, player, variation) {
  const plan = {}
  if (variation !== 'activity') {
    CHEST_TYPES.forEach((type, ti) => {
      const u = keyedRng(seed, player, K_OFFSET, ti)()
      let cum = 0
      let before = Math.floor(u)
      plan[type] = world.supply[type].map((expected) => {
        cum += expected
        const now = Math.floor(cum + u + 1e-9)
        const opens = now - before
        before = now
        return opens
      })
    })
    return plan
  }
  const a = world.settings.activity ?? {}
  const multMin = Number(a.multiplierMin ?? 0.4)
  const multMax = Math.max(multMin, Number(a.multiplierMax ?? 1.6))
  const shareMin = Math.min(1, Math.max(0.01, Number(a.activeShareMin ?? 0.55)))
  const shareMax = Math.min(1, Math.max(shareMin, Number(a.activeShareMax ?? 1)))
  const persistence = Math.min(0.99, Math.max(0, Number(a.persistence ?? 0.5)))
  const rng = keyedRng(seed, player, K_ACTIVITY)
  const mean = (multMin + multMax) / 2
  const multiplier = mean > 0 ? (multMin + rng() * (multMax - multMin)) / mean : 1
  const share = shareMin + rng() * (shareMax - shareMin)
  let active = rng() < share
  const stayActive = share + persistence * (1 - share)
  const stayInactive = 1 - share + persistence * share
  for (const type of CHEST_TYPES) plan[type] = []
  for (let d = 0; d < world.days; d += 1) {
    const today = active
    // (An inactive player comes back with what is left of "stays away" - the
    // older simulator used the stay-away chance itself here, so players came
    // back too often and opened about 11% more baskets than was typed.)
    const turn = rng()
    active = active ? turn < stayActive : turn >= stayInactive
    for (const type of CHEST_TYPES) {
      // (Drawn whatever the rate, so that typing another supply never moves the days of play.)
      const roll = rng()
      const rate = today ? (world.supply[type][d] * multiplier) / share : 0
      const whole = Math.floor(rate)
      plan[type].push(whole + (roll < rate - whole ? 1 : 0))
    }
  }
  return plan
}

const NOT_FU = { inFu: false, shortage: 0, waiting: false }

// One player through the whole event. `extraBaskets`: [{ id, day, chestType }]
// opened after the day's own baskets of that type (a what-if). `usePresets`:
// false plays the same event without the catch-up presets. `trace`: also
// return what happened, step by step.
export function simulatePlayer(world, { seed = 1, player = 0, variation = 'activity', usePresets = true, extraBaskets = [], trace = false } = {}) {
  const { settings, days } = world
  const policy = settings.thresholdPolicy ?? 'before-basket'
  const countAttempted = settings.thresholdCounts === 'attempted'
  const cookAtDelivery = (settings.cookTiming ?? 'delivery') === 'delivery'
  const prizeFirst = settings.cookOrder === 'prize-first'
  const plan = openingPlan(world, seed, player, variation)
  const engagement = keyedRng(seed, player, K_GRANT)()

  const zero = () => Object.fromEntries(world.ingredients.map((i) => [i.id, 0]))
  const inv = zero()
  const counter = { main: zero(), rc: zero() }
  const received = { main: zero(), rc: zero() }
  const attempted = { main: zero(), rc: zero() }
  const tot = { rolled: zero(), accepted: zero(), lost: zero(), consumed: zero(), withheld: zero(), special: zero(), bypassed: zero(), overshoot: zero() }
  const cooked = { main: new Set(), rc: new Set() }
  const dishDay = { main: {}, rc: {} }
  const worth = { main: 0, mainGrand: 0, rc: 0, rcGrand: 0 }
  const presetUses = {}
  const opened = { basic: 0, rare: 0, epic: 0 }
  let presetBaskets = 0
  let shortBaskets = 0
  let shortUnits = 0
  let round = world.recipes.main.length ? 'main' : world.recipes.rc.length ? 'rc' : 'done'
  let day = 0
  let firstFuDay = null
  let mainDoneDay = null
  let rcEntryDay = round === 'rc' ? 1 : null
  let rcFuDay = null
  let rcDoneDay = null
  let rcCookedAtEntry = 0
  let rcFuAtEntry = false
  let rcDoneAtEntry = false
  let firstCookDay = null
  let lastCookDay = 0
  let longestGap = 0
  const events = trace ? [] : null
  const log = (event) => events && events.push({ day, ...event })

  const roundKey = () => (round === 'main' ? 'main' : 'rc')
  const limitNow = (ingredientId) => world.limit(roundKey(), ingredientId, day)
  const heldBack = (ingredientId) => {
    const limit = limitNow(ingredientId)
    if (limit == null) return false
    return policy === 'before-basket-inclusive' ? counter[roundKey()][ingredientId] > limit : counter[roundKey()][ingredientId] >= limit
  }
  // What the dishes still to cook in the round need of an ingredient, beyond what is held.
  const missing = (ingredientId, rk = roundKey()) => {
    if (round === 'done') return 0
    let need = 0
    for (const dish of world.recipes[rk]) {
      if (cooked[rk].has(dish.id)) continue
      for (const r of dish.recipe) if (r.ingredientId === ingredientId) need += r.count
    }
    return Math.max(0, need - inv[ingredientId])
  }

  // Into the pantry: what fits is kept, the rest is lost. Counts toward the round's progression count.
  function receive(ingredientId, n, { bypass = false } = {}) {
    if (!(n > 0) || inv[ingredientId] === undefined) return { accepted: 0, lost: 0 }
    const cap = world.pantryCap[ingredientId]
    const accepted = cap == null ? n : Math.max(0, Math.min(n, cap - inv[ingredientId]))
    const lost = n - accepted
    const rk = roundKey()
    const before = counter[rk][ingredientId]
    const add = countAttempted ? n : accepted
    const limit = limitNow(ingredientId)
    inv[ingredientId] += accepted
    tot.rolled[ingredientId] += n
    tot.accepted[ingredientId] += accepted
    tot.lost[ingredientId] += lost
    counter[rk][ingredientId] = before + add
    received[rk][ingredientId] += accepted
    attempted[rk][ingredientId] += n
    if (limit != null && before + add > limit) {
      const over = before + add - Math.max(limit, before)
      if (bypass) tot.bypassed[ingredientId] += over
      else tot.overshoot[ingredientId] += over
    }
    return { accepted, lost }
  }

  function fuState(rk) {
    const list = world.recipes[rk]
    const done = cooked[rk]
    if (list.length === 0 || done.size !== list.length - 1) return NOT_FU
    const dish = list.find((d) => !done.has(d.id))
    if (dish.incomplete) return NOT_FU
    let shortage = 0
    let waiting = false
    for (const r of dish.recipe) {
      const miss = r.count - inv[r.ingredientId]
      if (!(miss > 0)) continue
      if (!world.blocker[r.ingredientId]) return NOT_FU
      shortage += miss
      const limit = world.limit(rk, r.ingredientId, day)
      if (limit == null || counter[rk][r.ingredientId] < limit) waiting = true
    }
    if (shortage === 0) return NOT_FU
    return { inFu: !waiting, shortage, waiting }
  }
  function checkFu() {
    if (round === 'main' && firstFuDay == null && fuState('main').inFu) {
      firstFuDay = day
      log({ kind: 'fu', round: 'main', shortage: fuState('main').shortage })
    }
    if (round === 'rc' && rcFuDay == null && fuState('rc').inFu) {
      rcFuDay = day
      log({ kind: 'fu', round: 'rc', shortage: fuState('rc').shortage })
    }
  }

  function cook() {
    let entered = false
    for (;;) {
      if (round === 'done') break
      const rk = round
      const list = world.recipes[rk]
      let pick = null
      let best = -Infinity
      for (const dish of list) {
        if (cooked[rk].has(dish.id) || dish.incomplete) continue
        if (!dish.recipe.every((r) => inv[r.ingredientId] >= r.count)) continue
        if (!prizeFirst) {
          pick = dish
          break
        }
        const prize = world.prizeOf[rk][dish.id] ?? 0
        if (prize > best) {
          best = prize
          pick = dish
        }
      }
      if (!pick) break
      for (const r of pick.recipe) {
        inv[r.ingredientId] -= r.count
        tot.consumed[r.ingredientId] += r.count
      }
      cooked[rk].add(pick.id)
      dishDay[rk][pick.id] = day
      const prize = world.prizeOf[rk][pick.id]
      worth[rk] += prize ?? 0
      if (rk === 'main') {
        if (firstCookDay == null) firstCookDay = day
        longestGap = Math.max(longestGap, day - lastCookDay - 1)
        lastCookDay = day
      } else if (entered) rcCookedAtEntry += 1
      log({ kind: 'cook', round: rk, dishId: pick.id, used: Object.fromEntries(pick.recipe.map((r) => [r.ingredientId, r.count])), prize: prize ?? null })
      if (rk === 'main' && cooked.main.size === list.length) {
        mainDoneDay = day
        worth.mainGrand = world.prizes.mainGrand.worth ?? 0
        log({ kind: 'main-done', prize: world.prizes.mainGrand.worth })
        if (world.recipes.rc.length) {
          round = 'rc'
          rcEntryDay = day
          entered = true
          log({ kind: 'rc-enter', pantry: { ...inv } })
        } else round = 'done'
      } else if (rk === 'rc' && cooked.rc.size === list.length) {
        rcDoneDay = day
        worth.rcGrand = world.prizes.rcGrand.worth ?? 0
        round = 'done'
        log({ kind: 'rc-done', prize: world.prizes.rcGrand.worth })
      }
    }
    if (entered) {
      rcDoneAtEntry = round === 'done'
      rcFuAtEntry = round === 'rc' && fuState('rc').inFu
    }
  }
  const afterDelivery = () => {
    if (cookAtDelivery) cook()
    checkFu()
  }

  // A special delivery of one ingredient. Without the permission to pass the
  // threshold it stops at the limit; what it could not give is `withheld`.
  function giveSpecial(ingredientId, amount, source) {
    let n = Math.max(0, Math.round(amount))
    let withheld = 0
    if (!source.bypassThreshold) {
      const limit = limitNow(ingredientId)
      if (limit != null) {
        withheld = Math.max(0, n - Math.max(0, limit - counter[roundKey()][ingredientId]))
        n -= withheld
      }
    }
    if (inv[ingredientId] === undefined) return { ingredientId, given: 0, accepted: 0, lost: 0, withheld: 0 }
    tot.withheld[ingredientId] += withheld
    tot.special[ingredientId] += n
    const { accepted, lost } = receive(ingredientId, n, { bypass: source.bypassThreshold })
    return { ingredientId, given: n, accepted, lost, withheld }
  }
  // Which three ingredients a joker is spent on (a modeling assumption, not observed play).
  function jokerPicks(source) {
    const rows = world.ingredients
      .filter((ing) => source.bypassThreshold || !heldBack(ing.id) || limitNow(ing.id) == null)
      .map((ing, order) => ({ id: ing.id, order, blocker: world.blocker[ing.id], missing: missing(ing.id) }))
    const picks = []
    if ((settings.jokerPolicy ?? 'blocker-then-deficit') === 'blocker-then-deficit') {
      const blocker = rows.filter((r) => r.blocker && r.missing > 0).sort((a, b) => b.missing - a.missing || a.order - b.order)[0]
      if (blocker) picks.push(blocker.id)
    }
    const rest = rows.filter((r) => !picks.includes(r.id)).sort((a, b) => b.missing - a.missing || Number(a.blocker) - Number(b.blocker) || a.order - b.order)
    for (const r of rest) {
      if (picks.length >= 3) break
      picks.push(r.id)
    }
    return picks
  }
  function deliverSource(source) {
    const coverage = (Number(source.coveragePct ?? 100) || 0) / 100
    const reached = settings.recipients === 'independent' ? keyedRng(seed, player, K_SOURCE, source.id)() < coverage : engagement < coverage
    if (!reached) return
    if (source.kind === 'joker') {
      const count = Math.max(0, Math.round(source.amount ?? 0))
      for (let j = 0; j < count; j += 1) {
        const picks = jokerPicks(source)
        const given = picks.map((id) => giveSpecial(id, world.blocker[id] ? (settings.jokerBlockerAmount ?? 1) : (settings.jokerAmount ?? 10), source))
        log({ kind: 'joker', sourceId: source.id, label: source.label, given })
        afterDelivery()
      }
      return
    }
    const given = giveSpecial(source.ingredientId, source.amount, source)
    log({ kind: 'source', sourceId: source.id, label: source.label, bypass: !!source.bypassThreshold, given: [given] })
    afterDelivery()
  }

  function presetFits(preset) {
    if (preset.round !== 'any' && preset.round !== round) return false
    if (round === 'done') return false
    if (day < (preset.startDay ?? 1) || day > (preset.endDay ?? days)) return false
    if (preset.maxUses != null && (presetUses[preset.id] ?? 0) >= preset.maxUses) return false
    const e = preset.eligibility ?? {}
    const rk = roundKey()
    const dishes = cooked[rk].size
    if (e.dishesMin != null && dishes < e.dishesMin) return false
    if (e.dishesMax != null && dishes > e.dishesMax) return false
    if (e.missingIngredientId && missing(e.missingIngredientId) < (e.missingMin ?? 1)) return false
    if (e.receiptsIngredientId && e.receiptsMax != null && counter[rk][e.receiptsIngredientId] > e.receiptsMax) return false
    return true
  }
  // Why a preset's contents cannot be given to this player now (null: they can).
  function presetConflict(contents, size) {
    if (!contents) return `it has no contents for a basket of ${size}`
    for (const [ingredientId, n] of Object.entries(contents)) {
      if (!(n > 0)) continue
      if (inv[ingredientId] === undefined) return 'it names an ingredient that no longer exists'
      const limit = limitNow(ingredientId)
      if (limit != null && counter[roundKey()][ingredientId] + n > limit) return `${world.byId[ingredientId]?.name ?? ingredientId} would pass its progression threshold`
      const cap = world.pantryCap[ingredientId]
      if (cap != null && inv[ingredientId] + n > cap) return `${world.byId[ingredientId]?.name ?? ingredientId} would not fit the pantry`
    }
    return null
  }

  function openBasket(type, typeIndex, index) {
    const basket = world.basketOn(day, type)
    if (!basket) {
      log({ kind: 'basket', chestType: type, missing: true })
      return
    }
    opened[type] += 1
    const span = Math.max(0, basket.totalMax - basket.totalMin)
    const size = basket.totalMin + Math.floor(keyedRng(seed, player, K_SIZE, day, typeIndex, index)() * (span + 1))
    let applied = null
    const skipped = []
    if (usePresets) {
      for (const preset of world.presets) {
        if (preset.chestType !== type || !presetFits(preset)) continue
        const fixed = preset.sizeMode === 'fixed'
        const contents = fixed ? preset.fixedContents : preset.allocations?.[size]
        const reason = presetConflict(contents, size)
        if (!reason) {
          applied = { preset, contents, size: fixed ? Object.values(contents).reduce((s, n) => s + (n > 0 ? n : 0), 0) : size }
          break
        }
        skipped.push({ presetId: preset.id, name: preset.name, reason })
        if (preset.fallback === 'ordinary') break
      }
    }
    const rolled = {}
    const excluded = []
    let short = 0
    if (applied) {
      for (const [ingredientId, n] of Object.entries(applied.contents)) if (n > 0) rolled[ingredientId] = n
      presetUses[applied.preset.id] = (presetUses[applied.preset.id] ?? 0) + 1
      presetBaskets += 1
    } else {
      const rk = roundKey()
      const rows = []
      const left = []
      for (const w of basket.ingredientWeights) {
        if (!(w.weight > 0) || !(w.max > 0) || inv[w.ingredientId] === undefined) continue
        if (heldBack(w.ingredientId)) {
          excluded.push(w.ingredientId)
          continue
        }
        let room = w.max
        if (policy === 'stop-at-threshold') {
          const limit = limitNow(w.ingredientId)
          if (limit != null) room = Math.min(room, limit - counter[rk][w.ingredientId])
        }
        if (room > 0) {
          rows.push(w)
          left.push(room)
        }
      }
      const rng = keyedRng(seed, player, K_PICK, day, typeIndex, index)
      let remaining = size
      // (At most `size` turns: a basket that runs out of room stops, it never loops.)
      while (remaining > 0) {
        let sum = 0
        for (let i = 0; i < rows.length; i += 1) if (left[i] > 0) sum += rows[i].weight
        if (!(sum > 0)) break
        let r = rng() * sum
        let chosen = -1
        for (let i = 0; i < rows.length; i += 1) {
          if (!(left[i] > 0)) continue
          chosen = i
          if (r < rows[i].weight) break
          r -= rows[i].weight
        }
        rolled[rows[chosen].ingredientId] = (rolled[rows[chosen].ingredientId] ?? 0) + 1
        left[chosen] -= 1
        remaining -= 1
      }
      short = remaining
      if (short > 0) {
        shortBaskets += 1
        shortUnits += short
      }
    }
    const accepted = {}
    const lost = {}
    for (const [ingredientId, n] of Object.entries(rolled)) {
      const got = receive(ingredientId, n)
      if (got.accepted) accepted[ingredientId] = got.accepted
      if (got.lost) lost[ingredientId] = got.lost
    }
    log({ kind: 'basket', chestType: type, size: applied ? applied.size : size, rolledSize: size, preset: applied ? { id: applied.preset.id, name: applied.preset.name } : null, skipped, rolled, accepted, lost, excluded, short })
    afterDelivery()
  }

  const snap = { dishes: new Uint8Array(days), state: new Uint8Array(days), fuShort: new Uint8Array(days), rcDishes: new Uint8Array(days) }
  const probes = world.probeDays ? {} : null
  log({ kind: 'start', pantry: { ...inv }, opens: plan })
  for (day = 1; day <= days; day += 1) {
    if (events) {
      for (const rk of ['main', 'rc']) {
        for (const t of Object.values(world.thresholds[rk])) {
          const step = (t.steps ?? []).find((s) => s.fromDay === day)
          if (step) log({ kind: 'threshold', round: rk, ingredientId: t.ingredientId, limit: step.limit })
        }
      }
    }
    for (const source of world.sourcesByDay[day] ?? []) deliverSource(source)
    CHEST_TYPES.forEach((type, ti) => {
      const count = plan[type][day - 1] ?? 0
      for (let i = 0; i < count; i += 1) openBasket(type, ti, i)
      for (const extra of extraBaskets) if (extra.day === day && extra.chestType === type) openBasket(type, ti, 100000 + (hashText(extra.id ?? 'extra') % 100000))
    })
    if (!cookAtDelivery) cook()
    checkFu()
    // The day as it ends. state: 1 in Main FU, 2 Main finished, +4 in Recompletion FU, +8 Recompletion finished.
    const d = day - 1
    snap.dishes[d] = cooked.main.size
    snap.rcDishes[d] = cooked.rc.size
    const mainFu = round === 'main' ? fuState('main') : NOT_FU
    const rcFu = round === 'rc' ? fuState('rc') : NOT_FU
    snap.state[d] = (mainFu.inFu ? 1 : 0) | (round !== 'main' && world.recipes.main.length ? 2 : 0) | (rcFu.inFu ? 4 : 0) | (rcDoneDay != null ? 8 : 0)
    snap.fuShort[d] = Math.min(255, mainFu.inFu ? mainFu.shortage : 0)
    // Where the player stands in the Main round as the day ends, and what the dishes left lack:
    //   finished | fu | waiting (one dish left, only blockers short, still below the threshold)
    //   | ordinary (one dish left, an ordinary ingredient short) | behind (more than one dish left)
    if (probes && world.probeDays.has(day)) {
      const reason = round !== 'main' ? 'finished' : mainFu.inFu ? 'fu' : mainFu.waiting ? 'waiting' : cooked.main.size === world.recipes.main.length - 1 ? 'ordinary' : 'behind'
      probes[day] = { reason, dishes: cooked.main.size, missing: round === 'main' ? Object.fromEntries(world.ingredients.map((i) => [i.id, missing(i.id, 'main')])) : null, received: { ...counter.main } }
    }
  }
  day = days
  longestGap = Math.max(longestGap, days - lastCookDay)

  // What the Main dishes still to cook lack, when the event ends.
  const missingAtEnd = {}
  if (cooked.main.size < world.recipes.main.length) for (const ing of world.ingredients) missingAtEnd[ing.id] = missing(ing.id, 'main')

  return {
    player,
    days: snap,
    mainDishes: cooked.main.size,
    rcDishes: cooked.rc.size,
    dishDay,
    firstCookDay,
    longestGap,
    firstFuDay,
    mainDoneDay,
    rcEntryDay,
    rcFuDay,
    rcDoneDay,
    rcCookedAtEntry,
    rcFuAtEntry,
    rcDoneAtEntry,
    pantry: inv,
    totals: tot,
    received,
    attempted,
    counter,
    missingAtEnd,
    opened,
    presetUses,
    presetBaskets,
    shortBaskets,
    shortUnits,
    worth,
    payout: worth.main + worth.mainGrand + worth.rc + worth.rcGrand,
    probes,
    events,
  }
}

function pct(sorted, p) {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}
const sortedNums = (values) => values.filter((v) => v != null).sort((a, b) => a - b)
const meanOf = (values) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0)

// What a segment's players did, as figures. Shares are of ALL the players
// played unless a field says otherwise; "among" figures name their group.
export function summarize(world, records, meta = {}) {
  const n = records.length
  const { days, state } = world
  const mainCount = world.recipes.main.length
  const rcCount = world.recipes.rc.length
  const share = (count) => (n > 0 ? count / n : 0)
  const targets = state.targets ?? {}

  const everFuBy = new Array(days).fill(0)
  const rcEnteredBy = new Array(days).fill(0)
  for (const r of records) {
    if (r.firstFuDay != null) for (let d = r.firstFuDay - 1; d < days; d += 1) everFuBy[d] += 1
    if (r.rcEntryDay != null) for (let d = r.rcEntryDay - 1; d < days; d += 1) rcEnteredBy[d] += 1
  }
  const dayRows = []
  for (let d = 0; d < days; d += 1) {
    const counts = new Array(mainCount + 1).fill(0)
    let inFu = 0
    let finished = 0
    let rcFu = 0
    let rcDone = 0
    let shortSum = 0
    const values = []
    for (const r of records) {
      const v = r.days.dishes[d]
      counts[Math.min(mainCount, v)] += 1
      values.push(v)
      const s = r.days.state[d]
      if (s & 1) {
        inFu += 1
        shortSum += r.days.fuShort[d]
      }
      if (s & 2) finished += 1
      if (s & 4) rcFu += 1
      if (s & 8) rcDone += 1
    }
    values.sort((a, b) => a - b)
    dayRows.push({
      day: d + 1,
      mean: meanOf(values),
      p10: pct(values, 0.1),
      p50: pct(values, 0.5),
      p90: pct(values, 0.9),
      dist: counts.map(share),
      inFu: share(inFu),
      everFu: share(everFuBy[d]),
      finished: share(finished),
      fuShortage: inFu ? shortSum / inFu : null,
      rcEntered: share(rcEnteredBy[d]),
      rcInFu: share(rcFu),
      rcDone: share(rcDone),
    })
  }
  const last = dayRows[days - 1]

  const fuDay = targets.mainFuDay
  const fuTarget =
    fuDay != null && fuDay >= 1 && fuDay <= days
      ? (() => {
          const row = dayRows[fuDay - 1]
          const targetShare = (Number(targets.mainFuSharePct ?? 80) || 0) / 100
          return { day: fuDay, target: targetShare, inFu: row.inFu, everFu: row.everFu, finished: row.finished, before: Math.max(0, 1 - row.finished - row.inFu), shortage: row.fuShortage, met: row.inFu >= targetShare }
        })()
      : null
  const checkpoints = (targets.checkpoints ?? [])
    .filter((c) => c.day >= 1 && c.day <= days)
    .map((c) => {
      const reached = records.filter((r) => r.days.dishes[c.day - 1] >= c.dishes).length
      const targetShare = (Number(c.sharePct ?? 80) || 0) / 100
      return { id: c.id, day: c.day, dishes: c.dishes, target: targetShare, share: share(reached), met: share(reached) >= targetShare }
    })

  const dishStats = (rk, list) =>
    list.map((dish) => {
      const when = sortedNums(records.map((r) => r.dishDay[rk][dish.id]))
      return { dishId: dish.id, share: share(when.length), p10: pct(when, 0.1), p50: pct(when, 0.5), p90: pct(when, 0.9) }
    })
  const finishDays = sortedNums(records.map((r) => r.mainDoneDay))
  const firstCook = sortedNums(records.map((r) => r.firstCookDay))
  const gaps = sortedNums(records.map((r) => r.longestGap))
  const fuDays = sortedNums(records.map((r) => r.firstFuDay))
  const rcEntry = sortedNums(records.map((r) => r.rcEntryDay))
  const rcFuAfter = sortedNums(records.map((r) => (r.rcFuDay != null && r.rcEntryDay != null ? r.rcFuDay - r.rcEntryDay : null)))
  const rcDoneAfter = sortedNums(records.map((r) => (r.rcDoneDay != null && r.rcEntryDay != null ? r.rcDoneDay - r.rcEntryDay : null)))

  const unfinished = records.filter((r) => r.mainDishes < mainCount)
  const ingredients = world.ingredients.map((ing) => {
    const id = ing.id
    const lacking = unfinished.filter((r) => (r.missingAtEnd[id] ?? 0) > 0)
    return {
      id,
      rolled: meanOf(records.map((r) => r.totals.rolled[id])),
      accepted: meanOf(records.map((r) => r.totals.accepted[id])),
      lost: meanOf(records.map((r) => r.totals.lost[id])),
      lostShare: share(records.filter((r) => r.totals.lost[id] > 0).length),
      consumed: meanOf(records.map((r) => r.totals.consumed[id])),
      onHand: meanOf(records.map((r) => r.pantry[id])),
      special: meanOf(records.map((r) => r.totals.special[id])),
      withheld: meanOf(records.map((r) => r.totals.withheld[id])),
      overshootShare: share(records.filter((r) => r.totals.overshoot[id] > 0).length),
      overshootMax: records.reduce((m, r) => Math.max(m, r.totals.overshoot[id]), 0),
      // Among the players who did not finish the Main round:
      missingShare: unfinished.length ? lacking.length / unfinished.length : 0,
      missingMean: lacking.length ? meanOf(lacking.map((r) => r.missingAtEnd[id])) : 0,
    }
  })

  const payouts = sortedNums(records.map((r) => r.payout))
  const affected = records.filter((r) => r.presetBaskets > 0)
  // The probe days: why players are where they are, and what they lack. Shares are of all the players.
  const probes = {}
  for (const probeDay of world.probeDays ?? []) {
    const rows = records.map((r) => r.probes?.[probeDay]).filter(Boolean)
    const reasons = { finished: 0, fu: 0, waiting: 0, ordinary: 0, behind: 0 }
    for (const row of rows) reasons[row.reason] += 1 / Math.max(1, rows.length)
    probes[probeDay] = {
      reasons,
      lack: world.ingredients.map((ing) => {
        const lacking = rows.filter((row) => row.missing && row.missing[ing.id] > 0)
        const got = rows.map((row) => row.received[ing.id]).sort((a, b) => a - b)
        // `belowLimit`: still in the Main round and counted below the threshold in force that day.
        const limit = world.limit('main', ing.id, probeDay)
        const below = limit == null ? 0 : rows.filter((row) => row.missing && row.received[ing.id] < limit).length
        return { id: ing.id, share: share(lacking.length), mean: lacking.length ? meanOf(lacking.map((row) => row.missing[ing.id])) : 0, receivedLow: pct(got, 0.2) ?? 0, receivedMid: pct(got, 0.5) ?? 0, limit, belowLimit: share(below) }
      }),
    }
  }
  // Dish Master: the players who had cooked every Dish Master dish by its last day. The dishes are the ones picked in
  // step 1 (`dishMaster.dishIds`; economist: "i want to be able to ... pick the dishes for the dish master"); none
  // picked: every Main dish that needs a semi-blocker.
  const dm = world.calendar?.dishMaster
  const semiIds = new Set(world.ingredients.filter((i) => i.rarity === 'semi-blocker').map((i) => i.id))
  const picked = new Set(dm?.dishIds ?? [])
  const semiDishes = picked.size ? world.recipes.main.filter((d) => picked.has(d.id)) : world.recipes.main.filter((d) => d.recipe.some((r) => semiIds.has(r.ingredientId)))
  // (Measured, never targeted unless the economist types a limit: before it opens, during it, after it.)
  const semiDays = (r) => semiDishes.map((d) => r.dishDay.main[d.id] ?? null)
  const dishMaster =
    dm?.endDay != null && semiDishes.length
      ? {
          startDay: dm.startDay ?? null,
          endDay: dm.endDay,
          dishes: semiDishes.length,
          picked: picked.size > 0,
          allShare: share(records.filter((r) => semiDays(r).every((d) => d != null && d <= dm.endDay)).length),
          // Cooked at least one of them before Dish Master began, and how many on average.
          earlyShare: dm.startDay != null ? share(records.filter((r) => semiDays(r).some((d) => d != null && d < dm.startDay)).length) : null,
          earlyMean: dm.startDay != null ? meanOf(records.map((r) => semiDays(r).filter((d) => d != null && d < dm.startDay).length)) : null,
          // How many by its last day, and all of them by the end of the event.
          byEndMean: meanOf(records.map((r) => semiDays(r).filter((d) => d != null && d <= dm.endDay).length)),
          allByEventShare: share(records.filter((r) => semiDays(r).every((d) => d != null)).length),
          // Cooked at least one of them after Dish Master ended (the catch-up once supply opens).
          afterShare: share(records.filter((r) => semiDays(r).some((d) => d != null && d > dm.endDay)).length),
        }
      : null
  const gapLimit = meta.gapLimit ?? null
  const rcFuWithin = meta.rcFuWithin ?? null
  const entrants = records.filter((r) => r.rcEntryDay != null)
  return {
    meta: { engine: ENGINE_VERSION, players: n, segmentId: world.segment.id, ...meta },
    mainCount,
    rcCount,
    days: dayRows,
    fuTarget,
    checkpoints,
    finish: { share: last?.finished ?? 0, unfinishedShare: 1 - (last?.finished ?? 0), p10: pct(finishDays, 0.1), p50: pct(finishDays, 0.5), p90: pct(finishDays, 0.9) },
    fu: { everShare: share(fuDays.length), p50: pct(fuDays, 0.5), inAtEnd: last?.inFu ?? 0 },
    firstCook: { p10: pct(firstCook, 0.1), p50: pct(firstCook, 0.5), p90: pct(firstCook, 0.9), neverShare: share(n - firstCook.length) },
    gap: { p50: pct(gaps, 0.5), p90: pct(gaps, 0.9), limit: gapLimit, overShare: gapLimit == null ? null : share(records.filter((r) => r.longestGap > gapLimit).length) },
    probes,
    dishMaster,
    dishes: { main: dishStats('main', world.recipes.main), rc: dishStats('rc', world.recipes.rc) },
    rc: {
      enteredShare: share(rcEntry.length),
      entryP10: pct(rcEntry, 0.1),
      entryP50: pct(rcEntry, 0.5),
      entryP90: pct(rcEntry, 0.9),
      fuEverShare: share(records.filter((r) => r.rcFuDay != null).length),
      daysToFuP50: pct(rcFuAfter, 0.5),
      daysToFuP90: pct(rcFuAfter, 0.9),
      doneShare: share(records.filter((r) => r.rcDoneDay != null).length),
      daysToDoneP50: pct(rcDoneAfter, 0.5),
      // Among the players who ENTER Recompletion (`entrants` of them): in its FU within so many days of entering.
      entrants: entrants.length,
      fuWithinDays: rcFuWithin,
      fuWithinShare: rcFuWithin == null || entrants.length === 0 ? null : entrants.filter((r) => r.rcFuDay != null && r.rcFuDay - r.rcEntryDay <= rcFuWithin).length / entrants.length,
      // Straight from the pantry carried over, before another basket is opened:
      cookedAtEntryShare: share(records.filter((r) => r.rcCookedAtEntry > 0).length),
      fuAtEntryShare: share(records.filter((r) => r.rcFuAtEntry).length),
      doneAtEntryShare: share(records.filter((r) => r.rcDoneAtEntry).length),
    },
    unfinishedCount: unfinished.length,
    ingredients,
    supply: {
      expected: Object.fromEntries(CHEST_TYPES.map((type) => [type, world.supply[type].reduce((s, v) => s + v, 0)])),
      opened: Object.fromEntries(CHEST_TYPES.map((type) => [type, meanOf(records.map((r) => r.opened[type]))])),
    },
    baskets: { shortMean: meanOf(records.map((r) => r.shortBaskets)), shortUnitsMean: meanOf(records.map((r) => r.shortUnits)), shortShare: share(records.filter((r) => r.shortBaskets > 0).length) },
    payout: {
      mean: meanOf(payouts),
      p10: pct(payouts, 0.1),
      p50: pct(payouts, 0.5),
      p90: pct(payouts, 0.9),
      mainDishes: meanOf(records.map((r) => r.worth.main)),
      mainGrand: meanOf(records.map((r) => r.worth.mainGrand)),
      rcDishes: meanOf(records.map((r) => r.worth.rc)),
      rcGrand: meanOf(records.map((r) => r.worth.rcGrand)),
      complete: world.prizes.complete,
      missing: world.prizes.missing,
    },
    presets: {
      affectedShare: share(affected.length),
      basketsMean: meanOf(records.map((r) => r.presetBaskets)),
      // The presets a build-03 suggestion added (`origin: 'build-03'`): the players who got at least one of their
      // baskets, and how many such baskets a player got. A reading; nothing is played differently.
      suggestedShare: share(records.filter((r) => world.presets.some((p) => p.origin === 'build-03' && (r.presetUses[p.id] ?? 0) > 0)).length),
      suggestedBasketsMean: meanOf(records.map((r) => world.presets.reduce((s, p) => s + (p.origin === 'build-03' ? (r.presetUses[p.id] ?? 0) : 0), 0))),
      byPreset: world.presets.map((p) => ({ id: p.id, name: p.name, playersShare: share(records.filter((r) => (r.presetUses[p.id] ?? 0) > 0).length), usesMean: meanOf(records.map((r) => r.presetUses[p.id] ?? 0)) })),
    },
  }
}

const runOptions = (opts) => ({ seed: opts.seed, variation: opts.variation ?? 'activity', usePresets: opts.usePresets !== false, extraBaskets: opts.extraBaskets ?? [] })
const metaOf = (opts, seed) => ({ seed, variation: opts.variation ?? 'activity', usePresets: opts.usePresets !== false, supplyFactor: opts.supplyFactor ?? 1, ...(opts.gapLimit != null ? { gapLimit: opts.gapLimit } : {}), ...(opts.rcFuWithin != null ? { rcFuWithin: opts.rcFuWithin } : {}) })

// A segment played by `players` players. `seed`: the same number plays the same players again.
export function simulateSegment(state, segment, opts = {}) {
  const seed = opts.seed ?? randomSeed()
  const world = prepareWorld(state, segment, { supplyFactor: opts.supplyFactor ?? 1, probeDays: opts.probeDays ?? null })
  const records = []
  for (let i = 0; i < (opts.players ?? 300); i += 1) records.push(simulatePlayer(world, { ...runOptions({ ...opts, seed }), player: i }))
  const result = summarize(world, records, metaOf(opts, seed))
  return opts.keepRecords ? { ...result, records } : result
}

// The same, a few players at a time with a pause between, so a long run does not freeze the page.
export async function simulateSegmentAsync(state, segment, opts = {}, onProgress = null) {
  const seed = opts.seed ?? randomSeed()
  const players = opts.players ?? 300
  const world = prepareWorld(state, segment, { supplyFactor: opts.supplyFactor ?? 1, probeDays: opts.probeDays ?? null })
  const records = []
  const chunk = opts.chunk ?? 60
  for (let i = 0; i < players; i += 1) {
    records.push(simulatePlayer(world, { ...runOptions({ ...opts, seed }), player: i }))
    if ((i + 1) % chunk === 0) {
      onProgress?.((i + 1) / players)
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (opts.isCancelled?.()) return null
    }
  }
  const result = summarize(world, records, metaOf(opts, seed))
  return opts.keepRecords ? { ...result, records } : result
}

// One player's story, step by step.
export function tracePlayer(state, segment, opts = {}) {
  const world = prepareWorld(state, segment, { supplyFactor: opts.supplyFactor ?? 1 })
  return simulatePlayer(world, { ...runOptions(opts), player: opts.player ?? 0, trace: true })
}

// THE SAME PLAYERS, TWICE: once as `base` says and once as `changed` says.
// Each player is compared with themself, so the difference is what the change
// did and nothing else (see the keyed streams).
export function comparePaired(state, segment, base, changed, opts = {}) {
  const seed = opts.seed ?? randomSeed()
  const players = opts.players ?? 300
  const a = simulateSegment(base.state ?? state, segment, { ...opts, ...base, state: undefined, seed, players, keepRecords: true })
  const b = simulateSegment(changed.state ?? state, segment, { ...opts, ...changed, state: undefined, seed, players, keepRecords: true })
  const fuDay = state.targets?.mainFuDay
  let payoutDelta = 0
  let changedPlayers = 0
  let dishesDelta = 0
  for (let i = 0; i < players; i += 1) {
    const d = b.records[i].payout - a.records[i].payout
    payoutDelta += d
    dishesDelta += b.records[i].mainDishes + b.records[i].rcDishes - a.records[i].mainDishes - a.records[i].rcDishes
    if (d !== 0 || b.records[i].mainDishes !== a.records[i].mainDishes || b.records[i].rcDishes !== a.records[i].rcDishes) changedPlayers += 1
  }
  const identical = JSON.stringify(a.records.map((r) => [r.payout, r.mainDishes, r.rcDishes, r.pantry, r.totals])) === JSON.stringify(b.records.map((r) => [r.payout, r.mainDishes, r.rcDishes, r.pantry, r.totals]))
  const finishedBy = (result, dayNumber) => (dayNumber != null && dayNumber >= 1 && dayNumber <= result.days.length ? result.days[dayNumber - 1].finished : null)
  const strip = ({ records: _records, ...rest }) => rest
  return {
    seed,
    players,
    base: strip(a),
    changed: strip(b),
    identical,
    payoutDelta: payoutDelta / players,
    dishesDelta: dishesDelta / players,
    changedShare: changedPlayers / players,
    // Players who had already finished the Main round on the day the segment should be sitting in FU.
    finishedByFuDay: { base: finishedBy(a, fuDay), changed: finishedBy(b, fuDay) },
  }
}

// One more basket of a type on a day: the same players with and without it.
export function oneMoreBasket(state, segment, { chestType, day, ...opts }) {
  return comparePaired(state, segment, {}, { extraBaskets: [{ id: 'one-more', day, chestType }] }, opts)
}

// The event with and without its catch-up presets.
export function comparePresets(state, segment, opts = {}) {
  return comparePaired(state, segment, { usePresets: false }, { usePresets: true }, opts)
}

// More or fewer baskets than typed: every type by the same share.
export function supplySweep(state, segment, { deltas = [-30, -20, -10, 0, 10, 20, 30], players = 150, seed, variation } = {}) {
  const used = seed ?? randomSeed()
  return deltas.map((delta) => {
    const result = simulateSegment(state, segment, { players, seed: used, variation, supplyFactor: 1 + delta / 100 })
    const last = result.days[result.days.length - 1]
    return { delta, medianDishes: last.p50, meanDishes: last.mean, finished: last.finished, mainCount: result.mainCount }
  })
}

// A short fingerprint of a chef: what a run was played on. Only what is PLAYED
// counts - ticking an item of the readiness list, or the notes a chef carries,
// does not make a run out of date.
export function fingerprint(state) {
  const { confirmed: _confirmed, migration: _migration, reference: _reference, synthetic: _synthetic, generator: _generator, segmentsBefore: _segmentsBefore, ...played } = state
  return hashText(JSON.stringify(played)).toString(36)
}
