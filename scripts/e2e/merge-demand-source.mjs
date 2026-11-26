// Where a segment's DR demand comes from (lib/build/demandSource.js): From events - the base's typed, the others the
// base's x their multiplier; From levels - Brut Wins x DR per Brut Win, calculated, never typed. An older project
// keeps its typed demands until a kind is picked.
// Run: npx vite-node scripts/e2e/merge-demand-source.mjs
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { SAVE_KEY, createChecker, launch, openMerge, showSegments } from './helpers.mjs'

const { ok, finish } = createChecker()
const set = async (locator, value) => {
  await locator.fill(String(value))
  await locator.blur()
  await new Promise((r) => setTimeout(r, 300))
}
const row = (page, i) => page.locator(`[data-testid="setup-segments"] [data-setup-segment="${i}"]`)
const num = (text) => Number(String(text).replace(/[^0-9.-]/g, ''))
const value = async (page, i) => (await row(page, i).locator('[data-field="demand-value"]').innerText()).trim()

{
  const { browser, page, errors } = await launch()
  await openMerge(page)
  await page.locator('[data-step="setup"]').click()
  await page.waitForTimeout(200)
  await showSegments(page, 3)

  // From events, the default.
  ok('a new Merge event takes its demand From events', (await page.locator('[data-demand-source="events"]').getAttribute('aria-checked')) === 'true' && /Type the base segment's demand/.test(await page.getByTestId('demand-source-hint').innerText()))
  ok('the multiplier column says it sizes the demand too', /multiplier\s+\(× base\)/i.test(await page.getByTestId('setup-segments').locator('thead').innerText()))
  await set(row(page, 0).locator('[data-field="demand"]'), 500)
  await set(row(page, 1).locator('[data-field="factor"]'), 1.6)
  ok(`Segment 2 is the base's x its multiplier, and cannot be typed (${await value(page, 1)})`, (await value(page, 1)) === '800 DR' && (await row(page, 1).locator('[data-field="demand"]').count()) === 0 && num(await row(page, 1).locator('[data-field="subsidy-needed"]').innerText()) === 1248)
  ok(`Segment 3, multiplier 1, has the base's (${await value(page, 2)})`, (await value(page, 2)) === '500 DR')
  await set(row(page, 1).locator('[data-field="factor"]'), 5)
  ok(`a demand above the chain's 2,048 is not taken, and it says why (${await row(page, 1).locator('[data-field="demand-problem"]').innerText()})`, (await value(page, 1)) === '-' && /2,500 DR, more than the 2,048/.test(await row(page, 1).locator('[data-field="demand-problem"]').innerText()))
  await set(row(page, 1).locator('[data-field="factor"]'), 1.6)

  // From levels.
  await page.locator('[data-demand-source="levels"]').click()
  await page.waitForTimeout(400)
  ok('From levels: a DR per Brut Win column, and no demand is typed', (await page.locator('[data-field="dr-per-bw"]').count()) === 3 && (await page.locator('[data-field="demand"]').count()) === 0)
  ok(`with no Brut Wins yet, no segment has a demand, and it says what is missing (${await row(page, 0).locator('[data-field="demand-problem"]').innerText()})`, (await value(page, 0)) === '-' && /Needs its effort in Brut Wins and its DR per Brut Win/.test(await row(page, 0).locator('[data-field="demand-problem"]').innerText()))
  await set(row(page, 0).locator('[data-field="effort-bw"]'), 200)
  await set(row(page, 0).locator('[data-field="dr-per-bw"]'), 2.5)
  ok(`200 Brut Wins x 2.5 DR = a demand of 500 DR, subsidy 1,548 (${await value(page, 0)})`, (await value(page, 0)) === '500 DR' && num(await row(page, 0).locator('[data-field="subsidy-needed"]').innerText()) === 1548 && /200 BW × 2\.5/.test(await row(page, 0).innerText()))
  await set(row(page, 1).locator('[data-field="effort-bw"]'), 100)
  ok('a segment with its Brut Wins but no DR per Brut Win says so', /Needs its DR per Brut Win/.test(await row(page, 1).locator('[data-field="demand-problem"]').innerText()))
  await set(row(page, 1).locator('[data-field="dr-per-bw"]'), 3)
  ok(`each segment its own multiplier: 100 x 3 = 300 DR (${await value(page, 1)})`, (await value(page, 1)) === '300 DR')

  // Recompletion follows the normal demand.
  await page.locator('[data-testid="build-scope"] button', { hasText: 'Recompletion' }).click()
  await page.waitForTimeout(300)
  ok('Recompletion follows the calculated demand (500, not typed there)', (await row(page, 0).locator('[data-field="demand"]').inputValue()) === '500' && (await row(page, 0).locator('[data-field="demand"]').isDisabled()))
  await page.locator('[data-testid="build-scope"] button', { hasText: 'Normal' }).click()
  await page.waitForTimeout(300)

  // Kept with the project.
  await page.locator('header').getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(400)
  const saved = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY))
  ok('saved: the kind on Segment 1, each segment\'s DR per Brut Win', saved.segments[0].demandSource === 'levels' && saved.segments[0].drPerBW === 2.5 && saved.segments[1].drPerBW === 3)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await page.locator('[data-step="setup"]').click()
  await page.waitForTimeout(300)
  ok('after a reload: From levels, the same demands', (await page.locator('[data-demand-source="levels"]').getAttribute('aria-checked')) === 'true' && (await value(page, 0)) === '500 DR' && (await value(page, 1)) === '300 DR')
  ok(`no page error (${errors.join(' | ').slice(0, 200)})`, errors.length === 0)
  await browser.close()
}

// A project saved before the choice: its demands stay as typed until a kind is picked.
{
  const board = (name, blockedValue) => ({ ...createBoard(name), blockedValue })
  const { browser, page, errors } = await launch({
    save: { segments: [{ name: 'Segment 1', targetSubsidy: 1548, boards: [board('Board 1', 150), board('Board 2', 1398)] }, { name: 'Segment 2', targetSubsidy: 1048, boards: [board('Board 1', 150), board('Board 2', 898)], segmentFactor: 1.2 }] },
  })
  await openMerge(page)
  await page.locator('[data-step="setup"]').click()
  await page.waitForTimeout(300)
  ok('an older project says its demands are as typed, and none is picked', /Saved before this choice/.test(await page.getByTestId('demand-source-hint').innerText()) && (await page.locator('[data-demand-source][aria-checked="true"]').count()) === 0)
  ok('...every demand still typed (500 and 1,000)', (await row(page, 0).locator('[data-field="demand"]').inputValue()) === '500' && (await row(page, 1).locator('[data-field="demand"]').inputValue()) === '1000')
  await page.locator('[data-demand-source="events"]').click()
  await page.waitForTimeout(500)
  ok(`picking From events works Segment 2 out from the base (500 x 1.2 = ${await value(page, 1)})`, (await value(page, 1)) === '600 DR' && num(await row(page, 1).locator('[data-field="subsidy-needed"]').innerText()) === 1448)
  ok(`older project: no page error (${errors.join(' | ').slice(0, 200)})`, errors.length === 0)
  await browser.close()
}

process.exit(finish('DEMAND FROM LEVELS OR EVENTS') ? 1 : 0)
