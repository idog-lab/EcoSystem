// THE ECONOMY: what everything is worth, and the keys the game knows.
//
// Economist ("Economy Rules & Reward Syntax"): value is always measured in
// ALLOWANCE (also called coins). Every resource converts to allowance through
// one fixed table; every prize is balanced against an allowance budget. Keys
// are never invented - a currency name, pack, preset, chest or trigger comes
// from these lists, typed or pasted on the Economy page.
//
// One copy for the whole app (src/lib, shared by every feature), kept in this
// browser and in backups (economyStore.js). A value nobody gave is null and
// reads "not set" - never 0.
//
// What the economist TAUGHT is kept in the project (taught.js) and wins over a
// browser's copy: every economy made or read here has it put in last.

import { GAME_CURRENCIES, GAME_PACKS, GAME_PRESETS, GAME_PRESETS_CHEF } from './gameKeys'
import { TAUGHT_CHEF_BASKETS, TAUGHT_CURRENCIES, TAUGHT_KEYS, TAUGHT_RESOURCES } from './taught'

export const ECONOMY_VERSION = 5

// The resources of the value table, with their syntax tokens and the names
// the sheets use for them.
export const RESOURCES = [
  { id: 'coins', label: 'Coins', token: 'allowance', note: 'allowance(coins:X) - X is already in allowance', aliases: ['Coins', 'Coin', 'Allowance'] },
  { id: 'wild', label: 'Wild', token: 'free_wild', aliases: ['Wild', 'Wilds'] },
  { id: 'stock', label: 'Extra Stock', token: 'free_stock', aliases: ['Extra Stock', 'ExtraStock', 'Stock'] },
  { id: 'undo', label: 'Undo', token: 'free_undo', aliases: ['Undo', 'Undos'] },
  { id: 'entry', label: 'Free Round', token: 'free_entry', aliases: ['Free Round', 'FreeRound', 'Entry', 'Free Rounds'] },
]
export const RESOURCE_BY_TOKEN = Object.fromEntries(RESOURCES.map((r) => [r.token, r]))
export const RESOURCE_BY_ID = Object.fromEntries(RESOURCES.map((r) => [r.id, r]))

// The economist's table, as taught (taught.js). (Energy, "energy:N", was in the first text and is not used -
// economist: "u can remove this energy".)
export const DEFAULT_RESOURCE_VALUES = Object.fromEntries(RESOURCES.map((r) => [r.id, TAUGHT_RESOURCES[r.id]?.value ?? null]))

// A sheet's name for a resource ("Extra Stock", "FreeRound") -> its id; null when unknown.
export function resourceIdOf(name) {
  if (name == null) return null
  const s = String(name).trim().toLowerCase().replace(/[\s_]/g, '')
  for (const r of RESOURCES) {
    if (r.id === s || r.token.replace(/_/g, '') === s) return r.id
    if (r.aliases.some((a) => a.toLowerCase().replace(/[\s_]/g, '') === s)) return r.id
  }
  return null
}

// A currency (dynamic resource, "DR"). `daily`: the dated export map
// ("2026-11-30=0.0376875|2026-12-01=0.0333518|...") for a currency whose
// value changes day by day; when it is set it is what a date reads.
// One worth only - game play (economist, 24 Nov 2026: "we will use only the gameplay, u can remove all the pricing
// things from the app"); a pricing worth an older save carries is dropped.
// `periods`: [{ from, to, value }] - the values of a currency that is always in the game (CORE_CURRENCIES), each
// with the dates it holds for, both days included.
export function createCurrency({ name = '', feature = '', valueGameplay = null, daily = '', periods = [], startDate = '', endDate = '', note = '', ownName = false } = {}) {
  return { name, feature, valueGameplay, daily, periods: cleanPeriods(periods), startDate, endDate, note, ownName }
}

// THE CURRENCIES ALWAYS IN THE GAME (economist, 25 Nov 2026: "there are DRs that will always be in the game ...
// puzzle, merge, picks, pet. those should be in a different table, that also holds the dates that the value is
// relevant to. the puzzle should have different value for each day, and the pet should have different values for
// each week he is live"). Asked: merge and picks are dr-merge and dr-pickaxe ("like we got in the table now"),
// first with a value "From date to date", then (same day): "as for the picks and merge, we can give a fixed value
// for now" - one worth, the same every day. A pet week runs 7 days "From the day I type". The puzzle and the pet
// are worth only what their dates say: a date with no value reads unknown ("Unknown"), never the nearest one.
//   step: 'day' (one value a day), 'week' (7 days from the day typed), 'range' (from a date to a date - none
//   uses it now), 'fixed' (one worth, no dates).
export const CORE_CURRENCIES = [
  { name: 'dr-puzzle', label: 'Puzzle', step: 'day' },
  { name: 'dr-merge', label: 'Merge', step: 'fixed' },
  { name: 'dr-pickaxe', label: 'Picks', step: 'fixed' },
  { name: 'dr-pet', label: 'Pet', step: 'week' },
]
export const coreCurrency = (name) => CORE_CURRENCIES.find((c) => c.name === name) ?? null
// Is a currency always in the game worth what its dates say (puzzle, pet), rather than one fixed worth?
export const isDatedCore = (name) => !!coreCurrency(name) && coreCurrency(name).step !== 'fixed'

// --- Periods (the dates a value holds for) ----------------------------------

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const byFrom = (a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)
// Only real periods, by date: from and to real dates, from not after to, a value that is a number.
export function cleanPeriods(list) {
  if (!Array.isArray(list)) return []
  return list
    .filter((p) => p && isRealDate(p.from) && isRealDate(p.to) && p.from <= p.to && p.value !== '' && p.value != null && Number.isFinite(Number(p.value)))
    .map((p) => ({ from: p.from, to: p.to, value: Number(p.value) }))
    .sort(byFrom)
}
// The period of `list` (other than index `except`) that shares a day with from..to, or null.
export const overlapping = (list, from, to, except = -1) => list.find((p, i) => i !== except && p.from <= to && from <= p.to) ?? null
// "30 Nov 2026"
export const readableDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
export const periodText = (p) => (p.from === p.to ? p.from : `${p.from}..${p.to}`)
// The writing of a list of periods: 2026-11-30=0.03|2026-12-01..2026-12-14=0.3
export const formatPeriods = (list) => list.map((p) => `${periodText(p)}=${p.value}`).join('|')

// Periods pasted from a sheet, for a step: 'day' reads date=value (the export writing,
// 2026-11-30=0.0376875|2026-12-01=0.0333518); 'week' reads the first day of a week and its value; 'range' reads
// from..to=value, or from, to and value with a tab or space between. Returns { periods, bad }.
export function parsePeriods(text, step) {
  const periods = []
  const bad = []
  for (const part of String(text ?? '').split(/[|\n\r;]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = step === 'range' ? part.match(/^(\d{4}-\d{2}-\d{2})\s*(?:\.\.|[\t ,]+)\s*(\d{4}-\d{2}-\d{2})\s*[=:\t ,]\s*(-?\d+(?:\.\d+)?)$/) : part.match(/^(\d{4}-\d{2}-\d{2})\s*[=:\t ,]\s*(-?\d+(?:\.\d+)?)$/)
    if (!m || !isRealDate(m[1]) || (step === 'range' && (!isRealDate(m[2]) || m[2] < m[1]))) {
      bad.push(part)
      continue
    }
    if (step === 'range') periods.push({ from: m[1], to: m[2], value: Number(m[3]) })
    else periods.push({ from: m[1], to: step === 'week' ? addDays(m[1], 6) : m[1], value: Number(m[2]) })
  }
  return { periods, bad }
}

// The names the economist gave (section 3), the three Merge Mania reads, and
// the one this app made up. No value is known for any of them but dr-hidden.
const SEED_CURRENCIES = [
  createCurrency({ name: 'dr-puzzle', feature: 'Puzzle', note: 'A value for each day.' }),
  createCurrency({ name: 'dr-pickaxe' }),
  createCurrency({ name: 'dr-midnight-blast-heel' }),
  createCurrency({ name: 'dr-pet' }),
  createCurrency({ name: 'dr-sugar-gp' }),
  createCurrency({ name: 'dr-candy-catcher-red' }),
  createCurrency({ name: 'dr-totem-rush' }),
  createCurrency({ name: 'dr-bonus-trail' }),
  createCurrency({ name: 'dr-coins-booster-x2-15min', note: 'A booster.' }),
  createCurrency({ name: 'dr-pack-counter', feature: 'Counter', valueGameplay: 0, note: 'Counts packs. Given with a hidden fallback. Worth 0 (economist).' }),
  createCurrency({ name: 'dr-hidden', feature: 'Counter', valueGameplay: 0, note: 'Worth 0: the fallback no player sees.' }),
  createCurrency({ name: 'dr-merge', feature: 'Merge Mania', note: 'Merge energy: free generator taps.' }),
  createCurrency({ name: 'dr-mf-charm', feature: 'Merge Mania', note: 'Charms.' }),
  createCurrency({ name: 'dr-twister', feature: 'Merge Mania', note: 'Twister DR: what a spin of the Twister costs.' }),
]

// What the economist settled after the first version (24 Nov 2026), applied to
// an economy saved before: dr-twister IS the game's name ("its the name of
// it"), and the pack counter is worth 0 ("packs are prices with 0"). A worth
// someone typed is never overwritten. Version 3: the basket counter is gone ("the basket counter has no value.
// and also u can remove it, that logic is not up to date"), and so is the pricing worth.
function upgrade(currencies, version) {
  let list = currencies
  if (version < 2)
    list = list.map((c) => {
      if (c.name === 'dr-twister' && c.ownName) return { ...c, ownName: false, note: 'Twister DR: what a spin of the Twister costs.' }
      if (c.name === 'dr-pack-counter') return { ...c, valueGameplay: c.valueGameplay ?? 0 }
      return c
    })
  if (version < 3) list = list.filter((c) => c.name !== 'dr-basket-counter')
  return list
}

export const KEY_LISTS = [
  { id: 'presets', label: 'Presets', atom: 'preset', valueLabel: 'Worth', hint: 'preset:<key>' },
  { id: 'packs', label: 'Sticker packs', atom: 'sticker_pack', valueLabel: 'Worth', hint: 'sticker_pack:<key> - worth 0 (economist)' },
  { id: 'chests', label: 'Chests', atom: 'chest', valueLabel: null, hint: 'chest:<name>(...)' },
  { id: 'triggers', label: 'Triggers', atom: 'trigger', valueLabel: null, hint: 'trigger:<name> - no value' },
  { id: 'buckets', label: 'Allowance buckets', atom: 'allowance', valueLabel: null, hint: 'allowance:<bucket>(coins:X)' },
]

export const createKey = ({ key = '', value = null, note = '' } = {}) => ({ key, value, note })

// The game's keys as the economist gave them (gameKeys.js), and the ones in their examples. A pack is worth 0
// ("0 for every pack"); a preset's worth is not known unless it is a Chef basket (its tier) - until a value is
// given it is "not set".
const EXAMPLE_PRESETS = ['mini_game_5_gameplay_es', 'mini_game_40_gameplay_es', 'puzzle_gameplay_250', 'mf_90_gameplay_entry_cross']
const SEED_KEYS = {
  presets: [...GAME_PRESETS, ...GAME_PRESETS_CHEF, ...EXAMPLE_PRESETS].map((key) => createKey({ key })),
  packs: GAME_PACKS.map((key) => createKey({ key, value: 0 })),
  // The four chests (taught.js); pink-chest and yellow-chest, once taken from the reward examples, are gone ("Only
  // the four").
  chests: ['wooden', 'silver', 'golden', 'purple'].map((key) => createKey({ key })),
  triggers: ['Pity', 'dailyreward_lowhabit', '_diamond_mine_tier_3', 'sugar_rush_tier_gp'].map((key) => createKey({ key })),
  buckets: ['milestone', 'store_allowance'].map((key) => createKey({ key })),
}

// Chef baskets: the presets Chef__<Basic|Rare|Epic>_Phase_<1|2>_... on the list (which kinds exist is the list's,
// not a pattern's: Basic is Undo, Allowance or Free round; Rare Allowance, Free round or Extra stock; Epic Extra
// stock, Wild or Free_round3). Worth by tier, the same every day for now (economist: "as for now the basket values
// are like i gave u, when the chef model in the app will be better we will change its value daily").
export const CHEF_BASKET_TIERS = ['Basic', 'Rare', 'Epic']
export const DEFAULT_CHEF_BASKET_VALUES = Object.fromEntries(CHEF_BASKET_TIERS.map((t) => [t, TAUGHT_CHEF_BASKETS[t]?.value ?? null]))
export const CHEF_BASKET_TIER = /^Chef__(Basic|Rare|Epic)_Phase_/
export const chefBasketKeys = (economy, { pricing = false } = {}) => (economy?.keys?.presets ?? []).map((k) => k.key).filter((k) => CHEF_BASKET_TIER.test(k) && (pricing || !/_pricing_/.test(k)))

// --- What was taught (taught.js) --------------------------------------------

const TAUGHT_CURRENCY_BY_NAME = new Map(TAUGHT_CURRENCIES.map((c) => [c.name, c]))
export const taughtResource = (id) => TAUGHT_RESOURCES[id] ?? null
export const taughtChefBasket = (tier) => TAUGHT_CHEF_BASKETS[tier] ?? null
export const taughtCurrency = (name) => TAUGHT_CURRENCY_BY_NAME.get(name) ?? null
export const taughtKey = (listId, key) => (TAUGHT_KEYS[listId] ?? []).find((k) => k.key === key) ?? null
// Has this field of a taught entry been taught? (A taught currency may have a worth and no dates, or the reverse.)
export const isTaught = (entry, field) => !!entry && entry[field] !== undefined

const blank = (v) => v == null || v === ''
const sameValue = (a, b) => (blank(a) || blank(b) ? blank(a) && blank(b) : Number(a) === Number(b))

const TAUGHT = { resources: TAUGHT_RESOURCES, chefBaskets: TAUGHT_CHEF_BASKETS, currencies: TAUGHT_CURRENCIES, keys: TAUGHT_KEYS }

// Puts what was taught into an economy, over what it held. Returns the economy and `replacedHere`: the values
// this browser held of its own that the project's replaced ({ what, here, taught }) - said once on the page.
// (`taught` is taught.js; the checks pass their own.)
export function applyTaught(economy, taught = TAUGHT) {
  const { resources: TAUGHT_RESOURCES, chefBaskets: TAUGHT_CHEF_BASKETS, currencies: TAUGHT_CURRENCIES, keys: TAUGHT_KEYS } = taught
  const TAUGHT_CURRENCY_BY_NAME = new Map(TAUGHT_CURRENCIES.map((c) => [c.name, c]))
  const replaced = []
  const note = (what, here, taught) => {
    if (!blank(here) && !sameValue(here, taught)) replaced.push({ what, here, taught })
  }
  const resources = { ...economy.resources }
  for (const [id, t] of Object.entries(TAUGHT_RESOURCES)) {
    note(`${RESOURCE_BY_ID[id]?.label ?? id}: worth of one`, resources[id], t.value)
    resources[id] = t.value
  }
  const chefBaskets = { ...economy.chefBaskets }
  for (const [tier, t] of Object.entries(TAUGHT_CHEF_BASKETS)) {
    note(`${tier} Chef basket`, chefBaskets[tier], t.value)
    chefBaskets[tier] = t.value
  }
  const currencies = economy.currencies.map((c) => {
    const t = TAUGHT_CURRENCY_BY_NAME.get(c.name)
    if (!t) return c
    const next = { ...c }
    if (isTaught(t, 'valueGameplay')) {
      note(`${c.name}: worth`, c.valueGameplay, t.valueGameplay)
      next.valueGameplay = t.valueGameplay
    }
    if (isTaught(t, 'daily')) {
      if (!blank(c.daily) && c.daily !== t.daily) replaced.push({ what: `${c.name}: values by date`, here: 'its own dates', taught: 'the taught dates' })
      next.daily = t.daily
    }
    if (isTaught(t, 'periods')) {
      const taughtPeriods = cleanPeriods(t.periods)
      if (c.periods?.length && formatPeriods(c.periods) !== formatPeriods(taughtPeriods)) replaced.push({ what: `${c.name}: values by date`, here: 'its own dates', taught: 'the taught dates' })
      next.periods = taughtPeriods
    }
    for (const field of ['feature', 'note']) if (isTaught(t, field)) next[field] = t[field]
    return next
  })
  for (const t of TAUGHT_CURRENCIES) {
    if (currencies.some((c) => c.name === t.name)) continue
    const { name, valueGameplay, daily, periods, feature, note: text } = t
    currencies.push(createCurrency({ name, valueGameplay: valueGameplay ?? null, daily: daily ?? '', periods: periods ?? [], feature: feature ?? '', note: text ?? '' }))
  }
  const keys = { ...economy.keys }
  for (const list of KEY_LISTS) {
    const taught = TAUGHT_KEYS[list.id] ?? []
    if (!taught.length) continue
    const items = (keys[list.id] ?? []).map((k) => {
      const t = taught.find((x) => x.key === k.key)
      if (!t) return k
      const next = { ...k }
      if (isTaught(t, 'value')) {
        note(`${list.atom}:${k.key}`, k.value, t.value)
        next.value = t.value
      }
      if (isTaught(t, 'note')) next.note = t.note
      return next
    })
    for (const t of taught) if (!items.some((k) => k.key === t.key)) items.push(createKey({ key: t.key, value: t.value ?? null, note: t.note ?? '' }))
    keys[list.id] = items
  }
  // Not enumerable: never written to storage or a file, and gone from the copy the next change makes.
  return Object.defineProperty({ ...economy, resources, chefBaskets, currencies, keys }, 'replacedHere', { value: replaced, enumerable: false })
}

// What this browser holds that was NOT taught: worths typed here, and currencies or keys added here. It stays in
// this browser only until it is taught (the Worth tab lists it, ready to be sent).
//   [{ kind: 'currency' | 'key', list?, name, value?, daily?, added }]
const SEED_CURRENCY_NAMES = new Set([...SEED_CURRENCIES.map((c) => c.name), ...GAME_CURRENCIES])

// Removed by the economist, though on the game's list: the basket counter (24 Nov 2026: "the basket counter has no
// value. and also u can remove it, that logic is not up to date").
const REMOVED_CURRENCIES = new Set(['dr-basket-counter'])

// The game's currencies the Currencies table does not hold yet: the drop list a currency is added from (the
// game's list, the ones the page starts with, the taught ones), by name.
export function currencyChoices(economy) {
  const have = new Set((economy?.currencies ?? []).map((c) => c.name))
  const known = new Set([...SEED_CURRENCY_NAMES, ...TAUGHT_CURRENCIES.map((c) => c.name)])
  return [...known].filter((name) => !have.has(name) && !coreCurrency(name) && !REMOVED_CURRENCIES.has(name)).sort()
}

export function notTaught(economy) {
  const out = []
  for (const c of economy?.currencies ?? []) {
    const t = TAUGHT_CURRENCY_BY_NAME.get(c.name)
    const dated = isDatedCore(c.name)
    const fixed = coreCurrency(c.name)?.step === 'fixed'
    // (The puzzle and the pet are worth only what their dates say: a worth without dates is not used. Merge and
    // picks are one fixed worth: dates are not used.)
    const value = isTaught(t, 'valueGameplay') || dated ? null : c.valueGameplay
    const daily = isTaught(t, 'daily') ? '' : c.daily
    const periods = isTaught(t, 'periods') || fixed ? '' : formatPeriods(c.periods ?? [])
    const added = !t && !SEED_CURRENCY_NAMES.has(c.name)
    if (added || !blank(value) || !blank(daily) || periods) out.push({ kind: 'currency', name: c.name, value: blank(value) ? null : Number(value), daily: daily || periods || '', added })
  }
  for (const list of KEY_LISTS) {
    const seeded = new Map((SEED_KEYS[list.id] ?? []).map((k) => [k.key, k]))
    for (const k of economy?.keys?.[list.id] ?? []) {
      const t = taughtKey(list.id, k.key)
      const added = !t && !seeded.has(k.key)
      const typed = list.valueLabel && !isTaught(t, 'value') && !blank(k.value) && !sameValue(k.value, seeded.get(k.key)?.value)
      if (added || typed) out.push({ kind: 'key', list: list.id, atom: list.atom, name: k.key, value: typed ? Number(k.value) : null, added })
    }
  }
  return out
}

// The same, written as a message to paste in chat.
export function notTaughtMessage(items) {
  const lines = items.map((it) => {
    const name = it.kind === 'currency' ? it.name : `${it.atom}:${it.name}`
    const parts = []
    if (it.added) parts.push(it.kind === 'currency' ? 'a currency added here' : 'a key added here')
    if (it.value != null) parts.push(`worth ${it.value}`)
    if (it.daily) parts.push(`values by date ${it.daily}`)
    return `- ${name}: ${parts.join(', ')}`
  })
  return `Please teach the app these values from my Economy page:\n${lines.join('\n')}`
}

export function createEconomy(overrides = {}) {
  const keys = {}
  for (const list of KEY_LISTS) keys[list.id] = (overrides.keys?.[list.id] ?? SEED_KEYS[list.id] ?? []).map((k) => createKey(k))
  const currencies = (overrides.currencies ?? SEED_CURRENCIES).map((c) => createCurrency(asCore(c)))
  // The currencies always in the game are always on the page.
  for (const core of CORE_CURRENCIES) if (!currencies.some((c) => c.name === core.name)) currencies.push(createCurrency(SEED_CURRENCIES.find((c) => c.name === core.name) ?? { name: core.name }))
  return applyTaught({
    version: ECONOMY_VERSION,
    // (Only the resources of the table: one an older save still holds, like energy, is dropped.)
    resources: Object.fromEntries(Object.keys(DEFAULT_RESOURCE_VALUES).map((id) => [id, overrides.resources?.[id] !== undefined ? overrides.resources[id] : DEFAULT_RESOURCE_VALUES[id]])),
    currencies,
    keys,
    chefBaskets: { ...DEFAULT_CHEF_BASKET_VALUES, ...(overrides.chefBaskets ?? {}) },
    updatedAt: overrides.updatedAt ?? null,
  })
}

// A currency always in the game saved with values by date in the older writing (`daily`, dr-puzzle's): each date
// becomes a period of that one day. Nothing else of it changes.
function asCore(c) {
  if (!c || !coreCurrency(c.name) || !c.daily || c.periods?.length) return c
  const { entries } = parseDailyValues(c.daily)
  return { ...c, daily: '', periods: entries.map((e) => ({ from: e.date, to: e.date, value: e.value })) }
}

// Version 4: the game's keys (gameKeys.js) are added to a saved economy's lists - what it holds stays, a key
// typed there keeps its worth - and a pack with no worth gets 0.
// Version 5 (25 Nov 2026): the chests are the four the economist gave ("Only the four"): pink-chest and
// yellow-chest come off a saved list (the four themselves are taught, so every list gets them).
const DROPPED_CHESTS = new Set(['pink-chest', 'yellow-chest'])
function upgradeKeys(keys, version) {
  if (!keys || version >= 5) return keys
  const out = { ...keys }
  if (version < 4)
    for (const list of KEY_LISTS) {
      const have = new Map((keys[list.id] ?? []).map((k) => [k.key, k]))
      for (const k of SEED_KEYS[list.id] ?? []) if (!have.has(k.key)) have.set(k.key, k)
      out[list.id] = [...have.values()].map((k) => (list.id === 'packs' && (k.value == null || k.value === '') ? { ...k, value: 0 } : k))
    }
  if (out.chests) out.chests = out.chests.filter((k) => !DROPPED_CHESTS.has(k.key))
  return out
}

// Anything read from storage or a file: missing parts filled, unknown ones dropped.
export function normalizeEconomy(raw) {
  if (!raw || typeof raw !== 'object') return createEconomy()
  return createEconomy({
    resources: raw.resources,
    currencies: Array.isArray(raw.currencies) ? upgrade(raw.currencies, Number(raw.version) || 1) : undefined,
    keys: upgradeKeys(raw.keys, Number(raw.version) || 1),
    chefBaskets: raw.chefBaskets,
    updatedAt: raw.updatedAt ?? null,
  })
}

// --- Currencies whose value changes by date ---------------------------------

// A real calendar date, YYYY-MM-DD (2026-02-30 is not one).
export function isRealDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(text ?? ''))) return false
  const d = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text
}

// "2026-11-30=0.0376875|2026-12-01=0.0333518" -> [{ date, value }] by date.
// Returns { entries, bad } - `bad` the parts that are not date=value.
export function parseDailyValues(text) {
  const entries = []
  const bad = []
  for (const part of String(text ?? '').split(/[|\n\r,;]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d{4}-\d{2}-\d{2})\s*[=:\t ]\s*(-?\d+(?:\.\d+)?)$/)
    if (m && isRealDate(m[1])) entries.push({ date: m[1], value: Number(m[2]) })
    else bad.push(part)
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { entries, bad }
}
export const formatDailyValues = (entries) => entries.map((e) => `${e.date}=${e.value}`).join('|')

// Does a currency have values by date (periods, or the dated writing)?
export const hasDatedValues = (currency) => coreCurrency(currency?.name)?.step !== 'fixed' && !!(currency?.periods?.length || parseDailyValues(currency?.daily).entries.length)

// A currency's worth of one unit (game play), on a date. null when nothing is known - and a date with no value
// given is unknown, never the nearest date's (economist, 25 Nov 2026, asked: "Unknown").
// - The puzzle and the pet (dated CORE_CURRENCIES) are worth what the period holding the date says; nothing else.
// - Merge and picks are one fixed worth, whatever the date (dates typed for them before are not used).
// - Another one with values by date: a date between two reads the last one before it; before the first or after
//   the last, nothing.
// With no date chosen, the first date's value is read, and said (`noDate`).
export function currencyValue(currency, { date = null } = {}) {
  if (!currency) return null
  const fixed = coreCurrency(currency.name)?.step === 'fixed'
  const periods = fixed ? [] : (currency.periods ?? [])
  if (periods.length || isDatedCore(currency.name)) {
    if (!periods.length) return null
    if (!date) return { value: periods[0].value, date: periods[0].from, to: periods[0].to, dated: true, noDate: true }
    const hit = periods.find((p) => p.from <= date && date <= p.to)
    return hit ? { value: hit.value, date: hit.from, to: hit.to, dated: true } : null
  }
  if (currency.daily) {
    const { entries } = parseDailyValues(currency.daily)
    if (entries.length) {
      if (!date) return { value: entries[0].value, date: entries[0].date, dated: true, noDate: true }
      if (date < entries[0].date || date > entries[entries.length - 1].date) return null
      let hit = entries[0]
      for (const e of entries) if (e.date <= date) hit = e
      return { value: hit.value, date: hit.date, dated: true }
    }
  }
  const v = currency.valueGameplay
  return v == null || v === '' || !Number.isFinite(Number(v)) ? null : { value: Number(v), dated: false }
}

export const findCurrency = (economy, name) => (economy?.currencies ?? []).find((c) => c.name === name) ?? null
export const findKey = (economy, listId, key) => (economy?.keys?.[listId] ?? []).find((k) => k.key === key) ?? null

// A preset's worth: a listed one's value, or a Chef basket's tier value.
export function presetValue(economy, key) {
  const listed = findKey(economy, 'presets', key)
  if (listed && listed.value != null && listed.value !== '') return { value: Number(listed.value), from: 'list' }
  const m = String(key).match(CHEF_BASKET_TIER)
  if (m) {
    const v = economy?.chefBaskets?.[m[1]]
    return v == null ? null : { value: Number(v), from: 'chef-basket', tier: m[1] }
  }
  return null
}
export const isKnownPreset = (economy, key) => !!findKey(economy, 'presets', key)

// Chef's own names for the resources of a prize (chefModel REWARD_KEYS) <-> the table's.
export const CHEF_RESOURCE_MAP = { coins: 'coins', wild: 'wild', extraStock: 'stock', freeRound: 'entry', undo: 'undo' }
export function chefValuesFromEconomy(economy) {
  const out = {}
  for (const [chefKey, id] of Object.entries(CHEF_RESOURCE_MAP)) out[chefKey] = economy?.resources?.[id] ?? DEFAULT_RESOURCE_VALUES[id]
  return out
}
