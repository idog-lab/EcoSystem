import { footprint } from '../lib/gem'

// Small shared visual: a gem's footprint as a mini grid of colored cells.
// Reused in the library, the placement palette, and the board grid itself.
// `dim`, used by the play tester's above-board gem tracker, swaps the real
// color for a neutral grey - the tracker shows every gem's shape upfront so
// the player knows what to look for, but only fills in its true color once
// that placement is actually fully found on the board.
export default function GemShapeIcon({ gem, rotated = false, cellSize = 10, dim = false }) {
  const { rows, cols } = footprint(gem, rotated)
  return (
    <div
      className="inline-grid gap-[2px] rounded-md overflow-hidden shadow-sm shrink-0"
      style={{ gridTemplateRows: `repeat(${rows}, ${cellSize}px)`, gridTemplateColumns: `repeat(${cols}, ${cellSize}px)` }}
    >
      {Array.from({ length: rows * cols }).map((_, i) => (
        <div key={i} className={dim ? 'bg-slate-200' : ''} style={dim ? undefined : { backgroundColor: gem.color }} />
      ))}
    </div>
  )
}
