import { TriangleAlert, CircleCheck, Hammer } from 'lucide-react'
import Button from '../../../../components/ui/Button'
import { DESIGN_PART_LABELS } from '../../lib/build/eventBuild'

// Whether an applied design still matches the build that produced it, shown
// the same way in every tool (Rewards, Syntax, Build event) so they can never
// disagree about it. `consistency` is eventBuild.js's designConsistency().
const STATE_TEXT = {
  consistent: 'Built and unchanged since. Boards, reward items, drops and the energy credit agree with each other.',
  manual: 'Not produced by Build configuration. It pays no merge energy, so there is no energy credit to reconcile.',
  empty: 'Nothing has been generated for these boards yet.',
}

// What is wrong, in plain words (economist, of the older wording - "the
// boards are allocated for an energy income they no longer have": "i cant
// understand what that means").
// (`short`: in a list under a heading that already says what follows from it.)
function describeIssue(state, changed, short = false) {
  if (state === 'unaccounted') return 'these boards were made by hand, not by a build. They give merge energy, and nothing was taken off their subsidy for it'
  const parts = (changed ?? []).map((p) => DESIGN_PART_LABELS[p]).filter(Boolean)
  return `${parts.length ? parts.join(', ') : 'something'} changed after the last build${short ? '' : ', so what is under the tiles was worked out for something else'}`
}
const sentence = (text) => text.charAt(0).toUpperCase() + text.slice(1)

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
        {bad ? `${sentence(describeIssue(consistency.state, consistency.changed))}. The numbers of the last build no longer describe these boards: build again to bring them in line.` : STATE_TEXT[consistency.state]}
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
            <TriangleAlert size={15} className="shrink-0" /> The event was changed after its last build
          </div>
          <p className="mt-1 text-xs" data-testid="export-blocked-why">
            A download would hold boards that no longer match what was built for them. Build again and they are in line.
          </p>
          <ul className="mt-1 list-disc ml-5 text-xs">
            {issues.map((issue) => (
              <li key={`${issue.segmentIndex}-${issue.phase}`}>
                <span className="font-semibold">
                  {issue.name}, {issue.phase === 'rc' ? 'Recompletion' : 'Normal'}:
                </span>{' '}
                {describeIssue(issue.state, issue.changed, true)}.
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {onRebuild && (
              <Button variant="primary" size="sm" icon={Hammer} onClick={onRebuild}>
                Build again
              </Button>
            )}
            <label className="flex items-center gap-2 text-xs font-medium">
              <input type="checkbox" checked={override} onChange={(e) => onOverride?.(e.target.checked)} data-testid="export-override" />
              Download anyway - I know these boards do not match their last build.
            </label>
          </div>
        </div>
      )}
      {children(!blocked || override)}
      {blocked && override && (
        <p className="text-xs font-semibold text-amber-700" data-testid="export-override-active">
          Downloading anyway: the files hold boards that do not match their last build.
        </p>
      )}
    </div>
  )
}
