import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../helpers/db'
import { seedWorkspaces, testApp } from '../helpers/app'

let t: TestDatabase
let ws: Awaited<ReturnType<typeof seedWorkspaces>>
let api: ReturnType<typeof testApp>

beforeAll(async () => {
  t = await createTestDatabase()
  ws = await seedWorkspaces(t.db)
  api = testApp(t.db)
})
afterAll(async () => t?.drop())

const org = (id: string) => `/workspaces/${id}/organization`

describe('folders', () => {
  it('a workspace starts with no folders and every model unfiled', async () => {
    const res = await api.as('ana@a.test').get(org(ws.a.id))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ folders: [], placements: [] })
  })

  it('rejects blank names', async () => {
    for (const name of ['', '   ', '\t']) {
      const res = await api.as('ana@a.test').post(`/workspaces/${ws.a.id}/folders`, { name })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('validation')
    }
  })

  it('creates a folder with a trimmed name, visible to the other member', async () => {
    const res = await api.as('ana@a.test').post(`/workspaces/${ws.a.id}/folders`, { name: '  Live Ops ' })
    expect(res.status).toBe(201)
    expect(res.body.folder).toMatchObject({ name: 'Live Ops', revision: 1 })
    const other = await api.as('ben@a.test').get(org(ws.a.id))
    expect(other.body.folders.map((f: { name: string }) => f.name)).toEqual(['Live Ops'])
  })

  it('rejects a duplicate name that differs only in case or spaces', async () => {
    const res = await api.as('ben@a.test').post(`/workspaces/${ws.a.id}/folders`, { name: ' live OPS' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('duplicate_name')
  })

  it('allows the same name in another workspace', async () => {
    const res = await api.as('cleo@b.test').post(`/workspaces/${ws.b.id}/folders`, { name: 'Live Ops' })
    expect(res.status).toBe(201)
  })

  it('renames from the current revision, and refuses a rename made from an old one', async () => {
    const created = await api.as('ana@a.test').post(`/workspaces/${ws.a.id}/folders`, { name: 'Draft' })
    const id = created.body.folder.id
    const first = await api.as('ana@a.test').patch(`/workspaces/${ws.a.id}/folders/${id}`, { name: 'Core economy', expectedRevision: 1 })
    expect(first.status).toBe(200)
    expect(first.body.folder).toMatchObject({ name: 'Core economy', revision: 2 })

    const stale = await api.as('ben@a.test').patch(`/workspaces/${ws.a.id}/folders/${id}`, { name: 'Economy core', expectedRevision: 1 })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('conflict')
    expect(stale.body.error.current).toMatchObject({ id, name: 'Core economy', revision: 2 })
  })

  it('two renames from the same revision at the same moment: exactly one wins', async () => {
    const created = await api.as('ana@a.test').post(`/workspaces/${ws.a.id}/folders`, { name: 'Race' })
    const id = created.body.folder.id
    const results = await Promise.all([
      api.as('ana@a.test').patch(`/workspaces/${ws.a.id}/folders/${id}`, { name: 'Race A', expectedRevision: 1 }),
      api.as('ben@a.test').patch(`/workspaces/${ws.a.id}/folders/${id}`, { name: 'Race B', expectedRevision: 1 }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const winner = results.find((r) => r.status === 200)!.body.folder.name
    const stored = await t.db.folder.findUniqueOrThrow({ where: { id } })
    expect(stored).toMatchObject({ name: winner, revision: 2 })
  })

  it('refuses renaming to a name another folder has', async () => {
    const created = await api.as('ana@a.test').post(`/workspaces/${ws.a.id}/folders`, { name: 'Spare' })
    const res = await api.as('ana@a.test').patch(`/workspaces/${ws.a.id}/folders/${created.body.folder.id}`, { name: 'LIVE OPS', expectedRevision: 1 })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('duplicate_name')
  })

  it('cannot rename a folder of another workspace', async () => {
    const theirs = await t.db.folder.findFirstOrThrow({ where: { workspaceId: ws.b.id } })
    const res = await api.as('ana@a.test').patch(`/workspaces/${ws.a.id}/folders/${theirs.id}`, { name: 'Taken over', expectedRevision: 1 })
    expect(res.status).toBe(404)
    expect((await t.db.folder.findUniqueOrThrow({ where: { id: theirs.id } })).name).toBe('Live Ops')
  })
})

describe('moving models', () => {
  const folderId = async (name: string, workspaceId = ws.a.id) =>
    (await t.db.folder.findFirstOrThrow({ where: { workspaceId, name } })).id

  it('moves a model into a folder; the other member sees it; its id is unchanged', async () => {
    const liveOps = await folderId('Live Ops')
    const res = await api.as('ana@a.test').put(`/workspaces/${ws.a.id}/placements/chef`, { folderId: liveOps, expectedRevision: 0 })
    expect(res.status).toBe(200)
    expect(res.body.placement).toEqual({ modelId: 'chef', folderId: liveOps, revision: 1 })
    const seen = await api.as('ben@a.test').get(org(ws.a.id))
    expect(seen.body.placements).toEqual([{ modelId: 'chef', folderId: liveOps, revision: 1 }])
  })

  it('a move made from an old placement conflicts instead of overwriting', async () => {
    const core = await folderId('Core economy')
    const res = await api.as('ben@a.test').put(`/workspaces/${ws.a.id}/placements/chef`, { folderId: core, expectedRevision: 0 })
    expect(res.status).toBe(409)
    expect(res.body.error.current).toMatchObject({ modelId: 'chef', revision: 1 })
  })

  it('moves to another folder, then back to Unfiled', async () => {
    const core = await folderId('Core economy')
    const moved = await api.as('ben@a.test').put(`/workspaces/${ws.a.id}/placements/chef`, { folderId: core, expectedRevision: 1 })
    expect(moved.body.placement).toMatchObject({ folderId: core, revision: 2 })
    const unfiled = await api.as('ana@a.test').put(`/workspaces/${ws.a.id}/placements/chef`, { folderId: null, expectedRevision: 2 })
    expect(unfiled.status).toBe(200)
    expect(unfiled.body.placement).toEqual({ modelId: 'chef', folderId: null, revision: 3 })
  })

  it('refuses a folder of another workspace, a folder that does not exist, and an unknown model', async () => {
    const theirs = await folderId('Live Ops', ws.b.id)
    const cross = await api.as('ana@a.test').put(`/workspaces/${ws.a.id}/placements/puzzle`, { folderId: theirs, expectedRevision: 0 })
    expect(cross.status).toBe(422)
    expect(cross.body.error.code).toBe('invalid_folder')
    const missing = await api.as('ana@a.test').put(`/workspaces/${ws.a.id}/placements/puzzle`, { folderId: 'no-such-folder', expectedRevision: 0 })
    expect(missing.status).toBe(422)
    const unknown = await api.as('ana@a.test').put(`/workspaces/${ws.a.id}/placements/battle-pass`, { folderId: null, expectedRevision: 0 })
    expect(unknown.status).toBe(404)
    expect(unknown.body.error.code).toBe('unknown_model')
    expect(await t.db.modelPlacement.count({ where: { modelId: { in: ['puzzle', 'battle-pass'] } } })).toBe(0)
  })

  it('the database itself refuses a placement in another workspace\'s folder', async () => {
    const theirs = await folderId('Live Ops', ws.b.id)
    await expect(
      t.db.$executeRawUnsafe(`INSERT INTO "ModelPlacement" ("id","workspaceId","modelId","folderId","updatedAt") VALUES ('x1', $1, 'momentum', $2, now())`, ws.a.id, theirs),
    ).rejects.toThrow(/not in workspace/)
  })

  it('pollers get 304 until something changes', async () => {
    const first = await api.as('ana@a.test').get(org(ws.a.id))
    const tag = first.headers.get('ETag')!
    expect((await api.as('ana@a.test').get(org(ws.a.id), { 'If-None-Match': tag })).status).toBe(304)
    await api.as('ben@a.test').post(`/workspaces/${ws.a.id}/folders`, { name: 'New one' })
    const after = await api.as('ana@a.test').get(org(ws.a.id), { 'If-None-Match': tag })
    expect(after.status).toBe(200)
    expect(after.body.folders.some((f: { name: string }) => f.name === 'New one')).toBe(true)
  })
})
