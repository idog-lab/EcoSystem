// Browser end-to-end: what a player really ends up with, and one event in the
// Syntax sheets.
//   - the build gives every reward round rank values that reward merging, and
//     step 6 shows them; step 7 plays the same event three ways (merging,
//     tapping when it pays, tapping everything) - economist: "a friend did a
//     run on the share stage and he ended up with crazy rewards";
//   - with the model switched off and the reference values, tapping pays more
//     and step 7 says so;
//   - Recompletion plays the normal event's drops and values, and step 4 says so;
//   - endless mode's merge energy is held so it cannot pay for itself;
//   - a play link with no Recompletion ends at rank 12;
//   - the Syntax sheets hold the normal list and Recompletion together.
// Run: npx vite-node scripts/e2e/real-play.mjs
import { createBoard, withListPhase } from '../../src/features/merge/lib/core/board.js'
import { withBlankCoinValues } from '../../src/features/merge/lib/rewards/rewardChain.js'
import { buildEvent, segmentBuildInputs, rcInputsOnMainDraft, boardsWithDraftApplied } from '../../src/features/merge/lib/build/eventBuild.js'
import { encodeStage } from '../../src/features/merge/lib/share/stageShare.js'
import { BASE, createChecker, launch, openMerge, tab, ladderBoard, syntaxView } from './helpers.mjs'

const { ok, finish } = createChecker()
const SHOT = process.env.E2E_SCREENSHOT_DIR ?? null
const shot = async (page, name) => SHOT && page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: true })
const step = (page, id) => page.locator(`[data-step="${id}"]`)
const num = (text) => Number(String(text).replace(/,/g, '').match(/-?\d+(\.\d+)?/)?.[0])

function chain(values, rc = false) {
  return values.map((v, i) => {
    let b = createBoard(`Board ${i + 1}`, { rows: i === 0 ? 5 : 3, cols: 8 })
    const from = i === 0 ? 3 : 1
    b.tiles = b.tiles.map((row, r) => row.map(() => (r >= from ? 'blocked' : 'open')))
    if (i === 0) b.tiles[2][4] = 'semi'
    b.blockedValue = v
    b.minDropRank = 6
    b.rewardChainConfig = withBlankCoinValues(b.rewardChainConfig)
    if (rc) b = withListPhase({ ...b, minRank: 3, maxRank: 13 }, 'rc')
    return b
  })
}

// A whole event, built here the way the Build event flow builds it, and saved
// as the applied design: the normal list (subsidy 1300) and its Recompletion.
const rewardTargets = { main: { coins: 3, puzzles: 300, energy: 200, charms: 400 }, rc: { coins: 4, puzzles: 500, energy: 300, charms: 600 } }
const raw = [{ name: 'Base', mainBoards: chain([150, 520, 630]), rcBoards: chain([300, 1500, 1800, 1796], true), rewardTargets, segmentFactor: 1, sourceAllocation: {} }]
console.log('building the event...')
const mainDraft = await buildEvent({ phase: 'main', segments: segmentBuildInputs(raw, 'main') })
const rcDraft = await buildEvent({ phase: 'rc', segments: rcInputsOnMainDraft(raw, mainDraft) })
const mainBoards = boardsWithDraftApplied(raw[0].mainBoards, mainDraft.segments[0], mainDraft.shared, { draft: mainDraft }).map((b) => ({ ...b, rewardRanks: [5, 12], rewardSyntax: { 5: 'e2e-rank-5', 12: 'e2e-grand-prize' } }))
const rcBoards = boardsWithDraftApplied(raw[0].rcBoards, rcDraft.segments[0], rcDraft.shared, { draft: rcDraft }).map((b) => ({ ...b, rewardRanks: [14], rewardSyntax: { 14: 'e2e-second-grand-prize' } }))
const queueLength = (list) => list.reduce((n, b) => n + b.blockedQueue.length, 0)

const { browser, page, errors } = await launch({ save: { segments: [{ name: 'Base', boards: mainBoards, recompletionBoards: rcBoards, rewardTargets }] } })
await openMerge(page)

console.log('--- 1. Syntax: the normal list and Recompletion in the same sheets ---')
{
  await tab(page, 'Syntax').click()
  await page.waitForTimeout(400)
  const view = async (label) => {
    await syntaxView(page, label)
    await page.waitForTimeout(250)
  }
  const rows = async () => page.locator('table tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())))
  const head = async () => page.locator('table thead th').evaluateAll((ths) => ths.map((th) => th.innerText.trim()))
  const sheets = await page.getByTestId('syntax-view').locator('option').evaluateAll((options) => options.map((o) => o.textContent.trim()))
  ok(`one event: no "Recompletion Blocked Queue", "RC Small Rewards Bank" or "RC Small Reward Weights" sheet (${sheets.length} sheets in the dropdown)`, !sheets.includes('Recompletion Blocked Queue') && !sheets.some((name) => /^RC Small/.test(name)) && sheets.filter((name) => name === 'Blocked Queue').length === 1)

  await view('Generator Weights')
  const gw = await rows()
  const ranks = [...new Set(gw.map((r) => Number(r[0])))]
  ok(`Generator Weights runs to rank 14 and no further (${gw.length} rows, ranks ${ranks[0]} to ${ranks.at(-1)})`, ranks.at(-1) === 14 && ranks.includes(13) && gw.filter((r) => r[0] === '13').map((r) => r[1]).join(',') === '1,2,4' && gw.filter((r) => r[0] === '14').map((r) => r[1]).join(',') === '1,2,4')
  const gwHead = await head()
  ok(`...with a column for every rank up to T14 (${gwHead.slice(-2).join(', ')})`, gwHead.at(-1) === 'T14 weight' && gwHead.length === 16)
  ok('...and the rank 13 and 14 rows carry weights like every other row (1000 in all)', gw.filter((r) => Number(r[0]) >= 13).every((r) => r.slice(2).reduce((a, v) => a + Number(v), 0) === 1000))
  await shot(page, 'syntax-generator-weights')

  await view('Blocked Queue')
  const queue = await rows()
  const nMain = queueLength(mainBoards)
  const nRc = queueLength(rcBoards)
  ok(`Blocked Queue holds the normal entries and then Recompletion's (${nMain} + ${nRc} = ${queue.length} rows)`, queue.length === nMain + nRc && nRc > 0)
  ok('...numbered straight on, with no restart where Recompletion begins', queue.every((r, i) => Number(r[0]) === i + 1 && Number(r[1]) === i + 1))
  ok(`...and what follows the last normal entry is Recompletion's first (${queue[nMain][2]})`, String(queue[nMain][2]) === String(rcBoards[0].blockedQueue[0]))

  await view('Item Ladder')
  const ladder = await rows()
  ok(`Item Ladder is one ladder of 14 tiers (${ladder.length} rows)`, ladder.length === 14 && ladder[12][1] === 'item-t13' && ladder[13][1] === 'item-t14')
  ok('...tiers 1 to 12 with the normal list\'s milestone rewards, 13 and 14 with Recompletion\'s', ladder[4][2] === 'e2e-rank-5' && ladder[11][2] === 'e2e-grand-prize' && ladder[12][2] === '' && ladder[13][2] === 'e2e-second-grand-prize')

  await view('Small Reward Weights')
  const weights = await rows()
  ok(`Small Reward Weights is one table over merge tiers 2 to 14 (${weights.length} rows)`, weights.map((r) => r[0]).join(',') === '2,3,4,5,6,7,8,9,10,11,12,13,14')
  ok('...and each of the rank 13 and 14 merges drops one container, always (1000, no NoDrop)', weights.slice(-2).every((r) => Number(r.at(-1)) === 0 && r.slice(1, -1).filter((v) => Number(v) === 1000).length === 1))
  const columns = (await head()).length - 2
  await view('Small Rewards Bank')
  const bank = await rows()
  ok(`Small Rewards Bank has a container for every weights column (${bank.length})`, bank.length === columns && new Set(bank.map((r) => r[1])).size === bank.length)
  await view('Small Rewards')
  const values = await rows()
  const valueOf = (key) => num(values.find((r) => r[0] === key)?.[1].match(/:([\d.]+)/)?.[1])
  ok(`Small Rewards carries the round values the build gave (puzzle ${[1, 2, 3, 4].map((k) => valueOf(`puzzle-r${k}`)).join('/')}, charm ${[1, 2, 3, 4].map((k) => valueOf(`charm-r${k}`)).join('/')})`, ['puzzle', 'charm', 'dr'].every((key) => valueOf(`${key}-r2`) >= 2 * valueOf(`${key}-r1`) && valueOf(`${key}-r3`) >= 2 * valueOf(`${key}-r2`) && valueOf(`${key}-r4`) > 2 * valueOf(`${key}-r3`) && (valueOf(`${key}-r4`) % 5 === 0 || valueOf(`${key}-r4`) < 10)))
  await shot(page, 'syntax-small-rewards')

  // Nothing is written twice on a page (economist: "in alot of pages we got many duplicants of think we dont need").
  await view('V2 Reward Chain')
  const chainRows = await rows()
  ok(`V2 Reward Chain lists every rank value once, for the normal event and Recompletion together (${chainRows.length} rows, List "${chainRows[0][0]}")`, chainRows.length === 20 && chainRows.every((r) => r[0] === 'Main + RC') && new Set(chainRows.map((r) => r[3])).size === 20)
  await view('V2 Drop Groups')
  const dropRows = await rows()
  const ranksUnder = (label) => [...new Set(dropRows.filter((r) => r[0] === label).map((r) => r[1]))].join(',')
  ok(`V2 Drop Groups lists each rank once: ranks ${ranksUnder('Main + RC')} for both, ${ranksUnder('RC')} for Recompletion alone`, ranksUnder('Main + RC') === '6,7,8,9,10,11,12' && ranksUnder('RC') === '13,14' && !dropRows.some((r) => r[0] === 'Main') && !dropRows.some((r) => r[3] === '0'))
  await view('Normal')
  const normalText = await page.locator('pre').first().innerText()
  ok('the Normal view says what the whole list shares once, at the top, and writes reward items by their key', normalText.startsWith('ALL BOARDS: targetEv=') && (normalText.match(/REWARDS:/g) ?? []).length === 1 && (normalText.match(/targetEv=/g) ?? []).length === 1 && /coin-r1/.test(normalText) && !/R100\d/.test(normalText))
  await view('CC')
  const ccText = await page.locator('pre').first().innerText()
  ok('the CC view says the lucky-drop bumps once, not under every board', (ccText.match(/EV \+8%/g) ?? []).length === 1 && (ccText.match(/QUEUE \+30%/g) ?? []).length === 3)
  // The all-segments workbook: what every segment shares is written once.
  const ExcelJS = (await import('exceljs')).default
  // (A switch beside the export buttons says what a download holds: the segment shown, or all of them.)
  await page.locator('[data-scope="all"]').click()
  await page.waitForTimeout(150)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download combined workbook' }).click()])
  const combined = new ExcelJS.Workbook()
  await combined.xlsx.readFile(await download.path())
  const sheetRows = (name) => {
    const out = []
    combined.getWorksheet(name).eachRow((row) => out.push(row.values.slice(1)))
    return out.slice(1)
  }
  const gwAll = sheetRows('Generator Weights')
  ok(`the all-segments workbook writes the generator weights once for all eight segments (${gwAll.length} rows, Segment "${gwAll[0][0]}")`, gwAll.length === 27 && gwAll.every((r) => r[0] === 'All'))
  ok('...Event Data and Multipliers too', sheetRows('Event Data').length === 14 && sheetRows('Event Data').every((r) => r[0] === 'All') && sheetRows('Multipliers').length === 3)
  const tabNames = combined.worksheets.map((w) => w.name)
  ok('...and the one drop table as one tab, with each segment\'s own Small Rewards', tabNames.filter((n) => /V2 Drop Groups/.test(n)).join() === 'V2 Drop Groups' && tabNames.includes('S1 Small Rewards') && tabNames.includes('S8 Small Rewards') && !tabNames.some((n) => /^RC Small|RC Blocked|RC Item/.test(n)))
}

console.log('--- 2. Step 6 and 7: round values, how close each player lands, and the same event played by different players ---')
const build = async () => {
  await page.getByTestId('build-configuration').click()
  await page.getByTestId('build-configuration').waitFor({ state: 'visible', timeout: 540000 })
  await page.waitForTimeout(600)
}
const validate = async () => {
  await step(page, 'finalize').click()
  await page.waitForTimeout(300)
  await page.getByTestId('finalize-validate').click()
  await page.getByTestId('play-styles').waitFor({ state: 'visible', timeout: 240000 })
  await page.waitForTimeout(300)
}
const styles = async () =>
  page.locator('[data-testid="play-styles"] tbody tr').evaluateAll((trs) =>
    trs.map((tr) => ({
      id: tr.dataset.style,
      same: tr.dataset.same,
      text: tr.querySelector('td')?.innerText.replace(/\s+/g, ' ').trim(),
      pct: Object.fromEntries([...tr.querySelectorAll('[data-reward]')].map((td) => [td.dataset.reward, td.querySelector('[data-field="pct"]')?.innerText.trim()])),
      dr: tr.querySelector('[data-field="dr"]')?.innerText.replace(/\s+/g, ' ').trim(),
    })),
  )
{
  await tab(page, 'Build event').click()
  await page.waitForTimeout(300)
  // Step 4: "Every merge of a rank drops the same items" is on unless switched off.
  await step(page, 'rewards').click()
  await page.waitForTimeout(400)
  const steadySwitch = page.locator('[data-field="steady-drops"]')
  ok('step 4 has "Every merge of a rank drops the same items", switched on', (await steadySwitch.isChecked()) && /Every merge of a rank drops the same items/.test(await page.getByTestId('steady-drops').innerText()))
  await step(page, 'build').click()
  await page.waitForTimeout(300)
  await build()
  const note = page.getByTestId('rank-values-note')
  const given = await page.locator('[data-rank-values]').evaluateAll((els) => els.map((el) => ({ type: el.dataset.rankValues, to: el.querySelector('[data-field="to"]')?.innerText.trim() })))
  const parts = (text) => text.split('/').map((x) => Number(x.trim()))
  ok(`step 6 shows the rank values the build gave this segment (${given.map((g) => `${g.type} ${g.to}`).join('; ')})`, (await note.isVisible()) && given.length >= 2 && /its own\s+four rank values/.test((await note.innerText()).replace(/\s+/g, ' ')))
  ok('...round amounts, each rank at least double the one below and rank 4 more than twice rank 3', given.every((g) => { const v = parts(g.to); return v.length === 4 && v.every((x) => Number.isInteger(x) && (x < 10 || x % 5 === 0)) && v[1] >= 2 * v[0] && v[2] >= 2 * v[1] && v[3] > 2 * v[2] }))
  const predicted = await page.locator('[data-testid="review-resources"] [data-resource]').count()
  await validate()
  const table = await page.locator('[data-validation]').evaluateAll((trs) => trs.map((tr) => ({ type: tr.dataset.validation, cells: [...tr.querySelectorAll('td')].map((td) => td.innerText.trim()) })))
  const off = table.map((r) => ({ type: r.type, pct: (100 * Number(r.cells[3].replace(/,/g, ''))) / Number(r.cells[1].replace(/,/g, '')) }))
  ok(`the 300-player check lands every reward near its amount (${off.map((r) => `${r.type} ${Math.round(r.pct)}%`).join(', ')})`, off.length === 4 && off.every((r) => Math.abs(r.pct - 100) <= 15) && predicted >= 0)
  // How close is ONE player: the share of players near each amount, and near all of them at once.
  const nearCells = await page.locator('[data-validation] [data-cell="near"]').evaluateAll((tds) => tds.map((td) => td.innerText.trim()))
  ok(`step 7 says how many players land within 15% of each amount (${nearCells.join(', ')})`, nearCells.length === 4 && nearCells.every((t) => /^\d+ of 100$/.test(t)) && /Players within 15%/i.test(await page.getByTestId('validation-table').innerText()))
  const closeness = page.getByTestId('validation-closeness')
  const allNear = num(await closeness.locator('[data-field="all-near"]').innerText())
  ok(`...and how many are near on every reward at once: nearly all, because every merge of a rank drops the same items ("${(await closeness.innerText()).replace(/\s+/g, ' ').slice(0, 110)}...")`, allNear >= 90 && /every reward at once/.test(await closeness.innerText()) && /drops the same items in this build/.test(await closeness.innerText()))
  ok('...checked on 300 players who each roll their own lucky drops', /300 simulated players, each rolling their own lucky drops/.test(await page.getByText(/simulated players, each rolling/).first().innerText()))
  const rowList = await styles()
  const rows = [rowList.find((r) => r.id === 'merge'), rowList.find((r) => r.id === 'best'), rowList.find((r) => r.id === 'all')]
  const carelessRow = rowList.find((r) => r.id === 'careless')
  ok(`the validation shows four players (${rowList.map((r) => r.text.slice(0, 40)).join(' | ')})`, rowList.map((r) => r.id).join(',') === 'merge,careless,best,all' && /the player the build sizes for/.test(rows[0].text))
  ok(`...one of them merging without looking, with what that costs in DR (${carelessRow?.dr} against ${rows[0].dr})`, !!carelessRow && /Merges without looking/.test(carelessRow.text) && num(carelessRow.dr) >= num(rows[0].dr) * 0.95)
  ok(`with the values the build gave, tapping never pays more: that player is the first (${rows[1].text.slice(46, 130)})`, rows[1].same === 'yes' && JSON.stringify(rows[1].pct) === JSON.stringify(rows[0].pct) && (await page.getByTestId('play-styles-tap').count()) === 0 && (await page.getByText('Merging pays best', { exact: true }).count()) === 1)
  const drNote = page.getByTestId('play-styles-dr')
  ok(`the player who taps everything spends far more DR, and it says why (${rows[2].dr})`, num(rows[2].dr) > num(rows[0].dr) * 1.25 && (await drNote.isVisible()) && /never clears/.test(await drNote.innerText()) && /shared play link taps are free/.test(await drNote.innerText()))
  await page.getByTestId('play-styles').scrollIntoViewIfNeeded()
  await shot(page, 'three-ways')

  // The model switched off: the reference values stay, and tapping pays more.
  await step(page, 'rewards').click()
  await page.waitForTimeout(400)
  await page.locator('[data-field="rank-values-by-build"]').uncheck()
  await page.waitForTimeout(300)
  await step(page, 'build').click()
  await page.waitForTimeout(300)
  await build()
  ok('with "The build may change a reward\'s rank values" off, step 6 shows no values given', (await page.getByTestId('rank-values-note').count()) === 0)
  await validate()
  const typedList = await styles()
  const typed = [typedList.find((r) => r.id === 'merge'), typedList.find((r) => r.id === 'best')]
  const more = (t) => num(typed[1].pct[t]) / num(typed[0].pct[t])
  ok(`then the player who taps when it pays gets more puzzles and charms out of the same event (${typed[1].pct.puzzles} against ${typed[0].pct.puzzles}, ${typed[1].pct.charms} against ${typed[0].pct.charms})`, typed[1].same === 'no' && more('puzzles') > 1.03 && more('charms') > 1.03 && Math.max(more('puzzles'), more('charms')) > 1.15)
  const tapNote = page.getByTestId('play-styles-tap')
  ok(`...and it says where, and what to do ("${(await tapNote.innerText()).replace(/\s+/g, ' ').slice(0, 96)}...")`, (await tapNote.isVisible()) && /Puzzles \(rank 2\)/.test(await tapNote.innerText()) && /Charms \(rank 3\)/.test(await tapNote.innerText()) && /Let the build give/.test((await tapNote.innerText()).replace(/\s+/g, ' ')) && (await page.getByText('Tapping pays more', { exact: true }).count()) === 1)
  await page.getByTestId('play-styles').scrollIntoViewIfNeeded()
  await shot(page, 'three-ways-typed')
}

console.log('--- 3. Recompletion and endless ---')
{
  const preview = page.locator('[data-testid="endless-preview"]')
  await preview.scrollIntoViewIfNeeded()
  const energy = (await preview.locator('[data-testid="endless-energy"]').innerText()).replace(/\s+/g, ' ')
  const back = num(energy.match(/paying back about ([\d,.]+) merge energy/)?.[1])
  ok(`the endless drops pay back at most 50 merge energy per 100 DR (${back}), with no "pays for itself" warning`, back > 0 && back <= 50.5 && !/would pay for itself/.test(energy))
  // Step 4 of the Recompletion phase says whose drops and values it plays.
  await page.getByRole('button', { name: 'Recompletion', exact: true }).last().click()
  await page.waitForTimeout(400)
  await step(page, 'rewards').click()
  await page.waitForTimeout(400)
  const oneTable = page.getByTestId('rc-one-table')
  ok(`step 4 of Recompletion says it plays the normal event's drops and rank values ("${(await oneTable.innerText()).replace(/\s+/g, ' ').slice(0, 70)}...")`, (await oneTable.isVisible()) && /one drop table and one set of rank values/.test((await oneTable.innerText()).replace(/\s+/g, ' ')) && /rank 13 and 14/.test(await oneTable.innerText()))
  await shot(page, 'rc-step-4')
}

console.log('--- 4. A play link with no Recompletion ends at rank 12 ---')
{
  // A ladder board: one generator tap and eleven merges make rank 12.
  const ladder = ladderBoard('Main 1', 11, { targetEv: 1 })
  await page.goto(`${BASE}?play&stage=${encodeStage([ladder])}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const generator = page.locator('[data-tutorial="generate-button"]')
  ok('the stage opens and the generator works', (await generator.isEnabled()) && (await page.locator('[data-cell]').count()) === 22)
  await generator.click()
  await page.waitForTimeout(400)
  await page.locator('[data-cell][title="rank 1"]').first().click()
  await page.locator('[data-cell="1-0"]').click()
  for (let k = 0; k < 10; k++) {
    await page.locator(`[data-cell="1-${k}"]`).click()
    await page.locator(`[data-cell="1-${k + 1}"]`).click()
  }
  await page.waitForTimeout(600)
  const finished = page.getByTestId('stage-finished').first()
  ok(`at rank 12 the stage says the event is complete ("${(await finished.innerText()).replace(/\s+/g, ' ').slice(0, 70)}...")`, (await finished.isVisible()) && /event is complete/.test(await finished.innerText()))
  ok('...and the generator has stopped', await generator.isDisabled())
  await shot(page, 'stage-finished')
}

ok('zero page errors', errors.length === 0)
await browser.close()
process.exit(finish('REAL PLAY AND ONE-EVENT SHEETS') === 0 ? 0 : 1)
