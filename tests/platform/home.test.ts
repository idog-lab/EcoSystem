import { describe, expect, it } from 'vitest'
import { MODEL_CATALOG } from '../../src/platform/registry/catalog'
import { filterModels, nameMatches } from '../../src/platform/catalog/search'
import { readHomeQuery, writeHomeQuery, type HomeQuery } from '../../src/platform/catalog/homeQuery'
import { appPathOf, browserPathOf, parseRoute } from '../../src/platform/routing/routes'
import { checkFolderName, folderNameKey } from '../../src/platform/organization/folderName'

const names = (q: HomeQuery, folders: Record<string, string> = {}) =>
  filterModels(MODEL_CATALOG, q, (id) => folders[id] ?? null).map((m) => m.displayName)
const all = { kind: 'all' } as const

describe('search', () => {
  it('trims, ignores case and matches part of the display name', () => {
    expect(names({ q: '  MERGE ', folder: all })).toEqual(['Merge Mania'])
    expect(names({ q: 'mi', folder: all }).sort()).toEqual(['Diamond Mine'])
    expect(names({ q: '   ', folder: all })).toHaveLength(7)
  })

  it('matches display names only, not ids, slugs or sources', () => {
    expect(names({ q: 'merge-mania', folder: all })).toEqual([])
    expect(names({ q: 'challenges', folder: all })).toEqual([])
    expect(nameMatches('Chef', 'chef-hat')).toBe(false)
  })

  it('combines with the folder (AND)', () => {
    const placed = { chef: 'f1', puzzle: 'f1', momentum: 'f2' }
    expect(names({ q: '', folder: { kind: 'folder', id: 'f1' } }, placed).sort()).toEqual(['Chef', 'Puzzle'])
    expect(names({ q: 'puz', folder: { kind: 'folder', id: 'f1' } }, placed)).toEqual(['Puzzle'])
    expect(names({ q: 'puz', folder: { kind: 'folder', id: 'f2' } }, placed)).toEqual([])
    expect(names({ q: '', folder: { kind: 'unfiled' } }, placed)).toHaveLength(4)
    expect(names({ q: '', folder: all }, placed)).toHaveLength(7)
  })
})

describe('the home URL', () => {
  it('round-trips search and folder, leaving defaults out', () => {
    const cases: HomeQuery[] = [
      { q: '', folder: all },
      { q: 'che f', folder: all },
      { q: '', folder: { kind: 'unfiled' } },
      { q: 'x&y=z', folder: { kind: 'folder', id: 'cm123' } },
    ]
    for (const c of cases) expect(readHomeQuery(writeHomeQuery(c))).toEqual(c)
    expect(writeHomeQuery({ q: '', folder: all })).toBe('')
    expect(readHomeQuery('?folder=all')).toEqual({ q: '', folder: all })
  })
})

describe('routes', () => {
  it('reads the site base and the pages', () => {
    expect(appPathOf('/EcoSystem/models/chef', '/EcoSystem/')).toBe('/models/chef')
    expect(appPathOf('/EcoSystem/', '/EcoSystem/')).toBe('/')
    expect(browserPathOf('/models/chef', '/EcoSystem/')).toBe('/EcoSystem/models/chef')
    expect(parseRoute('/', '?q=a')).toEqual({ name: 'home' })
    expect(parseRoute('/models/chef', '')).toEqual({ name: 'model', slug: 'chef' })
    expect(parseRoute('/models/chef/extra', '')).toEqual({ name: 'not-found' })
  })

  it('keeps Merge Mania\'s shared play and plan links working', () => {
    expect(parseRoute('/', '?s=B123')).toEqual({ name: 'play-link' })
    expect(parseRoute('/', '?play&stage=x')).toEqual({ name: 'play-link' })
    expect(parseRoute('/', '?plan=abc')).toEqual({ name: 'plan-link' })
  })
})

describe('folder names', () => {
  it('are trimmed, not blank, compared without case', () => {
    expect(checkFolderName('  Live Ops ')).toEqual({ ok: true, name: 'Live Ops', nameKey: 'live ops' })
    expect(checkFolderName('  ')).toMatchObject({ ok: false, reason: 'blank' })
    expect(checkFolderName(undefined)).toMatchObject({ ok: false, reason: 'blank' })
    expect(checkFolderName('x'.repeat(61))).toMatchObject({ ok: false, reason: 'too-long' })
    expect(folderNameKey('LIVE ops')).toBe(folderNameKey(' live OPS '))
  })
})
