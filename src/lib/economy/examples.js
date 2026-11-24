// The economist's four real rewards ("Economy Rules & Reward Syntax", 2.4).
// The checks hold the reader and the builders to them; the Economy page
// offers them to try. The first ended with the Chef basket counter,
// "+[dynamic(dr-basket-counter:1)|[dynamic(dr-hidden:1)]]"; that logic is no
// longer up to date (economist, 24 Nov 2026), so it is taken off here.
export const REAL_EXAMPLES = [
  'allowance(coins:0.8)+free_undo:1+[dynamic(dr-puzzle:5)]+[sticker_pack:Common_T4_1_1C_Low_Vague_Game|allowance(coins:0.5)]+[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]+preset:Chef__Basic_Phase_1_Undo',
  'trigger:sugar_rush_tier_gp+allowance:milestone(coins:2.9)+preset:puzzle_gameplay_250+preset:mini_game_40_gameplay_es+[sticker_pack:Royal_T1_1_1R_Vague_Royal_Quest_GP|free_entry:1]+[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]',
  'chest:yellow-chest(free_wild:1+preset:Chef__Epic_Phase_1_Extra_stock)',
  'allowance:milestone(coins:4.65)+free_wild:1+free_stock:1+[sticker_pack:Golden_T1_1_3G_mid_Rarity_Game_champ|free_entry:1]+preset:mf_90_gameplay_entry_cross',
]

// An allowance worth, shown with as many decimals as it needs (up to 6).
export function worthText(x) {
  if (x == null || !Number.isFinite(Number(x))) return 'not set'
  return Number(x).toLocaleString('en-US', { maximumFractionDigits: 6 })
}
