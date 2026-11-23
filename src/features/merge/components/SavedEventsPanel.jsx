import { useState } from 'react'
import { CalendarDays, Download, FolderOpen, Pencil, Save, Trash2, X } from 'lucide-react'
import Button from '../../../components/ui/Button'
import { defaultEventName, eventDatesLabel } from '../lib/state/savedEvents'

// The list of saved events (SavedEvents in App.jsx does the work): save what is
// open, open another, rename, download as a backup file, delete.
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const when = (t) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function SavedEventsPanel({ events, openId, current, unsaved, message, onSaveNew, onUpdate, onOpen, onRename, onDownload, onDelete, onClose }) {
  const openEvent = events.find((e) => e.id === openId) ?? null
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState(null)
  const [renameText, setRenameText] = useState('')
  const suggested = defaultEventName(current.startDate, current.days)
  const currentDates = eventDatesLabel(current.startDate, current.days)

  return (
    <div className="mx-auto mt-2 mb-2 max-w-5xl rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm" data-testid="saved-events">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-display font-semibold text-slate-900">
            <CalendarDays size={16} className="text-purple-600" /> Saved events
          </div>
          <p className="mt-0.5 text-xs text-slate-500" data-note>
            Each saved event holds everything a backup file holds: all segments, the event in use, and the results of the last builds. They are kept in this browser
            only - download one as a file to keep it elsewhere or send it.
          </p>
        </div>
        <button type="button" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={onClose} aria-label="Close saved events" data-testid="saved-events-close">
          <X size={16} />
        </button>
      </div>

      {/* What is open now, and saving it. */}
      <div className="mt-3 rounded-xl border border-purple-100 bg-purple-50/60 px-3 py-2.5" data-testid="saved-events-current">
        <div className="text-xs text-slate-600">
          Open now: <span className="font-semibold text-slate-800" data-testid="saved-events-open-name">{openEvent ? openEvent.name : 'not saved in the list yet'}</span>
          {' · '}
          {currentDates ? `event dates ${currentDates}` : 'no event dates set (step 1, at the bottom)'}
          {openEvent && unsaved ? ' · changed since it was saved' : ''}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {openEvent && (
            <Button variant="primary" size="sm" icon={Save} onClick={onUpdate} data-testid="saved-events-update" title="Write what is open now over this saved event">
              Update &quot;{openEvent.name}&quot;
            </Button>
          )}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={suggested}
            className="min-w-[16rem] flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
            aria-label="Name of the new saved event"
            data-testid="saved-events-name"
          />
          <Button variant={openEvent ? 'secondary' : 'primary'} size="sm" icon={Save} onClick={() => { onSaveNew(name.trim() || suggested); setName('') }} data-testid="saved-events-save-new">
            {openEvent ? 'Save as a new event' : 'Save this event'}
          </Button>
        </div>
      </div>

      {message && (
        <div className={`mt-2 rounded-xl border px-3 py-2 text-xs ${message.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`} data-testid="saved-events-message">
          {message.text}
        </div>
      )}

      {events.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500" data-testid="saved-events-empty">No saved events yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs" data-testid="saved-events-list">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <th className="py-1.5 pr-3">Event</th>
                <th className="py-1.5 pr-3">Dates</th>
                <th className="py-1.5 pr-3" title="Segments with a DR demand">Segments</th>
                <th className="py-1.5 pr-3">Saved</th>
                <th className="py-1.5 pr-3 text-right" title="Space it takes in this browser">Size</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className={`border-b border-slate-100 ${e.id === openId ? 'bg-purple-50/60' : ''}`} data-saved-event={e.id}>
                  <td className="py-1.5 pr-3 font-semibold text-slate-800">
                    {renaming === e.id ? (
                      <input
                        autoFocus
                        value={renameText}
                        onChange={(ev) => setRenameText(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter') { onRename(e.id, renameText); setRenaming(null) }
                          if (ev.key === 'Escape') setRenaming(null)
                        }}
                        onBlur={() => { onRename(e.id, renameText); setRenaming(null) }}
                        className="w-full rounded-lg border border-slate-200 px-2 py-0.5 text-xs"
                        aria-label="New name"
                        data-testid="saved-event-rename-input"
                      />
                    ) : (
                      <span className="flex items-center gap-1.5">
                        {e.name}
                        {e.id === openId && <span className="rounded-full bg-purple-600 px-1.5 py-0.5 text-[10px] font-semibold text-white" data-testid="saved-event-open-badge">Open now</span>}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap text-slate-600">{eventDatesLabel(e.startDate, e.days) ?? 'no dates'}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-slate-600">{e.segments}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap text-slate-500">{when(e.savedAt)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-500">{kb(e.size ?? 0)}</td>
                  <td className="py-1.5">
                    <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                      <Button variant="secondary" size="sm" icon={FolderOpen} onClick={() => onOpen(e)} disabled={e.id === openId && !unsaved} data-testid="saved-event-open" title={e.id === openId && !unsaved ? 'This is the event open now' : 'Open this event - it replaces what is open now'}>
                        Open
                      </Button>
                      <button type="button" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Rename" aria-label={`Rename ${e.name}`} onClick={() => { setRenaming(e.id); setRenameText(e.name) }} data-testid="saved-event-rename">
                        <Pencil size={13} />
                      </button>
                      <button type="button" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Download as a backup file" aria-label={`Download ${e.name}`} onClick={() => onDownload(e)} data-testid="saved-event-download">
                        <Download size={13} />
                      </button>
                      <button type="button" className="rounded-lg p-1.5 text-red-500 hover:bg-red-50" title="Delete from the list" aria-label={`Delete ${e.name}`} onClick={() => onDelete(e)} data-testid="saved-event-delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
