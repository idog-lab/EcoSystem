// Browser end-to-end: the easy Twister ("give me the twists, get the price")
// and the containers shown in the build flow. See helpers.mjs.
// Run: npx vite-node scripts/e2e/twister-easy.mjs
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { applyTwisterDropRule, withDefaultTwisterValues } from '../../src/features/merge/lib/rewards/twisterEconomy.js'
import { SAVE_KEY, createChecker, launch, openMerge, tab, syntaxView } from './helpers.mjs'

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
await syntaxView(page, 'Small Reward Weights')
await page.waitForTimeout(300)
const emptyHead = await page.locator('table thead th').evaluateAll((els) => els.map((e) => e.innerText.trim()))
ok(`before a build the weights sheet has no containers (${emptyHead.join(' | ')})`, emptyHead.length === 2 && /merge tier/i.test(emptyHead[0]) && /nodrop/i.test(emptyHead[1]))
ok('...and says why, and where they come from', /No containers yet/.test(await page.getByTestId('containers-source').innerText()) && /Build event/.test(await page.getByTestId('containers-source').innerText()))

await tab(page, 'Build event').click()
await page.waitForTimeout(300)
await step(page, 'rewards').click()
await page.waitForTimeout(300)
ok('the rewards step has no Containers panel: they are shown where they are made, in the build results', (await page.locator('[data-collapsible^="rewards-containers"]').count()) === 0)

// A coin target (the build sets the coin values), then the Twister.
await set(page.locator('[data-target="coins"]'), 3)
const twister = page.getByTestId('build-twister')
ok('the Twister starts off, with one button to add it', (await page.getByTestId('twister-add').isVisible()) && /No Twister in this phase/.test(await twister.innerText()))
await page.getByTestId('twister-add').click()
await page.waitForTimeout(400)
ok('adding it shows one twists field per segment that is built; a segment that is not in sight is not listed as left out', (await page.locator('[data-twister-segment] [data-field="twists"]').count()) === 2 && (await page.getByTestId('twister-left-out').count()) === 0)
ok('...the build sets how many Twister items drop: there is no drop chance to type', (await page.getByTestId('twister-by-build').isVisible()) && (await page.locator('[data-field="twister-rate"]').count()) === 0)
ok('...with the price left to the build (any whole price; rounding is an option, off until a step is typed), and the target said instead of typed: 70-75% of the DR demand', /70-75% of the DR demand/.test(await page.getByTestId('twister-window').innerText()) && (await page.locator('[data-field="twister-checkpoint"]').count()) === 0 && (await page.locator('[data-field="twister-step"]').inputValue()) === '' && /any whole price that makes it work/.test(await page.getByTestId('twister-price-rule').innerText()))
ok('...and says the build needs the twists', await page.getByTestId('twister-needs-twists').isVisible())
ok('...and how the values and the price are chosen, with typed values kept', /kept as typed/.test(await page.getByTestId('twister-how').innerText()) && /2 \/ 5 \/ 12 \/ 30/.test(await page.getByTestId('twister-how').innerText()))
await set(page.locator('[data-twister-segment="0"] [data-field="twists"]'), 5)
ok('typing the base twists is enough: the other segment follows it', (await page.locator('[data-twister-segment="1"] [data-field="twists"]').getAttribute('placeholder')) === '5 (as base)' && (await page.getByTestId('twister-needs-twists').count()) === 0)
ok('there is no price column: one sentence says the build sets the drops and the price', /The build sets how many Twister items drop and the price of a twist \(any whole price that makes it work\)/.test((await page.getByTestId('twister-window').innerText()).replace(/\s+/g, ' ')) && (await page.locator('[data-field="twist-price"]').count()) === 0)
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
// (The twists asked are reached at 70-75% of the demand, so by the end of the phase the typical player has them and some more.)
const perItem = async (i) => num((await prices.locator(`[data-twister-price="${i}"] [data-field="values"]`).innerText()).split('/').at(-1)) / (await priceOf(i))
ok(`...at which its typical player has the twists asked before the phase ends (${await typicalOf(0)} and ${await typicalOf(1)} by the end, 5 asked)`, (await typicalOf(0)) >= 5 && (await typicalOf(1)) >= 5)
const perItem1 = await perItem(1)
ok('the segment with less DR on its boards merges more, so its twist costs at least as much', p1 >= p0)
const built = page.getByTestId('build-containers')
const syntaxes = await built.locator('[data-field="container-syntax"]').evaluateAll((els) => els.map((e) => e.innerText.trim()))
ok(`the containers of the build are listed with their weights, the Twister item in some of them (${syntaxes.join(' | ')})`, syntaxes.some((x) => /dr-twister-r\d/.test(x)) && syntaxes.length >= 2 && (await built.locator('[data-container="NoDrop"]').count()) === 1)
ok(`...alone at the single-item rank and as an extra item in the containers above it (${syntaxes.filter((x) => /dr-twister/.test(x)).join(' | ')})`, syntaxes.some((x) => /^dr-twister-r\d$/.test(x)) && syntaxes.some((x) => /dr-twister/.test(x) && x.includes('+')))
ok('...and the build says how the Twister drops and what differs per segment', /rank 5 drops one rank-1 Twister item/.test(await page.getByTestId('twister-sized').innerText()) && /What differs per segment is the four\s+values and the price/.test(await page.getByTestId('twister-sized').innerText()))
ok('the results say that a merge making a rank 6 drops one item only, and which reward is under the tiles', /makes a rank 6 drops one item only/.test(await page.getByTestId('solo-rank-note').innerText()) && /The reward under the tiles is coins/.test(await page.getByTestId('tile-reward-note').innerText()))
await shot(page, 'twister-easy-build')

// (The containers are shown in the build results only.)
await step(page, 'rewards').click()
await page.waitForTimeout(300)

// Apply: the prices are written, per segment.
await step(page, 'finalize').click()
await page.waitForTimeout(300)
await page.waitForTimeout(600)
await page.getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForTimeout(400)
let saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SAVE_KEY)
const costs = saved.segments.slice(0, 2).map((s) => s.boards[0].twisterSpinCost)
ok(`applying the build sets each segment's own price (${costs.join(' and ')})`, costs[0] === p0 && costs[1] === p1 && saved.segments[0].boards.every((b) => b.twisterSpinCost === p0))
await step(page, 'rewards').click()
await page.waitForTimeout(300)
ok('the rewards step repeats neither the price nor the containers: both are in the build results', (await page.locator('[data-field="twist-price"]').count()) === 0 && (await page.getByTestId('rewards-container-table').count()) === 0)

// The Syntax tab exports those containers.
await tab(page, 'Syntax').click()
await page.waitForTimeout(300)
await syntaxView(page, 'Small Rewards Bank')
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
ok(`...the values and the price are fitted again by themselves: more twists for the same income means a finished item pays for more twists (${perItem1.toFixed(2)} -> ${(await perItem(1)).toFixed(2)} twists an item; price ${p1} -> ${p1b})`, (await perItem(1)) > perItem1 && (await typicalOf(1)) >= 12)
await page.getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForTimeout(400)
saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SAVE_KEY)
ok(`...and, the build being applied already, the new price is set on that segment (${saved.segments[1].boards[0].twisterSpinCost}) while the other keeps its own (${saved.segments[0].boards[0].twisterSpinCost})`, saved.segments[1].boards[0].twisterSpinCost === p1b && saved.segments[0].boards[0].twisterSpinCost === p0)

// Containers with several items: more likely with every rank, every drop from rank N.
await step(page, 'rewards').click()
await page.waitForTimeout(300)
ok('step 4: rank 6 is the single-item rank, coins are the reward under the tiles, and the two- and three-item ranks are there', (await page.locator('[data-field="solo-drop-rank"]').inputValue()) === '6' && (await page.locator('[data-tile-reward="coins"]').getAttribute('aria-checked')) === 'true' && (await page.locator('[data-field="multi-drop-rank"]').count()) === 1 && (await page.locator('[data-field="triple-drop-rank"]').count()) === 1)
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
  ok(`the containers table shows how many drops hold two or more items, rank by rank: none at ranks 5 and 6, every drop at rank 7 (the reward and the Twister item) and from rank 9 (${shares.map((x) => `rank ${x.from}: ${x.pct}%`).join(', ')})`, shares.length >= 4 && shares.find((x) => x.from === 6).pct === 0 && shares.filter((x) => x.from < 6).every((x) => x.pct === 0) && shares.find((x) => x.from === 7).pct === 100 && shares.at(-1).pct === 100 && shares.filter((x) => x.from >= 9).every((x) => x.pct === 100))
  const triples = await page.getByTestId('build-containers').locator('[data-container-summary="triple"] [data-triple-share]').evaluateAll((tds) => tds.map((td) => ({ from: Number(td.dataset.tripleShare), pct: parseFloat(td.innerText) })))
  ok(`...and how many hold three or more: every drop from rank 10 (${triples.map((x) => `rank ${x.from}: ${x.pct}%`).join(', ')})`, triples.filter((x) => x.from >= 10).every((x) => x.pct === 100) && triples.some((x) => x.pct < 100))
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
  ok(`the containers table shows each rank of the rise as its own column (${head.slice(3).join(' | ')})`, head.length >= 7 && head.some((h) => /rank 9$/i.test(h)) && head.some((h) => /ranks? 10/i.test(h)))
  ok(`...and from rank 10 every container holds three items, the Twister one among them (${late.map((r) => r.syntax).join(' | ')})`, late.length >= 1 && late.every((r) => r.syntax.split('+').length >= 3) && late.some((r) => /dr-twister-r\d/.test(r.syntax)))
}
await shot(page, 'twister-easy-multi')
// The economist's own numbers: 15 twists, counted at 70% of the phase, a price in steps of 10.
await step(page, 'rewards').click()
await page.waitForTimeout(300)
await set(page.locator('[data-field="twister-step"]'), 10)
await set(page.locator('[data-twister-segment="0"] [data-field="twists"]'), 15)
await set(page.locator('[data-twister-segment="1"] [data-field="twists"]'), '')
await step(page, 'build').click()
await page.waitForFunction(() => document.querySelector('[data-twister-price="1"] td:nth-child(2)')?.innerText.trim() === '15', null, { timeout: 90000 })
await page.waitForTimeout(500)
ok('15 twists at a price in steps of 10 are fitted on the boards already built: nothing has to be built again for it', (await page.getByTestId('twister-needs-rebuild').count()) === 0 && (await priceOf(1)) % 10 === 0)
await build()
{
  const t0 = await typicalOf(0)
  const t1 = await typicalOf(1)
  // (A price is a whole number of steps of 10, so with about 150 Twister DR to share out a typical player lands within a few twists of 15, not on it.)
  ok(`built again, a typical player gets the 15 twists or a few more in both segments (${t0} and ${t1})`, t0 >= 15 && t1 >= 15 && t0 <= 25 && t1 <= 25)
  ok(`...at prices that are whole steps of 10 (${await priceOf(0)} and ${await priceOf(1)} Twister DR)`, (await priceOf(0)) % 10 === 0 && (await priceOf(1)) % 10 === 0 && (await priceOf(0)) >= 10)
  const sized = (await page.getByTestId('twister-sized').innerText()).replace(/\s+/g, ' ')
  ok(`...and says what it did ("${sized.slice(0, 110)}...")`, /rank 5 drops one rank-1 Twister item/.test(sized) && /simplest numbers that land in the\s+window/.test(sized) && (await page.getByTestId('twister-needs-rebuild').count()) === 0 && (await page.getByTestId('twister-short').count()) === 0)
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
