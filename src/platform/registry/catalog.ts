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
  // Added on request (25 Nov 2026): listed, not built yet. No workbook
  // source was given for them, so none is recorded.
  {
    id: 'trail',
    slug: 'trail',
    displayName: 'Trail',
    iconKey: 'footprints',
    moduleKey: 'not-migrated',
    status: 'not-migrated',
    sources: [],
    sourceNote: 'No workbook source recorded yet.',
  },
  {
    id: 'race',
    slug: 'race',
    displayName: 'Race',
    iconKey: 'flag',
    moduleKey: 'not-migrated',
    status: 'not-migrated',
    sources: [],
    sourceNote: 'No workbook source recorded yet.',
  },
  {
    id: 'pet',
    slug: 'pet',
    displayName: 'Pet',
    iconKey: 'paw-print',
    moduleKey: 'not-migrated',
    status: 'not-migrated',
    sources: [],
    sourceNote: 'No workbook source recorded yet.',
  },
  {
    id: 'maleficent',
    slug: 'maleficent',
    displayName: 'Maleficent',
    iconKey: 'wand-sparkles',
    moduleKey: 'not-migrated',
    status: 'not-migrated',
    sources: [],
    sourceNote: 'No workbook source recorded yet.',
  },
  {
    id: 'midnight-blast',
    slug: 'midnight-blast',
    displayName: 'Midnight blast',
    iconKey: 'moon-star',
    moduleKey: 'not-migrated',
    status: 'not-migrated',
    sources: [],
    sourceNote: 'No workbook source recorded yet.',
  },
  {
    id: '8box',
    slug: '8box',
    displayName: '8Box',
    iconKey: 'package',
    moduleKey: 'not-migrated',
    status: 'not-migrated',
    sources: [],
    sourceNote: 'No workbook source recorded yet.',
  },
  {
    id: 'progressive-twister',
    slug: 'progressive-twister',
    displayName: 'Progressive Twister',
    iconKey: 'tornado',
    moduleKey: 'not-migrated',
    status: 'not-migrated',
    sources: [],
    sourceNote: 'No workbook source recorded yet.',
  },
  {
    id: 'wheel',
    slug: 'wheel',
    displayName: 'Wheel',
    iconKey: 'ferris-wheel',
    moduleKey: 'not-migrated',
    status: 'not-migrated',
    sources: [],
    sourceNote: 'No workbook source recorded yet.',
  },
  {
    id: 'basket-thrill',
    slug: 'basket-thrill',
    displayName: 'Basket Thrill',
    iconKey: 'shopping-basket',
    moduleKey: 'not-migrated',
    status: 'not-migrated',
    sources: [],
    sourceNote: 'No workbook source recorded yet.',
  },
  {
    id: 'frenzy',
    slug: 'frenzy',
    displayName: 'Frenzy',
    iconKey: 'zap',
    moduleKey: 'not-migrated',
    status: 'not-migrated',
    sources: [],
    sourceNote: 'No workbook source recorded yet.',
  },
  {
    id: 'disco',
    slug: 'disco',
    displayName: 'Disco',
    iconKey: 'disc-3',
    moduleKey: 'not-migrated',
    status: 'not-migrated',
    sources: [],
    sourceNote: 'No workbook source recorded yet.',
  },
  {
    id: 'inside-tracks',
    slug: 'inside-tracks',
    displayName: 'Inside Tracks',
    iconKey: 'train-track',
    moduleKey: 'not-migrated',
    status: 'not-migrated',
    sources: [],
    sourceNote: 'No workbook source recorded yet.',
  },
  {
    id: 'wicked-trails',
    slug: 'wicked-trails',
    displayName: 'Wicked Trails',
    iconKey: 'map',
    moduleKey: 'wicked-trails',
    status: 'available',
    sources: [],
    sourceNote: 'No workbook source recorded yet.',
  },
  {
    id: 'disney-moments',
    slug: 'disney-moments',
    displayName: 'Disney Moments',
    iconKey: 'castle',
    moduleKey: 'not-migrated',
    status: 'not-migrated',
    sources: [],
    sourceNote: 'No workbook source recorded yet.',
  },
  {
    id: 'sugar-rush',
    slug: 'sugar-rush',
    displayName: 'Sugar Rush',
    iconKey: 'candy',
    moduleKey: 'not-migrated',
    status: 'not-migrated',
    sources: [],
    sourceNote: 'No workbook source recorded yet.',
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
