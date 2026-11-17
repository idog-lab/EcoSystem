import {
  simulatePlaythrough,
  buildInitialState,
  enterRecompletion,
  inBounds,
  buildReachability,
  performMerge,
  collectReward,
  findSpawnCell,
  currentMaxRank,
  advanceBoards,
  recordAllOccupied,
  mainChainProgress,
  phaseGoalRank,
} from './mergeSimulation'
import { currentTier, unlockedTiers, buildGeneratorTiers, DEFAULT_TIER2_UNLOCK_RANK, DEFAULT_TIER4_UNLOCK_RANK } from './generatorTier'
import { DEFAULT_TARGET_EV, computeProbs, rollBonus } from './luckyDrop'
import { isMainItem, rewardPrizeAmount, rewardChainForNextPhase, emptyRewardTally, TWISTER_TYPE } from './rewardChain'
import { MAX_RANK, RC_MAX_RANK } from './ranks'
import { MIN_DROP_RANK, multiDropRankOf, tripleDropRankOf } from './dropGroups'
import { buildEndlessDrops } from './endlessMode'

// An interactive counterpart to simulatePlaythrough: the same merge/reveal
// rule primitives (buildInitialState, buildReachability, performMerge), but
// every merge/move is player-initiated rather than picked by a greedy
// heuristic - built so the economist can manually play a board and compare
// what they did against what the automatic simulator predicts.
//
// The generator unlocks tiers on the same schedule the automatic simulator
// uses (keyed off the player's current max rank held) - x1/1DR always
// available, x2/2DR and x4/4DR unlock once the player holds an item at that
// board's own configured tier2UnlockRank/tier4UnlockRank (defaults 7/10 -
// see board.js, generatorTier.js's buildGeneratorTiers). Unlike the
// automatic simulator (which always greedily spends at the
// highest unlocked tier), the interactive tool lets the player pick ANY
// currently-unlocked tier - see unlockedGeneratorTiers/spendGenerator.
// Spawn placement is still the same findSpawnCell heuristic the automatic
// simulator uses - the player doesn't choose where a spend lands.
//
// The generator can lucky-drop a bonus rank on top of the tier's normal
// output, same as the automatic simulator and the same tier2UnlockRank-held
// gate (see spendGenerator) - but using a real per-tap random roll (rollBonus) rather
// than the automatic simulator's deterministic deficit-scheduler, since a
// real player expects genuine unpredictability, not a converging sequence.
// `session.targetEv` is fixed at session creation from the starting board's
// own targetEv field (not re-read live) - it doesn't change if a later wave
// board with a different targetEv pushes in, since lucky-drop chance is a
// property of the generator/player, not of whichever tile pattern happens
// to be visible.
//
// `boards` is the full board list, and play starts on `boards[startIndex]` -
// every board after it is the wave queue: once the active board has no
// locked/stuck cells left at all, the next board in the list pushes in as a
// fresh strip of rows from the top (see mergeSimulation.js's pushBoardIn),
// and anything that falls off the bottom edge lands in `session.inventory`
// for the player to click back onto a free cell later (placeFromInventory).
let nextSessionId = 1

export function createPlaySession(boards, startIndex = 0, options = {}) {
  const state = buildInitialState(boards[startIndex])
  // Same "fixed at session creation from the starting board" precedent as
  // targetEv just below - a later wave board's own (list-shared, so
  // normally identical anyway) unlock ranks never re-read mid-session.
  const tier2UnlockRank = boards[startIndex].tier2UnlockRank ?? DEFAULT_TIER2_UNLOCK_RANK
  const tier4UnlockRank = boards[startIndex].tier4UnlockRank ?? DEFAULT_TIER4_UNLOCK_RANK
  const session = {
    // Which session this is (a copy handed to React keeps it; a Reset makes a
    // new one). The play screens' effects use it to start clean.
    id: nextSessionId++,
    boards,
    boardIndex: startIndex,
    nextBoardIndex: startIndex + 1,
    targetEv: boards[startIndex].targetEv ?? DEFAULT_TARGET_EV,
    tier2UnlockRank,
    tiers: buildGeneratorTiers(tier2UnlockRank, tier4UnlockRank),
    state,
    drSpent: 0,
    reachedAt: {},
    events: [],
    inventory: [],
    // V2 reward chains / RC (Recompletion) phase. Each config defaults from
    // the STARTING BOARD's own saved fields (same "fixed at session
    // creation" precedent as targetEv/tiers above) so a session created with
    // no options at all - e.g. a shared ?play stage, whose boards travel
    // with their own config baked in - still collects/drops with the real
    // configured amounts rather than silently crediting zero.
    // `collected` is cumulative payout and never decremented; spending energy
    // draws down `energyBalance` (same split simulatePlaythrough keeps).
    collected: emptyRewardTally(),
    collectedBySource: { tile: emptyRewardTally(), drop: emptyRewardTally() },
    energyBalance: 0,
    // Twister widget (economy preview). collected.twister is the cumulative
    // Twister DR EARNED and never goes down; spins draw on the balance
    // (earned - twisterSpent). The cost per spin is the played segment's own
    // setting for the current phase's list; null/0 = not configured, and no
    // spin can be taken. spinObjective is an optional configured widget rule
    // (how many spins complete the widget) - shown as progress when present,
    // never invented and never a reason to stop drops.
    twisterSpent: 0,
    spinsUsed: 0,
    twisterSpinCost: boards[startIndex].twisterSpinCost ?? null,
    twisterSpinObjective: boards[startIndex].twisterSpinObjective ?? null,
    // Phase-end policy for unmerged reward items - see simulatePlaythrough.
    leftoverPolicy: options.leftoverPolicy ?? boards[startIndex].rewardLeftoverPolicy ?? 'forfeit',
    leftoverForfeited: emptyRewardTally(),
    rewardChainConfig: options.rewardChainConfig ?? boards[startIndex].rewardChainConfig ?? null,
    dropGroupsConfig: options.dropGroupsConfig ?? boards[startIndex].dropGroupsConfig ?? null,
    dropGroupsById:
      options.dropGroupsById ?? (boards[startIndex].dropGroups ? new Map(boards[startIndex].dropGroups.map((g) => [g.id, g])) : null),
    rcBoards: options.rcBoards ?? null,
    // RC-specific config overrides — stored at session creation so
    // maybeEnterRc can re-read them when the phase transitions, without
    // needing access to the original options object.
    rcRewardChainConfig: options.rcRewardChainConfig ?? null,
    rcDropGroupsConfig: options.rcDropGroupsConfig ?? null,
    rcDropGroupsById: options.rcDropGroupsById ?? null,
    minDropRank: options.minDropRank ?? boards[startIndex].minDropRank ?? null,
    rcMinDropRank: options.rcMinDropRank ?? null,
    // 'main' -> 'rc' (at rank 12, when a Recompletion list is attached) ->
    // 'endless' (at rank 14). `endless` holds the derived endless drops once
    // that phase starts (endlessMode.js); null before.
    phase: 'main',
    endless: null,
  }

  const recordRank = makeRecordRank(session)
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (state.itemAt[r][c] != null) {
        session.events.push({ drSpent: 0, type: 'initial', cell: [r, c], rank: state.itemAt[r][c] })
        // Only counts as "reached" if it's free from the start - see
        // mergeSimulation.js's identical guard on its own initial-state loop
        // for why (every pre-placed item is a semi tile, which always
        // starts stuck, so this is a no-op today, kept explicit anyway).
        if (!state.stuck[r][c]) recordRank(state.itemAt[r][c])
      }
    }
  }

  session.nextBoardIndex = advanceBoards(state, boards, session.nextBoardIndex, session.inventory, (waveBoard, rows, overflow) =>
    logEvent(session, { type: 'board-push', name: waveBoard.name, rows, overflow }),
  )
  recordAllOccupied(state, recordRank)

  return session
}

function makeRecordRank(session) {
  return (rank) => {
    if (!isMainItem(rank)) return // reward items (V2) never count as "reached"
    if (session.reachedAt[rank] === undefined) {
      session.reachedAt[rank] = session.drSpent
      session.events.push({ drSpent: session.drSpent, type: 'reached', rank })
    }
  }
}

function logEvent(session, event) {
  session.events.push({ drSpent: session.drSpent, ...event })
}

// Credits a collected reward (manual collect, auto-collect-at-rank-4, or a
// merge-drop) to the session's own tally, same shape simulatePlaythrough's
// own `onCollect` uses.
function makeOnCollect(session) {
  return (type, rank, tileShare = 1) => {
    const amount = session.rewardChainConfig ? rewardPrizeAmount(session.rewardChainConfig, type, rank) : 0
    session.collected[type] = (session.collected[type] ?? 0) + amount
    session.collectedBySource.tile[type] += amount * tileShare
    session.collectedBySource.drop[type] += amount * (1 - tileShare)
    if (type === 'energy') session.energyBalance += amount
    logEvent(session, { type: 'collect', rewardType: type, rank, amount, tileShare })
  }
}

function performMergeOptionsFor(session) {
  return {
    revealAroundMover: false,
    onCollect: makeOnCollect(session),
    dropGroupsConfig: session.dropGroupsConfig,
    dropGroupsById: session.dropGroupsById,
    minDropRank: session.minDropRank,
    // A dropped reward item that finds no free cell waits in the inventory,
    // like anything else pushed off the board.
    inventory: session.inventory,
  }
}

// Recompletion starts the moment rank 12 is reached - the same rule, and the
// same hand-over (enterRecompletion), as the automatic simulator. Called
// after every action that can produce a rank 12.
// `clean` (the Play Tester's jump only): the player arrives on a fresh first
// Recompletion board holding just a rank 12 - nothing else comes along.
function maybeEnterRc(session, { clean = false } = {}) {
  if (session.phase !== 'main') return
  if (session.reachedAt[MAX_RANK] === undefined) return
  if (!session.rcBoards || !session.rcBoards.length) return

  // Everything on the board comes along (enterRecompletion) - reward items
  // too, so nothing is settled or forfeited at the hand-over.
  session.phase = 'rc'
  session.boards = session.rcBoards
  if (clean) arriveClean(session, session.rcBoards[0], MAX_RANK)
  else enterRecompletion(session.state, session.rcBoards[0], session.inventory)
  // Re-read ALL config from the RC boards' own values — the P0 bug was
  // that these were fixed at session creation from the main-phase starting
  // board and never updated here, so the RC phase ran with the main
  // phase's generator EV, tier unlocks, drop groups, and reward config.
  const rcBoard0 = session.rcBoards[0]
  session.targetEv = rcBoard0.targetEv ?? DEFAULT_TARGET_EV
  const rcTier2 = rcBoard0.tier2UnlockRank ?? DEFAULT_TIER2_UNLOCK_RANK
  const rcTier4 = rcBoard0.tier4UnlockRank ?? DEFAULT_TIER4_UNLOCK_RANK
  session.tier2UnlockRank = rcTier2
  session.tiers = buildGeneratorTiers(rcTier2, rcTier4)
  session.rewardChainConfig = rewardChainForNextPhase(session.rewardChainConfig, session.rcRewardChainConfig ?? rcBoard0.rewardChainConfig)
  session.dropGroupsConfig = session.rcDropGroupsConfig ?? rcBoard0.dropGroupsConfig ?? session.dropGroupsConfig
  session.dropGroupsById = session.rcDropGroupsById ?? (rcBoard0.dropGroups ? new Map(rcBoard0.dropGroups.map((g) => [g.id, g])) : session.dropGroupsById)
  session.minDropRank = session.rcMinDropRank ?? rcBoard0.minDropRank ?? session.minDropRank
  session.leftoverPolicy = rcBoard0.rewardLeftoverPolicy ?? session.leftoverPolicy
  // The RC list has its own Twister price and (optional) spin objective.
  // The unspent Twister balance and the spin count simply continue: no
  // reset or carry-over rule is configured or confirmed, so none is applied.
  session.twisterSpinCost = rcBoard0.twisterSpinCost ?? null
  session.twisterSpinObjective = rcBoard0.twisterSpinObjective ?? null
  logEvent(session, { type: 'rc-entered' })
  const recordRank = makeRecordRank(session)
  session.nextBoardIndex = advanceBoards(session.state, session.boards, 1, session.inventory, (waveBoard, rows, overflow) =>
    logEvent(session, { type: 'board-push', name: waveBoard.name, rows, overflow }),
  )
  recordAllOccupied(session.state, recordRank)
}

// Endless mode starts the moment rank 14 is reached - the second grand
// prize. Nothing on the board changes: every item, the inventory, the
// generator and the Twister balance carry on. Only the merge drops change
// (endlessMode.js): they start one rank lower, carry more, and are mostly
// coins and merge energy. They are derived here from the drops in force at
// this moment, so a stage link needs nothing new.
// `clean` (the Play Tester's jump only): the player arrives on a clean board -
// the size of the first Recompletion board, every tile open - holding just a
// rank 14, and no further board pushes in.
function maybeEnterEndless(session, { clean = false } = {}) {
  if (session.phase !== 'rc') return
  if (session.reachedAt[RC_MAX_RANK] === undefined) return
  const endless = buildEndlessDrops({
    dropGroups: session.dropGroupsById ? [...session.dropGroupsById.values()] : [],
    dropGroupsConfig: session.dropGroupsConfig ?? [],
    minDropRank: session.minDropRank ?? MIN_DROP_RANK,
    rewardChainConfig: session.rewardChainConfig,
    multiDropRank: multiDropRankOf(session.rcBoards?.[0]),
    tripleDropRank: tripleDropRankOf(session.rcBoards?.[0]),
  })
  session.phase = 'endless'
  session.endless = endless
  session.dropGroupsConfig = endless.dropGroupsConfig
  session.dropGroupsById = new Map(endless.dropGroups.map((g) => [g.id, g]))
  session.minDropRank = endless.minDropRank
  if (clean) {
    const first = session.rcBoards[0]
    arriveClean(session, { ...first, tiles: first.tiles.map((row) => row.map(() => 'open')), semiPlacements: [], blockedQueue: [], rewardQueueItems: [], rewardSemiItems: [] }, RC_MAX_RANK)
    session.nextBoardIndex = session.boards.length
  }
  logEvent(session, { type: 'endless-entered', dropStartRank: endless.minDropRank, hasDrops: endless.hasDrops })
}

// TEST AID, Play Tester only (by explicit economist request: "i want somehow
// to be able to toggle in the play tester to jump to the RC and to the
// endless", then: "when we go to the RC, move us to the RC board with a rank
// 12, and when we are going to endless mode we can go with rank 14 to a clean
// board ... only if im using the jump button").
// A jump is a CLEAN arrival, unlike reaching the phase by playing (where
// everything on the board comes along):
//   to Recompletion   a fresh first Recompletion board, holding just a rank 12
//   to endless mode   a clean board (the first Recompletion board's size,
//                     every tile open), holding just a rank 14
// Nothing from the board or the inventory comes along - a first version
// carried the old board's semi-blocked items over, where they sat stuck and
// kept the new board from ever counting as cleared. Collected rewards, the
// energy balance and the Twister balance are kept. The phase's own drops,
// values and generator settings apply exactly as when it is reached by play.
// What is NOT real after a jump is the history - DR spent and the rank table -
// so the session is marked `jumped` and the Play Tester says so.
export function canJumpTo(session, target) {
  if (!session.rcBoards || !session.rcBoards.length) return false
  if (target === 'rc') return session.phase === 'main'
  if (target === 'endless') return session.phase !== 'endless'
  return false
}

// Replaces the board with a fresh `board`, empties the inventory, and puts
// one free item of `rank` on it.
function arriveClean(session, board, rank) {
  const { state } = session
  Object.assign(state, buildInitialState(board))
  session.inventory.length = 0
  const cell = findSpawnCell(state, rank)
  if (cell) {
    state.itemAt[cell[0]][cell[1]] = rank
    state.stuck[cell[0]][cell[1]] = false
  } else {
    session.inventory.push(rank)
  }
}

export function jumpToPhase(session, target) {
  if (!canJumpTo(session, target)) return session
  const recordRank = makeRecordRank(session)
  session.jumped = true
  logEvent(session, { type: 'jump', to: target })
  if (session.phase === 'main') {
    recordRank(MAX_RANK)
    maybeEnterRc(session, { clean: true })
  }
  if (target === 'endless' && session.phase === 'rc') {
    recordRank(RC_MAX_RANK)
    maybeEnterEndless(session, { clean: true })
  }
  return session
}

// --- Twister widget (economy preview) ----------------------------------
// Earned is cumulative and only ever grows; the balance is what's left after
// spins. A spin deducts its exact cost once and counts one spin - it has no
// outcome here: no spin-prize table, completion prize or widget length is
// specified, so none is simulated.
// Whether the Twister widget has anything to show for this session: a spin
// cost is configured, Twister DR has been earned or spent, or the stage's
// drop groups (main or RC) can drop Twister at all. A stage with no Twister
// shows no widget.
export function sessionHasTwister(session) {
  if (session.twisterSpinCost != null || (session.collected?.[TWISTER_TYPE] ?? 0) > 0 || (session.spinsUsed ?? 0) > 0) return true
  const dropsTwister = (group) => group?.items?.[TWISTER_TYPE] != null
  if (session.dropGroupsById && [...session.dropGroupsById.values()].some(dropsTwister)) return true
  return (session.rcBoards?.[0]?.dropGroups ?? []).some(dropsTwister) || session.rcBoards?.[0]?.twisterSpinCost != null
}

export function twisterEarned(session) {
  return session.collected?.[TWISTER_TYPE] ?? 0
}

export function twisterBalance(session) {
  return twisterEarned(session) - (session.twisterSpent ?? 0)
}

export function canSpinTwister(session) {
  const cost = session.twisterSpinCost
  return Number.isFinite(cost) && cost > 0 && twisterBalance(session) >= cost
}

export function spinTwister(session) {
  if (!canSpinTwister(session)) return session
  const cost = session.twisterSpinCost
  session.twisterSpent += cost
  session.spinsUsed += 1
  logEvent(session, { type: 'twister-spin', cost, spinsUsed: session.spinsUsed, balance: twisterBalance(session) })
  return session
}

// The session's current main-chain DR progress in its current phase - the
// same measure the analysis checkpoints use (mergeSimulation.js).
export function sessionProgress(session) {
  const goalReached = session.reachedAt[phaseGoalRank(session.phase)] !== undefined
  return mainChainProgress(session.state, session.inventory, session.phase, goalReached)
}

export function secondGrandPrizeAwarded(session) {
  return session.reachedAt[RC_MAX_RANK] !== undefined
}

export function canSpendGenerator(session) {
  const { state } = session
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (state.itemAt[r][c] == null && !state.locked[r][c]) return true
    }
  }
  return false
}

// The highest generator tier currently unlocked - the same dynamic
// (non-ratchet) gating the automatic simulator uses, re-evaluated off the
// player's CURRENT max rank held every time this is called.
export function currentGeneratorTier(session) {
  return currentTier(currentMaxRank(session.state), session.tiers)
}

// All tiers unlocked at the player's current max rank held, ascending by
// cost - unlike currentGeneratorTier (which mirrors the automatic
// simulator's "always spend at the highest unlocked tier" greed), this is
// for the interactive tool, where the player can choose ANY unlocked tier,
// not just the highest one.
export function unlockedGeneratorTiers(session) {
  return unlockedTiers(currentMaxRank(session.state), session.tiers)
}

// Spends `tier`'s DR cost and drops an item of its rank (plus a possible
// lucky-drop bonus - see the file header comment), placed using the same
// findSpawnCell heuristic the automatic simulator uses - the player doesn't
// choose where it lands, only which unlocked tier to spend at. Defaults to
// the highest unlocked tier (matching the automatic simulator's behavior)
// when the caller doesn't specify one. The logged 'spend' event's `bonus`
// field is 0 for a normal drop - callers (PlayTester's celebration trigger)
// check `bonus > 0` rather than a separate event type.
export function spendGenerator(session, tier = currentGeneratorTier(session)) {
  if (!canSpendGenerator(session)) return session
  const { state } = session
  session.drSpent += tier.cost

  // Same threshold as the x2 tier's own configured unlock rank - see
  // mergeSimulation.js's simulatePlaythrough for the identical rule on the
  // automatic side.
  const maxRankHeld = currentMaxRank(state)
  const bonus = maxRankHeld >= session.tier2UnlockRank ? rollBonus(computeProbs(session.targetEv)) : 0
  const rank = tier.normalRank + bonus

  const cell = findSpawnCell(state, rank)
  state.itemAt[cell[0]][cell[1]] = rank
  logEvent(session, { type: 'spend', tier: tier.cost, cell, rank, bonus })
  makeRecordRank(session)(rank)
  return session
}

// V2 (section 7): "1 merge energy funds 1 generator action at multiplier
// x1." Unlike the automatic simulator (which always greedily spends energy
// the instant it's available - see mergeSimulation.js's main loop), the
// interactive session exposes this as an explicit player action rather than
// silently auto-spending collected energy out from under them - matching
// this file's existing "the player can choose ANY unlocked tier" player-
// agency precedent for spendGenerator itself.
export function canSpendEnergy(session) {
  return (session.energyBalance ?? 0) >= 1 && canSpendGenerator(session)
}

export function spendEnergyForAction(session) {
  if (!canSpendEnergy(session)) return session
  const { state } = session
  session.energyBalance -= 1
  const x1Tier = session.tiers[0]
  const maxRankHeld = currentMaxRank(state)
  const bonus = maxRankHeld >= session.tier2UnlockRank ? rollBonus(computeProbs(session.targetEv)) : 0
  const rank = x1Tier.normalRank + bonus
  const cell = findSpawnCell(state, rank)
  state.itemAt[cell[0]][cell[1]] = rank
  logEvent(session, { type: 'energy-spend', cell, rank })
  makeRecordRank(session)(rank)
  return session
}

function isMovable(state, r, c) {
  return state.itemAt[r][c] != null && !state.stuck[r][c]
}

// What clicking `to` after selecting `from` would do - 'move' (relocate to
// an empty cell, however far, via reachability - a piece can't be dragged
// through occupied tiles, so this still requires a connected path of open
// space) or 'merge' (combine into a same-rank item, stuck or not, anywhere
// on the board - position isn't a legality constraint for merging, matching
// the automatic simulator), or null (not legal). The UI uses this both to
// dispatch on click and to highlight legal targets for the current
// selection.
export function actionFor(session, from, to) {
  const { state } = session
  const [fr, fc] = from
  const [tr, tc] = to
  if (fr === tr && fc === tc) return null
  if (!isMovable(state, fr, fc)) return null
  if (!inBounds(state, tr, tc) || state.locked[tr][tc]) return null

  const targetItem = state.itemAt[tr][tc]
  if (targetItem == null) {
    return buildReachability(state).sameComponent(fr, fc, tr, tc) ? 'move' : null
  }
  // Rank 14 is the top of the chain: there is no rank 15, so two rank 14s
  // (possible in endless mode) stay as they are.
  if (isMainItem(targetItem) && targetItem >= RC_MAX_RANK) return null
  return targetItem === state.itemAt[fr][fc] ? 'merge' : null
}

export function moveItem(session, from, to) {
  const { state } = session
  state.itemAt[to[0]][to[1]] = state.itemAt[from[0]][from[1]]
  state.itemAt[from[0]][from[1]] = null
  logEvent(session, { type: 'moved', from, to })
  return session
}

export function mergeItems(session, from, to) {
  const { state } = session
  const rank = state.itemAt[from[0]][from[1]]
  const recordRank = makeRecordRank(session)
  // Never reveal around the mover's original cell here, even when it's
  // directly adjacent to the receiver - see performMerge's comment. The
  // player watched the merge happen at `to`; a tile popping open next to
  // wherever the item used to sit, rather than next to where it ended up,
  // doesn't read as connected to the merge they were watching.
  performMerge(state, { mover: from, receiver: to, rank }, recordRank, (e) => logEvent(session, e), performMergeOptionsFor(session))
  // A merge is the only action that can clear the board's last locked/stuck
  // cell (moving/spending/inventory-placing only ever add or reposition
  // free items), so this is the only place a wave needs to be checked for -
  // also the only place the RC (V2) phase transition can fire, for the same
  // reason.
  session.nextBoardIndex = advanceBoards(state, session.boards, session.nextBoardIndex, session.inventory, (waveBoard, rows, overflow) =>
    logEvent(session, { type: 'board-push', name: waveBoard.name, rows, overflow }),
  )
  recordAllOccupied(state, recordRank)
  maybeEnterRc(session)
  maybeEnterEndless(session)
  return session
}

// Manual collection (V2) - removes a free (or still-stuck) reward item and
// credits its prize, without requiring a merge. See mergeSimulation.js's
// collectReward for why stuck is allowed here.
// A reward item that is still semi-blocked (revealed, not yet merged into)
// cannot be collected - collectReward leaves it where it is.
export function collectRewardItem(session, cell) {
  collectReward(session.state, cell, makeOnCollect(session))
  return session
}

export function canPlaceFromInventory(session, index) {
  return index >= 0 && index < session.inventory.length && canSpendGenerator(session)
}

// Places inventory item `index` onto a free cell, picked the same way the
// generator picks a spend's landing spot (findSpawnCell) - a click just
// drops it, same one-step feel as everything else that puts an item on the
// board. No-op (session unchanged) if the index is invalid or the board has
// no free cell at all.
export function placeFromInventory(session, index) {
  if (!canPlaceFromInventory(session, index)) return session
  const { state } = session
  const [rank] = session.inventory.splice(index, 1)
  const cell = findSpawnCell(state, rank)
  state.itemAt[cell[0]][cell[1]] = rank
  logEvent(session, { type: 'inventory-place', cell, rank })
  makeRecordRank(session)(rank)
  return session
}

// Runs the automatic simulator on this session's exact board chain, capped
// at the DR the player has spent so far, so the UI can show "the simulator
// thinks a typical playthrough would be at rank N by now" right next to what
// the player actually achieved by hand.
//
// `revealAroundMover: false` - a real, found-live fix, not cosmetic. This
// used to call simulatePlaythrough with its own default (revealAroundMover:
// true - see mergeSimulation.js), silently comparing the player's manual
// session against a DIFFERENT ruleset than the one they were actually
// playing under: every merge in THIS session (mergeItems, above) only ever
// reveals a locked tile adjacent to the RECEIVER, never the mover's old
// cell (by design - see mergeItems' own comment). The automatic simulator's
// default reveals around BOTH cells a merge touched. So "compare to
// automatic simulator" was answering "how does your play compare to a
// hypothetical run that gets extra reveals your own merges never could,"
// not "how does your play compare to what the SAME reveal rules would
// achieve" - a genuine apples-to-oranges comparison that could make an
// economist's careful, correct manual play look like it under-performed the
// simulator for no real reason of their own doing. Passing
// revealAroundMover: false here makes the comparison run under the exact
// same reveal mechanics session's own merges do, so any remaining gap is
// real (decision order, tier choice, tapping speed) rather than an
// artifact of comparing two different rulesets. Confirmed live: with this
// fix, replaying a session's own exact sequence of spends/merges through
// this comparison (same board, same choices) lines up with what the
// session itself recorded - see effortTargeting.js/mergeSimulation.js's
// own notes on this for the side-by-side numbers that found it.
export function compareToSimulator(session) {
  return simulatePlaythrough(session.boards, {
    startIndex: session.boardIndex,
    drBudget: session.drSpent,
    revealAroundMover: false,
    rewardChainConfig: session.rewardChainConfig ?? undefined,
    dropGroupsConfig: session.dropGroupsConfig ?? undefined,
    dropGroupsById: session.dropGroupsById ?? undefined,
    rcBoards: session.phase === 'main' ? session.rcBoards ?? undefined : undefined,
    minDropRank: session.minDropRank ?? undefined,
    leftoverPolicy: session.leftoverPolicy,
  })
}
