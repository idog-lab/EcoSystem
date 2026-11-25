// Talks to the toolkit server (/api, proxied by Vite in development). The
// static site can be served without it: then `unavailable` is reported and
// the home page still works, without shared folders.

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api'

export type ApiFailure = {
  ok: false
  status: number
  /** Server error code ('conflict', 'duplicate_name', ...) or 'unavailable' when the server cannot be reached. */
  code: string
  message: string
  current?: unknown
}
export type ApiSuccess<T> = { ok: true; status: number; data: T; etag: string | null }
export type ApiResult<T> = ApiSuccess<T> | ApiFailure

export async function api<T>(
  path: string,
  { method = 'GET', body, headers = {} }: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    return { ok: false, status: 0, code: 'unavailable', message: 'The toolkit server cannot be reached.' }
  }
  if (res.status === 304) return { ok: true, status: 304, data: null as T, etag: res.headers.get('ETag') }
  const isJson = (res.headers.get('Content-Type') ?? '').includes('application/json')
  if (!isJson) return { ok: false, status: res.status, code: 'unavailable', message: 'The toolkit server is not running here.' }
  const payload = (await res.json().catch(() => null)) as { error?: { code: string; message: string; current?: unknown } } | null
  if (!res.ok) {
    const err = payload?.error
    return { ok: false, status: res.status, code: err?.code ?? 'internal', message: err?.message ?? 'Something went wrong.', current: err?.current }
  }
  return { ok: true, status: res.status, data: payload as T, etag: res.headers.get('ETag') }
}
