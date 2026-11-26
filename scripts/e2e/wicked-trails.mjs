// Wicked Trails in the browser, step by step as a first visit finds it: segments taken from a generic set (one
// segment's effort following another's), the rules, the tiers, the prizes beside their target worth, the mock played
// to the end, and the export downloaded and read back.
// Run: npx vite-node scripts/e2e/wicked-trails.mjs
import ExcelJS from 'exceljs'
import { BASE, createChecker, launch } from './helpers.mjs'

const { ok, finish } = createChecker()
const { browser, page, errors } = await launch()
page.on('dialog', (d) => d.accept())
const set = async (locator, value) => {
  await locator.fill(String(value))
  await locator.blur()
  await page.waitForTimeout(200)
}
const text = async (locator) => (await locator.innerText()).trim()

// A generic segment set, 2D_Levels, three bands with their effort.
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByRole('link', { name: /Economy/ }).first().click()
await page.getByTestId('economy-header').waitFor()
await page.locator('[data-tab="segments"]').click()
await page.locator('[data-seg-view="build"]').click()
await set(page.getByTestId('economy-seg-feature'), '')
await set(page.getByTestId('economy-seg-cuts'), '9, 18')
await page.getByTestId('economy-set-name').fill('2D_Levels')
await page.getByTestId('economy-set-save').click()
await page.waitForTimeout(300)
await page.locator('[data-seg-view="sets"]').click()
const effort = (id) => page.locator(`[data-set-segment="${id}"] [data-set-effort]`)
await set(effort('BW_0_9'), 100)
await set(effort('BW_9_18'), 200)
await set(effort('BW_18_Plus'), 300)

// Step 1: the segments.
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByRole('link', { name: /Wicked Trails/ }).first().click()
await page.getByTestId('wt-header').waitFor()
const steps = (await page.locator('[data-step]').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim())
ok(`a first visit starts at step 1 of six (${steps.join(' | ')})`, steps.length === 6 && (await page.locator('[data-step="segments"]').getAttribute('aria-current')) === 'step' && /step 1 of 6/i.test(await text(page.getByTestId('wt-step-head'))))
ok('the step says what to do and what is still needed', /Take the segments from a segment set/.test(await text(page.getByTestId('wt-step-purpose'))) && /Take the segments from a segment set/.test(await text(page.getByTestId('wt-step-missing'))))
const picker = page.getByTestId('wt-segment-set')
await picker.selectOption(await picker.locator('option', { hasText: '2D_Levels' }).getAttribute('value'))
await page.waitForTimeout(300)
const names = await page.locator('[data-wt-segment] td:nth-child(2) div:first-child').allInnerTexts()
ok(`the set's segments, named Wicked_Trails_, with their efforts (${names.join(', ')})`, names.length === 3 && names[0] === 'Wicked_Trails_BW_0_9' && (await page.locator('[data-wt-segment="2"] [data-field="effort-bw"]').inputValue()) === '300')
// Segment 2 follows segment 1, x 1.5.
await page.locator('[data-wt-segment="1"] [data-field="effort-mode"]').selectOption({ label: 'x Wicked_Trails_BW_0_9' })
await set(page.locator('[data-wt-segment="1"] [data-field="effort-factor"]'), 1.5)
ok(`a segment's effort as a factor of another: 100 x 1.5 (${await text(page.locator('[data-wt-segment="1"] [data-field="effort-value"]'))})`, (await text(page.locator('[data-wt-segment="1"] [data-field="effort-value"]'))) === '= 150')
await set(page.locator('[data-field="all-silver"]'), 2)
await set(page.locator('[data-field="all-gold"]'), 3)
ok('"Same for every segment" fills silver and gold DR per Brut Win', (await page.locator('[data-wt-segment="2"] [data-field="gold-per-bw"]').inputValue()) === '3' && (await page.locator('[data-wt-segment="0"] [data-field="silver-per-bw"]').inputValue()) === '2')
ok('step 1 is done (ticked), nothing more needed', (await page.locator('[data-step="segments"]').getAttribute('data-done')) === 'true' && (await page.getByTestId('wt-step-missing').count()) === 0)
await set(page.locator('[data-wt-segment="0"] [data-field="effort-bw"]'), 120)
ok('the follower follows: 120 x 1.5 = 180', (await text(page.locator('[data-wt-segment="1"] [data-field="effort-value"]'))) === '= 180')
await set(page.locator('[data-wt-segment="0"] [data-field="effort-bw"]'), 100)

// Step 2: the rules, reached with Next.
await page.getByTestId('wt-next').click()
await page.waitForTimeout(250)
ok('Next leads to the rules, which ask for the ROE', (await page.locator('[data-step="rules"]').getAttribute('aria-current')) === 'step' && /ROE/.test(await text(page.getByTestId('wt-step-missing'))))
await set(page.locator('[data-rule="roe"]'), 1)
await set(page.locator('[data-rule="easyShare"]'), 50)
ok('the rules are done', (await page.locator('[data-step="rules"]').getAttribute('data-done')) === 'true')

// Step 3: the tiers.
await page.getByTestId('wt-next').click()
await page.waitForTimeout(250)
await set(page.locator('[data-tier-count="easy"]'), 2)
await set(page.locator('[data-tier-count="hard"]'), 2)
const target = (lane, i) => text(page.locator(`[data-tier="${lane}-${i}"] [data-field="target"]`))
const dr = (lane, i) => text(page.locator(`[data-tier="${lane}-${i}"] [data-field="dr"]`))
ok('easy tiers: 50 silver each, 12.5 earned, 80% kept: 10', (await dr('easy', 0)) === '50' && (await target('easy', 0)) === '10' && (await target('easy', 1)) === '10')
ok('hard tiers: 150 gold each; 25 while sharing and 50 alone, 60% kept: 15 and 30', (await dr('hard', 0)) === '150' && (await target('hard', 0)) === '15' && (await target('hard', 1)) === '30')

// Step 4: the prizes.
await page.getByTestId('wt-next').click()
await page.waitForTimeout(250)
ok('the prizes step names every prize still to type (5)', (await page.locator('[data-testid="wt-step-missing"] li').count()) === 5)
// A prize built from its parts, not typed: Undo 40 -> free_undo:40.
await page.locator('[data-prize-build="easy-0"]').click()
await page.waitForTimeout(200)
const builder = (place) => page.locator(`[data-prize-builder="${place}"]`)
await set(builder('easy-0').locator('[data-builder-field="undo"]'), 40)
ok(`the builder writes the text from the parts (${await text(page.locator('[data-prize-text="easy-0"]'))})`, (await text(page.locator('[data-prize-text="easy-0"]'))) === 'free_undo:40')
ok(`a prize shows its worth and how far from the target (${await text(page.locator('[data-prize-gap="easy-0"]'))})`, /^10 \(0, 0%\)$/.test(await text(page.locator('[data-prize-gap="easy-0"]'))))
await builder('easy-0').locator('[data-builder-input="easy-0-preset"]').fill('puzzle_gameplay_20')
await builder('easy-0').locator('[data-builder-add="easy-0-preset"]').click()
await page.waitForTimeout(200)
ok(`a preset picked from the economy's list joins it (${await text(page.locator('[data-prize-text="easy-0"]'))})`, (await text(page.locator('[data-prize-text="easy-0"]'))) === 'free_undo:40+preset:puzzle_gameplay_20')
await builder('easy-0').locator('[data-builder-input="easy-0-preset"]').fill('not_a_preset')
await builder('easy-0').locator('[data-builder-add="easy-0-preset"]').click()
ok('a key not on the list is not taken, and it says so', /not on the Economy page's list/.test(await text(builder('easy-0'))) && (await text(page.locator('[data-prize-text="easy-0"]'))) === 'free_undo:40+preset:puzzle_gameplay_20')
await builder('easy-0').locator('[data-builder-chip="preset"] button').click()
await builder('easy-0').locator('[data-builder-field="chest"]').selectOption('silver')
await page.waitForTimeout(200)
ok(`a part removed, a chest picked (${await text(page.locator('[data-prize-text="easy-0"]'))})`, (await text(page.locator('[data-prize-text="easy-0"]'))) === 'chest:silver(free_undo:40)')
await builder('easy-0').locator('[data-builder-field="chest"]').selectOption('')
await page.locator('[data-prize-build="easy-0"]').click()
const build = async (place, fields) => {
  await page.locator(`[data-prize-build="${place}"]`).click()
  for (const [field, v] of Object.entries(fields)) await set(builder(place).locator(`[data-builder-field="${field}"]`), v)
  await page.locator(`[data-prize-build="${place}"]`).click()
}
await build('easy-1', { wild: 4 })
await build('hard-0', { wild: 6 })
await build('hard-1', { wild: 12 })
// The Final Prize typed by hand, the way it was before.
await page.locator('[data-prize-build="final"]').click()
await builder('final').locator('[data-builder-by-hand="final"]').click()
await set(builder('final').locator('[data-builder-text-input="final"]'), 'free_wild:20+free_undo:80')
await page.locator('[data-prize-build="final"]').click()
ok(`the Final Prize: pool 35, worth to aim for 70 (${await text(page.locator('[data-prize-gap="final"]'))})`, (await text(page.locator('[data-field="pool"]'))) === '35' && /^70 /.test(await text(page.locator('[data-prize-gap="final"]'))))
ok('every prize typed: the step is done', (await page.locator('[data-step="prizes"]').getAttribute('data-done')) === 'true')
await page.locator('[data-wt-chip="1"]').click()
await page.waitForTimeout(200)
ok('the follower segment: the base\'s prize x 1.5 and its target', (await text(page.locator('[data-prize-text="easy-0"]'))) === 'free_undo:60' && (await target('easy', 0)) === '15')

// Step 5: the mock, for the base.
await page.getByTestId('wt-next').click()
await page.waitForTimeout(200)
await page.locator('[data-wt-chip="0"]').click()
await page.getByTestId('wt-mock-bw').fill('30')
await page.waitForTimeout(200)
const bar = (id) => text(page.locator(`[data-mock-bar="${id}"]`))
ok(`after 30 Brut Wins: easy tier 1 done, 10 of 50 into tier 2; hard 90 of 150 (${await bar('easy-1')}, ${await bar('hard-0')})`, (await bar('easy-0')) === '' && (await bar('easy-1')) === '10/50' && (await bar('hard-0')) === '90/150' && (await text(page.getByTestId('wt-mock-lanes-done'))) === '0/2')
await page.getByTestId('wt-mock-bw').fill('100')
await page.waitForTimeout(200)
ok('after the whole effort both lanes are done: 2/2', (await text(page.getByTestId('wt-mock-lanes-done'))) === '2/2')

// Step 6: the export.
await page.getByTestId('wt-next').click()
await page.waitForTimeout(250)
await page.getByTestId('wt-start-date').fill('2026-11-16')
await page.waitForTimeout(200)
ok(`the file is named as the example (${await text(page.getByTestId('wt-file-name'))})`, (await text(page.getByTestId('wt-file-name'))) === 't_Promo_st_WickedTrail_n_WickedTrail_d_20261116.xlsx')
const cell = (column, which = 'ops') => text(page.locator(`[data-export-column="${column}"] [data-export-${which}]`))
ok(`the row shows the trigger and the chest (${await cell('$_Script->RightMilestone_1_Res')})`, (await cell('$_Script->RightMilestone_1_Res')) === 'chest:silver(trigger:wicked_trails_silver_tier2+free_wild:4)')
ok(`RC: 50% more a tier (${await cell('$_Script->LeftMilestone_1_Req', 'rc')})`, (await cell('$_Script->LeftMilestone_1_Req')) === '300' && (await cell('$_Script->LeftMilestone_1_Req', 'rc')) === '450')
const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('wt-download').click()])
const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(await download.path())
const sheets = wb.worksheets.map((w) => w.name)
const ops = wb.getWorksheet('Congif OPS')
ok(`the workbook: the example's three sheets, a row per segment (${sheets.join(', ')}; ${ops.rowCount - 1} rows)`, download.suggestedFilename() === 't_Promo_st_WickedTrail_n_WickedTrail_d_20261116.xlsx' && sheets.join('|') === 'segments|Congif OPS|Config RC OPS' && ops.rowCount === 4 && ops.getRow(1).getCell(1).value === 'Segment' && ops.getRow(2).getCell(1).value === 'def_Wicked_Trails_BW_0_9')

// Kept.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(300)
ok('after a reload: the same step, the prizes and the effort that follows kept', (await page.locator('[data-step="export"]').getAttribute('aria-current')) === 'step' && (await page.locator('[data-step="prizes"]').getAttribute('data-done')) === 'true')
ok(`no page error (${errors.join(' | ').slice(0, 200)})`, errors.length === 0)
await browser.close()
process.exit(finish('WICKED TRAILS') ? 1 : 0)
