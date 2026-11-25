// Which screen a URL shows. Pure, so it can be tested without a browser.
//
//   /                       home: the catalog (?q=<search>&folder=<all|unfiled|folder id>)
//   /models/<slug>          a model's page (unknown slugs get their own state)
//   /browser-data           the data kept in this browser (moved off the home page)
//   ?s=, ?play, ?plan       Merge Mania's shared play and plan links, on any path:
//                           links already sent out must keep opening.
// Paths here are app paths; the site's base (/EcoSystem/) is added and removed
// by router.ts.

export type Route =
  | { name: 'home' }
  | { name: 'model'; slug: string }
  | { name: 'browser-data' }
  | { name: 'play-link' }
  | { name: 'plan-link' }
  | { name: 'not-found' }

export function parseRoute(appPath: string, search: string): Route {
  const params = new URLSearchParams(search)
  if (params.has('play') || params.has('s')) return { name: 'play-link' }
  if (params.has('plan')) return { name: 'plan-link' }

  const parts = appPath.split('/').filter(Boolean)
  if (parts.length === 0) return { name: 'home' }
  if (parts[0] === 'models' && parts.length === 2) return { name: 'model', slug: decodeURIComponent(parts[1]!) }
  if (parts[0] === 'browser-data' && parts.length === 1) return { name: 'browser-data' }
  return { name: 'not-found' }
}

export const modelPath = (slug: string) => `/models/${encodeURIComponent(slug)}`

/** Strips the site's base: ('/EcoSystem/models/chef', '/EcoSystem/') -> '/models/chef'. */
export function appPathOf(pathname: string, base: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base
  if (b && (pathname === b || pathname.startsWith(`${b}/`))) return pathname.slice(b.length) || '/'
  return pathname || '/'
}

/** Adds the site's base: ('/models/chef', '/EcoSystem/') -> '/EcoSystem/models/chef'. */
export function browserPathOf(appPath: string, base: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base
  return `${b}${appPath.startsWith('/') ? appPath : `/${appPath}`}`
}
