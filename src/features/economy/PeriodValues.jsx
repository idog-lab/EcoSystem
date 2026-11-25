import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { addDays, cleanPeriods, isRealDate, overlapping, parsePeriods, readableDate } from '../../lib/economy/economyModel'
import { BUTTON, INPUT, Num } from './economyUi'

// THE VALUES OF A CURRENCY ALWAYS IN THE GAME, each with the dates it holds for (economist, 25 Nov 2026): the
// puzzle a value a day, the pet a value a week it is live (7 days from the day typed), merge and picks from a date
// to a date. Dates are picked on a calendar; a whole list can be pasted from a sheet. Two values never share a day:
// one that would is refused, and said. A day with no value reads unknown.

const STEP = {
  day: { add: 'Add the day', unit: 'day', paste: '2026-11-30=0.0376875|2026-12-01=0.0333518|...', how: 'a date and its value, as 2026-11-30=0.0376875|2026-12-01=0.0333518' },
  week: { add: 'Add the week', unit: 'week', paste: '2026-12-01=0.4|2026-12-15=0.35', how: 'the first day of each week and its value, as 2026-12-01=0.4|2026-12-15=0.35' },
  range: { add: 'Add the dates', unit: 'period', paste: '2026-12-01..2026-12-14=0.3|2026-12-15..2026-12-31=0.25', how: 'from..to=value, as 2026-12-01..2026-12-14=0.3 (or from, to and value in three columns)' },
}
const span = (p) => (p.from === p.to ? readableDate(p.from) : `${readableDate(p.from)} to ${readableDate(p.to)}`)

export default function PeriodValues({ name, step, periods, onChange }) {
  const s = STEP[step]
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState(null)
  const [paste, setPaste] = useState('')
  const [message, setMessage] = useState(null)
  const save = (list) => onChange(cleanPeriods(list))
  const last = periods[periods.length - 1]
  const nextFrom = from || (last ? addDays(last.to, 1) : '')
  const endOf = (start) => (step === 'day' ? start : step === 'week' ? addDays(start, 6) : to || start)
  const refuse = (text) => setMessage({ bad: true, text })

  function add() {
    if (!isRealDate(nextFrom)) return refuse(step === 'range' ? 'Pick the first date on the calendar.' : `Pick the ${s.unit === 'week' ? 'first day of the week' : 'day'} on the calendar.`)
    const end = endOf(nextFrom)
    if (!isRealDate(end) || end < nextFrom) return refuse('The last date is before the first.')
    if (amount == null) return refuse(`Type the value of that ${s.unit}.`)
    const clash = overlapping(periods, nextFrom, end)
    if (clash) return refuse(step === 'day' ? `${span(clash)} has a value already - change it in the list.` : `${span({ from: nextFrom, to: end })} shares days with ${span(clash)}, which has a value already - change it in the list.`)
    save([...periods, { from: nextFrom, to: end, value: amount }])
    setMessage(null)
    setFrom(addDays(end, 1))
    setTo('')
    setAmount(null)
  }
  function changeDates(i, nextStart, nextEnd) {
    const start = nextStart
    const end = step === 'range' ? nextEnd : endOf(start)
    if (!isRealDate(start) || !isRealDate(end)) return refuse('Pick a date on the calendar.')
    if (end < start) return refuse('The last date is before the first.')
    const clash = overlapping(periods, start, end, i)
    if (clash) return refuse(`${span({ from: start, to: end })} shares days with ${span(clash)}.`)
    setMessage(null)
    save(periods.map((p, j) => (j === i ? { ...p, from: start, to: end } : p)))
  }
  function usePaste() {
    const { periods: read, bad } = parsePeriods(paste, step)
    if (!read.length) return refuse(`Nothing could be read${bad.length ? `: ${bad.slice(0, 3).join(', ')}` : ''}. Write ${s.how}.`)
    const kept = []
    const clashes = []
    for (const p of read) (overlapping(kept, p.from, p.to) ? clashes : kept).push(p)
    save(kept)
    setPaste('')
    setMessage({
      bad: bad.length > 0 || clashes.length > 0,
      text: `${kept.length} ${s.unit}${kept.length === 1 ? '' : 's'} taken${clashes.length ? `; ${clashes.length} sharing days with one before (left out: ${clashes.slice(0, 2).map(span).join(', ')})` : ''}${bad.length ? `; not read: ${bad.slice(0, 3).join(', ')}` : ''}.`,
    })
  }

  return (
    <div className="flex flex-col gap-2" data-testid={`economy-periods-${name}`}>
      {periods.length > 0 ? (
        <div className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
          {periods.map((p, i) => (
            <div key={`${p.from}-${i}`} className="flex flex-wrap items-start gap-2" data-period-row={p.from}>
              <button type="button" aria-label={`Remove ${span(p)}`} title={`Remove ${span(p)}`} className="mt-0.5 grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => save(periods.filter((_, j) => j !== i))}>
                <Trash2 size={14} />
              </button>
              <input type="date" value={p.from} onChange={(e) => changeDates(i, e.target.value, p.to)} aria-label={`${name}: ${step === 'range' ? 'from' : step === 'week' ? 'first day of the week' : 'day'}`} className={`${INPUT} w-40`} />
              {step === 'range' && <input type="date" value={p.to} onChange={(e) => changeDates(i, p.from, e.target.value)} aria-label={`${name}: to`} className={`${INPUT} w-40`} />}
              {step === 'week' && <span className="mt-1.5 text-xs text-slate-500">to {readableDate(p.to)}</span>}
              <Num aria-label={`${name}: value ${span(p)}`} value={p.value} onCommit={(v) => save(periods.map((x, j) => (j === i ? { ...x, value: v } : x)))} className="w-28" />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">No value given yet: a prize with it reads unknown on every date.</p>
      )}
      <div className="flex flex-wrap items-start gap-2 border-t border-slate-100 pt-2">
        <input type="date" value={nextFrom} onChange={(e) => setFrom(e.target.value)} aria-label={`${name}: new ${step === 'range' ? 'first date' : step === 'week' ? 'first day of the week' : 'day'}`} data-testid={`economy-period-from-${name}`} className={`${INPUT} w-40`} />
        {step === 'range' && <input type="date" value={to || nextFrom} min={nextFrom || undefined} onChange={(e) => setTo(e.target.value)} aria-label={`${name}: new last date`} data-testid={`economy-period-to-${name}`} className={`${INPUT} w-40`} />}
        {step === 'week' && isRealDate(nextFrom) && <span className="mt-1.5 text-xs text-slate-500">to {readableDate(addDays(nextFrom, 6))}</span>}
        <Num aria-label={`${name}: new value`} value={amount} allowEmpty onCommit={setAmount} placeholder="value" className="w-28" data-testid={`economy-period-value-${name}`} />
        <button type="button" className={BUTTON} onClick={add} data-testid={`economy-period-add-${name}`}>
          {s.add}
        </button>
      </div>
      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer font-semibold">Paste a whole list from a sheet</summary>
        <div className="mt-1.5 flex flex-col gap-1.5">
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={2} placeholder={s.paste} aria-label={`${name}: paste dates`} data-testid={`economy-period-paste-${name}`} className={`${INPUT} font-mono text-[12px]`} />
          <button type="button" className={`${BUTTON} self-start`} onClick={usePaste} disabled={!paste.trim()} data-testid={`economy-period-use-${name}`}>
            Replace the list with these
          </button>
        </div>
      </details>
      {message && (
        <p className={`text-xs font-medium ${message.bad ? 'text-rose-700' : 'text-emerald-700'}`} data-testid={`economy-period-message-${name}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
