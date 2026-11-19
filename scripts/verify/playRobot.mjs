// A robot that plays a stage on the REAL play engine (playSession.js - the
// thing a shared link and the Play Tester run), the way different people
// would. It exists to check the simulator against real play: the build sizes
// every reward on simulated players, so a simulated player has to end up with
// what a person playing the same way ends up with.
// (Made after the economist's "a friend did a run on the share stage and he
// ended up with crazy rewards": see verify-real-play.mjs.)
import * as ps from '../../src/features/merge/lib/simulation/playSession.js'
import { findLowestRewardCell, findTapCollectCell, tierToSpend, currentMaxRank, leftoverRewardItems, nextCarefulMerge } from '../../src/features/merge/lib/simulation/mergeSimulation.js'
import { isMainItem, decodeReward, rewardPrizeAmount, emptyRewardTally } from '../../src/features/merge/lib/rewards/rewardChain.js'
import { mulberry32 } from '../../src/features/merge/lib/rewards/rewardEconomy.js'
import { RC_MAX_RANK, MAX_RANK } from '../../src/features/merge/lib/core/ranks.js'

// `careful`: it picks its merges the way the simulator's player does - a
// semi-blocked item opened before it can be stranded, and a merge of two free
// items made next to a locked tile so it opens (mergeSimulation.js:
// nextCarefulMerge). Without it the robot takes any merge at random: the
// player who merges without looking.
// `eager`: how often it merges when it could also tap the generator.
// `collect`: what it does with a reward item - 'merge' it on, tap it when
// that pays more ('best'), or tap every one ('all'). The same three players
// the simulator knows (mergeSimulation.js: findTapCollectCell).
export const ROBOTS = {
  merger: { eager: 0.7, collect: 'merge', careful: true },
  tapsWhenItPays: { eager: 0.7, collect: 'best', careful: true },
  tapsEverything: { eager: 0.7, collect: 'all', careful: true },
  mergesWithoutLooking: { eager: 0.7, collect: 'merge' },
}

function legalMerges(state) {
  const byValue = new Map()
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const v = state.itemAt[r][c]
      if (v == null || state.locked[r][c]) continue
      if (!byValue.has(v)) byValue.set(v, { free: [], stuck: [] })
      byValue.get(v)[state.stuck[r][c] ? 'stuck' : 'free'].push([r, c])
    }
  }
  const out = []
  for (const [v, { free, stuck }] of byValue) {
    if (isMainItem(v) && v >= RC_MAX_RANK) continue
    if (free.length >= 2) out.push({ from: free[0], to: free[1] })
    if (free.length >= 1 && stuck.length >= 1) out.push({ from: free[0], to: stuck[0] })
  }
  return out
}

const hasSpace = (state) => {
  for (let r = 0; r < state.rows; r++) for (let c = 0; c < state.cols; c++) if (state.itemAt[r][c] == null && !state.locked[r][c]) return true
  return false
}

// What the free reward items the player holds would pay if tapped now (the
// simulator counts this to the normal event when Recompletion begins).
function heldTapValue(session) {
  const held = emptyRewardTally()
  for (const item of leftoverRewardItems(session.state, session.inventory)) {
    if (item.cell && session.state.stuck[item.cell[0]][item.cell[1]]) continue
    held[item.type] = (held[item.type] ?? 0) + rewardPrizeAmount(session.rewardChainConfig, item.type, item.rank)
  }
  return held
}

// The end of a phase: merge what can be merged, then tap everything that is
// free ("after getting to rank 12, merges all the small rewards and collect
// them").
function mergeAndCollectLeftovers(session) {
  for (let guard = 0; guard < 500; guard++) {
    // A semi-blocked reward item is opened first: it is the only way to get
    // it, and two free items can still be merged afterwards.
    const rewardMerges = legalMerges(session.state).filter((m) => decodeReward(session.state.itemAt[m.from[0]][m.from[1]]))
    const merge = rewardMerges.find((m) => session.state.stuck[m.to[0]][m.to[1]]) ?? rewardMerges[0]
    if (merge) {
      ps.mergeItems(session, merge.from, merge.to)
      continue
    }
    // What is still waiting off the board is the player's too.
    const waiting = session.inventory.findIndex((v) => decodeReward(v))
    if (waiting < 0 || !hasSpace(session.state)) break
    ps.placeFromInventory(session, waiting)
  }
  for (let guard = 0; guard < 500; guard++) {
    const cell = findTapCollectCell(session.state, session.rewardChainConfig, 'all')
    if (!cell) break
    ps.collectRewardItem(session, cell)
  }
}

// Plays one run of `stage` ({ boards, rcBoards }).
//   until 'main'     stop when rank 12 is held
//         'rc'       stop when rank 14 is held (endless would start)
//         'endless'  go on in endless until `endlessDr` DR have been PAID there
// `options` are passed on to the play session (a play link uses
// { endAtGoal: true } for a stage with no Recompletion).
// Returns what was collected and spent at each of those moments. With
// leftovers collected, the normal event's figure is what was collected plus
// what the player holds at rank 12 - tapped there and then when the run ends
// at rank 12, counted at its tap value when it goes on into Recompletion.
export function playRun(stage, robot, seed, { until = 'main', endlessDr = 0, maxSteps = 600000, endlessSteps = 80000, options = {}, collectLeftovers = true } = {}) {
  const rand = mulberry32(seed)
  const realRandom = Math.random
  Math.random = rand // the play engine rolls lucky drops and merge drops with Math.random
  try {
    const hasRc = !!stage.rcBoards?.length
    const s = ps.createPlaySession(stage.boards, 0, hasRc ? { rcBoards: stage.rcBoards, deferRcEntry: true, ...options } : { ...options })
    const out = { stop: 'max-steps', main: null, rc: null, final: null, energyTaps: 0, session: s }
    const snapshot = () => ({ collected: { ...s.collected }, drSpent: s.drSpent, energyBalance: s.energyBalance, energyTaps: out.energyTaps })
    let endlessFrom = null
    for (let step = 0; step < maxSteps; step++) {
      if (ps.rcEntryPending(s)) {
        out.main = snapshot()
        if (collectLeftovers) {
          const held = heldTapValue(s)
          for (const type of Object.keys(held)) out.main.collected[type] = (out.main.collected[type] ?? 0) + held[type]
        }
        if (until === 'main') {
          out.stop = 'rank-12'
          break
        }
        ps.enterPendingRc(s)
        continue
      }
      if (!hasRc && s.reachedAt[MAX_RANK] !== undefined) {
        if (collectLeftovers) mergeAndCollectLeftovers(s)
        out.main = snapshot()
        out.stop = 'rank-12'
        break
      }
      if (s.phase === 'endless') {
        if (!out.rc) {
          if (until !== 'endless' && collectLeftovers) mergeAndCollectLeftovers(s)
          out.rc = snapshot()
          endlessFrom = step
        }
        if (until !== 'endless') {
          out.stop = 'rank-14'
          break
        }
        if (s.drSpent - out.rc.drSpent >= endlessDr || step - endlessFrom > endlessSteps) {
          out.stop = step - endlessFrom > endlessSteps ? 'endless-never-needed-dr' : 'endless-budget'
          break
        }
      }
      const st = s.state
      if (robot.collect !== 'merge') {
        const cell = findTapCollectCell(st, s.rewardChainConfig, robot.collect)
        if (cell) {
          ps.collectRewardItem(s, cell)
          continue
        }
      }
      const merges = legalMerges(st)
      const space = hasSpace(st)
      if (merges.length && (!space || rand() < robot.eager)) {
        const careful = robot.careful && s.phase !== 'endless' ? nextCarefulMerge(st) : null
        if (careful && !(isMainItem(careful.merge.rank) && careful.merge.rank >= RC_MAX_RANK)) {
          if (careful.relocate) ps.moveItem(s, careful.relocate.from, careful.relocate.to)
          ps.mergeItems(s, careful.merge.mover, careful.merge.receiver)
          continue
        }
        const m = merges[Math.floor(rand() * merges.length)]
        ps.mergeItems(s, m.from, m.to)
        continue
      }
      if (space && s.inventory.length) {
        ps.placeFromInventory(s, 0)
        continue
      }
      if (!space) {
        const cell = findLowestRewardCell(st)
        if (!cell) {
          out.stop = 'board-full'
          break
        }
        ps.collectRewardItem(s, cell)
        continue
      }
      if (ps.canSpendEnergy(s)) {
        ps.spendEnergyForAction(s)
        out.energyTaps += 1
        continue
      }
      if (!ps.canSpendGenerator(s)) {
        out.stop = 'generator-stopped'
        break
      }
      // The biggest multiplier, or a smaller one when a small semi-blocked item needs it.
      ps.spendGenerator(s, tierToSpend(st, currentMaxRank(st), s.tiers))
    }
    out.final = snapshot()
    return out
  } finally {
    Math.random = realRandom
  }
}

export const meanOf = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0)
