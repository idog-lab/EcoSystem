// WHAT AN EVENT STILL NEEDS before it can be read as the real one.
//
// A chef made from a historical workbook is complete as history and
// incomplete as a reference for the intended event: it has no thresholds, no
// Dish Master days, no FU target, twelve Recompletion dishes with no prizes.
// This lists every input of the event, each with where it is typed, and says
// which are MISSING, which are there but were never confirmed by the
// economist (TO CONFIRM - a guess of the earlier tool, an empty list that may
// be meant, an unconfirmed rule of the game), and what a missing one stops.
//
// Nothing here fills anything in. An item to confirm is ticked by the
// economist; the tick is remembered with the values it was given for
// (`confirmed[id]` holds a mark of them), so changing the values asks again.
// Missing prizes make the VALUATION incomplete and stop nothing else; only
// "no segment" and "no dish" stop a simulation.
import { CHEST_TYPES, REWARD_KEYS, RARITY, expectedSupply } from './chefModel'

const hasReward = (reward) => !!reward && REWARD_KEYS.some((key) => reward[key] != null)
const mark = (value) => JSON.stringify(value)

export const READINESS_STATUS_LABELS = { missing: 'Missing', confirm: 'To confirm', optional: 'Optional', done: 'Done' }

export function readiness(state) {
  const { ingredients = [], dishes = [], recompletionDishes = [], calendar, segments = [], thresholds = [], sources = [], targets = {}, rewards = {}, settings = {} } = state
  const confirmed = state.confirmed ?? {}
  const items = []
  // `missing`: a sentence, when the input is not there. `confirm`: a sentence saying what is there, when it
  // has to be confirmed (with `values`, what the tick is for). `optional`: missing is fine.
  const add = (id, group, label, { missing = null, confirm = null, values = null, optional = false, stops = '', step, fold = null }) => {
    const itemMark = values == null ? null : mark(values)
    const status = missing ? (optional ? 'optional' : 'missing') : confirm ? (confirmed[id] === itemMark ? 'done' : 'confirm') : 'done'
    items.push({ id, group, label, status, detail: missing ?? confirm ?? '', stops: missing ? stops : '', step, fold, mark: itemMark, needsConfirm: !missing && !!confirm })
  }
  const names = (list) => list.map((x) => x.name).join(', ')
  const blockers = ingredients.filter((i) => i.rarity === RARITY.BLOCKER)
  const semis = ingredients.filter((i) => i.rarity === RARITY.SEMI_BLOCKER)
  const uses = (list, id) => list.some((d) => d.recipe.some((r) => r.ingredientId === id))
  const limited = (round, id) => thresholds.some((t) => t.round === round && t.ingredientId === id && (t.steps ?? []).some((s) => s.limit != null))

  // --- Players ---
  add('segments', 'Players', 'Segments: names, effort factors, prize factors, burnout', {
    missing: segments.length === 0 ? 'No segment is defined.' : null,
    confirm: `${segments.length} segments. Effort ${[...new Set(segments.map((s) => s.effortFactor))].join(' / ')}, prize factor ${[...new Set(segments.map((s) => s.prizeFactor))].join(' / ')}, burnout ${[...new Set(segments.map((s) => s.burnout))].join(' / ')}.${state.migration ? ' The prize factors came from the earlier tool\'s guess, not from the sheet.' : ''}`,
    values: segments.map((s) => [s.name, s.effortFactor, s.prizeFactor, s.burnout]),
    stops: 'Nothing can be simulated.',
    step: 'event',
  })
  // (A segment with a definition of its own - the live segments: an open-ended top band, the A/B test's control - is defined.)
  const noBrut = segments.filter((s) => !s.definition && (s.brutWinsMin == null || s.brutWinsMax == null))
  add('brut-wins', 'Players', 'Daily Brut Wins ranges', {
    missing: segments.length && noBrut.length ? `Not typed for ${noBrut.length} of ${segments.length} segments.` : null,
    optional: true,
    step: 'event',
  })
  const idle = segments.filter((s) => CHEST_TYPES.every((type) => expectedSupply(s, calendar)[type].every((v) => !(v > 0))))
  add('supply', 'Players', 'Basket supply: an average a day, or day by day', {
    missing: segments.length === 0 ? 'No segment to type it for.' : idle.length ? `${names(idle)} ${idle.length === 1 ? 'opens' : 'open'} no baskets.` : null,
    confirm: `${segments.filter((s) => s.supply?.mode === 'daily').length} of ${segments.length} segments typed day by day, the others as an average a day.`,
    values: segments.map((s) => s.supply),
    stops: 'A segment with no baskets cooks nothing.',
    step: 'event',
    fold: 'chef-supply-days',
  })

  // --- Limits ---
  const capped = ingredients.filter((i) => i.pantryCap != null)
  add('pantry-caps', 'Limits', 'Pantry caps', {
    missing: ingredients.length === 0 ? 'No ingredient yet.' : null,
    confirm: capped.length === 0 ? 'No ingredient has a pantry cap, so nothing is ever lost to a full pantry.' : `${capped.map((i) => `${i.name} ${i.pantryCap}`).join(', ')}${capped.length < ingredients.length ? `; ${ingredients.length - capped.length} with no cap` : ''}.`,
    values: ingredients.map((i) => [i.id, i.pantryCap]),
    stops: 'Nothing can be simulated.',
    step: 'dishes',
  })
  const mainBlockers = blockers.filter((b) => uses(dishes, b.id))
  const unlimited = mainBlockers.filter((b) => !limited('main', b.id))
  add('threshold-blocker', 'Limits', 'The blocker\'s progression threshold, Main round', {
    missing: mainBlockers.length === 0 ? 'No Main dish needs a blocker ingredient.' : unlimited.length ? `${names(unlimited)} ${unlimited.length === 1 ? 'has' : 'have'} no schedule in the Main round.` : null,
    stops: 'Nothing holds the blocker back, so nobody can be counted as sitting in FU.',
    step: 'baskets',
    fold: 'chef-thresholds',
  })
  const freeSemis = semis.filter((s) => uses(dishes, s.id) && !thresholds.some((t) => t.round === 'main' && t.ingredientId === s.id))
  add('threshold-semi', 'Limits', 'The semi-blocker\'s schedule during the Dish Master', {
    missing: semis.length === 0 ? 'No ingredient is a semi-blocker.' : freeSemis.length ? `${names(freeSemis)} ${freeSemis.length === 1 ? 'has' : 'have'} no schedule.` : null,
    stops: 'It is given whenever its basket odds allow, with no rise during the Dish Master.',
    step: 'baskets',
    fold: 'chef-thresholds',
  })
  const rcBlockers = blockers.filter((b) => uses(recompletionDishes, b.id))
  const rcUnlimited = rcBlockers.filter((b) => !limited('rc', b.id))
  add('threshold-rc', 'Limits', 'The blocker\'s progression threshold, Recompletion', {
    missing: recompletionDishes.length === 0 ? 'No Recompletion dishes yet.' : rcBlockers.length === 0 ? 'No Recompletion dish needs a blocker ingredient.' : rcUnlimited.length ? `${names(rcUnlimited)} ${rcUnlimited.length === 1 ? 'has' : 'have'} no schedule in Recompletion.` : null,
    stops: 'Nobody can be counted in Recompletion\'s FU.',
    step: 'baskets',
    fold: 'chef-thresholds',
  })

  // --- Calendar and targets ---
  const dm = calendar.dishMaster ?? {}
  add('dish-master', 'Calendar and targets', 'Dish Master days', {
    missing: dm.startDay == null || dm.endDay == null ? 'Not set.' : null,
    stops: 'The semi-blocker\'s rise cannot be written from it.',
    step: 'event',
  })
  const pickedDm = (dm.dishIds ?? []).filter((id) => dishes.some((d) => d.id === id))
  const semiDishCount = dishes.filter((d) => d.recipe.some((r) => semis.some((s) => s.id === r.ingredientId))).length
  add('dish-master-dishes', 'Calendar and targets', 'The three Dish Master dishes', {
    missing: pickedDm.length ? (pickedDm.length !== 3 ? `${pickedDm.length} picked; the rule is three.` : null) : semiDishCount !== 3 && semiDishCount > 0 ? `None picked, and the semi-blocker is in ${semiDishCount} Main dishes: pick the three.` : null,
    stops: 'Dish Master progress is read on the wrong dishes.',
    step: 'event',
  })
  add('fu-target', 'Calendar and targets', 'The FU target: its day and share', {
    missing: targets.mainFuDay == null ? 'No day is set.' : null,
    stops: 'No segment is measured against the FU target.',
    step: 'event',
  })
  add('checkpoints', 'Calendar and targets', 'Checkpoints', {
    missing: (targets.checkpoints ?? []).length === 0 ? 'None set.' : null,
    optional: true,
    step: 'event',
  })

  // --- Dishes and prizes ---
  add('rc-recipes', 'Dishes and prizes', 'Exactly three Recompletion recipes', {
    missing: recompletionDishes.length !== 3 ? `Recompletion has ${recompletionDishes.length} ${recompletionDishes.length === 1 ? 'dish' : 'dishes'}; the rule is exactly three.` : null,
    stops: 'Recompletion is played with the dishes that are there: its figures are not the intended round\'s.',
    step: 'dishes',
  })
  const prizeless = (list) => list.filter((d) => !hasReward(d.reward)).length
  add('main-prizes', 'Dishes and prizes', 'Main dish prizes, by component', {
    missing: dishes.length === 0 ? 'No Main dish yet.' : prizeless(dishes) ? `${prizeless(dishes)} of ${dishes.length} have no components${dishes.some((d) => !hasReward(d.reward) && d.legacyWorth != null) ? ' (an older single number is counted as coins)' : ''}.` : null,
    stops: dishes.length === 0 ? 'Nothing can be simulated.' : 'What players are paid is incomplete. Dishes, FU and Recompletion are simulated all the same.',
    step: 'dishes',
    fold: 'chef-prizes',
  })
  add('rc-prizes', 'Dishes and prizes', 'Recompletion dish prizes', {
    missing: recompletionDishes.length === 0 ? 'No Recompletion dishes yet.' : prizeless(recompletionDishes) ? `${prizeless(recompletionDishes)} of ${recompletionDishes.length} have no prize.` : null,
    stops: 'What Recompletion pays is unknown, not zero. Its dishes and FU are simulated all the same.',
    step: 'dishes',
    fold: 'chef-prizes',
  })
  add('grand-main', 'Dishes and prizes', 'Grand prize, Main', {
    missing: !hasReward(rewards.grandPrize?.main) ? 'Not set.' : null,
    stops: 'What players are paid is incomplete.',
    step: 'dishes',
    fold: 'chef-prizes',
  })
  add('grand-rc', 'Dishes and prizes', 'Grand prize, Recompletion', {
    missing: !hasReward(rewards.grandPrize?.rc) ? 'Not set.' : null,
    stops: 'What Recompletion pays is incomplete.',
    step: 'dishes',
    fold: 'chef-prizes',
  })

  // --- Besides the baskets, and the rules not settled ---
  add('sources', 'Other', 'Special sources and jokers', {
    confirm: sources.length === 0 ? 'None typed: every ingredient comes from a basket. Confirm that is meant.' : `${sources.length} ${sources.length === 1 ? 'line' : 'lines'} (${sources.filter((s) => s.kind === 'joker').length} with jokers).`,
    values: sources,
    step: 'baskets',
    fold: 'chef-grants',
  })
  add('open-rules', 'Other', 'The rules of the real game that are not confirmed', {
    confirm: 'Eight rules are settings for now (when a threshold is checked, whether lost overflow counts, how a joker is spent, ...). Confirm the choices, or change them.',
    values: [settings.thresholdPolicy, settings.thresholdCounts, settings.cookTiming, settings.cookOrder, settings.jokerPolicy, settings.jokerAmount, settings.jokerBlockerAmount, settings.recipients, rewards.itemRounding],
    step: 'simulate',
    fold: 'chef-open-rules',
  })

  const count = (status) => items.filter((i) => i.status === status).length
  return {
    items,
    missing: count('missing'),
    toConfirm: count('confirm'),
    optional: count('optional'),
    done: count('done'),
    // What genuinely stops a simulation: no one to play, or nothing to cook.
    canSimulate: segments.length > 0 && dishes.length + recompletionDishes.length > 0,
    valuationComplete: !items.some((i) => ['main-prizes', 'rc-prizes', 'grand-main', 'grand-rc'].includes(i.id) && i.status === 'missing'),
    complete: count('missing') === 0 && count('confirm') === 0,
  }
}
