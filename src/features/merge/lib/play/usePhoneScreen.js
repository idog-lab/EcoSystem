import { useEffect, useState } from 'react'

// A shared stage is mostly opened on a phone, held sideways (the economist:
// "the stage share is mostly to be used on the phone. prefered landscaped").
// The play screen therefore has a layout of its own for that case, and it has
// to be chosen in code, not only in CSS: on a sideways phone the inventory and
// the controls sit beside the board instead of under it.
//
//   sideways  a short, wide screen - a phone held sideways. Keyed on HEIGHT,
//             so a maximised desktop window (also "landscape", never short)
//             keeps the roomy layout. The same condition index.css uses.
//   upright   a narrow touch screen held upright - it still plays, and is
//             told that sideways is better.
export const PHONE_SIDEWAYS_QUERY = '(orientation: landscape) and (max-height: 500px)'
const PHONE_UPRIGHT_QUERY = '(orientation: portrait) and (max-width: 640px)'

function read() {
  if (typeof window === 'undefined' || !window.matchMedia) return { sideways: false, upright: false }
  const touch = (navigator.maxTouchPoints ?? 0) > 0
  return {
    sideways: window.matchMedia(PHONE_SIDEWAYS_QUERY).matches,
    upright: touch && window.matchMedia(PHONE_UPRIGHT_QUERY).matches,
  }
}

export function usePhoneScreen() {
  const [screen, setScreen] = useState(read)
  useEffect(() => {
    const update = () =>
      setScreen((prev) => {
        const next = read()
        return prev.sideways === next.sideways && prev.upright === next.upright ? prev : next
      })
    const queries = [window.matchMedia(PHONE_SIDEWAYS_QUERY), window.matchMedia(PHONE_UPRIGHT_QUERY)]
    for (const q of queries) q.addEventListener?.('change', update)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    update()
    return () => {
      for (const q of queries) q.removeEventListener?.('change', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])
  return screen
}

// Full screen, where the browser has it (Android; not Safari on an iPhone),
// and the screen turned sideways with it where that can be asked for.
export function canGoFullscreen() {
  return typeof document !== 'undefined' && !!document.documentElement?.requestFullscreen && document.fullscreenEnabled !== false
}

export async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return
    }
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    await window.screen?.orientation?.lock?.('landscape')
  } catch {
    // Not allowed here (or the orientation cannot be locked): the page just
    // stays as it is.
  }
}

export function useIsFullscreen() {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement)
  useEffect(() => {
    const update = () => setOn(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])
  return on
}
