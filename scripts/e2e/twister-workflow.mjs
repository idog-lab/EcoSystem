// Browser end-to-end: the Twister economy workflow in the real app.
// Configure rank values and the shared drop -> checkpoint + target ->
// analyze all segments -> suggest -> apply different segment costs ->
// override / revert -> staleness -> persistence, backup, clear, sharing and
// the on-screen export. See helpers.mjs for how to run.
import fs from 'node:fs'
import { BASE, createChecker, generatedBoard, launch, openMerge, tab, SAVE_KEY, syntaxView } from './helpers.mjs'
import { decodePlan } from '../../src/features/merge/lib/share/planShare.js'
import { boardHasTwisterUnderTiles } from '../../src/features/merge/lib/rewards/twisterEconomy.js'

const { ok, finish } = createChecker()
const SHOT = process.env.E2E_SCREENSHOT_DIR ?? null
const shot = async (page, name) => {
  if (SHOT) await page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: true })
}

// Segment 1 has little subsidy (the player pays for more of the climb, so
// more merges and more drops); segment 2 has a lot. Same layout, as the
// layout sync requires.
const chain = (values, minRank = null) => values.map((v, i) => generatedBoard(`Board ${i + 1}`, i, { rows: i === 0 ? 5 : 3, blockedRowsFrom: i === 0 ? 3 : 1, blockedValue: v, minRank }))
const save = {
  segments: [
    { name: 'Low subsidy', boards: chain([150, 200, 200]), recompletionBoards: chain([150, 2000], 3) },
    { name: 'High subsidy', boards: chain([150, 600, 700]) },
  ],
}

const { browser, context, page, errors } = await launch({ save, clipboard: true })
await openMerge(page)
await tab(page, 'Twister').click()
await page.waitForTimeout(300)

const row = (i) => page.locator(`[data-twister-row="${i}"]`)
const cellText = async (i, name) => (await row(i).locator(`[data-cell="${name}"]`).first().innerText()).trim()
const numberIn = (text) => Number(String(text).replace(/,/g, '').match(/-?\d+(\.\d+)?/)?.[0])

// ---------- 1. Configure rank values and the shared drop ----------
ok('the Twister tab opens on the five-step workflow', (await page.getByTestId('twister-page').isVisible()) && (await page.getByText('Configure Twister drops').first().isVisible()))
ok('Twister starts unconfigured - no rank value is invented', (await page.getByTestId('twister-ladder-status').innerText()).includes('Not configured yet'))
ok('Analyze is blocked until Twister is configured', await page.getByTestId('twister-analyze').isDisabled())

// A ladder that does NOT reward merging first: rank 4 = 2 x rank 3.
for (const [rank, value] of [[1, 2], [2, 4], [3, 8], [4, 16]]) await page.getByTestId(`twister-value-${rank}`).fill(String(value))
await page.waitForTimeout(150)
ok('a ladder where rank 4 does not beat its parts is flagged, in context', (await page.getByTestId('twister-ladder-status').innerText()).includes('is not worth more than'))
for (const [rank, value] of [[1, 2], [2, 5], [3, 12], [4, 30]]) await page.getByTestId(`twister-value-${rank}`).fill(String(value))
await page.waitForTimeout(150)
ok('a ladder that rewards merging is confirmed', (await page.getByTestId('twister-ladder-status').innerText()).includes('rewards merging'))
ok('the entered value was kept exactly (not adjusted)', (await page.getByTestId('twister-value-4').inputValue()) === '30')

await page.getByTestId('twister-rule-rank').selectOption('2')
await page.getByTestId('twister-rule-permille').fill('300')
await page.getByTestId('twister-apply-rule').click()
await page.waitForTimeout(250)
const oddsText = await page.getByTestId('twister-odds').innerText()
ok('the shared Twister drop shows for every eligible merge rank from 6 up', (await page.locator('[data-odds-rank="6"] [data-odds-chance]').innerText()) === '30%' && (await page.locator('[data-odds-rank="12"] [data-odds-chance]').innerText()) === '30%' && !oddsText.includes('\n5\n'))
ok('no drop is offered below the merge-drop start rank', (await page.locator('[data-odds-rank="5"]').count()) === 0)
await shot(page, '1-configured')

// ---------- 2. Checkpoint and target ----------
ok('the checkpoint definition is spelled out', (await page.getByTestId('twister-checkpoint-definition').innerText()).includes('main-chain DR value the player has in play'))
await page.getByTestId('twister-checkpoint').fill('70')
await page.getByTestId('twister-runs').fill('40')
ok('with no target entered, the app asks for one instead of assuming zero', await page.getByTestId('twister-target-missing').isVisible())

// ---------- 3. Analyze all segments ----------
await page.getByTestId('twister-analyze').click()
await page.getByTestId('twister-progress').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
await page.getByTestId('twister-analyze').waitFor({ state: 'visible', timeout: 120000 })
await page.waitForTimeout(200)
const mean0 = numberIn(await cellText(0, 'mean'))
const mean1 = numberIn(await cellText(1, 'mean'))
ok('analysis reports mean Twister DR at the checkpoint for each segment', mean0 > 0 && mean1 > 0)
ok('the segments collect different amounts from the SAME shared drops', mean0 !== mean1)
ok('...and each shows its p10-p90 range', /\d.*–.*\d/.test(await cellText(0, 'range')))
ok('a segment whose boards were never generated is not given numbers', (await row(2).locator('[data-needs-generation]').count()) === 1 && (await cellText(2, 'mean')) === '—')
ok('the run settings are exposed (checkpoint, runs, seed, collection policy)', /70%.*40.*seeded runs.*seed.*11.*merges Twister items toward rank 4/s.test(await page.getByTestId('twister-run-settings').innerText()))
ok('no cost is suggested without a target', (await cellText(0, 'suggested')) === '—' && (await page.getByTestId('twister-suggest').isDisabled()))

// ---------- 4. Suggest ----------
await page.getByTestId('twister-target-spins').fill('5')
await page.waitForTimeout(150)
await page.getByTestId('twister-suggest').click()
await page.waitForTimeout(250)
const sug0 = numberIn(await cellText(0, 'suggested'))
const sug1 = numberIn(await cellText(1, 'suggested'))
ok('each segment gets a suggested whole-DR cost of at least 1', Number.isInteger(sug0) && Number.isInteger(sug1) && sug0 >= 1 && sug1 >= 1)
ok('different segments get different suggested costs', sug0 !== sug1)
ok('the suggestion is near mean / target (the indicative cost)', Math.abs(sug0 - mean0 / 5) <= Math.max(2, (mean0 / 5) * 0.6))
ok('predicted spins and target attainment are shown for the cost to apply', /avg/.test(await cellText(0, 'spins')) && /%/.test(await cellText(0, 'attainment')))

await row(0).locator('[data-cell="details-toggle"]').click()
await page.waitForTimeout(150)
const details = page.getByTestId('twister-details-0')
const detailsText = await details.innerText()
ok('details show the calculation and the candidate costs', detailsText.includes('Indicative cost = mean collected Twister DR ÷ target spins') && (await details.locator('[data-candidates] tbody tr').count()) >= 3)
ok('details separate conditional from all-run results and report uncollected inventory', /Mean \(runs that reached it\)/i.test(detailsText) && /Mean \(all runs\)/i.test(detailsText) && /Uncollected Twister items/i.test(detailsText) && /Reached the checkpoint/i.test(detailsText))
ok('details revalidate the existing economy with and without Twister', (await details.locator('[data-economy-check]').innerText()).includes('Effective subsidy'))
// Target attainment shown == share of simulated players whose spins >= target at that cost.
const attainmentShown = numberIn(await cellText(0, 'attainment'))
const candidateRow = details.locator('[data-candidates] tbody tr.bg-purple-100\\/70')
const candidateAttainment = numberIn(await candidateRow.locator('td').nth(4).innerText())
ok('the table\'s target attainment matches the simulated spin availability at the suggested cost', attainmentShown === candidateAttainment)
await shot(page, '2-suggested')
await row(0).locator('[data-cell="details-toggle"]').click()

// ---------- 5. Apply, override, revert ----------
ok('nothing is written while analyzing or suggesting', (await cellText(0, 'applied')) === 'not set' && (await cellText(1, 'applied')) === 'not set')
await page.getByTestId('twister-apply-all').click()
await page.waitForTimeout(250)
ok('Apply all writes each segment\'s own cost', numberIn(await cellText(0, 'applied')) === sug0 && numberIn(await cellText(1, 'applied')) === sug1)

// Manual override on segment 2 only, applied through "Apply selected".
await row(1).locator('[data-cell="cost"]').fill(String(sug1 + 7))
await row(0).locator('input[type="checkbox"]').uncheck()
await page.waitForTimeout(150)
ok('a manual override updates the predicted spins immediately', /avg/.test(await cellText(1, 'spins')))
await page.getByTestId('twister-apply-selected').click()
await page.waitForTimeout(250)
ok('Apply selected writes only the selected segment', numberIn(await cellText(1, 'applied')) === sug1 + 7 && numberIn(await cellText(0, 'applied')) === sug0)
await row(1).locator('[data-cell="cost"]').fill('0')
await page.waitForTimeout(100)
ok('a zero cost is rejected', (await row(1).innerText()).includes('whole DR, 1 or more') && (await page.getByTestId('twister-apply-selected').isDisabled()))
await page.getByTestId('twister-revert').click()
await page.waitForTimeout(250)
ok('Revert restores the cost from before the last apply', numberIn(await cellText(1, 'applied')) === sug1)

// The price is per segment; the drops are not.
await page.getByRole('button', { name: 'High subsidy', exact: true }).click()
await page.waitForTimeout(200)
ok('on another segment the shared drops read the same', (await page.locator('[data-odds-rank="6"] [data-odds-chance]').innerText()) === '30%' && (await page.getByTestId('twister-value-4').inputValue()) === '30')
await page.getByRole('button', { name: 'Low subsidy', exact: true }).click()

// ---------- RC phase: its own configuration, its own price ----------
await page.getByRole('button', { name: 'RC phase', exact: true }).click()
await page.waitForTimeout(300)
ok('the RC phase has its own Twister configuration (blank until entered)', (await page.getByTestId('twister-ladder-status').innerText()).includes('Not configured yet') && (await page.getByTestId('twister-value-4').inputValue()) === '')
ok('the RC checkpoint is explained against rank 14 from a fresh RC board', /rank-14 item \(8,192 DR\)/.test(await page.getByTestId('twister-checkpoint-definition').innerText()) && (await page.getByTestId('twister-checkpoint-definition').innerText()).includes('not carried over'))
for (const [rank, value] of [[1, 3], [2, 7], [3, 16], [4, 40]]) await page.getByTestId(`twister-value-${rank}`).fill(String(value))
await page.getByTestId('twister-rule-rank').selectOption('2')
await page.getByTestId('twister-rule-permille').fill('250')
await page.getByTestId('twister-apply-rule').click()
await page.getByTestId('twister-runs').fill('12')
await page.getByTestId('twister-checkpoint').fill('60')
await page.getByTestId('twister-target-spins').fill('4')
await page.waitForTimeout(200)
await page.getByTestId('twister-analyze').click()
await page.getByTestId('twister-progress').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
await page.getByTestId('twister-analyze').waitFor({ state: 'visible', timeout: 180000 })
await page.waitForTimeout(200)
const rcMean = numberIn(await cellText(0, 'mean'))
ok('RC income is analyzed through the real main-then-RC run', rcMean > 0)
await page.getByTestId('twister-suggest').click()
await page.waitForTimeout(200)
const rcSug = numberIn(await cellText(0, 'suggested'))
await row(0).locator('input[type="checkbox"]').check()
await page.getByTestId('twister-apply-selected').click()
await page.waitForTimeout(250)
ok('an RC cost per spin is suggested and applied to the RC list', Number.isInteger(rcSug) && rcSug >= 1 && numberIn(await cellText(0, 'applied')) === rcSug)
await page.getByRole('button', { name: 'Normal phase', exact: true }).click()
await page.waitForTimeout(300)
ok('the normal phase keeps its own ladder and its own applied cost', (await page.getByTestId('twister-value-4').inputValue()) === '30' && numberIn(await cellText(0, 'applied')) === sug0 && (await page.getByTestId('twister-target-spins').inputValue()) === '5')
await page.getByTestId('twister-analyze').click()
await page.getByTestId('twister-progress').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
await page.getByTestId('twister-analyze').waitFor({ state: 'visible', timeout: 120000 })
await page.waitForTimeout(200)
await page.getByTestId('twister-suggest').click()
await page.waitForTimeout(200)
ok('re-analyzing with the same seed reproduces the same income', numberIn(await cellText(0, 'mean')) === mean0 && numberIn(await cellText(0, 'suggested')) === sug0)

// ---------- Staleness ----------
await page.getByTestId('twister-checkpoint').fill('50')
await page.waitForTimeout(200)
ok('changing the checkpoint marks every analysis out of date', (await page.locator('[data-stale]').count()) >= 2 && (await cellText(0, 'mean')) === '—')
await page.getByTestId('twister-checkpoint').fill('70')
await page.waitForTimeout(200)
ok('restoring the checkpoint makes the stored analysis current again', numberIn(await cellText(0, 'mean')) === mean0)
await page.getByTestId('twister-rule-permille').fill('200')
await page.getByTestId('twister-apply-rule').click()
await page.waitForTimeout(250)
ok('changing the shared drop marks every analysis out of date', (await page.locator('[data-stale]').count()) >= 2)
await page.getByTestId('twister-rule-permille').fill('300')
await page.getByTestId('twister-apply-rule').click()
await page.waitForTimeout(250)
ok('...and the stored cost is NOT touched by any of this', numberIn(await cellText(0, 'applied')) === sug0)
await page.getByTestId('twister-target-spins').fill('6')
await page.waitForTimeout(200)
ok('changing the target marks the suggestion out of date', (await cellText(0, 'suggested')).includes('out of date'))
await page.getByTestId('twister-target-spins').fill('5')
await page.waitForTimeout(150)

// ---------- Save / reload ----------
await page.getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForTimeout(200)
const saved = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY))
ok('Save stores each segment\'s own cost and the shared Twister ladder', saved.segments[0].boards[0].twisterSpinCost === sug0 && saved.segments[1].boards[0].twisterSpinCost === sug1 && saved.segments[1].boards[0].rewardChainConfig.twister[3].prizeAmount === 30)
ok('Save stores the design inputs (checkpoint, target) as plan data', saved.segments[0].twisterPlan.main.checkpointPct === 70 && saved.segments[0].twisterPlan.main.targetSpins === 5)
ok('Save stores the RC list\'s own cost and ladder separately', saved.segments[0].recompletionBoards[0].twisterSpinCost === rcSug && saved.segments[0].recompletionBoards[0].rewardChainConfig.twister[3].prizeAmount === 40 && saved.segments[0].twisterPlan.rc.checkpointPct === 60)
ok('Twister is in no starting tile or blocked queue of any saved board', saved.segments.every((s) => [...s.boards, ...s.recompletionBoards].every((b) => !boardHasTwisterUnderTiles(b))))
await page.reload({ waitUntil: 'networkidle' })
await page.getByText('Merge Mania', { exact: false }).first().click()
await tab(page, 'Twister').click()
await page.waitForTimeout(300)
ok('after reload the costs, ladder, drop and inputs are all still there', numberIn(await cellText(0, 'applied')) === sug0 && numberIn(await cellText(1, 'applied')) === sug1 && (await page.getByTestId('twister-value-3').inputValue()) === '12' && (await page.getByTestId('twister-target-spins').inputValue()) === '5' && (await page.locator('[data-odds-rank="7"] [data-odds-chance]').innerText()) === '30%')

// ---------- Small Rewards Generate keeps the Twister drop ----------
await tab(page, 'Rewards (V2)').click()
await page.waitForTimeout(300)
await page.locator('#small-rewards-targets input').nth(2).fill('150') // merge energy
await page.getByLabel('Percent under tiles').fill('40')
await page.waitForTimeout(200)
await page.getByRole('button', { name: 'Generate configuration' }).click()
await page.waitForSelector('text=4. Review and apply', { timeout: 120000 })
await page.getByRole('button', { name: 'Apply configuration' }).click()
await page.waitForTimeout(400)
ok('the four-resource workflow has no Twister target or tile/drop split', (await page.locator('#small-rewards-targets input').count()) === 4 && !(await page.locator('#small-rewards-targets').innerText()).includes('Twister'))
await tab(page, 'Editor').click()
await page.waitForTimeout(300)
ok('Board 1 keeps its exact main-chain sum with Twister drops configured (150 / 150)', await page.getByText('150 / 150').first().isVisible())
await tab(page, 'Twister').click()
await page.waitForTimeout(300)
ok('generating the other small rewards leaves the Twister drop in place', (await page.locator('[data-odds-rank="8"] [data-odds-chance]').innerText()) === '30%')

// ---------- Syntax tab: shared definitions vs segment costs ----------
await tab(page, 'Syntax').click()
await syntaxView(page, 'V2 Twister')
await page.waitForTimeout(200)
const twisterSheet = await page.locator('table').first().innerText()
ok('V2 Twister lists this segment\'s cost as runtime and the targets as design metadata', twisterSheet.includes('Runtime - segment-specific') && twisterSheet.includes('DR cost per spin') && twisterSheet.includes(String(sug0)) && twisterSheet.includes('Design metadata - not runtime') && twisterSheet.includes('Target spins by the checkpoint'))
await syntaxView(page, 'V2 Reward Chain')
await page.waitForTimeout(200)
ok('the shared Twister ladder is exported with the reward definitions', (await page.locator('table').first().innerText()).includes('dr-twister-r4'))
await syntaxView(page, 'V2 Drop Groups')
await page.waitForTimeout(200)
ok('the shared Twister drop is exported with the drop groups', /Twister DR rank/.test(await page.locator('table').first().innerText()) && (await page.locator('table').first().innerText()).includes('Twister DR R2'))
await syntaxView(page, 'Blocked Queue')
await page.waitForTimeout(200)
ok('the Blocked Queue export contains no Twister entry', !(await page.locator('table').first().innerText()).includes('twister'))
// The advanced Rewards Generate above gave these hand-built boards merge
// energy without any energy credit being taken off them, so the export is
// blocked until that is rebuilt - or explicitly overridden, as here.
ok('an advanced rewards-only change on a hand-built design blocks export, with the reason', (await page.getByTestId('export-blocked').innerText()).includes('made by hand, not by a build') && (await page.getByRole('button', { name: /Download workbook/ }).first().isDisabled()))
await page.getByTestId('export-override').check()
await page.waitForTimeout(150)
// The real workbook download.
const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download workbook/ }).first().click()])
const xlsxPath = await download.path()
ok('the per-segment workbook downloads', fs.statSync(xlsxPath).size > 5000)
await page.locator('[data-scope="all"]').click()
await page.waitForTimeout(150)
const [downloadAll] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download combined workbook/ }).click()])
ok('the combined workbook downloads', fs.statSync(await downloadAll.path()).size > 5000)

// ---------- Share planning ----------
await tab(page, 'Share planning').click()
await page.waitForTimeout(400)
const planUrl = await page.evaluate(() => navigator.clipboard.readText())
const plan = decodePlan(new URL(planUrl).searchParams.get('plan'))
ok('the planning link carries each segment\'s cost and the Twister design inputs', plan?.[0]?.twisterCosts?.main === sug0 && plan?.[1]?.twisterCosts?.main === sug1 && plan?.[0]?.twisterPlan?.main?.targetSpins === 5)
const planPage = await context.newPage()
await planPage.goto(`${BASE}?plan=${new URL(planUrl).searchParams.get('plan')}`, { waitUntil: 'networkidle' })
await planPage.waitForTimeout(300)
const planText = await planPage.getByTestId('plan-twister-summary').innerText().catch(() => '')
ok('the read-only plan view shows the Twister cost per spin and checkpoint', planText.includes(`${sug0} DR`) && planText.includes('70%'))
await planPage.close()

// ---------- Backup export / Clear / import ----------
const [backup] = await Promise.all([page.waitForEvent('download'), tab(page, 'Export backup').click()])
const backupPath = await backup.path()
const backupJson = JSON.parse(fs.readFileSync(backupPath, 'utf8'))
ok('the backup file carries costs, ladder, drops and plan', backupJson.segments[1].boards[0].twisterSpinCost === sug1 && backupJson.segments[0].boards[0].dropGroups.some((g) => g.items.twister === 2) && backupJson.segments[0].twisterPlan.main.targetSpins === 5)
page.once('dialog', (d) => d.accept())
await tab(page, 'Clear data').click()
await page.waitForTimeout(400)
await tab(page, 'Twister').click()
await page.waitForTimeout(300)
ok('Clear data resets Twister: no costs, no ladder, no drop, default inputs', (await cellText(0, 'applied')) === 'not set' && (await page.getByTestId('twister-value-4').inputValue()) === '' && (await page.getByTestId('twister-target-spins').inputValue()) === '' && (await page.locator('[data-odds-rank="6"] [data-odds-chance]').innerText()) === '—')
await page.locator('input[type="file"]').setInputFiles(backupPath)
await page.waitForTimeout(600)
await tab(page, 'Twister').click()
await page.waitForTimeout(300)
ok('Import backup restores every Twister setting', numberIn(await cellText(0, 'applied')) === sug0 && numberIn(await cellText(1, 'applied')) === sug1 && (await page.getByTestId('twister-value-4').inputValue()) === '30' && (await page.getByTestId('twister-target-spins').inputValue()) === '5' && (await page.locator('[data-odds-rank="6"] [data-odds-chance]').innerText()) === '30%')

// ---------- A legacy save (no Twister fields at all) ----------
{
  const legacyBoards = chain([150, 300, 300]).map((b) => {
    const { twisterSpinCost: _c, twisterSpinObjective: _o, ...rest } = b
    const { twister: _t, ...oldChain } = rest.rewardChainConfig
    return { ...rest, rewardChainConfig: oldChain }
  })
  const legacy = await launch({ save: { segments: [{ name: 'Old', boards: legacyBoards }] } })
  await openMerge(legacy.page)
  await tab(legacy.page, 'Twister').click()
  await legacy.page.waitForTimeout(300)
  ok('a save from before Twister loads: Twister simply starts unconfigured', (await legacy.page.getByTestId('twister-ladder-status').innerText()).includes('Not configured yet') && legacy.errors.length === 0)
  await tab(legacy.page, 'Rewards (V2)').click()
  await legacy.page.waitForTimeout(300)
  await legacy.page.locator('summary', { hasText: 'Reward definitions and advanced settings' }).first().click()
  await legacy.page.waitForTimeout(200)
  const puzzles4 = await legacy.page.locator('[data-reward-ladder="puzzles"] input[type="number"]').nth(3).inputValue()
  ok('...and its existing reward values are untouched (puzzles rank 4 = 40)', puzzles4 === '40')
  ok('the existing reference ladders are flagged, not changed', (await legacy.page.locator('[data-ladder-finding="puzzles"]').count()) === 1 && (await legacy.page.locator('[data-ladder-finding="energy"]').count()) === 0)
  await legacy.browser.close()
}

// ---------- A save whose segments had their OWN reward config ----------
{
  const own = chain([150, 300, 300]).map((b) => ({
    ...b,
    dropGroups: [{ id: 'seg2-own', name: 'Segment 2 own group', items: { coins: 2 } }],
    dropGroupsConfig: b.dropGroupsConfig.map((t) => (t.rank === 8 ? { ...t, entries: [{ groupId: 'seg2-own', weight: 40 }] } : t)),
  }))
  const diverged = await launch({ save: { segments: [{ name: 'One', boards: chain([150, 300, 300]) }, { name: 'Two', boards: own }] } })
  await openMerge(diverged.page)
  await tab(diverged.page, 'Two').click()
  await tab(diverged.page, 'Rewards (V2)').click()
  await diverged.page.waitForTimeout(400)
  ok('a segment whose own reward config is replaced by the shared one is told so', await diverged.page.getByTestId('legacy-reward-config').isVisible())
  await diverged.page.getByRole('button', { name: 'Save', exact: true }).click()
  await diverged.page.waitForTimeout(200)
  const kept = JSON.parse(await diverged.page.evaluate((key) => localStorage.getItem(key), SAVE_KEY))
  ok('...and that config is kept in the saved data, not destroyed', kept.segments[1].legacyRewardConfig?.boards?.dropGroups?.[0]?.id === 'seg2-own' && kept.segments[1].legacyRewardConfig.boards.dropGroupsConfig[7].entries[0].weight === 40)
  ok('...while the live configuration is the shared one', kept.segments[1].boards[0].dropGroups.length === 0)
  ok('a segment that never had its own config gets no such notice', !kept.segments[2].legacyRewardConfig)
  await diverged.browser.close()
}

ok('zero page errors', errors.length === 0)
await browser.close()
const fails = finish('Twister workflow E2E')
process.exit(fails === 0 ? 0 : 1)
