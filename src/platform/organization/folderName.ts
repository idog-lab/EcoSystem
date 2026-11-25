// Folder-name rules, shared by the browser (instant feedback) and the server
// (the authority). Pure: no React, no browser APIs.

export const FOLDER_NAME_MAX = 60

export type FolderNameCheck =
  | { ok: true; name: string; nameKey: string }
  | { ok: false; reason: 'blank' | 'too-long'; message: string }

/** The key two folder names are compared by: trimmed, case-insensitive. */
export function folderNameKey(name: string): string {
  return name.trim().toLocaleLowerCase('en')
}

export function checkFolderName(raw: unknown): FolderNameCheck {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!name) return { ok: false, reason: 'blank', message: 'A folder needs a name.' }
  if (name.length > FOLDER_NAME_MAX) {
    return { ok: false, reason: 'too-long', message: `A folder name can be at most ${FOLDER_NAME_MAX} characters.` }
  }
  return { ok: true, name, nameKey: folderNameKey(name) }
}
