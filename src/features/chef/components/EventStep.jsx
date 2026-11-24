import { useState } from 'react'
import Card from '../../../components/ui/Card'
import Collapsible from '../../../components/ui/Collapsible'
import { ACTIVITY_SHAPES, ACTIVITY_SHAPE_LABELS, BRUT_WINS_FORMULA, CHEST_LABELS, CHEST_TYPES, LIVE_SEGMENT_SET, calendarDateForDay, createCheckpoint, createPhase, createSegment, expectedSupply, formatCalendarDate, liveSegments, phaseDayRange, supplyTotal } from '../lib/chefModel'
import { effectiveFactor } from '../lib/chefRewards'
import { dayLabel, num } from '../lib/chefFormat'
import { AddButton, Field, Num, Pills, RowActions, NAME_INPUT, SELECT, TD, TH } from './chefUi'

// STEP 1 - THE EVENT AND ITS PLAYERS.
//
// The event: its days, the periods of basket odds ("phases": a basket's odds
// are set per type and per phase in step 3), the days of the Dish Master, and
// what the event aims at - the day on which a share of every segment should
// be sitting in FU, and optional checkpoints ("80% have at least 6 dishes by
// day 10"). Dates and targets are the same for every segment.
//
// The segments: everything about one is typed - its name, its Brut Wins range
// (kept for the record; nothing here turns Brut Wins into baskets), its
// effort factor (multiplies recipe quantities, never the blocker's), its
// prize factor and burnout (their product multiplies prizes), and its basket
// supply: one average a day for the event, or a number for every day.
export default function EventStep({ state, update }) {
  const { calendar, segments, targets, settings } = state
  const [inView, setInView] = useState(segments[0]?.id ?? null)
  const days = Math.max(1, calendar.totalDays)
  const totalPhaseDays = calendar.phases.reduce((sum, p) => sum + p.days, 0)
  const endDate = calendar.startDate ? calendarDateForDay(calendar, calendar.totalDays) : null

  const setCalendar = (patch) => update((s) => ({ ...s, calendar: { ...s.calendar, ...patch } }))
  const setPhase = (id, patch) => update((s) => ({ ...s, calendar: { ...s.calendar, phases: s.calendar.phases.map((p) => (p.id === id ? { ...p, ...patch } : p)) } }))
  const addPhase = () =>
    update((s) => {
      const ids = new Set(s.calendar.phases.map((p) => p.id))
      let n = s.calendar.phases.length + 1
      while (ids.has(`phase${n}`)) n += 1
      return { ...s, calendar: { ...s.calendar, phases: [...s.calendar.phases, createPhase({ id: `phase${n}`, label: `Phase ${n}`, days: 1 })] } }
    })
  // (Its baskets go with it: a basket of no phase is never opened by anyone.)
  const removePhase = (id) => update((s) => ({ ...s, calendar: { ...s.calendar, phases: s.calendar.phases.filter((p) => p.id !== id) }, baskets: s.baskets.filter((b) => b.phaseId !== id) }))
  const setTargets = (patch) => update((s) => ({ ...s, targets: { ...s.targets, ...patch } }))
  const setCheckpoint = (id, patch) => setTargets({ checkpoints: targets.checkpoints.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
  const setSegment = (id, patch) => update((s) => ({ ...s, segments: s.segments.map((seg) => (seg.id === id ? { ...seg, ...patch } : seg)) }))
  const setSupply = (seg, patch) => setSegment(seg.id, { supply: { ...seg.supply, ...patch } })
  const addSegment = () => update((s) => ({ ...s, segments: [...s.segments, createSegment({ name: `Segment ${s.segments.length + 1}` })] }))
  const duplicateSegment = (seg) => update((s) => ({ ...s, segments: [...s.segments, createSegment({ ...JSON.parse(JSON.stringify(seg)), id: undefined, name: `${seg.name} copy` })] }))
  const removeSegment = (id) => update((s) => ({ ...s, segments: s.segments.filter((seg) => seg.id !== id) }))
  // THE LIVE SEGMENTS (economist: replace, after asking, with one undo). Only the segment list changes: what elsewhere
  // names an old segment (a blocker quantity typed for it, a source or preset limited to it) is left as it is and the
  // checks say so; the proposal's choice of segments goes back to all of them, and comes back with the undo.
  const liveInUse = segments.length === LIVE_SEGMENT_SET.length && LIVE_SEGMENT_SET.every((x, i) => segments[i]?.name === x.name)
  const before = state.segmentsBefore ?? null
  const useLiveSegments = () => {
    const linked = [
      ...state.dishes.filter((d) => Object.keys(d.blockerBySegment ?? {}).length).map((d) => `a blocker quantity typed for a segment in ${d.name}`),
      ...(state.sources ?? []).filter((x) => x.segmentIds).map((x) => `the source "${x.label || 'unnamed'}"`),
      ...(state.presets ?? []).filter((x) => x.segmentIds).map((x) => `the preset "${x.name}"`),
    ]
    const message = `Replace the ${segments.length} segments of this chef with the ${LIVE_SEGMENT_SET.length} live segments (Chef_control and the 8 Brut Wins bands)?\n\nTheir effort, prize factor and burnout start at 1 and their baskets at 0 - for you to type.${linked.length ? `\n\nStill naming the old segments, and listed in the checks: ${linked.join('; ')}.` : ''}\n\nOne undo brings back the segments as they are now.`
    if (!window.confirm(message)) return
    update((s) => ({
      ...s,
      segments: liveSegments(),
      segmentsBefore: { at: new Date().toISOString(), segments: s.segments, planSegmentIds: s.generator?.plan?.segmentIds ?? null },
      ...(s.generator?.plan?.segmentIds ? { generator: { ...s.generator, plan: { ...s.generator.plan, segmentIds: null } } } : {}),
    }))
  }
  const undoLiveSegments = () =>
    update((s) => {
      const { segmentsBefore: was, ...rest } = s
      if (!was) return s
      return { ...rest, segments: was.segments, ...(was.planSegmentIds && rest.generator?.plan ? { generator: { ...rest.generator, plan: { ...rest.generator.plan, segmentIds: was.planSegmentIds } } } : {}) }
    })
  const setActivity = (patch) => update((s) => ({ ...s, settings: { ...s.settings, activity: { ...s.settings.activity, ...patch } } }))

  // Day by day: an average is spread over the event (its total kept); typing a day switches the segment to its own numbers.
  const viewed = segments.find((seg) => seg.id === inView) ?? segments[0] ?? null
  const perDay = viewed ? expectedSupply(viewed, calendar) : null
  const typeDaily = (seg) => setSupply(seg, { mode: 'daily', daily: Object.fromEntries(CHEST_TYPES.map((type) => [type, expectedSupply(seg, calendar)[type].map((v) => Math.round(v * 100) / 100)])) })
  const setDay = (seg, type, index, value) => {
    const daily = Object.fromEntries(CHEST_TYPES.map((t) => [t, Array.from({ length: days }, (_, i) => seg.supply.daily?.[t]?.[i] ?? 0)]))
    daily[type][index] = value
    setSupply(seg, { daily })
  }
  const dm = calendar.dishMaster ?? {}
  // The dishes that can be picked for the Dish Master: the Main dishes with the semi-blocker, and any picked already.
  const semiIds = new Set(state.ingredients.filter((i) => i.rarity === 'semi-blocker').map((i) => i.id))
  const pickedDm = (dm.dishIds ?? []).filter((id) => state.dishes.some((d) => d.id === id))
  const dmChoices = state.dishes.map((d) => ({ id: d.id, name: d.name, semi: d.recipe.some((r) => semiIds.has(r.ingredientId)) })).filter((d) => d.semi || pickedDm.includes(d.id))
  const activity = settings.activity

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(21rem,7fr)_minmax(0,24fr)] xl:items-start">
        <Card title="1. The event" subtitle="Its days, its periods of basket odds, and what it aims at. The same for every segment.">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <Field label="Start date">
              <input
                type="date"
                data-testid="chef-start-date"
                value={calendar.startDate ?? ''}
                onChange={(e) => setCalendar({ startDate: e.target.value || null })}
                className="rounded-lg border border-slate-200 bg-white/80 px-2 py-1 text-sm font-medium text-slate-800 focus:border-purple-400 focus:outline-none focus:ring-4 focus:ring-purple-200/60"
              />
            </Field>
            <Field label="Days">
              <Num data-testid="chef-total-days" value={calendar.totalDays} min={1} max={365} onCommit={(n) => setCalendar({ totalDays: Math.round(n) })} className="w-16" />
            </Field>
            <p className="pb-1.5 text-xs text-slate-500" data-testid="chef-event-dates">
              {calendar.startDate && endDate ? `${formatCalendarDate(calendarDateForDay(calendar, 1))} to ${formatCalendarDate(endDate)}` : 'No start date yet: days are shown by number.'}
            </p>
          </div>

          <table className="mt-3 w-full border-collapse" data-dense data-testid="chef-phases">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={TH} title="A phase is a stretch of days with its own basket odds (step 3).">
                  Odds period
                </th>
                <th className={`${TH} text-center`}>Days</th>
                <th className={TH}>When</th>
                <th className={TH} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {calendar.phases.map((phase) => {
                const range = phaseDayRange(calendar, phase.id)
                return (
                  <tr key={phase.id} className="border-b border-slate-100" data-phase={phase.id}>
                    <td className={TD}>
                      <input value={phase.label} aria-label="Phase name" onChange={(e) => setPhase(phase.id, { label: e.target.value })} className={`${NAME_INPUT} min-w-[5rem]`} />
                    </td>
                    <td className={`${TD} text-center`}>
                      <Num aria-label={`${phase.label}: days`} value={phase.days} min={1} max={365} onCommit={(n) => setPhase(phase.id, { days: Math.round(n) })} className="w-14" />
                    </td>
                    <td className={`${TD} whitespace-nowrap text-xs text-slate-500`}>{range ? `Day ${range.startDay} to ${range.endDay}` : '-'}</td>
                    <td className={`${TD} text-right`}>{calendar.phases.length > 1 && <RowActions what={phase.label} onRemove={() => removePhase(phase.id)} />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            <AddButton onClick={addPhase} data-testid="chef-add-phase">
              Add a period
            </AddButton>
            <span className="text-xs text-slate-500">Removing one removes its baskets.</span>
          </div>
          {totalPhaseDays !== calendar.totalDays && (
            <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="chef-phase-gap">
              The phases add up to {totalPhaseDays} days, but the event runs {calendar.totalDays} days.
            </p>
          )}

          <div className="mt-4 border-t border-slate-100 pt-3" data-testid="chef-targets">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
              <Field label="Dish Master: from day" title="The days of the Dish Master, the same for every segment. Empty: not set.">
                <Num data-testid="chef-dm-start" value={dm.startDay ?? null} allowEmpty min={1} max={days} onCommit={(n) => setCalendar({ dishMaster: { ...dm, startDay: n == null ? null : Math.round(n) } })} className="w-16" />
              </Field>
              <Field label="to day">
                <Num data-testid="chef-dm-end" value={dm.endDay ?? null} allowEmpty min={1} max={days} onCommit={(n) => setCalendar({ dishMaster: { ...dm, endDay: n == null ? null : Math.round(n) } })} className="w-16" />
              </Field>
            </div>
            {dmChoices.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="chef-dm-dishes">
                <span className="text-xs font-semibold text-slate-600" title="The dishes the Dish Master asks for (the rule is three, each with the semi-blocker). Dish Master progress is read on them. None picked: every Main dish with the semi-blocker.">
                  Dish Master dishes
                </span>
                {dmChoices.map((d) => {
                  const on = pickedDm.includes(d.id)
                  return (
                    <button key={d.id} type="button" aria-pressed={on} data-dm-dish={d.id} onClick={() => setCalendar({ dishMaster: { ...dm, dishIds: on ? pickedDm.filter((x) => x !== d.id) : [...pickedDm, d.id] } })} className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${on ? 'bg-purple-600 text-white' : 'border border-slate-200 bg-white/70 text-slate-600'}`}>
                      {d.name}
                    </button>
                  )
                })}
                <span className="text-xs text-slate-500" data-testid="chef-dm-dishes-note">
                  {pickedDm.length ? `${pickedDm.length} picked${pickedDm.length !== 3 ? ' - the rule is three' : ''}.` : `None picked: all ${dmChoices.filter((d) => d.semi).length} dishes with the semi-blocker count.`}
                </span>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-2">
              <Field label="FU target: on day" title="The day on which a share of every segment should be sitting in FU: one dish left, only blockers missing, the blocker's threshold reached. Empty: no target.">
                <Num data-testid="chef-fu-day" value={targets.mainFuDay ?? null} allowEmpty min={1} max={days} onCommit={(n) => setTargets({ mainFuDay: n == null ? null : Math.round(n) })} className="w-16" />
              </Field>
              <Field label="share in FU">
                <span className="inline-flex items-center gap-1 text-sm text-slate-500">
                  <Num data-testid="chef-fu-share" value={targets.mainFuSharePct} min={0} max={100} onCommit={(n) => setTargets({ mainFuSharePct: n })} className="w-16" />%
                </span>
              </Field>
              <p className="pb-1.5 text-xs text-slate-500">{targets.mainFuDay != null ? dayLabel(calendar, targets.mainFuDay) : 'No target day: no segment is measured against FU.'}</p>
            </div>
            {targets.checkpoints.length > 0 && (
              <table className="mt-3 w-full border-collapse" data-dense data-testid="chef-checkpoints">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className={TH} title="A checkpoint: the share of a segment's players who have cooked at least this many dishes by the end of that day. Not the average number of dishes.">
                      Checkpoint by day
                    </th>
                    <th className={`${TH} text-center`}>Dishes</th>
                    <th className={`${TH} text-center`}>Players</th>
                    <th className={TH} aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {targets.checkpoints.map((c) => (
                    <tr key={c.id} className="border-b border-slate-100" data-checkpoint={c.id}>
                      <td className={TD}>
                        <Num aria-label="Checkpoint day" value={c.day} min={1} max={days} onCommit={(n) => setCheckpoint(c.id, { day: Math.round(n) })} className="w-12" />
                      </td>
                      <td className={`${TD} whitespace-nowrap text-center text-sm text-slate-500`}>
                        <Num aria-label="Checkpoint dishes" value={c.dishes} min={1} max={99} onCommit={(n) => setCheckpoint(c.id, { dishes: Math.round(n) })} className="w-12" />
                      </td>
                      <td className={`${TD} whitespace-nowrap text-center text-sm text-slate-500`}>
                        <Num aria-label="Checkpoint share" value={c.sharePct} min={0} max={100} onCommit={(n) => setCheckpoint(c.id, { sharePct: n })} className="w-12" />%
                      </td>
                      <td className={`${TD} text-right`}>
                        <RowActions what="this checkpoint" onRemove={() => setTargets({ checkpoints: targets.checkpoints.filter((x) => x.id !== c.id) })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="mt-1.5">
              <AddButton onClick={() => setTargets({ checkpoints: [...targets.checkpoints, createCheckpoint({ day: Math.min(days, 7), dishes: 4, sharePct: 80 })] })} data-testid="chef-add-checkpoint">
                Add a checkpoint
              </AddButton>
            </div>
          </div>
        </Card>

        <Card
          title="Segments"
          subtitle="Everything about a segment is typed here. Ingredients, dishes, baskets, thresholds and dates are the same for all of them."
          action={
            <div className="flex flex-wrap items-center gap-3">
              {!liveInUse && (
                <button type="button" onClick={useLiveSegments} data-testid="chef-live-segments" className="whitespace-nowrap text-xs font-semibold text-purple-600 hover:text-purple-800" title={`Replace this chef's segments with the live ones: Chef_control and the 8 Brut Wins bands (${LIVE_SEGMENT_SET.slice(1).map((x) => x.name.replace('Chef_BW_', '')).join(', ')}). Asks first; one undo.`}>
                  Use the live segments
                </button>
              )}
              <AddButton onClick={addSegment} data-testid="chef-add-segment">
                Add a segment
              </AddButton>
            </div>
          }
        >
          {before && (
            <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900" data-testid="chef-live-segments-done" data-note>
              <span>
                The {segments.length} segments below replaced {before.segments.length} ({before.segments.map((x) => x.name).slice(0, 3).join(', ')}
                {before.segments.length > 3 ? ', ...' : ''}). Effort, prize factor, burnout and baskets are yours to type.
              </span>
              <button type="button" onClick={undoLiveSegments} data-testid="chef-live-segments-undo" className="whitespace-nowrap text-xs font-semibold text-purple-700 hover:text-purple-900">
                Undo: bring back the {before.segments.length} segments from before
              </button>
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" data-dense data-testid="chef-segments">
              <thead>
                <tr>
                  <th className={TH} />
                  <th className={`${TH} border-b border-slate-200 text-center`} colSpan={2} title="The segment's daily Brut Wins, from and to. Kept for the record: nothing here turns Brut Wins into baskets - type the baskets.">
                    Brut Wins a day
                  </th>
                  <th className={TH} />
                  <th className={`${TH} border-b border-slate-200 text-center`} colSpan={3} title="Prizes are multiplied by prize factor x burnout. Coins by all of it; free rounds and undos by 2 at most; wilds and extra stock not at all.">
                    Prizes
                  </th>
                  <th className={`${TH} border-b border-slate-200 text-center`} colSpan={4} title="What the segment opens, on average. Nothing is taken off for inactivity.">
                    Baskets opened
                  </th>
                  <th className={TH} colSpan={2} />
                </tr>
                <tr className="border-b border-slate-200">
                  <th className={TH}>Segment</th>
                  <th className={`${TH} text-center`}>From</th>
                  <th className={`${TH} text-center`}>To</th>
                  <th className={`${TH} text-center`} title="Multiplies the quantity of every ordinary and semi-blocker ingredient in the recipes, to the nearest whole number. Never the blocker: its quantity is typed per segment in step 2.">
                    Effort
                  </th>
                  <th className={`${TH} text-center`}>Factor</th>
                  <th className={`${TH} text-center`}>Burnout</th>
                  <th className={`${TH} text-center`} title="Prize factor x burnout: what the segment's prizes are multiplied by.">
                    In all
                  </th>
                  <th className={TH} title="An average a day for the whole event, or a number of its own for every day (below).">
                    Typed as
                  </th>
                  {CHEST_TYPES.map((chest) => (
                    <th key={chest} className={`${TH} text-center`} title={`${CHEST_LABELS[chest]} baskets: the average a day, or the event's total when typed day by day.`}>
                      {CHEST_LABELS[chest]}
                    </th>
                  ))}
                  <th className={TH} title="When in the event the baskets are opened. A shape only moves baskets between days: the average typed stays the real average.">
                    Over the event
                  </th>
                  <th className={TH} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {segments.map((seg) => {
                  const daily = seg.supply.mode === 'daily'
                  const totals = supplyTotal(expectedSupply(seg, calendar))
                  return (
                    <tr key={seg.id} className="border-b border-slate-100" data-segment={seg.id}>
                      <td className={TD}>
                        <input value={seg.name} aria-label="Segment name" title={seg.definition ?? undefined} onChange={(e) => setSegment(seg.id, { name: e.target.value })} className={`${NAME_INPUT} min-w-[8.5rem]`} />
                      </td>
                      <td className={`${TD} text-center`}>
                        <Num aria-label={`${seg.name}: Brut Wins from`} value={seg.brutWinsMin} allowEmpty step="any" onCommit={(n) => setSegment(seg.id, { brutWinsMin: n })} className="w-11" />
                      </td>
                      <td className={`${TD} text-center`}>
                        <Num aria-label={`${seg.name}: Brut Wins to`} value={seg.brutWinsMax} allowEmpty step="any" onCommit={(n) => setSegment(seg.id, { brutWinsMax: n })} className="w-11" />
                      </td>
                      <td className={`${TD} text-center`}>
                        <Num aria-label={`${seg.name}: effort factor`} data-field="effort" value={seg.effortFactor} min={0.01} max={20} step="any" onCommit={(n) => setSegment(seg.id, { effortFactor: n })} className="w-11" />
                      </td>
                      <td className={`${TD} text-center`}>
                        <Num aria-label={`${seg.name}: prize factor`} data-field="prize-factor" value={seg.prizeFactor} min={0.01} max={50} step="any" onCommit={(n) => setSegment(seg.id, { prizeFactor: n })} className="w-11" />
                      </td>
                      <td className={`${TD} text-center`}>
                        <Num aria-label={`${seg.name}: burnout`} data-field="burnout" value={seg.burnout} min={0.01} max={50} step="any" onCommit={(n) => setSegment(seg.id, { burnout: n })} className="w-11" />
                      </td>
                      <td className={`${TD} text-center text-sm tabular-nums text-slate-600`} data-cell="factor">
                        x{num(effectiveFactor(seg), 2)}
                      </td>
                      <td className={TD}>
                        <select
                          value={seg.supply.mode}
                          aria-label={`${seg.name}: baskets typed as`}
                          data-field="supply-mode"
                          onChange={(e) => {
                            if (e.target.value === 'daily') {
                              typeDaily(seg)
                              setInView(seg.id)
                            } else setSupply(seg, { mode: 'average' })
                          }}
                          className={SELECT}
                        >
                          <option value="average">Average a day</option>
                          <option value="daily">Day by day</option>
                        </select>
                      </td>
                      {CHEST_TYPES.map((chest) => (
                        <td key={chest} className={`${TD} text-center`}>
                          {daily ? (
                            <span className="text-sm tabular-nums text-slate-600" title="The total of the days typed below" data-total={chest}>
                              {num(totals[chest], 1)}
                            </span>
                          ) : (
                            <Num aria-label={`${seg.name}: ${CHEST_LABELS[chest]} baskets a day`} data-rate={chest} step="0.01" value={seg.supply.average[chest] ?? 0} onCommit={(n) => setSupply(seg, { average: { ...seg.supply.average, [chest]: n } })} className="w-12" />
                          )}
                        </td>
                      ))}
                      <td className={TD}>
                        {daily ? (
                          <span className="text-xs text-slate-400">as typed</span>
                        ) : (
                          <select value={seg.activityShape ?? 'flat'} aria-label={`${seg.name}: over the event`} onChange={(e) => setSegment(seg.id, { activityShape: e.target.value })} className={`${SELECT} w-[7.5rem]`}>
                            {ACTIVITY_SHAPES.map((shape) => (
                              <option key={shape} value={shape}>
                                {ACTIVITY_SHAPE_LABELS[shape]}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className={`${TD} text-right`}>
                        <RowActions what={seg.name} onDuplicate={() => duplicateSegment(seg)} onRemove={() => removeSegment(seg.id)} />
                      </td>
                    </tr>
                  )
                })}
                {segments.length === 0 && (
                  <tr>
                    <td colSpan={13} className="px-2 py-3 text-sm text-slate-400">
                      No segments yet. Add one to simulate the event.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {segments.some((seg) => seg.definition) && (
            <p className="mt-2 text-xs text-slate-500" data-testid="chef-segment-definition" data-note>
              The live segments: {BRUT_WINS_FORMULA.charAt(0).toLowerCase() + BRUT_WINS_FORMULA.slice(1)}. A band includes its upper end (10-20 is above 10 and at most 20); every band is in A/B test 1109, and Chef_control is everyone outside it. Point at a name for its definition.
            </p>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
        <Collapsible
          id="chef-supply-days"
          className="xl:open:col-span-2"
          title="Baskets, day by day"
          summary={segments.length === 0 ? 'No segment yet' : `What each segment is expected to open on every day - ${segments.filter((seg) => seg.supply.mode === 'daily').length} of ${segments.length} typed day by day`}
        >
          {viewed ? (
            <div className="flex flex-col gap-3" data-testid="chef-supply-days">
              <Pills data-testid="chef-supply-segment" value={viewed.id} onChange={setInView} options={segments.map((seg) => [seg.id, seg.name])} />
              <p className="text-sm text-slate-600" data-note>
                {viewed.supply.mode === 'daily'
                  ? `${viewed.name} is typed day by day: these are the baskets expected on each day, and nothing else is put on top.`
                  : `${viewed.name} is typed as an average a day. This is how it is spread over the event - the total is the average times the ${days} days, whatever the shape.`}{' '}
                These are expectations: a player opens whole baskets, and a fraction is never dropped - 0.4 a day is 8 or 9 baskets over 21 days, 8.4 on average, not none.
              </p>
              <div className="overflow-x-auto">
                <table className="border-collapse" data-dense>
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className={TH}>Day</th>
                      {Array.from({ length: days }, (_, i) => (
                        <th key={i} className="px-1 py-1.5 text-center text-[11px] font-semibold text-slate-500" title={dayLabel(calendar, i + 1)}>
                          {i + 1}
                        </th>
                      ))}
                      <th className={`${TH} text-center`}>In all</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CHEST_TYPES.map((type) => (
                      <tr key={type} className="border-b border-slate-100" data-supply-row={type}>
                        <td className={`${TD} whitespace-nowrap text-sm font-medium text-slate-700`}>{CHEST_LABELS[type]}</td>
                        {perDay[type].map((value, i) => (
                          <td key={i} className="px-0.5 py-1 text-center">
                            {viewed.supply.mode === 'daily' ? (
                              <Num aria-label={`${CHEST_LABELS[type]} baskets on day ${i + 1}`} value={Math.round(value * 100) / 100} step="any" onCommit={(n) => setDay(viewed, type, i, n)} className="w-11 px-0.5 text-xs" />
                            ) : (
                              <span className="block w-11 text-xs tabular-nums text-slate-600">{num(value, 2)}</span>
                            )}
                          </td>
                        ))}
                        <td className={`${TD} text-center text-sm font-semibold tabular-nums text-slate-700`}>{num(perDay[type].reduce((s, v) => s + v, 0), 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                {viewed.supply.mode === 'daily' ? (
                  <AddButton onClick={() => setSupply(viewed, { mode: 'average' })}>Back to one average a day ({CHEST_TYPES.map((t) => num(viewed.supply.average[t], 2)).join(' / ')})</AddButton>
                ) : (
                  <AddButton onClick={() => typeDaily(viewed)} data-testid="chef-supply-type-daily">
                    Type each day myself
                  </AddButton>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No segment yet.</p>
          )}
        </Collapsible>

        <Collapsible id="chef-activity" className="xl:open:col-span-2" title="How one player differs from the next (an assumption)" summary={`Used when a run varies activity: a lasting multiplier from ${activity.multiplierMin} to ${activity.multiplierMax}, days played from ${Math.round(activity.activeShareMin * 100)}% to ${Math.round(activity.activeShareMax * 100)}%`}>
          <div className="flex flex-col gap-3" data-testid="chef-activity">
            <p className="text-sm text-slate-600" data-note>
              A simulation can play basket luck only - every player opens the baskets expected of the segment, a whole basket each time the running total passes one - or let players differ as well. These figures say how they differ. They are assumptions, not
              measurements; whatever they are, the baskets expected on each day stay what you typed.
            </p>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
              <Field label="Lasting multiplier: from" title="Each player opens this many times the segment's baskets, all event long. Drawn evenly between the two figures, then scaled so that it averages 1.">
                <Num aria-label="Multiplier from" value={activity.multiplierMin} min={0} max={5} step="any" onCommit={(n) => setActivity({ multiplierMin: n })} className="w-16" />
              </Field>
              <Field label="to">
                <Num aria-label="Multiplier to" value={activity.multiplierMax} min={0} max={10} step="any" onCommit={(n) => setActivity({ multiplierMax: n })} className="w-16" />
              </Field>
              <Field label="Share of days played: from" title="Each player plays this share of the days, drawn evenly between the two figures. On a day played the player opens more, so the average is kept.">
                <Num aria-label="Share of days from" value={activity.activeShareMin} min={0.01} max={1} step="any" onCommit={(n) => setActivity({ activeShareMin: n })} className="w-16" />
              </Field>
              <Field label="to">
                <Num aria-label="Share of days to" value={activity.activeShareMax} min={0.01} max={1} step="any" onCommit={(n) => setActivity({ activeShareMax: n })} className="w-16" />
              </Field>
              <Field label="Streaks" title="0: every day is its own coin toss. Nearer 1: days played and days missed come in longer runs. It changes how days cluster, not how many are played.">
                <Num aria-label="Streaks" value={activity.persistence} min={0} max={0.99} step="any" onCommit={(n) => setActivity({ persistence: n })} className="w-16" />
              </Field>
            </div>
          </div>
        </Collapsible>
      </div>
    </div>
  )
}
