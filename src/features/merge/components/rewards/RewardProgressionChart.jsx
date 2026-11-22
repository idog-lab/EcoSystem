import Card from '../../../../components/ui/Card'
import { REWARD_TYPES, REWARD_TYPE_LABELS } from '../../lib/rewards/rewardChain'
import { buildSeries } from '../../lib/rewards/rewardProgression'

// "I want a graph that shows the progression of the drops with the merges
// the user is doing" - a live chart (Play Tester) of cumulative collected
// reward per resource type, plotted against the player's own merge-count
// progression (not wall-clock time or DR spent - merges are the thing that
// actually produces a drop, so that's the natural x-axis here). Reads
// directly off `session.events` (playSession.js's own event log - the same
// 'merge'/'collect' events everything else in Play Tester already uses),
// so this is never a second, parallel bookkeeping system that could drift
// from what actually happened.
//
// Four independent mini line-charts, one per resource type, each scaled to
// ITS OWN max - the same "a shared cross-metric scale would be meaningless"
// reasoning EffortDistributionChart.jsx already applies (coins run in the
// hundred-thousands, energy in single digits; one shared axis would make
// three of the four series invisible next to coins). No charting library -
// plain inline SVG, matching this app's own "no charting library, ever"
// convention (CLAUDE.md's Style/stack notes).
const CHART_HEIGHT = 64
const CHART_WIDTH = 240

const TYPE_COLOR = { coins: '#d97706', puzzles: '#7c3aed', energy: '#0891b2', charms: '#db2777' }

function MiniLineChart({ points, color, max }) {
  if (max <= 0) {
    return (
      <div className="h-16 flex items-center justify-center text-xs text-slate-300 border border-dashed border-slate-200 rounded-lg">
        No drops yet
      </div>
    )
  }
  const maxX = Math.max(1, points[points.length - 1][0])
  const toSvgX = (x) => (x / maxX) * CHART_WIDTH
  const toSvgY = (y) => CHART_HEIGHT - (y / max) * CHART_HEIGHT
  const pathD = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${toSvgX(x).toFixed(1)} ${toSvgY(y).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full h-16" preserveAspectRatio="none">
      <path d={pathD} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// `hideEmpty`: nothing is drawn until a first reward is collected (four empty
// boxes saying "No drops yet" were the first thing under a new game).
export default function RewardProgressionChart({ events, hideEmpty = false }) {
  const { series, mergeCount, totals } = buildSeries(events ?? [])
  if (hideEmpty && REWARD_TYPES.every((type) => Math.max(...series[type].map(([, y]) => y), 0) <= 0)) return null
  return (
    <Card
      title="Reward progression"
      subtitle={`Cumulative small-reward collection vs. merges made so far (${mergeCount} merge${mergeCount === 1 ? '' : 's'})`}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {REWARD_TYPES.map((type) => {
          const points = series[type]
          const max = Math.max(...points.map(([, y]) => y), 0)
          return (
            <div key={type}>
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{REWARD_TYPE_LABELS[type]}</span>
                <span className="text-sm font-display font-semibold" style={{ color: TYPE_COLOR[type] }}>
                  {totals[type].toFixed(1)}
                </span>
              </div>
              <MiniLineChart points={points} color={TYPE_COLOR[type]} max={max} />
            </div>
          )
        })}
      </div>
    </Card>
  )
}
