// Browser end-to-end: a shared stage on a PHONE. The stage link is mostly
// opened on a phone, held sideways (the economist: "the stage share is mostly
// to be used on the phone. prefered landscaped"). In landscape the whole
// board and everything needed to play are on screen at once, with nothing to
// scroll sideways and no page to scroll; upright it still plays and suggests
// turning the phone. Touch is emulated (hasTouch, isMobile). See helpers.mjs.
//
// Set E2E_SCREENSHOT_DIR to keep a picture of every size.
import { chromium } from 'playwright'
import { createDropGroup, createDropGroupsConfig } from '../../src/features/merge/lib/rewards/dropGroups.js'
import { RC_MAX_RANK } from '../../src/features/merge/lib/core/ranks.js'
import { encodeStage } from '../../src/features/merge/lib/share/stageShare.js'
import { BASE, createChecker, generatedBoard, ladderBoard } from './helpers.mjs'

const { ok, finish } = createChecker()
const SHOT = process.env.E2E_SCREENSHOT_DIR ?? null

// A real stage: a 5x8 first board, two boards that push in, small rewards
// and a Twister dropping from every merge - so every panel has something in it.
function stage() {
  const boards = [
    generatedBoard('Board 1', 0, { rows: 5, cols: 8, blockedRowsFrom: 3, blockedValue: 150 }),
    generatedBoard('Board 2', 1, { rows: 3, cols: 8, blockedRowsFrom: 1, blockedValue: 500 }),
    generatedBoard('Board 3', 2, { rows: 3, cols: 8, blockedRowsFrom: 1, blockedValue: 500 }),
  ]
  const groups = [
    createDropGroup({ id: 'g-energy', name: 'Energy', items: { energy: 3 } }),
    createDropGroup({ id: 'g-coins', name: 'Coins', items: { coins: 3 } }),
    createDropGroup({ id: 'g-twister', name: 'Twister', items: { twister: 3 } }),
  ]
  for (const b of boards) {
    ;[0.05, 0.12, 0.27, 0.6].forEach((worth, i) => (b.rewardChainConfig.coins[i] = { ...b.rewardChainConfig.coins[i], prizeAmount: worth, syntax: `allowance(coins:${worth})` }))
    ;[2, 5, 12, 30].forEach((v, i) => (b.rewardChainConfig.twister[i] = { ...b.rewardChainConfig.twister[i], syntax: `e2e-twister-${i + 1}`, prizeAmount: v }))
    b.minDropRank = 2
    b.dropGroups = groups
    b.dropGroupsConfig = createDropGroupsConfig(RC_MAX_RANK)
    for (const t of b.dropGroupsConfig) {
      t.noDropWeight = 0
      t.entries = groups.map((g) => ({ groupId: g.id, weight: 1 }))
    }
    b.twisterSpinCost = 10
  }
  return boards
}

const url = `${BASE}?play&stage=${encodeStage(stage())}`

// Every phone here is a FIRST VISIT: a fresh browser with nothing stored -
// what the people a link is sent to have.
async function open({ width, height, link = url }) {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => {
    errors.push(e.message)
    console.log('PAGE ERROR:', e.message)
  })
  await page.goto(link, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  return { browser, context, page, errors }
}

// A finger drag from one cell to another, as real touch events (the browser's
// own drag-and-drop never fires for a finger).
async function fingerDrag(context, page, fromSel, toSel) {
  const cdp = await context.newCDPSession(page)
  const a = await page.locator(fromSel).boundingBox()
  const b = await page.locator(toSel).boundingBox()
  const at = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
  const p = at(a)
  const q = at(b)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] })
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x + ((q.x - p.x) * i) / 8, y: p.y + ((q.y - p.y) * i) / 8 }] })
    await page.waitForTimeout(16)
  }
  const ghost = await page.getByTestId('drag-ghost').count()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(350)
  return { ghost }
}

const metrics = (page) =>
  page.evaluate(() => {
    const box = (el) => (el ? el.getBoundingClientRect() : null)
    const doc = document.scrollingElement
    const cells = [...document.querySelectorAll('[data-cell]')]
    const first = box(cells[0])
    const last = box(cells[cells.length - 1])
    const gen = box(document.querySelector('[data-tutorial="generate-button"]'))
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      scrollW: doc.scrollWidth,
      scrollH: doc.scrollHeight,
      cell: first ? Math.round(first.width) : 0,
      boardTop: first ? Math.round(first.top) : null,
      boardBottom: last ? Math.round(last.bottom) : null,
      boardRight: last ? Math.round(last.right) : null,
      gen: gen ? { top: Math.round(gen.top), bottom: Math.round(gen.bottom), left: Math.round(gen.left), right: Math.round(gen.right), height: Math.round(gen.height) } : null,
    }
  })

// A few merges by tapping: tap the generator, then tap two matching free items.
async function playABit(page, taps = 14) {
  const gen = page.locator('[data-tutorial="generate-button"]')
  let merges = 0
  for (let i = 0; i < taps; i++) {
    await gen.tap()
    await page.waitForTimeout(260)
    const pair = await page.evaluate(() => {
      const seen = new Map()
      for (const el of document.querySelectorAll('[data-cell][data-movable="true"]')) {
        const label = el.getAttribute('aria-label') ?? ''
        const m = label.match(/^rank (\d+)/)
        if (!m) continue
        if (seen.has(m[1])) return [seen.get(m[1]), el.getAttribute('data-cell')]
        seen.set(m[1], el.getAttribute('data-cell'))
      }
      return null
    })
    if (pair) {
      await page.locator(`[data-cell="${pair[0]}"]`).tap()
      await page.waitForTimeout(120)
      await page.locator(`[data-cell="${pair[1]}"]`).tap()
      await page.waitForTimeout(420)
      merges += 1
    }
  }
  return merges
}

console.log('--- 1. Phones held sideways: everything on one screen ---')
for (const [name, width, height] of [
  ['iPhone SE sideways', 667, 375],
  ['small Android sideways', 740, 360],
  ['iPhone 14 sideways', 844, 390],
  ['large phone sideways', 932, 430],
]) {
  const { browser, page, errors } = await open({ width, height })
  const m = await metrics(page)
  ok(`${name} (${width}x${height}): nothing to scroll sideways, and the page itself does not scroll`, m.scrollW <= m.vw + 1 && m.scrollH <= m.vh + 1)
  ok(`...the whole board is on screen (rows end at ${m.boardBottom} of ${m.vh}px), with tiles big enough to tap (${m.cell}px)`, m.boardTop >= 0 && m.boardBottom <= m.vh && m.boardRight <= m.vw && m.cell >= 40)
  ok(`...and the generator button is on screen and thumb-sized (${m.gen?.height}px tall)`, !!m.gen && m.gen.top >= 0 && m.gen.bottom <= m.vh && m.gen.right <= m.vw && m.gen.height >= 44)
  const merges = await playABit(page)
  const after = await metrics(page)
  ok(`...it plays by tapping (${merges} merges), and the layout holds once rewards and the Twister show up`, merges >= 3 && after.scrollW <= after.vw + 1 && after.boardBottom <= after.vh && after.gen.bottom <= after.vh && errors.length === 0)
  ok('...the turn-your-phone hint is not shown sideways', (await page.getByTestId('rotate-hint').count()) === 0)
  if (SHOT) await page.screenshot({ path: `${SHOT}/play-${width}x${height}.png` })
  await browser.close()
}

console.log('--- 2. Held upright it still plays, and suggests turning the phone ---')
{
  const { browser, page, errors } = await open({ width: 390, height: 844 })
  const m = await metrics(page)
  ok(`upright (390x844): nothing to scroll sideways, the board fits the width (${m.cell}px tiles)`, m.scrollW <= m.vw + 1 && m.boardRight <= m.vw && m.cell >= 36)
  ok('...it suggests turning the phone sideways, and the hint can be closed', (await page.getByTestId('rotate-hint').count()) === 1)
  ok(`...the generator button sits right under the board, on the first screen with it (ends at ${m.gen?.bottom} of ${m.vh}px)`, !!m.gen && m.gen.top >= m.boardBottom && m.gen.bottom <= m.vh && m.gen.height >= 44)
  await page.getByTestId('rotate-hint-close').tap()
  await page.waitForTimeout(150)
  ok('...closed, it stays closed', (await page.getByTestId('rotate-hint').count()) === 0)
  const merges = await playABit(page, 8)
  ok(`...and it plays by tapping (${merges} merges)`, merges >= 2 && errors.length === 0)
  if (SHOT) await page.screenshot({ path: `${SHOT}/play-390x844.png` })
  // Turning the phone while playing keeps the game going.
  const spendsBefore = await page.getByTestId('stage-spends').innerText()
  await page.setViewportSize({ width: 844, height: 390 })
  await page.waitForTimeout(350)
  const turned = await metrics(page)
  ok('...turning the phone sideways mid-game keeps the game and fits the screen', (await page.getByTestId('stage-spends').innerText()) === spendsBefore && turned.scrollH <= turned.vh + 1 && turned.boardBottom <= turned.vh && turned.gen.bottom <= turned.vh)
  await browser.close()
}

console.log('--- 3. A first visit: no walkthrough, the game is simply there ---')
{
  // (There was a first-time walkthrough: it darkened the screen and took every
  // tap but one - for exactly the people a link is sent to, and never for the
  // economist, whose phone had been through it. Removed by request.)
  for (const [width, height] of [[667, 375], [390, 844]]) {
    const { browser, context, page, errors } = await open({ width, height })
    const blocked = await page.evaluate(() => {
      // Is anything lying over the board or the generator?
      const hit = (el) => {
        const r = el.getBoundingClientRect()
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return !(top === el || el.contains(top))
      }
      const cell = document.querySelector('[data-cell]')
      const gen = document.querySelector('[data-tutorial="generate-button"]')
      gen.scrollIntoView({ block: 'center' })
      return { cell: hit(cell), gen: hit(gen), dialog: document.querySelectorAll('[role="dialog"]').length }
    })
    ok(`${width}x${height}: nothing covers the board or the generator on a first visit, and there is no "How to play"`, !blocked.gen && blocked.dialog === 0 && (await page.getByTestId('tutorial-card').count()) === 0 && (await page.getByText('How to play').count()) === 0 && (await page.getByText('Skip tutorial').count()) === 0)
    const gen = page.locator('[data-tutorial="generate-button"]')
    await gen.tap()
    await page.waitForTimeout(450)
    await gen.tap()
    await page.waitForTimeout(450)
    const ones = await page.locator('[data-cell][title="rank 1"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-cell')))
    await fingerDrag(context, page, `[data-cell="${ones[0]}"]`, `[data-cell="${ones[1]}"]`)
    ok(`${width}x${height}: the very first things a new player does work - two taps on the generator, then a finger drags one item onto the other`, ones.length === 2 && (await page.locator('[data-cell][title="rank 2"]').count()) === 1 && errors.length === 0)
    await browser.close()
  }
}

console.log('--- 4. Recompletion and endless mode on a sideways phone ---')
{
  // Ladder boards: one generator tap and a walk of merges reach rank 12, then 13, then 14.
  const coins = (b) => {
    ;[0.05, 0.12, 0.27, 0.6].forEach((worth, i) => (b.rewardChainConfig.coins[i] = { ...b.rewardChainConfig.coins[i], prizeAmount: worth, syntax: `allowance(coins:${worth})` }))
    return b
  }
  const main = coins(ladderBoard('Main 1', 11, { targetEv: 1 }))
  const rc = coins(ladderBoard('RC 1', 13, { targetEv: 1, tier2UnlockRank: 3, minRank: 3, minDropRank: 6 }))
  const link = `${BASE}?play&stage=${encodeStage([main], { rcBoards: [rc] })}`
  const { browser, page, errors } = await open({ width: 844, height: 390, link })
  const gen = page.locator('[data-tutorial="generate-button"]')
  const walk = async (from, to) => {
    for (let k = from; k < to; k++) {
      await page.locator(`[data-cell="1-${k}"]`).tap()
      await page.locator(`[data-cell="1-${k + 1}"]`).tap()
    }
  }
  await gen.tap()
  await page.waitForTimeout(500)
  await page.locator('[data-cell][title="rank 1"]').first().tap()
  await page.locator('[data-cell="1-0"]').tap()
  await walk(0, 10)
  await page.waitForTimeout(250)
  ok('the merge that makes rank 12 first plays out on the normal board: Recompletion is not in yet, and the generator waits', (await page.getByTestId('rc-active').count()) === 0 && !(await gen.isEnabled()))
  await page.waitForTimeout(1400)
  ok('then the Recompletion board slides in from the top', (await page.locator('[data-board-fx="swap"]').count()) === 1)
  await page.waitForTimeout(1300)
  const inRc = await metrics(page)
  ok('reaching rank 12 starts Recompletion on the phone too: it says so, and the rank strip runs to 14', (await page.getByTestId('rc-active').isVisible()) && /of 14/.test((await page.getByTestId('ranks-strip').getAttribute('aria-label')) ?? ''))
  ok('...and the screen still fits (a 13-wide board gets narrower tiles, nothing scrolls)', inRc.scrollW <= inRc.vw + 1 && inRc.scrollH <= inRc.vh + 1 && inRc.boardRight <= inRc.vw && inRc.gen.bottom <= inRc.vh && inRc.cell >= 30)
  await gen.tap()
  await page.waitForTimeout(500)
  await page.locator('[data-cell][title="rank 3"]').first().tap()
  await page.locator('[data-cell="1-2"]').tap()
  await walk(2, 12)
  await page.waitForTimeout(2600)
  const inEndless = await metrics(page)
  ok('reaching rank 14 starts endless mode: a short line says so, and the board takes the endless look', (await page.getByTestId('endless-active').isVisible()) && (await page.locator('[data-theme="endless"]').count()) === 1 && (await page.getByTestId('rc-active').count()) === 0)
  ok('...the screen still fits, and the generator still works', inEndless.scrollH <= inEndless.vh + 1 && inEndless.gen.bottom <= inEndless.vh && (await gen.isEnabled()) && errors.length === 0)
  if (SHOT) await page.screenshot({ path: `${SHOT}/play-endless-844x390.png` })
  await browser.close()
}

console.log('--- 4b. A finger drags items; the board does not move under it ---')
{
  const { browser, context, page, errors } = await open({ width: 844, height: 390 })
  const gen = page.locator('[data-tutorial="generate-button"]')
  await gen.tap()
  await page.waitForTimeout(450)
  await gen.tap()
  await page.waitForTimeout(450)
  const ones = await page.locator('[data-cell][title="rank 1"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-cell')))
  const empty = await page.locator('[data-cell][title="open"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-cell')))
  const target = empty[empty.length - 1]
  const moved = await fingerDrag(context, page, `[data-cell="${ones[0]}"]`, `[data-cell="${target}"]`)
  ok(`a finger drags an item to an empty cell (the item follows the finger: ${moved.ghost ? 'yes' : 'no'})`, moved.ghost === 1 && (await page.locator(`[data-cell="${target}"]`).getAttribute('title')) === 'rank 1')
  await fingerDrag(context, page, `[data-cell="${ones[1]}"]`, `[data-cell="${target}"]`)
  ok('...and onto a matching item to merge them', (await page.locator(`[data-cell="${target}"]`).getAttribute('title')) === 'rank 2')
  const scrolled = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, ta: getComputedStyle(document.querySelector('[data-fx="board"]')).touchAction }))
  ok(`the page did not scroll under the finger, and the board takes no touch scrolling (touch-action: ${scrolled.ta})`, scrolled.x === 0 && scrolled.y === 0 && scrolled.ta === 'none' && errors.length === 0)
  await browser.close()
}

console.log('--- 4c. Jump ahead, on the shared stage ---')
{
  const main = ladderBoard('Main 1', 11, { targetEv: 1 })
  const rc = ladderBoard('RC 1', 13, { targetEv: 1, minRank: 3 })
  const link = `${BASE}?play&stage=${encodeStage([main], { rcBoards: [rc] })}`
  const { browser, page, errors } = await open({ width: 844, height: 390, link })
  ok('the shared stage offers "To Recompletion" and "To endless"', (await page.getByTestId('jump-rc').isVisible()) && (await page.getByTestId('jump-endless').isVisible()))
  await page.getByTestId('jump-rc').tap()
  await page.waitForTimeout(1400)
  ok('"To Recompletion" lands in Recompletion, holding a rank 12', (await page.getByTestId('rc-active').isVisible()) && (await page.locator('[data-cell][title="rank 12"]').count()) === 1)
  await page.getByTestId('jump-endless').tap()
  await page.waitForTimeout(2600)
  ok('"To endless" lands in endless mode, holding a rank 14', (await page.getByTestId('endless-active').isVisible()) && (await page.locator('[data-cell][title="rank 14"]').count()) === 1 && errors.length === 0)
  await browser.close()
}

console.log('--- 5. A desktop window is unchanged ---')
{
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } })
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const m = await metrics(page)
  ok(`on a desktop window the stage keeps its roomy layout (tiles ${m.cell}px) and shows no phone hint`, m.cell >= 56 && (await page.getByTestId('rotate-hint').count()) === 0 && m.scrollW <= m.vw + 1)
  if (SHOT) await page.screenshot({ path: `${SHOT}/play-desktop.png` })
  await browser.close()
}

process.exit(finish('PLAY ON A PHONE') === 0 ? 0 : 1)
