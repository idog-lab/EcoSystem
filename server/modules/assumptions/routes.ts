import { Hono } from 'hono'
import { z } from 'zod'
import { readBody } from '../../http/body'
import type { AppEnv } from '../workspaces/routes'
import type { createAssumptionService } from './service'

// Mounted at /api/workspaces/:workspaceId/assumptions (membership checked).
export function assumptionRoutes(service: ReturnType<typeof createAssumptionService>) {
  return new Hono<AppEnv>()
    .get('/', async (c) => c.json({ assumptionSets: await service.list(c.get('workspaceId')) }))
    .get('/:key', async (c) => {
      const set = await service.get(c.get('workspaceId'), c.req.param('key'))
      const tag = `"r${set.revision}"`
      c.header('ETag', tag)
      c.header('Cache-Control', 'no-cache')
      if (c.req.header('If-None-Match') === tag) return c.body(null, 304)
      return c.json({ assumptionSet: set })
    })
    .put('/:key', async (c) => {
      const body = await readBody(c, z.object({ expectedRevision: z.number().int().min(0), schemaVersion: z.number().int().positive(), payload: z.unknown() }))
      const result = await service.save(c.get('workspaceId'), c.get('identity').userId, c.req.param('key'), body.expectedRevision, body.schemaVersion, body.payload)
      return c.json({ assumptionSet: result.set, revisionId: result.revisionId }, body.expectedRevision === 0 ? 201 : 200)
    })
    .get('/:key/revisions/:revision', async (c) => {
      const revision = z.coerce.number().int().positive().parse(c.req.param('revision'))
      return c.json({ revision: await service.revision(c.get('workspaceId'), c.req.param('key'), revision) })
    })
}
