// THE GOOGLE SHEETS OUTPUT, as a plan of cell writes into a COPY of the
// economist's template for the event's mode. Pure: the same event gives the
// same plan; the adapter (export/googleExport.ts) only copies the template and
// sends these writes. Ranges, headers and orders are the templates' own,
// read from them on 26 Nov 2026:
//   Price Cut  https://docs.google.com/spreadsheets/d/1fMXPXA7fy_B35rfxTD-ZIICsqZFeRRsxvQW-MwolFnM
//   Maleficent https://docs.google.com/spreadsheets/d/1XZMnmcXAeC5w8GRaMUkYwiiXIWzIxHy6YcHtXfl5SGc
// Only mapped output ranges are written; every other cell of the copy
// (formatting, headers, Gallery/Collection texts, template ids) stays as the
// template has it. Event Data is written only where the economist typed an
// override - the two templates have different keys, never normalised.

import type { PuzzleResults } from './compute'
import { MAX_PIECES, REGULAR_SEGMENTS, RC_SEGMENTS, type PuzzleEvent } from './model'
import { boardOrder } from './shuffle'
import { FIRST_PUZZLE, firstPuzzleDefinition, rcSegmentRows, regularDefinition, regularKey } from './segments'

export type Cell = string | number | boolean
export type CellWrite = { range: string; values: Cell[][] }
export type TemplateKind = 'price-cut' | 'maleficent'

export const TEMPLATES: Record<TemplateKind, { id: string; url: string; sheets: string[] }> = {
  'price-cut': {
    id: '1fMXPXA7fy_B35rfxTD-ZIICsqZFeRRsxvQW-MwolFnM',
    url: 'https://docs.google.com/spreadsheets/d/1fMXPXA7fy_B35rfxTD-ZIICsqZFeRRsxvQW-MwolFnM/edit',
    sheets: ['Segments', 'Event Data', ...seg('Seg'), 'RC Segments', 'RC Eco', 'Gallery Dynamic Elements', 'Collection Dynamic Elements', 'Puzzle DR Name'],
  },
  maleficent: {
    id: '1XZMnmcXAeC5w8GRaMUkYwiiXIWzIxHy6YcHtXfl5SGc',
    url: 'https://docs.google.com/spreadsheets/d/1XZMnmcXAeC5w8GRaMUkYwiiXIWzIxHy6YcHtXfl5SGc/edit',
    sheets: ['Segments', 'Event Data', ...seg('Seg'), 'RC Segments', ...segRc(), 'Wheel Wedges', 'Wheel Buckets', 'Wheel Layouts', 'Wheel Multiplier'],
  },
}
function seg(prefix: string) {
  return Array.from({ length: REGULAR_SEGMENTS }, (_, i) => `${prefix} ${i + 1}`)
}
function segRc() {
  return Array.from({ length: RC_SEGMENTS }, (_, i) => `RC Seg ${i + 1}`)
}

/** Event Data rows of each template (key -> row), as the templates hold them. */
export const EVENT_DATA_ROWS: Record<TemplateKind, string[]> = {
  'price-cut': ['Gallery_Template_Id', 'Collection_Template_Id', 'Base_Template_Id', 'Dynamic_Resource_Key'],
  maleficent: [
    'Base Template Id', 'Dynamic Resource Key', 'Boss Template Id', 'Has Puzzle Boss', 'Load Boss Popup Id', 'Unload Boss Popup Id', 'Boss Intro Popup Id',
    'Multiplier Mode 1 multiplication', 'Multiplier Mode 2 multiplication', 'Multiplier Mode 3 multiplication', 'Multiplier Mode 4 multiplication',
    'Start Level Badge Position', 'Start Level Badge Order', 'Multiplier Mode 1 Asset', 'Multiplier Mode 2 Asset', 'Multiplier Mode 3 Asset', 'Multiplier Mode 4 Asset',
    'Multiplier Mode 1 Boss Asset', 'Multiplier Mode 2 Boss Asset', 'Multiplier Mode 3 Boss Asset', 'Multiplier Mode 4 Boss Asset',
  ],
}

const COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const col = (i: number) => (i < 26 ? COLS[i]! : COLS[Math.floor(i / 26) - 1]! + COLS[i % 26]!)
const q = (sheet: string) => `'${sheet.replace(/'/g, "''")}'`
const pad = (row: Cell[], width: number) => [...row, ...Array.from({ length: Math.max(0, width - row.length) }, () => '' as Cell)]
const ymd = (iso: string) => iso.slice(0, 10).replace(/-/g, '')

export function endDate(ev: PuzzleEvent): string {
  const d = new Date(`${ev.setup.start.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + ev.setup.days - 1)
  return d.toISOString().slice(0, 10)
}

/** The file name rule of both templates: t_Puzzle|n_<name>|ds_<start>|de_<last day>. */
export function exportTitle(ev: PuzzleEvent): string {
  return `t_Puzzle|n_${ev.setup.name.replace(/\|/g, '')}|ds_${ymd(ev.setup.start)}|de_${ymd(endDate(ev))}`
}

export const templateFor = (ev: PuzzleEvent): TemplateKind | null =>
  ev.setup.mode === 'price-cut' ? 'price-cut' : ev.setup.mode === 'maleficent' ? 'maleficent' : null

const items = (order: readonly number[], costs: readonly number[]) => boardOrder(order, costs.length).map((id) => costs[id - 1]!)
const layoutCell = (v: string): Cell => (/^\d+$/.test(v) ? Number(v) : v)

/** `clears` are emptied first (rows a shorter list would otherwise leave from the template's old event). */
export type ExportPlan = { template: TemplateKind; title: string; clears: string[]; writes: CellWrite[]; problems: string[] }

export function buildExportPlan(ev: PuzzleEvent, r: PuzzleResults): ExportPlan | { template: null; problems: string[] } {
  const template = templateFor(ev)
  const problems = r.problems.filter((p) => p.level === 'block').map((p) => p.text)
  if (!template)
    return { template: null, problems: ['A Standard event has no approved Google Sheets template yet (only Price Cut and Maleficent were given). Use the config preview.', ...problems] }
  if (ev.segmentation.firstPuzzle.length === 0)
    problems.push('First-puzzle time rules have no dates for this event: the template still holds an old event\'s. Add them in Event mechanics.')
  const writes: CellWrite[] = []
  const clears: string[] = [`${q('Segments')}!A${3 + REGULAR_SEGMENTS}:C60`]
  const w = (sheet: string, a1: string, values: Cell[][]) => writes.push({ range: `${q(sheet)}!${a1}`, values })

  // Segments: returning players, first_puzzle, the first-puzzle time rules.
  const bounds = ev.segmentation.membershipMax
  w('Segments', `A2:B${1 + REGULAR_SEGMENTS}`, Array.from({ length: REGULAR_SEGMENTS }, (_, i) => [regularKey(i + 1), regularDefinition(bounds, i + 1)]))
  w('Segments', `A${2 + REGULAR_SEGMENTS}:B${2 + REGULAR_SEGMENTS}`, [[FIRST_PUZZLE.key, FIRST_PUZZLE.definition]])
  if (ev.segmentation.firstPuzzle.length) {
    const r0 = 3 + REGULAR_SEGMENTS
    w('Segments', `A${r0}:C${r0 + ev.segmentation.firstPuzzle.length - 1}`, ev.segmentation.firstPuzzle.map((f) => [f.key, firstPuzzleDefinition(f.from, f.to), f.economySegmentNote]))
  }
  w('RC Segments', `A2:B${1 + RC_SEGMENTS}`, rcSegmentRows(ev).map((s) => [s.key, s.definition]))

  const rows = EVENT_DATA_ROWS[template]
  for (const [key, value] of Object.entries(ev.templates.eventData)) {
    const i = rows.indexOf(key)
    if (i < 0) problems.push(`Event Data: "${key}" is not a row of the ${template === 'price-cut' ? 'Price Cut' : 'Maleficent'} template.`)
    else w('Event Data', `B${i + 2}`, [[value]])
  }

  if (template === 'price-cut') {
    for (const seg of r.regular) {
      const base = seg.tiers.map((t, i) => pad([`Tier ${t.tier}`, seg.rewards[i]!.syntax, ...items(ev.order.regular, seg.pieces.filter((p) => p.tier === t.tier).map((p) => p.baseCost))], 26))
      const cut = seg.tiers.map((t, i) => pad([`Tier ${t.tier}`, seg.rewards[i]!.syntax, ...items(ev.order.regular, seg.pieces.filter((p) => p.tier === t.tier).map((p) => p.cost))], 26))
      w(`Seg ${seg.segment}`, 'A2:Z7', base)
      w(`Seg ${seg.segment}`, 'A12:Z17', cut)
    }
    r.rc.forEach((s, n) => {
      const r0 = 1 + 8 * n
      const order = ev.order.rc[n] ?? []
      w('RC Eco', `A${r0}`, [[s.key]])
      w('RC Eco', `C${r0 + 2}:Z${r0 + 2}`, [order.slice(0, MAX_PIECES)])
      w('RC Eco', `A${r0 + 3}:AB${r0 + 5}`, s.tiers.map((t) => [...pad([`Tier ${t.tier}`, t.syntax, ...t.ordered.map((p) => p.cost)], 27), t.total]))
    })
    w('Puzzle DR Name', 'A2', [[ev.rewards.drName]])
  } else {
    const row = (tier: number, syntax: string, costs: number[], order: readonly number[], boss: PuzzleResults['regular'][number]['boss'], wheel: PuzzleEvent['maleficent']['regularWheel']) => {
      const b = boss?.[tier - 1]
      const wh = wheel[tier - 1]
      const on = !!b?.active
      return pad(
        [
          `Tier ${tier}`,
          on && b?.bossBar != null ? b.bossBar : '',
          on ? b!.buckets : '',
          on ? (wh?.extraBuckets ?? '') : '',
          on && wh?.wheelLayout ? layoutCell(wh.wheelLayout) : '',
          on && wh?.extraWheelLayout ? layoutCell(wh.extraWheelLayout) : '',
          on ? (wh?.wheelMultiplier ?? '') : '',
          on ? b!.removedItems : '',
          on ? (wh?.bossReward ?? '') : '',
          syntax,
          ...items(order, costs),
        ],
        34,
      )
    }
    for (const seg of r.regular)
      w(`Seg ${seg.segment}`, 'A3:AH8', seg.tiers.map((t, i) => row(t.tier, seg.rewards[i]!.syntax, seg.pieces.filter((p) => p.tier === t.tier).map((p) => p.cost), ev.order.regular, seg.boss, ev.maleficent.regularWheel)))
    for (const s of r.rc)
      w(`RC Seg ${s.segment}`, 'A3:AH5', s.tiers.map((t) => row(t.tier, t.syntax, t.costs, ev.order.rc[s.segment - 1] ?? [], s.boss, ev.maleficent.rcWheel)))
    const m = ev.maleficent
    if (m.wedges.length) clears.push(`${q('Wheel Wedges')}!A2:E200`)
    if (m.buckets.length) clears.push(`${q('Wheel Buckets')}!A2:B200`)
    if (m.layouts.length) clears.push(`${q('Wheel Layouts')}!A2:M200`)
    if (m.multipliers.length) clears.push(`${q('Wheel Multiplier')}!A2:G200`)
    if (m.wedges.length) w('Wheel Wedges', `A2:E${1 + m.wedges.length}`, m.wedges.map((x) => [x.id, x.name, x.value, x.visualVariant, x.stingerId]))
    if (m.buckets.length) w('Wheel Buckets', `A2:B${1 + m.buckets.length}`, m.buckets.map((b) => [b.id, b.wedges]))
    if (m.layouts.length) w('Wheel Layouts', `A2:M${1 + m.layouts.length}`, m.layouts.map((l) => pad([layoutCell(l.id), ...l.wedges], 13)))
    if (m.multipliers.length)
      w('Wheel Multiplier', `A2:G${1 + m.multipliers.length}`, m.multipliers.map((x) => [x.multiplier, x.light, x.mid, x.dark, x.text, x.locked, x.defaultLadder]))
  }
  return { template, title: exportTitle(ev), clears, writes, problems }
}
