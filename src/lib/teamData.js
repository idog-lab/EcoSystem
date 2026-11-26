// TEAM DATA ON GITHUB (economist, 26 Nov 2026: "i want the site to be live, with live data between all the users" -
// asked where the server should run: "i think we need to focus on the memory to live in github"; chose a private
// repository for it, idog-lab/EcoSystem-data, open to every collaborator; shared first: the Economy page, saved Merge
// events, Chef and Diamond Mine).
//
// Every tool keeps saving in this browser exactly as before; this copies what is saved to files in the private data
// repository, and when the app opens it first brings the team's newest files in. One file a thing:
//   economy/economy.json, economy/segment-plan.json, chef/chefs.json, diamond-mine/state.json,
//   merge/saved-events/<id>.json ({ meta, data } - meta the saved-events list's entry, data as this browser keeps it).
// Every save is a commit in that repository, with who made it and when: the history of every change.
//
// Each person connects once with a GitHub token (kept in this browser only, under a key "Download all my data"
// never takes). A save that finds the file changed by someone since it was read never writes over it: both are
// kept and the person chooses (the team's, or theirs over the team's). Without a token nothing here runs.

export const DATA_REPO = { owner: 'idog-lab', repo: 'EcoSystem-data', branch: 'main' }
const API = 'https://api.github.com'
const TOKEN_KEY = 'ecotk-team-token'
const STATE_KEY = 'ecotk-team-state' // { [path]: { sha, hash } } - each file as last synced from this browser
const USER_KEY = 'ecotk-team-user'

// What is shared, besides the saved events.
export const SHARED_ITEMS = [
  { key: 'superplay-economy', path: 'economy/economy.json', label: 'Economy page' },
  { key: 'economy-segment-plan', path: 'economy/segment-plan.json', label: 'Segment plan (Economy page)' },
  { key: 'economy-segment-sets', path: 'economy/segment-sets.json', label: 'Segment sets (Economy page)' },
  { key: 'merge-mania-chef', path: 'chef/chefs.json', label: 'Chef' },
  { key: 'merge-mania-diamond-mine', path: 'diamond-mine/state.json', label: 'Diamond Mine' },
]
const EVENTS_DIR = 'merge/saved-events'
const EVENTS_INDEX = 'merge-mania-saved-events'
const EVENT_PREFIX = 'merge-mania-saved-event:'
const eventPath = (id) => `${EVENTS_DIR}/${id}.json`

// --- Small helpers --------------------------------------------------------------

// FNV-1a over the text, with its length: equal texts, equal marks.
export function hashText(text) {
  let h = 0x811c9dc5
  const s = String(text ?? '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(16)}-${s.length}`
}
const toBase64 = (text) => {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
const fromBase64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(String(b64).replace(/\s/g, '')), (c) => c.charCodeAt(0)))
// A stored JSON text in the form the file keeps (indented, so the history reads); text that is not JSON as it is.
const fileForm = (raw) => {
  try {
    return JSON.stringify(JSON.parse(raw), null, 1)
  } catch {
    return raw
  }
}
const storedForm = (text) => {
  try {
    return JSON.stringify(JSON.parse(text))
  } catch {
    return text
  }
}

// --- The team data of one browser ------------------------------------------------

// fetchFn, storage and timers are given by the checks; the app uses the browser's.
export function createTeamData({ fetchFn = (...a) => globalThis.fetch(...a), storage = () => globalThis.localStorage, debounceMs = 1500, setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t) } = {}) {
  const store = () => {
    try {
      return storage() ?? null
    } catch {
      return null
    }
  }
  const get = (k) => {
    try {
      return store()?.getItem(k) ?? null
    } catch {
      return null
    }
  }
  const set = (k, v) => store()?.setItem(k, v)
  const remove = (k) => store()?.removeItem(k)
  const readJson = (k, fallback) => {
    try {
      return JSON.parse(get(k) ?? 'null') ?? fallback
    } catch {
      return fallback
    }
  }
  const state = () => readJson(STATE_KEY, {})
  const setState = (path, entry) => {
    const s = state()
    if (entry) s[path] = entry
    else delete s[path]
    set(STATE_KEY, JSON.stringify(s))
  }

  // Status for the screen: { state: 'off'|'idle'|'syncing'|'saved'|'error'|'conflict', message, at, conflicts }.
  let status = { state: get(TOKEN_KEY) ? 'idle' : 'off', message: '', at: null, conflicts: [] }
  const listeners = new Set()
  const setStatus = (patch) => {
    status = { ...status, ...patch }
    listeners.forEach((f) => f(status))
  }
  const addConflict = (c) => setStatus({ state: 'conflict', conflicts: [...status.conflicts.filter((x) => x.path !== c.path), c], message: '' })

  // --- GitHub ---
  const token = () => get(TOKEN_KEY)
  async function call(method, path, body, tok = token()) {
    let res
    try {
      res = await fetchFn(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      })
    } catch (e) {
      return { status: 0, ok: false, json: null, offline: true, error: e }
    }
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return { status: res.status, ok: res.ok, json }
  }
  const repoPath = (p) => `/repos/${DATA_REPO.owner}/${DATA_REPO.repo}/contents/${p}`
  // A file: { sha, text } or null when it does not exist. (Over 1 MB the content comes by its blob.)
  async function readFile(path) {
    const r = await call('GET', `${repoPath(path)}?ref=${DATA_REPO.branch}`)
    if (r.status === 404) return null
    if (!r.ok) throw failure(r)
    let b64 = r.json?.content
    if (!b64 && r.json?.size > 0) {
      const blob = await call('GET', `/repos/${DATA_REPO.owner}/${DATA_REPO.repo}/git/blobs/${r.json.sha}`)
      if (!blob.ok) throw failure(blob)
      b64 = blob.json?.content
    }
    return { sha: r.json.sha, text: b64 ? fromBase64(b64) : '' }
  }
  async function listDir(path) {
    const r = await call('GET', `${repoPath(path)}?ref=${DATA_REPO.branch}`)
    if (r.status === 404) return []
    if (!r.ok) throw failure(r)
    return Array.isArray(r.json) ? r.json.filter((f) => f.type === 'file' && f.name.endsWith('.json')) : []
  }
  const who = () => readJson(USER_KEY, null)?.login ?? 'someone'
  // { ok, sha } | { ok: false, stale: true } (someone wrote the file since) | throws on any other failure.
  async function writeFile(path, text, sha, label) {
    const r = await call('PUT', repoPath(path), { message: `${label}: saved by ${who()}`, content: toBase64(text), branch: DATA_REPO.branch, ...(sha ? { sha } : {}) })
    if (r.ok) return { ok: true, sha: r.json?.content?.sha }
    if (r.status === 409 || r.status === 422) return { ok: false, stale: true }
    throw failure(r)
  }
  async function deleteFile(path, sha, label) {
    const r = await call('DELETE', repoPath(path), { message: `${label}: deleted by ${who()}`, sha, branch: DATA_REPO.branch })
    if (r.ok || r.status === 404) return { ok: true }
    if (r.status === 409 || r.status === 422) return { ok: false, stale: true }
    throw failure(r)
  }
  function failure(r) {
    if (r.offline) return new Error('GitHub could not be reached. Your work is kept in this browser and goes to the team when GitHub can be reached.')
    if (r.status === 401) return new Error('GitHub refused the token: it may have expired or been deleted. Connect again with a new one.')
    if (r.status === 403 || r.status === 404) return new Error(`This token cannot reach ${DATA_REPO.owner}/${DATA_REPO.repo}: accept the invitation to it on GitHub, or give the token access to it.`)
    return new Error(`GitHub answered ${r.status}${r.json?.message ? `: ${r.json.message}` : ''}.`)
  }

  // --- One shared item (economy, segment plan, Chef, Diamond Mine) ---
  const localItem = (item) => {
    const raw = get(item.key)
    return raw == null ? null : fileForm(raw)
  }
  async function syncItem(item, out) {
    const local = localItem(item)
    const st = state()[item.path]
    const remote = await readFile(item.path)
    if (!remote) {
      if (local != null) await pushItem(item, out, null)
      return
    }
    const remoteHash = hashText(remote.text)
    const localHash = local != null ? hashText(local) : null
    if (localHash === remoteHash) return setState(item.path, { sha: remote.sha, hash: remoteHash })
    if (local == null || (st && st.hash === localHash)) return takeItem(item, remote, out)
    if (st && st.sha === remote.sha) return pushItem(item, out, remote.sha)
    addConflict({ path: item.path, kind: 'item', key: item.key, label: item.label, remote })
  }
  function takeItem(item, remote, out) {
    set(item.key, storedForm(remote.text))
    setState(item.path, { sha: remote.sha, hash: hashText(remote.text) })
    out?.taken.push(item.label)
  }
  async function pushItem(item, out, sha = state()[item.path]?.sha ?? null) {
    const local = localItem(item)
    if (local == null) return
    const hash = hashText(local)
    const w = await writeFile(item.path, local, sha, item.label)
    if (w.ok) {
      setState(item.path, { sha: w.sha, hash })
      out?.sent.push(item.label)
      return
    }
    // Written by someone since: the same as ours is no conflict; anything else is the person's to choose.
    const remote = await readFile(item.path)
    if (remote && hashText(remote.text) === hash) return setState(item.path, { sha: remote.sha, hash })
    if (remote) addConflict({ path: item.path, kind: 'item', key: item.key, label: item.label, remote })
    else {
      const again = await writeFile(item.path, local, null, item.label)
      if (again.ok) setState(item.path, { sha: again.sha, hash })
    }
  }

  // --- The saved Merge events: one file each ---
  const index = () => {
    const list = readJson(EVENTS_INDEX, [])
    return Array.isArray(list) ? list.filter((e) => e && typeof e.id === 'string') : []
  }
  const localEvent = (id) => {
    const meta = index().find((e) => e.id === id)
    const data = get(EVENT_PREFIX + id)
    return meta && data != null ? JSON.stringify({ meta, data }, null, 1) : null
  }
  const eventLabel = (id, text) => {
    try {
      return `Saved event "${JSON.parse(text).meta.name}"`
    } catch {
      return `Saved event ${id}`
    }
  }
  function takeEvent(id, remote, out) {
    const { meta, data } = JSON.parse(remote.text)
    set(EVENT_PREFIX + id, data)
    set(EVENTS_INDEX, JSON.stringify([...index().filter((e) => e.id !== id), { ...meta, id }]))
    setState(eventPath(id), { sha: remote.sha, hash: hashText(remote.text) })
    out?.taken.push(eventLabel(id, remote.text))
  }
  function dropLocalEvent(id, out) {
    const text = localEvent(id)
    remove(EVENT_PREFIX + id)
    set(EVENTS_INDEX, JSON.stringify(index().filter((e) => e.id !== id)))
    setState(eventPath(id), null)
    out?.taken.push(`${eventLabel(id, text)} (deleted by the team)`)
  }
  async function pushEvent(id, out, sha = state()[eventPath(id)]?.sha ?? null) {
    const local = localEvent(id)
    if (local == null) return
    const hash = hashText(local)
    const label = eventLabel(id, local)
    const w = await writeFile(eventPath(id), local, sha, label)
    if (w.ok) {
      setState(eventPath(id), { sha: w.sha, hash })
      out?.sent.push(label)
      return
    }
    const remote = await readFile(eventPath(id))
    if (remote && hashText(remote.text) === hash) return setState(eventPath(id), { sha: remote.sha, hash })
    if (remote) addConflict({ path: eventPath(id), kind: 'event', id, label, remote })
    else {
      const again = await writeFile(eventPath(id), local, null, label)
      if (again.ok) setState(eventPath(id), { sha: again.sha, hash })
    }
  }
  async function syncEvents(out) {
    const remoteFiles = new Map((await listDir(EVENTS_DIR)).map((f) => [f.name.replace(/\.json$/, ''), f]))
    const st = state()
    const knownIds = Object.keys(st).filter((p) => p.startsWith(`${EVENTS_DIR}/`)).map((p) => p.slice(EVENTS_DIR.length + 1).replace(/\.json$/, ''))
    const ids = new Set([...remoteFiles.keys(), ...index().map((e) => e.id), ...knownIds])
    for (const id of ids) {
      const path = eventPath(id)
      const remoteFile = remoteFiles.get(id)
      const local = localEvent(id)
      const s = st[path]
      if (remoteFile && local != null) {
        const localHash = hashText(local)
        if (s && s.sha === remoteFile.sha) {
          if (s.hash !== localHash) await pushEvent(id, out, remoteFile.sha)
          continue
        }
        const remote = await readFile(path)
        const remoteHash = hashText(remote.text)
        if (remoteHash === localHash) setState(path, { sha: remote.sha, hash: remoteHash })
        else if (s && s.hash === localHash) takeEvent(id, remote, out)
        else addConflict({ path, kind: 'event', id, label: eventLabel(id, local), remote })
      } else if (remoteFile) {
        // Here before and deleted in this browser since: deleted for the team too (unless changed by someone since).
        if (s && s.sha === remoteFile.sha) {
          const d = await deleteFile(path, remoteFile.sha, `Saved event ${id}`)
          if (d.ok) setState(path, null)
        } else takeEvent(id, await readFile(path), out)
      } else if (local != null) {
        // Deleted by the team since this browser had it: gone here too, unless it was changed here since.
        if (s && s.hash === hashText(local)) dropLocalEvent(id, out)
        else await pushEvent(id, out, null)
      } else if (s) setState(path, null)
    }
  }

  // --- Syncing ---
  let running = null
  // Brings the team's newest files in and sends what changed here. { taken: [labels], sent: [labels] }.
  async function sync() {
    if (!token()) return { taken: [], sent: [] }
    if (running) return running
    running = (async () => {
      const out = { taken: [], sent: [] }
      setStatus({ state: 'syncing', message: '' })
      try {
        for (const item of SHARED_ITEMS) await syncItem(item, out)
        await syncEvents(out)
        setStatus(status.conflicts.length ? { state: 'conflict' } : { state: 'saved', at: new Date().toISOString(), message: '' })
      } catch (e) {
        setStatus({ state: 'error', message: e.message })
      }
      return out
    })()
    try {
      return await running
    } finally {
      running = null
    }
  }

  // After a save here (called by each tool's save): sent after a short pause, so a run of changes is one commit.
  const timers = new Map()
  function later(id, job) {
    if (!token()) return
    if (timers.has(id)) clearTimer(timers.get(id))
    setStatus({ state: 'syncing' })
    timers.set(
      id,
      setTimer(async () => {
        timers.delete(id)
        try {
          await job()
          if (!timers.size) setStatus(status.conflicts.length ? { state: 'conflict' } : { state: 'saved', at: new Date().toISOString(), message: '' })
        } catch (e) {
          setStatus({ state: 'error', message: e.message })
        }
      }, debounceMs),
    )
  }
  function changed(key) {
    const item = SHARED_ITEMS.find((i) => i.key === key)
    if (!item) return
    later(item.path, async () => {
      const local = localItem(item)
      if (local == null || hashText(local) === state()[item.path]?.hash) return
      await pushItem(item, null)
    })
  }
  const eventChanged = (id) => later(eventPath(id), () => pushEvent(id, null))
  function eventDeleted(id) {
    later(eventPath(id), async () => {
      const s = state()[eventPath(id)]
      if (!s) return
      const d = await deleteFile(eventPath(id), s.sha, `Saved event ${id}`)
      if (d.ok) setState(eventPath(id), null)
      else {
        // Changed by someone since: it comes back here rather than their change being lost.
        const remote = await readFile(eventPath(id))
        if (remote) takeEvent(id, remote, null)
      }
    })
  }

  // A conflict chosen: 'theirs' takes the team's file, 'mine' writes this browser's over it.
  async function resolve(path, choice) {
    const c = status.conflicts.find((x) => x.path === path)
    if (!c) return
    try {
      if (c.kind === 'item') {
        const item = SHARED_ITEMS.find((i) => i.key === c.key)
        if (choice === 'theirs') takeItem(item, c.remote, null)
        else await pushItem(item, null, c.remote.sha)
      } else if (choice === 'theirs') takeEvent(c.id, c.remote, null)
      else await pushEvent(c.id, null, c.remote.sha)
      const conflicts = status.conflicts.filter((x) => x.path !== path)
      setStatus({ conflicts, state: conflicts.length ? 'conflict' : 'saved', at: new Date().toISOString() })
    } catch (e) {
      setStatus({ state: 'error', message: e.message })
    }
  }

  // Connecting: the token is checked (who it is, and that it reaches the data repository) before it is kept.
  async function connect(newToken) {
    const tok = String(newToken ?? '').trim()
    if (!tok) return { ok: false, message: 'Paste a token first.' }
    const user = await call('GET', '/user', null, tok)
    if (!user.ok) return { ok: false, message: failure(user).message }
    const repo = await call('GET', `/repos/${DATA_REPO.owner}/${DATA_REPO.repo}`, null, tok)
    if (!repo.ok) return { ok: false, message: failure(repo).message }
    if (repo.json?.permissions && !repo.json.permissions.push) return { ok: false, message: `This token can read ${DATA_REPO.owner}/${DATA_REPO.repo} but not write to it: give it write access ("Contents: Read and write").` }
    set(TOKEN_KEY, tok)
    set(USER_KEY, JSON.stringify({ login: user.json.login, name: user.json.name ?? null }))
    setStatus({ state: 'idle', message: '', conflicts: [] })
    const result = await sync()
    return { ok: true, user: user.json.login, ...result }
  }
  function disconnect() {
    remove(TOKEN_KEY)
    remove(USER_KEY)
    remove(STATE_KEY)
    timers.forEach((t) => clearTimer(t))
    timers.clear()
    setStatus({ state: 'off', message: '', conflicts: [], at: null })
  }

  return {
    connect,
    disconnect,
    sync,
    changed,
    eventChanged,
    eventDeleted,
    resolve,
    isConnected: () => !!token(),
    user: () => readJson(USER_KEY, null),
    status: () => status,
    subscribe: (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    // (For the checks: wait for what is pending.)
    pending: () => timers.size,
  }
}

// The app's one copy.
export const teamData = createTeamData()
