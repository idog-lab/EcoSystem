// Generates a board aimed at a target difficulty bucket. Doesn't invert the
// scoring formula analytically (that would couple this file to the exact
// weights in diamondStats.js and break the moment those get tuned) - instead
// it seeds a handful of random placements, then hill-climbs random nudges,
// keeping any nudge that doesn't move further from the target score. Always
// returns its best-effort board plus what it actually achieved; never claims
// an exact hit. Math.random() is fine here - no determinism constraint
// anywhere in this codebase (luckyDrop.js/buildNoisyQueue.js already use it).
//
// Two extra knobs, both optional/non-critical ("if not given, generate
// whatever"): targetFillPercent (gem coverage as a % of the board) and
// targetBlockedTiles (a total blocked-tile COUNT, gem-covered or not).
// Pinning either one removes it as a hill-climb degree of freedom - the
// difficulty target then only gets chased via whichever dimension is still
// free. targetBlockedTiles is also the only path that can produce a blocked
// tile that isn't under a gem: the difficulty formula only credits blocked
// GEM cells, so the unpinned hill-climb below has no reason to ever block an
// empty tile on its own.

import { createDiamondBoard, canPlaceGem, placeGem, removePlacement, toggleBlocked, setBlocked, occupiedCells } from './diamondBoard'
import { footprint } from './gem'
import { computeDifficulty, BUCKET_TARGET_SCORE } from './diamondStats'

const SEED_ATTEMPTS = 10
const PLACE_TRIES_PER_ATTEMPT = 30
const FILL_TARGET_ATTEMPTS = 500
const HILL_CLIMB_ITERATIONS = 200
const CLOSE_ENOUGH = 4

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function shuffledCellList(rows, cols) {
  const cells = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells.push([r, c])
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[cells[i], cells[j]] = [cells[j], cells[i]]
  }
  return cells
}

function tryAddRandomGem(board, gems, gemsById) {
  for (let i = 0; i < PLACE_TRIES_PER_ATTEMPT; i++) {
    const gem = pick(gems)
    const rotated = Math.random() < 0.5
    const { rows: footRows, cols: footCols } = footprint(gem, rotated)
    if (footRows > board.rows || footCols > board.cols) continue
    const anchorRow = Math.floor(Math.random() * (board.rows - footRows + 1))
    const anchorCol = Math.floor(Math.random() * (board.cols - footCols + 1))
    if (canPlaceGem(board, gem, anchorRow, anchorCol, rotated, gemsById)) {
      return placeGem(board, gem, anchorRow, anchorCol, rotated, gemsById)
    }
  }
  return null
}

function tryRemoveRandomGem(board) {
  if (board.placements.length === 0) return null
  return removePlacement(board, pick(board.placements).id)
}

function gemCellList(board, gemsById) {
  return [...occupiedCells(board, gemsById).keys()].map((key) => key.split(',').map(Number))
}

function tryBlockRandomGemCell(board, gemsById) {
  const candidates = gemCellList(board, gemsById).filter(([r, c]) => !board.blocked[r][c])
  if (candidates.length === 0) return null
  const [r, c] = pick(candidates)
  return toggleBlocked(board, r, c)
}

function tryUnblockRandomGemCell(board, gemsById) {
  const candidates = gemCellList(board, gemsById).filter(([r, c]) => board.blocked[r][c])
  if (candidates.length === 0) return null
  const [r, c] = pick(candidates)
  return toggleBlocked(board, r, c)
}

function distance(score, target) {
  return score == null ? Infinity : Math.abs(score - target)
}

// Best-effort: keep adding random gems until gem coverage reaches
// targetCells, or nothing fits anymore. Only used when an explicit fill
// percentage is pinned - once pinned, gem count/composition isn't touched
// again by the difficulty hill-climb below.
function fillToTarget(board, gems, gemsById, targetCells) {
  let attempts = 0
  while (occupiedCells(board, gemsById).size < targetCells && attempts < FILL_TARGET_ATTEMPTS) {
    attempts += 1
    board = tryAddRandomGem(board, gems, gemsById) ?? board
  }
  return board
}

// Assigns exactly min(targetCount, totalCells) blocked tiles, sampled
// uniformly across the WHOLE board - gem-covered or not.
function assignBlockedCount(board, targetCount) {
  const cells = shuffledCellList(board.rows, board.cols)
  const count = Math.min(Math.max(targetCount, 0), cells.length)
  let next = board
  for (let i = 0; i < count; i++) {
    const [r, c] = cells[i]
    next = setBlocked(next, r, c, true)
  }
  return next
}

export function generateDiamondBoard({ rows, cols, targetBucket, gems, targetFillPercent = null, targetBlockedTiles = null }) {
  const gemsById = Object.fromEntries(gems.map((g) => [g.id, g]))
  let board = createDiamondBoard('Generated', { rows, cols })

  if (gems.length === 0) {
    if (targetBlockedTiles != null) board = assignBlockedCount(board, targetBlockedTiles)
    return { board, achievedScore: null, achievedBucket: null, targetBucket }
  }

  const target = BUCKET_TARGET_SCORE[targetBucket]
  const pinnedFill = targetFillPercent != null
  const pinnedBlocked = targetBlockedTiles != null

  if (pinnedFill) {
    const targetCells = Math.round((Math.min(Math.max(targetFillPercent, 0), 100) / 100) * rows * cols)
    board = fillToTarget(board, gems, gemsById, targetCells)
  } else {
    for (let i = 0; i < SEED_ATTEMPTS; i++) {
      board = tryAddRandomGem(board, gems, gemsById) ?? board
    }
  }

  if (pinnedBlocked) {
    board = assignBlockedCount(board, targetBlockedTiles)
  }

  // Whichever dimension isn't pinned stays available for the difficulty
  // hill-climb; a pinned one is simply dropped from the nudge pool.
  const nudgePool = [
    ...(pinnedFill ? [] : [tryAddRandomGem, tryRemoveRandomGem]),
    ...(pinnedBlocked ? [] : [tryBlockRandomGemCell, tryUnblockRandomGemCell]),
  ]

  let best = board
  let bestScore = computeDifficulty(board, gemsById)

  if (nudgePool.length > 0) {
    const canAdd = nudgePool.includes(tryAddRandomGem)
    for (let i = 0; i < HILL_CLIMB_ITERATIONS; i++) {
      if (distance(bestScore?.score, target) <= CLOSE_ENOUGH) break

      // With nothing placed yet, only adding a gem can possibly help - don't
      // waste iterations on remove/block nudges that are guaranteed no-ops.
      const nudge = board.placements.length === 0 && canAdd ? tryAddRandomGem : pick(nudgePool)
      const candidate = nudge === tryAddRandomGem ? nudge(board, gems, gemsById) : nudge(board, gemsById)
      if (!candidate) continue

      const candidateScore = computeDifficulty(candidate, gemsById)
      if (distance(candidateScore?.score, target) <= distance(bestScore?.score, target)) {
        board = candidate
        best = candidate
        bestScore = candidateScore
      }
    }
  }

  return {
    board: best,
    achievedScore: bestScore?.score ?? null,
    achievedBucket: bestScore?.bucket ?? null,
    targetBucket,
  }
}
