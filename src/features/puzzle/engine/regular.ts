// THE REGULAR PUZZLE ECONOMY: workbook sheets "Puzzle" and "Puzzle - Pieces
// Cost", ported formula by formula. One segment at a time, the way the
// workbook computes the segment selected in Puzzle!R5 - so a segment's numbers
// here are what the workbook shows with that segment selected. computeRegular
// runs all nine.

import { round } from './excel'
import { REGULAR_PIECES, REGULAR_SEGMENTS, type PuzzleEvent } from './model'

export type DayRow = {
  day: number
  /** (1 + inflation)^(day - 1) */
  inflation: number
  /** Allowance worth of one dr-puzzle on this day (worth / inflation). */
  pieceValue: number
  /** Share of the puzzle's effort planned for this day, and the running total (workbook "Completion Rate - Real"). */
  progress: number
  cumulative: number
  /** Puzzle_DR_Per_Day */
  mtx: number
  total: number
  mtxRatio: number
  levelWinRatio: number
  wheelAreaRatio: number
  modeMultiplier: number
}

export type PieceRow = {
  tier: number
  piece: number
  /** Effort share of this piece (Piece Rate) and the running total. */
  rate: number
  rateInTier: number
  aggRate: number
  day: number
  inflation: number
  modeMultiplier: number
  costWithoutInflation: number
  costWithInflation: number
  /** dr-puzzle of the previous board's reward, reinvested into this board. */
  previousReward: number
  /** The price the config writes ("Cost With Rewards"), price cut included when it is on. */
  cost: number
  /** The same without the price cut (Price Cut exports both). */
  baseCost: number
}

export type TierRow = {
  tier: number
  pieces: number
  rate: number
  rateStart: number
  startDay: number
  endDay: number
  cost: number
  baseCost: number
  costWithoutInflation: number
}

export type RegularSegment = {
  segment: number
  winsForEconomy: number
  pieceWorth: number
  /** Points Before Factor = wins x days x base points factor. */
  points: number
  basePointsFactor: number
  shares: [number, number, number, number]
  days: DayRow[]
  pieces: PieceRow[]
  tiers: TierRow[]
  totalCost: number
  totalWithoutInflationAndRewards: number
}

export const pieceWorthOf = (ev: PuzzleEvent, segment: number) =>
  (ev.economy.pieceWorthTwoWeeks[segment - 1] ?? 0) * (ev.setup.length === 'week' ? ev.economy.weekWorthFactor : 1)

/** The six effort shares: five typed, the last is what is left (workbook G7 = 1 - SUM(G2:G6)). */
export function effortShares(ev: PuzzleEvent): number[] {
  const five = ev.economy.effort.slice(0, 5)
  return [...five, 1 - five.reduce((a, b) => a + b, 0)]
}

/** Mode shares of a segment: w_i * 2^(i-1) / sum (workbook AZ22:BC22). */
export function modeShares(mix: readonly number[]): [number, number, number, number] {
  const [a = 0, b = 0, c = 0, d = 0] = mix
  const den = a + b * 2 + c * 4 + d * 8
  return [a / den, (2 * b) / den, (4 * c) / den, (8 * d) / den]
}

const sumproduct = (xs: readonly number[], ys: readonly number[]) => xs.reduce((acc, x, i) => acc + x * (ys[i] ?? 0), 0)

function dayTable(ev: PuzzleEvent, shares: readonly number[], pieceWorth: number): DayRow[] {
  const { days, inflation: r, mtxBaseline } = ev.setup
  const { levelWin, wheel, areaReward } = ev.economy.sources
  const mm = ev.economy.modeMultipliers
  const ch = ev.economy.challengeRate
  const beforeMtx = mtxBaseline + levelWin + wheel + areaReward
  const rows: DayRow[] = []
  let cumulative = 0
  for (let d = 1; d <= days; d++) {
    const factor = (1 + r) ** (d - 1)
    const goal = beforeMtx * factor
    const mtx = goal - beforeMtx
    const total = mtx + mtxBaseline + levelWin + wheel + areaReward
    const mtxRatio = (mtx + mtxBaseline) / total
    const levelWinRatio = levelWin / total
    const wheelAreaRatio = (wheel + areaReward) / total
    const modeMultiplier =
      mtxRatio * sumproduct(mm.challenges, shares) * ch + (1 - ch) * mtxRatio + levelWinRatio * sumproduct(mm.levelWin, shares) + wheelAreaRatio * sumproduct(mm.wheel, shares)
    const progress = ev.economy.progression[d - 1] ?? 0
    cumulative += progress
    rows.push({ day: d, inflation: factor, pieceValue: pieceWorth / factor, progress, cumulative, mtx, total, mtxRatio, levelWinRatio, wheelAreaRatio, modeMultiplier })
  }
  return rows
}

/** XLOOKUP(x, cumulative, day, XLOOKUP(x, cumulative, day,, -1), 1): the first day that reaches x, else the last one below it. */
function dayOf(rows: readonly DayRow[], x: number): DayRow {
  const hit = rows.find((r) => r.cumulative >= x)
  if (hit) return hit
  let last = rows[0]!
  for (const r of rows) if (r.cumulative <= x) last = r
  return last
}

/** Price Cut adds difficulty to regular boards 5 and 6 (economist); rewards never change. */
export function priceCutFactor(ev: PuzzleEvent, tier: number): number {
  if (ev.setup.mode !== 'price-cut') return 1
  if (tier === 5) return 1 + ev.priceCut.tier5
  if (tier === 6) return 1 + ev.priceCut.tier6
  return 1
}

export function computeRegularSegment(ev: PuzzleEvent, segment: number): RegularSegment {
  const seg = ev.economy.segments[segment - 1]
  if (!seg) throw new Error(`No segment ${segment}`)
  const pieceWorth = pieceWorthOf(ev, segment)
  const shares = modeShares(seg.modeMix)
  const days = dayTable(ev, shares, pieceWorth)
  const basePointsFactor = ev.setup.mtxBaseline + ev.economy.sources.levelWin + ev.economy.sources.wheel + ev.economy.sources.areaReward
  const points = seg.winsForEconomy * ev.setup.days * basePointsFactor
  const rates = effortShares(ev)
  const rewards = ev.rewards.regular[segment - 1] ?? []
  const pieces: PieceRow[] = []
  let aggRate = 0
  REGULAR_PIECES.forEach((n, ti) => {
    const tier = ti + 1
    const tierRate = rates[ti] ?? 0
    const previousReward = tier === 1 ? 0 : (rewards[ti - 1]?.drAmount ?? 0)
    const pcf = priceCutFactor(ev, tier)
    for (let k = 1; k <= n; k++) {
      const rate = (tierRate * k) / (((1 + n) * n) / 2)
      const rateInTier = rate / tierRate
      aggRate += rate
      const d = dayOf(days, aggRate)
      const base = rate * points * d.inflation * d.modeMultiplier
      pieces.push({
        tier,
        piece: k,
        rate,
        rateInTier,
        aggRate,
        day: d.day,
        inflation: d.inflation,
        modeMultiplier: d.modeMultiplier,
        costWithoutInflation: round(rate * points * d.modeMultiplier, 0),
        costWithInflation: round(rate * points * d.inflation * d.modeMultiplier * pcf, 0),
        previousReward,
        cost: Math.max(2, round((base + previousReward * rateInTier) * pcf, 0)),
        baseCost: Math.max(2, round((base + previousReward * rateInTier) * 1, 0)),
      })
    }
  })
  let rateStart = 0
  const tiers: TierRow[] = REGULAR_PIECES.map((n, ti) => {
    const tier = ti + 1
    const own = pieces.filter((p) => p.tier === tier)
    const row: TierRow = {
      tier,
      pieces: n,
      rate: rates[ti] ?? 0,
      rateStart,
      startDay: own[0]?.day ?? 0,
      endDay: Math.max(...own.map((p) => p.day)),
      cost: own.reduce((a, p) => a + p.cost, 0),
      baseCost: own.reduce((a, p) => a + p.baseCost, 0),
      costWithoutInflation: own.reduce((a, p) => a + p.costWithoutInflation, 0),
    }
    rateStart += rates[ti] ?? 0
    return row
  })
  return {
    segment,
    winsForEconomy: seg.winsForEconomy,
    pieceWorth,
    points,
    basePointsFactor,
    shares,
    days,
    pieces,
    tiers,
    totalCost: tiers.reduce((a, t) => a + t.cost, 0),
    totalWithoutInflationAndRewards: tiers.reduce((a, t) => a + t.costWithoutInflation, 0),
  }
}

/** All nine segments - never only the one on screen. */
export function computeRegular(ev: PuzzleEvent): RegularSegment[] {
  return Array.from({ length: REGULAR_SEGMENTS }, (_, i) => computeRegularSegment(ev, i + 1))
}

/** The prices of one board in the saved order (Puzzle - Config: the order's ids of this board, then their prices). */
export function orderedCosts(order: readonly number[], costs: readonly number[]): { piece: number; cost: number }[] {
  return order.filter((id) => id <= costs.length).map((id) => ({ piece: id, cost: costs[id - 1]! }))
}
