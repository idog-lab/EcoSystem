import { z } from 'zod'

// Server configuration, read once from the environment. It FAILS CLOSED:
// - NODE_ENV defaults to "production" when unset;
// - the development sign-in bypass is refused (the server will not start)
//   unless NODE_ENV is "development" or "test";
// - production needs a real AUTH_SECRET and Google sign-in.
// Every variable is described in .env.example and docs/setup.md.

const DEV_SECRET = 'development-only-secret-do-not-use-in-production-0000'

const truthy = (v: string | undefined) => v === 'true' || v === '1'

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  AUTH_SECRET: z.string().optional(),
  AUTH_BASE_URL: z.string().url().optional(),
  PUBLIC_APP_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  AUTH_DEV_BYPASS: z.string().optional(),
})

export type ServerConfig = {
  env: 'development' | 'test' | 'production'
  port: number
  databaseUrl: string
  authSecret: string
  /** Public URL the auth routes are reached at (callbacks are built from it). */
  authBaseUrl: string
  /** Origins allowed to send state-changing requests. */
  trustedOrigins: string[]
  google: { clientId: string; clientSecret: string } | null
  /** Development sign-in by email, no password. Never true in production. */
  devBypass: boolean
}

export class ConfigError extends Error {}

export function loadConfig(source: Record<string, string | undefined> = process.env): ServerConfig {
  const parsed = Env.safeParse(source)
  if (!parsed.success) {
    throw new ConfigError(`Invalid server configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  }
  const e = parsed.data
  const isDevLike = e.NODE_ENV === 'development' || e.NODE_ENV === 'test'
  const devBypass = truthy(e.AUTH_DEV_BYPASS)

  if (devBypass && !isDevLike) {
    throw new ConfigError('AUTH_DEV_BYPASS is only allowed when NODE_ENV is "development" or "test". Refusing to start.')
  }

  let authSecret = e.AUTH_SECRET ?? ''
  if (!authSecret) {
    if (!isDevLike) throw new ConfigError('AUTH_SECRET is required in production.')
    authSecret = DEV_SECRET
  } else if (!isDevLike && (authSecret.length < 32 || authSecret === DEV_SECRET)) {
    throw new ConfigError('AUTH_SECRET must be a random value of at least 32 characters in production.')
  }

  const google =
    e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET ? { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET } : null
  if (!isDevLike && !google) {
    throw new ConfigError('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required in production (there is no other way to sign in).')
  }

  const appUrl = e.PUBLIC_APP_URL ?? 'http://localhost:5173'
  if (!isDevLike && !e.PUBLIC_APP_URL) throw new ConfigError('PUBLIC_APP_URL is required in production.')
  const authBaseUrl = e.AUTH_BASE_URL ?? appUrl

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    authSecret,
    authBaseUrl,
    trustedOrigins: [...new Set([new URL(appUrl).origin, new URL(authBaseUrl).origin])],
    google,
    devBypass,
  }
}
