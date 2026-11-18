// Browser end-to-end: endless mode. A stage is played through the normal
// round and Recompletion to rank 14 - in Play Stage (a shared link) and in
// the Play Tester - and what happens next is checked: the endless theme, the
// one-shot entry effect, the changed drops, and that nothing is taken away.
// See helpers.mjs.  Run: npx vite-node scripts/e2e/endless-mode.mjs
import { createDropGroup, createDropGroupsConfig } from '../../src/features/merge/lib/rewards/dropGroups.js'
import { RC_MAX_RANK } from '../../src/features/merge/lib/core/ranks.js'
import { encodeStage } from '../../src/features/merge/lib/share/stageShare.js'
import { BASE, createChecker, ladderBoard, launch, openMerge, tab } from './helpers.mjs'

const { ok, finish } = createChecker()
const SHOT = process.env.E2E_SCREENSHOT_DIR ?? null
const shot = async (page, name) => SHOT && page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: false })

// Rank values for coins (never seeded), so endless coin drops pay something.
const withCoins = (board) => {
  ;[0.05, 0.12, 0.27, 0.6].forEach((worth, i) => (board.rewardChainConfig.coins[i] = { ...board.rewardChainConfig.coins[i], prizeAmount: worth, syntax: `allowance(coins:${worth})` }))
  return board
}
// targetEv 1: no lucky drops, so the scripted climbs are repeatable.
const mainLadder = () => withCoins(ladderBoard('Main 1', 11, { targetEv: 1 }))
// Recompletion drops a puzzle item on one merge in ten, from rank 6.
const rcLadder = () => {
  const b = withCoins(ladderBoard('RC 1', 13, { targetEv: 1, tier2UnlockRank: 3, minRank: 3, minDropRank: 6 }))
  b.dropGroups = [createDropGroup({ id: 'rc-puzzle', name: 'Puzzle R1', items: { puzzles: 1 } })]
  b.dropGroupsConfig = createDropGroupsConfig(RC_MAX_RANK)
  for (const t of b.dropGroupsConfig) {
    t.noDropWeight = 900
    t.entries = [{ groupId: 'rc-puzzle', weight: 100 }]
  }
  return b
}

// Walks the free item at ladder cell `from` up to ladder cell `to`.
async function walk(page, from, to) {
  for (let k = from; k < to; k++) {
    await page.locator(`[data-cell="1-${k}"]`).click()
    await page.locator(`[data-cell="1-${k + 1}"]`).click()
  }
}
const bg = (page, cell) => page.locator(`[data-cell="${cell}"]`).evaluate((el) => getComputedStyle(el).backgroundImage)
const boardItems = (page) => page.locator('[data-cell]:not([title="open"]):not([title="locked"])').count()

// ---------- Play Stage, through a shared link ---------------------------
async function playStageToRank13(page) {
  await page.goto(`${BASE}?play&stage=${encodeStage([mainLadder()], { rcBoards: [rcLadder()] })}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: /Use generator/ }).click()
  await page.waitForTimeout(500)
  await page.locator('[data-cell][title="rank 1"]').first().click()
  await page.locator('[data-cell="1-0"]').click()
  await walk(page, 0, 10) // rank 12 -> Recompletion
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Use generator/ }).click() // x4: a rank 3
  await page.waitForTimeout(500)
  await page.locator('[data-cell][title="rank 3"]').first().click()
  await page.locator('[data-cell="1-2"]').click()
  await walk(page, 2, 11) // a free rank 13 at ladder cell 11
  await page.waitForTimeout(300)
}

{
  const { browser, page, errors } = await launch()
  await playStageToRank13(page)
  ok('at rank 13 the stage is in Recompletion, with the classic look', (await page.locator('[data-testid="rc-active"]').isVisible()) && (await page.locator('[data-theme="classic"]').count()) === 1 && (await page.locator('[data-testid="endless-active"]').count()) === 0)
  ok('...on the classic tiles', /tile-(cream|peach)/.test(await bg(page, '0-0')) && !/endless/.test(await bg(page, '0-0')))
  ok('the rank track runs to 14 in Recompletion', /13\s*\/\s*14/.test(await page.getByText(/\/\s*14/).first().innerText()))
  const itemsBefore = (await boardItems(page)) + (await page.locator('button[title*="click to drop it"]').count())

  await page.locator('[data-cell="1-11"]').click()
  await page.locator('[data-cell="1-12"]').click()
  await page.waitForTimeout(140)
  ok('reaching rank 14 plays the entry effect once: a starburst and the "Endless Mode" nameplate', (await page.locator('[data-fx-endless]').count()) === 1 && /Endless Mode/.test(await page.locator('[data-fx-endless]').innerText()) && /transition-burst/.test((await page.locator('[data-fx-endless] img').first().getAttribute('src')) ?? '') && (await page.locator('[data-fx-endless] img').first().evaluate((el) => el.getBoundingClientRect().width)) > 60)
  ok('...which cannot take a click (pointer events off)', (await page.locator('[data-fx-layer]').evaluate((el) => getComputedStyle(el).pointerEvents)) === 'none')
  await page.waitForTimeout(640)
  await shot(page, 'endless-entry')
  ok('the thrown copies of earlier drops are gone once they have landed (no ghosts left behind)', (await page.locator('[data-fx-fly]').count()) === 0)
  await page.waitForTimeout(1800)
  ok('...and is gone afterwards', (await page.locator('[data-fx-endless]').count()) === 0)

  const banner = page.locator('[data-testid="endless-active"]')
  ok('the endless banner is shown, with live "Endless Mode" text on the nameplate', (await banner.isVisible()) && /Endless Mode/.test(await banner.innerText()))
  ok('...and says the second grand prize is won and play goes on', /second grand prize/.test(await banner.innerText()) && /no end/.test(await banner.innerText()))
  ok('...and states the drop rule: from rank 5 now (it was rank 6), mostly coins and merge energy', /rank 5 or higher/.test(await page.locator('[data-testid="endless-rule"]').innerText()) && /it was rank 6/.test(await page.locator('[data-testid="endless-rule"]').innerText()) && /coins and merge energy/.test(await page.locator('[data-testid="endless-rule"]').innerText()))
  ok('the Recompletion banner is gone, and the stage is not "finished"', (await page.locator('[data-testid="rc-active"]').count()) === 0 && (await page.getByText(/chain is complete/).count()) === 0 && (await page.getByText(/to start the Recompletion round/).count()) === 0)
  ok('the board switches to the endless look', (await page.locator('[data-theme="endless"]').count()) === 1 && (await page.locator('[data-testid="endless-badge"]').isVisible()))
  const even = await bg(page, '0-0')
  const odd = await bg(page, '0-1')
  ok('...on the endless tiles: lavender and mint, in a checker', /endless-tile-lavender/.test(even) && /endless-tile-mint/.test(odd))
  ok('the rank 14 is still on the board', (await page.locator('[data-cell][title="rank 14"]').count()) === 1)
  const itemsAfter = (await boardItems(page)) + (await page.locator('button[title*="click to drop it"]').count())
  ok(`nothing was taken away on the way in (${itemsBefore} items before the merge, ${itemsAfter} after)`, itemsAfter >= itemsBefore - 1)
  ok('the rank 14 sprite is the same item art as before (items keep their pictures)', /main-rank-14/.test((await page.locator('[data-cell][title="rank 14"] img').first().getAttribute('src')) ?? ''))

  // Play goes on: the generator works, and merges that make rank 5 now drop.
  const generator = page.getByRole('button', { name: /Use generator/ })
  ok('the generator still works, and carries the endless generator picture', (await generator.isEnabled()) && /endless-generator/.test((await generator.locator('img').getAttribute('src')) ?? ''))
  const rewardsBefore = await page.locator('[data-cell][title*=" reward R"]').count()
  for (let i = 0; i < 4; i++) {
    await generator.click()
    await page.waitForTimeout(480)
  }
  const merge = async (rank) => {
    await page.locator(`[data-cell][title="rank ${rank}"]`).first().click()
    await page.locator(`[data-cell][title="rank ${rank}"]`).nth(1).click()
    await page.waitForTimeout(200)
  }
  await merge(3)
  await merge(3)
  const rewardsAt4 = await page.locator('[data-cell][title*=" reward R"]').count()
  ok('a merge that makes rank 4 still drops nothing', rewardsAt4 === rewardsBefore)
  await page.locator('[data-cell][title="rank 4"]').first().click()
  ok('a selected item wears the endless selection brackets', (await page.locator('[data-cell] img[src*="endless-selection"]').count()) === 1)
  await page.locator('[data-cell][title="rank 4"]').nth(1).click()
  await page.waitForTimeout(700)
  const rewardsAt5 = await page.locator('[data-cell][title*=" reward R"]').count()
  ok(`a merge that makes rank 5 drops a bucket (reward items on the board: ${rewardsBefore} -> ${rewardsAt5})`, rewardsAt5 > rewardsAt4)
  // Six more drops (three more rank 5s, two rank 6s, a rank 7). One drop can
  // be a puzzle on its own; across seven, coins and merge energy show up.
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 4; i++) {
      await generator.click()
      await page.waitForTimeout(480)
    }
    await merge(3)
    await merge(3)
    await merge(4)
    if (round !== 1) await merge(5)
  }
  await merge(6)
  await page.waitForTimeout(600)
  const kinds = await page.locator('[data-cell][title*=" reward R"]').evaluateAll((els) => els.map((e) => e.getAttribute('title').split(' ·')[0]))
  const coinEnergy = kinds.filter((t) => /Coins|Merge Energy/.test(t)).length
  ok(`after seven endless drops the board holds coins and merge energy items (${coinEnergy} of ${kinds.length} reward items)`, coinEnergy >= 1)
  ok('a rank 7 was made in endless and the stage simply goes on', (await page.locator('[data-cell][title="rank 7"]').count()) === 1 && (await banner.isVisible()))
  await shot(page, 'endless-stage')

  await page.getByRole('button', { name: 'Restart' }).click()
  await page.waitForTimeout(300)
  ok('Restart goes back to the normal round and the classic look', (await page.locator('[data-theme="classic"]').count()) === 1 && (await page.locator('[data-testid="endless-active"]').count()) === 0 && /tile-(cream|peach)/.test(await bg(page, '0-0')))
  ok('Play Stage: zero page errors', errors.length === 0)
  await browser.close()
}

// ---------- reduced motion: no burst, the banner still says it ----------
{
  const { browser, page, errors } = await launch({ reducedMotion: 'reduce' })
  await playStageToRank13(page)
  await page.locator('[data-cell="1-11"]').click()
  await page.locator('[data-cell="1-12"]').click()
  await page.waitForTimeout(140)
  ok('with reduced motion asked for, no entry burst is played', (await page.locator('[data-fx-endless]').count()) === 0)
  ok('...and endless mode still starts, banner and theme', (await page.locator('[data-testid="endless-active"]').isVisible()) && (await page.locator('[data-theme="endless"]').count()) === 1)
  ok('reduced motion: zero page errors', errors.length === 0)
  await browser.close()
}

// ---------- Play Tester (the economist's screen) ------------------------
{
  const { browser, page, errors } = await launch({ save: { segments: [{ name: 'Segment 1', boards: [mainLadder()], recompletionBoards: [rcLadder()] }] } })
  await openMerge(page)
  await tab(page, 'Play tester').click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Spend generator/ }).click()
  await page.waitForTimeout(500)
  await page.locator('[data-cell][title="rank 1 (1 DR)"]').first().click()
  await page.locator('[data-cell="1-0"]').click()
  await walk(page, 0, 10)
  await page.waitForTimeout(400)
  ok('Play Tester: rank 12 starts Recompletion', await page.getByText('RC phase active').isVisible())
  await page.getByRole('button', { name: /Spend generator/ }).click()
  await page.waitForTimeout(500)
  await page.locator('[data-cell][title="rank 3 (4 DR)"]').first().click()
  await page.locator('[data-cell="1-2"]').click()
  await walk(page, 2, 12)
  await page.waitForTimeout(2200)

  const banner = page.locator('[data-testid="endless-active"]')
  ok('Play Tester: rank 14 starts endless mode', (await banner.isVisible()) && (await page.locator('[data-theme="endless"]').count()) === 1 && (await page.getByText('RC phase active').count()) === 0)
  const details = page.locator('[data-testid="endless-details"]')
  ok('...with what the endless drops come to', (await details.isVisible()) && (await page.locator('[data-testid="endless-drop-coins"]').count()) === 1 && (await page.locator('[data-testid="endless-drop-energy"]').count()) === 1)
  const share = await page.locator('[data-testid="endless-share"]').innerText()
  ok(`...the share that is coins or merge energy ("${share.replace(/\s+/g, ' ').slice(0, 60)}...")`, /\d+%/.test(share) && Number(share.match(/(\d+)%/)[1]) > 50)
  const energy = (await page.locator('[data-testid="endless-energy"]').innerText()).replace(/\s+/g, ' ')
  ok(`...and merge energy paid back per 100 DR, marked as an estimate ("${energy.slice(0, 90)}...")`, /merge energy/.test(energy) && /per 100 DR/.test(energy) && /estimate/i.test(energy))
  ok('...and says the amounts are this tool\'s starting numbers, not confirmed game values', /not confirmed game values/.test(await details.innerText()))
  ok('the event log records the start of endless mode', (await page.getByText(/Endless mode started/).count()) === 1)
  ok('the rank table runs to 14', (await page.getByText('Rank 14', { exact: true }).count()) >= 1)
  ok('"Compare to automatic simulator" is hidden in endless (the simulator stops at rank 14)', (await page.getByRole('button', { name: /Compare to automatic simulator/ }).count()) === 0)
  ok('the generator still works', await page.getByRole('button', { name: /Spend generator/ }).isEnabled())
  await shot(page, 'endless-tester')

  // The Build event flow says what endless mode will be, before anyone plays it.
  await tab(page, 'Build event').click()
  await page.waitForTimeout(300)
  await page.locator('[data-step="finalize"]').click()
  await page.waitForTimeout(400)
  const preview = page.locator('[data-testid="endless-preview"]')
  await preview.scrollIntoViewIfNeeded()
  const previewText = (await preview.innerText()).replace(/\s+/g, ' ')
  ok('Build event, last step: "After rank 14: endless mode" states the rules', (await page.getByText('After rank 14: endless mode').isVisible()) && /rank 5 instead of rank 6/.test(previewText) && /mostly coins and merge energy/.test(previewText) && /no end/.test(previewText))
  ok('...with the numbers the applied Recompletion drops lead to', (await preview.locator('[data-testid="endless-energy"]').count()) === 1 && /per 100 DR/.test(previewText) && /not confirmed game values/.test(previewText))
  await shot(page, 'endless-flow')
  ok('Play Tester: zero page errors', errors.length === 0)
  await browser.close()
}

// ---------- Play Tester: jump ahead (test shortcut) ---------------------
// A jump is a clean arrival: a fresh Recompletion board with just a rank 12,
// or a clean all-open board with just a rank 14. Nothing else comes along.
{
  const { browser, page, errors } = await launch({ save: { segments: [{ name: 'Segment 1', boards: [mainLadder()], recompletionBoards: [rcLadder()] }] } })
  await openMerge(page)
  await tab(page, 'Play tester').click()
  await page.waitForTimeout(400)
  const filled = () => page.locator('[data-cell]:not([title="open"]):not([title="locked"])')
  const titles = () => filled().evaluateAll((els) => els.map((e) => e.getAttribute('title')))
  ok('the Play Tester offers both jumps, and says what each does', (await page.getByTestId('jump-rc').isEnabled()) && (await page.getByTestId('jump-endless').isEnabled()) && /just a rank 12/.test(await page.getByTestId('jump-note').innerText()) && /just a rank 14/.test(await page.getByTestId('jump-note').innerText()))
  // Put something on the board first: it must NOT come along.
  await page.getByRole('button', { name: /Spend generator/ }).click()
  await page.waitForTimeout(500)
  await page.getByTestId('jump-rc').click()
  await page.waitForTimeout(600)
  let t = await titles()
  ok('"To Recompletion" moves to the Recompletion board (13 columns), in Recompletion', (await page.getByText('RC phase active').isVisible()) && (await page.locator('[data-cell="1-12"]').count()) === 1)
  ok(`...holding just a rank 12: the only free item on the board (${t.filter((x) => !/stuck|semi-blocked/.test(x)).join(', ')})`, t.filter((x) => !/stuck|semi-blocked/.test(x)).join('|') === 'rank 12 (2048 DR)')
  ok('...nothing came along from the old board: the rest is the Recompletion board\'s own 13 semi-blocked items, and the inventory is empty', t.filter((x) => /stuck/.test(x)).length === 13 && (await page.locator('button[title*="click to drop it"]').count()) === 0)
  ok('...it says the history is not a real run, and hides the simulator comparison', /You jumped ahead/.test(await page.getByTestId('jump-note').innerText()) && (await page.getByRole('button', { name: /Compare to automatic simulator/ }).count()) === 0)
  ok('...the jump is in the event log, and only the next jump is still offered', (await page.getByText(/jumped ahead to Recompletion/).count()) === 1 && (await page.getByTestId('jump-rc').isDisabled()) && (await page.getByTestId('jump-endless').isEnabled()))
  // The Recompletion board works as usual from here: merge into a semi-blocked item and it is freed.
  await page.getByRole('button', { name: /Spend generator/ }).click() // x4: a rank 3
  await page.waitForTimeout(500)
  await page.locator('[data-cell][title="rank 3 (4 DR)"]').first().click()
  await page.locator('[data-cell="1-2"]').click()
  await page.waitForTimeout(500)
  ok('on the Recompletion board, merging into a semi-blocked item frees it', (await page.locator('[data-cell="1-2"]').getAttribute('title')) === 'rank 4 (8 DR)')

  await page.getByTestId('jump-endless').click()
  await page.waitForTimeout(600)
  t = await titles()
  ok('"To endless mode" starts endless, with its look and its drop rule', (await page.locator('[data-testid="endless-active"]').isVisible()) && (await page.locator('[data-theme="endless"]').count()) === 1 && /rank 5 or higher/.test(await page.locator('[data-testid="endless-rule"]').innerText()))
  ok(`...on a clean board: every tile open, holding just a rank 14 (${t.join(', ')})`, t.join('|') === 'rank 14 (8192 DR)' && (await page.locator('[data-cell][title="locked"]').count()) === 0 && (await page.locator('[data-cell]').count()) === 26)
  ok('...and both jumps are spent', (await page.getByTestId('jump-rc').isDisabled()) && (await page.getByTestId('jump-endless').isDisabled()))
  // Endless plays for real there: four taps, three merges, and the rank 5 drops.
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: /Spend generator/ }).click()
    await page.waitForTimeout(480)
  }
  for (const rank of ['rank 3 (4 DR)', 'rank 3 (4 DR)', 'rank 4 (8 DR)']) {
    await page.locator(`[data-cell][title="${rank}"]`).first().click()
    await page.locator(`[data-cell][title="${rank}"]`).nth(1).click()
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(600)
  ok('endless plays for real on the clean board: a merge that makes rank 5 drops', (await page.locator('[data-cell][title="rank 5 (16 DR)"]').count()) === 1 && (await page.locator('[data-cell][title*=" reward, rank "]').count()) >= 1)

  // Straight from the normal round to endless, in one click.
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await page.waitForTimeout(300)
  ok('Reset clears any effect still playing', (await page.locator('[data-fx-grand], [data-fx-endless], [data-fx-rain]').count()) === 0)
  ok('Reset goes back to the normal round with both jumps offered again', (await page.locator('[data-theme="classic"]').count()) === 1 && (await page.getByTestId('jump-rc').isEnabled()) && /just a rank 12/.test(await page.getByTestId('jump-note').innerText()))
  await page.getByTestId('jump-endless').click()
  await page.waitForTimeout(600)
  t = await titles()
  ok('one click from the normal round lands in endless mode, on the same clean board', (await page.locator('[data-testid="endless-active"]').isVisible()) && (await page.getByText(/Endless mode started/).count()) === 1 && (await page.locator('[data-fx-grand]').count()) === 0 && t.join('|') === 'rank 14 (8192 DR)')
  ok('the generator works there', await page.getByRole('button', { name: /Spend generator/ }).isEnabled())
  ok('jump ahead: zero page errors', errors.length === 0)
  await browser.close()
}

const fails = finish('Endless mode E2E')
process.exit(fails === 0 ? 0 : 1)
