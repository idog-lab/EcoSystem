import type { ModelEntry } from './types'

// THE catalog: the only list of models. The home page, its navigation, the
// /models/<slug> routes and the server's checks are all generated from it.
// Adding a model = one entry here + one page module in modules.ts. Nothing
// on the home page is edited by hand.
//
// Folders are NOT here: they are shared runtime data in the database.
export const MODEL_CATALOG = [
  {
    id: 'merge-mania',
    slug: 'merge-mania',
    displayName: 'Merge Mania',
    iconKey: 'layers',
    moduleKey: 'merge-mania',
    status: 'available',
    sources: [{ kind: 'workbook-sheet-family', family: 'Merge', status: 'stated' }],
  },
  {
    id: 'diamond-mine',
    slug: 'diamond-mine',
    displayName: 'Diamond Mine',
    iconKey: 'gem',
    moduleKey: 'diamond-mine',
    status: 'available',
    sources: [{ kind: 'workbook-sheet-family', family: 'Diamond Mine', status: 'name-unverified' }],
  },
  {
    id: 'chef',
    slug: 'chef',
    displayName: 'Chef',
    iconKey: 'chef-hat',
    moduleKey: 'chef',
    status: 'available',
    sources: [],
    sourceNote: 'No verified one-to-one workbook sheet family.',
  },
  {
    id: 'economy',
    slug: 'economy',
    displayName: 'Economy',
    iconKey: 'coins',
    moduleKey: 'economy',
    status: 'available',
    sources: [],
    sourceNote: 'No verified one-to-one workbook sheet family.',
  },
  {
    id: 'momentum',
    slug: 'momentum',
    displayName: 'Momentum',
    iconKey: 'gauge',
    moduleKey: 'not-migrated',
    status: 'not-migrated',
    sources: [{ kind: 'workbook-sheet-family', family: 'Momentum', status: 'name-unverified' }],
  },
  {
    id: 'challenge',
    slug: 'challenge',
    displayName: 'Challenge',
    iconKey: 'trophy',
    moduleKey: 'not-migrated',
    status: 'not-migrated',
    sources: [{ kind: 'workbook-sheet-family', family: 'Challenges', status: 'stated' }],
  },
  {
    id: 'puzzle',
    slug: 'puzzle',
    displayName: 'Puzzle',
    iconKey: 'puzzle',
    moduleKey: 'not-migrated',
    status: 'not-migrated',
    sources: [{ kind: 'workbook-sheet-family', family: 'Puzzle', status: 'name-unverified' }],
  },
] as const satisfies readonly ModelEntry[]

export type ModelId = (typeof MODEL_CATALOG)[number]['id']
export type ModuleKey = (typeof MODEL_CATALOG)[number]['moduleKey']

const BY_ID = new Map<string, ModelEntry>(MODEL_CATALOG.map((m) => [m.id, m]))
const BY_SLUG = new Map<string, ModelEntry>(MODEL_CATALOG.map((m) => [m.slug, m]))

export function modelById(id: string): ModelEntry | undefined {
  return BY_ID.get(id)
}

export function modelBySlug(slug: string): ModelEntry | undefined {
  return BY_SLUG.get(slug)
}

export function isModelId(id: string): id is ModelId {
  return BY_ID.has(id)
}
