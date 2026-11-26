import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import Card from '../../components/ui/Card'
import { KEY_LISTS, PRESET_GROUPS, createKey, isTaught, presetGroup, taughtKey } from '../../lib/economy/economyModel'
import { BUTTON, INPUT, MONO, Num, TD, TH, TaughtMark, TaughtValue, Text } from './economyUi'

const KEY = /^[A-Za-z0-9_\-.]+$/
const SHOWN = 12

// The groups the tab shows one at a time (economist, 26 Nov 2026: "i want us to break the options for chef, stickers,
// puzzle, magical friend, diamond mine/merge and others"): the presets by their group (economyModel PRESET_GROUPS),
// the packs, then the chests, triggers and allowance buckets.
const groupLabel = (id) => PRESET_GROUPS.find((g) => g.id === id)?.label ?? id
const VIEWS = [
  { id: 'chef', list: 'presets', group: 'chef', label: 'Chef' },
  { id: 'packs', list: 'packs', label: 'Sticker packs' },
  { id: 'puzzle', list: 'presets', group: 'puzzle', label: 'Puzzle' },
  { id: 'mf', list: 'presets', group: 'mf', label: 'Magical friends' },
  { id: 'mini-game', list: 'presets', group: 'mini-game', label: 'Diamond Mine / Merge' },
  { id: 'other', list: 'presets', group: 'other', label: 'Other presets' },
  { id: 'chests', list: 'chests', label: 'Chests' },
  { id: 'triggers', list: 'triggers', label: 'Triggers' },
  { id: 'buckets', list: 'buckets', label: 'Allowance buckets' },
]
const inView = (view) => (k) => !view.group || presetGroup(k.key) === view.group

// THE KEYS THE GAME KNOWS. Never invented (economist): a preset, pack, chest,
// trigger or allowance bucket is one of these, typed or pasted here. The
// checker names any other as "not on the list".
export default function KeysTab({ economy, onChange }) {
  const [viewId, setViewId] = useState('chef')
  const view = VIEWS.find((v) => v.id === viewId) ?? VIEWS[0]
  const list = KEY_LISTS.find((l) => l.id === view.list)
  const count = (v) => (economy.keys[v.list] ?? []).filter(inView(v)).length
  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap gap-1.5" aria-label="Groups of keys" data-testid="economy-key-groups">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" aria-pressed={v.id === view.id} onClick={() => setViewId(v.id)} data-key-view={v.id} className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${v.id === view.id ? 'bg-slate-800 text-white' : 'bg-white/80 text-slate-600 ring-1 ring-slate-200/70 hover:text-purple-700'}`}>
            {v.label} <span className={`ml-1 text-xs font-medium ${v.id === view.id ? 'text-slate-300' : 'text-slate-400'}`}>{count(v)}</span>
          </button>
        ))}
      </nav>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start">
        <KeyList key={view.id} list={list} view={view} items={economy.keys[list.id] ?? []} onItems={(items) => onChange({ ...economy, keys: { ...economy.keys, [list.id]: items } })} />
        {view.id === 'chef' && (
          <Card title="Chef baskets" subtitle="The Chef__Basic / Rare / Epic presets of this group">
            <p className="text-sm text-slate-600" data-note>
              A Chef basket is worth its tier (Worth tab), unless a worth is typed for its key here. Which kinds exist is the list&apos;s: Basic comes as Undo, Allowance or Free round; Rare as Allowance, Free round or Extra stock; Epic as Extra stock, Wild or Free_round3.
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}

function KeyList({ list, view, items, onItems }) {
  const [paste, setPaste] = useState('')
  const [message, setMessage] = useState('')
  // A long list (608 packs, about 1,000 magical friends) is searched, not scrolled: the first SHOWN that match what is typed.
  const [find, setFind] = useState('')
  const needle = find.trim().toLowerCase()
  const inThis = inView(view)
  const total = items.filter(inThis).length
  const matching = items.map((k, i) => ({ k, i })).filter(({ k }) => inThis(k) && (!needle || k.key.toLowerCase().includes(needle)))
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
    // A preset pasted here that belongs to another group is kept, and shown there.
    const elsewhere = view.group ? [...new Set(added.map((k) => presetGroup(k.key)).filter((g) => g !== view.group))] : []
    setMessage(`${added.length} added${elsewhere.length ? ` (some show under ${elsewhere.map(groupLabel).join(', ')})` : ''}${bad.length ? `; not read: ${bad.slice(0, 3).join(', ')}` : ''}.`)
    setPaste('')
  }
  return (
    <Card title={view.label} subtitle={list.hint}>
      <div className="flex flex-col gap-3" data-key-list={list.id} data-key-view={view.id}>
        {total > SHOWN && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={`Find among ${total}`} aria-label={`Find in ${view.label}`} data-testid={`economy-find-${view.id}`} className={`${INPUT} w-64 font-mono`} />
            <span data-testid={`economy-count-${view.id}`}>
              {matching.length === total ? `${total} keys` : `${matching.length} of ${total} match`}
              {matching.length > SHOWN && `, the first ${SHOWN} shown`}
            </span>
          </div>
        )}
        {total > 0 ? (
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
