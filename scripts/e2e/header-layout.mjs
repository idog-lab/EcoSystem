// Browser check: the editor header never wraps text inside an item, at a
// range of realistic window widths. (Found from a real report: with eight
// mode tabs in the title row, the title, tab labels and action buttons all
// started breaking onto several lines.) See helpers.mjs for how to run.
import { createChecker, launch, openMerge } from './helpers.mjs'

const { ok, finish } = createChecker()
const SHOT = process.env.E2E_SCREENSHOT_DIR ?? null
const { browser, page, errors } = await launch()
await openMerge(page)

for (const width of [1920, 1700, 1440, 1280, 1100]) {
  await page.setViewportSize({ width, height: 900 })
  await page.waitForTimeout(150)
  const report = await page.evaluate(() => {
    const header = document.querySelector('header')
    const singleLine = (el) => {
      const style = getComputedStyle(el)
      const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      return el.getBoundingClientRect().height - padding <= line * 1.6
    }
    const items = [...header.querySelectorAll('h1, button')]
    const wrapped = items.filter((el) => !singleLine(el)).map((el) => el.innerText.trim().slice(0, 30))
    return { wrapped, overflow: [header, ...header.querySelectorAll("div")].some((el) => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > window.innerWidth + 1), height: Math.round(header.getBoundingClientRect().height) }
  })
  ok(`${width}px: no header title, tab or button wraps onto a second line${report.wrapped.length ? ` (wrapped: ${report.wrapped.join(' | ')})` : ''}`, report.wrapped.length === 0)
  ok(`${width}px: nothing in the header overflows the window (header ${report.height}px tall)`, !report.overflow)
  if (SHOT) await page.screenshot({ path: `${SHOT}/header-${width}.png`, clip: { x: 0, y: 0, width, height: Math.min(900, report.height + 20) } })
}

ok('the three tools of the main path are tabs', (await page.locator('header [data-mode]').count()) === 3)
await page.getByTestId('more-menu').click()
await page.waitForTimeout(200)
ok('...and the five advanced tools are one click away, in the "More" menu, with the project actions', (await page.getByTestId('more-menu-panel').locator('[data-mode]').count()) === 5 && (await page.getByTestId('more-menu-panel').getByRole('button').count()) === 11)
{
  const box = await page.getByTestId('more-menu-panel').boundingBox()
  ok('...which opens inside the window', !!box && box.x >= 0 && box.x + box.width <= 1100 + 1)
}
ok('zero page errors', errors.length === 0)
await browser.close()
const fails = finish('Header layout E2E')
process.exit(fails === 0 ? 0 : 1)
