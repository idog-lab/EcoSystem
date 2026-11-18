// A visual fixture, not a test: every main rank and every reward item on one
// Play Tester board (semi-blocked, with a blocked row), so the artwork can be
// checked by eye. Writes a screenshot of the board.
//   OUT=<file.png> npx vite-node scripts/e2e/art-gallery.mjs
// See helpers.mjs for how the browser is launched (dev server must be running).
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { encodeReward } from '../../src/features/merge/lib/rewards/rewardChain.js'
import { launch, openMerge, tab } from './helpers.mjs'

const b = createBoard('Gallery', { rows: 6, cols: 8 })
const semis = []
b.tiles = b.tiles.map((row, r) => row.map(() => (r === 0 ? 'open' : r === 5 ? 'blocked' : 'semi')))
for (let c = 0; c < 8; c++) semis.push({ row: 1, col: c, rank: c + 1 })
for (let c = 0; c < 6; c++) semis.push({ row: 2, col: c, rank: c + 9 })
b.tiles[2][6] = 'open'
b.tiles[2][7] = 'open'
;['coins', 'puzzles'].forEach((t, i) => [1, 2, 3, 4].forEach((rank) => semis.push({ row: 3, col: i * 4 + rank - 1, rank: encodeReward(t, rank) })))
;['energy', 'charms'].forEach((t, i) => [1, 2, 3, 4].forEach((rank) => semis.push({ row: 4, col: i * 4 + rank - 1, rank: encodeReward(t, rank) })))
b.semiPlacements = semis
b.blockedQueue = [1, 2, 3, 4, 5, 6, 7, 8]
b.blockedValue = 5000

const { browser, page, errors } = await launch({ save: { segments: [{ name: 'Segment 1', boards: [b] }] } })
await openMerge(page)
await tab(page, 'Play tester').click()
await page.waitForTimeout(600)
// Two free items and a selected tile, so every layer is on screen.
await page.getByRole('button', { name: /Spend generator/ }).click()
await page.waitForTimeout(200)
await page.getByRole('button', { name: /Spend generator/ }).click()
await page.waitForTimeout(200)
await page.locator('button[title="rank 1 (1 DR)"]').first().click()
await page.waitForTimeout(300)
const grid = page.locator('[style*="grid-template-columns"]').first()
if (process.env.OUT) await grid.screenshot({ path: process.env.OUT })
const broken = await page.locator('img').evaluateAll((els) => els.filter((e) => !(e.complete && e.naturalWidth > 0)).length)
const scales = await grid.locator('img[data-art-scale]').evaluateAll((els) => els.map((e) => Number(e.dataset.artScale)))
console.log(`sprites drawn: ${scales.length}, broken images: ${broken}, smallest scale ${Math.min(...scales)}, largest ${Math.max(...scales)}, page errors: ${errors.length}`)
await browser.close()
