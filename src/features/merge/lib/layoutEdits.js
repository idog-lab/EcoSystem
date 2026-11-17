// Layout edits to one board, as pure functions - the same rules the board
// editor applies (BoardEditor.jsx's updateBoard/handlePaint/handleFillAll/
// handleDimensionChange), shared so the Build Event workflow's layout step
// and the advanced editor can never disagree about what a paint does.
//
// A layout edit changes WHERE items can go, so the edited board's generated
// contents no longer fit and are cleared (invalidateLayout) - that one
// board's, never any other board's. Pins (forced ranks, pinned reward items),
// budgets and every other board are left alone.
import { invalidateLayout, applyForcedSemiCell, applyForcedHighestRankCell, resizeTiles, FORCED_SEMI_CELL, FORCED_HIGHEST_RANK_CELL } from './board'

function forceCells(board, isFirstBoard, tiles) {
  if (!isFirstBoard) return tiles
  const withSemi = applyForcedSemiCell(tiles)
  return board.rcEvent ? applyForcedHighestRankCell(withSemi) : withSemi
}

function withLayout(board, isFirstBoard, patch) {
  return invalidateLayout(board, patch.tiles ? { ...patch, tiles: forceCells(board, isFirstBoard, patch.tiles) } : patch)
}

// `semiRank` (only with state 'semi'): pin that main-chain rank to the cell.
export function paintTile(board, isFirstBoard, r, c, state, semiRank = null) {
  const tiles = board.tiles.map((row) => [...row])
  tiles[r][c] = state
  const reserved =
    isFirstBoard && ((r === FORCED_SEMI_CELL.row && c === FORCED_SEMI_CELL.col) || (r === FORCED_HIGHEST_RANK_CELL.row && c === FORCED_HIGHEST_RANK_CELL.col))
  const forcedSemiRanks = (board.forcedSemiRanks ?? []).filter((f) => !(f.row === r && f.col === c))
  if (state === 'semi' && semiRank != null && !reserved) forcedSemiRanks.push({ row: r, col: c, rank: semiRank })
  // A reward item pinned to a semi cell goes with the cell if it stops being semi.
  const rewardSemiItems = (board.rewardSemiItems ?? []).filter((it) => !(it.row === r && it.col === c && state !== 'semi'))
  return withLayout(board, isFirstBoard, { tiles, forcedSemiRanks, rewardSemiItems })
}

export function fillAllTiles(board, isFirstBoard, state) {
  const tiles = Array.from({ length: board.rows }, () => Array.from({ length: board.cols }, () => state))
  return withLayout(board, isFirstBoard, { tiles, forcedSemiRanks: [], rewardSemiItems: [] })
}

export function resizeBoard(board, isFirstBoard, rows, cols) {
  const inside = (it) => it.row < rows && it.col < cols
  return withLayout(board, isFirstBoard, {
    rows,
    cols,
    tiles: resizeTiles(board.tiles, rows, cols),
    forcedSemiRanks: (board.forcedSemiRanks ?? []).filter(inside),
    rewardSemiItems: (board.rewardSemiItems ?? []).filter(inside),
  })
}

export function setRankWindow(board, isFirstBoard, patch) {
  return withLayout(board, isFirstBoard, patch)
}
