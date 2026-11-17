import { useEffect, useState } from 'react'
import { Dice5, Gauge, Grid3x3, MousePointerClick, Pickaxe, RotateCw, Trash2 } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import GemShapeIcon from './GemShapeIcon'
import MineBoardGrid from './MineBoardGrid'
import { placeGem, removePlacement, resizeDiamondBoard, setBlocked } from '../lib/diamondBoard'
import { computeMinClicks, computeDifficulty } from '../lib/diamondStats'
import { estimateClicksToClear } from '../lib/diamondSolver'
import { footprint } from '../lib/gem'

const DEFAULT_SOLVE_RUNS = 500

const MODES = [
  { id: 'place', label: 'Place gems', icon: MousePointerClick },
  { id: 'blocked', label: 'Paint blocked tiles', icon: Grid3x3 },
]

export default function MineBoardEditor({ board, gems, gemsById, onUpdateBoard }) {
  const [mode, setMode] = useState('place')
  const [armedGemId, setArmedGemId] = useState(null)
  const [armedRotated, setArmedRotated] = useState(false)
  const [selectedPlacementId, setSelectedPlacementId] = useState(null)
  const [resizeNotice, setResizeNotice] = useState(null)
  const [rotateError, setRotateError] = useState(null)
  const [solveResult, setSolveResult] = useState(null)
  const [solving, setSolving] = useState(false)
  const [solveProgress, setSolveProgress] = useState(0)
  // Run count is economist-editable (default 500, was a fixed 100) - a
  // plain draft string committed only when a run actually starts, so a
  // half-typed number never mid-triggers anything (nothing reads this live).
  const [runsDraft, setRunsDraft] = useState(String(DEFAULT_SOLVE_RUNS))
  const [runsUsed, setRunsUsed] = useState(DEFAULT_SOLVE_RUNS)

  // A cached simulation result would silently go stale the moment the board
  // changes underneath it (a new placement, a resize, a blocked tile) -
  // board is a fresh object on every such edit, so clearing it on any board
  // change (rather than trying to diff what changed) keeps it honest.
  useEffect(() => setSolveResult(null), [board])

  // estimateClicksToClear is async and chunked (yields every few runs) so
  // this never freezes the tab even at hundreds of runs on a large/dense
  // board - see its own comment in diamondSolver.js for why that matters for
  // the loading animation specifically, not just responsiveness.
  async function handleRunSolve() {
    const runs = Math.max(1, Number(runsDraft) || DEFAULT_SOLVE_RUNS)
    setRunsUsed(runs)
    setSolving(true)
    setSolveProgress(0)
    const result = await estimateClicksToClear(board, gemsById, runs, (done) => setSolveProgress(done))
    setSolveResult(result)
    setSolving(false)
  }

  // Committed on blur/Enter only, not per-keystroke - resizing drops any gem
  // that doesn't fit, so committing "1" while someone's still typing "12"
  // would permanently delete gems out from under them (same hazard as
  // Merge's board-count field, see BoardEditor.jsx).
  const [rowsDraft, setRowsDraft] = useState(String(board.rows))
  const [colsDraft, setColsDraft] = useState(String(board.cols))
  useEffect(() => setRowsDraft(String(board.rows)), [board.rows])
  useEffect(() => setColsDraft(String(board.cols)), [board.cols])

  // A selection tied to one mode's UI (its Rotate/Remove panel only renders
  // in "place" mode) shouldn't silently persist, highlighted with no way to
  // act on it, once the other mode is active.
  useEffect(() => setSelectedPlacementId(null), [mode])

  const armedGem = armedGemId ? gemsById[armedGemId] : null
  const selectedPlacement = board.placements.find((p) => p.id === selectedPlacementId) ?? null
  const selectedGem = selectedPlacement ? gemsById[selectedPlacement.gemId] : null

  const minClicks = computeMinClicks(board, gemsById)
  const difficulty = computeDifficulty(board, gemsById)
  const totalTiles = board.rows * board.cols
  const blockedTileCount = board.blocked.reduce((sum, row) => sum + row.filter(Boolean).length, 0)

  function commitResize() {
    const rows = Math.max(1, Number(rowsDraft) || board.rows)
    const cols = Math.max(1, Number(colsDraft) || board.cols)
    setRowsDraft(String(rows))
    setColsDraft(String(cols))
    const { board: resized, removedCount } = resizeDiamondBoard(board, rows, cols, gemsById)
    onUpdateBoard(resized)
    setResizeNotice(removedCount > 0 ? `${removedCount} gem${removedCount > 1 ? 's' : ''} removed — no longer fit after resizing.` : null)
    setSelectedPlacementId(null)
  }

  function handlePlaceGem(row, col) {
    if (!armedGem) return
    const next = placeGem(board, armedGem, row, col, armedRotated, gemsById)
    if (next) {
      onUpdateBoard(next)
      // Each gem can only appear once per board (see diamondBoard.js's
      // isGemAlreadyOnBoard) - this gem can never be placed again on this
      // board, so leaving it armed would just prime a click that's always
      // going to be rejected.
      setArmedGemId(null)
      setArmedRotated(false)
    }
  }

  function handleSelectPlacement(id) {
    setSelectedPlacementId(id)
    setRotateError(null)
  }

  function rotateSelected() {
    if (!selectedPlacement || !selectedGem) return
    const without = removePlacement(board, selectedPlacement.id)
    const rotated = placeGem(without, selectedGem, selectedPlacement.anchorRow, selectedPlacement.anchorCol, !selectedPlacement.rotated, gemsById)
    if (rotated) {
      onUpdateBoard(rotated)
      // placeGem mints a fresh id for the re-placed gem - carry the
      // selection forward to it, or the Rotate/Remove panel and the
      // board's highlight both vanish right after a successful rotate.
      setSelectedPlacementId(rotated.placements[rotated.placements.length - 1].id)
      setRotateError(null)
    } else {
      setRotateError("Can't rotate in place — it would overlap another gem or go out of bounds.")
    }
  }

  function removeSelected() {
    if (!selectedPlacement) return
    onUpdateBoard(removePlacement(board, selectedPlacement.id))
    setSelectedPlacementId(null)
    setRotateError(null)
  }

  return (
    <div className="flex flex-col gap-6 flex-1 min-w-0">
      <Card title={board.name} subtitle={`${board.rows} × ${board.cols} board`} icon={Grid3x3}>
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid grid-cols-2 gap-2 w-48">
            <label className="text-sm flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rows</span>
              <input
                type="number"
                min={1}
                max={12}
                value={rowsDraft}
                onChange={(e) => setRowsDraft(e.target.value)}
                onBlur={commitResize}
                onKeyDown={(e) => e.key === 'Enter' && commitResize()}
                className="border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-medium bg-white/70 focus:outline-none focus:ring-4 focus:ring-purple-200/60 focus:border-purple-400 transition-shadow"
              />
            </label>
            <label className="text-sm flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Columns</span>
              <input
                type="number"
                min={1}
                max={12}
                value={colsDraft}
                onChange={(e) => setColsDraft(e.target.value)}
                onBlur={commitResize}
                onKeyDown={(e) => e.key === 'Enter' && commitResize()}
                className="border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-medium bg-white/70 focus:outline-none focus:ring-4 focus:ring-purple-200/60 focus:border-purple-400 transition-shadow"
              />
            </label>
          </div>

          <div className="flex items-center gap-1 bg-slate-100/80 rounded-xl p-1">
            {MODES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all duration-150 ${
                  mode === id ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-sm shadow-purple-500/30' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon size={14} strokeWidth={2.25} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {resizeNotice && <p className="mt-3 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5">{resizeNotice}</p>}
      </Card>

      {mode === 'place' && (
        <Card title="Gem palette" subtitle="Click a gem to arm it, then click the board to place it" icon={MousePointerClick}>
          {gems.length === 0 ? (
            <p className="text-sm text-slate-400">No gems yet — add some in the Gems tab first.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {gems.map((gem) => {
                const isArmed = gem.id === armedGemId
                const alreadyOnBoard = board.placements.some((p) => p.gemId === gem.id)
                return (
                  <button
                    key={gem.id}
                    type="button"
                    disabled={alreadyOnBoard}
                    title={alreadyOnBoard ? `${gem.name} is already placed on this board` : undefined}
                    onClick={() => {
                      if (isArmed) {
                        setArmedGemId(null)
                        return
                      }
                      setArmedGemId(gem.id)
                      setArmedRotated(false)
                    }}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                      alreadyOnBoard
                        ? 'border-slate-100 bg-slate-50 text-slate-300 opacity-70 cursor-not-allowed'
                        : isArmed
                          ? 'border-purple-400 bg-purple-50 text-purple-700 shadow-sm'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <GemShapeIcon gem={gem} rotated={isArmed ? armedRotated : false} cellSize={8} />
                    {gem.name}
                  </button>
                )
              })}
            </div>
          )}

          {armedGem && (
            <div className="flex items-center gap-3 mt-4 pt-3 border-t border-slate-100">
              <Button variant="secondary" size="sm" icon={RotateCw} onClick={() => setArmedRotated((r) => !r)}>
                Rotate
              </Button>
              <span className="text-xs text-slate-500">
                Placing <strong className="text-slate-700">{armedGem.name}</strong> (
                {footprint(armedGem, armedRotated).rows}×{footprint(armedGem, armedRotated).cols}) — click an empty cell on the board for its top-left corner.
              </span>
            </div>
          )}

          {selectedPlacement && selectedGem && (
            <div className="flex items-center gap-3 mt-4 pt-3 border-t border-slate-100">
              <GemShapeIcon gem={selectedGem} rotated={selectedPlacement.rotated} cellSize={10} />
              <span className="text-xs font-semibold text-fuchsia-700">{selectedGem.name} selected</span>
              <Button variant="secondary" size="sm" icon={RotateCw} onClick={rotateSelected}>
                Rotate
              </Button>
              <Button variant="danger" size="sm" icon={Trash2} onClick={removeSelected}>
                Remove
              </Button>
              {rotateError && <span className="text-xs text-red-600">{rotateError}</span>}
            </div>
          )}
        </Card>
      )}

      <Card title="Board stats" subtitle="Recomputed live as you build" icon={Gauge}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-6">
            <Stat label="Blocked tiles" value={`${blockedTileCount} / ${totalTiles}`} hint={`${Math.round((blockedTileCount / totalTiles) * 100)}% of the board`} />
            {difficulty && (
              <>
                <Stat label="Min clicks to clear" value={minClicks} hint="if you already knew every gem's location" />
                <Stat label="Difficulty" value={`${difficulty.score} · ${difficulty.bucket}`} />
                <Stat label="Fill" value={`${Math.round(difficulty.fillRatio * 100)}%`} />
                <Stat label="Avg gem size" value={difficulty.avgPieceSize.toFixed(1)} />
                <Stat label="Blocked gem cells" value={`${Math.round(difficulty.blockedScore * 100)}%`} />
              </>
            )}
          </div>

          {!difficulty ? (
            <p className="text-sm text-slate-400">Place at least one gem to see difficulty and solve-simulation stats.</p>
          ) : (
            <div className="flex flex-col gap-2 pt-3 border-t border-slate-100">
              <div className="flex items-center gap-4 flex-wrap">
                {solving ? (
                  <div className="flex items-center gap-3">
                    <div className="relative w-9 h-9 shrink-0">
                      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-stone-400 shadow-inner" />
                      <Pickaxe
                        size={20}
                        strokeWidth={2.5}
                        className="absolute left-1 bottom-1.5 text-slate-500 animate-[pickaxe-swing_0.5s_ease-in-out_infinite]"
                        style={{ transformOrigin: '85% 85%' }}
                      />
                    </div>
                    <span className="text-xs text-slate-500">
                      Breaking rocks — simulating run {solveProgress}/{runsUsed}…
                    </span>
                  </div>
                ) : (
                  <>
                    <Button variant="secondary" size="sm" icon={Dice5} onClick={handleRunSolve}>
                      Run solve simulation
                    </Button>
                    <label className="flex items-center gap-1.5 text-xs text-slate-500">
                      <input
                        type="number"
                        min={1}
                        value={runsDraft}
                        onChange={(e) => setRunsDraft(e.target.value)}
                        className="w-20 border border-slate-200 rounded-lg px-1.5 py-1 text-xs text-slate-800 font-medium bg-white/70 focus:outline-none focus:ring-4 focus:ring-purple-200/60 focus:border-purple-400 transition-shadow"
                      />
                      runs
                    </label>
                  </>
                )}
                {!solveResult && !solving && (
                  <span className="text-xs text-slate-400">
                    Simulates two kinds of players tapping tiles with no hints — one purely random, one that knows the gem catalog and always plays
                    the best move it can find.
                  </span>
                )}
              </div>
              {solveResult && !solving && (
                <div className="flex flex-col gap-3 pt-1">
                  <SolveBar
                    label="Theoretical floor"
                    hint="if you already knew every gem's location"
                    mean={minClicks}
                    colorClass="bg-slate-400"
                    scaleMax={solveResult.blind.max}
                  />
                  <SolveBar
                    label="Blind guesswork"
                    hint="purely random taps, no memory"
                    mean={solveResult.blind.mean}
                    min={solveResult.blind.min}
                    max={solveResult.blind.max}
                    colorClass="bg-amber-500"
                    scaleMax={solveResult.blind.max}
                  />
                  <SolveBar
                    label="Smart play"
                    hint="knows the gem catalog, always hunts the cell with a guaranteed or best-odds find (weighing blocked tiles' extra tap cost)"
                    mean={solveResult.smart.mean}
                    min={solveResult.smart.min}
                    max={solveResult.smart.max}
                    colorClass="bg-purple-600"
                    scaleMax={solveResult.blind.max}
                  />
                  <span className="text-[11px] text-slate-400">Across {solveResult.runs} runs each.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card icon={Grid3x3} title="Board">
        <MineBoardGrid
          board={board}
          gemsById={gemsById}
          mode={mode}
          armedGem={armedGem}
          armedRotated={armedRotated}
          selectedPlacementId={selectedPlacementId}
          onSetBlocked={(r, c, value) => onUpdateBoard(setBlocked(board, r, c, value))}
          onPlaceGem={handlePlaceGem}
          onSelectPlacement={handleSelectPlacement}
        />
      </Card>
    </div>
  )
}

function Stat({ label, value, hint }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="font-display text-lg font-bold text-slate-800">{value}</span>
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </div>
  )
}

// One row of the solve-simulation comparison: a track sized to `scaleMax`
// (shared across all rows being compared, so their bars are relatively
// meaningful), a lightly-shaded band from min to max when this result has a
// real spread, and a solid marker at the mean. The theoretical floor has no
// min/max (it's a single deterministic number, not a distribution) - passed
// without them, it just renders as a bare marker with no shaded band.
function SolveBar({ label, hint, mean, min, max, colorClass, scaleMax }) {
  const pct = (v) => Math.min(100, (v / scaleMax) * 100)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        <span className="text-xs text-slate-500 shrink-0">
          {min != null ? (
            <>
              ~<strong className="text-slate-800">{mean}</strong> taps (range {min}–{max})
            </>
          ) : (
            <>
              <strong className="text-slate-800">{mean}</strong> taps
            </>
          )}
        </span>
      </div>
      <div className="relative h-2.5 rounded-full bg-slate-100 overflow-hidden">
        {min != null && (
          <div className={`absolute inset-y-0 rounded-full ${colorClass} opacity-25`} style={{ left: `${pct(min)}%`, width: `${pct(max) - pct(min)}%` }} />
        )}
        <div className={`absolute inset-y-0 w-1 rounded-full ${colorClass}`} style={{ left: `calc(${pct(mean)}% - 2px)` }} />
      </div>
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </div>
  )
}
