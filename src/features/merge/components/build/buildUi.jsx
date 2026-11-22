import { useEffect, useState } from 'react'
import { Check, Share2, Users } from 'lucide-react'

// Small shared pieces of the Build Event workflow.

// A number field that commits on blur / Enter rather than on every
// keystroke - several workflow inputs drive real rebuild-invalidating state
// (a budget, a board count), where committing "1" on the way to typing "15"
// would do damage. An empty field commits `null` when allowEmpty, and is
// otherwise restored to the last value: empty is never read as zero.
// `whole` rounds a typed fraction to the nearest whole number instead of
// rejecting it (amounts that are whole numbers by rule, such as puzzles).
export function CommitNumber({ value, onCommit, min = 0, max = Infinity, integer = false, whole = false, allowEmpty = false, className = '', ...props }) {
  const shown = value == null || (allowEmpty && value === 0) ? '' : String(value)
  const [text, setText] = useState(shown)
  useEffect(() => setText(shown), [shown])
  // WHY A VALUE WAS NOT TAKEN, said next to the field. A value outside what
  // the field allows used to be put back without a word: type 3,000 DR of
  // demand, press Tab, and the old number is simply there again.
  const [rejected, setRejected] = useState(null)
  useEffect(() => {
    if (!rejected) return undefined
    const timer = setTimeout(() => setRejected(null), 6000)
    return () => clearTimeout(timer)
  }, [rejected])
  const limit = (n) => (Number.isFinite(n) ? n.toLocaleString() : null)

  function commit() {
    if (text.trim() === '') {
      if (allowEmpty) onCommit(null)
      else {
        setText(shown)
        if (shown !== '') setRejected('This field cannot be empty - the value was put back.')
      }
      return
    }
    const typed = Number(text)
    const n = whole && Number.isFinite(typed) ? Math.round(typed) : typed
    if (!Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min || n > max) {
      setText(shown)
      setRejected(
        !Number.isFinite(n)
          ? 'Not a number - the value was put back.'
          : integer && !Number.isInteger(n)
            ? `${text.trim()} was not taken: whole numbers only.`
            : `${Number(text).toLocaleString()} was not taken: ${limit(max) == null ? `the smallest value here is ${limit(min)}` : `this field takes ${limit(min)} to ${limit(max)}`}.`,
      )
      return
    }
    setRejected(null)
    if (n !== typed) setText(String(n))
    if (n !== value) onCommit(n)
  }

  return (
    <>
      <input
        type="number"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (rejected) setRejected(null)
        }}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        aria-invalid={rejected ? 'true' : undefined}
        className={`border rounded-xl px-2.5 py-1.5 text-sm font-medium text-slate-800 bg-white/80 tabular-nums focus:outline-none focus:ring-4 focus:ring-purple-200/60 focus:border-purple-400 disabled:bg-slate-50 disabled:text-slate-400 ${rejected ? 'border-amber-400' : 'border-slate-200'} ${className}`}
        {...props}
      />
      {rejected && (
        <span role="alert" className="block max-w-[16rem] text-[11px] font-medium leading-snug text-amber-700" data-field-rejected>
          {rejected}
        </span>
      )}
    </>
  )
}

const CHIP = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  applied: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  estimated: 'bg-sky-100 text-sky-800 border-sky-200',
  validated: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  stale: 'bg-amber-100 text-amber-800 border-amber-200',
  infeasible: 'bg-red-100 text-red-700 border-red-200',
  review: 'bg-amber-100 text-amber-800 border-amber-200',
  none: 'bg-slate-50 text-slate-400 border-slate-200',
}

const CHIP_LABEL = {
  draft: 'Not in use',
  applied: 'In use',
  estimated: 'Not tested on players yet',
  validated: 'Tested on players',
  stale: 'Out of date',
  infeasible: 'Needs a fix',
  review: 'Check',
  none: 'Nothing built yet',
}

export function StatusChip({ kind, children }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${CHIP[kind] ?? CHIP.draft}`} data-status={kind}>
      {children ?? CHIP_LABEL[kind]}
    </span>
  )
}

export function SharedTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 text-purple-700 text-[11px] font-semibold px-2.5 py-1 whitespace-nowrap">
      <Share2 size={11} /> Shared by all segments
    </span>
  )
}

export function SegmentTag({ children = 'Per segment' }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold px-2.5 py-1 whitespace-nowrap">
      <Users size={11} /> {children}
    </span>
  )
}

export function Panel({ title, subtitle, tag, children, className = '', ...props }) {
  return (
    <section className={`min-w-0 rounded-3xl bg-white/90 border border-white ring-1 ring-slate-200/70 shadow-lg shadow-purple-950/5 ${className}`} {...props}>
      {(title || tag) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-slate-100">
          <div className="min-w-0">
            {title && <h3 className="font-display text-[0.95rem] font-semibold tracking-tight text-slate-800">{title}</h3>}
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {tag}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}

// A section that starts folded: shared with the Chef flow, so it lives in the
// shared UI folder (see Collapsible.jsx for what it is and why it is a native
// <details>).
export { default as Collapsible } from '../../../../components/ui/Collapsible'

const MATCH = {
  close: { label: 'Close', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  within: { label: 'Within margin', className: 'bg-sky-100 text-sky-800 border-sky-200' },
  off: { label: 'Off target', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  none: { label: 'No target', className: 'bg-slate-50 text-slate-400 border-slate-200' },
}
export function MatchChip({ kind, children, ...props }) {
  const m = MATCH[kind] ?? MATCH.none
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${m.className}`} data-match={kind} {...props}>
      {children ?? m.label}
    </span>
  )
}

export function ProgressBar({ value, label }) {
  const pct = Math.max(0, Math.min(100, Math.round((value ?? 0) * 100)))
  return (
    <div className="flex min-w-[14rem] flex-1 flex-col gap-1" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-gradient-to-r from-purple-600 to-fuchsia-500 transition-[width] duration-300" style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
    </div>
  )
}

export function FieldLabel({ children, hint }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
      {children}
      {hint && <span className="ml-1 normal-case tracking-normal font-normal text-slate-400">{hint}</span>}
    </span>
  )
}

export function CheckLine({ ok, children, action }) {
  return (
    <div className={`flex items-start gap-2 text-sm ${ok ? 'text-slate-600' : 'text-amber-700'}`}>
      <span className={`mt-0.5 grid place-items-center w-4 h-4 rounded-full shrink-0 ${ok ? 'bg-emerald-500 text-white' : 'border-2 border-amber-400'}`}>{ok && <Check size={11} strokeWidth={3} />}</span>
      <span className="flex-1">{children}</span>
      {action}
    </div>
  )
}

export function LinkButton({ children, className = '', ...props }) {
  return (
    <button type="button" className={`text-purple-700 hover:underline font-medium whitespace-nowrap disabled:text-slate-300 disabled:no-underline ${className}`} {...props}>
      {children}
    </button>
  )
}
