// Runs every browser suite in this folder, one after another, against the
// dev server (start it first with `npm run dev`). Prints one line per suite
// and exits non-zero if any failed. Run: npm run e2e
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const here = import.meta.dirname
// art-gallery.mjs only takes pictures; helpers.mjs is shared code.
const skip = new Set(['helpers.mjs', 'run-all.mjs', 'art-gallery.mjs'])
const suites = fs.readdirSync(here).filter((f) => f.endsWith('.mjs') && !skip.has(f)).sort()
let failed = 0
for (const suite of suites) {
  const started = Date.now()
  // Quoted: the project path has spaces in it.
  const run = spawnSync('npx', ['vite-node', `"${path.join(here, suite)}"`], { encoding: 'utf8', shell: true })
  const out = `${run.stdout}\n${run.stderr}`
  const summary = out.split('\n').reverse().find((l) => /CHECKS? (PASSED|FAILED)/.test(l)) ?? 'no summary (crashed?)'
  const ok = run.status === 0 && /PASSED/.test(summary)
  if (!ok) failed += 1
  console.log(`${ok ? '  OK ' : 'FAIL '} ${suite.padEnd(28)} ${summary.trim()}  (${Math.round((Date.now() - started) / 1000)}s)`)
  if (!ok) console.log(out.split('\n').filter((l) => /^FAIL|Error/.test(l)).slice(0, 8).map((l) => `        ${l}`).join('\n'))
}
console.log(failed === 0 ? `\nALL ${suites.length} BROWSER SUITES PASSED` : `\n${failed} OF ${suites.length} BROWSER SUITES FAILED`)
process.exit(failed === 0 ? 0 : 1)
