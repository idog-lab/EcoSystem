// WHERE THE DR DEMAND COMES FROM (src/features/merge/lib/build/demandSource.js): From events - the base's typed, the
// others base x multiplier; From levels - Brut Wins x DR per Brut Win; an older project as typed.
//   npx vite-node scripts/verify/verify-demand-source.mjs
import { demandSourceOf, demandsBySource } from '../../src/features/merge/lib/build/demandSource.js'

let fails = 0
let total = 0
const check = (name, cond, extra = '') => {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}${!cond && extra ? `  [${extra}]` : ''}`)
}
const rows = [
  { demand: 500, factor: 1, effortBW: 200, drPerBW: 2.5 },
  { demand: 999, factor: 1.6, effortBW: 100, drPerBW: 3 },
  { demand: null, factor: 0.5, effortBW: 40, drPerBW: null },
]
const ev = demandsBySource('events', rows, 2048)
check(`From events: the base typed, the others base x multiplier (${ev.map((r) => r.demand).join(', ')})`, !ev[0].derived && ev[0].demand === 500 && ev[1].derived && ev[1].demand === 800 && ev[2].demand === 250)
const noBase = demandsBySource('events', [{ ...rows[0], demand: null }, rows[1]], 2048)
check('From events with no base demand: none for the others, and it says so', noBase[1].demand === null && /base segment/.test(noBase[1].problem))
const lv = demandsBySource('levels', rows, 2048)
check(`From levels: Brut Wins x DR per Brut Win, every segment calculated (${lv.map((r) => r.demand).join(', ')})`, lv.every((r) => r.derived) && lv[0].demand === 500 && lv[1].demand === 300 && lv[2].demand === null && /DR per Brut Win/.test(lv[2].problem))
check('rounded to a whole DR', demandsBySource('levels', [{ effortBW: 33, drPerBW: 2.5 }], 2048)[0].demand === 83)
const over = demandsBySource('levels', [{ effortBW: 1000, drPerBW: 2.5 }], 2048)[0]
check('more than the chain is worth: no demand, and why', over.demand === null && /2,500 DR, more than the 2,048/.test(over.problem))
const typed = demandsBySource(null, rows, 2048)
check('an older project: every demand as typed', typed.every((r) => !r.derived) && typed[1].demand === 999 && typed[2].demand === null)
check('only the two kinds are read; anything else is "as typed"', demandSourceOf('events') === 'events' && demandSourceOf('levels') === 'levels' && demandSourceOf('typed') === null && demandSourceOf(undefined) === null)

console.log(`\nDEMAND SOURCE: ${total - fails} of ${total} checks passed`)
process.exit(fails ? 1 : 0)
