// Browser end-to-end: TEXT IS LAID OUT GRACEFULLY (economist: "we have in the
// app some layout and formating problems with how the text is displayed.
// lets try making the app handle that gracefully").
//
// Every screen of the main path and every advanced tool is opened at two
// window widths (a 1280 laptop and a 1500 desktop), with every folded section
// open and a built event on screen, and measured:
//   - no screen is wider than its window (the page never scrolls sideways);
//   - no table cell is squeezed into a tall, narrow column (a word a line);
//   - no field shows less than its text (a cut placeholder or value);
//   - no explanation runs longer than about 150 characters a line;
//   - no button or chip label wraps onto several lines.
// A wide table may scroll sideways INSIDE its own box - that is listed, not
// failed. The first run of this audit found 296 such places; see
// docs/history.md for what they were. See helpers.mjs for how to run.
import { createBoard } from '../../src/features/merge/lib/core/board.js'
import { createChecker, launch, openMerge, tab } from './helpers.mjs'

const { ok, finish } = createChecker()
const WIDTHS = [1280, 1500]
function blankBoard(name, index, budget) {
  const b = createBoard(name, { rows: index === 0 ? 5 : 3, cols: 8 })
  const from = index === 0 ? 3 : 1
  b.tiles = b.tiles.map((row, r) => row.map(() => (r >= from ? 'blocked' : 'open')))
  if (index === 0) b.tiles[2][4] = 'semi'
  b.blockedValue = budget
  return b
}
const main = (b2, b3) => [blankBoard('Board 1', 0, 150), blankBoard('Board 2', 1, b2), blankBoard('Board 3', 2, b3)]
const save = { segments: [{ name: 'Segment 1', boards: main(600, 750) }, { name: 'High spenders, tier B', boards: main(450, 600), segmentFactor: 1.2 }, { name: 'Segment 3', boards: main(300, 400), segmentFactor: 1.5 }] }

// Runs in the page: returns the problems of what is on screen now.
function inspect() {
  const problems = []
  const seen = new Set()
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none'
  }
  const say = (kind, el, detail) => {
    const text = (el.innerText || el.value || el.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 70)
    const where = el.closest('[data-testid]')?.getAttribute('data-testid') ?? el.closest('[data-collapsible]')?.getAttribute('data-collapsible') ?? el.closest('section,details')?.querySelector('h3, summary')?.innerText?.replace(/\s+/g, ' ').slice(0, 40) ?? '?'
    const key = `${kind}|${where}|${text.slice(0, 30)}`
    if (seen.has(key)) return
    seen.add(key)
    problems.push({ kind, where, text, detail })
  }
  const vw = document.documentElement.clientWidth
  if (document.documentElement.scrollWidth > vw + 2) problems.push({ kind: 'page-scrolls-sideways', where: 'page', text: '', detail: `${document.documentElement.scrollWidth}px wide in a ${vw}px window` })
  const inScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX
      if (o === 'auto' || o === 'scroll') return p
    }
    return null
  }
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    // 1. Text cut off inside its own box.
    if ((el.tagName === 'INPUT' || el.tagName === 'SELECT') && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'range' && el.type !== 'file') {
      const probe = document.createElement('span')
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${cs.font}`
      probe.textContent = el.value || el.placeholder || ''
      document.body.appendChild(probe)
      const need = probe.getBoundingClientRect().width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + (el.type === 'number' ? 18 : 0)
      probe.remove()
      if (need > r.width + 1 && (el.value || el.placeholder)) say('field-text-cut', el, `needs ${Math.round(need)}px, has ${Math.round(r.width)}px (${el.value ? 'value' : 'placeholder'})`)
      continue
    }
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)
    if (ownText && (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 2) say('text-cut', el, `${el.scrollWidth}px of text in ${el.clientWidth}px`)
    // 2. Sticking out of the window (and not inside something that scrolls sideways).
    if (ownText && r.right > vw + 2 && !inScroller(el)) say('sticks-out-of-window', el, `ends at ${Math.round(r.right)}px in a ${vw}px window`)
    // 3. A table cell squeezed into a tall narrow column.
    if ((el.tagName === 'TD' || el.tagName === 'TH') && el.innerText.trim().length > 12) {
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4
      const lines = Math.round((r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / lh)
      if (lines >= 4 && r.width < 150) say('cell-squeezed', el, `${lines} lines in a ${Math.round(r.width)}px column`)
    }
    // 4. A table wider than its box: it scrolls sideways.
    if (el.tagName === 'TABLE') {
      const box = inScroller(el)
      if (box && el.scrollWidth > box.clientWidth + 4) say('table-scrolls-sideways', el, `${el.scrollWidth}px table in ${box.clientWidth}px`)
    }
    // 5. Lines too long to read: a block of running text wider than ~120 characters a line.
    if (ownText && ['P', 'DIV', 'SPAN', 'LI', 'LABEL'].includes(el.tagName) && el.innerText.trim().length > 220) {
      const fontSize = parseFloat(cs.fontSize)
      const perLine = r.width / (fontSize * 0.5)
      if (perLine > 150 && cs.display !== 'inline') say('lines-too-long', el, `about ${Math.round(perLine)} characters a line (${Math.round(r.width)}px at ${fontSize}px)`)
    }
    // 6. A button or chip whose label wraps onto several lines.
    if ((el.tagName === 'BUTTON' || el.dataset.status != null) && el.innerText.trim().length > 3 && !el.querySelector('span.grid')) {
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4
      const boardCell = /^d+s*d*s*DR$/.test(el.innerText.replace(/s+/g, ' ').trim()) || el.classList.contains('aspect-square')
      if (r.height > lh * 2.6 && el.innerText.trim().length < 60 && !el.dataset.bankLayout && !boardCell) say('label-wraps', el, `${Math.round(r.height / lh)} lines`)
    }
  }
  return problems
}

const report = {}
for (const width of WIDTHS) {
  const { browser, page } = await launch({ save })
  await page.setViewportSize({ width, height: 900 })
  await openMerge(page)
  const step = (id) => page.locator(`[data-step="${id}"]`)
  const set = async (locator, value) => {
    await locator.fill(String(value))
    await locator.blur()
    await page.waitForTimeout(200)
  }
  const look = async (name) => {
    await page.waitForTimeout(400)
    report[`${width} ${name}`] = await page.evaluate(inspect)
  }
  await look('step 1')
  await page.getByTestId('more-menu').click()
  await look('More menu')
  await page.keyboard.press('Escape')
  await step('layouts').click()
  await look('step 2')
  await step('rewards').click()
  await page.waitForTimeout(300)
  for (const [type, v] of [['coins', 3], ['puzzles', 300], ['energy', 200], ['charms', 400]]) await set(page.locator(`[data-target="${type}"]`), v)
  await page.getByTestId('twister-add').click()
  await page.waitForTimeout(300)
  await set(page.locator('[data-twister-segment="0"] [data-field="twists"]'), 15)
  await look('step 3')
  await step('build').click()
  await look('step 4 before a build')
  await page.getByTestId('build-configuration').click()
  await page.getByTestId('build-progress').waitFor({ state: 'visible', timeout: 15000 })
  await look('step 4 building')
  await page.getByTestId('build-summary').waitFor({ state: 'visible', timeout: 540000 })
  await page.waitForTimeout(1500)
  await look('step 4 built')
  await step('prizes').click()
  await look('step 5 prizes')
  await step('finalize').click()
  await page.waitForTimeout(300)
  await page.getByTestId('finalize-validate').click()
  await page.getByTestId('validation-table').waitFor({ state: 'visible', timeout: 300000 })
  await look('step 6')
  for (const name of ['Play tester', 'Syntax', 'Editor', 'Rewards (V2)', 'Twister', 'CC management']) {
    await tab(page, name).click()
    await page.waitForTimeout(700)
    await look(name)
  }
  await browser.close()
}
// ---- the verdicts ----
const MAIN = ['step 1', 'More menu', 'step 2', 'step 3', 'step 4 before a build', 'step 4 building', 'step 4 built', 'step 5 prizes', 'step 6', 'Play tester', 'Syntax']
const of = (width, kinds, screens = null) =>
  Object.entries(report)
    .filter(([screen]) => screen.startsWith(`${width} `) && (!screens || screens.includes(screen.slice(String(width).length + 1))))
    .flatMap(([screen, problems]) => problems.filter((p) => kinds.includes(p.kind)).map((p) => `${screen.slice(String(width).length + 1)} [${p.where}] ${p.detail}: "${p.text.slice(0, 40)}"`))
const show = (list) => (list.length ? ` - ${list.length}: ${list.slice(0, 3).join(' | ')}` : '')
for (const width of WIDTHS) {
  console.log(`--- a ${width}px window: ${Object.keys(report).filter((k) => k.startsWith(`${width} `)).length} screens ---`)
  const wide = of(width, ['page-scrolls-sideways', 'sticks-out-of-window'])
  ok(`no screen is wider than the window: the page never scrolls sideways${show(wide)}`, wide.length === 0)
  const squeezed = of(width, ['cell-squeezed'])
  ok(`no table cell is squeezed into a tall, narrow column${show(squeezed)}`, squeezed.length === 0)
  const cut = of(width, ['field-text-cut', 'text-cut'], MAIN)
  ok(`no field or label shows less than its text, in the guided flow, the Play tester and the Syntax tab${show(cut)}`, cut.length === 0)
  const long = of(width, ['lines-too-long'])
  ok(`no explanation runs longer than about 150 characters a line${show(long)}`, long.length === 0)
  const wraps = of(width, ['label-wraps'])
  ok(`no button or chip label wraps onto several lines${show(wraps)}`, wraps.length === 0)
  const scrolling = of(width, ['table-scrolls-sideways'])
  const advancedCut = of(width, ['field-text-cut', 'text-cut']).filter((line) => !MAIN.some((screen) => line.startsWith(`${screen} `)))
  console.log(`      (listed, not failed: ${scrolling.length} wide table${scrolling.length === 1 ? '' : 's'} scrolling inside ${scrolling.length === 1 ? 'its' : 'their'} own box; ${advancedCut.length} cut field text${advancedCut.length === 1 ? '' : 's'} in the advanced tools)`)
}
const fails = finish('TEXT LAYOUT')
process.exit(fails ? 1 : 0)
