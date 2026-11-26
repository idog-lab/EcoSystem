// Puzzle as the LIVE site serves it: the built site, no toolkit server behind it
// (GitHub Pages). Puzzle must work there - events kept in the browser, shared with
// the team through Team data. Run: npm run build && npx tsx scripts/e2e-platform/puzzle-live.mjs
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright')
const PORT = 5197
const BASE = `http://localhost:${PORT}/EcoSystem/`
const results = []
const ok = (name, cond) => {
  results.push(!!cond)
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}`)
}

// Served the way GitHub Pages serves it: the built files under /EcoSystem/, and for any other address
// (a deep link like /models/puzzle, or /api/...) its 404.html with status 404 - there is no server.
const DIST = new URL('../../dist', import.meta.url).pathname
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' }
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, BASE).pathname)
  const rel = p.startsWith('/EcoSystem/') ? p.slice('/EcoSystem/'.length) : null
  let file = rel == null ? null : path.join(DIST, rel || 'index.html')
  if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (file && fs.existsSync(file)) {
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
    return fs.createReadStream(file).pipe(res)
  }
  res.writeHead(404, { 'Content-Type': 'text/html' })
  fs.createReadStream(path.join(DIST, '404.html')).pipe(res)
})
await new Promise((r) => server.listen(PORT, r))
// E2E_CHROMIUM_PATH: a Chromium of this machine when the pinned Playwright's own is not installed.
const browser = await chromium.launch(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {})
const errors = []
const typeNum = async (loc, v) => {
  await loc.fill(String(v))
  await loc.press('Enter')
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  // A first visit, straight to the address the economist opens.
  await page.goto(`${BASE}models/puzzle`, { waitUntil: 'networkidle' })
  await page.getByTestId('puzzle-events').waitFor({ timeout: 20000 })
  const text = await page.locator('main').innerText()
  ok('with no server, Puzzle opens on its list of events (no "cannot be reached")', !/cannot be reached/i.test(text))
  ok('...and says where the events are kept and how they reach the team', (await page.getByTestId('puzzle-where').innerText()).includes('Team data'))
  await page.getByTestId('event-new').click()
  await page.locator('[data-step="setup"]').waitFor()
  ok('"New event" opens the editor at step 1, saved as revision 1', await page.getByText('Saved · revision 1').isVisible())
  await page.locator('[data-step="economy"]').click()
  await typeNum(page.getByTestId('wins-1'), 33)
  await page.getByTestId('event-save').click()
  await page.getByText('Saved · revision 2').waitFor()
  ok('an edit is saved as revision 2', true)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('superplay-puzzle') ?? '{}'))
  const doc = Object.values(stored.documents ?? {})[0]
  ok('it is kept in this browser under the key Team data shares (superplay-puzzle)', doc?.revision === 2 && doc.payload.economy.segments[0].winsForEconomy === 33)

  // Another tab of the same browser: a stale save is refused, the edit kept.
  const other = await context.newPage()
  await other.goto(`${BASE}models/puzzle`, { waitUntil: 'networkidle' })
  await other.getByTestId('event-open').first().click()
  await other.locator('[data-step="setup"]').waitFor()
  await page.locator('[data-step="setup"]').click()
  await typeNum(page.getByTestId('setup-inflation'), 9)
  await page.getByTestId('event-save').click()
  await page.getByText('Saved · revision 3').waitFor()
  await other.locator('[data-step="setup"]').click()
  await typeNum(other.getByTestId('setup-mtx'), 0.7)
  await other.getByTestId('event-save').click()
  const conflict = await other.getByTestId('conflict').waitFor({ timeout: 8000 }).then(() => true).catch(() => false)
  const newer = conflict || (await other.getByTestId('newer').isVisible())
  ok('a save made from an older revision is refused and the edit stays on screen', newer && (await other.getByTestId('setup-mtx').inputValue()) === '0.7')

  // Reload: still there. The other tab's unsaved edit (made from revision 2) is kept, and is NOT taken as
  // current: the page says revision 3 came after it and asks which to keep.
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('event-open').first().click()
  await page.getByTestId('conflict').waitFor()
  ok('after a reload, edits made from an older revision come back as a choice, never over the newer one', (await page.getByTestId('conflict').innerText()).includes('Revision 3'))
  await page.getByTestId('conflict-take-theirs').click()
  await page.locator('[data-step="review"]').click()
  ok('...taking the newer one shows the event at its last revision, saved', await page.getByText('Saved · revision 3').isVisible())
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('superplay-puzzle')))
  ok('revision 3 is what is kept (inflation 9%), nothing was saved over it', Object.values(kept.documents)[0].payload.setup.inflation === 0.09)
  ok('Review & export works without a server', await page.getByTestId('review-checks').isVisible())
  await page.getByTestId('puzzle-tabs').getByRole('radio', { name: 'Optimize' }).click()
  await page.getByTestId('event-id').fill('ev-test')
  await page.getByTestId('event-id').press('Enter')
  ok('Optimize opens (targets, live runs, results)', await page.getByTestId('optimize').isVisible())
  await page.getByTestId('puzzle-tabs').getByRole('radio', { name: 'CC Presets' }).click()
  ok('CC Presets opens', await page.getByTestId('cc-heatmap').isVisible())
  await page.getByTestId('simulator-open').click()
  ok('the player simulator opens and says it has no data', await page.getByTestId('sim-unavailable').isVisible())
  ok('the home page lists Puzzle as built', await (async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    return (await page.getByRole('link', { name: 'Puzzle' }).count()) > 0
  })())
  ok(`no page error (${errors.slice(0, 2).join(' | ')})`, errors.length === 0)
} finally {
  await browser.close()
  await new Promise((r) => server.close(r))
}
const fails = results.filter((r) => !r).length
console.log(`\n${fails === 0 ? `PUZZLE LIVE: ALL ${results.length} CHECKS PASSED` : `PUZZLE LIVE: ${fails} OF ${results.length} CHECKS FAILED`}`)
process.exit(fails ? 1 : 0)
