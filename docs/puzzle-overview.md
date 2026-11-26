# Puzzle

The Puzzle live-ops event, in the platform at `/models/puzzle` - the first model
whose events are stored on the toolkit server (shared per workspace, with
revisions). Built on 26 Nov 2026 from the approved requirements and
`puzzle-migration-plan.md`; formulas ported from the economist's workbook
"Disney Economy v1.5.75 - copy for cc BF" (never committed). Where the
requirements and the workbook differ, the requirements win (listed below).

## Where things are

```
src/features/puzzle/engine/   pure calculations, no UI (one input: the PuzzleEvent)
  model.ts            the event (= the saved document) and createDefaultEvent
  workbookDefaults.ts GENERATED from the workbook's inputs (scripts/puzzle/write-defaults.py)
  excel.ts            Excel rounding (ROUND, ROUNDUP, MROUND, CEILING, FLOOR) and text of numbers
  regular.ts          sheets "Puzzle" + "Puzzle - Pieces Cost": days, mode multiplier, piece prices
  rewards.ts          "Puzzle - Rewards": worth in allowance, the reward text
  rc.ts               "Puzzle - RC Simulator" + "RC config new"
  segments.ts         segment definitions; "RC Segments Generator" windows
  maleficent.ts       "Maleficent" + its two Config sheets: removal, Boss Bar, buckets
  shuffle.ts          the saved piece order
  cc.ts               "Puzzle CC Management", preset path only
  simulator.ts        player position from economic-effort progress
  compute.ts          everything at once, the checks, the fingerprint
  exportPlan.ts       the cell writes into a copy of the template
  schema.ts           zod schema the server checks (also progression quantiles)
src/features/puzzle/ui/       the screens (PuzzlePage is the module)
src/features/puzzle/export/   Google Drive copy + Sheets fill
server/modules/records/       exports, live runs, observed results (append-only)
tests/puzzle/                 parity with the workbook + rules (npm test)
scripts/e2e-platform/puzzle.mjs   the screens in a browser, two people
scripts/puzzle/               workbook extraction and defaults generation
```

Parity: `python3 scripts/puzzle/extract-workbook.py <workbook.xlsx> reference/puzzle-workbook.json`
writes the workbook's inputs and its own cached results to `reference/` (ignored
by git, like the workbook). The parity suites skip themselves without it.

## The rules in force

- **Event**: name, UTC start, time zone, weekend cutoff, one week or two weeks
  with the real number of days (usual days ±1), inflation, MTX baseline.
  **Exactly one mode**: Standard, Price Cut or Maleficent - one field, so the
  two cannot be combined (refused by the schema on save). Boost is out.
- **Regular**: nine segments, six fixed boards of 6/9/12/16/20/24 pieces.
  Wins for Economy (daily brut wins per segment) are not membership bounds
  (Event mechanics). Prices exactly as the workbook, with the dr-puzzle of a
  board's reward reinvested into the next board's prices. All nine segments
  are calculated; the pickers only choose what is shown.
- **Daily progression** is editable (default even, the workbook's 1/days).
- **Price Cut**: +15% board 5, +30% board 6, +15% RC board 3, applied before
  rounding as in the workbook; rewards unchanged; both price blocks exported.
- **Rewards**: components typed per board; worth in allowance (coin 1, wild 2.5,
  extra stock 2, undo 0.25, free round 1, basket worth, the workbook's
  "discount for calculation"); the target is typed and only compared.
- **RC**: eleven segments, boards of 16/20/24, a stored DR budget per segment
  and length (an input), split 10/25/65%, coins from the last day's piece worth
  with the 2x cap of the matching regular board's coins.
- **Maleficent**: per board difficulty and removal %, cheap pieces kept, wheel
  per board (layout, multiplier, buckets as a spin sequence with typed damage).
  Boss Bar = ROUNDUP(average non-zero typed damage x board DR x difficulty, -1),
  exactly the workbook's. Removal = the workbook's algorithm (sorted by cost
  then piece, prefix + one closer, last of equal totals).
- **Shuffle**: one regular order and one per RC segment, saved with the event;
  only "Shuffle again" (asks first) changes them; board 1 starts with piece 1.
- **CC presets**: progress at day start, five states, the boundary order of the
  sheet, day 1 always Normal, no Stall on the last day, rounding on the value
  after the multiplier (below 10: 1, 10-99: 5, 100+: 10; nearest / up / none /
  down / down).

### Where the approved requirements override the workbook

- **Removed Items are positions** in the shuffled board (the workbook wrote
  piece ids). Written ascending, joined by commas; `NONE` when the boss is on
  and nothing is removed; blank without a boss.
- The workbook computed Maleficent and RC values from the segment selected on
  its Puzzle sheet. The platform computes every segment with its own prices -
  what the workbook gives when that segment is selected (so the "scaled by wins"
  shortcut of the Maleficent summary is reproduced in the parity test only).
- RC pieces are valued with the piece worth of one regular segment, an input
  (default 9, the segment selected in the copy) - **open question** which one.
- The daily progression, effort shares and every former mode toggle are
  explicit inputs; changing the length puts in the workbook's values for it.

## Output

Google Sheets: a copy of the template of the mode, into a Drive folder, mapped
ranges filled (`exportPlan.ts` names every range). Price Cut: Segments, RC
Segments, Seg 1-9 (A2:Z7 and A12:Z17), RC Eco (11 blocks), Puzzle DR Name.
Maleficent: Segments, RC Segments, Seg 1-9 (A3:AH8), RC Seg 1-11 (A3:AH5),
Wheel Wedges and Wheel Buckets (Layouts and Multiplier are kept from the
template). Event Data is written only where an override is typed, per
template keys. Every export is recorded (revision, engine, fingerprint, the
cells sent); a later change marks it "Out of date".

## Optimize and history

Targets (revshare finished, paying users finished, revshare finished before
weekend, FU before weekend) and the FU range are saved with the event. FU
before weekend = the share of measured players INSIDE the range at the weekend
cutoff. "What ran live" records revision + event ID + from when (a mid-event
change is a new row); results imported later are joined to the live revisions
of their window, and a result without a recorded run is never a training
example. No recommendation is shown until it can be supported.

## Not done / not confirmed (do not resolve silently)

- **Google export not tried end to end**: it needs Drive scope on the toolkit's
  OAuth client (set up for Sheets only) and a folder to write to.
- **Standard mode has no approved template** - export is refused.
- **Looker**: no connection; metric definitions, populations, denominators and
  field mapping are unknown. Results come in as a pasted file.
- **Progression percentiles**: no data source yet; the simulator says so and
  offers a labelled manual scenario. One shared quantile table per workspace.
- **CC export**: the 64 `puzzle_N` working presets are not the game's preset
  names (gameplay / pricing, suffixes); no CC tabs are added to the templates.
  The sheet lists three more rows (puzzle_520-540) below the 64.
- Extra presets in a reward ("preset:puzzle_tier_end_N" in a reference
  template): where they go next to a dr-puzzle reward is not confirmed.
- Returning-segment rows are written in the templates' spacing; first-puzzle
  time rules must be typed for each event (the Maleficent template has an
  inverted window - shown as a problem, never copied).
- Wheel layouts and multipliers are not edited in the platform yet.
