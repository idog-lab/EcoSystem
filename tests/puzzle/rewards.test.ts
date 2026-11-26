import { describe, expect, it } from 'vitest'
import { computeRegular, computeRegularSegment } from '../../src/features/puzzle/engine/regular'
import { regularRewards, tierAllowance, tierAllowanceForCalculation } from '../../src/features/puzzle/engine/rewards'
import { hasWorkbook, workbook, workbookEvent } from './workbook'

describe.skipIf(!hasWorkbook)('board rewards match the workbook', () => {
  const ev = workbookEvent()
  const rowsOf = (seg: number) => [1, 2, 3, 4, 5, 6].map((t) => (seg - 1) * 9 + t)

  it('worth (J, L) and the reward text (S) of every board of every segment', () => {
    for (const seg of computeRegular(ev)) {
      const rewards = regularRewards(ev, seg)
      rowsOf(seg.segment).forEach((row, i) => {
        const j = workbook.rewards_expected.rows_J17_U95[row]
        const s = workbook.rewards_expected.S17_T95[row]
        const t = ev.rewards.regular[seg.segment - 1]![i]!
        expect(tierAllowance(t)).toBeCloseTo(j[0], 10)
        expect(tierAllowanceForCalculation(t)).toBeCloseTo(j[2], 10)
        expect(rewards[i]!.syntax).toBe(s[0])
      })
    }
  })

  it('the effort worth of segment 9 (Q), the one the workbook had selected', () => {
    const seg = computeRegularSegment(ev, 9)
    const rewards = regularRewards(ev, seg)
    rowsOf(9).forEach((row, i) => expect(rewards[i]!.effortWorth).toBeCloseTo(workbook.rewards_expected.rows_J17_U95[row][7], 8))
  })

  it('a typed target is only compared: the gap is actual - target and nothing else moves', () => {
    const e = workbookEvent()
    e.rewards.targets[0]![5] = 20
    const before = JSON.stringify(e.rewards.regular)
    const r = regularRewards(e, computeRegularSegment(e, 1))
    expect(r[5]!.gap).toBeCloseTo(r[5]!.actual - 20, 12)
    expect(JSON.stringify(e.rewards.regular)).toBe(before)
  })
})
