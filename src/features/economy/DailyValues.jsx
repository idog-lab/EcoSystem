import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { formatDailyValues, isRealDate, parseDailyValues } from '../../lib/economy/economyModel'
import { BUTTON, INPUT, Num } from './economyUi'

// A CURRENCY'S VALUES BY DATE, entered the way dates should be: picked on a
// calendar (economist: "there should be data validation on the types entered
// ... specially the dates, calendar pop up is the best"), each with its value
// as a number. A whole list can still be pasted from a sheet - the export
// writing, 2026-11-30=0.0376875|2026-12-01=0.0333518|... - and what cannot be
// read is refused and said, never kept. Stored as that writing.

const dayAfter = (text) => {
  const d = new Date(`${text}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

export default function DailyValues({ name, value, onChange }) {
  const { entries } = parseDailyValues(value)
  const [date, setDate] = useState('')
  const [amount, setAmount] = useState(null)
  const [paste, setPaste] = useState('')
  const [message, setMessage] = useState(null)
  const save = (list) => onChange(formatDailyValues([...list].sort(byDate)))
  const suggested = entries.length ? dayAfter(entries[entries.length - 1].date) : ''

  function add() {
    const day = date || suggested
    if (!isRealDate(day)) return setMessage({ bad: true, text: 'Pick a date on the calendar.' })
    if (amount == null) return setMessage({ bad: true, text: 'Type the value of that day.' })
    if (entries.some((e) => e.date === day)) return setMessage({ bad: true, text: `${day} has a value already - change it in the list.` })
    save([...entries, { date: day, value: amount }])
    setMessage(null)
    setDate(dayAfter(day))
    setAmount(null)
  }
  function changeDate(i, next) {
    if (!isRealDate(next)) return setMessage({ bad: true, text: 'Pick a date on the calendar.' })
    if (entries.some((e, j) => j !== i && e.date === next)) return setMessage({ bad: true, text: `${next} has a value already.` })
    setMessage(null)
    save(entries.map((e, j) => (j === i ? { ...e, date: next } : e)))
  }
  function usePaste() {
    const { entries: read, bad } = parseDailyValues(paste)
    if (!read.length) return setMessage({ bad: true, text: `Nothing could be read${bad.length ? `: ${bad.slice(0, 3).join(', ')}` : ''}. Write it as 2026-11-30=0.0376875|2026-12-01=0.0333518.` })
    const unique = new Map(read.map((e) => [e.date, e]))
    save([...unique.values()])
    setPaste('')
    setMessage({ bad: bad.length > 0 || unique.size < read.length, text: `${unique.size} dates taken${unique.size < read.length ? `; ${read.length - unique.size} given twice (the last kept)` : ''}${bad.length ? `; not read: ${bad.slice(0, 3).join(', ')}` : ''}.` })
  }

  return (
    <div className="flex flex-col gap-2" data-testid={`economy-daily-${name}`}>
      {entries.length > 0 ? (
        <div className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
          {entries.map((e, i) => (
            <div key={e.date} className="flex items-start gap-2" data-daily-row={e.date}>
              <input type="date" value={e.date} onChange={(ev) => changeDate(i, ev.target.value)} aria-label={`${name}: date`} className={`${INPUT} w-40`} />
              <Num aria-label={`${name}: value on ${e.date}`} value={e.value} onCommit={(v) => save(entries.map((x, j) => (j === i ? { ...x, value: v } : x)))} className="w-28" />
              <button type="button" aria-label={`Remove ${e.date}`} title="Remove" className="mt-0.5 grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => save(entries.filter((_, j) => j !== i))}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">No value by date: the one worth holds on every day.</p>
      )}
      <div className="flex flex-wrap items-start gap-2 border-t border-slate-100 pt-2">
        <input type="date" value={date || suggested} onChange={(e) => setDate(e.target.value)} aria-label={`${name}: new date`} data-testid={`economy-daily-date-${name}`} className={`${INPUT} w-40`} />
        <Num aria-label={`${name}: new value`} value={amount} allowEmpty onCommit={setAmount} placeholder="value" className="w-28" data-testid={`economy-daily-value-${name}`} />
        <button type="button" className={BUTTON} onClick={add} data-testid={`economy-daily-add-${name}`}>
          Add the day
        </button>
      </div>
      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer font-semibold">Paste a whole list from a sheet</summary>
        <div className="mt-1.5 flex flex-col gap-1.5">
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={2} placeholder="2026-11-30=0.0376875|2026-12-01=0.0333518|..." aria-label={`${name}: paste dates`} data-testid={`economy-daily-paste-${name}`} className={`${INPUT} font-mono text-[12px]`} />
          <button type="button" className={`${BUTTON} self-start`} onClick={usePaste} disabled={!paste.trim()} data-testid={`economy-daily-use-${name}`}>
            Replace the list with these
          </button>
        </div>
      </details>
      {message && (
        <p className={`text-xs font-medium ${message.bad ? 'text-rose-700' : 'text-emerald-700'}`} data-testid={`economy-daily-message-${name}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
