// THE BANK OF BOARD LAYOUTS (economist: "some board suggestions, mostly its
// important for the first board ... in the board layout ill just pick from
// the bank of boards which one we will use this time").
//
// A layout is where the tiles are - which cells are blocked, semi-blocked or
// open. What goes under them is still the build's. Two rules hold for every
// first board (economist: "the rules for any board"):
//   1. the rank-2 item of the first board is hardcoded into it: the fixed
//      semi-blocked cell (board.js: FORCED_SEMI_CELL, row 3, column 5);
//   2. the two bottom cells of the rightmost column are always empty - the
//      game's tutorial uses them (board.js: tutorialCells).
// Both are forced when a layout is applied (layoutEdits.js), so no entry here
// can break them; the maps below simply draw them as they end up.
//
// WHAT MAKES A GOOD BOARD (economist, on the first bank: "the boards are not
// the best. they should have a bit more tiles ... because we are looking for
// a good amount of rank1 in them as we know. and also, we need some semi
// blocked on the board. we take into account that the players are rather not
// so smart, and we should guide them to where to merge on to reveal more
// tiles"):
//   - ENOUGH TILES. A first board has 20 to 24 tiles. Board 1 holds 150 DR in
//     small items, so more tiles means more of them are rank 1: about 9 to 10
//     rank-1 items on these boards (measured; 13 to 17 of rank 1 or 2).
//   - GUIDES. Besides the fixed rank-2 cell, every board has three
//     semi-blocked tiles (two on a later board) - an item the player can SEE, and merge into. A
//     merge opens the tiles next to the cell it happens in, so a guide sits
//     where it has at least two blocked tiles beside it: merging into the
//     item in sight is the move that reveals more of the board. On Board 1 a
//     semi-blocked tile holds a rank 1 - one tap of the generator matches it.
//
// EVERY LAYOUT HERE IS ONE THE SIMULATOR SOLVES ("i need boards that the
// simulator can ofc solve. if he cant solve, check why and fix"). That is
// held by scripts/verify/verify-board-bank.mjs: each first board is filled at
// 150, 100 and 60 DR and played, alone and ahead of two later boards, many
// times over, played as Recompletion's Board 1, and built once with rewards
// and a Twister; each later board is played as Board 2 and Board 3. The same
// suite holds the tile counts, the guides and the rank-1 items above.
//
// A map is drawn top row first: "#" blocked, "s" semi-blocked, "." open.
import { applyForcedSemiCell, applyTutorialCells, FORCED_SEMI_CELL } from './board'

const parse = (map) => map.map((line) => [...line].map((ch) => (ch === '#' ? 'blocked' : ch === 's' ? 'semi' : 'open')))
const count = (tiles, state) => tiles.flat().filter((t) => t === state).length
// The guides of a layout: its semi-blocked tiles (not the fixed cell of a
// first board), each with how many blocked tiles a merge into it opens.
export function guidesOf(tiles, isFirstBoard) {
  const blockedAt = (r, c) => tiles[r]?.[c] === 'blocked'
  return tiles.flatMap((row, r) =>
    row
      .map((state, c) => (state === 'semi' && !(isFirstBoard && r === FORCED_SEMI_CELL.row && c === FORCED_SEMI_CELL.col) ? { row: r, col: c, opens: [blockedAt(r - 1, c), blockedAt(r + 1, c), blockedAt(r, c - 1), blockedAt(r, c + 1)].filter(Boolean).length } : null))
      .filter(Boolean),
  )
}
// ONE SOLID SHAPE, NO HOLES (economist: "the boards that looks like htey
// have holes in them, i dont like those. we need boards that doesnt look like
// they were a mistake"). The tiles of a layout - blocked and semi-blocked
// together, the fixed cell among them - are one piece, and no row and no
// column has a gap in it: rows, steps, hills, bands. That rules out lanes
// between blocks, tips with space between them, an opening under an arch,
// and a fixed cell standing on its own away from the rest (all of which the
// second bank had, and all of which the simulator solved - they were dropped
// for how they look).
export function isSolidShape(tiles) {
  const tile = (r, c) => tiles[r]?.[c] != null && tiles[r][c] !== 'open'
  const oneRun = (cells) => {
    const at = cells.map((on, i) => (on ? i : -1)).filter((i) => i >= 0)
    return at.length === 0 || at[at.length - 1] - at[0] + 1 === at.length
  }
  const rows = tiles.length
  const cols = tiles[0]?.length ?? 0
  for (let r = 0; r < rows; r++) if (!oneRun(tiles[r].map((_, c) => tile(r, c)))) return false
  for (let c = 0; c < cols; c++) if (!oneRun(tiles.map((_, r) => tile(r, c)))) return false
  // One piece: every tile is reached from the first, side to side.
  const all = tiles.flatMap((row, r) => row.map((_, c) => (tile(r, c) ? `${r},${c}` : null))).filter(Boolean)
  if (all.length === 0) return false
  const seen = new Set([all[0]])
  const queue = [all[0]]
  while (queue.length) {
    const [r, c] = queue.pop().split(',').map(Number)
    for (const [y, x] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      const key = `${y},${x}`
      if (tile(y, x) && !seen.has(key)) {
        seen.add(key)
        queue.push(key)
      }
    }
  }
  return seen.size === all.length
}
// SYMMETRICAL TO THE EYE (economist: "when we are creating boards we need to
// look at the 2 putple tiles as empty, we need to see the boards only with
// the tiles on them. i want them to be simetrical to the eye" - and of a band
// with rows of 4, 4, 4, 4 and 5 tiles: "this is not simetrical"). A board is
// judged by its tiles alone: the two tutorial cells are empty space like any
// other. So:
//   - 'mirror': the left half is the right half in a mirror - the shape of
//     the tiles AND which of them are in sight (semi-blocked). The two
//     tutorial cells are at the right edge of the two bottom rows, so their
//     mirror cells at the left edge are left empty as well: a board that
//     stands on the floor is six tiles wide there, centred. The fixed rank-2
//     cell is right of the middle; a guide sits on its mirror cell, left of
//     the middle, so the two items in sight are a centred pair.
//   - 'turn': the board is the same turned half a circle - a diagonal band
//     with the same number of tiles in every row.
// Steps and a block against one side are neither, and are not in the bank.
export function symmetryOf(tiles) {
  const rows = tiles.length
  const cols = tiles[0]?.length ?? 0
  const same = (pick) => tiles.every((row, r) => row.every((state, c) => state === pick(r, c)))
  if (same((r, c) => tiles[r][cols - 1 - c])) return 'mirror'
  if (same((r, c) => tiles[rows - 1 - r][cols - 1 - c])) return 'turn'
  return null
}
const entry = (first) => (layout) => {
  const drawn = parse(layout.map)
  const tiles = first ? applyForcedSemiCell(applyTutorialCells(drawn)) : drawn
  return { ...layout, tiles, rows: tiles.length, cols: tiles[0].length, blocked: count(tiles, 'blocked'), semi: count(tiles, 'semi'), guides: guidesOf(tiles, first), symmetry: symmetryOf(tiles) }
}

// WHERE THE TILES SIT (economist: "u are creating only boards who are
// weighted down with gravity, can u crete also ones that are hanged up?"):
// a board STANDS on the floor (tiles at the bottom, open space above), HANGS
// from the top (tiles at the top, open space below), or is a DIAGONAL band.
// The picker shows them in those groups.
//
// FOR AN OCCASION. A last group holds boards drawn as a picture for one event
// (economist: "do we have a good idea for a boad layout for black friday ?" -
// and of the four tried: "lets try to enter all for now, ill try to see them
// in the model it self"). They are ON TRIAL - the economist has not chosen
// among them - and are held to every rule of a first board like the others:
// symmetrical, one solid piece, 20 to 24 tiles, three guides, solved by the
// simulator. What the rules leave no room for: a bag with a handle loop or a
// price tag with its hole (a hole), a cart (lopsided), letters.
export const BANK_GROUPS = [
  { id: 'standing', name: 'Standing on the floor' },
  { id: 'hanging', name: 'Hanging from the top' },
  { id: 'diagonal', name: 'Diagonal' },
  { id: 'black-friday', name: 'Black Friday' },
]

// The first board: 5 rows of 8. In every map the fixed cell (row 3, column 5)
// and the guide on its mirror cell (row 3, column 4) are the "ss" in the
// middle of the third row.
export const FIRST_BOARD_LAYOUTS = [
  { id: 'three-rows', group: 'standing', name: 'Three rows', note: 'Three rows of six, with a small cap in the middle.', map: ['........', '...##...', '.s#ss#s.', '.######.', '.######.'] },
  { id: 'four-rows', group: 'standing', name: 'Four rows', note: 'A block of four rows of six.', map: ['........', '.######.', '.s#ss#s.', '.######.', '.######.'] },
  { id: 'hill', group: 'standing', name: 'Hill', note: 'Three rows of six under a narrower fourth.', map: ['........', '..####..', '.s#ss#s.', '.######.', '.######.'] },
  { id: 'pyramid', group: 'standing', name: 'Pyramid', note: 'The most tiles: narrowing step by step to the top.', map: ['...##...', '..####..', '.s#ss#s.', '.######.', '.######.'] },
  { id: 'tower', group: 'standing', name: 'Tower', note: 'Three rows of six with a tower in the middle.', map: ['...##...', '...##...', '.s#ss#s.', '.######.', '.######.'] },
  { id: 'table', group: 'standing', name: 'Table', note: 'A full row lying on two rows of six.', map: ['........', '........', '#s#ss#s#', '.######.', '.######.'] },
  { id: 'wide-hill', group: 'standing', name: 'Wide hill', note: 'A full row in the middle, narrower above and below.', map: ['........', '..####..', '#s#ss#s#', '.######.', '.######.'] },
  { id: 'curtain', group: 'hanging', name: 'Curtain', note: 'Three full rows at the top, the floor free.', map: ['########', '########', '#s#ss#s#', '........', '........'] },
  { id: 'hanging-rows', group: 'hanging', name: 'Hanging rows', note: 'Two full rows at the top and a row of six under them.', map: ['########', '########', '.s#ss#s.', '........', '........'] },
  { id: 'canopy', group: 'hanging', name: 'Canopy', note: 'A full row at the top and two rows of six under it.', map: ['########', '.######.', '.s#ss#s.', '........', '........'] },
  { id: 'hanging-hill', group: 'hanging', name: 'Hanging hill', note: 'Two full rows with a short row hanging in the middle.', map: ['########', '#s####s#', '..#ss#..', '........', '........'] },
  { id: 'hanging-pyramid', group: 'hanging', name: 'Hanging pyramid', note: 'A pyramid upside down, narrowing step by step.', map: ['########', '.s####s.', '..#ss#..', '...##...', '........'] },
  { id: 'pendant', group: 'hanging', name: 'Pendant', note: 'A full top row with a block of four hanging from its middle.', map: ['#s####s#', '..####..', '..#ss#..', '..####..', '........'] },
  { id: 'diagonal', group: 'diagonal', name: 'Diagonal', note: 'A band of four tiles a row, from the bottom left to the top right.', map: ['....s###', '...####.', '..#ss#..', '.####...', '###s....'] },
  { id: 'gift-box', group: 'black-friday', name: 'Gift box', note: 'A present: a bow, a wide lid and the box under it.', map: ['........', '...##...', '#s#ss#s#', '.######.', '.######.'] },
  { id: 'price-drop', group: 'black-friday', name: 'Price drop', note: 'An arrow pointing down: prices falling.', map: ['...##...', '...##...', '#s#ss#s#', '.######.', '..####..'] },
  { id: 'sale-sign', group: 'black-friday', name: 'Sale sign', note: 'A shop sign hanging from its nail, the floor free.', map: ['...##...', '.######.', '.s#ss#s.', '.######.', '........'] },
  { id: 'floating-gift', group: 'black-friday', name: 'Floating gift', note: 'A bow on a full-width lid with the box under it, the floor free.', map: ['...##...', '########', '.s#ss#s.', '.######.', '........'] },
].map(entry(true))

// The boards after the first: up to 3 rows of 8, pushed in from the top. A
// semi-blocked tile there holds rank 2 or more (never a rank 1 after Board 1).
export const LATER_BOARD_LAYOUTS = [
  { id: 'two-rows', group: 'standing', name: 'Two rows', note: 'An open row above two rows of tiles, two guides.', map: ['........', '##s##s##', '########'] },
  { id: 'three-rows', group: 'standing', name: 'Three rows', note: 'Full: the most tiles a later board can have.', map: ['##s##s##', '########', '########'] },
  { id: 'one-row', group: 'standing', name: 'One row', note: 'A single row. For a small subsidy.', map: ['##s##s##'] },
  { id: 'hill', group: 'standing', name: 'Hill', note: 'A full row with a hill on it, a guide on each shoulder.', map: ['..s##s..', '.######.', '########'] },
  { id: 'block', group: 'standing', name: 'Block', note: 'Two rows of six on a full row.', map: ['.######.', '.s####s.', '########'] },
  { id: 'middle-pair', group: 'standing', name: 'Middle pair', note: 'Two items in sight side by side, above a full row.', map: ['........', '###ss###', '########'] },
  { id: 'hanging-rows', group: 'hanging', name: 'Hanging rows', note: 'Two rows of tiles at the top, an open row below.', map: ['########', '##s##s##', '........'] },
  { id: 'hanging-hill', group: 'hanging', name: 'Hanging hill', note: 'A full row with a hill hanging under it.', map: ['########', '.######.', '..s##s..'] },
  { id: 'hanging-block', group: 'hanging', name: 'Hanging block', note: 'A full row with two rows of six hanging under it.', map: ['########', '.s####s.', '.######.'] },
].map(entry(false))

export const bankLayoutsFor = (isFirstBoard) => (isFirstBoard ? FIRST_BOARD_LAYOUTS : LATER_BOARD_LAYOUTS)

// The bank entry a board's tiles are, if any (so the picker can mark it).
export function bankLayoutOf(board, isFirstBoard) {
  const key = JSON.stringify(board?.tiles ?? [])
  return bankLayoutsFor(isFirstBoard).find((layout) => JSON.stringify(layout.tiles) === key) ?? null
}
