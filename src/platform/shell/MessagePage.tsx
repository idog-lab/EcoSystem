import { ArrowLeft } from 'lucide-react'
import { Link } from '../routing/Link'

export function MessagePage({ title, text, quiet = false }: { title: string; text: string; quiet?: boolean }) {
  return (
    <main className="min-h-screen bg-[#f4f2fb] px-4 py-10 sm:px-8">
      <div className="mx-auto flex max-w-xl flex-col items-start gap-4">
        {!quiet && (
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-purple-700 hover:text-purple-900">
            <ArrowLeft size={16} aria-hidden="true" /> All models
          </Link>
        )}
        <h1 className="font-display text-3xl font-bold text-slate-900">{title}</h1>
        {text && <p className="text-slate-600">{text}</p>}
      </div>
    </main>
  )
}
