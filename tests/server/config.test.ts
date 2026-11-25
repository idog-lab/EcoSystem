import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../../server/config'

const prod = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://x',
  AUTH_SECRET: 'a'.repeat(40),
  PUBLIC_APP_URL: 'https://toolkit.example.com',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
}

describe('configuration fails closed', () => {
  it('a complete production configuration starts, without the development sign-in', () => {
    const c = loadConfig(prod)
    expect(c.devBypass).toBe(false)
    expect(c.trustedOrigins).toEqual(['https://toolkit.example.com'])
  })

  it('refuses the development sign-in in production', () => {
    expect(() => loadConfig({ ...prod, AUTH_DEV_BYPASS: 'true' })).toThrow(ConfigError)
  })

  it('treats a missing NODE_ENV as production', () => {
    const { NODE_ENV: _drop, ...rest } = prod
    expect(loadConfig(rest).env).toBe('production')
    expect(() => loadConfig({ ...rest, AUTH_DEV_BYPASS: '1' })).toThrow(/only allowed/)
  })

  it('refuses production without a strong secret, Google sign-in or the app URL', () => {
    expect(() => loadConfig({ ...prod, AUTH_SECRET: undefined })).toThrow(/AUTH_SECRET/)
    expect(() => loadConfig({ ...prod, AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/)
    expect(() => loadConfig({ ...prod, GOOGLE_CLIENT_ID: undefined })).toThrow(/GOOGLE/)
    expect(() => loadConfig({ ...prod, PUBLIC_APP_URL: undefined })).toThrow(/PUBLIC_APP_URL/)
  })

  it('development may use the bypass and a built-in secret', () => {
    const c = loadConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://x', AUTH_DEV_BYPASS: 'true' })
    expect(c.devBypass).toBe(true)
    expect(c.google).toBeNull()
  })
})
