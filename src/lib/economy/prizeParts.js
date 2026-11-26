// A PRIZE AS PARTS (economist, 26 Nov 2026: "we need to have a better way to create the prizes. its too hard to just
// write syntax"): a prize text read into the parts a person picks - coins, the four resources, presets, a sticker pack,
// currencies, a chest - and written back from them with the Economy page's own builders (syntax.js, the order of 2.3).
// Anything the parts cannot hold (a trigger, a fallback written by hand) is kept as it was, at the end, so reading a
// text and writing it back never loses a piece.
import { formatReward, parseReward } from './parse'
import { RESOURCE_BY_TOKEN } from './economyModel'
import { coinsSyntax, counterSyntax, joinPlus, packSyntax, presetSyntax, resourceSyntax, syntaxNumber } from './syntax'

export const PRIZE_RESOURCES = [
  { id: 'wild', label: 'Wild' },
  { id: 'stock', label: 'Extra stock' },
  { id: 'undo', label: 'Undo' },
  { id: 'entry', label: 'Free round' },
]
export const emptyParts = () => ({ coins: null, bucket: '', wild: null, stock: null, undo: null, entry: null, presets: [], pack: '', packCoins: null, packCounter: true, currencies: [], chest: '', extra: [] })

const isCounter = (n) => n?.type === 'dynamic' && n.name === 'dr-pack-counter'
const isHidden = (n) => n?.type === 'dynamic' && n.name === 'dr-hidden'
const onlyHidden = (n) => isHidden(n) || (n?.type === 'first' && n.options.every(onlyHidden))

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
    if (n.type === 'allowance' && parts.coins == null) {
      parts.coins = Number(n.coins)
      parts.bucket = n.bucket ?? ''
    } else if (n.type === 'resource' && RESOURCE_BY_TOKEN[n.token] && parts[RESOURCE_BY_TOKEN[n.token].id] == null) {
      parts[RESOURCE_BY_TOKEN[n.token].id] = Number(n.amount)
    } else if (n.type === 'preset') {
      parts.presets.push(n.key)
    } else if (n.type === 'pack' && !parts.pack) {
      parts.pack = n.key
    } else if (n.type === 'first' && n.options[0]?.type === 'pack' && !parts.pack && n.options.slice(1).every((o) => o.type === 'allowance' || onlyHidden(o))) {
      parts.pack = n.options[0].key
      const alt = n.options.find((o) => o.type === 'allowance')
      parts.packCoins = alt ? Number(alt.coins) : null
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

// The parts -> the text, in the order of 2.3: coins, wild, extra stock, undo, free round, presets, [pack], [pack
// counter], [currencies], what was kept as it was; in a chest when one is named.
export function writePrize(parts) {
  const p = { ...emptyParts(), ...parts }
  const pack = p.pack ? packSyntax({ packKey: p.pack, allowance: p.packCoins != null && p.packCoins > 0 ? p.packCoins : null }) : ''
  const text = joinPlus(
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
