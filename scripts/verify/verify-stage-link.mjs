// THE STAGE LINK (economist: "i also want u to make sure the link of the stage
// as short as possible"; before that: "the link is broken to everyone except
// me", "we got a - and it breaks the link when sent").
//
//   npx vite-node scripts/verify/verify-stage-link.mjs
//
// Holds: a link is short and letters and digits only; a stage read back from
// its link is, for play, the stage that went in - a robot on the real play
// engine plays both to the same last item; every older writing of a link
// still opens; a link that was changed on the way reads as broken, never as
// another stage; and the writing is FROZEN - a link written down on the day
// it was made still opens as the same stage, and the dictionary it is read
// with has not changed by a character.
import { gzipSync, strToU8 } from 'fflate'
import { createBoard, withListPhase } from '../../src/features/merge/lib/core/board.js'
import { FIRST_BOARD_LAYOUTS, LATER_BOARD_LAYOUTS } from '../../src/features/merge/lib/core/boardBank.js'
import { regenerateBoard } from '../../src/features/merge/lib/simulation/effortTargeting.js'
import { buildEvent, segmentBuildInputs, rcInputsOnMainDraft, boardsWithDraftApplied } from '../../src/features/merge/lib/build/eventBuild.js'
import { withBlankCoinValues, encodeReward } from '../../src/features/merge/lib/rewards/rewardChain.js'
import { withDefaultTwisterValues } from '../../src/features/merge/lib/rewards/twisterEconomy.js'
import { encodeStage, decodeStage, STAGE_DICTIONARY } from '../../src/features/merge/lib/share/stageShare.js'
import { encodeToUrlParam } from '../../src/features/merge/lib/share/urlCodec.js'
import { playRun, ROBOTS } from './playRobot.mjs'

let fails = 0
let total = 0
function check(name, cond) {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const TYPES = ['coins', 'puzzles', 'energy', 'charms', 'twister']

// What play reads of a board (the engine, found by a robot playing boards
// that wrote down every field read, and the play screens).
function playView(board) {
  const groups = board.dropGroups ?? []
  const index = new Map(groups.map((g, i) => [g.id, i]))
  return {
    name: board.name,
    rows: board.rows,
    cols: board.cols,
    tiles: board.tiles,
    semiPlacements: (board.semiPlacements ?? []).map((p) => [p.row, p.col, p.rank]),
    blockedQueue: board.blockedQueue ?? [],
    values: TYPES.map((type) => (board.rewardChainConfig?.[type] ?? []).map((r) => r?.prizeAmount ?? null)),
    containers: groups.map((g) => [!!g.auto, Object.entries(g.items ?? {}).filter(([, rank]) => rank != null)]),
    weights: (board.dropGroupsConfig ?? []).map((t) => [t.noDropWeight ?? 0, !!t.belowStart, (t.entries ?? []).map((e) => [index.get(e.groupId), e.weight])]),
    settings: ['minDropRank', 'multiDropRank', 'tripleDropRank', 'soloDropRank', 'rewardLeftoverPolicy', 'targetEv', 'tier2UnlockRank', 'tier4UnlockRank', 'twisterSpinCost', 'twisterSpinObjective', 'listPhase'].map((key) => board[key] ?? null),
    rewardRanks: board.rewardRanks ?? [],
  }
}
// (The player's side gives every board of a list its first board's shared settings - normalizeBoards in App.jsx.)
const asPlayed = (list) => list.map((b) => playView({ ...b, ...Object.fromEntries(['rewardChainConfig', 'dropGroups', 'dropGroupsConfig', 'minDropRank', 'multiDropRank', 'tripleDropRank', 'soloDropRank', 'rewardLeftoverPolicy', 'targetEv', 'tier2UnlockRank', 'tier4UnlockRank', 'twisterSpinCost', 'twisterSpinObjective', 'rewardRanks'].map((key) => [key, list[0][key]])) }))
const samePlay = (list, back) => !!back && list.length === back.length && same(asPlayed(list), asPlayed(back))

// ---------------------------------------------------------------------------
// A small stage written out by hand: every kind of thing a link carries.
// ---------------------------------------------------------------------------
const tilesOf = (rows) => rows.map((row) => [...row].map((ch) => ({ o: 'open', b: 'blocked', s: 'semi' })[ch]))
const ladder = (values) => values.map((prizeAmount) => ({ prizeAmount, syntax: `x-${prizeAmount}`, displayName: 'not for play' }))
const R = (type, rank) => encodeReward(type, rank)
function handStage() {
  const shared = {
    minDropRank: 6,
    multiDropRank: null,
    rewardLeftoverPolicy: 'collect',
    targetEv: 1.1,
    tier2UnlockRank: 7,
    tier4UnlockRank: 10,
    twisterSpinCost: 15,
    twisterSpinObjective: null,
    rewardRanks: [4, 7, 10, 12],
    rewardChainConfig: { coins: ladder([0.04, 0.11, 0.24, 0.55]), puzzles: ladder([3, 9, 20, 50]), energy: ladder([5, 15, 35, 75]), charms: ladder([3, 9, 20, 50]), twister: ladder([2, 5, 12, 30]) },
    dropGroups: [
      { id: 'auto-coins', name: 'Coins', items: { coins: 1 }, auto: true },
      { id: 'auto-energy-twister', name: 'Energy and Twister', items: { energy: 1, twister: 1 }, auto: true },
      { id: 'auto-charms-twister', name: 'Charms and Twister', items: { charms: 3, twister: 2 }, auto: true },
      { id: 'typed', name: 'Typed by hand', items: { puzzles: 2 } },
      { id: 'auto-twister', name: 'Twister', items: { twister: 1 }, auto: true },
      { id: 'auto-three', name: 'Three', items: { puzzles: 3, charms: 3, energy: 1 }, auto: true },
    ],
    dropGroupsConfig: Array.from({ length: 14 }, (_, i) => {
      const rank = i + 1
      if (rank < 5) return { rank, noDropWeight: 100, entries: [], locked: false }
      if (rank === 5) return { rank, noDropWeight: 0, entries: [{ groupId: 'auto-twister', weight: 1000 }], locked: false, belowStart: true }
      if (rank === 6) return { rank, noDropWeight: 0, entries: [{ groupId: 'auto-coins', weight: 1000 }], locked: false }
      if (rank === 7) return { rank, noDropWeight: 0, entries: [{ groupId: 'auto-energy-twister', weight: 1000 }], locked: false }
      if (rank === 8) return { rank, noDropWeight: 100, entries: [{ groupId: 'auto-charms-twister', weight: 600 }, { groupId: 'typed', weight: 300 }], locked: false }
      return { rank, noDropWeight: 0, entries: [{ groupId: rank >= 10 ? 'auto-three' : 'auto-charms-twister', weight: 1000 }], locked: false }
    }),
  }
  const main = [
    {
      id: 'b1',
      name: 'Board 1',
      rows: 5,
      cols: 8,
      tiles: tilesOf(['oooooooo', 'oooooooo', 'osbssbso', 'obbbbbbo', 'obbbbbbo']),
      semiPlacements: [{ row: 2, col: 1, rank: 1 }, { row: 2, col: 6, rank: 1 }, { row: 2, col: 3, rank: 1 }, { row: 2, col: 4, rank: 2 }],
      blockedQueue: [1, 1, 2, 1, 1, 2, 1, 2, 2, 3, 3, 3, 4, 5, 7, 6],
      blockedValue: 150,
      buildStamp: { hash: 'not for play' },
      ...shared,
    },
    {
      id: 'b2',
      name: 'The wave',
      rows: 3,
      cols: 8,
      tiles: tilesOf(['oooooooo', 'bbsbbsbb', 'bbbbbbbb']),
      semiPlacements: [{ row: 1, col: 2, rank: 3 }, { row: 1, col: 5, rank: R('coins', 1) }],
      blockedQueue: [2, 3, R('coins', 1), 3, 5, R('coins', 2), 5, 6, R('puzzles', 1), 7, 6, R('charms', 2), 9, 7, 10, 11],
      blockedValue: 900,
      ...shared,
    },
  ]
  const rc = [
    {
      id: 'r1',
      name: 'Board 1',
      rows: 3,
      cols: 8,
      tiles: tilesOf(['oooooooo', 'bbsbbsbb', 'bbbbbbbb']),
      semiPlacements: [{ row: 1, col: 2, rank: 3 }, { row: 1, col: 5, rank: 4 }],
      blockedQueue: [3, 3, R('energy', 1), 4, 5, 6, R('charms', 1), 7, 7, 6, 8, 11, 12, 13],
      blockedValue: 300,
      ...shared,
      twisterSpinCost: 34,
      rewardRanks: [13, 14],
      rewardLeftoverPolicy: 'forfeit',
      listPhase: 'rc',
    },
  ]
  return { main, rc }
}
// The link of handStage(), written down on the day the short link was made
// (2026-11-22). NEVER REPLACE IT WITH A NEW ONE to make a check pass: it
// stands for every link that was ever sent. A new writing gets a second
// link beside this one.
const LINK_OF_THE_DAY = 'B3j9Tm1F9yNFLCrLjHPQD6R2ZmCVSGeFdJwGUfkTfpKXzwCQkcy9izoEtxdNJGVUXn94SzkYedFL84fj1saf5wKEhJqrtm0lWVCkYPx9qjjENsqAbhTYFpiZGmI54PYu17LCOt01nnPm9HnSSITfkG3hYX7GSVQE8gp9PLJpyVLKIkAp3AaU0Xc5DFuiulASHXwdmGLmP5dyzDSzctJajo'
const DICTIONARY_LENGTH = 3213
const DICTIONARY_MARK = 2693021158
const markOf = (text) => {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0
  return h
}

console.log('--- 1. The writing is frozen: a link of the day it was made still opens ---')
{
  const { main, rc } = handStage()
  const back = decodeStage(LINK_OF_THE_DAY)
  check('the link written down on the day the short link was made opens', !!back && back.boards.length === 2 && back.rcBoards?.length === 1)
  check('...as the same stage: tiles, items in sight, queue, values, containers, weights, ranks and prices, for both phases', samePlay(main, back?.boards) && samePlay(rc, back?.rcBoards))
  const now = encodeStage(main, { rcBoards: rc })
  check(`the dictionary a link is read with has not changed by a character (${STAGE_DICTIONARY.length} characters, mark ${markOf(STAGE_DICTIONARY)})`, STAGE_DICTIONARY.length === DICTIONARY_LENGTH && markOf(STAGE_DICTIONARY) === DICTIONARY_MARK)
  // (Reading is what must never change. If only this line fails after the compression library was updated, links
  // still open - say so in the history and add the new text beside the old one.)
  check(`the same stage is still written the same way today (${now.length} characters: ${now})`, now === LINK_OF_THE_DAY)
  check('a named board keeps its name, "Board N" is not written at all', back?.boards[1].name === 'The wave' && back?.boards[0].name === 'Board 1' && back?.rcBoards[0].name === 'Board 1')
  check('a container made by hand stays one made by hand; the others stay the build\'s', back?.boards[0].dropGroups[3].auto !== true && back?.boards[0].dropGroups.filter((g) => g.auto).length === 5)
  check('a container keeps its items in their own order (the order they land on the board in)', same(Object.keys(back?.boards[0].dropGroups[5].items ?? {}), ['puzzles', 'charms', 'energy']))
  check('the row under the start rank (the rank-5 Twister item) is still marked so', back?.boards[0].dropGroupsConfig[4].belowStart === true && back?.boards[0].dropGroupsConfig.filter((t) => t.belowStart).length === 1)
  check('Recompletion keeps its own price of a twist, its leftover rule and its mark', back?.rcBoards[0].twisterSpinCost === 34 && back?.rcBoards[0].rewardLeftoverPolicy === 'forfeit' && back?.rcBoards[0].listPhase === 'rc' && back?.boards[0].listPhase === undefined)
  check('the ranks that carry a reward travel (the marks on the ranks bar)', same(back?.boards[0].rewardRanks, [4, 7, 10, 12]) && same(back?.rcBoards[0].rewardRanks, [13, 14]))
  check('what play never reads does not travel: export syntax, names for the editor, the build stamp, the subsidy', back?.boards.every((b) => b.buildStamp === undefined && b.blockedValue === undefined && b.rewardChainConfig.puzzles.every((r) => r.syntax === undefined && r.displayName === undefined)))
}

console.log('--- 2. Every item has its character ---')
{
  const items = [...Array.from({ length: 14 }, (_, i) => i + 1), ...TYPES.flatMap((type) => [1, 2, 3, 4].map((rank) => R(type, rank)))]
  const board = { ...handStage().main[0], blockedQueue: items, semiPlacements: [{ row: 2, col: 1, rank: 14 }, { row: 2, col: 3, rank: R('charms', 4) }, { row: 2, col: 4, rank: R('twister', 1) }, { row: 2, col: 6, rank: 9 }] }
  const link = encodeStage([board])
  const back = decodeStage(link)
  check(`ranks 1 to 14 and every reward item (five rewards, four ranks) come back as they went, in the queue and in sight (${items.length} kinds)`, link.startsWith('B') && same(back?.boards[0].blockedQueue, items) && same(back?.boards[0].semiPlacements, board.semiPlacements))
  check('a stage with no Recompletion comes back with none', back?.rcBoards === null)
}

console.log('--- 3. A built event: short, and for play the same stage ---')
const layout = (list, id) => list.find((l) => l.id === id).tiles.map((row) => [...row])
function board(name, index, value, rc = false) {
  const tiles = index === 0 ? layout(FIRST_BOARD_LAYOUTS, 'three-rows') : layout(LATER_BOARD_LAYOUTS, index === 1 ? 'two-rows' : 'hanging-hill')
  let b = createBoard(name, { rows: tiles.length, cols: tiles[0].length })
  b.tiles = tiles
  b.blockedValue = value
  b = { ...b, minDropRank: 6, twisterByBuild: true, rewardRanks: rc ? [13, 14] : [4, 7, 10, 12], rewardChainConfig: withDefaultTwisterValues(withBlankCoinValues(b.rewardChainConfig)) }
  return rc ? withListPhase({ ...b, minRank: 3, maxRank: 13 }, 'rc') : b
}
const demand = 548
const mainBoards = [board('Board 1', 0, 150), board('Board 2', 1, 600), board('Board 3', 2, 750)]
const rcRest = 6144 - demand - 300
const rcBoards = [board('Board 1', 0, 300, true), board('Board 2', 1, Math.round(rcRest / 2), true), board('Board 3', 2, rcRest - Math.round(rcRest / 2), true)]
const raw = [{ name: 'Segment 1', mainBoards, rcBoards, rewardTargets: { main: { coins: 3, puzzles: 300, energy: 200, charms: 400 }, rc: { coins: 3, puzzles: 300, energy: 200, charms: 400 } }, segmentFactor: 1, sourceAllocation: {}, twisterPlan: { main: { targetSpins: 15, targetSpinsOverrides: {}, checkpointPct: 100 }, rc: { targetSpins: 10, targetSpinsOverrides: {}, checkpointPct: 100 } } }]
const mainDraft = await buildEvent({ phase: 'main', segments: segmentBuildInputs(raw, 'main') })
const rcDraft = await buildEvent({ phase: 'rc', segments: rcInputsOnMainDraft(raw, mainDraft) })
const main = boardsWithDraftApplied(mainBoards, mainDraft.segments[0], mainDraft.shared, { draft: mainDraft })
const rc = boardsWithDraftApplied(rcBoards, rcDraft.segments[0], rcDraft.shared, { draft: rcDraft })
const link = encodeStage(main, { rcBoards: rc })
const back = decodeStage(link)
// The same content in the writing before this one (format 2).
const SHARED_ONCE = ['rewardChainConfig', 'dropGroups', 'dropGroupsConfig', 'minDropRank', 'multiDropRank', 'tripleDropRank', 'soloDropRank', 'rewardLeftoverPolicy', 'twisterSpinCost', 'twisterSpinObjective', 'targetEv', 'tier2UnlockRank', 'tier4UnlockRank', 'rewardRanks', 'rewardSyntax', 'listPhase']
const NOT_SENT = ['smallRewardsBankConfig', 'smallRewardWeightsConfig', 'buildStamp', 'twisterCostBasis', 'onboardingStatus', 'effectiveBlockedValue', 'rewardQueueItems', 'rewardSemiItems', 'forcedSemiRanks', 'rewardTargets']
const packOld = (list) => {
  const shared = Object.fromEntries(SHARED_ONCE.filter((key) => key in list[0] && list.every((b) => same(b[key], list[0][key]))).map((key) => [key, list[0][key]]))
  return { shared, boards: list.map((b) => Object.fromEntries(Object.entries(b).filter(([key]) => !(key in shared) && !NOT_SENT.includes(key)))) }
}
const format2 = encodeToUrlParam({ v: 2, main: packOld(main), rc: packOld(rc) })
{
  check(`a built event - three boards, three Recompletion boards, rewards, drops, a Twister - is a link of ${link.length} characters (single build; under 330)`, link.length < 330)
  check(`...and its normal event alone ${encodeStage(main).length} characters (under 220)`, encodeStage(main).length < 220)
  check('a link is letters and digits only - nothing a chat app can end or wrap it at', /^[0-9A-Za-z]+$/.test(link) && /^[0-9A-Za-z]+$/.test(encodeStage(main)))
  check('read back, it is for play the stage that went in - both phases, every board', samePlay(main, back?.boards) && samePlay(rc, back?.rcBoards))
  const runs = []
  for (const robot of ['merger', 'tapsWhenItPays', 'mergesWithoutLooking']) {
    for (const seed of [11, 12]) {
      const figures = (stage) => {
        const out = playRun(stage, ROBOTS[robot], seed, { until: 'endless', endlessDr: 300 })
        return { stop: out.stop, main: out.main, rc: out.rc, final: out.final }
      }
      runs.push({ robot, seed, original: figures({ boards: main, rcBoards: rc }), linked: figures(back) })
    }
  }
  const first = runs[0].original
  check(`a robot on the real play engine plays the stage and its link to the same last item - normal event, Recompletion and endless, three kinds of player, two games each (the first: ${Math.round(first.final.drSpent)} DR, ${TYPES.map((t) => `${t} ${Math.round((first.final.collected[t] ?? 0) * 100) / 100}`).join(', ')})`, runs.every((r) => same(r.original, r.linked)))
  check('...and those games went all the way (rank 12, rank 14, endless)', runs.every((r) => r.original.main && r.original.rc && /^endless/.test(r.original.stop)))
}

console.log('--- 4. Every older writing of a link still opens ---')
{
  const oldBack = decodeStage(format2)
  check(`the writing before this one (format 2: ${format2.length} characters for the same event, ${(format2.length / link.length).toFixed(1)} times as long)`, format2.startsWith('A') && samePlay(main, oldBack?.boards) && samePlay(rc, oldBack?.rcBoards))
  const base64url = (value) => Buffer.from(gzipSync(strToU8(JSON.stringify(value)))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const older = decodeStage(base64url({ boards: main, rcBoards: rc, rcVariant: null }))
  check('the writing with "-" and "_" in it (whole boards, starts with H4sI)', base64url({ boards: main }).startsWith('H4sI') && samePlay(main, older?.boards) && samePlay(rc, older?.rcBoards))
  const oldest = decodeStage(base64url(main))
  check('the first links of all: a bare list of boards, no Recompletion', samePlay(main, oldest?.boards) && oldest?.rcBoards === null)
}

console.log('--- 5. A stage the short writing has no place for is still shared ---')
{
  const odd = main.map((b) => ({ ...b, dropGroups: [...b.dropGroups, { id: 'gems', name: 'Gems', items: { gems: 1 } }] }))
  const oddLink = encodeStage(odd, { rcBoards: rc })
  const oddBack = decodeStage(oddLink)
  check('a container holding a reward the short writing does not know: written the longer way, nothing lost', oddLink.startsWith('A') && oddBack?.boards[0].dropGroups.at(-1).items.gems === 1 && oddBack?.rcBoards.length === rc.length)
  const tall = [{ ...main[0], blockedQueue: [...main[0].blockedQueue, 40] }]
  check('an item with no character of its own (rank 40): the same', encodeStage(tall).startsWith('A') && decodeStage(encodeStage(tall))?.boards[0].blockedQueue.at(-1) === 40)
  const plain = [regenerateBoard({ ...createBoard('Board 1', { rows: 5, cols: 8 }), tiles: layout(FIRST_BOARD_LAYOUTS, 'pyramid'), blockedValue: 150 }, 0, 150, 0)]
  const plainLink = encodeStage(plain)
  check(`a stage with no rewards at all - boards only - is ${plainLink.length} characters and opens`, plainLink.startsWith('B') && plainLink.length < 150 && samePlay(plain, decodeStage(plainLink)?.boards))
}

console.log('--- 6. A link changed on the way is broken, never another stage ---')
{
  const expected = JSON.stringify([asPlayed(main), asPlayed(rc)])
  const reads = (text) => {
    const got = decodeStage(text)
    return got ? JSON.stringify([asPlayed(got.boards), got.rcBoards ? asPlayed(got.rcBoards) : null]) : null
  }
  check('a full stop after the link, or a line break or a space a chat app put inside it, does not break it', reads(`${link.slice(0, 80)}\n${link.slice(80, 160)} ${link.slice(160)}.`) === expected)
  check('half a link, the marker alone and nothing at all are broken links', decodeStage(link.slice(0, Math.floor(link.length / 2))) === null && decodeStage('B') === null && decodeStage('') === null && decodeStage(null) === null)
  const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  let broken = 0
  let unchanged = 0
  let another = 0
  for (let i = 0; i < link.length; i++) {
    for (const step of [1, 17, 40]) {
      const swapped = ALNUM[(ALNUM.indexOf(link[i]) + step) % ALNUM.length]
      const got = reads(link.slice(0, i) + swapped + link.slice(i + 1))
      if (got === null) broken += 1
      else if (got === expected) unchanged += 1
      else another += 1
    }
  }
  check(`one character changed, at every place of the link, three ways each (${link.length * 3} links): ${broken} read as broken, ${unchanged} still as the same stage, ${another} as another stage`, another === 0 && broken > link.length * 2)
  let dropped = 0
  for (let i = 1; i < link.length; i++) if (![null, expected].includes(reads(link.slice(0, i) + link.slice(i + 1)))) dropped += 1
  check('one character lost, at every place: never another stage', dropped === 0)
}

console.log(`\n${total - fails}/${total} checks passed`)
if (fails) process.exitCode = 1
