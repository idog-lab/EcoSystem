import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Coins } from 'lucide-react'
import { createEconomy, normalizeEconomy } from '../../lib/economy/economyModel'
import { loadEconomy, saveEconomy } from '../../lib/economy/economyStore'
import WorthTab from './WorthTab'
import CalendarTab from './CalendarTab'
import KeysTab from './KeysTab'
import CheckTab from './CheckTab'
import BuildTab from './BuildTab'
import BalanceTab from './BalanceTab'
import SegmentsTab from './SegmentsTab'
import RulesTab from './RulesTab'
import { BUTTON } from './economyUi'

// THE ECONOMY PAGE: one economy for the whole app (economist: "all the app
// should know how to handle the calculations of the game we got"; asked, and
// chose one shared page). What everything is worth in allowance, the keys the
// game knows, a reward checker, a prize builder, segment conditions and the
// rounding rules. Every change is kept in this browser at once; Chef reads the
// value table from here, Merge Mania's Syntax tab checks its reward text with
// it.
const TABS = [
  { id: 'worth', label: 'Worth' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'keys', label: 'Keys' },
  { id: 'check', label: 'Check a reward' },
  { id: 'build', label: 'Build a prize' },
  { id: 'balance', label: 'Balance tiers' },
  { id: 'segments', label: 'Segments' },
  { id: 'rules', label: 'Rounding' },
]

export default function EconomyApp({ onHome }) {
  const [economy, setEconomy] = useState(loadEconomy)
  const [tab, setTab] = useState('worth')
  const [status, setStatus] = useState(null)
  const fileRef = useRef(null)
  // When the taught values replaced some of this browser's own, they are kept so (said once, on this visit).
  useEffect(() => {
    if (economy.replacedHere?.length) saveEconomy(economy)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function change(next) {
    const r = saveEconomy(next)
    if (r.ok) {
      setEconomy(r.economy)
      setStatus(null)
    } else {
      setEconomy(next)
      setStatus({ tone: 'error', text: `Not kept: ${r.error}` })
    }
  }

  function download() {
    const blob = new Blob([JSON.stringify({ kind: 'economy', economy }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `economy-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function load(file) {
    try {
      const raw = JSON.parse(await file.text())
      const data = raw?.kind === 'economy' ? raw.economy : raw?.economy ?? null
      if (!data || typeof data !== 'object' || !data.resources) throw new Error('This file holds no economy.')
      if (!window.confirm('Replace the economy on this page with the one in the file?')) return
      const read = normalizeEconomy(data)
      change(read)
      // A file made before a value was taught: the taught one is used, and that is said.
      const taughtOver = read.replacedHere.map((r) => `${r.what} (${r.here} in the file, ${r.taught} taught)`).join('; ')
      setStatus({ tone: 'ok', text: `Loaded from ${file.name}.${taughtOver ? ` The app has been taught its own value for: ${taughtOver} - the taught one is used.` : ''}` })
    } catch (e) {
      setStatus({ tone: 'error', text: e.message || 'The file could not be read.' })
    }
  }

  function reset() {
    if (!window.confirm('Start again from the economist\'s table? Every worth, currency and key typed here is replaced. Download a file first to keep them.')) return
    change(createEconomy())
    setStatus({ tone: 'ok', text: 'Back to the starting table.' })
  }

  return (
    <div className="min-h-screen economy-app">
      <div className="app-backdrop" aria-hidden="true" />
      <header className="mx-auto flex max-w-[1760px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 pb-2 pt-4" data-testid="economy-header">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <button type="button" onClick={onHome} aria-label="Back to the features" title="Back to the features" className="grid h-9 w-9 place-items-center rounded-xl border border-white bg-white/80 text-slate-500 ring-1 ring-slate-200/70 transition-colors hover:text-purple-600">
            <ArrowLeft size={16} />
          </button>
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-purple-600 to-fuchsia-500 text-white shadow-md shadow-purple-500/30">
            <Coins size={18} strokeWidth={2.25} />
          </span>
          <h1 className="font-display text-xl font-bold tracking-tight text-slate-900">Economy</h1>
          <span className="text-sm text-slate-500" title="A value marked Taught was explained in chat and kept in the app itself: you and your coworker see the same. Anything else typed here is kept in this browser only.">
            One for the whole app, in allowance. Values marked Taught are the same for everyone; anything typed here stays in this browser.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BUTTON} onClick={download} data-testid="economy-download">
            Download
          </button>
          <button type="button" className={BUTTON} onClick={() => fileRef.current?.click()} data-testid="economy-load">
            Load a file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            data-testid="economy-load-input"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) load(f)
            }}
          />
          <button type="button" className={BUTTON} onClick={reset} data-testid="economy-reset">
            Start again
          </button>
        </div>
      </header>
      <nav className="mx-auto flex max-w-[1760px] flex-wrap gap-1.5 px-6 pb-3" aria-label="Economy tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-pressed={tab === t.id} data-tab={t.id} className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${tab === t.id ? 'bg-purple-600 text-white shadow-sm' : 'bg-white/80 text-slate-600 ring-1 ring-slate-200/70 hover:text-purple-700'}`}>
            {t.label}
          </button>
        ))}
      </nav>
      <main className="mx-auto flex max-w-[1760px] flex-col gap-4 px-6 pb-12" data-economy-tab={tab}>
        {economy.replacedHere?.length > 0 && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="economy-replaced">
            This browser had values of its own where the app has now been taught one, and the taught one is used:{' '}
            {economy.replacedHere.map((r) => `${r.what} (${r.here} here, ${r.taught} taught)`).join('; ')}.
          </p>
        )}
        {status && (
          <p className={`rounded-xl px-3 py-2 text-sm ${status.tone === 'error' ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`} data-testid="economy-status">
            {status.text}
          </p>
        )}
        {tab === 'worth' && <WorthTab economy={economy} onChange={change} />}
        {tab === 'calendar' && <CalendarTab economy={economy} onChange={change} />}
        {tab === 'keys' && <KeysTab economy={economy} onChange={change} />}
        {tab === 'check' && <CheckTab economy={economy} />}
        {tab === 'build' && <BuildTab economy={economy} />}
        {tab === 'balance' && <BalanceTab economy={economy} />}
        {tab === 'segments' && <SegmentsTab />}
        {tab === 'rules' && <RulesTab />}
      </main>
    </div>
  )
}
