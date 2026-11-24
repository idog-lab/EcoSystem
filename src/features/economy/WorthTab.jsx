import { Fragment, useState } from 'react'
import { Trash2 } from 'lucide-react'
import Card from '../../components/ui/Card'
import { CHEF_BASKET_TIERS, RESOURCES, createCurrency, parseDailyValues } from '../../lib/economy/economyModel'
import { BUTTON, INPUT, MONO, Num, TD, TH, Text } from './economyUi'
import DailyValues from './DailyValues'

const DR_NAME = /^dr-[a-z0-9]+(?:-[a-z0-9]+)*$/
// 2026-11-30 -> "30 Nov 2026"
const readable = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

// WHAT EVERYTHING IS WORTH, in allowance: the resources, the currencies
// (dynamic resources) and the Chef baskets.
export default function WorthTab({ economy, onChange }) {
  const setResource = (id, v) => onChange({ ...economy, resources: { ...economy.resources, [id]: v } })
  const setCurrency = (i, patch) => onChange({ ...economy, currencies: economy.currencies.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  const removeCurrency = (i) => onChange({ ...economy, currencies: economy.currencies.filter((_, j) => j !== i) })
  const [newName, setNewName] = useState('')
  // The currency whose values by date are open for editing (one at a time).
  const [openDaily, setOpenDaily] = useState(null)
  const nameProblem = !newName ? '' : !DR_NAME.test(newName) ? 'A currency name starts with "dr-", in lower case with "-".' : economy.currencies.some((c) => c.name === newName) ? 'Already on the list.' : ''
  function addCurrency() {
    if (!newName || nameProblem) return
    onChange({ ...economy, currencies: [...economy.currencies, createCurrency({ name: newName })] })
    setNewName('')
  }

  return (
    <div className="flex flex-col gap-4">
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
                    <Num aria-label={`Worth of one ${r.label}`} value={economy.resources[r.id]} allowEmpty onCommit={(v) => setResource(r.id, v)} className="w-20" placeholder="not set" />
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
                  <Num aria-label={`Worth of a ${tier} Chef basket`} value={economy.chefBaskets[tier]} allowEmpty onCommit={(v) => onChange({ ...economy, chefBaskets: { ...economy.chefBaskets, [tier]: v } })} className="w-20" placeholder="not set" />
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-500" data-note>
              The worth of a basket by its tier, the same on every day for now (economist: when the Chef model is better it will change by day).
            </p>
          </div>
        </Card>
      </div>

      <Card title="Currencies (dynamic resources)" subtitle="The allowance worth of one unit, in game play.">
        <div className="flex flex-col gap-3">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" data-dense data-testid="economy-currencies">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={TH}>Name</th>
                  <th className={`${TH} text-center`} title="The worth of one unit when a prize is balanced (game play).">
                    Worth
                  </th>
                  <th className={TH} title="For a currency that loses value day by day: a value for each date, picked on a calendar (or a whole list pasted). A date reads its own value, clamped to the first and last date given. When it is set it replaces the one worth.">
                    By date
                  </th>
                  <th className={TH}>Note</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {economy.currencies.map((c, i) => {
                  const daily = parseDailyValues(c.daily)
                  const open = openDaily === c.name
                  return (
                    <Fragment key={`${c.name}-${i}`}>
                    <tr className={`text-sm ${open ? '' : 'border-b border-slate-100'}`} data-currency={c.name}>
                      <td className={`${TD} ${MONO} whitespace-nowrap text-slate-800`}>
                        {c.name}
                        {c.ownName && (
                          <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-amber-800" title="This app made the name up. It is not confirmed as the game's.">
                            unverified
                          </span>
                        )}
                      </td>
                      <td className={`${TD} text-center`}>
                        <Num aria-label={`${c.name}: game play worth`} value={c.valueGameplay} allowEmpty onCommit={(v) => setCurrency(i, { valueGameplay: v })} className="w-24" placeholder="not set" />
                      </td>
                      <td className={TD}>
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[12px] text-slate-600" data-cell="daily">
                            {daily.entries.length ? `${daily.entries.length} ${daily.entries.length === 1 ? 'date' : 'dates'}, ${readable(daily.entries[0].date)} to ${readable(daily.entries[daily.entries.length - 1].date)}` : 'none'}
                          </span>
                          <button type="button" className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 hover:text-purple-700" onClick={() => setOpenDaily(open ? null : c.name)} aria-expanded={open} data-testid={`economy-daily-toggle-${c.name}`}>
                            {open ? 'Close' : daily.entries.length ? 'Edit dates' : 'Add dates'}
                          </button>
                        </span>
                        {daily.bad.length > 0 && <div className="mt-0.5 text-[11px] text-rose-700">Not read, and not used: {daily.bad.slice(0, 2).join(', ')}</div>}
                      </td>
                      <td className={TD}>
                        <Text aria-label={`${c.name}: note`} value={c.note} onCommit={(v) => setCurrency(i, { note: v })} className="w-56" />
                      </td>
                      <td className={TD}>
                        <button type="button" aria-label={`Remove ${c.name}`} title="Remove" className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => removeCurrency(i)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-slate-100 bg-slate-50/60" data-daily-editor={c.name}>
                        <td colSpan={5} className="px-3 py-2">
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
            <input value={newName} onChange={(e) => setNewName(e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && addCurrency()} placeholder="dr-..." aria-label="New currency name" data-testid="economy-new-currency" className={`${INPUT} w-60 font-mono`} />
            <button type="button" className={BUTTON} onClick={addCurrency} disabled={!newName || !!nameProblem} data-testid="economy-add-currency">
              Add a currency
            </button>
            {nameProblem && <span className="text-sm text-rose-700">{nameProblem}</span>}
          </div>
          <p className="text-xs text-slate-500" data-note>
            Only the names given so far are listed; add the rest as they come.
          </p>
        </div>
      </Card>
    </div>
  )
}
