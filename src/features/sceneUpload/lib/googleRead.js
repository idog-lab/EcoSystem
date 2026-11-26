// READ-ONLY access to Google Sheets and Drive for the scene upload tool.
// Same Google sign-in as Merge Mania's Sheets export (googleSheetsExport.js,
// one Client ID), but with read-only scopes: this tool never writes to a file
// (economist, 26 Nov 2026: the DCX is not updated by the tool until said so).
// The token lives in memory for this visit only.
const GOOGLE_CLIENT_ID = '940778818307-cvvtd93lrcfkkt60545mhb35p5fsgt5v.apps.googleusercontent.com'
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
].join(' ')

let gisLoad = null
let token = null // { value, expires }

function loadGis() {
  if (gisLoad) return gisLoad
  gisLoad = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      gisLoad = null
      reject(new Error('Could not load Google sign-in. Check the connection and try again.'))
    }
    document.head.appendChild(s)
  })
  return gisLoad
}

// ---- The Apps Script connection (appsScript/SceneUploadBridge.gs) ----
// The economist's automations run as Apps Script inside SuperPlay's Google;
// this one does too (asked, 26 Nov 2026: "שיעבור כמו שהאפליקציה של
// האוטומציות עובדת לנו"). The web app is opened two ways at once: hidden
// inside the page and in a small window. Whichever says it is ready first is
// used (the hidden one closes the window by itself; the window is where Google
// asks for authorization the first time). It runs with the permissions of
// whoever is signed in to Google.
let bridgeUrl = null
let bridge = null // { win, origin, kind: 'frame' | 'popup' }
let bridgePopup = null
let bridgeFrame = null
let callNo = 0
const pending = new Map()
const waiters = new Set() // attempts waiting for the connection to say it is ready

/** Use the Apps Script web app at `url` (empty: Google sign-in from the page itself). */
export function setBridgeUrl(url) {
  const u = String(url ?? '').trim()
  bridgeUrl = /^https:\/\/script\.google(usercontent)?\.com\//.test(u) ? u : null
}
export const usingBridge = () => Boolean(bridgeUrl)

if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (!/\.googleusercontent\.com$|^https:\/\/script\.google\.com$/.test(e.origin)) return
    const m = e.data || {}
    if (m.type === 'scene-bridge-ready') {
      if (!waiters.size && bridgeOpen()) return
      const kind = m.mode === 'frame' ? 'frame' : 'popup'
      bridge = { win: e.source, origin: e.origin, kind }
      if (kind === 'frame' && bridgePopup && !bridgePopup.closed) bridgePopup.close()
      if (kind === 'popup') removeFrame()
      for (const w of [...waiters]) w()
    } else if (m.type === 'scene-bridge-result' && pending.has(m.id)) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      if (m.ok) p.resolve(m.result)
      else p.reject(new Error(m.error || 'The Google connection could not read this.'))
    }
  })
}

function removeFrame() {
  bridgeFrame?.remove()
  bridgeFrame = null
}

function bridgeOpen() {
  if (!bridge) return false
  if (bridge.kind === 'frame') return Boolean(bridgeFrame?.isConnected)
  return Boolean(bridgePopup && !bridgePopup.closed)
}

/** Opens the connection. Called straight from a click, so the browser lets the window open. */
function bridgeConnect() {
  if (bridgeOpen()) return Promise.resolve()
  bridge = null
  removeFrame()
  const sep = bridgeUrl.includes('?') ? '&' : '?'
  bridgeFrame = document.createElement('iframe')
  bridgeFrame.src = `${bridgeUrl}${sep}mode=frame`
  bridgeFrame.title = 'Google connection'
  bridgeFrame.setAttribute('aria-hidden', 'true')
  bridgeFrame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;border:0;opacity:0'
  document.body.appendChild(bridgeFrame)
  bridgePopup = window.open(`${bridgeUrl}${sep}mode=popup`, 'scene-upload-google', 'width=480,height=360')
  const popupOpened = Boolean(bridgePopup)
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer)
      waiters.delete(done)
      resolve()
    }
    const timer = setTimeout(() => {
      if (!waiters.delete(done)) return
      reject(new Error(popupOpened
        ? 'The Google connection did not answer. If the small window asked you to authorize, do so, then click Read from Google again.'
        : 'The browser blocked the Google connection window. Allow pop-ups for this page and try again.'))
    }, popupOpened ? 180_000 : 15_000)
    waiters.add(done)
  })
}

async function bridgeCall(action, args) {
  if (!bridgeOpen()) await bridgeConnect()
  const id = ++callNo
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    bridge.win.postMessage({ type: 'scene-bridge-call', id, action, args }, bridge.origin)
  })
}

export function isConnected() {
  if (bridgeUrl) return bridgeOpen()
  return Boolean(token && token.expires > Date.now() + 60_000)
}

/** Opens the Google connection: the Apps Script window, or Google's sign-in popup. */
export async function connect() {
  if (bridgeUrl) return bridgeConnect()
  if (isConnected()) return
  await loadGis()
  await new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: (r) => {
        if (r.error) return reject(new Error(r.error_description || r.error))
        token = { value: r.access_token, expires: Date.now() + (Number(r.expires_in) || 3600) * 1000 }
        resolve()
      },
      error_callback: (e) => reject(new Error(e?.message || 'Google sign-in was closed or failed.')),
    })
    client.requestAccessToken()
  })
}

async function api(url) {
  if (!isConnected()) await connect()
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token.value}` } })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const msg = body?.error?.message || `Google answered ${res.status}`
    throw new Error(res.status === 403 || res.status === 404 ? `${msg} (no access to this file, or the link is wrong)` : msg)
  }
  return res.json()
}

/** The spreadsheet id inside any Google Sheets link (or the id itself). */
export function sheetIdOf(link) {
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(String(link ?? ''))
  if (m) return m[1]
  const bare = String(link ?? '').trim()
  return /^[a-zA-Z0-9_-]{20,}$/.test(bare) ? bare : null
}
export function gidOf(link) {
  const m = /[#&?]gid=(\d+)/.exec(String(link ?? ''))
  return m ? Number(m[1]) : null
}
export function folderIdOf(link) {
  const m = /\/folders\/([a-zA-Z0-9_-]{10,})/.exec(String(link ?? ''))
  if (m) return m[1]
  const bare = String(link ?? '').trim()
  return /^[a-zA-Z0-9_-]{10,}$/.test(bare) ? bare : null
}
export const sheetUrl = (id, gid) => `https://docs.google.com/spreadsheets/d/${id}/edit${gid != null ? `#gid=${gid}` : ''}`
export const folderUrl = (id) => `https://drive.google.com/drive/folders/${id}`

/** Title and tabs of a spreadsheet. */
export async function sheetInfo(id) {
  if (bridgeUrl) return bridgeCall('info', [id])
  const r = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title,sheets.properties(sheetId,title)`)
  return { title: r.properties?.title ?? '', tabs: (r.sheets ?? []).map((s) => ({ id: s.properties.sheetId, title: s.properties.title })) }
}

const q = (tab) => `'${String(tab).replace(/'/g, "''")}'`

/** Several ranges at once; numbers come back as numbers. Returns arrays of rows, in order. */
export async function readRanges(id, ranges) {
  if (bridgeUrl) return bridgeCall('values', [id, ranges])
  const params = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&')
  const r = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${params}&valueRenderOption=UNFORMATTED_VALUE`)
  return (r.valueRanges ?? []).map((v) => v.values ?? [])
}
export async function readTab(id, tab, cols = 'A:Z') {
  const [rows] = await readRanges(id, [`${q(tab)}!${cols}`])
  return rows
}

/** Children of a Drive folder (shared drives included), newest first. */
export async function listFolder(folderId) {
  if (bridgeUrl) return bridgeCall('folder', [folderId])
  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`)
  const r = await api(
    `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=createdTime desc&pageSize=200` +
      '&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,createdTime,modifiedTime)',
  )
  return r.files ?? []
}
export const FOLDER_MIME = 'application/vnd.google-apps.folder'
export const SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
