import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, FolderInput } from 'lucide-react'
import type { Folder } from '../organization/useOrganization'

// The keyboard- and touch-friendly way to move a model: a small button beside
// the card (never inside the card's link) that opens a menu of destinations.

type Props = {
  modelName: string
  currentFolderId: string | null
  folders: Folder[]
  onMove: (folderId: string | null) => void
}

export default function MoveToFolderMenu({ modelName, currentFolderId, folders, onMove }: Props) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const options: { id: string | null; label: string }[] = [{ id: null, label: 'Unfiled' }, ...folders.map((f) => ({ id: f.id, label: f.name }))]

  useEffect(() => {
    if (!open) return
    const items = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]
    const current = items().find((el) => el.getAttribute('aria-checked') === 'true') ?? items()[0]
    current?.focus()
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const close = (focusButton = true) => {
    setOpen(false)
    if (focusButton) buttonRef.current?.focus()
  }

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus()
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  return (
    <div className="absolute right-3 top-3">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Move ${modelName} to a folder`}
        title="Move to folder"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition-colors hover:bg-purple-50 hover:text-purple-700 focus-visible:outline-2 focus-visible:outline-purple-600"
      >
        <FolderInput size={18} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`Move ${modelName} to`}
          onKeyDown={onMenuKey}
          className="absolute right-0 z-20 mt-1 w-56 rounded-2xl border border-purple-100 bg-white p-1.5 shadow-xl shadow-purple-950/10"
        >
          {options.map((o) => {
            const checked = o.id === currentFolderId
            return (
              <button
                key={o.id ?? 'unfiled'}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={-1}
                onClick={() => {
                  close()
                  if (!checked) onMove(o.id)
                }}
                className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-purple-50 focus:bg-purple-50 focus:outline-none"
              >
                <span className="truncate">{o.label}</span>
                {checked && <Check size={16} className="shrink-0 text-purple-600" aria-hidden="true" />}
              </button>
            )
          })}
          {folders.length === 0 && <p className="px-3 py-2 text-xs text-slate-500">No folders yet. Create one in the sidebar.</p>}
        </div>
      )}
    </div>
  )
}
