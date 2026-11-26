// THE SAVED PIECE ORDER. The config writes a board's prices in a shuffled
// order; the shuffle is made once, saved with the event's revision and only a
// button makes a new one (opening or recalculating never does). A piece keeps
// its id (1..24, its rank in cost within the board); the order says where each
// id is written. Board 1 starts with its cheapest piece (economist).

import { MAX_PIECES, RC_SEGMENTS } from './model'

/** mulberry32: a small seeded generator, the same numbers for the same seed. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

export function shuffled(n: number, next: () => number): number[] {
  const a = Array.from({ length: n }, (_, i) => i + 1)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/** Board 1's first written piece must be piece 1 (its cheapest): swap piece 1 into that place. */
export function cheapestFirst(order: number[], firstBoardPieces: number): number[] {
  const out = [...order]
  const at = out.findIndex((id) => id <= firstBoardPieces)
  const one = out.indexOf(1)
  if (at >= 0 && one >= 0 && at !== one) [out[at], out[one]] = [out[one]!, out[at]!]
  return out
}

export function newOrders(seed: number, firstBoardPieces = 6): { seed: number; regular: number[]; rc: number[][] } {
  const next = rng(seed)
  return {
    seed,
    regular: cheapestFirst(shuffled(MAX_PIECES, next), firstBoardPieces),
    rc: Array.from({ length: RC_SEGMENTS }, () => shuffled(MAX_PIECES, next)),
  }
}

/** Every id 1..24 exactly once. */
export function isPermutation(order: readonly number[]): boolean {
  if (order.length !== MAX_PIECES) return false
  const seen = new Set(order)
  return seen.size === MAX_PIECES && order.every((id) => Number.isInteger(id) && id >= 1 && id <= MAX_PIECES)
}

/** The piece ids of a board of n pieces, in the order the config writes them. */
export const boardOrder = (order: readonly number[], n: number) => order.filter((id) => id <= n)

/** Where (1-based "Item" column) each piece id is written on a board of n pieces. */
export function positionsOf(order: readonly number[], n: number): Map<number, number> {
  return new Map(boardOrder(order, n).map((id, i) => [id, i + 1]))
}
