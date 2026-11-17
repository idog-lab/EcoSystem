import { useState } from 'react'
import { ChevronUp, ChevronDown, Copy, Trash2, Plus, LayoutGrid, Sparkles } from 'lucide-react'
import Button from '../../../components/ui/Button'
import { occupiedCells } from '../lib/diamondBoard'
import { generateDiamondBoard } from '../lib/diamondGenerator'
import { DIFFICULTY_BUCKETS } from '../lib/diamondStats'

export default function MineBoardList({ boards, activeId, onSelect, onAdd, onDuplicate, onRemove, onMove, gems, onGenerate }) {
  const [genRows, setGenRows] = useState(6)
  const [genCols, setGenCols] = useState(6)
  const [genBucket, setGenBucket] = useState('Medium')
  // Fill % is non-critical and left "unset" (empty string, generator picks
  // freely) by default. Blocked tiles defaults to 0 instead - by explicit
  // economist request, a freshly generated board starts with none rather
  // than the generator deciding an arbitrary blocked count on its own; typing
  // a different number still opts back into an explicit target.
  const [genFillPercent, setGenFillPercent] = useState('')
  const [genBlockedTiles, setGenBlockedTiles] = useState('0')
  // Generator-only exclusions, matched by the gem's own name - the smallest
  // default gems (1x1 "a"; the two-cell "b"/"c" pair) can make a generated
  // board feel too easy, so the economist can opt either out of the
  // generator's own pick pool without touching the Gem Library itself. Pure
  // local UI state, same as the rows/cols/bucket fields above - not
  // persisted, and doesn't affect any already-placed gem on any board.
  const [excludeA, setExcludeA] = useState(false)
  const [excludeBC, setExcludeBC] = useState(false)
  const [lastResult, setLastResult] = useState(null)

  const usableGems = gems.filter((g) => !(excludeA && g.name === 'a') && !(excludeBC && (g.name === 'b' || g.name === 'c')))

  function handleGenerate() {
    const result = generateDiamondBoard({
      rows: genRows,
      cols: genCols,
      targetBucket: genBucket,
      gems: usableGems,
      targetFillPercent: genFillPercent === '' ? null : Number(genFillPercent),
      targetBlockedTiles: genBlockedTiles === '' ? null : Number(genBlockedTiles),
    })
    onGenerate(result.board)
    setLastResult(result)
  }

  return (
    <div className="flex flex-col gap-3 w-72 shrink-0">
      <h2 className="font-display text-sm font-bold text-slate-800 px-1 tracking-tight">Boards</h2>

      <ul className="flex flex-col gap-1.5">
        {boards.map((board, i) => {
          const active = board.id === activeId
          return (
            <li
              key={board.id}
              className={`group relative flex items-center gap-1 rounded-2xl border px-2.5 py-2 transition-all duration-150 overflow-hidden ${
                active ? 'border-purple-200 bg-gradient-to-r from-purple-50 to-fuchsia-50 shadow-sm' : 'border-transparent bg-white/70 hover:border-slate-200 hover:bg-white'
              }`}
            >
              {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full bg-gradient-to-b from-purple-500 to-fuchsia-500" />}
              <button type="button" className="flex-1 flex items-center gap-2 text-left min-w-0 pl-1" onClick={() => onSelect(board.id)}>
                <LayoutGrid size={15} className={active ? 'text-purple-500' : 'text-slate-400'} />
                <span className={`text-sm truncate ${active ? 'text-purple-900 font-semibold' : 'text-slate-700'}`}>{board.name}</span>
                <span className="text-[10px] text-slate-400 shrink-0">
                  {board.rows}×{board.cols}
                </span>
              </button>

              <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button type="button" title="Move up" disabled={i === 0} onClick={() => onMove(i, i - 1)} className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-0">
                  <ChevronUp size={14} />
                </button>
                <button type="button" title="Move down" disabled={i === boards.length - 1} onClick={() => onMove(i, i + 1)} className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-0">
                  <ChevronDown size={14} />
                </button>
                <button type="button" title="Duplicate" onClick={() => onDuplicate(board.id)} className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                  <Copy size={13} />
                </button>
                <button
                  type="button"
                  title="Remove"
                  disabled={boards.length <= 1}
                  onClick={() => onRemove(board.id)}
                  className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-0"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={onAdd}
        className="flex items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-300 text-slate-500 text-sm font-medium py-2 hover:border-purple-300 hover:text-purple-600 hover:bg-purple-50/50 transition-colors"
      >
        <Plus size={15} /> Add board
      </button>

      <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/70 p-3 mt-1">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <Sparkles size={12} strokeWidth={2.5} /> Generate a board
        </span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            max={12}
            value={genRows}
            onChange={(e) => setGenRows(Math.max(1, Number(e.target.value) || 1))}
            className="w-14 border border-slate-200 rounded-lg px-1.5 py-1 text-xs text-slate-800 font-medium bg-white/70"
            title="Rows"
          />
          <span className="text-xs text-slate-400">×</span>
          <input
            type="number"
            min={1}
            max={12}
            value={genCols}
            onChange={(e) => setGenCols(Math.max(1, Number(e.target.value) || 1))}
            className="w-14 border border-slate-200 rounded-lg px-1.5 py-1 text-xs text-slate-800 font-medium bg-white/70"
            title="Columns"
          />
          <select
            value={genBucket}
            onChange={(e) => setGenBucket(e.target.value)}
            className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-800 font-medium bg-white/70"
          >
            {DIFFICULTY_BUCKETS.map((b) => (
              <option key={b.label} value={b.label}>
                {b.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            max={100}
            placeholder="auto"
            value={genFillPercent}
            onChange={(e) => setGenFillPercent(e.target.value)}
            className="w-16 border border-slate-200 rounded-lg px-1.5 py-1 text-xs text-slate-800 font-medium bg-white/70 placeholder:text-slate-400"
            title="Gem fill % of board (optional)"
          />
          <span className="text-[11px] text-slate-400 shrink-0">% gem fill</span>
          <input
            type="number"
            min={0}
            placeholder="auto"
            value={genBlockedTiles}
            onChange={(e) => setGenBlockedTiles(e.target.value)}
            className="w-16 border border-slate-200 rounded-lg px-1.5 py-1 text-xs text-slate-800 font-medium bg-white/70 placeholder:text-slate-400"
            title="Number of blocked tiles (optional, can land on or off gems)"
          />
          <span className="text-[11px] text-slate-400 shrink-0">blocked</span>
        </div>

        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <input type="checkbox" checked={excludeA} onChange={(e) => setExcludeA(e.target.checked)} className="accent-purple-600" />
            Don't use gem "a" (1×1)
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <input type="checkbox" checked={excludeBC} onChange={(e) => setExcludeBC(e.target.checked)} className="accent-purple-600" />
            Don't use gems "b" &amp; "c" (1×2, 2×1)
          </label>
        </div>

        <Button variant="primary" size="sm" icon={Sparkles} onClick={handleGenerate} disabled={usableGems.length === 0}>
          Generate
        </Button>
        {gems.length === 0 ? (
          <span className="text-[11px] text-slate-400">Add gems in the Gems tab first.</span>
        ) : (
          usableGems.length === 0 && <span className="text-[11px] text-slate-400">All gems are excluded by the toggles above — turn one off to generate.</span>
        )}
        {lastResult && (
          <span className="text-[11px] text-slate-500">
            Achieved <strong>{lastResult.achievedScore ?? '—'}</strong> ({lastResult.achievedBucket ?? 'n/a'}) vs. target {lastResult.targetBucket} —{' '}
            {(() => {
              const gemsById = Object.fromEntries(gems.map((g) => [g.id, g]))
              const totalCells = lastResult.board.rows * lastResult.board.cols
              const fillPct = Math.round((occupiedCells(lastResult.board, gemsById).size / totalCells) * 100)
              const blockedCount = lastResult.board.blocked.reduce((sum, row) => sum + row.filter(Boolean).length, 0)
              return `${fillPct}% filled, ${blockedCount} blocked tiles`
            })()}
            .
          </span>
        )}
      </div>
    </div>
  )
}
