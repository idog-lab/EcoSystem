// "Your data in this browser" on the home screen: download everything from one
// browser, restore it in another that already has data of its own.
// Run: npx vite-node scripts/e2e/browser-data.mjs
import fs from 'node:fs'
import { BASE, createChecker, launch } from './helpers.mjs'

const { ok, finish } = createChecker()
const ev = (id, name, startDate) => ({ id, name, startDate, days: 7, savedAt: 1, createdAt: 1, segments: 1, size: 10 })
async function seed(page, items) {
  await page.goto(BASE)
  await page.evaluate((entries) => {
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v)
  }, items)
  await page.reload()
  await page.getByTestId('browser-data').waitFor()
}
const storage = (page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => /^(merge-mania|superplay-|economy-)/.test(k)).map((k) => [k, localStorage.getItem(k)])))

// The old site: two saved events, a project, a chef.
const old = await launch()
await seed(old.page, {
  'merge-mania-saved-events': JSON.stringify([ev('ev-a', 'Merge Mania 19-25 Nov 2026', '2026-11-19'), ev('ev-b', 'Black Friday test', '2026-11-27')]),
  'merge-mania-saved-event:ev-a': 'DATA-A',
  'merge-mania-saved-event:ev-b': 'DATA-B',
  'merge-mania-board-simulator': JSON.stringify({ segments: [] }),
  'merge-mania-chef': JSON.stringify({ old: true }),
})
ok('the home screen has the panel, with its two buttons', await old.page.getByTestId('data-download').isVisible() && await old.page.getByTestId('data-restore').isVisible())
const [download] = await Promise.all([old.page.waitForEvent('download'), old.page.getByTestId('data-download').click()])
// (Kept as bytes: the download goes with its browser.)
const fileBytes = fs.readFileSync(await download.path())
const file = { name: 'economy-toolkit-all-data.json', mimeType: 'application/json', buffer: fileBytes }
const saved = JSON.parse(fileBytes.toString('utf8'))
ok(`"Download all my data" gives one file with every key (${Object.keys(saved.items).length}) and says what to do next`, Object.keys(saved.items).length === 5 && saved.items['merge-mania-saved-event:ev-b'] === 'DATA-B' && /Restore all my data/.test(await old.page.getByTestId('data-message').innerText()))
await old.browser.close()

// The new site: one event of its own, its own project.
const fresh = await launch()
const p = fresh.page
await seed(p, {
  'merge-mania-saved-events': JSON.stringify([ev('ev-new', 'Made on the new site', '2026-12-01')]),
  'merge-mania-saved-event:ev-new': 'DATA-NEW',
  'merge-mania-board-simulator': JSON.stringify({ segments: ['new'] }),
})
await p.getByTestId('data-restore-file').setInputFiles({ name: 'not-ours.json', mimeType: 'application/json', buffer: Buffer.from('{"segments":[]}') })
ok('a file that is not one is refused, and nothing changes', /Import backup/.test(await p.getByTestId('data-message').innerText()) && !(await p.getByTestId('data-plan').isVisible()))
await p.getByTestId('data-restore-file').setInputFiles(file)
const plan = p.getByTestId('data-plan')
await plan.waitFor()
const planText = await plan.innerText()
console.log(`      ${planText.replace(/\s+/g, ' ').slice(0, 400)}`)
ok('before anything changes it says what the file holds: two events to add, the project here differs (a choice), Chef to add', /2 will be added/.test(planText) && (await plan.locator('[data-part="merge-project"]').getAttribute('data-state')) === 'differs' && (await plan.locator('[data-replace="merge-project"]').isChecked()) === false && (await plan.locator('[data-part="chef"]').getAttribute('data-state')) === 'add')
ok('...and nothing has changed yet', (await storage(p))['merge-mania-chef'] == null)
const [before] = await Promise.all([p.waitForEvent('download'), p.getByTestId('data-restore-confirm').click()])
const beforeFile = JSON.parse(fs.readFileSync(await before.path(), 'utf8'))
ok('what was here is downloaded first', beforeFile.items['merge-mania-saved-event:ev-new'] === 'DATA-NEW')
const after = await storage(p)
const list = JSON.parse(after['merge-mania-saved-events'])
ok(`restored: the list holds all three events, the project here is kept, Chef came in (${list.map((e) => e.name).join(' / ')})`, list.length === 3 && after['merge-mania-saved-event:ev-a'] === 'DATA-A' && after['merge-mania-board-simulator'] === JSON.stringify({ segments: ['new'] }) && after['merge-mania-chef'] === JSON.stringify({ old: true }))
ok(`it says what it did (${await p.getByTestId('data-message').innerText()})`, /2 saved Merge events added/.test(await p.getByTestId('data-message').innerText()) && /Chef/.test(await p.getByTestId('data-message').innerText()))

// The saved events are in the Merge switcher.
await p.getByRole('button', { name: /Merge Mania/ }).first().click()
await p.getByTestId('more-menu').waitFor()
await p.getByTestId('more-menu').click()
await p.getByTestId('saved-events-toggle').click()
await p.waitForTimeout(300)
const body = await p.locator('body').innerText()
ok('Merge lists the moved events in Saved events', body.includes('Black Friday test') && body.includes('Made on the new site'))
ok(`no page error (${fresh.errors.join(' | ').slice(0, 200)})`, fresh.errors.length === 0)
await fresh.browser.close()
process.exit(finish('BROWSER DATA') ? 1 : 0)
