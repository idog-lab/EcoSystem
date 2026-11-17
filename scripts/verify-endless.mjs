// Endless mode - engine checks (lib/endlessMode.js, playSession.js).
// Run with: npx vite-node scripts/verify-endless.mjs
import { createBoard } from '../src/features/merge/lib/board.js'
import { REWARD_TYPES, TWISTER_TYPE, encodeReward, decodeReward, isMainItem } from '../src/features/merge/lib/rewardChain.js'
import { createDropGroup, createDropGroupsConfig } from '../src/features/merge/lib/dropGroups.js'
import { MAX_RANK, RC_MAX_RANK } from '../src/features/merge/lib/ranks.js'
import { buildAlwaysDropConfiguration } from '../src/features/merge/lib/rewardTargeting.js'
import {
  buildEndlessDrops,
  describeEndlessDrops,
  averageDrop,
  ENDLESS_DROP_RANK_SHIFT,
  ENDLESS_DROP_VALUE_MULTIPLIER,
  ENDLESS_COIN_ENERGY_SHARE,
} from '../src/features/merge/lib/endlessMode.js'
import {
  createPlaySession,
  spendGenerator,
  canSpendGenerator,
  spendEnergyForAction,
  canSpendEnergy,
  placeFromInventory,
  mergeItems,
  actionFor,
  collectRewardItem,
  twisterEarned,
  sessionProgress,
} from '../src/features/merge/lib/playSession.js'
import { phaseGoalRank } from '../src/features/merge/lib/mergeSimulation.js'

let failures = 0
let count = 0
const check = (name, cond) => {
  count += 1
  if (!cond) failures += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}`)
}
const sum = (o, keys = REWARD_TYPES) => keys.reduce((s, t) => s + (o[t] ?? 0), 0)
const near = (a, b, tol) => Math.abs(a - b) <= tol
const tableTotal = (t) => t.noDropWeight + t.entries.reduce((s, e) => s + e.weight, 0)

// Rank values for all four resources (coins are never seeded).
function chainConfig() {
  const config = createBoard('x').rewardChainConfig
  ;[0.05, 0.12, 0.27, 0.6].forEach((worth, i) => (config.coins[i] = { ...config.coins[i], prizeAmount: worth, syntax: `allowance(coins:${worth})` }))
  return config
}

// The kind of drops a build makes: every merge from rank 6 drops a bucket.
function builtDrops(minDropRank = 6, dropUnits = { coins: 60, puzzles: 40, energy: 30, charms: 20 }) {
  const mergesByRank = Object.fromEntries(Array.from({ length: RC_MAX_RANK }, (_, i) => [i + 1, i + 1 >= minDropRank ? 10 : 0]))
  const built = buildAlwaysDropConfiguration({ dropUnits, mergesByRank, dropGroups: [], dropGroupsConfig: createDropGroupsConfig(RC_MAX_RANK), minDropRank })
  return { dropGroups: built.dropGroups, dropGroupsConfig: built.dropGroupsConfig, minDropRank }
}

console.log('--- 1. The three rules: one rank lower, more per drop, mostly coins and energy ---')
{
  const base = builtDrops(6)
  const rewardChainConfig = chainConfig()
  const endless = buildEndlessDrops({ ...base, rewardChainConfig })
  const before = averageDrop(base.dropGroupsConfig, base.dropGroups, 6)
  const after = averageDrop(endless.dropGroupsConfig, endless.dropGroups, endless.minDropRank)
  check(`drops start one rank lower (rank ${endless.minDropRank}, was ${endless.baseMinDropRank})`, endless.minDropRank === 6 - ENDLESS_DROP_RANK_SHIFT && endless.baseMinDropRank === 6)
  const tables = endless.dropGroupsConfig.filter((t) => t.rank >= endless.minDropRank)
  check('every merge from the start rank up drops a bucket: no "nothing" outcome, weights out of 1000', tables.length === RC_MAX_RANK - endless.minDropRank + 1 && tables.every((t) => t.noDropWeight === 0 && tableTotal(t) === 1000 && t.entries.length > 0))
  check('ranks below the start rank drop nothing', endless.dropGroupsConfig.filter((t) => t.rank < endless.minDropRank).every((t) => t.entries.length === 0))
  check(`an average drop carries ${ENDLESS_DROP_VALUE_MULTIPLIER}x the units it did (${sum(before.units).toFixed(3)} -> ${sum(after.units).toFixed(3)})`, near(sum(after.units), sum(before.units) * ENDLESS_DROP_VALUE_MULTIPLIER, 0.02))
  const coinEnergyUnits = (after.units.coins + after.units.energy) / sum(after.units)
  check(`coins and merge energy are ${Math.round(ENDLESS_COIN_ENERGY_SHARE * 100)}% of the units (${(coinEnergyUnits * 100).toFixed(1)}%), split evenly`, near(coinEnergyUnits, ENDLESS_COIN_ENERGY_SHARE, 0.01) && near(after.units.coins, after.units.energy, 0.01))
  const info = describeEndlessDrops(endless, rewardChainConfig, { targetEv: 1.1 })
  check(`most dropped ITEMS are coins or merge energy (${Math.round(info.coinEnergyShare * 100)}%)`, info.coinEnergyShare > 0.5)
  check('the other resources keep the proportions they had (puzzles 2 : charms 1)', near(after.units.puzzles / after.units.charms, before.units.puzzles / before.units.charms, 0.05))
  const sizes = endless.dropGroups.map((g) => Object.keys(g.items).length)
  check(`buckets hold one to four items (sizes: ${[...new Set(sizes)].sort().join(', ')})`, sizes.every((n) => n >= 1 && n <= 4) && endless.dropGroups.length >= 2)
  check('the drops it was derived from are not changed', base.dropGroupsConfig[5].entries.length > 0 && base.dropGroupsConfig[4].entries.length === 0 && base.minDropRank === 6)
  check(`the readout: ${info.mergesPer100Dr.toFixed(1)} dropping merges and ${info.energyPer100Dr.toFixed(0)} merge energy per 100 DR`, info.mergesPer100Dr > 0 && near(info.energyPer100Dr, info.mergesPer100Dr * after.units.energy * (75 / 8), 0.5))
}

console.log('--- 2. Edge cases ---')
{
  const rewardChainConfig = chainConfig()
  // A resource with no rank values pays nothing, so it is left out.
  const noCoins = createBoard('x').rewardChainConfig
  const e1 = buildEndlessDrops({ ...builtDrops(6), rewardChainConfig: noCoins })
  const a1 = averageDrop(e1.dropGroupsConfig, e1.dropGroups, e1.minDropRank)
  check('coins with no rank values are left out; merge energy takes the whole priority share', a1.units.coins === 0 && near(a1.units.energy / sum(a1.units), ENDLESS_COIN_ENERGY_SHARE, 0.01))
  // No rank values at all: endless still starts, with nothing to drop.
  const blank = Object.fromEntries(Object.entries(rewardChainConfig).map(([t, ladder]) => [t, ladder.map((r) => ({ ...r, prizeAmount: 0 }))]))
  const e2 = buildEndlessDrops({ ...builtDrops(6), rewardChainConfig: blank })
  check('no rank values anywhere: no endless drops, and nothing breaks', e2.hasDrops === false && e2.dropGroups.length === 0 && e2.dropGroupsConfig.every((t) => t.entries.length === 0))
  // No drops before: one unit per drop, times the multiplier, coins + energy only.
  const e3 = buildEndlessDrops({ dropGroups: [], dropGroupsConfig: createDropGroupsConfig(RC_MAX_RANK), minDropRank: 6, rewardChainConfig })
  const a3 = averageDrop(e3.dropGroupsConfig, e3.dropGroups, e3.minDropRank)
  check(`a stage that had no merge drops gets coins and merge energy only (${sum(a3.units).toFixed(2)} units per drop)`, e3.hasDrops && near(sum(a3.units), ENDLESS_DROP_VALUE_MULTIPLIER, 0.02) && a3.units.puzzles === 0 && a3.units.charms === 0)
  // Only puzzles were dropping, coins/energy have values: they join in.
  const e4 = buildEndlessDrops({ ...builtDrops(6, { puzzles: 50 }), rewardChainConfig })
  const a4 = averageDrop(e4.dropGroupsConfig, e4.dropGroups, e4.minDropRank)
  check('a resource that was not dropping before is not added, except coins and merge energy', a4.units.charms === 0 && a4.units.puzzles > 0 && a4.units.coins > 0 && a4.units.energy > 0)
  // Drops already starting at rank 2 cannot start lower.
  const e5 = buildEndlessDrops({ ...builtDrops(2), rewardChainConfig })
  check('the start rank never goes below rank 2 (a merge makes at least a rank 2)', e5.minDropRank === 2)
  // Twister keeps its own odds, and reaches the new lowest rank.
  const withTwister = builtDrops(6)
  withTwister.dropGroups = [...withTwister.dropGroups, createDropGroup({ id: 'tw', name: 'Twister R1', items: { [TWISTER_TYPE]: 1 } })]
  withTwister.dropGroupsConfig = withTwister.dropGroupsConfig.map((t) => {
    if (t.rank < 6) return t
    // 100 of 1000 to Twister, taken from the largest entry.
    const entries = t.entries.map((e) => ({ ...e }))
    entries.sort((a, b) => b.weight - a.weight)[0].weight -= 100
    return { ...t, entries: [...entries, { groupId: 'tw', weight: 100 }] }
  })
  const e6 = buildEndlessDrops({ ...withTwister, rewardChainConfig })
  const twAt = (rank) => e6.dropGroupsConfig[rank - 1].entries.find((e) => e.groupId === 'tw')?.weight ?? 0
  check('Twister keeps its odds (100 of 1000) at every rank, including the new lowest', twAt(5) === 100 && twAt(6) === 100 && twAt(14) === 100 && e6.dropGroupsConfig.slice(4).every((t) => tableTotal(t) === 1000 && t.noDropWeight === 0))
  check('...and no endless bucket carries a Twister item of its own', e6.dropGroups.filter((g) => g.items[TWISTER_TYPE] != null).length === 1)
}

// ---------- a real session, played into endless mode --------------------
function ladderBoard(name, top, extra = {}) {
  const b = createBoard(name, { rows: 2, cols: top })
  b.tiles = [Array(top).fill('open'), Array(top).fill('semi')]
  b.semiPlacements = Array.from({ length: top }, (_, i) => ({ row: 1, col: i, rank: i + 1 }))
  b.blockedQueue = []
  return Object.assign(b, extra)
}
const findCell = (session, pred) => {
  const { state } = session
  for (let r = 0; r < state.rows; r++) for (let c = 0; c < state.cols; c++) if (state.itemAt[r][c] != null && pred(state.itemAt[r][c], state.stuck[r][c], r, c)) return [r, c]
  return null
}
// Walks one free item up the ladder of stuck items on row 1.
function climb(session, fromRank, toRank) {
  for (let rank = fromRank; rank <= toRank; rank++) {
    const mover = findCell(session, (v, stuck) => v === rank && !stuck)
    const target = findCell(session, (v, stuck) => v === rank && stuck)
    if (!mover || !target) return false
    mergeItems(session, mover, target)
  }
  return true
}

console.log('--- 3. A session reaches rank 14 and carries on in endless mode ---')
{
  const rewardChainConfig = chainConfig()
  const drops = builtDrops(6)
  const main = ladderBoard('Main 1', 11, { targetEv: 1, rewardChainConfig })
  const rc = ladderBoard('RC 1', 13, { targetEv: 1, tier2UnlockRank: 3, rewardChainConfig, dropGroups: drops.dropGroups, dropGroupsConfig: drops.dropGroupsConfig, minDropRank: 6, twisterSpinCost: 5 })
  const session = createPlaySession([main], 0, { rcBoards: [rc] })
  spendGenerator(session, session.tiers[0])
  check('the normal round is played to rank 12, which starts Recompletion', climb(session, 1, 11) && session.phase === 'rc')
  check('endless mode has not started before rank 14', session.endless === null)
  spendGenerator(session) // x4 -> a rank 3
  climb(session, 3, 12) // up to a rank 13
  check('at rank 13 it is still Recompletion', session.phase === 'rc' && session.reachedAt[13] !== undefined)
  const before = { items: session.state.itemAt.flat().filter((v) => v != null).length, inventory: session.inventory.length, collected: { ...session.collected }, drSpent: session.drSpent, minDropRank: session.minDropRank }
  const mover = findCell(session, (v, stuck) => v === 13 && !stuck)
  const target = findCell(session, (v, stuck) => v === 13 && stuck)
  mergeItems(session, mover, target)
  check('the merge that makes rank 14 starts endless mode', session.phase === 'endless' && session.reachedAt[RC_MAX_RANK] !== undefined && !!session.endless)
  check('...and logs it once', session.events.filter((e) => e.type === 'endless-entered').length === 1)
  check('the rank 14 stays on the board', !!findCell(session, (v) => v === RC_MAX_RANK))
  const after = { items: session.state.itemAt.flat().filter((v) => v != null).length, inventory: session.inventory.length }
  // The merge itself removes one item and its own drop may add some; nothing else changes.
  const dropsOfThatMerge = session.events.slice(session.events.findLastIndex((e) => e.type === 'merge')).filter((e) => e.type === 'merge-drop' && (e.cell || e.toInventory)).length
  check('nothing on the board or in the inventory is taken away on the way in', after.items + after.inventory === before.items + before.inventory - 1 + dropsOfThatMerge)
  check('rewards collected so far are kept', REWARD_TYPES.every((t) => session.collected[t] >= before.collected[t]))
  check(`drops now start one rank lower (rank ${session.minDropRank}, was ${before.minDropRank})`, session.minDropRank === before.minDropRank - 1)
  check('the Twister price carries on as it was', session.twisterSpinCost === 5 && twisterEarned(session) >= 0)
  check('progress reads as complete, against the rank-14 goal', sessionProgress(session) === 1 && phaseGoalRank('endless') === RC_MAX_RANK && phaseGoalRank('main') === MAX_RANK)

  // A merge that makes the NEW lowest rank (5) drops; before endless it did not.
  const state = session.state
  const free = []
  for (let r = 0; r < state.rows; r++) for (let c = 0; c < state.cols; c++) if (state.itemAt[r][c] == null && !state.locked[r][c]) free.push([r, c])
  state.itemAt[free[0][0]][free[0][1]] = 4
  state.itemAt[free[1][0]][free[1][1]] = 4
  const eventsBefore = session.events.length
  mergeItems(session, free[0], free[1])
  const fresh = session.events.slice(eventsBefore)
  check('a merge that makes rank 5 now drops a bucket (it did not before rank 14)', fresh.some((e) => e.type === 'merge' && e.newRank === 5) && fresh.some((e) => e.type === 'merge-drop'))
  check('...of real reward items in the four resources', fresh.filter((e) => e.type === 'merge-drop').every((e) => REWARD_TYPES.includes(e.rewardType)))
  // A merge that makes rank 4 still drops nothing. (The drop just above can
  // hold several items and fill the board: the reward items are cleared off
  // it first, so there is room to place the two test items.)
  for (let r = 0; r < state.rows; r++) for (let c = 0; c < state.cols; c++) if (state.itemAt[r][c] >= 1000 && !state.stuck[r][c]) state.itemAt[r][c] = null
  const free2 = []
  for (let r = 0; r < state.rows; r++) for (let c = 0; c < state.cols; c++) if (state.itemAt[r][c] == null && !state.locked[r][c]) free2.push([r, c])
  state.itemAt[free2[0][0]][free2[0][1]] = 3
  state.itemAt[free2[1][0]][free2[1][1]] = 3
  const eventsBefore2 = session.events.length
  mergeItems(session, free2[0], free2[1])
  check('a merge that makes rank 4 (below the start rank) still drops nothing', !session.events.slice(eventsBefore2).some((e) => e.type === 'merge-drop'))

  // Two rank 14s do not merge: there is no rank 15.
  const free3 = findCell({ state: { ...state, itemAt: state.itemAt.map((row) => row.map((v) => (v == null ? 0 : null))) } }, (v) => v === 0)
  const first14 = findCell(session, (v) => v === RC_MAX_RANK)
  state.itemAt[free3[0]][free3[1]] = RC_MAX_RANK
  check('two rank 14s cannot be merged (there is no rank 15)', actionFor(session, free3, first14) === null && actionFor(session, first14, free3) === null)
  state.itemAt[free3[0]][free3[1]] = null
  check('the generator still works', canSpendGenerator(session) && (spendGenerator(session), session.drSpent > before.drSpent))
  check('endless mode is entered once only', (climb(session, 3, 3), session.events.filter((e) => e.type === 'endless-entered').length === 1))
}

console.log('--- 4. A stage with no Recompletion list still ends at rank 12 ---')
{
  const session = createPlaySession([ladderBoard('Main 1', 11, { targetEv: 1 })], 0)
  spendGenerator(session, session.tiers[0])
  climb(session, 1, 11)
  check('no endless mode without Recompletion', session.phase === 'main' && session.endless === null && session.reachedAt[MAX_RANK] !== undefined)
}

console.log('--- 5. The energy-per-100-DR readout against real endless play ---')
{
  // An automatic player on the play session itself: free merges, inventory,
  // energy taps, then the generator - played for a long stretch of endless.
  const rewardChainConfig = chainConfig()
  const drops = builtDrops(6)
  const open = (name, extra) => {
    const b = createBoard(name, { rows: 6, cols: 8 })
    b.tiles = b.tiles.map((row) => row.map(() => 'open'))
    return Object.assign(b, { semiPlacements: [], blockedQueue: [], rewardChainConfig, targetEv: 1.1, ...extra })
  }
  const session = createPlaySession([open('Main')], 0, { rcBoards: [open('RC', { dropGroups: drops.dropGroups, dropGroupsConfig: drops.dropGroupsConfig, minDropRank: 6 })] })
  const pickMerge = () => {
    const seen = new Map()
    const { state } = session
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        const v = state.itemAt[r][c]
        if (v == null || (isMainItem(v) && v >= RC_MAX_RANK)) continue
        if (seen.has(v)) return [seen.get(v), [r, c]]
        seen.set(v, [r, c])
      }
    }
    return null
  }
  const lowestReward = () => {
    let best = null
    const { state } = session
    for (let r = 0; r < state.rows; r++) for (let c = 0; c < state.cols; c++) {
      const d = decodeReward(state.itemAt[r][c])
      if (d && (!best || d.rank < best.rank)) best = { rank: d.rank, cell: [r, c] }
    }
    return best?.cell ?? null
  }
  let energyTaps = 0
  const step = () => {
    const merge = pickMerge()
    if (merge) return mergeItems(session, merge[0], merge[1])
    if (session.inventory.length && canSpendGenerator(session)) return placeFromInventory(session, 0)
    if (!canSpendGenerator(session)) {
      const cell = lowestReward()
      if (!cell) throw new Error('board full')
      return collectRewardItem(session, cell)
    }
    if (canSpendEnergy(session)) {
      energyTaps += 1
      return spendEnergyForAction(session)
    }
    return spendGenerator(session)
  }
  let guard = 0
  while (session.phase !== 'endless' && guard++ < 200000) step()
  check(`an automatic player reaches endless mode on open boards (${session.drSpent} DR)`, session.phase === 'endless')
  const info = describeEndlessDrops(session.endless, session.rewardChainConfig, { targetEv: session.targetEv })
  const start = { dr: session.drSpent, energy: session.collected.energy, taps: energyTaps, events: session.events.length }
  // Play on until 6000 taps' worth of generator output (DR + energy taps).
  const output = () => session.drSpent - start.dr + (energyTaps - start.taps)
  guard = 0
  while (output() < 6000 && guard++ < 400000) step()
  const fresh = session.events.slice(start.events)
  const measured = ((session.collected.energy - start.energy) / output()) * 100
  const dropping = fresh.filter((e) => e.type === 'merge' && isMainItem(e.rank) && e.newRank >= session.minDropRank).length
  const mergesPer100 = (dropping / output()) * 100
  check(`merges that drop per 100 DR of output: measured ${mergesPer100.toFixed(1)}, readout ${info.mergesPer100Dr.toFixed(1)}`, mergesPer100 > info.mergesPer100Dr * 0.75 && mergesPer100 < info.mergesPer100Dr * 1.25)
  check(`merge energy back per 100 DR of output: measured ${measured.toFixed(0)}, readout ${info.energyPer100Dr.toFixed(0)}`, measured > info.energyPer100Dr * 0.65 && measured < info.energyPer100Dr * 1.35)
  const droppedItems = fresh.filter((e) => e.type === 'merge-drop')
  const coinEnergy = droppedItems.filter((e) => e.rewardType === 'coins' || e.rewardType === 'energy').length / droppedItems.length
  check(`most items dropped in play are coins or merge energy: ${(coinEnergy * 100).toFixed(0)}% of ${droppedItems.length}`, coinEnergy > 0.5 && near(coinEnergy, info.coinEnergyShare, 0.06))
  check('every dropping merge dropped something', dropping > 0 && fresh.filter((e) => e.type === 'merge-drop').length >= dropping)
  check('no rank above 14 was ever made', Math.max(...Object.keys(session.reachedAt).map(Number)) === RC_MAX_RANK)
  check('encoded reward values never leak into the main chain', !findCell(session, (v) => !isMainItem(v) && !decodeReward(v)) && encodeReward('coins', 1) >= 1000)
}

console.log(failures === 0 ? `\nALL ${count} ENDLESS CHECKS PASSED` : `\n${failures} OF ${count} ENDLESS CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
