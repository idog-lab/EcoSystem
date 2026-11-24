import { useMemo, useState } from 'react'
import Card from '../../components/ui/Card'
import { checkReward, rewardWorth } from '../../lib/economy/parse'
import { REAL_EXAMPLES } from '../../lib/economy/examples'
import { BUTTON, Findings, INPUT, WorthBreakdown } from './economyUi'


// CHECK A REWARD: paste any reward text; see whether the game can read it,
// what is not on the lists, and what it is worth.
export default function CheckTab({ economy }) {
  const [text, setText] = useState('')
  const [date, setDate] = useState('')
  const [where, setWhere] = useState('tier')
  // Several texts at once: one a line.
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const results = useMemo(
    () =>
      lines.map((line) => {
        const check = checkReward(line, { economy, coinDecimals: where === 'small' ? 3 : 2 })
        return { line, check, worth: check.node ? rewardWorth(check.node, economy, { date: date || null }) : null }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, economy, date, where],
  )
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] xl:items-start">
      <Card title="Check a reward" subtitle="Paste reward text - one a line for several">
        <div className="flex flex-col gap-3">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} spellCheck={false} aria-label="Reward text" placeholder="allowance(coins:3)+free_wild:1+[dynamic(dr-puzzle:25)]" className={`${INPUT} font-mono text-[12.5px]`} data-testid="economy-check-input" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
            <label className="flex items-center gap-2" title="A currency whose worth changes by day reads that date's value.">
              Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} data-testid="economy-check-date" />
            </label>
            <label className="flex items-center gap-2" title="Coins are written with 2 decimals in a tier prize. Merge Mania's small rewards keep 3 when they are small (economist).">
              Where
              <select value={where} onChange={(e) => setWhere(e.target.value)} className={INPUT} data-testid="economy-check-where">
                <option value="tier">a tier prize</option>
                <option value="small">a Merge Mania small reward</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">The economist&apos;s examples:</span>
            {REAL_EXAMPLES.map((ex, i) => (
              <button key={i} type="button" className={BUTTON} onClick={() => setText(ex)} data-testid={`economy-example-${i + 1}`}>
                {i + 1}
              </button>
            ))}
            <button type="button" className={BUTTON} onClick={() => setText(REAL_EXAMPLES.join('\n'))}>
              All four
            </button>
          </div>
        </div>
      </Card>
      <div className="flex flex-col gap-4" data-testid="economy-check-results">
        {results.length === 0 && (
          <Card>
            <p className="text-sm text-slate-500">Nothing to check yet.</p>
          </Card>
        )}
        {results.map(({ line, check, worth }, i) => {
          const errors = check.issues.filter((x) => x.level === 'error').length
          const warnings = check.issues.length - errors
          return (
            <Card key={i}>
              <div className="flex flex-col gap-3" data-check-result={i} data-ok={check.ok ? 'yes' : 'no'}>
                <p className="font-mono text-[12.5px] break-all text-slate-800">{line}</p>
                <p className={`text-sm font-semibold ${errors ? 'text-rose-700' : warnings ? 'text-amber-800' : 'text-emerald-700'}`} data-testid="economy-check-verdict">
                  {errors ? `The game cannot read it as it is: ${errors} to fix` : warnings ? `Readable, ${warnings} thing${warnings === 1 ? '' : 's'} to look at` : 'Readable, and every key is on the lists'}
                </p>
                <Findings issues={check.issues} />
                {check.ok && <WorthBreakdown result={worth} />}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
