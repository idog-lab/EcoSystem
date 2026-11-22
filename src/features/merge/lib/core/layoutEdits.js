// Layout edits to one board, as pure functions - the same rules the board
// editor applies (BoardEditor.jsx's updateBoard/handlePaint/handleFillAll/
// handleDimensionChange), shared so the Build Event workflow's layout step
// and the advanced editor can never disagree about what a paint does.
//
// A layout edit changes WHERE items can go, so the edited board's generated
// contents no longer fit and are cleared (invalidateLayout) - that one
// board's, never any other board's. Pins (forced ranks, pinned reward items),
// budgets and every other board are left alone.
import { invalidateLayout, applyForcedSemiCell, applyForcedHighestRankCell, resizeTiles, FORCED_SEMI_CELL, FORCED_HIGHEST_RANK_CELL, applyTutorialCells, tutorialCells, isRecompletionBoard } from './board'

// The first board of the normal event keeps its two tutorial cells empty
// (board.js); Recompletion's first board is not a tutorial board.
export const hasTutorialCells = (board, isFirstBoard) => isFirstBoard && !isRecompletionBoard(board)

function forceCells(board, isFirstBoard, tiles) {
  if (!isFirstBoard) return tiles
  // (The fixed cell is forced last: on a board too small for both it wins.)
  const withSemi = applyForcedSemiCell(hasTutorialCells(board, isFirstBoard) ? applyTutorialCells(tiles) : tiles)
  return board.rcEvent ? applyForcedHighestRankCell(withSemi) : withSemi
}

function withLayout(board, isFirstBoard, patch) {
  if (!patch.tiles) return invalidateLayout(board, patch)
  const tiles = forceCells(board, isFirstBoard, patch.tiles)
  // Nothing stays pinned to a cell that is kept empty.
  const kept = hasTutorialCells(board, isFirstBoard) ? tutorialCells(tiles.length, tiles[0]?.length ?? 0) : []
  const free = (it) => !kept.some((cell) => cell.row === it.row && cell.col === it.col)
  return invalidateLayout(board, {
    ...patch,
    tiles,
    ...(kept.length > 0 ? { forcedSemiRanks: (patch.forcedSemiRanks ?? board.forcedSemiRanks ?? []).filter(free), rewardSemiItems: (patch.rewardSemiItems ?? board.rewardSemiItems ?? []).filter(free) } : {}),
  })
}

// A whole layout at once - a pick from the bank (boardBank.js). The board
// takes the layout's size and tiles; pins go with the tiles they were on.
export function applyLayout(board, isFirstBoard, layout) {
  return withLayout(board, isFirstBoard, { rows: layout.tiles.length, cols: layout.tiles[0].length, tiles: layout.tiles.map((row) => [...row]), forcedSemiRanks: [], rewardSemiItems: [] })
}

// Empties the two tutorial cells of a first board drawn before the rule, and
// changes nothing else about its layout.
export function openTutorialCells(board) {
  return withLayout(board, true, { tiles: board.tiles })
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
