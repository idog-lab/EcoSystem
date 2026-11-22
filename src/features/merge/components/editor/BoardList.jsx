import { ChevronUp, ChevronDown, Copy, Trash2, Plus, LayoutGrid, Coins, Link2 } from 'lucide-react'
import NumberField from '../../../../components/ui/NumberField'
import GoalSolver from './GoalSolver'
import { invalidateLayout, isRecompletionBoard, FIRST_BOARD_SUBSIDY_CAP_DR } from '../../lib/core/board'
import { MIN_RANK, MAX_RANK, valueOf } from '../../lib/core/ranks'
import { hardMinRankFloor, hardMaxRankCeiling } from '../../lib/core/rankWindow'

// `layoutLocked`: true on every segment but the first (App.jsx's
// `layoutLocked`) - Segment 1's board layout (tile pattern + rank window)
// and board count/order are now synced to every other segment, so editing
// any of that here would just get silently overwritten by the sync effect
// on the next render. Disabling it here instead - with an explicit note -
// is the honest version of that: a locked field reads as "locked," not as
// "my edit mysteriously didn't stick."
//
// `readOnly`: the "Share planning" read-only link (App.jsx's PlanApp) - a
// coworker viewing a shared plan snapshot, not an economist editing. Folded
// into the same `locked` gate as `layoutLocked` below for every control that
// already needed disabling for that reason (add/duplicate/remove/move,
// min/max rank), since the two reasons never coexist in practice (PlanApp
// never passes `layoutLocked`, EditorApp never passes `readOnly`) but share
// an identical "don't let this look editable" treatment - just with its own
// banner copy, since "synced from Segment 1" would be actively wrong here.
export default function BoardList({
  // The highest rank a board may hold under tiles: 12, or 13 on a Recompletion
  // list (the chase there goes to rank 14).
  maxRankUnderTiles = MAX_RANK,
  // The most DR Board 1 may carry in a list of two or more boards (150; 300
  // on the Recompletion list).
  firstBoardCap = FIRST_BOARD_SUBSIDY_CAP_DR,
  boards,
  activeId,
  onSelect,
  onAdd,
  onDuplicate,
  onRemove,
  onMove,
  onUpdateBoard,
  targetSubsidy,
  layoutLocked = false,
  readOnly = false,
  // The Play Tester: the list only chooses the board to start on. Its
  // subsidy, rank limits and starting goal are edited in Build event (or the
  // advanced Editor), not beside a game in progress - changing them there put
  // the build out of date without the economist having meant to edit at all.
  pickOnly = false,
}) {
  const locked = layoutLocked || readOnly || pickOnly
  return (
    <div className="flex flex-col gap-3 w-72 shrink-0">
      <h2 className="font-display text-sm font-bold text-slate-800 px-1 tracking-tight">{pickOnly ? 'Start on board' : 'Boards'}</h2>
      {pickOnly && (
        <p className="px-1 text-xs text-slate-500" data-testid="board-pick-note">
          Pick the board to start playing on. To change a board, use Build event (or the advanced Editor).
        </p>
      )}

      {layoutLocked && (
        <div className="flex items-start gap-2 text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded-xl px-2.5 py-2">
          <Link2 size={13} className="shrink-0 mt-0.5" />
          <span>Board layout, rank window, and board count/order are synced from Segment 1 — switch there to edit them.</span>
        </div>
      )}
      {readOnly && (
        <div className="flex items-start gap-2 text-xs text-slate-600 bg-slate-100 border border-slate-200 rounded-xl px-2.5 py-2">
          <Link2 size={13} className="shrink-0 mt-0.5" />
          <span>Read-only shared plan — editing is disabled.</span>
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {boards.map((board, i) => {
          const active = board.id === activeId
          return (
            <li
              key={board.id}
              className={`group relative flex flex-col gap-1 rounded-2xl border px-2.5 py-2 transition-all duration-150 overflow-hidden ${
                active
                  ? 'border-purple-200 bg-gradient-to-r from-purple-50 to-fuchsia-50 shadow-sm'
                  : 'border-transparent bg-white/70 hover:border-slate-200 hover:bg-white'
              }`}
            >
              {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full bg-gradient-to-b from-purple-500 to-fuchsia-500" />}
              <div className="flex items-center gap-1">
                <button type="button" className="flex-1 flex items-center gap-2 text-left min-w-0 pl-1" onClick={() => onSelect(board.id)}>
                  <LayoutGrid size={15} className={active ? 'text-purple-500' : 'text-slate-400'} />
                  <span className={`text-sm truncate ${active ? 'text-purple-900 font-semibold' : 'text-slate-700'}`}>{board.name}</span>
                  {i === 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 text-white font-semibold shrink-0">
                      special
                    </span>
                  )}
                </button>

                {!locked && (
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
                )}
              </div>

              {active && !pickOnly && (
                <div className="flex flex-col gap-3 pt-2.5 mt-1 pl-1 border-t border-purple-200/60">
                  <div className="flex flex-col gap-2">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <Coins size={12} strokeWidth={2.5} /> Subsidy & rank window
                    </span>
                    {/* The last board auto-fills to whatever's needed to hit
                        the target subsidy (BoardEditor.jsx's own effect) -
                        its field is read-only here too while a target is
                        set, so it reads the same wherever it's edited from
                        (this sidebar bubble, or the Total Subsidy card's own
                        per-board list) rather than looking editable and
                        then silently snapping back. */}
                    <NumberField
                      label="Blocked value (DR)"
                      min={0}
                      max={valueOf(MAX_RANK)}
                      hint={
                        targetSubsidy != null && i === boards.length - 1
                          ? 'Auto-filled to hit the subsidy needed — edit an earlier board or the Total demand field instead'
                          : targetSubsidy != null && i === 0 && boards.length >= 2
                            ? `Capped at ${firstBoardCap} DR — a higher value snaps back down, and the rest flows to the last board`
                            : `Can't exceed ${valueOf(MAX_RANK)} — the full chain's total value`
                      }
                      value={board.blockedValue}
                      disabled={(targetSubsidy != null && i === boards.length - 1) || readOnly}
                      onChange={(e) =>
                        onUpdateBoard(invalidateLayout(board, { blockedValue: Math.min(Number(e.target.value) || 0, valueOf(MAX_RANK)) }))
                      }
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <NumberField
                        label="Min rank"
                        min={MIN_RANK}
                        max={MAX_RANK}
                        value={board.minRank}
                        disabled={locked}
                        hint={
                          readOnly
                            ? 'Read-only shared plan'
                            : layoutLocked
                              ? 'Synced from Segment 1 — switch there to edit it'
                              : hardMinRankFloor(i) != null
                                ? `Hardcoded: this board never generates rank ${
                                    hardMinRankFloor(i) === 2 ? '1' : `1–${hardMinRankFloor(i) - 1}`
                                  } items, regardless of this field`
                                : undefined
                        }
                        onChange={(e) => onUpdateBoard(invalidateLayout(board, { minRank: Number(e.target.value) || MIN_RANK }))}
                      />
                      <NumberField
                        label="Max rank"
                        min={MIN_RANK}
                        max={maxRankUnderTiles}
                        value={board.maxRank}
                        disabled={locked}
                        hint={
                          readOnly
                            ? 'Read-only shared plan'
                            : layoutLocked
                              ? 'Synced from Segment 1 — switch there to edit it'
                              : hardMaxRankCeiling(i) != null
                                ? `Hardcoded: this board never generates above rank ${hardMaxRankCeiling(i)}, regardless of this field`
                                : undefined
                        }
                        onChange={(e) => onUpdateBoard(invalidateLayout(board, { maxRank: Number(e.target.value) || MAX_RANK }))}
                      />
                    </div>
                  </div>

                  {i === 0 && !isRecompletionBoard(board) && (
                    <div className="pt-2.5 border-t border-purple-200/60">
                      <GoalSolver board={board} onChange={onUpdateBoard} readOnly={readOnly} />
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {!locked && (
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-300 text-slate-500 text-sm font-medium py-2 hover:border-purple-300 hover:text-purple-600 hover:bg-purple-50/50 transition-colors"
        >
          <Plus size={15} /> Add board
        </button>
      )}
    </div>
  )
}
