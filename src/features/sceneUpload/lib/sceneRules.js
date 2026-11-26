// THE RULES OF A SCENE UPLOAD, copied from the economist's model
// ("Disney Economy v1.5.76.xlsx", read 26 Nov 2026). Every number here is the
// model's own, with the tab and cells it comes from. Nothing is tuned by this
// app: when the model changes, this file changes with it.
//
// Only constants live here. Lists that change from week to week (layout names,
// which layouts are puzzles, sticker packs, scene names, schedule) are read
// from Google at run time and never written into the code.

// Level Cost!K2:M40, column "Default" (Assumptions!B18 "Level Cost" = Default).
// A level costs the level before plus the step of the last row at or below it.
export const COST_STEPS = [
  [0, 12], [100, 1.5], [200, 1.5], [300, 1.5], [400, 2], [500, 2], [600, 2],
  [700, 2.5], [800, 2.5], [900, 2.5], [1000, 2.5], [1100, 3], [1200, 3],
  [1300, 3.5], [1400, 3.5], [1500, 4], [1600, 4.5], [1800, 4.5], [2000, 5],
  [2200, 5.5], [2400, 6], [2600, 6.6], [2800, 7.4], [3000, 8.2], [3200, 9.1],
  [3400, 10.2], [3600, 11.5], [3800, 11.8], [4000, 12.1], [4200, 12.8],
  [4400, 13.9], [4600, 15], [4800, 16.2], [5000, 17.8], [5200, 19.5],
  [5400, 21], [5600, 23], [5800, 25.3], [6000, 25.3],
]

// Assumptions!B10 "First Level Cost".
export const FIRST_LEVEL_COST = 1000

// Level Cost!G (column "Default" of the manual overrides): the first levels'
// costs are typed, not grown. Level -> cost.
export const COST_OVERRIDES = {
  6: 1000, 7: 1000, 8: 1000, 9: 1000, 10: 1000, 11: 1000, 12: 1000, 13: 1000,
  ...Object.fromEntries([22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35].map((l) => [l, 1200])),
  ...Object.fromEntries([36, 37, 38, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59].map((l) => [l, 1500])),
  ...Object.fromEntries([60, 61, 62, 63, 72, 73, 74, 75, 76, 77, 78, 79, 80].map((l) => [l, 1800])),
}

// Rounding!A2:B7 - "up to / round to nearest", read as Excel's VLOOKUP(x, ..., TRUE).
export const ROUNDING = [
  [0, 5], [100, 50], [1000, 100], [9800, 500], [100000, 1000], [1000000, 10000],
]

// Resource Assumptions (config "Default"): from level `from`, each resource is
// worth this share of the level's cost. win = "Win Multiple".
export const RESOURCE_SHARES = [
  { from: 1, wild: 0.5, undo: 0.03, stock: 0.3, win: 1.05 },
  { from: 14, wild: 0.65, undo: 0.04, stock: 0.5, win: 1.03 },
  { from: 20, wild: 1, undo: 0.067, stock: 0.75, win: 1 },
  { from: 27, wild: 1.3, undo: 0.1, stock: 1, win: 1 },
  { from: 36, wild: 1.65, undo: 0.11, stock: 1.3, win: 1 },
  { from: 50, wild: 2, undo: 0.13, stock: 1.6, win: 1 },
  { from: 81, wild: 2, undo: 0.15, stock: 1.6, win: 1 },
  { from: 97, wild: 2.25, undo: 0.2, stock: 1.8, win: 1 },
  { from: 126, wild: 2.5, undo: 0.25, stock: 2, win: 1 },
]
export const LEFTOVER_SHARE = 0.01 // Resource Assumptions "1st Leftover"
export const MATCH_SHARE = 0.001 // Resource Assumptions "1st match"
export const STREAK_SHARE = 0.1 // Assumptions!B17 "Streak Coins Reward Multiple", MROUND to 50
export const PUZZLE_LEVEL_DECREASE = 0.1 // Assumptions!B20 "Puzzle Completion Reward Decrease"

// Area Rewards - Test!AJ:AV (group "Default" from area 4, group "Bonus").
export const AREA_REWARD = {
  regular: { coinsAllowance: 3, wild: 1, undo: 3, stock: 1, freeRound: 1, puzzlePerStar: 0.66 },
  bonus: { coinsAllowance: 3, wild: 0, undo: 0, stock: 0, freeRound: 0, puzzlePerStar: 1 },
}
// Puzzle!AM2 "Area Reward" factor (1), Puzzle - Rewards!H1 (the puzzle DR key).
export const PUZZLE_DR = 'dr-puzzle'
// Coins: the model's value, then to the nearest 5,000 and always above the
// scene before (economist, 26 Nov 2026: "שיהיה גם שונה מהסצנה שלפניו שתהיה
// היררכיה אבל עדיף ל5000 הקרוב").
export const COIN_STEP = 5000

// Config - Allowance!N2:O19: the 18 allowance groups, in the tab's order, all
// with multiplier 1.
export const ALLOWANCE_GROUPS = [
  'default', 'store_allowance', 'harvest', 'pricing_allowance', 'milestone', 'pricing',
  'album_reward', 'album_tiers', 'rv_coins_allowance', 'rv_opp_coins_allowance', 'mf_reward',
  'allowance_easy', 'allowance_mid', 'allowance_hard', 'pricing_milestone',
  'pricing_cheap_allowance', 'pricing_mid_allowance', 'pricing_exp_allowance',
]

// Config - Allowance!N28:O31 (album) and AC25:AD28 (mf reward = Pet Reward):
// how many levels ahead of a level the reward is valued, by the level.
// Album: ROUND(levels * Disney Days 42 / Domino Days 42); below level 40 the
// album opens at level 100 (P28) and the levels are counted from there.
// MF reward: half the album's levels; below level 100 counted from level 300 (AE25).
export const ALBUM_AHEAD = [[1, 560], [50, 622], [500, 660], [1000, 714]]
export const ALBUM_EARLY_LEVEL = 40
export const ALBUM_OPENING = 100
export const MF_AHEAD = [[1, 280], [50, 311], [500, 330], [1000, 357]]
export const MF_EARLY_LEVEL = 100
export const MF_OPENING = 300

// Stars per mission -> the requirement of a regular scene's mission, read off
// 25 scenes of the DCX (areas 55 to 79, 26 Nov 2026). `low`/`high` hold most
// of what was given (a quarter to three quarters), `typical` the middle.
// This app's own reading of the economist's past choices - a suggestion only.
export const STAR_BANDS = {
  1: { low: 4, typical: 6, high: 9 },
  2: { low: 8, typical: 11, high: 14 },
  3: { low: 12, typical: 15, high: 18 },
  4: { low: 18, typical: 20, high: 22 },
  5: { low: 21, typical: 24, high: 27 },
}
export const BONUS_TASK_RANGE = { low: 4, high: 11 }

export const STARS = { regular: 150, bonus: 50 }
