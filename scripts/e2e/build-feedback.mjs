// Browser end-to-end: the economist's review feedback on the Build event flow.
//   - only coins may be a fraction (derived targets, rank values, display);
//   - rank values that do not reward merging can be fixed from the flow;
//   - the build sets the coin rank values, separately per segment;
//   - the editor's inputs (event settings, milestone rewards, drop rules) are
//     in the flow, and one action builds the whole event (Normal +
//     Recompletion), applied together in step 5;
//   - the per-segment result table is in plain words;
//   - the Twister page says how to use it.
// See helpers.mjs for how to run.
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { SAVE_KEY, createChecker, launch, openMerge, tab, syntaxView } from './helpers.mjs'

const { ok, finish } = createChecker()
const SHOT = process.env.E2E_SCREENSHOT_DIR ?? null
const shot = async (page, name) => {
  if (SHOT) await page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: true })
}
const num = (text) => Number(String(text).replace(/,/g, '').match(/-?\d+(\.\d+)?/)?.[0])
const step = (page, id) => page.locator(`[data-step="${id}"]`)
const set = async (locator, value) => {
  await locator.fill(String(value))
  await locator.blur()
}

function blankBoard(name, index, budget) {
  const b = createBoard(name, { rows: index === 0 ? 5 : 3, cols: 8 })
  const from = index === 0 ? 3 : 1
  b.tiles = b.tiles.map((row, r) => row.map(() => (r >= from ? 'blocked' : 'open')))
  if (index === 0) b.tiles[2][4] = 'semi'
  b.blockedValue = budget
  // These journeys ask for one or two small rewards. Every merge from the
  // start rank drops, so the start rank has to suit the amount (from rank 9 a
  // player makes about 15 such merges; from rank 6, about 80).
  b.minDropRank = 9
  return b
}
const lists = (b2) => ({ boards: [blankBoard('Board 1', 0, 150), blankBoard('Board 2', 1, b2)], recompletionBoards: [blankBoard('Board 1', 0, 300), blankBoard('Board 2', 1, 4500)] })

const { browser, page, errors } = await launch({
  save: { segments: [{ name: 'Base', ...lists(600) }, { name: 'Bigger', ...lists(800), segmentFactor: 1.15 }, { name: 'Biggest', ...lists(900), segmentFactor: 1.25 }] },
})
await openMerge(page)

// ---- The editor, as steps of the flow ----
ok('the flow has five steps; the generator and the effort shape are sections of step 1 and step 4', (await page.locator('[data-step]').evaluateAll((els) => els.map((e) => e.dataset.step).join(','))) === 'setup,layouts,rewards,build,finalize')

// Step 1, its last section: generator multipliers, lucky drops, dates and CC
await step(page, 'setup').click()
await page.waitForTimeout(200)
const tiersText = await page.getByTestId('generator-tiers').innerText()
ok('the three multipliers are shown with what they cost and give', /×1/.test(tiersText) && /×2/.test(tiersText) && /×4/.test(tiersText) && /4 DR/.test(tiersText) && /a rank-3 item/.test(tiersText) && /always open/.test(tiersText))
ok('the unlock ranks are the editor\'s own (7 and 10)', (await page.locator('[data-field="tier2-unlock"]').inputValue()) === '7' && (await page.locator('[data-field="tier4-unlock"]').inputValue()) === '10')
await set(page.locator('[data-field="tier2-unlock"]'), 6)
await page.waitForTimeout(200)
ok('changing an unlock rank offers to use it for every segment', await page.getByTestId('tiers-copy-all').isVisible())
await page.getByTestId('tiers-copy-all').click()
await page.waitForTimeout(250)
ok('...and one click copies it', (await page.getByTestId('tiers-copy-all').count()) === 0)
const chance = (i) => page.locator(`[data-lucky-outcome="${i}"] td`).nth(1).innerText()
ok(`lucky-drop chances are shown for the value typed (${await chance(0)} / ${await chance(1)} / ${await chance(2)})`, (await chance(0)) === '92.9%' && (await chance(1)) === '5.7%' && (await chance(2)) === '1.4%')
ok('lucky drops say when they start (the rank that opens ×2)', (await page.getByText('Lucky drops start once the player holds a rank-6 item').count()) === 1)
await set(page.locator('[data-field="target-ev"]'), 1.2)
await page.waitForTimeout(200)
ok(`the chances follow the value (${await chance(1)} for +1 at 1.2)`, num(await chance(1)) > 5.7)
await page.waitForTimeout(300)
ok('there is no "try it" button: the chance table is what the setting gives', (await page.getByTestId('lucky-sim').count()) === 0 && (await page.locator('[data-lucky-outcome]').count()) === 3)
await set(page.locator('[data-field="target-ev"]'), 1.1)
ok('event dates and CC are here too', (await page.locator('[data-field="event-start"]').isVisible()) && (await page.locator('[data-field="cc"]').count()) === 2)
await shot(page, 'f0-generator')

// Step 4, above the Build button: the effort shape
await step(page, 'build').click()
await page.waitForTimeout(200)
ok('with nothing typed there is nothing to suggest', await page.getByTestId('effort-suggest').isDisabled())
await page.getByTestId('effort-current').click()
await page.waitForTimeout(600)
ok('the distribution of the current split can be shown', /The player spends [\d,]+ DR/.test(await page.getByTestId('effort-current-summary').innerText()))
for (const [rank, value] of [[9, 10], [10, 15], [11, 25], [12, 50]]) await page.locator(`[data-effort-rank="${rank}"]`).fill(String(value))
await page.waitForTimeout(150)
ok('a target shape enables the suggestion for every segment with an amount', (await page.getByTestId('effort-suggest').innerText()).includes('3 segments'))
await page.getByTestId('effort-suggest').click()
await page.getByTestId('effort-suggestion').waitFor({ state: 'visible', timeout: 120000 })
await page.waitForTimeout(300)
const suggested = async (seg) => (await page.locator(`[data-effort-segment="${seg}"] [data-cell="suggested"]`).innerText()).split('/').map((v) => Number(v.trim()))
const s0 = await suggested(0)
const s2 = await suggested(2)
ok(`each segment keeps its total and Board 1 stays within 150 (${s0.join(' / ')} and ${s2.join(' / ')})`, s0[0] + s0[1] === 750 && s2[0] + s2[1] === 1050 && s0[0] <= 150 && s2[0] <= 150)
ok('asked and achieved shares are shown per rank, with the chart', (await page.getByTestId('effort-achieved').innerText()).includes('asked') && (await page.getByTestId('effort-achieved').innerText()).includes('gets'))
await shot(page, 'f0-effort')
await page.getByTestId('effort-apply').click()
await page.waitForTimeout(400)
ok('using the split is confirmed and stays on screen', (await page.getByTestId('effort-apply').innerText()).includes('Split applied') && (await page.getByTestId('effort-stale').count()) === 0)
await step(page, 'setup').click()
await page.waitForTimeout(200)
const budgetsNow = await page.locator('[data-setup-segment="0"] [data-field="budget"]').evaluateAll((els) => els.map((e) => Number(e.value)))
ok(`step 1 now holds the split (${budgetsNow.join(' / ')})`, JSON.stringify(budgetsNow) === JSON.stringify(s0))

// ---- Step 3: whole numbers, ladder fixes, coin values, milestones ----
await step(page, 'rewards').click()
await page.waitForTimeout(200)
const target = (type) => page.locator(`[data-target="${type}"]`)
await set(target('coins'), 3)
await set(target('puzzles'), 150.4)
await set(target('energy'), 150)
await page.waitForTimeout(250)
ok('a puzzle target typed as 150.4 becomes 150 - only coins can be a fraction', (await target('puzzles').inputValue()) === '150')
const derived = (seg, type) => page.locator(`[data-derived-segment="${seg}"] [data-derived="${type}"]`).innerText()
ok(`derived puzzle targets are whole numbers (×1.15 -> ${await derived(1, 'puzzles')}, ×1.25 -> ${await derived(2, 'puzzles')})`, (await derived(1, 'puzzles')) === '173' && (await derived(2, 'puzzles')) === '188')
ok(`derived coin targets keep their fraction (${await derived(1, 'coins')}, ${await derived(2, 'coins')})`, (await derived(1, 'coins')) === '3.45' && (await derived(2, 'coins')) === '3.75')
ok('the table says how amounts are rounded', (await page.getByTestId('derived-targets').locator('xpath=../..').innerText()).includes('rounded to the nearest whole number'))

const problem = page.locator('[data-ladder-problem="puzzles"]')
ok('the puzzle rank values are flagged with every problem and why it matters', (await problem.innerText()).includes('merging does not pay off') && (await problem.locator('li').count()) >= 2 && (await problem.innerText()).includes('Why it matters'))
ok('two ready-made fixes are offered, with the values they would set (every rank more than double the one below)', (await page.locator('[data-ladder-fix="puzzles-raise"]').innerText()).includes('5 / 15 / 35 / 75') && (await page.locator('[data-ladder-fix="puzzles-lower"]').innerText()).includes('3 / 7 / 15 / 40'))
await shot(page, 'f1-ladder-problem')
await page.locator('[data-ladder-fix="puzzles-raise"]').click()
await page.waitForTimeout(300)
ok('choosing a fix writes the values and clears the warning', (await page.locator('[data-definition="puzzles"]').innerText()).includes('5 / 15 / 35 / 75') && (await page.locator('[data-ladder-problem="puzzles"]').count()) === 0)
ok('rank values can still be typed by hand', (await page.locator('[data-edit-ranks="puzzles"]').count()) === 1)
ok('coins are set by the build, with nothing to type', (await page.locator('[data-definition="coins"]').getAttribute('data-coin-mode')) === 'auto' && (await page.getByTestId('coin-values').innerText()).includes('appear here after the build'))
ok('the rewards step states the two rules: every merge drops a container, and tile rewards start semi-blocked', /every merge drops/.test(await page.getByTestId('drop-rules').locator('xpath=..').innerText()) && /container can hold several rewards/.test(await page.getByTestId('drop-rules').locator('xpath=..').innerText()) && (await page.getByTestId('tile-reward-rule').innerText()).includes('semi-blocked when its tile opens'))
ok('merge-drop start rank and the leftover rule are in the flow', (await page.locator('[data-field="min-drop-rank"]').isVisible()) && (await page.locator('[data-field="leftover-policy"]').isVisible()))

await page.locator('[data-milestone-rank="5"]').click()
await page.waitForTimeout(150)
await page.locator('[data-milestone-syntax="5"]').fill('coins:50')
await page.waitForTimeout(150)
ok('a milestone reward can be set in the flow (rank 5)', (await page.locator('[data-milestone-rank="5"]').getAttribute('aria-pressed')) === 'true' && (await page.locator('[data-milestone-syntax="5"]').inputValue()) === 'coins:50')

// ---- Step 4: one action builds the whole event ----
await step(page, 'build').click()
await page.waitForTimeout(200)
ok('nothing is listed as missing before the build: the coin values are the build\'s to set', (await page.getByTestId('build-readiness').count()) === 0 && (await page.getByTestId('build-whole-event').isEnabled()))
await page.getByTestId('build-whole-event').click()
await page.getByTestId('build-all-result').waitFor({ state: 'visible', timeout: 480000 })
await page.waitForTimeout(300)
const allText = await page.getByTestId('build-all-result').innerText()
ok(`one click builds Normal and Recompletion ("${allText.slice(0, 90)}...")`, /Normal: 3 segments built/.test(allText) && /Recompletion: 3 segments built/.test(allText))

const coverage = page.getByTestId('build-coverage')
const header = (await coverage.locator('thead').innerText()).toLowerCase()
ok('the per-segment table uses plain column names', header.includes('dr you gave the boards') && header.includes('taken off for merge energy') && header.includes('dr placed under tiles') && header.includes('what to look at'))
ok('...and explains each of them above the table', (await page.getByTestId('coverage-legend').innerText()).includes('free generator taps'))
// (The accounting table sits in a folded section now; the summary above it is read too.)
const coverageText = (await page.locator('details', { has: coverage }).first().innerText()) + ' ' + (await page.getByTestId('build-summary').innerText())
const jargon = coverageText.match(/.{0,70}(infeasible|coarse|eligible tile capacity|shared drop odds|energy credit|ladder).{0,50}/i)
ok(`no solver jargon in the per-segment results${jargon ? ` (found: "...${jargon[0].replace(/\s+/g, ' ')}...")` : ''}`, !jargon)
const given = num(await coverage.locator('[data-coverage-segment="0"] td').nth(2).innerText())
const taken = num(await coverage.locator('[data-coverage-segment="0"] td').nth(3).innerText())
// (signed: "−" taken off, "+" added)
const calibrationText = (await coverage.locator('[data-coverage-segment="0"] [data-cell="calibration"]').innerText()).trim()
const calibrated = (calibrationText.startsWith('+') ? -1 : 1) * num(calibrationText)
const placed = num(await coverage.locator('[data-coverage-segment="0"] td').nth(5).innerText())
// (Drops start at rank 9 here - about 15 merges - so merge energy comes in a few whole prizes and the passes of a build
// settle to within a few DR, not always within four. The DR box shows that difference.)
ok(`the numbers add up for the base segment: what you gave, less the merge-energy credit, less what was taken off so the player pays the demand (${given} - ${taken} - ${calibrated} ≈ ${placed})`, given === 750 && Math.abs(given - taken - calibrated - placed) <= 8)
await shot(page, 'f2-coverage')

ok('the review states which reward ranks each board may hold', /Board 1 none, Board 2 rank 1 and 2/.test(await page.locator('details', { has: page.getByTestId('built-boards') }).first().innerText()))
{
  const chips = async (board) => page.locator(`[data-built-board="${board}"] [data-cell="queue"] span[title^="Reward item"]`).evaluateAll((els) => els.map((e) => e.title))
  const b1 = await chips(0)
  const b2 = await chips(1)
  ok(`Board 1 holds no small reward (${b1.length}); Board 2 holds reward items of rank 1 and 2, all one reward (${b2.join(', ')})`, b1.length === 0 && b2.length > 0 && b2.every((t) => / R[12]$/.test(t)) && new Set(b2.map((t) => t.replace(/ R\d$/, ''))).size === 1)
}
{
  const queue = await page.locator('[data-built-board="0"] [data-cell="queue"] span').evaluateAll((els) => els.map((e) => e.innerText.trim()))
  const rewardsOnBoard1 = queue.filter((t) => / R\d$/.test(t)).length
  const mainOnly = queue.filter((t) => /^\d+$/.test(t))
  ok(`Board 1's queue opens with a run of 1s and 2s (${queue.slice(0, 8).join(' ')})`, mainOnly.slice(0, 3).join(' ') === '1 1 2')
  ok(`Board 1 is mostly low-rank items, with only a few reward items (${rewardsOnBoard1} of ${queue.length})`, rewardsOnBoard1 <= 2 && mainOnly.filter((t) => Number(t) <= 2).length >= mainOnly.length / 2)
  const dropLine = await page.getByTestId('drop-start').innerText()
  ok(`the results say where drops start and that every merge from there drops ("${dropLine.slice(0, 80)}...")`, /every merge that makes a rank \d+ or higher item drops one container/.test(dropLine))
  // The containers the build made, with their weights.
  const containers = page.getByTestId('build-containers')
  const keys = await containers.locator('[data-container]').evaluateAll((els) => els.map((e) => e.dataset.container))
  const syntaxes = await containers.locator('[data-field="container-syntax"]').evaluateAll((els) => els.map((e) => e.innerText.trim()))
  ok(`the build shows its containers (${keys.join(', ')}): ${syntaxes.join(' | ')}`, keys[0] === 'ContA' && keys.at(-1) === 'NoDrop' && keys.length >= 3 && syntaxes.every((s) => /^[a-z-]+-r\d(\+[a-z-]+-r\d)*$/.test(s)))
  ok('...each a different drop', new Set(syntaxes).size === syntaxes.length)
  const weightCells = await containers.locator('[data-container="ContA"] td').evaluateAll((els) => els.map((e) => e.innerText.trim()))
  const weightShown = weightCells.find((cell) => /^\d+ \(\d+(\.\d)?%\)$/.test(cell))
  ok(`...with a weight per merge rank (ContA: ${weightShown ?? weightCells.slice(-3).join(' / ')})`, !!weightShown)
  globalThis.__builtContainers = syntaxes
}
ok('the built boards are shown in the review: every tile and the blocked queue', (await page.locator('[data-built-board]').count()) === 2 && (await page.locator('[data-built-board="1"] [data-cell="queue"] span').count()) > 4)
ok('the effort distribution of the build is shown without asking', /[\d,]+ DR/.test(await page.getByTestId('built-effort').locator('[data-cell="dr-spent"]').innerText()))
const coinLine = await page.getByTestId('review-coin-values').innerText()
ok(`the review shows the coin values the build chose ("${coinLine.slice(0, 60)}...")`, /Coin ranks 1 to 4 are worth \d/.test(coinLine))
const predictedCoins = num(await page.locator('[data-testid="review-resources"] [data-resource="coins"] [data-cell="predicted"]').innerText())
ok(`the base segment's coin payout lands on its target (${predictedCoins} of 3)`, Math.abs(predictedCoins - 3) <= 0.05)
await coverage.locator('[data-coverage-segment="2"]').click()
await page.waitForTimeout(200)
const predictedCoins3 = num(await page.locator('[data-testid="review-resources"] [data-resource="coins"] [data-cell="predicted"]').innerText())
ok(`a segment with a higher target lands on its own (${predictedCoins3} of 3.75)`, Math.abs(predictedCoins3 - 3.75) <= 0.06)
const puzzleCell = (await page.locator('[data-testid="review-resources"] [data-resource="puzzles"] [data-cell="requested"]').innerText()).trim()
ok(`puzzles are shown as a whole number (${puzzleCell})`, puzzleCell === '188')
await coverage.locator('[data-coverage-segment="0"]').click()

// Recompletion was built on the Normal build, and both are in use.
await page.getByTestId('build-scope').getByRole('button', { name: 'Recompletion', exact: true }).click()
await page.waitForTimeout(300)
ok('Recompletion is in use together with the Normal build it was made on', (await page.getByTestId('rc-on-main-draft').count()) === 0 && (await page.locator('[data-testid="build-scope"] [data-status="applied"]').count()) === 1)
ok('...and is not called out of date', (await page.getByTestId('build-needs-rebuild').count()) === 0)

// ---- Step 7: the whole event is in use ----
await step(page, 'finalize').click()
await page.waitForTimeout(200)
const whole = page.getByTestId('finalize-whole-event')
ok(`step 7 shows both phases in use, with nothing to apply ("${(await whole.innerText()).replace(/\s+/g, ' ').slice(0, 90)}")`, /Normal: in use/.test(await whole.innerText()) && /Recompletion: in use/.test(await whole.innerText()) && (await page.getByTestId('finalize-apply').count()) === 0 && (await page.getByTestId('finalize-in-use').getAttribute('data-state')) === 'in-use')
await shot(page, 'f3-finalize')
await page.waitForTimeout(800)
ok('the Recompletion build can be tested on its own', (await page.getByTestId('finalize-validate').isEnabled()) && (await page.getByTestId('finalize-rc-on-main-draft').count()) === 0)

// The coin values are per segment and survive the sync between segments.
await page.getByTestId('build-scope').getByRole('button', { name: 'Normal', exact: true }).click()
await step(page, 'rewards').click()
await page.waitForTimeout(400)
const rows = await page.locator('[data-coin-row]').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))
ok(`step 3 lists each segment's coin values (${rows.join(' | ')})`, rows.length === 3 && new Set(rows.map((r) => r.split(' ').slice(-1)[0])).size >= 2)
await shot(page, 'f4-coin-values')
await page.getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForTimeout(400)
const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SAVE_KEY)
const coinsOf = (seg, list = 'boards') => saved.segments[seg][list][0].rewardChainConfig.coins.map((r) => r.prizeAmount)
ok('saved: every segment has its own coin values', [0, 1, 2].every((i) => coinsOf(i).every((v) => v > 0)) && coinsOf(2)[3] !== coinsOf(0)[3])
// (One table, one set of values for the whole event: Recompletion plays the normal event's, for the same segment.)
ok('saved: Recompletion carries the same rank values as its normal event, coins included, in every segment', [0, 1, 2].every((i) => JSON.stringify(saved.segments[i].recompletionBoards[0].rewardChainConfig) === JSON.stringify(saved.segments[i].boards[0].rewardChainConfig)) && coinsOf(0, 'recompletionBoards').every((v) => v > 0))
ok('saved: ...and the same merge drops, for every merge the normal event makes', [0, 1, 2].every((i) => JSON.stringify(saved.segments[i].recompletionBoards[0].dropGroupsConfig.slice(0, 12)) === JSON.stringify(saved.segments[i].boards[0].dropGroupsConfig.slice(0, 12)) && saved.segments[i].recompletionBoards[0].minDropRank === saved.segments[i].boards[0].minDropRank))
const puzzle4 = (seg) => saved.segments[seg].boards[0].rewardChainConfig.puzzles[3]
// (The build may change a reward's rank values to reach its amount: what was typed is kept beside the value in force.)
const puzzlesOf = (seg) => saved.segments[seg].boards[0].rewardChainConfig.puzzles
// (Every segment has its own values now - round ones that reward merging - and the typed value is kept as the definition for all.)
ok(`saved: every segment has its own puzzle values, round and rewarding merging, with the typed definition kept (${[0, 1, 2].map((i) => puzzlesOf(i).map((r) => r.prizeAmount).join('/')).join(' | ')}; typed rank 4: ${puzzle4(0).typed?.prizeAmount ?? puzzle4(0).prizeAmount})`, [0, 1, 2].every((i) => { const v = puzzlesOf(i).map((r) => r.prizeAmount); return v.every((x) => Number.isInteger(x) && (x < 10 || x % 5 === 0)) && v[1] > 2 * v[0] && v[2] > 2 * v[1] && v[3] > 2 * v[2] && (puzzlesOf(i)[3].typed?.prizeAmount ?? v[3]) === 75 }))
ok('saved: the puzzle item syntax follows the value in force, and the typed one is kept', puzzle4(0).syntax === `[dynamic(dr-puzzle:${puzzle4(0).prizeAmount})]` && (puzzle4(0).typed?.syntax ?? puzzle4(0).syntax) === '[dynamic(dr-puzzle:75)]')
ok('saved: the milestone reward is on every segment', saved.segments.slice(0, 3).every((s) => s.boards[0].rewardRanks.includes(5) && s.boards[0].rewardSyntax[5] === 'coins:50'))
ok('saved: both phases are built for every segment', [0, 1, 2].every((i) => saved.segments[i].boards.every((b) => b.blockedQueue.length > 0) && saved.segments[i].recompletionBoards.every((b) => b.blockedQueue.length > 0)))

// The applied containers are what the Syntax tab exports.
{
  await page.locator('header').getByRole('button', { name: 'Syntax', exact: true }).click()
  await page.waitForTimeout(400)
  await syntaxView(page, 'Small Rewards Bank')
  await page.waitForTimeout(300)
  const bankRows = await page.locator('table tbody tr').evaluateAll((els) => els.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())))
  ok(`Syntax, Small Rewards Bank: the model's containers (${bankRows.map((r) => r.join('=')).join(', ')})`, bankRows[0]?.[0] === 'ContA' && bankRows.every((r) => /^Cont[A-Z]+$/.test(r[0]) && /-r\d/.test(r[1])) && /From the model/.test(await page.getByTestId('containers-source').innerText()))
  ok('...the same containers the build showed, in the same order', JSON.stringify(bankRows.map((r) => r[1])) === JSON.stringify(globalThis.__builtContainers))
  await syntaxView(page, 'Small Reward Weights')
  await page.waitForTimeout(300)
  const head = await page.locator('table thead th').evaluateAll((els) => els.map((e) => e.innerText.trim()))
  const body = await page.locator('table tbody tr').evaluateAll((els) => els.map((tr) => [...tr.querySelectorAll('td')].map((td) => Number(td.innerText.trim()))))
  ok(`Syntax, Small Reward Weights: ${head.join(' | ')}`, /merge tier/i.test(head[0]) && /nodrop/i.test(head.at(-1)) && head.length === bankRows.length + 2)
  // (The sheet runs to merge tier 14 now: 13 and 14 are what Recompletion drops there - nothing, in this journey.)
  const tier12 = body.find((r) => r[0] === 12)
  ok('...merge tiers 2 to 14; below the drop start rank NoDrop only, from it every merge of the normal event drops', body.length === 13 && body[0][0] === 2 && body.at(-1)[0] === 14 && body[0].at(-1) === 1000 && body[0].slice(1, -1).every((v) => v === 0) && tier12.at(-1) === 0 && tier12.slice(1, -1).reduce((s, v) => s + v, 0) === 1000)
  ok('...and tiers 13 and 14 - the merges only Recompletion makes - drop too: 1000 in all, no NoDrop', body.slice(-2).every((r) => r.at(-1) === 0 && r.slice(1, -1).reduce((a, v) => a + v, 0) === 1000))
  // One bank and one weights table for the whole event: Recompletion has no sheets of its own.
  ok('Syntax: there is no Recompletion containers sheet - the game has one table for both', (await page.getByRole('button', { name: /^RC Small/ }).count()) === 0)
  await page.locator('header').getByRole('button', { name: 'Build event', exact: true }).click()
  await page.waitForTimeout(300)
}

await page.reload()
await openMerge(page)
await page.waitForTimeout(500)
ok('after a reload nothing is flagged as a leftover per-segment configuration', (await page.getByText('Draft restored').count()) >= 0 && (await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).segments.every((s) => !s.legacyRewardConfig), SAVE_KEY)))
await step(page, 'rewards').click()
await page.waitForTimeout(400)
ok('...and the per-segment coin values are still there', (await page.locator('[data-coin-row]').count()) === 3)

// Typing a coin value takes over; clearing hands it back.
await page.locator('[data-edit-ranks="coins"]').click()
await set(page.locator('[data-rank-value="coins-1"]'), 0.06)
await page.waitForTimeout(300)
ok('typing a coin value makes the coin ranks your own', (await page.locator('[data-definition="coins"]').getAttribute('data-coin-mode')) === 'manual')
await page.getByTestId('coins-back-to-auto').click()
await page.waitForTimeout(300)
ok('"let the build set the coin values" hands them back', (await page.locator('[data-definition="coins"]').getAttribute('data-coin-mode')) === 'auto')

// ---- Twister: how to use it ----
await tab(page, 'Twister').click()
await page.waitForTimeout(400)
const how = page.getByTestId('twister-how-to')
ok('the Twister page opens with numbered steps on how to use it', (await how.evaluate((el) => el.open)) && (await how.locator('li').count()) === 6 && (await how.innerText()).includes('Build your boards first'))
await shot(page, 'f5-twister')

ok('zero page errors', errors.length === 0)
if (errors.length) console.log(errors.join('\n'))
await browser.close()

// =====================================================================
// A 15% margin, and a quick fix on every remaining problem
// =====================================================================
{
  const { browser, page, errors } = await launch({ save: { segments: [{ name: 'Base', ...lists(600) }] } })
  await openMerge(page)
  await step(page, 'rewards').click()
  await page.waitForTimeout(200)
  ok('the targets step says a result within 15% counts as met', /A build counts an amount as met within 15%/.test((await page.getByTestId('reward-targets-intro').innerText()).replace(/\s+/g, ' ')))
  // 85 asked, rank 4 pays 75 at a time -> 75 is inside the margin.
  await set(page.locator('[data-target="energy"]'), 85)
  await step(page, 'build').click()
  await page.waitForTimeout(200)
  const buildOnly = async () => {
    await page.getByTestId('build-configuration').click()
    await page.getByTestId('build-configuration').waitFor({ state: 'visible', timeout: 240000 })
    await page.waitForTimeout(400)
  }
  await buildOnly()
  const rowText = async () => (await page.locator('[data-coverage-segment="0"]').innerText()).replace(/\s+/g, ' ')
  ok(`85 asked, 75 paid: inside the margin, so the segment is ready ("${(await rowText()).slice(0, 70)}")`, /Ready/.test(await rowText()) && !/Needs a fix/.test(await rowText()) && (await page.locator('[data-cause="coarse-ladder"]').count()) === 0)
  ok('the review says what the margin is', (await page.getByTestId('review-margin').innerText()).includes('within 15%'))

  // 20 asked, when one rank-4 item pays 75: most players would get nothing
  // -> reported, with fixes. It does not block: the build is usable.
  // (With leftovers lost - the older rule, still selectable in step 4. Collected,
  // as they are by default, a small amount is payable in the smaller items.)
  await step(page, 'rewards').click()
  await page.locator('[data-field="leftover-policy"]').selectOption('forfeit')
  await page.waitForTimeout(200)
  await set(page.locator('[data-target="energy"]'), 20)
  await step(page, 'build').click()
  await page.waitForTimeout(200)
  await buildOnly()
  // By default the build may change rank values: it makes merge energy's smaller, so 20 is one whole prize, and says so.
  {
    const note = (await page.getByTestId('rank-values-note').innerText()).replace(/\s+/g, ' ')
    ok(`20 asked when rank 4 pays 75: the build keeps the rules and makes the rank values smaller ("${note.slice(0, 150)}")`, /Merge Energy: \d+ \/ \d+ \/ \d+ \/ (10|15|20|25) \(you typed 5 \/ 15 \/ 35 \/ 75/.test(note) && (await page.locator('[data-cause="coarse-ladder"]').count()) === 0 && /Ready/.test(await rowText()))
    await step(page, 'rewards').click()
    await page.waitForTimeout(200)
    ok('step 4 still shows the values as typed, and says what the build changed them to', (await page.locator('[data-definition="energy"]').innerText()).includes('5 / 15 / 35 / 75') && (await page.locator('[data-field="rank-values-by-build"]').isChecked()))
    // Keep my own values: then the same amount is reported, with quick fixes.
    await page.locator('[data-field="rank-values-by-build"]').uncheck()
    await page.waitForTimeout(200)
    await step(page, 'build').click()
    await page.waitForTimeout(200)
    await buildOnly()
    ok('with that switched off the values stay as typed: no rank value is changed', (await page.getByTestId('rank-values-note').count()) === 0)
  }
  const cause = page.locator('[data-cause="coarse-ladder"]')
  ok('a target smaller than one prize is shown with quick fixes, and does not block the build', (await cause.count()) === 1 && (await cause.locator('[data-quick-fix]').count()) === 2 && /Can be improved/.test(await rowText()))
  ok('the table points to the quick fixes', (await rowText()).includes('Quick fixes available'))
  const fixLabel = await cause.locator('[data-quick-fix="setBaseTarget"]').innerText()
  ok(`a fix says exactly what it will change ("${fixLabel}")`, /Change the merge energy target to 75/.test(fixLabel))
  await shot(page, 'f6-quick-fix')
  await cause.locator('[data-quick-fix="setBaseTarget"]').click()
  await page.waitForTimeout(300)
  ok('clicking it marks the fix done and asks for a rebuild', (await page.getByTestId('fixes-applied').isVisible()) && (await cause.locator('[data-quick-fix="setBaseTarget"]').isDisabled()) && (await cause.locator('[data-quick-fix="setBaseTarget"]').innerText()).startsWith('Done'))
  await step(page, 'rewards').click()
  await page.waitForTimeout(200)
  const newTarget = Number(await page.locator('[data-target="energy"]').inputValue())
  ok(`the fix changed the input itself (energy target is now ${newTarget})`, newTarget === 75)
  await step(page, 'build').click()
  await page.waitForTimeout(200)
  await page.getByTestId('fixes-rebuild').click()
  await page.getByTestId('build-configuration').waitFor({ state: 'visible', timeout: 480000 })
  await page.waitForTimeout(500)
  ok(`after "Rebuild now" the problem is gone ("${(await rowText()).slice(0, 60)}")`, (await page.locator('[data-cause="coarse-ladder"]').count()) === 0 && /Ready/.test(await rowText()) && (await page.getByTestId('fixes-applied').count()) === 0)

  // A starting goal that cannot be reached: lower it, or remove it.
  await step(page, 'layouts').click()
  await page.waitForTimeout(200)
  await set(page.getByPlaceholder('none').nth(0), 1)
  await set(page.getByPlaceholder('none').nth(0), 1)
  const goalFields = page.locator('label', { hasText: 'should reach rank' }).locator('input')
  await set(goalFields, 9)
  await step(page, 'build').click()
  await page.waitForTimeout(200)
  await buildOnly()
  const goalCause = page.locator('[data-cause="onboarding"]')
  ok('an unreachable starting goal offers "lower it" and "remove it"', (await goalCause.locator('[data-quick-fix="setOnboarding"]').count()) === 2 && /Needs a fix/.test(await rowText()))
  await goalCause.getByRole('button', { name: 'Remove the starting goal' }).click()
  await page.waitForTimeout(300)
  await page.getByTestId('fixes-rebuild').click()
  await page.getByTestId('build-configuration').waitFor({ state: 'visible', timeout: 480000 })
  await page.waitForTimeout(500)
  ok('removing it and rebuilding clears the problem', (await page.locator('[data-cause="onboarding"]').count()) === 0 && !/Needs a fix/.test(await rowText()))
  ok('quick fixes: zero page errors', errors.length === 0)
  if (errors.length) console.log(errors.join('\n'))
  await browser.close()
}
finish('Build feedback E2E')
