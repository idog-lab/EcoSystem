// NATIVE GOOGLE SHEETS OUTPUT: copy the template of the event's mode into a
// Drive folder the economist picks, clear and fill the mapped ranges of the
// copy, return its link. The source templates are only read (files.copy);
// nothing is written to them. Values are sent RAW: a number stays a number,
// a text stays a text, blanks stay blank.
//
// NOT VERIFIED END TO END: it needs a Google sign-in with Drive access for
// the toolkit's OAuth client (the same client the Merge export uses, which
// was set up for Sheets only). The cell plan it sends is held by tests.

import type { ExportPlan } from '../engine/exportPlan'
import { TEMPLATES } from '../engine/exportPlan'

const GOOGLE_CLIENT_ID = '940778818307-cvvtd93lrcfkkt60545mhb35p5fsgt5v.apps.googleusercontent.com'
/** Drive: to copy a template that lives on a shared drive and place the copy in a folder. Sheets: to fill it. */
const SCOPES = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets'

type TokenResponse = { access_token?: string; error?: string; error_description?: string }
type GoogleGlobal = { accounts: { oauth2: { initTokenClient: (o: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback: (e: { message?: string }) => void }) => { requestAccessToken: () => void } } } }

let gis: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (gis) return gis
  gis = new Promise((resolve, reject) => {
    if ((window as unknown as { google?: GoogleGlobal }).google?.accounts?.oauth2) return resolve()
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Google sign-in could not be loaded. Check the connection and try again.'))
    document.head.appendChild(s)
  })
  return gis
}

async function accessToken(): Promise<string> {
  await loadGis()
  const g = (window as unknown as { google: GoogleGlobal }).google
  return new Promise((resolve, reject) => {
    g.accounts.oauth2
      .initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: (r) => (r.error || !r.access_token ? reject(new Error(r.error_description || r.error || 'No access was given.')) : resolve(r.access_token)),
        error_callback: (e) => reject(new Error(e?.message || 'Google sign-in was cancelled.')),
      })
      .requestAccessToken()
  })
}

async function call<T>(url: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  if (!res.ok) throw new Error(json?.error?.message || `Google answered ${res.status}.`)
  return json as T
}

/** A folder link or a bare id -> the id. */
export function folderIdOf(input: string): string | null {
  const t = input.trim()
  const m = t.match(/\/folders\/([A-Za-z0-9_-]+)/) ?? t.match(/[?&]id=([A-Za-z0-9_-]+)/)
  if (m) return m[1]!
  return /^[A-Za-z0-9_-]{10,}$/.test(t) ? t : null
}

export async function exportToGoogleSheets(plan: ExportPlan, folderId: string, fileName = plan.title): Promise<{ id: string; url: string; title: string }> {
  const token = await accessToken()
  const template = TEMPLATES[plan.template]
  const copy = await call<{ id: string }>(`https://www.googleapis.com/drive/v3/files/${template.id}/copy?supportsAllDrives=true&fields=id`, token, { name: fileName, parents: [folderId] })
  const sheets = `https://sheets.googleapis.com/v4/spreadsheets/${copy.id}`
  if (plan.clears.length) await call(`${sheets}/values:batchClear`, token, { ranges: plan.clears })
  await call(`${sheets}/values:batchUpdate`, token, { valueInputOption: 'RAW', data: plan.writes.map((w) => ({ range: w.range, values: w.values })) })
  return { id: copy.id, url: `https://docs.google.com/spreadsheets/d/${copy.id}/edit`, title: fileName }
}
