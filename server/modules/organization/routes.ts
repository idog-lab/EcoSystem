import { Hono } from 'hono'
import { z } from 'zod'
import type { Db } from '../../db/prisma'
import { readBody } from '../../http/body'
import type { AppEnv } from '../workspaces/routes'
import { createFolder, getOrganization, organizationTag, placeModel, renameFolder } from './service'

// Mounted at /api/workspaces/:workspaceId (membership already checked).
//
// Clients learn about other members' changes by polling GET /organization
// with If-None-Match (a 304 costs almost nothing). See docs/architecture.md.

export function organizationRoutes(db: Db) {
  return new Hono<AppEnv>()
    .get('/organization', async (c) => {
      const org = await getOrganization(db, c.get('workspaceId'))
      const tag = organizationTag(org)
      c.header('ETag', tag)
      c.header('Cache-Control', 'no-cache')
      if (c.req.header('If-None-Match') === tag) return c.body(null, 304)
      return c.json(org)
    })
    .post('/folders', async (c) => {
      const { name } = await readBody(c, z.object({ name: z.string() }))
      return c.json({ folder: await createFolder(db, c.get('workspaceId'), name) }, 201)
    })
    .patch('/folders/:folderId', async (c) => {
      const body = await readBody(c, z.object({ name: z.string(), expectedRevision: z.number().int() }))
      const folder = await renameFolder(db, c.get('workspaceId'), c.req.param('folderId'), body.name, body.expectedRevision)
      return c.json({ folder })
    })
    .put('/placements/:modelId', async (c) => {
      const body = await readBody(c, z.object({ folderId: z.string().min(1).nullable(), expectedRevision: z.number().int() }))
      const placement = await placeModel(db, c.get('workspaceId'), c.req.param('modelId'), body.folderId, body.expectedRevision)
      return c.json({ placement })
    })
}
