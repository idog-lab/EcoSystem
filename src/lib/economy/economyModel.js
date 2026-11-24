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

import { GAME_PACKS, GAME_PRESETS, GAME_PRESETS_CHEF } from './gameKeys'

export const ECONOMY_VERSION = 4

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

// The economist's table. (Energy, "energy:N", was in the first text and is not used - economist: "u can remove
// this energy".)
export const DEFAULT_RESOURCE_VALUES = { coins: 1, wild: 2.5, stock: 2, undo: 0.25, entry: 1 }

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
export function createCurrency({ name = '', feature = '', valueGameplay = null, daily = '', startDate = '', endDate = '', note = '', ownName = false } = {}) {
  return { name, feature, valueGameplay, daily, startDate, endDate, note, ownName }
}

// The names the economist gave (section 3), the three Merge Mania reads, and
// the one this app made up. No value is known for any of them but dr-hidden.
const SEED_CURRENCIES = [
  createCurrency({ name: 'dr-puzzle', feature: 'Puzzle', note: 'Loses value day by day: paste its dated values.' }),
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
  chests: ['pink-chest', 'yellow-chest'].map((key) => createKey({ key })),
  triggers: ['Pity', 'dailyreward_lowhabit', '_diamond_mine_tier_3', 'sugar_rush_tier_gp'].map((key) => createKey({ key })),
  buckets: ['milestone', 'store_allowance'].map((key) => createKey({ key })),
}

// Chef baskets: the presets Chef__<Basic|Rare|Epic>_Phase_<1|2>_... on the list (which kinds exist is the list's,
// not a pattern's: Basic is Undo, Allowance or Free round; Rare Allowance, Free round or Extra stock; Epic Extra
// stock, Wild or Free_round3). Worth by tier, the same every day for now (economist: "as for now the basket values
// are like i gave u, when the chef model in the app will be better we will change its value daily").
export const CHEF_BASKET_TIERS = ['Basic', 'Rare', 'Epic']
export const DEFAULT_CHEF_BASKET_VALUES = { Basic: 0.25, Rare: 1, Epic: 4 }
export const CHEF_BASKET_TIER = /^Chef__(Basic|Rare|Epic)_Phase_/
export const chefBasketKeys = (economy, { pricing = false } = {}) => (economy?.keys?.presets ?? []).map((k) => k.key).filter((k) => CHEF_BASKET_TIER.test(k) && (pricing || !/_pricing_/.test(k)))

export function createEconomy(overrides = {}) {
  const keys = {}
  for (const list of KEY_LISTS) keys[list.id] = (overrides.keys?.[list.id] ?? SEED_KEYS[list.id] ?? []).map((k) => createKey(k))
  return {
    version: ECONOMY_VERSION,
    // (Only the resources of the table: one an older save still holds, like energy, is dropped.)
    resources: Object.fromEntries(Object.keys(DEFAULT_RESOURCE_VALUES).map((id) => [id, overrides.resources?.[id] !== undefined ? overrides.resources[id] : DEFAULT_RESOURCE_VALUES[id]])),
    currencies: (overrides.currencies ?? SEED_CURRENCIES).map((c) => createCurrency(c)),
    keys,
    chefBaskets: { ...DEFAULT_CHEF_BASKET_VALUES, ...(overrides.chefBaskets ?? {}) },
    updatedAt: overrides.updatedAt ?? null,
  }
}

// Version 4: the game's keys (gameKeys.js) are added to a saved economy's lists - what it holds stays, a key
// typed there keeps its worth - and a pack with no worth gets 0.
function upgradeKeys(keys, version) {
  if (!keys || version >= 4) return keys
  const out = { ...keys }
  for (const list of KEY_LISTS) {
    const have = new Map((keys[list.id] ?? []).map((k) => [k.key, k]))
    for (const k of SEED_KEYS[list.id] ?? []) if (!have.has(k.key)) have.set(k.key, k)
    out[list.id] = [...have.values()].map((k) => (list.id === 'packs' && (k.value == null || k.value === '') ? { ...k, value: 0 } : k))
  }
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

// A currency's worth of one unit (game play). With dated values, the date is clamped to the
// first and last date given, and a date between two reads the last one
// before it. null when nothing is known.
export function currencyValue(currency, { date = null } = {}) {
  if (!currency) return null
  if (currency.daily) {
    const { entries } = parseDailyValues(currency.daily)
    if (entries.length) {
      if (!date) return { value: entries[0].value, date: entries[0].date, dated: true, clamped: false, noDate: true }
      const first = entries[0]
      const last = entries[entries.length - 1]
      if (date <= first.date) return { value: first.value, date: first.date, dated: true, clamped: date < first.date }
      if (date >= last.date) return { value: last.value, date: last.date, dated: true, clamped: date > last.date }
      let hit = first
      for (const e of entries) if (e.date <= date) hit = e
      return { value: hit.value, date: hit.date, dated: true, clamped: false }
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
