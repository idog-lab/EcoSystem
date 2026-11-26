import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import Card from '../../components/ui/Card'
import { BUTTON, INPUT, MONO, Num, PRIMARY, TD, TH, Text } from './economyUi'
import { SEGMENT_SETS_KEY, editSet, saveFlowAsSet, saveSets, setEffort, setSegmentsOf, useSegmentSets } from '../../lib/economy/segmentSets'
import { teamData } from '../../lib/teamData'

const REMOVE = 'grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600'
const store = (sets) => {
  saveSets(sets)
  teamData.changed(SEGMENT_SETS_KEY)
}

// SEGMENT SETS ON THE ECONOMY PAGE (lib/economy/segmentSets.js): the flow above is saved as a set, and every set is
// edited here, all in one place - its name and each segment's effort in Brut Wins.
export default function SegmentSetsCard({ plan, setPlan }) {
  const sets = useSegmentSets()
  const [name, setName] = useState('')
  const [message, setMessage] = useState(null)
  const existing = sets.find((s) => s.name.toLowerCase() === name.trim().toLowerCase())
  const preview = setSegmentsOf(plan, existing?.segments ?? [])

  function save() {
    const out = saveFlowAsSet(sets, plan, name)
    if (out.error) return setMessage({ tone: 'error', text: out.error })
    store(out.sets)
    setMessage({ tone: 'ok', text: out.created ? `Saved "${out.set.name}": ${out.set.segments.length} segments. Type their efforts below.` : `"${out.set.name}" now holds the flow's ${out.set.segments.length} segments; the efforts of the segments it already had are kept.` })
  }
  function remove(set) {
    if (!window.confirm(`Delete the set "${set.name}"? Events that took it keep their copy.`)) return
    store(sets.filter((s) => s.id !== set.id))
  }

  return (
    <div data-testid="economy-segment-sets">
    <Card
      title="Segment sets"
      subtitle="Segments kept to be used again (the same segments for features of the same kind, such as 2-day level features), each with its effort in Brut Wins. A feature picks a set from a list and copies it."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Save the flow above as a set
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Level features, 2 days" className={`${INPUT} w-64`} list="economy-set-names" data-testid="economy-set-name" />
            <datalist id="economy-set-names">
              {sets.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
          </label>
          <button type="button" className={PRIMARY} onClick={save} disabled={!name.trim()} data-testid="economy-set-save">
            {existing ? 'Update this set' : 'Save as a set'}
          </button>
          <span className="pb-1 text-xs text-slate-500" data-note>
            {preview.errors.length ? 'The flow has something to fix first.' : `${preview.segments.length} segments${existing ? `; "${existing.name}" is updated, its efforts kept by segment` : ''}.`}
          </span>
        </div>
        {message && (
          <p className={`text-sm ${message.tone === 'error' ? 'text-rose-700' : 'text-emerald-700'}`} data-testid="economy-set-message">
            {message.text}
          </p>
        )}

        {!sets.length ? (
          <p className="text-sm text-slate-500" data-testid="economy-sets-empty">
            No set yet. Build the segments in the flow above, name them and save.
          </p>
        ) : (
          sets.map((set) => (
            <div key={set.id} className="rounded-2xl border border-slate-200 bg-white/80 px-3 py-2.5" data-set={set.id}>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={REMOVE} onClick={() => remove(set)} aria-label={`Delete the set ${set.name}`} title="Delete this set" data-set-delete>
                  <Trash2 size={15} />
                </button>
                <Text value={set.name} onCommit={(v) => v.trim() && store(editSet(sets, set.id, () => ({ name: v.trim() })))} className={`${INPUT} w-64 font-semibold`} aria-label="The set's name" data-set-name />
                <span className="text-xs text-slate-500">
                  {set.segments.length} segments · base {set.plan.baseRule ?? 'BW'}
                  {set.updatedAt ? ` · changed ${new Date(set.updatedAt).toLocaleDateString()}` : ''}
                </span>
                <button type="button" className={`${BUTTON} ml-auto`} onClick={() => setPlan(() => ({ ...set.plan }))} title="Put this set's flow back in the flow above, to change it and save it again" data-set-open>
                  Open in the flow
                </button>
              </div>
              <table className="mt-2 w-full border-collapse" data-dense>
                <thead>
                  <tr>
                    <th className={TH}>Segment</th>
                    <th className={TH} title="What this segment's player is expected to do, in Brut Wins. A feature turns it into its own demand once that is taught.">
                      Effort (Brut Wins)
                    </th>
                    <th className={TH}>Condition</th>
                  </tr>
                </thead>
                <tbody>
                  {set.segments.map((s) => (
                    <tr key={s.id} className="border-t border-slate-100" data-set-segment={s.id}>
                      <td className={`${TD} whitespace-nowrap font-semibold text-slate-700`}>{s.id}</td>
                      <td className={TD}>
                        <Num value={s.effort ?? ''} allowEmpty min={0} onCommit={(v) => store(setEffort(sets, set.id, s.id, v))} className="w-28" placeholder="not given" aria-label={`Effort of ${s.id} in ${set.name}`} data-set-effort />
                      </td>
                      <td className={`${TD} ${MONO} text-slate-500`}>{s.condition}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>
    </Card>
    </div>
  )
}
