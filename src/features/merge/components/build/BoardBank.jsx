import { Undo2 } from 'lucide-react'
import { bankLayoutsFor, bankLayoutOf, BANK_GROUPS } from '../../lib/core/boardBank'
import { FORCED_SEMI_CELL } from '../../lib/core/board'
import { LinkButton } from './buildUi'

// THE BANK OF LAYOUTS, as pictures to pick from (economist: "in the board
// layout ill just pick from the bank of boards which one we will use this
// time"). Picking one draws that layout on the board; the tiles can still be
// changed by hand below it. Every layout here is one the simulator solves
// (lib/core/boardBank.js).
// (The two tutorial cells are drawn as the empty space they are: "we need to
// see the boards only with the tiles on them".)
function Picture({ tiles, isFirstBoard }) {
  const cols = tiles[0].length
  return (
    <span className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${cols}, 0.62rem)` }} aria-hidden="true">
      {tiles.map((row, r) =>
        row.map((state, c) => {
          const fixed = isFirstBoard && r === FORCED_SEMI_CELL.row && c === FORCED_SEMI_CELL.col
          return (
            <span
              key={`${r}-${c}`}
              className={`h-[0.62rem] w-[0.62rem] rounded-[3px] ${
                state === 'blocked' ? 'bg-indigo-900' : state === 'semi' ? (fixed ? 'bg-teal-500' : 'bg-amber-400') : 'bg-slate-200/50'
              }`}
            />
          )
        }),
      )}
    </span>
  )
}

export default function BoardBank({ board, isFirstBoard, tutorialRule, onPick, canUndo, onUndo }) {
  const layouts = bankLayoutsFor(isFirstBoard)
  const current = bankLayoutOf(board, isFirstBoard)
  return (
    <div className="mb-4 rounded-2xl border border-slate-100 bg-slate-50/50 p-3" data-testid="board-bank" data-current={current?.id ?? ''}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Pick a ready-made layout</span>
        <span className="text-xs text-slate-500">
          {isFirstBoard ? 'For the first board.' : 'For a board after the first.'} The simulator solves every one of them. You can still change tiles by hand below.
        </span>
      </div>
      <div className="flex flex-wrap gap-x-6">
      {BANK_GROUPS.filter((group) => layouts.some((layout) => layout.group === group.id)).map((group) => (
      <div key={group.id} className="mt-2" data-bank-group={group.id}>
        <div className="mb-1 text-[11px] font-semibold text-slate-600">{group.name}</div>
        <div className="flex flex-wrap gap-2">
        {layouts.filter((layout) => layout.group === group.id).map((layout) => {
          const on = current?.id === layout.id
          return (
            <button
              key={layout.id}
              type="button"
              aria-pressed={on}
              title={layout.note}
              onClick={() => onPick(layout)}
              data-bank-layout={layout.id}
              className={`flex flex-col items-center gap-1.5 rounded-xl border px-2.5 py-2 transition-colors ${on ? 'border-purple-500 bg-purple-50 ring-2 ring-purple-200' : 'border-slate-200 bg-white hover:border-purple-300'}`}
            >
              <Picture tiles={layout.tiles} isFirstBoard={isFirstBoard} />
              <span className={`text-xs font-semibold whitespace-nowrap ${on ? 'text-purple-800' : 'text-slate-700'}`}>{layout.name}</span>
              <span className="text-[10px] leading-none text-slate-400 whitespace-nowrap">
                {layout.blocked + layout.semi} tiles · {layout.guides.length} guides{on ? ' · in use' : ''}
              </span>
            </button>
          )
        })}
        </div>
      </div>
      ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {isFirstBoard && (
          <span data-testid="board-bank-rules">
            Every first board keeps the rank-2 item in its fixed cell (<span className="font-semibold text-teal-600">teal</span>)
            {tutorialRule && (
              <>
                {' '}
                and the two bottom cells of the right column empty: the game&apos;s tutorial uses them
              </>
            )}
            .
          </span>
        )}
        <span data-testid="board-bank-guides">
          A <span className="font-semibold text-amber-600">guide</span> is a semi-blocked tile: the player sees its item, and merging into it opens the tiles beside it
          {isFirstBoard ? ' - on Board 1 it holds a rank 1, so one tap of the generator matches it' : ''}.
        </span>
        <span>Picking a layout replaces this board&apos;s tiles; what was built under them is made again by the next build.</span>
        {canUndo && (
          <LinkButton className="flex items-center gap-1 text-[11px]" onClick={onUndo} data-testid="board-bank-undo">
            <Undo2 size={11} /> Undo: back to the layout before
          </LinkButton>
        )}
      </div>
    </div>
  )
}
