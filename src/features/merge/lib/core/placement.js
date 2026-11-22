import { computeDistances } from './boardDistance'
import { buildNoisyQueue } from './buildNoisyQueue'
import { generateCandidateInRange } from './generateCandidateInRange'
import { generateCandidateWithSmallRanks } from './generateCandidateWithSmallRanks'
import { computeOnboardingReserve } from './onboardingGoal'
import { simulatePlaythrough } from '../simulation/mergeSimulation'
import { valueOf } from './ranks'
import {
  FORCED_SEMI_CELL,
  FORCED_SEMI_RANK,
  applyForcedSemiCell,
  FORCED_HIGHEST_RANK_CELL,
  applyForcedHighestRankCell, generationTargetOf, isRecompletionBoard, RC_MIN_RANK_UNDER_TILES } from './board'
import { effectiveMinRank, effectiveMaxRank } from './rankWindow'
import { isMainItem, encodeReward, isTilePlaceableRewardType } from '../rewards/rewardChain'

// Mixed queues (V2): spread this board's configured reward items evenly
// through the main-chain blocked queue, so reward reveals arrive throughout
// play rather than bunched at one end. Deterministic (position i of R lands
// after slice (i+1)/(R+1) of the main queue) - reveal ORDER is part of the
// saved layout, same as the main queue's own noisy order.
function interleaveRewards(mainQueue, rewardValues) {
  if (rewardValues.length === 0) return mainQueue
  const out = [...mainQueue]
  rewardValues.forEach((value, i) => {
    // Early in the queue, one main-chain item between each (main, reward,
    // main, reward ...) - by explicit economist request: "we should try to
    // give the small rewards earlier in the blocked queue so the user will be
    // able to clear them faster". (They used to be spread evenly over the
    // whole queue.)
    // Spread evenly over the queue again. (For one round they were all put at
    // the start; that made the main chain open later and builds stopped
    // settling. The economist then asked for the match to be guaranteed by the
    // rank-6 drops instead - see tileTypes in smallRewardsWorkflow.js.)
    const at = Math.min(out.length, Math.floor(((i + 1) * mainQueue.length) / (rewardValues.length + 1)) + i)
    out.splice(at, 0, value)
  })
  return out
}

function fillableTiles(tiles) {
  const positions = []
  for (let r = 0; r < tiles.length; r++) {
    for (let c = 0; c < tiles[r].length; c++) {
      if (tiles[r][c] === 'blocked' || tiles[r][c] === 'semi') {
        positions.push({ row: r, col: c })
      }
    }
  }
  return positions
}

// Distance-to-player queue, closest tile first. Ties break row-major so
// results are stable; buildNoisyQueue supplies the actual local variance.
function orderByDistance(positions, distances) {
  return [...positions].sort((a, b) => {
    const da = distances[a.row][a.col]
    const db = distances[b.row][b.col]
    if (da !== db) return da - db
    if (a.row !== b.row) return a.row - b.row
    return a.col - b.col
  })
}

// Full generation pipeline for one board: generate items (exact sum to
// blockedValue), order blocked/semi tiles by distance-to-open-tile, run the
// ascending item list through the noisy queue, then split the result:
//
// - semi tiles are grid-fixed (visible from the start), so they keep a
//   {row, col, rank} placement.
// - blocked tiles have no fixed position — a blocked tile isn't visible to
//   the player until a merge next to it reveals it, and which physical tile
//   that happens to be is decided by the playthrough simulation, not here.
//   So blocked items become a position-independent ordered queue; only their
//   reveal ORDER is controlled at generation time (and can be hand-reordered
//   afterward) — this ordering doubles as the queue's default sequence.
//
// isFirstBoard scopes the small-rank guarantee, AND the "semi tiles are
// always rank 1" rule below, to board index 0 only.
//
// onboarding (board 0 only): { drBudget, targetRank } carves a reserved
// prefix off the blocked queue up front — sized to guarantee that, combined
// with the semi tiles' own fixed rank-1 items, drBudget reaches that rank on
// its own. The REST of blockedValue is generated exactly as before and fills
// in behind it. This works alongside the board's own subsidy rather than
// replacing it: the goal is just an early checkpoint, not a redesign of the
// whole board, and never adds tiles beyond what's already painted.
// THE OPENING RUN (Board 1 only) - by explicit economist feedback ("the
// first board should have a lot of low rank items with a start with the
// blocked queue with sequences of 1 and 2. user needs to feel a strong
// progression at the start").
//
// The first tiles Board 1 opens hand out a fixed run of the board's two
// lowest ranks, in threes: low, low, next - with a lowest rank of 1 that is
// 1, 1, 2, 1, 1, 2 ... Two 1s merge into a 2, which merges with the 2 into a
// 3: every three tiles opened is a rank the player did not pay for, and two
// runs make a rank 4. It is not shuffled by the noise.
//
// It is sized to the board: about 40% of the blocked tiles left for
// main-chain items (whole threes, at most 9 items), shortened until the rest
// of the board's DR still fits the remaining tiles both ways (enough DR to
// put an item under every one, and room for all of it at the max rank).
// Its DR comes out of the board's own total, so the exact sum is unchanged.
export const OPENING_RUN_SHARE = 0.4
export const OPENING_RUN_MAX = 9

export function openingRun(slots, budget, minRank, maxRank) {
  const low = minRank
  const next = Math.min(maxRank, minRank + 1)
  const pattern = [low, low, next]
  let length = Math.min(OPENING_RUN_MAX, Math.round((slots * OPENING_RUN_SHARE) / 3) * 3)
  if (length === 0 && slots >= 6) length = 3
  for (; length >= 3; length -= 3) {
    const run = Array.from({ length }, (_, i) => pattern[i % 3])
    const value = run.reduce((s, r) => s + valueOf(r), 0)
    const restSlots = slots - length
    const rest = budget - value
    if (rest >= restSlots * valueOf(minRank) && rest <= restSlots * valueOf(maxRank)) return run
  }
  return []
}

function generatePlacement(board, { isFirstBoard = false, noise = 0.15, onboarding = null, boardIndex = null, rcEvent = false, openingFirst = true } = {}) {
  // (A Recompletion board is generated from rank 3 up even when its own
  // lowest rank says less - board.js: boardMinRank.)
  const minRank = isRecompletionBoard(board) ? Math.max(board.minRank ?? 1, RC_MIN_RANK_UNDER_TILES) : board.minRank
  // The board's built allocation when it has one, else its budget.
  const blockedValue = generationTargetOf(board)
  // Board-position hard ceiling (Board 1 / Board 2 - see rankWindow.js),
  // applied in BOTH branches below (board 0's small-rank-plus-maxRank
  // guarantee and every later board's own range) - never loosens a
  // board's own configured maxRank, only ever tightens it.
  const maxRank = effectiveMaxRank(board.maxRank, boardIndex)
  // Self-contained regardless of caller: FORCED_SEMI_CELL (and, under
  // rcEvent, FORCED_HIGHEST_RANK_CELL too) are coerced here, not just
  // wherever the UI happens to persist board.tiles, so placeItems always
  // behaves correctly even against a board whose saved tiles predate these
  // rules or were never repainted.
  const tiles = isFirstBoard
    ? rcEvent
      ? applyForcedHighestRankCell(applyForcedSemiCell(board.tiles))
      : applyForcedSemiCell(board.tiles)
    : board.tiles
  const positions = fillableTiles(tiles)
  const distances = computeDistances(tiles)
  const orderedPositions = orderByDistance(positions, distances)
  const blockedTileCount = positions.filter((pos) => tiles[pos.row][pos.col] === 'blocked').length
  const semiTileCount = positions.length - blockedTileCount

  // Mixed queues (V2): this board's configured reward items each take one
  // blocked-tile queue slot (one item per tile), so the main-chain candidate
  // is generated for that many FEWER slots - its exact-sum-to-blockedValue
  // invariant is untouched (reward items contribute zero main-chain DR).
  // Clamped to the blocked tile count: an over-configured list can't
  // displace semi tiles or invent tiles - the excess is reported via
  // rewardItemsConfigured vs rewardItemsPlaced on the result, not silently
  // honored.
  // Twister DR is not tile-placeable (isTilePlaceableRewardType): an entry
  // naming it - from a hand-edited import, say - is dropped here, so no
  // generation path can ever put Twister under a starting tile.
  const configuredRewardItems = (board.rewardQueueItems ?? []).filter((it) => it && isTilePlaceableRewardType(it.type) && it.rank >= 1)
  const rewardValues = configuredRewardItems.slice(0, blockedTileCount).map((it) => encodeReward(it.type, it.rank))
  const rewardCount = rewardValues.length

  // Board 1's semi tiles always hold exactly rank 1, by explicit economist
  // request — visible and mergeable from turn zero, so keeping every one of
  // them the single smallest, simplest, most predictable bootstrap item
  // (rather than whatever the distance-ordered noisy queue, or an onboarding
  // goal's own fragmentation search, happened to land on) keeps the very
  // start of the game uniform. This is unconditional, independent of whether
  // an onboarding goal is even set - see computeOnboardingReserve's own
  // matching rule for the goal-search side of this. Scoped to board 0 only;
  // every other board keeps assigning semi ranks via the ordinary noisy
  // queue below.
  //
  // One fixed exception: FORCED_SEMI_CELL always holds rank 2 instead of
  // rank 1 (board.js's applyForcedSemiCell already guarantees that cell is
  // tile-type 'semi' by the time generation runs) — every other semi tile
  // keeps the plain rank-1 rule above. Unconditional, rcEvent or not — by
  // explicit economist request, rcEvent no longer touches this cell's rank
  // at all (an earlier version of rcEvent redirected this cell's own rank
  // to the highest-rank swap below; that's reverted).
  //
  // rcEvent (Recompletion-only toggle) instead forces a SEPARATE, adjacent
  // cell (FORCED_HIGHEST_RANK_CELL) to semi and gives IT whichever item
  // ends up the HIGHEST rank in the blocked-queue remainder, pulled out of
  // the queue and placed there instead of an ordinary rank 1 — right next
  // to FORCED_SEMI_CELL's own fixed rank 2, not replacing it. The swap
  // happens further down, AFTER the remainder is generated, since the
  // item's rank isn't known up front - until then this cell's placeholder
  // rank is 1 (an ordinary semi), which keeps semiValueTotal correct either
  // way: swapping two slots' values after generation doesn't change the
  // total sum, so the budget math never needs to know the swap is coming.
  // Economist-authored exact placements (board.js's forcedSemiRanks —
  // "insert a specific rank into a cell as semi blocked") - only honored at
  // a position that's CURRENTLY tile-type 'semi' (a stale entry from before
  // the cell got repainted open/blocked is silently ignored; BoardEditor.jsx
  // also prunes these eagerly on repaint, so this filter is a defensive
  // fallback, not the normal path). FORCED_SEMI_CELL/FORCED_HIGHEST_RANK_CELL
  // are deliberately excluded from this map - those two pre-existing rules
  // always win at their own fixed cells regardless of what's in
  // forcedSemiRanks; the editor itself disables forcing a rank there.
  const forcedSemiRankMap = new Map(
    (board.forcedSemiRanks ?? [])
      .filter((f) => tiles[f.row]?.[f.col] === 'semi')
      .filter((f) => !(f.row === FORCED_SEMI_CELL.row && f.col === FORCED_SEMI_CELL.col))
      .filter((f) => !(f.row === FORCED_HIGHEST_RANK_CELL.row && f.col === FORCED_HIGHEST_RANK_CELL.col))
      .map((f) => [`${f.row},${f.col}`, isRecompletionBoard(board) ? Math.max(f.rank, RC_MIN_RANK_UNDER_TILES, board.minRank ?? 1) : f.rank]),
  )

  // Reward items on semi-blocked tiles (V2) - board.rewardSemiItems,
  // {row, col, type, rank}. A semi tile is visible from the start, so its
  // reward item is in play immediately (and, like every reward item, never
  // stuck). Same rules as every other authored placement here: only honored
  // while that cell is actually tile-type 'semi'; never at the two fixed
  // anchor cells (FORCED_SEMI_CELL / FORCED_HIGHEST_RANK_CELL always win);
  // and a cell that already carries a forced MAIN rank keeps it - one item
  // per tile, the main-chain authoring takes precedence. A reward item
  // carries zero main-chain DR, so on board 0 it simply replaces that
  // tile's rank-1 bootstrap item (the remainder absorbs the 1 DR, keeping
  // the exact sum), and on later boards it takes its tile out of the shared
  // queue the same way a forced rank does.
  const rewardSemiMap = new Map(
    (board.rewardSemiItems ?? [])
      .filter((it) => it && isTilePlaceableRewardType(it.type) && it.rank >= 1 && tiles[it.row]?.[it.col] === 'semi')
      .filter((it) => !(it.row === FORCED_SEMI_CELL.row && it.col === FORCED_SEMI_CELL.col))
      .filter((it) => !(it.row === FORCED_HIGHEST_RANK_CELL.row && it.col === FORCED_HIGHEST_RANK_CELL.col))
      .filter((it) => !forcedSemiRankMap.has(`${it.row},${it.col}`))
      .map((it) => [`${it.row},${it.col}`, encodeReward(it.type, it.rank)]),
  )

  if (isFirstBoard) {
    const semiPositions = orderedPositions.filter((pos) => tiles[pos.row][pos.col] === 'semi')
    const blockedPositions = orderedPositions.filter((pos) => tiles[pos.row][pos.col] === 'blocked')
    // Priority at a given semi cell: FORCED_SEMI_CELL's own rank 2 > a
    // manual forcedSemiRanks override > the plain rank-1 default. A manual
    // override's value flows straight into semiValueTotal below just like
    // any other semi rank, so the remainder math downstream automatically
    // carves out exactly the right amount - no separate reservation step
    // needed on this branch (unlike the non-first-board one below, where
    // semis share one interleaved queue with blocked tiles instead of each
    // having an independent, value-based rank).
    // RECOMPLETION BOARDS HOLD NOTHING BELOW RANK 3 - semi-blocked cells
    // included (economist: "we had a rule for the RC boards that there cant be
    // ranks lower than 3"). On a Recompletion board the rank-1 starting items
    // and the fixed cell's rank 2 are raised to the board's lowest rank; so is
    // a pinned rank below it. (They were left at 1 and 2 when the rule was
    // first read as "under blocked tiles only"; the fixed rank 2 also pushed
    // Recompletion's Board 1 to 302 DR against its 300 limit.)
    const rcFloor = isRecompletionBoard(board) ? Math.max(RC_MIN_RANK_UNDER_TILES, minRank ?? 1) : 1
    const semiPlacements = semiPositions.map((pos) => {
      if (pos.row === FORCED_SEMI_CELL.row && pos.col === FORCED_SEMI_CELL.col) {
        return { row: pos.row, col: pos.col, rank: Math.max(FORCED_SEMI_RANK, rcFloor) }
      }
      const forced = forcedSemiRankMap.get(`${pos.row},${pos.col}`)
      const rewardHere = rewardSemiMap.get(`${pos.row},${pos.col}`)
      if (rewardHere != null && forced == null) return { row: pos.row, col: pos.col, rank: rewardHere }
      return { row: pos.row, col: pos.col, rank: Math.max(forced ?? 1, rcFloor) }
    })
    // Defensive guard, not a behavior change today: nothing currently writes
    // a reward-encoded rank (V2 - rewardChain.js) into forcedSemiRanks, so
    // every real p.rank here is a main item. Guarding anyway so a future
    // reward-semi-placement feature can't silently blow up this sum via
    // valueOf(a reward-encoded number) = an astronomical 2^1000-class value.
    const semiValueTotal = semiPlacements.reduce((s, p) => s + (isMainItem(p.rank) ? valueOf(p.rank) : 0), 0)

    let reservedBlockedItems = []
    let onboardingStatus = null
    if (onboarding?.drBudget != null && onboarding?.targetRank != null) {
      const reserve = computeOnboardingReserve(board, onboarding)
      if (!reserve) {
        onboardingStatus = { feasible: false, reason: 'unreachable' }
      } else if (reserve.reservedValue > blockedValue) {
        onboardingStatus = { feasible: false, reason: 'insufficient-subsidy', reservedValueNeeded: reserve.reservedValue }
      } else if (reserve.blockedItems.length > blockedTileCount) {
        const itemsNeeded = semiTileCount + reserve.blockedItems.length
        onboardingStatus = { feasible: false, reason: 'insufficient-tiles', itemsNeeded }
      } else {
        reservedBlockedItems = reserve.blockedItems
        onboardingStatus = { feasible: true, reservedValue: reserve.reservedValue, drSpentToTarget: reserve.drSpentToTarget }
      }
    }

    const remainderBlockedPositions = blockedPositions.slice(reservedBlockedItems.length)
    const reservedBlockedValueTotal = reservedBlockedItems.reduce((s, r) => s + valueOf(r), 0)
    const remainderTarget = blockedValue - semiValueTotal - reservedBlockedValueTotal

    // Reward items take their slots out of the REMAINDER, never the
    // onboarding reserve (whose front-loaded prefix is load-bearing for a
    // separate guarantee) - same priority the rcEvent swap already follows.
    const mainSlots = Math.max(0, remainderBlockedPositions.length - rewardCount)
    // The run is shortened, three items at a time, while the rest of the
    // board's DR cannot put an item under every remaining tile (the DR the
    // run gives back makes more low items than the tiles it frees).
    // (Not on Recompletion's Board 1: there is nothing to onboard there.)
    let opening = isRecompletionBoard(board) ? [] : openingRun(mainSlots, remainderTarget, minRank, maxRank)
    let remainderRanks
    for (;;) {
      const openingValue = opening.reduce((s, r) => s + valueOf(r), 0)
      remainderRanks = generateCandidateWithSmallRanks(remainderTarget - openingValue, mainSlots - opening.length, minRank, maxRank)
      if (opening.length === 0 || remainderRanks.length >= mainSlots - opening.length) break
      opening = opening.slice(0, opening.length - 3)
    }

    // rcEvent's swap: trade FORCED_HIGHEST_RANK_CELL's rank-1 placeholder
    // for the single highest-rank item in the remainder (never the
    // onboarding reserve - that reserve's own items are load-bearing for a
    // separate guarantee and aren't touched here). FORCED_SEMI_CELL's own
    // rank 2 is never involved - it sits right next door, untouched. A real
    // swap, not a one-way move: the remainder slot that gave up its
    // high-rank item gets the placeholder's own rank 1 in return, so the
    // exact-sum invariant holds without re-deriving anything above -
    // replacing (not removing) that slot's value keeps remainder item count
    // unchanged too. Getting this wrong (removing the item with no
    // replacement) silently drops 1 DR from the board's total - caught live
    // by the sum-vs-target check.
    if (rcEvent && remainderRanks.length > 0) {
      const highestRankPlacement = semiPlacements.find(
        (p) => p.row === FORCED_HIGHEST_RANK_CELL.row && p.col === FORCED_HIGHEST_RANK_CELL.col,
      )
      if (highestRankPlacement) {
        const highestRank = Math.max(...remainderRanks)
        remainderRanks[remainderRanks.indexOf(highestRank)] = 1
        highestRankPlacement.rank = highestRank
      }
    }

    // generateCandidateWithSmallRanks is guaranteed to return at most
    // remainderBlockedPositions.length items (see its own comment) — never
    // more, so every entry here always has a real tile to land on. That
    // wasn't always true: an earlier version could return MORE items than
    // the tile budget when a low maxRank forced extra splitting, and this
    // queue's sort-then-index-by-position assignment silently kept only the
    // smallest entries and discarded the (usually far more valuable) rest —
    // found live, stranding the majority of a board's configured DR with no
    // clear explanation in the UI. Item count can still legitimately come in
    // UNDER the tile budget (a small target can't fill every tile with a
    // real item), which is fine and already surfaced by the "Items vs.
    // tiles" check below.
    const blockedQueueRemainder = buildNoisyQueue([...remainderRanks].sort((a, b) => a - b), noise)
    // Rewards interleave into the remainder only - the onboarding reserve
    // stays a contiguous, untouched prefix at the front.
    // The opening run leads. With a starting goal set, the goal's own
    // reserved items normally follow it; `openingFirst: false` puts them
    // ahead instead (placeItems falls back to that if the goal does not hold
    // with the run in front).
    const rest = interleaveRewards(blockedQueueRemainder, rewardValues)
    const blockedQueue = openingFirst ? [...opening, ...reservedBlockedItems, ...rest] : [...reservedBlockedItems, ...opening, ...rest]
    const placedRanks = [...semiPlacements.map((p) => p.rank), ...blockedQueue]

    // Board 0 only guarantees small ranks (1-3) plus maxRank, not minRank, so
    // its variety check is max-only.
    const isRange = minRank < maxRank
    const hasRangeVariety = !isRange ? null : placedRanks.includes(maxRank)

    return {
      semiPlacements,
      blockedQueue,
      itemCount: placedRanks.length,
      tileCount: positions.length,
      sum: placedRanks.reduce((s, r) => s + (isMainItem(r) ? valueOf(r) : 0), 0),
      hasRangeVariety,
      onboardingStatus,
      rewardItemsConfigured: configuredRewardItems.length,
      rewardItemsPlaced: rewardCount,
      rewardSemiItemsPlaced: rewardSemiMap.size,
    }
  }

  // Board-position hard floors (Board 2 / Board 3 — see rankWindow.js) apply
  // here, never in the isFirstBoard branch above: those two positions are
  // never board 0, so there's no overlap with the small-rank guarantee or
  // the rank-1 semi rule.
  const minRankFloor = effectiveMinRank(minRank, boardIndex)

  // A manual forcedSemiRanks override needs different treatment on this
  // branch than on board 0's above: here every semi AND blocked tile shares
  // ONE interleaved distance-ordered queue (there's no independent,
  // value-based rank per semi the way board 0 has), so a forced cell's
  // value has to be reserved out of the target up front - same "reserve,
  // then decompose the remainder" shape as the onboarding reserve/board 0's
  // own reservations - and its own slot skipped entirely when the generated
  // queue gets walked onto positions below, rather than consumed like an
  // ordinary queue entry.
  const forcedRankValues = [...forcedSemiRankMap.values()]
  const forcedValueTotal = forcedRankValues.reduce((s, r) => s + valueOf(r), 0)
  // Reward items (V2) each take one blocked-tile slot out of the shared
  // interleaved queue - the main candidate is generated for that many fewer
  // slots. Any resulting item-count undershoot lands on the FARTHEST tiles
  // (end of the distance order), which skews toward blocked tiles - exactly
  // the slots the interleaved rewards then fill in the queue below.
  const remainderDesired = positions.length - forcedSemiRankMap.size - rewardSemiMap.size - rewardCount
  // If a forced entry already sits at exactly minRankFloor or maxRank, the
  // "min & max both present" variety guarantee doesn't need the REMAINDER to
  // also reserve that same rank - it's already on the board. Telling
  // generateCandidateInRange to skip that side matters because the
  // reservation it self runs against an ALREADY-reduced budget (the forced
  // item's own value/slot came out of target/remainderDesired above) -
  // without this, it could easily fail to reserve BOTH sides where it might
  // have succeeded on just the one that's still genuinely needed, found live
  // from an economist report: forcing a semi tile to maxRank, then seeing
  // "min & max both present" fail anyway, even though maxRank really was on
  // the board (via the forced cell) - the reservation was wastefully still
  // trying to carve out a SECOND redundant maxRank item from the shrunken
  // remainder, using up budget the min-side reservation needed instead.
  const ranks = generateCandidateInRange(blockedValue - forcedValueTotal, remainderDesired, minRankFloor, maxRank, {
    skipMinReserve: forcedRankValues.includes(minRankFloor),
    skipMaxReserve: forcedRankValues.includes(maxRank),
  })
  const queue = buildNoisyQueue(ranks, noise)

  const semiPlacements = []
  const blockedRanks = []
  const placedRanks = []
  let queueIndex = 0
  orderedPositions.forEach((pos) => {
    // A forced main rank or a semi reward item takes this tile directly and
    // leaves the generated queue untouched.
    const forced = forcedSemiRankMap.get(`${pos.row},${pos.col}`) ?? rewardSemiMap.get(`${pos.row},${pos.col}`)
    const rank = forced ?? queue[queueIndex]
    if (forced == null) queueIndex += 1 // only consume a generated-queue slot for a non-forced position
    if (rank == null) return
    placedRanks.push(rank)
    if (tiles[pos.row][pos.col] === 'semi') {
      semiPlacements.push({ row: pos.row, col: pos.col, rank })
    } else {
      blockedRanks.push(rank)
    }
  })

  // The blocked queue has no grid position of its own, so its presentation
  // order shouldn't just inherit whatever it happened to interleave with in
  // the distance ordering above — re-noise it on its own so it reads as
  // ascending-with-visible-local-variation rather than a flat ramp.
  const blockedQueue = interleaveRewards(buildNoisyQueue([...blockedRanks].sort((a, b) => a - b), noise), rewardValues)
  placedRanks.push(...rewardValues)

  const isRange = minRankFloor < maxRank
  const hasMax = placedRanks.includes(maxRank)
  const hasRangeVariety = !isRange ? null : hasMax && placedRanks.includes(minRankFloor)

  return {
    semiPlacements,
    blockedQueue,
    itemCount: placedRanks.length,
    tileCount: positions.length,
    sum: placedRanks.reduce((s, r) => s + (isMainItem(r) ? valueOf(r) : 0), 0),
    hasRangeVariety,
    onboardingStatus: null,
    rewardItemsConfigured: configuredRewardItems.length,
    rewardItemsPlaced: rewardCount,
    rewardSemiItemsPlaced: rewardSemiMap.size,
  }
}

// generatePlacement's onboarding guarantee is checked in ISOLATION
// (computeOnboardingReserve tests the reserve alone, with every non-reserved
// semi tile treated as empty rather than pre-seeded by the remainder's own
// generation) - two things can make that guarantee not actually hold on the
// real, combined board, so both get verified here against the real thing
// rather than trusted blindly, falling back to plain (no-onboarding)
// generation either way:
//
// 1. Splitting the blocked queue into two independently-decomposed pieces
//    (reserve + remainder) can need more total items than the tile budget
//    has, even on a board where generating the whole value as one piece
//    would fit fine (splitting a binary number rarely reduces, and often
//    inflates, total set bits) - the remainder's own generation then
//    silently truncates to fit, quietly losing part of blockedValue's sum.
// 2. The isolated check reveals the reserve's own items in isolation; on the
//    real board, a single merge can reveal more than one locked neighbor at
//    once (revealNeighbors), which can pull a remainder blocked item off the
//    front of the real, longer queue earlier than the isolated check ever
//    saw - the reserve's isolated reveal timing doesn't always carry over
//    unchanged to the real board.
export function placeItems(board, options = {}) {
  const { isFirstBoard = false, noise = 0.15, boardIndex = null, rcEvent = false } = options
  // A Recompletion board never has a starting goal (board.js: isRecompletionBoard).
  const onboarding = isRecompletionBoard(board) ? null : (options.onboarding ?? null)
  // Board 1's opening run leads the queue. If the starting goal does not hold
  // on the real board that way, the goal's own reserved items lead instead;
  // only if that fails too is the goal reported as not met.
  let failure = null
  for (const openingFirst of [true, false]) {
    const result = generatePlacement(board, { isFirstBoard, noise, onboarding, boardIndex, rcEvent, openingFirst })
    if (!onboarding || !result.onboardingStatus?.feasible) return result

    if (result.sum !== generationTargetOf(board)) {
      failure = failure ?? 'tile-budget-too-tight'
      continue
    }
    const real = simulatePlaythrough(
      [{ ...board, semiPlacements: result.semiPlacements, blockedQueue: result.blockedQueue }],
      { drBudget: onboarding.drBudget },
    )
    const drSpentToTarget = real.reachedAt[onboarding.targetRank]
    if (drSpentToTarget === undefined) {
      failure = 'blocked-by-other-subsidy'
      continue
    }
    return { ...result, onboardingStatus: { ...result.onboardingStatus, drSpentToTarget } }
  }
  const fallback = generatePlacement(board, { isFirstBoard, noise, onboarding: null, boardIndex, rcEvent })
  return { ...fallback, onboardingStatus: { feasible: false, reason: failure } }
}
