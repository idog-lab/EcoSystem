import { useState } from 'react'
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import Card from '../../components/ui/Card'
import { MINI_GAMES, addDays, currencyValue, findCurrency, isRealDate, liveMiniGame, miniGameOf, normalizeCalendar } from '../../lib/economy/economyModel'
import { BUTTON, INPUT } from './economyUi'

// THE CALENDAR (economist, 26 Nov 2026: "we need that the system will hold some kind of a calendar, that he will know
// the prices of specific DRs with the calendar when we create features"): each day with the DR values it has - the
// puzzle (a value a day) and the pet (a value a week), typed on the Worth tab - and which mini game is live, typed here
// as periods ("Which one is live, by day"). A feature reads its days from here.
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const GAME_TONE = { merge: 'bg-purple-100 text-purple-800', 'diamond-mine': 'bg-sky-100 text-sky-800' }
const fmt = (v) => (v == null ? '-' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 }))
const today = () => new Date().toISOString().slice(0, 10)

export default function CalendarTab({ economy, onChange }) {
  const periods = economy.calendar?.miniGames ?? []
  const [month, setMonth] = useState(() => today().slice(0, 7))
  const [draft, setDraft] = useState({ from: '', to: '', game: 'merge' })
  const [message, setMessage] = useState(null)
  const save = (miniGames) => onChange({ ...economy, calendar: normalizeCalendar({ miniGames }) })

  function add() {
    const { from, to, game } = draft
    if (!isRealDate(from) || !isRealDate(to) || from > to) return setMessage('Pick a first and a last day, in order.')
    const clash = periods.find((p) => p.from <= to && from <= p.to)
    if (clash) return setMessage(`It overlaps ${miniGameOf(clash.game)?.label} ${clash.from} to ${clash.to}.`)
    save([...periods, { from, to, game }])
    setDraft({ from: '', to: '', game })
    setMessage(null)
  }

  // The month's days, from the Monday on or before the 1st.
  const first = `${month}-01`
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7
  const start = addDays(first, -lead)
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  const puzzle = findCurrency(economy, 'dr-puzzle')
  const pet = findCurrency(economy, 'dr-pet')
  const shift = (n) => {
    const d = new Date(`${month}-01T00:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() + n)
    setMonth(d.toISOString().slice(0, 7))
  }
  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,5fr)] xl:items-start" data-testid="economy-calendar">
      <Card title="Mini game live">
        <div className="flex flex-col gap-2">
          <table className="w-full border-collapse text-sm" data-dense data-testid="calendar-periods">
            <tbody>
              {periods.map((p, i) => (
                <tr key={`${p.from}-${i}`} className="border-b border-slate-100" data-period={i}>
                  <td className="py-1 pr-2 tabular-nums">{p.from}</td>
                  <td className="py-1 pr-2 tabular-nums">{p.to}</td>
                  <td className="py-1 pr-2">
                    <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${GAME_TONE[p.game]}`}>{miniGameOf(p.game)?.label}</span>
                  </td>
                  <td className="py-1 text-right">
                    <button type="button" onClick={() => save(periods.filter((_, j) => j !== i))} aria-label={`Remove ${p.from} to ${p.to}`} className="text-slate-400 hover:text-rose-600" data-period-remove={i}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-1.5" data-testid="calendar-add">
            <input type="date" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value, to: d.to || e.target.value }))} className={INPUT} aria-label="First day" data-testid="calendar-from" />
            <input type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} className={INPUT} aria-label="Last day" data-testid="calendar-to" />
            <select value={draft.game} onChange={(e) => setDraft((d) => ({ ...d, game: e.target.value }))} className={INPUT} aria-label="Live" data-testid="calendar-game">
              {MINI_GAMES.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
            <button type="button" className={BUTTON} onClick={add} data-testid="calendar-add-period">
              Add
            </button>
          </div>
          {message && (
            <p className="text-xs text-amber-700" data-testid="calendar-message">
              {message}
            </p>
          )}
        </div>
      </Card>
      <Card
        title={monthName}
        action={
          <span className="flex items-center gap-1">
            <button type="button" className={`${BUTTON} !px-2`} onClick={() => shift(-1)} aria-label="The month before" data-testid="calendar-prev">
              <ChevronLeft size={16} />
            </button>
            <button type="button" className={`${BUTTON} !px-2`} onClick={() => shift(1)} aria-label="The month after" data-testid="calendar-next">
              <ChevronRight size={16} />
            </button>
          </span>
        }
      >
        <div className="grid grid-cols-7 gap-1 text-xs" data-testid="calendar-month" title="Puzzle: dr-puzzle's value that day. Pet: dr-pet's value that week (Worth tab). The mini game live (left).">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {d}
            </div>
          ))}
          {days.map((date) => {
            const inMonth = date.startsWith(month)
            const game = liveMiniGame(economy, date)
            const pz = currencyValue(puzzle, { date })
            const pt = currencyValue(pet, { date })
            return (
              <div key={date} className={`flex min-h-[64px] flex-col gap-0.5 rounded-lg border px-1.5 py-1 ${inMonth ? 'border-slate-200 bg-white' : 'border-transparent bg-slate-50/60 text-slate-300'} ${date === today() ? 'ring-2 ring-purple-300' : ''}`} data-day={date}>
                <span className="font-semibold">{Number(date.slice(8))}</span>
                {inMonth && (
                  <>
                    <span className="tabular-nums text-slate-600" data-day-puzzle>
                      <span className="text-slate-400">P </span>
                      {fmt(pz?.value)}
                    </span>
                    <span className="tabular-nums text-slate-600" data-day-pet>
                      <span className="text-slate-400">Pet </span>
                      {fmt(pt?.value)}
                    </span>
                    {game && <span className={`self-start rounded px-1 text-[10px] font-semibold ${GAME_TONE[game]}`} data-day-game={game}>{miniGameOf(game)?.label}</span>}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
