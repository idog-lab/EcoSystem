import { MAX_RANK, RC_MAX_RANK, valueOf } from '../core/ranks'
import { currentTier, unlockedTiers, buildGeneratorTiers, DEFAULT_TIER2_UNLOCK_RANK, DEFAULT_TIER4_UNLOCK_RANK } from '../core/generatorTier'
import { DEFAULT_TARGET_EV, computeProbs, createEvScheduler, rollBonus } from '../core/luckyDrop'
import { isMainItem, decodeReward, encodeReward, REWARD_MAX_RANK, rewardPrizeAmount, rewardChainForNextPhase, emptyRewardTally, TWISTER_TYPE, tapPaysAtLeastAsMuch, DEFAULT_LEFTOVER_POLICY } from '../rewards/rewardChain'
import { rollDrop, createDropScheduler, MIN_DROP_RANK } from '../rewards/dropGroups'

// 4-directional only — up/down/left/right, no diagonals.
export const DELTAS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]

// --- Reward source attribution (V2) -----------------------------------
// Tile-placed and merge-dropped reward items merge with each other freely,
// so one collected prize can be built from both sources at once. The ONE
// attribution method used everywhere (simulator, play sessions, solver,
// review table): a well-mixed pool per resource, measured in rank-1 "source
// units" (a rank-r item is 2^(r-1) units - what it took to build). Every
// reward item entering play adds its units to its source's side of the
// pool; every collect splits its prize by the pool's composition at that
// moment and removes the collected units pro rata. Tile + drop therefore
// always sum to the total collected, exactly, by construction.
export function rewardUnits(rank) {
  return 2 ** (rank - 1)
}

function emptyRewardPool() {
  return { tile: emptyRewardTally(), drop: emptyRewardTally() }
}

// --- Main-chain DR progression -----------------------------------------
// ONE measure of "how far through this phase's main chain the player is",
// used everywhere a progression checkpoint is evaluated (the automatic
// simulator, play sessions, the Twister income analysis):
//
//   progress = main-chain DR value in play / DR value of the phase's goal item
//
// "In play" is every main-chain item the player can see and act on: free
// items, revealed-but-not-yet-merged subsidy items (semi tiles on boards
// that have come into play, and blocked-tile items once revealed), and main
// items waiting in the inventory. Value is valueOf(rank) = 2^(rank-1).
//   - Revealed subsidy counts from the moment it is revealed, the same
//     moment the simulator's own subsidyDelivered counts it.
//   - Value still behind a locked tile is NOT counted - it is inaccessible,
//     and may never be revealed at all.
//   - Merging never changes it: two rank-r items (2 x 2^(r-1)) become one
//     rank-(r+1) item (2^r). Nothing is double-counted and nothing is lost.
//   - It only grows inside a phase: generator output and reveals add value,
//     moves/merges/board pushes conserve it (overflow goes to the inventory,
//     which is counted). So it is monotonic.
//   - Small-reward items (Twister included) are excluded entirely.
// It is not elapsed time, board index, merge count or generator spend: a
// segment with more subsidy reaches the same progress on less spend.
//
// The goal item is rank 12 (2048 DR) in the main phase. In the RC phase the
// engine starts on a FRESH RC board - the first completion's rank-12 item is
// not carried over (see the RC transition below) - so RC progress is measured
// from that fresh state against the full value of rank 14 (8192 DR), and
// starts at whatever the RC board's own semi tiles are worth, not at 25%.
// Capped at 1; a phase whose goal rank has been reached reports exactly 1.
export function mainChainValueInPlay(state, inventory = []) {
  let value = 0
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const item = state.itemAt[r][c]
      if (item != null && !state.locked[r][c] && isMainItem(item)) value += valueOf(item)
    }
  }
  for (const item of inventory) if (isMainItem(item)) value += valueOf(item)
  return value
}

// --- Recompletion starts at rank 12 ------------------------------------------
// By explicit economist rule ("when we get to rank 12, the RC is triggered and
// the chase starts to rank 14 ... a total of DR value of 2^(14-1) when we got
// already a rank 12, and new boards with blocked tiles"; what comes along was
// asked and confirmed as "everything on the board"):
//   - Recompletion begins the moment rank 12 is reached. It does not wait for
//     the normal boards to be cleared; whatever is still under their tiles is
//     left behind.
//   - NOTHING THE PLAYER CAN SEE IS LOST. Everything on the board comes
//     along to the first RC board: the rank 12, every other main-chain item,
//     and every small-reward item - the ones still semi-blocked too, which
//     stay semi-blocked. A semi-blocked REWARD item that came along does not
//     hold a Recompletion board back, though (`state.passive`): a board
//     waits for its OWN semi-blocked rewards, and Recompletion has its own
//     merge drops, which may never drop the match for a reward of the normal
//     event - its first board would then wait for ever. (This app's own
//     choice.) (A first version brought only the free main-chain
//     items; the economist entered Recompletion and found "all the small
//     rewards and some of the ranks" gone.) Only what is still hidden under an
//     unopened tile of the normal boards is left behind. Reward items are
//     therefore NOT settled at the hand-over any more - only when the whole
//     run ends.
//   - The chase is to rank 14: 8,192 DR, of which the rank 12 already counts
//     for 2,048.
// The one implementation, used by the simulator and by the play session.
// `state` is replaced in place by the first RC board. Items are put on its
// open cells - the rank 12 first, then free items, then semi-blocked ones -
// and anything that does not fit waits in `inventory`. The record of where
// each reward item came from (the pool behind tile/drop attribution) is kept.
export function enterRecompletion(state, rcBoard0, inventory) {
  const carried = []
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const item = state.itemAt[r][c]
      if (item != null && !state.locked[r][c]) carried.push({ item, stuck: !!state.stuck[r][c] })
    }
  }
  const order = (x) => (x.stuck ? 2 : 0) + (isMainItem(x.item) ? 0 : 1)
  carried.sort((x, y) => order(x) - order(y) || (isMainItem(x.item) && isMainItem(y.item) ? y.item - x.item : 0))
  const rewardPool = state.rewardPool
  Object.assign(state, buildInitialState(rcBoard0))
  if (rewardPool) state.rewardPool = rewardPool
  for (const { item, stuck } of carried) {
    const cell = findSpawnCell(state, item)
    if (cell) {
      state.itemAt[cell[0]][cell[1]] = item
      state.stuck[cell[0]][cell[1]] = stuck
      if (stuck && !isMainItem(item)) state.passive[cell[0]][cell[1]] = true
    } else if (inventory) {
      inventory.push(item)
    }
  }
  return carried.map((x) => x.item)
}

// What the Recompletion chase still has to cover when it starts: rank 14's
// value less the rank 12 the player arrives with.
export const RC_CHASE_DR = valueOf(RC_MAX_RANK) - valueOf(MAX_RANK)

// Endless mode (play sessions only - it starts once rank 14 is held) has no
// goal of its own; it reports the Recompletion goal, already reached.
export function phaseGoalRank(phase) {
  return phase === 'rc' || phase === 'endless' ? RC_MAX_RANK : MAX_RANK
}

export function mainChainProgress(state, inventory, phase, goalReached = false) {
  if (goalReached) return 1
  return Math.min(1, mainChainValueInPlay(state, inventory) / valueOf(phaseGoalRank(phase)))
}

// Twister items currently sitting unmerged on the board or in the inventory:
// how many, and what they would pay if each were hand-collected at its own
// rank right now. An observation only - nothing is collected.
export function uncollectedRewardItems(state, inventory, type, rewardChainConfig) {
  let items = 0
  let value = 0
  for (const item of leftoverRewardItems(state, inventory)) {
    if (item.type !== type) continue
    items += 1
    value += rewardChainConfig ? rewardPrizeAmount(rewardChainConfig, type, item.rank) : 0
  }
  return { items, value }
}

export function addToRewardPool(state, source, value) {
  const info = decodeReward(value)
  if (!info || !state.rewardPool) return
  state.rewardPool[source][info.type] += rewardUnits(info.rank)
}

// Credits one collected reward item through `onCollect(type, rank,
// tileShare)`, where tileShare (0-1) is the fraction of this prize
// attributed to tile-placed items.
function creditCollect(state, type, rank, onCollect) {
  const pool = state.rewardPool
  let tileShare = 1
  if (pool) {
    const tile = pool.tile[type]
    const drop = pool.drop[type]
    const total = tile + drop
    tileShare = total > 0 ? tile / total : 1
    const units = Math.min(rewardUnits(rank), total)
    pool.tile[type] = Math.max(0, tile - units * tileShare)
    pool.drop[type] = Math.max(0, drop - units * (1 - tileShare))
  }
  onCollect?.(type, rank, tileShare)
}

export function buildInitialState(board) {
  const { rows, cols, tiles, semiPlacements, blockedQueue } = board
  const itemAt = Array.from({ length: rows }, () => Array(cols).fill(null))
  // stuck: true for a subsidy item (semi tile from the start, or a blocked
  // tile the moment it's revealed) that hasn't yet received its one
  // qualifying merge. A stuck item can be merged INTO but can't itself be
  // the mover — a merge only happens when a same-rank item currently
  // sitting on an ordinary open tile (something the generator placed,
  // directly or by a few hops of open-open merges), or an already-cleared
  // former-subsidy item, reaches it. Once that merge happens the receiver
  // clears (stuck goes false) and becomes a completely normal item from
  // then on — "revealed but needs one more merge to fully clear" per the
  // domain spec, which applies the same way whether the tile started semi
  // or blocked. Two still-stuck items never merge with each other on their
  // own — that would be a free chain reaction with no player action (DR
  // spend) behind it anywhere in its history.
  const stuck = Array.from({ length: rows }, () => Array(cols).fill(false))
  // locked: true for a blocked tile with no item, not yet revealed.
  const locked = Array.from({ length: rows }, () => Array(cols).fill(false))

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (tiles[r][c] === 'blocked') locked[r][c] = true
    }
  }
  for (const p of semiPlacements) {
    itemAt[p.row][p.col] = p.rank
    // V2: a reward item (coins/puzzles/energy/charms) never starts stuck -
    // see revealNeighbors' own comment for why the main-chain "needs one
    // qualifying merge first" anti-cascade rule doesn't apply to a
    // separate, non-subsidy currency.
    stuck[p.row][p.col] = true // reward items too - see revealNeighbors
  }

  // passive: a semi-blocked reward item carried over from the phase before,
  // which no board waits for (see enterRecompletion). It moves with its item
  // when rows are pushed in.
  const passive = Array.from({ length: rows }, () => Array(cols).fill(false))
  const state = { rows, cols, itemAt, stuck, locked, passive, blockedQueue: [...blockedQueue], blockedQueueIndex: 0, rewardPool: emptyRewardPool() }
  // A reward item on a semi tile is in play from the first moment.
  for (const p of semiPlacements) addToRewardPool(state, 'tile', p.rank)
  return state
}

export function inBounds(state, r, c) {
  return r >= 0 && r < state.rows && c >= 0 && c < state.cols
}

// (A move used to need a path of empty cells - buildReachability, a
// union-find over the board. The economist asked for an item to move to any
// empty, open cell, however it is surrounded; playSession.js: actionFor.)

// Two same-rank items merge regardless of where they sit on the board - a
// player can always bring one to the other eventually, so position isn't a
// legality constraint (buildReachability's connected-open-space graph is
// still used separately for the interactive play tester's "move to an
// empty cell" check, just not for merge legality).
//
// Two passes: an open-open pair (neither side stuck) anywhere on the board
// first, a stuck-involving pair only if no open-open pair exists at all.
// This isn't required for correctness (a stuck item can be legally cleared
// any time a matching mover reaches it) but keeps freshly-built items
// flexible for as long as possible rather than committing them to whichever
// stuck item is found first.
//
// A THIRD, higher-priority pass runs before either of those - see
// scanForStrandRiskMerge's own comment for why: the two-pass "prefer any
// free-free merge anywhere on the board" priority has a real, found-live
// failure mode where it can PERMANENTLY strand a stuck item (most often a
// high-rank semi tile) with no possible future recovery, not just delay
// clearing it - reported live from a report that a segment with a rank-11
// forced semi tile kept delivering far less subsidy than configured, traced
// down to exactly this mechanism (see the "Board chaining" section of
// CLAUDE.md for the full writeup and a hand-verified proof of the bug).
function findLegalMerge(state) {
  return scanForStrandRiskMerge(state) ?? scanForMerge(state, true) ?? scanForMerge(state, false)
}

// A same-rank bucket holding at least one STUCK item and at least TWO free
// items is a stranding risk: the two free items could merge with EACH
// OTHER (an ordinary, higher-priority free-free merge under the old
// two-pass logic) instead of either of them ever merging into the stuck
// one - and once that happens, the stuck item has ZERO remaining same-rank
// partners left anywhere on the board. Unlike an ordinary "not yet cleared"
// stuck item (which can always still be reached by SOME future mover), this
// specific situation can be a genuine dead end: at a high rank especially
// (rank 11, say), the only realistic way another free item of that exact
// rank ever forms again is a whole fresh doubling chain built from scratch,
// which a run that's already near completion (or has moved on to needing
// rank 12 specifically) may simply never do again before it stops.
//
// Resolving this the MOMENT it's detected costs nothing: both merges are
// free actions regardless of order (no DR difference), and any free-free
// merge this pass defers is still exactly as available on the very next
// scan - nothing about a low-rank pair "expires" by waiting one more step.
// So always preferring to clear a same-rank stuck item here is a strict
// improvement, never a tradeoff. Scoped deliberately narrow (same rank
// bucket only, and only when a same-rank free-free ALTERNATIVE genuinely
// exists) - it doesn't otherwise change this function's "prefer flexibility
// across different ranks" priority for the ordinary case where deferring a
// stuck cell carries no such risk.
//
// Hand-verified: given one stuck rank-3 item and two free rank-3 items (the
// exact minimal shape that triggers this), the OLD priority always merged
// the two free items together, leaving the stuck one permanently
// unreachable on that board. This pass returns the free-into-stuck merge
// for that same case instead.
function scanForStrandRiskMerge(state) {
  const byRank = new Map()
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const rank = state.itemAt[r][c]
      if (rank == null) continue
      if (!byRank.has(rank)) byRank.set(rank, { free: [], stuck: [] })
      byRank.get(rank)[state.stuck[r][c] ? 'stuck' : 'free'].push([r, c])
    }
  }
  for (const [rank, { free, stuck }] of byRank.entries()) {
    if (stuck.length >= 1 && free.length >= 2) {
      return { mover: free[0], receiver: stuck[0], rank }
    }
  }
  return null
}

function scanForMerge(state, requireBothFree) {
  // Group all occupied cells by rank, row-major scan order, so the result
  // is deterministic.
  const byRank = new Map()
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const rank = state.itemAt[r][c]
      if (rank == null) continue
      if (!byRank.has(rank)) byRank.set(rank, [])
      byRank.get(rank).push([r, c])
    }
  }

  for (const cells of byRank.values()) {
    if (cells.length < 2) continue
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const [ar, ac] = cells[i]
        const [br, bc] = cells[j]
        const rank = state.itemAt[ar][ac]
        const hereMovable = !state.stuck[ar][ac]
        const thereMovable = !state.stuck[br][bc]
        if (requireBothFree && !(hereMovable && thereMovable)) continue
        if (hereMovable) return { mover: [ar, ac], receiver: [br, bc], rank }
        if (thereMovable) return { mover: [br, bc], receiver: [ar, ac], rank }
      }
    }
  }
  return null
}

// WHERE A MERGE HAPPENS. A merge opens the locked tiles next to the cell it
// happens in (the receiver's), and a free item can be moved to any empty open
// cell first - so a player who wants the tiles open merges NEXT TO them. The
// careful simulated player does: when both items are free, the merge happens
// at whichever of the two already has a locked tile beside it, else the
// receiver is first moved to an empty cell that has one. (A semi-blocked
// receiver stays where it is.) Without this the simulator merged wherever its
// scan found the pair, and with tiles opening only at the receiver a design
// with no merge drops and reward items under its tiles handed out a third of
// its subsidy. Returns the merge to perform and, when an item has to be moved
// first, `relocate: { from, to }` - nothing is changed here, so the robot on
// the play engine can make the same two moves (playRobot.mjs).
const hasLockedNeighbour = (state, [r, c]) => DELTAS.some(([dr, dc]) => inBounds(state, r + dr, c + dc) && state.locked[r + dr][c + dc])
export function mergeWhereItOpens(state, merge) {
  const { mover, receiver } = merge
  if (state.stuck[receiver[0]][receiver[1]] || state.stuck[mover[0]][mover[1]]) return { merge, relocate: null }
  if (state.blockedQueueIndex >= state.blockedQueue.length) return { merge, relocate: null } // nothing left under the tiles
  if (hasLockedNeighbour(state, receiver)) return { merge, relocate: null }
  if (hasLockedNeighbour(state, mover)) return { merge: { ...merge, mover: receiver, receiver: mover }, relocate: null }
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (state.itemAt[r][c] != null || state.locked[r][c] || !hasLockedNeighbour(state, [r, c])) continue
      return { merge: { ...merge, receiver: [r, c] }, relocate: { from: receiver, to: [r, c] } }
    }
  }
  return { merge, relocate: null }
}

// The merge the careful simulated player makes next, and where (null: none).
export function nextCarefulMerge(state) {
  const found = findLegalMerge(state)
  return found ? mergeWhereItOpens(state, found) : null
}

// A PLAYER WHO MERGES WITHOUT LOOKING (`options.mergeRng`). The simulated
// player merges carefully: when a free item could go either into a
// semi-blocked item of its rank or into another free one, it opens the
// semi-blocked one. A real player does not always - and an item left
// semi-blocked when rank 12 is made is subsidy that was never used, paid for
// in DR instead. For each kind of item on the board this player has the same
// two choices (free into free, free into semi-blocked) and picks any of them
// at random. Found with the robot on the play engine: in a segment that lives
// mostly on its subsidy such a player spent 30-40% more DR and collected
// about 10% more rewards than the careful one.
function pickCarelessMerge(state, rng) {
  const byValue = new Map()
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const v = state.itemAt[r][c]
      if (v == null || state.locked[r][c]) continue
      if (!byValue.has(v)) byValue.set(v, { free: [], stuck: [] })
      byValue.get(v)[state.stuck[r][c] ? 'stuck' : 'free'].push([r, c])
    }
  }
  const options = []
  for (const [rank, { free, stuck }] of byValue) {
    if (free.length >= 2) options.push({ mover: free[0], receiver: free[1], rank })
    if (free.length >= 1 && stuck.length >= 1) options.push({ mover: free[0], receiver: stuck[0], rank })
  }
  return options.length > 0 ? options[Math.floor(rng() * options.length)] : null
}

// Every legal merge available right now (not just the first one found) -
// used only by onboardingGoal.js's feasibility search (see pickMergeByStrategy
// below), which needs to consider more than one candidate; findLegalMerge's
// short-circuit-on-first-match is deliberately kept as the fast default path
// for every other caller (this is O(items^2) per call, fine for the small
// isolated reserve boards the goal-solver tests, not something the main
// per-step simulation loop should pay for on a large real board).
function allLegalMerges(state) {
  const byRank = new Map()
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const rank = state.itemAt[r][c]
      if (rank == null) continue
      if (!byRank.has(rank)) byRank.set(rank, [])
      byRank.get(rank).push([r, c])
    }
  }

  const merges = []
  for (const cells of byRank.values()) {
    if (cells.length < 2) continue
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const [ar, ac] = cells[i]
        const [br, bc] = cells[j]
        const rank = state.itemAt[ar][ac]
        const hereMovable = !state.stuck[ar][ac]
        const thereMovable = !state.stuck[br][bc]
        if (hereMovable) merges.push({ mover: [ar, ac], receiver: [br, bc], rank, clearsStuck: state.stuck[br][bc] })
        else if (thereMovable) merges.push({ mover: [br, bc], receiver: [ar, ac], rank, clearsStuck: state.stuck[ar][ac] })
      }
    }
  }
  return merges
}

// Alternate merge-priority orderings for onboardingGoal.js's feasibility
// search - found live: testing feasibility with only the default
// find-first-free-free-pair order (findLegalMerge's own priority, tuned for
// the main gameplay simulator's "keep freshly-built items flexible as long
// as possible" goal) can under-report what a smart player could actually
// achieve. A one-shot "reach this specific rank ASAP" goal wants the
// opposite bias in some board shapes - clearing stuck reserve items
// immediately, or racing the highest rank up first - so the feasibility
// check tries several orderings and accepts the goal as reachable if ANY of
// them gets there, instead of just the one the main simulator happens to
// use. 'free-free-first' reproduces findLegalMerge's own priority exactly
// (same order: first free-free pair found, else first free-into-stuck pair
// found), so passing it changes nothing about what "the default order"
// means - it's just expressed through the same all-candidates path as the
// other strategies for a uniform interface.
export function pickMergeByStrategy(state, strategy) {
  const merges = allLegalMerges(state)
  if (merges.length === 0) return null
  if (strategy === 'clear-stuck-first') {
    return [...merges].sort((a, b) => Number(b.clearsStuck) - Number(a.clearsStuck) || b.rank - a.rank)[0]
  }
  if (strategy === 'highest-rank-first') {
    return [...merges].sort((a, b) => b.rank - a.rank)[0]
  }
  // 'free-free-first' (default): identical priority to findLegalMerge,
  // stranding-risk pass included - see scanForStrandRiskMerge's own comment.
  // Sharing that one function rather than re-deriving the same check here
  // is what keeps this genuinely "identical," not just similarly-worded.
  return scanForStrandRiskMerge(state) ?? merges.find((m) => !m.clearsStuck) ?? merges[0]
}

export function revealNeighbors(state, [r, c], recordRank, log) {
  for (const [dr, dc] of DELTAS) {
    const nr = r + dr
    const nc = c + dc
    if (!inBounds(state, nr, nc) || !state.locked[nr][nc]) continue
    if (state.blockedQueueIndex >= state.blockedQueue.length) continue
    const revealedRank = state.blockedQueue[state.blockedQueueIndex++]
    state.itemAt[nr][nc] = revealedRank
    state.locked[nr][nc] = false
    // Revealed but not yet cleared — see buildInitialState's comment on
    // `stuck`. Without this, a freshly-revealed blocked item was
    // immediately free to merge with ANY other same-rank item (including
    // another freshly-revealed one) with no player action behind it at
    // all, which is exactly how a single spend could cascade through an
    // entire board of blocked tiles for free.
    //
    // V2: a reward item is the ONE exception - this whole anti-cascade rule
    // exists to stop main-chain SUBSIDY value from free-flowing with no DR
    // spend behind it; a reward item (coins/puzzles/energy/charms) isn't
    // subsidy at all (separate accounting - see rewardChain.js), so there's
    // no economic reason to gate it the same way. Without this exception, a
    // tile-placed reward item could never be used at all: nothing ever
    // spawns a FREE reward item to merge into it (the generator only
    // produces main-chain items), so two still-stuck reward items of the
    // same type/rank could never merge with each other OR with anything
    // else - a real bug, found live via this file's own verification
    // script, where a board with two pinned rank-3 energy items in its
    // blocked queue reported energySpent === 0 no matter how long the run
    // went. "Once accessible [revealed], its reward can be collected or
    // merged" (the domain spec) reads as immediately usable either way, not
    // "needs one more merge first."
    // EVERY item is semi-blocked when its tile opens - reward items included
    // (by explicit economist rule: "the small rewards in the tiles are also
    // supposed to be first semi blocked"). It sits there until a free item of
    // the same kind and rank is merged into it; until then it cannot be
    // moved, merged away or collected. (It used to be free straight away.)
    // In a run with no merge drops at all nothing could ever open a
    // semi-blocked reward item: it would sit on its cell for the whole run,
    // and a design with many of them under its tiles fills the board with
    // items that cannot move, merge or be given up - the simulated player
    // runs out of room and the subsidy behind them is never reached (seen by
    // the economist as "N DR of subsidy would never reach the player" in the
    // effort distribution, which plays the main chain alone). In such a run a
    // reward item arrives free instead, so it can be cleared away for space.
    state.stuck[nr][nc] = state.rewardsCanOpen === false && !isMainItem(state.itemAt[nr][nc]) ? false : true
    addToRewardPool(state, 'tile', revealedRank)
    log?.({ type: 'reveal', cell: [nr, nc], rank: revealedRank, queuePosition: state.blockedQueueIndex })
    // Deliberately NOT recordRank(revealedRank) here - a revealed item is
    // still `stuck` (see the line above), and "reached rank N" means the
    // player actually HOLDS a free item at rank N, not merely sees one
    // sitting semi/blocked-revealed on the board. It'll get recorded later,
    // for real, whenever some free mover actually merges into it (at which
    // point it clears and becomes newRank = revealedRank + 1 - so this
    // specific rank may never separately register as "reached" at all if
    // nothing else on the board independently gets there some other way,
    // which is the correct outcome: the player never held a free item at
    // exactly this rank, only one at rank+1 once they finally cleared it).
  }
}

// Reward-chain merges (V2): two same-type-same-rank reward items (coins/
// puzzles/energy/charms - rewardChain.js's disjoint encoding means
// merge.rank here can be a reward-encoded value, and the existing
// scanForMerge/scanForStrandRiskMerge bucket-by-raw-value logic already
// treats it as its own homogeneous group, same as any main rank) merge
// exactly like main-chain items UNTIL the result would exceed
// REWARD_MAX_RANK (4) - at that point the item doesn't get placed at all;
// it's immediately auto-collected (credited to the player's balance via
// `onCollect`, never left sitting on the board at an invalid rank 5).
// Manual collection below rank 4 is a separate action - see collectReward.
//
// Only a MAIN-chain merge can trigger a merge-drop group roll ("reward
// drops only ever come from main-chain merges, never from reward-chain
// merges" - rewarding a reward-chain merge with another drop would let
// drops compound on themselves with no main-chain progress behind them).
export function performMerge(
  state,
  merge,
  recordRank,
  log,
  {
    revealAroundMover = false,
    onCollect,
    dropGroupsConfig,
    dropGroupsById,
    dropRng,
    dropMode = 'stochastic',
    // dropMode 'expected' needs a per-run createDropScheduler() instance -
    // without one it falls back to a plain stochastic roll.
    dropScheduler = null,
    // Where a dropped item goes when the board has no free cell. Both
    // engines pass their own inventory array; with none, the item is
    // collected on the spot at its own rank instead of being lost.
    inventory = null,
    recordMergeCount,
    minDropRank: minDropRankOpt,
  } = {},
) {
  const [mr, mc] = merge.mover
  const [rr, rc] = merge.receiver
  const wasStuck = state.stuck[rr][rc]
  const rewardInfo = decodeReward(merge.rank)

  let newRank = null // null = fully collected, nothing placed on the board
  if (rewardInfo) {
    const resultRank = rewardInfo.rank + 1
    if (resultRank >= REWARD_MAX_RANK) {
      // Two rank-(MAX-1) items merging reach rank MAX exactly, which never
      // sits on the board - "rank 4 auto-collects and awards its configured
      // prize" the instant it forms.
      creditCollect(state, rewardInfo.type, REWARD_MAX_RANK, onCollect)
      log?.({ type: 'reward-auto-collect', cell: [rr, rc], rewardType: rewardInfo.type, rank: REWARD_MAX_RANK })
    } else {
      newRank = encodeReward(rewardInfo.type, resultRank)
    }
  } else {
    newRank = merge.rank + 1
  }

  state.itemAt[rr][rc] = newRank
  state.itemAt[mr][mc] = null
  if (newRank == null) state.stuck[rr][rc] = false
  else if (wasStuck) state.stuck[rr][rc] = false // fully cleared — a normal item from here on

  log?.({ type: 'merge', from: [mr, mc], into: [rr, rc], rank: merge.rank, newRank })
  if (isMainItem(merge.rank)) {
    recordRank(newRank)
    // "7 merges of rank 7, 5 of rank 8" - a count of every real merge EVENT
    // that produced this resulting rank (not just the first time, unlike
    // recordRank/reachedAt above), across every main-chain rank regardless
    // of the drop-rank gate below - this is useful calibration context on
    // its own (how the chain naturally plays out), not just an input to the
    // drop-EV math.
    recordMergeCount?.(newRank)
    // Merge-drop groups only roll from minDropRank onward (default 6,
    // configurable per board list via board.minDropRank). A hard engine
    // gate: even a misconfigured table below the threshold can never fire.
    const dropGate = minDropRankOpt ?? MIN_DROP_RANK
    if (newRank >= dropGate && dropGroupsConfig && dropGroupsById) {
      const table = dropGroupsConfig[newRank - 1]
      // 'expected' = the deterministic schedule (dropGroups.js's
      // createDropScheduler) - same tables, same outcomes in proportion to
      // their weights, no randomness - used by the prediction/solver runs.
      // Real play (Play Tester/Play Stage) and the seeded validation use a
      // genuine per-merge roll.
      const drop = dropMode === 'expected' && dropScheduler ? dropScheduler(table, dropGroupsById) : rollDrop(table, dropGroupsById, dropRng)
      if (drop) {
        // The whole group drops together (its resources are correlated by
        // construction - one roll, every item in the group).
        for (const [type, rank] of Object.entries(drop)) {
          const value = encodeReward(type, Math.min(rank, REWARD_MAX_RANK))
          addToRewardPool(state, 'drop', value)
          if (rank >= REWARD_MAX_RANK) {
            // Rank 4 never sits on the board - it pays out immediately.
            creditCollect(state, type, REWARD_MAX_RANK, onCollect)
            log?.({ type: 'merge-drop', cell: null, rewardType: type, rank, collected: true })
            continue
          }
          const cell = findSpawnCell(state, value)
          if (cell) {
            state.itemAt[cell[0]][cell[1]] = value
            state.stuck[cell[0]][cell[1]] = false
            log?.({ type: 'merge-drop', cell, rewardType: type, rank })
          } else if (inventory) {
            inventory.push(value)
            log?.({ type: 'merge-drop', cell: null, rewardType: type, rank, toInventory: true })
          } else {
            creditCollect(state, type, rank, onCollect)
            log?.({ type: 'merge-drop', cell: null, rewardType: type, rank, collected: true })
          }
        }
      }
    }
  }
  // A merge opens the locked tiles next to where it HAPPENS - the receiver's
  // cell. The mover's old cell is not where the player watches the merge, so
  // a tile opening there does not read as part of it (economist report: a
  // one-cell merge opened a tile two rows away). The play screens have always
  // worked this way; the automatic simulator used to open around both cells
  // (`revealAroundMover: true`), which made it a slightly luckier game than
  // the one a player plays - see simulatePlaythrough's note. The option stays
  // for the old numbers.
  if (revealAroundMover) revealNeighbors(state, merge.mover, recordRank, log)
  revealNeighbors(state, merge.receiver, recordRank, log)
}

// Manual collection (V2): removes a FREE reward item sitting on the board
// (any rank 1..REWARD_MAX_RANK-1 - rank 4 never sits on the board at all,
// since performMerge auto-collects the instant it would form) and credits
// its prize. Deliberately allowed on a STILL-STUCK reward item too ("once
// accessible [revealed], its reward can be collected or merged" - collecting
// isn't a move/merge, so it doesn't need the stuck->free transition a merge
// does). Returns the collected {type, rank} or null if this cell doesn't
// hold a collectible reward item at all (empty, locked, or a main-chain
// item).
export function collectReward(state, [r, c], onCollect) {
  const value = state.itemAt[r][c]
  const info = decodeReward(value)
  if (!info || state.stuck[r][c]) return null // nothing there, or still semi-blocked
  state.itemAt[r][c] = null
  creditCollect(state, info.type, info.rank, onCollect)
  return info
}

// The cheapest reward item currently on the board (lowest reward rank, then
// row-major) - what the automatic player gives up first when it has to free
// a cell. Null when the board holds no reward item at all.
export function findLowestRewardCell(state) {
  let best = null
  let bestRank = Infinity
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      // A semi-blocked reward item cannot be collected.
      const info = state.stuck[r][c] ? null : decodeReward(state.itemAt[r][c])
      if (info && info.rank < bestRank) {
        best = [r, c]
        bestRank = info.rank
      }
    }
  }
  return best
}

// HOW A PLAYER TAKES THE SMALL REWARDS (`collectPolicy`). A reward item can
// be merged on towards rank 4 or tapped to collect it as it is, and which of
// the two a player does changes what they end up with - a lot, when the rank
// values do not reward merging (found by playing a shared stage with a robot
// after the economist's "he ended up with crazy rewards": with puzzles at
// 5/15/15/40 a rank-2 item pays 7.5 a unit and a rank 4 only 5, so tapping at
// rank 2 pays half as much again as merging to rank 4).
//   'merge'  the player the build sizes for: merges every reward item on and
//            lets rank 4 collect by itself (taps one only to free a cell).
//   'best'   taps an item as soon as no higher rank pays more per unit - the
//            most a player can make of the same drops. With rank values that
//            reward merging this is the same player as 'merge'. An item that
//            is needed to open a semi-blocked reward of the same kind is kept.
//   'all'    taps every reward item the moment it can. Nothing is ever merged
//            into a semi-blocked reward item, so a board that holds one never
//            clears and the boards after it never arrive.
// This is the cell such a player taps next, or null.
export function findTapCollectCell(state, rewardChainConfig, policy) {
  if (policy !== 'best' && policy !== 'all') return null
  // The highest semi-blocked rank of each reward on the board (it is opened
  // by a free item of its own rank, built from the smaller ones).
  const waiting = {}
  if (policy === 'best') {
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        if (!state.stuck[r][c] || state.passive?.[r]?.[c]) continue
        const info = decodeReward(state.itemAt[r][c])
        if (info) waiting[info.type] = Math.max(waiting[info.type] ?? 0, info.rank)
      }
    }
  }
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (state.stuck[r][c]) continue
      const info = decodeReward(state.itemAt[r][c])
      if (!info) continue
      if (policy === 'all') return [r, c]
      if ((waiting[info.type] ?? 0) >= info.rank) continue
      if (tapPaysAtLeastAsMuch(rewardChainConfig, info.type, info.rank)) return [r, c]
    }
  }
  return null
}

// Applies the leftover policy at a phase end, shared by both engines so the
// automatic simulator and a real play session can never disagree about what
// a phase boundary does to unmerged reward items: every reward item on the
// board and in `inventory` is removed, and either hand-collected at its own
// rank ('collect') or reported through onForfeit(type, rank) and paid
// nothing ('forfeit').
//
// MERGED FIRST (`mergeFirst(type, rank)`: does this player merge two items of
// that rank rather than tap them?). Economist: "after getting to rank 12,
// merges all the small rewards and collect them. to understand how much
// really the user got". Tapping every leftover as it lies undercounts: the
// last merges of a run drop items nobody has merged yet (a rank 3 and two
// rank 2s tapped pay 25 + 10 + 10; merged they are one rank 4 paying 60).
// Measured against the robot on the play engine, which merges before it
// taps: the simulator showed 7% less merge energy, the same in every run.
// The items of the board and the inventory are pooled per reward: a free
// item opens a semi-blocked one of its rank, two free ones merge, the result
// goes on up the chain, and what cannot be merged any further is tapped. A
// semi-blocked item nothing could open is still never paid.
export function settlePhaseLeftovers(state, inventory, policy, onCollect, onForfeit, { mergeFirst = null } = {}) {
  if (policy === 'collect' && mergeFirst) {
    const free = {}
    const stuck = {}
    const add = (into, type, rank) => {
      into[type] ??= Array(REWARD_MAX_RANK + 2).fill(0)
      into[type][rank] += 1
    }
    for (const item of leftoverRewardItems(state)) {
      const [r, c] = item.cell
      add(state.stuck[r][c] ? stuck : free, item.type, item.rank)
      state.itemAt[r][c] = null
      state.stuck[r][c] = false
    }
    for (let i = inventory.length - 1; i >= 0; i--) {
      const info = decodeReward(inventory[i])
      if (!info) continue
      inventory.splice(i, 1)
      add(free, info.type, info.rank)
    }
    for (const type of new Set([...Object.keys(free), ...Object.keys(stuck)])) {
      const f = (free[type] ??= Array(REWARD_MAX_RANK + 2).fill(0))
      const s = stuck[type] ?? Array(REWARD_MAX_RANK + 2).fill(0)
      for (let rank = 1; rank < REWARD_MAX_RANK; rank++) {
        if (!mergeFirst(type, rank)) continue
        const opened = Math.min(f[rank], s[rank])
        const pairs = Math.floor((f[rank] - opened) / 2)
        f[rank] -= opened + pairs * 2
        s[rank] -= opened
        f[rank + 1] += opened + pairs
      }
      for (let rank = REWARD_MAX_RANK; rank >= 1; rank--) {
        for (let k = 0; k < f[rank]; k++) creditCollect(state, type, rank, onCollect)
        for (let k = 0; k < s[rank]; k++) onForfeit?.(type, rank)
      }
    }
    return
  }
  for (const item of leftoverRewardItems(state)) {
    // Still semi-blocked when the phase ends: never freed, so never paid.
    if (state.stuck[item.cell[0]][item.cell[1]]) {
      state.itemAt[item.cell[0]][item.cell[1]] = null
      state.stuck[item.cell[0]][item.cell[1]] = false
      onForfeit?.(item.type, item.rank)
      continue
    }
    if (policy === 'collect') {
      collectReward(state, item.cell, onCollect)
    } else {
      state.itemAt[item.cell[0]][item.cell[1]] = null
      onForfeit?.(item.type, item.rank)
    }
  }
  for (let i = inventory.length - 1; i >= 0; i--) {
    const info = decodeReward(inventory[i])
    if (!info) continue
    inventory.splice(i, 1)
    if (policy === 'collect') creditCollect(state, info.type, info.rank, onCollect)
    else onForfeit?.(info.type, info.rank)
  }
}

// Every reward item still on the board plus any waiting in `inventory`, as
// {type, rank} - what a phase leaves behind when it ends.
export function leftoverRewardItems(state, inventory = []) {
  const items = []
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const info = decodeReward(state.itemAt[r][c])
      if (info) items.push({ ...info, cell: [r, c] })
    }
  }
  inventory.forEach((value, index) => {
    const info = decodeReward(value)
    if (info) items.push({ ...info, inventoryIndex: index })
  })
  return items
}

function findEmptyUnlockedCell(state) {
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (state.itemAt[r][c] == null && !state.locked[r][c]) return [r, c]
    }
  }
  return null
}

// Prefer an empty cell adjacent to an existing item of the same rank, purely
// so the spend looks intentional (landing next to a matching item) rather
// than scattered - findLegalMerge doesn't care where anything sits, so this
// has no effect on which merge happens next, only on where the new item
// visually appears.
//
// Two tiers: a not-stuck same-rank neighbor first, then a still-stuck one -
// same cosmetic-only reasoning, preferring to look like it's building
// toward an open item before showing up next to a fixed one.
export function findSpawnCell(state, rank) {
  return findSpawnCellNear(state, rank, true) ?? findSpawnCellNear(state, rank, false) ?? findEmptyUnlockedCell(state)
}

function findSpawnCellNear(state, rank, freeOnly) {
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (state.itemAt[r][c] != null || state.locked[r][c]) continue
      for (const [dr, dc] of DELTAS) {
        const nr = r + dr
        const nc = c + dc
        if (!inBounds(state, nr, nc) || state.itemAt[nr][nc] !== rank) continue
        if (freeOnly && state.stuck[nr][nc]) continue
        return [r, c]
      }
    }
  }
  return null
}

// "Held" means actually holding a FREE item at that rank - a still-stuck
// semi/blocked-revealed item doesn't count, matching CLAUDE.md's own "keyed
// off the player's current max rank held" framing. This drives both
// generator-tier unlocks (currentTier/unlockedTiers) and the lucky-drop
// gate everywhere it's read (mergeSimulation.js's own loop, playSession.js's
// currentGeneratorTier/unlockedGeneratorTiers/spendGenerator) - a big item
// merely sitting stuck on the board (revealed but not yet merged into)
// shouldn't unlock x4 or open lucky drops on its own; the player has to
// actually clear it first, same rule as reachedAt (recordAllOccupied/
// recordRank above) now enforces for the simulation's own rank-reached
// stats.
// WHICH MULTIPLIER THE SIMULATED PLAYER TAPS. The biggest one open - except
// when a semi-blocked item on the board is of a LOWER rank than that
// multiplier gives. Such an item can only be cleared by a free item of its
// own rank, and a bigger multiplier never makes one: a single leftover
// rank-1 item then stays semi-blocked for the rest of the run, its board
// never counts as cleared, and no later board ever arrives (found by
// measurement: this stranded the whole chain in most runs once Board 1
// started opening quickly). A real player taps the small multiplier once; so
// does this one - the biggest open multiplier whose item is not above the
// lowest semi-blocked rank.
export function tierToSpend(state, maxRankHeld, tiers) {
  const top = currentTier(maxRankHeld, tiers)
  let lowestStuck = Infinity
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const item = state.itemAt[r][c]
      if (item != null && state.stuck[r][c] && isMainItem(item) && item < lowestStuck) lowestStuck = item
    }
  }
  if (lowestStuck >= top.normalRank) return top
  const usable = unlockedTiers(maxRankHeld, tiers).filter((t) => t.normalRank <= lowestStuck)
  return usable.length > 0 ? usable.reduce((a, b) => (b.normalRank > a.normalRank ? b : a)) : top
}

export function currentMaxRank(state) {
  let max = 0
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const item = state.itemAt[r][c]
      // Reward items (V2) are excluded - "reaching"/"holding" a rank, and the
      // generator-tier/lucky-drop gates this drives, are main-chain-only
      // concepts; a held coin/puzzle/energy/charm item has nothing to do
      // with main-chain progress regardless of its own reward rank.
      if (item != null && !state.stuck[r][c] && isMainItem(item) && item > max) max = item
    }
  }
  return max
}

// Only a FREE item counts toward "reached this rank" - a still-stuck
// semi/blocked item is visible on the board but isn't something the player
// actually holds yet (it can only be merged INTO, never moved or spent), so
// it doesn't count until some later merge actually frees it. Skipping stuck
// cells here is what makes that rule hold for every caller of
// recordAllOccupied (after a merge, and after a board-push brings a fresh
// batch of semi-placed - and therefore stuck - items onto the board).
export function recordAllOccupied(state, recordRank) {
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      // Reward items (V2) never count toward "reached this rank" - see
      // currentMaxRank's own comment; recordRank itself (simulatePlaythrough)
      // is also guarded the same way, so this check is here for every OTHER
      // caller (playSession.js) rather than relying on that alone.
      if (state.itemAt[r][c] != null && !state.stuck[r][c] && isMainItem(state.itemAt[r][c])) recordRank(state.itemAt[r][c])
    }
  }
}

// Whether `state` has no remaining subsidy machinery at all - no unrevealed
// locked tile that could STILL ever be revealed, no revealed-but-not-yet-
// cleared stuck item. This is the trigger condition for pushing the next
// board in as a fresh wave of rows: once true, there's nothing left on the
// board that isn't a fully free item (or permanently, provably dead - see
// below).
//
// A locked cell only blocks this while the board's own blockedQueue still
// has unrevealed entries left (`blockedQueueIndex < blockedQueue.length`) -
// real, found-live bug fix: a board misconfigured with more blocked/semi
// TILES than QUEUE ITEMS (the "N tiles with no item" case boardChecks in
// effortTargeting.js already flags - see its own comment for the mechanism)
// used to strand the ENTIRE REST OF THE CHAIN, not just that board's own
// leftover DR. `revealNeighbors` guards itself against reading past the end
// of `blockedQueue` (`if (state.blockedQueueIndex >= state.blockedQueue.length)
// continue`), so once the queue is exhausted, any STILL-locked cell can
// mathematically NEVER be revealed by any sequence of merges, no matter how
// the board is played - there is no future action, however skilled, that
// changes that cell's fate. Treating it exactly like a cell that's merely
// "not yet handled" (the old, unconditional check) meant `advanceBoards`
// would refuse to push the next board in FOREVER, even though nothing could
// ever make that refusal end - reported live as "Boards the player reached:
// 1/3" with 1360 of 1504 configured subsidy DR never delivered, on a board
// whose queue simply ran one item short of its tile count. Verified: the
// identical board/queue mismatch that used to permanently strand boards 2-3
// now correctly lets them push in once board 1's queue is exhausted, with
// only the genuinely-unrevealable tile's own DR lost (still reported via
// subsidyDelivered < subsidyConfigured) instead of the whole rest of the
// event. `stuck` cells are NOT given this exception - a stuck item can
// always still be reached by some future mover (nothing here bounds how
// long that can take), so it keeps blocking unconditionally.
export function boardIsCleared(state) {
  const queueExhausted = state.blockedQueueIndex >= state.blockedQueue.length
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (state.locked[r][c] && !queueExhausted) return false
      // A semi-blocked item holds the board back whatever it is - a
      // main-chain item or a small reward (by explicit economist decision:
      // "the board should wait for it"). A reward item is freed by merging a
      // free item of the same reward and rank into it, and those only come
      // from merge drops, so the build places reward items under tiles where
      // that match can come (rewardPlacement.js) and takes back the ones
      // that hold a board back in the simulation (smallRewardsWorkflow.js).
      // (They used not to count, and the next board pushed in over them.)
      // ...unless nothing can ever open it: in a run with no merge drops at
      // all (`state.rewardsCanOpen === false`) a semi-blocked reward item has
      // no match coming, so only main-chain items hold the board. That is
      // every run that looks at the main chain alone - the effort
      // distribution search and its chart, the starting-goal check, the
      // editor's own readouts. Without this, one reward item under a tile
      // stopped every later board from arriving in those runs, and the effort
      // distribution could no longer be shaped at all (reported by the
      // economist: "the distribution has to work").
      if (state.stuck[r][c] && state.itemAt[r][c] != null && !state.passive?.[r]?.[c] && (isMainItem(state.itemAt[r][c]) || state.rewardsCanOpen !== false)) return false
    }
  }
  return true
}

// Pushes `waveBoard`'s own tile pattern + semiPlacements/blockedQueue in as
// new rows at the top of `state`, shifting every existing row down by
// however many rows the wave contributes (its own `rows`, capped to 3 and to
// `state`'s own row count - a board used as a wave is meant to be a short
// 1-3 row strip, not a full board). Column counts are aligned top-left,
// best-effort, matching applyPresetToBoard's convention - any width mismatch
// just leaves the uncovered columns open (wave narrower than the state) or
// ignores the extra columns (wave wider than the state).
//
// Items shifted past the bottom edge are returned as a plain array of ranks
// (order: top-to-bottom, left-to-right of the row(s) that fell off) - by the
// time this runs the trigger condition (boardIsCleared) guarantees every
// occupied cell on the board is a fully free item, so there's no stuck/locked
// state to carry over for the overflowed cells, just ranks.
export function pushBoardIn(state, waveBoard) {
  const rows = Math.max(0, Math.min(waveBoard.rows, 3, state.rows))
  if (rows === 0) return { rows, overflow: [] }

  const cols = state.cols
  const overflow = []
  for (let r = state.rows - rows; r < state.rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (state.itemAt[r][c] != null) overflow.push(state.itemAt[r][c])
    }
  }

  for (let r = state.rows - 1; r >= rows; r--) {
    for (let c = 0; c < cols; c++) {
      state.itemAt[r][c] = state.itemAt[r - rows][c]
      state.stuck[r][c] = state.stuck[r - rows][c]
      state.locked[r][c] = state.locked[r - rows][c]
      if (state.passive) state.passive[r][c] = state.passive[r - rows][c]
    }
  }

  const waveCols = Math.min(waveBoard.cols, cols)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      state.itemAt[r][c] = null
      state.stuck[r][c] = false
      if (state.passive) state.passive[r][c] = false
      state.locked[r][c] = c < waveCols && waveBoard.tiles[r][c] === 'blocked'
    }
  }
  for (const p of waveBoard.semiPlacements) {
    if (p.row < rows && p.col < waveCols) {
      state.itemAt[p.row][p.col] = p.rank
      state.stuck[p.row][p.col] = !(state.rewardsCanOpen === false && !isMainItem(p.rank))
      addToRewardPool(state, 'tile', p.rank)
    }
  }

  state.blockedQueue = [...waveBoard.blockedQueue]
  state.blockedQueueIndex = 0

  return { rows, overflow }
}

// Repeatedly pushes in boards (starting at `nextBoardIndex`) while the
// current one is fully cleared (boardIsCleared) and boards remain - a wave
// board with no subsidy tiles/items of its own clears instantly, so this
// cascades straight through it to the next one rather than stalling.
// Overflowed items are appended to `inventory` (mutated in place). Calls
// `onPush(waveBoard, rows, overflow)` for each board pushed, if given -
// callers use this to log the event in their own shape. Returns the index of
// the next not-yet-consumed board.
export function advanceBoards(state, boards, nextBoardIndex, inventory, onPush) {
  let i = nextBoardIndex
  while (boardIsCleared(state) && i < boards.length) {
    const waveBoard = boards[i]
    const { rows, overflow } = pushBoardIn(state, waveBoard)
    inventory.push(...overflow)
    onPush?.(waveBoard, rows, overflow)
    i += 1
  }
  return i
}

// Simulates a player working through `boards` (an array; play starts on
// `boards[options.startIndex ?? 0]`): greedily auto-merges any legal pair
// (deterministic tie-break via row-major scan), else places a free item from
// the inventory into an empty unlocked cell if one's waiting, else spends DR
// through the generator (tier-gated dynamically on the current max rank
// held, with deterministic EV-scheduled lucky drops) to spawn a new item.
// Merge and inventory-placement are both free, so they're always preferred
// over spending new DR. A merge reveals any locked blocked tile adjacent to
// either cell it touched, pulling the next item off the board's blockedQueue.
//
// Once the active board has no locked or stuck cells left at all
// (boardIsCleared), the next board in `boards` (if any) pushes in as a fresh
// wave of rows from the top (see pushBoardIn) — repeating through as many
// boards as clear instantly, in order, until one doesn't or the array is
// exhausted. Items shifted off the bottom edge go into an inventory the
// greedy loop drains before spending any new DR.
//
// Returns reachedAt: { [rank]: drSpentWhenFirstReached }, sparse — ranks
// never reached in this run are absent. `tapsAt: { [rank]: generatorSpendsSoFarWhenFirstReached }`
// is the same shape, counting generator-spend actions only (not merges, not
// inventory placements — both of those are free and player-effortless; a
// "tap" is specifically a DR-costing generator spend, at whatever tier was
// active at the time, since the tier itself already governs how many DR
// each tap costs and which rank it drops). Consumers wanting "taps between
// rank N-1 and rank N" (accounting for a tier boundary falling inside that
// span) should diff consecutive entries themselves — see SimulationReport.jsx.
// `stopReason` explains why the run ended: 'max-rank-reached',
// 'no-legal-move', 'budget-exhausted', or 'max-steps' (a safety valve, not
// expected to trigger in practice). `inventoryRemaining` is how many items
// were still sitting unplaced in the inventory when the run stopped (only
// possible with 'no-legal-move' or 'budget-exhausted' — the board ran out of
// room, or DR, before they could go back on).
//
// options.trace: true also returns `events`, a step-by-step log (initial
// board state, each spend/merge/reveal/board-push, each first-time-reached
// rank, and the final stop) — off by default so normal runs don't pay for it.
//
// options.mergeStrategy: only onboardingGoal.js's feasibility search passes
// this (see pickMergeByStrategy) - every other caller leaves it unset and
// gets the exact original findLegalMerge fast path, unchanged.
//
// options.revealAroundMover: FALSE by default - the simulator opens tiles the
// way the play screens do (only next to the cell a merge happens in). It was
// true for a long time: the simulator then also opened the tiles next to the
// cell the moved item came from, which no player's merge does. On averages
// the two were close, which is why it was left alone - but once every merge
// of a rank dropped the same items (steady containers) the rest of the
// simulator agreed with a robot on the play engine to the last item, and
// this showed: in a segment with a lot of subsidy the simulator opened two
// more coin items under the tiles than real play did, 9% more coins, in
// every run. With false it is the robot's number exactly (300 players each,
// four segments). Pass true only to reproduce the old figures.
// Main-chain-only subsidy accounting for one phase's own slice of boards
// (main or RC - see simulatePlaythrough's RC transition). Reward-encoded
// queue/semi entries (V2 mixed queues) are deliberately excluded from both
// `subsidyConfigured` and the semi-tile delivered-bonus below - they have
// their own, separate `collected` accounting and never count as subsidy DR.
function snapshotPhaseStats(boardsList, fromIndex, reachedIndex, deliveredSoFar) {
  const subsidyValueOf = (b) =>
    (b.semiPlacements ?? []).filter((p) => isMainItem(p.rank)).reduce((x, p) => x + valueOf(p.rank), 0) +
    (b.blockedQueue ?? []).filter((r) => isMainItem(r)).reduce((x, r) => x + valueOf(r), 0)
  const subsidyConfigured = boardsList.slice(fromIndex).reduce((s, b) => s + subsidyValueOf(b), 0)
  const boardsReached = Math.min(boardsList.length - fromIndex, reachedIndex - fromIndex)
  let subsidyDelivered = deliveredSoFar
  for (const b of boardsList.slice(fromIndex, fromIndex + boardsReached)) {
    subsidyDelivered += (b.semiPlacements ?? []).filter((p) => isMainItem(p.rank)).reduce((x, p) => x + valueOf(p.rank), 0)
  }
  return { subsidyConfigured, subsidyDelivered, boardsReached, boardsTotal: boardsList.length - fromIndex }
}

export function simulatePlaythrough(boards, options = {}) {
  const { startIndex = 0, drBudget = Infinity, maxSteps = 20000, trace = false, mergeStrategy = null, revealAroundMover = false } = options
  // How this player takes the small rewards - see findTapCollectCell.
  const collectPolicy = options.collectPolicy ?? 'merge'
  // Defaults to the starting board's own configured EV (see board.js) so
  // this automatically reflects whatever the economist sets in the "Lucky
  // drops" editor card - options.targetEv still overrides it explicitly,
  // for isolated/synthetic test boards (onboardingGoal.js, placement.js)
  // that don't carry a real targetEv of their own.
  let targetEv = options.targetEv ?? boards[startIndex]?.targetEv ?? DEFAULT_TARGET_EV
  // Same defaulting precedent as targetEv just above - reads the starting
  // board's own configured unlock ranks (see board.js), with
  // options.tier2UnlockRank/tier4UnlockRank as an explicit override for
  // isolated/synthetic test boards (onboardingGoal.js, placement.js) that
  // don't carry real values of their own.
  let tier2UnlockRank = options.tier2UnlockRank ?? boards[startIndex]?.tier2UnlockRank ?? DEFAULT_TIER2_UNLOCK_RANK
  let tier4UnlockRank = options.tier4UnlockRank ?? boards[startIndex]?.tier4UnlockRank ?? DEFAULT_TIER4_UNLOCK_RANK
  let tiers = buildGeneratorTiers(tier2UnlockRank, tier4UnlockRank)

  const state = buildInitialState(boards[startIndex])
  let probs = computeProbs(targetEv)
  // LUCK. By default lucky drops follow a fixed schedule that lands exactly on
  // the EV (createEvScheduler): every simulated player then has the same luck,
  // which keeps an AVERAGE free of noise - what a build is sized on. A real
  // player rolls each tap, though, and two of them do not spend the same DR.
  // `options.luckRng` (a random source) makes this player roll like a real
  // one, so a batch of them shows how far one player can be from the average
  // (step 7's validation, and its "players within 15%").
  const luckRng = options.luckRng ?? null
  const schedulerFor = (p) => (luckRng ? () => rollBonus(p, luckRng) : createEvScheduler(p))
  let nextBonus = schedulerFor(probs)
  const inventory = []

  const events = trace ? [] : null
  // Always a real function, not `trace ? fn : null` as before: it now also
  // tallies revealed blocked-tile value for the subsidy-delivery reporting
  // below, which has to be counted on EVERY run, not just traced ones. Still
  // only builds the (potentially large) `events` array when tracing.
  let subsidyDelivered = 0
  const log = (e) => {
    // Main-chain subsidy DR accounting only - a revealed reward item (mixed
    // queues, V2) contributes to the separate `collected` tally instead (see
    // onCollect below), never to subsidy DR.
    if (e.type === 'reveal' && isMainItem(e.rank)) subsidyDelivered += valueOf(e.rank)
    // Every merge-dropped reward item, counted as it drops: how many, and
    // its RAW value - what that item is worth at its own rank before any
    // merging or collecting. (Collectible income is the separate `collected`
    // tally: what the simulated policy actually ends up crediting.)
    if (e.type === 'merge-drop') {
      droppedItems[e.rewardType] = (droppedItems[e.rewardType] ?? 0) + 1
      droppedRawValue[e.rewardType] = (droppedRawValue[e.rewardType] ?? 0) + (rewardChainConfig ? rewardPrizeAmount(rewardChainConfig, e.rewardType, e.rank) : 0)
    }
    if (trace) events.push({ drSpent, ...e })
  }
  const droppedItems = emptyRewardTally()
  const droppedRawValue = emptyRewardTally()

  let drSpent = 0
  let taps = 0
  let energySpent = 0 // V2: generator actions funded by collected energy, not DR (see the main loop)
  const reachedAt = {}
  const tapsAt = {}
  const recordRank = (rank) => {
    if (!isMainItem(rank)) return // reward items (V2) never count as "reached"
    if (reachedAt[rank] === undefined) {
      reachedAt[rank] = drSpent
      tapsAt[rank] = taps
      log?.({ type: 'reached', rank })
    }
  }

  // Reward collection (V2) - a flat tally per resource type, credited by
  // performMerge's auto-collect-at-rank-4, collectReward (manual, see the
  // automatic-player policy below), and merge-drop rolls.
  const collected = emptyRewardTally()
  // V2 section 9: the same total, split by WHERE it came from - a
  // tile-placed reward item (auto-collected at rank 4, or manually
  // collected) vs. a merge-drop-group roll. Lets the solver/UI report the
  // actual achieved tile/drop source split against the economist's own
  // preferred weighting (rewardEconomy.js), without re-running anything.
  const collectedBySource = { tile: emptyRewardTally(), drop: emptyRewardTally() }
  // `collected` is CUMULATIVE payout and is never decremented - spending
  // energy draws down the separate `energyBalance` instead. (An earlier
  // version spent straight out of collected.energy, so any caller reading
  // "energy collected" after a run got the unspent remainder, not the
  // payout.) tileShare (0-1) comes from the reward pool's composition at the
  // moment of the collect - see creditCollect.
  let energyBalance = 0
  const onCollect = (type, rank, tileShare = 1) => {
    const amount = rewardChainConfig ? rewardPrizeAmount(rewardChainConfig, type, rank) : 0
    collected[type] = (collected[type] ?? 0) + amount
    collectedBySource.tile[type] += amount * tileShare
    collectedBySource.drop[type] += amount * (1 - tileShare)
    if (type === 'energy') energyBalance += amount
    log?.({ type: 'collect', rewardType: type, rank, amount, tileShare })
  }
  // rewardChainConfig/minDropRank default from the starting board's own
  // saved fields (same precedent as targetEv/tier unlocks above) so a
  // caller that passes nothing still credits a mixed queue's tile rewards
  // at their real configured prizes - that path is fully deterministic
  // (auto-collect at rank 4, energy-funded spends included). Drop tables
  // deliberately do NOT default from the board: default dropMode is
  // 'stochastic' with Math.random, and this function is the engine under
  // several deterministic searches (effortTargeting's hill-climb,
  // computeOnboardingReserve's feasibility scan, compareToSimulator) whose
  // correctness depends on identical inputs producing identical runs -
  // callers that want drops simulated pass dropGroupsConfig/dropGroupsById
  // (and, for reproducibility, a seeded dropRng or dropMode: 'expected')
  // explicitly, as every product path already does.
  const startBoard = boards[startIndex]
  let dropGroupsConfig = options.dropGroupsConfig ?? null
  // Can a merge drop anything in this run, in either phase? (See boardIsCleared.)
  const anyDropIn = (tables) => (tables ?? []).some((t) => (t?.entries ?? []).some((e) => e.weight > 0))
  // (options.rewardsWait: true keeps reward items semi-blocked even with no drops - for checks of that rule itself.)
  state.rewardsCanOpen = options.rewardsWait === true || anyDropIn(dropGroupsConfig) || anyDropIn(options.rcDropGroupsConfig) || anyDropIn(options.rcBoards?.[0]?.dropGroupsConfig)
  if (!state.rewardsCanOpen) {
    // The first board's semi-blocked reward items, placed before this was known.
    for (let r = 0; r < state.rows; r++) for (let c = 0; c < state.cols; c++) if (state.stuck[r][c] && state.itemAt[r][c] != null && !isMainItem(state.itemAt[r][c])) state.stuck[r][c] = false
  }
  let dropGroupsById = options.dropGroupsById ?? null
  const dropRng = options.dropRng
  const dropMode = options.dropMode ?? 'stochastic'
  const dropScheduler = dropMode === 'expected' ? createDropScheduler() : null
  let rewardChainConfig = options.rewardChainConfig ?? startBoard?.rewardChainConfig ?? null
  // What happens to reward items still unmerged below rank 4 when a phase
  // ends (the main chain handing over to RC, or the run stopping):
  // 'forfeit' (default) - they pay NOTHING; nothing is assumed to pay out
  //   automatically. Their would-be hand-collect value is reported as
  //   leftoverForfeited so the gap is visible.
  // 'collect' - the player hand-collects every one at its current rank's
  //   prize before the phase ends.
  // An explicit, economist-chosen policy (board.rewardLeftoverPolicy, one
  // shared value per list) - not a game rule this engine can know.
  let leftoverPolicy = options.leftoverPolicy ?? startBoard?.rewardLeftoverPolicy ?? DEFAULT_LEFTOVER_POLICY
  const leftoverForfeited = emptyRewardTally()
  let leftoverItemCount = 0
  let spaceCollects = 0
  let tapCollects = 0
  // "7 merges of rank 7, 5 of rank 8" - real merge-event counts per
  // resulting main-chain rank, over the whole run. The economist-facing
  // "merges per rank" report (rewardTargeting.js/RewardsPage.jsx) reads
  // this directly rather than re-deriving it some other way.
  const mergeCountsByRank = {}
  const recordMergeCount = (rank) => {
    mergeCountsByRank[rank] = (mergeCountsByRank[rank] ?? 0) + 1
  }
  const minDropRankOpt = options.minDropRank ?? startBoard?.minDropRank
  const buildMergeOptions = (minDropRank) => ({
    revealAroundMover,
    onCollect,
    dropGroupsConfig,
    dropGroupsById,
    dropRng,
    dropMode,
    dropScheduler,
    inventory,
    recordMergeCount,
    minDropRank,
  })
  let performMergeOptions = buildMergeOptions(minDropRankOpt)

  // Phase end: applies the leftover policy to every reward item still on the
  // board or waiting in the inventory. Reward items never carry across a
  // phase boundary either way.
  const settleLeftovers = () =>
    settlePhaseLeftovers(
      state,
      inventory,
      leftoverPolicy,
      onCollect,
      (type, rank) => {
        leftoverForfeited[type] += rewardChainConfig ? rewardPrizeAmount(rewardChainConfig, type, rank) : 0
        leftoverItemCount += 1
      },
      {
        // The player who merges everything merges the leftovers too; the one
        // who taps when that pays as much taps those; the one who taps
        // everything merges nothing.
        mergeFirst:
          (options.collectPolicy ?? 'merge') === 'all'
            ? null
            : (options.collectPolicy ?? 'merge') === 'best'
              ? (type, rank) => !tapPaysAtLeastAsMuch(rewardChainConfig, type, rank)
              : () => true,
      },
    )

  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (state.itemAt[r][c] != null) {
        log?.({ type: 'initial', cell: [r, c], rank: state.itemAt[r][c] })
        // Only counts as "reached" if it's free from the start - every
        // pre-placed item on a fresh board is a semi tile, which always
        // starts stuck (see buildInitialState), so in practice this is a
        // no-op today; kept as an explicit guard rather than an assumption,
        // matching recordAllOccupied's own rule below.
        if (!state.stuck[r][c]) recordRank(state.itemAt[r][c])
      }
    }
  }

  // `boards`/`nextBoardIndex` describe whichever phase is currently active -
  // RC (V2) swaps `activeBoards` to options.rcBoards and rebuilds `state`
  // fresh from its own board 0, same as a brand-new run (RC's board 0 gets
  // the same "board 1" treatment as the main list's, per CLAUDE.md), rather
  // than trying to push RC content in as a wave onto the exhausted main
  // board's own grid dimensions.
  let activeBoards = boards
  let nextBoardIndex = advanceBoards(state, activeBoards, startIndex + 1, inventory, (waveBoard, rows, overflow) =>
    log?.({ type: 'board-push', name: waveBoard.name, rows, overflow }),
  )
  recordAllOccupied(state, recordRank)

  const rcBoards = options.rcBoards ?? null
  let phase = 'main'
  // Snapshot of the main phase's own subsidy/board-reach stats, captured at
  // the moment RC is entered (if it is) - see the result shape at the
  // bottom of this function. subsidyDelivered is ONE running counter across
  // both phases (the `log` closure above never resets it), so
  // subsidyDeliveredAtTransition is what to subtract back out to isolate
  // the RC phase's own portion once the run ends.
  let mainPhaseSnapshot = null
  let subsidyDeliveredAtTransition = 0
  // Collected-reward tallies snapshotted at the same moment, so a caller can
  // read each phase's own payout directly (collectedMainPhase /
  // collectedRcPhase on the result) instead of diffing two whole runs.
  let collectedAtRcEntry = null
  let collectedBySourceAtRcEntry = null
  let mergeCountsAtRcEntry = null
  // WHAT THE NORMAL EVENT REALLY PAID. Everything on the board comes along
  // into Recompletion, so nothing is settled when rank 12 is reached - but the
  // free reward items the player holds at that moment are theirs, earned in
  // the normal event: tapped there and then they would pay their own rank's
  // value. With leftovers collected (the default) that value is counted to
  // the normal event, and Recompletion is counted what it adds on top - the
  // two always sum to what the whole run collected.
  let carriedAtRcEntry = null
  let carriedBySourceAtRcEntry = null

  // Progression checkpoint (options.checkpoint = { phase: 'main' | 'rc',
  // fraction: 0-1 }): an OBSERVATION of the run at the moment that phase's
  // main-chain progress (mainChainProgress above) first reaches the fraction.
  // Ordering rule, the same in every engine: the state is observed after the
  // action that crosses the threshold and that action's own immediate
  // automatic effects (the merge's reveals, its drop landing, a rank-4
  // auto-collect, any board it pushes in) - and before the player's next
  // action. Nothing is collected, settled or changed by observing: lower-rank
  // reward items stay on the board, exactly as they would for a real player
  // passing that point.
  const checkpointSpec = options.checkpoint ?? null
  let checkpoint = null
  // `options.checkpointFractions`: more points of the SAME phase to observe in
  // the same run (what was collected there) - e.g. [0.7, 0.75] for "how much
  // Twister DR does each segment have at 70-75%". Light: collected only.
  const extraFractions = (options.checkpointFractions ?? []).filter((f) => Number.isFinite(f))
  const checkpointsAt = {}
  const progressByPhase = { main: 0, rc: null }
  const observeProgress = () => {
    const goalReached = reachedAt[phaseGoalRank(phase)] !== undefined
    const progress = mainChainProgress(state, inventory, phase, goalReached)
    if (progress > (progressByPhase[phase] ?? 0)) progressByPhase[phase] = progress
    if (checkpointSpec && checkpointSpec.phase === phase) {
      for (const fraction of extraFractions) {
        if (checkpointsAt[fraction] || progress + 1e-12 < fraction) continue
        const start = phase === 'rc' ? collectedAtRcEntry : null
        checkpointsAt[fraction] = { fraction, progress, drSpent, collectedInPhase: start ? subtractCollected(collected, start) : { ...collected } }
      }
    }
    if (!checkpointSpec || checkpoint || checkpointSpec.phase !== phase) return
    if (progress + 1e-12 < checkpointSpec.fraction) return
    const phaseStart = phase === 'rc' ? collectedAtRcEntry : null
    checkpoint = {
      phase,
      fraction: checkpointSpec.fraction,
      progress,
      drSpent,
      taps,
      energySpent,
      // Cumulative payout at this moment (never reduced by spending).
      collected: { ...collected },
      // The same, counted from the start of the checkpoint's own phase.
      collectedInPhase: phaseStart ? subtractCollected(collected, phaseStart) : { ...collected },
      droppedItems: { ...droppedItems },
      droppedRawValue: { ...droppedRawValue },
      twisterUncollected: uncollectedRewardItems(state, inventory, TWISTER_TYPE, rewardChainConfig),
    }
  }

  let stopReason = 'max-steps'
  for (let step = 0; step < maxSteps; step++) {
    observeProgress()
    if (phase === 'main' && reachedAt[MAX_RANK] !== undefined) {
      // Recompletion starts the moment rank 12 is reached (see
      // enterRecompletion). It used to wait for every normal board to be
      // cleared as well.
      if (rcBoards && rcBoards.length) {
        // Reward items come along into Recompletion (enterRecompletion),
        // so nothing is settled here - only when the run ends.
        mainPhaseSnapshot = snapshotPhaseStats(activeBoards, startIndex, nextBoardIndex, subsidyDelivered)
        subsidyDeliveredAtTransition = subsidyDelivered
        collectedAtRcEntry = { ...collected }
        collectedBySourceAtRcEntry = { tile: { ...collectedBySource.tile }, drop: { ...collectedBySource.drop } }
        carriedAtRcEntry = emptyRewardTally()
        carriedBySourceAtRcEntry = { tile: emptyRewardTally(), drop: emptyRewardTally() }
        if (leftoverPolicy === 'collect') {
          for (const item of leftoverRewardItems(state, inventory)) {
            // Still semi-blocked: never freed, so not the player's to tap.
            if (item.cell && state.stuck[item.cell[0]][item.cell[1]]) continue
            const value = rewardChainConfig ? rewardPrizeAmount(rewardChainConfig, item.type, item.rank) : 0
            const tile = state.rewardPool?.tile?.[item.type] ?? 0
            const drop = state.rewardPool?.drop?.[item.type] ?? 0
            const tileShare = tile + drop > 0 ? tile / (tile + drop) : 0
            carriedAtRcEntry[item.type] = (carriedAtRcEntry[item.type] ?? 0) + value
            carriedBySourceAtRcEntry.tile[item.type] += value * tileShare
            carriedBySourceAtRcEntry.drop[item.type] += value * (1 - tileShare)
          }
        }
        mergeCountsAtRcEntry = { ...mergeCountsByRank }
        phase = 'rc'
        enterRecompletion(state, rcBoards[0], inventory)
        activeBoards = rcBoards
        // Re-read ALL config from the RC boards' own values — the P0 bug
        // was that these were captured once at the top of this function
        // from the main-phase starting board and never updated here, so
        // the RC phase ran with the main phase's generator EV, tier
        // unlocks, drop groups, and reward config regardless of what the
        // economist configured on the RC boards themselves.
        const rcBoard0 = rcBoards[0]
        targetEv = options.rcTargetEv ?? rcBoard0.targetEv ?? DEFAULT_TARGET_EV
        probs = computeProbs(targetEv)
        nextBonus = schedulerFor(probs)
        tier2UnlockRank = options.rcTier2UnlockRank ?? rcBoard0.tier2UnlockRank ?? DEFAULT_TIER2_UNLOCK_RANK
        tier4UnlockRank = options.rcTier4UnlockRank ?? rcBoard0.tier4UnlockRank ?? DEFAULT_TIER4_UNLOCK_RANK
        tiers = buildGeneratorTiers(tier2UnlockRank, tier4UnlockRank)
        dropGroupsConfig = options.rcDropGroupsConfig ?? rcBoard0.dropGroupsConfig ?? dropGroupsConfig
        dropGroupsById = options.rcDropGroupsById ?? (rcBoard0.dropGroups ? new Map(rcBoard0.dropGroups.map((g) => [g.id, g])) : dropGroupsById)
        rewardChainConfig = rewardChainForNextPhase(rewardChainConfig, options.rcRewardChainConfig ?? rcBoard0.rewardChainConfig)
        const rcMinDropRank = options.rcMinDropRank ?? rcBoard0.minDropRank ?? minDropRankOpt
        leftoverPolicy = options.rcLeftoverPolicy ?? rcBoard0.rewardLeftoverPolicy ?? leftoverPolicy
        performMergeOptions = buildMergeOptions(rcMinDropRank)
        nextBoardIndex = advanceBoards(state, activeBoards, 1, inventory, (waveBoard, rows, overflow) =>
          log?.({ type: 'board-push', name: waveBoard.name, rows, overflow }),
        )
        recordAllOccupied(state, recordRank)
        log?.({ type: 'rc-entered' })
        progressByPhase.rc = 0
        continue
      }
      if (!rcBoards) {
        stopReason = 'max-rank-reached'
        break
      }
    }
    if (phase === 'rc' && reachedAt[RC_MAX_RANK] !== undefined) {
      stopReason = 'rc-max-rank-reached'
      break
    }

    // A player who taps reward items does it before anything else.
    if (collectPolicy !== 'merge') {
      const tapCell = findTapCollectCell(state, rewardChainConfig, collectPolicy)
      if (tapCell) {
        collectReward(state, tapCell, onCollect)
        tapCollects += 1
        log?.({ type: 'tap-collect', cell: tapCell })
        continue
      }
    }

    let merge = mergeStrategy ? pickMergeByStrategy(state, mergeStrategy) : options.mergeRng ? pickCarelessMerge(state, options.mergeRng) : null
    if (!mergeStrategy && !options.mergeRng) {
      // The careful player: the merge, and where it opens tiles.
      const careful = nextCarefulMerge(state)
      if (careful?.relocate) {
        const { from, to } = careful.relocate
        state.itemAt[to[0]][to[1]] = state.itemAt[from[0]][from[1]]
        state.itemAt[from[0]][from[1]] = null
        log?.({ type: 'moved', from, to })
      }
      merge = careful?.merge ?? null
    }
    if (merge) {
      performMerge(state, merge, recordRank, log, performMergeOptions)
      nextBoardIndex = advanceBoards(state, activeBoards, nextBoardIndex, inventory, (waveBoard, rows, overflow) =>
        log?.({ type: 'board-push', name: waveBoard.name, rows, overflow }),
      )
      recordAllOccupied(state, recordRank)
      continue
    }

    const invCell = inventory.length ? findEmptyUnlockedCell(state) : null
    if (invCell) {
      const rank = inventory.shift()
      state.itemAt[invCell[0]][invCell[1]] = rank
      log?.({ type: 'inventory-place', cell: invCell, rank })
      recordRank(rank)
      continue
    }

    if (!findEmptyUnlockedCell(state)) {
      // Board full. The automatic player manages space the way the intended
      // strategy describes ("merge toward rank 4 while managing board
      // space"): before giving up, it hand-collects its cheapest reward item
      // to free a cell - the one case this policy collects below rank 4
      // mid-phase. Only when there's no reward item left to give up is the
      // run genuinely stuck.
      const rewardCell = findLowestRewardCell(state)
      if (rewardCell) {
        collectReward(state, rewardCell, onCollect)
        spaceCollects += 1
        log?.({ type: 'space-collect', cell: rewardCell })
        continue
      }
      stopReason = 'no-legal-move'
      break
    }

    // V2 (section 7): "1 merge energy funds 1 generator action at multiplier
    // x1" - a free action (no DR), always at the x1 tier specifically
    // (tiers[0]), regardless of which tier is currently unlocked. This is
    // real energy use, in every drop mode: the prediction run is a full
    // playthrough, so the feedback loop (energy funds taps, taps create
    // merges, merges create drops) is part of what it measures. The
    // subsidy CREDIT (rewardEconomy.js) is a separate planning formula over
    // the run's cumulative collected energy - `collected.energy` is never
    // drawn down by this, only `energyBalance` is. Preferred ahead of a DR
    // spend (same "free actions first" priority merges/inventory-placement
    // already have), tracked separately via energySpent so a caller can see
    // how much of the run's progress energy paid for.
    if (energyBalance >= 1) {
      energyBalance -= 1
      energySpent += 1
      taps += 1
      const x1Tier = tiers[0]
      const maxRankHeld = currentMaxRank(state)
      const bonus = maxRankHeld >= tier2UnlockRank ? nextBonus() : 0
      const spawnedRank = x1Tier.normalRank + bonus
      const spawnCell = findSpawnCell(state, spawnedRank)
      state.itemAt[spawnCell[0]][spawnCell[1]] = spawnedRank
      log?.({ type: 'energy-spend', cell: spawnCell, rank: spawnedRank })
      recordRank(spawnedRank)
      continue
    }

    const maxRankHeld = currentMaxRank(state)
    const tier = tierToSpend(state, maxRankHeld, tiers)
    if (drSpent + tier.cost > drBudget) {
      stopReason = 'budget-exhausted'
      break
    }

    drSpent += tier.cost
    taps += 1
    // Lucky drops only open once the player holds an item at the x2 tier's
    // OWN configured unlock rank (tier2UnlockRank - customizing that rank
    // moves this gate with it, they're never allowed to disagree). Before
    // that, every spend is a guaranteed normal roll; nextBonus() isn't
    // called at all pre-unlock so its deficit-round-robin scheduler starts
    // converging toward targetEv fresh from the first post-unlock spend,
    // not diluted by forced-normal spends that came before the gate opened.
    const bonus = maxRankHeld >= tier2UnlockRank ? nextBonus() : 0
    const spawnedRank = tier.normalRank + bonus
    const spawnCell = findSpawnCell(state, spawnedRank)
    state.itemAt[spawnCell[0]][spawnCell[1]] = spawnedRank
    log?.({ type: 'spend', tier: tier.cost, cell: spawnCell, rank: spawnedRank })
    recordRank(spawnedRank)
  }

  // The last action's result is observed before the run's leftovers are
  // settled - settling is a phase end, not something a checkpoint triggers.
  observeProgress()
  const twisterUncollectedAtEnd = uncollectedRewardItems(state, inventory, TWISTER_TYPE, rewardChainConfig)
  // The run's last phase ends here too - same leftover policy as the main->RC
  // handover above.
  settleLeftovers()
  log?.({ type: 'stop', reason: stopReason })

  // How much of the configured subsidy the player actually RECEIVED, versus
  // how much was sitting in boards/tiles the run never got to - found live
  // from an economist report that a 1500-DR-subsidy segment needing only
  // ~548 DR of player effort reported 1546 DR spent. Nothing was wrong with
  // drSpent (value in balanced to exactly 2048 with zero waste); the real
  // story was that the player finished the whole rank 1-12 chain on Board 1
  // alone, so Boards 2 and 3 - holding 1150 of that 1500 - never pushed in
  // and were never seen. Reporting only the bare "spent N DR" left that
  // invisible, so the number looked broken rather than informative. Counted
  // here, where the run's real reveal/board-push history is, rather than
  // re-derived by a caller that would have to guess at it.
  //
  // Main-chain subsidy ONLY - a mixed queue's reward entries (V2) have
  // their own, completely separate accounting (`collected`), never counted
  // as subsidy DR (section 4's "two separate accounting systems").
  const thisPhaseFrom = phase === 'main' ? startIndex : 0
  const thisPhaseDeliveredBase = phase === 'rc' ? subsidyDelivered - subsidyDeliveredAtTransition : subsidyDelivered
  const thisPhaseStats = snapshotPhaseStats(activeBoards, thisPhaseFrom, nextBoardIndex, thisPhaseDeliveredBase)
  const result = {
    reachedAt,
    tapsAt,
    drSpent,
    energySpent,
    stopReason,
    inventoryRemaining: inventory.length,
    collected,
    collectedBySource,
    // Energy still unspent when the run stopped (collected.energy is the
    // cumulative payout; energySpent + energyBalance always equals it).
    energyBalance,
    // What the leftover policy did NOT pay: the hand-collect value of every
    // reward item forfeited at a phase end (all zeros under 'collect').
    leftoverPolicy,
    leftoverForfeited,
    leftoverItemCount,
    // How many reward items the automatic player hand-collected below rank
    // 4 purely to free a board cell.
    spaceCollects,
    // ...and how many a tapping player (collectPolicy) took by hand.
    tapCollects,
    collectPolicy,
    mergeCountsByRank,
    // Merge-dropped reward items over the whole run: count, and raw value at
    // each item's own rank (see the tally in `log`).
    droppedItems,
    droppedRawValue,
    // Furthest main-chain progress each phase reached (0-1; rc is null when
    // the run never entered RC), and the checkpoint observation - null when
    // no checkpoint was asked for OR the run ended before reaching it.
    progress: progressByPhase,
    checkpoint,
    // The extra observation points (checkpointFractions), by fraction; a point
    // the run never reached is missing.
    checkpointsAt,
    twisterUncollectedAtEnd,
    phase,
    rcEntered: phase === 'rc',
    secondGrandPrizeAwarded: reachedAt[RC_MAX_RANK] !== undefined,
    // Backward-compatible top-level fields: describe the main phase always
    // (every existing caller - Total Subsidy, Effort target, SimulationReport
    // - reads these expecting the ORIGINAL single-phase meaning; they never
    // pass rcBoards, so mainPhaseSnapshot is always null for them and these
    // three lines are byte-identical to before this change).
    subsidyConfigured: (mainPhaseSnapshot ?? thisPhaseStats).subsidyConfigured,
    subsidyDelivered: (mainPhaseSnapshot ?? thisPhaseStats).subsidyDelivered,
    boardsReached: (mainPhaseSnapshot ?? thisPhaseStats).boardsReached,
    boardsTotal: (mainPhaseSnapshot ?? thisPhaseStats).boardsTotal,
    mainPhase: mainPhaseSnapshot,
    rcPhase: phase === 'rc' ? thisPhaseStats : null,
    // Per-phase collected-reward tallies (V2): when the run entered RC,
    // collectedMainPhase is the snapshot taken at the transition and
    // collectedRcPhase the remainder; a run that never entered RC reports
    // its whole `collected` as the main phase's own. Same split for the
    // tile/drop source buckets.
    // Same per-phase split for the merge-event counts (the drop generator
    // sizes its odds against how many eligible merges a phase produces).
    mergeCountsMainPhase: mergeCountsAtRcEntry ?? mergeCountsByRank,
    mergeCountsRcPhase: mergeCountsAtRcEntry ? subtractCollected(mergeCountsByRank, mergeCountsAtRcEntry) : null,
    collectedMainPhase: collectedAtRcEntry ? addCollected(collectedAtRcEntry, carriedAtRcEntry) : collected,
    collectedRcPhase: collectedAtRcEntry ? subtractCollected(collected, addCollected(collectedAtRcEntry, carriedAtRcEntry)) : null,
    // What the player held, unmerged and free, when Recompletion began (its
    // tap value; all zeros unless leftovers are collected).
    carriedIntoRc: carriedAtRcEntry,
    collectedBySourceMainPhase: collectedBySourceAtRcEntry
      ? { tile: addCollected(collectedBySourceAtRcEntry.tile, carriedBySourceAtRcEntry.tile), drop: addCollected(collectedBySourceAtRcEntry.drop, carriedBySourceAtRcEntry.drop) }
      : collectedBySource,
    collectedBySourceRcPhase: collectedBySourceAtRcEntry
      ? {
          tile: subtractCollected(collectedBySource.tile, addCollected(collectedBySourceAtRcEntry.tile, carriedBySourceAtRcEntry.tile)),
          drop: subtractCollected(collectedBySource.drop, addCollected(collectedBySourceAtRcEntry.drop, carriedBySourceAtRcEntry.drop)),
        }
      : null,
  }
  return trace ? { ...result, events } : result
}

function addCollected(a, b) {
  const out = {}
  for (const key of Object.keys(a)) out[key] = (a[key] ?? 0) + (b?.[key] ?? 0)
  return out
}

function subtractCollected(a, b) {
  const out = {}
  for (const key of Object.keys(a)) out[key] = (a[key] ?? 0) - (b?.[key] ?? 0)
  return out
}
