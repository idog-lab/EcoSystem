import { useEffect, useState } from 'react'
import { AlertTriangle, Copy, Info, Trash2, XCircle } from 'lucide-react'
import { SEVERITY_LABELS } from '../lib/chefValidation'

// Small pieces the steps of the Chef flow share.

// A NUMBER THAT IS TAKEN WHEN THE FIELD IS LEFT (or on Enter), not on every
// key. A field that reports each keystroke turns "0." into 0 before the
// "25" can be typed, and an emptied field into 0 before its new value: a
// segment's 0.25 baskets a day could not be typed in one go. An empty field,
// or something that is not a number, puts the last value back - empty is
// never read as zero - unless `allowEmpty` (then it means "not set").
export function Num({ value, onCommit, min = 0, max = Infinity, allowEmpty = false, className = '', ...props }) {
  const shown = value == null ? '' : String(value)
  const [text, setText] = useState(shown)
  useEffect(() => setText(shown), [shown])

  function commit() {
    if (text.trim() === '') {
      if (allowEmpty) {
        if (value != null) onCommit(null)
      } else setText(shown)
      return
    }
    const typed = Number(text)
    if (!Number.isFinite(typed)) {
      setText(shown)
      return
    }
    const n = Math.min(max, Math.max(min, typed))
    if (n !== typed) setText(String(n))
    if (n !== value) onCommit(n)
  }

  return (
    <input
      type="number"
      value={text}
      min={Number.isFinite(min) ? min : undefined}
      max={Number.isFinite(max) ? max : undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className={`rounded-lg border border-slate-200 bg-white/80 px-1.5 py-1 text-center text-sm font-medium tabular-nums text-slate-800 [appearance:textfield] focus:border-purple-400 focus:outline-none focus:ring-4 focus:ring-purple-200/60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${className}`}
      {...props}
    />
  )
}

// One of a few: the dish list in view, the phase in view, the odds in view.
export function Toggle({ options, value, onChange, ...props }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100/80 p-1" role="group" {...props}>
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          data-option={id}
          onClick={() => onChange(id)}
          className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${value === id ? 'bg-white text-purple-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// The two things done to a row: a copy of it, and taking it away.
export function RowActions({ what, onDuplicate, onRemove }) {
  return (
    <span className="inline-flex items-center">
      {onDuplicate && (
        <button type="button" title={`Duplicate ${what}`} aria-label={`Duplicate ${what}`} onClick={onDuplicate} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <Copy size={13} />
        </button>
      )}
      {onRemove && (
        <button type="button" title={`Remove ${what}`} aria-label={`Remove ${what}`} onClick={onRemove} className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
          <Trash2 size={13} />
        </button>
      )}
    </span>
  )
}

export function AddButton({ children, ...props }) {
  return (
    <button type="button" className="whitespace-nowrap text-xs font-semibold text-purple-600 hover:text-purple-800" {...props}>
      + {children}
    </button>
  )
}

// A head cell and a body cell of the flow's tables (dense: low rows).
export const TH = 'px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap'
export const TD = 'px-2 py-1 align-middle'
export const NAME_INPUT = 'w-full border-b border-transparent bg-transparent text-sm font-semibold text-slate-800 focus:border-purple-300 focus:outline-none'
export const SELECT = 'rounded-lg border border-slate-200 bg-white/80 px-2 py-1 text-sm text-slate-700 focus:border-purple-400 focus:outline-none'

const SEVERITY_STYLE = {
  block: { icon: XCircle, className: 'border-red-200 bg-red-50 text-red-800' },
  review: { icon: AlertTriangle, className: 'border-amber-200 bg-amber-50 text-amber-800' },
  info: { icon: Info, className: 'border-slate-200 bg-slate-50 text-slate-600' },
}

// One finding of the checks. `onGoTo` adds a link to the step that puts it right.
export function Finding({ finding, stepLabel, onGoTo }) {
  const { icon: Icon, className } = SEVERITY_STYLE[finding.severity] ?? SEVERITY_STYLE.info
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${className}`} data-finding={finding.severity}>
      <Icon size={14} className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{SEVERITY_LABELS[finding.severity]}:</span> {finding.message}
      </span>
      {onGoTo && (
        <button type="button" onClick={onGoTo} className="shrink-0 whitespace-nowrap text-xs font-semibold underline decoration-dotted underline-offset-2 hover:decoration-solid">
          {stepLabel}
        </button>
      )}
    </div>
  )
}

// What a step has to put right, at its top and never folded: the things that
// need a fix and the things worth a look. ("Good to know" lines are in the
// full list of checks, in the Simulate step.)
export function StepFindings({ findings }) {
  const shown = findings.filter((f) => f.severity !== 'info')
  if (shown.length === 0) return null
  return (
    <div className="flex flex-col gap-2" data-testid="chef-step-findings">
      {shown.map((f, i) => (
        <Finding key={i} finding={f} />
      ))}
    </div>
  )
}

// A small labelled field of a form row.
export function Field({ label, title, children, className = '' }) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className}`} title={title}>
      <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  )
}

// A yes/no setting.
export function Check({ checked, onChange, children, ...props }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-sm text-slate-700">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-purple-300" {...props} />
      {children}
    </label>
  )
}

// One of a list, as a row of small buttons (the segment in view, a player).
export function Pills({ options, value, onChange, ...props }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" {...props}>
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          data-option={id}
          onClick={() => onChange(id)}
          className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold ${value === id ? 'bg-purple-600 text-white' : 'border border-slate-200 bg-white/70 text-slate-500 hover:text-slate-700'}`}
        >
          {label}
        </button>
      ))}
    </span>
  )
}

