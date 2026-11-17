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
    { syntax: 'free_undo:1+[dynamic(dr-mf-charm:4)]+free_entry:1', asset: 'merge-config-mfcharm-v2', prizeAmount: 4 },
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
  return next
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

export function coinValuesForScale(scale) {
  return COIN_VALUE_SHAPE.map((v) => Math.round(v * scale * 1000) / 1000)
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
export function mergeSharedRewardChain(source, target) {
  if (!source || !coinLadderIsAuto(source)) return source
  const own = target?.[COIN_TYPE]
  const keepOwn = Array.isArray(own) && coinLadderIsAuto(target)
  const ladder = source[COIN_TYPE].map((entry, i) => {
    const kept = keepOwn ? own[i] : null
    const next = { ...entry, prizeAmount: kept?.prizeAmount ?? 0, syntax: kept?.syntax ?? '' }
    if (kept?.auto) next.auto = true
    else delete next.auto
    return next
  })
  return { ...source, [COIN_TYPE]: ladder }
}

// The definitions as an INPUT to a build: generated coin values are an output
// of the build, so they must not make the draft that produced them look out
// of date.
export function rewardChainAsBuildInput(rewardChainConfig) {
  if (!rewardChainConfig) return rewardChainConfig
  let out = rewardChainConfig
  if (coinLadderIsAuto(out)) out = { ...out, [COIN_TYPE]: 'set-by-build' }
  // Twister rank values that nobody typed are sized by the build too (see
  // twisterLadderIsAuto): only that they exist is an input.
  if (twisterLadderIsAuto(out)) out = { ...out, [TWISTER_TYPE]: 'set-by-build' }
  return out
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

// The same ladder with every value multiplied by a whole number (which keeps
// the merge rule: rank 4 still beats cashing out early by the same margin).
export function scaledTwisterLadder(rewardChainConfig, factor) {
  const k = Math.max(1, Math.round(factor))
  return (rewardChainConfig?.[TWISTER_TYPE] ?? []).map((r) => ((r?.prizeAmount ?? 0) > 0 ? { ...r, prizeAmount: r.prizeAmount * k } : r))
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

// "Reward ladders must reward merging." A rank-N item is built from 2^(N-1)
// rank-1 source items, so merging only pays when each rank is worth more
// than the items it was built from. Checked per ladder:
//   - rank 4 > 2 x rank 3, > 4 x rank 2 and > 8 x rank 1 (strictly: rank 4 is
//     where the automatic player is headed, so it has to beat every way of
//     cashing out the same items earlier);
//   - no intermediate merge loses value: rank N+1 >= 2 x rank N for the
//     steps below the top (merging two items into one worth less than the
//     pair is a step a player should never take).
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
    if (value(rank + 1) < 2 * value(rank)) {
      issues.push({
        code: 'merge-step-loses-value',
        rank,
        message: `Merging two rank-${rank} items (2 x ${value(rank)} = ${2 * value(rank)}) into one rank-${rank + 1} item (${value(rank + 1)}) loses value.`,
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
    v[1] = Math.max(v[1], 2 * v[0])
    v[2] = Math.max(v[2], 2 * v[1])
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
    v[1] = Math.min(v[1], whole ? Math.floor(v[2] / 2) : v[2] / 2, below(v[3] / 4))
    v[0] = Math.min(v[0], whole ? Math.floor(v[1] / 2) : v[1] / 2, below(v[3] / 8))
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
