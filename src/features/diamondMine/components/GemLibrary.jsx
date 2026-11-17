import { useState } from 'react'
import { Gem, Plus, Trash2, Copy } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import GemShapeIcon from './GemShapeIcon'
import { createGem, isGemLocked } from '../lib/gem'

const DEFAULT_NEW_COLOR = '#0ea5e9'

const miniInput =
  'w-12 border border-slate-200 rounded-lg px-1.5 py-1 text-xs text-slate-800 font-medium bg-white/70 focus:outline-none focus:ring-4 focus:ring-purple-200/60 focus:border-purple-400 transition-shadow disabled:opacity-50 disabled:cursor-not-allowed'

export default function GemLibrary({ gems, boards, onAdd, onUpdate, onDelete, onDuplicate }) {
  const [draft, setDraft] = useState({ name: '', rows: 1, cols: 1, color: DEFAULT_NEW_COLOR })

  function handleAdd() {
    if (!draft.name.trim()) return
    onAdd(createGem(draft.name.trim(), Math.max(1, draft.rows), Math.max(1, draft.cols), draft.color))
    setDraft({ name: '', rows: 1, cols: 1, color: DEFAULT_NEW_COLOR })
  }

  return (
    <div className="flex flex-col gap-6 flex-1">
      <Card
        title="Add a gem"
        subtitle="Each gem is a fixed rows x cols block — rotate it per-placement on a board"
        icon={Gem}
      >
        <div className="flex items-end gap-3 flex-wrap">
          <label className="text-sm flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Name</span>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="e.g. n"
              className="border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-medium bg-white/70 focus:outline-none focus:ring-4 focus:ring-purple-200/60 focus:border-purple-400 transition-shadow w-32"
            />
          </label>
          <label className="text-sm flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rows</span>
            <input
              type="number"
              min={1}
              max={8}
              value={draft.rows}
              onChange={(e) => setDraft((d) => ({ ...d, rows: Number(e.target.value) || 1 }))}
              className={miniInput}
            />
          </label>
          <label className="text-sm flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cols</span>
            <input
              type="number"
              min={1}
              max={8}
              value={draft.cols}
              onChange={(e) => setDraft((d) => ({ ...d, cols: Number(e.target.value) || 1 }))}
              className={miniInput}
            />
          </label>
          <label className="text-sm flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Color</span>
            <input
              type="color"
              value={draft.color}
              onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
              className="w-12 h-[2.15rem] rounded-xl border border-slate-200 cursor-pointer"
            />
          </label>
          <GemShapeIcon gem={draft} cellSize={12} />
          <Button variant="primary" icon={Plus} onClick={handleAdd}>
            Add gem
          </Button>
        </div>
      </Card>

      <Card title="Gem library" subtitle={`${gems.length} gem type${gems.length === 1 ? '' : 's'}`} icon={Gem}>
        {gems.length === 0 ? (
          <p className="text-sm text-slate-400">No gems yet — add one above.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {gems.map((gem) => {
              const locked = isGemLocked(gem.id, boards)
              return (
                <div key={gem.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/70 p-3">
                  <GemShapeIcon gem={gem} cellSize={10} />
                  <div className="flex-1 min-w-0">
                    <input
                      type="text"
                      value={gem.name}
                      onChange={(e) => onUpdate(gem.id, { name: e.target.value })}
                      className="text-sm font-semibold text-slate-800 bg-transparent border-none outline-none w-full px-0 focus:ring-0"
                    />
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <input
                        type="number"
                        min={1}
                        max={8}
                        disabled={locked}
                        value={gem.rows}
                        onChange={(e) => onUpdate(gem.id, { rows: Math.max(1, Number(e.target.value) || 1) })}
                        className={miniInput}
                      />
                      <span className="text-xs text-slate-400">×</span>
                      <input
                        type="number"
                        min={1}
                        max={8}
                        disabled={locked}
                        value={gem.cols}
                        onChange={(e) => onUpdate(gem.id, { cols: Math.max(1, Number(e.target.value) || 1) })}
                        className={miniInput}
                      />
                      <input
                        type="color"
                        value={gem.color}
                        onChange={(e) => onUpdate(gem.id, { color: e.target.value })}
                        className="w-6 h-6 rounded border border-slate-200 cursor-pointer"
                      />
                      {locked && (
                        <span className="text-[10px] text-amber-600 font-semibold" title="Placed on a board already — size is locked. Duplicate it to make a new, editable gem.">
                          placed · size locked
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center">
                    <button
                      type="button"
                      title="Duplicate as new gem"
                      onClick={() => onDuplicate(gem.id)}
                      className="p-1.5 rounded-md text-slate-400 hover:text-purple-600 hover:bg-purple-50"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      onClick={() => onDelete(gem.id)}
                      className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
