// Config validation - by explicit economist brainstorm ask (channeling a
// GPT review): three severities, each finding naming the affected object
// and what it means, so a messy config can be caught before it's trusted.
//
// - 'block': the config is structurally broken - a reference to nothing,
//   a value that makes a roll impossible, a calendar that doesn't add up.
// - 'review': not wrong, but worth a human's attention before shipping.
// - 'info': background observations, no action implied.
//
// This is deliberately a plain list of {severity, area, message, entityId}
// objects rather than inline per-tab checks - a few of these (calendar
// gaps, basket feasibility) already partially exist as inline notes in
// CalendarTab/BasketsTab; this module is the one place that can reason
// about the WHOLE config at once (e.g. "no basket exists at all for this
// chest type + phase combo," which no single tab's own local state can see).
import { RARITY, CHEST_TYPES } from './chefModel'

function finding(severity, area, message, entityId = null) {
  return { severity, area, message, entityId }
}

export function validateChefConfig({ ingredients, dishes, recompletionDishes, baskets, calendar, segments, grants }) {
  const findings = []
  const ingredientIds = new Set(ingredients.map((i) => i.id))

  // --- Baskets ---
  for (const basket of baskets) {
    if (basket.totalMin < 0 || basket.totalMax < 0 || basket.totalMin > basket.totalMax) {
      findings.push(finding('block', 'Baskets', `${basket.chestType} / ${basket.phaseId}: invalid total range (${basket.totalMin}–${basket.totalMax}).`, basket.id))
    }
    const positiveWeight = basket.ingredientWeights.filter((w) => w.weight > 0)
    if (positiveWeight.length === 0) {
      findings.push(finding('block', 'Baskets', `${basket.chestType} / ${basket.phaseId}: no ingredient has a positive weight — this basket can never yield anything.`, basket.id))
    } else {
      const combinedCap = positiveWeight.reduce((sum, w) => sum + w.max, 0)
      if (basket.totalMax > combinedCap) {
        findings.push(
          finding(
            'block',
            'Baskets',
            `${basket.chestType} / ${basket.phaseId}: total max (${basket.totalMax}) exceeds the combined per-open caps of its own positive-weight ingredients (${combinedCap}) — it can never actually roll that high.`,
            basket.id
          )
        )
      }
    }
    for (const w of basket.ingredientWeights) {
      if (!ingredientIds.has(w.ingredientId)) {
        findings.push(finding('block', 'Baskets', `${basket.chestType} / ${basket.phaseId}: references an unknown ingredient "${w.ingredientId}".`, basket.id))
      }
      if (w.weight < 0 || w.max < 0) {
        findings.push(finding('block', 'Baskets', `${basket.chestType} / ${basket.phaseId}: negative weight or max for ${w.ingredientId}.`, basket.id))
      }
    }
  }

  // Every (chest type, phase) combo should have a basket - otherwise a
  // segment configured to open that chest type during that phase silently
  // gets nothing, with no error anywhere else to catch it.
  for (const phase of calendar.phases) {
    for (const chestType of CHEST_TYPES) {
      const exists = baskets.some((b) => b.phaseId === phase.id && b.chestType === chestType)
      if (!exists) findings.push(finding('block', 'Baskets', `No basket configured for ${chestType} chests during ${phase.label} (${phase.id}).`))
    }
  }

  // --- Recipes (both the main and Recompletion dish lists) ---
  function validateDishList(dishList, label) {
    for (const dish of dishList) {
      if (dish.recipe.length === 0) {
        findings.push(finding('review', label, `"${dish.name}" has an empty recipe.`, dish.id))
      }
      for (const r of dish.recipe) {
        if (!ingredientIds.has(r.ingredientId)) {
          findings.push(finding('block', label, `"${dish.name}" references an unknown ingredient "${r.ingredientId}".`, dish.id))
        }
        if (r.count <= 0) {
          findings.push(finding('block', label, `"${dish.name}" has a nonpositive requirement for ${r.ingredientId}.`, dish.id))
        }
      }
    }
    const usage = {}
    for (const dish of dishList) for (const r of dish.recipe) usage[r.ingredientId] = (usage[r.ingredientId] ?? 0) + 1
    for (const [ingredientId, count] of Object.entries(usage)) {
      if (dishList.length > 0 && count >= Math.ceil(dishList.length * 0.7)) {
        findings.push(finding('info', label, `${ingredientId} is required by ${count}/${dishList.length} dishes — heavily shared, strategy-sensitive.`))
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
      findings.push(finding('review', 'Ingredients', `"${ing.name}" isn't required by any dish and isn't obtainable from any basket.`, ing.id))
    } else if (!usedIngredientIds.has(ing.id)) {
      findings.push(finding('info', 'Ingredients', `"${ing.name}" is obtainable but isn't required by any dish yet.`, ing.id))
    }
  }

  // --- Calendar ---
  const totalPhaseDays = calendar.phases.reduce((sum, p) => sum + p.days, 0)
  if (totalPhaseDays !== calendar.totalDays) {
    findings.push(finding('block', 'Calendar', `Phases sum to ${totalPhaseDays} days but the event is ${calendar.totalDays} days long.`))
  }
  for (const phase of calendar.phases) {
    if (phase.days <= 0) findings.push(finding('block', 'Calendar', `"${phase.label}" has a nonpositive day count.`, phase.id))
  }

  // Semi-blocker/blocker ingredients that never get a positive weight on
  // ANY basket, in ANY phase, are structurally unobtainable from baskets -
  // only flagged as 'review' (not 'block') since a grant could still cover
  // it entirely, which is a legitimate design choice this tool supports.
  for (const ing of ingredients) {
    if (ing.rarity !== RARITY.SEMI_BLOCKER && ing.rarity !== RARITY.BLOCKER) continue
    const everAvailable = baskets.some((b) => b.ingredientWeights.some((w) => w.ingredientId === ing.id && w.weight > 0))
    const hasGrant = grants.some((g) => g.ingredientId === ing.id)
    if (!everAvailable && !hasGrant) {
      findings.push(finding('review', 'Calendar', `"${ing.name}" (${ing.rarity}) has no basket with a positive weight and no grant — it can never be obtained at all.`, ing.id))
    } else if (!everAvailable && hasGrant) {
      findings.push(finding('info', 'Calendar', `"${ing.name}" is only obtainable via grants, never from baskets.`, ing.id))
    }
  }

  // --- Grants ---
  for (const grant of grants) {
    if (!ingredientIds.has(grant.ingredientId)) {
      findings.push(finding('block', 'Grants', `A grant references an unknown ingredient "${grant.ingredientId}".`, grant.id))
    }
    if (grant.day < 1 || grant.day > calendar.totalDays) {
      findings.push(finding('block', 'Grants', `A grant on day ${grant.day} falls outside the event's ${calendar.totalDays}-day length.`, grant.id))
    }
    if (grant.amount < 0) findings.push(finding('block', 'Grants', 'A grant has a negative amount.', grant.id))
    if (grant.coveragePct < 0 || grant.coveragePct > 100) findings.push(finding('block', 'Grants', 'A grant has a coverage % outside 0–100.', grant.id))
  }

  // --- Segments ---
  for (const segment of segments) {
    for (const [chestType, rate] of Object.entries(segment.avgBasketsPerDay)) {
      if (rate < 0) findings.push(finding('block', 'Segments', `"${segment.name}" has a negative avg-baskets/day for ${chestType}.`, segment.id))
    }
  }

  return findings
}

export const SEVERITY_ORDER = ['block', 'review', 'info']
export const SEVERITY_LABELS = { block: 'Blocks release', review: 'Needs review', info: 'Informational' }
