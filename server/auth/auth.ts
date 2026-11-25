import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import type { ServerConfig } from '../config'
import type { Db } from '../db/prisma'

// Sign-in is better-auth (maintained, open source) with Google as the only
// provider; sessions live in the database (Session table). Signing in gives
// an identity only: what a person can see is decided by Membership.

export function createAuth(db: Db, config: ServerConfig) {
  return betterAuth({
    database: prismaAdapter(db, { provider: 'postgresql' }),
    secret: config.authSecret,
    baseURL: config.authBaseUrl,
    basePath: '/api/auth',
    trustedOrigins: config.trustedOrigins,
    emailAndPassword: { enabled: false },
    socialProviders: config.google
      ? { google: { clientId: config.google.clientId, clientSecret: config.google.clientSecret, prompt: 'select_account' } }
      : {},
    advanced: { useSecureCookies: config.env === 'production' },
  })
}

export type Auth = ReturnType<typeof createAuth>
