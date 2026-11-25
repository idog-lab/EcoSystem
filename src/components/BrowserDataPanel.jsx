import { useRef, useState } from 'react'
import { Download, Upload, Check, TriangleAlert } from 'lucide-react'
import Button from './ui/Button'
import { collectAllData, hasAnyData, planRestore, readDataFile, restoreAllData } from '../lib/browserData'

// "Your data in this browser" on the home screen: everything the app keeps
// here as one file, and back (lib/browserData.js). Made for moving to the
// work repo's site; good for a new computer or a coworker's browser too.
function downloadJson(payload, fileName) {
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}
const today = () => new Date().toISOString().slice(0, 10)

const STATE_TEXT = {
  add: 'Not in this browser yet: it will be added.',
  same: 'The same as in this browser: nothing to do.',
  differs: 'This browser has its own.',
}

export default function BrowserDataPanel() {
  const inputRef = useRef(null)
  const [pending, setPending] = useState(null) // { data, plan, fileName }
  const [replace, setReplace] = useState([])
  const [message, setMessage] = useState(null) // { tone: 'ok' | 'error', text }

  function handleDownload() {
    downloadJson(collectAllData(), `economy-toolkit-all-data_${today()}.json`)
    setMessage({ tone: 'ok', text: 'Downloaded. Open the other site, then "Restore all my data" there and pick this file.' })
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const read = readDataFile(await file.text())
    if (!read.ok) {
      setPending(null)
      setMessage({ tone: 'error', text: read.message })
      return
    }
    setMessage(null)
    setReplace([])
    setPending({ data: read.data, plan: planRestore(read.data), fileName: file.name })
  }

  function handleRestore() {
    // The way back: what is here now, as a file, before anything changes.
    if (hasAnyData()) downloadJson(collectAllData(), `economy-toolkit-before-restore_${today()}.json`)
    const result = restoreAllData(pending.data, { replace })
    if (!result.ok) {
      setMessage({ tone: 'error', text: result.message })
      return
    }
    const parts = pending.plan.parts.filter((p) => result.partsWritten.includes(p.id)).map((p) => p.label.split(' (')[0])
    const said = [
      result.eventsAdded ? `${result.eventsAdded} saved Merge event${result.eventsAdded === 1 ? '' : 's'} added` : null,
      parts.length ? `restored: ${parts.join(', ')}` : null,
    ].filter(Boolean)
    setPending(null)
    setMessage({
      tone: 'ok',
      text: said.length ? `Done - ${said.join('; ')}. What was here before was downloaded first.` : 'Nothing to restore: this browser already holds everything in the file.',
    })
  }

  const plan = pending?.plan
  const shownParts = plan?.parts.filter((p) => p.state !== 'none') ?? []
  const somethingToDo = plan && (plan.events.toAdd.length > 0 || shownParts.some((p) => p.state === 'add' || (p.state === 'differs' && replace.includes(p.id))))

  return (
    <section className="w-full rounded-3xl border border-slate-200 bg-white/80 p-6 text-left" data-testid="browser-data">
      <h2 className="font-display text-base font-bold text-slate-900">Your data in this browser</h2>
      <p className="mt-1 text-sm text-slate-500">
        Saved Merge events, the open Merge project, Chef, Diamond Mine and the Economy page are kept in this browser, for this site only. To move them to another site or
        computer, download them here and restore them there.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon={Download} onClick={handleDownload} data-testid="data-download" title="One file with everything the app keeps in this browser">
          Download all my data
        </Button>
        <Button variant="secondary" size="sm" icon={Upload} onClick={() => inputRef.current?.click()} data-testid="data-restore" title="Pick a file made by 'Download all my data': you see what it holds before anything changes">
          Restore all my data
        </Button>
        <input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleFile} data-testid="data-restore-file" />
      </div>

      {plan && (
        <div className="mt-4 rounded-2xl border border-purple-200 bg-purple-50/60 p-4 text-sm" data-testid="data-plan">
          <p className="font-semibold text-slate-800">
            {pending.fileName}
            {pending.data.from ? <span className="font-normal text-slate-500"> - made on {pending.data.from.replace(/^https?:\/\//, '').replace(/\?.*$/, '')}</span> : null}
          </p>
          <ul className="mt-2 space-y-2">
            <li data-part="events">
              <span className="font-medium text-slate-700">Saved Merge events: </span>
              {plan.events.inFile === 0
                ? 'none in the file.'
                : `${plan.events.toAdd.length} will be added to the list${plan.events.alreadyHere ? `, ${plan.events.alreadyHere} already here (left as they are)` : ''}.`}
              {plan.events.toAdd.length > 0 && <span className="block text-xs text-slate-500">{plan.events.toAdd.map((e) => e.name).join(' · ')}</span>}
            </li>
            {shownParts.map((p) => (
              <li key={p.id} data-part={p.id} data-state={p.state}>
                <span className="font-medium text-slate-700">{p.label}: </span>
                {STATE_TEXT[p.state]}
                {p.state === 'differs' && (
                  <label className="mt-1 flex items-center gap-2 text-slate-700">
                    <input
                      type="checkbox"
                      checked={replace.includes(p.id)}
                      onChange={(e) => setReplace((r) => (e.target.checked ? [...r, p.id] : r.filter((x) => x !== p.id)))}
                      data-replace={p.id}
                    />
                    Replace this browser&apos;s with the file&apos;s
                  </label>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="dark" size="sm" onClick={handleRestore} disabled={!somethingToDo} data-testid="data-restore-confirm">
              Restore
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <span className="text-xs text-slate-500">Nothing here is deleted; what is here now is downloaded first.</span>
          </div>
        </div>
      )}

      {message && (
        <p className={`mt-3 flex items-start gap-1.5 text-sm ${message.tone === 'error' ? 'text-rose-700' : 'text-emerald-700'}`} data-testid="data-message">
          {message.tone === 'error' ? <TriangleAlert size={15} className="mt-0.5 shrink-0" /> : <Check size={15} className="mt-0.5 shrink-0" />}
          {message.text}
        </p>
      )}
    </section>
  )
}
