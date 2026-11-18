// The ONE place that maps a game concept (a tile state, a main-chain rank, a
// small-reward item, the generator) to artwork - shared by the Play Tester,
// Play Stage and anything else that draws game art.
//
// What the artwork is: the economist's own asset pack (the project's
// `art-source/merge-playtester-assets-v2/` folder - individual transparent PNGs, made with
// an image generator). The sprites the app uses are copied to
// `assets/game/`, keeping the pack's folders and file names:
//   main/main-rank-01.png ... main-rank-14.png   the fourteen main-chain items
//   rewards/<coin|puzzle|energy|charm|twister>/<name>-rank-1..4.png
//   ui/tile-cream.png, tile-peach.png            the two open-tile tones
//   ui/blocked-cover.png                         the leaves over a blocked tile
//   ui/semi-blocked-overlay.png                  the leaves over a semi-blocked item
//   ui/selection-overlay.png                     the brackets around a selected tile
//   ui/generator-button.png
// It is PROTOTYPE CONCEPT ART, not studio artwork: every asset returned here
// carries `kind: 'concept-art'`. It replaced an earlier set of crops cut from
// two reference screenshots.
//
// The pack names its reward folders by picture (coin, puzzle, charm); the
// app's own resource keys are plural (coins, puzzles, charms). REWARD_FOLDER
// is that mapping, written out rather than assumed.
//
// A missing file returns null, and callers draw a clearly different fallback
// (the rank number on its colour) - never an unrelated picture.
// PROPORTIONS. The pack's individual sprites were normalized: every item was
// scaled to fill the same box, so a single seed came out as large as a rose
// tree. `scale.json` holds how big each item was really drawn on the pack's
// original sheets, as a fraction of the largest item on its sheet (measured
// by scripts/art/measure-art-proportions.mjs - rerun it if the pack changes).
// Board tiles draw each sprite at that fraction, so a rank 1 is visibly
// smaller than a rank 14; `scale` is 1 for anything not in the table.
import scales from '../../assets/game/scale.json'

const urls = import.meta.glob('../../assets/game/**/*.png', { eager: true, import: 'default' })

const asset = (path) => {
  const url = urls[`../../assets/game/${path}`]
  return url ? { key: path, url, kind: 'concept-art', scale: scales[path] ?? 1 } : null
}

const REWARD_FOLDER = { coins: 'coin', puzzles: 'puzzle', energy: 'energy', charms: 'charm', twister: 'twister' }

export const mainRankArt = (rank) => (Number.isInteger(rank) && rank >= 1 ? asset(`main/main-rank-${String(rank).padStart(2, '0')}.png`) : null)
export const rewardArt = (type, rank) => (REWARD_FOLDER[type] ? asset(`rewards/${REWARD_FOLDER[type]}/${REWARD_FOLDER[type]}-rank-${rank}.png`) : null)
// THEME. The board has two looks: 'classic' (the pack above) and 'endless'
// (the economist's second pack, `art-source/merge-endless-mode-assets/`, shown once the
// player holds rank 14 - see lib/endlessMode.js). The endless pack changes
// the board's own furniture only - tiles, selection brackets, generator, and
// a few one-off pieces (frame, badge, nameplate, two bursts); every item
// keeps its own sprite. Its PNGs are copied trimmed to their drawn bounds
// (scripts/art/prepare-endless-assets.mjs) so a tile fills its cell. A missing
// endless piece falls back to the classic one.
const themed = (theme, endlessPath, classicPath) => (theme === 'endless' ? asset(endlessPath) : null) ?? asset(classicPath)

export const generatorArt = (theme = 'classic') => themed(theme, 'endless/endless-generator.png', 'ui/generator-button.png')
// The board is a two-tone checker; `alt` picks the second tone (peach, or
// mint in endless mode).
export const openTileArt = (alt = false, theme = 'classic') =>
  themed(theme, alt ? 'endless/endless-tile-mint.png' : 'endless/endless-tile-lavender.png', alt ? 'ui/tile-peach.png' : 'ui/tile-cream.png')
export const blockedTileArt = () => asset('ui/blocked-cover.png')
export const semiOverlayArt = () => asset('ui/semi-blocked-overlay.png')
export const selectionArt = (theme = 'classic') => themed(theme, 'endless/endless-selection-overlay.png', 'ui/selection-overlay.png')
// The endless pack's one-off pieces: 'board-frame', 'infinity-badge',
// 'nameplate-blank', 'transition-burst', 'reward-burst'.
export const endlessArt = (name) => asset(`endless/endless-${name}.png`)
