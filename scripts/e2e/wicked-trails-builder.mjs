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

// The pools, on the Economy page: a pack in the album, a basket.
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByRole('link', { name: /Economy/ }).first().click()
await page.getByTestId('economy-header').waitFor()
await page.locator('[data-tab="pools"]').click()
await page.waitForTimeout(250)
const typeIn = async (sheetId, cell, value) => {
  await page.locator(`[data-sheet="${sheetId}"] [data-cell="${cell}"]`).click()
  await page.keyboard.type(value)
  await keys('Enter')
}
await typeIn('pool-album', '0:0', 'Common_T3_1_2C_Low_Rarity_Game')
await typeIn('pool-baskets', '0:0', 'Chef__Basic_Phase_1_Undo')
await typeIn('pool-album', '1:0', 'Not_A_Pack')
ok(`the Pools tab: a pack in the album, a basket, every section ticked; a key not on the lists refused (${await text(page.locator('[data-sheet-note="pool-album"]'))})`, (await text(page.locator('[data-sheet="pool-album"] [data-cell="0:0"]'))) === 'Common_T3_1_2C_Low_Rarity_Game' && (await text(page.locator('[data-sheet="pool-album"] [data-cell="0:3"]'))) === '✓' && (await text(page.locator('[data-sheet="pool-baskets"] [data-cell="0:0"]'))) === 'Chef__Basic_Phase_1_Undo' && (await page.locator('[data-sheet="pool-album"] tbody tr').count()) === 2 && /not on the Economy page/.test(await text(page.locator('[data-sheet-note="pool-album"]'))))

// One segment, 100 Brut Wins; ROE 1; the easy lane half of each BW while both fill. Two tiers a lane.
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
const fillerNames = async () => (await page.locator('[data-sheet="wt-fillers"] [data-col="item"]').allInnerTexts()).map((x) => x.trim()).filter((x) => x && x !== '-')
ok(`the default fillers: packs, baskets, then the core resources, coins last (${(await fillerNames()).join(', ')})`, (await fillerNames()).join(', ') === 'Sticker pack, Chef basket, Wild, Extra stock, Free round, Undo, Coins')
await page.locator('[data-sheet="wt-fillers"] [data-cell="1:1"]').click()
await keys('ArrowLeft')
await keys('Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown', 'Delete')
ok(`five rows cleared at once - the right ones go (${(await fillerNames()).join(', ')})`, (await fillerNames()).join(', ') === 'Sticker pack, Coins')

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
ok('easy tier 1: the album pack (0) + 4 undo (1) + 9 coins = 10', prizes.e0 === 'allowance(coins:9)+free_undo:4+[sticker_pack:Common_T3_1_2C_Low_Rarity_Game|allowance(coins:0.25)]+[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]')
ok('easy tier 2: 3 undo (0.75) + 9.25 coins = 10', prizes.e1 === 'allowance(coins:9.25)+free_undo:3+[sticker_pack:Common_T3_1_2C_Low_Rarity_Game|allowance(coins:0.25)]+[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]')
ok('hard tiers: 6 and 7 undo, coins to 15 and 30', prizes.h0 === 'allowance(coins:13.5)+free_undo:6+[sticker_pack:Common_T3_1_2C_Low_Rarity_Game|allowance(coins:0.25)]+[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]' && prizes.h1 === 'allowance(coins:28.25)+free_undo:7+[sticker_pack:Common_T3_1_2C_Low_Rarity_Game|allowance(coins:0.25)]+[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]')
ok('the Final Prize: 20 undo (5) + 65 coins = 70', prizes.gp === 'allowance(coins:65)+free_undo:20+[sticker_pack:Common_T3_1_2C_Low_Rarity_Game|allowance(coins:0.25)]+[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]')
ok(`the report: undo 40 of 40, every lane at 0 (${await text(page.getByTestId('wt-build-report'))})`, /Undo 40 of 40/.test(await text(page.getByTestId('wt-build-report'))) && /Easy lane 0 · Hard lane 0 · Final Prize 0/.test(await text(page.getByTestId('wt-build-report'))))
ok(`off by 0 down the lanes (${await text(T('easy-1', 'off'))}, ${await text(T('hard-1', 'off'))}, ${await text(T('final', 'off'))})`, (await text(T('easy-1', 'off'))) === '0 (0%)' && (await text(T('hard-1', 'off'))) === '0 (0%)' && (await text(T('final', 'off'))) === '0 (0%)')

// Sum / Average / Count of a selection, as Excel's status bar.
await T('easy-0', 'target').click()
await keys('Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown')
ok(`a selection's Sum, Average, Count (${await text(page.locator('[data-sheet-stats="wt-tiers"]'))})`, /Sum 65 · Average 16\.25 · Count 4/.test(await text(page.locator('[data-sheet-stats="wt-tiers"]'))))

// Moving left from far right: the cell is never hidden under the pinned Lane and Tier columns.
const header = await page.locator('[data-sheet="wt-tiers"] thead tr').last().locator('th').allInnerTexts()
ok(`the column is named for what it does: Build (${header[2].replace(/\s+/g, ' ')})`, /^BUILD/i.test(header[2].trim()))
await T('easy-0', 'pack').click()
let hidden = 0
for (let k = 0; k < 14; k += 1) {
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(60)
  const seen = await page.evaluate(() => {
    const box = document.querySelector('[data-sheet="wt-tiers"]')
    const active = [...box.querySelectorAll('td')].find((td) => td.querySelector('[aria-hidden="true"]'))
    if (!active) return false
    const pinned = box.querySelector('[data-sheet-row="easy-0"] [data-col="tier"]').getBoundingClientRect().right
    const r = active.getBoundingClientRect()
    return active.dataset.col === 'lane' || active.dataset.col === 'tier' || r.left >= pinned - 1
  })
  if (!seen) hidden += 1
}
ok(`moving left all the way, the cell picked is always in sight (${hidden} times hidden)`, hidden === 0)
// Typing in a text cell, Left moves inside the text.
await T('easy-0', 'presets').click()
await page.keyboard.type('abc')
await page.keyboard.press('ArrowLeft')
await page.keyboard.type('X')
ok(`typing in a text cell, Left moves inside the text (${await page.locator('[data-sheet="wt-tiers"] [data-sheet-input]').inputValue()})`, (await page.locator('[data-sheet="wt-tiers"] [data-sheet-input]').inputValue()) === 'abXc')
await page.keyboard.press('Escape')

// Undo the build: the prizes as they were.
await page.getByTestId('wt-build-undo').click()
await page.waitForTimeout(300)
await page.getByTestId('wt-show-more').check().catch(() => {})
await page.waitForTimeout(150)
ok('Undo the build: the prizes back as they were (empty)', (await text(T('easy-0', 'text'))) === '' && (await text(T('final', 'text'))) === '')

// Kept.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(300)
ok('after a reload the ticks, sections and rules are kept', (await text(T('hard-1', 'auto'))) === '✓' && (await text(page.locator('[data-sheet="wt-hard"] [data-cell="0:0"]'))) === 'Undo')
ok(`no page error (${errors.join(' | ').slice(0, 200)})`, errors.length === 0)
await browser.close()
process.exit(finish('ECONOMY BUILDER') ? 1 : 0)
