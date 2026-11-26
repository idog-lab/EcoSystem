import { useState } from 'react'
import { SegmentPlanEditor } from '../../../economy/SegmentsTab'
import { buildPlan, createPlan } from '../../../../lib/economy/segmentFlow'
import { Collapsible, CommitNumber } from './buildUi'

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

  function use() {
    if (result.errors.length || !result.segments.length) return
    if (!fits) return setMessage({ tone: 'error', text: `This plan makes ${result.segments.length} segments; Merge Mania holds ${segments.length}. Pick fewer, or ask for room for more.` })
    segments.forEach((seg, i) => {
      const s = result.segments[i]
      if (s) {
        seg.setName(s.name)
        seg.setCondition(s.condition)
        seg.setSegmentKey(s.key)
      } else if (seg.segmentKey) {
        // A segment the plan no longer makes: its name and condition go; what it holds stays.
        seg.setName(`Segment ${i + 1}`)
        seg.setCondition('')
        seg.setSegmentKey('')
      }
    })
    setMessage({ tone: 'ok', text: `${result.segments.length} segments named from the plan, each with its condition. Type each one's DR demand and multiplier below.` })
  }

  return (
    <div className="flex flex-col gap-3" data-testid="merge-segments">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3">
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500" title="What one DR of this event is worth in allowance - each rank's prize is the DR paid for it times this (step 5, Prizes).">
          Worth of one merge DR <span className="normal-case tracking-normal font-normal">(allowance, this event)</span>
          <CommitNumber value={base.drWorth} allowEmpty min={0} step={0.001} onCommit={(v) => base.setDrWorth(v)} className="w-28" placeholder="not set" aria-label="Worth of one merge DR in allowance" data-testid="merge-dr-worth" />
        </label>
        <p className="max-w-2xl pb-1 text-xs text-slate-500" data-note>
          {applied ? `${applied} segments come from the segment plan below, each with its condition.` : 'The segments can be built from rules below (Brut Wins bands, specifics, mode splits), as on the Economy page.'} Each segment&apos;s multiplier against the base sizes its small rewards and its prizes.
        </p>
      </div>
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
