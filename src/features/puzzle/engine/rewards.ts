// BOARD REWARDS: worth in allowance, and the reward text the config writes
// (workbook "Puzzle - Rewards" J..U and S, with its named functions
// RewardSyntax, DR_Syntax, PackSyntax and DR_Syntax_V5 for the counters).
//
// The target is typed by the economist and only compared: nothing here
// changes a reward (economist: "Do not auto-change rewards").

import { numberText, round } from './excel'
import type { PackAlt, PuzzleEvent, RegularTierReward } from './model'
import type { RegularSegment } from './regular'
import { effortShares } from './regular'

/** Allowance worth of one of each resource (economist, "Economy Rules": coin 1, wild 2.5, extra stock 2, undo 0.25, free round 1). */
export const RESOURCE_VALUE = { coins: 1, wild: 2.5, stock: 2, undo: 0.25, freeRound: 1 } as const

/** Workbook J: coins + stock x2 + wild x2.5 + undo x0.25 + free round + basket value (coins rounded to 2 decimals first). */
export function tierAllowance(t: RegularTierReward): number {
  const coins = round(t.coins, 2)
  return coins + t.stock * 2 + t.wild * 2.5 + t.undo * 0.25 + t.freeRound + t.basketValue
}

/** Workbook L: after the "discount (for calculation)". */
export const tierAllowanceForCalculation = (t: RegularTierReward) => tierAllowance(t) * (1 - t.discount)

export type TierRewardRow = {
  tier: number
  /** What the board's effort is worth: total DR without inflation x piece worth x the board's effort share (workbook Q). */
  effortWorth: number
  target: number | null
  actual: number
  /** actual - target, when a target is typed. */
  gap: number | null
  syntax: string
}

const altText = (alt: PackAlt): string => {
  if (!(alt.amount > 0)) return ''
  switch (alt.kind) {
    case 'coins':
      return `allowance(coins:${numberText(alt.amount)})`
    case 'wild':
      return `free_wild:${numberText(alt.amount)}`
    case 'stock':
      return `free_stock:${numberText(alt.amount)}`
    case 'undo':
      return `free_undo:${numberText(alt.amount)}`
    case 'freeRound':
      return `free_entry:${numberText(alt.amount)}`
  }
}

/** RewardSyntax(coins, allowance name, wild, extra stock, undo, free round). */
export function rewardSyntax(coins: number, milestone: boolean, wild: number, stock: number, undo: number, freeRound: number): string {
  return [
    coins > 0 ? (milestone ? `allowance:milestone(coins:${numberText(coins)})` : `allowance(coins:${numberText(coins)})`) : '',
    wild > 0 ? `free_wild:${numberText(wild)}` : '',
    stock > 0 ? `free_stock:${numberText(stock)}` : '',
    undo > 0 ? `free_undo:${numberText(undo)}` : '',
    freeRound > 0 ? `free_entry:${numberText(freeRound)}` : '',
  ]
    .filter(Boolean)
    .join('+')
}

export const PACK_COUNTER = '[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]'
export const BASKET_COUNTER = '[dynamic(dr-basket-counter:1)|[dynamic(dr-hidden:1)]]'

/** Workbook S: the text of a regular board's reward. */
export function regularTierSyntax(ev: PuzzleEvent, t: RegularTierReward, tier: number, lastTier = 6): string {
  const last = tier === lastTier
  const pack = t.packKey.trim()
  return [
    rewardSyntax(round(t.coins, 2), last, t.wild, t.stock, t.undo, t.freeRound),
    // Not in the workbook's formula: a reference template writes extra presets here (position relative to the DR unverified).
    ...t.extraPresets.filter((p) => p.trim()).map((p) => `preset:${p.trim()}`),
    ev.rewards.drName && t.drAmount > 0 ? `[dynamic(${ev.rewards.drName}:${numberText(t.drAmount)})]` : '',
    pack.length > 1 ? `[${[`sticker_pack:${pack}`, altText(t.packAlt)].filter(Boolean).join('|')}]` : '',
    pack.length > 1 ? PACK_COUNTER : '',
    last ? `trigger:${ev.rewards.triggers.regular}` : '',
    t.basketKey ? `preset:${t.basketKey}` : '',
    t.basketKey ? BASKET_COUNTER : '',
  ]
    .filter(Boolean)
    .join('+')
}

export function regularRewards(ev: PuzzleEvent, seg: RegularSegment): TierRewardRow[] {
  const rates = effortShares(ev)
  const rewards = ev.rewards.regular[seg.segment - 1] ?? []
  const targets = ev.rewards.targets[seg.segment - 1] ?? []
  const effortTotal = seg.totalWithoutInflationAndRewards * seg.pieceWorth
  return rewards.map((t, i) => {
    const actual = tierAllowanceForCalculation(t)
    const target = targets[i] ?? null
    return {
      tier: i + 1,
      effortWorth: effortTotal * (rates[i] ?? 0),
      target,
      actual,
      gap: target == null ? null : actual - target,
      syntax: regularTierSyntax(ev, t, i + 1, rewards.length),
    }
  })
}
