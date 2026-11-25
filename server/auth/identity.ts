import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import type { ServerConfig } from '../config'
import type { Db } from '../db/prisma'
import type { Auth } from './auth'

export type Identity = { userId: string; email: string; name: string }

/** Cookie of the development sign-in (see config.devBypass). */
export const DEV_IDENTITY_COOKIE = 'eco_dev_user'

export type IdentityResolver = (c: Context) => Promise<Identity | null>

/**
 * Who is calling: the better-auth session first; then, ONLY when the
 * development bypass is on (never in production - loadConfig refuses it),
 * the email in the development sign-in cookie.
 */
export function createIdentityResolver(db: Db, auth: Auth, config: ServerConfig): IdentityResolver {
  return async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (session?.user) return { userId: session.user.id, email: session.user.email, name: session.user.name }

    if (config.devBypass && config.env !== 'production') {
      const email = getCookie(c, DEV_IDENTITY_COOKIE)
      if (email) {
        const user = await db.user.findUnique({ where: { email } })
        if (user) return { userId: user.id, email: user.email, name: user.name }
      }
    }
    return null
  }
}
