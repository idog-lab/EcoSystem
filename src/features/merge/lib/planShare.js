import { encodeToUrlParam, decodeFromUrlParam } from './urlCodec'

// Packs EVERY segment's own main-list planning config into a URL-safe string
// for the "Share planning" read-only link (?plan=...) - by explicit
// economist request for a way to send coworkers a read-only view of "the
// full simulator," not just a playable stage (see App.jsx's PlanApp). Same
// gzip+base64url codec as stageShare.js's own player-link sharing (factored
// into urlCodec.js), just a different payload shape: an array of
// `{ name, boards, targetSubsidy, eventStartDate, eventDurationDays }`, one
// entry per segment, main list only - Recompletion and presets are
// deliberately NOT included, matching "Share stage"'s own existing scope
// (recompletion boards were never asked to be shareable, and presets are an
// iteration tool with nothing to show a reviewer).
//
// A plan carries EVERY segment at once (unlike a stage, which is a single
// board list), so this payload is expected to be meaningfully bigger on
// average than a shared stage - MAX_SAFE_PLAN_CHARS is a lower, more
// conservative warning threshold than MAX_SAFE_STAGE_CHARS for exactly that
// reason (see App.jsx's handleSharePlan). It's still only a warning, not a
// hard block - the sender's call whether to send it anyway, same as stage
// sharing.
export const MAX_SAFE_PLAN_CHARS = 4000

export function encodePlan(segments) {
  return encodeToUrlParam(segments)
}

// Returns null on anything malformed rather than throwing - callers should
// treat null as "this link is broken," not silently identical to "no plan
// was shared."
export function decodePlan(encoded) {
  return decodeFromUrlParam(encoded, { validate: (segments) => Array.isArray(segments) && segments.length > 0 })
}
