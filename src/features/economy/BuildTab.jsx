import { useState } from 'react'
import { Trash2, X } from 'lucide-react'
import Card from '../../components/ui/Card'
import { chefBasketKeys, currencyValue, findCurrency } from '../../lib/economy/economyModel'
import { checkReward, rewardWorth } from '../../lib/economy/parse'
import { tierSyntax } from '../../lib/economy/syntax'
import { worthText } from '../../lib/economy/examples'
import { BUTTON, CopyButton, Findings, INPUT, MONO, Num, TD, TH, WorthBreakdown } from './economyUi'

const FALLBACKS = [
  { id: 'coins', label: 'its worth in coins' },
  { id: 'hidden', label: 'the hidden fallback' },
  { id: 'Wild', label: 'wilds' },
  { id: 'Extra Stock', label: 'extra stock' },
  { id: 'Undo', label: 'undos' },
  { id: 'Free Round', label: 'free rounds' },
  { id: 'none', label: 'nothing' },
]

const newCurrencyRow = () => ({ name: '', amount: null, alt: 'coins', altCap: null, altDrName: '', altDrAmount: null })

// BUILD A PRIZE: a tier's reward from its parts, written in the standard
// order (triggers, coins, resources, presets, pack, counters, currencies, in a
// chest), checked and valued as it is built. Only keys on the lists.
export default function BuildTab({ economy }) {
  const [triggers, setTriggers] = useState([])
  const [reward, setReward] = useState({ coins: null, allowanceBucket: '', wild: null, stock: null, undo: null, freeRound: null })
  const [presets, setPresets] = useState([])
  const [basket, setBasket] = useState('')
  const [pack, setPack] = useState({ packKey: '', allowance: null, alt: 'coins' })
  const [currencies, setCurrencies] = useState([])
  const [chest, setChest] = useState('')
  const [date, setDate] = useState('')

  const valueOf = (name) => currencyValue(findCurrency(economy, name), { date: date || null })?.value ?? null
  // (A pack itself is worth 0; this is the worth of what is given in its place, typed here.)
  const packAllowance = pack.allowance
  const text = tierSyntax(
    {
      triggers,
      reward,
      presets: [...presets, basket],
      pack: pack.packKey ? { packKey: pack.packKey, allowance: pack.alt === 'none' ? null : packAllowance, alt: pack.alt === 'coins' || pack.alt === 'none' ? null : pack.alt } : null,
      currencies: currencies.map((c) => ({
        name: c.name,
        amount: c.amount,
        value: valueOf(c.name),
        alt: c.alt === 'coins' ? null : c.alt,
        altCap: c.altCap,
        noRegularAlt: c.alt === 'none',
        altDrName: c.altDrName,
        altDrAmount: c.altDrAmount ?? 0,
        altDrValue: c.altDrName ? (valueOf(c.altDrName) ?? 0) : 0,
        altDrRounding: c.altDrName === 'dr-puzzle' ? 'puzzle' : 'standard',
      })),
      chest,
    },
    economy,
  )
  const check = checkReward(text, { economy })
  const worth = check.node ? rewardWorth(check.node, economy, { date: date || null }) : null
  const setR = (key, v) => setReward((r) => ({ ...r, [key]: v }))
  const setC = (i, patch) => setCurrencies((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start">
      <div className="flex flex-col gap-4">
        <Card title="Coins and resources">
          <div className="flex flex-wrap items-end gap-3" data-testid="economy-build-reward">
            <Field label="Coins (allowance)">
              <Num aria-label="Coins" value={reward.coins} allowEmpty onCommit={(v) => setR('coins', v)} className="w-24" />
            </Field>
            <Field label="Bucket">
              <select value={reward.allowanceBucket} onChange={(e) => setR('allowanceBucket', e.target.value)} className={INPUT} aria-label="Allowance bucket">
                <option value="">none</option>
                {economy.keys.buckets.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.key}
                  </option>
                ))}
              </select>
            </Field>
            {[
              ['wild', 'Wilds'],
              ['stock', 'Extra stock'],
              ['undo', 'Undos'],
              ['freeRound', 'Free rounds'],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <Num aria-label={label} value={reward[key]} allowEmpty integer onCommit={(v) => setR(key, v)} className="w-16" />
              </Field>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500" data-note>
            Coins are written with 2 decimals. Resources are whole numbers; anything else is left out.
          </p>
        </Card>

        <Card title="Triggers, presets, a pack, a chest">
          <div className="flex flex-col gap-3">
            <PickMany label="Triggers" items={economy.keys.triggers.map((k) => k.key)} picked={triggers} onPicked={setTriggers} testid="economy-build-triggers" />
            <PickMany label="Presets" items={economy.keys.presets.map((k) => k.key)} picked={presets} onPicked={setPresets} testid="economy-build-presets" />
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Chef basket">
                <select value={basket} onChange={(e) => setBasket(e.target.value)} className={`${INPUT} max-w-[22rem]`} aria-label="Chef basket" data-testid="economy-build-basket">
                  <option value="">none</option>
                  {chefBasketKeys(economy).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Sticker pack">
                <select value={pack.packKey} onChange={(e) => setPack((p) => ({ ...p, packKey: e.target.value, allowance: null }))} className={`${INPUT} max-w-[22rem]`} aria-label="Sticker pack" data-testid="economy-build-pack">
                  <option value="">none</option>
                  {economy.keys.packs.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.key}
                    </option>
                  ))}
                </select>
              </Field>
              {pack.packKey && (
                <>
                  <Field label="If it cannot be given">
                    <select value={pack.alt} onChange={(e) => setPack((p) => ({ ...p, alt: e.target.value }))} className={INPUT} aria-label="Pack fallback">
                      {FALLBACKS.filter((f) => f.id !== 'hidden').map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {pack.alt !== 'none' && (
                    <Field label="Worth of that">
                      <Num aria-label="Pack fallback worth" value={packAllowance} allowEmpty onCommit={(v) => setPack((p) => ({ ...p, allowance: v }))} className="w-20" placeholder="not set" />
                    </Field>
                  )}
                </>
              )}
              {/* The chest's name is typed (economist: "let me put the name"); the known ones are offered. The whole
                  reward goes inside it: chest:<name>(<reward>). */}
              <Field label="Chest (wraps it all)">
                <input value={chest} onChange={(e) => setChest(e.target.value.trim())} list="economy-chest-names" placeholder="none" aria-label="Chest" data-testid="economy-build-chest" className={`${INPUT} w-44 font-mono`} />
                <datalist id="economy-chest-names">
                  {economy.keys.chests.map((k) => (
                    <option key={k.key} value={k.key} />
                  ))}
                </datalist>
              </Field>
            </div>
          </div>
        </Card>

        <Card title="Currencies" subtitle="A currency, and what is given when the feature is not running">
          <div className="flex flex-col gap-3">
            {currencies.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse" data-dense data-testid="economy-build-currencies">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className={TH}>Currency</th>
                      <th className={`${TH} text-center`}>Amount</th>
                      <th className={`${TH} text-right`}>Worth</th>
                      <th className={TH} title="Given when the currency (and the second one, if any) cannot be: coins, or a core resource worth the same.">
                        Last fallback
                      </th>
                      <th className={TH} title="A second currency to try before the last fallback, written inside it: [a|[b|last]]. Its amount is worked out from the worth when left empty (puzzle pieces to the 5, at least 5; others to the 5 above 8 units).">
                        Second currency
                      </th>
                      <th className={TH} />
                    </tr>
                  </thead>
                  <tbody>
                    {currencies.map((c, i) => {
                      const v = valueOf(c.name)
                      return (
                        <tr key={i} className="border-b border-slate-100 text-sm">
                          <td className={TD}>
                            <CurrencySelect economy={economy} value={c.name} onChange={(name) => setC(i, { name })} label={`Currency ${i + 1}`} />
                          </td>
                          <td className={`${TD} text-center`}>
                            <Num aria-label={`Currency ${i + 1} amount`} value={c.amount} allowEmpty min={1} onCommit={(amount) => setC(i, { amount })} className="w-20" />
                          </td>
                          <td className={`${TD} whitespace-nowrap text-right tabular-nums ${v == null ? 'text-amber-700' : 'text-slate-600'}`}>{v == null ? 'not set' : worthText(v * (Number(c.amount) || 0))}</td>
                          <td className={TD}>
                            <select value={c.alt} onChange={(e) => setC(i, { alt: e.target.value })} className={INPUT} aria-label={`Currency ${i + 1} fallback`}>
                              {FALLBACKS.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className={TD}>
                            <div className="flex items-center gap-1">
                              <CurrencySelect economy={economy} value={c.altDrName} onChange={(altDrName) => setC(i, { altDrName })} label={`Currency ${i + 1} second currency`} empty="none" />
                              {c.altDrName && <Num aria-label={`Currency ${i + 1} second amount`} value={c.altDrAmount} allowEmpty min={1} onCommit={(altDrAmount) => setC(i, { altDrAmount })} className="w-16" placeholder="auto" />}
                            </div>
                          </td>
                          <td className={TD}>
                            <button type="button" aria-label={`Remove currency ${i + 1}`} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => setCurrencies((list) => list.filter((_, j) => j !== i))}>
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={BUTTON} onClick={() => setCurrencies((list) => [...list, newCurrencyRow()])} data-testid="economy-build-add-currency">
                Add a currency
              </button>
              <label className="flex items-center gap-2 text-sm text-slate-600" title="A currency whose worth changes by day reads that date's value.">
                Date
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
              </label>
            </div>
          </div>
        </Card>
      </div>

      <Card title="The prize" subtitle="Written in the standard order, checked as it is built">
        <div className="flex flex-col gap-3" data-testid="economy-build-output">
          {text ? <p className={`${MONO} rounded-xl bg-slate-50 p-3 text-slate-800`} data-testid="economy-build-text">{text}</p> : <p className="text-sm text-slate-500">Nothing yet: add coins, a resource, a preset, a pack or a currency.</p>}
          {text && (
            <div className="flex flex-wrap gap-2">
              <CopyButton text={text} />
            </div>
          )}
          {text && <Findings issues={check.issues} />}
          {text && check.ok && <WorthBreakdown result={worth} />}
        </div>
      </Card>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
      {label}
      {children}
    </label>
  )
}

function CurrencySelect({ economy, value, onChange, label, empty = 'pick one' }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${INPUT} font-mono`} aria-label={label}>
      <option value="">{empty}</option>
      {economy.currencies.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
        </option>
      ))}
    </select>
  )
}

function PickMany({ label, items, picked, onPicked, testid }) {
  const left = items.filter((k) => !picked.includes(k))
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={testid}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {picked.map((k) => (
        <span key={k} className="flex items-center gap-1 rounded-full border border-purple-100 bg-purple-50 px-2 py-0.5 font-mono text-xs text-purple-800">
          {k}
          <button type="button" aria-label={`Remove ${k}`} onClick={() => onPicked(picked.filter((x) => x !== k))} className="text-purple-400 hover:text-purple-700">
            <X size={12} />
          </button>
        </span>
      ))}
      {left.length > 0 ? (
        <select value="" onChange={(e) => e.target.value && onPicked([...picked, e.target.value])} className={`${INPUT} max-w-[20rem]`} aria-label={`Add to ${label}`}>
          <option value="">add...</option>
          {left.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      ) : (
        !items.length && <span className="text-xs text-slate-400">none on the Keys tab</span>
      )}
    </div>
  )
}
