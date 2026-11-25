import { ArrowLeft } from 'lucide-react'
import type { ModelPageProps } from '../../platform/registry/modules'
import ModelIcon from '../../platform/catalog/ModelIcon'

// The page of a model listed in the catalog but not built in this app yet.
// It shows no inputs, formulas or results: nothing about the model's
// economics is known here until it is migrated.
export default function NotMigratedPage({ model, onHome }: ModelPageProps) {
  return (
    <main className="min-h-screen bg-[#f4f2fb] px-4 py-10 sm:px-8">
      <div className="mx-auto flex max-w-xl flex-col items-start gap-6">
        <button
          type="button"
          onClick={onHome}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-purple-700 hover:text-purple-900"
        >
          <ArrowLeft size={16} aria-hidden="true" /> All models
        </button>
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-purple-100 text-purple-700">
            <ModelIcon iconKey={model.iconKey} size={28} />
          </span>
          <h1 className="font-display text-3xl font-bold text-slate-900">{model.displayName}</h1>
        </div>
        <section className="w-full rounded-2xl border border-purple-100 bg-white p-6 shadow-sm" aria-labelledby="not-migrated-title">
          <h2 id="not-migrated-title" className="text-lg font-semibold text-slate-900">
            Model not migrated yet
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {model.displayName} is in the catalog, but its model has not been built in this toolkit yet. There is nothing to edit or
            calculate here until it is.
          </p>
        </section>
      </div>
    </main>
  )
}
