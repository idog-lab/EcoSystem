import type { ModelEntry } from '../registry/types'
import type { HomeQuery } from './homeQuery'

// Search matches the display name ONLY: the query is trimmed and compared
// without case, as a substring. Search and folder combine with AND.

export const normalizeQuery = (q: string) => q.trim().toLocaleLowerCase('en')

export function nameMatches(displayName: string, q: string): boolean {
  const needle = normalizeQuery(q)
  return needle === '' || displayName.toLocaleLowerCase('en').includes(needle)
}

/** `folderOf(modelId)`: the folder a model is in, or null when Unfiled. */
export function filterModels<M extends Pick<ModelEntry, 'id' | 'displayName'>>(
  models: readonly M[],
  { q, folder }: HomeQuery,
  folderOf: (modelId: string) => string | null,
): M[] {
  return models.filter((m) => {
    if (!nameMatches(m.displayName, q)) return false
    if (folder.kind === 'unfiled') return folderOf(m.id) === null
    if (folder.kind === 'folder') return folderOf(m.id) === folder.id
    return true
  })
}
