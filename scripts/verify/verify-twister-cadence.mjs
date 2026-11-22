// The Twister timed on the DR spent, and the strict merge rule - engine checks.
// Run with: npx vite-node scripts/verify/verify-twister-cadence.mjs
//
// Economist (via a written brief): the twists asked should be reached "around
// 70-75% of their segment's DR demand spent" - demand progression = paid
// generator DR / the segment's DR demand, never clamped; a spin whenever the
// balance affords one, several from one collection, the rest kept; every
// reward upgrade strictly rewards merging ("V2 > 2 x V1 ... Equality is
// insufficient"); drop-rule candidates are experiments, never the default.
import { createBoard, withListPhase, boardMinRank } from '../../src/features/merge/lib/core/board.js'
import { isMainItem, withBlankCoinValues, niceRewardValues, niceCoinValues, validateRewardLadder, suggestLadderFixes, REWARD_TYPES, TWISTER_TYPE } from '../../src/features/merge/lib/rewards/rewardChain.js'
import { withDefaultTwisterValues, roundTwisterValues, TWISTER_DEFAULT_VALUES, createTwisterPlan, normalizeTwisterPlan } from '../../src/features/merge/lib/rewards/twisterEconomy.js'
import { buildEvent, segmentBuildInputs, rcInputsOnMainDraft, boardsWithDraftApplied, buildInputParts, changedInputParts, INPUT_PART_LABELS, demandToleranceFor, allocateSubsidy, maxFeasibleBoardValue, demandJumpOf } from '../../src/features/merge/lib/build/eventBuild.js'
import { createDropGroupsConfig } from '../../src/features/merge/lib/rewards/dropGroups.js'
import { demandMarginFor, withTwisterMarks, draftStatusOf } from '../../src/features/merge/lib/build/eventBuild.js'
import { twisterMark, TWISTER_WINDOW_MARGIN_PTS } from '../../src/features/merge/lib/rewards/twisterCadence.js'
import { spendMatch, twisterMatch } from '../../src/features/merge/lib/build/resultMatch.js'
import { validateConfigAcrossRuns } from '../../src/features/merge/lib/rewards/rewardEconomy.js'
import { buildSmallRewardsSheet, buildV2TwisterSheet, buildSmallRewardWeightsSheet } from '../../src/features/merge/lib/export/eventSheets.js'
import { createPlaySession, mergeItems } from '../../src/features/merge/lib/simulation/playSession.js'
import { encodeStage, decodeStage } from '../../src/features/merge/lib/share/stageShare.js'
import { simulatePlaythrough } from '../../src/features/merge/lib/simulation/mergeSimulation.js'
import { mulberry32 } from '../../src/features/merge/lib/rewards/rewardEconomy.js'
import { playerSpins, cadenceSummary, fitTwisterToWindow, fitTwisterAcrossPhases, twisterValuesFor, recordCadenceRuns, measureCandidate, phaseDemand, candidateById, combineCandidates, CADENCE_CANDIDATES, TWISTER_WINDOW_PCT, TWISTER_FIT_TOPS, timingOf, rcCarryScenarios } from '../../src/features/merge/lib/rewards/twisterCadence.js'

let failures = 0
let count = 0
function check(name, cond) {
  count += 1
  if (cond) console.log(`  OK  ${name}`)
  else {
    failures++
    console.log(`FAIL  ${name}`)
  }
}
const strict = (v) => v[1] > 2 * v[0] && v[2] > 2 * v[1] && v[3] > 2 * v[2]
const asLadder = (values) => values.map((prizeAmount) => ({ prizeAmount }))

console.log('--- 1. Every upgrade strictly rewards merging ---')
{
  const tops = [1, 3, 10, 15, 18, 25, 33, 40, 50, 61, 75, 96, 148, 200, 260, 730, 2400]
  const ladders = tops.map((top) => niceRewardValues(top))
  check(`the values the model gives are more than double at every rank, at any size (${[10, 50, 75, 200].map((t) => `${t}: ${niceRewardValues(t).join('/')}`).join(', ')})`, ladders.every(strict))
  check('...the smallest whole-number ladder being 1/3/7/15', niceRewardValues(1).join() === '1,3,7,15' && niceRewardValues(12).join() === '1,3,7,15')
  check(`coin values too (${niceCoinValues(0.6).join('/')}, ${niceCoinValues(0.05).join('/')})`, [0.05, 0.136, 0.2, 0.31, 0.6, 0.87, 1.234].map(niceCoinValues).every(strict))
  check(`...and the Twister's, at every size the build can scale them to (${roundTwisterValues(1).join('/')}, x2.5 ${roundTwisterValues(2.5).join('/')}, x5 ${roundTwisterValues(5).join('/')})`, [1, 1.3, 1.7, 2.2, 2.5, 3.5, 4.2, 5, 7].map(roundTwisterValues).every(strict) && TWISTER_FIT_TOPS.map(twisterValuesFor).every(strict))
  const equal = validateRewardLadder(asLadder([3, 10, 20, 50]))
  check('a ladder where a merge pays exactly what the two items do is flagged (3/10/20/50: 20 is not more than 2 x 10)', equal.length === 1 && equal[0].code === 'merge-step-pays-no-more' && equal[0].rank === 2)
  check('...one where it pays less is still "loses value", and a strict one passes', validateRewardLadder(asLadder([5, 15, 15, 40])).some((i) => i.code === 'merge-step-loses-value') && validateRewardLadder(asLadder([5, 15, 35, 75])).length === 0 && validateRewardLadder(asLadder(TWISTER_DEFAULT_VALUES)).length === 0)
  const fixes = suggestLadderFixes(asLadder([3, 10, 20, 50]))
  check(`a typed ladder is never changed on its own: it gets fixes to choose from (${fixes.map((f) => `${f.id} ${f.values.join('/')}`).join('; ')}), each of them strict`, fixes.length >= 1 && fixes.every((f) => strict(f.values)))
}

console.log('--- 2. Spins, from what a player collected and when ---')
{
  // 1000 DR of demand; Twister items finished at 100, 400, 700 DR paid and a leftover tapped when the phase ended at 900.
  const record = { phaseDr: 900, collects: [[100, 4, false], [400, 4, false], [700, 4, false], [900, 2, true]], drops: [], merges: {}, mergeDr: {}, payouts: {}, completed: true }
  const p = playerSpins(record, { values: [2, 5, 12, 30], cost: 10, target: 7, demand: 1000 })
  check('a spin is taken whenever the balance affords one - three from one finished item worth 30 at 10 DR a twist', p.opportunities.length === 3 && p.opportunities[0].spins === 3 && p.spins === 9)
  check('...and what is left over is kept (30 x 3 + 5 = 95 collected, 9 twists, 5 left)', p.earned === 95 && p.balanceLeft === 5)
  check('progress is paid DR over the demand: first spin at 10%, the twists asked (7) at 70%', p.firstSpinPct === 10 && p.targetPct === 70 && p.targetAtEnd === false)
  check('spins by 25 / 50 / 75% of the demand are 3 / 6 / 9', p.spinsAt(25) === 3 && p.spinsAt(50) === 6 && p.spinsAt(75) === 9)
  check('what is tapped when the top rank is made counts then, and is named as the phase-end collection', p.endAmount === 5 && p.earnedInPlay === 90 && p.finishedItems === 3)
  check('the longest wait between two chances to spin is 30 points here', p.longestGap === 30)
  const dear = playerSpins(record, { values: [2, 5, 12, 30], cost: 40, target: 2, demand: 1000 })
  check('a twist can cost more than one item pays: at 40 DR the first twist comes with the second item (40%), the second with the third', dear.firstSpinPct === 40 && dear.opportunities.map((o) => o.spins).join() === '1,1' && dear.targetPct === 70 && dear.balanceLeft === 15)
  const over = playerSpins({ ...record, phaseDr: 1180, collects: [[1150, 4, false]] }, { values: [2, 5, 12, 30], cost: 10, target: 3, demand: 1000 })
  check('a player who spends more than the demand is past 100%: nothing is clamped (115%, phase ends at 118%)', Math.abs(over.targetPct - 115) < 1e-9 && Math.abs(over.endPct - 118) < 1e-9)
  const never = playerSpins({ ...record, collects: [[900, 3, true]] }, { values: [2, 5, 12, 30], cost: 10, target: 5, demand: 1000 })
  check('a player with only a phase-end collection is named: first income at the end, the twists never reached', never.firstIncomeAtEnd === true && never.firstSpinAtEnd === true && never.targetPct === null && never.spins === 1)
  const group = [record, { ...record, phaseDr: 600, collects: [[300, 4, false]] }, { ...record, collects: [] }]
  const s = cadenceSummary(group, { values: [2, 5, 12, 30], cost: 10, target: 7, demand: 1000 })
  check('over a group nobody is dropped: one of three reaches the twists, two never do, one never spins', s.players === 3 && Math.abs(s.neverTarget - 2 / 3) < 1e-9 && Math.abs(s.noSpin - 1 / 3) < 1e-9 && s.targetMedianAll === null)
  check('...a player whose phase ended before a mark is counted as finished before it (one of three before 75%)', Math.abs(s.spinsAtMarks[75].finishedBefore - 1 / 3) < 1e-9 && s.spinsAtMarks[100].finishedBefore === 1)
  check('the short form a screen shows says "never" when the typical player does not reach the twists', timingOf(s).verdict === 'never' && timingOf(cadenceSummary([record], { values: [2, 5, 12, 30], cost: 10, target: 7, demand: 1000 })).verdict === 'in-window')
}

console.log('--- 3. Values and price for the window ---')
{
  // Twenty players who each finish an item every 5% of a 1000 DR demand.
  const steady = Array.from({ length: 20 }, () => ({ phaseDr: 900, collects: Array.from({ length: 18 }, (_, k) => [(k + 1) * 50, 4, false]) }))
  const fit = fitTwisterToWindow(steady, { demand: 1000, target: 15, step: 10 })
  check(`with an item every 5 points the twists land in the window (${fit.values.join('/')} at ${fit.cost} DR: typical player at ${fit.medianPct}%)`, fit.inWindow && fit.medianPct >= TWISTER_WINDOW_PCT[0] && fit.medianPct <= TWISTER_WINDOW_PCT[1])
  check('...with the simplest numbers: the smallest values (the 2/5/12/30 start) and a whole-step price', fit.values.join() === TWISTER_DEFAULT_VALUES.join() && fit.cost % 10 === 0 && strict(fit.values))
  // Three items only, at 20 / 50 / 90%: no price can put the twists between 70 and 75.
  const jumpy = Array.from({ length: 20 }, () => ({ phaseDr: 950, collects: [[200, 4, false], [500, 4, false], [900, 4, false]] }))
  const coarse = fitTwisterToWindow(jumpy, { demand: 1000, target: 15, step: 10 })
  check(`with three finished items the window cannot be hit, and it says where the twists CAN land (${coarse.reachable.join(', ')}%)`, !coarse.inWindow && coarse.miss > 0 && coarse.reachable.every((v) => [20, 50, 90].includes(v)))
  const locked = fitTwisterToWindow(steady, { demand: 1000, target: 15, step: 10, locked: [4, 10, 25, 65] })
  check(`values that are not the fit's to choose are kept, and only the price is fitted (${locked.values.join('/')} at ${locked.cost} DR)`, locked.values.join() === '4,10,25,65' && locked.cost > 0)
  const both = fitTwisterAcrossPhases([{ records: steady, demand: 1000, target: 15, step: 10 }, { records: steady, demand: 1000, target: 10, step: 10 }])
  check(`the normal event and Recompletion get ONE set of values and a price each (${both.values.join('/')}: ${both.phases.map((f) => f.cost).join(' and ')} DR)`, both.inWindow && both.phases.every((f) => f.values.join() === both.values.join() && f.inWindow) && both.phases[0].cost !== both.phases[1].cost)
}

console.log('--- 4. The clock in the simulator, and a built event ---')
function chain(values) {
  return values.map((v, i) => {
    const b = createBoard(`Board ${i + 1}`, { rows: i === 0 ? 5 : 3, cols: 8 })
    const from = i === 0 ? 3 : 1
    b.tiles = b.tiles.map((row, r) => row.map(() => (r >= from ? 'blocked' : 'open')))
    if (i === 0) b.tiles[2][4] = 'semi'
    b.blockedValue = v
    b.minDropRank = 6
    b.twisterByBuild = true
    b.rewardChainConfig = withDefaultTwisterValues(withBlankCoinValues(b.rewardChainConfig))
    return b
  })
}
const raw = [[150, 720, 880], [150, 380, 470]].map((values, i) => ({
  name: `Segment ${i + 1}`,
  mainBoards: chain(values),
  rcBoards: [],
  rewardTargets: { main: { coins: 3, puzzles: 300, energy: 200, charms: 400 } },
  segmentFactor: 1 + i * 0.2,
  sourceAllocation: {},
  twisterPlan: { main: { targetSpins: 15, targetSpinsOverrides: {}, costIncrement: 10, roundPrice: true, checkpointPct: 100 } },
}))
const draft = await buildEvent({ phase: 'main', segments: segmentBuildInputs(raw, 'main') })
const boardsOf = (i) => boardsWithDraftApplied(raw[i].mainBoards, draft.segments[i], draft.shared, { draft })
const mains = raw.map((_, i) => boardsOf(i))
{
  const b0 = mains[0][0]
  const run = simulatePlaythrough(mains[0], { rewardChainConfig: b0.rewardChainConfig, dropGroupsConfig: b0.dropGroupsConfig, dropGroupsById: new Map(b0.dropGroups.map((g) => [g.id, g])), minDropRank: b0.minDropRank, leftoverPolicy: b0.rewardLeftoverPolicy, dropRng: mulberry32(4), luckRng: mulberry32(5), cadence: true })
  const c = run.cadence
  check(`the simulator keeps the paid DR of every Twister collection and merge (${c.collects.length} collections, ${c.merges.length} merges, phase ended at ${c.phaseEndDr.main} DR paid)`, c.collects.length > 0 && c.merges.length > 0 && c.phaseEndDr.main === run.drSpent)
  check('...in order, never after the phase ended, and only what is tapped at the top rank is marked as the phase-end collection', c.collects.every((e, k) => (k === 0 || e[1] >= c.collects[k - 1][1]) && e[1] <= c.phaseEndDr.main) && c.collects.filter((e) => e[4]).every((e) => e[1] === c.phaseEndDr.main) && c.collects.some((e) => !e[4] && e[3] === 4))
  const byRank = {}
  for (const [, , rank] of c.merges) byRank[rank] = (byRank[rank] ?? 0) + 1
  check('its merge list is the run\'s own merges, rank by rank', Object.keys(run.mergeCountsByRank).every((rank) => byRank[rank] === run.mergeCountsByRank[rank]))
  check(`free merge-energy taps add nothing to the paid DR (${run.energySpent} free taps on top of ${run.drSpent} DR paid)`, run.energySpent > 0 && c.phaseEndDr.main === run.drSpent)
  check('a run that does not ask for it carries no such record', simulatePlaythrough(mains[0], { rewardChainConfig: b0.rewardChainConfig }).cadence === null)
  check(`a segment's demand is the chase less the DR under its tiles (${phaseDemand('main', mains[0])} and ${phaseDemand('main', mains[1])} DR)`, phaseDemand('main', mains[0]) === 2048 - 1750 && phaseDemand('main', mains[1]) === 2048 - 1000)
}
{
  const rows = draft.twister.rows
  check(`the build's Twister table says when each segment reaches the twists, in % of the DR demand spent (${rows.map((r) => `${r.name}: ${r.demandTiming?.reachPct == null ? 'never' : Math.round(r.demandTiming.reachPct) + '%'}, ${r.demandTiming?.verdict}`).join('; ')})`, rows.every((r) => r.demandTiming && r.demandTiming.window.join() === '70,75' && ['in-window', 'early', 'late', 'never'].includes(r.demandTiming.verdict) && r.demandTiming.cost === r.cost))
  check(`...with where the phase ends in the same units (${rows.map((r) => Math.round(r.demandTiming.endPct) + '%').join(', ')}), the first spin, the chances to spin and the longest wait`, rows.every((r) => r.demandTiming.endPct > 50 && r.demandTiming.firstSpinPct != null && r.demandTiming.chances > 0 && r.demandTiming.longestGap > 0 && [25, 50, 70, 75, 100].every((mark) => r.demandTiming.spinsAt[mark] != null)))
  check(`the build prices a twist per segment, with that segment's own values (${rows.map((r) => `${r.values.join('/')} at ${r.cost}`).join('; ')})`, rows.every((r) => r.cost > 0 && r.cost % 10 === 0 && r.spinsMedian >= 15 && r.values.join() === mains[r.index][0].rewardChainConfig[TWISTER_TYPE].map((x) => x.prizeAmount).join() && mains[r.index][0].twisterSpinCost === r.cost))
  // THE PRICE IS WHATEVER MAKES IT WORK: a build fits any whole price. A step
  // only counts when rounding was switched on; one saved before that rule is not used.
  const stepOf = (plan) => segmentBuildInputs([{ ...raw[0], twisterPlan: { main: plan } }], 'main')[0].twisterCostStep
  check(
    'a build fits any whole price: a step of 10 saved earlier is not used, a step typed with rounding switched on is',
    stepOf({ targetSpins: 15, targetSpinsOverrides: {}, costIncrement: 10, checkpointPct: 100 }) === 1 &&
      stepOf(normalizeTwisterPlan({ targetSpins: 15, costIncrement: 10 })) === 1 &&
      stepOf({ targetSpins: 15, targetSpinsOverrides: {}, costIncrement: 10, roundPrice: true, checkpointPct: 100 }) === 10 &&
      stepOf({ targetSpins: 15, targetSpinsOverrides: {}, costIncrement: 1, roundPrice: true, checkpointPct: 100 }) === 1 &&
      createTwisterPlan().roundPrice === false,
  )
  const ladders = mains.map((boards) => boards[0].rewardChainConfig)
  check(`every value the build gave is more than double the rank below (${REWARD_TYPES.map((t) => ladders[0][t].map((r) => r.prizeAmount).join('/')).join('; ')}; Twister ${ladders[0][TWISTER_TYPE].map((r) => r.prizeAmount).join('/')})`, ladders.every((cfg) => [...REWARD_TYPES, TWISTER_TYPE].every((t) => strict(cfg[t].map((r) => r.prizeAmount)))))
}

console.log('--- 5. The two Twister drop rules, and experiments that stay experiments ---')
{
  const b0 = mains[0][0]
  const base = { dropGroups: b0.dropGroups, dropGroupsConfig: b0.dropGroupsConfig, minDropRank: b0.minDropRank }
  const itemsOf = (drops, rank) => (drops.dropGroupsConfig[rank - 1]?.entries ?? []).map((e) => [e.weight, Object.entries(drops.dropGroups.find((g) => g.id === e.groupId).items).sort()])
  const itemsAt = (drops, rank) => JSON.stringify(itemsOf(drops, rank).sort())
  const rewardsAt = (drops, rank) => JSON.stringify(itemsOf(drops, rank).map(([, items]) => items.filter(([k]) => k !== TWISTER_TYPE)))
  check(`the build's table: a merge that makes rank 5 drops exactly one rank-1 Twister item - the Twister only, the rewards still start at rank 6 (${itemsAt(base, 5)})`, b0.minDropRank === 6 && b0.dropGroupsConfig[4].belowStart === true && itemsAt(base, 5) === JSON.stringify([[1000, [[TWISTER_TYPE, 1]]]]) && (b0.dropGroupsConfig[3].entries ?? []).length === 0)
  check(`...and a merge that makes rank 7 always drops two items: its reward and the Twister item (${itemsAt(base, 7)})`, itemsOf(base, 7).every(([, items]) => items.length === 2 && items.some(([k]) => k === TWISTER_TYPE)) && itemsOf(base, 7).reduce((sum, [w]) => sum + w, 0) === 1000)
  check('...the rank-6 item, the two-item ranks and the three-item ranks are as they were', itemsOf(base, 6).every(([, items]) => items.length === 1 && items[0][0] !== TWISTER_TYPE) && [8, 9].every((rank) => itemsOf(base, rank).every(([, items]) => items.length === 2)) && [10, 11, 12].every((rank) => itemsOf(base, rank).every(([, items]) => items.length === 3)))
  check('no rank drops an item above rank 3', b0.dropGroups.every((g) => Object.values(g.items).every((r) => r <= 3)))

  // The engine: a rank-5 merge rolls the marked row; an unmarked row under the start rank never does.
  const tiny = { ...createBoard('t', { rows: 2, cols: 3 }), tiles: Array.from({ length: 2 }, () => Array(3).fill('open')), semiPlacements: [], blockedQueue: [], dropGroups: b0.dropGroups, dropGroupsConfig: b0.dropGroupsConfig, minDropRank: 6, rewardChainConfig: b0.rewardChainConfig }
  const dropsOf = (board, rank) => {
    const session = createPlaySession([board], 0, {})
    session.state.itemAt[0][0] = rank - 1
    session.state.itemAt[0][1] = rank - 1
    mergeItems(session, [0, 0], [0, 1])
    return session.events.filter((e) => e.type === 'merge-drop').map((e) => `${e.rewardType}${e.rank}`)
  }
  const unmarked = { ...tiny, dropGroupsConfig: b0.dropGroupsConfig.map((t) => (t.rank === 5 ? { ...t, belowStart: false } : t)) }
  check(`on the play engine a merge that makes rank 5 drops the Twister item (${dropsOf(tiny, 5).join()}), rank 4 drops nothing, and the same row without its mark stays under the start rank`, dropsOf(tiny, 5).join() === 'twister1' && dropsOf(tiny, 4).length === 0 && dropsOf(unmarked, 5).length === 0)
  const link = decodeStage(encodeStage(mains[0]))
  check('a play link carries the rank-5 row and its mark', link.boards[0].dropGroupsConfig[4].belowStart === true && link.boards[0].dropGroupsConfig[4].entries.length === 1 && link.boards[0].minDropRank === 6)
  const weights = buildSmallRewardWeightsSheet(mains[0], {})
  const tier5 = weights.rows.find((r) => r.cells[0] === 5)
  check(`the Ops weights sheet has merge tier 5 dropping its container (row: ${tier5?.cells.join(' ')})`, !!tier5 && tier5.cells.slice(1, -1).some((w) => w === 1000) && tier5.cells.at(-1) === 0 && weights.rows.find((r) => r.cells[0] === 4).cells.slice(1, -1).every((w) => w === 0))

  // The candidates, on a small table of the old shape: each changes one thing.
  const groups = [
    { id: 'c', name: 'c', items: { coins: 1 }, auto: true },
    { id: 'e', name: 'e', items: { energy: 1 }, auto: true },
    { id: 'et', name: 'et', items: { energy: 1, [TWISTER_TYPE]: 1 }, auto: true },
    { id: 'ct', name: 'ct', items: { charms: 3, [TWISTER_TYPE]: 2 }, auto: true },
    { id: 'three', name: 'three', items: { puzzles: 3, charms: 3, energy: 2 }, auto: true },
  ]
  const tables = createDropGroupsConfig(14).map((t) => ({ ...t, noDropWeight: t.rank >= 6 && t.rank <= 12 ? 0 : t.noDropWeight, entries: t.rank === 6 ? [{ groupId: 'c', weight: 1000 }] : t.rank === 7 ? [{ groupId: 'e', weight: 333 }, { groupId: 'et', weight: 667 }] : t.rank === 8 || t.rank === 9 ? [{ groupId: 'ct', weight: 1000 }] : t.rank >= 10 && t.rank <= 12 ? [{ groupId: 'three', weight: 1000 }] : [] }))
  const old = { dropGroups: groups, dropGroupsConfig: tables, minDropRank: 6 }
  check('"current" is the table as it is', candidateById('current').apply(old) === old && candidateById('current').rules.length === 0)
  const r5 = candidateById('rank5').apply(old)
  check('"Twister from rank 5" adds one rank-1 Twister item at rank 5 and changes no other rank', r5.minDropRank === 5 && itemsAt(r5, 5) === JSON.stringify([[1000, [[TWISTER_TYPE, 1]]]]) && [6, 7, 8, 9, 10, 11, 12].every((rank) => itemsAt(r5, rank) === itemsAt(old, rank)) && candidateById('rank5').rules.length === 1)
  const r7 = candidateById('rank7always').apply(old)
  check('"every rank-7 drop" puts the Twister item in all of rank 7\'s drops and changes no other rank', itemsOf(r7, 7).every(([, items]) => items.some(([k]) => k === TWISTER_TYPE)) && itemsOf(r7, 7).reduce((sum, [w]) => sum + w, 0) === 1000 && [6, 8, 9, 10, 11, 12].every((rank) => itemsAt(r7, rank) === itemsAt(old, rank)))
  const big = candidateById('bigger').apply(base)
  const twisterRanks = (drops) => drops.dropGroupsConfig.flatMap((t) => (t.entries ?? []).map((e) => drops.dropGroups.find((g) => g.id === e.groupId).items[TWISTER_TYPE])).filter((r) => r != null)
  check(`"bigger items" raises every Twister item one rank, rank 3 at most, and touches no reward (${twisterRanks(base).join('')} -> ${twisterRanks(big).join('')}) - an experiment: the build's own items are not raised`, twisterRanks(big).every((r, k) => r === Math.min(3, twisterRanks(base)[k] + 1)) && [6, 7, 8, 9, 10, 11, 12].every((rank) => rewardsAt(big, rank) === rewardsAt(base, rank)) && twisterRanks(base)[0] === 1)
  check('every candidate that breaks a drop rule in force says which', CADENCE_CANDIDATES.filter((c) => !['current', 'bigger', 'bigger79'].includes(c.id)).every((c) => c.rules.length >= 1 && c.changes.length > 20) && combineCandidates(['rank5', 'rank7always']).rules.length === 2)
}

console.log('--- 6. Demand is the DR a player really pays ---')
{
  const fits = draft.segments.map((seg) => seg.demandFit)
  check(`the build moves the subsidy until the average player pays the demand inside the pass mark (5% of it or 30 DR, the smaller) - or says the search did not settle, with the range it found (${draft.segments.map((seg) => `${seg.name}: ${Math.round(seg.demandFit.paid.mean)} of ${seg.demandFit.configured}, ${seg.demandFit.differencePct.toFixed(1)}%${seg.demandFit.inMargin ? '' : ' ' + seg.demandFit.constraint}`).join('; ')})`, fits.every((f) => f.calibrated && (!f.within || Math.abs(f.difference) <= demandToleranceFor('main', f.configured)) && (f.inMargin ? Math.abs(f.difference) <= demandMarginFor(f.configured) + 1e-9 && f.margin === demandMarginFor(f.configured) && f.constraint === null && f.limit === null : f.limit === 'not-settled' && f.spendRange.low <= f.spendRange.high)) && fits.some((f) => f.inMargin))
  check(`...by a signed amount of its own, apart from the 80% merge-energy credit, and every step of the accounting adds up (${draft.segments.map((seg) => `${Math.round(seg.demandFit.steps.initial)} - ${Math.round(seg.demandFit.steps.energyCredit)} ${seg.demandFit.steps.calibration >= 0 ? '-' : '+'} ${Math.round(Math.abs(seg.demandFit.steps.calibration))} = ${seg.demandFit.steps.generated}`).join('; ')})`, draft.segments.every((seg) => Math.abs(seg.subsidy.creditApplied - 0.8 * seg.subsidy.energyCollected) <= 0.05 * seg.subsidy.creditApplied + 4 && Math.abs(seg.reconciliation.unroundedTarget - (seg.reconciliation.afterCc - seg.reconciliation.creditCalculated - seg.subsidy.calibration)) < 1e-6 && Math.abs(seg.demandFit.steps.initial - seg.demandFit.steps.energyCredit - seg.demandFit.steps.calibration - seg.demandFit.steps.generated) <= 12 && seg.demandFit.steps.calibration === seg.subsidy.calibration))
  check('...taken from the later boards only: Board 1 holds its 150 DR, and the budgets you typed are untouched', draft.segments.every((seg, i) => seg.perBoard[0].mainSum === 150 && seg.boards.map((b) => b.blockedValue).join() === raw[i].mainBoards.map((b) => b.blockedValue).join()))
  check('it reports the demand, the average and the middle player, the difference, the completion rate and the passes', fits.every((f) => f.configured > 0 && f.paid.p50 > 0 && f.completionRate === 1 && f.passes.length >= 1 && f.passes.every((p) => p.paid > 0) && (f.constraint === null) === f.inMargin))
  // An independent check: other seeds, players with their own luck.
  const real = mains.map((boards) => validateConfigAcrossRuns(boards, { rewardChainConfig: boards[0].rewardChainConfig, dropGroupsConfig: boards[0].dropGroupsConfig, dropGroupsById: new Map(boards[0].dropGroups.map((g) => [g.id, g])), minDropRank: boards[0].minDropRank, leftoverPolicy: boards[0].rewardLeftoverPolicy, runs: 200, seed: 4711, randomLuck: true }))
  check(`200 players with their own luck and another seed pay the demand on average too (${real.map((r, i) => `${Math.round(r.drSpentMainPhase.mean)} of ${fits[i].configured}; middle ${r.drSpentMainPhase.p50}; 8 in 10 between ${r.drSpentMainPhase.p10} and ${r.drSpentMainPhase.p90}`).join(' | ')})`, real.every((r, i) => Math.abs(r.drSpentMainPhase.mean - fits[i].configured) <= 0.05 * fits[i].configured && r.mainPhaseCompletionRate === 1))
  const stuck = draft.segments[0]
  check('the rewards are still met after it', draft.segments.every((seg) => seg.resources.every((r) => !(r.target > 0) || Math.abs(r.predicted - r.target) <= r.target * 0.15)) && stuck.status !== 'infeasible')
  const parts = buildInputParts({ phase: 'main', segments: segmentBuildInputs(raw, 'main') })
  const { rules: _rules, ...olderParts } = parts
  check(`a design built under the older rules is marked as needing a rebuild, with the reason ("${INPUT_PART_LABELS.rules.slice(0, 48)}...")`, typeof parts.rules === 'string' && changedInputParts(olderParts, parts).join() === 'rules' && changedInputParts(parts, parts).length === 0)
}

console.log('--- 7. Measured, not assumed: the board, the luck, the phase end, the hand-over ---')
{
  const segment = { name: 'Segment 1', boards: mains[0], rcBoards: null, twists: { main: 15, rc: null }, step: 10 }
  const measure = (id) => measureCandidate({ segment, candidate: candidateById(id), runs: 80, phases: ['main'] }).main
  const current = measure('current')
  const bigger = measure('bigger')
  const half = measure('rank6half')
  const s = current.atFit
  check(`Twister drops land on real cells: the board is at most ${Math.round(s.peakOccupancy.max * 100)}% full (typical player ${Math.round(s.peakOccupancy.p50 * 100)}%), ${s.delayedDrops.mean.toFixed(1)} dropped items a player wait off the board, none is thrown away`, s.droppedItems.mean > 0 && s.peakOccupancy.p50 > 0 && s.peakOccupancy.max <= 1 && s.suppressedDrops.max === 0)
  check(`...and with every Twister item a rank bigger the same is measured again, not assumed (peak ${Math.round(bigger.atFit.peakOccupancy.p50 * 100)}%, ${bigger.atFit.delayedDrops.mean.toFixed(1)} waiting, ${bigger.atFit.spaceCollects.mean.toFixed(1)} forced taps against ${s.spaceCollects.mean.toFixed(1)})`, bigger.atFit.peakOccupancy.max <= 1 && bigger.atFit.suppressedDrops.max === 0)
  // Paired randomness: the same players, the same luck.
  const a = recordCadenceRuns({ boards: mains[0], runs: 40, seed: 9 })
  const again = recordCadenceRuns({ boards: mains[0], runs: 40, seed: 9 })
  const withBigger = recordCadenceRuns({ boards: mains[0], runs: 40, seed: 9, drops: candidateById('bigger').apply({ dropGroups: mains[0][0].dropGroups, dropGroupsConfig: mains[0][0].dropGroupsConfig, minDropRank: 6 }) })
  const sameDr = a.filter((r, i) => r.phaseDr === withBigger[i].phaseDr).length
  check('the same seed plays the same players', JSON.stringify(a.map((r) => [r.phaseDr, r.collects])) === JSON.stringify(again.map((r) => [r.phaseDr, r.collects])))
  // Every player has their own luck stream, apart from the stream that picks containers, so a
  // candidate cannot shift anybody's lucky drops. What it CAN change is where items sit on the
  // board, and with that a player's own sequence of taps - which is the candidate's real effect.
  const meanDr = (list) => list.reduce((x, r) => x + r.phaseDr, 0) / list.length
  check(`paired players: with only the Twister items changed, ${sameDr} of 40 pay exactly the same DR; the others take a different path on the board (an item sits on a cell), and the average moves by ${(100 * Math.abs(meanDr(a) / meanDr(withBigger) - 1)).toFixed(1)}% (${Math.round(meanDr(a))} against ${Math.round(meanDr(withBigger))})`, sameDr >= 5 && Math.abs(meanDr(a) / meanDr(withBigger) - 1) <= 0.01)
  const pay = (m, t) => m.atFit.payouts[t].mean
  check(`...and the other rewards are measured beside it (bigger items: ${REWARD_TYPES.map((t) => `${t} ${((100 * pay(bigger, t)) / pay(current, t)).toFixed(1)}%`).join(', ')} of this build's)`, REWARD_TYPES.every((t) => Math.abs(pay(bigger, t) / pay(current, t) - 1) <= 0.03))
  check(`a structure that takes a reward's place is seen doing it: half the rank-6 drops as Twister leaves ${Math.round((100 * pay(half, 'coins')) / pay(current, 'coins'))}% of the coins`, pay(half, 'coins') < pay(current, 'coins') * 0.9)
  check(`bigger items give more finished items and more, smaller chances to spin (${s.finishedItems.p50} -> ${bigger.atFit.finishedItems.p50} items; ${s.opportunitiesInPlay.p50} x ${s.spinsPerOpportunity.mean.toFixed(1)} -> ${bigger.atFit.opportunitiesInPlay.p50} x ${bigger.atFit.spinsPerOpportunity.mean.toFixed(1)})`, bigger.atFit.finishedItems.p50 > s.finishedItems.p50)
  const t = timingOf(s)
  check(`reaching the twists during play is counted apart from reaching them only with the phase-end collection (${Math.round(t.inPlay * 100)} in play, ${Math.round(t.onlyAtEnd * 100)} only at the end, ${Math.round(t.never * 100)} never, of 100)`, Math.abs(t.inPlay + t.onlyAtEnd + t.never - 1) < 1e-9 && s.phaseEndShare >= 0 && s.phaseEndShare < 0.5)
  // Recompletion's hand-over, read three ways on hand-made players.
  const rcPlayers = Array.from({ length: 10 }, () => ({ phaseDr: 800, carried: { items: 2, units: 8 }, mainCollects: [[100, 4, false], [300, 4, false]], collects: [[0, 4, false], [200, 4, false], [400, 4, false], [600, 4, false]] }))
  const carry = rcCarryScenarios(rcPlayers, { values: [2, 5, 12, 30], cost: 20, mainCost: 25, target: 4, demand: 1000 })
  check(`what crosses into Recompletion is shown three ways and none is chosen: items carried in (first spin at ${carry.items.firstSpinPct.p50}%, twists at ${carry.items.reachPct}%), nothing carried (${carry.nothing.firstSpinPct.p50}%, ${carry.nothing.reachPct}%), items and the unspent balance (${carry.balance.spinsAtStart.p50} twist at the start, ${carry.balance.reachPct}%)`, carry.carriedWorth.p50 === 30 && carry.unspentBalance.p50 === 10 && carry.items.firstSpinPct.p50 === 0 && carry.nothing.firstSpinPct.p50 === 20 && carry.items.reachPct === 40 && carry.nothing.reachPct === 60 && carry.balance.spinsAtStart.p50 === 2 && carry.balance.reachPct === 40)
}

console.log('--- 7b. Calibration both ways, merge energy in and out, and the rank 7-9 candidate ---')
{
  // The allocation: a signed calibration, kept apart from the energy credit.
  const list = chain([150, 400, 600])
  const sumOf = (a) => a.after.reduce((x, v) => x + v, 0)
  const off = allocateSubsidy(list, 100, { calibration: 60 })
  check(`taken off: 100 DR of credit and 60 DR of calibration leave the later boards 160 DR lighter, Board 1 untouched (${off.after.join(' / ')})`, off.after[0] === 150 && Math.abs(1150 - sumOf(off) - 160) <= 4 && off.creditTaken === 100 && Math.abs(off.calibrationTaken - 60) < 1e-9 && off.calibrationUnabsorbed === 0)
  const back = allocateSubsidy(list, 100, { calibration: -40 })
  check(`given back inside the credit: 100 DR of credit and 40 DR back leave them 60 DR lighter - still under what was typed (${back.after.join(' / ')})`, back.after[0] === 150 && Math.abs(1150 - sumOf(back) - 60) <= 4 && back.creditTaken === 100 && Math.abs(back.calibrationTaken + 40) < 1e-9 && back.after.every((v, i) => v <= list[i].blockedValue))
  const more = allocateSubsidy(list, 100, { calibration: -250 })
  check(`given back beyond the credit: the later boards hold 150 DR MORE than was typed, in proportion, and Board 1 still its 150 (${more.after.join(' / ')})`, more.after[0] === 150 && Math.abs(sumOf(more) - 1150 - 150) <= 4 && more.creditTaken === 100 && Math.abs(more.calibrationTaken + 250) < 1e-9 && more.after[1] > 400 && more.after[2] > 600 && list.every((b) => b.blockedValue === [150, 400, 600][list.indexOf(b)]))
  // (Boards whose highest rank is 6: 16 tiles of 32 DR, 512 DR at most.)
  const tinyBoards = chain([150, 400, 600]).map((b, i) => (i === 0 ? b : { ...b, maxRank: 6 }))
  const capped = allocateSubsidy(tinyBoards, 0, { calibration: -5000 })
  check(`...never past what a board's tiles can hold: asked for 5,000 more, the boards stop at their limit and say how much was not placed (${capped.after.join(' / ')}, ${Math.round(-capped.calibrationUnabsorbed)} DR not placed)`, maxFeasibleBoardValue(tinyBoards[1], 1) === 512 && capped.after[1] > 400 && capped.after[1] <= 512 && capped.after[2] === 600 && capped.calibrationUnabsorbed < -1 && capped.after[0] === 150)

  // The spend that jumps over the demand (Recompletion): said as what it is.
  // Demand 1,098, margin 44: 1,228 with 101 DR put back and 792 with 114.
  const jumping = [{ paid: 1300, calibration: 0 }, { paid: 796, calibration: -202 }, { paid: 1228, calibration: -101 }, { paid: 776, calibration: -152 }, { paid: 804, calibration: -126 }, { paid: 792, calibration: -114 }]
  const jump = demandJumpOf(jumping, 1098, 44)
  check(`two passes ${jump?.subsidyApart} DR of subsidy apart whose player paid ${jump?.paidUnder} and ${jump?.paidOver} around a demand of 1,098 are reported as a spend that jumps`, jump?.subsidyApart === 13 && jump.paidOver === 1228 && jump.paidUnder === 792)
  check(
    '...and not when the passes are simply far apart, all on one side, or one of them is inside the margin',
    demandJumpOf([{ paid: 1300, calibration: 0 }, { paid: 796, calibration: -202 }], 1098, 44) === null &&
      demandJumpOf([{ paid: 1300, calibration: 0 }, { paid: 1228, calibration: -10 }], 1098, 44) === null &&
      demandJumpOf([{ paid: 1120, calibration: 0 }, { paid: 1000, calibration: -10 }], 1098, 44) === null &&
      demandJumpOf([], 1098, 44) === null,
  )

  // Merge energy, phase by phase.
  const b0 = mains[0][0]
  const run = simulatePlaythrough(mains[0], { rewardChainConfig: b0.rewardChainConfig, dropGroupsConfig: b0.dropGroupsConfig, dropGroupsById: new Map(b0.dropGroups.map((g) => [g.id, g])), minDropRank: b0.minDropRank, leftoverPolicy: b0.rewardLeftoverPolicy, dropRng: mulberry32(4), luckRng: mulberry32(5) })
  const e = run.energyFlow.main
  check(`the simulator says where merge energy comes from and goes: starts with ${e.start}, ${e.play} collected in play and ${e.cleanup} when the phase ends, ${e.used} used on free taps, ${e.left} left`, e.start === 0 && Math.abs(e.play + e.cleanup - run.collected.energy) < 1e-9 && e.used === run.energySpent && Math.abs(e.start + e.play + e.cleanup - e.used - e.left) < 1e-9 && run.paidTaps.main > 0)
  check('...and energy tapped when the phase ends is counted as collected then, not as used in the phase', e.cleanup >= 0 && e.used <= e.start + e.play + 1e-9)

  // The candidate: bigger Twister items at ranks 7-9 only.
  const base = { dropGroups: b0.dropGroups, dropGroupsConfig: b0.dropGroupsConfig, minDropRank: b0.minDropRank }
  const cand = candidateById('bigger79').apply(base)
  const twAt = (drops, rank) => (drops.dropGroupsConfig[rank - 1]?.entries ?? []).map((x) => drops.dropGroups.find((g) => g.id === x.groupId).items[TWISTER_TYPE]).filter((r) => r != null)
  const rewardsOf = (drops, rank) => JSON.stringify((drops.dropGroupsConfig[rank - 1]?.entries ?? []).map((x) => [x.weight, Object.entries(drops.dropGroups.find((g) => g.id === x.groupId).items).filter(([k]) => k !== TWISTER_TYPE).sort()]))
  check(`"bigger at ranks 7-9" raises the Twister item of those three ranks by one, rank 3 at most, and leaves rank 5 at one rank-1 item (rank 5: ${twAt(cand, 5).join()}; ranks 7/8/9: ${[7, 8, 9].map((r) => twAt(base, r).join('')).join('/')} -> ${[7, 8, 9].map((r) => twAt(cand, r).join('')).join('/')})`, twAt(cand, 5).join() === '1' && cand.dropGroupsConfig[4].belowStart === true && [7, 8, 9].every((r) => twAt(cand, r).every((v, k) => v === Math.min(3, twAt(base, r)[k] + 1))) && candidateById('bigger79').rules.length === 0)
  check('...with every reward item, weight and item count as it is', [5, 6, 7, 8, 9, 10, 11, 12].every((r) => rewardsOf(cand, r) === rewardsOf(base, r)))
  const segment = { name: 'Segment 1', boards: mains[0], rcBoards: null, twists: { main: 15, rc: null }, step: 10 }
  const cur = measureCandidate({ segment, candidate: candidateById('current'), runs: 60, phases: ['main'] }).main.atFit
  const big = measureCandidate({ segment, candidate: candidateById('bigger79'), runs: 60, phases: ['main'] }).main.atFit
  check(`played with the same players it gives more finished Twister items (${cur.finishedItems.p50} -> ${big.finishedItems.p50}), with the first spin after ${cur.firstSpinActions.p50} and ${big.firstSpinActions.p50} generator actions`, big.finishedItems.p50 >= cur.finishedItems.p50 && cur.firstSpinActions.p50 > 0 && cur.energy.used >= 0 && cur.energy.collected > 0)
}

console.log('--- 7c. A Recompletion board never holds a rank 1 or 2, whatever its data says ---')
{
  // The list the way the app can hand it over: marked as Recompletion, its own lowest rank still 1.
  const rcList = (values) => chain(values).map((b) => withListPhase({ ...b, minRank: 1 }, 'rc'))
  const rawRc = raw.map((seg, i) => ({ ...seg, rcBoards: rcList([300, 1900, 6144 - (2048 - [1750, 1000][i]) - 300 - 1900]), rewardTargets: { ...seg.rewardTargets, rc: { coins: 5, puzzles: 500, energy: 300, charms: 700 } }, twisterPlan: { ...seg.twisterPlan, rc: { targetSpins: 10, targetSpinsOverrides: {}, costIncrement: 10, checkpointPct: 100 } } }))
  const rcDraft = await buildEvent({ phase: 'rc', segments: rcInputsOnMainDraft(rawRc, draft) })
  const rcBoards = rawRc.map((seg, i) => boardsWithDraftApplied(seg.rcBoards, rcDraft.segments[i], rcDraft.shared, { draft: rcDraft }))
  const mainRanks = (b) => [...(b.blockedQueue ?? []), ...(b.semiPlacements ?? []).map((p) => p.rank)].filter((v) => isMainItem(v))
  const lowest = rcBoards.flat().map((b) => Math.min(...mainRanks(b)))
  check(`a Recompletion list whose own lowest rank is still 1 is built with nothing below rank 3 on any board - under tiles, semi-blocked or fixed cell (lowest rank a board: ${lowest.join(', ')})`, rawRc[0].rcBoards.every((b) => b.minRank === 1 && b.listPhase === 'rc') && rcBoards.flat().every((b) => mainRanks(b).length > 0 && mainRanks(b).every((v) => v >= 3)))
  check('...and the floor is read the same everywhere: a Recompletion board\'s lowest rank is 3 or its own, whichever is higher', boardMinRank(rawRc[0].rcBoards[1], 1) === 3 && boardMinRank({ ...rawRc[0].rcBoards[1], minRank: 5 }, 1) === 5 && boardMinRank(raw[0].mainBoards[0], 0) === 1)
  check(`Recompletion's Board 1 still lands on its 300 DR, and each phase's spend is counted from its own start (${rcDraft.segments.map((seg) => `${Math.round(seg.demandFit.paid.mean)} of ${seg.demandFit.configured}`).join('; ')})`, rcDraft.segments.every((seg) => seg.perBoard[0].mainSum === 300 && seg.demandFit.paid.mean >= 0 && seg.demandFit.steps.initial > 0))

  // RECOMPLETION'S OWN EFFORT (economist: "i want to be able to see the effort distribution on the RC also").
  const { buildClimbRows, buildSimulationRows, RC_RANKS } = await import('../../src/features/merge/lib/simulation/simulationRows.js')
  const runs = mains.map((main, i) => simulatePlaythrough(main, { dropMode: 'expected', rcBoards: rcBoards[i] }))
  const climbs = runs.map((run) => buildClimbRows(run.rcEffort, RC_RANKS))
  const paid = (rows) => rows.reduce((sum, row) => sum + (row.drDelta ?? 0), 0)
  check(`the simulator measures Recompletion from its own start: what is paid there, and the paid DR when each rank is first made there (${runs.map((run) => `${run.rcEffort?.drSpent} DR, rank 14 at ${run.rcEffort?.reachedAt[14]}`).join('; ')})`, runs.every((run) => run.rcEntered && run.rcEffort && run.rcEffort.drSpent === run.drSpentRcPhase && run.rcEffort.reachedAt[14] === run.rcEffort.drSpent && Object.values(run.rcEffort.reachedAt).every((v) => v >= 0 && v <= run.rcEffort.drSpent)))
  check('...without touching the whole run\'s own record: rank 12 is reached the moment Recompletion begins, and ranks 13 and 14 are only in Recompletion\'s', runs.every((run) => run.reachedAt[12] === run.drSpentMainPhase && run.reachedAt[14] === run.drSpent && buildSimulationRows(run).length === 12))
  check(`the climb never goes backwards and adds up to all that is paid in Recompletion (${climbs.map((rows) => rows.filter((row) => row.drDelta != null).map((row) => `${row.rank}:+${row.drDelta}`).join(' ')).join(' | ')})`, climbs.every((rows, i) => rows.length === 14 && rows.every((row) => row.drDelta == null || row.drDelta >= 0) && rows.every((row) => row.tapsDelta == null || row.tapsDelta >= 0) && paid(rows) === runs[i].rcEffort.drSpent && Math.abs(rows.reduce((sum, row) => sum + (row.pctOfEffort ?? 0), 0) - 100) < 1e-6))
  // The two ways ranks come out of order, on plain numbers: a rank skipped (opened from a tile, merged into),
  // and a rank first made after a higher one (a small generator tap late on).
  const made = { reachedAt: { 1: 140, 2: 140, 3: 4, 4: 4, 5: 8, 11: 52, 13: 140, 14: 1176 }, tapsAt: { 1: 36, 2: 37, 3: 1, 4: 1, 5: 2, 11: 13, 13: 36, 14: 535 }, drSpent: 1176 }
  const rows = Object.fromEntries(buildClimbRows(made, RC_RANKS).map((row) => [row.rank, row]))
  check('a rank that was skipped does not send the next one back to zero (rank 13 after rank 11, rank 12 never made: +88, not +140)', rows[12].dr === undefined && rows[12].drDelta === null && !rows[12].aside && rows[13].drDelta === 88 && rows[14].drDelta === 1036)
  check('a rank first made after a higher one is shown with its moment and no cost, and takes nothing from the ranks of the climb (ranks 1 and 2 at 140; rank 3 +4, not -136)', rows[1].aside && rows[2].aside && rows[1].dr === 140 && rows[1].drDelta === null && rows[3].drDelta === 4 && rows[4].drDelta === 0 && rows[5].drDelta === 4 && Object.values(rows).reduce((sum, row) => sum + (row.drDelta ?? 0), 0) === 1176)
}

console.log('--- 8. Each segment\'s Twister values and price reach the export ---')
{
  const sheets = mains.map((boards) => buildSmallRewardsSheet(boards, []))
  const twisterCells = (sheet) => sheet.rows.filter((r) => r.cells.some((c) => /twister/i.test(String(c)))).map((r) => r.cells.join(' '))
  const rowsOf = draft.twister.rows
  check(`Small Rewards: each segment's sheet holds its own four Twister values (${rowsOf.map((r) => r.values.join('/')).join(' | ')})`, sheets.every((sheet, i) => rowsOf[i].values.every((v) => twisterCells(sheet).some((line) => new RegExp(`\\b${v}\\b`).test(line)))) && twisterCells(sheets[0]).length === 4)
  const prices = mains.map((boards, i) => buildV2TwisterSheet(boards, [], [], { segmentIndex: i }).rows.map((r) => r.cells.join(' ')).find((line) => /cost per spin/i.test(line)))
  check(`the Twister sheet: each segment's own price of a twist (${prices.map((p) => p?.match(/\d+/g)?.at(-1)).join(' and ')} against ${rowsOf.map((r) => r.cost).join(' and ')})`, prices.every((line, i) => new RegExp(`\\b${rowsOf[i].cost}\\b`).test(line ?? '')))
  check('the two segments really differ in at least one of the two', rowsOf[0].values.join() !== rowsOf[1].values.join() || rowsOf[0].cost !== rowsOf[1].cost)
}

// =====================================================================
// THE PASS MARKS (economist: "for DR usage we can give 5% or 30DR (the smaller
// one for the segment) ... up to 5% margin for the twister finish"; asked:
// points of the DR demand around the window, the same in both phases).
// =====================================================================
console.log('--- The pass marks: DR usage within 5% or 30 DR, the twists within 5 points of the window ---')
{
  check(
    'the DR mark is 5% of the demand or 30 DR, the smaller (100 -> 5, 350 -> 17.5, 548 -> 27.4, 600 -> 30, 1,198 -> 30)',
    demandMarginFor(100) === 5 && demandMarginFor(350) === 17.5 && Math.abs(demandMarginFor(548) - 27.4) < 1e-9 && demandMarginFor(600) === 30 && demandMarginFor(1198) === 30 && demandMarginFor(0) === 0,
  )
  const fit = (configured, paid, within) => ({ configured, paid: { mean: paid }, differencePct: ((paid - configured) / configured) * 100, within })
  check(
    'a spend inside the build\'s own aim is "close"; between the aim and the mark it is "within margin"; outside the mark it is "off target" - whatever the phase',
    spendMatch(fit(548, 540, true)) === 'close' && spendMatch(fit(548, 525, false)) === 'within' && spendMatch(fit(548, 575, false)) === 'within' && spendMatch(fit(548, 576, false)) === 'off' && spendMatch(fit(1198, 1228, false)) === 'within' && spendMatch(fit(1198, 1229, false)) === 'off' && spendMatch(fit(100, 106, true)) === 'off',
  )
  const timing = (reachPct) => ({ target: 15, window: [70, 75], reachPct, verdict: reachPct == null ? 'never' : reachPct < 70 ? 'early' : reachPct > 75 ? 'late' : 'in-window' })
  check(
    'the twists pass inside the 70-75% window and up to 5 points outside it: 65% and 80% pass, 64% and 81% do not, and twists never reached do not',
    TWISTER_WINDOW_MARGIN_PTS === 5 && twisterMark(timing(72)) === 'in-window' && twisterMark(timing(65)) === 'near' && twisterMark(timing(80)) === 'near' && twisterMark(timing(64)) === 'off' && twisterMark(timing(81)) === 'off' && twisterMark(timing(null)) === 'off' && twisterMark({ target: 0, verdict: null }) === null,
  )
  check('...shown as close / within margin / off target', twisterMatch(timing(72)) === 'close' && twisterMatch(timing(78)) === 'within' && twisterMatch(timing(90)) === 'off' && twisterMatch(null) === null)
  const built = [{ index: 0, status: 'ok', causes: [] }, { index: 1, status: 'ok', causes: [] }, { index: 2, status: 'review', causes: [{ code: 'demand-off' }] }, { index: 3, status: 'skipped' }]
  const twister = (reaches) => ({ rows: reaches.map((reachPct, index) => ({ index, twists: 15, cost: 10, demandTiming: timing(reachPct) })) })
  const marked = withTwisterMarks(built, twister([72, 84, 60, 72]))
  const late = marked[1].causes.find((c) => c.code === 'twister-off')
  check(
    `a segment whose twists land more than 5 points outside the window says so and reads "Can be improved"; one inside it does not ("${late?.detail}")`,
    marked[0].status === 'ok' && marked[0].causes.length === 0 && marked[1].status === 'review' && !!late && /at 84% of the DR demand - 9 points after the 70-75% window/.test(late.detail) && /The margin is 5 points \(65-80%\)/.test(late.detail) && late.short === 'Twists 9 pts late' && late.step === 'rewards' && marked[2].causes.length === 2 && marked[3].status === 'skipped' && draftStatusOf(marked) === 'review',
  )
  const again = withTwisterMarks(marked, twister([72, 78, 68, 72]))
  check(
    '...and when the twists are priced again inside the margin the cause is taken off: the segment is as it was before',
    again[1].status === 'ok' && again[1].causes.length === 0 && again[2].status === 'review' && again[2].causes.length === 1 && again[2].causes[0].code === 'demand-off' && draftStatusOf(again) === 'review' && draftStatusOf(again.slice(0, 2)) === 'ok',
  )
  const never = withTwisterMarks([{ index: 0, status: 'ok', causes: [] }], twister([null]))[0]
  check('twists that are never reached do not pass either', never.status === 'review' && never.causes[0]?.short === 'Twists not reached')
}

console.log(failures === 0 ? `\nALL ${count} CADENCE CHECKS PASSED` : `\n${failures} of ${count} CADENCE CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
