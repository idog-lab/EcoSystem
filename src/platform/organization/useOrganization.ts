import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type ApiFailure } from '../api/client'

// The workspace's shared folders and where each model sits, kept current by
// polling (every POLL_MS while the tab is visible, and when it regains focus).
// A 304 answer costs almost nothing. Writes carry the revision they were made
// from; a conflict is reported, never silently retried over someone's change.

export const POLL_MS = 5_000

export type Folder = { id: string; name: string; revision: number }
export type Placement = { modelId: string; folderId: string | null; revision: number }
type Organization = { folders: Folder[]; placements: Placement[] }

export type OrgState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; folders: Folder[]; placements: Map<string, Placement> }

export type WriteResult<T> = { ok: true; value: T } | ApiFailure

export function useOrganization(workspaceId: string | null) {
  const [state, setState] = useState<OrgState>({ status: 'loading' })
  const etag = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) return
    const res = await api<Organization>(`/workspaces/${workspaceId}/organization`, {
      headers: etag.current ? { 'If-None-Match': etag.current } : {},
    })
    if (!res.ok) {
      setState((s) => (s.status === 'ready' ? s : { status: 'error', message: res.message }))
      return
    }
    if (res.status === 304) return
    etag.current = res.etag
    setState({ status: 'ready', folders: res.data.folders, placements: new Map(res.data.placements.map((p) => [p.modelId, p])) })
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) return
    etag.current = null
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading from the server when the workspace changes
    void refresh()
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const timer = window.setInterval(tick, POLL_MS)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [workspaceId, refresh])

  const createFolder = useCallback(
    async (name: string): Promise<WriteResult<Folder>> => {
      const res = await api<{ folder: Folder }>(`/workspaces/${workspaceId}/folders`, { method: 'POST', body: { name } })
      void refresh()
      return res.ok ? { ok: true, value: res.data.folder } : res
    },
    [workspaceId, refresh],
  )

  const renameFolder = useCallback(
    async (folderId: string, name: string, expectedRevision: number): Promise<WriteResult<Folder>> => {
      const res = await api<{ folder: Folder }>(`/workspaces/${workspaceId}/folders/${folderId}`, {
        method: 'PATCH',
        body: { name, expectedRevision },
      })
      void refresh()
      return res.ok ? { ok: true, value: res.data.folder } : res
    },
    [workspaceId, refresh],
  )

  const moveModel = useCallback(
    async (modelId: string, folderId: string | null): Promise<WriteResult<Placement>> => {
      if (state.status !== 'ready') return { ok: false, status: 0, code: 'unavailable', message: 'Folders are not loaded yet.' }
      const before = state.placements.get(modelId) ?? { modelId, folderId: null, revision: 0 }
      if (before.folderId === folderId) return { ok: true, value: before }
      // Show the move at once; the server's answer confirms or undoes it.
      setState((s) => (s.status === 'ready' ? { ...s, placements: new Map(s.placements).set(modelId, { ...before, folderId }) } : s))
      const res = await api<{ placement: Placement }>(`/workspaces/${workspaceId}/placements/${encodeURIComponent(modelId)}`, {
        method: 'PUT',
        body: { folderId, expectedRevision: before.revision },
      })
      if (res.ok) {
        setState((s) => (s.status === 'ready' ? { ...s, placements: new Map(s.placements).set(modelId, res.data.placement) } : s))
      } else {
        setState((s) => (s.status === 'ready' ? { ...s, placements: new Map(s.placements).set(modelId, before) } : s))
      }
      void refresh()
      return res.ok ? { ok: true, value: res.data.placement } : res
    },
    [workspaceId, refresh, state],
  )

  const folderOf = useMemo(() => {
    const placements = state.status === 'ready' ? state.placements : new Map<string, Placement>()
    return (modelId: string) => placements.get(modelId)?.folderId ?? null
  }, [state])

  return { state, refresh, createFolder, renameFolder, moveModel, folderOf }
}
