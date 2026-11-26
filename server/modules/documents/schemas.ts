import type { z } from 'zod'
import { PUZZLE_SCHEMA_VERSION, puzzleEventSchema } from '../../../src/features/puzzle/engine/schema'

// Which models can save documents, and the exact shape of what they save.
//
// Puzzle is the first model stored centrally: its event (src/features/puzzle/
// engine/schema.ts, from the workbook's real inputs). The older tools (Merge
// Mania, Chef, Diamond Mine, Economy) still keep their work in the browser,
// and Momentum and Challenge have no model yet. A schema is added here when a
// model is migrated - from that model's real data, never invented. Until then
// the API refuses its documents ("no_schema"). Tests pass their own registry.

export type PayloadSchema = { schemaVersion: number; schema: z.ZodType }
export type PayloadSchemaRegistry = Readonly<Record<string, PayloadSchema | undefined>>

export const DOCUMENT_SCHEMAS: PayloadSchemaRegistry = {
  puzzle: { schemaVersion: PUZZLE_SCHEMA_VERSION, schema: puzzleEventSchema },
}
