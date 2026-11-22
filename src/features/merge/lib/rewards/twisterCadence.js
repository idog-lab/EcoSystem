// TWISTER CADENCE: when a player can spin, measured on the DR they have paid.
//
// Economist (the round this file was written for): the twists asked for each
// segment should be reached "around 70-75% of their segment's DR demand
// spent", and the Twister should be a steady, recurring thing - not one late
// item that pays for every twist at once.
//
//   demand progression = paid generator DR spent in the phase
//                        / the segment's configured DR demand
//
// Paid DR is the x1/x2/x4 cost of every paid tap. A free merge-energy tap adds
// nothing to it (its merges and drops still happen). It is NOT main-chain
// value, board number, merge count, Twister spending or time, and it is not
// clamped: a player who spends more than the demand is past 100%.
//
// Everything here is read off real simulated runs (mergeSimulation.js,
// `options.cadence`): every Twister collection with the paid DR it happened
// at. A spin is taken whenever the balance affords one, several from one
// collection when it pays for several, and what is left over is kept - with
// one fixed price that is floor(collected so far / price).
//
// Twister DR is its own currency: multiplying the four Twister values and the
// price of a twist by the same number changes nothing a player can see. So
// there is never one "right" pair - the fit below takes the SIMPLEST numbers
// that land in the window (the lowest whole-step price, then the smallest
// round values), and says so.
import { simulatePlaythrough } from '../simulation/mergeSimulation'
import { mulberry32 } from './rewardEconomy'
import { REWARD_TYPES, REWARD_MAX_RANK, TWISTER_TYPE, rewardPrizeAmount, twisterLadderIsAuto, syntaxWithAmount } from './rewardChain'
import { roundTwisterValues, hasTwisterDrops } from './twisterEconomy'
import { MAX_GROUP_ITEMS } from './dropGroups'
import { chaseValue } from '../core/subsidyBudget'

// The share of the demand by which the twists asked should be reached.
export const TWISTER_WINDOW_PCT = [70, 75]
// THE PASS MARK OF THE TWISTER'S TIMING (economist: "up to 5% margin for the
// twister finish" - asked what the 5% is measured in, and answered: points of
// the DR demand on each side of the window, the same in both phases). The
// window stays what the build aims at; a segment PASSES when its typical
// player reaches the twists within this many points of it (65-80%).
export const TWISTER_WINDOW_MARGIN_PTS = 5
// How far outside the window, in points of the demand (0 inside it).
export const twisterDistance = (reachPct, window = TWISTER_WINDOW_PCT) => (reachPct == null ? null : reachPct < window[0] ? window[0] - reachPct : reachPct > window[1] ? reachPct - window[1] : 0)
// 'in-window' | 'near' (outside the window, inside the margin: it passes) |
// 'off' (further out, or never reached) | null (no twists asked, not timed)
export function twisterMark(timing) {
  if (!timing || !(timing.target > 0) || !timing.verdict) return null
  if (timing.verdict === 'in-window') return 'in-window'
  const far = twisterDistance(timing.reachPct, timing.window ?? TWISTER_WINDOW_PCT)
  return far != null && far <= TWISTER_WINDOW_MARGIN_PTS + 1e-9 ? 'near' : 'off'
}
// Where a player's spins are read off, in % of the demand spent.
export const DEMAND_MARKS = [25, 50, 70, 75, 100]
export const DEFAULT_CADENCE_RUNS = 200
export const DEFAULT_CADENCE_SEED = 31
// The proportions of a Twister ladder (the economist's 2 / 5 / 12 / 30).
export const TWISTER_SHAPE = [2, 5, 12, 30]

// The DR a segment's player is meant to spend in a phase: the chase less the
// DR placed under the phase's tiles.
export function phaseDemand(phase, phaseBoards) {
  return Math.max(0, chaseValue(phase) - (phaseBoards ?? []).reduce((sum, b) => sum + (b.blockedValue ?? 0), 0))
}

function percentile(sorted, p) {
  if (!sorted.length) return null
  const at = ((sorted.length - 1) * p) / 100
  const low = Math.floor(at)
  const high = Math.ceil(at)
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low)
}
// A distribution, not only an average.
export function spread(values) {
  const list = values.filter((v) => v != null && Number.isFinite(v))
  if (!list.length) return { n: 0, mean: null, p10: null, p50: null, p90: null, min: null, max: null }
  const sorted = [...list].sort((a, b) => a - b)
  return { n: list.length, mean: list.reduce((s, v) => s + v, 0) / list.length, p10: percentile(sorted, 10), p50: percentile(sorted, 50), p90: percentile(sorted, 90), min: sorted[0], max: sorted[sorted.length - 1] }
}
const share = (list, test) => (list.length ? list.filter(test).length / list.length : null)

// --- Recording runs ---------------------------------------------------------

// Plays `runs` players of one segment and keeps, for the phase asked, what a
// cadence needs. `phase` 'main': boards are the normal list, played to rank
// 12 (the phase-end collection happens there). 'rc': the normal list and
// then `rcBoards`; only what happens in Recompletion is kept.
//   drops  { dropGroups, dropGroupsConfig, minDropRank } to play instead of
//          the boards' own (a candidate under test)
// Every player rolls their own lucky drops and containers; the same seed
// gives the same luck to every candidate, so two candidates differ by what
// they change and not by the draw.
export function recordCadenceRuns({ boards, rcBoards = null, phase = 'main', runs = DEFAULT_CADENCE_RUNS, seed = DEFAULT_CADENCE_SEED, drops = null } = {}) {
  const board0 = boards[0]
  const rc0 = rcBoards?.[0]
  const own = (b) => ({ dropGroups: b?.dropGroups ?? [], dropGroupsConfig: b?.dropGroupsConfig ?? [], minDropRank: b?.minDropRank })
  const main = phase === 'main' && drops ? drops : own(board0)
  const rc = phase === 'rc' ? (drops ?? own(rc0)) : null
  const records = []
  for (let i = 0; i < runs; i++) {
    // PAIRED RANDOMNESS. Player i has their own two streams, seeded by the
    // batch seed and i alone: one for generator luck, one for which container
    // a merge rolls. A candidate that adds Twister drops therefore cannot
    // shift anybody's lucky drops (the streams are separate), and cannot
    // shift the next player's (each starts fresh). Two candidates give player
    // i the same luck for as long as that player's taps are the same.
    const luckRng = mulberry32((seed * 1000003 + i * 7919 + 17) >>> 0)
    const dropRng = mulberry32((seed * 1000003 + i * 7919 + 104729) >>> 0)
    const options = {
      rewardChainConfig: board0.rewardChainConfig,
      dropGroupsConfig: main.dropGroupsConfig,
      dropGroupsById: new Map(main.dropGroups.map((g) => [g.id, g])),
      minDropRank: main.minDropRank,
      leftoverPolicy: board0.rewardLeftoverPolicy,
      dropRng,
      luckRng,
      cadence: true,
    }
    if (phase === 'rc') {
      options.rcBoards = rcBoards
      options.rcDropGroupsConfig = rc.dropGroupsConfig
      options.rcDropGroupsById = new Map(rc.dropGroups.map((g) => [g.id, g]))
      options.rcMinDropRank = rc.minDropRank
    }
    const result = simulatePlaythrough(boards, options)
    const of = (list) => list.filter((e) => e[0] === phase)
    const entered = phase === 'main' || result.rcEntered
    const stats = phase === 'rc' ? result.rcPhase : (result.mainPhase ?? result)
    const merges = {}
    const mergeDr = {}
    for (const [, dr, rank] of of(result.cadence.merges)) {
      merges[rank] = (merges[rank] ?? 0) + 1
      if (rank >= 5) (mergeDr[rank] ??= []).push(dr)
    }
    const collected = phase === 'rc' ? result.collectedRcPhase : result.collectedMainPhase
    records.push({
      entered,
      completed: phase === 'rc' ? !!result.secondGrandPrizeAwarded : result.reachedAt?.[12] !== undefined,
      // Paid DR of the phase when it ended.
      phaseDr: result.cadence.phaseEndDr[phase] ?? 0,
      merges,
      mergeDr,
      // [paid DR, item rank]
      drops: of(result.cadence.drops).map(([, dr, rank]) => [dr, rank]),
      // [paid DR, reward rank collected, at the phase end?]
      collects: of(result.cadence.collects).map(([, dr, , rank, end, actions]) => [dr, rank, !!end, actions ?? 0]),
      // Merge energy of the phase: { start, play, cleanup, used, left }.
      energy: result.energyFlow?.[phase] ?? null,
      paidTaps: result.paidTaps?.[phase] ?? 0,
      payouts: Object.fromEntries(REWARD_TYPES.map((t) => [t, collected?.[t] ?? 0])),
      tileCoins: (phase === 'rc' ? result.collectedBySourceRcPhase : result.collectedBySourceMainPhase)?.tile?.coins ?? 0,
      // Board pressure: reward items the player had to tap to free a cell.
      spaceCollects: result.spaceCollects ?? 0,
      // Where the dropped items physically went (the phase asked).
      space: result.cadence.space[phase],
      // Recompletion only: Twister items held when it began (in rank-1 units
      // too), and what was collected in the normal event of the same run.
      carried: phase === 'rc' ? (result.cadence.carried ?? { items: 0, units: 0 }) : null,
      mainCollects: phase === 'rc' ? result.cadence.collects.filter((e) => e[0] === 'main').map(([, dr, , rank, end]) => [dr, rank, !!end]) : null,
      // Tiles: how much of the subsidy was opened, and reward items still
      // semi-blocked at the end (never the player's).
      subsidyShare: stats?.subsidyConfigured > 0 ? stats.subsidyDelivered / stats.subsidyConfigured : 1,
      boardsReached: stats?.boardsReached ?? null,
      boardsTotal: stats?.boardsTotal ?? null,
      stuckLeft: result.leftoverItemCount ?? 0,
    })
  }
  return records
}

// --- One player's spins -----------------------------------------------------

// What one recorded player can spin, and when, at `values` (the four Twister
// DR values) and `cost` (Twister DR a twist). Times are % of `demand`.
//   startBalance  Twister DR the player already holds when the phase begins
//                 (a carried-over balance): spins it affords count at 0%
//   discount      Twister DR to leave out of the first income (the worth of
//                 items carried in from the phase before)
export function playerSpins(record, { values, cost, target = null, demand, startBalance = 0, discount = 0 }) {
  const pct = (dr) => (demand > 0 ? (dr / demand) * 100 : 0)
  const endPct = pct(record.phaseDr)
  let earned = Math.max(0, startBalance)
  let spins = 0
  let toSkip = Math.max(0, discount)
  let earnedInPlay = 0
  let endAmount = 0
  const opportunities = [] // { pct, spins, end }
  const incomes = [] // { pct, amount }
  let firstIncomePct = null
  let firstIncomeAtEnd = false
  let targetPct = null
  let targetAtEnd = false
  if (cost > 0 && earned >= cost) {
    spins = Math.floor((earned + 1e-9) / cost)
    opportunities.push({ pct: 0, spins, end: false, carried: true })
    if (target > 0 && spins >= target) targetPct = 0
  }
  let firstSpinActions = null
  for (const [dr, rank, end, actions] of record.collects) {
    let amount = values[Math.min(rank, REWARD_MAX_RANK) - 1] ?? 0
    if (toSkip > 0) {
      const off = Math.min(toSkip, amount)
      toSkip -= off
      amount -= off
    }
    if (!(amount > 0)) continue
    earned += amount
    incomes.push({ pct: pct(dr), amount })
    if (end) endAmount += amount
    else earnedInPlay += amount
    if (firstIncomePct == null) {
      firstIncomePct = pct(dr)
      firstIncomeAtEnd = end
    }
    const now = cost > 0 ? Math.floor((earned + 1e-9) / cost) : 0
    if (now > spins) {
      if (firstSpinActions == null) firstSpinActions = actions ?? 0
      opportunities.push({ pct: pct(dr), spins: now - spins, end })
      spins = now
      if (target > 0 && targetPct == null && spins >= target) {
        targetPct = pct(dr)
        targetAtEnd = end
      }
    }
  }
  // Spins the player has when they have paid `mark`% of the demand. A player
  // whose phase ended before that never gets there: they keep what they
  // ended with (and are counted as "finished before" by the caller).
  const spinsAt = (mark) => opportunities.filter((o) => o.pct <= mark + 1e-9).reduce((sum, o) => sum + o.spins, 0)
  // The longest wait between two chances to spin, in points of demand: from
  // the start to the first, between two, and from the last to the phase end.
  const times = [0, ...opportunities.map((o) => o.pct), endPct]
  let longestGap = 0
  for (let i = 1; i < times.length; i++) longestGap = Math.max(longestGap, times[i] - times[i - 1])
  const funded = opportunities.map((o) => o.spins)
  return {
    endPct,
    earned,
    earnedInPlay,
    endAmount,
    spins,
    balanceLeft: cost > 0 ? earned - spins * cost : earned,
    finishedItems: record.collects.filter(([, rank, end]) => rank >= REWARD_MAX_RANK && !end).length,
    firstIncomePct,
    firstIncomeAtEnd,
    firstSpinPct: opportunities[0]?.pct ?? null,
    // Generator actions (paid and free taps) made in the phase before the
    // first spin: 0% of the demand paid is not "no play" when taps were free.
    firstSpinActions: opportunities[0]?.carried ? 0 : firstSpinActions,
    firstSpinAtEnd: opportunities[0]?.end ?? false,
    opportunities,
    opportunitiesInPlay: opportunities.filter((o) => !o.end).length,
    spinsAt,
    // Twister DR collected by the time `mark`% of the demand is paid.
    earnedAt: (mark) => incomes.filter((x) => x.pct <= mark + 1e-9).reduce((sum, x) => sum + x.amount, 0),
    targetPct,
    targetAtEnd,
    longestGap,
    biggest: funded.length ? Math.max(...funded) : 0,
    perOpportunity: funded.length ? funded.reduce((s, v) => s + v, 0) / funded.length : null,
  }
}

// --- A segment's players together -------------------------------------------

// Everything asked of a cadence, over all recorded players - none is left out
// of a figure because they ended early (those are counted and named).
export function cadenceSummary(records, { values, cost, target = null, demand, marks = DEMAND_MARKS, window = TWISTER_WINDOW_PCT }) {
  const players = records.map((r) => playerSpins(r, { values, cost, target, demand }))
  const n = players.length
  const meanBy = (pick) => {
    const keys = new Set(records.flatMap((r) => Object.keys(pick(r))))
    return Object.fromEntries([...keys].sort((a, b) => a - b).map((k) => [k, records.reduce((s, r) => s + (pick(r)[k] ?? 0), 0) / Math.max(1, n)]))
  }
  const dropsByRank = (r) => {
    const out = {}
    for (const [, rank] of r.drops) out[rank] = (out[rank] ?? 0) + 1
    return out
  }
  // When the eligible merges happen, in % of demand: per resulting rank, the
  // share of them that has happened by 25 / 50 / 75%.
  const mergeTiming = {}
  for (const rank of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
    const all = records.flatMap((r) => (r.mergeDr[rank] ?? []).map((dr) => (demand > 0 ? (dr / demand) * 100 : 0)))
    if (all.length === 0) continue
    mergeTiming[rank] = { by25: share(all, (p) => p <= 25), by50: share(all, (p) => p <= 50), by75: share(all, (p) => p <= 75), median: spread(all).p50 }
  }
  const reached = players.filter((p) => p.targetPct != null)
  return {
    players: n,
    demand,
    values,
    cost,
    target,
    window,
    completed: share(records, (r) => r.completed),
    // Where the phase ends, in % of demand (under 100: the player finished
    // having paid less than the demand; over 100: more).
    endPct: spread(players.map((p) => p.endPct)),
    mergesByRank: meanBy((r) => r.merges),
    mergeTiming,
    twisterDropsByRank: meanBy(dropsByRank),
    twisterDrops: spread(records.map((r) => r.drops.length)),
    // Finished (rank 4) Twister items during play - the phase-end collection
    // is not one of them.
    finishedItems: spread(players.map((p) => p.finishedItems)),
    income: spread(players.map((p) => p.earned)),
    incomeInPlay: spread(players.map((p) => p.earnedInPlay)),
    // What the phase-end collection adds (merged up and tapped at the top rank).
    phaseEndIncome: spread(players.map((p) => p.endAmount)),
    phaseEndShare: (() => {
      const total = players.reduce((s, p) => s + p.earned, 0)
      return total > 0 ? players.reduce((s, p) => s + p.endAmount, 0) / total : 0
    })(),
    firstIncomePct: spread(players.map((p) => p.firstIncomePct)),
    noIncome: share(players, (p) => p.firstIncomePct == null),
    firstIncomeOnlyAtEnd: share(players, (p) => p.firstIncomeAtEnd),
    firstSpinPct: spread(players.map((p) => p.firstSpinPct)),
    firstSpinActions: spread(players.map((p) => p.firstSpinActions)),
    // Merge energy of the phase, a player on average: where it came from and
    // where it went (energyFlow in the simulator).
    energy: (() => {
      const mean = (pick) => (records.length ? records.reduce((sum, r) => sum + (pick(r.energy ?? {}) ?? 0), 0) / records.length : 0)
      const start = mean((e) => e.start)
      const play = mean((e) => e.play)
      const cleanup = mean((e) => e.cleanup)
      const used = mean((e) => e.used)
      const left = mean((e) => e.left)
      return { start, play, cleanup, used, left, collected: play + cleanup, tooLate: Math.max(0, play + cleanup - Math.max(0, used - start)) }
    })(),
    paidTaps: spread(records.map((r) => r.paidTaps ?? 0)),
    noSpin: share(players, (p) => p.firstSpinPct == null),
    firstSpinOnlyAtEnd: share(players, (p) => p.firstSpinAtEnd),
    spins: spread(players.map((p) => p.spins)),
    spinsAtMarks: Object.fromEntries(
      marks.map((mark) => [
        mark,
        {
          ...spread(players.map((p) => p.spinsAt(mark))),
          // Players whose phase ended before they had paid this much: they
          // never reach the mark, and are shown with what they ended with.
          finishedBefore: share(players, (p) => p.endPct < mark - 1e-9),
          ...(target > 0 ? { withTarget: share(players, (p) => p.spinsAt(mark) >= target) } : {}),
        },
      ]),
    ),
    incomeAtMarks: Object.fromEntries(marks.map((mark) => [mark, spread(players.map((p) => p.earnedAt(mark)))])),
    // Reached during play, only by the phase-end collection, or never - apart.
    targetInPlay: target > 0 ? share(players, (p) => p.targetPct != null && !p.targetAtEnd) : null,
    // When the twists asked are reached (over those who reach them), and who does not.
    targetPct: spread(reached.map((p) => p.targetPct)),
    targetMedianAll: (() => {
      const sorted = players.map((p) => p.targetPct ?? Infinity).sort((a, b) => a - b)
      const middle = sorted[Math.floor((sorted.length - 1) / 2)]
      return Number.isFinite(middle) ? middle : null
    })(),
    neverTarget: target > 0 ? share(players, (p) => p.targetPct == null) : null,
    targetOnlyAtEnd: target > 0 ? share(players, (p) => p.targetAtEnd) : null,
    targetBy: target > 0 ? Object.fromEntries(window.map((mark) => [mark, share(players, (p) => p.targetPct != null && !p.targetAtEnd && p.targetPct <= mark + 1e-9)])) : null,
    targetBefore: target > 0 ? share(players, (p) => p.targetPct != null && p.targetPct < window[0] - 15) : null,
    // Reached within 10 points of the window, either side.
    targetNear: target > 0 ? share(players, (p) => p.targetPct != null && p.targetPct >= window[0] - 10 - 1e-9 && p.targetPct <= window[1] + 10 + 1e-9) : null,
    opportunities: spread(players.map((p) => p.opportunities.length)),
    opportunitiesInPlay: spread(players.map((p) => p.opportunitiesInPlay)),
    longestGap: spread(players.map((p) => p.longestGap)),
    spinsPerOpportunity: spread(players.map((p) => p.perOpportunity)),
    biggestOpportunity: spread(players.map((p) => p.biggest)),
    // One collection paying for most of a player's spins.
    oneBigCollection: share(players, (p) => p.spins > 0 && p.biggest >= Math.max(2, 0.5 * p.spins)),
    balanceLeft: spread(players.map((p) => p.balanceLeft)),
    drSpent: spread(records.map((r) => r.phaseDr)),
    payouts: Object.fromEntries(REWARD_TYPES.map((t) => [t, spread(records.map((r) => r.payouts[t]))])),
    tileCoins: spread(records.map((r) => r.tileCoins)),
    spaceCollects: spread(records.map((r) => r.spaceCollects)),
    // The board itself: the fullest it got, players whose board was full at
    // some moment, and dropped items that had to wait off the board.
    peakOccupancy: spread(records.map((r) => r.space?.peak ?? null)),
    boardFull: share(records, (r) => (r.space?.fullEvents ?? 0) > 0),
    delayedDrops: spread(records.map((r) => r.space?.delayed ?? 0)),
    delayedTwisterDrops: spread(records.map((r) => r.space?.twisterDelayed ?? 0)),
    suppressedDrops: spread(records.map((r) => r.space?.suppressed ?? 0)),
    droppedItems: spread(records.map((r) => r.space?.drops ?? 0)),
    subsidyShare: spread(records.map((r) => r.subsidyShare)),
    allBoards: share(records, (r) => r.boardsTotal == null || r.boardsReached === r.boardsTotal),
    stuckLeft: spread(records.map((r) => r.stuckLeft)),
  }
}

// RECOMPLETION, AND WHAT COMES IN FROM THE NORMAL EVENT. Three things can
// cross the boundary, and which of them do is NOT decided (an open question
// for the game team) - so the same recorded players are read three ways and
// nothing is chosen here:
//   'items'    as the simulator plays it: Twister items on the board come
//              along and are finished in Recompletion; the balance starts at 0
//   'nothing'  the worth of the items carried in is left out (as if the
//              board started without them)
//   'balance'  the items AND the Twister DR left unspent in the normal event
//              (at the normal event's price) come along
// `mainCost`: the price of a twist in the normal event (for 'balance').
export function rcCarryScenarios(records, { values, cost, mainCost = null, target, demand }) {
  const carriedWorth = (r) => ((r.carried?.units ?? 0) / 2 ** (REWARD_MAX_RANK - 1)) * values[REWARD_MAX_RANK - 1]
  const unspent = (r) => {
    if (!(mainCost > 0) || !r.mainCollects) return 0
    const earned = r.mainCollects.reduce((sum, [, rank]) => sum + (values[Math.min(rank, REWARD_MAX_RANK) - 1] ?? 0), 0)
    return earned - Math.floor((earned + 1e-9) / mainCost) * mainCost
  }
  const read = (extra) => {
    const players = records.map((r) => playerSpins(r, { values, cost, target, demand, ...extra(r) }))
    const reach = players.map((p) => p.targetPct ?? Infinity).sort((a, b) => a - b)
    const middle = reach[Math.floor((reach.length - 1) / 2)]
    return {
      firstSpinPct: spread(players.map((p) => p.firstSpinPct)),
      firstSpinActions: spread(players.map((p) => p.firstSpinActions)),
      // Twister DR earned in the phase itself, and the twists it and the carry-in bought.
      earned: spread(players.map((p) => p.earned)),
      spinsAtStart: spread(players.map((p) => p.spinsAt(0))),
      reachPct: Number.isFinite(middle) ? middle : null,
      never: share(players, (p) => p.targetPct == null),
      spins: spread(players.map((p) => p.spins)),
    }
  }
  return {
    carriedItems: spread(records.map((r) => r.carried?.items ?? 0)),
    carriedWorth: spread(records.map(carriedWorth)),
    unspentBalance: spread(records.map(unspent)),
    items: read(() => ({})),
    nothing: read((r) => ({ discount: carriedWorth(r) })),
    balance: read((r) => ({ startBalance: unspent(r) })),
  }
}

// --- Values and price for the window ----------------------------------------

// Round Twister values that reward merging (each rank more than double the one
// below), with rank 4 near `top`: the economist's 2 / 5 / 12 / 30 scaled the way
// the build scales them (twisterEconomy.js: roundTwisterValues).
export const twisterValuesFor = (top) => roundTwisterValues(top / TWISTER_SHAPE[3])

// The smallest Twister ladder the fit gives: the economist's own starting
// values (2 / 5 / 12 / 30). Twister DR is a currency of its own, so only the
// RATIO of a value to the price of a twist changes anything a player sees -
// there is never one right pair. The fit therefore prefers SIMPLE numbers:
// values not under these, the smallest ladder that lands in the window, and
// with it the lowest price that does.
export const TWISTER_FIT_TOPS = [30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300]

// The values and price at which the TYPICAL player reaches the twists asked
// inside the window - the middle player of all, with those who never get
// there counted as never. Tried: the round ladders from the smallest up, and
// for each every whole-step price; kept: the first pair that lands in the
// window. When none does, the pair that misses it by least (and then the
// simplest) - `inWindow` false, and `reachable` lists the times the typical
// player CAN reach the twists at, so the gap is seen for what it is: too few
// finished items for a time in between.
//   locked  the four values, when they are not the fit's to choose (typed by
//           the economist, or Recompletion playing the normal event's): only
//           the price is fitted then.
// Returns { values, cost, medianPct, inWindow, miss, reachable } or null.
export function fitTwisterToWindow(records, { demand, target, step = 1, window = TWISTER_WINDOW_PCT, locked = null, maxSteps = 4000 } = {}) {
  if (!(target > 0) || !records.length) return null
  const inc = Math.max(1, Math.round(step))
  const ladders = locked ? [locked] : TWISTER_FIT_TOPS.map(twisterValuesFor)
  const seen = new Set()
  const reachable = new Set()
  let best = null
  for (const values of ladders) {
    // No price above what the richest player collects, divided by the twists
    // asked, can be met by anybody: the prices worth trying end there. (A
    // fixed number of price steps used to end the search early - with small
    // steps a segment that collects a lot was priced too low and reached
    // its twists far too soon.)
    const richest = records.reduce((most, r) => Math.max(most, r.collects.reduce((sum, [, rank]) => sum + (values[Math.min(rank, REWARD_MAX_RANK) - 1] ?? 0), 0)), 0)
    const lastStep = Math.min(maxSteps, Math.max(1, Math.ceil(richest / target / inc)))
    for (let k = 1; k <= lastStep; k++) {
      const cost = k * inc
      // Only the ratios matter: a pair that is another one scaled is skipped.
      const key = values.map((v) => Math.round((v / cost) * 1e6)).join()
      if (seen.has(key)) continue
      seen.add(key)
      const times = records.map((r) => playerSpins(r, { values, cost, target, demand }).targetPct ?? Infinity).sort((a, b) => a - b)
      const median = times[Math.floor((times.length - 1) / 2)]
      if (!Number.isFinite(median)) continue
      reachable.add(Math.round(median))
      const inWindow = median >= window[0] - 1e-9 && median <= window[1] + 1e-9
      const miss = inWindow ? 0 : Math.min(Math.abs(median - window[0]), Math.abs(median - window[1]))
      const candidate = { values, cost, medianPct: median, inWindow, miss }
      // (ladders and prices are walked from the simplest: only a pair that
      // misses by clearly less replaces the one kept)
      if (!best || candidate.miss < best.miss - 0.25) best = candidate
    }
  }
  if (best) return { ...best, reachable: [...reachable].sort((a, b) => a - b) }
  // No pair lets the typical player reach the twists at all: the most generous
  // one is returned (the biggest values at the lowest price), marked as such.
  const anyIncome = records.some((r) => r.collects.length > 0)
  return anyIncome ? { values: ladders[ladders.length - 1], cost: inc, medianPct: null, inWindow: false, miss: Infinity, reachable: [] } : null
}

// BOTH PHASES AT ONCE. The game has one reward table, so the four Twister
// values are the same in the normal event and in Recompletion; only the price
// of a twist is each phase's own. The values are therefore chosen for the two
// together: the smallest ladder at which BOTH phases have a price that lands
// their typical player in the window - else the ladder whose two best prices
// miss by least in total. `phases`: [{ records, demand, target, step }], the
// normal event first. Returns { values, phases: [fit, fit], inWindow }.
export function fitTwisterAcrossPhases(phases, { window = TWISTER_WINDOW_PCT, locked = null } = {}) {
  const asked = phases.filter((p) => p && p.target > 0 && p.records?.length)
  if (asked.length === 0) return null
  const ladders = locked ? [locked] : TWISTER_FIT_TOPS.map(twisterValuesFor)
  let best = null
  for (const values of ladders) {
    const fits = asked.map((p) => fitTwisterToWindow(p.records, { demand: p.demand, target: p.target, step: p.step, window, locked: values }))
    if (fits.some((f) => !f)) continue
    const miss = fits.reduce((sum, f) => sum + f.miss, 0)
    if (!best || miss < best.miss - 0.25) best = { values, fits, miss }
    if (miss === 0) break
  }
  if (!best) return null
  let k = 0
  return { values: best.values, inWindow: best.miss === 0, miss: best.miss, phases: phases.map((p) => (p && p.target > 0 && p.records?.length ? best.fits[k++] : null)) }
}

// --- Candidates --------------------------------------------------------------

const cloneGroups = (groups) => groups.map((g) => ({ ...g, items: { ...g.items } }))
const idFor = (items) =>
  `cad-${Object.entries(items)
    .map(([k, r]) => `${k}${r}`)
    .join('-')}`
// Rewrites the containers of the ranks `ranks` with `change(items, rank)`
// (returns the new items, or a list of [items, share] to split the container).
function rewriteRanks({ dropGroups, dropGroupsConfig, minDropRank }, ranks, change) {
  const byId = new Map(dropGroups.map((g) => [g.id, g]))
  const made = new Map()
  const idOf = (items) => {
    const id = idFor(items)
    if (!made.has(id)) made.set(id, { id, name: id, items, auto: true })
    return id
  }
  const tables = dropGroupsConfig.map((table) => {
    if (!table || !ranks.includes(table.rank)) return table
    const entries = []
    for (const e of table.entries ?? []) {
      const items = byId.get(e.groupId)?.items
      if (!items) continue
      const out = change({ ...items }, table.rank)
      const parts = Array.isArray(out) ? out : [[out, 1]]
      for (const [next, part] of parts) {
        const weight = Math.round(e.weight * part)
        if (weight > 0 && Object.keys(next).length > 0) entries.push({ groupId: idOf(next), weight })
      }
    }
    // Same containers written twice are one.
    const merged = new Map()
    for (const e of entries) merged.set(e.groupId, (merged.get(e.groupId) ?? 0) + e.weight)
    return { ...table, entries: [...merged].map(([groupId, weight]) => ({ groupId, weight })) }
  })
  const used = new Set(tables.flatMap((t) => (t?.entries ?? []).map((e) => e.groupId)))
  return { dropGroups: [...cloneGroups(dropGroups).filter((g) => used.has(g.id)), ...[...made.values()].filter((g) => !byId.has(g.id))], dropGroupsConfig: tables, minDropRank }
}
const ranksWithDrops = (drops) => drops.dropGroupsConfig.filter((t) => (t?.entries ?? []).length > 0 && (t.rank >= (drops.minDropRank ?? 6) || t.belowStart === true)).map((t) => t.rank)

// The drop structures compared. Each one is the build's own table with ONE
// thing changed, so its effect can be told apart from the others'. `rules`
// names every exception to the drop rules in force that a candidate makes -
// none of them is a production rule; they are experiments.
export const CADENCE_CANDIDATES = [
  {
    id: 'current',
    label: 'Current drops',
    changes: 'Nothing: the table the build made.',
    rules: [],
    apply: (drops) => drops,
  },
  {
    id: 'rank5',
    label: 'Twister from rank 5',
    changes: 'A merge that makes rank 5 drops one rank-1 Twister item. Everything from rank 6 up is unchanged.',
    rules: ['Drops start at rank 5 instead of 6 - for the Twister item only.'],
    apply: (drops) => {
      const id = 'cad-twister1'
      const tables = drops.dropGroupsConfig.map((t) => (t?.rank === 5 ? { ...t, noDropWeight: 0, entries: [{ groupId: id, weight: 1000 }] } : t))
      return { dropGroups: [...cloneGroups(drops.dropGroups).filter((g) => g.id !== id), { id, name: 'Twister', items: { [TWISTER_TYPE]: 1 }, auto: true }], dropGroupsConfig: tables, minDropRank: Math.min(5, drops.minDropRank ?? 6) }
    },
  },
  {
    id: 'rank7always',
    label: 'Twister in every rank-7 drop',
    changes: 'Every merge that makes rank 7 drops its reward and a Twister item (today about two in three do).',
    rules: ['Rank 7 always drops two items, instead of one or two.'],
    apply: (drops) =>
      rewriteRanks(drops, [7], (items, rank) => {
        if (items[TWISTER_TYPE] != null || Object.keys(items).length >= 2) return items
        const size = drops.dropGroups.map((g) => (drops.dropGroupsConfig[rank - 1].entries.some((e) => e.groupId === g.id) ? g.items[TWISTER_TYPE] : null)).find((r) => r != null) ?? 1
        return { ...items, [TWISTER_TYPE]: size }
      }),
  },
  {
    id: 'rank6half',
    label: 'Twister in half the rank-6 drops',
    changes: 'Half the merges that make rank 6 drop a rank-1 Twister item instead of the reward under the tiles.',
    rules: ['Rank 6 no longer always drops the reward under the tiles: half as many free items to open the ones under the tiles.'],
    apply: (drops) => rewriteRanks(drops, [6], (items) => (items[TWISTER_TYPE] != null ? items : [[items, 0.5], [{ [TWISTER_TYPE]: 1 }, 0.5]])),
  },
  {
    id: 'thirdPlace',
    label: 'Twister in the three-item drops',
    changes: 'From rank 10 the Twister item takes one of the three places, in place of the smallest reward item there.',
    rules: ['A three-item drop holds two rewards and the Twister item, instead of three rewards: one reward item fewer at each of those merges.'],
    apply: (drops) =>
      rewriteRanks(
        drops,
        ranksWithDrops(drops).filter((r) => r >= 10 && r <= 12),
        (items) => {
          if (items[TWISTER_TYPE] != null) return items
          const rewards = Object.entries(items)
          if (rewards.length < 3) return rewards.length < MAX_GROUP_ITEMS ? { ...items, [TWISTER_TYPE]: 1 } : items
          const drop = rewards.reduce((low, e) => (e[1] <= low[1] ? e : low))
          const next = Object.fromEntries(rewards.filter((e) => e !== drop))
          return { ...next, [TWISTER_TYPE]: 2 }
        },
      ),
  },
  {
    id: 'bigger79',
    label: 'Bigger Twister items at ranks 7-9',
    changes: 'The Twister item in the drops of the merges that make ranks 7, 8 and 9 is one rank higher (rank 3 at most). The rank-5 drop stays one rank-1 Twister item; every reward item and every item count is as it is.',
    rules: [],
    apply: (drops) => rewriteRanks(drops, [7, 8, 9], (items) => (items[TWISTER_TYPE] != null ? { ...items, [TWISTER_TYPE]: Math.min(REWARD_MAX_RANK - 1, items[TWISTER_TYPE] + 1) } : items)),
  },
  {
    id: 'bigger',
    label: 'Bigger Twister items',
    changes: 'Every Twister item dropped is one rank higher (rank 3 at most). Same merges, same number of items.',
    rules: [],
    apply: (drops) => rewriteRanks(drops, ranksWithDrops(drops), (items) => (items[TWISTER_TYPE] != null ? { ...items, [TWISTER_TYPE]: Math.min(REWARD_MAX_RANK - 1, items[TWISTER_TYPE] + 1) } : items)),
  },
]
export const candidateById = (id) => CADENCE_CANDIDATES.find((c) => c.id === id) ?? null
// Several candidates applied one after another ("combined").
export function combineCandidates(ids) {
  const parts = ids.map(candidateById).filter(Boolean)
  return {
    id: ids.join('+'),
    label: parts.map((c) => c.label).join(' + '),
    changes: parts.map((c) => c.changes).join(' '),
    rules: parts.flatMap((c) => c.rules),
    apply: (drops) => parts.reduce((d, c) => c.apply(d), drops),
  }
}

// The Twister DR values and price a list was built with (null: none set).
export function builtTwisterOf(phaseBoards) {
  const b0 = phaseBoards?.[0]
  const values = Array.from({ length: REWARD_MAX_RANK }, (_, i) => rewardPrizeAmount(b0?.rewardChainConfig, TWISTER_TYPE, i + 1))
  return { values: values.every((v) => v > 0) ? values : null, cost: b0?.twisterSpinCost > 0 ? b0.twisterSpinCost : null }
}

// The short form of a cadence a screen shows: when the typical player reaches
// the twists, against the window, and how the spins arrive.
//   verdict  'in-window' | 'early' | 'late' | 'never' (the typical player
//            does not reach them) | null (no twists asked)
export function timingOf(summary) {
  if (!summary) return null
  const { target, window } = summary
  const reach = summary.targetMedianAll
  const verdict = !(target > 0) ? null : reach == null ? 'never' : reach < window[0] - 1e-9 ? 'early' : reach > window[1] + 1e-9 ? 'late' : 'in-window'
  return {
    demand: summary.demand,
    window,
    players: summary.players,
    values: summary.values,
    cost: summary.cost,
    target,
    reachPct: reach,
    reachP10: summary.targetPct.p10,
    reachP90: summary.targetPct.p90,
    verdict,
    by: summary.targetBy,
    // Reached during play (not only by what is tapped when the phase ends).
    inPlay: summary.targetInPlay,
    near: summary.targetNear,
    never: summary.neverTarget,
    onlyAtEnd: summary.targetOnlyAtEnd,
    // The phase ends here, in % of demand (the typical player; under 100 means
    // they finish having paid less than the demand).
    endPct: summary.endPct.p50,
    finishedBefore100: summary.spinsAtMarks[100]?.finishedBefore ?? null,
    firstSpinPct: summary.firstSpinPct.p50,
    firstSpinActions: summary.firstSpinActions.p50,
    noSpin: summary.noSpin,
    chances: summary.opportunitiesInPlay.p50,
    twistsPerChance: summary.spinsPerOpportunity.mean,
    finishedItems: summary.finishedItems.p50,
    longestGap: summary.longestGap.p50,
    oneBigCollection: summary.oneBigCollection,
    spinsAt: Object.fromEntries(Object.entries(summary.spinsAtMarks).map(([mark, s]) => [mark, { typical: s.p50, low: s.p10, high: s.p90, finishedBefore: s.finishedBefore }])),
    phaseEndShare: summary.phaseEndShare,
    balanceLeft: summary.balanceLeft.p50,
  }
}

// THE BUILD'S OWN TWISTER, TIMED ON THE DR SPENT. For every priced row of a
// build's Twister table (twisterEconomy.js: priceTwisterForBuild) the segment
// is played again and `row.demandTiming` says when its typical player reaches
// the twists, in % of the segment's demand. Nothing is repriced here: this is
// the price the build set, measured with the clock the economist asked for.
export async function addDemandTiming({ phase, segments, built, shared, twister, runs = 100, seed = DEFAULT_CADENCE_SEED, isCancelled } = {}) {
  if (!twister?.rows?.length) return twister
  for (const row of twister.rows) {
    const seg = (segments ?? []).find((s) => s.index === row.index)
    const segOut = (built ?? []).find((o) => o.index === row.index && o.status !== 'skipped')
    if (!seg || !segOut?.boards?.length || !(row.cost > 0)) continue
    const ladder = shared?.twisterLadder ?? segOut.boards[0].rewardChainConfig?.[TWISTER_TYPE]
    const values = Array.from({ length: REWARD_MAX_RANK }, (_, i) => ladder?.[i]?.prizeAmount ?? 0)
    if (!values.every((v) => v > 0)) continue
    const boards = segOut.boards.map((b) => ({ ...b, dropGroups: shared?.dropGroups ?? b.dropGroups, dropGroupsConfig: shared?.dropGroupsConfig ?? b.dropGroupsConfig }))
    const records = recordCadenceRuns({ boards: phase === 'rc' ? seg.mainBoards : boards, rcBoards: phase === 'rc' ? boards : null, phase, runs, seed })
    row.demandTiming = timingOf(cadenceSummary(records, { values, cost: row.cost, target: row.twists ?? null, demand: phaseDemand(phase, boards) }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (isCancelled?.()) return null
  }
  return twister
}

// THE BUILD'S TWISTER: values and the price of a twist for every segment,
// fitted to the window on exactly the boards, drops and reward values the
// build ended with (economist: "Fit against the final calibrated boards ...
// Target the requested spin count at 70-75% of configured demand spent").
//   - the normal event: each segment gets its OWN four values and its own
//     price (fitTwisterToWindow) - unless the economist typed the Twister
//     values, which are then kept and only the price is fitted;
//   - Recompletion plays the normal event's values (one table), so only its
//     price is fitted; a segment it cannot land in the window with that says
//     so (`fit.reachable`: where the twists can land).
// Returns null when no segment asks for twists, undefined when cancelled,
// else { runs, seed, window, clock: 'demand', rows }. A row carries the fit
// (`cost`, `values`, `ladder` to write, `demandTiming`, `fit`) and, for the
// screens written before the clock changed, the same facts under their old
// names (finishPct and the marks are now % of the DR demand spent).
export const BUILD_CADENCE_RUNS = 120
const PACE_OF = { 'in-window': 'on-track', early: 'early', late: 'late', never: 'late' }
export async function fitTwisterForBuild({ phase, segments, built, shared, runs = BUILD_CADENCE_RUNS, seed = DEFAULT_CADENCE_SEED, isCancelled } = {}) {
  const measured = (segments ?? []).filter((seg) => (built ?? []).some((o) => o.index === seg.index && o.status !== 'skipped'))
  if (!measured.some((seg) => seg.twists > 0)) return null
  const rows = []
  for (const seg of measured) {
    const segOut = built.find((o) => o.index === seg.index && o.status !== 'skipped')
    const row = { index: seg.index, name: seg.name, twists: seg.twists ?? null, step: Math.max(1, Math.round(seg.twisterCostStep ?? 1)), status: 'not-set-up', cost: null, values: null, ladder: null, incomeMean: null, spinsMedian: null, spinsMean: null, attainment: null, message: null }
    rows.push(row)
    const boards = segOut.boards.map((b) => ({ ...b, dropGroups: shared?.dropGroups ?? b.dropGroups, dropGroupsConfig: shared?.dropGroupsConfig ?? b.dropGroupsConfig }))
    const b0 = boards[0]
    const current = Array.from({ length: REWARD_MAX_RANK }, (_, i) => rewardPrizeAmount(b0?.rewardChainConfig, TWISTER_TYPE, i + 1))
    if (!current.every((v) => v > 0) || !hasTwisterDrops(b0?.dropGroups, b0?.dropGroupsConfig, b0?.minDropRank)) {
      row.message = 'Twister has no rank values or no drops in this phase.'
      continue
    }
    const records = recordCadenceRuns({ boards: phase === 'rc' ? seg.mainBoards : boards, rcBoards: phase === 'rc' ? boards : null, phase, runs, seed })
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (isCancelled?.()) return undefined
    const demand = phaseDemand(phase, boards)
    const typed = !twisterLadderIsAuto(b0.rewardChainConfig)
    const locked = phase === 'rc' ? 'normal-event' : typed ? 'typed' : null
    if (!(seg.twists > 0)) {
      const summary = cadenceSummary(records, { values: current, cost: 0, target: null, demand })
      row.status = 'no-twists'
      row.message = 'No twists were typed for this segment, so it has no price.'
      row.values = current
      row.incomeMean = summary.income.mean
      row.incomeMedian = summary.income.p50
      row.incomeAtMarks = summary.incomeAtMarks
      row.collectsMedian = summary.finishedItems.p50
      continue
    }
    const fit = fitTwisterToWindow(records, { demand, target: seg.twists, step: row.step, locked: locked ? current : null })
    if (!fit) {
      row.status = 'no-income'
      row.message = 'No Twister DR is collected in this phase, so no price can give the twists. Check the Twister drops.'
      continue
    }
    const summary = cadenceSummary(records, { values: fit.values, cost: fit.cost, target: seg.twists, demand })
    const timing = timingOf(summary)
    row.cost = fit.cost
    row.values = fit.values
    row.valuesLocked = locked
    row.ladder = locked
      ? null
      : fit.values.map((v, i) => {
          const was = b0.rewardChainConfig[TWISTER_TYPE]?.[i] ?? {}
          return { ...was, syntax: syntaxWithAmount(was.syntax, v), prizeAmount: v, auto: true }
        })
    row.demandTiming = timing
    row.fit = { inWindow: fit.inWindow, medianPct: fit.medianPct, miss: fit.miss, reachable: fit.reachable }
    row.status = fit.inWindow ? 'ok' : 'approximate'
    row.tooLow = timing.verdict === 'never'
    const can = (fit.reachable ?? []).filter((v) => v >= 40 && v <= 110)
    row.message = fit.inWindow
      ? null
      : timing.verdict === 'never'
        ? `The typical player does not reach ${seg.twists} twists in this phase at any supported price${locked === 'normal-event' ? ' with the normal event\'s Twister values' : ''}.`
        : `The typical player reaches the ${seg.twists} twists at ${Math.round(timing.reachPct)}% of the DR demand, not at ${TWISTER_WINDOW_PCT[0]}-${TWISTER_WINDOW_PCT[1]}%. ${locked === 'normal-event' ? 'Recompletion plays the normal event\'s Twister values, so only its price can move; ' : locked === 'typed' ? 'The Twister values are the ones you typed, so only the price can move; ' : ''}${locked === 'normal-event' || locked === 'typed' ? 'with' : 'With'} about ${Math.round(timing.finishedItems)} finished Twister items the twists can land at ${can.join(', ')}%.`
    // The same facts under the names the older table reads.
    row.spinsMedian = summary.spins.p50
    row.spinsMean = summary.spins.mean
    row.attainment = summary.neverTarget == null ? null : 1 - summary.neverTarget
    row.incomeMean = summary.income.mean
    row.incomeMedian = summary.income.p50
    row.topValue = fit.values[REWARD_MAX_RANK - 1]
    row.collectsMedian = summary.finishedItems.p50
    row.finishPct = timing.reachPct == null ? null : Math.round(timing.reachPct)
    row.pace = PACE_OF[timing.verdict] ?? null
    row.incomeAtMarks = summary.incomeAtMarks
  }
  return { runs, seed, window: TWISTER_WINDOW_PCT, clock: 'demand', rows }
}

// One segment, one candidate, both phases: the cadence at the values and
// prices that fit the window best (`atFit` - one ladder for the two phases, a
// price each), and at the values and price the event was built with
// (`asBuilt`). Recompletion plays the same table, so a candidate is applied
// to the one table and both phases are played with it.
//   segment  { name, boards, rcBoards, twists: { main, rc }, step }
//   phases   which to play (Recompletion needs rcBoards)
// Returns { candidate, values, inWindow, main: {...}, rc: {...} | null }.
export function measureCandidate({ segment, candidate, runs = DEFAULT_CADENCE_RUNS, seed = DEFAULT_CADENCE_SEED, phases = ['main', 'rc'], lockedValues = null }) {
  const played = phases.filter((phase) => (phase === 'rc' ? segment.rcBoards?.length > 0 : segment.boards?.length > 0))
  const parts = played.map((phase) => {
    const phaseBoards = phase === 'rc' ? segment.rcBoards : segment.boards
    const b0 = phaseBoards[0]
    const drops = candidate.apply({ dropGroups: b0.dropGroups ?? [], dropGroupsConfig: b0.dropGroupsConfig ?? [], minDropRank: b0.minDropRank ?? 6 })
    const records = recordCadenceRuns({ boards: segment.boards, rcBoards: phase === 'rc' ? segment.rcBoards : null, phase, runs, seed, drops })
    return { phase, records, drops, demand: phaseDemand(phase, phaseBoards), target: segment.twists?.[phase] ?? null, step: segment.step ?? 1, built: builtTwisterOf(phaseBoards) }
  })
  const fit = fitTwisterAcrossPhases(parts, { locked: lockedValues })
  const out = { candidate: candidate.id, values: fit?.values ?? null, inWindow: !!fit?.inWindow, main: null, rc: null }
  parts.forEach((p, i) => {
    const phaseFit = fit?.phases?.[i] ?? null
    out[p.phase] = {
      demand: p.demand,
      target: p.target,
      drops: p.drops,
      fit: phaseFit,
      atFit: phaseFit ? cadenceSummary(p.records, { values: phaseFit.values, cost: phaseFit.cost, target: p.target, demand: p.demand }) : null,
      asBuilt: p.built.values && p.built.cost ? cadenceSummary(p.records, { values: p.built.values, cost: p.built.cost, target: p.target, demand: p.demand }) : null,
      // With no twists asked there is nothing to fit; the cadence is still
      // measured, at the built values (a price of 1: every DR is "a spin").
      unpriced: !phaseFit && !(p.built.values && p.built.cost) && p.built.values ? cadenceSummary(p.records, { values: p.built.values, cost: 0, target: null, demand: p.demand }) : null,
    }
  })
  return out
}
