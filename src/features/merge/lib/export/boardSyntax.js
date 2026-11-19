// Draft export syntax for handing board configs off to Ops at "the finish
// line" - THIS FORMAT IS NOT FINAL, it's a stand-in until the real Ops
// syntax spec exists. Nothing else in the app reads this format or depends
// on its shape, so once the real spec is known, replace boardToSyntax (and
// boardsToSyntax, if the real spec bundles boards differently) wholesale -
// this file is the only place that needs to change.

import { DEFAULT_TARGET_EV } from '../core/luckyDrop'
import { suggestQueues, suggestEv } from '../simulation/ccManagement'
import { decodeReward, smallRewardKey } from '../rewards/rewardChain'

// An item as it is written: a main-chain rank as R{n}, a small reward by its
// Small Rewards key (coin-r1). (It used to print the internal number, R1001.)
const itemText = (value) => {
  const reward = decodeReward(value)
  return reward ? smallRewardKey(reward.type, reward.rank) : `R${value}`
}
const rewardsText = (board) => (board.rewardRanks?.length ? board.rewardRanks.map((r) => `R${r}`).join(',') : '(none)')
const evOf = (board) => board.targetEv ?? DEFAULT_TARGET_EV

const TILE_CHAR = { open: '.', semi: 'o', blocked: '#' }

function layoutLines(tiles) {
  return tiles.map((row) => row.map((s) => TILE_CHAR[s] ?? '?').join(''))
}

// `index` is this board's position in the board list, which doubles as the
// wave queue (see CLAUDE.md's "Board chaining" section) - index 0 is played
// directly from the start, every board after it pushes in as a wave once
// the previous one's blocked/semi tiles fully clear.
// `shared`: the lucky-drop EV and the rank rewards are one setting for the
// whole list, so boardsToSyntax writes them ONCE at the top and passes
// `shared: true` - they used to be repeated under every board.
export function boardToSyntax(board, index, { shared = false } = {}) {
  const role = index === 0 ? 'START' : `WAVE ${index}`
  const lines = [
    `BOARD ${index + 1} "${board.name}" [${role}] ${board.rows}x${board.cols}`,
    'LAYOUT:',
    ...layoutLines(board.tiles),
    `CONFIG: blockedValue=${board.blockedValue} minRank=${board.minRank} maxRank=${board.maxRank}${shared ? '' : ` targetEv=${evOf(board)}`}`,
    ...(shared ? [] : [`REWARDS: ${rewardsText(board)}`]),
  ]

  if (board.semiPlacements.length === 0 && board.blockedQueue.length === 0) {
    lines.push('SEQUENCE: (not generated yet)')
    return lines.join('\n')
  }

  const semi = board.semiPlacements.map((p) => `(${p.row},${p.col})=${itemText(p.rank)}`).join(' ')
  lines.push(`SEMI: ${semi || '(none)'}`)
  lines.push(`QUEUE: ${board.blockedQueue.map(itemText).join(',') || '(none)'}`)
  return lines.join('\n')
}

// The full board chain, in play order, as one document - what an Ops
// handoff would actually want (the whole sequence, not one board at a time).
export function boardsToSyntax(boards) {
  if (boards.length === 0) return ''
  // What every board of the list shares is said once, at the top.
  const shared = boards.every((b) => evOf(b) === evOf(boards[0]) && rewardsText(b) === rewardsText(boards[0]))
  const head = shared ? [`ALL BOARDS: targetEv=${evOf(boards[0])} REWARDS: ${rewardsText(boards[0])}`] : []
  return [...head, ...boards.map((board, i) => boardToSyntax(board, i, { shared }))].join('\n\n')
}

function percent(p) {
  return `${(p * 100).toFixed(1)}%`
}

// "CC syntax" - same document shape as boardToSyntax above, but for CC
// Management's suggestions (suggestQueues/suggestEv) instead of the board's
// actual saved config. Board pushes (role) still shown for context, but
// there's no real LAYOUT/SEMI here since these are hypothetical - only the
// +30%/+50% bigger-wave queue and +8%/+12% EV bump numbers.
const evLines = (board) => {
  const ev = suggestEv(board)
  return [
    `EV +8%: targetEv=${ev.plus8.ev.toFixed(2)} normal=${percent(ev.plus8.probs[0])} +1=${percent(ev.plus8.probs[1])} +2=${percent(ev.plus8.probs[2])}`,
    `EV +12%: targetEv=${ev.plus12.ev.toFixed(2)} normal=${percent(ev.plus12.probs[0])} +1=${percent(ev.plus12.probs[1])} +2=${percent(ev.plus12.probs[2])}`,
  ]
}
// `shared`: the EV bumps follow the list's one lucky-drop EV, so they are the
// same for every board - boardsSuggestionsToSyntax writes them once.
export function boardSuggestionsToSyntax(board, index, { shared = false } = {}) {
  const role = index === 0 ? 'START' : `WAVE ${index}`
  const { plus30, plus50 } = suggestQueues(board, index === 0, index)
  return [
    `BOARD ${index + 1} "${board.name}" [${role}] SUGGESTIONS`,
    `QUEUE +30%: blockedValue=${plus30.blockedValue} maxRank=${plus30.maxRank} queue=${plus30.ranks.map(itemText).join(',') || '(none)'}`,
    `QUEUE +50%: blockedValue=${plus50.blockedValue} maxRank=${plus50.maxRank} queue=${plus50.ranks.map(itemText).join(',') || '(none)'}`,
    ...(shared ? [] : evLines(board)),
  ].join('\n')
}

export function boardsSuggestionsToSyntax(boards) {
  if (boards.length === 0) return ''
  const shared = boards.every((b) => evLines(b).join() === evLines(boards[0]).join())
  const head = shared ? [['ALL BOARDS', ...evLines(boards[0])].join('\n')] : []
  return [...head, ...boards.map((board, i) => boardSuggestionsToSyntax(board, i, { shared }))].join('\n\n')
}
