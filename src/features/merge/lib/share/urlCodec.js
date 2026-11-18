import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate'

// Shared gzip+base64url codec for packing a JSON-serializable value into a
// URL-safe query-param string - factored out of stageShare.js (the original
// "?play&stage=..." player-link codec) so planShare.js (the "?plan=..."
// read-only planning-review link) can reuse the exact same plumbing instead
// of a second copy. See stageShare.js's own long-standing comment for why
// gzip specifically (real headroom against GitHub Pages' own Fastly CDN's
// ~8KB URI-length ceiling - found live from a real "sharing is failing for
// the other user" bug report) and fflate over the browser's native
// CompressionStream specifically (CompressionStream/DecompressionStream only
// reached Safari in 16.4, and this app's links are meant to open on a
// phone) - both reasons apply identically to every caller of this codec, not
// just the original stage-sharing use case.
export function encodeToUrlParam(value) {
  const json = JSON.stringify(value)
  const compressed = gzipSync(strToU8(json))
  return bytesToBase64Url(compressed)
}

// Returns null on anything malformed (bad base64, corrupted gzip, invalid
// JSON, or a value `validate` rejects) rather than throwing - callers should
// treat null as "this link is broken," not silently identical to "nothing
// was shared" (see stageShare.js's decodeStage / App.jsx's PlayApp for why
// that distinction matters to how a broken link gets reported to the user).
export function decodeFromUrlParam(encoded, { validate } = {}) {
  if (!encoded) return null
  try {
    const bytes = base64UrlToBytes(encoded)
    const json = strFromU8(gunzipSync(bytes))
    const value = JSON.parse(json)
    if (validate && !validate(value)) return null
    return value
  } catch {
    return null
  }
}

// Chunked to avoid blowing the call stack on String.fromCharCode's argument
// spread for a large compressed payload (fine at the sizes a compressed
// stage/plan produces, but the chunking has no downside either way).
function bytesToBase64Url(bytes) {
  let binary = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(encoded) {
  const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
