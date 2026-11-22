import { DEFAULT_TARGET_EV } from './luckyDrop'
import { DEFAULT_TIER2_UNLOCK_RANK, DEFAULT_TIER4_UNLOCK_RANK } from './generatorTier'
import { createRewardChainConfig, DEFAULT_LEFTOVER_POLICY } from '../rewards/rewardChain'
import { createDropGroupsConfig, DEFAULT_MIN_DROP_RANK } from '../rewards/dropGroups'
import { createSmallRewardsBankConfig, createSmallRewardWeightsConfig } from '../rewards/smallRewardsBank'
import { RC_MAX_RANK } from './ranks'
import { effectiveMinRank } from './rankWindow'

export function emptyTiles(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 'open'))
}

// Resize a tile grid to rows x cols, preserving overlapping cells (top-left
// aligned) and defaulting new cells to "open".
export function resizeTiles(tiles, rows, cols) {
  const next = emptyTiles(rows, cols)
  for (let r = 0; r < Math.min(rows, tiles.length); r++) {
    for (let c = 0; c < Math.min(cols, tiles[r].length); c++) {
      next[r][c] = tiles[r][c]
    }
  }
  return next
}

// Board-1-only fixed anchor, by explicit economist request: this one cell
// always holds a semi-blocked rank-2 item, an exception to the "every semi
// tile on board 1 is rank 1" rule (see placement.js). Forced at the tile-
// data level, not just at generation time, so the editor grid, the
// distance-to-player BFS, and gameplay's own tiles-driven `locked`
// computation can never disagree about what this cell is.
export const FORCED_SEMI_CELL = { row: 2, col: 4 }
export const FORCED_SEMI_RANK = 2

// THE TWO TUTORIAL CELLS (economist: "the 2 cells in the rightest column in
// the bottom of the column should always be empty. those are used in the
// tutorial of any board in the game itself"). On the first board of the
// normal event the two bottom cells of the rightmost column are always open:
// no tile, nothing under them. Held where layouts are edited (layoutEdits.js)
// and by every layout of the bank (boardBank.js); a first board saved before
// the rule is not rewritten - step 2 says so and offers to empty them.
export function tutorialCells(rows, cols) {
  return rows >= 2 && cols >= 1
    ? [
        { row: rows - 1, col: cols - 1 },
        { row: rows - 2, col: cols - 1 },
      ]
    : []
}
export function applyTutorialCells(tiles) {
  const next = tiles.map((row) => [...row])
  for (const { row, col } of tutorialCells(next.length, next[0]?.length ?? 0)) next[row][col] = 'open'
  return next
}
export const tutorialCellsAreOpen = (tiles) => tutorialCells(tiles?.length ?? 0, tiles?.[0]?.length ?? 0).every(({ row, col }) => tiles[row][col] === 'open')

// Board 1 never carries more than this many DR of a segment's own total
// subsidy, once a target subsidy is set - by explicit economist report:
// even with a hard per-item rank ceiling (rankWindow.js's effectiveMaxRank),
// a board with only a handful of tiles still has to pack a lot of value
// into each one to hit a big blockedValue target, keeping its average item
// rank high regardless of the ceiling. Capping board 1's own total (enforced
// in BoardEditor.jsx, alongside the last-board auto-fill effect it shares
// this file's constant with) is what actually keeps board 1's average item
// small. A FIXED DR amount, not a % of the target - by explicit follow-up
// request, since a %-based cap still scales board 1 up for a segment with a
// big subsidy target, and board 1 is meant to feel the same regardless. A
// soft ceiling - the economist can still type any LOWER value; only a value
// above the cap snaps back down, and the freed-up DR flows into the last
// board for free via the existing auto-fill effect.
export const FIRST_BOARD_SUBSIDY_CAP_DR = 150
// ...and 300 DR on a Recompletion list - by explicit economist decision ("i
// will give 2 Boards for the RC, and u can take the max DR to the first board
// to 300"): Recompletion has 6,144 DR to cover, and its first board can hold
// items up to rank 8 only, so with two boards the first has to carry more.
export const RC_FIRST_BOARD_SUBSIDY_CAP_DR = 300
export const firstBoardCapFor = (phase) => (phase === 'rc' ? RC_FIRST_BOARD_SUBSIDY_CAP_DR : FIRST_BOARD_SUBSIDY_CAP_DR)

// No-ops on a board too small to have this cell at all (fewer than 3 rows or
// 5 cols), matching this app's existing best-effort convention for a layout
// rule that doesn't fit a given board size (e.g. presets).
export function applyForcedSemiCell(tiles) {
  const { row, col } = FORCED_SEMI_CELL
  if (row >= tiles.length || col >= (tiles[0]?.length ?? 0) || tiles[row][col] === 'semi') return tiles
  const next = tiles.map((r) => [...r])
  next[row][col] = 'semi'
  return next
}

// RC-event-only second anchor, immediately to the right of FORCED_SEMI_CELL
// — by explicit economist request: FORCED_SEMI_CELL always stays fixed at
// rank 2 regardless of rcEvent, and this separate adjacent cell is what
// holds the highest-rank item instead (see placement.js's swap), rather
// than the two rules fighting over the same cell. Only ever forced to
// semi when rcEvent is on (see applyForcedHighestRankCell's own callers) —
// it's an ordinary tile the rest of the time.
export const FORCED_HIGHEST_RANK_CELL = { row: 2, col: 5 }

// Same no-op-if-too-small convention as applyForcedSemiCell.
export function applyForcedHighestRankCell(tiles) {
  const { row, col } = FORCED_HIGHEST_RANK_CELL
  if (row >= tiles.length || col >= (tiles[0]?.length ?? 0) || tiles[row][col] === 'semi') return tiles
  const next = tiles.map((r) => [...r])
  next[row][col] = 'semi'
  return next
}

export function createBoard(name, { rows = 5, cols = 8 } = {}) {
  return {
    id: crypto.randomUUID(),
    name,
    rows,
    cols,
    tiles: emptyTiles(rows, cols),
    blockedValue: 0,
    minRank: 1,
    maxRank: 12,
    // Generator lucky-drop EV multiple - see luckyDrop.js. One shared value
    // per board (still not per-tier), configurable in the "Lucky drops"
    // editor card; only takes effect once the player holds a rank-7+ item.
    targetEv: DEFAULT_TARGET_EV,
    // Rank at which the x2/x4 generator tiers unlock - economist-editable in
    // the "Generator tiers" editor card, one shared pair of values per board
    // list (same targetEv/rewardRanks precedent - see useBoardListState.js's
    // syncGeneratorTiers). x1 has no unlock rank (always available) so isn't
    // represented here. Read everywhere a tier's own unlock threshold
    // matters via generatorTier.js's buildGeneratorTiers(tier2UnlockRank,
    // tier4UnlockRank) - never hardcode DEFAULT_TIER2_UNLOCK_RANK/
    // DEFAULT_TIER4_UNLOCK_RANK as if they were the real, current value.
    tier2UnlockRank: DEFAULT_TIER2_UNLOCK_RANK,
    tier4UnlockRank: DEFAULT_TIER4_UNLOCK_RANK,
    // Generated item layout, persisted so it survives reload and so the
    // upcoming playthrough simulation has a fixed, reproducible board to run
    // against. semiPlacements are grid-fixed ({row, col, rank}); blockedQueue
    // is position-independent — which physical tile each entry lands on is
    // decided at simulation time, only the reveal order is controlled here.
    semiPlacements: [],
    blockedQueue: [],
    // Board-1-only onboarding checkpoint: "a player with this much DR should
    // reach this rank." Feeds generation (a reserved, front-loaded slice of
    // blockedValue) rather than overriding it — null means no goal is set.
    onboardingDrBudget: null,
    onboardingTargetRank: null,
    onboardingStatus: null,
    // Recompletion-only toggle ("RC event"): FORCED_SEMI_CELL keeps its
    // fixed rank 2 either way, but this additionally forces
    // FORCED_HIGHEST_RANK_CELL (the cell right next to it) to semi and
    // gives IT whichever item ends up the highest rank in the blocked-queue
    // remainder, pulled out of the queue rather than duplicated (see
    // placement.js's generatePlacement). False by default so ordinary
    // boards (and the main list, which never surfaces a toggle for this)
    // are unaffected.
    rcEvent: false,
    // Ranks (1-MAX_RANK) the economist has flagged as giving some reward on
    // first reaching them - entirely optional, empty by default. Purely a
    // marker for the play tester's ranks bar (RanksBar.jsx) to highlight;
    // doesn't feed generation/placement or affect simulation at all.
    rewardRanks: [],
    // The actual reward CONTENT for a reward rank, free-text (e.g.
    // "coins:50", "coins:1500,sticker-r2:1") - keyed by rank number as a
    // string. Deliberately separate from rewardRanks itself (which only
    // marks WHICH ranks are rewarded, for RanksBar's badge) rather than
    // folded into one richer shape, so every existing rewardRanks consumer
    // (RanksBar, the celebration trigger, boardSyntax.js) stays untouched.
    // Purely an export-facing field for the "Item Ladder" Ops sheet
    // (eventSheets.js's buildItemLadderSheet) - like rewardRanks, doesn't
    // feed generation/placement/simulation.
    rewardSyntax: {},
    // Economist-authored exact placements: "this specific cell holds this
    // specific rank as a semi-blocked tile" ({row, col, rank}), independent
    // of whatever the distance/noise-based generation algorithm would have
    // assigned there. By explicit economist request ("insert a specific rank
    // into a cell... as semi blocked"). Unlike a plain semi paint (which only
    // sets tile TYPE and leaves rank to the generator), this is respected BY
    // generation itself (placement.js's generatePlacement carves its value
    // out of blockedValue the same way FORCED_SEMI_CELL/the onboarding
    // reserve already do), so it survives "Generate items" rather than being
    // overwritten by it - a genuinely durable authorial choice, not a
    // fleeting hand-tweak. Only takes effect while that cell's tile type is
    // actually 'semi' - a stale entry left over after repainting the cell to
    // open/blocked is simply ignored (BoardEditor.jsx also prunes it eagerly
    // on repaint, so this is a defensive fallback, not the normal path).
    // FORCED_SEMI_CELL/FORCED_HIGHEST_RANK_CELL (board.js's own two
    // hardcoded special cells) can't be targeted by this - those two
    // pre-existing rules always win there; the editor disables forcing a
    // rank on them.
    forcedSemiRanks: [],
    // V2: Config/CC increase factor for this board's own subsidy - a plain
    // fraction (0.10 = "+10% subsidy"), applied against the board's own
    // base blockedValue BEFORE the energy credit deduction (see
    // rewardEconomy.js's computeEffectiveSubsidy: effective = base*(1+cc) -
    // 0.8*expectedEnergy). Per-board (not shared across a list) since CC is
    // a per-board planning lever, not an event-level constant the way
    // targetEv/rewardRanks are.
    ccPercent: 0,
    // V2: the small-reward chain ladder (coins/puzzles/energy/charms, ranks
    // 1-4 each) and the merge-drop group tables (one weighted table per
    // resulting main-chain rank 1..RC_MAX_RANK). Shared across a whole board
    // list, same "one event-level value, not a per-board dial" precedent as
    // targetEv/rewardRanks (see useBoardListState.js's syncV2RewardConfig) -
    // a reward ladder and its drop odds belong to the event, not to
    // whichever physical board happens to be active.
    rewardChainConfig: createRewardChainConfig(),
    dropGroups: [],
    dropGroupsConfig: createDropGroupsConfig(RC_MAX_RANK),
    // V2: the real Ops "Small Rewards Bank"/"Small Reward Weights" sheets -
    // see smallRewardsBank.js's own header comment for why this is a
    // separate, Ops-export-only config from dropGroups above. Shared across
    // a whole board list, same precedent as the reward-chain config.
    smallRewardsBankConfig: createSmallRewardsBankConfig(),
    smallRewardWeightsConfig: createSmallRewardWeightsConfig(),
    // V2: the minimum RESULTING main-chain rank at which merge-drop groups
    // start rolling. Default 6 (DEFAULT_MIN_DROP_RANK) - ranks below this
    // are main-chain-only, no small rewards. Configurable per board list
    // (shared, same precedent as targetEv/rewardChainConfig), surfaced in
    // the Rewards tab so the economist can see and change the gate rather
    // than hitting an unexplained hardcoded restriction.
    minDropRank: DEFAULT_MIN_DROP_RANK,
    // From the merge that makes this rank up, every drop carries at least
    // two items (null = no such rule). Shared per list, like minDropRank.
    multiDropRank: null,
    // From the merge that makes this rank up, every drop carries at least
    // three items (null = the default, dropGroups.js). Shared per list.
    tripleDropRank: null,
    // Merges that make this rank or a lower one drop a single item (null =
    // the default, rank 6), and which reward sits under the tiles (null = the
    // default, coins) - dropGroups.js. Shared per list.
    soloDropRank: null,
    // False: the build never changes a reward's rank values (null/true: it
    // may, when the drop rules cannot reach an amount). Shared per list.
    rankValuesByBuild: null,
    tileRewardType: null,
    // True when the BUILD puts the Twister item into the containers and
    // sizes it for the twists asked (Build event, step 3: "Add a Twister").
    // False when the Twister drops are a rule written by hand in the Twister
    // tool. Shared per list.
    twisterByBuild: null,
    // False: the build keeps the Twister items small (rank 1-2) even when a
    // segment then collects its Twister DR in one or two jumps. Null/true: it
    // may make them bigger (rank 3 at most) so every segment's typical player
    // finishes a few Twister items. Shared per list.
    twisterSteady: null,
    // "Every merge of a rank drops the same items" (step 3): null/true = the
    // build makes steady containers (rewardTargeting.js), false = the varied
    // ones of before. One shared value per list.
    steadyDrops: null,
    // V2: reward items this board's blocked queue carries alongside its
    // main-chain subsidy items - a durable, per-board authored/solver-written
    // config ({type, rank} entries, rewardChain.js's four resource types),
    // NOT the generated queue itself. Like forcedSemiRanks, this survives
    // "Generate items": placement.js's generatePlacement reserves one
    // blocked-tile queue slot per entry (one item per tile) and interleaves
    // the encoded reward values into the generated queue, while the
    // main-chain items still sum to blockedValue exactly (reward items
    // contribute zero main-chain DR - two separate accounting systems).
    rewardQueueItems: [],
    // V2: reward items on this board's SEMI-blocked tiles - {row, col, type,
    // rank} - visible and usable from the moment the board is in play.
    // Per-board and per-segment (deliberately NOT part of the layout that
    // syncs from Segment 1 - which is why this isn't folded into
    // forcedSemiRanks, which does sync). See placement.js for precedence.
    rewardSemiItems: [],
    // V2: what a phase's leftover unmerged reward items pay when the phase
    // ends - 'collect' (the default: the player taps each one and is paid its
    // own rank's value - rewardChain.js: DEFAULT_LEFTOVER_POLICY) or 'forfeit'
    // (nothing). One shared value per list, read by both engines.
    rewardLeftoverPolicy: DEFAULT_LEFTOVER_POLICY,
    // Twister widget. twisterSpinCost is the DR cost of one spin for THIS
    // segment and THIS list (main / RC A / RC B each have their own) - the
    // segment-specific balancing lever, one shared value per list, never
    // synced across segments. null = not set yet (never read as zero).
    twisterSpinCost: null,
    // Optional widget rule: how many spins complete the Twister widget.
    // null = not configured - the app never invents it; play then shows
    // spin availability only. Shared across segments (it is a widget rule,
    // not a segment price).
    twisterSpinObjective: null,
    // The DR this board's main-chain contents are actually BUILT for, when
    // that differs from its budget. blockedValue is the economist's subsidy
    // budget for the board and is never changed by a build; "Build
    // configuration" (eventBuild.js) allocates the segment's subsidy after
    // CC and the 80% energy credit across the boards and records each
    // board's share here. null = no allocation: the contents are built for
    // blockedValue itself. Read through generationTargetOf, never directly.
    // Cleared by any layout/budget edit (invalidateLayout), because the
    // allocation was computed for the configuration as it was.
    effectiveBlockedValue: null,
  }
}

// The DR a board's generated main-chain contents must sum to: its built
// allocation when one exists (see effectiveBlockedValue), else its budget.
// Every generation path and every "sum vs target" check reads this, so a
// regenerate keeps a built allocation instead of silently undoing the energy
// credit.
// RECOMPLETION BOARDS HOLD NOTHING BELOW RANK 3 UNDER A BLOCKED TILE - by
// explicit economist rule ("the RC boards cant hold under the blocked tiles
// any rank that is under 3"). It is enforced on the data: a Recompletion
// board's own lowest rank is never below this, so every generator, check and
// preview that reads `board.minRank` follows it without knowing which list a
// board is in (useBoardListState applies it to every write of the
// Recompletion list; App.jsx applies it on load). A board whose lowest rank
// is raised by it loses its generated contents - they were built for the old
// limit. Semi-blocked tiles are not blocked tiles: the first RC board's
// rank-1 semi tiles and its fixed rank-2 cell are unaffected.
export const RC_MIN_RANK_UNDER_TILES = 3

// RECOMPLETION BOARDS ARE LESS STRICT - by explicit economist decision ("the
// rules in the boards in the RC are not that strict. there is no onboarding
// experience that needs to be met and the miss amount can go up to 25%").
// Every board of the Recompletion list carries `listPhase: 'rc'` (stamped by
// useBoardListState on every write of that list), and generation reads it:
// Recompletion's Board 1 has no starting goal and no opening run (the player
// arrives holding a rank 12; there is nothing to onboard), and its margins
// are 25% (smallRewardsWorkflow.js / eventBuild.js: ...ToleranceFor(phase)).
export const isRecompletionBoard = (board) => board?.listPhase === 'rc'
// THE LOWEST MAIN RANK A BOARD MAY HOLD: its own typed lowest rank, its
// position's floor (Board 2 no rank 1, Board 3 no ranks 1-2) and - on a
// Recompletion board - never under rank 3, WHATEVER THE DATA SAYS (economist,
// a hard rule: "in the RC boards ... no ranks 1 and 2. u keep on generating RC
// boards with rank1 and 2 in them"). The rule used to live on the data only:
// the Recompletion list's boards were given a lowest rank of 3 whenever the
// list was written. A list that reached a build with its lowest rank still 1
// - one that had never been written since it was made - was then generated
// from rank 1, and its boards came out with rank 1 and 2 items. Every
// generator, allocation and capacity figure reads the floor through here now,
// so no state of the data can produce such a board.
export const boardMinRank = (board, boardIndex) => Math.max(effectiveMinRank(board?.minRank ?? 1, boardIndex), isRecompletionBoard(board) ? RC_MIN_RANK_UNDER_TILES : 1)
export function withListPhase(board, phase) {
  if (!phase || board.listPhase === phase) return board
  return { ...board, listPhase: phase }
}

export function withMinRankFloor(board, floor) {
  if (!(floor > 1) || (board.minRank ?? 1) >= floor) return board
  return invalidateLayout(board, { minRank: floor, maxRank: Math.max(floor, board.maxRank ?? floor) })
}

export function generationTargetOf(board) {
  return board?.effectiveBlockedValue ?? board?.blockedValue ?? 0
}

// Plain edits (dimensions, tile paint, subsidy, rank window, onboarding
// goal) invalidate any already-generated layout - it no longer matches the
// new configuration. Shared so every editing surface (BoardEditor's own
// fields, BoardList's inline board-bubble fields, GoalSolver) resets the
// same way instead of three separate copies of this object spread.
export function invalidateLayout(board, patch) {
  return { ...board, ...patch, semiPlacements: [], blockedQueue: [], onboardingStatus: null, effectiveBlockedValue: null }
}

export function cloneBoard(board, name) {
  return {
    ...board,
    id: crypto.randomUUID(),
    name: name ?? `${board.name} copy`,
    tiles: board.tiles.map((row) => [...row]),
    semiPlacements: board.semiPlacements.map((p) => ({ ...p })),
    blockedQueue: [...board.blockedQueue],
    rewardRanks: [...board.rewardRanks],
    rewardSyntax: { ...board.rewardSyntax },
    forcedSemiRanks: (board.forcedSemiRanks ?? []).map((p) => ({ ...p })),
    rewardQueueItems: (board.rewardQueueItems ?? []).map((p) => ({ ...p })),
    rewardSemiItems: (board.rewardSemiItems ?? []).map((p) => ({ ...p })),
    rewardChainConfig: deepCloneJson(board.rewardChainConfig ?? createRewardChainConfig()),
    dropGroups: deepCloneJson(board.dropGroups ?? []),
    dropGroupsConfig: deepCloneJson(board.dropGroupsConfig ?? createDropGroupsConfig(RC_MAX_RANK)),
    smallRewardsBankConfig: deepCloneJson(board.smallRewardsBankConfig ?? createSmallRewardsBankConfig()),
    smallRewardWeightsConfig: deepCloneJson(board.smallRewardWeightsConfig ?? createSmallRewardWeightsConfig()),
  }
}

// Plain-JSON deep clone - every V2 config shape here (reward ladders, drop
// groups/tables) is plain nested objects/arrays/primitives, never a Date,
// Map, or function, so this is safe and avoids hand-writing a bespoke
// recursive clone per shape.
function deepCloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

