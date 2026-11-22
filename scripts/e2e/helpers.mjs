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

// `folded: true` leaves the guided flow's folded sections as a visitor finds
// them. By default every one is opened as soon as it appears, so the suites
// keep checking everything a section holds (guided-flow.mjs is the suite that
// checks what is folded and what is not).
export async function launch({ save = null, clipboard = false, reducedMotion = null, folded = false } = {}) {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1700, height: 1000 }, acceptDownloads: true, ...(reducedMotion ? { reducedMotion } : {}) })
  if (!folded) {
    await context.addInitScript(() => {
      const openAll = () => document.querySelectorAll('details[data-collapsible]:not([open])').forEach((el) => (el.open = true))
      // (The document itself: this runs before the page has an <html> element.)
      new MutationObserver(openAll).observe(document, { childList: true, subtree: true })
    })
  }
  if (clipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin })
  await context.addInitScript(
    ([key, value]) => {
      // Seed only once per profile, so a later in-test Save/Clear isn't
      // overwritten by this script on reload.
      if (!sessionStorage.getItem('__e2e_seeded')) {
        if (value != null) localStorage.setItem(key, value)
        sessionStorage.setItem('__e2e_seeded', '1')
      }
    },
    [SAVE_KEY, save ? JSON.stringify(save) : null],
  )
  // LONG DEFAULT WAITS. A click or a page load normally takes milliseconds, and
  // Playwright gives each 30 seconds. On this machine a moment of load (a build
  // in another suite just ended, the project folder is being synced) now and
  // then made a first click or the first page load wait longer than that, and
  // the suite crashed with a TimeoutError although nothing was wrong - always
  // early in a full run, never when the suite ran alone. A wait that has to be
  // short says so itself (it passes its own timeout).
  // (E2E_TIMEOUT_MS shortens it for a debugging pass, where a missing element should fail fast.)
  context.setDefaultTimeout(Number(process.env.E2E_TIMEOUT_MS ?? 120000))
  context.setDefaultNavigationTimeout(180000)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => {
    errors.push(e.message)
    console.log('PAGE ERROR:', e.message)
  })
  // Printed, not counted: a screen that goes blank in the middle of a suite
  // (seen a few times in full runs, never explained) leaves its reason here
  // if the app itself reported one.
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('CONSOLE ERROR:', message.text().replace(/\s+/g, ' ').slice(0, 400))
  })
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && page.__seenFirstLoad) console.log('PAGE RELOADED:', frame.url().slice(0, 120))
    if (frame === page.mainFrame()) page.__seenFirstLoad = true
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
// What sits in the header's "More" menu: the project actions and the five
// advanced tools. A click on one of them opens the menu first when it is not
// in sight (an advanced tool that is open shows as a tab of its own).
const IN_MORE_MENU = new Set(['Share planning', 'Export backup', 'Import backup', 'Clear data', 'What a backup holds', 'Editor', 'Recompletion', 'Rewards (V2)', 'Twister', 'CC management'])
export async function openMore(page) {
  if (!(await page.getByTestId('more-menu-panel').isVisible())) await page.getByTestId('more-menu').click()
  await page.getByTestId('more-menu-panel').waitFor({ state: 'visible', timeout: 10000 })
}
export const tab = (page, name) => {
  const direct = page.locator('header').getByRole('button', { name, exact: true })
  if (!IN_MORE_MENU.has(name)) return direct
  return new Proxy(direct, {
    get(target, prop) {
      if (prop === 'click')
        return async (...args) => {
          if (!(await target.isVisible())) await openMore(page)
          return target.click(...args)
        }
      const value = target[prop]
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
// Step 1 shows the segments in use. A test that types into more of them brings
// them in first ("+ Add a segment" adds the next one as a row).
export async function showSegments(page, count) {
  while ((await page.locator('[data-testid="setup-segments"] [data-setup-segment]').count()) < count) {
    await page.getByTestId('setup-add-segment').click()
    await page.waitForTimeout(150)
  }
}
// The bar at the top shows the segments in use too. A test that needs another
// one brings it in: "+ Add segment" adds the next segment and selects it.
export async function selectSegment(page, number) {
  const target = page.locator(`[data-segment-tab="${number - 1}"]`)
  while ((await target.count()) === 0) {
    await page.getByTestId('add-segment').click()
    await page.waitForTimeout(150)
  }
  await target.click()
  await page.waitForTimeout(150)
}
// The Syntax tab shows one sheet at a time, picked in a dropdown.
export const syntaxView = async (page, label) => {
  await page.getByTestId('syntax-view').selectOption({ label })
  await page.waitForTimeout(250)
}

// Opens the Rewards tab's collapsed advanced section if it isn't open
// already (a plain click on the summary would toggle it shut again).
export async function openAdvanced(page) {
  const details = page.locator('details', { has: page.locator('summary', { hasText: 'Reward definitions and advanced settings' }) })
  if (!(await details.evaluate((el) => el.open))) await details.locator('summary').first().click()
  await page.waitForTimeout(200)
}
