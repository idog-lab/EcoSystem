import type { Db } from '../../db/prisma'
import { isUniqueViolation } from '../../db/prisma'
import type { Prisma } from '../../db/generated/client'
import { ApiError, notFound } from '../../http/errors'
import { validatePayload } from '../../lib/payload'
import { nextRevision, writeAtRevision } from '../../lib/revisions'
import type { PayloadSchemaRegistry } from '../documents/schemas'

// Shared assumptions, versioned with the same revision primitive as
// documents. A future saved run stores the AssumptionRevision it used
// (assumptionSetId + revision), so its result can always be traced to the
// exact values. Nothing here knows which model reads which set.

export const ASSUMPTION_KEY = /^[a-z0-9][a-z0-9-]{0,62}$/

type SetRow = { id: string; key: string; schemaVersion: number; payload: unknown; revision: number; updatedAt: Date }
export type AssumptionSetDto = { id: string; key: string; schemaVersion: number; payload: unknown; revision: number; updatedAt: string }
const setDto = (s: SetRow): AssumptionSetDto => ({
  id: s.id,
  key: s.key,
  schemaVersion: s.schemaVersion,
  payload: s.payload,
  revision: s.revision,
  updatedAt: s.updatedAt.toISOString(),
})

export function createAssumptionService(db: Db, schemas: PayloadSchemaRegistry) {
  const checkKey = (key: string) => {
    if (!ASSUMPTION_KEY.test(key)) throw new ApiError(400, 'validation', 'An assumption key is lower-case letters, digits and dashes.')
  }
  return {
    async list(workspaceId: string) {
      const rows = await db.assumptionSet.findMany({ where: { workspaceId }, orderBy: { key: 'asc' } })
      return rows.map(setDto)
    },

    async get(workspaceId: string, key: string) {
      checkKey(key)
      const row = await db.assumptionSet.findUnique({ where: { workspaceId_key: { workspaceId, key } } })
      if (!row) throw notFound(`Assumption set "${key}"`)
      return setDto(row)
    },

    /** expectedRevision 0 creates the set; otherwise it must match the stored revision. */
    async save(workspaceId: string, actorId: string, key: string, expectedRevision: number, schemaVersion: number, rawPayload: unknown) {
      checkKey(key)
      const payload = validatePayload(schemas, key, schemaVersion, rawPayload, `Assumption set "${key}"`) as Prisma.InputJsonValue
      return db.$transaction(async (tx) => {
        let set: AssumptionSetDto
        if (expectedRevision === 0) {
          try {
            set = setDto(await tx.assumptionSet.create({ data: { workspaceId, key, schemaVersion, payload } }))
          } catch (err) {
            if (isUniqueViolation(err)) throw new ApiError(409, 'conflict', `Assumption set "${key}" was created by someone else a moment ago.`)
            throw err
          }
        } else {
          set = await writeAtRevision({
            what: `Assumption set "${key}"`,
            expectedRevision,
            update: () =>
              tx.assumptionSet.updateMany({
                where: { workspaceId, key, revision: expectedRevision },
                data: { schemaVersion, payload, ...nextRevision },
              }),
            load: () => tx.assumptionSet.findUnique({ where: { workspaceId_key: { workspaceId, key } } }),
            present: setDto,
          })
        }
        const rev = await tx.assumptionRevision.create({
          data: { assumptionSetId: set.id, revision: set.revision, schemaVersion, payload, actorId },
        })
        return { set, revisionId: rev.id }
      })
    },

    async revision(workspaceId: string, key: string, revision: number) {
      const set = await this.get(workspaceId, key)
      const row = await db.assumptionRevision.findUnique({ where: { assumptionSetId_revision: { assumptionSetId: set.id, revision } } })
      if (!row) throw notFound(`Revision ${revision} of "${key}"`)
      return { id: row.id, key, revision: row.revision, schemaVersion: row.schemaVersion, payload: row.payload, actorId: row.actorId, createdAt: row.createdAt.toISOString() }
    },
  }
}
