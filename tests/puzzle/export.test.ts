import { describe, expect, it } from 'vitest'
import { computeAll } from '../../src/features/puzzle/engine/compute'
import { round } from '../../src/features/puzzle/engine/excel'
import { buildExportPlan, exportTitle, type ExportPlan } from '../../src/features/puzzle/engine/exportPlan'
import { createDefaultEvent, type PuzzleEvent } from '../../src/features/puzzle/engine/model'
import { boardOrder, cheapestFirst, isPermutation, newOrders, positionsOf } from '../../src/features/puzzle/engine/shuffle'

function event(mode: PuzzleEvent['setup']['mode']) {
  const ev = createDefaultEvent({ name: 'Test event', start: '2026-12-01T10:00', length: 'two-weeks' })
  ev.setup.mode = mode
  ev.setup.weekendCutoff = '2026-12-05T00:00'
  ev.order = newOrders(42)
  ev.segmentation.firstPuzzle = [
    { key: 'Puzzle_V2_Test_1st_5_days', from: '2026-12-05T11:00:00', to: '2026-12-10T11:00:00', economySegmentNote: '3' },
    { key: 'Puzzle_V2_Test_1st_10_days', from: '2026-12-10T11:00:00', to: '', economySegmentNote: '2' },
  ]
  return ev
}
const plan = (ev: PuzzleEvent) => buildExportPlan(ev, computeAll(ev)) as ExportPlan
const write = (p: ExportPlan, range: string) => p.writes.find((w) => w.range === range)?.values

describe('saved shuffle', () => {
  it('keeps every piece once, the same for the same seed, and starts board 1 with piece 1', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const o = newOrders(seed)
      expect(isPermutation(o.regular)).toBe(true)
      o.rc.forEach((r) => expect(isPermutation(r)).toBe(true))
      expect(boardOrder(o.regular, 6)[0]).toBe(1)
      expect(newOrders(seed)).toEqual(o)
    }
    expect(cheapestFirst([3, 9, 1, 2], 6)).toEqual([1, 9, 3, 2])
  })
  it('positions map a piece id to the Item column of its board', () => {
    const pos = positionsOf([7, 2, 23, 1, 5], 6)
    expect([...pos.entries()]).toEqual([[2, 1], [1, 2], [5, 3]])
  })
})

describe('export plan', () => {
  it('Standard has no approved template: nothing is written, it says so', () => {
    const p = buildExportPlan(event('standard'), computeAll(event('standard')))
    expect(p.template).toBeNull()
    expect(p.problems[0]).toMatch(/no approved Google Sheets template/)
  })

  it('names the file by the template rule', () => {
    expect(exportTitle(event('price-cut'))).toBe('t_Puzzle|n_Test event|ds_20261201|de_20261213')
  })

  it('Price Cut: the same rewards in both blocks; boards 1-4 unchanged; 5 and 6 cost more, from the price-cut rule', () => {
    const ev = event('price-cut')
    const p = plan(ev)
    const r = computeAll(ev)
    for (let s = 1; s <= 9; s++) {
      const base = write(p, `'Seg ${s}'!A2:Z7`)!
      const cut = write(p, `'Seg ${s}'!A12:Z17`)!
      base.forEach((row, i) => expect(cut[i]![1]).toBe(row[1]))
      for (let t = 0; t < 4; t++) expect(cut[t]).toEqual(base[t])
      const seg = r.regular[s - 1]!
      for (const piece of seg.pieces.filter((x) => x.tier >= 5)) {
        const f = piece.tier === 5 ? 1.15 : 1.3
        const unrounded = piece.rate * seg.points * piece.inflation * piece.modeMultiplier + piece.previousReward * piece.rateInTier
        expect(piece.cost).toBe(Math.max(2, round(unrounded * f, 0)))
        expect(piece.baseCost).toBe(Math.max(2, round(unrounded, 0)))
      }
    }
    // And the rewards are the Standard event's.
    const std = computeAll(event('standard'))
    r.regular.forEach((seg, i) => expect(seg.rewards.map((x) => x.syntax)).toEqual(std.regular[i]!.rewards.map((x) => x.syntax)))
    // RC board 3 costs 15% more; boards 1-2 and every reward are the same.
    r.rc.forEach((seg, i) => {
      const st = std.rc[i]!
      expect(seg.tiers.map((t) => t.syntax)).toEqual(st.tiers.map((t) => t.syntax))
      expect(seg.tiers[0]!.costs).toEqual(st.tiers[0]!.costs)
      expect(seg.tiers[2]!.tierDrPriced).toBeCloseTo(st.tiers[2]!.tierDr * 1.15, 9)
    })
  })

  it('Maleficent: Removed Items are written positions and point back at the chosen pieces', () => {
    const ev = event('maleficent')
    const p = plan(ev)
    const r = computeAll(ev)
    for (const seg of r.regular) {
      const rows = write(p, `'Seg ${seg.segment}'!A3:AH8`)!
      seg.boss!.forEach((b, i) => {
        const row = rows[i]!
        if (!b.active) return expect(row.slice(1, 9).every((c) => c === '')).toBe(true)
        expect(row[7]).toBe(b.removedItems)
        const written = row.slice(10).filter((c) => c !== '') as number[]
        const total = b.removedItems === 'NONE' ? 0 : b.removedItems.split(',').map(Number).reduce((a, pos) => a + written[pos - 1]!, 0)
        expect(total).toBe(b.removal?.droppedTotal ?? 0)
      })
    }
    // A new shuffle changes the positions, never the pieces chosen or their total.
    const again = { ...ev, order: newOrders(7) }
    const r2 = computeAll(again)
    r2.regular.forEach((seg, i) => seg.boss!.forEach((b, t) => {
      expect(b.removal?.pieces).toEqual(r.regular[i]!.boss![t]!.removal?.pieces)
      expect(b.removal?.droppedTotal).toEqual(r.regular[i]!.boss![t]!.removal?.droppedTotal)
    }))
  })

  it('the same event gives the same plan (no shuffle while exporting)', () => {
    const ev = event('maleficent')
    expect(JSON.stringify(plan(ev))).toBe(JSON.stringify(plan(ev)))
  })

  it('an Event Data key of the other template is refused, not renamed', () => {
    const ev = event('price-cut')
    ev.templates.eventData = { 'Boss Template Id': 'x' }
    expect(plan(ev).problems.join(' ')).toMatch(/"Boss Template Id" is not a row of the Price Cut template/)
  })
})
