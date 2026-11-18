// Client-side Google Sheets export - creates a real, populated Google Sheet
// from the same Ops sheet data buildWorkbook() turns into an .xlsx, using
// Google Identity Services (GIS) for OAuth and the Sheets API v4 directly
// via fetch. No backend involved (this app has none) - GIS's token-client
// flow is designed to run entirely in the browser. The Client ID below is a
// public identifier, not a secret, safe to embed in client code; the actual
// security boundary is the Authorized JavaScript Origins configured on it
// in Google Cloud Console (localhost:5173 for dev, idoggk.github.io for the
// deployed site) - a token request from any other origin is rejected by
// Google regardless of anyone having read this file.
const GOOGLE_CLIENT_ID = '940778818307-cvvtd93lrcfkkt60545mhb35p5fsgt5v.apps.googleusercontent.com'
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

let gisLoadPromise = null

// Loads Google Identity Services' <script> exactly once no matter how many
// times this is called - later calls reuse the same in-flight/resolved
// promise instead of injecting duplicate <script> tags. Loaded on demand
// (not from index.html) so pages that never touch this export never pay
// for it.
function loadGoogleIdentityScript() {
  if (gisLoadPromise) return gisLoadPromise
  gisLoadPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Identity Services - check your connection and try again.'))
    document.head.appendChild(script)
  })
  return gisLoadPromise
}

// Requests a fresh OAuth access token via GIS's token-client popup flow. No
// refresh token, no persistence across page loads by design (there's no
// backend here to hold one securely) - a new token is requested every time
// an export runs; Google itself skips the consent screen on repeat grants
// for the same account, so this is normally a near-instant popup-and-close
// after the first time. Rejects if the user closes the popup or denies
// consent, or if the signed-in account isn't on the OAuth consent screen's
// test-user list while the app is unverified.
function requestAccessToken() {
  return loadGoogleIdentityScript().then(
    () =>
      new Promise((resolve, reject) => {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: SHEETS_SCOPE,
          callback: (response) => {
            if (response.error) reject(new Error(response.error_description || response.error))
            else resolve(response.access_token)
          },
          error_callback: (err) => reject(new Error(err?.message || 'Google sign-in was cancelled or failed.')),
        })
        tokenClient.requestAccessToken()
      }),
  )
}

async function sheetsApiFetch(path, accessToken, options = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...options.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error?.message || `Google Sheets API error (${res.status})`)
  }
  return res.json()
}

// Creates a real spreadsheet with one tab per entry in `sheets` ({ title,
// rows }, rows a plain 2D array of values - header row first) and populates
// every tab in a single batchUpdate call. Returns the spreadsheet's
// shareable URL. valueInputOption "RAW" (not "USER_ENTERED") is deliberate,
// not just simpler - it never interprets a cell as a formula even if one
// happens to start with "=", which matters here since some cells come from
// free-text economist input (rewardSyntax) that USER_ENTERED mode would
// otherwise be willing to execute as a formula.
// The two request bodies an export sends, built with no network or sign-in
// involved - split out so the payload itself can be checked offline
// (scripts/verify/verify-v2-rewards.mjs) even though actually sending it needs a
// signed-in Google account. A tab title is quoted in its A1 range, so a
// single quote inside a title is doubled, per the Sheets A1 rules.
export function buildSheetsRequests(title, sheets) {
  return {
    create: {
      properties: { title },
      sheets: sheets.map((s) => ({ properties: { title: s.title } })),
    },
    values: {
      valueInputOption: 'RAW',
      data: sheets.map((s) => ({ range: `'${String(s.title).replace(/'/g, "''")}'!A1`, values: s.rows })),
    },
  }
}

// Everything the Sheets API would reject or silently mangle, checked before
// (and without) sending: duplicate or over-long tab titles, characters a tab
// title can't contain, and any cell that isn't a plain string/number/boolean.
// Returns a list of problems - empty means the payload is well-formed.
export function validateSheetsPayload(sheets) {
  const problems = []
  const seen = new Set()
  for (const s of sheets) {
    const title = String(s.title ?? '')
    if (title.length === 0 || title.length > 100) problems.push(`Tab "${title}" has an invalid title length (${title.length}).`)
    if (/[\\/?*[\]:]/.test(title)) problems.push(`Tab "${title}" contains a character Sheets doesn't allow in a tab name.`)
    const lower = title.toLowerCase()
    if (seen.has(lower)) problems.push(`Duplicate tab title "${title}".`)
    seen.add(lower)
    if (!Array.isArray(s.rows)) {
      problems.push(`Tab "${title}" has no rows array.`)
      continue
    }
    s.rows.forEach((row, r) => {
      if (!Array.isArray(row)) return problems.push(`Tab "${title}" row ${r + 1} is not an array.`)
      row.forEach((cell, c) => {
        const t = typeof cell
        const ok = t === 'string' || t === 'boolean' || (t === 'number' && Number.isFinite(cell))
        if (!ok) problems.push(`Tab "${title}" cell R${r + 1}C${c + 1} is ${cell === null ? 'null' : t} - not a plain value.`)
      })
    })
  }
  return problems
}

export async function createGoogleSheet(title, sheets) {
  const problems = validateSheetsPayload(sheets)
  if (problems.length > 0) throw new Error(`Export payload is malformed: ${problems[0]}`)
  const requests = buildSheetsRequests(title, sheets)
  const accessToken = await requestAccessToken()

  const created = await sheetsApiFetch('', accessToken, { method: 'POST', body: JSON.stringify(requests.create) })

  await sheetsApiFetch(`/${created.spreadsheetId}/values:batchUpdate`, accessToken, { method: 'POST', body: JSON.stringify(requests.values) })

  return created.spreadsheetUrl
}
