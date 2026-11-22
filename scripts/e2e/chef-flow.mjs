// Browser end-to-end: THE CHEF FLOW (economist: "apply the logic of how we
// build the merge also to the chef. the flow and etc.").
//
// Five steps in the order the work is done, in place of nine flat tabs; a step
// shows what is typed or judged and folds the rest; what is wrong is shown in
// the step that puts it right; a run's summary leads, its detail is folded; the
// rarely used actions sit in one "More" menu; "Next" opens the next step at its
// top. Checked as a FIRST VISIT (folds as a visitor finds them), in a 1500 x 800
// window - the economist's - and at 1280.
// See helpers.mjs. Run: npx vite-node scripts/e2e/chef-flow.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BASE, createChecker, launch } from './helpers.mjs'

const { ok, finish } = createChecker()
const { browser, page, errors } = await launch({ folded: true })
await page.setViewportSize({ width: 1500, height: 800 })

async function openChef() {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Chef/ }).first().click()
  await page.getByTestId('chef-header').waitFor()
  await page.waitForTimeout(200)
}
const step = async (id) => {
  await page.locator(`[data-chef-step="${id}"]`).click()
  await page.waitForTimeout(250)
}
const set = async (locator, value) => {
  await locator.fill(String(value))
  await locator.blur()
  await page.waitForTimeout(150)
}
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ').trim()
const pageHeight = () => page.evaluate(() => document.documentElement.scrollHeight)
const fold = (id) => page.locator(`[data-collapsible="${id}"]`)
const isOpen = (id) => fold(id).evaluate((el) => el.open)
const more = async (name) => {
  await page.getByTestId('chef-more').click()
  await page.getByTestId('chef-more-panel').getByRole('menuitem', { name }).click()
  await page.waitForTimeout(250)
}
const blocksOn = async (id) => {
  const badge = page.locator(`[data-chef-step="${id}"] [data-step-blocks]`)
  return (await badge.count()) === 0 ? 0 : Number(await badge.innerText())
}

await openChef()

console.log('--- 1. The flow as a first visit finds it ---')
{
  const steps = await page.locator('[data-chef-step]').allInnerTexts()
  ok(`five steps, in the order the work is done (${steps.map((s) => s.replace(/\s+/g, ' ').trim()).join(' | ')})`, steps.length === 5 && /1\s*Event and players/.test(steps[0]) && /2\s*Ingredients and dishes/.test(steps[1]) && /3\s*Baskets/.test(steps[2]) && /4\s*Simulate/.test(steps[3]) && /5\s*Basket value/.test(steps[4]))
  ok('...and not the nine tabs there were (no Calendar, Segments, Blocker sources or Validation tab)', (await page.getByRole('button', { name: /^(Calendar|Segments|Blocker sources|Validation|Simulation)$/ }).count()) === 0)
  const purpose = await text(page.getByTestId('chef-step-purpose'))
  ok(`the step says what it is for ("${purpose}")`, /^Step 1 of 5 · when the event runs/.test(purpose))
  ok('the header holds the chef\'s name, whether it is saved, "More" and Save - and no list of chefs while there is one', (await page.getByTestId('chef-name').inputValue()) === 'Halloween chef' && (await text(page.getByTestId('chef-save-state'))) === 'Saved' && (await page.getByTestId('chef-picker').count()) === 0 && (await page.getByTestId('chef-save').isVisible()))
  ok('the rarely used actions are not in the bar', (await page.getByTestId('chef-header').getByRole('button', { name: /backup|Duplicate|Delete|New chef/ }).count()) === 0 && (await page.getByTestId('chef-header').getByRole('button').count()) === 3)
  await page.getByTestId('chef-more').click()
  const items = (await page.getByTestId('chef-more-panel').getByRole('menuitem').allInnerTexts()).map((t) => t.trim())
  ok(`...they are in the "More" menu (${items.join(' | ')})`, items.length === 7 && items[0] === 'New chef: blank' && items.includes('New chef: from the Thanksgiving chef') && items.includes('Duplicate this chef') && items.includes('Export backup') && items.includes('Import backup'))
  ok('...where the only chef cannot be deleted', await page.getByTestId('chef-more-panel').getByRole('menuitem', { name: 'Delete this chef' }).isDisabled())
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  ok('...and Escape closes it', (await page.getByTestId('chef-more-panel').count()) === 0)
  ok('step 1 shows the event and the segments side by side: 2 phases, 9 segments', (await page.locator('[data-testid="chef-phases"] tbody tr').count()) === 2 && (await page.locator('[data-testid="chef-segments"] tbody tr').count()) === 9 && /Runs .* to .*\./.test(await text(page.getByTestId('chef-event-dates'))))
  ok(`...on one screen: nothing to scroll (${await pageHeight()} px in a window of 800)`, (await pageHeight()) <= 800)
  ok('nothing is wrong with the Halloween chef, and no step says otherwise', (await page.locator('[data-step-blocks]').count()) === 0 && (await page.getByTestId('chef-step-findings').count()) === 0)
}

console.log('--- 2. Typing: a number is taken when the field is left; saved or not is said ---')
const firstRow = page.locator('[data-testid="chef-segments"] tbody tr').first()
{
  const epic = firstRow.locator('input[data-rate="epic"]')
  await epic.click()
  await epic.fill('')
  await page.keyboard.type('0.25')
  ok('a fraction can be typed in one go (0.25 baskets a day)', (await epic.inputValue()) === '0.25')
  await epic.blur()
  await page.waitForTimeout(150)
  ok('...it is taken when the field is left, and the header says "Unsaved changes"', (await epic.inputValue()) === '0.25' && (await text(page.getByTestId('chef-save-state'))) === 'Unsaved changes')
  const basic = firstRow.locator('input[data-rate="basic"]')
  const before = await basic.inputValue()
  await set(basic, '')
  ok(`an emptied field puts its value back (${before}): empty is never read as zero`, (await basic.inputValue()) === before)
  await page.getByTestId('chef-save').click()
  await page.waitForTimeout(200)
  ok('Save says when it was saved', /^Saved \d/.test(await text(page.getByTestId('chef-save-state'))))
  await openChef()
  ok('...and it is still there after the page is opened again', (await page.locator('[data-testid="chef-segments"] tbody tr').first().locator('input[data-rate="epic"]').inputValue()) === '0.25' && (await text(page.getByTestId('chef-save-state'))) === 'Saved')

  const shape = page.locator('[data-testid="chef-segments"] tbody tr').first().locator('select').nth(1)
  await shape.selectOption('ramp-up')
  await page.waitForTimeout(150)
  const effect = await text(page.locator('[data-shape-effect]').first())
  ok(`an activity shape other than Flat says what it does to the number of baskets ("${effect}"), and why that matters`, /^-5\.7% baskets$/.test(effect) && (await page.getByTestId('chef-shape-note').isVisible()))
  await shape.selectOption('flat')
  await page.waitForTimeout(150)
  ok('...and Flat says nothing', (await page.locator('[data-shape-effect]').count()) === 0 && (await page.getByTestId('chef-shape-note').count()) === 0)

  await set(page.getByTestId('chef-total-days'), 20)
  const finding = await text(page.getByTestId('chef-step-findings'))
  ok(`an event one day shorter than its phases: said at the top of the step, in plain words ("${finding}")`, /Needs a fix: The phases add up to 21 days, but the event runs 20 days\./.test(finding) && (await page.getByTestId('chef-phase-gap').isVisible()))
  ok('...and counted on the step\'s button', (await blocksOn('event')) === 1)
  await set(page.getByTestId('chef-total-days'), 21)
  ok('...and gone once it is put right', (await page.getByTestId('chef-step-findings').count()) === 0 && (await blocksOn('event')) === 0)

  await page.getByTestId('chef-add-phase').click()
  await page.waitForTimeout(200)
  ok('a new phase has no baskets yet: three things to fix on the Baskets step, one here (the days)', (await page.locator('[data-testid="chef-phases"] tbody tr').count()) === 3 && (await blocksOn('baskets')) === 3 && (await blocksOn('event')) === 1)
  await page.locator('[data-testid="chef-phases"] tbody tr').nth(2).getByRole('button', { name: /Remove/ }).click()
  await page.waitForTimeout(200)
  ok('...and removing it puts everything back', (await page.locator('[data-testid="chef-phases"] tbody tr').count()) === 2 && (await page.locator('[data-step-blocks]').count()) === 0)
}

console.log('--- 3. "Next" opens the next step at its top ---')
{
  await page.setViewportSize({ width: 1500, height: 500 })
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  ok('(the window is scrolled down first)', (await page.evaluate(() => window.scrollY)) > 0)
  await page.getByTestId('chef-next').click()
  await page.waitForTimeout(300)
  ok('the button at the bottom right goes to step 2, at its top', /^Step 2 of 5/.test(await text(page.getByTestId('chef-step-purpose'))) && (await page.evaluate(() => window.scrollY)) === 0)
  ok('...it names the step it goes to, and there is a way back', /Next: Baskets/.test(await text(page.getByTestId('chef-next'))) && /Event and players/.test(await text(page.getByTestId('chef-back'))))
  await page.setViewportSize({ width: 1500, height: 800 })
}

console.log('--- 4. Ingredients and dishes ---')
{
  ok('the ingredients and the recipes are side by side: 8 ingredients, 12 dishes', (await page.locator('[data-testid="chef-ingredients"] tbody tr').count()) === 8 && (await page.locator('[data-testid="chef-recipes"] tbody tr').count()) === 12)
  const fits = await page.getByTestId('chef-ingredients').evaluate((el) => el.parentElement.scrollWidth <= el.parentElement.clientWidth + 1)
  ok('...the ingredients table shows all of itself (no column cut off)', fits)
  ok('the dishes as cards are folded, with a line saying what is inside', !(await isOpen('chef-dish-cards-main')) && /12 dishes/.test(await text(fold('chef-dish-cards-main').locator('summary'))))
  const prize = page.getByTestId('chef-total-prize')
  ok('the prize for cooking every dish can be typed, one value a prize size (90 / 108 / 135)', (await prize.locator('input[data-tier="low"]').inputValue()) === '90' && (await prize.locator('input[data-tier="medium"]').inputValue()) === '108' && (await prize.locator('input[data-tier="high"]').inputValue()) === '135')
  const cell = page.locator('[data-testid="chef-recipes"] tbody tr').first().locator('input[type="number"]').first()
  const was = await cell.inputValue()
  await set(cell, Number(was) + 1)
  ok('a recipe is typed in the table', (await cell.inputValue()) === String(Number(was) + 1))
  await set(cell, was)
  await page.getByTestId('chef-add-dish').click()
  await page.waitForTimeout(150)
  const added = page.locator('[data-testid="chef-recipes"] tbody tr').nth(12)
  ok('a dish is added at the end of the list, and a dish that needs nothing is worth a look', (await page.locator('[data-testid="chef-recipes"] tbody tr').count()) === 13 && /Worth a look: "Dish 13" needs no ingredients at all\./.test(await text(page.getByTestId('chef-step-findings'))))
  await added.getByRole('button', { name: /Remove/ }).click()
  await page.waitForTimeout(150)
  ok('...and taken away again', (await page.locator('[data-testid="chef-recipes"] tbody tr').count()) === 12 && (await page.getByTestId('chef-step-findings').count()) === 0)
  await page.getByTestId('chef-dish-list').locator('[data-option="recompletion"]').click()
  await page.waitForTimeout(150)
  ok('the Recompletion dishes are the other list of the same table, with their demand caps', (await page.locator('[data-testid="chef-recipes"] tbody tr').count()) === 13 && (await page.getByTestId('chef-recompletion-caps').isVisible()))
  await page.getByTestId('chef-dish-list').locator('[data-option="main"]').click()
}

console.log('--- 5. Baskets ---')
{
  await step('baskets')
  const cards = page.locator('[data-testid="chef-baskets"] [data-basket]')
  ok('one phase is in view, its three baskets side by side', (await cards.count()) === 3 && (await cards.nth(0).getAttribute('data-basket')) === 'basic-phase1' && (await cards.nth(2).getAttribute('data-basket')) === 'epic-phase1')
  const sameRow = await cards.evaluateAll((els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().top / 10))).size === 1)
  ok('...on one row', sameRow)
  const weightOf = async (basket, ingredient) => page.locator(`[data-basket="${basket}"] [data-weight-row="${ingredient}"] input`).first().inputValue()
  ok('the semi-blocker (Pumpkin) has a weight of 0 in every basket of the first phase', (await weightOf('basic-phase1', 'pumpkin')) === '0' && (await weightOf('rare-phase1', 'pumpkin')) === '0' && (await weightOf('epic-phase1', 'pumpkin')) === '0')
  await page.getByTestId('chef-basket-phase').locator('[data-option="phase2"]').click()
  await page.waitForTimeout(150)
  ok('...and opens in the second, in all three', (await cards.count()) === 3 && Number(await weightOf('basic-phase2', 'pumpkin')) > 0 && Number(await weightOf('rare-phase2', 'pumpkin')) > 0 && Number(await weightOf('epic-phase2', 'pumpkin')) > 0)
  const real = await weightOf('basic-phase2', 'sugar')
  await page.getByTestId('chef-basket-odds').locator('[data-option="pricing"]').click()
  await page.waitForTimeout(150)
  ok('the pricing odds are the other table of the same baskets, and the step says who reads them', /Pricing odds are only read by the basket value of step 5/.test(await text(page.getByTestId('chef-baskets-head'))) && (await weightOf('basic-phase2', 'sugar')) !== '' && typeof real === 'string')
  await page.getByTestId('chef-basket-odds').locator('[data-option="gameplay"]').click()
  await page.getByTestId('chef-basket-phase').locator('[data-option="phase1"]').click()
  await page.waitForTimeout(150)

  ok('sales and events are folded, and the fold says there are none', !(await isOpen('chef-grants')) && /Nothing: every ingredient comes from a basket/.test(await text(fold('chef-grants').locator('summary'))))
  ok('where each blocker comes from is folded, and names them', !(await isOpen('chef-blockers')) && /Pumpkin, Green Jelly/.test(await text(fold('chef-blockers').locator('summary'))))
  await fold('chef-grants').locator('summary').click()
  await page.getByTestId('chef-add-grant').click()
  await page.waitForTimeout(150)
  const grant = page.locator('[data-testid="chef-grants"] tbody tr').first()
  await grant.locator('select').selectOption('green-jelly')
  await set(grant.getByRole('spinbutton', { name: 'Day' }), 3)
  await set(grant.getByRole('spinbutton', { name: 'Amount' }), 15)
  await set(grant.getByRole('spinbutton', { name: 'Share of players, in %' }), 40)
  ok('a sale is one line: day, ingredient, amount, share of players', (await page.locator('[data-testid="chef-grants"] tbody tr').count()) === 1 && /20 Oct 2026|Oct 20, 2026/.test(await text(grant)))
  await fold('chef-blockers').locator('summary').click()
  await page.waitForTimeout(150)
  const jelly = await text(page.locator('[data-blocker="green-jelly"]'))
  ok('...and the blocker\'s sources now list it beside the baskets, with "not yet" where a basket does not give it', /Basic basket, Phase 1.*not yet/.test(jelly) && /Sale or event.*40% of players.*15/.test(jelly))
  await fold('chef-grants').locator('summary').click()
  await page.waitForTimeout(150)
  ok('folded again, the fold says what it holds', /1 line: Green Jelly/.test(await text(fold('chef-grants').locator('summary'))))
  await fold('chef-grants').locator('summary').click()
  await page.locator('[data-testid="chef-grants"] tbody tr').first().getByRole('button', { name: /Remove/ }).click()
  await page.waitForTimeout(150)
  ok('(the sale is taken away again)', (await page.getByTestId('chef-grants').count()) === 0)
  ok(`the step is ${await pageHeight()} px tall with both folds open (it was 1,722 as a tab)`, (await pageHeight()) < 1722)
}

console.log('--- 6. Simulate: one button, the summary leads, the rest is folded ---')
let firstSummary = ''
{
  await step('simulate')
  ok('before a run there is one button, and a line saying what it plays', (await page.getByTestId('chef-run').isEnabled()) && /300 players a segment · all 9 segments · the dishes · a player cooks whatever they can/.test(await text(page.getByTestId('chef-run-plays'))) && /Nothing has been simulated yet/.test(await text(page.locator('main'))))
  ok('...what is played is changed in a fold', !(await page.locator('[data-collapsible="chef-run-options"]').evaluate((el) => el.open)) && (await page.getByTestId('chef-run-seed').isHidden()))
  ok(`the page is one screen (${await pageHeight()} px)`, (await pageHeight()) <= 800)
  await page.locator('[data-collapsible="chef-run-options"] > summary').click()
  await set(page.getByTestId('chef-run-players'), 120)
  await set(page.getByTestId('chef-run-seed'), 7)
  ok('the line follows what was changed', /120 players a segment/.test(await text(page.getByTestId('chef-run-plays'))))
  await page.getByTestId('chef-run').click()
  await page.getByTestId('chef-sim-summary').waitFor({ timeout: 120000 })
  await page.waitForTimeout(300)
  const rows = page.locator('[data-testid="chef-sim-summary"] tbody tr')
  firstSummary = await text(page.getByTestId('chef-sim-summary').locator('tbody'))
  ok(`after a run the summary leads: one row a segment (${await text(rows.first())})`, (await rows.count()) === 9 && /^P25 of DAU \d+ of 12 \d+ to \d+ \d+% ± [\d.]+ .*\d+ days? Dish by dish$/.test(await text(rows.first())))
  ok('...it says these are simulated players and that one differs from the next', /one player differs from the next, and another run gives slightly different figures/.test(await text(page.getByTestId('chef-sim-legend'))))
  const heads = await page.locator('[data-testid="chef-sim-summary"] thead th[title]').evaluateAll((els) => els.map((el) => el.getAttribute('title')))
  ok('...every figure says what it means when pointed at, in plain words (no "P10", "median" or "Monte Carlo" on the page)', heads.length === 5 && heads.every((t) => t.length > 30) && !/\bP10\b|median|Monte Carlo|percentile|\bseed\b|\bruns\b/i.test(await text(page.locator('main'))))
  const folds = ['chef-sim-curves', 'chef-sim-overlay', 'chef-sim-detail', 'chef-sim-whatif', 'chef-sim-takes', 'chef-checks']
  const states = []
  for (const id of folds) states.push((await fold(id).count()) === 1 && !(await isOpen(id)))
  ok('the day-by-day charts, the segment in detail, the what-ifs and the list of checks are folded', states.every(Boolean))
  ok(`...so the result is ${await pageHeight()} px tall`, (await pageHeight()) < 1500)
  ok('the list of checks says in its fold what it holds', /3 good to know/.test(await text(fold('chef-checks').locator('summary'))))

  await rows.nth(2).getByRole('button', { name: 'Dish by dish' }).click()
  await page.waitForTimeout(600)
  ok('"Dish by dish" on a row opens that segment\'s detail', (await isOpen('chef-sim-detail')) && /^P75 of DAU: dish by dish/.test(await text(fold('chef-sim-detail').locator('summary'))) && (await page.locator('[data-testid="chef-dish-timing"] tbody tr').count()) === 12)
  ok('...with what stops a player, what is left over and which basket gives the most', /What stops a player/.test(await text(fold('chef-sim-detail'))) && /Left over when the event ends/.test(await text(fold('chef-sim-detail'))) && /Epic basket, Phase 1/.test(await text(fold('chef-sim-detail'))))

  await fold('chef-sim-curves').locator('summary').click()
  await page.waitForTimeout(200)
  const bars = await page.locator('[data-curve]').first().locator('.bg-gradient-to-t').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
  ok(`the day-by-day chart is drawn: 9 segments, 21 days each, bars up to ${Math.round(Math.max(...bars))} px`, (await page.locator('[data-curve]').count()) === 9 && bars.length === 21 && Math.max(...bars) > 30)

  await fold('chef-sim-whatif').locator('summary').click()
  await page.getByTestId('chef-whatif-run').click()
  await page.getByTestId('chef-whatif-chart').waitFor({ timeout: 120000 })
  const whatIf = await page.getByTestId('chef-whatif-chart').locator('.rounded-t-sm').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
  ok(`"more or fewer baskets" plays the event seven ways and draws them: fewer baskets, a lower bar (bars ${whatIf.map((h) => Math.round(h)).join(', ')} px)`, whatIf.length === 7 && Math.max(...whatIf) > 20 && whatIf[0] < whatIf[6] && /as typed/.test(await text(page.getByTestId('chef-whatif-chart'))))
  await fold('chef-sim-takes').locator('summary').click()
  await page.getByTestId('chef-solve').click()
  await page.waitForTimeout(300)
  const takes = await text(page.getByTestId('chef-solve-result'))
  ok(`"what it would take" answers in baskets a day ("${takes}")`, /It takes about [\d.]+ times what P75 of DAU opens now: [\d.]+ Basic, [\d.]+ Rare, [\d.]+ Epic baskets a day\./.test(takes))
  await fold('chef-checks').locator('summary').click()
  await page.waitForTimeout(150)
  ok('the full list of checks leads to the step of each', (await fold('chef-checks').locator('[data-finding="info"]').count()) === 3 && (await fold('chef-checks').getByRole('button', { name: 'Step 2' }).count()) === 3)

  await page.getByTestId('chef-run').click()
  await page.waitForTimeout(1500)
  ok('the same players played again give the same figures', (await text(page.getByTestId('chef-sim-summary').locator('tbody'))) === firstSummary)
}

console.log('--- 7. A run is kept, and marked out of date once the event has changed ---')
{
  await step('event')
  const basic = page.locator('[data-testid="chef-segments"] tbody tr').first().locator('input[data-rate="basic"]')
  const was = await basic.inputValue()
  await set(basic, Number(was) + 3)
  await step('simulate')
  ok('back on the Simulate step the run is still there', (await page.locator('[data-testid="chef-sim-summary"] tbody tr').count()) === 9)
  ok('...and says it is out of date, in words, instead of passing for the event as it is now', /Out of date: the event was changed after this run/.test(await text(page.getByTestId('chef-sim-out-of-date'))))
  await page.getByTestId('chef-run').click()
  await page.waitForTimeout(1500)
  ok('a new run is current, and the segment that opens more baskets cooks more', (await page.getByTestId('chef-sim-out-of-date').count()) === 0 && (await text(page.getByTestId('chef-sim-summary').locator('tbody'))) !== firstSummary)
  await step('event')
  await set(page.locator('[data-testid="chef-segments"] tbody tr').first().locator('input[data-rate="basic"]'), was)
}

console.log('--- 8. Basket value ---')
{
  await step('value')
  const heights = await page.locator('[data-testid="chef-value-chart"] [data-bar]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
  ok(`the day-by-day chart is drawn - it was blank as a tab: ${heights.length} bars, ${Math.round(Math.min(...heights))} to ${Math.round(Math.max(...heights))} px`, heights.length === 63 && Math.min(...heights) > 10 && Math.max(...heights) > 100)
  ok('...and says it is a sharing-out of the prizes, not a price', /it is not a price/.test(await text(page.locator('main'))))
  const table = page.getByTestId('chef-value-table')
  const low = await text(table.locator('tbody tr').first())
  await page.getByTestId('chef-value-tier').locator('[data-option="high"]').click()
  await page.waitForTimeout(150)
  const high = await text(table.locator('tbody tr').first())
  const num = (s) => Number(s.match(/[\d.]+$/)[0])
  ok(`the figures are also in a table, one line a phase, and follow the prize size (an Epic basket in Phase 1: ${num(low)} at low, ${num(high)} at high)`, (await table.locator('tbody tr').count()) === 2 && Math.abs(num(high) / num(low) - 1.5) < 0.01)
  await page.getByTestId('chef-value-tier').locator('[data-option="low"]').click()
  ok('what one of each ingredient counts for is folded', !(await isOpen('chef-unit-values')))
  ok('"one more basket" says before it is run that its figure is rough, and why', /A rough figure: in the second play the baskets opened after the extra one get other luck too/.test(await text(page.getByTestId('chef-more-caveat'))))
  await page.getByTestId('chef-more-run').click()
  await page.getByTestId('chef-more-result').waitFor({ timeout: 120000 })
  const result = await text(page.getByTestId('chef-more-result'))
  ok(`...and answers in a sentence ("${result.slice(0, 110)}...")`, /One more Basic basket for P25 of DAU on .* changes the prizes a player ends with by [+-][\d.]+ on average .* 300 players, played twice\./.test(result))
  ok(`the step is ${await pageHeight()} px tall (it was 1,567 as a tab)`, (await pageHeight()) < 1000)
  ok('the last step has a way back and no "Next"', (await page.getByTestId('chef-next').count()) === 0 && (await page.getByTestId('chef-back').isVisible()))
}

console.log('--- 9. Several chefs, and a backup ---')
{
  await more('New chef: from the Thanksgiving chef')
  ok('a new chef made from the Thanksgiving data opens on step 1, with its own 14 days', (await page.getByTestId('chef-name').inputValue()) === 'Thanksgiving chef' && /^Step 1 of 5/.test(await text(page.getByTestId('chef-step-purpose'))) && (await page.getByTestId('chef-total-days').inputValue()) === '14')
  ok('...and now there is a list of chefs in the header', (await page.getByTestId('chef-picker').locator('option').count()) === 2)
  await step('simulate')
  ok('it has no simulation of its own yet', /Nothing has been simulated yet/.test(await text(page.locator('main'))) && (await page.getByTestId('chef-sim-summary').count()) === 0)
  await page.getByTestId('chef-picker').selectOption({ label: 'Halloween chef' })
  await page.waitForTimeout(250)
  ok('...while the Halloween chef still has its last run', (await page.locator('[data-testid="chef-sim-summary"] tbody tr').count()) === 9)

  await more('New chef: blank')
  ok('a blank chef starts with nothing to simulate, and says what is missing where it is put right', (await blocksOn('baskets')) === 3 && (await page.locator('[data-testid="chef-segments"] tbody tr').count()) === 1)
  await step('simulate')
  const missing = await text(page.getByTestId('chef-sim-missing'))
  ok(`the Simulate step lists what needs a fix, with the way to its step ("${missing.slice(0, 96)}...")`, /3 things need a fix before this event can ship/.test(missing) && /No Basic basket is set for Phase 1/.test(missing) && (await page.getByTestId('chef-sim-missing').getByRole('button', { name: 'Step 3' }).count()) === 3)
  ok('...and the button waits for a segment', (await page.getByTestId('chef-run').isDisabled()) && /No segment to play yet \(step 1\)/.test(await text(page.getByTestId('chef-run-plays'))))
  await page.getByTestId('chef-sim-missing').getByRole('button', { name: 'Step 3' }).first().click()
  await page.waitForTimeout(250)
  ok('the link goes to the Baskets step, where the same three lines are in sight', /^Step 3 of 5/.test(await text(page.getByTestId('chef-step-purpose'))) && (await page.getByTestId('chef-step-findings').locator('[data-finding="block"]').count()) === 3)
  await page.getByTestId('chef-add-basket').click()
  await page.waitForTimeout(200)
  ok('"Add a basket" adds the first type the phase has none of', (await page.locator('[data-basket="basic-phase1"]').count()) === 1 && /No Rare basket/.test(await text(page.getByTestId('chef-step-findings'))) && !/No Basic basket/.test(await text(page.getByTestId('chef-step-findings'))))

  const [download] = await Promise.all([page.waitForEvent('download'), more('Export backup')])
  const file = path.join(os.tmpdir(), `chef-backup-e2e-${Date.now()}.json`)
  await download.saveAs(file)
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'))
  ok(`a backup is one file with every chef (${download.suggestedFilename()}: ${backup.configs.map((c) => c.name).join(', ')})`, /^chef-backup-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()) && backup.configs.length === 3)

  page.once('dialog', (dialog) => dialog.accept())
  await more('Delete this chef')
  ok('deleting a chef asks first, then leaves the others', (await page.getByTestId('chef-picker').locator('option').count()) === 2)
  const junk = path.join(os.tmpdir(), `chef-junk-e2e-${Date.now()}.json`)
  fs.writeFileSync(junk, JSON.stringify({ segments: [] }))
  await page.getByTestId('chef-import-file').setInputFiles(junk)
  await page.waitForTimeout(300)
  ok('a file that is not a Chef backup is refused in words, and nothing changes', /That file is not a Chef backup\. Nothing was changed\./.test(await text(page.getByTestId('chef-import-error'))) && (await page.getByTestId('chef-picker').locator('option').count()) === 2)
  await page.getByTestId('chef-import-file').setInputFiles(file)
  await page.waitForTimeout(400)
  ok('the backup brings all three chefs back', (await page.getByTestId('chef-picker').locator('option').count()) === 3 && (await page.getByTestId('chef-import-error').count()) === 0 && (await text(page.getByTestId('chef-save-state'))) === 'Saved')
  fs.rmSync(file, { force: true })
  fs.rmSync(junk, { force: true })
}

console.log('--- 10. The other buttons: copies, a new ingredient, the Recompletion round ---')
{
  await page.getByTestId('chef-picker').selectOption({ label: 'Halloween chef' })
  await page.waitForTimeout(250)
  await more('Duplicate this chef')
  ok('a copy of a chef is a chef of its own, named as a copy', (await page.getByTestId('chef-name').inputValue()) === 'Halloween chef copy' && (await page.getByTestId('chef-picker').locator('option').count()) === 4)
  await step('dishes')
  await page.getByTestId('chef-add-ingredient').click()
  await page.waitForTimeout(200)
  const added = page.locator('[data-testid="chef-ingredients"] tbody tr').nth(8)
  await added.getByRole('textbox', { name: 'Ingredient name' }).fill('Cinnamon')
  await page.waitForTimeout(150)
  ok('a new ingredient gets a row, and a column in the recipes', (await page.locator('[data-testid="chef-ingredients"] tbody tr').count()) === 9 && /Cinnamon/i.test(await text(page.locator('[data-testid="chef-recipes"] thead'))))
  ok('...and is good for nothing yet: no dish needs it and no basket gives it, which is worth a look', /Worth a look: "Cinnamon" is needed by no dish and given by no basket\./.test(await text(page.getByTestId('chef-step-findings'))))
  await page.locator('[data-testid="chef-recipes"] tbody tr').first().getByRole('button', { name: /^Duplicate/ }).click()
  await page.waitForTimeout(150)
  ok('a copy of a dish goes to the end of the list', (await page.locator('[data-testid="chef-recipes"] tbody tr').count()) === 13 && (await page.locator('[data-testid="chef-recipes"] tbody tr').nth(12).getByRole('textbox', { name: 'Dish name' }).inputValue()) === 'Candied poison apple copy')
  await step('baskets')
  const row = page.locator('[data-basket="basic-phase1"] [data-weight-row]').nth(8)
  ok('every basket has a row for the new ingredient, at a weight of 0', (await page.locator('[data-basket="basic-phase1"] [data-weight-row]').count()) === 9 && /Cinnamon/.test(await text(row)) && (await row.locator('input').first().inputValue()) === '0')
  await set(row.locator('input').first(), 100)
  ok('...and it can be given a weight there (it could not, in a basket that already existed)', (await row.locator('input').first().inputValue()) === '100' && /9\.1%/.test(await text(row)))
  await page.locator('[data-testid="chef-baskets"] [data-basket]').first().locator('xpath=ancestor::div[contains(@class,"rounded-3xl")][1]').getByRole('button', { name: /^Duplicate/ }).click()
  await page.waitForTimeout(200)
  ok('a copy of a basket sits beside it', (await page.locator('[data-testid="chef-baskets"] [data-basket]').count()) === 4)
  await page.locator('[data-testid="chef-baskets"] [data-basket]').nth(1).locator('xpath=ancestor::div[contains(@class,"rounded-3xl")][1]').getByRole('button', { name: /^Remove/ }).click()
  await page.waitForTimeout(200)
  ok('...and is taken away again', (await page.locator('[data-testid="chef-baskets"] [data-basket]').count()) === 3)
  await step('dishes')
  await page.locator('[data-testid="chef-ingredients"] tbody tr').nth(8).getByRole('button', { name: /^Remove/ }).click()
  await page.waitForTimeout(200)
  await step('baskets')
  ok('removing the ingredient takes it out of the baskets too', (await page.locator('[data-basket="basic-phase1"] [data-weight-row]').count()) === 8 && !/Cinnamon/.test(await text(page.locator('[data-testid="chef-baskets"]'))))

  await step('simulate')
  await page.locator('[data-collapsible="chef-run-options"] > summary').click()
  await page.getByTestId('chef-run-dishes').locator('[data-option="recompletion"]').click()
  await page.getByTestId('chef-run-strategy').selectOption('prize-first')
  await page.getByTestId('chef-run-segments').getByRole('button', { name: 'P25 of DAU' }).click()
  await set(page.getByTestId('chef-run-players'), 60)
  const plays = await text(page.getByTestId('chef-run-plays'))
  ok(`the line says what will be played ("${plays}")`, /60 players a segment · 8 of 9 segments · the Recompletion dishes · a player goes for the biggest prize first/.test(plays))
  await page.getByTestId('chef-run').click()
  await page.getByTestId('chef-sim-summary').waitFor({ timeout: 120000 })
  await page.waitForTimeout(300)
  ok('the Recompletion round is played the same way: eight segments, twelve dishes, and the panel says which round it is', (await page.locator('[data-testid="chef-sim-summary"] tbody tr').count()) === 8 && /of 12/.test(await text(page.locator('[data-testid="chef-sim-summary"] tbody tr').first())) && /The Recompletion round, simulated/.test(await text(page.locator('main'))))
  page.once('dialog', (dialog) => dialog.accept())
  await more('Delete this chef')
  ok('(the copy is deleted again)', (await page.getByTestId('chef-picker').locator('option').count()) === 3)
}

console.log('--- 11. Nothing wider than its window, no label on two lines ---')
{
  await page.getByTestId('chef-picker').selectOption({ label: 'Halloween chef' })
  await page.waitForTimeout(250)
  for (const width of [1500, 1280]) {
    await page.setViewportSize({ width, height: 800 })
    const wide = []
    const wrapped = []
    for (const id of ['event', 'dishes', 'baskets', 'simulate', 'value']) {
      await step(id)
      const m = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        window: window.innerWidth,
        labels: [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0 && b.innerText.trim() && b.getBoundingClientRect().height > 46).map((b) => b.innerText.trim().slice(0, 30)),
      }))
      if (m.page > m.window + 1) wide.push(`${id} ${m.page}`)
      wrapped.push(...m.labels.map((l) => `${id}: ${l}`))
    }
    ok(`at ${width} px no step is wider than its window${wide.length ? ` (${wide.join(', ')})` : ''}`, wide.length === 0)
    ok(`...and no button label runs over two lines${wrapped.length ? ` (${wrapped.slice(0, 4).join(' | ')})` : ''}`, wrapped.length === 0)
  }
}

ok('zero page errors across the whole session', errors.length === 0)
await browser.close()
process.exit(finish('THE CHEF FLOW') === 0 ? 0 : 1)
