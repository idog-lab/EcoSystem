import { useMemo, useState } from 'react'
import Card from '../../components/ui/Card'
import { PRIZE_MODES, checkReward, rewardWorth } from '../../lib/economy/parse'
import { REAL_EXAMPLES } from '../../lib/economy/examples'
import { BUTTON, Findings, INPUT, Num, WorthBreakdown } from './economyUi'


// CHECK A REWARD: paste any reward text; see whether the game can read it -
// by the economist's validator's rules (Reward Scanner Pro) - what is not on
// the lists, how many prizes it gives and what it is worth.
export default function CheckTab({ economy }) {
  const [text, setText] = useState('')
  const [date, setDate] = useState('')
  const [where, setWhere] = useState('tier')
  // The validator's run options: the prize limits, upper case triggers.
  const [prizeMode, setPrizeMode] = useState('normal')
  const [prizeLimit, setPrizeLimit] = useState(5)
  const [allowUppercaseTrigger, setAllowUppercase] = useState(false)
  // Several texts at once: one a line.
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const results = useMemo(
    () =>
      lines.map((line) => {
        const check = checkReward(line, { economy, coinDecimals: where === 'small' ? 3 : 2, prizeMode, prizeLimit, allowUppercaseTrigger })
        return { line, check, worth: check.node ? rewardWorth(check.node, economy, { date: date || null }) : null }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, economy, date, where, prizeMode, prizeLimit, allowUppercaseTrigger],
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
            <label className="flex items-center gap-2" title="The validator's prize limits. Triggers and hidden counters (dr-hidden, dr-mission-N-hidden, dr-pack-counter, dr-basket-counter) are not prizes.">
              Prizes
              <select value={prizeMode} onChange={(e) => setPrizeMode(e.target.value)} className={INPUT} data-testid="economy-check-prize-mode">
                {PRIZE_MODES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            {prizeMode === 'custom' && <Num aria-label="My prize limit" value={prizeLimit} min={0} integer onCommit={setPrizeLimit} className="w-16" data-testid="economy-check-prize-limit" />}
            <label className="flex items-center gap-2" title="The validator takes lower case triggers only, unless this is ticked.">
              <input type="checkbox" checked={allowUppercaseTrigger} onChange={(e) => setAllowUppercase(e.target.checked)} data-testid="economy-check-uppercase" />
              Allow upper case triggers
            </label>
          </div>
          <p className="text-xs text-slate-500" data-note>
            Checked by the rules of the economist&apos;s validator (Reward Scanner Pro): a dynamic(...) in brackets, a [ ] group starting with dynamic or a pack, no preset in brackets, whole currency amounts, unknown keys to fix.
          </p>
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
                {check.node && (
                  <p className="text-sm text-slate-600" data-testid="economy-check-prizes">
                    {check.prizes} {check.prizes === 1 ? 'prize' : 'prizes'}
                    <span className="text-xs text-slate-400"> - triggers and hidden counters are not counted</span>
                  </p>
                )}
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
