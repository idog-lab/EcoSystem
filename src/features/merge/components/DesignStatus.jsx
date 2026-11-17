import { TriangleAlert, CircleCheck, Hammer } from 'lucide-react'
import Button from '../../../components/ui/Button'
import { DESIGN_PART_LABELS } from '../lib/eventBuild'

// Whether an applied design still matches the build that produced it, shown
// the same way in every tool (Rewards, Syntax, Build event) so they can never
// disagree about it. `consistency` is eventBuild.js's designConsistency().
const STATE_TEXT = {
  consistent: 'Built and unchanged since. Boards, reward items, drops and the energy credit agree with each other.',
  manual: 'Not produced by Build configuration. It pays no merge energy, so there is no energy credit to reconcile.',
  empty: 'Nothing has been generated for these boards yet.',
}

function describeIssue(state, changed) {
  if (state === 'unaccounted') return 'these boards pay merge energy but no energy credit was ever taken off them (they were not produced by Build configuration)'
  const parts = (changed ?? []).map((p) => DESIGN_PART_LABELS[p]).filter(Boolean)
  return `changed since it was built: ${parts.length ? parts.join(', ') : 'the design'} - so the boards are allocated for an energy income they no longer have`
}

export function DesignStatusBanner({ consistency, onRebuild, scopeLabel = 'This design', className = '' }) {
  const bad = consistency.state === 'stale' || consistency.state === 'unaccounted'
  const validated = consistency.state === 'consistent' && consistency.stamp?.validated
  return (
    <div
      className={`rounded-2xl border px-4 py-2.5 text-sm flex flex-wrap items-center gap-3 ${bad ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white/70 text-slate-600'} ${className}`}
      data-testid="design-status"
      data-design-state={consistency.state}
    >
      {bad ? <TriangleAlert size={16} className="shrink-0" /> : <CircleCheck size={16} className={`shrink-0 ${consistency.state === 'consistent' ? 'text-emerald-600' : 'text-slate-400'}`} />}
      <span className="flex-1 min-w-[18rem]">
        <span className="font-semibold">
          {scopeLabel}: {bad ? 'out of date - needs a rebuild' : consistency.state === 'consistent' ? (validated ? 'built, simulation validated' : 'built (estimated, not yet validated)') : consistency.state === 'manual' ? 'hand-built' : 'not built'}.
        </span>{' '}
        {bad ? `It has ${describeIssue(consistency.state, consistency.changed)}. Board subsidy, energy accounting and any earlier validation no longer describe it.` : STATE_TEXT[consistency.state]}
      </span>
      {bad && onRebuild && (
        <Button variant="primary" size="sm" icon={Hammer} onClick={onRebuild} data-testid="design-rebuild">
          Rebuild in Build event
        </Button>
      )}
    </div>
  )
}

// Guards an export. While any list in the event needs a rebuild, the export
// actions inside are disabled until the economist ticks an explicit, visible
// override. `children` is a render function receiving whether export is
// currently allowed.
export function ExportGate({ issues, override, onOverride, onRebuild, children }) {
  const blocked = issues.length > 0
  return (
    <div className="flex flex-col gap-3" data-testid="export-gate" data-export-blocked={blocked && !override}>
      {blocked && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="export-blocked">
          <div className="font-semibold flex items-center gap-1.5">
            <TriangleAlert size={15} className="shrink-0" /> The applied design is not ready to export as finished
          </div>
          <ul className="mt-1 list-disc ml-5 text-xs">
            {issues.map((issue) => (
              <li key={`${issue.segmentIndex}-${issue.phase}`}>
                <span className="font-semibold">
                  {issue.name}, {issue.phase === 'rc' ? 'Recompletion' : 'Normal'}:
                </span>{' '}
                {describeIssue(issue.state, issue.changed)}.
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {onRebuild && (
              <Button variant="primary" size="sm" icon={Hammer} onClick={onRebuild}>
                Rebuild in Build event
              </Button>
            )}
            <label className="flex items-center gap-2 text-xs font-medium">
              <input type="checkbox" checked={override} onChange={(e) => onOverride?.(e.target.checked)} data-testid="export-override" />
              Export anyway. I understand this configuration is out of date and has not been validated.
            </label>
          </div>
        </div>
      )}
      {children(!blocked || override)}
      {blocked && override && (
        <p className="text-xs font-semibold text-amber-700" data-testid="export-override-active">
          Override on: exports are of an out-of-date, unvalidated configuration.
        </p>
      )}
    </div>
  )
}
