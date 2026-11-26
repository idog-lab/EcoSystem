// Puzzle in a real browser, two people at once, on its own database and
// servers (like home.mjs). Run: npx tsx scripts/e2e-platform/puzzle.mjs
import { createRequire } from 'node:module'
import { serve } from '@hono/node-server'
import { createServer } from 'vite'
import { createApp } from '../../server/app'
import { loadConfig } from '../../server/config'
import { createTestDatabase } from '../../tests/helpers/db'
import { computeAll } from '../../src/features/puzzle/engine/compute'
import { boardOrder } from '../../src/features/puzzle/engine/shuffle'

const { chromium } = createRequire(import.meta.url)('playwright')
const API_PORT = 8798
const WEB_PORT = 5198
const BASE = `http://localhost:${WEB_PORT}/EcoSystem/`
const results = []
const ok = (name, cond) => {
  results.push(!!cond)
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}`)
}

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

async function person(email, width = 1500) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !/401|404|Failed to load resource/.test(m.text()) && pageErrors.push(m.text()))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('#dev-email').fill(email)
  await page.locator('form').filter({ has: page.locator('#dev-email') }).getByRole('button', { name: 'Sign in' }).click()
  await page.getByText(`Signed in as ${email}`).waitFor()
  await page.goto(`${BASE}models/puzzle`, { waitUntil: 'networkidle' })
  return page
}
const step = async (page, id) => {
  await page.locator(`[data-step="${id}"]`).click()
  await page.waitForTimeout(150)
}
const savedEvent = async () => (await t.db.modelDocument.findFirst({ where: { modelId: 'puzzle' }, orderBy: { createdAt: 'asc' } })).payload
const typeNum = async (loc, value) => {
  await loc.fill(String(value))
  await loc.press('Enter')
}
const tick = (page, ms = 200) => page.waitForTimeout(ms)
async function eventually(fn, timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

try {
  const ana = await person('ana@studio.test')
  ok('Puzzle opens on the list of shared events', await ana.getByTestId('puzzle-events').isVisible())
  await ana.getByTestId('event-new').click()
  await ana.locator('[data-step="setup"]').waitFor()
  ok('a new event opens in step 1, saved as revision 1', (await ana.getByText('Saved · revision 1').isVisible()) && (await ana.getByTestId('step-purpose').innerText()).includes('Step 1 of 5'))
  const ev0 = await savedEvent()
  ok('a new event is shuffled once and board 1 starts with its cheapest piece', boardOrder(ev0.order.regular, 6)[0] === 1 && new Set(ev0.order.regular).size === 24)

  // Step 2: the numbers on screen are the engine's, for the segment picked; every segment is computed.
  await step(ana, 'economy')
  await ana.getByTestId('segment').selectOption('4')
  await tick(ana)
  const r0 = computeAll(ev0)
  ok(`segment 4's board costs on screen are the engine's (${r0.regular[3].tiers.map((x) => x.cost).join(', ')})`, await (async () => {
    for (let i = 1; i <= 6; i++) if ((await ana.getByTestId(`board-cost-${i}`).innerText()).replace(/,/g, '') !== String(r0.regular[3].tiers[i - 1].cost)) return false
    return true
  })())
  await typeNum(ana.getByTestId('wins-4'), 60)
  await tick(ana)
  ok('editing Wins for Economy recalculates at once and shows "Unsaved changes"', (await ana.getByText('Unsaved changes').isVisible()) && (await ana.getByTestId('puzzle-total').innerText()).replace(/,/g, '') !== String(r0.regular[3].totalCost))
  await typeNum(ana.getByTestId('wins-4'), 'abc')
  ok('a value that is not a number is refused, and says why', (await ana.locator('[data-field-rejected="true"]').count()) === 1)
  await ana.getByTestId('wins-paste').fill('30\n38\n42\n60\n54\n63\n72\n90\n146')
  await ana.getByRole('button', { name: 'Put in' }).first().click()
  await tick(ana)
  ok('a column of nine values can be pasted', (await ana.getByTestId('wins-9').inputValue()) === '146' && (await ana.getByTestId('wins-1').inputValue()) === '30')
  await ana.getByTestId('event-save').click()
  await ana.getByText('Saved · revision 2').waitFor()
  ok('Save stores revision 2 on the server', (await savedEvent()).economy.segments[3].winsForEconomy === 60)

  // RC: its own segments.
  await ana.getByTestId('phase').getByRole('radio', { name: 'RC' }).click()
  await tick(ana)
  ok('RC shows its 11 segments and the budget as stored inputs', (await ana.getByTestId('segment').locator('option').count()) === 11 && (await ana.getByTestId('rc-boards').isVisible()) && (await ana.getByTestId('rc-total-11').isVisible()))
  await ana.getByTestId('phase').getByRole('radio', { name: 'Regular' }).click()

  // Step 3: a target is compared, never applied.
  await step(ana, 'rewards')
  const before = await ana.getByTestId('actual-6').innerText()
  await typeNum(ana.getByTestId('target-6'), 10)
  await tick(ana)
  const actual = Number((await ana.getByTestId('actual-6').innerText()).replace(/,/g, ''))
  ok(`a typed target shows the difference and changes no reward (${before} -> gap ${await ana.getByTestId('gap-6').innerText()})`, (await ana.getByTestId('actual-6').innerText()) === before && Math.abs(Number((await ana.getByTestId('gap-6').innerText()).replace(/[+,]/g, '')) - (actual - 10)) < 0.001)

  // Step 1: one mode only; Maleficent shows the boss.
  await step(ana, 'setup')
  await ana.getByTestId('setup-mode').getByRole('radio', { name: 'Maleficent' }).click()
  ok('the mode is one choice of three', (await ana.getByTestId('setup-mode').getByRole('radio', { checked: true }).count()) === 1)
  await step(ana, 'mechanics')
  ok('Maleficent: a Boss Bar on board 1', /^\d+$/.test(await ana.getByTestId('boss-bar-1').innerText()))
  const order1 = await ana.getByTestId('order-6').innerText()
  await ana.getByTestId('reshuffle').click()
  ok('a new shuffle asks first; the order is unchanged until then', (await ana.getByTestId('order-6').innerText()) === order1)
  await ana.getByTestId('reshuffle-confirm').click()
  await tick(ana)
  ok('...and changes it once confirmed, board 1 still starting with piece 1', (await ana.getByTestId('order-6').innerText()) !== order1 && (await ana.getByTestId('order-1').innerText()).startsWith('1,'))

  // Step 5: checks and export.
  await step(ana, 'review')
  ok('Review: an export waits for a save', (await ana.getByText('Save first: an export is made from a saved revision.').isVisible()) && (await ana.getByTestId('export-run').isDisabled()))
  await ana.getByTestId('event-save').click()
  await ana.getByText('Saved · revision 3').waitFor()
  ok('Review lists what blocks an export (no first-puzzle dates yet)', (await ana.getByTestId('review-export').innerText()).includes('First-puzzle time rules have no dates'))

  // Config preview.
  await ana.getByTestId('puzzle-tabs').getByRole('radio', { name: 'Config preview' }).click()
  await ana.getByTestId('preview-sheet').selectOption('Seg 1')
  const prev = await ana.getByTestId('config-preview').innerText()
  ok('Config preview shows Seg 1 as the Maleficent template gets it (A3:AH8, Tier 1..6)', prev.includes("'Seg 1'!A3:AH8") && prev.includes('Tier 6'))

  // CC presets: the economist's example.
  await ana.getByTestId('puzzle-tabs').getByRole('radio', { name: 'CC Presets' }).click()
  ok('CC: the heatmap is drawn', await ana.getByTestId('cc-heatmap').isVisible())
  if (process.env.PUZZLE_SHOTS) await ana.screenshot({ path: `${process.env.PUZZLE_SHOTS}/cc.png`, fullPage: true })
  await ana.getByTestId('cc-steps').getByRole('radio', { name: '3 Test & Export' }).click()
  await typeNum(ana.getByTestId('cc-test-day'), 7)
  await typeNum(ana.getByTestId('cc-test-progress'), 30)
  await ana.getByTestId('cc-test-preset').selectOption('puzzle_50')
  await tick(ana)
  ok(`CC tester: 13 even days, day 7, 30% -> Push, puzzle_50 gives 60 (${await ana.getByTestId('cc-test-state').innerText()}, ${await ana.getByTestId('cc-test-dr').innerText()})`, (await ana.getByTestId('cc-test-state').innerText()) === 'Push' && (await ana.getByTestId('cc-test-dr').innerText()) === '60')

  // Simulator: no data -> no prediction; a manual scenario is labelled.
  await ana.getByTestId('simulator-open').click()
  ok('the simulator says it has no data instead of guessing', await ana.getByTestId('sim-unavailable').isVisible())
  await ana.getByTestId('simulator').getByRole('radio', { name: 'Manual scenario' }).click()
  await typeNum(ana.getByTestId('sim-manual'), 40)
  await tick(ana)
  if (process.env.PUZZLE_SHOTS) await ana.screenshot({ path: `${process.env.PUZZLE_SHOTS}/simulator.png` })
  ok('a manual scenario places the player and is labelled as one', (await ana.getByTestId('sim-progress').innerText()) === '40.0%' && (await ana.getByTestId('simulator').innerText()).includes('not data, not a prediction'))
  const savedBefore = JSON.stringify(await savedEvent())
  ok('opening the simulator changed nothing in the event', !(await ana.getByText('Unsaved changes').isVisible()) && JSON.stringify(await savedEvent()) === savedBefore)
  await ana.getByTestId('simulator-close').click()

  // Two people: a stale save keeps the edits and asks.
  const ben = await person('ben@studio.test')
  await ben.getByTestId('event-open').first().click()
  await ben.locator('[data-step="setup"]').waitFor()
  await ana.getByTestId('puzzle-tabs').getByRole('radio', { name: 'Build event' }).click()
  await step(ana, 'setup')
  await typeNum(ana.getByTestId('setup-inflation'), 9)
  await step(ben, 'setup')
  await typeNum(ben.getByTestId('setup-mtx'), 0.7)
  await ana.getByTestId('event-save').click()
  await ana.getByText('Saved · revision 4').waitFor()
  await ben.getByTestId('event-save').click()
  await ben.getByTestId('conflict').waitFor()
  ok("Ben's stale save is refused and his edit is still on screen", (await ben.getByTestId('setup-mtx').inputValue()) === '0.7')
  await ben.getByTestId('conflict-keep-mine').click()
  await ben.getByText('Saved · revision 5').waitFor()
  const last = await savedEvent()
  ok('"Save mine on top" stores his version as revision 5 (revision 4 stays in the history)', last.setup.mtxBaseline === 0.7 && (await t.db.documentRevision.count({ where: { revision: 4 } })) === 1)
  ok("Ana's open event takes revision 5 by itself (she had nothing unsaved)", await eventually(async () => (await ana.getByTestId('setup-mtx').inputValue()) === '0.7'))

  // Clone.
  await ana.getByTestId('event-clone').click()
  await ana.getByText('Saved · revision 1').waitFor()
  ok('Clone makes a new shared event, named "Copy of ..."', (await ana.getByTestId('puzzle-event-name').innerText()).startsWith('Copy of'))

  // Layout at a narrower window.
  const narrow = await person('ana@studio.test', 1280)
  await narrow.getByTestId('event-open').first().click()
  for (const s of ['setup', 'economy', 'rewards', 'mechanics', 'review']) {
    await step(narrow, s)
    // PUZZLE_SHOTS=<dir> keeps a picture of every step (for a person to look at).
    if (process.env.PUZZLE_SHOTS) await narrow.screenshot({ path: `${process.env.PUZZLE_SHOTS}/${s}.png`, fullPage: true })
    const wide = await narrow.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    if (wide) ok(`at 1280 px the "${s}" step is no wider than the window`, false)
  }
  ok('at 1280 px no step is wider than the window', true)
  ok(`no page error (${pageErrors.slice(0, 3).join(' | ')})`, pageErrors.length === 0)
} finally {
  await browser.close()
  await vite.close()
  api.close()
  await t.drop()
}
const fails = results.filter((r) => !r).length
console.log(`\n${fails === 0 ? `PUZZLE: ALL ${results.length} CHECKS PASSED` : `PUZZLE: ${fails} OF ${results.length} CHECKS FAILED`}`)
process.exit(fails ? 1 : 0)
