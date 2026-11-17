import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { itemArt } from '../lib/playTileSurface'
import { rewardArt, endlessArt } from '../lib/artAssets'
import { encodeReward, decodeReward, formatRewardAmount, REWARD_MAX_RANK, REWARD_TYPE_LABELS } from '../lib/rewardChain'
import { colorForRank, MAX_RANK, RC_MAX_RANK } from '../lib/ranks'
import { tierForRank, tierForBonus, nextTier } from '../lib/mergeCelebration'
import { EndlessNameplate } from './EndlessMode'
import { Burst, ConfettiRain, GrandPrize } from './Celebrations'

// What the player SEES happen on the board, shared by the Play Tester and
// Play Stage. By explicit economist request - first "let the generator throw
// into the game the items, when there is a drop also to see the drops jump
// out of the merged item, and when we get the rank 4 of small rewards some
// kind of interaction that shows the user gets the amount", then "work on the
// smoothness of the merges, and make the celebrations a bit better":
//   - a tapped MERGE: the item slides into its match, and the new item pops
//     out where they met (a dragged merge is already there - it just pops);
//   - a tapped MOVE slides to its cell;
//   - a generator tap THROWS its item to its cell, where it lands with a
//     small bounce; a lucky one lands in gold with "LUCKY +N";
//   - a merge DROP jumps out of the merged item, once that item has formed
//     (the items of one container leave one after another);
//   - a tile that OPENS shows its item popping out;
//   - every merge is CELEBRATED in the colour of the rank it made - a ring,
//     a flash, sparkles, and for the big ranks confetti - one step bigger the
//     first time that rank is reached, with the rank's name;
//   - a collected reward shows what was paid, rising from the item: "+75
//     energy";
//   - rank 12 is the GRAND PRIZE: the item, large, over turning rays, with
//     paper falling across the board; rank 14 plays the endless-mode
//     starburst (once) with the same falling paper;
//   - a board that PUSHES IN slides down from the top, and the Recompletion
//     board fades in.
//
// It is presentation only. Nothing here changes the session: the effects are
// read off the events the play engine has already logged (playSession.js),
// by remembering how many had been seen at the last render. The real item is
// already in its cell; it is kept invisible (`arriving`) until the copy that
// is sliding or flying reaches it, so nothing appears twice, and then plays
// its own short `popping` animation (PlayTile.jsx).
//
// Positions are read from the DOM: a cell is `[data-cell="row-col"]`, the
// generator is `[data-fx="generator"]` (or Play Stage's tutorial hook), the
// board is `[data-fx="board"]`. Cells named by an event are corrected for
// any board that pushed in later in the same action; an action that swaps
// the whole board (Recompletion starting) has no cell left to point at, so
// it gets the board-wide effects only.
//
// A viewer who asked their system for reduced motion gets no moving items
// and no bursts - only the payout text.
const SLIDE_MS = 170
const FLY_MS = 420
const STAGGER_MS = 90
const POP_MS = 380
const PAYOUT_MS = 1500
const ENDLESS_MS = 1600
const GRAND_MS = 2600
const BOARD_MS = 320
const REWARD_COLOR = '#f59e0b'
const LUCKY_COLOR = '#f59e0b'

const cellKey = (cell) => `${cell[0]}-${cell[1]}`
const rectOfCell = (cell) => (cell ? document.querySelector(`[data-cell="${cellKey(cell)}"]`)?.getBoundingClientRect() : null) ?? null
const rectOfGenerator = () => document.querySelector('[data-fx="generator"], [data-tutorial="generate-button"]')?.getBoundingClientRect() ?? null
const rectOfBoard = () => document.querySelector('[data-fx="board"]')?.getBoundingClientRect() ?? null
const centre = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })

export function usePlayEffects(session) {
  const seen = useRef(session.events.length)
  const sessionId = useRef(session.id)
  const nextId = useRef(0)
  const timers = useRef(new Set())
  // Set by the play screen just before it applies a DROPPED (dragged) action:
  // the item is already where the player put it, so nothing slides.
  const draggedNext = useRef(false)
  const [effects, setEffects] = useState([])
  const [arriving, setArriving] = useState(() => new Set())
  const [popping, setPopping] = useState(() => new Map())
  const [boardFx, setBoardFx] = useState(null)

  const later = useCallback((ms, fn) => {
    const id = setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, ms)
    timers.current.add(id)
  }, [])
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  const dragged = useCallback(() => {
    draggedNext.current = true
  }, [])

  useLayoutEffect(() => {
    const events = session.events
    const wasDragged = draggedNext.current
    draggedNext.current = false
    if (session.id !== sessionId.current) {
      // A new session (Reset): nothing of the old one is left on screen.
      sessionId.current = session.id
      seen.current = events.length
      timers.current.forEach(clearTimeout)
      timers.current.clear()
      setEffects([])
      setArriving(new Set())
      setPopping(new Map())
      setBoardFx(null)
      return
    }
    if (events.length <= seen.current) {
      seen.current = events.length
      return
    }
    const fresh = events.slice(seen.current)
    seen.current = events.length
    const calm = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    // Where a cell named by event i is NOW: rows pushed in after it moved it
    // down; a board swapped in after it means it is not on screen at all.
    const pushedAfter = fresh.map((_, i) => fresh.slice(i + 1).reduce((s, e) => s + (e.type === 'board-push' ? e.rows : 0), 0))
    const swapIndex = fresh.findLastIndex((e) => e.type === 'rc-entered')
    const cellNow = (cell, i) => (cell && i > swapIndex ? [cell[0] + pushedAfter[i], cell[1]] : null)
    const rectNow = (cell, i) => rectOfCell(cellNow(cell, i))
    // While the board itself is moving, copies flying to fixed positions
    // would miss their cells, so that action gets pops and bursts only.
    const boardMoved = fresh.some((e) => e.type === 'board-push' || e.type === 'rc-entered')
    const moving = !calm && !boardMoved
    const settle = boardMoved ? BOARD_MS : 0

    const made = []
    const hide = [] // { key, until }
    const pop = [] // { key, kind, at }
    const add = (fx) => {
      made.push({ id: nextId.current++, ...fx })
      return made[made.length - 1]
    }
    const fly = (from, to, value, { delay = 0, duration = FLY_MS, kind = 'fly', lucky = false } = {}) => {
      const size = Math.min(to.width, to.height)
      const a = centre(from)
      const b = centre(to)
      add({ kind, value, delay, duration, size, lucky, x: a.x - size / 2, y: a.y - size / 2, dx: b.x - a.x, dy: b.y - a.y })
    }

    // When the merge in progress has formed its new item - drops, payouts
    // and reveals that follow it wait for that.
    let mergeAt = settle
    let mergeCell = null
    let mergeIndex = -1
    let dropsFromThisMerge = 0
    let lastBurst = null
    // A rank-4 payout is logged just BEFORE the merge that caused it, so a
    // payout with no merge behind it looks at the merges of the same action.
    const firstMergeIndex = fresh.findIndex((e) => e.type === 'merge')

    fresh.forEach((e, i) => {
      if (e.type === 'merge') {
        const slide = moving && !wasDragged
        const from = slide ? rectNow(e.from, i) : null
        const into = rectNow(e.into, i)
        mergeCell = e.into
        mergeIndex = i
        dropsFromThisMerge = 0
        mergeAt = settle + (from && into ? SLIDE_MS : 0)
        lastBurst = null
        if (!into) return
        const key = cellKey(cellNow(e.into, i))
        if (from) {
          // The mover slides in; the item it merges into stays put until then.
          fly(from, into, e.rank, { duration: SLIDE_MS, kind: 'slide' })
          fly(into, into, e.rank, { duration: SLIDE_MS, kind: 'hold' })
          if (e.newRank != null) hide.push({ key, until: mergeAt })
        }
        if (calm) return
        if (e.newRank != null) pop.push({ key, kind: 'merge', at: mergeAt })
        const reward = decodeReward(e.rank)
        const at = centre(into)
        lastBurst = add({
          kind: 'burst',
          x: at.x,
          y: at.y,
          size: Math.min(into.width, into.height),
          delay: mergeAt,
          tier: reward ? (e.newRank == null ? 'medium' : 'small') : tierForRank(e.newRank),
          color: reward ? REWARD_COLOR : colorForRank(e.newRank),
          rank: reward ? null : e.newRank,
        })
      } else if (e.type === 'reached') {
        // The first time a rank is made: one step bigger, and named. Rank 12
        // and rank 14 have their own board-wide moments instead.
        if (lastBurst && lastBurst.rank === e.rank && e.rank < MAX_RANK) {
          lastBurst.tier = nextTier(lastBurst.tier)
          lastBurst.label = `Rank ${e.rank}!`
        }
        if (calm) return
        const board = rectOfBoard()
        if (!board) return
        if (e.rank === MAX_RANK && !fresh.some((x) => x.type === 'endless-entered')) {
          const c = centre(board)
          const toRc = fresh.some((x) => x.type === 'rc-entered')
          add({ kind: 'grand', x: c.x, y: c.y, width: board.width, height: board.height, rank: MAX_RANK, title: `Rank ${MAX_RANK} — Grand prize!`, subtitle: toRc ? `Recompletion begins — chase rank ${RC_MAX_RANK}` : null, delay: 0 })
        } else if (e.rank === RC_MAX_RANK) {
          const c = centre(board)
          add({ kind: 'rain', x: c.x, y: c.y, width: board.width, height: board.height })
        }
      } else if (e.type === 'moved') {
        if (!moving || wasDragged) return
        const from = rectNow(e.from, i)
        const to = rectNow(e.to, i)
        const value = session.state.itemAt[e.to[0]]?.[e.to[1]]
        if (!from || !to || value == null) return
        fly(from, to, value, { duration: SLIDE_MS, kind: 'slide' })
        hide.push({ key: cellKey(e.to), until: SLIDE_MS })
      } else if (e.type === 'spend' || e.type === 'energy-spend' || e.type === 'inventory-place') {
        const to = rectNow(e.cell, i)
        if (!to || calm) return
        const key = cellKey(cellNow(e.cell, i))
        const from = moving && e.type !== 'inventory-place' ? rectOfGenerator() : null
        const lands = from ? FLY_MS : settle
        if (from) {
          fly(from, to, e.rank, { lucky: e.bonus > 0 })
          hide.push({ key, until: lands })
        }
        pop.push({ key, kind: 'land', at: lands })
        if (e.bonus > 0) {
          const at = centre(to)
          add({ kind: 'burst', x: at.x, y: at.y, size: Math.min(to.width, to.height), delay: lands, tier: tierForBonus(e.bonus), color: LUCKY_COLOR, label: `LUCKY +${e.bonus}!`, lucky: true })
        }
      } else if (e.type === 'merge-drop' && e.cell) {
        const to = rectNow(e.cell, i)
        if (!to || calm) return
        const key = cellKey(cellNow(e.cell, i))
        const from = moving ? rectNow(mergeCell, mergeIndex) : null
        const delay = mergeAt + 60 + dropsFromThisMerge * STAGGER_MS
        dropsFromThisMerge += 1
        if (from) {
          fly(from, to, encodeReward(e.rewardType, Math.min(e.rank, REWARD_MAX_RANK - 1)), { delay })
          hide.push({ key, until: delay + FLY_MS })
          pop.push({ key, kind: 'land', at: delay + FLY_MS })
        } else {
          pop.push({ key, kind: 'land', at: settle })
        }
      } else if (e.type === 'reveal') {
        if (calm) return
        const cell = cellNow(e.cell, i)
        if (cell && rectOfCell(cell)) pop.push({ key: cellKey(cell), kind: 'reveal', at: mergeAt })
      } else if (e.type === 'collect') {
        const source = mergeCell ? rectNow(mergeCell, mergeIndex) : firstMergeIndex >= 0 ? rectNow(fresh[firstMergeIndex].into, firstMergeIndex) : null
        const at = source ?? rectOfBoard()
        if (at) add({ kind: 'payout', type: e.rewardType, rank: e.rank, amount: e.amount, endless: session.phase === 'endless', x: at.left + at.width / 2, y: at.top + at.height * 0.25, delay: calm || !moving || wasDragged ? 0 : SLIDE_MS })
      } else if (e.type === 'endless-entered' && !calm) {
        const board = rectOfBoard()
        if (board) add({ kind: 'endless', x: board.left + board.width / 2, y: board.top + board.height / 2, size: Math.max(260, Math.min(board.width, board.height)) })
      }
    })

    // The board itself: a pushed-in board slides down by the rows it added;
    // the Recompletion board fades in.
    if (!calm && boardMoved) {
      const rows = fresh.reduce((s, e) => s + (e.type === 'board-push' ? e.rows : 0), 0)
      const swapped = swapIndex >= 0
      const stamp = nextId.current++
      setBoardFx({ kind: swapped ? 'swap' : 'push', key: stamp, fraction: Math.min(1, rows / Math.max(1, session.state.rows)) })
      later(BOARD_MS + 40, () => setBoardFx((cur) => (cur?.key === stamp ? null : cur)))
    }

    if (hide.length > 0) {
      setArriving((prev) => new Set([...prev, ...hide.map((h) => h.key)]))
      for (const h of hide) later(h.until, () => setArriving((prev) => new Set([...prev].filter((k) => k !== h.key))))
    }
    for (const p of pop) {
      later(p.at, () => setPopping((prev) => new Map(prev).set(p.key, p.kind)))
      later(p.at + POP_MS, () =>
        setPopping((prev) => {
          if (prev.get(p.key) !== p.kind) return prev
          const next = new Map(prev)
          next.delete(p.key)
          return next
        }),
      )
    }
    if (made.length === 0) return
    setEffects((prev) => [...prev, ...made])
    // Each effect is taken away when its own animation ends: a copy the
    // moment it arrives (the real item takes over there - a finished copy
    // left on top of it would stay behind as a ghost if the item moved).
    const LIFE = { payout: PAYOUT_MS, endless: ENDLESS_MS, grand: GRAND_MS, rain: GRAND_MS, burst: 1500 }
    for (const m of made) {
      const life = (m.delay ?? 0) + (LIFE[m.kind] ?? m.duration)
      later(life, () => setEffects((prev) => prev.filter((x) => x.id !== m.id)))
    }
    // Runs when the play screen hands React a new session object (it does
    // after every action); the events themselves are read by count.
  }, [session, later])

  const layer = (
    <div className="fixed inset-0 z-50 pointer-events-none overflow-hidden" aria-hidden="true" data-fx-layer>
      {effects.map((fx) => {
        if (fx.kind === 'fly' || fx.kind === 'slide' || fx.kind === 'hold') {
          const art = itemArt(fx.value)
          if (!art) return null
          const marker = fx.kind === 'fly' ? { 'data-fx-fly': '' } : { 'data-fx-slide': fx.kind }
          return (
            <img
              key={fx.id}
              src={art.url}
              alt=""
              draggable={false}
              {...marker}
              className={`absolute object-contain ${fx.kind === 'fly' ? 'play-fx-fly' : fx.kind === 'slide' ? 'play-fx-slide' : ''} ${fx.lucky ? 'play-fx-lucky' : ''}`}
              style={{ left: fx.x, top: fx.y, width: fx.size, height: fx.size, '--fx-dx': `${fx.dx}px`, '--fx-dy': `${fx.dy}px`, '--fx-scale': art.scale, transform: fx.kind === 'hold' ? `scale(${art.scale})` : undefined, animationDuration: `${fx.duration}ms`, animationDelay: `${fx.delay}ms` }}
            />
          )
        }
        if (fx.kind === 'burst') {
          return (
            <div key={fx.id} className="absolute" style={{ left: fx.x, top: fx.y }} data-fx-burst={fx.lucky ? 'lucky' : (fx.rank ?? 'reward')}>
              <Burst tier={fx.tier} color={fx.color} size={fx.size} delay={fx.delay} label={fx.label ?? null} labelClass={fx.lucky ? 'bg-gradient-to-r from-amber-400 to-orange-500' : ''} />
            </div>
          )
        }
        if (fx.kind === 'grand') {
          return (
            <div key={fx.id} className="absolute" style={{ left: fx.x, top: fx.y }}>
              <GrandPrize rank={fx.rank} title={fx.title} subtitle={fx.subtitle} width={fx.width} height={fx.height} duration={GRAND_MS} />
            </div>
          )
        }
        if (fx.kind === 'rain') {
          return (
            <div key={fx.id} className="absolute" style={{ left: fx.x, top: fx.y }}>
              <ConfettiRain width={fx.width} height={Math.max(fx.height, 220)} count={44} />
            </div>
          )
        }
        if (fx.kind === 'endless') {
          const burst = endlessArt('transition-burst')
          return (
            <div key={fx.id} data-fx-endless className="absolute" style={{ left: fx.x, top: fx.y }}>
              {burst && <img src={burst.url} alt="" draggable={false} className="absolute max-w-none play-fx-endless-burst" style={{ width: fx.size, height: fx.size, left: -fx.size / 2, top: -fx.size / 2, objectFit: 'contain', animationDuration: `${ENDLESS_MS}ms` }} />}
              <div className="absolute play-fx-endless-plate" style={{ animationDuration: `${ENDLESS_MS}ms` }}>
                <EndlessNameplate height={64} />
              </div>
            </div>
          )
        }
        const art = rewardArt(fx.type, Math.min(fx.rank, REWARD_MAX_RANK))
        const abundance = fx.endless && fx.rank >= REWARD_MAX_RANK ? endlessArt('reward-burst') : null
        return (
          <div key={fx.id} data-fx-payout={fx.type} className="absolute play-fx-payout" style={{ left: fx.x, top: fx.y, animationDuration: `${PAYOUT_MS}ms`, animationDelay: `${fx.delay ?? 0}ms` }}>
            {abundance && <img src={abundance.url} alt="" draggable={false} data-fx-abundance className="absolute left-1/2 top-1/2 w-36 max-w-none -translate-x-1/2 -translate-y-1/2 -z-10 opacity-95" />}
            <div className="flex items-center gap-1.5 rounded-full bg-white/95 border-2 border-amber-300 shadow-lg shadow-amber-900/20 pl-1.5 pr-3 py-1 whitespace-nowrap">
              {art && <img src={art.url} alt="" draggable={false} className="w-8 h-8 object-contain" />}
              <span className="font-display text-base font-bold text-amber-700">+{formatRewardAmount(fx.type, fx.amount, { unit: true })}</span>
              {fx.rank >= REWARD_MAX_RANK && <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{REWARD_TYPE_LABELS[fx.type]} collected</span>}
            </div>
          </div>
        )
      })}
    </div>
  )

  return { layer, arriving, popping, boardFx, dragged }
}
