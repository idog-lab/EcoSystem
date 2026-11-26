// The saved Puzzle event, checked on the server before anything is stored
// (and by the browser before it sends). Mirrors model.ts; the mode is ONE of
// three values, so a Price Cut + Maleficent event cannot be saved at all.

import { z } from 'zod'

const num = z.number().finite()
const nonneg = num.min(0)
const share = num.min(0).max(1)
const mix = z.tuple([nonneg, nonneg, nonneg, nonneg])
const isoMinute = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'a date and time, YYYY-MM-DDTHH:MM')
const optionalIso = z.union([z.literal(''), isoMinute])

const packAlt = z.object({ kind: z.enum(['coins', 'wild', 'stock', 'undo', 'freeRound']), amount: nonneg })
const regularTier = z.object({
  coins: nonneg,
  stock: nonneg,
  wild: nonneg,
  undo: nonneg,
  freeRound: nonneg,
  drAmount: nonneg,
  packKey: z.string(),
  packAlt,
  basketKey: z.string(),
  basketValue: nonneg,
  discount: share,
  extraPresets: z.array(z.string()),
})
const rcTier = z.object({
  share,
  valueFactor: nonneg,
  stock: nonneg,
  wild: nonneg,
  undo: nonneg,
  freeRound: nonneg,
  packKey: z.string(),
  packAlt: z.string(),
  milestone: z.boolean(),
  trigger: z.string(),
  drAmount: nonneg,
  basketKey: z.string(),
  basketValue: nonneg,
  matchTier: z.number().int().min(1).max(6),
})
const maleTier = z.object({ active: z.boolean(), difficulty: nonneg, removal: nonneg })
const spin = z.object({ bucket: z.number().int(), damage: num })
const wheelTier = z.object({
  wheelLayout: z.string(),
  extraBuckets: z.string(),
  extraWheelLayout: z.string(),
  wheelMultiplier: z.string(),
  bossReward: z.string(),
  spins: z.array(spin),
})
const order = z.array(z.number().int().min(1).max(24)).length(24)
const nullableNum = num.nullable()

export const PUZZLE_SCHEMA_VERSION = 1

export const puzzleEventSchema = z.object({
  setup: z.object({
    name: z.string().trim().min(1).max(120),
    start: isoMinute,
    timezone: z.string().min(1),
    weekendCutoff: optionalIso,
    length: z.enum(['week', 'two-weeks']),
    days: z.number().int().min(6).max(15),
    inflation: num,
    mtxBaseline: num,
    mode: z.enum(['standard', 'price-cut', 'maleficent']),
  }),
  economy: z.object({
    segments: z.array(z.object({ modeMix: mix, winsForEconomy: nonneg })).length(9),
    effort: z.array(share).length(5),
    progression: z.array(share).min(6).max(15),
    sources: z.object({ levelWin: num, wheel: num, areaReward: num }),
    modeMultipliers: z.object({ challenges: z.array(num).length(4), levelWin: z.array(num).length(4), wheel: z.array(num).length(4) }),
    challengeRate: share,
    pieceWorthTwoWeeks: z.array(nonneg).length(9),
    weekWorthFactor: nonneg,
  }),
  segmentation: z.object({
    membershipMax: z.array(nonneg.nullable()).length(9),
    firstPuzzle: z.array(z.object({ key: z.string().min(1), from: optionalIso, to: optionalIso, economySegmentNote: z.string() })),
    rcHourOffset: num,
  }),
  rewards: z.object({
    regular: z.array(z.array(regularTier).length(6)).length(9),
    targets: z.array(z.array(nullableNum).length(6)).length(9),
    drName: z.string(),
    triggers: z.object({ regular: z.string(), rc: z.string() }),
  }),
  priceCut: z.object({ tier5: nonneg, tier6: nonneg, rcTier3: nonneg }),
  rc: z.object({
    totals: z.object({ week: z.array(nonneg).length(11), 'two-weeks': z.array(nonneg).length(11) }),
    tiers: z.array(rcTier).length(3),
    cap: nonneg,
    coinValue: num.positive(),
    pieceValueSegment: z.number().int().min(1).max(9),
  }),
  maleficent: z.object({
    tiers: z.array(maleTier).length(6),
    rcTiers: z.array(maleTier).length(3),
    cheapKept: z.number().int().min(0),
    buckets: z.array(z.object({ id: z.number().int(), wedges: z.string() })),
    wedges: z.array(z.object({ id: z.string(), name: z.string(), value: num, visualVariant: z.string(), stingerId: z.string() })),
    layouts: z.array(z.object({ id: z.string(), wedges: z.array(z.string()) })),
    multipliers: z.array(z.object({ multiplier: num, light: z.string(), mid: z.string(), dark: z.string(), text: z.string(), locked: z.string(), defaultLadder: z.boolean() })),
    regularWheel: z.array(wheelTier).length(6),
    rcWheel: z.array(wheelTier).length(3),
  }),
  order: z.object({ seed: num, regular: order, rc: z.array(order).length(11) }),
  templates: z.object({ eventData: z.record(z.string(), z.string()) }),
  optimize: z.object({
    targets: z.object({ revshareFinished: nullableNum, payingFinished: nullableNum, revshareBeforeWeekend: nullableNum, fuBeforeWeekend: nullableNum }),
    fuRange: z.object({ from: share, to: share }).refine((r) => r.from < r.to, 'the FU range must start below its end'),
    eventId: z.string(),
  }),
  cc: z.object({
    bands: z.object({ normalBehind: nonneg, pushBand: nonneg, normalAhead: nonneg, stallBand: nonneg }),
    days: z.array(z.object({ normalWidth: nonneg, pushNormal: nullableNum, pushStrong: nullableNum, stallNormal: nullableNum, stallStrong: nullableNum })),
    multipliers: z.tuple([nonneg, nonneg, nonneg, nonneg, nonneg]),
    ladder: z.array(z.tuple([nonneg, num.positive()])).min(1),
    presets: z.array(z.string()),
  }),
})

/** The progression quantiles a simulator reads (a shared, versioned assumption). */
export const progressQuantilesSchema = z.object({
  source: z.string().min(1),
  asOf: z.string().min(1),
  population: z.string().min(1),
  rows: z.array(z.object({ segment: z.number().int().min(1).max(9), day: z.number().int().min(1), percentile: z.number().min(0).max(100), progress: share })).min(1),
})
