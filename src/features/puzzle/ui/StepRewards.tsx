import type { PackAlt, RegularTierReward } from '../engine/model'
import { Label, Note, Num, Panel, Table, Text } from './kit'
import { fmt, td } from './format'
import { usePuzzle } from './shared'

const ALT_KINDS: { value: PackAlt['kind']; label: string }[] = [
  { value: 'coins', label: 'coins' },
  { value: 'wild', label: 'wild' },
  { value: 'stock', label: 'extra stock' },
  { value: 'undo', label: 'undo' },
  { value: 'freeRound', label: 'free round' },
]

export function StepRewards() {
  const { phase } = usePuzzle()
  return phase === 'rc' ? <RcRewards /> : <RegularRewards />
}

function RegularRewards() {
  const { ev, edit, results, segment } = usePuzzle()
  const tiers = ev.rewards.regular[segment - 1]!
  const rows = results.regular[segment - 1]!.rewards
  const set = (i: number, fn: (t: RegularTierReward) => void) => edit((e) => fn(e.rewards.regular[segment - 1]![i]!))
  const numCols: { key: keyof RegularTierReward; label: string; digits?: number }[] = [
    { key: 'coins', label: 'Coins', digits: 2 },
    { key: 'stock', label: 'Extra stock' },
    { key: 'wild', label: 'Wild' },
    { key: 'undo', label: 'Undo' },
    { key: 'freeRound', label: 'Free round' },
    { key: 'drAmount', label: 'dr-puzzle' },
  ]
  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={`Segment ${segment}: what each board gives`}
        subtitle="The target is typed by you and only compared - nothing changes a reward by itself. A board's dr-puzzle is also added to the next board's price."
        testId="rewards-editor"
      >
        <Table head={['Board', ...numCols.map((c) => c.label), 'Pack', 'Pack instead', 'Basket preset', 'Basket worth', 'Discount', 'Extra presets']}>
          {tiers.map((t, i) => (
            <tr key={i}>
              <td className={td}>{i + 1}</td>
              {numCols.map((c) => (
                <td key={c.key} className={td}>
                  <Num testId={`reward-${i + 1}-${c.key}`} width="w-16" min={0} digits={c.digits ?? 2} value={t[c.key] as number} onChange={(v) => set(i, (x) => void ((x[c.key] as number) = v!))} />
                </td>
              ))}
              <td className={td}>
                <Text width="w-56" value={t.packKey} onChange={(v) => set(i, (x) => void (x.packKey = v.trim()))} />
              </td>
              <td className={td}>
                <span className="inline-flex items-center gap-1">
                  <Num width="w-14" min={0} value={t.packAlt.amount} onChange={(v) => set(i, (x) => void (x.packAlt.amount = v!))} />
                  <select className="rounded-lg border border-slate-200 px-1 py-1 text-xs" value={t.packAlt.kind} onChange={(e) => set(i, (x) => void (x.packAlt.kind = e.target.value as PackAlt['kind']))}>
                    {ALT_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </span>
              </td>
              <td className={td}>
                <Text width="w-56" value={t.basketKey} onChange={(v) => set(i, (x) => void (x.basketKey = v.trim()))} />
              </td>
              <td className={td}>
                <Num width="w-14" min={0} value={t.basketValue} onChange={(v) => set(i, (x) => void (x.basketValue = v!))} />
              </td>
              <td className={td}>
                <Num width="w-14" min={0} max={1} scale={100} suffix="%" value={t.discount} onChange={(v) => set(i, (x) => void (x.discount = v!))} />
              </td>
              <td className={td}>
                <Text width="w-48" placeholder="preset keys, comma between" value={t.extraPresets.join(', ')} onChange={(v) => set(i, (x) => void (x.extraPresets = v.split(',').map((s) => s.trim()).filter(Boolean)))} />
              </td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-slate-500" data-note>
          Worth in allowance: coin 1, wild 2.5, extra stock 2, undo 0.25, free round 1, plus the basket's worth; the discount only lowers the worth used here. Extra presets are written after the
          resources, the way a reference template has "preset:puzzle_tier_end_N" (where they sit next to a dr-puzzle reward is not confirmed).
        </p>
      </Panel>
      <Panel title="Target and actual worth" testId="rewards-compare">
        <Table head={['Board', 'Effort worth', 'Target', 'Actual', 'Difference', 'Reward text']}>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className={td}>{r.tier}</td>
              <td className={td} title="Total DR without inflation x piece worth x the board's effort share (workbook column Q).">
                {fmt(r.effortWorth, 2)}
              </td>
              <td className={td}>
                <Num testId={`target-${i + 1}`} width="w-20" allowBlank min={0} value={ev.rewards.targets[segment - 1]![i]!} onChange={(v) => edit((e) => void (e.rewards.targets[segment - 1]![i] = v))} />
              </td>
              <td className={td} data-testid={`actual-${i + 1}`}>{fmt(r.actual, 3)}</td>
              <td className={`${td} ${r.gap == null ? 'text-slate-400' : r.gap < 0 ? 'text-amber-700' : 'text-emerald-700'}`} data-testid={`gap-${i + 1}`}>
                {r.gap == null ? 'no target' : `${r.gap > 0 ? '+' : ''}${fmt(r.gap, 3)}`}
              </td>
              <td className="border-b border-slate-100 px-2 py-1 font-mono text-[11px] text-slate-600 [overflow-wrap:anywhere]">{r.syntax}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  )
}

function RcRewards() {
  const { ev, edit, results, segment } = usePuzzle()
  const seg = results.rc[segment - 1]!
  return (
    <div className="flex flex-col gap-4">
      <Panel title="RC boards: rewards (the same in every RC segment)" subtitle="Coins are worked out per segment from the board's value and capped by the regular puzzle's prize.">
        <Table head={['Board', 'Extra stock', 'Wild', 'Undo', 'Free round', 'dr-puzzle', 'Pack', 'Pack instead', 'Basket preset', 'Basket worth', 'Milestone', 'Trigger', 'Cap from board']}>
          {ev.rc.tiers.map((t, i) => (
            <tr key={i}>
              <td className={td}>{i + 1}</td>
              {(['stock', 'wild', 'undo', 'freeRound', 'drAmount'] as const).map((k) => (
                <td key={k} className={td}>
                  <Num width="w-14" min={0} value={t[k]} onChange={(v) => edit((e) => void (e.rc.tiers[i]![k] = v!))} />
                </td>
              ))}
              <td className={td}>
                <Text width="w-56" value={t.packKey} onChange={(v) => edit((e) => void (e.rc.tiers[i]!.packKey = v.trim()))} />
              </td>
              <td className={td}>
                <Text width="w-40" value={t.packAlt} onChange={(v) => edit((e) => void (e.rc.tiers[i]!.packAlt = v.trim()))} />
              </td>
              <td className={td}>
                <Text width="w-56" value={t.basketKey} onChange={(v) => edit((e) => void (e.rc.tiers[i]!.basketKey = v.trim()))} />
              </td>
              <td className={td}>
                <Num width="w-14" min={0} value={t.basketValue} onChange={(v) => edit((e) => void (e.rc.tiers[i]!.basketValue = v!))} />
              </td>
              <td className={td}>
                <input type="checkbox" checked={t.milestone} onChange={(e) => edit((x) => void (x.rc.tiers[i]!.milestone = e.target.checked))} />
              </td>
              <td className={td}>
                <Text width="w-28" value={t.trigger} onChange={(v) => edit((e) => void (e.rc.tiers[i]!.trigger = v.trim()))} />
              </td>
              <td className={td}>
                <Num width="w-12" min={1} max={6} digits={0} value={t.matchTier} onChange={(v) => edit((e) => void (e.rc.tiers[i]!.matchTier = Math.round(v!)))} />
              </td>
            </tr>
          ))}
        </Table>
        <div className="mt-3 flex flex-wrap gap-4">
          <label>
            <Label hint="An RC board's coins are at most this x the coins of the matching regular board (segments above 9 use segment 9).">Coins cap (x regular prize)</Label>
            <Num value={ev.rc.cap} min={0} onChange={(v) => edit((e) => void (e.rc.cap = v!))} />
          </label>
        </div>
      </Panel>
      <Panel title={`RC segment ${segment}: worth, coins and reward text`} testId="rc-rewards">
        <Table head={['Board', 'Board value', 'Other rewards', 'Coins before cap', 'Cap', 'Coins', 'Reward text']}>
          {seg.tiers.map((t) => (
            <tr key={t.tier}>
              <td className={td}>{t.tier}</td>
              <td className={td}>{fmt(t.tierValue, 3)}</td>
              <td className={td}>{fmt(t.otherWorth, 2)}</td>
              <td className={td}>{fmt(t.coinsBeforeCap, 1)}</td>
              <td className={td}>{fmt(t.cap, 1)}</td>
              <td className={td}>{fmt(t.coins, 1)}</td>
              <td className="border-b border-slate-100 px-2 py-1 font-mono text-[11px] text-slate-600 [overflow-wrap:anywhere]">{t.syntax}</td>
            </tr>
          ))}
        </Table>
        {seg.tiers.some((t) => t.capFactor < 1) && <Note tone="amber">The cap lowered this segment's coins on at least one board.</Note>}
      </Panel>
    </div>
  )
}
