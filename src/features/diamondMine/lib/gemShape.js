// Shared "which sides of this cell touch another cell of the same group"
// helper - used to render a multi-cell gem as one connected shape (border
// only on its true outer edges) instead of a grid of separately-outlined
// squares, so a viewer can read a cell's position within the piece (corner,
// edge, or middle) at a glance. `cellMap` is a Map keyed "row,col" -> some
// group id (a placement id); only cells present in the map count as
// "known" - the play tester passes a map of just the currently-*revealed*
// gem cells, so an unrevealed neighbor is never treated as connected (that
// would visually leak which piece is under it before it's actually been
// tapped).
export function cellConnections(cellMap, row, col) {
  const id = cellMap.get(`${row},${col}`)
  if (id == null) return { top: false, bottom: false, left: false, right: false }
  const sameGroup = (r, c) => cellMap.get(`${r},${c}`) === id
  return {
    top: sameGroup(row - 1, col),
    bottom: sameGroup(row + 1, col),
    left: sameGroup(row, col - 1),
    right: sameGroup(row, col + 1),
  }
}

// Round a corner only when neither adjacent side connects to the same
// group. Every gem is a plain filled rectangle, never an arbitrary
// polyomino (see gem.js) and placements never overlap, so this simple
// per-corner check can't land on a wrong concave-corner result the way it
// could for general polyominoes sharing a group id.
export function cornerRounding(conn) {
  return {
    tl: !conn.top && !conn.left,
    tr: !conn.top && !conn.right,
    bl: !conn.bottom && !conn.left,
    br: !conn.bottom && !conn.right,
  }
}
