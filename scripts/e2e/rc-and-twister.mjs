// Browser end-to-end: three fixes from one round of economist feedback.
//   - "the RC is still broken": a Recompletion of 300 + 5,344 DR builds as
//     usable (it used to come back "Needs a fix" every time, so nothing could
//     be applied and the Recompletion boards stayed empty in play), applies,
//     and plays: jumping into Recompletion, its tiles open.
//   - Twister values typed in the Twister tool are kept by the build (they
//     used to be replaced: "i get 165 twisters from a rank4").
//   - the effort note in step 6 and the chart under it say the same thing.
// See helpers.mjs. Run: npx vite-node scripts/e2e/rc-and-twister.mjs
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { withDefaultTwisterValues } from '../../src/features/merge/lib/rewards/twisterEconomy.js'
import { withBlankCoinValues } from '../../src/features/merge/lib/rewards/rewardChain.js'
import { SAVE_KEY, createChecker, launch, openMerge, tab } from './helpers.mjs'

const { ok, finish } = createChecker()
const step = (page, id) => page.locator(`[data-step="${id}"]`)

function chain(values, rc) {
  return values.map((v, i) => {
    const b = createBoard(`Board ${i + 1}`, { rows: i === 0 ? 5 : 3, cols: 8 })
    const from = i === 0 ? 3 : 1
    b.tiles = b.tiles.map((row, r) => row.map(() => (r >= from ? 'blocked' : 'open')))
    if (i === 0) b.tiles[2][4] = 'semi'
    b.blockedValue = v
    b.minDropRank = 6
    if (rc) {
      b.minRank = 3
      b.maxRank = 13
    }
    b.twisterByBuild = true
    b.rewardChainConfig = withDefaultTwisterValues(withBlankCoinValues(b.rewardChainConfig))
    return b
  })
}
const save = {
  segments: [
    {
      name: 'Base',
      boards: chain([150, 700, 698], false),
      recompletionBoards: chain([300, 5344], true),
      rewardTargets: { main: { coins: 3, puzzles: 300, energy: 200, charms: 400 }, rc: { coins: 2, puzzles: 200, energy: 150, charms: 300 } },
      twisterPlan: { main: { checkpointPct: 70, targetSpins: 15, targetSpinsOverrides: {}, costIncrement: 10 }, rc: { checkpointPct: 70, targetSpins: null, targetSpinsOverrides: {}, costIncrement: 1 } },
    },
  ],
}
const { browser, page, errors } = await launch({ save })
await openMerge(page)

console.log('--- 1. Twister values typed in the Twister tool are kept ---')
await tab(page, 'Twister').click()
await page.waitForTimeout(400)
await page.getByTestId('twister-value-4').fill('40')
await page.getByTestId('twister-value-4').blur()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForTimeout(300)
let saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SAVE_KEY)
const ladder = saved.segments[0].boards[0].rewardChainConfig.twister
ok(`typing rank 4 = 40 makes the ladder yours (${ladder.map((r) => r.prizeAmount).join(' / ')}, none marked "set by the build")`, ladder[3].prizeAmount === 40 && ladder.every((r) => !r.auto))

console.log('--- 2. Build the whole event: Recompletion comes out usable ---')
await tab(page, 'Build event').click()
await page.waitForTimeout(300)
await step(page, 'build').click()
await page.waitForTimeout(300)
await page.getByTestId('build-whole-event').click()
await page.getByTestId('build-whole-event').waitFor({ state: 'visible', timeout: 600000 })
await page.waitForFunction(() => !document.querySelector('[data-testid="build-whole-event"]')?.disabled, null, { timeout: 600000 })
await page.waitForTimeout(800)
const allText = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
ok(`"Build whole event" reports Recompletion built and usable ("${(allText.match(/Recompletion: [^.]*\./) ?? [''])[0]}")`, /Recompletion: 1 segment built/.test(allText) && !/Recompletion: [^.]*needs a fix/.test(allText))
{
  const note = page.getByTestId('effort-fit-note')
  ok('with no effort curve typed, step 6 says the boards were simply generated', (await note.count()) === 1 && /No effort distribution was typed/.test(await note.innerText()))
}
{
  // The Normal phase's Twister table shows each segment at 70% and 75% of the phase.
  await page.getByRole('button', { name: 'Normal', exact: true }).click()
  await page.waitForTimeout(400)
  const at70 = page.locator('[data-twister-price="0"] [data-mark="70"]')
  const at75 = page.locator('[data-twister-price="0"] [data-mark="75"]')
  const t70 = (await at70.innerText()).replace(/\s+/g, ' ')
  const t75 = (await at75.innerText()).replace(/\s+/g, ' ')
  ok(`step 6 shows what a typical player has at 70% ("${t70}") and at 75% ("${t75}") of the phase, in Twister DR and twists`, /\d+ DR/.test(t70) && /twist/.test(t70) && /\d+ DR/.test(t75))
}
await step(page, 'finalize').click()
await page.waitForTimeout(300)
await page.getByTestId('finalize-apply-all').click()
await page.waitForTimeout(800)
await page.getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForTimeout(300)
saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SAVE_KEY)
const rcBoards = saved.segments[0].recompletionBoards
ok(`applied: every Recompletion board has its items (${rcBoards.map((b) => (b.blockedQueue?.length ?? 0) + (b.semiPlacements?.length ?? 0)).join(' / ')})`, rcBoards.every((b) => (b.blockedQueue?.length ?? 0) > 0))
ok(`...and the build kept the Twister values typed (rank 4 still ${saved.segments[0].boards[0].rewardChainConfig.twister[3].prizeAmount})`, saved.segments[0].boards[0].rewardChainConfig.twister[3].prizeAmount === 40)

console.log('--- 3. Play into Recompletion: its tiles open ---')
await tab(page, 'Play tester').click()
await page.waitForTimeout(500)
ok('the Play Tester does not warn about unbuilt Recompletion boards', (await page.getByTestId('rc-not-built').count()) === 0)
await page.getByTestId('jump-rc').click()
await page.waitForTimeout(500)
const lockedBefore = await page.locator('[data-cell][title="locked"]').count()
const generator = page.getByRole('button', { name: /Spend generator/ })
// A merge opens the blocked tiles next to the item it makes. Two rank-1 items
// from the x1 generator: one is moved to row 2 (right above the blocked row),
// the other merged into it there.
await page.getByRole('button', { name: /^x1 · / }).click()
// (Holding a rank 12, a tap can be a lucky drop - a rank 2 or 3 instead of a
// rank 1 - so it taps until there are two rank-1 items. It used to tap twice
// and timed out about one run in seven.)
const rankOnes = () => page.locator('[data-cell][title="rank 1 (1 DR)"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-cell')))
for (let taps = 0; taps < 12 && (await rankOnes()).length < 2; taps++) {
  await generator.click()
  await page.waitForTimeout(200)
}
await page.waitForTimeout(200)
const ones = await rankOnes()
const target = '2-0'
await page.locator(`[data-cell="${ones[0]}"]`).click()
await page.locator(`[data-cell="${target}"]`).click()
await page.waitForTimeout(250)
await page.locator(`[data-cell="${ones[1]}"]`).click()
await page.locator(`[data-cell="${target}"]`).click()
await page.waitForTimeout(500)
const lockedAfter = await page.locator('[data-cell][title="locked"]').count()
const opened = await page.locator('[data-cell="3-0"]').getAttribute('title')
ok(`in Recompletion a merge next to a blocked tile opens it (${lockedBefore} locked before, ${lockedAfter} after; the tile below now holds "${opened}")`, lockedBefore > 0 && lockedAfter === lockedBefore - 1 && /^rank [0-9]+/.test(opened ?? ''))
ok('zero page errors', errors.length === 0)
await browser.close()
process.exit(finish('RC AND TWISTER') === 0 ? 0 : 1)
