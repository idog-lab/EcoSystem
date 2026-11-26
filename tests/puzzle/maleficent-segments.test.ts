import { describe, expect, it } from 'vitest'
import { averageDamage, bossBar, bucketsText, removalFor, selectRemoved } from '../../src/features/puzzle/engine/maleficent'
import { computeRc } from '../../src/features/puzzle/engine/rc'
import { computeRegularSegment } from '../../src/features/puzzle/engine/regular'
import { FIRST_PUZZLE, rcSegmentRows, rcSegmentsAt, rcWindowSerials, regularDefinition, regularKey, timeWindowProblems } from '../../src/features/puzzle/engine/segments'
import { round, toSerial } from '../../src/features/puzzle/engine/excel'
import { hasWorkbook, workbook, workbookEvent } from './workbook'

// Rows copied from the two reference Google Sheets (Price Cut "Segments" / "RC Segments").
const W = '(fn_DailyBrutWins_m4(3,1m,2m,4m,8m)*0.7m+fn_DailyBrutWins_m4(14,1m,2m,4m,8m)*0.3m)'
const P = '(GetDynamicAttributeValue("puzzle_count") > 0)'
const TEMPLATE_REGULAR = [
  `${W} <= 9m && ${P} `,
  `${W} > 9m && ${W} <= 18m&& ${P} `,
  `${W} > 18m && ${W} <= 26m&& ${P} `,
  `${W} > 26m && ${W} <= 40m&& ${P} `,
  `${W} > 40m && ${W} <= 60m&& ${P} `,
  `${W} > 60m && ${W} <= 100m&& ${P} `,
  `${W} > 100m && ${W} <= 150m && ${P} `,
  `${W} > 150m && ${W} <= 240m && ${P} `,
  `${W} > 240m && ${P} `,
]
const R = '(fn_DailyBrutWins_m4(3,1,2,4,8)*0.7m+fn_DailyBrutWins_m4(14,1,2,4,8)*0.3m)'
const TEMPLATE_RC: Record<number, string> = {
  1: `(\n  (${R} <= 9m)\n )`,
  2: `(\n  (\n  (${R} > 18m && ${R} <= 26m) &&\n  (DateTime.UtcNow > DateTime.Parse("2026-11-26T16:51:26") && DateTime.UtcNow <= DateTime.Parse("2026-11-30T10:00:00"))\n  ) ||\n  (\n  (${R} > 9m && ${R} <= 18m) &&\n  (DateTime.UtcNow > DateTime.Parse("2026-11-24T20:17:09") && DateTime.UtcNow <= DateTime.Parse("2026-11-29T11:42:51"))\n  )\n )`,
  8: `(\n  (${R} > 100m) &&\n  (DateTime.UtcNow > DateTime.Parse("2026-11-25T18:34:17") && DateTime.UtcNow <= DateTime.Parse("2026-11-26T16:51:26"))\n )`,
  11: `(\n  (${R} > 100m) &&\n  (DateTime.UtcNow <= DateTime.Parse("2026-11-23T22:00:00"))\n )`,
}

describe('segment rules', () => {
  const ev = workbookEvent()
  it('returning segments are written exactly as the reference templates hold them', () => {
    const bounds = ev.segmentation.membershipMax
    TEMPLATE_REGULAR.forEach((t, i) => expect(regularDefinition(bounds, i + 1)).toBe(t))
    expect(regularKey(3)).toBe('Puzzle_3_V2_Boost')
    expect(FIRST_PUZZLE.definition).toBe(`!${P}`)
  })
  it('RC keys and definitions match the Price Cut template (same dates as the workbook event)', () => {
    const rows = rcSegmentRows(ev)
    expect(rows[0]!.key).toBe('Puzzle_RC_seg1_1711')
    for (const [seg, text] of Object.entries(TEMPLATE_RC)) expect(rows[Number(seg) - 1]!.definition).toBe(text)
  })
  it('RC time windows: > opens, <= closes, exactly at the boundary', () => {
    const at = rcWindowSerials(ev).map((s) => Math.round(s * 86_400) / 86_400)
    // Segment 10 holds > 100 between points 0 and 1; segment 9 between 1 and 2.
    expect(rcSegmentsAt(ev, 150, at[1]!)).toEqual([10])
    expect(rcSegmentsAt(ev, 150, at[1]! + 1 / 86_400)).toEqual([9])
    expect(rcSegmentsAt(ev, 150, at[0]!)).toEqual([11])
    expect(rcSegmentsAt(ev, 100, at[0]!)).toContain(7)
    expect(rcSegmentsAt(ev, 9, at[3]!)).toEqual([1])
  })
  it('a window that opens after it closes is reported, not fixed (the Maleficent template has one)', () => {
    const e = workbookEvent()
    e.segmentation.firstPuzzle = [{ key: 'Puzzle_V2_1st_3_days', from: '2026-12-02T11:00:00', to: '2026-11-05T11:00:00', economySegmentNote: '3' }]
    expect(timeWindowProblems(e)[0]).toMatch(/opens .* after it closes/)
  })
})

describe.skipIf(!hasWorkbook)('segment rules and Maleficent match the workbook', () => {
  const ev = workbookEvent()
  ev.order.rc = workbook.rc_config_new.map((block: unknown[][]) => (block[2] as number[]).slice(2, 26))

  it('RC Segments Generator: window points and the generator text of every segment', () => {
    const at = rcWindowSerials(ev)
    const g = workbook.rc_segments_generator.A12_E20
    at.forEach((s, j) => expect(s).toBeCloseTo(toSerial(Date.parse(`${g[1 + j][3]}Z`)), 6))
    const rows = rcSegmentRows(ev, 'workbook')
    workbook.rc_segments_generator.A24_C35.slice(1, 11).forEach((r: string[], i: number) => expect(rows[i]!.definition).toBe(r[2]))
  })

  it('removal: all 27 boss boards of the regular table (the workbook scales the selected segment by wins)', () => {
    const sel = computeRegularSegment(ev, 9)
    const winsSel = sel.winsForEconomy
    const rows = workbook.maleficent.results_B12_L66.slice(1)
    let checked = 0
    for (const r of rows) {
      const [seg, tier, , , removal, size, , target, pieces, total, gap] = r
      if (!(removal > 0)) continue
      const wins = ev.economy.segments[seg - 1]!.winsForEconomy
      const costs = sel.pieces.filter((p) => p.tier === tier).map((p) => round((p.cost * wins) / winsSel, 0))
      expect(costs.reduce((a, b) => a + b, 0)).toBe(size)
      expect(round((size * removal) / 100, 0)).toBe(target)
      const got = selectRemoved(costs, target, workbook.maleficent.J3)
      expect(got.pieces.join(', ')).toBe(pieces)
      expect(got.total).toBe(total)
      expect(got.total - target).toBe(gap)
      checked++
    }
    expect(checked).toBe(27)
  })

  it('removal on Recompletion: every boss board of the eleven segments', () => {
    const rc = computeRc(ev)
    const rows = workbook.maleficent.rc_results_B70_L103.slice(1)
    let checked = 0
    for (const r of rows) {
      const [seg, tier, , , removal, size, , target, pieces, total] = r
      if (!(removal > 0)) continue
      const t = rc[seg - 1]!.tiers[tier - 1]!
      expect(t.total).toBe(size)
      const got = removalFor(t.costs, ev.order.rc[seg - 1]!, ev.maleficent.rcTiers[tier - 1]!, workbook.maleficent.J3)!
      expect(got.target).toBe(target)
      expect(got.pieces.join(', ')).toBe(pieces)
      expect(got.droppedTotal).toBe(total)
      // Positions point back at exactly the chosen pieces and add up to the dropped total.
      const written = t.ordered
      expect(got.positions.reduce((a, p) => a + written[p - 1]!.cost, 0)).toBe(total)
      checked++
    }
    expect(checked).toBe(22)
  })

  it('Boss Bar: the five live formulas (regular boards 1/3/5 of the selected segment, RC boards 1/3 of RC segment 1)', () => {
    const boss = workbook.maleficent.boss_T37_Y48
    const sel = computeRegularSegment(ev, 9)
    const reg = [1, 3, 5].map((t) => bossBar(ev.maleficent.tiers[t - 1]!, ev.maleficent.regularWheel[t - 1], sel.tiers[t - 1]!.cost))
    expect(reg).toEqual([boss[3][5], boss[5][5], boss[7][5]])
    expect(averageDamage(ev.maleficent.regularWheel[0]!.spins)).toBeCloseTo(boss[3][2], 12)
    const rc1 = computeRc(ev)[0]!
    expect([1, 3].map((t) => bossBar(ev.maleficent.rcTiers[t - 1]!, ev.maleficent.rcWheel[t - 1], rc1.tiers[t - 1]!.total))).toEqual([boss[9][5], boss[11][5]])
  })

  it('Maleficent - Config: buckets text of every boss board', () => {
    const cfg = workbook.maleficent_config
    ;[1, 3, 5].forEach((t) => expect(bucketsText(ev.maleficent.regularWheel[t - 1]!.spins)).toBe(cfg[t][2]))
    const rcc = workbook.maleficent_rc_config
    ;[1, 3].forEach((t) => expect(bucketsText(ev.maleficent.rcWheel[t - 1]!.spins)).toBe(rcc[t][2]))
  })
})

describe('removal mapping after a shuffle', () => {
  it('positions follow the shuffle; the same pieces and total whatever the order', () => {
    const costs = [3, 5, 8, 10, 13, 15, 18, 20]
    const tier = { active: true, difficulty: 60, removal: 60 }
    const a = removalFor(costs, [8, 7, 6, 5, 4, 3, 2, 1, ...Array.from({ length: 16 }, (_, i) => i + 9)], tier, 1)!
    const b = removalFor(costs, Array.from({ length: 24 }, (_, i) => i + 1), tier, 1)!
    expect(a.pieces).toEqual(b.pieces)
    expect(b.positions).toEqual([...b.pieces].sort((x, y) => x - y))
    expect(a.positions).toEqual(a.pieces.map((id) => 9 - id).sort((x, y) => x - y))
  })
})
