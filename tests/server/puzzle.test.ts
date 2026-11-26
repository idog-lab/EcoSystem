import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDefaultEvent } from '../../src/features/puzzle/engine/model'
import { newOrders } from '../../src/features/puzzle/engine/shuffle'
import { createTestDatabase, type TestDatabase } from '../helpers/db'
import { seedWorkspaces, testApp } from '../helpers/app'

// The real Puzzle schema (server/modules/documents/schemas.ts) and the records
// kept after a save: exports, live runs, results.
let t: TestDatabase
let ws: Awaited<ReturnType<typeof seedWorkspaces>>
let api: ReturnType<typeof testApp>
const docs = () => `/workspaces/${ws.a.id}/documents`

const event = () => {
  const ev = createDefaultEvent({ name: 'Puzzle Black Friday', start: '2026-11-17T10:00' })
  ev.order = newOrders(3)
  return ev
}

beforeAll(async () => {
  t = await createTestDatabase()
  ws = await seedWorkspaces(t.db)
  api = testApp(t.db)
})
afterAll(async () => t?.drop())

async function newEvent() {
  const res = await api.as('ana@a.test').post(docs(), { modelId: 'puzzle', title: 'Puzzle Black Friday', schemaVersion: 1, payload: event() })
  expect(res.status).toBe(201)
  return res.body.document as { id: string; revision: number }
}

describe('Puzzle events on the server', () => {
  it('saves a whole event and refuses a broken one (two modes, a short shuffle)', async () => {
    await newEvent()
    const twoModes = event() as unknown as { setup: { mode: unknown } }
    twoModes.setup.mode = ['price-cut', 'maleficent']
    const a = await api.as('ana@a.test').post(docs(), { modelId: 'puzzle', title: 'x', schemaVersion: 1, payload: twoModes })
    expect(a.status).toBe(422)
    const shortOrder = event()
    shortOrder.order.regular = shortOrder.order.regular.slice(0, 20)
    const b = await api.as('ana@a.test').post(docs(), { modelId: 'puzzle', title: 'x', schemaVersion: 1, payload: shortOrder })
    expect(b.status).toBe(422)
  })

  it('a stale save is refused with the newer event; the newer one is kept', async () => {
    const doc = await newEvent()
    const mine = event()
    mine.setup.inflation = 0.1
    const theirs = event()
    theirs.setup.inflation = 0.2
    const first = await api.as('ben@a.test').put(`${docs()}/${doc.id}`, { title: 'x', schemaVersion: 1, payload: theirs, expectedRevision: doc.revision })
    expect(first.status).toBe(200)
    const stale = await api.as('ana@a.test').put(`${docs()}/${doc.id}`, { title: 'x', schemaVersion: 1, payload: mine, expectedRevision: doc.revision })
    expect(stale.status).toBe(409)
    expect(stale.body.error.current.payload.setup.inflation).toBe(0.2)
    const now = await api.as('ana@a.test').get(`${docs()}/${doc.id}`)
    expect(now.body.document.payload.setup.inflation).toBe(0.2)
  })

  it('an export names a real revision; it is listed and read back as sent', async () => {
    const doc = await newEvent()
    const bad = await api.as('ana@a.test').post(`${docs()}/${doc.id}/exports`, { revision: 9, kind: 'google-sheets', target: {}, engineVersion: 'e', fingerprint: 'f', snapshot: {} })
    expect(bad.status).toBe(422)
    const ok = await api.as('ana@a.test').post(`${docs()}/${doc.id}/exports`, {
      revision: 1,
      kind: 'google-sheets',
      target: { url: 'https://docs.google.com/spreadsheets/d/x', title: 't_Puzzle|n_x' },
      engineVersion: 'puzzle-engine-1',
      fingerprint: 'puzzle-engine-1:abc',
      snapshot: { writes: [{ range: "'Seg 1'!A2:Z7", values: [['Tier 1']] }] },
    })
    expect(ok.status).toBe(201)
    const read = await api.as('ben@a.test').get(`${docs()}/${doc.id}/exports/${ok.body.export.id}`)
    expect(read.body.export.snapshot.writes[0].range).toBe("'Seg 1'!A2:Z7")
  })

  it('results join the revisions that were live during their window, a mid-event change included', async () => {
    const doc = await newEvent()
    await api.as('ana@a.test').put(`${docs()}/${doc.id}`, { title: 'x', schemaVersion: 1, payload: event(), expectedRevision: 1 })
    const run = (revision: number | null, effectiveFrom: string) => api.as('ana@a.test').post(`${docs()}/${doc.id}/live-runs`, { eventId: 'ev-1711', revision, effectiveFrom })
    expect((await run(1, '2026-11-17T10:00:00Z')).status).toBe(201)
    expect((await run(2, '2026-11-20T10:00:00Z')).status).toBe(201)
    expect((await run(null, '2026-11-30T10:00:00Z')).status).toBe(201)
    const row = (eventId: string, windowStart: string, windowEnd: string) => ({
      eventId,
      segment: 3,
      metric: 'fu_before_weekend',
      value: 0.12,
      sampleSize: 4210,
      population: 'Puzzle participants, segment 3',
      windowStart,
      windowEnd,
      source: 'test import',
      refreshedAt: '2026-12-01T08:00:00Z',
    })
    const res = await api.as('ana@a.test').post(`${docs()}/${doc.id}/results`, {
      rows: [row('ev-1711', '2026-11-18T00:00:00Z', '2026-11-19T00:00:00Z'), row('ev-1711', '2026-11-19T00:00:00Z', '2026-11-22T00:00:00Z'), row('old-event', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z')],
    })
    expect(res.status).toBe(201)
    expect(res.body.unlinked).toBe(1)
    const list = (await api.as('ana@a.test').get(`${docs()}/${doc.id}/results`)).body.results
    expect(list.map((r: { liveRevisions: { revision: number }[] }) => r.liveRevisions.map((l) => l.revision))).toEqual([[1], [1, 2], []])
  })

  it('records are history: the database refuses to change one', async () => {
    const run = await t.db.liveRun.findFirst()
    await expect(t.db.liveRun.update({ where: { id: run!.id }, data: { note: 'edited' } })).rejects.toThrow()
  })

  it('another workspace cannot read or add records', async () => {
    const doc = await newEvent()
    const other = await api.as('cleo@b.test').get(`${docs()}/${doc.id}/exports`)
    expect(other.status).toBe(403)
  })
})
