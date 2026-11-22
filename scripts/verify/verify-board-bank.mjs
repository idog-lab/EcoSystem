// THE BANK OF BOARD LAYOUTS (economist: "the rank2 we got in the first board
// should be hardcoded into the board in any time, and the 2 cells in the
// rightest column in the bottom of the column should always be empty ... i
// need boards that the simulator can ofc solve").
//
//   npx vite-node scripts/verify/verify-board-bank.mjs
//
// Holds: the two rules on every first-board layout and through every layout
// edit; that each layout is filled exactly; and that the simulator solves
// every one - played many times alone, ahead of later boards, as later
// boards, in Recompletion, and built once for real with rewards and a Twister.
import { createBoard, withListPhase, FORCED_SEMI_CELL, FORCED_SEMI_RANK, tutorialCells, tutorialCellsAreOpen, generationTargetOf } from '../../src/features/merge/lib/core/board.js'
import { placeItems } from '../../src/features/merge/lib/core/placement.js'
import { paintTile, fillAllTiles, resizeBoard, applyLayout, openTutorialCells, hasTutorialCells } from '../../src/features/merge/lib/core/layoutEdits.js'
import { FIRST_BOARD_LAYOUTS, LATER_BOARD_LAYOUTS, BANK_GROUPS, bankLayoutsFor, bankLayoutOf, guidesOf, isSolidShape, symmetryOf } from '../../src/features/merge/lib/core/boardBank.js'
import { simulatePlaythrough } from '../../src/features/merge/lib/simulation/mergeSimulation.js'
import { buildEvent, segmentBuildInputs, mainChainSum } from '../../src/features/merge/lib/build/eventBuild.js'
import { withBlankCoinValues } from '../../src/features/merge/lib/rewards/rewardChain.js'
import { withDefaultTwisterValues } from '../../src/features/merge/lib/rewards/twisterEconomy.js'

let fails = 0
let total = 0
function check(name, cond) {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}`)
}
const TRIES = Number(process.argv[2] ?? 6)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// A board with a layout and what a generation puts under it.
function filled(name, index, tiles, value, { rc = false } = {}) {
  let b = createBoard(name, { rows: tiles.length, cols: tiles[0].length })
  b.tiles = tiles.map((row) => [...row])
  b.blockedValue = value
  if (rc) b = withListPhase({ ...b, minRank: 3, maxRank: 13 }, 'rc')
  const g = placeItems(b, { isFirstBoard: index === 0, boardIndex: index })
  return { ...b, semiPlacements: g.semiPlacements, blockedQueue: g.blockedQueue }
}
const later = (id) => LATER_BOARD_LAYOUTS.find((l) => l.id === id).tiles
const first = (id) => FIRST_BOARD_LAYOUTS.find((l) => l.id === id).tiles

console.log('--- 1. The bank, and the two rules of a first board ---')
{
  const fixed = FORCED_SEMI_CELL
  check(`the bank holds ${FIRST_BOARD_LAYOUTS.length} first boards and ${LATER_BOARD_LAYOUTS.length} later boards, each with its own name`, FIRST_BOARD_LAYOUTS.length >= 10 && LATER_BOARD_LAYOUTS.length >= 5 && new Set(FIRST_BOARD_LAYOUTS.map((l) => l.id)).size === FIRST_BOARD_LAYOUTS.length && new Set(LATER_BOARD_LAYOUTS.map((l) => l.id)).size === LATER_BOARD_LAYOUTS.length && [...FIRST_BOARD_LAYOUTS, ...LATER_BOARD_LAYOUTS].every((l) => l.name && l.note))
  check('every first board is 5 rows of 8 and no two are the same', FIRST_BOARD_LAYOUTS.every((l) => l.rows === 5 && l.cols === 8 && l.tiles.length === 5 && l.tiles.every((row) => row.length === 8)) && new Set(FIRST_BOARD_LAYOUTS.map((l) => JSON.stringify(l.tiles))).size === FIRST_BOARD_LAYOUTS.length)
  check('rule 1: the fixed cell of the rank-2 item is semi-blocked on every first board', FIRST_BOARD_LAYOUTS.every((l) => l.tiles[fixed.row][fixed.col] === 'semi'))
  check('rule 2: the two bottom cells of the rightmost column are empty on every first board', FIRST_BOARD_LAYOUTS.every((l) => l.tiles[4][7] === 'open' && l.tiles[3][7] === 'open' && tutorialCellsAreOpen(l.tiles)) && same(tutorialCells(5, 8), [{ row: 4, col: 7 }, { row: 3, col: 7 }]))
  const sizes = FIRST_BOARD_LAYOUTS.map((l) => l.blocked + l.semi)
  check(`a first board has enough tiles for a good amount of small items: ${Math.min(...sizes)} to ${Math.max(...sizes)} of them (${FIRST_BOARD_LAYOUTS.map((l) => `${l.id} ${l.blocked + l.semi}`).join(', ')})`, sizes.every((n) => n >= 20 && n <= 24) && FIRST_BOARD_LAYOUTS.every((l) => l.blocked === l.tiles.flat().filter((t) => t === 'blocked').length))
  check(
    `every first board has two or three guides - semi-blocked tiles in sight - each beside at least two blocked tiles, so merging into it reveals more (${FIRST_BOARD_LAYOUTS.map((l) => `${l.id} ${l.guides.map((g) => g.opens).join('/')}`).join(', ')})`,
    FIRST_BOARD_LAYOUTS.every((l) => l.guides.length === 3 && l.guides.every((g) => g.opens >= 2) && l.semi === l.guides.length + 1 && same(l.guides, guidesOf(l.tiles, true))),
  )
  check(
    `...and so has every later board (${LATER_BOARD_LAYOUTS.map((l) => `${l.id} ${l.guides.map((g) => g.opens).join('/')}`).join(', ')})`,
    LATER_BOARD_LAYOUTS.every((l) => l.guides.length >= 2 && l.guides.every((g) => g.opens >= 2) && l.semi === l.guides.length),
  )
  // One solid shape, no holes ("we need boards that doesnt look like they were a mistake").
  const parse = (map) => map.map((line) => [...line].map((ch) => (ch === '#' ? 'blocked' : ch === 's' ? 'semi' : 'open')))
  check(
    'every board of the bank is one solid shape: its tiles are one piece and no row or column has a gap in it',
    [...FIRST_BOARD_LAYOUTS, ...LATER_BOARD_LAYOUTS].every((l) => isSolidShape(l.tiles)),
  )
  check(
    '...which is what rules out a lane between two blocks, tips with space between them, an opening under an arch, and a fixed cell on its own',
    !isSolidShape(parse(['........', 's##.....', '###.s#s.', '###.###.', '###.###.'])) && !isSolidShape(parse(['########', '##s##s##', '#.#.s.#.', '........', '........'])) && !isSolidShape(parse(['########', '#s#..#s#', '##....##'])) && !isSolidShape(parse(['###..###', '#s....s#', '....s...', '###s....', '#####...'])) && isSolidShape(parse(['........', '...s#...', '..##s##.', '.s####s.', '#######.'])),
  )
  // Symmetrical to the eye ("i want them to be simetrical to the eye").
  const tilesIn = (layout, r) => layout.tiles[r].filter((t) => t !== 'open').length
  check(
    `every board of the bank is symmetrical - its left half mirrors its right, tiles and items in sight alike; the diagonal is the same turned half a circle (${[...FIRST_BOARD_LAYOUTS, ...LATER_BOARD_LAYOUTS].filter((l) => l.symmetry === 'turn').map((l) => l.id).join(', ')})`,
    [...FIRST_BOARD_LAYOUTS, ...LATER_BOARD_LAYOUTS].every((l) => (l.group === 'diagonal' ? l.symmetry === 'turn' : l.symmetry === 'mirror') && l.symmetry === symmetryOf(l.tiles)),
  )
  check(
    'the two tutorial cells are empty space like any other: their mirror cells on the left are empty too, and the fixed cell has a guide on its mirror cell',
    FIRST_BOARD_LAYOUTS.filter((l) => l.symmetry === 'mirror').every((l) => l.tiles[4][0] === 'open' && l.tiles[3][0] === 'open' && l.tiles[2][3] === 'semi' && l.tiles[2][4] === 'semi'),
  )
  const diagonal = FIRST_BOARD_LAYOUTS.find((l) => l.id === 'diagonal')
  check(`the diagonal has the same number of tiles in every row (${diagonal.tiles.map((_, r) => tilesIn(diagonal, r)).join(', ')})`, diagonal.tiles.every((_, r) => tilesIn(diagonal, r) === 4))
  check(
    '...which is what rules out steps, a block against one side, and a band with a longer last row',
    symmetryOf(parse(['........', 's#......', '###ss...', '#####s..', '#######.'])) === null && symmetryOf(parse(['##s.....', '#####...', '####s...', '#####...', '##s.....'])) === null && symmetryOf(parse(['....s###', '...####.', '..##s#..', '.s###...', '#####...'])) === null,
  )
  // Where the tiles sit: standing on the floor, hanging from the top, a diagonal band.
  const groupOf = (list, id) => list.filter((l) => l.group === id)
  check(
    `the first boards come standing on the floor (${groupOf(FIRST_BOARD_LAYOUTS, 'standing').length}), hanging from the top (${groupOf(FIRST_BOARD_LAYOUTS, 'hanging').length}), as a diagonal (${groupOf(FIRST_BOARD_LAYOUTS, 'diagonal').length}) and drawn for an occasion (Black Friday: ${groupOf(FIRST_BOARD_LAYOUTS, 'black-friday').map((l) => l.id).join(', ')})`,
    groupOf(FIRST_BOARD_LAYOUTS, 'standing').length >= 6 && groupOf(FIRST_BOARD_LAYOUTS, 'hanging').length >= 5 && groupOf(FIRST_BOARD_LAYOUTS, 'diagonal').length === 1 && [...FIRST_BOARD_LAYOUTS, ...LATER_BOARD_LAYOUTS].every((l) => BANK_GROUPS.some((g) => g.id === l.group)),
  )
  check(
    'a board drawn for an occasion is a first board like any other: none for a later board, and each is held to every rule above and played below',
    groupOf(LATER_BOARD_LAYOUTS, 'black-friday').length === 0 && groupOf(FIRST_BOARD_LAYOUTS, 'black-friday').every((l) => l.symmetry === 'mirror' && isSolidShape(l.tiles) && l.guides.length === 3 && l.blocked + l.semi >= 20 && l.blocked + l.semi <= 24 && tutorialCellsAreOpen(l.tiles)),
  )
  check('a standing board has six tiles in its bottom row, centred; a hanging board has its top row full and nothing on the floor', groupOf(FIRST_BOARD_LAYOUTS, 'standing').every((l) => tilesIn(l, 4) === 6) && groupOf(FIRST_BOARD_LAYOUTS, 'hanging').every((l) => tilesIn(l, 0) === 8 && tilesIn(l, 4) === 0))
  check(`the later boards too: ${groupOf(LATER_BOARD_LAYOUTS, 'standing').length} standing, ${groupOf(LATER_BOARD_LAYOUTS, 'hanging').length} hanging (top row full)`, groupOf(LATER_BOARD_LAYOUTS, 'hanging').length >= 2 && groupOf(LATER_BOARD_LAYOUTS, 'hanging').every((l) => tilesIn(l, 0) === 8) && groupOf(LATER_BOARD_LAYOUTS, 'standing').every((l) => tilesIn(l, l.rows - 1) >= 6))
  check('a later board is at most 3 rows of 8', LATER_BOARD_LAYOUTS.every((l) => l.rows >= 1 && l.rows <= 3 && l.cols === 8))
  check('the picker finds which bank layout a board is, if any', bankLayoutOf({ tiles: first('pyramid') }, true)?.id === 'pyramid' && bankLayoutOf({ tiles: later('hill') }, false)?.id === 'hill' && bankLayoutOf({ tiles: later('hill') }, true) === null && bankLayoutsFor(true) === FIRST_BOARD_LAYOUTS)
}

console.log('--- 2. Every layout edit keeps the two rules on the first board of the normal event ---')
{
  const fixed = FORCED_SEMI_CELL
  const blank = createBoard('Board 1', { rows: 5, cols: 8 })
  const picked = applyLayout({ ...blank, semiPlacements: [{ row: 2, col: 4, rank: 2 }], blockedQueue: [1, 1, 2] }, true, FIRST_BOARD_LAYOUTS.find((l) => l.id === 'table'))
  check('picking a layout draws exactly its tiles, and what was built under the old tiles is cleared', same(picked.tiles, first('table')) && (picked.semiPlacements?.length ?? 0) === 0 && (picked.blockedQueue?.length ?? 0) === 0 && picked.rows === 5 && picked.cols === 8)
  const smaller = applyLayout(createBoard('Board 2', { rows: 3, cols: 8 }), false, LATER_BOARD_LAYOUTS.find((l) => l.id === 'one-row'))
  check('a later board takes the size of the layout picked (one row)', smaller.rows === 1 && smaller.tiles.length === 1 && same(smaller.tiles, later('one-row')))
  const painted = paintTile(paintTile(picked, true, 4, 7, 'blocked'), true, 3, 7, 'semi', 5)
  check('painting a tutorial cell leaves it empty, and no rank stays pinned to it', painted.tiles[4][7] === 'open' && painted.tiles[3][7] === 'open' && (painted.forcedSemiRanks ?? []).length === 0)
  const allBlocked = fillAllTiles(picked, true, 'blocked')
  const others = allBlocked.tiles.flatMap((row, r) => row.filter((_, c) => !(r === fixed.row && c === fixed.col) && !(c === 7 && r >= 3)))
  check('"fill all blocked" blocks every cell but the fixed one and the two tutorial cells', others.every((t) => t === 'blocked') && allBlocked.tiles[fixed.row][fixed.col] === 'semi' && tutorialCellsAreOpen(allBlocked.tiles))
  const bigger = resizeBoard(allBlocked, true, 6, 9)
  check('after a resize the two bottom cells of the NEW rightmost column are the empty ones', bigger.rows === 6 && bigger.cols === 9 && bigger.tiles[5][8] === 'open' && bigger.tiles[4][8] === 'open' && bigger.tiles[fixed.row][fixed.col] === 'semi')
  const old = { ...blank, tiles: blank.tiles.map((row, r) => row.map(() => (r >= 3 ? 'blocked' : 'open'))), forcedSemiRanks: [{ row: 1, col: 1, rank: 3 }] }
  old.tiles[1][1] = 'semi'
  old.tiles[2][4] = 'semi'
  const opened = openTutorialCells(old)
  check('a first board drawn before the rule is told apart, and "Empty these two cells" changes those two and nothing else', !tutorialCellsAreOpen(old.tiles) && tutorialCellsAreOpen(opened.tiles) && opened.tiles.flat().filter((t) => t === 'blocked').length === 14 && opened.tiles[1][1] === 'semi' && same(opened.forcedSemiRanks, [{ row: 1, col: 1, rank: 3 }]))
  const second = fillAllTiles(createBoard('Board 2', { rows: 3, cols: 8 }), false, 'blocked')
  const rcFirst = fillAllTiles(withListPhase(createBoard('Board 1', { rows: 5, cols: 8 }), 'rc'), true, 'blocked')
  check('the rule is the normal event\'s first board only: a later board and Recompletion\'s first board can be full', second.tiles.flat().every((t) => t === 'blocked') && rcFirst.tiles[4][7] === 'blocked' && rcFirst.tiles[3][7] === 'blocked' && !hasTutorialCells(rcFirst, true) && hasTutorialCells(blank, true) && !hasTutorialCells(blank, false))
}

console.log('--- 3. What a build puts under each first board ---')
{
  const fixed = FORCED_SEMI_CELL
  const rows = FIRST_BOARD_LAYOUTS.map((layout) => {
    let exact = 0
    let rank2 = 0
    let clean = 0
    let n = 0
    let ones = 0
    let guideOnes = 0
    let full = 0
    for (const value of [150, 100, 60]) {
      for (let k = 0; k < TRIES; k++) {
        const b = filled('Board 1', 0, layout.tiles, value)
        n += 1
        if (value === 150) {
          full += 1
          ones += [...b.blockedQueue, ...b.semiPlacements.map((p) => p.rank)].filter((rank) => rank === 1).length
          if (layout.guides.every((g) => b.semiPlacements.some((p) => p.row === g.row && p.col === g.col && p.rank === 1))) guideOnes += 1
        }
        if (mainChainSum(b) === generationTargetOf(b) && mainChainSum(b) === value) exact += 1
        if (b.semiPlacements.some((p) => p.row === fixed.row && p.col === fixed.col && p.rank === FORCED_SEMI_RANK)) rank2 += 1
        if (!b.semiPlacements.some((p) => p.col === 7 && p.row >= 3) && b.blockedQueue.length === layout.blocked) clean += 1
      }
    }
    return { id: layout.id, n, exact, rank2, clean, ones: ones / full, guideOnes, full }
  })
  check(`at 150 DR every first board holds a good amount of rank-1 items (on average ${rows.map((r) => `${r.id} ${r.ones.toFixed(1)}`).join(', ')})`, rows.every((r) => r.ones >= 7.5))
  check('...and every guide of a first board holds a rank 1: one tap of the generator matches the item in sight', rows.every((r) => r.guideOnes === r.full))
  check(`every first board holds its DR exactly at 150, 100 and 60 DR (${rows.reduce((s, r) => s + r.exact, 0)} of ${rows.reduce((s, r) => s + r.n, 0)} fills)`, rows.every((r) => r.exact === r.n))
  check('...with the rank-2 item on the fixed cell in every fill', rows.every((r) => r.rank2 === r.n))
  check('...and nothing on the two tutorial cells: one item under each blocked tile, none elsewhere', rows.every((r) => r.clean === r.n))
}

console.log('--- 4. The simulator solves every first board ---')
{
  // "Solved": every board is reached and the top rank is made, and with a
  // moderate subsidy every tile is opened on the way - which is what shows
  // that no tile of a layout is out of reach. At a very large subsidy (1,900
  // of the 2,048 DR: a demand of 148) only the first part is asked: there a
  // lucky player makes rank 12 before the last tiles open (seen on the first
  // bank: 1,644 of 1,900 DR opened behind an "arch" later board) -
  // a finished event that did not need all its subsidy, not a board that
  // cannot be solved. The build's demand calibration is what deals with that.
  const EVENTS = [
    { values: [150, 600, 750], all: true },
    { values: [150, 175, 175], all: true },
    { values: [150, 850, 900], all: false },
    { values: [100], all: true },
    { values: [60], all: true },
  ]
  const results = FIRST_BOARD_LAYOUTS.map((layout) => {
    let solved = 0
    let n = 0
    let worst = null
    for (const event of EVENTS) {
      for (let k = 0; k < TRIES; k++) {
        const boards = [filled('Board 1', 0, layout.tiles, event.values[0]), ...event.values.slice(1).map((v, i) => filled(`Board ${i + 2}`, i + 1, later('two-rows'), v))]
        const run = simulatePlaythrough(boards, {})
        const multi = boards.length > 1
        const ok = run.boardsReached === run.boardsTotal && (multi ? run.reachedAt[12] !== undefined : true) && (!event.all || run.subsidyDelivered === run.subsidyConfigured)
        n += 1
        if (ok) solved += 1
        else worst = worst ?? `${event.values.join('/')}: ${run.subsidyDelivered} of ${run.subsidyConfigured} DR opened, boards ${run.boardsReached}/${run.boardsTotal}, ${run.stopReason}`
      }
    }
    return { id: layout.id, solved, n, worst }
  })
  for (const r of results) check(`${r.id}: solved ${r.solved} of ${r.n} plays (alone at 100 and 60 DR; ahead of two later boards at three subsidies)${r.worst ? ` - e.g. ${r.worst}` : ''}`, r.solved === r.n)
}

console.log('--- 5. ...and every later board, as Board 2 and Board 3 ---')
{
  for (const layout of LATER_BOARD_LAYOUTS) {
    let solved = 0
    let n = 0
    let worst = null
    for (const event of [{ values: [150, 600, 750], all: true }, { values: [150, 176, 176], all: true }, { values: [150, 850, 900], all: false }, { values: [150, 60, 60], all: true }]) {
      for (let k = 0; k < TRIES; k++) {
        const boards = [filled('Board 1', 0, first('three-rows'), 150), filled('Board 2', 1, layout.tiles, event.values[1]), filled('Board 3', 2, layout.tiles, event.values[2])]
        const run = simulatePlaythrough(boards, {})
        const ok = run.boardsReached === run.boardsTotal && run.reachedAt[12] !== undefined && (!event.all || run.subsidyDelivered === run.subsidyConfigured)
        n += 1
        if (ok) solved += 1
        else worst = worst ?? `${event.values.join('/')}: ${run.subsidyDelivered} of ${run.subsidyConfigured} DR opened, boards ${run.boardsReached}/${run.boardsTotal}, ${run.stopReason}`
      }
    }
    check(`${layout.id}: solved ${solved} of ${n} plays${worst ? ` - e.g. ${worst}` : ''}`, solved === n)
  }
}

console.log('--- 6. In Recompletion: the first-board layouts as its Board 1 ---')
{
  // Recompletion's first board keeps the fixed cell (rank 3 there) and has no
  // item below rank 3; the layouts are played as its Board 1 with 300 DR.
  const mainBoards = [filled('Board 1', 0, first('three-rows'), 150), filled('Board 2', 1, later('two-rows'), 600), filled('Board 3', 2, later('two-rows'), 750)]
  const results = FIRST_BOARD_LAYOUTS.map((layout) => {
    let solved = 0
    let low = 0
    let n = 0
    for (let k = 0; k < TRIES; k++) {
      const rcBoards = [filled('Board 1', 0, layout.tiles, 300, { rc: true }), filled('Board 2', 1, later('two-rows'), 2400, { rc: true }), filled('Board 3', 2, later('two-rows'), 2896, { rc: true })]
      const run = simulatePlaythrough(mainBoards, { rcBoards })
      n += 1
      if (run.secondGrandPrizeAwarded && run.rcPhase?.boardsReached === run.rcPhase?.boardsTotal) solved += 1
      if (rcBoards.some((b) => [...b.blockedQueue, ...b.semiPlacements.map((p) => p.rank)].some((rank) => rank < 3))) low += 1
    }
    return { id: layout.id, solved, n, low }
  })
  check(`every first-board layout is solved as Recompletion's Board 1 too (${results.map((r) => `${r.solved}/${r.n}`).join(' ')})`, results.every((r) => r.solved === r.n))
  check('...with no item below rank 3 on it', results.every((r) => r.low === 0))
}

console.log('--- 7. A real build on every first board: rewards, drops and a Twister ---')
{
  for (const layout of FIRST_BOARD_LAYOUTS) {
    const prepare = (b) => ({ ...b, minDropRank: 6, twisterByBuild: true, rewardChainConfig: withDefaultTwisterValues(withBlankCoinValues(b.rewardChainConfig)), semiPlacements: [], blockedQueue: [] })
    const boards = [filled('Board 1', 0, layout.tiles, 150), filled('Board 2', 1, later('two-rows'), 600), filled('Board 3', 2, later('two-rows'), 750)].map(prepare)
    const raw = [{ name: 'Segment 1', mainBoards: boards, rcBoards: [], rewardTargets: { main: { coins: 3, puzzles: 300, energy: 200, charms: 400 } }, segmentFactor: 1, sourceAllocation: {}, twisterPlan: { main: { targetSpins: 15, targetSpinsOverrides: {}, costIncrement: 1, checkpointPct: 100 } } }]
    const draft = await buildEvent({ phase: 'main', segments: segmentBuildInputs(raw, 'main') })
    const seg = draft.segments[0]
    const built = seg.boards[0]
    check(
      `${layout.id}: built - ${seg.status}, every simulated player finishes, Board 1 holds ${mainChainSum(built)} DR, pays ${Math.round(seg.demandFit.paid.mean)} of ${seg.demandFit.configured}`,
      seg.status !== 'infeasible' && seg.demandFit.completionRate === 1 && mainChainSum(built) === 150 && tutorialCellsAreOpen(built.tiles) && built.semiPlacements.some((p) => p.row === FORCED_SEMI_CELL.row && p.col === FORCED_SEMI_CELL.col && p.rank === FORCED_SEMI_RANK),
    )
  }
}

console.log(`\n${fails === 0 ? `ALL ${total} BOARD BANK CHECKS PASSED` : `${fails} OF ${total} BOARD BANK CHECK(S) FAILED`}`)
process.exit(fails ? 1 : 0)
