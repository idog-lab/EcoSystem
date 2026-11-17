import { useEffect, useRef, useState } from 'react'
import { PlayCircle, RotateCcw, Lock, Gamepad2, Zap, Trophy, CheckCircle2, Package, ArrowDownToLine } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import RanksBar from './RanksBar'
import RewardProgressionChart from './RewardProgressionChart'
import { colorForRank, valueOf, MIN_RANK, MAX_RANK, RC_MAX_RANK } from '../lib/ranks'
import { gridWidthRem } from '../../../lib/gridWidth'
import {
  createPlaySession,
  canSpendGenerator,
  spendGenerator,
  unlockedGeneratorTiers,
  actionFor,
  moveItem,
  mergeItems,
  placeFromInventory,
  compareToSimulator,
  collectRewardItem,
  canSpendEnergy,
  spendEnergyForAction,
  spinTwister,
  canJumpTo,
  jumpToPhase,
} from '../lib/playSession'
import { TileContents, InventoryChip } from './PlayTile'
import { EndlessBanner, EndlessBoardBadge, EndlessGeneratorIcon } from './EndlessMode'
import { usePlayEffects } from './PlayEffects'
import { tileSurface, themeOf, BOARD_SURROUND } from '../lib/playTileSurface'
import TwisterWidget from './TwisterWidget'
import GameArt from './GameArt'
import { decodeReward, REWARD_TYPE_LABELS, REWARD_TYPES, COIN_TYPE, formatRewardAmount } from '../lib/rewardChain'

// ring-offset punches a solid white gap between the tile and the ring, so
// the highlight stays visible regardless of the tile's own rank color
// (a plain ring-2 in the same hue family as a low rank's own fill color —
// e.g. the emerald merge ring on a rank-1 emerald tile — all but disappears
// without it).
const TARGET_STYLE = {
  move: 'ring-4 ring-offset-2 ring-offset-white ring-sky-400',
  merge: 'ring-4 ring-offset-2 ring-offset-white ring-emerald-400 play-target-merge',
}

const ranksTo = (top) => Array.from({ length: top - MIN_RANK + 1 }, (_, i) => i + MIN_RANK)

export default function PlayTester({ boards, boardIndex, rcBoards }) {
  const board = boards[boardIndex]
  // Every economy setting is read off the boards themselves (main chain at
  // session creation, the RC variant's own at the transition), so the RC
  // list is the only option needed.
  const rcOptions = rcBoards && rcBoards.length ? { rcBoards } : {}
  const [session, setSession] = useState(() => createPlaySession(boards, boardIndex, rcOptions))
  // Thrown items, jumping drops and payouts - read off the session's own events.
  const fx = usePlayEffects(session)
  const [selected, setSelected] = useState(null)
  const [compared, setCompared] = useState(null)
  const [chosenTierCost, setChosenTierCost] = useState(1)
  const prevHighestUnlockedCost = useRef(1)


  const hasSubsidyTiles = board.tiles.some((row) => row.some((s) => s === 'blocked' || s === 'semi'))
  const needsGeneration = hasSubsidyTiles && board.semiPlacements.length === 0 && board.blockedQueue.length === 0
  // Recompletion boards that have tiles but nothing under them (laid out or
  // edited, and not built since): in play they open nothing and count as
  // cleared at once, which looks broken. Said before the player gets there.
  const rcBlankBoards = (rcBoards ?? [])
    .map((b, i) => ((b.tiles ?? []).some((row) => row.some((t) => t !== 'open')) && (b.semiPlacements?.length ?? 0) === 0 && (b.blockedQueue?.length ?? 0) === 0 ? i + 1 : null))
    .filter((n) => n != null)

  function reset() {
    setSession(createPlaySession(boards, boardIndex, rcOptions))
    setSelected(null)
    setCompared(null)
    setChosenTierCost(1)
    prevHighestUnlockedCost.current = 1
  }

  // Merges, lucky drops and every other moment are celebrated by
  // PlayEffects.jsx, off the session's own events.

  // playSession's actions mutate the session object they're given (see its
  // own comments) - that's fine for a single direct call, but passing a
  // function with that same mutation into setSession is not: React (Strict
  // Mode in particular) can invoke a state updater function more than once
  // per call to detect exactly this kind of impurity, which would silently
  // perform the mutation twice. Mutating once here, synchronously, and only
  // ever handing setSession an already-computed plain object sidesteps that
  // - a repeated set to an equivalent object is harmless.
  function handleSpend() {
    spendGenerator(session, activeTier)
    setSession({ ...session })
  }

  function applyAction(kind, from, to) {
    if (kind === 'move') {
      moveItem(session, from, to)
    } else if (kind === 'merge') {
      mergeItems(session, from, to)
    } else {
      return
    }
    setSession({ ...session })
  }

  function handleCellClick(r, c) {
    const { state } = session
    if (selected) {
      // Tapping an already-selected REWARD item collects it (V2 manual
      // collection - playSession's collectRewardItem). Select once to arm,
      // tap again to collect; a merge target still wins when one exists.
      if (selected[0] === r && selected[1] === c && decodeReward(state.itemAt[r][c])) {
        collectRewardItem(session, [r, c])
        setSession({ ...session })
        setSelected(null)
        return
      }
      const kind = actionFor(session, selected, [r, c])
      if (kind) {
        applyAction(kind, selected, [r, c])
        setSelected(null)
        return
      }
      // Clicking an invalid target, or the same cell again, just clears the
      // selection - re-select below if the new cell is itself movable.
      setSelected(null)
      if (state.itemAt[r][c] != null && !state.stuck[r][c]) setSelected([r, c])
      return
    }

    if (state.itemAt[r][c] != null && !state.stuck[r][c]) setSelected([r, c])
  }

  // One click drops it on a free cell (same auto-placement heuristic the
  // generator uses) - no select-then-target step, matching how the
  // generator itself already works.
  function handleInventoryClick(i) {
    placeFromInventory(session, i)
    setSession({ ...session })
  }

  // Native HTML5 drag-and-drop for moving/merging - the drag source is
  // carried in dataTransfer (authoritative for the drop itself, immune to
  // any state-update timing), while `selected` mirrors it purely to drive
  // the same target-highlighting used for click-to-select.
  function handleDragStart(e, r, c) {
    const { state } = session
    if (state.itemAt[r][c] == null || state.stuck[r][c]) return
    e.dataTransfer.setData('text/plain', `${r},${c}`)
    e.dataTransfer.effectAllowed = 'move'
    // Grab the drag image from the tile synchronously, before anything else
    // touches it. Without this, the browser takes its default snapshot on a
    // later tick, and the setSelected below (which restyles this exact node
    // with a highlight ring) sometimes lands before that snapshot - the
    // result is the intermittent broken/blank drag ghost.
    e.dataTransfer.setDragImage(e.currentTarget, e.currentTarget.offsetWidth / 2, e.currentTarget.offsetHeight / 2)
    requestAnimationFrame(() => setSelected([r, c]))
  }

  function handleDragOver(e) {
    e.preventDefault()
  }

  function handleDrop(e, r, c) {
    e.preventDefault()
    const data = e.dataTransfer.getData('text/plain')
    setSelected(null)
    if (!data) return
    const [fr, fc] = data.split(',').map(Number)
    // Dragged there already: nothing slides, the result just pops.
    fx.dragged()
    applyAction(actionFor(session, [fr, fc], [r, c]), [fr, fc], [r, c])
  }

  const maxRankReached = Object.keys(session.reachedAt).length
    ? Math.max(...Object.keys(session.reachedAt).map(Number))
    : 0
  // The player can choose any currently-unlocked tier, not just the
  // highest - if their choice re-locks (e.g. they merge away their only
  // rank-7 item), fall back to the highest tier still unlocked.
  const unlockedTiers = unlockedGeneratorTiers(session)
  const highestUnlockedCost = unlockedTiers[unlockedTiers.length - 1].cost
  const activeTier = unlockedTiers.find((t) => t.cost === chosenTierCost) ?? unlockedTiers[unlockedTiers.length - 1]

  // The moment a new tier unlocks, it becomes the default selection - the
  // player can still manually pick a different (e.g. lower) one afterward,
  // same as always, but each fresh unlock re-defaults to "use the best one
  // you've got" rather than silently staying on whatever was picked before.
  useEffect(() => {
    if (highestUnlockedCost > prevHighestUnlockedCost.current) {
      setChosenTierCost(highestUnlockedCost)
    }
    prevHighestUnlockedCost.current = highestUnlockedCost
  }, [highestUnlockedCost])

  const nextBoard = session.nextBoardIndex < session.boards.length ? session.boards[session.nextBoardIndex] : null
  // Recompletion (from rank 12) climbs to rank 14; endless mode follows it.
  const inEndless = session.phase === 'endless'
  const goalRank = session.phase === 'main' ? MAX_RANK : RC_MAX_RANK
  const theme = themeOf(session)

  // The board being PLAYED (a Recompletion board can be a different width
  // from the board the session started on).
  const cols = session.state.cols
  const widthRem = gridWidthRem(cols)

  return (
    <>
    <Card
      title="Play tester"
      subtitle="Manually play this board with the same rules the simulator uses — a ground-truth check on whether the automatic simulation actually matches how the game should feel"
      icon={Gamepad2}
      action={
        <Button variant="secondary" size="sm" icon={RotateCcw} onClick={reset}>
          Reset
        </Button>
      }
    >
      {rcBlankBoards.length > 0 && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="rc-not-built">
          Recompletion is not built: Recompletion board{rcBlankBoards.length === 1 ? "" : "s"} {rcBlankBoards.join(", ")} {rcBlankBoards.length === 1 ? "has" : "have"} tiles but no items under them, so after rank
          12 nothing will open there. Build Recompletion in Build event (step 6) and apply it (step 7), then play again.
        </p>
      )}
      {needsGeneration ? (
        <p className="text-xs text-amber-600">
          This board has blocked/semi tiles with no generated items yet — generate items in the editor first.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <EndlessBanner session={session} detailed />
          <RanksBar maxRankReached={maxRankReached} rewardRanks={board.rewardRanks} goalRank={goalRank} />

          <div className="flex flex-wrap items-start gap-6">
            <div className="flex flex-col gap-3" style={{ maxWidth: `${widthRem}rem` }}>
              <div data-theme={theme} className={`relative inline-block ${BOARD_SURROUND[theme]} rounded-3xl p-4 shadow-inner select-none transition-colors duration-700`}>
                {inEndless && <EndlessBoardBadge />}
                <div className={fx.boardFx?.kind === 'push' ? 'overflow-hidden rounded-xl' : ''}>
                <div
                  className={`grid gap-2 ${fx.boardFx ? (fx.boardFx.kind === 'push' ? 'play-board-push' : 'play-board-swap') : ''}`}
                  data-fx="board"
                  data-board-fx={fx.boardFx?.kind}
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 4.25rem))`, '--push': fx.boardFx?.fraction ?? 0 }}
                >
                  {session.state.itemAt.map((row, r) =>
                    row.map((rank, c) => {
                      const state = session.state
                      const locked = state.locked[r][c]
                      const stuck = state.stuck[r][c]
                      const movable = rank != null && !stuck
                      const isSelected = selected && selected[0] === r && selected[1] === c
                      const targetKind = selected ? actionFor(session, selected, [r, c]) : null

                      // Free items (including a semi/blocked item that's
                      // already been cleared) get a clean, plain fill.
                      // Still-stuck items get a dashed dark border plus a
                      // lock badge, so "merge into this one, but it can't
                      // move yet" reads at a glance — the badge tracks the
                      // item's CURRENT clear state, not its original tile
                      // type, since a cleared item is fully free from then
                      // on (see mergeSimulation.js's stuck comment).
                      // Drawn by PlayTile.jsx (shared with Play Stage):
                      // supplied artwork where it exists, the rank + DR badge
                      // always.
                      const surface = tileSurface({ value: rank, locked, stuck, row: r, col: c, theme })

                      // Reward items (V2 mixed queues) render as their own
                      // gold tile - type + reward rank, no DR (they carry
                      // none). Select once, tap again to collect; two of the
                      // same type+rank merge exactly like main items.
                      const reward = rank != null ? decodeReward(rank) : null
                      const cellTitle = reward
                        ? `${REWARD_TYPE_LABELS[reward.type]} reward, rank ${reward.rank} · ${stuck ? 'semi-blocked - merge a matching item into it to free it' : isSelected ? 'tap again to collect' : 'tap to select (tap twice to collect), or merge with a matching reward'}`
                        : rank
                          ? `rank ${rank} (${valueOf(rank)} DR)${stuck ? ' · stuck, merge-into only until cleared' : ''}`
                          : locked
                            ? 'locked'
                            : 'open'
                      return (
                        <button
                          key={`${r}-${c}`}
                          type="button"
                              data-cell={`${r}-${c}`}
                          data-movable={movable}
                          draggable={movable}
                          onDragStart={(e) => handleDragStart(e, r, c)}
                          onDragOver={handleDragOver}
                          onDrop={(e) => handleDrop(e, r, c)}
                          onDragEnd={() => setSelected(null)}
                          onClick={() => handleCellClick(r, c)}
                          title={cellTitle}
                          aria-label={cellTitle}
                          className={`relative aspect-square rounded-xl text-white flex flex-col items-center justify-center leading-tight transition-colors shadow-[inset_0_2px_0_rgba(255,255,255,0.35)] ${
                            movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                          } ${surface.className} ${
                            isSelected ? 'ring-4 ring-offset-2 ring-offset-white ring-purple-500' : ''
                          } ${targetKind ? TARGET_STYLE[targetKind] : ''}`}
                          style={surface.style}
                        >
                          <TileContents value={rank} stuck={stuck} showDr selected={isSelected} arriving={fx.arriving.has(`${r}-${c}`)} pop={fx.popping.get(`${r}-${c}`) ?? null} theme={theme} />
                        </button>
                      )
                    }),
                  )}
                </div>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                <span className="flex items-center gap-1.5">
                  <Lock size={11} className="text-slate-500" />
                  Stuck — merge-into only until cleared, then fully free
                </span>
                <span className="text-slate-400">· drag (or click, then click a target) to move or merge a free item</span>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <ArrowDownToLine size={12} className="text-slate-400 shrink-0" />
                {nextBoard ? (
                  <span>
                    Next wave: <span className="font-medium text-slate-700">{nextBoard.name}</span> pushes in (
                    {Math.min(nextBoard.rows, 3)} row{Math.min(nextBoard.rows, 3) === 1 ? '' : 's'}) once this board's
                    blocked/semi tiles fully clear.
                  </span>
                ) : (
                  <span>{inEndless ? 'Endless mode — the board stays as it is, and play never ends.' : "No more boards queued — this board won't get any new waves."}</span>
                )}
              </div>

              <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-2.5">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 px-1">
                  <Package size={12} strokeWidth={2.5} /> Inventory
                </span>
                {session.inventory.length === 0 ? (
                  <p className="text-xs text-slate-400 px-1">
                    Empty — items pushed off the bottom when a new board comes in land here, ready to place back on
                    a free cell.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 px-1">
                    {session.inventory.map((rank, i) => (
                      <InventoryChip key={i} value={rank} showDr theme={theme} onClick={() => handleInventoryClick(i)} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-4 flex-1 min-w-64">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-3">
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                    <Zap size={12} strokeWidth={2.5} /> DR spent
                  </span>
                  <span className="font-display text-2xl font-bold tabular-nums text-amber-700">{session.drSpent}</span>
                </div>
                <div className="flex flex-col gap-1 rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 to-fuchsia-50 p-3">
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-purple-700">
                    <Trophy size={12} strokeWidth={2.5} /> Highest rank
                  </span>
                  <span className="font-display text-2xl font-bold tabular-nums text-purple-700">{maxRankReached || '—'}</span>
                </div>
              </div>

              {/* Test shortcuts: skip the climb and land in a later phase. */}
              {rcBoards && rcBoards.length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-2xl border border-slate-200 bg-slate-50/70 p-2.5" data-testid="phase-jump">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 px-1">Jump ahead (test shortcut)</span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={RotateCcw}
                      disabled={!canJumpTo(session, 'rc')}
                      onClick={() => {
                        jumpToPhase(session, 'rc')
                        setSelected(null)
                        setSession({ ...session })
                      }}
                      data-testid="jump-rc"
                    >
                      To Recompletion
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={EndlessGeneratorIcon}
                      disabled={!canJumpTo(session, 'endless')}
                      onClick={() => {
                        jumpToPhase(session, 'endless')
                        setSelected(null)
                        setSession({ ...session })
                      }}
                      data-testid="jump-endless"
                    >
                      To endless mode
                    </Button>
                  </div>
                  <p className="text-[11px] text-slate-500 px-1" data-testid="jump-note">
                    {session.jumped
                      ? 'You jumped ahead to a clean start of the phase. Everything from here on plays for real, but DR spent and the rank table are not a real run. Reset to start over.'
                      : 'Recompletion: a fresh Recompletion board with just a rank 12. Endless: a clean, all-open board with just a rank 14. Nothing else comes along (reaching the phase by playing does carry your board over).'}
                  </p>
                </div>
              )}

              {session.phase === 'rc' && (
                <div className="flex items-center gap-2 rounded-xl border border-purple-300 bg-purple-50 px-3 py-2 text-xs font-semibold text-purple-700">
                  <RotateCcw size={14} /> RC phase active
                </div>
              )}

              <div className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-slate-50/70 p-2.5">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 px-1">
                  <Trophy size={12} strokeWidth={2.5} /> Rank progress
                </span>
                <div className="grid grid-cols-[1fr_4rem_4rem] gap-x-2 gap-y-1 items-center text-xs px-1">
                  <div className="contents text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    <span />
                    <span className="text-right">DR</span>
                    <span className="text-right">+DR</span>
                  </div>
                  {ranksTo(goalRank).map((rank) => {
                    const dr = session.reachedAt[rank]
                    // Same cumulative-then-delta shape as SimulationReport's
                    // own rank table — DR is spend-to-here since the start of
                    // this play session, +DR is just the cost of climbing
                    // from the previous rank to this one.
                    const prevDr = session.reachedAt[rank - 1] ?? 0
                    const drDelta = dr != null ? dr - prevDr : null
                    return (
                      <div key={rank} className="contents">
                        <span className="flex items-center gap-1.5 text-slate-600">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colorForRank(rank) }} />
                          Rank {rank}
                        </span>
                        <span className="text-right tabular-nums font-medium text-slate-500">{dr ?? '—'}</span>
                        <span className="text-right tabular-nums text-slate-400">{drDelta != null ? `+${drDelta}` : ''}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-slate-50/70 p-2.5">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 px-1">
                  <Zap size={12} strokeWidth={2.5} /> Generator tiers
                </span>
                {session.tiers.map((t) => {
                  const unlocked = unlockedTiers.some((u) => u.cost === t.cost)
                  const chosen = activeTier.cost === t.cost
                  return (
                    <button
                      key={t.cost}
                      type="button"
                      disabled={!unlocked}
                      onClick={() => setChosenTierCost(t.cost)}
                      title={unlocked ? `Use the x${t.cost} generator` : `Unlocks once you hold a rank-${t.unlocksAt} item`}
                      className={`flex items-center justify-between text-xs rounded-lg px-2 py-1.5 text-left transition-colors ${
                        chosen
                          ? 'bg-gradient-to-r from-purple-100 to-fuchsia-100 text-purple-800 font-semibold ring-1 ring-purple-300'
                          : unlocked
                            ? 'text-slate-600 hover:bg-slate-100 cursor-pointer'
                            : 'text-slate-400 cursor-not-allowed'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {chosen ? (
                          <CheckCircle2 size={13} className="text-purple-600 shrink-0" />
                        ) : unlocked ? (
                          <span className="w-3.5 shrink-0" />
                        ) : (
                          <Lock size={11} className="shrink-0" />
                        )}
                        x{t.cost} · {t.cost} DR → rank {t.normalRank}
                      </span>
                      <span className={chosen ? 'text-purple-600' : 'text-slate-400'}>
                        {chosen ? 'selected' : unlocked ? 'tap to use' : `unlocks at rank ${t.unlocksAt}`}
                      </span>
                    </button>
                  )
                })}
              </div>

              <Button variant="primary" icon={inEndless ? EndlessGeneratorIcon : PlayCircle} onClick={handleSpend} disabled={!canSpendGenerator(session)} data-fx="generator">
                Spend generator ({activeTier.cost} DR → rank {activeTier.normalRank})
              </Button>

              {/* V2: collected merge energy funds free x1 generator actions
                  (one energy = one tap, always x1) - playSession's
                  spendEnergyForAction. Only rendered once any energy has
                  ever been collected, so pre-V2 boards see no new UI. */}
              {(session.energyBalance >= 1 || session.events.some((e) => e.type === 'collect')) && (
                <Button
                  variant="secondary"
                  icon={Zap}
                  onClick={() => {
                    spendEnergyForAction(session)
                    setSession({ ...session })
                  }}
                  disabled={!canSpendEnergy(session)}
                >
                  Use 1 energy (free ×1 tap) — {Math.floor(session.energyBalance)} held
                </Button>
              )}

              <TwisterWidget
                session={session}
                onSpin={() => {
                  spinTwister(session)
                  setSession({ ...session })
                }}
              />

              {/* V2 collected balances - every resource that's been credited
                  this session (tile collects + merge drops). */}
              {session.events.some((e) => e.type === 'collect') && (
                <div className="grid grid-cols-4 gap-2 text-center">
                  {REWARD_TYPES.map((t) => (
                    <div key={t} className="rounded-xl border border-amber-200 bg-amber-50/70 px-1 py-1.5">
                      <GameArt asset={t} rank={1} size={22} className="mx-auto" />
                      <div className="text-[9px] font-semibold uppercase tracking-wide text-amber-700" title={t === COIN_TYPE ? 'Coins are counted in allowances, not coins' : undefined}>
                        {t === COIN_TYPE ? 'Coin allow.' : REWARD_TYPE_LABELS[t].split(' ')[0]}
                      </div>
                      <div className="font-display text-sm font-bold tabular-nums text-amber-800">
                        {formatRewardAmount(t, session.collected[t])}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* The automatic simulator stops at rank 14, so there is nothing
                  to compare an endless session against. */}
              {!inEndless && !session.jumped && (
                <Button variant="secondary" onClick={() => setCompared(compareToSimulator(session))}>
                  Compare to automatic simulator at {session.drSpent} DR
                </Button>
              )}
              {compared && (
                <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col gap-1">
                  <span className="font-semibold text-slate-700">Simulator's reachedAt at this DR spend:</span>
                  {Object.keys(compared.reachedAt).length === 0 ? (
                    <span className="text-slate-400">nothing reached yet</span>
                  ) : (
                    Object.entries(compared.reachedAt)
                      .sort((a, b) => Number(a[0]) - Number(b[0]))
                      .map(([rank, dr]) => (
                        <span key={rank}>
                          rank {rank} at {dr} DR{session.reachedAt[rank] !== undefined ? ` (you: ${session.reachedAt[rank]} DR)` : ' (you: not yet)'}
                        </span>
                      ))
                  )}
                </div>
              )}

              <div className="flex flex-col gap-1 text-[11px] font-mono text-slate-500 max-h-72 overflow-y-auto bg-slate-50/70 border border-slate-100 rounded-xl p-2.5">
                {session.events
                  .slice()
                  .reverse()
                  .map((e, i) => <EventLine key={i} event={e} />)}
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
    {!needsGeneration && <RewardProgressionChart events={session.events} />}
    {fx.layer}
    </>
  )
}

// An item as words: "rank 7" for the main chain, "Coins R2" for a reward.
function itemName(value) {
  const reward = decodeReward(value)
  return reward ? `${REWARD_TYPE_LABELS[reward.type]} R${reward.rank}` : `rank ${value}`
}

function EventLine({ event }) {
  const dr = `[${event.drSpent} DR]`
  if (event.type === 'initial') return <span>{dr} starts with {itemName(event.rank)} at {fmt(event.cell)}</span>
  if (event.type === 'merge-drop')
    return (
      <span className="text-teal-700">
        {dr} drop: {REWARD_TYPE_LABELS[event.rewardType]} R{event.rank}{' '}
        {event.collected ? 'collected on the spot' : event.toInventory ? 'sent to the inventory (board full)' : `landed at ${fmt(event.cell)}`}
      </span>
    )
  if (event.type === 'collect')
    return (
      <span className="text-emerald-700">
        {dr} collected {REWARD_TYPE_LABELS[event.rewardType]} R{event.rank}: +{event.amount.toLocaleString()}
      </span>
    )
  if (event.type === 'twister-spin')
    return (
      <span className="font-medium text-teal-700">
        {dr} Twister spin #{event.spinsUsed}: −{event.cost} Twister DR (balance {event.balance})
      </span>
    )
  if (event.type === 'spend')
    return (
      <span className={event.bonus > 0 ? 'font-semibold text-amber-600' : undefined}>
        {dr} {event.bonus > 0 ? `✨ lucky +${event.bonus}! ` : ''}spent {event.tier} DR → rank {event.rank} at {fmt(event.cell)}
      </span>
    )
  if (event.type === 'moved') return <span>{dr} moved {fmt(event.from)} → {fmt(event.to)}</span>
  if (event.type === 'merge')
    return (
      <span>
        {dr} merged {itemName(event.rank)} → {event.newRank == null ? 'top rank, collected' : itemName(event.newRank)} at {fmt(event.into)}
      </span>
    )
  if (event.type === 'reveal') return <span>{dr} revealed {itemName(event.rank)} at {fmt(event.cell)}</span>
  if (event.type === 'inventory-place') return <span>{dr} placed {itemName(event.rank)} from inventory at {fmt(event.cell)}</span>
  if (event.type === 'board-push')
    return (
      <span className="font-medium text-slate-700">
        {dr} {event.name} pushed in ({event.rows} row{event.rows === 1 ? '' : 's'})
        {event.overflow.length > 0 && ` — ${event.overflow.length} item${event.overflow.length === 1 ? '' : 's'} sent to inventory`}
      </span>
    )
  if (event.type === 'jump') return <span className="font-semibold text-slate-700">{dr} --- jumped ahead to {event.to === 'rc' ? 'Recompletion' : 'endless mode'} (test shortcut) ---</span>
  if (event.type === 'rc-entered') return <span className="font-semibold text-purple-700">{dr} *** Recompletion started — everything on the board came along ***</span>
  if (event.type === 'endless-entered')
    return (
      <span className="font-semibold text-fuchsia-700">
        {dr} *** Endless mode started — {event.hasDrops ? `merges that make rank ${event.dropStartRank} or higher now drop` : 'no endless drops on this stage'} ***
      </span>
    )
  if (event.type === 'reached')
    return (
      <span className={event.rank === MAX_RANK ? 'font-semibold text-amber-600' : 'font-medium text-slate-700'}>
        {dr} *** reached rank {event.rank} ***
      </span>
    )
  return null
}

function fmt(cell) {
  return `(${cell[0]},${cell[1]})`
}
