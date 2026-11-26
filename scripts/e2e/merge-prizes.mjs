// Merge Mania's segments and prizes: step 1 "Segments" (the segment plan, the worth of one merge DR, the base
// segment of the prizes) and step 5 "Prizes" (each marked rank's worth from one playthrough of the base, the prize
// typed, its worth and the difference, live; another segment's worth and prize scaled by its multiplier), then the
// Item Ladder sheet of each segment and a reload. Run: npx vite-node scripts/e2e/merge-prizes.mjs
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { createChecker, launch, openMerge, tab, syntaxView, selectSegment } from './helpers.mjs'

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
  if (index === 0) {
    b.rewardRanks = [8, 10, 12]
    b.rewardSyntax = { 10: 'allowance(coins:5)' }
  }
  return b
}
const boards = () => [blankBoard('Board 1', 0, 150), blankBoard('Board 2', 1, 500), blankBoard('Board 3', 2, 600)]
const { browser, page, errors } = await launch({
  save: { segments: [{ name: 'Segment 1', boards: boards() }, { name: 'Segment 2', boards: boards(), segmentFactor: 1.5 }] },
})
await openMerge(page)
await tab(page, 'Build event').click()
await page.waitForTimeout(400)

const labels = await page.locator('[data-step]').allInnerTexts()
ok(`the flow has six steps, Segments first and Prizes after Build (${labels.map((l) => l.replace(/^\d+\s*/, '')).join(' | ')})`, labels.length === 6 && /Segments/.test(labels[0]) && /Prizes/.test(labels[4]) && /Build/.test(labels[3]))

// Step 1: the segment plan and the worth of one merge DR.
ok('step 1 holds the segment builder and the worth of one merge DR', (await page.getByTestId('merge-segments').count()) === 1 && (await page.getByTestId('merge-dr-worth').count()) === 1)
await set(page.getByTestId('economy-seg-cuts'), '2500')
await page.waitForTimeout(300)
await page.getByTestId('merge-use-segments').click()
await page.waitForTimeout(400)
const message = await page.getByTestId('merge-segments-message').innerText()
ok(`"Use these segments" names Merge's segments from the plan (${message.slice(0, 90)})`, /2 segments named/.test(message))
const names = await page.locator('[data-testid="setup-segments"] [data-setup-segment]').evaluateAll((trs) => trs.map((tr) => tr.querySelector('td')?.innerText.replace(/\s+/g, ' ').trim()))
ok(`each segment shows its name and condition (${names.join(' / ').slice(0, 160)})`, names.length >= 2 && names.every((n) => /BW|Brut|fn_|>|</.test(n)))
await set(page.getByTestId('merge-dr-worth'), 0.05)
ok('the prizes are worked out on Segment 1 by default', await page.locator('[data-setup-segment="0"] [data-field="prize-base"]').isChecked())

// Step 3 amounts, then build.
await step(page, 'rewards').click()
await page.waitForTimeout(300)
await set(page.locator('[data-target="coins"]'), 3)
await set(page.locator('[data-target="puzzles"]'), 300)
await set(page.locator('[data-target="energy"]'), 200)
await set(page.locator('[data-target="charms"]'), 400)
await step(page, 'build').click()
await page.waitForTimeout(300)
await page.getByTestId('build-configuration').click()
await page.getByTestId('build-configuration').waitFor({ state: 'visible', timeout: 540000 })
await page.waitForTimeout(600)

// Step 5: Prizes.
await step(page, 'prizes').click()
await page.waitForTimeout(800)
const rows = async () =>
  page.locator('[data-testid="prizes-table"] tbody tr').evaluateAll((trs) =>
    trs.map((tr) => ({
      rank: Number(tr.dataset.prizeRank),
      dr: tr.querySelector('[data-cell="dr"]')?.innerText.split('\n')[0].replace(/,/g, ''),
      worth: tr.querySelector('[data-cell="worth"]')?.innerText.replace(/,/g, ''),
      input: tr.querySelector('[data-prize-input]')?.value,
      fromBase: !!tr.querySelector('[data-from-base]'),
      prizeWorth: tr.querySelector('[data-cell="prize-worth"]')?.innerText.replace(/,/g, ''),
      gap: tr.querySelector('[data-cell="gap"]')?.innerText ?? '',
    })),
  )
let base = await rows()
console.log(`      base: ${base.map((r) => `r${r.rank} dr ${r.dr} worth ${r.worth}`).join(' | ')}`)
ok('the marked ranks 8, 10 and 12 are listed', base.map((r) => r.rank).join() === '8,10,12')
ok('each rank has the DR paid since the one before, and a worth of DR x 0.05', base.every((r) => Number(r.dr) > 0 && Math.abs(Number(r.worth) - Math.round(Number(r.dr) * 0.05 * 100) / 100) < 0.011))
await page.getByRole('button', { name: 'Start from them' }).click()
await page.waitForTimeout(300)
base = await rows()
ok(`"Start from them" brings step 3's milestone reward in (${base[1].input})`, base[1].input === 'allowance(coins:5)')
await page.locator('[data-prize-input="12"]').fill('allowance(coins:50)')
await page.waitForTimeout(300)
base = await rows()
const r12 = base.find((r) => r.rank === 12)
ok(`the prize's worth and how far it is from the rank's worth show at once (worth ${r12.worth}, prize ${r12.prizeWorth}, ${r12.gap})`, r12.prizeWorth === '50' && r12.gap.startsWith(Number(r12.worth) > 50 ? '-' : '+'))

await page.locator('[data-prize-segment="1"]').click()
await page.waitForTimeout(400)
let other = await rows()
ok(`Segment 2's worths are the base's x 1.5 (${other.map((r) => r.worth).join(', ')})`, other.every((r, i) => Math.abs(Number(r.worth) - Math.round(Number(base[i].worth) * 1.5 * 100) / 100) < 0.02))
ok(`Segment 2's prizes are the base's x 1.5, marked "from the base" (${other.map((r) => r.input).join(' / ')})`, other[1].input === 'allowance(coins:7.5)' && other[2].input === 'allowance(coins:75)' && other[1].fromBase)
await page.locator('[data-prize-input="12"]').fill('allowance(coins:60)')
await page.waitForTimeout(300)
other = await rows()
ok('a prize typed for Segment 2 is its own', other[2].input === 'allowance(coins:60)' && !other[2].fromBase && (await page.locator('[data-reset-to-base]').count()) === 1)

// The Item Ladder sheet of each segment.
await tab(page, 'Syntax').click()
await page.waitForTimeout(400)
await syntaxView(page, 'Item Ladder')
const ladderText = async () => (await page.locator('table').first().innerText()).replace(/\s+/g, ' ')
const ladder1 = await ladderText()
ok('Segment 1\'s Item Ladder carries its prizes', /allowance\(coins:5\)/.test(ladder1) && /allowance\(coins:50\)/.test(ladder1))
await selectSegment(page, 2)
await syntaxView(page, 'Item Ladder')
const ladder2 = await ladderText()
ok('Segment 2\'s Item Ladder carries its own prize and the base\'s scaled', /allowance\(coins:7\.5\)/.test(ladder2) && /allowance\(coins:60\)/.test(ladder2))

// Saved and opened again.
await page.locator('header').getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForTimeout(400)
await page.reload({ waitUntil: 'networkidle' })
await page.getByText('Merge Mania', { exact: false }).first().click().catch(() => {})
await page.waitForTimeout(400)
await tab(page, 'Build event').click()
await page.waitForTimeout(300)
await step(page, 'setup').click()
await page.waitForTimeout(300)
ok('after a reload the worth of one merge DR is kept', (await page.getByTestId('merge-dr-worth').inputValue()) === '0.05')
await step(page, 'prizes').click()
await page.waitForTimeout(800)
const after = await rows()
ok('after a reload the prizes are kept', after.find((r) => r.rank === 12)?.input === 'allowance(coins:50)')
ok(`no page error (${errors.join(' | ').slice(0, 200)})`, errors.length === 0)
await browser.close()
process.exit(finish('MERGE SEGMENTS AND PRIZES') ? 1 : 0)
