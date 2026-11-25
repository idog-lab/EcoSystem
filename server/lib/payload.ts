import { ApiError } from '../http/errors'
import type { PayloadSchemaRegistry } from '../modules/documents/schemas'

/** Validates a payload against the registered schema of `key` (a model id or an assumption key). */
export function validatePayload(registry: PayloadSchemaRegistry, key: string, schemaVersion: number, payload: unknown, what: string) {
  const entry = registry[key]
  if (!entry) throw new ApiError(422, 'no_schema', `${what} cannot be saved yet: it has no saved-data format (not migrated).`)
  if (schemaVersion !== entry.schemaVersion) {
    throw new ApiError(422, 'validation', `${what} is saved in format version ${entry.schemaVersion}, not ${schemaVersion}.`)
  }
  const parsed = entry.schema.safeParse(payload)
  if (!parsed.success) {
    throw new ApiError(422, 'validation', parsed.error.issues.map((i) => `${i.path.join('.') || 'payload'}: ${i.message}`).join('; '))
  }
  return parsed.data as unknown
}
