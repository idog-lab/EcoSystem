// SAVED EVENTS (economist: "i want to be able to save full events in the app ...
// like to save the events in the specific time frame"; asked, and chose: kept
// in this browser, named by the event's dates, newest first).
//
// A saved event is exactly what a backup file holds (App.jsx: backupPayload) -
// every segment, the event in use, the results of the last builds and the
// effort shape - so opening one is the same as importing that backup. Each is
// kept compressed under a key of its own, with a small index for the list, so
// saving one event never rewrites the others. The browser gives a site a few
// MB in all: when it is full, saving says so and nothing is lost.
import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate'
import { teamData } from '../../../../lib/teamData'

const INDEX_KEY = 'merge-mania-saved-events'
const DATA_PREFIX = 'merge-mania-saved-event:'
const OPEN_KEY = 'merge-mania-saved-event-open'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "19-25 Aug 2026", "29 Aug - 4 Sep 2026", "29 Dec 2026 - 4 Jan 2027"; null with no start date.
export function eventDatesLabel(startDate, days) {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null
  const [y, m, d] = startDate.split('-').map(Number)
  const start = new Date(y, m - 1, d)
  const end = new Date(y, m - 1, d + Math.max(1, Number(days) || 1) - 1)
  const day = (date) => date.getDate()
  const month = (date) => MONTHS[date.getMonth()]
  if (start.getFullYear() !== end.getFullYear()) return `${day(start)} ${month(start)} ${start.getFullYear()} - ${day(end)} ${month(end)} ${end.getFullYear()}`
  if (start.getMonth() !== end.getMonth()) return `${day(start)} ${month(start)} - ${day(end)} ${month(end)} ${end.getFullYear()}`
  return `${day(start)}${day(end) !== day(start) ? `-${day(end)}` : ''} ${month(start)} ${end.getFullYear()}`
}

// The name a new saved event starts with: its dates, else a plain name.
export function defaultEventName(startDate, days) {
  const dates = eventDatesLabel(startDate, days)
  return dates ? `Merge Mania ${dates}` : 'Merge Mania (no dates set)'
}

function readIndex() {
  try {
    const list = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((e) => e && typeof e.id === 'string') : []
  } catch {
    return []
  }
}

// Newest event first (by its start date); events with no dates last, newest saved first.
export function sortEvents(list) {
  return [...list].sort((a, b) => {
    if (a.startDate && b.startDate && a.startDate !== b.startDate) return a.startDate < b.startDate ? 1 : -1
    if (!!a.startDate !== !!b.startDate) return a.startDate ? -1 : 1
    return (b.savedAt ?? 0) - (a.savedAt ?? 0)
  })
}

export function listSavedEvents() {
  return sortEvents(readIndex())
}

const pack = (payload) => strFromU8(gzipSync(strToU8(JSON.stringify(payload)), { level: 9 }), true)
const unpack = (text) => JSON.parse(strFromU8(gunzipSync(strToU8(text, true))))

const isFull = (error) => error && (error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014)

// Saves `payload` as an event: a new one (no `id`) or over the one with `id`.
// Returns { ok: true, event } or { ok: false, reason: 'full' | 'error', message }.
export function saveEvent({ id = null, name, startDate = null, days = null, payload }) {
  const index = readIndex()
  const existing = id ? index.find((e) => e.id === id) : null
  const eventId = existing ? existing.id : `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const data = pack(payload)
  const event = {
    id: eventId,
    name: String(name ?? '').trim() || defaultEventName(startDate, days),
    startDate: startDate ?? null,
    days: days ?? null,
    savedAt: Date.now(),
    createdAt: existing?.createdAt ?? Date.now(),
    segments: (payload?.segments ?? []).filter((s) => (s?.targetSubsidy ?? 0) > 0).length,
    size: data.length,
  }
  const before = localStorage.getItem(DATA_PREFIX + eventId)
  try {
    localStorage.setItem(DATA_PREFIX + eventId, data)
    localStorage.setItem(INDEX_KEY, JSON.stringify([...index.filter((e) => e.id !== eventId), event]))
  } catch (error) {
    // Put back what was there: a half-written save never replaces a good one.
    try {
      if (before != null) localStorage.setItem(DATA_PREFIX + eventId, before)
      else localStorage.removeItem(DATA_PREFIX + eventId)
    } catch {
      // Nothing more can be done here.
    }
    return isFull(error)
      ? { ok: false, reason: 'full', message: 'This browser has no room left for another saved event. Download an older one as a file and delete it from the list, then save again.' }
      : { ok: false, reason: 'error', message: `The event could not be saved (${error?.message ?? 'unknown error'}).` }
  }
  // Shared with the team when connected (lib/teamData.js): one file an event.
  teamData.eventChanged(eventId)
  return { ok: true, event }
}

// The backup payload of a saved event, or null when it cannot be read.
export function loadEvent(id) {
  try {
    const text = localStorage.getItem(DATA_PREFIX + id)
    return text == null ? null : unpack(text)
  } catch {
    return null
  }
}

export function renameEvent(id, name) {
  const index = readIndex()
  const clean = String(name ?? '').trim()
  if (!clean) return false
  localStorage.setItem(INDEX_KEY, JSON.stringify(index.map((e) => (e.id === id ? { ...e, name: clean } : e))))
  teamData.eventChanged(id)
  return true
}

export function deleteEvent(id) {
  localStorage.removeItem(DATA_PREFIX + id)
  localStorage.setItem(INDEX_KEY, JSON.stringify(readIndex().filter((e) => e.id !== id)))
  if (openEventId() === id) setOpenEventId(null)
  teamData.eventDeleted(id)
}

// Which saved event is open now (the one "Update" writes to).
export function openEventId() {
  try {
    return localStorage.getItem(OPEN_KEY) || null
  } catch {
    return null
  }
}
export function setOpenEventId(id) {
  try {
    if (id) localStorage.setItem(OPEN_KEY, id)
    else localStorage.removeItem(OPEN_KEY)
  } catch {
    // Not remembered across a reload; nothing else depends on it.
  }
}
