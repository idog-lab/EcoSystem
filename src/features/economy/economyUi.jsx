import { useEffect, useState } from 'react'
import { worthText } from '../../lib/economy/examples'

// Small pieces the Economy page's tabs share.

export const TH = 'px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap'
export const TD = 'px-2 py-1 align-middle'
export const INPUT = 'rounded-lg border border-slate-200 bg-white/80 px-2 py-1 text-sm text-slate-800 focus:border-purple-400 focus:outline-none focus:ring-4 focus:ring-purple-200/60'
export const MONO = 'font-mono text-[12.5px] break-all'
export const BUTTON = 'rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-purple-300 hover:text-purple-700'
export const PRIMARY = 'rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:brightness-105'

// A number taken when the field is left (or on Enter). Empty means "not set"
// when `allowEmpty`, and is never read as 0. What it will not take - not a
// number, below `min`, above `max`, not whole when `integer` - is refused and
// said under the field (economist: "there should be data validation on the
// types entered"); the value before stays.
export function Num({ value, onCommit, allowEmpty = false, min = 0, max = Infinity, integer = false, className = '', ...props }) {
  const shown = value == null ? '' : String(value)
  const [text, setText] = useState(shown)
  const [rejected, setRejected] = useState(null)
  useEffect(() => setText(shown), [shown])
  function refuse(why) {
    setRejected(why)
    setText(shown)
  }
  function commit() {
    if (text.trim() === '') {
      if (allowEmpty) {
        setRejected(null)
        if (value != null) onCommit(null)
      } else refuse('A number is needed here.')
      return
    }
    const n = Number(text.replace(',', '.'))
    if (!Number.isFinite(n)) return refuse(`"${text}" is not a number.`)
    if (n < min) return refuse(`At least ${min}.`)
    if (n > max) return refuse(`At most ${max}.`)
    if (integer && !Number.isInteger(n)) return refuse('A whole number.')
    setRejected(null)
    if (n !== value) onCommit(n)
  }
  return (
    <span className="inline-flex flex-col items-center">
      <input
        {...props}
        type="number"
        step="any"
        min={Number.isFinite(min) ? min : undefined}
        max={Number.isFinite(max) ? max : undefined}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        data-field-rejected={rejected ? 'yes' : undefined}
        title={rejected ?? props.title}
        className={`rounded-lg border bg-white/80 px-1.5 py-1 text-center text-sm font-medium tabular-nums text-slate-800 [appearance:textfield] focus:border-purple-400 focus:outline-none focus:ring-4 focus:ring-purple-200/60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${rejected ? 'border-rose-300' : 'border-slate-200'} ${className}`}
      />
      {rejected && (
        <span className="mt-0.5 max-w-[10rem] text-center text-[10px] font-medium leading-tight text-rose-700" data-field-rejected-why>
          {rejected}
        </span>
      )}
    </span>
  )
}


// A text taken when the field is left (or on Enter).
export function Text({ value, onCommit, className = '', ...props }) {
  const [text, setText] = useState(value ?? '')
  useEffect(() => setText(value ?? ''), [value])
  return (
    <input
      type="text"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== (value ?? '') && onCommit(text.trim())}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className={`${INPUT} ${className}`}
      {...props}
    />
  )
}


export function CopyButton({ text, label = 'Copy', ...props }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className={BUTTON}
      disabled={!text}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          setDone(false)
        }
      }}
      {...props}
    >
      {done ? 'Copied' : label}
    </button>
  )
}

// The findings of the reward checker, errors first.
export function Findings({ issues }) {
  if (!issues?.length) return null
  const sorted = [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
  return (
    <ul className="flex flex-col gap-1" data-testid="economy-findings">
      {sorted.map((i, n) => (
        <li key={n} data-level={i.level} data-code={i.code} className={`rounded-lg px-2.5 py-1 text-sm ${i.level === 'error' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'}`}>
          <span className="font-semibold">{i.level === 'error' ? 'Needs a fix' : 'Worth a look'}:</span> {i.message}
        </li>
      ))}
    </ul>
  )
}

// The worth of a reward, part by part.
export function WorthBreakdown({ result }) {
  if (!result) return null
  return (
    <div className="flex flex-col gap-2" data-testid="economy-worth">
      <p className="text-sm text-slate-700">
        Worth:{' '}
        {result.worth != null ? (
          <span className="text-base font-bold text-slate-900" data-testid="economy-worth-total">
            {worthText(result.worth)}
          </span>
        ) : (
          <span className="font-semibold text-amber-800" data-testid="economy-worth-total">
            unknown - {result.unknown.length} part{result.unknown.length === 1 ? ' has' : 's have'} no worth on this page ({worthText(result.known)} is what is known)
          </span>
        )}{' '}
        <span className="text-slate-500">allowance</span>
      </p>
      {result.lines.length > 0 && (
        <table className="w-full border-collapse" data-dense>
          <tbody>
            {result.lines.map((l, i) => (
              <tr key={i} className="border-b border-slate-100 text-sm">
                <td className={`${TD} ${MONO} ${l.alternative ? 'text-slate-400' : 'text-slate-700'}`}>{l.text}</td>
                <td className={`${TD} whitespace-nowrap text-right tabular-nums ${l.worth == null && !l.alternative ? 'text-amber-700' : 'text-slate-700'}`}>{l.alternative ? '' : worthText(l.worth)}</td>
                <td className={`${TD} text-xs text-slate-500`}>{l.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
