// ALL MY DATA - everything this app keeps in the browser, as one file, and
// back (economist, 25 Nov 2026, when the site moved to the work repo: "we got
// memory in the last repo. can we take it back? we had some saved merge
// features there" - asked, and chose "One-file move").
//
// A browser keeps each site's data apart, so the work repo's site
// (idog-lab.github.io) cannot read what was saved on the old one
// (idoggk.github.io): it is carried over in a file. The file holds every key
// of this app - saved Merge events, the open Merge project with its builds,
// Chef, Diamond Mine and the Economy page - exactly as stored.
//
// Restoring never takes anything away: saved events in the file are ADDED to
// the list here (one already here, by its id, is left as it is); everything
// else is put in where this browser has none, and where this browser has its
// own and it differs, it is replaced only when asked, part by part. Before a
// restore the caller downloads what is here, so it can be undone.

export const DATA_FILE_KIND = 'economy-toolkit-browser-data'
export const DATA_FILE_VERSION = 1

// This app's keys. (A github.io address is shared with the owner's other
// sites: only these are taken.)
const APP_KEY = /^(merge-mania|superplay-|economy-)/

const EVENTS_INDEX = 'merge-mania-saved-events'
const EVENT_PREFIX = 'merge-mania-saved-event:'

// The parts a restore speaks of, in the order shown. A key no part names goes
// to "other".
export const DATA_PARTS = [
  { id: 'merge-project', label: 'Merge: the open project (its segments, boards, last builds and effort shape)', keys: ['merge-mania-board-simulator', 'merge-mania-build-drafts', 'merge-mania-effort-target', 'merge-mania-saved-event-open'] },
  { id: 'chef', label: 'Chef (its events and the last simulation runs)', keys: ['merge-mania-chef', 'merge-mania-chef-runs'] },
  { id: 'economy', label: 'Economy page (worth, currencies, keys, and the Balance tab)', keys: ['superplay-economy', 'economy-balance-draft'] },
  { id: 'diamond-mine', label: 'Diamond Mine', keys: ['merge-mania-diamond-mine'] },
  { id: 'wicked-trails', label: 'Wicked Trails', keys: ['superplay-wicked-trails', 'superplay-wicked-trails-view'] },
]
const isEventKey = (key) => key === EVENTS_INDEX || key.startsWith(EVENT_PREFIX)
const partOf = (key) => DATA_PARTS.find((p) => p.keys.includes(key))?.id ?? 'other'

function appItems(storage) {
  const items = {}
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key && APP_KEY.test(key)) items[key] = storage.getItem(key)
  }
  return items
}

const readIndex = (text) => {
  try {
    const list = JSON.parse(text ?? '[]')
    return Array.isArray(list) ? list.filter((e) => e && typeof e.id === 'string') : []
  } catch {
    return []
  }
}

// Everything of this app in this browser: { kind, version, savedAt, from, items: { key: text } }.
export function collectAllData(storage = globalThis.localStorage, from = globalThis.location?.href ?? null) {
  return { kind: DATA_FILE_KIND, version: DATA_FILE_VERSION, savedAt: new Date().toISOString(), from, items: appItems(storage) }
}

// Whether this browser holds anything of the app (a restore downloads it first when it does).
export function hasAnyData(storage = globalThis.localStorage) {
  return Object.keys(appItems(storage)).length > 0
}

// Reads a file's text: { ok: true, data } or { ok: false, message }.
export function readDataFile(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, message: 'This file could not be read. It is not a file made by "Download all my data". Nothing was changed.' }
  }
  if (!data || data.kind !== DATA_FILE_KIND || typeof data.items !== 'object' || data.items == null) {
    return { ok: false, message: 'This is not a file made by "Download all my data" (a backup of one Merge event goes in Merge: More, Import backup). Nothing was changed.' }
  }
  if (!(data.version <= DATA_FILE_VERSION)) return { ok: false, message: 'This file was made by a newer version of the app. Nothing was changed.' }
  const items = Object.fromEntries(Object.entries(data.items).filter(([key, value]) => APP_KEY.test(key) && typeof value === 'string'))
  return { ok: true, data: { ...data, items } }
}

// What a restore would do, before it does it:
//   events: { inFile, toAdd: [{ id, name }], alreadyHere }
//   parts:  [{ id, label, state: 'add' | 'same' | 'differs' | 'none' }] - 'none': not in the file.
export function planRestore(data, storage = globalThis.localStorage) {
  const here = appItems(storage)
  const fileEvents = readIndex(data.items[EVENTS_INDEX]).filter((e) => typeof data.items[EVENT_PREFIX + e.id] === 'string')
  const hereIds = new Set(readIndex(here[EVENTS_INDEX]).map((e) => e.id))
  const toAdd = fileEvents.filter((e) => !hereIds.has(e.id)).map((e) => ({ id: e.id, name: e.name, startDate: e.startDate ?? null }))
  const fileKeys = Object.keys(data.items).filter((k) => !isEventKey(k))
  const hereKeys = Object.keys(here).filter((k) => !isEventKey(k))
  const partIds = [...DATA_PARTS.map((p) => p.id), 'other']
  const parts = partIds.map((id) => {
    const label = DATA_PARTS.find((p) => p.id === id)?.label ?? 'Other settings of the app'
    const theirs = fileKeys.filter((k) => partOf(k) === id)
    const ours = hereKeys.filter((k) => partOf(k) === id)
    if (!theirs.length) return { id, label, state: 'none' }
    if (!ours.length) return { id, label, state: 'add' }
    const same = theirs.length === ours.length && theirs.every((k) => here[k] === data.items[k])
    return { id, label, state: same ? 'same' : 'differs' }
  })
  return { events: { inFile: fileEvents.length, toAdd, alreadyHere: fileEvents.length - toAdd.length }, parts }
}

// Restores: the file's saved events added, every part this browser has none
// of put in, and the parts named in `replace` replaced (their keys here that
// the file does not have are removed, so a part is the file's whole). All or
// nothing: if the browser runs out of room, what was here is put back.
// Returns { ok: true, eventsAdded, partsWritten: [ids] } or { ok: false, reason: 'full' | 'error', message }.
export function restoreAllData(data, { replace = [] } = {}, storage = globalThis.localStorage) {
  const plan = planRestore(data, storage)
  const here = appItems(storage)
  const writes = {}
  const removes = []
  // Saved events: each new one's data, then one index holding both lists.
  if (plan.events.toAdd.length) {
    const fileIndex = readIndex(data.items[EVENTS_INDEX])
    const adding = fileIndex.filter((e) => plan.events.toAdd.some((a) => a.id === e.id))
    for (const e of adding) writes[EVENT_PREFIX + e.id] = data.items[EVENT_PREFIX + e.id]
    writes[EVENTS_INDEX] = JSON.stringify([...readIndex(here[EVENTS_INDEX]), ...adding])
  }
  const written = []
  for (const part of plan.parts) {
    if (!(part.state === 'add' || (part.state === 'differs' && replace.includes(part.id)))) continue
    for (const [key, value] of Object.entries(data.items)) if (!isEventKey(key) && partOf(key) === part.id) writes[key] = value
    if (part.state === 'differs') for (const key of Object.keys(here)) if (!isEventKey(key) && partOf(key) === part.id && !(key in data.items)) removes.push(key)
    written.push(part.id)
  }
  const before = Object.fromEntries([...Object.keys(writes), ...removes].map((k) => [k, storage.getItem(k)]))
  try {
    for (const [key, value] of Object.entries(writes)) storage.setItem(key, value)
    for (const key of removes) storage.removeItem(key)
  } catch (error) {
    for (const [key, value] of Object.entries(before)) {
      try {
        if (value == null) storage.removeItem(key)
        else storage.setItem(key, value)
      } catch {
        // Nothing more can be done here.
      }
    }
    const full = error && (error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014)
    return full
      ? { ok: false, reason: 'full', message: 'This browser has no room for all of it. Nothing was changed. Delete saved events you no longer need, or restore fewer parts.' }
      : { ok: false, reason: 'error', message: `Nothing was changed (${error?.message ?? 'unknown error'}).` }
  }
  return { ok: true, eventsAdded: plan.events.toAdd.length, partsWritten: written }
}
