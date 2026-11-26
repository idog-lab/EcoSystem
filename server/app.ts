import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { ServerConfig } from './config'
import type { Db } from './db/prisma'
import { createAuth, type Auth } from './auth/auth'
import { createIdentityResolver, type IdentityResolver } from './auth/identity'
import { ApiError, errorResponse } from './http/errors'
import { devSignInRoutes, meRoutes, requireIdentity, requireMembership, sessionRoute, type AppEnv } from './modules/workspaces/routes'
import { organizationRoutes } from './modules/organization/routes'
import { createDocumentService } from './modules/documents/service'
import { documentRoutes } from './modules/documents/routes'
import { createRecordService } from './modules/records/service'
import { recordRoutes } from './modules/records/routes'
import { DOCUMENT_SCHEMAS, type PayloadSchemaRegistry } from './modules/documents/schemas'
import { createAssumptionService } from './modules/assumptions/service'
import { assumptionRoutes } from './modules/assumptions/routes'
import { ASSUMPTION_SCHEMAS } from './modules/assumptions/schemas'

// The API of the modular monolith: one Hono app, one module per area
// (workspaces, organization, documents, assumptions), all under /api.
// Everything except sign-in, /api/session and /api/session-options needs a signed-in
// member of the workspace in the URL - checked here, on the server.

export type AppDeps = {
  db: Db
  config: ServerConfig
  auth?: Auth
  documentSchemas?: PayloadSchemaRegistry
  assumptionSchemas?: PayloadSchemaRegistry
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * State-changing requests must be JSON and, when a browser says where they
 * come from, come from a trusted origin. With SameSite=Lax cookies this keeps
 * other sites from acting on a member's behalf.
 */
const sameOriginJson = (config: ServerConfig) =>
  createMiddleware(async (c, next) => {
    if (MUTATING.has(c.req.method)) {
      const origin = c.req.header('Origin')
      if (origin && !config.trustedOrigins.includes(origin)) throw new ApiError(403, 'bad_origin', 'Requests from this origin are not accepted.')
      if (!(c.req.header('Content-Type') ?? '').startsWith('application/json')) {
        throw new ApiError(415, 'unsupported_media_type', 'Send JSON (Content-Type: application/json).')
      }
    }
    await next()
  })

export function createApp({ db, config, auth = createAuth(db, config), documentSchemas = DOCUMENT_SCHEMAS, assumptionSchemas = ASSUMPTION_SCHEMAS }: AppDeps) {
  const resolveIdentity: IdentityResolver = createIdentityResolver(db, auth, config)
  const documents = createDocumentService(db, documentSchemas)
  const assumptions = createAssumptionService(db, assumptionSchemas)
  const records = createRecordService(db)

  const app = new Hono<AppEnv>().basePath('/api')
  app.onError(errorResponse)
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'No such API route.' } }, 404))

  app.get('/health', (c) => c.json({ ok: true }))
  // Sign-in (better-auth: /api/auth/sign-in/social, /api/auth/callback/google, ...).
  app.on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw))
  // What the sign-in screen can offer. Public: it reveals nothing about data.
  app.get('/session-options', (c) => c.json({ google: config.google !== null, devBypass: config.devBypass }))
  app.route('/session', sessionRoute(db, config, resolveIdentity))

  app.use('*', sameOriginJson(config))
  if (config.devBypass) app.route('/dev', devSignInRoutes(db, config))

  app.use('/me', requireIdentity(resolveIdentity))
  app.use('/me/*', requireIdentity(resolveIdentity))
  app.route('/me', meRoutes(db))

  app.use('/workspaces/:workspaceId/*', requireIdentity(resolveIdentity), requireMembership(db))
  app.route('/workspaces/:workspaceId', organizationRoutes(db))
  app.route('/workspaces/:workspaceId/documents/:documentId', recordRoutes(records))
  app.route('/workspaces/:workspaceId/documents', documentRoutes(documents))
  app.route('/workspaces/:workspaceId/assumptions', assumptionRoutes(assumptions))

  return app
}
