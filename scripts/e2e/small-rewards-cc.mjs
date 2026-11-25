// The Small Rewards CC sheets on the Syntax tab, on an event built with a
// Twister: the two CC sheets, the CC picked, the changed rows highlighted, and
// the workbook of all seven. Run: npx vite-node scripts/e2e/small-rewards-cc.mjs
import fs from 'node:fs'
import ExcelJS from 'exceljs'
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { createChecker, launch, openMerge, tab, syntaxView } from './helpers.mjs'

const { ok, finish } = createChecker()
const step = (page, id) => page.locator(`[data-step="${id}"]`)
const set = async (locator, value) => {
  await locator.fill(String(value))
  await locator.blur()
  await new Promise((r) => setTimeout(r, 250))
}
function blankBoard(name, index, budget) {
  const b = createBoard(name, { rows: index === 0 ? 5 : 3, cols: 8 })
  const from = index === 0 ? 3 : 1
  b.tiles = b.tiles.map((row, r) => row.map(() => (r >= from ? 'blocked' : 'open')))
  if (index === 0) b.tiles[2][4] = 'semi'
  b.blockedValue = budget
  return b
}
const boards = (b2, b3) => [blankBoard('Board 1', 0, 150), blankBoard('Board 2', 1, b2), blankBoard('Board 3', 2, b3)]
const { browser, page, errors } = await launch({ save: { segments: [{ name: 'Lots of subsidy', boards: boards(720, 880) }] } })
await openMerge(page)
await tab(page, 'Build event').click()
await page.waitForTimeout(300)
await step(page, 'rewards').click()
await page.waitForTimeout(300)
await set(page.locator('[data-target="coins"]'), 3)
await set(page.locator('[data-target="puzzles"]'), 300)
await set(page.locator('[data-target="energy"]'), 200)
await set(page.locator('[data-target="charms"]'), 400)
await page.getByTestId('twister-add').click()
await page.waitForTimeout(400)
await set(page.locator('[data-twister-segment="0"] [data-field="twists"]'), 12)
await step(page, 'build').click()
await page.waitForTimeout(300)
await page.getByTestId('build-configuration').click()
await page.getByTestId('build-configuration').waitFor({ state: 'visible', timeout: 540000 })
await page.waitForTimeout(600)

await tab(page, 'Syntax').click()
await page.waitForTimeout(300)
const options = await page.getByTestId('syntax-view').locator('option').allInnerTexts()
ok('the sheet list offers the two CC sheets, after the normal bank and weights', options.indexOf('CC Small Rewards Bank') === options.indexOf('Small Reward Weights') + 1 && options.includes('CC Small Reward Weights'))
await syntaxView(page, 'Small Rewards Bank')
const normal = await page.locator('table tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())))
await syntaxView(page, 'CC Small Rewards Bank')
ok(`the CC is picked from seven (${(await page.getByTestId('syntax-cc').locator('option').allInnerTexts()).join(' / ')})`, (await page.getByTestId('syntax-cc').locator('option').count()) === 7 && /CC1: No Twister/.test(await page.getByTestId('syntax-cc').innerText()))
const cc1 = await page.locator('table tbody tr').evaluateAll((trs) => trs.map((tr) => ({ cells: [...tr.querySelectorAll('td')].map((td) => td.innerText.trim()), hi: tr.className.includes('amber') })))
console.log(`      normal: ${normal.map((r) => r.join(' ')).join(' | ')}`)
console.log(`      CC1:    ${cc1.map((r) => r.cells.join(' ')).join(' | ')}`)
const twisterOnly = normal.filter((r) => /^dr-twister-r\d$/.test(r[1])).map((r) => r[0])
const kept = normal.filter((r) => !twisterOnly.includes(r[0]))
ok(`CC1 (no Twister): a Twister-only container leaves the sheet (${twisterOnly.join(', ') || 'none'}); the others keep their keys in order, no Twister item left, the changed ones highlighted`, cc1.length === kept.length && cc1.every((r, i) => r.cells[0] === kept[i][0]) && cc1.every((r) => !/dr-twister/.test(r.cells[1])) && cc1.filter((r) => r.hi).length === kept.filter((r) => /dr-twister/.test(r[1])).length && normal.some((r) => /dr-twister/.test(r[1])))
ok('CC1: a Twister item is not turned into a coin - a two-item container gives one item, a three-item one gets a rank-1 merge energy', kept.every((r, i) => {
  if (!/dr-twister/.test(r[1])) return cc1[i].cells[1] === r[1]
  const before = r[1].split('+')
  const after = cc1[i].cells[1].split('+')
  return before.length === 3 ? after.length === 3 && after.includes('dr-r1') : after.length === before.filter((k) => !/^dr-twister/.test(k)).length
}))
await syntaxView(page, 'CC Small Reward Weights')
const tier5 = await page.locator('table tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())).find((cells) => cells[0] === '5'))
ok(`CC1 weights: merge tier 5 drops nothing (${tier5?.join(' ')})`, !!tier5 && tier5.at(-1) === '1000' && tier5.slice(1, -1).every((w) => w === '0'))
await page.getByTestId('syntax-cc').selectOption('cc2')
await page.waitForTimeout(200)
const tier5b = await page.locator('table tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())).find((cells) => cells[0] === '5'))
ok('CC2 (no puzzles): tier 5 still drops its Twister item', !!tier5b && tier5b.at(-1) !== '1000')
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByTestId('syntax-cc-download').click()])
const file = await download.path()
const wb = new ExcelJS.Workbook()
await wb.xlsx.load(fs.readFileSync(file))
const names = wb.worksheets.map((w) => w.name)
ok(`the CC workbook holds the index and each CC's two sheets (${names.length}: ${names.slice(0, 3).join(', ')} ...)`, names.length === 15 && names[0] === 'CC' && names.includes('CC7 Small Reward Weights') && wb.getWorksheet('CC').getRow(2).getCell(2).value === 'Twister')
ok('the main workbook is not changed: the CC sheets are a download of their own', !(await page.getByRole('button', { name: /Download workbook/ }).isDisabled()) && options.length === 17)
ok(`no page error (${errors.join(' | ').slice(0, 200)})`, errors.length === 0)
await browser.close()
process.exit(finish('SMALL REWARDS CC') ? 1 : 0)
