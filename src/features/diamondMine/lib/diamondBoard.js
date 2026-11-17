import { footprintCells } from './gem'

function emptyBlockedGrid(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => false))
}

// Top-left aligned, preserving overlapping cells - same resize convention as
// board.js's resizeTiles for the Merge feature.
function resizeBlockedGrid(grid, rows, cols) {
  const next = emptyBlockedGrid(rows, cols)
  for (let r = 0; r < Math.min(rows, grid.length); r++) {
    for (let c = 0; c < Math.min(cols, grid[0]?.length ?? 0); c++) {
      next[r][c] = grid[r][c]
    }
  }
  return next
}

export function createDiamondBoard(name, { rows = 5, cols = 5 } = {}) {
  return {
    id: crypto.randomUUID(),
    name,
    rows,
    cols,
    blocked: emptyBlockedGrid(rows, cols),
    placements: [],
  }
}

function inBounds(board, anchorRow, anchorCol, footRows, footCols) {
  return anchorRow >= 0 && anchorCol >= 0 && anchorRow + footRows <= board.rows && anchorCol + footCols <= board.cols
}

// All cells covered by the board's existing placements, keyed "row,col" -
// used by both the overlap check below and the stats/click-count math, via
// gem.js's footprintCells so the two never disagree about what a placement
// covers.
export function occupiedCells(board, gemsById) {
  const cells = new Map()
  for (const placement of board.placements) {
    const gem = gemsById[placement.gemId]
    if (!gem) continue
    for (const { row, col } of footprintCells(placement, gem)) {
      cells.set(`${row},${col}`, placement.id)
    }
  }
  return cells
}

// True if this gem type already has a placement somewhere on this board -
// by explicit economist request, a board can never carry two placements of
// the identical gem type (rotation doesn't matter, it's still the same
// gem). Exported separately from canPlaceGem so callers that want to
// distinguish *why* a placement is rejected (already-placed vs.
// doesn't-fit) - e.g. the board grid's reject message, the palette's
// disabled state - can check this specific reason on its own.
export function isGemAlreadyOnBoard(board, gemId) {
  return board.placements.some((p) => p.gemId === gemId)
}

// Pure dry-run check - used both by placeGem itself and by the grid's hover
// ghost-preview, so "would this fit" and "does this fit" can never diverge.
export function canPlaceGem(board, gem, anchorRow, anchorCol, rotated, gemsById) {
  if (isGemAlreadyOnBoard(board, gem.id)) return false
  const footRows = rotated ? gem.cols : gem.rows
  const footCols = rotated ? gem.rows : gem.cols
  if (!inBounds(board, anchorRow, anchorCol, footRows, footCols)) return false
  const occupied = occupiedCells(board, gemsById)
  const candidate = footprintCells({ anchorRow, anchorCol, rotated }, gem)
  return candidate.every(({ row, col }) => !occupied.has(`${row},${col}`))
}

export function placeGem(board, gem, anchorRow, anchorCol, rotated, gemsById) {
  if (!canPlaceGem(board, gem, anchorRow, anchorCol, rotated, gemsById)) return null
  const placement = { id: crypto.randomUUID(), gemId: gem.id, anchorRow, anchorCol, rotated }
  return { ...board, placements: [...board.placements, placement] }
}

export function removePlacement(board, placementId) {
  return { ...board, placements: board.placements.filter((p) => p.id !== placementId) }
}

export function toggleBlocked(board, r, c) {
  const next = board.blocked.map((row) => [...row])
  next[r][c] = !next[r][c]
  return { ...board, blocked: next }
}

// Idempotent set (not a flip) - the grid's drag-paint brush relies on this so
// re-entering an already-painted cell mid-drag is a no-op instead of
// flip-flopping it back off.
export function setBlocked(board, r, c, value) {
  const next = board.blocked.map((row) => [...row])
  next[r][c] = value
  return { ...board, blocked: next }
}

// Drops (never clips) any placement that no longer fully fits - a resize
// truncating a gem in place would leave a "gem" that doesn't match any real
// gem shape, which is worse than just removing it and saying so.
export function resizeDiamondBoard(board, rows, cols, gemsById) {
  const blocked = resizeBlockedGrid(board.blocked, rows, cols)
  const resized = { ...board, rows, cols, blocked }
  const kept = board.placements.filter((p) => {
    const gem = gemsById[p.gemId]
    if (!gem) return false
    const footRows = p.rotated ? gem.cols : gem.rows
    const footCols = p.rotated ? gem.rows : gem.cols
    return inBounds(resized, p.anchorRow, p.anchorCol, footRows, footCols)
  })
  return { board: { ...resized, placements: kept }, removedCount: board.placements.length - kept.length }
}

export function cloneDiamondBoard(board, name) {
  return {
    ...board,
    id: crypto.randomUUID(),
    name: name ?? `${board.name} copy`,
    blocked: board.blocked.map((row) => [...row]),
    placements: board.placements.map((p) => ({ ...p, id: crypto.randomUUID() })),
  }
}
