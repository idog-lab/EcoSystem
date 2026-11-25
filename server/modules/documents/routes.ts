import { Hono } from 'hono'
import { z } from 'zod'
import { readBody } from '../../http/body'
import type { AppEnv } from '../workspaces/routes'
import type { createDocumentService } from './service'

const Title = z.string().trim().min(1, 'A document needs a title.').max(120)
const Input = z.object({ title: Title, schemaVersion: z.number().int().positive(), payload: z.unknown() })

// Mounted at /api/workspaces/:workspaceId/documents (membership checked).
// A client keeps an open document current by polling GET /:id with
// If-None-Match set to the revision it holds (304 when nothing changed).
export function documentRoutes(service: ReturnType<typeof createDocumentService>) {
  return new Hono<AppEnv>()
    .get('/', async (c) => c.json({ documents: await service.list(c.get('workspaceId'), c.req.query('modelId')) }))
    .post('/', async (c) => {
      const body = await readBody(c, Input.extend({ modelId: z.string().min(1) }))
      const doc = await service.create(c.get('workspaceId'), c.get('identity').userId, body.modelId, body)
      return c.json({ document: doc }, 201)
    })
    .get('/:documentId', async (c) => {
      const doc = await service.get(c.get('workspaceId'), c.req.param('documentId'))
      const tag = `"r${doc.revision}"`
      c.header('ETag', tag)
      c.header('Cache-Control', 'no-cache')
      if (c.req.header('If-None-Match') === tag) return c.body(null, 304)
      return c.json({ document: doc })
    })
    .put('/:documentId', async (c) => {
      const body = await readBody(c, Input.extend({ expectedRevision: z.number().int() }))
      const doc = await service.save(c.get('workspaceId'), c.get('identity').userId, c.req.param('documentId'), body.expectedRevision, body)
      return c.json({ document: doc })
    })
    .get('/:documentId/revisions', async (c) =>
      c.json({ revisions: await service.revisions(c.get('workspaceId'), c.req.param('documentId')) }),
    )
    .get('/:documentId/revisions/:revision', async (c) => {
      const revision = z.coerce.number().int().positive().parse(c.req.param('revision'))
      return c.json({ revision: await service.revision(c.get('workspaceId'), c.req.param('documentId'), revision) })
    })
}
