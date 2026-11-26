import { useState } from 'react'
import { SegmentPlanEditor } from '../../../economy/SegmentsTab'
import { buildPlan, createPlan } from '../../../../lib/economy/segmentFlow'
import { Collapsible, CommitNumber } from './buildUi'
import { setForFeature, setPlaceholder, useSegmentSets } from '../../../../lib/economy/segmentSets'

// MERGE MANIA'S SEGMENTS (economist, 26 Nov 2026: "add segmentation into the merge ... the first tab as the segments,
// there we can also have the DR demand and the multipliers between segments. we should also give the value of a
// merge DR"). The segments are built with the Economy page's flow (lib/economy/segmentFlow.js: a base rule in bands,
// specifics, mode splits); "Use these segments" names Merge's segments from it, each with its condition and key. The
// plan, and the worth of one merge DR ("Per Merge event"), are the event's own - kept on Segment 1, saved with it.
export default function SegmentsBuilder({ segments }) {
  const base = segments[0]
  const plan = base.segmentPlan ?? { ...createPlan(), feature: 'Merge' }
  const setPlan = (update) => base.setSegmentPlan(typeof update === 'function' ? update(plan) : update)
  const result = buildPlan(plan)
  const [message, setMessage] = useState(null)
  const applied = segments.filter((s) => s.segmentKey).length
  const fits = result.segments.length <= segments.length
  // SEGMENT SETS (Economy page, Segments; lib/economy/segmentSets.js): a set is picked from a list and COPIED - its
  // segments, conditions and efforts in Brut Wins (economist: "Copied when picked"). Step 1 says when the set has
  // changed since, and offers its new numbers.
  const sets = useSegmentSets()
  const taken = base.segmentSet
  const takenNow = taken ? sets.find((s) => s.id === taken.id) : null
  const takenChanged = !!takenNow && takenNow.updatedAt !== taken.updatedAt

  // Names Merge's segments from a list of { name, key, condition, effort? }; efforts kept by key where none is given.
  function name(list, efforts) {
    const kept = new Map(segments.filter((s) => s.segmentKey).map((s) => [s.segmentKey, s.effortBW]))
    segments.forEach((seg, i) => {
      const s = list[i]
      if (s) {
        seg.setName(s.name)
        seg.setCondition(s.condition)
        seg.setSegmentKey(s.key)
        seg.setEffortBW(efforts ? (s.effort ?? null) : (kept.get(s.key) ?? null))
      } else if (seg.segmentKey) {
        // A segment no longer made: its name, condition and effort go; what it holds stays.
        seg.setName(`Segment ${i + 1}`)
        seg.setCondition('')
        seg.setSegmentKey('')
        seg.setEffortBW(null)
      }
    })
  }
  function use() {
    if (result.errors.length || !result.segments.length) return
    if (!fits) return setMessage({ tone: 'error', text: `This plan makes ${result.segments.length} segments; Merge Mania holds ${segments.length}. Pick fewer, or ask for room for more.` })
    name(result.segments, false)
    base.setSegmentSet(null)
    setMessage({ tone: 'ok', text: `${result.segments.length} segments named from the plan, each with its condition. Type each one's DR demand and multiplier below.` })
  }
  function take(id) {
    const set = sets.find((s) => s.id === id)
    if (!set) return
    const r = setForFeature(set, 'Merge')
    if (r.errors.length) return setMessage({ tone: 'error', text: `The set "${set.name}" has something to fix on the Economy page: ${r.errors[0]}` })
    if (r.segments.length > segments.length) return setMessage({ tone: 'error', text: `The set "${set.name}" has ${r.segments.length} segments; Merge Mania holds ${segments.length}.` })
    base.setSegmentPlan(r.plan)
    name(r.segments, true)
    base.setSegmentSet({ id: set.id, name: set.name, updatedAt: set.updatedAt })
    const given = r.segments.filter((s) => s.effort != null).length
    setMessage({ tone: 'ok', text: `${r.segments.length} segments taken from "${set.name}", named Merge_ in place of ${setPlaceholder(set)}_${given ? `, ${given} with an effort` : ', none with an effort yet'}. Type each one's DR demand and multiplier below.` })
  }

  return (
    <div className="flex flex-col gap-3" data-testid="merge-segments">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3">
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500" title="Segments kept on the Economy page (Segments), each with its effort in Brut Wins. Picking one copies it into this event.">
          Take the segments from a set
          <select
            value={takenNow ? taken.id : ''}
            onChange={(e) => take(e.target.value)}
            className="w-64 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-sm normal-case tracking-normal font-normal text-slate-800"
            data-testid="merge-segment-set"
          >
            <option value="">{sets.length ? (taken && !takenNow ? `${taken.name} (deleted)` : 'Pick a set') : 'No set yet (Economy page)'}</option>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} - {s.segments.length} segments
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500" title="What one DR of this event is worth in allowance - each rank's prize is the DR paid for it times this (step 5, Prizes).">
          Worth of one merge DR <span className="normal-case tracking-normal font-normal">(allowance, this event)</span>
          <CommitNumber value={base.drWorth} allowEmpty min={0} step={0.001} onCommit={(v) => base.setDrWorth(v)} className="w-28" placeholder="not set" aria-label="Worth of one merge DR in allowance" data-testid="merge-dr-worth" />
        </label>
        <p className="max-w-2xl pb-1 text-xs text-slate-500" data-note>
          {taken ? `${applied} segments taken from the set "${taken.name}", each with its condition and effort.` : applied ? `${applied} segments come from the segment plan below, each with its condition.` : 'The segments can be built from rules below (Brut Wins bands, specifics, mode splits), as on the Economy page.'} Each segment&apos;s multiplier against the base sizes its small rewards and its prizes.
        </p>
      </div>
      {takenChanged && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="merge-set-changed">
          <span className="flex-1 min-w-[16rem]">The set &ldquo;{takenNow.name}&rdquo; was changed on the Economy page after this event took it. This event keeps its copy until you take the new one.</span>
          <button type="button" onClick={() => take(takenNow.id)} className="rounded-xl bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700" data-testid="merge-set-retake">
            Take its new numbers
          </button>
        </div>
      )}
      <Collapsible id="setup-segment-plan" title="Build the segments" summary={applied ? `${applied} segments from the plan` : 'from rules: a base in bands, specifics, mode splits'}>
        <SegmentPlanEditor
          plan={plan}
          setPlan={setPlan}
          action={
            <button type="button" onClick={use} disabled={!!result.errors.length || !result.segments.length || !fits} title={fits ? 'Name Merge Mania\'s segments from this plan' : `Merge Mania holds ${segments.length} segments`} className="rounded-xl bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40" data-testid="merge-use-segments">
              Use these segments
            </button>
          }
        />
        {!fits && (
          <p className="mt-2 text-sm text-amber-800" data-testid="merge-segments-too-many">
            This plan makes {result.segments.length} segments; Merge Mania holds {segments.length}.
          </p>
        )}
        {message && (
          <p className={`mt-2 text-sm ${message.tone === 'error' ? 'text-rose-700' : 'text-emerald-700'}`} data-testid="merge-segments-message">
            {message.text}
          </p>
        )}
      </Collapsible>
    </div>
  )
}
