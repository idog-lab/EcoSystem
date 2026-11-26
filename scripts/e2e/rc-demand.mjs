// Browser end-to-end: Recompletion's demand is the segment's normal-event
// demand. It is typed once, in the Normal phase, and the Recompletion
// subsidy and board budgets follow. See helpers.mjs.
// Run: npx vite-node scripts/e2e/rc-demand.mjs
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { createChecker, launch, openMerge, tab, SAVE_KEY, showSegments } from './helpers.mjs'

const { ok, finish } = createChecker()
const step = (page, id) => page.locator(`[data-step="${id}"]`)
const set = async (locator, value) => {
  await locator.fill(String(value))
  await locator.blur()
  await new Promise((r) => setTimeout(r, 250))
}
const phase = async (page, label) => {
  await page.locator('[data-testid="build-scope"] button', { hasText: label }).click()
  await page.waitForTimeout(300)
}
const row = (page, i) => page.locator(`[data-testid="setup-segments"] [data-setup-segment="${i}"]`)
const num = (text) => Number(String(text).replace(/[^0-9.-]/g, ''))

{
  const { browser, page, errors } = await launch()
  await openMerge(page)
  await step(page, 'setup').click()
  await page.waitForTimeout(200)
  await showSegments(page, 3)

  // Three Recompletion boards, before any amount exists.
  await phase(page, 'Recompletion')
  await set(page.locator('[data-field="setup-board-count"]'), 3)
  ok('with no normal amount yet, the Recompletion demand is free to type (nothing to follow)', await row(page, 0).locator('[data-field="demand"]').isEnabled())
  ok('the Recompletion step says where the demand comes from', /same as its demand in the normal event/.test(await page.getByTestId('rc-demand-follows').innerText()))

  // Type the demand once, in the Normal phase.
  await phase(page, 'Normal')
  await set(row(page, 0).locator('[data-field="demand"]'), 500)
  // (A new project's demand comes From events: Segment 2's is the base's x its multiplier, 500 x 1.6.)
  await set(row(page, 1).locator('[data-field="factor"]'), 1.6)
  ok('Normal: demand 500 needs 1,548 DR of subsidy (2,048 - 500)', num(await row(page, 0).locator('[data-field="subsidy-needed"]').innerText()) === 1548)

  await phase(page, 'Recompletion')
  const rc0 = row(page, 0)
  ok('Recompletion shows the same demand, 500, and it cannot be typed there', (await rc0.locator('[data-field="demand"]').inputValue()) === '500' && (await rc0.locator('[data-field="demand"]').isDisabled()) && /same as Normal/.test(await rc0.innerText()))
  ok('...so its subsidy is 6,144 - 500 = 5,644 DR', num(await rc0.locator('[data-field="subsidy-needed"]').innerText()) === 5644)
  ok('another segment follows its own normal demand (800 -> 5,344 DR)', (await row(page, 1).locator('[data-field="demand"]').inputValue()) === '800' && num(await row(page, 1).locator('[data-field="subsidy-needed"]').innerText()) === 5344)
  ok('a segment worked out from the base follows it in Recompletion too (500 -> 5,644 DR)', (await row(page, 2).locator('[data-field="demand"]').inputValue()) === '500' && (await row(page, 2).locator('[data-field="demand"]').isDisabled()))

  // The Recompletion boards were given budgets that add up to it.
  await tab(page, 'Build event').click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(300)
  let saved = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY))
  const budgets = (seg) => saved.segments[seg].recompletionBoards.map((b) => b.blockedValue)
  ok(`the Recompletion boards add up to it, Board 1 within its 300 DR limit (${budgets(0).join(' + ')})`, budgets(0).length === 3 && budgets(0).reduce((s, v) => s + v, 0) === 5644 && budgets(0)[0] <= 300 && saved.segments[0].recompletionTargetSubsidy === 5644)

  // Change the normal demand: Recompletion follows, the last board closes the gap.
  await phase(page, 'Normal')
  await set(row(page, 0).locator('[data-field="demand"]'), 700)
  await phase(page, 'Recompletion')
  ok('changing the normal demand to 700 moves Recompletion with it (5,444 DR)', (await row(page, 0).locator('[data-field="demand"]').inputValue()) === '700' && num(await row(page, 0).locator('[data-field="subsidy-needed"]').innerText()) === 5444)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(300)
  saved = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY))
  ok(`...and the boards still add up (${budgets(0).join(' + ')})`, budgets(0).reduce((s, v) => s + v, 0) === 5444)

  // The board editor's Recompletion card shows it, locked.
  await tab(page, 'Recompletion').click()
  await page.waitForTimeout(400)
  const demandField = page.locator('label', { hasText: 'Total demand (DR)' }).locator('input')
  ok('the Recompletion editor shows the same demand, locked', (await demandField.inputValue()) === '700' && (await demandField.isDisabled()))
  ok('...and its subsidy readout uses the Recompletion chase (6,144 - 700)', await page.getByText(/6,144 − 700 demand/).isVisible())

  // It survives a reload.
  await page.reload({ waitUntil: 'networkidle' })
  // (A reload stays on the tool's own page: /models/<name>.)
  await page.waitForTimeout(400)
  await step(page, 'setup').click()
  await phase(page, 'Recompletion')
  ok('after a reload Recompletion still follows the normal demand', (await row(page, 0).locator('[data-field="demand"]').inputValue()) === '700' && (await row(page, 0).locator('[data-field="demand"]').isDisabled()))
  ok('zero page errors', errors.length === 0)
  if (errors.length) console.log(errors.join('\n'))
  await browser.close()
}

// An older save whose Recompletion amount was typed separately.
{
  const board = (name, blockedValue) => ({ ...createBoard(name), blockedValue })
  const { browser, page, errors } = await launch({
    save: { segments: [{ name: 'Segment 1', targetSubsidy: 1548, boards: [board('Board 1', 150), board('Board 2', 1398)], recompletionTargetSubsidy: 3000, recompletionBoards: [board('Board 1', 150), board('Board 2', 1000), board('Board 3', 1850)] }] },
  })
  await openMerge(page)
  await step(page, 'setup').click()
  await phase(page, 'Recompletion')
  ok('an older save with its own Recompletion amount is brought in line with the normal demand (500 -> 5,644 DR)', (await row(page, 0).locator('[data-field="demand"]').inputValue()) === '500' && num(await row(page, 0).locator('[data-field="subsidy-needed"]').innerText()) === 5644)
  // (The demand is in the main table, the boards' budgets in the folded one under it.)
  // (The board budgets alone: the row of the main table holds other number fields - the effort in Brut Wins.)
  const cells = await page.locator('[data-testid="setup-budgets"] [data-setup-segment="0"] [data-field="budget"]').evaluateAll((els) => els.map((e) => e.value))
  ok(`its typed board budgets are kept; the last board closes the gap (${cells.join(' + ')})`, cells[0] === '150' && cells[1] === '1000' && cells[2] === '4494')
  ok('older save: zero page errors', errors.length === 0)
  await browser.close()
}

const fails = finish('Recompletion demand E2E')
process.exit(fails === 0 ? 0 : 1)
