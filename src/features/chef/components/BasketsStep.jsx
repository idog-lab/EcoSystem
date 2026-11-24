import { useState } from 'react'
import Card from '../../../components/ui/Card'
import Collapsible from '../../../components/ui/Collapsible'
import {
  CHEST_LABELS,
  CHEST_TYPES,
  RARITY,
  RARITY_LABELS,
  ROUND_LABELS,
  THRESHOLD_COUNTS,
  THRESHOLD_COUNT_LABELS,
  createBasket,
  createPreset,
  createSource,
  createThreshold,
  phaseDayRange,
} from '../lib/chefModel'
import { dayLabel } from '../lib/chefFormat'
import { AddButton, Check, Field, Num, RowActions, Toggle, SELECT, TD, TH } from './chefUi'

const RARITY_COLOR = {
  [RARITY.SEMI_BLOCKER]: 'bg-violet-100 text-violet-700',
  [RARITY.BLOCKER]: 'bg-rose-100 text-rose-700',
}
const TEXT_INPUT = 'w-full min-w-[7rem] rounded-lg border border-slate-200 bg-white/80 px-2 py-1 text-sm text-slate-700 focus:border-purple-400 focus:outline-none'

// One basket's odds. `weightsKey`: the real odds (`ingredientWeights`) or the
// pricing odds (`pricingIngredientWeights`, read only by the older basket
// estimate of step 6). A row for every ingredient of the chef: one added later
// shows with a weight of 0 and the first edit puts it in the table.
function WeightTable({ basket, weightsKey, ingredients, byId, onUpdate }) {
  const weights = basket[weightsKey] ?? basket.ingredientWeights
  const total = weights.reduce((sum, w) => sum + w.weight, 0)
  const inTable = new Set(weights.map((w) => w.ingredientId))
  const rows = [...weights, ...ingredients.filter((ing) => !inTable.has(ing.id)).map((ing) => ({ ingredientId: ing.id, min: 0, max: 1, weight: 0 }))]
  const showMin = rows.some((w) => (w.min ?? 0) > 0)
  const updateRow = (ingredientId, patch) => onUpdate(basket.id, { [weightsKey]: rows.filter((w) => inTable.has(w.ingredientId) || w.ingredientId === ingredientId).map((w) => (w.ingredientId === ingredientId ? { ...w, ...patch } : w)) })

  return (
    <table className="w-full border-collapse" data-dense>
      <thead>
        <tr className="border-b border-slate-200">
          <th className={TH}>Ingredient</th>
          <th className={`${TH} text-center`} title="How likely each ingredient is against the others. 0 keeps it out of this basket.">
            Weight
          </th>
          <th className={`${TH} text-center`} title="The chance of each unit at the start of a basket: the weight as a share of all the weights. It rises for the others once an ingredient has reached its most for the basket, or is held back by its progression threshold.">
            Chance
          </th>
          {showMin && (
            <th className={`${TH} text-center`} title="The least of it a basket gives, as carried from the game's syntax. What a minimum above 0 does in the game is not known: it is kept and not played.">
              Least
            </th>
          )}
          <th className={`${TH} text-center`} title="The most of this ingredient one basket can roll. It is neither the pantry cap (step 2) nor the progression threshold (below).">
            Most a basket
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((w) => {
          const ing = byId[w.ingredientId]
          return (
            <tr key={w.ingredientId} className="border-b border-slate-100" data-weight-row={w.ingredientId}>
              <td className={`${TD} whitespace-nowrap text-sm font-medium text-slate-700`}>
                <span aria-hidden="true">{ing?.art ?? ''}</span> {ing?.name ?? w.ingredientId}
              </td>
              <td className={`${TD} text-center`}>
                <Num aria-label={`${ing?.name ?? w.ingredientId}: weight`} value={w.weight} step="any" onCommit={(n) => updateRow(w.ingredientId, { weight: n })} className={`w-16 ${w.weight === 0 ? 'text-slate-300' : 'border-purple-200 bg-purple-50/60 font-semibold text-purple-800'}`} />
              </td>
              <td className={`${TD} text-center text-sm tabular-nums text-slate-500`}>{total > 0 && w.weight > 0 ? `${((w.weight / total) * 100).toFixed(1)}%` : '-'}</td>
              {showMin && (
                <td className={`${TD} text-center`}>
                  <Num aria-label={`${ing?.name ?? w.ingredientId}: least a basket`} value={w.min ?? 0} onCommit={(n) => updateRow(w.ingredientId, { min: Math.round(n) })} className="w-12 border-amber-200 bg-amber-50/60" />
                </td>
              )}
              <td className={`${TD} text-center`}>
                <Num aria-label={`${ing?.name ?? w.ingredientId}: most a basket`} value={w.max} onCommit={(n) => updateRow(w.ingredientId, { max: Math.round(n) })} className="w-14" />
              </td>
            </tr>
          )
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={4} className="px-2 py-2 text-sm text-slate-400">
              No ingredients on this basket yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

function BasketCard({ basket, calendar, weightsKey, ingredients, byId, onUpdate, onDuplicate, onRemove }) {
  const pricing = weightsKey === 'pricingIngredientWeights'
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          <select value={basket.chestType} aria-label="Basket type" onChange={(e) => onUpdate(basket.id, { chestType: e.target.value })} className={`${SELECT} font-semibold`}>
            {CHEST_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {CHEST_LABELS[ct]} basket
              </option>
            ))}
          </select>
          <select value={basket.phaseId ?? ''} aria-label="The phase this basket is for" onChange={(e) => onUpdate(basket.id, { phaseId: e.target.value })} className={SELECT}>
            {!calendar.phases.some((p) => p.id === basket.phaseId) && <option value={basket.phaseId ?? ''}>No phase</option>}
            {calendar.phases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </span>
      }
      action={<RowActions what="this basket" onDuplicate={() => onDuplicate(basket.id)} onRemove={() => onRemove(basket.id)} />}
    >
      <div data-basket={`${basket.chestType}-${basket.phaseId}`}>
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          Gives from
          <Num aria-label="Fewest ingredients a basket gives" data-field="total-min" value={basket.totalMin} onCommit={(n) => onUpdate(basket.id, { totalMin: Math.round(n) })} className="w-14" />
          to
          <Num aria-label="Most ingredients a basket gives" data-field="total-max" value={basket.totalMax} onCommit={(n) => onUpdate(basket.id, { totalMax: Math.round(n) })} className="w-14" />
          ingredients
        </p>
        {pricing && !basket.pricingIngredientWeights && <p className="mb-2 text-xs text-slate-500">No pricing odds of its own: these are its real odds. A change here gives it pricing odds.</p>}
        <WeightTable basket={basket} weightsKey={weightsKey} ingredients={ingredients} byId={byId} onUpdate={onUpdate} />
      </div>
    </Card>
  )
}

function IngredientSelect({ ingredients, value, onChange, none = null, ...props }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={SELECT} {...props}>
      {none != null && <option value="">{none}</option>}
      {none == null && !ingredients.some((i) => i.id === value) && <option value={value ?? ''}>-</option>}
      {ingredients.map((ing) => (
        <option key={ing.id} value={ing.id}>
          {ing.name}
        </option>
      ))}
    </select>
  )
}

// "All segments", or the ones ticked.
function SegmentChoice({ segments, value, onChange, what }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <select value={value ? 'some' : 'all'} aria-label={`${what}: for which segments`} onChange={(e) => onChange(e.target.value === 'all' ? null : segments.map((s) => s.id))} className={SELECT}>
        <option value="all">All segments</option>
        <option value="some">Only some</option>
      </select>
      {value &&
        segments.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={value.includes(s.id)}
            onClick={() => onChange(value.includes(s.id) ? value.filter((id) => id !== s.id) : [...value, s.id])}
            className={`whitespace-nowrap rounded-lg px-2 py-0.5 text-[11px] font-semibold ${value.includes(s.id) ? 'bg-purple-600 text-white' : 'border border-slate-200 bg-white/70 text-slate-400'}`}
          >
            {s.name}
          </button>
        ))}
    </span>
  )
}

// PROGRESSION THRESHOLDS: for an ingredient and a round, how much a player may
// have RECEIVED so far before ordinary baskets stop giving it - a schedule by
// calendar day, the same for every segment. Not the pantry cap: cooking frees
// nothing here.
function Thresholds({ state, update }) {
  const { thresholds, ingredients, calendar, settings } = state
  const days = Math.max(1, calendar.totalDays)
  const [semi, setSemi] = useState({ start: 2, every: 2, by: 2 })
  const setThreshold = (id, patch) => update((s) => ({ ...s, thresholds: s.thresholds.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)) }))
  const setStep = (id, index, patch) => setThreshold(id, (t) => ({ steps: t.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)) }))
  const setSetting = (patch) => update((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
  const addSchedule = (round) => {
    const taken = new Set(thresholds.filter((t) => t.round === round).map((t) => t.ingredientId))
    const pick = ingredients.find((i) => i.rarity === RARITY.BLOCKER && !taken.has(i.id)) ?? ingredients.find((i) => i.rarity === RARITY.SEMI_BLOCKER && !taken.has(i.id)) ?? ingredients.find((i) => !taken.has(i.id)) ?? ingredients[0]
    if (pick) update((s) => ({ ...s, thresholds: [...s.thresholds, createThreshold({ ingredientId: pick.id, round, steps: [{ fromDay: 1, limit: 0 }] })] }))
  }
  // The semi-blocker during the Dish Master: a mild rise, then no restriction once it ends.
  const dm = calendar.dishMaster ?? {}
  const semiBlocker = ingredients.find((i) => i.rarity === RARITY.SEMI_BLOCKER)
  const writeSemi = () => {
    const steps = []
    let limit = Math.max(0, Math.round(semi.start))
    for (let day = dm.startDay; day <= dm.endDay; day += Math.max(1, Math.round(semi.every))) {
      steps.push({ fromDay: day, limit })
      limit += Math.max(0, Math.round(semi.by))
    }
    if (dm.endDay < days) steps.push({ fromDay: dm.endDay + 1, limit: null })
    update((s) => ({ ...s, thresholds: [...s.thresholds.filter((t) => !(t.round === 'main' && t.ingredientId === semiBlocker.id)), createThreshold({ ingredientId: semiBlocker.id, round: 'main', steps })] }))
  }

  return (
    <div className="flex flex-col gap-4" data-testid="chef-thresholds">
      <p className="text-sm text-slate-600" data-note>
        A threshold counts what a player has received of an ingredient in the round - from baskets and from everything else. While the count is below the limit, ordinary baskets can give the ingredient; once
        it is reached they leave it out and give the others in its place. Cooking does not lower the count. A schedule can rise in steps and end with no limit. It is the same for every segment.
      </p>
      {thresholds.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" data-dense data-testid="chef-threshold-table">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={TH}>Ingredient</th>
                <th className={TH}>Round</th>
                <th className={TH} title="From a day on, the most a player may have received. An empty limit lifts the restriction from that day.">
                  From day: limit
                </th>
                <th className={TH} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {thresholds.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 align-top" data-threshold={`${t.round}-${t.ingredientId}`}>
                  <td className={TD}>
                    <IngredientSelect ingredients={ingredients} value={t.ingredientId} onChange={(id) => setThreshold(t.id, { ingredientId: id })} aria-label="Ingredient" />
                  </td>
                  <td className={TD}>
                    <select value={t.round} aria-label="Round" onChange={(e) => setThreshold(t.id, { round: e.target.value })} className={SELECT}>
                      <option value="main">{ROUND_LABELS.main}</option>
                      <option value="rc">{ROUND_LABELS.rc}</option>
                    </select>
                  </td>
                  <td className={TD}>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      {t.steps.map((step, i) => (
                        <span key={i} className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-slate-50 px-1.5 py-0.5 text-sm text-slate-500" data-step={i}>
                          day
                          <Num aria-label={`Step ${i + 1}: from day`} data-field="from-day" value={step.fromDay} min={1} max={days} onCommit={(n) => setStep(t.id, i, { fromDay: Math.round(n) })} className="w-12" />:
                          <Num aria-label={`Step ${i + 1}: limit`} data-field="limit" value={step.limit} allowEmpty placeholder="no limit" onCommit={(n) => setStep(t.id, i, { limit: n == null ? null : Math.round(n) })} className="w-[5.25rem]" />
                          {t.steps.length > 1 && (
                            <button type="button" aria-label={`Remove step ${i + 1}`} title="Remove this step" onClick={() => setThreshold(t.id, (x) => ({ steps: x.steps.filter((_, k) => k !== i) }))} className="px-0.5 text-slate-400 hover:text-red-600">
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                      <AddButton onClick={() => setThreshold(t.id, (x) => ({ steps: [...x.steps, { fromDay: Math.min(days, (x.steps.at(-1)?.fromDay ?? 0) + 1), limit: x.steps.at(-1)?.limit ?? 0 }] }))} data-testid="chef-add-threshold-step">
                        step
                      </AddButton>
                    </span>
                  </td>
                  <td className={`${TD} text-right`}>
                    <RowActions what="this schedule" onRemove={() => update((s) => ({ ...s, thresholds: s.thresholds.filter((x) => x.id !== t.id) }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <AddButton onClick={() => addSchedule('main')} data-testid="chef-add-threshold" disabled={ingredients.length === 0}>
          Add a schedule for the Main round
        </AddButton>
        <AddButton onClick={() => addSchedule('rc')} data-testid="chef-add-threshold-rc" disabled={ingredients.length === 0}>
          Add one for Recompletion
        </AddButton>
      </div>

      {semiBlocker && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-3 py-2.5" data-testid="chef-semi-helper">
          <p className="text-sm font-semibold text-slate-700">{semiBlocker.name} during the Dish Master</p>
          {dm.startDay != null && dm.endDay != null ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              From day {dm.startDay}: up to
              <Num aria-label="Semi-blocker: first limit" value={semi.start} onCommit={(n) => setSemi({ ...semi, start: n })} className="w-14" />, then every
              <Num aria-label="Semi-blocker: every days" value={semi.every} min={1} onCommit={(n) => setSemi({ ...semi, every: n })} className="w-12" />
              days
              <Num aria-label="Semi-blocker: more" value={semi.by} onCommit={(n) => setSemi({ ...semi, by: n })} className="w-12" />
              more; no limit after day {dm.endDay}.
              <button type="button" onClick={writeSemi} data-testid="chef-semi-write" className="rounded-lg bg-purple-600 px-3 py-1 text-xs font-semibold text-white">
                Write this schedule
              </button>
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-500">Set the Dish Master days in step 1 to write a mild rise during it and no limit after it. Nothing is written by itself.</p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-slate-100 pt-3" data-testid="chef-threshold-rules">
        <p className="text-sm text-slate-600" data-testid="chef-threshold-policy">
          <span className="font-semibold text-slate-700">The limit:</span> a player stops exactly at it, inside a basket too - the rest of that basket is made of other ingredients (your rule).
        </p>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Not confirmed yet - a choice for now, shown with every run</p>
        <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600" title="Whether ingredients lost because the pantry was full still count as received. Both figures are tracked; this picks the one the limit is compared with.">
          What counts as received
          <select value={settings.thresholdCounts} data-testid="chef-threshold-counts" onChange={(e) => setSetting({ thresholdCounts: e.target.value })} className={SELECT}>
            {THRESHOLD_COUNTS.map((id) => (
              <option key={id} value={id}>
                {THRESHOLD_COUNT_LABELS[id]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600" title="How many ordinary ingredients may be paced with a threshold. Kept for the suggestions of a later build; nothing reads it yet.">
          Ordinary ingredients that may be paced
          <Num aria-label="Ordinary ingredients that may be paced" value={settings.pacingOrdinaryIngredients} min={0} max={20} onCommit={(n) => setSetting({ pacingOrdinaryIngredients: Math.round(n) })} className="w-14" />
          <span className="text-xs text-slate-400">(kept for a later build)</span>
        </label>
      </div>
    </div>
  )
}

// SPECIAL SOURCES AND JOKERS: what is handed out besides the baskets.
function Sources({ state, update }) {
  const { sources, ingredients, calendar, segments, settings } = state
  const days = Math.max(1, calendar.totalDays)
  const setSource = (id, patch) => update((s) => ({ ...s, sources: s.sources.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
  const setSetting = (patch) => update((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
  const add = (kind) => update((s) => ({ ...s, sources: [...s.sources, createSource({ kind, day: 1, ingredientId: kind === 'joker' ? null : (s.ingredients[0]?.id ?? null), amount: kind === 'joker' ? 1 : 0 })] }))
  return (
    <div className="flex flex-col gap-3" data-testid="chef-sources">
      <p className="text-sm text-slate-600" data-note>
        A sale, an event reward, a joker. Type who gets it: nothing here guesses how many players buy or win one. What a source gives counts toward the progression threshold like anything else, and it stops at the
        limit unless it is allowed to pass it. A joker is spent on three different ingredients: {settings.jokerAmount} of each, {settings.jokerBlockerAmount} of the blocker.
      </p>
      {sources.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" data-dense data-testid="chef-grants">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={TH}>What</th>
                <th className={`${TH} text-center`}>Day</th>
                <th className={`${TH} text-center`} title="For an ingredient: how many. For jokers: how many jokers.">
                  Amount
                </th>
                <th className={`${TH} text-center`} title="The share of the players who get it.">
                  Players
                </th>
                <th className={TH}>For</th>
                <th className={TH} title="Whether it may give an ingredient past its progression threshold. Without it, it stops at the limit and the rest is held back. Catch-up presets never have this.">
                  Past the threshold
                </th>
                <th className={TH}>Note</th>
                <th className={TH} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.id} className="border-b border-slate-100" data-source={source.kind}>
                  <td className={TD}>
                    {source.kind === 'joker' ? <span className="whitespace-nowrap text-sm font-semibold text-violet-700">Joker</span> : <IngredientSelect ingredients={ingredients} value={source.ingredientId} onChange={(id) => setSource(source.id, { ingredientId: id })} aria-label="Ingredient" />}
                  </td>
                  <td className={`${TD} whitespace-nowrap text-center`} title={dayLabel(calendar, source.day)}>
                    <Num aria-label="Day" value={source.day} min={1} max={days} onCommit={(n) => setSource(source.id, { day: Math.round(n) })} className="w-14" />
                  </td>
                  <td className={`${TD} text-center`}>
                    <Num aria-label="Amount" value={source.amount} onCommit={(n) => setSource(source.id, { amount: Math.round(n) })} className="w-16" />
                  </td>
                  <td className={`${TD} text-center`}>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm text-slate-500">
                      <Num aria-label="Share of players, in %" value={source.coveragePct} max={100} onCommit={(n) => setSource(source.id, { coveragePct: n })} className="w-14" />%
                    </span>
                  </td>
                  <td className={TD}>
                    <SegmentChoice segments={segments} value={source.segmentIds} onChange={(ids) => setSource(source.id, { segmentIds: ids })} what="This source" />
                  </td>
                  <td className={TD}>
                    <Check checked={source.bypassThreshold} onChange={(v) => setSource(source.id, { bypassThreshold: v })} aria-label="May pass the threshold" data-field="bypass">
                      may pass
                    </Check>
                  </td>
                  <td className={TD}>
                    <input value={source.label ?? ''} aria-label="Note" placeholder="sale, event..." onChange={(e) => setSource(source.id, { label: e.target.value })} className={TEXT_INPUT} />
                    {source.origin === 'events-suggested' && (
                      <span className="mt-0.5 inline-block rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800" data-source-suggested title="Added by a special-event suggestion in step 4. A suggestion, not a confirmed design value; one undo in step 4 takes it out again.">
                        Suggested (step 4)
                      </span>
                    )}
                  </td>
                  <td className={`${TD} text-right`}>
                    <RowActions what="this line" onRemove={() => update((s) => ({ ...s, sources: s.sources.filter((x) => x.id !== source.id) }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <AddButton onClick={() => add('ingredient')} data-testid="chef-add-grant" disabled={ingredients.length === 0}>
          Add a sale or event reward
        </AddButton>
        <AddButton onClick={() => add('joker')} data-testid="chef-add-joker" disabled={ingredients.length < 3}>
          Add a joker
        </AddButton>
      </div>
      <div className="flex flex-col gap-2 border-t border-slate-100 pt-3" data-testid="chef-source-rules">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Confirmed with you</p>
        <p className="text-sm text-slate-600" data-testid="chef-recipients">
          <span className="font-semibold text-slate-700">Who gets a source:</span> the same players first - a 20% source reaches part of a 50% one.
        </p>
        <p className="text-sm text-slate-600" data-testid="chef-joker-policy">
          <span className="font-semibold text-slate-700">A joker is spent on</span> the blocker while it is needed, then what is most missing.
        </p>
        <span className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          It gives
          <Num aria-label="Joker: of an ordinary ingredient" value={settings.jokerAmount} onCommit={(n) => setSetting({ jokerAmount: Math.round(n) })} className="w-14" />
          of an ordinary or semi-blocker ingredient,
          <Num aria-label="Joker: of the blocker" value={settings.jokerBlockerAmount} onCommit={(n) => setSetting({ jokerBlockerAmount: Math.round(n) })} className="w-14" />
          of the blocker
        </span>
      </div>
    </div>
  )
}

// CATCH-UP PRESETS: a player who qualifies opens the same basket and gets
// guaranteed contents in the place of the drawn ones.
function Presets({ state, update }) {
  const { presets, ingredients, baskets, calendar, segments } = state
  const days = Math.max(1, calendar.totalDays)
  const setPreset = (id, patch) => update((s) => ({ ...s, presets: s.presets.map((p) => (p.id === id ? { ...p, ...(typeof patch === 'function' ? patch(p) : patch) } : p)) }))
  const setWho = (id, patch) => setPreset(id, (p) => ({ eligibility: { ...p.eligibility, ...patch } }))
  // The sizes a basket of a type can have, over the phases a preset's days touch.
  const sizesOf = (preset) => {
    const sizes = new Set()
    for (const phase of calendar.phases) {
      const range = phaseDayRange(calendar, phase.id)
      if (!range || range.startDay > (preset.endDay ?? days) || range.endDay < (preset.startDay ?? 1)) continue
      const basket = baskets.find((b) => b.phaseId === phase.id && b.chestType === preset.chestType)
      if (basket) for (let size = basket.totalMin; size <= basket.totalMax; size += 1) sizes.add(size)
    }
    return [...sizes].sort((a, b) => a - b)
  }
  return (
    <div className="flex flex-col gap-4" data-testid="chef-presets">
      <p className="text-sm text-slate-600" data-note>
        A player who qualifies opens the same basket and gets these contents instead - guaranteed, not drawn. It takes the place of a basket; it is not one more. Who qualifies is read when the basket is opened:
        nothing about what happens later. A preset never gives past a progression threshold and never overfills the pantry. Typed by hand here; step 4 can also suggest catch-up presets, and one that came from a suggestion is marked so.
      </p>
      {presets.map((preset) => {
        const sizes = sizesOf(preset)
        const fixed = preset.sizeMode === 'fixed'
        const rows = fixed ? [['fixed', preset.fixedContents ?? {}]] : sizes.map((size) => [size, preset.allocations?.[size] ?? {}])
        const setCell = (rowKey, ingredientId, value) =>
          setPreset(preset.id, (p) => {
            if (rowKey === 'fixed') return { fixedContents: { ...(p.fixedContents ?? {}), [ingredientId]: value } }
            return { allocations: { ...(p.allocations ?? {}), [rowKey]: { ...(p.allocations?.[rowKey] ?? {}), [ingredientId]: value } } }
          })
        const e = preset.eligibility ?? {}
        return (
          <div key={preset.id} className={`rounded-2xl border px-3 py-3 ${preset.enabled === false ? 'border-slate-200 bg-slate-50/60 opacity-70' : 'border-purple-100 bg-white/70'}`} data-preset={preset.id}>
            <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
              <Field label="Preset">
                <input value={preset.name} aria-label="Preset name" onChange={(ev) => setPreset(preset.id, { name: ev.target.value })} className={`${TEXT_INPUT} font-semibold`} />
              </Field>
              {preset.origin === 'build-03' && (
                <span className="mb-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800" data-preset-suggested title="Added by a catch-up suggestion in step 4. A suggestion, not a confirmed design value; one undo in step 4 takes it out again.">
                  Suggested (step 4)
                </span>
              )}
              <Field label="In the place of a">
                <select value={preset.chestType} aria-label="Basket type" onChange={(ev) => setPreset(preset.id, { chestType: ev.target.value })} className={SELECT}>
                  {CHEST_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {CHEST_LABELS[type]} basket
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Round">
                <select value={preset.round} aria-label="Round" onChange={(ev) => setPreset(preset.id, { round: ev.target.value })} className={SELECT}>
                  <option value="main">Main</option>
                  <option value="rc">Recompletion</option>
                  <option value="any">Either</option>
                </select>
              </Field>
              <Field label="From day">
                <Num aria-label="From day" value={preset.startDay} min={1} max={days} onCommit={(n) => setPreset(preset.id, { startDay: Math.round(n) })} className="w-14" />
              </Field>
              <Field label="To day" title="Empty: the last day of the event.">
                <Num aria-label="To day" value={preset.endDay} allowEmpty placeholder="end" min={1} max={days} onCommit={(n) => setPreset(preset.id, { endDay: n == null ? null : Math.round(n) })} className="w-14" />
              </Field>
              <Field label="Priority" title="When several presets fit, the lowest number is tried first; then the order of this list.">
                <Num aria-label="Priority" value={preset.priority} min={0} onCommit={(n) => setPreset(preset.id, { priority: Math.round(n) })} className="w-14" />
              </Field>
              <Field label="Most uses" title="How many baskets of one player it can take the place of. Empty: no limit.">
                <Num aria-label="Most uses a player" value={preset.maxUses} allowEmpty placeholder="any" min={1} onCommit={(n) => setPreset(preset.id, { maxUses: n == null ? null : Math.round(n) })} className="w-14" />
              </Field>
              <Field label="If it cannot be given" title="When a threshold or the pantry stops the contents: try the next preset that fits, or go straight to the ordinary basket.">
                <select value={preset.fallback} aria-label="Fallback" onChange={(ev) => setPreset(preset.id, { fallback: ev.target.value })} className={SELECT}>
                  <option value="next">Try the next preset</option>
                  <option value="ordinary">The ordinary basket</option>
                </select>
              </Field>
              <span className="ml-auto flex items-center gap-2 pb-1">
                <Check checked={preset.enabled !== false} onChange={(v) => setPreset(preset.id, { enabled: v })} aria-label="In use">
                  in use
                </Check>
                <RowActions what={preset.name} onDuplicate={() => update((s) => ({ ...s, presets: [...s.presets, createPreset({ ...JSON.parse(JSON.stringify(preset)), id: undefined, name: `${preset.name} copy` })] }))} onRemove={() => update((s) => ({ ...s, presets: s.presets.filter((p) => p.id !== preset.id) }))} />
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-600" data-preset-who>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Who</span>
              dishes cooked in the round: from
              <Num aria-label="Dishes cooked: from" value={e.dishesMin} allowEmpty placeholder="any" min={0} onCommit={(n) => setWho(preset.id, { dishesMin: n == null ? null : Math.round(n) })} className="w-14" />
              to
              <Num aria-label="Dishes cooked: to" value={e.dishesMax} allowEmpty placeholder="any" min={0} onCommit={(n) => setWho(preset.id, { dishesMax: n == null ? null : Math.round(n) })} className="w-14" />
              · still missing
              <Num aria-label="Missing at least" value={e.missingMin} allowEmpty placeholder="1" min={1} onCommit={(n) => setWho(preset.id, { missingMin: n == null ? null : Math.round(n) })} className="w-14" />
              or more of
              <IngredientSelect ingredients={ingredients} value={e.missingIngredientId} none="(not asked)" onChange={(id) => setWho(preset.id, { missingIngredientId: id })} aria-label="Missing ingredient" />
              · has received at most
              <Num aria-label="Received at most" value={e.receiptsMax} allowEmpty placeholder="any" min={0} onCommit={(n) => setWho(preset.id, { receiptsMax: n == null ? null : Math.round(n) })} className="w-14" />
              of
              <IngredientSelect ingredients={ingredients} value={e.receiptsIngredientId} none="(not asked)" onChange={(id) => setWho(preset.id, { receiptsIngredientId: id })} aria-label="Received ingredient" />
              ·
              <SegmentChoice segments={segments} value={preset.segmentIds} onChange={(ids) => setPreset(preset.id, { segmentIds: ids })} what={preset.name} />
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Contents</span>
              <Toggle
                value={preset.sizeMode}
                onChange={(mode) => setPreset(preset.id, { sizeMode: mode, fixedTotal: mode === 'fixed' ? (preset.fixedTotal ?? sizes[0] ?? null) : preset.fixedTotal })}
                options={[
                  ['by-total', "By the basket's size"],
                  ['fixed', 'Always the same'],
                ]}
              />
              {fixed ? (
                <>
                  a basket of
                  <Num aria-label="Fixed total" value={preset.fixedTotal} allowEmpty onCommit={(n) => setPreset(preset.id, { fixedTotal: n == null ? null : Math.round(n) })} className="w-14" />
                  ingredients, whatever size was rolled{sizes.length ? ` (a ${CHEST_LABELS[preset.chestType]} basket gives ${sizes[0]} to ${sizes.at(-1)})` : ''}
                </>
              ) : (
                <span className="text-xs text-slate-500">The size is rolled as always; each row says what a basket of that size holds.</span>
              )}
            </div>
            {rows.length === 0 ? (
              <p className="mt-2 text-sm text-amber-700">There is no {CHEST_LABELS[preset.chestType]} basket in these days for it to take the place of.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="border-collapse" data-dense data-preset-contents>
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className={TH}>Basket of</th>
                      {ingredients.map((ing) => (
                        <th key={ing.id} className="px-1 py-1.5 text-center text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-500" title={ing.name}>
                          <span aria-hidden="true">{ing.art ?? ''}</span> {ing.name}
                        </th>
                      ))}
                      <th className={`${TH} text-center`}>Adds up to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(([rowKey, contents]) => {
                      const total = Object.values(contents).reduce((sum, n) => sum + (n > 0 ? n : 0), 0)
                      const want = rowKey === 'fixed' ? preset.fixedTotal : rowKey
                      return (
                        <tr key={rowKey} className="border-b border-slate-100" data-size={rowKey}>
                          <td className={`${TD} text-sm font-medium text-slate-700`}>{rowKey === 'fixed' ? (preset.fixedTotal ?? '-') : rowKey}</td>
                          {ingredients.map((ing) => (
                            <td key={ing.id} className="px-0.5 py-1 text-center">
                              <Num aria-label={`Basket of ${want}: ${ing.name}`} value={contents[ing.id] ?? 0} onCommit={(n) => setCell(rowKey, ing.id, Math.round(n))} className={`w-12 ${contents[ing.id] > 0 ? 'border-purple-200 bg-purple-50/60 font-semibold text-purple-800' : 'text-slate-300'}`} />
                            </td>
                          ))}
                          <td className={`${TD} text-center text-sm font-semibold tabular-nums ${total === want ? 'text-emerald-700' : 'text-red-600'}`} data-cell="sum">
                            {total}
                            {total !== want && ` of ${want ?? '?'}`}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
      <div>
        <AddButton onClick={() => update((s) => ({ ...s, presets: [...s.presets, createPreset({ name: `Catch-up ${s.presets.length + 1}`, priority: s.presets.length + 1 })] }))} data-testid="chef-add-preset" disabled={ingredients.length === 0}>
          Add a preset
        </AddButton>
      </div>
    </div>
  )
}

// Every way a player gets a blocker or semi-blocker, and when: read off the
// baskets, the thresholds and the special sources, nothing of its own.
function BlockerSources({ state }) {
  const { ingredients, baskets, calendar, sources, thresholds } = state
  const blockers = ingredients.filter((i) => i.rarity === RARITY.SEMI_BLOCKER || i.rarity === RARITY.BLOCKER)
  if (blockers.length === 0) return <p className="text-sm text-slate-400">No ingredient is a blocker or a semi-blocker (step 2).</p>
  const phaseOrder = new Map(calendar.phases.map((p, i) => [p.id, i]))
  const ordered = [...baskets].sort((a, b) => (phaseOrder.get(a.phaseId) ?? 99) - (phaseOrder.get(b.phaseId) ?? 99) || CHEST_TYPES.indexOf(a.chestType) - CHEST_TYPES.indexOf(b.chestType))
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {blockers.map((ing) => {
        const own = sources.filter((g) => g.kind === 'joker' || g.ingredientId === ing.id)
        const schedules = thresholds.filter((t) => t.ingredientId === ing.id)
        return (
          <div key={ing.id} className="rounded-2xl border border-slate-200 bg-white/70 p-3" data-blocker={ing.id}>
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <span aria-hidden="true">{ing.art ?? '•'}</span>
              {ing.name}
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${RARITY_COLOR[ing.rarity]}`}>{RARITY_LABELS[ing.rarity]}</span>
            </p>
            <table className="w-full border-collapse" data-dense>
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={TH}>From</th>
                  <th className={TH}>When</th>
                  <th className={`${TH} text-center`}>Chance</th>
                  <th className={`${TH} text-center`}>Most a basket</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((basket) => {
                  const row = basket.ingredientWeights.find((w) => w.ingredientId === ing.id)
                  const sum = basket.ingredientWeights.reduce((s, w) => s + w.weight, 0)
                  const range = phaseDayRange(calendar, basket.phaseId)
                  const available = (row?.weight ?? 0) > 0
                  return (
                    <tr key={basket.id} className={`border-b border-slate-100 text-sm ${available ? 'text-slate-700' : 'text-slate-400'}`}>
                      <td className={`${TD} whitespace-nowrap`}>
                        {CHEST_LABELS[basket.chestType]} basket, {calendar.phases.find((p) => p.id === basket.phaseId)?.label ?? 'no phase'}
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>{range ? `Day ${range.startDay} to ${range.endDay}` : '-'}</td>
                      <td className={`${TD} text-center tabular-nums`}>{available && sum > 0 ? `${((row.weight / sum) * 100).toFixed(1)}%` : 'not in it'}</td>
                      <td className={`${TD} text-center tabular-nums`}>{available ? row.max : '-'}</td>
                    </tr>
                  )
                })}
                {own.map((source) => (
                  <tr key={source.id} className="border-b border-slate-100 text-sm text-slate-700">
                    <td className={`${TD} whitespace-nowrap`}>{source.label || (source.kind === 'joker' ? 'Joker' : 'Sale or event')}</td>
                    <td className={`${TD} whitespace-nowrap`}>{dayLabel(calendar, source.day)}</td>
                    <td className={`${TD} text-center tabular-nums`}>{source.coveragePct}% of players</td>
                    <td className={`${TD} text-center tabular-nums`}>{source.kind === 'joker' ? 'if chosen' : source.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">
              {schedules.length === 0
                ? 'No progression threshold holds it back.'
                : schedules.map((t) => `${ROUND_LABELS[t.round]} threshold: ${t.steps.map((step) => `from day ${step.fromDay} ${step.limit == null ? 'no limit' : `up to ${step.limit}`}`).join(', ')}`).join(' · ')}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// STEP 3 - BASKETS: what a basket gives in each period, what holds an
// ingredient back (progression thresholds), what is handed out besides
// (special sources and jokers), and the catch-up presets.
export default function BasketsStep({ state, update, findings = [] }) {
  const { ingredients, baskets, calendar, sources, thresholds, presets } = state
  const [phaseInView, setPhaseInView] = useState(calendar.phases[0]?.id ?? null)
  const [oddsView, setOddsView] = useState('gameplay')
  const byId = Object.fromEntries(ingredients.map((i) => [i.id, i]))
  const weightsKey = oddsView === 'gameplay' ? 'ingredientWeights' : 'pricingIngredientWeights'
  const phaseId = calendar.phases.some((p) => p.id === phaseInView) ? phaseInView : (calendar.phases[0]?.id ?? null)
  const byType = (a, b) => CHEST_TYPES.indexOf(a.chestType) - CHEST_TYPES.indexOf(b.chestType)
  const inView = baskets.filter((b) => b.phaseId === phaseId).sort(byType)
  const noPhase = baskets.filter((b) => !calendar.phases.some((p) => p.id === b.phaseId)).sort(byType)
  const blockers = ingredients.filter((i) => i.rarity === RARITY.SEMI_BLOCKER || i.rarity === RARITY.BLOCKER)
  const trouble = (area) => findings.some((f) => f.area === area && f.severity !== 'info')
  const phaseText = (phase) => {
    const range = phaseDayRange(calendar, phase.id)
    return range ? `${phase.label} (day ${range.startDay} to ${range.endDay})` : phase.label
  }
  const setBasket = (id, patch) => update((s) => ({ ...s, baskets: s.baskets.map((b) => (b.id === id ? { ...b, ...patch } : b)) }))
  // A new basket goes to the phase in view, as the first type that phase has none of, with that type's usual size.
  const addBasket = () =>
    update((s) => {
      const taken = new Set(s.baskets.filter((b) => b.phaseId === phaseId).map((b) => b.chestType))
      const chestType = CHEST_TYPES.find((t) => !taken.has(t)) ?? 'basic'
      return { ...s, baskets: [...s.baskets, createBasket({ chestType, phaseId, ingredientWeights: s.ingredients.map((i) => ({ ingredientId: i.id, min: 0, max: 1, weight: 0 })) })] }
    })
  const duplicateBasket = (id) => update((s) => ({ ...s, baskets: [...s.baskets, createBasket({ ...JSON.parse(JSON.stringify(s.baskets.find((b) => b.id === id))), id: undefined })] }))
  const removeBasket = (id) => update((s) => ({ ...s, baskets: s.baskets.filter((b) => b.id !== id) }))
  const card = (basket) => <BasketCard key={basket.id} basket={basket} calendar={calendar} weightsKey={weightsKey} ingredients={ingredients} byId={byId} onUpdate={setBasket} onDuplicate={duplicateBasket} onRemove={removeBasket} />
  const limited = [...new Set(thresholds.map((t) => byId[t.ingredientId]?.name ?? '?'))]

  return (
    <div className="flex flex-col gap-4">
      <section className="min-w-0 rounded-3xl border border-white bg-white/90 px-5 py-3.5 shadow-lg shadow-purple-950/5 ring-1 ring-slate-200/70" data-testid="chef-baskets-head">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <h2 className="font-display text-[0.95rem] font-semibold tracking-tight text-slate-800">3. Baskets</h2>
          <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            Phase
            <Toggle data-testid="chef-basket-phase" value={phaseId} onChange={setPhaseInView} options={calendar.phases.map((p) => [p.id, phaseText(p)])} />
          </label>
          <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            Odds
            <Toggle
              data-testid="chef-basket-odds"
              value={oddsView}
              onChange={setOddsView}
              options={[
                ['gameplay', 'Real odds'],
                ['pricing', 'Pricing odds'],
              ]}
            />
          </label>
          <span className="ml-auto">
            <AddButton onClick={addBasket} data-testid="chef-add-basket" disabled={!phaseId}>
              Add a basket
            </AddButton>
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-500" data-note>
          A basket rolls a number of ingredients; each is drawn by weight, no ingredient more than its most per basket. One held back by its progression threshold is left out and the others take its place, so the
          basket keeps its size. What does not fit the pantry is lost. The chance shown is the one at the start of a basket: it rises for the others once an ingredient is at its most, or held back.{oddsView === 'pricing' && ' Pricing odds are only read by the older estimate of step 6; players get the real odds.'}
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3" data-testid="chef-baskets">
        {inView.map(card)}
        {inView.length === 0 && <p className="text-sm text-slate-400">No basket is set for this phase yet.</p>}
      </div>

      {noPhase.length > 0 && (
        <div className="flex flex-col gap-3" data-testid="chef-baskets-no-phase">
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {noPhase.length === 1 ? 'One basket belongs' : `${noPhase.length} baskets belong`} to a phase that is not in the calendar, so no player ever opens {noPhase.length === 1 ? 'it' : 'them'}. Pick a
            phase for {noPhase.length === 1 ? 'it' : 'each'}, or remove {noPhase.length === 1 ? 'it' : 'them'}.
          </p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">{noPhase.map(card)}</div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
        <Collapsible
          id="chef-thresholds"
          className="xl:open:col-span-2"
          title="Progression thresholds: what holds an ingredient back"
          summary={thresholds.length === 0 ? 'None: nothing is held back, and no player can be counted as sitting in FU' : `${thresholds.length} ${thresholds.length === 1 ? 'schedule' : 'schedules'}: ${limited.join(', ')}`}
          openWhen={trouble('Thresholds')}
        >
          <Thresholds state={state} update={update} />
        </Collapsible>
        <Collapsible
          id="chef-grants"
          className="xl:open:col-span-2"
          title="Given outside the baskets: special sources and jokers"
          summary={sources.length === 0 ? 'Nothing: every ingredient comes from a basket' : `${sources.length} ${sources.length === 1 ? 'line' : 'lines'}: ${[...new Set(sources.map((g) => (g.kind === 'joker' ? 'jokers' : (byId[g.ingredientId]?.name ?? '?'))))].join(', ')}`}
          openWhen={trouble('Sources')}
        >
          <Sources state={state} update={update} />
        </Collapsible>
        <Collapsible
          id="chef-presets"
          className="xl:open:col-span-2"
          title="Catch-up presets: guaranteed contents for players who qualify"
          summary={presets.length === 0 ? 'None' : `${presets.length}: ${presets.map((p) => `${p.name}${p.enabled === false ? ' (not in use)' : ''}`).join(', ')}`}
          openWhen={trouble('Presets')}
        >
          <Presets state={state} update={update} />
        </Collapsible>
        <Collapsible
          id="chef-blockers"
          className="xl:open:col-span-2"
          title="Where each blocker comes from, and when"
          summary={blockers.length === 0 ? 'No blocker or semi-blocker ingredient' : `${blockers.map((b) => b.name).join(', ')}: every basket, threshold and source`}
        >
          <BlockerSources state={state} />
        </Collapsible>
      </div>
    </div>
  )
}
