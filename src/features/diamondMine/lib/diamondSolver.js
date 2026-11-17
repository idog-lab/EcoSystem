// Estimates how many taps a real player needs to fully clear a board.
// Unlike diamondStats.js's computeMinClicks (the theoretical floor assuming
// the player already knows exactly where every gem is), these simulate
// actually not knowing where anything is. Two strategies, Monte Carlo over a
// handful of runs each rather than a closed-form expectation - the point is
// a ballpark an economist can re-roll on demand, not a proof:
//
// - "Blind": tap uniformly random not-yet-tried tiles until every gem cell
//   has come up. The pure floor-of-realism baseline - no memory, no
//   deduction.
// - "Smart": models a player who knows the board's full gem catalog (which
//   sizes exist and how many of each - the in-game "x12" tallies) but not
//   where anything is, same "known fleet, unknown location" assumption real
//   Battleship AI uses. Two phases:
//     - Hunt: three tiers, tried in order, each one a fallback for the last:
//         1. GUARANTEED hitting-set cells (guaranteedHuntCell) - see below,
//            this is "each gem's own perfect finding logic," combined
//            across every remaining gem.
//         2. Density heat map (densityHuntCell) - the older heuristic,
//            scores every unrevealed cell by how many ways a still-unfound
//            gem size (in either orientation) could fit there. Only reached
//            once tier 1 has nothing left to offer (see below for when).
//         3. A uniformly random unrevealed cell, if even tier 2 has nothing
//            (the board's fully explained by both) - a safety net, not
//            something that should come up in a consistent game state.
//       Both tiers 1 and 2 rank *per tap cost*, not raw score - a blocked
//       candidate costs 2 taps to actually check (see tapCost), so it needs
//       roughly double the score to beat an equally-likely open one;
//       blocked-ness is visible up front in the real UI (the Lock badge),
//       so a real smart player already gets to factor this in.
//     - Target: once a hunt lands a hit, follow its orthogonal neighbors
//       until the whole contiguous hit-cluster is bounded by misses/edges -
//       gems are filled rectangles, so a hit's neighbors are overwhelmingly
//       likely to extend the same gem, and this already maps a piece's
//       exact extent optimally once you have a first hit. No real "choice"
//       to get wrong here, so this phase is always fully deterministic.
//   When a cluster closes, if its bounding box is a clean filled rectangle
//   matching a still-remaining size (in either orientation), that size's
//   remaining count drops by one, sharpening the next hunt. Two adjacent
//   different gems can close as one non-rectangular merged cluster - not
//   uncommon, and not a bug (see MineBoardGrid's own click-selection logic,
//   which treats this the same way) - that case just skips the decrement
//   rather than guessing which piece(s) it was, a deliberate approximation
//   over building full multi-piece constraint tracking for a Monte Carlo
//   estimate that only needs to be a useful ballpark, not a proof.
//
// **Tier 1: each gem's own "perfect finding logic," a provable guarantee,
// not a probability.** For a single gem of length L in one dimension
// (rows or cols) of a board sized N in that dimension, hittingIndices(N, L)
// returns the minimal set of positions such that ANY placement of that
// gem - anchored anywhere at all - MUST cover at least one of them. This is
// the classic 1D "battleship" covering pattern (probe every Lth cell,
// starting at L-1): for f (3 rows tall) on a 5-row board this collapses to
// the single middle row, exactly the "hit the middle row and you can't
// miss it" intuition an economist can work out by hand - hittingIndices
// just generalizes it to every length/board-size combination, not only the
// ones where it happens to be one obvious row.
//
// guaranteedHitCells crosses the row-hitting-set with the column-hitting-
// set for a given orientation: for ANY real placement, its row range must
// contain a row-hit index and its column range must contain a col-hit
// index, so that specific (row, col) pair is necessarily one of the
// placement's own cells - meaning the cross product is a valid (if not
// always minimal) guaranteed hitting set for the full 2D rectangle. This
// is fixed by the board's dimensions and the shape alone, computed once
// per hunt call from the ORIGINAL board size (not from what's revealed so
// far) and stays correct for the entire game: the guarantee holds for the
// piece's *true* anchor regardless of what else has been revealed
// elsewhere, and a cell that truly is part of the hidden piece can never
// come up as a miss when tapped - see guaranteedHuntCell for the one
// subtlety this leaves (multiple remaining gems combined into one score).
//
// guaranteedHuntCell is the board-level combiner the file header above is
// describing: it doesn't just run one gem's hitting set at a time, it
// unions every remaining gem's (size x orientation) hitting set together
// and scores each surviving unrevealed cell by how many distinct
// guarantees it would serve at once - a cell that's a guaranteed probe
// for two different remaining gems is worth tapping first, since it makes
// certain progress on both. Finding a globally *optimal* combined strategy
// across multiple unknown-location pieces at once is a much harder
// (NP-hard, in general) combinatorial problem - this is a principled,
// correct-per-gem, greedy combination across gems, not a claim of full
// joint optimality.
//
// Tier 1 can come up empty (falls through to tier 2) if every remaining
// gem's guaranteed cells have already been revealed - this should only
// happen right after a cluster closes but doesn't get attributed back to
// remainingSizes cleanly (the non-rectangular merged-cluster approximation
// above), which is the one place this file's bookkeeping is still an
// accepted approximation rather than exact.

import { occupiedCells } from './diamondBoard'

// Probability the "smart" hunt phase takes its top-scored cell rather than
// a uniformly random unrevealed one. Set to 1 (always take the best move)
// for now, by explicit economist request, while the core hunting logic
// itself (tiers 1/2 above) is being validated - was 0.8 (modeling a
// good-but-imperfect player) before that request; dial it back down again
// once the deterministic strategy's quality is trusted.
const SMART_HUNT_OPTIMAL_PROBABILITY = 1

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function shuffledCellList(board) {
  const cells = []
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) cells.push([r, c])
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[cells[i], cells[j]] = [cells[j], cells[i]]
  }
  return cells
}

function orthogonalNeighbors(r, c, rows, cols) {
  const out = []
  if (r > 0) out.push([r - 1, c])
  if (r < rows - 1) out.push([r + 1, c])
  if (c > 0) out.push([r, c - 1])
  if (c < cols - 1) out.push([r, c + 1])
  return out
}

// A double-tap on a blocked tile costs 2, same convention as
// diamondStats.js's computeMinClicks - shared by every strategy below.
function tapCost(board, r, c) {
  return board.blocked[r][c] ? 2 : 1
}

function simulateOneBlindClear(board, gemsById) {
  const gemCellKeys = new Set(occupiedCells(board, gemsById).keys())
  if (gemCellKeys.size === 0) return 0

  let clicks = 0
  let found = 0
  for (const [r, c] of shuffledCellList(board)) {
    clicks += tapCost(board, r, c)
    if (gemCellKeys.has(`${r},${c}`)) {
      found += 1
      if (found === gemCellKeys.size) break
    }
  }
  return clicks
}

// Multiset of each gem's INTRINSIC (unrotated) size, one entry per
// placement on the board - the "known fleet" a smart player would see.
function intrinsicSizeMultiset(board, gemsById) {
  const counts = new Map()
  for (const placement of board.placements) {
    const gem = gemsById[placement.gemId]
    if (!gem) continue
    const key = `${gem.rows}x${gem.cols}`
    const entry = counts.get(key) ?? { rows: gem.rows, cols: gem.cols, count: 0 }
    entry.count += 1
    counts.set(key, entry)
  }
  return counts
}

// The minimal set of positions in [0, n) guaranteed to intersect ANY
// length-`len` interval anchored anywhere within [0, n) - see the file
// header. Provably correct for every n/len combination, including the
// board edge: the last probe index (len-1 + k*len for the largest valid k)
// algebraically always lands at or past n-len, i.e. within the final valid
// anchor's own interval, so no special-cased boundary fix is needed.
function hittingIndices(n, len) {
  const idx = []
  for (let pos = len - 1; pos < n; pos += len) idx.push(pos)
  return idx
}

// Cross product of the row- and column-hitting sets for one orientation -
// see the file header for why this guarantees intersecting any fr x fc
// placement anywhere on the board.
function guaranteedHitCells(board, fr, fc) {
  const rowHits = hittingIndices(board.rows, fr)
  const colHits = hittingIndices(board.cols, fc)
  const cells = []
  for (const r of rowHits) for (const c of colHits) cells.push(`${r},${c}`)
  return cells
}

// Tier 1 of the hunt decision - see the file header for the full
// explanation. Unions every remaining size/orientation's guaranteed
// hitting cells, scores each still-unrevealed one by how many distinct
// remaining gems it would make guaranteed progress on, ranks per tap cost
// same as densityHuntCell below. Returns null if nothing survives (every
// guaranteed cell for every remaining gem has already been revealed).
function guaranteedHuntCell(board, revealed, remainingSizes) {
  const score = new Map()
  for (const { rows, cols, count } of remainingSizes.values()) {
    if (count <= 0) continue
    const orientations = rows === cols ? [[rows, cols]] : [[rows, cols], [cols, rows]]
    for (const [fr, fc] of orientations) {
      for (const key of guaranteedHitCells(board, fr, fc)) {
        if (revealed.has(key)) continue
        score.set(key, (score.get(key) ?? 0) + count)
      }
    }
  }

  let bestScore = 0
  let bestCells = []
  for (const [key, rawScore] of score) {
    const [r, c] = key.split(',').map(Number)
    const s = rawScore / tapCost(board, r, c)
    if (s > bestScore) {
      bestScore = s
      bestCells = [key]
    } else if (s === bestScore) {
      bestCells.push(key)
    }
  }
  if (bestCells.length === 0) return null
  return pick(bestCells).split(',').map(Number)
}

function fitsEntirelyUnrevealed(revealed, rows, cols, anchorRow, anchorCol, boardRows, boardCols) {
  if (anchorRow < 0 || anchorCol < 0 || anchorRow + rows > boardRows || anchorCol + cols > boardCols) return false
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (revealed.has(`${anchorRow + r},${anchorCol + c}`)) return false
    }
  }
  return true
}

// Tier 2 of the hunt decision - the older heuristic, only reached once
// tier 1 (guaranteedHuntCell) has nothing left to offer. For every
// remaining size (in either orientation), every anchor where it would fit
// entirely within unrevealed cells adds +count to each cell it'd cover - a
// simple, cheap stand-in for full placement-consistency tracking. Returns
// the best-scoring unrevealed cell (ties broken randomly), or null if
// nothing scores (falls back further to a random unrevealed tap).
//
// Ranked by density *per tap cost*, not raw density - a blocked cell costs
// 2 taps to actually reveal (see tapCost), so an equally-likely blocked
// candidate is worth half as much expected information per click as an
// equally-likely open one. A rational player who can already see which
// tiles are blocked (the real UI shows this up front, unconditionally -
// see MineBoardGrid.jsx's Lock badge) would factor that cost in rather
// than treating every cell as equally cheap to check.
function densityHuntCell(board, revealed, remainingSizes) {
  const density = new Map()
  for (const { rows, cols, count } of remainingSizes.values()) {
    if (count <= 0) continue
    const orientations = rows === cols ? [[rows, cols]] : [[rows, cols], [cols, rows]]
    for (const [fr, fc] of orientations) {
      for (let anchorRow = 0; anchorRow <= board.rows - fr; anchorRow++) {
        for (let anchorCol = 0; anchorCol <= board.cols - fc; anchorCol++) {
          if (!fitsEntirelyUnrevealed(revealed, fr, fc, anchorRow, anchorCol, board.rows, board.cols)) continue
          for (let r = 0; r < fr; r++) {
            for (let c = 0; c < fc; c++) {
              const key = `${anchorRow + r},${anchorCol + c}`
              density.set(key, (density.get(key) ?? 0) + count)
            }
          }
        }
      }
    }
  }

  let bestScore = 0
  let bestCells = []
  for (const [key, rawScore] of density) {
    const [r, c] = key.split(',').map(Number)
    const score = rawScore / tapCost(board, r, c)
    if (score > bestScore) {
      bestScore = score
      bestCells = [key]
    } else if (score === bestScore) {
      bestCells.push(key)
    }
  }
  if (bestCells.length === 0) return null
  return pick(bestCells).split(',').map(Number)
}

function anyUnrevealedCell(board, revealed) {
  const candidates = []
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      if (!revealed.has(`${r},${c}`)) candidates.push([r, c])
    }
  }
  return candidates.length > 0 ? pick(candidates) : null
}

// The three-tier chain described in the file header: guaranteed hitting
// cells first, the density heat map as a fallback, a uniformly random
// unrevealed cell as the last resort. The optimal-vs-imperfect split lives
// here, not inside either tier's own function - a "miss" still has to fall
// back to a random unrevealed cell exactly like the both-tiers-empty
// fallback does, so every path shares the same anyUnrevealedCell call.
function chooseHuntCell(board, revealed, remainingSizes) {
  if (Math.random() < SMART_HUNT_OPTIMAL_PROBABILITY) {
    const best = guaranteedHuntCell(board, revealed, remainingSizes) ?? densityHuntCell(board, revealed, remainingSizes)
    if (best) return best
  }
  return anyUnrevealedCell(board, revealed)
}

function simulateOneSmartClear(board, gemsById) {
  const gemCellKeys = new Set(occupiedCells(board, gemsById).keys())
  const totalGemCells = gemCellKeys.size
  if (totalGemCells === 0) return 0

  const revealed = new Set()
  let clicks = 0
  let found = 0
  const remainingSizes = intrinsicSizeMultiset(board, gemsById)

  function tap(r, c) {
    revealed.add(`${r},${c}`)
    clicks += tapCost(board, r, c)
    const hit = gemCellKeys.has(`${r},${c}`)
    if (hit) found += 1
    return hit
  }

  // A closed cluster that's a clean filled rectangle matching a still-
  // remaining size (either orientation) decrements it - sharpens every hunt
  // after. A non-rectangular (merged multi-gem) cluster just skips this -
  // see the file header for why that's an accepted approximation, not a bug.
  function closeCluster(cells) {
    let minR = Infinity
    let maxR = -Infinity
    let minC = Infinity
    let maxC = -Infinity
    for (const [r, c] of cells) {
      minR = Math.min(minR, r)
      maxR = Math.max(maxR, r)
      minC = Math.min(minC, c)
      maxC = Math.max(maxC, c)
    }
    const boundRows = maxR - minR + 1
    const boundCols = maxC - minC + 1
    if (boundRows * boundCols !== cells.length) return
    for (const key of [`${boundRows}x${boundCols}`, `${boundCols}x${boundRows}`]) {
      const entry = remainingSizes.get(key)
      if (entry && entry.count > 0) {
        entry.count -= 1
        return
      }
    }
  }

  while (found < totalGemCells) {
    const huntCell = chooseHuntCell(board, revealed, remainingSizes)
    if (!huntCell) break // safety net - shouldn't happen, every cell gets tried

    const [hr, hc] = huntCell
    const clusterCells = [[hr, hc]]
    if (!tap(hr, hc) || found === totalGemCells) continue

    const frontier = orthogonalNeighbors(hr, hc, board.rows, board.cols).filter(([nr, nc]) => !revealed.has(`${nr},${nc}`))
    while (frontier.length > 0 && found < totalGemCells) {
      const [nr, nc] = frontier.shift()
      if (revealed.has(`${nr},${nc}`)) continue
      if (tap(nr, nc)) {
        clusterCells.push([nr, nc])
        frontier.push(...orthogonalNeighbors(nr, nc, board.rows, board.cols).filter(([r2, c2]) => !revealed.has(`${r2},${c2}`)))
      }
    }
    closeCluster(clusterCells)
  }

  return clicks
}

function summarize(samples) {
  return {
    mean: Math.round(samples.reduce((sum, v) => sum + v, 0) / samples.length),
    min: Math.min(...samples),
    max: Math.max(...samples),
  }
}

// null when nothing's placed yet, same "not built yet" convention as
// computeDifficulty.
//
// Async and chunked (not one big synchronous loop): at 100 runs on a large,
// dense board this can take several hundred ms total, and a single
// unbroken synchronous block that long freezes the tab for its whole
// duration - the loading UI (see MineBoardEditor.jsx) would render once,
// then sit frozen mid-animation instead of actually swinging. Yielding back
// to the event loop every CHUNK_SIZE runs keeps every individual block
// under ~25ms (imperceptible - well under a dropped frame at 60fps), which
// keeps the pickaxe animation genuinely smooth and lets onProgress paint an
// honest "run N/total" readout instead of a single before/after jump.
const CHUNK_SIZE = 5

export async function estimateClicksToClear(board, gemsById, runs = 100, onProgress) {
  if (board.placements.length === 0) return null
  const blind = []
  const smart = []
  for (let i = 0; i < runs; i++) {
    blind.push(simulateOneBlindClear(board, gemsById))
    smart.push(simulateOneSmartClear(board, gemsById))
    if ((i + 1) % CHUNK_SIZE === 0 && i + 1 < runs) {
      onProgress?.(i + 1, runs)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  return { runs, blind: summarize(blind), smart: summarize(smart) }
}
