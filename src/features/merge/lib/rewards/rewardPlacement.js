// Mixed-queue reward PLACEMENT proposer (V2) - the tile-source half of the
// Small Rewards workflow. Given how many reward SOURCE UNITS each resource
// should receive from tiles (a rank-r item is 2^(r-1) units - see
// rewardEconomy.js's payoutForUnits for why units, not prizes, are the
// currency here), proposes which reward items go under which board's
// blocked tiles (board.rewardQueueItems) and, when those run out, on which
// semi-blocked tiles (board.rewardSemiItems), within real capacity limits,
// and regenerates each affected board through the real placement pipeline so
// the result is an actual, playable layout.
//
// Tile items no longer have to arrive as complete rank-4 sets: a tile item
// merges with any same-type same-rank reward item, including one a merge
// drop produced, so the tile side can contribute any whole number of units
// and the two sources complete rank-4 collects TOGETHER. Units are packed
// into as few tiles as possible (rank 3 = 4 units, rank 2 = 2, rank 1 = 1).
import { REWARD_TYPES, REWARD_MAX_RANK, isMainItem } from './rewardChain'
import { effectiveMinRank, effectiveMaxRank, minMainItemCount } from '../core/rankWindow'
import { regenerateBoard } from '../simulation/effortTargeting'
import { applyForcedSemiCell, applyForcedHighestRankCell, FORCED_SEMI_CELL, FORCED_HIGHEST_RANK_CELL } from '../core/board'

// The highest rank a reward item can sit on the board at (rank 4 collects
// the instant it forms, so it is never placeable).
export const REWARD_TOP_PLACEABLE_RANK = REWARD_MAX_RANK - 1

const unitsOf = (rank) => 2 ** (rank - 1)

// PINS vs AUTO items. An entry the economist added by hand is a pin: every
// solve preserves it untouched and counts its units toward the tile-side
// target before proposing anything. An entry a previous solve placed carries
// `auto: true` and is REPLACED by the next solve - so re-generating after an
// Apply is idempotent (found live: an earlier version stacked a second set
// on top and doubled the payout), and lowering a target actually shrinks the
// placements instead of leaving the old ones behind. Applies identically to
// queue items and semi-tile items.
export function pinnedRewardItems(board) {
  return (board.rewardQueueItems ?? []).filter((it) => it && !it.auto)
}

export function pinnedRewardSemiItems(board) {
  return (board.rewardSemiItems ?? []).filter((it) => it && !it.auto)
}

function tilesFor(board, boardIndex) {
  if (boardIndex !== 0) return board.tiles
  const withSemi = applyForcedSemiCell(board.tiles)
  return board.rcEvent ? applyForcedHighestRankCell(withSemi) : withSemi
}

// How many blocked-queue slots of `board` are genuinely free for reward
// items: blocked tiles minus what the main chain's exact-sum decomposition
// minimally needs (minMainItemCount - the real combinatorial floor, not a
// naive capacity bound), minus slots already claimed by pinned reward items.
// Conservative on board 0 when an onboarding goal is set (the reserve
// fragments value into MORE than the minimal item count); the post-proposal
// regeneration + the board's own Placement checks catch any residual gap
// honestly rather than this formula pretending to more precision than it
// has.
// BOARD 1 CARRIES FEW REWARD ITEMS - by explicit economist feedback ("the
// first board is filled with small rewards. it cant be that aggressive").
// Board 1 is where the player has to feel progress, so its tiles belong to
// low-rank main-chain items; generated reward items may take at most this
// share of its blocked tiles (at least one), and none of its semi-blocked
// cells. A reward item the economist pins by hand is not limited by this.
export const FIRST_BOARD_REWARD_SHARE = 0.15

export function rewardSlotCapacity(board, boardIndex) {
  const tiles = tilesFor(board, boardIndex)
  const blockedTileCount = tiles.flat().filter((s) => s === 'blocked').length
  const minRank = effectiveMinRank(board.minRank, boardIndex)
  const maxRank = effectiveMaxRank(board.maxRank, boardIndex)
  // What the BLOCKED tiles have to carry. On board 1 the semi tiles hold
  // fixed main values of their own (rank 1 each, rank 2 at the forced cell,
  // or an economist-forced rank), so only the remainder is the blocked
  // tiles' job - and that remainder's own decomposition is what sets the
  // floor (found by the verification below: sizing against the whole
  // blockedValue let rewards crowd the remainder out).
  let blockedShare = board.blockedValue
  if (boardIndex === 0) {
    const forced = new Map((board.forcedSemiRanks ?? []).map((f) => [`${f.row},${f.col}`, f.rank]))
    const rewardSemi = new Set((board.rewardSemiItems ?? []).map((it) => `${it.row},${it.col}`))
    for (let r = 0; r < tiles.length; r++) {
      for (let c = 0; c < tiles[r].length; c++) {
        if (tiles[r][c] !== 'semi') continue
        if (r === FORCED_SEMI_CELL.row && c === FORCED_SEMI_CELL.col) blockedShare -= 2
        else if (forced.has(`${r},${c}`)) blockedShare -= 2 ** (forced.get(`${r},${c}`) - 1)
        else if (!rewardSemi.has(`${r},${c}`)) blockedShare -= 1
      }
    }
  }
  const mainNeeded = minMainItemCount(Math.max(0, blockedShare), minRank, maxRank)
  const free = Math.max(0, blockedTileCount - mainNeeded - pinnedRewardItems(board).length)
  if (boardIndex !== 0) return free
  return Math.min(free, Math.max(1, Math.floor(blockedTileCount * FIRST_BOARD_REWARD_SHARE)))
}

// Main-chain DR a generated board actually carries (semis + queue).
function mainSumOf(board) {
  return (
    (board.semiPlacements ?? []).reduce((s, p) => s + (isMainItem(p.rank) ? 2 ** (p.rank - 1) : 0), 0) +
    (board.blockedQueue ?? []).reduce((s, r) => s + (isMainItem(r) ? 2 ** (r - 1) : 0), 0)
  )
}

// The semi-blocked cells of `board` a reward item may be placed on, in
// row-major order: never the two fixed anchor cells, never a cell carrying
// an economist-forced main rank, never one already holding a pinned reward
// item (one item per tile). Board 0 additionally offers NONE while an
// onboarding goal is set - its semi tiles are the rank-1 bootstrap items
// that goal's reserve was sized against, so they stay main-chain. On later
// boards a semi tile leaves the shared queue exactly like a forced rank, so
// the main chain must still fit in what remains - `maxUsable` caps that.
export function rewardSemiSlots(board, boardIndex) {
  if (boardIndex === 0 && board.onboardingDrBudget != null && board.onboardingTargetRank != null) return { cells: [], maxUsable: 0 }
  const tiles = tilesFor(board, boardIndex)
  const forced = new Set((board.forcedSemiRanks ?? []).map((f) => `${f.row},${f.col}`))
  const pinned = new Set(pinnedRewardSemiItems(board).map((it) => `${it.row},${it.col}`))
  const cells = []
  for (let r = 0; r < tiles.length; r++) {
    for (let c = 0; c < tiles[r].length; c++) {
      if (tiles[r][c] !== 'semi') continue
      if (r === FORCED_SEMI_CELL.row && c === FORCED_SEMI_CELL.col) continue
      if (r === FORCED_HIGHEST_RANK_CELL.row && c === FORCED_HIGHEST_RANK_CELL.col) continue
      if (forced.has(`${r},${c}`) || pinned.has(`${r},${c}`)) continue
      cells.push({ row: r, col: c })
    }
  }
  // Total tiles the main chain still needs somewhere on this board, after
  // every blocked slot a reward queue item could take is taken.
  const allTiles = tiles.flat().filter((s) => s === 'blocked' || s === 'semi').length
  const minRank = effectiveMinRank(board.minRank, boardIndex)
  const maxRank = effectiveMaxRank(board.maxRank, boardIndex)
  const mainNeeded = minMainItemCount(board.blockedValue, minRank, maxRank)
  const claimed = pinnedRewardItems(board).length + pinnedRewardSemiItems(board).length + forced.size
  const spare = Math.max(0, allTiles - mainNeeded - claimed - rewardSlotCapacity(board, boardIndex))
  // Board 1's semi-blocked cells are its starting items, visible from the
  // first second: the BUILD never puts a reward item there (maxUsable 0).
  // The cells are still listed, so the economist can pin one by hand.
  return { cells, maxUsable: boardIndex === 0 ? 0 : Math.min(cells.length, spare) }
}

// Units a list of reward items contributes, per resource.
export function rewardUnitsByType(items) {
  const out = Object.fromEntries(REWARD_TYPES.map((t) => [t, 0]))
  for (const it of items) if (it && out[it.type] != null && it.rank <= REWARD_TOP_PLACEABLE_RANK) out[it.type] += unitsOf(it.rank)
  return out
}

// WHICH REWARD RANKS MAY SIT UNDER A BOARD'S TILES - by explicit economist
// rule ("i want that only board 2 can hold small rewards bigger than rank
// 1"):
//   Board 2            rank 1 or 2 (a chain: 1, then 2)
//   every other board  rank 1 only
// Board 1 holds no generated reward at all in a list of two or more boards
// (see proposeRewardPlacements). The rank above 1 is rank 2, the most Board 2
// was ever allowed ("in board 2, 1 or 2, mostly 1"); rank 3 no longer sits
// under any tile. (Before this the middle boards held 1-2 and the last board
// 1-3.) The pattern is the chain a reward's items on that board follow; it
// repeats.
export function rewardRankPattern(boardIndex) {
  return boardIndex === 1 ? [1, 2] : [1]
}

export function allowedRewardRanks(boardIndex, boardCount) {
  return [...new Set(rewardRankPattern(boardIndex, boardCount))].sort((x, y) => x - y)
}

const onboardingHolds = (board) => board?.onboardingStatus?.feasible !== false
// Tiles the generated contents leave without an item (they never open).
const emptyTilesOf = (board) => Math.max(0, board.tiles.flat().filter((t) => t === 'blocked' || t === 'semi').length - (board.semiPlacements?.length ?? 0) - (board.blockedQueue?.length ?? 0))

// Deterministic proposal. `tileUnits[type]` is the TOTAL tile-side units
// wanted for that resource, pins included: pinned units are counted first
// and only the remainder is proposed. Reward tiles are handed out one board
// at a time in rounds, the last board first (it may hold the biggest items,
// so the units need the fewest tiles there) and Board 1 last, each tile
// taking the rank its board allows (rewardRankPattern). Every tile goes to
// the resource with the largest share still to place, so a shortage of tiles
// thins every resource rather than starving one. Blocked-queue slots are
// used before semi-blocked cells. Whatever doesn't fit is reported in
// `perResource[type].unitsUnplaced` - the caller decides what to do with it.
//
// Returns { boards (regenerated), additionsByBoard, semiAdditionsByBoard,
// perResource, findings } and never writes to the caller's board objects.
//
// PLACED SO THAT THEY CAN BE OPENED (by explicit economist request: "we
// should try to put the items that are semi blocked in a way that the user
// will be able to open them"). A reward item under a tile is semi-blocked
// when its tile opens, and is freed only by merging a FREE item of the same
// reward and rank into it - which makes a free item one rank up. Free reward
// items come from merge drops, mostly at rank 1. So on each board a reward's
// items form a CHAIN that starts at rank 1 (1, then 2, then 3, as far as the
// board allows): one rank-1 drop of that reward opens the first, the item
// that makes opens the next, and so on - one drop opens the whole chain. A
// rank 2 with no rank 1 of its reward on the board would need two drops
// merged first, and two rank 1s need a drop each. Further:
//   - a reward that never drops gets nothing under tiles (`droppingTypes`):
//     its item could never be opened and its board would wait for ever;
//   - Board 1 and the middle boards take one reward after another (all rank
//     1s first - "mostly rank 1"); the last board finishes a chain before it
//     starts the next (fewest drops needed for the most units);
//   - `maxAutoByBoard` caps the generated reward items per board - the
//     caller lowers it for a board whose items held the next board back.
export function proposeRewardPlacements(boards, { tileUnits, noise = 0.15, allowSemi = true, droppingTypes = null, earlyTypes = null, maxAutoByBoard = null } = {}) {
  const findings = []
  const pinnedUnits = rewardUnitsByType(boards.flatMap((b) => [...pinnedRewardItems(b), ...pinnedRewardSemiItems(b)]))

  const perResource = {}
  const remaining = {}
  const total = {}
  for (const type of REWARD_TYPES) {
    const unitsWanted = Math.max(0, Math.round(tileUnits?.[type] ?? 0))
    const remainder = Math.max(0, unitsWanted - pinnedUnits[type])
    perResource[type] = { unitsWanted, pinnedUnits: pinnedUnits[type], unitsPlaced: 0, unitsUnplaced: 0 }
    remaining[type] = remainder
    total[type] = remainder
    if (droppingTypes && !droppingTypes.includes(type) && remainder > 0) {
      perResource[type].unitsUnplaced += remainder
      remaining[type] = 0
      total[type] = 0
      findings.push(`${type}: an item under a tile is freed by a matching item dropped from a merge, and none of this reward was asked of merge drops - so none was placed under tiles (it could never be opened, and its board would wait for it).`)
    }
    if (pinnedUnits[type] > unitsWanted) {
      findings.push(
        `${type}: your pinned reward items already carry ${pinnedUnits[type]} source units, above the tile-side share (${unitsWanted}) - pins are preserved, so remove some under "Reward items under tiles" to come down.`,
      )
    }
  }

  const queueRemaining = boards.map((b, i) => rewardSlotCapacity(b, i))
  const semiSlots = boards.map((b, i) => (allowSemi ? rewardSemiSlots(b, i) : { cells: [], maxUsable: 0 }))
  const semiUsed = boards.map(() => 0)
  const additionsByBoard = boards.map(() => [])
  const semiAdditionsByBoard = boards.map(() => [])
  // The highest rank a board's reward chain may reach, and how many items
  // of each reward the board holds so far (the next one continues its chain).
  const chainTop = boards.map((_, i) => Math.max(...rewardRankPattern(i, boards.length)))
  const heldByBoard = boards.map(() => ({}))
  const nextRank = (i, type) => ((heldByBoard[i][type] ?? 0) % chainTop[i]) + 1
  const tilesTaken = boards.map(() => 0)
  const order = boards.map((_, i) => i).reverse()
  const unitsLeft = () => REWARD_TYPES.reduce((sum, t) => sum + remaining[t], 0)

  let placedInRound = true
  while (unitsLeft() > 0 && placedInRound) {
    placedInRound = false
    for (const i of order) {
      if (unitsLeft() <= 0) break
      // Board 1 holds no small reward at all (by explicit economist decision,
      // after playing it: "im stuck on the first board ... the first board
      // doesnt hold any small rewards on it, and we will have some in the 2nd
      // and 3rd"). A reward item there is semi-blocked until a matching item
      // drops, and at the start of the game nothing drops yet. A list with
      // one board only has nowhere else to put them, so it is left as it was.
      // Reward items pinned by hand are not touched.
      if (i === 0 && boards.length > 1) continue
      if (tilesTaken[i] >= (maxAutoByBoard?.[i] ?? Infinity)) continue
      const useQueue = queueRemaining[i] >= 1
      const useSemi = !useQueue && semiUsed[i] < semiSlots[i].maxUsable
      if (!useQueue && !useSemi) continue
      // Rewards whose chain on this board can take its next item.
      // The next item of a reward continues its chain; when too few units are
      // left for that rank, a new chain starts at rank 1 instead.
      const rankFor = (t) => (remaining[t] >= unitsOf(nextRank(i, t)) ? nextRank(i, t) : remaining[t] >= 1 ? 1 : 0)
      // earlyTypes: the rewards that may sit on a board BEFORE the last. The
      // last board takes any reward that drops: it holds nobody back, so it
      // is where a reward that is still short is topped up (economist: "maybe
      // if we are missing some small rewards, we can try to rebuild the last
      // board with adding small rewards tiles into it").
      const onLast = boards.length > 1 && i === boards.length - 1
      const fits = REWARD_TYPES.filter((t) => rankFor(t) > 0 && (onLast || !earlyTypes || earlyTypes.includes(t)))
      if (fits.length === 0) continue
      const lastBoard = boards.length > 1 && i === boards.length - 1
      const midChain = (t) => (heldByBoard[i][t] ?? 0) % chainTop[i] !== 0
      const byShare = (x, y) => remaining[y] / total[y] - remaining[x] / total[x] || (x < y ? -1 : 1)
      const type = lastBoard
        ? fits.sort((x, y) => Number(midChain(y)) - Number(midChain(x)) || byShare(x, y))[0]
        : fits.sort((x, y) => (heldByBoard[i][x] ?? 0) - (heldByBoard[i][y] ?? 0) || byShare(x, y))[0]
      const rank = rankFor(type)
      heldByBoard[i][type] = rank % chainTop[i]
      if (useQueue) {
        additionsByBoard[i].push({ type, rank, auto: true })
        queueRemaining[i] -= 1
      } else {
        const cell = semiSlots[i].cells[semiUsed[i]]
        semiAdditionsByBoard[i].push({ row: cell.row, col: cell.col, type, rank, auto: true })
        semiUsed[i] += 1
      }
      tilesTaken[i] += 1
      remaining[type] -= unitsOf(rank)
      perResource[type].unitsPlaced += unitsOf(rank)
      placedInRound = true
    }
  }
  for (const type of REWARD_TYPES) perResource[type].unitsUnplaced += remaining[type]

  const totalUnplaced = REWARD_TYPES.reduce((s, t) => s + perResource[t].unitsUnplaced, 0)
  if (totalUnplaced > 0) {
    const slots = boards.reduce((s, b, i) => s + rewardSlotCapacity(b, i), 0) + semiSlots.reduce((s, x) => s + x.maxUsable, 0)
    findings.push(
      `Only ${slots} tile slot${slots === 1 ? '' : 's'} are free for reward items after the main chain's own items, so ${totalUnplaced} source unit${totalUnplaced === 1 ? '' : 's'} of the tile-side share did not fit. Add blocked or semi-blocked tiles, raise max rank (fewer main items), or shift the source split toward merge drops.`,
    )
  }

  // A board is only regenerated when its reward items actually change - it
  // gains proposals, or it carried a previous solve's auto items that this
  // solve is replacing (possibly with nothing).
  //
  // The capacity formulas above are estimates; THIS is the guarantee that a
  // reward item never costs the main chain any of its DR: each regenerated
  // board's main-chain sum is checked against the same board regenerated
  // with only its pins, and proposals are taken back off (semi ones first,
  // then queue ones, most recently placed first) until the main chain
  // carries EXACTLY what it did without them - too few tiles can push the
  // generator either way (a shortfall, or an overshoot when it has to fill
  // its last tile at max rank), so the test is equality, not ">=". Whatever is taken back is
  // reported as unplaced, never silently dropped.
  let takenBack = 0
  const nextBoards = boards.map((board, i) => {
    const pins = pinnedRewardItems(board)
    const semiPins = pinnedRewardSemiItems(board)
    const hadAuto = (board.rewardQueueItems ?? []).length !== pins.length || (board.rewardSemiItems ?? []).length !== semiPins.length
    if (additionsByBoard[i].length === 0 && semiAdditionsByBoard[i].length === 0 && !hadAuto) return board
    const build = () =>
      regenerateBoard({ ...board, rewardQueueItems: [...pins, ...additionsByBoard[i]], rewardSemiItems: [...semiPins, ...semiAdditionsByBoard[i]] }, i, board.blockedValue, noise)
    if (additionsByBoard[i].length === 0 && semiAdditionsByBoard[i].length === 0) return build()
    // ...and a reward item never costs Board 1 its starting goal either: if
    // the goal holds without the proposals and not with them, they come off.
    const plain = regenerateBoard({ ...board, rewardQueueItems: pins, rewardSemiItems: semiPins }, i, board.blockedValue, noise)
    const baseline = mainSumOf(plain)
    let next = build()
    while ((mainSumOf(next) !== baseline || (onboardingHolds(plain) && !onboardingHolds(next)) || emptyTilesOf(next) > emptyTilesOf(plain)) && additionsByBoard[i].length + semiAdditionsByBoard[i].length > 0) {
      const removed = semiAdditionsByBoard[i].length > 0 ? semiAdditionsByBoard[i].pop() : additionsByBoard[i].pop()
      perResource[removed.type].unitsPlaced -= unitsOf(removed.rank)
      perResource[removed.type].unitsUnplaced += unitsOf(removed.rank)
      takenBack += 1
      next = build()
    }
    return next
  })
  if (takenBack > 0) {
    findings.push(
      `${takenBack} proposed reward item${takenBack === 1 ? ' was' : 's were'} taken back because the main chain needed that tile to keep its exact DR or Board 1's starting goal - the tile-side share came up short by that much.`,
    )
  }

  return { boards: nextBoards, additionsByBoard, semiAdditionsByBoard, perResource, findings }
}
