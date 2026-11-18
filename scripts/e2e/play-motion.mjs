// Browser end-to-end: how play MOVES and how it is celebrated (PlayEffects.jsx).
// Slides, pops, bursts, lucky drops, the grand prize, a board pushing in, and
// reduced motion. See helpers.mjs.  Run: npx vite-node scripts/e2e/play-motion.mjs
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { encodeStage } from '../../src/features/merge/lib/share/stageShare.js'
import { BASE, createChecker, ladderBoard, launch } from './helpers.mjs'

const { ok, finish } = createChecker()
const SHOT = process.env.E2E_SCREENSHOT_DIR ?? null
const shot = async (page, name) => SHOT && page.screenshot({ path: `${SHOT}/${name}.png` })
const open = async (page, boards, options) => {
  await page.goto(`${BASE}?play&stage=${encodeStage(boards, options)}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
}
const generator = (page) => page.getByRole('button', { name: /Use generator/ })
const appears = (page, selector, timeout = 1500) =>
  page
    .waitForSelector(selector, { state: 'attached', timeout })
    .then(() => true)
    .catch(() => false)
const walk = async (page, from, to, pause = 0) => {
  for (let k = from; k < to; k++) {
    await page.locator(`[data-cell="1-${k}"]`).click()
    await page.locator(`[data-cell="1-${k + 1}"]`).click()
    if (pause) await page.waitForTimeout(pause)
  }
}

// ---------- slides, pops, bursts ----------------------------------------
{
  const { browser, page, errors } = await launch()
  await open(page, [ladderBoard('Main 1', 11, { targetEv: 1 })])

  const landed = appears(page, '.play-pop-land')
  await generator(page).click()
  ok('a generator tap throws its item (a flying copy)', await appears(page, '[data-fx-fly]', 400))
  ok('...and the real item lands with a small bounce', await landed)
  await page.waitForTimeout(500)
  ok('the thrown copy is gone once it has landed', (await page.locator('[data-fx-fly]').count()) === 0)

  // Select: the item bobs, and the cell it can merge into breathes.
  await page.locator('[data-cell][title="rank 1"]').first().click()
  ok('a selected item bobs, inside its selection brackets', (await page.locator('.play-item-selected').count()) === 1)
  ok('the cell it can merge into is marked and glows (without moving)', (await page.locator('[data-cell="1-0"]').evaluate((el) => el.classList.contains('play-target-merge'))) === true)

  // A tapped merge: slide, then pop, then a burst in the rank's colour.
  const popped = appears(page, '.play-pop-merge')
  const burst = appears(page, '[data-fx-burst="2"]')
  await page.locator('[data-cell="1-0"]').click()
  const { sliding, hiddenMeanwhile } = await page.evaluate(() => ({
    sliding: [...document.querySelectorAll('[data-fx-slide]')].map((e) => e.dataset.fxSlide),
    hiddenMeanwhile: getComputedStyle(document.querySelector('[data-cell="1-0"] img.play-item')).opacity,
  }))
  ok(`a tapped merge slides the item into its match (${sliding.join(' + ')})`, sliding.includes('slide') && sliding.includes('hold'))
  ok('...the new item is not shown until they meet', hiddenMeanwhile === '0')
  ok('...then it pops out', await popped)
  ok('...and the merge is celebrated with a burst', await burst)
  const label = await page.locator('[data-fx-burst="2"] [data-burst-label]').innerText().catch(() => '')
  ok(`the first time a rank is made the burst names it ("${label}")`, label === 'Rank 2!')
  const firstTier = await page.locator('[data-fx-burst="2"] [data-burst]').getAttribute('data-burst')
  await page.waitForTimeout(1700)
  ok('every moving piece is cleaned up afterwards', (await page.locator('[data-fx-slide], [data-fx-burst], [data-fx-fly]').count()) === 0 && (await page.locator('.play-pop-merge').count()) === 0)
  ok('the merged item is visible again, at rest', (await page.locator('[data-cell="1-0"] img.play-item').evaluate((el) => getComputedStyle(el).opacity)) === '1')

  // Make a rank 2 a second time: a smaller burst, no name.
  await generator(page).click()
  await page.waitForTimeout(500)
  await generator(page).click()
  await page.waitForTimeout(500)
  const again = appears(page, '[data-fx-burst="2"]')
  await page.locator('[data-cell][title="rank 1"]').first().click()
  await page.locator('[data-cell][title="rank 1"]').nth(1).click()
  ok('making the same rank again is celebrated too', await again)
  const secondTier = await page.locator('[data-fx-burst="2"] [data-burst]').getAttribute('data-burst')
  ok(`...one step smaller, with no name (${firstTier} the first time, ${secondTier} now)`, firstTier === 'medium' && secondTier === 'small' && (await page.locator('[data-fx-burst="2"] [data-burst-label]').count()) === 0)
  await page.waitForTimeout(900)

  // A tapped MOVE slides too.
  const free = page.locator('[data-cell][title="rank 2"][data-movable="true"]').first()
  await free.click()
  const empty = page.locator('[data-cell][title="open"]').last()
  await empty.click()
  ok('a tapped move slides the item to its cell', await appears(page, '[data-fx-slide="slide"]', 300))
  await page.waitForTimeout(500)

  // A dragged merge is already there: nothing slides, it just pops.
  await generator(page).click()
  await page.waitForTimeout(500)
  await generator(page).click()
  await page.waitForTimeout(600)
  const ones = page.locator('[data-cell][title="rank 1"][data-movable="true"]')
  const dragPop = appears(page, '.play-pop-merge')
  await ones.first().dragTo(ones.nth(1))
  const slidOnDrag = await page.locator('[data-fx-slide]').count()
  ok('a dragged merge does not slide (the item is already there)', slidOnDrag === 0)
  ok('...it pops and is celebrated all the same', (await dragPop) && (await appears(page, '[data-fx-burst="2"]', 600)))
  ok('slides and bursts: zero page errors', errors.length === 0)
  await browser.close()
}

// ---------- the grand prize ---------------------------------------------
{
  const { browser, page, errors } = await launch()
  await open(page, [ladderBoard('Main 1', 11, { targetEv: 1 })])
  await generator(page).click()
  await page.waitForTimeout(500)
  await page.locator('[data-cell][title="rank 1"]').first().click()
  await page.locator('[data-cell="1-0"]').click()
  await walk(page, 0, 9, 30)
  await page.waitForTimeout(400)
  const grand = appears(page, '[data-fx-grand="12"]')
  await page.locator('[data-cell="1-9"]').click()
  await page.locator('[data-cell="1-10"]').click()
  ok('rank 12 plays the grand prize', await grand)
  await page.waitForTimeout(700)
  const text = (await page.locator('[data-fx-grand="12"]').innerText()).replace(/\s+/g, ' ')
  ok(`...naming it ("${text.trim()}")`, /Rank 12 — Grand prize!/.test(text) && !/Recompletion/.test(text))
  ok('...with the rank 12 item shown large, and paper falling across the board', /main-rank-12/.test((await page.locator('[data-fx-grand="12"] img').getAttribute('src')) ?? '') && (await page.locator('[data-fx-grand="12"] img').evaluate((el) => el.getBoundingClientRect().width)) > 100 && (await page.locator('[data-fx-grand="12"] [data-fx-rain] span').count()) > 20)
  await shot(page, 'motion-grand')
  ok('...and nothing in it can take a click', (await page.locator('[data-fx-layer]').evaluate((el) => getComputedStyle(el).pointerEvents)) === 'none')
  await page.waitForTimeout(2400)
  ok('...and it clears away', (await page.locator('[data-fx-grand]').count()) === 0)

  // With Recompletion attached, the same moment says what comes next and the new board fades in.
  await open(page, [ladderBoard('Main 1', 11, { targetEv: 1 })], { rcBoards: [ladderBoard('RC 1', 13, { targetEv: 1, minRank: 3 })] })
  await generator(page).click()
  await page.waitForTimeout(500)
  await page.locator('[data-cell][title="rank 1"]').first().click()
  await page.locator('[data-cell="1-0"]').click()
  await walk(page, 0, 9, 30)
  await page.waitForTimeout(400)
  const swap = appears(page, '[data-board-fx="swap"]', 4000)
  const grandRc = appears(page, '[data-fx-grand="12"]')
  await page.locator('[data-cell="1-9"]').click()
  await page.locator('[data-cell="1-10"]').click()
  ok('with Recompletion: the merge plays out first, then the new board slides in', await swap)
  ok('...and the grand prize says Recompletion begins', (await grandRc) && /Recompletion begins — chase rank 14/.test(await page.locator('[data-fx-grand="12"]').innerText()))
  ok('grand prize: zero page errors', errors.length === 0)
  await browser.close()
}

// ---------- a board pushing in ------------------------------------------
{
  const first = ladderBoard('Board 1', 4, { targetEv: 1 })
  const wave = createBoard('Board 2', { rows: 1, cols: 4 })
  wave.tiles = [['semi', 'open', 'open', 'semi']]
  wave.semiPlacements = [
    { row: 0, col: 0, rank: 3 },
    { row: 0, col: 3, rank: 4 },
  ]
  wave.blockedQueue = []
  const { browser, page, errors } = await launch()
  await open(page, [first, wave])
  await generator(page).click()
  await page.waitForTimeout(500)
  await page.locator('[data-cell][title="rank 1"]').first().click()
  await page.locator('[data-cell="1-0"]').click()
  await walk(page, 0, 2, 250)
  const rowsBefore = await page.locator('[data-cell]').count()
  const push = appears(page, '[data-board-fx="push"]')
  await page.locator('[data-cell="1-2"]').click()
  await page.locator('[data-cell="1-3"]').click()
  ok('clearing the board pushes the next one in, sliding down from the top', await push)
  await page.waitForTimeout(700)
  ok('...the new row is on top and the board is at rest again', (await page.locator('[data-cell]').count()) === rowsBefore && /rank 3/.test(await page.locator('[data-cell="0-0"]').getAttribute('title')) && (await page.locator('[data-board-fx]').count()) === 0)
  ok('the rank 5 that was pushed off the bottom is waiting in the inventory', (await page.locator('button[title^="rank 5"][title*="click to drop it"]').count()) === 1)
  ok('no copy or burst is left pointing at a cell that moved', (await page.locator('[data-fx-slide], [data-fx-fly]').count()) === 0)
  ok('board push: zero page errors', errors.length === 0)
  await browser.close()
}

// ---------- a lucky drop -------------------------------------------------
{
  // The most generous lucky-drop setting, open from the first item held.
  const board = ladderBoard('Main 1', 6, { targetEv: 2.33, tier2UnlockRank: 1, tier4UnlockRank: 12 })
  const { browser, page, errors } = await launch()
  await open(page, [board])
  let lucky = false
  for (let i = 0; i < 6 && !lucky; i++) {
    const seen = appears(page, '[data-fx-burst="lucky"]', 900)
    await page.getByRole('button', { name: /x1/ }).first().click().catch(() => {})
    await generator(page).click()
    lucky = await seen
  }
  ok('a lucky generator item is celebrated in gold', lucky)
  if (lucky) {
    const label = await page.locator('[data-fx-burst="lucky"] [data-burst-label]').first().innerText()
    ok(`...and says what it was ("${label}")`, /^LUCKY \+[12]!$/.test(label))
  }
  ok('lucky drop: zero page errors', errors.length === 0)
  await browser.close()
}

// ---------- reduced motion ----------------------------------------------
{
  const { browser, page, errors } = await launch({ reducedMotion: 'reduce' })
  await open(page, [ladderBoard('Main 1', 11, { targetEv: 1 })])
  await generator(page).click()
  await page.waitForTimeout(120)
  ok('reduced motion: nothing is thrown', (await page.locator('[data-fx-fly]').count()) === 0)
  await page.locator('[data-cell][title="rank 1"]').first().click()
  await page.locator('[data-cell="1-0"]').click()
  await page.waitForTimeout(120)
  ok('reduced motion: no slide, no burst, and the merged item is simply there', (await page.locator('[data-fx-slide], [data-fx-burst]').count()) === 0 && (await page.locator('[data-cell="1-0"][title^="rank 2"] img.play-item').evaluate((el) => getComputedStyle(el).opacity)) === '1')
  ok('reduced motion: zero page errors', errors.length === 0)
  await browser.close()
}

const fails = finish('Play motion E2E')
process.exit(fails === 0 ? 0 : 1)
