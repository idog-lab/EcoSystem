# Setting up the toolkit platform

The app is two parts:

- **The site** (Vite + React): `npm run dev`, port 5173, at `/EcoSystem/`.
- **The toolkit server** (Hono + Prisma + PostgreSQL, TypeScript): `npm run server`,
  port 8787. The site reaches it at `/api` (Vite proxies it in development).

The site still works without the server: the catalog, search and every tool open,
but there are no shared folders (the sidebar says so). That is also what the
GitHub Pages deploy is today: **it hosts the site only, not the server.**

## First time

Needs Node 22 and PostgreSQL 16 (or newer).

```bash
npm install            # also generates the Prisma client
cp .env.example .env   # then fill it in; export the values in your shell
```

```bash
createdb eco_dev       # or any database DATABASE_URL points at
```

```bash
npm run db:migrate     # applies prisma/migrations
```

Add the people of a workspace (creates the workspace the first time):

```bash
npm run db:add-member -- --workspace superplay --name "SuperPlay" --email you@superplay.co --email coworker@superplay.co
```

Signing in only says who someone is. A person who signs in but is not a member
of a workspace sees no folders.

## Every day

```bash
npm run server   # NODE_ENV=development, restarts on change
```

```bash
npm run dev      # the site; /api goes to the server
```

**Sign-in in development.** Either set up Google (below), or set
`AUTH_DEV_BYPASS=true`: the sidebar then offers "Development sign-in" by email,
no password, for emails that are workspace members. The server refuses to
start with it unless `NODE_ENV` is `development` or `test`, and `NODE_ENV`
unset counts as production.

**Google sign-in.** Create an OAuth client (type "Web application") in the
Google Cloud console, add `<AUTH_BASE_URL>/api/auth/callback/google` as an
authorized redirect URI, and set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
Not tried end to end yet: no Google client was available while this was built
(the tests check that sign-in starts at Google with the right client).

## Production (not set up yet)

Required, or the server will not start: `NODE_ENV=production`, `DATABASE_URL`,
`AUTH_SECRET` (32+ random characters), `PUBLIC_APP_URL`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`. Run `npm run db:deploy` then `npm run server:start`.
Serve the site and `/api` from one origin (a reverse proxy): sessions are
cookies, and other origins' writes are refused. Where to host it is not
decided.

## Checks

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test                  # unit + server tests; needs PostgreSQL (TEST_DATABASE_ADMIN_URL)
```

```bash
npm run test:e2e:platform # the home page in a real browser, two members at once
```

```bash
npm run build
```

`npm test` and `test:e2e:platform` create a throw-away database per run from
`TEST_DATABASE_ADMIN_URL` (a role allowed to create databases) and drop it
after. They never touch `DATABASE_URL`. The older browser suites (`npm run e2e`)
still run against `npm run dev` and need Playwright installed.
