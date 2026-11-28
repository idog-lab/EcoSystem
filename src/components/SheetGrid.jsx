import { useEffect, useRef, useState } from 'react'
import { inRect, move, parseNumber, parseTsv, pasteTargets, rectOf, toTsv } from '../lib/sheetGrid'

// AN EXCEL-LIKE SHEET (economist, 26 Nov 2026: "the easiest way to create the tiers, shares, prizes and everything is
// an excel like interface, where u can move easily with the keyboard arrows" - our own, starting with Wicked Trails,
// "we will make sure its built perfectly and then later when building other features we will put it in there").
//   Arrows move, Shift+arrows (or a drag) select a block; Tab / Shift+Tab right and left; Enter down, Shift+Enter up;
//   typing over a cell replaces it, F2 or a double click edits what is there; Enter or Tab takes it, Escape drops it;
//   Delete clears; Ctrl+C / Ctrl+V copy and paste blocks with Excel and Google Sheets (one value fills a selection);
//   Ctrl+Z / Ctrl+Y undo and redo; a dropdown cell opens with Enter, F2 or a letter, a tick cell flips with Space.
// A cell that is worked out (not editable) is grey and is still moved through and copied.
//
// columns: [{ key, label, sub, width, type: 'number' | 'text' | 'select' | 'toggle', editable: bool | (row) => bool,
//   options: (row) => [{ value, label }], value: (row) => raw (what is edited and copied; row[key] by default),
//   display: (row) => node, align: 'left' | 'right', tone: (row) => className, title: (row) => text,
//   clearTo: what Delete brings the cell back to (a dropdown's default), check: (row, value) => why or null (a value
//   refused, with the reason), suggestions: (row) => [text] (offered while
//   typing), sticky: true (stays in sight when the sheet scrolls sideways - the leading columns), group: a heading over
//   the columns that share it }]
// rows: [{ id, ... }]. onCommit([{ row, key, value }]) - a number is a number or null, a text a string, a tick a boolean.
// onActive(row, column) when the active cell moves; onKey(event, row, column) for the keys the sheet does not use.
const fmtNumber = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }))
const TRUE_TEXT = /^(true|yes|y|1|x|✓|v)$/i

// rowTone(row) => { edit, fixed, edge }: a group's colour - the cells typed in, the cells worked out (solid: a sticky cell
// sits on it) and the first cell's edge - so the rows of one lane, say, read apart from another's.
export default function SheetGrid({ columns, rows, onCommit, onActive = null, onKey = null, rowTone = null, testid = 'sheet', help = true, className = '' }) {
  const box = useRef(null)
  const [active, setActive] = useState({ r: 0, c: 0 })
  const [anchor, setAnchor] = useState({ r: 0, c: 0 })
  const [editing, setEditing] = useState(null) // { r, c, text, mode: 'enter' | 'edit' }
  const [history, setHistory] = useState({ undo: [], redo: [] })
  const [note, setNote] = useState(null)
  const dragging = useRef(false)
  // What is being typed, kept here as well as in the state: a key that comes before the box is on screen is not lost.
  const editRef = useRef(null)
  const setEdit = (next) => {
    editRef.current = next
    setEditing(next)
  }
  const nRows = rows.length
  const nCols = columns.length
  const at = { r: Math.min(active.r, Math.max(0, nRows - 1)), c: Math.min(active.c, Math.max(0, nCols - 1)) }
  const rect = rectOf(anchor, at)

  const valueOf = (row, col) => (col.value ? col.value(row) : row?.[col.key])
  const editable = (row, col) => !!row && (typeof col.editable === 'function' ? col.editable(row) : !!col.editable)
  const optionsOf = (row, col) => (col.options ? col.options(row) : [])

  useEffect(() => {
    const up = () => (dragging.current = false)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])
  useEffect(() => {
    box.current?.querySelector(`[data-cell="${at.r}:${at.c}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    onActive?.(rows[at.r] ?? null, columns[at.c] ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at.r, at.c, rows[at.r]?.id])

  const focusBox = () => setTimeout(() => box.current?.focus({ preventScroll: true }), 0)

  // Turns typed or pasted text into a cell's value; { ok, value, why }.
  function convert(row, col, text) {
    if (col.type === 'number') {
      const n = parseNumber(text)
      return n.ok ? { ok: true, value: n.value } : { ok: false, why: `"${String(text).trim()}" is not a number` }
    }
    if (col.type === 'toggle') return { ok: true, value: typeof text === 'boolean' ? text : TRUE_TEXT.test(String(text).trim()) }
    if (col.type === 'select') {
      const t = String(text).trim().toLowerCase()
      const hit = optionsOf(row, col).find((o) => String(o.value).toLowerCase() === t || String(o.label).toLowerCase() === t)
      return hit ? { ok: true, value: hit.value } : { ok: false, why: `"${String(text).trim()}" is not one of the choices` }
    }
    return { ok: true, value: String(text ?? '').trim() }
  }

  // Writes cells: [{ r, c, text }] (or value) - only editable ones; what is refused is said under the sheet.
  function write(cells, { record = true } = {}) {
    const changes = []
    const refused = []
    for (const cell of cells) {
      const row = rows[cell.r]
      const col = columns[cell.c]
      if (!row || !col || !editable(row, col)) continue
      const v = 'value' in cell ? { ok: true, value: cell.value } : convert(row, col, cell.text)
      if (!v.ok) {
        refused.push(v.why)
        continue
      }
      // A column's own check (a key not on its list, an amount with no preset near it): refused, and why.
      const why = col.check?.(row, v.value) ?? null
      if (why) {
        refused.push(why)
        continue
      }
      const old = valueOf(row, col) ?? null
      if (old === v.value) continue
      changes.push({ row, rowId: row.id, key: col.key, value: v.value, old })
    }
    if (changes.length) {
      onCommit(changes.map(({ row, key, value }) => ({ row, key, value })))
      if (record) setHistory((h) => ({ undo: [...h.undo.slice(-99), changes], redo: [] }))
    }
    setNote(refused.length ? `${refused.length} cell${refused.length === 1 ? '' : 's'} not taken: ${refused[0]}.` : null)
    return changes.length
  }

  function replay(list, field) {
    const byId = new Map(rows.map((row) => [row.id, row]))
    const out = list.map((x) => ({ row: byId.get(x.rowId), key: x.key, value: x[field] })).filter((x) => x.row)
    if (out.length) onCommit(out)
  }
  function undo() {
    const last = history.undo.at(-1)
    if (!last) return
    replay(last, 'old')
    setHistory((h) => ({ undo: h.undo.slice(0, -1), redo: [...h.redo, last] }))
  }
  function redo() {
    const last = history.redo.at(-1)
    if (!last) return
    replay(last, 'value')
    setHistory((h) => ({ undo: [...h.undo, last], redo: h.redo.slice(0, -1) }))
  }

  const go = (to, extend = false) => {
    setActive(to)
    if (!extend) setAnchor(to)
  }
  function startEdit(r, c, mode, text = null) {
    const row = rows[r]
    const col = columns[c]
    if (!editable(row, col)) {
      setNote('This cell is worked out - it cannot be typed over.')
      return
    }
    if (col.type === 'toggle') return write([{ r, c, value: !valueOf(row, col) }])
    const raw = valueOf(row, col)
    setEdit({ r, c, mode, text: text ?? (raw == null ? '' : String(raw)) })
  }
  function finishEdit(how, moveKey = null, shift = false) {
    const e = editRef.current
    if (!e) return
    setEdit(null)
    if (how === 'commit') write([{ r: e.r, c: e.c, text: e.text }])
    if (moveKey) go(move({ r: e.r, c: e.c }, moveKey, { rows: nRows, cols: nCols, shift }))
    focusBox()
  }

  function onKeyDown(e) {
    // Keys that come while the edit box is still on its way go to what is being typed.
    if (editRef.current) {
      if (e.target !== box.current) return
      e.preventDefault()
      if (e.key === 'Enter' || e.key === 'Tab') return finishEdit('commit', e.key, e.shiftKey)
      if (e.key === 'Escape') return finishEdit('cancel')
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) setEdit({ ...editRef.current, text: editRef.current.text + e.key })
      return
    }
    const ctrl = e.ctrlKey || e.metaKey
    const row = rows[at.r]
    const col = columns[at.c]
    if (ctrl && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) return (e.preventDefault(), undo())
    if (ctrl && (e.key === 'y' || e.key === 'Y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) return (e.preventDefault(), redo())
    if (ctrl && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault()
      setAnchor({ r: 0, c: 0 })
      return setActive({ r: nRows - 1, c: nCols - 1 })
    }
    // Fill, as in Excel: Ctrl+D copies the selection's top row down it, Ctrl+R its left column across it.
    if (ctrl && (e.key === 'd' || e.key === 'D' || e.key === 'r' || e.key === 'R')) {
      e.preventDefault()
      const down = e.key === 'd' || e.key === 'D'
      const cells = []
      for (let r = rect.r0; r <= rect.r1; r += 1)
        for (let c = rect.c0; c <= rect.c1; c += 1) {
          if (down ? r === rect.r0 : c === rect.c0) continue
          const from = down ? valueOf(rows[rect.r0], columns[c]) : valueOf(rows[r], columns[rect.c0])
          if (columns[c].type === (down ? columns[c].type : columns[rect.c0].type)) cells.push({ r, c, value: from ?? (columns[c].type === 'number' ? null : '') })
        }
      if (!cells.length) return setNote(down ? 'Select the cells to fill, the first row holding the value.' : 'Select the cells to fill, the first column holding the value.')
      return write(cells)
    }
    // A dropdown cell, as Excel's data validation: Ctrl+Down / Ctrl+Up go through its choices in place; Alt+Down opens it.
    if (col?.type === 'select' && editable(row, col) && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && (ctrl || e.altKey)) {
      e.preventDefault()
      if (e.altKey) return startEdit(at.r, at.c, 'edit')
      const opts = optionsOf(row, col)
      if (!opts.length) return
      const now = opts.findIndex((o) => o.value === (valueOf(row, col) ?? ''))
      const next = opts[(now + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length]
      return write([{ r: at.r, c: at.c, value: next.value }])
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault()
      return go(move(at, e.key, { rows: nRows, cols: nCols }), e.shiftKey)
    }
    if (e.key === 'Tab' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      return go(move(at, e.key, { rows: nRows, cols: nCols, shift: e.shiftKey }))
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (col?.type === 'select' || col?.type === 'toggle') return startEdit(at.r, at.c, 'edit')
      return go(move(at, 'Enter', { rows: nRows, cols: nCols, shift: e.shiftKey }))
    }
    if (e.key === 'F2') return (e.preventDefault(), startEdit(at.r, at.c, 'edit'))
    if (e.key === ' ' && col?.type === 'toggle') return (e.preventDefault(), startEdit(at.r, at.c, 'edit'))
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      const cells = []
      // A column may say what Delete brings it back to (`clearTo`: a dropdown's default, say); else a dropdown or a tick
      // is left as it is and any other cell is emptied.
      for (let r = rect.r0; r <= rect.r1; r += 1)
        for (let c = rect.c0; c <= rect.c1; c += 1) {
          if (columns[c].clearTo !== undefined) cells.push({ r, c, value: columns[c].clearTo })
          else if (columns[c].type !== 'select' && columns[c].type !== 'toggle') cells.push({ r, c, text: '' })
        }
      return write(cells)
    }
    if (e.key === 'Escape') return setAnchor(at)
    if (!ctrl && !e.altKey && e.key.length === 1) {
      e.preventDefault()
      if (col?.type === 'select') return startEdit(at.r, at.c, 'edit')
      if (col?.type === 'toggle') return
      return startEdit(at.r, at.c, 'enter', e.key)
    }
    onKey?.(e, row, col)
  }

  function onCopy(e) {
    if (editing) return
    const lines = []
    for (let r = rect.r0; r <= rect.r1; r += 1) {
      const line = []
      for (let c = rect.c0; c <= rect.c1; c += 1) {
        const v = valueOf(rows[r], columns[c])
        line.push(typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v ?? '')
      }
      lines.push(line)
    }
    e.clipboardData.setData('text/plain', toTsv(lines))
    e.preventDefault()
    setNote(`Copied ${lines.length * (rect.c1 - rect.c0 + 1)} cell${lines.length * (rect.c1 - rect.c0 + 1) === 1 ? '' : 's'}.`)
  }
  function onPaste(e) {
    if (editing) return
    const block = parseTsv(e.clipboardData.getData('text/plain'))
    if (!block.length) return
    e.preventDefault()
    const targets = pasteTargets(block, { r: rect.r0, c: rect.c0 }, rect, { rows: nRows, cols: nCols })
    const n = write(targets)
    const last = targets.at(-1)
    if (last) {
      setAnchor({ r: rect.r0, c: rect.c0 })
      setActive({ r: last.r, c: last.c })
    }
    if (n) setNote((v) => v ?? `Pasted into ${n} cell${n === 1 ? '' : 's'}.`)
  }

  const show = (row, col) => {
    if (col.display) return col.display(row)
    const v = valueOf(row, col)
    if (col.type === 'number') return fmtNumber(v)
    if (col.type === 'toggle') return v ? '✓' : ''
    if (col.type === 'select') return optionsOf(row, col).find((o) => o.value === v)?.label ?? v ?? ''
    return v ?? ''
  }

  // The numbers in a selection of several cells, as Excel's status bar: sum, average, count.
  const stats = (() => {
    if (rect.r1 === rect.r0 && rect.c1 === rect.c0) return null
    const values = []
    for (let r = rect.r0; r <= rect.r1; r += 1)
      for (let c = rect.c0; c <= rect.c1; c += 1) {
        const v = columns[c].type === 'number' ? valueOf(rows[r], columns[c]) : null
        if (v != null && v !== '' && Number.isFinite(Number(v))) values.push(Number(v))
      }
    if (!values.length) return null
    const sum = Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100
    return { sum, avg: Math.round((sum / values.length) * 100) / 100, count: values.length }
  })()

  // The leading sticky columns stay in sight: each one's distance from the left edge.
  const lefts = []
  columns.reduce((x, col, i) => {
    lefts[i] = col.sticky ? x : null
    return col.sticky ? x + (col.width ?? 120) : x
  }, 0)
  const stick = (i, z) => (lefts[i] == null ? undefined : { position: 'sticky', left: lefts[i], zIndex: z })
  // Headings over groups of columns, when the columns say so.
  const groups = columns.some((c) => c.group)
    ? columns.reduce((out, col) => {
        const last = out.at(-1)
        if (last && last.group === (col.group ?? '')) last.span += 1
        else out.push({ group: col.group ?? '', span: 1, key: col.key })
        return out
      }, [])
    : null
  const editCol = editing ? columns[editing.c] : null
  const suggestions = editing && editCol?.suggestions ? editCol.suggestions(rows[editing.r]) : null

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div
        ref={box}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPaste={onPaste}
        className="overflow-x-auto rounded-xl border border-slate-300 bg-white outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
        role="grid"
        aria-label={testid}
        title="Arrows move · type to replace · F2 or double click edits · Enter down, Tab right · Shift+arrows select · Ctrl+C / Ctrl+V with Excel · Ctrl+D fill down, Ctrl+R fill right · Delete clears · Ctrl+Z undo · a dropdown: Ctrl+Down / Ctrl+Up go through it, Alt+Down opens it"
        data-sheet={testid}
      >
        <table className="w-full table-fixed border-collapse text-sm" style={{ minWidth: columns.reduce((s, c) => s + (c.width ?? 120), 0) }}>
          <colgroup>
            {columns.map((c) => (
              <col key={c.key} style={{ width: c.width ?? 120 }} />
            ))}
          </colgroup>
          <thead>
            {groups && (
              <tr className="bg-slate-50">
                {groups.map((g) => (
                  <th key={g.key} colSpan={g.span} className="border-b border-r border-slate-300 px-2 pt-1.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-purple-700" data-sheet-group={g.group}>
                    {g.group}
                  </th>
                ))}
              </tr>
            )}
            <tr className="border-b border-slate-300 bg-slate-50/80">
              {columns.map((c, i) => (
                <th key={c.key} style={stick(i, 3)} className={`border-b border-r border-slate-300 bg-slate-50 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 align-bottom ${c.align === 'right' ? 'text-right' : 'text-left'}`} title={c.title ? undefined : c.hint}>
                  {c.label}
                  {c.sub && <span className="block font-normal normal-case tracking-normal text-slate-400">{c.sub}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={row.id} data-sheet-row={row.id}>
                {columns.map((col, c) => {
                  const isActive = r === at.r && c === at.c
                  const selected = inRect(rect, r, c) && (rect.r1 > rect.r0 || rect.c1 > rect.c0)
                  const canEdit = editable(row, col)
                  const isEditing = editing && editing.r === r && editing.c === c
                  return (
                    <td
                      key={col.key}
                      style={stick(c, 2)}
                      data-cell={`${r}:${c}`}
                      data-col={col.key}
                      data-editable={canEdit ? 'true' : undefined}
                      title={col.title?.(row) ?? undefined}
                      onMouseDown={(e) => {
                        if (isEditing) return
                        e.preventDefault()
                        box.current?.focus({ preventScroll: true })
                        if (e.shiftKey) setActive({ r, c })
                        else go({ r, c })
                        // A dropdown cell opens at the first click (economist: "the cell of the fallback will be changeable from the
                        // first interaction").
                        if (!e.shiftKey && col.type === 'select' && canEdit) return startEdit(r, c, 'edit')
                        dragging.current = true
                      }}
                      onMouseEnter={() => dragging.current && setActive({ r, c })}
                      onDoubleClick={() => startEdit(r, c, 'edit')}
                      className={`relative h-8 overflow-hidden border-b border-r border-slate-300 px-2 py-1 align-middle ${col.align === 'right' ? 'text-right tabular-nums' : 'text-left'} ${(() => {
                        const tone = rowTone?.(row)
                        if (tone) return `${canEdit ? `${tone.edit} text-slate-800` : `${tone.fixed} text-slate-500`} ${c === 0 ? `border-l-4 ${tone.edge}` : ''}`
                        return canEdit ? 'bg-white text-slate-800' : lefts[c] != null ? 'bg-slate-50 text-slate-500' : 'bg-slate-50/70 text-slate-500'
                      })()} ${selected ? '!bg-purple-50' : ''} ${col.tone?.(row) ?? ''}`}
                    >
                      {isEditing && col.type !== 'select' && (
                        <input
                          autoFocus
                          list={suggestions ? `${testid}-suggest` : undefined}
                          value={editing.text}
                          onChange={(e) => setEdit({ ...editRef.current, text: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') return (e.preventDefault(), finishEdit('commit', 'Enter', e.shiftKey))
                            if (e.key === 'Tab') return (e.preventDefault(), finishEdit('commit', 'Tab', e.shiftKey))
                            if (e.key === 'Escape') return (e.preventDefault(), finishEdit('cancel'))
                            if (editing.mode === 'enter' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return (e.preventDefault(), finishEdit('commit', e.key))
                          }}
                          onBlur={() => finishEdit('commit')}
                          className={`absolute inset-0 w-full border-2 border-purple-500 bg-white px-1.5 text-sm outline-none ${col.align === 'right' ? 'text-right' : ''} ${col.type === 'text' ? 'font-mono text-[12px]' : ''}`}
                          data-sheet-input
                        />
                      )}
                      {isEditing && col.type === 'select' && (
                        <select
                          autoFocus
                          // Its list opens at once (where the browser allows it), not at a second click.
                          ref={(el) => {
                            if (el && !el.dataset.opened) {
                              el.dataset.opened = '1'
                              try {
                                el.showPicker?.()
                              } catch {
                                // The browser keeps the list closed; the arrows and a click still choose.
                              }
                            }
                          }}
                          defaultValue={valueOf(row, col) ?? ''}
                          onChange={(e) => {
                            setEdit(null)
                            write([{ r, c, value: optionsOf(row, col).find((o) => String(o.value) === e.target.value)?.value ?? e.target.value }])
                            focusBox()
                          }}
                          onKeyDown={(e) => {
                            // Ctrl+Down / Ctrl+Up and Delete work here as on the closed cell.
                            const pick = (value) => {
                              e.preventDefault()
                              setEdit(null)
                              write([{ r, c, value }])
                              focusBox()
                            }
                            if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                              const opts = optionsOf(row, col)
                              const now = opts.findIndex((o) => o.value === (valueOf(row, col) ?? ''))
                              return pick(opts[(now + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length].value)
                            }
                            if (e.key === 'Delete' && col.clearTo !== undefined) return pick(col.clearTo)
                            if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab') {
                              e.preventDefault()
                              finishEdit('cancel', e.key === 'Escape' ? null : e.key, e.shiftKey)
                            }
                          }}
                          onBlur={() => finishEdit('cancel')}
                          className="absolute inset-0 w-full border-2 border-purple-500 bg-white px-1 text-sm outline-none"
                          data-sheet-select
                        >
                          {optionsOf(row, col).map((o) => (
                            <option key={String(o.value)} value={String(o.value)}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      )}
                      {!isEditing && <div className="truncate">{show(row, col)}</div>}
                      {isActive && !isEditing && <span className="pointer-events-none absolute inset-0 border-2 border-purple-500" aria-hidden="true" />}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {suggestions && (
          <datalist id={`${testid}-suggest`}>
            {suggestions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        )}
      </div>
      {/* Only what happened is said under the sheet; the keys are in the sheet's hover (economist: "less buttons and text"). */}
      {help && (note || stats) && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]" data-sheet-help={testid}>
          <span className={note && /not taken|cannot|Select the cells/.test(note) ? 'text-amber-700' : 'text-emerald-700'} data-sheet-note={testid}>
            {note}
          </span>
          {stats && (
            <span className="tabular-nums text-slate-600" data-sheet-stats={testid}>
              Sum {fmtNumber(stats.sum)} · Average {fmtNumber(stats.avg)} · Count {stats.count}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
