// VALIDATION of the Twister rules, the demand calibration and the per-segment
// Twister fit - beyond the first investigation.
//
//   npx vite-node scripts/analysis/twister-validation.mjs [players] [out.json] [config ids, e.g. A,B]
//
// Three different, feasible event configurations, all eight segments, the
// normal event and Recompletion. Each is built with the real build, applied,
// and then played by players the build never saw (another seed, their own
// luck). Reported per segment and phase:
//   - what the player pays against the demand (and the same event built
//     WITHOUT the calibration, for the before/after);
//   - when the twists are reached: the typical player, the distance from the
//     70-75% window, and how many players are before / inside / after it,
//     during play or only by the phase-end collection, or never;
//   - how the spins arrive: first spin, chances to spin, twists a chance,
//     the longest wait - kept apart from the timing;
//   - the other rewards against their targets, and the merge-energy credit;
//   - the board: how full it gets, dropped items that had to wait;
//   - Recompletion's hand-over read three ways (nothing is chosen);
//   - the same boards with every Twister item a rank bigger (an experiment).
import fs from 'node:fs'
import { createBoard, withListPhase } from '../../src/features/merge/lib/core/board.js'
import { withBlankCoinValues, REWARD_TYPES } from '../../src/features/merge/lib/rewards/rewardChain.js'
import { withDefaultTwisterValues } from '../../src/features/merge/lib/rewards/twisterEconomy.js'
import { buildEvent, segmentBuildInputs, rcInputsOnMainDraft, boardsWithDraftApplied } from '../../src/features/merge/lib/build/eventBuild.js'
import { recordCadenceRuns, cadenceSummary, timingOf, phaseDemand, builtTwisterOf, measureCandidate, candidateById, rcCarryScenarios, TWISTER_WINDOW_PCT } from '../../src/features/merge/lib/rewards/twisterCadence.js'

const PLAYERS = Number(process.argv[2] ?? 200)
const OUT = process.argv[3] ?? null
const ONLY = (process.argv[4] ?? 'A,B,C').split(',')
const SEED = 9001 // not a seed the build uses

// ---- the three events ----
function board(name, index, { rows, cols, openRows, value, rc, ev, tier2, tier4 }) {
  let b = createBoard(name, { rows, cols })
  b.tiles = b.tiles.map((row, r) => row.map(() => (r >= openRows ? 'blocked' : 'open')))
  if (index === 0) b.tiles[Math.min(rows - 1, 2)][Math.min(cols - 1, 4)] = 'semi'
  b.blockedValue = value
  b.minDropRank = 6
  b.twisterByBuild = true
  if (ev) b.targetEv = ev
  if (tier2) b.tier2UnlockRank = tier2
  if (tier4) b.tier4UnlockRank = tier4
  b.rewardChainConfig = withDefaultTwisterValues(withBlankCoinValues(b.rewardChainConfig))
  if (rc) b = withListPhase({ ...b, minRank: 3, maxRank: 13 }, 'rc')
  return b
}
const CONFIGS = {
  A: {
    name: 'A - reference: 3 normal boards, 4 Recompletion boards, 15 and 10 twists, price steps of 10',
    subsidies: [1800, 1650, 1500, 1350, 1150, 950, 800, 600],
    main: (s) => [150, Math.round((s - 150) * 0.45), s - 150 - Math.round((s - 150) * 0.45)],
    rc: (s) => {
      const rest = 6144 - (2048 - s) - 300
      return [300, Math.round(rest * 0.3), Math.round(rest * 0.35), rest - Math.round(rest * 0.3) - Math.round(rest * 0.35)]
    },
    shape: { first: { rows: 5, cols: 8, openRows: 3 }, wave: { rows: 3, cols: 8, openRows: 1 } },
    targets: { main: { coins: 3, puzzles: 300, energy: 200, charms: 400 }, rc: { coins: 5, puzzles: 500, energy: 300, charms: 700 } },
    factor: (i) => 1 + i * 0.1,
    twists: { main: 15, rc: 10 },
    step: 10,
  },
  B: {
    name: 'B - four normal boards, luckier generator (EV 1.25), 20 and 12 twists, price steps of 5',
    subsidies: [1700, 1500, 1300, 1100, 950, 800, 650, 500],
    main: (s) => {
      const rest = s - 150
      return [150, Math.round(rest * 0.25), Math.round(rest * 0.35), rest - Math.round(rest * 0.25) - Math.round(rest * 0.35)]
    },
    rc: (s) => {
      const rest = 6144 - (2048 - s) - 300
      return [300, Math.round(rest * 0.5), rest - Math.round(rest * 0.5)]
    },
    shape: { first: { rows: 5, cols: 8, openRows: 3 }, wave: { rows: 3, cols: 8, openRows: 1 } },
    ev: 1.25,
    targets: { main: { coins: 4, puzzles: 250, energy: 250, charms: 300 }, rc: { coins: 6, puzzles: 400, energy: 350, charms: 500 } },
    factor: (i) => 1 + i * 0.15,
    twists: { main: 20, rc: 12 },
    step: 5,
  },
  C: {
    name: 'C - a smaller first board (4x7), later generator tiers (8 / 11), smaller rewards, 10 and 8 twists, price steps of 10',
    subsidies: [1750, 1550, 1400, 1200, 1050, 900, 750, 650],
    main: (s) => [150, Math.round((s - 150) * 0.5), s - 150 - Math.round((s - 150) * 0.5)],
    rc: (s) => {
      const rest = 6144 - (2048 - s) - 300
      return [300, Math.round(rest * 0.4), rest - Math.round(rest * 0.4)]
    },
    shape: { first: { rows: 4, cols: 7, openRows: 2 }, wave: { rows: 3, cols: 7, openRows: 1 } },
    tiers: [8, 11],
    targets: { main: { coins: 2, puzzles: 180, energy: 120, charms: 220 }, rc: { coins: 3, puzzles: 300, energy: 200, charms: 400 } },
    factor: (i) => 1 + i * 0.08,
    twists: { main: 10, rc: 8 },
    step: 10,
  },
}
const rawOf = (cfg) =>
  cfg.subsidies.map((s, i) => {
    const list = (values, rc) => values.map((value, k) => board(`Board ${k + 1}`, k, { ...(k === 0 ? cfg.shape.first : cfg.shape.wave), value, rc, ev: cfg.ev, tier2: cfg.tiers?.[0], tier4: cfg.tiers?.[1] }))
    return {
      name: `Segment ${i + 1}`,
      mainBoards: list(cfg.main(s), false),
      rcBoards: list(cfg.rc(s), true),
      rewardTargets: cfg.targets,
      segmentFactor: cfg.factor(i),
      sourceAllocation: {},
      twisterPlan: { main: { targetSpins: cfg.twists.main, targetSpinsOverrides: {}, costIncrement: cfg.step, checkpointPct: 100 }, rc: { targetSpins: cfg.twists.rc, targetSpinsOverrides: {}, costIncrement: cfg.step, checkpointPct: 100 } },
    }
  })

async function buildBoth(raw, calibrateDemand = true) {
  const mainDraft = await buildEvent({ phase: 'main', segments: segmentBuildInputs(raw, 'main'), calibrateDemand })
  const rcDraft = await buildEvent({ phase: 'rc', segments: rcInputsOnMainDraft(raw, mainDraft), calibrateDemand })
  const applied = raw.map((seg, i) => ({
    name: seg.name,
    boards: boardsWithDraftApplied(seg.mainBoards, mainDraft.segments[i], mainDraft.shared, { draft: mainDraft }),
    rcBoards: boardsWithDraftApplied(seg.rcBoards, rcDraft.segments[i], rcDraft.shared, { draft: rcDraft }),
  }))
  return { mainDraft, rcDraft, applied }
}

const n = (v, d = 0) => (v == null || !Number.isFinite(v) ? '-' : v.toFixed(d))
const pc = (v) => (v == null ? '-' : `${Math.round(v * 100)}`)
const WINDOW = TWISTER_WINDOW_PCT
const distanceOf = (reach) => (reach == null ? null : reach < WINDOW[0] ? WINDOW[0] - reach : reach > WINDOW[1] ? reach - WINDOW[1] : 0)
const all = []

for (const id of ONLY) {
  const cfg = CONFIGS[id]
  if (!cfg) continue
  console.log(`\n######## ${cfg.name} ########`)
  const raw = rawOf(cfg)
  const t0 = Date.now()
  const built = await buildBoth(raw, true)
  const before = await buildBoth(raw, false) // the same event with the demand calibration switched off
  console.log(`built in ${Math.round((Date.now() - t0) / 1000)} s | statuses normal: ${built.mainDraft.segments.map((s) => s.status).join(' ')} | RC: ${built.rcDraft.segments.map((s) => s.status).join(' ')}`)
  for (const phase of ['main', 'rc']) {
    const draft = phase === 'main' ? built.mainDraft : built.rcDraft
    console.log(`\n--- ${phase === 'main' ? 'NORMAL EVENT' : 'RECOMPLETION'} (${cfg.twists[phase]} twists) - ${PLAYERS} players a segment, seed ${SEED}, each with their own luck ---`)
    for (let i = 0; i < built.applied.length; i++) {
      const seg = built.applied[i]
      const phaseBoards = phase === 'rc' ? seg.rcBoards : seg.boards
      const demand = phaseDemand(phase, phaseBoards)
      const tw = builtTwisterOf(phaseBoards)
      const records = recordCadenceRuns({ boards: seg.boards, rcBoards: phase === 'rc' ? seg.rcBoards : null, phase, runs: PLAYERS, seed: SEED })
      const s = cadenceSummary(records, { values: tw.values, cost: tw.cost, target: cfg.twists[phase], demand })
      const t = timingOf(s)
      const players = records.map((r) => r.phaseDr)
      const paidMean = players.reduce((x, v) => x + v, 0) / players.length
      const paidMedian = [...players].sort((a, b) => a - b)[Math.floor(players.length / 2)]
      // the same segment built with no calibration, played by the same players
      const bSeg = before.applied[i]
      const bRecords = recordCadenceRuns({ boards: bSeg.boards, rcBoards: phase === 'rc' ? bSeg.rcBoards : null, phase, runs: PLAYERS, seed: SEED })
      const bPaid = bRecords.reduce((x, r) => x + r.phaseDr, 0) / bRecords.length
      const seen = { before: 0, within: 0, after: 0, atEnd: 0, never: 0 }
      // (player by player: where their own twists land)
      const perPlayer = records.map((r) => {
        let earned = 0
        let spins = 0
        let at = null
        let end = false
        for (const [dr, rank, isEnd] of r.collects) {
          earned += tw.values[Math.min(rank, 4) - 1]
          const now = Math.floor((earned + 1e-9) / tw.cost)
          if (now > spins) {
            spins = now
            if (at == null && spins >= cfg.twists[phase]) {
              at = (dr / demand) * 100
              end = isEnd
            }
          }
        }
        return { at, end }
      })
      for (const p of perPlayer) {
        if (p.at == null) seen.never += 1
        else if (p.end) seen.atEnd += 1
        else if (p.at < WINDOW[0]) seen.before += 1
        else if (p.at <= WINDOW[1]) seen.within += 1
        else seen.after += 1
      }
      const share = (k) => Math.round((100 * seen[k]) / perPlayer.length)
      const row = draft.segments[i]
      const targets = row.targets ?? {}
      const rewards = REWARD_TYPES.map((type) => (targets[type] > 0 ? Math.round((100 * s.payouts[type].mean) / targets[type]) : null))
      const creditMeasured = 0.8 * s.payouts.energy.mean
      const carry = phase === 'rc' ? rcCarryScenarios(records, { values: tw.values, cost: tw.cost, mainCost: builtTwisterOf(seg.boards).cost, target: cfg.twists.rc, demand }) : null
      const segment = { name: seg.name, boards: seg.boards, rcBoards: phase === 'rc' ? seg.rcBoards : null, twists: { main: phase === 'main' ? cfg.twists.main : null, rc: phase === 'rc' ? cfg.twists.rc : null }, step: cfg.step }
      // The candidate: bigger Twister items at ranks 7-9 only (rank 5 keeps its rank-1 item).
      const big = measureCandidate({ segment, candidate: candidateById('bigger79'), runs: PLAYERS, seed: SEED, phases: [phase], lockedValues: phase === 'rc' ? tw.values : null })[phase]
      const bt = timingOf(big?.atFit)
      const out = {
        config: id,
        phase,
        segment: seg.name,
        demand,
        status: row.status,
        paid: { mean: paidMean, median: paidMedian, p10: s.drSpent.p10, p90: s.drSpent.p90, diffPct: ((paidMean - demand) / demand) * 100, completed: s.completed, beforeMean: bPaid, beforeDiffPct: ((bPaid - demand) / demand) * 100 },
        subsidy: { budget: row.subsidy.budget, energyCredit: row.subsidy.creditApplied, calibration: row.subsidy.calibration, creditMeasured, constraint: row.demandFit.constraint, limit: row.demandFit.limit, jump: row.demandFit.jump ?? null, spendRange: row.demandFit.spendRange, steps: row.demandFit.steps },
        // Merge energy of the phase, a player on average, and the generator actions.
        energy: s.energy,
        paidTaps: s.paidTaps.mean,
        firstSpinActions: t.firstSpinActions,
        twister: { values: tw.values, cost: tw.cost, reach: t.reachPct, distance: distanceOf(t.reachPct), verdict: t.verdict, players: { before70: share('before'), within: share('within'), after75: share('after'), onlyAtEnd: share('atEnd'), never: share('never') }, firstSpin: t.firstSpinPct, chances: t.chances, perChance: t.twistsPerChance, longestWait: t.longestGap, finishedItems: t.finishedItems, endPct: t.endPct, oneBig: s.oneBigCollection },
        rewards,
        board: { peak: s.peakOccupancy.p50, peakMax: s.peakOccupancy.max, full: s.boardFull, delayed: s.delayedDrops.mean, twisterDelayed: s.delayedTwisterDrops.mean, suppressed: s.suppressedDrops.max, forcedTaps: s.spaceCollects.mean },
        carry,
        bigger: bt ? { values: big.fit.values, cost: big.fit.cost, reach: bt.reachPct, distance: distanceOf(bt.reachPct), chances: bt.chances, perChance: bt.twistsPerChance, longestWait: bt.longestGap, firstSpin: bt.firstSpinPct, peak: big.atFit.peakOccupancy.p50, delayed: big.atFit.delayedDrops.mean, forcedTaps: big.atFit.spaceCollects.mean, rewards: REWARD_TYPES.map((type) => (s.payouts[type].mean > 0 ? Math.round((1000 * big.atFit.payouts[type].mean) / s.payouts[type].mean) / 10 : null)), drPct: Math.round((1000 * big.atFit.drSpent.mean) / s.drSpent.mean) / 10 } : null,
      }
      all.push(out)
      console.log(
        `${seg.name} demand ${String(demand).padStart(4)} | pays ${n(paidMean).padStart(4)} (${out.paid.diffPct >= 0 ? '+' : ''}${n(out.paid.diffPct, 1)}%) median ${paidMedian} [${s.drSpent.p10}-${s.drSpent.p90}] done ${pc(s.completed)}% ; uncalibrated ${n(bPaid)} (${n(out.paid.beforeDiffPct, 1)}%) | boards ${n(row.demandFit.steps.initial)} - energy credit ${n(row.subsidy.creditApplied)} ${row.subsidy.calibration >= 0 ? '-' : '+'} calibration ${n(Math.abs(row.subsidy.calibration))} = ${n(row.demandFit.steps.generated)}${row.demandFit.constraint ? ` [${row.demandFit.constraint}${row.demandFit.spendRange ? `, found ${n(row.demandFit.spendRange.low)}-${n(row.demandFit.spendRange.high)}` : ''}]` : ''} | energy: start ${n(s.energy.start)} + play ${n(s.energy.play)} + cleanup ${n(s.energy.cleanup)}, used ${n(s.energy.used)}, left ${n(s.energy.left)} | twister ${tw.values.join('/')} @${tw.cost}: reach ${n(t.reachPct)}% dist ${n(out.twister.distance, 1)} | players <70 ${share('before')} in ${share('within')} >75 ${share('after')} end-only ${share('atEnd')} never ${share('never')} | first ${n(t.firstSpinPct)}% (after ${n(t.firstSpinActions)} generator actions) chances ${n(t.chances)} x${n(t.twistsPerChance, 1)} wait ${n(t.longestGap)} | rewards ${rewards.map((v) => v ?? '-').join('/')}% | board peak ${pc(s.peakOccupancy.p50)}% (max ${pc(s.peakOccupancy.max)}%) waiting ${n(s.delayedDrops.mean, 1)} taps ${n(s.spaceCollects.mean, 1)}`,
      )
      if (bt) console.log(`           + bigger at ranks 7-9: ${big.fit.values.join('/')} @${big.fit.cost}: reach ${n(bt.reachPct)}% dist ${n(out.bigger.distance, 1)} | chances ${n(bt.chances)} x${n(bt.twistsPerChance, 1)} wait ${n(bt.longestGap)} first ${n(bt.firstSpinPct)}% | rewards ${out.bigger.rewards.join('/')}% DR ${out.bigger.drPct}% | board peak ${pc(big.atFit.peakOccupancy.p50)}% waiting ${n(big.atFit.delayedDrops.mean, 1)} taps ${n(big.atFit.spaceCollects.mean, 1)}`)
      if (carry) console.log(`           hand-over: ${n(carry.carriedItems.mean, 1)} Twister items carried in (worth ${n(carry.carriedWorth.mean)} DR), unspent balance ${n(carry.unspentBalance.mean)} | items carried: first spin ${n(carry.items.firstSpinPct.p50)}% after ${n(carry.items.firstSpinActions.p50)} generator actions, twists at ${n(carry.items.reachPct)}% | nothing carried: ${n(carry.nothing.firstSpinPct.p50)}%, ${n(carry.nothing.reachPct)}% | items + balance: ${n(carry.balance.firstSpinPct.p50)}%, ${n(carry.balance.reachPct)}%`)
    }
  }
}

// ---- the whole picture ----
console.log('\n################ SUMMARY ################')
for (const phase of ['main', 'rc']) {
  const rows = all.filter((r) => r.phase === phase)
  if (!rows.length) continue
  const avg = (list) => list.reduce((x, v) => x + v, 0) / Math.max(1, list.length)
  const inWin = rows.filter((r) => r.twister.distance === 0).length
  const near = rows.filter((r) => r.twister.distance != null && r.twister.distance <= 3).length
  const bigIn = rows.filter((r) => r.bigger?.distance === 0).length
  const bigNear = rows.filter((r) => r.bigger?.distance != null && r.bigger.distance <= 3).length
  console.log(`\n${phase === 'main' ? 'NORMAL EVENT' : 'RECOMPLETION'} - ${rows.length} segments over ${new Set(rows.map((r) => r.config)).size} events`)
  console.log(`  pays vs demand: average difference ${n(avg(rows.map((r) => Math.abs(r.paid.diffPct))), 1)}% (worst ${n(Math.max(...rows.map((r) => Math.abs(r.paid.diffPct))), 1)}%); without calibration ${n(avg(rows.map((r) => r.paid.beforeDiffPct)), 1)}% on average (from ${n(Math.min(...rows.map((r) => r.paid.beforeDiffPct)), 1)}% to ${n(Math.max(...rows.map((r) => r.paid.beforeDiffPct)), 1)}%)`)
  console.log(`  segments within 2% of demand: ${rows.filter((r) => Math.abs(r.paid.diffPct) <= 2).length}, within 5%: ${rows.filter((r) => Math.abs(r.paid.diffPct) <= 5).length} of ${rows.length}; proven limits: ${rows.filter((r) => r.subsidy.limit === 'proven').map((r) => `${r.config}/${r.segment} ${r.subsidy.constraint} (${n(r.paid.diffPct, 1)}%)`).join(', ') || 'none'}; not settled: ${rows.filter((r) => r.subsidy.limit === 'not-settled').map((r) => `${r.config}/${r.segment} (${n(r.paid.diffPct, 1)}%)`).join(', ') || 'none'}`)
  console.log(`  twists - segment medians in the window: ${inWin} of ${rows.length}; within 3 points of it: ${near}; furthest ${n(Math.max(...rows.map((r) => r.twister.distance ?? 99)), 1)} points; never-reached segments ${rows.filter((r) => r.twister.reach == null).length}`)
  console.log(`  twists - individual players: before 70% ${n(avg(rows.map((r) => r.twister.players.before70)))}%, inside ${n(avg(rows.map((r) => r.twister.players.within)))}%, after 75% ${n(avg(rows.map((r) => r.twister.players.after75)))}%, only at the phase end ${n(avg(rows.map((r) => r.twister.players.onlyAtEnd)))}%, never ${n(avg(rows.map((r) => r.twister.players.never)))}%`)
  console.log(`  cadence: first spin at ${n(avg(rows.map((r) => r.twister.firstSpin)))}% on average; chances to spin ${n(Math.min(...rows.map((r) => r.twister.chances)))}-${n(Math.max(...rows.map((r) => r.twister.chances)))}; twists a chance ${n(Math.min(...rows.map((r) => r.twister.perChance)), 1)}-${n(Math.max(...rows.map((r) => r.twister.perChance)), 1)}; longest wait ${n(Math.min(...rows.map((r) => r.twister.longestWait)))}-${n(Math.max(...rows.map((r) => r.twister.longestWait)))} points`)
  console.log(`  + bigger at ranks 7-9: medians in the window ${bigIn} of ${rows.length}, within 3 points ${bigNear}; chances ${n(Math.min(...rows.map((r) => r.bigger?.chances ?? 0)))}-${n(Math.max(...rows.map((r) => r.bigger?.chances ?? 0)))}; twists a chance ${n(Math.min(...rows.map((r) => r.bigger?.perChance ?? 0)), 1)}-${n(Math.max(...rows.map((r) => r.bigger?.perChance ?? 0)), 1)}; longest wait ${n(Math.min(...rows.map((r) => r.bigger?.longestWait ?? 0)))}-${n(Math.max(...rows.map((r) => r.bigger?.longestWait ?? 0)))}; other rewards ${n(Math.min(...rows.flatMap((r) => r.bigger?.rewards ?? [])), 1)}-${n(Math.max(...rows.flatMap((r) => r.bigger?.rewards ?? [])), 1)}% of this build's; DR ${n(Math.min(...rows.map((r) => r.bigger?.drPct ?? 100)), 1)}-${n(Math.max(...rows.map((r) => r.bigger?.drPct ?? 100)), 1)}%`)
  console.log(`  rewards vs target: ${REWARD_TYPES.map((type, k) => `${type} ${n(Math.min(...rows.map((r) => r.rewards[k] ?? 100)))}-${n(Math.max(...rows.map((r) => r.rewards[k] ?? 100)))}%`).join(', ')}`)
  console.log(`  merge energy a player (average over segments): starts with ${n(avg(rows.map((r) => r.energy.start)))}, collects ${n(avg(rows.map((r) => r.energy.play)))} in play and ${n(avg(rows.map((r) => r.energy.cleanup)))} at the phase end, uses ${n(avg(rows.map((r) => r.energy.used)))}, ends with ${n(avg(rows.map((r) => r.energy.left)))}; credit taken off the boards ${n(avg(rows.map((r) => r.subsidy.energyCredit)))} DR`)
  console.log(`  energy credit applied vs 80% of the energy these players collected: ${n(avg(rows.map((r) => (r.subsidy.creditMeasured > 0 ? (100 * r.subsidy.energyCredit) / r.subsidy.creditMeasured : 100))), 1)}% on average`)
  console.log(`  board: fullest ${n(Math.max(...rows.map((r) => r.board.peakMax)) * 100)}%, typical peak ${n(avg(rows.map((r) => r.board.peak)) * 100)}%; players whose board was ever full ${n(avg(rows.map((r) => r.board.full)) * 100)}%; dropped items waiting off the board ${n(avg(rows.map((r) => r.board.delayed)), 2)} a player; thrown away ${Math.max(...rows.map((r) => r.board.suppressed))}; forced taps ${n(avg(rows.map((r) => r.board.forcedTaps)), 2)}`)
  const heavy = rows.filter((r) => r.segment === 'Segment 1')
  console.log(`  the segment with the most subsidy (Segment 1 of each event): ${heavy.map((r) => `${r.config}: ${n(r.twister.chances)} x${n(r.twister.perChance, 1)}, wait ${n(r.twister.longestWait)}, reach ${n(r.twister.reach)}% -> bigger ${n(r.bigger?.chances)} x${n(r.bigger?.perChance, 1)}, wait ${n(r.bigger?.longestWait)}, reach ${n(r.bigger?.reach)}%`).join(' | ')}`)
  if (phase === 'rc') {
    console.log(`  hand-over (average over segments): first spin with items carried ${n(avg(rows.map((r) => r.carry.items.firstSpinPct.p50 ?? 0)))}%, with nothing carried ${n(avg(rows.map((r) => r.carry.nothing.firstSpinPct.p50 ?? 0)))}%, with items and balance ${n(avg(rows.map((r) => r.carry.balance.firstSpinPct.p50 ?? 0)))}%; twists reached at ${n(avg(rows.map((r) => r.carry.items.reachPct ?? 100)))}% / ${n(avg(rows.map((r) => r.carry.nothing.reachPct ?? 100)))}% / ${n(avg(rows.map((r) => r.carry.balance.reachPct ?? 100)))}%`)
  }
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(all))
