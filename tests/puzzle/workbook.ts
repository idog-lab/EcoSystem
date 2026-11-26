// The economist's workbook, extracted to reference/puzzle-workbook.json by
// scripts/puzzle/extract-workbook.py. It is never committed (reference/ is
// ignored, like the workbook itself), so the parity suites skip themselves
// when it is not on this machine - and say so.
import fs from 'node:fs'
import path from 'node:path'
import { createDefaultEvent, type PuzzleEvent } from '../../src/features/puzzle/engine/model'

const FILE = path.resolve(import.meta.dirname, '../../reference/puzzle-workbook.json')
export const hasWorkbook = fs.existsSync(FILE)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const workbook: any = hasWorkbook ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null

/** The workbook's own event: two weeks, 13 days from 17 Nov 2026, standard mode. */
export function workbookEvent(): PuzzleEvent {
  const ev = createDefaultEvent({ name: 'Workbook copy for cc BF', start: '2026-11-17T10:00', length: 'two-weeks' })
  return ev
}
