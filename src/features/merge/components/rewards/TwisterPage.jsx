import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Tornado, TriangleAlert, CircleCheck, ClipboardPaste, Play, Square, Wand2, Check, Undo2, ChevronDown, ChevronRight, Users, Share2 } from 'lucide-react'
import Card from '../../../../components/ui/Card'
import Button from '../../../../components/ui/Button'
import InfoHint from '../../../../components/ui/InfoHint'
import { REWARD_TYPES, REWARD_TYPE_LABELS, REWARD_MAX_RANK, TWISTER_TYPE, ensureRewardChainConfig, validateRewardLadder, withTypedLadders, twisterItemSyntax } from '../../lib/rewards/rewardChain'
import { DEFAULT_MIN_DROP_RANK } from '../../lib/rewards/dropGroups'
import { MAX_RANK, RC_MAX_RANK } from '../../lib/core/ranks'
import { parseRewardDefinitionRows } from '../../lib/rewards/rewardDefinitionsPaste'
import {
  applyTwisterDropRule,
  readTwisterDropRule,
  twisterDropOdds,
  twisterIsConfigured,
  analyzeTwisterIncome,
  suggestSpinCost,
  evaluateSpinCost,
  twisterAnalysisKey,
  targetSpinsForSegment,
  groupHasTwister,
  hasTwisterDrops,
} from '../../lib/rewards/twisterEconomy'
import GameArt from '../play/GameArt'
import { hashOf } from '../../lib/build/eventBuild'

const STEPS = ['Configure Twister drops', 'Choose progression checkpoint', 'Analyze DR income', 'Suggest spin costs', 'Review and apply']

const fmt = (v, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: digits }))
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`)
const parsePositiveInt = (text) => {
  if (text == null || String(text).trim() === '') return null
  const n = Number(text)
  return Number.isInteger(n) && n >= 1 ? n : NaN
}

const STOP_REASON_LABEL = {
  'no-legal-move': 'board filled up with no move left',
  'max-steps': 'hit the step limit',
  'budget-exhausted': 'ran out of DR budget',
  'max-rank-reached': 'finished the phase first',
  'rc-max-rank-reached': 'finished the phase first',
  'never-entered-rc': 'never entered the RC round',
}

function SharedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 text-purple-700 text-[11px] font-semibold px-2.5 py-1">
      <Share2 size={11} /> Shared across all segments
    </span>
  )
}

function SegmentBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold px-2.5 py-1">
      <Users size={11} /> One price per segment
    </span>
  )
}

function boardsNeedGeneration(boards) {
  return (boards ?? []).some((b) => {
    const subsidyTiles = b.tiles.flat().filter((t) => t === 'blocked' || t === 'semi').length
    return subsidyTiles > 0 && (b.semiPlacements?.length ?? 0) + (b.blockedQueue?.length ?? 0) === 0
  })
}

export default function TwisterPage({ phase, phaseLabel, activeSegmentIndex, baseList, plan, onUpdatePlan, segments, onOpenRewards, source = 'applied', onSourceChange, draft = null, draftCurrent = false, onRebuild, results = null, onResultsChange = null }) {
  const board0 = baseList.boards[0]
  const rewardChainConfig = useMemo(() => ensureRewardChainConfig(board0?.rewardChainConfig), [board0?.rewardChainConfig])
  const ladder = rewardChainConfig[TWISTER_TYPE]
  const dropGroups = board0?.dropGroups ?? []
  const dropGroupsConfig = board0?.dropGroupsConfig ?? []
  const minDropRank = board0?.minDropRank ?? DEFAULT_MIN_DROP_RANK
  const leftoverPolicy = board0?.rewardLeftoverPolicy ?? 'collect'
  const spinObjective = board0?.twisterSpinObjective ?? null
  const phaseMaxRank = phase === 'rc' ? RC_MAX_RANK : MAX_RANK

  // ---------- 1. Shared Twister definitions and drops ----------
  const [pasteDraft, setPasteDraft] = useState('')
  const [pasteFeedback, setPasteFeedback] = useState(null)
  const currentRule = readTwisterDropRule(dropGroups, dropGroupsConfig, minDropRank)
  const [ruleRank, setRuleRank] = useState(currentRule?.itemRank ?? 1)
  const [rulePerMille, setRulePerMille] = useState(currentRule?.perMille != null ? String(currentRule.perMille) : '')
  const [ruleFindings, setRuleFindings] = useState(null)
  const [objectiveDraft, setObjectiveDraft] = useState(spinObjective == null ? '' : String(spinObjective))

  const ladderConfigured = twisterIsConfigured(rewardChainConfig)
  const ladderIssues = validateRewardLadder(ladder)
  const odds = twisterDropOdds(dropGroups, dropGroupsConfig, { minDropRank, rewardChainConfig, maxRank: phaseMaxRank })
  const dropsPresent = odds.some((r) => r.probability > 0)
  const handMadeTwisterGroups = dropGroups.filter((g) => groupHasTwister(g) && !g.twisterRule)

  function updateLadder(rankIndex, patch) {
    const next = JSON.parse(JSON.stringify(rewardChainConfig))
    next[TWISTER_TYPE][rankIndex] = { ...next[TWISTER_TYPE][rankIndex], ...patch }
    baseList.syncRewardConfig({ rewardChainConfig: withTypedLadders(rewardChainConfig, next) })
  }

  function applyPaste() {
    const result = parseRewardDefinitionRows(pasteDraft, rewardChainConfig, { allowedTypes: [TWISTER_TYPE], fixedType: TWISTER_TYPE })
    setPasteFeedback({ ok: result.ok, messages: result.messages })
    if (!result.ok) return
    baseList.syncRewardConfig({ rewardChainConfig: withTypedLadders(rewardChainConfig, result.rewardChainConfig) })
    setPasteDraft('')
  }

  const rulePerMilleValue = rulePerMille.trim() === '' ? null : Number(rulePerMille)
  const ruleValid = rulePerMilleValue != null && Number.isFinite(rulePerMilleValue) && rulePerMilleValue >= 0 && rulePerMilleValue <= 1000

  function applyRule() {
    if (!ruleValid) return
    // With a "two or more items from rank N" rule on this list, the Twister
    // item stays bundled with the reward item it was bundled with.
    const bundled = dropGroups.find((g) => g?.twisterRule === true && Object.keys(g.items ?? {}).length > 1)
    const companion = bundled ? Object.entries(bundled.items).find(([type]) => type !== 'twister') : null
    const result = applyTwisterDropRule({
      dropGroups,
      dropGroupsConfig,
      minDropRank,
      itemRank: ruleRank,
      perMille: rulePerMilleValue,
      // On a built design every merge already drops a container, so there is
      // no "nothing" weight to take: the rest comes off the containers the
      // build made (it makes them again on the next build anyway).
      fromAuto: true,
      bundleFromRank: baseList.boards[0]?.multiDropRank ?? null,
      bundleWith: companion ? { type: companion[0], rank: companion[1] } : null,
    })
    // A rule written here is the economist's own: the build keeps it and no
    // longer sizes the Twister drops itself (Build event, step 4, turns that
    // back on).
    baseList.syncRewardConfig({ dropGroups: result.dropGroups, dropGroupsConfig: result.dropGroupsConfig, twisterByBuild: false })
    setRuleFindings(result.findings)
  }

  function commitObjective(text) {
    setObjectiveDraft(text)
    const n = parsePositiveInt(text)
    if (n === null) baseList.syncRewardConfig({ twisterSpinObjective: null })
    else if (!Number.isNaN(n)) baseList.syncRewardConfig({ twisterSpinObjective: n })
  }

  // ---------- 2. Checkpoint + target (design inputs) ----------
  const [checkpointDraft, setCheckpointDraft] = useState(String(plan.checkpointPct))
  const [targetDraft, setTargetDraft] = useState(plan.targetSpins == null ? '' : String(plan.targetSpins))
  const [incrementDraft, setIncrementDraft] = useState(String(plan.costIncrement ?? 1))
  const [runsDraft, setRunsDraft] = useState(String(plan.runs))
  const [seedDraft, setSeedDraft] = useState(String(plan.seed))

  function commitPlanNumber(field, text, { min, max, integer = true, allowEmpty = false }) {
    if (text.trim() === '') {
      if (allowEmpty) onUpdatePlan({ ...plan, [field]: null })
      return
    }
    const n = Number(text)
    if (!Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min || n > max) return
    onUpdatePlan({ ...plan, [field]: n })
  }

  function setOverride(index, text) {
    const overrides = { ...(plan.targetSpinsOverrides ?? {}) }
    const n = parsePositiveInt(text)
    if (n === null) delete overrides[index]
    else if (!Number.isNaN(n)) overrides[index] = n
    else return
    onUpdatePlan({ ...plan, targetSpinsOverrides: overrides })
  }

  const targetInvalid = targetDraft.trim() !== '' && Number.isNaN(parsePositiveInt(targetDraft))
  const checkpointInvalid = !(Number(checkpointDraft) > 0 && Number(checkpointDraft) <= 100)

  // ---------- 3-5. Analysis, suggestion, application ----------
  // Analyses and suggestions are held by the app, not this tab, keyed by
  // phase + configuration + segment: leaving the tab and coming back, or
  // switching between the draft and the applied design, never loses a result
  // or shows it against the wrong configuration.
  const [localResults, setLocalResults] = useState({ analysis: {}, suggestions: {} })
  const store = results ?? localResults
  const setStore = onResultsChange ?? setLocalResults
  const analysis = store.analysis ?? {}
  const suggestions = store.suggestions ?? {}
  const setAnalysis = (update) => setStore((prev) => ({ ...prev, analysis: typeof update === 'function' ? update(prev.analysis ?? {}) : update }))
  const setSuggestions = (next) => setStore((prev) => ({ ...prev, suggestions: next }))
  const [costDrafts, setCostDrafts] = useState({})
  const [selected, setSelected] = useState(() => new Set(segments.map((_, i) => i)))
  const [progress, setProgress] = useState(null)
  const [openDetails, setOpenDetails] = useState(null)
  const [revertSnapshot, setRevertSnapshot] = useState(null)
  const [appliedNote, setAppliedNote] = useState(null)
  const cancelRef = useRef(false)
  useEffect(() => () => (cancelRef.current = true), [])

  // WHICH configuration is analyzed: the applied design, or the Build event
  // draft exactly as it would be once applied (its boards, with the draft's
  // shared drops on them). Results and suggested costs are stored per source,
  // so switching never shows one configuration's numbers against the other.
  const usingDraft = source === 'draft' && !!draft
  const draftSegment = (i) => (usingDraft ? (draft.segments.find((s) => s.index === i && s.status !== 'skipped') ?? null) : null)
  const draftBoards = (ds) => ds.boards.map((b) => ({ ...b, dropGroups: draft.shared?.dropGroups ?? b.dropGroups, dropGroupsConfig: draft.shared?.dropGroupsConfig ?? b.dropGroupsConfig }))
  const inputsFor = (i) => {
    const seg = segments[i]
    const settings = { phase, checkpointPct: plan.checkpointPct, runs: plan.runs, seed: plan.seed }
    if (usingDraft) {
      const ds = draftSegment(i)
      if (!ds) return null
      return phase === 'rc' ? { boards: seg.mainList.boards, rcBoards: draftBoards(ds), ...settings } : { boards: draftBoards(ds), rcBoards: null, ...settings }
    }
    return phase === 'rc' ? { boards: seg.mainList.boards, rcBoards: seg.list.boards, ...settings } : { boards: seg.list.boards, rcBoards: null, ...settings }
  }
  const sourceId = usingDraft ? `draft-${draft.builtAt}` : 'applied'
  const slot = (i) => `${phase}:${sourceId}:${i}`
  const keys = segments.map((_, i) => {
    const inputs = inputsFor(i)
    return inputs ? twisterAnalysisKey(inputs) : null
  })
  const targets = segments.map((_, i) => targetSpinsForSegment(plan, i, spinObjective))
  const increment = Math.max(1, Math.round(plan.costIncrement ?? 1))
  const suggestionKey = (i) => `${keys[i]}|${targets[i]}|${increment}`

  const rows = segments.map((seg, i) => {
    const a = analysis[slot(i)]
    const fresh = !!a && a.key === keys[i]
    const stale = !!a && !fresh
    const s = suggestions[slot(i)]
    const basis = seg.list.boards[0]?.twisterCostBasis ?? null
    const suggestionFresh = !!s && s.key === suggestionKey(i)
    const currentCost = seg.list.boards[0]?.twisterSpinCost ?? null
    const draftText = costDrafts[i] ?? (currentCost == null ? '' : String(currentCost))
    const draftCost = parsePositiveInt(draftText)
    const target = targets[i]
    const predicted = fresh && Number.isInteger(draftCost) && target ? evaluateSpinCost(a.summary.samples, draftCost, target, a.summary.samplesAllRuns) : null
    return {
      index: i,
      name: seg.name,
      summary: fresh ? a.summary : null,
      stale,
      notInSource: keys[i] == null,
      needsGeneration: keys[i] != null && !usingDraft && (boardsNeedGeneration(seg.list.boards) || (phase === 'rc' && boardsNeedGeneration(seg.mainList.boards))),
      // What the applied cost was derived from, and whether that still holds.
      basis,
      basisCurrent: !!basis && basis.source === (usingDraft ? 'draft' : 'applied') && basis.hash === (keys[i] ? hashOf(keys[i]) : null),
      suggestion: suggestionFresh ? s.result : null,
      suggestionStale: !!s && !suggestionFresh,
      currentCost,
      draftText,
      draftCost,
      target,
      predicted,
      offIncrement: Number.isInteger(draftCost) && draftCost % increment !== 0,
    }
  })

  const anyFresh = rows.some((r) => r.summary)
  const anySuggestion = rows.some((r) => r.suggestion?.suggested)
  const running = progress != null
  const canAnalyze = ladderConfigured && dropsPresent && !checkpointInvalid && !running

  async function handleAnalyze() {
    cancelRef.current = false
    const order = segments.map((_, i) => i)
    setAppliedNote(null)
    for (const i of order) {
      // A segment whose boards have never been generated has nothing real to
      // simulate - it is skipped (and says so) rather than given numbers.
      if (rows[i].needsGeneration || rows[i].notInSource) continue
      const inputs = inputsFor(i)
      const key = twisterAnalysisKey(inputs)
      setProgress({ segment: i, done: 0, total: 1 })
      const summary = await analyzeTwisterIncome({
        ...inputs,
        onProgress: (done, total) => setProgress({ segment: i, done, total }),
        isCancelled: () => cancelRef.current,
      })
      if (cancelRef.current || !summary) break
      setAnalysis((prev) => ({ ...prev, [slot(i)]: { key, summary } }))
    }
    setProgress(null)
  }

  function handleSuggest() {
    const nextSuggestions = { ...suggestions }
    const nextDrafts = { ...costDrafts }
    for (const row of rows) {
      if (!row.summary) continue
      const result = suggestSpinCost({ samples: row.summary.samples, samplesAllRuns: row.summary.samplesAllRuns, targetSpins: row.target, increment })
      nextSuggestions[slot(row.index)] = { key: suggestionKey(row.index), result }
      if (result.suggested) nextDrafts[row.index] = String(result.suggested.cost)
    }
    setSuggestions(nextSuggestions)
    setCostDrafts(nextDrafts)
    setAppliedNote(null)
  }

  function handleApply(indices) {
    const snapshot = {}
    let applied = 0
    for (const i of indices) {
      const row = rows[i]
      if (!Number.isInteger(row.draftCost)) continue
      snapshot[i] = row.currentCost
      // The price is the segment's own setting; alongside it, record which
      // configuration it was derived from.
      segments[i].list.syncRewardConfig({ twisterSpinCost: row.draftCost, twisterCostBasis: keys[i] ? { hash: hashOf(keys[i]), source: usingDraft ? 'draft' : 'applied', at: Date.now() } : null })
      applied += 1
    }
    if (applied) {
      setRevertSnapshot(snapshot)
      setAppliedNote(`Applied the cost per spin to ${applied} segment${applied === 1 ? '' : 's'}.`)
    }
  }

  function handleRevert() {
    if (!revertSnapshot) return
    const nextDrafts = { ...costDrafts }
    for (const [i, cost] of Object.entries(revertSnapshot)) {
      segments[Number(i)].list.syncRewardConfig({ twisterSpinCost: cost })
      delete nextDrafts[i]
    }
    setCostDrafts(nextDrafts)
    setRevertSnapshot(null)
    setAppliedNote('Reverted to the costs from before the last apply.')
  }

  const applicable = rows.filter((r) => Number.isInteger(r.draftCost) && r.draftCost !== r.currentCost)
  const selectedApplicable = applicable.filter((r) => selected.has(r.index))
  const anyTarget = targets.some((t) => t != null)

  if (!board0) return null

  return (
    <div className="flex flex-col gap-4" data-testid="twister-page">
      <div className="rounded-3xl border border-white bg-white/80 shadow-sm px-5 py-4">
        <div className="flex items-center gap-2.5">
          <GameArt asset="twister" rank={4} size={38} title="Twister DR" />
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900 leading-tight">Twister widget economy — {phaseLabel}</h2>
            <p className="text-xs text-slate-500">
              Players earn <span className="font-semibold">Twister DR</span> from merge drops and spend it on spins. Drops are shared; the price of a spin is set per
              segment.
            </p>
          </div>
        </div>
        <ol className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-xs">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-1.5 text-slate-600">
              <span className="grid place-items-center w-5 h-5 rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-500 text-white text-[10px] font-bold">{i + 1}</span>
              <span className="font-medium">{label}</span>
              {i < STEPS.length - 1 && <ChevronRight size={12} className="text-slate-300" />}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11px] text-slate-400">
          Twister DR is its own currency: it is not merge energy, it does not fund generator taps, and it earns no energy credit against subsidy.
        </p>
        <details className="mt-3 rounded-2xl border border-purple-100 bg-purple-50/50 px-4 py-3 text-sm text-slate-700" data-testid="twister-how-to" open={!hasTwisterDrops(board0?.dropGroups, board0?.dropGroupsConfig, board0?.minDropRank)}>
          <summary className="cursor-pointer select-none font-semibold text-purple-800">How to use this page</summary>
          <ol className="mt-2 ml-5 list-decimal flex flex-col gap-1 text-[13px]">
            <li>
              <span className="font-semibold">Build your boards first</span> (Build event tab). This page measures real boards, so it needs them.
            </li>
            <li>
              <span className="font-semibold">Card 1 - say what a Twister item is worth and how often it drops.</span> Type the Twister DR each of the 4 ranks pays, then
              &quot;a rank-R item on N out of 1,000 merges&quot; and press the button under it. This is the same for every segment.
            </li>
            <li>
              <span className="font-semibold">Card 2 - pick the moment you care about.</span> For example 50% = when the player is halfway to the top rank. The page will
              tell you how much Twister DR a player holds at that moment.
            </li>
            <li>
              <span className="font-semibold">Card 3 - press Analyze.</span> It plays each segment many times and shows the Twister DR collected by that moment.
            </li>
            <li>
              <span className="font-semibold">Card 4 - type how many spins the player should afford by then</span> and press Suggest. You get a DR price per spin for each
              segment (price = what they collect ÷ the spins you want).
            </li>
            <li>
              <span className="font-semibold">Card 5 - review the prices and apply them.</span> Nothing is written until you apply, and you can revert.
            </li>
          </ol>
          <p className="mt-2 text-xs text-slate-500">
            The drop rate is shared, so segments collect different amounts on their own - the price per spin is what you tune per segment, not the drops.
          </p>
        </details>
      </div>

      {/* ---------------- Step 1: shared drops ---------------- */}
      <Card icon={Tornado} title="1. Configure Twister drops" subtitle="Rank values and drop odds - one configuration for every segment" action={<SharedBadge />}>
        {activeSegmentIndex !== 0 && (
          <div className="mb-3 rounded-2xl border border-purple-200 bg-purple-50/70 px-4 py-2 text-xs text-purple-800">
            These settings are shared. Edits here change Segment 1&apos;s configuration, which every segment uses - whichever segment is selected above.
          </div>
        )}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Twister item ranks</div>
            <div className="grid grid-cols-[2.5rem_1fr_1fr_7rem] gap-2 items-center text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
              <span>Rank</span>
              <span>Item syntax</span>
              <span>Asset ID</span>
              <span>Twister DR value</span>
            </div>
            <div className="flex flex-col gap-2">
              {Array.from({ length: REWARD_MAX_RANK }, (_, i) => i + 1).map((rank) => (
                <div key={rank} className="grid grid-cols-[2.5rem_1fr_1fr_7rem] gap-2 items-center">
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <GameArt asset="twister" rank={rank} size={22} /> R{rank}
                  </span>
                  <input
                    className="min-w-0 border border-slate-200 rounded-xl px-2 py-1.5 text-sm bg-white/70"
                    placeholder={twisterItemSyntax(ladder[rank - 1].prizeAmount ?? 0) || 'Ops item syntax'}
                    title="Left empty, the export writes the amount as shown here (dr-twister is this tool's own name, not a confirmed Ops one)"
                    aria-label={`Twister rank ${rank} item syntax`}
                    value={ladder[rank - 1].syntax ?? ''}
                    onChange={(e) => updateLadder(rank - 1, { syntax: e.target.value })}
                  />
                  <input
                    className="min-w-0 border border-slate-200 rounded-xl px-2 py-1.5 text-sm bg-white/70"
                    placeholder="Asset ID"
                    aria-label={`Twister rank ${rank} asset id`}
                    value={ladder[rank - 1].asset ?? ''}
                    onChange={(e) => updateLadder(rank - 1, { asset: e.target.value })}
                  />
                  <input
                    type="number"
                    min={0}
                    className="min-w-0 border border-slate-200 rounded-xl px-2 py-1.5 text-sm bg-white/70 tabular-nums"
                    aria-label={`Twister rank ${rank} DR value`}
                    data-testid={`twister-value-${rank}`}
                    value={ladder[rank - 1].prizeAmount || ''}
                    placeholder="0"
                    onChange={(e) => updateLadder(rank - 1, { prizeAmount: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Rank 4 collects automatically; lower ranks can be collected by hand. Item syntax and asset IDs are exported exactly as typed - none are supplied for
              you.
            </p>

            <div className="mt-3 flex flex-col gap-1" data-testid="twister-ladder-status">
              {!ladderConfigured ? (
                <div className="flex items-start gap-2 text-sm text-amber-600">
                  <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                  <span>Not configured yet - enter the Twister DR value of each rank.</span>
                </div>
              ) : ladderIssues.length > 0 ? (
                <>
                  {ladderIssues.map((issue) => (
                    <div key={`${issue.code}-${issue.rank}`} className="flex items-start gap-2 text-sm text-amber-600">
                      <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                      <span>{issue.message}</span>
                    </div>
                  ))}
                  <p className="text-xs text-slate-500">
                    The values are kept as entered. The simulated player still merges toward rank {REWARD_MAX_RANK}, so with this ladder that policy is not the best
                    one available to a real player, and they could collect more than predicted by cashing out earlier.
                  </p>
                </>
              ) : (
                <div className="flex items-center gap-2 text-sm text-emerald-600">
                  <CircleCheck size={14} />
                  <span>The ladder rewards merging: rank {REWARD_MAX_RANK} beats cashing out earlier and no merge step loses value.</span>
                </div>
              )}
            </div>

            <details className="mt-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
              <summary className="cursor-pointer select-none flex items-center gap-2 text-sm font-semibold text-slate-600">
                <ClipboardPaste size={14} /> Paste rank values from a spreadsheet
              </summary>
              <p className="text-xs text-slate-500 my-2">
                Tab-separated rows: <span className="font-mono">Rank &nbsp; Item syntax &nbsp; Twister DR value &nbsp; [Asset ID]</span>. All rows must be valid before
                anything is applied.
              </p>
              <textarea
                value={pasteDraft}
                onChange={(e) => {
                  setPasteDraft(e.target.value)
                  setPasteFeedback(null)
                }}
                rows={4}
                aria-label="Paste Twister rank values"
                className="w-full border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-mono bg-white/80"
              />
              <div className="mt-2 flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={applyPaste} disabled={pasteDraft.trim() === ''}>
                  Apply pasted rows
                </Button>
                {pasteFeedback && (
                  <div className={`text-xs ${pasteFeedback.ok ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {pasteFeedback.messages.map((m, i) => (
                      <div key={i}>{m}</div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Twister drops from main-chain merges</div>
            <p className="text-xs text-slate-500 mb-2">
              Twister only ever comes from merge drops - never from a starting tile. A drop lands on the board as an item and takes a cell. Merging two reward
              items never causes a drop.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Item rank dropped
                <select
                  className="border border-slate-200 rounded-xl px-2 py-2 text-sm font-medium text-slate-800 bg-white/70 normal-case"
                  value={ruleRank}
                  data-testid="twister-rule-rank"
                  onChange={(e) => setRuleRank(Number(e.target.value))}
                >
                  {Array.from({ length: REWARD_MAX_RANK }, (_, i) => i + 1).map((r) => (
                    <option key={r} value={r}>
                      Rank {r} ({fmt(ladder[r - 1].prizeAmount, 2)} DR)
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Chance per eligible merge (out of 1000)
                <input
                  type="number"
                  min={0}
                  max={1000}
                  className="w-44 border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800 bg-white/70"
                  value={rulePerMille}
                  placeholder="e.g. 150"
                  data-testid="twister-rule-permille"
                  onChange={(e) => setRulePerMille(e.target.value)}
                />
              </label>
              <Button variant="primary" size="md" onClick={applyRule} disabled={!ruleValid} data-testid="twister-apply-rule">
                Set Twister drop
              </Button>
            </div>
            {baseList.boards[0]?.twisterByBuild && (
              <p className="mt-2 text-xs text-amber-700" data-testid="twister-by-build-note">
                The build sets the Twister drops for this list (Build event, step 4): it puts the Twister item into the containers and sizes it for the twists you typed.
                Setting a drop here replaces that with your own fixed chance, which the build then keeps as it is.
              </p>
            )}
            <InfoHint className="mt-2">
              Writes one single-item Twister group into every eligible rank table (resulting rank {minDropRank} and up) that is not locked, taking its weight from that
              table&apos;s no-drop weight - every group you made by hand keeps its odds; where no such weight is free (a built design), it comes off the containers the
              build made. 0 removes it. The group is kept, not regenerated, when you run Generate in the Rewards
              tab. For different odds per rank, or Twister bundled with other resources in one group (up to 4 items, one Twister at most), edit the drop groups by
              hand.
            </InfoHint>
            {ruleFindings?.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {ruleFindings.map((m) => (
                  <div key={m} className="flex items-start gap-2 text-xs text-amber-600">
                    <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                    <span>{m}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 rounded-2xl border border-slate-100 overflow-hidden" data-testid="twister-odds">
              <div className="grid grid-cols-[5rem_1fr_1fr_1fr] gap-2 bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <span>Merge to rank</span>
                <span>Twister chance</span>
                <span>Item rank(s)</span>
                <span>Raw item DR per merge</span>
              </div>
              {odds.map((row) => (
                <div key={row.rank} className="grid grid-cols-[5rem_1fr_1fr_1fr] gap-2 px-3 py-1 text-xs text-slate-600 border-t border-slate-100 tabular-nums" data-odds-rank={row.rank}>
                  <span className="font-semibold">
                    {row.rank}
                    {row.locked && <span className="ml-1 text-[10px] text-purple-500">locked</span>}
                  </span>
                  <span data-odds-chance>{row.probability > 0 ? `${fmt(row.probability * 100, 1)}%` : '—'}</span>
                  <span>{row.groups.length ? [...new Set(row.groups.map((g) => `R${g.itemRank}`))].join(', ') : '—'}</span>
                  <span>{row.probability > 0 ? fmt(row.rawValuePerMerge, 2) : '—'}</span>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              &quot;Raw item DR&quot; is the value of the dropped items at their own rank. What a player actually collects depends on merging and collecting - that is
              measured in step 3. Ranks below {minDropRank} never roll a drop.
            </p>
            {!dropsPresent && (
              <div className="mt-2 flex items-start gap-2 text-sm text-amber-600">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                <span>No Twister drop is configured for this phase yet.</span>
              </div>
            )}
            {handMadeTwisterGroups.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                Hand-made groups that also drop Twister: {handMadeTwisterGroups.map((g) => g.name || g.id).join(', ')}.
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Button variant="secondary" size="sm" onClick={onOpenRewards}>
                Edit drop groups, weights and locks by hand
              </Button>
              <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Spins that complete the widget (optional)
                <input
                  type="number"
                  min={1}
                  className="w-52 border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-medium text-slate-800 bg-white/70"
                  value={objectiveDraft}
                  placeholder="not configured"
                  data-testid="twister-objective"
                  onChange={(e) => commitObjective(e.target.value)}
                />
              </label>
            </div>
            <InfoHint className="mt-1">
              Leave empty unless a fixed widget length is confirmed. When set, it becomes the default target spin count and play shows progress toward it. It never
              stops Twister drops, and nothing here defines what a spin awards or what completing the widget gives.
            </InfoHint>
          </div>
        </div>
      </Card>

      {/* ---------------- Step 2: checkpoint + target ---------------- */}
      <Card title="2. Choose progression checkpoint and target" subtitle="Design inputs for the price analysis - not runtime configuration">
        <div className="flex flex-wrap items-start gap-4">
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Checkpoint: % of main-chain DR progress
            <input
              type="number"
              min={1}
              max={100}
              className={`w-52 border rounded-xl px-3 py-2 text-sm font-medium text-slate-800 bg-white/70 ${checkpointInvalid ? 'border-amber-400' : 'border-slate-200'}`}
              value={checkpointDraft}
              data-testid="twister-checkpoint"
              onChange={(e) => {
                setCheckpointDraft(e.target.value)
                commitPlanNumber('checkpointPct', e.target.value, { min: 1, max: 100, integer: false })
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Spins available by the checkpoint (target)
            <input
              type="number"
              min={1}
              className={`w-52 border rounded-xl px-3 py-2 text-sm font-medium text-slate-800 bg-white/70 ${targetInvalid ? 'border-amber-400' : 'border-slate-200'}`}
              value={targetDraft}
              placeholder={spinObjective ? `${spinObjective} (widget length)` : 'required'}
              data-testid="twister-target-spins"
              onChange={(e) => {
                setTargetDraft(e.target.value)
                commitPlanNumber('targetSpins', e.target.value, { min: 1, max: 100000, allowEmpty: true })
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Cost step (DR)
            <input
              type="number"
              min={1}
              className="w-28 border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800 bg-white/70"
              value={incrementDraft}
              data-testid="twister-increment"
              onChange={(e) => {
                setIncrementDraft(e.target.value)
                commitPlanNumber('costIncrement', e.target.value, { min: 1, max: 100000 })
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Simulated runs
            <input
              type="number"
              min={5}
              max={2000}
              className="w-28 border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800 bg-white/70"
              value={runsDraft}
              data-testid="twister-runs"
              onChange={(e) => {
                setRunsDraft(e.target.value)
                commitPlanNumber('runs', e.target.value, { min: 5, max: 2000 })
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Seed
            <input
              type="number"
              min={0}
              className="w-28 border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800 bg-white/70"
              value={seedDraft}
              data-testid="twister-seed"
              onChange={(e) => {
                setSeedDraft(e.target.value)
                commitPlanNumber('seed', e.target.value, { min: 0, max: 4294967295 })
              }}
            />
          </label>
        </div>
        {targetInvalid && <p className="mt-2 text-xs text-amber-600">The target must be a whole number of spins, 1 or more.</p>}
        {!anyTarget && !targetInvalid && (
          <p className="mt-2 text-xs text-slate-500" data-testid="twister-target-missing">
            Enter how many spins a player should be able to afford by the checkpoint - a price cannot be derived without it. Income can still be analyzed first.
          </p>
        )}
        <div className="mt-3 rounded-2xl bg-slate-50/70 border border-slate-100 px-4 py-3 text-xs text-slate-600 leading-relaxed" data-testid="twister-checkpoint-definition">
          <span className="font-semibold text-slate-700">What the checkpoint measures.</span> Progress = the main-chain DR value the player has in play ÷ the DR value
          of the {phase === 'rc' ? 'rank-14' : 'rank-12'} item ({phase === 'rc' ? '8,192' : '2,048'} DR). &quot;In play&quot; counts every main-chain item the player
          can see: what the generator produced, plus subsidy once it is revealed (semi tiles when their board comes into play, blocked tiles when revealed). Value
          still behind a locked tile is not counted. Merging never changes it (two items become one of the same total value), so it only ever grows. Small-reward and
          Twister items are excluded. It is not time, board number, merge count or generator spend - a segment with more subsidy gets there on less spend.
          {phase === 'rc' && (
            <span>
              {' '}
              In RC the round starts on a fresh RC board - the first completion&apos;s rank-12 item is not carried over - so progress starts from the RC board&apos;s own
              visible items and Twister income is counted from the start of the RC round.
            </span>
          )}{' '}
          Income is read right after the action that crosses the checkpoint and its automatic effects (the merge&apos;s reveals, its drop landing, a rank-4
          auto-collect). Nothing is collected early to improve the number.
        </div>
      </Card>

      {/* ---------------- Steps 3-5: per-segment ---------------- */}
      <Card title="3–5. Analyze DR income, suggest spin costs, review and apply" subtitle="Each segment against its own boards and effort" action={<SegmentBadge />}>
        <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 flex flex-wrap items-center gap-3" data-testid="twister-source">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Analyze which configuration</span>
          <div className="inline-flex bg-white rounded-xl p-0.5 border border-slate-200">
            {[
              { id: 'applied', label: 'Applied design' },
              { id: 'draft', label: 'Build event draft' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={(usingDraft ? 'draft' : 'applied') === opt.id}
                disabled={opt.id === 'draft' && !draft}
                onClick={() => onSourceChange?.(opt.id)}
                data-source={opt.id}
                className={`px-3 py-1 rounded-lg text-sm font-semibold whitespace-nowrap disabled:text-slate-300 ${(usingDraft ? 'draft' : 'applied') === opt.id ? 'bg-purple-600 text-white' : 'text-slate-600 hover:text-slate-800'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <span className="flex-1 min-w-[16rem] text-xs text-slate-500" data-testid="twister-source-note">
            {usingDraft
              ? `Using the draft's own boards and merge drops - exactly what applying it would give. The draft does not need to be applied.${draftCurrent ? '' : ' This draft is out of date against the current inputs.'}`
              : draft
                ? 'Using the boards and merge drops that are applied now.'
                : 'Using the boards and merge drops that are applied now. Build a configuration in Build event to analyze a draft instead.'}
          </span>
          {usingDraft && !draftCurrent && onRebuild && (
            <Button variant="secondary" size="sm" onClick={onRebuild}>
              Rebuild the draft
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!running ? (
            <Button variant="primary" icon={Play} onClick={handleAnalyze} disabled={!canAnalyze} data-testid="twister-analyze">
              Analyze income (all segments)
            </Button>
          ) : (
            <Button variant="dark" icon={Square} onClick={() => (cancelRef.current = true)} data-testid="twister-cancel">
              Cancel
            </Button>
          )}
          <Button variant="secondary" icon={Wand2} onClick={handleSuggest} disabled={running || !anyFresh || !anyTarget} data-testid="twister-suggest">
            Suggest spin costs
          </Button>
          <Button variant="secondary" icon={Check} onClick={() => handleApply(selectedApplicable.map((r) => r.index))} disabled={running || selectedApplicable.length === 0} data-testid="twister-apply-selected">
            Apply selected ({selectedApplicable.length})
          </Button>
          <Button variant="secondary" icon={Check} onClick={() => handleApply(applicable.map((r) => r.index))} disabled={running || applicable.length === 0} data-testid="twister-apply-all">
            Apply all ({applicable.length})
          </Button>
          <Button variant="ghost" icon={Undo2} onClick={handleRevert} disabled={running || !revertSnapshot} data-testid="twister-revert">
            Revert
          </Button>
          <span className="text-[11px] text-slate-400" data-testid="twister-session-only">
            Analysis results and suggestions are kept for this session only - they are not saved and do not survive a reload. Applied costs are saved with the project.
          </span>
          {running && (
            <span className="text-xs text-slate-500" data-testid="twister-progress">
              Simulating {segments[progress.segment]?.name} — run {progress.done} of {progress.total}
            </span>
          )}
          {appliedNote && !running && (
            <span className="text-xs text-emerald-600" data-testid="twister-applied-note">
              {appliedNote}
            </span>
          )}
        </div>

        {(!ladderConfigured || !dropsPresent) && (
          <div className="mt-3 flex items-start gap-2 text-sm text-amber-600" data-testid="twister-not-ready">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            <span>
              {!ladderConfigured ? 'Enter the Twister DR value of each rank' : ''}
              {!ladderConfigured && !dropsPresent ? ' and ' : ''}
              {!dropsPresent ? `${ladderConfigured ? 'S' : 's'}et a Twister drop` : ''} in step 1 before analyzing.
            </span>
          </div>
        )}

        <div className="mt-3 text-xs text-slate-500 leading-relaxed" data-testid="twister-run-settings">
          Checkpoint <span className="font-semibold text-slate-700">{fmt(plan.checkpointPct, 1)}%</span> of main-chain DR progress ·{' '}
          <span className="font-semibold text-slate-700">{plan.runs}</span> seeded runs per segment · seed{' '}
          <span className="font-semibold text-slate-700">{plan.seed}</span> · collection policy: the simulated player merges Twister items toward rank {REWARD_MAX_RANK},
          collects a lower rank by hand only to free a full board, and at a phase end unmerged items are{' '}
          <span className="font-semibold text-slate-700">{leftoverPolicy === 'collect' ? 'collected by hand' : 'forfeited'}</span> (the shared leftover policy). Spin
          prizes are not specified, so nothing a spin might award is fed back into Merge.
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[68rem] text-sm" data-testid="twister-table">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-200">
                <th className="py-2 pr-2 w-6" />
                <th className="py-2 pr-3">Segment</th>
                <th className="py-2 pr-3">Mean DR at checkpoint</th>
                <th className="py-2 pr-3">DR p10–p90</th>
                <th className="py-2 pr-3">Target spins</th>
                <th className="py-2 pr-3">Suggested cost</th>
                <th className="py-2 pr-3">Cost to apply</th>
                <th className="py-2 pr-3">Predicted spins</th>
                <th className="py-2 pr-3">Target attainment</th>
                <th className="py-2 pr-3">Applied cost</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const s = row.summary
                const open = openDetails === row.index
                return (
                  <Fragment key={row.index}>
                    <tr className="border-b border-slate-100 align-top tabular-nums" data-twister-row={row.index}>
                      <td className="py-2 pr-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.name}`}
                          checked={selected.has(row.index)}
                          onChange={(e) => {
                            const next = new Set(selected)
                            if (e.target.checked) next.add(row.index)
                            else next.delete(row.index)
                            setSelected(next)
                          }}
                        />
                      </td>
                      <td className="py-2 pr-3 font-semibold text-slate-700">
                        {row.name}
                        {row.notInSource && (
                          <div className="text-[11px] font-normal text-slate-400" data-not-in-source>
                            Not part of the draft
                          </div>
                        )}
                        {row.needsGeneration && (
                          <div className="text-[11px] font-normal text-amber-600" data-needs-generation>
                            Not analyzed - generate this segment&apos;s board items first
                          </div>
                        )}
                        {row.stale && (
                          <div className="text-[11px] font-normal text-amber-600" data-stale>
                            Out of date - analyze again
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3" data-cell="mean">
                        {s ? fmt(s.income.mean) : '—'}
                        {s && s.reachRate < 1 && <div className="text-[11px] text-amber-600">{pct(s.reachRate)} of runs reached it</div>}
                      </td>
                      <td className="py-2 pr-3" data-cell="range">
                        {s && s.income.n ? `${fmt(s.income.p10)} – ${fmt(s.income.p90)}` : '—'}
                        {s && s.income.n > 0 && <div className="text-[11px] text-slate-400">median {fmt(s.income.p50)}</div>}
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          min={1}
                          aria-label={`Target spins override for ${row.name}`}
                          className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-sm bg-white/70"
                          placeholder={plan.targetSpins ?? spinObjective ?? '—'}
                          value={plan.targetSpinsOverrides?.[row.index] ?? ''}
                          data-cell="target"
                          onChange={(e) => setOverride(row.index, e.target.value)}
                        />
                        {plan.targetSpinsOverrides?.[row.index] != null && <div className="text-[11px] text-purple-600">override</div>}
                      </td>
                      <td className="py-2 pr-3" data-cell="suggested">
                        {row.suggestion?.suggested ? (
                          <>
                            <span className="font-semibold text-slate-800">{row.suggestion.suggested.cost} DR</span>
                            <div className="text-[11px] text-slate-400">indicative {fmt(row.suggestion.indicative, 2)}</div>
                          </>
                        ) : row.suggestionStale ? (
                          <span className="text-[11px] text-amber-600">out of date</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          min={1}
                          aria-label={`Cost per spin to apply for ${row.name}`}
                          className={`w-24 border rounded-lg px-2 py-1 text-sm bg-white/70 ${Number.isNaN(row.draftCost) ? 'border-red-300' : 'border-slate-200'}`}
                          value={row.draftText}
                          placeholder="not set"
                          data-cell="cost"
                          onChange={(e) => setCostDrafts((prev) => ({ ...prev, [row.index]: e.target.value }))}
                        />
                        {Number.isNaN(row.draftCost) && <div className="text-[11px] text-red-500">whole DR, 1 or more</div>}
                        {row.offIncrement && <div className="text-[11px] text-amber-600">not a multiple of {increment}</div>}
                        {row.suggestion?.suggested && Number.isInteger(row.draftCost) && row.draftCost !== row.suggestion.suggested.cost && (
                          <div className="text-[11px] text-purple-600">manual</div>
                        )}
                      </td>
                      <td className="py-2 pr-3" data-cell="spins">
                        {row.predicted ? (
                          <>
                            <span className="font-semibold text-slate-800">{fmt(row.predicted.spins.mean)}</span> avg
                            <div className="text-[11px] text-slate-400">
                              median {fmt(row.predicted.spins.p50, 0)} · {fmt(row.predicted.spins.p10, 0)}–{fmt(row.predicted.spins.p90, 0)}
                            </div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 pr-3" data-cell="attainment">
                        {row.predicted ? (
                          <>
                            <span className={`font-semibold ${row.predicted.attainment >= 0.5 ? 'text-emerald-600' : 'text-amber-600'}`}>{pct(row.predicted.attainment)}</span>
                            <div className="text-[11px] text-slate-400">of players have ≥ {row.target}</div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 pr-3" data-cell="applied">
                        {row.currentCost == null ? <span className="text-slate-400">not set</span> : <span className="font-semibold text-slate-700">{row.currentCost} DR</span>}
                        {row.currentCost != null && (
                          <div className={`text-[11px] ${row.basisCurrent ? 'text-emerald-600' : 'text-amber-600'}`} data-cost-basis>
                            {!row.basis
                              ? 'not tied to an analysis'
                              : row.basis.source === 'build'
                                ? 'set by the build (Build event), from the twists you typed there'
                                : row.basisCurrent
                                ? `from this ${row.basis.source === 'draft' ? 'draft' : 'applied design'}`
                                : row.basis.source !== (usingDraft ? 'draft' : 'applied')
                                  ? `derived from ${row.basis.source === 'draft' ? 'a draft' : 'the applied design'}, not the configuration selected here`
                                  : `from ${row.basis.source === 'draft' ? 'a draft' : 'the applied design'} that has since changed`}
                          </div>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs text-purple-600 hover:underline disabled:text-slate-300 disabled:no-underline"
                          disabled={!s}
                          onClick={() => setOpenDetails(open ? null : row.index)}
                          data-cell="details-toggle"
                        >
                          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Details
                        </button>
                      </td>
                    </tr>
                    {row.suggestion?.message && (
                      <tr className="border-b border-slate-100">
                        <td />
                        <td colSpan={10} className="pb-2 text-xs text-amber-600" data-suggestion-message={row.index}>
                          {row.suggestion.message}
                        </td>
                      </tr>
                    )}
                    {open && s && (
                      <tr className="border-b border-slate-100 bg-slate-50/60">
                        <td />
                        <td colSpan={10} className="py-3 pr-3">
                          <SegmentDetails row={row} phase={phase} increment={increment} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-slate-400 leading-relaxed">
          Available spins = floor(Twister DR earned ÷ cost per spin) - one fixed cost and no other Twister spending, the only rule that is specified. Earned DR is
          cumulative and never drops when spins are bought. Matching the average income to the target does not mean every player reaches it: &quot;Target
          attainment&quot; is the share of simulated players who actually do.{' '}
          {spinObjective ? `The widget is configured to complete at ${spinObjective} spins.` : 'No widget length is configured, so these are spins available, not widget completion.'}
        </p>
        {!anySuggestion && anyFresh && !anyTarget && <p className="mt-1 text-xs text-slate-500">Enter a target spin count in step 2 to get suggested costs.</p>}
      </Card>
    </div>
  )
}

function Stat({ label, value, note }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="font-display font-semibold text-slate-700 tabular-nums">{value}</div>
      {note && <div className="text-[11px] text-slate-400">{note}</div>}
    </div>
  )
}

function SegmentDetails({ row, phase, increment }) {
  const s = row.summary
  const sug = row.suggestion
  const lumpy = s.income.p50 === 0 && (s.uncollectedValue.mean ?? 0) > 0
  const reasons = Object.entries(s.endedBeforeByReason)
  return (
    <div className="flex flex-col gap-4 text-xs text-slate-600" data-testid={`twister-details-${row.index}`}>
      <div>
        <div className="font-semibold text-slate-700 mb-1.5">Twister DR income at the checkpoint</div>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <Stat label="Reached the checkpoint" value={`${s.reachedCount} / ${s.runs}`} note={pct(s.reachRate)} />
          <Stat label="Mean (runs that reached it)" value={fmt(s.income.mean)} note={`p10 ${fmt(s.income.p10)} · p50 ${fmt(s.income.p50)} · p90 ${fmt(s.income.p90)}`} />
          <Stat
            label="Mean (all runs)"
            value={fmt(s.incomeAllRuns.mean)}
            note={`p10 ${fmt(s.incomeAllRuns.p10)} · p50 ${fmt(s.incomeAllRuns.p50)} · p90 ${fmt(s.incomeAllRuns.p90)}`}
          />
          <Stat label="Uncollected Twister items" value={`${fmt(s.uncollectedItems.mean)} items`} note={`${fmt(s.uncollectedValue.mean)} DR if collected by hand now`} />
          <Stat label="Raw item DR dropped" value={fmt(s.rawDropped.mean)} note="value of dropped items at their own rank" />
          <Stat label="Player DR spent by then" value={fmt(s.drSpentAtCheckpoint.mean, 0)} note="generator spend, not Twister DR" />
          <Stat label={`Income by the end of the ${phase === 'rc' ? 'RC round' : 'phase'}`} value={fmt(s.incomeAtPhaseEnd.mean)} note="after the phase-end leftover policy" />
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">
          &quot;Runs that reached it&quot; is conditional on reaching the checkpoint. &quot;All runs&quot; keeps every run: one that ended first counts what it had
          when it ended.
        </p>
        {s.endedBeforeCount > 0 && (
          <p className="mt-1 text-amber-600" data-ended-before>
            {s.endedBeforeCount} of {s.runs} runs ended before the checkpoint ({reasons.map(([reason, n]) => `${n} ${STOP_REASON_LABEL[reason] ?? reason}`).join(', ')}).
            They are excluded from the conditional figures and included in the all-run ones.
          </p>
        )}
        {lumpy && (
          <p className="mt-1 text-amber-600" data-lumpy>
            More than half of the simulated players have collected no Twister DR yet at this point: it is still sitting in unmerged items. Under the simulated
            policy Twister DR arrives in rank-4 collects, so early income is all-or-nothing. A higher drop rank, more frequent drops or a later checkpoint smooths
            this.
          </p>
        )}
      </div>

      {sug && (
        <div>
          <div className="font-semibold text-slate-700 mb-1.5">How the cost was derived</div>
          {sug.indicative != null && row.target ? (
            <p>
              Indicative cost = mean collected Twister DR ÷ target spins = {fmt(sug.mean)} ÷ {row.target} ={' '}
              <span className="font-semibold text-slate-700">{fmt(sug.indicative, 2)} DR</span>. Costs must be whole multiples of {increment} DR, so each permitted
              cost near it was scored on the simulated players themselves; the one whose typical (median) player lands closest to {row.target} spins is suggested,
              ties broken by the average.
            </p>
          ) : (
            <p>{sug.message}</p>
          )}
          {sug.candidates.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-[34rem] text-xs tabular-nums" data-candidates>
                <thead>
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="pr-4 py-1">Cost (DR)</th>
                    <th className="pr-4 py-1">Average spins</th>
                    <th className="pr-4 py-1">Median spins</th>
                    <th className="pr-4 py-1">p10 – p90</th>
                    <th className="pr-4 py-1">Reach target</th>
                    <th className="pr-4 py-1">DR left over (avg)</th>
                  </tr>
                </thead>
                <tbody>
                  {sug.candidates
                    .filter((c) => Math.abs(c.cost - sug.suggested.cost) <= 5 * increment)
                    .map((c) => (
                      <tr key={c.cost} className={c.cost === sug.suggested.cost ? 'bg-purple-100/70 font-semibold text-purple-900' : ''}>
                        <td className="pr-4 py-0.5">{c.cost}</td>
                        <td className="pr-4 py-0.5">{fmt(c.spins.mean)}</td>
                        <td className="pr-4 py-0.5">{fmt(c.spins.p50, 0)}</td>
                        <td className="pr-4 py-0.5">
                          {fmt(c.spins.p10, 0)} – {fmt(c.spins.p90, 0)}
                        </td>
                        <td className="pr-4 py-0.5">{pct(c.attainment)}</td>
                        <td className="pr-4 py-0.5">{fmt(c.remainder.mean)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {row.predicted && (
        <div>
          <div className="font-semibold text-slate-700 mb-1.5">At the cost to apply ({row.draftCost} DR per spin)</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Average spins" value={fmt(row.predicted.spins.mean)} />
            <Stat label="Median spins" value={fmt(row.predicted.spins.p50, 0)} note={`p10 ${fmt(row.predicted.spins.p10, 0)} · p90 ${fmt(row.predicted.spins.p90, 0)}`} />
            <Stat label={`Have ≥ ${row.target} spins`} value={pct(row.predicted.attainment)} note="of runs that reached the checkpoint" />
            <Stat label={`Have ≥ ${row.target} spins (all runs)`} value={pct(row.predicted.attainmentAllRuns)} />
            <Stat label="DR left over" value={fmt(row.predicted.remainder.mean)} note="average, after taking every available spin" />
          </div>
        </div>
      )}

      {s.withoutTwister && (
        <div data-economy-check>
          <div className="font-semibold text-slate-700 mb-1.5">Effect of Twister drops on the existing economy (same seed, with and without)</div>
          <div className="overflow-x-auto">
            <table className="min-w-[30rem] text-xs tabular-nums">
              <thead>
                <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="pr-4 py-1">Per player, this phase</th>
                  <th className="pr-4 py-1">Without Twister</th>
                  <th className="pr-4 py-1">With Twister</th>
                  <th className="pr-4 py-1">Run-to-run spread (p10–p90)</th>
                </tr>
              </thead>
              <tbody>
                {REWARD_TYPES.map((t) => (
                  <tr key={t}>
                    <td className="pr-4 py-0.5">{REWARD_TYPE_LABELS[t]} collected</td>
                    <td className="pr-4 py-0.5">{fmt(s.withoutTwister.payouts[t].mean)}</td>
                    <td className="pr-4 py-0.5">{fmt(s.payouts[t].mean)}</td>
                    <td className="pr-4 py-0.5 text-slate-400">
                      {fmt(s.payouts[t].p10)} – {fmt(s.payouts[t].p90)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="pr-4 py-0.5">Player DR spent</td>
                  <td className="pr-4 py-0.5">{fmt(s.withoutTwister.drSpent.mean, 0)}</td>
                  <td className="pr-4 py-0.5">{fmt(s.drSpent.mean, 0)}</td>
                  <td className="pr-4 py-0.5 text-slate-400">
                    {fmt(s.drSpent.p10, 0)} – {fmt(s.drSpent.p90, 0)}
                  </td>
                </tr>
                <tr>
                  <td className="pr-4 py-0.5">Rewards collected to free space</td>
                  <td className="pr-4 py-0.5">{fmt(s.withoutTwister.spaceCollects.mean)}</td>
                  <td className="pr-4 py-0.5">{fmt(s.spaceCollects.mean)}</td>
                  <td className="pr-4 py-0.5 text-slate-400" />
                </tr>
                <tr>
                  <td className="pr-4 py-0.5">Effective subsidy (after the 80% energy credit)</td>
                  <td className="pr-4 py-0.5">{fmt(s.withoutTwister.effectiveSubsidy)}</td>
                  <td className="pr-4 py-0.5">{fmt(s.effectiveSubsidy)}</td>
                  <td className="pr-4 py-0.5 text-slate-400" />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Twister items take board cells, so they can change how the other rewards merge. Twister DR itself is never part of the energy credit. Differences smaller
            than the run-to-run spread are noise.
          </p>
        </div>
      )}
    </div>
  )
}
