import type { Db } from '../../db/prisma'
import type { Prisma } from '../../db/generated/client'
import { isModelId, modelById } from '../../../src/platform/registry/catalog'
import { ApiError, notFound } from '../../http/errors'
import { validatePayload } from '../../lib/payload'
import { nextRevision, writeAtRevision } from '../../lib/revisions'
import type { PayloadSchemaRegistry } from './schemas'

// A model's saved work, shared by every member of the workspace. Each save
// is a new immutable DocumentRevision; a save made from an old revision is
// refused (409) and nothing is overwritten.

export type DocumentDto = {
  id: string
  modelId: string
  title: string
  schemaVersion: number
  payload: unknown
  revision: number
  updatedAt: string
}

type DocRow = { id: string; modelId: string; title: string; schemaVersion: number; payload: unknown; revision: number; updatedAt: Date }
const documentDto = (d: DocRow): DocumentDto => ({
  id: d.id,
  modelId: d.modelId,
  title: d.title,
  schemaVersion: d.schemaVersion,
  payload: d.payload,
  revision: d.revision,
  updatedAt: d.updatedAt.toISOString(),
})

export type DocumentInput = { title: string; schemaVersion: number; payload: unknown }

function checkModel(modelId: string) {
  if (!isModelId(modelId)) throw new ApiError(404, 'unknown_model', `There is no model "${modelId}" in the catalog.`)
  return modelById(modelId)!
}

export function createDocumentService(db: Db, schemas: PayloadSchemaRegistry) {
  const validate = (modelId: string, input: DocumentInput) =>
    validatePayload(schemas, modelId, input.schemaVersion, input.payload, `A ${checkModel(modelId).displayName} document`) as Prisma.InputJsonValue

  return {
    async list(workspaceId: string, modelId?: string) {
      if (modelId) checkModel(modelId)
      const rows = await db.modelDocument.findMany({
        where: { workspaceId, ...(modelId ? { modelId } : {}) },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, modelId: true, title: true, revision: true, updatedAt: true },
      })
      return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }))
    },

    async get(workspaceId: string, documentId: string) {
      const doc = await db.modelDocument.findFirst({ where: { id: documentId, workspaceId } })
      if (!doc) throw notFound('This document')
      return documentDto(doc)
    },

    async create(workspaceId: string, actorId: string, modelId: string, input: DocumentInput) {
      checkModel(modelId)
      const payload = validate(modelId, input)
      return db.$transaction(async (tx) => {
        const doc = await tx.modelDocument.create({
          data: { workspaceId, modelId, title: input.title, schemaVersion: input.schemaVersion, payload },
        })
        await tx.documentRevision.create({
          data: { documentId: doc.id, revision: doc.revision, title: doc.title, schemaVersion: doc.schemaVersion, payload, actorId },
        })
        return documentDto(doc)
      })
    },

    async save(workspaceId: string, actorId: string, documentId: string, expectedRevision: number, input: DocumentInput) {
      const existing = await db.modelDocument.findFirst({ where: { id: documentId, workspaceId }, select: { modelId: true } })
      if (!existing) throw notFound('This document')
      const payload = validate(existing.modelId, input)
      return db.$transaction(async (tx) => {
        const doc = await writeAtRevision({
          what: 'This document',
          expectedRevision,
          update: () =>
            tx.modelDocument.updateMany({
              where: { id: documentId, workspaceId, revision: expectedRevision },
              data: { title: input.title, schemaVersion: input.schemaVersion, payload, ...nextRevision },
            }),
          load: () => tx.modelDocument.findFirst({ where: { id: documentId, workspaceId } }),
          present: documentDto,
        })
        await tx.documentRevision.create({
          data: { documentId, revision: doc.revision, title: input.title, schemaVersion: input.schemaVersion, payload, actorId },
        })
        return doc
      })
    },

    async revisions(workspaceId: string, documentId: string) {
      await this.get(workspaceId, documentId)
      const rows = await db.documentRevision.findMany({
        where: { documentId },
        orderBy: { revision: 'desc' },
        select: { revision: true, title: true, createdAt: true, actor: { select: { id: true, name: true, email: true } } },
      })
      return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
    },

    async revision(workspaceId: string, documentId: string, revision: number) {
      await this.get(workspaceId, documentId)
      const row = await db.documentRevision.findUnique({ where: { documentId_revision: { documentId, revision } } })
      if (!row) throw notFound(`Revision ${revision}`)
      return { revision: row.revision, title: row.title, schemaVersion: row.schemaVersion, payload: row.payload, actorId: row.actorId, createdAt: row.createdAt.toISOString() }
    },
  }
}
