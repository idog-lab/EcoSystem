import { useMemo, useState } from 'react'
import { chefPrizeTexts } from '../lib/chefPrizeText'
import { useEconomy } from '../../../lib/economy/economyStore'
import { num } from '../lib/chefFormat'
import { SELECT, TD, TH } from './chefUi'

// CHEF PRIZES AS REWARD TEXT (chefPrizeText.js): every dish prize and grand
// prize of a segment, written in the game's syntax by the Economy page's
// rules and read back by its checker. A reading - nothing is exported.
export default function PrizeTextPanel({ state }) {
  const economy = useEconomy()
  const [segmentId, setSegmentId] = useState('base')
  const segment = state.segments.find((s) => s.id === segmentId) ?? null
  const rows = useMemo(() => chefPrizeTexts(state, segment, economy), [state, segment, economy])
  const [copied, setCopied] = useState(false)
  const written = rows.filter((r) => r.text)
  const tsv = ['Prize\tReward text', ...written.map((r) => `${r.name}\t${r.text}`)].join('\n')
  return (
    <div className="flex flex-col gap-3" data-testid="chef-prize-text">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        For
        <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)} aria-label="Segment" data-testid="chef-prize-text-segment" className={SELECT}>
          <option value="base">the base</option>
          {state.segments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!written.length}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(tsv)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            } catch {
              setCopied(false)
            }
          }}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-purple-700 disabled:opacity-50"
        >
          {copied ? 'Copied' : `Copy the ${written.length} written`}
        </button>
      </div>
      <p className="text-xs text-slate-500" data-note>
        Written by the economy&apos;s rules (the Economy page): coins as allowance to 2 decimals, then wilds, extra stock, undos and free rounds, whole numbers only. A reading - nothing is exported. A prize that cannot be
        written says why instead of dropping or rounding an amount.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" data-dense>
          <thead>
            <tr className="border-b border-slate-200">
              <th className={TH}>Prize</th>
              <th className={TH}>Reward text</th>
              <th className={`${TH} text-right`}>Worth</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.round}-${r.id}`} className="border-b border-slate-100 align-top text-sm" data-prize-text={r.id} data-written={r.text ? 'yes' : 'no'}>
                <td className={`${TD} whitespace-nowrap font-medium text-slate-700`}>
                  {r.name}
                  {r.round === 'rc' && <span className="ml-1 text-[11px] text-slate-400">Recompletion</span>}
                </td>
                <td className={TD}>
                  {r.text ? <span className="break-all font-mono text-[12.5px] text-slate-800">{r.text}</span> : <span className="text-amber-800">{r.problems.join(' ')}</span>}
                  {r.coinsRounded && <span className="block text-[11px] text-slate-500">Coins {num(r.coinsRounded.from, 4)} written as {r.coinsRounded.to} (2 decimals).</span>}
                  {r.note && <span className="block text-[11px] text-slate-500">{r.note}</span>}
                  {r.issues.length > 0 && <span className="block text-[11px] text-rose-700">{r.issues.map((i) => i.message).join(' ')}</span>}
                </td>
                <td className={`${TD} whitespace-nowrap text-right tabular-nums text-slate-600`}>{r.worth == null ? 'unknown' : num(r.worth, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
