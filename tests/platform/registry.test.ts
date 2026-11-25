import { describe, expect, it } from 'vitest'
import { MODEL_CATALOG, modelById, modelBySlug } from '../../src/platform/registry/catalog'
import { MODEL_MODULES } from '../../src/platform/registry/modules'
import { ICON_KEYS } from '../../src/platform/registry/types'

describe('the model registry', () => {
  it('lists exactly the seven models', () => {
    expect(MODEL_CATALOG.map((m) => m.displayName).sort()).toEqual(
      ['Challenge', 'Chef', 'Diamond Mine', 'Economy', 'Merge Mania', 'Momentum', 'Puzzle'].sort(),
    )
  })

  it('ids, slugs and display names are unique; slugs are URL-safe', () => {
    for (const field of ['id', 'slug', 'displayName'] as const) {
      const values = MODEL_CATALOG.map((m) => m[field].toLowerCase())
      expect(new Set(values).size, field).toBe(values.length)
    }
    for (const m of MODEL_CATALOG) expect(m.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('every entry has a known icon and a page module, and every module is used', () => {
    const used = new Set(MODEL_CATALOG.map((m) => m.moduleKey))
    for (const m of MODEL_CATALOG) {
      expect(ICON_KEYS).toContain(m.iconKey)
      expect(MODEL_MODULES[m.moduleKey], m.id).toBeTypeOf('function')
    }
    expect(Object.keys(MODEL_MODULES).sort()).toEqual([...used].sort())
  })

  it('every page module loads and exports a component', async () => {
    for (const [key, load] of Object.entries(MODEL_MODULES)) {
      const mod = await load()
      expect(mod.default, key).toBeTypeOf('function')
    }
  }, 120_000)

  it('the existing tools stay available; the three new ones say they are not migrated', () => {
    const status = Object.fromEntries(MODEL_CATALOG.map((m) => [m.id, m.status]))
    expect(status).toEqual({
      'merge-mania': 'available',
      'diamond-mine': 'available',
      chef: 'available',
      economy: 'available',
      momentum: 'not-migrated',
      challenge: 'not-migrated',
      puzzle: 'not-migrated',
    })
    for (const m of MODEL_CATALOG) expect(m.moduleKey === 'not-migrated').toBe(m.status === 'not-migrated')
  })

  it('records the workbook sources as given, and none for Chef and Economy', () => {
    const families = Object.fromEntries(MODEL_CATALOG.map((m) => [m.id, m.sources.map((s) => `${s.family}:${s.status}`)]))
    expect(families).toEqual({
      'merge-mania': ['Merge:stated'],
      challenge: ['Challenges:stated'],
      momentum: ['Momentum:name-unverified'],
      puzzle: ['Puzzle:name-unverified'],
      'diamond-mine': ['Diamond Mine:name-unverified'],
      chef: [],
      economy: [],
    })
    expect(modelById('chef')?.sourceNote).toMatch(/No verified/)
    expect(modelById('economy')?.sourceNote).toMatch(/No verified/)
  })

  it('looks models up by id and slug', () => {
    expect(modelBySlug('merge-mania')?.displayName).toBe('Merge Mania')
    expect(modelById('nope')).toBeUndefined()
  })
})
