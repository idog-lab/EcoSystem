import type { Prisma } from '../../db/generated/client'
import type { Db } from '../../db/prisma'
import { ApiError, notFound } from '../../http/errors'

// What happened to a saved document afterwards: exports made from a
// revision, which revision ran live for which event and from when, and
// results measured for that event. Rows are only ever added.

/** Result metrics an import may hold. Their definitions and denominators are Looker's (mapping not yet confirmed). */
export const RESULT_METRICS = ['revshare_finished', 'paying_finished', 'revshare_finished_before_weekend', 'fu_before_weekend', 'players'] as const

export type ExportInput = { revision: number; kind: string; target: unknown; engineVersion: string; fingerprint: string; snapshot: unknown }
export type LiveRunInput = { eventId: string; revision: number | null; effectiveFrom: string; note: string }
export type ResultInput = {
  eventId: string
  segment: number | null
  metric: string
  value: number | null
  sampleSize: number | null
  population: string
  windowStart: string
  windowEnd: string
  source: string
  refreshedAt: string
}

const iso = (d: Date) => d.toISOString()

export function createRecordService(db: Db) {
  const ownDocument = async (workspaceId: string, documentId: string) => {
    const doc = await db.modelDocument.findFirst({ where: { id: documentId, workspaceId }, select: { id: true } })
    if (!doc) throw notFound('This document')
  }
  const revisionExists = async (documentId: string, revision: number) => {
    const r = await db.documentRevision.findUnique({ where: { documentId_revision: { documentId, revision } }, select: { id: true } })
    if (!r) throw new ApiError(422, 'invalid_revision', `Revision ${revision} of this document does not exist.`)
  }

  /** The live revisions in force at some point of [from, to], from the recorded runs of this event. */
  async function liveRevisionsDuring(documentId: string, eventId: string, from: Date, to: Date) {
    const runs = await db.liveRun.findMany({ where: { documentId, eventId }, orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }] })
    const out: { revision: number; from: string; to: string | null }[] = []
    runs.forEach((r, i) => {
      if (r.revision == null) return
      const end = runs[i + 1]?.effectiveFrom ?? null
      if (r.effectiveFrom <= to && (end == null || end > from)) out.push({ revision: r.revision, from: iso(r.effectiveFrom), to: end ? iso(end) : null })
    })
    return out
  }

  return {
    async listExports(workspaceId: string, documentId: string) {
      await ownDocument(workspaceId, documentId)
      const rows = await db.documentExport.findMany({ where: { documentId }, orderBy: { createdAt: 'desc' }, include: { actor: { select: { name: true } } } })
      return rows.map((r) => ({ id: r.id, revision: r.revision, kind: r.kind, target: r.target, engineVersion: r.engineVersion, fingerprint: r.fingerprint, by: r.actor.name, createdAt: iso(r.createdAt) }))
    },
    async getExport(workspaceId: string, documentId: string, exportId: string) {
      await ownDocument(workspaceId, documentId)
      const r = await db.documentExport.findFirst({ where: { id: exportId, documentId } })
      if (!r) throw notFound('This export')
      return { id: r.id, revision: r.revision, kind: r.kind, target: r.target, engineVersion: r.engineVersion, fingerprint: r.fingerprint, snapshot: r.snapshot, createdAt: iso(r.createdAt) }
    },
    async addExport(workspaceId: string, actorId: string, documentId: string, input: ExportInput) {
      await ownDocument(workspaceId, documentId)
      await revisionExists(documentId, input.revision)
      const r = await db.documentExport.create({
        data: {
          documentId,
          revision: input.revision,
          kind: input.kind,
          target: input.target as Prisma.InputJsonValue,
          engineVersion: input.engineVersion,
          fingerprint: input.fingerprint,
          snapshot: input.snapshot as Prisma.InputJsonValue,
          actorId,
        },
      })
      return { id: r.id, createdAt: iso(r.createdAt) }
    },

    async listLiveRuns(workspaceId: string, documentId: string) {
      await ownDocument(workspaceId, documentId)
      const rows = await db.liveRun.findMany({ where: { documentId }, orderBy: [{ eventId: 'asc' }, { effectiveFrom: 'asc' }], include: { actor: { select: { name: true } } } })
      return rows.map((r) => ({ id: r.id, eventId: r.eventId, revision: r.revision, effectiveFrom: iso(r.effectiveFrom), note: r.note, by: r.actor.name, createdAt: iso(r.createdAt) }))
    },
    async addLiveRun(workspaceId: string, actorId: string, documentId: string, input: LiveRunInput) {
      await ownDocument(workspaceId, documentId)
      if (input.revision != null) await revisionExists(documentId, input.revision)
      const r = await db.liveRun.create({ data: { documentId, eventId: input.eventId, revision: input.revision, effectiveFrom: new Date(input.effectiveFrom), note: input.note, actorId } })
      return { id: r.id }
    },

    async listResults(workspaceId: string, documentId: string) {
      await ownDocument(workspaceId, documentId)
      const rows = await db.observedResult.findMany({ where: { documentId }, orderBy: [{ eventId: 'asc' }, { windowStart: 'asc' }] })
      return rows.map((r) => ({
        id: r.id,
        eventId: r.eventId,
        segment: r.segment,
        metric: r.metric,
        value: r.value,
        sampleSize: r.sampleSize,
        population: r.population,
        windowStart: iso(r.windowStart),
        windowEnd: iso(r.windowEnd),
        source: r.source,
        refreshedAt: iso(r.refreshedAt),
        liveRevisions: r.liveRevisions,
      }))
    },
    /** Stores results, each joined to the live revisions of its window. One without a recorded run keeps [] and is never a training label. */
    async addResults(workspaceId: string, actorId: string, documentId: string, rows: ResultInput[]) {
      await ownDocument(workspaceId, documentId)
      return db.$transaction(async (tx) => {
        let unlinked = 0
        for (const row of rows) {
          const from = new Date(row.windowStart)
          const to = new Date(row.windowEnd)
          if (!(from <= to)) throw new ApiError(422, 'validation', `A result window starts after it ends (${row.windowStart} > ${row.windowEnd}).`)
          const live = await liveRevisionsDuring(documentId, row.eventId, from, to)
          if (live.length === 0) unlinked++
          await tx.observedResult.create({
            data: {
              documentId,
              eventId: row.eventId,
              segment: row.segment,
              metric: row.metric,
              value: row.value,
              sampleSize: row.sampleSize,
              population: row.population,
              windowStart: from,
              windowEnd: to,
              source: row.source,
              refreshedAt: new Date(row.refreshedAt),
              liveRevisions: live as Prisma.InputJsonValue,
              actorId,
            },
          })
        }
        return { added: rows.length, unlinked }
      })
    },
  }
}
