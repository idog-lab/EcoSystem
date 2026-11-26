import { createContext, useContext } from 'react'
import type { PuzzleResults } from '../engine/compute'
import { ccBandsFor, defaultCcDays, uniformProgression, type EventLength, type PuzzleEvent } from '../engine/model'
import { WORKBOOK_DEFAULTS as W } from '../engine/workbookDefaults'

export type Phase = 'regular' | 'rc'

export type PuzzleCtx = {
  ev: PuzzleEvent
  edit: (fn: (ev: PuzzleEvent) => void) => void
  results: PuzzleResults
  phase: Phase
  setPhase: (p: Phase) => void
  /** The segment shown, per phase (1-based). Every segment is always calculated. */
  segment: number
  setSegment: (s: number) => void
  docId: string | null
  revision: number | null
  dirty: boolean
  base: string | null
}

export const Ctx = createContext<PuzzleCtx | null>(null)
export const usePuzzle = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('Puzzle context missing')
  return c
}

/** A new number of days: the daily progression starts even again, CC days follow. */
export function setDays(ev: PuzzleEvent, days: number) {
  ev.setup.days = days
  ev.economy.progression = uniformProgression(days)
  ev.cc.days = defaultCcDays(days).map((d, i) => ev.cc.days[i] ?? d)
}

/**
 * A new event length: its usual days and the workbook's values for that
 * length (inflation, MTX baseline, Wins for Economy, CC bands). The screen
 * says so; the economist can change any of them after.
 */
export function setLength(ev: PuzzleEvent, length: EventLength) {
  ev.setup.length = length
  setDays(ev, W.days[length])
  ev.setup.inflation = W.inflation[length]
  ev.setup.mtxBaseline = W.mtxBaseline[length]
  ev.economy.segments.forEach((s, i) => {
    const d = W.segments[i]!
    s.winsForEconomy = length === 'week' ? d.winsWeek : d.winsTwoWeeks
  })
  ev.cc.bands = ccBandsFor(length)
}

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso.slice(0, 16)}:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 16)
}
export const dayLabel = (startIso: string, day: number) =>
  new Date(`${addDays(startIso, day - 1)}:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
