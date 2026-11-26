// Formatting and small helpers shared by the Puzzle screens.

export const td = 'whitespace-nowrap border-b border-slate-100 px-2 py-1 tabular-nums'
export const fmt = (x: number | null | undefined, d = 0) => (x == null || !Number.isFinite(x) ? '–' : x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }))
export const pct = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? '–' : `${(x * 100).toFixed(d)}%`)

/** Paste a column (or row) of numbers from a spreadsheet: tabs, new lines, commas or spaces. */
export function parsePasted(text: string): number[] {
  return text
    .split(/[\t\r\n;]+|\s{2,}/)
    .map((s) => s.trim().replace(/%$/, ''))
    .filter(Boolean)
    .map((s) => Number(s.replace(/,/g, '')))
}

/** Paths whose value differs between two events (for "what changed since the last revision"). */
export function changedPaths(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
  if (out.length > 40) return out
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(path || '(all)')
    return out
  }
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)])
  for (const k of keys) changedPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k, out)
  return out
}

