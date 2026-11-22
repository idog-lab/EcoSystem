import { Puzzle, Pickaxe, ChefHat, ArrowRight } from 'lucide-react'

const FEATURES = [
  {
    id: 'merge',
    name: 'Merge Mania',
    description: 'Board layout & item-placement design tool for the 7-day merge live-ops event.',
    icon: Puzzle,
  },
  {
    id: 'diamond-mine',
    name: 'Diamond Mine',
    description: 'Create gems, build boards, and generate reveal-the-tiles layouts by target difficulty.',
    icon: Pickaxe,
  },
  {
    id: 'chef',
    name: 'Chef',
    description: 'Design a Chef live-ops event in five steps: players, dishes and baskets, then simulate it and value a basket.',
    icon: ChefHat,
  },
]

export default function HeroPage({ onSelect }) {
  return (
    <div className="min-h-screen">
      <div className="app-backdrop" aria-hidden="true" />
      <main className="max-w-5xl mx-auto px-6 py-16 flex flex-col items-center gap-12">
        <div className="text-center">
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">Economy design toolkit</h1>
          <p className="text-slate-500 mt-2">Pick a feature to work on.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full">
          {FEATURES.map(({ id, name, description, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              className="group flex flex-col items-start gap-4 text-left bg-white/90 backdrop-blur-sm border border-white shadow-lg shadow-purple-950/5 ring-1 ring-slate-200/70 rounded-3xl p-6 hover:shadow-xl hover:shadow-purple-500/10 hover:-translate-y-0.5 transition-all duration-150"
            >
              <span className="grid place-items-center w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-600 to-fuchsia-500 text-white shadow-md shadow-purple-500/30">
                <Icon size={22} strokeWidth={2.25} />
              </span>
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900 tracking-tight">{name}</h2>
                <p className="text-sm text-slate-500 mt-1">{description}</p>
              </div>
              <span className="mt-auto flex items-center gap-1.5 text-sm font-semibold text-purple-600 group-hover:gap-2.5 transition-all">
                Open <ArrowRight size={15} strokeWidth={2.5} />
              </span>
            </button>
          ))}

          <div className="flex flex-col items-start gap-4 text-left bg-white/50 border border-dashed border-slate-300 rounded-3xl p-6 sm:col-span-2">
            <span className="text-sm text-slate-400 font-medium">More features coming soon.</span>
          </div>
        </div>
      </main>
    </div>
  )
}
