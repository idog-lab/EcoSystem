import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import Card from '../../components/ui/Card'
import { balanceTiers, parseTierRows } from '../../lib/economy/balance'
import { worthText } from '../../lib/economy/examples'
import { BUTTON, INPUT, MONO, Num, TD, TH, Text } from './economyUi'

// BALANCE A FEATURE'S TIERS (the economist's rules, section 6): each tier's
// target and reward text; its worth by the economy, the gap and gap %, per tier
// and cumulative, flagged beyond +-X% (typed - the rules do not give X), the
// grand prize's share, and the currency amount that would close a gap.
// The tiers are a working sheet for this viewer (kept in this browser only).
const DRAFT_KEY = 'economy-balance-draft'
const loadDraft = () => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && Array.isArray(parsed.rows) ? parsed : null
  } catch {
    return null
  }
}

const signed = (x, digits = 2) => (x == null ? '-' : `${x > 0 ? '+' : ''}${worthText(Math.round(x * 10 ** digits) / 10 ** digits)}`)

export default function BalanceTab({ economy }) {
  const draft = useMemo(loadDraft, [])
  const [rows, setRows] = useState(draft?.rows ?? [{ tier: '', target: null, text: '' }])
  const [flagPct, setFlagPct] = useState(draft?.flagPct ?? 10)
  const [currency, setCurrency] = useState(draft?.currency ?? '')
  const [date, setDate] = useState(draft?.date ?? '')
  const [paste, setPaste] = useState('')
  const [message, setMessage] = useState(null)
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ rows, flagPct, currency, date }))
    } catch {
      // (a working sheet only: not kept when the browser has no room)
    }
  }, [rows, flagPct, currency, date])

  const result = useMemo(() => balanceTiers(rows, { economy, date: date || null, flagPct, currency }), [rows, economy, date, flagPct, currency])
  const set = (i, patch) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const usable = economy.currencies.filter((c) => c.valueGameplay != null || c.daily || c.periods?.length)

  function usePaste() {
    const { rows: read, bad } = parseTierRows(paste)
    if (!read.length) return setMessage({ bad: true, text: 'Nothing could be read. One tier a line: tier, target, reward text - or target, reward text - separated by tabs (as copied from a sheet).' })
    setRows(read)
    setPaste('')
    setMessage({ bad: bad.length > 0, text: `${read.length} tiers taken${bad.length ? `; not read: ${bad.slice(0, 2).join(' / ')}` : ''}.` })
  }

  return (
    <div className="flex flex-col gap-4" data-testid="economy-balance">
      <Card title="Balance a feature's tiers" subtitle="Each tier's target and reward text: its worth, the gap, and what would close it">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
            <label className="flex items-center gap-1.5" title="The rules say to flag anything beyond +-X%, without giving X. Typed here.">
              Flag a gap beyond ±
              <Num aria-label="Flag a gap beyond this %" value={flagPct} min={0} max={100} onCommit={setFlagPct} className="w-14" data-testid="economy-balance-flag" />%
            </label>
            <label className="flex items-center gap-2" title="The currency whose amount would close a tier's gap: round((target - worth without it) / its worth).">
              Close a gap with
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={`${INPUT} font-mono`} data-testid="economy-balance-currency">
                <option value="">no currency</option>
                {usable.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              {!usable.length && <span className="text-xs text-slate-400">no currency has a worth yet (Worth tab)</span>}
            </label>
            <label className="flex items-center gap-2" title="A currency whose worth changes by day reads that date's value.">
              Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" data-dense data-testid="economy-balance-table">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={TH}>Tier</th>
                  <th className={`${TH} text-center`}>Target</th>
                  <th className={TH}>Reward text</th>
                  <th className={`${TH} text-right`}>Worth</th>
                  <th className={`${TH} text-right`} title="Worth - target, and as a % of the target. Flagged beyond the % typed.">
                    Gap
                  </th>
                  <th className={`${TH} text-right`} title="All tiers up to this one: worth against target, as a %.">
                    So far
                  </th>
                  {currency && (
                    <th className={TH} title="round((target - the worth without this currency) / its worth)">
                      To close it
                    </th>
                  )}
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i} className={`border-b border-slate-100 align-top text-sm ${r.flagged ? 'bg-amber-50/60' : ''}`} data-balance-row={i} data-flagged={r.flagged ? 'yes' : 'no'}>
                    <td className={TD}>
                      <Text aria-label={`Tier ${i + 1} name`} value={rows[i].tier} placeholder={`Tier ${i + 1}`} onCommit={(v) => set(i, { tier: v })} className="w-24" />
                    </td>
                    <td className={`${TD} text-center`}>
                      <Num aria-label={`Tier ${i + 1} target`} value={rows[i].target} allowEmpty onCommit={(v) => set(i, { target: v })} className="w-20" placeholder="target" />
                    </td>
                    <td className={TD}>
                      <Text aria-label={`Tier ${i + 1} reward text`} value={rows[i].text} placeholder="allowance(coins:3)+free_wild:1" onCommit={(v) => set(i, { text: v })} className={`w-full min-w-[16rem] ${MONO}`} />
                      {r.unknown.length > 0 && <div className="mt-0.5 text-[11px] text-amber-800">No worth for: {r.unknown.join(', ')}</div>}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-right tabular-nums text-slate-700`} data-cell="worth">
                      {r.worth == null ? <span className="text-amber-800">unknown</span> : worthText(r.worth)}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-right tabular-nums ${r.flagged ? 'font-semibold text-amber-800' : 'text-slate-700'}`} data-cell="gap">
                      {r.gap == null ? '-' : `${signed(r.gap)} (${signed(r.gapPct, 1)}%)`}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-right tabular-nums text-slate-500`} data-cell="so-far">
                      {r.cumGapPct == null ? '-' : `${signed(r.cumGapPct, 1)}%`}
                    </td>
                    {currency && (
                      <td className={`${TD} text-xs text-slate-600`} data-cell="suggest">
                        {r.suggest == null ? '-' : r.suggest.text ? <span className={MONO}>{r.suggest.text}</span> : 'none needed'}
                      </td>
                    )}
                    <td className={TD}>
                      <button type="button" aria-label={`Remove tier ${i + 1}`} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => setRows((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : [{ tier: '', target: null, text: '' }]))}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BUTTON} onClick={() => setRows((list) => [...list, { tier: '', target: null, text: '' }])} data-testid="economy-balance-add">
              Add a tier
            </button>
          </div>
          <p className="text-sm text-slate-700" data-testid="economy-balance-totals">
            All tiers: worth <span className="font-semibold">{result.totals.worth == null ? 'unknown' : worthText(result.totals.worth)}</span> against {worthText(result.totals.target)}
            {result.totals.gapPct != null && ` (${signed(result.totals.gapPct, 1)}%)`}. The grand prize (the last tier):{' '}
            {result.totals.grandShareOfWorth == null ? 'its share is unknown' : `${Math.round(result.totals.grandShareOfWorth * 1000) / 10}% of the worth`}
            {result.totals.grandShareOfTarget != null && `, ${Math.round(result.totals.grandShareOfTarget * 1000) / 10}% of the target`}.
          </p>
          <details className="text-sm text-slate-600">
            <summary className="cursor-pointer text-xs font-semibold">Paste tiers from a sheet</summary>
            <div className="mt-1.5 flex flex-col gap-1.5">
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} placeholder={'Tier 1\t5\tallowance(coins:3)+free_wild:1'} className={`${INPUT} font-mono text-[12px]`} data-testid="economy-balance-paste" />
              <button type="button" className={`${BUTTON} self-start`} onClick={usePaste} disabled={!paste.trim()} data-testid="economy-balance-use">
                Replace the tiers with these
              </button>
            </div>
          </details>
          {message && <p className={`text-xs font-medium ${message.bad ? 'text-rose-700' : 'text-emerald-700'}`}>{message.text}</p>}
          <p className="text-xs text-slate-500" data-note>
            The rules&apos; checks: gap = worth - target, per tier and cumulative, flagged beyond ±X%; the grand prize&apos;s separate share; the currency to close a gap = round((target - worth without it) / its worth). A part
            with no worth makes a tier unknown, never smaller. The tiers stay in this browser as a working sheet.
          </p>
        </div>
      </Card>
    </div>
  )
}
