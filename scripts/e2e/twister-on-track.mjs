// Browser end-to-end: the Twister is kept on track by the build, and step 6
// shows it - when a typical player of each segment has the last twist.
// (Economist: "in some segments ... the user get the twister final amount in
// 100% progression and some at 50 ... i need the model to be the smart one".)
// Run: npx vite-node scripts/e2e/twister-on-track.mjs
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { createChecker, launch, openMerge, tab } from './helpers.mjs'

const { ok, finish } = createChecker()
const SHOT = process.env.E2E_SCREENSHOT_DIR ?? null
const shot = async (page, name) => SHOT && page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: true })
const step = (page, id) => page.locator(`[data-step="${id}"]`)
const set = async (locator, value) => {
  await locator.fill(String(value))
  await locator.blur()
  await new Promise((r) => setTimeout(r, 250))
}
const num = (text) => Number(String(text).replace(/,/g, '').match(/-?\d+(\.\d+)?/)?.[0])

function blankBoard(name, index, budget) {
  const b = createBoard(name, { rows: index === 0 ? 5 : 3, cols: 8 })
  const from = index === 0 ? 3 : 1
  b.tiles = b.tiles.map((row, r) => row.map(() => (r >= from ? 'blocked' : 'open')))
  if (index === 0) b.tiles[2][4] = 'semi'
  b.blockedValue = budget
  return b
}
const boards = (b2, b3) => [blankBoard('Board 1', 0, 150), blankBoard('Board 2', 1, b2), blankBoard('Board 3', 2, b3)]

// Three segments, from a lot of subsidy (little merging) to little subsidy (a lot of merging).
const { browser, page, errors } = await launch({
  save: { segments: [{ name: 'Lots of subsidy', boards: boards(720, 880) }, { name: 'Middle', boards: boards(520, 630) }, { name: 'Little subsidy', boards: boards(250, 300) }] },
})
await openMerge(page)
await tab(page, 'Build event').click()
await page.waitForTimeout(300)
await step(page, 'rewards').click()
await page.waitForTimeout(300)
await set(page.locator('[data-target="coins"]'), 3)
await set(page.locator('[data-target="puzzles"]'), 300)
await page.getByTestId('twister-add').click()
await page.waitForTimeout(400)
await set(page.locator('[data-twister-segment="0"] [data-field="twists"]'), 15)
await set(page.locator('[data-field="twister-step"]'), 10)

console.log('--- 1. Step 4: the switch ---')
{
  const steady = page.getByTestId('twister-steady')
  ok('step 4 has "Keep every segment\'s Twister steady", on to start with', (await steady.isVisible()) && (await page.locator('[data-field="twister-steady"]').isChecked()))
  const text = (await steady.innerText()).replace(/\s+/g, ' ')
  ok('...and says what it does in plain words, and that the number is this tool\'s own', /rank 3 at most/.test(text) && /finishes at least 3/.test(text) && /this tool.s own number/.test(text))
}

console.log('--- 2. Step 6: every segment on track ---')
await step(page, 'build').click()
await page.waitForTimeout(300)
const build = async () => {
  await page.getByTestId('build-configuration').click()
  await page.getByTestId('build-configuration').waitFor({ state: 'visible', timeout: 540000 })
  await page.waitForTimeout(600)
}
await build()
const table = page.getByTestId('build-twister-prices')
const rowsOf = async () =>
  table.locator('[data-twister-price]').evaluateAll((trs) =>
    trs.map((tr) => ({
      name: tr.querySelector('td')?.innerText.trim(),
      price: tr.querySelector('[data-field="price"]')?.innerText.trim(),
      typical: tr.querySelector('[data-field="typical"]')?.innerText.trim(),
      finish: tr.querySelector('[data-field="finish"]')?.innerText.trim(),
      pace: tr.querySelector('[data-field="pace"]')?.dataset.pace,
      paceText: tr.querySelector('[data-field="pace"]')?.innerText.trim(),
      note: tr.querySelector('[data-field="note"]')?.innerText.trim(),
      marks: Object.fromEntries([...tr.querySelectorAll('[data-mark]')].map((td) => [td.dataset.mark, td.querySelector('[data-field="twists"]')?.innerText.trim() ?? null])),
    })),
  )
{
  const rows = await rowsOf()
  const track = page.getByTestId('twister-track')
  const trackText = (await track.innerText()).replace(/\s+/g, ' ')
  const sizedText = (await page.getByTestId('twister-sized').innerText()).replace(/\s+/g, ' ')
  // A build has randomness in it. What it promises: every segment on track,
  // or - when even its biggest Twister item (rank 3) cannot do that - it stops
  // there and the line names the segment that is early.
  const allOn = rows.every((r) => r.pace === 'on-track')
  const atBiggest = /, at rank 3 /.test(sizedText)
  ok(`one line says whether the Twister is on track ("${trackText}")`, allOn ? (await track.getAttribute('data-on-track')) === 'yes' && /On track: in all 3 segments the typical player has the last twist/.test(trackText) : (await track.getAttribute('data-on-track')) === 'no' && /Not on track yet/.test(trackText) && rows.filter((r) => r.pace !== 'on-track').every((r) => trackText.includes(r.name)))
  ok(`every segment has the last twist in the last 20 points of the phase - or the build went to its biggest Twister item and says who is early (${rows.map((r) => `${r.name}: ${r.finish} ${r.paceText}`).join(', ')}${allOn ? '' : '; items at rank 3'})`, rows.length === 3 && (allOn ? rows.every((r) => r.paceText === 'On track' && num(r.finish) >= 80 && num(r.finish) <= 100) : atBiggest && rows.every((r) => r.pace !== 'late')))
  ok(`...getting the twists asked or a few more (${rows.map((r) => num(r.typical)).join(', ')} of 15), at prices in steps of 10 (${rows.map((r) => r.price).join(', ')})`, rows.every((r) => num(r.typical) >= 15 && num(r.typical) <= 19 && num(r.price) % 10 === 0))
  const order = ['25', '50', '70', '75', '100']
  ok(`the table shows the twists a typical player has at 25, 50, 70, 75 and 100% of the phase, never going down (${rows.map((r) => order.map((m) => num(r.marks[m])).join('/')).join('; ')})`, rows.every((r) => order.every((m) => r.marks[m] != null) && order.every((m, k) => k === 0 || num(r.marks[m]) >= num(r.marks[order[k - 1]])) && num(r.marks['100']) >= 15))
  ok(`...and each on-track row says in how many finished Twister items the DR comes ("${rows.find((r) => r.pace === 'on-track')?.note}")`, rows.filter((r) => r.pace === 'on-track').length >= 2 && rows.filter((r) => r.pace === 'on-track').every((r) => /comes in \d+ finished Twister items/.test(r.note) && num(r.note) >= 3))
  const sized = (await page.getByTestId('twister-sized').innerText()).replace(/\s+/g, ' ')
  ok(`the build says what it did to get there ("${sized.slice(0, 150)}...")`, /Twister DR values to \d+ \/ \d+ \/ \d+ \/ \d+/.test(sized) && /smallest values at which every segment has a price/.test(sized))
  await shot(page, 'twister-on-track')
  if (SHOT) await table.locator('xpath=ancestor::*[.//*[@data-testid="twister-track"]][1]').screenshot({ path: `${SHOT}/twister-on-track-panel.png` })
}

console.log('--- 3. Switched off: the items stay small, and the table says what that does ---')
await step(page, 'rewards').click()
await page.waitForTimeout(300)
await page.locator('[data-field="twister-steady"]').uncheck()
await page.waitForTimeout(400)
await step(page, 'build').click()
await page.waitForTimeout(400)
ok('switching it off makes the build out of date (it changes what the merges drop)', (await page.getByTestId('build-needs-rebuild').count()) >= 1)
await build()
{
  const rows = await rowsOf()
  const syntaxes = await page.getByTestId('build-containers').locator('[data-field="container-syntax"]').evaluateAll((els) => els.map((e) => e.innerText.trim()))
  const twisterRanks = syntaxes.flatMap((x) => [...x.matchAll(/dr-twister-r(\d)/g)].map((m) => Number(m[1])))
  ok(`built again, the Twister items in the containers are rank 1-2 (${[...new Set(twisterRanks)].sort().join(', ')})`, twisterRanks.length > 0 && twisterRanks.every((r) => r <= 2))
  ok(`...and the table still gives every segment a verdict (${rows.map((r) => `${r.name}: ${r.paceText}, all at ${r.finish}`).join('; ')})`, rows.every((r) => ['on-track', 'early', 'late'].includes(r.pace)) && (await page.getByTestId('twister-track').count()) === 1)
  await shot(page, 'twister-on-track-off')
  if (SHOT) await table.locator('xpath=ancestor::*[.//*[@data-testid="twister-track"]][1]').screenshot({ path: `${SHOT}/twister-on-track-off-panel.png` })
}
ok(`no page errors (${errors.length})`, errors.length === 0)
await browser.close()
const fails = finish('Twister on track E2E')
process.exit(fails === 0 ? 0 : 1)
