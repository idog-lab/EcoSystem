import { useSyncExternalStore } from 'react'
import { appPathOf, browserPathOf } from './routes'

// A small history-API router: the site is static (it may be served from a
// sub-path, import.meta.env.BASE_URL), so routes are plain paths under it.

const BASE = import.meta.env.BASE_URL
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

const snapshot = () => `${window.location.pathname}${window.location.search}`

export function useLocation() {
  useSyncExternalStore(subscribe, snapshot)
  return { path: appPathOf(window.location.pathname, BASE), search: window.location.search }
}

export type NavigateOptions = { replace?: boolean; state?: Record<string, unknown> }

/** `to` is an app path, optionally with a query: '/models/chef', '/?q=che'. */
export function navigate(to: string, { replace = false, state }: NavigateOptions = {}) {
  const url = browserPathOf(to, BASE)
  if (replace) window.history.replaceState(state ?? window.history.state, '', url)
  else window.history.pushState(state ?? null, '', url)
  notify()
}

export const hrefOf = (to: string) => browserPathOf(to, BASE)

/** Back to the home page as the user left it (search and folder), else to All models. */
export function goHome() {
  const state = window.history.state as { fromHome?: boolean } | null
  if (state?.fromHome) window.history.back()
  else navigate('/')
}
