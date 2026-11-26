# Merge Mania economy toolkit

A game-economy design tool for **Merge Mania**, a 7-day live-ops event in
Disney Solitaire (SuperPlay). The user is the event's **economist**, not an
engineer: answer in plain words, show results on screen, and never put solver
jargon ("infeasible", "ladder", "eligible capacity") in front of them.

This file holds **the rules in force today**. `docs/history.md` is the full
record of how they came about (38 rounds of economist feedback, with the
reasoning, measurements and rejected alternatives). Read the history when you
need the *why* of a rule, or before changing anything a rule here protects.
When this file and the history disagree, this file wins.

## Working rules

- **The economist decides the game rules.** Every rule below that is marked
  "economist" was asked for in so many words. Do not change one to make code
  simpler or a number come out nicer; if two rules collide, say so and ask.
  Numbers marked "this app's own" are ours to tune; say when you change one.
- **The economy is frozen** (economist: "Freeze economy development for now.
  Further balancing and gameplay changes will come from my hands-on QA"). Do
  not change formulas, drop rules, reward values, simulator strategy,
  calibration objectives or margins unless asked. A suspected logic issue is
  written down for QA, not fixed; ordinary presentation and interaction bugs
  are fixed. A limitation is never hidden and a warning is never turned into
  a success message.
- **Do not invent production values or syntax.** Ops mappings that were never
  confirmed stay labelled "unverified" wherever they are shown or exported.
- **Verify in the real app, not just the library** (Playwright suites below).
  Report what was actually checked, including what failed or was flaky.
- **Two people work on the app, on branches** (economist, 25 Nov 2026: "im
  working with another guy on the app"; chose "Automatic on every merge").
  Every change goes on a branch of its own off an up-to-date `origin/master`
  (`git fetch` first) - **never commit or push to `master`**. **Claude takes
  its own work all the way** (economist, 25 Nov 2026, of the pull-request
  link: "why do we work with the pull request link ? i want u to do it
  urself" - it replaces "Pull request, you approve"): when a piece of work is
  done and its checks pass, commit, push the branch, open the pull request,
  wait for GitHub's "Build and lint" check and merge it - then say what went
  live. Never merge with a failing check. **A coworker's branch is merged
  only when the economist asks** (25 Nov 2026, `architecture/foundation`:
  "we got 1 of my cororker that we need to push"): tested first on a copy -
  today's master merged in, built, opened as GitHub Pages serves it, the
  checks run - then on a branch of its own (`merge/<their branch>`), their
  branch left as it is. Pull requests are opened and merged
  with GitHub's `gh` tool, signed in by the economist; never read a token out
  of git's saved logins. **A merge into master publishes the site by itself**
  (`.github/workflows/deploy.yml`: lint, build, write `gh-pages`); nobody
  deploys by hand - `npm run deploy` refuses, and `npm run deploy:manual`
  (from an up-to-date master only) is for when GitHub's own deploy is broken,
  on the economist's word. Every pull request is linted and built on top of
  the latest master (`.github/workflows/check.yml`, "Build and lint"); run
  the engine checks that touch a change on the branch before handing over the
  link - the check on GitHub does not run them. A shared stage link always opens the deployed site,
  so a change to play reaches phones only once it is merged. Before starting
  on a branch, bring it up to date with master; CLAUDE.md and
  `docs/history.md` change in almost every piece of work, so expect to merge
  them by hand.
- Artwork is prototype concept art made by the economist, not studio artwork.
- `src/features/chef` and `src/features/diamondMine` are separate features
  that share only `src/components/` and `src/lib/`. Leave them alone unless
  asked. **Chef has its own description, `docs/chef-overview.md`** - the
  confirmed rules of the event, the rule engine, its six-step flow, its
  checks and what is not settled: read it before a Chef task. Chef was
  rebuilt ("Chef rebuild, build 01": an accurate event model and simulator,
  on a brief the economist approved; a reference chef is a separate copy
  completed by the economist against a list of what it still needs, and the
  synthetic example is made up and labelled so). **Build 02 exists: step 4,
  "Proposal"** (`lib/chefGenerator.js`, `ProposalStep.jsx`) - the economist
  says what may change, the tool searches recipe quantities, basket weights
  and threshold schedules on the real engine, checks the best one and the
  current event on other players, and shows them side by side; nothing is
  changed until Apply, one undo brings it back. Its follow-up: the recipe
  budget is chosen before recipes may change (a range kept by every version,
  or a labelled free search); it may create ordinary schedules (allowed
  ingredients, up to the number typed, on days allowed) and the semi-
  blocker's Dish Master schedule; it never opens a basket to the blocker;
  only what holds for every allowed event is called impossible - a risk is a
  warning and the search goes on. Every run and every proposal check plays
  both views of the players side by side (player activity, basket luck
  only - agreed in planning); the one chosen decides met, the other is a
  reading. A proposal is the best of a
  bounded search - never called the optimum - and its values are suggestions,
  not confirmed ones; every default of its controls is this app's own; what
  can be proved impossible from the inputs is said instead of searched. **Build
  03 exists: catch-up suggestions** (`lib/chefCatchup.js`, `CatchupPanel.jsx`,
  the second choice of step 4) - on the economist's four answers: both kinds
  of player (behind pace, stuck on an ingredient), common and rare
  ingredients only, the fewest players touched between equals, their own
  presets never touched (suggestions added after them, `origin: 'build-03'`,
  marked in step 3, one undo). Judged on build 02's targets, order and both
  views; it says what holds players back on the FU day (a catch-up cannot
  give the semi-blocker). **Special-event suggestions** (`lib/chefEvents.js`,
  `EventsPanel.jsx`, step 4's third choice): a day, an ingredient, an amount
  and a share the tool finds, the same for every segment; common, rare and the
  semi-blocker (never the blocker, never past a threshold); the fewest
  ingredients given between equals; the economist's sources untouched
  (`origin: 'events-suggested'`). **Step 6 measures a basket's worth day by
  day** on the engine (`lib/chefBasketWorth.js`), a reading beside the
  economist's tier worths. Chef's rules are the economist's the way the Merge economy is: a
  suspected flaw is measured, said on screen and written down, not fixed,
  and what is not confirmed about the real game is a visible setting, never
  a silent constant.

## The platform (home page, catalog, server)

The home page and everything around the tools is the **platform**
(`docs/architecture.md`, setup in `docs/setup.md`, the model list and its
workbook-source uncertainties in `docs/catalog.md`). In short: the catalog is
`src/platform/registry/catalog.ts` (22 models, 18 of them not built yet; add one there plus a loader
in `modules.ts`, never by editing the home page); every model opens at
`/models/<slug>` as a lazily loaded module that owns its page; the home page
searches display names only and filters by shared folders, both kept in the
URL; folders, placements, model documents and shared assumptions live in
PostgreSQL behind the toolkit server (`server/`, TypeScript, Hono, Prisma,
better-auth), checked per workspace membership on the server, with
optimistic concurrency (`expectedRevision`, 409 on a stale write). No model
has a server-side document schema yet - the existing tools still keep their
work in the browser - and none may be invented. Merge Mania's `?s=`, `?play`
and `?plan` links open as before. The GitHub Pages deploy serves the site
only: there, the home page works without folders.

## The economy (shared by every feature)

**Read `docs/economy-rules.md` before touching a prize, a reward text, a value
table or a segment condition in any feature.** The economist's "Economy Rules &
Reward Syntax": value is always **allowance** (coin 1, wild 2.5, extra stock 2,
undo 0.25, free round 1, energy feature-specific), reward text is built from
parts and checked, keys (currencies, packs, presets, chests, triggers, buckets)
are **never invented** - they come from the Economy page's lists - and the
sheets' rounding rules (RoundReward, MergeRoundReward, spin cost, ...) are
matched exactly. Rules in `src/lib/economy/` (rounding, economyModel, syntax,
parse, segments, economyStore); the **Economy** page on the home screen
(`src/features/economy/`) holds the values and keys. **The app is taught in
the project** (economist, 25 Nov 2026: what they and their coworker teach is
kept "In the project", taught by "Explain in chat", the basics first):
`src/lib/economy/taught.js` holds every value taught, with the words it was
said in, the day and who said it, and a taught value wins over a browser's
own (the page marks it "Taught" and has no field for it). What is typed on
the page and not taught stays in that browser, listed on the Worth tab with
"Copy as a message". When they explain a value in chat, write it there - never
invent one. **Four currencies are always in the game** (`CORE_CURRENCIES`,
economist): dr-puzzle a value a day, dr-pet a value a live week (7 days from
the day typed), dr-merge and dr-pickaxe one fixed worth "for now" - a table
of their own; **a date with no value is unknown**, never the nearest one, for
every dated currency. Other currencies are added from a
drop list (`GAME_CURRENCIES`: the economist's list of the game's currencies,
copied as given; dr-basket-counter on it is never offered - removed by them).
**Segments are being taught function by function** (economist, 25 Nov 2026;
"the BW and avg mode are very very important"): `segmentFunctions.js` is the
dictionary (Brut Wins and the mode multiplier - modes x1, x2, x4, x8 -,
`CoinsInAllowance` and `CurrentLevel` without brackets, `fn_Avg_winrate(days)`
(a share, written `0.9` with no m - confirmed by the economist), a cohort
`PjCohorts.ContainsCohort(id)` (true or false), Chef dishes
`(GetMTXEventDataListAsStr(<id>U, "CompletedItems")?.Count() > N)`, Diamond Mine and
Merge progression by event id), with their words. **Parts of a condition
are joined with `&&`**. The Segments tab is a flow (`segmentFlow.js`,
economist): the feature, the base (the bands of one rule, toggled - Brut
Wins most of the time; each rule named by its fixed code, BW, Level, ...,
ChefDishes - the last this app's own), specifics (parts
added to the segments picked, a typed tag in their names) and mode splits
(duplication of the segments picked); it also reads any condition in words,
naming a function it does not know. Add a function only as explained in chat.
**These rules are for prizes on a feature's tiers only** (economist: "all the
rules we got from befor for small reweards and twister are untouched"): Merge
Mania's small rewards keep their own rounding and up to 3 coin decimals, the
Twister's price stays any whole number. Chef's grand prize follows RoundReward;
Chef's value table comes from the economy (a chef keeps its own copy, step 2
says when it differs). **The checker holds the rules of the economist's own
validator, "Reward Scanner Pro"** (economist: where the two disagree, "The
validator's"): dynamic in brackets, what a [ ] group may hold, whole currency
amounts, lower case triggers, an unknown currency, bucket or preset an
error, and its prize count with its limits; where the validator is looser the
app's stricter rule stays (economist: "keep both") - docs/economy-rules.md, "The validator's
rules". Merge's Syntax tab reads its item text with the checker
(a reading only). Diamond Mine is not connected. Open questions are listed in
that file.

## Repository map

```
src/
  main.tsx, index.css              app entry (renders src/platform/shell/PlatformApp)
  App.jsx                          the Merge editor, play link and plan link screens (no routing any more)
  platform/                        the platform: registry, home page, routing, API client (docs/architecture.md)
  models/                          platform-owned model pages (Merge Mania wrapper, "not migrated")
  components/                      shared UI (HeroPage, ui/Button, Card, Collapsible, NumberField, Slider, InfoHint)
  lib/gridWidth.js                 shared grid sizing
  lib/economy/                     the economy every feature shares (docs/economy-rules.md)
  features/economy/                the Economy page (worth, keys, check, build, segments, rounding)
  features/merge/
    lib/core/        ranks, board, layout edits, the bank of board layouts, item generation and
                     placement, onboarding goal, generator tiers, lucky drops, subsidy budget
    lib/simulation/  mergeSimulation (the engine), playSession (interactive play),
                     effortTargeting, ccManagement, simulationRows
    lib/rewards/     small rewards: reward chains, drop groups and containers, placement under
                     tiles, the configuration workflow, Twister economy, endless mode
    lib/build/       eventBuild (the guided build), legacyRecompletion
    lib/export/      eventSheets (Ops workbook), Google Sheets export, boardSyntax (placeholder)
    lib/share/       stage and plan links (letters and digits only; the stage link's short writing)
    lib/state/       persistence (localStorage), useBoardListState
    lib/play/        artwork lookup, tile surfaces, celebrations, phone layout hook
    components/build/    the Build event flow (5 steps) and its review
    components/editor/   advanced board editor, board list, simulation report, CC management
    components/rewards/  advanced Rewards and Twister tools
    components/play/     Play Tester, Play Stage (shared link), tiles, effects, celebrations
    components/export/   Syntax tab
    assets/game/     the artwork in use (copied and trimmed from art-source/)
    data/            the demo stage
  features/diamondMine/, features/chef/   other features (Chef: a six-step flow, see docs/chef-overview.md)
server/            the toolkit server (API, auth, folders, documents, assumptions)
prisma/            database schema and migrations
tests/             Vitest: platform logic and the server on a throw-away database (npm test)
scripts/
  e2e-platform/    the home page in a browser, two members at once (npm run test:e2e:platform)
  verify/          engine checks (npm run verify)
  e2e/             browser checks against the dev server (npm run e2e; one: npx vite-node <file>)
  art/             prepare the artwork from art-source/
art-source/        the economist's original asset packs (untracked)
reference/         the economist's reference spreadsheets: Merge Out.xlsx (Small Rewards
                   syntax example), chef_*.xlsx (Chef source data) (untracked)
docs/history.md    the full design history
docs/chef-overview.md   the Chef feature: what it is and how to work on it
docs/economy-rules.md   the economy's rules, where they apply, what is open
```

Dev: `npm run server` (the API, port 8787; see docs/setup.md) and `npm run dev` (port 5173, `strictPort` - localStorage is per origin
including port, so never let it drift). `npm run build`, `npm run lint`
(oxlint). The site is published by GitHub on a merge into master
(`.github/workflows/deploy.yml`); `npm run deploy` refuses.
Hosting: `https://idog-lab.github.io/EcoSystem/` - the work repo
(`origin` = idog-lab/EcoSystem since 25 Nov 2026; the old repo is the remote
`personal`, idoggk/Merge, pushed to only when asked). `base: '/EcoSystem/'` in
`vite.config.js` must match the repo name; `PRODUCTION_ORIGIN` in `App.jsx`
is what every share link points at. Links made before the move point at
`https://idoggk.github.io/Merge/` and open there for as long as that site is
up. The dev server is `http://localhost:5173/EcoSystem/`.

## Domain model

**Value chain.** An item of rank `r` is worth `2^(r-1)` DR. Rank 12 = 2048 =
the normal event's grand prize; rank 14 = 8192 = Recompletion's. Almost every
calculation rests on `valueOf(rank) = 2^(rank-1)`.

**Segments.** 8 player segments (`SEGMENT_COUNT` in `App.jsx`; `EditorApp`
calls `useSegment` once per segment unconditionally - growing the count means
adding hook calls and the per-segment dependency arrays of the sync effects).
Each segment owns its main board list, Recompletion list, presets, demand,
targets and schedule. **Synced from Segment 1 to all segments** (live, the
other segments show them locked): board layout and count, rank windows,
forced semi ranks, rank rewards, lucky-drop EV, event dates, and every shared
reward setting (`SYNCED_REWARD_FIELDS`: reward definitions, drop groups and
tables, drop start rank, single/two/three-item ranks, reward under the tiles,
"build may change rank values", Twister-by-build, leftover policy). Segments
differ in subsidy (demand), reward targets (base x factor), **the rank values
the build gives - coins, puzzles, merge energy and charms, each segment its
own** (`mergeSharedRewardChain` keeps them through the sync while the typed
definition is the same - **whether or not a ladder carries the build's
`typed` mark**: a build that gives a segment exactly the typed values leaves
no mark, and that segment's values used to be replaced by Segment 1's) - and **the four Twister values and the price of a
twist, each segment its own** (fitted by the build; typed Twister values are
the definition and shared).
**Only the segments in use are in sight** (`segmentInUse`, `shownSegments` in
`App.jsx`): the bar in the header and step 1 show a segment that has a DR
demand or DR on its boards, one given a name of its own, the one selected, and
any brought in with "Add segment" (kept for the visit); Segment 1 always. A
segment out of sight keeps whatever it holds. Tables and "not built" lines of
the flow name only the segments in sight.

**One event, one table** (economist: "as for now its the same for both normal
and RC"). The game has one Small Rewards table, one Bank and one Weights
table for the normal event and Recompletion. So Recompletion has no drops or
rank values of its own: a Recompletion build is `inherit` - every segment
takes its own normal-event values and drop rules (`eventRulesOf`) and the
normal event's containers and weights (`eventDropsOf`), and applying it
writes exactly those onto the Recompletion boards. What a Recompletion
player gets therefore FOLLOWS from the normal event; its targets are compared
with that, not sized for (economist, asked: "Normal exact"). The only things
that are Recompletion's own: the reward under its tiles, and the two table
rows only it can reach - the merges that make rank 13 and 14, one container
each (`tuneRecompletionTopRows`, set on the base segment). Anything typed for
drop rules or values in the Recompletion phase of step 3 is not used (the
step says so).

**Subsidy.** The economist types each segment's **demand**; the DR typed on
the boards is chase value - demand, where the chase is 2048 for the
normal event and 6144 for Recompletion (`chaseValue`; the player arrives with
a rank 12 worth 2048). **Demand is the DR the player really pays** (economist:
"the intended average DR its player actually pays during that phase under the
baseline careful-player policy"). Chase - demand is a statement in value, and
a player pays less than that (lucky drops, free taps): 12% less on average in
the normal event and 14% less in Recompletion before this rule. So the build
**calibrates, in both directions** (economist: "'Subsidy is never added' is
not an economist requirement"): besides the 80% merge-energy credit - its own
rule, untouched, never counted twice - it moves the later boards' subsidy
(`calibration` in `allocateSubsidy`, **signed**: + taken off, - put back;
moved pass by pass in `buildSegment` by the DR the average simulated player
is short or over, kept between the calibrations already seen from both
sides) until that player pays the demand within `demandToleranceFor` (2%, 4%
in Recompletion, at least 10 DR - this app's own). That is what the build
AIMS at. **What passes is the economist's mark: the average player pays the
demand within 5% of it or 30 DR, whichever is smaller, in both phases**
(`demandMarginFor`; economist: "for DR usage we can give 5% or 30DR (the
smaller one for the segment)"). The aim is never looser than the mark
(`demandAimFor`); inside the aim a figure reads Close, inside the mark Within
margin, and only outside the mark does a segment get the cause `demand-off`
(`demandFit.within` is the aim, `demandFit.inMargin` the mark). Under a
demand of 200 DR the mark is tighter than the old 10 DR floor; over 1,500 DR
it is 30 DR, tighter than 2%. Recompletion's spend is
counted from the moment it begins (`drSpentRcPhase`). Board 1, every board's
floor, what a board's tiles can hold (`maxFeasibleBoardValue`), rank limits,
pins and exact queue values are kept; the boards never end with more than
the chase. The accounting is shown step by step and never mixed
(`demandFit.steps`: subsidy typed, energy credit, signed calibration,
generated). When the mark cannot be met the build says so (`demandFit`,
cause `demand-off`, "Can be improved") and says which kind it is
(`demandFit.limit`): **`proven`** - `no-subsidy-left` (the later boards are
at their floors: the player cannot be made to pay more) or `boards-full`
(they hold all their tiles can: cannot be made to pay less); **`jumps`** -
two passes with almost the same subsidy paid on either side of the demand
(`demandFit.jump`; Recompletion, where single items are worth hundreds of DR:
the same subsidy gave 756 and 1,148 DR on two sets of boards, single builds),
so no amount of subsidy lands in between and another build can; or
**`not-settled`** - the passes ran out. `spendRange` is what the passes found
a player paying. Step 4 shows demand, average and middle player, difference,
completion and the signed calibration; step 5 shows the spread with real luck. Recompletion's demand is the normal event's, read-only
(`rcSubsidyForMainSubsidy`). The last board is never typed: it closes the gap
(`fillLastBoard`). Board 1 carries at most 150 DR (300 on Recompletion,
`firstBoardCapFor`).

**Boards.** Tiles are `blocked`, `semi` (visible, needs one merge to free) or
`open`. `blockedValue` is the board's budget; `effectiveBlockedValue` is what
a build allocated (read through `generationTargetOf`). Generation hits the DR
exactly; item count is soft; the rank floor and ceiling are hard (the floor
rounds the target up). Placement = distance-to-open-tile order, then a noisy
ascending queue. Positional rules:
- Board 1 guarantees small ascending items, its semi tiles are rank 1, the
  fixed cell (row 2, col 4) is rank 2; it opens with runs of 1, 1, 2
  (`openingRun`); its items never exceed rank 8. Board 2 never gets rank 1,
  Board 3 never ranks 1-2, Board 2 items at most rank 11.
- Recompletion: **no main item below rank 3 anywhere on its boards** - semi-blocked
  cells, the fixed cell and hand-pinned ranks included (generation raises them; the
  pin brush starts at 3). **The generator holds this itself, whatever `minRank`
  a board's data carries** (`boardMinRank` in board.js, and `generatePlacement`
  raises a Recompletion board's own `minRank`): a Recompletion list saved with
  `minRank` 1 used to get ranks 1-2 (economist: "there is a hard rule, no ranks
  1 and 2. u keep on generating RC boards with rank1 and 2 in them"). Never read
  a board's lowest rank any other way. Rank 13 allowed
  under tiles and as a pinned semi rank. **Its Board 1 is not an onboarding
  board** (economist: "there is no onboarding experience that needs to be
  met"): no starting goal, no opening run (`isRecompletionBoard` - every
  board of that list carries `listPhase: 'rc'`, stamped by
  `useBoardListState({ phase: 'rc' })`). It keeps the fixed cell (rank 3 there)
  and RC event mode, and lands exactly on its 300 DR.
- **The first board's two rules** (economist: "the rank2 we got in the first
  board should be hardcoded into the board in any time, and the 2 cells in the
  rightest column in the bottom of the column should always be empty. those
  are used in the tutorial of any board in the game itself"): the fixed
  rank-2 cell (above), and **the two bottom cells of the rightmost column are
  always empty** (`tutorialCells` in board.js) - open, nothing under them, no
  pin. Every layout edit keeps them so on the normal event's first board
  (`forceCells` / `hasTutorialCells` in layoutEdits.js: paint, fill-all,
  resize, a pick from the bank); Recompletion's first board and later boards
  are not tutorial boards. A first board saved before the rule is not
  rewritten: step 2 says so and offers "Empty these two cells".
- **The bank of layouts** (`lib/core/boardBank.js`; economist: "in the board
  layout ill just pick from the bank of boards which one we will use this
  time"): 18 first boards (5 x 8: 7 standing, 6 hanging, 1 diagonal, 4 drawn
  for Black Friday) and 9 later boards (up to 3 x 8), picked in step 2 as
  pictures (`BoardBank.jsx`;
  `applyLayout`; "Undo" brings back the layout from before the pick with what
  was built under it). What a board of the bank is, all economist rules:
  - **Enough tiles** ("a bit more tiles ... we are looking for a good amount
    of rank1"): a first board has 20 to 24 tiles, which gives 8 to 11 rank-1
    items at 150 DR.
  - **Guides** ("we need some semi blocked on the board ... the players are
    rather not so smart, and we should guide them to where to merge on to
    reveal more tiles"): three semi-blocked tiles besides the fixed cell on a
    first board (two on a later board), each with at least two blocked tiles
    beside it (`guidesOf`), so merging into the item in sight opens more. On
    Board 1 a guide holds rank 1.
  - **Standing, hanging, diagonal** ("u are creating only boards who are
    weighted down with gravity, can u crete also ones that are hanged up?"):
    `BANK_GROUPS` - tiles on the floor, tiles hanging from the top, a
    diagonal band.
  - **Symmetrical to the eye, judged by the tiles alone** ("we need to look at
    the 2 putple tiles as empty, we need to see the boards only with the tiles
    on them. i want them to be simetrical to the eye"): the left half mirrors
    the right - the shape AND the tiles in sight (`symmetryOf` 'mirror'). The
    two tutorial cells are empty space like any other, so their mirror cells
    at the left edge are empty too: a standing board is six tiles wide in its
    two bottom rows, centred. The fixed rank-2 cell has a guide on its mirror
    cell, so the two items in sight in the middle of row 3 are a centred
    pair. The one diagonal is the same turned half a circle (`'turn'`), with
    the same number of tiles in every row (economist, of rows of 4, 4, 4, 4
    and 5: "this is not simetrical"). No steps, no block against one side.
    The picker draws the tutorial cells as plain empty space.
  - **Drawn for an occasion - ON TRIAL** (economist, of four Black Friday
    shapes: "lets try to enter all for now, ill try to see them in the model
    it self"): the group `black-friday` - Gift box, Price drop (an arrow
    down), Sale sign, Floating gift. First boards like any other, held to
    every rule above. The economist has not chosen among them: do not treat
    them as settled, and remove the ones they drop.
  - **One solid shape, no holes** ("the boards that looks like htey have holes
    in them, i dont like those. we need boards that doesnt look like they were
    a mistake"): the tiles are one piece, no row or column has a gap, and the
    fixed cell is part of the shape (`isSolidShape`). No lanes, tips, arches
    or checkers.
  - **The simulator solves every one** ("i need boards that the simulator can
    ofc solve. if he cant solve, check why and fix").
  All of it is held by `verify-board-bank.mjs`; add or change a layout only
  with that suite passing.
- Economist pins (`forcedSemiRanks`) survive generation.
- A wave board (every board after the first) is at most 3 rows and pushes in
  from the top once the board above is cleared.

**Play rules** (shared by the simulator and both play screens).
- Merging is position-agnostic. A semi/revealed item is `stuck`: it can be
  merged into, never moved, until merged into once. A free item moves to
  **any** empty open cell, however boxed in it is (economist: "he acts as if
  he is blocked").
- **A merge opens the locked tiles next to the cell it happens in** (the
  receiver's), never next to where the moved item came from - on the play
  screens and, since the "close for every player" round, in the simulator
  too (`revealAroundMover` is false by default; it was true for a long time
  and made the simulator a slightly luckier game: 9% more coins in a segment
  with a lot of subsidy). The careful simulated player therefore merges two
  free items NEXT TO a locked tile (`mergeWhereItOpens`, `nextCarefulMerge`:
  the item is moved to an empty cell beside one first if need be).
- "Reaching" a rank means holding a FREE item of it.
- Generator tiers x1/x2/x4 unlock at configurable ranks (7/10), re-lock
  dynamically. Lucky drops: one EV per list, geometric solve with a blended
  +2 (`BONUS2_BLEND` 0.2), valid EV 1 to 7/3.
- A board is cleared when no locked tile can still open and nothing is stuck
  - **including semi-blocked reward items** (it waits for them). Exceptions:
  a reward carried into Recompletion (`state.passive`), and runs with no drop
  tables at all (`rewardsCanOpen === false`), where reward items arrive free.
- Recompletion starts the moment rank 12 is reached; everything on the board
  comes along. Rank 14 starts **endless mode** (play sessions only): same
  board, drops one rank lower, 1.5x per drop, 80% coins and energy (all three
  numbers this app's own, labelled as such). **Merge energy in endless is held
  to what cannot pay for itself**: at most 50 free taps per 100 DR of generator
  output (`ENDLESS_ENERGY_PAYBACK_MAX` 0.5, this app's own; what is taken off
  the merge energy drops as coins). Before that, endless gave back more taps
  than it used: a robot on a shared stage paid 45 DR and got 28,000 free taps
  and tens of thousands of rewards (economist: "he ended up with crazy rewards
  from the small rewards").
- The simulated player taps a smaller tier when only that frees a tile.

## Small rewards

Four resources with targets - coins, puzzles, merge energy, charms
(`REWARD_TYPES`) - plus **Twister DR** (drop-only, no target). Each is a
rank 1-4 chain; rank 4 collects at once. Encoded `>= 1000` on the grid
(`encodeReward`); never pass an encoded value to `valueOf`.

- **Coins are an allowance worth** (`allowance(coins:0.12)`), formatted with
  up to 3 decimals. Puzzles, energy and charms are whole numbers. The build
  sets coin values per segment while none are typed; typed values are shared
  and never overwritten.
- **The model gives the rank values, in round amounts** (economist: "i want
  the model to give the values of the ranks but with nice rounding for the
  amounts"). For every segment, each reward's four values are round
  (`niceRewardValues`: whole numbers under 10, multiples of 5 to 200, of 10 to
  1,000; coins in hundredths, `niceCoinValues`) and **strictly reward merging**
  (economist: "V2 > 2 x V1, V3 > 2 x V2, V4 > 2 x V3. Equality is
  insufficient" - every rank MORE than double the one below, Twister
  included; the smallest whole-number ladder is 1/3/7/15, `REWARD_MIN_TOP`
  15; `validateRewardLadder` flags an equal step as
  `merge-step-pays-no-more`; a typed ladder that breaks it is never changed
  on its own, it gets fixes to choose from) - so tapping an item early never
  pays more than merging it on. The
  proportions follow the typed ladder when that one already rewards merging,
  else 1:3:7:15. They are set last, on the boards the segment really gets and
  on 150 simulated players (`fitValuesOnFinalBoards`, `FINAL_FIT_RUNS`), so
  the average lands on the segment's amount within half a rounding step
  (about 3% at a top value of 75, 6% at 40 - what round amounts cost). A
  later pass of the same build keeps the values of the pass before unless
  the amount is clearly off (`VALUE_DEAD_BAND`). Typed values stay the
  definition (`typed`); switch the whole thing off in step 3. **Any screen where values are typed or pasted must
  pass the result through `withTypedLadders`**: it drops the build's `auto`
  mark from a ladder whose values changed. (The Twister tool and the Rewards
  tab once kept it, so the next build replaced typed Twister values - "a rank 4
  pays 165".) One item pays one resource (an item syntax joining
  several with "+" is flagged).
- **The item text follows the value the game pays** (economist, choosing
  "text follows the value" over "only warn"): the simulator, the build and
  both play screens pay a rank's `prizeAmount`; the Small Rewards sheet
  writes its `syntax`. A text with exactly one `dynamic(name:N)` amount (or
  the plain coin-allowance pattern) carries the value - when typed in the
  Rewards tab, when the build re-values (`applyLadderValues`, whatever number
  it held), when a project is opened (`ensureRewardChainConfig`, `typed`
  too) and in the export (`syntaxForValue`). A text with several amounts or
  none is left as written and named on the Syntax tab (`rewardTextIssues`).
  (Found from a report: a charm paid 15 in the Play Tester while the
  workbook said 65 - the text was out of step before a build, and the build
  only rewrote a number equal to the old value.)
- **Leftovers are collected** (`DEFAULT_LEFTOVER_POLICY` 'collect'; economist:
  "after getting to rank 12, merges all the small rewards and collect them. to
  understand how much really the user got"). What is still unmerged when a
  phase's top rank is reached is **merged first, then tapped** and paid at
  its rank's value (`settlePhaseLeftovers`, `mergeFirst`: a free item opens a
  semi-blocked one of its rank, pairs merge on up the chain; the player who
  taps when it pays does not merge those ranks; tapping them as they lay
  under-counted merge energy by 7% against the robot);
  'forfeit' (the old assumption) is still selectable in step 3. A project
  saved before this rule is switched to 'collect' when opened
  (`migrateLeftoverRule`, the save's `leftoverRule` mark). In a run that goes
  on into Recompletion nothing is settled at rank 12 (everything comes
  along), but the tap value of the free reward items held at that moment is
  counted to the normal event and taken off Recompletion's
  (`carriedIntoRc`), so the two phases always add up to the run.
- **Merge energy** funds free x1 taps and earns an **80% credit** taken off
  the later boards' subsidy, once per phase (Board 1 protected). The credit is
  80% of the energy **collected**, used or not. Where the energy of a phase
  goes is measured (`energyFlow` in the simulator, per phase: `start` carried
  in, `play`, `cleanup` at the phase-end collection, `used` on free taps,
  `left`; `energy` in `cadenceSummary`). Three test events, the average
  player: in the normal event 74% of the energy collected is used in the phase
  (45% to 91% by segment), 16% is collected only at the end and 26% is left
  unused; in Recompletion 81% is used, and the 26 carried in is spent there
  but was credited once, in the normal event. No cap was added - whether the
  credit should follow the energy used is an open question.
- **Three kinds of player** (`collectPolicy`, `findTapCollectCell`). A reward
  item can be merged on or tapped to collect it as it is, and that changes
  what a player ends up with. `'merge'` (default; the player every build is
  sized for) merges everything. `'best'` taps an item when no higher rank
  pays more a piece (`tapPaysAtLeastAsMuch`) - with the reference values
  (puzzles 5/15/15/40, charms 5/10/30/40) that is about 1.5x the puzzles and
  charms. `'all'` taps every item: a reward under a tile is then never
  opened, the board never clears, the later boards never arrive, and the
  player spends several times the DR (free on a play link). Step 5's
  validation plays all three ("The same event, played by different players",
  `validateDraftSegment().styles`) and says where a tap pays more. With the
  values the model gives, a tap never does - the first two players are then
  the same; it only shows when the model is switched off and the typed values
  do not reward merging.
  `scripts/verify/playRobot.mjs` plays the real play engine the same three
  ways; the simulator has to agree with it (verify-real-play.mjs) - and with
  steady containers it does **to the last item**: a careful robot collects
  exactly the simulator's amounts for the same DR.
- **A fourth player: merges without looking** (`options.mergeRng`,
  `carelessMerges`, the robot without `careful`). Free items merged with each
  other while a semi-blocked one of their rank waits; what is still
  semi-blocked when the top rank is made is subsidy never used. In a segment
  that lives on its subsidy that player paid 35-50% more DR and collected
  5-15% more (single builds); elsewhere nothing changes. Step 5 shows the
  row; the build is still sized for the careful player.
- **How close is ONE player** (economist: "we need to make sure we will know
  that the resources the user gets will be some what close to what we wanted
  him to get"). The simulator's averages were right; two players were not
  alike, because which container a merge rolled was chance (one test
  segment: 28 of 100 players within 15% on every reward). So:
  **steady containers** (`steadyDrops`, step 3 "Every merge of a rank drops
  the same items", on unless false; `steady` in
  `buildAlwaysDropConfiguration`, this app's own design inside the item-count
  rules): one container per merge rank - rank 6 always the one item of the
  reward under the tiles, the one-or-two rank its reward with the Twister
  item in the share the rise gives, a two-item rank one reward and the
  Twister item, a three-item rank three rewards; which reward and what size
  at which rank is solved so each lands on its amount, and the rank values do
  the rest. The Twister item has one size per merge rank too
  (`resizeTwisterDrops` `steady`). Needs "the build may change rank values".
  Result on test events: every player the same puzzles, energy and charms,
  100 of 100 within 15%; what still differs is generator luck (DR, sd 2-5%)
  and the Twister (4-6%).
  **Step 5 validates on 300 players who roll their own lucky drops**
  (`randomLuck` / `luckRng`; the build itself sizes on players with scheduled
  luck, an average free of noise) and shows, per reward, "players within 15%"
  (`nearShare`; 25% in Recompletion) and how many are near on every reward at
  once (`allNearShare`, `validation-closeness`).
- **Margins**: a reward within **15%** of its target is met; board DR within
  5%. **Recompletion: 25% for both** (economist: "the miss amount can go up to
  25%") - always read through `offTargetToleranceFor(phase)` /
  `drToleranceFor(phase)`. **DR usage** - what the player pays against the
  demand - passes within **5% of the demand or 30 DR, the smaller**, and **the
  twists** within **5 points of the 70-75% window**; both are the economist's
  and the same in both phases (see Subsidy and Twister). Offered and declined
  for now ("None for now"): a mark for the share of players who finish, one
  for how many single players land near, and "15% or one smallest item" for
  small amounts. A reward amount never blocks a build ("Can be improved", with quick
  fixes); only structural problems block ("Needs a fix").

**Drop rules (economist, the current set - hard rules).** From the drop start
rank (default 6, "the rank the merge makes"), every merge drops; the start
rank is never moved by the build.
- Rank 6 (the single-item rank, `soloDropRank`, "up to rank" in step 3): **one
  item**, 60% of them a rank-1 item of the reward under the tiles
  (`TILE_REWARD_FOCUS_SHARE`, this app's own) - all of them with steady
  containers (see "How close is ONE player").
- Rank 7: one or two items (two in the share the rise gives) - **always two
  when the build places the Twister: its reward and the Twister item**
  (`TWISTER_PAIR_RANK` 7; economist: "A main-chain merge creating rank 7
  always drops two items: its existing non-Twister reward plus its Twister
  item"). Ranks 8-9: exactly two (`multiDropRank` 8). Rank 10+: exactly
  three, **only** from there (`tripleDropRank` 10). Never more than the rank
  allows.
- **Rank 5: exactly one rank-1 Twister item, and nothing else** (economist:
  "The rank-5 exception applies only to Twister. Other small rewards still
  start at rank 6"). The start rank stays 6; the rank-5 row of the table is
  marked `belowStart` and the engines roll a row so marked although it is
  under the start rank (`performMerge`; `tableDrops`, `firstDropRank`,
  `TWISTER_FIRST_DROP_RANK` in dropGroups.js). Containers, exports (merge
  tier 5 in Small Reward Weights) and play links carry it. The Twister resize
  never touches that row.
- When the rules cannot carry an amount: items get bigger first (rank 3 at
  most, never a rank-4 drop), and the **rank values** do the rest (see "The
  model gives the rank values" above; 0.1x-10x of the typed top value, this
  app's own). Typed values stay the definition (`typed` on each re-valued
  rank, `withTypedRewardValues`); every build starts from them; the values
  given are a result, per segment, shown in step 4. Switch off in step 3
  ("The build may change a reward's rank values"). A target smaller than one
  top prize gets smaller values before the solve.
- Coins the build values are the filler above rank 6 (they ask nothing of the
  drops; they take places the others leave).
- The containers ARE the Ops "Small Rewards Bank" (ContA, ContB, ... with
  per-merge-tier weights out of 1000).

**Under the tiles (economist).** One reward only (`tileRewardType`, default
coins; step 3). Board 1 holds none (in a list of 2+ boards); **only Board 2
holds items above rank 1** (rank 1 then 2, a chain one drop opens); every
other board rank 1 only; at most 4 reward items on a board before the last.
At most 40% of a reward is asked of the tiles - the drops are the bigger part.
A reward with no drops gets nothing under tiles (it could never be opened).

**Twister.** The build puts it into the drops (`twisterByBuild`): a quarter
of every rank's drops, taking a reward item's place, rank 1-2 items to start
(with steady containers: in every two-item drop and the one-or-two rank's
second place, one size per merge rank).
**The twists are reached at 70-75% of the segment's DR demand spent**
(economist), in recurring chances to spin - and that is what the build prices
with. `demand progression = paid generator DR in the phase / the segment's DR
demand` (`phaseDemand`): the x1/x2/x4 cost of paid taps only - free
merge-energy taps add nothing - never main-chain value, board, merge count or
time, and never clamped at 100%. A spin is taken whenever the balance affords
one, several from one collection, the rest kept. What is merged up and tapped
at a phase's top rank counts at that moment and is named the phase-end
collection (reaching the twists in play / only at the end / never are three
separate figures).
**A segment passes when its twists are reached within 5 points of that
window** - 65% to 80% of the DR demand (`TWISTER_WINDOW_MARGIN_PTS`;
economist: "up to 5% margin for the twister finish" - asked what the 5% is,
and answered: points of the DR demand, the same in both phases). The window
is still what the build prices for. `twisterMark` reads a row's timing as
`in-window`, `near` (outside the window, inside the margin: it passes) or
`off`; an `off` segment gets the cause `twister-off` and reads "Can be
improved" (`withTwisterMarks`: put on at the end of `buildEvent`, and put on
or taken off again by `repriceTwister`, since other twists are priced
without a rebuild). Before this the Twister's timing never failed a segment.
- **Per segment, on the final boards** (`fitTwisterForBuild` in
  `rewards/twisterCadence.js`, called at the end of `buildEvent` and by
  `repriceTwister` when the twists change - no rebuild needed for that): each
  segment is played by 120 players with their own luck and gets the simplest
  values and price whose typical player lands in the window - values not
  under 2/5/12/30 (scaled the build's way, every rank more than double), then
  the lowest whole price (`fitTwisterToWindow`; Twister DR is its own
  currency, so only value / price matters). **The price is any whole price**
  (economist: "the twister spin cost isnt hard on the 10, the model can give
  any price for the spin to make it work"): a build's price step
  (`twisterCostStep`) is 1 unless rounding was switched on by typing a step in
  step 3's fold (`twisterPlan.roundPrice`); a `costIncrement` saved before
  that rule is not used by a build (the advanced Twister tool still uses it
  for its own suggestions). Typed Twister values are kept and
  only the price is fitted. **Recompletion plays the normal event's values**
  (one table): only its price is fitted, so it lands in the window less often
  - said in the row, never fixed by a table of its own.
- A row carries `cost`, `values`, `ladder` (written to that segment's boards
  when the build goes into use), `demandTiming` (`timingOf`: reach, verdict in-window / early /
  late / never, distance, in play / at the end / never, first spin, chances
  to spin, twists a chance, longest wait, twists at 25/50/70/75/100%) and
  `fit` (`reachable`: where the twists CAN land when the window cannot be
  hit - too few finished items for a moment in between).
- Step 4 shows it in one panel (`TwisterTimingPanel`): timing and cadence in
  separate columns, the distance from the window, never only "in or out".
- **Bigger Twister items stay an EXPERIMENT** (`CADENCE_CANDIDATES`, the
  "Compare" button in step 4, `scripts/analysis/twister-validation.mjs`). The
  candidate compared is **`bigger79`**: the Twister item a rank bigger only in
  the drops of merges that make ranks 7 to 9 (rank 3 at most), **rank 5 left
  as it is** - one rank-1 item - and everything else untouched (the older
  `bigger` raised rank 5 to rank 2, against the rule). Three test events,
  normal event: the timing is the same (16 of 24 segment medians in the window
  against 15, no segment further from it), the cadence is better - 17 chances
  to spin against 15, 1.1 twists a chance against 1.4, most of all in
  heavy-subsidy segments (7 chances of 3.0 twists become 10 of 1.9) - and the
  other rewards, the DR and the board do not move. In Recompletion it is
  mixed (12 of 24 in the window against 10, two segments 10 to 13 points
  further out). The economist has not chosen it;
  the production structure stays as it is until they do.
- Measured, not assumed (`options.cadence` in the simulator): the paid DR of
  every Twister drop, collection and merge; how full the board gets and how
  many dropped items wait off the board (`space`); the Twister items carried
  into Recompletion (`carried`; `rcCarryScenarios` reads the hand-over three
  ways - items carried, nothing carried, items and the unspent balance - and
  chooses none: it is an open question). A first spin is given in generator
  actions as well as in % of demand (`firstSpinActions`): "0.8%" in
  Recompletion is 25 taps in, most of it Twister items and energy carried over. Players of a comparison are paired:
  each has their own luck stream and their own container stream
  (`recordCadenceRuns`).
- The older Twister tool (Twister tab) still measures against main-chain
  progress and says so (`twister-two-clocks`). `twisterSteady`, the old
  "counted at" field and the sizing loops (`fitTwisterValues`,
  `priceTwisterForBuild`) are no longer part of a build.

## The Build event flow (the main path)

Five steps, ids `setup, layouts, rewards, build, finalize`, shown as: DR
demand · Board layouts · Rewards and Twister · Build · Test and export. Two
former steps are folded sections now: the generator, lucky drops, dates and CC
at the bottom of step 1 (`setup-generator`), the effort shape in step 4 beside
the Build button (`build-effort-shape`); their old ids still lead there
(`STEP_ALIAS`, `STEP_FOLD`, `goTo`). A step opens at its top (economist: "it
should take me to the top part of the page and not make me scroll up").

**The header** (economist: "the app is very heavy in text and buttons"; of the
advanced tools: "i use only the builder as for the last runs"): the three
tools of the main path (Build event, Play tester, Syntax), Share stage, Save,
and one **"More" menu** holding the project actions (Saved events, Share planning,
Export backup, Import backup, What a backup holds, Clear data) and the five advanced
tools. An advanced tool that is open shows as a tab while it is open. Every
tool works on the same state. Do not put a project action or an advanced tool
back in the bar.

**How the flow is presented** (economist: an economist "should be able to
open the app, understand what to enter, build an event, inspect the result,
and know what to do next without reading documentation"):
- **A step shows what has to be typed or judged; the rest is folded**
  (`Collapsible` in buildUi.jsx: a native `<details>` whose heading carries a
  one-line summary of what is in force, remembered for the visit, opened by
  itself with `openWhen` when something inside needs attention). Step 1 shows
  the demands and the reward sizes; the boards (how many, each board's share
  of the subsidy - open by itself when boards were typed by hand or do not add
  up) and the generator are folded. Step 2 shows the list of boards (board,
  layout, tiles - no capacity in DR: economist, "the most DR it can hold in
  the boards layout is useless") and the bank; changing tiles by hand (open when the board was drawn by hand), size,
  rank limits and onboarding are folded. Step 3 shows the four amounts and the
  Twister (one field a segment, one sentence for what the build does);
  per-segment amounts, drop rules, rank values and milestones are folded - the
  containers are shown where they are made, in step 4. Step 4 shows one Build
  button ("one phase only" a click away) and, after a build, the summary and
  - when the segment shown has something to look at - a small panel with its
  causes and their fixes (`segment-causes`); that segment's detail, the
  subsidy accounting, containers, Twister detail, boards and effort chart are
  folded. The detail never opens by itself ("Show the detail" in the summary
  opens it): with a flagged segment it made the step 2,321 px tall; the step
  is 1,562 px on a seven-segment project now (single build). What is ready is not listed: the readiness list shows only what is
  missing. Never fold a problem: a cause, a quick fix or a missing value stays
  in sight.
- **The words**: *DR demand* (what the player should spend), *board subsidy*
  (main-chain value under the tiles), reward *amounts* per segment = base
  amount x *reward size*, coins as an *allowance worth*, *Twister DR* and the
  *price of a twist*, *In use* (never "draft" or "applied"), *Tested on
  players* (never "seeded validation", "estimated", "energy credit", "factor",
  or "amount" for the demand).
- **After a build the summary leads** (`BuildSummary`): per built segment the
  player's spend against the demand, each reward against its amount, when the
  twists are reached and in how many chances, what to look at, and the next
  action. **"Close" is not "Within margin"** (`lib/build/resultMatch.js`,
  presentation only): close = within 5% of a reward amount or inside the
  build's own demand aim; within margin = accepted but not close (a reward:
  15%, 25% in Recompletion; the DR: 5% of the demand or 30 DR; the twists: 5
  points outside the window); off target beyond - each chip says what its word
  means in its hover. The panel says the figures are averages and that one
  player differs from the next - a build with nothing to look at is not a
  promise for every player (that sentence stays on screen).
- **A number field says why it did not take a value** (`CommitNumber`,
  `data-field-rejected`); a column of demands pasted into a demand field fills
  down (`pasteDemands`); a running build shows a progress bar.
- A table of segments leaves out the ones that are not built (no DR demand)
  and says which; the reward size is typed in step 1 only.
- Step 5 ("Test and export") says what is in use, then three buttons: test on
  players, play it, go back to the previous build (what each does is in its
  hover). The table of the four kinds of player is folded and opens by itself
  when a tap pays more than a merge.
- **As little scrolling as possible** (economist: "a layout for all the pages
  that it will still look good but will make me scroll as minimum as
  possible"), measured in a 1500 x 800 window on a seven-segment project
  (`heights.mjs` in the history): on a wide window (`xl`) step 1 has the
  demands beside the boards and generator sections, step 2 the list of boards
  beside the picker, step 3 the amounts beside the Twister; folded sections sit
  two in a row and one that is opened takes the full width
  (`xl:open:col-span-2`); tables marked `data-dense` keep low rows
  (index.css). In the Play tester the tiers, "Spend generator" and the Twister
  sit beside the board, in the first screen. Step 1 fits one screen.
- **Text is laid out gracefully** (economist: "we have in the app some layout
  and formating problems with how the text is displayed"), held by
  `scripts/e2e/text-layout.mjs` at a 1280 and a 1500 px window: no screen
  wider than its window; no table cell squeezed to a word a line; no field
  showing less than its text; no explanation over about 150 characters a
  line; no button label on several lines. How: a card's header wraps
  (`Card.jsx`); a tool page is `min-w-0 flex-1` so a wide table scrolls
  inside its own box instead of widening the page; **a table with many
  number columns gets one group head and short column heads** (the full
  meaning in the hover) - never a sentence per column (`ContainersTable`,
  `TwisterTimingPanel`); a note that belongs to a row goes on a line of its
  own under it; running text stops at about 105 characters (`.merge-app
  :where(p, li)` and `[data-note]` in index.css, base layer, so a width set
  on purpose still wins).

- `buildEvent` builds one phase for all segments, base segment first; others
  are solved against the base's shared drops (Recompletion: every segment
  against the normal event's). `buildSegment` loops up to 4 passes until the
  energy credit agrees within 0.5 DR or 1.5% of the DR the segment spends,
  whichever is more - and the average player pays the demand (see Subsidy);
  `MAX_PASSES` 6 (`creditToleranceFor`, this app's own: merge energy lands
  near its target, in round values, not on it; **5% in Recompletion**, whose
  energy follows from boards made anew in every pass - 1.5% of a 300 DR
  demand is less than one energy item). Rebalances shared drops when
  they over-pay other segments.
- The effort shape typed in step 4 (its folded section) is kept (saved across reloads) and
  the build picks, of 24 generated layouts, the one closest to it
  (`pickBoardsForEffort`), **judged with the build's own merge drops** - the
  same playthrough the step 4 chart shows. (Judged on the main chain alone it
  looked close while the chart showed rank 12 at 77% against 65% asked.)
  That section itself can only judge the main chain: the drops do not exist yet.
- **Recompletion has its own effort chart** (economist: "i want to be able to
  see the effort distribution on the RC also"). In the Recompletion phase the
  step 4 chart ("Effort distribution of this build") draws ranks 1 to 14,
  counted from the moment Recompletion begins: for each rank, the paid DR when
  the player first MAKES an item of it there, by a merge or from the generator
  (`rcEffort` in the simulator's result; `recordSeen` marks items only seen -
  carried in from the normal event, or on the board - which do not count). So
  rank 12 is the second one made, and 13 and 14 show what they cost. The chart
  reads it as a **climb** (`buildClimbRows`, this app's own reading): a rank
  is part of the climb when no higher rank was made before it, and costs what
  was paid since the last rank of the climb - never negative, adding up to
  100% at rank 14. A rank first made after a higher one (a late generator
  tap) is `aside`: its moment shown, no cost; a rank skipped (opened from a
  tile, merged into) has nothing. The normal chart is unchanged. A
  measurement only; nothing the simulated player does changed.
- **A change of the build's rules marks older builds "Out of date"**
  (`BUILD_RULES_VERSION`, the `rules` part of a build's inputs): nothing that
  was applied is altered on its own; the economist is told why and builds
  again.
- **A finished build is in use at once** (economist: "i dont understand the
  things with the draft all the time. draft vs applied" - asked, and chose "In
  use at once"). There is no draft to apply and no Apply button: a build that
  can be used is written onto the design the moment it finishes (`putInUse`
  in BuildEventPage.jsx: the build-owned fields, plus the boards' stamp,
  `buildStamp`), and the Play tester and the exports use it. A whole-event
  build puts both phases in use in the same moment. What was there before is
  kept - the boards (`applied.snapshot`) and the build before with its
  results (`applied.previous`) - so **"Go back to the previous build"**
  (`goBack`, step 5) restores it, one step back. **A build that needs a fix
  is never put in use**; the build before stays, and its results stay on
  screen. Internally a build is still the `draft` object (saved separately
  from the project) and "in use" is still read off the design (`applied`,
  `draftSegmentIsApplied`). "Not in use" remains for the three cases where a
  usable, current build does not match the boards - kept from a session whose
  boards were not saved, come with a backup, or boards edited by hand after
  the build - and step 5 then offers "Put this build in use". Never write
  "draft", "apply" or "applied" on a screen of the main path.
  `designConsistency` gives every tool one status (consistent / stale /
  unaccounted / manual / empty). Exports go through `ExportGate` and hold the
  event in use.
- Status words shown: In use, Not in use, Out of date, Nothing
  built yet, Not tested on players yet, Tested on players; per segment Ready,
  Can be improved, Needs a fix, Not built; per figure Close, Within margin,
  Off target.
- Editing a board's layout clears that board's contents; a share link refuses
  unbuilt normal boards and leaves out an unbuilt Recompletion.

## Exports (Syntax tab)

The tab shows one sheet at a time, picked in a dropdown (`syntax-view`), and
has one pair of export buttons with a switch for what they hold: the segment
shown, or all segments (`syntax-scope`). No board list beside it.

**Only the economist's pages, and none named "V2"** (economist: "we got alot
of pages that werent given to u by me in the example u can remove them ... u
can keep the endless ones. but, remove the reward chain, drop groups, twister,
and economy ... remove the naming of V2"). Per-segment workbook / Google
Sheet, in the reference tab order: Event Data, Multipliers, Board Layouts,
Recompletion Board Layouts, Generator Weights, Blocked Queue, Item Ladder,
Small Rewards, Small Rewards Bank, Small Reward Weights, then Endless Small
Rewards Bank, Endless Small Reward Weights and **Endless** (endless mode's
rules; it was "V2 Endless"). The combined all-segment export has the same,
behind a **Segments** page (S1 = the segment's name; kept, the economist
asked), each segment with its own "S{n} Board Layouts / Blocked Queue / RC
Board Layouts / Item Ladder / Small Rewards" (the values are per segment;
Bank and Weights are one table for all). **Small Rewards CC** (economist, 25
Nov 2026: "a CC for each option for when the player doesnt have anymore in its
game the items that drop"; `lib/export/smallRewardsCc.js`): two more sheets on
the Syntax tab, "CC Small Rewards Bank" and "CC Small Reward Weights", with
the CC picked - one for each combination of Twister, puzzles and charms (7;
"he can be missing all except of the merge"). A puzzle or charm the player
cannot get becomes a coin item of the same rank ("A coin item of the same
rank"). **A Twister item is not given** ("if a containter has a twister and it
dies we can just not give drops from it anymore") - **except in a container
of three items, where a rank-1 merge energy (`dr-r1`) takes its place** ("u
can enter a rank 1 energy into it"). A container that held only a Twister
item drops nothing: it leaves the CC sheets and its weights go to NoDrop -
merge tier 5 among them ("Nothing"). The other containers keep their keys and
weights; the rows a CC changes are highlighted. **They are part of the main output** (economist,
asked where: "Add to main output"): the workbook and the Google Sheet, for one
segment and for all, end with them after Endless - an index "CC" (CC1 = No
Twister ...), then "CC{n} Small Rewards Bank" / "CC{n} Small Reward Weights"
(15 tabs, one table for every segment); "Download the CC sheets" writes the
same 15 in a file of their own. With no puzzles or charms a container may name the same coin key
twice (coin-r1+coin-r1: two items) - economist: "the game reads it well". **Removed: V2 Reward Chain, V2 Drop
Groups, V2 Economy, V2 Twister** - so **the price of a twist is not in the
output** (it was only on "V2 Twister"; it is on screen and travels in a stage
link). The assets are on Small Rewards (economist: "in the small rewards page
is where we should see the asset"); the Twister's is `merge-config-twister-v2` (every other asset is v3)
on all four ranks (`TWISTER_ASSET`; economist, with a picture of their sheet:
"we are missing the assets of the twister"), filled in on opening a project
saved without it, an asset typed kept. The builders of the removed pages are kept in
eventSheets.js: the engine checks read the model through them. **The normal list and Recompletion are one event** (economist: "they
happen one after another in the same event"): Generator Weights runs to rank
14 (ranks 13-14 with the Recompletion list's own EV and unlock ranks; columns
T1-T14), the **Blocked Queue** holds the normal entries and then
Recompletion's with the Entry Number carrying on, the **Item Ladder** is tiers
1-14 (1-12 the normal list's milestone rewards, 13-14 Recompletion's), and
Small Rewards Bank / Weights run to merge tier 14 (`containersOfEvent`: tiers
13-14 are the two rows the Recompletion build sets). There is no
"Recompletion Blocked Queue", "RC Item Ladder", "RC Small Rewards Bank" or
"RC Small Reward Weights" tab any more: one event, one table. Production
takes different rank values per segment (economist: "it can take diff
numbers").
**Nothing is written twice on a page** (economist: "in alot of pages we got
many duplicants of think we dont need"): in the all-segments export a row of
Event Data, Multipliers or Generator Weights that is the same for every
segment is written once with "All" in the Segment column (`combineSegments`;
per segment only where it differs); the Normal and
CC text views say what a list shares (lucky-drop EV, rank rewards, the EV
bumps) once at the top and write reward items by key. What still repeats is
the reference format itself and stays: one Generator Weights row per rank and
multiplier, Pool Number = Entry Number with Stock and Weight 1 in the Blocked
Queue, the Section name on every Board Layouts row. An automated Ops parser reads these:
transcribe headers and values literally (typos included where the reference
has them), never use merged cells, keep row order. `exceljs` for styling;
Google Sheets via a browser OAuth token, values only, `RAW` input. The
economist's live reference spreadsheet is the authority on format. Reward
keys in queue/layout cells and the Endless pages are
unverified and labelled so. The Twister rows of Small Rewards are written
`[dynamic(dr-twister:value)]` when no syntax was typed (`twisterSyntaxFor`;
`dr-twister` is the game's name - economist, 24 Nov 2026: "its the name of
it"; the container key `dr-twister-r{n}` is still this app's own pattern), and a typed one-amount syntax follows the
values the build sizes (`syntaxWithAmount`). Open questions on the Small Rewards sheets
(literal coins vs allowance) were asked and not yet answered; which extra
tabs belong was answered (above).

## Play surfaces

- **Play Tester** (economist): any board, tier choice, jump to Recompletion /
  endless, compare to the simulator, warns when Recompletion boards are
  unbuilt. Its banner (`play-source`) always says what is being played - the
  build in use with the time it was built, whether the boards still match it,
  or (rarely) a build that is not in use - and leads back to step 4 or 5. The board list
  beside it only picks the board to start on (`pickOnly`): nothing is edited
  next to a game.
- **A play link with no Recompletion ends at rank 12** (`endAtGoal`,
  `sessionEnded`): the generator stops, what is left can still be merged and
  tapped. (It used to go on for ever after "the chain is complete", every
  merge still dropping rewards - economist: "my friend did those amount in
  the normal only".) The Play Tester does not end there. Taps on a link are
  free, so a player who taps every reward item (and so never opens the reward
  under a tile) can still play far past the DR a segment is meant to spend.
- **Play Stage** (`?s=...`, a shared link, no editor reachable). Made
  for a **phone held sideways**: the whole board and controls on one screen,
  nothing scrolls; upright it stacks and suggests turning; desktop keeps the
  roomy layout. `scripts/e2e/play-mobile.mjs` checks this. Tap-then-tap or a
  **finger drag** (pointer events, the board is `touch-none`, the page is
  locked from scrolling when sideways). Has the same jump-ahead buttons as
  the Play Tester when the link carries Recompletion. The merge that makes
  rank 12 plays out on the normal board first (`deferRcEntry`, held
  `RC_HANDOVER_MS` 1.5 s), then the Recompletion board slides down from the
  top (`RC_BOARD_MS` 1.1 s) - so the merge's drops are seen. **No first-time
  walkthrough** (economist: removed - it dimmed the screen and took every tap
  but one for exactly the people a link is sent to; the generator keeps its
  `data-tutorial="generate-button"` hook, which tests and effects use).
  Test a link as a FIRST VISIT (a fresh browser), never only as a returning one.
- **A stage link is as short as it can be made** (economist: "make sure the
  link of the stage as short as possible"): **format 3** (`stageShare.js`),
  about 230 characters after the address for a built event with Recompletion
  and about 150 for a normal event alone - it was 2,339. Three things: only
  what play reads travels (found by a robot on the real play engine and by
  reading the play screens - tiles, items, queue, reward values, containers
  and weights, the drop and generator ranks, the price of a twist, the ranks
  that carry a reward; the player's side fills in the rest,
  `normalizeBoards`); it is written by position, an item one character, a
  container a short string in its own order, one number a merge rank where a
  container always drops; and it is read against a dictionary
  (`STAGE_DICTIONARY`: the bank's layouts, the round value ladders, the usual
  settings) by raw deflate, behind the marker letter `B`. The address is
  `?s=`. **Frozen for good**: the dictionary, the order of the five rewards,
  the letters and the positions - a link made today has to open for as long
  as links are opened. Anything new is a new format number (a new dictionary:
  a new marker letter too), with this one kept for reading;
  `verify-stage-link.mjs` holds a link written down on the day and the
  dictionary's fingerprint. A stage the short writing has no place for is
  written in format 2. Every older link still opens: format 2 (`A...`: what
  the boards of a list share once), the base64url writing (`H4sI...`), a
  bare list of boards, and the address `?play&stage=`. A link carries what a
  container holds, not its editor id or name.
- **A link is letters and digits only** after the address (`urlCodec.js`,
  base 62). Economist: "we got a - and it breaks the link when sent" -
  base64url's "-" and "_" are where chat apps end or wrap a link. Never put
  another character in a share link. Decoding drops anything that is not a
  letter or digit (a full stop after the link, a line break inside it). A
  link changed on the way reads as broken, never as another stage (the short
  writing carries a check number). **A link in a new writing opens only once
  the site that reads it is deployed** - until then the tool makes links
  nobody can open.
- `?plan=...` is a read-only review of every segment's main list.
- All effects live in `PlayEffects.jsx`; the cell a player is about to tap
  never moves or resizes.

## Persistence

**Team data on GitHub** (economist, 26 Nov 2026: "i want the site to be live,
with live data between all the users" - asked where: "i think we need to
focus on the memory to live in github"; chose a private repository open to
every collaborator; shared: the Economy page, saved Merge events, Chef,
Diamond Mine). `src/lib/teamData.js`: every tool still saves in the browser,
and a connected browser copies each save to the private repository
**`idog-lab/EcoSystem-data`** (one file a thing: `economy/economy.json`,
`economy/segment-plan.json`, `chef/chefs.json`, `diamond-mine/state.json`,
`merge/saved-events/<id>.json`), and brings the team's newest in when the app
opens (`main.tsx`, at most 8 s; never on a play link) or on "Get the team's
latest". Every save is a commit by who made it. A save that finds the file
changed by someone since is never written over it: the person chooses (the
team's / mine over the team's). Each person connects once on the data page
with a GitHub token (classic "repo" for a collaborator - a fine-grained one
cannot reach another person's repository; the owner's can be fine-grained),
kept in the browser under `ecotk-team-token` - a key "Download all my data"
never takes. The open Merge project, Chef's runs, drafts and the Balance tab
stay in the browser. Not instant: another person's change arrives at the next
open or "Get the team's latest". The site's own repository is PUBLIC: never put
shared data in it. The coworker's server (`server/`, PostgreSQL) stays unhosted.
A save calls `teamData.changed(key)` / `eventChanged(id)` / `eventDeleted(id)`;
a new shared thing goes in `SHARED_ITEMS`. Held by `verify-team-data.mjs` (two
browsers, a stand-in GitHub: `scripts/verify/fakeGitHub.mjs`) and
`scripts/e2e/team-data.mjs`.

`localStorage` key `merge-mania-board-simulator`, `{ segments: [...] }`, written
by Save only - the header says "Unsaved changes" while the project differs
from what was saved or loaded. Separate entries: build drafts, the effort
shape typed in step 4. **A backup file holds all of it**: every segment, the
applied design, the results of the last builds (`buildDrafts`) and the effort
shape (`effortTargets`), so a file sent to reproduce an issue opens on the
same draft; "What a backup holds" in the "More" menu says so. Import restores them
(a draft comes back marked restored, nothing is applied by that). **Clear
data downloads a backup first**, so it can be undone. Older shapes migrate
through `segmentsFromPersisted` (a pre-segment save lands on Segment 1, an
older second Recompletion list is kept for explicit recovery).

**Saved events** (economist: "i want to be able to save full events in the
app ... like to save the events in the specific time frame"; asked, and chose
"This browser" and "By dates, newest first"). "Saved events" in the "More"
menu: a list of whole events, each holding exactly what a backup file holds
(`backupPayload` in App.jsx), kept compressed in this browser
(`lib/state/savedEvents.js`: an index under `merge-mania-saved-events`, one
key per event, the open one under `merge-mania-saved-event-open`). A new
event is named from its dates ("Merge Mania 19-25 Aug 2026", editable); the
list is sorted by start date, newest first, events with no dates last. Save
as new, Update the open one, Open (asks first when there are unsaved
changes; it is then the project, as if just saved), Rename, Download as a
backup file, Delete (asks). Saving an event also does what Save does. The
header names the event open in a **switcher** (`EventSwitcher.jsx`;
economist: "save the event and be able to switch between them", and chose a
switcher in the header): the saved events newest first, one click opens one
(asking first over unsaved changes), "Update" and "Save as a new event"
right there; rename, delete and download stay in Saved events. The browser gives the site a few MB in all:
when it is full, saving says so and nothing is overwritten. Held by
`scripts/e2e/saved-events.mjs`.

**All my data, as one file** (economist, when the site moved to the work
repo: "we got memory in the last repo. can we take it back?"; chose "One-file
move"). A browser keeps each site's data apart, so the home screen has "Your
data in this browser" (`BrowserDataPanel.jsx`, `src/lib/browserData.js`):
**Download all my data** writes every key of the app (`merge-mania*`,
`superplay-*`, `economy-*` - saved events, the open Merge project with its
builds and effort shape, Chef, Diamond Mine, the Economy page) to one file;
**Restore all my data** shows what the file holds before anything changes,
then ADDS its saved events to the list (one already here, by id, is left as it
is), puts in every part this browser has none of, and replaces a part this
browser has its own of only when that part is ticked. What is here is
downloaded first; a browser without room changes nothing. Held by
`verify-browser-data.mjs` and `scripts/e2e/browser-data.mjs`.

## Open questions (do not resolve silently)

- Production Ops mapping for reward keys and the Endless pages; where Ops
  gets the price of a twist now that "V2 Twister" is no longer exported.
- Twister spin outcomes, widget length, balance across the main -> RC boundary.
- Bigger Twister items at ranks 7 to 9 (`bigger79`, see Twister): measured to
  give more, smaller chances to spin with the same timing; rank 5 untouched.
  Adopting it is the economist's call.
- What crosses from the normal event into Recompletion: Twister items on the
  board (they do, in the simulator), an unspent Twister balance (assumed
  not). Measured three ways, decided by nobody yet.
- The 80% merge-energy credit is taken on energy collected; about a quarter of
  it is not used in the phase (see Merge energy). The two-way calibration puts
  back what that costs the player, so it no longer shows as overspending -
  but whether the credit should follow the energy used is the economist's call.
- Recompletion spend moves in jumps between sets of boards (`limit: 'jumps'`):
  a small demand there lands within a few % only by the draw. Whether the
  build should try more sets of boards (a longer build) is not decided.
- Recompletion's Twister timing with the normal event's values (it lands in
  the window in about a third of the segments).
- Push / stall pacing (design intent only, nothing built).
- Whether a play link should stop at the DR a segment is meant to spend
  (taps are free there, so a tapping player can far out-earn the design).
- Chef's proposal (build 02): the budget range of a real event (the
  economist's), how far a weight may grow, the points the search aims above
  a target, what a new ordinary schedule costs and looks like - this app's
  own defaults, shown as such; it has not been run on a completed real
  event. On the made-up example, nobody cooks a semi-blocker dish before or
  during Dish Master, before or after a proposal.
- Chef (`docs/chef-overview.md`, section 9): three things about the real
  game are not confirmed and are settings for now - whether overflow lost to
  the pantry counts toward a threshold, whether the pantry carried into
  Recompletion may cook at once, what a basket minimum above 0 does. Settled
  as rules on 24 Nov 2026: a threshold stops exactly at the limit (inside a
  basket too), a player cooks at once in list order, a joker goes to the
  blocker first, a special source reaches the same players first, scaled
  prizes round down. (The two older limits are gone: "one more basket" is a clean
  comparison since every basket has random streams of its own, and an
  activity shape keeps the total.)

## Verification

`npm run verify` - all engine suites (verify-board-bank holds the two rules of
a first board and that the simulator solves every layout of the bank;
verify-real-play plays a built event
with a robot on the real play engine and holds the simulator to it;
verify-twister-cadence holds the DR-spent clock, the spin logic, the fit, the
strict merge rule, the two Twister drop rules on the play engine, the demand
calibration in both directions with its limits and jumps, where merge energy
goes, the rank 7-9 candidate, the Recompletion rank floor, board occupancy,
paired players, the Recompletion hand-over and the per-segment values in the
exports; verify-stage-link holds the short link - a link of the day it was
made, the dictionary's fingerprint, a robot playing a stage and its link to
the same last item, every older writing, a changed link never opening as
another stage; verify-chef holds the Chef rule engine, one check a
confirmed rule: the three limits on an ingredient, a basket keeping its
size, FU, schedules, sources and jokers, presets, Main to Recompletion,
prizes, paired plays, supply, older saves; verify-chef-proposal holds what a
Chef proposal may and may not change - locks, bounds, the pantry at every
segment's size, schedules, a weight of 0 staying 0 - that a poor event with
reachable targets is brought to them and checked on other players, that the
worst segment is what is compared, a proved conflict against a search that
ran out, blanks, stopping, out-of-date proposals, apply and undo; every
check types a seed, so a run is the same every time; verify-economy holds
the economy's rules - the value table, every rounding rule, the reader and
checker, the economist's four real rewards read and written back exactly and
built from their parts, empty input giving nothing, worth by date, segment
conditions to the character).
`scripts/e2e/economy-page.mjs` walks the Economy page and the two features
that read it. verify-chef-catchup holds Chef build 03 (what a suggested
catch-up may hold, the economist's presets untouched, the order of better,
apply and undo); `scripts/e2e/chef-catchup.mjs` walks it in step 4.
`scripts/analysis/twister-validation.mjs [players]` - three events, eight
segments, both phases, players the build never saw (an investigation, not a
check; about 20 minutes). `twister-cadence.mjs` is the first investigation.
`npm run e2e` warms the dev server up first (it compiles on first use and
reloads the page it serves, which crashed whichever suite ran first).
The browser suites need **Playwright, a devDependency pinned to 1.64.1** - the
version of the Chromium build installed here (1248); a newer one asks for a
new browser download. (It used to be installed on the side, and an
`npm install` removed it as not listed, 25 Nov 2026.)
`npm run e2e` - every browser suite
(start `npm run dev` first; a suite can time out while the dev server is
reloading after many file changes - rerun it alone before calling it a
failure). The suites open every folded section as it appears
(`launch()` in helpers.mjs), so they keep checking everything a section
holds; `guided-flow.mjs` runs with `folded: true` and checks the flow as a
first visit finds it - what is folded, the words, the summary, the way back
from the Play Tester, the backup, the bank of boards; `text-layout.mjs`
measures every screen for cut, squeezed or spilling text; `chef-flow.mjs`
walks the Chef flow as a first visit. A suite prints `CONSOLE ERROR` and `PAGE
RELOADED` lines when the app reports one: read them when a page went blank.
Do not edit project files while a full run is going. A build has randomness in it: say "single run" when quoting one.
The suites reach the advanced tools and the project actions through the
"More" menu (`tab()` in helpers.mjs opens it), bring a segment into sight
with `showSegments` / `selectSegment`, and pick a sheet with `syntaxView`.
One check is known to depend on the build's draw: build-event's "the residual
... is only rounding (within 4 DR)" was seen failing in a full run and passing
twice alone - a note for QA, not a regression. Two more, seen on 24 Nov 2026
in a full run and passing twice alone: verify-real-play's "a careful robot ...
collects what the simulator says" (one segment's robot at 0.98 of the
simulator's rewards and 0.94 of its DR, against 1.00 alone), and
verify-twister-cadence's "the build moves the subsidy until the average player
pays the demand" (Segment 1's search did not settle, 268 of 298 DR, -10.1% -
the build said "not settled"; alone it was 288, -3.4%). Neither code had
changed. Because \`npm run verify\` stops at the first failing suite, a
draw-dependent failure hides the suites after it: run those alone. (verify-event-build once
stopped a full run with a crash, not a failure: a check read the mark of a
re-valued rank on a segment the build had given exactly the typed values,
which has none. The check now reads the typed values there.)
