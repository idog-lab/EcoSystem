// Shared Puzzle events: listed, opened, saved and cloned on the toolkit
// server, per workspace. A save names the revision it was made from; when
// someone saved first the server refuses it and the edits here are KEPT -
// the economist chooses to keep theirs on top of the newer one or take the
// newer one. A newer revision saved elsewhere is noticed by polling.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { api } from '../../../platform/api/client'
import { createDefaultEvent, type PuzzleEvent } from '../engine/model'
import { PUZZLE_SCHEMA_VERSION } from '../engine/schema'
import { newOrders } from '../engine/shuffle'

export type DocSummary = { id: string; title: string; revision: number; updatedAt: string }
export type OpenDoc = { id: string; title: string; revision: number; payload: PuzzleEvent; updatedAt: string }
type DocDto = { id: string; title: string; revision: number; payload: unknown; updatedAt: string }

const POLL_MS = 10_000
const DRAFT_KEY = (id: string) => `puzzle-draft:${id}`
const toOpen = (d: DocDto): OpenDoc => ({ id: d.id, title: d.title, revision: d.revision, payload: d.payload as PuzzleEvent, updatedAt: d.updatedAt })

/** Unsaved edits kept in this browser, with the revision they were made from (base). */
type StoredDraft = { base: number; payload: PuzzleEvent }
function readDraft(id: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(id))
    if (!raw) return null
    const v = JSON.parse(raw) as StoredDraft | PuzzleEvent
    // (A draft kept before the base was recorded: its revision is unknown.)
    return 'payload' in v && 'base' in v ? v : { base: -1, payload: v as PuzzleEvent }
  } catch {
    return null
  }
}
function writeDraft(id: string, ev: PuzzleEvent | null, base = -1) {
  try {
    if (ev) localStorage.setItem(DRAFT_KEY(id), JSON.stringify({ base, payload: ev }))
    else localStorage.removeItem(DRAFT_KEY(id))
  } catch {
    // A browser without storage still works; the draft just does not survive a reload.
  }
}

export type Call = typeof api

export function usePuzzleEvents(workspaceId: string | null, api: Call) {
  const [list, setList] = useState<DocSummary[]>([])
  const [doc, setDoc] = useState<OpenDoc | null>(null)
  const [draft, setDraftState] = useState<PuzzleEvent | null>(null)
  const [conflict, setConflict] = useState<OpenDoc | null>(null)
  const [newer, setNewer] = useState<OpenDoc | null>(null)
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'error'; message?: string }>({ kind: 'idle' })
  const base = workspaceId ? `/workspaces/${workspaceId}/documents` : null
  const docRef = useRef(doc)
  docRef.current = doc
  // The revision the edits on screen were made from: a save names it, and a draft kept for later records it.
  const draftBase = useRef(-1)

  const dirty = !!doc && !!draft && JSON.stringify(draft) !== JSON.stringify(doc.payload)

  const refreshList = useCallback(async () => {
    if (!base) return
    const res = await api<{ documents: (DocSummary & { modelId: string })[] }>(`${base}?modelId=puzzle`)
    if (res.ok) setList(res.data.documents)
    else setStatus({ kind: 'error', message: res.message })
  }, [base, api])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading from the server on mount
    void refreshList()
  }, [refreshList])

  const setDraft = useCallback((next: PuzzleEvent | ((ev: PuzzleEvent) => PuzzleEvent)) => {
    setDraftState((cur) => {
      if (!cur) return cur
      const value = typeof next === 'function' ? next(cur) : next
      if (docRef.current) writeDraft(docRef.current.id, value, draftBase.current)
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
      setNewer(null)
      // Unsaved edits of this event in this browser come back. Made from an older revision (saved since, here or by
      // someone else), they are never slipped in as current: the newer one is shown as a conflict to choose.
      const kept = readDraft(id)
      if (kept && kept.base === d.revision) {
        draftBase.current = d.revision
        setDraftState(kept.payload)
        setConflict(null)
      } else if (kept && JSON.stringify(kept.payload) !== JSON.stringify(d.payload)) {
        draftBase.current = kept.base
        setDraftState(kept.payload)
        setConflict(d)
      } else {
        draftBase.current = d.revision
        setDraftState(d.payload)
        setConflict(null)
      }
    },
    [base, api],
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
    [base, api, open, refreshList],
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
        draftBase.current = d.revision
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
    [base, api, doc, refreshList],
  )

  // A save names the revision the edits were made from - never simply the newest one.
  const save = useCallback(() => (doc && draft ? saveAt(draftBase.current, draft) : Promise.resolve(false)), [doc, draft, saveAt])
  /** Keep my edits: save them on top of the newer revision (it stays in the history). */
  const keepMine = useCallback(() => (conflict && draft ? saveAt(conflict.revision, draft) : Promise.resolve(false)), [conflict, draft, saveAt])
  /** Take the newer revision; my edits are dropped. */
  const takeTheirs = useCallback(() => {
    const theirs = conflict ?? newer
    if (!theirs) return
    draftBase.current = theirs.revision
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
        draftBase.current = d.revision
        setDoc(d)
        return d.payload
      })
    }, POLL_MS)
    return () => clearInterval(t)
  }, [base, api, doc])

  /** Back to the list; unsaved edits stay in this browser for the next open. */
  const close = useCallback(() => {
    setDoc(null)
    setDraftState(null)
    setConflict(null)
    setNewer(null)
    void refreshList()
  }, [refreshList])

  return { call: api, list, doc, draft, setDraft, dirty, open, close, create, clone, save, keepMine, takeTheirs, conflict, newer, status, refreshList, base }
}
