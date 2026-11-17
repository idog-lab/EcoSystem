// Copies the endless-mode asset pack into the app, trimmed.
//
// Why trimmed: every PNG in merge-endless-mode-assets/png is a 256px canvas
// with the picture drawn somewhere inside it (a tile covers about two thirds
// of its canvas, and not centred). A board cell needs the tile to fill it
// edge to edge, and the selection brackets to sit on the cell's corners, so
// each picture is cut to the bounds of its own opaque pixels. Nothing is
// redrawn, recoloured or resized - only the empty margin is removed.
//
// Output: src/features/merge/assets/game/endless/*.png (same file names).
// Rerun if the pack changes:  node scripts/prepare-endless-assets.mjs
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '..')
const from = path.join(root, 'merge-endless-mode-assets', 'png')
const to = path.join(root, 'src', 'features', 'merge', 'assets', 'game', 'endless')
fs.mkdirSync(to, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage()
for (const file of fs.readdirSync(from).filter((f) => f.endsWith('.png'))) {
  const src = `data:image/png;base64,${fs.readFileSync(path.join(from, file)).toString('base64')}`
  const out = await page.evaluate(async (url) => {
    const img = new Image()
    img.src = url
    await img.decode()
    const full = document.createElement('canvas')
    full.width = img.width
    full.height = img.height
    const g = full.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, full.width, full.height).data
    let x0 = full.width
    let y0 = full.height
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < full.height; y++) {
      for (let x = 0; x < full.width; x++) {
        if (d[(y * full.width + x) * 4 + 3] > 40) {
          x0 = Math.min(x0, x)
          y0 = Math.min(y0, y)
          x1 = Math.max(x1, x)
          y1 = Math.max(y1, y)
        }
      }
    }
    const w = x1 - x0 + 1
    const h = y1 - y0 + 1
    const cut = document.createElement('canvas')
    cut.width = w
    cut.height = h
    cut.getContext('2d').drawImage(full, x0, y0, w, h, 0, 0, w, h)
    return { w, h, png: cut.toDataURL('image/png').split(',')[1] }
  }, src)
  fs.writeFileSync(path.join(to, file), Buffer.from(out.png, 'base64'))
  console.log(`${file}: ${out.w} x ${out.h}`)
}
await browser.close()
