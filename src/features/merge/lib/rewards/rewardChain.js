// Small-reward chains (V2) - four reward resource types (coins, puzzles,
// merge energy, charms), each with its own 4-rank merge chain, layered on
// top of the existing main value-chain (ranks.js) rather than replacing it.
//
// ENCODING DECISION (the key choice that keeps this a low-risk addition
// instead of a board-wide refactor): a board cell's item is still just a
// single number, same as every existing grid/queue/placement in
// mergeSimulation.js/playSession.js/placement.js. A reward item is encoded
// as a number >= REWARD_BASE (1000) so it can NEVER collide with a real
// main-chain rank (which tops out at RC_MAX_RANK=14 - see ranks.js) and so
// every piece of code that buckets items by raw equality (scanForMerge's
// `byRank` map, findSpawnCell, the blocked-queue's own flat array) keeps
// working completely unchanged: two cells only ever merge if their raw
// encoded value matches exactly, and since the encoding is a bijection per
// (type, rank) pair, "same raw value" already means "same reward type AND
// same reward rank" - exactly the "separate identities, even with the same
// numeric rank" requirement, for free. The only code that needs to KNOW
// about this encoding is the handful of places that must treat main-chain
// and reward items differently on purpose: performMerge (computing the
// next value, and collecting instead of placing past rank 4),
// currentMaxRank/recordRank (must ignore reward items entirely - "reaching
// a rank" is a main-chain-only concept), and the UI that displays an item.
export const REWARD_TYPES = ['coins', 'puzzles', 'energy', 'charms']

// Twister DR (`dr-twister`) - the currency the Twister widget's spins cost.
// It is a small-reward item like the four above (ranks 1-4, merges pairwise,
// hand-collectable below rank 4, auto-collects at rank 4) with two hard
// differences, which is why it is NOT a member of REWARD_TYPES:
//   - it only ever comes from main-chain merge drops. It is never placed
//     under a starting tile, never put in a blocked/semi-blocked queue, and
//     has no tile/drop source allocation or payout target (REWARD_TYPES is
//     exactly "the resources that have those").
//   - it is its own balance. It does not fund generator actions and gets no
//     energy credit - "Twister DR", "Merge Energy" and main-chain subsidy DR
//     are three separate currencies and are never added together.
// ALL_REWARD_TYPES is "everything that can be a reward ITEM on the board";
// use it for encoding, tallies, drop groups and reward definitions, and keep
// REWARD_TYPES for anything about targets, source splits or tile placement.
export const TWISTER_TYPE = 'twister'
export const ALL_REWARD_TYPES = [...REWARD_TYPES, TWISTER_TYPE]
export const REWARD_TYPE_LABELS = { coins: 'Coins', puzzles: 'Puzzles', energy: 'Merge Energy', charms: 'Charms', twister: 'Twister DR' }

// A zeroed per-resource tally covering every reward item type.
export function emptyRewardTally() {
  return Object.fromEntries(ALL_REWARD_TYPES.map((t) => [t, 0]))
}

// Whether a reward type may sit under a starting tile (blocked queue or
// semi-blocked cell). Twister may not - see TWISTER_TYPE.
export function isTilePlaceableRewardType(type) {
  return REWARD_TYPES.includes(type)
}
export const REWARD_MAX_RANK = 4
// WHAT IS LEFT WHEN A PHASE ENDS IS COLLECTED (economist: "we need to make
// sure the simulator after getting to rank 12, merges all the small rewards
// and collect them. to understand how much really the user got"). A simulated
// player merges every reward item it can as it plays; whatever is still
// unmerged when the phase's top rank is reached is tapped and paid at its own
// rank's value ('collect'). It used to be assumed lost ('forfeit', still
// selectable in step 3) - so every amount the simulator reported was short
// by the last few items a real player taps before stopping.
export const DEFAULT_LEFTOVER_POLICY = 'collect'
export const REWARD_BASE = 1000

// The economist's real Ops reference ("Small Rewards" sheet) keys each
// rank as `{shortKey}-r{rank}` (coin-r1, dr-r1, puzzle-r1, charm-r1, ...) -
// "dr" is the reference's own name for the Merge Energy resource (energy
// funds DR-equivalent generator actions - section 7), not a separate
// concept. This mapping is transcribed literally from that reference, not
// invented - see smallRewardKey/buildSmallRewardsSheet.
// `dr-twister` is the resource name the Twister specification itself gives;
// the `-r{rank}` key built from it is this app's own pattern and, like every
// V2 key, unverified against a production sheet.
export const REWARD_TYPE_SHORT_KEY = { coins: 'coin', puzzles: 'puzzle', energy: 'dr', charms: 'charm', twister: 'dr-twister' }

export function smallRewardKey(type, rank) {
  return `${REWARD_TYPE_SHORT_KEY[type]}-r${rank}`
}

export function encodeReward(type, rank) {
  const typeIndex = ALL_REWARD_TYPES.indexOf(type)
  if (typeIndex < 0) throw new Error(`Unknown reward type "${type}"`)
  return REWARD_BASE + typeIndex * 10 + rank
}

export function isRewardItem(value) {
  return value >= REWARD_BASE
}

export function isMainItem(value) {
  return value != null && value < REWARD_BASE
}

// Inverse of encodeReward - {type, rank}, or null if `value` isn't a
// reward-encoded number at all (lets a caller pass anything through
// without pre-checking isRewardItem first).
export function decodeReward(value) {
  if (!isRewardItem(value)) return null
  const offset = value - REWARD_BASE
  const typeIndex = Math.floor(offset / 10)
  const rank = offset % 10
  if (typeIndex < 0 || typeIndex >= ALL_REWARD_TYPES.length || rank < 1 || rank > REWARD_MAX_RANK) return null
  return { type: ALL_REWARD_TYPES[typeIndex], rank }
}

// One configurable rank of one reward type - the Ops identifier/syntax, the
// real Ops Asset ID (the "Small Rewards" sheet's own Asset column - one per
// TYPE in the reference, repeated across that type's 4 ranks, not
// deduplicated here since the real sheet doesn't either), the prize this
// rank pays out if collected (manually, or automatically at
// REWARD_MAX_RANK), and free-text display info for the existing UI
// conventions (art emoji, matching every other feature's own placeholder-art
// pattern) to key off.
export function createRewardRankConfig({ syntax = '', asset = '', prizeAmount = 0, displayName = '', art = null } = {}) {
  return { syntax, asset, prizeAmount, displayName, art }
}

// One reward type's full 1..REWARD_MAX_RANK ladder. `seed` (optional) is an
// array of per-rank {syntax, asset, prizeAmount} overrides, used below to
// seed the real Ops reference values as this app's own defaults rather than
// blank placeholders.
export function createRewardTypeConfig(seed = []) {
  return Array.from({ length: REWARD_MAX_RANK }, (_, i) => createRewardRankConfig(seed[i] ?? {}))
}

// The real Ops "Small Rewards" reference values (economist-provided,
// transcribed literally - not invented), seeded as this app's own defaults
// so the energy-credit formula/solver (rewardEconomy.js) and Ops export
// start from real, calibrated numbers rather than placeholder zeros. Still
// fully economist-editable from here - this is a starting point, not a
// frozen constant (a saved segment's own edited values always win - see
// board.js's createBoard, which only calls this for a BRAND NEW board/
// segment with nothing of its own yet).
//
// prizeAmount is the single literal number each syntax string itself
// encodes (e.g. "coins:245679" -> 245679; "[dynamic(dr-merge:15)]" -> 15) -
// a joined bonus like "+free_wild:1" or "+free_entry:1" isn't a numeric
// prize amount this app's own economy math can use, so it's preserved in
// the syntax text (for Ops export fidelity) but not folded into
// prizeAmount.
const REFERENCE_REWARD_CHAIN_SEED = {
  // Coins are paid as a share of the player's coin ALLOWANCE, never as a
  // literal coin count - payout syntax `allowance(coins:0.12)` (see the
  // coin-allowance helpers below). The older reference's literal amounts
  // (coins:100000 ...) are therefore NOT seeded: an allowance worth per rank
  // is an economy decision this app does not make up. Only the asset id,
  // which did not change, is carried over.
  coins: [
    { syntax: '', asset: 'merge-config-coin-v2', prizeAmount: 0 },
    { syntax: '', asset: 'merge-config-coin-v2', prizeAmount: 0 },
    { syntax: '', asset: 'merge-config-coin-v2', prizeAmount: 0 },
    { syntax: '', asset: 'merge-config-coin-v2', prizeAmount: 0 },
  ],
  energy: [
    { syntax: '[dynamic(dr-merge:5)]', asset: 'merge-config-dr-v2', prizeAmount: 5 },
    { syntax: '[dynamic(dr-merge:15)]', asset: 'merge-config-dr-v2', prizeAmount: 15 },
    { syntax: '[dynamic(dr-merge:35)]', asset: 'merge-config-dr-v2', prizeAmount: 35 },
    { syntax: '[dynamic(dr-merge:75)]', asset: 'merge-config-dr-v2', prizeAmount: 75 },
  ],
  puzzles: [
    { syntax: '[dynamic(dr-puzzle:5)]', asset: 'merge-config-puzzle-v2', prizeAmount: 5 },
    { syntax: '[dynamic(dr-puzzle:15)]', asset: 'merge-config-puzzle-v2', prizeAmount: 15 },
    { syntax: '[dynamic(dr-puzzle:15)]', asset: 'merge-config-puzzle-v2', prizeAmount: 15 },
    { syntax: '[dynamic(dr-puzzle:40)]', asset: 'merge-config-puzzle-v2', prizeAmount: 40 },
  ],
  charms: [
    { syntax: '[dynamic(dr-mf-charm:5)]', asset: 'merge-config-mfcharm-v2', prizeAmount: 5 },
    // One item pays ONE resource (economist: "the syntax of the items should
    // only give 1 resource"); their example sheet has charm-r2 as 10 charms.
    // It was seeded from an older reference as
    // 'free_undo:1+[dynamic(dr-mf-charm:4)]+free_entry:1'.
    { syntax: '[dynamic(dr-mf-charm:10)]', asset: 'merge-config-mfcharm-v2', prizeAmount: 10 },
    { syntax: '[dynamic(dr-mf-charm:30)]', asset: 'merge-config-mfcharm-v2', prizeAmount: 30 },
    { syntax: '[dynamic(dr-mf-charm:40)]', asset: 'merge-config-mfcharm-v2', prizeAmount: 40 },
  ],
}

// The whole reward-chain config: one ladder per REWARD_TYPES entry, seeded
// with the real Ops reference by default.
// Twister starts BLANK (no syntax, no asset, zero DR per rank): no Ops
// reference for it exists here, and neither its item syntax nor its DR
// values are this app's to invent. The economist enters them in the Twister
// tab; until then Twister items are worth nothing and the Twister workflow
// says it is not configured.
export function createRewardChainConfig() {
  const config = {}
  for (const type of REWARD_TYPES) config[type] = createRewardTypeConfig(REFERENCE_REWARD_CHAIN_SEED[type])
  config[TWISTER_TYPE] = createRewardTypeConfig()
  return config
}

// Backfills any reward type a saved config predates (a save from before
// Twister existed has no `twister` ladder) without touching what is there.
export function ensureRewardChainConfig(config) {
  if (!config) return createRewardChainConfig()
  let next = config
  for (const type of ALL_REWARD_TYPES) {
    if (!Array.isArray(next[type]) || next[type].length < REWARD_MAX_RANK) {
      if (next === config) next = { ...config }
      next[type] = Array.from({ length: REWARD_MAX_RANK }, (_, i) => createRewardRankConfig(config[type]?.[i] ?? {}))
    }
  }
  // A saved project that still has the old charm rank-2 seed, untouched, gets
  // the one-resource version (see the seed above). Anything typed is left as
  // it is.
  const charm2 = next.charms?.[1]
  if (charm2 && charm2.syntax === OLD_CHARM_R2_SEED.syntax && charm2.prizeAmount === OLD_CHARM_R2_SEED.prizeAmount) {
    if (next === config) next = { ...config }
    next.charms = next.charms.map((r, i) => (i === 1 ? { ...r, syntax: '[dynamic(dr-mf-charm:10)]', prizeAmount: 10 } : r))
  }
  return next
}

const OLD_CHARM_R2_SEED = { syntax: 'free_undo:1+[dynamic(dr-mf-charm:4)]+free_entry:1', prizeAmount: 4 }

// Rank syntaxes that pay more than one resource (a "+" joining several
// terms), as [{ type, rank, syntax }] - an item should pay one.
export function multiResourceSyntaxes(rewardChainConfig) {
  const out = []
  for (const type of ALL_REWARD_TYPES) {
    ;(rewardChainConfig?.[type] ?? []).forEach((entry, i) => {
      const syntax = String(entry?.syntax ?? '')
      if (syntax.split('+').filter((part) => part.trim() !== '').length > 1) out.push({ type, rank: i + 1, syntax })
    })
  }
  return out
}

// --- Coin allowance ------------------------------------------------------
// A coin reward's value is its ALLOWANCE WORTH: a multiple of the player's
// own coin allowance (0.12 = 12% of an allowance), paid with the syntax
// `allowance(coins:0.12)`. It is not a coin count, and the two must never
// be shown as if they were the same thing: every coin figure in the app is
// labelled "allowance" and formatted with decimals (formatRewardAmount),
// and a target of "1.5" means one and a half allowances.
export const COIN_TYPE = 'coins'

// What a resource's amounts are measured in, for labels next to numbers.
export const REWARD_AMOUNT_UNIT = { coins: 'allowance', puzzles: 'puzzles', energy: 'energy', charms: 'charms', twister: 'Twister DR' }
// What a resource's TARGET is called (a collectible payout, not an item count).
export const REWARD_TARGET_LABELS = { coins: 'Coin allowance', puzzles: 'Puzzles', energy: 'Merge energy', charms: 'Charms' }

export function coinAllowanceSyntax(worth) {
  if (!(worth > 0)) return ''
  return `allowance(coins:${Number(Number(worth).toFixed(6))})`
}

// The allowance worth a syntax string pays, or null when it has no
// allowance(coins:...) term.
export function parseCoinAllowanceSyntax(syntax) {
  const m = /allowance\(\s*coins\s*:\s*([0-9]*\.?[0-9]+)\s*\)/i.exec(syntax ?? '')
  return m ? Number(m[1]) : null
}

// A coin rank still written the old way - a literal amount (`coins:100000`)
// rather than an allowance worth. Kept exactly as saved (never converted:
// the size of an allowance is not known here), and reported.
export function isLiteralCoinDefinition(entry) {
  const syntax = entry?.syntax ?? ''
  return /(^|[+\s])coins\s*:\s*\d/i.test(syntax) && parseCoinAllowanceSyntax(syntax) == null
}

export function hasLiteralCoinDefinitions(rewardChainConfig) {
  return (rewardChainConfig?.[COIN_TYPE] ?? []).some(isLiteralCoinDefinition)
}

// Whether a typed syntax is exactly the plain allowance pattern (or empty),
// i.e. safe to keep in step with the worth as it is edited. Anything the
// economist extended by hand ("allowance(coins:0.2)+free_wild:1") is left
// alone.
export function coinSyntaxFollowsWorth(syntax) {
  const s = (syntax ?? '').trim()
  return s === '' || /^allowance\(\s*coins\s*:\s*[0-9]*\.?[0-9]+\s*\)$/i.test(s)
}

// --- Whole numbers --------------------------------------------------------
// By explicit economist rule: coins (an allowance worth) are the ONLY reward
// amount that may be a fraction. Puzzles, merge energy and charms are whole
// numbers everywhere - targets, rank values and what the app displays. A
// derived amount (base target x segment factor) is rounded to the nearest
// whole number; coins keep three decimals.
export function roundRewardAmount(type, value) {
  if (value == null || !Number.isFinite(value)) return 0
  if (type === COIN_TYPE) return Math.round(value * 1000) / 1000
  return Math.round(value)
}

// --- Coin rank values set by the build --------------------------------------
// By explicit economist request the app fills in the coin rank values itself,
// and may give each SEGMENT its own values: merge-drop odds are shared by
// every segment, so the number of coin items a player gets is much the same
// everywhere, and what a coin item is WORTH is the lever that lands each
// segment on its own coin target.
//
// The proportions between the four ranks are fixed (COIN_VALUE_SHAPE - it
// satisfies the merge rule with room to spare: 0.6 > 2 x 0.27 > 4 x 0.12 >
// 8 x 0.05); the build scales all four together. A generated rank carries
// `auto: true`. A coin ladder is "set by the build" while every rank is either
// blank or generated; typing any value makes the whole ladder the economist's
// own (shared by every segment like the other resources) until it is cleared.
export const COIN_VALUE_SHAPE = [0.05, 0.12, 0.27, 0.6]

export function coinLadderIsAuto(rewardChainConfig) {
  const ladder = rewardChainConfig?.[COIN_TYPE]
  if (!Array.isArray(ladder)) return true
  return ladder.every((r) => r?.auto === true || (!((r?.prizeAmount ?? 0) > 0) && (r?.syntax ?? '').trim() === ''))
}

// (In round amounts - niceCoinValues, below.)
export function coinValuesForScale(scale) {
  return niceCoinValues(COIN_VALUE_SHAPE[REWARD_MAX_RANK - 1] * scale)
}

// ROUND AMOUNTS (economist: "i want the model to give the values of the ranks
// but with nice rounding for the amounts"). The values the model gives a
// reward's four ranks are always:
//   - round: a whole number under 10, a multiple of 5 up to 200, of 10 up to
//     1,000, of 50 beyond (`niceNearest` / `niceFloor`); coin allowance worth
//     in hundredths (thousandths when the top one is under 0.2);
//   - worth MERGING: each rank at least double the one below and rank 4 more
//     than the items it is made of, so tapping an item early never pays more
//     than merging it on (validateRewardLadder). The reference values the
//     tool was seeded with did not (puzzles 5/15/15/40, charms 5/10/30/40) -
//     a player who tapped got half as much again as the build had sized for.
// The proportions are the ladder typed, when that one already rewards
// merging, else 1 : 3 : 7 : 15 (the merge energy reference, 5/15/35/75).
// (A rank-4 value moves in these steps, so a reward's average lands within
// half a step of what it should be: about 3% for a top value of 75, 6% for
// one of 40. That is what round amounts cost.)
const NICE_STEPS = [
  [10, 1],
  [200, 5],
  [1000, 10],
  [5000, 50],
  [Infinity, 100],
]
export const niceStepAt = (v) => NICE_STEPS.find(([limit]) => v < limit)[1]
// The largest round amount that is not above `v` (0 when v is under 1).
export function niceFloor(v) {
  if (!(v >= 1)) return 0
  const step = niceStepAt(v)
  return Math.floor(v / step + 1e-9) * step
}
// The round amount nearest to `v` (at least 1).
export function niceNearest(v) {
  const low = Math.max(1, niceFloor(v))
  const high = low + niceStepAt(low)
  return v - low < high - v ? low : high
}
export const REWARD_VALUE_SHAPE = [1 / 15, 3 / 15, 7 / 15]
// The largest round amount strictly below `v` (0 when there is none).
export function niceBelow(v) {
  const at = niceFloor(v)
  if (at < v - 1e-9) return at
  if (at <= 1) return 0
  return niceFloor(at - 1e-6)
}
// The smallest round amount strictly above `v`.
export function niceAbove(v) {
  const low = niceFloor(v)
  if (low < 1) return 1
  return low + niceStepAt(low)
}
// EVERY UPGRADE STRICTLY REWARDS MERGING (economist: "V2 > 2 x V1, V3 > 2 x
// V2, V4 > 2 x V3. Equality is insufficient."). The smallest whole-number
// ladder that does is 1 / 3 / 7 / 15, so no model-given rank-4 value is under
// 15. (It was "at least double" below the top rank: 3 / 10 / 20 / 50 and
// 5 / 10 / 30 / 70 were given, where merging two items paid exactly what
// tapping them did.)
export const REWARD_MIN_TOP = 15
function ladderShape(values) {
  const top = values?.[REWARD_MAX_RANK - 1] ?? 0
  if (!(top > 0) || validateRewardLadder(values.map((prizeAmount) => ({ prizeAmount }))).length > 0) return REWARD_VALUE_SHAPE
  return [values[0] / top, values[1] / top, values[2] / top]
}
// Four round values, each more than double the one below, with rank 4 as near
// `top` as a round amount gets. `like`: a ladder whose proportions to follow
// (see above).
export function niceRewardValues(top, like = null) {
  const shape = like ? ladderShape(like) : REWARD_VALUE_SHAPE
  let v4 = Math.max(REWARD_MIN_TOP, niceNearest(top))
  let v3 = Math.min(niceFloor(shape[2] * v4), niceBelow(v4 / 2))
  let v2 = Math.min(niceFloor(shape[1] * v4), niceBelow(v3 / 2))
  const v1 = Math.max(1, Math.min(niceFloor(shape[0] * v4), niceBelow(v2 / 2)))
  // (the lower ranks could not go low enough: the higher ones go up instead)
  if (!(v2 > 2 * v1)) v2 = niceAbove(2 * v1)
  if (!(v3 > 2 * v2)) v3 = niceAbove(2 * v2)
  if (!(v4 > 2 * v3)) v4 = niceAbove(2 * v3)
  return [v1, v2, v3, v4]
}
// The same for a coin ladder (an allowance worth, so in hundredths).
export function niceCoinValues(top) {
  const step = top >= 0.2 ? 0.01 : 0.001
  const n4 = Math.max(15, Math.round(top / step))
  let n3 = Math.floor(Math.min((COIN_VALUE_SHAPE[2] / COIN_VALUE_SHAPE[3]) * n4, (n4 - 1) / 2) + 1e-9)
  let n2 = Math.floor(Math.min((COIN_VALUE_SHAPE[1] / COIN_VALUE_SHAPE[3]) * n4, (n3 - 1) / 2) + 1e-9)
  const n1 = Math.max(1, Math.floor(Math.min((COIN_VALUE_SHAPE[0] / COIN_VALUE_SHAPE[3]) * n4, (n2 - 1) / 2) + 1e-9))
  n2 = Math.max(n2, 2 * n1 + 1)
  n3 = Math.max(n3, 2 * n2 + 1)
  return [n1, n2, n3, Math.max(n4, 2 * n3 + 1)].map((n) => Math.round(n * step * 1000) / 1000)
}

// The config with the coin ranks set to generated `values` (syntax written to
// match). Everything else about each rank (asset, display) is kept.
export function withGeneratedCoinValues(rewardChainConfig, values) {
  const ladder = (rewardChainConfig?.[COIN_TYPE] ?? createRewardTypeConfig()).map((entry, i) => ({
    ...entry,
    prizeAmount: values[i],
    syntax: coinAllowanceSyntax(values[i]),
    auto: true,
  }))
  return { ...rewardChainConfig, [COIN_TYPE]: ladder }
}

// Hands the coin ranks back to the build: values and syntax cleared.
export function withBlankCoinValues(rewardChainConfig) {
  const ladder = (rewardChainConfig?.[COIN_TYPE] ?? createRewardTypeConfig()).map((entry) => {
    const next = { ...entry, prizeAmount: 0, syntax: '' }
    delete next.auto
    return next
  })
  return { ...rewardChainConfig, [COIN_TYPE]: ladder }
}

// THE TWISTER ITEM'S SYNTAX, when none was typed: the amount written the way
// the other rewards write theirs ("[dynamic(dr-merge:75)]"), with this app's
// own name for the resource - `dr-twister`, NOT a confirmed Ops name. Without
// it the Small Rewards sheet listed the Twister keys with no amount at all
// (economist: "why dont we have the twister amount in the ranks?"). A syntax
// typed by hand always wins.
export const TWISTER_SYNTAX_NAME = 'dr-twister'
export const twisterItemSyntax = (value) => (value > 0 ? `[dynamic(${TWISTER_SYNTAX_NAME}:${value})]` : '')
export function twisterSyntaxFor(entry) {
  const typed = String(entry?.syntax ?? '').trim()
  return typed !== '' ? typed : twisterItemSyntax(entry?.prizeAmount ?? 0)
}
// A syntax holding exactly one amount ("[dynamic(name:N)]") with that amount
// replaced; anything else is returned as it was.
export function syntaxWithAmount(syntax, value) {
  const s = String(syntax ?? '')
  const terms = [...s.matchAll(/dynamic\(\s*[a-z0-9-]+\s*:\s*([0-9]*\.?[0-9]+)\s*\)/gi)]
  if (terms.length !== 1) return s
  return s.replace(/(dynamic\(\s*[a-z0-9-]+\s*:\s*)([0-9]*\.?[0-9]+)(\s*\))/i, (_, a, __, c) => `${a}${value}${c}`)
}

// VALUES TYPED BY HAND ARE NEVER OVERWRITTEN BY A BUILD. A ladder the build
// sets (coins, and Twister DR after "Add a Twister") carries `auto: true` on
// its ranks; the build keeps sizing it only while every rank still does.
// Every screen where values can be typed or pasted passes its result through
// this: for each reward whose values changed, every rank of it loses `auto`,
// so the whole ladder is the economist's from then on. (Found from an
// economist report: Twister values typed in the Twister tool kept `auto`,
// and the next build replaced them - a rank 4 paid 165, not what was typed.)
export function withTypedLadders(before, after) {
  if (!after) return after
  let out = after
  for (const type of ALL_REWARD_TYPES) {
    const was = (before?.[type] ?? []).map((r) => r?.prizeAmount ?? 0)
    const now = (after?.[type] ?? []).map((r) => r?.prizeAmount ?? 0)
    if (JSON.stringify(was) === JSON.stringify(now)) continue
    if (!(after[type] ?? []).some((r) => r?.auto)) continue
    out = {
      ...out,
      [type]: after[type].map((r) => {
        if (!r?.auto) return r
        const next = { ...r }
        delete next.auto
        return next
      }),
    }
  }
  return out
}

// The economist typed a coin value: the ladder is theirs now.
export function withManualCoinLadder(rewardChainConfig) {
  const ladder = (rewardChainConfig?.[COIN_TYPE] ?? []).map((entry) => {
    if (!entry?.auto) return entry
    const next = { ...entry }
    delete next.auto
    return next
  })
  return { ...rewardChainConfig, [COIN_TYPE]: ladder }
}

// Reward definitions are one shared set, copied from the base segment to every
// other segment. The one exception is a coin ladder set by the build: each
// segment keeps its OWN generated coin values. This returns what a segment
// should hold given the base segment's config and its own current one.
// So are the puzzle, merge energy and charm values the build gives: each
// segment keeps its own (economist, asked: "Per segment"), for as long as the
// values TYPED for that reward are the same as the base segment's. A reward
// whose typed definition changed goes back to the base segment's.
export function mergeSharedRewardChain(source, target) {
  if (!source) return source
  let out = source
  if (coinLadderIsAuto(source)) {
    const own = target?.[COIN_TYPE]
    const keepOwn = Array.isArray(own) && coinLadderIsAuto(target)
    const ladder = source[COIN_TYPE].map((entry, i) => {
      const kept = keepOwn ? own[i] : null
      const next = { ...entry, prizeAmount: kept?.prizeAmount ?? 0, syntax: kept?.syntax ?? '' }
      if (kept?.auto) next.auto = true
      else delete next.auto
      return next
    })
    out = { ...out, [COIN_TYPE]: ladder }
  }
  const definition = (config, type) => JSON.stringify((config?.[type] ?? []).map((r) => [r?.typed?.prizeAmount ?? r?.prizeAmount ?? 0, r?.typed?.syntax ?? r?.syntax ?? '', r?.asset ?? '']))
  // A SEGMENT'S OWN VALUES ARE ITS OWN WHETHER OR NOT THEY ARE MARKED. A rank
  // the build re-valued remembers what was typed (`typed`), and that mark used
  // to be what told a segment's own ladder apart. But a build that gives a
  // segment EXACTLY the typed values (merge energy 5/15/35/75 for a segment
  // whose amount needs a top value of 75) changes no rank and leaves no mark -
  // and the copy from Segment 1 then replaced that segment's values with
  // Segment 1's. Its boards had been built for other values: step 5 said
  // "Segment 6 ... changed since it was built" and stopped the export
  // (economist: "i cant understand what that means"). While the typed
  // definition is the same on both sides, the segment keeps its ladder.
  for (const type of BUILD_VALUED_TYPES) {
    if (!Array.isArray(target?.[type])) continue
    if (definition(source, type) === definition(target, type)) out = { ...out, [type]: target[type] }
  }
  // The Twister values the build fits are each segment's own as well (never
  // typed ones: those are the definition and shared).
  if (twisterLadderIsAuto(source) && twisterLadderIsAuto(target)) out = { ...out, [TWISTER_TYPE]: target[TWISTER_TYPE] }
  return out
}

// The definitions as an INPUT to a build: generated coin values are an output
// of the build, so they must not make the draft that produced them look out
// of date.
export function rewardChainAsBuildInput(rewardChainConfig) {
  if (!rewardChainConfig) return rewardChainConfig
  // Rank values the build changed are an output too: the input is what the
  // economist typed (withTypedRewardValues, below).
  let out = withTypedRewardValues(rewardChainConfig)
  if (coinLadderIsAuto(out)) out = { ...out, [COIN_TYPE]: 'set-by-build' }
  // Twister rank values that nobody typed are sized by the build too (see
  // twisterLadderIsAuto): only that they exist is an input.
  if (twisterLadderIsAuto(out)) out = { ...out, [TWISTER_TYPE]: 'set-by-build' }
  return out
}

// RANK VALUES THE BUILD MAY CHANGE (puzzles, merge energy, charms) - by
// explicit economist decision: "we can maybe change the vlaue of a rank if
// there is a problem to get to the target. u can also insert it into the
// simualtor. im ok with him suggesting the DR values in the ranks ... but we
// need to try and stay on the rules we give". The drop rules (how many items
// a merge of each rank drops, which reward sits under the tiles, which board
// holds what) are fixed; when they cannot pay a reward's amount at the values
// typed, the build keeps the rules and changes that reward's four rank VALUES
// instead, all by one factor: a payout is the same items times their value,
// so the same drops then pay the amount asked.
//   - What the economist typed stays the DEFINITION. A rank the build
//     re-valued keeps it in `typed: { prizeAmount, syntax }`; the build always
//     starts again from the typed values (so nothing compounds), a typed
//     ladder is what the definitions editor shows and edits, and it is what
//     counts as a build input. The re-valued numbers are a RESULT, like the
//     coin values and the Twister values the build sets.
//   - EACH SEGMENT ITS OWN (economist, asked: "Per segment"), like coins: a
//     segment that merges more gets smaller values, so every segment lands on
//     its own amounts. (It used to be one set, sized on the base segment; the
//     other segments then landed 20% to 45% over.)
//   - Puzzles, merge energy and charms are whole numbers, and the values the
//     build gives are ROUND and reward merging (niceRewardValues).
export const BUILD_VALUED_TYPES = REWARD_TYPES.filter((t) => t !== COIN_TYPE)
// The build changes a reward's values by at most this much either way; a
// reward further off than that is reported instead. This app's own numbers.
// (0.1x to 10x. It was 0.2x to 5x while a change of values was the exception;
// now that the model gives every segment its values - and collected leftovers
// make small amounts payable - a small amount regularly needs less than a
// fifth of the typed top value.)
export const REWARD_VALUE_FACTOR_MIN = 0.1
export const REWARD_VALUE_FACTOR_MAX = 10

export function rewardLadderIsBuildValued(rewardChainConfig, type) {
  return (rewardChainConfig?.[type] ?? []).some((r) => r?.typed != null)
}

// The four values the economist typed for a reward (whatever the build did since).
export function typedRewardValues(rewardChainConfig, type) {
  return (rewardChainConfig?.[type] ?? []).slice(0, REWARD_MAX_RANK).map((r) => r?.typed?.prizeAmount ?? r?.prizeAmount ?? 0)
}

// The definitions as typed: every rank the build re-valued goes back to its
// typed value and syntax. Coins and Twister are not touched (their own rules).
export function withTypedRewardValues(rewardChainConfig) {
  if (!rewardChainConfig) return rewardChainConfig
  let out = rewardChainConfig
  for (const type of BUILD_VALUED_TYPES) {
    if (!rewardLadderIsBuildValued(out, type)) continue
    out = {
      ...out,
      [type]: out[type].map((entry) => {
        if (entry?.typed == null) return entry
        const { typed, ...rest } = entry
        return { ...rest, prizeAmount: typed.prizeAmount, syntax: typed.syntax }
      }),
    }
  }
  return out
}

// A ladder's values times `factor`, as whole numbers (a rank with no value
// stays at none; a rank with one never drops under 1 or under the rank below).
export function scaledRewardValues(values, factor) {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1
  // A whole ladder: the model's round, merge-rewarding values at that size.
  if (values.length >= REWARD_MAX_RANK && values.slice(0, REWARD_MAX_RANK).every((v) => v > 0)) return niceRewardValues(values[REWARD_MAX_RANK - 1] * f, values)
  const out = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? 0
    if (!(v > 0)) {
      out.push(0)
      continue
    }
    out.push(Math.max(1, Math.round(v * f), i > 0 && values[i] >= values[i - 1] ? out[i - 1] : 0))
  }
  return out
}

// The config with one reward's ranks set to `values` BY THE BUILD: written
// from the typed ladder (never from an earlier re-valuing), the number inside
// each rank's item syntax following when that is safe, and every changed rank
// remembering what was typed.
export function withBuildRewardValues(rewardChainConfig, type, values) {
  // Only THIS reward goes back to its typed ladder first: another reward the
  // build already re-valued keeps its new values.
  const typedLadder = (rewardChainConfig?.[type] ?? []).map((entry) => {
    if (entry?.typed == null) return entry
    const { typed, ...rest } = entry
    return { ...rest, prizeAmount: typed.prizeAmount, syntax: typed.syntax }
  })
  const typedConfig = { ...rewardChainConfig, [type]: typedLadder }
  const { rewardChainConfig: next, syntaxNotUpdated } = applyLadderValues(typedConfig, type, values)
  const ladder = next[type].map((entry, i) => {
    const was = typedLadder[i]
    if (!was || (was.prizeAmount ?? 0) === (entry.prizeAmount ?? 0)) return entry
    return { ...entry, typed: { prizeAmount: was.prizeAmount ?? 0, syntax: was.syntax ?? '' } }
  })
  return { rewardChainConfig: { ...next, [type]: ladder }, syntaxNotUpdated }
}

// The Twister DR rank values are "set by the build" while every rank that has
// a value carries `auto: true` (written by "Add a Twister", never typed). The
// build then sizes them: the values are this app's own starting numbers, the
// price of a twist is measured in them, so making all four bigger together is
// how a player collects enough Twister DR for the twists asked WITHOUT the
// drops becoming bigger items. By explicit economist feedback: "we see only
// drops of the twister in rank3. its too high, it makes the rank1 of it
// useless."
export function twisterLadderIsAuto(rewardChainConfig) {
  const ladder = (rewardChainConfig?.[TWISTER_TYPE] ?? []).slice(0, REWARD_MAX_RANK)
  return ladder.some((r) => (r?.prizeAmount ?? 0) > 0) && ladder.every((r) => !((r?.prizeAmount ?? 0) > 0) || r.auto === true)
}

// A reward amount as text. Coin allowance keeps up to 3 decimals (0.12 must
// not round to 0.1); Twister DR keeps one; puzzles, merge energy and charms
// are whole numbers (an average over simulated players is shown rounded).
export function formatRewardAmount(type, value, { unit = false } = {}) {
  if (value == null || !Number.isFinite(value)) return '—'
  const digits = type === COIN_TYPE ? 3 : type === TWISTER_TYPE ? 1 : 0
  const text = value.toLocaleString(undefined, { maximumFractionDigits: digits })
  if (!unit) return text
  return type === COIN_TYPE ? `${text}× allowance` : `${text} ${REWARD_AMOUNT_UNIT[type] ?? ''}`.trim()
}

export function rewardLadderIsConfigured(rewardChainConfig, type) {
  return (rewardChainConfig?.[type] ?? []).some((r) => (r?.prizeAmount ?? 0) > 0)
}

// The reward values a phase plays with, when it follows another phase.
// Everything on the board comes along into Recompletion (and on into endless
// mode), so an item earned in the normal event can be merged and collected
// there. A phase's own ladder is used for every resource it has values for;
// a resource it has NO values for (typically coins, when Recompletion has no
// coin target and the build therefore never filled its coin ranks) keeps the
// previous phase's values - otherwise the carried items would pay nothing.
// Only the four small rewards: Twister's ladder is each list's own, by its
// own rule (see twisterEconomy.js).
export function rewardChainForNextPhase(previous, next) {
  if (!next) return previous ?? null
  if (!previous) return next
  const merged = { ...next }
  for (const type of REWARD_TYPES) {
    if (!rewardLadderIsConfigured(next, type) && rewardLadderIsConfigured(previous, type)) merged[type] = previous[type]
  }
  return merged
}

export function rewardPrizeAmount(rewardChainConfig, type, rank) {
  return rewardChainConfig?.[type]?.[rank - 1]?.prizeAmount ?? 0
}

// What ONE source unit of a reward (a rank-1 item's worth of it) pays at
// best: a rank-r item is 2^(r-1) units, so its prize / 2^(r-1), at the rank
// where that is highest. For rank values that reward merging this is rank 4;
// for values that do not, it is the rank a player does better to tap the item
// at (see `bestCollectRank`).
export function bestUnitValue(rewardChainConfig, type) {
  let best = 0
  for (let rank = 1; rank <= REWARD_MAX_RANK; rank++) best = Math.max(best, rewardPrizeAmount(rewardChainConfig, type, rank) / 2 ** (rank - 1))
  return best
}

// Whether tapping an item of `rank` to collect it pays at least as much as
// merging it on: no higher rank pays more per source unit. Always true at
// rank 4 (it collects by itself). With rank values that reward merging it is
// false at every rank below 4.
export function tapPaysAtLeastAsMuch(rewardChainConfig, type, rank) {
  if (rank >= REWARD_MAX_RANK) return true
  const perUnit = (r) => rewardPrizeAmount(rewardChainConfig, type, r) / 2 ** (r - 1)
  const here = perUnit(rank)
  if (!(here > 0)) return false
  for (let r = rank + 1; r <= REWARD_MAX_RANK; r++) if (perUnit(r) > here + 1e-12) return false
  return true
}

// "Reward ladders must reward merging." A rank-N item is built from 2^(N-1)
// rank-1 source items, so merging only pays when each rank is worth more
// than the items it was built from. Checked per ladder:
//   - rank 4 > 2 x rank 3, > 4 x rank 2 and > 8 x rank 1 (strictly: rank 4 is
//     where the automatic player is headed, so it has to beat every way of
//     cashing out the same items earlier);
//   - EVERY merge pays strictly more: rank N+1 > 2 x rank N at every step
//     (economist: "V2 > 2 x V1, V3 > 2 x V2, V4 > 2 x V3. Equality is
//     insufficient." It used to be >= below the top rank.) A step that pays
//     less is 'merge-step-loses-value'; one that pays exactly the same is
//     'merge-step-pays-no-more'.
// A ladder with no prize configured at all is skipped (nothing to judge -
// "not configured" is reported separately by whoever needs that).
// Nothing here changes a value; it only reports.
export function validateRewardLadder(ladder) {
  const value = (rank) => ladder?.[rank - 1]?.prizeAmount ?? 0
  if (!ladder || !ladder.some((r) => (r?.prizeAmount ?? 0) > 0)) return []
  const issues = []
  const top = value(REWARD_MAX_RANK)
  for (let rank = REWARD_MAX_RANK - 1; rank >= 1; rank--) {
    const count = 2 ** (REWARD_MAX_RANK - rank)
    if (!(top > count * value(rank))) {
      issues.push({
        code: 'top-rank-not-best',
        rank,
        message: `Rank ${REWARD_MAX_RANK} (${top}) is not worth more than the ${count} rank-${rank} items it takes (${count} x ${value(rank)} = ${count * value(rank)}), so collecting at rank ${rank} pays at least as much.`,
      })
    }
  }
  for (let rank = 1; rank < REWARD_MAX_RANK - 1; rank++) {
    if (value(rank + 1) < 2 * value(rank) - 1e-12) {
      issues.push({
        code: 'merge-step-loses-value',
        rank,
        message: `Merging two rank-${rank} items (2 x ${value(rank)} = ${2 * value(rank)}) into one rank-${rank + 1} item (${value(rank + 1)}) loses value.`,
      })
    } else if (!(value(rank + 1) > 2 * value(rank) + 1e-12) && value(rank) > 0) {
      issues.push({
        code: 'merge-step-pays-no-more',
        rank,
        message: `Merging two rank-${rank} items (2 x ${value(rank)} = ${2 * value(rank)}) into one rank-${rank + 1} item (${value(rank + 1)}) pays no more than tapping them: rank ${rank + 1} has to be worth more than ${2 * value(rank)}.`,
      })
    }
  }
  return issues
}

// --- Fixing a ladder that fails the merge rule --------------------------------
// Two ways to make a ladder valid with the smallest change, offered to the
// economist (never applied on its own):
//   'raise' - rank 1 stays; each higher rank is raised just enough.
//   'lower' - rank 4 stays; each lower rank is lowered just enough.
// Whole numbers for everything but coins. A suggestion that would change
// nothing, or cannot be made valid (a rank would have to drop to zero), is
// left out.
export function suggestLadderFixes(ladder, { whole = true } = {}) {
  const current = Array.from({ length: REWARD_MAX_RANK }, (_, i) => ladder?.[i]?.prizeAmount ?? 0)
  if (validateRewardLadder(ladder).length === 0) return []
  const step = whole ? 1 : 0.001
  const tidy = (v) => (whole ? Math.round(v) : Math.round(v * 1000) / 1000)
  const above = (v) => tidy(Math.floor(v / step + 1e-9) * step + step) // smallest allowed value strictly above v
  const below = (v) => tidy(Math.ceil(v / step - 1e-9) * step - step) // largest allowed value strictly below v
  const asLadder = (values) => values.map((prizeAmount) => ({ prizeAmount }))
  const options = []

  if (current[0] > 0) {
    const v = [...current]
    // (a round number just above the minimum reads better than "31")
    const roundAbove = (x) => (whole && above(x) >= 10 ? Math.ceil(above(x) / 5) * 5 : above(x))
    if (!(v[1] > 2 * v[0])) v[1] = roundAbove(2 * v[0])
    if (!(v[2] > 2 * v[1])) v[2] = roundAbove(2 * v[1])
    const floor = Math.max(2 * v[2], 4 * v[1], 8 * v[0])
    if (!(v[3] > floor)) {
      // A round number just above the minimum reads better than "61".
      const round = whole ? Math.ceil(above(floor) / 5) * 5 : above(floor)
      v[3] = round
    }
    options.push({ id: 'raise', label: 'Raise the higher ranks', values: v.map(tidy) })
  }
  if (current[3] > 0) {
    const v = [...current]
    v[2] = Math.min(v[2], below(v[3] / 2))
    v[1] = Math.min(v[1], below(v[2] / 2), below(v[3] / 4))
    v[0] = Math.min(v[0], below(v[1] / 2), below(v[3] / 8))
    options.push({ id: 'lower', label: 'Lower the lower ranks', values: v.map(tidy) })
  }
  return options.filter((o) => o.values.every((x) => x > 0) && o.values.some((x, i) => x !== current[i]) && validateRewardLadder(asLadder(o.values)).length === 0)
}

// Writes new rank values into a ladder. The payout number inside each rank's
// item syntax is updated too when that can be done safely: the syntax holds
// exactly one `dynamic(<name>:<number>)` term (or is the plain coin-allowance
// pattern) and its number is the old value. Anything else is left as written
// and listed in `syntaxNotUpdated` (rank numbers) for the economist to edit.
export function applyLadderValues(rewardChainConfig, type, values) {
  const syntaxNotUpdated = []
  const ladder = (rewardChainConfig?.[type] ?? createRewardTypeConfig()).map((entry, i) => {
    const old = entry?.prizeAmount ?? 0
    const value = values[i]
    if (value === old) return entry
    const next = { ...entry, prizeAmount: value }
    delete next.auto
    const syntax = entry?.syntax ?? ''
    if (type === COIN_TYPE) {
      if (coinSyntaxFollowsWorth(syntax)) next.syntax = coinAllowanceSyntax(value)
      else syntaxNotUpdated.push(i + 1)
    } else if (syntax.trim() !== '') {
      const terms = [...syntax.matchAll(/dynamic\(\s*[a-z0-9-]+\s*:\s*([0-9]*\.?[0-9]+)\s*\)/gi)]
      if (terms.length === 1 && Number(terms[0][1]) === old) {
        next.syntax = syntax.replace(/(dynamic\(\s*[a-z0-9-]+\s*:\s*)([0-9]*\.?[0-9]+)(\s*\))/i, (_, a, __, c) => `${a}${value}${c}`)
      } else {
        syntaxNotUpdated.push(i + 1)
      }
    }
    return next
  })
  return { rewardChainConfig: { ...rewardChainConfig, [type]: ladder }, syntaxNotUpdated }
}

// One finding per affected type: { type, issues: [{code, rank, message}],
// message } - `message` joins the issues for callers that show one line.
export function validateRewardChainConfig(rewardChainConfig, types = ALL_REWARD_TYPES) {
  const findings = []
  for (const type of types) {
    const issues = validateRewardLadder(rewardChainConfig?.[type])
    if (issues.length) findings.push({ type, issues, message: issues.map((i) => i.message).join(' ') })
  }
  return findings
}
