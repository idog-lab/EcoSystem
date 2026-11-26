import { useMemo, useState } from 'react'
import { useEconomy } from '../../../../lib/economy/economyStore'
import PrizeBuilder from '../../../../components/PrizeBuilder'
import { boardIsBuilt } from '../../lib/build/eventBuild'
import { effortOfEvent, ladderRanks, milestoneTexts, phaseOfRank, prizeAgainstWorth, rankWorths, segmentLadder, segmentMultiplier } from '../../lib/build/prizeLadder'

// STEP 5, PRIZES (economist, 26 Nov 2026: "the simulator should calculate the allowance worth of each rank in the
// prizes ladder. we should pick the base segments that opon it we calculate all of those. and then the item ladder is
// created from the base on the others"; "the app should show the allowance worth of the rank, then i put prizes inside
// and the app calculates live how far i am from the prize that is suppos to be"). The base segment's boards in use are
// played once, as step 4's effort chart plays them; a marked rank is worth the DR paid since the marked rank before
// it, times the worth of one merge DR typed in step 1. Another segment's worth is the base's times its multiplier
// against the base, and its prize is the base's prize scaled the same way unless one is typed for it.

const fmt = (v) => (v == null ? '-' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }))
const LinkButton = ({ onClick, children }) => (
  <button type="button" onClick={onClick} className="font-semibold text-purple-700 underline decoration-dotted underline-offset-2 hover:text-purple-900">
    {children}
  </button>
)

// How far a prize is from its worth. The colours are this app's own reading, not a pass mark.
function Gap({ result }) {
  if (!result) return <span className="text-slate-300">-</span>
  if (result.worth == null) {
    return (
      <span className="text-amber-700" title={result.unknown?.length ? `No worth for: ${result.unknown.join(', ')}` : 'A part of this prize has no worth on the Economy page'}>
        worth unknown{result.unknown?.length ? `: ${result.unknown.slice(0, 2).join(', ')}` : ''}
      </span>
    )
  }
  if (result.gap == null) return <span className="text-slate-300">-</span>
  const pct = Math.abs(result.gapPct ?? 0)
  const tone = pct <= 5 ? 'text-emerald-700' : pct <= 15 ? 'text-amber-700' : 'text-rose-700'
  return (
    <span className={`font-semibold tabular-nums ${tone}`} title="Green within 5% of the worth, amber within 15%, red beyond - this app's own reading, not a rule" data-cell="gap">
      {result.gap > 0 ? '+' : ''}
      {fmt(result.gap)}
      {result.gapPct != null ? ` (${result.gapPct > 0 ? '+' : ''}${result.gapPct}%)` : ''}
    </span>
  )
}

export default function PrizesStep({ segments, shownSegments, goTo }) {
  const economy = useEconomy()
  // The rank whose prize builder is open (one at a time).
  const [building, setBuilding] = useState(null)
  const shown = shownSegments?.length ? shownSegments : segments.map((_, i) => i)
  const event = segments[0]
  const baseIndex = Math.min(Math.max(0, event.prizeBase ?? 0), segments.length - 1)
  const base = segments[baseIndex]
  const drWorth = event.drWorth
  const [picked, setPicked] = useState(baseIndex)
  const index = shown.includes(picked) ? picked : baseIndex
  const seg = segments[index]
  const isBase = index === baseIndex

  const mainBoards = base.main.boards
  const rcBoards = base.recompletion.boards
  const mainBuilt = mainBoards.length > 0 && mainBoards.every(boardIsBuilt)
  const rcBuilt = rcBoards.length > 0 && rcBoards.every(boardIsBuilt)
  const ranks = ladderRanks(event.main.boards, event.recompletion.boards)
  const playedKey = JSON.stringify([mainBoards.map((b) => b.buildStamp ?? b.blockedQueue?.length), rcBuilt && rcBoards.map((b) => b.buildStamp ?? b.blockedQueue?.length), baseIndex])
  const reachedAt = useMemo(
    () => (mainBuilt ? effortOfEvent(mainBoards, rcBuilt ? rcBoards : null) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playedKey, mainBuilt, rcBuilt],
  )
  const worths = rankWorths(reachedAt, ranks, drWorth)
  const ratio = segmentMultiplier(seg, index) / segmentMultiplier(base, baseIndex)
  const ladder = segmentLadder(segments, index, baseIndex, ranks)
  const starting = milestoneTexts(event.main.boards, event.recompletion.boards)
  const date = event.eventStartDate ?? null
  const baseLadderEmpty = ranks.every((r) => !String(base.prizeLadder?.[phaseOfRank(r)]?.[r] ?? '').trim())

  const setPrize = (rank, text) =>
    seg.setPrizeLadder((prev) => {
      const phase = phaseOfRank(rank)
      const rows = { ...(prev?.[phase] ?? {}) }
      if (String(text).trim()) rows[rank] = text
      else delete rows[rank]
      return { ...(prev ?? {}), [phase]: rows }
    })
  const startFromMilestones = () =>
    base.setPrizeLadder((prev) => {
      const next = { main: { ...(prev?.main ?? {}) }, rc: { ...(prev?.rc ?? {}) } }
      for (const [rank, text] of Object.entries(starting)) next[phaseOfRank(Number(rank))][rank] = text
      return next
    })

  const name = (i) => segments[i].name || `Segment ${i + 1}`

  return (
    <div className="flex flex-col gap-4" data-testid="prizes-step">
      <div className="rounded-3xl border border-white bg-white/85 px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold text-slate-800">Prizes of the marked ranks</h2>
          <span className="text-xs text-slate-500" data-testid="prizes-basis">
            Worked out on <b>{name(baseIndex)}</b> · one merge DR = <b>{drWorth == null ? 'not set' : fmt(drWorth)}</b> allowance
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500" data-note>
          A rank is worth the DR its player paid since the marked rank before it, times the worth of one merge DR. That effort is read from one playthrough of {name(baseIndex)}&apos;s
          boards in use (the same as step 4&apos;s effort chart). Every other segment&apos;s worth is the base&apos;s times its multiplier against the base; so is its prize, unless one is typed for it.
        </p>

        {drWorth == null && (
          <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="prizes-no-dr-worth">
            The worth of one merge DR is not set yet, so no rank has a worth. <LinkButton onClick={() => goTo('setup')}>Type it in step 1</LinkButton>
          </p>
        )}
        {!ranks.length && (
          <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="prizes-no-ranks">
            No rank is marked for a prize. Mark them under &ldquo;Milestone rewards&rdquo; in step 3 (ranks 13 and 14 in its Recompletion phase).{' '}
            <LinkButton onClick={() => goTo('rewards', 'rewards-milestones-main')}>Go to step 3</LinkButton>
          </p>
        )}
        {!mainBuilt && (
          <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="prizes-not-built">
            {name(baseIndex)} is not built yet, so nothing can be played. <LinkButton onClick={() => goTo('build')}>Build it in step 4</LinkButton>
          </p>
        )}
        {mainBuilt && !rcBuilt && ranks.some((r) => r > 12) && (
          <p className="mt-3 text-xs text-amber-800" data-testid="prizes-rc-not-built">
            Recompletion is not built for {name(baseIndex)}, so ranks 13 and 14 have no worth yet.
          </p>
        )}
      </div>

      {ranks.length > 0 && (
        <div className="rounded-3xl border border-white bg-white/85 px-5 py-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Segment" data-testid="prizes-segments">
            {shown.map((i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === index}
                onClick={() => setPicked(i)}
                data-prize-segment={i}
                className={`rounded-xl px-3 py-1 text-sm font-semibold ${i === index ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {name(i)}
                {i === baseIndex ? <span className="ml-1 text-[10px] font-semibold uppercase opacity-70">base</span> : <span className="ml-1 text-[11px] opacity-70">×{fmt(segmentMultiplier(segments[i], i))}</span>}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500" data-note data-testid="prizes-segment-note">
            {isBase
              ? 'The base: the prizes typed here are what every other segment starts from.'
              : `${name(index)} is ×${fmt(ratio)} of ${name(baseIndex)}: its worths are the base's times ${fmt(ratio)}, and so are its prizes until you type one of its own.`}
          </p>
          {isBase && baseLadderEmpty && Object.keys(starting).length > 0 && (
            <p className="mt-2 text-xs text-slate-600">
              Step 3 has milestone rewards typed for these ranks.{' '}
              <LinkButton onClick={startFromMilestones}>Start from them</LinkButton>
            </p>
          )}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm" data-testid="prizes-table" data-dense>
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3">Rank</th>
                  <th className="py-2 pr-3" title="The DR the player paid since the marked rank before it (or since the start)">DR paid</th>
                  <th className="py-2 pr-3" title="What the prize should be worth, in allowance: the DR paid times the worth of one merge DR (times the multiplier against the base, for another segment)">Worth</th>
                  <th className="py-2 pr-3">Prize</th>
                  <th className="py-2 pr-3" title="What the prize is worth by the Economy page, on the event's first day">Prize worth</th>
                  <th className="py-2 pr-3" title="The prize's worth minus what it should be worth">Difference</th>
                </tr>
              </thead>
              <tbody>
                {worths.map((row) => {
                  const target = row.worth == null ? null : Math.round(row.worth * ratio * 100) / 100
                  const entry = ladder[row.rank]
                  const text = entry?.text ?? ''
                  const result = prizeAgainstWorth(text, target, economy, { date })
                  const firstIssue = result?.issues?.find((x) => x.level === 'error') ?? null
                  return (
                    <tr key={row.rank} className="border-t border-slate-100 align-top" data-prize-rank={row.rank}>
                      <td className="py-1.5 pr-3 font-semibold text-slate-700 whitespace-nowrap">
                        {row.rank}
                        {row.rank > 12 && <span className="ml-1 text-[10px] font-semibold uppercase text-slate-400">RC</span>}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums text-slate-600 whitespace-nowrap" data-cell="dr">
                        {row.dr == null ? <span className="text-slate-400">not reached</span> : fmt(row.dr)}
                        {row.dr != null && <div className="text-[10.5px] text-slate-400">{row.since ? `since rank ${row.since}` : 'from the start'}</div>}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums font-semibold text-slate-800" data-cell="worth">
                        {fmt(target)}
                      </td>
                      <td className="py-1.5 pr-3 min-w-[18rem]">
                        <div className="flex items-start gap-1.5">
                        <input
                          className={`w-full rounded-xl border px-2.5 py-1.5 font-mono text-sm ${entry && !entry.own ? 'border-dashed border-slate-300 bg-slate-50 text-slate-500' : 'border-slate-200 bg-white'}`}
                          placeholder={isBase ? (starting[row.rank] ?? 'type the prize, e.g. allowance(coins:5)') : 'type a prize for this segment'}
                          value={text}
                          onChange={(e) => setPrize(row.rank, e.target.value)}
                          aria-label={`Prize at rank ${row.rank} for ${name(index)}`}
                          data-prize-input={row.rank}
                        />
                        <button
                          type="button"
                          onClick={() => setBuilding((r) => (r === row.rank ? null : row.rank))}
                          aria-expanded={building === row.rank}
                          className={`shrink-0 rounded-xl px-2.5 py-1.5 text-xs font-semibold ring-1 ${building === row.rank ? 'bg-purple-600 text-white ring-purple-600' : 'bg-white text-slate-700 ring-slate-200 hover:text-purple-700'}`}
                          title="Pick the prize's parts - coins, resources, presets, a sticker pack, currencies, a chest - and the text is written for you"
                          data-prize-build={row.rank}
                        >
                          {building === row.rank ? 'Done' : 'Build'}
                        </button>
                        </div>
                        {building === row.rank && <div className="mt-1.5"><PrizeBuilder value={text} onChange={(t) => setPrize(row.rank, t)} economy={economy} testid={`rank-${row.rank}`} /></div>}
                        {entry && !entry.own && (
                          <div className="mt-0.5 text-[10.5px] text-slate-400" data-from-base>
                            from the base ×{fmt(ratio)} - type to change it
                          </div>
                        )}
                        {entry?.own && !isBase && (
                          <button type="button" onClick={() => setPrize(row.rank, '')} className="mt-0.5 text-[10.5px] font-semibold text-purple-700 hover:underline" data-reset-to-base>
                            Typed for this segment - back to the base&apos;s
                          </button>
                        )}
                        {firstIssue && <div className="mt-0.5 text-[11px] text-rose-700" data-prize-issue>{firstIssue.message}</div>}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums text-slate-700" data-cell="prize-worth">
                        {result?.worth == null ? '-' : fmt(result.worth)}
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        <Gap result={result} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-400" data-note>
            The prizes go to the Item Ladder sheet of each segment (Syntax tab). Pick the base segment and the multipliers in step 1. One playthrough with average drops, the same
            every time - a player&apos;s own luck moves the DR paid.
          </p>
        </div>
      )}
    </div>
  )
}
