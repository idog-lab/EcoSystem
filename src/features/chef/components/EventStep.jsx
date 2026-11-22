import Card from '../../../components/ui/Card'
import { calendarDateForDay, formatCalendarDate, phaseDayRange, dailyActivityMultiplier, PRIZE_TIERS, SEGMENT_PRIZE_MULTIPLIER, ACTIVITY_SHAPES, ACTIVITY_SHAPE_LABELS, CHEST_TYPES, CHEST_LABELS } from '../lib/chefModel'
import { AddButton, Num, RowActions, NAME_INPUT, SELECT, TD, TH } from './chefUi'

// STEP 1 - THE EVENT AND ITS PLAYERS: when it runs, the phases it is cut
// into, and how many baskets a day each segment opens. Everything here is
// typed, so nothing is folded.
//
// Phases are the granularity the chef's data works at: a basket's odds are
// set per chest type and per phase (step 3), and a blocker "opens" by going
// from a weight of 0 in one phase to more in the next. A phase carries a
// number of days, not dates - moving the start date moves every phase.
//
// Segments share the ingredients, dishes, baskets and calendar. A segment
// has its own baskets opened a day (per chest type), its own prize size
// (it multiplies every dish's prize: SEGMENT_PRIZE_MULTIPLIER) and its own
// spread of activity over the event.
//
// WHAT A SHAPE DOES TO THE NUMBER OF BASKETS, SAID ON SCREEN. A shape other
// than Flat does not only move baskets between days: the slow start and the
// fade lower the first or last five days and raise nothing, the weekend
// boost raises Saturdays and Sundays and lowers nothing
// (dailyActivityMultiplier). Over the 21 days of the Halloween chef that is
// 5.7% and 8.6% fewer baskets, and 8.6% more. The typed "baskets a day" is
// then not the segment's real average. The table shows the difference next
// to the shape; whether a shape should keep the total is the economist's
// call (the model is as it was).
const shapeEffect = (shape, calendar) => {
  const days = Math.max(1, calendar.totalDays)
  let sum = 0
  for (let day = 1; day <= days; day += 1) sum += dailyActivityMultiplier(shape, calendar, day)
  return sum / days - 1
}

export default function EventStep({ calendar, segments, onUpdateStartDate, onUpdateTotalDays, onUpdatePhase, onAddPhase, onRemovePhase, onUpdateSegment, onAddSegment, onDuplicateSegment, onRemoveSegment }) {
  const totalPhaseDays = calendar.phases.reduce((sum, p) => sum + p.days, 0)
  const endDate = calendar.startDate ? calendarDateForDay(calendar, calendar.totalDays) : null
  const effectOf = (seg) => shapeEffect(seg.activityShape ?? 'flat', calendar)
  const shaped = segments.some((seg) => Math.abs(effectOf(seg)) >= 0.0005)

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,9fr)] xl:items-start">
      <Card title="1. The event" subtitle="When it runs, and the phases it is cut into. A phase is a stretch of days with its own basket odds (step 3).">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Start date</span>
            <input
              type="date"
              data-testid="chef-start-date"
              value={calendar.startDate ?? ''}
              onChange={(e) => onUpdateStartDate(e.target.value || null)}
              className="rounded-lg border border-slate-200 bg-white/80 px-2 py-1 text-sm font-medium text-slate-800 focus:border-purple-400 focus:outline-none focus:ring-4 focus:ring-purple-200/60"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Days</span>
            <Num data-testid="chef-total-days" value={calendar.totalDays} min={1} max={365} onCommit={(n) => onUpdateTotalDays(Math.round(n))} className="w-20" />
          </label>
          <p className="pb-1.5 text-sm text-slate-600" data-testid="chef-event-dates">
            {calendar.startDate && endDate ? `Runs ${formatCalendarDate(calendarDateForDay(calendar, 1))} to ${formatCalendarDate(endDate)}.` : 'No start date yet: days are shown by number.'}
          </p>
        </div>

        <table className="mt-4 w-full border-collapse" data-dense data-testid="chef-phases">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={TH}>Phase</th>
              <th className={`${TH} text-center`}>Days</th>
              <th className={TH}>Dates</th>
              <th className={TH} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {calendar.phases.map((phase) => {
              const range = phaseDayRange(calendar, phase.id)
              const from = range ? calendarDateForDay(calendar, range.startDay) : null
              const to = range ? calendarDateForDay(calendar, range.endDay) : null
              return (
                <tr key={phase.id} className="border-b border-slate-100" data-phase={phase.id}>
                  <td className={TD}>
                    <input value={phase.label} aria-label="Phase name" onChange={(e) => onUpdatePhase(phase.id, { label: e.target.value })} className={`${NAME_INPUT} min-w-[7rem]`} />
                  </td>
                  <td className={`${TD} text-center`}>
                    <Num aria-label={`${phase.label}: days`} value={phase.days} min={1} max={365} onCommit={(n) => onUpdatePhase(phase.id, { days: Math.round(n) })} className="w-16" />
                  </td>
                  <td className={`${TD} whitespace-nowrap text-sm text-slate-500`}>
                    {from ? `${formatCalendarDate(from)} to ${formatCalendarDate(to)}` : range ? `Day ${range.startDay} to ${range.endDay}` : '-'}
                  </td>
                  <td className={`${TD} text-right`}>{calendar.phases.length > 1 && <RowActions what={phase.label} onRemove={() => onRemovePhase(phase.id)} />}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <AddButton onClick={onAddPhase} data-testid="chef-add-phase">
            Add a phase
          </AddButton>
          <span className="text-xs text-slate-500">Removing a phase removes its baskets.</span>
        </div>
        {totalPhaseDays !== calendar.totalDays && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="chef-phase-gap">
            The phases add up to {totalPhaseDays} days, but the event runs {calendar.totalDays} days.
          </p>
        )}
      </Card>

      <Card
        title="Segments: baskets opened a day"
        subtitle="What makes one segment differ from the next. The ingredients, dishes, baskets and calendar are the same for all of them."
        action={
          <AddButton onClick={onAddSegment} data-testid="chef-add-segment">
            Add a segment
          </AddButton>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" data-dense data-testid="chef-segments">
            <thead>
              <tr>
                <th className={TH} />
                <th className={`${TH} border-b border-slate-200 text-center`} colSpan={CHEST_TYPES.length}>
                  Baskets opened a day
                </th>
                <th className={TH} colSpan={3} />
              </tr>
              <tr className="border-b border-slate-200">
                <th className={TH}>Segment</th>
                {CHEST_TYPES.map((chest) => (
                  <th key={chest} className={`${TH} text-center`}>
                    {CHEST_LABELS[chest]}
                  </th>
                ))}
                <th className={TH} title="A segment's prize size multiplies the prize of every dish and the prize for cooking them all.">
                  Prize size
                </th>
                <th className={TH} title="When in the event the segment opens its baskets. A shape other than Flat also changes how many baskets are opened in all: the figure beside it.">
                  Activity over the event
                </th>
                <th className={TH} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {segments.map((seg) => (
                <tr key={seg.id} className="border-b border-slate-100" data-segment={seg.id}>
                  <td className={TD}>
                    <input value={seg.name} aria-label="Segment name" onChange={(e) => onUpdateSegment(seg.id, { name: e.target.value })} className={`${NAME_INPUT} min-w-[7rem]`} />
                  </td>
                  {CHEST_TYPES.map((chest) => (
                    <td key={chest} className={`${TD} text-center`}>
                      <Num
                        aria-label={`${seg.name}: ${CHEST_LABELS[chest]} baskets a day`}
                        data-rate={chest}
                        step="0.01"
                        value={seg.avgBasketsPerDay[chest] ?? 0}
                        onCommit={(n) => onUpdateSegment(seg.id, { avgBasketsPerDay: { ...seg.avgBasketsPerDay, [chest]: n } })}
                        className="w-20"
                      />
                    </td>
                  ))}
                  <td className={TD}>
                    <select value={seg.prizeTier} aria-label={`${seg.name}: prize size`} onChange={(e) => onUpdateSegment(seg.id, { prizeTier: e.target.value })} className={SELECT}>
                      {PRIZE_TIERS.map((tier) => (
                        <option key={tier} value={tier}>
                          {tier} (x{SEGMENT_PRIZE_MULTIPLIER[tier]})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={TD}>
                    <select value={seg.activityShape ?? 'flat'} aria-label={`${seg.name}: activity over the event`} onChange={(e) => onUpdateSegment(seg.id, { activityShape: e.target.value })} className={SELECT}>
                      {ACTIVITY_SHAPES.map((shape) => (
                        <option key={shape} value={shape}>
                          {ACTIVITY_SHAPE_LABELS[shape]}
                        </option>
                      ))}
                    </select>
                    {Math.abs(effectOf(seg)) >= 0.0005 && (
                      <span className="ml-2 whitespace-nowrap text-xs font-medium text-amber-700" data-shape-effect>
                        {effectOf(seg) > 0 ? '+' : ''}
                        {(effectOf(seg) * 100).toFixed(1)}% baskets
                      </span>
                    )}
                  </td>
                  <td className={`${TD} text-right`}>
                    <RowActions what={seg.name} onDuplicate={() => onDuplicateSegment(seg.id)} onRemove={() => onRemoveSegment(seg.id)} />
                  </td>
                </tr>
              ))}
              {segments.length === 0 && (
                <tr>
                  <td colSpan={CHEST_TYPES.length + 4} className="px-2 py-3 text-sm text-slate-400">
                    No segments yet. Add one to simulate the event.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {shaped && (
          <p className="mt-3 text-sm text-amber-800" data-testid="chef-shape-note" data-note>
            A shape other than Flat also changes how many baskets the segment opens over the whole event - the figure beside it. Its real average is then not the baskets a day typed here.
          </p>
        )}
      </Card>
    </div>
  )
}
