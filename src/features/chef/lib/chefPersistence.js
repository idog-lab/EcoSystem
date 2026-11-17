// Separate from Merge's persistence.js and Diamond Mine's
// diamondPersistence.js on purpose - each feature's own save shape is its
// own contract, and blurring them together would make a future schema
// change to one risk silently corrupting another.
//
// Stores a LIBRARY of chef configs, not just one - by explicit economist
// request ("multiple saved event configs... so the next event's design
// doesn't overwrite this one"), the highest-ranked item from a GPT
// brainstorm review ("essential foundation"). Shape:
// `{ configs: [{ id, name, updatedAt, state }], activeConfigId }`, where
// `state` is the same `{ ingredients, dishes, recompletionDishes,
// recompletionCaps, baskets, calendar, segments, grants }` shape a single
// config has always had.

const STORAGE_KEY = 'merge-mania-chef'

function nextConfigId() {
  return `chef-config-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

export function createConfigEntry(name, state) {
  return { id: nextConfigId(), name, updatedAt: new Date().toISOString(), state }
}

// Migrates the OLD single-config shape (a flat `{ ingredients, dishes,
// ... }` object with no `configs` key at all) into a one-entry library -
// an economist's existing save must never silently disappear just because
// the storage shape grew a library wrapper around it.
function migrateLegacyState(raw) {
  if (!raw || !raw.ingredients?.length) return null
  const entry = createConfigEntry('My chef', raw)
  return { configs: [entry], activeConfigId: entry.id }
}

export function loadChefLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed?.configs)) return parsed
    return migrateLegacyState(parsed)
  } catch {
    return null
  }
}

export function saveChefLibrary(library) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library))
}

// Validates the shape of an imported backup file before it's trusted -
// mirrors Merge's own "never partially apply a corrupted import" rule
// (CLAUDE.md's Persistence section). Returns the parsed library, or null
// if it doesn't look like a real one.
export function parseImportedLibrary(jsonText) {
  try {
    const parsed = JSON.parse(jsonText)
    if (Array.isArray(parsed?.configs) && parsed.configs.every((c) => c.id && c.state?.ingredients)) return parsed
    // Also accept a single legacy-shaped export for forward compatibility.
    const migrated = migrateLegacyState(parsed)
    return migrated
  } catch {
    return null
  }
}
