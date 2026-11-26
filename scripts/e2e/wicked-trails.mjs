// Wicked Trails in the browser: segments taken from a generic set, the DR per Brut Win typed, the rules, tiers and
// prizes beside their target worth, another segment's prizes scaled by its effort, and the mock played to the end.
// Run: npx vite-node scripts/e2e/wicked-trails.mjs
import { BASE, createChecker, launch } from './helpers.mjs'

const { ok, finish } = createChecker()
const { browser, page, errors } = await launch()
page.on('dialog', (d) => d.accept())
const set = async (locator, value) => {
  await locator.fill(String(value))
  await locator.blur()
  await page.waitForTimeout(200)
}
const text = async (locator) => (await locator.innerText()).trim()

// A generic segment set, 2D_Levels, three bands with their effort.
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByRole('link', { name: /Economy/ }).first().click()
await page.getByTestId('economy-header').waitFor()
await page.locator('[data-tab="segments"]').click()
await page.locator('[data-seg-view="build"]').click()
await set(page.getByTestId('economy-seg-feature'), '')
await set(page.getByTestId('economy-seg-cuts'), '9, 18')
await page.getByTestId('economy-set-name').fill('2D_Levels')
await page.getByTestId('economy-set-save').click()
await page.waitForTimeout(300)
await page.locator('[data-seg-view="sets"]').click()
const effort = (id) => page.locator(`[data-set-segment="${id}"] [data-set-effort]`)
await set(effort('BW_0_9'), 100)
await set(effort('BW_9_18'), 200)
await set(effort('BW_18_Plus'), 300)

// Wicked Trails, from the home page.
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByRole('link', { name: /Wicked Trails/ }).first().click()
await page.getByTestId('wt-header').waitFor()
ok('Wicked Trails opens from the home page, on its segments', (await page.locator('[data-wt-view="segments"]').getAttribute('aria-selected')) === 'true')
const picker = page.getByTestId('wt-segment-set')
await picker.selectOption(await picker.locator('option', { hasText: '2D_Levels' }).getAttribute('value'))
await page.waitForTimeout(300)
const names = await page.locator('[data-wt-segment] td:nth-child(2) div:first-child').allInnerTexts()
ok(`the set's segments, named Wicked_Trails_ (${names.join(', ')})`, names.length === 3 && names[0] === 'Wicked_Trails_BW_0_9' && /Wicked_Trails_/.test(await text(page.getByTestId('wt-segments-message'))))
ok('their efforts came with them', (await page.locator('[data-wt-segment="0"] [data-field="effort-bw"]').inputValue()) === '100' && (await page.locator('[data-wt-segment="2"] [data-field="effort-bw"]').inputValue()) === '300')
for (const i of [0, 1, 2]) {
  await set(page.locator(`[data-wt-segment="${i}"] [data-field="silver-per-bw"]`), 2)
  await set(page.locator(`[data-wt-segment="${i}"] [data-field="gold-per-bw"]`), 3)
}

// The prizes.
await page.locator('[data-wt-view="prizes"]').click()
await page.waitForTimeout(300)
ok('the ROE is asked for first', /Type the ROE/.test(await text(page.getByTestId('wt-problems'))))
await set(page.locator('[data-rule="roe"]'), 1)
await set(page.locator('[data-rule="easyShare"]'), 50)
await set(page.locator('[data-tier-count="easy"]'), 2)
await set(page.locator('[data-tier-count="hard"]'), 2)
ok('nothing left to fix', (await page.getByTestId('wt-problems').count()) === 0)
const target = (lane, i) => text(page.locator(`[data-tier="${lane}-${i}"] [data-field="target"]`))
const dr = (lane, i) => text(page.locator(`[data-tier="${lane}-${i}"] [data-field="dr"]`))
console.log(`      easy ${await dr('easy', 0)}/${await dr('easy', 1)} DR, targets ${await target('easy', 0)}, ${await target('easy', 1)} | hard ${await dr('hard', 0)}/${await dr('hard', 1)} DR, targets ${await target('hard', 0)}, ${await target('hard', 1)}`)
ok('easy tiers: 50 silver each, 12.5 earned, 80% kept: 10', (await dr('easy', 0)) === '50' && (await target('easy', 0)) === '10' && (await target('easy', 1)) === '10')
ok('hard tiers: 150 gold each (100 BW x 3); 25 while sharing and 50 alone, 60% kept: 15 and 30', (await dr('hard', 0)) === '150' && (await target('hard', 0)) === '15' && (await target('hard', 1)) === '30')
ok('the Final Prize: pool 35 (20% of 25 + 40% of 75), worth to aim for 70', (await text(page.locator('[data-field="pool"]'))) === '35' && (await text(page.locator('[data-field="final-target"]'))) === '70')
await set(page.locator('[data-prize-input="easy-0"]'), 'free_undo:40')
const gap = await text(page.locator('[data-prize-gap="easy-0"]'))
ok(`a prize typed shows its worth and how far from the target (${gap})`, /^10 \(0, 0%\)$/.test(gap))
await set(page.locator('[data-prize-input="final"]'), 'free_wild:20+free_undo:80')
ok(`the Final Prize's worth against 70 (${await text(page.locator('[data-prize-gap="final"]'))})`, /^70 /.test(await text(page.locator('[data-prize-gap="final"]'))))
await page.locator('[data-wt-chip="1"]').click()
await page.waitForTimeout(200)
ok('another segment: its prize is the base\'s x its effort against the base\'s (200 / 100)', (await page.locator('[data-prize-input="easy-0"]').inputValue()) === 'free_undo:80' && (await page.locator('[data-from-base]').count()) >= 1 && (await target('easy', 0)) === '20')

// The mock, for the base.
await page.locator('[data-wt-view="mock"]').click()
await page.waitForTimeout(200)
await page.locator('[data-wt-chip="0"]').click()
await page.getByTestId('wt-mock-bw').fill('30')
await page.waitForTimeout(200)
const bar = (id) => text(page.locator(`[data-mock-bar="${id}"]`))
ok(`after 30 Brut Wins: easy tier 1 done, 10 of 50 into tier 2; hard 90 of 150 into tier 1 (${await bar('easy-1')}, ${await bar('hard-0')})`, (await bar('easy-0')) === '' && (await bar('easy-1')) === '10/50' && (await bar('hard-0')) === '90/150' && (await bar('hard-1')) === '0/150' && (await text(page.getByTestId('wt-mock-lanes-done'))) === '0/2')
ok('the mock shows the prizes typed', /Undo/.test(await text(page.locator('[data-mock-lane="easy"]'))) && /Wild/.test(await text(page.locator('[data-mock-final]'))))
await page.getByTestId('wt-mock-bw').fill('100')
await page.waitForTimeout(200)
ok('after the whole effort both lanes are done: 2/2', (await text(page.getByTestId('wt-mock-lanes-done'))) === '2/2')

// Kept.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(300)
await page.locator('[data-wt-view="prizes"]').click()
ok('after a reload the rules and prizes are kept', (await page.locator('[data-rule="roe"]').inputValue()) === '1' && (await page.locator('[data-prize-input="easy-0"]').inputValue()) === 'free_undo:40')
ok(`no page error (${errors.join(' | ').slice(0, 200)})`, errors.length === 0)
await browser.close()
process.exit(finish('WICKED TRAILS') ? 1 : 0)
