import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError } from 'zod'

// One error shape for every API response:
//   { error: { code, message, current? } }
// `current` carries the server's version of a record on a conflict, so the
// client can show it without throwing away what the user typed.

export type ErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'unknown_model'
  | 'validation'
  | 'invalid_folder'
  | 'invalid_revision'
  | 'duplicate_name'
  | 'conflict'
  | 'no_schema'
  | 'unsupported_media_type'
  | 'bad_origin'
  | 'internal'

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly current?: unknown,
  ) {
    super(message)
  }
}

export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} was not found.`)
export const conflict = (message: string, current: unknown) => new ApiError(409, 'conflict', message, current)

export function errorResponse(err: unknown, c: Context) {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message, ...(err.current !== undefined ? { current: err.current } : {}) } }, err.status)
  }
  if (err instanceof ZodError) {
    return c.json({ error: { code: 'validation', message: err.issues.map((i) => i.message).join('; ') } }, 400)
  }
  console.error(err)
  return c.json({ error: { code: 'internal', message: 'Something went wrong on the server.' } }, 500)
}
