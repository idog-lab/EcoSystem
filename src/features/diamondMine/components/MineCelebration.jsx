import { useState } from 'react'
import { GEM_FOUND, BOARD_CLEARED, makeGemFoundParticles, makeBoardClearedParticles } from '../lib/mineCelebration'

function Particles({ particles, duration }) {
  return particles.map((p) => (
    <span
      key={p.key}
      className="absolute left-1/2 top-1/2 select-none"
      style={{
        fontSize: 'inherit',
        '--dx': `${p.dx}px`,
        '--dy': `${p.dy}px`,
        '--rot': `${p.rot}deg`,
        animation: `merge-particle ${duration}ms ease-out ${p.delay}ms forwards`,
      }}
    >
      {p.emoji}
    </span>
  ))
}

// Anchored inside a `relative` grid cell, mirrors MergeCelebration.jsx
// exactly - fired simultaneously on every cell of a just-found gem's
// footprint, so a bigger gem reads as a bigger moment for free (more cells
// sparkling at once) without scaling up any single burst.
export function GemFoundBurst() {
  const [particles] = useState(() => makeGemFoundParticles())
  return (
    <div className={`absolute inset-0 pointer-events-none z-20 ${GEM_FOUND.sizeClass}`}>
      <Particles particles={particles} duration={GEM_FOUND.duration} />
    </div>
  )
}

// Full-grid overlay - one bigger one-shot burst plus a banner, shown once
// every gem on the board is found. `onSkip` lets an economist batch-testing
// many boards jump straight to the next one instead of waiting out the
// auto-advance timer.
export function BoardClearedBanner({ onSkip }) {
  const [particles] = useState(() => makeBoardClearedParticles())
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center rounded-3xl bg-slate-900/70 backdrop-blur-sm">
      <div className={`absolute inset-0 pointer-events-none ${BOARD_CLEARED.sizeClass}`}>
        <Particles particles={particles} duration={BOARD_CLEARED.duration} />
      </div>
      <div className="relative flex flex-col items-center gap-2 text-center px-6">
        <span className="font-display text-2xl font-bold text-white drop-shadow-md">Board cleared!</span>
        <span className="text-sm text-white/70">Moving to the next board…</span>
        <button type="button" onClick={onSkip} className="mt-1 text-xs font-semibold text-white/80 hover:text-white underline">
          Skip ▶
        </button>
      </div>
    </div>
  )
}
