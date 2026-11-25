import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { MODEL_CATALOG, modelById } from '../registry/catalog'
import type { ModelEntry } from '../registry/types'
import { navigate } from '../routing/router'
import { Link } from '../routing/Link'
import { useLocation } from '../routing/router'
import { useSession } from '../api/useSession'
import { useOrganization } from '../organization/useOrganization'
import { readHomeQuery, writeHomeQuery, DEFAULT_HOME_QUERY, type HomeQuery } from './homeQuery'
import { filterModels } from './search'
import Sidebar from './Sidebar'
import ModelCard from './ModelCard'
import AccountPanel, { BrowserDataLink } from './AccountPanel'

// The home page: the catalog, searched by name and narrowed by folder (AND),
// both kept in the URL. Generated from the registry - adding a model never
// touches this file.

const CATALOG: readonly ModelEntry[] = MODEL_CATALOG

export default function HomePage() {
  const { search } = useLocation()
  const query = readHomeQuery(search)
  const { session, signInWithGoogle, devSignIn, signOut } = useSession()
  const workspace = session.status === 'signed-in' ? (session.workspaces[0] ?? null) : null
  const org = useOrganization(workspace?.id ?? null)
  const folders = org.state.status === 'ready' ? org.state.folders : null
  const [notice, setNotice] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  // Typing pushes one history entry, then updates it in place: Back leaves the
  // search instead of stepping through it letter by letter.
  const typing = useRef(false)

  useEffect(() => {
    document.title = 'Economy design toolkit'
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const go = (next: HomeQuery, replace = false) => navigate(`/${writeHomeQuery(next)}`, { replace })

  const onType = (q: string) => {
    go({ ...query, q }, typing.current)
    typing.current = true
  }

  const results = useMemo(() => filterModels(CATALOG, query, org.folderOf), [query, org.folderOf])

  const selectedFolder = query.folder.kind === 'folder' ? (folders?.find((f) => f.id === (query.folder as { id: string }).id) ?? null) : null
  const title = query.folder.kind === 'all' ? 'All models' : query.folder.kind === 'unfiled' ? 'Unfiled' : (selectedFolder?.name ?? 'Folder')

  const move = async (modelId: string, folderId: string | null) => {
    const model = modelById(modelId)
    if (!model) return
    setNotice(null)
    const res = await org.moveModel(modelId, folderId)
    if (res.ok) return
    setNotice(
      res.code === 'conflict'
        ? `Someone else moved ${model.displayName} a moment ago. It is shown where they put it; move it again if you still want to.`
        : `${model.displayName} was not moved: ${res.message}`,
    )
  }

  const countIn = (folderId: string | null) => CATALOG.filter((m) => org.folderOf(m.id) === folderId).length

  // What the main area shows when the folder in the URL cannot be listed.
  let blocked: { title: string; text: string } | null = null
  if (query.folder.kind !== 'all' && !folders) {
    blocked =
      session.status === 'loading' || (workspace && org.state.status === 'loading')
        ? { title: 'Loading folders…', text: '' }
        : { title: 'Folders are not available', text: 'Sign in as a member of your workspace to see its folders.' }
  } else if (query.folder.kind === 'folder' && folders && !selectedFolder) {
    blocked = { title: 'This folder does not exist', text: 'It may have been in another workspace, or the link is wrong.' }
  }

  return (
    <div className="min-h-screen bg-[#f4f2fb]">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-4 md:flex-row md:gap-6 md:px-6 md:py-6">
        <Sidebar
          query={query}
          totalCount={CATALOG.length}
          folders={folders}
          countIn={countIn}
          onSelect={() => (typing.current = false)}
          onDropModel={move}
          createFolder={org.createFolder}
          renameFolder={org.renameFolder}
          account={<AccountPanel session={session} signInWithGoogle={signInWithGoogle} devSignIn={devSignIn} signOut={signOut} />}
          footer={<BrowserDataLink />}
        />

        <main className="flex min-w-0 flex-1 flex-col gap-5">
          <div role="search" className="flex items-center gap-3 rounded-2xl border border-purple-100 bg-white px-4 py-3 shadow-sm focus-within:border-purple-400 focus-within:ring-2 focus-within:ring-purple-200">
            <Search size={20} className="shrink-0 text-slate-500" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              aria-label="Search models by name"
              placeholder="Search models…"
              value={query.q}
              onChange={(e) => onType(e.target.value)}
              onBlur={() => (typing.current = false)}
              className="min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-500 [&::-webkit-search-cancel-button]:hidden"
            />
            {query.q && (
              <button type="button" aria-label="Clear search" onClick={() => { typing.current = false; go({ ...query, q: '' }) }} className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">
                <X size={16} aria-hidden="true" />
              </button>
            )}
            <kbd className="hidden shrink-0 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-500 sm:inline">Ctrl K</kbd>
          </div>

          <div>
            {query.folder.kind !== 'all' && (
              <nav aria-label="Breadcrumb" className="mb-1 text-sm">
                <Link to={`/${writeHomeQuery({ q: query.q, folder: { kind: 'all' } })}`} onClick={() => (typing.current = false)} className="font-medium text-purple-700 hover:underline">
                  All models
                </Link>
                <span className="mx-2 text-slate-400" aria-hidden="true">/</span>
                <span className="text-slate-600">{title}</span>
              </nav>
            )}
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
            <p className="mt-1 text-sm text-slate-600" aria-live="polite">
              {blocked ? '' : `${results.length} ${results.length === 1 ? 'model' : 'models'}${query.q.trim() ? ` matching “${query.q.trim()}”` : ''}`}
            </p>
          </div>

          {notice && (
            <div role="status" className="flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-amber-700 hover:text-amber-900">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}

          {blocked ? (
            <EmptyState title={blocked.title} text={blocked.text} action={blocked.title.startsWith('Loading') ? null : { label: 'Show all models', onClick: () => go(DEFAULT_HOME_QUERY) }} />
          ) : results.length === 0 ? (
            query.q.trim() ? (
              <EmptyState
                title={`No models match “${query.q.trim()}”${query.folder.kind === 'all' ? '' : ` in ${title}`}`}
                text="Search looks at model names only."
                action={{ label: 'Reset search and folder', onClick: () => { typing.current = false; go(DEFAULT_HOME_QUERY) } }}
              />
            ) : query.folder.kind === 'unfiled' ? (
              <EmptyState title="Every model is in a folder" text="Drag a model here, or use its Move to folder button, to unfile it." />
            ) : (
              <EmptyState title="This folder is empty" text="Drag a model card onto the folder, or use the Move to folder button on a card." />
            )
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={`${title}: models`}>
              {results.map((m) => (
                <ModelCard key={m.id} model={m} folders={folders} folderId={org.folderOf(m.id)} onMove={(folderId) => void move(m.id, folderId)} />
              ))}
            </ul>
          )}
        </main>
      </div>
    </div>
  )
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: { label: string; onClick: () => void } | null }) {
  return (
    <section className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-purple-200 bg-white/70 p-6" aria-label={title}>
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      {text && <p className="text-sm text-slate-600">{text}</p>}
      {action && (
        <button type="button" onClick={action.onClick} className="mt-2 rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700">
          {action.label}
        </button>
      )}
    </section>
  )
}
