// Shared Puzzle events: listed, opened, saved and cloned on the toolkit
// server, per workspace. A save names the revision it was made from; when
// someone saved first the server refuses it and the edits here are KEPT -
// the economist chooses to keep theirs on top of the newer one or take the
// newer one. A newer revision saved elsewhere is noticed by polling.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../../platform/api/client'
import { createDefaultEvent, type PuzzleEvent } from '../engine/model'
import { PUZZLE_SCHEMA_VERSION } from '../engine/schema'
import { newOrders } from '../engine/shuffle'

export type DocSummary = { id: string; title: string; revision: number; updatedAt: string }
export type OpenDoc = { id: string; title: string; revision: number; payload: PuzzleEvent; updatedAt: string }
type DocDto = { id: string; title: string; revision: number; payload: unknown; updatedAt: string }

const POLL_MS = 10_000
const DRAFT_KEY = (id: string) => `puzzle-draft:${id}`
const toOpen = (d: DocDto): OpenDoc => ({ id: d.id, title: d.title, revision: d.revision, payload: d.payload as PuzzleEvent, updatedAt: d.updatedAt })

function readDraft(id: string): PuzzleEvent | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(id))
    return raw ? (JSON.parse(raw) as PuzzleEvent) : null
  } catch {
    return null
  }
}
function writeDraft(id: string, ev: PuzzleEvent | null) {
  try {
    if (ev) localStorage.setItem(DRAFT_KEY(id), JSON.stringify(ev))
    else localStorage.removeItem(DRAFT_KEY(id))
  } catch {
    // A browser without storage still works; the draft just does not survive a reload.
  }
}

export function usePuzzleEvents(workspaceId: string | null) {
  const [list, setList] = useState<DocSummary[]>([])
  const [doc, setDoc] = useState<OpenDoc | null>(null)
  const [draft, setDraftState] = useState<PuzzleEvent | null>(null)
  const [conflict, setConflict] = useState<OpenDoc | null>(null)
  const [newer, setNewer] = useState<OpenDoc | null>(null)
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'error'; message?: string }>({ kind: 'idle' })
  const base = workspaceId ? `/workspaces/${workspaceId}/documents` : null
  const docRef = useRef(doc)
  docRef.current = doc

  const dirty = !!doc && !!draft && JSON.stringify(draft) !== JSON.stringify(doc.payload)

  const refreshList = useCallback(async () => {
    if (!base) return
    const res = await api<{ documents: (DocSummary & { modelId: string })[] }>(`${base}?modelId=puzzle`)
    if (res.ok) setList(res.data.documents)
    else setStatus({ kind: 'error', message: res.message })
  }, [base])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading from the server on mount
    void refreshList()
  }, [refreshList])

  const setDraft = useCallback((next: PuzzleEvent | ((ev: PuzzleEvent) => PuzzleEvent)) => {
    setDraftState((cur) => {
      if (!cur) return cur
      const value = typeof next === 'function' ? next(cur) : next
      if (docRef.current) writeDraft(docRef.current.id, value)
      return value
    })
  }, [])

  const open = useCallback(
    async (id: string) => {
      if (!base) return
      const res = await api<{ document: DocDto }>(`${base}/${id}`)
      if (!res.ok) return setStatus({ kind: 'error', message: res.message })
      const d = toOpen(res.data.document)
      setDoc(d)
      // Unsaved edits of this event in this browser come back.
      setDraftState(readDraft(id) ?? d.payload)
      setConflict(null)
      setNewer(null)
    },
    [base],
  )

  const create = useCallback(
    async (payload?: PuzzleEvent) => {
      if (!base) return
      const ev = payload ?? (() => {
        const e = createDefaultEvent()
        e.order = newOrders(Math.floor(Math.random() * 2 ** 31))
        return e
      })()
      const res = await api<{ document: DocDto }>(base, { method: 'POST', body: { modelId: 'puzzle', title: ev.setup.name, schemaVersion: PUZZLE_SCHEMA_VERSION, payload: ev } })
      if (!res.ok) return setStatus({ kind: 'error', message: res.message })
      await refreshList()
      await open(res.data.document.id)
    },
    [base, open, refreshList],
  )

  /** A copy of the open event (its saved shuffle included) as a new shared event. */
  const clone = useCallback(async () => {
    if (!draft) return
    const copy: PuzzleEvent = JSON.parse(JSON.stringify(draft))
    copy.setup.name = `Copy of ${draft.setup.name}`.slice(0, 120)
    copy.optimize.eventId = ''
    await create(copy)
  }, [create, draft])

  const saveAt = useCallback(
    async (expectedRevision: number, payload: PuzzleEvent) => {
      if (!base || !doc) return false
      setStatus({ kind: 'saving' })
      const res = await api<{ document: DocDto }>(`${base}/${doc.id}`, {
        method: 'PUT',
        body: { title: payload.setup.name, schemaVersion: PUZZLE_SCHEMA_VERSION, payload, expectedRevision },
      })
      if (res.ok) {
        const d = toOpen(res.data.document)
        setDoc(d)
        setDraftState(d.payload)
        writeDraft(d.id, null)
        setConflict(null)
        setNewer(null)
        setStatus({ kind: 'idle' })
        void refreshList()
        return true
      }
      if (res.status === 409 && res.current) {
        // Someone saved first: nothing here is lost.
        setConflict(toOpen(res.current as DocDto))
        setStatus({ kind: 'idle' })
        return false
      }
      setStatus({ kind: 'error', message: res.message })
      return false
    },
    [base, doc, refreshList],
  )

  const save = useCallback(() => (doc && draft ? saveAt(doc.revision, draft) : Promise.resolve(false)), [doc, draft, saveAt])
  /** Keep my edits: save them on top of the newer revision (it stays in the history). */
  const keepMine = useCallback(() => (conflict && draft ? saveAt(conflict.revision, draft) : Promise.resolve(false)), [conflict, draft, saveAt])
  /** Take the newer revision; my edits are dropped. */
  const takeTheirs = useCallback(() => {
    const theirs = conflict ?? newer
    if (!theirs) return
    setDoc(theirs)
    setDraftState(theirs.payload)
    writeDraft(theirs.id, null)
    setConflict(null)
    setNewer(null)
  }, [conflict, newer])

  // A revision saved elsewhere: taken at once when nothing is edited here, else announced.
  useEffect(() => {
    if (!base || !doc) return
    const t = setInterval(async () => {
      const cur = docRef.current
      if (!cur) return
      const res = await api<{ document: DocDto }>(`${base}/${cur.id}`, { headers: { 'If-None-Match': `"r${cur.revision}"` } })
      if (!res.ok || res.status === 304 || !res.data?.document) return
      const d = toOpen(res.data.document)
      if (d.revision <= cur.revision) return
      setDraftState((dr) => {
        const edited = dr && JSON.stringify(dr) !== JSON.stringify(cur.payload)
        if (edited) {
          setNewer(d)
          return dr
        }
        setDoc(d)
        return d.payload
      })
    }, POLL_MS)
    return () => clearInterval(t)
  }, [base, doc])

  /** Back to the list; unsaved edits stay in this browser for the next open. */
  const close = useCallback(() => {
    setDoc(null)
    setDraftState(null)
    setConflict(null)
    setNewer(null)
    void refreshList()
  }, [refreshList])

  return { list, doc, draft, setDraft, dirty, open, close, create, clone, save, keepMine, takeTheirs, conflict, newer, status, refreshList, base }
}
