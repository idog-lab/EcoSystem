// Small building blocks in the Merge tool's look: white rounded cards on the
// lavender page, purple accents. A number field commits on Enter or leaving
// it, and says why it refused a value instead of silently keeping the old one.

import { useEffect, useState, type ReactNode } from 'react'

export function Panel({ title, subtitle, action, children, className = '', testId }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section data-testid={testId} className={`min-w-0 rounded-3xl border border-white bg-white/90 shadow-lg shadow-purple-950/5 ring-1 ring-slate-200/70 ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 pb-3 pt-4">
          <div className="min-w-0">
            {title && <h2 className="font-display text-[0.95rem] font-semibold tracking-tight text-slate-800">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500" data-note>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}

export function Btn({ children, onClick, variant = 'secondary', disabled, title, testId, small }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean; title?: string; testId?: string; small?: boolean }) {
  const v = {
    primary: 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-md shadow-purple-500/25 hover:from-purple-500 hover:to-fuchsia-500',
    secondary: 'bg-white text-slate-700 border border-slate-200 shadow-sm hover:border-purple-200 hover:bg-purple-50/60',
    ghost: 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
    danger: 'text-red-600 border border-red-200 bg-white hover:bg-red-50',
  }[variant]
  return (
    <button type="button" title={title} data-testid={testId} disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-semibold transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${small ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm'} ${v}`}>
      {children}
    </button>
  )
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span className="mb-1 block text-xs font-semibold text-slate-600" title={hint}>
      {children}
    </span>
  )
}

const parseNumber = (s: string) => {
  const t = s.trim().replace(/,/g, '').replace(/%$/, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : Number.NaN
}

/** A number typed as it is shown (`scale` 100 shows a share as a percent). Blank is allowed only with `allowBlank`. */
export function Num({ value, onChange, scale = 1, digits = 4, min, max, allowBlank, testId, width = 'w-24', ariaLabel, suffix }: {
  value: number | null
  onChange: (v: number | null) => void
  scale?: number
  digits?: number
  min?: number
  max?: number
  allowBlank?: boolean
  testId?: string
  width?: string
  ariaLabel?: string
  suffix?: string
}) {
  const shown = value == null ? '' : String(Number.parseFloat((value * scale).toFixed(digits)))
  const [text, setText] = useState(shown)
  const [error, setError] = useState('')
  useEffect(() => setText(shown), [shown])
  const commit = () => {
    const n = parseNumber(text)
    if (n == null) {
      if (allowBlank) {
        setError('')
        return onChange(null)
      }
      setError('A number is needed here.')
      return setText(shown)
    }
    if (Number.isNaN(n)) {
      setError(`"${text}" is not a number.`)
      return setText(shown)
    }
    const v = n / scale
    if (min != null && v < min) {
      setError(`At least ${min * scale}.`)
      return setText(shown)
    }
    if (max != null && v > max) {
      setError(`At most ${max * scale}.`)
      return setText(shown)
    }
    setError('')
    if (v !== value) onChange(v)
  }
  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-1">
        <input
          aria-label={ariaLabel}
          data-testid={testId}
          data-field-rejected={error ? 'true' : undefined}
          className={`${width} rounded-lg border bg-white px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-200 ${error ? 'border-red-300' : 'border-slate-200'}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {suffix && <span className="text-xs text-slate-400">{suffix}</span>}
      </span>
      {error && <span className="mt-0.5 text-[11px] text-red-600">{error}</span>}
    </span>
  )
}

export function Text({ value, onChange, testId, width = 'w-full', placeholder, ariaLabel }: { value: string; onChange: (v: string) => void; testId?: string; width?: string; placeholder?: string; ariaLabel?: string }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <input
      aria-label={ariaLabel}
      data-testid={testId}
      placeholder={placeholder}
      className={`${width} rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-200`}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onChange(text)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

export function Choice<T extends string>({ value, options, onChange, testId, ariaLabel }: { value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void; testId?: string; ariaLabel?: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} data-testid={testId} className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.hint}
          data-value={o.value}
          onClick={() => onChange(o.value)}
          className={`whitespace-nowrap rounded-lg px-3 py-1 text-sm font-semibold transition-colors ${o.value === value ? 'bg-white text-purple-700 shadow' : 'text-slate-600 hover:text-slate-800'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Pill({ tone = 'slate', children, title }: { tone?: 'slate' | 'green' | 'amber' | 'red' | 'purple'; children: ReactNode; title?: string }) {
  const t = { slate: 'bg-slate-100 text-slate-600', green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', red: 'bg-red-50 text-red-700', purple: 'bg-purple-50 text-purple-700' }[tone]
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${t}`}>
      {children}
    </span>
  )
}

export function Note({ tone = 'slate', children, testId }: { tone?: 'slate' | 'amber' | 'red' | 'green'; children: ReactNode; testId?: string }) {
  const t = { slate: 'border-slate-200 bg-slate-50 text-slate-600', amber: 'border-amber-200 bg-amber-50 text-amber-800', red: 'border-red-200 bg-red-50 text-red-700', green: 'border-emerald-200 bg-emerald-50 text-emerald-800' }[tone]
  return (
    <div data-testid={testId} data-note className={`rounded-2xl border px-3 py-2 text-xs ${t}`}>
      {children}
    </div>
  )
}

export function Table({ head, children, testId }: { head: ReactNode[]; children: ReactNode; testId?: string }) {
  return (
    <div className="overflow-x-auto">
      <table data-testid={testId} data-dense className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap border-b border-slate-200 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

