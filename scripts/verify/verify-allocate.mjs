// THE ECONOMY BUILDER (src/lib/economy/allocate.js): hard totals split by section and by the tiers' targets, fillers in
// order to a max a tier, the lane close to balance every 2nd tier, the prize count kept, tiers not ticked left alone.
//   npx vite-node scripts/verify/verify-allocate.mjs
import { allocate, splitByWeights } from '../../src/lib/economy/allocate.js'

let fails = 0
let total = 0
const check = (name, cond, extra = '') => {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}${!cond && extra ? `  [${extra}]` : ''}`)
}
const near = (a, b) => a != null && Math.abs(a - b) < 1e-6

// A plain economy to work by hand: coins 1, wild 2.5, undo 0.25, a puzzle piece 0.05.
const WORTH = { coins: 1, wild: 2.5, stock: 2, undo: 0.25, entry: 1, puzzle: 0.05, mini: 0.3 }
const io = {
  worthOf: (p) => Object.entries(p).reduce((s, [k, v]) => (k === 'other' ? (v == null ? null : s + v) : s == null ? null : s + (WORTH[k] ?? 0) * v), 0),
  unitWorth: (item) => WORTH[item],
  get: (p, item) => p[item] ?? 0,
  set: (p, item, amount) => {
    const out = { ...p }
    if (amount > 0) out[item] = amount
    else delete out[item]
    return out
  },
  count: (p) => Object.keys(p).length,
  limit: (t) => (t.group === 'final' ? 5 : 4),
}

check('a split by weights adds up exactly, the largest remainders first', JSON.stringify(splitByWeights(10, [1, 1, 1])) === '[4,3,3]' && JSON.stringify(splitByWeights(1, [1, 3], 0.01)) === '[0.25,0.75]')

const tiers = (over = {}) => [
  { id: 'a1', group: 'A', section: 'easy', target: 10, auto: true, parts: {}, ...over.a1 },
  { id: 'a2', group: 'A', section: 'easy', target: 10, auto: true, parts: {}, ...over.a2 },
  { id: 'a3', group: 'A', section: 'mid', target: 20, auto: true, parts: {}, ...over.a3 },
  { id: 'gp', group: 'final', section: 'hard', target: 40, auto: true, parts: {}, ...over.gp },
]
const puzzle = { item: 'puzzle', total: 100, pct: { easy: 20, mid: 30, hard: 50 } }

// Hard: puzzle 100 - easy 20, mid 30, hard (the Final Prize) 50.
const h = allocate({ tiers: tiers(), hard: [puzzle], fillers: [], io })
check(`a hard total by section, split by the tiers' targets (${['a1', 'a2', 'a3', 'gp'].map((id) => h.parts[id].puzzle).join(', ')})`, h.parts.a1.puzzle === 10 && h.parts.a2.puzzle === 10 && h.parts.a3.puzzle === 30 && h.parts.gp.puzzle === 50 && h.report.hard[0].placed === 100)

// Fillers: wild only, every 2nd tier back to balance.
const f = allocate({ tiers: tiers(), hard: [puzzle], fillers: [{ item: 'wild' }], balanceEvery: 2, io })
check(`tier 1 to its own target: 9.5 left -> 4 wild (10.5) (${f.parts.a1.wild})`, f.parts.a1.wild === 4)
check(`tier 2, the 2nd: back to balance with the carry - 9 left -> 4 wild (${f.parts.a2.wild})`, f.parts.a2.wild === 4)
check(`the lane's last tier closes it: 17.5 left -> 7 wild; the lane ends at 0 (${f.parts.a3.wild}, off ${f.report.groups[0].off})`, f.parts.a3.wild === 7 && f.report.groups[0].off === 0)
check(`the Final Prize is its own lane: 40 - 2.5 puzzle -> 15 wild, off 0 (${f.parts.gp.wild})`, f.parts.gp.wild === 15 && f.report.groups[1].off === 0)

// Max a tier, then the next filler.
const m = allocate({ tiers: tiers(), hard: [puzzle], fillers: [{ item: 'wild', max: 2 }, { item: 'coins' }], io })
check(`wild up to 2, then coins for the rest: tier 1 = 0.5 + 5 + 4.5 = 10 (${JSON.stringify(m.parts.a1)})`, m.parts.a1.wild === 2 && near(m.parts.a1.coins, 4.5) && near(io.worthOf(m.parts.a1), 10))

// The prize count: a tier already holding 4 items takes no new one.
const full = { a1: { auto: true, parts: {} } }
const c = allocate({ tiers: tiers(full).map((t) => (t.id === 'a1' ? { ...t, parts: { other: 0, stock: 1, entry: 1, mini: 1 } } : t)), hard: [puzzle], fillers: [{ item: 'wild' }], io })
check(`a tier with 4 prizes takes no new filler (${JSON.stringify(c.parts.a1)})`, c.parts.a1.wild === undefined && c.parts.a1.puzzle === 10)

// A tier not ticked keeps its prize, and what it holds counts toward the total.
const kept = allocate({ tiers: tiers({ a1: { auto: false, parts: { puzzle: 15, undo: 4 } } }), hard: [puzzle], fillers: [{ item: 'wild' }], io })
check(`not ticked: left as it is; its 15 puzzle count, so the other easy tier gets 5 (${kept.parts.a2.puzzle})`, JSON.stringify(kept.parts.a1) === JSON.stringify({ puzzle: 15, undo: 4 }) && kept.parts.a2.puzzle === 5 && kept.report.hard[0].placed === 100)
check('nothing ticked: nothing built, and it says so', /No tier is ticked/.test(allocate({ tiers: tiers().map((t) => ({ ...t, auto: false })), hard: [puzzle], io }).report.notes[0]))
const noGp = allocate({ tiers: tiers({ gp: { auto: false } }), hard: [puzzle], io })
check(`the hard share with no ticked Final Prize is named (${noGp.report.notes[0]})`, /50 of the hard share has no ticked tier/.test(noGp.report.notes[0]))

console.log(`\nALLOCATE: ${total - fails} of ${total} checks passed`)
process.exit(fails ? 1 : 0)
