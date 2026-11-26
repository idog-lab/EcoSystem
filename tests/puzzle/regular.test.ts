import { describe, expect, it } from 'vitest'
import { computeRegular, computeRegularSegment } from '../../src/features/puzzle/engine/regular'
import { hasWorkbook, workbook, workbookEvent } from './workbook'

describe.skipIf(!hasWorkbook)('regular economy matches the workbook', () => {
  const ev = workbookEvent()

  it('segment 9 (the one selected in the workbook): every piece, every column', () => {
    const seg = computeRegularSegment(ev, 9)
    const rows = workbook.puzzle_expected.pieces_cost_A2_T88
    expect(seg.pieces).toHaveLength(87)
    seg.pieces.forEach((p, i) => {
      const r = rows[i]
      expect([p.tier, p.piece]).toEqual([r[0], r[2]])
      expect(p.rate).toBeCloseTo(r[6], 12)
      expect(p.day).toBe(r[9])
      expect(p.inflation).toBeCloseTo(r[10], 10)
      expect(p.modeMultiplier).toBeCloseTo(r[11], 10)
      expect(p.costWithoutInflation).toBe(r[12])
      expect(p.costWithInflation).toBe(r[13])
      expect(p.previousReward).toBe(r[14])
      expect(p.cost).toBe(r[15])
    })
  })

  it('segment 9: board totals, days and the inputs derived from it', () => {
    const seg = computeRegularSegment(ev, 9)
    const s = workbook.puzzle_expected.structure_A2_O7
    seg.tiers.forEach((t, i) => {
      expect([t.startDay, t.endDay, t.cost, t.costWithoutInflation]).toEqual([s[i][9], s[i][10], s[i][11], s[i][13]])
    })
    expect(seg.points).toBe(workbook.puzzle_expected.R9)
    expect(seg.basePointsFactor).toBe(workbook.puzzle_expected.R8)
    const dd = workbook.puzzle_expected.dr_per_day_AG2_AW16
    seg.days.forEach((d, i) => expect(d.modeMultiplier).toBeCloseTo(dd[i][16], 10))
  })

  it('all nine segments: the total DR cost of the puzzle (Puzzle!D13:D21, "all segments live")', () => {
    const all = computeRegular(ev)
    const expected = workbook.puzzle_expected.dr_cost_by_segment_A13_D21
    all.forEach((seg, i) => {
      expect(seg.segment).toBe(expected[i][0])
      expect(seg.winsForEconomy).toBe(expected[i][1])
      expect(seg.points).toBe(expected[i][2])
      expect(seg.totalCost).toBe(expected[i][3])
    })
  })
})
