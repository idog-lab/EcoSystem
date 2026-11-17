import { useState } from 'react'
import { TIERS, makeParticles, makeRain } from '../lib/mergeCelebration'
import { mainRankArt } from '../lib/artAssets'

// The celebrations of the play screens, drawn in layers (see
// lib/mergeCelebration.js for what a tier is made of). Everything here is
// decoration: nothing takes a click, and nothing is read by the game.

const STAR = 'polygon(50% 0%, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0% 50%, 39% 39%)'

// One burst, centred on its parent's top-left corner (the parent is placed
// at the item's centre). `size` is the cell's size in px; `delay` holds the
// whole burst back (until a sliding item has arrived, say).
export function Burst({ tier = 'small', color = '#a855f7', size = 64, delay = 0, label = null, labelClass = '' }) {
  const [{ stars, paper }] = useState(() => makeParticles(tier, color))
  const { rings, ringScale, flash, duration } = TIERS[tier]
  const at = (ms) => `${delay + ms}ms`
  return (
    <div className="absolute left-0 top-0 pointer-events-none select-none" data-burst={tier} aria-hidden="true">
      {flash && (
        <span
          className="absolute rounded-full fx-flash"
          style={{ width: size * 1.5, height: size * 1.5, left: -size * 0.75, top: -size * 0.75, background: `radial-gradient(circle, rgba(255,255,255,0.95) 0%, ${color}66 45%, transparent 70%)`, animationDelay: at(0) }}
        />
      )}
      {Array.from({ length: rings }, (_, i) => (
        <span
          key={i}
          className="absolute rounded-full fx-ring"
          style={{ width: size, height: size, left: -size / 2, top: -size / 2, border: `${Math.max(2, size * 0.06)}px solid ${i === 0 ? color : '#ffffff'}`, '--ring-scale': ringScale - i * 0.6, animationDelay: at(i * 110), animationDuration: `${duration * 0.6}ms` }}
        />
      ))}
      {stars.map((p) => (
        <span
          key={p.key}
          className="absolute fx-sparkle"
          style={{ width: size * p.size, height: size * p.size, left: -(size * p.size) / 2, top: -(size * p.size) / 2, background: p.color, clipPath: STAR, '--dx': `${p.dx * size}px`, '--dy': `${p.dy * size}px`, '--rot': `${p.rot}deg`, animationDelay: at(p.delay), animationDuration: `${duration}ms`, filter: 'drop-shadow(0 0 2px rgba(255,255,255,0.9))' }}
        />
      ))}
      {paper.map((p) => (
        <span
          key={p.key}
          className="absolute rounded-[1px] fx-confetti"
          style={{ width: size * 0.09, height: size * 0.16, left: -size * 0.045, top: -size * 0.08, background: p.color, '--dx': `${p.dx * size}px`, '--up': `${p.up * size}px`, '--down': `${p.down * size}px`, '--rot': `${p.rot}deg`, animationDelay: at(p.delay), animationDuration: `${duration}ms` }}
        />
      ))}
      {label && (
        <span
          className={`absolute whitespace-nowrap rounded-full px-2.5 py-0.5 font-display font-extrabold text-white shadow-md fx-label ${labelClass}`}
          style={{ top: -size * 0.75, fontSize: Math.max(11, size * 0.22), background: labelClass ? undefined : color, animationDelay: at(60), animationDuration: `${Math.max(duration, 1100)}ms` }}
          data-burst-label
        >
          {label}
        </span>
      )}
    </div>
  )
}

// Paper falling across a box (the board), from its top edge to below it.
export function ConfettiRain({ width, height, count = 36 }) {
  const [pieces] = useState(() => makeRain(count))
  return (
    <div className="absolute pointer-events-none overflow-hidden" style={{ width, height: height + 40, left: -width / 2, top: -height / 2 }} data-fx-rain aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.key}
          className="absolute rounded-[1px] fx-rain"
          style={{ left: `${p.left}%`, top: -14, width: p.wide ? 10 : 6, height: p.wide ? 6 : 11, background: p.color, '--drift': `${p.drift}px`, '--fall': `${height + 60}px`, '--rot': `${p.rot}deg`, animationDelay: `${p.delay}ms`, animationDuration: `${p.duration}ms` }}
        />
      ))}
    </div>
  )
}

// The grand-prize moment: the item itself, large, over turning rays, with
// what was won written under it, and paper falling across the board.
// Centred on its parent's top-left corner (placed at the board's centre).
export function GrandPrize({ rank, title, subtitle = null, width, height, duration = 2600 }) {
  const art = mainRankArt(rank)
  const disc = Math.min(Math.max(width, 240), 340)
  return (
    <div className="absolute left-0 top-0 pointer-events-none select-none" data-fx-grand={rank} aria-hidden="true">
      <ConfettiRain width={width} height={Math.max(height, 220)} count={44} />
      <span
        className="absolute rounded-full fx-rays"
        style={{ width: disc, height: disc, left: -disc / 2, top: -disc / 2, background: 'repeating-conic-gradient(from 0deg, rgba(253,224,71,0.7) 0deg 10deg, rgba(253,224,71,0) 10deg 20deg)', WebkitMaskImage: 'radial-gradient(circle, #000 20%, transparent 68%)', maskImage: 'radial-gradient(circle, #000 20%, transparent 68%)', animationDuration: `${duration}ms` }}
      />
      {art && <img src={art.url} alt="" draggable={false} className="absolute max-w-none object-contain fx-grand-item drop-shadow-[0_8px_10px_rgba(60,30,0,0.35)]" style={{ width: disc * 0.5, height: disc * 0.5, left: -disc * 0.25, top: -disc * 0.34, animationDuration: `${duration}ms` }} />}
      <div className="absolute flex flex-col items-center gap-1 fx-grand-text" style={{ top: disc * 0.2, animationDuration: `${duration}ms` }}>
        <span className="whitespace-nowrap rounded-full border-2 border-amber-200 bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-1 font-display text-lg font-extrabold text-white shadow-lg">{title}</span>
        {subtitle && <span className="whitespace-nowrap rounded-full bg-white/95 px-3 py-0.5 text-xs font-semibold text-purple-700 shadow">{subtitle}</span>}
      </div>
    </div>
  )
}
