import { encodeToUrlParam, encodeCompactToUrlParam, decodeFromUrlParam } from './urlCodec'

// Packs a board list into a URL-safe string so a designed stage can be
// shared as a link (?s=...) rather than relying on localStorage, which is
// per-browser and wouldn't reach anyone else's device.
//
// The codec itself lives in urlCodec.js, shared with planShare.js's own
// "?plan=..." read-only link - this file supplies the stage-specific shape
// and validation and the MAX_SAFE_STAGE_CHARS warning threshold. Why a link
// must be short at all: GitHub Pages' Fastly CDN answers a flat HTTP 414
// above about 8KB of address (found live: a realistic multi-board stage made
// a link that never reached this app's code), and chat apps and phones cut
// long links off. fflate rather than the browser's CompressionStream because
// that only reached Safari in 16.4, and a link is meant to be opened on a
// phone.
//
// MAX_SAFE_STAGE_CHARS is the length from which App.jsx's handleShare warns.
// A link in today's writing is a few hundred characters; only a stage that
// cannot be written that way (see packCompactList) can come near it.
export const MAX_SAFE_STAGE_CHARS = 6000

// A stage is the playable main chain plus, when the sender chose one, the
// Recompletion it hands over to: { boards, rcBoards, rcVariant }.
//
// THE WRITINGS A LINK HAS HAD - every one of them still opens:
//   - a bare array of whole boards (the first links: main chain only);
//   - { boards, rcBoards, rcVariant } with whole boards;
//   - FORMAT 2, { v: 2, main, rc }: each list carries what its boards share
//     once (`shared`), each board only its own fields, and the editor-only
//     tables play never reads are left out (economist: "the link is broken
//     to everyone except me" - about 4,000 characters became 2,300);
//   - FORMAT 3, [3, main, rc, check] in the compact writing below: what a
//     link is written in today.
const SHARED_FIELDS = [
  'rewardChainConfig',
  'dropGroups',
  'dropGroupsConfig',
  'minDropRank',
  'multiDropRank',
  'tripleDropRank',
  'soloDropRank',
  'rewardLeftoverPolicy',
  'twisterSpinCost',
  'twisterSpinObjective',
  'targetEv',
  'tier2UnlockRank',
  'tier4UnlockRank',
  'rewardRanks',
  'rewardSyntax',
  'listPhase',
]
const LEFT_OUT = ['smallRewardsBankConfig', 'smallRewardWeightsConfig', 'buildStamp', 'twisterCostBasis', 'onboardingStatus', 'effectiveBlockedValue', 'rewardQueueItems', 'rewardSemiItems', 'forcedSemiRanks', 'rewardTargets']
function packList(list) {
  if (!Array.isArray(list) || list.length === 0) return null
  const shared = {}
  for (const key of SHARED_FIELDS) {
    if (!(key in list[0])) continue
    const first = JSON.stringify(list[0][key])
    if (list.every((b) => JSON.stringify(b[key]) === first)) shared[key] = list[0][key]
  }
  const boards = list.map((b) => {
    const own = {}
    for (const [key, value] of Object.entries(b)) {
      if (key in shared || LEFT_OUT.includes(key)) continue
      own[key] = value
    }
    return own
  })
  return { shared, boards }
}
const unpackList = (packed) => (packed && Array.isArray(packed.boards) ? packed.boards.map((b) => ({ ...(packed.shared ?? {}), ...b })) : null)

// THE SHORTEST LINK (format 3; economist: "i also want u to make sure the link
// of the stage as short as possible"). A link of format 2 for a built event -
// three boards, three Recompletion boards, rewards, drops, a Twister - was
// 2,339 characters; the same event is about 230 now, and a normal event alone
// about 150 (a second event, four boards a phase: 272 and 172). What was
// done, each step measured on those two events:
//   1. ONLY WHAT PLAY READS. A robot played the real play engine through the
//      normal event, Recompletion and endless mode on boards that wrote down
//      every field read, and the play screens were read for the rest: the
//      tiles, the items under them, the queue, the reward VALUES (not their
//      export syntax, asset names or what was typed before a build), what
//      each container drops and its weights, the drop and generator ranks,
//      the price of a twist, the ranks that carry a reward (the marks on the
//      ranks bar). Nothing else travels - the player's side fills in the rest
//      with defaults, as it does for any board (normalizeBoards in App.jsx,
//      which also gives every board of a list its first board's shared
//      settings: they are written once, from the first board).
//   2. BY POSITION, not by name. A list is
//        [settings, values, containers, weights, boards]
//      settings   [drop start rank, two-item rank, three-item rank,
//                  single-item rank, leftovers (1 collect, 0 forfeit),
//                  lucky-drop EV, x2 rank, x4 rank, price of a twist, spin
//                  objective, 1 for a Recompletion list, reward ranks]
//      values     one ladder a reward, in the order of PLAY_TYPES
//      containers one string each: a digit for the reward (its place in
//                 PLAY_TYPES) and a digit for the item's rank, for every
//                 item, in the container's own order; "m" in front of one
//                 made by hand
//      weights    one entry a merge rank: -1 nothing drops, a number =
//                 always that container (the usual case, "every merge of a
//                 rank drops the same items"), else [nothing-drops weight,
//                 1 for a row under the start rank, container, weight, ...]
//      boards     [name or 0 for "Board N", rows, columns, tiles, items in
//                  sight, queue] - tiles one letter a cell (o open, b
//                  blocked, s semi-blocked); an item in sight three
//                  characters (row, column, item); the queue one character
//                  an item (itemLetter below).
//      15,346 bytes of JSON became 876.
//   3. A DICTIONARY (STAGE_DICTIONARY): the layouts of the bank as this
//      writing spells them, the round value ladders a build gives and the
//      settings every stage has - so a link carries only what is its own
//      (366 characters became 227).
// A stage that has something this writing has no place for (a rank over 35,
// a board over 35 rows, a reward it does not know) is written in format 2,
// which carries anything.
//
// FROZEN, FOR GOOD: STAGE_DICTIONARY, the order of PLAY_TYPES, the letters
// and the positions above. A link made today has to open for as long as
// links are opened; changing one character of the dictionary makes every
// link ever sent unreadable. Anything new is a new format number (and, for a
// new dictionary, a new marker letter in urlCodec.js), with this one kept
// for reading. New layouts in the bank simply do not benefit from the
// dictionary. verify-stage-link.mjs holds a link written down on the day
// this was made, and the dictionary's fingerprint.
// A link in this writing opens only on a site that was deployed with it.
const PLAY_TYPES = ['coins', 'puzzles', 'energy', 'charms', 'twister']
const TILE_LETTER = { open: 'o', blocked: 'b', semi: 's' }
const LETTER_TILE = { o: 'open', b: 'blocked', s: 'semi' }
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'
export const STAGE_DICTIONARY = "[0,3,8,\"oooooooobbsbbsbbbbbbbbbb\",\"[0,3,8,\"bbsbbsbbbbbbbbbbbbbbbbbb\",\"[0,1,8,\"bbsbbsbb\",\"[0,3,8,\"oosbbsooobbbbbbobbbbbbbb\",\"[0,3,8,\"obbbbbboosbbbbsobbbbbbbb\",\"[0,3,8,\"oooooooobbbssbbbbbbbbbbb\",\"[0,3,8,\"bbbbbbbbbbsbbsbboooooooo\",\"[0,3,8,\"bbbbbbbbobbbbbbooosbbsoo\",\"[0,3,8,\"bbbbbbbbosbbbbsoobbbbbbo\",\"[0,5,8,\"ooooooooooobboooosbssbsoobbbbbboobbbbbbo\",\"211261231242\",\"[0,5,8,\"ooooooooobbbbbboosbssbsoobbbbbboobbbbbbo\",\"211261231242\",\"[0,5,8,\"oooooooooobbbbooosbssbsoobbbbbboobbbbbbo\",\"211261231242\",\"[0,5,8,\"ooobbooooobbbbooosbssbsoobbbbbboobbbbbbo\",\"211261231242\",\"[0,5,8,\"ooobboooooobboooosbssbsoobbbbbboobbbbbbo\",\"211261231242\",\"[0,5,8,\"oooooooooooooooobsbssbsbobbbbbboobbbbbbo\",\"211231242261\",\"[0,5,8,\"oooooooooobbbboobsbssbsbobbbbbboobbbbbbo\",\"211261231242\",\"[0,5,8,\"bbbbbbbbbbbbbbbbbsbssbsboooooooooooooooo\",\"211231242261\",\"[0,5,8,\"bbbbbbbbbbbbbbbbosbssbsooooooooooooooooo\",\"211231242261\",\"[0,5,8,\"bbbbbbbbobbbbbboosbssbsooooooooooooooooo\",\"211231242261\",\"[0,5,8,\"bbbbbbbbbsbbbbsboobssboooooooooooooooooo\",\"111161231242\",\"[0,5,8,\"bbbbbbbbosbbbbsooobssbooooobbooooooooooo\",\"111161231242\",\"[0,5,8,\"bsbbbbsboobbbboooobssboooobbbboooooooooo\",\"011061231242\",\"[0,5,8,\"oooosbbbooobbbbooobssbooobbbbooobbbsoooo\",\"041431231242\",\"[0,5,8,\"ooooooooooobbooobsbssbsbobbbbbboobbbbbbo\",\"211261231242\",\"[0,5,8,\"ooobboooooobbooobsbssbsbobbbbbbooobbbboo\",\"211261231242\",\"[0,5,8,\"ooobboooobbbbbboosbssbsoobbbbbbooooooooo\",\"211261231242\",\"[0,5,8,\"ooobbooobbbbbbbbosbssbsoobbbbbbooooooooo\",\"211261231242\",\"\"213263233243\",\"\"213233243263\",\"\"113163233243\",\"\"013063233243\",\"\"043433233243\",\"33333444445555666777888999aaabbbcccAAAABAABBA111111112222223333444556677889[0.12,0.3,0.67,1.5],[0.12,0.29,0.65,1.45],[0.11,0.28,0.63,1.4],[0.11,0.27,0.6,1.35],[0.1,0.26,0.58,1.3],[0.1,0.25,0.56,1.25],[0.1,0.24,0.54,1.2],[0.09,0.23,0.51,1.15],[0.09,0.22,0.49,1.1],[0.08,0.21,0.47,1.05],[0.08,0.2,0.45,1],[0.07,0.19,0.42,0.95],[0.07,0.18,0.4,0.9],[0.07,0.17,0.38,0.85],[0.06,0.16,0.36,0.8],[0.06,0.15,0.33,0.75],[0.05,0.14,0.31,0.7],[0.05,0.13,0.29,0.65],[0.05,0.12,0.27,0.6],[0.04,0.11,0.24,0.55],[0.04,0.1,0.22,0.5],[0.03,0.09,0.2,0.45],[0.03,0.08,0.18,0.4],[0.02,0.07,0.15,0.35],[0.02,0.06,0.13,0.3],[0.02,0.05,0.11,0.25],[0.01,0.04,0.09,0.2],[0.012,0.03,0.067,0.15],[10,40,90,200],[10,35,90,195],[10,35,85,190],[10,35,85,185],[10,35,80,180],[10,35,80,175],[10,30,75,170],[10,30,75,165],[10,30,70,160],[10,30,70,155],[10,30,70,150],[9,25,65,145],[9,25,65,140],[9,25,60,135],[8,25,60,130],[8,25,55,125],[8,20,55,120],[7,20,50,115],[7,20,50,110],[7,20,45,105],[6,20,45,100],[6,15,40,95],[6,15,40,90],[5,15,35,85],[5,15,35,80],[5,15,35,75],[4,10,30,70],[4,10,30,65],[4,10,25,60],[3,10,25,55],[3,9,20,50],[3,9,20,45],[2,7,15,40],[2,7,15,35],[1,4,10,30],[1,4,10,25],[1,4,9,20],[1,3,7,15],[5,15,15,40],[5,10,30,40],[2,5,12,30]]],[\"01\",\"11\",\"21\",\"31\",\"0141\",\"1141\",\"2141\",\"3141\",\"1241\",\"2241\",\"3241\",\"1341\",\"2341\",\"3341\",\"3342\",\"311121\",\"321121\",\"321122\",\"133321\",\"133221\",\"123221\",\"113121\",\"410121\",\"014131\",\"42\",\"41\"],[-1,-1,-1,-1,-1,[0,1,6,1000],0,1,2,3,4,5,6,7,8,9],[[[-1,-1,-1,-1,[0,1,7,1000],0,1,2,3,4,5,4,6,7,8,9],null,1,[13,14]],[[0.0]]],[[6,null,null,null,1,1.1,7,10,,null,0,[]],[[0.0,null,0,[4,7,10,12]],[[0.0[3,[[6,null,null,null,1,1.1,7,10,"

// An item as one character: a main-chain rank is its digit in base 36 (1-9,
// then a = 10 ... e = 14), a reward item a capital letter (four a reward, by
// rank: A-D coins, E-H puzzles, I-L merge energy, M-P charms, Q-T Twister DR).
// A reward item is 1000 + 10 x reward + rank on a board (encodeReward); the
// letter is worked out from the number, not from a list of names.
function itemLetter(value) {
  if (!Number.isInteger(value)) return null
  if (value >= 1 && value < DIGITS.length) return DIGITS[value]
  const reward = Math.floor((value - 1000) / 10)
  const rank = (value - 1000) % 10
  return reward >= 0 && reward < 6 && rank >= 1 && rank <= 4 ? String.fromCharCode(65 + reward * 4 + rank - 1) : null
}
function itemOf(letter) {
  const code = letter.charCodeAt(0)
  if (code >= 65 && code < 65 + 24) return 1000 + Math.floor((code - 65) / 4) * 10 + ((code - 65) % 4) + 1
  const rank = DIGITS.indexOf(letter)
  if (rank < 1) throw new Error('not an item')
  return rank
}

// A list in the compact form, or null when something in it has no place there.
function packCompactList(list) {
  if (!Array.isArray(list) || list.length === 0) return null
  const first = list[0]
  const groups = first.dropGroups ?? []
  const tables = first.dropGroupsConfig ?? []
  const groupIndex = new Map(groups.map((g, i) => [g.id, i]))
  const itemsOf = (g) => Object.entries(g.items ?? {}).filter(([, rank]) => rank != null)
  const fits =
    groupIndex.size === groups.length &&
    groups.every((g) => itemsOf(g).every(([type, rank]) => PLAY_TYPES.includes(type) && Number.isInteger(rank) && rank >= 1 && rank <= 9)) &&
    tables.every((t, i) => (t.rank == null || t.rank === i + 1) && (t.entries ?? []).every((e) => groupIndex.has(e.groupId) && Number.isFinite(e.weight))) &&
    list.every(
      (b) =>
        Number.isInteger(b.rows) &&
        Number.isInteger(b.cols) &&
        b.rows < DIGITS.length &&
        b.cols < DIGITS.length &&
        Array.isArray(b.tiles) &&
        b.tiles.length === b.rows &&
        b.tiles.every((row) => Array.isArray(row) && row.length === b.cols && row.every((t) => TILE_LETTER[t])) &&
        (b.semiPlacements ?? []).every((p) => Number.isInteger(p.row) && Number.isInteger(p.col) && p.row >= 0 && p.col >= 0 && p.row < b.rows && p.col < b.cols && itemLetter(p.rank)) &&
        (b.blockedQueue ?? []).every((item) => itemLetter(item)),
    )
  if (!fits) return null
  const leftover = first.rewardLeftoverPolicy
  return [
    [
      first.minDropRank ?? null,
      first.multiDropRank ?? null,
      first.tripleDropRank ?? null,
      first.soloDropRank ?? null,
      leftover === 'forfeit' ? 0 : leftover === 'collect' ? 1 : (leftover ?? null),
      first.targetEv ?? null,
      first.tier2UnlockRank ?? null,
      first.tier4UnlockRank ?? null,
      first.twisterSpinCost ?? null,
      first.twisterSpinObjective ?? null,
      first.listPhase === 'rc' ? 1 : 0,
      Array.isArray(first.rewardRanks) ? first.rewardRanks : [],
    ],
    PLAY_TYPES.map((type) => (first.rewardChainConfig?.[type] ?? []).map((r) => r?.prizeAmount ?? null)),
    groups.map((g) => (g.auto ? '' : 'm') + itemsOf(g).map(([type, rank]) => `${PLAY_TYPES.indexOf(type)}${rank}`).join('')),
    tables.map((t) => {
      const entries = t.entries ?? []
      if (!t.belowStart && entries.length === 0 && t.noDropWeight === 100) return -1
      if (!t.belowStart && entries.length === 1 && entries[0].weight === 1000 && (t.noDropWeight ?? 0) === 0) return groupIndex.get(entries[0].groupId)
      return [t.noDropWeight ?? 0, t.belowStart ? 1 : 0, ...entries.flatMap((e) => [groupIndex.get(e.groupId), e.weight])]
    }),
    list.map((b, i) => [
      b.name === `Board ${i + 1}` ? 0 : (b.name ?? 0),
      b.rows,
      b.cols,
      b.tiles.map((row) => row.map((t) => TILE_LETTER[t]).join('')).join(''),
      (b.semiPlacements ?? []).map((p) => DIGITS[p.row] + DIGITS[p.col] + itemLetter(p.rank)).join(''),
      (b.blockedQueue ?? []).map(itemLetter).join(''),
    ]),
  ]
}
// The boards of a compact list, whole again. Throws on anything that is not
// one (decodeStage reads that as a broken link).
function unpackCompactList(packed, listName) {
  if (!Array.isArray(packed) || packed.length < 5) throw new Error('not a list')
  const [settings, values, groups, tables, boards] = packed
  const [minDropRank, multiDropRank, tripleDropRank, soloDropRank, leftover, targetEv, tier2UnlockRank, tier4UnlockRank, twisterSpinCost, twisterSpinObjective, isRc, rewardRanks] = settings
  const idOf = (index) => {
    if (!Number.isInteger(index) || index < 0 || index >= groups.length) throw new Error('no such container')
    return `g${index}`
  }
  const shared = {
    rewardChainConfig: Object.fromEntries(PLAY_TYPES.map((type, i) => [type, (values[i] ?? []).map((prizeAmount) => ({ prizeAmount }))]).filter(([, ladder]) => ladder.length > 0)),
    dropGroups: groups.map((text, i) => {
      const byHand = text.startsWith('m')
      const pairs = byHand ? text.slice(1) : text
      const items = {}
      for (let k = 0; k + 1 < pairs.length; k += 2) {
        const type = PLAY_TYPES[Number(pairs[k])]
        if (!type) throw new Error('no such reward')
        items[type] = Number(pairs[k + 1])
      }
      return { id: idOf(i), name: `Container ${i + 1}`, items, ...(byHand ? {} : { auto: true }) }
    }),
    dropGroupsConfig: tables.map((t, i) => {
      if (t === -1) return { rank: i + 1, noDropWeight: 100, entries: [], locked: false }
      if (!Array.isArray(t)) return { rank: i + 1, noDropWeight: 0, entries: [{ groupId: idOf(t), weight: 1000 }], locked: false }
      const entries = []
      for (let k = 2; k + 1 < t.length; k += 2) entries.push({ groupId: idOf(t[k]), weight: t[k + 1] })
      return { rank: i + 1, noDropWeight: t[0], entries, locked: false, ...(t[1] ? { belowStart: true } : {}) }
    }),
    rewardRanks: Array.isArray(rewardRanks) ? rewardRanks : [],
  }
  // (A setting that was not there is not written back as "none": the player's side has its own defaults.)
  const settingsBack = { minDropRank, multiDropRank, tripleDropRank, soloDropRank, rewardLeftoverPolicy: leftover === 0 ? 'forfeit' : leftover === 1 ? 'collect' : leftover, targetEv, tier2UnlockRank, tier4UnlockRank, twisterSpinCost, twisterSpinObjective }
  for (const [key, value] of Object.entries(settingsBack)) if (value != null) shared[key] = value
  if (isRc) shared.listPhase = 'rc'
  if (!Array.isArray(boards) || boards.length === 0) throw new Error('no boards')
  return boards.map(([name, rows, cols, tileText, semi, queue], i) => {
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || tileText.length !== rows * cols || semi.length % 3 !== 0) throw new Error('not a board')
    const tiles = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => {
        const state = LETTER_TILE[tileText[r * cols + c]]
        if (!state) throw new Error('not a tile')
        return state
      }),
    )
    const semiPlacements = []
    for (let k = 0; k < semi.length; k += 3) semiPlacements.push({ row: DIGITS.indexOf(semi[k]), col: DIGITS.indexOf(semi[k + 1]), rank: itemOf(semi[k + 2]) })
    return { id: `stage-${listName}-${i + 1}`, name: name === 0 ? `Board ${i + 1}` : name, rows, cols, tiles, semiPlacements, blockedQueue: [...queue].map(itemOf), ...shared }
  })
}
// A small check carried inside the link: this writing has no checksum of its
// own, and a link that was changed on the way must read as broken, never as
// another stage.
function checkOf(value) {
  const text = JSON.stringify(value)
  let h = 7
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 3844
  return h
}

export function encodeStage(boards, { rcBoards = null } = {}) {
  const main = packCompactList(boards)
  const rc = rcBoards && rcBoards.length ? packCompactList(rcBoards) : 0
  if (main && rc !== null) return encodeCompactToUrlParam([3, main, rc, checkOf([main, rc])], STAGE_DICTIONARY)
  return encodeToUrlParam({ v: 2, main: packList(boards), rc: rcBoards && rcBoards.length ? packList(rcBoards) : null })
}

// Returns { boards, rcBoards, rcVariant } (rcBoards null for a main-only
// stage), or null on anything malformed rather than throwing - callers
// treat null as "this link is broken", never as "no stage was shared".
export function decodeStage(encoded) {
  const compact = (v) => Array.isArray(v) && v[0] === 3
  const decoded = decodeFromUrlParam(encoded, {
    dictionaryText: STAGE_DICTIONARY,
    validate: (v) =>
      compact(v)
        ? // (At least four parts, a list at least five, settings at least twelve: whatever a later site adds
          // after them is not read here, and its link still opens.)
          v.length >= 4 && checkOf([v[1], v[2]]) === v[3] && unpackCompactList(v[1], 'main').length > 0 && (v[2] === 0 || unpackCompactList(v[2], 'rc').length > 0)
        : Array.isArray(v)
          ? v.length > 0
          : v?.v === 2
            ? (unpackList(v.main)?.length ?? 0) > 0
            : Array.isArray(v?.boards) && v.boards.length > 0,
  })
  if (!decoded) return null
  if (compact(decoded)) return { boards: unpackCompactList(decoded[1], 'main'), rcBoards: decoded[2] ? unpackCompactList(decoded[2], 'rc') : null, rcVariant: null }
  if (decoded.v === 2) {
    const rc = unpackList(decoded.rc)
    return { boards: unpackList(decoded.main), rcBoards: rc && rc.length ? rc : null, rcVariant: null }
  }
  if (Array.isArray(decoded)) return { boards: decoded, rcBoards: null, rcVariant: null }
  return { boards: decoded.boards, rcBoards: Array.isArray(decoded.rcBoards) && decoded.rcBoards.length ? decoded.rcBoards : null, rcVariant: decoded.rcVariant ?? null }
}
