import { useEffect, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { gridWidthRem } from '../../../lib/gridWidth'
import { canPlaceGem, isGemAlreadyOnBoard, occupiedCells } from '../lib/diamondBoard'
import { footprintCells } from '../lib/gem'
import { cellConnections, cornerRounding } from '../lib/gemShape'

const BLOCKED_EMPTY_STYLE = 'bg-gradient-to-br from-indigo-900 to-slate-950 border border-indigo-900 shadow-inner'
const OPEN_EMPTY_STYLE = 'bg-violet-50 border-2 border-dashed border-violet-200'

const BRUSH_STYLE = {
  open: 'border-violet-300 bg-violet-50 text-violet-700',
  blocked: 'border-indigo-400 bg-indigo-50 text-indigo-700',
}

// The clickable board. Two modes, deliberately different interaction models:
// - "blocked": drag-paint (mirrors BoardGrid.jsx's brush exactly) toggling
//   whether a tile needs a double-tap to reveal.
// - "place": click-only, no drag (dragging must never rapid-fire multiple
//   placements). The armed gem + rotation come from the parent's palette;
//   this component only reads them to ghost-preview the footprint under the
//   cursor (green = fits, red = doesn't) and to attempt/report placement.
export default function MineBoardGrid({ board, gemsById, mode, armedGem, armedRotated, selectedPlacementId, onSetBlocked, onPlaceGem, onSelectPlacement }) {
  const [brush, setBrush] = useState('blocked')
  const [hoverCell, setHoverCell] = useState(null)
  const [rejectMessage, setRejectMessage] = useState(null)
  const paintingRef = useRef(false)

  useEffect(() => {
    const stop = () => {
      paintingRef.current = false
    }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  useEffect(() => {
    setRejectMessage(null)
  }, [mode, armedGem, armedRotated])

  const occupied = occupiedCells(board, gemsById)
  const gemInfoByCell = new Map()
  for (const placement of board.placements) {
    const gem = gemsById[placement.gemId]
    if (!gem) continue
    for (const { row, col } of footprintCells(placement, gem)) {
      gemInfoByCell.set(`${row},${col}`, { color: gem.color, name: gem.name, placementId: placement.id })
    }
  }

  let ghostCells = null
  let ghostValid = false
  if (mode === 'place' && armedGem && hoverCell) {
    ghostCells = new Set(
      footprintCells({ anchorRow: hoverCell.row, anchorCol: hoverCell.col, rotated: armedRotated }, armedGem).map(
        ({ row, col }) => `${row},${col}`,
      ),
    )
    ghostValid = canPlaceGem(board, armedGem, hoverCell.row, hoverCell.col, armedRotated, gemsById)
  }

  function paintCell(r, c) {
    const desired = brush === 'blocked'
    if (board.blocked[r][c] !== desired) onSetBlocked(r, c, desired)
  }

  function handleCellClick(r, c) {
    const placementId = occupied.get(`${r},${c}`)
    if (placementId) {
      onSelectPlacement(placementId)
      setRejectMessage(null)
      return
    }
    if (mode === 'place' && armedGem) {
      if (isGemAlreadyOnBoard(board, armedGem.id)) {
        setRejectMessage(`${armedGem.name} is already placed on this board — each gem can only appear once per board.`)
      } else if (canPlaceGem(board, armedGem, r, c, armedRotated, gemsById)) {
        onPlaceGem(r, c)
        setRejectMessage(null)
      } else {
        setRejectMessage("Doesn't fit there — out of bounds or overlapping another gem.")
      }
      return
    }
    onSelectPlacement(null)
  }

  const widthRem = gridWidthRem(board.cols)

  return (
    <div className="flex flex-col gap-3" style={{ maxWidth: `${widthRem}rem` }}>
      {mode === 'blocked' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mr-1">Brush</span>
          {['blocked', 'open'].map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => setBrush(state)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-xl border transition-all ${
                brush === state ? `${BRUSH_STYLE[state]} shadow-sm` : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span className={`w-3 h-3 rounded-sm inline-block ${state === 'blocked' ? BLOCKED_EMPTY_STYLE : OPEN_EMPTY_STYLE}`} />
              {state === 'blocked' ? 'Blocked (double-tap)' : 'Open'}
            </button>
          ))}
        </div>
      )}

      {mode === 'place' && rejectMessage && (
        <p className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-1.5">{rejectMessage}</p>
      )}

      <div
        className="inline-block bg-gradient-to-br from-indigo-50 via-violet-50 to-fuchsia-50 border border-violet-100 rounded-3xl p-4 shadow-inner select-none"
        onMouseLeave={() => setHoverCell(null)}
      >
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${board.cols}, minmax(0, 4.25rem))` }}>
          {board.blocked.map((row, r) =>
            row.map((isBlocked, c) => {
              const key = `${r},${c}`
              const gemInfo = gemInfoByCell.get(key)
              const ghostActive = ghostCells?.has(key)
              const isSelected = gemInfo?.placementId === selectedPlacementId
              const conn = gemInfo ? cellConnections(occupied, r, c) : null
              const corners = conn ? cornerRounding(conn) : null

              return (
                <button
                  key={key}
                  type="button"
                  onMouseDown={(e) => {
                    if (mode !== 'blocked') return
                    e.preventDefault()
                    paintingRef.current = true
                    paintCell(r, c)
                  }}
                  onMouseEnter={() => {
                    setHoverCell({ row: r, col: c })
                    if (mode === 'blocked' && paintingRef.current) paintCell(r, c)
                  }}
                  onClick={() => {
                    if (mode === 'place') handleCellClick(r, c)
                  }}
                  onDragStart={(e) => e.preventDefault()}
                  title={gemInfo ? `${gemInfo.name}${isBlocked ? ' · blocked (double-tap)' : ''}` : isBlocked ? 'blocked (double-tap)' : 'empty'}
                  className={[
                    'relative aspect-square transition-all shadow-[inset_0_2px_0_rgba(255,255,255,0.35)]',
                    gemInfo
                      ? [
                          'border-solid',
                          isSelected ? 'border-fuchsia-500' : 'border-white/70',
                          conn.top ? 'border-t-0' : 'border-t-2',
                          conn.bottom ? 'border-b-0' : 'border-b-2',
                          conn.left ? 'border-l-0' : 'border-l-2',
                          conn.right ? 'border-r-0' : 'border-r-2',
                          corners.tl ? 'rounded-tl-xl' : 'rounded-tl-none',
                          corners.tr ? 'rounded-tr-xl' : 'rounded-tr-none',
                          corners.bl ? 'rounded-bl-xl' : 'rounded-bl-none',
                          corners.br ? 'rounded-br-xl' : 'rounded-br-none',
                        ].join(' ')
                      : `rounded-xl ${isBlocked ? BLOCKED_EMPTY_STYLE : OPEN_EMPTY_STYLE}`,
                    mode === 'place' ? 'cursor-pointer hover:scale-[1.05] hover:z-10' : 'cursor-pointer',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{ backgroundColor: gemInfo ? gemInfo.color : undefined }}
                >
                  {ghostActive && (
                    <span className={`absolute inset-0 rounded-xl pointer-events-none ${ghostValid ? 'bg-emerald-400/55' : 'bg-red-500/55'}`} />
                  )}
                  {isBlocked && (
                    <Lock
                      size={13}
                      strokeWidth={2.75}
                      className="absolute top-1 right-1 pointer-events-none text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
                    />
                  )}
                </button>
              )
            }),
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className={`relative w-3.5 h-3.5 rounded-md inline-block ${BLOCKED_EMPTY_STYLE}`}>
            <Lock size={9} strokeWidth={3} className="absolute inset-0 m-auto text-white" />
          </span>
          Blocked (double-tap) — the lock icon marks it on any tile, gem or not
        </span>
        <span className="text-slate-400">
          {mode === 'place' ? '· click a palette gem, then click the board to place it' : '· click or drag to paint the selected brush'}
        </span>
      </div>
    </div>
  )
}
