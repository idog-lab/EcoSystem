// The shape of the model catalog. Pure data: imported by the browser AND the
// server, so nothing here may import React or browser APIs.

/** Icons the catalog may name. The UI maps each key to a drawing (ModelIcon). */
export const ICON_KEYS = ['layers', 'gem', 'chef-hat', 'coins', 'gauge', 'trophy', 'puzzle'] as const
export type IconKey = (typeof ICON_KEYS)[number]

/**
 * Where a model's design comes from in the economist's workbook.
 * `stated`: given to us in so many words. `name-unverified`: the brief says
 * the model has a sheet family of its own, but the exact family name has not
 * been checked against the workbook. Nothing here is inferred from sheet
 * names, and no economic dependency between models follows from it.
 */
export type SourceReference = {
  kind: 'workbook-sheet-family'
  family: string
  status: 'stated' | 'name-unverified'
}

export type ModelStatus =
  /** An implementation exists in this app and opens on its page. */
  | 'available'
  /** Listed in the catalog; the page says "Model not migrated yet". */
  | 'not-migrated'

export type ModelEntry = {
  /** Stable id: stored in the database (placements, documents). Never change it. */
  id: string
  /** Stable URL segment: /models/<slug>. Never change it. */
  slug: string
  displayName: string
  iconKey: IconKey
  /** Which lazy-loaded page module renders the model (src/platform/registry/modules.ts). */
  moduleKey: string
  status: ModelStatus
  sources: readonly SourceReference[]
  /** Said wherever sources are shown when there is no verified mapping. */
  sourceNote?: string
}
