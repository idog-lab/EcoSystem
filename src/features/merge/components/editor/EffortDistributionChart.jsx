import { BarChart3 } from 'lucide-react'
import Card from '../../../../components/ui/Card'
import { colorForRank } from '../../lib/core/ranks'
import { buildSimulationRows, RANKS } from '../../lib/simulation/simulationRows'

// Same 12 slots, all empty, used before a simulation has ever run - see the
// component's own comment below for why this shape (not a short "run it
// first" placeholder) is the point.
const emptyRows = (ranks) => ranks.map((rank) => ({
  rank,
  dr: null,
  drDelta: null,
  pctOfEffort: null,
  tapsDelta: null,
  outOfOrder: false,
}))

const OUT_OF_ORDER_COLOR = '#d97706' // amber-600, matching SimulationReport's own out-of-order treatment

// A single labeled strip of 12 bars, one metric at a time - shared by all
// four rows below so the "normalize to the biggest magnitude, log-scale a
// DR-shaped value, flag out-of-order ranks amber" logic only lives once.
// `getValue(row)` returns the raw number for that rank (or null/undefined
// if this rank has no value for this metric - e.g. a rank never reached);
// `useLog` mirrors SimulationReport's own DR-column choice (DR/+DR/Taps
// deltas can be as exponentially skewed as cumulative DR itself, so a
// straight linear scale would flatten every early rank to invisible slivers
// next to rank 12).
function MetricRow({ label, rows, getValue, formatValue, useLog = false }) {
  const withValues = rows.filter((r) => getValue(r) != null)
  const maxAbs = Math.max(1, ...withValues.map((r) => Math.abs(getValue(r))))

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <div className="flex items-end gap-1.5 h-20">
        {rows.map((row) => {
          const raw = getValue(row)
          const magnitude = raw == null ? 0 : Math.abs(raw)
          const heightPct =
            raw == null ? 0 : Math.max(4, useLog ? (Math.log(magnitude + 1) / Math.log(maxAbs + 1)) * 100 : (magnitude / maxAbs) * 100)
          const color = row.outOfOrder ? OUT_OF_ORDER_COLOR : colorForRank(row.rank)
          const title = raw == null ? (row.aside ? `Rank ${row.rank} — first made after a higher rank, so not part of the climb` : `Rank ${row.rank} — not reached`) : `Rank ${row.rank}: ${formatValue(raw)}`
          return (
            <div key={row.rank} className="flex-1 flex flex-col items-center gap-0.5 min-w-0" title={title}>
              <div className="w-full flex items-end h-16 bg-slate-50 rounded-md overflow-hidden">
                {raw != null && <div className="w-full rounded-t-sm transition-all" style={{ height: `${heightPct}%`, backgroundColor: color }} />}
              </div>
              <span className={`text-[9px] tabular-nums leading-tight ${row.outOfOrder ? 'text-amber-600 font-semibold' : 'text-slate-400'}`}>
                {raw != null ? formatValue(raw) : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// A graph version of the "Playthrough simulation" card's own per-rank
// table, placed right under the Blocked Queue card - by explicit economist
// request ("under the blocked queue... a graph that will show the data from
// the playthrough simulator", then "i want to see all the data from the
// playthrough in the graphs" - all four of the table's own columns, not
// just one). Deliberately reads the SAME `result` the table does (lifted up
// into BoardEditor.jsx, not a separate simulation run triggered from here) -
// the two can never disagree about what the last run actually found, and
// running the simulation twice for one click would be wasteful.
//
// Plain div/Tailwind bars, not a charting library - this app has never
// pulled one in (see Diamond Mine's SolveBar, and every progress bar
// already in SimulationReport.jsx) for exactly this kind of simple, static
// visualization; four small rows of twelve bars each didn't warrant
// changing that now.
// Always renders its full 4-metric-row shape, populated or not - by
// explicit economist request ("the graphs appear and push all the blocks
// to different places... lets make the effort distribution to be with the
// size he needs to be"). The very first version swapped a one-line "run it
// first" placeholder for the whole chart the instant a simulation
// completed, so clicking "Run" over in the Playthrough simulation card
// reflowed this card - and everything below/beside it - from a few dozen
// pixels tall to several hundred. Rendering the same 12-empty-slot shape
// before a run as after one (via EMPTY_ROWS, same shape `buildSimulationRows`
// produces but with every value null) means this card's height never
// changes across a run - only the bars themselves fill in.
// `ranks`: the ranks drawn - 1 to 12, or 1 to 14 for Recompletion's own climb.
export default function EffortDistributionChart({ result, subtitle = "All four Playthrough simulation columns, per rank — from that card's last run", ranks = RANKS, title = 'Effort distribution', rows: givenRows = null, footnote = null }) {
  // `rows`: rows worked out by the caller (Recompletion's climb), else the result's own.
  const rows = givenRows ?? (result ? buildSimulationRows(result, ranks) : emptyRows(ranks))
  const rankLabels = (
    <div className="flex items-end gap-1.5">
      {ranks.map((rank) => (
        <span key={rank} className="flex-1 text-center text-[10px] font-semibold text-slate-500 min-w-0">
          {rank}
        </span>
      ))}
    </div>
  )

  return (
    <Card
      title={title}
      subtitle={subtitle}
      icon={BarChart3}
    >
      <div className="flex flex-col gap-4">
        <MetricRow label="DR (cumulative)" rows={rows} getValue={(r) => r.dr} formatValue={(v) => String(v)} useLog />
        <MetricRow
          label="+DR"
          rows={rows}
          getValue={(r) => r.drDelta}
          formatValue={(v) => (v >= 0 ? `+${v}` : String(v))}
          useLog
        />
        <MetricRow
          label="% effort"
          rows={rows}
          getValue={(r) => r.pctOfEffort}
          formatValue={(v) => `${v.toFixed(v < 10 && v > -10 ? 1 : 0)}%`}
        />
        <MetricRow label="Taps" rows={rows} getValue={(r) => r.tapsDelta} formatValue={(v) => `+${v}`} useLog />
        {rankLabels}
        <p className="text-xs text-slate-400 -mt-1">
          {footnote
            ? footnote
            : result
            ? 'DR/+DR/Taps use a log scale (they\'re as exponentially skewed as cumulative DR itself) — % effort is linear. Amber bars were reached before the rank right below them (not an error — see the table above for why). Hover any bar for its exact value.'
            : 'Run the playthrough simulation (in the "Playthrough simulation" card below) to fill these bars in.'}
        </p>
      </div>
    </Card>
  )
}
