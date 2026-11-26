import { describe, expect, it } from 'vitest'
import { ccDays, ccState, presetBase, presetMatrix, presetValues } from '../../src/features/puzzle/engine/cc'
import { createDefaultEvent, uniformProgression } from '../../src/features/puzzle/engine/model'
import { hasWorkbook, workbook, workbookEvent } from './workbook'

describe('CC presets', () => {
  const ev = workbookEvent()
  it('the economist example: puzzle_50 is 65 / 60 / 50 / 40 / 35', () => {
    expect(presetValues(50, ev.cc).map((v) => v.value)).toEqual([65, 60, 50, 40, 35])
  })
  it('rounding is on the value after the multiplier, at 10 and 100', () => {
    expect(presetValues(8, ev.cc).map((v) => v.value)).toEqual([10, 10, 8, 6, 5]) // 10.4 nearest 5 -> 10; 9.2 up step 1 -> 10
    expect(presetValues(80, ev.cc).map((v) => v.value)).toEqual([100, 95, 80, 65, 55]) // 104 -> step 10 -> 100
  })
  it('a name with a suffix is read by its first number only, never the last part', () => {
    expect(presetBase('puzzle_50')).toBe(50)
    expect(presetBase('puzzle_gameplay_50_undo')).toBeNull()
  })
  it('the uniform 13-day example: day 7 expects 46.15% at day start; 30% is Push; puzzle_50 gives 60', () => {
    const days = ccDays(uniformProgression(13), ev.cc)
    expect(days[6]!.expectedStart).toBeCloseTo(6 / 13, 12)
    expect(ccState(days, 7, 0.3)).toBe('Push')
    expect(presetValues(50, ev.cc)[1]!.value).toBe(60)
  })
  it('day 1 is always Normal; the last day allows Push but never Stall; exact boundaries follow the order', () => {
    const days = ccDays(uniformProgression(13), ev.cc)
    expect(ccState(days, 1, 0)).toBe('Normal')
    expect(ccState(days, 1, 1)).toBe('Normal')
    expect(ccState(days, 13, 1)).toBe('Normal')
    expect(ccState(days, 13, 0)).toBe('Strong Push')
    // Exact boundaries on an 8-day plan (eighths are exact in binary).
    const exact = ccDays(uniformProgression(8), ev.cc)
    const d = exact[4]!
    expect(ccState(exact, 5, d.expectedStart - d.pushNormal)).toBe('Push')
    expect(ccState(exact, 5, d.expectedStart - d.pushStrong)).toBe('Strong Push')
    expect(ccState(exact, 5, d.expectedStart + d.stallNormal)).toBe('Stall')
    expect(ccState(exact, 5, d.expectedStart + d.stallStrong)).toBe('Strong Stall')
  })
  it('an override of 0 is used; a blank one is automatic', () => {
    const e = createDefaultEvent()
    e.cc.days[3]!.pushNormal = 0
    const days = ccDays(e.economy.progression, e.cc)
    expect(days[3]!.pushNormal).toBe(0)
    expect(days[3]!.pushStrong).toBeCloseTo(e.cc.bands.pushBand * days[3]!.pace, 12)
    expect(days[4]!.overridden.pushNormal).toBe(false)
  })
  it('does not move with prices, rewards, inflation or Wins for Economy; does with days and pace', () => {
    const a = createDefaultEvent()
    const b = createDefaultEvent()
    b.setup.inflation = 0.2
    b.economy.segments[0]!.winsForEconomy = 999
    b.rewards.regular[0]![0]!.coins = 50
    expect(JSON.stringify(ccDays(b.economy.progression, b.cc))).toBe(JSON.stringify(ccDays(a.economy.progression, a.cc)))
    expect(JSON.stringify(ccDays(uniformProgression(14), a.cc))).not.toBe(JSON.stringify(ccDays(a.economy.progression, a.cc)))
  })
})

describe.skipIf(!hasWorkbook)('CC matches the workbook', () => {
  const ev = workbookEvent()
  it('all 64 working presets x 5 states = 320 values', () => {
    const rows = workbook.cc.presets_S4_Y72.slice(2, 66)
    const m = presetMatrix(ev.cc)
    expect(m).toHaveLength(64)
    let n = 0
    m.forEach((p, i) => {
      expect(p.name).toBe(rows[i][0])
      expect(p.base).toBe(rows[i][1])
      p.values!.forEach((v, j) => {
        expect(v.value).toBe(rows[i][2 + j])
        n++
      })
    })
    expect(n).toBe(320)
  })
  it('every day boundary of the 13-day event (section D)', () => {
    const days = ccDays(ev.economy.progression, ev.cc)
    workbook.cc.thresholds_A71_K86.slice(1, 14).forEach((r: number[], i: number) => {
      const d = days[i]!
      expect(d.pace).toBeCloseTo(r[1]!, 12)
      expect([d.pushNormal, d.pushStrong, d.stallNormal, d.stallStrong].map((x) => +x.toFixed(12))).toEqual(r.slice(2, 6).map((x) => +x.toFixed(12)))
    })
  })
})
