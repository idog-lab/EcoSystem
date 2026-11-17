import { Plus, Copy, Trash2 } from 'lucide-react'
import Card from '../../../components/ui/Card'
import NumberField from '../../../components/ui/NumberField'
import { PRIZE_TIERS, SEGMENT_PRIZE_MULTIPLIER, ACTIVITY_SHAPES, ACTIVITY_SHAPE_LABELS } from '../lib/chefModel'

// Mirrors Merge's own segment logic (CLAUDE.md's "Segments" section) -
// same pattern, not the same domain rules: every Chef segment shares the
// same ingredients/dishes/baskets/calendar, and differs only on its own
// avg-baskets-opened-per-day rate (the lever the (future) day-by-day
// completion simulator will consume) and its own prize tier (confirmed by
// the economist - dish/total-chef prize VALUES scale per segment too, via
// SEGMENT_PRIZE_MULTIPLIER, applied on top of each dish's shared baseline
// prizeValue).
export default function SegmentsTab({ segments, onUpdate, onAdd, onDuplicate, onRemove }) {
  return (
    <Card
      title="Segments"
      subtitle="Real per-segment avg baskets/day (from the legacy chef's own DAU/Revenue cohorts) + each segment's own prize tier."
      action={
        <button type="button" onClick={onAdd} className="flex items-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-800">
          <Plus size={13} /> Add segment
        </button>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {segments.map((seg) => (
          <div key={seg.id} className="group relative flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/70 p-3">
            <div className="absolute top-2 right-2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
              <button type="button" title="Duplicate" onClick={() => onDuplicate(seg.id)} className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                <Copy size={13} />
              </button>
              <button type="button" title="Remove" onClick={() => onRemove(seg.id)} className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50">
                <Trash2 size={13} />
              </button>
            </div>
            <input
              value={seg.name}
              onChange={(e) => onUpdate(seg.id, { name: e.target.value })}
              className="font-semibold text-sm text-slate-800 bg-transparent border-b border-transparent focus:border-purple-300 focus:outline-none pr-12"
            />
            <div className="grid grid-cols-3 gap-1.5">
              {['basic', 'rare', 'epic'].map((chest) => (
                <NumberField
                  key={chest}
                  label={chest}
                  min={0}
                  step={0.01}
                  value={seg.avgBasketsPerDay[chest]}
                  onChange={(e) => onUpdate(seg.id, { avgBasketsPerDay: { ...seg.avgBasketsPerDay, [chest]: Number(e.target.value) || 0 } })}
                />
              ))}
            </div>
            <label className="text-xs flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Prize tier</span>
              <select value={seg.prizeTier} onChange={(e) => onUpdate(seg.id, { prizeTier: e.target.value })} className="border border-slate-200 rounded-lg px-2 py-1.5 bg-white/70">
                {PRIZE_TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {tier} (×{SEGMENT_PRIZE_MULTIPLIER[tier]})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Daily activity shape</span>
              <select
                value={seg.activityShape ?? 'flat'}
                onChange={(e) => onUpdate(seg.id, { activityShape: e.target.value })}
                className="border border-slate-200 rounded-lg px-2 py-1.5 bg-white/70"
              >
                {ACTIVITY_SHAPES.map((shape) => (
                  <option key={shape} value={shape}>
                    {ACTIVITY_SHAPE_LABELS[shape]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}
        {segments.length === 0 && <p className="text-sm text-slate-400">No segments yet — click "Add segment" to start.</p>}
      </div>
    </Card>
  )
}
