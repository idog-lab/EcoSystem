// THE SHEET'S LOGIC (src/lib/sheetGrid.js): a block pasted from Excel, a block copied out, numbers as typed, where a
// key moves the active cell, where a pasted block lands.
//   npx vite-node scripts/verify/verify-sheet-grid.mjs
import { inRect, move, parseNumber, parseTsv, pasteTargets, rectOf, toTsv, withRest } from '../../src/lib/sheetGrid.js'

let fails = 0
let total = 0
const check = (name, cond, extra = '') => {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}${!cond && extra ? `  [${extra}]` : ''}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Pasted from Excel.
check('a block from Excel: tabs and line breaks, the last empty line dropped', same(parseTsv('10\t20\r\n30\t40\r\n'), [['10', '20'], ['30', '40']]))
check('one value', same(parseTsv('25'), [['25']]))
check('an empty cell in the middle is kept', same(parseTsv('1\t\t3'), [['1', '', '3']]))
check('a quoted cell may hold a tab, a line break and a quote', same(parseTsv('"a\tb"\t"line\none"\t"say ""hi"""'), [['a\tb', 'line\none', 'say "hi"']]))
check('a prize text with brackets and pipes is one cell', same(parseTsv('[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]\tfree_wild:2'), [['[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]', 'free_wild:2']]))
// Copied out, and back in the same.
const block = [['free_undo:4', 12.5], ['a\tb', null]]
check('copied out: tabs and line breaks, a cell with a tab quoted', toTsv(block) === 'free_undo:4\t12.5\n"a\tb"\t')
check('copied out and pasted back: the same block', same(parseTsv(toTsv([['x', '"q"'], ['1', '2']])), [['x', '"q"'], ['1', '2']]))

// Numbers.
const n = (t) => parseNumber(t)
check('numbers as typed: 12, 1,234.5, 33%, 0,5 (a comma decimal), -3', n('12').value === 12 && n('1,234.5').value === 1234.5 && n('33%').value === 33 && n('0,5').value === 0.5 && n('-3').value === -3)
check('empty is "nothing", not 0', n('').ok && n('  ').value === null)
check('not a number is refused', !n('abc').ok && !n('12x').ok)

// Moving.
const size = { rows: 3, cols: 4 }
check('arrows move one cell and stop at the edges', same(move({ r: 0, c: 0 }, 'ArrowUp', size), { r: 0, c: 0 }) && same(move({ r: 0, c: 0 }, 'ArrowDown', size), { r: 1, c: 0 }) && same(move({ r: 2, c: 3 }, 'ArrowRight', size), { r: 2, c: 3 }))
check('Tab moves right and wraps to the next row; Shift+Tab back', same(move({ r: 0, c: 3 }, 'Tab', size), { r: 1, c: 0 }) && same(move({ r: 1, c: 0 }, 'Tab', { ...size, shift: true }), { r: 0, c: 3 }) && same(move({ r: 2, c: 3 }, 'Tab', size), { r: 2, c: 3 }))
check('Enter moves down, Shift+Enter up; Home and End to the row\'s ends', same(move({ r: 1, c: 2 }, 'Enter', size), { r: 2, c: 2 }) && same(move({ r: 1, c: 2 }, 'Enter', { ...size, shift: true }), { r: 0, c: 2 }) && same(move({ r: 1, c: 2 }, 'Home', size), { r: 1, c: 0 }) && same(move({ r: 1, c: 2 }, 'End', size), { r: 1, c: 3 }))

// Selections and paste.
const rect = rectOf({ r: 2, c: 1 }, { r: 0, c: 3 })
check('a selection is the rectangle between two cells, either way round', same(rect, { r0: 0, r1: 2, c0: 1, c1: 3 }) && inRect(rect, 1, 2) && !inRect(rect, 1, 0))
const at = { r: 1, c: 2 }
check('a block lands from the active cell, cut at the sheet\'s edges', same(pasteTargets([['a', 'b', 'c'], ['d', 'e', 'f'], ['g']], at, null, size), [{ r: 1, c: 2, text: 'a' }, { r: 1, c: 3, text: 'b' }, { r: 2, c: 2, text: 'd' }, { r: 2, c: 3, text: 'e' }]))
check('one value pasted on a selection fills all of it', pasteTargets([['7']], { r: 0, c: 0 }, rectOf({ r: 0, c: 0 }, { r: 1, c: 1 }), size).length === 4)
check('one value on one cell is one cell', pasteTargets([['7']], { r: 0, c: 0 }, rectOf({ r: 0, c: 0 }, { r: 0, c: 0 }), size).length === 1)

// Shares of a whole: the last is the rest.
check('a share typed: the last becomes the rest (30, 30 -> 40)', same(withRest([33.33, 33.33, 33.34], 0, 30), [30, 33.33, 36.67]) && same(withRest([30, 33.33, 36.67], 1, 30), [30, 30, 40]))
check('the last itself is never typed: it stays the rest', same(withRest([50, 50], 1, 80), [50, 50]))
check('the ones before take more than the whole: the last goes below 0 (and the feature says so)', same(withRest([50, 50], 0, 110), [110, -10]))
check('one place only: it is the whole', same(withRest([40], 0, 40), [100]))
check('a whole other than 100', same(withRest([1, 1], 0, 3, 10), [3, 7]))

console.log(`\nSHEET GRID: ${total - fails} of ${total} checks passed`)
process.exit(fails ? 1 : 0)
