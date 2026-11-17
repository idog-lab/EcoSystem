// Diamond Mine gem types. A gem is a plain filled rectangle of a fixed
// (rows, cols) footprint - not an arbitrary polyomino - placed on a board
// and independently rotatable per-placement (rotating just swaps rows/cols).

// 13 reference sizes from the economist's spec sheet, each a genuinely
// distinct gem type (own art/color) even where two letters happen to be
// transposes of each other (e.g. b=1x2 and c=2x1) - rotation already covers
// that overlap in-app, so this isn't deduplicated.
const DEFAULT_GEM_SPECS = [
  { name: 'a', rows: 1, cols: 1 },
  { name: 'b', rows: 1, cols: 2 },
  { name: 'c', rows: 2, cols: 1 },
  { name: 'd', rows: 2, cols: 2 },
  { name: 'e', rows: 1, cols: 3 },
  { name: 'f', rows: 3, cols: 1 },
  { name: 'g', rows: 4, cols: 1 },
  { name: 'h', rows: 2, cols: 3 },
  { name: 'i', rows: 3, cols: 2 },
  { name: 'j', rows: 2, cols: 4 },
  { name: 'k', rows: 4, cols: 2 },
  { name: 'l', rows: 3, cols: 3 },
  { name: 'm', rows: 4, cols: 4 },
]

// Placeholder color ramp until real gem art/icons exist - one hue per
// default gem, same "not final" spirit as boardSyntax.js's placeholder
// export format.
export const GEM_COLOR_RAMP = [
  '#0ea5e9', // a
  '#e11d48', // b
  '#db2777', // c
  '#7c3aed', // d
  '#2563eb', // e
  '#0d9488', // f
  '#16a34a', // g
  '#65a30d', // h
  '#ea580c', // i
  '#0891b2', // j
  '#4d7c0f', // k
  '#0284c7', // l
  '#ca8a04', // m
]

export function createGem(name, rows, cols, color) {
  return { id: crypto.randomUUID(), name, rows, cols, color }
}

// Fresh ids per call, same convention as data/defaultStage.js.
export function createDefaultGems() {
  return DEFAULT_GEM_SPECS.map((spec, i) => createGem(spec.name, spec.rows, spec.cols, GEM_COLOR_RAMP[i]))
}

// Rotating a plain rectangle just swaps its dimensions.
export function footprint(gem, rotated) {
  return rotated ? { rows: gem.cols, cols: gem.rows } : { rows: gem.rows, cols: gem.cols }
}

// The single source of truth for which board cells a placement covers -
// diamondBoard.js (overlap checks) and diamondStats.js (click counting)
// both import this rather than each recomputing it their own way.
export function footprintCells(placement, gem) {
  const { rows, cols } = footprint(gem, placement.rotated)
  const cells = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ row: placement.anchorRow + r, col: placement.anchorCol + c })
    }
  }
  return cells
}

// True if any board anywhere already has a placement referencing this gem -
// dimension edits become unsafe past that point (existing placements assume
// the old footprint), so GemLibrary locks rows/cols and offers "duplicate as
// new gem" instead of letting the economist edit dimensions out from under
// boards that already used them.
export function isGemLocked(gemId, boards) {
  return boards.some((board) => board.placements.some((p) => p.gemId === gemId))
}

// Cascade-delete: removing a gem type removes every placement of it across
// every board, no confirmation - matches this app's existing no-confirm
// delete conventions (e.g. BoardList's remove button).
export function removeGemEverywhere(gemId, boards) {
  return boards.map((board) => ({
    ...board,
    placements: board.placements.filter((p) => p.gemId !== gemId),
  }))
}
