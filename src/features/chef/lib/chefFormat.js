// How a day of the event is written on screen.
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
