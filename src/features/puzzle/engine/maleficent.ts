// MALEFICENT: a wheel paid in dr-puzzle; filling the Boss Bar removes pieces
// from the board. Ported from the workbook's "Maleficent", "Maleficent -
// Config" and "Maleficent RC - Config" exactly - the Boss Bar included, with
// its helper damage series (economist: no new probability or EV model).

import { roundUp, round } from './excel'
import type { MaleficentTier, PuzzleEvent, Spin, WheelTier } from './model'
import { positionsOf } from './shuffle'

export type Removal = {
  /** The target: ROUND(board DR x removal % / 100). */
  target: number
  /** Chosen piece ids (1..n, cheapest first), in the workbook's own order. */
  pieces: number[]
  /** The same pieces as written in the config: their Item positions after the shuffle, ascending. */
  positions: number[]
  droppedTotal: number
  gap: number
  /** True when the cheap pieces could not be kept (the target is above the rest). */
  keptDropped: boolean
}

/**
 * Maleficent!J13 - which pieces are removed. Pieces sorted by cost then id;
 * keep the cheapest `kept` unless the target is more than all the others;
 * then the best of "a prefix of the cheapest + one more piece that still
 * fits", the last of equal totals.
 */
export function selectRemoved(costsById: readonly number[], target: number, kept: number): { pieces: number[]; total: number; keptDropped: boolean } {
  if (target === 0) return { pieces: [], total: 0, keptDropped: false }
  const srt = costsById.map((cost, i) => ({ id: i + 1, cost })).sort((a, b) => a.cost - b.cost || a.id - b.id)
  const rest = srt.slice(kept).reduce((a, p) => a + p.cost, 0)
  const keep = target > rest ? 0 : kept
  const cand = keep === 0 ? srt : srt.slice(keep)
  const n = cand.length
  const pre = [0]
  for (const p of cand) pre.push(pre[pre.length - 1]! + p.cost)
  const bx: number[] = []
  const tot: number[] = []
  for (let m = 0; m <= n; m++) {
    const s = pre[m]!
    if (s > target) {
      bx.push(-1)
      tot.push(-1)
      continue
    }
    let best = 0
    for (let i = m; i < n; i++) if (cand[i]!.cost <= target - s && cand[i]!.cost > best) best = cand[i]!.cost
    bx.push(best)
    tot.push(s + best)
  }
  const max = Math.max(...tot)
  const bestIdx = tot.lastIndexOf(max)
  const m = bestIdx
  const x = bx[bestIdx]!
  const cheap = cand.slice(0, m).map((p) => p.id)
  const closer = x > 0 ? cand.slice(m).find((p) => p.cost === x)?.id : undefined
  return { pieces: closer != null ? [...cheap, closer] : cheap, total: tot[bestIdx]!, keptDropped: keep === 0 && kept > 0 }
}

export function removalFor(costsById: readonly number[], order: readonly number[], tier: MaleficentTier, kept: number): Removal | null {
  if (!tier.active || !(tier.removal > 0)) return null
  const size = costsById.reduce((a, b) => a + b, 0)
  const target = round((size * tier.removal) / 100, 0)
  const r = selectRemoved(costsById, target, kept)
  const pos = positionsOf(order, costsById.length)
  return {
    target,
    pieces: r.pieces,
    positions: r.pieces.map((id) => pos.get(id)!).sort((a, b) => a - b),
    droppedTotal: r.total,
    gap: r.total - target,
    keptDropped: r.keptDropped,
  }
}

/** "Removed Items": positions joined by commas; "NONE" when the boss is on and nothing is removed; blank without a boss. */
export function removedItemsText(tier: MaleficentTier, removal: Removal | null): string {
  if (!tier.active) return ''
  if (!removal || removal.positions.length === 0) return 'NONE'
  return removal.positions.join(',')
}

/** AVERAGEIF(damage, "<>0"): the mean of the typed damage values that are not zero. */
export function averageDamage(spins: readonly Spin[]): number | null {
  const v = spins.map((s) => s.damage).filter((d) => d !== 0 && Number.isFinite(d))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/** Boss Bar = ROUNDUP(average non-zero damage x board DR x difficulty, -1) (Maleficent!Y40). Blank without a boss. */
export function bossBar(tier: MaleficentTier, wheel: WheelTier | undefined, boardDr: number): number | null {
  if (!tier.active || !wheel) return null
  const avg = averageDamage(wheel.spins)
  if (avg == null) return null
  const v = roundUp(avg * boardDr * (tier.difficulty / 100), -1)
  return v === 0 ? null : round(v, 0)
}

/** "Buckets": the spin buckets in order, a run of the same bucket written once ("1,1,1,17" -> "1,17"). */
export function bucketsText(spins: readonly Spin[]): string {
  const out: number[] = []
  for (const s of spins) if (out[out.length - 1] !== s.bucket) out.push(s.bucket)
  return out.join(',')
}

/** "Maleficent Difficulty (DR)" (H13): the share of the board's DR the boss asks for. */
export const bossDifficultyDr = (tier: MaleficentTier, boardDr: number) => round((boardDr * tier.difficulty) / 100, 0)

/** References a config makes that the wheel tables do not hold. */
export function wheelProblems(ev: PuzzleEvent): string[] {
  const m = ev.maleficent
  const out: string[] = []
  const bucketIds = new Set(m.buckets.map((b) => b.id))
  const wedgeIds = new Set(m.wedges.map((w) => w.id))
  const layoutIds = new Set(m.layouts.map((l) => l.id))
  const mults = new Set(m.multipliers.map((x) => x.multiplier))
  for (const b of m.buckets) {
    for (const part of b.wedges.split(',').map((p) => p.trim()).filter(Boolean)) {
      const id = part.replace(/\(\d+\)$/, '')
      if (!wedgeIds.has(id)) out.push(`Bucket ${b.id} names a wedge "${id}" the wedge table does not have.`)
    }
  }
  const check = (label: string, tiers: readonly MaleficentTier[], wheels: readonly WheelTier[]) =>
    tiers.forEach((t, i) => {
      if (!t.active) return
      const w = wheels[i]
      if (!w) return void out.push(`${label} board ${i + 1}: the boss is on but there is no wheel.`)
      for (const s of w.spins) if (!bucketIds.has(s.bucket)) out.push(`${label} board ${i + 1}: spin bucket ${s.bucket} is not in the bucket table.`)
      if (m.layouts.length && w.wheelLayout && !layoutIds.has(w.wheelLayout)) out.push(`${label} board ${i + 1}: wheel layout ${w.wheelLayout} is not in the layout table.`)
      if (m.multipliers.length)
        for (const x of w.wheelMultiplier.split(',').map((v) => Number(v.trim())).filter((v) => v > 0))
          if (!mults.has(x)) out.push(`${label} board ${i + 1}: multiplier ${x} is not in the multiplier table.`)
      if (averageDamage(w.spins) == null) out.push(`${label} board ${i + 1}: no damage typed for its spins, so there is no Boss Bar.`)
    })
  check('Regular', m.tiers, m.regularWheel)
  check('RC', m.rcTiers, m.rcWheel)
  for (const l of m.layouts) for (const w of l.wedges) if (w && !wedgeIds.has(w)) out.push(`Layout ${l.id} names a wedge "${w}" the wedge table does not have.`)
  return out
}
