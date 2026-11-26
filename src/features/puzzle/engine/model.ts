// THE PUZZLE EVENT: everything the economist types, in one object. This is
// the document the platform saves (schemaVersion 1), and the only input of
// every engine. Engines never read anything else, so the same event gives the
// same numbers and the same config every time.

import { WORKBOOK_DEFAULTS as W } from './workbookDefaults'

export type EventLength = 'week' | 'two-weeks'
/** Exactly one of these (economist). Boost is out of scope. */
export type EventMode = 'standard' | 'price-cut' | 'maleficent'
export const EVENT_MODES: readonly EventMode[] = ['standard', 'price-cut', 'maleficent']

export const REGULAR_SEGMENTS = 9
export const RC_SEGMENTS = 11
/** Six fixed boards (economist): 2x3, 3x3, 3x4, 4x4, 4x5, 4x6. */
export const REGULAR_PIECES = [6, 9, 12, 16, 20, 24] as const
export const RC_PIECES = [16, 20, 24] as const
export const MAX_PIECES = 24

/** What a pack gives when the player already has it: coins, or a resource. */
export type PackAlt = { kind: 'coins' | 'wild' | 'stock' | 'undo' | 'freeRound'; amount: number }

export type RegularTierReward = {
  coins: number
  stock: number
  wild: number
  undo: number
  freeRound: number
  /** dr-puzzle given by this board; it is also reinvested into the next board's cost. */
  drAmount: number
  packKey: string
  packAlt: PackAlt
  /** Chef basket preset (with its basket counter), as in the workbook. */
  basketKey: string
  /** The basket's allowance worth (workbook column I). */
  basketValue: number
  /** "Discount (for calculation)" of the workbook - only the valuation, never the text. */
  discount: number
  /** Presets written after the resources (a reference template has preset:puzzle_tier_end_N there). */
  extraPresets: string[]
}

export type RcTier = {
  share: number
  valueFactor: number
  stock: number
  wild: number
  undo: number
  freeRound: number
  packKey: string
  packAlt: string
  milestone: boolean
  trigger: string
  drAmount: number
  basketKey: string
  basketValue: number
  /** The regular board whose coins cap this RC board's coins ("burnout cap"). */
  matchTier: number
}

export type MaleficentTier = { active: boolean; difficulty: number; removal: number }
export type Spin = { bucket: number; damage: number }
export type WheelTier = {
  wheelLayout: string
  extraBuckets: string
  extraWheelLayout: string
  wheelMultiplier: string
  bossReward: string
  /** The bucket of every spin, in order, and the damage typed for it (the Boss Bar's helper series). */
  spins: Spin[]
}
export type Bucket = { id: number; wedges: string }
export type Wedge = { id: string; name: string; value: number; visualVariant: string; stingerId: string }
export type WheelLayout = { id: string; wedges: string[] }
export type WheelMultiplier = { multiplier: number; light: string; mid: string; dark: string; text: string; locked: string; defaultLadder: boolean }

export type FirstPuzzleRule = { key: string; from: string; to: string; economySegmentNote: string }

export type PuzzleEvent = {
  setup: {
    name: string
    /** UTC start, ISO "YYYY-MM-DDTHH:MM". */
    start: string
    timezone: string
    /** When the weekend starts (UTC ISO), where "FU before weekend" is measured. */
    weekendCutoff: string
    length: EventLength
    /** The real number of days: the length's usual days, one more or one less. */
    days: number
    inflation: number
    mtxBaseline: number
    mode: EventMode
  }
  economy: {
    /** Per regular segment: mode mix (shares of multiplier modes 1,2,4,8) and Wins for Economy (daily brut wins). */
    segments: { modeMix: [number, number, number, number]; winsForEconomy: number }[]
    /** Effort share of each of the six boards (the last is 1 - the others). */
    effort: number[]
    /** Share of the whole puzzle's effort planned for each day (sums to 1). */
    progression: number[]
    /** DR the player gets a day apart from MTX (workbook "DR per day"). */
    sources: { levelWin: number; wheel: number; areaReward: number }
    modeMultipliers: { challenges: number[]; levelWin: number[]; wheel: number[] }
    challengeRate: number
    /** Allowance worth of one piece in a two-week event, per segment (a week is x weekWorthFactor). */
    pieceWorthTwoWeeks: number[]
    weekWorthFactor: number
  }
  segmentation: {
    /** Upper bound of each returning segment's 70%x3-day + 30%x14-day brut wins (segment 9 has none). */
    membershipMax: (number | null)[]
    firstPuzzle: FirstPuzzleRule[]
    /** The RC windows start from the start DATE plus this many hours (workbook: 10, i.e. 10:00 UTC). */
    rcHourOffset: number
  }
  rewards: {
    regular: RegularTierReward[][]
    /** Reward allowance target per segment and board, typed by the economist. Null = not set. */
    targets: (number | null)[][]
    drName: string
    triggers: { regular: string; rc: string }
  }
  priceCut: { tier5: number; tier6: number; rcTier3: number }
  rc: {
    /** Stored DR budget per RC segment, per event length (an input, not a formula). */
    totals: Record<EventLength, number[]>
    tiers: RcTier[]
    cap: number
    coinValue: number
    /** Whose piece worth values the RC boards: the workbook used the segment selected on its Puzzle sheet. */
    pieceValueSegment: number
  }
  maleficent: {
    tiers: MaleficentTier[]
    rcTiers: MaleficentTier[]
    cheapKept: number
    buckets: Bucket[]
    wedges: Wedge[]
    layouts: WheelLayout[]
    multipliers: WheelMultiplier[]
    regularWheel: WheelTier[]
    rcWheel: WheelTier[]
  }
  /** Saved shuffle: piece ids (1-24) in the order the config writes them. Only a button changes it. */
  order: { seed: number; regular: number[]; rc: number[][] }
  templates: { eventData: Record<string, string> }
  optimize: OptimizeSettings
  cc: CcSettings
}

export type OptimizeSettings = {
  targets: { revshareFinished: number | null; payingFinished: number | null; revshareBeforeWeekend: number | null; fuBeforeWeekend: number | null }
  /** FU: the economic-effort completion range a player is "frustrated" in, at the weekend cutoff. */
  fuRange: { from: number; to: number }
  eventId: string
}

export type CcSettings = {
  /** Normal behind, Push band, Normal ahead, Stall band - in days of pace. */
  bands: { normalBehind: number; pushBand: number; normalAhead: number; stallBand: number }
  /** Per day: Normal-width factor and four optional overrides (pp of progress; blank = automatic, 0 is valid). */
  days: { normalWidth: number; pushNormal: number | null; pushStrong: number | null; stallNormal: number | null; stallStrong: number | null }[]
  multipliers: [number, number, number, number, number]
  ladder: [number, number][]
  presets: string[]
}

export const weekDays = (length: EventLength) => W.days[length]

const tierFromWorkbook = (t: (typeof W.rewards)[number][number]): RegularTierReward => ({
  coins: t.coins,
  stock: t.stock,
  wild: t.wild,
  undo: t.undo,
  freeRound: t.freeRound,
  drAmount: t.drAmount,
  packKey: t.packKey,
  packAlt: { kind: 'coins', amount: 0.5 },
  basketKey: t.basketKey,
  basketValue: t.basketValue,
  discount: t.discount,
  extraPresets: [],
})

/** A uniform daily progression (the workbook's "Completion Rate - Real": 1 / days). */
export const uniformProgression = (days: number) => Array.from({ length: days }, () => 1 / days)

export function defaultCcDays(days: number): CcSettings['days'] {
  return Array.from({ length: days }, () => ({ normalWidth: 1, pushNormal: null, pushStrong: null, stallNormal: null, stallStrong: null }))
}

export function ccBandsFor(length: EventLength): CcSettings['bands'] {
  const b = W.cc.bands[length]
  return { normalBehind: b[0]!, pushBand: b[1]!, normalAhead: b[2]!, stallBand: b[3]! }
}

/** A shuffle that keeps every piece once; piece 1 (the cheapest of board 1) is first among board 1's. */
export function identityOrder() {
  return Array.from({ length: MAX_PIECES }, (_, i) => i + 1)
}

/**
 * A new event from the workbook's inputs. The dates are the caller's; nothing
 * here is a production value the workbook did not hold.
 */
export function createDefaultEvent({ name = 'New Puzzle event', start = '2026-12-01T10:00', length = 'two-weeks' as EventLength } = {}): PuzzleEvent {
  const days = W.days[length]
  const wheelTier = (t: (typeof W.maleficent.regularWheel)[number], spins: readonly { bucket: number; damage: number }[]): WheelTier => ({
    wheelLayout: t.wheelLayout,
    extraBuckets: t.extraBuckets,
    extraWheelLayout: t.extraWheelLayout,
    wheelMultiplier: t.wheelMultiplier,
    bossReward: t.bossReward,
    spins: spins.map((s) => ({ ...s })),
  })
  const spinsOf = (k: string) => (W.maleficent.spins as Record<string, readonly { bucket: number; damage: number }[]>)[k] ?? []
  return {
    setup: {
      name,
      start,
      timezone: 'UTC',
      weekendCutoff: '',
      length,
      days,
      inflation: W.inflation[length],
      mtxBaseline: W.mtxBaseline[length],
      mode: 'standard',
    },
    economy: {
      segments: W.segments.map((s) => ({ modeMix: [...s.modeMix] as [number, number, number, number], winsForEconomy: length === 'week' ? s.winsWeek : s.winsTwoWeeks })),
      effort: W.structure.slice(0, 5).map((s) => s.rate),
      progression: uniformProgression(days),
      sources: { ...W.sources },
      modeMultipliers: { challenges: [...W.modeMultipliers.challenges], levelWin: [...W.modeMultipliers.levelWin], wheel: [...W.modeMultipliers.wheel] },
      challengeRate: W.challengeRate,
      pieceWorthTwoWeeks: [...W.pieceWorthTwoWeeks],
      weekWorthFactor: W.weekWorthFactor,
    },
    segmentation: {
      membershipMax: W.segments.map((s) => s.membershipMax),
      firstPuzzle: [],
      rcHourOffset: 10,
    },
    rewards: {
      regular: W.rewards.map((seg) => seg.map(tierFromWorkbook)),
      targets: W.rewards.map((seg) => seg.map(() => null)),
      drName: 'dr-puzzle',
      triggers: { ...W.triggers },
    },
    priceCut: { ...W.priceCut },
    rc: {
      totals: { week: [...W.rc.totals.week], 'two-weeks': [...W.rc.totals['two-weeks']] },
      tiers: W.rc.tiers.map((t) => ({
        share: t.share,
        valueFactor: t.valueFactor,
        stock: t.stock,
        wild: t.wild,
        undo: t.undo,
        freeRound: t.freeRound,
        packKey: t.packKey,
        packAlt: t.packAlt,
        milestone: t.milestone,
        trigger: t.trigger,
        drAmount: t.drAmount,
        basketKey: t.basketKey,
        basketValue: t.basketValue,
        matchTier: t.matchTier,
      })),
      cap: W.rc.cap,
      coinValue: W.rc.coinValue,
      pieceValueSegment: 9,
    },
    maleficent: {
      tiers: W.maleficent.tiers.map((t) => ({ active: t.difficulty != null, difficulty: t.difficulty ?? 0, removal: t.removal ?? 0 })),
      rcTiers: W.maleficent.rcTiers.map((t) => ({ active: t.difficulty != null, difficulty: t.difficulty ?? 0, removal: t.removal ?? 0 })),
      cheapKept: W.maleficent.cheapKept,
      buckets: W.maleficent.buckets.map((b) => ({ ...b })),
      wedges: W.maleficent.wedges.map((w) => ({ id: w.id, name: w.name, value: w.value, visualVariant: '', stingerId: '' })),
      layouts: [],
      multipliers: [],
      regularWheel: W.maleficent.regularWheel.map((t, i) => wheelTier(t, spinsOf(String(i + 1)))),
      rcWheel: W.maleficent.rcWheel.map((t, i) => wheelTier(t, spinsOf(`RC${i + 1}`))),
    },
    order: { seed: 0, regular: identityOrder(), rc: Array.from({ length: RC_SEGMENTS }, identityOrder) },
    templates: { eventData: {} },
    optimize: {
      targets: { revshareFinished: null, payingFinished: null, revshareBeforeWeekend: null, fuBeforeWeekend: null },
      fuRange: { from: 0.6, to: 0.9 },
      eventId: '',
    },
    cc: {
      bands: ccBandsFor(length),
      days: defaultCcDays(days),
      multipliers: [...W.cc.multipliers] as [number, number, number, number, number],
      ladder: W.cc.ladder.map((r) => [r[0], r[1]] as [number, number]),
      presets: [...W.cc.presets],
    },
  }
}
