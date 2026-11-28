// WICKED TRAILS (src/features/wickedTrails/lib/wickedTrails.js): two lanes filled together from Brut Wins, the ROE of
// each BW split between them until the easy lane is done, tiers as shares of a lane, the Final Prize from the takes.
//   npx vite-node scripts/verify/verify-wicked-trails.mjs
import { FEATURE_RULES_KEY, carryThrough, createState, normalizeFeatureRules, normalizeState, prizeOf, progressAt, resolveEfforts, ruleProblems, stepStatus, withTierCount, workOut } from '../../src/features/wickedTrails/lib/wickedTrails.js'
import { OPS_HEADERS, buildExport, exportFileName, rowSyntax } from '../../src/features/wickedTrails/lib/wickedTrailsExport.js'

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
const four = withTierCount(state.lanes.easy, 4)
check('a lane given 4 tiers splits them evenly and keeps the prizes by place; sections start easy then mid, nothing ticked', JSON.stringify({ shares: four.shares, prizes: four.prizes }) === JSON.stringify({ shares: [25, 25, 25, 25], prizes: ['free_undo:10', '', '', ''] }) && four.sections.join() === 'easy,easy,mid,mid' && four.auto.every((x) => !x))
check('a stored state reads back the same', JSON.stringify(normalizeState(JSON.parse(JSON.stringify(state)))) === JSON.stringify(normalizeState(state)))

// A segment's effort: typed, or another's x a factor (and a chain of them).
const chain = resolveEfforts({
  ...state,
  segments: [
    { name: 'A', key: 'a', effortTyped: 100 },
    { name: 'B', key: 'b', effortOf: 'a', effortFactor: 1.5 },
    { name: 'C', key: 'c', effortOf: 'b', effortFactor: 2 },
    { name: 'D', key: 'd', effortOf: 'e', effortFactor: 1 },
    { name: 'E', key: 'e', effortOf: 'd', effortFactor: 1 },
    { name: 'F', key: 'f', effortOf: 'a' },
  ],
})
const eff = Object.fromEntries(chain.segments.map((s) => [s.name, s]))
check(`effort typed, x a segment, x a segment that follows another (${['A', 'B', 'C'].map((n) => eff[n].effortBW).join(', ')})`, eff.A.effortBW === 100 && eff.B.effortBW === 150 && eff.C.effortBW === 300)
check('two segments following each other have no effort, and say why', eff.D.effortBW === null && /follows it back/.test(eff.D.effortProblem) && eff.E.effortBW === null)
check('a factor not typed is asked for', eff.F.effortBW === null && /factor of A/.test(eff.F.effortProblem))
check('an old save (effortBW only) reads as typed', normalizeState({ segments: [{ name: 'X', key: 'x', effortBW: 42 }] }).segments[0].effortTyped === 42)

// What each step still needs.
check('the rules ask for the first day: the DR values are read on the feature\'s days', stepStatus(normalizeState(state)).rules.missing.some((m) => /Pick the first day/.test(m)) && normalizeState(state).days === 2)
const st = stepStatus(normalizeState({ ...state, startDate: '2026-12-01' }))
check(`steps: segments, rules and tiers are done; prizes name what is missing (${st.prizes.missing.length})`, st.segments.done && st.rules.done && st.tiers.done && !st.prizes.done && st.prizes.missing.some((m) => /Hard lane, tier 1: no prize yet/.test(m)) && st.prizes.missing.some((m) => /Final Prize/.test(m)))
check('a new feature: every step says what it needs', !stepStatus(createState()).segments.done && stepStatus(createState()).rules.missing.some((m) => /ROE/.test(m)))

// The export, in the example's layout.
const ex = normalizeState({ ...state, segments: [{ ...state.segments[0], key: 'def_WT_A', condition: 'cond A' }], lanes: { easy: { shares: [50, 50], prizes: ['free_undo:4', 'free_wild:2'] }, hard: { shares: [25, 25, 50], prizes: ['free_entry:1', 'free_undo:8', 'chest:purple(free_wild:3)'] } }, finalPrize: 'allowance:milestone(coins:4)+free_entry:1' })
const out = buildExport(ex)
const col = (name, sheet = out.ops) => sheet[0][OPS_HEADERS.indexOf(name)]
check('one segment: the segments sheet holds its key without def_ and its condition', out.segments.length === 1 && out.segments[0][0] === 'WT_A' && out.segments[0][1] === 'cond A' && col('Segment') === 'def_WT_A')
check('Right is silver, Left is gold; the end trigger and the filter as in the example', col('$_Script->DR_Right') === 'dr-wicked-trails-dr-silver' && col('$_Script->DR_Left') === 'dr-wicked-trails-dr-gold' && col('$_Script->endTrigger') === 'trigger:wicked_trail_end' && col('$_Script->FinalPrize_Res_Filter') === 'chest|coins')
check(`requirements are the DR in all: right 50, 100; left 75, 150, 300; then 100 (${[0, 1, 2].map((i) => col(`$_Script->RightMilestone_${i}_Req`)).join(', ')})`, col('$_Script->MilestoneNum_Right') === 2 && col('$_Script->RightMilestone_0_Req') === 50 && col('$_Script->RightMilestone_1_Req') === 100 && col('$_Script->RightMilestone_2_Req') === 100 && col('$_Script->LeftMilestone_2_Req') === 300 && col('$_Script->MilestoneNum_Left') === 3)
check(`each tier's own trigger; the last tier of each lane in its chest (${col('$_Script->RightMilestone_1_Res')})`, col('$_Script->RightMilestone_0_Res') === 'trigger:wicked_trails_silver_tier1+free_undo:4' && col('$_Script->RightMilestone_1_Res') === 'chest:silver(trigger:wicked_trails_silver_tier2+free_wild:2)' && col('$_Script->LeftMilestone_0_Res') === 'trigger:wicked_trails_gold_tier1+free_entry:1')
check(`a prize typed as a chest keeps it, the trigger inside (${col('$_Script->LeftMilestone_2_Res')})`, col('$_Script->LeftMilestone_2_Res') === 'chest:purple(trigger:wicked_trails_gold_tier3+free_wild:3)')
check('a milestone with no tier: [dynamic(dr-hidden:1)]', col('$_Script->RightMilestone_2_Res') === '[dynamic(dr-hidden:1)]' && col('$_Script->LeftMilestone_7_Res') === '[dynamic(dr-hidden:1)]')
check(`the Final Prize with its trigger (${col('$_Script->FinalPrize_Res')})`, col('$_Script->FinalPrize_Res') === 'trigger:wicked_trails_grand_prize+allowance:milestone(coins:4)+free_entry:1')
check(`RC: every tier 50% more, the Final Prize's coins 40% more (${col('$_Script->LeftMilestone_2_Req', out.rc)}, ${col('$_Script->FinalPrize_Res', out.rc)})`, col('$_Script->RightMilestone_0_Req', out.rc) === 75 && col('$_Script->LeftMilestone_2_Req', out.rc) === 450 && col('$_Script->FinalPrize_Res', out.rc) === 'trigger:wicked_trails_grand_prize+allowance:milestone(coins:5.6)+free_entry:1' && col('$_Script->RightMilestone_2_Req', out.rc) === 100)
check('every row has the example\'s 42 columns', OPS_HEADERS.length === 42 && out.ops[0].length === 42 && out.rc[0].length === 42)
check(`the file is named as the example (${exportFileName('2026-11-16')})`, exportFileName('2026-11-16') === 't_Promo_st_WickedTrail_n_WickedTrail_d_20261116.xlsx')
check('a segment not worked out is left out and named', buildExport({ ...ex, segments: [{ ...ex.segments[0], goldPerBW: null }] }).problems.some((p) => /left out/.test(p)))

// The carry along a lane: what a tier leaves goes to the next.
const cr = carryThrough([{ target: 10, worth: 9 }, { target: 10, worth: 11 }, { target: 10, worth: 12 }])
check(`1 short on tier 1: tier 2 has 1 more to give; off by is the lane so far (${cr.map((x) => `${x.carry}/${x.aim}/${x.off}`).join(' ')})`, cr[0].off === -1 && cr[1].carry === 1 && cr[1].aim === 11 && cr[1].off === 0 && cr[2].carry === 0 && cr[2].off === 2)
const ce = carryThrough([{ target: 10, worth: 0 }, { target: 10, worth: 20 }])
check('a tier with no prize passes its whole target on', ce[1].carry === 10 && ce[1].aim === 20 && ce[1].off === 0)
const cu = carryThrough([{ target: 10, worth: null }, { target: 10, worth: 10 }])
check('a worth not known: its off and the carry after it are not known', cu[0].off === null && cu[1].carry === null && cu[1].off === null)

// The row we are on, as Ops gets it.
const rs = rowSyntax(ex, 0, 'easy-1')
check(`a lane's last tier, as Ops gets it: its Req (and RC's) and its Res in the chest (${rs.cells[1].ops})`, rs.title === 'Easy lane, tier 2' && rs.cells[0].column === '$_Script->RightMilestone_1_Req' && rs.cells[0].ops === 100 && rs.cells[0].rc === 150 && rs.cells[1].ops === 'chest:silver(trigger:wicked_trails_silver_tier2+free_wild:2)')
const rf = rowSyntax(ex, 0, 'final')
check(`the Final Prize, as Ops gets it: RC's coins 40% more (${rf.cells[0].rc})`, rf.cells[0].ops === 'trigger:wicked_trails_grand_prize+allowance:milestone(coins:4)+free_entry:1' && rf.cells[0].rc === 'trigger:wicked_trails_grand_prize+allowance:milestone(coins:5.6)+free_entry:1')

// The feature's rules: kept apart from the event; starting values; a min above the max is not kept.
const fr = normalizeFeatureRules(null)
check(`the feature's rules start at a tier 2-4 items, the Final Prize 3-5, no chest (${JSON.stringify(fr)})`, fr.items.tier.min === 2 && fr.items.tier.max === 4 && fr.items.final.min === 3 && fr.items.final.max === 5 && Object.values(fr.chests).every((c) => c === '') && FEATURE_RULES_KEY !== 'superplay-wicked-trails')
const fr2 = normalizeFeatureRules({ items: { tier: { min: 5, max: 3 }, final: { min: 0, max: 'x' } }, chests: { mid: 'silver', hard: 7 } })
check(`kept as typed where it can be: max never under min, a bad number the start value (${JSON.stringify(fr2)})`, fr2.items.tier.min === 5 && fr2.items.tier.max === 5 && fr2.items.final.min === 3 && fr2.items.final.max === 5 && fr2.chests.mid === 'silver' && fr2.chests.hard === '')

console.log(`\nWICKED TRAILS: ${total - fails} of ${total} checks passed`)
process.exit(fails ? 1 : 0)
