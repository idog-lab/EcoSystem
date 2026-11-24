// BUILDING REWARD TEXT (economist, "Economy Rules & Reward Syntax", sections
// 2 and 3). Every prize the game gets is a plain-text string its server
// parses; these build it from parts, never by hand.
//
//   +        AND: the player gets every part
//   [a|b|c]  the first one available, else the next
//   no spaces, "." for decimals, coins rounded to 2 decimals
//
// Empty or invalid input gives an empty string - never a broken fragment like
// "dynamic(:0)", "free_wild:0" or a stray "+" or "|".
//
// The order a tier's text is written in (2.3): trigger, allowance, free_wild,
// free_stock, free_undo, free_entry, preset, [sticker_pack], [pack
// counter], other [dynamic], all of it in a chest. The checker never calls
// another order wrong: two of the economist's real examples are in another.

import { roundTo, roundAltDrAmount, roundPuzzleFallback, resourceCount } from './rounding'
import { RESOURCE_BY_ID, resourceIdOf, findKey } from './economyModel'

const isNum = (x) => x !== null && x !== '' && x !== undefined && Number.isFinite(Number(x))
// A number as the syntax writes it: plain, no exponent, no float noise.
export function syntaxNumber(x) {
  const n = Number(x)
  if (!Number.isFinite(n)) return ''
  const s = Number.parseFloat(n.toPrecision(12)).toString()
  if (!/e/i.test(s)) return s
  return n.toFixed(12).replace(/\.?0+$/, '')
}
const isWhole = (x) => isNum(x) && Number.isInteger(Number(x))

export const joinPlus = (...parts) => parts.flat().filter((p) => typeof p === 'string' && p.length > 0).join('+')
const joinAlt = (parts) => parts.filter((p) => typeof p === 'string' && p.length > 0).join('|')

// allowance(coins:X), or allowance:<bucket>(coins:X). Nothing for 0 or less.
export function coinsSyntax(coins, { bucket = '', decimals = 2 } = {}) {
  if (!isNum(coins) || !(Number(coins) > 0)) return ''
  const x = syntaxNumber(roundTo(coins, decimals))
  if (!(Number(x) > 0)) return ''
  return bucket ? `allowance:${bucket}(coins:${x})` : `allowance(coins:${x})`
}

// One resource: free_wild:N ... Whole numbers of 1 or more only.
export function resourceSyntax(id, amount) {
  const r = RESOURCE_BY_ID[id]
  if (!r || id === 'coins' || !isWhole(amount) || Number(amount) < 1) return ''
  return `${r.token}:${Number(amount)}`
}

// The rewards of a tier in their order (RewardSyntax).
export function rewardSyntax({ coins = 0, allowanceBucket = '', wild = 0, stock = 0, undo = 0, freeRound = 0 } = {}, { coinDecimals = 2 } = {}) {
  return joinPlus(
    coinsSyntax(coins, { bucket: allowanceBucket, decimals: coinDecimals }),
    resourceSyntax('wild', wild),
    resourceSyntax('stock', stock),
    resourceSyntax('undo', undo),
    resourceSyntax('entry', freeRound),
  )
}

// What is given instead of something worth `allowance` (DR_AltReward):
//   no alt          allowance(coins:<allowance, 2 decimals>)
//   'hidden'        [dynamic(dr-hidden:1)]
//   a resource      its token: round(allowance / its value), at least 1, then the cap
// allowance(coins:3) for 3; free_wild:2 for 5 with Wild.
export function altReward(allowance, alt, cap, economy) {
  if (alt === 'hidden') return '[dynamic(dr-hidden:1)]'
  if (!isNum(allowance)) return ''
  if (alt == null || alt === '' || alt === 'coins' || alt === 'allowance') return coinsSyntax(allowance)
  const id = resourceIdOf(alt)
  if (!id || id === 'coins') return id === 'coins' ? coinsSyntax(allowance) : ''
  const value = economy?.resources?.[id]
  if (!isNum(value) || !(Number(value) > 0)) return ''
  const n = resourceCount(allowance, value, cap)
  return resourceSyntax(id, n)
}

// A currency with its fallbacks (DR_Syntax_V5/V6):
//   [dynamic(<name>:<amount>)|<last>]
//   [dynamic(<name>:<amount>)|[dynamic(<second DR>:<a>)|<last>]]
// The second currency and the last fallback go INSIDE each other (economist,
// asked: "it should be inside, but it can be not only coins, any core
// resource can be the last fallback. coins, undo, free round, extra stock,
// wild"). The last is altReward's: coins, or a core resource worth the same.
// The second currency's amount is typed, or worked out from the worth:
//   standard  max(1, MROUND(worth / its value, 5 above 8 units, else 1)), then its cap
//   puzzle    max(step, MROUND(worth x multiplier / its value, step)), step 5 (some features 10)
export function drSyntax({
  name,
  amount,
  value = null,
  alt = null,
  altCap = null,
  altDrName = '',
  altDrAmount = 0,
  altDrValue = 0,
  altDrCap = null,
  altDrRounding = 'standard',
  altDrMultiplier = 1,
  puzzleStep = 5,
  noRegularAlt = false,
} = {}, economy = null) {
  if (typeof name !== 'string' || name.length < 2 || !isNum(amount) || Number(amount) < 1) return ''
  const total = isNum(value) ? Number(value) * Number(amount) : NaN
  const head = `dynamic(${name}:${syntaxNumber(amount)})`
  let altDr = ''
  if (altDrName && (Number(altDrAmount) > 0 || Number(altDrValue) > 0)) {
    let a
    if (Number(altDrAmount) > 0) a = Number(altDrAmount)
    else if (Number.isFinite(total)) {
      const units = (total * (Number(altDrMultiplier) || 1)) / Number(altDrValue)
      a = altDrRounding === 'puzzle' ? roundPuzzleFallback(units, puzzleStep) : roundAltDrAmount(units)
    }
    if (a != null && Number(altDrCap) > 0) a = Math.min(a, Number(altDrCap))
    if (a != null && a >= 1) altDr = `dynamic(${altDrName}:${syntaxNumber(a)})`
  }
  const regular = noRegularAlt ? '' : altReward(total, alt, altCap, economy)
  if (altDr) return `[${joinAlt([head, `[${joinAlt([altDr, regular])}]`])}]`
  return `[${joinAlt([head, regular])}]`
}

// A counter given with the hidden fallback no player sees:
// [dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]
export function counterSyntax(name) {
  if (typeof name !== 'string' || name.length < 2) return ''
  return `[dynamic(${name}:1)|[dynamic(dr-hidden:1)]]`
}

// A sticker pack with its fallbacks (PackSyntax):
// [sticker_pack:<key>|<alt reward>|[dynamic(<hidden DR>:1)]]
export function packSyntax({ packKey, allowance = null, alt = null, cap = null, hiddenDr = '' } = {}, economy = null) {
  if (!packKey) return ''
  const fallback = isNum(allowance) || alt ? altReward(isNum(allowance) ? Number(allowance) : NaN, alt, cap, economy) : ''
  return `[${joinAlt([`sticker_pack:${packKey}`, fallback, hiddenDr ? `[dynamic(${hiddenDr}:1)]` : ''])}]`
}

export const presetSyntax = (key) => (key ? `preset:${key}` : '')
export const triggerSyntax = (name) => (name ? `trigger:${name}` : '')
// chest:<name>(<reward>) when a chest is named; the reward as it is otherwise.
export const chestSyntax = (reward, chestName) => (reward && chestName ? `chest:${chestName}(${reward})` : reward || '')

// A preset of a family, snapped to the nearest amount that exists on the
// Economy page's list (never made up):
//   mini_game  mini_game_<amount>_gameplay_<undo|es|wild|entry|allowance>, else its _allowance
//   puzzle     puzzle_gameplay_<amount>[_undo|_entry|_stock|_wild]
//   mf         mf_<amount>_<gameplay|pricing>_<entry|undo|allowance|es|wild>[_cross]
// Returns { key, amount, fellBack } or null when no key of that shape is listed.
export const PRESET_FAMILIES = {
  mini_game: { label: 'Mini-game', suffixes: ['undo', 'es', 'wild', 'entry', 'allowance'], fallback: 'allowance', make: (n, sfx) => `mini_game_${n}_gameplay_${sfx}`, re: /^mini_game_(\d+)_gameplay_([a-z]+)$/ },
  puzzle: { label: 'Puzzle', suffixes: ['', 'undo', 'entry', 'stock', 'wild'], fallback: null, make: (n, sfx) => `puzzle_gameplay_${n}${sfx ? `_${sfx}` : ''}`, re: /^puzzle_gameplay_(\d+)(?:_([a-z]+))?$/ },
  mf: { label: 'Pet', suffixes: ['entry', 'undo', 'allowance', 'es', 'wild'], fallback: null, make: (n, sfx, { kind = 'gameplay', cross = false } = {}) => `mf_${n}_${kind}_${sfx}${cross ? '_cross' : ''}`, re: /^mf_(\d+)_(gameplay|pricing)_([a-z]+?)(_cross)?$/ },
}
export function presetFor(family, amount, suffix, economy, { kind = 'gameplay', cross = false } = {}) {
  const fam = PRESET_FAMILIES[family]
  if (!fam || !isNum(amount)) return null
  const keys = (economy?.keys?.presets ?? []).map((k) => k.key)
  const amountsFor = (sfx) => {
    const out = []
    for (const key of keys) {
      const m = key.match(fam.re)
      if (!m) continue
      if (family === 'mf') {
        if (m[2] === kind && m[3] === sfx && !!m[4] === !!cross) out.push(Number(m[1]))
      } else if ((m[2] ?? '') === (sfx ?? '')) out.push(Number(m[1]))
    }
    return out
  }
  const snap = (list) => list.reduce((best, n) => (best == null || Math.abs(n - amount) < Math.abs(best - amount) || (Math.abs(n - amount) === Math.abs(best - amount) && n < best) ? n : best), null)
  let n = snap(amountsFor(suffix))
  if (n != null) return { key: fam.make(n, suffix, { kind, cross }), amount: n, fellBack: false }
  if (fam.fallback && fam.fallback !== suffix) {
    n = snap(amountsFor(fam.fallback))
    if (n != null) return { key: fam.make(n, fam.fallback, { kind, cross }), amount: n, fellBack: true }
  }
  return null
}

// A Chef basket: preset:Chef__<Basic|Rare|Epic>_Phase_<1|2>_<suffix>. (No counter after it any more - economist:
// "the basket counter has no value. and also u can remove it, that logic is not up to date".)
export function chefBasketSyntax(tier, phase, suffix) {
  if (!tier || !phase || !suffix) return ''
  return `preset:Chef__${tier}_Phase_${phase}_${suffix}`
}

// A tier's whole text, in the order of 2.3:
// triggers + rewards + presets + [pack] + [pack counter] + [currencies], in a chest if named.
export function tierSyntax({ triggers = [], reward = {}, presets = [], pack = null, packCounter = true, currencies = [], counters = [], chest = '' } = {}, economy = null, { coinDecimals = 2 } = {}) {
  const packText = pack?.packKey ? packSyntax(pack, economy) : ''
  const text = joinPlus(
    triggers.map(triggerSyntax),
    rewardSyntax(reward, { coinDecimals }),
    presets.map(presetSyntax),
    packText,
    packText && packCounter ? counterSyntax('dr-pack-counter') : '',
    currencies.map((c) => drSyntax(c, economy)),
    counters.map(counterSyntax),
  )
  return chestSyntax(text, chest)
}

// The listed worth of a pack (its allowance); null when not given.
export function packAllowance(economy, key) {
  const k = findKey(economy, 'packs', key)
  return k && isNum(k.value) ? Number(k.value) : null
}
