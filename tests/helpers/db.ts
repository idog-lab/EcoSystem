import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { createPrisma, type Db } from '../../server/db/prisma'

// An isolated database per test file: created from the migrations, dropped
// afterwards. Needs a PostgreSQL role that can create databases:
//   TEST_DATABASE_ADMIN_URL (default postgresql://eco:eco@localhost:5432/postgres)

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://eco:eco@localhost:5432/postgres'
const MIGRATIONS = join(import.meta.dirname, '../../prisma/migrations')

export type TestDatabase = { url: string; db: Db; drop: () => Promise<void> }

export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `eco_test_${randomBytes(6).toString('hex')}`
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  try {
    await admin.connect()
  } catch (err) {
    throw new Error(`Cannot reach PostgreSQL at TEST_DATABASE_ADMIN_URL (${ADMIN_URL.replace(/:[^:@/]+@/, ':***@')}): ${(err as Error).message}. See docs/setup.md.`)
  }
  await admin.query(`CREATE DATABASE ${name}`)
  await admin.end()

  const url = new URL(ADMIN_URL)
  url.pathname = `/${name}`
  const migrate = new pg.Client({ connectionString: url.toString() })
  await migrate.connect()
  for (const dir of readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    await migrate.query(readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8'))
  }
  await migrate.end()

  const db = createPrisma(url.toString())
  return {
    url: url.toString(),
    db,
    drop: async () => {
      await db.$disconnect()
      const a = new pg.Client({ connectionString: ADMIN_URL })
      await a.connect()
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      await a.end()
    },
  }
}
