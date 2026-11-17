import { ExportGate } from './DesignStatus'
import { Fragment, useState } from 'react'
import { FileCode2, Copy, Check, Download, FileSpreadsheet, TriangleAlert } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import { boardsToSyntax, boardsSuggestionsToSyntax } from '../lib/boardSyntax'
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
  buildV2RewardChainSheet,
  buildV2DropGroupsSheet,
  buildV2EconomySheet,
  buildV2TwisterSheet,
  buildBoardLayoutsSheet,
  boardLayoutsSheetToTsv,
  sheetToTsv,
  buildWorkbook,
  buildAllSheetsAsValueRows,
  buildAllSegmentsWorkbook,
  buildAllSegmentsSheetsAsValueRows,
} from '../lib/eventSheets'
import { createGoogleSheet } from '../lib/googleSheetsExport'

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
  { id: 'recompletion-blocked-queue', label: 'Recompletion Blocked Queue' },
  { id: 'item-ladder', label: 'Item Ladder' },
  { id: 'small-rewards', label: 'Small Rewards' },
  { id: 'small-rewards-bank', label: 'Small Rewards Bank' },
  { id: 'small-reward-weights', label: 'Small Reward Weights' },
  { id: 'rc-small-rewards-bank', label: 'RC Small Rewards Bank' },
  { id: 'rc-small-reward-weights', label: 'RC Small Reward Weights' },
  { id: 'endless-small-rewards-bank', label: 'Endless Small Rewards Bank' },
  { id: 'endless-small-reward-weights', label: 'Endless Small Reward Weights' },
  { id: 'v2-reward-chain', label: 'V2 Reward Chain' },
  { id: 'v2-drop-groups', label: 'V2 Drop Groups' },
  { id: 'v2-economy', label: 'V2 Economy' },
  { id: 'v2-twister', label: 'V2 Twister' },
  { id: 'v2-endless', label: 'V2 Endless' },
]

const DESCRIPTIONS = {
  normal: "Every board's actual saved config, in play order — board pushes, semi placements, and blocked queue sequences, everything currently configured.",
  cc: "CC Management's suggestions in the same format — +30%/+50% bigger-wave queues and +8%/+12% lucky-drop EV bumps, per board.",
  'event-data':
    "The real Ops \"Event Data\" sheet. Every value is a fixed constant for this event except TutorialDrAmount, which tracks Board 1's own onboarding-goal DR amount.",
  multipliers:
    'The real Ops "Multipliers" sheet — one row per generator tier (x1/x2/x4). Unlock Tier is each tier\'s own unlock rank; Lucky Drop Threshold is one rank above the tier\'s normal output (x1→2, x2→3, x4→4).',
  'generator-weights':
    "The real Ops \"Generator Weights\" sheet — one row per (rank, tier) combo where that tier is unlocked, using Board 1's own lucky-drop target EV. Whole-number weights out of 1000, landing on T(normalRank)/T(normalRank+1)/T(normalRank+2); rows below a tier's Lucky Drop Threshold carry the normal weight only.",
  'blocked-queue':
    'The real Ops "Blocked Queue" sheet — every board\'s blockedQueue, in play order, combined into one continuous pool table. A deliberately simplified case of the source sheet\'s weighted-loot-pool format: one trivial pool per entry (no alternatives), Item is the plain item rank, Stock and Weight both fixed at 1.',
  'recompletion-blocked-queue':
    'Same shape as Blocked Queue, but for the separate Recompletion board list (the "Recompletion" tab) — its own independent Entry Number sequence, starting fresh at 1.',
  'item-ladder':
    'The real Ops "Item Ladder" sheet — one row per rank 1-12, using Board 1\'s "Rank rewards" card. Milestone Reward Syntax is populated only for ranks marked as reward ranks there, with whatever syntax was typed for them.',
  'board-layouts':
    "The real Ops \"Board Layouts\" sheet — one Section per board, in play order. B/S/E are each tile's blocked/semi/open state; a semi tile also carries its own item rank (e.g. \"S:2\"), read off that board's generated placements.",
  'recompletion-board-layouts':
    'Same shape as Board Layouts, but for the separate Recompletion board list (the "Recompletion" tab) — the board(s) a player cycles through after reaching the event\'s Last Tier.',
  'small-rewards':
    'The real Ops "Small Rewards" sheet — one row per reward-chain key (coin/dr/puzzle/charm, rank 1-4), driven by the Rewards (V2) tab\'s own reward-chain config (syntax, Asset ID, prize). Seeded with the economist\'s real reference values, fully editable from there.',
  'small-rewards-bank':
    'The Ops "Small Rewards Bank" sheet — the containers a merge can drop in the normal event. Each container is one drop the model built and plays (Build event), named ContA, ContB, ... and written in the Small Rewards keys above (coin-r1+dr-r1 = a coin rank 1 and a merge energy rank 1 dropping together). Every container is a different drop.',
  'small-reward-weights':
    'The Ops "Small Reward Weights" sheet — the weight of each container per merge tier (the rank the merge makes), plus NoDrop, exactly as the model plays them. Tiers 2 to 12; a tier below the drop start rank can never drop, so it is NoDrop only.',
  'rc-small-rewards-bank':
    'The same as Small Rewards Bank, for Recompletion — its list has its own drops, so it has its own containers. Not in the Ops reference, which has no Recompletion tab for this.',
  'rc-small-reward-weights':
    'The same as Small Reward Weights, for Recompletion: merge tiers 2 to 14. Not in the Ops reference, which has no Recompletion tab for this.',
  'endless-small-rewards-bank':
    'The containers endless mode drops (after rank 14), in the same shape as Small Rewards Bank. Worked out from the Recompletion containers: one rank lower, more per drop, mostly coins and merge energy. Not in the Ops reference.',
  'endless-small-reward-weights':
    'The weight of each endless container per merge tier (2 to 14), plus NoDrop, in the same shape as Small Reward Weights. Not in the Ops reference.',
  'v2-endless':
    "V2 internal model, NOT a verified Ops sheet — the rules endless mode runs on: when it starts, where its drops start, and the two amounts behind its containers. The setting names are this app's own, and the two amounts are this tool's starting numbers, not confirmed game values.",
  'v2-reward-chain':
    "V2 internal model, NOT a verified Ops sheet — the reward definitions of all three lists (Main / RC A / RC B, in the List column): every resource and rank with the key a queue or layout cell references it by, its configured item syntax, asset and prize. The Key column is how reward items are written in Blocked Queue and Board Layouts cells; that production expects those keys there is NOT confirmed by any Ops reference — this sheet exists so the key → syntax mapping can be checked.",
  'v2-drop-groups':
    "V2 internal model, NOT a verified Ops sheet — the drop tables of all three lists (Main / RC A / RC B): for each resulting main-chain rank from that list’s drop start rank up, one row per group (plus a no-drop row) with its weight and which resource+rank each group bundles. Drop odds are one shared configuration across segments. Pending confirmation of the real V2 production mapping.",
  'v2-twister':
    'V2 internal model, NOT a verified Ops sheet — the Twister widget settings that are NOT part of the shared definitions. "Runtime - segment-specific" is this segment\'s DR cost per spin for each list (Main / RC A / RC B); "Runtime - shared" is the optional widget length; "Design metadata - not runtime" records the checkpoint, target spins and simulation settings the cost was derived from and configures nothing in the game. The shared Twister rank ladder is in V2 Reward Chain and its drop odds in V2 Drop Groups. No production contract for Twister has been confirmed.',
  'v2-economy':
    "V2 internal model, NOT a verified Ops sheet — per-board economy settings across all three lists (Main / RC A / RC B): blocked value, CC %, the merge-drop start rank, the leftover policy, and the reward items placed under blocked tiles and on semi-blocked tiles. Pending confirmation of the real V2 production mapping.",
}

// Sheets share one flat shape ({ columns, rows }) so this table is generic
// over column count/labels rather than hardcoded to any one sheet - see
// eventSheets.js. Board Layouts doesn't fit that shape (merged Section
// cells, per-board row counts) and gets its own render branch below.
const SHEET_BUILDERS = {
  'event-data': buildEventDataSheet,
  multipliers: buildMultipliersSheet,
  'generator-weights': buildGeneratorWeightsSheet,
  'blocked-queue': buildBlockedQueueSheet,
  'item-ladder': buildItemLadderSheet,
  // The three Small Rewards sheets are fixed templates - they ignore the
  // `boards` argument every other builder here takes.
  'small-rewards': buildSmallRewardsSheet,
  'small-rewards-bank': buildSmallRewardsBankSheet,
  'small-reward-weights': buildSmallRewardWeightsSheet,
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
  recompletionBoards2 = [],
  eventStartDate,
  eventDurationDays,
  allSegments,
  twisterPlan = null,
  segmentIndex = 0,
  designIssues = [],
  exportOverride = false,
  onExportOverride,
  onRebuild,
}) {
  const twisterOptions = { twisterPlan, segmentIndex }
  // Every export here is of the APPLIED design. While that design is out of
  // date against its build (see DesignStatus.jsx), the export actions are
  // disabled until the economist explicitly overrides.
  const canExportSegment = exportOverride || !designIssues.some((i) => i.segmentIndex === segmentIndex)
  const canExportAll = exportOverride || designIssues.length === 0
  const [view, setView] = useState('normal')
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
        : view === 'v2-endless'
          ? buildV2EndlessSheet(boards, recompletionBoards)
          : view === 'rc-small-rewards-bank'
      ? buildSmallRewardsBankSheet(recompletionBoards, { phase: 'rc' })
      : view === 'rc-small-reward-weights'
        ? buildSmallRewardWeightsSheet(recompletionBoards, { phase: 'rc' })
        : view === 'recompletion-blocked-queue'
      ? buildBlockedQueueSheet(recompletionBoards)
      : view === 'recompletion-blocked-queue-b'
        ? buildBlockedQueueSheet(recompletionBoards2)
        : view === 'v2-twister'
          ? buildV2TwisterSheet(boards, recompletionBoards, recompletionBoards2, twisterOptions)
          : view === 'v2-economy'
          ? buildV2EconomySheet(boards, recompletionBoards, recompletionBoards2)
          : view === 'v2-reward-chain'
            ? buildV2RewardChainSheet(boards, recompletionBoards, recompletionBoards2)
            : view === 'v2-drop-groups'
              ? buildV2DropGroupsSheet(boards, recompletionBoards, recompletionBoards2)
          : (SHEET_BUILDERS[view]?.(boards) ?? null)
  const boardLayouts =
    view === 'board-layouts'
      ? buildBoardLayoutsSheet(boards)
      : view === 'recompletion-board-layouts'
        ? buildBoardLayoutsSheet(recompletionBoards)
        : view === 'recompletion-board-layouts-b'
          ? buildBoardLayoutsSheet(recompletionBoards2)
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
    const workbook = buildWorkbook(boards, recompletionBoards, recompletionBoards2, twisterOptions)
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
      const sheets = buildAllSheetsAsValueRows(boards, recompletionBoards, '', recompletionBoards2, twisterOptions)
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
      subtitle="Draft export for the Ops handoff — being replaced sheet by sheet with the real spec (see eventSheets.js) as each one gets specced out"
      icon={FileCode2}
      action={
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
            {VIEWS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all duration-150 ${
                  view === id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" icon={copied ? Check : Copy} onClick={handleCopy} disabled={!canExportSegment}>
            {copied ? 'Copied' : 'Copy as TSV'}
          </Button>
          <Button variant="secondary" size="sm" icon={Download} onClick={handleDownloadWorkbook} disabled={!canExportSegment} title="Only the currently active segment — see 'All segments' below for every segment at once">
            Download workbook (this segment)
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={gsCopied ? Check : FileSpreadsheet}
            onClick={handleCreateGoogleSheet}
            disabled={gsLoading || !canExportSegment}
            title="Only the currently active segment — see 'All segments' below for every segment at once"
          >
            {gsLoading ? 'Creating…' : gsCopied ? 'Link copied!' : 'Create Google Sheet (this segment)'}
          </Button>
        </div>
      }
    >
      <div className="mb-3">
        <ExportGate issues={designIssues} override={exportOverride} onOverride={onExportOverride} onRebuild={onRebuild}>
          {() => (
            <p className="text-xs text-slate-500" data-testid="syntax-export-source">
              These exports are of the <span className="font-semibold text-slate-700">applied design</span>. A draft from Build event is never exported until it is applied.
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
      {/* Everything above exports whichever segment is currently active in
          the header switcher (App.jsx) - these two act on every segment at
          once instead, bundled into one file/spreadsheet (see
          buildAllSegmentsWorkbook/buildAllSegmentsSheetsAsValueRows). */}
      <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">All segments</span>
        <Button variant="secondary" size="sm" icon={Download} onClick={handleDownloadAllSegmentsWorkbook} disabled={!canExportAll}>
          Download combined workbook
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={allGsCopied ? Check : FileSpreadsheet}
          onClick={handleCreateAllSegmentsGoogleSheet}
          disabled={allGsLoading || !canExportAll}
        >
          {allGsLoading ? 'Creating…' : allGsCopied ? 'Link copied!' : 'Create combined Google Sheet'}
        </Button>
      </div>
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
          No containers yet: nothing drops from merges in this segment's applied design. Build the event in Build event (step 6) and apply it - the containers the build makes, and
          their weights, then appear here.
        </p>
      )}
      {/* Reward items inside an otherwise-verified Ops sheet: the cell holds
          the Small Rewards key for that item, which is this app's own
          choice of identifier there, not something an Ops reference
          confirms - said on the sheet itself rather than only in docs. */}
      {/(blocked-queue|board-layouts)/.test(view) &&
        [...boards, ...recompletionBoards, ...recompletionBoards2].some((b) => (b.rewardQueueItems ?? []).length > 0 || (b.rewardSemiItems ?? []).length > 0) && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">
            Reward items in this sheet are written with their Small Rewards key (for example <span className="font-mono">dr-r3</span>,{' '}
            <span className="font-mono">S:coin-r2</span>). The rest of this sheet matches the verified Ops reference; how production expects a
            reward item to be written in a queue or layout cell is not confirmed yet. The V2 Reward Chain tab lists each key against its configured
            item syntax.
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
