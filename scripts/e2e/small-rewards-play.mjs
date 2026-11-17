// Browser end-to-end: real play. Reward-item reveal, merge, manual
// collection, rank-4 auto-collection, merge drops landing as board items,
// energy entering the usable balance and funding generation - in the Play
// Tester - then a shared ?play link carrying an RC variant, played through
// the gated normal-to-RC transition in Play Stage. See helpers.mjs.
import { createBoard } from '../../src/features/merge/lib/board.js'
import { encodeReward } from '../../src/features/merge/lib/rewardChain.js'
import { createDropGroup, createDropGroupsConfig } from '../../src/features/merge/lib/dropGroups.js'
import { RC_MAX_RANK } from '../../src/features/merge/lib/ranks.js'
import { encodeStage } from '../../src/features/merge/lib/stageShare.js'
import { BASE, createChecker, ladderBoard, launch, openMerge, tab } from './helpers.mjs'

const { ok, finish } = createChecker()

// ---------- Play Tester ------------------------------------------------
const COLS = 4
const playBoard = createBoard('Board 1', { rows: 3, cols: COLS })
playBoard.tiles = [
  ['open', 'open', 'open', 'open'],
  ['semi', 'open', 'semi', 'open'],
  ['open', 'open', 'blocked', 'open'],
]
playBoard.semiPlacements = [
  { row: 1, col: 0, rank: encodeReward('energy', 3) },
  { row: 1, col: 2, rank: 1 },
]
playBoard.rewardSemiItems = [{ row: 1, col: 0, type: 'energy', rank: 3 }]
// Coins are paid in allowance worth (never seeded) - define this fixture's.
;[0.05, 0.12, 0.27, 0.6].forEach((worth, i) => (playBoard.rewardChainConfig.coins[i] = { ...playBoard.rewardChainConfig.coins[i], prizeAmount: worth, syntax: `allowance(coins:${worth})` }))
playBoard.blockedQueue = [encodeReward('coins', 1)]
playBoard.rewardQueueItems = [{ type: 'coins', rank: 1 }]
// Every merge that produces rank 2 or higher drops one bucket: an energy
// rank-3 item and a puzzles rank-1 item.
playBoard.minDropRank = 2
playBoard.dropGroups = [createDropGroup({ id: 'g-bucket', name: 'Energy R3 + Puzzle R1', items: { energy: 3, puzzles: 1 } })]
playBoard.dropGroupsConfig = createDropGroupsConfig(RC_MAX_RANK)
for (const t of playBoard.dropGroupsConfig) {
  t.noDropWeight = 0
  t.entries = [{ groupId: 'g-bucket', weight: 1 }]
}

{
  const { browser, page, errors } = await launch({ save: { segments: [{ name: 'Segment 1', boards: [playBoard] }] } })
  await openMerge(page)
  await tab(page, 'Play tester').click()
  await page.waitForTimeout(400)

  const cell = (r, c) => page.locator('[style*="grid-template-columns"] button').nth(r * COLS + c)
  const balance = async (label) => {
    const tile = page.locator('div.grid.grid-cols-4 > div', { hasText: new RegExp(label, 'i') }).first()
    if (!(await tile.count())) return null
    return Number((await tile.locator('div').nth(1).innerText()).replace(/[^0-9.]/g, ''))
  }
  const energyTiles = page.locator('[title*="Merge Energy reward, rank 3"]')
  const freeEnergy = page.locator('[title*="Merge Energy reward, rank 3"]:not([title*="semi-blocked"])')

  ok('a reward item on a semi tile renders as a reward tile, and says it is semi-blocked', (await energyTiles.count()) === 1 && (await cell(1, 0).getAttribute('title'))?.includes('semi-blocked'))
  await cell(1, 0).click()
  await cell(1, 0).click()
  await page.waitForTimeout(250)
  ok('a semi-blocked reward item cannot be collected by tapping it', (await energyTiles.count()) === 1 && !((await balance('Merge')) > 0))

  // One generator tap, merged into the semi-blocked rank 1 next to the
  // blocked tile: the tile opens, and the merge drops its bucket.
  await page.getByRole('button', { name: /Spend generator/ }).click()
  await page.waitForTimeout(120)
  const thrown = await page.locator('[data-fx-fly]').first().evaluate((el) => ({ src: el.getAttribute('src'), animation: getComputedStyle(el).animationName })).catch(() => null)
  ok('a generator tap throws its item onto the board (a flying copy of the rank-1 sprite)', !!thrown && /main-rank-01/.test(thrown.src) && thrown.animation === 'play-fx-fly')
  await page.waitForTimeout(250)
  await page.locator('button[title="rank 1 (1 DR)"]').first().click()
  await cell(1, 2).click()
  await page.waitForTimeout(150)
  const jumped = await page.locator('[data-fx-fly]').evaluateAll((els) => els.map((e) => e.getAttribute('src')))
  ok(`the drops jump out of the merged item (${jumped.length} flying)`, jumped.some((s) => /energy-rank-3/.test(s)) && jumped.some((s) => /puzzle-rank-1/.test(s)))
  await page.waitForTimeout(300)
  ok('a merge next to a blocked tile reveals the reward item queued under it', (await cell(2, 2).getAttribute('title'))?.includes('Coins reward, rank 1'))
  ok('...and that reward item is semi-blocked when revealed, like any other item', (await cell(2, 2).getAttribute('title'))?.includes('semi-blocked'))
  await cell(2, 2).click()
  await cell(2, 2).click()
  await page.waitForTimeout(250)
  ok('it cannot be collected until a matching item frees it', (await page.locator('[title*="Coins reward"]').count()) === 1 && !((await balance('Coin allow')) > 0))
  ok('the merge dropped one bucket: both of its items landed on the board as real reward items', (await page.locator('[title*="Puzzles reward, rank 1"]').count()) === 1 && (await freeEnergy.count()) === 1 && (await energyTiles.count()) === 2)

  // Merging the dropped (free) energy item into the semi-blocked one frees
  // it - and two rank 3s make a rank 4, which collects automatically.
  await freeEnergy.first().click()
  await cell(1, 0).click()
  await page.waitForTimeout(200)
  const payout = await page.locator('[data-fx-payout="energy"]').first().innerText().catch(() => '')
  ok(`reaching rank 4 shows what was paid ("${payout.replace(/\s+/g, ' ').trim()}")`, /\+75/.test(payout) && /collected/i.test(payout))
  await page.waitForTimeout(200)
  ok('a matching dropped item frees the semi-blocked one; the rank-4 prize collects automatically (75 energy)', (await balance('Merge')) === 75 && (await energyTiles.count()) === 0)
  const energyButton = page.getByRole('button', { name: /Use 1 energy/ })
  ok('the collected energy is in the usable balance', (await energyButton.isEnabled()) && /75 held/.test(await energyButton.innerText()))

  // Energy funds a generator action at no DR cost.
  await energyButton.click()
  await page.waitForTimeout(300)
  ok('one energy funds one generator action: 74 held, a rank-1 item spawned, still only 1 DR spent', /74 held/.test(await energyButton.innerText()) && (await page.locator('button[title="rank 1 (1 DR)"]').count()) === 1 && (await page.getByRole('button', { name: /Compare to automatic simulator at 1 DR/ }).isVisible()))
  ok('collected energy stays the cumulative payout (75) after spending', (await balance('Merge')) === 75)

  // A second main-chain merge drops a second bucket; two dropped puzzles
  // items merge with each other like any reward item.
  await energyButton.click()
  await page.waitForTimeout(250)
  const ones = page.locator('button[title="rank 1 (1 DR)"]')
  await ones.nth(0).click()
  await ones.nth(1).click()
  await page.waitForTimeout(400)
  const puzzleTiles = page.locator('[title*="Puzzles reward, rank 1"]')
  ok('a second main-chain merge dropped a second bucket', (await puzzleTiles.count()) === 2 && (await freeEnergy.count()) === 1)
  await puzzleTiles.nth(0).click()
  await puzzleTiles.nth(1).click()
  await page.waitForTimeout(300)
  const puzzle2 = page.locator('[title*="Puzzles reward, rank 2"]')
  ok('two dropped reward items merge up their chain (puzzles rank 2 on the board)', (await puzzle2.count()) === 1)

  // Manual collection of a FREE reward item: select, then tap again.
  await puzzle2.first().click()
  ok('a selected free reward tile says to tap again to collect', (await puzzle2.first().getAttribute('title'))?.includes('tap again to collect'))
  await puzzle2.first().click()
  await page.waitForTimeout(300)
  ok('tapping it again hand-collects it at its own rank worth (15 puzzles)', (await balance('Puzzles')) === 15 && (await page.locator('[title*="Puzzles reward"]').count()) === 0)

  ok('Play Tester: zero page errors', errors.length === 0)
  await browser.close()
}

// ---------- Play Stage via a shared link, through RC -------------------
const mainLadder = ladderBoard('Main 1', 11)
// targetEv 1 (no lucky drops): the player now arrives in Recompletion holding the rank 12, which opens
// lucky drops at once - a random bonus rank would make the scripted climb below unrepeatable.
const rcLadder = ladderBoard('RC B 1', 13, { targetEv: 1, tier2UnlockRank: 3, minDropRank: 4 })
rcLadder.dropGroups = [createDropGroup({ id: 'rc-charm', name: 'RC charms', items: { charms: 4 } })]
rcLadder.dropGroupsConfig = createDropGroupsConfig(RC_MAX_RANK)
for (const t of rcLadder.dropGroupsConfig) {
  t.noDropWeight = 0
  t.entries = [{ groupId: 'rc-charm', weight: 1 }]
}

// `start` is the rank the generator gives: 1 on the normal boards; in
// Recompletion the player arrives holding the rank 12, so the x4 multiplier
// is open at once and a tap gives a rank 3.
async function climb(page, top, start = 1) {
  await page.getByRole('button', { name: /Use generator/ }).click()
  await page.waitForTimeout(150)
  await page.locator(`[data-cell][title="rank ${start}"]`).first().click()
  await page.locator(`[data-cell="1-${start - 1}"]`).click()
  for (let k = start - 1; k < top - 1; k++) {
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
  ok('the shared link opens the stage (no broken-link banner)', !(await page.getByText(/share link looks broken/).isVisible().catch(() => false)) && (await page.locator('[data-cell="1-10"]').count()) === 1)

  // Climb to rank 11 only: the RC round must NOT have started yet.
  await page.getByRole('button', { name: /Use generator/ }).click()
  await page.waitForTimeout(150)
  await page.locator('[data-cell][title="rank 1"]').first().click()
  await page.locator('[data-cell="1-0"]').click()
  for (let k = 0; k < 9; k++) {
    await page.locator(`[data-cell="1-${k}"]`).click()
    await page.locator(`[data-cell="1-${k + 1}"]`).click()
  }
  await page.waitForTimeout(200)
  ok('before rank 12 and a cleared board, the stage is still in the normal round', (await page.locator('[data-testid="rc-active"]').count()) === 0)
  ok('no small-reward balances appear in the normal round (the main list has no drop groups)', (await page.getByText('Charms', { exact: true }).count()) === 0)
  await page.locator('[data-cell="1-9"]').click()
  await page.locator('[data-cell="1-10"]').click()
  await page.waitForTimeout(400)
  ok('reaching rank 12 starts the Recompletion round', await page.locator('[data-testid="rc-active"]').isVisible())
  ok('...shown as the Recompletion round (one Recompletion mode, no variants)', /Recompletion round —/.test(await page.locator('[data-testid="rc-active"]').innerText()))
  ok('...on the RC variant\'s own board (13 columns)', (await page.locator('[data-cell="1-12"]').count()) === 1)

  ok('the player arrives holding the rank 12, free', (await page.locator('[data-cell][title="rank 12"]').count()) === 1)
  ok('...so the x4 multiplier is open straight away', /Use generator \(x4\)/.test(await page.getByRole('button', { name: /Use generator/ }).innerText()))
  await climb(page, 13, 3)
  ok('RC merges use the RC variant\'s own drop configuration (charms are collected)', (await page.getByText('Charms', { exact: true }).count()) >= 1)
  ok('reaching rank 14 awards the second grand prize', await page.getByText(/second grand prize/).isVisible())

  // A link shared before RC existed (bare board list) still plays, ending at rank 12.
  await page.goto(`${BASE}?play&stage=${encodeStage([mainLadder])}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  await climb(page, 11)
  ok('a main-only link (the pre-RC format) still plays to its rank-12 finish', (await page.getByText(/the chain is complete/).isVisible()) && (await page.locator('[data-testid="rc-active"]').count()) === 0)

  ok('Play Stage: zero page errors', errors.length === 0)
  await browser.close()
}

const fails = finish('Small Rewards play E2E')
process.exit(fails === 0 ? 0 : 1)
