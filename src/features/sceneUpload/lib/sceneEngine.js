// THE CALCULATIONS OF A SCENE UPLOAD: the model's formulas (Level Cost,
// Resource Values By Level, Levels, Area Rewards - Test, Config - Allowance),
// written as plain functions. Pure: no network, no browser. Each function
// names the model cells it stands for.
import {
  ALBUM_AHEAD, ALBUM_EARLY_LEVEL, ALBUM_OPENING, ALLOWANCE_GROUPS, AREA_REWARD, BONUS_TASK_RANGE,
  COIN_STEP, COST_OVERRIDES, COST_STEPS, FIRST_LEVEL_COST, LEFTOVER_SHARE, MATCH_SHARE, MF_AHEAD,
  MF_EARLY_LEVEL, MF_OPENING, PUZZLE_DR, PUZZLE_LEVEL_DECREASE, RESOURCE_SHARES, ROUNDING,
  STAR_BANDS, STARS, STREAK_SHARE,
} from './sceneRules.js'

/** Excel's MROUND: to the nearest multiple, a half away from zero. */
export function mround(x, m) {
  if (!m) return 0
  const q = x / m
  // No tolerance, as in Excel: a cost of 27749.99999999967 (the sum of the steps) rounds to 27,500.
  const r = Math.round(Math.abs(q)) * Math.sign(q)
  return Number((r * m).toFixed(10))
}

/** The last row of a [from, value] table at or below x (Excel VLOOKUP/XLOOKUP -1). */
export function stepAt(table, x) {
  let v = table[0][1]
  for (const [from, val] of table) {
    if (x >= from) v = val
    else break
  }
  return v
}

/** Rounding!A2:B7 applied the model's way: MROUND(x, VLOOKUP(x, Rounding, 2, TRUE)). */
export function roundModel(x) {
  return mround(x, stepAt(ROUNDING, x))
}

function sharesAt(level) {
  let s = RESOURCE_SHARES[0]
  for (const row of RESOURCE_SHARES) if (level >= row.from) s = row
  return s
}

/**
 * Level Cost: the cost of every level from 1 to `maxLevel`.
 * before[l] = before[l-1] + step(l)  (Cost Before Rounding)
 * cost[l]   = override, else the rounded before (Final Level Cost).
 * Index 0 is unused so cost[level] reads naturally.
 */
export function levelCosts(maxLevel) {
  const before = new Array(maxLevel + 1)
  const cost = new Array(maxLevel + 1)
  for (let l = 1; l <= maxLevel; l++) {
    before[l] = l === 1 ? FIRST_LEVEL_COST : stepAt(COST_STEPS, l) + before[l - 1]
    cost[l] = COST_OVERRIDES[l] > 0 ? COST_OVERRIDES[l] : roundModel(before[l])
  }
  return { before, cost }
}

/**
 * One row of Level list V2, columns Entry cost .. Streak Coin Reward
 * (Resource Values By Level + Levels). `isPuzzle`: the model's Layout Data
 * marks the layout Puzzle / Puzzle 4 / Puzzle 6 (Levels[Puzzle Layout Count]).
 */
export function levelValues(level, cost, isPuzzle) {
  const s = sharesAt(level)
  const puzzleBefore = cost * (isPuzzle ? 1 : 0) * PUZZLE_LEVEL_DECREASE
  const puzzleValue = roundModel(puzzleBefore)
  return {
    entry: cost,
    wild: roundModel(cost * s.wild),
    undo: roundModel(cost * s.undo),
    stock: roundModel(cost * s.stock),
    leftover: mround(cost * LEFTOVER_SHARE, 1),
    match: Math.ceil(Number((cost * MATCH_SHARE).toFixed(10))),
    completion: mround(s.win * cost - puzzleValue, 1),
    streak: mround(cost * STREAK_SHARE, 50),
  }
}

/** Level list V2 header, in the DCX's order. */
export const LEVEL_COLUMNS = [
  'Level', 'Layout Name', 'Entry cost', 'Wild cost', 'Undo cost', 'Extra stock cost',
  'Remaining stock reward base', 'Match reward base', 'Completion reward', 'Streak Coin Reward',
  'Attempts Pity Counter', 'Mode 1 default index', 'Mode 2 default index', 'Mode 2 threshold index',
  'Mode 3 default index', 'Mode 3 threshold index', 'Mode 4 default index', 'Mode 4 threshold index',
  'Extra Stock Index',
]
/** The columns taken from the last level of each DCX, not from the model (economist, 26 Nov 2026). */
export const COPIED_LEVEL_COLUMNS = LEVEL_COLUMNS.slice(10)

/**
 * New rows of Level list V2 for one DCX.
 * layoutOf(level) -> layout name; puzzleLayouts: Set of names the model counts as puzzles;
 * copied: the last row's values for COPIED_LEVEL_COLUMNS, in order.
 */
export function newLevelRows({ fromLevel, toLevel, costs, layoutOf, puzzleLayouts, copied }) {
  const rows = []
  for (let l = fromLevel; l <= toLevel; l++) {
    const layout = layoutOf(l) ?? ''
    const v = levelValues(l, costs.cost[l], puzzleLayouts.has(layout))
    rows.push([l, layout, v.entry, v.wild, v.undo, v.stock, v.leftover, v.match, v.completion, v.streak, ...copied])
  }
  return rows
}

// ---------------------------------------------------------------- scenes

/** Area Rewards - Test, one scene: what it gives and the reward text. */
export function sceneReward({ kind, stars, endLevel, costs, previousCoins, stickerPack, nextIsBonus }) {
  const r = AREA_REWARD[kind]
  const maxAllowance = costs.cost[endLevel]
  const modelCoins = roundModel(maxAllowance * r.coinsAllowance) // Coins Flat
  let coins = mround(modelCoins, COIN_STEP)
  if (previousCoins != null) while (coins <= previousCoins) coins += COIN_STEP
  const puzzle = mround(stars * 1 * r.puzzlePerStar, 5)
  const text = rewardText({ coins, ...r, stickerPack, puzzle, kind, nextIsBonus })
  return { coins, modelCoins, adjustment: coins - modelCoins, maxAllowance, puzzle, charm: puzzle, text }
}

function allowanceCoins(amount) {
  return `allowance(coins:${Number((amount * 0.01).toFixed(4))})`
}

/** The Resource string (Area Rewards AC), plus the two charm DRs the economist adds by hand. */
export function rewardText({ coins, wild, stock, undo, freeRound, stickerPack, puzzle, kind, nextIsBonus }) {
  const parts = []
  if (coins > 0) parts.push(`coins:${coins}`)
  if (wild > 0) parts.push(`free_wild:${wild}`)
  if (stock > 0) parts.push(`free_stock:${stock}`)
  if (undo > 0) parts.push(`free_undo:${undo}`)
  if (freeRound > 0) parts.push(`free_entry:${freeRound}`)
  if (stickerPack) {
    parts.push(`[sticker_pack:${stickerPack}]`)
    parts.push('[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]')
  }
  if (puzzle > 0) {
    parts.push(`[dynamic(${PUZZLE_DR}:${puzzle})|${allowanceCoins(puzzle)}]`)
    parts.push(`[dynamic(dr-mf-charm-uncapped:${puzzle})|${allowanceCoins(puzzle)}]`)
    parts.push(`[dynamic(dr-hidden-charm-blitz:${puzzle})|[dynamic(dr-hidden:1)]]`)
  }
  parts.push('trigger:scene_completion')
  if (kind === 'bonus') parts.push('trigger:bonus_scene_ended')
  else if (nextIsBonus) parts.push('trigger:entered_bonus_scene')
  return parts.join('+')
}

/** A row of the DCX's Area list. */
export function areaRow({ areaId, asset, reward, stars, chapter }) {
  return [areaId, asset, 'allowance:harvest(coins:1)', reward.text, 'bg_default', 1, stars, chapter]
}
export const AREA_COLUMNS = ['Area ID', 'Area Asset', 'Hourly collection bonus', 'Completion reward', 'Background List', 'Background Cycle Length', 'Task Cost', 'Chapter Index']

/** Reads the coins of a completion reward text ("coins:635000+..."). */
export function coinsOf(text) {
  const m = /(?:^|\+)coins:(\d+)/.exec(String(text ?? ''))
  return m ? Number(m[1]) : null
}
export function stickerPackOf(text) {
  const m = /\[sticker_pack:([^\]]+)\]/.exec(String(text ?? ''))
  return m ? m[1] : null
}

/** Task names of a scene from its Area ID: Area_80_Aladdin_Market -> AladdinMarket. */
export function taskPrefixOf(areaId) {
  const rest = String(areaId).replace(/^(Bonus)?Area_\d+_/, '')
  return rest.split('_').map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p)).join('')
}

// ---------------------------------------------------------------- missions

/** A small seeded random stream, so a scene always gets the same suggestion. */
function seeded(seedText) {
  let h = 2166136261
  for (const ch of String(seedText)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return () => {
    h += 0x6d2b79f5
    let t = h
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Suggested requirement per mission: inside each mission's star band, adding
 * up to the scene's stars, and not the same list as the scene before.
 * stars: array of 1-5 (regular) or null (bonus: no stars, spread 4-11).
 */
export function suggestRequirements({ stars, count, total, seed, previous = [] }) {
  const rnd = seeded(seed)
  const bands = stars
    ? stars.map((s) => STAR_BANDS[Math.min(5, Math.max(1, s || 1))])
    : new Array(count).fill(null).map(() => ({ low: BONUS_TASK_RANGE.low, typical: total / count, high: BONUS_TASK_RANGE.high }))
  // Each mission starts near the middle of its band, then the sum is brought to
  // the total one point at a time - inside the bands first, a little past them
  // only when the bands cannot hold the total.
  for (let slack = 0; slack <= 6; slack += 2) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const req = bands.map((b) => {
        const half = (b.high - b.low) / 2
        return Math.round(Math.min(b.high, Math.max(b.low, b.typical + (rnd() * 2 - 1) * half)))
      })
      let guard = 0
      let sum = req.reduce((a, b) => a + b, 0)
      while (sum !== total && guard++ < 5000) {
        const i = Math.floor(rnd() * req.length)
        const b = bands[i]
        if (sum < total && req[i] < b.high + slack) { req[i]++; sum++ }
        else if (sum > total && req[i] > Math.max(1, b.low - slack)) { req[i]--; sum-- }
      }
      if (sum !== total) continue
      if (previous.length === req.length && previous.every((v, i) => v === req[i])) continue
      return req
    }
  }
  return bands.map((b) => Math.round(b.typical))
}

// ---------------------------------------------------------------- allowances

/** Cost of a level, growing the curve past the levels the game has (so nothing is #N/A). */
function costAtGrown(costs, level) {
  if (level < costs.cost.length) return costs.cost[level]
  let before = costs.before[costs.before.length - 1]
  for (let l = costs.before.length; l <= level; l++) before += stepAt(COST_STEPS, l)
  return roundModel(before)
}

/** Config - Allowance's album_reward value for a row's level. Capped at the game's last level. */
export function albumValue(level, costs, maxLevel) {
  const ahead = Math.round(stepAt(ALBUM_AHEAD, level))
  const end = ahead + (level < ALBUM_EARLY_LEVEL ? ALBUM_OPENING + 1 : level)
  return costs.cost[Math.min(end, maxLevel)]
}

/** Config - Allowance's mf_reward value. Past the last level the curve is grown (economist: no #N/A). */
export function mfValue(level, costs) {
  const ahead = Math.round(stepAt(MF_AHEAD, level) / 1)
  const end = ahead + (level < MF_EARLY_LEVEL ? MF_OPENING + 1 : level)
  return costAtGrown(costs, end)
}

/**
 * The whole Resource allowances tab for a game that ends at `maxLevel`.
 * baseline: the DCX's current rows [name, type, level, value]; their values
 * are kept for the groups the model reads from the Store tab (they never
 * change for an existing level), every new cost gets the cost itself, and
 * album_reward and mf_reward are worked out again for every row.
 */
export function allowanceRows({ costs, maxLevel, baseline = [] }) {
  const firstLevelOf = new Map()
  const unique = []
  for (let l = 1; l <= maxLevel; l++) {
    const c = costs.cost[l]
    if (!firstLevelOf.has(c)) { firstLevelOf.set(c, l); unique.push(c) }
  }
  const kept = new Map(baseline.map((r) => [`${r[0]}|${Number(r[2])}`, Number(r[3])]))
  const rows = []
  const changed = []
  for (const group of ALLOWANCE_GROUPS) {
    for (const c of unique) {
      const first = firstLevelOf.get(c)
      const level = group === 'harvest' ? Math.max(1, first - 1) : first
      let value
      if (group === 'album_reward') value = albumValue(first, costs, maxLevel)
      else if (group === 'mf_reward') value = mfValue(first, costs)
      else value = kept.has(`${group}|${level}`) ? kept.get(`${group}|${level}`) : c
      const before = kept.get(`${group}|${level}`)
      if (before === undefined || before !== value) changed.push({ group, level, before: before ?? null, value })
      rows.push([group, 'Coins', level, value])
    }
  }
  return { rows, changed, uniqueCosts: unique.length }
}

export const ALLOWANCE_COLUMNS = ['Name', 'Type', 'Level', 'Value']

/** Tab-separated text, ready to paste into a sheet. */
export function toTsv(rows) {
  return rows.map((r) => r.map((v) => (v == null ? '' : String(v))).join('\t')).join('\n')
}

export { STARS }
