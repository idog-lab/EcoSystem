// The simulator against REAL PLAY, and the rules that came out of it - engine checks.
// Run with: npx vite-node scripts/verify/verify-real-play.mjs
//
// Economist: "a friend did a run on the share stage and he ended up with
// crazy rewards from the small rewards. we need to try and make the simulator
// that runs on the boards better with the small rewards. it needs to be as
// tight as it can be." - and, after seeing what a robot on the play engine
// found: "i want the model to give the values of the ranks but with nice
// rounding", "its the same for both normal and RC", "after getting to rank
// 12, merges all the small rewards and collect them", "my friend did those
// amount in the normal only", "make sure the EV is as good as it can be".
//
// What is checked here, on a built event played by a robot on the play
// screen's own engine (playRobot.mjs):
//   - every segment lands near its own amounts, with round rank values of its
//     own that reward merging;
//   - a player who merges gets what the simulator says, leftovers included;
//   - tapping an item early never pays more with the model's values (and does
//     with the reference values, when the model is switched off);
//   - tapping everything stops the boards, and the simulator says so too;
//   - Recompletion plays the normal event's table and values;
//   - a play link with no Recompletion ends at rank 12;
//   - endless mode cannot pay for itself;
//   - every player lands near the amounts, not only the average one: steady
//     containers, validation with real luck and "players within 15%", the
//     player who merges without looking, tiles opening as on the play screen,
//     leftovers merged before they are tapped.
// A build has randomness in it, so every comparison here has room in it.
import { createBoard, withListPhase } from '../../src/features/merge/lib/core/board.js'
import { withBlankCoinValues, REWARD_TYPES, tapPaysAtLeastAsMuch, bestUnitValue, validateRewardLadder, niceNearest, niceRewardValues, niceCoinValues, encodeReward, DEFAULT_LEFTOVER_POLICY } from '../../src/features/merge/lib/rewards/rewardChain.js'
import { withDefaultTwisterValues } from '../../src/features/merge/lib/rewards/twisterEconomy.js'
import { buildEvent, segmentBuildInputs, rcInputsOnMainDraft, boardsWithDraftApplied, validateDraftSegment, buildInputsKey, STYLE_VALIDATION_RUNS, RC_TOP_ROW_MERGES } from '../../src/features/merge/lib/build/eventBuild.js'
import { validateConfigAcrossRuns, mulberry32 } from '../../src/features/merge/lib/rewards/rewardEconomy.js'
import { encodeStage, decodeStage } from '../../src/features/merge/lib/share/stageShare.js'
import { endlessOfDesign, describeEndlessDrops, ENDLESS_ENERGY_PAYBACK_MAX } from '../../src/features/merge/lib/rewards/endlessMode.js'
import { simulatePlaythrough, findTapCollectCell, buildInitialState, settlePhaseLeftovers } from '../../src/features/merge/lib/simulation/mergeSimulation.js'
import { createPlaySession, canSpendGenerator, sessionEnded } from '../../src/features/merge/lib/simulation/playSession.js'
import { buildWorkbook, buildSmallRewardWeightsSheet } from '../../src/features/merge/lib/export/eventSheets.js'
import { playRun, ROBOTS, meanOf } from './playRobot.mjs'

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
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0)
const valuesOf = (config, type) => config[type].map((r) => r.prizeAmount)
const rewardsMerging = (values) => validateRewardLadder(values.map((prizeAmount) => ({ prizeAmount }))).length === 0

function chain(values, rc = false, extra = {}) {
  return values.map((v, i) => {
    let b = createBoard(`Board ${i + 1}`, { rows: i === 0 ? 5 : 3, cols: 8 })
    const from = i === 0 ? 3 : 1
    b.tiles = b.tiles.map((row, r) => row.map(() => (r >= from ? 'blocked' : 'open')))
    if (i === 0) b.tiles[2][4] = 'semi'
    b.blockedValue = v
    b.minDropRank = 6
    b.twisterByBuild = true
    b.rewardChainConfig = withDefaultTwisterValues(withBlankCoinValues(b.rewardChainConfig))
    Object.assign(b, extra)
    if (rc) b = withListPhase({ ...b, minRank: 3, maxRank: 13 }, 'rc')
    return b
  })
}

console.log('--- 1. Round amounts that reward merging ---')
{
  const cfg = createBoard('x').rewardChainConfig
  // The reference values: puzzles 5/15/15/40, charms 5/10/30/40, merge energy 5/15/35/75.
  check('puzzles at 5/15/15/40: a rank-2 item pays more a piece (7.5) than a rank 4 (5), so tapping it pays', tapPaysAtLeastAsMuch(cfg, 'puzzles', 2) && !tapPaysAtLeastAsMuch(cfg, 'puzzles', 1) && !tapPaysAtLeastAsMuch(cfg, 'puzzles', 3) && bestUnitValue(cfg, 'puzzles') === 7.5)
  check('charms at 5/10/30/40: tapping pays at rank 3 (7.5 a piece against 5)', tapPaysAtLeastAsMuch(cfg, 'charms', 3) && !tapPaysAtLeastAsMuch(cfg, 'charms', 1) && bestUnitValue(cfg, 'charms') === 7.5)
  check('merge energy at 5/15/35/75 rewards merging: tapping never pays', [1, 2, 3].every((r) => !tapPaysAtLeastAsMuch(cfg, 'energy', r)) && validateRewardLadder(cfg.energy).length === 0)
  const tops = [3, 10, 18, 33, 40, 61, 75, 96, 148, 260, 730, 2400]
  const ladders = tops.map((top) => niceRewardValues(top))
  check(`the values the model gives are round at any size (${tops.map((top, i) => `${top}: ${ladders[i].join('/')}`).slice(3, 9).join(', ')})`, ladders.every((l) => l.every((v) => Number.isInteger(v) && v >= 1 && niceNearest(v) === v)))
  check('...and always reward merging: each rank at least double the one below, rank 4 more than the items it is made of', ladders.every(rewardsMerging))
  check('...with rank 4 within half a step of what was asked (under 7% from a top value of 40 up)', tops.filter((top) => top >= 40).every((top, i) => Math.abs(ladders[tops.indexOf(top)][3] - top) / top <= 0.07 && i >= 0))
  check(`a ladder that already rewards merging keeps its proportions (10/25/60/150 x2 -> ${niceRewardValues(300, [10, 25, 60, 150]).join('/')}); plain doubling does not count any more (10/20/40/100 x2 -> ${niceRewardValues(200, [10, 20, 40, 100]).join('/')}), one that does not gets 1:3:7:15 (5/15/15/40 x1.5 -> ${niceRewardValues(60, [5, 15, 15, 40]).join('/')})`, niceRewardValues(300, [10, 25, 60, 150]).join() === '20,50,120,300' && niceRewardValues(200, [10, 20, 40, 100]).join() === '10,40,90,200' && niceRewardValues(60, [5, 15, 15, 40]).join() === '4,10,25,60' && niceRewardValues(75).join() === '5,15,35,75')
  const coins = [0.05, 0.136, 0.6, 0.87, 1.234].map(niceCoinValues)
  check(`coin values are round too, in hundredths (0.87 -> ${coins[3].join('/')})`, coins.every(rewardsMerging) && coins[2].join() === '0.05,0.12,0.27,0.6' && coins[3].every((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9))
  // What each kind of player taps on a small board.
  const board = { rows: 2, cols: 3, tiles: [['open', 'open', 'open'], ['open', 'open', 'open']], semiPlacements: [{ row: 1, col: 2, rank: encodeReward('puzzles', 2) }], blockedQueue: [] }
  const state = buildInitialState(board)
  state.itemAt[0][0] = encodeReward('puzzles', 2)
  state.itemAt[0][1] = encodeReward('energy', 1)
  check('the player who merges taps nothing; the one who taps when it pays keeps a puzzle that opens a semi-blocked one', findTapCollectCell(state, cfg, 'merge') === null && findTapCollectCell(state, cfg, 'best') === null)
  state.stuck[1][2] = false
  check('...and taps it once nothing is waiting for it; the one who taps everything taps anything', JSON.stringify(findTapCollectCell(state, cfg, 'best')) === '[0,0]' && JSON.stringify(findTapCollectCell(state, cfg, 'all')) === '[0,0]')
}

console.log('--- 2. Build an event: three segments, the normal event and Recompletion ---')
const SUBSIDIES = [1750, 1300, 700]
const raw = SUBSIDIES.map((subsidy, i) => {
  const rest = subsidy - 150
  const rcRest = 6144 - (2048 - subsidy) - 300
  return {
    name: `Segment ${i + 1}`,
    mainBoards: chain([150, Math.round(rest * 0.45), rest - Math.round(rest * 0.45)]),
    rcBoards: chain([300, Math.round(rcRest * 0.3), Math.round(rcRest * 0.35), rcRest - Math.round(rcRest * 0.3) - Math.round(rcRest * 0.35)], true),
    rewardTargets: { main: { coins: 3, puzzles: 300, energy: 200, charms: 400 }, rc: { coins: 5, puzzles: 500, energy: 300, charms: 700 } },
    segmentFactor: 1 + i * 0.15,
    sourceAllocation: {},
    twisterPlan: { main: { targetSpins: 15, targetSpinsOverrides: {}, costIncrement: 10, checkpointPct: 100 }, rc: { targetSpins: 10, targetSpinsOverrides: {}, costIncrement: 10, checkpointPct: 100 } },
  }
})
const mainDraft = await buildEvent({ phase: 'main', segments: segmentBuildInputs(raw, 'main') })
const rcDraft = await buildEvent({ phase: 'rc', segments: rcInputsOnMainDraft(raw, mainDraft) })
const mainOf = (i) => boardsWithDraftApplied(raw[i].mainBoards, mainDraft.segments[i], mainDraft.shared, { draft: mainDraft })
const rcOf = (i) => boardsWithDraftApplied(raw[i].rcBoards, rcDraft.segments[i], rcDraft.shared, { draft: rcDraft })
const mains = SUBSIDIES.map((_, i) => mainOf(i))
const rcs = SUBSIDIES.map((_, i) => rcOf(i))
check(`both phases build for every segment (normal ${mainDraft.segments.map((s) => s.status).join(' ')}; Recompletion ${rcDraft.segments.map((s) => s.status).join(' ')})`, mainDraft.segments.every((s) => s.status !== 'skipped' && s.status !== 'infeasible') && rcDraft.segments.every((s) => s.status !== 'skipped' && s.status !== 'infeasible'))

console.log('--- 3. Every segment lands near its own amounts, with round values of its own ---')
{
  const checks = mains.map((boards, i) => validateDraftSegment({ phase: 'main', draftSegment: { ...mainDraft.segments[i], boards }, shared: mainDraft.shared, runs: 150, styleRuns: 0 }))
  const worst = Math.max(...checks.flatMap((v) => v.resources.filter((r) => r.target > 0).map((r) => Math.abs(r.mean - r.target) / r.target)))
  check(`an independent check of 150 players per segment: every reward of every segment within 14% of its amount (${checks.map((v, i) => `S${i + 1} ${v.resources.map((r) => `${pct(r.mean, r.target)}%`).join('/')}`).join('; ')})`, worst <= 0.14)
  check('...coins, whose values move in hundredths, within 4%', checks.every((v) => Math.abs(v.resources.find((r) => r.type === 'coins').mean / v.resources.find((r) => r.type === 'coins').target - 1) <= 0.04))
  check(`the build's own numbers are the same players' (within 8% of the check)`, checks.every((v) => v.resources.every((r) => !(r.target > 0) || Math.abs(r.estimate - r.mean) <= r.target * 0.08)))
  const ladders = mains.map((boards) => boards[0].rewardChainConfig)
  check(`each segment has its own rank values (puzzles ${ladders.map((c) => valuesOf(c, 'puzzles').join('/')).join(' | ')}; charms ${ladders.map((c) => valuesOf(c, 'charms').join('/')).join(' | ')})`, new Set(ladders.map((c) => JSON.stringify(['puzzles', 'energy', 'charms'].map((t) => valuesOf(c, t))))).size >= 2 && new Set(ladders.map((c) => JSON.stringify(valuesOf(c, 'coins')))).size >= 2)
  check('...every one of them round, and rewarding merging', ladders.every((c) => ['puzzles', 'energy', 'charms'].every((t) => valuesOf(c, t).every((v) => niceNearest(v) === v) && rewardsMerging(valuesOf(c, t))) && rewardsMerging(valuesOf(c, 'coins'))))
  check('...with what was typed kept as the definition (puzzles 5/15/15/40)', ladders.every((c) => c.puzzles.map((r) => r.typed?.prizeAmount ?? r.prizeAmount).join() === '5,15,15,40'))
  // (Segment 3 is asked 1.3x Segment 1's amounts and merges several times as
  // often; a rounding step of slack.)
  const perAsk = (i, type) => valuesOf(ladders[i], type)[3] / (1 + i * 0.15)
  check(`a segment that merges more gets smaller values for what it is asked, not a bigger payout (top value per amount asked - puzzles ${perAsk(0, 'puzzles').toFixed(1)} against ${perAsk(2, 'puzzles').toFixed(1)}, charms ${perAsk(0, 'charms').toFixed(1)} against ${perAsk(2, 'charms').toFixed(1)})`, perAsk(2, 'puzzles') <= perAsk(0, 'puzzles') + 2.5 && perAsk(2, 'charms') <= perAsk(0, 'charms') + 2.5)
  check('the drop table is still one table for every segment', mains.every((boards) => JSON.stringify(boards[0].dropGroupsConfig) === JSON.stringify(mains[0][0].dropGroupsConfig)))
}

console.log('--- 4. One event, one table: Recompletion plays the normal event\'s drops and values ---')
{
  check('a Recompletion segment has the same rank values as its normal event, for every reward', rcs.every((boards, i) => JSON.stringify(boards[0].rewardChainConfig) === JSON.stringify(mains[i][0].rewardChainConfig)))
  check('...the same drop start rank and item rules, and the same leftover rule', rcs.every((boards, i) => ['minDropRank', 'multiDropRank', 'tripleDropRank', 'soloDropRank', 'rewardLeftoverPolicy'].every((key) => JSON.stringify(boards[0][key]) === JSON.stringify(mains[i][0][key]))))
  check('...and the same weights for every merge the normal event makes (tiers 6 to 12)', rcs.every((boards, i) => JSON.stringify(boards[0].dropGroupsConfig.slice(5, 12)) === JSON.stringify(mains[i][0].dropGroupsConfig.slice(5, 12))))
  const byId = new Map(rcs[0][0].dropGroups.map((g) => [g.id, g]))
  const topRows = Object.keys(RC_TOP_ROW_MERGES).map((rank) => rcs[0][0].dropGroupsConfig[rank - 1])
  check(`the two rows only Recompletion reaches - the merges that make rank 13 and 14 - are one container of three items each (${topRows.map((t) => Object.entries(byId.get(t.entries[0].groupId).items).map(([k, r]) => `${k} R${r}`).join('+')).join(' | ')})`, topRows.every((t) => t.entries.length === 1 && t.entries[0].weight === 1000 && t.noDropWeight === 0 && Object.keys(byId.get(t.entries[0].groupId).items).length === 3 && Object.values(byId.get(t.entries[0].groupId).items).every((r) => r >= 1 && r <= 3)))
  const rcChecks = rcs.map((boards, i) => validateDraftSegment({ phase: 'rc', draftSegment: { ...rcDraft.segments[i], boards }, shared: rcDraft.shared, mainBoards: mains[i], runs: 60, styleRuns: 0 }))
  check(`what a Recompletion player gets follows from the normal event; the build's number for it is what an independent check finds (${rcChecks.map((v, i) => `S${i + 1} ${v.resources.map((r) => `${pct(r.mean, r.target)}%`).join('/')}`).join('; ')})`, rcChecks.every((v) => v.resources.every((r) => !(r.target > 0) || Math.abs(r.estimate - r.mean) <= r.target * 0.1)))
  // Whatever a Recompletion list holds of its own for values and drop rules is not an input to its build
  // (it plays the normal event's) - so applying, which writes the normal event's onto it, leaves the draft current.
  const odd = raw.map((seg) => ({ ...seg, rcBoards: seg.rcBoards.map((b) => ({ ...b, minDropRank: 9, rewardChainConfig: { ...b.rewardChainConfig, puzzles: b.rewardChainConfig.puzzles.map((r, i) => ({ ...r, prizeAmount: [1, 2, 3, 99][i] })) } })) }))
  const appliedBoth = odd.map((seg, i) => ({ ...seg, mainBoards: mains[i], rcBoards: boardsWithDraftApplied(seg.rcBoards, rcDraft.segments[i], rcDraft.shared, { draft: rcDraft }) }))
  check('values and drop rules typed on the Recompletion list itself are not inputs to its build, and applying it does not make it out of date', buildInputsKey({ phase: 'rc', segments: rcInputsOnMainDraft(odd, mainDraft) }) === rcDraft.key && buildInputsKey({ phase: 'rc', segments: segmentBuildInputs(appliedBoth, 'rc') }) === rcDraft.key && appliedBoth[0].rcBoards[0].minDropRank === mains[0][0].minDropRank)
  const tabs = buildWorkbook(mains[0], rcs[0]).worksheets.map((w) => w.name)
  const weights = buildSmallRewardWeightsSheet(mains[0], { recompletionBoards: rcs[0] })
  check('the workbook has one Small Rewards Bank and one Small Reward Weights - no Recompletion copies - running to merge tier 14', !tabs.some((n) => /^RC Small/.test(n)) && tabs.filter((n) => /Small Reward/.test(n) && !/Endless/.test(n)).length === 3 && weights.rows.at(-1).cells[0] === 14 && weights.rows.slice(-2).every((r) => r.cells.at(-1) === 0 && r.cells.slice(1).filter((v) => v === 1000).length === 1))
}

// Exactly what a friend opens: the base segment's link, decoded.
const stage = decodeStage(encodeStage(mains[0], { rcBoards: rcs[0] }))
const targets = { main: mainDraft.segments[0].targets, rc: rcDraft.segments[0].targets }
const b0 = stage.boards[0]
const simOf = (collectPolicy, runs = 40, extra = {}) =>
  validateConfigAcrossRuns(stage.boards, {
    rewardChainConfig: b0.rewardChainConfig,
    dropGroupsConfig: b0.dropGroupsConfig,
    dropGroupsById: new Map(b0.dropGroups.map((g) => [g.id, g])),
    minDropRank: b0.minDropRank,
    leftoverPolicy: b0.rewardLeftoverPolicy,
    rcBoards: stage.rcBoards,
    runs,
    seed: 5,
    collectPolicy,
    maxSteps: 200000,
    ...extra,
  })
const RUNS = 14
const robotOf = (robot) => {
  const runs = Array.from({ length: RUNS }, (_, k) => playRun(stage, robot, 700 + k, { until: 'rc' })).filter((r) => r.main && r.rc)
  return {
    done: runs.length,
    main: Object.fromEntries(REWARD_TYPES.map((t) => [t, meanOf(runs.map((r) => r.main.collected[t] ?? 0))])),
    rc: Object.fromEntries(REWARD_TYPES.map((t) => [t, meanOf(runs.map((r) => (r.rc.collected[t] ?? 0) - (r.main.collected[t] ?? 0)))])),
    drSpent: meanOf(runs.map((r) => r.rc.drSpent)),
  }
}
// A reward comes in a few big prizes, so two averages of the same thing can
// sit a fair way apart: 30% of the target, on either side.
const close = (sim, robot, phase) => REWARD_TYPES.every((t) => !(targets[phase][t] > 0) || Math.abs(sim[t].mean - robot[t]) <= targets[phase][t] * 0.3)
const line = (sim, robot, phase) => REWARD_TYPES.filter((t) => targets[phase][t] > 0).map((t) => `${t} ${pct(sim[t].mean, targets[phase][t])}% / ${pct(robot[t], targets[phase][t])}%`).join(', ')

console.log('--- 5. A player who merges: the simulator and real play agree, leftovers included ---')
const simMerge = simOf('merge')
const botMerge = robotOf(ROBOTS.merger)
{
  check(`the play link opens as 3 + 4 boards, and every robot run finishes both phases (${botMerge.done} of ${RUNS})`, stage?.boards.length === 3 && stage?.rcBoards.length === 4 && botMerge.done === RUNS)
  check(`normal event, simulator / robot on the real play engine, as a share of the amount asked: ${line(simMerge.payoutsMainPhase, botMerge.main, 'main')}`, close(simMerge.payoutsMainPhase, botMerge.main, 'main'))
  check(`Recompletion: ${line(simMerge.payoutsRcPhase, botMerge.rc, 'rc')}`, close(simMerge.payoutsRcPhase, botMerge.rc, 'rc'))
  check(`...on about the same DR (simulator ${Math.round(simMerge.drSpent.mean)}, robot ${Math.round(botMerge.drSpent)})`, Math.abs(simMerge.drSpent.mean - botMerge.drSpent) <= simMerge.drSpent.mean * 0.3)
  // Leftovers: collected when the phase's top rank is reached.
  check('leftovers are collected by default', DEFAULT_LEFTOVER_POLICY === 'collect' && b0.rewardLeftoverPolicy === 'collect')
  const lost = validateConfigAcrossRuns(stage.boards, { rewardChainConfig: b0.rewardChainConfig, dropGroupsConfig: b0.dropGroupsConfig, dropGroupsById: new Map(b0.dropGroups.map((g) => [g.id, g])), minDropRank: b0.minDropRank, leftoverPolicy: 'forfeit', runs: 40, seed: 5 })
  const kept = validateConfigAcrossRuns(stage.boards, { rewardChainConfig: b0.rewardChainConfig, dropGroupsConfig: b0.dropGroupsConfig, dropGroupsById: new Map(b0.dropGroups.map((g) => [g.id, g])), minDropRank: b0.minDropRank, leftoverPolicy: 'collect', runs: 40, seed: 5 })
  const more = REWARD_TYPES.map((t) => kept.payoutsMainPhase[t].mean - lost.payoutsMainPhase[t].mean)
  check(`at rank 12 the simulated player collects what is left: it counts more than when leftovers were assumed lost (${REWARD_TYPES.map((t, i) => `${t} +${pct(more[i], lost.payoutsMainPhase[t].mean)}%`).join(', ')})`, more.every((d) => d >= -1e-9) && more.some((d) => d > 0) && REWARD_TYPES.every((t) => kept.leftoverForfeited[t].mean <= lost.leftoverForfeited[t].mean + 1e-9))
  // A run that goes on into Recompletion: nothing is settled at rank 12, but what is held is the normal event's.
  const one = simulatePlaythrough(stage.boards, { dropGroupsConfig: b0.dropGroupsConfig, dropGroupsById: new Map(b0.dropGroups.map((g) => [g.id, g])), minDropRank: b0.minDropRank, rcBoards: stage.rcBoards, dropRng: (() => { let x = 7; return () => (x = (x * 16807) % 2147483647) / 2147483647 })() })
  check('going on into Recompletion, the two phases always add up to the whole run, and what the player held at rank 12 is counted to the normal event', REWARD_TYPES.every((t) => Math.abs(one.collectedMainPhase[t] + one.collectedRcPhase[t] - one.collected[t]) < 1e-9 && one.carriedIntoRc[t] >= 0) && one.rcEntered)
}

console.log('--- 6. Tapping an item early never pays more with the values the model gives ---')
{
  const config = b0.rewardChainConfig
  check('at no rank of any reward does a tap pay as much as merging on', REWARD_TYPES.every((t) => [1, 2, 3].every((rank) => !tapPaysAtLeastAsMuch(config, t, rank))))
  const simBest = simOf('best')
  check('so the simulated player who taps when it pays IS the one who merges - the same runs, to the last item', JSON.stringify(simBest.payouts) === JSON.stringify(simMerge.payouts) && simBest.drSpent.mean === simMerge.drSpent.mean)
  const botBest = robotOf(ROBOTS.tapsWhenItPays)
  check(`...and on the real play engine the robot that taps when it pays gets no more than the one that merges (${REWARD_TYPES.map((t) => `${t} ${(botBest.main[t] / Math.max(1e-9, botMerge.main[t])).toFixed(2)}x`).join(', ')})`, REWARD_TYPES.every((t) => botBest.main[t] <= botMerge.main[t] * 1.2 && botBest.rc[t] <= botMerge.rc[t] * 1.2))
  const v = validateDraftSegment({ phase: 'main', draftSegment: { ...mainDraft.segments[0], boards: mains[0] }, shared: mainDraft.shared, runs: 40 })
  check(`step 7 plays the same event four ways (${v.styles.map((s) => s.id).join(', ')}; ${STYLE_VALIDATION_RUNS} players for a tapping one) and says the one who taps when it pays is the one who merges`, v.styles.map((s) => s.id).join() === 'merge,careless,best,all' && v.tapPays.length === 0 && v.styles.find((s) => s.id === 'best').sameAsMerge === true)
}

console.log('--- 7. With the model switched off and the reference values, tapping does pay more ---')
{
  const typedRaw = [{ ...raw[1], name: 'As typed', mainBoards: chain([150, 518, 632], false, { rankValuesByBuild: false }), rcBoards: [] }]
  const typedDraft = await buildEvent({ phase: 'main', segments: segmentBuildInputs(typedRaw, 'main') })
  const typedBoards = boardsWithDraftApplied(typedRaw[0].mainBoards, typedDraft.segments[0], typedDraft.shared, { draft: typedDraft })
  check('switched off, the values stay exactly as typed (puzzles 5/15/15/40, charms 5/10/30/40)', valuesOf(typedBoards[0].rewardChainConfig, 'puzzles').join() === '5,15,15,40' && valuesOf(typedBoards[0].rewardChainConfig, 'charms').join() === '5,10,30,40')
  const v = validateDraftSegment({ phase: 'main', draftSegment: { ...typedDraft.segments[0], boards: typedBoards }, shared: typedDraft.shared, runs: 60 })
  const share = (id, t) => v.styles.find((s) => s.id === id).resources.find((r) => r.type === t).mean
  const gain = (t) => share('best', t) / Math.max(1e-9, share('merge', t))
  check(`step 7 names where a tap pays more than a merge (${v.tapPays.map((x) => `${x.type} rank ${x.rank}`).join(', ')})`, v.tapPays.some((x) => x.type === 'puzzles' && x.rank === 2) && v.tapPays.some((x) => x.type === 'charms' && x.rank === 3) && !v.tapPays.some((x) => x.type === 'energy'))
  check(`...and the player who taps when it pays gets more puzzles and charms than the one who merges (${gain('puzzles').toFixed(2)}x and ${gain('charms').toFixed(2)}x) and the same merge energy (${gain('energy').toFixed(2)}x)`, gain('puzzles') > 1.03 && gain('charms') > 1.03 && Math.max(gain('puzzles'), gain('charms')) > 1.15 && gain('energy') > 0.75 && gain('energy') < 1.3)
  const typedStage = { boards: typedBoards, rcBoards: null }
  const m = Array.from({ length: 12 }, (_, k) => playRun(typedStage, ROBOTS.merger, 300 + k)).map((r) => r.main.collected)
  const t = Array.from({ length: 12 }, (_, k) => playRun(typedStage, ROBOTS.tapsWhenItPays, 300 + k)).map((r) => r.main.collected)
  const ratio = (type) => meanOf(t.map((c) => c[type])) / Math.max(1e-9, meanOf(m.map((c) => c[type])))
  check(`...on the real play engine too (puzzles ${ratio('puzzles').toFixed(2)}x, charms ${ratio('charms').toFixed(2)}x)`, ratio('puzzles') > 1 && ratio('charms') > 1 && Math.max(ratio('puzzles'), ratio('charms')) > 1.12)
}

console.log('--- 8. A player who taps everything: the boards stop arriving, and the simulator says so too ---')
{
  const simAll = simOf('all', 20)
  const botAll = robotOf(ROBOTS.tapsEverything)
  check(`simulator / robot: normal ${line(simAll.payoutsMainPhase, botAll.main, 'main')}`, close(simAll.payoutsMainPhase, botAll.main, 'main'))
  // (This player never clears a board and goes on for thousands of DR, far past
  // every amount asked: the two engines are compared with each other - within a
  // quarter - not against the targets, which neither is near.)
  check(`Recompletion ${line(simAll.payoutsRcPhase, botAll.rc, 'rc')}`, close(simAll.payoutsRcPhase, botAll.rc, 'rc') || REWARD_TYPES.every((t) => !(targets.rc[t] > 0) || Math.abs(simAll.payoutsRcPhase[t].mean / Math.max(1e-9, botAll.rc[t]) - 1) <= 0.25))
  check(`this player spends more DR - a reward under a tile is never opened, so the later boards and their subsidy never arrive (simulator ${Math.round(simAll.drSpent.mean)}, robot ${Math.round(botAll.drSpent)}, against ${Math.round(simMerge.drSpent.mean)} for the player who merges)`, simAll.drSpent.mean > simMerge.drSpent.mean * 1.2 && Math.abs(simAll.drSpent.mean - botAll.drSpent) <= simAll.drSpent.mean * 0.3)
}

console.log('--- 9. A play link with no Recompletion ends at rank 12 ---')
{
  const normalOnly = { boards: stage.boards, rcBoards: null }
  const run = playRun(normalOnly, ROBOTS.merger, 21, { options: { endAtGoal: true }, collectLeftovers: false })
  check(`the stage ends when rank 12 is held: the generator stops (${run.stop}, ${run.main.drSpent} DR spent)`, run.stop === 'rank-12' && sessionEnded(run.session) && !canSpendGenerator(run.session))
  // What is left can still be merged and tapped.
  const before = { ...run.session.collected }
  const again = playRun(normalOnly, ROBOTS.merger, 21, { options: { endAtGoal: true } })
  check('...and what is left on the board can still be merged and tapped', REWARD_TYPES.every((t) => again.main.collected[t] >= before[t] - 1e-9) && REWARD_TYPES.some((t) => again.main.collected[t] > before[t]))
  // The Play Tester does not ask for it: the economist can go on.
  const tester = createPlaySession(stage.boards, 0, {})
  check('a session that did not ask to end there (the Play Tester) is not ended', !tester.endAtGoal && !sessionEnded(tester) && canSpendGenerator(tester))
}

console.log('--- 10. Endless mode cannot pay for itself ---')
{
  const endless = endlessOfDesign(stage.boards, stage.rcBoards)
  const info = describeEndlessDrops(endless, endless.rewardChainConfig, { targetEv: endless.targetEv })
  check(`the endless drops are held to at most ${Math.round(ENDLESS_ENERGY_PAYBACK_MAX * 100)} merge energy per 100 DR of generator output (${info.energyPer100Dr.toFixed(0)}; asked for ${endless.energyUnitsAsked.toFixed(2)} units a drop, given ${endless.unitsPerDrop.energy.toFixed(2)})`, info.energyPer100Dr <= ENDLESS_ENERGY_PAYBACK_MAX * 100 + 0.5 && (!endless.energyHeld || info.energyPer100Dr > ENDLESS_ENERGY_PAYBACK_MAX * 100 * 0.8))
  // Played: 600 DR paid in endless.
  const runs = Array.from({ length: 6 }, (_, k) => playRun(stage, ROBOTS.merger, 40 + k, { until: 'endless', endlessDr: 600 }))
  check(`a robot that reaches endless and pays 600 DR there stops when the DR is spent - every run (${runs.map((r) => r.stop).join(', ')})`, runs.every((r) => r.stop === 'endless-budget'))
  const free = meanOf(runs.map((r) => r.final.energyTaps - r.rc.energyTaps))
  const paid = meanOf(runs.map((r) => r.final.drSpent - r.rc.drSpent))
  check(`...having had about one free tap for every DR paid, not thousands (${Math.round(free)} free taps on ${Math.round(paid)} DR; it was 28,000 on 45)`, free < paid * 2)
  check(`...and with no merge energy piling up (${Math.round(meanOf(runs.map((r) => r.final.energyBalance)))} left)`, meanOf(runs.map((r) => r.final.energyBalance)) < 200)
}

console.log('--- 11. The simulator is unchanged for everything that does not ask for a tapping player ---')
{
  const opts = { dropMode: 'expected', dropGroupsConfig: b0.dropGroupsConfig, dropGroupsById: new Map(b0.dropGroups.map((g) => [g.id, g])), minDropRank: b0.minDropRank }
  const a = simulatePlaythrough(stage.boards, opts)
  const b = simulatePlaythrough(stage.boards, { ...opts, collectPolicy: 'merge' })
  check('a run with no player named is the player who merges', JSON.stringify(a.collected) === JSON.stringify(b.collected) && a.drSpent === b.drSpent && a.tapCollects === 0 && a.collectPolicy === 'merge')
}

// Economist: "think even better on how to make the simulator run even better.
// and maybe run more runs. we need to make sure we will know that the
// resources the user gets will be some what close to what we wanted him to
// get." Measured first (300 players a segment): the simulator's AVERAGES were
// right, but two players ended far apart - which container a merge rolled was
// chance - and three things made the simulator a slightly different game from
// the one a player plays. All of it is held here.
console.log('--- 12. Every player near the amounts, not only the average one ---')
{
  const optsOf = (board0) => ({ rewardChainConfig: board0.rewardChainConfig, dropGroupsConfig: board0.dropGroupsConfig, dropGroupsById: new Map(board0.dropGroups.map((g) => [g.id, g])), minDropRank: board0.minDropRank, leftoverPolicy: board0.rewardLeftoverPolicy })
  const tables = mains[0][0].dropGroupsConfig
  const byId = new Map(mains[0][0].dropGroups.map((g) => [g.id, g]))
  const live = tables.filter((t) => t.rank >= 6 && t.rank <= 12)
  const text = (t) => t.entries.map((e) => `${e.weight} {${Object.entries(byId.get(e.groupId).items).map(([k, r]) => `${k.slice(0, 3)}${r}`).join(' ')}}`).join(' | ')
  const rewardsOf = (e) => JSON.stringify(Object.entries(byId.get(e.groupId).items).filter(([k]) => k !== 'twister').sort())
  const sizes = (rank) => [...new Set(tables[rank - 1].entries.map((e) => Object.keys(byId.get(e.groupId).items).length))].sort().join()
  check(`steady containers: from rank 6 every merge of a rank drops the same reward items (rank 8: ${text(tables[7])}; rank 10: ${text(tables[9])})`, mainDraft.shared.steadyDrops === true && live.every((t) => t.noDropWeight === 0 && new Set(t.entries.map(rewardsOf)).size === 1))
  check(`...one container a rank - only the rank that drops "one or two items" has two (rank 7: ${text(tables[6])})`, live.every((t) => (t.rank === 7 ? t.entries.length <= 2 : t.entries.length === 1)))
  check(`...the Twister item too: one size at each rank`, live.every((t) => new Set(t.entries.map((e) => byId.get(e.groupId).items.twister).filter((r) => r != null)).size <= 1))
  check(`...and the item counts are still the rules: one item at rank 6 - the reward under the tiles - one or two at 7, two at 8-9, three from 10 (${[6, 7, 8, 9, 10, 11, 12].map(sizes).join(' / ')})`, sizes(6) === '1' && Object.keys(byId.get(tables[5].entries[0].groupId).items).join() === 'coins' && ['1,2', '2', '1'].includes(sizes(7)) && sizes(8) === '2' && sizes(9) === '2' && [10, 11, 12].every((r) => sizes(r) === '3'))

  // Step 7's validation: 200 players who roll their own lucky drops.
  const vs = mains.map((boards, i) => validateDraftSegment({ phase: 'main', draftSegment: { ...mainDraft.segments[i], boards }, shared: mainDraft.shared, runs: 200, styleRuns: 0 }))
  const near = (v) => `${Math.round(v.allNearShare * 100)} of 100`
  check(`step 7 says, for every reward, how many players land within the margin of the amount asked (S1: ${vs[0].resources.filter((r) => r.target > 0).map((r) => `${r.type} ${Math.round(r.nearShare * 100)}`).join(', ')})`, vs.every((v) => v.margin === 0.15 && v.resources.filter((r) => r.target > 0).every((r) => r.nearShare >= 0 && r.nearShare <= 1 && r.min <= r.p10 + 1e-9 && r.p90 <= r.max + 1e-9)))
  check(`...and how many are near on every reward at once: with steady containers nearly all of them (${vs.map(near).join('; ')})`, vs.every((v) => v.allNearShare >= 0.9))
  check(`...although each of them has their own luck with the generator: the DR they spend differs (S1 ${Math.round(vs[0].drSpent.p10)} to ${Math.round(vs[0].drSpent.p90)})`, vs.every((v) => v.drSpent.p90 > v.drSpent.p10))
  const sameLuck = validateConfigAcrossRuns(mains[1], { ...optsOf(mains[1][0]), runs: 30, seed: 4 })
  check('the build itself still sizes on players who all have the same luck (an average free of noise)', sameLuck.samples === undefined && sameLuck.drSpent.p90 - sameLuck.drSpent.p10 <= sameLuck.drSpent.mean * 0.02)

  // Switched off in step 4: the varied containers of before.
  const variedRaw = [{ ...raw[1], name: 'Varied', mainBoards: chain([150, 518, 632], false, { steadyDrops: false }), rcBoards: [] }]
  const steadyRaw = [{ ...raw[1], name: 'Varied', mainBoards: chain([150, 518, 632]), rcBoards: [] }]
  const variedDraft = await buildEvent({ phase: 'main', segments: segmentBuildInputs(variedRaw, 'main') })
  const variedBoards = boardsWithDraftApplied(variedRaw[0].mainBoards, variedDraft.segments[0], variedDraft.shared, { draft: variedDraft })
  const vv = validateDraftSegment({ phase: 'main', draftSegment: { ...variedDraft.segments[0], boards: variedBoards }, shared: variedDraft.shared, runs: 200, styleRuns: 0 })
  const spread = (v, type) => {
    const r = v.resources.find((x) => x.type === type)
    return (r.p90 - r.p10) / Math.max(1e-9, r.mean)
  }
  check(`switched off in step 4, the containers are the varied ones of before and players end further apart (${near(vv)} near on everything against ${near(vs[1])}; puzzles differ by ${Math.round(spread(vv, 'puzzles') * 100)}% of the average between a low and a high player, against ${Math.round(spread(vs[1], 'puzzles') * 100)}%)`, variedDraft.shared.steadyDrops === false && variedBoards[0].dropGroupsConfig.filter((t) => t.rank >= 8 && t.rank <= 12).some((t) => t.entries.length > 1) && vv.allNearShare < vs[1].allNearShare && spread(vv, 'puzzles') > spread(vs[1], 'puzzles') + 0.05)
  check('...and switching it is a change to the build', buildInputsKey({ phase: 'main', segments: segmentBuildInputs(variedRaw, 'main') }) !== buildInputsKey({ phase: 'main', segments: segmentBuildInputs(steadyRaw, 'main') }))

  // The simulator and the play engine, player for player.
  const careful = { eager: 1, collect: 'merge', careful: true }
  const ratios = mains.map((boards) => {
    const sim = validateConfigAcrossRuns(boards, { ...optsOf(boards[0]), runs: 40, seed: 9, randomLuck: true })
    const bot = Array.from({ length: 40 }, (_, k) => playRun({ boards, rcBoards: null }, careful, 900 + k))
    return { rewards: REWARD_TYPES.map((t) => meanOf(bot.map((r) => r.main.collected[t])) / Math.max(1e-9, sim.payoutsMainPhase[t].mean)), dr: meanOf(bot.map((r) => r.main.drSpent)) / sim.drSpent.mean }
  })
  check(`a careful robot on the play engine collects what the simulator says, reward for reward, in every segment (robot / simulator: ${ratios.map((x, i) => `S${i + 1} ${x.rewards.map((v) => v.toFixed(2)).join(' ')}`).join('; ')})`, ratios.every((x) => x.rewards.every((v) => Math.abs(v - 1) <= 0.02)))
  check(`...for the same DR (${ratios.map((x) => x.dr.toFixed(2)).join(', ')})`, ratios.every((x) => Math.abs(x.dr - 1) <= 0.05))
  // The player who merges without looking.
  const simCareful = validateConfigAcrossRuns(mains[0], { ...optsOf(mains[0][0]), runs: 100, seed: 9, randomLuck: true })
  const simCareless = validateConfigAcrossRuns(mains[0], { ...optsOf(mains[0][0]), runs: 100, seed: 9, randomLuck: true, carelessMerges: true })
  const botCareless = Array.from({ length: 100 }, (_, k) => playRun({ boards: mains[0], rcBoards: null }, { eager: 1, collect: 'merge' }, 1200 + k))
  const botDr = meanOf(botCareless.map((r) => r.main.drSpent))
  check(`a player who merges without looking never does better on DR than the careful one, and the simulator's one spends what the robot's does (careful ${Math.round(simCareful.drSpent.mean)} DR; careless ${Math.round(simCareless.drSpent.mean)} simulated, ${Math.round(botDr)} on the play engine)`, simCareless.drSpent.mean >= simCareful.drSpent.mean * 0.97 && Math.abs(simCareless.drSpent.mean / botDr - 1) <= 0.15)
  check(`...and collects what the robot's does (${REWARD_TYPES.map((t) => `${t} ${(simCareless.payoutsMainPhase[t].mean / Math.max(1e-9, meanOf(botCareless.map((r) => r.main.collected[t])))).toFixed(2)}`).join(', ')})`, REWARD_TYPES.every((t) => Math.abs(simCareless.payoutsMainPhase[t].mean / Math.max(1e-9, meanOf(botCareless.map((r) => r.main.collected[t]))) - 1) <= 0.08))
  const v4 = validateDraftSegment({ phase: 'main', draftSegment: { ...mainDraft.segments[0], boards: mains[0] }, shared: mainDraft.shared, runs: 60 })
  const carelessRow = v4.styles.find((s) => s.id === 'careless')
  check(`step 7 shows that player next to the careful one (${Math.round(carelessRow?.drSpent ?? 0)} DR against ${Math.round(v4.styles[0].drSpent)})`, !!carelessRow && carelessRow.completionRate === 1 && carelessRow.drSpent >= v4.styles[0].drSpent * 0.97)

  // Tiles open the way they do on the play screen.
  const run = (extra) => simulatePlaythrough(mains[0], { ...optsOf(mains[0][0]), dropRng: mulberry32(3), ...extra })
  const asPlay = run({ revealAroundMover: false })
  const byDefault = run({})
  check('the simulator opens tiles as the play screen does - only next to the cell a merge happens in - unless the old way is asked for', JSON.stringify(byDefault.collected) === JSON.stringify(asPlay.collected) && byDefault.drSpent === asPlay.drSpent)

  // Leftovers are merged before they are tapped.
  const cfg = createBoard('x').rewardChainConfig // merge energy 5/15/35/75, puzzles 5/15/15/40
  const settle = (items, stuckItem, mergeFirst) => {
    const board = { rows: 2, cols: 4, tiles: Array.from({ length: 2 }, () => Array(4).fill('open')), semiPlacements: stuckItem ? [{ row: 1, col: 3, rank: stuckItem }] : [], blockedQueue: [] }
    const state = buildInitialState(board)
    items.forEach((item, k) => (state.itemAt[Math.floor(k / 3)][k % 3] = item))
    const paid = []
    const lost = []
    settlePhaseLeftovers(state, [], 'collect', (type, rank) => paid.push(`${type}${rank}`), (type, rank) => lost.push(`${type}${rank}`), { mergeFirst })
    return { paid: paid.sort().join(), lost: lost.sort().join() }
  }
  const energy = [encodeReward('energy', 3), encodeReward('energy', 2), encodeReward('energy', 2), encodeReward('energy', 1)]
  const merged = settle(energy, encodeReward('energy', 1), () => true)
  const asTheyLie = settle(energy, encodeReward('energy', 1), null)
  check(`at the end of a phase the leftovers are merged before they are tapped: a rank 3, two rank 2s, a rank 1 and a semi-blocked rank 1 of merge energy pay one rank 4 and one rank 2 (${merged.paid}) - tapped as they lie they paid ${asTheyLie.paid} and lost ${asTheyLie.lost}`, merged.paid === 'energy2,energy4' && merged.lost === '' && asTheyLie.paid === 'energy1,energy2,energy2,energy3' && asTheyLie.lost === 'energy1')
  const puzzles = [encodeReward('puzzles', 2), encodeReward('puzzles', 2)]
  const tapper = settle(puzzles, null, (type, rank) => !tapPaysAtLeastAsMuch(cfg, type, rank))
  check(`...the player who taps when it pays does not merge away what a tap pays more for (two rank-2 puzzles at 5/15/15/40: ${tapper.paid}), and a semi-blocked item nothing can open is still never paid`, tapper.paid === 'puzzles2,puzzles2' && settle([encodeReward('energy', 2)], encodeReward('energy', 1), () => true).lost === 'energy1')
}

console.log(failures === 0 ? `\nALL ${count} REAL-PLAY CHECKS PASSED` : `\n${failures} of ${count} REAL-PLAY CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
