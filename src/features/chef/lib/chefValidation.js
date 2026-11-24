// The checks on a chef: a plain list of { severity, area, step, message,
// entityId }.
//   'block'   ("Needs a fix")   the event cannot be played as typed, or a rule
//             cannot be met: a reference to nothing, guaranteed contents that
//             can never be given, a schedule out of order.
//   'review'  ("Worth a look")  playable, but probably not what was meant, or
//             something the model does not play (a basket minimum above 0).
//   'info'    ("Good to know")  background, no action implied.
// `step` is the step of the flow that puts the finding right. Messages use
// the names on screen, never an internal id unless the thing is gone.
import { CHEST_LABELS, CHEST_TYPES, RARITY, RARITY_LABELS, REWARD_KEYS, ROUND_LABELS, phaseDayRange, thresholdLimitOn } from './chefModel'

const STEP_OF_AREA = {
  Baskets: 'baskets',
  Thresholds: 'baskets',
  Sources: 'baskets',
  Presets: 'baskets',
  Dishes: 'dishes',
  'Recompletion dishes': 'dishes',
  Ingredients: 'dishes',
  Prizes: 'dishes',
  Calendar: 'event',
  Segments: 'event',
  Targets: 'event',
}
const finding = (severity, area, message, entityId = null, step = STEP_OF_AREA[area] ?? 'event') => ({ severity, area, step, message, entityId })
const sum = (list) => list.reduce((s, v) => s + v, 0)

export function validateChefConfig(state) {
  const { ingredients = [], dishes = [], recompletionDishes = [], baskets = [], calendar, segments = [], thresholds = [], sources = [], presets = [], targets = {}, rewards = {} } = state
  const findings = []
  const add = (...args) => findings.push(finding(...args))
  const ingredientIds = new Set(ingredients.map((i) => i.id))
  const byId = Object.fromEntries(ingredients.map((i) => [i.id, i]))
  const nameOf = (id) => byId[id]?.name ?? `"${id}"`
  const phaseLabel = (phaseId) => calendar.phases.find((p) => p.id === phaseId)?.label ?? `"${phaseId}"`
  const basketName = (basket) => `${CHEST_LABELS[basket.chestType] ?? basket.chestType} basket, ${phaseLabel(basket.phaseId)}`
  const days = calendar.totalDays
  const segmentIds = new Set(segments.map((s) => s.id))
  const limited = new Set(thresholds.filter((t) => (t.steps ?? []).some((s) => s.limit != null)).map((t) => t.ingredientId))

  // --- Baskets ---
  for (const basket of baskets) {
    const name = basketName(basket)
    if (basket.totalMin < 0 || basket.totalMax < 0 || basket.totalMin > basket.totalMax) {
      add('block', 'Baskets', `${name}: it gives from ${basket.totalMin} to ${basket.totalMax} ingredients - the smallest number is above the largest, or one is below zero.`, basket.id)
    }
    const positive = basket.ingredientWeights.filter((w) => w.weight > 0 && ingredientIds.has(w.ingredientId))
    if (positive.length === 0) {
      add('block', 'Baskets', `${name}: no ingredient has a weight above 0, so this basket never gives anything.`, basket.id)
    } else {
      const room = sum(positive.map((w) => w.max))
      if (basket.totalMax > room) {
        add('block', 'Baskets', `${name}: it is set to give up to ${basket.totalMax} ingredients, but what each ingredient may give in one basket adds up to ${room} - it can never give that many.`, basket.id)
      } else {
        // Every ingredient with a progression threshold can be held back at the same time.
        const held = positive.filter((w) => limited.has(w.ingredientId))
        const roomWhenHeld = sum(positive.filter((w) => !limited.has(w.ingredientId)).map((w) => w.max))
        if (held.length && basket.totalMax > roomWhenHeld) {
          add(
            'review',
            'Baskets',
            `${name}: when ${held.map((w) => nameOf(w.ingredientId)).join(' and ')} ${held.length === 1 ? 'is' : 'are'} held back by ${held.length === 1 ? 'its threshold' : 'their thresholds'}, the other ingredients have room for ${roomWhenHeld} - fewer than the ${basket.totalMax} it can roll. Such a basket comes up short; the simulation counts them.`,
            basket.id,
          )
        }
      }
    }
    for (const w of basket.ingredientWeights) {
      if (!ingredientIds.has(w.ingredientId)) add('block', 'Baskets', `${name}: one of its rows is an ingredient that no longer exists ("${w.ingredientId}").`, basket.id)
      if (w.weight < 0 || w.max < 0) add('block', 'Baskets', `${name}: ${nameOf(w.ingredientId)} has a weight or a most-per-basket below zero.`, basket.id)
      if ((w.min ?? 0) > 0) add('review', 'Baskets', `${name}: ${nameOf(w.ingredientId)} has a minimum of ${w.min} a basket. What a minimum above 0 does in the game is not known, so it is kept and not played.`, basket.id)
    }
  }
  for (const phase of calendar.phases) {
    for (const chestType of CHEST_TYPES) {
      if (!baskets.some((b) => b.phaseId === phase.id && b.chestType === chestType)) add('block', 'Baskets', `No ${CHEST_LABELS[chestType]} basket is set for ${phase.label}: a player who opens one in those days gets nothing.`)
    }
  }

  // --- Recipes ---
  function validateDishList(list, label) {
    const recompletion = label !== 'Dishes'
    const dishName = (dish) => `"${dish.name}"${recompletion ? ' (Recompletion)' : ''}`
    for (const dish of list) {
      if (dish.recipe.length === 0) add('review', label, `${dishName(dish)} needs no ingredients at all.`, dish.id)
      for (const r of dish.recipe) {
        if (!ingredientIds.has(r.ingredientId)) add('block', label, `${dishName(dish)} needs an ingredient that no longer exists ("${r.ingredientId}").`, dish.id)
        if (r.count == null) findings.push({ ...finding('block', label, `${dishName(dish)} has no quantity yet for ${nameOf(r.ingredientId)}: type one, or let a proposal generate it (step 4). Until then the dish cannot be cooked.`, dish.id), code: 'blank-quantity' })
        else if (r.count <= 0) add('block', label, `${dishName(dish)} needs zero or fewer of ${nameOf(r.ingredientId)}.`, dish.id)
      }
      for (const [segmentId, own] of Object.entries(dish.blockerBySegment ?? {})) {
        for (const [ingredientId, count] of Object.entries(own ?? {})) {
          if (count != null && (!Number.isInteger(count) || count < 0)) add('block', label, `${dishName(dish)}: the ${nameOf(ingredientId)} typed for ${segments.find((s) => s.id === segmentId)?.name ?? 'a segment'} is not a whole number of 0 or more.`, dish.id)
        }
      }
    }
  }
  validateDishList(dishes, 'Dishes')
  validateDishList(recompletionDishes, 'Recompletion dishes')
  if (dishes.length && dishes.length !== 12) add('info', 'Dishes', `The Main round has ${dishes.length} dishes; the event is designed around 12.`)
  if (recompletionDishes.length && recompletionDishes.length !== 3) add('review', 'Recompletion dishes', `Recompletion has ${recompletionDishes.length} dishes; the rule is three new dishes.`)
  const usedBy = (list, id) => list.filter((d) => d.recipe.some((r) => r.ingredientId === id)).length
  for (const ing of ingredients) {
    const inMain = usedBy(dishes, ing.id)
    if (ing.rarity === RARITY.BLOCKER && dishes.length && inMain !== 2) add('info', 'Dishes', `${ing.name} (blocker) is in ${inMain} Main ${inMain === 1 ? 'dish' : 'dishes'}; the design has the blocker in two.`, ing.id)
    if (ing.rarity === RARITY.SEMI_BLOCKER && dishes.length && inMain !== 3) add('info', 'Dishes', `${ing.name} (semi-blocker) is in ${inMain} Main ${inMain === 1 ? 'dish' : 'dishes'}; the design has the semi-blocker in three.`, ing.id)
    if (ing.pantryCap != null && ing.pantryCap < 0) add('block', 'Ingredients', `${ing.name}: the pantry cap is below zero.`, ing.id)
    if (ing.pantryCap != null) {
      const most = Math.max(0, ...[...dishes, ...recompletionDishes].map((d) => d.recipe.find((r) => r.ingredientId === ing.id)?.count ?? 0))
      if (most > ing.pantryCap) add('block', 'Ingredients', `${ing.name}: a dish needs ${most} of it, more than the pantry can hold (${ing.pantryCap}) - that dish can never be cooked.`, ing.id)
    }
  }
  const used = new Set([...dishes, ...recompletionDishes].flatMap((d) => d.recipe.map((r) => r.ingredientId)))
  const inBaskets = new Set(baskets.flatMap((b) => b.ingredientWeights.filter((w) => w.weight > 0).map((w) => w.ingredientId)))
  for (const ing of ingredients) {
    if (!used.has(ing.id) && !inBaskets.has(ing.id)) add('review', 'Ingredients', `"${ing.name}" is needed by no dish and given by no basket.`, ing.id)
    else if (!used.has(ing.id)) add('info', 'Ingredients', `"${ing.name}" comes out of baskets, but no dish needs it yet.`, ing.id)
  }

  // --- Prizes ---
  const noPrize = (list) => list.filter((d) => !(d.reward && REWARD_KEYS.some((k) => d.reward[k] != null)) && d.legacyWorth == null)
  if (dishes.length && noPrize(dishes).length) add('review', 'Prizes', `${noPrize(dishes).length} of the ${dishes.length} dishes have no prize: what they pay is unknown, and a payout that counts them is incomplete.`)
  if (recompletionDishes.length && noPrize(recompletionDishes).length) add('info', 'Prizes', `${noPrize(recompletionDishes).length} of the ${recompletionDishes.length} Recompletion dishes have no prize: what Recompletion pays is unknown, not zero.`)
  if (dishes.length && !rewards.grandPrize?.main) add('review', 'Prizes', 'The Main round has no grand prize: its worth is unknown.')
  for (const key of REWARD_KEYS) {
    const value = rewards.values?.[key]
    if (value == null || !Number.isFinite(Number(value)) || Number(value) < 0) add('block', 'Prizes', `The value table has no usable value for ${key}.`)
  }

  // --- Calendar and targets ---
  const phaseDays = sum(calendar.phases.map((p) => p.days))
  if (phaseDays !== days) add('block', 'Calendar', `The phases add up to ${phaseDays} days, but the event runs ${days} days.`)
  for (const phase of calendar.phases) if (phase.days <= 0) add('block', 'Calendar', `"${phase.label}" has no days.`, phase.id)
  const dm = calendar.dishMaster ?? {}
  if ((dm.startDay == null) !== (dm.endDay == null)) add('review', 'Calendar', 'The Dish Master has only one of its two days set.')
  if (dm.startDay != null && dm.endDay != null && (dm.startDay < 1 || dm.endDay > days || dm.startDay > dm.endDay)) add('block', 'Calendar', `The Dish Master runs from day ${dm.startDay} to day ${dm.endDay}, which is not inside the event's ${days} days in that order.`)
  // The Dish Master dishes (picked in step 1; the rule is three, each with the semi-blocker).
  {
    const semiIds = new Set((state.ingredients ?? []).filter((i) => i.rarity === 'semi-blocker').map((i) => i.id))
    const semiDishes = dishes.filter((d) => d.recipe.some((r) => semiIds.has(r.ingredientId)))
    const picked = dm.dishIds ?? []
    const gone = picked.filter((id) => !dishes.some((d) => d.id === id))
    const noSemi = dishes.filter((d) => picked.includes(d.id) && !d.recipe.some((r) => semiIds.has(r.ingredientId)))
    if (gone.length) add('review', 'Calendar', `${gone.length === 1 ? 'A dish picked for the Dish Master is' : `${gone.length} dishes picked for the Dish Master are`} no longer in the Main round.`)
    if (noSemi.length) add('review', 'Calendar', `${noSemi.map((d) => d.name).join(', ')} ${noSemi.length === 1 ? 'is' : 'are'} picked for the Dish Master but ${noSemi.length === 1 ? 'needs' : 'need'} no semi-blocker.`)
    if (picked.length && picked.length - gone.length !== 3) add('review', 'Calendar', `${picked.length - gone.length} ${picked.length - gone.length === 1 ? 'dish is' : 'dishes are'} picked for the Dish Master; the rule is three.`)
    if (!picked.length && semiDishes.length && semiDishes.length !== 3) add('review', 'Calendar', `The semi-blocker is in ${semiDishes.length} Main dishes and no Dish Master dishes are picked, so all ${semiDishes.length} are read as the Dish Master's. The rule is three: pick them in step 1.`)
  }
  if (targets.mainFuDay != null && (targets.mainFuDay < 1 || targets.mainFuDay > days)) add('block', 'Targets', `The FU target is set for day ${targets.mainFuDay}, outside the event's ${days} days.`)
  if (targets.mainFuDay == null && dishes.length) add('info', 'Targets', 'No day is set for the FU target, so no segment is measured against it.')
  for (const c of targets.checkpoints ?? []) {
    if (c.day < 1 || c.day > days) add('block', 'Targets', `A checkpoint is set for day ${c.day}, outside the event's ${days} days.`, c.id)
    if (c.dishes < 1 || c.dishes > dishes.length) add('block', 'Targets', `A checkpoint asks for ${c.dishes} dishes; the Main round has ${dishes.length}.`, c.id)
  }

  // --- Segments ---
  for (const segment of segments) {
    if (!(Number(segment.effortFactor) > 0)) add('block', 'Segments', `"${segment.name}": the effort factor has to be above zero.`, segment.id)
    if (!(Number(segment.prizeFactor) > 0) || !(Number(segment.burnout) > 0)) add('block', 'Segments', `"${segment.name}": the prize factor and the burnout have to be above zero.`, segment.id)
    const supply = segment.supply ?? {}
    for (const type of CHEST_TYPES) {
      if ((supply.average?.[type] ?? 0) < 0) add('block', 'Segments', `"${segment.name}" opens fewer than zero ${CHEST_LABELS[type]} baskets a day.`, segment.id)
      if (supply.mode === 'daily' && (supply.daily?.[type] ?? []).some((v) => v < 0)) add('block', 'Segments', `"${segment.name}": a day has fewer than zero ${CHEST_LABELS[type]} baskets.`, segment.id)
    }
    if (supply.mode === 'daily' && CHEST_TYPES.some((type) => (supply.daily?.[type]?.length ?? 0) !== days)) add('review', 'Segments', `"${segment.name}": the baskets typed day by day do not cover the event's ${days} days; a day with nothing typed counts as none.`, segment.id)
    if (segment.brutWinsMin != null && segment.brutWinsMax != null && segment.brutWinsMin > segment.brutWinsMax) add('review', 'Segments', `"${segment.name}": the Brut Wins range runs from ${segment.brutWinsMin} to ${segment.brutWinsMax}.`, segment.id)
  }

  // --- Progression thresholds ---
  const seen = new Set()
  for (const t of thresholds) {
    const what = `${nameOf(t.ingredientId)}, ${ROUND_LABELS[t.round] ?? t.round}`
    if (!ingredientIds.has(t.ingredientId)) add('block', 'Thresholds', `A progression threshold is for an ingredient that no longer exists ("${t.ingredientId}").`, t.id)
    const key = `${t.round}|${t.ingredientId}`
    if (seen.has(key)) add('block', 'Thresholds', `${what}: there are two schedules for it; only the last one is played.`, t.id)
    seen.add(key)
    const steps = t.steps ?? []
    if (steps.length === 0) add('review', 'Thresholds', `${what}: the schedule has no step, so it restricts nothing.`, t.id)
    steps.forEach((step, i) => {
      if (step.fromDay < 1 || step.fromDay > days) add('block', 'Thresholds', `${what}: a step starts on day ${step.fromDay}, outside the event's ${days} days.`, t.id)
      if (step.limit != null && step.limit < 0) add('block', 'Thresholds', `${what}: a limit is below zero.`, t.id)
      if (i > 0 && step.fromDay <= steps[i - 1].fromDay) add('block', 'Thresholds', `${what}: the steps are not in the order of their days (day ${steps[i - 1].fromDay}, then day ${step.fromDay}).`, t.id)
      if (i > 0 && step.limit != null && steps[i - 1].limit != null && step.limit < steps[i - 1].limit) add('review', 'Thresholds', `${what}: the limit goes down on day ${step.fromDay} (${steps[i - 1].limit} to ${step.limit}). A player already above it gets no more.`, t.id)
    })
  }
  // The blocker: what its Main threshold leaves the last dish short of.
  for (const ing of ingredients.filter((i) => i.rarity === RARITY.BLOCKER)) {
    const needs = dishes.map((d) => d.recipe.find((r) => r.ingredientId === ing.id)?.count ?? 0).filter((n) => n > 0)
    if (needs.length === 0) continue
    const t = thresholds.find((x) => x.round === 'main' && x.ingredientId === ing.id)
    if (!t) {
      add('info', 'Thresholds', `${ing.name} (blocker) has no progression threshold in the Main round: nothing holds it back, so no player is ever counted as sitting in FU.`, ing.id)
      continue
    }
    const fuDay = targets.mainFuDay ?? days
    const limit = thresholdLimitOn(t, Math.min(Math.max(fuDay, 1), days))
    if (limit == null) add('info', 'Thresholds', `${ing.name}: on day ${fuDay} its threshold is lifted, so a player waiting for it is not counted as sitting in FU.`, ing.id)
    else if (limit >= sum(needs)) add('review', 'Thresholds', `${ing.name}: on day ${fuDay} its threshold is ${limit}, and the Main dishes need ${sum(needs)} in all - the threshold leaves no dish short, so nobody sits in FU.`, ing.id)
    else if (limit < Math.min(...needs)) add('review', 'Thresholds', `${ing.name}: on day ${fuDay} its threshold is ${limit}, fewer than any dish needs (${needs.join(' and ')}) - no blocker dish can be cooked by then.`, ing.id)
    else add('info', 'Thresholds', `${ing.name}: on day ${fuDay} its threshold is ${limit}; the Main dishes need ${needs.join(' and ')} (base segment), which leaves the last one ${sum(needs) - limit} short.`, ing.id)
  }

  // --- Special sources and jokers ---
  for (const s of sources) {
    const what = s.label || (s.kind === 'joker' ? 'A joker' : nameOf(s.ingredientId))
    if (s.kind !== 'joker' && !ingredientIds.has(s.ingredientId)) add('block', 'Sources', `Something given outside the baskets is an ingredient that no longer exists ("${s.ingredientId}").`, s.id)
    if (s.day < 1 || s.day > days) add('block', 'Sources', `${what} is given on day ${s.day}, outside the event's ${days} days.`, s.id)
    if (s.amount < 0) add('block', 'Sources', `${what} is given in an amount below zero.`, s.id)
    if (s.coveragePct < 0 || s.coveragePct > 100) add('block', 'Sources', `${what} is given to a share of players outside 0 to 100%.`, s.id)
    if (s.segmentIds && s.segmentIds.some((id) => !segmentIds.has(id))) add('review', 'Sources', `${what} is for a segment that no longer exists.`, s.id)
    if (s.kind === 'joker' && ingredients.length < 3) add('block', 'Sources', 'A joker gives three different ingredients; this chef has fewer than three.', s.id)
  }
  for (const ing of ingredients) {
    if (ing.rarity !== RARITY.SEMI_BLOCKER && ing.rarity !== RARITY.BLOCKER) continue
    const fromBaskets = inBaskets.has(ing.id)
    const fromSources = sources.some((s) => s.kind === 'joker' || s.ingredientId === ing.id)
    if (!fromBaskets && !fromSources) add('review', 'Sources', `"${ing.name}" (${RARITY_LABELS[ing.rarity].toLowerCase()}) is given by no basket in any phase and by no special source: a player can never get it.`, ing.id)
    else if (!fromBaskets) add('info', 'Sources', `"${ing.name}" only comes from special sources, never from a basket.`, ing.id)
  }

  // --- Catch-up presets ---
  presets.forEach((p) => {
    const name = `Preset "${p.name}"`
    const first = p.startDay ?? 1
    const lastDay = p.endDay ?? days
    if (first < 1 || lastDay > days || first > lastDay) add('block', 'Presets', `${name}: it runs from day ${first} to day ${lastDay}, which is not inside the event's ${days} days in that order.`, p.id)
    if (p.maxUses != null && p.maxUses < 1) add('review', 'Presets', `${name}: it can be used ${p.maxUses} times, so it is never given.`, p.id)
    if (p.segmentIds && p.segmentIds.some((id) => !segmentIds.has(id))) add('review', 'Presets', `${name}: it is for a segment that no longer exists.`, p.id)
    // The baskets it can take the place of: this type, in the phases its days touch.
    const touched = calendar.phases.filter((phase) => {
      const range = phaseDayRange(calendar, phase.id)
      return range && range.startDay <= lastDay && range.endDay >= first
    })
    const targetBaskets = touched.map((phase) => baskets.find((b) => b.phaseId === phase.id && b.chestType === p.chestType)).filter(Boolean)
    if (targetBaskets.length === 0) add('block', 'Presets', `${name}: there is no ${CHEST_LABELS[p.chestType] ?? p.chestType} basket in its days for it to take the place of.`, p.id)
    const sizes = new Set()
    for (const b of targetBaskets) for (let size = b.totalMin; size <= b.totalMax; size += 1) sizes.add(size)
    const contentSets = []
    if (p.sizeMode === 'fixed') {
      const total = sum(Object.values(p.fixedContents ?? {}).map((n) => Math.max(0, n)))
      if (p.fixedTotal == null || total !== p.fixedTotal) add('block', 'Presets', `${name}: its contents add up to ${total}, but it is set to give ${p.fixedTotal ?? 'no number of'} ingredients.`, p.id)
      if (p.fixedTotal != null && sizes.size && !sizes.has(p.fixedTotal)) add('block', 'Presets', `${name}: it gives ${p.fixedTotal} ingredients, outside what a ${CHEST_LABELS[p.chestType]} basket gives (${Math.min(...sizes)} to ${Math.max(...sizes)}).`, p.id)
      contentSets.push(p.fixedContents ?? {})
    } else {
      for (const size of [...sizes].sort((a, b) => a - b)) {
        const contents = p.allocations?.[size]
        const total = contents ? sum(Object.values(contents).map((n) => Math.max(0, n))) : null
        if (!contents || total === 0) add('block', 'Presets', `${name}: it has no contents for a basket of ${size}.`, p.id)
        else if (total !== size) add('block', 'Presets', `${name}: its contents for a basket of ${size} add up to ${total}.`, p.id)
        if (contents) contentSets.push(contents)
      }
    }
    const flagged = new Set()
    for (const contents of contentSets) {
      for (const [ingredientId, n] of Object.entries(contents)) {
        if (!(n > 0) || flagged.has(ingredientId)) continue
        if (!ingredientIds.has(ingredientId)) {
          flagged.add(ingredientId)
          add('block', 'Presets', `${name}: it holds an ingredient that no longer exists ("${ingredientId}").`, p.id)
          continue
        }
        const cap = byId[ingredientId].pantryCap
        if (cap != null && n > cap) {
          flagged.add(ingredientId)
          add('block', 'Presets', `${name}: it gives ${n} ${nameOf(ingredientId)}, more than the pantry can hold (${cap}).`, p.id)
          continue
        }
        // A preset has no permission to pass a progression threshold.
        const rounds = p.round === 'any' ? ['main', 'rc'] : [p.round]
        for (const round of rounds) {
          const t = thresholds.find((x) => x.round === round && x.ingredientId === ingredientId)
          if (!t || first < 1 || lastDay > days || first > lastDay) continue
          let roomSomeDay = false
          for (let day = first; day <= lastDay; day += 1) {
            const limit = thresholdLimitOn(t, day)
            if (limit == null || limit >= n) roomSomeDay = true
          }
          if (!roomSomeDay) {
            flagged.add(ingredientId)
            add('block', 'Presets', `${name}: it gives ${n} ${nameOf(ingredientId)}, but that ingredient's ${ROUND_LABELS[round]} threshold is below ${n} on every one of its days - the contents can never be given.`, p.id)
          }
        }
      }
    }
    const e = p.eligibility ?? {}
    if (e.dishesMin != null && e.dishesMax != null && e.dishesMin > e.dishesMax) add('block', 'Presets', `${name}: it asks for at least ${e.dishesMin} and at most ${e.dishesMax} dishes cooked - nobody fits.`, p.id)
  })

  return findings
}

export const SEVERITY_ORDER = ['block', 'review', 'info']
export const SEVERITY_LABELS = { block: 'Needs a fix', review: 'Worth a look', info: 'Good to know' }
