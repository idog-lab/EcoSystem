// PUZZLE WITHOUT THE SERVER. The live site (GitHub Pages) has no toolkit
// server behind it, so there Puzzle answers its own requests from this
// browser - the same routes, the same answers, the same rules (a save names
// the revision it was made from; a stale one is refused with the newer event;
// exports, live runs and results are only ever added) - and shares what it
// keeps with the team through the private data repository, like the other
// tools (src/lib/teamData.js, "puzzle/events.json").
//
// Kept under one key, `superplay-puzzle` (so "Download all my data" takes it).
// Revisions: the newest 10 of an event, plus every one an export or a live run
// names - the file every browser shares has to stay small.

import type { ApiResult } from '../../../platform/api/client'
import { puzzleEventSchema, progressQuantilesSchema } from '../engine/schema'

export const PUZZLE_STORAGE_KEY = 'superplay-puzzle'
const KEPT_REVISIONS = 10
const METRICS = ['revshare_finished', 'paying_finished', 'revshare_finished_before_weekend', 'fu_before_weekend', 'players']

type Rev = { revision: number; title: string; payload: unknown; by: string; createdAt: string }
type Doc = { id: string; title: string; revision: number; payload: unknown; createdAt: string; updatedAt: string; revisions: Rev[] }
type ExportRec = { id: string; revision: number; kind: string; target: unknown; engineVersion: string; fingerprint: string; snapshot: unknown; by: string; createdAt: string }
type LiveRun = { id: string; eventId: string; revision: number | null; effectiveFrom: string; note: string; by: string; createdAt: string }
type Result = Record<string, unknown> & { id: string; eventId: string; windowStart: string; windowEnd: string; liveRevisions: unknown[] }
export type Store = {
  documents: Record<string, Doc>
  records: Record<string, { exports: ExportRec[]; liveRuns: LiveRun[]; results: Result[] }>
  assumptions: Record<string, { payload: unknown; revision: number; updatedAt: string }>
}

const empty = (): Store => ({ documents: {}, records: {}, assumptions: {} })
const ok = <T>(data: T, status = 200): ApiResult<T> => ({ ok: true, status, data, etag: null })
const fail = (status: number, code: string, message: string, current?: unknown): ApiResult<never> => ({ ok: false, status, code, message, current })
const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const dto = (d: Doc) => ({ id: d.id, modelId: 'puzzle', title: d.title, revision: d.revision, payload: d.payload, schemaVersion: 1, createdAt: d.createdAt, updatedAt: d.updatedAt })

export type LocalBackendDeps = {
  storage?: () => Pick<Storage, 'getItem' | 'setItem'>
  /** Called after every write (the app hands the change to the team's data repository). */
  onChange?: () => void
  who?: () => string
  now?: () => Date
}

/** The live revisions in force at some point of [from, to] (the server's rule, server/modules/records). */
export function liveRevisionsDuring(runs: LiveRun[], eventId: string, from: Date, to: Date) {
  const mine = runs.filter((r) => r.eventId === eventId).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.createdAt.localeCompare(b.createdAt))
  const out: { revision: number; from: string; to: string | null }[] = []
  mine.forEach((r, i) => {
    if (r.revision == null) return
    const start = new Date(r.effectiveFrom)
    const end = mine[i + 1] ? new Date(mine[i + 1]!.effectiveFrom) : null
    if (start <= to && (end == null || end > from)) out.push({ revision: r.revision, from: start.toISOString(), to: end ? end.toISOString() : null })
  })
  return out
}

export function createLocalBackend({ storage = () => globalThis.localStorage, onChange = () => {}, who = () => 'this browser', now = () => new Date() }: LocalBackendDeps = {}) {
  const read = (): Store => {
    try {
      const raw = storage().getItem(PUZZLE_STORAGE_KEY)
      if (!raw) return empty()
      const s = JSON.parse(raw) as Partial<Store>
      return { documents: s.documents ?? {}, records: s.records ?? {}, assumptions: s.assumptions ?? {} }
    } catch {
      return empty()
    }
  }
  const write = (s: Store): ApiResult<never> | null => {
    try {
      storage().setItem(PUZZLE_STORAGE_KEY, JSON.stringify(s))
    } catch {
      return fail(507, 'storage_full', 'This browser has no room left to save Puzzle events. Nothing was changed.')
    }
    onChange()
    return null
  }
  const recordsOf = (s: Store, id: string) => (s.records[id] ??= { exports: [], liveRuns: [], results: [] })
  const prune = (s: Store, d: Doc) => {
    const named = new Set<number>()
    for (const e of s.records[d.id]?.exports ?? []) named.add(e.revision)
    for (const r of s.records[d.id]?.liveRuns ?? []) if (r.revision != null) named.add(r.revision)
    const newest = d.revisions.map((r) => r.revision).sort((a, b) => b - a).slice(0, KEPT_REVISIONS)
    d.revisions = d.revisions.filter((r) => named.has(r.revision) || newest.includes(r.revision))
  }

  async function call<T>(path: string, { method = 'GET', body, headers = {} }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const s = read()
    const at = now().toISOString()
    const u = new URL(path, 'http://local')
    const parts = u.pathname.split('/').filter(Boolean)
    // /workspaces/<ws>/assumptions/<key>
    if (parts[2] === 'assumptions') {
      const key = parts[3]!
      if (key !== 'puzzle-progress-quantiles') return fail(422, 'no_schema', `No assumption set "${key}".`) as ApiResult<T>
      const cur = s.assumptions[key]
      if (method === 'GET') return (cur ? ok({ assumptionSet: { key, schemaVersion: 1, ...cur } }) : fail(404, 'not_found', `Assumption set "${key}" was not found.`)) as ApiResult<T>
      const b = body as { expectedRevision: number; payload: unknown }
      if ((cur?.revision ?? 0) !== b.expectedRevision) return fail(409, 'conflict', 'Someone saved this data first.', cur) as ApiResult<T>
      const parsed = progressQuantilesSchema.safeParse(b.payload)
      if (!parsed.success) return fail(422, 'validation', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')) as ApiResult<T>
      s.assumptions[key] = { payload: parsed.data, revision: (cur?.revision ?? 0) + 1, updatedAt: at }
      return (write(s) ?? ok({ assumptionSet: { key, schemaVersion: 1, ...s.assumptions[key] } })) as ApiResult<T>
    }
    if (parts[2] !== 'documents') return fail(404, 'not_found', 'No such route.') as ApiResult<T>
    const id = parts[3]
    const sub = parts[4]
    const doc = id ? s.documents[id] : undefined
    if (id && !doc) return fail(404, 'not_found', 'This document was not found.') as ApiResult<T>
    const validate = (payload: unknown) => {
      const p = puzzleEventSchema.safeParse(payload)
      return p.success ? null : fail(422, 'validation', `A Puzzle event: ${p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
    }

    if (!id) {
      if (method === 'GET')
        return ok({
          documents: Object.values(s.documents)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map((d) => ({ id: d.id, modelId: 'puzzle', title: d.title, revision: d.revision, updatedAt: d.updatedAt })),
        }) as ApiResult<T>
      const b = body as { title: string; payload: unknown }
      const bad = validate(b.payload)
      if (bad) return bad as ApiResult<T>
      const d: Doc = { id: newId(), title: b.title, revision: 1, payload: b.payload, createdAt: at, updatedAt: at, revisions: [{ revision: 1, title: b.title, payload: b.payload, by: who(), createdAt: at }] }
      s.documents[d.id] = d
      return (write(s) ?? ok({ document: dto(d) }, 201)) as ApiResult<T>
    }
    const d = doc!
    if (!sub) {
      if (method === 'GET') {
        if (headers['If-None-Match'] === `"r${d.revision}"`) return { ok: true, status: 304, data: null as T, etag: `"r${d.revision}"` }
        return ok({ document: dto(d) }) as ApiResult<T>
      }
      const b = body as { title: string; payload: unknown; expectedRevision: number }
      const bad = validate(b.payload)
      if (bad) return bad as ApiResult<T>
      if (b.expectedRevision !== d.revision) return fail(409, 'conflict', 'This document was changed by someone else.', dto(d)) as ApiResult<T>
      d.revision += 1
      d.title = b.title
      d.payload = b.payload
      d.updatedAt = at
      d.revisions.push({ revision: d.revision, title: b.title, payload: b.payload, by: who(), createdAt: at })
      prune(s, d)
      return (write(s) ?? ok({ document: dto(d) })) as ApiResult<T>
    }
    const rec = recordsOf(s, d.id)
    if (sub === 'revisions') {
      const rev = d.revisions.find((r) => r.revision === Number(parts[5]))
      return (rev ? ok({ revision: { revision: rev.revision, title: rev.title, payload: rev.payload, createdAt: rev.createdAt } }) : fail(404, 'not_found', 'This revision is not kept in this browser.')) as ApiResult<T>
    }
    if (sub === 'exports') {
      if (method === 'GET' && parts[5]) {
        const e = rec.exports.find((x) => x.id === parts[5])
        return (e ? ok({ export: e }) : fail(404, 'not_found', 'This export was not found.')) as ApiResult<T>
      }
      if (method === 'GET') return ok({ exports: [...rec.exports].reverse() }) as ApiResult<T>
      const b = body as Omit<ExportRec, 'id' | 'by' | 'createdAt'>
      if (!d.revisions.some((r) => r.revision === b.revision)) return fail(422, 'invalid_revision', `Revision ${b.revision} of this document does not exist.`) as ApiResult<T>
      // The cells sent are not copied into the shared file (50-60 KB each): the same revision and engine
      // version rebuild them exactly (tests/puzzle/export.test.ts), and that revision is always kept.
      const e: ExportRec = { ...b, snapshot: { rebuildFrom: { revision: b.revision, engineVersion: b.engineVersion } }, id: newId(), by: who(), createdAt: at }
      rec.exports.push(e)
      return (write(s) ?? ok({ export: { id: e.id, createdAt: at } }, 201)) as ApiResult<T>
    }
    if (sub === 'live-runs') {
      if (method === 'GET') return ok({ liveRuns: [...rec.liveRuns].sort((a, b) => a.eventId.localeCompare(b.eventId) || a.effectiveFrom.localeCompare(b.effectiveFrom)) }) as ApiResult<T>
      const b = body as { eventId: string; revision: number | null; effectiveFrom: string; note?: string }
      if (!b.eventId?.trim()) return fail(400, 'validation', 'eventId: required') as ApiResult<T>
      if (!Number.isFinite(Date.parse(b.effectiveFrom))) return fail(400, 'validation', 'effectiveFrom: a date and time') as ApiResult<T>
      if (b.revision != null && !d.revisions.some((r) => r.revision === b.revision)) return fail(422, 'invalid_revision', `Revision ${b.revision} of this document does not exist.`) as ApiResult<T>
      const r: LiveRun = { id: newId(), eventId: b.eventId.trim(), revision: b.revision, effectiveFrom: new Date(b.effectiveFrom).toISOString(), note: b.note ?? '', by: who(), createdAt: at }
      rec.liveRuns.push(r)
      return (write(s) ?? ok({ liveRun: { id: r.id } }, 201)) as ApiResult<T>
    }
    if (sub === 'results') {
      if (method === 'GET') return ok({ results: rec.results }) as ApiResult<T>
      const rows = (body as { rows: Record<string, unknown>[] }).rows ?? []
      let unlinked = 0
      const added: Result[] = []
      for (const row of rows) {
        if (!METRICS.includes(String(row.metric))) return fail(400, 'validation', `metric: one of ${METRICS.join(', ')}`) as ApiResult<T>
        const from = new Date(String(row.windowStart))
        const to = new Date(String(row.windowEnd))
        if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return fail(400, 'validation', 'windowStart / windowEnd: a date and time') as ApiResult<T>
        if (!(from <= to)) return fail(422, 'validation', `A result window starts after it ends (${row.windowStart} > ${row.windowEnd}).`) as ApiResult<T>
        const live = liveRevisionsDuring(rec.liveRuns, String(row.eventId), from, to)
        if (live.length === 0) unlinked++
        added.push({ ...row, id: newId(), eventId: String(row.eventId), windowStart: from.toISOString(), windowEnd: to.toISOString(), liveRevisions: live })
      }
      rec.results.push(...added)
      return (write(s) ?? ok({ added: added.length, unlinked }, 201)) as ApiResult<T>
    }
    return fail(404, 'not_found', 'No such route.') as ApiResult<T>
  }
  return { call }
}
