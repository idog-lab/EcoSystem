// Browser end-to-end: the easy Twister ("give me the twists, get the price")
// and the containers shown in the build flow. See helpers.mjs.
// Run: npx vite-node scripts/e2e/twister-easy.mjs
import { createBoard } from '../../src/features/merge/lib/board.js'
import { applyTwisterDropRule, withDefaultTwisterValues } from '../../src/features/merge/lib/twisterEconomy.js'
import { SAVE_KEY, createChecker, launch, openMerge, tab } from './helpers.mjs'

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
const boards = (b2) => [blankBoard('Board 1', 0, 150), blankBoard('Board 2', 1, b2), blankBoard('Board 3', 2, b2)]

const { browser, page, errors } = await launch({ save: { segments: [{ name: 'Base', boards: boards(600) }, { name: 'Harder', boards: boards(350) }] } })
await openMerge(page)

// Before anything is built: no containers, and the Syntax tab says so (not an old hand-typed table).
await tab(page, 'Syntax').click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Small Reward Weights', exact: true }).click()
await page.waitForTimeout(300)
const emptyHead = await page.locator('table thead th').evaluateAll((els) => els.map((e) => e.innerText.trim()))
ok(`before a build the weights sheet has no containers (${emptyHead.join(' | ')})`, emptyHead.length === 2 && /merge tier/i.test(emptyHead[0]) && /nodrop/i.test(emptyHead[1]))
ok('...and says why, and where they come from', /No containers yet/.test(await page.getByTestId('containers-source').innerText()) && /Build event/.test(await page.getByTestId('containers-source').innerText()))

await tab(page, 'Build event').click()
await page.waitForTimeout(300)
await step(page, 'rewards').click()
await page.waitForTimeout(300)
ok('step 4 has a Containers panel that says they are made by the build', /No containers yet/.test(await page.getByTestId('rewards-containers-empty').innerText()))

// A coin target (the build sets the coin values), then the Twister.
await set(page.locator('[data-target="coins"]'), 3)
const twister = page.getByTestId('build-twister')
ok('the Twister starts off, with one button to add it', (await page.getByTestId('twister-add').isVisible()) && /No Twister in this phase/.test(await twister.innerText()))
await page.getByTestId('twister-add').click()
await page.waitForTimeout(400)
ok('adding it shows one twists field per segment', (await page.locator('[data-twister-segment] [data-field="twists"]').count()) === 8)
ok('...the build sets how many Twister items drop: there is no drop chance to type', (await page.getByTestId('twister-by-build').isVisible()) && (await page.locator('[data-field="twister-rate"]').count()) === 0)
ok('...with working defaults for the rest (counted at the end, any whole price)', (await page.locator('[data-field="twister-checkpoint"]').inputValue()) === '100' && (await page.locator('[data-field="twister-step"]').inputValue()) === '1')
ok('...and says the build needs the twists', await page.getByTestId('twister-needs-twists').isVisible())
ok('...and that the defaults are this tool\'s own', /not confirmed game values/.test(await page.getByTestId('twister-how').innerText()) && /2 \/ 5 \/ 12 \/ 30/.test(await page.getByTestId('twister-how').innerText()))
await set(page.locator('[data-twister-segment="0"] [data-field="twists"]'), 5)
ok('typing the base twists is enough: the other segment follows it', (await page.locator('[data-twister-segment="1"] [data-field="twists"]').getAttribute('placeholder')) === '5 (as base)' && (await page.getByTestId('twister-needs-twists').count()) === 0)
ok('no price yet - the build sets it', /the build sets it/.test(await page.locator('[data-twister-segment="0"] [data-field="twist-price"]').innerText()))
await shot(page, 'twister-easy-step4')

// Build: the price of a twist comes out per segment.
await step(page, 'build').click()
await page.waitForTimeout(300)
const build = async () => {
  await page.getByTestId('build-configuration').click()
  await page.getByTestId('build-configuration').waitFor({ state: 'visible', timeout: 480000 })
  await page.waitForTimeout(500)
}
await build()
const prices = page.getByTestId('build-twister-prices')
ok('the build shows the price of a twist for each segment it built', (await prices.isVisible()) && (await prices.locator('[data-twister-price]').count()) === 2)
const priceOf = async (i) => num(await prices.locator(`[data-twister-price="${i}"] [data-field="price"]`).innerText())
const typicalOf = async (i) => num(await prices.locator(`[data-twister-price="${i}"] [data-field="typical"]`).innerText())
const p0 = await priceOf(0)
const p1 = await priceOf(1)
ok(`each segment gets a price (${p0} and ${p1} Twister DR)`, p0 >= 1 && p1 >= 1)
ok(`...at which its typical player gets about the twists asked (${await typicalOf(0)} and ${await typicalOf(1)} of 5)`, Math.abs((await typicalOf(0)) - 5) <= 1 && Math.abs((await typicalOf(1)) - 5) <= 1)
ok('the segment with less DR on its boards merges more, so its twist costs at least as much', p1 >= p0)
const built = page.getByTestId('build-containers')
const syntaxes = await built.locator('[data-field="container-syntax"]').evaluateAll((els) => els.map((e) => e.innerText.trim()))
ok(`the containers of the build are listed with their weights, the Twister item in some of them (${syntaxes.join(' | ')})`, syntaxes.some((x) => /dr-twister-r\d/.test(x)) && syntaxes.length >= 2 && (await built.locator('[data-container="NoDrop"]').count()) === 1)
ok(`...some as the second item of a container (${syntaxes.filter((x) => /\+dr-twister|dr-twister-r\d\+/.test(x)).join(' | ')})`, syntaxes.some((x) => /dr-twister/.test(x) && x.includes('+')))
ok('...and the build says how it sized the Twister', /The build put a Twister item into/.test(await page.getByTestId('twister-sized').innerText()))
await shot(page, 'twister-easy-build')

// The containers are in step 4 too now.
await step(page, 'rewards').click()
await page.waitForTimeout(300)
ok('step 4 now shows the containers of the last build, with their weights', (await page.getByTestId('rewards-container-table').locator('[data-container]').count()) === syntaxes.length + 1 && /From the last build/.test(await page.getByTestId('rewards-containers-source').innerText()))

// Apply: the prices are written, per segment.
await step(page, 'finalize').click()
await page.waitForTimeout(300)
await page.getByTestId('finalize-apply').click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForTimeout(400)
let saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SAVE_KEY)
const costs = saved.segments.slice(0, 2).map((s) => s.boards[0].twisterSpinCost)
ok(`applying the build sets each segment's own price (${costs.join(' and ')})`, costs[0] === p0 && costs[1] === p1 && saved.segments[0].boards.every((b) => b.twisterSpinCost === p0))
await step(page, 'rewards').click()
await page.waitForTimeout(300)
ok('step 4 shows the price that is set now', num(await page.locator('[data-twister-segment="0"] [data-field="twist-price"]').innerText()) === p0)
ok('...and the containers as "from the last build" or applied, never empty again', (await page.getByTestId('rewards-containers-empty').count()) === 0)

// The Syntax tab exports those containers.
await tab(page, 'Syntax').click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Small Rewards Bank', exact: true }).click()
await page.waitForTimeout(300)
const bank = await page.locator('table tbody tr').evaluateAll((els) => els.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())))
ok(`the Syntax tab exports the same containers (${bank.map((r) => r.join('=')).join(', ')})`, JSON.stringify(bank.map((r) => r[1])) === JSON.stringify(syntaxes) && /From the model/.test(await page.getByTestId('containers-source').innerText()))

// The Twister tool knows where the price came from.
await tab(page, 'Twister').click()
await page.waitForTimeout(500)
ok('the Twister tool says the price was set by the build', (await page.getByText(/set by the build/).count()) >= 1)

// Asking for different twists makes the build out of date, by name.
await tab(page, 'Build event').click()
await page.waitForTimeout(300)
await step(page, 'rewards').click()
await page.waitForTimeout(300)
// Asking for different twists does not make the build out of date: the price just follows.
await set(page.locator('[data-twister-segment="1"] [data-field="twists"]'), 12)
await step(page, 'build').click()
await page.waitForFunction(() => document.querySelector('[data-twister-price="1"] td:nth-child(2)')?.innerText.trim() === '12', null, { timeout: 60000 })
await page.waitForTimeout(300)
ok('changing the twists does not make the build out of date', (await page.getByTestId('build-needs-rebuild').count()) === 0)
const p1b = await priceOf(1)
ok(`...the price is worked out again by itself: more twists for the same income means a lower price (${p1} -> ${p1b} for 12 twists)`, p1b < p1 && Math.abs((await typicalOf(1)) - 12) <= 2)
await page.getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForTimeout(400)
saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SAVE_KEY)
ok(`...and, the build being applied already, the new price is set on that segment (${saved.segments[1].boards[0].twisterSpinCost}) while the other keeps its own (${saved.segments[0].boards[0].twisterSpinCost})`, saved.segments[1].boards[0].twisterSpinCost === p1b && saved.segments[0].boards[0].twisterSpinCost === p0)

// Containers with several items: more likely with every rank, every drop from rank N.
await step(page, 'rewards').click()
await page.waitForTimeout(300)
await set(page.locator('[data-field="multi-drop-rank"]'), 9)
await step(page, 'build').click()
await page.waitForTimeout(300)
await build()
ok('with only coins dropping, the Twister item is the second item: containers with several items still rise with the rank', /rises with every rank/.test(await page.getByTestId('multi-drop-note').innerText()))
await step(page, 'rewards').click()
await page.waitForTimeout(300)
await set(page.locator('[data-target="puzzles"]'), 150)
await step(page, 'build').click()
await page.waitForTimeout(300)
await build()
{
  const note = (await page.getByTestId('multi-drop-note').innerText()).replace(/\s+/g, ' ')
  ok('with a second reward dropping, the build says it: the chance rises with every rank, and from rank 9 every drop holds two or more', /rises with every rank/.test(note) && /makes rank 9 every drop does/.test(note))
  const shares = await page.getByTestId('build-containers').locator('[data-container-summary="multi"] [data-multi-share]').evaluateAll((tds) => tds.map((td) => ({ from: Number(td.dataset.multiShare), pct: parseFloat(td.innerText) })))
  const rising = shares.every((x, i) => i === 0 || x.pct >= shares[i - 1].pct)
  ok(`the containers table shows how many drops hold two or more items, rank by rank (${shares.map((x) => `rank ${x.from}: ${x.pct}%`).join(', ')})`, shares.length >= 4 && shares[0].pct > 0 && shares[0].pct < 100 && rising && shares.at(-1).pct === 100 && shares.find((x) => x.from === 9)?.pct === 100 && shares.filter((x) => x.pct < 100).length >= 3)
  const triples = await page.getByTestId('build-containers').locator('[data-container-summary="triple"] [data-triple-share]').evaluateAll((tds) => tds.map((td) => ({ from: Number(td.dataset.tripleShare), pct: parseFloat(td.innerText) })))
  ok(`...and how many hold three or more: none at the low ranks, every drop from rank 10 (${triples.map((x) => `rank ${x.from}: ${x.pct}%`).join(', ')})`, triples[0].pct === 0 && triples.find((x) => x.from === 10)?.pct === 100)
}
{
  const head = await page.getByTestId('build-containers').locator('thead th').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))
  const rowsOf = await page.getByTestId('build-containers').locator('tbody tr[data-container]:not([data-container="NoDrop"])').evaluateAll((trs) =>
    trs.map((tr) => {
      const cells = [...tr.querySelectorAll('td')].map((td) => td.innerText.replace(/\s+/g, ' ').trim())
      return { syntax: cells[2], last: Number(cells.at(-1).split(' ')[0]) }
    }),
  )
  const late = rowsOf.filter((r) => r.last > 0)
  ok(`the containers table shows each rank of the rise as its own column (${head.slice(3).join(' | ')})`, head.length >= 7 && head.some((h) => /rank 9$/i.test(h)) && /ranks 10/i.test(head.at(-1)))
  ok(`...and from rank 10 every container holds three items, the Twister one among them (${late.map((r) => r.syntax).join(' | ')})`, late.length >= 1 && late.every((r) => r.syntax.split('+').length >= 3) && late.some((r) => /dr-twister-r\d/.test(r.syntax)))
}
await shot(page, 'twister-easy-multi')
// The economist's own numbers: 15 twists, counted at 70% of the phase, a price in steps of 10.
await step(page, 'rewards').click()
await page.waitForTimeout(300)
await set(page.locator('[data-field="twister-checkpoint"]'), 70)
await set(page.locator('[data-field="twister-step"]'), 10)
await set(page.locator('[data-twister-segment="0"] [data-field="twists"]'), 15)
await set(page.locator('[data-twister-segment="1"] [data-field="twists"]'), '')
await step(page, 'build').click()
await page.waitForFunction(() => document.querySelector('[data-twister-price="1"] td:nth-child(2)')?.innerText.trim() === '15', null, { timeout: 90000 })
await page.waitForTimeout(500)
ok('15 twists at a price in steps of 10 need more Twister DR than the last build gives: it says to build again', await page.getByTestId('twister-needs-rebuild').isVisible())
await build()
{
  const t0 = await typicalOf(0)
  const t1 = await typicalOf(1)
  ok(`built again, the build raises the Twister drops: a typical player gets close to 15 twists in both segments (${t0} and ${t1})`, Math.abs(t0 - 15) <= 3 && Math.abs(t1 - 15) <= 3)
  ok(`...at prices that are whole steps of 10 (${await priceOf(0)} and ${await priceOf(1)} Twister DR)`, (await priceOf(0)) % 10 === 0 && (await priceOf(1)) % 10 === 0 && (await priceOf(0)) >= 10)
  const sized = (await page.getByTestId('twister-sized').innerText()).replace(/\s+/g, ' ')
  ok(`...and says what it did ("${sized.slice(0, 110)}...")`, /stays a rank-1 item/.test(sized) && /Twister DR values to \d+ \/ \d+ \/ \d+ \/ \d+/.test(sized) && (await page.getByTestId('twister-needs-rebuild').count()) === 0 && (await page.getByTestId('twister-short').count()) === 0)
}
await shot(page, 'twister-easy-sized')

// Removing the Twister takes its container out.
await step(page, 'rewards').click()
await page.waitForTimeout(300)
await page.getByTestId('twister-remove').click()
await page.waitForTimeout(400)
ok('"Remove the Twister" turns it off again', (await page.getByTestId('twister-add').isVisible()) && (await page.locator('[data-field="twists"]').count()) === 0)

// A drop chance typed by hand in the Twister tool is kept by the build - and can be handed back.
await page.getByTestId('twister-add').click()
await page.waitForTimeout(300)
await tab(page, 'Twister').click()
await page.waitForTimeout(500)
ok('the Twister tool says the build sets the drops', await page.getByTestId('twister-by-build-note').isVisible())
await page.getByTestId('twister-rule-permille').fill('150')
await page.getByTestId('twister-apply-rule').click()
await page.waitForTimeout(400)
await tab(page, 'Build event').click()
await page.waitForTimeout(300)
await step(page, 'rewards').click()
await page.waitForTimeout(300)
ok('a drop chance set in the Twister tool is the economist\'s own: step 4 shows it and offers to hand it back', (await page.locator('[data-field="twister-rate"]').inputValue()) === '150' && (await page.getByTestId('twister-let-build').isVisible()) && (await page.getByTestId('twister-by-build').count()) === 0)
await page.getByTestId('twister-let-build').click()
await page.waitForTimeout(400)
ok('"Let the build set the Twister drops" hands it back', (await page.getByTestId('twister-by-build').isVisible()) && (await page.locator('[data-field="twister-rate"]').count()) === 0)

ok('zero page errors', errors.length === 0)
if (errors.length) console.log(errors.join('\n'))
await browser.close()

// An older save with a fixed Twister drop chance: the build sets the drops from now on.
{
  const old = boards(600).map((b) => {
    const rule = applyTwisterDropRule({ dropGroups: [], dropGroupsConfig: b.dropGroupsConfig, minDropRank: b.minDropRank, itemRank: 1, perMille: 200 })
    const { twisterByBuild: _unset, ...rest } = b
    return { ...rest, rewardChainConfig: withDefaultTwisterValues(b.rewardChainConfig), dropGroups: rule.dropGroups, dropGroupsConfig: rule.dropGroupsConfig }
  })
  const plan = { targetSpins: 15, targetSpinsOverrides: {}, checkpointPct: 70, costIncrement: 10 }
  const second = await launch({ save: { segments: [{ name: 'Base', boards: old, twisterPlan: { main: plan } }] } })
  await openMerge(second.page)
  await tab(second.page, 'Build event').click()
  await second.page.waitForTimeout(300)
  await step(second.page, 'rewards').click()
  await second.page.waitForTimeout(300)
  ok('a save from before, with a fixed Twister drop chance and twists typed, opens with the build setting the drops', (await second.page.getByTestId('twister-by-build').isVisible()) && (await second.page.locator('[data-field="twister-rate"]').count()) === 0 && (await second.page.locator('[data-twister-segment="0"] [data-field="twists"]').inputValue()) === '15')
  ok('...zero page errors there too', second.errors.length === 0)
  await second.browser.close()
}
const fails = finish('Easy Twister E2E')
process.exit(fails === 0 ? 0 : 1)
