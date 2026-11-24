import { ExportGate } from '../build/DesignStatus'
import { Fragment, useState } from 'react'
import { FileCode2, Copy, Check, Download, FileSpreadsheet, TriangleAlert } from 'lucide-react'
import Card from '../../../../components/ui/Card'
import Button from '../../../../components/ui/Button'
import { boardsToSyntax, boardsSuggestionsToSyntax } from '../../lib/export/boardSyntax'
import {
  buildEventDataSheet,
  buildMultipliersSheet,
  buildGeneratorWeightsSheet,
  buildBlockedQueueSheet,
  buildItemLadderSheet,
  buildSmallRewardsSheet,
  buildSmallRewardsBankSheet,
  buildSmallRewardWeightsSheet,
  buildEndlessBankSheet,
  buildEndlessWeightsSheet,
  buildV2EndlessSheet,
  buildBoardLayoutsSheet,
  boardLayoutsSheetToTsv,
  sheetToTsv,
  buildWorkbook,
  buildAllSheetsAsValueRows,
  buildAllSegmentsWorkbook,
  buildAllSegmentsSheetsAsValueRows,
} from '../../lib/export/eventSheets'
import { createGoogleSheet } from '../../lib/export/googleSheetsExport'
import { rewardTextIssues, REWARD_TYPE_LABELS } from '../../lib/rewards/rewardChain'

// Ordered to match the workbook's own tab order (eventSheets.js's
// buildWorkbook), which in turn matches the economist's reference
// spreadsheet - so switching tabs here walks the same sequence as scrolling
// the real sheet. Normal/CC (the older boardSyntax.js placeholder export)
// stay pinned in front, outside that sequence.
const VIEWS = [
  { id: 'normal', label: 'Normal' },
  { id: 'cc', label: 'CC' },
  { id: 'event-data', label: 'Event Data' },
  { id: 'multipliers', label: 'Multipliers' },
  { id: 'board-layouts', label: 'Board Layouts' },
  { id: 'recompletion-board-layouts', label: 'Recompletion Board Layouts' },
  { id: 'generator-weights', label: 'Generator Weights' },
  { id: 'blocked-queue', label: 'Blocked Queue' },
  { id: 'item-ladder', label: 'Item Ladder' },
  { id: 'small-rewards', label: 'Small Rewards' },
  { id: 'small-rewards-bank', label: 'Small Rewards Bank' },
  { id: 'small-reward-weights', label: 'Small Reward Weights' },
  { id: 'endless-small-rewards-bank', label: 'Endless Small Rewards Bank' },
  { id: 'endless-small-reward-weights', label: 'Endless Small Reward Weights' },
  // Only the pages of the economist's example, plus endless mode's three
  // (kept by the economist). "V2 Reward Chain", "V2 Drop Groups", "V2 Economy"
  // and "V2 Twister" were removed (economist: "remove the reward chain, drop
  // groups, twister, and economy"), and no page is named "V2" any more.
  { id: 'endless', label: 'Endless' },
]

const DESCRIPTIONS = {
  normal: "Every board's actual saved config, in play order — board pushes, semi placements, and blocked queue sequences, everything currently configured. What the whole list shares (the lucky-drop EV, the rank rewards) is said once, at the top.",
  cc: "CC Management's suggestions in the same format — +30%/+50% bigger-wave queues per board, and the +8%/+12% lucky-drop EV bumps once (they are the same for every board).",
  'event-data':
    "The real Ops \"Event Data\" sheet. Every value is a fixed constant for this event except TutorialDrAmount, which tracks Board 1's own onboarding-goal DR amount.",
  multipliers:
    'The real Ops "Multipliers" sheet — one row per generator tier (x1/x2/x4). Unlock Tier is each tier\'s own unlock rank; Lucky Drop Threshold is one rank above the tier\'s normal output (x1→2, x2→3, x4→4).',
  'generator-weights':
    "The real Ops \"Generator Weights\" sheet — one row per (rank, tier) combo where that tier is unlocked, using Board 1's own lucky-drop target EV. Whole-number weights out of 1000, landing on T(normalRank)/T(normalRank+1)/T(normalRank+2); rows below a tier's Lucky Drop Threshold carry the normal weight only. Runs to rank 14, in rows and in columns (T13 and T14 are always 0 - the generator never makes them): ranks 13 and 14 are Recompletion's, written with the Recompletion list's own lucky-drop EV and multiplier unlock ranks.",
  'blocked-queue':
    'The real Ops "Blocked Queue" sheet — every board\'s blockedQueue, in play order, combined into one continuous pool table: the normal boards first, then the Recompletion boards straight after them, with the Entry Number carrying on (they happen one after the other in the same event). A deliberately simplified case of the source sheet\'s weighted-loot-pool format: one trivial pool per entry (no alternatives), Item is the plain item rank, Stock and Weight both fixed at 1.',
  'item-ladder':
    'The real Ops "Item Ladder" sheet — one row per rank 1-14, the normal ladder and Recompletion\'s together: ranks 1 to 12 use the normal list\'s milestone rewards, ranks 13 and 14 the Recompletion list\'s. Milestone Reward Syntax is populated only for ranks marked as reward ranks there, with whatever syntax was typed for them.',
  'board-layouts':
    "The real Ops \"Board Layouts\" sheet — one Section per board, in play order. B/S/E are each tile's blocked/semi/open state; a semi tile also carries its own item rank (e.g. \"S:2\"), read off that board's generated placements.",
  'recompletion-board-layouts':
    'Same shape as Board Layouts, but for the separate Recompletion board list (the "Recompletion" tab) — the board(s) a player cycles through after reaching the event\'s Last Tier.',
  'small-rewards':
    'The real Ops "Small Rewards" sheet — one row per reward-chain key (coin/dr/puzzle/charm, rank 1-4), driven by the Rewards tab\'s own reward-chain config (syntax, Asset ID, prize). Seeded with the economist\'s real reference values, fully editable from there. The dr-twister rows (when the drops carry Twister items) are written as [dynamic(dr-twister:value)] unless a syntax was typed in the Twister tool - "dr-twister" is this tool\'s own name, NOT a confirmed Ops one.',
  'small-rewards-bank':
    'The Ops "Small Rewards Bank" sheet — the containers a merge can drop in the normal event, followed by any container only the rank 13 and 14 merges drop. Each container is one drop the model built and plays (Build event), named ContA, ContB, ... and written in the Small Rewards keys above (coin-r1+dr-r1 = a coin rank 1 and a merge energy rank 1 dropping together). Every container is a different drop.',
  'small-reward-weights':
    'The Ops "Small Reward Weights" sheet — the weight of each container per merge tier (the rank the merge makes), plus NoDrop, exactly as the model plays them. One table for the normal event and Recompletion (the game has one): tiers 2 to 12 drop the same in both, and tiers 13 and 14 - which can only be made in Recompletion - are the two rows the build sets for it. A tier below the drop start rank can never drop, so it is NoDrop only.',
  'endless-small-rewards-bank':
    'The containers endless mode drops (after rank 14), in the same shape as Small Rewards Bank. Worked out from the Recompletion containers: one rank lower, more per drop, mostly coins and merge energy. Not in the Ops reference.',
  'endless-small-reward-weights':
    'The weight of each endless container per merge tier (2 to 14), plus NoDrop, in the same shape as Small Reward Weights. Not in the Ops reference.',
  endless:
    "Not in the Ops reference — the rules endless mode runs on: when it starts, where its drops start, and the two amounts behind its containers. The setting names are this app's own, and the two amounts are this tool's starting numbers, not confirmed game values.",
}

// Sheets share one flat shape ({ columns, rows }) so this table is generic
// over column count/labels rather than hardcoded to any one sheet - see
// eventSheets.js. Board Layouts doesn't fit that shape (merged Section
// cells, per-board row counts) and gets its own render branch below.
const SHEET_BUILDERS = {
  'event-data': buildEventDataSheet,
  multipliers: buildMultipliersSheet,
  // One event: these hold the normal list and Recompletion together (ranks
  // and merge tiers to 14; the queue and the ladder one after the other).
  'generator-weights': (boards, rc) => buildGeneratorWeightsSheet(boards, rc ?? []),
  'blocked-queue': (boards, rc) => buildBlockedQueueSheet(boards, rc ?? []),
  'item-ladder': (boards, rc) => buildItemLadderSheet(boards, rc ?? []),
  'small-rewards': (boards, rc) => buildSmallRewardsSheet(boards, rc ?? []),
  'small-rewards-bank': (boards, rc) => buildSmallRewardsBankSheet(boards, { recompletionBoards: rc ?? [] }),
  'small-reward-weights': (boards, rc) => buildSmallRewardWeightsSheet(boards, { recompletionBoards: rc ?? [] }),
}

const TILE_CODE_STYLE = {
  B: 'bg-purple-200 text-purple-900',
  S: 'bg-green-100 text-green-900',
  E: 'bg-amber-200 text-amber-900',
}

const TILE_CODE_LEGEND = [
  { code: 'B', label: 'Blocked' },
  { code: 'S', label: 'Semi-blocked' },
  { code: 'E', label: 'Open' },
]

// eventStartDate is a plain 'YYYY-MM-DD' string (an <input type="date">'s own
// value format), so string math would be wrong across month/year boundaries -
// parsed as a local date (not UTC) so "Aug 19" means the same calendar day
// the economist actually picked, not a day off depending on timezone.
// Returns null if no start date is set, so the caller can fall back to the
// plain undated filename rather than emitting "undefined" in it.
function computeEventDateRange(eventStartDate, eventDurationDays) {
  if (!eventStartDate) return null
  const [y, m, d] = eventStartDate.split('-').map(Number)
  const start = new Date(y, m - 1, d)
  const end = new Date(y, m - 1, d + Math.max(1, eventDurationDays || 1) - 1)
  const fmt = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return { start: fmt(start), end: fmt(end) }
}

export default function SyntaxPage({
  boards,
  recompletionBoards,
  eventStartDate,
  eventDurationDays,
  allSegments,
  twisterPlan = null,
  segmentIndex = 0,
  designIssues = [],
  exportOverride = false,
  onExportOverride,
  onRebuild,
  // Phases ('Normal', 'Recompletion') that have a build waiting in Build
  // event that is not applied yet: these sheets do not show it.
  pendingBuilds = [],
  onOpenBuild = null,
}) {
  const twisterOptions = { twisterPlan, segmentIndex }
  // Every export here is of the APPLIED design. While that design is out of
  // date against its build (see DesignStatus.jsx), the export actions are
  // disabled until the economist explicitly overrides.
  const canExportSegment = exportOverride || !designIssues.some((i) => i.segmentIndex === segmentIndex)
  const canExportAll = exportOverride || designIssues.length === 0
  // Ranks whose item text cannot carry the value the game pays (several amounts, or none): written as typed, named here.
  const textIssues = rewardTextIssues(boards?.[0]?.rewardChainConfig)
  const [view, setView] = useState('normal')
  // What a download holds: the segment shown, or every segment in one file.
  const [scope, setScope] = useState('segment')
  const all = scope === 'all'
  const [copied, setCopied] = useState(false)
  const [gsLoading, setGsLoading] = useState(false)
  const [gsCopied, setGsCopied] = useState(false)
  const [gsError, setGsError] = useState(null)
  const [allGsLoading, setAllGsLoading] = useState(false)
  const [allGsCopied, setAllGsCopied] = useState(false)
  const [allGsError, setAllGsError] = useState(null)

  const sheet =
    view === 'endless-small-rewards-bank'
      ? buildEndlessBankSheet(boards, recompletionBoards)
      : view === 'endless-small-reward-weights'
        ? buildEndlessWeightsSheet(boards, recompletionBoards)
        : view === 'endless'
          ? buildV2EndlessSheet(boards, recompletionBoards)
          : (SHEET_BUILDERS[view]?.(boards, recompletionBoards) ?? null)
  const boardLayouts =
    view === 'board-layouts'
      ? buildBoardLayoutsSheet(boards)
      : view === 'recompletion-board-layouts'
        ? buildBoardLayoutsSheet(recompletionBoards)
        : null
  const syntax = view === 'normal' ? boardsToSyntax(boards) : view === 'cc' ? boardsSuggestionsToSyntax(boards) : null

  async function handleCopy() {
    const text = boardLayouts ? boardLayoutsSheetToTsv(boardLayouts) : sheet ? sheetToTsv(sheet) : syntax
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // "Download everything" - independent of whichever sheet is currently
  // selected in the tab switcher above. Only the real Ops sheets
  // (eventSheets.js); Normal/CC (boardSyntax.js) are a separate, older
  // placeholder export and stay out of this workbook. exceljs's own file
  // writer is Node-only, so the browser download is triggered the same
  // Blob + temporary-anchor way App.jsx's backup export does.
  async function handleDownloadWorkbook() {
    const workbook = buildWorkbook(boards, recompletionBoards, [], twisterOptions)
    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const range = computeEventDateRange(eventStartDate, eventDurationDays)
    a.download = range ? `merge-mania-ops-export_${range.start}_to_${range.end}.xlsx` : 'merge-mania-ops-export.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Same sheets the workbook download bundles, but created as a real,
  // live Google Sheet via the Sheets API (googleSheetsExport.js) instead of
  // a downloaded file - values only, no styling (see
  // buildAllSheetsAsValueRows's own comment for why). Copies the resulting
  // spreadsheet's shareable link to the clipboard, mirroring "Share stage"'s
  // copy-link pattern in App.jsx. Each click requests a fresh OAuth token
  // and creates a brand-new spreadsheet - there's no "update the same sheet
  // again" mode yet, so re-running this after editing boards makes a new
  // link each time rather than refreshing an old one.
  async function handleCreateGoogleSheet() {
    setGsError(null)
    setGsLoading(true)
    try {
      const range = computeEventDateRange(eventStartDate, eventDurationDays)
      const title = range ? `Merge Mania Ops Export ${range.start} to ${range.end}` : 'Merge Mania Ops Export'
      const sheets = buildAllSheetsAsValueRows(boards, recompletionBoards, '', [], twisterOptions)
      const url = await createGoogleSheet(title, sheets)
      await navigator.clipboard.writeText(url)
      setGsCopied(true)
      setTimeout(() => setGsCopied(false), 2000)
    } catch (err) {
      setGsError(err.message || 'Something went wrong creating the Google Sheet.')
    } finally {
      setGsLoading(false)
    }
  }

  // Combined "all segments at once" variants of the two tab-based exports
  // above - a shared Event Data/Multipliers/Generator Weights sheet (rows
  // tagged by segment) plus each segment's own six per-segment sheets, all
  // in one file/spreadsheet, tab names prefixed where needed so they can all
  // coexist (see buildAllSegmentsWorkbook's own comment on the Excel
  // 31-character tab-name limit driving that choice, and on the tab
  // sequence itself). "Copy as TSV" has no combined equivalent - it's
  // inherently a single-sheet clipboard action, and that doesn't change with
  // segments.
  async function handleDownloadAllSegmentsWorkbook() {
    const workbook = buildAllSegmentsWorkbook(allSegments, { twisterPlan })
    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `merge-mania-ops-export-all-segments_${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleCreateAllSegmentsGoogleSheet() {
    setAllGsError(null)
    setAllGsLoading(true)
    try {
      const sheets = buildAllSegmentsSheetsAsValueRows(allSegments, { twisterPlan })
      const url = await createGoogleSheet(`Merge Mania Ops Export — All Segments (${new Date().toISOString().slice(0, 10)})`, sheets)
      await navigator.clipboard.writeText(url)
      setAllGsCopied(true)
      setTimeout(() => setAllGsCopied(false), 2000)
    } catch (err) {
      setAllGsError(err.message || 'Something went wrong creating the Google Sheet.')
    } finally {
      setAllGsLoading(false)
    }
  }

  return (
    <Card
      title="Syntax export"
      subtitle="The Ops export of the event in use, sheet by sheet."
      icon={FileCode2}
      action={
        <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="syntax-actions">
          {/* The sheets in one dropdown (they were seventeen buttons), and one pair of
              export buttons with a switch for what they hold (they were two pairs). */}
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 whitespace-nowrap">
            Sheet
            <select value={view} onChange={(e) => setView(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800" data-testid="syntax-view">
              {VIEWS.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" size="sm" icon={copied ? Check : Copy} onClick={handleCopy} disabled={!canExportSegment} title="Copies the sheet shown, tab-separated">
            {copied ? 'Copied' : 'Copy as TSV'}
          </Button>
          <div className="inline-flex bg-slate-100 rounded-xl p-1" data-testid="syntax-scope">
            {[
              ['segment', 'This segment'],
              ['all', 'All segments'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={scope === id}
                onClick={() => setScope(id)}
                data-scope={id}
                title={id === 'all' ? 'The download holds every segment, in one file' : 'The download holds the segment picked in the bar at the top'}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap transition-all duration-150 ${scope === id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={Download}
            onClick={all ? handleDownloadAllSegmentsWorkbook : handleDownloadWorkbook}
            disabled={all ? !canExportAll : !canExportSegment}
            aria-label={all ? 'Download combined workbook' : 'Download workbook (this segment)'}
          >
            Download workbook
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={(all ? allGsCopied : gsCopied) ? Check : FileSpreadsheet}
            onClick={all ? handleCreateAllSegmentsGoogleSheet : handleCreateGoogleSheet}
            disabled={all ? allGsLoading || !canExportAll : gsLoading || !canExportSegment}
            aria-label={all ? 'Create combined Google Sheet' : 'Create Google Sheet (this segment)'}
          >
            {(all ? allGsLoading : gsLoading) ? 'Creating…' : (all ? allGsCopied : gsCopied) ? 'Link copied!' : 'Create Google Sheet'}
          </Button>
        </div>
      }
    >
      {pendingBuilds.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900" data-testid="syntax-pending-build">
          <TriangleAlert size={16} className="shrink-0" />
          <span className="flex-1 min-w-[16rem]">
            A build of the {pendingBuilds.join(' and ')} phase is kept in Build event and is <span className="font-semibold">not in use</span>. These sheets show
            the event in use, so they do not show that build - its containers, rank values and prices are not here. Step 5 can put it in use.
          </span>
          {onOpenBuild && (
            <Button variant="secondary" size="sm" onClick={onOpenBuild}>
              Open Build event
            </Button>
          )}
        </div>
      )}
      {textIssues.length > 0 && (
        <div className="mb-3 flex flex-wrap items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="syntax-text-issues">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <span className="min-w-[16rem] flex-1">
            The game pays a rank's value; the Small Rewards sheet writes its item text, and every text with one amount carries that value. These cannot be rewritten
            safely, so they are written as typed - check them before sending (Rewards tab):{' '}
            {textIssues.map((i) => `${REWARD_TYPE_LABELS[i.type] ?? i.type} rank ${i.rank} pays ${i.value}, ${i.reason}${i.syntax ? ` ("${i.syntax}")` : ''}`).join('; ')}.
          </span>
        </div>
      )}
      <div className="mb-3">
        <ExportGate issues={designIssues} override={exportOverride} onOverride={onExportOverride} onRebuild={onRebuild}>
          {() => (
            <p className="text-xs text-slate-500" data-testid="syntax-export-source">
              These exports are of the <span className="font-semibold text-slate-700">event in use</span>: your last build, as soon as it finished.
            </p>
          )}
        </ExportGate>
      </div>
      {gsError && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 mb-3">
          <TriangleAlert size={16} className="shrink-0 mt-0.5" />
          <span className="text-sm flex-1">{gsError}</span>
          <button type="button" onClick={() => setGsError(null)} className="text-amber-600 hover:text-amber-800 text-xs font-semibold">
            Dismiss
          </button>
        </div>
      )}
      {allGsError && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 mb-3">
          <TriangleAlert size={16} className="shrink-0 mt-0.5" />
          <span className="text-sm flex-1">{allGsError}</span>
          <button type="button" onClick={() => setAllGsError(null)} className="text-amber-600 hover:text-amber-800 text-xs font-semibold">
            Dismiss
          </button>
        </div>
      )}
      <p className="text-xs text-slate-400 mb-3">{DESCRIPTIONS[view]}</p>
      {sheet?.source === 'model' && (
        <p className="text-xs text-emerald-700 mb-3" data-testid="containers-source">
          From the model: these are the containers this design drops when it is played and simulated.
          {sheet.rows.some((r) => r.cells.some((c) => typeof c === 'string' && c.includes('dr-twister'))) ? ' A container that carries Twister DR is written with the key dr-twister-r…, which no Ops reference confirms.' : ''}
        </p>
      )}
      {sheet?.source === 'endless' && (
        <p className="text-xs text-emerald-700 mb-3" data-testid="containers-source">
          From the model: worked out from this segment's applied Recompletion containers, the same way a played session works them out at rank 14.
          {sheet.rows.length === 0 ? ' Nothing is listed: this design has no Recompletion list, or no small reward has rank values.' : ''}
        </p>
      )}
      {sheet?.source === 'none' && (
        <p className="text-sm text-amber-700 mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2" data-testid="containers-source">
          No containers yet: nothing drops from merges in this segment's boards. Build the event in Build event (step 4) - the containers the build makes, and
          their weights, then appear here.
        </p>
      )}
      {/* Reward items inside an otherwise-verified Ops sheet: the cell holds
          the Small Rewards key for that item, which is this app's own
          choice of identifier there, not something an Ops reference
          confirms - said on the sheet itself rather than only in docs. */}
      {/(blocked-queue|board-layouts)/.test(view) &&
        [...boards, ...recompletionBoards].some((b) => (b.rewardQueueItems ?? []).length > 0 || (b.rewardSemiItems ?? []).length > 0) && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">
            Reward items in this sheet are written with their Small Rewards key (for example <span className="font-mono">dr-r3</span>,{' '}
            <span className="font-mono">S:coin-r2</span>). The rest of this sheet matches the verified Ops reference; how production expects a
            reward item to be written in a queue or layout cell is not confirmed yet. The Small Rewards page lists each key with its syntax and
            asset.
          </p>
        )}
      {boardLayouts ? (
        <div className="flex flex-col gap-3">
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left font-semibold text-slate-700 px-3 py-2 border-b border-r border-slate-200">Section</th>
                  {Array.from({ length: boardLayouts.maxCols }, (_, i) => (
                    <th key={i} className="text-center font-semibold text-slate-700 px-3 py-2 border-b border-slate-200">
                      Col {i + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {boardLayouts.sections.map((section, si) => (
                  <Fragment key={si}>
                    {section.rows.map((rowCells, ri) => (
                      <tr key={ri}>
                        {ri === 0 && (
                          <td
                            rowSpan={section.rows.length}
                            className="px-3 py-1.5 border-b border-r border-slate-200 text-center font-semibold text-slate-600 align-middle"
                          >
                            {section.section}
                          </td>
                        )}
                        {rowCells.map((cell, ci) => (
                          <td
                            key={ci}
                            // Keyed on the first character only - a semi cell
                            // reads "S:2"/"S:11", not a bare "S".
                            className={`px-3 py-3 border-b border-slate-100 text-center font-mono text-xs ${TILE_CODE_STYLE[String(cell)[0]] ?? ''}`}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {si < boardLayouts.sections.length - 1 && (
                      <tr>
                        <td colSpan={boardLayouts.maxCols + 1} className="h-3 border-b border-slate-100" />
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
            {TILE_CODE_LEGEND.map(({ code, label }) => (
              <span key={code} className="flex items-center gap-1.5">
                <span className={`w-3.5 h-3.5 rounded-md inline-block ${TILE_CODE_STYLE[code]}`} />
                {code} — {label}
              </span>
            ))}
          </div>
        </div>
      ) : sheet ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50">
                {sheet.columns.map((col) => (
                  <th key={col} className="text-left font-semibold text-slate-700 px-3 py-2 border-b border-slate-200">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, i) => (
                <tr key={i} className={row.highlight ? 'bg-amber-100/70' : ''}>
                  {row.cells.map((cell, j) => (
                    <td
                      key={j}
                      className={`px-3 py-1.5 border-b border-slate-100 text-xs ${
                        sheet.proseColumns?.includes(j) ? 'text-slate-500' : 'font-mono text-slate-700 whitespace-nowrap'
                      }`}
                    >
                      {String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="text-xs font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-4 overflow-x-auto whitespace-pre">
          {syntax}
        </pre>
      )}
    </Card>
  )
}
