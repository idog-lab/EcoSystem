import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createTestDatabase, type TestDatabase } from '../helpers/db'
import { seedWorkspaces, testApp } from '../helpers/app'

// A made-up schema, for the tests only: no real model has a saved-data format
// on the server yet (server/modules/documents/schemas.ts).
const FIXTURE_SCHEMAS = { 'merge-mania': { schemaVersion: 1, schema: z.object({ note: z.string(), count: z.number().int() }) } }

let t: TestDatabase
let ws: Awaited<ReturnType<typeof seedWorkspaces>>
let api: ReturnType<typeof testApp>
const docs = () => `/workspaces/${ws.a.id}/documents`

beforeAll(async () => {
  t = await createTestDatabase()
  ws = await seedWorkspaces(t.db)
  api = testApp(t.db, { documentSchemas: FIXTURE_SCHEMAS })
})
afterAll(async () => t?.drop())

async function newDoc(payload = { note: 'start', count: 1 }) {
  const res = await api.as('ana@a.test').post(docs(), { modelId: 'merge-mania', title: 'Black Friday', schemaVersion: 1, payload })
  expect(res.status).toBe(201)
  return res.body.document as { id: string; revision: number }
}

describe('documents', () => {
  it('validates per model: refuses a bad payload, a model with no format, an unknown model', async () => {
    const bad = await api.as('ana@a.test').post(docs(), { modelId: 'merge-mania', title: 'x', schemaVersion: 1, payload: { note: 3 } })
    expect(bad.status).toBe(422)
    expect(bad.body.error.code).toBe('validation')
    const wrongVersion = await api.as('ana@a.test').post(docs(), { modelId: 'merge-mania', title: 'x', schemaVersion: 2, payload: { note: 'a', count: 1 } })
    expect(wrongVersion.status).toBe(422)
    const noSchema = await api.as('ana@a.test').post(docs(), { modelId: 'momentum', title: 'x', schemaVersion: 1, payload: {} })
    expect(noSchema.status).toBe(422)
    expect(noSchema.body.error.code).toBe('no_schema')
    const unknown = await api.as('ana@a.test').post(docs(), { modelId: 'battle-pass', title: 'x', schemaVersion: 1, payload: {} })
    expect(unknown.status).toBe(404)
    expect(await t.db.modelDocument.count()).toBe(0)
  })

  it('without a test registry, no model can save (none is migrated yet)', async () => {
    const plain = testApp(t.db)
    const res = await plain.as('ana@a.test').post(docs(), { modelId: 'merge-mania', title: 'x', schemaVersion: 1, payload: { note: 'a', count: 1 } })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('no_schema')
  })

  it('two saves from the same revision: one succeeds, one conflicts, and nothing is lost', async () => {
    const doc = await newDoc()
    const ana = await api.as('ana@a.test').put(`${docs()}/${doc.id}`, { expectedRevision: 1, title: 'Black Friday', schemaVersion: 1, payload: { note: 'ana', count: 2 } })
    const ben = await api.as('ben@a.test').put(`${docs()}/${doc.id}`, { expectedRevision: 1, title: 'Black Friday', schemaVersion: 1, payload: { note: 'ben', count: 3 } })

    expect(ana.status).toBe(200)
    expect(ana.body.document).toMatchObject({ revision: 2, payload: { note: 'ana', count: 2 } })
    expect(ben.status).toBe(409)
    expect(ben.body.error.code).toBe('conflict')
    // The loser is shown what is stored now...
    expect(ben.body.error.current).toMatchObject({ revision: 2, payload: { note: 'ana', count: 2 } })
    // ...the winner's save was not overwritten...
    expect((await api.as('ben@a.test').get(`${docs()}/${doc.id}`)).body.document.payload).toEqual({ note: 'ana', count: 2 })
    // ...and the loser can save their edit on top of it, deliberately.
    const retry = await api.as('ben@a.test').put(`${docs()}/${doc.id}`, { expectedRevision: 2, title: 'Black Friday', schemaVersion: 1, payload: { note: 'ben', count: 3 } })
    expect(retry.body.document.revision).toBe(3)

    const history = await api.as('ana@a.test').get(`${docs()}/${doc.id}/revisions`)
    expect(history.body.revisions.map((r: { revision: number; actor: { email: string } }) => [r.revision, r.actor.email])).toEqual([
      [3, 'ben@a.test'],
      [2, 'ana@a.test'],
      [1, 'ana@a.test'],
    ])
    const first = await api.as('ana@a.test').get(`${docs()}/${doc.id}/revisions/1`)
    expect(first.body.revision.payload).toEqual({ note: 'start', count: 1 })
  })

  it('the same race, truly at the same moment: exactly one save is stored', async () => {
    const doc = await newDoc()
    const results = await Promise.all(
      ['ana@a.test', 'ben@a.test'].map((who, i) =>
        api.as(who).put(`${docs()}/${doc.id}`, { expectedRevision: 1, title: 'T', schemaVersion: 1, payload: { note: who, count: i } }),
      ),
    )
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(await t.db.documentRevision.count({ where: { documentId: doc.id } })).toBe(2)
  })

  it('a saved revision cannot be changed or removed', async () => {
    const doc = await newDoc()
    await expect(t.db.$executeRawUnsafe(`UPDATE "DocumentRevision" SET "title" = 'x' WHERE "documentId" = $1`, doc.id)).rejects.toThrow(/immutable/)
    await expect(t.db.$executeRawUnsafe(`DELETE FROM "DocumentRevision" WHERE "documentId" = $1`, doc.id)).rejects.toThrow(/immutable/)
  })

  it('pollers get 304 while they hold the current revision', async () => {
    const doc = await newDoc()
    expect((await api.as('ben@a.test').get(`${docs()}/${doc.id}`, { 'If-None-Match': '"r1"' })).status).toBe(304)
  })

  it('another workspace cannot reach a document, even by its id', async () => {
    const doc = await newDoc()
    expect((await api.as('cleo@b.test').get(`${docs()}/${doc.id}`)).status).toBe(403)
    expect((await api.as('cleo@b.test').get(`/workspaces/${ws.b.id}/documents/${doc.id}`)).status).toBe(404)
    const write = await api.as('cleo@b.test').put(`/workspaces/${ws.b.id}/documents/${doc.id}`, { expectedRevision: 1, title: 'x', schemaVersion: 1, payload: { note: 'x', count: 0 } })
    expect(write.status).toBe(404)
  })
})
