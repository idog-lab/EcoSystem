// Measures how big each item was DRAWN on the asset pack's original sheets,
// and writes src/features/merge/assets/game/scale.json.
//
// Why: the pack's individual sprites were normalized - every item scaled to
// fill the same 224px box - so a single seed came out as large as a rose
// tree. The sheets (merge-playtester-assets-v2/sheets/*.png) still hold the
// sizes the items were drawn at. For each sprite this reads its cell of the
// sheet (manifest.json: sourceSheet + sourceRect), finds the bounds of the
// opaque pixels, and records  size-in-cell / the largest size on that sheet.
// The app draws each sprite at that fraction of a full item.
//
// Stray specks on a sheet are ignored (a row or column counts only when it
// has a few opaque pixels). Run:  node scripts/art/measure-art-proportions.mjs
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '../..')
const pack = path.join(root, 'art-source', 'merge-playtester-assets-v2')
const manifest = JSON.parse(fs.readFileSync(path.join(pack, 'manifest.json'), 'utf8'))
const items = manifest.assets.filter((a) => a.sourceSheet && a.sourceRect && (a.category === 'main' || a.file.startsWith('rewards/')))

const browser = await chromium.launch()
const page = await browser.newPage()
const sheets = [...new Set(items.map((a) => a.sourceSheet))]
const measured = {}
for (const sheet of sheets) {
  const dataUrl = `data:image/png;base64,${fs.readFileSync(path.join(pack, sheet)).toString('base64')}`
  const rects = items.filter((a) => a.sourceSheet === sheet).map((a) => ({ file: a.file, ...a.sourceRect }))
  const out = await page.evaluate(
    async ({ dataUrl, rects }) => {
      const img = new Image()
      img.src = dataUrl
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      const MIN_PIXELS = 4
      return rects.map((r) => {
        const { data } = ctx.getImageData(r.left, r.top, r.width, r.height)
        const rows = new Array(r.height).fill(0)
        const cols = new Array(r.width).fill(0)
        for (let y = 0; y < r.height; y++) {
          for (let x = 0; x < r.width; x++) {
            if (data[(y * r.width + x) * 4 + 3] > 160) {
              rows[y] += 1
              cols[x] += 1
            }
          }
        }
        const first = (a) => a.findIndex((n) => n >= MIN_PIXELS)
        const last = (a) => a.length - 1 - [...a].reverse().findIndex((n) => n >= MIN_PIXELS)
        const w = last(cols) - first(cols) + 1
        const h = last(rows) - first(rows) + 1
        return { file: r.file, size: Math.max(w, h) / Math.max(r.width, r.height) }
      })
    },
    { dataUrl, rects },
  )
  const largest = Math.max(...out.map((o) => o.size))
  for (const o of out) measured[o.file] = Math.round((o.size / largest) * 1000) / 1000
}
await browser.close()

fs.writeFileSync(path.join(root, 'src/features/merge/assets/game/scale.json'), `${JSON.stringify(measured, null, 2)}\n`)
for (const [file, scale] of Object.entries(measured)) console.log(scale.toFixed(3), file)
