import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createTestDatabase, type TestDatabase } from '../helpers/db'
import { seedWorkspaces, testApp } from '../helpers/app'

// Made up for the tests: no real assumption set is registered yet.
const FIXTURE = { 'test-values': { schemaVersion: 1, schema: z.record(z.string(), z.number()) } }

let t: TestDatabase
let ws: Awaited<ReturnType<typeof seedWorkspaces>>
let api: ReturnType<typeof testApp>
const path = () => `/workspaces/${ws.a.id}/assumptions/test-values`

beforeAll(async () => {
  t = await createTestDatabase()
  ws = await seedWorkspaces(t.db)
  api = testApp(t.db, { assumptionSchemas: FIXTURE })
})
afterAll(async () => t?.drop())

describe('shared assumptions', () => {
  it('refuses a set with no registered format', async () => {
    const res = await api.as('ana@a.test').put(`/workspaces/${ws.a.id}/assumptions/economy-values`, { expectedRevision: 0, schemaVersion: 1, payload: {} })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('no_schema')
  })

  it('is versioned like documents, and every revision can be read back exactly', async () => {
    const created = await api.as('ana@a.test').put(path(), { expectedRevision: 0, schemaVersion: 1, payload: { coin: 1 } })
    expect(created.status).toBe(201)
    const again = await api.as('ben@a.test').put(path(), { expectedRevision: 0, schemaVersion: 1, payload: { coin: 9 } })
    expect(again.status).toBe(409)

    const next = await api.as('ben@a.test').put(path(), { expectedRevision: 1, schemaVersion: 1, payload: { coin: 1, wild: 2.5 } })
    expect(next.body.assumptionSet.revision).toBe(2)
    const stale = await api.as('ana@a.test').put(path(), { expectedRevision: 1, schemaVersion: 1, payload: { coin: 2 } })
    expect(stale.status).toBe(409)
    expect(stale.body.error.current.payload).toEqual({ coin: 1, wild: 2.5 })

    // What a saved run will reference: an exact, unchangeable revision.
    const r1 = await api.as('ana@a.test').get(`${path()}/revisions/1`)
    expect(r1.body.revision).toMatchObject({ revision: 1, payload: { coin: 1 } })
    expect(r1.body.revision.id).toBe(created.body.revisionId)
    await expect(t.db.$executeRawUnsafe(`UPDATE "AssumptionRevision" SET "payload" = '{}'`)).rejects.toThrow(/immutable/)
  })
})
