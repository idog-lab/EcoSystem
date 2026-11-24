// Browser check: saved events (economist: "i want to be able to save full
// events in the app ... like to save the events in the specific time frame").
// Kept in this browser, named by the event's dates, newest first.
import { createChecker, launch, openMerge } from './helpers.mjs'

const { ok, finish } = createChecker()
const { browser, page, errors } = await launch()
await openMerge(page)
// Every question the app asks (open over unsaved changes, delete) is answered yes.
page.on('dialog', (d) => d.accept())

const panel = () => page.getByTestId('saved-events')
const openPanel = async () => {
  if (await panel().count()) return
  await page.getByTestId('more-menu').click()
  await page.getByTestId('saved-events-toggle').click()
  await panel().waitFor()
}
const rows = async () => page.locator('[data-saved-event]').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))
const setDates = async (start) => {
  await page.locator('[data-field="event-start"]').first().fill(start)
  await page.waitForTimeout(300)
}
const segmentName = async () => page.locator('[data-segment-tab="0"] input').inputValue()
const renameSegment = async (name) => {
  await page.locator('[data-segment-tab="0"] input').fill(name)
  await page.waitForTimeout(200)
}

// The first event: August.
await setDates('2026-08-19')
await renameSegment('August base')
await openPanel()
ok('the list starts empty, and the name it offers is the event\'s dates', /No saved events yet/.test(await panel().innerText()) && (await page.getByTestId('saved-events-name').getAttribute('placeholder')) === 'Merge Mania 19-25 Aug 2026')
await page.getByTestId('saved-events-save-new').click()
await page.waitForTimeout(300)
ok(`saving it puts it in the list, open now, and the header names it (${(await rows()).join(' | ')})`, (await rows()).length === 1 && /Merge Mania 19-25 Aug 2026/.test((await rows())[0]) && (await page.getByTestId('saved-event-open-badge').count()) === 1 && /19-25 Aug 2026/.test(await page.getByTestId('open-event-name').innerText()) && (await page.getByTestId('unsaved-changes').count()) === 0)

// The second event: November, saved as a new one.
await setDates('2026-11-02')
await renameSegment('November base')
await page.getByTestId('saved-events-name').fill('')
await page.getByTestId('saved-events-save-new').click()
await page.waitForTimeout(300)
const two = await rows()
ok(`a second event, saved as new, is listed first - the newest dates first (${two.map((r) => r.slice(0, 32)).join(' | ')})`, two.length === 2 && /2-8 Nov 2026/.test(two[0]) && /19-25 Aug 2026/.test(two[1]))

// Open the August one again: everything comes back.
await page.locator('[data-saved-event]').nth(1).getByTestId('saved-event-open').click()
await page.waitForTimeout(800)
ok(`opening the August event brings back its segments and dates (segment 1: "${await segmentName()}")`, (await segmentName()) === 'August base' && (await page.locator('[data-field="event-start"]').first().inputValue()) === '2026-08-19' && /19-25 Aug 2026/.test(await page.getByTestId('open-event-name').innerText()))

// Change it and update it in place.
await renameSegment('August base v2')
await page.waitForTimeout(900)
ok('a change after opening it shows as unsaved', (await page.getByTestId('unsaved-changes').count()) === 1)
await page.getByTestId('saved-events-update').click()
await page.waitForTimeout(300)
ok('"Update" writes it over the same saved event: still two in the list, nothing unsaved', (await rows()).length === 2 && (await page.getByTestId('unsaved-changes').count()) === 0)

// Rename.
await page.locator('[data-saved-event]').nth(1).getByTestId('saved-event-rename').click()
await page.getByTestId('saved-event-rename-input').fill('August - test A')
await page.getByTestId('saved-event-rename-input').press('Enter')
await page.waitForTimeout(200)
ok('an event can be renamed', /August - test A/.test((await rows())[1]))

// A reload keeps the list, what is open, and what it holds.
await page.reload()
await page.waitForTimeout(800)
await openMerge(page)
await openPanel()
ok(`after a reload the list is there, the August event still open, with its change (${await segmentName()})`, (await rows()).length === 2 && /August - test A/.test(await page.getByTestId('saved-events-open-name').innerText()) && (await segmentName()) === 'August base v2')

// Open November from the reloaded page, then download and delete August.
await page.locator('[data-saved-event]').nth(0).getByTestId('saved-event-open').click()
await page.waitForTimeout(800)
ok('the November event opens', (await segmentName()) === 'November base')
const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-saved-event]').nth(1).getByTestId('saved-event-download').click()])
ok(`an event downloads as a backup file (${download.suggestedFilename()})`, /^August-test-A\.json$/.test(download.suggestedFilename()))
await page.locator('[data-saved-event]').nth(1).getByTestId('saved-event-delete').click()
await page.waitForTimeout(300)
ok('an event can be deleted; the one open stays', (await rows()).length === 1 && /2-8 Nov 2026/.test((await rows())[0]) && (await segmentName()) === 'November base')

// THE SWITCHER IN THE HEADER (economist: "save the event and be able to switch between them" - a switcher in the header).
await page.getByTestId('saved-events-close').click().catch(() => {})
await page.keyboard.press('Escape')
const switcher = page.getByTestId('event-switcher')
const switcherRows = async () => page.locator('[data-testid="event-switcher-list"] [data-event-id]').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))
ok('the header names the event open, in a switcher', (await switcher.count()) === 1 && /2-8 Nov 2026/.test(await page.getByTestId('open-event-name').innerText()))
// A second event, saved from the switcher alone.
await setDates('2026-12-01')
await renameSegment('December base')
await switcher.click()
ok('the switcher offers to save this event as new, under its dates', /Save as a new event: "Merge Mania 1-7 Dec 2026"/.test(await page.getByTestId('event-switcher-save-new').innerText()))
await page.getByTestId('event-switcher-save-new').click()
await page.waitForTimeout(400)
ok('saved from the switcher: it is open, named in the header, and said so', /1-7 Dec 2026/.test(await page.getByTestId('open-event-name').innerText()) && /Saved as "Merge Mania 1-7 Dec 2026"/.test(await page.getByTestId('event-switcher-message').innerText()) && (await page.getByTestId('unsaved-changes').count()) === 0)
await switcher.click()
const listed = await switcherRows()
ok(`it lists the saved events newest first, the open one marked (${listed.join(' | ')})`, listed.length === 2 && /Merge Mania 1-7 Dec 2026.*Open$/i.test(listed[0]) && /2-8 Nov 2026/.test(listed[1]))
// Switch to November with a change not saved: asked first (the dialog is answered yes), then November is open.
await page.keyboard.press('Escape')
await renameSegment('December base v2')
await page.waitForTimeout(600)
await switcher.click()
ok('with a change not saved, the switcher offers to update the open event with it', /Update "Merge Mania 1-7 Dec 2026" with the changes/.test(await page.getByTestId('event-switcher-update').innerText()))
await page.locator('[data-testid="event-switcher-list"] [data-event-id]').nth(1).click()
await page.waitForTimeout(800)
ok('one click switches to another saved event (after asking, as there were unsaved changes)', (await segmentName()) === 'November base' && /2-8 Nov 2026/.test(await page.getByTestId('open-event-name').innerText()))
await switcher.click()
await page.locator('[data-testid="event-switcher-list"] [data-event-id]').nth(0).click()
await page.waitForTimeout(800)
ok('and back: December as it was saved (the unsaved change was not kept)', (await segmentName()) === 'December base' && /1-7 Dec 2026/.test(await page.getByTestId('open-event-name').innerText()))
await switcher.click()
await page.getByTestId('event-switcher-manage').click()
await page.waitForTimeout(300)
ok('rename, delete and download are one click away, in Saved events', (await panel().count()) === 1)

ok('zero page errors', errors.length === 0)
await browser.close()
const fails = finish('Saved events E2E')
process.exit(fails === 0 ? 0 : 1)
