// RECOMPLETION (RC): workbook "Puzzle - RC Simulator" and "RC config new".
// Eleven segments, three boards of 16/20/24 pieces. A segment's DR budget is
// a stored input (economist: "Preserve stored DR budgets as explicit inputs"),
// split 10/25/65% by default; prices rise with the piece's rank; coins are
// valued from the last day's piece worth and capped against the regular
// puzzle's prize of the matching board.

import { numberText, round } from './excel'
import { RC_PIECES, RC_SEGMENTS, REGULAR_SEGMENTS, type PuzzleEvent } from './model'
import { computeRegularSegment } from './regular'
import { BASKET_COUNTER, PACK_COUNTER } from './rewards'
import { boardOrder } from './shuffle'

export type RcTierRow = {
  tier: number
  pieces: number
  /** Budget share x the segment's DR (workbook B43). */
  tierDr: number
  /** The same with the Price Cut on board 3 (workbook J43); the prices come from this. */
  tierDrPriced: number
  /** Tier DR x last-day piece worth (D). */
  tierValue: number
  otherWorth: number
  coinValue: number
  coinsBeforeCap: number
  /** The matching regular board's coins x the cap (L). */
  cap: number
  capFactor: number
  coins: number
  syntax: string
  /** Prices by piece id (1..n): ROUND(tier DR x id / (n(n+1)/2)). */
  costs: number[]
  /** The prices in the saved order, as "RC config new" writes them. */
  ordered: { piece: number; cost: number }[]
  total: number
}

export type RcSegment = { segment: number; key: string; totalDr: number; tiers: RcTierRow[] }

/** RC Segments Generator B7: the start date's day and month, "1711". */
export function rcKeySuffix(ev: PuzzleEvent): string {
  const d = ev.setup.start.slice(0, 10)
  return `${d.slice(8, 10)}${d.slice(5, 7)}`
}
export const rcKey = (ev: PuzzleEvent, segment: number) => `Puzzle_RC_seg${segment}_${rcKeySuffix(ev)}`

/** Piece worth on the event's last day, from the reference segment (workbook RC Simulator B9). */
export function rcPieceValue(ev: PuzzleEvent): number {
  const seg = computeRegularSegment(ev, ev.rc.pieceValueSegment)
  return seg.days[seg.days.length - 1]?.pieceValue ?? Number.NaN
}

export function rcTierSyntax(ev: PuzzleEvent, tierIndex: number, coins: number): string {
  const t = ev.rc.tiers[tierIndex]!
  // The simulator always writes the coins, 0 included ("allowance:milestone(coins:0)").
  return [
    `${t.milestone ? 'allowance:milestone(coins:' : 'allowance(coins:'}${numberText(coins)})`,
    t.wild > 0 ? `free_wild:${t.wild}` : '',
    t.stock > 0 ? `free_stock:${t.stock}` : '',
    t.undo > 0 ? `free_undo:${t.undo}` : '',
    t.freeRound > 0 ? `free_entry:${t.freeRound}` : '',
    t.drAmount > 0 ? `[dynamic(${ev.rewards.drName}:${t.drAmount})]` : '',
    t.packKey !== '' ? `[sticker_pack:${t.packKey}|${t.packAlt}]` : '',
    t.packKey !== '' ? PACK_COUNTER : '',
    t.trigger !== '' ? `trigger:${t.trigger}` : '',
    t.basketKey !== '' ? `preset:${t.basketKey}` : '',
    t.basketKey !== '' ? BASKET_COUNTER : '',
  ]
    .filter(Boolean)
    .join('+')
}

export function computeRc(ev: PuzzleEvent): RcSegment[] {
  const pieceValue = rcPieceValue(ev)
  const totals = ev.rc.totals[ev.setup.length]
  const out: RcSegment[] = []
  for (let s = 1; s <= RC_SEGMENTS; s++) {
    const totalDr = totals[s - 1] ?? 0
    // Segments above the last regular one take the last regular one's prizes (workbook MIN(seg, MAX(segment))).
    const matchSeg = Math.min(s, REGULAR_SEGMENTS)
    const order = ev.order.rc[s - 1] ?? []
    const tiers = RC_PIECES.map((n, ti): RcTierRow => {
      const t = ev.rc.tiers[ti]!
      const tierDr = totalDr * t.share
      const pc = ev.setup.mode === 'price-cut' && ti === 2 ? 1 + ev.priceCut.rcTier3 : 1
      const tierDrPriced = tierDr * pc
      const tierValue = tierDr * pieceValue
      const otherWorth = t.stock * 2 + t.wild * 2.5 + t.undo * 0.25 + t.freeRound * 1 + t.basketValue
      const coinValue = Math.max(0, tierValue * t.valueFactor - otherWorth)
      const coinsBeforeCap = round(coinValue / ev.rc.coinValue, 1)
      const matchCoins = ev.rewards.regular[matchSeg - 1]?.[t.matchTier - 1]?.coins ?? 0
      const cap = matchCoins * ev.rc.cap
      const capFactor = coinsBeforeCap > 0 ? Math.min(1, cap / coinsBeforeCap) : 1
      const coins = round(coinsBeforeCap * capFactor, 1)
      const tri = (n * (n + 1)) / 2
      const costs = Array.from({ length: n }, (_, k) => round((tierDrPriced * (k + 1)) / tri, 0))
      const ordered = boardOrder(order, n).map((id) => ({ piece: id, cost: costs[id - 1]! }))
      return {
        tier: ti + 1,
        pieces: n,
        tierDr,
        tierDrPriced,
        tierValue,
        otherWorth,
        coinValue,
        coinsBeforeCap,
        cap,
        capFactor,
        coins,
        syntax: rcTierSyntax(ev, ti, coins),
        costs,
        ordered,
        total: costs.reduce((a, b) => a + b, 0),
      }
    })
    out.push({ segment: s, key: rcKey(ev, s), totalDr, tiers })
  }
  return out
}
