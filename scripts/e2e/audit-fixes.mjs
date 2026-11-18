// Browser end-to-end: four gaps closed in the clean-up round.
//   - the effort distribution typed in step 5 survives a reload (a build
//     protects it, and it used to be lost silently);
//   - an item syntax that pays more than one resource is called out;
//   - "Share stage" never puts boards into a link that were not built;
//   - the Syntax tab says when a newer build is waiting, not applied.
// See helpers.mjs. Run: npx vite-node scripts/e2e/audit-fixes.mjs
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { decodeStage } from '../../src/features/merge/lib/share/stageShare.js'
import { createChecker, launch, openMerge, tab } from './helpers.mjs'

const { ok, finish } = createChecker()
const step = (page, id) => page.locator(`[data-step="${id}"]`)
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
const main = [blankBoard('Board 1', 0, 150), blankBoard('Board 2', 1, 600)]
// One puzzle rank written to pay two resources.
for (const b of main) b.rewardChainConfig.puzzles[1] = { ...b.rewardChainConfig.puzzles[1], syntax: '[dynamic(dr-puzzle:15)]+free_wild:1' }
const rc = [blankBoard('Board 1', 0, 300), blankBoard('Board 2', 1, 2000)]

const { browser, page, errors } = await launch({ save: { segments: [{ name: 'Base', boards: main, recompletionBoards: rc }] }, clipboard: true })
await openMerge(page)

console.log('--- 1. The effort distribution typed in step 5 survives a reload ---')
await step(page, 'effort').click()
await page.waitForTimeout(300)
await set(page.locator('[data-effort-rank="12"]'), 70)
await set(page.locator('[data-effort-rank="11"]'), 30)
await page.reload({ waitUntil: 'networkidle' })
await openMerge(page)
await step(page, 'effort').click()
await page.waitForTimeout(300)
ok('after a reload the typed shares are still there (70 at rank 12, 30 at rank 11)', (await page.locator('[data-effort-rank="12"]').inputValue()) === '70' && (await page.locator('[data-effort-rank="11"]').inputValue()) === '30' && (await page.locator('[data-effort-rank="5"]').inputValue()) === '')

console.log('--- 2. An item syntax that pays more than one resource is called out ---')
await step(page, 'rewards').click()
await page.waitForTimeout(300)
await set(page.locator('[data-target="puzzles"]'), 100)
await set(page.locator('[data-target="energy"]'), 150)
{
  const note = page.locator('[data-multi-resource="puzzles"]')
  ok('a puzzle rank written to pay two resources is named, with its syntax', (await note.count()) === 1 && /Rank 2/.test(await note.innerText()) && /free_wild/.test(await note.innerText()))
  ok('...and a reward whose ranks pay one resource each has no such note', (await page.locator('[data-multi-resource="energy"]').count()) === 0)
}

console.log('--- 3. "Share stage" never carries boards that were not built ---')
const share = page.getByRole('button', { name: 'Share stage' })
await share.click()
await page.waitForTimeout(400)
ok('with the normal boards not built, no link is made and it says why', (await page.getByTestId('share-link-box').count()) === 0 && (await page.getByText(/No link was made: Board 1, 2 has tiles but nothing under them/).count()) === 1)
await page.getByRole('button', { name: 'Dismiss' }).click()

console.log('--- 4. The Syntax tab says when a newer build is waiting, not applied ---')
await step(page, 'build').click()
await page.waitForTimeout(300)
await page.getByTestId('build-configuration').click()
await page.getByTestId('build-configuration').waitFor({ state: 'visible', timeout: 480000 })
await page.waitForTimeout(500)
await tab(page, 'Syntax').click()
await page.waitForTimeout(400)
{
  const notice = page.getByTestId('syntax-pending-build')
  ok('built but not applied: the Syntax tab says a newer Normal build is waiting and that these sheets do not show it', (await notice.count()) === 1 && /Normal/.test(await notice.innerText()) && /not applied/.test(await notice.innerText()))
  await notice.getByRole('button', { name: 'Open Build event' }).click()
  await page.waitForTimeout(300)
  ok('...with a button that goes to Build event', (await step(page, 'finalize').count()) === 1)
}
await step(page, 'finalize').click()
await page.waitForTimeout(300)
await page.getByTestId('finalize-apply').click()
await page.waitForTimeout(700)
await tab(page, 'Syntax').click()
await page.waitForTimeout(400)
ok('once the build is applied the notice is gone', (await page.getByTestId('syntax-pending-build').count()) === 0)

console.log('--- 5. Shared again: the built normal event is in the link, the unbuilt Recompletion is left out ---')
await share.click()
await page.waitForTimeout(500)
{
  const box = page.getByTestId('share-link-box')
  const link = (await box.count()) === 1 ? await page.getByTestId('share-link').inputValue() : ''
  const decoded = link ? decodeStage(new URL(link).searchParams.get('stage')) : null
  ok('a link is made for the built normal event', !!decoded && decoded.boards.length === 2 && decoded.boards.every((b) => b.blockedQueue.length > 0))
  ok('...without the Recompletion boards, which have tiles and nothing under them', !!decoded && !(decoded.rcBoards?.length > 0))
  ok('...and it says so, and what to do', (await page.getByText(/The link plays the normal event only: Recompletion Board 1, 2 has tiles but nothing under them/).count()) === 1)
}
ok('zero page errors across the whole session', errors.length === 0)
await browser.close()
process.exit(finish('CLEAN-UP FIXES') === 0 ? 0 : 1)
