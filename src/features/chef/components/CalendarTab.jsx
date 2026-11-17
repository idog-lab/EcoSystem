import { Plus, Trash2 } from 'lucide-react'
import Card from '../../../components/ui/Card'
import NumberField from '../../../components/ui/NumberField'
import { calendarDateForDay, formatCalendarDate, phaseDayRange } from '../lib/chefModel'

// Phases are the real calendar granularity this chef's data operates at -
// each basket's own odds are configured per (Chest Type, Phase), and a
// semi-blocker/blocker ingredient "opens" simply by going from a weight of
// 0 in one phase's basket to a nonzero weight in the next (see Baskets
// tab) - there's no separate day-by-day cap schedule to configure here.
//
// By explicit economist request, the event itself (not just its phases)
// now carries a real start date + duration - the same pattern Merge's own
// event schedule (eventStartDate/eventDurationDays) uses - so every phase
// boundary and every day in the Simulation/Basket value tabs can show a
// real calendar date instead of a bare day number.
export default function CalendarTab({
  calendar,
  ingredients = [],
  grants = [],
  onUpdateStartDate,
  onUpdateTotalDays,
  onUpdatePhase,
  onAddGrant,
  onUpdateGrant,
  onRemoveGrant,
}) {
  const totalPhaseDays = calendar.phases.reduce((sum, p) => sum + p.days, 0)
  const endDate = calendar.startDate ? calendarDateForDay(calendar, calendar.totalDays) : null

  return (
    <div className="flex flex-col gap-4">
      <Card title="Event schedule" subtitle="The chef's own real start date and duration — every phase date range below is computed from this.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Start date</span>
            <input
              type="date"
              value={calendar.startDate ?? ''}
              onChange={(e) => onUpdateStartDate(e.target.value || null)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-medium bg-white/70 focus:outline-none focus:ring-4 focus:ring-purple-200/60 focus:border-purple-400 transition-shadow"
            />
          </label>
          <NumberField label="Duration (days)" min={1} value={calendar.totalDays} onChange={(e) => onUpdateTotalDays(Number(e.target.value) || 1)} />
        </div>
        {calendar.startDate && endDate && (
          <p className="text-xs text-slate-500 mt-3">
            Runs {formatCalendarDate(calendarDateForDay(calendar, 1))} – {formatCalendarDate(endDate)}
          </p>
        )}
      </Card>

      <Card title="Phases" subtitle="Each basket's odds change at a phase boundary (see Baskets tab).">
        <div className="flex flex-col gap-3">
          {calendar.phases.map((phase) => {
            const range = phaseDayRange(calendar, phase.id)
            const startDate = range ? calendarDateForDay(calendar, range.startDay) : null
            const phaseEndDate = range ? calendarDateForDay(calendar, range.endDay) : null
            return (
              <div key={phase.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/70 p-3">
                <input
                  value={phase.label}
                  onChange={(e) => onUpdatePhase(phase.id, { label: e.target.value })}
                  className="font-semibold text-sm text-slate-800 bg-transparent border-b border-transparent focus:border-purple-300 focus:outline-none flex-1"
                />
                <NumberField label="Days" min={1} value={phase.days} onChange={(e) => onUpdatePhase(phase.id, { days: Number(e.target.value) || 1 })} className="w-28" />
                {startDate && (
                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    {formatCalendarDate(startDate)} – {formatCalendarDate(phaseEndDate)}
                  </span>
                )}
              </div>
            )
          })}
          {totalPhaseDays !== calendar.totalDays && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              Phases sum to {totalPhaseDays} days, but the event is {calendar.totalDays} days long.
            </p>
          )}
        </div>
      </Card>

      <Card
        title="Ingredient grants (sales & events)"
        subtitle='Ingredients the business hands players outside the basket economy — direct sale bundles or event rewards. "Coverage %" is the share of players assumed to receive it, not 100% by default.'
        action={
          <button type="button" onClick={onAddGrant} className="flex items-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-800">
            <Plus size={13} /> Add grant
          </button>
        }
      >
        {grants.length === 0 && <p className="text-sm text-slate-400">No grants configured — the simulator assumes every ingredient comes only from baskets.</p>}
        <div className="flex flex-col gap-2">
          {grants.map((grant) => {
            const date = calendarDateForDay(calendar, grant.day)
            return (
              <div key={grant.id} className="grid grid-cols-[auto_1fr_auto_auto_1fr_auto] items-end gap-2 rounded-2xl border border-slate-200 bg-white/70 p-3">
                <NumberField label="Day" min={1} max={calendar.totalDays} value={grant.day} onChange={(e) => onUpdateGrant(grant.id, { day: Number(e.target.value) || 1 })} className="w-20" />
                <span className="text-xs text-slate-400 self-center pb-2">{formatCalendarDate(date) ?? ''}</span>
                <select
                  value={grant.ingredientId ?? ''}
                  onChange={(e) => onUpdateGrant(grant.id, { ingredientId: e.target.value })}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white/70 self-end"
                >
                  {ingredients.map((ing) => (
                    <option key={ing.id} value={ing.id}>
                      {ing.name}
                    </option>
                  ))}
                </select>
                <NumberField label="Amount" min={0} value={grant.amount} onChange={(e) => onUpdateGrant(grant.id, { amount: Number(e.target.value) || 0 })} className="w-24" />
                <NumberField
                  label="Coverage %"
                  min={0}
                  max={100}
                  value={grant.coveragePct}
                  onChange={(e) => onUpdateGrant(grant.id, { coveragePct: Number(e.target.value) || 0 })}
                  className="w-28"
                />
                <button type="button" onClick={() => onRemoveGrant(grant.id)} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 self-end">
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
