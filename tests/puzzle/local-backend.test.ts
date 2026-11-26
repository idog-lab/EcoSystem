import { describe, expect, it } from 'vitest'
import { createDefaultEvent } from '../../src/features/puzzle/engine/model'
import { newOrders } from '../../src/features/puzzle/engine/shuffle'
import { createLocalBackend, PUZZLE_STORAGE_KEY } from '../../src/features/puzzle/ui/localBackend'
import { SHARED_ITEMS } from '../../src/lib/teamData'

// Puzzle where no toolkit server runs (the live site): the same rules as the
// server, kept in the browser and shared through the team's data repository.
function memory(limit = Infinity) {
  const m = new Map<string, string>()
  return {
    m,
    storage: () => ({
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (v.length > limit) throw new Error('QuotaExceededError')
        m.set(k, v)
      },
    }),
  }
}
const event = () => {
  const ev = createDefaultEvent({ name: 'Puzzle Black Friday', start: '2026-11-17T10:00' })
  ev.order = newOrders(3)
  return ev
}
const D = '/workspaces/local/documents'
type Doc = { id: string; revision: number; payload: ReturnType<typeof event> }

describe('Puzzle in the browser (no server)', () => {
  it('is one of the things shared with the team', () => {
    expect(SHARED_ITEMS.find((i) => i.key === PUZZLE_STORAGE_KEY)?.path).toBe('puzzle/events.json')
  })

  it('creates, lists, opens and saves an event with revisions; every write is handed to the team', async () => {
    const mem = memory()
    let changes = 0
    const b = createLocalBackend({ storage: mem.storage, onChange: () => changes++ })
    const c = await b.call<{ document: Doc }>(D, { method: 'POST', body: { title: 'Puzzle Black Friday', payload: event() } })
    expect(c.ok && c.status).toBe(201)
    const id = (c as { data: { document: Doc } }).data.document.id
    const ev = event()
    ev.setup.inflation = 0.1
    const s = await b.call<{ document: Doc }>(`${D}/${id}`, { method: 'PUT', body: { title: 'x', payload: ev, expectedRevision: 1 } })
    expect(s.ok && s.data.document.revision).toBe(2)
    const list = await b.call<{ documents: { id: string; revision: number }[] }>(D)
    expect(list.ok && list.data.documents.map((d) => [d.id, d.revision])).toEqual([[id, 2]])
    const unchanged = await b.call(`${D}/${id}`, { headers: { 'If-None-Match': '"r2"' } })
    expect(unchanged.status).toBe(304)
    expect(changes).toBe(2)
    expect(JSON.parse(mem.m.get(PUZZLE_STORAGE_KEY)!).documents[id].payload.setup.inflation).toBe(0.1)
  })

  it('a stale save is refused with the newer event; a broken event is refused', async () => {
    const b = createLocalBackend({ storage: memory().storage })
    const c = await b.call<{ document: Doc }>(D, { method: 'POST', body: { title: 'x', payload: event() } })
    const id = (c as { data: { document: Doc } }).data.document.id
    const theirs = event()
    theirs.setup.mtxBaseline = 0.7
    await b.call(`${D}/${id}`, { method: 'PUT', body: { title: 'x', payload: theirs, expectedRevision: 1 } })
    const stale = await b.call(`${D}/${id}`, { method: 'PUT', body: { title: 'x', payload: event(), expectedRevision: 1 } })
    expect(stale.ok).toBe(false)
    expect(!stale.ok && stale.status).toBe(409)
    expect(!stale.ok && (stale.current as Doc).payload.setup.mtxBaseline).toBe(0.7)
    const twoModes = event() as unknown as { setup: { mode: unknown } }
    twoModes.setup.mode = ['price-cut', 'maleficent']
    const bad = await b.call(D, { method: 'POST', body: { title: 'x', payload: twoModes } })
    expect(!bad.ok && bad.status).toBe(422)
  })

  it('keeps the newest 10 revisions and every revision an export or a live run names', async () => {
    const mem = memory()
    const b = createLocalBackend({ storage: mem.storage })
    const c = await b.call<{ document: Doc }>(D, { method: 'POST', body: { title: 'x', payload: event() } })
    const id = (c as { data: { document: Doc } }).data.document.id
    expect((await b.call(`${D}/${id}/exports`, { method: 'POST', body: { revision: 1, kind: 'google-sheets', target: {}, engineVersion: 'e', fingerprint: 'f', snapshot: { big: 'x'.repeat(5000) } } })).status).toBe(201)
    expect((await b.call(`${D}/${id}/exports`, { method: 'POST', body: { revision: 7, kind: 'google-sheets', target: {}, engineVersion: 'e', fingerprint: 'f', snapshot: {} } })).status).toBe(422)
    for (let r = 1; r <= 14; r++) await b.call(`${D}/${id}`, { method: 'PUT', body: { title: 'x', payload: event(), expectedRevision: r } })
    const kept = JSON.parse(mem.m.get(PUZZLE_STORAGE_KEY)!).documents[id].revisions.map((r: { revision: number }) => r.revision)
    expect(kept).toEqual([1, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    expect((await b.call(`${D}/${id}/revisions/1`)).ok).toBe(true)
    // The cells of an export are rebuilt from its revision, not copied into the shared file.
    expect(mem.m.get(PUZZLE_STORAGE_KEY)!.includes('xxxxxxxx')).toBe(false)
  })

  it('results join the live revisions of their window, a mid-event change included; none recorded -> unlinked', async () => {
    const b = createLocalBackend({ storage: memory().storage })
    const c = await b.call<{ document: Doc }>(D, { method: 'POST', body: { title: 'x', payload: event() } })
    const id = (c as { data: { document: Doc } }).data.document.id
    await b.call(`${D}/${id}`, { method: 'PUT', body: { title: 'x', payload: event(), expectedRevision: 1 } })
    const run = (revision: number | null, effectiveFrom: string) => b.call(`${D}/${id}/live-runs`, { method: 'POST', body: { eventId: 'ev-1711', revision, effectiveFrom } })
    expect((await run(1, '2026-11-17T10:00:00Z')).status).toBe(201)
    expect((await run(2, '2026-11-20T10:00:00Z')).status).toBe(201)
    expect((await run(null, '2026-11-30T10:00:00Z')).status).toBe(201)
    expect((await run(9, '2026-11-30T10:00:00Z')).status).toBe(422)
    const row = (eventId: string, windowStart: string, windowEnd: string) => ({ eventId, segment: 3, metric: 'fu_before_weekend', value: 0.12, sampleSize: 4210, population: 'p', windowStart, windowEnd, source: 's', refreshedAt: '2026-12-01T08:00:00Z' })
    const res = await b.call<{ added: number; unlinked: number }>(`${D}/${id}/results`, {
      method: 'POST',
      body: { rows: [row('ev-1711', '2026-11-18T00:00:00Z', '2026-11-19T00:00:00Z'), row('ev-1711', '2026-11-19T00:00:00Z', '2026-11-22T00:00:00Z'), row('old', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z')] },
    })
    expect(res.ok && res.data).toEqual({ added: 3, unlinked: 1 })
    const list = await b.call<{ results: { liveRevisions: { revision: number }[] }[] }>(`${D}/${id}/results`)
    expect(list.ok && list.data.results.map((r) => r.liveRevisions.map((l) => l.revision))).toEqual([[1], [1, 2], []])
  })

  it('a browser with no room changes nothing and says so', async () => {
    const mem = memory(10)
    const b = createLocalBackend({ storage: mem.storage })
    const c = await b.call(D, { method: 'POST', body: { title: 'x', payload: event() } })
    expect(!c.ok && c.code).toBe('storage_full')
    expect(mem.m.size).toBe(0)
  })

  it('progression data: versioned, checked, refused when stale', async () => {
    const b = createLocalBackend({ storage: memory().storage })
    const A = '/workspaces/local/assumptions/puzzle-progress-quantiles'
    expect((await b.call(A)).status).toBe(404)
    const payload = { source: 's', asOf: '2026-11-01', population: 'p', rows: [{ segment: 1, day: 1, percentile: 50, progress: 0.1 }] }
    expect((await b.call(A, { method: 'PUT', body: { expectedRevision: 0, payload } })).ok).toBe(true)
    expect((await b.call(A, { method: 'PUT', body: { expectedRevision: 0, payload } })).status).toBe(409)
  })
})
