import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { BUTTON, INPUT, Num, PRIMARY, TD, TH, Text } from './economyUi'
import { SEGMENT_SETS_KEY, editSet, featureOf, modeGroups, namedPlan, saveFlowAsSet, saveSets, setEffort, setEffortFollow, setEfforts, setModeFactor, setPlaceholder, setSegmentsOf, useSegmentSets } from '../../lib/economy/segmentSets'
import { teamData } from '../../lib/teamData'

const REMOVE = 'grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600'
const store = (sets) => {
  saveSets(sets)
  teamData.changed(SEGMENT_SETS_KEY)
}

// SAVE THE FLOW AS A SET (lib/economy/segmentSets.js), on the segments the flow makes: a name, and the set is saved -
// or, under the name of a set already kept, brought up to the flow with its efforts kept by segment.
// `name` / `setName`: the name typed, when the page shows it elsewhere too (a generic flow is named after it).
export function SaveSetForm({ plan, onSaved = null, name: shownName, setName: setShownName }) {
  const sets = useSegmentSets()
  const [ownName, setOwnName] = useState('')
  const name = shownName ?? ownName
  const setName = setShownName ?? setOwnName
  const [message, setMessage] = useState(null)
  const feature = String(plan?.feature ?? '').trim()
  const wanted = name.trim() || feature
  const existing = sets.find((s) => s.name.toLowerCase() === wanted.toLowerCase())
  const preview = setSegmentsOf(namedPlan(plan, wanted), existing?.segments ?? [])

  function save() {
    const out = saveFlowAsSet(sets, plan, name)
    if (out.error) return setMessage({ tone: 'error', text: out.error })
    store(out.sets)
    setMessage({ tone: 'ok', text: out.created ? `Saved "${out.set.name}": ${out.set.segments.length} segments. Type their efforts under Segment sets.` : `"${out.set.name}" now holds these ${out.set.segments.length} segments; the efforts it had are kept.` })
    onSaved?.(out.set)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={feature ? `Set name (or ${feature})` : 'Set name: 2D_Levels'}
          className={`${INPUT} w-64`}
          list="economy-set-names"
          aria-label="The set's name"
          title={preview.errors.length ? 'The flow has something to fix first.' : `${existing ? `"${existing.name}" is updated; its efforts are kept by segment.` : 'Saved under Segment sets, with an effort for each segment.'} ${feature ? `The feature typed in the flow (${featureOf(plan)})` : 'With no feature typed, the set\'s name'} is the set's name placeholder: a feature that takes the set puts its own name there.`}
          data-testid="economy-set-name"
        />
        <datalist id="economy-set-names">
          {sets.map((s) => (
            <option key={s.id} value={s.name} />
          ))}
        </datalist>
        <button type="button" className={PRIMARY} onClick={save} disabled={!wanted} data-testid="economy-set-save">
          {existing ? 'Update the set' : 'Save as a set'}
        </button>
      </div>
      {message && (
        <p className={`text-xs ${message.tone === 'error' ? 'text-rose-700' : 'text-emerald-700'}`} data-testid="economy-set-message">
          {message.text}
        </p>
      )}
    </div>
  )
}

// EVERY MODE SPLIT AT ONCE (economist: "where we see a mode split i want to have a factor on the effort between those
// ones"): each part after the first follows the part before it x the factor typed. A segment's own choice can still be
// changed in its row.
function ModeFactor({ set, sets }) {
  const [factor, setFactor] = useState('')
  const groups = modeGroups(set)
  const followers = groups.reduce((n, g) => n + g.length - 1, 0)
  const apply = () => {
    const v = Number(String(factor).replace(',', '.'))
    if (Number.isFinite(v) && v >= 0) store(setModeFactor(sets, set.id, v))
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg bg-purple-50 px-2 py-1.5 text-xs text-purple-900" data-set-mode-factor>
      <span>
        Mode splits ({groups.length}): the higher mode&apos;s effort = the lower&apos;s x
      </span>
      <input value={factor} onChange={(e) => setFactor(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} inputMode="decimal" placeholder="1.5" className={`${INPUT} w-16 !py-0.5 text-right`} aria-label="Factor between the parts of a mode split" data-set-mode-factor-input />
      <button type="button" className={`${BUTTON} !px-2 !py-0.5 text-xs`} onClick={apply} disabled={factor === ''} data-set-mode-factor-apply>
        Apply to {followers}
      </button>
    </div>
  )
}

// The name placeholder in a segment's name (2D_Levels_), marked as the part a feature replaces.
export function Placeholder({ text }) {
  return (
    <span className="rounded border border-dashed border-purple-300 bg-purple-50 px-0.5 font-mono text-[11.5px] text-purple-700" title="The name placeholder: a feature that takes this set puts its own name here">
      {text}_
    </span>
  )
}

// EVERY SET, EDITED IN ONE PLACE (economist: "edit those for all in one time"): each a small card side by side - its
// name, its segments and their effort in Brut Wins (a segment's condition in its hover), delete, open in the flow.
export default function SegmentSetsCard({ onOpen }) {
  const sets = useSegmentSets()
  function remove(set) {
    if (!window.confirm(`Delete the set "${set.name}"? Events that took it keep their copy.`)) return
    store(sets.filter((s) => s.id !== set.id))
  }

  return (
    <div className="flex flex-col gap-3" data-testid="economy-segment-sets">
      <p className="text-xs text-slate-500" data-note>
        Segments kept to be used again - the same segments for features of the same kind, such as 2-day level features - each with its effort in Brut Wins. A feature
        picks a set from a list and copies it. A set is made from Build segments (&ldquo;Save as a set&rdquo;).
      </p>
      {!sets.length ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-6 text-center text-sm text-slate-500" data-testid="economy-sets-empty">
          No set yet. Build the segments, name them and save them as a set.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {sets.map((set) => (
            <div key={set.id} className="rounded-2xl border border-slate-200 bg-white/85 px-3 py-2.5 shadow-sm" data-set={set.id}>
              <div className="flex items-center gap-1.5">
                <button type="button" className={REMOVE} onClick={() => remove(set)} aria-label={`Delete the set ${set.name}`} title="Delete this set" data-set-delete>
                  <Trash2 size={15} />
                </button>
                <Text value={set.name} onCommit={(v) => v.trim() && store(editSet(sets, set.id, () => ({ name: v.trim() })))} className={`${INPUT} min-w-0 flex-1 font-semibold`} aria-label="The set's name" data-set-name />
                <button type="button" className={`${BUTTON} shrink-0 !px-2.5 !py-1 text-xs`} onClick={() => onOpen(set)} title="Put this set's flow in Build segments, to change it and save it again" data-set-open>
                  Open
                </button>
              </div>
              <div className="mt-1.5 text-[11px] text-slate-500" data-set-placeholder={setPlaceholder(set)}>
                Name placeholder <Placeholder text={setPlaceholder(set)} /> - a feature that takes the set puts its own name there (Merge_{set.segments[0]?.id ?? '...'}).
              </div>
              <div className="text-[11px] text-slate-400">
                {set.segments.length} segments · {set.segments.filter((s) => setEfforts(set)[s.id]?.value != null).length} with an effort{set.updatedAt ? ` · changed ${new Date(set.updatedAt).toLocaleDateString()}` : ''}
              </div>
              {modeGroups(set).length > 0 && <ModeFactor set={set} sets={sets} />}
              <table className="mt-1 w-full border-collapse" data-dense>
                <thead>
                  <tr>
                    <th className={TH}>Segment</th>
                    <th className={`${TH} text-right`} title="What this segment's player is expected to do, in Brut Wins. A feature turns it into its own demand once that is taught.">
                      Effort (Brut Wins)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {set.segments.map((s) => {
                    const value = setEfforts(set)[s.id]
                    return (
                      <tr key={s.id} className="border-t border-slate-100" data-set-segment={s.id}>
                        <td className={`${TD} text-sm text-slate-700`} title={s.condition}>
                          <Placeholder text={setPlaceholder(set)} />
                          {s.id}
                        </td>
                        <td className={`${TD} text-right`}>
                          <div className="flex items-center justify-end gap-1">
                            <select
                              value={s.effortOf ?? ''}
                              onChange={(e) => store(setEffortFollow(sets, set.id, s.id, e.target.value || null, s.effortFactor ?? 1))}
                              className={`${INPUT} w-[7.5rem] !px-1.5 text-xs`}
                              title={s.effortOf ? `${s.id}'s effort is ${s.effortOf}'s times the factor` : "Typed: a number of Brut Wins. Or another segment's effort times a factor."}
                              aria-label={`How the effort of ${s.id} is set`}
                              data-set-effort-mode
                            >
                              <option value="">Typed</option>
                              {set.segments
                                .filter((o) => o.id !== s.id)
                                .map((o) => (
                                  <option key={o.id} value={o.id}>
                                    x {o.id}
                                  </option>
                                ))}
                            </select>
                            {s.effortOf ? (
                              <>
                                <Num value={s.effortFactor ?? ''} allowEmpty min={0} onCommit={(v) => store(setEffortFollow(sets, set.id, s.id, s.effortOf, v))} className="w-14 text-right" placeholder="x" aria-label={`Factor of ${s.id}`} data-set-effort-factor />
                                <span className="w-14 text-right text-xs font-semibold tabular-nums text-purple-700" data-set-effort-value title={value?.problem ?? undefined}>
                                  {value?.value != null ? `= ${value.value}` : '-'}
                                </span>
                              </>
                            ) : (
                              <Num value={s.effort ?? ''} allowEmpty min={0} onCommit={(v) => store(setEffort(sets, set.id, s.id, v))} className="w-[7.25rem] text-right" placeholder="-" aria-label={`Effort of ${s.id} in ${set.name}`} data-set-effort />
                            )}
                          </div>
                          {value?.problem && s.effortOf && (
                            <div className="text-[11px] text-amber-700" data-set-effort-problem>
                              {value.problem}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
