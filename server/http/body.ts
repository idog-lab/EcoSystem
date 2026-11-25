import type { Context } from 'hono'
import type { z } from 'zod'
import { ApiError } from './errors'

/** Reads a JSON body and validates it; a bad body is a 400, never a crash. */
export async function readBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new ApiError(400, 'validation', 'The request body must be JSON.')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new ApiError(400, 'validation', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '))
  }
  return parsed.data
}
