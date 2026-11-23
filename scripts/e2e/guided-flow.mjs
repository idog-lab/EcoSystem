// Browser end-to-end: the guided flow as a first-time economist meets it.
//   - the main path (build, play, export) apart from the advanced tools;
//   - each step says what it is for; only what has to be typed is on screen,
//     the rules with working defaults are folded with a line saying what is
//     in force;
//   - a field says why it did not take a value; a pasted column fills down;
//   - unsaved changes are said;
//   - after a build the summary leads: spend and rewards against what was
//     asked, "close" apart from "within margin", the Twister, the next action;
//   - step 2 offers a bank of ready-made boards; a first board keeps its
//     fixed rank-2 cell and its two tutorial cells empty;
//   - a finished build is in use at once: there is no draft and no Apply.
//     Step 7 is test, play, go back to the previous build - and the Play
//     tester says what it plays and leads back;
//   - the price of a twist is any whole price; a step saved earlier is not used;
//   - a backup says what is in it, carries the build results, and Clear data
//     makes one first.
// Unlike the other suites this one leaves the folded sections folded
// (launch({ folded: true })). See helpers.mjs for how to run.
import fs from 'node:fs'
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { createChecker, launch, openMerge, openMore, tab } from './helpers.mjs'

const { ok, finish } = createChecker()
const flat = (text) => String(text).replace(/\s+/g, ' ').trim()
const step = (page, id) => page.locator(`[data-step="${id}"]`)
const fold = (page, id) => page.locator(`details[data-collapsible="${id}"]`)
const isOpen = (locator) => locator.evaluate((el) => el.open)
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

const { browser, page, errors } = await launch({
  folded: true,
  // (The Twister plan carries a price step of 10 saved before "any whole price": it must not be used.)
  save: { segments: [{ name: 'Whales', boards: boards(600, 750), twisterPlan: { main: { targetSpins: null, targetSpinsOverrides: {}, costIncrement: 10, checkpointPct: 70 } } }, { name: 'Minnows', boards: boards(450, 600), segmentFactor: 1.2 }] },
})
await openMerge(page)
await page.waitForTimeout(800)

console.log('--- 1. The first look: the main path, the steps, what a step is for ---')
{
  const modes = await page.locator('header [data-mode]').evaluateAll((els) => els.map((e) => `${e.dataset.mode}:${e.dataset.advanced}`).join(' '))
  ok(`the header holds the three tools of the main path, Share stage, Save and one "More" menu (${modes})`, modes === 'build:no play:no syntax:no' && (await page.getByTestId('more-menu').isVisible()) && (await page.getByTestId('advanced-tools-label').count()) === 0 && (await page.locator('header').getByRole('button').count()) <= 11)
  await openMore(page)
  const inMenu = await page.getByTestId('more-menu-panel').getByRole('button').evaluateAll((els) => els.map((e) => e.innerText.trim()).join(' | '))
  ok(`...the project actions and the five advanced tools are in that menu (${inMenu})`, inMenu === 'Saved events | Share planning | Export backup | Import backup | What a backup holds | Clear data | Editor | Recompletion | Rewards (V2) | Twister | CC management' && (await page.getByTestId('advanced-tools-label').isVisible()))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  const bar = await page.locator('[data-segment-tab]').count()
  ok(`the segment bar shows the segments in use (${bar} of 8), and offers to add one`, bar === 2 && (await page.getByTestId('add-segment').isVisible()) && (await page.locator('[data-testid="setup-segments"] [data-setup-segment]').count()) === 2)
  const labels = await page.locator('[data-step]').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim().replace(/^\d /, '')).join(' | '))
  ok(`the five steps are named for what is done in them (${labels})`, labels === 'DR demand | Board layouts | Rewards and Twister | Build | Test and export')
  const purpose = flat(await page.getByTestId('step-purpose').innerText())
  ok(`the open step says where you are and what it is for, once ("${purpose.slice(0, 70)}...")`, /^Step 1 of 5 · normal event:/.test(purpose) && /should spend/.test(purpose) && (await page.getByText(/Seven steps|Start here:/).count()) === 0)
  const terms = flat(await page.getByTestId('setup-terms').innerText())
  ok('step 1 says what DR demand and board subsidy are, in one line', /DR demand is what the player should spend themselves/.test(terms) && /board subsidy, placed under the tiles/.test(terms) && /subsidy = 2,048 − demand/.test(terms) && terms.length < 200)
  const head = flat(await page.getByTestId('setup-segments').locator('thead').innerText()).toLowerCase()
  ok(`the columns use those words (${head.slice(0, 80)}...)`, head.includes('dr demand (player spends)') && head.includes('board subsidy (under tiles)') && head.includes('reward size (× base)'))
  ok('the scope strip names the phase and the segment shown', /PHASE/i.test(await page.getByTestId('build-scope').innerText()) && /SEGMENT SHOWN/i.test(await page.getByTestId('build-scope').innerText()) && (await page.getByTestId('build-scope-segment').innerText()).includes('Whales (base)'))
  // (This save has DR typed on its boards and no demand: the boards are then something to look at, so their section is open.)
  ok('the boards of step 1 are a section of their own - open here by itself, because this save has DR typed on its boards without a demand', (await isOpen(fold(page, 'setup-how'))) && /Board 1 takes up to 150 DR/.test(flat(await fold(page, 'setup-how').locator(':scope > summary').evaluate((el) => el.textContent))) && (await page.locator('[data-testid="setup-budgets"] [data-field="budget"]').count()) === 6)
  ok('the generator, lucky drops and dates are folded at the bottom of step 1, saying what is in force', !(await isOpen(fold(page, 'setup-generator'))) && /×2 opens at rank 7, ×4 at rank 10 · lucky drops ×1\.1 · 7 days/.test(flat(await fold(page, 'setup-generator').locator(':scope > summary').innerText())) && !(await page.locator('[data-field="target-ev"]').isVisible()))
}

console.log('--- 2. Step 1: paste, validation beside the field, unsaved changes ---')
{
  const demand = (i) => page.locator(`[data-setup-segment="${i}"] [data-field="demand"]`)
  ok('nothing is unsaved on arrival', (await page.getByTestId('unsaved-changes').count()) === 0)
  await demand(0).evaluate((el, text) => {
    const data = new DataTransfer()
    data.setData('text', text)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, '548\t(whales)\r\n848\r\n')
  await page.waitForTimeout(500)
  const note = flat(await page.getByTestId('setup-paste-note').innerText())
  ok(`a column pasted from a spreadsheet fills the demands down (${await demand(0).inputValue()} / ${await demand(1).inputValue()}; "${note}")`, (await demand(0).inputValue()) === '548' && (await demand(1).inputValue()) === '848' && /Pasted 2 demands, starting at Whales/.test(note))
  ok('...and the board subsidy follows', flat(await page.locator('[data-setup-segment="0"] [data-field="subsidy-needed"]').innerText()) === '1,500 DR' && flat(await page.locator('[data-setup-segment="1"] [data-field="subsidy-needed"]').innerText()) === '1,200 DR')
  await set(demand(0), 5000)
  const rejected = flat(await page.locator('[data-setup-segment="0"] [data-field-rejected]').innerText())
  ok(`a value the field cannot take is said next to it, and the old value is back ("${rejected}")`, /5,000 was not taken: this field takes 0 to 2,048/.test(rejected) && (await demand(0).inputValue()) === '548')
  await page.waitForTimeout(1200)
  ok('the header says there are unsaved changes', await page.getByTestId('unsaved-changes').isVisible())
  await page.locator('header').getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(1200)
  ok('...and Save clears that', (await page.getByTestId('unsaved-changes').count()) === 0)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const scrolledTo = await page.evaluate(() => window.scrollY)
  await page.getByTestId('build-next').click()
  await page.waitForTimeout(400)
  ok(`"Next" opens the next step at its top (the page was scrolled ${Math.round(scrolledTo)} px down)`, (await step(page, 'layouts').getAttribute('aria-current')) === 'step' && (await page.evaluate(() => window.scrollY)) === 0)
}

console.log('--- 2b. Step 2: pick a board from the bank; the two rules of a first board ---')
{
  await step(page, 'layouts').click()
  await page.waitForTimeout(400)
  const bank = page.getByTestId('board-bank')
  const blockedOf = async (i) => Number((await page.locator(`[data-layout-board="${i}"] [data-cell="blocked"]`).innerText()).trim())
  ok('step 2 offers ready-made first boards to pick from, each one solved by the simulator', (await bank.locator('[data-bank-layout]').count()) === 18 && /The simulator solves every one of them/.test(flat(await bank.innerText())))
  const groups = await bank.locator('[data-bank-group]').evaluateAll((els) => els.map((el) => `${el.dataset.bankGroup} ${el.querySelectorAll('[data-bank-layout]').length}`).join(', '))
  ok(`...boards that stand on the floor, boards that hang from the top, a diagonal, and boards drawn for Black Friday (${groups})`, groups === 'standing 7, hanging 6, diagonal 1, black-friday 4' && /Standing on the floor/.test(await bank.innerText()) && /Hanging from the top/.test(await bank.innerText()) && /Black Friday/.test(await bank.innerText()))
  const rules = flat(await page.getByTestId('board-bank-rules').innerText())
  ok(`...and says the rules of a first board ("${rules.slice(0, 80)}...")`, /rank-2 item in its fixed cell/.test(rules) && /two bottom cells of the right column empty/.test(rules) && /tutorial/.test(rules))
  const mirrored = await bank.locator('[data-bank-group="standing"] [data-bank-layout], [data-bank-group="hanging"] [data-bank-layout], [data-bank-group="black-friday"] [data-bank-layout]').evaluateAll((cards) =>
    cards.every((card) => {
      const cells = [...card.querySelectorAll('span.grid > span')].map((cell) => (/indigo/.test(cell.className) ? 'b' : /amber|teal/.test(cell.className) ? 's' : '.'))
      return cells.length === 40 && [0, 1, 2, 3, 4].every((r) => [0, 1, 2, 3].every((c) => cells[r * 8 + c] === cells[r * 8 + 7 - c]))
    }),
  )
  ok('every standing, hanging and Black Friday board is drawn symmetrical: its left half mirrors its right, with the two tutorial cells as plain empty space', mirrored && (await bank.locator('[class*="ring-purple-400"]').count()) === 0)
  // (The saved Board 1 was drawn before the rule: two full rows, tiles on the tutorial cells too.)
  ok('a first board drawn before the rule is told so, and is not changed on its own', (await page.getByTestId('tutorial-cells-warning').isVisible()) && (await blockedOf(0)) === 16)
  ok('the list of boards keeps to board, layout and tiles (no "most DR it can hold"); the rest is folded', flat(await page.getByTestId('layout-boards').locator('thead').innerText()).toLowerCase() === 'board layout tiles' && (await page.getByText(/Most DR it can hold/i).count()) === 0 && /drawn by hand/.test(await page.locator('[data-layout-board="0"] [data-cell="layout"]').innerText()) && !(await isOpen(fold(page, 'layouts-details'))) && !(await isOpen(fold(page, 'layouts-size'))) && /5 × 8 · ranks 1–\d+ under the tiles · no onboarding goal/.test(flat(await fold(page, 'layouts-size').locator(':scope > summary').innerText())))
  ok('this board was drawn by hand, so the grid for changing tiles is open; a board picked from the bank is shown by its picture', await isOpen(fold(page, 'layouts-by-hand')))
  await page.getByTestId('tutorial-cells-fix').click()
  await page.waitForTimeout(300)
  ok('"Empty these two cells" empties those two and nothing else', (await page.getByTestId('tutorial-cells-warning').count()) === 0 && (await blockedOf(0)) === 14 && (await bank.getAttribute('data-current')) === '')
  const guides = flat(await page.getByTestId('board-bank-guides').innerText())
  const cards = await bank.locator('[data-bank-layout]').evaluateAll((els) => els.map((el) => el.innerText.replace(/\s+/g, ' ').trim()))
  ok(`every board of the bank has 20 to 24 tiles and three guides, and the picker says what a guide is (${cards.slice(0, 3).join('; ')}...)`, cards.every((text) => /(2[0-4]) tiles · 3 guides/.test(text)) && /A guide is a semi-blocked tile: the player sees its item, and merging into it opens the tiles beside it/.test(guides) && /holds a rank 1/.test(guides))
  await bank.locator('[data-bank-layout="pyramid"]').click()
  await page.waitForTimeout(300)
  const kept = page.locator('[data-testid="layout-grid"] [data-kept-empty="yes"]')
  const semiOf = async (i) => Number((await page.locator(`[data-layout-board="${i}"] [data-cell="semi"]`).innerText()).trim())
  ok('picking "Pyramid" draws it: 20 blocked tiles, the fixed cell and three guides in sight, the two tutorial cells marked empty', (await bank.getAttribute('data-current')) === 'pyramid' && (await blockedOf(0)) === 20 && (await semiOf(0)) === 4 && (await kept.count()) === 2 && (await bank.locator('[data-bank-layout="pyramid"]').getAttribute('aria-pressed')) === 'true' && (await page.locator('[data-layout-board="0"] [data-cell="layout"]').innerText()).trim() === 'Pyramid')
  await kept.first().click()
  await page.waitForTimeout(250)
  ok('painting a tutorial cell does nothing: it stays empty', (await kept.count()) === 2 && (await blockedOf(0)) === 20)
  await bank.locator('[data-bank-layout="hanging-pyramid"]').click()
  await page.waitForTimeout(300)
  ok('picking a hanging board draws it: its tiles are at the top, the floor is free', (await bank.getAttribute('data-current')) === 'hanging-pyramid' && (await blockedOf(0)) === 16 && (await page.locator('[data-testid="layout-grid"] button.aspect-square').evaluateAll((cells) => cells.length === 40 && cells.slice(0, 8).every((cell) => /blocked/.test(cell.title)) && cells.slice(32, 40).every((cell) => !/blocked|semi/.test(cell.title) || /Always empty/.test(cell.title)))))
  await page.getByTestId('board-bank-undo').click()
  await page.waitForTimeout(300)
  ok('"Undo" brings back the layout from before the pick', (await bank.getAttribute('data-current')) === 'pyramid' && (await blockedOf(0)) === 20)
  await bank.locator('[data-bank-layout="gift-box"]').click()
  await page.waitForTimeout(300)
  ok('picking the Black Friday "Gift box" draws it: a bow, a full-width lid with the items in sight, the box under it', (await bank.getAttribute('data-current')) === 'gift-box' && (await blockedOf(0)) === 18 && (await semiOf(0)) === 4 && (await kept.count()) === 2 && (await page.locator('[data-testid="layout-grid"] button.aspect-square').evaluateAll((cells) => cells.slice(0, 8).every((cell) => !/blocked|semi/.test(cell.title)) && cells.slice(16, 24).every((cell) => /blocked|semi/.test(cell.title)))))
  await bank.locator('[data-bank-layout="three-rows"]').click()
  await page.waitForTimeout(300)
  await page.locator('[data-layout-board="1"]').click()
  await page.waitForTimeout(300)
  ok('a later board has its own bank (standing and hanging), without the first board\'s rules', (await bank.locator('[data-bank-layout]').count()) === 9 && (await bank.locator('[data-bank-group="hanging"] [data-bank-layout]').count()) === 3 && (await page.getByTestId('board-bank-rules').count()) === 0 && (await page.locator('[data-testid="layout-grid"] [data-kept-empty="yes"]').count()) === 0)
  await page.locator('[data-layout-board="0"]').click()
  await page.waitForTimeout(200)
}

console.log('--- 3. Step 3: the amounts and the twists; the rules folded, each saying what is in force ---')
{
  await step(page, 'rewards').click()
  await page.waitForTimeout(400)
  await set(page.locator('[data-target="coins"]'), 3)
  await set(page.locator('[data-target="puzzles"]'), 300)
  await set(page.locator('[data-target="energy"]'), 200)
  await set(page.locator('[data-target="charms"]'), 400)
  const folds = ['rewards-per-segment-main', 'rewards-drop-rules-main', 'rewards-definitions-main', 'rewards-milestones-main']
  const state = []
  for (const id of folds) state.push((await fold(page, id).count()) === 1 && !(await isOpen(fold(page, id))))
  ok('the four amounts are on screen; per-segment amounts, drop rules, rank values and milestones are folded; the containers are not here (the build results show them)', (await page.locator('[data-target]').count()) === 4 && state.every(Boolean) && (await fold(page, 'rewards-containers-main').count()) === 0)
  const rules = flat(await fold(page, 'rewards-drop-rules-main').locator(':scope > summary').innerText())
  ok(`the folded drop rules say what is in force ("${rules.slice(0, 110)}...")`, /Coins under the tiles/.test(rules) && /merges drop from rank 6: one item up to rank 6, two from rank 8, three from rank 10/.test(rules) && /leftovers are collected/.test(rules) && /every merge of a rank drops the same items/.test(rules))
  const values = flat(await fold(page, 'rewards-definitions-main').locator(':scope > summary').innerText())
  ok(`...and the folded rank values say who sets them ("${values.slice(0, 90)}...")`, /The build gives every segment its own rank values/.test(values))
  ok('a field inside a folded section is not on screen until it is opened', !(await page.locator('[data-field="min-drop-rank"]').isVisible()))
  await fold(page, 'rewards-drop-rules-main').locator(':scope > summary').click()
  await page.waitForTimeout(300)
  ok('...opening it shows the fields', (await page.locator('[data-field="min-drop-rank"]').isVisible()) && (await page.locator('[data-field="min-drop-rank"]').inputValue()) === '6')
  await step(page, 'setup').click()
  await page.waitForTimeout(300)
  await step(page, 'rewards').click()
  await page.waitForTimeout(400)
  ok('a section stays open when you come back to the step, and what was typed is still there', (await isOpen(fold(page, 'rewards-drop-rules-main'))) && (await page.locator('[data-target="puzzles"]').inputValue()) === '300')
  await fold(page, 'rewards-per-segment-main').locator(':scope > summary').click()
  await page.waitForTimeout(300)
  const perSegment = fold(page, 'rewards-per-segment-main')
  ok(
    `amounts per segment lists the two segments that are built, with the reward size read-only (${flat(await perSegment.locator('[data-derived-segment="1"]').innerText())})`,
    (await perSegment.locator('[data-derived-segment]').count()) === 2 && (await perSegment.locator('[data-derived-segment="1"] [data-derived="factor"]').innerText()) === '×1.2' && (await perSegment.locator('[data-derived-segment="1"] [data-derived="puzzles"]').innerText()) === '360' && (await perSegment.locator('input').count()) === 0 && !/Not shown/.test(flat(await perSegment.innerText())),
  )
  await page.getByTestId('twister-add').click()
  await page.waitForTimeout(400)
  await set(page.locator('[data-twister-segment="0"] [data-field="twists"]'), 15)
  ok('the Twister asks for the twists of the segments that are built - one field a segment, no price column, no line about segments that are not in sight', (await page.locator('[data-twister-segment]').count()) === 2 && (await page.getByTestId('twister-left-out').count()) === 0 && (await page.locator('[data-field="twist-price"]').count()) === 0 && (await page.getByRole('button', { name: /Twister tool/ }).count()) === 0)
  ok('how the Twister drops and is priced is folded under it', !(await isOpen(fold(page, 'rewards-twister-how'))) && /rank 5 drops one rank-1 Twister item/.test(flat(await fold(page, 'rewards-twister-how').locator(':scope > summary').innerText())))
  const twisterLine = flat(await page.getByTestId('twister-window').innerText())
  ok(`one sentence says what the build does with the twists; the price is any whole price - the step of 10 saved earlier is not used ("${twisterLine}")`, /^The build sets how many Twister items drop and the price of a twist \(any whole price that makes it work\), so the twists are reached when the player has paid 70-75% of the DR demand\.$/.test(twisterLine) && !(await page.locator('[data-field="twister-step"]').isVisible()))
  await fold(page, 'rewards-twister-how').locator(':scope > summary').click()
  await page.waitForTimeout(300)
  ok('...rounding the price is an option in the fold, off until a step is typed', (await page.locator('[data-field="twister-step"]').inputValue()) === '' && (await page.locator('[data-field="twister-step"]').getAttribute('placeholder')) === 'any price')
  await fold(page, 'rewards-twister-how').locator(':scope > summary').click()
}

console.log('--- 4. Step 4: one Build button, progress, then the summary first ---')
{
  await step(page, 'build').click()
  await page.waitForTimeout(300)
  ok('before a build the step holds one Build button - nothing is listed while nothing is missing', (await page.getByTestId('build-readiness').count()) === 0 && (await page.getByTestId('build-whole-event').isVisible()) && flat(await page.getByTestId('build-whole-event').innerText()) === 'Build the event' && !(await page.getByTestId('build-configuration').isVisible()) && (await page.getByTestId('build-summary').count()) === 0)
  ok('the effort shape is an optional section above the button, folded', !(await isOpen(fold(page, 'build-effort-shape'))) && /No shape typed - the build keeps the split from step 1/.test(flat(await fold(page, 'build-effort-shape').locator(':scope > summary').innerText())) && !(await page.locator('[data-effort-rank="12"]').isVisible()))
  await fold(page, 'build-one-phase').locator(':scope > summary').click()
  await page.waitForTimeout(150)
  await page.getByTestId('build-configuration').click()
  await page.getByTestId('build-progress').waitFor({ state: 'visible', timeout: 15000 })
  const progress = flat(await page.getByTestId('build-progress').innerText())
  ok(`a running build shows a progress bar, a percentage and what it is doing ("${progress.slice(0, 80)}...")`, (await page.getByTestId('build-progress').getByRole('progressbar').count()) === 1 && /^\d+% · /.test(progress) && /segment \d of 2/.test(progress) && (await page.getByTestId('build-cancel').isVisible()))
  await page.getByTestId('build-summary').waitFor({ state: 'visible', timeout: 540000 })
  await page.waitForTimeout(800)
  const summary = page.getByTestId('build-summary')
  const order = await page.evaluate(() => {
    const top = (id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().top ?? null
    return { summary: top('build-summary'), detail: document.querySelector('details[data-collapsible="build-segment-main"]')?.getBoundingClientRect().top ?? null, accounting: document.querySelector('details[data-collapsible="build-accounting-main"]')?.getBoundingClientRect().top ?? null }
  })
  // (On a wide window the folded details sit two in a row: the segment and the accounting share the first one.)
  ok('the summary comes first, then the selected segment in detail and the other folded details', order.summary != null && order.summary < order.detail && order.detail <= order.accounting)
  const verdict = await page.getByTestId('build-summary-verdict').getAttribute('data-verdict')
  ok(`it opens with a verdict and the next thing to do (${verdict}: "${flat(await page.getByTestId('build-summary-next').innerText()).slice(0, 70)}...")`, ['ready', 'improvable'].includes(verdict) && /This build is in use: the Play tester and Syntax use it/.test(flat(await page.getByTestId('build-summary-next').innerText())) && flat(await page.getByTestId('build-summary-action').innerText()) === 'Next: test and export')
  ok('nothing on the build page says draft, apply or applied', !/\bdraft|\bappl(y|ied)\b/i.test(await page.getByTestId('build-event').innerText()))
  const row = (i) => summary.locator(`[data-summary-segment="${i}"]`)
  const spend = flat(await row(0).locator('[data-cell="spend"]').innerText())
  ok(`each built segment shows what the player spends against the demand (${spend})`, (await summary.locator('[data-summary-segment]').count()) === 2 && /^[\d,]+ of 548 DR/.test(spend) && ['close', 'within', 'off'].includes(await row(0).locator('[data-cell="spend"]').getAttribute('data-match')))
  const rewardCells = await row(0).locator('[data-cell^="reward-"]').evaluateAll((els) => els.map((e) => `${e.dataset.cell.slice(7)} ${e.innerText.replace(/\s+/g, ' ').trim()} [${e.dataset.match}]`))
  ok(`...and every reward against its amount, each marked close, within margin or off target (${rewardCells.join('; ')})`, rewardCells.length === 4 && rewardCells.every((c) => / of /.test(c) && /\[(close|within|off)\]$/.test(c)) && /puzzles [\d,]+ of 300/.test(rewardCells[1]))
  const second = await row(1).locator('[data-cell="reward-puzzles"]').innerText()
  ok(`the second segment is measured against its own amounts (${flat(second)})`, / of 360/.test(flat(second)))
  const twister = flat(await row(0).locator('[data-cell="twister"]').innerText())
  ok(`the Twister says when the twists are reached and how they arrive (${twister})`, /^15 twists by \d+% of demand/.test(twister) && /chances to spin × [\d.]+/.test(twister) && /window|pts? (early|late)/.test(twister))
  // The Twister's pass mark: inside the window is close, up to 5 points outside it passes, further out does not.
  const twisterMatch = await row(0).locator('[data-cell="twister"]').getAttribute('data-match')
  const twisterHover = (await row(0).locator('[data-cell="twister"] [data-match]').getAttribute('title')) ?? ''
  const reached = Number((twister.match(/by (\d+)% of demand/) ?? [])[1])
  ok(`...marked against its window with a margin of 5 points (${reached}%: ${twisterMatch} - "${twisterHover}")`, // (The percentage on screen is rounded: 69.6% reads "70%" and is just outside the window; the same at the edge of the margin.)
    (reached > 70 && reached < 75 ? ['close'] : reached === 70 || reached === 75 ? ['close', 'within'] : reached > 65 && reached < 80 ? ['within'] : reached === 65 || reached === 80 ? ['within', 'off'] : ['off']).includes(twisterMatch) && (twisterMatch === 'close' ? /inside the 70-75% window/.test(twisterHover) : /5 points outside the (70-75% )?window/.test(twisterHover)))
  const legend = flat(await page.getByTestId('build-summary-legend').innerText())
  const chipHover = await row(0).locator('[data-cell="spend"] [data-match]').getAttribute('title')
  ok(`the figures are called averages, and each chip says in its hover what its word means ("${chipHover}")`, /average of \d+ simulated players/.test(legend) && /one player differs from the next/.test(legend) && /Point at a chip/.test(legend) && legend.length < 260 && /^(Close: within 5% of a reward amount|Within margin: accepted but not close - up to 15% for a reward; for the DR, 5% of the demand or 30 DR, whichever is smaller|Off target: outside the accepted margin)/.test(chipHover ?? ''))
  ok('a segment that is not in sight is not listed as "not built"', (await page.getByTestId('build-summary-skipped').count()) === 0)
  const folded = []
  for (const id of ['build-accounting-main', 'build-containers-main', 'build-twister-main', 'build-boards-main', 'build-effort-main']) folded.push((await fold(page, id).count()) === 1 && !(await isOpen(fold(page, id))))
  // The segment in detail is folded while there is nothing to look at in it, and open by itself when there is.
  const firstResult = await row(0).locator('[data-status]').first().getAttribute('data-status')
  ok(`the segment's long detail is folded; what there is to look at is in sight above it (${firstResult === 'applied' ? 'this segment is ready: nothing' : 'this segment can be improved: its causes'})`, (await fold(page, 'build-segment-main').count()) === 1 && !(await isOpen(fold(page, 'build-segment-main'))) && (await page.getByTestId('segment-causes').count()) === (firstResult === 'applied' ? 0 : 1) && (firstResult === 'applied' || (await page.getByTestId('build-causes').isVisible())))
  ok('the subsidy accounting, the containers, the Twister detail, the boards and the effort chart are folded under it', folded.every(Boolean))
  ok('...and the Twister detail opens with its full table', await (async () => {
    await fold(page, 'build-twister-main').locator(':scope > summary').click()
    await page.waitForTimeout(300)
    return (await page.getByTestId('build-twister-prices').isVisible()) && (await page.getByTestId('twister-track').isVisible())
  })())
  await row(1).click()
  await page.waitForTimeout(500)
  ok('clicking a segment in the summary opens that segment in detail', (await page.getByTestId('build-scope-segment').innerText()).includes('Minnows') && (await page.getByText('Minnows in detail').isVisible()) && (await isOpen(fold(page, 'build-segment-main'))) && (await page.getByTestId('segment-review').isVisible()))
  await row(0).click()
  await page.waitForTimeout(300)
  await page.getByTestId('build-summary-action').click()
  await page.waitForTimeout(400)
  ok('the next action leads to step 5, at its top', (await step(page, 'finalize').getAttribute('aria-current')) === 'step' && (await page.evaluate(() => window.scrollY)) === 0)
}

console.log('--- 5. Step 5: the build is in use; test it, play it, go back ---')
{
  const inUse = page.getByTestId('finalize-in-use')
  const state = flat(await inUse.innerText())
  ok(`a finished build is in use at once - there is nothing to apply ("${state.slice(0, 90)}...")`, (await inUse.getAttribute('data-state')) === 'in-use' && /^In use: the normal build of \d.*\(2 segments\)\./.test(state) && /The Play tester plays it and the Syntax export holds it/.test(state) && (await page.getByTestId('finalize-apply').count()) === 0)
  const actions = flat(await page.getByTestId('finalize-actions').innerText())
  ok('the step is three buttons - test on players, play it, go back - each saying in its hover what it does', (await page.getByTestId('finalize-actions').getByRole('button').count()) === 3 && /Test on 300 simulated players/.test(actions) && /Play it/.test(actions) && /Go back to the previous build/.test(actions) && actions.length < 90 && /each with their own luck/.test((await page.getByTestId('finalize-validate').getAttribute('title')) ?? '') && /One step back/.test((await page.getByTestId('finalize-revert').getAttribute('title')) ?? ''))
  const chips = await page.locator('[data-testid="build-scope"] [data-status]').allInnerTexts()
  ok(`the status says it in words (${chips.join(' / ')})`, chips.includes('In use') && chips.includes('Not tested on players yet'))
  ok('nothing on this page says draft, apply or applied either', !/\bdraft|\bappl(y|ied)\b/i.test(await page.getByTestId('build-event').innerText()))
  ok('the step has no door to the advanced Twister tool and no second link to the Syntax tab', (await page.getByTestId('finalize-twister').count()) === 0 && (await page.getByRole('button', { name: /Open the (Twister|Syntax) tool/ }).count()) === 0)
  ok('endless mode is folded away', !(await isOpen(fold(page, 'finalize-endless'))))
  await page.getByTestId('finalize-validate').click()
  await page.getByTestId('validation-table').waitFor({ state: 'visible', timeout: 300000 })
  await page.waitForTimeout(400)
  const head = flat(await page.getByTestId('validation-table').locator('thead').innerText()).toLowerCase()
  ok('the test on players is in plain words', head.includes('you asked for') && head.includes('average of these players') && head.includes('8 in 10 players land between') && (await page.locator('[data-testid="build-scope"] [data-status="validated"]').innerText()) === 'Tested on players' && (await page.getByText('Tested on players: Whales').isVisible()))
  const styles = fold(page, 'finalize-styles-main')
  const stylesVerdict = flat(await styles.locator(':scope > summary [data-status]').innerText())
  ok(`the same event played by different players is a section of its own - folded while merging pays best, open when a tap pays more (${stylesVerdict})`, (await styles.count()) === 1 && (await isOpen(styles)) === (stylesVerdict !== 'Merging pays best') && /taps everything/.test(flat(await styles.locator(':scope > summary').evaluate((el) => el.textContent))))
  await page.getByTestId('finalize-play').click()
  await page.waitForTimeout(600)
  const playing = flat(await page.getByTestId('play-source').innerText())
  ok(`"Play it" opens the Play tester on the build in use, and it says so ("${playing.slice(0, 80)}...")`, /Playing Whales: the build of \d.*, in use\./.test(playing) && (await page.getByTestId('play-source').locator('[data-play-design]').getAttribute('data-play-design')) === 'consistent')
  ok('...with the boards of the build on its tiles', (await page.locator('button[title*="stuck"]').count()) >= 1)
  ok('...and it leads back to the build results', flat(await page.getByTestId('play-back-to-build').innerText()) === 'Back to the build results (step 4)')
  await page.getByTestId('play-back-to-build').click()
  await page.waitForTimeout(400)
  ok('the way back opens step 4 again', (await step(page, 'build').getAttribute('aria-current')) === 'step' && (await page.getByTestId('build-summary').isVisible()))

  // A second build takes the place of the first - and "Go back" puts the first back.
  await step(page, 'finalize').click()
  await page.waitForTimeout(300)
  const firstBuild = await inUse.getAttribute('data-built-at')
  ok('with one build there is nothing to go back to except the empty boards, and the button says one step back', await page.getByTestId('finalize-revert').isEnabled())
  await step(page, 'build').click()
  await page.waitForTimeout(300)
  await fold(page, 'build-one-phase').locator(':scope > summary').click()
  await page.waitForTimeout(150)
  await page.getByTestId('build-configuration').click()
  await page.getByTestId('build-progress').waitFor({ state: 'visible', timeout: 15000 })
  await page.getByTestId('build-progress').waitFor({ state: 'detached', timeout: 540000 })
  await page.waitForTimeout(800)
  await step(page, 'finalize').click()
  await page.waitForTimeout(300)
  const secondBuild = await inUse.getAttribute('data-built-at')
  ok('building again puts the new build in use', secondBuild !== firstBuild && (await inUse.getAttribute('data-state')) === 'in-use')
  await page.getByTestId('finalize-revert').click()
  await page.waitForTimeout(800)
  ok('"Go back to the previous build" puts the first build back in use, with its results', (await inUse.getAttribute('data-built-at')) === firstBuild && (await inUse.getAttribute('data-state')) === 'in-use')
  ok('...one step back only', await page.getByTestId('finalize-revert').isDisabled())
  await page.locator('header').getByRole('button', { name: 'Play tester', exact: true }).click()
  await page.waitForTimeout(500)
  ok('...and the Play tester plays that build, as built', (await page.getByTestId('play-source').locator('[data-play-design]').getAttribute('data-play-design')) === 'consistent')
  await page.locator('header').getByRole('button', { name: 'Build event', exact: true }).click()
  await page.waitForTimeout(300)
}

console.log('--- 6. A backup: what is in it, the build results travel with it, Clear data makes one first ---')
{
  await openMore(page)
  await page.getByTestId('backup-contents-toggle').click()
  await page.waitForTimeout(200)
  const contents = flat(await page.getByTestId('backup-contents').innerText())
  ok('"What a backup holds" lists what is in the file and how to reproduce an issue', /All 8 segments/.test(contents) && /The results of the last build of each phase/.test(contents) && /To reproduce an issue/.test(contents))
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), tab(page, 'Export backup').click()])
  const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'))
  ok('the file carries the project, the build results and the effort distribution', backup.segments?.length === 8 && Array.isArray(backup.buildDrafts?.drafts?.main?.segments) && backup.buildDrafts.drafts.main.segments.length === 8 && typeof backup.effortTargets?.main === 'object')
  page.once('dialog', (dialog) => dialog.accept())
  const [cleared] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), tab(page, 'Clear data').click()])
  await page.waitForTimeout(800)
  const safety = JSON.parse(fs.readFileSync(await cleared.path(), 'utf8'))
  ok('Clear data downloads a backup of what it clears first', safety.segments?.[0]?.name === 'Whales' && (await page.locator('[data-setup-segment="0"] [data-field="demand"]').inputValue()) === '')
  await page.locator('input[type="file"][accept="application/json"]').setInputFiles(await cleared.path())
  await page.waitForTimeout(1200)
  await step(page, 'build').click()
  await page.waitForTimeout(400)
  ok('...and importing that file brings everything back: the event, in use, with the results of its build', (await page.locator('[data-testid="build-scope"] [data-status]').allInnerTexts()).includes('In use') && (await page.getByTestId('build-summary').isVisible()) && (await page.getByTestId('draft-restored').count()) === 0)
  await step(page, 'setup').click()
  await page.waitForTimeout(300)
  ok('...the demands too', (await page.locator('[data-setup-segment="0"] [data-field="demand"]').inputValue()) === '548')
}

ok(`no page errors (${errors.length})`, errors.length === 0)
const fails = finish('GUIDED FLOW')
await browser.close()
process.exit(fails ? 1 : 0)
