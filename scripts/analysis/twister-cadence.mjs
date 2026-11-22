// TWISTER CADENCE INVESTIGATION - which drop structure lets a player spin
// steadily and reach the twists asked at 70-75% of the DR demand spent.
//
//   npx vite-node scripts/analysis/twister-cadence.mjs [runs] [out.json] [built.json]
//
// Builds a four-segment test event with the real build (or reads one saved
// with a third argument), then plays every candidate drop structure
// (twisterCadence.js: CADENCE_CANDIDATES) on every segment with the same
// seeds - the normal event and Recompletion - fits the Twister values and
// the price of a twist to the window for each, and prints what a player could
// spin and when. Nothing here changes a production rule: the candidates are
// experiments.
import fs from 'node:fs'
import { createBoard, withListPhase } from '../../src/features/merge/lib/core/board.js'
import { withBlankCoinValues, REWARD_TYPES } from '../../src/features/merge/lib/rewards/rewardChain.js'
import { withDefaultTwisterValues } from '../../src/features/merge/lib/rewards/twisterEconomy.js'
import { buildEvent, segmentBuildInputs, rcInputsOnMainDraft, boardsWithDraftApplied } from '../../src/features/merge/lib/build/eventBuild.js'
import { CADENCE_CANDIDATES, combineCandidates, measureCandidate, DEMAND_MARKS, TWISTER_WINDOW_PCT } from '../../src/features/merge/lib/rewards/twisterCadence.js'

const RUNS = Number(process.argv[2] ?? 300)
const OUT = process.argv[3] ?? null
const BUILT = process.argv[4] ?? null
const SUBSIDIES = [1750, 1300, 1000, 700]
const TWISTS = { main: 15, rc: 10 }
const STEP = 10

function chain(values, rc = false) {
  return values.map((v, i) => {
    let b = createBoard(`Board ${i + 1}`, { rows: i === 0 ? 5 : 3, cols: 8 })
    const from = i === 0 ? 3 : 1
    b.tiles = b.tiles.map((row, r) => row.map(() => (r >= from ? 'blocked' : 'open')))
    if (i === 0) b.tiles[2][4] = 'semi'
    b.blockedValue = v
    b.minDropRank = 6
    b.twisterByBuild = true
    b.rewardRanks = rc ? [13, 14] : [5, 9, 12]
    b.rewardSyntax = rc ? { 13: 'coins:1000', 14: 'coins:5000' } : { 5: 'coins:50', 9: 'coins:200', 12: 'coins:1000' }
    b.rewardChainConfig = withDefaultTwisterValues(withBlankCoinValues(b.rewardChainConfig))
    if (rc) b = withListPhase({ ...b, minRank: 3, maxRank: 13 }, 'rc')
    return b
  })
}

async function buildTestEvent() {
  const raw = SUBSIDIES.map((s, i) => {
    const rest = s - 150
    const b2 = Math.round(rest * 0.45)
    const rcRest = 6144 - (2048 - s) - 300
    const r2 = Math.round(rcRest * 0.3)
    const r3 = Math.round(rcRest * 0.35)
    return {
      name: `Segment ${i + 1}`,
      mainBoards: chain([150, b2, rest - b2]),
      rcBoards: chain([300, r2, r3, rcRest - r2 - r3], true),
      rewardTargets: { main: { coins: 3, puzzles: 300, energy: 200, charms: 400 }, rc: { coins: 5, puzzles: 500, energy: 300, charms: 700 } },
      segmentFactor: 1 + i * 0.15,
      sourceAllocation: {},
      twisterPlan: { main: { targetSpins: TWISTS.main, targetSpinsOverrides: {}, costIncrement: STEP, checkpointPct: 100 }, rc: { targetSpins: TWISTS.rc, targetSpinsOverrides: {}, costIncrement: STEP, checkpointPct: 100 } },
    }
  })
  const mainDraft = await buildEvent({ phase: 'main', segments: segmentBuildInputs(raw, 'main') })
  const rcDraft = await buildEvent({ phase: 'rc', segments: rcInputsOnMainDraft(raw, mainDraft) })
  return raw.map((seg, i) => ({
    name: seg.name,
    boards: boardsWithDraftApplied(seg.mainBoards, mainDraft.segments[i], mainDraft.shared, { draft: mainDraft }),
    rcBoards: boardsWithDraftApplied(seg.rcBoards, rcDraft.segments[i], rcDraft.shared, { draft: rcDraft }),
  }))
}

const event = BUILT && fs.existsSync(BUILT) ? JSON.parse(fs.readFileSync(BUILT, 'utf8')) : await buildTestEvent()
if (BUILT && !fs.existsSync(BUILT)) fs.writeFileSync(BUILT, JSON.stringify(event))

const candidates = [...CADENCE_CANDIDATES, combineCandidates(['rank5', 'bigger']), combineCandidates(['rank5', 'rank7always']), combineCandidates(['rank5', 'rank7always', 'bigger'])]
const n = (v, d = 0) => (v == null ? '-' : v.toFixed(d))
const pc = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`)
const three = (s, d = 0) => (s?.p50 == null ? '-' : `${n(s.p50, d)} (${n(s.p10, d)}-${n(s.p90, d)})`)

// Everything is measured first (a candidate's two phases share one ladder).
const measured = event.map((seg) => {
  const segment = { name: seg.name, boards: seg.boards, rcBoards: seg.rcBoards, twists: TWISTS, step: STEP }
  return { name: seg.name, rows: candidates.map((candidate) => ({ candidate, m: measureCandidate({ segment, candidate, runs: RUNS }) })) }
})

const results = []
for (const phase of ['main', 'rc']) {
  console.log(`\n================ ${phase === 'main' ? 'NORMAL EVENT' : 'RECOMPLETION'} - ${RUNS} players a segment and candidate, the twists asked: ${TWISTS[phase]}, price steps of ${STEP} ================`)
  for (const seg of measured) {
    const base = seg.rows[0].m[phase]
    const b = base.asBuilt
    const s0 = base.atFit
    console.log(`\n--- ${seg.name} ---`)
    console.log(`  demand ${base.demand} DR | the phase ends at ${three(s0?.endPct)}% of it (paid ${three(s0?.drSpent)} DR) | merges by rank ${Object.entries(s0?.mergesByRank ?? {}).filter(([k]) => k >= 5).map(([k, v]) => `${k}:${n(v, 1)}`).join(' ')}`)
    console.log(`  share of each rank's merges made by 25/50/75% of demand: ${Object.entries(s0?.mergeTiming ?? {}).filter(([k]) => k <= 10).map(([k, v]) => `r${k} ${pc(v.by25)}/${pc(v.by50)}/${pc(v.by75)}`).join('  ')}`)
    if (b) console.log(`  AS BUILT TODAY (values ${b.values.join('/')}, ${b.cost} DR a twist): typical player reaches the twists at ${n(b.targetMedianAll)}% (${three(b.targetPct)}), by 70% ${pc(b.targetBy[70])}, by 75% ${pc(b.targetBy[75])}, within 10 points of the window ${pc(b.targetNear)}, never ${pc(b.neverTarget)}; first spin ${three(b.firstSpinPct)}%; ${three(b.opportunitiesInPlay)} chances to spin, ${n(b.spinsPerOpportunity.mean, 1)} twists a chance; longest wait ${three(b.longestGap)} points`)
    for (const { candidate, m } of seg.rows) {
      const p = m[phase]
      const s = p?.atFit
      results.push({ phase, segment: seg.name, candidate: candidate.id, label: candidate.label, rules: candidate.rules, demand: p?.demand, target: p?.target, values: m.values, bothInWindow: m.inWindow, fit: p?.fit ? { cost: p.fit.cost, medianPct: p.fit.medianPct, inWindow: p.fit.inWindow, reachable: p.fit.reachable } : null, atFit: s, asBuilt: p?.asBuilt ?? null })
      if (!s) {
        console.log(`  ${candidate.id.padEnd(26)} no Twister income`)
        continue
      }
      const other = REWARD_TYPES.map((t) => (s0?.payouts[t].mean > 0 ? Math.round((100 * s.payouts[t].mean) / s0.payouts[t].mean) : 0)).join('/')
      const marks = DEMAND_MARKS.map((mk) => n(s.spinsAtMarks[mk].p50)).join('/')
      console.log(
        `  ${candidate.id.padEnd(26)} ${p.fit.values.join('/').padEnd(13)} ${String(p.fit.cost).padStart(3)} DR | typical ${n(s.targetMedianAll).padStart(3)}%${p.fit.inWindow ? ' IN ' : ' out'} by70 ${pc(s.targetBy[70]).padStart(4)} by75 ${pc(s.targetBy[75]).padStart(4)} near ${pc(s.targetNear).padStart(4)} never ${pc(s.neverTarget).padStart(3)} | items ${n(s.twisterDrops.p50).padStart(3)} finished ${three(s.finishedItems).padEnd(10)} chances ${n(s.opportunitiesInPlay.p50).padStart(2)} x${n(s.spinsPerOpportunity.mean, 1)} | first spin ${n(s.firstSpinPct.p50).padStart(2)}% gap ${three(s.longestGap).padEnd(10)} | spins@25/50/70/75/100 ${marks} | end-share ${pc(s.phaseEndShare)} | rewards ${other} DR ${s0 ? Math.round((100 * s.drSpent.mean) / s0.drSpent.mean) : '-'}% tiles-left ${n(s.stuckLeft.mean, 1)} taps ${n(s.spaceCollects.mean, 1)}${p.fit.inWindow ? '' : ` | can reach at ${(p.fit.reachable ?? []).filter((x) => x >= 40 && x <= 100).join(',')}`}`,
      )
    }
  }
}
console.log(`\nWindow: the twists asked reached at ${TWISTER_WINDOW_PCT[0]}-${TWISTER_WINDOW_PCT[1]}% of the demand spent. "typical" is the middle player of all (those who never reach count as never). "near": within 10 points of the window.`)

// One line a candidate: in how many of the segments each phase lands in the window.
console.log('\n================ SUMMARY ================')
for (const candidate of candidates) {
  const rows = (phase) => results.filter((r) => r.candidate === candidate.id && r.phase === phase && r.atFit)
  const line = (phase) => {
    const list = rows(phase)
    return `${list.filter((r) => r.fit.inWindow).length} of ${list.length} in window (typical ${list.map((r) => n(r.atFit.targetMedianAll)).join('/')}%; near ${list.map((r) => pc(r.atFit.targetNear)).join('/')}; chances ${list.map((r) => n(r.atFit.opportunitiesInPlay.p50)).join('/')}; twists a chance ${list.map((r) => n(r.atFit.spinsPerOpportunity.mean, 1)).join('/')}; longest wait ${list.map((r) => n(r.atFit.longestGap.p50)).join('/')})`
  }
  console.log(`${candidate.id.padEnd(26)} normal ${line('main')}\n${''.padEnd(26)} RC     ${line('rc')}`)
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(results))
