// Saving the chefs. Separate from Merge's and Diamond Mine's saves on
// purpose: each feature's save is its own contract.
//
// A LIBRARY of chefs: `{ schemaVersion, configs: [{ id, name, updatedAt,
// state, legacy? }], activeConfigId }`. `state` is a schema-2 chef
// (chefModel.js). A chef that was saved by the older tool is brought up to
// date when it is opened (chefMigration.js) and the chef AS IT WAS is kept
// beside it in `legacy`, untouched, so it can always be downloaded again.
// Ids are never changed by that.
import { SCHEMA_VERSION } from './chefModel'
import { migrateChefState } from './chefMigration'
import { teamData } from '../../../lib/teamData'

const STORAGE_KEY = 'merge-mania-chef'

function nextConfigId() {
  return `chef-config-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

export function createConfigEntry(name, state) {
  return { id: nextConfigId(), name, updatedAt: new Date().toISOString(), state }
}

// One entry of any age, as an entry of today. Null when it holds no chef.
function migrateEntry(entry) {
  if (!entry?.state || !Array.isArray(entry.state.ingredients)) return null
  const result = migrateChefState(entry.state)
  if (!result) return null
  if (!result.migrated) return { ...entry, state: result.state }
  return { ...entry, state: result.state, legacy: entry.legacy ?? { schemaVersion: entry.state.schemaVersion ?? 1, state: entry.state, migratedAt: new Date().toISOString() } }
}

// A parsed save or backup of any age, as a library of today. Null: not a Chef save.
export function migrateLibrary(parsed) {
  if (!parsed || typeof parsed !== 'object') return null
  // The oldest shape: one chef, no library around it.
  if (!Array.isArray(parsed.configs)) {
    if (!parsed.ingredients?.length) return null
    const entry = migrateEntry(createConfigEntry('My chef', parsed))
    return entry ? { schemaVersion: SCHEMA_VERSION, configs: [entry], activeConfigId: entry.id } : null
  }
  if (parsed.configs.length === 0 || !parsed.configs.every((c) => c?.id && Array.isArray(c.state?.ingredients))) return null
  const configs = parsed.configs.map(migrateEntry)
  if (configs.some((c) => !c)) return null
  return { schemaVersion: SCHEMA_VERSION, configs, activeConfigId: configs.some((c) => c.id === parsed.activeConfigId) ? parsed.activeConfigId : configs[0].id }
}

export function loadChefLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? migrateLibrary(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function saveChefLibrary(library) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...library, schemaVersion: SCHEMA_VERSION }))
  // Shared with the team when connected (lib/teamData.js); the runs below stay in this browser.
  teamData.changed(STORAGE_KEY)
}

// THE LAST RUN OF A CHEF, kept in this browser (a known limit was "Simulation
// results are not saved with a chef": a reload lost them). Apart from the
// chefs, so a run is not a change to save; at most RUNS_KEPT chefs' runs, the
// newest first (a run of nine segments is about 200 KB). A run carries the
// fingerprint of the chef it was played on: once the chef differs it shows as
// out of date, never as current. { runs, kept: false } when the browser has no
// room - then it is kept for the visit only, and the screen says so.
const RUNS_KEY = 'merge-mania-chef-runs'
export const RUNS_KEPT = 4
export function loadChefRuns() {
  try {
    const raw = localStorage.getItem(RUNS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
export function saveChefRuns(runs) {
  const newest = Object.entries(runs ?? {})
    .filter(([, run]) => run && typeof run === 'object')
    .sort((a, b) => String(b[1].at ?? '').localeCompare(String(a[1].at ?? '')))
    .slice(0, RUNS_KEPT)
  try {
    localStorage.setItem(RUNS_KEY, JSON.stringify(Object.fromEntries(newest)))
    return { kept: true, dropped: Object.keys(runs ?? {}).length - newest.length }
  } catch {
    return { kept: false, dropped: 0 }
  }
}

// A backup file, checked before it is trusted: the library it holds, or null.
// Nothing is ever applied in part.
export function parseImportedLibrary(jsonText) {
  try {
    return migrateLibrary(JSON.parse(jsonText))
  } catch {
    return null
  }
}
