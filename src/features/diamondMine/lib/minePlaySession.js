// An interactive play session for a Diamond Mine board chain - tap tiles to
// reveal them, gems are hidden until every one of their footprint cells is
// individually revealed, and once every gem on the current board is found
// play advances to the next board in the list. No wave/row-push mechanic
// here (unlike Merge's playSession.js) - Diamond Mine boards are simple
// independent boards, so "next board" just means swapping to a fresh one
// wholesale.
//
// Same "mutate the session, hand React an already-computed plain object"
// convention as playSession.js: tapCell/advanceToNextBoard mutate `session`
// in place rather than returning a new one, because passing a function that
// performs the mutation into setState is unsafe (React Strict Mode can
// invoke a state updater more than once, which would double the mutation).
// Callers must call the mutating function once, then setSession({...session}).

import { occupiedCells } from './diamondBoard'

function emptyCellStateGrid(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 'hidden'))
}

// Every cell a gem covers (gemForCell), plus the inverse grouping
// (footprintByPlacement) - both derived from the same occupiedCells this
// app already uses for overlap-checking and click-cost stats, so this can
// never disagree with those about what a placement covers.
function buildGemMaps(board, gemsById) {
  const occupied = occupiedCells(board, gemsById)
  const footprintByPlacement = new Map()
  for (const [key, placementId] of occupied) {
    if (!footprintByPlacement.has(placementId)) footprintByPlacement.set(placementId, [])
    footprintByPlacement.get(placementId).push(key)
  }
  return { gemForCell: occupied, footprintByPlacement }
}

export function isBoardEmpty(board) {
  return board.placements.length === 0
}

function loadBoard(session, index) {
  const board = session.boards[index]
  const { gemForCell, footprintByPlacement } = buildGemMaps(board, session.gemsById)
  session.boardIndex = index
  session.cellState = emptyCellStateGrid(board.rows, board.cols)
  session.gemForCell = gemForCell
  session.footprintByPlacement = footprintByPlacement
  session.gemsFoundCount = 0
  session.totalGems = board.placements.length
  session.status = isBoardEmpty(board) ? 'empty' : 'playing'
}

export function createMinePlaySession(boards, gemsById, startIndex = 0) {
  const session = { boards, gemsById, tapsUsed: 0 }
  loadBoard(session, startIndex)
  return session
}

// Taps `[r,c]`. No-op (returns a falsy result) once play has stopped
// accepting taps (status !== 'playing') or the cell is already fully
// revealed - covers both "board already cleared, waiting to advance" and
// "rapid repeat click on the same cell."
export function tapCell(session, r, c) {
  if (session.status !== 'playing') return { gemCompleted: null, boardCleared: false }
  const board = session.boards[session.boardIndex]
  const state = session.cellState[r][c]
  if (state === 'revealed') return { gemCompleted: null, boardCleared: false }

  const isBlocked = board.blocked[r][c]
  if (isBlocked && state === 'hidden') {
    session.cellState[r][c] = 'cracked'
    session.tapsUsed += 1
    return { gemCompleted: null, boardCleared: false }
  }

  session.cellState[r][c] = 'revealed'
  session.tapsUsed += 1

  const placementId = session.gemForCell.get(`${r},${c}`)
  let gemCompleted = null
  if (placementId != null) {
    const cells = session.footprintByPlacement.get(placementId)
    const allRevealed = cells.every((key) => {
      const [cr, cc] = key.split(',').map(Number)
      return session.cellState[cr][cc] === 'revealed'
    })
    if (allRevealed) {
      gemCompleted = placementId
      session.gemsFoundCount += 1
    }
  }

  const boardCleared = session.totalGems > 0 && session.gemsFoundCount === session.totalGems
  if (boardCleared) session.status = 'board-cleared'
  return { gemCompleted, boardCleared }
}

// Advances past the current (cleared) board - loops silently past any
// empty board it lands on (mirrors Merge's own board-chaining precedent:
// "cascades through boards that clear instantly... simply stops firing
// once the list is exhausted," no special per-skip messaging there either)
// until it lands on a playable one, or runs out.
export function advanceToNextBoard(session) {
  let next = session.boardIndex + 1
  while (next < session.boards.length && isBoardEmpty(session.boards[next])) {
    next += 1
  }
  if (next >= session.boards.length) {
    session.status = 'all-cleared'
    return session
  }
  loadBoard(session, next)
  return session
}
