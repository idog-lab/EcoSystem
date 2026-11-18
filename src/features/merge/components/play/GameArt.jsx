import { Tornado } from 'lucide-react'
import { mainRankArt, rewardArt, generatorArt } from '../../lib/play/artAssets'
import { REWARD_TYPE_LABELS, TWISTER_TYPE } from '../../lib/rewards/rewardChain'
import { colorForRank } from '../../lib/core/ranks'

// A small standalone piece of game art: `asset` is 'main', a reward type
// ('coins' | 'puzzles' | 'energy' | 'charms' | 'twister') or 'generator'.
// The asset pack's sprite is shown as-is (aspect ratio preserved, never
// stretched); if a sprite is missing a fallback is drawn that cannot pass
// for one: a swirl badge for Twister, the rank number on the rank colour for
// a main item. Always carries an accessible label.
export default function GameArt({ asset, rank = null, size = 28, title, className = '' }) {
  const isReward = asset in REWARD_TYPE_LABELS
  const art = asset === 'main' ? mainRankArt(rank) : asset === 'generator' ? generatorArt() : isReward ? rewardArt(asset, rank ?? 1) : null
  const label =
    title ??
    (asset === 'main'
      ? `Rank ${rank}`
      : asset === 'generator'
        ? 'Generator'
        : `${REWARD_TYPE_LABELS[asset] ?? asset}${rank ? ` rank ${rank}` : ''}`)
  const box = { width: size, height: size }

  if (art) {
    return <img src={art.url} alt={label} title={label} draggable={false} className={`inline-block shrink-0 object-contain ${className}`} style={box} />
  }
  if (asset === TWISTER_TYPE) {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={`relative inline-grid place-items-center shrink-0 rounded-md bg-gradient-to-br from-teal-500 to-cyan-600 text-white ${className}`}
        style={box}
      >
        <Tornado size={Math.round(size * 0.62)} strokeWidth={2.25} />
        {rank != null && size >= 20 && (
          <span className="absolute -bottom-0.5 -right-0.5 rounded bg-slate-900/85 px-0.5 text-[8px] font-bold leading-3">{rank}</span>
        )}
      </span>
    )
  }
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-grid place-items-center shrink-0 rounded-md text-white font-bold ${className}`}
      style={{ ...box, backgroundColor: asset === 'main' ? colorForRank(rank) : '#94a3b8', fontSize: Math.max(9, Math.round(size * 0.42)) }}
    >
      {rank ?? '?'}
    </span>
  )
}
