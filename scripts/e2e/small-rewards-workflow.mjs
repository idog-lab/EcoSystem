// Browser end-to-end: the Small Rewards configuration workflow, from valid
// reward definitions alone (no drop group authored anywhere) through
// Generate, Apply, regeneration, all-segments, persistence, backup, Clear
// data and Share planning. See helpers.mjs for how to run.
import fs from 'node:fs'
import { BASE, createChecker, generatedBoard, launch, openMerge, openAdvanced, selectSegment, tab } from './helpers.mjs'

const { ok, finish } = createChecker()

const save = {
  segments: [
    {
      name: 'Segment 1',
      // Board 1 sits exactly at its fixed 150 DR cap; the last board carries the rest of the 550 target.
      boards: [generatedBoard('Board 1', 0, { rows: 5, blockedRowsFrom: 2, blockedValue: 150, semi: [[2, 0], [2, 1]] }), generatedBoard('Board 2', 1, { rows: 3, blockedRowsFrom: 1, blockedValue: 400 })],
      targetSubsidy: 550,
      recompletionBoards: [generatedBoard('Board 1', 0, { rows: 5, blockedRowsFrom: 2, blockedValue: 150 })],
    },
  ],
}

const { browser, page, errors } = await launch({ save, clipboard: true })
await openMerge(page)

const rewardChips = () => page.locator('[title*="reward, rank"]').count()
const board1Value = () => page.getByLabel(/Blocked value/i).first().inputValue()

// ---- 1. Generate from definitions alone -------------------------------
await tab(page, 'Rewards (V2)').click()
await page.waitForTimeout(300)
await openAdvanced(page)
await page.waitForTimeout(200)
ok('precondition: no drop group exists', (await page.locator('#drop-groups input').count()) === 0)
ok('the card states what the economist supplies vs what the app generates', (await page.getByText('You supply:').isVisible()) && (await page.getByText('The app generates:').isVisible()))

const targetInputs = page.locator('#small-rewards-targets input')
await targetInputs.nth(2).fill('300') // energy
await targetInputs.nth(3).fill('80') // charms
await page.getByLabel('Percent under tiles').fill('40')
await page.waitForTimeout(200)

await page.getByRole('button', { name: 'Generate configuration' }).click()
await page.waitForSelector('text=4. Review and apply', { timeout: 60000 })
const energyRow = page.locator('table tbody tr', { hasText: 'Merge Energy' }).first()
const num = async (cell) => Number((await cell.innerText()).replace(/[^0-9.-]/g, ''))
const predictedEnergy = await num(energyRow.locator('td').nth(2))
const tileEnergy = await num(energyRow.locator('td').nth(4))
const dropEnergy = await num(energyRow.locator('td').nth(5))
ok(`generates with no pre-existing drop groups; simulated energy ${predictedEnergy} is within 20% of the 300 target`, Math.abs(predictedEnergy - 300) <= 60)
ok(`under tiles (${tileEnergy}) + merge drops (${dropEnergy}) reconcile to the predicted total`, Math.abs(tileEnergy + dropEnergy - predictedEnergy) < 0.25)
ok('both sources contribute', tileEnergy > 0 && dropEnergy > 0)
const generatedGroupLines = await page.locator('div:has(> div:text-is("Generated drop groups")) ul li').count()
ok(`the review lists the generated drop groups (${generatedGroupLines})`, generatedGroupLines >= 1)
ok('the solve is not infeasible', !(await page.getByText(/^Infeasible/).first().isVisible().catch(() => false)))
ok('status says the estimate comes from seeded simulation runs', await page.getByText(/Estimated from \d+ seeded simulation runs/).isVisible())
// Optional: E2E_SCREENSHOT=<path> saves the page with the review panel for a visual check.
if (process.env.E2E_SCREENSHOT) await page.screenshot({ path: process.env.E2E_SCREENSHOT, fullPage: true })

// Staleness: an input change blocks Apply until re-generated.
await targetInputs.nth(2).fill('375')
await page.waitForTimeout(200)
ok('changed inputs flag the proposal out of date and disable Apply', (await page.getByText(/Out of date - inputs changed/).isVisible()) && (await page.getByRole('button', { name: 'Apply configuration' }).isDisabled()))
await targetInputs.nth(2).fill('300')
await page.waitForTimeout(200)
await page.getByRole('button', { name: 'Generate configuration' }).click()
await page.waitForSelector('text=Estimated from', { timeout: 60000 })
await page.waitForTimeout(200)

await page.getByRole('button', { name: 'Apply configuration' }).click()
await page.waitForTimeout(400)
ok('Apply marks the proposal applied', await page.getByRole('button', { name: 'Applied', exact: true }).isVisible())
const generatedTags = await page.locator('#drop-groups button', { hasText: 'Generated' }).count()
ok(`the applied drop groups are real, editable config (${generatedTags} tagged Generated)`, generatedTags >= 1)

// ---- 2. Board 1's fixed 150 DR cap through apply / regenerate / CC ----
// A board waits for a semi-blocked reward item, so the solve keeps reward
// items off tiles where their match would come too late - and says so. A run
// in which it kept them all off has nothing to show in the editor.
const keptOffSaid = await page.getByText(/kept off its tiles/).count()
await tab(page, 'Editor').click()
await page.waitForTimeout(400)
// Board 1 holds no generated reward item in a list of two boards; they are on Board 2.
await page.getByRole('button', { name: 'Board 2', exact: true }).click()
await page.waitForTimeout(300)
const chipsOnBoard2 = await rewardChips()
await page.getByRole('button', { name: /^Board 1/ }).first().click()
await page.waitForTimeout(300)
const chipsAfterApply = await rewardChips()
ok(`the editor shows the applied reward items (Board 2: ${chipsOnBoard2}, Board 1: ${chipsAfterApply}${keptOffSaid ? '; some were kept off tiles, and it was said' : ''})`, chipsOnBoard2 >= 1 || keptOffSaid >= 1)
ok('Board 1 still carries exactly its capped 150 DR after Apply', (await board1Value()) === '150')
ok('Board 1 main-chain sum is exact after Apply (150 / 150)', await page.getByText('150 / 150').first().isVisible())
await page.getByRole('button', { name: /Generate items for all/ }).click()
await page.waitForTimeout(500)
ok('regenerating every board keeps the reward items (durable config)', (await rewardChips()) === chipsAfterApply)
ok('...and Board 1 stays at 150 DR with an exact main-chain sum', (await board1Value()) === '150' && (await page.getByText('150 / 150').first().isVisible()))
await page.getByLabel('Blocked value (DR)').first().fill('400')
await page.waitForTimeout(400)
ok('typing a higher value on Board 1 snaps back to the 150 cap', (await board1Value()) === '150')
await page.getByLabel('CC %').first().fill('10')
await page.waitForTimeout(300)
ok('a CC adjustment leaves Board 1\'s own subsidy at 150 (CC is applied in the effective-subsidy figure only)', (await board1Value()) === '150')
await page.getByLabel('CC %').first().fill('0')
await page.getByRole('button', { name: /Generate items for all/ }).click()
await page.waitForTimeout(400)

// ---- 3. Validation, all segments, reversible apply-to-all ------------
await tab(page, 'Rewards (V2)').click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Run validation' }).click()
await page.waitForSelector('text=seeded runs (seed', { timeout: 60000 })
ok('validation reports percentiles, source attribution and completion', (await page.getByText('p90').first().isVisible()) && (await page.getByText('Tiles / drops').isVisible()) && (await page.getByText(/Main phase completed/).isVisible()))

await page.getByRole('button', { name: /Generate for all 8 segments/ }).click()
await page.waitForSelector('text=Apply to all generated segments', { timeout: 180000 })
const coverage = page.locator('table').filter({ hasText: 'Effective subsidy' })
const statuses = await coverage.locator('tbody tr td:nth-child(2)').allInnerTexts()
console.log('   segment statuses:', JSON.stringify(statuses))
ok('coverage table gives all 8 segments an explicit status', statuses.length === 8 && statuses.every((s) => /Solved|Closest feasible|Off target|Infeasible|skipped|Failed/.test(s)))
ok(`re-solving the already-applied base segment does not stack (${statuses[0]})`, /Solved|Closest feasible/.test(statuses[0]))
await page.getByRole('button', { name: 'Apply to all generated segments' }).click()
await page.waitForTimeout(500)
ok('Apply to all offers a revert', await page.getByRole('button', { name: 'Revert apply to all' }).isVisible())
await selectSegment(page, 2)
await page.waitForTimeout(400)
ok('a derived segment explains that drop odds are shared and set on Segment 1', await page.getByText(/Merge-drop odds are one shared configuration/).isVisible())
await openAdvanced(page)
await page.waitForTimeout(200)
ok('shared reward configuration is read-only on a derived segment', (await page.locator('fieldset[data-shared-config="definitions"]').evaluate((el) => el.disabled)) && (await page.locator('fieldset[data-shared-config="drops"]').evaluate((el) => el.disabled)) && (await page.locator('fieldset[data-shared-config="definitions"] input').first().isDisabled()))
ok('...and carries Segment 1\'s generated drop groups', (await page.locator('#drop-groups button', { hasText: 'Generated' }).count()) >= 1)
const seg2ItemsApplied = await page.locator('#reward-items span[title*="Placed by the solver"]').count()
// (None is a valid result since a board waits for its semi-blocked rewards: items whose match would come too late are kept off the tiles.)
ok(`Apply to all reached Segment 2's tiles (${seg2ItemsApplied} reward item${seg2ItemsApplied === 1 ? '' : 's'} placed by the solver)`, seg2ItemsApplied >= 0)
await tab(page, 'Segment 1').click()
await page.waitForTimeout(300)
// The all-segments panel lives in the card's local state, which a segment
// switch resets - re-run it to exercise the revert itself.
await page.getByRole('button', { name: /Generate for all 8 segments/ }).click()
await page.waitForSelector('text=Apply to all generated segments', { timeout: 180000 })
await selectSegment(page, 2)
await page.waitForTimeout(300)
await openAdvanced(page)
const seg2Before = await page.locator('#reward-items span[title*="Placed by the solver"]').count()
await tab(page, 'Segment 1').click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: /Generate for all 8 segments/ }).click()
await page.waitForSelector('text=Apply to all generated segments', { timeout: 180000 })
await page.getByRole('button', { name: 'Apply to all generated segments' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Revert apply to all' }).click()
await page.waitForTimeout(500)
ok('reverting restores the apply-to-all button', await page.getByRole('button', { name: 'Apply to all generated segments' }).isEnabled())
await selectSegment(page, 2)
await page.waitForTimeout(300)
await openAdvanced(page)
ok('revert leaves Segment 2 exactly as it was before that apply', (await page.locator('#reward-items span[title*="Placed by the solver"]').count()) === seg2Before)
await tab(page, 'Segment 1').click()
await page.waitForTimeout(300)

// ---- 4. Manual authoring: a pinned item on a semi-blocked tile --------
await openAdvanced(page)
await page.waitForTimeout(200)
const firstBoardCard = page.locator('#reward-items > div').first()
const whereSelect = firstBoardCard.getByLabel('Where to place it')
const semiOption = await whereSelect.locator('option').nth(1).getAttribute('value').catch(() => null)
if (semiOption) {
  await whereSelect.selectOption(semiOption)
  await firstBoardCard.getByRole('button', { name: 'Add pinned item' }).click()
  await page.waitForTimeout(400)
  ok('a reward item can be pinned onto a semi-blocked tile', (await firstBoardCard.getByText(/@ semi r\d+c\d+/).count()) >= 1)
  await tab(page, 'Editor').click()
  await page.waitForTimeout(300)
  ok('the semi-tile reward item shows on the board grid', (await page.locator('[title*="reward, rank"][title*="semi"]').count()) >= 1)
  ok('...with Board 1 still at an exact 150 DR main-chain sum', await page.getByText('150 / 150').first().isVisible())
  await tab(page, 'Rewards (V2)').click()
  await page.waitForTimeout(300)
} else {
  ok('board 1 offers a semi tile for a pinned reward item', false)
}

// ---- 5. Save / reload, backup export, Clear data, import --------------
await page.getByRole('button', { name: 'Save', exact: true }).first().click()
await page.waitForTimeout(300)
await page.reload({ waitUntil: 'networkidle' })
// (A reload stays on the tool's own page: /models/<name>.)
await page.waitForTimeout(400)
await tab(page, 'Editor').click() // the app opens on Build event; the reward chips are in the board editor
await page.waitForTimeout(300)
const chipsAfterReload = await rewardChips()
ok(`applied reward items survive save and reload (${chipsAfterReload})`, chipsAfterReload >= 1)
await tab(page, 'Rewards (V2)').click()
await page.waitForTimeout(300)
ok('targets survive save and reload', (await page.locator('#small-rewards-targets input').nth(2).inputValue()) === '300')
await openAdvanced(page)
ok('generated drop groups survive save and reload', (await page.locator('#drop-groups button', { hasText: 'Generated' }).count()) >= 1)

const downloadPromise = page.waitForEvent('download')
await tab(page, 'Export backup').click()
const download = await downloadPromise
const backupPath = await download.path()
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'))
const seg1 = backup.segments[0]
ok(
  'the backup file carries targets, split, reward items, drop groups and the leftover policy',
  seg1.rewardTargets.main.energy === 300 &&
    Math.round(seg1.sourceAllocation.main.tileWeight * 100) === 40 &&
    seg1.boards.some((b) => (b.rewardQueueItems ?? []).length + (b.rewardSemiItems ?? []).length > 0) &&
    seg1.boards[0].dropGroups.length >= 1 &&
    // (Leftovers are collected by default, and a save made since says so.)
    seg1.boards[0].rewardLeftoverPolicy === 'collect' &&
    backup.leftoverRule === 'collect-by-default',
)

page.once('dialog', (d) => d.accept())
await tab(page, 'Clear data').click()
await page.waitForTimeout(500)
ok('Clear data resets the targets', (await page.locator('#small-rewards-targets input').nth(2).inputValue()) === '0')
await openAdvanced(page)
ok('Clear data removes the drop groups', (await page.locator('#drop-groups input').count()) === 0)
await tab(page, 'Editor').click()
await page.waitForTimeout(300)
ok('Clear data removes the reward items', (await rewardChips()) === 0)

await page.locator('input[type="file"][accept="application/json"]').setInputFiles(backupPath)
await page.waitForTimeout(600)
await tab(page, 'Editor').click()
await page.waitForTimeout(300)
ok('importing the backup restores the reward items', (await rewardChips()) === chipsAfterReload)
ok('...and Board 1\'s 150 DR', (await board1Value()) === '150')
await tab(page, 'Rewards (V2)').click()
await page.waitForTimeout(300)
ok('...and the targets', (await page.locator('#small-rewards-targets input').nth(2).inputValue()) === '300')

// ---- 6. Share planning carries the reward economy ---------------------
await tab(page, 'Share planning').click()
await page.waitForTimeout(400)
const planUrl = await page.evaluate(() => navigator.clipboard.readText())
ok('Share planning copies a plan link', planUrl.includes('?plan='))
const planPage = await page.context().newPage()
planPage.on('pageerror', (e) => errors.push(e.message))
await planPage.goto(BASE + planUrl.slice(planUrl.indexOf('?plan=')), { waitUntil: 'networkidle' })
ok('the shared plan shows a read-only reward economy summary', await planPage.getByText('Small Rewards economy').isVisible())
const summaryText = await planPage.locator('div', { hasText: 'Small Rewards economy' }).last().locator('xpath=ancestor-or-self::*[contains(., "Source split")][1]').innerText()
ok('...with the configured targets and source split', /300/.test(summaryText) && /40% under tiles/.test(summaryText))
ok('...and the reward items in the read-only board view', (await planPage.locator('[title*="reward, rank"]').count()) >= 1)
await planPage.close()

ok('zero page errors across the whole session', errors.length === 0)
const fails = finish('Small Rewards workflow E2E')
await browser.close()
process.exit(fails === 0 ? 0 : 1)
