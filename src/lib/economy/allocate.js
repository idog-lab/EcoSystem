// THE ECONOMY BUILDER (economist, 28 Nov 2026: "one of the most important things i want us to have, is to have some
// kind of a skill that build an economy it self. giving it rules of hard allocations (eventually has to be met), and soft
// (can be used), that will build it itself. in some tiers"). Asked:
//   - a HARD allocation is "close to a total over the events ... a total allocation for a resource with distribution for
//     each gameplay section" - easy, mid and hard; "hard is only the GP" (the Final Prize). A section's share goes to its
//     tiers by their targets (the recommended way, not answered otherwise);
//   - SOFT allocations are "fillers. we use them to get close to a balance. the balance shouldn't be hard on a tier, we
//     can do that every 2nd one will be close to balance" - a list in order, each with a max a tier ("A list with a max
//     a tier");
//   - it builds the tiers ticked ("The ones I tick"); the rules live in the feature.
// Generic: a feature gives its tiers and how to read and change a prize; nothing here knows Wicked Trails.
//
// tiers: [{ id, group (a lane - the carry runs within it), section ('easy' | 'mid' | 'hard'), target, auto, parts }]
// in order. hard: [{ item, total, pct: { easy, mid, hard } }]; fillers: [{ item, max }]; balanceEvery: 2.
// io: { worthOf(parts) -> number | null, unitWorth(item) -> number | null, get(parts, item) -> amount,
//       set(parts, item, amount) -> parts (a preset item snapped to one that exists), count(parts) -> prizes,
//       limit(tier) -> the most prizes it may hold }.
// Returns { parts: { [id]: parts }, report: { hard: [{ item, total, placed, bySection }], groups: [{ group, off }],
//   notes: [text] } }.

export const ALLOC_ITEMS = [
  { id: 'coins', label: 'Coins', step: 0.01 },
  { id: 'wild', label: 'Wild', step: 1 },
  { id: 'stock', label: 'Extra stock', step: 1 },
  { id: 'undo', label: 'Undo', step: 1 },
  { id: 'entry', label: 'Free round', step: 1 },
  { id: 'puzzle', label: 'Puzzle', step: 1 },
  { id: 'mini', label: 'Mini game', step: 1 },
]
export const FILLER_ITEMS = ALLOC_ITEMS.filter((i) => ['coins', 'wild', 'stock', 'undo', 'entry'].includes(i.id))
export const SECTIONS = [
  { id: 'easy', label: 'Easy' },
  { id: 'mid', label: 'Mid' },
  { id: 'hard', label: 'Hard' },
]
const stepOf = (item) => ALLOC_ITEMS.find((i) => i.id === item)?.step ?? 1
const round2 = (x) => Math.round(x * 100) / 100
const roundTo = (x, step) => round2(Math.round(x / step) * step)

// `amount` split by `weights` in steps of `step`, the parts adding up to the amount rounded to the step (the largest
// remainders get the last steps).
export function splitByWeights(amount, weights, step = 1) {
  if (!weights.length) return []
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0)
  const w = total > 0 ? weights.map((x) => Math.max(0, x) / total) : weights.map(() => 1 / weights.length)
  const units = Math.round(amount / step)
  const raw = w.map((x) => x * units)
  const out = raw.map(Math.floor)
  let left = units - out.reduce((a, b) => a + b, 0)
  const order = raw.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r)
  for (let k = 0; left > 0 && k < order.length; k += 1, left -= 1) out[order[k].i] += 1
  return out.map((u) => round2(u * step))
}

export function allocate({ tiers, hard = [], fillers = [], balanceEvery = 2, io }) {
  const parts = Object.fromEntries(tiers.map((t) => [t.id, t.parts]))
  const notes = []
  const auto = tiers.filter((t) => t.auto)
  if (!auto.length) return { parts, report: { hard: [], groups: [], notes: ['No tier is ticked to build.'] } }

  // 1. The hard totals: each section's share, less what tiers not built already hold of it, split between the
  // section's built tiers by their targets. A built tier starts from nothing of the items the rules set.
  const ruled = new Set([...hard.map((h) => h.item), ...fillers.map((f) => f.item)])
  for (const t of auto) for (const item of ruled) parts[t.id] = io.set(parts[t.id], item, 0)
  const hardReport = []
  for (const rule of hard) {
    if (!rule.item || !(rule.total > 0)) continue
    const bySection = {}
    for (const s of SECTIONS) {
      const share = (rule.total * (Number(rule.pct?.[s.id]) || 0)) / 100
      const inSection = tiers.filter((t) => t.section === s.id)
      const held = inSection.filter((t) => !t.auto).reduce((a, t) => a + (Number(io.get(parts[t.id], rule.item)) || 0), 0)
      const built = inSection.filter((t) => t.auto)
      const toPlace = Math.max(0, share - held)
      if (toPlace > 0 && !built.length) notes.push(`${labelOf(rule.item)}: ${round2(toPlace)} of the ${s.label.toLowerCase()} share has no ticked tier to go to.`)
      splitByWeights(toPlace, built.map((t) => t.target ?? 0), stepOf(rule.item)).forEach((amount, k) => {
        const id = built[k].id
        parts[id] = io.set(parts[id], rule.item, round2((Number(io.get(parts[id], rule.item)) || 0) + amount))
      })
      bySection[s.id] = round2(inSection.reduce((a, t) => a + (Number(io.get(parts[t.id], rule.item)) || 0), 0))
    }
    const placed = round2(Object.values(bySection).reduce((a, b) => a + b, 0))
    hardReport.push({ item: rule.item, total: rule.total, placed, bySection })
    if (Math.abs(placed - rule.total) > stepOf(rule.item) / 2) notes.push(`${labelOf(rule.item)}: ${placed} placed of ${rule.total}${['puzzle', 'mini'].includes(rule.item) ? ' (taken as the presets that exist)' : ''}.`)
  }

  // 2. The fillers, lane by lane: a built tier is filled to its own target, and every `balanceEvery`-th built tier (and
  // the lane's last) to its target plus the carry - so the lane comes back close to balance there.
  const groups = []
  for (const group of [...new Set(tiers.map((t) => t.group))]) {
    const lane = tiers.filter((t) => t.group === group)
    const lastAuto = [...lane].reverse().find((t) => t.auto)
    let carry = 0
    let built = 0
    for (const t of lane) {
      const target = t.target ?? 0
      if (t.auto && fillers.length) {
        built += 1
        const checkpoint = built % Math.max(1, balanceEvery) === 0 || t === lastAuto
        const base = io.worthOf(parts[t.id])
        if (base == null) {
          notes.push(`${t.id}: a part has no worth yet - the fillers cannot balance it.`)
        } else if (carry == null) {
          notes.push(`${t.id}: a tier before has no worth - filled to its own target.`)
          parts[t.id] = fill(parts[t.id], target - base, fillers, io, t)
        } else {
          parts[t.id] = fill(parts[t.id], (checkpoint ? target + carry : target) - base, fillers, io, t)
        }
      }
      const worth = io.worthOf(parts[t.id])
      carry = carry == null || worth == null ? null : round2(target + carry - worth)
    }
    // (+ 0: a balanced lane reads 0, never -0.)
    groups.push({ group, off: carry == null ? null : round2(-carry) + 0 })
  }
  return { parts, report: { hard: hardReport, groups, notes } }
}

const labelOf = (item) => ALLOC_ITEMS.find((i) => i.id === item)?.label ?? item

// Fills `need` (allowance) with the fillers in their order: each up to its max a tier, in its steps, a new item only
// while the tier has room for one more prize; the last one that can be used rounds to the nearest step.
function fill(parts, need, fillers, io, tier) {
  let left = need
  let out = parts
  const usable = fillers.filter((f) => f.item && (io.unitWorth(f.item) ?? 0) > 0)
  usable.forEach((f, k) => {
    if (left <= 0) return
    const u = io.unitWorth(f.item)
    const have = Number(io.get(out, f.item)) || 0
    if (!have && io.count(out) >= io.limit(tier)) return
    const step = stepOf(f.item)
    const isLast = k === usable.length - 1
    let amount = step < 1 ? roundTo(left / u, step) : isLast ? Math.round(left / u) : Math.floor(left / u)
    if (f.max != null && f.max !== '') amount = Math.min(amount, Math.max(0, Number(f.max) - have))
    if (!(amount > 0)) return
    out = io.set(out, f.item, round2(have + amount))
    left = round2(left - amount * u)
  })
  return out
}
