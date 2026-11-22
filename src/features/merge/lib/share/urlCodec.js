import { gzipSync, gunzipSync, deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate'

// Shared codec for packing a JSON-serializable value into a URL-safe
// query-param string - factored out of stageShare.js (the player link's
// codec) so planShare.js (the "?plan=..."
// read-only planning-review link) can reuse the exact same plumbing instead
// of a second copy. See stageShare.js's own long-standing comment for why
// gzip specifically (real headroom against GitHub Pages' own Fastly CDN's
// ~8KB URI-length ceiling - found live from a real "sharing is failing for
// the other user" bug report) and fflate over the browser's native
// CompressionStream specifically (CompressionStream/DecompressionStream only
// reached Safari in 16.4, and this app's links are meant to open on a
// phone) - both reasons apply identically to every caller of this codec, not
// just the original stage-sharing use case.
//
// LETTERS AND DIGITS ONLY. The packed value used to be written in base64url,
// whose alphabet has "-" and "_" in it, and a link is sent through chat apps:
// they end a link at such a character, wrap it there, or turn "--" into a
// long dash - the person receiving it then opens half a link (economist: "in
// the link of the stage we got a - and it breaks the link when sent"). So a
// link is now written with 0-9, A-Z and a-z only (base 62), behind one marker
// letter (ALNUM_MARK). It is about 1% longer than base64url. A link in the
// older writing always starts with "H4sI" (the gzip header) and still opens.
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const ALNUM_MARK = 'A'
const ALNUM_VALUE = new Map([...ALNUM].map((ch, i) => [ch, i]))
// Eight base-62 digits at a time: 62^8 is still an exact whole number.
const CHUNK_DIGITS = 8
const CHUNK_BASE = 62 ** CHUNK_DIGITS

// A SHORTER WRITING, behind the marker letter "B" (economist: "i also want u to
// make sure the link of the stage as short as possible"): raw deflate at its
// highest level - no gzip header and checksum, 18 bytes less - against a
// DICTIONARY the caller supplies: text that links of its kind have in common,
// so a link only carries what is its own. The dictionary is part of the
// writing: the same bytes are needed to read a link back, for ever. A caller
// never changes its dictionary - a new one gets a new marker letter.
const COMPACT_MARK = 'B'
export function encodeCompactToUrlParam(value, dictionaryText) {
  const compressed = deflateSync(strToU8(JSON.stringify(value)), { level: 9, mem: 12, dictionary: strToU8(dictionaryText) })
  return COMPACT_MARK + bytesToAlnum(compressed)
}

export function encodeToUrlParam(value) {
  const json = JSON.stringify(value)
  const compressed = gzipSync(strToU8(json))
  return ALNUM_MARK + bytesToAlnum(compressed)
}

// Returns null on anything malformed (bad base64, corrupted gzip, invalid
// JSON, or a value `validate` rejects) rather than throwing - callers should
// treat null as "this link is broken," not silently identical to "nothing
// was shared" (see stageShare.js's decodeStage / App.jsx's PlayApp for why
// that distinction matters to how a broken link gets reported to the user).
// (`dictionaryText`: the dictionary of the caller's compact writing, for a link that starts with "B".)
export function decodeFromUrlParam(encoded, { validate, dictionaryText = null } = {}) {
  if (!encoded) return null
  try {
    let json
    if (encoded.startsWith(COMPACT_MARK) && dictionaryText != null) {
      json = strFromU8(inflateSync(alnumToBytes(encoded.slice(COMPACT_MARK.length)), { dictionary: strToU8(dictionaryText) }))
    } else {
      const bytes = encoded.startsWith(ALNUM_MARK) ? alnumToBytes(encoded.slice(ALNUM_MARK.length)) : base64UrlToBytes(encoded)
      json = strFromU8(gunzipSync(bytes))
    }
    const value = JSON.parse(json)
    if (validate && !validate(value)) return null
    return value
  } catch {
    return null
  }
}

// The bytes as one big number, written in base 62. A 1 is put in front so
// leading zero bytes are not lost.
function bytesToAlnum(bytes) {
  let hex = '01'
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  let n = BigInt(`0x${hex}`)
  const base = BigInt(CHUNK_BASE)
  const zero = BigInt(0)
  const chunks = []
  while (n > zero) {
    let rest = Number(n % base)
    n /= base
    let chunk = ''
    for (let i = 0; i < CHUNK_DIGITS; i++) {
      chunk = ALNUM[rest % 62] + chunk
      rest = Math.floor(rest / 62)
    }
    chunks.push(chunk)
  }
  const top = chunks.pop().replace(/^0+/, '')
  return top + chunks.reverse().join('')
}

// Anything that is not a letter or a digit is dropped first: a full stop or a
// bracket a sentence put after the link, a space or a line break a chat app
// put inside it - none of them can be part of the link.
function alnumToBytes(text) {
  const clean = text.replace(/[^0-9A-Za-z]/g, '')
  if (!clean) throw new Error('empty link')
  const padded = '0'.repeat((CHUNK_DIGITS - (clean.length % CHUNK_DIGITS)) % CHUNK_DIGITS) + clean
  const base = BigInt(CHUNK_BASE)
  let n = BigInt(0)
  for (let i = 0; i < padded.length; i += CHUNK_DIGITS) {
    let chunk = 0
    for (let j = 0; j < CHUNK_DIGITS; j++) chunk = chunk * 62 + ALNUM_VALUE.get(padded[i + j])
    n = n * base + BigInt(chunk)
  }
  let hex = n.toString(16)
  if (hex.length % 2) hex = `0${hex}`
  if (hex.slice(0, 2) !== '01') throw new Error('not a link of this app')
  const bytes = new Uint8Array(hex.length / 2 - 1)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16)
  return bytes
}

function base64UrlToBytes(encoded) {
  const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
