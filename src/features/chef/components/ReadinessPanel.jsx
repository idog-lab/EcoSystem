import Collapsible from '../../../components/ui/Collapsible'
import { READINESS_STATUS_LABELS, readiness } from '../lib/chefReadiness'
import { TD, TH } from './chefUi'

const STATUS_STYLE = {
  missing: 'bg-red-100 text-red-800',
  confirm: 'bg-amber-100 text-amber-800',
  optional: 'bg-slate-100 text-slate-500',
  done: 'bg-emerald-100 text-emerald-800',
}

// WHAT THIS EVENT STILL NEEDS: every input of the event with where it is
// typed - missing, to confirm, optional or done (chefReadiness.js). A link
// goes to the step, and opens the section, where the input is typed. An item
// "to confirm" holds values nobody confirmed; the economist ticks it, and the
// tick is asked again when those values change. Nothing here fills anything
// in, and a missing prize stops no simulation.
export default function ReadinessPanel({ state, update, onGoTo, stepLabels, defaultOpen = false }) {
  const r = readiness(state)
  const confirmed = state.confirmed ?? {}
  const tick = (item, on) =>
    update((s) => {
      const next = { ...(s.confirmed ?? {}) }
      if (on) next[item.id] = item.mark
      else delete next[item.id]
      return { ...s, confirmed: next }
    })
  const summary = r.complete
    ? 'Every input is there and confirmed.'
    : [r.missing ? `${r.missing} missing` : null, r.toConfirm ? `${r.toConfirm} to confirm` : null, `${r.done} done`].filter(Boolean).join(' · ') +
      (r.canSimulate ? (r.valuationComplete ? '' : ' · it can be simulated; what players are paid is incomplete') : ' · it cannot be simulated yet')
  let lastGroup = null
  return (
    <Collapsible id="chef-readiness" title="What this event still needs" summary={summary} defaultOpen={defaultOpen} data-testid="chef-readiness">
      <p className="mb-3 text-sm text-slate-600" data-note>
        Every input of the event, with where it is typed. <span className="font-semibold text-red-700">Missing</span>: not there - the line says what that stops.{' '}
        <span className="font-semibold text-amber-700">To confirm</span>: there, but nobody confirmed it - tick it once you have. Nothing is filled in for you, and a missing prize stops no simulation: it
        only leaves what players are paid incomplete.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" data-dense data-testid="chef-readiness-list">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={TH}>Input</th>
              <th className={TH}>State</th>
              <th className={TH}>What is there, or what its absence stops</th>
              <th className={TH}>Where</th>
            </tr>
          </thead>
          <tbody>
            {r.items.map((item) => {
              const head = item.group !== lastGroup
              lastGroup = item.group
              return (
                <tr key={item.id} className={`border-b border-slate-100 align-top text-sm ${head ? 'border-t border-t-slate-200' : ''}`} data-ready={item.id} data-status={item.status}>
                  <td className={`${TD} font-medium text-slate-700`}>
                    {head && <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.group}</span>}
                    {item.label}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[item.status]}`}>{READINESS_STATUS_LABELS[item.status]}</span>
                    {item.needsConfirm && (
                      <label className="ml-2 inline-flex cursor-pointer items-center gap-1 text-xs text-slate-600">
                        <input type="checkbox" checked={confirmed[item.id] === item.mark} onChange={(e) => tick(item, e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-purple-600" aria-label={`Confirmed: ${item.label}`} />
                        confirmed
                      </label>
                    )}
                  </td>
                  <td className={`${TD} text-slate-600`}>
                    {item.detail}
                    {item.stops && <span className="text-slate-500"> {item.stops}</span>}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <button type="button" onClick={() => onGoTo(item.step, item.fold)} className="text-xs font-semibold text-purple-700 underline decoration-dotted underline-offset-2 hover:decoration-solid">
                      {stepLabels[item.step]}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Collapsible>
  )
}
