import { useState } from 'react'
import { TriangleAlert, Undo2 } from 'lucide-react'
import Button from '../../../components/ui/Button'
import { planLegacyRecovery, applyLegacyRecovery, undoLegacyRecovery } from '../lib/legacyRecompletion'

const ACTIONS = [
  { id: 'append', label: 'Add its boards after the current ones' },
  { id: 'replace', label: 'Replace the current boards with it' },
  { id: 'discard', label: 'Discard it' },
]

function BoardList({ title, boards, total }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      {boards.length === 0 ? (
        <div className="text-sm text-slate-400">nothing</div>
      ) : (
        <ol className="mt-1 text-sm text-slate-700 tabular-nums">
          {boards.map((b, i) => (
            <li key={i} className="flex justify-between gap-4">
              <span>
                {i + 1}. {b.name}
                {b.from === 'legacy' && <span className="ml-1 text-[11px] text-amber-700">recovered</span>}
              </span>
              <span>
                {b.rows}×{b.cols} · {b.budget} DR
                {b.rewardPins > 0 && ` · ${b.rewardPins} pinned reward item${b.rewardPins === 1 ? '' : 's'}`}
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-1 border-t border-slate-100 pt-1 text-sm font-semibold text-slate-700 flex justify-between">
        <span>Total subsidy budget</span>
        <span className="tabular-nums">{total} DR</span>
      </div>
    </div>
  )
}

// There is ONE Recompletion mode. A project saved when a second list
// ("Recompletion B") existed still has that list's data, kept aside and
// unused. This is the only place it can be brought back - as an explicit
// recovery the economist previews and confirms, never automatically - and
// every recovery leaves a snapshot it can be undone from.
export default function LegacyRecompletionRecovery({ segment, list, isBaseSegment }) {
  const [action, setAction] = useState(null)
  const legacy = segment.legacyRecompletionB
  const recovery = segment.recompletionRecovery

  if (!legacy && !recovery) return null

  if (!legacy && recovery) {
    return (
      <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 flex flex-wrap items-center gap-3" data-testid="legacy-recovery-done">
        <span className="flex-1 min-w-[18rem]">
          The older second Recompletion list was {recovery.action === 'append' ? 'added after the current boards' : recovery.action === 'replace' ? 'used in place of the previous boards' : 'discarded'}.
          A recovery snapshot of both lists as they were is kept in this project.
        </span>
        <Button
          variant="secondary"
          size="sm"
          icon={Undo2}
          onClick={() => undoLegacyRecovery({ segment, list })}
          data-testid="legacy-recovery-undo"
        >
          Undo this recovery
        </Button>
        <Button variant="ghost" size="sm" onClick={() => segment.setRecompletionRecovery(null)}>
          Dismiss (delete the snapshot)
        </Button>
      </div>
    )
  }

  const plan = action ? planLegacyRecovery({ action, currentBoards: list.boards, legacy }) : null
  const legacyTotal = legacy.boards.reduce((s, b) => s + (b.blockedValue ?? 0), 0)

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="legacy-recompletion-b">
      <div className="flex items-start gap-2">
        <TriangleAlert size={16} className="shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-semibold">Data from an older second Recompletion list was found</div>
          <p className="text-xs mt-0.5">
            This project was saved when a second list (&quot;Recompletion B&quot;, {legacy.boards.length} board{legacy.boards.length === 1 ? '' : 's'}, {legacyTotal} DR) existed.
            There is one Recompletion mode now, made of sequential boards. That older list is <span className="font-semibold">not active</span>: it is not played, not built and
            not exported. It is kept only so you can recover it. Nothing happens until you choose and confirm.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ACTIONS.map((a) => (
              <Button key={a.id} variant={action === a.id ? 'dark' : 'secondary'} size="sm" onClick={() => setAction(action === a.id ? null : a.id)} data-legacy-action={a.id}>
                Preview: {a.label.toLowerCase()}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {plan && (
        <div className="mt-3 rounded-2xl border border-amber-300 bg-white/70 p-3 text-slate-700" data-testid="legacy-recovery-preview">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Preview - nothing has changed yet</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <BoardList title="Recompletion now" boards={plan.before} total={plan.beforeTotal} />
            <BoardList title="Recompletion after" boards={plan.after} total={plan.afterTotal} />
          </div>
          <ul className="mt-2 list-disc ml-5 text-xs text-slate-600" data-testid="legacy-recovery-effects">
            {plan.effects.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
            {!isBaseSegment && action !== 'discard' && (
              <li>Board layouts are shared from Segment 1, so on this segment the recovered boards&apos; tiles will follow Segment 1&apos;s layout; their budgets and pins are what carry over.</li>
            )}
            <li>A recovery snapshot of both lists as they are now is kept, so this can be undone.</li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                applyLegacyRecovery({ action, segment, list })
                setAction(null)
              }}
              data-testid="legacy-recovery-confirm"
            >
              Confirm: {ACTIONS.find((a) => a.id === action).label.toLowerCase()}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAction(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
