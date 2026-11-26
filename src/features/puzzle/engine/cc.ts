// CC PRESETS: workbook "Puzzle CC Management", the preset path only. Depends
// on the event's days and daily progression and the CC settings - never on
// prices, rewards, inflation or Wins for Economy (economist). The sheet's
// per-segment nominal DR / Coverage / neutrality extension is left out.

import { ceiling, floor, mround } from './excel'
import type { CcSettings } from './model'

export const CC_STATES = ['Strong Push', 'Push', 'Normal', 'Stall', 'Strong Stall'] as const
export type CcState = (typeof CC_STATES)[number]

export type CcDay = {
  day: number
  /** Planned progress at the START of the day (CC compares there) and at its end. */
  expectedStart: number
  expectedEnd: number
  pace: number
  /** Distances from expectedStart (fractions of the effort): Push below -pushNormal, Strong Push at or below -pushStrong. */
  pushNormal: number
  pushStrong: number
  stallNormal: number
  stallStrong: number
  overridden: { pushNormal: boolean; pushStrong: boolean; stallNormal: boolean; stallStrong: boolean }
}

/** Section D of the sheet: the four boundaries of every day. */
export function ccDays(progression: readonly number[], cc: CcSettings): CcDay[] {
  const { normalBehind, pushBand, normalAhead, stallBand } = cc.bands
  let start = 0
  return progression.map((p, i) => {
    const day = i + 1
    const expectedStart = start
    const expectedEnd = start + p
    start = expectedEnd
    const pace = expectedEnd - expectedStart
    const o = cc.days[i] ?? { normalWidth: 1, pushNormal: null, pushStrong: null, stallNormal: null, stallStrong: null }
    const g = o.normalWidth
    if (day === 1) {
      return { day, expectedStart, expectedEnd, pace, pushNormal: 0, pushStrong: 0, stallNormal: 0, stallStrong: 0, overridden: { pushNormal: false, pushStrong: false, stallNormal: false, stallStrong: false } }
    }
    const pushNormal = o.pushNormal ?? normalBehind * g * pace
    const pushStrong = o.pushStrong ?? pushNormal + pushBand * pace
    const stallNormal = o.stallNormal ?? normalAhead * g * pace
    const stallStrong = o.stallStrong ?? stallNormal + stallBand * pace
    return {
      day,
      expectedStart,
      expectedEnd,
      pace,
      pushNormal,
      pushStrong,
      stallNormal,
      stallStrong,
      overridden: { pushNormal: o.pushNormal != null, pushStrong: o.pushStrong != null, stallNormal: o.stallNormal != null, stallStrong: o.stallStrong != null },
    }
  })
}

/**
 * The state of a player with this economic-effort progress at the start of
 * this day. The order of the tests decides a value exactly on a boundary.
 */
export function ccState(days: readonly CcDay[], day: number, progress: number): CcState {
  const d = days[day - 1]
  if (!d || day === 1) return 'Normal'
  const g = progress - d.expectedStart
  if (g <= -d.pushStrong) return 'Strong Push'
  if (g <= -d.pushNormal) return 'Push'
  if (day === days.length || g < d.stallNormal) return 'Normal'
  if (g < d.stallStrong) return 'Stall'
  return 'Strong Stall'
}

/** Days whose boundaries are out of order (a state can never be reached there): fix before export. */
export function ccProblems(days: readonly CcDay[]): string[] {
  const out: string[] = []
  for (const d of days) {
    if (d.day === 1) continue
    if (d.pushStrong < d.pushNormal) out.push(`Day ${d.day}: Strong Push starts closer to the plan than Push.`)
    if (d.stallStrong < d.stallNormal) out.push(`Day ${d.day}: Strong Stall starts closer to the plan than Stall.`)
    if (d.pushNormal < 0 || d.stallNormal < 0) out.push(`Day ${d.day}: a boundary is negative.`)
  }
  return out
}

/** The preset's Normal DR, read from the number after the first "_" ("puzzle_50" -> 50). */
export function presetBase(name: string): number | null {
  const i = name.indexOf('_')
  if (i < 0) return null
  const v = Number(name.slice(i + 1))
  return Number.isFinite(v) && name.slice(i + 1).trim() !== '' ? v : null
}

/** The rounding step for a value after its multiplier (below 10: 1; 10 to below 100: 5; 100 and more: 10). */
export function ladderStep(ladder: readonly [number, number][], v: number): number {
  let step = ladder[0]?.[1] ?? 1
  for (const [from, s] of ladder) if (v >= from) step = s
  return step
}

export type PresetValue = { state: CcState; multiplier: number; raw: number; step: number | null; method: string; value: number }

export function presetValues(base: number, cc: CcSettings): PresetValue[] {
  return CC_STATES.map((state, i) => {
    const multiplier = cc.multipliers[i]!
    const raw = base * multiplier
    if (state === 'Normal') return { state, multiplier, raw, step: null, method: 'no rounding', value: raw }
    const step = ladderStep(cc.ladder, raw)
    if (state === 'Strong Push') return { state, multiplier, raw, step, method: 'nearest', value: mround(raw, step) }
    if (state === 'Push') return { state, multiplier, raw, step, method: 'up', value: ceiling(raw, step) }
    return { state, multiplier, raw, step, method: 'down', value: floor(raw, step) }
  })
}

export function presetMatrix(cc: CcSettings) {
  return cc.presets.map((name) => {
    const base = presetBase(name)
    const values = base == null ? null : presetValues(base, cc)
    const same = values ? CC_STATES.filter((_, i) => i > 0 && values[i]!.value === values[i - 1]!.value) : []
    return { name, base, values, sameAsNeighbour: same }
  })
}
