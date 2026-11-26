import { useState } from 'react'
import { REGULAR_PIECES } from '../engine/model'
import { averageDamage } from '../engine/maleficent'
import { FIRST_PUZZLE, RC_CLAUSES, rcSegmentRows, rcWindowStrings, regularDefinition, regularKey } from '../engine/segments'
import { boardOrder, newOrders } from '../engine/shuffle'
import { Btn, Label, Note, Num, Panel, Table, Text } from './kit'
import { fmt, td } from './format'
import { usePuzzle } from './shared'

export function StepMechanics() {
  const { ev, phase } = usePuzzle()
  return (
    <div className="flex flex-col gap-4">
      {ev.setup.mode === 'price-cut' && <PriceCut />}
      {ev.setup.mode === 'maleficent' && <Maleficent />}
      {ev.setup.mode === 'standard' && <Note>Standard event: no Price Cut and no Maleficent. The segment rules and the piece order below are used by every mode.</Note>}
      {phase === 'regular' ? <RegularSegments /> : <RcSegments />}
      <PieceOrder />
    </div>
  )
}

function PriceCut() {
  const { ev, edit } = usePuzzle()
  return (
    <Panel title="Price Cut" subtitle="Extra difficulty on these boards; rewards stay the same. Both the regular and the price-cut prices are exported.">
      <div className="flex flex-wrap gap-4">
        {(['tier5', 'tier6', 'rcTier3'] as const).map((k) => (
          <label key={k}>
            <Label>{{ tier5: 'Board 5', tier6: 'Board 6', rcTier3: 'RC board 3' }[k]}</Label>
            <Num value={ev.priceCut[k]} scale={100} suffix="%" min={0} onChange={(v) => edit((e) => void (e.priceCut[k] = v!))} />
          </label>
        ))}
      </div>
    </Panel>
  )
}

function Maleficent() {
  const { ev, edit, results, phase, segment } = usePuzzle()
  const rc = phase === 'rc'
  const tiers = rc ? ev.maleficent.rcTiers : ev.maleficent.tiers
  const wheels = rc ? ev.maleficent.rcWheel : ev.maleficent.regularWheel
  const boss = rc ? results.rc[segment - 1]!.boss : results.regular[segment - 1]!.boss
  const [open, setOpen] = useState(0)
  const key = rc ? 'rcTiers' : 'tiers'
  const wkey = rc ? 'rcWheel' : 'regularWheel'
  const w = wheels[open]!
  return (
    <>
      <Panel title={`Maleficent: ${rc ? 'RC' : 'regular'} boards`} subtitle="Difficulty: share of the board's DR the boss asks for. Removal: share of the board's DR the removed pieces add up to.">
        <Table head={['Board', 'Boss', 'Difficulty', 'Removal', 'Boss Bar', 'Removed (positions)', 'Removed DR', 'Gap vs target', 'Buckets']}>
          {tiers.map((t, i) => {
            const b = boss?.[i]
            return (
              <tr key={i} className={open === i ? 'bg-purple-50/50' : ''} onClick={() => setOpen(i)}>
                <td className={td}>{i + 1}</td>
                <td className={td}>
                  <input type="checkbox" checked={t.active} onChange={(e) => edit((x) => void (x.maleficent[key][i]!.active = e.target.checked))} />
                </td>
                <td className={td}>
                  <Num width="w-14" min={0} max={100} value={t.difficulty} suffix="%" onChange={(v) => edit((x) => void (x.maleficent[key][i]!.difficulty = v!))} />
                </td>
                <td className={td}>
                  <Num width="w-14" min={0} max={100} value={t.removal} suffix="%" onChange={(v) => edit((x) => void (x.maleficent[key][i]!.removal = v!))} />
                </td>
                <td className={td} data-testid={`boss-bar-${i + 1}`}>{b?.bossBar ?? ''}</td>
                <td className={td}>{b?.removedItems ?? ''}</td>
                <td className={td}>{b?.removal ? fmt(b.removal.droppedTotal) : ''}</td>
                <td className={td}>{b?.removal ? fmt(b.removal.gap) : ''}</td>
                <td className={td}>{b?.buckets ?? ''}</td>
              </tr>
            )
          })}
        </Table>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label>
            <Label hint="The cheapest pieces never removed, unless the target is more than all the others.">Cheap pieces kept</Label>
            <Num value={ev.maleficent.cheapKept} min={0} digits={0} onChange={(v) => edit((x) => void (x.maleficent.cheapKept = Math.round(v!)))} />
          </label>
          <p className="text-xs text-slate-500" data-note>
            Boss Bar = average of the typed non-zero spin damage x the board's DR x difficulty, rounded up to the tens - as the workbook does; no other model of the wheel is used. Removed Items are
            the pieces' places in the shuffled board.
          </p>
        </div>
      </Panel>
      <Panel title={`Board ${open + 1}: wheel and spins`} subtitle="Click a board above to edit its wheel. Each spin: its bucket and the damage typed for it (the Boss Bar's helper series).">
        <div className="grid gap-3 sm:grid-cols-5">
          {(['wheelLayout', 'extraBuckets', 'extraWheelLayout', 'wheelMultiplier', 'bossReward'] as const).map((k) => (
            <label key={k}>
              <Label>{{ wheelLayout: 'Wheel layout', extraBuckets: 'Extra buckets', extraWheelLayout: 'Extra wheel layout', wheelMultiplier: 'Wheel multiplier', bossReward: 'Boss reward' }[k]}</Label>
              <Text value={w[k]} onChange={(v) => edit((x) => void (x.maleficent[wkey][open]![k] = v.trim()))} />
            </label>
          ))}
        </div>
        <div className="mt-3">
          <Table head={['Spin', 'Bucket', 'Wedges', 'Damage', '']}>
            {w.spins.map((s, i) => (
              <tr key={i}>
                <td className={td}>{i + 1}</td>
                <td className={td}>
                  <Num width="w-14" digits={0} value={s.bucket} onChange={(v) => edit((x) => void (x.maleficent[wkey][open]!.spins[i]!.bucket = Math.round(v!)))} />
                </td>
                <td className={td}>{ev.maleficent.buckets.find((b) => b.id === s.bucket)?.wedges ?? <span className="text-red-600">no such bucket</span>}</td>
                <td className={td}>
                  <Num width="w-14" value={s.damage} onChange={(v) => edit((x) => void (x.maleficent[wkey][open]!.spins[i]!.damage = v!))} />
                </td>
                <td className={td}>
                  <Btn small variant="ghost" onClick={() => edit((x) => void x.maleficent[wkey][open]!.spins.splice(i, 1))}>
                    Remove
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
          <div className="mt-2 flex items-center gap-3">
            <Btn small onClick={() => edit((x) => void x.maleficent[wkey][open]!.spins.push({ bucket: w.spins[w.spins.length - 1]?.bucket ?? 1, damage: 0 }))}>Add a spin</Btn>
            <span className="text-xs text-slate-500">Average non-zero damage: {fmt(averageDamage(w.spins), 4)}</span>
          </div>
        </div>
      </Panel>
      <Panel title="Buckets and wedges" subtitle='A bucket lists wedges, "(n)" for several of one ("S_S(2),S_M"). Exported to the Wheel Buckets and Wheel Wedges tabs.'>
        <div className="grid gap-4 lg:grid-cols-2">
          <Table head={['Bucket', 'Wedges', '']}>
            {ev.maleficent.buckets.map((b, i) => (
              <tr key={i}>
                <td className={td}>{b.id}</td>
                <td className={td}>
                  <Text width="w-64" value={b.wedges} onChange={(v) => edit((x) => void (x.maleficent.buckets[i]!.wedges = v))} />
                </td>
                <td className={td}>
                  <Btn small variant="ghost" onClick={() => edit((x) => void x.maleficent.buckets.splice(i, 1))}>
                    Remove
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
          <Table head={['Wedge', 'Name', 'Value']}>
            {ev.maleficent.wedges.map((x, i) => (
              <tr key={i}>
                <td className={td}>
                  <Text width="w-16" value={x.id} onChange={(v) => edit((e) => void (e.maleficent.wedges[i]!.id = v.trim()))} />
                </td>
                <td className={td}>
                  <Text width="w-36" value={x.name} onChange={(v) => edit((e) => void (e.maleficent.wedges[i]!.name = v.trim()))} />
                </td>
                <td className={td}>
                  <Num width="w-14" value={x.value} onChange={(v) => edit((e) => void (e.maleficent.wedges[i]!.value = v!))} />
                </td>
              </tr>
            ))}
          </Table>
        </div>
        <div className="mt-2">
          <Btn small onClick={() => edit((x) => void x.maleficent.buckets.push({ id: Math.max(0, ...x.maleficent.buckets.map((b) => b.id)) + 1, wedges: '' }))}>Add a bucket</Btn>
        </div>
        {ev.maleficent.layouts.length === 0 && <Note>Wheel layouts and multipliers are not edited here yet: the template's own tabs are kept as they are.</Note>}
      </Panel>
    </>
  )
}

function RegularSegments() {
  const { ev, edit } = usePuzzle()
  const bounds = ev.segmentation.membershipMax
  return (
    <Panel title="Who is in which segment" subtitle="70% of the 3-day + 30% of the 14-day daily brut wins (modes weighted 1, 2, 4, 8), and having played a puzzle before. This is not Wins for Economy.">
      <Table head={['Segment', 'Upper bound', 'Key', 'Definition']}>
        {bounds.map((b, i) => (
          <tr key={i}>
            <td className={td}>{i + 1}</td>
            <td className={td}>{i < 8 ? <Num width="w-16" min={0} value={b} onChange={(v) => edit((e) => void (e.segmentation.membershipMax[i] = v))} /> : 'none'}</td>
            <td className={`${td} font-mono text-[11px]`}>{regularKey(i + 1)}</td>
            <td className="border-b border-slate-100 px-2 py-1 font-mono text-[11px] text-slate-600 [overflow-wrap:anywhere]">{regularDefinition(bounds, i + 1)}</td>
          </tr>
        ))}
        <tr>
          <td className={td}>first</td>
          <td className={td} />
          <td className={`${td} font-mono text-[11px]`}>{FIRST_PUZZLE.key}</td>
          <td className="border-b border-slate-100 px-2 py-1 font-mono text-[11px] text-slate-600">{FIRST_PUZZLE.definition}</td>
        </tr>
      </Table>
      <p className="mt-2 text-xs text-slate-500" data-note>
        The keys end in "_V2_Boost" as the game knows them; that does not turn Boost on.
      </p>
      <div className="mt-4">
        <Label>First-puzzle players by time (fresh dates for this event, UTC)</Label>
        <Table head={['Key', 'From', 'Until (blank = open)', 'Economy note', '']}>
          {ev.segmentation.firstPuzzle.map((r, i) => (
            <tr key={i}>
              <td className={td}>
                <Text width="w-56" value={r.key} onChange={(v) => edit((e) => void (e.segmentation.firstPuzzle[i]!.key = v.trim()))} />
              </td>
              {(['from', 'to'] as const).map((k) => (
                <td key={k} className={td}>
                  <input type="datetime-local" step={1} className="rounded-lg border border-slate-200 px-2 py-1 text-sm" value={r[k]} onChange={(e) => edit((x) => void (x.segmentation.firstPuzzle[i]![k] = e.target.value))} />
                </td>
              ))}
              <td className={td}>
                <Text width="w-28" value={r.economySegmentNote} onChange={(v) => edit((e) => void (e.segmentation.firstPuzzle[i]!.economySegmentNote = v))} />
              </td>
              <td className={td}>
                <Btn small variant="ghost" onClick={() => edit((e) => void e.segmentation.firstPuzzle.splice(i, 1))}>
                  Remove
                </Btn>
              </td>
            </tr>
          ))}
        </Table>
        <Btn small onClick={() => edit((e) => void e.segmentation.firstPuzzle.push({ key: '', from: '', to: '', economySegmentNote: '' }))}>Add a time rule</Btn>
      </div>
    </Panel>
  )
}

function RcSegments() {
  const { ev, edit } = usePuzzle()
  const at = rcWindowStrings(ev)
  const rows = rcSegmentRows(ev)
  const text = (c: (typeof RC_CLAUSES)[number][number]) =>
    `${c.lo != null ? `more than ${c.lo}` : ''}${c.lo != null && c.hi != null ? ' and ' : ''}${c.hi != null ? `at most ${c.hi}` : ''}${c.after != null ? `, after ${at[c.after]}` : ''}${c.until != null ? `, until ${at[c.until]}` : ''}`
  return (
    <Panel title="Recompletion segments" subtitle="The same brut-wins measure, crossed with time windows that open across the event (> opens, <= closes).">
      <label className="mb-3 block">
        <Label hint="The windows start from the start date plus this many hours (workbook: 10).">Windows start at hour (UTC)</Label>
        <Num value={ev.segmentation.rcHourOffset} min={0} max={23} onChange={(v) => edit((e) => void (e.segmentation.rcHourOffset = v!))} />
      </label>
      <Table head={['RC segment', 'In it when', 'Exported definition']}>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className={`${td} font-mono text-[11px]`}>{r.key}</td>
            <td className="border-b border-slate-100 px-2 py-1 text-xs text-slate-700">
              {r.clauses.map((c, j) => (
                <div key={j}>{text(c)}</div>
              ))}
            </td>
            <td className="border-b border-slate-100 px-2 py-1">
              <pre className="whitespace-pre-wrap font-mono text-[10px] text-slate-500">{r.definition}</pre>
            </td>
          </tr>
        ))}
      </Table>
    </Panel>
  )
}

function PieceOrder() {
  const { ev, edit } = usePuzzle()
  const [confirm, setConfirm] = useState(false)
  return (
    <Panel
      title="Piece order"
      subtitle="Saved with the event: opening or recalculating never changes it. Board 1 starts with its cheapest piece."
      action={
        confirm ? (
          <span className="flex items-center gap-2">
            <span className="text-xs text-slate-600">New order for every board and every RC segment?</span>
            <Btn small variant="primary" testId="reshuffle-confirm" onClick={() => (edit((e) => void (e.order = newOrders(Math.floor(Math.random() * 2 ** 31)))), setConfirm(false))}>
              Shuffle
            </Btn>
            <Btn small variant="ghost" onClick={() => setConfirm(false)}>
              Keep
            </Btn>
          </span>
        ) : (
          <Btn small testId="reshuffle" onClick={() => setConfirm(true)}>
            Shuffle again
          </Btn>
        )
      }
    >
      <Table head={['Board', 'Pieces written in this order (1 = cheapest)']}>
        {REGULAR_PIECES.map((n, i) => (
          <tr key={i}>
            <td className={td}>{i + 1}</td>
            <td className={`${td} font-mono text-xs`} data-testid={`order-${i + 1}`}>{boardOrder(ev.order.regular, n).join(', ')}</td>
          </tr>
        ))}
      </Table>
      <p className="mt-2 text-xs text-slate-500" data-note>
        RC segments have an order each. A new shuffle recomputes Maleficent's Removed Items (the same pieces, at their new places).
      </p>
    </Panel>
  )
}
