// WICKED TRAILS (src/features/wickedTrails/lib/wickedTrails.js): two lanes filled together from Brut Wins, the ROE of
// each BW split between them until the easy lane is done, tiers as shares of a lane, the Final Prize from the takes.
//   npx vite-node scripts/verify/verify-wicked-trails.mjs
import { createState, normalizeState, prizeOf, progressAt, ruleProblems, withTierCount, workOut } from '../../src/features/wickedTrails/lib/wickedTrails.js'

let fails = 0
let total = 0
const check = (name, cond, extra = '') => {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}${!cond && extra ? `  [${extra}]` : ''}`)
}
const near = (a, b, d = 0.02) => Math.abs(a - b) <= d

// A worked example, by hand: 100 Brut Wins, ROE 1, the easy lane a third of each BW while both fill and half as long
// as the hard one; 2 silver and 3 gold a BW; easy tiers 50/50, hard 25/25/50; takes 20% and 40%; counted at 50%.
const state = createState()
state.rules = { roe: 1, easyShare: 100 / 3, easySize: 50, takeEasy: 20, takeHard: 40, finalCounted: 50 }
state.lanes.easy = { shares: [50, 50], prizes: ['free_undo:10', ''] }
state.lanes.hard = { shares: [25, 25, 50], prizes: ['', '', ''] }
state.segments = [
  { name: 'A', effortBW: 100, silverPerBW: 2, goldPerBW: 3, own: {} },
  { name: 'B', effortBW: 250, silverPerBW: 2, goldPerBW: 3, own: {} },
]
const w = workOut(state, state.segments[0])
check('nothing to fix in the example', w.problems.length === 0, w.problems.join(' | '))
check(`the easy lane is done after 50 BW with 100 silver; the hard lane after 100 BW with 300 gold`, w.lanes.easy.doneAtBW === 50 && w.lanes.easy.totalDR === 100 && w.lanes.hard.doneAtBW === 100 && w.lanes.hard.totalDR === 300)
check(`the easy lane earns a third of 50 BW (16.67), the hard lane the rest of 100 (83.33)`, near(w.lanes.easy.earned, 16.67) && near(w.lanes.hard.earned, 83.33))
const e = w.lanes.easy.tiers
const h = w.lanes.hard.tiers
check(`tier DR: easy 50 + 50, hard 75 + 75 + 150 (${e.map((t) => t.dr).join('+')} / ${h.map((t) => t.dr).join('+')})`, e[0].dr === 50 && e[1].dr === 50 && h[0].dr === 75 && h[1].dr === 75 && h[2].dr === 150)
check(`easy tiers earn 8.33 each and keep 80%: 6.67 (${e.map((t) => t.target).join(', ')})`, near(e[0].earned, 8.33) && near(e[0].target, 6.67) && near(e[1].target, 6.67))
check(`hard tiers: 16.67 while sharing, then 50 alone; they keep 60%: 10, 10, 30 (${h.map((t) => t.target).join(', ')})`, near(h[0].earned, 16.67) && near(h[2].earned, 50) && near(h[0].target, 10) && near(h[1].target, 10) && near(h[2].target, 30))
check(`the Final Prize pool is 20% of easy + 40% of hard = 36.67, its worth should be the pool / 50% = 73.33 (${w.pool}, ${w.finalTarget})`, near(w.pool, 36.67) && near(w.finalTarget, 73.33))
check('everything adds up to effort x ROE: tiers + pool = 100', near([...e, ...h].reduce((s, t) => s + t.target, 0) + w.pool, 100, 0.05) && w.total === 100)

// Another segment: the base's prize times its effort against the base's.
check(`segment B's prize is the base's x 250/100 (${prizeOf(state, 1, 'easy-0').text})`, prizeOf(state, 1, 'easy-0').text === 'free_undo:25' && !prizeOf(state, 1, 'easy-0').own)
state.segments[1].own = { 'easy-0': 'free_undo:30' }
check('a prize typed for a segment is its own', prizeOf(state, 1, 'easy-0').text === 'free_undo:30' && prizeOf(state, 1, 'easy-0').own)
check('the base segment\'s prize is the one typed', prizeOf(state, 0, 'easy-0').text === 'free_undo:10' && prizeOf(state, 0, 'easy-0').own)
const wB = workOut(state, state.segments[1])
check(`worth follows effort: B's targets are 2.5x A's (${wB.lanes.hard.tiers[2].target})`, near(wB.lanes.hard.tiers[2].target, 75, 0.05) && near(wB.finalTarget, 183.33, 0.05))

// The mock: where a player is after some Brut Wins.
const p30 = progressAt(w, state.segments[0], 30)
check(`after 30 BW: 60 silver (tier 1 done, 10 of 50 into tier 2), 90 gold (tier 1 done, 15 of 75)`, p30.easy.collected === 60 && p30.easy.done === 1 && p30.easy.into === 10 && p30.hard.collected === 90 && p30.hard.done === 1 && p30.hard.into === 15 && p30.lanesDone === 0)
const p60 = progressAt(w, state.segments[0], 60)
check('after 60 BW: the easy lane is finished, the hard one not', p60.easy.finished && !p60.hard.finished && p60.lanesDone === 1)
check('after the whole effort both lanes are done', progressAt(w, state.segments[0], 100).lanesDone === 2)

// What is missing is said.
const blank = createState()
check('a new feature asks for the ROE', ruleProblems(blank).some((p) => /ROE/.test(p)))
const bad = { ...state, lanes: { ...state.lanes, hard: { shares: [25, 25, 40], prizes: ['', '', ''] } } }
check('tiers that do not add up to 100% are named', ruleProblems(bad).some((p) => /Hard lane: the tiers add up to 90%/.test(p)))
check('a segment without its multipliers says which', workOut(state, { effortBW: 10, silverPerBW: 1 }).problems.some((p) => /gold DR per Brut Win/.test(p)))
check('a lane given 4 tiers splits them evenly and keeps the prizes by place', JSON.stringify(withTierCount(state.lanes.easy, 4)) === JSON.stringify({ shares: [25, 25, 25, 25], prizes: ['free_undo:10', '', '', ''] }))
check('a stored state reads back the same', JSON.stringify(normalizeState(JSON.parse(JSON.stringify(state)))) === JSON.stringify(normalizeState(state)))

console.log(`\nWICKED TRAILS: ${total - fails} of ${total} checks passed`)
process.exit(fails ? 1 : 0)
