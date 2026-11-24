// A Chef simulation run is kept in this browser (a known limit was "Simulation
// results are not saved with a chef"): played, the page reloaded, the run is
// there - current while the chef is the same, out of date once it is not.
// Run: npx vite-node scripts/e2e/chef-runs.mjs (start `npm run dev` first)
import { BASE, createChecker, launch } from './helpers.mjs'

const { ok, finish } = createChecker()
const { browser, page, errors } = await launch({ folded: true })
await page.setViewportSize({ width: 1500, height: 800 })
page.on('dialog', (d) => d.accept())
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ').trim()
const openChef = async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Chef/ }).first().click()
  await page.getByTestId('chef-header').waitFor()
  await page.waitForTimeout(300)
}
const step = async (id) => {
  await page.locator(`[data-chef-step="${id}"]`).click()
  await page.waitForTimeout(250)
}

await openChef()
await page.getByTestId('chef-more').click()
await page.getByTestId('chef-more-panel').getByRole('menuitem', { name: 'New chef: a synthetic example (made up)' }).click()
await page.waitForTimeout(400)
await page.getByTestId('chef-save').click()
await page.waitForTimeout(300)
await step('simulate')
await page.locator('[data-collapsible="chef-run-options"] > summary').click()
const players = page.getByTestId('chef-run-players')
await players.fill('60')
await players.blur()
await page.getByTestId('chef-run').click()
await page.getByTestId('chef-sim-summary').waitFor({ timeout: 300000 })
const rowsBefore = await page.locator('[data-testid="chef-sim-summary"] tbody tr').count()
const identity = await text(page.getByTestId('chef-sim-identity'))
ok(`a run says it is kept in this browser (${await text(page.getByTestId('chef-sim-kept'))})`, /Kept in this browser/.test(await text(page.getByTestId('chef-sim-kept'))))

await page.reload({ waitUntil: 'networkidle' })
await page.getByRole('button', { name: /Chef/ }).first().click()
await page.getByTestId('chef-header').waitFor()
await step('simulate')
ok(`after a reload the run is there, the same one (${await page.locator('[data-testid="chef-sim-summary"] tbody tr').count()} rows)`, (await page.getByTestId('chef-sim-summary').count()) === 1 && (await page.locator('[data-testid="chef-sim-summary"] tbody tr').count()) === rowsBefore && (await text(page.getByTestId('chef-sim-identity'))) === identity)
ok('...and it is current: the chef is the one it was played on', (await page.getByTestId('chef-sim-out-of-date').count()) === 0)
await step('event')
const effort = page.locator('[data-segment] input[aria-label*="ffort"]').first()
await effort.fill('1.37')
await effort.blur()
await page.waitForTimeout(250)
await step('simulate')
ok('once the chef changes, the kept run is out of date - never shown as current', /Out of date: the event was changed after this run/.test((await page.getByTestId('chef-sim-out-of-date').count()) ? await text(page.getByTestId('chef-sim-out-of-date')) : ''))
ok(`no page error (${errors.join(' | ').slice(0, 200)})`, errors.length === 0)
await browser.close()
process.exit(finish('CHEF RUNS KEPT') ? 1 : 0)
