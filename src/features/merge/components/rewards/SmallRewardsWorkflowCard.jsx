import { useMemo, useRef, useState } from 'react'
import { Wand2, TriangleAlert, CircleCheck, CircleDashed, FlaskConical, Undo2 } from 'lucide-react'
import Card from '../../../../components/ui/Card'
import Button from '../../../../components/ui/Button'
import InfoHint from '../../../../components/ui/InfoHint'
import { REWARD_TYPES, REWARD_TYPE_LABELS, REWARD_MAX_RANK, rewardPrizeAmount, validateRewardChainConfig } from '../../lib/rewards/rewardChain'
import { effectiveRewardTargets, validateConfigAcrossRuns } from '../../lib/rewards/rewardEconomy'
import { generateSmallRewardsConfiguration, splitTargets, SOLVER_EVAL_RUNS, SOLVER_EVAL_SEED } from '../../lib/rewards/smallRewardsWorkflow'

const fmt = (n, digits = 0) =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: digits })

// The persisted sourceAllocation shape (tileWeight/dropWeight fractions +
// an optional perResource override map) -> the solver's split input. One
// function so the active segment's solve and the all-segments run can never
// read a segment's split two different ways.
function splitFromAllocation(allocation) {
  const tw = allocation?.tileWeight ?? 0.5
  const dw = allocation?.dropWeight ?? 0.5
  return {
    sharedTilePct: Math.round((tw + dw > 0 ? tw / (tw + dw) : 0.5) * 100),
    perResource: allocation?.perResource ?? {},
  }
}

const FEASIBILITY_LABEL = {
  ok: { label: 'Solved', className: 'bg-emerald-100 text-emerald-700' },
  'ladder-limited': { label: 'Closest feasible', className: 'bg-sky-100 text-sky-700' },
  'off-target': { label: 'Off target', className: 'bg-amber-100 text-amber-700' },
  infeasible: { label: 'Infeasible', className: 'bg-red-100 text-red-700' },
}

const LEFTOVER_POLICIES = [
  { id: 'forfeit', label: 'Forfeited', detail: 'Reward items still below rank 4 when the phase ends pay nothing.' },
  { id: 'collect', label: 'Collected by hand', detail: 'The player hand-collects each leftover item at its own rank’s prize when the phase ends.' },
]

// Everything a solve reads from one list, as a comparable string - any
// change marks a held proposal out of date.
function listKey(boards) {
  const b0 = boards[0]
  return [
    boards.map((b) => [b.id, b.blockedValue, b.minRank, b.maxRank, b.tiles, b.rewardQueueItems, b.rewardSemiItems, b.ccPercent, b.onboardingDrBudget, b.onboardingTargetRank]),
    b0?.rewardChainConfig,
    b0?.dropGroups,
    b0?.dropGroupsConfig,
    b0?.minDropRank,
    b0?.rewardLeftoverPolicy,
  ]
}

// The primary Small Rewards workflow: Targets -> Source split -> Generate ->
// Review and apply. The economist supplies reward DEFINITIONS (item syntax +
// prizes, in the advanced section) and the targets here; the app generates
// everything else - tile placements, drop groups, drop odds - from the real
// solvers and simulator. Nothing shown is mocked, and Apply writes the
// actual boards/config used by play, simulation, persistence, and exports.
export default function SmallRewardsWorkflowCard({
  phase, // 'main' | 'rc'
  phaseLabel,
  variantLabel = null, // RC only: 'Recompletion A' / 'Recompletion B'
  list, // this phase's own board list state (the selected RC variant's, for RC)
  mainList = null, // RC only: the main list the real run plays through first
  segment,
  isBaseSegment,
  baseTargets,
  segmentName,
  onUpdateRewardTargets,
  onUpdateSegmentFactor,
  onUpdateSourceAllocation,
  onOpenAdvanced = null, // (sectionId) => void - jump to a missing definition
  // Every segment's own inputs for this phase, base segment first:
  // [{ name, list, mainList, targets (already factor-derived), allocation }]
  allSegments = null,
}) {
  const boards = list.boards
  const board0 = boards[0]
  const targets = segment?.rewardTargets?.[phase] ?? {}
  const allocation = segment?.sourceAllocation?.[phase] ?? {}
  const derivedTargets = !isBaseSegment && baseTargets ? effectiveRewardTargets(baseTargets, segment?.segmentFactor ?? 1) : null
  const effectiveTargets = isBaseSegment ? effectiveRewardTargets(targets, 1) : derivedTargets
  const leftoverPolicy = board0?.rewardLeftoverPolicy ?? 'forfeit'
  // Drop odds are one shared configuration, owned by the base segment: every
  // other segment solves with the drops fixed and only its tiles moving.
  const dropsFixed = !isBaseSegment

  // --- Targets: draft strings, so an empty/invalid input is flagged rather
  // than silently becoming 0.
  const [targetDrafts, setTargetDrafts] = useState(() =>
    Object.fromEntries(REWARD_TYPES.map((t) => [t, targets?.[t] != null ? String(targets[t]) : '0'])),
  )
  const targetErrors = useMemo(() => {
    const errs = {}
    for (const type of REWARD_TYPES) {
      const raw = (targetDrafts[type] ?? '').trim()
      if (raw === '') errs[type] = 'Empty - type 0 for "no intended payout"'
      else if (!Number.isFinite(Number(raw)) || Number(raw) < 0) errs[type] = 'Not a valid non-negative number'
    }
    return errs
  }, [targetDrafts])
  const hasTargetErrors = isBaseSegment && Object.keys(targetErrors).length > 0

  function editTarget(type, raw) {
    setTargetDrafts((prev) => ({ ...prev, [type]: raw }))
    const n = Number(raw.trim())
    if (raw.trim() !== '' && Number.isFinite(n) && n >= 0) {
      onUpdateRewardTargets?.({ ...targets, [type]: n })
    }
  }

  // --- Source split: one shared percentage (both sides always total 100) +
  // optional per-resource overrides.
  const splitForSolve = splitFromAllocation(allocation)
  const { sharedTilePct, perResource } = splitForSolve
  const [showOverrides, setShowOverrides] = useState(() => Object.values(perResource).some((v) => v != null))

  function setSharedTilePct(pct) {
    const p = Math.min(100, Math.max(0, Math.round(Number(pct) || 0)))
    onUpdateSourceAllocation?.({ ...allocation, tileWeight: p / 100, dropWeight: (100 - p) / 100 })
  }
  function setResourceOverride(type, raw) {
    const next = { ...perResource }
    if (raw === '' || raw == null) delete next[type]
    else next[type] = Math.min(100, Math.max(0, Math.round(Number(raw) || 0)))
    onUpdateSourceAllocation?.({ ...allocation, perResource: next })
  }

  const perResourceKey = JSON.stringify(perResource)
  const { tileTargets, dropTargets } = useMemo(
    () => (effectiveTargets ? splitTargets(effectiveTargets, { sharedTilePct, perResource: JSON.parse(perResourceKey) }) : { tileTargets: {}, dropTargets: {} }),
    [effectiveTargets, sharedTilePct, perResourceKey],
  )

  // --- Readiness: the only thing Generate needs from the economist is valid
  // reward definitions for the resources being targeted.
  const readiness = useMemo(() => {
    const items = []
    const chain = board0?.rewardChainConfig
    for (const type of REWARD_TYPES) {
      if (!((effectiveTargets?.[type] ?? 0) > 0)) continue
      if (!(rewardPrizeAmount(chain, type, REWARD_MAX_RANK) > 0)) {
        items.push({ label: `${REWARD_TYPE_LABELS[type]}: rank-${REWARD_MAX_RANK} prize is missing (every payout is built from it)`, section: 'reward-definitions' })
      }
      const missingSyntax = (chain?.[type] ?? []).some((r) => !r.syntax)
      if (missingSyntax) items.push({ label: `${REWARD_TYPE_LABELS[type]}: a rank is missing its item syntax (needed for export)`, section: 'reward-definitions' })
    }
    return items
  }, [board0, effectiveTargets])

  // Prize ladders where an earlier rank pays more per source item than rank
  // 4: every prediction here assumes the player merges toward the
  // top rank, so for these resources a player who hand-collects early would
  // receive MORE than predicted. Not a blocker - a caveat on the numbers,
  // shown for the resources actually being targeted.
  const ladderCaveats = useMemo(
    () => (board0?.rewardChainConfig ? validateRewardChainConfig(board0.rewardChainConfig).filter((f) => (effectiveTargets?.[f.type] ?? 0) > 0) : []),
    [board0, effectiveTargets],
  )

  // --- Generate (async, staged, cancellable) + staleness tracking.
  const [genState, setGenState] = useState({ status: 'idle' }) // idle | running | done | error
  const [progress, setProgress] = useState('')
  const cancelRef = useRef(false)
  const inputsKey = JSON.stringify([effectiveTargets, dropsFixed ? null : splitForSolve, listKey(boards), phase === 'rc' ? listKey(mainList.boards) : null])
  const result = genState.status === 'done' ? genState.result : null
  const stale = result != null && genState.inputsKey !== inputsKey
  const applied = genState.status === 'done' && genState.applied

  async function handleGenerate() {
    cancelRef.current = false
    setGenState({ status: 'running' })
    setProgress('Starting…')
    try {
      const res = await generateSmallRewardsConfiguration({
        phase,
        boards,
        mainBoards: phase === 'rc' ? mainList.boards : null,
        targets: effectiveTargets,
        split: splitForSolve,
        dropsFixed,
        onProgress: setProgress,
        isCancelled: () => cancelRef.current,
      })
      if (res == null) setGenState({ status: 'idle' }) // cancelled
      else setGenState({ status: 'done', result: res, inputsKey, applied: false })
    } catch (err) {
      setGenState({ status: 'error', message: String(err?.message ?? err) })
    }
  }

  // Apply writes the REAL config through the same paths every manual edit
  // uses: each regenerated board via updateBoard, and (base segment only -
  // drops are shared) the generated drop groups + tables via
  // syncRewardConfig. A pre-apply snapshot gives a one-step Revert.
  const [undoSnapshot, setUndoSnapshot] = useState(null)
  function writeResult(targetList, res) {
    res.boards.forEach((b, i) => {
      if (b !== targetList.boards[i]) targetList.updateBoard(b)
    })
    if (!res.dropsFixed) targetList.syncRewardConfig({ dropGroups: res.dropGroups, dropGroupsConfig: res.dropGroupsConfig })
  }
  function snapshotList(targetList) {
    return {
      boards: targetList.boards.map((b) => ({ ...b })),
      dropGroups: JSON.parse(JSON.stringify(targetList.boards[0].dropGroups ?? [])),
      dropGroupsConfig: JSON.parse(JSON.stringify(targetList.boards[0].dropGroupsConfig ?? [])),
    }
  }
  function restoreList(targetList, snapshot, { includeDrops }) {
    snapshot.boards.forEach((b) => targetList.updateBoard(b))
    if (includeDrops) targetList.syncRewardConfig({ dropGroups: snapshot.dropGroups, dropGroupsConfig: snapshot.dropGroupsConfig })
  }
  function handleApply() {
    if (!result || stale) return
    setUndoSnapshot({ snapshot: snapshotList(list), includeDrops: !result.dropsFixed })
    writeResult(list, result)
    setGenState((prev) => ({ ...prev, applied: true }))
  }
  function handleRevert() {
    if (!undoSnapshot) return
    restoreList(list, undoSnapshot.snapshot, undoSnapshot)
    setUndoSnapshot(null)
    setGenState((prev) => (prev.status === 'done' ? { ...prev, applied: false } : prev))
  }

  // --- All segments: the base segment is solved first (it owns the shared
  // drop configuration), then every other segment is solved against THOSE
  // drops with only its own tile placements moving - so the eight results
  // really do form one valid shared configuration. Nothing is written until
  // "Apply to all", and that is reversible.
  const [multi, setMulti] = useState({ status: 'idle' })
  const [multiUndo, setMultiUndo] = useState(null)
  const multiKey = (segs) => JSON.stringify(segs.map((s) => [s.targets, s.allocation, listKey(s.list.boards), phase === 'rc' ? listKey(s.mainList.boards) : null]))
  const multiStale = multi.status === 'done' && allSegments && multi.key !== multiKey(allSegments)

  async function handleGenerateAll() {
    cancelRef.current = false
    setMulti({ status: 'running' })
    const key = multiKey(allSegments)
    const rows = []
    let sharedDrops = null
    for (let i = 0; i < allSegments.length; i++) {
      const seg = allSegments[i]
      if (cancelRef.current) return setMulti({ status: 'idle' })
      const hasTarget = REWARD_TYPES.some((t) => (seg.targets?.[t] ?? 0) > 0)
      if (!hasTarget) {
        rows.push({ name: seg.name, result: null, note: 'No targets (all zero) - skipped' })
        continue
      }
      try {
        const res = await generateSmallRewardsConfiguration({
          phase,
          boards: seg.list.boards,
          mainBoards: phase === 'rc' ? seg.mainList.boards : null,
          targets: seg.targets,
          split: splitFromAllocation(seg.allocation),
          dropsFixed: i > 0,
          sharedDrops: i > 0 ? sharedDrops : null,
          onProgress: (label) => setProgress(`Segment ${i + 1} of ${allSegments.length} (${seg.name}): ${label}`),
          isCancelled: () => cancelRef.current,
        })
        if (res == null) return setMulti({ status: 'idle' })
        if (i === 0) sharedDrops = { dropGroups: res.dropGroups, dropGroupsConfig: res.dropGroupsConfig }
        rows.push({ name: seg.name, result: res })
      } catch (err) {
        rows.push({ name: seg.name, result: null, note: `Failed: ${String(err?.message ?? err)}` })
      }
    }
    setMulti({ status: 'done', rows, key, applied: false })
  }

  function handleApplyAll() {
    if (multi.status !== 'done' || multiStale) return
    setMultiUndo(allSegments.map((seg) => snapshotList(seg.list)))
    const baseDrops = multi.rows[0]?.result
    multi.rows.forEach((row, i) => {
      if (!row.result) return
      writeResult(allSegments[i].list, row.result)
    })
    // The base segment's generated drops are the shared configuration -
    // written to every segment's list directly rather than waiting a render
    // for the sync effect to copy them across.
    if (baseDrops && !baseDrops.dropsFixed) {
      allSegments.slice(1).forEach((seg) => seg.list.syncRewardConfig({ dropGroups: baseDrops.dropGroups, dropGroupsConfig: baseDrops.dropGroupsConfig }))
    }
    setMulti((prev) => ({ ...prev, applied: true }))
  }

  function handleRevertAll() {
    if (!multiUndo) return
    multiUndo.forEach((snapshot, i) => restoreList(allSegments[i].list, snapshot, { includeDrops: true }))
    setMultiUndo(null)
    setMulti((prev) => (prev.status === 'done' ? { ...prev, applied: false } : prev))
  }

  // --- Seeded validation against the LIVE saved config - run it after Apply
  // so it validates what's actually saved.
  const [valState, setValState] = useState({ status: 'idle' })
  const [valRuns, setValRuns] = useState('100')
  const [valSeed, setValSeed] = useState('1')
  function handleValidate() {
    const runs = Math.max(1, Math.min(1000, Number(valRuns) || 100))
    const seed = Number(valSeed) || 1
    setValState({ status: 'running' })
    setTimeout(() => {
      const simBoards = phase === 'rc' ? mainList.boards : boards
      const simBoard0 = simBoards[0]
      const summary = validateConfigAcrossRuns(simBoards, {
        rewardChainConfig: simBoard0.rewardChainConfig,
        dropGroupsConfig: simBoard0.dropGroupsConfig,
        dropGroupsById: new Map((simBoard0.dropGroups ?? []).map((g) => [g.id, g])),
        minDropRank: simBoard0.minDropRank,
        leftoverPolicy: simBoard0.rewardLeftoverPolicy,
        rcBoards: phase === 'rc' ? boards : undefined,
        rcDropGroupsConfig: phase === 'rc' ? board0.dropGroupsConfig : undefined,
        rcDropGroupsById: phase === 'rc' ? new Map((board0.dropGroups ?? []).map((g) => [g.id, g])) : undefined,
        runs,
        seed,
      })
      setValState({ status: 'done', summary, inputsKey })
    }, 20)
  }
  const valStale = valState.status === 'done' && valState.inputsKey !== inputsKey

  const feasibility = result?.feasibility
  const status = !result
    ? null
    : stale
      ? { label: 'Out of date - inputs changed since this was generated', tone: 'amber' }
      : feasibility.status === 'infeasible'
        ? { label: `Infeasible - ${feasibility.infeasibleReasons.join('; ')}`, tone: 'red' }
        : valState.status === 'done' && !valStale && applied
          ? { label: `Simulation validated (${valState.summary.runs} seeded runs on the applied config)`, tone: 'green' }
          : {
              label: `Estimated from ${result.evaluation.runs} seeded simulation runs${
                feasibility.status === 'off-target'
                  ? ' - off target on ' + feasibility.offTarget.map((t) => REWARD_TYPE_LABELS[t]).join(', ')
                  : feasibility.status === 'ladder-limited'
                    ? ' - closest the prize ladder can pay'
                    : ''
              }`,
              tone: feasibility.status === 'off-target' ? 'amber' : 'slate',
            }
  const toneClass = { amber: 'bg-amber-100 text-amber-700', green: 'bg-emerald-100 text-emerald-700', red: 'bg-red-100 text-red-700', slate: 'bg-slate-100 text-slate-600' }

  return (
    <Card
      icon={Wand2}
      title={`Small Rewards setup - ${phaseLabel}`}
      subtitle={`Targets → source split → generate → review and apply${variantLabel ? ` · configures ${variantLabel}` : ''}`}
    >
      <div className="flex flex-col gap-5">
        {/* Context line - phase / segment / variant, always visible. */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-semibold">{phaseLabel}</span>
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold">
            {isBaseSegment ? `${segmentName} (base segment)` : `${segmentName} - derived ×${segment?.segmentFactor ?? 1}`}
          </span>
          {variantLabel && <span className="px-2 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-700 font-semibold">{variantLabel}</span>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl border border-slate-200 bg-white/60 px-3 py-2 text-slate-600">
            <span className="font-semibold text-slate-700">You supply:</span> reward definitions (item syntax and prize per rank - already filled
            from the reference values, editable under "Reward definitions and advanced settings") and the targets below.
          </div>
          <div className="rounded-xl border border-purple-200 bg-purple-50/60 px-3 py-2 text-slate-600">
            <span className="font-semibold text-purple-700">The app generates:</span> which reward items go under which tiles, the drop groups,
            and each merge rank's drop odds. No drop group needs to exist beforehand.
          </div>
        </div>

        {/* 1. Targets */}
        <section id="small-rewards-targets">
          <h3 className="text-sm font-display font-semibold text-slate-700 mb-1">1. Targets</h3>
          <p className="text-xs text-slate-500 mb-2">
            These targets include collectible rewards from both tiles and merge drops for the selected phase.
            {phase === 'rc' && ' RC targets are shared by Recompletion A and B; the proposal below configures only the selected variant.'}
          </p>
          {isBaseSegment ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {REWARD_TYPES.map((type) => (
                <label key={type} className="text-sm flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{REWARD_TYPE_LABELS[type]}</span>
                  <input
                    inputMode="decimal"
                    value={targetDrafts[type]}
                    onChange={(e) => editTarget(type, e.target.value)}
                    className={`border rounded-xl px-3 py-2 font-medium bg-white/70 focus:outline-none focus:ring-4 focus:ring-purple-200/60 ${
                      targetErrors[type] ? 'border-amber-400' : 'border-slate-200 focus:border-purple-400'
                    }`}
                  />
                  {targetErrors[type] && <span className="text-[11px] text-amber-600">{targetErrors[type]}</span>}
                </label>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-sm flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Segment factor</span>
                <input
                  inputMode="decimal"
                  value={segment?.segmentFactor ?? 1}
                  onChange={(e) => onUpdateSegmentFactor?.(Number(e.target.value) || 0)}
                  className="border border-slate-200 rounded-xl px-3 py-2 font-medium bg-white/70 w-24"
                />
              </label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
                {REWARD_TYPES.map((type) => (
                  <div key={type} className="text-sm">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{REWARD_TYPE_LABELS[type]}</div>
                    <div className="font-display font-semibold text-slate-700">{fmt(derivedTargets?.[type], 1)}</div>
                    <div className="text-[10px] text-slate-400">
                      base {fmt(baseTargets?.[type])} × {segment?.segmentFactor ?? 1}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 2. Source split */}
        <section>
          <h3 className="text-sm font-display font-semibold text-slate-700 mb-1">2. Source split</h3>
          {dropsFixed ? (
            <p className="text-xs text-slate-600 rounded-xl border border-purple-200 bg-purple-50/60 px-3 py-2">
              Merge-drop odds are one shared configuration across all segments, set on the base segment (Segment 1). This segment keeps those
              drops as they are and reaches its own target through what is its own: the reward items under its tiles. So there is no split to
              set here - the tiles make up whatever the shared drops don't deliver.
            </p>
          ) : (
            <>
              <p className="text-xs text-slate-500 mb-2">
                Both sources are small rewards: <strong>Under tiles</strong> (reward items hidden under blocked or semi-blocked tiles) vs{' '}
                <strong>From merge drops</strong> (reward items a main-chain merge drops onto the board). Items from both merge together toward
                rank {REWARD_MAX_RANK}, so the split divides one shared budget. It is a preference - the review reports the achieved split rather
                than silently forcing it.
              </p>
              <div className="flex items-center gap-3 max-w-xl">
                <span className="text-xs font-semibold text-slate-600 w-24">Under tiles</span>
                <input type="range" min={0} max={100} value={sharedTilePct} onChange={(e) => setSharedTilePct(e.target.value)} className="flex-1 accent-purple-600" />
                <span className="text-xs font-semibold text-slate-600 w-32 text-right">From merge drops</span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-sm">
                <input
                  inputMode="numeric"
                  aria-label="Percent under tiles"
                  value={sharedTilePct}
                  onChange={(e) => setSharedTilePct(e.target.value)}
                  className="border border-slate-200 rounded-lg px-2 py-1 w-16 text-right bg-white/70"
                />
                <span className="text-slate-500">
                  % under tiles · {100 - sharedTilePct}% from merge drops (always totals 100%)
                </span>
              </div>
              <button type="button" className="text-xs text-purple-600 hover:underline mt-2" onClick={() => setShowOverrides((v) => !v)}>
                {showOverrides ? 'Hide per-resource overrides' : 'Per-resource overrides…'}
              </button>
              {showOverrides && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
                  {REWARD_TYPES.map((type) => (
                    <label key={type} className="text-xs flex flex-col gap-1">
                      <span className="font-semibold uppercase tracking-wide text-slate-500">{REWARD_TYPE_LABELS[type]} - % under tiles</span>
                      <input
                        inputMode="numeric"
                        placeholder={`${sharedTilePct} (shared)`}
                        value={perResource[type] ?? ''}
                        onChange={(e) => setResourceOverride(type, e.target.value)}
                        className="border border-slate-200 rounded-lg px-2 py-1.5 bg-white/70"
                      />
                    </label>
                  ))}
                </div>
              )}
              {effectiveTargets && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                  {REWARD_TYPES.map((type) =>
                    (effectiveTargets[type] ?? 0) > 0 ? (
                      <div key={type} className="text-[11px] text-slate-500 rounded-xl border border-slate-100 p-2">
                        <div className="font-semibold text-slate-600">{REWARD_TYPE_LABELS[type]}</div>
                        <div>Under tiles: {fmt(tileTargets[type], 1)}</div>
                        <div>From merge drops: {fmt(dropTargets[type], 1)}</div>
                      </div>
                    ) : null,
                  )}
                </div>
              )}
            </>
          )}

          <div className="mt-3 text-xs">
            <div className="font-semibold text-slate-600 mb-1">Leftover reward items when the phase ends</div>
            <div className="flex flex-wrap gap-2">
              {LEFTOVER_POLICIES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={!isBaseSegment}
                  title={p.detail}
                  onClick={() => list.syncRewardConfig({ rewardLeftoverPolicy: p.id })}
                  className={`px-2.5 py-1 rounded-lg font-medium border ${
                    leftoverPolicy === p.id ? 'bg-purple-600 border-purple-600 text-white' : 'bg-white/70 border-slate-200 text-slate-600'
                  } ${!isBaseSegment ? 'opacity-70 cursor-not-allowed' : 'hover:border-purple-300'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-slate-500 mt-1">
              {LEFTOVER_POLICIES.find((p) => p.id === leftoverPolicy)?.detail} This is a stated assumption about player behaviour, not something
              the game guarantees - every prediction and simulation here follows it.{!isBaseSegment && ' Shared across segments; change it on Segment 1.'}
            </p>
          </div>
        </section>

        {/* Readiness checklist */}
        {readiness.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-sm">
            <div className="font-semibold text-amber-700 mb-1 flex items-center gap-1.5">
              <TriangleAlert size={14} /> Reward definitions to finish
            </div>
            <ul className="flex flex-col gap-1">
              {readiness.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-amber-700">
                  <CircleDashed size={13} className="mt-0.5 shrink-0" />
                  <span>
                    {item.label}
                    {item.section && onOpenAdvanced && (
                      <button type="button" className="ml-1 text-purple-600 hover:underline" onClick={() => onOpenAdvanced(item.section)}>
                        open
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {ladderCaveats.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800">
            <div className="font-semibold mb-1 flex items-center gap-1.5">
              <TriangleAlert size={13} /> Prize ladder caveat
            </div>
            <p className="mb-1">
              Predictions assume the player merges reward items toward rank {REWARD_MAX_RANK}. For{' '}
              {ladderCaveats.map((f) => REWARD_TYPE_LABELS[f.type]).join(', ')} the configured prizes pay more per item at an earlier rank, so a
              player who hand-collects early would receive more than predicted here.
            </p>
            {onOpenAdvanced && (
              <button type="button" className="text-purple-700 hover:underline" onClick={() => onOpenAdvanced('reward-definitions')}>
                Review the prize ladder
              </button>
            )}
          </div>
        )}

        {/* 3. Generate */}
        <section>
          <h3 className="text-sm font-display font-semibold text-slate-700 mb-1">3. Generate</h3>
          <div className="flex items-center gap-3">
            <Button variant="primary" icon={Wand2} onClick={handleGenerate} disabled={genState.status === 'running' || multi.status === 'running' || hasTargetErrors || !effectiveTargets}>
              {genState.status === 'running' ? 'Generating…' : 'Generate configuration'}
            </Button>
            {genState.status === 'running' && (
              <>
                <span className="text-xs text-slate-500">{progress}</span>
                <Button variant="ghost" size="sm" onClick={() => (cancelRef.current = true)}>
                  Cancel
                </Button>
              </>
            )}
          </div>
          <InfoHint>
            Each target is turned into a whole number of reward "source units" (a rank-1 item is 1, rank 2 is 2, rank 3 is 4; eight complete one
            rank-{REWARD_MAX_RANK} collect), split between tiles and merge drops, then placed as real items and real drop groups. Candidates are
            scored on {SOLVER_EVAL_RUNS} seeded simulation runs (seed {SOLVER_EVAL_SEED}) of the actual game engine - the simulated player merges
            reward items toward rank {REWARD_MAX_RANK}, spends collected energy on free ×1 taps, and only hand-collects below rank{' '}
            {REWARD_MAX_RANK} when the board is full. Your pinned items, locked drop groups and locked ranks are kept as they are. Nothing is
            saved until you Apply.
          </InfoHint>
          {genState.status === 'error' && <p className="text-sm text-red-600 mt-2">Generation failed: {genState.message}</p>}

          {allSegments && allSegments.length > 1 && (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" size="sm" onClick={handleGenerateAll} disabled={multi.status === 'running' || genState.status === 'running' || hasTargetErrors}>
                  {multi.status === 'running' ? 'Generating all…' : `Generate for all ${allSegments.length} segments`}
                </Button>
                {multi.status === 'running' && (
                  <>
                    <span className="text-xs text-slate-500">{progress}</span>
                    <Button variant="ghost" size="sm" onClick={() => (cancelRef.current = true)}>
                      Cancel
                    </Button>
                  </>
                )}
                <span className="text-[11px] text-slate-500">
                  Segment 1 is solved first and sets the shared drop configuration; every other segment is then solved against those same drops,
                  moving only its own tile items toward its own target (base × its factor)
                  {variantLabel ? `. RC proposals configure ${variantLabel}` : ''}.
                </span>
              </div>
              {multi.status === 'done' && (
                <>
                  <div className="overflow-x-auto mt-2">
                    <table className="text-xs border-collapse w-full min-w-[34rem]">
                      <thead>
                        <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          <th className="px-2 py-1">Segment</th>
                          <th className="px-2 py-1">Status</th>
                          {REWARD_TYPES.map((t) => (
                            <th key={t} className="px-2 py-1 text-right">
                              {REWARD_TYPE_LABELS[t]} (sim avg / target)
                            </th>
                          ))}
                          <th className="px-2 py-1 text-right">Effective subsidy</th>
                        </tr>
                      </thead>
                      <tbody>
                        {multi.rows.map((row, i) => {
                          const f = row.result ? FEASIBILITY_LABEL[row.result.feasibility.status] : null
                          return (
                            <tr key={i} className="border-t border-slate-200">
                              <td className="px-2 py-1 font-semibold text-slate-600">{row.name}</td>
                              <td className="px-2 py-1">
                                {f ? (
                                  <span className={`px-2 py-0.5 rounded-full font-semibold ${f.className}`} title={[...row.result.feasibility.infeasibleReasons, ...row.result.findings].join('\n')}>
                                    {f.label}
                                  </span>
                                ) : (
                                  <span className="text-slate-400">{row.note}</span>
                                )}
                              </td>
                              {REWARD_TYPES.map((t) => {
                                const r = row.result?.perResourceReview.find((x) => x.type === t)
                                return (
                                  <td key={t} className="px-2 py-1 text-right tabular-nums text-slate-600">
                                    {r && r.target > 0 ? `${fmt(r.predicted, 1)} / ${fmt(r.target, 1)}` : '—'}
                                  </td>
                                )
                              })}
                              <td className={`px-2 py-1 text-right tabular-nums ${row.result && row.result.energy.effectiveSubsidy < 0 ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>
                                {row.result ? `${fmt(row.result.energy.effectiveSubsidy, 1)} DR` : '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button variant="primary" size="sm" onClick={handleApplyAll} disabled={multiStale || multi.applied || multi.rows.every((r) => !r.result)}>
                      {multi.applied ? 'Applied to all' : 'Apply to all generated segments'}
                    </Button>
                    {multiUndo && (
                      <Button variant="ghost" size="sm" icon={Undo2} onClick={handleRevertAll}>
                        Revert apply to all
                      </Button>
                    )}
                    {multiStale && <span className="text-xs text-amber-600">Out of date - a segment's inputs changed; re-generate before applying.</span>}
                    {!multiStale && multi.rows.some((r) => r.result?.feasibility.status === 'infeasible') && (
                      <span className="text-xs text-amber-600">Infeasible segments apply their closest feasible proposal - hover a status for the reasons.</span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        {/* 4. Review and apply */}
        {result && (
          <section className="rounded-2xl border border-purple-200 bg-purple-50/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="text-sm font-display font-semibold text-slate-700">4. Review and apply</h3>
              {status && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${toneClass[status.tone]}`}>{status.label}</span>}
            </div>

            <div className="overflow-x-auto">
              <table className="text-sm border-collapse w-full min-w-[40rem]">
                <thead>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-1">Resource</th>
                    <th className="px-2 py-1 text-right">Target</th>
                    <th className="px-2 py-1 text-right">Predicted</th>
                    <th className="px-2 py-1 text-right">Difference</th>
                    <th className="px-2 py-1 text-right">Under tiles</th>
                    <th className="px-2 py-1 text-right">Merge drops</th>
                    <th className="px-2 py-1 text-right">Split (req → achieved)</th>
                    <th className="px-2 py-1 text-right">p10 – p90</th>
                  </tr>
                </thead>
                <tbody>
                  {result.perResourceReview.map((row) => (
                    <tr key={row.type} className="border-t border-purple-100">
                      <td className="px-2 py-1 font-semibold text-slate-600">{REWARD_TYPE_LABELS[row.type]}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmt(row.target)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmt(row.predicted, 1)}</td>
                      <td className={`px-2 py-1 text-right tabular-nums ${Math.abs(row.diff) > row.target * 0.1 && row.target > 0 ? 'text-amber-600 font-semibold' : 'text-slate-500'}`}>
                        {row.diff >= 0 ? '+' : ''}
                        {fmt(row.diff, 1)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmt(row.tile, 1)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmt(row.drop, 1)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-500">
                        {row.requestedTilePct == null ? 'shared drops' : `${row.requestedTilePct}%`} → {row.achievedTilePct == null ? '—' : `${fmt(row.achievedTilePct)}%`}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-500">{row.target > 0 || row.predicted > 0 ? `${fmt(row.p10)} – ${fmt(row.p90)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Predicted = average over {result.evaluation.runs} seeded simulation runs (seed {result.evaluation.seed}); p10 – p90 is the spread across
              those runs. Under tiles + merge drops always add up to Predicted: each collected prize is attributed by where the items that built it
              came from.
            </p>

            {result.perResourceReview.some((r) => r.target > 0 && !r.exactlyPayable) && (
              <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50/70 p-2 text-xs text-sky-800">
                {result.perResourceReview
                  .filter((r) => r.target > 0 && !r.exactlyPayable)
                  .map((r) => (
                    <div key={r.type}>
                      {REWARD_TYPE_LABELS[r.type]}: the prize ladder can't pay exactly {fmt(r.target)} - the closest feasible payout is{' '}
                      <strong>{fmt(r.feasiblePayout)}</strong>
                      {result.leftoverPolicy === 'forfeit' ? ` (whole rank-${REWARD_MAX_RANK} prizes while leftovers are forfeited)` : ''}.
                    </div>
                  ))}
              </div>
            )}

            {result.leftoverPolicy === 'forfeit' && result.perResourceReview.some((r) => r.forfeited > 0) && (
              <p className="text-[11px] text-slate-500 mt-1">
                Left on the board unmerged at phase end, paying nothing under the current leftover policy (average hand-collect value):{' '}
                {result.perResourceReview
                  .filter((r) => r.forfeited > 0)
                  .map((r) => `${REWARD_TYPE_LABELS[r.type]} ${fmt(r.forfeited, 1)}`)
                  .join(' · ')}
                .
              </p>
            )}

            {/* Generated drop configuration */}
            {!result.dropsFixed && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white/70 p-3 text-sm">
                <div className="font-semibold text-slate-600 mb-1">Generated drop groups</div>
                {result.generatedGroups.length === 0 ? (
                  <p className="text-xs text-slate-500">None needed - the tile share (plus any groups you locked) already covers the targets.</p>
                ) : (
                  <ul className="flex flex-col gap-0.5 text-xs text-slate-600">
                    {result.generatedGroups.map((g) => (
                      <li key={g.id}>
                        <span className="font-semibold">{g.name.replace(/^Auto( bundle)?: /, '')}</span> - {fmt(g.p * 100, 1)}% of merges at every unlocked rank from{' '}
                        {board0?.minDropRank} up{Object.keys(g.items).length > 1 ? ' (drops together)' : ''}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-slate-400 mt-1">
                  Sized against about {fmt(result.eligibleMerges)} eligible merges this phase. Editable afterwards under "Drop groups" and "Drop weights
                  per resulting rank" - lock a group or a rank there to keep it through the next Generate.
                </p>
              </div>
            )}

            {/* Energy accounting */}
            <div className="mt-3 rounded-xl border border-slate-200 bg-white/70 p-3 text-sm">
              <div className="font-semibold text-slate-600 mb-1">Energy credit &amp; subsidy ({phaseLabel})</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-slate-600">
                <div>
                  Base subsidy
                  <div className="font-display font-semibold text-slate-700 tabular-nums">{fmt(result.energy.baseSubsidy)} DR</div>
                </div>
                <div>
                  After CC
                  <div className="font-display font-semibold text-slate-700 tabular-nums">{fmt(result.energy.ccAdjusted, 1)} DR</div>
                </div>
                <div>
                  Energy credit (80% of {fmt(result.energy.expectedCollectibleEnergy, 1)})
                  <div className="font-display font-semibold text-slate-700 tabular-nums">−{fmt(result.energy.energyCredit, 1)} DR</div>
                </div>
                <div>
                  Effective subsidy
                  <div className={`font-display font-semibold tabular-nums ${result.energy.effectiveSubsidy < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                    {fmt(result.energy.effectiveSubsidy, 1)} DR
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                effective = base × (1 + CC%) − 0.80 × simulated collectible energy (both sources), applied exactly once per phase. This is a planning
                figure: board subsidy values themselves are not changed by Apply.
              </p>
            </div>

            {result.findings.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {result.findings.map((f, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-amber-700">
                    <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            )}

            <details className="mt-2 text-xs text-slate-500">
              <summary className="cursor-pointer font-semibold">Technical breakdown</summary>
              <div className="mt-1 flex flex-col gap-1">
                <span>
                  {result.evaluations} candidate configuration{result.evaluations === 1 ? '' : 's'} simulated
                  {result.dropsFixed ? '' : `; kept the "${result.structure}" drop structure`}.
                </span>
                <span>
                  Reward items placed per board (under blocked tiles / on semi tiles):{' '}
                  {result.additionsByBoard.map((items, i) => `${boards[i]?.name ?? `Board ${i + 1}`}: ${items.length} / ${result.semiAdditionsByBoard[i].length}`).join(' · ')}
                </span>
                {REWARD_TYPES.map((t) => {
                  const r = result.placementPerResource[t]
                  const p = result.plan[t]
                  return p.target > 0 ? (
                    <span key={t}>
                      {REWARD_TYPE_LABELS[t]}: {p.units} source units budgeted ({fmt(p.feasiblePayout)}); tiles carry {r.unitsPlaced + r.pinnedUnits}
                      {r.pinnedUnits > 0 ? ` (${r.pinnedUnits} from your pinned items)` : ''}
                      {r.unitsUnplaced > 0 ? `, ${r.unitsUnplaced} did not fit` : ''}.
                    </span>
                  ) : null
                })}
              </div>
            </details>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={handleApply} disabled={stale || applied}>
                {applied ? 'Applied' : 'Apply configuration'}
              </Button>
              {undoSnapshot && (
                <Button variant="ghost" size="sm" icon={Undo2} onClick={handleRevert}>
                  Revert last apply
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => document.getElementById('small-rewards-targets')?.scrollIntoView({ behavior: 'smooth' })}>
                Adjust targets
              </Button>
            </div>
            {isBaseSegment && !result.dropsFixed && (
              <p className="text-[11px] text-slate-500 mt-1">
                Applying here also updates the shared drop configuration every other segment uses - re-run "Generate for all segments" afterwards
                so their tile items are re-fitted to it.
              </p>
            )}
            {stale && (
              <p className="text-xs text-amber-600 mt-1">
                Inputs changed since this proposal was generated - re-generate before applying, so an older result can never overwrite newer
                inputs.
              </p>
            )}
          </section>
        )}

        {/* 5. Validate with simulation */}
        <section>
          <h3 className="text-sm font-display font-semibold text-slate-700 mb-1">Validate with simulation</h3>
          <p className="text-xs text-slate-500 mb-2">
            A larger seeded run against the CURRENT saved config (apply first to validate a proposal), same engine and same simulated player as
            Generate: free merges first, reward items merged toward rank {REWARD_MAX_RANK} (collected automatically there), collected energy spent on
            free ×1 taps, a lower-rank reward hand-collected only to free a full board, leftovers at phase end{' '}
            {leftoverPolicy === 'collect' ? 'hand-collected' : 'forfeited'}. A heuristic player, not a claim of optimal play.
          </p>
          <div className="flex items-end gap-2">
            <label className="text-xs flex flex-col gap-1">
              <span className="font-semibold uppercase tracking-wide text-slate-500">Runs</span>
              <input inputMode="numeric" value={valRuns} onChange={(e) => setValRuns(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1.5 w-20 bg-white/70" />
            </label>
            <label className="text-xs flex flex-col gap-1">
              <span className="font-semibold uppercase tracking-wide text-slate-500">Seed</span>
              <input inputMode="numeric" value={valSeed} onChange={(e) => setValSeed(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1.5 w-20 bg-white/70" />
            </label>
            <Button variant="secondary" icon={FlaskConical} onClick={handleValidate} disabled={valState.status === 'running'}>
              {valState.status === 'running' ? 'Simulating…' : 'Run validation'}
            </Button>
          </div>
          {valState.status === 'done' && (
            <ValidationSummary summary={valState.summary} phase={phase} targets={effectiveTargets} stale={valStale} variantLabel={variantLabel} estimate={result && !stale ? result : null} />
          )}
        </section>
      </div>
    </Card>
  )
}

function ValidationSummary({ summary, phase, targets, stale, variantLabel, estimate }) {
  const phasePayouts = phase === 'rc' ? summary.payoutsRcPhase : summary.payoutsMainPhase
  const bySource = phase === 'rc' ? summary.payoutsRcPhaseBySource : summary.payoutsMainPhaseBySource
  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-white/70 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="font-semibold text-slate-600">
          {summary.runs} seeded runs (seed {summary.seed}){variantLabel ? ` · ${variantLabel}` : ''}
        </span>
        {stale && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Out of date - config changed since this ran</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse w-full min-w-[36rem]">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-2 py-1">Resource ({phase === 'rc' ? 'RC phase' : 'main phase'})</th>
              <th className="px-2 py-1 text-right">Target</th>
              <th className="px-2 py-1 text-right">Average</th>
              <th className="px-2 py-1 text-right">p10</th>
              <th className="px-2 py-1 text-right">p50</th>
              <th className="px-2 py-1 text-right">p90</th>
              <th className="px-2 py-1 text-right">Δ vs target</th>
              <th className="px-2 py-1 text-right">Tiles / drops</th>
              {estimate && <th className="px-2 py-1 text-right">vs estimate</th>}
            </tr>
          </thead>
          <tbody>
            {REWARD_TYPES.map((type) => {
              const s = phasePayouts?.[type]
              const target = targets?.[type] ?? 0
              const diff = (s?.mean ?? 0) - target
              const est = estimate?.perResourceReview.find((r) => r.type === type)?.predicted
              return (
                <tr key={type} className="border-t border-slate-100">
                  <td className="px-2 py-1 font-semibold text-slate-600">{REWARD_TYPE_LABELS[type]}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(target)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(s?.mean, 1)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(s?.p10, 1)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(s?.p50, 1)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(s?.p90, 1)}</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${target > 0 && Math.abs(diff) > target * 0.1 ? 'text-amber-600 font-semibold' : 'text-slate-500'}`}>
                    {diff >= 0 ? '+' : ''}
                    {fmt(diff, 1)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-500">
                    {fmt(bySource?.tile?.[type]?.mean, 1)} / {fmt(bySource?.drop?.[type]?.mean, 1)}
                  </td>
                  {estimate && (
                    <td className="px-2 py-1 text-right tabular-nums text-slate-500">
                      {est != null ? `${(s?.mean ?? 0) - est >= 0 ? '+' : ''}${fmt((s?.mean ?? 0) - est, 1)}` : '—'}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-4 mt-2 text-xs text-slate-600">
        <span className="flex items-center gap-1">
          <CircleCheck size={13} className="text-emerald-500" /> Main phase completed: {Math.round(summary.mainPhaseCompletionRate * 100)}%
        </span>
        {summary.rcEntryRate != null && (
          <span className="flex items-center gap-1">
            <CircleCheck size={13} className="text-emerald-500" /> Reached RC: {Math.round(summary.rcEntryRate * 100)}%
          </span>
        )}
        {summary.rcPhaseCompletionRate != null && (
          <span className="flex items-center gap-1">
            <CircleCheck size={13} className="text-emerald-500" /> RC grand prize reached: {Math.round(summary.rcPhaseCompletionRate * 100)}%
          </span>
        )}
        <span className="text-slate-400">
          DR spent: mean {fmt(summary.drSpent.mean)} (p10 {fmt(summary.drSpent.p10)} / p90 {fmt(summary.drSpent.p90)}) · energy-funded taps: mean{' '}
          {fmt(summary.energySpent.mean, 1)}
        </span>
      </div>
    </div>
  )
}
