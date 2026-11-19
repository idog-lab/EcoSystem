import ExcelJS from 'exceljs'
import { buildGeneratorTiers, DEFAULT_TIER2_UNLOCK_RANK, DEFAULT_TIER4_UNLOCK_RANK } from '../core/generatorTier'
import { computeProbs, DEFAULT_TARGET_EV } from '../core/luckyDrop'
import { MIN_RANK, MAX_RANK, RC_MAX_RANK } from '../core/ranks'
import { REWARD_TYPES, ALL_REWARD_TYPES, TWISTER_TYPE, REWARD_TYPE_LABELS, REWARD_MAX_RANK, smallRewardKey, decodeReward, twisterSyntaxFor, DEFAULT_LEFTOVER_POLICY } from '../rewards/rewardChain'
import { targetSpinsForSegment } from '../rewards/twisterEconomy'
import { containersOfBoards, containersOfEvent, modelContainers } from '../rewards/containers'
import { endlessOfDesign, ENDLESS_DROP_RANK_SHIFT, ENDLESS_DROP_VALUE_MULTIPLIER, ENDLESS_COIN_ENERGY_SHARE } from '../rewards/endlessMode'

// Board 1's own configured tier unlock ranks (economist-editable now, see
// board.js/BoardEditor.jsx's "Generator tiers" card) - the "one canonical
// event-level value" precedent Event Data's TutorialDrAmount and Generator
// Weights' targetEv already use, since these sheets are one global table,
// not per-board. Shared by buildMultipliersSheet and buildGeneratorWeightsSheet
// so both always agree on the same tiers for the same board list.
function generatorTiersFor(boards) {
  const board = boards[0]
  return buildGeneratorTiers(board?.tier2UnlockRank ?? DEFAULT_TIER2_UNLOCK_RANK, board?.tier4UnlockRank ?? DEFAULT_TIER4_UNLOCK_RANK)
}

// Real Ops config sheets, built one sheet at a time from the economist's own
// reference spreadsheets — replacing boardSyntax.js's placeholder export,
// sheet by sheet, as each one gets specced out. Most sheets share one flat
// shape: `{ columns, rows }`, where each row is `{ cells: [...], highlight? }`
// — matching each source spreadsheet's own columns exactly (not free-form
// text). See SyntaxPage.jsx's table rendering, which is generic over that
// shape rather than hardcoded to any one sheet's column set, since sheets
// don't all share the same layout (Multipliers already differs from Event
// Data). Board Layouts (the third sheet) doesn't fit that flat shape at all
// — see its own comment below — and gets its own dedicated rendering.

// Every row's Value is a literal constant for this event EXCEPT where noted -
// don't "clean up" a parameter's exact spelling (e.g. MergehHintInactivityTimer's
// typo) or casing against the source sheet; Ops reads these keys literally.
const EVENT_DATA_TEMPLATE = [
  { parameter: 'Dynamic Resource Key', value: 'dr-merge', info: 'The unique event currency ID' },
  { parameter: 'Base Popup ID', value: 'merge-popup-v26', info: 'Base popup template ID', highlight: true },
  { parameter: 'FeatureAssetId', value: 'merge-config-v10', info: 'Feature asset bundle ID for this reskin', highlight: true },
  // TutorialDrAmount is the one value this tool computes rather than copies
  // verbatim - see buildEventDataSheet below.
  { parameter: 'TutorialDrAmount', value: null, info: 'Free DRs granted via Event Start Popup for all players' },
  { parameter: 'ShowStartBanner', value: 'TRUE', info: 'Does the Event Start Popup display the MTX banner?' },
  { parameter: 'MergehHintInactivityTimer', value: 2, info: 'How long before match hint fires, set to 0 to disable (sec)' },
  {
    parameter: 'Tutorial',
    value: 'TRUE',
    info: 'When true, returning players get the full info screen + guided tutorial on this event run. Default off.',
  },
  { parameter: 'Last Tier', value: 12, info: 'what rank is the last tier of the first completion - triggers recompletion' },
  { parameter: 'ShowStartPopup', value: 'TRUE', info: '' },
  { parameter: 'Load Popup ID', value: 'merge-transition-in-v7', info: '' },
  { parameter: 'Unload Popup ID', value: 'merge-transition-in-v7', info: '' },
  { parameter: 'StartPopupID', value: 'merge-start-popup-v10', info: '' },
  { parameter: 'TodayOnlyReward', value: 'free_stock:1', info: '' },
  { parameter: 'ItemFamilyName', value: 'Garden', info: 'Used for analytics' },
]

const EVENT_DATA_COLUMNS = ['Parameter', 'Value', 'Info']

// Board 1's own "DR the player gets" onboarding-goal field (GoalSolver.jsx) IS
// TutorialDrAmount - the Event Start Popup's free-DR grant is exactly what the
// onboarding goal is sized against, so this is the one row that tracks board
// state instead of staying a fixed template constant. Left blank (not the
// template's original 30) when no onboarding goal is set, rather than silently
// claiming a DR amount the board wasn't actually configured with.
export function buildEventDataSheet(boards) {
  const onboardingDrBudget = boards[0]?.onboardingDrBudget
  const rows = EVENT_DATA_TEMPLATE.map((row) => {
    const value = row.parameter === 'TutorialDrAmount' ? (onboardingDrBudget ?? '') : row.value
    return { cells: [row.parameter, value, row.info], highlight: row.highlight }
  })
  // Info (last column) is descriptive prose, not a data value - rendered
  // differently (see SyntaxPage.jsx's proseColumns handling) so it doesn't
  // read as mono-spaced tabular data the way Parameter/Value do.
  return { columns: EVENT_DATA_COLUMNS, rows, proseColumns: [2] }
}

// This header WAS "Lucky Drop Thershold" (missing an 'h') - the typo in the
// original reference screenshot, preserved deliberately at the time for the
// same reason MergehHintInactivityTimer's typo still is. The economist's
// current reference spreadsheet spells it correctly, so it's corrected here
// too: the rule is "transcribe the source sheet literally," not "keep every
// typo forever," and the source itself changed. MergehHintInactivityTimer is
// still misspelled in that same current reference, so that one stays.
const MULTIPLIERS_COLUMNS = ['Multiplier', 'Unlock Tier', 'Lucky Drop Threshold']

// The rank at which this tier's generator starts producing lucky drops at
// all: one rank above the tier's own normal output (x1 -> T1 normally, so 2;
// x2 -> T2, so 3; x4 -> T3, so 4), matching the economist's reference sheet
// exactly. This REPLACES the old "Unlock Tier + 2" derivation, which only
// happened to be right for x1 (0+2=2) and gave 9/12 for x2/x4 where the
// reference says 3/4. Unlike the old version this is no longer export-only:
// buildGeneratorWeightsSheet gates each row's bonus weights on it (a rank-1
// row for x1 gets no +1/+2 weights at all, exactly as the reference shows).
// It still doesn't change the app's own in-game lucky-drop gate
// (luckyDrop.js), which unlocks as a single whole at rank 7.
export function luckyDropThreshold(tier) {
  return tier.normalRank + 1
}

// One row per real generator tier (x1/x2/x4, from Board 1's own configured
// tier2UnlockRank/tier4UnlockRank via generatorTiersFor - see board.js) -
// not the source template's extra "x/y/z" placeholder rows, which only
// illustrate that the sheet supports more tiers than this game actually
// has. Unlock Tier is each tier's own unlock rank (`unlocksAt`), 0 for x1
// (always available, matching the source template's own "no unlock needed"
// convention for its first row). Lucky Drop Threshold comes from
// luckyDropThreshold() above.
export function buildMultipliersSheet(boards) {
  const rows = generatorTiersFor(boards).map((tier) => ({ cells: [tier.cost, tier.unlocksAt ?? 0, luckyDropThreshold(tier)] }))
  return { columns: MULTIPLIERS_COLUMNS, rows }
}

// One column per rank of the whole event - 14 since Recompletion's ranks 13
// and 14 are part of it (economist: "the generator weight should add the new
// rank 13 and 14"). The generator never makes an item above T5, so T13 and
// T14 are always 0; they are there so the table is as wide as the ladder.
// (The economist's own sheet shows rows to rank 16 and five more columns
// after T12; asked, the answer was: "we need now only the until rank 14".)
const GENERATOR_WEIGHTS_COLUMNS = ['Rank', 'Multiplier', ...Array.from({ length: RC_MAX_RANK }, (_, i) => `T${i + 1} weight`)]

// One row per (rank, generator tier) combo where that tier is actually
// unlocked - the source template sequences its rows by RANK ascending
// first, with multiplier ascending *within* each rank (rank 5 mult 1, rank 5
// mult 2, rank 6 mult 1, rank 6 mult 2, ...) - found live, an earlier version
// of this got the nesting backwards (grouped by multiplier first, all of x1
// then all of x2 then all of x4), which reads completely differently even
// though it contains the same set of rows. Substituting this game's real,
// board-configured unlock ranks for the template's generic example
// thresholds, same as buildMultipliersSheet does, so a given rank's
// row(s) only include a tier once it's actually unlocked at or before that
// rank. Every row for a given tier gets the IDENTICAL weight triple, by
// explicit economist instruction ("we give the same % when the user holds
// different ranks") - this sheet doesn't vary the distribution by which
// specific rank row it's in, unlike the app's own play-time lucky-drop gate
// (rank 7 held) which the Lucky-Drop Monte Carlo simulator already
// similarly abstracts away (see luckyDrop.js's simulateLuckyDrops - "as if
// the rank-7 gate were already unlocked for the whole run"). The three
// non-zero weights land on T(normalRank), T(normalRank+1), T(normalRank+2)
// - e.g. tier x4's normalRank=3 puts them at T3/T4/T5, matching the source
// template's own example row (Rank 8, Multiplier 4 -> T3=95, T4=3, T5=2).
// targetEv is read from Board 1 - it's still stored per-board (see
// useBoardListState.js's syncTargetEv), but every board in a list now
// shares the identical value by construction, so reading board 0's copy is
// exactly as correct as reading any other board's.
// RANKS 13 AND 14 are the two Recompletion adds. They can only be held in
// Recompletion, so their rows are written with the Recompletion list's own
// lucky-drop EV and multiplier unlock ranks (the normal list's when there is
// no Recompletion list) - the same three weights in the same three columns
// as every other row of that multiplier.
export function buildGeneratorWeightsSheet(boards, recompletionBoards = []) {
  const rows = []
  const rcList = Array.isArray(recompletionBoards) && recompletionBoards.length > 0 ? recompletionBoards : boards
  generatorWeightRows(boards, MIN_RANK, MAX_RANK, rows)
  generatorWeightRows(rcList, MAX_RANK + 1, RC_MAX_RANK, rows)
  return { columns: GENERATOR_WEIGHTS_COLUMNS, rows }
}

function generatorWeightRows(boards, fromRank, toRank, rows) {
  const targetEv = boards[0]?.targetEv ?? DEFAULT_TARGET_EV
  const tiers = generatorTiersFor(boards)
  const [pNormal, pPlus1, pPlus2] = computeProbs(targetEv)
  // Whole-number weights out of 1000 (targetEv 1.1 -> 929 / 57 / 14), matching
  // the reference sheet exactly. This was previously scaled to one decimal
  // place out of 100 instead (92.9 / 5.7 / 1.4) - the same distribution, but
  // Ops' own sheet uses the integer-per-mille form, and integers can't drift
  // on a parser that rounds or reads them as ints.
  const asWeight = (p) => Math.round(p * 1000)

  for (let rank = fromRank; rank <= toRank; rank++) {
    for (const tier of tiers) {
      const startRank = tier.unlocksAt ?? MIN_RANK
      if (rank < startRank) continue
      const weights = Array(RC_MAX_RANK).fill(0)
      weights[tier.normalRank - 1] = asWeight(pNormal)
      // Below this tier's own lucky-drop threshold the row carries ONLY its
      // normal weight - no +1/+2 columns at all. In practice this only ever
      // bites x1's rank-1 row (x2/x4 don't unlock until well past their own
      // thresholds), which is exactly the one asymmetric row the reference
      // sheet shows: rank 1, multiplier 1, T1=929 and nothing else.
      if (rank >= luckyDropThreshold(tier)) {
        weights[tier.normalRank] = asWeight(pPlus1)
        weights[tier.normalRank + 1] = asWeight(pPlus2)
      }
      rows.push({ cells: [rank, tier.cost, ...weights] })
    }
  }
}

const BLOCKED_QUEUE_COLUMNS = ['Entry Number', 'Pool Number', 'Item', 'Stock', 'Weight']

// The source template's own Blocked Queue models real weighted-random loot
// pools - several alternative Items sharing one Pool Number, each with its
// own Stock (how many total) and Weight (relative odds within that pool).
// This game's blocked queue has no such randomness or alternatives - it's a
// fixed, ordered sequence of ranks - so, by explicit economist instruction,
// this sheet is a deliberately simpler special case of that same shape:
// every queue entry gets its OWN pool (a trivial one-item "pool"), Stock and
// Weight both fixed at 1 since there's nothing to randomize among.
//
// Item is the plain rank NUMBER (1, 2, 3...), matching the economist's
// reference spreadsheet. It was previously written as `dr-r{rank}`, borrowed
// from the original template's own dr-r1/dr-r2 reward-key naming - but that
// naming belongs to the Small Rewards key table (below), not to this column,
// and the reference's own Blocked Queue holds bare rank numbers. Entry Number
// and Pool Number are identical here as a
// result (one entry per pool) - kept as two separate columns anyway to
// match the source sheet's own schema exactly, not collapsed into one.
//
// Combines every board's blockedQueue, in play order, into one continuous
// table (Entry Number keeps counting up across board boundaries) - not
// semiPlacements, which are fixed grid positions rather than a queue.
//
// ONE QUEUE FOR THE WHOLE EVENT (economist: "now we need to merge the normal
// and the RC one after another, because they happen one after another in the
// same event"). With `recompletionBoards` the Recompletion boards' entries
// follow the normal ones in the same table and the Entry Number carries on -
// there is no separate "Recompletion Blocked Queue" sheet any more. (They
// used to be two tables, each starting at 1.)
export function buildBlockedQueueSheet(boards, recompletionBoards = []) {
  const rows = []
  let n = 0
  for (const board of [...(boards ?? []), ...(recompletionBoards ?? [])]) {
    for (const rank of board.blockedQueue) {
      n += 1
      // A mixed queue's reward entry (V2) exports its real Ops key
      // ("coin-r2", "dr-r3"... - the Small Rewards sheet's own naming),
      // never the internal encoded number (1000+), which no Ops parser
      // could interpret. Main-chain entries stay bare rank numbers, per the
      // verified reference.
      const reward = decodeReward(rank)
      // Twister DR is never blocked-queue content (it only comes from merge
      // drops). Nothing in the app writes one; if a hand-edited import ever
      // carried one, it is left out here rather than exported.
      if (reward?.type === TWISTER_TYPE) {
        n -= 1
        continue
      }
      rows.push({ cells: [n, n, reward ? smallRewardKey(reward.type, reward.rank) : rank, 1, 1] })
    }
  }
  return { columns: BLOCKED_QUEUE_COLUMNS, rows }
}

const ITEM_LADDER_COLUMNS = ['Tier', 'Asset ID', 'Milestone Reward Syntax']

// One row per rank 1..MAX_RANK - every tier gets an Asset ID (a fixed
// `item-t{tier}` naming pattern), matching the source template's own
// every-tier rows, not just the ones that happen to be reward ranks.
// "Milestone Reward Syntax" is populated only for ranks the economist has
// actually marked in Board 1's "Rank rewards" card (`rewardRanks`) and
// typed content for (`rewardSyntax` - see board.js and BoardEditor.jsx's
// "Milestone reward syntax" inputs, added specifically to support this
// sheet); every other tier's cell is blank, matching the source template's
// mostly-empty column. Read from Board 1 only, the same "one canonical
// event-level value" precedent as Event Data/Generator Weights, since the
// reward ladder spans the whole rank chain (1-12), not a single physical
// board - `rewardRanks`/`rewardSyntax` technically live on every board
// object, but only board 1's is treated as the source of truth here.
//
// ONE LADDER FOR THE WHOLE EVENT (economist: "in the item ladder we need to
// hold the ladders also together"). With `recompletionBoards` the ladder runs
// to rank 14: tiers 1 to 12 are the normal list's, and tiers 13 and 14 - the
// two ranks Recompletion adds - are the Recompletion list's own milestone
// rewards. There is no separate Recompletion ladder any more. Called with one
// list only, it is that list's ladder to rank 12, as before.
export function buildItemLadderSheet(boards, recompletionBoards = null) {
  const board = boards?.[0]
  const rc = recompletionBoards?.[0] ?? null
  const rows = []
  const row = (source, tier) => {
    const syntax = source?.rewardRanks?.includes(tier) ? (source.rewardSyntax?.[tier] ?? '') : ''
    rows.push({ cells: [tier, `item-t${tier}`, syntax] })
  }
  for (let tier = MIN_RANK; tier <= MAX_RANK; tier++) row(board, tier)
  if (recompletionBoards) for (let tier = MAX_RANK + 1; tier <= RC_MAX_RANK; tier++) row(rc ?? board, tier)
  return { columns: ITEM_LADDER_COLUMNS, rows }
}

// V2 (small-reward chains / drop groups) - NOT part of the economist's
// verified Ops reference spreadsheet (see this file's own header comment on
// "the economist's live reference spreadsheet is the format's authority" -
// these two sheets have no counterpart there at all, since V2's production
// Ops spec doesn't exist yet). Deliberately NOT named/shaped to look like a
// verified production sheet, and deliberately NOT folded into the legacy
// "Small Rewards"/"Small Rewards Bank"/"Small Reward Weights" fake templates
// above (whose coin-r1/dr-r1/sticker-r1/gen-r1 naming is a different,
// pre-V2 reward concept this model doesn't reuse) - this is an honest
// internal-model export pending real Ops confirmation, per the spec's own
// instruction to "complete the internal model + a clearly-labeled V2
// configuration export" rather than inventing production mappings.
// Every V2 sheet covers all three of a segment's lists - Main, RC A, RC B -
// through a leading List column, so each phase/variant's own reward
// definitions, drop configuration and economy settings are identified
// unambiguously in one tab apiece rather than three.
const V2_LISTS = (boards, recompletionBoards) =>
  [
    ['Main', boards],
    // One Recompletion mode. (A second list, "Recompletion B", used to be
    // exported too; the parameter survives in these signatures only so older
    // callers keep working, and is ignored.)
    ['RC', recompletionBoards],
  ].filter(([, list]) => Array.isArray(list) && list.length > 0)

// Key is the identifier a reward item is written with wherever a queue or
// layout cell references one (Blocked Queue's Item column, a Board Layouts
// semi cell) - the Small Rewards sheet's own key naming. That those keys are
// what PRODUCTION expects in those cells is NOT confirmed by any Ops
// reference (the reference's own queues hold bare main ranks only); this
// sheet makes the key -> configured item syntax mapping explicit so it can
// be checked rather than assumed.
const V2_REWARD_CHAIN_COLUMNS = ['List', 'Resource', 'Rank', 'Key (unverified)', 'Item syntax', 'Asset ID', 'Prize amount']

// NOTHING IS WRITTEN TWICE (economist: "in alot of pages we got many duplicants
// of think we dont need"). Recompletion plays the normal event's rank values,
// so the two lists hold the same definitions: they are listed ONCE, as
// "Main + RC". Only when a list really differs (a Recompletion design from
// before that rule, not built again yet) is it listed on its own.
export function buildV2RewardChainSheet(boards, recompletionBoards = [], recompletionBoards2 = []) {
  const blocks = []
  for (const [listName, list] of V2_LISTS(boards, recompletionBoards, recompletionBoards2)) {
    const config = list[0]?.rewardChainConfig
    if (!config) continue
    const cells = []
    // Twister DR's ladder is listed with the other definitions (it is a
    // shared reward definition); its rows are drop-only items and its key is
    // never written in a queue or layout cell.
    for (const type of ALL_REWARD_TYPES) {
      for (let rank = 1; rank <= REWARD_MAX_RANK; rank++) {
        const entry = config[type]?.[rank - 1]
        if (!entry) continue
        cells.push([REWARD_TYPE_LABELS[type], rank, smallRewardKey(type, rank), entry.syntax, entry.asset ?? '', entry.prizeAmount])
      }
    }
    const same = blocks.find((b) => JSON.stringify(b.cells) === JSON.stringify(cells))
    if (same) same.names.push(listName)
    else blocks.push({ names: [listName], cells })
  }
  const rows = blocks.flatMap((b) => b.cells.map((c) => ({ cells: [b.names.join(' + '), ...c] })))
  return { columns: V2_REWARD_CHAIN_COLUMNS, rows }
}

const V2_DROP_GROUPS_COLUMNS = ['List', 'Resulting rank', 'Group', 'Weight', 'Coins rank', 'Puzzles rank', 'Energy rank', 'Charms rank', 'Twister DR rank', 'Rank locked']

// The event has ONE drop table: a merge drops the same in the normal event and
// in Recompletion. So each resulting rank is listed once - "Main + RC" where
// the two lists agree (every rank the normal event makes), "RC" for the two
// ranks only Recompletion makes (13 and 14). The normal list's own rows for
// 13 and 14 are never played and are left out; a "(no drop)" line is written
// only where a merge can really drop nothing. (It used to list every rank
// twice, once per list, with a zero "(no drop)" line at each.)
export function buildV2DropGroupsSheet(boards, recompletionBoards = [], recompletionBoards2 = []) {
  const lists = V2_LISTS(boards, recompletionBoards, recompletionBoards2).map(([name, list]) => ({ name, board: list[0] }))
  // One rank of one list, as cells without the list name (null: the list does not play that rank).
  const rankRows = ({ name, board }, rank) => {
    // Ranks below the list's own drop gate never roll, and the normal event
    // never makes rank 13 or 14 (only Recompletion does).
    if (rank < (board?.minDropRank ?? 1) || (name === 'Main' && rank > MAX_RANK)) return null
    const table = board?.dropGroupsConfig?.[rank - 1]
    if (!table) return null
    const groupsById = new Map((board.dropGroups ?? []).map((g) => [g.id, g]))
    const locked = table.locked ? 'yes' : ''
    const out = []
    if ((table.noDropWeight ?? 0) > 0) out.push([rank, '(no drop)', table.noDropWeight, '', '', '', '', '', locked])
    for (const entry of table.entries) {
      if (!(entry.weight > 0)) continue
      const group = groupsById.get(entry.groupId)
      out.push([rank, group?.name ?? entry.groupId, entry.weight, group?.items?.coins ?? '', group?.items?.puzzles ?? '', group?.items?.energy ?? '', group?.items?.charms ?? '', group?.items?.[TWISTER_TYPE] ?? '', locked])
    }
    return out.length > 0 ? out : null
  }
  const rows = []
  for (let rank = 1; rank <= RC_MAX_RANK; rank++) {
    const blocks = []
    for (const list of lists) {
      const cells = rankRows(list, rank)
      if (!cells) continue
      const same = blocks.find((b) => JSON.stringify(b.cells) === JSON.stringify(cells))
      if (same) same.names.push(list.name)
      else blocks.push({ names: [list.name], cells })
    }
    for (const b of blocks) for (const c of b.cells) rows.push({ cells: [b.names.join(' + '), ...c] })
  }
  return { columns: V2_DROP_GROUPS_COLUMNS, rows }
}

// V2 Economy - the economy levers the other V2 sheets don't carry: per board,
// its subsidy and CC % (applied BEFORE the 80% energy credit -
// rewardEconomy.js's computeEffectiveSubsidy) and the reward items under its
// blocked and semi-blocked tiles; per list, the merge-drop gate and the
// leftover policy.
const V2_ECONOMY_COLUMNS = [
  'List',
  'Board',
  'Blocked value (DR)',
  'CC %',
  'Min drop rank',
  'Leftover policy',
  'Reward items under blocked tiles',
  'Reward items on semi tiles (row:col=key)',
  // What the board's main-chain contents were built for when that differs
  // from its budget (after CC and the 80% energy credit). Blank = the budget.
  'Built allocation (DR)',
]

export function buildV2EconomySheet(boards, recompletionBoards = [], recompletionBoards2 = []) {
  const rows = []
  for (const [listName, list] of V2_LISTS(boards, recompletionBoards, recompletionBoards2)) {
    for (const b of list) {
      const queueItems = (b.rewardQueueItems ?? []).map((it) => smallRewardKey(it.type, it.rank)).join('+')
      const semiItems = (b.rewardSemiItems ?? []).map((it) => `${it.row + 1}:${it.col + 1}=${smallRewardKey(it.type, it.rank)}`).join(' ')
      rows.push({
        cells: [listName, b.name, b.blockedValue, Math.round((b.ccPercent ?? 0) * 100), b.minDropRank ?? '', b.rewardLeftoverPolicy ?? DEFAULT_LEFTOVER_POLICY, queueItems, semiItems, b.effectiveBlockedValue ?? ''],
      })
    }
  }
  return { columns: V2_ECONOMY_COLUMNS, rows }
}

// V2 Twister - the Twister widget's settings, kept apart from the SHARED
// Twister definitions (its rank ladder is in V2 Reward Chain, its drop odds
// in V2 Drop Groups - both one configuration across segments). What this
// sheet carries is what is NOT shared, plus the design inputs behind it:
//   - "Runtime - segment-specific": the DR cost per spin, per list.
//   - "Runtime - shared": the optional widget length, when one is configured.
//   - "Design metadata - not runtime": the checkpoint, target spins and
//     simulation settings the cost was derived from. These configure nothing
//     in the game; they record how the price was arrived at.
// Not a verified Ops sheet - no production contract for Twister exists here.
const V2_TWISTER_RUNTIME_SEGMENT = 'Runtime - segment-specific'
const V2_TWISTER_RUNTIME_SHARED = 'Runtime - shared across segments'
const V2_TWISTER_DESIGN = 'Design metadata - not runtime'
const V2_TWISTER_COLUMNS = ['Section', 'List', 'Setting', 'Value', 'Notes']

function twisterRuntimeRows(boards, recompletionBoards, recompletionBoards2) {
  const rows = []
  for (const [listName, list] of V2_LISTS(boards, recompletionBoards, recompletionBoards2)) {
    const cost = list[0]?.twisterSpinCost
    rows.push([V2_TWISTER_RUNTIME_SEGMENT, listName, 'DR cost per spin (dr-twister)', cost ?? '', cost == null ? 'not set' : ''])
  }
  return rows
}

function twisterSharedRows(boards, recompletionBoards, recompletionBoards2) {
  const rows = []
  for (const [listName, list] of V2_LISTS(boards, recompletionBoards, recompletionBoards2)) {
    const objective = list[0]?.twisterSpinObjective
    rows.push([
      V2_TWISTER_RUNTIME_SHARED,
      listName,
      'Spins to complete the widget',
      objective ?? '',
      objective == null ? 'not configured - no fixed widget length is assumed' : '',
    ])
  }
  return rows
}

function twisterDesignRows(twisterPlan, segmentIndex, boards, recompletionBoards) {
  const rows = []
  for (const [phaseName, key, list] of [
    ['Main', 'main', boards],
    ['RC', 'rc', recompletionBoards],
  ]) {
    const plan = twisterPlan?.[key]
    if (!plan) continue
    const target = segmentIndex == null ? plan.targetSpins : targetSpinsForSegment(plan, segmentIndex, list?.[0]?.twisterSpinObjective ?? null)
    rows.push([V2_TWISTER_DESIGN, phaseName, 'Progression checkpoint (% of main-chain DR progress)', plan.checkpointPct ?? '', ''])
    rows.push([V2_TWISTER_DESIGN, phaseName, 'Target spins by the checkpoint', target ?? '', target == null ? 'not entered' : ''])
    rows.push([V2_TWISTER_DESIGN, phaseName, 'Cost increment (DR)', plan.costIncrement ?? 1, ''])
    rows.push([V2_TWISTER_DESIGN, phaseName, 'Simulation runs', plan.runs ?? '', ''])
    rows.push([V2_TWISTER_DESIGN, phaseName, 'Simulation seed', plan.seed ?? '', ''])
  }
  return rows
}

export function buildV2TwisterSheet(boards, recompletionBoards = [], recompletionBoards2 = [], { twisterPlan = null, segmentIndex = 0 } = {}) {
  const rows = [
    ...twisterRuntimeRows(boards, recompletionBoards, recompletionBoards2),
    ...twisterSharedRows(boards, recompletionBoards, recompletionBoards2),
    ...twisterDesignRows(twisterPlan, segmentIndex, boards, recompletionBoards),
  ]
  return { columns: V2_TWISTER_COLUMNS, rows: rows.map((cells) => ({ cells })) }
}

// The combined (all-segments) form: every segment's own cost per list in one
// table, the shared widget rule once (Segment 1's - it is shared), and the
// design metadata once, with any per-segment target overrides listed.
export function buildCombinedV2TwisterSheet(segments, { twisterPlan = null } = {}) {
  const rows = []
  segments.forEach((seg, i) => {
    for (const row of twisterRuntimeRows(seg.boards, seg.recompletionBoards, seg.recompletionBoards2)) rows.push([row[0], `S${i + 1}`, ...row.slice(1)])
  })
  const first = segments[0]
  if (first) {
    for (const row of twisterSharedRows(first.boards, first.recompletionBoards, first.recompletionBoards2)) rows.push([row[0], 'all', ...row.slice(1)])
    for (const row of twisterDesignRows(twisterPlan, null, first.boards, first.recompletionBoards)) rows.push([row[0], 'all', ...row.slice(1)])
  }
  for (const [phaseName, key] of [
    ['Main', 'main'],
    ['RC', 'rc'],
  ]) {
    for (const [index, value] of Object.entries(twisterPlan?.[key]?.targetSpinsOverrides ?? {})) {
      if (!(value > 0)) continue
      rows.push([V2_TWISTER_DESIGN, `S${Number(index) + 1}`, phaseName, 'Target spins by the checkpoint (override)', value, ''])
    }
  }
  return { columns: ['Section', 'Segment', 'List', 'Setting', 'Value', 'Notes'], rows: rows.map((cells) => ({ cells })) }
}

// The last three sheets of the economist's reference spreadsheet are the
// "small rewards" system - the incidental coin/DR/puzzle/charm drops a merge
// can produce, entirely separate from the Item Ladder's milestone rewards.
// Originally these were pure template constants (the app had no small-reward
// domain model at all) - now board-driven off the real V2 config
// (rewardChain.js's rewardChainConfig, smallRewardsBank.js's bank/weights
// config), economist-editable in the Rewards (V2) tab's "Small Rewards"
// cards, seeded with the real Ops reference by default (see each config
// factory's own comment).
const SMALL_REWARDS_COLUMNS = ['Key', 'Syntax', 'Asset']

export function buildSmallRewardsSheet(boards, recompletionBoards = []) {
  const config = boards?.[0]?.rewardChainConfig
  const rows = []
  if (!config) return { columns: SMALL_REWARDS_COLUMNS, rows }
  // In the order of the economist's own example output ("Merge Out.xlsx"):
  // coin, dr (merge energy), puzzle, charm - four ranks each.
  const order = ['coins', 'energy', 'puzzles', 'charms'].filter((t) => REWARD_TYPES.includes(t))
  for (const type of [...order, ...REWARD_TYPES.filter((t) => !order.includes(t))]) {
    for (let rank = 1; rank <= REWARD_MAX_RANK; rank++) {
      const entry = config[type][rank - 1]
      rows.push({ cells: [smallRewardKey(type, rank), entry.syntax, entry.asset] })
    }
  }
  // The Twister item is not in that example. When this list's containers
  // drop it, its keys are listed too, after the four rewards - otherwise a
  // container in the Small Rewards Bank would name a key this sheet does not
  // have. Its syntax is the one typed, else the amount in the other rewards'
  // pattern (rewardChain.js: twisterSyntaxFor - an unverified name); its asset
  // is whatever was typed.
  // (The event's containers run to merge tier 14, and tiers 13 and 14 are
  // the Recompletion list's - so its Twister items count too.)
  const dropsTwister = [...(boards?.[0]?.dropGroups ?? []), ...(recompletionBoards?.[0]?.dropGroups ?? [])].some((g) => g?.items?.twister != null)
  if (dropsTwister && Array.isArray(config.twister)) {
    for (let rank = 1; rank <= REWARD_MAX_RANK; rank++) {
      const entry = config.twister[rank - 1] ?? {}
      rows.push({ cells: [smallRewardKey('twister', rank), twisterSyntaxFor(entry), entry.asset ?? ''] })
    }
  }
  return { columns: SMALL_REWARDS_COLUMNS, rows }
}

const SMALL_REWARDS_BANK_COLUMNS = ['Key', 'Syntax']

// THE CONTAINERS COME FROM THE MODEL (containers.js): each drop group the
// list plays is one container - its key (ContA, ContB, ...), its syntax in
// Small Rewards keys, and its weight per merge tier straight from that
// rank's drop table. `phase` says which list `boards` is: 'main' (merge
// tiers 2-12, the reference's own range) or 'rc' (2-14).
// A design with no merge drops yet has no containers: the bank is empty and
// every tier is NoDrop only (`source: 'none'`) - which is exactly what that
// design does when it is played. (It used to fall back to an older
// hand-typed table from the Rewards tab that nothing played; the economist
// opened the sheet, saw that table - ten containers, one with a weight - and
// reasonably took it for what the model had made.)
//
// THE EVENT'S OWN TWO SHEETS RUN TO MERGE TIER 14 (economist: "the small
// rewards should hold a drop for the rank13 and 14 merge"): with
// `recompletionBoards` given (an array, even an empty one) the normal sheets
// carry tiers 13 and 14 as well - containers.js: containersOfEvent. Tiers 13
// and 14 are what Recompletion drops there; the "RC" sheets still hold all of
// Recompletion's own weights (its tiers 6 to 12 differ from the normal ones).
export function buildSmallRewardsBankSheet(boards, { phase = 'main', recompletionBoards = null } = {}) {
  const model = phase === 'main' && recompletionBoards ? containersOfEvent(boards, recompletionBoards) : containersOfBoards(boards, phase)
  return { columns: SMALL_REWARDS_BANK_COLUMNS, rows: model.containers.map((c) => ({ cells: [c.key, c.syntax] })), source: model.containers.length > 0 ? 'model' : 'none' }
}

export function buildSmallRewardWeightsSheet(boards, { phase = 'main', recompletionBoards = null } = {}) {
  const event = phase === 'main' && !!recompletionBoards
  const model = event ? containersOfEvent(boards, recompletionBoards) : containersOfBoards(boards, phase)
  const weightOf = (row, c) => (event ? row.weightsByKey[c.key] : row.weights[c.id]) ?? 0
  return {
    columns: ['Merge Tier', ...model.containers.map((c) => c.key), 'NoDrop'],
    rows: model.rows.map((row) => ({ cells: [row.tier, ...model.containers.map((c) => weightOf(row, c)), row.noDrop] })),
    source: model.containers.length > 0 ? 'model' : 'none',
  }
}

// ENDLESS MODE (after rank 14) drops its own containers, worked out from the
// Recompletion list's (endlessMode.js: endlessOfDesign - the same function a
// played session uses, so the sheets match what is played). Ops needs them
// as well, in the same two shapes as the real sheets: a bank (Key + Syntax)
// and weights per merge tier 2-14. NOT in the Ops reference; a design with
// no Recompletion list has no endless mode and gets empty sheets.
function endlessContainers(boards, recompletionBoards) {
  const endless = endlessOfDesign(boards, recompletionBoards)
  if (!endless) return { endless: null, containers: [], rows: [] }
  return { endless, ...modelContainers({ dropGroups: endless.dropGroups, dropGroupsConfig: endless.dropGroupsConfig, minDropRank: endless.minDropRank, phase: 'rc' }) }
}

export function buildEndlessBankSheet(boards, recompletionBoards) {
  const { containers } = endlessContainers(boards, recompletionBoards)
  return { columns: SMALL_REWARDS_BANK_COLUMNS, rows: containers.map((c) => ({ cells: [c.key, c.syntax] })), source: 'endless' }
}

export function buildEndlessWeightsSheet(boards, recompletionBoards) {
  const { containers, rows } = endlessContainers(boards, recompletionBoards)
  return {
    columns: ['Merge Tier', ...containers.map((c) => c.key), 'NoDrop'],
    rows: rows.map((row) => ({ cells: [row.tier, ...containers.map((c) => row.weights[c.id] ?? 0), row.noDrop] })),
    source: 'endless',
  }
}

// The rules endless mode runs on, for whoever sets it up. The setting NAMES
// are this app's own - there is no Ops sheet for endless mode - so this is a
// V2 internal sheet, like the other V2 tabs.
export function buildV2EndlessSheet(boards, recompletionBoards) {
  const { endless, containers } = endlessContainers(boards, recompletionBoards)
  const columns = ['Setting', 'Value', 'Notes']
  if (!endless) return { columns, rows: [{ cells: ['Endless mode', 'none', 'This design has no Recompletion list, so play ends at rank 12 and there is no endless mode.'] }] }
  const rows = [
    ['Starts when the player holds rank', RC_MAX_RANK, 'The merge that makes rank 14. Nothing on the board is removed; play has no end.'],
    ['Top rank', RC_MAX_RANK, 'Two rank 14 items do not merge.'],
    ['Merge drops start at rank (endless)', endless.minDropRank, 'The rank the merge makes. From this rank every merge drops a container.'],
    ['Merge drops start at rank (Recompletion)', endless.baseMinDropRank, `Endless starts ${ENDLESS_DROP_RANK_SHIFT} rank lower.`],
    ['Value per drop, against Recompletion', ENDLESS_DROP_VALUE_MULTIPLIER, 'An average endless drop carries this many times the items (in rank-1 units) of an average Recompletion drop. This tool\'s starting number - not a confirmed game value.'],
    ['Share of a drop that is coins and merge energy', ENDLESS_COIN_ENERGY_SHARE, 'Split evenly between the two; the rest keeps the other resources\' Recompletion proportions. This tool\'s starting number - not a confirmed game value.'],
    ['Containers', containers.length, 'Listed in "Endless Small Rewards Bank"; weights in "Endless Small Reward Weights".'],
    ['Generator and lucky drops', 'unchanged', 'Endless changes merge drops only.'],
  ]
  return { columns, rows: rows.map((cells) => ({ cells })) }
}

// Tab-separated so a paste lands in real spreadsheet cells (Google Sheets,
// Excel) instead of one text blob - shared by every sheet this grows to.
export function sheetToTsv(sheet) {
  const header = sheet.columns.join('\t')
  const body = sheet.rows.map((row) => row.cells.join('\t'))
  return [header, ...body].join('\n')
}

// Board Layouts (third sheet) doesn't fit the flat { columns, rows } shape
// above - the source spreadsheet merges one "Section" cell down the full
// height of each board's own row count, so this gets its own shape and its
// own TSV serializer (boardLayoutsSheetToTsv below) instead of reusing
// sheetToTsv.
export const TILE_CODE = { blocked: 'B', semi: 'S', open: 'E' }

// One "section" per board, in play order (board 1 first, matching the
// source sheet's own numbering) - `rows` is that board's actual tile grid,
// letter-coded, so a wave board's real (capped-at-3) row count shows up as a
// shorter section, not padded to match board 1's height. Cells are padded
// with '' out to `maxCols` (the widest board in the list) so every section
// lines up under the same Col N header even when boards differ in width -
// this deliberately doesn't touch the boards' own data, purely a display
// concern for this one export.
//
// A semi tile carries its own rank as a `:N` suffix ("S:2", "S:11"), read
// off that board's semiPlacements - the economist's reference spreadsheet
// includes these, reversing an earlier decision to leave them out (they were
// confirmed out of scope for the first pass of this sheet, then asked for).
// Only semi cells get a suffix: a blocked tile's rank isn't a property of
// its position at all (the blocked queue is an ordered sequence, and which
// physical tile each entry lands on is decided at play time), so there's
// nothing position-keyed to write there. A board that hasn't been generated
// yet has no semiPlacements, so its semi cells fall back to a bare "S"
// rather than "S:undefined".
export function buildBoardLayoutsSheet(boards) {
  const maxCols = Math.max(1, ...boards.map((b) => b.cols))
  const sections = boards.map((board, i) => {
    const semiRanks = new Map((board.semiPlacements ?? []).map((p) => [`${p.row},${p.col}`, p.rank]))
    return {
      section: i + 1,
      rows: board.tiles.map((row, r) => {
        const codes = row.map((state, c) => {
          const code = TILE_CODE[state] ?? ''
          if (code !== 'S') return code
          const rank = semiRanks.get(`${r},${c}`)
          if (rank == null) return code
          // A reward item on a semi tile (V2) is written by its Small
          // Rewards key ("S:coin-r2"), never the internal encoded number -
          // same unverified-mapping caveat as the Blocked Queue's reward
          // entries (see buildV2RewardChainSheet).
          const reward = decodeReward(rank)
          // Twister DR is never starting-board content - see the Blocked
          // Queue builder's identical guard.
          if (reward?.type === TWISTER_TYPE) return code
          return `${code}:${reward ? smallRewardKey(reward.type, reward.rank) : rank}`
        })
        while (codes.length < maxCols) codes.push('')
        return codes
      }),
    }
  })
  return { maxCols, sections }
}

// Section number repeated on EVERY row of its board, not left blank after
// the first (a real spreadsheet merge - which is what the source sheet
// visually uses - reads back as an actual value on only the anchor row and
// blank/null everywhere else to anything parsing it programmatically; this
// file is read by an algorithm, not eyeballed, so every row needs its own
// literal Section value). Still one blank spacer row between boards,
// matching the source's own blank rows between sections. Returns a plain 2D
// array (header row first) - boardLayoutsSheetToTsv and the Google Sheets
// export (googleSheetsExport.js) both build on this same row data rather
// than each re-deriving it their own way.
export function boardLayoutsSheetToRows({ maxCols, sections }) {
  const header = ['Section', ...Array.from({ length: maxCols }, (_, i) => `Col ${i + 1}`)]
  const rows = [header]
  sections.forEach((section, i) => {
    section.rows.forEach((rowCells) => {
      rows.push([section.section, ...rowCells])
    })
    if (i < sections.length - 1) rows.push(Array(maxCols + 1).fill(''))
  })
  return rows
}

export function boardLayoutsSheetToTsv(sheet) {
  return boardLayoutsSheetToRows(sheet)
    .map((row) => row.join('\t'))
    .join('\n')
}

// Cell colors approximating the economist's own reference screenshots (not
// pixel-picked from the images - chosen from the standard Google Sheets
// palette to read as the same look) - ARGB with a leading FF (full opacity),
// exceljs's required format. `xlsx` (SheetJS community edition) can't
// reliably WRITE cell styles at all - that's a SheetJS Pro-only feature -
// which is why this workbook builder uses exceljs instead; `xlsx` is still
// fine for anything that only needs to read/parse spreadsheets, just not
// for producing a styled one.
const WORKBOOK_COLOR = {
  highlightFill: 'FFFFFF00', // yellow - Event Data's Base Popup ID / FeatureAssetId rows
  rankColumnFill: 'FF93C47D', // green - Generator Weights' whole Rank column
  navyHeaderFill: 'FF1F4E78', // dark navy - Generator Weights / Small Reward Weights headers
  navyHeaderFont: 'FFFFFFFF', // white text on the navy header
  queueHeaderFill: 'FFCCCCCC', // gray - Blocked Queue's header row
  entryNumberFill: 'FFFFFF00', // yellow - Blocked Queue's Entry Number column
  poolNumberFill: 'FF57BB8A', // green - Blocked Queue's Pool Number column
  layoutHeaderFill: 'FFF2F2F2', // near-white - Board Layouts' header row
  layoutHeaderFont: 'FF44546A', // slate blue text on that header
  blocked: 'FFB4A7D6', // purple/mauve - Board Layouts' "B" cells
  semi: 'FFD9EAD3', // light green - Board Layouts' "S" cells
  open: 'FFFFD966', // gold/yellow - Board Layouts' "E" cells
}

// Header fill is now opt-in per sheet rather than a blanket light-gray on
// every sheet: the economist's reference spreadsheet only fills four of its
// header rows (Generator Weights and Small Reward Weights navy, Blocked
// Queue gray, both Board Layouts near-white) and leaves the rest bold-only.
function styleHeaderRow(row, { fill, fontColor } = {}) {
  row.eachCell((cell) => {
    cell.font = fontColor ? { bold: true, color: { argb: fontColor } } : { bold: true }
    if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
  })
}

function fillRow(row, argb) {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
  })
}

// Every flat { columns, rows } sheet shares this same treatment: a bold
// header row (optionally filled, see `header`), yellow fill on any row
// flagged `highlight` (only Event Data uses this), and optional whole-column
// fills over the data rows (`columnFills`, keyed by 1-based column index -
// only Blocked Queue's Entry/Pool columns use this). Generator Weights needs
// its own variant below since its Rank-column fill is paired with a header
// treatment the rest don't share.
function addFlatSheet(workbook, name, sheet, columnWidths, { header, columnFills } = {}) {
  const ws = workbook.addWorksheet(name)
  ws.addRow(sheet.columns)
  styleHeaderRow(ws.getRow(1), header)
  sheet.rows.forEach((row, i) => {
    ws.addRow(row.cells)
    const wsRow = ws.getRow(i + 2)
    if (row.highlight) fillRow(wsRow, WORKBOOK_COLOR.highlightFill)
    if (columnFills) {
      for (const [col, argb] of Object.entries(columnFills)) {
        wsRow.getCell(Number(col)).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
      }
    }
  })
  columnWidths.forEach((width, i) => {
    ws.getColumn(i + 1).width = width
  })
  return ws
}

// `rankColumn` (1-based, default 1) is which column the green "Rank" fill
// lands on - the combined, all-segments variant of this sheet
// (buildCombinedGeneratorWeightsSheet) prepends a Segment column, so Rank
// shifts to column 2 there; every other caller (buildWorkbook's own
// per-segment sheet) omits the option and gets the exact original behavior.
function addGeneratorWeightsSheet(workbook, name, sheet, { rankColumn = 1 } = {}) {
  const ws = workbook.addWorksheet(name)
  ws.addRow(sheet.columns)
  styleHeaderRow(ws.getRow(1), { fill: WORKBOOK_COLOR.navyHeaderFill, fontColor: WORKBOOK_COLOR.navyHeaderFont })
  sheet.rows.forEach((row, i) => {
    ws.addRow(row.cells)
    ws.getRow(i + 2).getCell(rankColumn).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WORKBOOK_COLOR.rankColumnFill } }
  })
  for (let c = 1; c <= sheet.columns.length; c++) ws.getColumn(c).width = c === rankColumn + 1 ? 12 : 10
  return ws
}

// Board Layouts / Recompletion Layouts: Section is repeated as a literal
// value on EVERY row of its board, deliberately NOT a real merged cell
// (exceljs's mergeCells) despite the source sheet using one visually -
// found live: this workbook is read by an automated Ops parser, not
// eyeballed, and a real merge only carries a value on its anchor cell,
// reading as blank/null on every other row to any library that iterates
// rows independently of Excel's own merge rendering. A literal value on
// every row is unambiguous regardless of what's reading it, matching
// boardLayoutsSheetToTsv's own row-generation exactly (same reasoning,
// same fix, same day). B/S/E cells still get their color fill - that's
// purely visual metadata no value-based reader ever looks at, so it's safe
// to keep even here.
function addBoardLayoutsSheet(workbook, name, { maxCols, sections }) {
  const ws = workbook.addWorksheet(name)
  ws.addRow(['Section', ...Array.from({ length: maxCols }, (_, i) => `Col ${i + 1}`)])
  styleHeaderRow(ws.getRow(1), { fill: WORKBOOK_COLOR.layoutHeaderFill, fontColor: WORKBOOK_COLOR.layoutHeaderFont })

  sections.forEach((section, i) => {
    for (const rowCells of section.rows) {
      // Style the Row object addRow itself just returned, rather than a
      // separately-tracked row-number counter fetched via ws.getRow(n) - see
      // this function's own comment above for the real bug that shape had
      // (a manual `rowNum` that silently drifted out of sync with exceljs's
      // own sequential row placement at every section boundary, coloring an
      // empty phantom row while the real content next to it landed
      // uncolored). Reading the row straight off addRow's return value makes
      // that class of drift structurally impossible - there's no second
      // number to keep in sync at all.
      const wsRow = ws.addRow([section.section, ...rowCells])
      rowCells.forEach((cell, ci) => {
        // First character only - a semi cell now reads "S:2"/"S:11", not a
        // bare "S" (see buildBoardLayoutsSheet).
        const code = String(cell)[0]
        const argb = code === 'B' ? WORKBOOK_COLOR.blocked : code === 'S' ? WORKBOOK_COLOR.semi : code === 'E' ? WORKBOOK_COLOR.open : null
        if (argb) wsRow.getCell(ci + 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
      })
    }
    // Real blank separator row between sections (an actual written row, not
    // just a skipped row-number), matching boardLayoutsSheetToTsv's own
    // row-array shape exactly.
    if (i < sections.length - 1) ws.addRow(Array(maxCols + 1).fill(''))
  })

  for (let c = 1; c <= maxCols + 1; c++) ws.getColumn(c).width = 16
  return ws
}

// One real multi-tab .xlsx workbook containing every real Ops sheet at once,
// in the economist's reference spreadsheet's own tab ORDER (Event Data,
// Multipliers, both Board Layouts, Generator Weights, Blocked Queue, Item
// Ladder, then the three Small Rewards sheets) - tab sequence is part of the
// format, the same way row order within Generator Weights is. Board
// Layouts/Recompletion Board Layouts are the same builder run against the two
// board lists. The Blocked Queue and the Item Ladder hold both lists in one
// sheet each (the "Recompletion Blocked Queue" tab of earlier versions is
// gone - economist: "they happen one after another in the same event"). It's a
// separate "download everything" action from the per-sheet "Copy as TSV"
// button (SyntaxPage.jsx), not tied to whichever sheet happens to be
// selected in the UI. Deliberately excludes "Normal" and "CC"
// (boardSyntax.js) - those are the older placeholder per-board text export,
// out of scope for this real-sheets workbook. Synchronous - the actual
// async part (workbook.xlsx.writeBuffer()) happens in the caller
// (SyntaxPage.jsx) right before triggering the browser download.
//
// This is the PER-SEGMENT ("this segment") export only. It used to also
// back the combined (all-segments) workbook via an optional
// `{workbook, namePrefix}` - that stopped being true once the combined
// workbook's own tab sequence was restructured to no longer be "this same
// eleven sheets, once per segment" (see buildAllSegmentsWorkbook's own
// comment for the new structure), so those options were removed as dead
// flexibility with no real caller left.
// `recompletionBoards2` ("Recompletion B") - a second, independent RC
// board-layout variant, by explicit economist request ("2 different board
// layouts for the RC, one will have a lot more DRs in the blocked queue...
// we in OPS will choose which will be which"). This app never picks
// between the two or auto-selects based on anything - both are exported in
// full every time, and which one actually serves a given player is an
// external Ops/targeting decision outside this app's own scope. Optional
// (defaults to an empty array) so every existing caller that only ever knew
// about one RC variant keeps working unchanged.
export function buildWorkbook(boards, recompletionBoards, recompletionBoards2 = [], twisterOptions = {}) {
  const workbook = new ExcelJS.Workbook()
  const queueFills = { 1: WORKBOOK_COLOR.entryNumberFill, 2: WORKBOOK_COLOR.poolNumberFill }
  const queueOpts = { header: { fill: WORKBOOK_COLOR.queueHeaderFill }, columnFills: queueFills }

  addFlatSheet(workbook, 'Event Data', buildEventDataSheet(boards), [36, 22, 85])
  addFlatSheet(workbook, 'Multipliers', buildMultipliersSheet(boards), [14, 14, 20])
  addBoardLayoutsSheet(workbook, 'Board Layouts', buildBoardLayoutsSheet(boards))
  addBoardLayoutsSheet(workbook, 'Recompletion Board Layouts', buildBoardLayoutsSheet(recompletionBoards))
  // One event: the normal list and Recompletion follow each other, so the
  // generator weights run to rank 14, the blocked queue and the item ladder
  // hold both lists one after the other (no separate Recompletion sheet for
  // them any more), and the small-reward weights run to merge tier 14.
  const rcList = recompletionBoards ?? []
  addGeneratorWeightsSheet(workbook, 'Generator Weights', buildGeneratorWeightsSheet(boards, rcList))
  addFlatSheet(workbook, 'Blocked Queue', buildBlockedQueueSheet(boards, rcList), [15, 13, 14, 10, 10], queueOpts)
  addFlatSheet(workbook, 'Item Ladder', buildItemLadderSheet(boards, rcList), [8, 50, 120])
  addFlatSheet(workbook, 'Small Rewards', buildSmallRewardsSheet(boards, rcList), [15, 14, 18])
  addFlatSheet(workbook, 'Small Rewards Bank', buildSmallRewardsBankSheet(boards, { recompletionBoards: rcList }), [12, 40])
  addFlatSheet(workbook, 'Small Reward Weights', buildSmallRewardWeightsSheet(boards, { recompletionBoards: rcList }), Array(12).fill(10), {
    header: { fill: WORKBOOK_COLOR.navyHeaderFill, fontColor: WORKBOOK_COLOR.navyHeaderFont },
  })
  // (There is no "RC Small Rewards Bank" / "RC Small Reward Weights" any
  // more: the game has ONE bank and one weights table for the normal event
  // and Recompletion - economist: "as for now its the same for both normal
  // and RC" - and the build makes Recompletion play exactly that table.)
  // Endless mode's containers and weights (see buildEndlessBankSheet).
  addFlatSheet(workbook, 'Endless Small Rewards Bank', buildEndlessBankSheet(boards, recompletionBoards), [12, 40])
  addFlatSheet(workbook, 'Endless Small Reward Weights', buildEndlessWeightsSheet(boards, recompletionBoards), Array(12).fill(10), {
    header: { fill: WORKBOOK_COLOR.navyHeaderFill, fontColor: WORKBOOK_COLOR.navyHeaderFont },
  })
  // V2 - appended at the end, never reordering the eleven sheets above
  // (which match the verified Ops reference) - see buildV2RewardChainSheet's
  // own comment for why these two are clearly NOT presented as verified.
  addFlatSheet(workbook, 'V2 Reward Chain', buildV2RewardChainSheet(boards, recompletionBoards, recompletionBoards2), [8, 14, 6, 16, 34, 26, 14])
  addFlatSheet(workbook, 'V2 Drop Groups', buildV2DropGroupsSheet(boards, recompletionBoards, recompletionBoards2), [8, 14, 36, 10, 12, 13, 12, 12, 15, 12])
  addFlatSheet(workbook, 'V2 Economy', buildV2EconomySheet(boards, recompletionBoards, recompletionBoards2), [8, 14, 16, 8, 13, 14, 36, 36])
  addFlatSheet(workbook, 'V2 Twister', buildV2TwisterSheet(boards, recompletionBoards, recompletionBoards2, twisterOptions), [32, 8, 46, 12, 46])
  addFlatSheet(workbook, 'V2 Endless', buildV2EndlessSheet(boards, recompletionBoards), [44, 12, 110])

  return workbook
}

// The same eleven real Ops sheets buildWorkbook() turns into a styled .xlsx,
// flattened instead to { title, rows } value grids (rows: a plain 2D array,
// header row first) - the shape googleSheetsExport.js's Sheets API v4 calls
// need, since that API populates cell VALUES directly rather than accepting
// a file to parse. Deliberately values-only, no styling (fill colors, bold
// headers, column widths) - replicating WORKBOOK_COLOR's treatment via the
// Sheets API would mean a `spreadsheets.batchUpdate` call full of
// `repeatCell`/`updateCells` requests per sheet, real effort for a purely
// cosmetic win; the exported data itself is what Ops actually needs to be
// correct, and the .xlsx download already covers the "looks like the
// reference screenshots" use case for anyone who wants that. Revisit if the
// economist actually asks for styled Sheets output specifically. This is the
// per-segment ("this segment") export only - see buildAllSegmentsWorkbook's
// own comment for the combined (all-segments) workbook's different sheet
// structure, which this function intentionally has no part in.
export function buildAllSheetsAsValueRows(boards, recompletionBoards, namePrefix = '', recompletionBoards2 = [], twisterOptions = {}) {
  const flat = (sheet) => [sheet.columns, ...sheet.rows.map((r) => r.cells)]
  const n = (title) => namePrefix + title
  return [
    { title: n('Event Data'), rows: flat(buildEventDataSheet(boards)) },
    { title: n('Multipliers'), rows: flat(buildMultipliersSheet(boards)) },
    { title: n('Board Layouts'), rows: boardLayoutsSheetToRows(buildBoardLayoutsSheet(boards)) },
    { title: n('Recompletion Board Layouts'), rows: boardLayoutsSheetToRows(buildBoardLayoutsSheet(recompletionBoards)) },
    { title: n('Generator Weights'), rows: flat(buildGeneratorWeightsSheet(boards, recompletionBoards ?? [])) },
    { title: n('Blocked Queue'), rows: flat(buildBlockedQueueSheet(boards, recompletionBoards ?? [])) },
    { title: n('Item Ladder'), rows: flat(buildItemLadderSheet(boards, recompletionBoards ?? [])) },
    { title: n('Small Rewards'), rows: flat(buildSmallRewardsSheet(boards, recompletionBoards ?? [])) },
    { title: n('Small Rewards Bank'), rows: flat(buildSmallRewardsBankSheet(boards, { recompletionBoards: recompletionBoards ?? [] })) },
    { title: n('Small Reward Weights'), rows: flat(buildSmallRewardWeightsSheet(boards, { recompletionBoards: recompletionBoards ?? [] })) },
    { title: n('Endless Small Rewards Bank'), rows: flat(buildEndlessBankSheet(boards, recompletionBoards)) },
    { title: n('Endless Small Reward Weights'), rows: flat(buildEndlessWeightsSheet(boards, recompletionBoards)) },
    // V2 - appended at the end, same "not presented as verified" caveat as
    // buildWorkbook's own addition above.
    { title: n('V2 Reward Chain'), rows: flat(buildV2RewardChainSheet(boards, recompletionBoards, recompletionBoards2)) },
    { title: n('V2 Drop Groups'), rows: flat(buildV2DropGroupsSheet(boards, recompletionBoards, recompletionBoards2)) },
    { title: n('V2 Economy'), rows: flat(buildV2EconomySheet(boards, recompletionBoards, recompletionBoards2)) },
    { title: n('V2 Twister'), rows: flat(buildV2TwisterSheet(boards, recompletionBoards, recompletionBoards2, twisterOptions)) },
    { title: n('V2 Endless'), rows: flat(buildV2EndlessSheet(boards, recompletionBoards)) },
  ]
}

// ---------------------------------------------------------------------
// Combined (all-segments) workbook - a deliberately DIFFERENT tab sequence
// from buildWorkbook's own per-segment one above, by explicit economist
// request restructuring the combined export specifically (the per-segment
// "Download workbook (this segment)" export above is untouched, same
// eleven-sheet order it's always had).
//
// Event Data, Multipliers, and Generator Weights become single COMBINED
// sheets (one row-set per segment, tagged with a leading Segment column)
// instead of one full copy per segment - these three genuinely differ per
// segment (TutorialDrAmount reads that segment's own onboarding DR budget;
// tier2UnlockRank/tier4UnlockRank are editable per segment, which feeds both
// Multipliers and Generator Weights), so a single canonical segment's row
// would silently drop every other segment's own values. Everything else
// (Board Layouts, RC Board Layouts, Blocked Queue, Item Ladder) stays
// genuinely per-segment, one sheet each, grouped together by
// segment rather than by sheet type. Small Rewards / Small Rewards Bank /
// Small Reward Weights are untouched, fixed templates with no per-segment
// variation at all (see their own builders above) - one shared tab each.
//
// Tab order: Segments (index), Event Data, Multipliers, then for each
// segment in turn - Board Layouts, Blocked Queue, RC Board Layouts, Item
// Ladder - then Generator Weights, Small Rewards, Small Rewards Bank, Small
// Reward Weights. "RC" (not "Recompletion") in the per-segment tab names, by
// explicit request. A segment's Blocked Queue and Item Ladder hold the normal
// list and Recompletion together, one after the other (there used to be an
// "RC Blocked Queue" and an "RC Item Ladder" tab per segment).

// WHAT EVERY SEGMENT SHARES IS WRITTEN ONCE. These three pages used to hold a
// full copy per segment - eight identical Event Data blocks, eight identical
// sets of generator weights (216 rows for 27) - although the lucky drops, the
// multipliers and the event's settings are the same for every segment by
// rule (economist: "in alot of pages we got many duplicants of think we dont
// need"). Now a row that is the same in every segment is written once, with
// "All" in the Segment column; only a row that really differs between
// segments is written per segment ("S1", "S2", ... in its place).
// (When the segments do not even have the same rows - different multiplier
// unlock ranks give different sets - each segment keeps its own block.)
export const ALL_SEGMENTS_LABEL = 'All'
function combineSegments(segments, build) {
  const blocks = segments.map(build)
  const sameShape = blocks.every((b) => b.length === blocks[0].length)
  if (!sameShape) return blocks.flatMap((b, i) => b.map((row) => ({ ...row, cells: [`S${i + 1}`, ...row.cells] })))
  const rows = []
  for (let k = 0; k < (blocks[0]?.length ?? 0); k++) {
    const first = JSON.stringify(blocks[0][k].cells)
    if (blocks.every((b) => JSON.stringify(b[k].cells) === first)) rows.push({ ...blocks[0][k], cells: [ALL_SEGMENTS_LABEL, ...blocks[0][k].cells] })
    else blocks.forEach((b, i) => rows.push({ ...b[k], cells: [`S${i + 1}`, ...b[k].cells] }))
  }
  return rows
}

// Combined Event Data: tagged with "All", or with a segment's short "S{n}"
// label (the same one the Segments index tab and every per-segment tab name
// use) where a value is that segment's own.
export function buildCombinedEventDataSheet(segments) {
  return { columns: ['Segment', ...EVENT_DATA_COLUMNS], rows: combineSegments(segments, (seg) => buildEventDataSheet(seg.boards).rows), proseColumns: [3] }
}

export function buildCombinedMultipliersSheet(segments) {
  return { columns: ['Segment', ...MULTIPLIERS_COLUMNS], rows: combineSegments(segments, (seg) => buildMultipliersSheet(seg.boards).rows) }
}

export function buildCombinedGeneratorWeightsSheet(segments) {
  return { columns: ['Segment', ...GENERATOR_WEIGHTS_COLUMNS], rows: combineSegments(segments, (seg) => buildGeneratorWeightsSheet(seg.boards, seg.recompletionBoards ?? []).rows) }
}

// `segments` is [{ name, boards, recompletionBoards }, ...] (see App.jsx's
// per-segment state). Excel worksheet names are capped at 31 characters;
// "S8 Blocked Queue"/"S8 RC Board Layouts" and similar comfortably fit, so
// every per-segment tab keeps the same short "S{n} " prefix the Segments
// index tab itself already uses - no segment free-text name is ever used in
// a tab name here (that stays in the index tab only, where there's no
// length limit to worry about).
export function buildAllSegmentsWorkbook(segments, twisterOptions = {}) {
  const workbook = new ExcelJS.Workbook()
  const queueFills = { 1: WORKBOOK_COLOR.entryNumberFill, 2: WORKBOOK_COLOR.poolNumberFill }
  const queueOpts = { header: { fill: WORKBOOK_COLOR.queueHeaderFill }, columnFills: queueFills }

  const index = workbook.addWorksheet('Segments')
  index.addRow(['Segment', 'Name'])
  styleHeaderRow(index.getRow(1), { fill: WORKBOOK_COLOR.layoutHeaderFill, fontColor: WORKBOOK_COLOR.layoutHeaderFont })
  segments.forEach((seg, i) => index.addRow([`S${i + 1}`, seg.name]))
  index.getColumn(1).width = 10
  index.getColumn(2).width = 30

  addFlatSheet(workbook, 'Event Data', buildCombinedEventDataSheet(segments), [10, 36, 22, 85])
  addFlatSheet(workbook, 'Multipliers', buildCombinedMultipliersSheet(segments), [10, 14, 14, 20])

  segments.forEach((seg, i) => {
    const n = (name) => `S${i + 1} ${name}`
    addBoardLayoutsSheet(workbook, n('Board Layouts'), buildBoardLayoutsSheet(seg.boards))
    // The blocked queue and the item ladder hold the normal list and
    // Recompletion one after the other (see buildWorkbook): no "RC Blocked
    // Queue" or "RC Item Ladder" tab any more.
    addFlatSheet(workbook, n('Blocked Queue'), buildBlockedQueueSheet(seg.boards, seg.recompletionBoards ?? []), [15, 13, 14, 10, 10], queueOpts)
    addBoardLayoutsSheet(workbook, n('RC Board Layouts'), buildBoardLayoutsSheet(seg.recompletionBoards))
    addFlatSheet(workbook, n('Item Ladder'), buildItemLadderSheet(seg.boards, seg.recompletionBoards ?? []), [8, 50, 120])
    // Every segment has its OWN rank values (coins, and puzzles, merge energy
    // and charms the build gives), so its Small Rewards sheet is its own.
    addFlatSheet(workbook, n('Small Rewards'), buildSmallRewardsSheet(seg.boards, seg.recompletionBoards ?? []), [15, 14, 18])
    // V2 - same per-segment tabs the "this segment" workbook carries
    // (parity), same clearly-labeled-unverified caveat. Longest name here,
    // "S8 V2 Reward Chain", is 18 chars - well under Excel's 31-char cap.
    addFlatSheet(workbook, n('V2 Reward Chain'), buildV2RewardChainSheet(seg.boards, seg.recompletionBoards, seg.recompletionBoards2), [8, 14, 6, 16, 34, 26, 14])
    addFlatSheet(workbook, n('V2 Economy'), buildV2EconomySheet(seg.boards, seg.recompletionBoards, seg.recompletionBoards2), [8, 14, 16, 8, 13, 14, 36, 36])
  })

  addGeneratorWeightsSheet(workbook, 'Generator Weights', buildCombinedGeneratorWeightsSheet(segments), { rankColumn: 2 })
  // One table of every segment's Twister cost per spin (the one Twister
  // setting that differs by segment), plus the shared widget rule and the
  // design metadata - see buildCombinedV2TwisterSheet.
  addFlatSheet(workbook, 'V2 Twister', buildCombinedV2TwisterSheet(segments, twisterOptions), [32, 10, 8, 46, 12, 46])
  // The drop table is one table for every segment, so it is one tab here
  // (it used to be repeated as "S{n} V2 Drop Groups" for each of them).
  addFlatSheet(workbook, 'V2 Drop Groups', buildV2DropGroupsSheet(segments[0]?.boards ?? [], segments[0]?.recompletionBoards ?? []), [12, 14, 36, 10, 12, 13, 12, 12, 15, 12])
  // Small Rewards/Bank/Weights stay ONE shared tab each (not per-segment),
  // matching their long-standing "no per-segment variation" treatment here -
  // now that they're economist-editable per segment (rather than a single
  // fixed template), this reads SEGMENT 1's own config as the one canonical
  // source for the combined export, the same "Board 1's own" precedent
  // Multipliers/TutorialDrAmount already use elsewhere for a single
  // event-level value.
  // (Small Rewards is per segment now - "S{n} Small Rewards", above. The bank
  // and the weights are one table for every segment and both phases.)
  const rc0 = segments[0]?.recompletionBoards ?? []
  addFlatSheet(workbook, 'Small Rewards Bank', buildSmallRewardsBankSheet(segments[0]?.boards, { recompletionBoards: rc0 }), [12, 40])
  addFlatSheet(workbook, 'Small Reward Weights', buildSmallRewardWeightsSheet(segments[0]?.boards, { recompletionBoards: rc0 }), Array(12).fill(10), {
    header: { fill: WORKBOOK_COLOR.navyHeaderFill, fontColor: WORKBOOK_COLOR.navyHeaderFont },
  })
  // Endless mode: its containers, weights and rules (shared by every segment).
  addFlatSheet(workbook, 'Endless Small Rewards Bank', buildEndlessBankSheet(segments[0]?.boards, segments[0]?.recompletionBoards), [12, 40])
  addFlatSheet(workbook, 'Endless Small Reward Weights', buildEndlessWeightsSheet(segments[0]?.boards, segments[0]?.recompletionBoards), Array(12).fill(10), {
    header: { fill: WORKBOOK_COLOR.navyHeaderFill, fontColor: WORKBOOK_COLOR.navyHeaderFont },
  })
  addFlatSheet(workbook, 'V2 Endless', buildV2EndlessSheet(segments[0]?.boards, segments[0]?.recompletionBoards), [44, 12, 110])

  return workbook
}

// Combined multi-segment variant for the Syntax page's "Create combined
// Google Sheet" action - values only (see buildAllSheetsAsValueRows's own
// comment for why), matching buildAllSegmentsWorkbook's own tab sequence
// exactly: Segments index, combined Event Data/Multipliers, each segment's
// six own sheets grouped together, combined Generator Weights, then the
// three shared Small Rewards sheets.
export function buildAllSegmentsSheetsAsValueRows(segments, twisterOptions = {}) {
  const flat = (sheet) => [sheet.columns, ...sheet.rows.map((r) => r.cells)]
  const index = {
    title: 'Segments',
    rows: [['Segment', 'Name'], ...segments.map((seg, i) => [`S${i + 1}`, seg.name])],
  }

  const perSegment = segments.flatMap((seg, i) => {
    const n = (name) => `S${i + 1} ${name}`
    return [
      { title: n('Board Layouts'), rows: boardLayoutsSheetToRows(buildBoardLayoutsSheet(seg.boards)) },
      { title: n('Blocked Queue'), rows: flat(buildBlockedQueueSheet(seg.boards, seg.recompletionBoards ?? [])) },
      { title: n('RC Board Layouts'), rows: boardLayoutsSheetToRows(buildBoardLayoutsSheet(seg.recompletionBoards)) },
      { title: n('Item Ladder'), rows: flat(buildItemLadderSheet(seg.boards, seg.recompletionBoards ?? [])) },
      { title: n('Small Rewards'), rows: flat(buildSmallRewardsSheet(seg.boards, seg.recompletionBoards ?? [])) },
      // V2 - parity with buildAllSegmentsWorkbook's own per-segment tabs.
      { title: n('V2 Reward Chain'), rows: flat(buildV2RewardChainSheet(seg.boards, seg.recompletionBoards, seg.recompletionBoards2)) },
      { title: n('V2 Economy'), rows: flat(buildV2EconomySheet(seg.boards, seg.recompletionBoards, seg.recompletionBoards2)) },
    ]
  })

  return [
    index,
    { title: 'Event Data', rows: flat(buildCombinedEventDataSheet(segments)) },
    { title: 'Multipliers', rows: flat(buildCombinedMultipliersSheet(segments)) },
    ...perSegment,
    { title: 'Generator Weights', rows: flat(buildCombinedGeneratorWeightsSheet(segments)) },
    { title: 'V2 Twister', rows: flat(buildCombinedV2TwisterSheet(segments, twisterOptions)) },
    { title: 'V2 Drop Groups', rows: flat(buildV2DropGroupsSheet(segments[0]?.boards ?? [], segments[0]?.recompletionBoards ?? [])) },
    // Same "Segment 1 is the one canonical source" scope decision as
    // buildAllSegmentsWorkbook's identical comment above.
    { title: 'Small Rewards Bank', rows: flat(buildSmallRewardsBankSheet(segments[0]?.boards, { recompletionBoards: segments[0]?.recompletionBoards ?? [] })) },
    { title: 'Small Reward Weights', rows: flat(buildSmallRewardWeightsSheet(segments[0]?.boards, { recompletionBoards: segments[0]?.recompletionBoards ?? [] })) },
    { title: 'Endless Small Rewards Bank', rows: flat(buildEndlessBankSheet(segments[0]?.boards, segments[0]?.recompletionBoards)) },
    { title: 'Endless Small Reward Weights', rows: flat(buildEndlessWeightsSheet(segments[0]?.boards, segments[0]?.recompletionBoards)) },
    { title: 'V2 Endless', rows: flat(buildV2EndlessSheet(segments[0]?.boards, segments[0]?.recompletionBoards)) },
  ]
}
