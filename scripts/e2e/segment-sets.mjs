// Segment sets: the flow saved as a set on the Economy page, every set's efforts edited in one place, a set picked in
// Merge's step 1 (copied with its efforts), the set changed afterwards and its new numbers taken.
// Run: npx vite-node scripts/e2e/segment-sets.mjs
import { BASE, createChecker, launch, tab } from './helpers.mjs'

const { ok, finish } = createChecker()
const { browser, page, errors } = await launch()
page.on('dialog', (d) => d.accept())
const set = async (locator, value) => {
  await locator.fill(String(value))
  await locator.blur()
  await page.waitForTimeout(250)
}
const openEconomySegments = async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('link', { name: /Economy/ }).first().click()
  await page.getByTestId('economy-header').waitFor()
  await page.locator('[data-tab="segments"]').click()
  await page.waitForTimeout(300)
}

// The Economy page: a set from the flow.
await openEconomySegments()
ok('the Segments tab has the segment sets, none yet', (await page.getByTestId('economy-segment-sets').count()) === 1 && (await page.getByTestId('economy-sets-empty').count()) === 1)
await set(page.getByTestId('economy-seg-feature'), 'Disco')
await set(page.getByTestId('economy-seg-cuts'), '1000, 2500')
await page.getByTestId('economy-set-name').fill('Level features, 2 days')
await page.getByTestId('economy-set-save').click()
await page.waitForTimeout(300)
const sets = page.getByTestId('economy-segment-sets')
ok(`the flow is saved as a set (${await page.getByTestId('economy-set-message').innerText()})`, (await sets.locator('[data-set]').count()) === 1 && (await sets.locator('[data-set-segment]').count()) === 3)
ok('a set keeps its segments without the feature in their names', (await sets.locator('[data-set-segment="BW_0_1000"]').count()) === 1)
await page.getByTestId('economy-set-name').fill('Weekend features')
await page.getByTestId('economy-set-save').click()
await page.waitForTimeout(300)
ok('a second set', (await sets.locator('[data-set]').count()) === 2)
// Every set's efforts in one place.
const effort = (setIndex, id) => sets.locator('[data-set]').nth(setIndex).locator(`[data-set-segment="${id}"] [data-set-effort]`)
await set(effort(0, 'BW_0_1000'), 40)
await set(effort(0, 'BW_1000_2500'), 90)
await set(effort(1, 'BW_0_1000'), 25)
ok('efforts of both sets are typed on the same card', (await effort(0, 'BW_0_1000').inputValue()) === '40' && (await effort(1, 'BW_0_1000').inputValue()) === '25')
await page.reload({ waitUntil: 'networkidle' })
await page.locator('[data-tab="segments"]').click().catch(() => {})
await page.waitForTimeout(300)
ok('the sets and their efforts are kept after a reload', (await effort(0, 'BW_1000_2500').inputValue()) === '90')

// Merge: the set picked.
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByText('Merge Mania', { exact: false }).first().click()
await page.waitForTimeout(300)
await tab(page, 'Build event').click()
await page.waitForTimeout(400)
const picker = page.getByTestId('merge-segment-set')
const options = await picker.locator('option').allInnerTexts()
ok(`step 1 offers the sets in a list (${options.join(' / ')})`, options.some((o) => /Level features, 2 days - 3 segments/.test(o)) && options.some((o) => /Weekend features/.test(o)))
const levelId = await picker.locator('option', { hasText: 'Level features' }).getAttribute('value')
await picker.selectOption(levelId)
await page.waitForTimeout(500)
ok(`picking it copies the segments (${await page.getByTestId('merge-segments-message').innerText()})`, /3 segments taken from "Level features, 2 days", 2 with an effort/.test(await page.getByTestId('merge-segments-message').innerText()))
const rows = await page.locator('[data-testid="setup-segments"] [data-setup-segment]').evaluateAll((trs) =>
  trs.map((tr) => ({ name: tr.querySelector('button')?.innerText.trim(), effort: tr.querySelector('[data-field="effort-bw"]')?.value, condition: tr.querySelector('[data-field="condition"]')?.innerText })),
)
console.log(`      ${rows.map((r) => `${r.name}=${r.effort}`).join(' | ')}`)
ok('Merge\'s names, conditions and the efforts in Brut Wins', rows.length === 3 && rows[0].name === 'Merge_BW_0_1000' && rows[0].effort === '40' && rows[1].effort === '90' && rows[2].effort === '' && rows.every((r) => !!r.condition))
ok('the flow below holds the set\'s flow, with Merge\'s name', (await page.getByTestId('economy-seg-feature').inputValue()) === 'Merge' && (await page.getByTestId('economy-seg-cuts').inputValue()) === '1000, 2500')
ok('nothing says the set changed', (await page.getByTestId('merge-set-changed').count()) === 0)
await page.locator('header').getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForTimeout(300)

// The set changed on the Economy page: the event keeps its copy until told.
await openEconomySegments()
await set(effort(0, 'BW_0_1000'), 55)
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByText('Merge Mania', { exact: false }).first().click()
await page.waitForTimeout(300)
await tab(page, 'Build event').click()
await page.waitForTimeout(400)
const first = () => page.locator('[data-setup-segment="0"] [data-field="effort-bw"]').inputValue()
ok('the event keeps its copy (40) and says the set changed since', (await first()) === '40' && (await page.getByTestId('merge-set-changed').count()) === 1)
await page.getByTestId('merge-set-retake').click()
await page.waitForTimeout(400)
ok('"Take its new numbers" brings 55 in, and the notice goes', (await first()) === '55' && (await page.getByTestId('merge-set-changed').count()) === 0)
ok(`no page error (${errors.join(' | ').slice(0, 200)})`, errors.length === 0)
await browser.close()
process.exit(finish('SEGMENT SETS') ? 1 : 0)
