// SEGMENT SETS: segments kept to be used again, each with its effort (economist, 26 Nov 2026: "we got features that
// are live for 2 days and are from levels. for those events we hold the same segments with the same effort (each
// segment gets a base of Brut Wins as the effort of the segment). i want us to create a memory of segment chunks with
// their demand if given ... when lets say i go into the disco (which can be 2 days from level) i can pick the segments
// from a drop list and ill get the effort also for those segments. i need in the segments section in the economy to be
// able to edit those for all in one time"). Asked:
//   - the effort is typed in Brut Wins per segment ("Brut Wins per segment"); a feature turns it into its own demand
//     only once that is taught - nothing here converts it;
//   - a set is made by saving the segment flow ("Save from the segment flow");
//   - a feature that picks a set COPIES it ("Copied when picked"): later edits change later picks; the feature says
//     when its set has changed since and offers the new numbers.
// A set keeps its flow (the plan) and its segments by their name WITHOUT the feature (BW_0_2500, BW_0_2500_Mode_0_3),
// so the same set serves every feature: picked in Merge, its segments are named Merge_..., in Disco Disco_...
// The feature typed in the flow when the set was saved is the set's NAME PLACEHOLDER (economist: "if we make generic
// 2d_levels segments, we will hold the 2D_LEVELS as a name placeholder that changes between features that use the
// segments"): the set shows 2D_Levels_BW_0_9, a feature that takes it puts its own name there.
import { useEffect, useState } from 'react'
import { buildPlan } from './segmentFlow'

export const SEGMENT_SETS_KEY = 'economy-segment-sets'
const EVENT = 'economy-segment-sets-changed'

export const featureOf = (plan) => String(plan?.feature ?? '').trim().replace(/\s+/g, '_') || 'Feature'
// A segment's name without its feature: "Disco_BW_0_2500" -> "BW_0_2500".
// The set's name placeholder: the feature typed when it was saved ("2D_Levels").
export const setPlaceholder = (set) => featureOf(set?.plan)
// GENERIC SEGMENTS (economist, 26 Nov 2026: "i want sometime like we talked to create a generic segment that will be
// overriden with the features name. so i dont have a feature name to put in"): the feature may be left empty on the
// Economy page; the set's name then stands in for it - "2D_Levels" gives 2D_Levels_BW_0_9 - and is kept as the set's
// placeholder. The name made fit for a segment's name: letters, digits and "_".
export const namePlaceholder = (name) =>
  String(name ?? '')
    .replace(/[^A-Za-z0-9_ ]/g, ' ')
    .trim()
    .replace(/\s+/g, '_')
// The plan as it is named: its feature, or - when none is typed - the placeholder from the set's name ('Feature' if none).
export const isGeneric = (plan) => !String(plan?.feature ?? '').trim()
export const namedPlan = (plan, setName) => (isGeneric(plan) ? { ...plan, feature: namePlaceholder(setName) || 'Feature' } : plan)
export function setSegmentId(name, plan) {
  const prefix = `${featureOf(plan)}_`
  return String(name).startsWith(prefix) ? String(name).slice(prefix.length) : String(name)
}
const newId = () => `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const cleanEffort = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v))

function normalizeSet(raw) {
  if (!raw || typeof raw !== 'object' || !raw.plan || typeof raw.plan !== 'object') return null
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    name: String(raw.name ?? '').trim() || 'Unnamed set',
    plan: raw.plan,
    segments: (Array.isArray(raw.segments) ? raw.segments : [])
      .map((s) => ({ id: String(s.id ?? ''), condition: String(s.condition ?? ''), effort: cleanEffort(s.effort), effortOf: typeof s.effortOf === 'string' && s.effortOf ? s.effortOf : null, effortFactor: cleanEffort(s.effortFactor) }))
      .filter((s) => s.id),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
  }
}
export function normalizeSets(raw) {
  const list = Array.isArray(raw?.sets) ? raw.sets : Array.isArray(raw) ? raw : []
  return list.map(normalizeSet).filter(Boolean)
}

// The plan's segments, ready for a set: [{ id, condition, effort, effortOf, effortFactor }], what was given for a
// segment kept from `before` by the same id (a segment followed that is gone leaves its follower typed).
export function setSegmentsOf(plan, before = []) {
  const result = buildPlan(plan)
  const kept = new Map(before.map((s) => [s.id, s]))
  const ids = new Set(result.segments.map((s) => setSegmentId(s.name, plan)))
  return {
    errors: result.errors,
    segments: result.segments.map((s) => {
      const id = setSegmentId(s.name, plan)
      const k = kept.get(id)
      const follows = k?.effortOf && ids.has(k.effortOf)
      return { id, condition: s.condition, effort: k?.effort ?? null, effortOf: follows ? k.effortOf : null, effortFactor: follows ? (k.effortFactor ?? null) : null }
    }),
  }
}

// A SEGMENT'S EFFORT IN A SET (economist, 26 Nov 2026, of a set's mode splits: "where we see a mode split i want to
// have a factor on the effort between those ones"): typed, or another segment's of the set x a factor - followed
// through a chain. { [id]: { value, problem } }: no value when the chain comes back to itself, names a segment that is
// not there, has no factor, or ends on a segment with no effort.
export function setEfforts(set) {
  const byId = new Map((set?.segments ?? []).map((s) => [s.id, s]))
  const out = {}
  const walk = (seg, seen) => {
    if (out[seg.id]) return out[seg.id]
    if (!seg.effortOf) return { value: seg.effort ?? null, problem: null }
    if (seen.has(seg.id)) return { value: null, problem: 'It follows a segment that follows it back.' }
    const from = byId.get(seg.effortOf)
    if (!from) return { value: null, problem: 'It follows a segment that is not in the set.' }
    if (seg.effortFactor == null) return { value: null, problem: `Type its factor of ${from.id}.` }
    const r = walk(from, new Set([...seen, seg.id]))
    return r.value == null ? { value: null, problem: r.problem ?? `${from.id} has no effort yet.` } : { value: Math.round(r.value * seg.effortFactor * 100) / 100, problem: null }
  }
  for (const seg of set?.segments ?? []) out[seg.id] = walk(seg, new Set())
  return out
}

// The mode splits of a set: the segments that differ only by their _Mode_ part, in order - [[id, id, ...]].
export function modeGroups(set) {
  const groups = new Map()
  for (const seg of set?.segments ?? []) {
    const at = seg.id.indexOf('_Mode_')
    if (at < 0) continue
    const head = seg.id.slice(0, at)
    if (!groups.has(head)) groups.set(head, [])
    groups.get(head).push(seg.id)
  }
  return [...groups.values()].filter((g) => g.length > 1)
}

// Saves the flow as a set: a new one, or the set of that name brought up to the flow (its efforts kept by segment).
// Returns { sets, set, created } or { error }.
export function saveFlowAsSet(sets, typedPlan, name, now = new Date().toISOString()) {
  // No name typed: the set is named after its placeholder (the feature typed in the flow).
  const clean = String(name ?? '').trim() || String(typedPlan?.feature ?? '').trim()
  if (!clean) return { error: isGeneric(typedPlan) ? 'Type a name for the set: with no feature, it is the name placeholder.' : 'Type a name for the set.' }
  if (isGeneric(typedPlan) && !namePlaceholder(clean)) return { error: 'The set\'s name stands for the feature: it needs letters or digits.' }
  // No feature typed: generic segments, the set's name the placeholder.
  const plan = namedPlan(typedPlan, clean)
  const existing = sets.find((s) => s.name.toLowerCase() === clean.toLowerCase())
  const { errors, segments } = setSegmentsOf(plan, existing?.segments ?? [])
  if (errors.length) return { error: `The flow has something to fix first: ${errors[0]}` }
  if (!segments.length) return { error: 'The flow makes no segment yet.' }
  const set = { id: existing?.id ?? newId(), name: clean, plan: { ...plan }, segments, updatedAt: now }
  return { sets: existing ? sets.map((s) => (s.id === existing.id ? set : s)) : [...sets, set], set, created: !existing }
}

// One set changed (a name, an effort): the set gets a new time, so a feature that copied it can tell.
export function editSet(sets, id, change, now = new Date().toISOString()) {
  return sets.map((s) => (s.id === id ? { ...s, ...change(s), updatedAt: now } : s))
}
export const setEffort = (sets, id, segmentId, effort, now) =>
  editSet(sets, id, (s) => ({ segments: s.segments.map((x) => (x.id === segmentId ? { ...x, effort: cleanEffort(effort) } : x)) }), now)
// A segment's effort set to follow another of the set x a factor (ofId null: typed again, with the effort it had).
export const setEffortFollow = (sets, id, segmentId, ofId, factor, now) =>
  editSet(
    sets,
    id,
    (s) => {
      const values = setEfforts(s)
      return { segments: s.segments.map((x) => (x.id !== segmentId ? x : ofId ? { ...x, effortOf: ofId, effortFactor: cleanEffort(factor) } : { ...x, effortOf: null, effortFactor: null, effort: x.effort ?? values[x.id]?.value ?? null })) }
    },
    now,
  )
// Every mode split of the set at once: each part after the first follows the part before it x `factor`.
export const setModeFactor = (sets, id, factor, now) =>
  editSet(
    sets,
    id,
    (s) => {
      const follow = new Map(modeGroups(s).flatMap((g) => g.slice(1).map((segId, k) => [segId, g[k]])))
      return { segments: s.segments.map((x) => (follow.has(x.id) ? { ...x, effortOf: follow.get(x.id), effortFactor: cleanEffort(factor) } : x)) }
    },
    now,
  )

// A set as a feature takes it: its flow with the feature's name, and each segment's name, key, condition and effort -
// the effort in force (a factor worked out), and, for a feature that keeps the link, the key of the segment it follows
// and the factor. { plan, segments: [{ name, key, condition, effort, effortOf, effortFactor }], errors }
export function setForFeature(set, feature) {
  const plan = { ...set.plan, feature }
  const result = buildPlan(plan)
  const values = setEfforts(set)
  const byId = new Map(set.segments.map((s) => [s.id, s]))
  const keyOfId = new Map(result.segments.map((s) => [setSegmentId(s.name, plan), s.key]))
  return {
    plan,
    errors: result.errors,
    segments: result.segments.map((s) => {
      const id = setSegmentId(s.name, plan)
      const own = byId.get(id)
      return { name: s.name, key: s.key, condition: s.condition, effort: values[id]?.value ?? null, effortOf: own?.effortOf ? (keyOfId.get(own.effortOf) ?? null) : null, effortFactor: own?.effortOf ? own.effortFactor : null }
    }),
  }
}

// --- In this browser (and the team's, when connected: lib/teamData.js shares the key) -------------------------------
export function loadSets() {
  try {
    return normalizeSets(JSON.parse(window.localStorage.getItem(SEGMENT_SETS_KEY)))
  } catch {
    return []
  }
}
export function saveSets(sets) {
  window.localStorage.setItem(SEGMENT_SETS_KEY, JSON.stringify({ sets }))
  window.dispatchEvent(new Event(EVENT))
}
// The sets, kept up to date when another page (or the team's latest) changes them.
export function useSegmentSets() {
  const [sets, setSets] = useState(loadSets)
  useEffect(() => {
    const reload = () => setSets(loadSets())
    window.addEventListener(EVENT, reload)
    window.addEventListener('storage', reload)
    return () => {
      window.removeEventListener(EVENT, reload)
      window.removeEventListener('storage', reload)
    }
  }, [])
  return sets
}
