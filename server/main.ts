import { serve } from '@hono/node-server'
import { createApp } from './app'
import { ConfigError, loadConfig } from './config'
import { createPrisma } from './db/prisma'

// Starts the API: npm run server (development) / npm run server:start.
let config
try {
  config = loadConfig()
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err)
  process.exit(1)
}

if (config.devBypass) console.warn('[server] Development sign-in is ON (AUTH_DEV_BYPASS). Never use this in production.')

const db = createPrisma(config.databaseUrl)
const app = createApp({ db, config })

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[server] API listening on http://localhost:${info.port}/api (${config.env})`)
})
