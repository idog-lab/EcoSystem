// The checks on a chef - by explicit economist brainstorm ask (channeling a
// GPT review): three severities, each finding naming the affected object and
// what it means, so a messy chef can be caught before it's trusted.
//
// - 'block': the chef is structurally broken - a reference to nothing, a
//   value that makes a roll impossible, a calendar that doesn't add up.
// - 'review': not wrong, but worth a human's attention before shipping.
// - 'info': background observations, no action implied.
//
// A plain list of { severity, area, step, message, entityId } objects, made
// in one place because several checks need the WHOLE chef at once ("no
// basket exists at all for this chest type in this phase").
//
// `step` is the step of the flow where the finding is put right (ChefApp.jsx:
// event, dishes, baskets): the flow shows a finding in that step, in sight,
// and counts it on the step's button. `area` is the kind of thing it is
// about and is what the full list groups by.
//
// The messages are written for the economist: the names shown on screen
// (the basket's chest type and its phase's label, an ingredient's name),
// never an internal id - an id only appears when the thing it names no
// longer exists, since then there is nothing else to call it.
import { RARITY, RARITY_LABELS, CHEST_TYPES, CHEST_LABELS } from './chefModel'

const STEP_OF_AREA = {
  Baskets: 'baskets',
  Grants: 'baskets',
  Dishes: 'dishes',
  'Recompletion dishes': 'dishes',
  Ingredients: 'dishes',
  Calendar: 'event',
  Segments: 'event',
}

function finding(severity, area, message, entityId = null, step = STEP_OF_AREA[area] ?? 'event') {
  return { severity, area, step, message, entityId }
}

export function validateChefConfig({ ingredients, dishes, recompletionDishes, baskets, calendar, segments, grants }) {
  const findings = []
  const ingredientIds = new Set(ingredients.map((i) => i.id))
  const nameOf = (ingredientId) => ingredients.find((i) => i.id === ingredientId)?.name ?? `"${ingredientId}"`
  const phaseLabel = (phaseId) => calendar.phases.find((p) => p.id === phaseId)?.label ?? `"${phaseId}"`
  const basketName = (basket) => `${CHEST_LABELS[basket.chestType] ?? basket.chestType} basket, ${phaseLabel(basket.phaseId)}`

  // --- Baskets ---
  for (const basket of baskets) {
    const name = basketName(basket)
    if (basket.totalMin < 0 || basket.totalMax < 0 || basket.totalMin > basket.totalMax) {
      findings.push(finding('block', 'Baskets', `${name}: it gives from ${basket.totalMin} to ${basket.totalMax} ingredients - the smallest number is above the largest, or one is below zero.`, basket.id))
    }
    const positiveWeight = basket.ingredientWeights.filter((w) => w.weight > 0)
    if (positiveWeight.length === 0) {
      findings.push(finding('block', 'Baskets', `${name}: no ingredient has a weight above 0, so this basket never gives anything.`, basket.id))
    } else {
      const combinedCap = positiveWeight.reduce((sum, w) => sum + w.max, 0)
      if (basket.totalMax > combinedCap) {
        findings.push(
          finding('block', 'Baskets', `${name}: it is set to give up to ${basket.totalMax} ingredients, but what each ingredient may give in one basket adds up to ${combinedCap} - it can never give that many.`, basket.id)
        )
      }
    }
    for (const w of basket.ingredientWeights) {
      if (!ingredientIds.has(w.ingredientId)) {
        findings.push(finding('block', 'Baskets', `${name}: one of its rows is an ingredient that no longer exists ("${w.ingredientId}").`, basket.id))
      }
      if (w.weight < 0 || w.max < 0) {
        findings.push(finding('block', 'Baskets', `${name}: ${nameOf(w.ingredientId)} has a weight or a most-per-basket below zero.`, basket.id))
      }
    }
  }

  // Every (chest type, phase) combo should have a basket - otherwise a
  // segment configured to open that chest type during that phase silently
  // gets nothing, with no error anywhere else to catch it.
  for (const phase of calendar.phases) {
    for (const chestType of CHEST_TYPES) {
      const exists = baskets.some((b) => b.phaseId === phase.id && b.chestType === chestType)
      if (!exists) findings.push(finding('block', 'Baskets', `No ${CHEST_LABELS[chestType]} basket is set for ${phase.label}: a player who opens one in those days gets nothing.`))
    }
  }

  // --- Recipes (both the main and Recompletion dish lists) ---
  function validateDishList(dishList, label) {
    // (The two lists can hold dishes of the same name: a finding says which list it is about.)
    const recompletion = label !== 'Dishes'
    const dishName = (dish) => `"${dish.name}"${recompletion ? ' (Recompletion)' : ''}`
    for (const dish of dishList) {
      if (dish.recipe.length === 0) {
        findings.push(finding('review', label, `${dishName(dish)} needs no ingredients at all.`, dish.id))
      }
      for (const r of dish.recipe) {
        if (!ingredientIds.has(r.ingredientId)) {
          findings.push(finding('block', label, `${dishName(dish)} needs an ingredient that no longer exists ("${r.ingredientId}").`, dish.id))
        }
        if (r.count <= 0) {
          findings.push(finding('block', label, `${dishName(dish)} needs zero or fewer of ${nameOf(r.ingredientId)}.`, dish.id))
        }
      }
    }
    const usage = {}
    for (const dish of dishList) for (const r of dish.recipe) usage[r.ingredientId] = (usage[r.ingredientId] ?? 0) + 1
    for (const [ingredientId, count] of Object.entries(usage)) {
      if (dishList.length > 0 && count >= Math.ceil(dishList.length * 0.7)) {
        findings.push(finding('info', label, `${nameOf(ingredientId)} is needed by ${count} of the ${dishList.length} ${recompletion ? 'Recompletion dishes' : 'dishes'}: which dish a player cooks first changes a lot for it.`))
      }
    }
  }
  validateDishList(dishes, 'Dishes')
  validateDishList(recompletionDishes, 'Recompletion dishes')

  // --- Orphan ingredients - unused by EITHER dish list and no basket ---
  // An ingredient used only by Recompletion is not an orphan - by explicit
  // note (a GPT review correction of an easy mistake to make here).
  const usedIngredientIds = new Set([...dishes, ...recompletionDishes].flatMap((d) => d.recipe.map((r) => r.ingredientId)))
  const basketIngredientIds = new Set(baskets.flatMap((b) => b.ingredientWeights.filter((w) => w.weight > 0).map((w) => w.ingredientId)))
  for (const ing of ingredients) {
    if (!usedIngredientIds.has(ing.id) && !basketIngredientIds.has(ing.id)) {
      findings.push(finding('review', 'Ingredients', `"${ing.name}" is needed by no dish and given by no basket.`, ing.id))
    } else if (!usedIngredientIds.has(ing.id)) {
      findings.push(finding('info', 'Ingredients', `"${ing.name}" comes out of baskets, but no dish needs it yet.`, ing.id))
    }
  }

  // --- Calendar ---
  const totalPhaseDays = calendar.phases.reduce((sum, p) => sum + p.days, 0)
  if (totalPhaseDays !== calendar.totalDays) {
    findings.push(finding('block', 'Calendar', `The phases add up to ${totalPhaseDays} days, but the event runs ${calendar.totalDays} days.`))
  }
  for (const phase of calendar.phases) {
    if (phase.days <= 0) findings.push(finding('block', 'Calendar', `"${phase.label}" has no days.`, phase.id))
  }

  // Semi-blocker/blocker ingredients that never get a positive weight on
  // ANY basket, in ANY phase, are structurally unobtainable from baskets -
  // only flagged as 'review' (not 'block') since a grant could still cover
  // it entirely, which is a legitimate design choice this tool supports.
  // (They are put right where baskets and grants are set, so: step baskets.)
  for (const ing of ingredients) {
    if (ing.rarity !== RARITY.SEMI_BLOCKER && ing.rarity !== RARITY.BLOCKER) continue
    const everAvailable = baskets.some((b) => b.ingredientWeights.some((w) => w.ingredientId === ing.id && w.weight > 0))
    const hasGrant = grants.some((g) => g.ingredientId === ing.id)
    if (!everAvailable && !hasGrant) {
      findings.push(finding('review', 'Calendar', `"${ing.name}" (${RARITY_LABELS[ing.rarity].toLowerCase()}) is given by no basket in any phase and by no sale or event: a player can never get it.`, ing.id, 'baskets'))
    } else if (!everAvailable && hasGrant) {
      findings.push(finding('info', 'Calendar', `"${ing.name}" only comes from sales and events, never from a basket.`, ing.id, 'baskets'))
    }
  }

  // --- Grants ---
  for (const grant of grants) {
    if (!ingredientIds.has(grant.ingredientId)) {
      findings.push(finding('block', 'Grants', `Something given outside the baskets is an ingredient that no longer exists ("${grant.ingredientId}").`, grant.id))
    }
    if (grant.day < 1 || grant.day > calendar.totalDays) {
      findings.push(finding('block', 'Grants', `${nameOf(grant.ingredientId)} is given on day ${grant.day}, outside the event's ${calendar.totalDays} days.`, grant.id))
    }
    if (grant.amount < 0) findings.push(finding('block', 'Grants', `${nameOf(grant.ingredientId)} is given in an amount below zero.`, grant.id))
    if (grant.coveragePct < 0 || grant.coveragePct > 100) findings.push(finding('block', 'Grants', `${nameOf(grant.ingredientId)} is given to a share of players outside 0 to 100%.`, grant.id))
  }

  // --- Segments ---
  for (const segment of segments) {
    for (const [chestType, rate] of Object.entries(segment.avgBasketsPerDay)) {
      if (rate < 0) findings.push(finding('block', 'Segments', `"${segment.name}" opens fewer than zero ${CHEST_LABELS[chestType] ?? chestType} baskets a day.`, segment.id))
    }
  }

  return findings
}

export const SEVERITY_ORDER = ['block', 'review', 'info']
// What a severity is called on screen - the words of the Merge flow ("Needs
// a fix" stops an event from shipping as it is; the others do not).
export const SEVERITY_LABELS = { block: 'Needs a fix', review: 'Worth a look', info: 'Good to know' }
