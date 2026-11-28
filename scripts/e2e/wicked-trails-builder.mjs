// The economy builder in Wicked Trails, used as a person would: Auto ticked down the column with Ctrl+D, a hard total
// typed in its sheet, coins as the filler, Build, the numbers checked by hand, Undo. And the sheet's Sum / Count.
// Run: npx vite-node scripts/e2e/wicked-trails-builder.mjs
import { BASE, createChecker, launch } from './helpers.mjs'

const { ok, finish } = createChecker()
const { browser, page, errors } = await launch()
const text = async (l) => (await l.innerText()).trim()
const keys = async (...list) => {
  for (const k of list) await page.keyboard.press(k)
  await page.waitForTimeout(200)
}

// One segment, 100 Brut Wins; ROE 1; the easy lane half of each BW while both fill. Two tiers a lane.
await page.goto(BASE, { waitUntil: 'networkidle' })
const state = {
  rules: { roe: 1, easyShare: 50, easySize: 50, takeEasy: 20, takeHard: 40, finalCounted: 50 },
  lanes: { easy: { shares: [50, 50], prizes: ['', ''] }, hard: { shares: [50, 50], prizes: ['', ''] } },
  finalPrize: '',
  segments: [{ name: 'WT_A', key: 'def_WT_A', condition: 'c', effortTyped: 100, silverPerBW: 2, goldPerBW: 3, own: {} }],
  baseIndex: 0,
  startDate: '2026-11-16',
}
await page.evaluate((s) => {
  localStorage.setItem('superplay-wicked-trails', JSON.stringify(s))
  localStorage.setItem('superplay-wicked-trails-view', JSON.stringify('tiers'))
}, state)
await page.goto(`${BASE}models/wicked-trails`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const T = (row, col) => page.locator(`[data-sheet="wt-tiers"] [data-sheet-row="${row}"] [data-col="${col}"]`)
ok(`the sheet has Auto and Section; sections start easy then mid, the Final Prize hard (${await text(T('easy-0', 'section'))}, ${await text(T('easy-1', 'section'))}, ${await text(T('final', 'section'))})`, (await text(T('easy-0', 'section'))) === 'Easy' && (await text(T('easy-1', 'section'))) === 'Mid' && (await text(T('final', 'section'))) === 'Hard' && (await text(T('final', 'auto'))) === '')

// Auto: tick the first, then Ctrl+D down the column.
await T('easy-0', 'auto').click()
await keys('Space')
await keys('Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown', 'Control+d')
const ticks = await page.locator('[data-sheet="wt-tiers"] [data-col="auto"]').allInnerTexts()
ok(`Ctrl+D fills the tick down the column, Final Prize included (${ticks.join(' ')})`, ticks.every((t) => t.trim() === '✓') && ticks.length === 5)
ok(`the Build button counts them (${await text(page.getByTestId('wt-build'))})`, /Build 5 tiers/.test(await text(page.getByTestId('wt-build'))))

// A hard total: Undo 40 - easy 25%, mid 25%, the rest (50%) to the Final Prize.
const H = (r, c) => page.locator(`[data-sheet="wt-hard"] [data-cell="${r}:${c}"]`)
await H(0, 0).click()
await page.locator('[data-sheet="wt-hard"] [data-sheet-select]').selectOption({ label: 'Undo' })
await page.waitForTimeout(200)
await H(0, 1).click()
await page.keyboard.type('40')
await keys('Tab')
await page.keyboard.type('25')
await keys('Tab')
await page.keyboard.type('25')
await keys('Enter')
ok(`a hard total typed in its sheet: Undo 40, 25% / 25% / the rest 50% (${await text(H(0, 4))})`, (await text(H(0, 0))) === 'Undo' && (await text(H(0, 1))) === '40' && (await text(H(0, 4))) === '50 rest' && (await page.locator('[data-sheet="wt-hard"] tbody tr').count()) === 2)
ok('the fillers start with coins', (await text(page.locator('[data-sheet="wt-fillers"] [data-cell="0:0"]'))) === 'Coins')

// Build. Targets: easy 10, 10; hard 15, 30; the Final Prize 70.
// Undo: easy 10 -> easy tier 1 (target 10) and hard tier 1 (15): 4 and 6; mid 10 -> easy tier 2 (10) and hard tier 2
// (30): 3 and 7 (the largest remainder first); hard 20 -> the Final Prize. Coins fill each to its target (undo 0.25).
await page.getByTestId('wt-build').click()
await page.waitForTimeout(400)
const textCol = async (row) => {
  await page.getByTestId('wt-show-more').check().catch(() => {})
  return text(T(row, 'text'))
}
const prizes = { e0: await textCol('easy-0'), e1: await textCol('easy-1'), h0: await textCol('hard-0'), h1: await textCol('hard-1'), gp: await textCol('final') }
console.log(`      ${JSON.stringify(prizes)}`)
ok('easy tier 1: 4 undo (1) + 9 coins = 10', prizes.e0 === 'allowance(coins:9)+free_undo:4')
ok('easy tier 2: 3 undo (0.75) + 9.25 coins = 10', prizes.e1 === 'allowance(coins:9.25)+free_undo:3')
ok('hard tiers: 6 and 7 undo, coins to 15 and 30', prizes.h0 === 'allowance(coins:13.5)+free_undo:6' && prizes.h1 === 'allowance(coins:28.25)+free_undo:7')
ok('the Final Prize: 20 undo (5) + 65 coins = 70', prizes.gp === 'allowance(coins:65)+free_undo:20')
ok(`the report: undo 40 of 40, every lane at 0 (${await text(page.getByTestId('wt-build-report'))})`, /Undo 40 of 40/.test(await text(page.getByTestId('wt-build-report'))) && /Easy lane 0 · Hard lane 0 · Final Prize 0/.test(await text(page.getByTestId('wt-build-report'))))
ok(`off by 0 down the lanes (${await text(T('easy-1', 'off'))}, ${await text(T('hard-1', 'off'))}, ${await text(T('final', 'off'))})`, (await text(T('easy-1', 'off'))) === '0 (0%)' && (await text(T('hard-1', 'off'))) === '0 (0%)' && (await text(T('final', 'off'))) === '0 (0%)')

// Sum / Average / Count of a selection, as Excel's status bar.
await T('easy-0', 'target').click()
await keys('Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown')
ok(`a selection's Sum, Average, Count (${await text(page.locator('[data-sheet-stats="wt-tiers"]'))})`, /Sum 65 · Average 16\.25 · Count 4/.test(await text(page.locator('[data-sheet-stats="wt-tiers"]'))))

// Undo the build: the prizes as they were.
await page.getByTestId('wt-build-undo').click()
await page.waitForTimeout(300)
ok('Undo the build: the prizes back as they were (empty)', (await text(T('easy-0', 'text'))) === '' && (await text(T('final', 'text'))) === '')

// Kept.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(300)
ok('after a reload the ticks, sections and rules are kept', (await text(T('hard-1', 'auto'))) === '✓' && (await text(page.locator('[data-sheet="wt-hard"] [data-cell="0:0"]'))) === 'Undo')
ok(`no page error (${errors.join(' | ').slice(0, 200)})`, errors.length === 0)
await browser.close()
process.exit(finish('ECONOMY BUILDER') ? 1 : 0)
