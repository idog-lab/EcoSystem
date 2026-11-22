// Browser end-to-end: the Twister's two drop rules, demand as the DR a player
// really pays, and Twister values and prices fitted per segment to the
// 70-75% window. (Economist, by written briefs: "A main-chain merge creating
// rank 5 drops exactly one rank-1 Twister item", "rank 7 always drops two
// items", "The demand entered for a segment is the intended average DR its
// player actually pays", "Target the requested spin count at 70-75% of
// configured demand spent".)
// Run: npx vite-node scripts/e2e/twister-timing.mjs
import ExcelJS from 'exceljs'
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
const flat = (text) => String(text).replace(/\s+/g, ' ').trim()

function blankBoard(name, index, budget) {
  const b = createBoard(name, { rows: index === 0 ? 5 : 3, cols: 8 })
  const from = index === 0 ? 3 : 1
  b.tiles = b.tiles.map((row, r) => row.map(() => (r >= from ? 'blocked' : 'open')))
  if (index === 0) b.tiles[2][4] = 'semi'
  b.blockedValue = budget
  return b
}
const boards = (b2, b3) => [blankBoard('Board 1', 0, 150), blankBoard('Board 2', 1, b2), blankBoard('Board 3', 2, b3)]

const { browser, page, errors } = await launch({
  save: { segments: [{ name: 'Lots of subsidy', boards: boards(720, 880) }, { name: 'Little subsidy', boards: boards(250, 300) }] },
})
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
await set(page.locator('[data-field="twister-step"]'), 10)

console.log('--- 1. Step 4: the rules, said ---')
{
  const rules = flat(await page.getByTestId('twister-rules').innerText())
  ok(`step 4 says how the Twister drops ("${rules.slice(0, 90)}...")`, /rank 5 drops exactly one rank-1 Twister item/.test(rules) && /rank 7 always drops two items/.test(rules) && /still start at rank 6/.test(rules))
  ok('...and the target instead of a "counted at" field: 70-75% of the DR demand', /70-75% of the DR demand/.test(flat(await page.getByTestId('twister-window').innerText())) && (await page.locator('[data-field="twister-checkpoint"]').count()) === 0 && (await page.locator('[data-field="twister-steady"]').count()) === 0)
  ok('...and that each segment gets its own values and price', /its own four Twister DR values and its own price of a twist/.test(flat(await page.getByTestId('twister-how').innerText())))
}

await step(page, 'build').click()
await page.waitForTimeout(300)
await page.getByTestId('build-configuration').click()
await page.getByTestId('build-configuration').waitFor({ state: 'visible', timeout: 540000 })
await page.waitForTimeout(600)

console.log('--- 2. Step 6: what the player pays against the demand ---')
{
  const rows = await page.locator('[data-testid="build-coverage"] [data-coverage-segment]').evaluateAll((trs) =>
    trs.map((tr) => ({ demand: tr.querySelector('[data-cell="demand"]')?.innerText.trim(), paid: tr.querySelector('[data-cell="paid"]')?.innerText.trim(), within: tr.querySelector('[data-cell="paid"]')?.dataset.within, calibration: tr.querySelector('[data-cell="calibration"]')?.innerText.trim() })),
  )
  const built = rows.filter((r) => r.demand && r.demand !== '—')
  ok(`the calibration is shown with its sign - taken off (−) or added (+) (${built.map((r) => r.calibration).join(', ')})`, built.every((r) => /^[−+] [\d,.]+ DR$/.test(r.calibration)))
  ok(`the segment table shows the DR demand and what the average player pays (${built.map((r) => `${r.demand}: ${r.paid}`).join('; ')})`, built.length === 2 && num(built[0].demand) === 298 && num(built[1].demand) === 1348 && built.every((r) => /DR \([+-]?\d/.test(r.paid)))
  ok(`...within a few percent of it, with what was taken off the boards to get there - or flagged, when nothing more can be done (${built.map((r) => `${r.calibration}, ${r.within === 'yes' ? 'met' : 'flagged'}`).join('; ')})`, built.every((r) => /DR/.test(r.calibration) && (r.within === 'yes' ? Math.abs(num(r.paid) / num(r.demand) - 1) <= 0.05 : true)) && built.some((r) => r.within === 'yes'))
  const box = page.getByTestId('review-demand')
  const text = flat(await box.innerText())
  ok(`the segment's own page gives the demand, the average and the middle player, the difference and who finishes ("${text.slice(0, 80)}...")`, /DR demand you typed/.test(text) && /Average player pays/.test(text) && /Middle player pays/.test(text) && /Difference/.test(text) && /Finish the phase 100%/.test(text) && /besides the merge-energy 80%/.test(text) && ((await box.getAttribute('data-within')) === 'yes' || /proven limit|did not settle/.test(text)) && /took .* more off the later boards|put .* back on the later boards/.test(text))
}

console.log('--- 3. Step 6: the containers and the Twister ---')
const priceRows = async () =>
  page.locator('[data-testid="build-twister-prices"] [data-twister-price]').evaluateAll((trs) =>
    trs.map((tr) => ({
      verdict: tr.dataset.verdict,
      name: tr.querySelector('td')?.innerText.trim(),
      values: tr.querySelector('[data-field="values"]')?.innerText.trim(),
      price: tr.querySelector('[data-field="price"]')?.innerText.trim(),
      typical: tr.querySelector('[data-field="typical"]')?.innerText.trim(),
      finish: tr.querySelector('[data-field="finish"]')?.innerText.replace(/\s+/g, ' ').trim(),
      pace: tr.querySelector('[data-field="pace"]')?.dataset.pace,
      by: tr.querySelector('[data-field="by"]')?.innerText.trim(),
      chances: tr.querySelector('[data-field="chances"]')?.innerText.replace(/\s+/g, ' ').trim(),
      // (the note has a line of its own under the segment's row)
      note: document.querySelector('[data-twister-note="' + tr.dataset.twisterPrice + '"] [data-field="note"]')?.innerText.trim(),
      marks: [...tr.querySelectorAll('[data-mark] [data-field="twists"]')].map((el) => Number(el.innerText.match(/\d+/)?.[0])),
    })),
  )
{
  const head = await page.locator('[data-testid="containers-table"] thead th, [data-testid="build-containers"] thead th').evaluateAll((ths) => ths.map((th) => th.innerText.replace(/\s+/g, ' ').trim()))
  ok(`the containers table has a column for the merges that make rank 5 (${head.filter((h) => /rank/i.test(h)).slice(0, 3).join(' | ')})`, head.some((h) => /rank 5$/i.test(h)) && head.some((h) => /rank 6$/i.test(h)))
  const rows = await priceRows()
  const strict = (text) => {
    const v = text.split('\n')[0].split('/').map((x) => Number(x.trim()))
    return v.length === 4 && v[1] > 2 * v[0] && v[2] > 2 * v[1] && v[3] > 2 * v[2]
  }
  ok(`each segment has its own four Twister values and its own price (${rows.map((r) => `${r.name}: ${r.values.split('\n')[0]} at ${r.price}`).join('; ')})`, rows.length === 2 && rows.every((r) => strict(r.values) && /^\d+ Twister DR$/.test(r.price) && num(r.price) % 10 === 0))
  ok(`...and says when its typical player has the twists, in % of the DR demand, against the 70-75% target (${rows.map((r) => `${r.finish} ${r.verdict}`).join('; ')})`, rows.every((r) => /\d+%|not by the end/.test(r.finish) && ['in-window', 'early', 'late', 'never'].includes(r.verdict) && ['on-track', 'early', 'late'].includes(r.pace)) && /TARGET 70-75%/i.test(await page.getByTestId('build-twister-prices').innerText()))
  ok(`a segment in the window carries no warning; one outside it says how far and where the twists can land`, rows.every((r) => (r.verdict === 'in-window' ? !/not at 70-75%/.test(r.note) : /not at 70-75%|does not reach/.test(r.note))))
  ok(`the typical player gets the twists asked or a few more, and the twists by 25/50/70/75/100% never go down (${rows.map((r) => r.marks.join('/')).join('; ')})`, rows.every((r) => num(r.typical) >= 15 && r.marks.length === 5 && r.marks.every((m, k) => k === 0 || m >= r.marks[k - 1])))
  ok(`how the twists arrive is shown apart from when: chances to spin, and in play / only at the end / never (${rows.map((r) => `${r.chances}; ${r.by}`).join(' | ')})`, rows.every((r) => /\d+ × \d/.test(r.chances) && /^\d+ \/ \d+ \/ \d+$/.test(r.by)))
  const track = page.getByTestId('twister-track')
  ok(`one line says how many segments land in the window ("${flat(await track.innerText()).slice(0, 100)}...")`, /window/.test(await track.innerText()) && Number(await track.getAttribute('data-asked')) === 2 && Number(await track.getAttribute('data-in-window')) === rows.filter((r) => r.verdict === 'in-window').length)
  const sized = flat(await page.getByTestId('twister-sized').innerText())
  ok('the panel says what the clock is and that Twister DR is its own currency', /rank 5 drops one rank-1 Twister item/.test(sized) && /its own currency/.test(sized) && /paid generator DR ÷ the DR demand/.test(flat(await page.locator('body').innerText())))
}

console.log('--- 4. The experiment stays an experiment ---')
{
  const before = (await priceRows()).map((r) => `${r.values}|${r.price}`)
  const box = page.getByTestId('twister-experiments')
  ok('bigger Twister items at ranks 7 to 9 are offered as an experiment that changes nothing, with rank 5 left alone', /An experiment/.test(await box.innerText()) && /rank 5 keeps its one rank-1 item/.test(flat(await box.innerText())) && /Nothing here changes the build or a drop rule/.test(flat(await box.innerText())))
  await page.getByTestId('twister-experiments-run').click()
  const table = page.getByTestId('twister-experiments-table')
  await table.waitFor({ state: 'visible', timeout: 300000 })
  const rows = await table.locator('[data-experiment]').evaluateAll((trs) =>
    trs.map((tr) => ({ id: tr.dataset.experiment, reach: tr.querySelector('[data-field="reach"]')?.innerText.trim(), distance: tr.querySelector('[data-field="distance"]')?.innerText.trim(), chances: tr.querySelector('[data-field="chances"]')?.innerText.trim(), others: tr.querySelector('[data-field="others"]')?.innerText.replace(/\s+/g, ' ').trim() })),
  )
  ok(`this build and the same drops with bigger items, side by side (${rows.map((r) => `${r.id}: ${r.reach}, ${r.distance} outside, ${r.chances}`).join(' | ')})`, rows.length === 2 && rows[0].id === 'current' && rows[1].id === 'bigger79' && rows.every((r) => /\d+%|not reached/.test(r.reach) && /points|—/.test(r.distance) && /\d+ × \d/.test(r.chances)))
  ok(`...with more chances to spin for the bigger items, and the other rewards measured beside it (${rows[1].others})`, num(rows[1].chances) >= num(rows[0].chances) && /^\d+ \/ \d+ \/ \d+ \/ \d+/.test(rows[1].others) && rows[1].others.split('/').every((x) => Math.abs(num(x) - 100) <= 5))
  ok('running it changed nothing in the build', JSON.stringify((await priceRows()).map((r) => `${r.values}|${r.price}`)) === JSON.stringify(before))
  await box.scrollIntoViewIfNeeded()
  await shot(page, 'twister-timing')
}

console.log('--- 5. Applied: the values and prices reach the export and the play screen ---')
{
  const rows = await priceRows()
  await step(page, 'finalize').click()
  await page.waitForTimeout(400)
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(500)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('merge-mania-board-simulator')))
  const twisterOf = (i) => saved.segments[i].boards[0].rewardChainConfig.twister.map((r) => r.prizeAmount).join(' / ')
  ok(`after Apply each segment's boards hold its own Twister values and price (${[0, 1].map((i) => `${twisterOf(i)} at ${saved.segments[i].boards[0].twisterSpinCost}`).join('; ')})`, [0, 1].every((i) => twisterOf(i) === rows[i].values.split('\n')[0] && saved.segments[i].boards[0].twisterSpinCost === num(rows[i].price)))
  const table5 = saved.segments[0].boards[0].dropGroupsConfig[4]
  ok('...and the one drop table with the rank-5 Twister row, the same in both segments', table5.belowStart === true && table5.entries.length === 1 && JSON.stringify(saved.segments[1].boards[0].dropGroupsConfig) === JSON.stringify(saved.segments[0].boards[0].dropGroupsConfig) && saved.segments[0].boards[0].minDropRank === 6)
  await tab(page, 'Syntax').click()
  await page.waitForTimeout(600)
  const download = async (name) => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name }).click()])
    const book = new ExcelJS.Workbook()
    await book.xlsx.readFile(await dl.path())
    return book
  }
  await page.locator('[data-scope="all"]').click()
  await page.waitForTimeout(150)
  const all = await download('Download combined workbook').catch(() => null)
  if (all) {
    const cells = (name) => {
      const out = []
      all.getWorksheet(name)?.eachRow((row) => out.push(row.values.slice(1).join(' ')))
      return out
    }
    const twisterLines = (name) => cells(name).filter((line) => /twister/i.test(line))
    ok(`the all-segments workbook: each segment's Small Rewards sheet has its own Twister values (S1: ${twisterLines('S1 Small Rewards').map((l) => l.match(/\d+(?=\)\])/)?.[0]).join('/')}; S2: ${twisterLines('S2 Small Rewards').map((l) => l.match(/\d+(?=\)\])/)?.[0]).join('/')})`, [0, 1].every((i) => rows[i].values.split('\n')[0].split('/').every((v) => twisterLines(`S${i + 1} Small Rewards`).some((line) => new RegExp(`\\b${v.trim()}\\b`).test(line)))))
    const weights = cells('Small Reward Weights')
    ok('...and Small Reward Weights has merge tier 5 dropping a container', weights.some((line) => /^5 /.test(line) && / 1000 /.test(` ${line} `)))
  } else {
    ok('the all-segments workbook downloads', false)
  }
}

ok('zero page errors', errors.length === 0)
await browser.close()
const fails = finish('TWISTER TIMING')
process.exit(fails === 0 ? 0 : 1)
