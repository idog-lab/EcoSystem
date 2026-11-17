import { encodeToUrlParam, decodeFromUrlParam } from './urlCodec'

// Packs a board list into a URL-safe string so a designed stage can be
// shared as a link (?play&stage=...) rather than relying on localStorage,
// which is per-browser and wouldn't reach anyone else's device.
//
// The actual gzip+base64url codec lives in urlCodec.js now, shared with
// planShare.js's own "?plan=..." read-only link - this file just supplies
// the stage-specific shape/validation and the MAX_SAFE_STAGE_CHARS warning
// threshold. See urlCodec.js's own comment for why gzip (real headroom
// against GitHub Pages' Fastly CDN's ~8KB URI-length ceiling - found live,
// the hard way: a realistic multi-board stage produced a URL long enough to
// get a flat HTTP 414 before this app's JS ever ran) and fflate specifically
// (not the browser's native CompressionStream, which only reached Safari in
// 16.4 - this feature is meant to be played on a phone) were chosen.
//
// Compression alone doesn't remove the ceiling, just raises it -
// MAX_SAFE_STAGE_CHARS is a conservative warning threshold (see App.jsx's
// handleShare) for when a stage is large enough that its *compressed* link
// might still be at risk, on this CDN or a stricter corporate proxy with a
// similar class of limit.
export const MAX_SAFE_STAGE_CHARS = 6000

// A stage is the playable main chain plus, when the sender chose one, the RC
// variant it hands over to: { boards, rcBoards, rcVariant }. Every board
// travels with its own saved settings (generator EV and tiers, reward
// definitions, drop groups and odds, drop start rank, leftover policy), so
// the recipient's session re-reads the RC variant's own economy at the
// transition exactly as the editor's Play Tester does. A bare array is still
// accepted on decode - that is what every link shared before this carried
// (main chain only, no RC).
export function encodeStage(boards, { rcBoards = null, rcVariant = null } = {}) {
  return encodeToUrlParam(rcBoards && rcBoards.length ? { boards, rcBoards, rcVariant } : boards)
}

// Returns null on anything malformed rather than throwing - callers should
// treat null as "this link is broken," not silently identical to "no stage
// was shared."
// Returns { boards, rcBoards, rcVariant } (rcBoards null for a main-only
// stage), or null on anything malformed.
export function decodeStage(encoded) {
  const decoded = decodeFromUrlParam(encoded, {
    validate: (v) => (Array.isArray(v) ? v.length > 0 : Array.isArray(v?.boards) && v.boards.length > 0),
  })
  if (!decoded) return null
  if (Array.isArray(decoded)) return { boards: decoded, rcBoards: null, rcVariant: null }
  return { boards: decoded.boards, rcBoards: Array.isArray(decoded.rcBoards) && decoded.rcBoards.length ? decoded.rcBoards : null, rcVariant: decoded.rcVariant ?? null }
}
