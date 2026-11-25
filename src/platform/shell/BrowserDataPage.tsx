import { ArrowLeft } from 'lucide-react'
import { Link } from '../routing/Link'
import BrowserDataPanel from '../../components/BrowserDataPanel'

// The existing "data kept in this browser" panel (moving the older tools'
// browser data to another site or computer), moved off the home page.
export default function BrowserDataPage() {
  return (
    <main className="min-h-screen bg-[#f4f2fb] px-4 py-10 sm:px-8">
      <div className="mx-auto flex max-w-4xl flex-col items-start gap-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-purple-700 hover:text-purple-900">
          <ArrowLeft size={16} aria-hidden="true" /> All models
        </Link>
        <BrowserDataPanel />
      </div>
    </main>
  )
}
