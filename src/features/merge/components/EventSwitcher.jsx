import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Check, ChevronDown, FolderOpen, Plus, RefreshCw } from 'lucide-react'
import { defaultEventName, eventDatesLabel } from '../lib/state/savedEvents'

// THE EVENT SWITCHER, in the header (economist: "save the event and be able to
// switch between them"; asked, and chose a switcher in the header). It names
// the saved event open now, lists the saved events newest first - a click opens
// one, asking first when there are unsaved changes (App.jsx: openSavedEvent) -
// and saves this one as new or updates the one open, right there. Renaming,
// deleting and downloading stay in "Saved events" (the More menu, and the last
// line of this list), where there is room to do them carefully.
export default function EventSwitcher({ events, openId, current, unsaved, message, onOpen, onSaveNew, onUpdate, onManage }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const openEvent = events.find((e) => e.id === openId) ?? null
  const suggested = defaultEventName(current?.startDate, current?.days)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const act = (fn) => () => {
    setOpen(false)
    fn()
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        title={openEvent ? 'The saved event open now - click to switch to another or save this one' : 'This event is not saved as an event yet - click to save it or open another'}
        data-testid="event-switcher"
        className={`flex max-w-[22rem] items-center gap-1.5 whitespace-nowrap rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition-colors ${openEvent ? 'border-purple-200 bg-purple-50/70 text-purple-800 hover:bg-purple-100' : 'border-slate-200 bg-white/80 text-slate-600 hover:bg-slate-50'}`}
      >
        <CalendarDays size={14} className="shrink-0" />
        <span className="truncate" data-testid="open-event-name">
          {openEvent ? openEvent.name : 'Not saved as an event'}
        </span>
        <ChevronDown size={13} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {message && !open && (
        <span className={`absolute left-0 top-full mt-1 whitespace-nowrap rounded-lg px-2 py-0.5 text-[11px] font-semibold shadow-sm ${message.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`} data-testid="event-switcher-message">
          {message.text}
        </span>
      )}
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[22rem] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl shadow-purple-950/10" data-testid="event-switcher-panel">
          <div className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Saved events, newest first</div>
          {events.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-slate-500">No saved events yet. Save this one to start the list.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto" data-testid="event-switcher-list">
              {events.map((e) => {
                const isOpen = e.id === openId
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={act(() => !isOpen && onOpen(e))}
                      disabled={isOpen}
                      data-event-id={e.id}
                      title={isOpen ? 'Open now' : unsaved ? `Open "${e.name}" - you will be asked first, as this event has unsaved changes` : `Open "${e.name}"`}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${isOpen ? 'bg-purple-50 text-purple-900' : 'text-slate-700 hover:bg-slate-50'}`}
                    >
                      {isOpen ? <Check size={14} className="shrink-0 text-purple-600" /> : <FolderOpen size={14} className="shrink-0 text-slate-400" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{e.name}</span>
                        <span className="block text-[11px] text-slate-500">
                          {eventDatesLabel(e.startDate, e.days) || 'No dates'}
                          {e.savedAt ? ` · saved ${new Date(e.savedAt).toLocaleDateString()}` : ''}
                        </span>
                      </span>
                      {isOpen && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-purple-600">Open</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="mt-1 flex flex-col gap-0.5 border-t border-slate-100 pt-1.5">
            {openEvent && (
              <button type="button" onClick={act(onUpdate)} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium text-slate-700 hover:bg-purple-50 hover:text-purple-800" data-testid="event-switcher-update">
                <RefreshCw size={14} className="shrink-0 text-slate-400" /> Update "{openEvent.name}"{unsaved ? ' with the changes' : ''}
              </button>
            )}
            <button type="button" onClick={act(() => onSaveNew(suggested))} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium text-slate-700 hover:bg-purple-50 hover:text-purple-800" data-testid="event-switcher-save-new" title="Saved under the event's dates; rename it in Saved events">
              <Plus size={14} className="shrink-0 text-slate-400" /> Save as a new event: "{suggested}"
            </button>
            <button type="button" onClick={act(onManage)} className="rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-purple-700 hover:bg-purple-50" data-testid="event-switcher-manage">
              Rename, delete or download... (Saved events)
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
