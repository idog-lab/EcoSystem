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
    segments: (Array.isArray(raw.segments) ? raw.segments : []).map((s) => ({ id: String(s.id ?? ''), condition: String(s.condition ?? ''), effort: cleanEffort(s.effort) })).filter((s) => s.id),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
  }
}
export function normalizeSets(raw) {
  const list = Array.isArray(raw?.sets) ? raw.sets : Array.isArray(raw) ? raw : []
  return list.map(normalizeSet).filter(Boolean)
}

// The plan's segments, ready for a set: [{ id, condition, effort }], an effort kept from `before` by the same id.
export function setSegmentsOf(plan, before = []) {
  const result = buildPlan(plan)
  const efforts = new Map(before.map((s) => [s.id, s.effort]))
  return { errors: result.errors, segments: result.segments.map((s) => ({ id: setSegmentId(s.name, plan), condition: s.condition, effort: efforts.get(setSegmentId(s.name, plan)) ?? null })) }
}

// Saves the flow as a set: a new one, or the set of that name brought up to the flow (its efforts kept by segment).
// Returns { sets, set, created } or { error }.
export function saveFlowAsSet(sets, plan, name, now = new Date().toISOString()) {
  // No name typed: the set is named after its placeholder (the feature typed in the flow).
  const clean = String(name ?? '').trim() || String(plan?.feature ?? '').trim()
  if (!clean) return { error: 'Type a name for the set.' }
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

// A set as a feature takes it: its flow with the feature's name, and each segment's name, key, condition and effort.
// { plan, segments: [{ name, key, condition, effort }], errors }
export function setForFeature(set, feature) {
  const plan = { ...set.plan, feature }
  const result = buildPlan(plan)
  const efforts = new Map(set.segments.map((s) => [s.id, s.effort]))
  return {
    plan,
    errors: result.errors,
    segments: result.segments.map((s) => ({ name: s.name, key: s.key, condition: s.condition, effort: efforts.get(setSegmentId(s.name, plan)) ?? null })),
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
