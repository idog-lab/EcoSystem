// SEGMENT RULES: who is in which segment, as the game reads it.
//
// Returning players: 70% of the 3-day + 30% of the 14-day daily brut wins
// (modes weighted 1,2,4,8), against each segment's upper bound, and having
// played a puzzle before. First-puzzle players: the negation, plus time rules.
// RC: the same measure crossed with time windows that open across the event
// (workbook "RC Segments Generator").
//
// Membership bounds are NOT Wins for Economy: one says who is in a segment,
// the other what that segment is asked to do (economist).

import { isoSeconds, toSerial } from './excel'
import { REGULAR_SEGMENTS, type PuzzleEvent } from './model'
import { rcKey } from './rc'

export const W_REGULAR = '(fn_DailyBrutWins_m4(3,1m,2m,4m,8m)*0.7m+fn_DailyBrutWins_m4(14,1m,2m,4m,8m)*0.3m)'
export const W_RC = '(fn_DailyBrutWins_m4(3,1,2,4,8)*0.7m+fn_DailyBrutWins_m4(14,1,2,4,8)*0.3m)'
export const PLAYED = '(GetDynamicAttributeValue("puzzle_count") > 0)'

/** "Puzzle_N_V2_Boost": the existing key, kept as it is (it does not turn Boost on). */
export const regularKey = (segment: number) => `Puzzle_${segment}_V2_Boost`

/**
 * One returning segment's definition, written as the reference templates
 * write it - including their spacing ("<= 18m&&" for segments 2 to 6, a
 * trailing space on every row).
 */
export function regularDefinition(bounds: readonly (number | null)[], segment: number): string {
  const lo = segment > 1 ? bounds[segment - 2] : null
  const hi = segment < REGULAR_SEGMENTS ? bounds[segment - 1] : null
  const parts: string[] = []
  if (lo != null) parts.push(`${W_REGULAR} > ${lo}m`)
  if (hi != null) parts.push(`${W_REGULAR} <= ${hi}m`)
  const glue = lo != null && hi != null && segment <= 6 ? '&&' : ' &&'
  return `${parts.join(' && ')}${glue} ${PLAYED} `
}

export const FIRST_PUZZLE = { key: 'first_puzzle', definition: `!${PLAYED}` }

/** A first-puzzle time rule ("Puzzle_V2_Test_1st_5_days" and the like). */
export function firstPuzzleDefinition(from: string, to: string): string {
  if (to) return `DateTime.UtcNow > DateTime.Parse("${from}") && DateTime.UtcNow <= DateTime.Parse("${to}") && !${PLAYED}`
  return `(DateTime.UtcNow > DateTime.Parse("${from}") && !(${PLAYED}))`
}

// ---- RC -------------------------------------------------------------------

/** One clause: lo < measure <= hi, between two of the eight window points (indexes 0..7). */
export type RcClause = { lo?: number; hi?: number; after?: number; until?: number }

/** The generator's layout (RC Segments Generator C25:C35), segment by segment. */
export const RC_CLAUSES: RcClause[][] = [
  [{ hi: 9 }],
  [
    { lo: 18, hi: 26, after: 3, until: 7 },
    { lo: 9, hi: 18, after: 1, until: 6 },
  ],
  [
    { lo: 40, hi: 60, after: 4, until: 6 },
    { lo: 26, hi: 40, after: 3, until: 7 },
    { lo: 18, hi: 26, until: 2 },
    { lo: 9, hi: 18, until: 1 },
  ],
  [
    { lo: 26, hi: 40, until: 2 },
    { lo: 40, hi: 60, after: 2, until: 4 },
    { lo: 60, hi: 100, after: 4, until: 7 },
  ],
  [
    { lo: 40, hi: 60, until: 2 },
    { lo: 60, hi: 100, after: 2, until: 4 },
    { lo: 100, after: 5, until: 7 },
  ],
  [
    { lo: 60, hi: 100, after: 1, until: 2 },
    { lo: 100, after: 4, until: 5 },
  ],
  [
    { lo: 100, after: 3, until: 4 },
    { lo: 60, hi: 100, until: 1 },
  ],
  [{ lo: 100, after: 2, until: 3 }],
  [{ lo: 100, after: 1, until: 2 }],
  [{ lo: 100, after: 0, until: 1 }],
  [{ lo: 100, until: 0 }],
]

/**
 * The eight window points (serial days): start date + the anchor hour + p x days,
 * p = 7/14 .. 14/14 (RC Segments Generator D13:D20). The workbook takes the
 * start DATE and adds 10:00.
 */
export function rcWindowSerials(ev: PuzzleEvent): number[] {
  const date = Date.parse(`${ev.setup.start.slice(0, 10)}T00:00:00Z`)
  const b3 = Math.round(toSerial(date))
  const b4 = b3 + ev.setup.days
  return Array.from({ length: 8 }, (_, j) => b3 + ev.segmentation.rcHourOffset / 24 + ((j + 7) / 14) * (b4 - b3))
}

export const rcWindowStrings = (ev: PuzzleEvent) => rcWindowSerials(ev).map(isoSeconds)

const condText = (w: string, c: RcClause) =>
  c.lo != null && c.hi != null ? `(${w} > ${c.lo}m && ${w} <= ${c.hi}m)` : c.lo != null ? `(${w} > ${c.lo}m)` : `(${w} <= ${c.hi}m)`

const timeText = (c: RcClause, at: readonly string[]) =>
  c.after != null && c.until != null
    ? `(DateTime.UtcNow > DateTime.Parse("${at[c.after]}") && DateTime.UtcNow <= DateTime.Parse("${at[c.until]}"))`
    : c.until != null
      ? `(DateTime.UtcNow <= DateTime.Parse("${at[c.until]}"))`
      : c.after != null
        ? `(DateTime.UtcNow > DateTime.Parse("${at[c.after]}"))`
        : ''

/**
 * An RC segment's definition. 'template' is how both reference Google Sheets
 * hold it (every inner line indented two spaces, " )" at the end) and is what
 * an export writes; 'workbook' is the generator's own text.
 */
export function rcDefinition(clauses: readonly RcClause[], at: readonly string[], format: 'template' | 'workbook' = 'template'): string {
  const ind = '  '
  const inner = format === 'template' ? '  ' : '    '
  const close = format === 'template' ? ' )' : ')'
  const one = (c: RcClause, pad: string) => {
    const t = timeText(c, at)
    return t ? `${pad}${condText(W_RC, c)} &&\n${pad}${t}` : `${pad}${condText(W_RC, c)}`
  }
  if (clauses.length === 1) return `(\n${one(clauses[0]!, ind)}\n${close}`
  return `(\n${clauses.map((c) => `${ind}(\n${one(c, inner)}\n${ind})`).join(' ||\n')}\n${close}`
}

export function rcSegmentRows(ev: PuzzleEvent, format: 'template' | 'workbook' = 'template') {
  const at = rcWindowStrings(ev)
  return RC_CLAUSES.map((clauses, i) => ({ key: rcKey(ev, i + 1), definition: rcDefinition(clauses, at, format), clauses }))
}

/** Which RC segments a player with this measure is in at this moment (serial days, UTC). Boundaries: > opens, <= closes. */
export function rcSegmentsAt(ev: PuzzleEvent, measure: number, nowSerial: number): number[] {
  const at = rcWindowSerials(ev).map((s) => Math.round(s * 86_400) / 86_400)
  const ok = (c: RcClause) =>
    (c.lo == null || measure > c.lo) &&
    (c.hi == null || measure <= c.hi) &&
    (c.after == null || nowSerial > at[c.after]!) &&
    (c.until == null || nowSerial <= at[c.until]!)
  return RC_CLAUSES.flatMap((cl, i) => (cl.some(ok) ? [i + 1] : []))
}

/** Problems a reader of the rules should see before an export: windows that open after they close. */
export function timeWindowProblems(ev: PuzzleEvent): string[] {
  const out: string[] = []
  for (const r of ev.segmentation.firstPuzzle) {
    if (r.from && r.to && Date.parse(`${r.from}Z`) >= Date.parse(`${r.to}Z`)) out.push(`${r.key}: the window opens (${r.from}) after it closes (${r.to}).`)
    if (!r.from) out.push(`${r.key}: no start time.`)
  }
  const at = rcWindowSerials(ev)
  RC_CLAUSES.forEach((cl, i) =>
    cl.forEach((c) => {
      if (c.after != null && c.until != null && at[c.after]! >= at[c.until]!) out.push(`RC segment ${i + 1}: a window opens after it closes.`)
    }),
  )
  return out
}
