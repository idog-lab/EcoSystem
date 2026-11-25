import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import Card from '../../components/ui/Card'
import { KEY_LISTS, createKey, isTaught, taughtKey } from '../../lib/economy/economyModel'
import { BUTTON, INPUT, MONO, Num, TD, TH, TaughtMark, TaughtValue, Text } from './economyUi'

const KEY = /^[A-Za-z0-9_\-.]+$/
const SHOWN = 12

// THE KEYS THE GAME KNOWS. Never invented (economist): a preset, pack, chest,
// trigger or allowance bucket is one of these, typed or pasted here. The
// checker names any other as "not on the list".
export default function KeysTab({ economy, onChange }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
      {KEY_LISTS.map((list) => (
        <KeyList key={list.id} list={list} items={economy.keys[list.id] ?? []} onItems={(items) => onChange({ ...economy, keys: { ...economy.keys, [list.id]: items } })} />
      ))}
      <Card title="Chef baskets" subtitle="The Chef__Basic / Rare / Epic presets on the Presets list">
        <p className="text-sm text-slate-600" data-note>
          A Chef basket is worth its tier (Worth tab), unless a worth is typed for its key here. Which kinds exist is the list&apos;s: Basic comes as Undo, Allowance or Free round; Rare as Allowance, Free round or Extra stock; Epic as Extra stock, Wild or Free_round3.
        </p>
      </Card>
    </div>
  )
}

function KeyList({ list, items, onItems }) {
  const [paste, setPaste] = useState('')
  const [message, setMessage] = useState('')
  // A long list (608 packs) is searched, not scrolled: the first SHOWN that match what is typed.
  const [find, setFind] = useState('')
  const needle = find.trim().toLowerCase()
  const matching = items.map((k, i) => ({ k, i })).filter(({ k }) => !needle || k.key.toLowerCase().includes(needle))
  const shown = matching.slice(0, SHOWN)
  const set = (i, patch) => onItems(items.map((k, j) => (j === i ? { ...k, ...patch } : k)))
  // One a line; with a worth after a tab, comma or "=" when the list has one.
  function add() {
    const known = new Set(items.map((k) => k.key))
    const added = []
    const bad = []
    for (const line of paste.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      const [rawKey, rawValue] = line.split(/\t|=|,(?=\s*-?\d)/).map((s) => s?.trim())
      const key = rawKey.replace(new RegExp(`^${list.atom}:`), '')
      if (!KEY.test(key)) {
        bad.push(line)
        continue
      }
      if (known.has(key)) continue
      known.add(key)
      const value = list.valueLabel && rawValue != null && rawValue !== '' && Number.isFinite(Number(rawValue)) ? Number(rawValue) : null
      added.push(createKey({ key, value }))
    }
    onItems([...items, ...added])
    setMessage(`${added.length} added${bad.length ? `; not read: ${bad.slice(0, 3).join(', ')}` : ''}.`)
    setPaste('')
  }
  return (
    <Card title={list.label} subtitle={list.hint}>
      <div className="flex flex-col gap-3" data-key-list={list.id}>
        {items.length > SHOWN && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={`Find among ${items.length}`} aria-label={`Find in ${list.label}`} data-testid={`economy-find-${list.id}`} className={`${INPUT} w-64 font-mono`} />
            <span data-testid={`economy-count-${list.id}`}>
              {matching.length === items.length ? `${items.length} keys` : `${matching.length} of ${items.length} match`}
              {matching.length > SHOWN && `, the first ${SHOWN} shown`}
            </span>
          </div>
        )}
        {items.length > 0 ? (
          <table className="w-full border-collapse" data-dense>
            <thead>
              <tr className="border-b border-slate-200">
                <th className={`${TH} w-8`} />
                <th className={TH}>Key</th>
                {list.valueLabel && <th className={`${TH} text-center`}>{list.valueLabel}</th>}
                <th className={TH}>Note</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ k, i }) => {
                const taught = taughtKey(list.id, k.key)
                return (
                  <tr key={`${k.key}-${i}`} className="border-b border-slate-100 text-sm" data-key={k.key}>
                    <td className={`${TD} w-8`}>
                      {!taught && (
                        <button type="button" aria-label={`Remove ${k.key}`} title={`Remove ${k.key}`} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => onItems(items.filter((_, j) => j !== i))}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                    <td className={`${TD} ${MONO} text-slate-800`}>
                      {k.key}
                      {taught && !isTaught(taught, 'value') && <TaughtMark taught={taught} />}
                    </td>
                    {list.valueLabel && (
                      <td className={`${TD} text-center`}>
                        {isTaught(taught, 'value') ? (
                          <TaughtValue value={k.value} taught={taught} label={`${k.key}: ${list.valueLabel}`} />
                        ) : (
                          <Num aria-label={`${k.key}: ${list.valueLabel}`} value={k.value} allowEmpty onCommit={(v) => set(i, { value: v })} className="w-20" placeholder="not set" />
                        )}
                      </td>
                    )}
                    <td className={TD}>
                      {isTaught(taught, 'note') ? <span className="text-[12px] text-slate-600">{k.note}</span> : <Text aria-label={`${k.key}: note`} value={k.note} onCommit={(v) => set(i, { note: v })} className="w-40" />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-500">None yet.</p>
        )}
        <div className="flex flex-col gap-2">
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={2} placeholder={list.valueLabel ? 'One a line - a worth after a tab if known' : 'One a line'} aria-label={`Add to ${list.label}`} className={`${INPUT} font-mono`} data-testid={`economy-paste-${list.id}`} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BUTTON} onClick={add} disabled={!paste.trim()} data-testid={`economy-add-${list.id}`}>
              Add
            </button>
            {message && <span className="text-xs text-slate-500">{message}</span>}
          </div>
        </div>
      </div>
    </Card>
  )
}
