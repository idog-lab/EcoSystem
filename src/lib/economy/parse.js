// READING AND CHECKING REWARD TEXT (economist, section 7): balanced () and [],
// known kinds of item, known keys, whole resource amounts, amounts of at least
// 1, no empty "|" or "+" parts, no spaces. format(parse(x)) gives x back, so a
// text can be read, checked and written again without changing it.
//
// Two kinds of finding:
//   error    the game cannot read it, or the economist's rules forbid it
//   warning  readable, but a key is not on the Economy page's list (it may
//            exist in the game: check it or add it), or the name is this
//            app's own
// The order of the parts is never a finding.

import { RESOURCE_BY_TOKEN, findCurrency, findKey, isKnownPreset, currencyValue, hasDatedValues, presetValue } from './economyModel'

const NUMBER = /^-?\d+(?:\.\d+)?$/
const DR_NAME = /^dr-[a-z0-9]+(?:-[a-z0-9]+)*$/
const KEY = /^[A-Za-z0-9_\-.]+$/

// --- Parsing ------------------------------------------------------------------

// { node, issues } - node is null for an empty text.
export function parseReward(text, options = {}) {
  const s = String(text ?? '')
  const issues = []
  const add = (level, message, code) => issues.push({ level, message, code })
  if (s.trim() === '') return { node: null, issues }
  if (/\s/.test(s)) add('error', 'There is a space in it. Reward text has no spaces.', 'space')
  if (/\d,\d/.test(s) && !/(Missing|Duplicate)\(/.test(s)) add('error', 'A decimal is written with a comma. Use a point.', 'comma-decimal')
  const src = s.replace(/\s+/g, '')
  const p = { s: src, i: 0, add }
  let node = null
  try {
    node = parseAll(p, '')
    if (p.i < src.length) {
      add('error', `"${src[p.i]}" has nothing to close or open (at character ${p.i + 1}).`, 'unbalanced')
    }
  } catch (e) {
    add('error', e.message, 'unbalanced')
    node = null
  }
  if (node) validate(node, options, add)
  return { node, issues }
}

class ParseStop extends Error {}

function parseAll(p, closers) {
  const parts = []
  for (;;) {
    if (p.i >= p.s.length || closers.includes(p.s[p.i])) {
      p.add('error', parts.length ? 'A "+" with nothing after it.' : closers ? 'An empty part inside brackets.' : 'Nothing to read.', 'empty-part')
      break
    }
    if (p.s[p.i] === '+') {
      p.add('error', 'A "+" with nothing before it.', 'empty-part')
      p.i++
      continue
    }
    parts.push(parsePart(p))
    if (p.s[p.i] === '+') {
      p.i++
      continue
    }
    break
  }
  return parts.length === 1 ? parts[0] : { type: 'all', parts }
}

function parsePart(p) {
  if (p.s[p.i] === '[') {
    p.i++
    const options = []
    for (;;) {
      options.push(parseAll(p, '|]'))
      if (p.s[p.i] === '|') {
        p.i++
        continue
      }
      if (p.s[p.i] === ']') {
        p.i++
        break
      }
      throw new ParseStop('A "[" is never closed with "]".')
    }
    return { type: 'first', options }
  }
  const start = p.i
  while (p.i < p.s.length && !'(+|])['.includes(p.s[p.i])) p.i++
  const head = p.s.slice(start, p.i)
  if (p.s[p.i] === '(') {
    if (/^chest:/.test(head)) {
      p.i++
      const inner = parseAll(p, ')')
      if (p.s[p.i] !== ')') throw new ParseStop(`The chest "${head.slice(6)}" is never closed with ")".`)
      p.i++
      return { type: 'chest', name: head.slice(6), inner }
    }
    const open = p.i
    p.i++
    while (p.i < p.s.length && p.s[p.i] !== ')' && p.s[p.i] !== '(') p.i++
    if (p.s[p.i] !== ')') throw new ParseStop(`"${head}(" is never closed with ")".`)
    p.i++
    return atom(head + p.s.slice(open, p.i), p)
  }
  if (head === '') {
    const c = p.s[p.i]
    if (c === '(' || c === ')' || c === ']') throw new ParseStop(`"${c}" has nothing to close or open (at character ${p.i + 1}).`)
    return { type: 'unknown', text: '' }
  }
  return atom(head, p)
}

function atom(text) {
  let m
  if ((m = text.match(/^allowance(?::([^()]*))?\(coins:([^()]*)\)$/))) return { type: 'allowance', bucket: m[1] ?? null, coins: m[2] }
  if ((m = text.match(/^(free_wild|free_stock|free_undo|free_entry):(.*)$/))) return { type: 'resource', token: m[1], amount: m[2] }
  if ((m = text.match(/^dynamic\(([^:()]*):([^()]*)\)$/))) return { type: 'dynamic', name: m[1], amount: m[2] }
  if ((m = text.match(/^sticker_pack:(.*)$/))) return { type: 'pack', key: m[1] }
  if ((m = text.match(/^preset:(.*)$/))) return { type: 'preset', key: m[1] }
  if ((m = text.match(/^trigger:(.*)$/))) return { type: 'trigger', name: m[1] }
  if ((m = text.match(/^(Missing|Duplicate)\(([^,()]*),([^()]*)\)$/))) return { type: 'draw', fn: m[1], bucket: m[2], index: m[3] }
  return { type: 'unknown', text }
}

// --- Writing back --------------------------------------------------------------

export function formatReward(node) {
  if (!node) return ''
  switch (node.type) {
    case 'all':
      return node.parts.map(formatReward).join('+')
    case 'first':
      return `[${node.options.map(formatReward).join('|')}]`
    case 'allowance':
      return node.bucket != null ? `allowance:${node.bucket}(coins:${node.coins})` : `allowance(coins:${node.coins})`
    case 'resource':
      return `${node.token}:${node.amount}`
    case 'dynamic':
      return `dynamic(${node.name}:${node.amount})`
    case 'pack':
      return `sticker_pack:${node.key}`
    case 'preset':
      return `preset:${node.key}`
    case 'trigger':
      return `trigger:${node.name}`
    case 'chest':
      return `chest:${node.name}(${formatReward(node.inner)})`
    case 'draw':
      return `${node.fn}(${node.bucket},${node.index})`
    default:
      return node.text ?? ''
  }
}

// --- Checking ------------------------------------------------------------------

// options: { economy, coinDecimals (2; Merge Mania's small rewards 3) }
function validate(node, options, add) {
  const economy = options.economy ?? null
  const coinDecimals = options.coinDecimals ?? 2
  const seen = new Set()
  const once = (level, message, code) => {
    if (seen.has(message)) return
    seen.add(message)
    add(level, message, code)
  }
  const walk = (n) => {
    switch (n.type) {
      case 'all':
        n.parts.forEach(walk)
        break
      case 'first':
        n.options.forEach(walk)
        break
      case 'chest':
        // (A chest's name is typed by the economist - "let me put the name" - so one off the list is not named. A
        // name with characters a key never has is.)
        if (!n.name) once('error', 'A chest with no name.', 'chest-name')
        else if (!KEY.test(n.name)) once('error', `The chest "${n.name}": a name is letters, digits, "-", "_" or ".".`, 'chest-name')
        walk(n.inner)
        break
      case 'allowance': {
        if (!NUMBER.test(n.coins)) once('error', `allowance(coins:${n.coins}): the coins are not a number.`, 'not-a-number')
        else {
          if (!(Number(n.coins) > 0)) once('error', `allowance(coins:${n.coins}): coins of 0 or less.`, 'amount-below-1')
          const decimals = (n.coins.split('.')[1] ?? '').length
          if (decimals > coinDecimals) once('warning', `allowance(coins:${n.coins}): ${decimals} decimals - coins are written with ${coinDecimals}.`, 'coin-decimals')
        }
        if (n.bucket != null) {
          if (!n.bucket || !KEY.test(n.bucket)) once('error', 'allowance: with no bucket name.', 'bucket-name')
          else if (economy && !findKey(economy, 'buckets', n.bucket)) once('warning', `The allowance bucket "${n.bucket}" is not on the Economy page's list.`, 'unknown-key')
        }
        break
      }
      case 'resource': {
        const label = RESOURCE_BY_TOKEN[n.token]?.label ?? n.token
        if (!NUMBER.test(n.amount)) once('error', `${n.token}:${n.amount}: the amount is not a number.`, 'not-a-number')
        else if (!Number.isInteger(Number(n.amount))) once('error', `${n.token}:${n.amount}: ${label} is a whole number.`, 'not-whole')
        else if (Number(n.amount) < 1) once('error', `${n.token}:${n.amount}: an amount below 1.`, 'amount-below-1')
        break
      }
      case 'dynamic': {
        if (!n.name) once('error', `dynamic(:${n.amount}): no currency name.`, 'dr-name')
        else if (!DR_NAME.test(n.name)) once('error', `"${n.name}": a currency name starts with "dr-" and is written in lower case with "-".`, 'dr-name')
        else if (economy) {
          const c = findCurrency(economy, n.name)
          if (!c) once('warning', `The currency "${n.name}" is not on the Economy page's list.`, 'unknown-key')
          else if (c.ownName) once('warning', `"${n.name}" is this app's own name - not confirmed as the game's.`, 'own-name')
        }
        if (!NUMBER.test(n.amount)) once('error', `dynamic(${n.name}:${n.amount}): the amount is not a number.`, 'not-a-number')
        else if (Number(n.amount) < 1) once('error', `dynamic(${n.name}:${n.amount}): an amount below 1.`, 'amount-below-1')
        break
      }
      case 'pack':
        if (!n.key || !KEY.test(n.key)) once('error', 'sticker_pack: with no key.', 'pack-key')
        else if (economy && !findKey(economy, 'packs', n.key)) once('warning', `The pack "${n.key}" is not on the Economy page's list.`, 'unknown-key')
        break
      case 'preset':
        if (!n.key || !KEY.test(n.key)) once('error', 'preset: with no key.', 'preset-key')
        else if (economy && !isKnownPreset(economy, n.key)) once('warning', `The preset "${n.key}" is not on the Economy page's list.`, 'unknown-key')
        break
      case 'trigger':
        if (!n.name || !KEY.test(n.name)) once('error', 'trigger: with no name.', 'trigger-name')
        else if (economy && !findKey(economy, 'triggers', n.name)) once('warning', `The trigger "${n.name}" is not on the Economy page's list.`, 'unknown-key')
        break
      case 'draw':
        if (!n.bucket || !/^\d+$/.test(n.index)) once('error', `${n.fn}(${n.bucket},${n.index}): a draw takes a bucket and a whole number.`, 'draw')
        break
      default:
        if (n.text) once('error', `"${n.text}" is not a kind of item the game reads.`, 'unknown-atom')
    }
  }
  walk(node)
}

// Check a text: { ok (no error), issues, node, roundTrip (writing it back gives the same text) }.
export function checkReward(text, options = {}) {
  const { node, issues } = parseReward(text, options)
  const errors = issues.filter((i) => i.level === 'error')
  const compact = String(text ?? '').replace(/\s+/g, '')
  return { ok: errors.length === 0, issues, node, roundTrip: !node || formatReward(node) === compact }
}

// --- Worth -------------------------------------------------------------------

// The allowance worth of a reward text, for a date (currencies whose value
// changes by day). Of "[a|b]" the player gets the first one available: the
// worth is the first's, the others are listed. A part whose worth is not
// known makes the total unknown (null) - `known` is what could be added up.
// { worth, known, lines: [{ text, worth, note }], unknown: [text] }
export function rewardWorth(textOrNode, economy, { date = null } = {}) {
  const node = typeof textOrNode === 'string' ? parseReward(textOrNode, { economy }).node : textOrNode
  const lines = []
  const unknown = []
  const line = (n, worth, note = '') => {
    lines.push({ text: formatReward(n), worth, note })
    if (worth == null) unknown.push(formatReward(n))
    return worth
  }
  const walk = (n, depth = 0) => {
    switch (n.type) {
      case 'all': {
        let sum = 0
        let ok = true
        for (const part of n.parts) {
          const w = walk(part, depth)
          if (w == null) ok = false
          else sum += w
        }
        return ok ? sum : null
      }
      case 'first': {
        const w = walk(n.options[0], depth + 1)
        if (n.options.length > 1) lines.push({ text: n.options.slice(1).map(formatReward).join(' | '), worth: null, note: 'only if the first cannot be given', alternative: true })
        return w
      }
      case 'chest':
        return walk(n.inner, depth)
      case 'allowance': {
        const v = economy?.resources?.coins ?? 1
        return line(n, NUMBER.test(n.coins) ? Number(n.coins) * Number(v) : null)
      }
      case 'resource': {
        const r = RESOURCE_BY_TOKEN[n.token]
        const v = economy?.resources?.[r?.id]
        if (v == null || v === '') return line(n, null, `${r?.label ?? n.token} has no worth on the Economy page`)
        return line(n, NUMBER.test(n.amount) ? Number(n.amount) * Number(v) : null)
      }
      case 'dynamic': {
        const c = findCurrency(economy, n.name)
        const v = currencyValue(c, { date })
        if (!v) return line(n, null, !c ? 'not on the list' : date && hasDatedValues(c) ? `no value given for ${date}` : 'no worth given for it')
        const when = v.to && v.to !== v.date ? `${v.date} to ${v.to}` : v.date
        const note = v.dated ? `${v.value} a unit ${v.to && v.to !== v.date ? 'from' : 'on'} ${when}${v.noDate ? ' - no date chosen: the first date' : ''}` : ''
        return line(n, NUMBER.test(n.amount) ? Number(n.amount) * v.value : null, note)
      }
      case 'pack': {
        const k = findKey(economy, 'packs', n.key)
        const v = k?.value
        return line(n, v == null || v === '' ? null : Number(v), v == null || v === '' ? 'no pack allowance given' : 'pack allowance')
      }
      case 'preset': {
        const v = presetValue(economy, n.key)
        return line(n, v ? v.value : null, v ? (v.from === 'chef-basket' ? `a ${v.tier} Chef basket` : '') : 'no worth given for it')
      }
      case 'trigger':
        return line(n, 0, 'no value')
      default:
        return line(n, null, 'worth not known')
    }
  }
  if (!node) return { worth: null, known: 0, lines, unknown }
  const worth = walk(node)
  const known = lines.filter((l) => !l.alternative && l.worth != null).reduce((s, l) => s + l.worth, 0)
  return { worth: worth == null ? null : clean(worth), known: clean(known), lines, unknown }
}

const clean = (x) => Number.parseFloat(Number(x).toPrecision(12)) + 0
