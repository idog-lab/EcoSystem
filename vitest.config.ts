import { defineConfig } from 'vitest/config'

// Unit and server tests (npm test). Server tests need PostgreSQL: each test
// file gets its own throw-away database (tests/helpers/db.ts).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
