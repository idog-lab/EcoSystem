// Shared across features (Merge's BoardGrid/PlayStage/PlayTester, Diamond
// Mine's MineBoardGrid) - a board grid's own rendered width (tile size +
// gaps + card padding), in rem. Any sibling content meant to visually align
// under/beside the grid (e.g. Merge's blocked-item queue) should cap itself
// to this same width - otherwise, with enough content to need it, that
// sibling grows wider than the grid and destabilizes the whole page layout
// (its column becomes the widest thing in its row, which can force later
// columns to wrap). Lives outside both features' own lib/ folders since
// neither feature owns it - it's pure grid-cell-sizing math, no domain logic.
export function gridWidthRem(cols) {
  return cols * 4.25 + Math.max(cols - 1, 0) * 0.5 + 2
}
