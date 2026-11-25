// Browser end-to-end: every tool agrees on which configuration it is using.
//   - Twister analyzed on a DRAFT without applying it, and on the applied
//     design, with results and costs tied to the one selected.
//   - An advanced Rewards Generate/Apply leaves the design OUT OF DATE (not
//     finalized-looking), with a direct Rebuild and a gated export.
//   - A draft survives a reload, separately from the applied design, and is
//     never applied by being restored.
// See helpers.mjs for how to run.
import { RC_MAX_RANK } from '../../src/features/merge/lib/core/ranks.js'
import { createDropGroupsConfig } from '../../src/features/merge/lib/rewards/dropGroups.js'
import { applyTwisterDropRule } from '../../src/features/merge/lib/rewards/twisterEconomy.js'
import { createChecker, generatedBoard, launch, openMerge, tab } from './helpers.mjs'

const { ok, finish } = createChecker()
const num = (text) => Number(String(text).replace(/,/g, '').match(/-?\d+(\.\d+)?/)?.[0])
const step = (page, id) => page.locator(`[data-step="${id}"]`)
const chips = async (page) => page.locator('[data-testid="build-scope"] [data-status]').evaluateAll((els) => els.map((e) => e.dataset.status))
const designState = async (page) => page.getByTestId('design-status').getAttribute('data-design-state')

// An existing hand-generated design, with Twister configured (ladder + a
// shared drop), and an energy target waiting to be built.
const rule = applyTwisterDropRule({ dropGroups: [], dropGroupsConfig: createDropGroupsConfig(RC_MAX_RANK), minDropRank: 6, itemRank: 2, perMille: 300 })
const boards = [150, 500, 500].map((v, i) => {
  const b = { ...generatedBoard(`Board ${i + 1}`, i, { rows: i === 0 ? 5 : 3, blockedRowsFrom: i === 0 ? 3 : 1, blockedValue: v }), minDropRank: 9 }
  ;[2, 5, 12, 30].forEach((value, r) => (b.rewardChainConfig.twister[r] = { ...b.rewardChainConfig.twister[r], syntax: `e2e-twister-${r + 1}`, prizeAmount: value }))
  return { ...b, dropGroups: rule.dropGroups, dropGroupsConfig: rule.dropGroupsConfig }
})
const save = { segments: [{ name: 'Base', boards, rewardTargets: { main: { coins: 0, puzzles: 0, energy: 150, charms: 0 }, rc: { coins: 0, puzzles: 0, energy: 0, charms: 0 } } }] }

const { browser, page, errors } = await launch({ save })
await openMerge(page)

async function build() {
  await page.getByTestId('build-configuration').click()
  await page.getByTestId('build-configuration').waitFor({ state: 'visible', timeout: 240000 })
  await page.waitForTimeout(300)
}
async function analyze() {
  await page.getByTestId('twister-analyze').click()
  await page.getByTestId('twister-progress').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  await page.getByTestId('twister-analyze').waitFor({ state: 'visible', timeout: 180000 })
  await page.waitForTimeout(200)
}
const row = (i) => page.locator(`[data-twister-row="${i}"]`)
// The export buttons hold the segment shown or every segment: a switch beside them says which.
const exportButton = async (scope) => {
  await page.locator(`[data-scope="${scope}"]`).click()
  await page.waitForTimeout(100)
  return page.getByRole('button', { name: scope === 'all' ? 'Download combined workbook' : /Download workbook \(this segment\)/ })
}
const cell = async (i, name) => (await row(i).locator(`[data-cell="${name}"]`).first().innerText()).trim()

// ---------- A hand-built design with no energy income needs nothing ----------
await tab(page, 'Syntax').click()
await page.waitForTimeout(300)
ok('a hand-built design that pays no energy is exportable as it stands', (await page.getByTestId('export-blocked').count()) === 0 && (await (await exportButton('segment')).isEnabled()))
ok('the Syntax tool says it exports the event in use', (await page.getByTestId('syntax-export-source').innerText()).includes('event in use'))

// ---------- Build: the build is in use at once ----------
await tab(page, 'Build event').click()
await step(page, 'build').click()
await page.waitForTimeout(200)
await build()
ok('the build is in use the moment it finishes', (await chips(page)).includes('applied'))
const draftGenerated = num(await page.locator('[data-testid="review-subsidy"] [data-cell="effective"]').innerText())

// ---------- The Twister tool on the build's own boards ----------
// (The Twister tool is one of the advanced tools, in the header's "More" menu.)
await tab(page, 'Twister').click()
await page.waitForTimeout(300)
await page.locator('[data-source="draft"]').click()
await page.waitForTimeout(400)
ok('Twister opens on the draft, and says the draft need not be applied', (await page.locator('[data-source="draft"]').getAttribute('aria-pressed')) === 'true' && (await page.getByTestId('twister-source-note').innerText()).includes('does not need to be applied'))
await page.getByTestId('twister-runs').fill('30')
await page.getByTestId('twister-runs').blur()
await page.waitForTimeout(150)
await analyze()
const draftMean = num(await cell(0, 'mean'))
ok(`Twister income is analyzed on the draft's own boards (mean ${draftMean})`, draftMean > 0)
ok('the Twister tool says its results do not survive a reload', (await page.getByTestId('twister-session-only').innerText()).includes('do not survive a reload'))
await page.getByTestId('twister-target-spins').fill('4')
await page.waitForTimeout(150)
await page.getByTestId('twister-suggest').click()
await page.waitForTimeout(200)
const draftCost = num(await cell(0, 'suggested'))
await page.getByTestId('twister-apply-selected').click()
await page.waitForTimeout(250)
ok('a suggested cost can be applied, and is recorded as derived from this draft', num(await cell(0, 'applied')) === draftCost && (await row(0).locator('[data-cost-basis]').innerText()).includes('from this draft'))
await tab(page, 'Build event').click()
await page.waitForTimeout(200)
ok('evaluating Twister changed nothing in Build event: the build is still in use', (await chips(page)).includes('applied'))

// ---------- ...and on the APPLIED design, kept separate ----------
await tab(page, 'Twister').click()
await page.waitForTimeout(200)
await page.locator('[data-source="applied"]').click()
await page.waitForTimeout(250)
ok('switching to the applied design shows no numbers borrowed from the draft', (await cell(0, 'mean')) === '—' && (await cell(0, 'suggested')) === '—')
// (Back in Build event the twists typed in this tool were priced again on the build's own boards; that lands a moment later.)
await row(0).locator('[data-cost-basis]').filter({ hasText: 'set by the build' }).waitFor({ state: 'visible', timeout: 30000 }).catch(() => {})
ok('...and the cost set on the build is not flagged as foreign: the event in use IS that build', !(await row(0).locator('[data-cost-basis]').innerText()).includes('not the configuration selected here'))
await analyze()
const appliedMean = num(await cell(0, 'mean'))
ok(`the applied design gets its own analysis (mean ${appliedMean})`, appliedMean > 0)
await page.locator('[data-source="draft"]').click()
await page.waitForTimeout(250)
ok('switching back shows the draft\'s own stored result again', num(await cell(0, 'mean')) === draftMean)

// ---------- Tested on players: every tool reads the same design ----------
await tab(page, 'Build event').click()
await step(page, 'finalize').click()
await page.waitForTimeout(200)
await page.getByTestId('finalize-validate').click()
await page.getByTestId('validation-table').waitFor({ state: 'visible', timeout: 120000 })
await page.waitForTimeout(400)
ok('the build in use is now also tested on players', (await chips(page)).includes('applied') && (await chips(page)).includes('validated'))
ok('the export step is not blocked', (await page.getByTestId('export-blocked').count()) === 0 && (await page.getByTestId('finalize-download').isEnabled()))
await tab(page, 'Rewards (V2)').click()
await page.waitForTimeout(300)
ok('the Rewards tool reads the same design as built and validated', (await designState(page)) === 'consistent' && /built, simulation validated/.test(await page.getByTestId('design-status').innerText()))
await tab(page, 'Twister').click()
await page.waitForTimeout(250)
await page.locator('[data-source="applied"]').click()
await page.waitForTimeout(250)
ok('testing on players did not change the event in use, so its Twister analysis still stands', (await row(0).locator('[data-stale]').count()) === 0)

// ---------- An advanced, rewards-only Generate + Apply ----------
await tab(page, 'Rewards (V2)').click()
await page.waitForTimeout(300)
// A real rewards-only change: move most of the energy from tiles to drops.
// (Re-generating with nothing changed reproduces the same configuration,
// which correctly leaves the design consistent.)
await page.getByLabel('Percent under tiles').fill('10')
await page.waitForTimeout(200)
await page.getByRole('button', { name: 'Generate configuration' }).click()
await page.waitForSelector('text=4. Review and apply', { timeout: 120000 })
await page.getByRole('button', { name: 'Apply configuration' }).click()
await page.waitForTimeout(500)
ok('after the advanced Apply the design is OUT OF DATE, not finalized-looking', (await designState(page)) === 'stale' && /out of date - needs a rebuild/.test(await page.getByTestId('design-status').innerText()))
ok('...it says what changed and that the numbers of the last build no longer describe these boards', /reward items under tiles|what merges drop|the main-chain items under the tiles/.test(await page.getByTestId('design-status').innerText()) && /changed after the last build/.test(await page.getByTestId('design-status').innerText()) && /The numbers of the last build no longer describe these boards/.test(await page.getByTestId('design-status').innerText()))
ok('...and offers a direct rebuild', await page.getByTestId('design-rebuild').isVisible())
await tab(page, 'Build event').click()
await page.waitForTimeout(250)
ok('Build event agrees: that draft is no longer the applied design', !(await chips(page)).includes('applied'))

await tab(page, 'Syntax').click()
await page.waitForTimeout(300)
ok('exports are blocked while the applied design is out of date', (await page.getByTestId('export-blocked').isVisible()) && (await (await exportButton('segment')).isDisabled()) && (await (await exportButton('all')).isDisabled()) && (await page.getByRole('button', { name: /Copy as TSV/ }).isDisabled()))
ok('...naming the segment, the phase and the reason', /Base, Normal:/.test(await page.getByTestId('export-blocked').innerText()))
await page.getByTestId('export-override').check()
await page.waitForTimeout(150)
ok('an explicit override enables export and stays visibly on', (await (await exportButton('segment')).isEnabled()) && (await page.getByTestId('export-override-active').innerText()).includes('do not match their last build'))
await page.getByTestId('export-override').uncheck()
await page.waitForTimeout(150)
ok('turning the override off blocks export again', await (await exportButton('all')).isDisabled())

// ---------- Rebuild restores agreement ----------
await tab(page, 'Rewards (V2)').click()
await page.waitForTimeout(250)
await page.getByTestId('design-rebuild').click()
await page.waitForTimeout(300)
ok('"Rebuild in Build event" lands on the Build step', (await page.getByTestId('build-event').isVisible()) && (await step(page, 'build').getAttribute('aria-current')) === 'step')
await build()
await step(page, 'finalize').click()
await page.waitForTimeout(200)
await page.waitForTimeout(400)
await tab(page, 'Rewards (V2)').click()
await page.waitForTimeout(300)
ok('after rebuilding, the design is consistent again (estimated until tested again)', (await designState(page)) === 'consistent' && /estimated, not yet validated/.test(await page.getByTestId('design-status').innerText()))
await tab(page, 'Syntax').click()
await page.waitForTimeout(300)
ok('...and exports are open again without any override', (await page.getByTestId('export-blocked').count()) === 0 && (await (await exportButton('all')).isEnabled()))

// ---------- Draft restore: separate from the applied design, never applied ----------
// Nothing was saved, so a reload brings back the ORIGINAL applied design -
// and the draft, from its own storage.
const draftStored = await page.evaluate(() => !!localStorage.getItem('merge-mania-build-drafts'))
ok('the draft is stored separately from the project save', draftStored && (await page.evaluate((key) => !JSON.parse(localStorage.getItem(key)).segments[0].boards[0].buildStamp, 'merge-mania-board-simulator')))
await page.reload({ waitUntil: 'networkidle' })
// (A reload stays on the tool's own page: /models/<name>.)
await page.waitForTimeout(400)
ok('after a reload the build results are back, and they are NOT what is in use (the unsaved boards are gone)', !(await chips(page)).includes('applied'))
// The split was changed in the advanced tool and never saved, so the reloaded
// project has the old split: the restored draft no longer matches its inputs.
ok('...and because it was built from an unsaved split, it says exactly that and needs a rebuild', (await chips(page)).includes('stale') && (await page.getByTestId('build-stale').innerText()).includes('split'))
await step(page, 'build').click()
await page.waitForTimeout(250)
ok('its proposed boards, drops and reconciliation are intact', (await page.getByTestId('build-coverage').isVisible()) && num(await page.locator('[data-testid="review-subsidy"] [data-cell="effective"]').innerText()) > 0)
ok('the applied design is the saved one, untouched by the restore (500 DR on Board 2, not the draft\'s)', num(await page.locator('[data-review-board="1"] [data-cell="applied"]').innerText()) === 500 && draftGenerated < 1150)
await tab(page, 'Rewards (V2)').click()
await page.waitForTimeout(300)
ok('...and it is reported as hand-built again, not as built', (await designState(page)) === 'manual')

// A draft whose inputs no longer match explains why it must be rebuilt.
await tab(page, 'Build event').click()
await step(page, 'rewards').click()
await page.waitForTimeout(200)
await page.locator('[data-target="energy"]').fill('225')
await page.locator('[data-target="energy"]').blur()
await page.waitForTimeout(250)
await tab(page, 'Save').click()
await page.waitForTimeout(200)
await page.reload({ waitUntil: 'networkidle' })
// (A reload stays on the tool's own page: /models/<name>.)
await page.waitForTimeout(400)
ok('a restored build made from other inputs is kept but marked as needing a rebuild, with the reason', (await chips(page)).includes('stale') && (await page.getByTestId('build-stale').innerText()).includes('reward targets'))
await step(page, 'finalize').click()
await page.waitForTimeout(200)
ok('...and it cannot be put in use in that state', (await page.getByTestId('finalize-apply').count()) === 0 && (await page.getByTestId('finalize-in-use').getAttribute('data-state')) === 'stale')

// An incompatible stored draft is not restored, and says so.
await page.evaluate(() => localStorage.setItem('merge-mania-build-drafts', JSON.stringify({ format: 1, drafts: { main: { key: 'x', segments: [] } } })))
await page.reload({ waitUntil: 'networkidle' })
// (A reload stays on the tool's own page: /models/<name>.)
await page.waitForTimeout(400)
ok('a draft from an incompatible version is not restored; the applied design is kept and the reason is shown', (await page.getByTestId('draft-notice').innerText()).includes('earlier version') && (await chips(page)).includes('none'))
await step(page, 'layouts').click()
await page.waitForTimeout(200)
ok('...with the applied boards still there', (await page.locator('[data-capacity-board="1"] [data-cell="contents"]').innerText()).includes('has contents'))

ok('zero page errors', errors.length === 0)
await browser.close()
const fails = finish('Build consistency E2E')
process.exit(fails === 0 ? 0 : 1)
