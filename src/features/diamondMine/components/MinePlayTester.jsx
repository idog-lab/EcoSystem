import { useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, Gamepad2, Lock, Hash, Gem as GemIcon, LayoutGrid } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import { gridWidthRem } from '../../../lib/gridWidth'
import { createMinePlaySession, tapCell, advanceToNextBoard } from '../lib/minePlaySession'
import { cellConnections, cornerRounding } from '../lib/gemShape'
import { footprintCells } from '../lib/gem'
import { GEM_FOUND } from '../lib/mineCelebration'
import { GemFoundBurst, BoardClearedBanner } from './MineCelebration'
import GemShapeIcon from './GemShapeIcon'

const BOARD_CLEARED_DELAY_MS = 250
const AUTO_ADVANCE_MS = 1800

export default function MinePlayTester({ boards, gemsById, boardIndex }) {
  const [session, setSession] = useState(() => createMinePlaySession(boards, gemsById, boardIndex))
  const [celebration, setCelebration] = useState(null)
  const [showBanner, setShowBanner] = useState(false)
  const celebrationTimeout = useRef(null)
  const bannerDelayTimeout = useRef(null)
  const advanceTimeout = useRef(null)
  const nextCelebrationKey = useRef(0)

  useEffect(
    () => () => {
      clearTimeout(celebrationTimeout.current)
      clearTimeout(bannerDelayTimeout.current)
      clearTimeout(advanceTimeout.current)
    },
    [],
  )

  function clearAllTimeouts() {
    clearTimeout(celebrationTimeout.current)
    clearTimeout(bannerDelayTimeout.current)
    clearTimeout(advanceTimeout.current)
  }

  function reset() {
    clearAllTimeouts()
    setCelebration(null)
    setShowBanner(false)
    setSession(createMinePlaySession(boards, gemsById, boardIndex))
  }

  function celebrateGem(cells) {
    clearTimeout(celebrationTimeout.current)
    setCelebration({ key: nextCelebrationKey.current++, cells })
    celebrationTimeout.current = setTimeout(() => setCelebration(null), GEM_FOUND.duration)
  }

  function handleAdvance() {
    advanceToNextBoard(session)
    setShowBanner(false)
    setSession({ ...session })
  }

  function handleSkip() {
    clearTimeout(advanceTimeout.current)
    handleAdvance()
  }

  function handleTap(r, c) {
    const result = tapCell(session, r, c)
    if (result.gemCompleted) {
      const cells = session.footprintByPlacement.get(result.gemCompleted).map((key) => key.split(',').map(Number))
      celebrateGem(cells)
    }
    if (result.boardCleared) {
      bannerDelayTimeout.current = setTimeout(() => {
        setShowBanner(true)
        advanceTimeout.current = setTimeout(handleAdvance, AUTO_ADVANCE_MS)
      }, BOARD_CLEARED_DELAY_MS)
    }
    setSession({ ...session })
  }

  const board = session.boards[session.boardIndex]
  const placementsById = useMemo(() => Object.fromEntries(board.placements.map((p) => [p.id, p])), [board])
  const widthRem = gridWidthRem(board.cols)

  // A found placement's full footprint is reused for the tracker row below -
  // a placement counts as found only once every one of its cells is
  // individually 'revealed'.
  function isPlacementFound(placement, gem) {
    return footprintCells(placement, gem).every(({ row, col }) => session.cellState[row][col] === 'revealed')
  }

  return (
    <Card
      title="Play test"
      subtitle="Manually play this board chain — gems are hidden until fully revealed; clearing a board advances to the next one"
      icon={Gamepad2}
      action={
        <Button variant="secondary" size="sm" icon={RotateCcw} onClick={reset}>
          Reset
        </Button>
      }
    >
      {session.status === 'empty' ? (
        <p className="text-xs text-amber-600">This board has no gems placed yet — add some in the Boards tab first.</p>
      ) : session.status === 'all-cleared' ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <span className="font-display text-xl font-bold text-slate-800">All boards cleared! 🎉</span>
          <span className="text-sm text-slate-500">No more boards queued in this list — Reset to play again.</span>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-3">
            <Stat icon={Hash} label="Taps used" value={session.tapsUsed} />
            <Stat icon={GemIcon} label="Gems found" value={`${session.gemsFoundCount} / ${session.totalGems}`} />
            <Stat icon={LayoutGrid} label="Board" value={`${session.boardIndex + 1} of ${boards.length}`} />
          </div>

          <div className="flex flex-col gap-3" style={{ maxWidth: `${widthRem}rem` }}>
            <div className="flex flex-wrap gap-2">
              {board.placements.map((placement) => {
                const gem = gemsById[placement.gemId]
                if (!gem) return null
                const found = isPlacementFound(placement, gem)
                return (
                  <div
                    key={placement.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                      found ? 'border-purple-300 bg-purple-50 text-purple-700' : 'border-slate-200 bg-slate-50 text-slate-400'
                    }`}
                  >
                    <GemShapeIcon gem={gem} rotated={placement.rotated} cellSize={7} dim={!found} />
                    {gem.name}
                  </div>
                )
              })}
            </div>

            <div className="relative inline-block bg-gradient-to-br from-indigo-50 via-violet-50 to-fuchsia-50 border border-violet-100 rounded-3xl p-4 shadow-inner select-none">
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${board.cols}, minmax(0, 4.25rem))` }}>
                {session.cellState.map((row, r) =>
                  row.map((cellState, c) => {
                    const placementId = cellState === 'revealed' ? session.gemForCell.get(`${r},${c}`) : null
                    const gem = placementId != null ? gemsById[placementsById[placementId]?.gemId] : null
                    const isBlocked = board.blocked[r][c]
                    const bursting = celebration?.cells.some(([cr, cc]) => cr === r && cc === c)

                    let tileClass = 'rounded-xl bg-gradient-to-br from-indigo-900 to-slate-950 border border-indigo-900 shadow-inner'
                    if (cellState === 'cracked') tileClass = 'rounded-xl bg-gradient-to-br from-amber-700 to-stone-700 border border-amber-800 shadow-inner'
                    else if (cellState === 'revealed') {
                      if (gem) {
                        // Uses the gem's true, full footprint (every cell it
                        // covers, not just the ones already revealed) - a
                        // revealed cell should hint at the piece's real
                        // extent right away, even toward a still-hidden or
                        // still-cracked neighbor. Found live: with only
                        // revealed-to-revealed cells merging, a partially
                        // uncovered gem (e.g. one corner still cracked
                        // behind a blocked tile) looked smaller than it
                        // really was - the player read five open cells of a
                        // 3x2 gem as a complete 2x2, only discovering the
                        // sixth cell by chance. The unrevealed neighbor
                        // itself still renders fully hidden either way -
                        // this only changes the *revealed* cell's own edge
                        // treatment, never shows color/state for a cell
                        // that hasn't been tapped.
                        const conn = cellConnections(session.gemForCell, r, c)
                        const corners = cornerRounding(conn)
                        tileClass = [
                          'border-solid border-white/70',
                          conn.top ? 'border-t-0' : 'border-t-2',
                          conn.bottom ? 'border-b-0' : 'border-b-2',
                          conn.left ? 'border-l-0' : 'border-l-2',
                          conn.right ? 'border-r-0' : 'border-r-2',
                          corners.tl ? 'rounded-tl-xl' : 'rounded-tl-none',
                          corners.tr ? 'rounded-tr-xl' : 'rounded-tr-none',
                          corners.bl ? 'rounded-bl-xl' : 'rounded-bl-none',
                          corners.br ? 'rounded-br-xl' : 'rounded-br-none',
                        ].join(' ')
                      } else {
                        tileClass = 'rounded-xl bg-stone-100 border border-stone-200'
                      }
                    }

                    return (
                      <button
                        key={`${r}-${c}`}
                        type="button"
                        onClick={() => handleTap(r, c)}
                        title={cellState === 'revealed' ? (gem ? 'gem found' : 'empty') : isBlocked ? 'needs a double-tap' : 'tap to reveal'}
                        className={`relative aspect-square transition-all shadow-[inset_0_2px_0_rgba(255,255,255,0.35)] cursor-pointer hover:scale-[1.05] hover:z-10 ${tileClass}`}
                        style={gem ? { backgroundColor: gem.color } : undefined}
                      >
                        {cellState === 'hidden' && isBlocked && <Lock size={13} strokeWidth={2.75} className="absolute top-1 right-1 text-white/80" />}
                        {bursting && <GemFoundBurst key={celebration.key} />}
                      </button>
                    )
                  }),
                )}
              </div>
              {showBanner && <BoardClearedBanner onSkip={handleSkip} />}
            </div>

            <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
              <span className="flex items-center gap-1.5">
                <Lock size={11} className="text-slate-500" />
                Needs a double-tap to reveal
              </span>
              <span className="text-slate-400">· tap a hidden tile to reveal it — find every gem to clear the board</span>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 to-fuchsia-50 p-3 min-w-28">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-purple-700">
        <Icon size={12} strokeWidth={2.5} /> {label}
      </span>
      <span className="font-display text-xl font-bold tabular-nums text-purple-700">{value}</span>
    </div>
  )
}
