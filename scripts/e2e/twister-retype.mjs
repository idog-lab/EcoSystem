// The twists typed after a build (economist: "i asked 10 twists in the
// simulator and it shows 15 asked in the Build"). Built with 15 twists, then
// 10 typed in step 3: step 4 has to show 10 asked, with the price worked out
// for 10 - and when the build is out of date for another reason, say so
// beside the twists instead of showing the old number as if it were asked.
// Run: npx vite-node scripts/e2e/twister-retype.mjs
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { createChecker, launch, openMerge, tab } from './helpers.mjs'

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
const { browser, page, errors } = await launch({ save: { segments: [{ name: 'Lots of subsidy', boards: boards(720, 880) }, { name: 'Little subsidy', boards: boards(250, 300) }] } })
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
await set(page.locator('[data-twister-segment="0"] [data-field="twists"]'), 15)
await step(page, 'build').click()
await page.waitForTimeout(300)
await page.getByTestId('build-configuration').click()
await page.getByTestId('build-configuration').waitFor({ state: 'visible', timeout: 540000 })
await page.waitForTimeout(600)

const asked = async () => {
  const row = page.locator('[data-testid="build-twister-prices"] [data-twister-price="0"]')
  if (!(await row.count())) return { twists: null, price: null, text: '' }
  return { twists: (await row.locator('td').nth(1).innerText()).trim(), price: (await row.locator('[data-field="price"]').innerText()).trim(), text: (await row.innerText()).replace(/\s+/g, ' ') }
}
const before = await asked()
console.log(`      built with 15: asked ${before.twists}, price ${before.price}`)
ok('built with 15 twists: step 4 says 15 asked', before.twists === '15')

console.log('--- 1. 10 typed after the build, nothing else changed ---')
await step(page, 'rewards').click()
await page.waitForTimeout(300)
await set(page.locator('[data-twister-segment="0"] [data-field="twists"]'), 10)
await step(page, 'build').click()
await page.waitForTimeout(400)
await page.locator('[data-testid="build-twister-prices"]').waitFor({ state: 'attached', timeout: 60000 }).catch(() => {})
let after = await asked()
for (let i = 0; i < 60 && after.twists !== '10'; i += 1) {
  await page.waitForTimeout(1000)
  after = await asked()
}
console.log(`      after typing 10: asked ${after.twists}, price ${after.price}`)
ok(`step 4 says 10 asked, and the price is worked out again (${before.price} -> ${after.price})`, after.twists === '10' && after.price !== before.price)

console.log('--- 2. A reward amount changed too: the build is out of date ---')
await step(page, 'rewards').click()
await page.waitForTimeout(300)
await set(page.locator('[data-target="puzzles"]'), 320)
await set(page.locator('[data-twister-segment="0"] [data-field="twists"]'), 12)
console.log(`      step 3 now holds ${await page.locator('[data-twister-segment="0"] [data-field="twists"]').inputValue()} twists`)
await step(page, 'build').click()
await page.waitForTimeout(1500)
const note = page.locator('[data-testid="build-twister-prices"] [data-twister-price="0"] [data-field="twists-typed-now"]')
const noteText = (await note.count()) ? (await note.innerText()).trim() : ''
console.log(`      out of date, 12 typed: "${noteText}"`)
ok(`an out-of-date build does not show its old twists as if asked now: it says they are what it was built for, and the twists typed now ("${noteText}")`, noteText === 'built for these; 12 typed now - build again' && (await note.getAttribute('data-current')) === 'no')
await page.getByRole('button', { name: /Build the event again/ }).first().click()
await page.waitForTimeout(1500)
await page.getByTestId('build-configuration').waitFor({ state: 'visible', timeout: 540000 })
for (let i = 0; i < 60 && (await asked()).twists?.split('\n')[0] !== '12'; i += 1) await page.waitForTimeout(1000)
const rebuilt = await asked()
ok(`built again: 12 asked, and no note (${rebuilt.twists})`, rebuilt.twists === '12' && (await note.count()) === 0)

ok(`no page error (${errors.join(' | ').slice(0, 200)})`, errors.length === 0)
await browser.close()
process.exit(finish('TWISTS TYPED AFTER A BUILD') ? 1 : 0)
