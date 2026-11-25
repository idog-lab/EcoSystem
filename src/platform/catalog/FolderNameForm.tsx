import { useId, useState, type FormEvent } from 'react'
import { checkFolderName, folderNameKey } from '../organization/folderName'

// Typing a folder name (new folder or rename). Instant checks here; the
// server is the authority and its answer is shown the same way.

type Props = {
  label: string
  initial?: string
  submitLabel: string
  /** Names already taken (another folder's), compared without case. */
  takenNames: string[]
  /** Returns an error message to show, or null when saved. */
  onSubmit: (name: string) => Promise<string | null>
  onCancel: () => void
  /** A message from outside (e.g. a conflict), kept until the next submit. */
  notice?: string | null
}

export default function FolderNameForm({ label, initial = '', submitLabel, takenNames, onSubmit, onCancel, notice }: Props) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputId = useId()
  const msgId = useId()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const check = checkFolderName(value)
    if (!check.ok) return setError(check.message)
    if (takenNames.some((n) => folderNameKey(n) === check.nameKey)) return setError(`There is already a folder called "${check.name}".`)
    setBusy(true)
    const message = await onSubmit(check.name)
    setBusy(false)
    setError(message)
  }

  const shown = error ?? notice ?? null
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-xl bg-purple-50/60 p-2" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <input
        id={inputId}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={shown ? msgId : undefined}
        placeholder="Folder name"
        maxLength={80}
        className="w-full rounded-lg border border-purple-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-200"
      />
      {shown && (
        <p id={msgId} role="alert" className="text-xs text-rose-700">
          {shown}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-purple-600 px-3 py-1 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-60">
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-white">
          Cancel
        </button>
      </div>
    </form>
  )
}
