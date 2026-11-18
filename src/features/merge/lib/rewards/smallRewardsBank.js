// "Small Rewards Bank" / "Small Reward Weights" (V2 Ops export) - the real
// Ops schema for these two sheets, now economist-editable, replacing the
// fixed fake templates eventSheets.js used to ship (see CLAUDE.md's "Small
// Rewards" history: "the app has NO domain model for any of this yet...
// nothing here is derived from boards today, which is why none of these
// builders take one" - this is that follow-up).
//
// SUPERSEDED FOR ANY LIST THAT HAS MERGE DROPS: the two sheets are now built
// from the model's own drop groups ("containers" - see containers.js), so
// what Ops receives is what is played. This hand-typed bank is exported only
// while a list has no drops of its own. The paragraph below is the original
// reasoning, kept as history.
//
// DELIBERATELY SEPARATE from dropGroups.js's own drop-group model, even
// though both describe "what can drop" - dropGroups is a STRUCTURED model
// (one item per resource type, by type+rank) that drives the actual
// simulation/solver math (mergeSimulation.js's dropMode rolls,
// rewardTargeting.js's search). The real Ops "Small Rewards Bank" schema is
// a container of FREE-TEXT syntax built from Small Rewards keys (e.g.
// "coin-r1+dr-r1+puzzle-r1+charm-r1") - there is no structured way to roll
// this for the simulation engine without inventing a syntax parser this
// app has no other use for. Keeping them separate means dropGroups stays
// exactly as useful for simulation as it already is, and this new config
// is purely a faithful, editable Ops-export surface - the same
// "placeholder/export-only, no domain model" precedent CLAUDE.md already
// draws for several other sheets, just now backed by real economist data
// instead of a frozen template.
import { RC_MAX_RANK } from '../core/ranks'

export function createSmallRewardsBankContainer({ id, name = '', syntax = '' } = {}) {
  return { id, name, syntax }
}

// Real Ops reference values (economist-provided, transcribed literally).
const REFERENCE_BANK_CONTAINERS = [
  { id: 'ContA', name: 'ContA', syntax: 'coin-r1' },
  { id: 'ContB', name: 'ContB', syntax: 'coin-r1+dr-r1+puzzle-r1+charm-r1' },
  { id: 'ContC', name: 'ContC', syntax: 'coin-r2+dr-r2+puzzle-r2+charm-r2' },
  { id: 'ContD', name: 'ContD', syntax: 'dr-r2' },
  { id: 'ContE', name: 'ContE', syntax: 'coin-r1' },
  { id: 'ContF', name: 'ContF', syntax: 'dr-r3' },
  { id: 'ContG', name: 'ContG', syntax: 'coin-r1' },
  { id: 'ContH', name: 'ContH', syntax: 'dr-r1' },
  { id: 'ContI', name: 'ContI', syntax: 'puzzle-r1' },
  { id: 'ContJ', name: 'ContJ', syntax: 'charm-r1' },
]

export function createSmallRewardsBankConfig() {
  return REFERENCE_BANK_CONTAINERS.map((c) => createSmallRewardsBankContainer(c))
}

// One row of the "Small Reward Weights" sheet: per-merge-tier odds of each
// bank container, plus an explicit NoDrop. `weights` is a plain
// {containerId: weight} map (sparse - a container with no entry is weight
// 0), mirroring dropGroups.js's own table shape for familiarity, but this
// one is Ops-export-only (see this file's header comment).
export function createSmallRewardWeightsRow(tier, { weights = {}, noDropWeight = 0 } = {}) {
  return { tier, weights: { ...weights }, noDropWeight }
}

// The real reference only covers merge tiers 2-12 (a rank-1 item comes
// straight from the generator, so nothing merges into it - same "starts at
// tier 2" rule the OLD fake template already followed). Tiers 13/14 (V2's
// RC extension - ranks.js's RC_MAX_RANK) have no reference data yet, so
// they start at a plain, honest "always no-drop" rather than guessing -
// economist-editable from there like every other row.
export function createSmallRewardWeightsConfig() {
  const rows = []
  for (let tier = 2; tier <= RC_MAX_RANK; tier++) {
    if (tier <= 12) {
      // Every reference row (2-12) is identical: ContB:1, NoDrop:2, nothing
      // else - transcribed literally, not an abbreviation on my part.
      rows.push(createSmallRewardWeightsRow(tier, { weights: { ContB: 1 }, noDropWeight: 2 }))
    } else {
      rows.push(createSmallRewardWeightsRow(tier, { noDropWeight: 1 }))
    }
  }
  return rows
}
