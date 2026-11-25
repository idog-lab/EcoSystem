import { Fragment, useState } from 'react'
import { Trash2 } from 'lucide-react'
import Card from '../../components/ui/Card'
import { CHEF_BASKET_TIERS, CORE_CURRENCIES, RESOURCES, coreCurrency, createCurrency, currencyChoices, isTaught, notTaught, notTaughtMessage, parseDailyValues, taughtChefBasket, taughtCurrency, taughtResource } from '../../lib/economy/economyModel'
import { BUTTON, CopyButton, INPUT, MONO, Num, TD, TH, TaughtMark, TaughtValue } from './economyUi'
import DailyValues from './DailyValues'
import PeriodValues from './PeriodValues'

const STEP_TEXT = { day: 'A value for each day', week: 'A value for each week it is live (7 days from the day typed)', range: 'A value from a date to a date', fixed: 'One worth, the same every day (for now)' }
const UNIT = { day: ['day', 'days'], week: ['week', 'weeks'], range: ['period', 'periods'] }

const DR_NAME = /^dr-[a-z0-9]+(?:-[a-z0-9]+)*$/
const NEW_CURRENCY = '__new__'
// 2026-11-30 -> "30 Nov 2026"
const readable = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

// WHAT EVERYTHING IS WORTH, in allowance: the resources, the currencies
// (dynamic resources) and the Chef baskets.
export default function WorthTab({ economy, onChange }) {
  const setResource = (id, v) => onChange({ ...economy, resources: { ...economy.resources, [id]: v } })
  const setCurrency = (i, patch) => onChange({ ...economy, currencies: economy.currencies.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  const removeCurrency = (i) => onChange({ ...economy, currencies: economy.currencies.filter((_, j) => j !== i) })
  // A currency is added from a drop list of the game's (economist: "let the use be able to use a drop list, and
  // if needed he can add a new DR"); its last choice opens a field for a new name.
  const choices = currencyChoices(economy)
  const [pick, setPick] = useState('')
  const [newName, setNewName] = useState('')
  const isNew = pick === NEW_CURRENCY
  const name = isNew ? newName : pick
  // The currency whose values by date are open for editing (one at a time).
  const [openDaily, setOpenDaily] = useState(null)
  const nameProblem = !isNew || !newName ? '' : !DR_NAME.test(newName) ? 'A currency name starts with "dr-", in lower case with "-".' : economy.currencies.some((c) => c.name === newName) ? 'Already in the table.' : choices.includes(newName) ? 'Already on the drop list: pick it there.' : ''
  function addCurrency() {
    if (!name || nameProblem) return
    onChange({ ...economy, currencies: [...economy.currencies, createCurrency({ name })] })
    setPick('')
    setNewName('')
  }

  const local = notTaught(economy)

  return (
    <div className="flex flex-col gap-4">
      {local.length > 0 && (
        <Card title="Typed in this browser only" subtitle="Not taught to the app yet: your coworker does not see these, and the published site does not have them.">
          <div className="flex flex-col gap-2" data-testid="economy-not-taught">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
              {local.map((it) => (
                <li key={`${it.kind}-${it.list ?? ''}-${it.name}`} className={MONO} data-not-taught={it.name}>
                  {it.kind === 'currency' ? it.name : `${it.atom}:${it.name}`}
                  <span className="font-sans text-slate-500">
                    {it.value != null ? ` - worth ${it.value}` : ''}
                    {it.daily ? ' - values by date' : ''}
                    {it.added ? ' (added here)' : ''}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton text={notTaughtMessage(local)} label="Copy as a message" data-testid="economy-not-taught-copy" />
              <span className="text-xs text-slate-500">Paste it in the chat with Claude to teach it to the app.</span>
            </div>
          </div>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-start">
        <Card title="The value table" subtitle="The allowance worth of one of each. Every prize is counted in allowance.">
          <table className="w-full border-collapse" data-dense data-testid="economy-resources">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={TH}>Resource</th>
                <th className={TH}>Written</th>
                <th className={`${TH} text-center`}>Worth of one</th>
              </tr>
            </thead>
            <tbody>
              {RESOURCES.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 text-sm" data-resource={r.id}>
                  <td className={`${TD} font-medium text-slate-700`}>{r.label}</td>
                  <td className={`${TD} ${MONO} text-slate-500`}>
                    {r.id === 'coins' ? 'allowance(coins:X)' : `${r.token}:N`}
                    {r.note && <span className="ml-1 font-sans text-xs text-slate-400">- {r.note}</span>}
                  </td>
                  <td className={`${TD} text-center`}>
                    {taughtResource(r.id) ? (
                      <TaughtValue value={economy.resources[r.id]} taught={taughtResource(r.id)} label={`Worth of one ${r.label}`} />
                    ) : (
                      <Num aria-label={`Worth of one ${r.label}`} value={economy.resources[r.id]} allowEmpty onCommit={(v) => setResource(r.id, v)} className="w-20" placeholder="not set" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Chef baskets" subtitle="preset:Chef__<Basic|Rare|Epic>_Phase_<1|2>_<Undo|Allowance|Free_round|Extra_stock|Wild>">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3" data-testid="economy-chef-baskets">
              {CHEF_BASKET_TIERS.map((tier) => (
                <label key={tier} className="flex flex-col items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {tier}
                  {taughtChefBasket(tier) ? (
                    <TaughtValue value={economy.chefBaskets[tier]} taught={taughtChefBasket(tier)} label={`Worth of a ${tier} Chef basket`} />
                  ) : (
                    <Num aria-label={`Worth of a ${tier} Chef basket`} value={economy.chefBaskets[tier]} allowEmpty onCommit={(v) => onChange({ ...economy, chefBaskets: { ...economy.chefBaskets, [tier]: v } })} className="w-20" placeholder="not set" />
                  )}
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-500" data-note>
              The worth of a basket by its tier, the same on every day for now (economist: when the Chef model is better it will change by day).
            </p>
          </div>
        </Card>
      </div>

      <Card title="Always in the game" subtitle="Currencies every event can give. The puzzle and the pet are worth what their dates say - a date with no value reads unknown; merge and picks have one worth for now.">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" data-dense data-testid="economy-core-currencies">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={TH}>Currency</th>
                <th className={TH}>Worth</th>
              </tr>
            </thead>
            <tbody>
              {CORE_CURRENCIES.map((core) => {
                const i = economy.currencies.findIndex((c) => c.name === core.name)
                const c = economy.currencies[i]
                if (!c) return null
                const periods = c.periods ?? []
                const open = openDaily === c.name
                const taught = taughtCurrency(c.name)
                const taughtDates = isTaught(taught, 'periods')
                if (core.step === 'fixed')
                  return (
                    <tr key={core.name} className="border-b border-slate-100 text-sm" data-core-currency={core.name} data-currency={core.name}>
                      <td className={`${TD} whitespace-nowrap`}>
                        <span className="font-medium text-slate-800">{core.label}</span> <span className={`${MONO} text-slate-500`}>{core.name}</span>
                        <div className="text-[11px] text-slate-500">{STEP_TEXT.fixed}</div>
                      </td>
                      <td className={TD}>
                        {isTaught(taught, 'valueGameplay') ? (
                          <TaughtValue value={c.valueGameplay} taught={taught} label={`${c.name}: worth`} />
                        ) : (
                          <Num aria-label={`${c.name}: worth`} value={c.valueGameplay} allowEmpty onCommit={(v) => setCurrency(i, { valueGameplay: v })} className="w-24" placeholder="not set" />
                        )}
                        {periods.length > 0 && (
                          <div className="mt-0.5 text-[11px] text-amber-800" data-cell="unused-dates">
                            Values by date were typed before ({periods.length}): they are not used now - its worth is the one above.
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                const [one, many] = UNIT[core.step]
                return (
                  <Fragment key={core.name}>
                    <tr className={`text-sm ${open ? '' : 'border-b border-slate-100'}`} data-core-currency={core.name} data-currency={core.name}>
                      <td className={`${TD} whitespace-nowrap`}>
                        <span className="font-medium text-slate-800">{core.label}</span> <span className={`${MONO} text-slate-500`}>{core.name}</span>
                        <div className="text-[11px] text-slate-500">{STEP_TEXT[core.step]}</div>
                      </td>
                      <td className={TD}>
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[12px] text-slate-600" data-cell="periods">
                            {periods.length ? `${periods.length} ${periods.length === 1 ? one : many}, ${readable(periods[0].from)} to ${readable(periods[periods.length - 1].to)}` : 'none yet'}
                          </span>
                          {taughtDates ? (
                            <TaughtMark taught={taught} />
                          ) : (
                            <button type="button" className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 hover:text-purple-700" onClick={() => setOpenDaily(open ? null : c.name)} aria-expanded={open} data-testid={`economy-periods-toggle-${c.name}`}>
                              {open ? 'Close' : periods.length ? 'Edit dates' : 'Add dates'}
                            </button>
                          )}
                        </span>
                        {c.valueGameplay != null && c.valueGameplay !== '' && (
                          <div className="mt-0.5 text-[11px] text-amber-800" data-cell="unused-worth">
                            A worth without dates ({c.valueGameplay}) was typed before: it is not used - give it dates.
                          </div>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-slate-100 bg-slate-50/60" data-periods-editor={c.name}>
                        <td colSpan={2} className="px-3 py-2">
                          <PeriodValues name={c.name} step={core.step} periods={periods} onChange={(next) => setCurrency(i, { periods: next })} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Event currencies" subtitle="The other currencies (dynamic resources): the allowance worth of one unit, in game play.">
        <div className="flex flex-col gap-3">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" data-dense data-testid="economy-currencies">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={`${TH} w-8`} />
                  <th className={TH}>Name</th>
                  <th className={`${TH} text-center`} title="The worth of one unit when a prize is balanced (game play).">
                    Worth
                  </th>
                  <th className={TH} title="For a currency that loses value day by day: a value for each date, picked on a calendar (or a whole list pasted). A date between two reads the last one before it; before the first date or after the last, the worth is unknown. When it is set it replaces the one worth.">
                    By date
                  </th>
                </tr>
              </thead>
              <tbody>
                {economy.currencies.map((c, i) => {
                  if (coreCurrency(c.name)) return null
                  const daily = parseDailyValues(c.daily)
                  const open = openDaily === c.name
                  const taught = taughtCurrency(c.name)
                  const taughtWorth = isTaught(taught, 'valueGameplay')
                  const taughtDates = isTaught(taught, 'daily')
                  return (
                    <Fragment key={`${c.name}-${i}`}>
                    <tr className={`text-sm ${open ? '' : 'border-b border-slate-100'}`} data-currency={c.name}>
                      <td className={`${TD} w-8`}>
                        {!taught && (
                          <button type="button" aria-label={`Remove ${c.name}`} title={`Remove ${c.name}`} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => removeCurrency(i)}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                      <td className={`${TD} ${MONO} whitespace-nowrap text-slate-800`}>
                        {c.name}
                        {c.ownName && (
                          <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-amber-800" title="This app made the name up. It is not confirmed as the game's.">
                            unverified
                          </span>
                        )}
                      </td>
                      <td className={`${TD} text-center`}>
                        {taughtWorth ? (
                          <TaughtValue value={c.valueGameplay} taught={taught} label={`${c.name}: game play worth`} />
                        ) : (
                          <Num aria-label={`${c.name}: game play worth`} value={c.valueGameplay} allowEmpty onCommit={(v) => setCurrency(i, { valueGameplay: v })} className="w-24" placeholder="not set" />
                        )}
                      </td>
                      <td className={TD}>
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[12px] text-slate-600" data-cell="daily">
                            {daily.entries.length ? `${daily.entries.length} ${daily.entries.length === 1 ? 'date' : 'dates'}, ${readable(daily.entries[0].date)} to ${readable(daily.entries[daily.entries.length - 1].date)}` : 'none'}
                          </span>
                          {taughtDates ? (
                            <TaughtMark taught={taught} />
                          ) : (
                            <button type="button" className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 hover:text-purple-700" onClick={() => setOpenDaily(open ? null : c.name)} aria-expanded={open} data-testid={`economy-daily-toggle-${c.name}`}>
                              {open ? 'Close' : daily.entries.length ? 'Edit dates' : 'Add dates'}
                            </button>
                          )}
                        </span>
                        {daily.bad.length > 0 && <div className="mt-0.5 text-[11px] text-rose-700">Not read, and not used: {daily.bad.slice(0, 2).join(', ')}</div>}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-slate-100 bg-slate-50/60" data-daily-editor={c.name}>
                        <td colSpan={4} className="px-3 py-2">
                          <DailyValues name={c.name} value={c.daily} onChange={(daily) => setCurrency(i, { daily })} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Currency to add" data-testid="economy-pick-currency" className={`${INPUT} w-72 font-mono`}>
              <option value="">{choices.length ? `Add a currency (${choices.length} on the list)` : 'Add a currency'}</option>
              {choices.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              <option value={NEW_CURRENCY}>A new currency...</option>
            </select>
            {isNew && (
              <input value={newName} onChange={(e) => setNewName(e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && addCurrency()} placeholder="dr-..." aria-label="New currency name" data-testid="economy-new-currency" className={`${INPUT} w-60 font-mono`} autoFocus />
            )}
            <button type="button" className={BUTTON} onClick={addCurrency} disabled={!name || !!nameProblem} data-testid="economy-add-currency">
              Add
            </button>
            {nameProblem && <span className="text-sm text-rose-700">{nameProblem}</span>}
          </div>
          <p className="text-xs text-slate-500" data-note>
            The drop list holds the game&apos;s currencies that are not in the table yet. A new one goes into the table and every currency list on this page, in this browser until it is taught.
          </p>
        </div>
      </Card>
    </div>
  )
}
