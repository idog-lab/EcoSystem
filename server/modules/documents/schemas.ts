import type { z } from 'zod'

// Which models can save documents, and the exact shape of what they save.
//
// EMPTY ON PURPOSE. No model has been migrated to central storage yet: the
// existing tools (Merge Mania, Chef, Diamond Mine, Economy) still keep their
// work in the browser, and Momentum, Challenge and Puzzle have no model at
// all. A schema is added here when a model is migrated - from that model's
// real data, never invented. Until then the API refuses its documents
// ("no_schema"). Tests pass their own registry.

export type PayloadSchema = { schemaVersion: number; schema: z.ZodType }
export type PayloadSchemaRegistry = Readonly<Record<string, PayloadSchema | undefined>>

export const DOCUMENT_SCHEMAS: PayloadSchemaRegistry = {}
