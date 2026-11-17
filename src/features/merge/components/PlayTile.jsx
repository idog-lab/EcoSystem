import { Lock, Tornado } from 'lucide-react'
import { semiOverlayArt, selectionArt } from '../lib/artAssets'
import { decodeReward, REWARD_TYPE_LABELS, TWISTER_TYPE } from '../lib/rewardChain'
import { valueOf } from '../lib/ranks'
import { tileSurface, describeItem, itemArt } from '../lib/playTileSurface'

// The shared look of one board cell, used by both play surfaces (Play Tester
// and Play Stage) so they can never drift apart. The cell's own background
// (the tile, and the leaf cover of a blocked cell) comes from
// lib/playTileSurface.js; this file draws what sits on it, in layers: the
// item's sprite, the leaf overlay of a semi-blocked item, the rank badge, and
// the selection brackets. Every item carries its rank as an HTML badge - the
// picture alone does not tell an economist which rank they are looking at -
// and an item with no artwork falls back to its number on the rank colour.

const LAYER = 'absolute pointer-events-none select-none'
const BADGE = `${LAYER} rounded-md bg-slate-900/80 text-white font-bold leading-none px-1 py-0.5 z-[3]`

// The leaves over a semi-blocked item: it is on the board and visible, but
// not free until a matching item is merged into it.
function SemiBlockedOverlay() {
  const art = semiOverlayArt()
  if (!art) return null
  // The sprite is a square canvas with the leaves in its lower half. It is
  // drawn at the tile's own size and slid down, clipped to the tile, so the
  // leaves cover roughly the bottom third and the item stays readable.
  return (
    <span aria-hidden="true" className={`${LAYER} inset-0 overflow-hidden rounded-xl z-[2]`}>
      <img src={art.url} alt="" draggable={false} className="absolute inset-0 w-full h-full" style={{ transform: 'translateY(20%)' }} />
    </span>
  )
}

// Everything drawn on the cell: the item, its semi-blocked treatment, its
// rank badge, and the selection brackets.
// `arriving` hides the item while a copy of it is on its way here; `pop`
// ('merge' | 'land' | 'reveal') plays the item's own short animation when it
// gets here (both from PlayEffects.jsx). A selected item bobs.
const POP_CLASS = { merge: 'play-pop-merge', land: 'play-pop-land', reveal: 'play-pop-reveal' }

export function TileContents({ value, stuck, showDr = false, selected = false, arriving = false, pop = null, theme = 'classic' }) {
  const hidden = arriving ? 'opacity-0' : ''
  const brackets = selected ? selectionArt(theme) : null
  const selection = brackets ? <img src={brackets.url} alt="" aria-hidden="true" draggable={false} className={`${LAYER} inset-0 w-full h-full z-[4]`} /> : null
  if (value == null) return selection
  const reward = decodeReward(value)
  const art = itemArt(value)
  return (
    <>
      {art ? (
        // The full transparent canvas, contained - never cropped or stretched -
        // and at the size the item was drawn relative to the others (art.scale).
        <img
          src={art.url}
          alt=""
          aria-hidden="true"
          draggable={false}
          className={`${LAYER} play-item inset-[1%] w-[98%] h-[98%] object-contain z-[1] drop-shadow-[0_2px_2px_rgba(60,30,0,0.22)] ${hidden} ${pop ? (POP_CLASS[pop] ?? '') : ''} ${selected && !pop ? 'play-item-selected' : ''}`}
          style={{ '--s': art.scale, transform: 'scale(var(--s))' }}
          data-art-scale={art.scale}
        />
      ) : reward ? (
        reward.type === TWISTER_TYPE ? (
          <Tornado className="w-1/2 h-1/2 text-white drop-shadow-sm" strokeWidth={2.25} />
        ) : (
          <span className="font-display text-[11px] font-bold text-amber-900 leading-none">{REWARD_TYPE_LABELS[reward.type].split(' ')[0]}</span>
        )
      ) : (
        <>
          <span className="font-display text-base font-bold drop-shadow-sm">{value}</span>
          {showDr && <span className="text-[10px] font-semibold opacity-85">{valueOf(value)} DR</span>}
        </>
      )}
      {stuck && <SemiBlockedOverlay />}
      {stuck && <Lock size={11} className={`${LAYER} top-1 left-1 z-[3] text-slate-900/80 drop-shadow-[0_0_2px_rgba(255,255,255,0.95)]`} />}
      {reward ? (
        <span className={`${BADGE} bottom-0.5 right-0.5 text-[10px] ${hidden}`}>R{reward.rank}</span>
      ) : (
        art && (
          <span className={`${BADGE} bottom-0.5 right-0.5 text-[11px] ${hidden}`}>
            {value}
            {showDr && <span className="ml-1 text-[9px] font-semibold opacity-80">{valueOf(value)} DR</span>}
          </span>
        )
      )}
      {selection}
    </>
  )
}

// One inventory chip (an item waiting to go back on the board).
export function InventoryChip({ value, showDr = false, onClick, theme = 'classic' }) {
  const surface = tileSurface({ value, locked: false, theme })
  const label = `${describeItem(value, { withDr: showDr })} — click to drop it on a free cell`
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`relative w-11 h-11 rounded-lg flex flex-col items-center justify-center text-white text-xs font-bold leading-none transition-transform hover:scale-105 ${surface.className}`}
      style={surface.style}
    >
      <TileContents value={value} stuck={false} showDr={false} />
    </button>
  )
}
