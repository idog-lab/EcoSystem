import { useEffect, useRef, useState } from 'react'
import { RotateCcw, Lock, Zap, Trophy, Package, ArrowDownToLine, PartyPopper, HelpCircle } from 'lucide-react'
import Button from '../../../components/ui/Button'
import RanksBar from './RanksBar'
import PlayTutorialCoach from './PlayTutorialCoach'
import { MAX_RANK, RC_MAX_RANK } from '../lib/ranks'
import { gridWidthRem } from '../../../lib/gridWidth'
import { hasSeenPlayTutorial, markPlayTutorialSeen, computeTutorialSpec, boardHasLockedCell } from '../lib/playTutorial'
import {
  createPlaySession,
  canSpendGenerator,
  spendGenerator,
  unlockedGeneratorTiers,
  actionFor,
  moveItem,
  mergeItems,
  placeFromInventory,
  collectRewardItem,
  canSpendEnergy,
  spendEnergyForAction,
  spinTwister,
} from '../lib/playSession'
import { TileContents, InventoryChip } from './PlayTile'
import { EndlessBanner, EndlessBoardBadge, EndlessGeneratorIcon } from './EndlessMode'
import { usePlayEffects } from './PlayEffects'
import { tileSurface, themeOf, BOARD_SURROUND } from '../lib/playTileSurface'
import TwisterWidget from './TwisterWidget'
import GameArt from './GameArt'
import { decodeReward, REWARD_TYPE_LABELS, REWARD_TYPES, COIN_TYPE, formatRewardAmount } from '../lib/rewardChain'

const TARGET_STYLE = {
  move: 'ring-4 ring-offset-2 ring-offset-white ring-sky-400',
  merge: 'ring-4 ring-offset-2 ring-offset-white ring-emerald-400 play-target-merge',
}

// The player-facing counterpart to PlayTester - same session engine
// (playSession.js), same board-chaining/lucky-drop/tier mechanics, but with
// every economist-only tool stripped out (no compare-to-simulator, no raw
// event log) and a bit more game dressing (a completion banner at
// MAX_RANK). Always starts at boards[0] - a shared stage is the whole
// sequence, not a single board a player picks.
export default function PlayStage({ boards, stageName, rcBoards, rcVariantLabel = null }) {
  // The session reads every economy setting off the boards themselves - the
  // main chain's from boards[0] at creation, the RC variant's from
  // rcBoards[0] at the gated transition (see playSession.js) - so passing
  // the RC list is all a shared stage needs.
  const rcOptions = rcBoards && rcBoards.length ? { rcBoards } : {}
  const [session, setSession] = useState(() => createPlaySession(boards, 0, rcOptions))
  // Thrown items, jumping drops and payouts - read off the session's own events.
  const fx = usePlayEffects(session)
  const [selected, setSelected] = useState(null)
  const [chosenTierCost, setChosenTierCost] = useState(1)
  // 'generate' | 'merge' | 'blocked' | null - see playTutorial.js. Starts
  // null and only turns on after mount (not in useState's initializer) so a
  // returning player's very first render never flashes the overlay before
  // the "already seen it" check has a chance to run.
  const [tutorialStep, setTutorialStep] = useState(null)
  const prevHighestUnlockedCost = useRef(1)

  useEffect(() => {
    if (!hasSeenPlayTutorial()) setTutorialStep('generate')
  }, [])

  function finishTutorial() {
    setTutorialStep(null)
    markPlayTutorialSeen()
  }

  function reset() {
    setSession(createPlaySession(boards, 0, rcOptions))
    setSelected(null)
    setChosenTierCost(1)
    prevHighestUnlockedCost.current = 1
  }

  // Merges, lucky drops and every other moment are celebrated by
  // PlayEffects.jsx, off the session's own events.

  // See PlayTester's identical comment - session mutations happen once here,
  // synchronously, never inside the setSession updater itself.
  function handleSpend() {
    spendGenerator(session, activeTier)
    setSession({ ...session })
    if (tutorialStep === 'generate') setTutorialStep('merge')
  }

  function applyAction(kind, from, to) {
    if (kind === 'move') {
      moveItem(session, from, to)
    } else if (kind === 'merge') {
      const before = session.events.length
      mergeItems(session, from, to)
      const mergeEvent = session.events.slice(before).find((e) => e.type === 'merge')
      if (mergeEvent && tutorialStep === 'merge') {
        if (boardHasLockedCell(session.state)) setTutorialStep('blocked')
        else finishTutorial()
      }
    } else {
      return
    }
    setSession({ ...session })
  }

  function handleCellClick(r, c) {
    const { state } = session
    if (selected) {
      // Tap a selected reward item again to collect it (V2) - same
      // select-then-confirm gesture PlayTester uses.
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
      setSelected(null)
      if (state.itemAt[r][c] != null && !state.stuck[r][c]) setSelected([r, c])
      return
    }
    if (state.itemAt[r][c] != null && !state.stuck[r][c]) setSelected([r, c])
  }

  function handleInventoryClick(i) {
    placeFromInventory(session, i)
    setSession({ ...session })
  }

  function handleDragStart(e, r, c) {
    const { state } = session
    if (state.itemAt[r][c] == null || state.stuck[r][c]) return
    e.dataTransfer.setData('text/plain', `${r},${c}`)
    e.dataTransfer.effectAllowed = 'move'
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
  const unlockedTiers = unlockedGeneratorTiers(session)
  const highestUnlockedCost = unlockedTiers[unlockedTiers.length - 1].cost
  const activeTier = unlockedTiers.find((t) => t.cost === chosenTierCost) ?? unlockedTiers[unlockedTiers.length - 1]

  useEffect(() => {
    if (highestUnlockedCost > prevHighestUnlockedCost.current) {
      setChosenTierCost(highestUnlockedCost)
    }
    prevHighestUnlockedCost.current = highestUnlockedCost
  }, [highestUnlockedCost])

  const board = session.boards[session.boardIndex]
  const nextBoard = session.nextBoardIndex < session.boards.length ? session.boards[session.nextBoardIndex] : null
  // With a Recompletion list attached, reaching rank 12 starts the
  // Recompletion round at once (playSession.js), and rank 14 starts endless mode.
  const hasRc = !!(rcBoards && rcBoards.length)
  const inRc = session.phase === 'rc'
  // Rank 14 does not end the stage: it starts endless mode (lib/endlessMode.js),
  // which has its own banner and its own look. A stage with no Recompletion
  // list still finishes at rank 12.
  const inEndless = session.phase === 'endless'
  const theme = themeOf(session)
  const finished = !hasRc && maxRankReached >= MAX_RANK

  const tutorialSpec = tutorialStep ? computeTutorialSpec(tutorialStep, session.state) : null
  // A step can end up with nothing left to point at (e.g. the board's only
  // locked cell got cleared by the very merge that advanced into 'blocked')
  // - finish from an effect, never mid-render, so this never fights React's
  // own render/commit cycle.
  useEffect(() => {
    if (tutorialStep && !tutorialSpec) finishTutorial()
  }, [tutorialStep, tutorialSpec])

  const cols = session.state.cols
  const widthRem = gridWidthRem(cols)

  return (
    <div className="flex flex-col gap-5 play-compact-gap w-full max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold text-slate-900 leading-tight tracking-tight truncate">{stageName ?? 'Merge Mania'}</h1>
          <p className="text-xs text-slate-400 play-hide-compact">Merge matching items, spend the generator, and climb the chain</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="secondary" size="sm" icon={HelpCircle} onClick={() => setTutorialStep('generate')}>
            How to play
          </Button>
          <Button variant="secondary" size="sm" icon={RotateCcw} onClick={reset}>
            Restart
          </Button>
        </div>
      </div>

      {finished && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3 text-amber-700">
          <PartyPopper size={18} className="shrink-0" />
          <span className="text-sm font-semibold">
            You reached rank {MAX_RANK} — the chain is complete!
          </span>
        </div>
      )}
      <EndlessBanner session={session} />
      {inRc && (
        <div data-testid="rc-active" className="flex items-center gap-2.5 rounded-2xl border border-purple-200 bg-purple-50 px-4 py-3 text-purple-700">
          <RotateCcw size={18} className="shrink-0" />
          <span className="text-sm font-semibold">
            Recompletion round{rcVariantLabel ? ` (${rcVariantLabel})` : ''} — climb to rank {RC_MAX_RANK}. Highest so far: {maxRankReached}.
          </span>
        </div>
      )}

      <RanksBar maxRankReached={maxRankReached} rewardRanks={board.rewardRanks} goalRank={inRc || inEndless ? RC_MAX_RANK : MAX_RANK} />

      <div className="flex flex-col landscape:flex-row sm:flex-row items-start gap-4 landscape:gap-4 sm:gap-6 w-full">
        <div className="flex flex-col gap-3 w-full" style={{ maxWidth: `${widthRem}rem` }}>
          <div data-theme={theme} className={`relative ${BOARD_SURROUND[theme]} rounded-3xl p-3 sm:p-4 shadow-inner select-none transition-colors duration-700`}>
            {inEndless && <EndlessBoardBadge />}
            <div className={fx.boardFx?.kind === 'push' ? 'overflow-hidden rounded-xl' : ''}>
            <div
              className={`grid gap-1.5 sm:gap-2 ${fx.boardFx ? (fx.boardFx.kind === 'push' ? 'play-board-push' : 'play-board-swap') : ''}`}
              data-fx="board"
              data-board-fx={fx.boardFx?.kind}
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, '--push': fx.boardFx?.fraction ?? 0 }}
            >
              {session.state.itemAt.map((row, r) =>
                row.map((rank, c) => {
                  const state = session.state
                  const locked = state.locked[r][c]
                  const stuck = state.stuck[r][c]
                  const movable = rank != null && !stuck
                  const isSelected = selected && selected[0] === r && selected[1] === c
                  const targetKind = selected ? actionFor(session, selected, [r, c]) : null

                  // Surface + contents come from PlayTile.jsx (shared with
                  // the Play Tester): supplied artwork where it exists, the
                  // rank badge always.
                  const surface = tileSurface({ value: rank, locked, stuck, row: r, col: c, theme })
                  const cellTitle = decodeReward(rank)
                    ? `${REWARD_TYPE_LABELS[decodeReward(rank).type]} reward R${decodeReward(rank).rank}${stuck ? ' · semi-blocked - merge a matching item into it to free it' : isSelected ? ' · tap again to collect' : ' · tap twice to collect, or merge with a match'}`
                    : rank
                      ? `rank ${rank}${stuck ? ' · locked, merge-into only until cleared' : ''}`
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
                      } ${surface.className} ${isSelected ? 'ring-4 ring-offset-2 ring-offset-white ring-purple-500' : ''} ${
                        targetKind ? TARGET_STYLE[targetKind] : ''
                      }`}
                      style={surface.style}
                    >
                      <TileContents value={rank} stuck={stuck} selected={isSelected} arriving={fx.arriving.has(`${r}-${c}`)} pop={fx.popping.get(`${r}-${c}`) ?? null} theme={theme} />
                    </button>
                  )
                }),
              )}
            </div>
            </div>
          </div>

          <p className="text-xs text-slate-400 play-hide-compact">Drag, or tap an item then tap where to send it, to move or merge.</p>

          <div className="flex items-center gap-1.5 text-xs text-slate-500 play-hide-compact">
            <ArrowDownToLine size={12} className="text-slate-400 shrink-0" />
            {nextBoard ? (
              <span>More board pushes in once this one fully clears</span>
            ) : (
              <span>{inEndless ? 'Endless mode — the board stays as it is, and play never ends' : 'Final board — no more waves queued'}</span>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-2.5">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 px-1">
              <Package size={12} strokeWidth={2.5} /> Inventory
            </span>
            {session.inventory.length === 0 ? (
              <p className="text-xs text-slate-400 px-1">Empty</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 px-1">
                {session.inventory.map((rank, i) => (
                  <InventoryChip key={i} value={rank} theme={theme} onClick={() => handleInventoryClick(i)} />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:gap-4 w-full landscape:w-56 landscape:flex-none sm:w-64 sm:flex-none">
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <div className="flex flex-col gap-1 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-2.5 sm:p-3 play-compact-py">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                <Zap size={12} strokeWidth={2.5} /> Generator spends
              </span>
              <span className="font-display text-xl sm:text-2xl font-bold tabular-nums text-amber-700">{session.drSpent}</span>
            </div>
            <div className="flex flex-col gap-1 rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 to-fuchsia-50 p-2.5 sm:p-3 play-compact-py">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-purple-700">
                <Trophy size={12} strokeWidth={2.5} /> Highest rank
              </span>
              <span className="font-display text-xl sm:text-2xl font-bold tabular-nums text-purple-700">{maxRankReached || '—'}</span>
            </div>
          </div>

          <div className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-slate-50/70 p-2.5 play-compact-py">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 px-1">
              <Zap size={12} strokeWidth={2.5} /> Generator
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
                    {unlocked ? null : <Lock size={11} className="shrink-0" />}
                    x{t.cost} → rank {t.normalRank}
                  </span>
                  <span className={chosen ? 'text-purple-600' : 'text-slate-400'}>
                    {chosen ? 'selected' : unlocked ? 'tap to use' : `at rank ${t.unlocksAt}`}
                  </span>
                </button>
              )
            })}
          </div>

          <Button
            variant="primary"
            icon={inEndless ? EndlessGeneratorIcon : Zap}
            onClick={handleSpend}
            disabled={!canSpendGenerator(session)}
            data-tutorial="generate-button"
          >
            Use generator (x{activeTier.cost})
          </Button>

          <TwisterWidget
            session={session}
            compact
            onSpin={() => {
              spinTwister(session)
              setSession({ ...session })
            }}
          />

          {/* V2: collected rewards + free energy-funded taps. Only shows once
              something has actually been collected, so a stage without
              reward items looks exactly as before. */}
          {session.events.some((e) => e.type === 'collect') && (
            <>
              <div className="grid grid-cols-4 gap-1.5 text-center">
                {REWARD_TYPES.map((t) => (
                  <div key={t} className="rounded-xl border border-amber-200 bg-amber-50/80 px-0.5 py-1">
                    <GameArt asset={t} rank={1} size={20} className="mx-auto" />
                    <div className="text-[8px] font-semibold uppercase tracking-wide text-amber-700" title={t === COIN_TYPE ? 'Coins are counted in allowances, not coins' : undefined}>
                      {t === COIN_TYPE ? 'Coin allow.' : REWARD_TYPE_LABELS[t].split(' ')[0]}
                    </div>
                    <div className="font-display text-xs font-bold tabular-nums text-amber-800">
                      {formatRewardAmount(t, session.collected[t])}
                    </div>
                  </div>
                ))}
              </div>
              <Button variant="secondary" icon={Zap} onClick={() => { spendEnergyForAction(session); setSession({ ...session }) }} disabled={!canSpendEnergy(session)}>
                Use 1 energy (free ×1) — {Math.floor(session.energyBalance)} held
              </Button>
            </>
          )}
        </div>
      </div>

      {tutorialSpec && (
        <PlayTutorialCoach
          key={tutorialStep}
          selectors={tutorialSpec.selectors}
          text={tutorialSpec.text}
          final={tutorialSpec.final}
          onSkip={finishTutorial}
          onDone={finishTutorial}
        />
      )}
      {fx.layer}
    </div>
  )
}
