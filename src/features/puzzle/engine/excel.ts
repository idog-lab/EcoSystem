// Excel's arithmetic, as the Puzzle workbook uses it. Every rounding rule of
// the model goes through here so the platform gives the workbook's numbers.

// Excel works to 15 significant digits: a value is cleaned to that before it is
// compared with a half or a whole, so float noise (46.49999999999999 for 46.5)
// rounds the way Excel rounds it, with no extra allowance.
const EPS = 0

const clean = (x: number) => Number.parseFloat(x.toPrecision(15)) + 0

/** ROUND(x, digits): a half away from zero. */
export function round(x: number, digits = 0): number {
  if (!Number.isFinite(x)) return Number.NaN
  const f = 10 ** digits
  return clean((Math.sign(x) * Math.floor(Math.abs(clean(x * f)) + 0.5 + EPS)) / f)
}

/** ROUNDUP(x, digits): away from zero (digits may be negative: -1 = to the tens). */
export function roundUp(x: number, digits = 0): number {
  const f = 10 ** digits
  const v = Math.abs(clean(x * f))
  return clean((Math.sign(x) * Math.ceil(v - EPS)) / f)
}

/** MROUND(x, m): the nearest multiple, a half away from zero. */
export function mround(x: number, m: number): number {
  if (!(m > 0)) return Number.NaN
  const q = Math.abs(clean(x / m))
  return clean(Math.sign(x) * Math.floor(q + 0.5 + EPS) * m)
}

/** CEILING(x, m) for positive x: up to a multiple of m. */
export function ceiling(x: number, m: number): number {
  return clean(Math.ceil(clean(x / m) - EPS) * m)
}

/** FLOOR(x, m) for positive x: down to a multiple of m. */
export function floor(x: number, m: number): number {
  return clean(Math.floor(clean(x / m) + EPS) * m)
}

/** A number as Excel writes it into text ("43.5", "2.8", "0"). */
export function numberText(x: number): string {
  if (!Number.isFinite(x)) return ''
  const s = Number.parseFloat(x.toPrecision(15)).toString()
  if (!/e/i.test(s)) return s
  return x.toFixed(15).replace(/\.?0+$/, '')
}

/** Excel serial date -> JS Date (UTC) and back; the 1900 system. */
const EPOCH = Date.UTC(1899, 11, 30)
export const toSerial = (ms: number) => (ms - EPOCH) / 86_400_000
export const fromSerial = (serial: number) => EPOCH + serial * 86_400_000

/**
 * TEXT(INT(d),"YYYY-MM-DD")&"T"&TEXT(HOUR(d),"00")&":"&TEXT(MINUTE(d),"00")&":"&TEXT(SECOND(d),"00").
 * HOUR/MINUTE/SECOND read the time rounded to the nearest second (so 20:17:08.571 is 20:17:09).
 */
export function isoSeconds(serial: number): string {
  const day = Math.floor(serial)
  const secs = Math.round((serial - day) * 86_400)
  const date = new Date(fromSerial(day)).toISOString().slice(0, 10)
  // Excel never carries a rounded 24:00:00 into the date: the time part is below a day.
  const s = Math.min(secs, 86_399)
  const hh = String(Math.floor(s / 3600)).padStart(2, '0')
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${date}T${hh}:${mm}:${ss}`
}

export const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)
