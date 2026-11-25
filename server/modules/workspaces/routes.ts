import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import type { ServerConfig } from '../../config'
import type { Db } from '../../db/prisma'
import { readBody } from '../../http/body'
import { ApiError } from '../../http/errors'
import { DEV_IDENTITY_COOKIE, type Identity, type IdentityResolver } from '../../auth/identity'

export type AppEnv = { Variables: { identity: Identity; workspaceId: string } }

/** Every route after this needs a signed-in person. */
export const requireIdentity = (resolve: IdentityResolver) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const identity = await resolve(c)
    if (!identity) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.')
    c.set('identity', identity)
    await next()
  })

/** /api/workspaces/:workspaceId/... - only members of that workspace get through. */
export const requireMembership = (db: Db) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const workspaceId = c.req.param('workspaceId')
    if (!workspaceId) throw new ApiError(404, 'not_found', 'Workspace was not found.')
    const membership = await db.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: c.get('identity').userId } },
    })
    if (!membership) throw new ApiError(403, 'forbidden', 'You are not a member of this workspace.')
    c.set('workspaceId', workspaceId)
    await next()
  })

export async function workspacesOf(db: Db, userId: string) {
  const memberships = await db.membership.findMany({ where: { userId }, include: { workspace: true }, orderBy: { createdAt: 'asc' } })
  return memberships.map((m) => ({ id: m.workspace.id, slug: m.workspace.slug, name: m.workspace.name }))
}

export function meRoutes(db: Db) {
  return new Hono<AppEnv>().get('/', async (c) => {
    const identity = c.get('identity')
    return c.json({ user: identity, workspaces: await workspacesOf(db, identity.userId) })
  })
}

/**
 * GET /api/session: what the home page needs on load, signed in or not
 * (200 either way, so a signed-out visit logs no error): how one can sign in,
 * and who is signed in with their workspaces.
 */
export function sessionRoute(db: Db, config: ServerConfig, resolve: IdentityResolver) {
  return new Hono().get('/', async (c) => {
    const options = { google: config.google !== null, devBypass: config.devBypass }
    const identity = await resolve(c)
    if (!identity) return c.json({ options, user: null, workspaces: [] })
    return c.json({ options, user: identity, workspaces: await workspacesOf(db, identity.userId) })
  })
}

/** Development sign-in by email. Mounted only when config.devBypass is on. */
export function devSignInRoutes(db: Db, config: ServerConfig) {
  if (!config.devBypass || config.env === 'production') throw new Error('Development sign-in must never be mounted in production.')
  return new Hono()
    .post('/sign-in', async (c) => {
      const { email } = await readBody(c, z.object({ email: z.string().trim().toLowerCase().email() }))
      const user = await db.user.upsert({
        where: { email },
        update: {},
        create: { email, name: email.split('@')[0] ?? email, emailVerified: false },
      })
      setCookie(c, DEV_IDENTITY_COOKIE, user.email, { httpOnly: true, sameSite: 'Lax', path: '/' })
      return c.json({ user: { userId: user.id, email: user.email, name: user.name } })
    })
    .post('/sign-out', (c) => {
      deleteCookie(c, DEV_IDENTITY_COOKIE, { path: '/' })
      return c.json({ ok: true })
    })
}
