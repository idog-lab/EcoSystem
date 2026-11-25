import { createApp, type AppDeps } from '../../server/app'
import { loadConfig } from '../../server/config'
import { DEV_IDENTITY_COOKIE } from '../../server/auth/identity'
import type { Db } from '../../server/db/prisma'

export const testConfig = (overrides: Record<string, string> = {}) =>
  loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://unused', AUTH_DEV_BYPASS: 'true', ...overrides })

export function testApp(db: Db, deps: Partial<AppDeps> = {}) {
  const app = createApp({ db, config: testConfig(), ...deps })

  /** Requests made as one person (the development sign-in cookie). */
  const as = (email: string | null) => {
    const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const res = await app.request(`/api${path}`, {
        method,
        headers: {
          ...(email ? { Cookie: `${DEV_IDENTITY_COOKIE}=${email}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      const text = await res.text()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { status: res.status, headers: res.headers, body: (text ? JSON.parse(text) : null) as any }
    }
    return {
      get: (p: string, h?: Record<string, string>) => call('GET', p, undefined, h),
      post: (p: string, b: unknown, h?: Record<string, string>) => call('POST', p, b, h),
      put: (p: string, b: unknown) => call('PUT', p, b),
      patch: (p: string, b: unknown) => call('PATCH', p, b),
    }
  }
  return { app, as }
}

/** Two workspaces with their members, for authorization checks. */
export async function seedWorkspaces(db: Db) {
  const mk = async (slug: string, emails: string[]) => {
    const ws = await db.workspace.create({ data: { slug, name: slug } })
    for (const email of emails) {
      const user = await db.user.upsert({ where: { email }, update: {}, create: { email, name: email.split('@')[0]! } })
      await db.membership.create({ data: { workspaceId: ws.id, userId: user.id } })
    }
    return ws
  }
  const a = await mk('studio-a', ['ana@a.test', 'ben@a.test'])
  const b = await mk('studio-b', ['cleo@b.test'])
  await db.user.create({ data: { email: 'nobody@x.test', name: 'nobody' } })
  return { a, b }
}
