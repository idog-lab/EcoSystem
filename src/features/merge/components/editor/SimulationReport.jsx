import { PlayCircle, AlertCircle, LineChart } from 'lucide-react'
import Card from '../../../../components/ui/Card'
import Button from '../../../../components/ui/Button'
import { colorForRank } from '../../lib/core/ranks'
import { buildSimulationRows } from '../../lib/simulation/simulationRows'

const STOP_REASON_LABEL = {
  'max-rank-reached': 'reached rank 12',
  'rc-max-rank-reached': 'reached rank 14 (RC grand prize)',
  'no-legal-move': 'stuck — no legal merge and no room to spawn',
  'budget-exhausted': 'DR budget ran out',
  'max-steps': 'hit the simulation step safety limit',
}

// One event-level simulation of the WHOLE board chain, always starting at
// board 1 - not a per-board report. Every board in a list covers the same
// interval of the same event (they're waves of one continuous playthrough,
// not alternative starting points), so this reads identically whichever
// board happens to be selected in the editor, by explicit economist request.
// It used to start at the selected board's own index instead, which made the
// same card report a different, shorter run on every board.
//
// The chaining itself is mergeSimulation.js's: once the active board has no
// unrevealed blocked tile and no still-stuck semi/revealed item left
// (`boardIsCleared`), the next board pushes in as a wave of rows from the
// top and the run continues into its blocked queue - cascading through as
// many boards as clear instantly, and simply stopping once the list runs out.
//
// The run itself (result/drBudgetInput/handleRun, plus the stale-on-layout-
// change invalidation) lives one level up in BoardEditor.jsx now, not here -
// EffortDistributionChart.jsx (rendered under the Blocked Queue card) needs
// the exact same `result` this table does, and lifting the state up is what
// lets both read the same run instead of each triggering its own separate
// simulation.
export default function SimulationReport({ boards, drBudgetInput, onDrBudgetInputChange, result, onRun, needsGeneration, ungenerated }) {
  const rows = buildSimulationRows(result)
  const anyOutOfOrder = rows.some((r) => r.outOfOrder)
  const maxDr = result ? Math.max(1, ...Object.values(result.reachedAt)) : 0

  return (
    <Card
      title="Playthrough simulation"
      subtitle={`Simulated DR spent, and generator taps needed, to first reach each rank — across all ${boards.length} board${boards.length === 1 ? '' : 's'}, starting from board 1`}
      icon={LineChart}
      className="flex-1 min-w-64"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-end gap-3">
          <label className="text-sm flex flex-col gap-1.5 flex-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">DR budget (blank = unlimited)</span>
            <input
              type="number"
              min={0}
              placeholder="Unlimited"
              value={drBudgetInput}
              onChange={(e) => onDrBudgetInputChange(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-medium bg-white/70 focus:outline-none focus:ring-4 focus:ring-purple-200/60 focus:border-purple-400"
            />
          </label>
          <Button variant="primary" icon={PlayCircle} onClick={onRun} disabled={needsGeneration}>
            Run
          </Button>
        </div>

        {needsGeneration && (
          <p className="text-xs text-amber-600">
            {ungenerated.length === 1 ? (
              <>
                <strong>{ungenerated[0].name}</strong> has blocked/semi tiles with no generated items yet
              </>
            ) : (
              <>
                {ungenerated.length} boards have blocked/semi tiles with no generated items yet (
                {ungenerated.map((b) => b.name).join(', ')})
              </>
            )}{' '}
            — generate items on {ungenerated.length === 1 ? 'it' : 'each of them'} first, or the simulation won't
            reflect them.
          </p>
        )}

        {result && (
          <>
            {/* overflow-x-auto: this row's minimum width (6 columns, several
                of them holding signed numbers/percentages) can exceed the
                card's actual available width once it's squeezed into a
                multi-card flex row - scroll inside the table itself rather
                than silently clipping the rightmost columns (Taps used to
                just disappear off the edge with no way to see it). */}
            <div className="overflow-x-auto">
            <div className="grid grid-cols-[4.5rem_1fr_3rem_3rem_3.5rem_3rem] gap-x-2 gap-y-1.5 items-center text-sm min-w-[26rem]">
              <div className="contents text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <span />
                <span />
                <span className="text-right">DR</span>
                <span className="text-right">+DR</span>
                <span className="text-right">% eff.</span>
                <span className="text-right">Taps</span>
              </div>
              {rows.map(({ rank, dr, drDelta, pctOfEffort, tapsDelta, outOfOrder }) => {
                const pct = dr == null ? 0 : (Math.log(dr + 1) / Math.log(maxDr + 1)) * 100
                // A negative delta means this rank was reached (in real DR
                // terms) before the rank right below it - see
                // simulationRows.js's own comment for why. Flagged rather
                // than hidden: signed properly (no more "+-48"), colored
                // amber instead of the usual gray, and explained on hover
                // rather than reading like broken math.
                const outOfOrderTitle = outOfOrder
                  ? `Reached before rank ${rank - 1} — a bigger item showed up sooner (a blocked-queue reveal, or a later board's wave pushing in), while rank ${rank - 1} took a separate, slower merge chain to build. Not an error — drSpent itself never goes backwards.`
                  : undefined
                return (
                  <div key={rank} className="contents">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorForRank(rank) }} />
                      Rank {rank}
                    </span>
                    <div className="bg-slate-100 rounded-full h-2 overflow-hidden">
                      {dr != null && (
                        <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 4)}%`, backgroundColor: colorForRank(rank) }} />
                      )}
                    </div>
                    <span className="text-right tabular-nums font-medium text-slate-500">{dr ?? '—'}</span>
                    <span
                      className={`text-right tabular-nums ${outOfOrder ? 'text-amber-600 font-medium' : 'text-slate-400'}`}
                      title={outOfOrderTitle}
                    >
                      {drDelta != null ? (drDelta >= 0 ? `+${drDelta}` : drDelta) : ''}
                    </span>
                    <span
                      className={`text-right tabular-nums ${outOfOrder ? 'text-amber-600 font-medium' : 'text-slate-400'}`}
                      title={outOfOrderTitle}
                    >
                      {pctOfEffort != null
                        ? `${Math.abs(pctOfEffort) < 0.1 && pctOfEffort !== 0 ? (pctOfEffort < 0 ? '>-0.1' : '<0.1') : pctOfEffort.toFixed(1)}%`
                        : ''}
                    </span>
                    {/* Bare "+N", not "+N taps" - the "Taps" column header
                        already says the unit, matching DR/+DR/% effort's own
                        bare-number style rather than being the one column
                        that repeats it inline (which also made this the
                        widest, most ragged-looking column at a glance). */}
                    <span className="text-right tabular-nums text-slate-400">{tapsDelta != null ? `+${tapsDelta}` : ''}</span>
                  </div>
                )
              })}
            </div>
            </div>

            {anyOutOfOrder && (
              <p className="text-xs text-amber-600">
                Amber rows were reached before the rank just below them — the blocked queue or a wave board can
                front-load a bigger item while a lower rank is still being built up separately. Hover a row for
                details; it isn't an error.
              </p>
            )}

            <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>
                Stopped after {result.drSpent} DR — {STOP_REASON_LABEL[result.stopReason] ?? result.stopReason}.
                {result.inventoryRemaining > 0 &&
                  ` ${result.inventoryRemaining} item${result.inventoryRemaining === 1 ? '' : 's'} from pushed-in boards never made it back onto the board.`}
              </span>
            </div>

            {/* Why "spent N DR" can look far higher than (2048 - subsidy)
                suggests it should: the run ends the moment rank 12 is
                reached, and a board only pushes in once the previous one is
                fully cleared - so subsidy sitting on boards the player never
                reaches is never handed out, and they pay for that part of
                the climb themselves. Reporting only the bare DR total left
                that invisible and made the number look broken rather than
                informative (found live from exactly that report). */}
            {result.subsidyConfigured > 0 && (
              <div
                className={`flex flex-col gap-1.5 text-xs rounded-xl p-3 border ${
                  result.subsidyDelivered < result.subsidyConfigured
                    ? 'text-amber-700 bg-amber-50 border-amber-200'
                    : 'text-slate-500 bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>Subsidy actually delivered{result.mainPhase ? ' (main phase)' : ''}</span>
                  <span className="tabular-nums font-semibold">
                    {result.subsidyDelivered} / {result.subsidyConfigured} DR
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Boards the player reached{result.mainPhase ? ' (main phase)' : ''}</span>
                  <span className="tabular-nums font-semibold">
                    {result.boardsReached} / {result.boardsTotal}
                  </span>
                </div>
                {result.subsidyDelivered < result.subsidyConfigured && (
                  <span className="mt-0.5">
                    {result.subsidyConfigured - result.subsidyDelivered} DR of subsidy never reached the player — the
                    run ended before those tiles were revealed
                    {result.boardsReached < result.boardsTotal &&
                      `, and ${result.boardsTotal - result.boardsReached} board${
                        result.boardsTotal - result.boardsReached === 1 ? '' : 's'
                      } never pushed in at all`}
                    . That's why the DR spent is higher than "chain value minus subsidy" would suggest: the player paid
                    for that part of the climb themselves. Move subsidy onto earlier boards, or trim the later ones.
                  </span>
                )}
              </div>
            )}

            {result.rcPhase && (
              <div className="flex flex-col gap-1.5 text-xs rounded-xl p-3 border text-purple-700 bg-purple-50 border-purple-200">
                <div className="font-semibold">RC phase{result.secondGrandPrizeAwarded ? ' — grand prize awarded' : ''}</div>
                <div className="flex items-center justify-between">
                  <span>Subsidy delivered (RC)</span>
                  <span className="tabular-nums font-semibold">
                    {result.rcPhase.subsidyDelivered} / {result.rcPhase.subsidyConfigured} DR
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>RC boards reached</span>
                  <span className="tabular-nums font-semibold">
                    {result.rcPhase.boardsReached} / {result.rcPhase.boardsTotal}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
