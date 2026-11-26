import { describe, expect, it } from 'vitest'
import { computeRc, rcPieceValue } from '../../src/features/puzzle/engine/rc'
import { hasWorkbook, workbook, workbookEvent } from './workbook'

describe.skipIf(!hasWorkbook)('Recompletion matches the workbook (Puzzle - RC Simulator, RC config new)', () => {
  const ev = workbookEvent()
  // The workbook's own pasted piece orders.
  ev.order.rc = workbook.rc_config_new.map((block: unknown[][]) => (block[2] as number[]).slice(2, 26))

  it('the last-day piece worth (B9)', () => {
    expect(rcPieceValue(ev)).toBeCloseTo(workbook.rc_inputs.B5_B17[4][1], 14)
  })

  it('all eleven segments: tier DR, value, coins and their cap, reward text', () => {
    const rc = computeRc(ev)
    rc.forEach((seg, s) => {
      const block = workbook.rc_expected_blocks[s]
      expect(seg.key).toBe(block[0][0])
      seg.tiers.forEach((t, i) => {
        const r = block[3 + i]
        expect(t.tierDr).toBeCloseTo(r[1], 9)
        expect(t.tierValue).toBeCloseTo(r[3], 9)
        expect(t.coinValue).toBeCloseTo(r[5], 9)
        expect(t.coins).toBe(r[7])
        expect(t.syntax).toBe(r[8])
        expect(t.cap).toBeCloseTo(r[11], 9)
        expect(t.coinsBeforeCap).toBe(r[12])
      })
    })
  })

  it('all eleven segments: prices in the saved order and the board totals (RC config new)', () => {
    const rc = computeRc(ev)
    rc.forEach((seg, s) => {
      const block = workbook.rc_config_new[s]
      seg.tiers.forEach((t, i) => {
        const row = block[3 + i]
        const written = (row.slice(2, 26) as (number | null)[]).filter((v) => v != null)
        expect(t.ordered.map((p) => p.cost)).toEqual(written)
        expect(t.total).toBe(row[27])
      })
    })
  })
})
