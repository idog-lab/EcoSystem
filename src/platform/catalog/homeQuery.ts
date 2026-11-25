// The home page's search and folder, kept in the URL (?q=...&folder=...) so a
// refresh, Back and Forward and a shared link all show the same thing.

export type FolderSelection = { kind: 'all' } | { kind: 'unfiled' } | { kind: 'folder'; id: string }
export type HomeQuery = { q: string; folder: FolderSelection }

export const DEFAULT_HOME_QUERY: HomeQuery = { q: '', folder: { kind: 'all' } }

export function readHomeQuery(search: string): HomeQuery {
  const params = new URLSearchParams(search)
  const q = params.get('q') ?? ''
  const f = (params.get('folder') ?? '').trim()
  const folder: FolderSelection = !f || f === 'all' ? { kind: 'all' } : f === 'unfiled' ? { kind: 'unfiled' } : { kind: 'folder', id: f }
  return { q, folder }
}

/** '' for the default view; otherwise '?q=...&folder=...' (defaults left out). */
export function writeHomeQuery({ q, folder }: HomeQuery): string {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (folder.kind === 'unfiled') params.set('folder', 'unfiled')
  if (folder.kind === 'folder') params.set('folder', folder.id)
  const s = params.toString()
  return s ? `?${s}` : ''
}

export const sameFolder = (a: FolderSelection, b: FolderSelection) =>
  a.kind === b.kind && (a.kind !== 'folder' || a.id === (b as { id: string }).id)
