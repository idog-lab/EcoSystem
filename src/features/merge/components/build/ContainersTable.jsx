import GameArt from '../play/GameArt'
import { modelContainers, groupContainerRows } from '../../lib/rewards/containers'
import { ALL_REWARD_TYPES } from '../../lib/rewards/rewardChain'

// The containers a list drops, as the model plays them and as the "Small
// Rewards Bank" / "Small Reward Weights" sheets export them (lib/containers.js):
// one row per container - its key, what is in it, how it is written - and its
// weight for each stretch of merge ranks that share the same weights.
export default function ContainersTable({ dropGroups, dropGroupsConfig, minDropRank, phase = 'main', testid = 'containers' }) {
  const { containers, rows } = modelContainers({ dropGroups, dropGroupsConfig, minDropRank, phase })
  if (containers.length === 0) {
    return (
      <p className="text-xs text-slate-500" data-testid={`${testid}-empty`}>
        No containers: nothing drops from merges in this design.
      </p>
    )
  }
  const runs = groupContainerRows(rows)
  const dropping = runs.filter((run) => run.row.eligible)
  const silent = runs.filter((run) => !run.row.eligible)
  const span = (run) => (run.from === run.to ? `rank ${run.from}` : `ranks ${run.from}–${run.to}`)
  const share = (weight, total) => (total > 0 ? `${Math.round((weight / total) * 1000) / 10}%` : '0%')
  // How many drops hold two or more items, per stretch of merge ranks - the
  // number that rises with the rank.
  const itemCount = new Map(containers.map((c) => [c.id, Object.keys(c.items ?? {}).length]))
  const weightOf = (run, atLeast) => Object.entries(run.row.weights).reduce((sum, [id, weight]) => sum + ((itemCount.get(id) ?? 0) >= atLeast ? weight : 0), 0)
  const multiWeight = (run) => weightOf(run, 2)
  // With one item per merge no container holds two items: the two rows
  // about several-item drops are left out.
  const anyMulti = containers.some((c) => Object.keys(c.items ?? {}).length >= 2)
  return (
    <div className="flex flex-col gap-2" data-testid={testid}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm tabular-nums">
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-200">
              <th className="py-1.5 pr-3">Container</th>
              <th className="py-1.5 pr-3">What it drops</th>
              <th className="py-1.5 pr-3">Written as</th>
              {dropping.map((run) => (
                <th key={run.from} className="py-1.5 pr-3 text-right whitespace-nowrap">
                  Weight, merges making {span(run)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {containers.map((c) => (
              <tr key={c.id} className="border-b border-slate-100" data-container={c.key}>
                <td className="py-1.5 pr-3 font-semibold text-slate-700">{c.key}</td>
                <td className="py-1.5 pr-3">
                  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {ALL_REWARD_TYPES.filter((t) => c.items?.[t] != null).map((t) => (
                      <span key={t} className="inline-flex items-center gap-0.5 whitespace-nowrap">
                        <GameArt asset={t} rank={c.items[t]} size={18} />
                        <span className="text-xs text-slate-600">R{c.items[t]}</span>
                      </span>
                    ))}
                    <span className="text-xs text-slate-500">{c.contents}</span>
                  </span>
                </td>
                <td className="py-1.5 pr-3 font-mono text-xs text-slate-600" data-field="container-syntax">
                  {c.syntax}
                </td>
                {dropping.map((run) => {
                  const weight = run.row.weights[c.id] ?? 0
                  return (
                    <td key={run.from} className={`py-1.5 pr-3 text-right whitespace-nowrap ${weight > 0 ? 'text-slate-700' : 'text-slate-300'}`}>
                      {weight} <span className="text-xs text-slate-400">({share(weight, run.row.total)})</span>
                    </td>
                  )
                })}
              </tr>
            ))}
            {anyMulti && (
            <tr className="border-b border-slate-100 bg-purple-50/50" data-container-summary="multi">
              <td className="py-1.5 pr-3 font-semibold text-purple-700" colSpan={3}>
                Drops that hold two or more items
              </td>
              {dropping.map((run) => (
                <td key={run.from} className="py-1.5 pr-3 text-right font-semibold text-purple-700 whitespace-nowrap" data-multi-share={run.from}>
                  {share(multiWeight(run), run.row.total)}
                </td>
              ))}
            </tr>
            )}
            {anyMulti && (
            <tr className="border-b border-slate-100 bg-purple-50/50" data-container-summary="triple">
              <td className="py-1.5 pr-3 font-semibold text-purple-700" colSpan={3}>
                Drops that hold three or more items
              </td>
              {dropping.map((run) => (
                <td key={run.from} className="py-1.5 pr-3 text-right font-semibold text-purple-700 whitespace-nowrap" data-triple-share={run.from}>
                  {share(weightOf(run, 3), run.row.total)}
                </td>
              ))}
            </tr>
            )}
            <tr data-container="NoDrop">
              <td className="py-1.5 pr-3 font-semibold text-slate-500">NoDrop</td>
              <td className="py-1.5 pr-3 text-xs text-slate-500" colSpan={2}>
                the merge drops nothing
              </td>
              {dropping.map((run) => (
                <td key={run.from} className="py-1.5 pr-3 text-right text-slate-500 whitespace-nowrap">
                  {run.row.noDrop} <span className="text-xs text-slate-400">({share(run.row.noDrop, run.row.total)})</span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {silent.length > 0 && (
        <p className="text-[11px] text-slate-500" data-testid={`${testid}-silent`}>
          Merges making {silent.map(span).join(', ')} drop nothing (NoDrop only).
        </p>
      )}
    </div>
  )
}
