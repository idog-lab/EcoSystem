// Wicked Trails in the browser, step by step as a first visit finds it, the sheets driven with the keyboard as a
// person would: segments taken from a generic set (one segment's effort following another's), the rules, the tiers and
// prizes sheet (typed, pasted from "Excel", built with Ctrl+B), the mock played to the end, and the export downloaded
// and read back.
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
const sheet = (id) => page.locator(`[data-sheet="${id}"]`)
const cell = (id, r, c) => sheet(id).locator(`[data-cell="${r}:${c}"]`)
const cellText = async (id, r, c) => text(cell(id, r, c))
const pick = async (id, r, c) => {
  await cell(id, r, c).click()
  await page.waitForTimeout(80)
}
const keys = async (...list) => {
  for (const k of list) {
    if (k.length > 1 && /^[A-Z]|\+/.test(k)) await page.keyboard.press(k)
    else await page.keyboard.type(k)
  }
  await page.waitForTimeout(200)
}
// A block pasted from a spreadsheet, as the browser hands it over.
const paste = async (id, tsv) => {
  await sheet(id).evaluate((el, data) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', data)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, tsv)
  await page.waitForTimeout(250)
}
const copy = async (id) =>
  sheet(id).evaluate((el) => {
    const dt = new DataTransfer()
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }))
    return dt.getData('text/plain')
  })

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

// Step 1: the segments, as a sheet.
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByRole('link', { name: /Wicked Trails/ }).first().click()
await page.getByTestId('wt-header').waitFor()
const steps = (await page.locator('[data-step]').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim())
ok(`a first visit starts at step 1 of five (${steps.join(' | ')})`, steps.length === 5 && /Tiers and prizes/.test(steps[2]) && (await page.locator('[data-step="segments"]').getAttribute('aria-current')) === 'step' && /step 1 of 5/i.test(await text(page.getByTestId('wt-step-head'))))
const picker = page.getByTestId('wt-segment-set')
await picker.selectOption(await picker.locator('option', { hasText: '2D_Levels' }).getAttribute('value'))
await page.waitForTimeout(300)
// Columns: 0 base, 1 segment, 2 effort from, 3 effort typed, 4 factor, 5 effort in force, 6 silver, 7 gold, 8-10 worked out.
ok(`the set's segments in the sheet, named Wicked_Trails_, with their efforts (${await cellText('wt-segments', 0, 1)}: ${await cellText('wt-segments', 0, 5)})`, (await cellText('wt-segments', 0, 1)) === 'Wicked_Trails_BW_0_9' && (await cellText('wt-segments', 2, 5)) === '300' && (await cellText('wt-segments', 0, 0)) === '✓')
// Segment 2 follows segment 1 x 1.5: the dropdown cell, then the factor typed.
await pick('wt-segments', 1, 2)
await keys('Enter')
await sheet('wt-segments').locator('[data-sheet-select]').selectOption({ label: 'x Wicked_Trails_BW_0_9' })
await page.waitForTimeout(250)
await keys('ArrowRight', 'ArrowRight', '1.5', 'Enter')
ok(`Enter opens the dropdown cell; the factor typed: 100 x 1.5 = ${await cellText('wt-segments', 1, 5)}`, (await cellText('wt-segments', 1, 2)) === 'x Wicked_Trails_BW_0_9' && (await cellText('wt-segments', 1, 5)) === '150' && (await cellText('wt-segments', 1, 3)) === '')
// Silver and gold for every segment, pasted from a spreadsheet as one block.
await pick('wt-segments', 0, 6)
await paste('wt-segments', '2\t3\r\n2\t3\r\n2\t3\r\n')
ok(`a block pasted from Excel fills silver and gold for the three segments (${await cellText('wt-segments', 2, 6)} / ${await cellText('wt-segments', 2, 7)}; ${await text(page.locator('[data-sheet-note="wt-segments"]'))})`, (await cellText('wt-segments', 2, 6)) === '2' && (await cellText('wt-segments', 2, 7)) === '3' && (await cellText('wt-segments', 0, 8)) === '100' && (await cellText('wt-segments', 0, 9)) === '300')
ok('step 1 is done, nothing more needed', (await page.locator('[data-step="segments"]').getAttribute('data-done')) === 'true' && (await page.getByTestId('wt-step-missing').count()) === 0)
// Typed over, fast, then undone.
await pick('wt-segments', 0, 3)
await page.keyboard.type('120', { delay: 0 })
await page.keyboard.press('Enter')
await page.waitForTimeout(250)
ok(`typing over a cell, as fast as a person can, replaces it; the follower follows (${await cellText('wt-segments', 0, 3)} -> ${await cellText('wt-segments', 1, 5)})`, (await cellText('wt-segments', 0, 3)) === '120' && (await cellText('wt-segments', 1, 5)) === '180')
ok('Enter took it and moved down a row', (await cell('wt-segments', 1, 3).locator('[aria-hidden="true"]').count()) === 1)
await keys('Control+z')
ok('Ctrl+Z brings 100 back, and the follower with it', (await cellText('wt-segments', 0, 3)) === '100' && (await cellText('wt-segments', 1, 5)) === '150')
await keys('Control+y')
await keys('Control+z')
await pick('wt-segments', 0, 6)
await keys('Shift+ArrowDown', 'Shift+ArrowRight')
const copied = await copy('wt-segments')
ok(`Shift+arrows select a block; Ctrl+C copies it for Excel (${JSON.stringify(copied)})`, copied === '2\t3\n2\t3')
await pick('wt-segments', 0, 6)
await keys('abc', 'Enter')
ok(`a number cell refuses text and says so (${await text(page.locator('[data-sheet-note="wt-segments"]'))})`, (await cellText('wt-segments', 0, 6)) === '2' && /not a number/.test(await text(page.locator('[data-sheet-note="wt-segments"]'))))
await pick('wt-segments', 0, 9)
await keys('5')
ok('a worked-out cell cannot be typed over', (await cellText('wt-segments', 0, 9)) === '300' && /worked out/.test(await text(page.locator('[data-sheet-note="wt-segments"]'))))

// Step 2: the rules, reached with Next.
await page.getByTestId('wt-next').click()
await page.waitForTimeout(250)
ok('Next leads to the rules, which ask for the ROE', (await page.locator('[data-step="rules"]').getAttribute('aria-current')) === 'step' && /ROE/.test(await text(page.getByTestId('wt-step-missing'))))
await set(page.locator('[data-rule="roe"]'), 1)
await set(page.locator('[data-rule="easyShare"]'), 50)

// Step 3: tiers and prizes, one sheet. Rows: easy 1-2, hard 1-2, the Final Prize. Columns: 0 lane, 1 tier, 2 share,
// 3 DR, 4 DR in all, 5 Brut Wins, 6 earned, 7 target, 8 prize, 9 its worth.
await page.getByTestId('wt-next').click()
await page.waitForTimeout(250)
await set(page.locator('[data-tier-count="easy"]'), 2)
await set(page.locator('[data-tier-count="hard"]'), 2)
const T = 'wt-tiers'
ok(`one sheet: both lanes' tiers and the Final Prize (${await sheet(T).locator('tbody tr').count()} rows)`, (await sheet(T).locator('tbody tr').count()) === 5 && (await cellText(T, 4, 0)) === 'Final Prize')
ok('easy tiers: 50 silver each, 12.5 earned, 80% kept: 10', (await cellText(T, 0, 3)) === '50' && (await cellText(T, 0, 7)) === '10' && (await cellText(T, 1, 7)) === '10')
ok('hard tiers: 150 gold each; 25 while sharing and 50 alone, 60% kept: 15 and 30', (await cellText(T, 2, 3)) === '150' && (await cellText(T, 2, 7)) === '15' && (await cellText(T, 3, 7)) === '30')
ok(`the Final Prize: pool 35, target 70 (${await cellText(T, 4, 6)}, ${await cellText(T, 4, 7)})`, (await cellText(T, 4, 6)) === '35' && (await cellText(T, 4, 7)) === '70')
// A share typed, then the lane put back.
await pick(T, 0, 2)
await keys('40', 'Enter')
ok(`a share typed: the step says the lane no longer adds up (${(await text(page.getByTestId('wt-step-missing'))).split('\n')[1]})`, /Easy lane: the tiers add up to 90%/.test(await text(page.getByTestId('wt-step-missing'))))
await keys('Control+z')
// The prize typed straight into the cell.
await pick(T, 0, 8)
await keys('free_undo:40', 'Enter')
ok(`a prize typed into its cell, its worth beside it (${await cellText(T, 0, 9)})`, (await cellText(T, 0, 8)) === 'free_undo:40' && /^10 \(0, 0%\)$/.test(await cellText(T, 0, 9)))
// Ctrl+B builds the prize of the row picked.
await pick(T, 0, 8)
await keys('Control+b')
const builder = page.locator('[data-prize-builder="easy-0"]')
ok('Ctrl+B opens the prize builder for that row', (await builder.count()) === 1 && /Easy lane, tier 1/.test(await text(page.getByTestId('wt-building'))))
await builder.locator('[data-builder-input="easy-0-preset"]').fill('puzzle_gameplay_20')
await builder.locator('[data-builder-add="easy-0-preset"]').click()
await page.waitForTimeout(200)
ok(`a preset picked in the builder lands in the sheet (${await cellText(T, 0, 8)})`, (await cellText(T, 0, 8)) === 'free_undo:40+preset:puzzle_gameplay_20')
await builder.locator('[data-builder-chip="preset"] button').click()
await page.getByTestId('wt-build-prize').click()
// The other prizes pasted as a column from a spreadsheet.
await pick(T, 1, 8)
await paste(T, 'free_wild:4\nfree_wild:6\nfree_wild:12\nfree_wild:20+free_undo:80\n')
ok(`a column of prizes pasted in (${await cellText(T, 4, 8)}; ${await cellText(T, 4, 9)})`, (await cellText(T, 1, 8)) === 'free_wild:4' && (await cellText(T, 4, 8)) === 'free_wild:20+free_undo:80' && /^70 /.test(await cellText(T, 4, 9)))
ok('every prize in: the step is done', (await page.locator('[data-step="tiers"]').getAttribute('data-done')) === 'true')
await page.locator('[data-wt-chip="1"]').click()
await page.waitForTimeout(250)
ok(`the follower segment: the base's prize x 1.5 and its target (${await cellText(T, 0, 8)}, ${await cellText(T, 0, 7)})`, (await cellText(T, 0, 8)) === 'free_undo:60' && (await cellText(T, 0, 7)) === '15')
await pick(T, 0, 8)
await keys('free_wild:9', 'Enter')
ok('a prize typed for that segment is its own', (await cellText(T, 0, 8)) === 'free_wild:9')
await pick(T, 0, 8)
await keys('Delete')
ok('Delete brings the base\'s back', (await cellText(T, 0, 8)) === 'free_undo:60')

// Step 4: the mock, for the base.
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

// Step 5: the export.
await page.getByTestId('wt-next').click()
await page.waitForTimeout(250)
await page.getByTestId('wt-start-date').fill('2026-11-16')
await page.waitForTimeout(200)
ok(`the file is named as the example (${await text(page.getByTestId('wt-file-name'))})`, (await text(page.getByTestId('wt-file-name'))) === 't_Promo_st_WickedTrail_n_WickedTrail_d_20261116.xlsx')
const col = (column, which = 'ops') => text(page.locator(`[data-export-column="${column}"] [data-export-${which}]`))
ok(`the row shows the trigger and the chest (${await col('$_Script->RightMilestone_1_Res')})`, (await col('$_Script->RightMilestone_1_Res')) === 'chest:silver(trigger:wicked_trails_silver_tier2+free_wild:4)')
ok(`RC: 50% more a tier (${await col('$_Script->LeftMilestone_1_Req', 'rc')})`, (await col('$_Script->LeftMilestone_1_Req')) === '300' && (await col('$_Script->LeftMilestone_1_Req', 'rc')) === '450')
const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('wt-download').click()])
const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(await download.path())
const sheets = wb.worksheets.map((w) => w.name)
const ops = wb.getWorksheet('Congif OPS')
ok(`the workbook: the example's three sheets, a row per segment (${sheets.join(', ')}; ${ops.rowCount - 1} rows)`, download.suggestedFilename() === 't_Promo_st_WickedTrail_n_WickedTrail_d_20261116.xlsx' && sheets.join('|') === 'segments|Congif OPS|Config RC OPS' && ops.rowCount === 4 && ops.getRow(2).getCell(1).value === 'def_Wicked_Trails_BW_0_9')

// Kept.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(300)
ok('after a reload: the same step, and the tiers and prizes still done', (await page.locator('[data-step="export"]').getAttribute('aria-current')) === 'step' && (await page.locator('[data-step="tiers"]').getAttribute('data-done')) === 'true')
ok(`no page error (${errors.join(' | ').slice(0, 200)})`, errors.length === 0)
await browser.close()
process.exit(finish('WICKED TRAILS') ? 1 : 0)
