// The surface of one play-board cell: what its own background is. Pure
// helpers shared by PlayTile.jsx's components and by both play surfaces.
//
// A cell is drawn in LAYERS, each its own image, so nothing is baked
// together and nothing is stretched:
//   1. the tile          - this file: the cream / peach open tile, as the
//                          cell's background (a blocked cell adds the leaf
//                          cover over it, as a second background);
//   2. the item          - PlayTile.jsx: the item's sprite, contained, with a
//                          margin all round;
//   3. the leaf overlay  - PlayTile.jsx: over a semi-blocked item;
//   4. badges, selection - PlayTile.jsx: the rank badge is always HTML (the
//                          picture alone does not say which rank it is).
import { mainRankArt, rewardArt, openTileArt, blockedTileArt } from './artAssets'
import { decodeReward, REWARD_TYPE_LABELS, TWISTER_TYPE } from './rewardChain'
import { colorForRank, valueOf } from './ranks'

// Which look a play session is in. It follows the session's own phase -
// endless mode starts when the engine says so (playSession.js), never when a
// component compares a rank.
export const themeOf = (session) => (session.phase === 'endless' ? 'endless' : 'classic')

// The board's own surround, per theme.
export const BOARD_SURROUND = {
  classic: 'bg-gradient-to-br from-indigo-50 via-violet-50 to-fuchsia-50 border border-violet-100',
  endless: 'bg-gradient-to-br from-purple-300 via-fuchsia-200 to-teal-200 border-2 border-amber-300',
}

const fill = (url) => ({ backgroundImage: `url(${url})`, backgroundSize: '100% 100%', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' })

export function itemArt(value) {
  const reward = decodeReward(value)
  if (reward) return rewardArt(reward.type, reward.rank)
  return mainRankArt(value)
}

// What a cell is, in words - the same text is used as tooltip and as the
// accessible label. `value` is the raw cell value (main rank or encoded
// reward), null for an empty cell.
export function describeItem(value, { withDr = false } = {}) {
  const reward = decodeReward(value)
  if (reward) return `${REWARD_TYPE_LABELS[reward.type]} reward, rank ${reward.rank}`
  return withDr ? `rank ${value} (${valueOf(value)} DR)` : `rank ${value}`
}

// Class + inline style for the cell's surface (the <button> itself).
// `theme` is 'classic' or 'endless' (artAssets.js) - it only changes the tile.
export function tileSurface({ value, locked, row = 0, col = 0, theme = 'classic' }) {
  const tile = openTileArt((row + col) % 2 === 1, theme)
  if (locked) {
    const leaves = blockedTileArt()
    if (!leaves) return { className: 'bg-gradient-to-br from-indigo-900 to-slate-950 border border-indigo-900 shadow-inner', style: undefined }
    // The leaf cover sits over the tile and spills a little past its edge.
    return {
      className: '',
      style: tile
        ? { backgroundImage: `url(${leaves.url}), url(${tile.url})`, backgroundSize: '112% 112%, 100% 100%', backgroundPosition: 'center, center', backgroundRepeat: 'no-repeat, no-repeat' }
        : { ...fill(leaves.url), backgroundSize: '112% 112%' },
    }
  }
  if (value == null) {
    return tile ? { className: '', style: fill(tile.url) } : { className: 'bg-violet-50 border-2 border-dashed border-violet-200', style: undefined }
  }
  // An item with artwork sits on the open tile; PlayTile draws the item.
  if (itemArt(value) && tile) return { className: '', style: fill(tile.url) }
  // No artwork for this item: a plain coloured tile carrying its number, so
  // a missing picture can never pass for a real one.
  const reward = decodeReward(value)
  if (reward?.type === TWISTER_TYPE) return { className: 'border border-teal-700 bg-gradient-to-br from-teal-400 to-cyan-600', style: undefined }
  if (reward) return { className: 'border border-amber-400 bg-gradient-to-br from-amber-300 to-yellow-400', style: undefined }
  return { className: 'border border-white/50', style: { backgroundColor: colorForRank(value) } }
}
