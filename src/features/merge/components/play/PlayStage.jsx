import { useEffect, useRef, useState } from 'react'
import { RotateCcw, Lock, Zap, Trophy, Package, ArrowDownToLine, PartyPopper, Maximize, Minimize, Smartphone, TriangleAlert, X } from 'lucide-react'
import Button from '../../../../components/ui/Button'
import RanksBar from './RanksBar'
import { MAX_RANK, RC_MAX_RANK } from '../../lib/core/ranks'
import { gridWidthRem } from '../../../../lib/gridWidth'
import { usePhoneScreen, canGoFullscreen, toggleFullscreen, useIsFullscreen } from '../../lib/play/usePhoneScreen'
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
  rcEntryPending,
  enterPendingRc,
  canJumpTo,
  jumpToPhase,
} from '../../lib/simulation/playSession'
import { TileContents, InventoryChip } from './PlayTile'
import { EndlessBanner, EndlessBoardBadge, EndlessGeneratorIcon } from './EndlessMode'
import { usePlayEffects, RC_HANDOVER_MS } from './PlayEffects'
import { tileSurface, themeOf, BOARD_SURROUND } from '../../lib/play/playTileSurface'
import TwisterWidget from './TwisterWidget'
import GameArt from './GameArt'
import { decodeReward, REWARD_TYPE_LABELS, REWARD_TYPES, COIN_TYPE, formatRewardAmount } from '../../lib/rewards/rewardChain'

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
//
// TWO LAYOUTS, one game. A shared stage is mostly opened on a phone held
// sideways, so that case has a layout of its own (`phone.sideways`,
// usePhoneScreen.js): the stage fills the screen and nothing scrolls - a slim
// bar on top (rank strip, three round buttons), the board sized from the
// screen's height on the left, and beside it the stats, inventory, rewards
// and Twister (that part scrolls on its own if it has to) above the
// multiplier chips and a big generator button, bottom right where the thumb
// is. Every other screen (a desktop window, a phone held upright) gets the
// roomy layout. The pieces below are built once and placed by either layout,
// so the two cannot drift apart. `notice`: a line the page wants shown (a
// broken link), which the phone layout has to place itself.
export default function PlayStage({ boards, stageName, rcBoards, rcVariantLabel = null, notice = null }) {
  const phone = usePhoneScreen()
  // A finger, not a mouse: the browser's drag-and-drop is switched off there.
  const coarsePointer = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
  const sideways = phone.sideways
  const fullscreen = useIsFullscreen()
  const [hintClosed, setHintClosed] = useState(false)
  const [noticeClosed, setNoticeClosed] = useState(false)
  // The session reads every economy setting off the boards themselves - the
  // main chain's from boards[0] at creation, the RC variant's from
  // rcBoards[0] at the gated transition (see playSession.js) - so passing
  // the RC list is all a shared stage needs.
  // The merge that makes rank 12 finishes on the normal board - its drops land,
  // the grand prize starts - and only then does the Recompletion board come
  // in, sliding down slowly (deferRcEntry; economist: "we merge and we cant
  // see the drop happening").
  // A stage with no Recompletion list ends at rank 12: the generator stops
  // there (`endAtGoal`), what is left can still be merged and collected.
  const rcOptions = rcBoards && rcBoards.length ? { rcBoards, deferRcEntry: true } : { endAtGoal: true }
  const [session, setSession] = useState(() => createPlaySession(boards, 0, rcOptions))
  // Thrown items, jumping drops and payouts - read off the session's own events.
  const fx = usePlayEffects(session)
  const [selected, setSelected] = useState(null)
  const [chosenTierCost, setChosenTierCost] = useState(1)
  // (There is no first-time walkthrough here any more - economist: "we can
  // remove the tutorial from there also". It darkened the whole screen and
  // took every tap but one for anyone opening a link for the first time, which
  // is exactly who a shared link is sent to.)
  const prevHighestUnlockedCost = useRef(1)

  // The held-back Recompletion hand-over (see rcOptions above).
  const pendingRc = rcEntryPending(session)
  useEffect(() => {
    if (!pendingRc) return undefined
    const calm = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const id = setTimeout(() => {
      enterPendingRc(session)
      setSelected(null)
      setSession({ ...session })
    }, calm ? 0 : RC_HANDOVER_MS)
    return () => clearTimeout(id)
  }, [pendingRc, session])

  // DRAGGING WITH A FINGER. The browser's own drag-and-drop does not work on a
  // touch screen - the board scrolled under the finger instead (economist:
  // "it is not working well with the drag now because the board is being
  // dragged"). So a touch on an item is followed by hand: the item follows
  // the finger, and where it is let go is a move or a merge, exactly like
  // tap-then-tap. The board itself takes no touch scrolling (touch-action:
  // none on it), so it never moves under the finger. Mouse keeps the
  // browser's drag-and-drop.
  const touchDrag = useRef(null)
  const suppressClick = useRef(false)
  const [ghost, setGhost] = useState(null)
  const live = useRef(null)
  live.current = { session, applyAction, fx }
  useEffect(() => {
    const move = (e) => {
      const d = touchDrag.current
      if (!d || e.pointerId !== d.pointerId) return
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 8) return
      d.moved = true
      setSelected(d.from)
      setGhost({ value: d.value, x: e.clientX, y: e.clientY, size: d.size })
    }
    const up = (e) => {
      const d = touchDrag.current
      if (!d || e.pointerId !== d.pointerId) return
      touchDrag.current = null
      if (!d.moved) return
      setGhost(null)
      setSelected(null)
      suppressClick.current = true
      setTimeout(() => {
        suppressClick.current = false
      }, 350)
      if (e.type === 'pointercancel') return
      const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-cell]')
      if (!cell) return
      const to = cell.getAttribute('data-cell').split('-').map(Number)
      const { session: current, applyAction: apply, fx: effects } = live.current
      const kind = actionFor(current, d.from, to)
      if (!kind) return
      effects.dragged()
      apply(kind, d.from, to)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])
  function handlePointerDown(e, r, c) {
    if (e.pointerType === 'mouse' || pendingRc) return
    const st = session.state
    if (st.itemAt[r][c] == null || st.stuck[r][c]) return
    const rect = e.currentTarget.getBoundingClientRect()
    touchDrag.current = { pointerId: e.pointerId, from: [r, c], x0: e.clientX, y0: e.clientY, moved: false, size: rect.width, value: st.itemAt[r][c] }
  }

  // A phone held sideways: the page itself never scrolls or bounces.
  useEffect(() => {
    if (!sideways) return undefined
    const root = document.documentElement
    const was = [root.style.overflow, document.body.style.overscrollBehavior]
    root.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      root.style.overflow = was[0]
      document.body.style.overscrollBehavior = was[1]
    }
  }, [sideways])

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
    if (suppressClick.current || pendingRc) return
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
    if (pendingRc) return
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

  const cols = session.state.cols
  const rows = session.state.rows
  const widthRem = gridWidthRem(cols)
  const spendEnergy = () => {
    spendEnergyForAction(session)
    setSession({ ...session })
  }
  const anyCollected = session.events.some((e) => e.type === 'collect')
  // A phone, either way up, gets the multipliers as chips and a big generator
  // button; held upright they sit right under the board, so playing does not
  // mean scrolling between the board and the button.
  const thumbControls = sideways || phone.upright

  // ---- the pieces, placed by either layout ---------------------------------
  const boardEl = (
    <div data-theme={theme} className={`relative ${BOARD_SURROUND[theme]} ${sideways ? 'rounded-2xl p-1.5' : 'rounded-3xl p-3 sm:p-4'} shadow-inner select-none transition-colors duration-700`}>
      {inEndless && <EndlessBoardBadge />}
      <div className={fx.boardFx ? 'overflow-hidden rounded-xl' : ''}>
        <div
          className={`grid touch-none ${sideways ? 'gap-1' : 'gap-1.5 sm:gap-2'} ${fx.boardFx ? (fx.boardFx.kind === 'push' ? 'play-board-push' : 'play-board-swap') : ''}`}
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
                ? `${REWARD_TYPE_LABELS[decodeReward(rank).type]} reward R${decodeReward(rank).rank}${stuck ? ' · semi-blocked - merge a matching item into it to free it' : isSelected ? ' · tap again to collect' : ' · tap twice to collect, or merge with a matching one'}`
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
                  draggable={movable && !coarsePointer}
                  onPointerDown={(e) => handlePointerDown(e, r, c)}
                  onDragStart={(e) => handleDragStart(e, r, c)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, r, c)}
                  onDragEnd={() => setSelected(null)}
                  onClick={() => handleCellClick(r, c)}
                  title={cellTitle}
                  aria-label={cellTitle}
                  className={`relative aspect-square ${sideways ? 'rounded-lg' : 'rounded-xl'} text-white flex flex-col items-center justify-center leading-tight transition-colors shadow-[inset_0_2px_0_rgba(255,255,255,0.35)] ${
                    movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                  } ${surface.className} ${isSelected ? `${sideways ? 'ring-[3px] ring-offset-1' : 'ring-4 ring-offset-2'} ring-offset-white ring-purple-500` : ''} ${targetKind ? TARGET_STYLE[targetKind] : ''}`}
                  style={surface.style}
                >
                  <TileContents value={rank} stuck={stuck} selected={isSelected} arriving={fx.arriving.has(`${r}-${c}`) || (!!ghost && isSelected)} pop={fx.popping.get(`${r}-${c}`) ?? null} theme={theme} />
                </button>
              )
            }),
          )}
        </div>
      </div>
    </div>
  )

  const inventoryEl = sideways ? (
    <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/80 px-1.5 py-1" data-testid="stage-inventory">
      <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500" title="Items that did not fit on the board - tap one to drop it on a free cell">
        <Package size={12} strokeWidth={2.5} /> {session.inventory.length}
      </span>
      {session.inventory.length === 0 ? (
        <span className="text-[11px] text-slate-400">Inventory empty</span>
      ) : (
        <div className="play-phone-scroll flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {session.inventory.map((rank, i) => (
            <span key={i} className="shrink-0">
              <InventoryChip value={rank} theme={theme} onClick={() => handleInventoryClick(i)} />
            </span>
          ))}
        </div>
      )}
    </div>
  ) : (
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-2.5" data-testid="stage-inventory">
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
  )

  const statsEl = sideways ? (
    <div className="grid grid-cols-2 gap-1.5">
      <div className="flex items-center justify-between gap-1 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 px-2 py-1" title="Generator spends">
        <Zap size={13} strokeWidth={2.5} className="shrink-0 text-amber-600" />
        <span className="font-display text-base font-bold leading-none tabular-nums text-amber-700" data-testid="stage-spends">
          {session.drSpent}
        </span>
      </div>
      <div className="flex items-center justify-between gap-1 rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-fuchsia-50 px-2 py-1" title="Highest rank">
        <Trophy size={13} strokeWidth={2.5} className="shrink-0 text-purple-600" />
        <span className="font-display text-base font-bold leading-none tabular-nums text-purple-700">{maxRankReached || '—'}</span>
      </div>
    </div>
  ) : (
    <div className="grid grid-cols-2 gap-2 sm:gap-3">
      <div className="flex flex-col gap-1 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-2.5 sm:p-3 play-compact-py">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
          <Zap size={12} strokeWidth={2.5} /> Generator spends
        </span>
        <span className="font-display text-xl sm:text-2xl font-bold tabular-nums text-amber-700" data-testid="stage-spends">
          {session.drSpent}
        </span>
      </div>
      <div className="flex flex-col gap-1 rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 to-fuchsia-50 p-2.5 sm:p-3 play-compact-py">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-purple-700">
          <Trophy size={12} strokeWidth={2.5} /> Highest rank
        </span>
        <span className="font-display text-xl sm:text-2xl font-bold tabular-nums text-purple-700">{maxRankReached || '—'}</span>
      </div>
    </div>
  )

  // The multipliers: a list on a roomy screen, three chips on a phone.
  const tiersEl = thumbControls ? (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${session.tiers.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label="Generator multiplier">
      {session.tiers.map((t) => {
        const unlocked = unlockedTiers.some((u) => u.cost === t.cost)
        const chosen = activeTier.cost === t.cost
        return (
          <button
            key={t.cost}
            type="button"
            role="radio"
            aria-checked={chosen}
            disabled={!unlocked}
            onClick={() => setChosenTierCost(t.cost)}
            title={unlocked ? `x${t.cost}: a tap costs ${t.cost} and gives a rank ${t.normalRank}` : `Unlocks once you hold a rank-${t.unlocksAt} item`}
            className={`flex h-9 items-center justify-center gap-1 rounded-lg text-sm font-bold transition-colors ${
              chosen ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-sm' : unlocked ? 'border border-slate-200 bg-white text-slate-700' : 'border border-slate-200 bg-slate-100 text-slate-400'
            }`}
          >
            {!unlocked && <Lock size={11} className="shrink-0" />}x{t.cost}
            {!unlocked && <span className="text-[9px] font-semibold">r{t.unlocksAt}</span>}
          </button>
        )
      })}
    </div>
  ) : (
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
            <span className={chosen ? 'text-purple-600' : 'text-slate-400'}>{chosen ? 'selected' : unlocked ? 'tap to use' : `at rank ${t.unlocksAt}`}</span>
          </button>
        )
      })}
    </div>
  )

  const generatorEl = (
    <Button
      variant="primary"
      icon={inEndless ? EndlessGeneratorIcon : Zap}
      onClick={handleSpend}
      disabled={!canSpendGenerator(session)}
      data-tutorial="generate-button"
      aria-label={`Use generator (x${activeTier.cost})`}
      className={thumbControls ? 'h-14 w-full text-base' : ''}
    >
      {sideways ? `Generate x${activeTier.cost}` : `Use generator (x${activeTier.cost})`}
    </Button>
  )

  const twisterEl = (
    <TwisterWidget
      session={session}
      compact
      mini={sideways}
      onSpin={() => {
        spinTwister(session)
        setSession({ ...session })
      }}
    />
  )

  // V2: collected rewards + free energy-funded taps. Only shows once
  // something has actually been collected, so a stage without reward items
  // looks exactly as before.
  const rewardsEl = !anyCollected ? null : sideways ? (
    <>
      <div className="grid grid-cols-4 gap-1 text-center" data-testid="stage-collected">
        {REWARD_TYPES.map((t) => (
          <div key={t} className="rounded-lg border border-amber-200 bg-amber-50/80 py-0.5" title={t === COIN_TYPE ? 'Coins, counted in allowances' : REWARD_TYPE_LABELS[t]}>
            <GameArt asset={t} rank={1} size={18} className="mx-auto" />
            <div className="font-display text-[11px] font-bold leading-tight tabular-nums text-amber-800">{formatRewardAmount(t, session.collected[t])}</div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={spendEnergy}
        disabled={!canSpendEnergy(session)}
        className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 shadow-sm active:scale-[0.97] disabled:opacity-40"
        title="Spend 1 merge energy for a free x1 generator tap"
      >
        <Zap size={14} strokeWidth={2.25} /> Free tap · {Math.floor(session.energyBalance)} energy
      </button>
    </>
  ) : (
    <>
      <div className="grid grid-cols-4 gap-1.5 text-center" data-testid="stage-collected">
        {REWARD_TYPES.map((t) => (
          <div key={t} className="rounded-xl border border-amber-200 bg-amber-50/80 px-0.5 py-1">
            <GameArt asset={t} rank={1} size={20} className="mx-auto" />
            <div className="text-[8px] font-semibold uppercase tracking-wide text-amber-700" title={t === COIN_TYPE ? 'Coins are counted in allowances, not coins' : undefined}>
              {t === COIN_TYPE ? 'Coin allow.' : REWARD_TYPE_LABELS[t].split(' ')[0]}
            </div>
            <div className="font-display text-xs font-bold tabular-nums text-amber-800">{formatRewardAmount(t, session.collected[t])}</div>
          </div>
        ))}
      </div>
      <Button variant="secondary" icon={Zap} onClick={spendEnergy} disabled={!canSpendEnergy(session)}>
        Use 1 energy (free ×1) — {Math.floor(session.energyBalance)} held
      </Button>
    </>
  )

  // JUMP AHEAD (economist: "please add the jump ahead to the share stage
  // also") - the Play Tester's shortcut: a clean start of Recompletion (a
  // fresh first board with just a rank 12) or of endless mode (an open board
  // with just a rank 14). Only on a stage that has a Recompletion list.
  const jump = (target) => {
    jumpToPhase(session, target)
    setSelected(null)
    setSession({ ...session })
  }
  const hasRcList = !!(rcBoards && rcBoards.length)
  const jumpEl = !hasRcList ? null : sideways ? (
    <div className="grid grid-cols-2 gap-1.5" data-testid="phase-jump">
      <button type="button" disabled={!canJumpTo(session, 'rc')} onClick={() => jump('rc')} data-testid="jump-rc" className="h-9 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 active:scale-95 disabled:opacity-40">
        To Recompletion
      </button>
      <button type="button" disabled={!canJumpTo(session, 'endless')} onClick={() => jump('endless')} data-testid="jump-endless" className="h-9 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 active:scale-95 disabled:opacity-40">
        To endless
      </button>
    </div>
  ) : (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-slate-200 bg-slate-50/70 p-2.5" data-testid="phase-jump">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 px-1">Jump ahead</span>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon={RotateCcw} disabled={!canJumpTo(session, 'rc')} onClick={() => jump('rc')} data-testid="jump-rc">
          To Recompletion
        </Button>
        <Button variant="secondary" size="sm" icon={EndlessGeneratorIcon} disabled={!canJumpTo(session, 'endless')} onClick={() => jump('endless')} data-testid="jump-endless">
          To endless mode
        </Button>
      </div>
      <p className="text-[11px] text-slate-500 px-1">
        {session.jumped ? 'You jumped ahead to a clean start of the phase. Restart to play from the beginning.' : 'Starts the phase clean: Recompletion with just a rank 12, endless mode with just a rank 14.'}
      </p>
    </div>
  )

  const overlays = (
    <>
      {ghost && (
        <div
          className="pointer-events-none fixed z-50 drop-shadow-xl"
          style={{ left: ghost.x - ghost.size * 0.6, top: ghost.y - ghost.size * 0.6, width: ghost.size * 1.2, height: ghost.size * 1.2 }}
          data-testid="drag-ghost"
          aria-hidden="true"
        >
          <div className="relative w-full h-full flex items-center justify-center">
            <TileContents value={ghost.value} stuck={false} theme={theme} />
          </div>
        </div>
      )}
      {fx.layer}
    </>
  )

  // ---- a phone held sideways: one screen, nothing scrolls -------------------
  if (sideways) {
    const roundButton = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-600 shadow-sm active:scale-95'
    return (
      <div className="play-phone play-touch" data-testid="play-phone">
        <div className="flex h-10 shrink-0 items-center gap-2">
          <h1 className="hidden min-[760px]:block max-w-[8rem] shrink-0 truncate font-display text-sm font-bold leading-none tracking-tight text-slate-900">{stageName ?? 'Merge Mania'}</h1>
          {(inRc || inEndless) && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${inEndless ? 'bg-fuchsia-600 text-white' : 'bg-purple-100 text-purple-700'}`}>{inEndless ? 'Endless' : 'Recompletion'}</span>
          )}
          <div className="min-w-0 flex-1">
            <RanksBar compact maxRankReached={maxRankReached} rewardRanks={board.rewardRanks} goalRank={inRc || inEndless ? RC_MAX_RANK : MAX_RANK} />
          </div>
          <button type="button" className={roundButton} onClick={reset} aria-label="Restart" title="Restart">
            <RotateCcw size={16} />
          </button>
          {canGoFullscreen() && (
            <button type="button" className={roundButton} onClick={toggleFullscreen} aria-label={fullscreen ? 'Leave full screen' : 'Full screen'} title={fullscreen ? 'Leave full screen' : 'Full screen'} data-testid="stage-fullscreen">
              {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1 gap-2">
          <div className="play-phone-board" style={{ '--cols': cols, '--rows': rows }}>
            {boardEl}
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
            <div className="play-phone-scroll flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain">
              {notice && !noticeClosed && (
                <button type="button" onClick={() => setNoticeClosed(true)} className="rounded-xl border border-amber-200 bg-amber-50 px-2 py-1 text-left text-[11px] leading-snug text-amber-800" data-testid="stage-notice">
                  {notice} <span className="font-semibold underline">Close</span>
                </button>
              )}
              {finished && (
                <div className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                  <PartyPopper size={14} className="shrink-0" />{' '}
                  <span data-testid="stage-finished">Rank {MAX_RANK} — the event is complete! Merge and tap what is left to collect it.</span>
                </div>
              )}
              <EndlessBanner session={session} mini />
              {inRc && (
                <div data-testid="rc-active" className="rounded-xl border border-purple-200 bg-purple-50 px-2 py-1 text-[11px] font-semibold leading-snug text-purple-700">
                  Recompletion round{rcVariantLabel ? ` (${rcVariantLabel})` : ''} — climb to rank {RC_MAX_RANK}.
                </div>
              )}
              {statsEl}
              {inventoryEl}
              {rewardsEl}
              {twisterEl}
              {jumpEl}
            </div>
            <div className="flex shrink-0 flex-col gap-1.5">
              {tiersEl}
              {generatorEl}
            </div>
          </div>
        </div>
        {overlays}
      </div>
    )
  }

  // ---- every other screen ----------------------------------------------------
  return (
    <div className={`flex flex-col gap-5 play-compact-gap w-full max-w-4xl mx-auto ${phone.upright ? 'play-touch' : ''}`}>
      {notice && !noticeClosed && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800" data-testid="stage-notice">
          <TriangleAlert size={16} className="shrink-0 mt-0.5" />
          <span className="text-sm flex-1">{notice}</span>
          <button type="button" onClick={() => setNoticeClosed(true)} aria-label="Close" className="shrink-0 text-amber-700/70 hover:text-amber-800">
            <X size={16} />
          </button>
        </div>
      )}
      {phone.upright && !hintClosed && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-sky-800" data-testid="rotate-hint">
          <Smartphone size={18} className="shrink-0 rotate-90" />
          <span className="flex-1 text-xs font-semibold leading-snug">Turn your phone sideways: the whole board and the controls then fit on one screen.</span>
          {canGoFullscreen() && (
            <button type="button" onClick={toggleFullscreen} className="shrink-0 rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-bold text-white active:scale-95">
              Full screen
            </button>
          )}
          <button type="button" onClick={() => setHintClosed(true)} aria-label="Close" data-testid="rotate-hint-close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sky-700 active:bg-sky-100">
            <X size={16} />
          </button>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold text-slate-900 leading-tight tracking-tight truncate">{stageName ?? 'Merge Mania'}</h1>
          <p className="text-xs text-slate-400 play-hide-compact">Merge matching items, spend the generator, and climb the chain</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="secondary" size="sm" icon={RotateCcw} onClick={reset}>
            Restart
          </Button>
        </div>
      </div>

      {finished && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3 text-amber-700">
          <PartyPopper size={18} className="shrink-0" />
          <span className="text-sm font-semibold" data-testid="stage-finished">
            You reached rank {MAX_RANK} — the event is complete! The generator has stopped: merge and tap the rewards still on the board to collect them.
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
          {boardEl}

          {phone.upright && (
            <div className="flex flex-col gap-2" data-testid="upright-controls">
              {tiersEl}
              {generatorEl}
            </div>
          )}

          <p className="text-xs text-slate-400 play-hide-compact">{phone.upright ? 'Tap an item, then tap where to send it, to move or merge.' : 'Drag, or tap an item then tap where to send it, to move or merge.'}</p>

          <div className="flex items-center gap-1.5 text-xs text-slate-500 play-hide-compact">
            <ArrowDownToLine size={12} className="text-slate-400 shrink-0" />
            {nextBoard ? (
              <span>More board pushes in once this one fully clears</span>
            ) : (
              <span>{inEndless ? 'Endless mode — the board stays as it is, and play never ends' : 'Final board — no more waves queued'}</span>
            )}
          </div>

          {inventoryEl}
        </div>

        <div className="flex flex-col gap-3 sm:gap-4 w-full landscape:w-56 landscape:flex-none sm:w-64 sm:flex-none">
          {statsEl}
          {!phone.upright && tiersEl}
          {!phone.upright && generatorEl}
          {twisterEl}
          {rewardsEl}
          {jumpEl}
        </div>
      </div>

      {overlays}
    </div>
  )
}
