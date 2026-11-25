import { defineConfig } from 'prisma/config'

// Prisma 7 does not read .env itself: export DATABASE_URL in the shell (see
// .env.example and docs/setup.md). Generating the client needs no database,
// so `npm install` works without it; migrate commands fail clearly instead.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://DATABASE_URL-is-not-set@localhost/unset' },
})
