// THE SHEET'S LOGIC (src/components/SheetGrid.jsx; economist, 26 Nov 2026: "the easiest way to create the tiers,
// shares, prizes and everything is an excel like interface, where u can move easily with the keyboard arrows" - asked,
// and chose to build our own, starting with Wicked Trails). Pure functions, so they can be checked without a browser:
// what a pasted block from Excel holds, what a typed number is, where a key moves to, and what a selection copies.

// A block copied from Excel or Google Sheets: rows split on line breaks, cells on tabs; a cell in quotes may hold a tab
// or a line break (Excel quotes those) and "" inside it is one quote. A trailing empty line is dropped.
export function parseTsv(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === '\t') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

// A block to copy out: tabs between cells, line breaks between rows; a cell with a tab, line break or quote is quoted.
export function toTsv(rows) {
  const cell = (v) => {
    const s = v == null ? '' : String(v)
    return /[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(cell).join('\t')).join('\n')
}

// A number as typed or pasted: "1,234.5", "33%", " 12 " - { ok, value } (empty is ok, value null). A comma alone as the
// decimal mark ("0,5") is read as one.
export function parseNumber(text) {
  const s = String(text ?? '').trim().replace(/%$/, '').trim()
  if (s === '') return { ok: true, value: null }
  const plain = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, '') : /^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s
  const n = Number(plain)
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, value: null }
}

// Where the active cell goes: arrows one step (clamped at the edges), Tab / Shift+Tab right and left (wrapping to the
// next or previous row), Enter / Shift+Enter down and up. { r, c }.
export function move({ r, c }, key, { rows, cols, shift = false }) {
  const clamp = (v, n) => Math.max(0, Math.min(n - 1, v))
  switch (key) {
    case 'ArrowUp':
      return { r: clamp(r - 1, rows), c }
    case 'ArrowDown':
      return { r: clamp(r + 1, rows), c }
    case 'ArrowLeft':
      return { r, c: clamp(c - 1, cols) }
    case 'ArrowRight':
      return { r, c: clamp(c + 1, cols) }
    case 'Tab':
      if (shift) return c > 0 ? { r, c: c - 1 } : r > 0 ? { r: r - 1, c: cols - 1 } : { r, c }
      return c < cols - 1 ? { r, c: c + 1 } : r < rows - 1 ? { r: r + 1, c: 0 } : { r, c }
    case 'Enter':
      return { r: clamp(r + (shift ? -1 : 1), rows), c }
    case 'Home':
      return { r, c: 0 }
    case 'End':
      return { r, c: cols - 1 }
    default:
      return { r, c }
  }
}

// The rectangle between two cells: { r0, r1, c0, c1 }.
export const rectOf = (a, b) => ({ r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) })
export const inRect = (rect, r, c) => r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1

// Where a pasted block lands: from the active cell, over the rows and columns it covers (cut at the sheet's edges); a
// single value pasted on a selection of several cells fills every one of them, as Excel does.
// Returns [{ r, c, text }].
export function pasteTargets(block, at, rect, { rows, cols }) {
  const out = []
  if (block.length === 1 && block[0].length === 1 && rect && (rect.r1 > rect.r0 || rect.c1 > rect.c0)) {
    for (let r = rect.r0; r <= rect.r1; r += 1) for (let c = rect.c0; c <= rect.c1; c += 1) out.push({ r, c, text: block[0][0] })
    return out
  }
  block.forEach((line, dr) =>
    line.forEach((text, dc) => {
      const r = at.r + dr
      const c = at.c + dc
      if (r < rows && c < cols) out.push({ r, c, text })
    }),
  )
  return out
}
