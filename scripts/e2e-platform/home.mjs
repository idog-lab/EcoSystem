// The new home page, end to end, with two people signed in at once.
// Self-contained: an isolated database, the API server and a Vite dev server
// on their own ports (nothing touches your dev database or port 5173).
// Needs PostgreSQL (TEST_DATABASE_ADMIN_URL, see docs/setup.md) and Chromium.
// Run: npm run test:e2e:platform
import { createRequire } from 'node:module'
import { serve } from '@hono/node-server'
import { createServer } from 'vite'
import { createApp } from '../../server/app'
import { loadConfig } from '../../server/config'
import { createTestDatabase } from '../../tests/helpers/db'
import { MODEL_CATALOG } from '../../src/platform/registry/catalog'

const { chromium } = createRequire(import.meta.url)('playwright')
const API_PORT = 8799
const WEB_PORT = 5199
const BASE = `http://localhost:${WEB_PORT}/EcoSystem/`
const N = MODEL_CATALOG.length

const results = []
const ok = (name, cond) => {
  results.push(!!cond)
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}`)
}

// ---------------------------------------------------------------- servers
const t = await createTestDatabase()
const ws = await t.db.workspace.create({ data: { slug: 'studio', name: 'Studio' } })
for (const email of ['ana@studio.test', 'ben@studio.test']) {
  const user = await t.db.user.create({ data: { email, name: email.split('@')[0] } })
  await t.db.membership.create({ data: { workspaceId: ws.id, userId: user.id } })
}
const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: t.url, AUTH_DEV_BYPASS: 'true', PUBLIC_APP_URL: `http://localhost:${WEB_PORT}` })
const api = serve({ fetch: createApp({ db: t.db, config }).fetch, port: API_PORT })
const vite = await createServer({
  configFile: new URL('../../vite.config.js', import.meta.url).pathname,
  server: { port: WEB_PORT, strictPort: true, proxy: { '/api': `http://localhost:${API_PORT}` } },
  logLevel: 'warn',
})
await vite.listen()

// E2E_CHROMIUM_PATH: a Chromium of this machine when the pinned Playwright's own is not installed.
const browser = await chromium.launch(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {})
const pageErrors = []
async function person(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  if (email) {
    await page.locator('#dev-email').fill(email)
    await page.locator('form').filter({ has: page.locator('#dev-email') }).getByRole('button', { name: 'Sign in' }).click()
    await page.getByText(`Signed in as ${email}`).waitFor()
  }
  return page
}
const cardNames = (page) => page.locator('main ul[aria-label] > li > a').allInnerTexts()
const url = (page) => new URL(page.url())
const nav = (page) => page.getByRole('navigation', { name: 'Models' })
const folderLink = (page, name) => nav(page).getByRole('link', { name: new RegExp(`^${name},`) })
/** Waits for the other person's view to catch up (it polls every 5 s). */
async function eventually(fn, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

try {
  // ---------------------------------------------------------------- signed out
  const guest = await person(null)
  const names = await cardNames(guest)
  ok(`the catalog is exactly the registry's ${N} models (${names.join(', ')})`, names.length === N && [...names].sort().join() === MODEL_CATALOG.map((m) => m.displayName).sort().join())
  const linkTexts = await guest.locator('main ul[aria-label] > li > a').evaluateAll((as) => as.map((a) => a.textContent.trim()))
  ok('each card is a link holding only the name (and an icon)', linkTexts.every((txt, i) => txt === names[i]) && (await guest.locator('main ul[aria-label] > li > a svg').count()) === N)
  ok('three columns on a wide window', (await guest.locator('main ul[aria-label]').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)) === 3)
  ok('signed out: navigation has All models only, and no card can be moved', (await nav(guest).getByRole('link').count()) === 1 && (await guest.getByRole('button', { name: /to a folder/ }).count()) === 0)
  ok('the title is "Economy design toolkit"', (await guest.title()) === 'Economy design toolkit' && (await guest.getByRole('heading', { level: 1 }).innerText()) === 'Economy design toolkit')

  // Search: trimmed, case-insensitive, display names only, kept in the URL.
  const search = guest.getByRole('searchbox', { name: 'Search models by name' })
  await search.fill('  MANIA ')
  ok('search is trimmed and ignores case', JSON.stringify(await cardNames(guest)) === '["Merge Mania"]')
  ok('...and the URL holds it', url(guest).searchParams.get('q') === '  MANIA ')
  await search.fill('event')
  ok('search looks at names only (no model is named "event")', (await cardNames(guest)).length === 0 && (await guest.getByText('No models match “event”').isVisible()))
  await guest.getByRole('button', { name: 'Reset search and folder' }).click()
  ok('Reset brings every model back and clears the URL', (await cardNames(guest)).length === N && url(guest).search === '')
  await search.fill('m')
  await search.fill('momentum')
  await guest.reload({ waitUntil: 'networkidle' })
  ok('a refresh keeps the search', (await search.inputValue()) === 'momentum' && JSON.stringify(await cardNames(guest)) === '["Momentum"]')
  await guest.goBack()
  ok('Back leaves the search in one step (typing does not fill the history)', (await search.inputValue()) === '' && (await cardNames(guest)).length === N)
  await guest.goForward()
  ok('Forward brings it back', (await search.inputValue()) === 'momentum')

  await guest.goto(`${BASE}?folder=unfiled`, { waitUntil: 'networkidle' })
  ok('a folder link while signed out says folders need signing in', await guest.getByRole('heading', { name: 'Folders are not available' }).isVisible())
  await guest.goto(`${BASE}models/battle-pass`, { waitUntil: 'networkidle' })
  ok('an unknown model has its own page', await guest.getByRole('heading', { name: 'Unknown model' }).isVisible())
  await guest.goto(`${BASE}models/momentum`, { waitUntil: 'networkidle' })
  ok('a model not built yet says "Model not migrated yet", and nothing else to fill in', (await guest.getByRole('heading', { name: 'Model not migrated yet' }).isVisible()) && (await guest.locator('input, select, textarea').count()) === 0)
  await guest.goto(`${BASE}models/merge-mania`, { waitUntil: 'networkidle' })
  ok('Merge Mania opens its existing editor', await guest.getByText('DR demand').first().isVisible())
  await guest.goto(`${BASE}models/chef`, { waitUntil: 'networkidle' })
  ok('Chef opens its existing flow', (await guest.locator('[data-chef-step]').count()) > 0)

  // ---------------------------------------------------------------- two members
  const ana = await person('ana@studio.test')
  const ben = await person('ben@studio.test')
  ok('signed in: All models, Unfiled; the workspace starts with no folders', (await folderLink(ana, 'Unfiled').innerText()).includes(String(N)) && (await ana.getByText('No folders yet').isVisible()))

  // Create: blank and case-insensitive duplicates refused.
  await ana.getByRole('button', { name: 'New folder' }).click()
  await ana.getByRole('textbox', { name: 'New folder name' }).fill('   ')
  await ana.getByRole('button', { name: 'Create' }).click()
  ok('a blank folder name is refused', await ana.getByRole('alert').filter({ hasText: 'A folder needs a name.' }).isVisible())
  await ana.getByRole('textbox', { name: 'New folder name' }).fill(' Live Ops ')
  await ana.getByRole('button', { name: 'Create' }).click()
  await folderLink(ana, 'Live Ops').waitFor()
  ok('a folder is created, empty', (await folderLink(ana, 'Live Ops').innerText()).includes('0'))
  await ana.getByRole('button', { name: 'New folder' }).click()
  await ana.getByRole('textbox', { name: 'New folder name' }).fill('live ops')
  await ana.getByRole('button', { name: 'Create' }).click()
  ok('a name that differs only in case is refused', await ana.getByRole('alert').filter({ hasText: 'already a folder' }).isVisible())
  await ana.getByRole('button', { name: 'Cancel' }).click()
  await folderLink(ana, 'Live Ops').click()
  ok('an empty folder says so', await ana.getByRole('heading', { name: 'This folder is empty' }).isVisible())
  const liveOpsId = url(ana).searchParams.get('folder')
  await folderLink(ana, 'All models').click()

  // Drag a card onto the folder: it moves, and nothing opens.
  await ana.locator('li[data-model-id="chef"] > a').dragTo(folderLink(ana, 'Live Ops'))
  await ana.waitForTimeout(500)
  ok('dragging Chef onto Live Ops moves it, without opening Chef', url(ana).pathname === '/EcoSystem/' && (await folderLink(ana, 'Live Ops').innerText()).includes('1'))
  ok('...the model keeps its address', (await ana.locator('li[data-model-id="chef"] > a').getAttribute('href')) === '/EcoSystem/models/chef')
  ok('the other member sees it (polling)', await eventually(async () => (await folderLink(ben, 'Live Ops').innerText()).includes('1')))

  // Move with the keyboard, from the other member's screen.
  const moveBtn = ben.getByRole('button', { name: 'Move Puzzle to a folder' })
  await moveBtn.focus()
  await ben.keyboard.press('Enter')
  ok('the Move to folder menu opens on the current place', (await ben.getByRole('menuitemradio', { name: 'Unfiled' }).getAttribute('aria-checked')) === 'true' && (await ben.evaluate(() => document.activeElement?.textContent)) === 'Unfiled')
  await ben.keyboard.press('ArrowDown')
  await ben.keyboard.press('Enter')
  await ben.waitForTimeout(400)
  ok('a keyboard move puts Puzzle in Live Ops', (await folderLink(ben, 'Live Ops').innerText()).includes('2'))
  ok('...and focus goes back to the button', (await ben.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Move Puzzle to a folder')
  ok('Ana sees Puzzle moved', await eventually(async () => (await folderLink(ana, 'Live Ops').innerText()).includes('2')))

  // Folder + search combine (AND), both in the URL.
  await ana.goto(`${BASE}?folder=${liveOpsId}&q=puz`, { waitUntil: 'networkidle' })
  ok('folder AND search: only Puzzle', JSON.stringify(await cardNames(ana)) === '["Puzzle"]' && (await ana.locator('main').getByRole('heading', { level: 2 }).innerText()) === 'Live Ops')
  await ana.getByRole('searchbox').fill('merge')
  ok('a search with no match in the folder says where it looked', await ana.getByText('No models match “merge” in Live Ops').isVisible())
  await ana.getByRole('searchbox').fill('')
  await ana.getByRole('searchbox').blur()
  await folderLink(ana, 'Unfiled').click()
  ok('Unfiled lists what is in no folder', (await cardNames(ana)).length === N - 2 && !(await cardNames(ana)).includes('Chef'))
  await ana.goBack()
  ok('Back returns to the folder', url(ana).searchParams.get('folder') === liveOpsId && (await cardNames(ana)).length === 2)

  // Unfile by dragging onto Unfiled.
  await ana.locator('li[data-model-id="chef"] > a').dragTo(folderLink(ana, 'Unfiled'))
  await ana.waitForTimeout(500)
  ok('dragging Chef onto Unfiled takes it out of the folder', JSON.stringify(await cardNames(ana)) === '["Puzzle"]')
  await ana.reload({ waitUntil: 'networkidle' })
  ok('...and it is stored (after a reload)', JSON.stringify(await cardNames(ana)) === '["Puzzle"]')

  // Rename, seen by the other member; then a rename conflict keeps the typing.
  await ana.getByRole('button', { name: 'Rename folder Live Ops' }).click()
  await ana.getByRole('textbox', { name: 'New name for Live Ops' }).fill('Core economy')
  await ana.getByRole('button', { name: 'Save' }).click()
  await folderLink(ana, 'Core economy').waitFor()
  ok('a folder can be renamed, and the other member sees the new name', await eventually(async () => (await folderLink(ben, 'Core economy').count()) === 1))
  await ana.getByRole('button', { name: 'Rename folder Core economy' }).click()
  await ana.getByRole('textbox', { name: 'New name for Core economy' }).fill('Ana name')
  await ben.getByRole('button', { name: 'Rename folder Core economy' }).click()
  await ben.getByRole('textbox', { name: 'New name for Core economy' }).fill('Ben name')
  await ben.getByRole('button', { name: 'Save' }).click()
  await folderLink(ben, 'Ben name').waitFor()
  await ana.getByRole('button', { name: 'Save' }).click()
  const conflict = ana.getByRole('alert').filter({ hasText: 'Someone renamed this folder to "Ben name"' })
  await conflict.waitFor({ timeout: 5000 }).catch(() => {})
  ok('a rename made from an old version is refused and says what changed', await conflict.isVisible())
  ok('...while what Ana typed is still in the field', (await ana.getByRole('textbox', { name: /New name for/ }).inputValue()) === 'Ana name')
  await ana.getByRole('button', { name: 'Save' }).click()
  ok('saving again, deliberately, applies it', await eventually(async () => (await folderLink(ben, 'Ana name').count()) === 1))

  // A click (not a drag) opens the model; Back returns to the same view.
  await ana.goto(`${BASE}?q=pu`, { waitUntil: 'networkidle' })
  await ana.getByRole('link', { name: 'Puzzle' }).click()
  await ana.getByTestId('puzzle-page').waitFor()
  ok('a click opens the model at its own address', url(ana).pathname === '/EcoSystem/models/puzzle')
  await ana.getByRole('button', { name: 'Models' }).click()
  ok('"All models" goes back to the home page as it was left', url(ana).searchParams.get('q') === 'pu' && JSON.stringify(await cardNames(ana)) === '["Puzzle"]')

  await ana.goto(`${BASE}?folder=no-such-folder`, { waitUntil: 'networkidle' })
  ok('an unknown folder in the URL says so, with a way out', await ana.getByRole('heading', { name: 'This folder does not exist' }).isVisible())

  ok(`no page errors (${pageErrors.join(' | ').slice(0, 200)})`, pageErrors.length === 0)
} catch (err) {
  console.error(err)
  results.push(false)
} finally {
  await browser.close()
  await vite.close()
  api.close()
  await t.drop()
}

const fails = results.filter((r) => !r).length
console.log(`\n${fails === 0 ? `PLATFORM HOME: ALL ${results.length} CHECKS PASSED` : `PLATFORM HOME: ${fails} OF ${results.length} CHECKS FAILED`}`)
process.exit(fails ? 1 : 0)
