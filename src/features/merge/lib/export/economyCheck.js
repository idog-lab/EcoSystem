// MERGE MANIA'S REWARD TEXT, CHECKED BY THE ECONOMY'S RULES (src/lib/economy):
// what the Small Rewards sheet writes for each rank, read the way the game
// server reads it. Only a reading on the Syntax tab: nothing is changed by it
// (the small rewards keep their own rules - economist: "all the rules we got
// from befor for small reweards and twister are untouched"), and coins are
// allowed 3 decimals here (economist: "Keep 3 decimals when small").
import { checkReward } from '../../../../lib/economy/parse'
import { ALL_REWARD_TYPES, REWARD_MAX_RANK, TWISTER_TYPE, syntaxForValue, twisterSyntaxFor } from '../rewards/rewardChain'

// The text written for a rank, as the export writes it.
export function writtenRewardText(type, entry) {
  const { syntax } = syntaxForValue(type, entry)
  if (type === TWISTER_TYPE && String(syntax ?? '').trim() === '') return twisterSyntaxFor({ ...entry, syntax: '' })
  return String(syntax ?? '')
}

// [{ type, rank, text, issues }] - only the ranks with something to say.
export function economyTextFindings(rewardChainConfig, economy, types = ALL_REWARD_TYPES) {
  const out = []
  for (const type of types) {
    ;(rewardChainConfig?.[type] ?? []).slice(0, REWARD_MAX_RANK).forEach((entry, i) => {
      if (!((entry?.prizeAmount ?? 0) > 0)) return
      const text = writtenRewardText(type, entry)
      if (!text.trim()) return
      const { issues } = checkReward(text, { economy, coinDecimals: 3 })
      if (issues.length) out.push({ type, rank: i + 1, text, issues })
    })
  }
  return out
}
