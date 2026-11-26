// Everything the engines give for one event, and the checks an export needs.

import { ccDays, ccProblems } from './cc'
import { bossBar, bossDifficultyDr, bucketsText, removalFor, removedItemsText, wheelProblems } from './maleficent'
import { MAX_PIECES, REGULAR_PIECES, type PuzzleEvent } from './model'
import { computeRc, type RcSegment } from './rc'
import { computeRegular, type RegularSegment } from './regular'
import { regularRewards, type TierRewardRow } from './rewards'
import { timeWindowProblems } from './segments'
import { boardOrder, isPermutation } from './shuffle'

/** Bumped whenever a formula changes: an export says which engine made it. */
export const ENGINE_VERSION = 'puzzle-engine-1'

export type BossRow = {
  tier: number
  active: boolean
  bossBar: number | null
  difficultyDr: number
  buckets: string
  removedItems: string
  removal: ReturnType<typeof removalFor>
}

export type PuzzleResults = {
  regular: (RegularSegment & { rewards: TierRewardRow[]; boss: BossRow[] | null })[]
  rc: (RcSegment & { boss: BossRow[] | null })[]
  cc: ReturnType<typeof ccDays>
  problems: { level: 'block' | 'warn'; text: string }[]
}

export function computeAll(ev: PuzzleEvent): PuzzleResults {
  const male = ev.setup.mode === 'maleficent'
  const regular = computeRegular(ev).map((seg) => {
    const rewards = regularRewards(ev, seg)
    const boss = male
      ? seg.tiers.map((t, i): BossRow => {
          const tier = ev.maleficent.tiers[i]!
          const wheel = ev.maleficent.regularWheel[i]
          const removal = removalFor(
            seg.pieces.filter((p) => p.tier === t.tier).map((p) => p.cost),
            ev.order.regular,
            tier,
            ev.maleficent.cheapKept,
          )
          return { tier: t.tier, active: tier.active, bossBar: bossBar(tier, wheel, t.cost), difficultyDr: bossDifficultyDr(tier, t.cost), buckets: tier.active && wheel ? bucketsText(wheel.spins) : '', removedItems: removedItemsText(tier, removal), removal }
        })
      : null
    return { ...seg, rewards, boss }
  })
  const rc = computeRc(ev).map((seg) => {
    const boss = male
      ? seg.tiers.map((t, i): BossRow => {
          const tier = ev.maleficent.rcTiers[i]!
          const wheel = ev.maleficent.rcWheel[i]
          const removal = removalFor(t.costs, ev.order.rc[seg.segment - 1] ?? [], tier, ev.maleficent.cheapKept)
          return { tier: t.tier, active: tier.active, bossBar: bossBar(tier, wheel, t.total), difficultyDr: bossDifficultyDr(tier, t.total), buckets: tier.active && wheel ? bucketsText(wheel.spins) : '', removedItems: removedItemsText(tier, removal), removal }
        })
      : null
    return { ...seg, boss }
  })
  const cc = ccDays(ev.economy.progression, ev.cc)
  return { regular, rc, cc, problems: problemsOf(ev, regular) }
}

export function problemsOf(ev: PuzzleEvent, regular: RegularSegment[]): PuzzleResults['problems'] {
  const out: PuzzleResults['problems'] = []
  const block = (text: string) => out.push({ level: 'block', text })
  const warn = (text: string) => out.push({ level: 'warn', text })
  const { setup, economy } = ev
  if (!['standard', 'price-cut', 'maleficent'].includes(setup.mode)) block('The event mode must be exactly one of Standard, Price Cut or Maleficent.')
  const usual = setup.length === 'week' ? 7 : 14
  if (Math.abs(setup.days - usual) > 1) block(`A ${setup.length === 'week' ? 'one-week' : 'two-week'} event runs ${usual - 1} to ${usual + 1} days; this one has ${setup.days}.`)
  if (economy.progression.length !== setup.days) block(`The daily progression has ${economy.progression.length} days; the event has ${setup.days}.`)
  const prog = economy.progression.reduce((a, b) => a + b, 0)
  if (Math.abs(prog - 1) > 1e-6) block(`The daily progression adds up to ${(prog * 100).toFixed(2)}%, not 100%.`)
  const last = 1 - economy.effort.slice(0, 5).reduce((a, b) => a + b, 0)
  if (!(last > 0)) block('The effort of the first five boards is 100% or more: board 6 has nothing left.')
  economy.segments.forEach((s, i) => {
    if (!(s.winsForEconomy > 0)) block(`Segment ${i + 1} has no Wins for Economy.`)
  })
  if (!isPermutation(ev.order.regular)) block('The saved piece order of the regular boards is not a full shuffle of pieces 1-24.')
  ev.order.rc.forEach((o, i) => {
    if (!isPermutation(o)) block(`The saved piece order of RC segment ${i + 1} is not a full shuffle of pieces 1-24.`)
  })
  // Board 1's first written piece must be its cheapest, in every segment.
  const first = boardOrder(ev.order.regular, REGULAR_PIECES[0])[0]
  for (const seg of regular) {
    const costs = seg.pieces.filter((p) => p.tier === 1).map((p) => p.cost)
    if (first != null && costs[first - 1]! > Math.min(...costs)) block(`Segment ${seg.segment}: board 1 does not start with its cheapest piece.`)
  }
  for (const t of timeWindowProblems(ev)) block(t)
  for (const t of ccProblems(ccDays(ev.economy.progression, ev.cc))) warn(`CC: ${t}`)
  if (setup.mode === 'maleficent') for (const t of wheelProblems(ev)) warn(`Maleficent: ${t}`)
  if (!setup.weekendCutoff) warn('No weekend cutoff: "FU before weekend" cannot be placed.')
  if (ev.order.regular.length !== MAX_PIECES) block('The piece order is incomplete.')
  return out
}

/** A stable fingerprint of everything an export depends on (the event as saved). */
export function fingerprint(ev: PuzzleEvent): string {
  const s = JSON.stringify(ev)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `${ENGINE_VERSION}:${(h >>> 0).toString(16)}`
}
