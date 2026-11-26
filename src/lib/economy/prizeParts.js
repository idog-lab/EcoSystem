// A PRIZE AS PARTS (economist, 26 Nov 2026: "we need to have a better way to create the prizes. its too hard to just
// write syntax"): a prize text read into the parts a person picks - coins, the four resources, presets, a sticker pack,
// currencies, a chest - and written back from them with the Economy page's own builders (syntax.js, the order of 2.3).
// Anything the parts cannot hold (a trigger, a fallback written by hand) is kept as it was, at the end, so reading a
// text and writing it back never loses a piece.
import { formatReward, parseReward } from './parse'
import { RESOURCE_BY_TOKEN } from './economyModel'
import { coinsSyntax, counterSyntax, joinPlus, packSyntax, presetSyntax, resourceSyntax, syntaxNumber, triggerSyntax } from './syntax'

export const PRIZE_RESOURCES = [
  { id: 'wild', label: 'Wild' },
  { id: 'stock', label: 'Extra stock' },
  { id: 'undo', label: 'Undo' },
  { id: 'entry', label: 'Free round' },
]
export const emptyParts = () => ({ triggers: [], coins: null, bucket: '', wild: null, stock: null, undo: null, entry: null, presets: [], pack: '', packAlt: null, packCoins: null, packCounter: true, currencies: [], chest: '', extra: [] })

// FALLBACKS (economist, 26 Nov 2026: "we need to have fallbacks for puzzle mini game and packs"): what the player gets
// when the first cannot be had. A sticker pack's is written [sticker_pack:...|<fallback>]; a puzzle's or a mini game's is
// in the preset's own name ("the puzzle and mini game has the fallback logic in the text of the preset":
// puzzle_gameplay_20_undo, mini_game_5_gameplay_wild) - never [preset:...|...], which the validator refuses. A fallback is a core resource
// (the economy's rule: "any core resource can be the last fallback. coins, undo, free round, extra stock, wild") or the
// hidden one, [dynamic(dr-hidden:1)], as in the economist's export. { kind, amount }.
export const FALLBACK_KINDS = [
  { value: 'coins', label: 'Coins' },
  { value: 'wild', label: 'Wild' },
  { value: 'stock', label: 'Extra stock' },
  { value: 'undo', label: 'Undo' },
  { value: 'entry', label: 'Free round' },
  { value: 'hidden', label: 'Hidden' },
]
// A fallback's text; '' when it has no amount (a hidden one needs none).
export function fallbackText(alt) {
  if (!alt?.kind) return ''
  if (alt.kind === 'hidden') return '[dynamic(dr-hidden:1)]'
  if (alt.kind === 'coins') return coinsSyntax(alt.amount)
  return resourceSyntax(alt.kind, alt.amount)
}
// A node -> a fallback, or null when it is not one.
function fallbackOf(n) {
  if (!n) return null
  if (n.type === 'allowance' && !n.bucket) return { kind: 'coins', amount: Number(n.coins) }
  if (n.type === 'resource' && RESOURCE_BY_TOKEN[n.token]) return { kind: RESOURCE_BY_TOKEN[n.token].id, amount: Number(n.amount) }
  if (onlyHidden(n)) return { kind: 'hidden', amount: null }
  return null
}

const isCounter = (n) => n?.type === 'dynamic' && n.name === 'dr-pack-counter'
const isHidden = (n) => n?.type === 'dynamic' && n.name === 'dr-hidden'
function onlyHidden(n) {
  return isHidden(n) || (n?.type === 'first' && n.options.every(onlyHidden))
}

// A text -> its parts. { parts, readable } - readable false when the text cannot be read at all (it is then kept whole
// in `extra`).
export function readPrize(text) {
  const parts = emptyParts()
  const src = String(text ?? '').trim()
  if (!src) return { parts, readable: true }
  const { node } = parseReward(src)
  if (!node) return { parts: { ...parts, extra: [src] }, readable: false }
  let inner = node
  if (node.type === 'chest') {
    parts.chest = node.name
    inner = node.inner
  }
  const list = inner.type === 'all' ? inner.parts : [inner]
  for (const n of list) {
    if (n.type === 'trigger') {
      parts.triggers.push(n.name)
    } else if (n.type === 'allowance' && parts.coins == null) {
      parts.coins = Number(n.coins)
      parts.bucket = n.bucket ?? ''
    } else if (n.type === 'resource' && RESOURCE_BY_TOKEN[n.token] && parts[RESOURCE_BY_TOKEN[n.token].id] == null) {
      parts[RESOURCE_BY_TOKEN[n.token].id] = Number(n.amount)
    } else if (n.type === 'preset') {
      parts.presets.push(n.key)
    } else if (n.type === 'pack' && !parts.pack) {
      parts.pack = n.key
    } else if (n.type === 'first' && n.options[0]?.type === 'pack' && !parts.pack && n.options.length <= 2 && (n.options.length === 1 || fallbackOf(n.options[1]))) {
      // A pack with its fallback: [sticker_pack:...|<fallback>].
      parts.pack = n.options[0].key
      parts.packAlt = n.options.length === 2 ? fallbackOf(n.options[1]) : null
      parts.packCoins = parts.packAlt?.kind === 'coins' ? parts.packAlt.amount : null
    } else if (n.type === 'first' && isCounter(n.options[0]) && n.options.slice(1).every(onlyHidden)) {
      parts.packCounter = true
    } else if (n.type === 'dynamic' && !isHidden(n) && !isCounter(n)) {
      parts.currencies.push({ name: n.name, amount: Number(n.amount) })
    } else if (n.type === 'first' && n.options[0]?.type === 'dynamic' && !isCounter(n.options[0]) && n.options.length === 1) {
      parts.currencies.push({ name: n.options[0].name, amount: Number(n.options[0].amount) })
    } else {
      parts.extra.push(formatReward(n))
    }
  }
  // A pack with no counter written has none.
  if (parts.pack && !list.some((n) => n.type === 'first' && isCounter(n.options[0]))) parts.packCounter = false
  return { parts, readable: true }
}

// The parts -> the text, in the order of 2.3: triggers, coins, wild, extra stock, undo, free round, presets, [pack], [pack
// counter], [currencies], what was kept as it was; in a chest when one is named.
export function writePrize(parts) {
  const p = { ...emptyParts(), ...parts }
  // The pack's fallback: the one picked, or (from the prize builder) coins.
  const packAlt = p.packAlt?.kind ? p.packAlt : p.packCoins != null && p.packCoins > 0 ? { kind: 'coins', amount: p.packCoins } : null
  const packAltText = fallbackText(packAlt)
  const pack = p.pack ? (packAltText ? `[sticker_pack:${p.pack}|${packAltText}]` : packSyntax({ packKey: p.pack })) : ''
  const text = joinPlus(
    p.triggers.map(triggerSyntax),
    coinsSyntax(p.coins, { bucket: p.bucket || '' }),
    resourceSyntax('wild', p.wild),
    resourceSyntax('stock', p.stock),
    resourceSyntax('undo', p.undo),
    resourceSyntax('entry', p.entry),
    p.presets.map(presetSyntax),
    pack,
    pack && p.packCounter ? counterSyntax('dr-pack-counter') : '',
    p.currencies.filter((c) => c.name && Number(c.amount) >= 1).map((c) => `[dynamic(${c.name}:${syntaxNumber(c.amount)})]`),
    p.extra,
  )
  return text && p.chest ? `chest:${p.chest}(${text})` : text
}

// THE PRESETS OF A PRIZE BY KIND, for a table with a column each (economist: "in the table the core resources, with
// presets and stickers options, puzzle and mini games"): the puzzle preset (puzzle_gameplay_<n>), the mini game preset
// (mini_game_<n>_gameplay_<kind>), and the others. The first of each kind is its column's; a second one of a kind stays
// with the others.
// (A puzzle preset may end in its fallback: puzzle_gameplay_20_undo.)
const PUZZLE = /^puzzle_gameplay_(\d+)(?:_([a-z]+))?$/
const MINI = /^mini_game_(\d+)_gameplay_([a-z]+)$/
export function presetsByKind(presets = []) {
  let puzzle = null
  let mini = null
  const others = []
  for (const key of presets) {
    const p = key.match(PUZZLE)
    const m = key.match(MINI)
    if (p && !puzzle) puzzle = { key, amount: Number(p[1]), fallback: p[2] ?? '' }
    else if (m && !mini) mini = { key, amount: Number(m[1]), kind: m[2] }
    else others.push(key)
  }
  return { puzzle, mini, others }
}
// The presets again from their kinds (puzzle first, then the mini game, then the others).
export const presetsFromKinds = ({ puzzle = null, mini = null, others = [] }) => [puzzle?.key, mini?.key, ...others].filter(Boolean)
