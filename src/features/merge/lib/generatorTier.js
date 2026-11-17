// Generator tier, gated dynamically on the player's CURRENT highest-held
// rank (not a ratchet) — re-evaluated after every step. See CLAUDE.md's
// multiplier-tier section for the thresholds; re-lock semantics were an
// explicitly open question, resolved as "dynamic" for this simulation.
//
// x2/x4's unlock ranks are economist-editable now (board.tier2UnlockRank/
// tier4UnlockRank, set in BoardEditor.jsx's "Generator tiers" card, shared
// across a board list the same way targetEv is - see board.js/
// useBoardListState.js). The constants below are only the DEFAULTS a freshly
// created board seeds from and the fallback buildGeneratorTiers()/
// unlockedTiers()/currentTier() use when no explicit tiers are passed - every
// real, board-aware caller (mergeSimulation.js, playSession.js,
// eventSheets.js, PlayTester.jsx, PlayStage.jsx) builds its own tiers array
// from that specific board's configured ranks via buildGeneratorTiers below,
// rather than reading a fixed global.
export const DEFAULT_TIER2_UNLOCK_RANK = 7
export const DEFAULT_TIER4_UNLOCK_RANK = 10

// Builds the real 3-tier list for one specific board's configured unlock
// ranks - x1 is always available (unlocksAt: null); x2/x4 unlock at whatever
// rank that board says. Every real caller should build its own tiers through
// this (from a board's own tier2UnlockRank/tier4UnlockRank) rather than
// reaching for GENERATOR_TIERS directly, so a customized board can never end
// up disagreeing with itself about when its own tiers unlock.
export function buildGeneratorTiers(tier2UnlockRank = DEFAULT_TIER2_UNLOCK_RANK, tier4UnlockRank = DEFAULT_TIER4_UNLOCK_RANK) {
  return [
    { cost: 1, normalRank: 1, unlocksAt: null },
    { cost: 2, normalRank: 2, unlocksAt: tier2UnlockRank },
    { cost: 4, normalRank: 3, unlocksAt: tier4UnlockRank },
  ]
}

// The default-configured tiers - unlockedTiers/currentTier fall back to this
// when no explicit `tiers` is passed, purely as a safety net (e.g. an
// isolated/synthetic test board with no real config). Every real UI/
// simulation call site passes its own board-built tiers explicitly instead.
export const GENERATOR_TIERS = buildGeneratorTiers()

// All tiers unlocked at this max-rank-held, ascending by cost.
export function unlockedTiers(maxRankHeld, tiers = GENERATOR_TIERS) {
  return tiers.filter((t) => t.unlocksAt == null || maxRankHeld >= t.unlocksAt)
}

// The automatic simulator always greedily spends at the highest unlocked
// tier - it has no notion of "choosing" a lower one.
export function currentTier(maxRankHeld, tiers = GENERATOR_TIERS) {
  const unlocked = unlockedTiers(maxRankHeld, tiers)
  return unlocked[unlocked.length - 1]
}
