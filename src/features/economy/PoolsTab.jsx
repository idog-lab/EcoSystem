import Card from '../../components/ui/Card'
import SheetGrid from '../../components/SheetGrid'
import { POOL_LISTS, chefBasketKeys, normalizePools } from '../../lib/economy/economyModel'

// THE POOLS (economist, 28 Nov 2026: "we should give pools or chests, for which we put and in what gameplay and this is
// how it will pick it"; "those pools should be hard coded in a different section for the album"): the sticker packs of
// the album and the Chef baskets a feature's economy builder may give, each with the gameplay sections it is for. A new
// row is typed in the empty last one; Delete on its key takes it out. Kept on the Economy page, for every feature.
const SECTIONS = [
  { id: 'easy', label: 'Easy' },
  { id: 'mid', label: 'Mid' },
  { id: 'hard', label: 'Hard', sub: 'Final Prize' },
]

function Pool({ economy, onChange, pool }) {
  const rows = economy.pools?.[pool.id] ?? []
  const keys = pool.id === 'baskets' ? chefBasketKeys(economy) : (economy.keys?.packs ?? []).map((k) => k.key)
  const sheetRows = [...rows.map((r, i) => ({ id: `${pool.id}-${i}`, i, ...r })), { id: `${pool.id}-new`, i: rows.length, key: '', easy: false, mid: false, hard: false }]
  const columns = [
    {
      key: 'key',
      label: pool.id === 'baskets' ? 'Basket' : 'Sticker pack',
      sub: 'type to search',
      width: 300,
      type: 'text',
      editable: true,
      value: (r) => r.key,
      suggestions: () => keys,
      check: (_, v) => (v && !keys.includes(v) ? `"${v}" is not on the Economy page's ${pool.id === 'baskets' ? 'Chef baskets' : 'sticker packs'}` : null),
      tone: () => 'font-mono text-[12px]',
    },
    ...SECTIONS.map((s) => ({ key: s.id, label: s.label, sub: s.sub, width: 70, type: 'toggle', align: 'right', editable: (r) => !!r.key, value: (r) => !!r[s.id] })),
  ]
  const commit = (changes) => {
    let next = [...rows]
    for (const { row, key, value } of changes) {
      if (key === 'key') {
        if (!value) {
          if (row.i < next.length) next[row.i] = null
        } else if (row.i >= next.length) next.push({ key: value, easy: true, mid: true, hard: true })
        else next[row.i] = { ...next[row.i], key: value }
      } else if (row.i < next.length && next[row.i]) next[row.i] = { ...next[row.i], [key]: !!value }
    }
    onChange({ ...economy, pools: normalizePools({ ...economy.pools, [pool.id]: next.filter(Boolean) }) })
  }
  return (
    <Card title={pool.label}>
      <SheetGrid testid={`pool-${pool.id}`} columns={columns} rows={sheetRows} onCommit={commit} />
    </Card>
  )
}

export default function PoolsTab({ economy, onChange }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start" data-testid="economy-pools">
      {POOL_LISTS.map((p) => (
        <Pool key={p.id} economy={economy} onChange={onChange} pool={p} />
      ))}
    </div>
  )
}
