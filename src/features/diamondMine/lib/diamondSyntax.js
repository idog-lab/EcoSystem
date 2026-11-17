// Draft export syntax for Diamond Mine boards - THIS FORMAT IS NOT FINAL,
// same placeholder status as boardSyntax.js's Merge export: a stand-in until
// a real Ops spec exists. Nothing else in the app reads this format.

import { footprint } from './gem'
import { computeMinClicks, computeDifficulty } from './diamondStats'

const BLOCKED_CHAR = { true: '#', false: '.' }

function layoutLines(blocked) {
  return blocked.map((row) => row.map((b) => BLOCKED_CHAR[b]).join(''))
}

export function diamondBoardToSyntax(board, gemsById) {
  const lines = [`BOARD "${board.name}" ${board.rows}x${board.cols}`, 'LAYOUT:', ...layoutLines(board.blocked)]

  if (board.placements.length === 0) {
    lines.push('GEMS: (none placed yet)')
  } else {
    lines.push('GEMS:')
    for (const p of board.placements) {
      const gem = gemsById[p.gemId]
      if (!gem) continue
      const { rows, cols } = footprint(gem, p.rotated)
      lines.push(`  (${p.anchorRow},${p.anchorCol}) ${gem.name} ${rows}x${cols}${p.rotated ? ' rotated' : ''}`)
    }
  }

  const difficulty = computeDifficulty(board, gemsById)
  lines.push(
    difficulty
      ? `STATS: minClicks=${computeMinClicks(board, gemsById)} difficulty=${difficulty.score} (${difficulty.bucket})`
      : 'STATS: (not built yet)',
  )

  return lines.join('\n')
}

export function diamondBoardsToSyntax(boards, gemsById) {
  return boards.map((board) => diamondBoardToSyntax(board, gemsById)).join('\n\n')
}
