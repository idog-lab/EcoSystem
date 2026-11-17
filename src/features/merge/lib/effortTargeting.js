import { placeItems } from './placement'
import { simulatePlaythrough } from './mergeSimulation'
import { buildSimulationRows, RANKS } from './simulationRows'
import { applyForcedSemiCell, applyForcedHighestRankCell, generationTargetOf } from './board'
import { valueOf } from './ranks'
import { effectiveMinRank, effectiveMaxRank } from './rankWindow'
import { isMainItem } from './rewardChain'

// "Given a target effort distribution, suggest board blockedValues that
// would shift the simulated curve toward it" - by explicit economist
// request. This is a genuine inverse problem (target shape -> config),
// fundamentally harder than what the rest of this app does (config -> shape,
// via simulatePlaythrough) - there's no closed-form solve, so this is a
// search: try redistributing the segment's existing total subsidy across
// boards, regenerate whichever boards changed, re-run the full simulator,
// and keep a candidate only if it's a genuine improvement. Same
// seed-and-hill-climb shape Diamond Mine's own board generator already
// uses for its own "no analytic inverse of the scoring formula" problem
// (diamondGenerator.js) - never claims an exact hit, always reports what it
// actually achieved.
//
// Deliberately redistributes the CURRENT total subsidy (sum of every
// board's blockedValue) rather than changing it - "how much total DR this
// segment hands out" is Total Subsidy's own job (targetSubsidy), a separate
// concern; this only ever reshapes WHERE that same total lands across the
// rank curve. If targetSubsidy is set, the current total already equals it
// (the last-board auto-fill keeps that invariant - see BoardEditor.jsx), so
// redistributing under "preserve the current total" and "the last board
// auto-fills to hit targetSubsidy" can never disagree with each other.

const MAX_ITERATIONS = 400
const DEADLINE_MS = 2000
// Independent hill-climb attempts, each from a different starting split of
// the SAME total - by explicit economist request ("make sure that the %
// you give will be as accurate as it can be"). Found live, not assumed: six
// back-to-back single-shot runs from the IDENTICAL starting boards produced
// distances ranging from 644 to 898 (the pure-random-walk hill-climb can
// land in meaningfully different local optima purely from which
// (from,to,step) moves happen to get tried first) - so a single attempt was
// leaving real accuracy on the table, not already at the achievable best.
// See suggestBoardValuesForEffortTarget's own comment for how the restarts
// are spent and compared.
const RESTART_COUNT = 4

// How much a board's generated items may exceed its own blockedValue and
// still count as "did a good job" for the per-board badge - the economist's
// own number ("up to 5 extra DR in the subsidy"). See boardChecks for why
// the effective allowance can be raised above this on a high-minRank board.
const OVERSHOOT_ALLOWANCE = 5

// Sum of squared differences between the achieved and target %-per-rank,
// treating a rank never reached in this run as 0% (it cost nothing because
// the run never got there, not because it was free) - a simple, standard
// distance metric, not claimed to be the "right" one, just a workable one
// for hill-climbing toward "closer is better."
function distanceToTarget(achievedRows, targetPctByRank) {
  let sum = 0
  for (const rank of RANKS) {
    const achieved = achievedRows.find((r) => r.rank === rank)?.pctOfEffort ?? 0
    const target = targetPctByRank[rank] ?? 0
    const diff = achieved - target
    sum += diff * diff
  }
  return sum
}

// Regenerates ONE board's items for a candidate blockedValue, using that
// board's own real settings (onboarding goal, rcEvent, forced ranks) exactly
// the way BoardEditor.jsx's own handleGenerate/handleGenerateAll do - a
// candidate is only ever as trustworthy as the generation it's built from.
// By explicit economist request ("apply the effort target suggestions
// should apply the onboarding logic to all boards ofc") - this always did
// thread the onboarding goal through correctly (below), but was missing one
// piece `handleGenerateAll` already has: re-applying FORCED_SEMI_CELL/
// FORCED_HIGHEST_RANK_CELL to board 0's tiles before generating, the same
// belt-and-suspenders `forceCellsFor` every other generation entry point in
// this app uses for a board whose tiles were never actually touched through
// the editor (e.g. one just added via setBoardCount, or an older imported
// backup) - without it, such a board's candidates would be evaluated
// against tiles that don't yet reflect a rule generation itself assumes is
// already true, the same class of drift `generatePlacement`'s own matching
// guard exists to prevent.
// Exported for rewardPlacement.js (the mixed-queue reward solver), which
// needs the exact same "regenerate with this board's own real settings"
// behavior after writing candidate rewardQueueItems onto a board.
export function regenerateBoard(board, index, blockedValue, noise) {
  const isFirstBoard = index === 0
  const tiles = isFirstBoard ? forceCellsFor(board.tiles, board.rcEvent) : board.tiles
  // Regenerating at the board's own budget keeps any built allocation
  // (effectiveBlockedValue - see board.js); regenerating at a DIFFERENT
  // budget is a budget change, which the allocation no longer describes.
  const candidateBoard = { ...board, blockedValue, tiles, effectiveBlockedValue: blockedValue === board.blockedValue ? (board.effectiveBlockedValue ?? null) : null }
  const onboarding =
    isFirstBoard && board.onboardingDrBudget != null && board.onboardingTargetRank != null
      ? { drBudget: board.onboardingDrBudget, targetRank: board.onboardingTargetRank }
      : null
  const rcEvent = isFirstBoard && board.rcEvent
  const generated = placeItems(candidateBoard, { isFirstBoard, noise, onboarding, boardIndex: index, rcEvent })
  return {
    ...candidateBoard,
    semiPlacements: generated.semiPlacements,
    blockedQueue: generated.blockedQueue,
    onboardingStatus: generated.onboardingStatus,
  }
}

function forceCellsFor(tiles, rcEvent) {
  const withSemi = applyForcedSemiCell(tiles)
  return rcEvent ? applyForcedHighestRankCell(withSemi) : withSemi
}

// The most DR a board's own tiles can ever actually hold: every blocked/semi
// tile filled at that board's own maxRank ceiling - the same
// tiles.flat().filter(blocked/semi) count BoardEditor.jsx's own
// blockedTileCount already uses. By explicit economist request ("those will
// not handle the tiles i asked for in the boards") - found live from a
// board the search pushed to ~2.5x more DR than its own tile count could
// ever represent: `distanceToTarget` only scores the AGGREGATE simulated
// effort curve, so it has no way to notice or penalize a per-board
// assignment that's individually unachievable - `placeItems` just silently
// does its best (rounding up to the nearest valueOf(minRank) multiple, or -
// far more visibly wrong - falling back to `decomposeInWindow`'s own
// "genuinely infeasible" branch, which caps the real generated sum well
// below the assigned blockedValue while that inflated, unachievable number
// stays written on the board). Capping how much a single candidate move can
// push INTO a board at this ceiling stops the search from ever proposing
// that in the first place, rather than trying to detect and penalize the
// resulting mess after the fact.
function boardCapacity(board, boardIndex) {
  const tileCount = board.tiles.flat().filter((s) => s === 'blocked' || s === 'semi').length
  return tileCount * valueOf(effectiveMaxRank(board.maxRank, boardIndex))
}

// The number of problems BoardEditor.jsx's own "Placement" card would flag
// on this board - deliberately mirroring that card's exact three checks
// (`sumOk`/`countOk`/`varietyOk`) rather than re-deriving a separate,
// parallel idea of "is this board OK," so the two can never disagree about
// what counts as a problem.
//
// By explicit economist request, after the raw tile-capacity cap below still
// wasn't enough: "it can't be that he will suggest something and after i
// apply i'll see errors in boards." The capacity ceiling was an ANALYTICAL
// guess at feasibility (tiles x maxRank value), and it only ever covered one
// of the three ways a board can come out wrong - it says nothing about item
// COUNT (a board can hit its sum perfectly with far fewer items than it has
// tiles), and nothing about the min/max VARIETY reservation (which is in
// fact impossible right AT that raw ceiling, where every tile has to be
// maxRank, leaving no room for a minRank item at all - so the cap was
// quietly walking boards toward a value that guarantees one of these very
// warnings). Rather than keep bolting analytical special-cases onto a
// formula, the search now just asks the real generated board the same
// questions the editor asks it.
//
// It also returns a per-board PASS/FAIL verdict (`ok`/`reasons`), by explicit
// economist request ("a bubble that shows V for each board between all
// segments boards if it did a good job (up to 5 extra DR in the subsidy and
// hit all tiles and rules)") - the same three checks, but reported per board
// rather than summed, so the result panel can show one badge per board of
// every segment instead of a single aggregate count. `issues`/`penalty` (what
// the SEARCH steers by) are deliberately left exactly as they were: the
// verdict is a stricter, reporting-only reading of the same numbers, and
// wiring the overshoot allowance into the search's own objective would push
// it to fight the rank-floor rounding it can't actually avoid (below).
function boardChecks(board, boardIndex, { varietyRelevant = true } = {}) {
  const tileCount = board.tiles.flat().filter((s) => s === 'blocked' || s === 'semi').length
  if (tileCount === 0)
    return { issues: 0, penalty: 0, ok: true, reasons: [], notes: [], tileCount: 0, itemCount: 0, sum: 0 }

  // Main-chain DR only (isMainItem) - a mixed queue's reward entries (V2)
  // occupy real tiles (so itemCount counts them) but carry zero main-chain
  // DR, and valueOf(an encoded reward >= 1000) would be an astronomical
  // 2^1000-class number - same guard BoardEditor.jsx's own stats use.
  const itemCount = board.semiPlacements.length + board.blockedQueue.length
  const sum =
    board.semiPlacements.reduce((s, p) => s + (isMainItem(p.rank) ? valueOf(p.rank) : 0), 0) +
    board.blockedQueue.reduce((s, r) => s + (isMainItem(r) ? valueOf(r) : 0), 0)

  const minRankFloor = effectiveMinRank(board.minRank, boardIndex)
  // Board 1 / Board 2's hardcoded rank ceilings (rankWindow.js) - used below
  // instead of the raw board.maxRank so this check can't disagree with what
  // placement.js's own generation actually enforced at this position.
  const maxRankCeiling = effectiveMaxRank(board.maxRank, boardIndex)
  const isFirstBoard = boardIndex === 0
  const allRanks = [...board.semiPlacements.map((p) => p.rank), ...board.blockedQueue]
  const hasMax = allRanks.includes(maxRankCeiling)
  // Board 0 USED to only check maxRank here, on the assumption that
  // `generateCandidateWithSmallRanks`'s own guaranteed ascending-ranks-from-
  // minRank set made a separate minRank check redundant - see
  // `BoardEditor.jsx`'s own matching max-only check for where that
  // assumption still lives. Found live, from an economist report ("it looks
  // like it doesn't matter what I do, I get no rank1's") that the assumption
  // doesn't hold: that guarantee is only ATTEMPTED first - `canReserve`'s own
  // feasibility check (reserving the small-rank set can itself need more
  // items than the remainder has room for) can reject it, and a low
  // `maxRank` relative to a board's own tile count can push generation into
  // `decomposeInWindow`'s "genuinely infeasible" branch entirely, which fills
  // EVERY tile with `maxRank` and guarantees nothing small at all - verified
  // directly: a board with a narrow [1,6] window hit exactly this at a
  // blockedValue the search had pushed close to that board's own raw
  // capacity, returning 24 identical rank-6 items with zero variety. The old
  // `hasMax`-only check couldn't see this failure AT ALL, since `hasMax` is
  // trivially true when literally every item is the max rank - so nothing in
  // the search's own objective ever penalized it, and the search had no
  // reason not to push board 0 there.
  //
  // A SECOND bug in that same first fix, found live immediately after -
  // "why do I have 0 1's... you give it too much DRs" on a board that, per
  // the economist's own screenshot, showed its "Blocked queue" card with
  // zero rank-1 items at all. The fix above checked `allRanks` (semis AND
  // queue combined) for `minRankFloor` - but board 0's semi tiles are
  // ALREADY unconditionally rank 1 except the one forced cell (see "Board
  // 1's semi tiles are always rank 1" above), independent of `blockedValue`
  // or anything the search does. The instant a board has even one ordinary
  // (non-forced) semi tile, `allRanks.includes(1)` is trivially true FOREVER
  // regardless of what the blocked queue itself looks like - the check was
  // real for non-first boards (whose semi ranks aren't unconditionally
  // fixed) but a near-total no-op for board 0 on any board with 2+ semi
  // tiles, which is exactly why the economist saw no change at all: the
  // check was never actually exercising the thing it was meant to verify.
  // Board 0 now checks `board.blockedQueue` alone - the part
  // `generateCandidateWithSmallRanks`'s own guarantee actually governs, and
  // the exact thing visible in the "Blocked queue" card the economist was
  // looking at. `minRankFloor` already equals `board.minRank` unchanged at
  // board 0 - board-position floors (Board 2/3's own hard floors) never
  // apply there (see "Board-position hard floors" in CLAUDE.md).
  const hasMin = isFirstBoard ? board.blockedQueue.includes(minRankFloor) : allRanks.includes(minRankFloor)
  const hasRangeVariety = minRankFloor >= maxRankCeiling ? null : hasMax && hasMin

  const target = generationTargetOf(board)
  const shortBy = Math.max(0, target - sum)
  const countOff = Math.abs(itemCount - tileCount)
  // `varietyRelevant` is false when NO redistribution of this segment's whole
  // subsidy could ever buy this board a maxRank item (plus a minRank one, off
  // board 0) - e.g. the default maxRank of 12 needs valueOf(12) = 2048 DR on
  // a single board. Two separate reasons to gate on it:
  //   - The badge: the economist asked for a tick meaning "the search did a
  //     good job here." A rule that's unreachable at ANY value isn't the
  //     search's doing, it's this board's own maxRank being set higher than
  //     the segment can fund - reported as a `note` instead, so it's still
  //     said, just not counted against the suggestion.
  //   - The search: a flat +1 penalty the search can never pay off is at best
  //     dead weight and at worst an active incentive to dump the segment's
  //     whole subsidy onto one board chasing it. Deliberately computed from
  //     the segment TOTAL (fixed for the whole search), never from the
  //     candidate's own current value - gating on the candidate would reward
  //     the search for STARVING a board until the rule stopped applying.
  const varietyFails = hasRangeVariety === false && varietyRelevant
  const varietyUnreachable = hasRangeVariety === false && !varietyRelevant

  // `issues` is the honest COUNT, for reporting to the economist ("N
  // warnings would remain"). `penalty` is what the search actually steers
  // by, and it is deliberately CONTINUOUS, not a pass/fail tally: a count
  // alone gives the hill-climb no gradient to walk down. A board starting
  // far over its own capacity (say 615 DR of value asked of tiles that can
  // only ever hold 256) stays "1 issue" at 615, at 500, at 400 - every
  // intermediate step toward feasibility scores identically, so none of
  // them get accepted on their own merit and the search can never cross
  // the gap in the one-step-at-a-time moves it makes. Measuring HOW short /
  // HOW far off instead makes each step downhill genuinely better than the
  // last. `shortBy` stays normalized against the board's own target value
  // (0-1 scale even for a total sum failure, so it's already commensurate
  // with the flat variety term without further scaling).
  //
  // `countOff` is deliberately NOT divided by `tileCount` - a real bug, found
  // live from an economist report after the board-0 variety fix above
  // started firing more often ("u entered changes that now make some
  // segments fail in creating blocked queues"). The OLD `countOff /
  // tileCount` scaling meant a single missing item on, say, a 24-tile board
  // only cost ~0.04 penalty - roughly 25x CHEAPER than a variety failure's
  // flat 1.0 - so the search would happily trade away an exact item-count
  // match on ONE board to chase a variety win on ANOTHER, since the net
  // change still looked like a big improvement. That's backwards: a tile
  // with no backing item can never be revealed at all (see `boardChecks`'s
  // own "N tiles with no item" reason above, and the `boardIsCleared`
  // write-up in CLAUDE.md's "Board chaining" section for the full mechanism)
  // - permanently wasted DR, not a cosmetic shape mismatch the way a missing
  // variety rank is. Each mismatched item now costs a full point, same order
  // as a complete variety failure, and WORSE when more than one tile is
  // short - so the search can no longer treat "leave a tile empty" as
  // nearly free just because fixing it costs less than fixing variety
  // somewhere else. Verified live: the exact reported shape (board 0 wanting
  // to shed DR for its own variety, boards 2/3 landing on a value too low
  // for their own tile count) now keeps every board's item count exact
  // first, letting variety or curve-match distance absorb the remaining
  // slack instead.
  const penalty = shortBy / Math.max(1, target) + countOff + (varietyFails ? 1 : 0)

  // The economist's own bar for "this board did a good job": at most
  // OVERSHOOT_ALLOWANCE DR of extra subsidy, every tile holding an item, and
  // the rank-window rules satisfied.
  //
  // The allowance is `max(5, valueOf(minRankFloor) - 1)`, not a flat 5:
  // rankWindow.js's `raiseUndersized` rounds a board's target UP to the
  // nearest multiple of valueOf(minRank) whenever it isn't already one (see
  // "Item generation invariant" in CLAUDE.md), so a board with a high minRank
  // can overshoot by up to valueOf(minRankFloor)-1 DR with no possible
  // arrangement avoiding it. Flagging that would make the badge permanently
  // red on exactly the boards where nothing is wrong. Below that threshold
  // the flat 5 applies, which is the literal ask.
  const overBy = Math.max(0, sum - target)
  const overshootAllowance = Math.max(OVERSHOOT_ALLOWANCE, valueOf(minRankFloor) - 1)

  const reasons = []
  if (shortBy > 0) reasons.push(`${shortBy} DR short — only ${sum} of ${target} DR could be placed`)
  else if (overBy > overshootAllowance) reasons.push(`${overBy} DR over target (${sum} vs ${target})`)
  if (itemCount < tileCount) {
    // revealNeighbors can only ever hand out as many items as the
    // blockedQueue holds, so a tile with no item behind it stays locked
    // forever once the queue runs dry - that DR is genuinely lost, and it's
    // still worth flagging so the economist can fix the board rather than
    // silently under-deliver its subsidy.
    //
    // This USED TO also strand every later board's subsidy on top of that -
    // boardIsCleared required ZERO locked cells, including ones that could
    // mathematically never be revealed again, so a single short tile
    // permanently blocked the next board from ever pushing in (reported
    // live: "Boards the player reached: 1/3", 1360 of 1504 configured DR
    // never delivered). Fixed at the engine level - see
    // mergeSimulation.js's own boardIsCleared comment - a locked cell only
    // blocks progression while its board's queue could still reveal it;
    // once exhausted, a still-locked cell is recognized as permanently dead
    // and no longer holds up the rest of the chain. This board's own
    // shortfall is still real lost value, just no longer catastrophic for
    // every board after it.
    reasons.push(
      `${tileCount - itemCount} tile${tileCount - itemCount === 1 ? '' : 's'} with no item — ${
        tileCount - itemCount === 1 ? 'it' : 'they'
      } can never be revealed, wasting that DR (later boards still push in normally once this one's queue runs dry)`,
    )
  } else if (itemCount > tileCount) {
    reasons.push(`${itemCount - tileCount} more items than tiles — the extras can never be revealed`)
  }
  if (varietyFails) {
    // Report precisely which end is missing rather than a blanket "variety
    // fails" - the min side missing is exactly the "no rank1's" symptom this
    // check now exists to catch, so it's worth naming on its own rather than
    // folding it into a single generic message.
    const missing = []
    if (!hasMin) missing.push(`rank ${minRankFloor}`)
    if (!hasMax) missing.push(`rank ${maxRankCeiling}`)
    reasons.push(`missing a ${missing.join(' or ')} item`)
  }

  const notes = []
  if (varietyUnreachable) {
    notes.push(
      `A rank ${minRankFloor} item plus a rank ${maxRankCeiling} item together need ${
        valueOf(minRankFloor) + valueOf(maxRankCeiling)
      } DR — more than this segment's whole subsidy, so no split can put both here. Lower this board's max rank if you want that variety.`,
    )
  }

  return {
    issues: (shortBy > 0 ? 1 : 0) + (countOff !== 0 ? 1 : 0) + (varietyFails ? 1 : 0),
    penalty,
    ok: reasons.length === 0,
    reasons,
    notes,
    tileCount,
    itemCount,
    sum,
  }
}

// Whether a maxRank item AND a minRank item could both fit on this board at
// ANY share of `total` - see boardChecks's own `varietyRelevant` comment for
// why this is computed from the segment total once, up front, rather than
// per candidate. Board 0 now needs room for BOTH (previously 0 extra for
// minRank, back when its own check was max-only - see boardChecks's own
// `hasMin` comment for why that stopped being a safe assumption), using
// `effectiveMinRank` uniformly even though it's a no-op at board 0 (no
// board-position floor applies there), so this stays the exact same
// expression for every board rather than needing its own special case.
function varietyNeeded(board, boardIndex) {
  return valueOf(effectiveMaxRank(board.maxRank, boardIndex)) + valueOf(effectiveMinRank(board.minRank, boardIndex))
}

// One board's own `varietyNeeded` fitting within the segment TOTAL doesn't
// mean every board's can fit SIMULTANEOUSLY - a real, found-live gap (an
// economist report that "the first segment looks good but in the others
// less" turned out to trace back to this, not anything specific to those
// segments). With the default maxRank 12 (`valueOf(12) = 2048`), two boards
// both wanting their own rank-12 item need 4096+ DR between them - more than
// many a real segment's whole subsidy - yet the OLD per-board check (just
// "could THIS board, if it somehow got the WHOLE total, afford it") says yes
// for EVERY such board independently, since each is checked as if it alone
// could claim the full `total`. The search then chases an impossible
// target: every one of those boards is told its own variety is achievable,
// but the shared total can only ever satisfy ONE of them at a time - no
// arrangement exists where `issues: 0` for all of them at once, no matter
// how long the search runs (confirmed live: 10 restarts over 3s converged
// to the SAME ~440-460 unresolved distance instead of 0 issues, because
// there is no 0-issues configuration to converge to).
//
// Fixed by rationing: boards are considered one at a time, smallest
// `varietyNeeded` first (giving the boards that are CHEAPEST to satisfy the
// best chance), and a board's own check stays "relevant" only while the
// RUNNING total of every board granted so far (itself included) still fits
// within the segment's total. Once that running total would exceed it, this
// board and every one after it (all needing at least as much, since they're
// sorted ascending) get `varietyRelevant: false` instead - correctly
// reported as a `note` ("no split can put both here"), not a real,
// achievable-but-missed `issue` the search is blamed for never reaching.
// Smallest-first is deliberate, not arbitrary: it maximizes how many boards
// genuinely get a fair shot, rather than e.g. processing in board order and
// letting an expensive board 0 use up room that two cheap later boards could
// have shared.
function computeVarietyRelevance(boards, total) {
  const order = boards.map((b, i) => ({ i, needed: varietyNeeded(b, i) })).sort((a, b) => a.needed - b.needed)
  const relevant = new Array(boards.length).fill(false)
  let running = 0
  for (const { i, needed } of order) {
    running += needed
    if (running > total) break
    relevant[i] = true
  }
  return relevant
}

function evaluate(boards, targetPctByRank, varietyRelevance) {
  const result = simulatePlaythrough(boards, { startIndex: 0 })
  const rows = buildSimulationRows(result)
  const checks = boards.map((b, i) => boardChecks(b, i, { varietyRelevant: varietyRelevance[i] }))

  // A chain-level problem `boardChecks` has no way to see, since it only
  // ever looks at ONE board's own tiles/items in isolation: a candidate can
  // pass every per-board check (sum/count/variety all fine, `issues: 0`
  // everywhere) and STILL strand most of the segment's subsidy, if the
  // chosen split leaves earlier boards too thin to ever fully clear before
  // the player's own effort alone reaches rank 12 - boards after that one
  // then never push in at all (see "Board chaining" in CLAUDE.md for the
  // mechanic itself). `distanceToTarget` alone can't catch this either: the
  // %-effort SHAPE of a run that's almost entirely player-paid still looks
  // like a normal exponential climb (most effort concentrated near rank
  // 12), since that shape comes from the value chain's own math, not from
  // how much subsidy actually got used - so a search that only matched
  // curve shape could (and reproducibly did) recommend splits that waste
  // nearly all of a segment's subsidy while reporting a perfectly clean,
  // 0-issues result and a plausible-looking curve.
  //
  // Found live, from an economist report that applying the SAME target
  // curve to 4 segments with very different totals (1500/1000/700/400)
  // produced near-identical drSpent/%-effort across three of them
  // (~1818-1822 DR each) regardless of their different totals - because in
  // each of those three, the search had put most of the subsidy on later
  // boards that then never got reached (boardsReached: 1/3, subsidy
  // delivered as little as 45-49 of 400-1001 configured), so the ACTUAL
  // gameplay in all three cases collapsed to nearly the same thing: almost
  // the whole 2048-value climb paid for by the player, subsidy or not.
  //
  // Scaled by `boards.length` so total stranding (subsidyDelivered: 0) costs
  // roughly as much penalty as every board failing its own per-board check
  // at once - dominant enough that the search always prefers delivering the
  // subsidy over a marginally closer curve shape, the same "problems outrank
  // curve-matching" priority boardChecks' own penalty already established.
  const subsidyShortfall = Math.max(0, result.subsidyConfigured - result.subsidyDelivered)
  const strandedPenalty =
    result.subsidyConfigured > 0 ? (subsidyShortfall / result.subsidyConfigured) * boards.length : 0

  // The penalty above steers the search AWAY from stranding, but it was
  // never actually counted in `issues` - the number the economist actually
  // sees ("N Placement-card warnings," the green/amber per-board badges).
  // A real, found-live gap: a candidate can show `issues: 0` - every board's
  // own sum/count/variety perfectly clean - while still stranding a real
  // chunk of the segment's subsidy, since `boardsReached < boardsTotal` is a
  // CHAIN-level fact no single board's own check can ever see. Verified
  // live: a 3-board segment at a moderate total repeatedly converged to a
  // split stranding 144 of 2504 configured DR (boardsReached 1/3) while
  // reporting `issues: 0` throughout - the badge said "all clean" on a
  // suggestion that was quietly throwing away two boards' worth of subsidy.
  // `OVERSHOOT_ALLOWANCE` DR of slack (the same tolerance a per-board sum
  // check already allows) keeps this from firing on trivial rounding.
  const strandedIssue = subsidyShortfall > OVERSHOOT_ALLOWANCE

  return {
    boards,
    result,
    rows,
    checks,
    distance: distanceToTarget(rows, targetPctByRank),
    issues: checks.reduce((n, c) => n + c.issues, 0) + (strandedIssue ? 1 : 0),
    penalty: checks.reduce((n, c) => n + c.penalty, 0) + strandedPenalty,
    strandedIssue,
    subsidyShortfall,
  }
}

// One hill-climb trajectory from a given starting `values` split - the
// core move-and-accept loop, extracted so `suggestBoardValuesForEffortTarget`
// can run it several times from different starting points (see RESTART_COUNT
// above) and keep whichever trajectory converged best, rather than trusting
// the first (and only) random walk to have found a good local optimum.
function hillClimbFrom(startValues, boards, targetPctByRank, { noise, capacities, varietyRelevance, deadline }) {
  let values = startValues
  let current = evaluate(
    boards.map((b, i) => regenerateBoard(b, i, values[i], noise)),
    targetPctByRank,
    varietyRelevance,
  )

  let iterations = 0
  for (; iterations < MAX_ITERATIONS && Date.now() < deadline; iterations++) {
    if (boards.length < 2) break // nothing to redistribute between

    // Move a random step of DR from one board to another (never below 0 on
    // either side, and never pushing the receiving board past what its own
    // tiles could ever hold - see boardCapacity's own comment for why that
    // cap has to live HERE, at the point a move is proposed, rather than
    // being detected after the fact) - a plain, unweighted random pair +
    // step size, same "random nudge, keep only if it helps" shape as
    // Diamond Mine's own hill-climb (diamondGenerator.js), not anything
    // more clever.
    const from = Math.floor(Math.random() * boards.length)
    let to = Math.floor(Math.random() * boards.length)
    if (to === from) to = (to + 1) % boards.length
    const maxStep = Math.max(1, Math.floor(values[from] / 4))
    const room = Math.max(0, capacities[to] - values[to])
    const step = Math.min(values[from], 1 + Math.floor(Math.random() * maxStep), room)
    if (step <= 0) continue

    const candidateValues = [...values]
    candidateValues[from] -= step
    candidateValues[to] += step

    const candidateBoards = boards.map((b, i) =>
      i === from || i === to ? regenerateBoard(b, i, candidateValues[i], noise) : current.boards[i],
    )
    const candidate = evaluate(candidateBoards, targetPctByRank, varietyRelevance)

    // Editor-flagged problems (see boardChecks) outrank curve-matching: any
    // candidate that reduces the total penalty is taken regardless of what
    // it does to the effort curve, one that increases it is rejected
    // outright, and distance only breaks ties between equally-clean
    // candidates. Without this ordering the search would happily trade a
    // genuinely broken board for a marginally prettier curve - exactly the
    // "it suggests things it cannot handle" report this exists to prevent.
    // It also means a run that STARTS from an already-problematic board
    // actively climbs out of it, rather than preserving the mess it
    // inherited. EPSILON because `penalty` is a float sum - comparing it
    // with bare `===` would make "equally clean" almost never true and
    // silently disable the distance tiebreak.
    const EPSILON = 1e-9
    const cleaner = candidate.penalty < current.penalty - EPSILON
    const equallyCleanAndCloser =
      candidate.penalty <= current.penalty + EPSILON && candidate.distance <= current.distance
    if (cleaner || equallyCleanAndCloser) {
      values = candidateValues
      current = candidate
    }
  }

  return { values, current, iterations }
}

// Scatters `baseValues`' own total across boards differently, via a handful
// of blind random transfers (same from/to/capacity-respecting shape
// hillClimbFrom's own moves use, just not filtered by whether they help) -
// a cheap way to hand a restart a starting point in a genuinely different
// region of the search space, rather than re-walking from the exact same
// spot `hillClimbFrom` already explores on restart 0. Always preserves the
// exact total and never exceeds a board's own capacity, the same two
// invariants every other move in this file already respects.
function scrambledStartingValues(baseValues, capacities) {
  const values = [...baseValues]
  const n = values.length
  if (n < 2) return values
  for (let k = 0; k < n * 3; k++) {
    const from = Math.floor(Math.random() * n)
    let to = Math.floor(Math.random() * n)
    if (to === from) to = (to + 1) % n
    const room = Math.max(0, capacities[to] - values[to])
    const step = Math.min(values[from], room, Math.ceil(values[from] * (0.3 + Math.random() * 0.5)))
    if (step <= 0) continue
    values[from] -= step
    values[to] += step
  }
  return values
}

// `targetPctByRank`: { 1: 5, 2: 3, ..., 12: 40 } (need not sum to exactly
// 100 - only relative shape matters for the distance metric, but wildly
// off-scale numbers will just report a large, honest distance rather than
// erroring). `noise`: the board editor's own currently-dialed noise value,
// reused rather than a second, hidden one - the same items regenerated by
// this search should look like something "Generate items for all boards"
// could plausibly have produced.
//
// Returns null if there's no DR to redistribute at all (every board's
// blockedValue is 0 - nothing for the search to move around). Otherwise
// returns `{ suggestedValues, rows, distance, iterations, reachedMaxRank }` -
// `suggestedValues` is a plain array of blockedValue numbers, one per board,
// summing to the SAME total the boards started with. Never mutates the
// input `boards` - the caller decides whether/how to apply the suggestion.
//
// Runs RESTART_COUNT independent hill-climb attempts (see its own comment
// for why one attempt wasn't reliably finding the achievable best) and keeps
// whichever converged cleanest-then-closest, under ONE shared wall-clock
// deadline rather than a fixed slice per restart - a restart that converges
// early (most do, empirically ~400-450ms for the full 400-iteration budget)
// leaves its unused time for the next restart instead of wasting it, and a
// slow restart can never blow the total budget by much since every restart
// still obeys the same overall deadline. The FIRST restart always starts
// from the boards' own CURRENT split (preserving the original "small nudge
// from here" behavior as the first thing tried); the rest start from
// `scrambledStartingValues` so later restarts explore genuinely different
// regions rather than re-walking the same starting point.
// `firstBoardCap` (optional): the most Board 1 may be given - the Build Event
// flow passes its 150 DR Board 1 limit, so a suggestion never has to be
// clipped afterwards (clipping would change the curve it was scored on).
export function suggestBoardValuesForEffortTarget(boards, targetPctByRank, { noise = 0.15, firstBoardCap = null } = {}) {
  const total = boards.reduce((s, b) => s + b.blockedValue, 0)
  if (total <= 0 || boards.length === 0) return null

  const capacities = boards.map((b, i) => boardCapacity(b, i))
  if (firstBoardCap != null && boards.length > 1) capacities[0] = Math.min(capacities[0], Math.max(firstBoardCap, boards[0].blockedValue ?? 0))
  const varietyRelevance = computeVarietyRelevance(boards, total)
  const baseValues = boards.map((b) => b.blockedValue)

  const overallDeadline = Date.now() + DEADLINE_MS
  const EPSILON = 1e-9
  let best = null
  let totalIterations = 0

  for (let restart = 0; restart < RESTART_COUNT && Date.now() < overallDeadline; restart++) {
    const startValues = restart === 0 ? baseValues : scrambledStartingValues(baseValues, capacities)
    const attempt = hillClimbFrom(startValues, boards, targetPctByRank, {
      noise,
      capacities,
      varietyRelevance,
      deadline: overallDeadline,
    })
    totalIterations += attempt.iterations

    const cleaner = !best || attempt.current.penalty < best.current.penalty - EPSILON
    const equallyCleanAndCloser =
      best && attempt.current.penalty <= best.current.penalty + EPSILON && attempt.current.distance < best.current.distance
    if (cleaner || equallyCleanAndCloser) best = attempt
  }

  const { values, current } = best

  return {
    suggestedValues: values,
    boards: current.boards,
    rows: current.rows,
    distance: current.distance,
    iterations: totalIterations,
    // How many editor-flagged problems remain across every board in the
    // final suggestion - surfaced in the UI so the economist is told BEFORE
    // applying, not left to discover it on the board afterward. Usually 0;
    // a non-zero value means no arrangement the search could reach avoids
    // it (e.g. a board whose own tile count genuinely can't represent any
    // share of this segment's total), which is real information, not
    // something to hide.
    issues: current.issues,
    // One verdict per board, in board order - `{ ok, reasons, tileCount,
    // itemCount, sum }`. The UI renders these as a per-board pass/fail badge
    // (see BoardEditor.jsx's "Effort target" card), which is the whole point
    // of returning them individually rather than only the summed `issues`
    // count: "3 warnings remain" doesn't tell the economist WHICH board to go
    // look at, and with "apply to all segments" checked there can be four
    // segments' worth of boards to choose between.
    boardReports: current.checks,
    // Whether this suggestion strands a meaningful chunk of the segment's
    // own subsidy (boards that never push in because an earlier one never
    // fully clears) - a chain-level fact `boardReports` can never show,
    // since every individual board can look perfectly clean while this is
    // true. `strandedDr` is how much (0 when nothing's stranded); both are
    // already counted into `issues` above, but exposed separately so the UI
    // can give this its own specific, actionable message instead of a bare
    // number - see BoardEditor.jsx's own result panel.
    strandedIssue: current.strandedIssue,
    strandedDr: current.subsidyShortfall,
    reachedMaxRank: current.result.stopReason === 'max-rank-reached',
    // The raw, unbudgeted simulatePlaythrough() result behind this
    // suggestion's own `rows`/`reachedMaxRank` - exposed so a caller can
    // feed it straight into EffortDistributionChart/SimulationReport right
    // after applying, instead of making the economist click "Run" a second
    // time to see the very curve they just asked for. By explicit economist
    // request ("when i apply the spread suggestion, i want to see somewhere
    // on the segment the effort distribution") - see BoardEditor.jsx's own
    // handleApplySuggestion for how this gets wired into the chart.
    result: current.result,
  }
}
