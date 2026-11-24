// How a day, a share and a number are written on screen.
import { calendarDateForDay, formatCalendarDate } from './chefModel'

// A day as the economist reads it: its date when the event has a start
// date, else its number.
export function dayLabel(calendar, day) {
  if (day == null) return '-'
  return formatCalendarDate(calendarDateForDay(calendar, day)) ?? `Day ${day}`
}

// The same, short (no year): for charts and tables with many days.
export function shortDay(calendar, day) {
  if (day == null) return '-'
  const date = calendarDateForDay(calendar, day)
  return date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : `Day ${day}`
}

// A share as a percentage, and a number with a few decimals (trailing zeros dropped).
export const pct = (share, digits = 0) => (share == null ? '-' : `${(share * 100).toFixed(digits)}%`)
export const num = (value, digits = 1) => {
  if (value == null || !Number.isFinite(Number(value))) return '-'
  const text = Number(value).toFixed(digits)
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}
