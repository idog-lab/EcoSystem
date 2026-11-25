import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app'
import { DEV_IDENTITY_COOKIE } from '../../server/auth/identity'
import { createTestDatabase, type TestDatabase } from '../helpers/db'
import { seedWorkspaces, testApp, testConfig } from '../helpers/app'

let t: TestDatabase
let ws: Awaited<ReturnType<typeof seedWorkspaces>>
let api: ReturnType<typeof testApp>

beforeAll(async () => {
  t = await createTestDatabase()
  ws = await seedWorkspaces(t.db)
  api = testApp(t.db)
})
afterAll(async () => t?.drop())

describe('who can do what', () => {
  it('nobody signed in: 401 everywhere but health and the sign-in options', async () => {
    const anon = api.as(null)
    expect((await anon.get('/health')).status).toBe(200)
    expect((await anon.get('/session-options')).body).toEqual({ google: false, devBypass: true })
    expect((await anon.get('/me')).status).toBe(401)
    expect((await anon.get('/session')).body).toEqual({ options: { google: false, devBypass: true }, user: null, workspaces: [] })
    expect((await anon.get(`/workspaces/${ws.a.id}/organization`)).status).toBe(401)
    expect((await anon.post(`/workspaces/${ws.a.id}/folders`, { name: 'x' })).status).toBe(401)
  })

  it('a signed-in person sees only the workspaces they belong to', async () => {
    const me = await api.as('ana@a.test').get('/me')
    expect(me.body.workspaces.map((w: { slug: string }) => w.slug)).toEqual(['studio-a'])
    const none = await api.as('nobody@x.test').get('/me')
    expect(none.body.workspaces).toEqual([])
    const session = await api.as('ana@a.test').get('/session')
    expect(session.body.user.email).toBe('ana@a.test')
    expect(session.body.workspaces.map((w: { slug: string }) => w.slug)).toEqual(['studio-a'])
  })

  it('a non-member cannot read or write another workspace', async () => {
    for (const who of ['cleo@b.test', 'nobody@x.test']) {
      const as = api.as(who)
      expect((await as.get(`/workspaces/${ws.a.id}/organization`)).status).toBe(403)
      expect((await as.post(`/workspaces/${ws.a.id}/folders`, { name: 'Intrusion' })).status).toBe(403)
      expect((await as.put(`/workspaces/${ws.a.id}/placements/chef`, { folderId: null, expectedRevision: 0 })).status).toBe(403)
      expect((await as.get(`/workspaces/${ws.a.id}/documents`)).status).toBe(403)
      expect((await as.get(`/workspaces/${ws.a.id}/assumptions`)).status).toBe(403)
    }
    expect(await t.db.folder.count()).toBe(0)
  })

  it('an unknown person in the development cookie is nobody', async () => {
    expect((await api.as('stranger@x.test').get('/me')).status).toBe(401)
  })

  it('writes must be JSON and come from a trusted origin', async () => {
    const res = await api.app.request(`/api/workspaces/${ws.a.id}/folders`, {
      method: 'POST',
      headers: { Cookie: `${DEV_IDENTITY_COOKIE}=ana@a.test`, 'Content-Type': 'text/plain' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(res.status).toBe(415)
    const foreign = await api.as('ana@a.test').post(`/workspaces/${ws.a.id}/folders`, { name: 'x' }, { Origin: 'https://evil.example' })
    expect(foreign.status).toBe(403)
    expect(foreign.body.error.code).toBe('bad_origin')
    expect(await t.db.folder.count()).toBe(0)
  })

  it('with the development sign-in off, its routes do not exist and its cookie means nothing', async () => {
    const app = createApp({ db: t.db, config: testConfig({ AUTH_DEV_BYPASS: 'false' }) })
    const signIn = await app.request('/api/dev/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ana@a.test' }),
    })
    expect(signIn.status).toBe(404)
    const me = await app.request('/api/me', { headers: { Cookie: `${DEV_IDENTITY_COOKIE}=ana@a.test` } })
    expect(me.status).toBe(401)
  })

  it('Google sign-in, when configured, starts at Google (the callback itself is not exercised here)', async () => {
    const config = testConfig({ AUTH_DEV_BYPASS: 'false', GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' })
    const app = createApp({ db: t.db, config })
    expect(await (await app.request('/api/session-options')).json()).toEqual({ google: true, devBypass: false })
    const res = await app.request('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ provider: 'google', callbackURL: 'http://localhost:5173/EcoSystem/' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url: string }
    expect(new URL(body.url).host).toBe('accounts.google.com')
    expect(new URL(body.url).searchParams.get('client_id')).toBe('test-client')
  })
})
