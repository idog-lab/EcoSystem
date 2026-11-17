// Mirrors mergeCelebration.js's particle-fly-out math, but with two fixed
// configs instead of size-tiers:
//
// - Gem found: fired once per revealed cell of the completed gem,
//   SIMULTANEOUSLY across its whole footprint - deliberately small and
//   fixed-size per cell rather than scaled up with gem size, since scaling
//   a "big" burst per cell would multiply out of control on a large gem
//   (a 4x4 firing 16 big bursts at once). A bigger gem still reads as a
//   bigger moment for free, since more cells are sparkling at once.
// - Board cleared: one single bigger one-shot burst - the grand finale,
//   not a per-cell effect.
//
// Reuses index.css's existing @keyframes merge-particle as-is (generic
// fly-out-and-fade math, nothing Merge-specific baked into the CSS despite
// the name) and this codebase's already-shipped emoji-particle convention
// (mergeCelebration.js's EMOJI_POOL) - adding a gem to the pool stays
// consistent with an existing visual language rather than inventing one.

export const GEM_FOUND_EMOJI_POOL = ['💎', '✨', '⭐']
export const BOARD_CLEARED_EMOJI_POOL = ['💎', '✨', '🎉', '⭐', '💫']

export const GEM_FOUND = { count: 5, spread: 45, duration: 650, sizeClass: 'text-lg' }
export const BOARD_CLEARED = { count: 26, spread: 160, duration: 1400, sizeClass: 'text-4xl' }

function buildParticles({ count, spread }, emojiPool) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.8
    const distance = spread * (0.55 + Math.random() * 0.45)
    const dx = Math.cos(angle) * distance
    const dy = Math.sin(angle) * distance - spread * 0.25
    const rot = (Math.random() - 0.5) * 360
    const emoji = emojiPool[Math.floor(Math.random() * emojiPool.length)]
    const delay = Math.random() * 60
    return { key: i, dx, dy, rot, emoji, delay }
  })
}

export function makeGemFoundParticles() {
  return buildParticles(GEM_FOUND, GEM_FOUND_EMOJI_POOL)
}

export function makeBoardClearedParticles() {
  return buildParticles(BOARD_CLEARED, BOARD_CLEARED_EMOJI_POOL)
}
