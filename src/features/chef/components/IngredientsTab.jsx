import { Plus, Copy, Trash2 } from 'lucide-react'
import Card from '../../../components/ui/Card'
import NumberField from '../../../components/ui/NumberField'
import { RARITY, RARITY_LABELS, RARITY_ORDER } from '../lib/chefModel'

const RARITY_COLOR = {
  [RARITY.COMMON]: 'bg-slate-100 text-slate-600',
  [RARITY.RARE]: 'bg-sky-100 text-sky-700',
  [RARITY.SEMI_BLOCKER]: 'bg-violet-100 text-violet-700',
  [RARITY.BLOCKER]: 'bg-rose-100 text-rose-700',
}

export default function IngredientsTab({ ingredients, onUpdate, onAdd, onDuplicate, onRemove }) {
  return (
    <Card
      title="Ingredients"
      subtitle="Rarity + demand cap per ingredient (cap = the most any dish recipe matrix ever needs of it)."
      action={
        <button type="button" onClick={onAdd} className="flex items-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-800">
          <Plus size={13} /> Add ingredient
        </button>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {ingredients.map((ing) => (
          <div key={ing.id} className="group relative flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/70 p-3">
            <div className="absolute top-2 right-2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
              <button type="button" title="Duplicate" onClick={() => onDuplicate(ing.id)} className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                <Copy size={13} />
              </button>
              <button type="button" title="Remove" onClick={() => onRemove(ing.id)} className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50">
                <Trash2 size={13} />
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="grid place-items-center w-8 h-8 rounded-xl bg-slate-100 text-lg shrink-0" aria-hidden="true">
                  {ing.art ?? '•'}
                </span>
                <input
                  value={ing.name}
                  onChange={(e) => onUpdate(ing.id, { name: e.target.value })}
                  className="font-semibold text-sm text-slate-800 bg-transparent border-b border-transparent focus:border-purple-300 focus:outline-none flex-1 min-w-0"
                />
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${RARITY_COLOR[ing.rarity]}`}>{RARITY_LABELS[ing.rarity]}</span>
            </div>
            <select
              value={ing.rarity}
              onChange={(e) => onUpdate(ing.id, { rarity: e.target.value })}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white/70"
            >
              {RARITY_ORDER.map((r) => (
                <option key={r} value={r}>
                  {RARITY_LABELS[r]}
                </option>
              ))}
            </select>
            <NumberField label="Demand cap" min={0} value={ing.cap ?? 0} onChange={(e) => onUpdate(ing.id, { cap: Number(e.target.value) || 0 })} />
          </div>
        ))}
        {ingredients.length === 0 && <p className="text-sm text-slate-400">No ingredients yet — click "Add ingredient" to start.</p>}
      </div>
    </Card>
  )
}
