import { valueOf, MAX_RANK } from './ranks'
import { decompose, splitToCount } from './generateCandidate'
import { splitOversized, mergeUndersized, effectiveMaxRank } from './rankWindow'
import { simulatePlaythrough } from './mergeSimulation'
import { FORCED_SEMI_CELL, FORCED_SEMI_RANK } from './board'

const CEILING = valueOf(MAX_RANK)

function countTiles(tiles) {
  let blocked = 0
  let semi = 0
  for (const row of tiles) {
    for (const state of row) {
      if (state === 'blocked') blocked++
      else if (state === 'semi') semi++
    }
  }
  return { blocked, semi }
}

// Row-major index of FORCED_SEMI_CELL among semi tiles only — matches
// buildIsolatedTestBoard's own row-major placement order below, so whichever
// slot of `semiItems` this returns is the one buildIsolatedTestBoard will
// actually place onto that exact cell. -1 if the board is too small to have
// that cell, or it isn't (yet) a semi tile — placement.js's
// applyForcedSemiCell guarantees it will be by generation time, but this
// search also runs from the "is this goal even feasible" UI check before
// that, on the board's currently-saved tiles.
function forcedSemiIndex(tiles) {
  const { row: fr, col: fc } = FORCED_SEMI_CELL
  if (fr >= tiles.length || fc >= (tiles[0]?.length ?? 0)) return -1
  let i = 0
  for (let r = 0; r < tiles.length; r++) {
    for (let c = 0; c < tiles[r].length; c++) {
      if (r === fr && c === fc) return tiles[r][c] === 'semi' ? i : -1
      if (tiles[r][c] === 'semi') i++
    }
  }
  return -1
}

function decomposeReserved(value, minRank, maxRank, targetRank, desiredCount) {
  const items = decompose(value)
  // Cap at targetRank, not just maxRank: decompose() minimizes item count,
  // which for a large enough value can yield a single item already ABOVE
  // the target rank — meaning it was revealed whole, never individually
  // held at exactly targetRank, so "reached targetRank" would never get
  // recorded even though the value more than covers it. Forcing every item
  // to start at or below targetRank guarantees at least one of them either
  // IS targetRank directly, or a merge lands exactly on it on the way up.
  splitOversized(items, Math.min(maxRank, targetRank))
  // Split further into more, smaller items rather than a minimal few big
  // ones - a "ladder" of several matching-ish items placed at multiple
  // points along the climb (one to bridge into at rank 2, another at rank 3,
  // another at rank 4) gets used level by level as the player naturally
  // climbs, unlike a single large item that only pays off once, right at the
  // top. `desiredCount` is a per-attempt candidate now, not a single fixed
  // cap (see computeOnboardingReserve) - over-fragmenting (many small
  // identical items) was found live to sometimes be LESS reliably mergeable
  // within a tight DR budget than a leaner ladder of the same total value,
  // so the search tries a spread of counts rather than always maximizing it.
  splitToCount(items, Math.min(value, desiredCount))
  mergeUndersized(items, minRank)
  return items
}

// Board 1's semi tiles are always exactly rank 1 (except FORCED_SEMI_CELL,
// always rank 2 — see board.js), by explicit economist request — not a
// search variable the way the blocked queue is. They're visible and
// mergeable from turn zero, so keeping every one of them the single
// smallest, simplest, most predictable bootstrap item (rather than whatever
// rank a fragmentation search happened to land on - an earlier version of
// this search could legitimately place a rank 2 or 3 there to make a tight
// DR budget work) keeps the very start of the game uniform and easy to
// reason about. Whatever additional value a goal needs beyond what the semi
// tiles already provide lives entirely in the blocked queue - front-loaded,
// exact-sum, respecting the board's rank window - which is the only thing
// this search still has to find. `semiItems` is passed in pre-built by the
// caller (with the forced slot already set to rank 2), not computed here.
function buildIsolatedTestBoard(board, semiItems, blockedItems) {
  const tiles = board.tiles.map((row) => [...row])
  const semiPlacements = []
  let i = 0
  for (let r = 0; r < tiles.length && i < semiItems.length; r++) {
    for (let c = 0; c < tiles[r].length && i < semiItems.length; c++) {
      if (tiles[r][c] === 'semi') {
        semiPlacements.push({ row: r, col: c, rank: semiItems[i] })
        i += 1
      }
    }
  }
  for (let r = 0; r < tiles.length; r++) {
    for (let c = 0; c < tiles[r].length; c++) {
      if (tiles[r][c] === 'semi' && !semiPlacements.some((p) => p.row === r && p.col === c)) {
        tiles[r][c] = 'open'
      }
    }
  }
  return { rows: board.rows, cols: board.cols, tiles, semiPlacements, blockedQueue: blockedItems }
}

// Board-1-only: finds the smallest reservation (front-loaded, exact-sum,
// respecting the board's rank window) such that a player with `drBudget` DR
// reaches `targetRank` using only this reserve plus the generator — before
// the rest of the board's blockedValue is even considered. Returns null if
// infeasible within the chain's total value.
//
// No rcEvent parameter needed here, deliberately: rcEvent only ever adds a
// SEPARATE adjacent cell (FORCED_HIGHEST_RANK_CELL) whose rank is an
// ordinary rank-1 placeholder until placement.js's post-generation swap
// (which is sum-neutral), so this isolated check's own fixed-cost math is
// identical either way. FORCED_SEMI_CELL's rank 2 is unconditional again.
export function computeOnboardingReserve(board, { drBudget, targetRank }) {
  const { minRank } = board
  // Onboarding goals only ever apply to board 0 - clamp to its own hard
  // ceiling (rankWindow.js's effectiveMaxRank) so this isolated search's
  // own feasibility math can't rely on a rank the real board (placement.js)
  // would never actually generate.
  const maxRank = effectiveMaxRank(board.maxRank, 0)
  const { blocked: blockedTileCount, semi: semiTileCount } = countTiles(board.tiles)

  // Every semi tile is always rank 1 - not part of the search (see
  // buildIsolatedTestBoard's comment above) - except FORCED_SEMI_CELL, which
  // always holds rank 2 (board.js). This is a fixed cost, present whether or
  // not an onboarding goal is even set - the search below only has to find
  // how much MORE, front-loaded into the blocked queue, gets the player the
  // rest of the way.
  const semiItems = Array(semiTileCount).fill(1)
  const forcedIdx = forcedSemiIndex(board.tiles)
  if (forcedIdx >= 0) semiItems[forcedIdx] = FORCED_SEMI_RANK
  const semiValueTotal = semiItems.reduce((s, r) => s + valueOf(r), 0)

  // The reserve is meant to be a small early checkpoint, not a claim on most
  // of the board — it's typically a tiny fraction of blockedValue (a handful
  // of DR against a board designed for hundreds). Splitting it into as many
  // items as its own value would allow (up to every blocked tile on the
  // board) can leave too few slots for the remainder to represent its own —
  // usually far larger — share, which can silently drop a big chunk of it
  // (item count beyond the tile budget is a soft constraint, and its minimum
  // possible count can exceed a handful of leftover slots). Capping at half
  // the board's blocked tiles keeps the reserve's footprint proportionate —
  // placeItems' own sum-vs-real-board verification (see placement.js) is the
  // backstop if this cap still isn't tight enough for some layout.
  const maxItems = Math.max(1, Math.floor(blockedTileCount / 2))

  // Tries a few different merge-priority orderings before giving up on this
  // value, not just the main gameplay simulator's own default order - found
  // live: a one-shot "reach this specific rank ASAP" goal can be reachable
  // by a player choosing merges deliberately (or via a different priority)
  // even when the default "keep freshly-built items flexible" order runs out
  // of DR first. Only the first ordering ('free-free-first') reproduces
  // findLegalMerge's own default exactly; the others are onboarding-goal-
  // specific exploration, see pickMergeByStrategy in mergeSimulation.js.
  const MERGE_STRATEGIES = ['free-free-first', 'clear-stuck-first', 'highest-rank-first']

  // Up to 16 evenly-spread item counts between 1 and maxItems (deduplicated)
  // rather than always maximizing to maxItems - found live: fully
  // fragmenting a reserve (many small, often identical items) can be LESS
  // reliably mergeable within a tight DR budget than a leaner "ladder" of
  // the same total value, so this explores several shapes instead of
  // committing to only the most-fragmented one. Bounded at 16 candidates
  // regardless of board size so a big board's larger maxItems doesn't blow
  // up the number of simulate() calls this search runs.
  function candidateItemCounts() {
    const MAX_CANDIDATES = 16
    if (maxItems <= MAX_CANDIDATES) return Array.from({ length: maxItems }, (_, i) => i + 1)
    const counts = new Set()
    for (let i = 0; i < MAX_CANDIDATES; i++) {
      counts.add(1 + Math.round((i * (maxItems - 1)) / (MAX_CANDIDATES - 1)))
    }
    return [...counts].sort((a, b) => a - b)
  }

  function attempt(blockedValue) {
    // A tight maxRank cap (e.g. maxRank=1) forces splitOversized/
    // mergeUndersized to the same fully-fragmented shape regardless of
    // desiredCount — every candidate count collapses onto one identical
    // item list, which would otherwise re-run all 3 merge strategies
    // against the literal same board 16 times over. Skipping a blocked-item
    // shape already tried at this value cuts that redundant work without
    // changing which shapes get tested.
    //
    // Both queue orderings, not just descending: descending ("biggest item
    // revealed earliest") was right when semi tiles could host a big anchor
    // item themselves - but now that semi is always rank 1 (see above), the
    // natural winning shape is a bottom-up ladder (ascending: 2, then 3,
    // then 4, ...) that meets the player's own rank as it climbs from the
    // rank-1 semi bootstrap - a descending queue reveals its biggest item
    // before anything on the board can match it, wasting the reveal. Found
    // live: with semi=[1,1], blocked=[2,3,4] reached the target in the
    // isolated check while the descending [4,3,2] shape of the exact same
    // items did not. Trying both, rather than assuming ascending is always
    // better, keeps this correct if a future board shape favors the other.
    const triedShapes = new Set()
    for (const desiredCount of candidateItemCounts()) {
      const decomposed = decomposeReserved(blockedValue, minRank, maxRank, targetRank, desiredCount)
      const orderings = [[...decomposed].sort((a, b) => a - b), [...decomposed].sort((a, b) => b - a)]
      for (const blockedItems of orderings) {
        const shapeKey = blockedItems.join(',')
        if (triedShapes.has(shapeKey)) continue
        triedShapes.add(shapeKey)
        for (const mergeStrategy of MERGE_STRATEGIES) {
          const testBoard = buildIsolatedTestBoard(board, semiItems, blockedItems)
          const result = simulatePlaythrough([testBoard], { drBudget, mergeStrategy })
          if (result.reachedAt[targetRank] !== undefined) {
            return { ok: true, blockedItems, result }
          }
        }
      }
    }
    return { ok: false, blockedItems: [], result: null }
  }

  // Linear scan from 0, not a doubling-then-binary-search over value: reaching
  // targetRank draws on BOTH the reserve's own value AND whatever the
  // generator produces within drBudget (itself already capped separately),
  // so a reserve smaller than valueOf(targetRank) can still be sufficient —
  // found live, from a real board where the working reserve sat below
  // valueOf(targetRank), a value an old doubling search never even tried
  // since it only started there and went up. Worse, "attempt" isn't reliably
  // monotonic in blockedValue at all: a larger value can decompose into a
  // same-rank duplicate pair purely as an artifact of the maxRank cap and
  // split/merge shape, while a smaller value's decomposition avoids it - so
  // a value failing doesn't imply every larger value also fails, which is
  // exactly what binary search over "value" assumes. A plain increasing scan
  // has no such assumption baked in: the first value that succeeds IS the
  // minimum, by construction, whatever the shape of the feasible set looks
  // like.
  //
  // Bounded at a generous multiple of valueOf(targetRank), not always
  // CEILING - the reserve is meant to be "a small early checkpoint" (see
  // maxItems above), so the true minimum, when one exists, is overwhelmingly
  // likely to live in this range. Anything above this bound falls back to a
  // coarse doubling probe instead of exhaustive coverage, accepting the cost
  // of possibly missing an isolated feasible pocket far beyond a sane
  // reserve size (which would show up as "unreachable" rather than a giant
  // reservedValue the economist was never going to accept anyway).
  //
  // Wall-clock deadline, not just a value bound: when targetRank is already
  // MAX_RANK, valueOf(targetRank) equals CEILING itself, so the multiplier
  // above can't shrink anything - and a tight maxRank cap (e.g. maxRank=1
  // against a rank-12 target) forces every decomposition toward hundreds or
  // thousands of same-rank items, making each attempt() itself expensive
  // (simulatePlaythrough cost scales with item count). Measured live: a
  // genuinely-infeasible board in that shape took ~7s to exhaust the full
  // value range - a real UI freeze on an explicit "Generate items" click,
  // not a hypothetical. This is the outer safety net for that: every
  // legitimate case this session was verified against completes in well
  // under 50ms, so a few-hundred-ms budget leaves a large margin before
  // giving up and reporting "unreachable" - the same practical outcome as a
  // proven impossibility, just reached by search-effort exhaustion instead
  // of full coverage, for a config degenerate enough to hit it at all.
  const DEADLINE_MS = 400
  const deadline = Date.now() + DEADLINE_MS
  const exhaustiveBound = Math.min(CEILING, valueOf(targetRank) * 8)
  for (let blockedValue = 0; blockedValue <= exhaustiveBound; blockedValue++) {
    if (Date.now() > deadline) return null
    const a = attempt(blockedValue)
    if (a.ok) {
      return {
        reservedValue: semiValueTotal + blockedValue,
        semiItems,
        blockedItems: a.blockedItems,
        drSpentToTarget: a.result.reachedAt[targetRank],
      }
    }
  }
  for (let blockedValue = exhaustiveBound * 2; blockedValue <= CEILING; blockedValue *= 2) {
    if (Date.now() > deadline) return null
    const a = attempt(blockedValue)
    if (a.ok) {
      return {
        reservedValue: semiValueTotal + blockedValue,
        semiItems,
        blockedItems: a.blockedItems,
        drSpentToTarget: a.result.reachedAt[targetRank],
      }
    }
  }
  return null
}
