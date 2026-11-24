import { useState } from 'react'
import Card from '../../components/ui/Card'
import { ROUNDING_RULES } from '../../lib/economy/rounding'
import { Num, TD, TH } from './economyUi'

// THE ROUNDING RULES, with where each is used, and a number to try them on.
export default function RulesTab() {
  const [x, setX] = useState(147)
  return (
    <div className="flex flex-col gap-4">
      <Card title="Rounding" subtitle="The sheets' rules, to the exact result. MROUND rounds to the nearest multiple, a half away from zero.">
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Try a number
            <Num aria-label="A number to round" value={x} onCommit={setX} className="w-24" data-testid="economy-rules-x" />
          </label>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" data-dense data-testid="economy-rules">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={TH}>Rule</th>
                  <th className={`${TH} text-right`}>{x} gives</th>
                  <th className={TH}>How</th>
                  <th className={TH}>Used for</th>
                  <th className={TH}>Examples</th>
                </tr>
              </thead>
              <tbody>
                {ROUNDING_RULES.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 align-top text-sm" data-rule={r.id}>
                    <td className={`${TD} whitespace-nowrap font-semibold text-slate-800`}>{r.name}</td>
                    <td className={`${TD} text-right text-base font-bold tabular-nums text-purple-700`} data-cell="result">
                      {Number.isFinite(r.fn(x)) ? r.fn(x) : '-'}
                    </td>
                    <td className={`${TD} text-slate-600`}>{r.rule}</td>
                    <td className={`${TD} text-slate-600`}>{r.usedFor}</td>
                    <td className={`${TD} min-w-[12rem] text-xs tabular-nums text-slate-500`}>
                      {r.examples.map((e) => `${e} → ${r.fn(e)}`).join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500" data-note>
            These are for the prizes on a feature&apos;s tiers (economist). Merge Mania&apos;s small rewards and the Twister keep their own rules.
          </p>
        </div>
      </Card>
    </div>
  )
}
