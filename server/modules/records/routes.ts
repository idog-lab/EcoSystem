import { Hono } from 'hono'
import { z } from 'zod'
import { readBody } from '../../http/body'
import type { AppEnv } from '../workspaces/routes'
import { RESULT_METRICS, type createRecordService } from './service'

const Iso = z.string().refine((s) => Number.isFinite(Date.parse(s)), 'a date and time')
const ExportBody = z.object({
  revision: z.number().int().positive(),
  kind: z.enum(['google-sheets', 'text-copy']),
  target: z.record(z.string(), z.unknown()),
  engineVersion: z.string().min(1),
  fingerprint: z.string().min(1),
  snapshot: z.unknown(),
})
const LiveRunBody = z.object({
  eventId: z.string().trim().min(1).max(200),
  revision: z.number().int().positive().nullable(),
  effectiveFrom: Iso,
  note: z.string().max(500).default(''),
})
const ResultRow = z.object({
  eventId: z.string().trim().min(1).max(200),
  segment: z.number().int().min(1).max(20).nullable(),
  metric: z.enum(RESULT_METRICS),
  value: z.number().finite().nullable(),
  sampleSize: z.number().int().min(0).nullable(),
  population: z.string().min(1).max(200),
  windowStart: Iso,
  windowEnd: Iso,
  source: z.string().min(1).max(500),
  refreshedAt: Iso,
})

// Mounted at /api/workspaces/:workspaceId/documents/:documentId (membership checked).
export function recordRoutes(service: ReturnType<typeof createRecordService>) {
  return new Hono<AppEnv>()
    .get('/exports', async (c) => c.json({ exports: await service.listExports(c.get('workspaceId'), c.req.param('documentId')!) }))
    .get('/exports/:exportId', async (c) => c.json({ export: await service.getExport(c.get('workspaceId'), c.req.param('documentId')!, c.req.param('exportId')) }))
    .post('/exports', async (c) => {
      const body = await readBody(c, ExportBody)
      return c.json({ export: await service.addExport(c.get('workspaceId'), c.get('identity').userId, c.req.param('documentId')!, body) }, 201)
    })
    .get('/live-runs', async (c) => c.json({ liveRuns: await service.listLiveRuns(c.get('workspaceId'), c.req.param('documentId')!) }))
    .post('/live-runs', async (c) => {
      const body = await readBody(c, LiveRunBody)
      return c.json({ liveRun: await service.addLiveRun(c.get('workspaceId'), c.get('identity').userId, c.req.param('documentId')!, body) }, 201)
    })
    .get('/results', async (c) => c.json({ results: await service.listResults(c.get('workspaceId'), c.req.param('documentId')!) }))
    .post('/results', async (c) => {
      const body = await readBody(c, z.object({ rows: z.array(ResultRow).min(1).max(5000) }))
      return c.json(await service.addResults(c.get('workspaceId'), c.get('identity').userId, c.req.param('documentId')!, body.rows), 201)
    })
}
