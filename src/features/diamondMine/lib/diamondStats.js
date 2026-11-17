// Heuristic first pass, not playtested - tune the weights/thresholds freely
// once real boards get played. Mirrors boardSyntax.js's own "not final"
// framing: this is a reasonable starting formula, not a design decision set
// in stone.

import { occupiedCells } from './diamondBoard'

export const DIFFICULTY_BUCKETS = [
  { label: 'Easy', min: 0, max: 29 },
  { label: 'Medium', min: 30, max: 54 },
  { label: 'Hard', min: 55, max: 79 },
  { label: 'Expert', min: 80, max: 100 },
]

// Midpoint of each bucket's range - what the generator aims for when the
// economist asks for "a Hard board" rather than an exact numeric score.
export const BUCKET_TARGET_SCORE = { Easy: 15, Medium: 42, Hard: 67, Expert: 90 }

export function bucketForScore(score) {
  return DIFFICULTY_BUCKETS.find((b) => score >= b.min && score <= b.max)?.label ?? 'Expert'
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max)
}

// No adjacency/flood-fill mechanic is implied by "click to reveal, win when
// every gem cell is found" - the only clicks that are ever required are gem
// cells, and a blocked one costs 2 (double-tap). Non-gem cells cost nothing;
// the win condition is "find all the gems," not "clear the whole board."
export function computeMinClicks(board, gemsById) {
  const occupied = occupiedCells(board, gemsById)
  let clicks = 0
  for (const key of occupied.keys()) {
    const [r, c] = key.split(',').map(Number)
    clicks += board.blocked[r][c] ? 2 : 1
  }
  return clicks
}

// null when nothing's placed yet - an empty board would otherwise score
// near-max difficulty (0% fill = maximum "emptiness"), which reads as "this
// impossible board is Expert" rather than the true "not built yet."
export function computeDifficulty(board, gemsById) {
  if (board.placements.length === 0) return null

  const occupied = occupiedCells(board, gemsById)
  const gemCells = occupied.size
  let blockedGemCells = 0
  for (const key of occupied.keys()) {
    const [r, c] = key.split(',').map(Number)
    if (board.blocked[r][c]) blockedGemCells += 1
  }

  const totalCells = board.rows * board.cols
  const fillRatio = gemCells / totalCells
  const emptiness = clamp(1 - fillRatio / 0.45, 0, 1)

  const avgPieceSize = gemCells / board.placements.length
  const fragmentation = clamp(1 - (avgPieceSize - 1) / 15, 0, 1)

  const blockedScore = gemCells > 0 ? blockedGemCells / gemCells : 0

  const scale = clamp((totalCells - 20) / 80, 0, 1)

  const score = Math.round(100 * (0.35 * emptiness + 0.3 * fragmentation + 0.2 * blockedScore + 0.15 * scale))

  return { score, bucket: bucketForScore(score), fillRatio, avgPieceSize, blockedScore }
}
