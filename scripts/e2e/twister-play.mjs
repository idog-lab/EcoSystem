// Browser end-to-end: Twister in real play. Drops land on the board, merge,
// collect by hand and at rank 4; collected DR funds spins, each spin deducts
// its cost once, earned DR never goes down; Twister never starts under a
// tile and never becomes energy - in the Play Tester - then a shared ?play
// link carrying the segment's cost through the RC transition (Play Stage).
// Also checks the supplied artwork on real board tiles. See helpers.mjs.
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { createDropGroup, createDropGroupsConfig } from '../../src/features/merge/lib/rewards/dropGroups.js'
import { RC_MAX_RANK } from '../../src/features/merge/lib/core/ranks.js'
import { encodeStage } from '../../src/features/merge/lib/share/stageShare.js'
import { BASE, createChecker, ladderBoard, launch, openMerge, tab } from './helpers.mjs'

const { ok, finish } = createChecker()
const SHOT = process.env.E2E_SCREENSHOT_DIR ?? null

function withTwister(board, { values = [2, 5, 12, 30], itemRank = 1, minDropRank = 2, cost = 5, objective = null } = {}) {
  values.forEach((v, i) => (board.rewardChainConfig.twister[i] = { ...board.rewardChainConfig.twister[i], syntax: `e2e-twister-${i + 1}`, prizeAmount: v }))
  board.minDropRank = minDropRank
  board.dropGroups = [createDropGroup({ id: 'tw', name: 'Twister', items: { twister: itemRank } })]
  board.dropGroupsConfig = createDropGroupsConfig(RC_MAX_RANK)
  for (const t of board.dropGroupsConfig) {
    t.noDropWeight = 0
    t.entries = [{ groupId: 'tw', weight: 1 }]
  }
  board.twisterSpinCost = cost
  board.twisterSpinObjective = objective
  return board
}

// ---------- Play Tester ------------------------------------------------
// Every merge producing rank 2+ drops one rank-1 Twister item (2 DR).
const COLS = 5
const playBoard = createBoard('Board 1', { rows: 3, cols: COLS })
playBoard.tiles = [
  ['open', 'open', 'open', 'open', 'open'],
  ['open', 'open', 'open', 'open', 'open'],
  ['open', 'open', 'blocked', 'open', 'open'],
]
playBoard.semiPlacements = []
playBoard.blockedQueue = [3]
withTwister(playBoard, { cost: 5, objective: 3 })

{
  const { browser, page, errors } = await launch({ save: { segments: [{ name: 'Segment 1', boards: [playBoard] }] } })
  await openMerge(page)
  await tab(page, 'Play tester').click()
  await page.waitForTimeout(400)

  const widget = page.getByTestId('twister-widget')
  const num = async (id) => Number((await page.getByTestId(id).innerText()).replace(/[^0-9.-]/g, ''))
  const gen = page.getByRole('button', { name: /Spend generator/ })
  const ones = page.locator('button[title="rank 1 (1 DR)"]')
  const twisterTiles = (rank) => page.locator(`button[title*="Twister DR reward, rank ${rank}"]`)
  const mergeTwoOnes = async () => {
    await gen.click()
    await gen.click()
    await page.waitForTimeout(150)
    await ones.nth(0).click()
    await ones.nth(1).click()
    await page.waitForTimeout(250)
  }

  ok('the Twister widget shows: balance 0, the segment\'s cost per spin, spins used 0', (await widget.isVisible()) && (await num('twister-balance')) === 0 && (await page.getByTestId('twister-cost').innerText()).includes('5 Twister DR') && (await num('twister-spins-used')) === 0)
  ok('...and progress toward the configured spin objective', (await page.getByTestId('twister-objective').innerText()).includes('0 / 3 spins'))
  ok('it is labelled an economy preview (no spin result is modelled)', (await widget.innerText()).includes('economy preview'))
  ok('the board starts with no Twister item anywhere', (await page.locator('button[title*="Twister DR reward"]').count()) === 0)
  ok('a spin is not possible with an empty balance', await page.getByTestId('twister-spin').isDisabled())

  // Real artwork on real tiles.
  await gen.click()
  await page.waitForTimeout(150)
  const itemSrc = await ones.first().locator('img').first().getAttribute('src')
  ok('a main-chain item is drawn with its sprite from the asset pack, on the open tile', /main-rank-01/.test(itemSrc ?? '') && /tile-(cream|peach)/.test(await ones.first().evaluate((el) => getComputedStyle(el).backgroundImage)))
  const drawn = await ones.first().locator('img').first().evaluate((el) => ({ fit: getComputedStyle(el).objectFit, loaded: el.complete && el.naturalWidth > 0 }))
  ok('the sprite is loaded and contained, never stretched', drawn.loaded && drawn.fit === 'contain')
  const seedScale = Number(await ones.first().locator('img').first().getAttribute('data-art-scale'))
  const seedBox = await ones.first().locator('img').first().boundingBox()
  const tileBox = await ones.first().boundingBox()
  ok(`a rank 1 keeps its proportion to the bigger items (drawn at ${seedScale} of full size, ${Math.round(seedBox.width)}px on a ${Math.round(tileBox.width)}px tile)`, seedScale > 0.3 && seedScale < 0.6 && seedBox.width < tileBox.width * 0.62)
  ok('...and still shows its rank as a badge and an accessible label', (await ones.first().innerText()).includes('1') && (await ones.first().getAttribute('aria-label')) === 'rank 1 (1 DR)')
  const lockedBg = await page.locator('button[title="locked"]').first().evaluate((el) => getComputedStyle(el).backgroundImage)
  ok('a blocked tile is drawn with the leaf cover over the tile', /blocked-cover/.test(lockedBg) && /tile-(cream|peach)/.test(lockedBg))
  const openBg = await page.locator('button[title="open"]').first().evaluate((el) => getComputedStyle(el).backgroundImage)
  ok('an open tile is drawn with the cream or peach tile', /tile-(cream|peach)/.test(openBg))
  const size = await ones.first().boundingBox()
  ok(`tiles are a readable size (${Math.round(size.width)}px)`, size.width >= 40)

  // Merge 1+1 -> rank 2: a Twister rank-1 item drops ONTO the board.
  await gen.click()
  await page.waitForTimeout(150)
  await ones.nth(0).click()
  await ones.nth(1).click()
  await page.waitForTimeout(250)
  ok('a main-chain merge drops a Twister item onto the board (it takes a cell)', (await twisterTiles(1).count()) === 1)
  ok('the dropped item is not collected by landing: balance still 0', (await num('twister-balance')) === 0 && (await num('twister-earned')) === 0)
  ok('a Twister item is drawn with its own sprite from the asset pack', /Twister DR reward/.test((await twisterTiles(1).first().getAttribute('title')) ?? '') && /twister-rank-1/.test((await twisterTiles(1).first().locator('img').first().getAttribute('src')) ?? ''))

  // Manual collection of a rank-1 item: 2 DR.
  await twisterTiles(1).first().click()
  await twisterTiles(1).first().click()
  await page.waitForTimeout(200)
  ok('collecting a rank-1 Twister item by hand credits its 2 DR to the Twister balance', (await num('twister-balance')) === 2 && (await num('twister-earned')) === 2 && (await twisterTiles(1).count()) === 0)
  ok('Twister DR is not merge energy: no energy was credited and no free tap is offered', !(await page.getByRole('button', { name: /Use 1 energy/ }).isEnabled().catch(() => false)))

  // Two more drops -> merge the two Twister rank-1s into a rank 2.
  await mergeTwoOnes()
  await mergeTwoOnes()
  ok('more main-chain merges drop more Twister items', (await twisterTiles(1).count()) === 2)
  const before = await page.locator('button[title*="Twister DR reward"]').count()
  await twisterTiles(1).nth(0).click()
  await twisterTiles(1).nth(1).click()
  await page.waitForTimeout(250)
  ok('two Twister items merge into the next rank', (await twisterTiles(2).count()) === 1)
  ok('...and that reward merge does NOT drop anything', (await page.locator('button[title*="Twister DR reward"]').count()) === before - 1)
  await twisterTiles(2).first().click()
  await twisterTiles(2).first().click()
  await page.waitForTimeout(200)
  ok('collecting the rank-2 item credits its 5 DR (balance 7)', (await num('twister-balance')) === 7 && (await num('twister-earned')) === 7)

  // Spin: deducts exactly the cost, once; earned stays.
  ok('with 7 DR and a cost of 5, a spin is available', await page.getByTestId('twister-spin').isEnabled())
  await page.getByTestId('twister-spin').click()
  await page.waitForTimeout(200)
  ok('one spin deducts exactly its cost once: balance 2, spins used 1', (await num('twister-balance')) === 2 && (await num('twister-spins-used')) === 1)
  ok('earned Twister DR is cumulative - spending did not reduce it (7)', (await num('twister-earned')) === 7)
  ok('spin-objective progress advanced (1 / 3)', (await page.getByTestId('twister-objective').innerText()).includes('1 / 3 spins'))
  ok('a second spin is blocked: 2 DR is less than the cost', (await page.getByTestId('twister-spin').isDisabled()) && (await page.getByTestId('twister-cost').innerText()).includes('3 more needed'))
  ok('the generator still costs main DR only - Twister DR did not fund it', (await page.getByRole('button', { name: /Compare to automatic simulator at 6 DR/ }).isVisible()))

  // Twister drops keep coming after spins are used.
  await mergeTwoOnes()
  ok('Twister drops do not stop after a spin', (await twisterTiles(1).count()) >= 1)
  if (SHOT) await page.screenshot({ path: `${SHOT}/3-play-tester.png`, fullPage: true })

  ok('Play Tester: zero page errors', errors.length === 0)
  await browser.close()
}

// ---------- Play Stage via a shared link, through RC -------------------
// Main: cost 4. RC variant B: its own cost (9) and its own drops (rank 3).
const mainLadder = withTwister(ladderBoard('Main 1', 11), { itemRank: 2, minDropRank: 10, cost: 4 })
const rcLadder = withTwister(ladderBoard('RC B 1', 13), { itemRank: 3, minDropRank: 13, cost: 9 })

async function climb(page, from, to) {
  for (let k = from; k < to; k++) {
    await page.locator(`[data-cell="1-${k}"]`).click()
    await page.locator(`[data-cell="1-${k + 1}"]`).click()
  }
  await page.waitForTimeout(300)
}

{
  const { browser, page, errors } = await launch()
  const link = `${BASE}?play&stage=${encodeStage([mainLadder], { rcBoards: [rcLadder] })}`
  await page.goto(link, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const num = async (id) => Number((await page.getByTestId(id).innerText()).replace(/[^0-9.-]/g, ''))
  const twister = (rank) => page.locator(`[data-cell][title*="Twister DR reward R${rank}"]`)

  ok('the shared link carries the Twister widget with the segment\'s cost (4)', (await page.getByTestId('twister-widget').isVisible()) && (await page.getByTestId('twister-cost').innerText()).includes('4 Twister DR'))
  ok('the shared stage starts with no Twister item on the board', (await page.locator('[data-cell][title*="Twister DR reward"]').count()) === 0)
  const stageSrc = await page.locator('[data-cell="1-4"] img').first().getAttribute('src')
  ok('Play Stage draws items with the asset pack too', /main-rank-05/.test(stageSrc ?? ''))

  // One tap, merge into the ladder: 1->2 ... up to rank 12 (11 merges).
  await page.getByRole('button', { name: /Use generator/ }).click()
  await page.waitForTimeout(150)
  await page.locator('[data-cell][title="rank 1"]').first().click()
  await page.locator('[data-cell="1-0"]').click()
  await climb(page, 0, 7) // merges producing ranks 3..9 (after the first, rank 2): all below the drop gate
  ok('merges below the drop start rank drop no Twister', (await page.locator('[data-cell][title*="Twister DR reward"]').count()) === 0)
  await climb(page, 7, 8) // produces rank 10 -> drop (rank-2 Twister item)
  ok('a merge at the drop start rank drops a rank-2 Twister item on the board', (await twister(2).count()) === 1)
  await twister(2).first().click()
  await twister(2).first().click()
  await page.waitForTimeout(200)
  ok('collecting it in Play Stage credits 5 Twister DR', (await num('twister-balance')) === 5)
  await page.getByTestId('twister-spin').click()
  await page.waitForTimeout(200)
  ok('a spin at the main-phase cost (4) leaves 1 DR and counts 1 spin', (await num('twister-balance')) === 1 && (await num('twister-spins-used')) === 1 && (await num('twister-earned')) === 5)

  await climb(page, 8, 9) // rank 11 (one more drop)
  await page.waitForTimeout(200)
  // The merge that makes the rank 12 drops one more Twister item (unless it pairs up and collects).
  const twisterAtRank11 = await page.locator('[data-cell][title*="Twister DR reward"]').count()
  await climb(page, 9, 10) // rank 12 -> Recompletion begins at once, and everything on the board comes along
  await page.waitForTimeout(300)
  const twisterBeforeRc = await page.locator('[data-cell][title*="Twister DR reward"]').count()
  ok(`there were Twister items on the board going in (${twisterAtRank11} at rank 11, ${twisterBeforeRc} on arrival)`, twisterBeforeRc >= twisterAtRank11 && twisterBeforeRc >= 1)
  ok('the gated transition into the Recompletion round happened', (await page.getByTestId('rc-active').innerText()).includes('Recompletion round'))
  ok('RC uses the RC list\'s own cost per spin (9)', (await page.getByTestId('twister-cost').innerText()).includes('9 Twister DR'))
  ok('the earned total and spin count carried on unchanged (no reset rule is invented)', (await num('twister-earned')) === 5 && (await num('twister-spins-used')) === 1)
  // Everything on the board comes along into Recompletion - Twister items too.
  ok('Twister items on the board come along into Recompletion; nothing is deleted at the hand-over', (await page.locator('[data-cell][title*="Twister DR reward"]').count()) === twisterBeforeRc)
  if (SHOT) await page.screenshot({ path: `${SHOT}/4-play-stage.png`, fullPage: true })

  ok('Play Stage: zero page errors', errors.length === 0)
  await browser.close()
}

const fails = finish('Twister play E2E')
process.exit(fails === 0 ? 0 : 1)
