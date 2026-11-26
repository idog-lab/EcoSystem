// THE PRIZES LADDER (the Item Ladder: a milestone prize at each rank the economist marks) WORKED OUT FROM EFFORT
// (economist, 26 Nov 2026: "the simulator should calculate the allowance worth of each rank in the prizes ladder.
// we should pick the base segments that opon it we calculate all of those. and then the item ladder is created from
// the base on the others"). Asked:
//   - a marked rank is worth the DR the player paid SINCE THE MARKED RANK BEFORE IT ("DR paid since the rank
//     before"), times the allowance worth of one merge DR - set per Merge event ("Per Merge event");
//   - only the ranks marked get a prize ("The ones I mark");
//   - "the app should show the allowance worth of the rank, then i put prizes inside and the app calculates live how
//     far i am from the prize that is suppos to be" - the prize is typed, its worth read by the economy (lib/economy).
// One ladder for the whole event (as the Item Ladder sheet): ranks 1-12 marked on the normal list, 13-14 on
// Recompletion's; one playthrough runs through both, so a Recompletion rank's effort carries on from the normal
// event's. Every other segment's prize is the base segment's times its multiplier against the base, unless typed.
import { simulatePlaythrough } from '../simulation/mergeSimulation'
import { formatReward, parseReward, checkReward, rewardWorth } from '../../../../lib/economy/parse'
import { MAX_RANK, RC_MAX_RANK } from '../core/ranks'

const round2 = (x) => Math.round(x * 100) / 100
const NUMBER = /^\d+(?:\.\d+)?$/

// The paid DR at which the player first reaches each rank (1-14), in the playthrough of step 4's effort chart:
// one deterministic run of the boards in use, the normal event and then Recompletion when it has boards.
// { [rank]: paidDr } - a rank never reached is missing. null when there is nothing to play.
export function effortOfEvent(mainBoards, rcBoards = null) {
  if (!mainBoards?.length) return null
  const b0 = mainBoards[0]
  try {
    const result = simulatePlaythrough(mainBoards, {
      dropMode: 'expected',
      rewardChainConfig: b0.rewardChainConfig,
      dropGroupsConfig: b0.dropGroupsConfig,
      dropGroupsById: new Map((b0.dropGroups ?? []).map((g) => [g.id, g])),
      minDropRank: b0.minDropRank,
      ...(rcBoards?.length ? { rcBoards } : {}),
    })
    return result?.reachedAt ?? null
  } catch {
    return null
  }
}

// The ranks of the ladder: those marked on the normal list (1-12) and on Recompletion's (13-14).
export function ladderRanks(mainBoards, rcBoards = null) {
  const main = (mainBoards?.[0]?.rewardRanks ?? []).filter((r) => r >= 1 && r <= MAX_RANK)
  const rc = (rcBoards?.[0]?.rewardRanks ?? []).filter((r) => r > MAX_RANK && r <= RC_MAX_RANK)
  return [...new Set([...main, ...rc])].sort((a, b) => a - b)
}
export const phaseOfRank = (rank) => (rank > MAX_RANK ? 'rc' : 'main')

// Each marked rank's effort and worth: [{ rank, since (the marked rank before, or null for the start), dr, worth }].
// A rank not reached has dr and worth null, and the next one counts from the last one reached.
export function rankWorths(reachedAt, ranks, drWorth) {
  let lastAt = 0
  let since = null
  return [...ranks]
    .sort((a, b) => a - b)
    .map((rank) => {
      const at = reachedAt?.[rank]
      if (at == null) return { rank, since, dr: null, worth: null }
      const dr = Math.max(0, at - lastAt)
      const row = { rank, since, dr, worth: drWorth == null || drWorth === '' ? null : round2(dr * Number(drWorth)) }
      lastAt = Math.max(lastAt, at)
      since = rank
      return row
    })
}

// A segment's multiplier against the base (the "reward size", x Segment 1; Segment 1's own is 1).
export const segmentMultiplier = (segment, index) => (index === 0 ? 1 : Number(segment?.segmentFactor) > 0 ? Number(segment.segmentFactor) : 1)

// A prize text with every amount times `factor`: coins to 2 decimals, a resource or a currency to a whole number of
// at least 1; a preset, a pack, a chest's name or a trigger as it is. A text that cannot be read comes back as is.
export function scaleReward(text, factor) {
  const src = String(text ?? '').trim()
  if (!src || !(factor > 0) || factor === 1) return src
  const { node } = parseReward(src)
  if (!node) return src
  const whole = (v) => (NUMBER.test(v) ? String(Math.max(1, Math.round(Number(v) * factor))) : v)
  const walk = (n) => {
    switch (n.type) {
      case 'all':
        return { ...n, parts: n.parts.map(walk) }
      case 'first':
        return { ...n, options: n.options.map(walk) }
      case 'chest':
        return { ...n, inner: walk(n.inner) }
      case 'allowance':
        return NUMBER.test(n.coins) ? { ...n, coins: String(Math.max(0.01, round2(Number(n.coins) * factor))) } : n
      case 'resource':
      case 'dynamic':
        return { ...n, amount: whole(n.amount) }
      default:
        return n
    }
  }
  return formatReward(walk(node))
}

// Each segment's ladder: { [rank]: { text, own } } - its own prize where typed, else the base segment's times its
// multiplier against the base (the base's own when it is the base). segments: [{ segmentFactor, prizeLadder }].
export function segmentLadder(segments, index, baseIndex, ranks) {
  const base = segments[baseIndex]
  const seg = segments[index]
  const factor = segmentMultiplier(seg, index) / segmentMultiplier(base, baseIndex)
  const out = {}
  for (const rank of ranks) {
    const own = String(seg?.prizeLadder?.[phaseOfRank(rank)]?.[rank] ?? '').trim()
    const baseText = String(base?.prizeLadder?.[phaseOfRank(rank)]?.[rank] ?? '').trim()
    if (own) out[rank] = { text: own, own: true }
    else if (index !== baseIndex && baseText) out[rank] = { text: scaleReward(baseText, factor), own: false }
  }
  return out
}

// The milestone texts typed in step 3 (the shared starting prize), for the marked ranks: { [rank]: text }.
export function milestoneTexts(mainBoards, rcBoards = null) {
  const out = {}
  for (const rank of ladderRanks(mainBoards, rcBoards)) {
    const b0 = phaseOfRank(rank) === 'rc' ? rcBoards?.[0] : mainBoards?.[0]
    const text = String(b0?.rewardSyntax?.[rank] ?? '').trim()
    if (text) out[rank] = text
  }
  return out
}

// Every segment's ladder for the exports: [{ main: boards, rc: boards }] in, the same with each segment's prizes on
// its first boards. Nothing typed in the Prizes step leaves every board as it was.
export function laddersOfEvent(segments, baseIndex, mainBoardsOf, rcBoardsOf) {
  const ranks = ladderRanks(mainBoardsOf(segments[0]), rcBoardsOf(segments[0]))
  const b = Math.min(Math.max(0, baseIndex ?? 0), segments.length - 1)
  return segments.map((seg, i) => {
    const ladder = segmentLadder(segments, i, b, ranks)
    return { main: withLadder(mainBoardsOf(seg), ladder, 'main'), rc: withLadder(rcBoardsOf(seg), ladder, 'rc') }
  })
}

// The boards with a ladder's texts put on their first board's milestone texts, for the Item Ladder sheet. A rank
// with no text keeps what the board had (an event from before keeps its own ladder).
export function withLadder(boards, ladder, phase) {
  const texts = Object.fromEntries(Object.entries(ladder ?? {}).filter(([rank]) => phaseOfRank(Number(rank)) === phase).map(([rank, v]) => [rank, v.text]))
  if (!boards?.length || !Object.keys(texts).length) return boards
  return boards.map((b, i) => (i === 0 ? { ...b, rewardSyntax: { ...(b.rewardSyntax ?? {}), ...texts } } : b))
}

// How far a typed prize is from the worth it should have: { ok (readable), issues, worth (null when a part has no
// worth), known, gap, gapPct }.
export function prizeAgainstWorth(text, target, economy, { date = null } = {}) {
  const src = String(text ?? '').trim()
  if (!src) return null
  const check = checkReward(src, { economy, prizeMode: 'normal' })
  const w = check.node ? rewardWorth(check.node, economy, { date }) : null
  const worth = w?.worth ?? null
  const gap = worth != null && target != null ? round2(worth - target) : null
  return { ok: check.ok, issues: check.issues, worth, known: w?.known ?? null, unknown: w?.unknown ?? [], gap, gapPct: gap != null && target > 0 ? Math.round((gap / target) * 1000) / 10 : null }
}
