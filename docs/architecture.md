# Platform architecture

A modular monolith: one site, one server, one database; inside each, code is
grouped by area, and each model is a module of its own.

```
src/platform/            the platform (TypeScript)
  registry/              catalog.ts (THE model list), types.ts, modules.ts (lazy page modules)
  catalog/               the home page: search, folders, cards, Move to folder, drag and drop
  organization/          folder-name rules (shared with the server), useOrganization (polling)
  api/                   API client, session
  routing/               routes (pure), router (history API), Link
  shell/                 PlatformApp (which screen), ModelRoute, simple pages
src/models/              page modules owned by the platform (Merge Mania's wrapper, "not migrated")
src/features/            the existing tools, unchanged (Merge, Chef, Diamond Mine, Economy)
server/                  the API (TypeScript, Hono)
  config.ts              environment, fails closed
  auth/                  better-auth (Google), the identity of a request
  modules/workspaces/    who you are, membership checks, development sign-in
  modules/organization/  folders and placements
  modules/documents/     model documents + their payload schemas
  modules/assumptions/   shared assumption sets + their schemas
  lib/revisions.ts       the one optimistic-concurrency primitive
prisma/                  schema and migrations (PostgreSQL)
tests/                   Vitest: pure logic and the server on a real database
scripts/e2e-platform/    the home page in a browser
```

The layers are kept apart: UI (React components) → API client → server routes
→ services (validation, rules, transactions) → Prisma. Pure logic (search, URL
state, routes, folder names, the registry) imports nothing from React or the
browser, so it is shared by both sides and tested without a browser.

## The catalog

`src/platform/registry/catalog.ts` is the only list of models: stable `id`
(stored in the database), stable `slug` (the URL), `displayName`, `iconKey`,
`moduleKey`, `status`, workbook `sources`. The home page, its navigation, the
`/models/<slug>` routes and the server's checks are generated from it. To add
a model: one entry there and one loader in `modules.ts`. The home page is not
edited.

`/models/<slug>` loads that model's module only when opened. Each model owns
its page, layout and workflow; the platform passes `{ model, onHome }` and
nothing else; there is no shared form. A model listed but not built shows
"Model not migrated yet" and nothing else (no invented inputs or results).
Merge Mania's shared links (`?s=`, `?play`, `?plan`) open as before.

## Folders

Shared runtime data of a workspace, never categories in code: `Folder`
(flat, name unique without case per workspace) and `ModelPlacement` (at most
one per model and workspace; none or `folderId` null = Unfiled). Moving a model
changes only its placement, never its URL, module or documents. The target
folder must belong to the same workspace: the service checks it, and a
database trigger checks it again.

## Collaboration

Every signed-in **member** of a workspace can read and edit everything in it;
there are no private documents and no roles. Membership is checked on the
server for every `/api/workspaces/:id/...` request (403 otherwise). The
database is the authority, not the browser.

**Optimistic concurrency.** Folders, placements, documents and assumption
sets carry an integer `revision`. A write sends `expectedRevision`; the
UPDATE only applies `WHERE revision = expectedRevision` and moves it on by one,
inside a transaction (`server/lib/revisions.ts`). Otherwise nothing is written
and the answer is 409 with the current record, so the client can show it
without losing what the user typed (the rename form keeps the text; the next
save is a deliberate one). Two simultaneous writes from the same revision:
exactly one wins (tested).

**Seeing others' saves: polling.** Clients poll; there is no push channel.
- `GET /api/workspaces/:id/organization` with `If-None-Match` (ETag): 304
  when nothing changed. The home page polls every 5 s while the tab is
  visible, and on focus.
- `GET /api/workspaces/:id/documents/:docId` with `If-None-Match: "r<revision>"`.
Not character-level co-editing: shared documents with conflict handling.

**History.** Every document save writes an immutable `DocumentRevision`
(payload, actor, time); a trigger refuses UPDATE and DELETE on it.

**What happened afterwards** (`server/modules/records`, Puzzle first): an
export made from a revision (`DocumentExport`: the revision, the engine version,
a fingerprint and the cells sent), which revision ran live for which game event
and from when (`LiveRun`; a mid-event change is a new row, `revision` null ends
it), and results measured later (`ObservedResult`, joined to the live revisions
of its window when stored). All three are append-only (database triggers), and
an export or a live run must name a revision that exists.

## Documents and shared assumptions

`ModelDocument` (title, `schemaVersion`, JSON `payload`, `revision`) is a
model's saved work. The server validates the payload with that model's schema
(`server/modules/documents/schemas.ts`). **That registry is empty on purpose:**
no model's data has been migrated yet. The existing tools still keep their work
in the browser (localStorage), as before. A schema is added when a model is
migrated, from its real data; until then the API refuses its documents
(`no_schema`). Tests use their own made-up schema.

`AssumptionSet` + immutable `AssumptionRevision`: shared values several
models may read, versioned with the same primitive. A future saved run will
store the `AssumptionRevision` id it used, so a result can always be traced to
the exact values. No set is registered yet (the economy's value table is still
in the browser). Which model reads which set is declared when models are
migrated, never inferred from workbook sheet names.

## Sign-in

better-auth with Google; sessions in the database. `AUTH_DEV_BYPASS`
(development sign-in by email) exists for development and tests only; the
server refuses to start with it in production, and `NODE_ENV` unset counts as
production. Writes must be JSON and, when the browser names an origin, a
trusted one. See `docs/setup.md`.

## Known limits

- No hosting for the server yet; the GitHub Pages site has no folders.
- Google sign-in is configured and unit-checked, not tried with a real Google client.
- The existing tools' data is still per browser; migrating each is future work.
- Folders cannot be deleted (not asked for yet).
- One workspace is shown: a member of several sees the first one.
