// Runs every browser suite in this folder, one after another, against the
// dev server (start it first with `npm run dev`). Prints one line per suite
// and exits non-zero if any failed. Run: npm run e2e
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

// (The same address helpers.mjs uses; that file needs vite-node, this one runs on plain node.)
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173/Merge/'

const here = import.meta.dirname
// art-gallery.mjs only takes pictures; helpers.mjs is shared code.
const skip = new Set(['helpers.mjs', 'run-all.mjs', 'art-gallery.mjs'])
const suites = fs.readdirSync(here).filter((f) => f.endsWith('.mjs') && !skip.has(f)).sort()

// WARM-UP. After source files change, the dev server compiles every module
// the first time a page asks for it, and when it meets a dependency it has
// not prepared yet it prepares it and RELOADS the page it is serving. A suite
// that was mid-test at that moment lost its page: the first suites of a full
// run timed out or crashed, and passed when run again alone. So before any
// suite starts, the app is opened here once - every tab, the play screen and
// a build - until the server has nothing left to compile, and the run waits
// for it to go quiet. Nothing is retried: a suite that fails after this fails.
async function warmUp() {
  const started = Date.now()
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    let reloads = 0
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) reloads += 1
    })
    const settle = async () => {
      await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {})
      await page.waitForTimeout(700)
    }
    // Twice: the second pass must see no reload at all.
    for (let pass = 0; pass < 3; pass++) {
      const before = reloads
      await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120000 })
      await settle()
      await page.getByText('Merge Mania', { exact: false }).first().click({ timeout: 10000 }).catch(() => {})
      await settle()
      for (const name of ['Build event', 'Editor', 'Recompletion', 'Rewards (V2)', 'Twister', 'Play tester', 'CC management', 'Syntax', 'Build event']) {
        // (The advanced tools are in the header's "More" menu.)
        const button = page.locator('header').getByRole('button', { name, exact: true }).first()
        if (!(await button.isVisible().catch(() => false))) await page.getByTestId('more-menu').click({ timeout: 5000 }).catch(() => {})
        await button.click({ timeout: 5000 }).catch(() => {})
        await settle()
      }
      for (const stepId of ['setup', 'layouts', 'rewards', 'build', 'finalize']) {
        await page.locator(`[data-step="${stepId}"]`).click({ timeout: 5000 }).catch(() => {})
        await settle()
      }
      await page.goto(`${BASE}?play`, { waitUntil: 'networkidle', timeout: 120000 }).catch(() => {})
      await settle()
      // The Chef flow has modules of its own.
      await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120000 }).catch(() => {})
      await page.getByRole('button', { name: /Chef/ }).first().click({ timeout: 10000 }).catch(() => {})
      await settle()
      for (const stepId of ['event', 'dishes', 'baskets', 'proposal', 'simulate', 'value']) {
        await page.locator(`[data-chef-step="${stepId}"]`).click({ timeout: 5000 }).catch(() => {})
        await settle()
      }
      // (goto itself counts as navigations: 3 a pass)
      if (pass > 0 && reloads - before <= 3) break
    }
  } finally {
    await browser.close()
  }
  console.log(`      warm-up: the dev server has compiled the app (${Math.round((Date.now() - started) / 1000)}s)`)
}
await warmUp()

let failed = 0
for (const suite of suites) {
  const started = Date.now()
  // Quoted: the project path has spaces in it.
  const run = spawnSync('npx', ['vite-node', `"${path.join(here, suite)}"`], { encoding: 'utf8', shell: true })
  const out = `${run.stdout}\n${run.stderr}`
  // Every suite's full output is kept when E2E_LOG_DIR is set, so a failure in a full run can be read afterwards.
  if (process.env.E2E_LOG_DIR) fs.writeFileSync(path.join(process.env.E2E_LOG_DIR, suite.replace(/\.mjs$/, '.log')), out)
  const summary = out.split('\n').reverse().find((l) => /CHECKS? (PASSED|FAILED)/.test(l)) ?? 'no summary (crashed?)'
  const ok = run.status === 0 && /PASSED/.test(summary)
  if (!ok) failed += 1
  console.log(`${ok ? '  OK ' : 'FAIL '} ${suite.padEnd(28)} ${summary.trim()}  (${Math.round((Date.now() - started) / 1000)}s)`)
  if (!ok) console.log(out.split('\n').filter((l) => /^FAIL|Error/.test(l)).slice(0, 8).map((l) => `        ${l}`).join('\n'))
}
console.log(failed === 0 ? `\nALL ${suites.length} BROWSER SUITES PASSED` : `\n${failed} OF ${suites.length} BROWSER SUITES FAILED`)
process.exit(failed === 0 ? 0 : 1)
