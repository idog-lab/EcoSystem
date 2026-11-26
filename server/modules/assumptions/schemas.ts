import type { PayloadSchemaRegistry } from '../documents/schemas'
import { progressQuantilesSchema } from '../../../src/features/puzzle/engine/schema'

// Shared assumption sets (values several models read), by key.
//
// EMPTY ON PURPOSE, like DOCUMENT_SCHEMAS: the economy's value table still
// lives in the browser (src/lib/economy/economyStore.js). A key is added here
// when it is migrated, with its real shape. Which models read which set is
// declared by those models when they are migrated - never inferred from
// workbook sheet names.
export const ASSUMPTION_SCHEMAS: PayloadSchemaRegistry = {
  // Puzzle's player simulator: the progression quantiles of a past event, typed
  // or imported by the economist with their source. Read only by Puzzle.
  'puzzle-progress-quantiles': { schemaVersion: 1, schema: progressQuantilesSchema },
}
