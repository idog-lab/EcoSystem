import { useEffect, useId, useState } from 'react'
import { X } from 'lucide-react'
import { currencyChoices } from '../lib/economy/economyModel'
import { PRIZE_RESOURCES, readPrize, writePrize } from '../lib/economy/prizeParts'

// THE PRIZE BUILDER (economist, 26 Nov 2026: "we need to have a better way to create the prizes. its too hard to just
// write syntax"): a prize made by picking its parts - coins, Wild, Extra stock, Undo, Free round, presets, a sticker
// pack, currencies, a chest - from the Economy page's own lists; the text is written by the app (lib/economy/
// prizeParts.js) and shown, and can still be typed by hand. Shared by every feature that has prizes.
const INPUT = 'rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-200'
const LABEL = 'flex flex-col gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500'
const CHIP = 'inline-flex items-center gap-1 rounded-md bg-purple-50 px-1.5 py-0.5 font-mono text-[11.5px] text-purple-800 ring-1 ring-purple-100'

function Amount({ value, onCommit, className = 'w-16', ...props }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => setText(value == null ? '' : String(value)), [value])
  const commit = () => {
    const t = text.trim().replace(',', '.')
    if (t === '') return onCommit(null)
    const n = Number(t)
    if (Number.isFinite(n) && n >= 0) onCommit(n)
    else setText(value == null ? '' : String(value))
  }
  return <input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} placeholder="-" className={`${INPUT} ${className} tabular-nums`} {...props} />
}

// A key picked from a long list: type to search (the browser's own list), Enter or "Add" to take it. Only a key on
// the list is taken - keys are never made up.
function KeyPicker({ keys, onPick, placeholder, testid }) {
  const id = useId()
  const [text, setText] = useState('')
  const [note, setNote] = useState(null)
  const take = () => {
    const t = text.trim()
    if (!t) return
    const hit = keys.find((k) => k === t) ?? keys.find((k) => k.toLowerCase() === t.toLowerCase())
    if (!hit) return setNote(`"${t}" is not on the Economy page's list.`)
    onPick(hit)
    setText('')
    setNote(null)
  }
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1">
        <input list={id} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && take()} placeholder={placeholder} className={`${INPUT} w-64 font-mono text-[12px]`} data-builder-input={testid} />
        <datalist id={id}>
          {keys.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
        <button type="button" onClick={take} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:text-purple-700" data-builder-add={testid}>
          Add
        </button>
      </span>
      {note && <span className="text-[11px] text-rose-700">{note}</span>}
    </span>
  )
}

function Chip({ text, onRemove, testid }) {
  return (
    <span className={CHIP} data-builder-chip={testid}>
      {text}
      <button type="button" onClick={onRemove} aria-label={`Remove ${text}`} className="text-purple-400 hover:text-rose-600">
        <X size={12} />
      </button>
    </span>
  )
}

export default function PrizeBuilder({ value, onChange, economy, testid = 'prize' }) {
  const { parts, readable } = readPrize(value)
  const [byHand, setByHand] = useState(!readable)
  const [handText, setHandText] = useState(value ?? '')
  const [currency, setCurrency] = useState('')
  const [currencyAmount, setCurrencyAmount] = useState(null)
  useEffect(() => setHandText(value ?? ''), [value])
  const set = (patch) => onChange(writePrize({ ...parts, ...patch }))
  const keysOf = (list) => (economy?.keys?.[list] ?? []).map((k) => k.key).filter(Boolean)
  const presets = keysOf('presets')
  const packs = keysOf('packs')
  const chests = keysOf('chests')
  const buckets = keysOf('buckets')
  const currencies = [...new Set([...(economy?.currencies ?? []).map((c) => c.name), ...currencyChoices(economy ?? {})])].filter((n) => n && n !== 'dr-hidden' && n !== 'dr-pack-counter')

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-purple-100 bg-purple-50/30 p-2.5" data-prize-builder={testid}>
      <div className="flex flex-wrap items-end gap-2">
        <label className={LABEL}>
          Coins
          <span className="inline-flex items-center gap-1 normal-case tracking-normal">
            <Amount value={parts.coins} onCommit={(v) => set({ coins: v })} className="w-20" aria-label="Coins, in allowance" data-builder-field="coins" />
            <span className="text-[11px] font-normal text-slate-500">allowance</span>
          </span>
        </label>
        <label className={LABEL}>
          Bucket
          <select value={parts.bucket} onChange={(e) => set({ bucket: e.target.value })} className={`${INPUT} w-32`} data-builder-field="bucket">
            <option value="">none</option>
            {[...new Set([...buckets, parts.bucket].filter(Boolean))].map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        {PRIZE_RESOURCES.map((r) => (
          <label key={r.id} className={LABEL}>
            {r.label}
            <Amount value={parts[r.id]} onCommit={(v) => set({ [r.id]: v == null ? null : Math.round(v) })} aria-label={r.label} data-builder-field={r.id} />
          </label>
        ))}
        <label className={LABEL}>
          In a chest
          <select value={parts.chest} onChange={(e) => set({ chest: e.target.value })} className={`${INPUT} w-28`} data-builder-field="chest">
            <option value="">no chest</option>
            {[...new Set([...chests, parts.chest].filter(Boolean))].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-24 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Presets</span>
        <KeyPicker keys={presets} onPick={(k) => set({ presets: [...parts.presets, k] })} placeholder="Type to search: puzzle_gameplay_20" testid={`${testid}-preset`} />
        {parts.presets.map((k, i) => (
          <Chip key={`${k}-${i}`} text={k} onRemove={() => set({ presets: parts.presets.filter((_, j) => j !== i) })} testid="preset" />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-24 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Sticker pack</span>
        {parts.pack ? (
          <>
            <Chip text={parts.pack} onRemove={() => set({ pack: '', packCoins: null })} testid="pack" />
            <label className="inline-flex items-center gap-1 text-xs text-slate-600" title="[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]] after the pack">
              <input type="checkbox" checked={parts.packCounter} onChange={(e) => set({ packCounter: e.target.checked })} className="accent-purple-600" data-builder-field="pack-counter" />
              pack counter
            </label>
            <span className="inline-flex items-center gap-1 text-xs text-slate-600" title="Given instead of the pack when the player cannot get it: [sticker_pack:...|allowance(coins:X)]">
              or coins
              <Amount value={parts.packCoins} onCommit={(v) => set({ packCoins: v })} className="w-16" aria-label="Coins instead of the pack" data-builder-field="pack-coins" />
            </span>
          </>
        ) : (
          <KeyPicker keys={packs} onPick={(k) => set({ pack: k, packCounter: true })} placeholder="Type to search: Golden_T1_..." testid={`${testid}-pack`} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-24 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Currencies</span>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={`${INPUT} w-56 font-mono text-[12px]`} aria-label="A currency" data-builder-field="currency">
          <option value="">pick a currency</option>
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Amount value={currencyAmount} onCommit={setCurrencyAmount} aria-label="Its amount" data-builder-field="currency-amount" />
        <button
          type="button"
          disabled={!currency || !(currencyAmount >= 1)}
          onClick={() => {
            set({ currencies: [...parts.currencies, { name: currency, amount: Math.round(currencyAmount) }] })
            setCurrency('')
            setCurrencyAmount(null)
          }}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:text-purple-700 disabled:opacity-40"
          data-builder-add={`${testid}-currency`}
        >
          Add
        </button>
        {parts.currencies.map((c, i) => (
          <Chip key={`${c.name}-${i}`} text={`${c.name} x${c.amount}`} onRemove={() => set({ currencies: parts.currencies.filter((_, j) => j !== i) })} testid="currency" />
        ))}
      </div>

      {parts.extra.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-24 text-[10px] font-semibold uppercase tracking-wide text-slate-500" title="Parts the builder has no field for, kept as they were written">
            Kept as written
          </span>
          {parts.extra.map((t, i) => (
            <Chip key={`${t}-${i}`} text={t} onRemove={() => set({ extra: parts.extra.filter((_, j) => j !== i) })} testid="extra" />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1 border-t border-purple-100 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">The text</span>
          <button type="button" onClick={() => setByHand((v) => !v)} className="text-xs font-semibold text-purple-700 hover:underline" data-builder-by-hand={testid}>
            {byHand ? 'Back to the parts' : 'Write the text myself'}
          </button>
        </div>
        {byHand ? (
          <input value={handText} onChange={(e) => setHandText(e.target.value)} onBlur={() => handText !== (value ?? '') && onChange(handText.trim())} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className={`${INPUT} w-full font-mono text-[12px]`} aria-label="The prize's text" data-builder-text-input={testid} />
        ) : (
          <code className="break-all rounded-lg bg-white px-2 py-1 font-mono text-[12px] text-slate-700 ring-1 ring-slate-200" data-builder-text={testid}>
            {value || <span className="text-slate-400">nothing picked yet</span>}
          </code>
        )}
      </div>
    </div>
  )
}
