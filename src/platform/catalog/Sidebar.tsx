import { useState, type DragEvent, type ReactNode } from 'react'
import { Folder as FolderIcon, FolderPlus, Inbox, Layers, LayoutGrid, Pencil } from 'lucide-react'
import { Link } from '../routing/Link'
import type { Folder, WriteResult } from '../organization/useOrganization'
import { writeHomeQuery, type FolderSelection, type HomeQuery } from './homeQuery'
import { isModelDrag, MODEL_DRAG_TYPE } from './dragModel'
import FolderNameForm from './FolderNameForm'

// Navigation: All models, Unfiled and the workspace's own folders. Nothing
// else - no predefined categories. Unfiled and every folder accept a dragged
// model card.

type Props = {
  query: HomeQuery
  totalCount: number
  /** null while folders are not available (signed out, no server, loading). */
  folders: Folder[] | null
  countIn: (folderId: string | null) => number
  /** Called on a click in the navigation (the link itself changes the URL). */
  onSelect: (folder: FolderSelection) => void
  onDropModel: (modelId: string, folderId: string | null) => void
  createFolder: (name: string) => Promise<WriteResult<Folder>>
  renameFolder: (folderId: string, name: string, expectedRevision: number) => Promise<WriteResult<Folder>>
  account: ReactNode
  footer: ReactNode
}

export default function Sidebar({ query, totalCount, folders, countIn, onSelect, onDropModel, createFolder, renameFolder, account, footer }: Props) {
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; expectedRevision: number; notice: string | null } | null>(null)
  const sel = query.folder
  const to = (folder: FolderSelection) => `/${writeHomeQuery({ q: query.q, folder })}`

  return (
    <aside className="flex w-full shrink-0 flex-col gap-5 rounded-3xl border border-white bg-white/90 p-4 shadow-lg shadow-purple-950/5 md:sticky md:top-6 md:max-h-[calc(100vh-3rem)] md:w-72 md:overflow-y-auto">
      <div className="flex items-center gap-3 px-2 pt-1">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-purple-600 text-white shadow-md shadow-purple-500/30">
          <Layers size={22} aria-hidden="true" />
        </span>
        <h1 className="font-display text-xl font-bold leading-tight tracking-tight text-slate-900">Economy design toolkit</h1>
      </div>

      <nav aria-label="Models" className="flex flex-col gap-1">
        <ul className="flex flex-col gap-1">
        <NavItem to={to({ kind: 'all' })} onClick={() => onSelect({ kind: 'all' })} selected={sel.kind === 'all'} icon={<LayoutGrid size={18} />} label="All models" count={totalCount} />
        {folders && (
          <NavItem
            to={to({ kind: 'unfiled' })}
            onClick={() => onSelect({ kind: 'unfiled' })}
            selected={sel.kind === 'unfiled'}
            icon={<Inbox size={18} />}
            label="Unfiled"
            count={countIn(null)}
            onDropModel={(id) => onDropModel(id, null)}
          />
        )}
        </ul>

        {folders && (
          <>
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 px-2 pt-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Folders</h2>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-50"
              >
                <FolderPlus size={15} aria-hidden="true" /> New folder
              </button>
            </div>
            {creating && (
              <FolderNameForm
                label="New folder name"
                submitLabel="Create"
                takenNames={folders.map((f) => f.name)}
                onCancel={() => setCreating(false)}
                onSubmit={async (name) => {
                  const res = await createFolder(name)
                  if (res.ok) setCreating(false)
                  return res.ok ? null : res.message
                }}
              />
            )}
            {folders.length === 0 && !creating && (
              <p className="px-2 text-xs text-slate-500">No folders yet. Create one, then drag models into it.</p>
            )}
            <ul className="flex flex-col gap-1">
              {folders.map((f) =>
                renaming?.id === f.id ? (
                  <li key={f.id}>
                    <FolderNameForm
                      label={`New name for ${f.name}`}
                      initial={f.name}
                      submitLabel="Save"
                      takenNames={folders.filter((o) => o.id !== f.id).map((o) => o.name)}
                      notice={renaming.notice}
                      onCancel={() => setRenaming(null)}
                      onSubmit={async (name) => {
                        const res = await renameFolder(f.id, name, renaming.expectedRevision)
                        if (res.ok) {
                          setRenaming(null)
                          return null
                        }
                        if (res.code === 'conflict' && res.current) {
                          const current = res.current as Folder
                          // Keep what was typed; the next save is made from the
                          // revision just shown, so it is a deliberate choice.
                          setRenaming({ id: f.id, expectedRevision: current.revision, notice: null })
                          return `Someone renamed this folder to "${current.name}" while you were typing. Your text is kept: save again to use it, or cancel.`
                        }
                        return res.message
                      }}
                    />
                  </li>
                ) : (
                  <NavItem
                    key={f.id}
                    to={to({ kind: 'folder', id: f.id })}
                    onClick={() => onSelect({ kind: 'folder', id: f.id })}
                    selected={sel.kind === 'folder' && sel.id === f.id}
                    icon={<FolderIcon size={18} />}
                    label={f.name}
                    count={countIn(f.id)}
                    onDropModel={(id) => onDropModel(id, f.id)}
                    action={
                      <button
                        type="button"
                        aria-label={`Rename folder ${f.name}`}
                        title="Rename"
                        onClick={() => setRenaming({ id: f.id, expectedRevision: f.revision, notice: null })}
                        className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 opacity-100 hover:bg-white hover:text-purple-700 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                    }
                  />
                ),
              )}
            </ul>
          </>
        )}
      </nav>

      <div className="mt-auto flex flex-col gap-3 border-t border-slate-100 px-2 pt-4 text-sm">
        {account}
        {footer}
      </div>
    </aside>
  )
}

type NavItemProps = {
  to: string
  onClick: () => void
  selected: boolean
  icon: ReactNode
  label: string
  count: number
  onDropModel?: (modelId: string) => void
  action?: ReactNode
}

function NavItem({ to, onClick, selected, icon, label, count, onDropModel, action }: NavItemProps) {
  const [over, setOver] = useState(false)
  const drop = onDropModel
    ? {
        onDragOver: (e: DragEvent) => {
          if (!isModelDrag(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setOver(true)
        },
        onDragLeave: () => setOver(false),
        onDrop: (e: DragEvent) => {
          setOver(false)
          const id = e.dataTransfer.getData(MODEL_DRAG_TYPE)
          if (!id) return
          e.preventDefault()
          onDropModel(id)
        },
      }
    : {}
  return (
    <li
      {...drop}
      data-drop-target={onDropModel ? label : undefined}
      className={`group flex list-none items-center gap-1 rounded-xl pr-1 transition ${selected ? 'bg-purple-100 text-purple-800' : 'text-slate-700 hover:bg-slate-50'} ${over ? 'ring-2 ring-purple-500 ring-offset-1' : ''}`}
    >
      <Link
        to={to}
        onClick={onClick}
        aria-current={selected ? 'page' : undefined}
        aria-label={`${label}, ${count} ${count === 1 ? 'model' : 'models'}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 font-medium focus-visible:outline-2 focus-visible:outline-purple-600"
      >
        <span className={selected ? 'text-purple-700' : 'text-slate-500'} aria-hidden="true">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className={`rounded-md px-1.5 text-xs font-semibold ${selected ? 'text-purple-700' : 'text-slate-500'}`}>
          {count}
        </span>
      </Link>
      {action ?? <span className="w-7 shrink-0" aria-hidden="true" />}
    </li>
  )
}
