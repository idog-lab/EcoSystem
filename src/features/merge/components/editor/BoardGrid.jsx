import { useEffect, useRef, useState } from 'react'
import { colorForRank, valueOf, MIN_RANK, MAX_RANK } from '../../lib/core/ranks'
import { gridWidthRem } from '../../../../lib/gridWidth'
import { decodeReward, REWARD_TYPE_LABELS } from '../../lib/rewards/rewardChain'

const ALL_RANKS = Array.from({ length: MAX_RANK - MIN_RANK + 1 }, (_, i) => i + MIN_RANK)

const STATE_STYLE = {
  open: 'bg-violet-50 border-2 border-dashed border-violet-200',
  blocked: 'bg-gradient-to-br from-indigo-900 to-slate-950 border border-indigo-900 shadow-inner',
  semi: 'bg-gradient-to-br from-amber-300 to-amber-500 border border-amber-500 shadow-sm',
}

// Once a tile holds a placed item, its background becomes the rank color —
// these borders keep the underlying blocked/semi state visible on top of it.
// White reads reliably against every color in the rank ramp, so the state
// is distinguished by border style (solid vs dashed) rather than color.
const FILLED_BORDER_STYLE = {
  blocked: 'border-[3px] border-solid border-white/90',
  semi: 'border-[3px] border-dashed border-white/90',
}

const BRUSH_STYLE = {
  open: 'border-violet-300 bg-violet-50 text-violet-700',
  semi: 'border-amber-400 bg-amber-50 text-amber-700',
  blocked: 'border-indigo-400 bg-indigo-50 text-indigo-700',
}

const STATES = [
  { state: 'open', label: 'Open' },
  { state: 'semi', label: 'Semi-blocked' },
  { state: 'blocked', label: 'Blocked' },
]

// forcedRanks: economist-authored {row, col, rank} overrides (board.js's
// forcedSemiRanks) - "insert a specific rank into a cell as semi blocked."
// Independent of `placements` (the real, already-generated result): a
// forced rank takes effect at the next "Generate items" click, so between
// setting it and actually regenerating there's nothing in `placements` yet
// at that cell - `forcedRanks` lets the tile preview that pending value in
// the meantime instead of looking like a plain, rank-less semi tile.
// maxBrushRank: the highest rank the "Rank" brush offers for a semi-blocked tile -
// 12, or 13 on a Recompletion board (the chase there goes to rank 14).
// minBrushRank: the lowest rank it offers - 3 on a Recompletion board, which
// holds nothing below rank 3.
export default function BoardGrid({ tiles, placements, forcedRanks, onPaint, onFillAll, maxBrushRank = MAX_RANK, minBrushRank = 1 }) {
  const [brush, setBrush] = useState('blocked')
  // Which rank (if any) painting a semi tile should also force there - null
  // means "Auto" (the ordinary behavior: let generation decide, same as
  // before this existed). Persists across brush switches so picking rank 5
  // once, painting a few tiles, switching to Blocked and back to
  // Semi-blocked doesn't reset the choice.
  const [semiRank, setSemiRank] = useState(null)
  // A ref, not state: mousedown/mouseenter/mouseup fire faster than React
  // can re-render, so a state-backed flag can be stale by the time the next
  // tile's mouseenter checks it, letting the drag leak onto that tile.
  const paintingRef = useRef(false)

  useEffect(() => {
    const stop = () => {
      paintingRef.current = false
    }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  const placementByCell = new Map()
  for (const p of placements ?? []) {
    placementByCell.set(`${p.row},${p.col}`, p.rank)
  }
  const forcedByCell = new Map()
  for (const f of forcedRanks ?? []) {
    forcedByCell.set(`${f.row},${f.col}`, f.rank)
  }

  function paint(r, c) {
    if (tiles[r][c] !== brush || (brush === 'semi' && semiRank != null)) onPaint(r, c, brush, brush === 'semi' ? semiRank : null)
  }

  const cols = tiles[0]?.length ?? 0
  // Toolbar/legend text is long enough to not wrap on its own on a wide
  // screen — without a cap, the card stretches to match that text instead of
  // the actual tile grid. Cap it to the grid's own width so those rows wrap
  // instead.
  const widthRem = gridWidthRem(cols)

  return (
    <div className="flex flex-col gap-3" style={{ maxWidth: `${widthRem}rem` }}>
      {onPaint && (
        <div className="flex items-center gap-3 flex-wrap justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mr-1">Brush</span>
            {STATES.map(({ state, label }) => (
              <button
                key={state}
                type="button"
                onClick={() => setBrush(state)}
                className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-xl border transition-all ${
                  brush === state ? `${BRUSH_STYLE[state]} shadow-sm` : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className={`w-3 h-3 rounded-sm inline-block ${STATE_STYLE[state]}`} />
                {label}
              </button>
            ))}
          </div>

          {onFillAll && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mr-1">Fill all</span>
              <button
                type="button"
                onClick={() => onFillAll('open')}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-xl border border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50 transition-colors"
              >
                Open
              </button>
              <button
                type="button"
                onClick={() => onFillAll('blocked')}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-xl border border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50 transition-colors"
              >
                Blocked
              </button>
            </div>
          )}
        </div>
      )}

      {onPaint && brush === 'semi' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mr-1">Rank</span>
          <button
            type="button"
            onClick={() => setSemiRank(null)}
            title="Let generation decide this tile's rank, same as before - the default"
            className={`text-xs font-semibold px-2.5 py-1.5 rounded-xl border transition-all ${
              semiRank == null
                ? 'border-amber-400 bg-amber-50 text-amber-700 shadow-sm'
                : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            Auto
          </button>
          {[...ALL_RANKS, ...Array.from({ length: Math.max(0, maxBrushRank - MAX_RANK) }, (_, i) => MAX_RANK + 1 + i)].filter((rank) => rank >= minBrushRank).map((rank) => (
            <button
              key={rank}
              type="button"
              onClick={() => setSemiRank(rank)}
              title={`Force this rank (${valueOf(rank)} DR) onto whichever semi tile you paint next - survives "Generate items" instead of being overwritten by it`}
              className={`w-7 h-7 rounded-lg text-white text-xs font-bold flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-all ${
                semiRank === rank ? 'ring-2 ring-offset-1 ring-offset-white ring-slate-700 scale-110' : 'opacity-60 hover:opacity-100'
              }`}
              style={{ backgroundColor: colorForRank(rank) }}
            >
              {rank}
            </button>
          ))}
          <span className="text-xs text-slate-400">
            · picking a rank forces it onto the next semi tile you paint (kept across "Generate items")
          </span>
        </div>
      )}

      <div className="inline-block bg-gradient-to-br from-indigo-50 via-violet-50 to-fuchsia-50 border border-violet-100 rounded-3xl p-4 shadow-inner select-none">
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${tiles[0]?.length ?? 0}, minmax(0, 4.25rem))` }}
        >
          {tiles.map((row, r) =>
            row.map((state, c) => {
              const rank = placementByCell.get(`${r},${c}`)
              // A forced rank previews here only until the next real
              // generation catches up - once `placements` has a real entry
              // for this cell (post-"Generate items"), that always wins;
              // this is purely a "here's what you just set, before it's
              // actually been baked in" preview.
              const forcedRank = state === 'semi' && rank == null ? forcedByCell.get(`${r},${c}`) : undefined
              const showRank = rank ?? forcedRank
              // A reward item on a semi tile (V2) renders as its own gold
              // tile - type + reward rank, never a main rank/DR value.
              const reward = decodeReward(showRank)
              return (
                <button
                  key={`${r}-${c}`}
                  type="button"
                  onMouseDown={(e) => {
                    if (!onPaint) return
                    e.preventDefault()
                    paintingRef.current = true
                    paint(r, c)
                  }}
                  onMouseEnter={() => paintingRef.current && paint(r, c)}
                  onDragStart={(e) => e.preventDefault()}
                  title={
                    reward
                      ? `${REWARD_TYPE_LABELS[reward.type]} reward, rank ${reward.rank} · ${state} · counts toward the collectible payout, not main-chain DR`
                      : showRank
                        ? `rank ${showRank} (${valueOf(showRank)} DR) · ${state}${forcedRank != null ? ' · forced - applies on next Generate' : ''}`
                        : state
                  }
                  className={`relative aspect-square rounded-xl text-white flex flex-col items-center justify-center leading-tight transition-all shadow-[inset_0_2px_0_rgba(255,255,255,0.35)] ${
                    showRank ? FILLED_BORDER_STYLE[state] : STATE_STYLE[state]
                  } ${onPaint ? 'cursor-pointer hover:scale-[1.06] hover:shadow-lg hover:z-10' : ''}`}
                  style={
                    reward
                      ? { background: 'linear-gradient(135deg, #fcd34d, #facc15)' }
                      : showRank
                        ? { backgroundColor: colorForRank(showRank), opacity: forcedRank != null ? 0.75 : 1 }
                        : undefined
                  }
                >
                  {reward && (
                    <>
                      <span className="font-display text-[11px] font-bold text-amber-900 leading-none">{REWARD_TYPE_LABELS[reward.type].split(' ')[0]}</span>
                      <span className="text-[10px] font-semibold text-amber-800">R{reward.rank}</span>
                    </>
                  )}
                  {showRank && !reward && (
                    <>
                      <span className="font-display text-base font-bold drop-shadow-sm">{showRank}</span>
                      <span className="text-[10px] font-semibold opacity-85">{valueOf(showRank)} DR</span>
                    </>
                  )}
                  {/* Small pending marker on a forced-but-not-yet-generated
                      cell, so "this is a preview" reads at a glance without
                      needing to hover for the tooltip. */}
                  {forcedRank != null && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-white shadow ring-1 ring-slate-900/20" />
                  )}
                </button>
              )
            }),
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
        {STATES.map(({ state, label }) => (
          <span key={state} className="flex items-center gap-1.5">
            <span className={`w-3.5 h-3.5 rounded-md inline-block ${STATE_STYLE[state]}`} />
            {label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded-md inline-block bg-slate-400 border-[3px] border-solid border-white" />
          Filled + blocked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded-md inline-block bg-slate-400 border-[3px] border-dashed border-white" />
          Filled + semi
        </span>
        <span className="text-slate-400">· tile shows rank and its DR value</span>
        {onPaint && <span className="text-slate-400">· click or drag to paint the selected brush</span>}
      </div>
    </div>
  )
}
