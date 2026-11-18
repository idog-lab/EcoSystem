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
// A SHORTER LINK (format 2). Every board of a list carries the same reward
// definitions, containers and drop odds, and a link used to carry them once
// per board - about 4,000 characters for a 3 + 2 board event, long enough
// that chat apps and phones can cut it off (economist: "the link is broken
// to everyone except me"). Now each list carries what its boards share once
// (`shared`), each board only its own fields, and the editor-only tables play
// never reads (the old hand-typed Small Rewards bank and weights, the build
// stamp) are left out. Decoding puts every board back together; a link in
// the older shapes still decodes.
const SHARED_FIELDS = [
  'rewardChainConfig',
  'dropGroups',
  'dropGroupsConfig',
  'minDropRank',
  'multiDropRank',
  'tripleDropRank',
  'soloDropRank',
  'rewardLeftoverPolicy',
  'twisterSpinCost',
  'twisterSpinObjective',
  'targetEv',
  'tier2UnlockRank',
  'tier4UnlockRank',
  'rewardRanks',
  'rewardSyntax',
  'listPhase',
]
const LEFT_OUT = ['smallRewardsBankConfig', 'smallRewardWeightsConfig', 'buildStamp', 'twisterCostBasis', 'onboardingStatus', 'effectiveBlockedValue', 'rewardQueueItems', 'rewardSemiItems', 'forcedSemiRanks', 'rewardTargets']
function packList(list) {
  if (!Array.isArray(list) || list.length === 0) return null
  const shared = {}
  for (const key of SHARED_FIELDS) {
    if (!(key in list[0])) continue
    const first = JSON.stringify(list[0][key])
    if (list.every((b) => JSON.stringify(b[key]) === first)) shared[key] = list[0][key]
  }
  const boards = list.map((b) => {
    const own = {}
    for (const [key, value] of Object.entries(b)) {
      if (key in shared || LEFT_OUT.includes(key)) continue
      own[key] = value
    }
    return own
  })
  return { shared, boards }
}
const unpackList = (packed) => (packed && Array.isArray(packed.boards) ? packed.boards.map((b) => ({ ...(packed.shared ?? {}), ...b })) : null)

export function encodeStage(boards, { rcBoards = null } = {}) {
  return encodeToUrlParam({ v: 2, main: packList(boards), rc: rcBoards && rcBoards.length ? packList(rcBoards) : null })
}

// Returns null on anything malformed rather than throwing - callers should
// treat null as "this link is broken," not silently identical to "no stage
// was shared."
// Returns { boards, rcBoards, rcVariant } (rcBoards null for a main-only
// stage), or null on anything malformed.
export function decodeStage(encoded) {
  const decoded = decodeFromUrlParam(encoded, {
    validate: (v) => (Array.isArray(v) ? v.length > 0 : v?.v === 2 ? (unpackList(v.main)?.length ?? 0) > 0 : Array.isArray(v?.boards) && v.boards.length > 0),
  })
  if (!decoded) return null
  if (decoded.v === 2) {
    const rc = unpackList(decoded.rc)
    return { boards: unpackList(decoded.main), rcBoards: rc && rc.length ? rc : null, rcVariant: null }
  }
  if (Array.isArray(decoded)) return { boards: decoded, rcBoards: null, rcVariant: null }
  return { boards: decoded.boards, rcBoards: Array.isArray(decoded.rcBoards) && decoded.rcBoards.length ? decoded.rcBoards : null, rcVariant: decoded.rcVariant ?? null }
}
