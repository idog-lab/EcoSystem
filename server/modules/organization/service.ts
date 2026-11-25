import { createHash } from 'node:crypto'
import { isModelId } from '../../../src/platform/registry/catalog'
import { checkFolderName } from '../../../src/platform/organization/folderName'
import { isUniqueViolation, type Db } from '../../db/prisma'
import { ApiError } from '../../http/errors'
import { nextRevision, writeAtRevision } from '../../lib/revisions'

// Shared folders and where each model sits. Runtime data of a workspace:
// never categories in code, never fields of the registry.

export type FolderDto = { id: string; name: string; revision: number }
/** A model with no placement row is Unfiled at revision 0. */
export type PlacementDto = { modelId: string; folderId: string | null; revision: number }
export type OrganizationDto = { folders: FolderDto[]; placements: PlacementDto[] }

const folderDto = (f: { id: string; name: string; revision: number }): FolderDto => ({ id: f.id, name: f.name, revision: f.revision })
const placementDto = (p: { modelId: string; folderId: string | null; revision: number }): PlacementDto => ({
  modelId: p.modelId,
  folderId: p.folderId,
  revision: p.revision,
})

function duplicateName(name: string) {
  return new ApiError(409, 'duplicate_name', `There is already a folder called "${name}" (names are compared without case).`)
}

export async function getOrganization(db: Db, workspaceId: string): Promise<OrganizationDto> {
  const [folders, placements] = await Promise.all([
    db.folder.findMany({ where: { workspaceId }, orderBy: [{ nameKey: 'asc' }, { id: 'asc' }] }),
    db.modelPlacement.findMany({ where: { workspaceId }, orderBy: { modelId: 'asc' } }),
  ])
  // Placements of models no longer in the catalog stay stored but are not shown.
  return { folders: folders.map(folderDto), placements: placements.filter((p) => isModelId(p.modelId)).map(placementDto) }
}

/** A cheap fingerprint clients poll with (If-None-Match). */
export function organizationTag(org: OrganizationDto): string {
  return `"${createHash('sha1').update(JSON.stringify(org)).digest('base64url')}"`
}

export async function createFolder(db: Db, workspaceId: string, rawName: unknown): Promise<FolderDto> {
  const check = checkFolderName(rawName)
  if (!check.ok) throw new ApiError(400, 'validation', check.message)
  try {
    const folder = await db.folder.create({ data: { workspaceId, name: check.name, nameKey: check.nameKey } })
    return folderDto(folder)
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicateName(check.name)
    throw err
  }
}

export async function renameFolder(
  db: Db,
  workspaceId: string,
  folderId: string,
  rawName: unknown,
  expectedRevision: number,
): Promise<FolderDto> {
  const check = checkFolderName(rawName)
  if (!check.ok) throw new ApiError(400, 'validation', check.message)
  try {
    return await db.$transaction(async (tx) =>
      writeAtRevision({
        what: 'This folder',
        expectedRevision,
        update: () =>
          tx.folder.updateMany({
            where: { id: folderId, workspaceId, revision: expectedRevision },
            data: { name: check.name, nameKey: check.nameKey, ...nextRevision },
          }),
        load: () => tx.folder.findFirst({ where: { id: folderId, workspaceId } }),
        present: folderDto,
      }),
    )
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicateName(check.name)
    throw err
  }
}

/**
 * Puts a model in a folder (folderId) or back in Unfiled (null).
 * expectedRevision is the placement's revision as the client saw it; 0 means
 * "it had no placement yet" (Unfiled since the start).
 */
export async function placeModel(
  db: Db,
  workspaceId: string,
  modelId: string,
  folderId: string | null,
  expectedRevision: number,
): Promise<PlacementDto> {
  if (!isModelId(modelId)) throw new ApiError(404, 'unknown_model', `There is no model "${modelId}" in the catalog.`)
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new ApiError(400, 'validation', 'expectedRevision must be 0 or a positive whole number.')
  }

  return db.$transaction(async (tx) => {
    if (folderId !== null) {
      // The target must be a folder of THIS workspace (the database checks it
      // again with a trigger).
      const folder = await tx.folder.findFirst({ where: { id: folderId, workspaceId }, select: { id: true } })
      if (!folder) throw new ApiError(422, 'invalid_folder', 'That folder does not exist in this workspace.')
    }
    const load = () => tx.modelPlacement.findUnique({ where: { workspaceId_modelId: { workspaceId, modelId } } })

    if (expectedRevision === 0) {
      const existing = await load()
      if (existing) throw new ApiError(409, 'conflict', 'This model was moved by someone else a moment ago.', placementDto(existing))
      try {
        return placementDto(await tx.modelPlacement.create({ data: { workspaceId, modelId, folderId } }))
      } catch (err) {
        if (isUniqueViolation(err)) throw new ApiError(409, 'conflict', 'This model was moved by someone else a moment ago.')
        throw err
      }
    }

    // A model never placed reads as Unfiled at revision 0, so a client that
    // saw an older placement gets a conflict rather than a "not found".
    return writeAtRevision({
      what: 'This model\'s place',
      expectedRevision,
      update: () =>
        tx.modelPlacement.updateMany({ where: { workspaceId, modelId, revision: expectedRevision }, data: { folderId, ...nextRevision } }),
      load: async () => (await load()) ?? { modelId, folderId: null, revision: 0 },
      present: placementDto,
    })
  })
}
