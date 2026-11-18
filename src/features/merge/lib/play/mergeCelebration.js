// What a celebration is made of, per tier. Drawn by components/Celebrations.jsx.
//
// A burst is layers, all in the colour of the rank that was made (so every
// rank has its own look, and a bigger rank a bigger moment):
//   rings     expanding outlines from the item (a shockwave)
//   flash     a quick white glow under it
//   sparkles  small four-point stars flying outward
//   confetti  coloured paper that is thrown up and falls (big bursts only)
// Sizes are in units of the cell the burst is on, so a burst looks the same
// on a phone and on a desktop board. (An earlier version threw emoji.)
export const TIERS = {
  small: { rings: 1, ringScale: 1.7, sparkles: 5, spread: 0.85, confetti: 0, flash: false, duration: 650 },
  medium: { rings: 1, ringScale: 2.3, sparkles: 10, spread: 1.25, confetti: 0, flash: true, duration: 850 },
  big: { rings: 2, ringScale: 3, sparkles: 16, spread: 1.7, confetti: 14, flash: true, duration: 1250 },
}

export const CONFETTI_COLORS = ['#f472b6', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#fb7185', '#22d3ee']

export function tierForRank(rank) {
  if (rank >= 8) return 'big'
  if (rank >= 5) return 'medium'
  return 'small'
}

// One step up - a merge that makes a rank for the first time is a bigger
// moment than the same merge the tenth time.
export function nextTier(tier) {
  return tier === 'small' ? 'medium' : 'big'
}

// Lucky drops only ever bump the rank by 1 or 2 (see luckyDrop.js) - no
// "small" tier here, since a lucky drop landing is always meant to feel
// like a moment, never a throwaway one.
export function tierForBonus(bonus) {
  return bonus >= 2 ? 'big' : 'medium'
}

// The moving pieces of one burst, in cell units: sparkles fan out evenly
// (with jitter, and a slight upward bias - merge games "pop" up, not down);
// confetti is thrown up and to the side, then falls past where it started.
export function makeParticles(tier, color = '#a855f7') {
  const { sparkles, spread, confetti } = TIERS[tier]
  const palette = [color, '#ffffff', '#fde68a']
  const stars = Array.from({ length: sparkles }, (_, i) => {
    const angle = (Math.PI * 2 * i) / sparkles + (Math.random() - 0.5) * 0.7
    const distance = spread * (0.55 + Math.random() * 0.45)
    return {
      key: `s${i}`,
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance - spread * 0.2,
      rot: (Math.random() - 0.5) * 300,
      size: 0.16 + Math.random() * 0.14,
      color: palette[i % palette.length],
      delay: Math.random() * 70,
    }
  })
  const paper = Array.from({ length: confetti }, (_, i) => {
    const side = (i / Math.max(1, confetti - 1)) * 2 - 1 // -1 .. 1
    return {
      key: `c${i}`,
      dx: side * spread * (0.6 + Math.random() * 0.5),
      up: -(0.9 + Math.random() * 0.9),
      down: 0.9 + Math.random() * 0.8,
      rot: (Math.random() - 0.5) * 900,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.random() * 120,
    }
  })
  return { stars, paper }
}

// Paper falling across the whole board (the grand-prize moments).
export function makeRain(count = 36) {
  return Array.from({ length: count }, (_, i) => ({
    key: i,
    left: ((i + Math.random()) / count) * 100,
    drift: (Math.random() - 0.5) * 60,
    rot: (Math.random() - 0.5) * 1080,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    delay: Math.random() * 700,
    duration: 1300 + Math.random() * 900,
    wide: Math.random() > 0.5,
  }))
}
