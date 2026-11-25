import { lazy, Suspense } from 'react'
import { useLocation } from '../routing/router'
import { parseRoute } from '../routing/routes'
import HomePage from '../catalog/HomePage'
import ModelRoute from './ModelRoute'
import { MessagePage } from './MessagePage'

// The top of the app: which screen the URL shows (routing/routes.ts).
// Merge Mania's shared links (?s=, ?play, ?plan) keep opening exactly as
// before; they are loaded only when used.
const PlayLink = lazy(() => import('../../App.jsx').then((m) => ({ default: m.PlayApp })))
const PlanLink = lazy(() => import('../../App.jsx').then((m) => ({ default: m.PlanApp })))
const BrowserData = lazy(() => import('./BrowserDataPage'))

const loading = <MessagePage title="Loading…" text="" quiet />

export default function PlatformApp() {
  const { path, search } = useLocation()
  const route = parseRoute(path, search)
  switch (route.name) {
    case 'play-link':
      return <Suspense fallback={loading}><PlayLink /></Suspense>
    case 'plan-link':
      return <Suspense fallback={loading}><PlanLink /></Suspense>
    case 'home':
      return <HomePage />
    case 'model':
      return <ModelRoute key={route.slug} slug={route.slug} />
    case 'browser-data':
      return <Suspense fallback={loading}><BrowserData /></Suspense>
    case 'not-found':
      return <MessagePage title="Page not found" text="This address does not lead anywhere in the toolkit." />
  }
}
