// Shared helpers for the browser end-to-end checks in this folder.
//
// Run with vite-node (so fixtures can be built with the app's own libraries)
// against a running dev server:
//   npm run dev                                   (port 5173, strictPort)
//   npx vite-node scripts/e2e/small-rewards-workflow.mjs
//   npx vite-node scripts/e2e/small-rewards-play.mjs
//
// Needs Playwright with a Chromium build (npx playwright install chromium).
// Each run uses its own throwaway browser profile, so nothing here ever
// touches the economist's own saved data.
import { chromium } from 'playwright'
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { placeItems } from '../../src/features/merge/lib/core/placement.js'

export const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173/Merge/'
export const SAVE_KEY = 'merge-mania-board-simulator'
export const TUTORIAL_SEEN_KEY = 'merge-mania-play-tutorial-seen'

export function createChecker() {
  const results = []
  const ok = (name, cond) => {
    results.push(!!cond)
    console.log(`${cond ? '  OK' : 'FAIL'}  ${name}`)
  }
  const finish = (label) => {
    const fails = results.filter((r) => !r).length
    console.log(`\n${fails === 0 ? `${label}: ALL ${results.length} CHECKS PASSED` : `${label}: ${fails} OF ${results.length} CHECKS FAILED`}`)
    return fails
  }
  return { ok, finish }
}

// A generated board: `blockedRowsFrom` and below are blocked, the rest open.
export function generatedBoard(name, index, { rows, cols = 8, blockedRowsFrom, blockedValue, semi = [], minRank = null }) {
  const b = createBoard(name, { rows, cols })
  if (minRank != null) b.minRank = minRank
  b.tiles = b.tiles.map((row, r) => row.map(() => (r >= blockedRowsFrom ? 'blocked' : 'open')))
  for (const [r, c] of semi) b.tiles[r][c] = 'semi'
  b.blockedValue = blockedValue
  const g = placeItems(b, { isFirstBoard: index === 0, boardIndex: index })
  return { ...b, tiles: index === 0 ? forceSemi(b.tiles) : b.tiles, semiPlacements: g.semiPlacements, blockedQueue: g.blockedQueue }
}

function forceSemi(tiles) {
  const next = tiles.map((r) => [...r])
  if (next[2]?.[4] != null) next[2][4] = 'semi'
  return next
}

// A "ladder" board: semi tiles holding main ranks 1..top, all stuck. One
// generator tap plus `top` merges walks a single item up to rank top+1 and
// clears the whole board - the cheapest way to play a real session to rank
// 12 (and through RC to 14) through the UI.
export function ladderBoard(name, top, extra = {}) {
  const b = createBoard(name, { rows: 2, cols: top })
  b.tiles = [Array(top).fill('open'), Array(top).fill('semi')]
  b.semiPlacements = Array.from({ length: top }, (_, i) => ({ row: 1, col: i, rank: i + 1 }))
  b.blockedQueue = []
  return Object.assign(b, extra)
}

export async function launch({ save = null, tutorialSeen = true, clipboard = false, reducedMotion = null } = {}) {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1700, height: 1000 }, acceptDownloads: true, ...(reducedMotion ? { reducedMotion } : {}) })
  if (clipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin })
  await context.addInitScript(
    ([key, value, tutorialKey, seen]) => {
      // Seed only once per profile, so a later in-test Save/Clear isn't
      // overwritten by this script on reload.
      if (!sessionStorage.getItem('__e2e_seeded')) {
        if (value != null) localStorage.setItem(key, value)
        if (seen) localStorage.setItem(tutorialKey, '1')
        sessionStorage.setItem('__e2e_seeded', '1')
      }
    },
    [SAVE_KEY, save ? JSON.stringify(save) : null, TUTORIAL_SEEN_KEY, tutorialSeen],
  )
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => {
    errors.push(e.message)
    console.log('PAGE ERROR:', e.message)
  })
  return { browser, context, page, errors }
}

export async function openMerge(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByText('Merge Mania', { exact: false }).first().click()
  await page.waitForTimeout(300)
}

// The tool tabs live in the app header (a page can have its own button with
// the same name - the Build Event phase switch has a "Recompletion" too).
export const tab = (page, name) => page.locator('header').getByRole('button', { name, exact: true })

// Opens the Rewards tab's collapsed advanced section if it isn't open
// already (a plain click on the summary would toggle it shut again).
export async function openAdvanced(page) {
  const details = page.locator('details', { has: page.locator('summary', { hasText: 'Reward definitions and advanced settings' }) })
  if (!(await details.evaluate((el) => el.open))) await details.locator('summary').first().click()
  await page.waitForTimeout(200)
}
