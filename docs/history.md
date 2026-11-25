# Merge Mania economy toolkit — Claude Code handoff

This project is a game-economy design tool for **Merge Mania**, a 7-day timed
live-ops event on Disney Solitaire (SuperPlay). It was designed collaboratively
with the game economist across a long conversation; this file exists so a
Claude Code agent picking up the codebase understands the domain rules well
enough not to silently break them while adding features.

The project started as a single-file React artifact (`merge_mania_toolkit.jsx`)
and has since been split into a proper Vite + React project under `src/` —
that split is done; preserve every invariant below when extending it further.

**The app is no longer Merge-only, and the directory layout reflects that.**
A hero landing page now lets the economist pick between features; everything
below through "Persistence" is Merge's own domain model. A second feature,
**Diamond Mine** (an unrelated reveal-the-tiles board game), has its own
section further down — see "Hero page & multi-feature routing" and "Diamond
Mine". Don't assume Merge's domain rules (value-chain ranks, subsidy,
generator tiers, lucky drops) apply there; the two features only share this
app's UI/component conventions, not any domain logic. Each feature owns a
self-contained `src/features/<feature>/{components,lib}` folder (Merge also
has its own `data/` for the baked-in demo stage) - a file under
`src/features/merge/` should never import from `src/features/diamondMine/`
or vice versa, and in practice neither does; the only thing both genuinely
share is truly feature-agnostic: `src/components/ui/` (Button/Card/
NumberField/Slider), `src/components/HeroPage.jsx`, and `src/lib/gridWidth.js`
(`gridWidthRem`, pure grid-cell-sizing math with no domain logic, used by
every board-grid component in both features). `src/App.jsx`/`main.jsx`/
`index.css` stay at the `src/` root as the app's true entry point, importing
from both features. If a third feature ever gets added, follow this same
`src/features/<name>/` shape rather than dropping its files into the
top-level `components/`/`lib/` the way both features originally started out
(Merge was there first, from before this split existed; Diamond Mine
briefly used a flat `src/lib/` with a `diamond`-prefix naming convention
before this reorganization - neither is the pattern to copy going forward).

**Start here for the current product shape:** the app opens on the guided
"Build event" workflow - see "Build Event workflow (the guided path) and the
rules it rests on". That section also records three rules that override
older text in this file: one Recompletion list (no A/B), coins as an
allowance worth (not a coin count), and Twister as drop-only.

**Implementation status.** Not every domain-model concept below is built yet.
Board layout, item generation/placement, the playthrough simulator, the
interactive play tester (`src/features/merge/components/PlayTester.jsx`), and
**Segments** (see below) are implemented. **Push/stall pacing** is still
design intent only — there is no pacing-gap/push/stall code anywhere in
`src/`. Segments *used* to be design-intent-only too (an earlier version of
this file explicitly said "ask first, substantial architecture change" — see
the "Segments" section below for what actually shipped and why nothing here
was bolted on speculatively); this note now describes what's real.

## Domain model (do not casually change these)

**Value chain.** An item of rank `r` has value `2^(r-1)`. Rank 12 = the
completed grand-prize item = 2048, which is the total chain value. This
identity (`valueOf(rank) = 2^(rank-1)`) underlies almost every calculation in
the app (subsidy math, generator tiers, lucky drops, pacing curve). Do not
change the base without re-deriving everything downstream.

**Segments.** There are 4 player segments, bucketed by daily "Brut Win" (BW)
habit. Higher BW habit = harder segment. Segments differ **only** in:
- total subsidy DR (value handed out via blocked/semi-blocked board tiles)
- generator effort budget over the 7 days

They do **not** differ in: board size, chain length (always rank 1–12), or
lucky-drop odds/EV. This was an explicit design decision — the team rejected
"stronger players get less DR per action" as a lever; all segment difficulty
lives in how much of the rank-12 climb is subsidized by the board vs. earned
by active play.

**Implemented, by explicit economist request** ("I want to be able to create
4 different configurations for 4 different segments... different syntax
output and different queues"). Two design decisions were confirmed before
building this, since it's exactly the "substantial architecture change" an
earlier version of this file warned not to bolt on speculatively:
- **Full parity per segment**, not a partial split. Each of the 4 segments
  (`SEGMENT_COUNT` in `App.jsx`) owns a completely independent copy of
  everything a single economist "project" used to be: its own main board
  list, its own Recompletion board list, its own saved presets (both
  lists'), its own `targetSubsidy`, and its own event schedule
  (`eventStartDate`/`eventDurationDays`). Nothing is shared across segments
  except the *code* running against whichever one is active — Play Tester,
  CC Management, and Syntax all read from `activeSegment`, the same way they
  used to read from the single `main`/`recompletion` pair. **Amended below**
  ("Board layout & rank rewards sync from Segment 1") — BOTH the main list's
  and Recompletion's own tile layout, rank window, board count/order, and
  rank rewards are no longer independent per segment (each list synced
  independently of the other); everything else this bullet describes still
  is.
- **Exports have both a per-segment and a combined form.** The existing
  per-sheet "Copy as TSV" / "Download workbook" / "Create Google Sheet"
  actions (see "Real Ops sheets" below) act on whichever segment is
  currently active, unchanged. Two new buttons — "Download combined
  workbook" and "Create combined Google Sheet" (`SyntaxPage.jsx`) — bundle
  all 4 segments' eleven sheets into ONE file/spreadsheet at once
  (`eventSheets.js`'s `buildAllSegmentsWorkbook`/
  `buildAllSegmentsSheetsAsValueRows`), so "different syntax output and
  different queues" per segment doesn't mean four separate manual exports
  every time. "Copy as TSV" has no combined form — it's inherently a
  single-sheet clipboard action, unaffected by segments.

**Segment count is a fixed constant (8, raised from the original 4 by
explicit economist request — "let me support 8 segments"), not
economist-configurable at runtime** — no add/remove-segment UI was
requested or built, either time. `SEGMENT_COUNT`/`DEFAULT_SEGMENT_NAMES` in
`App.jsx` is the single place that constant lives, but `EditorApp` still
calls `useSegment()` a hardcoded number of times (`segment0`..`segment7`,
see "State shape" below) — growing the count isn't just changing a
constant, it's adding more unconditional hook calls too, the same way the
count itself can't become dynamic at render time without breaking the Rules
of Hooks. If this ever needs to grow again, the same three spots need a
matching third expansion: the `segment0`..`segment7` hook-call list itself,
the two `syncSegmentListLayout` effects' own dependency arrays (each lists
every segment's `boards` reference individually, not just `segments` as a
whole, so React's effect-dependency linting can actually see what changed),
and the event-schedule sync effect's dependency array (same reasoning, one
entry per segment per field). Everything else that touches "all segments" -
`allSegmentsForEffortTarget`, the combined-workbook builders, the
backup/restore/clear-data paths, `segmentsFromPersisted`'s own migration -
was already written generically over `segments.length` and needed zero
changes for this.

**Migrating an older, smaller-SEGMENT_COUNT save needed no new code at
all** — `segmentsFromPersisted`'s existing `parsed.segments[i] ?? {}`
already falls back to `{}` (which `normalizeSegment` turns into a fresh
blank segment) for any index the saved blob doesn't have, so a save/backup
made back when `SEGMENT_COUNT` was 4 loads cleanly under 8: segments 1-4
keep their real data, 5-8 just start blank. Verified live (not just reasoned
about): seeded `localStorage` with a real 4-segment save (distinct names,
board counts, and `targetSubsidy` per segment — segment 4 at
`targetSubsidy: 400` with 4 boards) and loaded the app under the new
`SEGMENT_COUNT = 8` — 8 segment tabs appeared, the active tab's own name
input read "Old Segment 1" (real migrated data, not a default placeholder),
switching to segment 4 showed its Total Subsidy card reading "400 / 400 DR"
(its exact migrated target), and segment 8 showed a blank name input with
the plain "Segment 8" placeholder (freshly bootstrapped, no migrated data
at all).

Segment **name** is free-text and economist-editable (defaults to "Segment
1".."Segment 8"), inline in the header's segment switcher — click a segment
to make it active; the active tab's label becomes a plain text input you can
type into directly, no separate rename dialog. Purely a label - doesn't
affect generation, export column names, or anything else structural (the
combined workbook's own tab names use a terse `S1`..`S4` index instead of
the free-text name specifically to stay under Excel's 31-character sheet-name
limit - see `buildAllSegmentsWorkbook`'s own comment).

**State shape (`App.jsx`).** `useSegment(initial)` is a small custom hook
bundling one segment's own `main`/`recompletion` (both the *same*
`useBoardListState` hook Main/Recompletion already used before segments
existed - called twice per segment, so segments reuse 100% of that existing
CRUD/presets/subsidy machinery with zero duplication), plus `name` and the
event-schedule fields, each its own `useState`. `EditorApp` calls it exactly
`SEGMENT_COUNT` (4) times, unconditionally, every render —
`segment0`/`segment1`/`segment2`/`segment3` — then holds them in a plain
`segments` array plus an `activeSegmentIndex` state. This is legal under the
Rules of Hooks specifically because the call *count* never varies (always
exactly 4, regardless of which one is "active") — only *which* segment's
data ends up rendered depends on `activeSegmentIndex`, and that's ordinary
prop/state selection, not conditional hook invocation. The three inactive
segments' state stays alive in the background the whole time (React doesn't
unmount them), so switching segments never loses in-progress edits on the
others — there's no save-before-switch step, unlike switching between the
main list and Recompletion under the OLD single-project model, which was
already the same "both always mounted, pick which renders" pattern this
just extends to 4.

**Persistence.** See "Persistence" below for the localStorage/backup shape
change (`{ segments: [...] }` instead of the old flat shape) and the
migration path for a save/backup made before this feature existed.

**Board layout & rank rewards sync from Segment 1 — the one deliberate
crack in "full parity per segment" above.** By explicit economist request
("I want that the board layout I build in the first segment[s] will go
through to all segments, also the rank reward"), scoped via two clarifying
questions before building (live sync vs. a manual "copy" button; which
fields count as "layout"). The economist chose **live, always-on sync**
with **tile pattern + rank window** as the synced surface — this is also
the domain model catching up to itself: CLAUDE.md has always said segments
"do NOT differ in: board size, chain length..." (see "Value chain"/
"Segments" at the top of this doc), but Full Parity's independent-copy
implementation let them silently diverge on exactly that. `blockedValue`,
the onboarding goal, and `rcEvent` stay OUT of the synced set on purpose —
those are exactly what segments SHOULD differ on (subsidy amount, and a
per-segment DR/rank onboarding target).

`App.jsx`'s `EditorApp` runs the actual comparison-and-write logic through
one shared helper, `syncSegmentListLayout(sourceBoards, targetSegments,
listKey)` (`SYNCED_LAYOUT_FIELDS = ['rows', 'cols', 'tiles', 'minRank',
'maxRank', 'forcedSemiRanks']`), called from two independent `useEffect`s —
one for the main list, one for Recompletion's own list (`listKey: 'main'`
vs `'recompletion'`, selecting which of a segment's two
`useBoardListState` instances to read/write) — **by explicit follow-up
request** ("I want the same logic of copying between segments to apply in
the recompletion also"), extending what originally shipped as main-list-only.
Each effect depends on all 4 segments' own `boards` reference for THAT
list only, and treats `segment0`'s own list as the one source of truth for
segments 1-3's matching list — the two lists are never mixed: a call with
`listKey: 'main'` only ever reads/writes `seg.main`, never touches any
segment's `recompletion`, and vice versa, so editing Segment 1's
Recompletion board can never leak into any segment's main list or back the
other way.
- **Board count is part of "layout" too** — a board that only exists in one
  segment isn't the same layout — so a count mismatch calls
  `setBoardCount(sourceBoards.length)` first (adding boards at the end, or
  trimming from the end, matching every other board-count operation's own
  never-touch-board-0 convention) and lets the per-board field sync catch up
  on the NEXT render once counts line up, rather than trying to do
  everything in one pass.
- **Per-board field sync** does a real value diff (`JSON.stringify`, since
  `tiles`/`forcedSemiRanks` are nested) between each source/target board at
  the same INDEX (boards are matched positionally, never by `id` — segment
  boards each have their own independent UUIDs) and writes only the fields
  that actually differ, via `invalidateLayout(targetBoard, patch)` — the
  same "clear `semiPlacements`/`blockedQueue`/`onboardingStatus`, they're
  stale now" helper every other tile/rank-window edit already goes through,
  since a synced layout change invalidates a target segment's own generated
  items exactly the same way editing them locally always has.
- **Lucky-drop `targetEv` and the event schedule** (`eventStartDate`/
  `eventDurationDays`) sync across segments too — by explicit economist
  request ("the lucky drop EV and the dates should be the same for all
  segments"), and, like the board layout before them, this is the domain
  model catching up to itself: the "Segments" section above has always said
  segments "do NOT differ in: board size, chain length, or **lucky-drop
  odds/EV**" — Full Parity's independent-copy implementation just never
  enforced the EV half of that sentence. `targetEv` rides along in
  `syncSegmentListLayout` (compared on board 0, written via the existing
  `syncTargetEv`, and deliberately NOT routed through `invalidateLayout` —
  it's a play-time generator-RNG parameter that doesn't feed generation, so
  syncing it must never wipe an already-generated board). The event schedule
  gets its own small effect instead: those two live on `useSegment` itself
  rather than on a `useBoardListState` instance, and they're main-list-only
  (the card never renders for Recompletion). Both lock on segments 2-4 with
  the same "synced from Segment 1" disabled-field/banner treatment every
  other synced field already uses.
- **Rank rewards** (`rewardRanks`/`rewardSyntax`) sync separately, by
  comparing just `sourceBoards[0]` against `targetBoards[0]` (since within
  one list these are already kept identical across every board by the
  pre-existing `syncRankRewards` mechanism - see "Play Tester" below) and
  calling that same `syncRankRewards` on the target segment when they
  differ — deliberately NOT run through `invalidateLayout`, since reward
  fields don't feed generation at all and shouldn't wipe an already-
  generated board just because a reward rank changed elsewhere.

Because every write is gated on a genuine diff, both effects are a no-op
almost every render — each only ever writes when segment 1's OWN copy of
that list actually changed something in the synced set, and once every
other segment matches, further runs (including the ones triggered by their
own writes, which re-fire the relevant effect since that list's `boards`
changed) find nothing left to do and stop.

**The UI makes the lock explicit rather than letting an edit silently
revert.** Editing tiles/rows/cols/min-max-rank/rank-rewards on segment 2-4's
own list would just get overwritten by the matching sync effect on the very
next render — a confusing "why didn't my edit stick" experience, not a
clear signal. `App.jsx` computes two independent flags — `layoutLocked =
mode === 'editor' && activeSegmentIndex !== 0` for the main list,
`recompletionLayoutLocked = mode === 'recompletion' && activeSegmentIndex
!== 0` for Recompletion's — and threads whichever one applies into that
list's own `BoardList`/`BoardEditor` call (as a single generic
`layoutLocked` prop; neither component needs to know or care which actual
list it's editing): `BoardGrid`'s `onPaint`/`onFillAll` are passed as
`undefined` when locked (which already hides its whole brush/fill-all
toolbar and blocks cell painting - see BoardGrid.jsx's own `{onPaint && (`
gate, no new mechanism needed there), Rows/Columns/Min rank/Max rank/
Number-of-boards fields and the Add/Duplicate/Remove/Move board buttons all
get `disabled`, and the Rank rewards toggle buttons + reward-syntax inputs
do too — each with a purple "synced from Segment 1" banner or hint/title
explaining why, reusing the same visual language `InfoHint`/disabled-field
patterns already use elsewhere (e.g. Total Subsidy's own auto-filled last
board). `blockedValue`, onboarding goal, `rcEvent`, `targetEv`, generator
tiers, noise, and Generate/Generate-all all stay fully live on every
segment — only the synced fields lock, independently per list.

Verified live end-to-end for BOTH lists: resizing Segment 1's board 1 to
4×6, painting 6 tiles blocked, and marking rank 5 as a reward rank all
appeared on Segment 2's board 1 within one render after switching tabs —
including the forced semi cell at its usual position — while Segment 2's
own `blockedValue` stayed independently editable (set to 250, unaffected).
Repeated on Recompletion specifically (4×6, 5 blocked tiles, rank 8 marked)
with the same result on Segment 2's own Recompletion tab, while Segment 2's
MAIN list stayed at its untouched default (5×8, no reward marked) the whole
time — confirming the two lists' sync effects never cross-contaminate each
other, the same independence the "Effort target" apply-to-all-segments
feature already established for a different piece of per-list state.
Confirmed via
direct DOM inspection (not just a screenshot) that Min rank/Max rank/Rows/
Columns/the reward-rank buttons on Segment 2 are genuinely `disabled`, and
that the brush/fill-all toolbar doesn't render there at all.

**One real consequence worth flagging, since this shipped against
whatever segments 2-4 already had:** the very first render after this
feature lands, if segments 2-4's board layouts had already diverged from
segment 1's (entirely possible, since nothing enforced parity before this),
the sync effect immediately overwrites them to match — this was an
explicit, informed tradeoff the economist chose (told directly, before
building, that live sync would mean "you'd stop being able to give segment
2/3/4 a different tile pattern at all"), not a silent side effect to be
surprised by later.

**Boards.** Each segment has its own ordered list of boards (not shared
globally). Each board has:
- a `rows` x `cols` grid of tile states: `"blocked"`, `"semi"` (semi-blocked —
  revealed but needs one more merge to fully clear), or `"open"` (playable)
- `blockedValue` — the DR-equivalent subsidy value assigned to that board's
  blocked+semi tiles combined
- `minRank` / `maxRank` — a best-effort constraint on which item ranks are
  allowed under that board's blocked/semi tiles

A segment's boards' `blockedValue`s should sum to that segment's total
subsidy DR. The app surfaces this as a live check — an optional
`targetSubsidy` (top-level app state, alongside `boards`/`presets`, `null`
by default; see "Persistence" below) that the economist sets in the
Board-1-gated "Total subsidy" card (`BoardEditor.jsx`), tracked live against
`boards.reduce((sum, b) => sum + b.blockedValue, 0)` with a progress bar and
an explicit over/under/met readout. It does not hard-enforce it, by design
(the economist may want to over/under-allocate temporarily while
iterating) — going over or under just shows an amber note, never blocks
anything. That same card also lets the economist edit every board's
`blockedValue` directly in a per-board list (not just the active board's,
via `onUpdateBoard` passed down from `App.jsx`, same `invalidateLayout` path
as every other subsidy edit) and set the board *count* directly (a
committed-on-blur/Enter field, deliberately NOT using `NumberField`'s
per-keystroke `onChange` like every other numeric field here — typing "15"
would transiently commit "1" first and delete boards 2-15 before the second
digit landed, since this field's value drives an actual array
add/remove, unlike every other numeric field on this card which only
changes a number). `targetSubsidy` lives on the segment now (`useSegment`'s
own `main.targetSubsidy`, via `useBoardListState` - see "Segments" above),
not top-level app state - each segment tracks its own total-subsidy goal
against its own `boards.reduce(...)`, independent of every other segment's.

**The LAST board auto-fills to whatever closes the gap to the target — by
explicit economist request ("auto fill the amount needed to the last board
to get to the target subsidy").** `BoardEditor.jsx` runs a `useEffect`
(deliberately NOT gated on `isFirstBoard`, so it stays correct regardless of
which specific board's page happens to be open) that computes
`targetSubsidy - sum(every board except the last)`, clamps it to
`[0, valueOf(MAX_RANK)]`, and writes it onto the last board's
`blockedValue` via `onUpdateBoard` whenever it differs from what's
currently there. Economist workflow: set every OTHER board's value, and the
last one keeps itself exactly right — no manual back-calculation. Converges
in one step rather than looping: the computed value only depends on the
OTHER boards' sum, which doesn't change when the last board's own value is
written, so recomputing after the write always yields the same number.

The last board's own field is **read-only** wherever it's editable, so it
can't look editable and then silently snap back on the next render — both
`BoardEditor.jsx`'s Total Subsidy per-board list (a small "(auto)" label,
muted styling, a tooltip explaining why) and `BoardList.jsx`'s sidebar
"Blocked value (DR)" field on that board's own page (same disabled
treatment, threaded through `targetSubsidy`, a prop `BoardList` didn't
previously need). This matters because there isn't only one place
`blockedValue` can be typed — the economist can also navigate directly to
the last board's own sidebar entry and try to edit it there, bypassing the
Total Subsidy card entirely; without disabling it in *both* places, a
manual edit there would appear to work for a moment and then get silently
overwritten the next time the shared effect re-runs. `targetSubsidy == null`
(no target set) leaves both fields exactly as they were before this feature
— fully editable, no auto anything. Verified live: setting a 3-board target
of 500 and dialing in boards 1 and 2 by hand kept board 3 continuously
correct (500, then 300, then 150) with its field visibly disabled the whole
time, on both surfaces.

**The Total Subsidy card's input field is typed and displayed in DEMAND
space, not subsidy space — by explicit economist request ("the target total
subsidy will be something else. it will be the total demand from the user.
the app will calculate the subsidy needed. if i give u 500, the app does
2048-500 and this is the subsidy needed").** The economist now types how
much DR the player is expected to spend out of their own effort
("Total demand (DR)"), and the card computes and displays the subsidy
needed to cover the rest of the rank 1-12 chain
(`valueOf(MAX_RANK) - demand`, i.e. `2048 - demand`) in its own read-only
"Subsidy needed" readout, right under the input.

**This is purely a display/input-boundary conversion in `BoardEditor.jsx` —
the underlying stored `targetSubsidy` field (on `useBoardListState`, in
persistence, in every other consumer) is completely unchanged and still
holds the real subsidy DR amount, exactly as it always has.** The auto-fill
effect, the progress bar/"Goal" readout, and `BoardList.jsx`'s disabled
last-board field all still read `targetSubsidy` directly as the actual
subsidy target — none of them needed to change, since none of them ever
cared how the economist arrived at that number. Only the input's own
`value`/`onChange` convert at the boundary: displayed as
`valueOf(MAX_RANK) - targetSubsidy`, and a typed demand is turned back into
`valueOf(MAX_RANK) - demand` (clamped to `[0, valueOf(MAX_RANK)]`, same
range the field always enforced) before being written via
`onUpdateTargetSubsidy`. This is a lossless round-trip (both quantities are
plain integers and `2048 - (2048 - x) = x` exactly), so **no new persisted
field, no migration, and no schema change was needed at all** — an older
save's own `targetSubsidy` number keeps meaning exactly the same real
subsidy DR amount it always did; only how it's typed/displayed in this one
input changed. Applies to both the main list's and Recompletion's own Total
Subsidy card identically, since both render through this same
`BoardEditor.jsx` component (full parity, same as every other shared field
here) — no extra work needed for Recompletion specifically.

Verified live: typing `500` into Total demand (fresh segment, no prior
state) showed "Subsidy needed (2048 − 500 demand): 1548 DR" immediately: a
2-board list with Board 1 set to 1548 DR showed `Total (all boards): 1548
DR` and the Goal readout at `1548 / 1548 DR` with a green checkmark, and
Board 2 auto-filled to `0 DR` (read-only) exactly as the pre-existing
auto-fill effect already guaranteed — confirming the new demand-based input
feeds the exact same, unmodified downstream machinery.

**Board 1 is special.** The first board a player sees for a given segment
always guarantees at least three ascending small-ish items among its placed
items (starting at that board's own `minRank`, not hardcoded to rank 1 — see
below), so early merges always have small pieces to combine. This is
implemented via `generateCandidateWithSmallRanks` and should stay scoped to
board index 0 only, not all boards.

**Board 1's semi tiles are always rank 1.** By explicit economist request —
semi tiles are visible and mergeable from turn zero, so keeping every one of
them the single smallest, simplest, most predictable bootstrap item (rather
than whatever the distance-ordered noisy queue, or the onboarding-goal
search below, happened to land on) keeps the very start of the game uniform.
This is unconditional and independent of whether an onboarding goal is even
set (`placement.js`'s `generatePlacement`, `isFirstBoard` branch). Scoped to
board 0 only — every other board keeps assigning semi ranks via the ordinary
distance-ordered noisy queue, unchanged. Two consequences worth flagging:
- With 2+ semi tiles, they're now always duplicate rank 1s. That's not the
  dead end it sounds like (a `stuck` item can always be bootstrapped by a
  fresh generator-produced rank-1, one at a time — see "Merge legality" in
  Play Tester below) but it does mean bootstrapping **each** semi tile now
  costs its own DR unless the board's own merge chain reaches it for free —
  a real cost this rule accepts, not an oversight.
- The onboarding-goal search (below) had to change its own strategy to
  match: the blocked queue it front-loads needs to climb in **ascending**
  order (2, then 3, then 4, ...) to meet a rank-1-bootstrapped chain as it
  grows, not descending (biggest-revealed-first) — descending was the right
  call under the old design, where the search could put a big anchor item
  directly on semi and skip the bootstrap step entirely. Found live: for the
  same blocked-item set, `[2,3,4]` reached the target within budget while
  `[4,3,2]` did not. `computeOnboardingReserve` now tries both orderings per
  candidate rather than assuming one is always better.

**One fixed exception: `FORCED_SEMI_CELL` (`board.js`, currently row 2 /
col 4, 0-indexed) always holds rank 2 instead of rank 1.** By explicit
economist request. Every other semi tile on board 0 still follows the
plain rank-1 rule above unchanged. Unlike the rank-1 rule, this is enforced
at the tile-*type* level too, not just at rank-assignment: `board.js`'s
`applyForcedSemiCell` coerces that cell to tile-type `"semi"` even if the
economist painted it as `"open"` or `"blocked"` — applied in three places
that all need to agree: inside `placement.js`'s `generatePlacement` itself
(so `placeItems` is correct regardless of caller, including
`computeOnboardingReserve`'s isolated feasibility checks), in
`BoardEditor.jsx`'s `updateBoard` (so paint/fill-all/resize/preset-apply can
never quietly paint over it), and again in `handleGenerate` as a belt-and-
suspenders for a freshly-created board whose tiles were never touched. A
board smaller than 3 rows or 5 cols has no such cell — `applyForcedSemiCell`
no-ops rather than erroring, matching this app's usual best-effort
convention for a layout rule that doesn't fit every board size. This forced
extra DR (`valueOf(2)=2` instead of `valueOf(1)=1`) had to be threaded
through both halves of the exact-sum invariant: `generatePlacement`'s own
`semiValueTotal` (now summed by real value, not tile count) and
`computeOnboardingReserve`'s `semiItems`/`reservedValue` (which places the
forced rank-2 at the matching row-major index via `forcedSemiIndex`, so the
isolated feasibility check's fixed semi cost matches what the real board
will actually carry) — skipping either would have quietly overshot
`blockedValue` by 1 DR or made the onboarding search's isolated check
diverge from the real board, exactly the class of bug the "two things can
make [the onboarding] guarantee not actually hold on the real board" note
below already warns about.

**Recompletion-only "RC event mode" adds a SECOND forced semi cell right
next to the first — it does not change FORCED_SEMI_CELL's own rank at
all.** By explicit economist request ("the rank2 will be fixed, next to it
will be the highest rank in the queue"). A per-board toggle
(`board.rcEvent`, default `false`) surfaced only on Recompletion's board 0 —
`BoardEditor.jsx`'s `isFirstBoard && isRecompletion` gate (the
`isRecompletion` prop is `true` only on the Recompletion `<BoardEditor>`
call in `App.jsx`; the main list never shows this toggle at all). Under
`rcEvent`, `FORCED_HIGHEST_RANK_CELL` (`board.js`, row 2 / col 5 — the cell
immediately right of `FORCED_SEMI_CELL`) is *also* coerced to tile-type
`"semi"` (`applyForcedHighestRankCell`, same no-op-if-the-board-is-too-small
convention as `applyForcedSemiCell`), and `generatePlacement` gives it
whichever item ends up the single highest rank in the blocked-queue
*remainder* — never the onboarding reserve, whose items are load-bearing
for a separate guarantee and are never touched by this. `FORCED_SEMI_CELL`
keeps its unconditional rank 2 either way, sitting right next door.

This design arrived by elimination, and the two rejected shapes are worth
knowing so they don't get reintroduced as "simplifications": v1 had
`rcEvent` *redirect* `FORCED_SEMI_CELL`'s own rank to the highest-rank item
(so the rank 2 disappeared whenever the toggle was on); v2 additionally
dropped the forced-cell requirement entirely under `rcEvent`, letting the
economist paint row 2 / col 4 freely and swapping onto whichever semi tile
sorted first by distance-to-open. Both were explicitly walked back — the
end state keeps the fixed rank-2 anchor *and* adds the highest-rank item
beside it.

The highest-rank assignment is a real **swap**, not a one-way move: the
remainder slot that gave up its high-rank item gets the target cell's own
rank-1 placeholder in return. A one-way move silently drops
`valueOf(1) = 1` DR from the board's total every time (found live during
v1, caught by the sum-vs-target check reading 199/200); trading two slots'
values keeps both the exact-sum invariant and the remainder's own item
count intact for free, with nothing above it needing to be re-derived.
`computeOnboardingReserve` (`onboardingGoal.js`) deliberately takes **no**
`rcEvent` parameter — it briefly did during v1, when the forced cell's rank
was rcEvent-dependent and the isolated feasibility check had to match. It
no longer needs one: `FORCED_SEMI_CELL`'s rank 2 is unconditional again,
and the second cell is an ordinary rank-1 placeholder until the
post-generation (sum-neutral) swap, so the isolated check's fixed-cost math
is identical either way. Toggling `rcEvent` invalidates the board's
already-generated layout like any other subsidy/rank-window edit (routes
through `updateBoard`/`invalidateLayout`), so a stale layout generated under
the old setting can never be mistaken for one generated under the new one.

**Item generation invariant: exact sum, best-effort everything else — except
the rank floor on non-first boards, which is now hard.**
`generateCandidate(target, desiredCount)` decomposes `target` into powers of
two (binary decomposition) then repeatedly splits the largest splittable item
in half until the item count reaches `desiredCount`. This **always**
preserves the exact sum. Item count is soft everywhere — the loop stops early
rather than breaking the sum if every item bottoms out at rank 1 first.

The `[minRank, maxRank]` window used to be soft on both ends (best-effort,
could leave a lone item outside it) — **the floor is now hard for
`generateCandidateInRange`** (every board after the first; board 0 keeps the
old best-effort behavior, see below), by explicit economist request: every
item's value is a power of two, and a sum of values all `>= valueOf(minRank)`
is only exactly possible when the target is itself a multiple of
`valueOf(minRank)` — otherwise there is no exact decomposition at all, floor
or no floor. `raiseUndersized` (`rankWindow.js`) handles this by rounding the
target up to the nearest multiple of `valueOf(minRank)` (at most
`valueOf(minRank) - 1` DR of overallocation, only when the exact target isn't
already a multiple — never rounds down, so the board's blocked value never
comes in under what was configured). `BoardEditor`'s "Sum vs. target" check
reflects this: `sum >= target` is OK, with a note explaining the overallocation
when it happens. The ceiling (`maxRank`) was already effectively hard
(`splitOversized` always fully splits anything above it, no escape valve) —
this change just brings the floor in line with it.

**A real bug, found during an audit of the playthrough simulator's fidelity
(not from a bug report): a low `maxRank` relative to `blockedValue` and tile
count could make `generateCandidateInRange`/`generateCandidateWithSmallRanks`
generate MORE items than there were physical tiles for — and the item count
those two functions were told to hit (`desiredCount`) was silently violated,
not just occasionally "soft."** Both functions used to pad toward
`desiredCount` (via `generateCandidate`'s own internal `splitToCount`) BEFORE
enforcing the `maxRank` ceiling (`splitOversized`, applied afterward by the
caller) — and `splitOversized` can only ever ADD items (splitting one
oversized item into two smaller ones), never remove any, so whenever the
ceiling forced it to run, it could push the final count well past
`desiredCount` with nothing downstream re-checking. The `canReserve`/`popcount`
pre-check that decides whether to attempt the variety reservation at all has
the same blind spot — it predicts item count assuming no ceiling exists at
all, so it can OK a reservation that the ceiling then blows past.

The consequence wasn't just an oversized array — `placement.js`'s per-tile
assignment (`orderedPositions.forEach((pos, i) => { const rank = queue[i];
... })`, non-first-board branch) only ever reads the first `positions.length`
entries of the ascending-sorted queue, so any excess silently vanished,
keeping the smallest (least valuable) items and discarding the rest. Board
0's `isFirstBoard` branch doesn't even truncate at generation time — the full
oversized `blockedQueue` got saved as-is, so the loss happened later, live,
inside `mergeSimulation.js`'s `revealNeighbors` (which can only ever reveal
as many items as there are physical blocked tiles) — meaning `board.blockedQueue`
could contain entries that would NEVER be revealed by any real playthrough,
no matter how the board was played. Found live with a reproducible case: a
board configured for 200 DR across 8 tiles at `maxRank` 3 generated 51 items
(only 8 tiles could ever reveal), and only 32 DR (`8 × valueOf(3)`) was ever
actually deliverable in play — 84% of the configured subsidy silently
unusable. Worse, the editor's own "Sum vs. target" check showed a
**false-positive green checkmark** on board 0 in this case (`stats.sum`
summed the entire, uncapped `blockedQueue` — including the stranded tail —
so it read `200/200` even though the real board could only ever hand out 32).

**Fixed at the root: `rankWindow.js`'s `decomposeInWindow(target,
desiredCount, minRank, maxRank)` enforces the ceiling FIRST, before ever
padding toward `desiredCount`, so padding can never blow past it again** —
the same order `onboardingGoal.js`'s own `decomposeReserved` already used
safely (`splitOversized` before `splitToCount`), generalized. It computes the
TRUE minimum item count needed to represent the (minRank-rounded) target
within `[minRank, maxRank]` via `minItemCount` (working in units of
`valueOf(minRank)`: as many `maxRank`-sized items as fit, plus one item per
set bit of whatever's left over) — deliberately NOT the naive "does the raw
value fit under `desiredCount × valueOf(maxRank)`" bound, which is necessary
but **not sufficient**: verified by brute force that 31 DR genuinely cannot
be built from 8 items each capped at value 4, even though `31 < 8×4 = 32`,
because reaching an odd sum forces at least one item below the ceiling and
no swap-down within `{1,2,4}` ever costs exactly 1 unit — every achievable
total below 32 in 8 such items jumps by at least 2. When the true minimum
exceeds `desiredCount`, it's genuinely infeasible — `decomposeInWindow`
returns exactly `desiredCount` items, all at `maxRank` (the most that many
tiles at that ceiling can ever hold), rather than generating more than there's
room for and leaving a caller to silently truncate. Both
`generateCandidateInRange` and `generateCandidateWithSmallRanks` now
**validate** their own reservation attempt's real result length before
trusting it (`candidate.length <= desiredCount`), falling through to
`decomposeInWindow` whenever it doesn't fit — the reservation is still tried
first, purely for its variety guarantee, when it's actually achievable.
`placement.js`'s per-tile assignment loop is now provably safe with no code
change needed there — the queue it reads from can never be longer than the
tile budget again. `BoardEditor.jsx` gained one new message (`stats.sum` short
of `board.blockedValue` with `!overallocated`) explaining the genuinely-
infeasible case specifically, distinct from the existing "rounded up" note —
the existing `!countOk`/"Best-effort undershoot" message needed no change,
since overshoot (the dangerous direction) is no longer possible; only
legitimate undershoot (too little value to fill every tile) remains, which
that message already described correctly.

Deliberately did **not** touch `onboardingGoal.js`'s own `decomposeReserved`
— it already applies `splitOversized` before `splitToCount`/`mergeUndersized`
in the safe order, so it was never exposed to this bug in the first place
(confirmed by re-reading it during this audit, not assumed).

**Board 0's small-rank guarantee is now also a hard floor, matching every
other board — this was a real bug, not just an inconsistency, found live
from a report of `minRank=3` still producing rank-1 items.**
`generateCandidateWithSmallRanks` used to hardcode `GUARANTEED_RANKS =
[1, 2, 3]` regardless of `minRank`, and its own remainder used the old
best-effort `mergeUndersized` (leaves a lone unpaired stray below `minRank`)
instead of `raiseUndersized` — both could put a rank 1 or 2 item on board 0
even with `minRank` set well above that, exactly backwards from "the rules
[minRank] are more important than hitting [the exact DR amount]." Fixed by
deriving the guaranteed set from `minRank` itself
(`guaranteedRanksFor(minRank, maxRank)` — three ascending ranks starting AT
`minRank`, degrading to fewer when the window is too narrow for three) and
switching every branch (the reserved-set remainder, and the final fallback
when even the small-rank set can't be reserved at all) to `raiseUndersized`.
Board 0 can now overallocate `blockedValue` the same way every other board
already could — the existing "Sum vs. target" UI check already handles
`sum >= target` as OK, so no UI changes were needed, only the generation
math. Deliberately did **not** touch `onboardingGoal.js`'s own separate use
of `mergeUndersized` (in `decomposeReserved`, for the onboarding-goal
reserve ladder) — that function decomposes a specific, already-computed
`value` that `computeOnboardingReserve`'s exhaustive search is counting on
being exact; making it overallocate would silently break that search's own
value accounting, a materially different problem from "the primary
generation path should overallocate at the source." Also deliberately did
**not** touch the separate "Board 1's semi tiles are always rank 1" rule or
`FORCED_SEMI_CELL`'s fixed rank 2 (both above) — those are unconditional,
by-design simplicity/predictability rules, not an attempt to hit a DR
target, so they don't fall under this fix; a semi tile or the forced cell
can still show a rank below a configured `minRank`. If that also needs to
respect `minRank`, that's a separate, explicit ask — don't assume it's
covered by this fix.

**Board-position hard floors: Board 2 never gets rank 1, Board 3 never gets
rank 1 or 2 — regardless of that board's own configured `minRank`.** By
explicit economist request. `rankWindow.js`'s `effectiveMinRank(minRank,
boardIndex)` is `Math.max(minRank, floor)` where `floor` comes from a small
`{1: 2, 2: 3}` index lookup (`hardMinRankFloor`) — index 1 is "Board 2" in
the UI's 1-indexed naming, index 2 is "Board 3". It only ever *raises* the
effective floor, never lowers it — a board manually configured to `minRank
5` on position 2 stays at 5. Positional, not main-list-specific: it fires
off `boardIndex` alone, the same way the wave-board row cap (`isFirstBoard ?
20 : 3`) is positional rather than keyed to which list a board sits in, so
Recompletion's own 2nd/3rd boards get it too. Board 0 is never affected —
positions 1 and 2 can never coincide with `isFirstBoard`, so there's no
interaction with the small-rank guarantee or the rank-1 semi rule above.

Every place that needs to agree on what the real floor is calls through
this one function rather than reading `board.minRank` directly, so none of
them can drift out of sync with what generation actually produced: the
non-first-board branch of `placement.js`'s `generatePlacement` (both the
`generateCandidateInRange` call and the min/max-variety check),
`BoardEditor.jsx`'s own stats (the variety check and the "Rounded up by
X DR" overallocation note — both would otherwise cite the raw, pre-floor
`minRank`), and `ccManagement.js`'s `summarize`/`suggestQueues` (so CC
Management's queue-suggestion preview for Board 2/3 can't show a rank-1 or
rank-2 item that "Generate items" could never actually produce there —
`suggestQueues`/`boardSuggestionsToSyntax` all thread a `boardIndex` through
for exactly this). `BoardList.jsx`'s "Min rank" field shows a hint
(`hardMinRankFloor(i)`) explaining the exclusion on these two boards rather
than silently ignoring whatever the economist types there — the field
itself isn't clamped or disabled, matching this app's existing "hard floor
overallocates rather than fighting the input field" precedent from the
rank-window invariant above.

**Placement: distance-to-player queue, not a sorted ramp.** Items are not
just sorted ascending onto tiles in reading order. The rule is:
1. Compute each blocked/semi tile's grid distance to the nearest `open` tile
   (multi-source BFS) — this is "distance to the player."
2. Sort tiles by that distance, closest first.
3. Take the ascending-sorted item list and run it through
   `buildNoisyQueue(items, noise)` — a few passes of probabilistic adjacent
   swaps that keep the sequence *mostly* increasing but let it dip and
   recover locally. Noise is tunable (0 = strict ascending).
4. Assign the queue to the distance-ordered tiles.

The result: tiles near the player tend to be smaller, tiles far tend to be
bigger, but it's not a rigid staircase. Preserve this two-step
(distance-order, then noisy-queue) structure — don't collapse it back into a
single sort.

**Economist-authored exact placements: `board.forcedSemiRanks`.** By
explicit economist request ("insert a specific rank into a cell in the
board, as semi blocked"). `BoardEditor.jsx`'s brush toolbar grows a **"Rank"**
row whenever the Semi-blocked brush is selected — "Auto" (the ordinary,
pre-existing behavior: generation decides) plus one button per rank 1-12.
Picking a rank and then painting a semi tile stores `{row, col, rank}` in
`board.forcedSemiRanks` (a plain array, per-board — not shared across a list
the way `targetEv`/generator tiers are, since it's about one specific board's
own cells) in addition to the ordinary tile-type paint.

**This is a durable placement `generatePlacement` itself respects, not a
fleeting hand-tweak** — unlike everything else painted on the grid (which
only sets tile *type* and leaves rank entirely to generation), a forced
entry survives "Generate items" instead of being wiped and recomputed by it.
Both branches of `placement.js`'s `generatePlacement` carve a forced cell's
value out of `blockedValue` before generating the rest, the same "reserve,
then decompose the remainder" shape `FORCED_SEMI_CELL`/the onboarding
reserve/the RC-event swap already use — so the exact-sum invariant holds
automatically, the same way it does for every other reservation in this
file:
- **Board 0** (`isFirstBoard`): every semi tile already gets its rank from a
  simple per-position rule (rank 1, or rank 2 at `FORCED_SEMI_CELL`) that
  feeds directly into `semiValueTotal`, so a forced override just replaces
  that one lookup — `semiValueTotal` (and the remainder-target math that
  reads it) picks up the real value automatically, no separate reservation
  step needed.
- **Every other board**: semis and blocked tiles share ONE interleaved
  distance-ordered queue, so a forced cell's value is subtracted from the
  target up front and `remainderDesired` (the item count `generateCandidateInRange`
  is asked for) is reduced by one per forced cell — then, when the generated
  queue gets walked onto `orderedPositions`, a forced position takes its
  fixed rank directly instead of consuming a queue slot (`queueIndex` only
  advances for non-forced positions).

**`FORCED_SEMI_CELL`/`FORCED_HIGHEST_RANK_CELL` can never be targeted by
this** — both `generatePlacement` (which excludes them from the forced-rank
lookup map entirely, so even a stale/malicious entry there is inert) and
`BoardEditor.jsx`'s paint handler (which refuses to add an entry there in
the first place) agree: those two pre-existing, unconditional rules always
win at their own fixed cells. A forced entry is also dropped the moment its
cell stops being tile-type `'semi'` — repainting it open/blocked prunes the
override immediately (`BoardEditor.jsx`'s `handlePaint`), and
`generatePlacement` ignores any stale entry that slips through anyway (e.g.
from an older save), so a forced rank can never silently reappear on a cell
that's since been repainted to something else. Picking "Auto" and
repainting a semi cell is how the economist clears a previously-forced rank
and hands it back to generation.

**A forced cell previews its pending rank on the grid immediately, before
"Generate items" ever runs** — `BoardGrid.jsx`'s `forcedRanks` prop (fed
`board.forcedSemiRanks`) renders the same number/DR overlay a real,
generated placement would, but at reduced opacity with a small white corner
dot, and a tooltip saying "forced - applies on next Generate" — so painting
a forced rank gives immediate visual confirmation without waiting for a
regeneration, but still reads as distinct from the real thing. The moment
`board.semiPlacements` has a real entry for that cell (post-generation), the
preview steps aside and the real placement renders exactly as it always
has.

If a forced value alone exceeds a board's whole `blockedValue` (mathematically
impossible to also fit the rest of the budget), generation degrades the
same honest way every other overallocation case already does — the forced
rank is still honored in full, the remainder generates as close to nothing
as the leftover (negative, clamped to 0) budget allows, and the "Sum vs.
target" check reports the real, larger total rather than silently
truncating or erroring. Verified live: a forced rank whose value alone
exceeds `blockedValue` still renders correctly and the sum check reflects
it honestly.

**A forced entry that happens to sit at exactly `minRank`/`maxRank` must
tell `generateCandidateInRange`'s own separate variety-reservation not to
ALSO reserve that same rank from the remainder — real bug, found live from
an economist report ("min & max both present" failed even after forcing a
semi tile to `maxRank`).** The non-first-board branch's own
"reserve-then-decompose" carve-out (above) already reduces the remainder's
target/count by the forced item's value/slot before generation ever
runs — but `generateCandidateInRange`'s *own*, older, separate mechanism
(one item at `minRank` AND one at `maxRank`, reserved up front so the
result always shows variety — see "Item generation invariant" below) had no
idea a forced item already covered one of those two, and kept trying to
carve out a SECOND, redundant item at that same rank from the
already-shrunken remainder. That wastes budget/count the *other*, still
genuinely-unmet side needed, and can make the whole reservation fail where
it would have succeeded with the full budget — even though the forced item
itself already legitimately satisfies that side. Fixed by teaching
`generateCandidateInRange` two new optional flags, `skipMinReserve`/
`skipMaxReserve` (default `false`/`false`, reproducing the exact original
behavior for every other caller — `ccManagement.js`'s `suggestQueues` never
passes them): `placement.js` sets whichever flag applies whenever a forced
rank already equals `minRankFloor` or `maxRank`, freeing the remainder to
spend its (now-undiminished) reservation effort on only the side that
genuinely still needs it. This is a **best-effort improvement, not a hard
guarantee** — same as the pre-existing variety reservation it patches
(still skipped if genuinely infeasible, still falls back to
`decomposeInWindow`) — but resolves the reported case (verified live: a
board with `maxRank` forced onto a semi tile now shows `hasRangeVariety:
true`, with the freed-up remainder budget producing a real `minRankFloor`
item too, where it previously failed).

**"Generate items for all N boards" — a second button in the Placement
card, alongside the original single-board "Generate items."** By explicit
economist request ("a placement generate items will generate items for all
boards"). Deliberately additive, not a replacement: the original button is
unchanged (still regenerates only the active board, useful for fine-tuning
one board's layout without disturbing the rest of the list) —
`handleGenerateAll` (`BoardEditor.jsx`) runs the *exact same* per-board
pipeline (`placeItems`) once per board in `boards`, using this board's
currently-set `noise` value for all of them.

Each board gets its **own** correct settings, not the active board's -
`isFirstBoard`/`onboarding`/`rcEvent`/`boardIndex` are all recomputed per
loop iteration (`i === 0`, that board's own `onboardingDrBudget`/
`onboardingTargetRank`, that board's own `rcEvent`), mirroring
`handleGenerate`'s own per-board logic exactly rather than assuming
whichever board is currently active represents all of them. A standalone
`forceCellsFor` (not the closure's own `forceCells`, which is scoped to the
active board) applies `FORCED_SEMI_CELL`/`FORCED_HIGHEST_RANK_CELL` per
board being generated, keyed off *that* board's own `rcEvent`. Every board
update goes through `onUpdateBoard` (not the active-board-only `onChange`)
— calling it once per board, synchronously, in a loop is safe: `useBoardListState`'s
`updateBoard` uses React's functional `setState` form
(`bs.map(...)`), so N calls queued within one event handler compose
correctly instead of each clobbering the previous board's write. Verified
live across a 2-board list with different `blockedValue`s (100 and 50):
one click correctly regenerated both, each hitting its own exact target sum
and its own item count.

**Board layout presets are literal, not generative, and economist-authored.**
There are no shipped/hardcoded presets — `presets.js`'s `createPreset` just
snapshots whatever tile pattern the economist is currently looking at in the
editor (via the "Suggestions" card's Save button), at whatever size that
board happens to be. `applyPresetToBoard` then stamps that literal grid onto
another board, top-left aligned; cells outside the preset's original
`rows × cols` default to `"open"` rather than extending the pattern — this is
a known limitation (presets don't scale to a board bigger than the one they
were captured on), not a bug to silently "fix" by inventing pattern-extension
math. Do not replace this literal-stamp behavior with procedural generation
without being asked — the whole point is that it's a faithful copy of a
layout the economist hand-approved.

**Multiplier tiers (generator).** x1 costs 1 DR / normally drops rank 1 and
is always available (no unlock rank). x2 costs 2 DR / rank 2; x4 costs 4 DR /
rank 3. Both unlock once the player's cumulative effort reaches a configured
rank — **economist-editable now** (`board.tier2UnlockRank`/
`tier4UnlockRank`, defaulting to 7/10, in `BoardEditor.jsx`'s "Generator
tiers" card), by explicit economist request ("add the option in the board
editor to pick which tier will give the multipliers... make sure all the
model will know how to handle those changes"). These are pinned to absolute
chain rank, not DR amount, so they still fire at the same *rank* for every
segment even though segments need different total DR to reach that rank —
that part of the design didn't change, only who gets to set the rank. The
unlock check is dynamic, keyed off the player's *current* max rank **held**
(`currentMaxRank`), not a ratchet on the best rank ever reached — see "Tier
re-lock is resolved as dynamic" below. The automatic simulator
(`simulatePlaythrough`) always greedily spends at the highest unlocked tier
via `currentTier`; the interactive play tester lets the player pick *any*
currently-unlocked tier via `unlockedGeneratorTiers` (see "Play Tester"
below) — those are deliberately different behaviors for the same underlying
thresholds, not a bug to reconcile.

**Shared per board list, same `targetEv`/`rewardRanks` mechanism** — every
board in a list plays through the same generator ladder, so a customized
unlock rank belongs to the event, not to whichever physical board happens
to be active. `useBoardListState.js`'s `syncGeneratorTiers(patch)` is the
one write path (`BoardEditor.jsx`'s "Generator tiers" NumberFields call it
via the `onUpdateGeneratorTiers` prop), writing onto *every* board in that
list at once; `addBoard`/`setBoardCount` inherit the list's synced values
via the shared `sharedFields()` helper (alongside `targetEv`/`rewardRanks`),
and `App.jsx`'s `normalizeBoards` backfills defaults and re-syncs every
board to board 0's values on load/import, so an older save (or one from
before this feature existed at all) can't carry stale per-board differences
or a missing field. Main and Recompletion each get their own independent
pair of values, matching every other shared-per-list field's precedent.
Values are clamped to `[MIN_RANK, MAX_RANK]` but deliberately **not** forced
to keep `tier4UnlockRank` above `tier2UnlockRank` — `unlockedTiers`/
`currentTier` pick the highest-*cost* unlocked tier independently per tier
(see below), so an unconventional configuration (x4 unlocking before x2)
still resolves correctly, just unusually; not worth fighting the input over.

**`generatorTier.js`'s `GENERATOR_TIERS` constant is a default/fallback
only — every real caller builds its own tiers from a specific board's
configured ranks via `buildGeneratorTiers(tier2UnlockRank, tier4UnlockRank)`,
never reads the bare constant.** This was a genuine refactor, not just an
addition: before this, `GENERATOR_TIERS` was a fixed module-level array
baked from two now-renamed constants (`TIER2_UNLOCK_RANK`/
`TIER4_UNLOCK_RANK`, now `DEFAULT_TIER2_UNLOCK_RANK`/
`DEFAULT_TIER4_UNLOCK_RANK` — defaults a fresh `createBoard` seeds from, not
the live value), and `unlockedTiers(maxRankHeld)`/`currentTier(maxRankHeld)`
read it directly with no way to vary it. Both now take an explicit `tiers`
array as a second parameter (still defaulting to `GENERATOR_TIERS` as a
safety net for any caller that genuinely has no board in scope). Every real
consumer was updated to build and pass its own board-derived tiers:
- `mergeSimulation.js`'s `simulatePlaythrough` reads `tier2UnlockRank`/
  `tier4UnlockRank` from the starting board (`options.tier2UnlockRank`/
  `tier4UnlockRank` as an explicit override, same precedent as `targetEv`,
  for isolated/synthetic boards), builds `tiers` once, and uses it for
  `currentTier`.
- `playSession.js`'s `createPlaySession` fixes `session.tier2UnlockRank` and
  `session.tiers` at session creation from the starting board (same
  "fixed at creation, not re-read from a later wave board" rule
  `session.targetEv` already followed) — `currentGeneratorTier`/
  `unlockedGeneratorTiers`/`spendGenerator` all read from `session.tiers`/
  `session.tier2UnlockRank` instead of the old constant.
- `eventSheets.js`'s `buildMultipliersSheet(boards)` and
  `buildGeneratorWeightsSheet(boards)` both call a shared
  `generatorTiersFor(boards)` helper reading **Board 1's own** configured
  ranks (same "one canonical event-level value" precedent as
  `TutorialDrAmount`/`targetEv` above) — `buildMultipliersSheet` gained a
  `boards` parameter it didn't previously need; every caller
  (`SyntaxPage.jsx`'s generic `SHEET_BUILDERS[view]?.(boards)` dispatch,
  `buildWorkbook`, `buildAllSheetsAsValueRows`) already passed `boards`
  positionally or was updated to.
- `PlayTester.jsx`/`PlayStage.jsx` render their tier-picker UI from
  `session.tiers` instead of the module-level `GENERATOR_TIERS` import.

**The lucky-drop unlock gate moves WITH a customized `tier2UnlockRank` —
this is the one relationship that would have silently broken if only the
tier-unlock plumbing above had been threaded through.** Both
`mergeSimulation.js` and `playSession.js` gate lucky drops on "does the
player hold an item at the x2 tier's own unlock rank" — previously a
literal `maxRankHeld >= TIER2_UNLOCK_RANK` constant comparison in each file,
now `maxRankHeld >= tier2UnlockRank`/`session.tier2UnlockRank` reading the
same board-configured value `currentTier`'s own tiers array uses. Getting
this wrong (leaving the gate on the old hardcoded constant while making the
tier's own unlock rank configurable) would have silently decoupled two
things this app has always described as one rule ("lucky drops only open
once the player holds a rank-7+ item — same threshold as the x2 tier
unlock") — exactly the class of bug this codebase's own audits keep
finding. `BoardEditor.jsx`'s "Lucky drops" card captions (which previously
hardcoded "rank-7") now read `board.tier2UnlockRank` too, so the on-screen
explanation can never disagree with the board's actual configured
threshold.

Verified live end-to-end (not just built): a board configured with
`tier2UnlockRank=3`/`tier4UnlockRank=5` (rather than the default 7/10) shows
x2 first unlocking at rank 3 in `currentTier`, in a real `simulatePlaythrough`
run, in `createPlaySession`'s `session.tiers`, and in both the Multipliers
and Generator Weights Ops sheets — and editing the "x2 unlocks at rank"
field in the UI live-updates the Lucky Drops card's caption in the same
render, confirming the shared-list sync path actually reaches the screen,
not just the data layer.

**Lucky drops.** One shared expected-value multiple (`targetEv`, e.g. 1.1x)
applies uniformly across all three tiers within a board. The distribution is
solved as a geometric decay: `p(normal) = p0`, `p(+1 rank) = p0*k`, where `k`
is the positive root in (0,1) of `(1 + 2k + 4k^2) / (1 + k + k^2) = targetEv`
(see `solveK`). Still intentionally a single free parameter per board — don't
add a second per-board dial without an explicit ask, that was a deliberate
simplification.

`p(+2 ranks)` is **not** a strict `p0*k^2` anymore — by explicit economist
request ("give the +2 more power"), it's `p0 * (BONUS2_BLEND*k +
(1-BONUS2_BLEND)*k^2)`, a fixed internal blend (`BONUS2_BLEND` in
`luckyDrop.js`, currently `0.2`) between that original pure-geometric decay
(`BONUS2_BLEND=0`, bit-for-bit the old formula) and "+2 decays no faster
than +1" (`BONUS2_BLEND=1`, `p(+2)=p(+1)` always). This is deliberately
still a *fixed constant*, not a second economist-facing field — the ask was
to reshape the curve itself, not add per-tier tuning (that remains
unasked-for; see the single-free-parameter note above). `0.5` was tried
first and rejected live: it pulled `+1` and `+2` too close together (~2x
apart at typical `targetEv` values, down from the original ~20x+ gap) —
`0.2` keeps `+2` clearly the rarer of the two bonus tiers (~3-4.5x rarer
than `+1` at typical `targetEv`) while still giving it a real, noticeable
boost (~2-3.3x more likely than the original curve at the same `targetEv`).
Both endpoints of the valid range are unaffected by `BONUS2_BLEND` — at
`k=0` (`targetEv=1`) and `k=1` (`targetEv=7/3`), `p(+2)` collapses to the
same value regardless of the blend, so `MIN_TARGET_EV`/`MAX_TARGET_EV` and
the ceiling behavior below didn't need to change at all; only the *interior*
curve shape moved. The effect is largest near typical/default `targetEv`
values and fades to ~1x (no difference from the original curve) as
`targetEv` approaches the `7/3` ceiling, where the distribution is already
forced close to uniform regardless of blend.

`targetEv` briefly went through a per-board-variation phase (each board
independently editable, for design/tuning flexibility) before reverting
back to one shared value per board list — by explicit economist request
("no need to enter new data... between different boards"), the *original*
per-segment-uniformity intent won out after all (segments aren't
implemented yet, see "Implementation status", so "per board list" is the
closest available granularity). It's still physically stored as a field on
every board object (`board.js`, default `DEFAULT_TARGET_EV = 1.1`) rather
than lifted into new top-level app state — `useBoardListState.js`'s
`syncTargetEv(value)` is the one write path the editor's "Lucky drops" card
now goes through (`BoardEditor.jsx`'s `updateTargetEv` calls the
`onUpdateTargetEv` prop, wired to `main.syncTargetEv` /
`recompletion.syncTargetEv` in `App.jsx`), and it writes the same value onto
*every* board in that list at once rather than just the active one. This
keeps every other `board.targetEv` reader (`mergeSimulation.js`,
`playSession.js`, `ccManagement.js`, `eventSheets.js`'s
`buildGeneratorWeightsSheet`, `boardSyntax.js`) completely unchanged — they
still read a real per-board field, it's just guaranteed identical across a
list by construction now. `addBoard`/`setBoardCount` (same file) inherit the
list's already-synced value for a newly created board instead of resetting
to the plain default, and `App.jsx`'s `normalizeBoards` re-syncs every board
to the first board's value on load/import, so a save or backup made during
the per-board-variation window doesn't keep stale per-board differences
alive after a reload. Main and Recompletion are still two independent board
lists, so each gets its *own* shared value (matching `targetSubsidy`'s
per-list precedent) — editing it on a main-list board never touches
Recompletion's, and vice versa. Don't read any of this as license to add
per-tier variation, which remains unasked-for.
`generateCandidateInRange`/`generateCandidateWithSmallRanks` don't touch
`targetEv` at all — it's a generator-RNG parameter read only at play time
(`spendGenerator`, `simulatePlaythrough`), never at item-generation time.

Both the automatic simulator and the play tester roll a bonus the same way
(same `computeProbs`, same rank-7-held gate as the x2 tier unlock — see
"Multiplier tiers" above) but via different mechanisms, deliberately: the
automatic simulator uses `createEvScheduler`'s deterministic deficit
round-robin (reproducible aggregate math, no randomness); the play tester
uses `rollBonus` (`Math.random()`-based genuine per-tap unpredictability,
since a real player doesn't experience a converging sequence). A lucky drop
in the play tester triggers a distinct celebration (`LuckyDropCelebration`,
tier by bonus amount: +1 = medium, +2 = big — never "small," a lucky drop is
always meant to feel like a moment) separate from `MergeCelebration`.
`session.targetEv` is fixed at play-session creation from the *starting*
board's own field and never re-reads a later wave board's value — lucky-drop
chance belongs to the generator/player, not to whichever tile pattern
happens to be visible.

**The geometric-decay model has a hard ceiling: `targetEv` only has a valid
solution in `[1, 7/3]` (`MIN_TARGET_EV`/`MAX_TARGET_EV`, `luckyDrop.js`).**
At `k=0`, EV=1 (never a bonus); at `k=1`, EV=7/3≈2.33 (as close to a flat
1/3-1/3-1/3 split as this specific 3-outcome model allows) — there is no
valid probability distribution for this formula above that. `solveK` clamps
its input to that range before solving (a target above 7/3 clamps down to
the k=1 distribution, not "more generous than that"), and clamps its own
output `k` to `[0,1]` with a small epsilon around the boundary (7/3 isn't
exactly representable in floating point, so the unclamped root can land a
hair outside `[0,1]` right at the ceiling and get wrongly rejected in favor
of the *other*, unrelated root — which silently produces the worst-possible
wrong answer, a collapse to "never any bonus," rather than an overshoot).
This was found live: exposing `targetEv` as a free-typed field surfaces this
ceiling constantly (any input past ~2.33, or CC Management's EV suggestions
math on a moderate base value) — treat any future change to this formula as
needing the same clamp-at-the-source treatment, not a "seems unlikely"
caveat.

**Lucky-drop simulator.** The editor's "Lucky drops" card has a "Run
lucky-drop simulation" button (`luckyDrop.js`'s `simulateLuckyDrops`) — a
Monte Carlo sanity check answering "if the generator gets tapped 450 times,
how many of each type should I expect?" Deliberately a fixed, board-agnostic
tap count (`LUCKY_SIM_TAPS = 450`) rolled 1000 independent times
(`LUCKY_SIM_RUNS`), not a real playthrough: every roll uses `probs` directly
via the same `rollBonus` the play tester uses, as if the rank-7 gate were
already unlocked for the whole run — it does **not** model a board being
played up to rank 7 first (that was an explicit simplification the
economist asked for over the alternative of wiring it into the real
per-board playthrough engine). Reports, per outcome, the mean and min–max
across the 1000 runs, plus a `zeroCount` — how many of the 1000 simulated
players never saw that particular bonus at all across their 450 taps. That
last number was a deliberate explicit ask, separate from the mean: an
average can look reassuring (e.g. "~3 +2 drops expected") while still
hiding a real shut-out rate (e.g. ~5% of players seeing zero, at
`DEFAULT_TARGET_EV`) that the average alone doesn't surface. The cached
result is cleared (`useEffect` keyed on `targetEv`) the moment the board's
target EV changes, so a shown result can never be silently stale for a
different EV than what's currently configured.

**Push / stall.** A daily pacing-gap trigger compares actual cumulative
progress to an expected day-N curve (currently 8/17/28/40/55/75/100 as % of
the 2048 chain, back-loaded so segments land around rank 11 — "FU," verge of
completion — roughly 2 days before the event ends). Players behind the curve
get a "push" DR-per-click factor (>1x) plus access to live blocked-tile
swaps and repeatable guaranteed lucky drops; players too far ahead get a
"stall" factor (<1x).

*Not implemented in code yet* (see "Implementation status" above) — there is
no pacing simulator, no push/stall factor, and no day-N curve anywhere in
`src/`. This whole section is design intent for future work, not a
description of `simulatePlaythrough` (which just runs a board to a DR budget
or max rank with no notion of "days" or a target curve at all). When this
does get built, it'll need real variance/spread modeling (Monte Carlo or
equivalent) from the start — the existing `simulatePlaythrough` and lucky
drop's `createEvScheduler` are both deliberately deterministic
expected-value machinery (see "Lucky drops" above), which is fine for what
they do but is not a substitute for player-to-player variance once pacing
gates start branching on "ahead of curve" vs "behind."

## Play Tester

`src/features/merge/components/PlayTester.jsx` + `src/features/merge/lib/playSession.js` let the economist
manually play a generated board — click/drag to move or merge, spend the
generator — as a ground-truth check against `simulatePlaythrough`'s
automatic result. It shares `mergeSimulation.js`'s core primitives
(`buildInitialState`, `buildReachability`, `performMerge`) with the automatic
simulator, so these rules apply to both:

- **Merge legality is fully position-agnostic**, by explicit economist
  decision: two same-rank items merge regardless of where they sit on the
  board — adjacent, far apart, or one fully boxed in with no empty-cell path
  to it. Don't reintroduce an adjacency or reachability requirement for
  merging; `buildReachability`'s connected-open-space graph is still used,
  but only for the separate "can this item *move* to that empty cell" check.
- **The `stuck` flag is what actually prevents free cascades**, not
  position. A semi tile's item starts `stuck`; a blocked tile's item becomes
  `stuck` the instant it's revealed. A `stuck` item can be merged *into* but
  can never be the mover, so two still-`stuck` items can never merge with
  each other on their own — some player-driven mover (something the
  generator placed, or a chain of merges rooted in one) has to reach it
  first. Once merged into, it clears (`stuck` → `false`) and is a fully
  normal item from then on — this is the "revealed but needs one more merge
  to fully clear" rule from the Boards section above, and it's the same for
  a semi-origin or blocked-origin item.
- **"Reaching" or "holding" a rank means holding a FREE item at that rank —
  a still-`stuck` semi/blocked-revealed item doesn't count, even though it's
  visibly sitting on the board.** A real bug, found live from an economist
  report ("we get a rank only when we hold it as a free item, not as semi
  blocked") and confirmed by tracing the actual mechanics: `mergeSimulation.js`'s
  `revealNeighbors` used to call `recordRank(revealedRank)` the INSTANT a
  blocked tile was revealed, before the very next line even finished marking
  it `stuck = true` — so a big item merely revealed (not yet merged into)
  got instant credit for "reaching" that rank. `recordAllOccupied` (called
  after every merge and every board-push) had the identical bug, crediting
  every occupied cell regardless of `stuck`. `currentMaxRank` — the function
  that gates generator-tier unlocks AND the lucky-drop threshold, not just
  a display stat — had it too: a big item sitting stuck on the board could
  unlock x4 or open lucky drops before the player had actually done anything
  to earn it. All three now skip `stuck` cells; `revealNeighbors` no longer
  calls `recordRank` at all on reveal (the trace `'reveal'` log event itself
  is unchanged — this only removes the erroneous credit, not the log). Fixed
  identically in both `mergeSimulation.js` (the automatic simulator) and
  `playSession.js` (the interactive Play Tester/Play Stage, which shares
  `recordAllOccupied`/`performMerge`/`currentMaxRank` with it) — the two
  never diverge on this rule.

  A concrete consequence worth knowing: the editor's "Playthrough
  simulation" card can show a rank reached (in cumulative-DR terms) *before*
  a lower rank, e.g. rank 10 at 50 DR and rank 9 at 98 DR — this is NOT a
  leftover symptom of the bug above; it's a real, still-possible outcome
  even with the fix in place (a genuinely free, big item can legitimately
  get merged together faster than a separate, slower chain reaches a lower
  rank elsewhere on the board — see "Placement: distance-to-player queue"
  and the board-chaining wave mechanic above for two real mechanisms that
  can cause it). `SimulationReport.jsx` highlights these rows in amber with
  an explanatory tooltip rather than showing a bare, confusing negative
  number — see "Playthrough simulation" further down for the display side of
  this.
- **The generator lets the player pick any currently-unlocked tier**
  (`unlockedGeneratorTiers`), defaulting to x1 even after x2/x4 unlock — it
  does not auto-force the highest tier the way the automatic simulator's
  greedy `currentTier` does. If the player's chosen tier re-locks (their
  qualifying rank-7/rank-10 item gets merged away), spending silently falls
  back to the highest tier still unlocked rather than erroring.
- **A merge reveals near where it visually happened, not near a stale
  origin.** `performMerge`'s `revealAroundMover` option is `true` for the
  automatic simulator always, but the play tester always passes `false` —
  a merge only ever reveals a locked tile next to the receiver, never next
  to wherever the mover started, even when the two were directly adjacent.
  Revealing next to the mover's old cell doesn't read as connected to the
  merge the player is watching happen at the receiver, confirmed by an
  economist report of exactly that (an adjacent one-cell merge revealing a
  tile two rows away, above the mover's old spot).

  **This asymmetry made "Compare to automatic simulator" compare a manual
  session against a DIFFERENT ruleset than the one it was actually played
  under — a real bug, found live from an economist report ("i did a test
  with the play tester and its not like the playthrough simulator") after a
  purely-greedy replay confirmed it wasn't about player skill at all.**
  `playSession.js`'s `compareToSimulator` used to call `simulatePlaythrough`
  with its own default (`revealAroundMover: true`, the automatic
  simulator's long-standing behavior) — but every merge the SESSION itself
  just played went through `mergeItems`, which always passes `false`. So the
  comparison was silently asking "how does your play compare to a
  hypothetical run that gets extra reveals your own merges could never
  produce," not "how does your play compare to what the SAME mechanics
  would achieve." `simulatePlaythrough` gained a real `revealAroundMover`
  option (defaulting to `true` — every existing caller is unaffected), and
  `compareToSimulator` now passes `false` explicitly, matching the session's
  own reveal rules exactly.

  Verified with a from-scratch proof, not just reasoning about it: played a
  session end-to-end using the exact same merge-priority function the
  automatic simulator itself uses (`pickMergeByStrategy(state,
  'free-free-first')`, plus draining inventory before spending — the same
  free-actions-first priority `simulatePlaythrough` follows), then called
  `compareToSimulator` at that session's own `drSpent`. Before the fix, the
  two diverged starting at rank 4 and grew to a **2x gap by rank 12** (1378
  DR played vs. 770 DR "compared") — a flawless, by-the-book playthrough
  reported as falling dramatically behind the simulator's own prediction,
  for no real reason of the player's doing. After the fix, every single
  reached rank's DR figure matched **exactly**, rank for rank, session vs.
  comparison. (An independent side check: running the automatic simulator
  itself at `revealAroundMover:true` vs `revealAroundMover:false`, each
  making its own best greedy choices rather than replaying the other's
  stale moves, showed the aggregate difference is actually small and never
  favors `true` — so this fix is not expected to make manual play look
  meaningfully worse against the old baseline once it's a fair comparison,
  it just makes the comparison honest.)

  Scoped deliberately narrow: only `compareToSimulator` changed.
  `simulatePlaythrough`'s own default (used everywhere else — Total
  Subsidy, Effort target, `SimulationReport`, the per-board checkmark
  badges) is untouched, so none of the app's existing board-design numbers
  shifted. This fix is specifically about making the Play Tester's own
  "how am I doing vs. the simulator" feature stop comparing two different
  rulesets against each other under one misleading label.
- **Native drag-and-drop drag images are timing-sensitive.** `handleDragStart`
  explicitly calls `setDragImage` on the tile *before* triggering any
  re-render that would restyle that same node (e.g. adding a selection
  ring) — if a future change re-renders the dragged node synchronously
  inside `onDragStart` before `setDragImage` runs, Chromium can intermittently
  show a corrupted/blank drag ghost. Keep the "grab the drag image first,
  defer the state update" ordering if you touch this handler.
- **RanksBar** (rendered above the board) is a game-style event-track
  showing progress toward rank `MAX_RANK`, one node per rank. It detects its
  own "just reached a new rank" moment internally (comparing against the
  previous render's `maxRankReached`), not something the caller signals —
  keep it a drop-in display, don't push milestone-detection logic up into
  PlayTester. `board.rewardRanks` (set in the editor's "Rank rewards" card,
  entirely optional, empty by default) marks which ranks get a gift badge;
  reaching a reward rank additionally fires a `MergeCelebration` burst
  layered on top of the plain scale+glow every rank gets — a reward is
  meant to read as a bigger deal than an ordinary tick. `rewardRanks` is
  purely a display marker: it doesn't feed generation, placement, or
  simulation at all, on purpose. `board.rewardSyntax` (an object keyed by
  rank number, e.g. `{2: "coins:50"}`) is the actual reward *content* for a
  marked reward rank, free-text, entered via a "Milestone reward syntax"
  input that appears per marked rank in the same "Rank rewards" card —
  deliberately a separate field from `rewardRanks` itself (not folded into
  one richer shape) so RanksBar/the celebration trigger/`boardSyntax.js`,
  which only ever cared about *which* ranks are marked, stay untouched.
  Exists purely to feed the "Item Ladder" Ops sheet (`eventSheets.js`'s
  `buildItemLadderSheet`, below) — like `rewardRanks`, it doesn't feed
  generation/placement/simulation either.

  **Both fields are one shared set across a whole board list**, not
  per-board dials, by explicit economist request ("the rank rewards...
  should be the same for all the boards — the boards are for the same
  interval of the game"): a milestone reward hangs off the *event's* own
  1–12 rank ladder, not off whichever physical board the player happened to
  be standing on when they hit that rank. Same machinery and the same
  reasoning as `targetEv` (see "Lucky drops" above) — still physically
  stored on every board object, with `useBoardListState.js`'s
  `syncRankRewards(patch)` as the one write path (`BoardEditor.jsx`'s
  `toggleRewardRank` and `updateRewardSyntax` both call it via the
  `onUpdateRankRewards` prop), writing onto *every* board in that list at
  once. `addBoard`/`setBoardCount` inherit board 0's copies via a shared
  `sharedFields()` helper (which now covers `targetEv` too, replacing its
  own one-off inheritance), and `App.jsx`'s `normalizeBoards` re-syncs every
  board to board 0's on load/import, so a save made before this rule doesn't
  keep stale per-board differences alive. Main and Recompletion each get
  their own independent shared set, matching `targetEv`/`targetSubsidy`'s
  per-list precedent. Nothing downstream changed: `buildItemLadderSheet`
  still reads board 0's copy, which is now identical to every other board's
  by construction rather than by convention.

## Board chaining (waves + inventory)

The board list (sidebar) doubles as a queue: **board 0 is the one actually
played; every board after it is a wave.** Once the active board has no
locked or unrevealed-stuck cells left at all (`boardIsCleared`), the next
board in the list pushes in as a strip of its own rows from the top
(`pushBoardIn`) — its own tile pattern, `semiPlacements`, and `blockedQueue`,
top-left column-aligned — shifting everything else down. Items shifted past
the bottom edge go into an inventory (a plain array of ranks) instead of
being lost; the player clicks an inventory chip and it drops immediately
onto a free cell (`placeFromInventory`, same `findSpawnCell` auto-placement
heuristic the generator uses — one click, no select-then-target step, by
explicit request), and the automatic simulator drains its own inventory
automatically (right after merging, before spending new DR — both are free
actions). This cascades through consecutive boards that clear
instantly (e.g. an all-open one) rather than stalling on the first empty one,
and simply stops firing once the list is exhausted — no error, no wraparound.

This is genuinely shared machinery, not something either consumer owns:
`boardIsCleared`/`pushBoardIn`/`advanceBoards`/`recordAllOccupied` live in
`mergeSimulation.js` and are called from both `playSession.js` (after every
merge — the only action that can clear the last locked/stuck cell) and
`simulatePlaythrough` (same trigger, plus it auto-places from inventory
before spending DR). Keep both callers going through these shared functions
rather than reimplementing the row-shift/overflow logic separately — they
need to agree exactly on what counts as "cleared" and how columns align.

**`boardIsCleared` used to treat a permanently-dead locked cell exactly like
one that just hadn't been handled yet — a real, root-cause bug, found live
from a recurring economist report ("Boards the player reached: 1/3", 144 of
1504 configured DR delivered) that survived several earlier fixes because
those fixes addressed the SYMPTOM (flagging/preventing a board with more
blocked/semi tiles than queue items — see `effortTargeting.js`'s
`boardChecks`) without touching the actual mechanical consequence.** A
locked tile is only ever revealed by `revealNeighbors` pulling the next
entry off that board's own `blockedQueue` — and `revealNeighbors` bails out
the instant `blockedQueueIndex` reaches `blockedQueue.length`, permanently.
So once a board's queue runs dry, ANY tile still `locked` at that point can
mathematically never be revealed again, by any sequence of merges, however
the board is played — there is no future action that changes that cell's
fate. The old `boardIsCleared` didn't distinguish this from a cell that
might still be revealed later — it required zero `locked` cells, full stop
— so a board misconfigured with even ONE more tile than its queue could
fill would block `advanceBoards` from ever pushing the next board in, for
the rest of the run. Every board after it, and every DR of subsidy on it,
was silently lost — not because of anything the player did, and not
recoverable by better play.

Fixed by making `boardIsCleared` check `state.blockedQueueIndex >=
state.blockedQueue.length` (that board's own queue, reset fresh by
`pushBoardIn` on every wave push — no leakage across boards) and only
letting a `locked` cell block progression while the queue could still
reveal it; once exhausted, a remaining locked cell is recognized as
provably dead and stops blocking. `stuck` cells got NO such exception —
unlike a locked cell, a stuck (revealed-but-uncleared) item can always
still be reached by some future mover, so nothing bounds how long that
might take; it keeps blocking unconditionally, as before. Verified with a
direct reproduction of the reported shape (a board with one more tile than
its queue could fill, 350/615/535 DR across 3 boards): before the fix,
boards reached 1/3, delivered 350/1502 DR, took 1546 DR to reach rank 12;
after, boards reached 3/3, delivered 1406/1470 DR, took 730 DR — only the
one genuinely-dead tile's own DR was lost, not the rest of the chain. A
matched, no-shortfall 3-board case (the same one verified earlier in this
file) produced byte-identical numbers before and after this change,
confirming zero regression for boards that were never affected by the bug.
`effortTargeting.js`'s own "N tiles with no item" badge reason (see "Effort
target" below) was reworded to match — it used to warn that the board
"never clears and no later board pushes in," which is no longer true after
this fix; it now correctly describes the remaining, real consequence (that
tile's own DR is wasted) without overstating it as chain-wide.

**A second, independent root cause of the same "boards never progress"
symptom — this one in the default MERGE-PRIORITY logic itself, not the
push-gate — found live from the economist's own theory ("maybe the
simulator doesn't know that merging next to a blocked tile/semi reveals
it") after the `boardIsCleared` fix above didn't fully resolve a repeat
report.** `findLegalMerge`'s default priority (used by both the automatic
simulator and, via `pickMergeByStrategy('free-free-first')`, everywhere
else that claims to reproduce it) has always preferred ANY free-free merge
anywhere on the board over EVERY free-into-stuck merge, by design ("keep
freshly-built items flexible" — see "Play Tester" above). That's usually
harmless, but it has one genuinely dangerous edge case: if a same-rank
bucket ever holds one STUCK item (a semi tile, most commonly — especially a
high-rank one placed via `board.forcedSemiRanks`, exactly the "rank 11 tile
in the first board" scenario the economist first flagged this concern
about, in an earlier session) alongside TWO OR MORE free items of that
SAME rank, the old priority lets the two free items merge with EACH OTHER
instead of either one clearing the stuck item — and once that happens, the
stuck item has ZERO remaining same-rank partners anywhere on the board. At
a high rank especially, another free item of that exact rank forming again
from scratch is unlikely before the run naturally ends (it stops the
instant rank 12 is reached), so the stuck item — and, via the
`boardIsCleared` mechanic above, potentially the entire rest of the board
chain — can be stranded FOREVER, not merely delayed. This is a genuinely
different failure mode from the item-shortfall bug above: no board
misconfiguration is required at all, just an unlucky (or, for a manually
forced high-rank semi tile, near-inevitable) coincidence of timing.

Hand-verified in isolation before touching the real code: built a
three-cell state by hand (one stuck rank-3 item, two free rank-3 items,
nothing else) and confirmed `pickMergeByStrategy(state, 'free-free-first')`
picked the two free items over the stuck one every time — proving the
mechanism, not just theorizing about it.

**Fixed with a new, higher-priority pass, `scanForStrandRiskMerge`, that
runs BEFORE the existing two-pass logic in both `findLegalMerge` (the fast
default path) and `pickMergeByStrategy`'s `'free-free-first'` branch (kept
as the exact same call so the two can never drift apart again).** It scans
for any rank bucket holding ≥1 stuck item AND ≥2 free items — the specific,
narrow shape that creates the stranding risk — and if found, unconditionally
resolves the free-into-stuck merge there first. This is a strict
improvement, never a tradeoff: both merges are free actions regardless of
order (no DR cost difference), and any free-free merge this pass defers is
exactly as available on the very next scan — nothing "expires" by waiting
one more step. Deliberately scoped to just this one shape (not a general
"always prefer stuck cells" rewrite) — a bucket with only 1 free item and a
stuck one was never at risk (the old two-pass logic already resolves it
correctly once no free-free merge exists anywhere else), and buckets with 3+
free items alongside a stuck one aren't at risk either (consuming 2 of the
free items in a free-free merge still leaves at least 1 behind for the
stuck item, satisfiable on a later scan) — only the exact ≥1-stuck/≥2-free
boundary can zero out the free supply in one step. `'clear-stuck-first'`/
`'highest-rank-first'` (the alternate orderings `onboardingGoal.js`'s
feasibility search tries) were deliberately left untouched — the former
already prioritizes stuck cells unconditionally and was never at risk, the
latter is a narrow-purpose feasibility-search tool, not the main
simulator's own default path this bug actually lives in.

**This changes merge ORDER throughout an entire run, not just in the
specific stranding scenario** — any board where a same-rank stuck+2-free
moment happens to arise (common with low-rank semi tiles, not just
high-rank forced ones) now resolves it earlier than before, which can shift
`drSpent`/`subsidyDelivered`/exact per-rank DR figures for boards that were
never actually broken. **Every specific number verified earlier in this
file for the "matched 3-board (350/615/535 DR)" example predates this fix
and will no longer reproduce exactly** (verified: the same board that
previously read 762 DR / 1406 of 1502 delivered / 3-of-3 boards now reads
702 DR / 1438 of 1502 — strictly BETTER on every figure, never worse, since
resolving a stuck cell earlier can only reduce wasted generator spends, not
increase them). Re-verify fresh against the running code if an exact number
from this file's history is ever needed again; treat every number in this
file as "what was true when this specific fix was verified," not a frozen
reference table. Re-running the exact item-shortfall reproduction from the
`boardIsCleared` fix above WITH this fix also applied shows both working
together: the same one-tile-short board that delivered 350/1502 DR
originally, then 1406/1470 with only the `boardIsCleared` fix, now delivers
**1470/1470 (100%)** across 3/3 boards in 686 DR — the two fixes compound,
they don't just coexist.

Consequences for the Boards section above: a board's `rows` now means two
different things depending on its position. Board 0's `rows` is its actual
grid height. Any later board's `rows` is capped at 3 in the editor (`pushBoardIn`
also defensively re-clamps to 3, in case older data has more) and represents
how many rows it contributes as a wave — its `cols` should match board 0's
for the columns to line up; a mismatch is handled the same best-effort,
top-left-aligned way as board layout presets, not enforced.
`simulatePlaythrough`'s signature changed accordingly: it now takes the full
board array plus `options.startIndex`, not a single board — every internal
caller (`onboardingGoal.js`, `placement.js`) that only wants to test one
board in isolation wraps it in a one-element array.

**The editor's "Playthrough simulation" card is one event-level run over the
whole chain, always from board 1 — it is not a per-board report.** By
explicit economist request ("i want to make sure the playthrough simulator is
running on all boards... when the simulator used all the blocked tiles he got
and the semi blocked, the board progresses if there is one"), which is
exactly `boardIsCleared`'s own condition (no unrevealed `locked` tile, no
still-`stuck` semi/revealed item) driving `advanceBoards`. That machinery was
already correct; what was wrong was the caller — `SimulationReport.jsx` used
to pass `startIndex: boardIndex`, so the same card reported a *different,
shorter* run on every board in the list, as if each board were an alternative
starting point rather than a wave of one continuous playthrough. It now takes
only `boards` and always passes `startIndex: 0`, so it reads identically
whichever board is selected. Two knock-on fixes came with it: the
"needs generation" warning checks **every** board the run will walk through
(an ungenerated wave board halfway down the list would otherwise push in as
an empty strip and silently under-report the climb, naming which boards need
it), and the stale-result `useEffect` is keyed on every board's layout, not
just the active one. Verified live on a 3-board chain: both later boards push
in (at 36 DR and 66 DR), all 46 queue entries across the three get revealed,
and the run reaches rank 12 — versus 1700 DR from board 1 against 1756 DR
starting at board 2, confirming the old per-board behavior really did report
different numbers per board.

Deliberately *not* changed alongside it: `playSession.js`'s
`compareToSimulator` still runs from `session.boardIndex`, and the Play
Tester still starts on whichever board is selected. That's a different
question ("how did my manual run compare to the automatic one *from the same
starting point*"), and forcing it to board 0 would make the comparison
meaningless.

**The card reports how much subsidy actually reached the player, not just
the bare DR total — found live from an economist report that a segment with
1500 DR of subsidy, needing only ~548 DR of player effort in theory
(`valueOf(12) - subsidy`), reported 1546 DR spent.** Nothing was wrong with
`drSpent`: it only ever increments by `tier.cost` on a real generator tap
(no subsidy double-counting), and an instrumented run balanced to exactly
2048 DR of value entering the board with **zero** stranded or wasted value.
The real story was invisible in the old reporting: **the player finished the
entire rank 1-12 chain on Board 1 alone**, so Boards 2 and 3 — holding 1150
of that 1500 — never pushed in and were never seen. Only 348 DR of subsidy
was ever handed out; the player paid for the rest of the climb themselves.
Both mechanics driving that are correct and long-documented (a wave board
only pushes in once the previous one is fully cleared — `boardIsCleared`;
the run stops the instant rank 12 is reached), but the bare "Stopped after
1546 DR" line gave the economist no way to see WHY, so a perfectly accurate
number read as a broken one.

`simulatePlaythrough` now returns `subsidyConfigured`/`subsidyDelivered`/
`boardsReached`/`boardsTotal` alongside the existing fields, and
`SimulationReport.jsx` renders them as their own panel — amber whenever
delivered < configured, with a plain-language explanation naming both
causes (tiles never revealed, boards that never pushed in) and what to do
about it (move subsidy onto earlier boards, or trim the later ones).
`subsidyDelivered` is tallied where the run's real history actually lives
rather than re-derived by a caller: the `log` callback is now always a real
function (it used to be `trace ? fn : null`) that counts revealed
blocked-tile value on every run and only builds the potentially-large
`events` array when tracing, with semi tiles on boards that actually came
into play added separately since they're mergeable from the start and never
pass through `revealNeighbors` at all. **Watch the `valueOf` import here** —
`mergeSimulation.js` previously imported only `MAX_RANK` from `ranks.js`, so
a bare `valueOf(...)` silently resolved to `Object.prototype.valueOf` and
threw at runtime rather than failing to compile; caught immediately by an
instrumented probe, but it's exactly the kind of thing a build passes
straight through.

Verified with a direct A/B: the reported 3-board shape (350/615/535)
delivers 350 of 1502 DR, reaches 1 of 3 boards, and costs the player 1546
DR — while the SAME 1500 DR front-loaded entirely onto Board 1 delivers all
1500, and player effort drops to **564 DR**, essentially exactly the ~548
the economist expected. The reported delivered figure was cross-checked
against the run's own trace reveals, not just trusted.

**The rank table has four numeric columns per row (DR, +DR, % effort,
Taps), not just DR/Taps** — `+DR` is the per-rank cost (consecutive
`reachedAt` entries diffed, same shape `tapsAt` already used), `% effort` is
that same delta as a share of the whole run's total (`drDelta /
result.drSpent * 100`) — against the run's own total, not a fixed budget,
so it reads the same whether or not a DR budget was set. The Play Tester's
own "Rank progress" panel (`PlayTester.jsx`) shows the matching live DR/+DR
pair, read off `session.reachedAt` as the player actually plays.

**A negative `+DR`/`% effort` is real, expected data, not corruption — see
the `stuck`-item rank-reached fix above for the two real mechanisms that can
cause it.** `SimulationReport.jsx` flags it rather than hiding it: the row
renders in amber (not the usual gray), the delta is genuinely signed (`-48`,
computed as `drDelta >= 0 ? `+${drDelta}` : drDelta` — a real bug, not just
cosmetic, caught the same session: an earlier version *always* prepended
`+` regardless of sign, rendering a literal `+-48`), and hovering explains
why in one sentence. A summary note appears under the table whenever any
row is flagged. Don't try to "fix" this by clamping deltas to zero or
hiding negative rows — the whole point is showing the real, if
counterintuitive, DR-order data, not a tidied-up fiction.

**The table scrolls horizontally inside its own container
(`overflow-x-auto`) rather than silently clipping columns** — found live,
from a report that the Taps column had become invisible and "% effort" was
cut off mid-word. Six columns (rank label, bar, DR, +DR, % effort, Taps)
plus real gutter between them (`gap-x-2`, added alongside the +DR/% effort
columns — there was previously no horizontal gap between columns at all)
need more width than this card reliably gets once it's squeezed into a
multi-card flex row on a narrower viewport; a fixed-width CSS grid doesn't
shrink to fit, so without its own scroll container the excess just
overflowed the card silently instead of ever being reachable. `min-w-[26rem]`
on the grid keeps columns from being squashed illegibly thin even while
scrolled.

**`EffortDistributionChart.jsx` — a graph version of this same table's data,
placed right under the Blocked Queue card in the left column, by explicit
economist request ("under the blocked queue... a graph that will show the
data from the playthrough simulator").** Deliberately a *second view onto
the same run*, not a separate simulation — the run itself
(`drBudgetInput`/`result`/`handleRunSimulation`, plus the stale-on-layout-
change invalidation `useEffect`) was lifted out of `SimulationReport.jsx`
and up into `BoardEditor.jsx`, which now passes it down to both
`SimulationReport` (the table, now a controlled/presentational component -
`result`/`onRun`/etc. as props, no state of its own) and
`EffortDistributionChart` (the graph). This is why the two can never show
different numbers for the same click of "Run" - there's exactly one
`simResult`, read by both. `src/features/merge/lib/simulationRows.js`'s
`buildSimulationRows(result)` (the "diff consecutive `reachedAt` entries
into `{rank, dr, drDelta, pctOfEffort, tapsDelta, outOfOrder}`" logic) was
extracted out of `SimulationReport.jsx` for the same reason - both
`SimulationReport` and `EffortDistributionChart` call it independently
rather than one deriving from the other's already-shaped rows, so a future
change to one doesn't need to remember to keep the other in sync by hand.

**The graph shows all four of the table's own columns, not just % effort —
by explicit economist follow-up request ("i want to see all the data from
the playthrough in the graphs").** The very first version only plotted
`pctOfEffort`; `EffortDistributionChart.jsx`'s `MetricRow` is now a small
shared "one labeled strip of 12 bars" primitive, rendered four times — DR
(cumulative), +DR, % effort, Taps — each row independently normalized
against its own largest magnitude among reached ranks (a shared cross-metric
scale would be meaningless; DR and % effort live on completely different
number lines). DR/+DR/Taps bars use a log scale
(`Math.log(magnitude + 1) / Math.log(maxAbs + 1)`) rather than linear, the
same reasoning `SimulationReport.jsx`'s own DR-column bar already uses —
these three are as exponentially skewed as cumulative DR itself, and a
linear scale would flatten every early rank to an invisible sliver next to
rank 12. % effort stays linear (it's already a bounded, comparable
percentage, not an exponential raw value). Every row shares the same
out-of-order-amber/never-reached-empty-bar treatment the original single-row
version had, and colors via `colorForRank` otherwise. No charting library -
see "Style/stack notes" below for why that was never actually available
here despite an earlier, incorrect note claiming otherwise; this is plain
div/Tailwind bars sized by inline `style`, the same technique every other
bar in this app (including this very table's own per-row progress bars)
already uses. Shows a plain "run the simulation first" placeholder instead
of an empty chart when `result` is `null`.

**"Effort target" — an inverse-design suggestion tool, `src/features/merge/lib/effortTargeting.js` + a card in `BoardEditor.jsx`.**
By explicit economist request ("if we can somehow give the simulator around
the effort distribution for each rank and to get suggestions for blocked
queues or board layouts"), scoped down via clarifying questions to exactly
one thing: the economist types a target %-per-rank curve (12 plain number
inputs, need not sum to 100 — only the relative shape matters) and gets
suggested board `blockedValue`s (with each affected board's layout already
regenerated to match) that approach it. This is a genuine inverse problem —
`simulatePlaythrough` already answers "given this config, what effort curve
comes out," but there's no closed-form way to go the other direction, so
`suggestBoardValuesForEffortTarget` is a search: seed-and-hill-climb, the
same shape Diamond Mine's own `diamondGenerator.js` already uses for its own
"no analytic inverse of the scoring formula" problem — nudge a random
step of DR from one board to another (never below 0), regenerate both
boards' layouts via the real `placeItems` pipeline, re-run
`simulatePlaythrough`, and keep the move only if it's not worse (sum of
squared %-per-rank differences, treating a never-reached rank as 0%). Capped
at 400 iterations or ~1.5s wall-clock, whichever comes first
(`MAX_ITERATIONS`/`DEADLINE_MS`) — always returns its best-effort result,
never claims an exact hit.

**Deliberately redistributes the CURRENT total subsidy, never changes it** —
"how much total DR this segment hands out" is Total Subsidy's own job
(`targetSubsidy`), a separate concern; this only ever reshapes WHERE that
same total lands across the rank curve. If `targetSubsidy` is set, the
current total already equals it (the last-board auto-fill keeps that
invariant), so redistributing under "preserve the current total" and "the
last board auto-fills to hit targetSubsidy" can never disagree with each
other — applying a suggestion just moves DR between the OTHER boards, and
the auto-fill effect naturally keeps the last board's own value in sync
with whatever's left.

**UI**, in `BoardEditor.jsx`'s "Effort target" card (left column, right
after `EffortDistributionChart` — by design, so the economist can eyeball
the CURRENT achieved curve in the chart just above, type a target shape
right below it, and compare): 12 rank-colored number inputs
(`targetPctInputs`, kept as strings for the same reason `NumberField`'s
`hint`/every other free-typed numeric field here is — an empty field
shouldn't snap to 0 mid-edit) plus a "Suggest board values" button. The
search itself is synchronous and can take up to ~1.5s, so the click handler
defers the actual call by one `setTimeout(fn, 20)` tick — otherwise the
"Searching…" disabled-button state would never get a chance to paint before
the main thread blocks, and the click would just look frozen with zero
feedback (same class of problem Diamond Mine's `estimateClicksToClear`
solved with real async chunking — 1.5s once, on demand, didn't warrant that
same chunking machinery here, just enough of a defer to let the loading
state render first). A result panel shows target-vs-achieved % per rank,
each affected board's before → after `blockedValue`, the iteration count,
and an explicit note when the underlying playthrough run didn't reach
rank 12 (so the achieved %s only reflect a partial climb, not a lie about
the full curve). "Apply suggested values" writes `suggestion.boards`
(already-regenerated board objects — semiPlacements/blockedQueue/
onboardingStatus included) back via `onUpdateBoard` per board, the same
"call the raw setter directly, not through `invalidateLayout`" pattern
`handleGenerateAll` already uses, since the layout is already correctly
generated and re-invalidating it would just throw that work away. A stale
suggestion (from before any board's layout changed since) is cleared by the
same `simLayoutKey`-keyed effect that already invalidates the playthrough
result — the two can never disagree about what counts as "stale."

Verified live end-to-end (not just built): a 3-board list with a target
curve heavily weighted toward rank 12 (70%) converged to a 73.3%-achieved
result after 400 iterations, correctly redistributing DR toward whichever
board's climb could actually reach rank 12 within budget — and "Apply"
correctly wrote the new `blockedValue`s/layouts back, verified via the Total
Subsidy card's own per-board numbers and the regenerated board grid.

**"Apply to all segments" — by explicit economist follow-up request ("move
the effort target to also apply to all segments").** An `allSegments` prop
(`App.jsx`'s `allSegmentsForEffortTarget` — `[{name, boards, onUpdateBoard}]`
for all 4 segments' MAIN lists, main-editor-mode only, never passed for
Recompletion) lets the card offer a checkbox, off by default so a single
click can't touch 3 segments the economist didn't ask about. **Each segment
still runs the search against its OWN `boards`/own total `blockedValue`
independently — segments are never pooled together**, matching this
feature's own "redistributes the CURRENT total, never changes it" rule
applied per segment rather than globally; this is also why the checkbox's
own label says "each redistributes its own total, independently," not
"combines" or "pools."

`handleSuggestEffortTarget` branches on `applyToAllSegments`: checked, it
loops `allSegments` and calls `suggestBoardValuesForEffortTarget` once per
segment (skipping - not erroring on - any segment whose own total is
already 0, reported as "No DR to redistribute" rather than silently
omitted), storing `multiSuggestion` (one result per segment, parallel to
`allSegments`); unchecked, it's the exact original single-segment path
(`suggestion`, unchanged). The result panel deliberately does NOT repeat
the full 12-row target/achieved table per segment (would be 48 rows for 4
segments, unreadable) — each segment gets its own compact before→after
board-value list plus an iteration count instead, the same list the
single-segment view already shows. "Apply to all segments" loops
`multiSuggestion` and calls each segment's own real `onUpdateBoard` (from
`allSegments[i]`, not the active board's `onUpdateBoard` prop) with that
segment's `result.boards` — so this is the one place in `BoardEditor.jsx`
that can write to a segment other than the currently-active one.

Verified live: a 4-segment setup (Segment 1/2/3 each with a single board at
300/200/150 DR, Segment 4 still at 0) correctly reported "0 search
iterations" for the three funded segments (a single board has nowhere to
redistribute TO - `suggestBoardValuesForEffortTarget` bails out of its own
loop the moment `boards.length < 2`, which is correct, not a bug) and "No
DR to redistribute" for Segment 4, with each segment's own total staying
exactly what it started at (300/200/150/0) — confirming segments are kept
strictly independent, not summed or averaged together.

**Recompletion's own Effort target card gets the identical checkbox too —
by explicit follow-up request ("make the recompletion apply to all
segments also... like the normal one").** `BoardEditor.jsx` itself needed
no changes at all for this - `allSegments` was already a generic prop it
reads without caring which board list it points at. `App.jsx` just builds a
second array, `allSegmentsForRecompletionEffortTarget` (same shape as the
main list's `allSegmentsForEffortTarget`, but `{name, boards:
seg.recompletion.boards, onUpdateBoard: seg.recompletion.updateBoard}`),
and passes it to the Recompletion `<BoardEditor>` call instead. The two are
completely independent - checking the box and applying on Recompletion's
card writes to every segment's `recompletion.boards` only, never touching
any segment's main list, and vice versa. Verified live: setting the main
list's board 1 to 999 DR, switching to Recompletion and setting ITS board 1
to 111 DR, confirmed the Recompletion card's checkbox/label render
correctly and that switching back to the main Editor tab still showed 999 -
the two lists' Effort target instances never cross-contaminate.

**`regenerateBoard` (`effortTargeting.js`) now re-applies
`FORCED_SEMI_CELL`/`FORCED_HIGHEST_RANK_CELL` to board 0's own `tiles`
before generating each candidate — by explicit economist request ("apply
the effort target suggestions should apply the onboarding logic to all
boards ofc").** The onboarding goal itself (`onboardingDrBudget`/
`onboardingTargetRank`) was already threaded correctly the whole time — it
was, and still is, passed into `placeItems` exactly like
`handleGenerateAll` does, and `generatePlacement` already force-applies
those two cells internally regardless of caller (see "Economist-authored
exact placements" above), so `semiPlacements`/`blockedQueue` were never
actually wrong. What WAS missing, and is the real bug this closes: the
board object `regenerateBoard` *returns* (and that "Apply" ultimately
writes back via `onUpdateBoard`) kept the board's own **raw, un-forced**
`tiles` — so a board whose tiles had never been touched through the editor
(newly added via `setBoardCount`, or an older imported save) could end up
with a `semiPlacements` entry claiming a semi item sits at
`FORCED_SEMI_CELL`, while that same board's own `tiles` grid still called
that cell something else entirely (`'blocked'` or `'open'`) — the same
tiles/semiPlacements drift class of bug `BoardEditor.jsx`'s own `updateBoard`/
`handleGenerate`/`handleGenerateAll` all already guard against by writing
the corrected tiles back, not just the generation output. `regenerateBoard`
now does the same: `forceCellsFor(board.tiles, board.rcEvent)` before
building `candidateBoard`, board-0-only, matching every other force-cell
call site's own `isFirstBoard` gating exactly.

Verified with a direct Node-level check (bundled via esbuild, not just
eyeballed): a board 0 with a real onboarding goal (`drBudget: 20,
targetRank: 4`) and tiles that had never gone through `applyForcedSemiCell`
came back from `suggestBoardValuesForEffortTarget` with
`onboardingStatus.feasible: true`, `semiPlacements` correctly holding
`{row: 2, col: 4, rank: 2}`, AND — the actual regression this fixes —
`tiles[2][4]` on the *returned* board reading `'semi'`, not whatever it
started as. The exact-sum invariant held too (300/300).

**The hill-climb had zero awareness of a board's actual tile capacity —
found live, from an economist report that suggestions "will not handle the
tiles I asked for in the boards," alongside a screenshot showing a board's
`stats.sum` (484) wildly exceeding its own `blockedValue` (203), a gap far
bigger than the ~`valueOf(minRank)-1` rounding this app's own generation
invariant ever allows.** The root cause: `distanceToTarget` only scores the
whole chain's AGGREGATE simulated effort curve, so the search has no way to
notice or penalize an individual candidate move that pushes a board's
`blockedValue` past what its own tiles could ever physically hold —
`candidateValues[to] += step` had no ceiling at all. `placeItems` then does
its honest best with an unachievable target: either the small, legitimate
`valueOf(minRank)-1` rounding-up, or — far more visibly wrong, and what the
screenshot actually shows — `decomposeInWindow`'s own "genuinely infeasible"
branch, which caps the real generated sum well below what fits while the
inflated, unachievable `blockedValue` stays written on the board, producing
exactly the kind of large sum/blockedValue and item-count/tile-count
mismatches the Placement card's own stats correctly flagged (it was telling
the truth about a bad board; the actual bug was upstream, in a search that
proposed configs no board could ever realize).

**That capacity cap alone was NOT enough — follow-up report: "it still does
a bad job... it can't be that he will suggest something and after I apply
I'll see errors in boards."** The cap was an *analytical* guess at
feasibility, and it only ever addressed one of the three ways a board comes
out wrong. It said nothing about item COUNT (a board can hit its sum exactly
with far fewer items than it has tiles) and nothing about the min/max
VARIETY reservation — which is in fact *impossible* right at that raw
ceiling, where every tile must be `maxRank`, leaving no room for even one
`minRank` item. So the cap was quietly walking boards toward a value that
guarantees one of the very warnings it was meant to prevent.

**The fix that actually worked: stop guessing analytically, and make the
search ask each generated board the same three questions the editor asks
it.** `boardChecks(board, boardIndex)` mirrors `BoardEditor.jsx`'s
Placement-card checks exactly (`sumOk`/`countOk`/`varietyOk` — including
board 0's max-only variety asymmetry and `effectiveMinRank`'s positional
floors), deliberately re-deriving nothing, so the two can never disagree
about what counts as a problem. `evaluate` now returns both an `issues`
count and a `penalty`, and the accept rule puts problems ahead of
curve-matching: any candidate that lowers the penalty is taken regardless
of what it does to the effort curve, one that raises it is rejected
outright, and `distance` only breaks ties between equally-clean candidates.

**`penalty` is deliberately CONTINUOUS, not the pass/fail `issues` tally —
this distinction is the whole reason the fix works.** A count alone gives
the hill-climb no gradient: a board starting far over capacity (615 DR of
value asked of tiles that can only hold 256) scores "1 issue" at 615, at
500, and at 400 alike, so every intermediate step toward feasibility looks
identical, none get accepted on their own merit, and the search can never
cross the gap in the one-step-at-a-time moves it makes — which is exactly
why the first version still left broken boards behind. Measuring HOW short
/ HOW far off instead (each magnitude normalized per board against its own
target value / tile count, so a big board's DR shortfall can't drown out a
small board's, and both stay commensurate with the flat variety term) makes
each step downhill genuinely better than the last. Verified: on the exact
reported board shape, 5/5 runs went from 2-of-5 runs leaving a broken board
to **0 issues across every run**, with the search actively pulling the
over-capacity board down from 615 to a feasible 46–145 each time.

**Where no clean answer exists, it now says so BEFORE you apply.** The
returned `issues` count surfaces in both result panels (single-segment and
per-segment) as an amber "N Placement-card warnings would still remain
after applying this" note. Stress-tested across four scenarios (the reported
shape, 4 boards with a wide value spread, deliberately-tiny boards with
tight rank windows, and a genuinely impossible case where the total DR far
exceeds every board's combined capacity): the reported count matched the
real post-apply count **exactly** in every single run, and the segment total
stayed preserved throughout. The impossible case correctly reports its 3
remaining warnings rather than pretending redistribution can fix a total
that no arrangement of those tiles could ever hold.

**Per-board pass/fail badges — a checkmark bubble per board, across every
segment, by explicit economist request ("a bubble that shows V for each
board between all segments boards if it did a good job (up to 5 extra DR in
the subsidy and hit all tiles and rules)").** This is a stricter,
reporting-only reading of the SAME `boardChecks` the search already runs
internally — not a new, parallel notion of "good." `boardChecks` now also
returns `ok`/`reasons`/`notes` per board (alongside the `issues`/`penalty`
the search steers by, unchanged): `ok` is false if the board overshoots its
own target by more than an allowance, if item count doesn't exactly match
tile count, or if the rank-variety rule fails and is actually achievable
(see below) — `reasons` is the human-readable list of which. `evaluate`
collects these into `boardReports` (one per board, in board order),
returned from `suggestBoardValuesForEffortTarget` alongside `suggestedValues`.

The overshoot allowance is **not** a flat 5 DR — it's
`Math.max(5, valueOf(minRankFloor) - 1)`. A flat 5 would make every
high-`minRank` board's badge permanently amber for a reason that has nothing
to do with search quality: `rankWindow.js`'s `raiseUndersized` rounds a
board's target UP to the nearest multiple of `valueOf(minRank)` whenever
it isn't already one (see "Item generation invariant" above) — a board with
`minRank` 5 can legitimately overshoot by up to `valueOf(5)-1 = 15` DR with
zero possible arrangement avoiding it. The badge's own overshoot threshold
tracks that same floor so it only ever fires on a REAL overshoot, not an
unavoidable rounding artifact.

**The item-count/tile-count check is the one that actually answers the
economist's earlier "explain why does that happen?" report (only 144/1504
DR delivered, 1/3 boards reached) — this is the single most consequential
line in the whole badge, not a cosmetic nice-to-have.** `revealNeighbors`
can only ever hand out as many items as `blockedQueue` holds; the instant
the queue runs out, any tile still locked stays locked FOREVER, and
`boardIsCleared` — the trigger for the next board pushing in as a wave —
requires ZERO locked cells. So a SINGLE tile with no backing item doesn't
just waste that one tile's own DR: it permanently strands every board after
it in the whole chain, since nothing can ever make `boardIsCleared` true
again. Verified live with a direct reproduction: identical 3-board layout,
identical subsidy split, identical merge strategy — one version with 24
blocked/semi tiles on board 0 but only 23 queue items (a real, easy-to-hit
board misconfiguration) delivered 350/1502 DR across 1/3 boards reached and
took 1546 DR of player spend to reach rank 12; the same setup with 23 tiles
matching 23 items delivered 1406/1502 DR across 3/3 boards and took only 762
DR. One missing item cost 1056 DR of stranded subsidy and roughly doubled
the player's own required spend — this is exactly the "Items vs. tiles"
warning the Placement card already shows, but its real-world consequence
(a dead-ended board chain, not just a locally-odd number) wasn't obvious
until traced through the simulator event-by-event. (An earlier working
theory blamed the DEFAULT `'free-free-first'` merge strategy for
under-delivering subsidy — reasoning that merging into a stuck/revealed item
is more DR-efficient than merging two free items. That theory was tested
and DISPROVEN: an A/B across all three `MERGE_STRATEGIES` on the same board
produced byte-identical `drSpent`/`subsidyDelivered` in every case. Merge
strategy is not a factor here at all — don't reintroduce that explanation.)

**The rank-variety rule (min/max item present) is gated on whether it's
actually achievable from the segment's own total — otherwise the badge (and
the search itself) would be chasing something no redistribution could ever
buy.** `varietyIsRelevant(board, boardIndex, total)` checks whether
`valueOf(maxRank)` (plus `valueOf(effectiveMinRank(...))` on non-first
boards) fits within the segment's WHOLE subsidy total — computed once from
the fixed total, deliberately never from a candidate's own current value
(gating on the candidate would reward the search for deliberately STARVING
a board until the rule stopped applying, exactly backwards). The default
`maxRank` of 12 needs `valueOf(12) = 2048` DR on a single board — routinely
more than a whole segment's total subsidy — so without this gate, a
perfectly good suggestion would show a permanent amber warning for a rule
that was never reachable at any split, and the search's `penalty` would
carry a flat, unpayable +1 that either does nothing or actively pulls DR
toward one board trying (and failing) to satisfy it. When ungated, this
surfaces as a `note` instead (visible on hover, not counted against `ok`)
explaining the real ceiling and suggesting the fix (lower that board's max
rank) rather than staying silent about it.

**Board 0's variety check was max-only — checking only for a `maxRank` item,
never a small/`minRank` one — on the assumption that
`generateCandidateWithSmallRanks`'s own guaranteed ascending-ranks-from-
`minRank` set made a separate check redundant. That assumption was wrong,
found live from an economist report ("it looks like it doesn't matter what
I do it distributes the DRs in a way I get no rank1's... I want that the
weight on later boards will get bigger").** The small-rank guarantee is
only ever *attempted* first — `generateCandidateWithSmallRanks`'s own
`canReserve` feasibility check can reject it (reserving the small-rank set
can itself need more items than the remainder has room for), and a `maxRank`
that's low relative to a board's own tile count can push generation into
`decomposeInWindow`'s "genuinely infeasible" branch entirely, which fills
**every** tile with `maxRank` and guarantees nothing small at all. Verified
directly: a board with a narrow `[1, 6]` window, pushed by the search to a
`blockedValue` close to that board's own raw capacity (`tileCount ×
valueOf(maxRank)`), returned 24 identical rank-6 items — zero variety, not
even the forced-semi-cell's own rank 2 surviving as a *distinct* value in
context. The old `hasMax`-only check couldn't see this failure **at all**,
since `hasMax` is trivially true when literally every item already equals
the max rank — so nothing in the search's own `penalty` ever discouraged
it, and the search had no reason not to push board 0 right up against that
wall chasing a marginally better curve match. This is also exactly why the
economist's own proposed fix was the right instinct: shifting weight onto
LATER boards keeps board 0 further from its own capacity ceiling, where the
small-rank reservation stays feasible — their diagnosis matched the actual
mechanism.

Fixed by making `boardChecks`'s variety check symmetric across every board,
board 0 included: `hasRangeVariety = hasMax && hasMin`, where `hasMin`
checks for `minRankFloor` (which already equals `board.minRank` unchanged
at board 0 — board-position floors, see "Board-position hard floors" above,
never apply there) exactly the same way non-first boards already checked
for it. `varietyIsRelevant` (the "is this rule even achievable from the
segment's total" gate — see above) was updated to match: `needed =
valueOf(maxRank) + valueOf(effectiveMinRank(minRank, boardIndex))` for
every board now, not "0 extra for board 0." One shared code path for every
board position instead of a special case for the first one — the asymmetry
existed only because of the (now-disproven) assumption that board 0's own
generation never needed the safety net the others already had.

Verified live: reproducing the exact reported shape (a 3-board segment,
board 0 on a narrow `[1, 6]` window, a target curve that would otherwise
pull a large share onto board 0) — before this fix, the search settled on
900 DR for board 0 (over its own 768 DR capacity, 24 identical rank-6
items, zero rank-1s); after, it settles on 403 DR for board 0 (comfortably
under capacity, `[1, 2, 4, 4, 5×14, 6×4]` — rank 1 AND rank 2 both present)
while shifting the freed-up DR onto board 2 (912 DR, more than board 0 now
carries) — the "later boards get more weight" outcome falling out naturally
from the search now being correctly penalized for the degenerate case,
with zero new economist-facing controls needed. `issues: 0` in both the
narrow-window case and every previously-verified regression scenario
(capacity-clamp, matched 3-board, single-board, the four-totals stranding
case, and a normal wide-window board 0) — the one legitimate behavior
change is the genuinely-impossible regression case now honestly reporting
4 issues instead of 3 (both ends of variety are checked on more boards now,
not fewer protections), which is more accurate reporting, not a regression.

**The board-0 variety fix above immediately surfaced a second, pre-existing
bug in `penalty`'s own weighting — found live, same session, from a direct
follow-up report ("i ran it now and nothing changed. and u entered changes
that now make some segments fail in creating blocked queues") showing a
4-segment "apply to all" result where 3 of 4 segments came out fully clean
but one showed two boards with "1 tile with no item" after the fix made
board 0 clean.** `countOff` (the item-count-mismatch term) was divided by
`tileCount`, while `varietyFails` contributed a flat, undivided `1`. For a
typical 20-30-tile board, that made a single missing item cost roughly
**0.03-0.05 penalty — about 20-30x cheaper than a variety failure's flat
1.0** — despite the file's own comment at the time claiming the two terms
were "commensurate." They never were; it just went unnoticed because board
0's variety check rarely fired before (max-only, usually satisfied) and
non-first boards' own variety check is gated off whenever it's
`varietyUnreachable` (see above). The board-0 fix made variety checks fire
measurably more often across a real "apply to all segments" run, which is
exactly what exposed the pre-existing imbalance for the first time: with a
real variety problem to chase, the search would happily shed DR off a
DIFFERENT board down past the amount its own tile count needs — accepting a
~0.03-0.05 cost there — to buy a 1.0 improvement on board 0, a straightforward
"small loss for big gain" trade under the OLD math, even though the "small
loss" is a tile that can never be revealed at all (permanently wasted DR —
see `boardChecks`'s own "N tiles with no item" reason, and `boardIsCleared`
in "Board chaining" above for why this is real, lasting damage, not a
cosmetic shape mismatch the way a missing variety rank is).

Fixed by making `countOff` contribute its raw count directly (not divided by
`tileCount`) — each mismatched item now costs a full point, the same order
as a complete variety failure, and proportionally MORE for multiple
mismatched tiles rather than less. `shortBy` was left exactly as it was
(already normalized 0-1 against the board's own target, so it was already
commensurate with the flat variety term — only `countOff`'s scaling was
actually broken). Verified live: the specific reported shape (a narrow-window
board 0 shedding DR for its own variety, two other boards previously landing
below their own item-count floor as a side effect) now holds every board's
item count exact across 20/20 repeated trials, with variety and curve-match
distance absorbing the remaining slack instead — confirming the fix
resolves the actual priority inversion, not just a specific unlucky search
path. Every previously-verified regression scenario (capacity-clamp, matched
3-board, single-board, the four-totals stranding case, the narrow-window
board-0 case, and the genuinely-impossible case) still reports the identical
`issues`/delivery behavior after this rebalance.

**A THIRD bug in the same board-0 variety fix, found live immediately after
the second — the economist re-ran "apply to all 4 segments" with a target
curve weighted 0% at ranks 1-6 and 70% at rank 12, and reported ("why do i
have 0 1s, i asked u to do a different weighting to the boards... i want to
see more 1s and 2s in the first board and u give it too much DRs") that
board 0's own "Blocked queue" card showed zero rank-1 items and only a
single rank-2, with board 0 still carrying a large share of the segment's
subsidy.** The `hasMin` check added by the first fix read `allRanks` —
`board.semiPlacements` and `board.blockedQueue` combined — but board 0's
semi tiles are ALREADY unconditionally rank 1 except the one forced cell
(see "Board 1's semi tiles are always rank 1" above), completely
independent of `blockedValue` or anything the search does to the blocked
queue. The instant board 0 has even one ordinary (non-forced) semi tile —
a completely typical layout, not an edge case — `allRanks.includes(1)` is
trivially true FOREVER, regardless of what the blocked queue itself
contains. The check was real and meaningful for non-first boards (whose
semi ranks are generated normally, not unconditionally fixed), but a
near-total no-op for board 0 specifically: it could never actually fire,
so it provided ZERO pressure on `blockedValue` and explains precisely why
the economist saw literally no change in the thing they were looking at.
This is also why the curve itself mattered here: weighting ranks 1-6 at 0%
effort pushes the search toward fewer, larger subsidy items (concentrating
value near rank 12 instead) — exactly the direction that empties small
ranks out of the blocked queue — and with the variety check never actually
triggering for board 0, nothing opposed that pull.

Fixed by checking `board.blockedQueue` alone for board 0 — not combined
with semis — since that's the specific part `generateCandidateWithSmallRanks`'s
own guarantee governs, and it's the exact thing visible in the "Blocked
queue" card the economist was looking at. Non-first boards are unaffected,
still checking the combined `allRanks` (correct and necessary there, since
their semi ranks aren't unconditionally fixed the way board 0's are).
Verified live against the exact reported shape (a 3-board segment, board 0
with two ordinary semi tiles beyond the forced cell, the economist's own
0%-at-ranks-1-6/70%-at-rank-12 curve): before this fix, board 0's blocked
queue could show zero rank-1 items while still being `ok: true`; after,
board 0 settled at 80 DR (down from a much larger share) with a blocked
queue of `1,1,1,1,2,2,2,2,3,3,...` — four rank-1s and four rank-2s plainly
present — while the freed-up subsidy moved to board 3 (1008 DR, over 10x
board 0's share), `issues: 0` throughout. Every previously-verified
regression scenario (capacity-clamp, matched 3-board, single-board, the
four-totals stranding case, the earlier narrow-window case, the
genuinely-impossible case, and the item-count-priority case) still reports
the identical behavior. Three real, sequentially-discovered bugs in one
feature within a single session is a reminder worth keeping in mind for
this search specifically: each fix landed clean regression-wise but
immediately exposed the next, because `boardChecks`/`penalty` is a small,
tightly-coupled system where any new constraint can starve an existing one
of the search's limited iteration budget — re-verify broadly (not just the
scenario that motivated the latest fix) any time this function changes
again.

**A FOURTH bug, structural rather than a weighting mistake — found live from
"in the first segment now it looks good but in the others less."**
`varietyIsRelevant(board, boardIndex, total)` asked, per board independently,
"if THIS board alone got the segment's WHOLE total, could it afford a
min-rank and a max-rank item" — true for every board in a multi-board list
at once, even when their combined requirement is mathematically impossible
to satisfy from one shared total (e.g. two boards each needing
`valueOf(12) = 2048` DR for a max-rank item, sharing a total of 2500). With
every board's variety independently flagged "relevant," `boardChecks` kept
demanding full variety from boards that could never jointly have it, no
matter how long the search ran — reproduced directly: 8 independent runs at
a shared total of 2500 across 3 boards showed wildly unstable results
(`distance` ranging 12.2 to 505.5) and persistently nonzero `issues` on
every single run. Raising the search's own budget (`RESTART_COUNT` 4→10,
`DEADLINE_MS` 2000→3000, tested then reverted) did not help at all —
confirming this was the achievability gate itself being wrong, not a
convergence or iteration-count shortfall.

Fixed by replacing the per-board check with `computeVarietyRelevance(boards,
total)`: it sorts boards by their own variety requirement
(`valueOf(maxRank) + valueOf(effectiveMinRank(minRank, boardIndex))`)
ascending, then rations the ONE shared total smallest-need-first, marking a
board "variety relevant" only while the running sum of every
already-accepted board's requirement still fits under `total` — the same
"shared, finite resource" accounting `strandedPenalty` (above) already
applies to subsidy delivery, now applied to variety achievability too.
Verified live: the same 2500-DR/3-board reproduction that previously never
reached `issues: 0` across 8 runs now converges cleanly and consistently,
with variety only demanded of however many boards the shared total can
actually support — never all of them when it can't.

**A FIFTH bug, found while verifying the fourth fix: a suggestion could show
`issues: 0` while still silently stranding real subsidy.** A specific split
(`[2360, 47, 93]` across a 3-board chain, `boardsReached: 1/3`) kept
recurring during the fix-4 verification runs — every individual board
passed its own sum/count/variety checks cleanly, so `boardChecks` reported
zero problems on all three, yet only 144 of 2504 configured DR was ever
actually delivered to the player, because boards 2 and 3 never pushed in at
all (board 1 never fully cleared — see `boardIsCleared` in "Board chaining"
above). `strandedPenalty` (the chain-level stranding term added earlier this
section) already steered the search AWAY from configurations like this
internally, but it only ever fed the internal `penalty` score — the
economist-visible `issues` count, and therefore every `BoardVerdict`/
`VerdictSummary` badge built from it, had no way to reflect it at all. A
configuration could be the search's own least-bad pick specifically BECAUSE
it stranded a large flat `strandedPenalty` instead of a few scattered small
per-board penalties, and still present as "all green."

Fixed by computing `strandedIssue = subsidyShortfall > OVERSHOOT_ALLOWANCE`
in `evaluate()` and folding it into the returned `issues` count alongside
each board's own — one issue, regardless of how much was stranded, matching
how a single board's own problem counts as one issue regardless of its
magnitude. `strandedIssue`/`strandedDr` (the shortfall amount) are also
exposed as their own top-level fields on `suggestBoardValuesForEffortTarget`'s
return (`suggestion.strandedIssue`/`strandedDr`, and per-segment inside
`multiSuggestion`), specifically so the UI could give this its own
dedicated, actionable message instead of folding it into the generic
"N Placement-card warnings" line, which was written entirely with per-board
sum/count/variety problems in mind and would have been a misleading label
for "a board never pushed in." `BoardEditor.jsx`'s `StrandedWarning`
component renders this as its own amber block (reusing `VerdictSummary`'s
visual language) directly under `VerdictSummary` in both the single-segment
and per-segment multi-segment result panels, naming the stranded DR amount
and the fix (shift weight earlier, or lower the later board). Verified live:
re-running the same 2500/3-board reproduction now shows `issues: 1` (not 0)
on every recurrence of the stranding split, and the regression suite
(capacity-clamp, matched 3-board, single-board, the four-totals stranding
case, both narrow-window cases, the item-count-priority case, and the
genuinely-impossible case — 9 scenarios total) reports identical
issues/delivery behavior to before this pair of fixes.

Rendered in `BoardEditor.jsx` as `BoardVerdict` (a small check/warning icon
next to each board's name in both the single-segment and multi-segment
result lists, with the real reasons on hover) plus `VerdictSummary` (a
one-line "N / M boards came out clean" readout, or the first concrete
problem when something failed) under each list. A board with zero
blocked/semi tiles renders a muted dash rather than a green check — nothing
to check isn't the same as a good outcome, and a row of ticks half-earned
by empty boards would overstate how well the suggestion actually did.

The raw capacity cap below is kept as a cheap first-line guard — it stops
obviously-wasted iterations before the expensive regenerate-and-simulate
step — but it is no longer what guarantees correctness; `boardChecks` is.

Fixed by giving the hill-climb a real ceiling: `boardCapacity(board)` —
`tileCount × valueOf(board.maxRank)`, the same blocked/semi tile count
`BoardEditor.jsx`'s own `blockedTileCount` already computes, times the most
value a single tile could ever hold — computed once per board up front,
and every candidate step is now clamped so it can never push
`candidateValues[to]` past that board's own `capacities[to]`
(`room = Math.max(0, capacities[to] - values[to])`, folded into the same
`Math.min` the step size already went through for the from-side floor at
0). This stops the search from ever PROPOSING an infeasible per-board
value in the first place, rather than trying to detect or penalize the
resulting mess after the fact — a board already over capacity before the
search runs can still safely give DR away (uncapped on the `from` side),
just can never be pushed further over by a `to`-side move. Verified with a
direct Node-level reproduction: a board with only 8 tiles capped at
`maxRank` 5 (128 DR ceiling) and a target curve deliberately weighted to
bait the search into over-stuffing it still landed at 116/128 DR — safely
under the ceiling — with its actual generated sum matching `blockedValue`
exactly (0 overshoot), while the segment's total redistribution stayed
exact (800/800) the whole time.

**The search now runs several independent restarts and keeps the best one —
by explicit economist request ("make sure that the % you give will be as
accurate as it can be"), after finding live that a single hill-climb
attempt was leaving real accuracy on the table, not already sitting at the
achievable best.** Six back-to-back single-shot runs from the IDENTICAL
starting boards (same target curve, same everything) produced final
distances ranging from 644 to 898 — a ~40% spread purely from which random
`(from, to, step)` moves the one random walk happened to try first, since
the hill-climb only ever ACCEPTS a move, never explores a worse one to
escape a local optimum it already settled into. Raising `MAX_ITERATIONS`
alone (tested at 10x, 4000) barely helped (791→780 distance on one
example) because the SAME single trajectory just reconfirmed the same local
optimum faster — iteration count was never the actual bottleneck; which
region of the search space got explored at all was.

Fixed by extracting the existing loop into `hillClimbFrom(startValues, ...)`
and running it `RESTART_COUNT` (4) times from different starting splits of
the SAME total, keeping whichever converged cleanest-then-closest (the
identical `penalty`-before-`distance` comparison the single-attempt version
always used, just applied across attempts now instead of across steps
within one). Restart 0 always starts from the boards' own CURRENT split
(preserving the original "small nudge from where you already are" bias as
the first thing tried); the rest start from `scrambledStartingValues` — a
handful of blind random transfers using the exact same
from/to/capacity-respecting move shape `hillClimbFrom`'s own steps use, so
a scrambled start can never violate the sum or capacity invariants either.
All restarts share ONE wall-clock deadline (`DEADLINE_MS`, raised from 1500
to 2000ms to comfortably fit 4 restarts at ~400-450ms each) rather than a
fixed slice per restart — a restart that converges early (most do) leaves
its unused time for the next one instead of wasting it, and a slow restart
can't blow the total budget by much since every restart still checks the
same shared deadline. Verified live: the same six-trial setup that
previously ranged 644-898 now ranges 561-676 with multi-restart — not just
a better average, every single trial beat the OLD average, and the worst
new result already beats the old BEST. Regression-checked against three
previously-verified scenarios (the capacity-clamp case just above, the
genuinely-matched 3-board case, and the single-board no-redistribution
edge case) — all three still report the identical `issues`/sum/board-value
behavior as before this change; only the ACCURACY of a feasible curve
match improved, nothing about feasibility/safety logic did.

**A much more serious gap in the same search, found live from an economist
report that applying the SAME target curve to 4 segments with very
different totals (1500/1000/700/400 DR) produced nearly IDENTICAL
drSpent/%-effort across three of them regardless of their very different
totals ("the amount of DRs are the same between segments... this cannot
be") — `boardChecks` (and therefore the whole search) had ZERO awareness of
whether its own chosen split actually gets DELIVERED at all, as opposed to
merely passing each board's own isolated sum/count/variety checks.** A
candidate can show `issues: 0` on every single board — exact sum, exact
item count, full variety — and STILL strand nearly the entire segment's
subsidy, if the split leaves an earlier board too thin to ever fully clear
before the player's own unsubsidized effort alone reaches rank 12; every
board after that one then simply never pushes in (see "Board chaining"
above — `boardIsCleared` requires the active board to be fully clear first).
Worse, `distanceToTarget` can't catch this either: a run that's almost
entirely player-paid still shows a %-effort curve shaped like a normal
exponential climb (most effort concentrated near rank 12), since that
shape comes from the value chain's own math, not from how much subsidy
actually got used — so the search had no signal anywhere telling it this
was a bad outcome, and reliably found it anyway, repeatedly, for 3 of 4
segments in the reported case.

Confirmed directly, not just inferred: the same 3-board shape at four
different totals showed `boardsReached: 1/3` and subsidy delivered as low
as **45 of 701 DR (6.4%)** for three of the four totals — meaning in each
of those cases the ACTUAL gameplay collapsed to nearly the same thing
regardless of nominal subsidy: almost the entire 2048-value climb paid for
by the player out of pocket, subsidy or not. That's exactly why the
reported numbers converged across segments — not a display bug, the search
itself had picked configurations where the segments' very different
subsidy totals barely mattered to the actual simulated outcome.

Fixed by giving `evaluate()` a chain-level penalty term alongside the
existing per-board one: `strandedPenalty = (subsidyConfigured -
subsidyDelivered) / subsidyConfigured * boards.length` (0 when every DR
configured actually gets delivered, scaling up to roughly "every board
failed its own check at once" when subsidy is completely stranded) — added
into the SAME `penalty` the accept rule already treats as outranking
curve-matching distance, so the search now refuses a curve-shape
improvement that comes at the cost of stranding subsidy, the identical
"problems outrank prettier curves" priority `boardChecks`' own per-board
penalty already established, just extended to a problem no single board's
own checks could ever see. Verified live: the same four-total reproduction
that previously showed `boardsReached: 1/3` and 6-25% delivery for three
of four totals now shows **100% delivery, `boardsReached: 3/3`, across all
four** — and `drSpent` now correctly scales inversely with each segment's
own total (500 DR of player effort at 1500 subsidy, 1500 DR of player
effort at only 400 subsidy), the actual economic relationship segments are
supposed to have. Regression-checked against the same four previously-
verified scenarios (capacity-clamp, matched 3-board, single-board, and the
genuinely-impossible case) — all four report identical `issues`/delivery
behavior to before this fix; the impossible case still honestly reports
its unavoidable issues rather than claiming to fix what it can't.

**The blocked-queue generation itself also got more variety — a separate,
related fix, by explicit economist request ("make the simulator not make
just all of the items in there the same").** `generateCandidate.js`'s
`splitToCount` (the function that pads a binary decomposition up to a
board's tile count by repeatedly splitting an item in half) always split
the single CURRENT LARGEST item, deterministically — which converges fast
toward one dominant repeated rank: each split halves the current max, and
the piece it just produced is usually the new "largest" again next time, so
a board with many more tiles than the original decomposition had bits
tended to end up mostly one rank with only a few original odd-sized items
standing out (the literal `[1, 6, 6, 6, 6, ...]` shape reported). This was
the REAL generation path for most boards — `rankWindow.js`'s
`decomposeInWindow` (the hard-floor/ceiling path non-first boards actually
go through) had its OWN duplicated copy of the identical "always split the
largest" loop, so the symptom showed up regardless of which path a board's
generation happened to take.

Fixed by giving `splitToCount` an optional `{ floorRank, randomize }`
(both default to the exact original behavior — `floorRank: MIN_RANK`,
`randomize: false` — so every existing caller is provably unchanged unless
it opts in): when `randomize` is on, which splittable item gets picked next
is a weighted-random draw (weighted BY RANK, not uniform) rather than
always the deterministic max — this keeps the same "split the big ones,
let small ones settle at the floor" bias that avoids needlessly bottoming
everything out (a uniform-random pick would split small items just as
often as big ones, defeating that purpose), it just stops being
deterministically the SAME big item every time. `generateCandidate` and
`generateCandidateWithSmallRanks`'s own remainder step now pass
`{ randomize: true }`; `rankWindow.js`'s `decomposeInWindow` had its
duplicated inline loop replaced with a call to this same shared function
(`{ floorRank: minRank, randomize: true }` — using the BOARD's own
configured floor, not the global `MIN_RANK`, matching what its own inline
copy already did correctly) rather than keeping two copies of the same
logic that would otherwise need the same fix applied twice.

**Deliberately NOT randomized: `onboardingGoal.js`'s `decomposeReserved`,
which calls `splitToCount` directly with no options (so it stays on the
unchanged deterministic default).** That function is part of
`computeOnboardingReserve`'s exhaustive feasibility SEARCH (see "Known open
items" below) — it needs the SAME inputs to produce the SAME decomposition
on repeat calls, since the search's own correctness depends on scanning
reserve values in a way that doesn't flip-flop between calls. Randomizing
it there would make feasibility ITSELF flaky from one call to the next for
identical inputs — a real correctness regression this fix must not cause.
Verified directly: calling `computeOnboardingReserve` five times with
identical inputs still returns the identical `reservedValue` every time,
confirming this path is genuinely untouched.

Verified with 6000 randomized trials (`generateCandidate`/`decomposeInWindow`,
varied targets/counts/rank windows): exact sum held every time for
`generateCandidate`; `decomposeInWindow`'s floor/ceiling/count invariants
held every time, and its own sum either met or exceeded target, or matched
the genuinely-infeasible ceiling exactly when the window truly couldn't
hold more — zero violations of any hard invariant across every trial, only
the achieved VARIETY changed.

**After "Apply to all segments," each segment's own resulting effort
distribution is now shown right there, in the Effort target card itself —
by explicit economist request ("after running the apply to all 4 segments
i want to see on each segment what is the effort distribution").** Before
this, only the segment ACTIVE at the moment of applying got its
`EffortDistributionChart` populated immediately (via `showAppliedResult`,
above) — the other three segments' own charts only updated the next time
their own `BoardEditor` happened to mount, which in practice meant clicking
into each one and often finding a blank chart anyway (`simResult` starts
`null` on every fresh mount), needing a separate manual "Run" per segment
to actually see anything.

`appliedMultiResults` (parallel to `allSegments`/`multiSuggestion`, one
`{name, result}` per segment) is set from `multiSuggestion` itself the
moment "Apply to all segments" runs — no new simulation work, since
`result.result` (the raw `simulatePlaythrough` output) was already computed
internally by the search that produced the suggestion in the first place.
Rendered as one full `EffortDistributionChart` per segment, labeled by
name, reusing the exact same component the single-segment flow already
populates — no condensed/summary variant was built, since "effort
distribution" already means that specific four-metric chart everywhere
else in this app. A segment with nothing to redistribute (`result: null`)
is skipped, matching the before-apply preview's own skip. Cleared (along
with `multiSuggestion`) whenever a fresh "Suggest" search starts or
"Apply to all segments" gets toggled off, the same staleness precedent
`suggestion`/`multiSuggestion` already followed — a stale post-apply chart
sitting next to a brand-new, not-yet-applied suggestion would be
confusing about which one it actually reflects.

**The typed target-%-per-rank curve is now owned by `App.jsx`, not local
state inside `BoardEditor.jsx` — found live, from an economist report that
"applying the suggestions deletes the values I put in" (the 12 number
inputs under the rank badges).** This wasn't actually caused by Apply
itself — direct testing confirmed Apply never touches those inputs. The
real cause: `BoardEditor.jsx` remounts every time the active board changes
(`key={activeBoard.id}` in `EditorApp`), which is normal and desired for
board-specific UI, but the typed curve isn't board-specific — it's meant to
apply across the WHOLE list, and (since "apply to all segments" shipped)
potentially every segment. A completely ordinary workflow — type the curve
on board 1, click Suggest, then click over to board 2 in the sidebar to see
what its own suggested value looks like before deciding to Apply — silently
wiped the typed curve the moment that click landed, because it remounted
`BoardEditor` for board 2 with fresh, empty local state. The economist
would then come back to board 1 (or click Apply from wherever they were)
and find the inputs blank, reasonably reading it as "Apply deleted my
numbers" even though the actual trigger was the board switch that happened
in between.

Fixed by lifting the state out of the remount's reach: `App.jsx`'s
`emptyTargetPctInputs()` seeds two independent `useState` instances in
`EditorApp` — `mainTargetPctInputs`/`recompletionTargetPctInputs` — passed
down as `targetPctInputs`/`onTargetPctInputsChange` props (`BoardEditor.jsx`
no longer has a `useState` for this at all, just reads/writes the props
directly, same updater-function shape as before:
`onTargetPctInputsChange((prev) => ({...prev, [rank]: value}))`). Two
separate instances, not one — the main list and Recompletion are genuinely
different board lists, so a curve typed for one shouldn't silently apply to
the other. `EditorApp` itself never unmounts while the economist is in the
Merge Mania editor at all (only its `mode`/`activeSegmentIndex` state
changes), so this survives switching boards, switching segments, and
switching between Editor/Recompletion/Play tester/CC management/Syntax
tabs — the only way to clear it now is to actually edit the inputs (or
reload the page, same as any other in-memory-only UI state in this app).
Verified live: typed a curve on Segment 1/Board 1, switched to Board 2,
round-tripped through Segment 2 and back, and returned to Board 1 - the
exact same 12 values were still there at every stop.

**"Apply suggested values" now immediately populates `EffortDistributionChart`
(and the "Playthrough simulation" table right under it) with the just-applied
curve — by explicit economist request ("when i apply the spread suggestion,
i want to see somewhere on the segment the effort distribution").** Before
this, applying a suggestion wrote the new `blockedValue`s/layouts to the
boards as always, but `simResult` (the chart's own data) got wiped the very
next render by the pre-existing layout-change invalidation effect (below) —
so the economist had to separately click "Run" in the Playthrough simulation
card to see the curve they'd just asked the search to produce, even though
`effortTargeting.js`'s own search had already run that exact simulation
internally to score the suggestion in the first place.

Fixed in two parts:
- **`suggestBoardValuesForEffortTarget` now returns `result`** — the raw,
  unbudgeted `simulatePlaythrough()` output `evaluate()` already computed for
  the final accepted candidate, alongside the existing `rows`/`boardReports`/
  etc. (all derived from that same run). No extra simulation work; this is
  purely exposing a value that already existed internally.
- **The layout-change invalidation effect no longer blindly nulls `simResult`
  on every `simLayoutKey` change.** `simResultLayoutKeyRef` tracks which
  layout key the CURRENTLY held `simResult` actually corresponds to;
  `handleApplySuggestion`'s new `showAppliedResult(appliedBoards, result)`
  helper sets both `simResult` and that ref together (to
  `layoutKeyFor(appliedBoards)` — the exact key those boards WILL produce
  once they land in the `boards` prop) right after writing the boards. The
  effect then sees, on the very next render, that `simLayoutKey` already
  matches the ref and does nothing — the freshly-applied result survives
  instead of being wiped by the same write that produced it. Any OTHER
  layout change (an ordinary manual edit, a different suggestion, a sync
  from Segment 1) still invalidates normally, since its key won't match
  whatever the ref happens to hold. `simDrBudgetInput` is reset to `''`
  (Unlimited) at the same time, so the visible "DR budget" field can't show a
  stale custom number while the chart displays a different (unbudgeted)
  result — the two would otherwise look inconsistent right after applying.

Works identically for "Apply to all segments": `handleApplySuggestion` finds
which entry of `allSegments` is the list THIS `BoardEditor` is currently
showing (`allSegments.findIndex((seg) => seg.boards === boards)` — a
reference-equality check that works because `App.jsx` passes the exact same
array both as this component's own `boards` prop and as that segment's entry
in `allSegments`), and only shows that one segment's own result here — the
other three segments' charts update the normal way next time their own
`BoardEditor` mounts, the same as every other cross-segment write in this
feature already works. A segment with nothing to redistribute (`result:
null` — see "Apply to all segments" above) is simply skipped, same as it
always was for the board-value writes themselves.

**`src/components/ui/InfoHint.jsx` — a collapsed-by-default "i" explanation,
shared across the whole app, not just Merge.** By explicit economist request
("we got a lot of text in those places, we can handle it with an i that can
expand an explanation if wanted") after `BoardEditor.jsx`'s cards
accumulated multiple long "why"/"how" paragraphs (Total subsidy, Generator
tiers, Lucky drops, Placement's RC-event/Generate-all notes, ...) that made
every card feel text-heavy at a glance just to explain itself. Plain
`<details>/<summary>` — no `useState` needed, native click/keyboard
toggling for free — rendering a small circular "i" plus "More info"/"Hide"
text; the explanation itself only mounts once expanded. Don't delete the
sentences it wraps to "declutter" further — they're real information (often
the answer to "why does this number look odd"), not filler; hiding them one
click away was the whole ask, not removing them.

`NumberField.jsx`'s own `hint` prop now routes through `InfoHint` instead of
always rendering a `<span>` under the field — this is a **behavior-only**
change (same `hint` prop, same three call sites: `BoardEditor.jsx`,
`BoardList.jsx`, Diamond Mine's `MineBoardEditor.jsx`), so every existing
hint across both features got collapsed "for free" without touching any of
those call sites. `BoardEditor.jsx`'s own standalone explanatory `<p>` blocks
(not attached to a field) were converted to `InfoHint` one at a time —
**deliberately not every `<p>` in these cards**: a live status or warning
(the "Sum vs. target"/"Items vs. tiles"/"Min & max both present" checks and
their failure messages, the Total Subsidy goal shortfall/overage note, "No
reward ranks set") stays always-visible, since those are actionable
right-now facts the economist needs to see without an extra click, not
background explanation — only the "why does this work this way" prose
(RC event mode's forced-cell explanation, "Generate items for all boards"'s
own description, the lucky-drop simulation's methodology notes, the target
subsidy auto-fill mechanics) got wrapped. If a future text block is unsure
which bucket it belongs to, ask: "would hiding this by default cost the
economist an action they'd otherwise take right now?" — if yes, leave it
visible.

**`BoardEditor.jsx`'s top of the page used to leave a lot of empty space
beside Board 1's grid on a wide screen, with "Total subsidy"/"Event
schedule" — arguably the two most important at-a-glance summaries for the
segment — only appearing much further down after a scroll.** By explicit
economist request ("the upper part now is empty, we can take some of the
important bubble into this place"), the return statement is two stacked
rows instead of one `flex-wrap` pass over every card: the first row holds
Board 1's grid card plus (when `isFirstBoard`) Total subsidy and Event
schedule, side by side. No card's own props/content changed, only which row
its JSX sits in — Total subsidy/Event schedule keep the exact same
`isFirstBoard`/`onUpdateEventStartDate` gating they always had, just
evaluated one row earlier now.

**Generator tiers and Lucky drops also moved up into that same first row —
by explicit follow-up request ("the generate tiers and lucky drops might be
able to go up").** Neither card is `isFirstBoard`-gated (both are settings
shared across the whole board list, same spirit as Total subsidy/Event
schedule), so they now render in the top row on every board's page, not
just board 1's — they simply wrap onto their own line within that same
`flex-wrap` row once Board 1's grid + Total subsidy + Event schedule have
claimed the first line's width, rather than sitting in a visually separate
second section.

**The second row is now a genuinely two-column split by *purpose*, not just
by "whatever didn't fit up top": a left column that grows together
(Blocked queue, `EffortDistributionChart`, `SimulationReport`/"Playthrough
simulation", Suggestions) and a right column of two configuration cards
(Rank rewards, Placement).** This replaced an earlier arrangement where
`SimulationReport`/Suggestions sat in the same multi-card `flex-wrap` area
as Rank rewards/Placement/Generator tiers/Lucky drops — which meant
`EffortDistributionChart` (in the OTHER, left column) filling in with a
much taller populated chart on "Run" reflowed a wide, physically distant
part of the page for a completely unrelated reason. By explicit economist
request ("clicking on the playthrough all the page layout changes... the
graphs appear and push all the blocks to different places... move the
playthrough and suggestions under it"), `SimulationReport` and the
"Suggestions" card were moved to sit directly under the chart in the SAME
column, so a click of "Run" can only ever grow content within that one
column (pushing Suggestions down a little, same-column, same-purpose
content) rather than reshuffling an unrelated column of settings cards
across the page.

**Two things had to be fixed together to make "Run" truly non-disruptive
inside that reorganized left column, not just less disruptive:**
- **`EffortDistributionChart.jsx` now always renders its full 4-metric-row
  shape, populated or not**, instead of swapping a one-line "run it first"
  placeholder for the whole populated chart. `EMPTY_ROWS` (12 slots, every
  value `null`, same shape `buildSimulationRows` produces) feeds the exact
  same `MetricRow` components pre-run, at their exact same heights
  (`h-20`/`h-16`, fixed regardless of content) — so the chart's own height
  no longer changes at all across a run; only the bars themselves fill in.
  This was the direct fix for "make the effort distribution [have] the size
  he needs to be."
- **The left column itself needed a genuinely FIXED width
  (`w-[48rem] shrink-0`), not just a `flex-col` sized to its own content.**
  Once `SimulationReport`'s table (which needs real width -
  `overflow-x-auto`/`min-w-[26rem]`, see below) sat inside this same
  `flex-col` rather than its own independently-wrapping card, its
  populated-table width tried to stretch the WHOLE column (and every card
  in it, including `EffortDistributionChart`, via `align-items: stretch`)
  wider the instant a result appeared — squeezing the Rank rewards/Placement
  column beside it in the process. `Card.jsx`'s own wrapper gained a
  `min-w-0` (a Tailwind flexbox default footgun: a flex item's
  `min-width:auto` equals its content's min-content size unless overridden,
  which is exactly what let the table's content force its ancestors wider
  instead of scrolling within its own `overflow-x-auto`) — necessary but not
  sufficient on its own, since `min-w-0` only permits shrinking under a
  cramped viewport, it doesn't prevent growing into extra room the page
  happens to have. The column's own fixed `w-[48rem]` is what actually
  closes that gap: verified live (bounding-box measurements before/after
  clicking "Run," not just eyeballed) that the column's width, and
  `EffortDistributionChart`'s own `top` position, are now byte-identical
  before and after a run — only `SimulationReport`'s own table height grows
  in place, exactly as expected for genuinely new content in the same
  column.

## CC Management

A read-only, all-boards-at-once view (`CCManagement.jsx`), separate from the
per-board Editor. Two independent comparisons, each board's own Card:

- **Queue value suggestions** (`suggestQueues`, `ccManagement.js`): Current /
  +30% / +50% `blockedValue` — *relative* to the board's own current value —
  `maxRank` capped one rank higher on the suggestions to give the extra
  value somewhere to go. Computed fresh through whatever generation
  pipeline that board position already uses (board 0's small-rank guarantee
  included) — not read from the board's saved
  `semiPlacements`/`blockedQueue`, so it stays comparable across all three
  columns even if the board hasn't been generated yet.
- **Lucky-drop EV suggestions** (`suggestEv`, same file): Current / +8% /
  +12% `targetEv` — deliberately *fixed absolute* targets (1.08x, 1.12x),
  **not** relative to the board's own current EV the way the queue
  suggestions are relative to blockedValue. Don't "fix" this into a
  relative +30%/+50% to match the queue pattern — that was explicitly
  rejected as too aggressive for EV specifically. Both suggestion values are
  clamped to `[MIN_TARGET_EV, MAX_TARGET_EV]` before display (see the
  lucky-drops ceiling note above) so the shown EV number always matches its
  own displayed probabilities.

Both are purely informational: nothing on this page writes to a board. The
Ops syntax export used to live here too; it's now its own "Syntax" tab (see
below) since it grew a second variant.

## Syntax

A dedicated tab (`SyntaxPage.jsx`) with a Normal/CC toggle, both backed by
`boardSyntax.js`:

- **Normal** (`boardsToSyntax`/`boardToSyntax`): every board's *actual*
  saved config, in play order — layout, semi placements, blocked queue,
  targetEv. This is the "real" Ops export.
- **CC** (`boardsSuggestionsToSyntax`/`boardSuggestionsToSyntax`): the same
  document shape, but for CC Management's suggestions instead — each
  board's +30%/+50% queue and +8%/+12% EV numbers, formatted the same way.
  Calls into `ccManagement.js`'s `suggestQueues`/`suggestEv` directly (no
  circular import — `ccManagement.js` doesn't import back from
  `boardSyntax.js`).

Both are placeholder formats pending the real Ops spec — see the caveat
below. If the real spec turns out to need a different shape for
suggestions vs. real config, that's an argument for keeping them as two
separate functions in `boardSyntax.js` (already true), not for merging them.

**Real Ops sheets — replacing the placeholder, one at a time.** The economist
is walking through their actual Ops reference spreadsheets with Claude, one
sheet at a time, to finally replace `boardSyntax.js`'s placeholder with the
real spec. `src/features/merge/lib/eventSheets.js` holds each one as it gets
specced out, and `SyntaxPage.jsx` renders whichever is selected as a real
`<table>` (never a `<pre>` text blob) with a "Copy as TSV" button so a paste
lands in real spreadsheet cells. Every sheet shares one shape —
`{ columns, rows }`, each row `{ cells: [...], highlight? }` — and
`SyntaxPage.jsx`'s table is generic over that shape (column count/labels
aren't hardcoded to any one sheet), since sheets don't all share the same
layout: Event Data is a 3-column Parameter/Value/Info table; Multipliers is
a 3-column but entirely different Multiplier/Unlock&nbsp;Tier/Lucky&nbsp;Drop&nbsp;Threshold
table. An optional per-sheet `proseColumns` (column indices) marks which
columns are descriptive text rather than tabular data, so only those render
as prose instead of mono-spaced data cells — Event Data's Info column needs
this; Multipliers has no such column.

**The economist's live reference spreadsheet is the format's authority, and
it supersedes the earlier screenshots this file was originally built from.**
As of the current pass, every sheet below was re-verified cell-for-cell
against
`https://docs.google.com/spreadsheets/d/1hpjFfbXt0xUUgJoES0xiAGnRX_17eYSScPmKuTAlqz8/`
(read via the Google Drive connector, exported to `.xlsx` and diffed with
`exceljs` — headers, values, tab names, tab order, fill colors and column
widths all compared, not eyeballed from a screenshot). Several long-standing
decisions documented here turned out to be wrong against it and were changed;
each is called out below at its own sheet. **When the reference and this file
disagree in future, the reference wins** — including on things this file
previously justified at length. The one deliberate deviation is the
**Recompletion Blocked Queue** tab, which the reference doesn't have: it was
an explicit earlier ask and is kept.

That spreadsheet is itself partly a paste of this app's own export (its
"Recompletion Board Layouts" tab still carries `WORKBOOK_COLOR`'s exact
`FFB4A7D6`/`FFD9EAD3`/`FFFFD966` B/S/E fills with the values deleted), so not
every color in it is spec — the main "Board Layouts" tab has been hand-
recolored by row rather than by tile code, and a few Event Data cells carry
ad-hoc one-off highlights. Structural things (tab names/order, column
headers, cell values, which header rows are filled) were taken as spec;
obviously-manual scribbles were not.

- **Event Data** (first sheet, `EVENT_DATA_TEMPLATE`/`buildEventDataSheet`).
  Every row is a fixed constant for this event **except** `TutorialDrAmount`,
  which tracks Board 1's own `onboardingDrBudget` (`GoalSolver.jsx`'s "DR the
  player gets" field) — the Event Start Popup's free-DR grant IS the
  onboarding goal's DR budget, not a separately-tracked number. Left blank
  when no onboarding goal is set, rather than silently exporting the
  template's original example value (30) as if it reflected real board
  state. Don't "clean up" a parameter's exact spelling/casing against the
  source sheet (e.g. `MergehHintInactivityTimer`'s typo, or `Last Tier`'s
  space) — Ops reads these keys literally, so a fixed typo would silently
  break the real integration. The two identity fields the source sheet
  highlights yellow (`Base Popup ID`, `FeatureAssetId`) keep that highlight
  here too, via each row's own `highlight` flag — preserved for visual
  parity with the source, not because this tool assigns them any special
  meaning of its own. **Re-synced to the live reference**: `DynamicResourceKey`
  → `Dynamic Resource Key` and `BaseTemplateId` → `Base Popup ID` (both now
  spaced), several values updated (`merge-popup-v26`, `merge-config-v10`,
  timer 2, `Tutorial` TRUE), the two `EventEndRewards*` rows dropped (not in
  the reference at all), and six rows added: `ShowStartPopup`,
  `Load Popup ID`, `Unload Popup ID`, `StartPopupID`, `TodayOnlyReward`,
  `ItemFamilyName`. Booleans stay as the **string** `'TRUE'`, not a real
  boolean — that's what the app has always exported, and Sheets/Excel coerce
  it to a real TRUE on import anyway (which is exactly why the reference
  reads back as a boolean).
- **Multipliers** (second sheet, `buildMultipliersSheet`) — one row per real
  generator tier (`GENERATOR_TIERS` in `generatorTier.js` — x1/x2/x4), not
  the source template's extra "x/y/z" placeholder rows illustrating that the
  sheet format supports more tiers than this game actually has. "Unlock
  Tier" is each tier's own unlock rank (`unlocksAt`), 0 for x1 (always
  available). **Two corrections against the live reference**, both reversing
  things this file previously insisted on:
  - The header is spelled **`Lucky Drop Threshold`**, correctly. It was
    `Lucky Drop Thershold` (missing an 'h'), preserved deliberately because
    the original screenshot had that typo. The reference spells it right
    now, so this does too. The rule was always "transcribe the source
    literally," not "keep every typo forever" — and the source changed.
    `MergehHintInactivityTimer` is still misspelled in that same reference,
    so *that* one stays misspelled.
  - The value is **`tier.normalRank + 1`** (`luckyDropThreshold()` in
    `eventSheets.js`), giving x1→2, x2→3, x4→4 — the reference's own
    numbers. It was `unlocksAt + 2`, which only coincidentally matched for
    x1 (0+2=2) and produced 9/12 for x2/x4 where the reference says 3/4.
  This is also **no longer an export-only column**: `buildGeneratorWeightsSheet`
  now gates each row's bonus weights on it (see below). It still doesn't
  change the app's own in-game lucky-drop mechanic (`luckyDrop.js`), which
  unlocks as a single whole at rank 7 — don't read this as license to add a
  real per-tier in-game unlock without being asked.
- **Generator Weights** (fifth sheet, `buildGeneratorWeightsSheet`) — one row
  per (rank, tier) combo where that tier is actually unlocked (e.g. tier x2
  only gets rows from rank 7 up), substituting this game's real unlock ranks
  for the source template's own generic example thresholds, same substitution
  Multipliers already makes. Every row for a given tier carries the
  **identical** weight triple — by explicit economist instruction ("we give
  the same % when the user holds different ranks") this sheet does not vary
  the distribution by which specific rank row it's in, the same
  already-unlocked-for-the-whole-run abstraction `luckyDrop.js`'s
  `simulateLuckyDrops` Monte Carlo tool uses. The three non-zero weights land
  on `T(normalRank)`, `T(normalRank+1)`, `T(normalRank+2)` (tier x4's
  `normalRank=3` → T3/T4/T5, matching the source template's own example row).
  Weights are **whole numbers out of 1000** — `Math.round(computeProbs(targetEv)
  * 1000)`, so `targetEv=1.1` → `929/57/14`, matching the reference exactly.
  They were previously scaled to one decimal out of 100 (`92.9/5.7/1.4`) —
  the same distribution, but the reference uses the integer per-mille form,
  and integers can't drift on a parser that rounds or reads them as ints.
  A row **below its own tier's Lucky Drop Threshold** (above) carries only
  the normal weight, with no `+1`/`+2` columns at all — in practice that's
  only ever x1's rank-1 row (x2/x4 don't unlock until well past their own
  thresholds), which is exactly the one asymmetric row the reference shows
  (`Rank 1, Multiplier 1, T1=929` and nothing else). `targetEv` is read from
  Board 1 only (same "one canonical event-level value" precedent as Event
  Data's `TutorialDrAmount`), since `targetEv` is stored per-board but this
  is one global table, not per-board.
- **Blocked Queue** (sixth sheet, `buildBlockedQueueSheet`) — the source
  template models real weighted-random loot pools (several alternative
  Items sharing one Pool Number, each with its own Stock and Weight). This
  game's blocked queue has no randomness or alternatives — it's a fixed,
  ordered rank sequence — so, by explicit economist instruction, this is a
  deliberately simpler special case of that same schema: every queue entry
  gets its own trivial one-item pool, Stock and Weight both fixed at 1.
  **Item is the plain rank number** (1, 2, 3...), per the live reference. It
  used to be written `dr-r{rank}`, borrowed from the original template's
  `dr-r1`/`dr-r2` naming — but that naming belongs to the **Small Rewards**
  key table (below), not to this column, and the reference's own Blocked
  Queue holds bare rank numbers. Combines **every board's**
  `blockedQueue` (not `semiPlacements`, which are fixed grid positions, not
  a queue), in play order, into one continuously-numbered table — Entry
  Number keeps counting up across board boundaries rather than resetting per
  board. `buildBlockedQueueSheet` takes whichever board list the caller
  passes, the same one-function-two-lists precedent `buildBoardLayoutsSheet`
  already established for Board Layouts — a sibling **Recompletion Blocked
  Queue** tab (`SyntaxPage.jsx`'s own view id, and its own tab in
  `buildWorkbook`'s download) runs it against `recompletionBoards` instead,
  matching how "Recompletion Board Layouts" is a separate sheet from "Board
  Layouts" rather than merged into it. The two lists' Entry Number sequences
  are independent — Recompletion's own table starts fresh at 1, not
  continuing the main list's numbering.
- **Item Ladder** (eighth sheet, `buildItemLadderSheet`) — one row per rank
  1-12 regardless of whether that rank is actually a reward rank, matching
  the source template's own every-tier Asset ID rows (`item-t{tier}`, a
  fixed naming pattern, not economist-configured). "Milestone Reward
  Syntax" is populated only for ranks marked in Board 1's "Rank rewards"
  card (`rewardRanks`/`rewardSyntax` — see "Play Tester" above), blank
  everywhere else. This sheet is *why* `rewardSyntax` exists at all — before
  this, `rewardRanks` only marked *which* ranks were rewarded with no place
  to record *what* the reward actually was.
- **Board Layouts** (third sheet, `buildBoardLayoutsSheet`/
  `boardLayoutsSheetToTsv`) — doesn't fit the flat `{ columns, rows }` shape
  at all, so it gets its own dedicated shape and rendering rather than being
  forced into the generic table. One "Section" per board (1-indexed, play
  order), rendered as a real merged cell (`rowSpan`) spanning that board's
  own row count — a wave board's real, capped-at-3 row count shows up as a
  shorter section, not padded to match board 1's height. Each cell is the
  tile's state, letter-coded (`TILE_CODE`: blocked→`B`, semi→`S`, open→`E`)
  and colored to match the source sheet's own scheme (purple/green/yellow) —
  deliberately its *own* color scheme, not `BoardGrid.jsx`'s internal
  editor colors (indigo/amber/violet); this table is meant to look like the
  Ops spreadsheet the economist will actually hand off, not like this app's
  own builder UI. Columns are padded to `maxCols` (the widest board in the
  list) with blank cells for any narrower board, a display-only concern that
  never touches the boards' own data. **A semi tile now carries its own rank
  as a `:N` suffix** (`"S:2"`, `"S:11"`), read off that board's own
  `semiPlacements` — the live reference includes these, reversing this
  file's earlier note that they were confirmed out of scope. Only semi cells
  get a suffix: a blocked tile's rank isn't a property of its position at
  all (the blocked queue is an ordered sequence, and which physical tile
  each entry lands on is decided at play time), so there's nothing
  position-keyed to write there. A board that hasn't been generated yet has
  no `semiPlacements`, so its semi cells fall back to a bare `"S"` rather
  than `"S:undefined"`. Anything reading a tile code must therefore key off
  the **first character**, not the whole cell — both the `.xlsx` fill lookup
  (`addBoardLayoutsSheet`) and `SyntaxPage.jsx`'s `TILE_CODE_STYLE` do.
- **Small Rewards / Small Rewards Bank / Small Reward Weights** (ninth,
  tenth and eleventh sheets — `buildSmallRewardsSheet`,
  `buildSmallRewardsBankSheet`, `buildSmallRewardWeightsSheet`) — the
  incidental coin/DR/sticker drops a merge can produce, entirely separate
  from Item Ladder's *milestone* rewards. Small Rewards is the key table
  (`coin-r1`..`coin-r4`, `dr-r1`..`dr-r4`, `sticker-r1`..`r3`,
  `gen-r1`/`gen-r2`, each with a reward syntax and an asset id); Small
  Rewards Bank is eight named containers (`ContA`..`ContH`), each a syntax
  expression over those keys; Small Reward Weights is per-merge-tier odds of
  each container plus `NoDrop`, rows running merge tier 2–12 (a rank-1 item
  comes straight from the generator, so nothing merges *into* it and it has
  no drop row).

  **All three are pure template constants** transcribed from the reference —
  the app has no small-reward domain model at all (nothing in generation,
  placement or simulation knows these exist), which is why none of their
  builders take a `boards` argument. Transcribed verbatim including the
  placeholder-looking repetition (most bank entries are a bare `coin-r1`);
  don't "fill these in" with invented variety. If any of them should start
  tracking real board state the way `TutorialDrAmount` does, that's a
  separate explicit ask.

More sheets get added here the same way, one at a time, as the economist
shares each one — this is expected to keep growing, not a one-off.

**"Copy as TSV" is per-sheet; "Download workbook" is everything at once.**
`SyntaxPage.jsx`'s "Download workbook" button (independent of whichever tab
is currently selected) calls `eventSheets.js`'s `buildWorkbook(boards,
recompletionBoards)`, which bundles all eleven real Ops sheets into one real
multi-tab `.xlsx` file, **in the live reference spreadsheet's own tab
order**: Event Data, Multipliers, Board Layouts, Recompletion Board Layouts,
Generator Weights, Blocked Queue, Recompletion Blocked Queue, Item Ladder,
Small Rewards, Small Rewards Bank, Small Reward Weights. Tab *sequence* is
part of the format the same way row order within Generator Weights is (see
the automated-parser note below) — don't reorder for convenience. Note two
changes from the earlier eight-tab version beyond the additions: the order
itself moved (both Board Layouts tabs now sit before Generator Weights), and
"Recompletion Layouts" was renamed **"Recompletion Board Layouts"** to match
the reference. `SyntaxPage.jsx`'s own view switcher is ordered to match, so
clicking through its tabs walks the same sequence as scrolling the real
sheet. Deliberately excludes "Normal"/"CC" (`boardSyntax.js`'s older,
still-placeholder per-board export) — out of scope for this real-sheets
workbook. Always acts on whichever segment is currently active (see
"Segments" above) — `boards`/`recompletionBoards` are simply whatever
`App.jsx` passed down for `activeSegment`, so this button never needed to
know segments exist at all.

**"Download combined workbook" / "Create combined Google Sheet" — every
segment in one file, added alongside the per-segment exports above, by
explicit economist request.** Originally (4 segments): `buildAllSegmentsWorkbook(segments)`
(`eventSheets.js`) ran the same eleven-tab `buildWorkbook` sequence once per
segment into ONE shared workbook, prefixed so all 44 tabs coexisted, plus a
leading **"Segments"** index tab mapping each short prefix back to the
segment's real name. The prefix was a terse `S1`..`S4` index, not the
segment's own free-text name — Excel caps worksheet names at 31 characters,
and the longest base tab name here ("Recompletion Blocked Queue"/
"Recompletion Board Layouts", 27 chars) leaves only 4 spare, nowhere near
enough for an arbitrary economist-typed segment name (`S1 ` is 3 chars,
safely fitting `27 + 3 = 30`).

**Restructured into a genuinely different tab sequence (and — separately —
raised from 4 to 8 segments), both by explicit economist request, in the
same pass.** The per-segment "Download workbook (this segment)"/"Create
Google Sheet (this segment)" exports are **completely untouched** — same
eleven sheets, same order, same `buildWorkbook`/`buildAllSheetsAsValueRows`.
Only the COMBINED (all-segments) exports changed:

- **Event Data, Multipliers, and Generator Weights became single combined
  sheets** — one row-set per segment, tagged with a leading **Segment**
  column (the same short `S{n}` label the Segments index tab already uses),
  instead of one full copy of each per segment. This isn't just a tidier
  layout: these three genuinely differ per segment (`TutorialDrAmount`
  reads that segment's own onboarding DR budget; `tier2UnlockRank`/
  `tier4UnlockRank` are editable per segment and feed both Multipliers and
  Generator Weights), so collapsing them to one canonical segment's row
  would have silently dropped every other segment's own values —
  `buildCombinedEventDataSheet`/`buildCombinedMultipliersSheet`/
  `buildCombinedGeneratorWeightsSheet` each just flat-map every segment's
  own (unchanged) per-segment builder output, prepending `S{n}` to every
  row rather than reimplementing the underlying computation a second time.
  `addGeneratorWeightsSheet` gained an optional `{ rankColumn }` (default 1,
  reproducing the exact original behavior) so its green Rank-column fill
  still lands on the real Rank column once Segment pushes it to column 2 in
  the combined sheet — verified live (a direct `exceljs` read-back of the
  generated file) that the fill is on column 2, not column 1, in the
  combined workbook.
- **The six remaining sheets stay genuinely per-segment**, tab-prefixed as
  before, but now grouped **by segment** rather than by sheet type — all six
  of segment 1's own sheets together, then all six of segment 2's, and so
  on — by explicit request ("S# board layout, S# blocked queue, S# RC board
  layouts, S# RC blocked queue, S# item ladder, S# RC item ladder, for #
  between 1 to 8"). Per segment: Board Layouts, Blocked Queue, RC Board
  Layouts, RC Blocked Queue, Item Ladder, **RC Item Ladder**. "RC" (not
  "Recompletion") in these six tab names specifically, by explicit request
  — the per-segment workbook's own "Recompletion Board Layouts"/
  "Recompletion Blocked Queue" names are unaffected, since those live in
  `buildWorkbook`, which this restructuring never touched.
- **RC Item Ladder is new** — there was never a Recompletion variant of Item
  Ladder before (the per-segment workbook only ever needed one, reading
  Board 1's own `rewardRanks`/`rewardSyntax`). `buildItemLadderSheet` was
  already generic over whichever board list it's handed, so this needed no
  new sheet-building function at all — just a second call against each
  segment's `recompletionBoards` instead of `boards`.
- **Small Rewards, Small Rewards Bank, and Small Reward Weights stay as one
  shared tab each** (unchanged, fixed templates with no per-segment
  variation — see their own builders), moved to the very end of the
  sequence. Small Rewards specifically was confirmed to stay in the
  sequence (right before Small Rewards Bank) rather than being dropped,
  when the economist's own listed sequence named only "small rewards bank,
  small rewards weights" and omitted it — asked rather than assumed, since
  dropping a real sheet silently would have been a worse mistake than
  asking.

**Full tab order**: Segments (index), Event Data, Multipliers, then for each
segment in turn — Board Layouts, Blocked Queue, RC Board Layouts, RC Blocked
Queue, Item Ladder, RC Item Ladder — then Generator Weights, Small Rewards,
Small Rewards Bank, Small Reward Weights. `buildWorkbook`'s own
`{ workbook, namePrefix }` options (added for the OLD "run the same eleven
sheets per segment" structure) were removed as dead flexibility once
`buildAllSegmentsWorkbook` stopped calling `buildWorkbook` at all — nothing
else ever passed those options, so keeping them would have been exactly the
"design for a hypothetical future requirement" this codebase avoids
elsewhere.

The Google Sheets equivalent (`buildAllSegmentsSheetsAsValueRows`) mirrors
this exact same tab sequence and naming (values only, no styling — see
`buildAllSheetsAsValueRows`'s own comment for why) — it already used the
same short `S{n}` prefix as the workbook for its per-segment tabs before
this change (a pre-existing doc/code mismatch this pass also corrected: an
earlier version of this note claimed it used each segment's own free-text
name instead, which the actual code never did).

Verified live end-to-end against 8 synthetic segments (direct Node-level
`exceljs` inspection of the generated workbook, not just eyeballed): **55
total tabs** (1 Segments index + 1 Event Data + 1 Multipliers + 8×6
per-segment sheets + 1 Generator Weights + 3 Small Rewards sheets), zero
name collisions, zero over Excel's 31-character tab-name limit (longest tab,
`"S8 RC Board Layouts"`, is 20 characters), the combined Event Data sheet
showing exactly 112 rows (14 template rows × 8 segments) with a leading
Segment column, and the combined Generator Weights sheet's header reading
`Segment, Rank, Multiplier, T1 weight..T12 weight` in that order. The
per-segment `buildWorkbook` output was re-verified unchanged (still the
original eleven tabs, in the original order) in the same pass. The live UI
was also driven end-to-end (Playwright against the running dev server, not
just the build): the header segment switcher shows all 8 tabs
(`flex-wrap` added to that row so 8 tabs — up from the original 4 — wrap
instead of overflowing on a narrower viewport), and the Syntax page's
"Download combined workbook" button is present and unaffected in position.

Header fills are **opt-in per sheet**, not a blanket light-gray on
everything: the reference only fills four header rows — Generator Weights
and Small Reward Weights navy (`FF1F4E78`, white text), Blocked Queue gray
(`FFCCCCCC`), both Board Layouts near-white (`FFF2F2F2`, `FF44546A` text) —
and leaves the rest bold-only. `addFlatSheet` also takes a `columnFills`
option (1-based column index → ARGB) for Blocked Queue's yellow Entry Number
and green Pool Number columns, the only whole-column data fills in the
workbook.

**Uses `exceljs`, not `xlsx` (SheetJS) — because cell *styling* was the
actual ask.** The free/community edition of `xlsx` can parse and write plain
cell *values* fine, but cannot reliably write cell *styles* (fills, fonts,
colors) at all — that's gated behind SheetJS's paid Pro tier. Once the
economist asked for the download to visually match their reference
screenshots (colored cells, bold headers, a real merged Section column,
matching what "Board Layouts" already looked like in this app's own UI), the
whole point of the feature required real style-writing, so `xlsx` was
replaced with `exceljs` (MIT-licensed, full free styling support) mid-build —
this was a deliberate swap, not an oversight; don't revert it back to `xlsx`
for this workbook without solving the same styling gap another way first.
Every color in `WORKBOOK_COLOR` (`eventSheets.js`) is chosen to *resemble*
the economist's screenshots using standard Google-Sheets-palette tones, not
pixel-picked from the images — treat exact hex values as approximate, not a
contract, if a mismatch ever gets reported. `writeFile`-to-disk is
Node-only in `exceljs` (unlike `xlsx`'s browser-aware `writeFile`), so the
actual browser download goes through `workbook.xlsx.writeBuffer()` → `Blob` →
a temporary `<a download>` click, the same pattern the JSON backup export
(`App.jsx`) already uses.

**The download filename carries the event's real date range, when set.**
`SyntaxPage.jsx`'s `computeEventDateRange(eventStartDate, eventDurationDays)`
turns the "Event schedule" card's two fields (see "Persistence" above) into
`merge-mania-ops-export_<start>_to_<end>.xlsx` (parsed/formatted as local
calendar dates, not UTC, so the picked day is the day that lands in the
filename regardless of the browser's timezone). Falls back to the plain
`merge-mania-ops-export.xlsx` name whenever `eventStartDate` isn't set —
this is optional, not a required field to unlock the download.

**"Create Google Sheet" is a third export path, alongside "Copy as TSV" and
"Download workbook" — creates a real, populated Google Sheet and copies its
link, instead of a downloaded file.** By explicit economist request
("copy the google sheets link for the output"). This is the app's first
real external API integration and its first use of OAuth — everything else
in this app is genuinely local (`src/features/merge/lib/googleSheetsExport.js`
is the one file that talks to a server at all). Deliberately still
client-only, no backend: Google Identity Services (GIS, loaded on demand via
a `<script>` tag, not from `index.html`, so pages that never touch this
export never pay for it) runs a browser-side OAuth token-client flow, then
plain `fetch` calls hit the Sheets API v4 directly with the resulting access
token. A **Client ID** (a public identifier, not a secret — safe to live in
source, unlike a client secret) is registered in Google Cloud Console
against this app's two real origins (`localhost:5173` for dev,
`idoggk.github.io` for the deployed site) — that origin allowlist, not
secrecy of the Client ID, is the actual security boundary; a token request
from any other origin is rejected by Google regardless of who has read this
file. The OAuth client must be the **"Web application"** type specifically
(has Authorized JavaScript Origins) — a **"Desktop app"** client, which
Google Cloud's console will happily let you create first, looks superficially
similar but has no origins concept at all and silently can't work here; this
was caught live from a screenshot showing "Client ID for Desktop" before the
correct Web application client was created. While the OAuth consent screen is
unverified (the default for a personal/internal project — full verification
is a Google review process, out of scope for a tool like this), only Google
accounts explicitly added as **test users** (Google Cloud Console → Auth
Platform → Audience) can complete the sign-in at all.

`buildAllSheetsAsValueRows` (`eventSheets.js`) is the same eleven sheets
`buildWorkbook` turns into a styled `.xlsx`, in the same order, flattened
instead to plain
`{ title, rows }` value grids — the shape the Sheets API's
`values:batchUpdate` needs, since that endpoint populates cell values
directly rather than accepting a file to parse. `boardLayoutsSheetToRows`
(refactored out of `boardLayoutsSheetToTsv`, which now just joins its rows
with tabs) supplies Board Layouts/Recompletion Board Layouts' own Section-per-row
shape here too, so there's one source of truth for that row data feeding
both the TSV and the Sheets export. **Deliberately values-only, no
styling** — replicating `WORKBOOK_COLOR`'s fills/bold-headers via the Sheets
API would mean a `spreadsheets.batchUpdate` call full of
`repeatCell`/`updateCells` requests per sheet, real effort for a purely
cosmetic win the exported *data* doesn't need to be correct; the `.xlsx`
download already covers "looks like the reference screenshots" for anyone
who wants that. Revisit only if styled Sheets output specifically gets
asked for. `valueInputOption: 'RAW'` (not `'USER_ENTERED'`) on the
`batchUpdate` call is a deliberate safety choice, not just the simpler
option — `RAW` never interprets a cell as a formula even if it happens to
start with `=`, which matters because some cells come from free-text
economist input (`board.rewardSyntax`) that `USER_ENTERED` mode would
otherwise be willing to execute as a formula (classic spreadsheet-formula-
injection shape).

Each click requests a **fresh** OAuth token and creates a **brand-new**
spreadsheet — there's no persisted refresh token (nothing here could hold
one securely without a backend) and no "update the same sheet again" mode,
so re-running this after editing boards makes a new link each time rather
than refreshing an old one. If that turns out to matter in practice, revisit
by tracking the last-created `spreadsheetId` and switching the `create`
call to an `update`/`values:update` against it — not attempted yet since it
wasn't asked for.

**This workbook is read by an automated Ops parser, not eyeballed — structural
fidelity to the source sheets always wins over anything that only helps a
human reader.** Three real mistakes this caught, all now fixed and worth not
reintroducing:
- **Row order is part of the format, not a cosmetic detail.** Generator
  Weights' source sheet sequences rows by rank ascending first, with
  multiplier ascending *within* each rank (rank 5 × tier 1, rank 5 × tier 2,
  rank 6 × tier 1, rank 6 × tier 2, ...) — `buildGeneratorWeightsSheet`
  originally nested the loops the other way round (outer loop over tiers,
  inner over ranks), which contains the exact same set of rows but in a
  completely different sequence: every x1 row, then every x2 row, then every
  x4 row. Same data, wrong shape — an algorithm reading positionally or
  expecting a specific row sequence would parse it wrong even though every
  individual cell value was correct. Fixed by swapping the loop nesting
  (outer over rank, inner over `GENERATOR_TIERS`, skipping a tier until its
  own unlock rank) — verified live against the on-screen table and the
  downloaded file, both now read `1,1 / 2,1 / .../ 7,1 / 7,2 / 8,1 / 8,2 /
  9,1 / 9,2 / 10,1 / 10,2 / 10,4 / ...`, matching the source's own sequence.
- **No real merged cells anywhere, even where the source sheet visually uses
  one.** `addBoardLayoutsSheet` (`eventSheets.js`) used to give Board
  Layouts/Recompletion Board Layouts a genuine `exceljs` `mergeCells` on the
  Section column, matching the source sheet's own look. That's actively
  wrong for a machine reader: a real Excel merge only carries a value on its
  anchor cell — every other row in the merged range reads back as
  `null`/blank to any library that iterates rows independently of Excel's
  own merge rendering, silently corrupting Section for most of the sheet
  from the parser's point of view. Fixed by writing the literal Section
  number on **every** row instead (verified live: read the generated file
  back with `exceljs` and confirmed no `row.getCell(1).value` is
  null/undefined for any real data row). `boardLayoutsSheetToTsv` had the
  identical bug (blank string on every row but the first) and got the same
  fix, for the same reason — the "Copy as TSV" path can end up parsed by a
  script too, not just pasted for a human to look at.
- **Column headers must match the source sheet's literal text, typos
  included** — an algorithm looking up a column by exact name has no way to
  "notice" a correction was made. Any new sheet added here needs the same
  discipline: transcribe header text and cell values exactly as the
  reference shows them, never autocorrect spelling/casing on the assumption
  a human will read it anyway. Event Data's `MergehHintInactivityTimer` is
  the current live example. **The flip side, learned the same way:** this
  cuts both directions — `MULTIPLIERS_COLUMNS`'s third column was
  `"Lucky Drop Thershold"` for exactly this reason, and when the economist's
  own reference started spelling it correctly, keeping the typo became the
  bug. Track the source; don't freeze a transcription and defend it.
- **Cell styling (fill colors, bold, column widths) is still fine to keep** —
  it doesn't change what a value-based reader sees (`cell.value`/
  `sheet_to_json`/equivalent all ignore formatting), so the `WORKBOOK_COLOR`
  treatment from the previous round stays. The lesson isn't "no styling at
  all," it's "never let a stylistic choice change what data is actually
  present in a cell" — a merge fails that test, a fill color doesn't.

**A fourth mistake this same automated-parser discipline caught, found live
from an economist screenshot: `addBoardLayoutsSheet`'s blank separator row
between boards was a phantom — incrementing a manually-tracked row-number
counter with no matching `ws.addRow()` call for it.** exceljs's `ws.addRow()`
always appends at its own internal `rowCount + 1`, completely independent of
any locally-tracked row-number variable a caller keeps for its own bookkeeping.
The old code called `ws.addRow(...)` for real content, then separately fetched
`ws.getRow(rowNum)` (a manually incremented counter) just to apply the B/S/E
cell-fill colors — and the blank-separator step only ever did `rowNum += 1`,
never an `addRow()` to match it. That left `rowNum` one row ahead of wherever
`addRow()` was actually placing content, at every board boundary: the next
`ws.getRow(rowNum)` call landed on a row nothing had ever been written to,
lazily creating it and coloring it, while that board's real first row (which
`addRow()` had already placed one row earlier) kept its color but never got
one applied — a colored, empty phantom row sitting next to an uncolored real
one, repeating once per board boundary since the +1 drift compounds. Verified
live with a reproduction matching the report exactly (a 3-board list, all
tiles blocked): before the fix, boards 2 and 3 each showed their true first
row uncolored with a blank purple/green phantom row directly below it; after,
`ws.eachRow` confirms zero blank-but-colored rows and zero content rows
missing their fill, for any number of boards.

Fixed by dropping the parallel `rowNum` counter entirely and styling the
`Row` object `ws.addRow()` itself returns, plus writing the separator as a
**real** `ws.addRow(Array(maxCols + 1).fill(''))` call rather than a skipped
number — this can't drift out of sync again because there's no second
number left to keep in sync; the row being styled is, by construction,
always the exact row that was just written. This also makes
`addBoardLayoutsSheet`'s own row structure finally match
`boardLayoutsSheetToRows`'s (the TSV/Google-Sheets path) — that function was
never affected by this bug in the first place, since it just pushes real
array entries for the separator (no manual counter, no possible drift), so
**only the downloaded `.xlsx` workbook ("Download workbook"/"Download
combined workbook") ever showed this — "Copy as TSV" and "Create Google
Sheet" were always correct.**

**"I want all the segments in the output, I see only 1" — not a bug,
`buildAllSegmentsWorkbook`/`buildAllSegmentsSheetsAsValueRows` were already
correct (verified live: 45 worksheets — 1 "Segments" index + 4×11 — with
zero name collisions for 4 identically-configured test segments).** The real
issue was discoverability: `SyntaxPage.jsx` has two visually similar rows of
export buttons — the top row ("Download workbook"/"Create Google Sheet")
only ever exports whichever segment is currently active in the header
switcher, and a second, separately-labeled "All segments" row further down
("Download combined workbook"/"Create combined Google Sheet") is what
bundles all 4. An economist scanning for "the download button" can easily
grab the first one and never notice the second row exists. Fixed by making
the distinction land on the buttons themselves, not just a small uppercase
section label above the second row: the top row's two buttons are now
labeled "…(this segment)" with a matching `title` tooltip pointing at "All
segments" below, rather than relying on the economist to notice a separate
labeled section on their own.

## Build Event workflow (the guided path) and the rules it rests on

The app opens on **Build event** (`BuildEventPage.jsx` + `BuildEventReview.jsx`,
engine in `lib/eventBuild.js`): one workspace with a persistent five-step
stepper - Segment amounts, Board layouts, Small rewards, Build boards, Test
and finalize. Every other tab is an advanced tool over the **same canonical
state**; the workflow owns no second copy of the design. Steps are freely
revisitable and nothing is erased by navigating. This section is the current
authority; where an older section below or above still talks about two
Recompletion lists or literal coin amounts, this one wins.

### Step 1 is the segment's amount - by explicit economist feedback

The first review of this workflow found two flaws ("I don't see where I can
insert the amount needed for each segment... the amount for the segment and
the board layouts are the first thing to insert"). Step 1 used to be a
general "Event setup" page that only offered per-board budgets. It is now
**Segment amounts**: per segment, a **Total demand (DR)** field - the DR the
player spends themselves - with the subsidy it implies shown beside it
(`2048 - demand`), then the per-board budgets. Board layouts are step 2.
Generator, lucky-drop, date and CC settings have working defaults and sit
below the amounts under "Event settings" (open - see "The editor's inputs
are in the flow" below; they were collapsed at first and went unnoticed).

The amount is NOT a new field: it is the list's existing `targetSubsidy`
(the board editor's "Total demand" on its Total subsidy card), converted at
the input exactly as the editor does. `lib/subsidyBudget.js` holds the one
rule both places apply: Board 1 capped at 150 DR, and the LAST board is not
typed - it closes the gap to the subsidy needed (`fillLastBoard`). Entering
an amount for a segment whose boards are all still zero gives a starting
split (`spreadSubsidy`: Board 1 up to its cap, the rest shared evenly); a
segment that already has typed budgets keeps them. `BuildEventPage` runs an
effect that keeps every segment with an amount adding up while the workflow
is open (after a board is added, say) - the editor's own effect only runs
while the editor is mounted. Leaving the demand empty means "no amount":
every board is typed by hand, as before. A budget change here keeps a
board's built contents (flagged out of date) rather than clearing them.

### Second review: whole numbers, coin values, plain words, one build

Five pieces of economist feedback on the first real use of the flow, all
implemented. Where an older paragraph in this file disagrees, this wins.

**Only coins may be a fraction.** ("the only resource that can have
fractions is coins. nothing else.") Puzzles, merge energy and charms are
whole numbers everywhere: a derived target (base x segment factor) is rounded
to the nearest whole number (`roundRewardAmount`, applied in
`effectiveRewardTargets` and `segmentBuildInputs` - to the base segment
too, so an old fractional save is not built against as typed), typed targets
and rank values are rounded on commit (`CommitNumber`'s `whole`), and
`formatRewardAmount` shows them with no decimals (an average over simulated
players is shown rounded). Coins keep three decimals; Twister DR keeps one.
The DR reconciliation table is NOT a reward amount and still shows one
decimal. "Nearest" is this app's choice of rounding rule - the economist said
rounding rules would be held, not which one.

**The build sets the coin rank values, per segment.** ("i would like that
the model will insert the coins rank value also, u can make the values differ
between segments to make it work with the merges EV.") This reverses the
earlier "coin ranks are not seeded, the app does not invent them":
- A coin ladder is "set by the build" while every rank is blank or carries
  `auto: true` (`coinLadderIsAuto`). Typing any coin value makes the whole
  ladder the economist's own (`withManualCoinLadder`), shared by every
  segment like the other resources and never overwritten; "Let the build set
  the coin values" clears it back (`withBlankCoinValues`).
- The four ranks keep fixed proportions, `COIN_VALUE_SHAPE` = 0.05 / 0.12 /
  0.27 / 0.6 (valid under the merge rule). A build starts every segment from
  those same provisional values (so values cannot compound from one build to
  the next), places coin ITEMS for one plan shared by all segments
  (`coinPlanTargetFor`: 3 to 8 rank-4 collects, from the base target), then
  scales all four values together so THAT segment's simulated coin payout
  equals its own target, and re-simulates with the rounded values
  (`smallRewardsWorkflow.js`, step 4b, option `autoCoins`). This is sound
  because a coin payout is linear in the coin values - the simulated player
  never decides anything by a prize's size. Drop odds stay shared; the value
  of a coin item is the per-segment lever.
- The values live on each segment's own boards
  (`board.rewardChainConfig.coins`), so exports and play read them with no
  special case. Three places had to learn the exception to "reward
  definitions are one shared set": the Segment-1 sync
  (`mergeSharedRewardChain` keeps a segment's own generated coins and still
  shares everything else), `preserveDivergentRewardConfig` (own coin values
  are not a divergence to preserve), and the build's staleness key
  (`rewardChainAsBuildInput`: generated values are an OUTPUT, so applying a
  draft must not make it look out of date). Apply writes them through
  `draftSegment.coinLadder` in `boardsWithDraftApplied`.

**Rank values that fail the merge rule can be fixed from the flow.**
`suggestLadderFixes` offers two minimal valid sets - raise the higher ranks
(rank 1 kept) or lower the lower ranks (rank 4 kept) - and
`applyLadderValues` writes the chosen one, rewriting the amount inside each
rank's item syntax only when that is safe (exactly one `dynamic(name:N)`
term holding the old value); otherwise the rank is named for a hand edit.
Nothing is changed without a click. Note the trade-off the review will show:
raising rank 4 makes the payable steps bigger (puzzles 5/15/30/65 pays in
65s when leftovers are forfeited).

**Results in plain words.** ("i dont know those words.") The per-segment
table is "Result for each segment" with columns DR you gave the boards /
Taken off for merge energy / DR placed under tiles / What to look at, a
three-box legend above it, and one short line per problem (`cause.short`).
`CAUSES` titles and actions are rewritten for an economist. Labels shown:
Ready · Ready - close, not exact · Needs a fix · Not built (the internal
status ids `ok` / `review` / `infeasible` / `skipped` are unchanged). Do not
put solver words (infeasible, coarse ladder, eligible capacity, shared odds)
back into anything an economist reads; `scripts/e2e/build-feedback.mjs`
checks for them.

**The editor's inputs are in the flow, and one action builds the whole
event.** ("we should insert the data of the editor into the build event
flow. at the end of the flow, the model should be able to build all the
feature.") Added to the flow: event settings open in step 1, RC event mode in
step 2 (Recompletion Board 1), merge-drop start rank + leftover rule +
milestone rewards (`rewardRanks` / `rewardSyntax`, the Item Ladder sheet) in
step 3. "Build whole event (Normal + Recompletion)" builds the Normal phase,
then Recompletion on top of that Normal DRAFT (`rcInputsOnMainDraft`: every
segment's main boards as they will be once the draft is applied - including
the shared drops reaching segments the build skipped, which is what the sync
does). Until the Normal draft is applied, the Recompletion draft is current
against it (`rcOnMainDraft` in `BuildEventPage`), can be applied but not
tested on its own; step 5's "Apply whole event" applies every pending phase,
each keeping its own revert snapshot. "Build <phase> only" is still there.

Verified by `scripts/e2e/build-feedback.mjs` (40 checks) and sections 18-22
of `scripts/verify-event-build.mjs`.

### Third review: the editor, broken into steps

("i still dont see alot of things from the editor. the editor should be
broken into steps that will be in the builder. everything needed should be
inserted into the builder flow. the distribution, the lucky drops the
multipliers. everything.") The flow is now SEVEN steps - step ids
`setup, layouts, generator, effort, rewards, build, finalize`:

1. Segment amounts · 2. Board layouts · 3. Generator and lucky drops ·
4. Effort distribution · 5. Small rewards · 6. Build boards · 7. Test and
finalize.

Any sentence above that still says "five steps", or numbers Small rewards /
Build / Finalize as 3 / 4 / 5, predates this. Step 1 holds only the amounts
again (the event settings moved to step 3).

`BuildEventSteps.jsx` holds the two new steps and two review pieces. All of
them edit the same canonical state the editor's cards edit:
- **Generator and lucky drops** (`GeneratorStep`): the three multipliers as a
  table (cost, what a tap gives, unlock rank - per segment, with "use these
  for every segment"), the lucky-drop value with its three chances shown
  live (`computeProbs`) and the 450-tap simulation (`simulateLuckyDrops`),
  event dates, CC per board.
- **Effort distribution** (`EffortStep`): the editor's "Effort target" as a
  step. One target shape (the App-level `mainTargetPctInputs` /
  `recompletionTargetPctInputs`, shared with the editor card) is searched for
  EVERY segment with an amount, each on its own total
  (`suggestBoardValuesForEffortTarget`, now with `firstBoardCap` so Board 1
  never has to be clipped after the search). "Use this split" writes only the
  board amounts - the build generates the contents. A suggestion is put aside
  when the boards change, except by its own apply. "Show the distribution of
  the current split" takes the best of 5 generated layouts, because the
  random order of items under the tiles decides how much subsidy is
  delivered and one layout is not a fair picture.
- **In the build review** (`BuiltBoards`, `BuiltEffort`): every built board
  as the editor shows it (grid with semi items, blocked queue in opening
  order) and the effort distribution of exactly those boards, with no button
  to press.

Still only in the advanced Editor tab, on purpose: saved layout presets,
reordering/duplicating boards, hand-reordering a blocked queue, the noise
slider and single-board Generate. The build owns generation in the flow.

### Fourth review: a 15% margin, and a quick fix for every problem

("the model gives me suggestions all the way and moves numbers to make the
things work (which i love), but then when i build all the segments we get
needs fix. lets give anyways the model a 15% margin for the diff of the
amount in all the small rewards. and when he says fixes are needed, lets give
the suggestions and a quick fix for each problem.")

**The margin.** `OFF_TARGET_TOLERANCE` (`smallRewardsWorkflow.js`) is 0.15
and is the single definition everywhere (solver verdict, build causes, review
colouring, seeded validation). A reward whose predicted payout is within 15%
of its target IS met: nothing about that reward is reported as a problem -
not "paid in fixed steps", not "its items did not all fit under tiles", not
"too few merges". Those reasons only count when the payout actually ends
outside the margin (`offTarget`). Do not reintroduce a reward-amount problem
that fires inside the margin. The margin is about reward AMOUNTS only: a
board that cannot hold its DR, an unreachable starting goal or a
merge-energy deduction that does not fit are still problems.

**Quick fixes.** Every cause a build reports carries `fixes`: plain data,
`{ id, kind, label, ...params }`, built in `eventBuild.js` (`quickFix`,
`causesFrom`, `boardChecksFor`) with the build's own numbers, and carried out
by `BuildEventReview.jsx`'s `applyFix`. A fix changes an INPUT - the same
state the steps edit - never the draft, so the draft goes out of date and the
economist rebuilds ("Rebuild now"). Kinds: `setBaseTarget`, `setFactor`,
`setLeftoverPolicy`, `setTilePct`, `setMaxRank`, `setMinRank`, `clearPins`,
`spreadBudget`, `setOnboarding`. Rules that keep them honest:
- the base segment's target is typed, every other segment's is base x its
  factor - so a reward fix moves the TARGET for the base segment and the
  FACTOR for any other (`buildSegment`'s `context` says which segment it is);
- layout fixes (rank limits, pins) are written to the base segment's board,
  because layouts are one shared set, and say "(all segments)";
- a fix is only offered when it would do something (e.g. `spreadBudget` only
  when spreading really gives every later board DR), and a label always says
  exactly what will change and to what value;
- a cause with no safe automatic change (missing rank values, Recompletion
  never reached) keeps only "Take me there".
Clicked fixes are remembered per build in `BuildEventPage` (so the rebuild
prompt survives moving between steps).

Verified by section 23 of `scripts/verify-event-build.mjs` and the last
section of `scripts/e2e/build-feedback.mjs`.

### Fifth review: UX pass and cleanup

By request ("continue with UX UI experience with the app, after that go on
making the code cleaner ... check if somethings are not needed or can be
removed").

UX, all in the Build event flow:
- A segment's result has ONE vocabulary, from `segmentChip`
  (`BuildEventReview.jsx`): **Ready** (everything met; a build whose
  merge-energy figure still moves a DR or two between passes, with nothing
  else to report, is Ready too) · **Can be improved** (built and usable,
  something is outside what was asked, quick fixes offered) · **Needs a
  fix** (cannot be applied) · **Not built**. This replaced "Ready - close,
  not exact", which was shown even for a reward 30% off its target.
- The review's DR box is in the table's own words (DR you gave the boards /
  After CC / Merge energy the player collects / Taken off for it / DR to
  place under tiles / DR placed under tiles / Difference) with a one-line
  plain summary. The exact working-out - the residual breakdown, the
  convergence note and the deduction policy, all still required and still
  unrounded - sits in a closed "How these numbers were worked out"
  (`data-testid="review-how"`). A test that reads those must open it first.
- Unbuilt segments are one quiet short line each in the results table.
- `EffortDistributionChart` takes a `subtitle` prop (its default is the
  editor's wording, which made no sense inside the flow).
- The header no longer carries the caption under the segment switcher.

Cleanup:
- Removed, called from nowhere: `computeBoardEffectiveSubsidy`
  (`rewardEconomy.js`), `validateTwisterConfig` (`twisterEconomy.js`).
- Removed step 7's "Review effort and progression" button and panel: step 6
  shows the same chart for the draft with nothing to press (`BuiltEffort`).
- Left on purpose: `ART_COVERAGE` (the record of what artwork exists),
  `contentsKey` and `createDropGroup` (used by the verification scripts),
  and the many exports only used inside their own file (harmless).
- NOT touched: the untracked `_scratch_*` files, `TODO.txt` and the
  `chef_*.xlsx` files in the project root, and `src/features/chef` - none of
  them are part of this work, and deleting someone's untracked files is not a
  cleanup to do unasked.

### Sixth review: a build that finishes

("there are still flow problems ... how can it be that we generate the
blocked queue before we give how much small rewards should be on the board?
... the finalization of the boards is infinite now ... each time i fixed
something the model suggested he got a new problem and it was non stop ...
board1 can only have rank1 small rewards in the tiles. in board 2 1 or 2,
mostly 1. in the last board 1/2/3.") Where anything above disagrees, this
wins.

**Step order.** Small rewards is step 4 and Effort distribution step 5 (ids
unchanged: `setup, layouts, generator, rewards, effort, build, finalize`).
Reward items take tiles and merge energy takes DR off the boards, so effort
is only looked at once the rewards are known. The effort step still judges
the main-chain items alone and says so; the build shows the final picture.

**Reward ranks under tiles, by board position** (`rewardPlacement.js`:
`rewardRankPattern` / `allowedRewardRanks`; asked and confirmed):
Board 1 rank 1 only · every board from Board 2 to the one before last rank 1
or 2, mostly 1 (pattern 1,1,2) · the last board rank 1, 2 or 3 (pattern
3,2,1). A single-board list is Board 1. Tiles are handed out in rounds, last
board first and Board 1 last, each to the resource with the largest share
still to place. This replaced "fewest tiles, earliest board first", which
filled Board 1 with rank-3 items. Pins the economist places by hand are not
subject to it. The take-back guarantee now protects three things, not one: a
generated reward item never changes a board's main-chain DR, never costs
Board 1 its starting goal, and never leaves a tile without an item.

**Margins.** Rewards 15% (`OFF_TARGET_TOLERANCE`). Board DR 5%
(`DR_TOLERANCE`, `eventBuild.js`; asked, chosen over 10% and 15%): the DR
placed on a board may be within 5% of what it should hold, merge-energy
deduction that could not be taken off may be up to 5% of the segment's DR,
and a board may have up to 5% of its tiles (at least one) without an item.

**A reward amount never blocks a build.** Blocking ("Needs a fix") is only
structural: a board that cannot hold its DR, a starting goal that fails, a
deduction that does not fit, a reward with no rank values, Recompletion never
reached. A reward outside its margin is "Can be improved": usable, applied
like any other, with its quick fix.

**The solve aims at the average player, not the nearest whole prize.** One
player is always paid whole prizes, but drops are random, so the average can
sit between two prizes - and a target IS an average here. The unit plan for a
target the ranks cannot pay exactly (leftovers forfeited) is target /
value-per-unit, and the refinement steers the simulated mean onto the target
(`smallRewardsWorkflow.js`; it used to steer onto "closest payable", so 100
merge energy with a 75 prize was built to pay 75 and then reported). The one
case still reported: a target under half of one rank-4 prize, where matching
the average means most players collect nothing.

**The build rebalances the shared merge drops itself** (`buildEvent`, up to
`MAX_REBALANCES` extra passes). A segment with less DR on its boards merges
more, so shared drop odds pay it more; when drops ALONE pay a segment more
than its target plus the margin, the base segment's merge-drop share for
that resource is lowered just enough and the event is rebuilt. The typed
split is not changed; what was used is returned in `draft.adjustments` and
shown under the results table. Coins are excluded (their values do this).

Measured on an eight-segment, three-board event with a Board 1 starting goal
(subsidy 1,098 to 1,698 DR, factors 1 to 1.3, the reference rank values):
before, 5 of 7 built segments were blocked; after, 6 of 7 are clean and the
seventh is usable with one reward 18% over. A four-board version comes out
entirely clean. These are single runs of a build that has randomness in it.

### Seventh review: Board 1's start, semi-blocked rewards, drops that always happen

Four rules from one round of economist feedback. Each REPLACES older text in
this file where they disagree (older sections still describe reward items as
"never stuck", drops as a chance out of 1000, and the simulator as always
tapping the biggest multiplier).

**Board 1 holds few reward items.** ("the first board is filled with small
rewards. it cant be that aggressive.") Generated reward items may take at
most `FIRST_BOARD_REWARD_SHARE` (15%, at least one) of Board 1's blocked
tiles and none of its semi-blocked cells (`rewardPlacement.js`). A hand-pinned
item is not limited. The 15% is this app's number, not the economist's.

**Board 1 opens with runs of 1 and 2.** ("the first board should have a lot of
low rank items with a start with the blocked queue with sequences of 1 and 2.
user needs to feel a strong progression at the start.") `placement.js`'s
`openingRun`: the first tiles Board 1 opens hand out low, low, next in threes
(1, 1, 2, 1, 1, 2 ...), about 40% of its main-chain tiles, at most 9, never
shuffled, shortened while the rest of the board's DR could not put an item
under every remaining tile. It leads the queue; with a starting goal set, the
goal's reserved items follow it, and `placeItems` falls back to goal-first if
the goal does not hold on the real board that way. Exact sum unchanged.
DO NOT "improve" the rest of Board 1 into a ladder of distinct ranks or into
several mid-rank duplicates: both were tried and both stranded the chain
(measured, below). The remainder is the long-standing generator's output.

**The simulated player taps a smaller multiplier when that is the only way to
free a tile** (`mergeSimulation.js`: `tierToSpend`). It used to tap the
biggest open multiplier always. A single rank-1 item left semi-blocked after
x2 opened could then never be cleared (x2 never makes a rank 1), so its board
never counted as cleared and no later board arrived - this, not Board 1's
contents, was why runs stranded: all of Board 1's tiles were open within a
few DR and exactly one rank-1 item was left. Measured on a 150/500/500 chain:
36 of 40 runs reached every board before this round; 13 of 40 with the
opening run and the old rule; 30 of 30 with `tierToSpend`. The interactive
play tester is unaffected (the player picks the multiplier).

**A reward item is semi-blocked when its tile opens.** ("the small rewards in
the tiles are also supposed to be first semi blocked"; asked, confirmed as
"semi-blocked when revealed".) Under a blocked tile or on a semi tile, a
reward item is `stuck` like any other until a FREE item of the same resource
and rank is merged into it. While stuck it cannot be moved, merged away,
collected by hand, given up to free space, or paid at phase end. Consequences
that are now load-bearing:
- only merge drops produce free reward items, so an item under a tile pays
  out only when drops supply its match: every resource needs some drops, and
  "100% under tiles" delivers nothing. The quick fix "put all X under tiles"
  was removed for this reason.
- a stuck REWARD item does not hold a board back (`boardIsCleared` only
  counts main-chain items). This one is this app's decision, not a confirmed
  game rule: the alternative strands every later board on a match that may
  never come.

**Every eligible merge drops a bucket.** ("i want that the rule for when we
start getting small rewards will always give us drops"; asked, confirmed as
"every eligible merge drops"; "we have buckets of drops, each can drop
several items and in different ranks".) `rewardTargeting.js`:
`buildAlwaysDropConfiguration`, used by Build event (`alwaysDrop: true`).
From the start rank up there is no "nothing" outcome; what is tuned is the
start rank and what is in the buckets. The economist's "merge drops start at
rank" is the EARLIEST start; it only moves up when even one rank-1 item per
merge would pay more than is wanted (reported as `dropStartRank`, shown under
the results table). Each resource's share of the drops is laid end to end
over the drops, which is what makes buckets of one to four items in
different ranks. Kept groups (Twister's, hand-authored, locked) keep their
odds and the buckets fill the rest of each table exactly.
The advanced Rewards tab's own Generate still makes chance-based drops; a
design it changes is marked out of date and has to be rebuilt in Build event.

**What this costs, measured and not solved.** With shared buckets that always
drop, a segment's drop income follows how much it merges, and a segment with
less DR on its boards merges more. On the eight-segment test event the base
segment lands on target while the three lowest-subsidy segments are paid 15%
to 50% over (factors 1.2 to 1.3 against roughly 1.5 to 1.9 times the merges).
They are reported as "Can be improved" with a factor fix, never blocked. The
rebalance keeps the best of its passes and usually cannot help here, because
"always drop" fixes the minimum each merge pays.

### Eighth review: Recompletion starts at rank 12

("when we get to rank 12, the RC is triggered and the chase starts to rank
14 ... we will go to a chase to a total of DR value of 2^(14-1) when we got
already a rank 12, and new boards with blocked tiles.") This REPLACES every
older statement in this file that Recompletion needs "rank 12 AND the whole
main chain cleared", that it starts on a fresh/empty board, and that its
demand converts against 2,048.

- **Start.** The moment rank 12 is reached. It does not wait for the normal
  boards to be cleared; whatever is still under their tiles is left behind
  (so normal-board subsidy the player never reached is simply not used).
- **What comes along** (asked; confirmed "everything on the board"): the rank
  12 and every other FREE main-chain item the player holds, placed on the
  first RC board's open cells (the rank 12 first; what does not fit goes to
  the inventory). Items still semi-blocked do not come. Reward items do not
  come - they are settled at the hand-over, as before.
  `mergeSimulation.js`: `enterRecompletion` - the ONE implementation, used
  by `simulatePlaythrough` and by `playSession.js`'s `maybeEnterRc`.
- **The arithmetic.** The chase is to rank 14 = 8,192 DR, and the rank 12 in
  hand already counts for 2,048, so Recompletion has 6,144 DR to cover:
  `subsidyBudget.js`'s `chaseValue(phase)` (2,048 normal / 6,144 rc), used by
  step 1 and by the board editor's Total subsidy card for Recompletion.
  `mainChainProgress` for RC therefore starts at about a quarter, not zero.
- **Consequences worth knowing.** The player arrives holding a rank 12, so
  the x4 multiplier and lucky drops are open from the first RC tap (a tap
  gives a rank 3, not a rank 1).
- **Confirmed unchanged** (asked): the first RC board keeps every Board 1
  rule - the 150 DR limit, rank-1 semi-blocked tiles, the 1,1,2 opening run -
  and the ranks under RC tiles are the limits the economist sets per board.
  The build does not pick RC ranks itself.

### Ninth review: corrections after the first full play-through

Four corrections and one addition. Each REPLACES what the seventh and eighth
reviews above say on the same point.

**The drop start rank is exact - it is never moved.** ("it looks like i still
seeing that merging 2 rank 5 to a 6 doesnt drop small rewards. when i say
rank6 drops, i mean the merge that will give a merge 6 will drop.") The
seventh review's "it only moves up when one item per merge would overpay" was
this app's own idea and was wrong: on such a design 5 + 5 -> 6 dropped
nothing. Now `buildAlwaysDropConfiguration` always starts at the economist's
"merge drops start at rank"; the rank is the rank the merge MAKES. Because
there is no "nothing" outcome, the drops have a FLOOR of one item per merge:
- when the floor is more than was asked of the drops, the build takes the
  difference out from under the tiles (`smallRewardsWorkflow.js`, the
  `structure === 'always'` block), so the total stays on target;
- when even that is not enough (small targets, many merges), the reward is
  overpaid and the cause `drop-floor` says so, with the quick fix
  `setMinDropRank` ("start merge drops at rank N" - the rank from which the
  drops would fit, `fittingStartRank`) next to the usual target/factor fix.
  A resource with a target is never steered out of the buckets.
Watch for this: overpaid merge energy funds extra taps, which make more
merges and more drops, and its credit can then exceed what the boards can
give up - a small energy-only target with drops from rank 6 is "Needs a fix"
until the rank or the target changes. The verification fixtures that ask for
one small reward therefore start drops at rank 9.

**Everything on the board comes along into Recompletion.** ("i went into the
RC and almost all the things i had were deleted in the progress there, all
the small rewards and some of the ranks also.") `enterRecompletion` carries
every visible item - main-chain and small-reward, free and semi-blocked (a
semi-blocked one stays semi-blocked) - and keeps the tile/drop attribution
pool. Only what is still under an unopened tile is left behind. Reward items
are no longer settled at the hand-over; settlement happens only when the run
ends. The eighth review's "only free main-chain items" is superseded.

**Recompletion boards hold nothing below rank 3 under a blocked tile.** ("the
RC boards cant hold under the blocked tiles any rank that is under 3.")
`board.js`: `RC_MIN_RANK_UNDER_TILES`, `withMinRankFloor`. Enforced on the
data, not in the generators: `useBoardListState` takes `{ minRankFloor }` and
applies it to every write of the Recompletion list, so a Recompletion
board's own `minRank` is never below 3 and everything that reads it follows.
The first RC board's opening run is therefore 3, 3, 4. Semi-blocked tiles are
not blocked tiles: its rank-1 semi tiles and fixed rank-2 cell are unchanged.

**A drop is free; only an item under a tile is semi-blocked** (confirmed, no
code change: "when there is a drop from a merge it is not semi blocked. i
meant that under the tiles it will be semi blocked").

**Play animations** (`components/PlayEffects.jsx`, keyframes in
`index.css`; both play screens): the generator throws its item to its cell,
a merge drop jumps out of the merged item (the items of one bucket one after
another), and a collected reward shows what was paid ("+75 energy"). It is
presentation only: effects are read off the events the play engine already
logs, by count; the real item sits in its cell, invisible until the thrown
copy lands. A rank-4 payout is logged just before its merge, so the payout
looks at the merges of the same action for its position. Reduced-motion
viewers get the payout text only.

(Endless mode, noted here as "not started", is now built - see the tenth
review.)

### Tenth review: endless mode, Recompletion demand, containers

Three requests. Where anything above disagrees, this wins.

**Endless mode** ("the user gets rank 14 and the boards goes to endless mode
with the changes we talked about the drops and EV"; earlier: "higher EV from
the drops ... take down the rank u get the drops from by 1. most of the drops
should be coins and energy"). `lib/endlessMode.js`, `playSession.js`
(`maybeEnterEndless`), `components/EndlessMode.jsx`.
- It is a third session phase: `'main' -> 'rc' -> 'endless'`, entered by the
  merge that makes rank 14. PLAY SESSIONS ONLY: `simulatePlaythrough` still
  stops at rank 14, so builds, validation and every prediction are about the
  normal event and Recompletion, as before. A stage with no Recompletion list
  still ends at rank 12.
- Nothing is taken away on the way in: board, items, inventory, generator,
  lucky drops, collected rewards and the Twister balance carry on. There is
  no goal and no end. The rank 14 stays; two rank 14s do not merge
  (`actionFor` - there is no rank 15).
- Only the merge drops change, DERIVED at that moment from the drops in force
  (the Recompletion list's) by `buildEndlessDrops` - never stored (it is
  exported, see the eleventh review): start rank one lower (`ENDLESS_DROP_RANK_SHIFT`); an average drop
  carries 1.5x the source units (`ENDLESS_DROP_VALUE_MULTIPLIER`, never less
  than one unit before the multiplier); 80% of those units are coins and
  merge energy, split evenly (`ENDLESS_COIN_ENERGY_SHARE`), the rest shared
  by the other resources in their old proportions. A resource with no rank
  values is left out; Twister groups keep their odds. Every merge from the
  start rank still drops (it reuses `buildAlwaysDropConfiguration`, which
  now also takes `unitsPerDrop`).
- THE THREE NUMBERS ARE THIS APP'S OWN. The economist gave the direction
  only. They are shown wherever endless is described and labelled "not
  confirmed game values". Do not present them as agreed.
- "Higher EV" was read as the value of the MERGE DROPS. The generator's
  lucky-drop EV is not changed in endless.
- `describeEndlessDrops` gives what the drops come to, including merge
  energy paid back per 100 DR of generator output (an estimate: a DR of
  output is about targetEv / 2^(r-1) merges that make rank r). Checked
  against 6,000 DR of real endless play in `verify-endless.mjs`: 127 measured
  against 129 predicted. With drops built the usual way and the reference
  energy ladder (75 at rank 4) this comes out near or above 100 - endless
  play that pays for itself. That is a consequence of the three rules, it is
  shown with a warning, and it is the economist's call.
- Shown in the Play Tester (banner with the numbers), Play Stage (short
  banner) and Build event step 7 ("After rank 14: endless mode",
  `EndlessPreview`, read from the active segment's applied Recompletion list).
- Look: the theme follows `session.phase` (`themeOf`, never a rank compared
  in a component). The economist's `merge-endless-mode-assets/` pack is
  copied, trimmed to each picture's drawn bounds, to
  `assets/game/endless/` by `scripts/prepare-endless-assets.mjs` (the pack's
  tiles cover two thirds of their canvas, off-centre; a cell needs them edge
  to edge). Used: lavender/mint tiles, selection brackets, generator (as the
  generator button's icon and inside the frame), infinity badge on the board
  corner, blank nameplate with LIVE HTML text, transition starburst (once, on
  entry, not for reduced-motion viewers), reward burst behind a rank-4
  payout. The frame is square and is never stretched around the board. Items
  keep their own sprites.

**Recompletion's demand is the segment's normal-event demand** ("in the RC.
the demand should be the same as the demand of the segment in the normal
event"). `subsidyBudget.js`: `rcSubsidyForMainSubsidy` (Recompletion subsidy
= 6,144 - the normal demand). An effect in `App.jsx` keeps every segment's
Recompletion `targetSubsidy` equal to it and its boards adding up (an
untouched list gets a starting split; typed budgets are kept and the last
board closes the gap). The Recompletion demand field is read-only in Build
event step 1 and in the Recompletion board editor ("same as Normal"); it is
free only while the segment has no normal amount. An older save with its own
Recompletion amount is brought in line on load, which changes its last
board's budget and marks a built Recompletion out of date.

**Containers** ("we are also missing the containers. we need to create the
containers and give them weights, each container with a different drop.
those need to be in the syntax generation of the model and of course be taken
into account in the model"). `lib/containers.js`,
`components/ContainersTable.jsx`.
- A CONTAINER IS A DROP GROUP. The model's buckets and the Ops "Small Rewards
  Bank" containers were two unrelated things (the model's were played, a
  hand-typed bank was exported). They are now one: container key = ContA,
  ContB ... in the list's group order; syntax = the group's items as Small
  Rewards keys in the reference's order (coin, dr, puzzle, charm); weights =
  the group's weight in each merge rank's drop table, NoDrop = the table's
  no-drop weight. Only groups that can drop are listed. This REPLACES
  `smallRewardsBank.js`'s header claim that the two are deliberately separate.
- `buildSmallRewardsBankSheet` / `buildSmallRewardWeightsSheet` export the
  model's containers whenever the list has any (`source: 'model'`), with
  merge tiers 2-12 (the reference's range); a tier below the drop start rank
  is all zeros and NoDrop 1000. (A list with no drops at all used to fall
  back to the hand-typed bank; that fallback is gone - see the twelfth
  review.)
- Recompletion has its own drops, so it has its own two tabs, "RC Small
  Rewards Bank" and "RC Small Reward Weights" (tiers 2-14), right after Small
  Reward Weights in every export. They are NOT in the Ops reference. ("RC"
  because the long name is over Excel's 31 characters.)
- The build review (step 6) shows "Containers: what a merge drops" for the
  draft; the wording "bucket" in the flow is now "container".
- Unverified: a container with Twister DR is written `dr-twister-r{n}`.
  Endless containers are shown in step 7 and exported (eleventh review).

Also fixed on the way: a thrown copy (generator throw, drop jump) is now
removed when it lands - it used to stay for over a second and was left behind
as a ghost when the item moved or the page shifted; Play Stage's old "clear
every blocked tile to start Recompletion" notice is gone; the play grids use
the width of the board being played (a Recompletion board can differ); the
rank track and the Play Tester's rank table run to 14 from Recompletion on.

Verified by `scripts/verify-endless.mjs` (42), `scripts/verify-containers.mjs`
(31), `scripts/e2e/endless-mode.mjs` (40), `scripts/e2e/rc-demand.mjs` (17)
and the container checks in `scripts/e2e/build-feedback.mjs`.

### Eleventh review: smoother play, better celebrations, endless for Ops

("later i want u also to work on the smoothness of the merges, and also to
make the celebrations a bit better"; on endless: "im not sure about actual
numbers but its less important, just need to be bigger for now. think of the
logic. ops will need something for that too.") Where anything above
disagrees, this wins.

**How play moves** (`components/PlayEffects.jsx`, which now owns EVERY
effect; the play screens hold no celebration state of their own, and
`LuckyDropCelebration.jsx` is gone):
- a tapped merge slides the item into its match (a copy slides, a second
  copy holds the receiver's old item in place), then the real new item pops;
  a dragged merge is already there, so it only pops - the screen calls
  `fx.dragged()` before applying a dropped action;
- a tapped move slides; a generator throw lands with a small bounce; a tile
  that opens shows its item popping out; drops leave once the merged item
  has formed;
- a pushed-in board slides down from the top (`boardFx`), the Recompletion
  board fades in. In an action where the board itself moved, nothing flies
  (copies would miss their cells) - pops and bursts only, with cells named
  by events corrected for the rows pushed in after them;
- `TileContents` takes `pop` ('merge' | 'land' | 'reveal') and hides the
  item AND its badges while `arriving`. The item's size is the CSS variable
  `--s`; every pop keyframe is a multiple of it. Hover lift, press and the
  selected item's bob use the separate `translate` / `scale` properties so
  they add to that transform.
- THE CELL A PLAYER IS ABOUT TO TAP MUST NOT MOVE OR RESIZE. A merge target
  glows (a `filter` animation). A first version scaled it; the cell was then
  never "stable" - bad for a finger, and every browser test that taps a
  merge target hung.
- An image inside a zero-width positioned box needs `max-w-none` (Tailwind's
  base style is `max-width: 100%`, which makes it 0 wide). That is why the
  endless starburst never showed until this round.

**Celebrations** (`lib/mergeCelebration.js`, `components/Celebrations.jsx`):
no more emoji. A burst is layers in the colour of the rank made - rings, a
flash, four-point sparkles, and confetti for the big tier - sized in cell
units. Tier by rank (small under 5, medium 5-7, big 8+), one tier up and
named ("Rank 7!") the first time a rank is reached. A lucky generator item
flies in a gold glow and lands with "LUCKY +N!". Rank 12 is the grand prize:
the item large over turning rays, "Rank 12 — Grand prize!" (plus
"Recompletion begins — chase rank 14" when it does), paper falling across
the board. Rank 14 adds the falling paper to the endless starburst.
`MergeCelebration` survives only for the rank track's reward-rank node.
Reduced-motion viewers get none of it (payout text only).

**Reward values across phases** (`rewardChain.js`:
`rewardChainForNextPhase`). Since everything on the board comes along, an
item earned in the normal event can be collected in Recompletion or endless.
A phase uses its own ladder for every resource it has values for, and keeps
the previous phase's for a resource it has none for (typically coins, when
Recompletion has no coin target and the build never filled its coin ranks) -
otherwise those items paid nothing. Both engines apply it at the hand-over.
Twister is excluded: its ladder is each list's own, by its own rule.

**Endless mode for Ops.** `endlessOfDesign(mainBoards, rcBoards)`
(`endlessMode.js`) works out endless for a DESIGN exactly the way a session
does at rank 14 (same function, same reward values rule), so what is shown,
exported and played cannot differ - `verify-containers.mjs` plays a session
to rank 14 and compares. Exported in every workbook and Sheets payload:
"Endless Small Rewards Bank" and "Endless Small Reward Weights" (the real
sheets' shapes, merge tiers 2-14) right after the RC container tabs, and
"V2 Endless" (the rules: start rank, top rank, drop start ranks, the two
amounts, marked as this tool's own) as the last tab. None is in the Ops
reference. A design with no Recompletion list has no endless and says so.
The amounts are unchanged (1.5x per drop, 80% coins and merge energy) - the
economist asked only that endless be bigger for now. A container whose
weight rounds to nothing is left out, and per-drop amounts are tidied to
three decimals (a stray 1.0002 had been producing rank-2 items on 0.02% of
drops).

Verified by `scripts/e2e/play-motion.mjs` (37), `scripts/verify-containers.mjs`
(44) and the suites above. Known: `scripts/e2e/build-feedback.mjs` failed
four linked checks in one run of three (that run's Recompletion build did not
come out usable; a build has randomness in it) and passed the two reruns.

### Twelfth review: easy Twister, containers in the flow, jump ahead, two fixes

Where anything above disagrees, this wins.

**Every tile gets an item when the board's DR can fill it** ("i had a problem
in the normal run of a merge that did not reveal a semi blocked tile"; the
log showed a Board 2 queue one item short, and the tile at (1,7) never
opening). Root cause, in both range generators
(`generateCandidateInRange`, `generateCandidateWithSmallRanks`): the
"reserve a variety item" path could come out with FEWER items than tiles
(the reserved max rank swallowed the DR - Board 1 with 150 DR and max rank 8
got 16 items for 30 tiles - or raising undersized items merged some away),
and a short result was accepted (`candidate.length <= desiredCount`). Now
`rankWindow.js`'s `padToCount` splits the non-reserved items up to the count,
and only a reservation that fills EVERY tile is kept; otherwise
`decomposeInWindow` fills as many as the DR can. Also fixed on the way: the
Board 1 generator raised undersized items AFTER splitting oversized ones, so
a narrow rank window could get an item above its max rank.
`eventBuild.js` no longer lets "up to 5% of tiles without an item" through
(sixth review): a tile with no item is always reported. Checked on 12,000
random boards (section 28 of `verify-event-build.mjs`).

**Still this app's own choice, now seen by the economist:** a semi-blocked
REWARD item does not hold a board back, so the next board can push in while
one is still on the old rows ("it progressed with ... a semi blocked tile
that holds a small reward"). The blocked tile in that report was the bug
above. Whether a board should wait for a semi-blocked reward is asked, not
decided - it would then wait on a matching drop that may not come.

**The Small Rewards sheets always come from the model.** The hand-typed bank
fallback (tenth review: "a list with no drops still exports the hand-typed
bank") is GONE: the economist opened the weights sheet before a build was
applied, saw that old table (ten containers, one with a weight) and took it
for the model's. A list with no drops now exports an empty bank and
NoDrop-only weights (`source: 'none'`), and the Syntax tab says to build and
apply. The Rewards tab's two hand-typed cards say they are no longer
exported. Containers are also shown in the flow before step 6: step 4 has
"Containers: what a merge drops" (the last build's, else the applied
design's, else "made by the build").

**From a chosen rank, every drop holds two or more items** ("from a specific
rank merge we will get more than 1 drop 100%"). `board.multiDropRank`
(shared per list, synced, a build input; step 4: "Every drop holds 2+ items
from rank"). `buildAlwaysDropConfiguration` builds a second set of buckets
for those ranks, the same way but with the shares stretched until every drop
is covered twice (`layout(2)`). It needs two rewards that drop; with one,
`multiDropShort` is returned and the results say so. Those merges pay more
than the plain buckets; `deliverableUnits` counts it. The Twister item must
not be the exception: `applyTwisterDropRule` takes `bundleFromRank` /
`bundleWith` and, from that rank, writes the rule as a second rule group
(Twister item + a reward item, same odds) - at RULE time, not build time,
because Twister groups are kept and are a build input. `readTwisterDropRule`
sums every `twisterRule` group. Step 4 rewrites the rule whenever the rate or
the rank changes; the Twister tool keeps an existing bundle.

**Twister, the easy way** ("ill give u the amount of twists for each segment
and ull give the price of a twist. maybe that should be done before the
blocked queue"). Step 4 has the Twister panel: "Add a Twister", then twists
per segment (the plan's `targetSpins` + per-segment overrides), the drop
chance (default 200 in 1,000) and when twists are counted (default 100% =
by the end). Adding it writes default Twister DR rank values
(`TWISTER_DEFAULT_VALUES` 1/3/7/16, only where none are typed; syntax and
asset stay blank) and the drop rule (`fromAuto: true`, so it can be set on an
already-built design, taking weight from generated containers). These
defaults are this app's own and are labelled so; the price adapts to them.
- It HAS to be set before the build: Twister groups are kept, the build
  fills the rest of each table around them.
- `priceTwisterForBuild` (`twisterEconomy.js`) runs the Twister tool's own
  seeded income analysis on the build's boards and picks each built
  segment's price with `suggestSpinCost`; `buildEvent` returns it as
  `draft.twister`, step 6 shows "Twister: the price of a twist", and Apply
  writes `twisterSpinCost` per segment (`twisterCostBasis.source: 'build'`).
- TWISTS ARE NOT A BUILD INPUT. They change no board. A draft remembers
  which twists its prices are for (`twisterKey`, `twisterInputsKey`); when
  they differ, `BuildEventPage` works the price out again by itself
  (`repriceTwister`) and, if the draft is applied, writes the new prices to
  the design. A first version made twists an input part: typing a number in
  the Twister tool then marked the whole build out of date and blocked
  validating it. Do not put them back among the inputs.

**Jump ahead (Play Tester only).** `playSession.js`: `canJumpTo` /
`jumpToPhase`, buttons "To Recompletion" / "To endless mode". A jump is a
CLEAN arrival (asked and confirmed: "only if im using the jump button"): a
fresh first Recompletion board holding just a rank 12, or a clean board (the
first Recompletion board's size, every tile open) holding just a rank 14,
with no further board pushing in. Nothing else comes along; collected
rewards and balances are kept. Reaching a phase by PLAYING still carries the
whole board over (ninth review). The session is marked `jumped`, says its
history is not a real run, and hides the simulator comparison. Sessions now
carry an `id`; the effects layer clears everything in flight on a Reset.

Verified by `scripts/e2e/twister-easy.mjs` (31), the jump section of
`scripts/e2e/endless-mode.mjs` (56 in all), `scripts/verify-containers.mjs`
(58) and section 28 of `scripts/verify-event-build.mjs`. Two old tests were
made honest rather than lucky: `verify-v2-rewards.mjs`'s scripted climb now
follows a lucky generator roll (it crashed about 29% of runs), and its
derived-segment check asks for 1.25x instead of a 1.5x that sat on its own
20% band.

### Thirteenth review: containers with several items, and a Twister sized by the build

Two requests. Where anything above disagrees, this wins - in particular the
twelfth review's "from a chosen rank every drop holds two or more" (a switch)
and its Twister drop chance typed in step 4.

**Containers with several items rise with the rank** ("a container can hold
more than 1 resource ... i want to see containers with more than 1 item, and
sometimes we will get them. as the merge in a higher rank the % of a multi
item drop will go higher and from a specific rank it will be 100% more than
1"). `buildAlwaysDropConfiguration` (`rewardTargeting.js`):
- the share of a rank's drops that hold two or more items rises in equal
  steps from the first dropping rank and is 100% from `board.multiDropRank`
  (drops from rank 6, 100% from rank 10: 20%, 40%, 60%, 80%, 100%). It is
  never below that; where the targets already give more, they are left alone.
- `multiDropRank` is always set now: `multiDropRankOf(board)`, default
  `DEFAULT_MULTI_DROP_RANK` = 10 (`dropGroups.js`). The default rank is this
  app's own; the behaviour is the economist's. Step 4's field cannot be
  emptied.
- each rank gets its own containers (`setFor(rank)`), so the weights sheets
  show one stretch per rank of the rise.
- more items is more payout. WITHOUT a Twister: where the drops have room,
  the lower ranks carry a little less so the total is what it would be with
  no rise (`level`); where one item per merge is already too much, the drops
  pay more, the build takes the difference out from under the tiles, and a
  design with small targets ends with few or no reward items under tiles.
  (`verify-event-build` section 25 asks for larger targets for this reason.)
- a kept single-item group (a hand-written Twister rule) counts against the
  share, so the generated containers carry more of it.
- `ContainersTable` has a row "Drops that hold two or more items" per stretch
  of ranks.

**The build sizes the Twister** ("we got a problem with the twister. we can
let the user get a lot more drops of the twister, fix it so we will go closer
to the 15 spins i gave. it can make the economy for u easier with the
multiplied drops from merges"; the screenshot: 15 twists asked, a price step
of 10, counted at 70%, a typical player getting 0 to 2).
- `board.twisterByBuild` (shared per list, synced, a build input). True: the
  build puts the Twister item into the containers itself; a hand-written rule
  (`twisterRule` groups) is replaced. False: the drops are a fixed chance set
  in the Twister tool, kept as before (and the build can then only price).
  "Add a Twister" in step 4 sets it true; setting a drop in the Twister tool
  sets it false; step 4 then offers "Let the build set the Twister drops".
  Migration (`migrateTwisterByBuild`, App.jsx): a save with a rule AND twists
  typed for that phase becomes true; a rule with no twists is left alone; a
  choice already made is never changed.
- THE TWISTER ITEM IS THE FILLER (`twister` option of
  `buildAlwaysDropConfiguration`). It has no payout target - its price is set
  afterwards - so it is the one item that can be added freely: a drop the
  rewards leave empty holds a Twister item (so there is NO one-item-per-merge
  floor on the rewards and no `drop-floor` problem with a Twister), and the
  second item of a multi-item container is the Twister item. A reward item is
  only forced into as many drops as must hold two items once the Twister item
  is already in all of them. At least `TWISTER_FILL_MIN_SHARE` (20%, this
  app's own) of every rank's drops hold one. A container holds four items at
  most; the Twister item gives way.
- THEN IT IS SIZED (`buildEvent`, after everything else is built): every
  segment is priced; while a segment's average Twister DR at the checkpoint
  is under `TWISTER_PRICE_STEPS_AIM` (2, this app's own) price steps per
  twist, the Twister is raised one step and measured again - a bigger item
  up to rank 3, then a Twister item in more drops up to every drop, then up
  to rank 4. `resizeTwisterDrops` does it on the build's own output and
  changes no reward item, no weight and no board, so nothing is rebuilt. (Two
  Twister items of a rank merge at once, so even one per drop leaves at most
  three on the board.) `draft.twister.sizing` says what was done; `short`
  when a rank-4 item in every drop is still too little.
- A Twister item in every drop makes every drop that holds a reward a
  two-item drop, at every rank: the rise above is then flat. With the
  economist's numbers (step 10, 70%) that is what the arithmetic needs; a
  smaller price step or counting later keeps the rise. Step 6 says so.
- Twists are still not a build input. Typing more twists than the built
  drops give shows "build again" (`sizing.needsRebuild`); fewer just reprices.
- Step 4 now also has "The price moves in steps of" (the plan's
  `costIncrement`), because it decides how close the price can land.
- Endless: Twister items the build put into the RC containers carry on as the
  filler of the endless containers, at the size they had (`buildEndlessDrops`).
- The Twister tool's own rule now takes weight from the build's containers
  when no "nothing" weight is free (`fromAuto`), so it can be set on a built
  design.

Measured (single runs; a build has randomness in it): engine, two segments,
15 twists / step 10 / 70% - a fixed 200-in-1,000 chance gave 0 and 1 twists,
the sized build 15 and 14 at prices 20 and 40. Browser, same numbers: 14 and
16 at prices 20 and 30.

Verified by section 4b/4c of `scripts/verify-containers.mjs` (78 checks in
all), section 29 of `scripts/verify-event-build.mjs` (255) and
`scripts/e2e/twister-easy.mjs` (43).

### Fourteenth review: the board waits, single-item containers, three-item containers

Four requests after the thirteenth review. Where anything above disagrees,
this wins - in particular the thirteenth review's Twister sizing "in more
drops, up to every drop" after the build, its "where the targets already
give more multi-item drops they are left alone", and the seventh review's "a
stuck REWARD item does not hold a board back".

**A board waits for its semi-blocked reward items** ("the board should wait
for it"). `boardIsCleared` (`mergeSimulation.js`, shared by the simulator
and play) counts every semi-blocked item, a small reward included. The one
exception is this app's own: a semi-blocked reward CARRIED into Recompletion
stays semi-blocked but is `state.passive` - the Recompletion board does not
wait for it (Recompletion has its own drops, which may never drop the match
for a normal-event reward; its first board would wait for ever).

**Reward items are placed so they can be opened** ("we should try to put the
items that are semi blocked in a way that the user will be able to open
them"). A semi-blocked reward is freed by merging a FREE item of the same
reward and rank into it, and free reward items only come from merge drops,
mostly rank 1. So (`rewardPlacement.js`):
- on each board a reward's items form a CHAIN from rank 1 (1, then 2, then 3,
  as far as the board's rank limit goes): one rank-1 drop opens the first,
  the item that makes opens the next. Board 1 and the middle boards take one
  reward after another (all rank 1s first); the last board finishes a chain
  before starting the next. The old patterns (3,2,1 / 1,1,2) are gone;
- a reward with nothing asked of merge drops gets nothing under tiles
  (`droppingTypes`) and that is said - so "100% under tiles" now places
  nothing;
- THE GUARANTEE IS BY SIMULATION (`smallRewardsWorkflow.js`): the share of
  the phase's subsidy a player reaches (`validateConfigAcrossRuns` now
  returns `subsidyReached` per phase, with the board runs stopped on) is
  measured with no generated reward item under tiles, and a candidate that
  reaches more than `HOLD_TOLERANCE` (5%) less "holds a board back": half the
  generated reward items come off the board most runs stopped on
  (`maxAutoByBoard`), their units go to the drops, and it is tried again (at
  most `MAX_TAKE_BACKS`). A candidate that does not hold a board back always
  beats one that does. Caps carry over between a build's passes
  (`tileCapsStart`). The result's `tileHold` says what was kept off; step 6
  shows it. Pinned reward items are never moved - if they hold a board back
  it is reported.

**Merge energy lands on its target, and a build settles.** Waiting boards
made the energy a pass collects move by a prize between passes, and builds
stopped settling. Three things fixed it, all needed: energy is steered to
within `ENERGY_CONVERGED_TOLERANCE` (1%) with `ENERGY_EXTRA_ROUNDS` smaller
steps; a candidate with energy on target beats one without, whatever the
other rewards' distance; and `buildSegment`'s next pass aims at the energy
TARGET again after a near miss (`NEAR_TARGET_CREDIT`) instead of following
the miss. A pass still only counts as settled when its own simulation agrees
with the credit it was built with.

**Single-item containers stay; the multi-item share IS the rise** ("we should
have also some containers of only 1 drop. not 80% of the more than 1").
`layout(stretch, twisterShare, cover, rotate)` in `rewardTargeting.js`: a
rank's drops hold exactly `cover` items on average (1 + the share with two
or more + the share with three or more). When the rewards and the Twister
item would cover the drops more often, the rewards are SQUEEZED: put into
fewer drops as bigger items, the same units - part of each reward's drops
stay rank 1 (they are what opens a reward item under a tile) and the rest are
one bigger rank, rank 3 at most (`SQUEEZED_TOP_RANK`; a rank-4 item would pay
a whole prize from one merge). A reward that needs more than rank-3 items in
that few drops keeps more drops, and the share is then above the rise.

**The Twister item is in several containers** ("only 1 container has the
twister, it looks a bit weird"). The line of rewards starts with a different
reward at each merge rank (`rotate`), so the Twister item lands on a
different reward each time; where the rewards leave drops empty it is also a
container of its own.

**The Twister's two levers, corrected.** IN HOW MANY DROPS it sits is decided
BEFORE the build from what the twists need (`twisterNeed` -> the workflow:
enough drops that rank-4 items could carry it by the checkpoint, with
`TWISTER_SHARE_ROOM` = 2; never under `TWISTER_FILL_MIN_SHARE` = 40%). The
rewards make room by squeezing, so this no longer makes more drops multi-item
drops. HOW BIG the item is, is raised after the build up to rank 4
(`resizeTwisterDrops`, item rank only). Twists therefore act at build time,
but are still not in the staleness key (more twists later -> "build again").

**Containers with three or more items** ("we should also add some containers
with more than 2 resources. the really high merges should have a chance to
give those and lets say rank 10 and 11 have to give more than 2").
`board.tripleDropRank` (shared per list, synced, a build input;
`tripleDropRankOf`, default 10 - the economist's number). From it every drop
holds three or more; between the two-item rank and it the share rises
(two-item rank 8, three-item rank 10: half the drops at rank 9). The two-item
rank is always at least one rank before it (`multiDropRankOf` caps it) and
its default is now 8. Three items take three different rewards (the Twister
item counts); otherwise `tripleDropShort`. Step 4 has both ranks; the
containers table has a row for each share.

**Endless readout.** Containers now differ by rank, so `describeEndlessDrops`
averages over the drops a player gets (a merge that makes rank r happens
half as often as rank r - 1), not over the rank tables equally.

Verified by sections 4b-4d of `scripts/verify-containers.mjs` (87 checks in
all), sections 29-30 of `scripts/verify-event-build.mjs` (265) and
`scripts/e2e/twister-easy.mjs` (44). `verify-event-build`'s Recompletion
fixture asks for 300 merge energy now: with every merge from rank 9 dropping,
150 is less than the drops alone pay.

### Fifteenth review: reward items stay on every board; Twister before the containers

Feedback on the fourteenth review. Where it disagrees, this wins.

- **The take-back never empties a board** ("u took all the small rewards in
  the tiles to the last board. it cant be like that, the logic should be a
  bit like the last one"). The simulation guard of the fourteenth review took
  reward items off the early boards until none were left, so they all sat on
  the last board (which holds nobody back). Now a board never loses more than
  half of what the placement first gave it, Board 1 keeps at least one reward
  item and every board before the last at least two (`keepAtLeast` in
  `smallRewardsWorkflow.js`), and nothing is ever taken off the last board.
  When the boards then still wait long enough to cost the player subsidy, it
  is REPORTED (`tileHold.holds`, step 6: how much of the DR under tiles is
  reached with and without reward items under tiles) - not fixed by removing
  the items. Still true and still a cost: with no Twister, the multi-item
  rules force so many reward items into the drops that little is left for
  the tiles at small targets.
- **Step 4 shows the Twister panel before the containers**, and when the
  Twister was added after the containers on screen were built it says so:
  the build makes the containers again with the Twister item in them
  (`twister-rebuild-note`).
- **NOT DONE - the effort distribution suggestion.** The economist asked for
  73% of the effort at rank 12 and the suggestion gave 54% (27% at rank 11).
  The search (`effortTargeting.js`) only moves DR between boards, with Board
  1 capped at 150 DR; to push effort to the last rank the subsidy has to
  reach the player EARLY, which is decided mostly by which ranks sit under
  which board's tiles and in what order - not something the search changes.
  It was not investigated further in this round and nothing was changed.

### Sixteenth review: tiles first, Twister items stay mergeable (UNFINISHED)

Where the fifteenth review disagrees, this wins. This round ended with known failures - read before building on it.

- Twister items are small rewards the player merges: the build never makes one bigger than rank 3 (TWISTER_MAX_ITEM_UNITS = 4 in eventBuild.js; a rank-4 item is collected the moment it drops - the economist: "u now just give it to the users"). Its share of the drops is sized as if items were rank 2 (smallRewardsWorkflow.js).
- The tiles come first (smallRewardsWorkflow.js, the block before the always-drop tile lowering): when the multi-item rise makes the drops pay more of a reward than asked and leaves under half of that reward tile share, the rise is made cheaper step by step (riseFromRank in buildAlwaysDropConfiguration: start one rank before the two-item rank, start at it, two items only one rank before the three-item rank, none). The result records it in riseUsed and a finding.
- KNOWN PROBLEM: that per-reward test is too eager. With a Twister and small targets it falls all the way to none, so multi-item and three-item containers disappear from the build. scripts/e2e/twister-easy.mjs fails for this reason (its multi-item checks). An aggregate test over all rewards was tried and made tile items vanish instead; it was reverted. Needs a proper rule: scale the rise to what the drop units can fund, keeping the high ranks (10, 11) first.
- The effort distribution suggestion is still not looked at (see the fifteenth review).

### Seventeenth review: the effort distribution works again

The economist: "the distribution has to work" - it had stopped being shapeable. CAUSE (introduced in the fourteenth review): a board waits for its semi-blocked reward items, and the effort distribution search (effortTargeting.js) simulates with NO merge drops - so on any design with reward items under tiles nothing could ever open them, Board 1 never cleared, no later board arrived, and moving DR between boards changed nothing.

FIX: simulatePlaythrough sets state.rewardsCanOpen = false when the run has no drop table with any weight (main or RC), and boardIsCleared then lets only main-chain items hold a board. Runs with drops (builds, validation, play) are unchanged: there the board waits. Do not remove this: every main-chain-only run depends on it (effort search and chart, starting-goal check, editor readouts).

Checked in section 30 of scripts/verify-event-build.mjs (boards with reward items under tiles, no drops: every board is reached, and the effort suggestion reaches every board). NOT re-measured: how close the suggestion now gets to a 73%-at-rank-12 curve. The sixteenth review's known problems (multi-item containers left out too eagerly; twister-easy e2e failing) still stand.

### Eighteenth review: reward items no longer jam the main-chain runs

The economist saw "N DR of subsidy would never reach the player" on most segments of the effort distribution suggestion. CAUSE: in a run with no merge drops (state.rewardsCanOpen === false - the effort search, its chart, the starting-goal check) a reward item revealed from under a tile was still semi-blocked. Nothing could ever open it, and a semi-blocked item cannot move, merge or be given up for space, so a design with many reward items under its tiles filled the board with dead cells; the simulated player ran out of room and the later boards' subsidy was never reached. Measured on a 150/600/800 chain with 18 reward items: 1,294 of 1,550 DR delivered and 692 DR spent, against 1,550 and 454 with no reward items.

FIX (mergeSimulation.js): in such a run a reward item arrives FREE (revealNeighbors, pushBoardIn, and the first board's semi cells in simulatePlaythrough), so the simulated player can clear it away for space. Same fixture after: 1,550 of 1,550 DR, 460 DR spent. Runs with drops are unchanged. Checked in section 30 of scripts/verify-event-build.mjs. The file has CRLF line endings in places: multi-line anchors in patch scripts fail there.

### Nineteenth review: Twister drops stay rank 1; the containers come back

("wherer are all the containers? also, we see only drops of the twister in
rank3. its too high, it makes the rank1 of it useless.") Where the sixteenth
review disagrees, this wins.

- **The Twister's VALUES are sized, not its rank.** While nobody has typed
  the Twister DR rank values (`twisterLadderIsAuto`, `rewardChain.js`: every
  valued rank carries `auto: true`), the build keeps every Twister drop a
  rank-1 item in its usual share of the drops (`TWISTER_FILL_MIN_SHARE`) and
  multiplies all four values by one whole number so the worst-off segment
  collects `TWISTER_PRICE_STEPS_AIM` price steps per twist (`buildEvent`;
  always built up from the starting 1/3/7/16, so a rebuild does not
  compound). The ladder is in `draft.shared.twisterLadder`, applied by
  `boardsWithDraftApplied`, and is an OUTPUT (`rewardChainAsBuildInput`).
  Typed values are kept; only then do the drops carry it (more drops, an
  item of rank 3 at most - the sixteenth review's path).
- **The multi-item rule is judged per reward, without build-valued coins**
  (`smallRewardsWorkflow.js`, `TILE_SHARE_KEPT` = half): the first step that
  leaves every reward at least half of its tile items is used, else the one
  that leaves the most. Coins whose values the build sets are not counted
  (their value absorbs it) - counting them is what switched every multi-item
  container off.
- Measured on one two-segment test event (15 twists, step 10, 70%; small
  targets): 30 containers with the two-item and three-item rules in force,
  every Twister drop rank 1, values 9/27/63/144, a typical player at 14 and
  14 twists; reward items under tiles on every board but only about one per
  board. With small targets the multi-item rule and the tiles still compete.
- NOT re-run after this round: any browser suite.

### Twentieth review: containers first, drops the bigger part

The economist, asked to choose between protecting the tiles and protecting the multi-item containers: "u can even give the distribution in anyway u think is best. its just important that the drops will be the bigger part." Where the sixteenth and nineteenth reviews disagree, this wins.

- CONTAINERS FIRST. The "tiles first" fallback (riseFromRank steps, TILE_SHARE_KEPT, riseUsed) is REMOVED from smallRewardsWorkflow.js: the containers a merge drops are always made as set, and what that makes the drops pay comes out from under the tiles. A small build can therefore have few or no reward items under tiles; that is accepted. (riseFromRank still exists in buildAlwaysDropConfiguration, unused.)
- DROPS ARE THE BIGGER PART. segmentBuildInputs (eventBuild.js) caps what is asked of the tiles at MAX_TILE_SHARE_PCT (40%), whatever split was typed; the build takes less when the containers need more. The typed split in step 4 is therefore an upper wish, not what the build uses.
- Measured (single runs): targets 900 puzzles / 200 energy / 1200 charms on a 150/500/500 chain give reward items on every board (2 / 5 / 10) with 91-94% of each reward from drops; the same chain at 300/200/400 gives 0 to 2 tile items in all.
- NOT re-run after this round: every browser suite. scripts/e2e/twister-easy.mjs was failing before it and build-flow e2e checks that read a 50% split may now read 40.

### Twenty-first review: Board 1 without rewards; the build keeps the effort distribution

("the splits befor and after the boards build with the small rewards are
extremelly off from each other ... it needs to protect the distribution i
asked for and approved in the build"; "i played with the simulator and im
stuck on the first board ... the first board doesnt hold any small rewards on
it, and we will have some in the 2nd and 3rd".) Where anything above
disagrees, this wins.

- **Board 1 holds no generated small reward** (`rewardPlacement.js`, in a
  list of two or more boards; a single-board list is left as it was; pinned
  items are untouched). A reward item there is semi-blocked until a matching
  item drops, and at the start nothing drops yet - the economist got stuck on
  Board 1 in play. The 15% Board 1 share and its "at least one" floor are
  therefore moot.
- **A reward's chain can start again at rank 1** when too few units are left
  for its next rank (`rankFor`), so the units asked are placed in full.
- **The build keeps the effort distribution that was asked.** The same board
  amounts give very different distributions depending on which item ends up
  under which tile, and a build generates that afresh (the Effort step's own
  suggestion showed 73% at rank 12, the built boards 46%). `eventBuild.js`:
  `setEffortTargetForBuild(phase, pctByRank)` (called from `App.jsx` with
  the curve typed in the Effort distribution step, main phase only) and
  `pickBoardsForEffort`: after a segment is built, its boards are generated
  again `EFFORT_LAYOUT_TRIES` (24) times - same DR under every board, same
  reward items, every tile with an item, Board 1's starting goal kept - and
  the set whose main-chain-only run is closest to the target is returned
  (`effortFit` on the segment result: target, curve, distance before and
  after). Measured on the test build: distance 279 -> 20 and 159 -> 43, rank
  12 at 68% and 75% of the effort with 70% asked.
- KNOWN LIMITS: the typed curve lives in memory only, so after a reload it
  has to be typed again before building or nothing is protected; Recompletion
  is not covered; the review's reward figures were simulated on the layout
  before the pick (the independent validation in step 7 re-simulates the
  final boards); step 6 does not yet show `effortFit` in words.

### Twenty-second review: rank-1 drops at the low ranks, two rewards under tiles

Where anything above disagrees, this wins.

- LOW RANKS DROP RANK-1 REWARD ITEMS. At the first two dropping ranks (start rank and the next) every reward item in a container is rank 1 and nothing is squeezed into bigger items (layout low mode in rewardTargeting.js, on when guaranteedTypes is passed). The economist had a rank-1 reward semi-blocked for a long time while merges dropped higher ranks.
- TWO REWARDS GO UNDER TILES in a build: the two with the largest unit budgets (tileTypes in smallRewardsWorkflow.js). At the first two dropping ranks they are stretched so that EVERY drop holds a rank-1 item of one of them (guaranteedTypes) - their match comes quickly. This makes the drops pay more of those two rewards; the tiles get less of them.
- REWARD ITEMS COME EARLY IN A BLOCKED QUEUE: main, reward, main, reward from the start (interleaveRewards in placement.js), no longer spread evenly.
- Twister values: TWISTER_VALUE_STEPS_AIM lowered from 6 to 3 after the economist saw almost 700 Twister DR from one rank-4 merge. The size of the values follows twists x price step; a smaller price step makes them smaller.
- NOT FOUND: the economist reports that in Recompletion a tile does not become semi-blocked after a merge next to it. In the engine it does, both after a jump and after reaching rank 12 by play (a merge next to a blocked tile opened it, item semi-blocked). Not reproduced; needs the exact case (which board, was the RC list built, mover or receiver side - in play only tiles next to the RECEIVING item open).
- NOT re-run after this round: every browser suite. No new check was added for the three rules above.

### Twenty-third review: the Small Rewards sheets against the economist's example

The economist put an example of how the small-reward sheets should look in the project root: "Merge Out.xlsx" (three sheets: Small Rewards = Key | Syntax | Asset for coin-r1..4, dr-r1..4, puzzle-r1..4, charm-r1..4; Small Rewards Bank = Key | Syntax for ContA..ContJ; Small Reward Weights = Merge Tier | ContA.. | NoDrop for tiers 2-12, small whole weights). It is the reference for these three sheets. They said the syntax output "is not right" without saying which part.

Done: buildSmallRewardsSheet (eventSheets.js) lists the rewards in the example's order (coin, dr, puzzle, charm) and, when the list's containers drop the Twister item, adds dr-twister-r1..4 rows so that every key a container names exists (syntax and asset as typed, blank otherwise).

OPEN, asked of the economist: (1) coins - the example writes literal amounts (coins:100000, and coins:245679+free_wild:1 at rank 2) while a build writes allowance(coins:X); (2) whether the Twister keys and the RC / Endless / V2 tabs should be in the export at all; (3) whether weights out of 1000 are fine (the example uses 1 and 2).

### Twenty-fourth review: Twister total = twists x price; four reward items before the last board

Where the twenty-second review disagrees, this wins.

- TWISTER: the economist: "if each twist is 10 and we got 15 its a total of 150 DRs, u now give thousands". TWISTER_VALUE_STEPS_AIM is 1.1 (was 6, then 3): the Twister values are sized so the worst-off segment collects about twists x one price step by the checkpoint. Measured: values about 10 / 30 / 70 / 160, a typical player at 14 to 17 twists of 15. With one step per twist the price can only be a whole step, so twists land a few off; repriceTwister uses the same aim for needsRebuild.
- REWARD ITEMS IN THE QUEUE are spread evenly again (interleaveRewards). Putting them at the start (twenty-second review) made the main chain open later and builds stopped settling; it is reverted.
- AT MOST FOUR REWARD ITEMS ON A BOARD BEFORE THE LAST in a build (MAX_REWARD_TILES_BEFORE_LAST in smallRewardsWorkflow.js; Board 1 still has none; the last board is not limited). They are two rewards with a chain of two each, opened by the rank-1 items the first two dropping ranks always drop. The economist accepts being a bit stuck on the last board, not on the earlier ones.

### Twenty-fifth review: a short reward is topped up on the last board

The economist: "maybe if we are missing some small rewards, we can try to rebuild the last board with adding small rewards tiles into it that will make us get to the amount we are looking for? ... maybe taking up the EV?" Done as asked, on the last board; the EV was NOT touched (the lucky-drop EV is one shared value that moves the whole economy and the effort distribution, not a small-reward lever).

- In a build, the two tile rewards (tileTypes) are the only rewards on boards BEFORE the last (earlyTypes in proposeRewardPlacements); the LAST board takes any reward that drops, with no limit on how many. It holds nobody back, so it is where a reward that is still short gets its items - which matters most for the segments that take the shared drops as they are and can only steer with tile items.
- TWISTER_FILL_MIN_SHARE is 0.8 (twenty-fourth review, after a run where a typical player had 0 twists with 0.4).
- Only verify-event-build and verify-v2-rewards were re-run after this change; no check asserts the top-up itself, and no browser suite was run.

### Twenty-sixth review: rank 13 under Recompletion tiles

The economist: "we have a roof value of 12 under blocked tiles. in the RC we should be able to also use a rank 13." The highest rank under tiles was capped at 12 only by the two input fields; nothing in generation clamps it. Build event step 2 ("Highest rank under tiles") now allows 13 when the phase is Recompletion, and the advanced Recompletion board list too (BoardList prop maxRankUnderTiles, passed as 13 from App.jsx). The normal event stays at 12. A board's default is still 12: the economist sets 13 where wanted. Not checked: a build and a play-through with a rank-13 item under a Recompletion tile.

### Twenty-seventh review: "Most DR it can hold" was wrong for Boards 1 and 2

The economist saw 32,768 DR as the most a Recompletion Board 1 can hold. layoutCapacity (eventBuild.js) multiplied every blocked AND semi tile by the value of the TYPED highest rank. It now uses the rank the board can really hold (effectiveMaxRank: Board 1 never above rank 8, Board 2 never above rank 11) and, on Board 1, counts the semi tiles as the small fixed items they are. Step 2 shows the real rank limits, with the typed ones beside them when they differ. A single Recompletion board therefore holds about 3,840 DR (30 blocked tiles x 128): less than a typical Recompletion subsidy (6,144 - demand), so Recompletion needs more than one board.

### Twenty-eighth review: Recompletion Board 1 may carry 300 DR

The economist: "i will give 2 Boards for the RC, and u can take the max DR to the first board to 300". board.js: RC_FIRST_BOARD_SUBSIDY_CAP_DR = 300 and firstBoardCapFor(phase). Used by subsidyBudget.js (fillLastBoard / spreadSubsidy, which already took the phase), eventBuild.js (allocateSubsidy option firstBoardCap; a module-level activeFirstBoardCap set at the start of buildSegment and read by the Board 1 check and the spread test - builds run one after another, never interleaved), Build event step 1 and the Recompletion board editor. The normal event stays at 150. This REPLACES the eighth review's "the first RC board keeps the 150 DR limit". Not updated: the hint text in BoardList.jsx still says 150 on a Recompletion list, and the Effort step (normal event only) is untouched.

### Twenty-ninth review: pinning a rank 13 on a Recompletion board

The economist: "we are missing here the option that i will pick 13 to a specific place". BoardGrid takes maxBrushRank (default 12); Build event step 2 and the advanced Recompletion editor pass 13 for a Recompletion list, so the Rank brush offers 13 for a semi-blocked tile. A pinned rank is honoured as typed - the positional ceilings (Board 1 rank 8, Board 2 rank 11) only limit what the build generates, not a pin - so this is how a rank 13 gets onto the SECOND Recompletion board. Checked in the engine: a second Recompletion board, 5,300 DR, a semi tile pinned at rank 13 -> the cell holds rank 13, exact DR, every tile filled, the generated items rank 11 at most. Not checked in the browser.

### Thirtieth review: round Twister values

The economist: "we need the amount in the twister to be more rounded, lets say to 5 with the same multilication logic. maybe somehting like 2, 5, 12, 30". TWISTER_DEFAULT_VALUES is 2 / 5 / 12 / 30 (was 1 / 3 / 7 / 16). When the build sizes the values it still multiplies the starting ladder by one factor, but writes ROUND numbers (roundTwisterValues in twisterEconomy.js): a value of 10 or more is a multiple of 5, a smaller one a whole number, and each rank is raised if rounding would break the merge rule (checked for 590 factors from 1 to 60: none invalid). Factor 1 returns the starting values untouched. Examples: x2 = 4/10/25/60, x5 = 10/25/60/150, x8 = 15/40/95/240. Typed values are still kept as typed.

### Thirty-first review: "im in the RC now, it is completely broken"

The screenshot showed Recompletion in the Play Tester with semi-blocked tiles EMPTY, blocked tiles that never open, both Recompletion boards already pushed in and "No more boards queued". CAUSE (read from the picture, not reproduced on the economist's data): the applied Recompletion boards had no contents. The economist had just edited their layouts (two boards, rank 13, pinned tiles), and a layout edit clears that board's contents; Recompletion was not built and applied again. A board with tiles and an empty queue counts as cleared at once (its locked tiles are "dead"), so the next board pushed in immediately and nothing could ever open.

DONE: the Play Tester shows a warning (data-testid rc-not-built) naming the Recompletion boards that have tiles but nothing under them, before the player reaches rank 12. NOT DONE: the same warning in Play Stage and in Build event step 7; refusing to enter Recompletion on unbuilt boards.

### Thirty-second review: "Share stage" did not copy the link

handleShare / handleSharePlan (App.jsx) called navigator.clipboard.writeText with nothing around it: when the browser refuses (page without focus, a non-secure address such as a LAN IP instead of localhost, a blocked permission) the click did nothing and said nothing. Now copyText() tries the clipboard API, then the older select-and-copy way, and when both fail the link itself is shown in the warning banner to copy by hand; a link that cannot be built says why. NOT reproduced on the economist's machine, so the exact reason their copy failed is unknown. Checked in the engine only: a three-board stage with two Recompletion boards and ten containers encodes to a 2,645-character link and decodes back.

### Thirty-third review: the share link really copies, and is always shown

After the thirty-second review the economist got "link copied" with nothing on the clipboard. That was a bug of that round: a replace-all turned the clipboard call INSIDE copyText() into a call to copyText itself, so it recursed until the stack overflowed, fell through to the older select-and-copy way, and that reported success without copying. Fixed (App.jsx: copyText calls navigator.clipboard.writeText). In addition every Share stage / Share planning now shows the link in a box under the header (data-testid share-link-box / share-link; the field selects itself on click) so it can be copied by hand whatever the browser does. Checked in a real browser with Playwright: the box shows the link and the clipboard holds exactly that link.

### Thirty-fourth review: copying does not work anywhere in the economist's browser

The economist: "i can see the link but idk why im failing to copy it. it looks like i got a copy problem with everything in the app itself". Checked: the app has no global user-select: none, no copy handler and no key handler that could block copying (only InfoHint's summary is select-none). In a normal browser the copy works (Playwright, thirty-third review). So the cause is where the app is being viewed - most likely an editor's built-in preview pane or another embedded browser, where neither the clipboard API nor Ctrl+C reaches the system clipboard. NOT confirmed. Added to the share-link box: "Open it" (opens the link in a new tab / the system browser) and "Save as a file" (downloads merge-mania-link.txt), so the link can be taken out without the clipboard.

### Thirty-fifth review: published; one resource per item

- **Committed and deployed** on the economist's explicit go-ahead (commit
  16832a3 on master, pushed; `npm run deploy` to gh-pages; the live site was
  checked to serve the new build). This ends the standing "do not deploy / do
  not commit" for that one action only - later changes are again local until
  the economist asks.
- **Two-item drops at the low ranks are accepted for now** ("2 items is ok
  for now").
- **One item pays one resource** ("the syntax of the items should only give 1
  resource, some of them u show that give more than 1"). The charm rank-2
  seed was `free_undo:1+[dynamic(dr-mf-charm:4)]+free_entry:1` (value 4); it
  is now `[dynamic(dr-mf-charm:10)]` (value 10), as in the economist's
  example sheet. `ensureRewardChainConfig` rewrites a saved project's charm
  rank 2 only when it is still exactly that old seed; typed syntaxes are left
  alone. `multiResourceSyntaxes(config)` lists any rank whose syntax joins
  several terms with "+" - NOT yet shown anywhere in the UI. The value change
  (4 -> 10) is a build input, so a built design becomes out of date.

### Thirty-sixth review: rank 6 drops one item, one reward under the tiles, Board 2 only above rank 1; the stage on a phone

("we will do some changes now. some rules. we need a rule for max of 1 drop
from a merge. i want that only board 2 can hold small rewards bigger than rank
1. lets make the rank 6 merges focus on the blocked tiles of the small rewards
on the board. (their buckets). maybe even the blocked should be all of them as
coins and the rank 6 focus mostly on dropping coins. or energy (energy can be
cool)"; then: "i want the link to be mobile friendly. the stage share is
mostly to be used on the phone. prefered landscaped."; and, correcting the
first reading of the first rule: "i wanted that only rank6 will be a solo
reward drops. the others should act like befor. with tier of when 2 items and
when 3 items.") Where anything above disagrees, this wins - in particular "two
rewards under tiles" and the last-board top-up (twenty-second to twenty-fifth),
and rank 3 under the last board. The containers with several items and their
two- and three-item ranks (thirteenth, fourteenth, twentieth reviews) STAY, for
every rank above the single-item one.

**Rank 6 drops one item; every rank above keeps its containers.**
`board.soloDropRank` (shared per list, synced, a build input; `dropGroups.js`:
`soloDropRankOf`, default 6; step 4: "One item only, up to rank"). A merge
that makes that rank OR A LOWER ONE drops exactly one item; every higher rank
drops a container as before, by the two-item rank (default 8, the share
rising before it) and the three-item rank (default 10). With drops from rank 6
that is rank 6 alone; with drops from rank 5, ranks 5 and 6; set below the
start rank, no rank is single-item.
- THE FIRST VERSION WAS A MISREADING: it made EVERY rank single-item, behind a
  "One item / Several items" switch (`board.maxDropItems`). That switch and
  field are gone (a saved board may still carry the field; nothing reads it).
  The all-ranks path survives only as `buildAlwaysDropConfiguration({ maxItems:
  1 })`, which nothing in the app calls; its "few items, start drops earlier"
  logic (`lowerStartRank`, `singleItemStartRankThatFits`) only applies there.
- `buildAlwaysDropConfiguration({ soloRank, focus })` (`rewardTargeting.js`,
  "THE SINGLE-ITEM RANKS"): the single-item ranks are laid out first - the
  reward under the tiles in its share, the Twister item in
  `twister.soloShare`, the other rewards as RANK-1 items sharing the rest in
  proportion to what they need (their own part: these ranks' share of all the
  drops, or more of the same rewards when that leaves drops empty). What those
  ranks deliver (`soloDelivered`) is taken off the need, and the several-item
  machinery sizes the REST over the ranks above only (`need`, `drops`,
  `rampRanks`). Coins the build values are not counted off.
- The "first two dropping ranks" layout of the twenty-second review (`low`:
  rank-1 items only, the tile rewards in every drop) is switched OFF when
  there is a single-item rank: that rank now does its job, and rank 7 follows
  the two-item rise like any other rank.
- Consequence to know: rank 6 is almost half of all the drops and now carries
  little of the other rewards (15% of its drops, rank-1 items), so the ranks
  above carry nearly all of them - as bigger items (rank 3 at most), and when
  the amounts are large with more items per drop than the two ranks ask
  (measured below: every rank-7 drop held two items, some three).

**One reward under the tiles, and the first dropping rank feeds it.**
`board.tileRewardType` (shared, synced, a build input; `tileRewardTypeOf`,
default `'coins'`; step 4: "The reward under the tiles"). In a build every
generated reward item under a tile is that ONE reward; every other reward
comes from merge drops only (`tileUnitsFor` in `smallRewardsWorkflow.js`).
The single-item rank drops it as rank-1 items in `TILE_REWARD_FOCUS_SHARE`
(60%, this app's own number) of its drops. When the picked reward has no
amount or does not drop, the one with the most to give is used and the
results say so (`tileType` / `tileTypeAsked`); every segment uses the base
segment's (`sharedDrops.tileType`).
- COINS ARE THE DEFAULT, and why: with coin values set by the build, coins are
  ELASTIC (`elasticType`): how many coin items drop is free, their value is
  sized afterwards per segment. So rank 6 really is mostly coins, coins fill
  every drop the others leave empty there, and coins are left out of the
  steering. Their tile items are the planned share for every segment alike.
- A reward with a typed target (merge energy, or typed coin values) takes
  only what its target allows of the first rank's drops; the results say so
  when that is under half.
- Consequence: a segment the shared drops pay too little can no longer be
  topped up with other rewards on its last board. It shows as "Can be
  improved" with the factor fix.
- Not asked, decided here: the default is coins, although the economist's
  last words leaned to energy ("energy can be cool"). Both are one click.

**Only Board 2 holds reward items above rank 1.** `rewardRankPattern`
(`rewardPlacement.js`): Board 2 ranks 1 and 2 (a chain: 1, then 2), every
other board rank 1 only; Board 1 still holds none. The rank above 1 is rank 2
(the most Board 2 was ever allowed); rank 3 no longer sits under any tile.
Read literally: Board 3 and later, the last board included, are rank 1 only.
If "from Board 2 on" was meant, it is this one function. At most four reward
items on a board before the last, as before.

**The Twister.** At the single-item rank it is a drop of its own:
`TWISTER_SINGLE_ITEM_SHARE` (25%, this app's own) of that rank's drops. Above
it, it is the extra item in the containers as before (`TWISTER_FILL_MIN_SHARE`,
80%). Its values are sized after the build as before.

**Endless mode**: the single-item rank moves down with the drop start rank
(`buildEndlessDrops` takes `soloRank` and shifts it), so the first rank that
drops stays the single-item one.

**Measured** (single runs; a build has randomness): two segments on
150/700/700 and 150/600/600, drops from rank 6, targets 300 puzzles / 200
energy / 400 charms / 3 coin allowances, a Twister (15 twists, step 10, 70%).
Rank 6: coins rank 1 60%, Twister 25%, the others rank 1 in 15%. Base segment
296 / 199 / 398 / 3.00; Twister typical 18 of 15. The segment with less DR on
its boards merges more and is paid 330 / 240 / 452 by the same drops (factor
fix offered).

**The shared stage on a phone** (`PlayStage.jsx`, `lib/usePhoneScreen.js`,
`index.css`: `.play-phone*`, `.play-touch`). This REPLACES the "Phone/landscape
support" paragraph further down where they differ ("some vertical scrolling
on a short landscape phone is still expected" is no longer true).
- Two layouts, one game, chosen in code (`usePhoneScreen`), because on a
  sideways phone the inventory and controls sit beside the board, not under
  it. The pieces (`boardEl`, `inventoryEl`, `statsEl`, `tiersEl`,
  `generatorEl`, `twisterEl`, `rewardsEl`) are built once and placed by
  either layout. Desktop and upright keep the earlier layout unchanged.
- SIDEWAYS (`(orientation: landscape) and (max-height: 500px)`, the same
  condition the CSS always used): the stage is `position: fixed; inset: 0`
  and nothing scrolls. A 2.5rem bar (rank strip - `RanksBar compact` - and
  round buttons: how to play, restart, full screen where the browser has it);
  the board on the left SIZED FROM THE SCREEN'S HEIGHT (`.play-phone-board`:
  `--rows` / `--cols` set on the element; 3.625rem of chrome plus the safe
  areas; it gives way in width so the side keeps 9.75rem); beside it stats,
  inventory, rewards, `TwisterWidget mini`, `EndlessBanner mini` in a part
  that scrolls on its own, above the multiplier chips and a 3.5rem generator
  button, bottom right. The generator button keeps the accessible name "Use
  generator (xN)".
- UPRIGHT on a touch screen: the usual stacked layout, with the multiplier
  chips and the big generator button moved right under the board
  (`thumbControls`) so playing does not mean scrolling, plus a closable hint to
  turn the phone ("Full screen" where supported, which also asks for
  landscape - Android; Safari on an iPhone has no full screen).
- `viewport-fit=cover` and safe-area paddings (the notch), the
  "add to home screen" metas, no double-tap zoom / tap flash / text selection
  on the play screen. The broken-link notice is now rendered by PlayStage
  (`notice` prop) - outside it, it would sit behind the fixed layer.
- The walkthrough card goes BESIDE its target on a short screen
  (`PlayTutorialCoach`), centred on the height, so it is always whole.
- Not done: touch DRAG (tap, then tap, is how it plays on a phone); a shorter
  link (the link is long because the stage travels in it - no server).
- Not checked on a real phone: only Chromium's phone emulation.
- NOT PUBLISHED. A shared link always opens the deployed site
  (`PRODUCTION_ORIGIN`), so phones only get this layout after a deploy, and
  the economist has not asked for one since the thirty-fifth review.

Verified by sections 4e (every rank single-item) and 4f (rank 6 single-item,
containers above) of `scripts/verify-containers.mjs` (107 checks), section 32
of `scripts/verify-event-build.mjs`,
`scripts/e2e/play-mobile.mjs` (33: four sideways sizes, upright, turning the
phone mid-game, the walkthrough, Recompletion and endless on a phone, a
desktop window) and the updated `twister-easy`, `build-feedback` and
`small-rewards-workflow` browser suites.

### Thirty-seventh review: the item counts are hard rules; the build changes rank values instead

("i dont want those ranks to hold so many resources. only rank10+ should drop
3. we can maybe change the vlaue of a rank if there is a problem to get to the
target. u can also insert it into the simualtor. im ok with him suggesting the
DR values in the ranks, the % of tiles drops distribution, eveyrthing is ok
with me. but we need to try and stay on the rules we give") Where anything
above disagrees, this wins - in particular "a reward that needs more keeps
more drops, and the share is then above the rise" (fourteenth review), the
rise of three-item drops between the two ranks (fourteenth), and "the Twister
item is in 80% of the drops" (twenty-fifth).

**THE ORDER OF THINGS NOW: the drop rules are fixed; amounts are reached by
what is inside the rules.** When a rule and an amount pull apart, the rule
wins and the build moves, in this order: the rank of the dropped items (rank
3 at most), then the reward's RANK VALUES. It never adds an item to a drop.

**How many items a merge drops** (`rewardTargeting.js`, `layout`: `hard`):
- rank 6 (the single-item rank): one;
- between it and the two-item rank (default 8): one or two, two in exactly
  the share the rise gives (rank 7: two thirds) - never three;
- from the two-item rank up to the three-item rank: exactly two;
- from the three-item rank (default 10): exactly three. Never four.
  Three-item drops no longer rise before that rank (`tripleShareAt` is 0 or 1).
The rewards get `cover - twisterShare` of a rank's line and no more: between
"rank-1 items in many drops" and "rank-3 items in few" as far as that takes,
and what even rank-3 items cannot carry is NOT dropped - it is the result's
`shortUnits` (now: what was asked minus what the tables deliver).

**Coins the build values are the filler above the single-item rank**
(`filler` in `buildAlwaysDropConfiguration`; `dropNeedFor` gives them 0). A
drop's two or three places are scarce now, and a coin item is the one item
whose amount does not matter (its value is sized afterwards). So above rank 6
coins ask for nothing: they come from rank 6 and from under the tiles, and
take a place higher up only where the other rewards leave one empty - which
is also what makes the third item at rank 10+ when only two other rewards
drop. (Before this they asked for their planned units at every rank and
pushed the other rewards short.)

**A reward the rules leave short is not asked for more** (`smallRewardsWorkflow`,
the steering; only with a single-item rank). Asking more of drops that cannot
carry it only moved the rewards' shares of each other's places, round after
round: test builds ended 35-50% short of amounts another run of the same
design met. Now every short reward stays short by about the same part and
the rank values make it up.

**The Twister item** takes a reward item's place under these rules, so it is
in a quarter of every rank's drops (`TWISTER_SINGLE_ITEM_SHARE`), plus what
the rewards leave empty - not in 80%. Being few, the items are rank 1 and 2
mixed (1.5 units on average). Two things keep it landing:
- its VALUES are sized on the TYPICAL (median) player, not the average
  (`twisterIncomeNeed(..., { typical: true })`, `row.incomeMedian`). Twister DR
  comes in whole rank-4 collects and a player has one or two when twists are
  counted; sized on the average, the typical player ended a third short (10
  of 15). A segment whose typical player has more whole collects simply gets
  a price that many steps higher;
- when a segment's typical player has NOT finished one collect by then (a
  segment with a lot of subsidy reaches that point after few merges), the
  build makes the Twister items one step bigger and measures again
  (`resizeTwisterDrops`, rank only - no drop gains an item; at most rank 3).
  Found on a test build as "a typical player gets 0 of 15".

**The rank values** (`rewardChain.js`: "RANK VALUES THE BUILD MAY CHANGE";
`smallRewardsWorkflow.js` step 4c). For puzzles, merge energy and charms: when
the simulated payout under the rules ends outside its margin (15%; merge
energy 5%, because the DR taken off the boards follows it), the build changes
that reward's four values by ONE factor so the same drops pay the amount, then
simulates again (twice at most: changing merge energy changes how much is
played; coins are fitted once more after it).
- What the economist typed stays the DEFINITION. A re-valued rank keeps it in
  `typed: { prizeAmount, syntax }`; `withTypedRewardValues` gives the typed
  view. Every build starts from the typed values (`buildSegment`, and the
  workflow for the base segment), so nothing compounds; the definitions
  editors (Build event step 4, the advanced Rewards tab) show and edit the
  typed view; `rewardChainAsBuildInput` hashes the typed view, so applying a
  draft that re-valued something does not make it out of date.
- The re-valued ladders are a RESULT: `sub.rankValues` ({ from, to, factor,
  paidBefore, limited }), `draft.shared.rankValues` / `rewardLadders`, applied
  by `boardsWithDraftApplied` over the typed ladders of every segment. One
  set for all segments, sized on the base segment (a derived segment is given
  them through `sharedDrops.rewardLadders`). Whole numbers; the number in the
  item syntax follows where that is safe (`applyLadderValues`).
- A TARGET SMALLER THAN ONE TOP PRIZE (20 merge energy when rank 4 pays 75)
  is handled before the solve: that reward's values are made smaller so its
  top prize is the amount asked, and every player collects it. With the
  switch off it is reported as before (the "coarse values" cause).
- Bounded: a factor of 0.2 to 5 (this app's own). Beyond that the reward is
  reported as before, with `limited`.
- Step 4 has the switch "The build may change a reward's rank values to reach
  its amount" (`board.rankValuesByBuild`, shared, a build input, on unless
  set false). Off: values stay as typed and the shortfall is reported
  (`few-merges`). Step 6 lists what was changed (`rank-values-note`).
- WATCH: `withBuildRewardValues` restores the typed ladder of THAT reward
  only. A first version restored every reward and so lost the first
  re-valuing when a second reward was re-valued (found on a test build:
  charms recorded as changed, still paid at the typed values).
- Inside the margin nothing is changed: a reward 14% under its amount keeps
  its typed values and is reported as met. That is the 15% margin doing what
  it was set to do.
- Not done: per-segment values for these rewards. A segment the shared drops
  over-pay still shows the factor fix.

**Measured** (three runs of one design; a build has randomness): two segments
on 150/700/700 and 150/600/600, drops from rank 6, a Twister (15 twists, step
10, 70%), targets 300 puzzles / 200 energy / 400 charms / 3 coin allowances.
Every run: rank 6 one item (coins 60%, Twister 25%, the others rank 1 in 15%),
rank 7 two items in two thirds of the drops, ranks 8-9 two, rank 10+ three;
base segment within 5% of every amount; Twister typical 16 of 15 in both
segments. Two runs changed no rank value; one raised puzzles, merge energy
and charms by about a third to two thirds (this design sits right at what
the rules can carry, and the boards are generated differently each time).
The segment with less DR on its boards is still over-paid by the shared
drops (factor fix). About 35 containers.

Verified by section 4f of `scripts/verify-containers.mjs` (110 checks),
section 32 and the reworked sections 7, 21 and 23 of
`scripts/verify-event-build.mjs` (296), and the `build-feedback` (87),
`twister-easy` (46), `build-event`, `build-consistency`, `rc-demand`,
`small-rewards-workflow` and `endless-mode` browser suites. The checks about
how a missed amount is REPORTED now switch "the build may change rank values"
off first (`valuesAsTyped`).

### Thirty-eighth review: an audit - gaps closed, unused code removed

("continue checkign if there are things we need to fix. if there are things
that are not in place. maybe also check for files and code we do not need.")
A scan of the whole `src` tree (every file the app imports from
`main.jsx`, every export and where it is used, every CSS class and keyframe,
every asset, every npm dependency) plus a read of the screens against the
rules of the thirty-sixth and thirty-seventh reviews.

**Gaps closed**
- THE EFFORT DISTRIBUTION TYPED IN STEP 5 SURVIVES A RELOAD (`App.jsx`:
  `EFFORT_TARGET_STORAGE_KEY`, its own storage entry like the build drafts;
  cleared by Clear data). It lived in memory only, so after a reload a build
  protected nothing until it was typed again. This removes that "known limit"
  of the twenty-first review.
- "SHARE STAGE" NEVER CARRIES UNBUILT BOARDS (`handleShare`, `boardIsBuilt`).
  A normal board with tiles and nothing under them: no link, and it says
  why. An unbuilt Recompletion list: left out of the link (the link plays the
  normal event only), and said. Before, such a link played into a
  Recompletion whose tiles never open (thirty-first review).
- THE SYNTAX TAB SAYS WHEN A NEWER BUILD IS WAITING (`pendingBuilds`,
  `syntax-pending-build`): a build in Build event that is not applied is not
  in the sheets. (The economist once saw four containers there while the
  build on screen had thirty.)
- AN ITEM SYNTAX THAT PAYS SEVERAL RESOURCES IS CALLED OUT in step 4
  (`multiResourceSyntaxes`, written in the thirty-fifth review and never
  shown until now).
- STEP 6 SAYS WHAT THE BUILD DID ABOUT THE EFFORT DISTRIBUTION
  (`effort-fit-note`): the layout kept and its rank-12 share against the one
  asked, or that none was typed.
- "TOO LITTLE TWISTER DR" IS ABOUT THE TYPICAL PLAYER (`suggestSpinCost`): it
  was judged on the average, and so could be shown beside "a typical player
  gets 16 of 15" (and set `sizing.short`).
- The Recompletion board list's hint said Board 1 is capped at 150 DR; it is
  300 there (`BoardList` prop `firstBoardCap`).
- Wording brought in line with the rules: three items "only from" the
  three-item rank (review), the Twister item "one of the items in a quarter
  of the drops, never an extra item" (step 4), why Twister items were made
  bigger (review), and stale numbers in `dropGroups.js` comments.
- The one lint warning left in the Merge code (a missing effect dependency
  in `BoardEditor.jsx`) is fixed. `npx oxlint src` is clean outside
  `src/features/chef`.

**Removed (nothing used them)**
- `components/LuckyDropCelebration.jsx` - the eleventh review said it was
  gone; the file was still there, imported by nothing.
- `scaledTwisterLadder` (rewardChain.js), `celebrationDuration`
  (mergeCelebration.js), `TWISTER_DEFAULT_PER_MILLE` (twisterEconomy.js).
- The `riseFromRank` option of `buildAlwaysDropConfiguration` and the
  `riseUsed` result of the workflow (the "tiles first" fallback they served
  was removed in the twentieth review).
- In `SyntaxPage.jsx`: the `recompletionBoards2` prop and the two "... B"
  views nothing could open (the second Recompletion list is long gone). The
  third parameter of the sheet builders in `eventSheets.js` is KEPT, ignored,
  as documented there (an older caller must not break; there is a test).
- NOT removed, on purpose: the every-rank-single-item path of the containers
  (`maxItems: 1` / a single-item rank of 14 in step 4 reaches it), the "first
  two ranks" layout for a list with no single-item rank, and anything under
  `src/features/chef` or `diamondMine`.

**Found clean**: no unused CSS class or keyframe, no asset no code names, no
npm dependency nothing imports (bar the two `@types`).

**Two checks that passed by luck, fixed**: "a segment asking for more coins
has a bigger coin value" (not so when it also collects more coin items), and
a 4 DR tolerance on a fixture whose passes settle within a few DR.

**Files in the project folder that the app does not use** (untracked, so not
deleted without the economist saying so): `_scratch_*` (13 files of old
Diamond Mine and Chef experiments), `Merge image 1.png` / `Merge image 2.png`
(6 MB; the screenshots the first artwork was cut from),
`merge-playtester-assets/` (9 MB; the first asset pack, replaced by v2),
`TODO.txt` (an August note, both items long settled). KEEP:
`merge-playtester-assets-v2/` and `merge-endless-mode-assets/` (the scripts
that prepare the artwork read them), `Merge Out.xlsx` (the syntax reference),
`chef_*.xlsx` (the Chef feature's source data).

**This file is about 420 KB.** It is read in full at the start of every
session, and most of it is history that later sections overrule. A shorter
version - the current rules only, the history moved to a second file - would
be worth doing; it was not done here because it means deciding which of 38
reviews still stand.

Verified by `scripts/e2e/audit-fixes.mjs` (11 checks, new) and a full run of
every engine and browser suite after the removals. (Two browser suites timed
out once while the dev server was reloading after the file changes, and
passed when run again.)

### Three authoritative rules

1. **One Recompletion mode.** A single list of sequential boards per segment
   (`seg.recompletion`). The former second list ("Recompletion B",
   `recompletion2`, the A/B variant picker, the `... B` export tabs,
   `rcVariant`) is gone. An older save's B list is never dropped: if anything
   was built in it, `normalizeSegment` carries it in
   `segment.legacyRecompletionB` (saved, backed up, unused, not exported) and
   the Recompletion tab offers append / use instead / discard. Stage links
   still decode an old `rcVariant` field and ignore it. V2 sheets list
   `Main` and `RC`.
2. **Coins are an allowance worth, not a coin count.** A coin rank's value is
   a multiple of the player's coin allowance (0.12 = 12%), paid with the
   syntax `allowance(coins:0.12)` (`rewardChain.js`: `coinAllowanceSyntax`,
   `parseCoinAllowanceSyntax`, `isLiteralCoinDefinition`,
   `formatRewardAmount`). Coin ranks start blank and the BUILD fills
   them in, per segment (see "Second review" above - this replaced "the app
   does not invent them"); typed values are kept and shared. A saved literal
   definition (`coins:100000`) is kept exactly as saved and flagged, never
   converted. All the economy math is unit-agnostic, so nothing else changed;
   what matters is display: every coin figure is labelled "allowance" and
   formatted with up to three decimals (0.12 must never render as 0.1). Use
   `formatRewardAmount(type, value)` for any reward amount.
3. **Twister is drop-only** (see "Twister widget economy"). It has no target,
   no tile share and no place in this workflow's build beyond being kept in
   the shared drops; setting it up is optional and never blocks a build.

### Budget versus built allocation

`board.blockedValue` is the board's subsidy **budget** - the economist's
input, never changed by a build. `board.effectiveBlockedValue` (null by
default) is the DR the board's main-chain contents are actually **built
for**, when a build allocated something different. Always read the target
through `generationTargetOf(board)` (`board.js`): `placement.js`, the
editor's "Sum vs. target" check and `effortTargeting.js`'s `boardChecks`
all do. `invalidateLayout` clears it; `regenerateBoard` keeps it when
regenerating at the same budget and drops it when the budget differs. This is
what makes the energy credit "applied once": every build starts again from
the untouched budgets.

### The build (`eventBuild.js`)

`buildEvent({ phase, segments })` builds one phase for every segment with a
subsidy budget, base segment first; the base's merge drops are generated and
every other segment is solved against those same drops (shared odds), moving
only its own tile items. A segment with no budget is listed as skipped.

Per segment, `buildSegment` loops (at most `MAX_PASSES` = 4):
1. assume an energy credit (first pass: 0.80 x the energy target);
2. `allocateSubsidy` under `DEDUCTION_POLICY` (below);
3. regenerate every board at its allocation (pins kept) and call
   `generateSmallRewardsConfiguration` on those boards: reward items under
   tiles, drop groups, seeded scoring;
4. read the energy THAT configuration collects; if the credit it implies is
   within `CREDIT_TOLERANCE_DR` (0.5 DR - i.e. the same to the nearest whole
   DR) of the one the boards were built with, stop; else go again with it.
The pass kept is the one whose own simulation agrees best with the credit it
was built with, so the reported energy always belongs to the configuration
returned. It never claims a target or convergence that did not happen.
(An earlier 1%/2 DR tolerance let a build stop on pass 1 with boards a few DR
heavier than its own energy justified - 630 DR generated against a 626.8 DR
unrounded target on a 750 DR budget. Do not loosen it again.)

**Deduction policy (`DEDUCTION_POLICY`, labelled wherever the credit is
shown).** Board 1 is protected: nothing is ever deducted from it (and in a
multi-board list it is capped at 150 DR). The credit comes off the later
boards in proportion to the subsidy each carries after CC, by water-filling:
a board is never taken below `minFeasibleBoardValue` (its pinned ranks at
their own value plus every other tile at the board's lowest allowed rank),
and what it cannot give is re-shared among boards that still have room. A
zero-budget board gives nothing. A design with only Board 1 has nothing to
deduct from. Whatever cannot be deducted is `creditUnabsorbed` and makes the
build **infeasible** with a named cause (`only-board-1`, `negative-subsidy`,
`zero-budget`) - never taken from Board 1, never dropped silently, never by
changing a typed budget. A deducted board is given a whole multiple of its
lowest rank's value so its generator can hit it exactly; that rounding is
returned as `roundingResidual`.

**Reconciliation - exact, never tidied.** Every result carries
`reconciliation`: budget, budget after CC, expected collectible energy,
calculated credit (0.80 x it), unrounded target, main-chain DR actually
generated, and `residual = generated - unrounded target`, with the residual
split into its only three sources (`creditNotDeducted`, `allocationRounding`,
`generation`). The UI shows these to one decimal. Do not show a rounded
figure as if it were exact, and do not hide the residual.

**Residual and convergence are two different things, and the UI labels them
separately.** The half-DR `CREDIT_TOLERANCE_DR` measures STABILITY BETWEEN
PASSES: does the credit the boards were built with still match the credit
their own simulation implies. The residual is a FEASIBLE-ALLOCATION
DIFFERENCE: what the boards can actually be built to hold versus the
unrounded target (a board that may hold nothing below rank 2 can only total
an even number). A build can be fully converged and still show a residual of
a DR or two; never describe one as the other.

Nothing in `eventBuild.js` writes to the project. The result is a **draft**
held in `EditorApp` state (`buildDrafts[phase]`). Apply
(`boardsWithDraftApplied`) writes only the fields a build owns
(`BUILD_OWNED_FIELDS`: tiles, contents, reward items, allocation,
onboarding status) plus the shared drops onto the CURRENT boards - so a spin
cost or a generator setting edited since the build is not clobbered - and
stamps them (below). It keeps a snapshot for Revert. A build that comes back
infeasible does not replace an existing usable draft - it is shown beside it.

**Drafts persist, separately from the applied design.** They are written to
their own storage entry (`DRAFT_STORAGE_KEY`, format `DRAFT_FORMAT_VERSION`)
whenever they change - never into the project save, which only Save writes.
On load a draft is restored marked `restored`; it is never applied by being
restored ("applied" is read off the design's own stamp). If its inputs no
longer match the project it is kept, marked out of date, and says which
inputs differ; an incompatible format is not restored and says so. Backups
do not carry drafts.

### One design status, shared by every tool

Apply stamps every board of the list (`board.buildStamp`: a hash of the
design as built, its parts, the reconciliation, whether it was validated).
`designConsistency(boards)` then answers, for any tool:
`consistent` (exactly what a build applied) · `stale` (built, then changed -
with which parts) · `unaccounted` (never built here but pays merge energy, so
no credit was ever taken) · `manual` (hand-built, no energy income, nothing
to reconcile) · `empty`.

This is what unifies the generation paths. The advanced Rewards tab's own
Generate/Apply intentionally changes rewards only; it does not need to know
about the stamp - its result simply no longer matches it, so the design
becomes **stale** in every tool at once: the Rewards tab shows it with a
direct "Rebuild in Build event", Build event stops calling its draft
applied, and `ExportGate` (`DesignStatus.jsx`) disables every export in the
Syntax tab and in step 5 until the economist ticks a visible
"export anyway" override. Do not add an export path that bypasses
`ExportGate`, and do not present a design as validated unless its stamp says
so.

### Twister reads the configuration you select

The Twister tool has a source selector: the applied design, or the Build
event draft exactly as it would be once applied (its boards with the draft's
shared drops). A proposal does not have to be applied to see its Twister
economy. Analyses and suggestions live in app state keyed by phase +
configuration + segment (`slot`), so switching source or tab never shows one
configuration's numbers against another. An applied spin cost records what
it was derived from (`board.twisterCostBasis`) and the table says whether
that still holds.

### Recovering an older second Recompletion list

`legacyRecompletion.js` + `LegacyRecompletionRecovery.jsx`. The kept list is
inactive (not played, built or exported). Recovery is explicit: pick append /
replace / discard, read a preview (before and after boards with budgets, the
effect on reward settings, what will be trimmed, that a rebuild is needed),
then confirm. Recovered boards keep their budget, rank limits and pins, come
in without generated contents, and adopt the current Recompletion list's
shared reward/generator settings (they are one configuration per list).
Every recovery writes `segment.recompletionRecovery` first, and "Undo this
recovery" restores both lists exactly. Nothing is ever appended
automatically.

### Staleness, not erasure

`buildInputParts` groups a build's inputs as layouts / budgets / targets /
split / definitions (/ the Normal phase, for Recompletion); a draft whose
parts differ from the current ones is **out of date** and the UI names which
parts changed and offers the rebuild. Generated contents and `auto` reward
items/groups are deliberately not inputs, so applying a draft never makes it
look stale. `contentsKey` recognises "the design currently holds exactly this
draft" (Applied). Editing a budget in the workflow keeps the board's contents
(flagged out of date). Editing a board's tiles/size/rank limits clears that
one board's contents - they cannot fit a different layout - and no other
board's (`lib/layoutEdits.js`, shared with the editor's own paint rules).

### Review and causes

The Build step shows requested vs predicted payout, requested vs achieved
tile share, subsidy before and after the credit, per-board budget / built-for
/ placed DR with the applied design alongside, constraint checks, and segment
coverage; details are collapsed. Infeasibility is mapped to a named cause
with a link to the step that fixes it (`CAUSES`): tile capacity, pins that
conflict with the subsidy, too few eligible merges, coarse reward values,
shared odds, missing definitions, a credit larger than the subsidy it comes
off, the onboarding goal, Recompletion never reached.

### Status vocabulary (use these words, nothing else)

Draft / Applied (is the design holding this draft) · Estimated / Simulation
validated (was the independent seeded validation run on this draft) · Out of
date · Needs a fix (shown for the internal `infeasible` status - the word
"Infeasible" itself is no longer shown, see "Second review"). The Play Tester always shows a banner saying whether it is
playing the applied design or a draft (`playOverride`); exports always use
the applied design and the workflow says so when the draft on screen is not
applied.

### Deliberately not done

- The advanced Rewards Generate is not rerouted through `buildSegment`: it
  stays a rewards-only tool, and the design status above is what stops its
  output from passing as finished.
- Drafts are not part of a backup file.
- Twister analyses are kept for the session, not across a reload.

### Verification

`npx vite-node scripts/verify-event-build.mjs` (engine: allocation and its
edge cases, reconciliation, convergence, never-twice, stamps, draft
persistence, apply, recovery planning); `scripts/e2e/build-event.mjs`
(journey 1 from blank layouts to export, journey 2 on an existing design
through rebuild, compare, apply and revert, plus phase switching, segment
scope, invalid input, an infeasible build, save/reload with draft restore,
legacy saves and the previewed Recompletion recovery);
`scripts/e2e/build-consistency.mjs` (Twister on a draft and on the applied
design, an advanced Rewards edit making the design stale, the gated export,
rebuild, and draft restore including mismatched and incompatible drafts).

## Small rewards (V2): reward chains, drop groups, RC phase & the configuration workflow

A second reward economy layered on top of the main value chain: four
resource types (coins / puzzles / merge energy / charms, `rewardChain.js`'s
`REWARD_TYPES`), each a 4-rank merge chain of its own. (A fifth item type,
Twister DR, shares these mechanics but is drop-only and has no target or
source split - see "Twister widget economy" below; it is in
`ALL_REWARD_TYPES`, not `REWARD_TYPES`.) **Encoding decision
that keeps this low-risk**: a reward item is still a single number on the
grid/queue, encoded `>= REWARD_BASE (1000)` so it can never collide with a
main rank — everything that buckets items by raw equality (merge scan,
spawn, queues) works unchanged; only code that must treat rewards
differently calls `isMainItem`/`decodeReward`. **Never pass an encoded
value to `valueOf`** — that's a 2^1000-class number; every DR sum in the
app (`placement.js`, `BoardEditor.jsx`'s stats, `effortTargeting.js`'s
`boardChecks`, `mergeSimulation.js`'s subsidy tallies) guards with
`isMainItem`. Reward items are **never `stuck`** (revealed = immediately
usable), merge pairwise up their own chain, **auto-collect at rank 4**
(`performMerge` credits the prize instead of placing a rank 5), and can be
hand-collected at any rank (`collectReward`/`collectRewardItem` — in the
play UIs: select the reward tile, tap it again).

**The promise this feature exists to keep: the economist enters four
targets and a source split and gets a usable configuration, with no drop
group authored by hand.** Reward *definitions* (item syntax + prize per
rank, seeded from the real Ops reference values) are the only thing the
economist must supply; tile placements, drop groups and drop odds are
generated. If a change ever makes manual drop-group authoring a
prerequisite again, that's a regression of the core requirement, not a
simplification.

### Two sources, ONE inventory

(1) *Under tiles*: reward items in a board's blocked queue
(`board.rewardQueueItems`, `{type, rank}`) or on its semi-blocked tiles
(`board.rewardSemiItems`, `{row, col, type, rank}`). Both are durable
per-board config the way `forcedSemiRanks` is: `generatePlacement`
reserves the tile, and the MAIN items still sum to `blockedValue` exactly
(reward items carry zero main-chain DR). A queue item is revealed when a
merge opens its tile; a semi item is visible and usable from the start.
(2) *From merge drops*: per-resulting-rank weighted tables of drop groups
(`dropGroups.js` — a group is 1–4 resources, at most one item each, dropping
together; plus an explicit no-drop weight), rolled only on MAIN-chain
merges at or above `board.minDropRank` (default 6, the original economist
decision, now configurable, enforced in the engine).

**A merge drop is a real reward ITEM on the board** (`performMerge` spawns
each item of the rolled group on a free cell, or into the inventory when
the board is full; a rank-4 drop collects on the spot). An earlier version
credited drops straight to the collected balance — a stated modeling
shortcut that turned out to be wrong for the economy: tile and drop items
could never combine, so each source had to be rounded into whole rank-4
prizes on its own (a tile-side target under half a prize rounded to zero).
Tile and drop items of the same type+rank now merge with each other, and
payout is computed over the **combined** inventory.

**Source units.** A rank-r item is `2^(r-1)` units (`rewardUnits`); eight
complete one rank-4 collect. `rewardEconomy.js`'s `payoutForUnits` /
`closestUnitsForTarget` turn a target into the whole number of units whose
payout lands closest. No fractional prize ever exists — a payout is always
a sum of real configured prizes. When the ladder can't pay a target
exactly, the workflow reports the closest feasible payout
(`feasibility.status === 'ladder-limited'`) and says so in plain words;
it never pretends.

**Leftover policy — explicit, never assumed** (`board.rewardLeftoverPolicy`,
shared per list, chosen in the workflow card): what unmerged items below
rank 4 pay when a phase ends. `'forfeit'` (default): nothing — payout comes
only in whole rank-4 prizes, and the would-be hand-collect value is
reported (`leftoverForfeited`). `'collect'`: the player hand-collects each
at its own rank's prize, which makes finer targets payable (20 energy =
15 + 5). Applied by `settlePhaseLeftovers` in BOTH engines, at the
main→RC handover and at run end; reward items never carry across a phase.
Which one matches the live game is an open rule — see "Remaining
dependencies" below.

**The simulated player** (the automatic policy every prediction uses, also
described in the UI): free merges first (reward pairs included — "merge
toward rank 4"), collected energy spent on free ×1 taps, and a lower-rank
reward hand-collected **only to free a full board** (`findLowestRewardCell`,
counted as `spaceCollects`) — never otherwise. A heuristic, not a claim of
optimal play.

**Attribution — one method, everywhere** (`creditCollect`): a well-mixed
pool per resource (`state.rewardPool`, in source units). Every reward item
entering play adds its units to its source's side; every collect splits its
prize by the pool's composition at that moment and removes the collected
units pro rata. Tile + drop therefore sum to the total exactly, by
construction — in the simulator, in play sessions, and in the review table.

**Energy.** `collected.energy` is CUMULATIVE payout and is never drawn
down; spending uses the separate `energyBalance` (an earlier version spent
out of `collected.energy`, so "energy collected" after a run was the
unspent remainder — which also understated energy in validation). Energy
funds free ×1 generator taps in every drop mode: the prediction is a real
run, so the feedback loop (energy → taps → merges → drops) is part of what
it measures. The subsidy credit is a separate planning formula, applied
exactly once per phase: `effective = Σ blockedValue×(1+ccPercent) − 0.80 ×
simulated collectible energy` (`computeEffectiveSubsidy`; spec examples
1000,0,100→920 and 1000,0.10,100→1020). Negative is reported, never
clamped. Apply never changes a board's `blockedValue` — Board 1's fixed
150 DR cap (`FIRST_BOARD_SUBSIDY_CAP_DR`, enforced in `BoardEditor.jsx`)
is untouched by generation, Apply, regeneration and CC changes (browser-
verified).

### Drop odds are SHARED across segments

`App.jsx`'s `SYNCED_REWARD_FIELDS` — reward definitions, drop groups, drop
tables, Ops bank/weights, `minDropRank`, leftover policy — sync from
Segment 1 to every segment, per list (main / RC A / RC B each on their
own), exactly like `targetEv`. This is the domain model's own rule
("segments do NOT differ in ... lucky-drop odds/EV") and the only thing the
real Ops schema can express (its Small Rewards / Bank / Weights sheets are
single tables with no segment dimension). Before this, every segment held
an independent copy, so eight independently-solved segments produced eight
drop tables no single shared configuration could represent. Consequences:
- On a non-base segment the shared cards are read-only (`<fieldset
  disabled>` + banner); what stays per-segment is the reward items under
  its own tiles and its targets (base × `segmentFactor`).
- A non-base segment solves with **drops fixed** (`dropsFixed`): only its
  tile items move, making up whatever the shared drops don't deliver. No
  split is shown there. If the shared drops alone exceed its target, that
  is reported as such.
- "Generate for all 8 segments" solves Segment 1 first (it sets the shared
  drops), then every other segment against those drops (`sharedDrops`).
  "Apply to all" is reversible (per-segment snapshot → "Revert apply to
  all").
- **First-load consequence**: any reward configuration that had diverged on
  segments 2–8 is overwritten by Segment 1's, the same informed tradeoff
  the layout sync made.

### Generation (`smallRewardsWorkflow.js`)

1. Unit budget per resource (`closestUnitsForTarget`).
2. Eligible merges for the phase from one deterministic run
   (`mergeCountsMainPhase`/`mergeCountsRcPhase`).
3. Tile share placed as real items (`rewardPlacement.js`): units packed
   into the fewest tiles (rank 3 = 4, rank 2 = 2, rank 1 = 1 — no forced
   pairs), blocked slots earliest-board-first, then eligible semi tiles.
   Units that don't fit move to the drop side and are reported.
4. Drop groups + weights generated for the rest (`rewardTargeting.js`'s
   `buildDropConfiguration`): closed-form sizing (a rank-r item at
   per-merge probability p delivers `M × p × 2^(r-1)` units), ranks raised
   until the odds fit, weights out of 1000, uniform across writable ranks.
   Two candidate structures — `'separate'` (one group per resource) and
   `'bundle'` (one group carrying several, plus top-ups) — and the workflow
   keeps whichever simulates closer (fewer groups on a tie).
5. Every candidate is scored on **the same seeded multi-run simulation the
   Validate button uses** (`validateConfigAcrossRuns`, fixed seed, so
   candidates are compared on identical luck) and refined against the
   simulated error. The review's numbers are simulated outcomes with
   p10–p90, not arithmetic.

Async with a yield after every simulation batch, so progress repaints and
Cancel lands within one batch (the old 1.5s blocking hill-climb is gone).
A staleness key covers every input; a stale proposal can't be applied.

**Kept, never touched by Generate**: a reward item without `auto: true`
(a pin — its units are counted first); a drop group without `auto: true`
(hand-authored, or a generated one the economist locked — contents AND
odds kept); a drop table whose rank is `locked`. Generated items/groups
carry `auto: true` and are *replaced* by the next Generate, which is what
makes re-generating idempotent (an earlier version stacked a second set and
doubled the payout).

**The exact-sum guarantee is verified, not estimated.** Slot-capacity
formulas (`rewardSlotCapacity`, `rewardSemiSlots`) are estimates; after
placing, `proposeRewardPlacements` regenerates each board and compares its
main-chain sum to the same board regenerated with only its pins, taking
proposals back until they're **equal** (equality, not `>=`: too few tiles
can push the generator to a shortfall OR an overshoot when it fills its
last tile at max rank — found live, 34 DR against 8). Board 1's capacity
is sized against what its blocked tiles must carry after its fixed semi
values, not the whole `blockedValue`.

**Semi-tile rules** (`placement.js`): never the two fixed anchor cells;
a cell with an economist-forced main rank keeps it; board 1 offers no semi
tile to the solver while an onboarding goal is set (its semis are the
rank-1 bootstrap the reserve was sized against). `rewardSemiItems` is
deliberately a separate field from `forcedSemiRanks`, which syncs across
segments as layout — reward items must not.

### RC phase

(There is now ONE Recompletion list - see "Build Event workflow" above; the
A/B wording in this subsection is history.) After rank 12 + the whole main
chain cleared, the run hands over to the Recompletion list (ranks 13–14;
rank 14 = second grand prize, once). Both
engines re-read ALL config from the RC board 0 at the transition — EV,
tiers, drop groups, reward chain, minDropRank, leftover policy (the P0 fix:
they used to keep the main phase's forever). Per-phase tallies are
snapshotted (`collectedMainPhase`/`collectedRcPhase` + by-source,
`mergeCounts*Phase`). RC solving scores the full main+RC run's own RC-phase
tallies, never the RC list as a standalone event. Two variants (A =
`recompletion`, B = `recompletion2`) share one `rewardTargets.rc`; **the
app never picks between them** (an Ops decision) — `rcVariant` only selects
which one this session tests/solves/shares.

**Play links carry the variant**: `encodeStage(boards, {rcBoards,
rcVariant})`; a bare array (every pre-RC link) still decodes. Play Stage
shows the RC round, names the variant, and ends at rank 14. Sessions read
every economy setting off the boards themselves (`createPlaySession`
defaults), so a link needs no options. `simulatePlaythrough` defaults
`rewardChainConfig`/`minDropRank`/leftover policy from the board but **not
drop tables** — its default drop mode is stochastic with `Math.random`, and
it sits under deterministic searches (effort targeting, onboarding
feasibility, compare-to-simulator). `dropMode: 'expected'` is the
deterministic schedule (`createDropScheduler`), used for per-board
readouts and the editor's Playthrough simulation.

### Exports and sharing

`V2 Reward Chain` / `V2 Drop Groups` / `V2 Economy` each cover Main / RC A
/ RC B through a leading **List** column, in the per-segment workbook, the
Syntax tabs, and both combined exports (`S{n}`-prefixed). All remain "V2
internal model, NOT a verified Ops sheet".

**Reward keys are unverified.** A reward item in a Blocked Queue cell or a
Board Layouts semi cell is written by its Small Rewards key (`dr-r3`,
`S:coin-r2`) — never the internal encoded number — but that production
expects those keys *there* is confirmed by no Ops reference (the
reference's queues hold bare main ranks only). The Syntax page says so on
those sheets whenever reward items are present, and V2 Reward Chain lists
each key against its configured item syntax so the mapping can be checked.

Google Sheets: `buildSheetsRequests` / `validateSheetsPayload` are pure and
tested offline (titles unique and legal, every cell a plain value, RAW
input); `createGoogleSheet` validates before sending. Only the
authenticated send itself is unverified here.

Share planning carries `rewardTargets`/`segmentFactor`/`sourceAllocation`
(`PlanRewardSummary`). Backup export/import and Clear data cover every
field; the Rewards tab remounts on both (`dataEpoch`) so its typed targets
can't go stale.

### Remaining dependencies (do not silently resolve)

- **Leftover policy** — which behaviour the live game has at phase end is
  not known here. Default is the conservative `'forfeit'`.
- **Production Ops mapping for V2** — sheet contracts for reward chains,
  drop groups and economy settings, and how a reward item is written in a
  queue/layout cell.
- **Shared-odds scope** — implemented as "shared across segments, per
  list". Whether RC A and RC B should also share with each other, or with
  the main phase, hasn't been stated; today they don't.

### Verification

`npx vite-node scripts/verify-v2-rewards.mjs` — engine and solver checks
(encoding, merge/collect, drops as items, pooled attribution, leftover
policy, space management, placement invariants incl. semi tiles and the
exact-sum guarantee, generated drop configuration with locks, the workflow
from definitions alone validated against an independent seeded run, shared
drops, RC, stage links, exports and the offline Sheets payload).

Browser, against the running dev server (Playwright; each run uses a
throwaway profile):
- `npx vite-node scripts/e2e/small-rewards-workflow.mjs` — generate with no
  drop groups, staleness, Apply, the 150 DR cap through Apply / regenerate
  / CC, validation, all segments + revert, shared lock, semi authoring,
  save/reload, backup export, Clear data, import, Share planning.
- `npx vite-node scripts/e2e/small-rewards-play.mjs` — reveal, merge,
  tap-twice collect, rank-4 auto-collect, drops as board items, energy into
  the balance and funding a tap (Play Tester); a shared link through the
  gated transition into the RC variant's own economy (Play Stage).

Fixture gotcha: a board with no open tile can't be played and legitimately
predicts zero payout.

## Twister widget economy

A fifth reward item type, `twister` ("Twister DR", resource `dr-twister`),
whose collected value is a balance the player spends on Twister spins.

**Design direction — this replaced an earlier one, do not drift back.**
An earlier Twister design had a fixed DR requirement drive drop generation.
The current one is the reverse: the economist configures the SHARED Twister
drops, the app measures how much Twister DR each segment actually collects
by a chosen main-chain progression checkpoint, and the balancing lever is the
**segment-specific DR cost per spin**. Twister drop odds are never tuned per
segment to compensate for a price — they are shared like every other drop
odd; segments collect different amounts because their boards, subsidy and
effort differ.

### What Twister is, and the rules that keep it separate

- It uses the small-reward mechanics unchanged: ranks 1–4, two identical
  items merge up, lower ranks hand-collectable, rank 4 auto-collects, never
  `stuck`, a reward-item merge never rolls a drop.
- **It only ever comes from main-chain merge drops.** Never under a starting
  tile, never in a blocked or semi-blocked queue, no tile/drop split, no
  payout target. This is why `TWISTER_TYPE` is NOT in `REWARD_TYPES`
  (`rewardChain.js`): `REWARD_TYPES` means "the four resources that have
  targets, a source split and tile placement"; `ALL_REWARD_TYPES` means
  "everything that can be a reward item" (encoding, tallies, drop groups,
  definitions). Pick the right one; using `REWARD_TYPES` for a tally silently
  drops Twister, using `ALL_REWARD_TYPES` for placement would let it under a
  tile. Enforced in depth: `placement.js` filters with
  `isTilePlaceableRewardType`; `normalizeBoards` runs
  `stripTwisterFromTiles` on load/import; `buildBlockedQueueSheet` /
  `buildBoardLayoutsSheet` skip a Twister entry even in hand-edited data.
- **Three currencies, never added together:** Twister DR, merge energy, and
  main-chain subsidy DR. Twister funds no generator tap and gets no 80%
  energy credit (`computeEffectiveSubsidy` only ever sees
  `collected.energy`). Labels are "Twister DR" vs "Merge Energy".
- **Nothing is invented.** A fresh Twister ladder is blank (no syntax, no
  asset, zero values) — `createRewardChainConfig` seeds the four reference
  ladders and leaves Twister empty; `ensureRewardChainConfig` backfills it on
  an older save without touching any existing value. There is no spin-prize
  table, completion prize, or widget length: a spin has no outcome, and the
  optional `twisterSpinObjective` ("spins that complete the widget") stays
  `null` unless the economist enters a confirmed number. Reaching a target
  spin count never stops Twister drops.

### Where each setting lives

| Setting | Stored | Shared? |
|---|---|---|
| Rank ladder (syntax, asset, DR value) | `board.rewardChainConfig.twister` | across segments, per list (rides in `SYNCED_REWARD_FIELDS`) |
| Drop groups + per-rank weights | `board.dropGroups` / `dropGroupsConfig` | same |
| Widget length (optional) | `board.twisterSpinObjective` | same (it is in `SYNCED_REWARD_FIELDS`) |
| **DR cost per spin** | `board.twisterSpinCost` | **per segment**, per list — deliberately NOT synced |
| Checkpoint %, target spins, overrides, cost step, runs, seed | `segment.twisterPlan.{main,rc}` (only Segment 1's is read) | design metadata, not runtime |

Main and Recompletion each have their own ladder, drops and price — the
Recompletion list does not inherit the main list's. (One Recompletion list:
see "Build Event workflow".) `null` cost means "not set" and no
spin is possible; it is never read as zero or free.

### Ladder validation (applies to all five ladders)

`validateRewardLadder`: rank 4 must be **strictly** greater than 2× rank 3,
4× rank 2 and 8× rank 1, and no intermediate merge may lose value
(rank N+1 ≥ 2× rank N). It only reports — it never changes a value. The
seeded reference ladders for coins, puzzles and charms fail it (energy
passes); that is reported on the Rewards tab and left as entered. A
strictly-proportional ladder (1, 2, 4, 8) fails: rank 4 has to beat cashing
out, not tie it. The simulated player still merges toward rank 4 regardless,
and the UI says that policy is suboptimal for a flagged ladder.

### Drop groups

A group carries at most `MAX_GROUP_ITEMS` (4) items and, being keyed by
resource, at most one Twister item. Five resources are eligible; the cap
stays four until a production schema says otherwise. The simple shared rule
is `applyTwisterDropRule` ("rank-R item on N per mille of eligible merges"):
it writes one single-item group into every eligible unlocked rank table,
taking its weight from that table's no-drop weight so every other group
keeps its odds. That group is **not** `auto`, so the Small Rewards generator
(which replaces `auto` groups) keeps it and sizes the other four resources in
what is left; the generator never creates a Twister group itself. Locked
tables are untouched and reported; a table on another scale is rescaled to
1000 (same odds) and reported.

### The progression checkpoint (`mergeSimulation.js`)

`progress = main-chain DR value in play ÷ value of the phase's goal item`
(`mainChainValueInPlay` / `mainChainProgress`).

- "In play" = every main-chain item not behind a locked tile: free items,
  revealed-but-stuck subsidy (semi tiles once their board is in play, blocked
  items once revealed), and main items in the inventory.
- Merging conserves it (2 × 2^(r-1) = 2^r), so nothing is double-counted; it
  only grows inside a phase; reward and Twister items are excluded; value
  behind a locked tile is excluded. Capped at 1, and exactly 1 once the goal
  rank is held.
- It is not time, board index, merge count or generator spend.
- **RC:** the engine starts RC on a fresh RC board (`buildInitialState(rcBoards[0])`
  — the rank-12 item is not carried), so RC progress is that fresh state
  against the full value of rank 14 (8192), and RC income is counted from RC
  entry (`checkpoint.collectedInPhase`).
- **Ordering, identical in both engines:** observe after the action that
  crosses the threshold and its own automatic effects (reveals, the drop
  landing, a rank-4 auto-collect, a board push), before the next action.
  `simulatePlaythrough` observes at the top of every loop iteration and once
  after the loop, **before** `settleLeftovers()`.
- **An observation only.** Nothing is collected or settled; lower-rank items
  stay on the board and are reported as `twisterUncollected`. A run with and
  without `options.checkpoint` is identical.

### Analysis and price (`twisterEconomy.js`)

`analyzeTwisterIncome` runs seeded stochastic playthroughs per segment and
reports, at the checkpoint: mean / p10 / p50 / p90 of collected Twister DR,
uncollected inventory, raw dropped value, reach rate, and runs that ended
first with their stop reason. **Two series, always both:** `income` is
conditional on reaching the checkpoint; `incomeAllRuns` keeps every run (one
that ended first counts what it had). It also re-runs the same seed with the
Twister items stripped from the drops, so the effect on the other four
resources, player DR spend and effective subsidy is measured, not assumed.
Async and chunked with progress and cancel. A segment whose boards were
never generated is skipped and says so.

Three quantities, labelled distinctly everywhere: **raw item DR value**
(dropped items at their own rank), **collectible DR income** (what the
merge/collect policy actually credits — the one prices are suggested from),
and **DR per spin** (the segment's cost). None is the value of what a spin
awards.

`suggestSpinCost`: indicative = mean ÷ target, then every permitted cost
near it (whole multiples of the cost step, never below one step) is scored
on the simulated players. `available spins = floor(earned ÷ cost)`. Chosen:
median closest to target, then mean, then higher attainment, then lower
cost. "Target attainment" is the share of simulated players holding at least
the target — matching the average does not guarantee it, and the UI says so.

**Income is lumpy and that is real, not a bug:** under the simulated policy
Twister DR arrives in rank-4 collects, so with a low drop rate the median
player can hold zero at an early checkpoint while several DR sit in unmerged
items. The details panel flags it. Do not "fix" it by collecting early at
the checkpoint.

Staleness: `twisterAnalysisKey` covers boards, definitions, drops,
checkpoint, runs and seed — and deliberately NOT the cost per spin (a price
never invalidates measured income; predicted spins recompute live from the
stored samples). A suggestion additionally depends on the target and cost
step. Analysis and suggestion never write anything; only Apply does, and
Revert restores the costs from before the last apply.

### Play (`playSession.js`, `TwisterWidget.jsx`)

`collected.twister` is cumulative earned and never decreases;
`twisterBalance = earned − twisterSpent`. `spinTwister` deducts the exact
cost once and counts one spin. On RC entry the session re-reads the RC
list's own cost/objective; the balance and spin count simply continue —
**no reset or carry-over rule is configured or confirmed, so none is
applied.** The widget is labelled "economy preview" and appears only when a
stage has Twister at all (`sessionHasTwister`). Stage links need nothing new:
the cost, objective, ladder and drops travel on the boards.

### Exports

Shared definitions and segment prices are separate: the Twister ladder is in
`V2 Reward Chain`, its drops in `V2 Drop Groups` (a `Twister DR rank`
column), and `V2 Twister` carries only what is not shared — sections
`Runtime - segment-specific` (cost per spin per list), `Runtime - shared`
(widget length) and `Design metadata - not runtime` (checkpoint, target,
step, runs, seed). The combined exports have one `V2 Twister` tab with a
Segment column. All unverified: no production contract for Twister exists
here. The legacy "Small Rewards" key sheet is unchanged (four resources).

### Non-destructive migration of per-segment reward config

Reward config syncs from Segment 1, which overwrites whatever segments 2–8
held. `preserveDivergentRewardConfig` (App.jsx, run at load/import before the
sync) copies any *authored* divergent config into that segment's
`legacyRewardConfig[listKey]`; it is saved, exported in backups, shown as a
notice on the Rewards tab, and stays until discarded.

### Remaining dependencies (do not silently resolve)

- **Spin outcomes** — no prize table, so spin prizes feeding resources back
  into Merge are excluded from every analysis.
- **Widget length / completion** — unconfirmed; results are "spins
  available", not "widget completion", unless `twisterSpinObjective` is set.
- **Balance at the main→RC boundary** — carry-over vs reset is unknown.
- **Supported price increments** — an input (default 1), not a known rule.
- **Twister item syntax, asset IDs and the `dr-twister-r{n}` key** — entered
  by the economist / this app's own pattern; unverified.

### Verification

`npx vite-node scripts/verify-twister.mjs` — 147 engine and analysis checks.
Browser (dev server running): `scripts/e2e/twister-workflow.mjs` (configure,
checkpoint, analyze, suggest, apply/override/revert, RC phase, staleness,
save/reload, exports, share planning, backup/clear/import, legacy saves) and
`scripts/e2e/twister-play.mjs` (drops landing, merging, collecting, spins,
earned-vs-balance, RC transition, artwork on tiles).

## Supplied artwork

The play surfaces use the economist's own asset pack: the project's
`merge-playtester-assets/` folder (individual transparent PNGs made with an
image generator, plus its own README and manifest). The sprites the app uses
are COPIED to `src/features/merge/assets/game/`, keeping the pack's folders
and file names; the pack folder itself is the source and is not imported.
The pack in use is **`merge-playtester-assets-v2/`** (new rank 13 and 14, and
gold lamp-token Twister sprites in place of the earlier tornado concepts);
`merge-playtester-assets/` is the first version and is no longer read.
This replaced an earlier set of crops cut from two reference screenshots (the
`assets/art/` folder and the `scripts/art/` crop tooling are gone; "Merge
image 1/2.png" in the project root are no longer used by anything).

`lib/artAssets.js` is the one mapping from game concept to art;
`lib/playTileSurface.js` + `components/PlayTile.jsx` draw a board cell and
are shared by Play Tester and Play Stage so the two cannot drift;
`components/GameArt.jsx` is a standalone icon.

- **What maps to what:** main ranks 1-14 -> `main/main-rank-01..14.png`, in
  the pack's own order (seed first, regal rose tree last); the five reward
  types ranks 1-4 -> `rewards/<folder>/...`, where the pack's folder names
  are singular pictures (coin, puzzle, charm) and the app's keys are plural
  (coins, puzzles, charms) - `REWARD_FOLDER` writes that mapping out; tiles,
  blocked cover, semi-blocked overlay, selection brackets and the generator
  button -> `ui/`. The pack's leaf, trowel, blank collect button, blank popup
  panel and board frame are not used (and are not copied).
- **A cell is drawn in layers**, each its own image, nothing baked together:
  the tile (the cell's background; a blocked cell adds the leaf cover over
  it), the item's sprite (its full transparent canvas, `object-contain`, with
  a margin), the leaf overlay over a semi-blocked item (slid down and clipped
  so it covers about the bottom third), then the HTML badges and the
  selection brackets.
- **Proportions are kept.** The pack's individual sprites were normalized
  (every item scaled to fill the same 224px box), so a single seed came out
  as large as the rose tree ("the rank1 is too big. we need to keep the
  proportions"). `scripts/measure-art-proportions.mjs` measures how big each
  item was really drawn on the pack's original sheets and writes
  `assets/game/scale.json` (a fraction of the largest item on its sheet:
  rank 1 is 0.49, rank 14 is 1); board tiles and inventory chips draw each
  sprite at that fraction. Rerun the script if the pack changes. Standalone
  icons (`GameArt`) are not scaled - at 20-40px a half-size icon is unreadable.
  `scripts/e2e/art-gallery.mjs` puts every item on one board for a look.
- **Every amount and rank is HTML, never part of a picture.** Every item keeps
  its rank badge, and tile titles double as `aria-label`s (the browser tests
  locate tiles by them). The size of a coin pile says nothing about payout.
- **A second look, endless mode** (the `merge-endless-mode-assets/` pack,
  copied trimmed to `assets/game/endless/`): see the tenth review. It changes
  the board's furniture only; `artAssets.js` takes a `theme`.
- **It is prototype concept art, not studio artwork** - every asset carries
  `kind: 'concept-art'`. Do not describe it as official.
- **A missing sprite falls back** to the rank number on its colour (a swirl
  badge for Twister), which cannot pass for a real picture.

## Editor header

Three rows — title + project actions, the tool tabs, the segment switcher —
and every label is `whitespace-nowrap`. The tabs used to share the first row;
adding an eighth (Twister) ran it out of width and the title, tab labels and
buttons each wrapped onto several lines. A row that is short of room now
wraps whole items instead. `scripts/e2e/header-layout.mjs` checks this at
five window widths. Adding a ninth tab needs no layout change.

## Player mode (Play Stage) & hosting

`src/features/merge/components/PlayStage.jsx` is a second, player-facing consumer of the
same session engine (`playSession.js`) the economist's Play Tester uses —
same board-chaining/lucky-drop/tier mechanics, same tap-to-select-then-tap-
target and native-drag interaction model, but with every economist-only tool
stripped out (no compare-to-simulator, no raw event log) and a completion
banner at `MAX_RANK`. It always starts at `boards[0]` — a "stage" is the
whole board-chain sequence, not a single board a player picks.

**Routing.** `App.jsx`'s top-level `App` checks
`new URLSearchParams(window.location.search).has('play')` *before* deciding
which of two otherwise-independent components to render: `PlayApp` (bare
shell + `PlayStage`, no header/tabs/editor at all) or `EditorApp` (the
existing economist tool, unchanged apart from a new "Share stage" button).
This is a hard branch, not a mode toggle inside one component tree — a
shared `?play` link must never expose the editor/CC-management/syntax
tooling, even by a stray click.

**Sharing a designed stage.** `src/features/merge/lib/stageShare.js`'s `encodeStage`/
`decodeStage` pack a board list into a URL-safe string carried in the
`stage` query param — deliberately *not* `localStorage`, since that's
per-browser and would never reach anyone else's device. The header's
"Share stage" button (`EditorApp`'s `handleShare`) copies a full
`?play&stage=...` link for the economist's *current* board list to the
clipboard. `decodeStage` returns `null` on anything malformed rather than
throwing; `PlayApp` distinguishes *why* it's null — see "The URL-length
ceiling" below, this used to just silently fall back to the demo stage and
that silence is exactly what made the underlying bug hard to diagnose from
a bug report alone.

**The URL-length ceiling — found live, from a real "sharing is failing for
the other user" bug report.** The stage payload is JSON.stringify'd,
gzipped via `fflate` (`gzipSync`/`gunzipSync` in `stageShare.js`), then
base64url-encoded — in that order; gzip has to run on the raw JSON text,
not on already-base64'd text, or it gets almost none of the win. This isn't
an aesthetic choice: the *first* version of this feature (plain base64 JSON,
no compression) worked fine for the tiny 2-board demo stage but was
confirmed, via live testing against the deployed site with boards generated
through the app's own real pipeline, to fail hard at **~9-10 boards of
modest size (5×8, a handful of blocked/semi tiles) — right around an
8-8.5KB full URL length**. Every failure at and above that length was an
HTTP **414 "URI Too Long"** from GitHub Pages' own Fastly CDN, a
server-side rejection that happens *before the app's JS ever runs* — no
client-side error handling could have caught it, and it has nothing to do
with `decodeStage` or browser URL limits (modern browsers handle far longer
URLs fine; this is Fastly specifically, and lines up with the classic 8KB
request-line default a lot of reverse proxies share). Gzip buys real
headroom against this because board JSON is extremely repetitive (the same
tile-state strings and field names over and over) — in testing, a 150-board
stress-test stage compressed to a ~6.4KB URL, comfortably under the ~8KB
wall, versus the ~9-10 *board* ceiling before compression. It does not
remove the ceiling, just raises it a lot; `MAX_SAFE_STAGE_CHARS` (currently
6000, checked in `handleShare` against the *actual* encoded URL length) is
a conservative warning threshold for economists building something big
enough to be at risk again — it still copies the link either way (their
call), it just flags it. If this formula or the compression approach ever
changes, re-verify against a live deploy, the same way this was found —
measuring against a local dev server won't reproduce a CDN-level 414 at
all.

fflate (a small bundled dependency) over the browser's native
`CompressionStream`, deliberately: `CompressionStream`/`DecompressionStream`
only reached Safari in 16.4 (March 2023), and this feature is explicitly
meant to be played on a phone (see "Phone/landscape support" below) — a
sender on a modern desktop browser successfully compressing a link that
then fails to *decompress* on an older-iOS recipient would just be a
sneakier version of the same "share is broken for the other person" bug.
fflate's sync API behaves identically on every browser regardless of native
API support, at the cost of the dependency's size in the bundle.

**A broken link now says so.** `PlayApp` tracks a `linkBroken` flag
separately from "no `stage` param at all" (a bare `?play` link, which
legitimately means "show the demo") — a `stage` param that's *present* but
fails to decode (truncated by a chat app, corrupted by copy-paste, or was
generated before this fix and is now too long to have ever worked) shows an
explicit "this share link looks broken" banner alongside the demo stage
fallback, rather than silently substituting the demo with no indication
anything went wrong. That silence was a real contributor to why the
original bug report was hard to act on — the recipient had no way to tell
"working as intended, just not what was shared" from "something is
actually broken."

**"Share stage" always targets the real deployed site, never
`window.location.href`.** `EditorApp`'s `handleShare` (`App.jsx`) builds its
link against a hardcoded `PRODUCTION_ORIGIN` (`https://idoggk.github.io/Merge/`)
regardless of what host the economist is actually viewing the app from —
found live, from a second real bug report the same night this feature
shipped: this app is naturally designed/tinkered with via `npm run dev`
(`localhost:5173` or similar), and the *previous* version of `handleShare`
built the link from `window.location.href`, so clicking "Share stage" while
on localhost silently copied a `localhost:...` URL. That link looks
completely ordinary to whoever copied it - it's still just a URL, it still
copies fine - but "localhost" means "whichever machine opens this," not
"the sender's machine," so it can never work for literally anyone else,
on any network, with or without corporate firewalls involved. The stage
payload is fully self-contained in the URL regardless of origin (see
above), so hardcoding the production host to always be the sharing target
costs nothing and closes off this entire class of "works for me, not for
them" report for good. If the production URL ever changes (custom domain,
repo rename - see "Hosting" below), this constant has to move with it.

**First-time-play tutorial.** `src/features/merge/components/PlayTutorialCoach.jsx` +
`src/features/merge/lib/playTutorial.js` are a PlayStage-only coach-mark walkthrough — three
steps (`'generate'` → `'merge'` → `'blocked'`), each dimming the whole
screen except one or two real DOM elements (found live via
`document.querySelector` on `data-tutorial="generate-button"` or
`data-cell="{row}-{col}"` attributes, not refs) with a callout and a
bouncing arrow pointing at them. Deliberately named around "tutorial," not
"onboarding" — `board.onboardingDrBudget`/`onboardingTargetRank` (see
`GoalSolver.jsx`) is a completely unrelated, pre-existing domain concept
(the economist's Board-1 DR/rank goal), and sharing that word across two
unrelated features would be a genuinely confusing name collision, not just
a style nit.
- Steps auto-advance on the real action they're teaching: `'generate'` →
  `'merge'` the moment `spendGenerator` runs once; `'merge'` → `'blocked'`
  (or straight to done, if the board has no locked cells at all) the moment
  a real merge event fires. `'blocked'` doesn't auto-advance — reveal timing
  is stochastic/positional, so it just waits for an explicit "Got it!".
  `computeTutorialSpec` (the only place that decides what to point at)
  recomputes fresh from `session.state` every render, so if the pointed-at
  board configuration changes out from under a step (e.g. the one locked
  cell it was showing got revealed by that same merge), it naturally
  degrades to "nothing to show" - a `useEffect` watching for that
  (`tutorialStep && !tutorialSpec`) finishes the tutorial from there, never
  mid-render (calling the finish/setState mid-JSX was tried first and is
  exactly the kind of "works until it doesn't" React anti-pattern this
  avoids).
- The dimming is **four separate absolutely-positioned panels** (top/
  bottom/left/right of the spotlight rect), not a `box-shadow: 0 0 0 9999px`
  cutout - a box-shadow can fake the *visual* hole but does nothing for
  hit-testing, and there's no single-element CSS trick that both dims
  everywhere except a rect AND lets clicks through only inside that rect.
  The outer `fixed inset-0` wrapper is `pointer-events-none` for the same
  reason from the other direction: a parent's own box still participates in
  hit-testing wherever none of its children cover that point, so without
  this the wrapper silently ate every click over the "hole" even though
  nothing was visually there to block it - found live, the hard way, via a
  Playwright click that timed out with "intercepts pointer events" pointing
  at the wrapper itself. Only the four panels and the tooltip card opt back
  in with `pointer-events-auto`.
- The bouncing arrow is rendered **after** the tooltip in DOM order (so it
  always paints on top if they ever get close enough to overlap), and `GAP`
  between the spotlight and the tooltip is sized to the arrow's own height
  plus margin, not a smaller arbitrary number - an earlier version let the
  tooltip's card cover the lower half of the arrow whenever the target sat
  near the top of the viewport, since a later sibling always wins the paint
  order at the same screen position regardless of z-index.
- If the target starts below the fold (a real, common case on the short
  landscape-phone viewports this whole app already accounts for - see
  "Phone/landscape support" below), the coach `scrollIntoView({block:
  'center'})`s it **once** per step activation, not on every 250ms
  re-measure - repeating it would fight the player's own scrolling.
- Shown once ever per browser (`localStorage` key
  `merge-mania-play-tutorial-seen`, `hasSeenPlayTutorial`/
  `markPlayTutorialSeen`), replayable any time via PlayStage's own "How to
  play" header button, dismissible early via "Skip tutorial" on every step -
  both paths call the same `finishTutorial` (mark seen + clear the step).

**Default stage.** `src/features/merge/data/defaultStage.js`'s `createDefaultStage()`
returns a real, valid 2-board demo (generated once via the app's own
`placeItems` pipeline, then frozen as data — exact-sum verified against
each board's `blockedValue`) with fresh `crypto.randomUUID()`s minted per
call. It exists purely so a fresh `?play` link (no `stage` param) shows
something designed instead of an empty board — don't hand-edit its numbers
without re-running them through `placeItems` first, for the same reason
board data elsewhere in the app is never hand-fabricated.

**Phone/landscape support.** `PlayStage` is meant to be played on a phone
held sideways, where width is plentiful but height is the scarce resource —
the rest of the app is a desktop design tool and doesn't have this problem.
Two independent mechanisms, both intentional:
- The board grid uses `minmax(0, 1fr)` columns (not a fixed rem size), and
  the board/panel row uses Tailwind's `landscape:flex-row` *and*
  `sm:flex-row` together (not chained) so side-by-side layout triggers on
  either signal — landscape orientation regardless of width (covers narrow
  phones like an iPhone SE at 568×320, which is landscape but under the
  `sm` breakpoint), or plain desktop width regardless of orientation. Don't
  collapse these back into a single `sm:` breakpoint — that regressed the
  narrow-landscape case badly in testing (roughly 2x the vertical scroll
  needed) before this fix.
- `src/index.css`'s `.play-compact-py`/`.play-compact-gap`/
  `.play-hide-compact` are scoped to
  `@media (orientation: landscape) and (max-height: 500px)` specifically —
  height-gated, not just orientation-gated, so a maximized desktop browser
  window (also "landscape" but never short) doesn't get squeezed. Some
  vertical scrolling on a short landscape phone is still expected and fine
  (normal web page behavior); the goal of both mechanisms above is zero
  *horizontal* overflow/scroll, which breaks touch panning, not zero
  scrolling altogether.

Native HTML5 drag-and-drop (`draggable`/`onDragStart`/etc., shared with
Play Tester) doesn't fire on touch devices — this is a browser limitation,
not a bug here. Play already works on touch regardless, because the tap-
to-select-then-tap-target path (`handleCellClick`'s `selected` state) is
wired unconditionally, independent of drag; PlayStage's own hint text says
"drag, or tap" for exactly this reason. Don't try to add a touch-specific
drag polyfill without confirming tap-based play actually has a real
problem first.

**"Share planning" — a read-only review link, the counterpart to "Share
stage" for coworkers rather than players.** By explicit economist request
("I want to just have a readonly option to send to co workers to see the
full simulator"), scoped via three clarifying questions before building
(content scope, delivery mechanism, segment/list scope). The economist
chose: everything the Editor tab shows (not just a leaner
simulation-results-only view), the same URL-link mechanism "Share stage"
already uses (not a downloaded file), and every segment's own main list in
one link (not just the active segment, and not Recompletion).

**Mechanism: `src/features/merge/lib/planShare.js`'s `encodePlan`/
`decodePlan`, sharing the exact gzip+base64url codec `stageShare.js`
already used** — the shared plumbing was factored out into
`src/features/merge/lib/urlCodec.js`'s `encodeToUrlParam`/
`decodeFromUrlParam` (stage sharing re-verified byte-for-byte unchanged
after this refactor), rather than copy-pasting a second gzip/base64
implementation for a second payload shape. `encodePlan` takes
`segments.map((seg) => ({ name, boards: seg.main.boards, targetSubsidy:
seg.main.targetSubsidy, eventStartDate, eventDurationDays }))` — every
segment's own MAIN list only, matching "Share stage"'s existing scope
exactly (Recompletion boards were never asked to be shareable either way,
and presets are a local iteration aid with nothing to show a reviewer, so
neither travels in the link). `MAX_SAFE_PLAN_CHARS` (4000, lower than
`MAX_SAFE_STAGE_CHARS`'s 6000) is a more conservative warning threshold for
exactly the reason a plan is expected to run bigger on average than a
single shared stage — it carries every segment's own board list at once,
not one — still just a warning (the economist's own call whether to send it
anyway), never a hard block, same as stage sharing.

**Routing: a hard component-level separation, the same reasoning `PlayApp`
already established — not a mode flag inside `EditorApp`.** `App()`'s
top-level routing checks `?plan=<encoded>` alongside the existing `?play`
check (`isPlanLink`, checked via the same `URLSearchParams` already read for
`isPlayLink`) and renders `PlanApp` instead of ever reaching `HeroPage`/
`EditorApp` — a link meant for someone outside this editing session must
never expose editing affordances, even inert ones, by some missed branch.
Unlike `PlayApp`'s bare `?play` link (which falls back to a baked-in demo
stage when no `stage` param is present), there is no sensible "default plan"
to fall back to — a plan link only ever exists because someone explicitly
shared one — so `PlanApp` shows its own explicit message for each of the two
failure shapes: no `plan` param at all ("No shared plan was found in this
link") vs. a `plan` param present but corrupted/truncated ("This planning
link looks broken..."), the same "don't silently substitute something that
looks like it worked" principle `PlayApp`'s own `linkBroken` flag already
established for stage links.

**`PlanSegmentView` reuses the real `useBoardListState` hook + the real
`BoardList`/`BoardEditor` components — not a parallel, hand-maintained
read-only renderer.** This was the key design decision that kept this
feature's implementation small: rather than building a second component
tree that could drift out of sync with what the live Editor actually looks
like, `PlanApp` calls `useBoardListState({ boards: segment.boards, presets:
[], targetSubsidy: segment.targetSubsidy })` per segment (remounted via
`key={activeSegmentIndex}` so switching segments always starts back at
board 0) and passes the exact same `BoardList`/`BoardEditor` props
`EditorApp`'s own `mode === 'editor'` branch does — just with a new
`readOnly` prop threaded through on both components. Every card a reviewer
sees is the genuine component rendering genuine (decoded) data, not a
summary or a reconstruction. `onUpdateEventStartDate`/
`onUpdateEventDurationDays` are real no-op functions, not omitted — the
Event Schedule card's own JSX is gated on `onUpdateEventStartDate` being
truthy at all (a pre-existing pattern, see "Persistence" below), and
"everything in the Editor tab, read-only" means that card should still
render (just disabled), not disappear by omission the way Effort
target/Suggestions deliberately do (see below). `allSegments`/
`onSavePreset`/`onDeletePreset` are safely omitted — every real caller of
those already guards on them being truthy before use, so leaving them
`undefined` here costs nothing and avoids wiring up Effort-target's
cross-segment machinery for a tool this view doesn't expose anyway.

**What `readOnly` actually disables vs. hides vs. leaves alone, in
`BoardEditor.jsx`/`BoardList.jsx`/`GoalSolver.jsx` — three different
treatments for three different kinds of control, not one blanket
lockdown:**
- **Disabled, but still visible with its real value** (the "see the actual
  configured numbers, just can't touch them" case — the bulk of the
  feature): Rows/Columns, the board grid's paint/fill-all toolbar (`onPaint`/
  `onFillAll` passed as `undefined`, the same existing mechanism
  `layoutLocked` already used — see "Board layout & rank rewards sync from
  Segment 1" above), Number of boards, Total subsidy's demand field and
  every per-board DR input, Event schedule's two fields, Generator tiers'
  two fields, Lucky drops' target-EV field, the Blocked Queue's reorder
  arrows, Rank rewards' toggle buttons and reward-syntax inputs, the
  onboarding goal's two fields (`GoalSolver.jsx`, now also takes `readOnly`),
  and the RC-event toggle (moot in practice here since `PlanApp` never
  renders Recompletion, but added for correctness anyway). A new `locked =
  layoutLocked || readOnly` combines this with the pre-existing
  Segment-1-sync lock wherever both reasons drive the exact same disabling —
  the two never actually coexist (`EditorApp` never passes `readOnly`,
  `PlanApp` never passes `layoutLocked`), they just share the mechanism; a
  sibling "Read-only shared plan — editing is disabled" banner/hint renders
  next to (never instead of) the existing "Synced from Segment 1" one, since
  the two messages would be actively wrong for each other's case.
- **Hidden entirely**: the "Effort target" and "Suggestions" cards. Both are
  iteration tools whose own primary action (Apply a suggestion, save/apply a
  preset) mutates board values — not relevant to a reviewer, and not a
  message "disabled" can honestly convey when the card's whole point is
  "change something." Placement's "Generate items"/"Generate items for all N
  boards" buttons (and the Noise slider that only ever fed them) are hidden
  the same way, for the same reason — regenerating would silently throw away
  the actual shared layout and compute a new random one, exactly backwards
  from "see what I built."
- **Left fully interactive, on purpose**: "Run simulation" (Playthrough
  simulation / `SimulationReport`) and "Run lucky-drop simulation" — both
  are pure, local computations that read the (frozen, decoded-from-the-link)
  board data and only ever write to this component's own local display
  state, never back into anything shared. Running them on demand is the
  entire point of "see the full simulator," not something to lock down.
  `SimulationReport`'s own "DR budget" input is the same kind of harmless
  local parameter and was left alone for the identical reason.

Verified live end-to-end (not just built): set a 500 DR "Total demand" on a
fresh segment 1, clicked "Share planning," copied the resulting link
(828 characters — comfortably under `MAX_SAFE_PLAN_CHARS`), and opened it as
a separate browser context (standing in for a coworker's own browser, no
shared `localStorage`). The shared page showed the "Read-only" badge, all 8
segments' own tabs, segment 1's demand field reading `500` (disabled) with
"Subsidy needed (2048 − 500 demand): 1548 DR" computed correctly, zero
"Generate items" buttons, zero "Effort target"/"Suggestions" cards anywhere
on the page, and segment 2's own demand field independently empty
(confirming per-segment data isolation survived the round trip). Clicking
"Run" on the Playthrough simulation card worked exactly as it does in the
live editor — reached rank 12 at 1866 DR, every per-rank row populated, and
`EffortDistributionChart` filled in with the same run's data — while every
input on the page stayed genuinely disabled throughout (checked via
`isDisabled()`, not just visually). Separately confirmed both failure
messages render correctly and distinctly: a bare `?plan=` (empty) shows "No
shared plan was found in this link," while a corrupted `?plan=garbage...`
shows "This planning link looks broken...".

**Hosting.** The app is deployed to GitHub Pages from `idoggk/Merge`
(confirmed public) at `https://idoggk.github.io/Merge/`, via the classic
`gh-pages` npm package (`npm run deploy` = `vite build` + `gh-pages -d
dist`) rather than the GitHub-Actions-based Pages flow — chosen specifically
because this environment has no `gh` CLI/API access to toggle Pages
settings or verify an Actions-based deploy, and the classic branch-push
method auto-enables Pages on first push. It pushes only to a separate
`gh-pages` branch and never touches `master`'s history — treat that branch
as a build artifact, not something to hand-edit or merge from.
`vite.config.js`'s `base: '/Merge/'` is load-bearing for this — it must
match the repo name exactly, or every asset URL breaks under the Pages
subpath. If the repo is ever renamed or the site moves to a custom domain,
that `base` (and this note) needs to change together.

## Hero page & multi-feature routing

The app is no longer single-purpose. `App.jsx`'s top-level `App` now holds a
`feature` state (`null` = show `HeroPage`); a bare load (no `?play`) always
lands on `HeroPage` first, where the economist picks "Merge Mania" or
"Diamond Mine" — each renders its own top-level component (`EditorApp` /
`DiamondMineApp`) with its own header, tabs, and state, and a "← Features"
button (`onHome` prop) that resets `feature` back to `null`. This choice is
**deliberately not persisted** — every fresh load shows the hero page, matching
"a hero page at the start" literally; getting back into a feature is one
click. `?play` links are unaffected — that branch is checked first and still
renders the stripped-down `PlayApp` regardless of `feature` state, since a
shared player link should never show the hero page at all.

## Diamond Mine

A second feature alongside Merge: a reveal-the-tiles board game (gems hidden
under a grid; a tile needs one click to reveal, or two — a "double-tap" — if
it's marked blocked; the board is won once every gem tile is found). **For
now this is builder tooling only** — there is no player-facing Diamond Mine
simulator, matching Merge's own "Implementation status" framing at the top
of this file. What exists: a gem library, a board builder (place/rotate
gems, paint blocked tiles), live stats (min-clicks-to-clear, a heuristic
difficulty score), a difficulty-targeted board generator, and a placeholder
syntax export — no player mode, no waves/chaining, no lucky drops, no
generator-effort economy. Don't assume any of Merge's domain rules
(value-chain ranks, subsidy, tiers, EV) apply here; Diamond Mine is a wholly
separate domain that happens to share this app's UI conventions.

**Gems.** A gem (`src/features/diamondMine/lib/gem.js`) is a plain filled rectangle of a fixed
`{rows, cols}` footprint — not an arbitrary polyomino. `DEFAULT_GEMS` seeds
13 gem types (named `"a"`.."`m"`) from the economist's reference sheet;
`GEM_COLOR_RAMP` is a placeholder color per gem, explicitly standing in for
real gem art the same way `boardSyntax.js` is an explicit placeholder for the
real Ops syntax — swap it out once real icons exist. Two gems can share an
identical footprint after rotation (e.g. `b`=1×2 and `c`=2×1) without being
duplicates — they're genuinely distinct gem types with their own art/color,
not the same gem twice. Rotating a gem just swaps its rows/cols
(`footprint(gem, rotated)`); `footprintCells(placement, gem)` is the single
place that turns a placement into the list of board cells it covers —
`diamondBoard.js`'s overlap checks and `diamondStats.js`'s click-counting
both import it rather than recomputing coverage their own way, so the two can
never disagree about what a placement occupies.

Once a gem has ≥1 placement on *any* board, `isGemLocked` makes its
dimensions read-only in `GemLibrary` (name/color stay editable) — editing a
placed gem's size out from under boards that already used it would silently
invalidate their layouts. "Duplicate as new gem" is the escape hatch.
Deleting a gem cascades: `removeGemEverywhere` strips every placement of it
from every board, no confirmation dialog, matching this app's existing
no-confirm delete conventions elsewhere (e.g. `BoardList`'s remove button).

**Boards.** A Diamond Mine board (`src/features/diamondMine/lib/diamondBoard.js`) is
`{ rows, cols, blocked: rows×cols boolean[][], placements: [{ gemId,
anchorRow, anchorCol, rotated }] }` — `blocked` and gem coverage are
independent properties of a tile; a blocked tile can sit under a gem (costs
2 clicks to reveal that cell) or in open space (just visually distinct, free
to ignore). `canPlaceGem` is a pure dry-run bounds+overlap check shared by
the real placement action and the board grid's hover ghost-preview, so
"would this fit" and "does this fit" can never diverge. Resizing a board
(`resizeDiamondBoard`) drops — never clips — any placement that no longer
fully fits, and reports how many so the UI can surface "N gems removed by
resize"; a clipped gem would represent a shape that doesn't match any real
gem, which is worse than removing it.

**A board can never carry two placements of the same gem type**, by
explicit economist request. `canPlaceGem`'s own `isGemAlreadyOnBoard` check
(`diamondBoard.js`) rejects a placement outright the moment that `gemId`
already has a placement anywhere on this specific board — rotation doesn't
exempt it, it's still the same gem identity. This lives in `canPlaceGem`
itself (the same function the real placement action and the grid's hover
ghost-preview both already went through), not a separate check bolted on
top, so a gem that's already placed shows red on hover like any other
invalid spot. `MineBoardEditor.jsx`'s gem palette additionally disables
that gem's button outright (greyed out, tooltipped) once it's placed,
rather than letting the economist arm it and discover the rejection only
on click; `handlePlaceGem` also auto-disarms the gem immediately after a
successful placement, since — now that it can never be placed again on
this board — leaving it armed would just prime a click that's always going
to fail. This is a **per-board** constraint only: the same gem type can
still appear once each across many different boards, and "Duplicate as new
gem" in the Gem Library (see "Gems" above) remains the intended escape
hatch for two independently-placeable pieces on one board that happen to
look alike.

**Gem placements render as one merged shape, not a grid of separately
outlined squares — found live, from the economist unable to tell a gem's
extent (leftmost/rightmost cell vs. the middle) at a glance.**
`src/features/diamondMine/lib/gemShape.js`'s `cellConnections`/
`cornerRounding` are the shared primitive: for a cell belonging to some
group id, check whether each of its 4 orthogonal neighbors belongs to that
*same* group; only draw a border (and round a corner) on a side/corner that
does *not* connect to a same-group neighbor. Since every gem is a plain
filled rectangle and placements never overlap (see "Gems" above), this
simple per-corner check can never land on a wrong concave-corner result the
way it could for an arbitrary polyomino — a straightforward win, not a
special case needing a fallback. Both `MineBoardGrid.jsx` (the builder) and
`MinePlayTester.jsx` (the play tester) use it, and — after a since-reverted
false start below — both now feed it the gem's **true, full footprint**
(the board's `occupiedCells`/`session.gemForCell`, every cell a placement
covers), not just the subset that happens to already be revealed.

**A revealed cell shows its true edges immediately, even toward a
still-hidden or still-cracked neighbor of the same gem — this is the whole
point, not a leak to guard against.** The first version of this rendering
filtered `cellConnections` down to only-already-revealed cells, reasoning
that an unrevealed neighbor's connection was information the player hadn't
earned yet. That reasoning was wrong, and the economist caught it live with
a screenshot: a 3×2 gem with one corner sitting behind a blocked tile (so
that corner was merely `'cracked'`, not yet `'revealed'`) showed its other
five cells as a clean, fully-rounded, self-contained shape — reading as a
*complete* 2×2 gem, only for the economist to discover a sixth cell by
chance and realize the piece was bigger all along. The filtered version
was actively hiding the one thing a player most needs to keep playing well:
*which direction to tap next*. The fix is to always compute
`cellConnections` from the gem's real geometry — a revealed cell's border
is suppressed on any side that truly connects to more of the same gem,
regardless of whether that neighboring cell has been tapped yet. A
still-hidden or still-cracked cell itself keeps rendering with zero gem
information either way (no color, no shape) — this only changes the
*revealed* cell's own edge treatment, pointing an open, unbounded seam
toward wherever the rest of the piece really is. Verified live: five
revealed cells of a six-cell gem now visibly butt up against the still-
cracked sixth cell with no border between them, instead of rounding off
as if they were the whole piece. Don't reintroduce the revealed-only
filter — it looks like a principled anti-leak measure but it actively
removes the hint this feature exists to give.

**Stats.** `src/features/diamondMine/lib/diamondStats.js` is an explicit heuristic first pass,
not playtested — tune weights/thresholds freely once real boards get played.
No adjacency or flood-fill mechanic exists (click a tile, it reveals; win
once every gem cell is found), so `computeMinClicks` is just: every cell
covered by any gem placement costs 1 click, or 2 if that cell is blocked;
non-gem cells cost nothing since they're never required to win.
`computeDifficulty` returns `null` for a board with zero placements (treated
as "not built yet," not a valid — and falsely extreme — difficulty reading)
and otherwise a 0-100 score from four weighted factors: emptiness (lower
gem-fill ratio = more area to search = harder), fragmentation (smaller
average gem size = harder — this single ratio already captures "one giant
gem vs. many tiny ones" without needing a separate largest-gem factor),
blocked ratio (more double-tap gem cells = harder), and board scale (bigger
board = harder). Bucketed into Easy/Medium/Hard/Expert
(`DIFFICULTY_BUCKETS`). Deliberately excludes any scatter-vs-clustered
geometry factor — with no adjacency-based deduction mechanic, gem placement
geometry doesn't change the required click count, so a geometric spread
factor would be unmotivated; revisit only if a future player-facing
simulator gives real signal that it matters.

**Solver (blind-play click estimates).** `computeMinClicks` (above) is a
theoretical floor — it assumes the player already knows exactly where every
gem is. `src/features/diamondMine/lib/diamondSolver.js`'s
`estimateClicksToClear(board, gemsById, runs = 100)` reports two different,
complementary numbers instead, both Monte Carlo over `runs` simulated
playthroughs of a player who *doesn't* know where the gems are (no adjacency
hints exist anywhere in Diamond Mine's design):
- **Blind** (`simulateOneBlindClear`): taps uniformly random not-yet-tried
  tiles until every gem cell has come up. The pure no-memory baseline.
- **Smart** (`simulateOneSmartClear`) — upgraded from a first-pass "hunt &
  target" heuristic after the economist tried it and found it still felt
  unsmart. Models a player who knows the board's full gem catalog (which
  sizes exist and how many of each — the in-game "×12"-style tallies) but
  not where anything is, the same "known fleet, unknown location" premise
  real Battleship AI uses. Two phases:
  - *Hunt*: rather than tapping a uniformly random unrevealed tile, this is
    now a three-tier chain (`chooseHuntCell`) — see the dedicated writeup
    just below this list for the full explanation, including the
    guaranteed-hitting-set tier that superseded the original single-
    heuristic version. `densityHuntCell` (originally named `bestHuntCell`)
    is the density heat-map tier within that chain: scores every unrevealed
    cell by how many ways a still-unfound gem size (checked in both
    orientations) could fit there without overlapping anything already
    revealed, and taps the highest-scoring cell — areas consistent with
    more remaining-piece placements are more likely to actually hide one.
    This was the piece that was missing in the very first version: the
    original heuristic hunted with pure random taps and only got "smart"
    reactively, after a hit already landed.
  - *Target*: once a hunt lands a hit, follow its orthogonal neighbors until
    the whole contiguous hit-cluster is bounded by misses/edges — unchanged
    from the original heuristic, since gems are filled rectangles and this
    already maps a piece's exact extent optimally once you have a first
    hit. Deliberately **not** checkerboard-hunting (the other classic
    Battleship shortcut, which skips every other cell) — that's only safe
    when every piece has length ≥ 2, and Diamond Mine explicitly allows 1×1
    gems (`gem.js`'s `"a"`), which a checkerboard pass could step over
    entirely.

  When a hunt-cluster closes, if its bounding box is a clean filled
  rectangle matching a still-remaining size (either orientation), that
  size's remaining count drops by one, sharpening every hunt after it. Two
  *different* adjacent gems can close as one merged, non-rectangular
  cluster — not a bug, `MineBoardGrid.jsx`'s own click-selection treats
  adjacency the same way — that case just skips the decrement rather than
  guessing which piece(s) it actually was, a deliberate approximation over
  building full multi-piece constraint tracking for a Monte Carlo estimate
  that only needs to be a useful ballpark, not a proof.

**The hunt decision is a three-tier chain, each tier a fallback for the
last** (`chooseHuntCell` in `diamondSolver.js`):

1. **`guaranteedHuntCell` — each gem's own "perfect finding logic," combined
   across every remaining gem.** For a single gem of length `L` in one
   dimension of a board sized `N` in that dimension, `hittingIndices(N, L)`
   computes the minimal set of positions that *any* placement of that gem —
   anchored anywhere at all — is mathematically guaranteed to cover. This is
   the classic 1D "battleship" covering pattern (probe every `L`th cell,
   starting at `L-1`), and it's the exact generalization of "a 3-tall gem
   on a 5-row board must cross the middle row" to every shape/board-size
   combination, not just the ones where the guaranteed line happens to be
   one obvious row. `guaranteedHitCells` crosses the row-hitting-set with
   the column-hitting-set for one orientation, which provably guarantees
   intersecting any 2D placement in that orientation (proof: any real
   placement's row range must contain a row-hit index and its column range
   must contain a col-hit index, so that specific cell is necessarily one
   of the placement's own cells). `guaranteedHuntCell` is the board-level
   combiner — it unions every remaining gem's (size × orientation)
   guaranteed cells and scores each surviving unrevealed one by how many
   distinct guarantees it would serve at once, so a cell that's a
   guaranteed probe for two different remaining gems gets tapped first.
   Verified exhaustively (every `(n, len, anchor)` combo up to 14, every 2D
   placement up to an 8×8 board with every shape/anchor) with zero
   violations, and confirmed live that a lone `f` on a 5-row board always
   hunts row 2 specifically, from the very first tap. This does **not**
   claim full joint optimality across multiple simultaneous unknown-
   location pieces — that's NP-hard in general — it's a principled,
   individually-correct-per-gem, greedy combination across gems, not a
   proof of the globally best possible strategy.
2. **`densityHuntCell` (the older heat-map heuristic)** — only reached once
   tier 1 has nothing left to offer (every remaining gem's guaranteed cells
   have already been revealed, which should only happen right after a
   cluster closes without being attributed back to `remainingSizes` — the
   non-rectangular merged-cluster approximation noted above).
3. **A uniformly random unrevealed cell** — the final safety net if even
   tier 2 comes up empty.

Both tiers 1 and 2 rank *per tap cost*, not raw score — dividing by
`tapCost(board, r, c)` (1 open, 2 blocked) so a blocked candidate needs
roughly double the score to beat an equally-likely open one, since it costs
double to actually check; blocked-ness is visible up front in the real UI
(`MineBoardGrid.jsx`'s Lock badge shows on every blocked cell
unconditionally, hidden or not), so a rational player already gets to
factor this in.

**`SMART_HUNT_OPTIMAL_PROBABILITY` is currently `1` (always take the best
move), not `0.8`** — by explicit economist request, while the three-tier
hunting logic above was being built out and validated; it was `0.8` before
(modeling a good-but-imperfect player who takes a uniformly random
unrevealed cell the other 20% of the time), and dialing it back down is a
one-constant change once the deterministic strategy's quality is trusted.
This only ever governed the *hunt* decision (where to explore with no
active hit) — once a hunt lands a hit, the target phase that maps out the
rest of that cluster has no real "choice" to get wrong, so it stays fully
deterministic regardless of this constant. `smart.min`/`smart.max` can
still show some spread even at `1.0`, purely from random tie-breaking among
equally-scored cells, not from genuine better/worse decisions.

Both strategies pay the same double-tap cost as `computeMinClicks` (a
blocked tile is 2, open is 1). `estimateClicksToClear` returns
`{ runs, blind: {mean,min,max}, smart: {mean,min,max} }`; the gap between the
two numbers is itself informative — a board with one big gem shows a huge
smart-play advantage (roughly halves the average in testing), a board of
nothing but scattered 1×1 gems shows none (there's no shape to exploit, so
smart-hunt density is uniform and it degrades gracefully to blind's own
behavior — by construction, not as a bug). Deliberately Monte Carlo rather
than a closed-form expectation — the point is a ballpark an economist can
re-roll on demand, not a proof. Surfaced in `MineBoardEditor.jsx`'s "Board
stats" card as an explicit "Run solve simulation" button, not an
auto-recomputed stat like the others — a random number that silently
changes on every unrelated re-render would read as broken, not live. The
cached result is cleared (`useEffect` keyed on the `board` reference) the
moment the board changes at all, so it can never be shown next to a board it
no longer describes.

**Results render as three aligned comparison bars, not plain sentences** —
`MineBoardEditor.jsx`'s `SolveBar`: Theoretical floor (`computeMinClicks`,
a bare marker, no min/max since it's one deterministic number, not a
distribution), Blind guesswork, and Smart play, all three sharing one
`scaleMax` (`blind.max`, reliably the largest of the three) so their bars
are relatively meaningful side by side rather than each auto-scaling to its
own range. Each ranged bar shows a lightly-shaded band from min to max plus
a solid marker at the mean — added because the original plain-text
sentences made the three numbers hard to compare at a glance, and put the
theoretical floor nowhere near blind/smart even though it's the most
useful anchor for both. Pure div/Tailwind, not `recharts` (already a
project dependency elsewhere) — three static bars didn't warrant pulling
in a charting library's API for something this simple.

**Run count is economist-editable, not a fixed constant.** `MineBoardEditor.jsx`
has a plain number input next to the "Run solve simulation" button
(`runsDraft`, committed only when a run actually starts — nothing reads it
live mid-typing, so there's no partial-number hazard to guard against),
defaulting to `DEFAULT_SOLVE_RUNS = 500` (raised from an original fixed
100 once the economist wanted more samples on demand rather than a single
baked-in count). The count actually used for the in-flight/last run is
tracked separately (`runsUsed`) so the "Breaking rocks — simulating run
N/total" progress readout can't drift from what was actually started even
if the economist edits the input again before the run finishes.

At several hundred runs, a dense 12×12 board's combined blind+smart
simulation can take a couple of seconds — long enough that
`estimateClicksToClear` is **async and chunked**, not one big synchronous
loop: it yields back to the event loop every 5 runs (`CHUNK_SIZE`) and
reports progress via an optional `onProgress(done, total)` callback. This
was found live — an earlier
synchronous version worked fine functionally, but froze the tab for its
whole duration, which meant the "Breaking rocks" pickaxe-swing loading
animation (CSS `@keyframes pickaxe-swing` in `index.css`) rendered once and
then sat frozen mid-swing instead of animating, since a blocked main thread
can't repaint. Chunking every ~25ms keeps every individual block
imperceptible (well under a dropped frame at 60fps) while still letting the
whole operation take "several seconds" if the board is big enough — that
tradeoff (a snappier UI vs. a literal single unbroken computation) was an
explicit ask, not a default assumption to second-guess if this ever needs
touching again.

**Blocked tiles are always visible on the board, in either mode.**
`MineBoardGrid.jsx` renders a small lock icon on every blocked cell —
gem-covered or not — unconditionally on `board.blocked[r][c]`, not gated by
which mode (`place`/`blocked`) is active; the tile's dark-gradient (empty)
or white-border (gem-covered) styling was there from the start but read as
too subtle on its own, found live from an economist unable to tell where
the blocked tiles were at a glance. `MineBoardEditor.jsx`'s "Board stats"
card also shows a plain "Blocked tiles: N / total" count — the only stat
in that card that doesn't require any gem to be placed first, since
blocked-ness is a property of a tile independent of whether a gem sits
under it.

**Generator.** `src/features/diamondMine/lib/diamondGenerator.js`'s `generateDiamondBoard`
doesn't invert the scoring formula analytically (that would couple it to
`diamondStats.js`'s exact weights and break the moment those get tuned).
Instead: seed ~10 unconditional random placements, then hill-climb up to 200
random nudges (`addRandomGem`/`removeRandomGem`/`blockRandomGemCell`/
`unblockRandomGemCell`), keeping a nudge only if it doesn't increase distance
to the target bucket's midpoint score, stopping early within ±4. Always
returns its best-effort board plus what it actually achieved
(`achievedScore`/`achievedBucket`) — never claims an exact hit. No-ops
gracefully (returns the board unchanged with `achievedScore: null`) on an
empty gem library or a board too small for anything to fit, rather than
looping forever.

Two extra generator inputs, both optional/non-critical — "if not given,
generate whatever": `targetFillPercent` (gem coverage as a % of the board)
and `targetBlockedTiles` (a total blocked-tile *count*, gem-covered or not).
`targetFillPercent`'s UI field (`MineBoardList.jsx`) still starts truly
empty (real "auto," generator's own choice), but `targetBlockedTiles`'s
field defaults to `'0'`, not empty — by explicit economist request, a
freshly generated board should start with zero blocked tiles unless the
economist deliberately types a different count, rather than the generator
picking an arbitrary one on its own. Pinning either one removes it as a
hill-climb degree of freedom entirely —
`fillToTarget` (a dedicated best-effort seed loop, not part of the hill-climb)
handles a pinned fill, `assignBlockedCount` (a one-shot uniform random sample
over *every* cell on the board, not just gem cells) handles a pinned blocked
count, and whichever nudges would have touched the now-pinned dimension are
dropped from the hill-climb's nudge pool - the difficulty target still gets
chased via whatever's left unpinned. If both are pinned, no hill-climbing
happens at all; the achieved difficulty is just whatever naturally falls out,
reported honestly like every other best-effort result here.
`assignBlockedCount` is the **only** path that can produce a blocked tile
that isn't under a gem - the difficulty formula only credits blocked *gem*
cells, so the unpinned hill-climb's own blocking nudges have no reason to
ever touch an empty tile on their own; this was a real capability gap (found
live, from an economist wanting non-gem blocked tiles and having no way to
generate them) before these two inputs existed.

**Two generator-only exclusion toggles** — "Don't use gem 'a'" and "Don't
use gems 'b' & 'c'" (`MineBoardList.jsx`'s "Generate a board" card) — let
the economist opt the smallest default gems (the 1×1, and the 1×2/2×1
pair) out of a *generated* board without touching the Gem Library. Matched
by the gem's own `name` (`g.name === 'a'`, etc.), not by footprint size or
gem id — this is a literal reference to the named default gems, same as
the economist's own "not to use 'a' gem... b,c gem" request, not a general
"exclude anything this small" rule. Implemented as a pre-filter:
`MineBoardList.jsx` computes `usableGems` from `gems` before calling
`generateDiamondBoard`, so `diamondGenerator.js` itself needs no exclusion
concept at all — it simply never sees an excluded gem in its own `gems`
array and can't place what isn't offered. Pure local UI state (like the
rows/cols/bucket fields next to it) — not persisted, and doesn't touch any
gem already placed on any existing board, only what a *future* Generate
click can place. If both toggles end up excluding every gem in the
library, Generate disables (mirrors the existing "no gems at all"
disabled state) rather than silently producing an empty board.

**Syntax.** `src/features/diamondMine/lib/diamondSyntax.js` mirrors `boardSyntax.js`'s explicit
placeholder framing exactly — a blocked-tile ascii map, a placement list, and
computed min-clicks/difficulty, all clearly not-final pending a real Ops
spec. Rendered in Diamond Mine's own "Syntax" tab
(`MineSyntaxPage.jsx`) — no Normal/CC split like Merge's, since there's no
suggestions system here.

**Persistence.** Separate from Merge's `persistence.js` on purpose — that
module's `{boards, presets, targetSubsidy}` shape is a documented single
contract for Merge; `diamondPersistence.js` uses its own key
(`merge-mania-diamond-mine`) storing `{ gems, boards }` so the two features'
save data never blur together.

**Play Tester.** `src/features/diamondMine/components/MinePlayTester.jsx` +
`src/features/diamondMine/lib/minePlaySession.js` are Diamond Mine's
equivalent of Merge's Play Tester — the economist manually plays a board
(tap to reveal, hidden gems, cleared-board celebration) as a ground-truth
check on the design. Deliberately **not** a wave/row-push chain like
Merge's `pushBoardIn`/`advanceBoards` — Diamond Mine boards have no such
concept (see "Implementation status" above), so "the next board" just
means swapping to a fresh one wholesale once every gem on the current one
is found. Also deliberately **not** mirroring Merge's "compare to automatic
simulator" button or scrolling event log — neither was asked for, and
Diamond Mine already surfaces `computeMinClicks`/`estimateClicksToClear` in
the Board stats card, so there's no missing-context gap those would fill.

Same "mutate the session, hand React an already-computed plain object"
convention `playSession.js` documents and explains (React Strict Mode can
invoke a state-updater function more than once, which would double a
mutation if the updater itself performed it) — `tapCell`/`advanceToNextBoard`
mutate `session` in place; callers call the mutating function once, then
`setSession({...session})` themselves. `tapCell` returns a small result
object (`{ gemCompleted, boardCleared }`), not the session, since there's no
persistent event log here to diff against the way `playSession.js`'s
actions do.

Each cell has 3 states, not 2: `hidden → cracked → revealed`. A plain cell
goes `hidden → revealed` on tap 1. A blocked cell (`board.blocked[r][c]`,
independent of gem coverage — see "Boards" above) goes `hidden → cracked`
on tap 1, `cracked → revealed` on tap 2 — the "double-tap" from the domain
model, implemented as two ordinary taps with no time-window/gesture
requirement (matching how `computeMinClicks`/`estimateClicksToClear` already
cost it: 2, not "1 within some interval"). `hidden` and `cracked` render
identically regardless of what's underneath (no gem color, nothing) — only
`revealed` shows ground truth for *that cell*, a gem's color
(`gemsById[...].color`, same convention `GemShapeIcon`/the builder use) or
plain "rubble" if the cell isn't part of any gem. Blocked-ness on a hidden
cell IS shown up front (a `Lock` badge, same placement `MineBoardGrid.jsx`
already uses unconditionally in the builder) — it leaks zero gem-location
info since blocked-ness has nothing to do with gem coverage, and is
genre-standard (a tougher-looking tile reads as tougher before you touch
it). A gem counts as "found" only once every cell in its footprint
individually reaches `revealed` — `gemForCell`/`footprintByPlacement` (both
derived from `diamondBoard.js`'s `occupiedCells`, never recomputed a second
way) drive both the reveal check and the win condition, so they can never
disagree with the builder's own overlap/stats math about what a placement
covers.

**A gem tracker row sits above the board**, one entry per placement on the
current board (mirrors "no duplicate gem types per board" above — this is
never more than one entry per gem type). Deliberately shown from the very
start of a board, before anything is tapped: `GemShapeIcon`'s `dim` prop
renders a placement's shape in neutral grey (still full-size, real
rotation) until `isPlacementFound` (same "every footprint cell is
`revealed`" check as `tapCell`'s own completion logic, just read fresh off
`session.cellState` for display) goes true, at which point it swaps to the
gem's real color. This is an intentional, explicit hint by economist
request — telling the player up front how many pieces exist on this board
and roughly what shapes to expect, then confirming completion by filling
in color — not an oversight to later "fix" into something more
mysterious.

**Celebrations.** `src/features/diamondMine/lib/mineCelebration.js` mirrors
`mergeCelebration.js`'s particle-fly-out math (and reuses `index.css`'s
existing `@keyframes merge-particle` as-is — generic fly-out-and-fade math,
nothing Merge-specific baked into the CSS despite the name) but with two
fixed configs instead of size-tiers, not one config scaled by gem size — a
gem-found burst (small, ~5 particles) fires *once per revealed cell*,
simultaneously across the whole footprint — deliberately not scaled up
per cell count, since scaling a "big" burst per cell would multiply out of
control on a large gem (a 4×4 firing 16 big bursts at once); a bigger gem
still reads as a bigger moment for free, since more cells sparkle at once.
A board-cleared burst (bigger, ~26 particles) is a single one-shot "grand
finale" over the whole grid, not a per-cell effect, layered under a
`BoardClearedBanner` (`MineCelebration.jsx`) that also carries the
auto-advance. `EMOJI_POOL` adds 💎 to this codebase's already-shipped
emoji-particle convention rather than introducing a new one.

**Board-complete flow.** The last gem's own found-celebration plays first;
~250ms later (`BOARD_CLEARED_DELAY_MS`) the board-cleared banner appears
(stops the found-burst and the banner's own burst from visually colliding
when a single tap both completes a gem and clears the board — e.g. a lone
1×1 gem) and auto-advances after ~1800ms (`AUTO_ADVANCE_MS`), with a "Skip"
button on the banner for an economist batch-testing many boards who
doesn't want to wait out the timer. `tapCell` stops accepting taps the
moment a board clears (`status: 'board-cleared'`) until the advance
actually happens. Advancing skips past any empty board in the list
silently (mirrors Merge's own board-chaining precedent — "cascades through
boards that clear instantly... simply stops firing once the list is
exhausted," no special per-skip messaging there either); the *last* board
in the list leads to a terminal `'all-cleared'` status with no timer,
sticking until Reset or a different sidebar pick. A board selected
*directly* from the sidebar that's empty shows an inline message instead
of auto-skipping (mirrors `PlayTester.jsx`'s `needsGeneration` message) —
auto-skip only applies mid-chain, never to an explicit pick.

Wired into `DiamondMineApp.jsx` as a new "Play test" tab, alongside the
existing `MineBoardList` sidebar (so the economist can pick which board to
start from, exactly like Merge keeps `BoardList` mounted alongside its own
`PlayTester`) — `<MinePlayTester key={activeBoard.id} .../>` uses the same
remount-on-sidebar-change key pattern `src/App.jsx` uses for Merge's
`PlayTester`, so switching boards mid-play discards the in-progress session
for free. `MinePlayTester`'s own `reset()` rebuilds the session at the
`boardIndex` **prop**, not `session.boardIndex` (which may have already
advanced past it) — same distinction Merge's `PlayTester.reset()` makes.

## Known open items / do not silently resolve these

- **Tier re-lock is resolved as dynamic (non-ratchet).** If a player's only
  rank-7+ item gets merged away, x2 re-locks — `generatorTier.js`'s
  `currentTier`/`unlockedTiers` are keyed off the player's *current* max
  rank held, re-evaluated every time, not the best rank ever reached. This
  was an open question in earlier design discussion; it's now the shipped
  behavior in both the automatic simulator and the play tester. Flag it
  here (not just in a code comment) since it's the kind of subtle rule a
  future change could silently break by switching to a ratchet without
  realizing one was deliberately avoided.
- **Rank-window floor is now hard for non-first boards, resolving part of
  the old "accepted but not final" caveat** (see "Item generation
  invariant" above) — the min-rank floor overallocates sum rather than
  drifting, by explicit economist request. Item count is still soft
  everywhere, board 0's small-rank remainder still drifts the old way, and
  the max-rank ceiling was already hard. If a similar complaint comes up for
  board 0 or for item count, don't assume the same fix (overallocate)
  applies there too without confirming — this was scoped specifically to
  non-first boards' rank floor.
- **Presets are only correct at the size they were captured at.** A preset
  saved from a 5×8 board applied to a 6×10 board only fills the top-left
  5×8 region, leaving the rest `"open"` — see "Board layout presets" above.
- **`computeOnboardingReserve` (`onboardingGoal.js`) is a true search, not a
  binary search over reserve value — reserve-value feasibility is NOT
  monotonic, and treating it as such produced a real false-negative "goal
  unreachable" bug.** Reaching `targetRank` draws on both the blocked
  queue's own reserved value AND whatever DR-generated items the player
  produces within `drBudget` (the semi tiles' contribution is now fixed —
  see "Board 1's semi tiles are always rank 1" above — so only the blocked
  side is actually searched), so a reserve *smaller* than
  `valueOf(targetRank)` can be sufficient — found live, a working reserve
  sat below `valueOf(5)=16`, a value an old doubling-then-binary-search
  (which only ever started at `valueOf(targetRank)` and searched upward)
  never tried. Worse, a *larger* value can decompose into a shape that
  doesn't actually work within a tight `drBudget` purely as an artifact of
  the `maxRank` cap and split/merge shape at that specific value, while a
  smaller value's decomposition avoids it — so failing at one value does
  not imply failing at every larger one. Several fixes now compose to
  search this properly: `MERGE_STRATEGIES`/`pickMergeByStrategy`
  (`mergeSimulation.js`) try multiple merge-priority orderings per attempt,
  not just the main simulator's own default (`findLegalMerge`);
  `candidateItemCounts` tries a spread of item counts per value rather than
  always maximizing fragmentation; each candidate is also tried in both
  ascending and descending order, since which one wins flipped once semi
  tiles stopped being able to host a big anchor item (see above) — found
  live, `[2,3,4]` reached the target while the descending `[4,3,2]` shape of
  the exact same items did not. `computeOnboardingReserve` itself scans
  reserve values in plain increasing order (the first value that succeeds
  *is* the minimum, by construction) rather than assuming monotonicity —
  exhaustively up to a generous multiple of `valueOf(targetRank)`, then a
  coarse doubling probe for anything larger, under an overall ~400ms
  wall-clock deadline (a genuinely-infeasible board with a very tight
  `maxRank` cap can otherwise force thousands of same-rank items and take
  several seconds to exhaust — measured live at ~7s before the deadline was
  added). Every legitimate case tested this session resolves in well under
  50ms; the deadline exists purely as an outer safety net for degenerate
  configs, not a tuning knob to lean on. If this search ever needs touching
  again, re-verify against a case that fails with the naive doubling/binary-
  search approach, and against both queue orderings, specifically (not just
  re-running the existing regression set) — that's exactly the class of bug
  that hid here across several fix attempts before the search strategy
  itself was identified as the actual problem each time.
- **`src/features/merge/lib/boardSyntax.js` is an explicitly placeholder Ops export
  format**, not a design decision — the economist hasn't gotten the real
  syntax spec from Ops yet. It's deliberately isolated (one file, four pure
  functions — real-config and suggestions variants, each with a per-board
  and a whole-chain form — nothing else in the app reads its output) so it
  can be replaced wholesale the moment the real spec exists. Don't treat its
  current shape (tile-map ASCII, `(row,col)=Rrank` semi list, comma-separated
  blocked queue, `QUEUE +N%:`/`EV +N%:` suggestion lines) as meaningful or
  worth preserving — it's a stand-in.

## Recompletion boards

A second, fully independent board list for the board(s) a player cycles
through after reaching the event's Last Tier (`eventSheets.js`'s
`EVENT_DATA_TEMPLATE` — "what rank is the last tier of the first completion
- triggers recompletion"). Before this, "recompletion" was purely a static
Ops config row with no supporting app functionality at all — this is that
support.

**Same shape, same behavior, separate data — by explicit economist
request.** Recompletion's board 0 gets the *exact same* "board 1" treatment
as the main list's board 0: onboarding goal, guaranteed rank-1/2/3 items,
rank-1-only semi tiles, uncapped rows, the "Total subsidy" dashboard. This
was a direct decision, not a default — the alternative (a stripped-down
"just a normal board, no first-board specialness" treatment, since
recompletion isn't a brand-new player's first board) was considered and
explicitly rejected in favor of full parity. Don't quietly simplify
recompletion's behavior later on the assumption that a "first board"
concept doesn't make sense for repeat content — it was asked for as-is.

**`src/features/merge/lib/useBoardListState.js`** is what makes this
cheap: every CRUD operation `App.jsx`'s `EditorApp` needs for one ordered
board list (active-board tracking, add/duplicate/remove/reorder, bulk
board-count, saved presets, an optional target-subsidy goal) was extracted
into this hook, copied verbatim from the original inline implementation
(not rewritten) so the main list's behavior is provably unchanged. `EditorApp`
calls it twice — `main = useBoardListState(...)` and
`recompletion = useBoardListState(...)` — and renders two entirely separate
`BoardList`+`BoardEditor` pairs, one per mode, rather than mixing the two
board lists into one screen. If a third independent board list is ever
needed, it's a third call to this same hook, not a third copy of the CRUD
logic.

**UI**: a new "Recompletion" tab in `EditorApp`'s `MODES`, right after
"Editor" — its own sidebar and editor, not shared with or shown alongside
the main list's. Deliberately does **not** get its own Play Tester, CC
Management, or per-board Syntax export — only the editing surface and the
"Recompletion Board Layouts" sheet (see "Real Ops sheets" above, which reuses
`buildBoardLayoutsSheet` unchanged against `recompletion.boards` instead of
the main list) were asked for. Don't proactively extend Play
Tester/CC Management to recompletion without being asked.

**Persistence**: `recompletionBoards`/`recompletionPresets`/
`recompletionTargetSubsidy` sit alongside `boards`/`presets`/`targetSubsidy`
inside each segment's own saved object (see "Persistence" below) — a fresh
single board (`createBoard('Board 1')`) if absent, matching the main list's
own from-scratch bootstrap, so an older save from before Recompletion (or
before Segments) shipped loads without crashing.

## Persistence

`src/features/merge/lib/persistence.js` uses real browser `localStorage`
(personal, not shared) under key `merge-mania-board-simulator`, storing
`{ segments: [seg1, seg2, seg3, seg4] }` as JSON, where each `seg` is
`{ name, boards, presets, targetSubsidy, recompletionBoards,
recompletionPresets, recompletionTargetSubsidy, eventStartDate,
eventDurationDays }` — the exact shape a single-project save used to be at
the top level, now nested once per segment (see "Segments" above). Save
stays an explicit action (the header's Save button, `App.jsx`'s
`handleSave`) rather than continuous autosave — preserve that if this grows
a real backend. This is the *economist's own* editing session only — it has
nothing to do with sharing a stage with players, which travels entirely
through the URL instead (see "Player mode (Play Stage) & hosting" below,
`stageShare.js`); don't conflate the two or route one through the other. Note
"Share stage" (`handleShare`) only ever encodes the *active segment's* main
board list — recompletion boards, and every other segment, were never asked
to be player-shareable and aren't part of that link.

**Migrating a pre-segments save.** `App.jsx`'s `segmentsFromPersisted(parsed)`
is the one function both a `localStorage` load (`initialState`) and a backup
restore (`handleImportFile`) go through, so the two paths can never drift
out of sync on this. It recognizes two shapes: the current
`{ segments: [...] }`, and the OLD flat single-project shape (`{ boards,
presets, targetSubsidy, recompletionBoards, ... }`, no `segments` key at
all — anything saved before this feature shipped). A flat save migrates its
real data into **Segment 1** (never discarded), with Segments 2-4 starting
fresh (`freshSegment`) — the same "never silently lose a real save" instinct
`localStorage`'s port-pinning and the durable-backup feature below already
embody. Verified live: seeding `localStorage` with a pre-segments blob (one
custom board, a `targetSubsidy` of 500) and loading the app landed that
exact board and subsidy target on Segment 1, with Segments 2-4 each showing
a plain fresh "Board 1" and no subsidy target — not a hypothetical, an
actual reproduction before this shipped.

**The dev server port is pinned (`vite.config.js`: `server: { port: 5173,
strictPort: true }`).** Found live from a real "I saved boards yesterday and
they're gone" report: `localStorage` is scoped per exact origin *including
port*, and without `strictPort`, Vite silently falls back to 5174+ when 5173
is already occupied by a stale process — so a board list saved under one
port becomes invisible (not deleted, just unreachable) the moment the dev
server happens to start on a different port. `strictPort: true` makes a port
conflict fail loudly (an immediate startup error) instead of silently
causing what looks like data loss later. If this ever needs relaxing (e.g. to
run two instances side by side), don't just delete `strictPort` — that
reopens exactly the failure mode this exists to prevent.

**Durable backup, independent of localStorage entirely** — "Export backup"/
"Import backup" buttons in `EditorApp`'s header (`App.jsx`'s
`handleExportBackup`/`handleImportFile`), additional to (not a replacement
for) the existing Save button. Export bundles **all 4 segments'** full state
(`buildSaveShape(segments)` — the one function both `handleSave` and
`handleExportBackup` build their payload through, so `localStorage` and the
downloaded file can never drift into two different shapes) into one
downloadable `merge-mania-backup-<today's date>.json`, so the economist's
data can survive clearing browser storage, a port mismatch masking a save
under a different origin, or moving to a different machine or browser
entirely — something `localStorage` alone can never provide. Import goes
through the same `segmentsFromPersisted` migration a `localStorage` load
uses (see above), so an imported backup from before Segments (or before
Recompletion) shipped lands its real data on Segment 1 rather than
crashing or getting discarded, and **never partially applies** — a
corrupted or malformed file leaves every segment's state untouched and just
shows a dismissible error banner (the same visual pattern as the existing
"Share stage" link-too-long warning). `useBoardListState.js`'s
`replaceAll({ boards, presets, targetSubsidy })` is the hook method every
segment's `main`/`recompletion` calls (once each, in a loop over all 4
segments) to do its own wholesale swap — used only by restore/clear-data,
never by any incremental editing path.

**Event schedule** (`eventStartDate`, `eventDurationDays` — per-segment now,
via `useSegment`'s own `useState` pair; the "Event schedule" card in
`BoardEditor.jsx`, main board list only) is a single whole-event value per
segment, same "one canonical value, not per-board" precedent as
`targetSubsidy` — it deliberately does **not** render on Recompletion's own
board 0 (the card's own JSX is gated on `onUpdateEventStartDate` being
passed at all, which `App.jsx` only does for the main list's `<BoardEditor>`
call). `eventDurationDays` defaults to 7, matching this file's own "7-day
timed live-ops event" framing; `eventStartDate` stays unset (`null`) until
the economist actually picks one. Exists purely to feed the Ops workbook
download's filename (see "Real Ops sheets" below) — doesn't affect
generation, placement, or simulation at all, the same "display/export-only"
convention `rewardRanks`/`rewardSyntax` already follow.

## Style/stack notes

- React functional components, hooks-based, Tailwind v4 (`@tailwindcss/vite`
  plugin, no `tailwind.config.js` — theme tokens live in `src/index.css`'s
  `@theme` block).
- `src/index.css` is not just a Tailwind entrypoint: it also defines the
  `--font-sans`/`--font-display` theme tokens, the `.app-backdrop` gradient
  background used by `App.jsx`, and the `@keyframes merge-particle` the merge
  celebration uses. It's small and deliberate, not a place utility classes
  accidentally leaked into — keep new global/animation CSS there rather than
  reaching for inline `<style>` blocks or a second CSS file.
- Visual identity: Baloo 2 (`font-display`, loaded via Google Fonts link tags
  in `index.html`) for headings/big numbers, Inter (`font-sans`) for
  everything else; a soft purple/fuchsia "aurora" gradient backdrop
  (`.app-backdrop`); gradient purple→fuchsia for primary actions and active
  nav/tier-selection states; icon badges on card headers. Reuse these rather
  than introducing a second visual language for new UI.
- **No charting library — every chart in this app (Diamond Mine's `SolveBar`,
  the Playthrough simulation table's per-rank bars, `EffortDistributionChart`)
  is plain div/Tailwind, not `recharts`.** This file used to claim
  "Charts via `recharts`" here; that was simply wrong — `recharts` has never
  been a dependency of this project (checked live against `package.json`
  and `node_modules` while this line was corrected). If a genuinely complex
  chart is ever needed, evaluate charting libraries fresh at that point
  rather than assuming this note meant one was already wired in. Icons via
  `lucide-react`.
- Color ramp for rank display (`RAMP` / `colorForRank` in `src/features/merge/lib/ranks.js`)
  is a rarity-style gradient — emerald→teal→cyan→sky→blue→indigo→violet→
  purple→fuchsia→pink→rose→gold as rank increases 1–12 — **not** the
  single-hue light→dark purple ramp originally specified; that read as flat
  and washed-out and was changed on explicit request. Reuse this convention
  (and this exact ramp) for any new rank visualization rather than reverting
  to single-hue purple or inventing a second palette.
- No backend, no database, no auth — pure client-side state plus
  `localStorage` for persistence.

## Real play against the simulator, and one event in the sheets

Economist: "i got a friend that did a run on the share stage and he ended up
with crazy rewards from the small rewards. we need to try and make the
simulator that runs on the boards better with the small rewards. it needs to
be as tight as it can be." And, in the same round, about the Syntax output:
"the generator weight should add the new rank 13 and 14 ... the small rewards
should hold a drop for the rank13 and 14 merge ... the blocked queue, now we
need to merge the normal and the RC one after another, because they happen one
after another in the same event ... in the item ladder we need to hold the
ladders also together."

### What a robot on the real play engine found

A robot (`scripts/verify/playRobot.mjs`) played a built event's decoded stage
link on `playSession.js` - the engine a link runs - in different ways, next to
the simulator's own numbers. Measured on a two-segment test event (single
builds; the figures move a little from build to build):

- **A player who merges every reward item gets what the simulator says.** Normal
  event and Recompletion, every reward within about 10 points of the
  simulator's average. Biggest multiplier or x1 only, with or without merge
  energy, merging in any order: no real difference. Nothing to fix there.
- **Endless mode paid for itself.** 40% of 1.5x drops as merge energy, each
  merge energy a free tap, each tap leading to more drops: the loop gave back
  more taps than it used. 45 DR paid, 28,000 free taps (the robot was stopped,
  it would have gone on), 44,000 merge energy, 4,300 puzzles, 7,500 charms.
  The tool already showed an amber "would pay for itself" line; nothing
  stopped it. Now `ENDLESS_ENERGY_PAYBACK_MAX` (0.5, this app's own) holds the
  merge energy in the endless drops to 50 free taps per 100 DR of generator
  output, and what is taken off drops as coins (as the other rewards when
  coins have no values). Measured after: 600 DR paid, about 640 free taps.
- **Tapping a reward item can pay more than merging it.** The reference rank
  values do not reward merging (puzzles 5/15/15/40: 7.5 a piece at rank 2, 5
  at rank 4; charms 5/10/30/40: 7.5 at rank 3). The simulated player always
  merged to rank 4. A robot that taps when it pays got about 1.2-1.65x the
  puzzles and 1.4-1.5x the charms.
- **Tapping everything stops the boards.** A reward under a tile only opens
  when a matching item is merged into it (economist rule: the board waits), so
  a player who taps every item never clears that board, never gets the later
  boards or their subsidy, and spends several times the DR - free on a play
  link. Up to 2.7x a reward's target in Recompletion, on 4,800 DR against
  1,265.

### What changed

- `simulatePlaythrough({ collectPolicy })`: `'merge'` (default, unchanged -
  every build is still sized for it), `'best'`, `'all'`
  (`findTapCollectCell`). The simulator agrees with the robot for all three.
- Step 7's validation plays all three (`validateDraftSegment().styles`, 30
  simulated players for each tapping style) and shows "The same event, played
  three ways", names the ranks where a tap pays more, and links to step 4's
  existing one-click fix. **The build does not change the shape of typed rank
  values by itself** - that is the economist's call (asked, see CLAUDE.md's
  open questions).
- Rejected: sizing every build for the player who taps when it pays (the
  merging player would then land at about two thirds of each amount); and a
  re-layout of the containers to narrow one player's spread - with each merge
  rolling on its own and a reward getting only 15-40 items a phase, the spread
  of a single player (about 15% standard deviation for a reward) is close to
  what the drop rules allow.

### One event in the sheets

- Generator Weights: rows for ranks 13 and 14 (every multiplier), written with
  the Recompletion list's own lucky-drop EV and unlock ranks; columns T1-T14.
  The economist's screenshot has five extra columns after T12 headed "T1
  weight" to "T5 weight" (all 0) and rows to rank 16 - not confirmed which the
  parser wants; ours are T13 and T14.
- Blocked Queue: the normal boards' entries, then Recompletion's, Entry Number
  carrying on. The "Recompletion Blocked Queue" tab (and "RC Blocked Queue" in
  the all-segments workbook) is gone.
- Item Ladder: tiers 1-14; 1-12 the normal list's milestone rewards, 13-14
  Recompletion's. "RC Item Ladder" is gone.
- Small Rewards Bank / Small Reward Weights: merge tiers 2-14
  (`containersOfEvent`). Tiers 13-14 are the Recompletion list's rows for
  them; a Recompletion container the normal list does not have is added after
  the normal ones. The RC tabs stay: Recompletion's tiers 6-12 differ from the
  normal ones, and whether the game has one table or two is an open question.

### The economist's answers, and what they changed (same round)

"i want the model to give the values of the ranks but with nice rounding for
the amounts" · "as for the generator weights, we need now only until rank 14"
· "as for now its the same for both normal and RC" · "we need to make sure the
EV is as good as it can be so we will hit nearly what we are looking for" ·
"my friend did those amount in the normal only. he didnt go to the RC or the
endless mode" · "we need to make sure the simulator after getting to rank 12,
merges all the small rewards and collect them. to understand how much really
the user got". Asked two questions with options: rank values **per segment**;
**the normal event exact**, Recompletion following it.

- **The model gives the rank values.** Round (`niceRewardValues`,
  `niceCoinValues`), rewarding merging, each segment its own, set last on the
  boards the segment really gets and on 150 simulated players
  (`fitValuesOnFinalBoards`). Before: one set for all segments, only changed
  when a reward was more than 15% off, by one factor on the typed shape (so
  8/23/23/61), and sized on 20 players on boards the effort pick could still
  replace. Measured on test events (single builds, independent 150-200 player
  checks): every reward of every segment within about 93-109% of its amount,
  coins within 3%; before, the non-base segments sat 20-45% over. The cost of
  round amounts is half a rounding step of the top value (3% at 75, 6% at 40,
  10% at 25) - a finer grid would give 61 and 23 back.
- **The credit loop.** With round values merge energy lands near its target,
  not on it, so the passes follow the simulated credit, keep the values of
  the pass before (a dead band of 0.75 step) and settle within
  `creditToleranceFor` (0.5 DR or 1.5% of the segment's demand). Asking for
  0.5 DR had the passes chase sampling noise: gaps of 3 to 17 DR, never
  converged, every segment "Can be improved".
- **Leftovers are collected** at a phase's top rank (default 'collect', older
  saves migrated once). The simulator's amounts rose 8-15% on a test event -
  what a player really taps before stopping.
- **One event, one table.** Recompletion builds `inherit`: the normal event's
  values, drop rules and containers. Its own: the reward under its tiles and
  the rows for the merges that make rank 13 and 14
  (`tuneRecompletionTopRows`). Its targets are compared, not sized for; a
  miss is reported as "Recompletion pays what the normal event's merge drops
  give" with a one-click "ask for what it pays". The RC bank/weights tabs are
  gone from the exports; the all-segments workbook has "S{n} Small Rewards".
  Rejected: balancing the table between the two phases (the economist chose
  the normal event exact).
- **A normal-only play link ends at rank 12.** The generator used to stay on
  after "the chain is complete". The most likely reasons a friend's
  normal-only run paid far more than designed, in order: playing on after
  rank 12; tapping reward items (which paid more than merging at the
  reference values, and - tapping every one - leaves the reward under a tile
  closed, so the boards never clear and the taps, free on a link, never
  stop: 8x the DR on one test segment); leftovers the simulator did not count.

### Duplicates in the Syntax output

Economist: "it can take diff numbers" (per-segment rank values are fine in
production) and "in alot of pages we got many duplicants of think we dont
need. go over the output and check which we duplicate alot in the same page
without any need for that." An audit of every page of a built three-segment
event (rows that repeat once the first column is ignored, columns equal to
another, columns with one value) found, and fixed:

- All-segments Event Data, Multipliers, Generator Weights: one full copy per
  segment although these are the same for every segment by rule (42, 9 and 81
  rows for 14, 3 and 27; with eight segments Generator Weights was 216). Now
  each row once with Segment "All"; a row that differs (TutorialDrAmount) per
  segment in its place; segments with different row sets keep their blocks.
- V2 Reward Chain: every row twice (Main, RC) since Recompletion plays the
  normal event's values. Once, as "Main + RC".
- V2 Drop Groups: 130 rows for 50 - Recompletion repeating the normal table,
  the normal list's never-played ranks 13-14, and a zero "(no drop)" line at
  every rank. And one tab in the all-segments workbook instead of one per
  segment.
- Normal / CC text views: the list's rank rewards and lucky-drop EV under
  every board, the two EV bumps under every board; reward items printed as
  R1001.

Left as they are, because they are the reference format: one Generator
Weights row per rank and multiplier (and columns T6-T14 always 0), Pool Number
= Entry Number with Stock and Weight 1, Section on every Board Layouts row,
the NoDrop-only rows of Small Reward Weights below the start rank. Noted, not
changed: the bank holds about 35 containers, several at a weight under 3% and
(in endless) ten pairs that differ only in the Twister item's rank - not
duplicates, but trimming them is a change to the drops, not to the export.

### Close for every player, not only the average one

Economist: "now i want u to think even better on how to make the simulator
run even better. and maybe run more runs. we need to make sure we will know
that the resources the user gets will be some what close to what we wanted
him to get."

**What was measured first** (300 players a segment, the simulator against the
robot on the play engine): the averages agreed within 1-2%. The problem was
the spread between two players of the same segment - puzzles sd 17%, merge
energy 32%, charms 15%, DR 23% on one test segment; about 4 players in 10
within 15% on merge energy. More runs make an average steadier; they do not
make one player closer to it. The spread came from which container a merge
happened to roll.

**Steady containers** (this app's own design, inside the economist's
item-count rules; step 4 "Every merge of a rank drops the same items", on by
default, `steadyDrops`). One container per merge rank: rank 6 always the one
item of the reward under the tiles; the one-or-two rank one reward, with the
Twister item in the share the rise gives; a two-item rank one reward and the
Twister item; a three-item rank three rewards. Which reward and what size at
which rank is chosen so each reward lands on its amount (energy first, then
the reward that asks for most; the least-served reward takes the next
place), and the rank values close what is left. The Twister item has one
size per merge rank as well (an in-between size used to be two ranks mixed
by weight - a coin toss at every merge). Single builds, 300 players each:
coins, puzzles, merge energy and charms identical for every careful player
in every segment (sd 0%), 100 of 100 within 15% on every reward at once,
against 28 of 100 with the varied containers on the same segment. What still
differs: generator luck (DR sd 2-5%) and the Twister (4-6%, from the
one-or-two rank). Rejected: more containers with finer weights (still
chance), and averaging over more runs (does not move a player).

**Three places where the simulator was not the game a player plays**, found
once the containers were steady and everything else agreed to the item:
- *Leftovers were tapped as they lay.* The last merges of a run drop items
  nobody has merged yet; the robot merges, then taps. Merge energy was 7%
  under, in every run. Now merged first (`settlePhaseLeftovers`,
  `mergeFirst`), a free item opening a semi-blocked one of its rank; the
  player who taps when it pays leaves those ranks unmerged.
- *Tiles opened next to the moved item's old cell too*
  (`revealAroundMover: true`, the simulator's old default; the play screens
  never did). 9% more coins in the heaviest-subsidy segment, two coin items
  under tiles the play screen never opened. The default is now false
  everywhere.
- *With tiles opening only where a merge happens, where it happens matters.*
  The simulated player merged wherever its scan found a pair; a design with
  no merge drops and reward items under its tiles then handed out a third of
  its subsidy. The careful player now merges two free items next to a locked
  tile (`mergeWhereItOpens`), as a person does; the robot makes the same two
  moves on the play engine (`careful`).
After these a careful robot collects exactly what the simulator says, reward
for reward, for the same DR, in every segment (verify-real-play section 12).

**The player who merges without looking** (`mergeRng`, `carelessMerges`).
On one build the heaviest-subsidy segment's robot paid 35-50% more DR and
collected 5-15% more of every reward; the cause was free items merged with
each other while a semi-blocked one of their rank waited - subsidy never
used. The simulator has that player now (it lands on the robot's numbers)
and step 7 shows the row. On other builds and segments it changes nothing:
it depends on the board.

**Validation** (step 7): 300 players (was 100) who each roll their own lucky
drops (`luckRng`; the build still sizes on scheduled luck), "players within
15%" per reward and for every reward at once (`nearShare`, `allNearShare`).

**Also**: the credit loop's margin in Recompletion is 5% of the segment's
demand (was 1.5%: under one energy item for a segment that spends 300 DR
there, which left it "Can be improved" with nothing to improve). Checks whose
fixtures no longer fitted were corrected, not loosened in meaning: a
Recompletion list holding more than the chase (no DR spent to measure a
credit against), "a segment that merges more gets smaller values" (now per
amount asked - with steady containers a reward sits at a few ranks), a
20-unit amount with round values (within half a rounding step, 25%).

### Twister timed on the DR spent; the strict merge rule

A written brief from the economist (prepared with another assistant) that
clarified and replaced several assumptions. In force from it:

- **Every upgrade strictly rewards merging** ("V2 > 2 x V1, V3 > 2 x V2,
  V4 > 2 x V3. Equality is insufficient."). The model's values were "at least
  double" below the top rank: 3/10/20/50 and 5/10/30/70 had been given. Now
  strict everywhere a value is generated (rewards, coins, Twister); the
  smallest whole-number ladder is 1/3/7/15 instead of 1/2/4/10. Cost: a very
  small amount on a design where every merge drops can no longer be met (the
  test of 85 merge energy alone pays 128-175 at the smallest values) - it is
  reported with fixes, as before for other floors. Typed ladders are flagged
  (`merge-step-pays-no-more`), never changed.
- **The Twister's clock is demand spent**: paid generator DR / the segment's
  DR demand, target 70-75% for the twists asked. It had been main-chain
  progress, counted at the end of the phase.
- **Investigate before changing a drop rule**, with rank-5 Twister drops an
  experiment only.

What was built: the simulator's cadence record, `twisterCadence.js`
(measuring, fitting, candidates), `scripts/analysis/twister-cadence.mjs`,
step 6's "Twister, timed on the DR spent" with the comparison, 45 engine and
13 browser checks. What was NOT changed: the drop rules, and how the build
prices a twist.

Findings (one built test event, 300 players per segment and structure,
demand 298 / 748 / 1,048 / 1,348, 15 twists; full tables in
`docs/twister-cadence-investigation.md`):
- As priced today the segments reach the twists at 79 / 65 / 86 / 74% of the
  demand; the heaviest-subsidy segment in 6 jumps of about 3 twists.
- The typical player ends the normal event at 88-96% of the demand typed and
  Recompletion at 78-86% (lucky drops) - so "100% of demand" is a point most
  players never reach. Reported, not corrected: what "demand" means is the
  economist's to say.
- Merges of ranks 5-9 are spread evenly over the spend, so rank-5 eligibility
  adds volume (twice the drops of rank 6), not earliness.
- With 6-10 finished items a phase, the moment the twists are reached moves
  in jumps of 15-30 points with the price: on the current drops half the
  segments cannot land in a 5-point window at any price. That is why the
  build's pricing was left alone until a structure is chosen.
- Twister from rank 5 with the Twister item in every rank-7 drop lands all
  four segments at 72-74% with every player within 10 points, three of four
  in Recompletion, and changes nothing else. Rank 5 with bigger items is the
  alternative that leaves rank 7 alone. Putting the Twister in half the
  rank-6 drops costs 34-41% of the coins and leaves tile rewards unopened; in
  the three-item drops it costs 32-52% of the merge energy and 4-21% more DR.
- Rejected as a fit rule: the pair closest to the middle of the window (it
  picked prices like 170 DR); kept: the simplest pair inside it. Rejected for
  the fit's smallest ladder: 1/4/10/30 from the general round-value grid;
  kept: the economist's own 2/5/12/30 scaled the way the build scales it.

### The Twister's two drop rules, demand as paid DR, the Twister fitted per segment

Two written briefs from the economist, after the cadence investigation. In
force from them:

- **Rank 5 drops exactly one rank-1 Twister item** (Twister only; the other
  rewards still start at rank 6) and **rank 7 always drops two items**, its
  reward and the Twister item. The start rank is not moved: the rank-5 row is
  marked `belowStart` and the engines roll a marked row under the start rank.
  (Rejected: lowering the start rank to 5 for the build - it is the
  economist's setting and would have made a draft out of date on apply.)
  The rank-7 rule is applied to rank 7 as written, not to every "one or two"
  rank a different setting could create.
- **Demand is the DR a player really pays.** Chase - demand is value; players
  paid 12% less than the demand in the normal event and 10-14% less in
  Recompletion (from 53% under to 56% over, segment by segment). The build
  now takes a further amount off the later boards, pass by pass, until the
  average simulated player pays the demand. The 80% merge-energy credit is
  left exactly as it was. Subsidy is never added.
- **Twister values and price per segment**, fitted on the final boards to the
  70-75% window. The older pricing (shared values, twists by the end of the
  phase, items made bigger until "on track") is no longer part of a build.

What it cost and what it found (three test events, 8 segments, both phases,
200 fresh players each - `docs/twister-validation.md`):
- Where the demand can be reached the player pays within 0.8% (normal) and
  1.7% (Recompletion) on average. It cannot always be reached, and the build
  says so: small demands, where the 80% energy credit alone takes more off
  than the free taps return (the player pays up to 22% over in the normal
  event and up to 64% over in Recompletion - nothing may be added); and small
  subsidies with a lucky generator, where the boards have nothing left to
  give (up to 33% under).
- Normal event: 17 of 24 segment medians in the window, all 24 within 5
  points. Recompletion: 9 of 24, because it plays the normal event's values
  and only its price moves.
- Bigger Twister items would put 19 of 24 (normal) and 14 of 24
  (Recompletion) in the window and bring the heavy-subsidy segments from 2-3
  twists a chance to 1-2, with other rewards at 99-101%. Not adopted: it
  makes the rank-5 item rank 2. Presented to the economist.
- A fit detail that mattered: the price search stopped after 40 price steps.
  With steps of 5 a segment that collects a lot could not be priced high
  enough and reached its twists at 64% (one at 18% with bigger items). The
  search now ends where no player could afford a twist.
- Boards regenerate at random in every pass and one set can cost a player
  far more than the next, most of all in Recompletion (656 against 1,040 DR
  on the same allocation). So "pays too much with nothing taken off" only
  counts after it is seen on two sets, and the demand margin has a 10 DR
  floor.
- The full browser run used to lose its first suites: the dev server compiles
  on first use and reloads the page it is serving. The runner now opens every
  tab, every step and the play screen first and waits for the server to go
  quiet. Nothing is retried.
- The "Keep every segment's Twister steady" switch and the "twists counted
  at" field are gone from step 4; the rules and the 70-75% target are stated
  there instead.

### No rank 1 or 2 on a Recompletion board; calibration both ways; where merge energy goes

The economist, and a third written brief.

- **"in the RC boards, there is a hard rule, no ranks 1 and 2. u keep on
  generating RC boards with rank1 and 2 in them."** True. The floor lived in
  each board's `minRank`, which the editor sets to 3 when a board becomes a
  Recompletion board - so a Recompletion list whose saved boards carried
  `minRank` 1 (an older save, an imported backup, boards made by code) was
  generated from rank 1. The floor now lives in the generator: `boardMinRank`
  (board.js) is never below 3 on a Recompletion board whatever the data says,
  `generatePlacement` raises the board's own `minRank` the same way, and the
  four places that read a board's lowest rank (the build, reward placement,
  CC management, effort targeting) read it through that. Check: 24 of 24
  boards generated from data that says "from rank 1" hold nothing below
  rank 3. Boards already generated are not rewritten: builds made before this
  are "Out of date" and a rebuild makes them anew.
- **Calibration in both directions** ("'Subsidy is never added' is not an
  economist requirement"). The calibration is signed: taken off the later
  boards, or put back - inside the energy credit first, then beyond what was
  typed, up to what each board's tiles can hold at its highest rank
  (`maxFeasibleBoardValue`) and never past the chase. Board 1, floors, pins
  and exact queue values as before. The search keeps between the calibrations
  it has already seen from both sides. The accounting is four separate
  figures (`demandFit.steps`): subsidy typed, 80% energy credit, signed
  calibration, generated.
- **A limit that is proven is told apart from a search that did not settle**
  (`demandFit.limit`). Proven: every later board at its floor
  (`no-subsidy-left`) or at what it can hold (`boards-full`). And a third
  kind, found while looking at why Recompletion would not settle: **the spend
  moves in jumps**. The same segment with the same subsidy, two sets of
  boards: 756 and 1,148 DR; another: 1,300 DR at three sets running, then
  about 800 with 13 DR more subsidy. Which items a set of boards happens to
  hold decides it (paid taps in Recompletion are x4 taps, 4 DR each, and a
  set that needs 70 more of them costs 280 DR more). No amount of subsidy
  lands in between, so a pass that halves the step again cannot either; the
  build now says so (`limit: 'jumps'`, with the two figures) instead of "did
  not settle". (Tried and dropped: one seeded stream for board generation so
  two passes would differ only by the subsidy - the jumps are in the boards,
  not in the draw. Not tried: making more sets of boards and keeping the
  closest, which is a longer build; left as a question.)
- A bound that was wrong for one afternoon: the calibration was limited to
  "never more subsidy than the chase" without counting the energy credit
  that comes off first, so a segment that needed nearly all of it back
  stopped 280 DR short (event B, Segment 1, Recompletion: 42% over; 19% over
  on the build after the correction, still not settled).
- **Where merge energy goes** (`energyFlow`: carried in, collected in play,
  collected at the phase-end collection, used on free taps, left). Normal
  event, average player over three events: 228 in play, 39 at the end, 202
  used, 66 left - 74% of what is collected is used in the phase (45% to 91%
  by segment). Recompletion: 26 carried in, 416 in play, 23 at the end, 394
  used, 71 left - 81%. The credit is 80% of energy COLLECTED (98.7% and 88.4%
  of exactly that), so it takes off more subsidy than the free taps give
  back wherever energy arrives late: the cause of the "pays more than the
  demand" segments of the round before. Energy carried into Recompletion was
  credited once, in the normal event, and is not credited again. The 80% rule
  is unchanged and nothing is capped; the calibration puts back what it
  costs.
- **Bigger Twister items without touching rank 5** (`bigger79`: the Twister
  item one rank bigger only in the drops of merges that make ranks 7 to 9,
  rank 3 at most). Normal event: timing unchanged (16 of 24 medians in the
  window against 15, 23 against 21 within 3 points, no segment further out),
  cadence better (17.2 chances to spin against 14.8, 1.12 twists a chance
  against 1.39, highest 1.9 against 3.0), other rewards and DR at 100.0%,
  board 70% full both ways. Recompletion: 12 of 24 in the window against 10,
  but two segments 10 to 13 points further out. An experiment still; the "Compare" button in step 6
  shows it.
- A first spin "at 0.8% of the demand" in Recompletion is 25 generator
  actions in, on Twister items and merge energy carried over
  (`firstSpinActions`); with nothing carried it is 35 actions.
- What it gave (three events, 8 segments, 200 fresh players; events A and C
  from the first two-way build, event B built again after the bound was
  corrected - single builds): normal event 21 of 24 segments within 5% of the
  demand (19 one way, 2 with no calibration), the three that are further off
  are proven limits; the two segments that paid over (22% and 4%) now pay 3%
  and 4% under. Recompletion 17 of 24 within 5% (19 one way on another draw
  of boards), worst 25% over where it was 64%, average distance 4.8% against
  8.2%.
- One engine check turned out to sit on the edge of the 15% margin ("with the
  build's values off, the shortfall is reported": one build paid 78% of the
  amounts asked, the next 87%, where there is rightly nothing to report). It
  now asks for clearly more than typed values can pay.

### The economy frozen; the guided flow made easier to enter, read and review

A written brief: "Freeze economy development for now. Further balancing and
gameplay changes will come from my hands-on QA. Focus this round on making the
existing app easier to configure, understand, and review." No formula, drop
rule, value, simulator strategy, calibration objective or margin was touched;
`lib/` gained one presentation file (`build/resultMatch.js`).

The app was first walked as a first visit and as a built three-segment event,
every screen photographed. What was in the way:
- Step 4 was 4,000 pixels of rules around four inputs: drop rules, rank
  values, milestones, containers and three long explanations, all open.
- After a build the page (6,400 pixels) opened on the subsidy accounting, a
  17-column container table and a 15-column Twister table. What an economist
  judges a build by - spend against demand, rewards against amounts - was a
  screen and a half down, for one segment at a time.
- Eight tabs of equal weight, one of them called "Recompletion" like the
  phase switch below it. Steps called "Segment amounts" and "Test and
  finalize"; "Estimated", "Simulation validated", "seeded validation",
  "reward factor", "pass 2 of 6".
- Step 7 had two purple apply buttons side by side, and said "Twister is not
  set up for this phase" about a draft whose Twister had just been priced
  (the panel read the applied design).
- A number outside a field's range was put back without a word. Nothing said
  that the project on screen was not saved. "Clear data" could not be undone.
  A backup left out the draft being looked at.
- The Play Tester said "the applied design" and nothing more, and showed the
  board's subsidy and rank limits as editable fields next to the game.

What changed:
- **Folded sections** (`Collapsible`): a heading with a one-line summary of
  what is in force ("Coins under the tiles (50% asked from tiles) · merges
  drop from rank 6: one item up to rank 6, two from rank 8, three from rank
  10 · leftovers are collected · every merge of a rank drops the same
  items"). Step 4: 4,040 -> 1,880 pixels. Step 6 after a build: 6,400 ->
  2,590. Rank values open by themselves when a value is missing; a typed set
  that does not reward merging is only named in the summary while the build
  sets the values (it used to put a warning in front of every first visit,
  about the reference values, while the build's own values were fine).
- **The summary leads step 6** (`BuildSummary`): one row a built segment -
  spend against demand, each reward against its amount, the twists (reached
  at, chances to spin x twists), what to look at - a verdict line and the
  next action. Unbuilt segments are one line.
- **"Close" and "Within margin" are different words** (economist:
  "Distinguish 'within accepted tolerance' from 'closely matched'. Do not
  imply a warning-free design is guaranteed to behave identically for every
  player"): close = within 5% of a reward amount or inside the build's own
  demand margin; within margin = accepted but not close; and the panel says
  these are averages of simulated players with average luck. The 5% is a
  word, this app's own, not a margin.
- **Words**: DR demand, board subsidy, reward size, Draft - not applied,
  Tested on players; steps DR demand / Board layouts / Generator (optional) /
  Rewards and Twister / Effort (optional) / Build / Test and apply, each with
  a line saying what it is for. The header: Build event, Play tester, Syntax,
  then "Advanced tools".
- **Step 7**: test on players, play it, apply it, as three numbered cards;
  one main action; "Undo apply"; the Twister panel reads the draft; endless
  mode folded.
- **Editing**: a field says why it did not take a value; a pasted column of
  demands fills down; a build shows a progress bar; the per-segment tables of
  step 4 leave out segments that are not built and say which; the reward size
  is typed in one place (step 1).
- **QA**: the Play Tester banner says draft (with its build time) or applied
  design (and whether it still matches its build) and leads back to step 6 or
  7; its side panel only picks a board. "Unsaved changes" in the header. A
  backup carries the drafts and the effort distribution, says what is in it,
  and Clear data downloads one first.
- (Rejected: a warning on leaving the page with unsaved changes - it would
  have to be answered on every reload. Not done: the advanced tools keep
  their older, denser wording.)

Tests: the suites open every folded section as it appears, so nothing they
checked is skipped; a new suite, `guided-flow.mjs` (53 checks), walks the
flow folded, as a first visit. A full run still now and then loses a page in
the middle of a suite (twice in this round, in build-event and
build-feedback, each passing when run again); no page error is logged, so the
suites now print console errors and page reloads to catch the reason next
time.

### No draft: a finished build is in use at once. The price of a twist is any whole price

The economist, after the round above: "the model looks alot better. 2 thins,
1. i dont understand the things with the draft all the time. draft vs applied.
2. the twister spin cost isnt hard on the 10, the model can give any price for
the spin to make it work". Asked as two questions with options; both answers
were the recommended one.

- **"In use at once."** A build was kept apart as a draft until Apply, so the
  Play tester and Syntax could show something other than the build on screen,
  and every screen had to say which. Now a build that can be used is written
  onto the design the moment it finishes; a whole-event build puts both phases
  in use together. What was there before is kept, so step 7 has "Go back to
  the previous build" (one step: the boards, and the build before with its
  results). A build that needs a fix is never put in use. The words draft,
  apply and applied are gone from the main path ("In use" / "Not in use");
  step 7 is "Test and export". "Not in use" is left for the cases where a
  build and the boards really differ: results kept from a session whose
  boards were not saved, a backup, boards edited by hand - with one button,
  "Put this build in use".
  (Rejected: keeping the check before use under a simpler name - the
  economist chose not to have it. Kept: a build is still a separate object
  internally, and "in use" is still read off the design, so nothing can claim
  to be in use that the boards do not carry.)
- **Any whole price.** A build read the Twister plan's price step, so a 10
  typed in an earlier round kept rounding prices and pushed twists out of the
  70-75% window. A build's step is now 1 unless rounding is switched on by
  typing a step in step 4's fold; a step saved before the rule is not used.
  Opening a project that carried a 10 re-prices its last build by itself (the
  price follows its inputs, as it always did when the twists changed).
- Tests: the suites that applied a draft now check that a build is in use
  when it finishes; `guided-flow.mjs` also builds twice and goes back, and
  checks that no screen of steps 6 and 7 says draft, apply or applied.

### A bank of board layouts, and the two rules of a first board

The economist: "another thing ill want us to insert into the model, is some
board suggetsions, mostlly its important for the first board. the rules for
any board is that the rank2 we got in the first board should be hardcoded into
the board in any time, and the 2 cells in the rightest columnin the bottom of
the column should always be empty. those are used in the tutorial of any board
in the game itself. i need boards that the simulator can ofc solve. if he cant
solve, check why and fix, i nthe board layout ill just pick from the bank of
boards which one we will use this time".

- **The two tutorial cells.** The rank-2 cell was already forced. Now the two
  bottom cells of the rightmost column of the normal event's first board are
  always empty too: every layout edit keeps them open and unpinned. Read as
  the normal event's first board only (Recompletion's first board has no
  tutorial; later boards push in from the top and never cover those cells).
  A first board saved before the rule is not rewritten - step 2 shows a
  warning with "Empty these two cells". (Not done: blocking a build on it.)
- **The bank**: 12 first boards (two rows, row and a half, stairs down, stairs
  up, pyramid, frame, columns, checker, corners, showcase, diagonal, islands)
  and 6 later boards, as pictures in step 2. Picking one draws it; "Undo"
  restores the layout from before with what was built under it.
- **Solved by the simulator**, checked rather than assumed
  (`verify-board-bank.mjs`): each first board filled at 150, 100 and 60 DR
  (exact every time, rank 2 on the fixed cell, nothing on the tutorial cells),
  played alone and ahead of two later boards at three subsidies, played as
  Recompletion's Board 1, and built once for real with rewards and a Twister
  (all "ok", every simulated player finishing, paying 538-556 of a 548 DR
  demand - single builds); each later board played as Board 2 and 3.
- What did not hold, and what was done: two first candidates with 7 blocked
  tiles could not hold Board 1's 150 DR exactly under its small-item rules
  (dropped; the smallest has 10). At a subsidy of 1,900 of the 2,048 DR a
  lucky player made rank 12 before the last tiles opened (1,644 of 1,900 DR
  opened behind the "arch" later board) - a finished event that did not need
  all its subsidy, not an unsolvable board, so at that subsidy "solved" asks
  for the top rank on every board and full opening is asked at the moderate
  subsidies, where every layout opens every tile in every play.

Three rounds on the bank followed, each a remark of the economist on the
boards themselves:
- "the boards are not the best. they should have a bit more tiles i guess like
  the amounts we are seeing the main board now, becausse we are looking for a
  good amount of rank1 in them as we know. and also, we need some semi blocked
  on the board. we take into account that the players are rather not so smart,
  and we should guide them to where to merge on to reveal more tiles." The
  first bank had 11 to 20 tiles and one board with semi-blocked tiles. Every
  first board now has 20 to 24 tiles (8 to 10 rank-1 items at 150 DR,
  measured) and two or three guides: semi-blocked tiles with at least two
  blocked tiles beside them, so the merge into the item in sight is the one
  that opens more of the board. On Board 1 a guide holds a rank 1.
- "u are creating only boards who are weighted down with gravity, can u crete
  also ones that are hanged up?" Boards hanging from the top were added, and
  the picker shows three groups: standing on the floor, hanging from the top,
  sides.
- "the boards that looks like htey have holes in them, i dont like those. we
  need boards that doesnt look like they were a mistake." Eight boards went:
  those with a lane between two blocks, tips with space between them, an
  opening under an arch, points above a row, and a fixed cell standing alone.
  The rule they broke is now written down and checked: one piece, no gap in
  any row or column (`isSolidShape`). The simulator had solved all of them -
  they were dropped for how they look.
The bank was then 16 first boards (7 standing, 6 hanging, 3 along a side) and
9 later boards.

A fourth round: "when we are creating boards we need to look at the 2 putple
tiles as empty, we need to see the boards only with the tiles on them. i want
them to be simetrical to the eye. also in the diagonal up we got 4 in all the
rows except 5 in the bottom one, thie is not simetrical".
- The boards had been drawn full to the right edge except for the two
  tutorial cells, which the picker outlined in purple: read with those two
  cells as tiles they looked even, read by their tiles alone they were
  lopsided. A board is now judged by its tiles alone (`symmetryOf`): the left
  half mirrors the right, tiles and items in sight alike. The mirror cells of
  the two tutorial cells, at the left edge, are empty too - so a board that
  stands on the floor is six tiles wide in its two bottom rows, centred.
- The fixed rank-2 cell sits right of the middle; a guide now sits on its
  mirror cell, so the two items in sight are a centred pair. Every first
  board has three guides (it was two or three).
- The three boards along a side (steps, a block against a wall) cannot be
  symmetrical and went. One diagonal stays: a band of four tiles in every
  row, the same turned half a circle.
- The picker draws the tutorial cells as the empty space they are (the big
  grid under it still marks them "empty", because painting them does
  nothing and that has to be said somewhere).
The bank is 14 first boards (7 standing, 6 hanging, 1 diagonal) and 9 later
boards, each with 20 to 24 tiles and 8.3 to 10.7 rank-1 items at 150 DR; 69
engine checks hold the rules and the solving, and every board was built once
for real again ("ok", single builds).

Then: "do we havea good idea for a boad layout for black friday ?" Nothing in
the bank was drawn for an occasion. Four shapes were tried against the rules
and the simulator before anything was added - a gift box (bow, wide lid, box),
a price drop (an arrow pointing down), a sale sign hanging from its nail, and
a gift floating above a free floor - and all four held: symmetrical, one
piece, 20 to 22 tiles, three guides that open three tiles each, 150 DR exact,
8.3 to 9.0 rank-1 items, 30 of 30 plays solved, each built once for real
("ok", paying 538 to 552 of a 548 DR demand - single builds). What the rules
leave no room for was said too: a bag with a handle loop and a price tag with
its hole (a hole), a cart (lopsided), letters. The recommendation was the gift
box; the economist: "lets try to enter all for now, ill try to see them in the
model it self". All four are in the picker as a fourth group, "Black Friday",
on trial - nothing has been chosen. The bank is 18 first boards and 9 later
boards; 78 engine checks.

### Text laid out gracefully

The economist: "we have i nthe app some layout and formating problems with how
the text is displayed. lets try making hte app handle that gracefully". Rather
than fix what happened to be noticed, every screen was measured: a script
opens the seven steps (with a built event and every folded section open), the
Play tester, the Syntax tab and the advanced tools at 1280 and 1500 px and
lists text that is cut, squeezed, spilling or stretched. First run: 296
places.
- The Syntax tab was 2,105 px wide in a 1,280 px window: its sixteen sheet
  buttons sat on one line in the card's header. The Twister tool was 1,474 px
  wide: its page could not shrink below its widest table. (Card headers wrap;
  tool pages may shrink, and a wide table scrolls inside its own box.)
- 76 table cells were squeezed to a word a line. The containers table had
  "Weight, merges making rank 5" as the head of every weight column, which
  left 56 px for "What it drops"; the Twister table had fifteen columns each
  under a sentence. Both now have one group head and short column heads, and
  the Twister table's note is a line of its own under its row. At 1,280 px
  the Twister table fits without scrolling.
- 32 fields showed less than their text (the "15 (as base)" hint in step 4;
  the syntax and asset fields of the Rewards tool).
- 54 explanations ran 150 to 216 characters a line. Running text now stops at
  about 105 characters.
- Two formatting slips in the Twister table: "1 points early", and a sentence
  that began with a lower-case "with".
After: none in the main path. Left, and listed by the suite rather than
failed: two wide tables in the advanced tools scroll inside their own box at
1,280 px, and four placeholders there are cut. The audit is kept as a browser
suite (`text-layout.mjs`, 10 checks).

### A lighter app: five steps, one menu, less scrolling

The economist: "u will give suggestions of things that u think are not needed
and can be handled without them in the app, the app is very heavy in text and
buttons." Every screen was measured as a first visit finds it (words, buttons,
fields, with the folded sections folded) and 31 things the app could do
without were listed, as suggestions. The answer: "i use only the builder as
for the last runs. lets go with ur suggestions".

What a screen held, before and after (a 1440 px window, a project of three
segments; the two screens that were steps of their own are gone):

| Screen | Words | Buttons | Fields |
|---|---|---|---|
| Header (on every screen) | 46 -> 19 | 24 -> 11 | |
| DR demand | 366 -> 265 | 43 -> 24 | 41 -> 16 (7 once the demands are typed) |
| Board layouts | 629 -> 475 | 42 -> 27 | 8 -> 2 |
| Generator (was step 3) | 326 -> a folded section of step 1 | 36 | 9 |
| Rewards and Twister | 604 -> 462 | 37 -> 21 | 8 -> 8 |
| Effort (was step 5) | 275 -> a folded section of step 4 | 37 | 13 |
| Build, after a build | 926 -> 512 | 38 -> 22 | 1 |
| Test and export, after a test | 719 -> 331 | 40 -> 23 | 1 |
| Play tester | 318 -> 177 | 37 -> 24 | 1 |
| Syntax | 253 -> 189 | 64 -> 16 | 6 -> 2 |

About 35 of the 40 buttons on every step had belonged to the frame, not to the
step: that is where most of it went.
- **The frame.** One "More" menu holds the project actions and the five
  advanced tools (an open advanced tool shows as a tab while it is open); the
  bar keeps Build event, Play tester, Syntax, Share stage and Save. The
  segment bar and step 1 show the segments in use - a demand or DR on the
  boards, a name of its own, the one selected - and "Add segment" brings in
  the next; nothing is removed from a segment out of sight. The app's subtitle
  and the sentence repeated over every step went; a step says what it is for
  once.
- **Seven steps became five.** The generator, lucky drops, dates and CC are a
  folded section at the bottom of step 1; the effort shape is a folded section
  of step 4, beside the Build button. Every "step 4 / 6 / 7" written on a
  screen, in a comment or in a check was renumbered (about 150 places).
- **Step by step.** Step 1: one line for the two terms, the per-board subsidy
  in a section that opens by itself when boards were typed by hand or do not
  add up. Step 2: the bank first, "change tiles by hand" folded (open when the
  board was drawn by hand), size, rank limits and onboarding folded, the board
  table down to board, layout and tiles. Step 3: no "price of a twist now"
  column, one sentence for the three read-only boxes, no containers section
  (the build results show them). Step 4: the readiness list only when
  something is missing, one Build button with "one phase only" a click away,
  "in use" said once, the segment in detail folded while there is nothing to
  look at, the meaning of Close / Within margin / Off target in the chips'
  hovers - the sentence that the figures are averages and one player differs
  from the next stays on screen. Step 5: three buttons, the table of the four
  kinds of player folded (open when a tap pays more than a merge), no door to
  the Twister tool, no second link to the Syntax tab. Play tester: the rank
  list folded, the helper lines behind an "i", no empty charts. Syntax: no
  board list beside it, the seventeen sheets in a dropdown, one pair of export
  buttons with a "This segment / All segments" switch.
- **Two things done differently from the list**, said at the time: the CC
  fields were not removed from the generator section (the CC tool that also
  holds them is out of sight now, so removing them would have left CC behind a
  menu), and the Play tester's rank list was folded, not removed (it is the
  only place that shows the DR spent at each rank).
- Then, of the board table: "the most DR it can hold in the boards layout is
  useless" - the column went.

**Less scrolling.** With a screenshot of step 1 using a third of the window's
width: "maybe we can find a layout for all the pages that it will still look
good but will make me scroll as minimum as possible. also, when using the go
to the next page button in the right lower part of each page, i think it
should take me to the top part of the page and not make me scroll up". A step
now opens at its top. The pages were measured in a window like the
economist's (1500 x 800, a project of seven segments) and laid out to use the
width: step 1 has the demands beside the two folded sections, step 2 the list
of boards beside the picker (whose short groups share a row), step 3 the
amounts beside the Twister; folded sections sit two in a row and one that is
opened takes the full width; table rows are lower; the frame is two rows,
never three. Page heights, before -> after: step 1 1,005 -> 800 px (one
screen), step 2 1,643 -> 1,045, step 3 1,651 -> 1,062, step 4 after a build
1,777 -> 1,376, step 5 after a test 1,353 -> 1,065, Play tester 1,334 ->
1,308 - there the point was another one: "Spend generator" was below the
first screen and now sits beside the board with the tiers and the Twister.
What is left is content: seven segments' rows in the build summary, eighteen
pictures in the bank.

**What the checks found on the way.**
- A check of the advanced Twister tool had been passing or failing by the
  build's draw: a price taken from a build's boards was called "not the
  configuration selected here" when looked at as the event in use, although
  with "in use at once" they are the same boards - unless the build happened
  to re-price it in between. The tool now recognises a price taken from
  exactly the boards selected, whichever name they were measured under.
- Two checks depend on the build's draw and are written down for QA, not
  loosened: build-event's "the residual ... is only rounding (within 4 DR)"
  (failed in one full run, passed twice alone), and twister-timing's "the
  other rewards measured beside it" for the bigger-items experiment - one
  build of a full run gave 100 / 100 / 109 / 105 against 100 each when run
  alone, twice. The second matters for the open question of that experiment:
  "the other rewards do not move" held on the three test events, and one
  build here moved merge energy by 9%. A third check (a container's weight at
  the highest merge rank can be 0) read only that one cell and now reads any
  of the container's weights.
- The browser suites reach the advanced tools and project actions through the
  menu, bring a segment into sight before typing into it, and pick a sheet in
  the dropdown (helpers.mjs). The first-visit suite was rewritten for the new
  screens (83 checks).

### Pass marks for DR usage and for the Twister

The economist, in the same hours: "we can insert margins for the segments the
pass the checks on the segments. as for DR usage. we can give 5% or 30DR (the
smaller one for the segmet) for DR usage, also, up to 5% margin for the
twister finish. give me suggestions if u think we need more margins". What
existed was laid out first: DR spend passed within 2% (4% in Recompletion, at
least 10 DR) - this app's own number, and also what the build aimed at; the
Twister's 70-75% window had no margin at all and never failed a segment;
rewards 15% / 25% (the economist's). Three questions were asked back, with
options:
- What the Twister's 5% is measured in: **points of the DR demand** on each
  side of the window (65-80% passes) - not the number of twists, not both.
- Recompletion: **the same marks in both phases** - not 25%, not "normal event
  only". (Said with the question: Recompletion spend moves in jumps between
  sets of boards, so it will often miss.)
- More margins - a finish rate, how many single players land near, "15% or
  one smallest item" for small amounts: **"None for now"**.

What was built:
- **DR usage**: a segment passes when its average simulated player pays the
  demand within 5% of it or 30 DR, the smaller (`demandMarginFor`). The build
  keeps aiming as closely as before and never more loosely than the mark, so
  three words still mean three things: Close (inside the aim), Within margin
  (inside the mark), Off target (outside it - the only case that gives the
  segment something to look at). A demand of 548 DR now passes within 27 DR
  where it passed within 11; under 200 DR the mark is tighter than the old 10
  DR floor, and over 1,500 DR it is 30 DR, tighter than 2%.
- **The Twister**: a segment whose typical player reaches the twists more
  than 5 points outside the window (or never) now reads "Can be improved",
  with the distance and the margin in words; inside the margin its chip reads
  Within margin. Typing other twists prices them again without a rebuild, and
  the mark follows: the cause is put on or taken off at once. This is new for
  Recompletion in particular, where the twists land in the window in about a
  third of the segments: more of them will now say so.
- A build made before the marks is told it is out of date (the rules of the
  build changed), like every earlier change of rules.
- Engine checks hold both marks at their edges (65 and 80 pass, 64 and 81 do
  not; 575 of 548 passes, 576 does not), that a cause is put on and taken off,
  and that a spend between the aim and the mark gives no cause.

### "i cant understand what that means": a segment that lost its own rank values

The economist sent a picture of step 5: "The applied design is not ready to
export as finished - Segment 6, Normal: changed since it was built: reward
definitions or drop rules - so the boards are allocated for an energy income
they no longer have", the same for Recompletion, a disabled download and "The
build on this page is NOT in use". And: "i cant understand what that means".

Two things were wrong, and the warning itself was not one of them: it was
right to stop the export.
- **The cause.** A rank the build re-values remembers what was typed, and that
  mark was what told a segment's own values apart when Segment 1's settings
  are copied to the other segments. A build that gives a segment EXACTLY the
  typed values - merge energy 5/15/35/75 for a segment whose amount needs a
  top value of 75 - changes no rank and leaves no mark, so the copy replaced
  that segment's values with Segment 1's (reproduced: 5/15/35/75 became
  10/30/70/150). The segment's boards had been built for other values: its
  stamp no longer matched, in both phases, and the build was no longer what
  was in use. Typing other twists for one segment was tried first as a cause
  and ruled out (the build stays in use). The copy now keeps a segment's
  ladder whenever the typed definition is the same on both sides, marked or
  not; values typed anew on Segment 1 still reach every segment. Not a change
  to any formula or value - the build's result is now what is stored. A
  project caught by it is put right by building again.
- **The words.** The warning now says: "The event was changed after its last
  build. A download would hold boards that no longer match what was built for
  them. Build again and they are in line." - then, per segment, what changed
  ("reward rank values or drop rules changed after the last build"), a "Build
  again" button, and "Download anyway - I know these boards do not match their
  last build."

### A second pass on the Build step: what to look at stays in sight, the detail folds

The economist: "keep on another run to check what can be done even better."

With the Twister's pass mark a segment could be flagged for a reason that has
no quick fix, and the selected segment's whole detail - opened by itself
whenever a segment had something to look at - made step 4 **2,321 px** tall
on the seven-segment project (1500 x 800 window). A problem must stay in
sight; its 900 px of tables need not.

- **`segment-causes`**: a small panel under the summary, "{segment}: what to
  look at", holds the causes of the segment shown, each with its fixes. It is
  there only when there is a cause.
- **The segment's detail never opens by itself** (`build-segment-{phase}`,
  `data-testid="segment-detail-fold"`). "Show the detail" in the summary opens
  it and scrolls to it.
- A Twister cause no longer says its first sentence twice (the row's message
  repeated the cause's title), and an action label has no full stop.

Step 4 after a build is **1,562 px** on the same project (single build; 1,376
before the pass marks existed, when that project had no cause to show).
Checked in the browser: guided-flow 84, build-event 125, build-feedback 88,
twister-easy 44, each run alone.

### The shortest stage link

The economist: "i also want u to make sure the link of the stage as short as
pobbisle."

**What a link was.** Format 2 wrote each list as JSON by field name - what
its boards share once, each board's own fields - gzipped, in base 62. A built
event with three boards, three Recompletion boards, rewards, drops and a
Twister was **2,339 characters** after the address (15,346 bytes of JSON,
1,740 gzipped).

**What play reads.** A robot played the real play engine (normal event,
Recompletion, endless) on boards wrapped so that every field read was written
down. The engine reads, per board, `name, rows, cols, tiles, semiPlacements
(row, col, rank), blockedQueue`, and for the list the reward values
(`prizeAmount` only), what each container drops and whether the build made
it, the weights per merge rank with their `noDropWeight` and `belowStart`,
the four drop ranks, the leftover rule, the lucky-drop EV, the two generator
ranks, the price of a twist and the spin objective. The play screens add one
thing the engine does not read: `rewardRanks`, the marks on the ranks bar -
found by reading the screens, not by the robot. Nothing else is needed: the
player's side back-fills every other field (`normalizeBoards`), and gives
every board of a list its first board's shared settings anyway.

**Format 3** (`stageShare.js`), each step measured on two built events (the
second with other layouts, demand and amounts, four boards a phase):

| | event 1 | event 2 |
|---|---|---|
| format 2 | 2,339 | - |
| only what play reads, by position, numbers | 449 | 520 |
| ...items, items in sight and containers as one character each | 392 | 446 |
| ...one number a merge rank where one container always drops | 366 | 419 |
| ...read against a dictionary | **227** | **272** |
| the normal event alone | 145 | 172 |

- **By position**: a list is `[settings, values, containers, weights,
  boards]`; a board `[name or 0, rows, columns, tiles, items in sight,
  queue]`.
- **One character an item**: a main-chain rank is its base-36 digit, a reward
  item a capital letter worked out from its number (1000 + 10 x reward +
  rank). Tiles are `o`, `b`, `s`. An item in sight is row, column, item.
- **Containers** are strings of reward digit and rank digit, in the
  container's own order. The order is kept on purpose: it is the order the
  items land on the board in, and the first version, which wrote a container
  as five positions, changed it.
- **Weights**: `-1` nothing drops, a number = always that container (steady
  containers), else the full row.
- **A dictionary** (`STAGE_DICTIONARY`, 3,213 characters): the 27 layouts of
  the bank as this writing spells them (a first board with its items in
  sight), the round value ladders a build gives, typical containers, tables
  and settings. Raw deflate at its highest level reads the link against it
  (`encodeCompactToUrlParam`, marker letter `B`), which also drops gzip's 18
  bytes of header and checksum. A check number inside the link stands in for
  the checksum.
- **Not worth it, measured**: writing "as the normal event" where
  Recompletion repeats it (deflate already does: 250 against 246).
- **The address** is `?s=` in place of `?play&stage=`: nine characters less.

**Frozen.** The dictionary, the order of the five rewards, the letters and
the positions can never change: a link made today has to open for as long as
links are opened. A new dictionary is a new marker letter and a new format
number, with this one kept for reading. `verify-stage-link.mjs` holds a link
written down on 22 November 2026 and the dictionary's fingerprint.

**What still opens**: format 2 (`A...`), the base64url writing (`H4sI...`),
a bare list of boards, and the address `?play&stage=`. A stage with something
the short writing has no place for (a rank over 35, a reward it does not
know) is written in format 2.

**A link changed on the way** reads as broken, never as another stage: every
character of a link was swapped three ways and dropped once (738 and 245
links), none opened as another stage.

**Checked.** `verify-stage-link.mjs`, 29 checks: the link of the day, every
item's character, a built event short and for play the same stage - a robot
plays the stage and its link to the same last item through Recompletion and
endless, three kinds of player - every older writing, the fallback, a changed
link. A built event is 246 to 260 characters there (single builds).
`verify-real-play` (70) already played its event through the link, with the
simulator on the same boards, and passes. One check in `verify-v2-rewards`
looked for a container by its editor id, which a link no longer carries; it
now looks at what the container holds. In the browser: audit-fixes opens the
link made by "Share stage" as a first visit, behind both addresses (15
checks; the link is 190 characters with the address for two built boards);
play-mobile 47, play-motion 37, real-play 40, small-rewards-play 31,
twister-play 42, endless-mode 56.

**A link in this writing opens only on a site deployed with it.** Until a
deploy, "Share stage" makes links the live site cannot read.

### The Chef flow: the Merge logic applied to Chef

The economist: "ill want u to give an over view of all the chef feature in
this app. of everything we got, befor writing the overview i want u to apply
the logic of how we build the merge also to the chef. the flow and etc. the
promp ull give me iwll be sent to GPT for future tasks."

**What Chef was**: nine flat tabs (Ingredients, Dishes, Baskets, Calendar,
Segments, Blocker sources, Validation, Simulation, Basket value) in a
1,152 px column, every project action in a bar, cards for everything. In a
1500 x 800 window: Dishes 1,702 px, Baskets 1,722, Basket value 1,567,
Segments 1,153, Blocker sources 1,085, Calendar 1,030.

**What it is**: five steps in the order of the work - Event and players,
Ingredients and dishes, Baskets, Simulate, Basket value - each saying what it
is for, "Next" opening the next at its top, at the app's full width.

| Step | Height, first visit | Was |
|---|---|---|
| 1 Event and players | 800 (one screen) | Calendar 1,030 + Segments 1,153 |
| 2 Ingredients and dishes | 1,062 | Ingredients 957 + Dishes 1,702 |
| 3 Baskets | 951 | Baskets 1,722 + Blocker sources 1,085 |
| 4 Simulate | 800 before a run, 1,273 after | Simulation 800 before a run; 9 cards after |
| 5 Basket value | 810 | 1,567 |

- **Tables in place of cards** for what is typed: segments, phases,
  ingredients. One phase of baskets in view, its three side by side.
- **Folded**: the dishes as cards; sales and events; where each blocker comes
  from; what a run plays; day by day; all segments on one chart; a segment
  dish by dish; the two what-ifs; the list of checks; what one ingredient
  counts for.
- **The checks are no longer a tab.** A finding carries the step that puts it
  right (`step` in `chefValidation.js`), is shown at the top of that step,
  never folded, and counted on the step's button; the Simulate step lists
  what needs a fix with a link to its step, and the whole list is a fold
  there. Their words are the economist's: "Epic basket, Phase 2", an
  ingredient's name, "Needs a fix / Worth a look / Good to know".
- **One button to simulate**, a line saying what it plays, a progress bar.
  After a run one row a segment leads. The words are plain: the middle
  player, most players, simulated players, the same players every run.
- **A run is kept for the visit, per chef, and marked "Out of date"** once
  the chef has changed - not dropped, not shown as current.
- **The header**: name, "Unsaved changes" / "Saved", one "More" menu, Save.
- **A number is taken when its field is left** (`Num`). The fields reported
  every key before, so "0.25" could not be typed in one go: "0." became 0.
- **New, because a blank chef could not be finished without them**: adding
  and removing a phase (its baskets go with it), typing the prize for cooking
  every dish, "Add a basket" giving the first type the phase lacks, and a row
  for every ingredient in every basket (one added after a basket was made had
  no row there, so it could never be given a weight in it).
- `Collapsible` moved to `src/components/ui/` (the Merge flow re-exports it);
  the low-row and line-length rules of `index.css` hold for `.chef-app` too.

**Two bugs of presentation, fixed.** The day-by-day basket value chart was
blank: its day columns had no height, so every bar was 0 px (63 bars of 46 to
160 px now). The "more or fewer baskets" chart had the same fault.

**Two limits of the model, found by measuring, said on screen and not
changed** (the model is the economist's; `verify-chef.mjs` section 8 holds
both as they are):
- **"One more basket" is noisy.** Its two plays share players and days of
  play, not the luck of the baskets after the extra one. Halloween, 300
  players: one more basket that gives nothing moved the average prize by
  0.63; one more Basic basket on day 1 gave +3.4, +3.9, +3.5, +6.4, -0.6 and
  +2.4 on six sets of players. Step 5 says the figure is rough, before it is
  run. A stream of its own for the extra basket would fix it.
- **An activity shape other than Flat changes the number of baskets**: over
  Halloween's 21 days a slow start -5.7%, a fade -8.6%, a weekend boost
  +8.6%. Step 1 shows the figure beside the shape.

**Checked.** `verify-chef.mjs`, the feature's first engine checks (56): the
two real chefs, the checks' steps and words, a basket roll's rules over 2,400
rolls, the same players giving the same result, the order of a run's
figures, more baskets and sales never cooking fewer dishes, the what-ifs, the
basket value, the two limits, backups and removing an ingredient.
`chef-flow.mjs` in the browser (104), as a first visit at 1500 x 800 and at
1280: the steps, the menu, typing, Next, each step, a run and its folds, out
of date, the charts drawn, several chefs, a backup out and in, the copies, a
new ingredient, the Recompletion round, no step wider than its window. `docs/chef-overview.md` is the feature's description and the
brief for whoever takes tasks on it.

**A crash in an old check, found by the full run.** `verify-event-build` stopped
a full engine run with a TypeError, not a failed check: "the values are whole
numbers, each segment its own" read the record of a re-valued reward on every
segment, and a segment the build gives exactly the typed values has none (the
same fact that made a segment lose its values in the round before). It only
shows on a draw where that happens - the suite had passed three times that
day. The check now reads the typed values for such a segment.

## The Twister's syntax in the V2 Reward Chain sheet

Economist: "it looks like we are missing in the config the twister value in the
reward chain." The V2 Reward Chain sheet wrote each rank's typed syntax as it
was. Nobody types one for the Twister (its values come from the build), so its
four "Item syntax" cells were blank, while the Small Rewards sheet already
wrote them as `[dynamic(dr-twister:N)]`. The reward chain now uses the same
`twisterSyntaxFor`: the typed syntax, else the amount in that pattern
(`dr-twister` is still this app's own, unverified name). The amounts in the
"Prize amount" column were always there; nothing in the economy changed.
Held by verify-containers and twister-workflow.

## Recompletion's effort chart; only the economist's pages in the output

Economist: "i want to be able to see the effort distribution on the RC also.
and in the output. we got alot of pages that werent given to u by me in the
example u can remove them. and remove the naming of V2 from the pages in the
output."

**Recompletion's effort.** Step 4's chart for a Recompletion build played the
normal event and Recompletion together and drew ranks 1-12 only: every one of
them was reached in the normal event, so Recompletion's climb (a second rank
12, then 13 and 14) never showed, and the shares were of the whole run. The
simulator now also records, from the moment Recompletion begins, the paid DR
when the player first MAKES an item of each rank there - by a merge or from
the generator (`rcEffort`). What is only seen does not count: items carried
in from the normal event (the rank 12 among them) and items on the board
(`recordSeen`, used by every board scan). The chart draws ranks 1-14 with
Recompletion's spend, the subsidy that reaches the player and the boards
reached in Recompletion, and rank 14's cost. On a small hand-made stage the
second rank 12 sat under a tile and was merged into, never made, so rank 13
was counted from zero and the shares came to 150%. On a real build (single
build) a late generator tap made rank 1 after rank 11 existed, and the chart
showed rank 3 at "-136 DR, -12%". So Recompletion's chart is read as a climb
(`buildClimbRows`): a rank is part of it when no higher rank was made before
it, and costs what was paid since the last rank of the climb - never
negative, 100% at rank 14. A rank made after a higher one is shown with its
moment and no cost; the step says which. The normal chart is unchanged.
Nothing the simulated player does changed: `reachedAt` is recorded exactly as
before. Held by verify-twister-cadence (section 7c) and build-feedback.

**The output.** Asked which pages stay (the price of a twist was only on "V2
Twister"), the economist answered: "remove the V2. u can keep the endless
ones. but, remove the reward chain, drop groups, twister, and economy. in the
small rewards page is where we should see the asset", and to keep the
Segments page of the all-segments export. So: V2 Reward Chain, V2 Drop
Groups, V2 Economy and V2 Twister are gone from the Syntax tab, both
workbooks and both Google Sheets exports; "V2 Endless" is "Endless". The
price of a twist is no longer exported (said in CLAUDE.md's open questions).
Small Rewards already carries each reward's asset; the Twister rows have none
(none was ever given). The "Rewards (V2)" advanced tool keeps its name: it is
a tool, not an output page.

## The Twister's asset

Economist, with a picture of their sheet: "we are missing the assets of the
twister" - the four Twister rows of Small Rewards with the asset
`merge-config-twister-v2`. It is now the Twister's asset on all four ranks
(`TWISTER_ASSET` in rewardChain.js): a new project has it, and a project saved
without it gets it when opened (`ensureRewardChainConfig`); an asset typed by
hand is kept. (The note above, "the Twister rows have none", is history.) The
same picture shows the charm asset as `merge-config-mfcharm-v3`, where this
app's seed has `merge-config-mfcharm-v2`: asked, not changed.
Held by verify-containers and verify-twister.

**All assets are v3.** Asked whether the charm asset should be v3 as in the
picture, the economist answered: "all should ve v3". Every reward's asset is
now v3 - merge-config-coin-v3, -dr-v3, -puzzle-v3, -mfcharm-v3, -twister-v3
(the reference example still says v2; the economist's answer wins). A project
saved with the v2 names opens with v3 (`ensureRewardChainConfig`,
`OLD_V2_ASSETS`); any other asset typed is kept.

**The Twister stays v2.** Economist: "the twister should have v2 and not v3".
The Twister's asset is merge-config-twister-v2; coin, dr, puzzle and mfcharm
stay v3. A project saved with merge-config-twister-v3 (possible for the few
minutes the earlier deploy was live) opens with v2.

## Saved events

Economist: "i want to be able to save full events in the app. is it possible?
like to save the events in the specific time frame". Asked where they should
live and how they are found; chose "This browser" and "By dates, newest
first". "Saved events" in the "More" menu is a list of whole events, each
holding exactly what a backup file holds, kept compressed in this browser
(`lib/state/savedEvents.js`), named from the event's dates and sorted newest
first. Save as new, Update the open one, Open (asks first over unsaved
changes), Rename, Download as a backup file, Delete. The header names the
event open. The browser's room is a few MB in all: when it is full, saving
says so and overwrites nothing. Held by `scripts/e2e/saved-events.mjs`
(12 checks).

## Chef rebuild, build 01: an accurate event model and simulator

The economist sent a brief (written with GPT, the direction approved by them):
"CHEF REBUILD - BUILD 01: ACCURATE EVENT MODEL AND SIMULATOR". Replacing the
older model was authorised; older chefs had to stay recoverable; no commit or
deploy. Builds 02 (suggestions) and 03 (automatic catch-up presets) come later.

**What was replaced.** The older Chef played each dish list as an event of its
own from day 1, with one "demand cap" nothing read, a single prize number a
dish, three prize sizes, grants, and four random streams shared by a whole
run. The rebuilt one (schema 2, `chefModel.js`; one rule engine,
`chefEngine.js`) has: three separate limits on an ingredient (pantry cap,
progression threshold with a schedule, most a basket); baskets that leave out
an ingredient held back and keep their size; FU as a state (one dish left,
only blockers missing, the threshold reached), with in FU / ever in FU /
finished told apart and a target day; checkpoints; special sources and jokers
with an explicit permission to pass a threshold; manual catch-up presets that
take a basket's place; Recompletion entered the moment Main is done, with the
pantry carried and the count restarted; prizes by component with the
segment's factor (prize factor x burnout, free rounds and undos capped at x2,
wilds and extra stock unchanged, the grand prize to the nearest 5); segments
typed in full, supply as an average or day by day; keyed random streams, so a
change moves nothing but what it changes.

**Found on the way.**
- The older simulator's days-of-play chain was wrong: an inactive player came
  back with the chance of STAYING away, so players opened about 11% more
  baskets than was typed (measured: 89.0 Basic against 79.8 expected, 1,500
  players). Fixed: with 6,000 players the supply now lands within 0.1%.
- An activity shape used to change the total (-5.7%, -8.6%, +8.6%); it now
  only moves baskets between days.
- "One more basket" used to shift the luck of every later basket; it is now a
  clean paired comparison (a change that changes nothing gives identical
  players; one more basket on day 2 leaves all the other baskets of the event
  rolling exactly what they rolled).
- Copying the sheet's "Cap" into the pantry caps makes a Halloween
  Recompletion dish impossible (it needs 22 Pumpkin, the cap is 20): the
  sheet's "Cap" is probably not a pantry cap, or the Recompletion list is
  from another design. It is kept beside the ingredient and not played.
- The base Halloween Main recipes ask for 378 ingredients against a reference
  of about 250.

**Not invented.** A chef from the workbooks or from an older save starts with
no thresholds, Dish Master days, FU day, jokers, presets, pantry caps or
burnout; a note on screen says so. Dish prize components were read from the
workbooks' prize sheet (identical in both); a save whose prize numbers differ
keeps its numbers, counted as coins. The workbooks' own medium / high prize
columns were not reused (they scale wilds). Eight things about the real game
are not confirmed and are visible settings (chef-overview.md, section 9).

**Removed.** "What it would take" (a search on the averages model) and the
averages model itself. The older basket estimate is kept, labelled as one.

**Checked.** verify-chef.mjs: 133 checks, one or more per confirmed rule.
chef-flow.mjs: 92 checks in a real browser at 1500 x 800 and 1280. Lint and
build clean. Heights of a first visit at 1500 x 800: step 1 902, step 2
1,233, step 3 1,057, step 4 800 (1,341 after a run), step 5 864. The Merge
suites were not run: nothing of Merge or of the shared components changed.

## Chef build 01, reviewed: the cases checked one by one, and a reference chef

A second brief asked to verify build 01 against named cases before build 02,
to fix confirmed bugs, and to prepare a reference-event workflow. The concerns
were verification requests, not claims; each was measured first.

**Already right (no code changed).** Fractional supply (0.4 Epic a day: 8.404
a player over 21 days against 8.4 expected, every player 8 or 9, never none;
with player activity 8.54 +- 0.07 on one set of 3,000 players and no bias
over 12 sets of 5,000 - on average 0.2 standard errors off); FU at and past
the threshold (at 7 received against a threshold of 6: in FU, holding 4,
short 2; 116 of 300 players whose basket went past 6 were all in FU); a
player missing an ordinary ingredient, below the threshold, or finished is
not; 39 sugar under a cap of 40 rolling 3 keeps 1 and loses 2 with nothing
in their place; the lost-overflow setting; three baskets on the day Main is
finished (the other two are Recompletion's, none added or dropped); presets
(a player who qualifies beside one who does not, the same baskets, the same
sizes, identical ordinary draws; later baskets may differ because the pantry
and the threshold count do).

**Wrong in the wording, not the behaviour.** "Basket luck only" was described
as rounding supply "to the nearest whole basket". It never rounded the rate:
the expected count runs up day by day and a basket is opened each time the
running total passes a whole number, from a starting point of the player's
own. The comment, the briefing and two screen texts now say that, with the
0.4 example.

**Added.** Section 13 of verify-chef.mjs (the cases, expected against
observed) and section 14 (readiness); `chefReadiness.js` and the "What this
event still needs" list; "Start a reference chef from this one"; the
synthetic example; a run is no longer marked out of date by ticking an item
(`fingerprint` reads only what is played).

**Not done, on purpose.** No reference value was chosen: the three
Recompletion recipes, thresholds, dates, prizes, segment factors and special
sources of the real event are the economist's. No real event was simulated
against its targets.

**Checked.** verify-chef.mjs 167 checks; chef-flow.mjs 110 checks in a real
browser at 1500 x 800 and 1280; lint and build clean. Merge suites not run
(nothing of Merge or the shared components changed).

## Chef build 02: a generated proposal, reviewed and applied or not

The third brief: "Generate and review an economy proposal" - define targets
and what may change, generate, review the current event beside the proposal,
apply or discard. A working feature, not a plan; the search on the real
engine; no claim of an optimum.

**Built.** `lib/chefGenerator.js` (the plan, what stops a generation, proved
conflicts, the search, the check on other players, the proposal, apply and
undo); step 4 "Proposal" (`ProposalStep.jsx`) between Baskets and Simulate -
the flow has six steps now; blank recipe quantities (step 2: empty a field;
"generate this", never a free dish). The engine gained measurements only:
`probes` (on a typed day, where each player stands and what the dishes left
lack; who is still under a threshold), `dishMaster` (all semi-blocker dishes
by its last day), a waiting limit, Recompletion's FU within so many days
among the players who enter. No rule of the engine changed.

**How the search came to be what it is** (single runs on the made-up
example). A first version changed one thing a step and stalled at once: a
player needs every ingredient, so one alone showed nothing. Answering up to
three reasons a step, with bolder steps where more players are stuck, took
the worst segment from 112 points short to 21. Reading who is still under
the blocker's threshold (not only who waits one dish short) found the real
bottleneck of the weak segments. Weights then grew without end (50 to 2,320),
so a weight may grow at most 8 times (this tool's own, typed in Bounds). The
search aims 3 points above a target so the check on other players has room.

**The made-up example needed effort factors.** The Halloween source has
none, and with one size of recipe for nine segments no base recipe suits
both ends. The synthetic example now has made-up factors from 0.5 to 3.5 and
wider made-up pantry caps, labelled as made up like the rest of it.

**What it gives on the made-up example** (single runs, 60 versions, about 22
seconds, 400 players a segment in the check). As typed: in FU on day 14 from
0-3% to 65-92%; seven of nine segments meet 80%, P50 is too close to call
(80%), P25 misses (65%) - its players open about four rare baskets by day 14
and only rare and epic baskets hold the blocker. With the two basic baskets
opened to the blocker by the economist (a click in Locks): 82-91%, every
segment met, P25 "met, close". Both times the Main recipes fall from 378 to
about 90 against a reference of 250: the FU target asks every segment to
hold every ordinary ingredient of twelve dishes two thirds into the event.

**Checked.** verify-chef-proposal.mjs 82 checks (about 40 s);
verify-chef.mjs 167; chef-flow.mjs 160 checks in a real browser at
1500 x 800 and 1280, among them: the applied event, simulated in step 5 on
the players of the check, gives the proposal's figures in all nine segments;
lint and build clean. Merge suites not run (nothing of Merge or the shared
components changed; the browser run's warm-up list got the new step).

**Not done, on purpose.** Build 03 (automatic presets), a basket valuation on
the engine, any export. No real event was completed or run.

## Merge: a charm paid 15 in play while the workbook said 65

Economist: "the 4th rank of the charms gave me 15 charms, and the output shows
its 65 charms" (Play Tester, normal boards; the downloaded workbook).

**Cause.** The game, the simulator and the build pay a rank's value
(`prizeAmount`); the Small Rewards sheet writes the rank's item text
(`syntax`). Two paths let them drift apart silently: typing a puzzle, merge
energy or charm value in the Rewards tab changed the value and not the text's
number (only coins followed); and a build that re-valued a rank rewrote the
number in its text only when that number equalled the old value - a text
already out of step stayed out of step, and the workbook printed it. In a
clean build the two always agreed (checked: a two-segment build, the sheet,
the Play Tester and the stage link all give the same numbers).

**Asked, and chosen: "Text follows the value."** A text with one amount now
carries the value in every path - typing, building, opening an older project
(`ensureRewardChainConfig`, also the typed copy), and the export
(`syntaxForValue`). A text with several amounts or none is never rewritten:
the Syntax tab names it (`rewardTextIssues`).

**Checked.** verify-event-build 342 (four new checks), verify-containers 162,
verify-v2-rewards, verify-twister 146; in the browser, a project saved with
the mismatch opens with the text in step, a value typed in the Rewards tab
carries its text, and the Small Rewards sheet shows it. Not deployed.

## Chef build 02, follow-up: pacing, the budget as a choice, honest proofs

A fourth brief: four gaps in build 02 - the generator never started pacing an
ordinary ingredient; the recipe budget could collapse (378 to about 90
against 250) under a soft preference; the semi-blocker's Dish Master shape
was not generated; and some "proved impossible" checks were not proofs.

**Pacing.** New ordinary schedules for allowed ingredients (existing and new
counted together, a locked schedule apart from an excluded ingredient), on
the days allowed - none typed while opening days are locked means none made,
never a date invented. Added, swapped, re-dayed and removed by the search;
each new one played without it before the check. First runs paced Butter -
the very ingredient players lacked - so a guided step now paces only what
players are not short of. Measured on a small event where Apple crowds the
baskets (weights and recipes locked): pacing Apple alone took the furthest
segment from 48 to 19 points short on the search players, and FU on other
players from 39%/52% to 69%/74% (single runs). On the made-up example no new
ordinary schedule survived: none helped the worst segment enough.

**The budget.** A choice with no default; a range is kept by every version
played (the log records each version's total and a check reads it); free
exploration is labelled. The current event stays the comparison; a separate
starting point is named. A "recipes alone" reading on the same players says
how much came from asking for less.

**The semi-blocker.** A schedule made by the rule when allowed, within typed
bounds; what one shared limit lets each segment cook early is shown per
segment; early cooking is a target only when typed.

**Proofs.** Retained (with stated assumptions): blocker lifted on the FU day;
blocker bound (corrected: presets' contents and jokers counted, blocker
quantities that may change counted at 1, a proposal never opens a blocker
row); pantry too small (corrected: not for blocker shortfalls, not for
Recompletion dishes); locked recipes over all supply (corrected: a joker is
three ingredients). Downgraded to a warning: a source giving the blocker past
its threshold - measured, 3 blockers to 50% of players still left 60%+ of
Strong in FU.

**Outcomes kept apart:** inputs, invalid, conflict, misses/no-better,
cancelled, incomplete. Older proposals (search 1.0) cannot be applied.

**The made-up example inside 225-275** (test range, not approved; single run,
400 players a segment): in FU on day 14 from 0-3% to 47-68%, every segment
still short of 80%; recipes alone would give 1-54%; 6+ dishes by day 10 from
48-56% to 76-87%; longest wait (most players) up from 7-8 to 9-10 days;
nobody cooks a semi-blocker dish before or by the end of Dish Master, before
or after; payout complete (made-up prizes), up in every segment. Explored
freely: 65-91% in FU, recipes 378 to about 100.

**Checked.** verify-chef-proposal 132 (65 s), verify-chef 167, chef-flow 170
in a real browser at 1500 x 800 and 1280; lint and build.

## Merge: switching between saved events from the header

Economist: "we are still missing a feature i wanted us to have. is to save the
event and to be able to switch between them". Saved events already existed
(More → Saved events, live), but switching took the menu and a panel. Asked,
and chose: a switcher in the header. It names the event open (or "Not saved
as an event"), lists the saved events newest first with their dates - one
click opens one, asking first when there are unsaved changes - and offers
"Update" and "Save as a new event" under the event's dates. Rename, delete and
download stay in Saved events, one click away from the switcher. Checked:
saved-events.mjs 20 checks (9 new); lint and build. Not deployed.

## Chef: a design experiment inside a budget range

A pasted review asked for evidence instead of more features: one concrete
experiment, current → recipes alone → proposal, every segment. Run on the
synthetic (made-up) example - no real event is complete - inside a test range
of 225-275 Main ingredients, three search numbers of 150 versions each:
`docs/chef-experiment-2026-11-23.md`. Findings: every version stayed in the
range; FU 0-3% → 43-69% across searches, every segment still short of 80%.
Not the amount of supply (the middle player receives more than FU needs) and
not the mix (a weight fit to the recipe mix was tried, changed about one
point, and was removed); the assumed player-activity spread (0.4x-1.6x) leaves
the slowest fifth below what FU needs by day 14 - with basket luck only the
same range reaches 78-100%. Pumpkin has weight 0 in every basket of the period
covering Dish Master, so no Dish Master progression is possible as typed: a new
warning says so before generating (one check added; verify-chef-proposal 133,
chef-flow 170).

## Chef: the planning conversation handed over; both views of the players side by side

24 November 2026. The economist's planning chat with GPT (where the Chef rules
were first agreed) timed out; they pasted the whole of it here to carry on
together. Read against the app, almost every answer in it is what builds 01-02
rest on. Agreed there and not built: both views of the players shown side by
side (GPT's recommendation, accepted: "we will go with ur recommendation"); the
model suggesting a special supply event in the calendar when players miss an
ingredient; new basket odds with each threshold opening; ordinary threshold
amounts per segment ("not for the start"); a basket's value by calendar day;
build 03. Asked whether what is lost to a pantry cap counts toward a threshold
(never answered there), the economist: "the caps will always be a lot more than
the threshold so practically it doesn't matter" - the setting stays.

Chosen next, and built: **both views side by side.** Every simulation run plays
the chosen view ("Targets judged with", default player activity) and the other,
on the same players' number; the other is shown in blue columns (in FU on the
FU day, every checkpoint) and in a segment's detail. A proposal's check plays
the current event and the proposal the other way on the same check players
(`otherView`, a reading only: the search, verdicts and outcome are unchanged).
Made-up example inside 225-275, single run: 47-68% in FU with activity,
84-100% with basket luck only. Checks: verify-chef-proposal 135 (two new),
chef-flow with new checks for both screens.

## Chef: the live segments

Same day. The economist: "the segments we got are not the segments we are
holding in the app", with the game's nine segment keys - Chef_control
(outside A/B test 1109) and eight bands of daily Brut Wins (0.7 x the last 3
days' daily average + 0.3 x the last 14 days'): 0-10, 10-20, 20-40, 40-60,
60-100, 100-150, 150-240, 240+ - and "we need an option to add new segments
also" ("Add a segment" was already in step 1; said so). Asked: a button that
replaces the segments (chosen over adding beside them or new chefs starting
with them), and Chef_control included. Built: "Use the live segments" in step 1
(asks, lists what still names the old segments, one undo); names, ranges and
definitions only - effort, prize factor, burnout 1 and baskets 0, to type.
The historical chefs keep their segments. verify-chef 172 (five new),
chef-flow: replace and undo in the browser.

## Chef: the Black Friday chef, Dish Master dishes picked, a dish the same for all

Same day. The economist put `chef_BlackFriday_2411.xlsx` in the repo ("go get
the data from there"). Read: event (24 Nov, 21 days, periods of 10 and 11), 8
ingredients, 12 Main dishes (297 at the base), production basket strings, the
segment bands' effort and baskets a day, prizes. Sheets disagreed and the
economist chose: Gold flakes is in 5 dishes while Dish Master has 3 ("I'll name
the 3"); dish 1 is the same in every segment tab ("Yes, dish 1 never scales" -
a new rule, `sameForAllSegments`, an "all" box in step 2); pantry caps
40/40/40/40/40/30/30/15; Gold flakes in period 1 is 50 in the strings and 0 in
the assumptions ("the basket production is not 100% finished yet" - the strings
are loaded as a draft); prizes: the Prize_sheet list is loaded, the 70/70 of
Chef_assumptions said beside it. Then, of the questions on what the workbook
lacks: "i want to be able to do those in the model ... to pick the dishes for
the dish master ... make sure all the questions u asked me here i am able to do
myself in the app". Everything else was already there; added: the Dish Master
dishes picked in step 1 (`dishMaster.dishIds`; Dish Master progress read on
them; checks and the readiness list say when they are not three or lack the
semi-blocker), and "New chef: from the Black Friday chef". verify-chef 180,
chef-flow 185 (a walk through every open question in the app).

## The economy, shared by the whole app

24 Nov 2026. The economist: "the next thing i want us to do is to learn the way
we calculate things in our economy. its not only for the chef, all the app
should know how to handle the calculations of the game we got." Asked how they
would give it and where it should live: "Explain it in chat" and "One shared
economy page". They pasted "Economy Rules & Reward Syntax" (value in allowance
and its table, the reward-text grammar, currencies with dated values, the text
builders DR_Syntax_V5 / DR_AltReward / PackSyntax / RewardSyntax, segment
conditions, the sheets' rounding, the checks to build). Read back against the
app: Chef's value table and live segments already matched it. Four conflicts
were asked: Merge's small-reward rounding against MergeRoundReward ("the small
reward rounding should not be affected from the rules u got now"), coins to 2
decimals against Merge's 3 when small ("Keep 3 decimals when small"), Chef's
grand prize to the nearest 5 against RoundReward ("Yes, RoundReward"), the
Twister's any-whole price against the spin-cost steps ("all the rules u got now
are applied only on prizes we will add to the tiers in the features. all the
rules we got from befor for small reweards and twister are untouched").

Built: `src/lib/economy/` (rounding, the value table and currencies with dated
values, the builders, a reader that writes a text back exactly and checks it,
worth, segment conditions, kept in this browser) and the Economy page on the
home screen (worth, keys, check a reward, build a prize, segments, rounding;
download / load / start again). Chef: grand prize by RoundReward (90 x 1.37 =
123.3 was 125, is 120; 108 was 110, is 100), its default value table read from
the economy, step 2 saying when a chef's own differs. Merge: the Syntax tab
reads every item text with the checker (a reading; dr-twister named as this
app's own); a backup carries the economy and importing asks before replacing
it; a saved event never touches it. Nothing invented: the seeded currency
names, packs, presets, chests, triggers and buckets are the ones in the
economist's text, with no worth but dr-hidden's 0. Open questions are listed
in docs/economy-rules.md. verify-economy 167 checks; economy-page.mjs 37;
verify-chef 182, chef-flow 185, text-layout 10 (single runs).

## Chef build 03: catch-up suggestions; the economy's answers and the game's keys

24 Nov 2026. Asked "continue whatever you have to still do in the chef", the
economist chose build 03 among four pieces left, then answered its four forks
(all the recommended ones): both kinds of player (behind pace, stuck on an
ingredient), common and rare ingredients only, the fewest players touched
between equals, their own presets never touched. Built `chefCatchup.js` on
build 02's targets, order, verdicts and both views; step 4 got a choice
between the two kinds of suggestion; the engine counts the players given a
suggested basket (a reading); suggested presets carry `origin: 'build-03'`
(only on them, so no saved chef's fingerprint changes). On the made-up
example a suggestion barely moved the FU day while reaching 95-99% of the
players: what held them back was the semi-blocker (Pumpkin, 96-99% lacking on
day 14), which a catch-up may not give. Rather than hide it behind "Missed",
the result says what holds players back on the FU day and opens that by
itself when it is the semi-blocker. verify-chef-catchup 42, chef-catchup 17.

The economy, same day: a second currency goes inside the last fallback, which
may be any core resource; dr-twister is the game's name; the pack counter is
worth 0 and the basket counter is removed ("that logic is not up to date");
energy is removed; pricing is removed (game play only; no Rate of Economy,
on-cards multiplier or currency factor for now); Chef baskets keep their tier
worth every day. The game's keys were given: 608 sticker packs (every one
worth 0), 81 presets (the real Chef baskets - not every tier comes in every
kind, so baskets are known by the list, not a pattern - picks, market and the
rest) and 21 more presets (Chef_Inject_*, Chef_DishN_Complete). The keys
lists are searched; a saved economy gets them added and keeps its own. The
presets' syntax and values (mini-game from merge and picks, puzzle from the
average daily puzzle value) are to come. verify-economy 183, economy-page 41.

## Merge: the twists a build was made for, and the twists typed now

24 Nov 2026. The economist: "i asked 10 twists in the simulator and it shows
15 asked in the Build". Reproduced (scripts/e2e/twister-retype.mjs): when only
the twists change, a build is priced again by itself and step 4 shows the new
twists (15 -> 10, price 11 -> 16 Twister DR); but when anything else changed
too, the build is out of date, nothing is priced again (its boards are old),
and "Twists asked" kept showing the twists it was built for as if they were
asked now. Step 4 now says so in that cell: "built for these; 12 typed now -
build again" (while a current build is being priced: "12 typed now -
pricing..."). Presentation only; nothing about the build or the price changed.

## Chef: a basket's worth, day by day, on the engine

24 Nov 2026. Asked to go on with Chef. The economist had said the basket
worths (Basic 0.25, Rare 1, Epic 4) stay "as for now ... when the chef model
in the app will be better we will change its value daily", and step 6 still
had only the older estimate (blind to thresholds, the pantry and
Recompletion). Built `chefBasketWorth.js`: for a segment, every day and every
basket type it opens, one more basket played on the engine with the same
players, each compared with themself (the engine's "one more basket"; a day's
figure equals it exactly). The worth is what the basket adds to what a player
is paid, in allowance, with how far it would move with other players. Shown
at the top of step 6 beside the tier worth of the Economy page - a reading
only, no value is changed. Made-up example, single run: about 0.5 / 2.5 / 5
over the event against 0.25 / 1 / 4. verify-chef-worth 8, chef-worth 7,
chef-flow 185.

## Economy page: no Feature column; dates on a calendar; fields say why they refuse

24 Nov 2026. The economist: "there is no need in the currency tables for the
feature column. there should be data validation on the types entered to the
placeholders, specially the dates, calendare pop up is the best." The Feature
column is gone (the field stays in saved data, unused). A currency's values by
date are entered in an editor under its row: a date picked on a calendar and
its value, a list to change or remove from, "Add the day" starting the day
after the last, a date given twice refused; a whole list can still be pasted
in the export writing, and a date that does not exist (30 Feb) or a broken
part is refused and named, never kept. Every number field of the page says
why it refuses a value (below 0, not whole where a resource is, not a number)
and keeps the value before. verify-economy 192, economy-page 48.

## Chef: special-event suggestions

24 Nov 2026. Asked to go on, the planning's next agreed piece: "if the model
will sence a danger for somehting missing, he can suggest in the calender to
do a special event that will give the players those ingredients". (Per-segment
thresholds and changing basket odds wait: "we will not do those for the
start".) The economist answered four forks: a share the tool finds; common,
rare and the semi-blocker (not the blocker); the fewest ingredients given
between equals; the same event for every segment. Built `chefEvents.js` on
build 02's yardstick, as step 4's third choice, with the "what holds players
back" reading shared with catch-up (an event gives the semi-blocker only up to
its threshold). Small test event: the weak segment 4% -> 77% in FU with two
Cherry events. Made-up example: Sugar and Flour events, still missing - the
semi-blocker's threshold holds players there. verify-chef-events 32,
chef-events 11, chef-catchup 17, chef-flow 185, verify-chef 182.

## Chef: prizes as reward text

24 Nov 2026, going on with Chef. A Chef prize is a prize on a feature's tier,
so the economy's rules apply: step 2 now shows, for any segment, every dish
prize and grand prize in the game's syntax (`chefPrizeText.js`, folded "Prizes
as reward text"), checked by the Economy page's checker, with a copy button. A
reading - nothing is exported (there is no Chef export layout). What cannot be
written is said, never dropped or rounded by the tool: a prize not known, or a
part that is not a whole item while "Whole items" is not decided (a scaled
segment's 4.8 undos). A grand prize says when RoundReward rounds its worth away
from what its items add up to (108 coins, worth 100) - which the game pays is
not settled. verify-chef-prize-text 9, chef-worth 10, chef-flow 185.

## Chef: whole items always down; a grand prize is its rounded worth

24 Nov 2026. Writing prizes as reward text turned up two open points, asked:
how a scaled amount becomes whole items ("Always down" - 4.8 undos give 4; it
was a setting, "not decided", and leaves the list of unsettled rules: seven
remain) and which a player gets when RoundReward rounds a grand prize ("The
rounded worth (100)" - the coins take up the difference; when they would go
below 0 the items stay as scaled and it is said). Every prize of a scaled
segment is now written as reward text. Payouts change a little where amounts
were fractions (1.37 undos count as 1). verify-chef 186, verify-chef-prize-text
9, chef-worth 10, chef-flow 185; catch-up 42, events 32, worth 8, proposal 135.

## Chef: four rules of the real game settled

24 Nov 2026, asked about the real game: a threshold "Stops exactly at the
limit" (inside a basket too - it was played as "checked before each basket",
where a basket could go over: results move), a joker goes to the blocker first
then what is most missing, a special source reaches the same players first, a
player cooks at once in list order (the last three as already played). They
are rules now (`CONFIRMED_SETTINGS`): step 3 says them instead of offering a
choice, step 5's "not settled" list keeps three, and a chef saved before takes
them when opened. Checks written for the older threshold behaviour now pin it
and say so; a new one holds that no player ends above the limit. verify-chef
188, proposal 135, catch-up 42, events 32, worth 8, prize text 9; chef-flow
185, chef-catchup 17, chef-events 11, chef-worth 10.

## Chef: a run is kept across visits

24 Nov 2026, going on with Chef: a known limit was "Simulation results are not
saved with a chef" - a reload lost a run. The last run of a chef is now kept in
this browser, apart from the chefs (so a run is not a change to save), for the
4 chefs played most recently (a run of nine segments is about 200 KB). It shows
out of date once the chef differs, or once the simulation is a newer version,
and the screen says when it was played and whether it is kept (when the
browser has no room: for the visit only). chef-runs 5, chef-flow 185.

## A full run of every check (24 Nov 2026)

After the day's Economy and Chef work, every suite was run. Browser: all 27
suites passed (Merge, Chef, the Economy page). Engine: every Chef suite, the
economy, the board bank and the stage link passed; two Merge checks failed
once in the full run and passed twice alone, with no change to their code:
verify-real-play's robot matching the simulator (0.98 of the rewards, 0.94 of
the DR in one segment) and verify-twister-cadence's demand calibration (one
segment's search not settled at -10.1%, which the build said). Both depend on
the build's draw - a note for QA, written into CLAUDE.md beside the one known
before; nothing in the economy was changed (it is frozen).

## Economy: balancing a feature's tiers

24 Nov 2026, going on: the rules' section 6 lists "Balancing checks the app
should run" - gap = worth - tier target, per tier and cumulative, flagged
beyond +-X%; the grand prize's separate share; the DR amount to close a gap =
round((target - worthWithoutDR) / DR_value). Built as `balance.js` and the
"Balance tiers" tab: tiers typed or pasted from a sheet, each valued by the
checker, X typed (the rules do not give it; 10 to start). verify-economy 201,
economy-page 53.

## Merge: Small Rewards CC

25 Nov 2026. The economist: "i need us to create small rewards bank and
weights for a CC on those. i need a CC for each option for when the player
doesnt have anymore in its game the items that drop. when the user doesnt have
a twister, when doesnt have a puzzle, no charms. all the options." Asked: a
missing item becomes a coin item of the same rank; the player can be missing
everything but merge energy (Twister, puzzles, charms: 7 CCs); with no Twister,
merge tier 5 drops nothing. Built `smallRewardsCc.js` on the event's own
containers (tiers 2-14): the same keys and weights, missing items as coins,
tier 5 to NoDrop when the Twister is missing; two sheets on the Syntax tab with
the CC picked and the changed rows highlighted, and a workbook of all seven
with an index - the main workbook unchanged. Checked on the economist's own
backup (read only): every tier still adds to 1000, 13 tiers as the normal
sheet. A container can now name the same coin twice (coin-r1+coin-r1) - asked
whether the game reads that. verify-small-rewards-cc 11, small-rewards-cc 8,
real-play 40, twister-workflow 71, text-layout 10, guided-flow 84,
verify-containers 162.

Before it was published, the economist changed the Twister's part: "if a
containter has a twister and it dies we can just not give drops from it
anymore, when the container is a container that has to give 3 rewads, u can
enter a rank 1 energy into it". So a missing Twister item is no longer a coin:
it is dropped from its container, and in a three-item container a rank-1
merge energy (`dr-r1`) takes its place, so the container still gives three. A
container left with nothing (one that held only a Twister item - tier 5's,
and the Twister-only containers of the tiers above) leaves the CC sheets and
its weights go to NoDrop; tier 5's "Nothing" is now a case of that rule.
Puzzles and charms still become coins of the same rank.
verify-small-rewards-cc 14, small-rewards-cc 9, text-layout 10.

The question about a container naming the same coin twice (coin-r1+coin-r1)
was answered: "yes the game reads it well".

Then: "i dont see it in the output" - the CC sheets were only in their own
download. Asked where, the economist chose "Add to main output": every main
export (workbook and Google Sheet, this segment and all segments) now ends
with the 15 CC tabs after Endless; the separate download stays. The checks
that held Endless as the last tab (verify-containers, verify-v2-rewards,
verify-twister) now hold it last before the CC tabs. verify-small-rewards-cc
15, small-rewards-cc 9, verify-containers 162, verify-v2-rewards, verify-twister
146. verify-real-play failed one check on its first run alone ("on about the
same DR": simulator 478, robot 743) and passed all 70 on the second (632 and
679) - the export change does not touch play; another draw-dependent result
for QA.

The economist asked why later containers hold charms (ContK
coin-r3+dr-r3+charm-r3, ContL coin-r3+puzzle-r3+charm-r3). Those are the two
rows only Recompletion reaches (merge tiers 13 and 14,
`tuneRecompletionTopRows`), made from Recompletion's own amounts - it takes
only a reward whose Recompletion amount is above 0 (the 23 Nov backup:
charms 200 there). Said so; nothing changed.

## The work repo, branches and a deploy on every merge

25 Nov 2026. The project moved to the work repo: `origin` is now
idog-lab/EcoSystem (the old idoggk/Merge is the remote `personal`, pushed to
only when asked), and the site is https://idog-lab.github.io/EcoSystem/
(`base: '/EcoSystem/'`, `PRODUCTION_ORIGIN`; links made before still open
idoggk.github.io/Merge). The economist switched on Pages for the gh-pages
branch. Git asked to authorize on every push: the address carried the user
"ido.g" while the sign-in is saved for the account idog-lab - the address is
`https://idog-lab@github.com/...` now.

Then: "we need to work with branches now i guess because im working with
another guy on the app". Asked: "Pull request, you approve" and "Automatic on
every merge". So every change goes on a branch and a pull request the
economist merges, and `.github/workflows/deploy.yml` publishes master on
every merge (lint, build, write gh-pages; "Run workflow" on the Actions tab
publishes again by hand). `npm run deploy` refuses now - a hand deploy from a
branch or an old master would take the other person's merged work off the
site; `npm run deploy:manual` is the old command, for when GitHub's deploy is
broken. A clean clone was built before: the same files as the live site.

The economist asked whether a coworker's branch made from an older master
would overwrite their work. No: a merge takes only what the branch changed;
the same lines changed on both sides stop the merge as a conflict. The risk
is changes that merge cleanly and do not fit together - so a check on every
pull request (`.github/workflows/check.yml`: lint and build of the branch
merged with the latest master), and the master ruleset is to require it and
require a branch up to date with master before merging (set by the economist
on GitHub).

## All my data, as one file

25 Nov 2026, after the move to the work repo: "we got memory in the last
repo. can we take it back ? we had some saved merge features there". The old
site's data is still in the economist's browser, under idoggk.github.io; the
new site cannot read it (a browser keeps each site apart). What existed moved
it badly: saved events one at a time, Chef by its own file, the Economy page
and Diamond Mine not at all. Asked, the economist chose "One-file move": the
home screen has "Your data in this browser" - Download all my data (every key
of the app in one file) and Restore all my data (shows what the file holds
first; adds the saved events, puts in what this browser has none of, replaces
a part only when ticked; downloads what is here first). This version is
published once to the old site too (idoggk/Merge, built for /Merge/), so the
old data can be downloaded there. verify-browser-data 11, browser-data 10.

## The economy is taught in the project

25 Nov 2026: "the big big project we got is to learn the economy and how to
write syntax. later me and my coworker will start teaching the app about each
event we got." Asked three things, the economist chose: what is taught is kept
"In the project" (not each browser), it is taught by "Explain in chat", and
"Finish the basics" comes first (the worths of the currencies and presets,
the text behind the mini-game and puzzle presets) before any one event.

The Economy page kept everything in the browser that typed it, so a worth the
economist typed would never reach the coworker or the site. Now
`src/lib/economy/taught.js` holds every value taught, each with the words it
was said in, the day and who said it: to start with what was already
settled on 24 Nov (the value table, the Chef basket tiers, dr-pack-counter
and dr-hidden at 0). A taught value wins over a browser's own: the page shows
it with a "Taught" mark and no field, its hover gives the words; a browser
whose own value was replaced is told once, and a file loaded from before says
so too. What is typed in a browser and not taught is listed on the Worth tab
("Typed in this browser only"), with "Copy as a message" to paste in chat.
(Before, "a worth someone typed is never overwritten"; with the economist's
choice that holds only for what was not taught.) verify-economy 214 (1b: what
was taught), economy-page 61 - the suite typed a wild of 3 throughout and now
uses a currency of its own, and Chef's own wild, instead.

Same day, on the Worth tab: "the delete button in the currencies should be in
the left side, its hard to know what ur pickign to remove" - it is the first
thing on a row now, in the Keys tab too. "is a list of DRs we got. let the use
be able to use a drop list, and if needed he can add a new DR that will be
added to the drop list" - a currency is added from a drop list
(`GAME_CURRENCIES`, `currencyChoices`), its last choice a new name. The list
came as a picture with most names cut off: nothing was copied from it, it is
asked for as text.

Then: "there are DRs that will always be in the game (from the currencie
table), puzzle, merge, picks, pet. those should be in a different table, that
also holds the dates that the value is relevant to. the puzzle should have
different value for each day, and the pet should have different values for
each week he is live." Asked, the economist answered: merge and picks are
dr-merge and dr-pickaxe; their values "From date to date"; a pet week "From
the day I type"; a date with no value reads "Unknown". `CORE_CURRENCIES`
holds the four with `periods`, a table of their own ("Always in the game",
`PeriodValues.jsx`: a day, a week or from-to, picked on a calendar or pasted,
never two on one day). The "unknown" rule also replaced the clamp of an event
currency's dates (before the first date read the first, after the last the
last). verify-economy 227, economy-page 72.

The list then came as text (106 names, 104 different) and is `GAME_CURRENCIES`
as given. dr-basket-counter is on it although the economist removed it on 24
Nov: the drop list leaves it out, and they were asked whether to bring it back.
Two names may be cut short in their sheet (dr-christmas-wheel-with-i,
dr-wicked-trails-dr-gold): copied as they are, and pointed out. The drop list
offers 99 (the other four are on the page already). verify-economy 229,
economy-page 72.

Then: "there is no need in the notes of the DRs" - the note column is gone
from both currency tables (a note already saved stays in the data, unseen).
economy-page 73.

Then: "as for the picks and merge, we can give a fixed value for now" - merge
and picks are one worth each, the same on every date (step `fixed`); the
puzzle and the pet keep their dates. Dates typed for merge or picks before are
kept in the data, not used, and the page says so. verify-economy 230,
economy-page 73.

Asked whether every basket and pack was in: the three lists of 24 Nov were
compared name by name with gameKeys.js - 608 packs, 81 and 21 presets, none
missing (the Keys tab shows 12 at a time; Build a prize offers the 17 game-play
Chef baskets, not the `_pricing_` ones). Then: "also what about the chests?
wooden, silver,golden purple" - asked, written by the name alone ("here is an
example chest:wooden(...") and "Only the four": taught (taught.js), pink-chest
and yellow-chest off the list and off a saved one (economy version 5).
verify-economy 235, economy-page 75.

## Segments: the functions they are made of

25 Nov 2026: "the next thing i want us to do is to learn the logic of as many
functions as we can that with them we create segments. when building segments
we will need to create the best flow to create them with different logics";
"the BW and ang mode are very very important. ill try to teach u as many as i
can". First taught: `fn_DiamondMine_Progression(####U)` and
`fn_Merge_Progression(####U)` - "those fucntions return the progression in %
of the user", e.g. `fn_DiamondMine_Progression(57634U) > 95`, "the only thing
important is the event Id". A dictionary of functions in the project
(`segmentFunctions.js`, with Brut Wins and the mode multiplier from the rules
of 24 Nov), a progression writer and a reader of any condition on the
Segments tab. verify-economy 246, economy-page 81.

Then, answered: progression is "another fucntions they are added up with &&";
the 1m,2m,4m,8m are "the multiplier on the mode. each net win is a level
win, each brut win is the net win * mode multiplier" - mode 1 x1, mode 2 x2,
mode 3 x4, mode 4 x8 (the "not confirmed" on Brut Wins is gone). Taught:
`CoinsInAllowance` (the balance in allowance; OOC, out of coins - "logic is
mostly when we will use the balance to get a segment of users with low
balance") and `CurrentLevel`, names without brackets; their example
`CoinsInAllowance < 2 && CurrentLevel > 519`. The progression card became
"Build a condition": parts (progression, balance, level) joined with &&. The
reader says when a name is written with brackets or a function without.
verify-economy 254, economy-page 83.
