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
- **Do not invent production values or syntax.** Ops mappings that were never
  confirmed stay labelled "unverified" wherever they are shown or exported.
- **Verify in the real app, not just the library** (Playwright suites below).
  Report what was actually checked, including what failed or was flaky.
- **Publishing is the economist's call.** Commit, push and `npm run deploy`
  only when asked, every time. A shared stage link always opens the deployed
  site, so a change to play reaches phones only after a deploy.
- Artwork is prototype concept art made by the economist, not studio artwork.
- `src/features/chef` and `src/features/diamondMine` are separate features
  that share only `src/components/` and `src/lib/`. Leave them alone unless
  asked.

## Repository map

```
src/
  main.jsx, App.jsx, index.css     app entry; App.jsx holds the Merge editor state and routing
  components/                      shared UI (HeroPage, ui/Button, Card, NumberField, Slider, InfoHint)
  lib/gridWidth.js                 shared grid sizing
  features/merge/
    lib/core/        ranks, board, layout edits, item generation and placement, onboarding goal,
                     generator tiers, lucky drops, subsidy budget
    lib/simulation/  mergeSimulation (the engine), playSession (interactive play),
                     effortTargeting, ccManagement, simulationRows
    lib/rewards/     small rewards: reward chains, drop groups and containers, placement under
                     tiles, the configuration workflow, Twister economy, endless mode
    lib/build/       eventBuild (the guided build), legacyRecompletion
    lib/export/      eventSheets (Ops workbook), Google Sheets export, boardSyntax (placeholder)
    lib/share/       stage and plan links (gzip + base64url)
    lib/state/       persistence (localStorage), useBoardListState
    lib/play/        artwork lookup, tile surfaces, celebrations, phone layout hook
    components/build/    the Build event flow (7 steps) and its review
    components/editor/   advanced board editor, board list, simulation report, CC management
    components/rewards/  advanced Rewards and Twister tools
    components/play/     Play Tester, Play Stage (shared link), tiles, effects, celebrations
    components/export/   Syntax tab
    assets/game/     the artwork in use (copied and trimmed from art-source/)
    data/            the demo stage
  features/diamondMine/, features/chef/   other features
scripts/
  verify/          engine checks (npm run verify)
  e2e/             browser checks against the dev server (npm run e2e; one: npx vite-node <file>)
  art/             prepare the artwork from art-source/
art-source/        the economist's original asset packs (untracked)
reference/         the economist's reference spreadsheets: Merge Out.xlsx (Small Rewards
                   syntax example), chef_*.xlsx (Chef source data) (untracked)
docs/history.md    the full design history
```

Dev: `npm run dev` (port 5173, `strictPort` - localStorage is per origin
including port, so never let it drift). `npm run build`, `npm run lint`
(oxlint), `npm run deploy` (gh-pages, only when asked).
Hosting: `https://idoggk.github.io/Merge/`, `base: '/Merge/'` in
`vite.config.js` must match the repo name; `PRODUCTION_ORIGIN` in `App.jsx`
is what every share link points at.

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
definition is the same) - and Twister price.

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
drop rules or values in the Recompletion phase of step 4 is not used (the
step says so).

**Subsidy.** The economist types each segment's **demand** (DR the player
spends); subsidy = chase value - demand, where the chase is 2048 for the
normal event and 6144 for Recompletion (`chaseValue`; the player arrives with
a rank 12 worth 2048). Recompletion's demand is the normal event's, read-only
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
  pin brush starts at 3). Rank 13 allowed
  under tiles and as a pinned semi rank. **Its Board 1 is not an onboarding
  board** (economist: "there is no onboarding experience that needs to be
  met"): no starting goal, no opening run (`isRecompletionBoard` - every
  board of that list carries `listPhase: 'rc'`, stamped by
  `useBoardListState({ phase: 'rc' })`). It keeps the fixed cell (rank 3 there)
  and RC event mode, and lands exactly on its 300 DR.
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
  1,000; coins in hundredths, `niceCoinValues`) and **reward merging** (each
  rank at least double the one below, rank 4 more than the items it is made
  of) - so tapping an item early never pays more than merging it on. The
  proportions follow the typed ladder when that one already rewards merging,
  else 1:3:7:15. They are set last, on the boards the segment really gets and
  on 150 simulated players (`fitValuesOnFinalBoards`, `FINAL_FIT_RUNS`), so
  the average lands on the segment's amount within half a rounding step
  (about 3% at a top value of 75, 6% at 40 - what round amounts cost). A
  later pass of the same build keeps the values of the pass before unless
  the amount is clearly off (`VALUE_DEAD_BAND`). Typed values stay the
  definition (`typed`); switch the whole thing off in step 4. **Any screen where values are typed or pasted must
  pass the result through `withTypedLadders`**: it drops the build's `auto`
  mark from a ladder whose values changed. (The Twister tool and the Rewards
  tab once kept it, so the next build replaced typed Twister values - "a rank 4
  pays 165".) One item pays one resource (an item syntax joining
  several with "+" is flagged).
- **Leftovers are collected** (`DEFAULT_LEFTOVER_POLICY` 'collect'; economist:
  "after getting to rank 12, merges all the small rewards and collect them. to
  understand how much really the user got"). What is still unmerged when a
  phase's top rank is reached is **merged first, then tapped** and paid at
  its rank's value (`settlePhaseLeftovers`, `mergeFirst`: a free item opens a
  semi-blocked one of its rank, pairs merge on up the chain; the player who
  taps when it pays does not merge those ranks; tapping them as they lay
  under-counted merge energy by 7% against the robot);
  'forfeit' (the old assumption) is still selectable in step 4. A project
  saved before this rule is switched to 'collect' when opened
  (`migrateLeftoverRule`, the save's `leftoverRule` mark). In a run that goes
  on into Recompletion nothing is settled at rank 12 (everything comes
  along), but the tap value of the free reward items held at that moment is
  counted to the normal event and taken off Recompletion's
  (`carriedIntoRc`), so the two phases always add up to the run.
- **Merge energy** funds free x1 taps and earns an **80% credit** taken off
  the later boards' subsidy, once per phase (Board 1 protected).
- **Three kinds of player** (`collectPolicy`, `findTapCollectCell`). A reward
  item can be merged on or tapped to collect it as it is, and that changes
  what a player ends up with. `'merge'` (default; the player every build is
  sized for) merges everything. `'best'` taps an item when no higher rank
  pays more a piece (`tapPaysAtLeastAsMuch`) - with the reference values
  (puzzles 5/15/15/40, charms 5/10/30/40) that is about 1.5x the puzzles and
  charms. `'all'` taps every item: a reward under a tile is then never
  opened, the board never clears, the later boards never arrive, and the
  player spends several times the DR (free on a play link). Step 7's
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
  5-15% more (single builds); elsewhere nothing changes. Step 7 shows the
  row; the build is still sized for the careful player.
- **How close is ONE player** (economist: "we need to make sure we will know
  that the resources the user gets will be some what close to what we wanted
  him to get"). The simulator's averages were right; two players were not
  alike, because which container a merge rolled was chance (one test
  segment: 28 of 100 players within 15% on every reward). So:
  **steady containers** (`steadyDrops`, step 4 "Every merge of a rank drops
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
  **Step 7 validates on 300 players who roll their own lucky drops**
  (`randomLuck` / `luckRng`; the build itself sizes on players with scheduled
  luck, an average free of noise) and shows, per reward, "players within 15%"
  (`nearShare`; 25% in Recompletion) and how many are near on every reward at
  once (`allNearShare`, `validation-closeness`).
- **Margins**: a reward within **15%** of its target is met; board DR within
  5%. **Recompletion: 25% for both** (economist: "the miss amount can go up to
  25%") - always read through `offTargetToleranceFor(phase)` /
  `drToleranceFor(phase)`. A reward amount never blocks a build ("Can be improved", with quick
  fixes); only structural problems block ("Needs a fix").

**Drop rules (economist, the current set - hard rules).** From the drop start
rank (default 6, "the rank the merge makes"), every merge drops; the start
rank is never moved by the build.
- Rank 6 (the single-item rank, `soloDropRank`, "up to rank" in step 4): **one
  item**, 60% of them a rank-1 item of the reward under the tiles
  (`TILE_REWARD_FOCUS_SHARE`, this app's own) - all of them with steady
  containers (see "How close is ONE player").
- Rank 7: one or two items (two in the share the rise gives). Ranks 8-9:
  exactly two (`multiDropRank` 8). Rank 10+: exactly three, **only** from
  there (`tripleDropRank` 10). Never more than the rank allows.
- When the rules cannot carry an amount: items get bigger first (rank 3 at
  most, never a rank-4 drop), and the **rank values** do the rest (see "The
  model gives the rank values" above; 0.1x-10x of the typed top value, this
  app's own). Typed values stay the definition (`typed` on each re-valued
  rank, `withTypedRewardValues`); every build starts from them; the values
  given are a result, per segment, shown in step 6. Switch off in step 4
  ("The build may change a reward's rank values"). A target smaller than one
  top prize gets smaller values before the solve.
- Coins the build values are the filler above rank 6 (they ask nothing of the
  drops; they take places the others leave).
- The containers ARE the Ops "Small Rewards Bank" (ContA, ContB, ... with
  per-merge-tier weights out of 1000).

**Under the tiles (economist).** One reward only (`tileRewardType`, default
coins; step 4). Board 1 holds none (in a list of 2+ boards); **only Board 2
holds items above rank 1** (rank 1 then 2, a chain one drop opens); every
other board rank 1 only; at most 4 reward items on a board before the last.
At most 40% of a reward is asked of the tiles - the drops are the bigger part.
A reward with no drops gets nothing under tiles (it could never be opened).

**Twister.** The build puts it into the drops (`twisterByBuild`): a quarter
of every rank's drops, taking a reward item's place, rank 1-2 items to start
(with steady containers: in every two-item drop and the one-or-two rank's
second place, one size per merge rank).
The economist's fear is pace ("some segments get the final amount at 100%
progression and some at 50 ... i need the model to be the smart one"), so the
build keeps every segment **on track**, in three moves, all this app's own:
- **Enough finished items.** Twister DR is only credited at rank 4, so a
  segment with a lot of subsidy finishes one item and gets every twist in one
  jump. The items are made bigger (rank 3 at most, `resizeTwisterDrops`) until
  every segment's typical player finishes `TWISTER_MIN_COLLECTS` (3) - and
  then, values and prices set, for as long as any segment's verdict is still
  "early" (three items are a floor, not a promise: one test event had a
  segment done at 75% with three). At rank 3 it stops and says who. Step 4
  switch "Keep every segment's Twister steady" (`twisterSteady`, on unless
  false; off = only while a segment would finish none). This overrides the
  economist's older "bigger items make rank 1 useless" - said to them, and
  theirs to switch off.
- **Values** (start 2/5/12/30, rounded to 5s): the smallest at which every
  segment has a whole-step price that leaves its typical player with the
  twists asked and at most 25% more (`fitTwisterValues`). (Sized so the
  worst segment paid one step, an in-between segment could only be too cheap
  or too dear.) Typed values are kept as typed.
- **Price** per segment: the dearest whole-step price at which the typical
  player still has the twists at the counting point (`suggestSpinCost`).
Every run records Twister DR every 5% of the phase (`TRACK_MARKS`); step 6
shows twists at 25/50/70/75/100% (`PACE_MARKS`, `row.incomeAtMarks`), when the
typical player has them all (`row.finishPct`) and a verdict (`row.pace`:
on-track = within 20 points before the counting point / early / late, shown
"Short"), with one line for the whole event (`twister-track`). Twists are not
a build input (changing them only reprices, values stay); when the new twists
no longer fit the values in whole price steps, the draft says to build again
(`sizing.needsRebuild`). A build is random: a check on the Twister asserts
"all on track, or at rank 3 and said", never a fixed outcome.

## The Build event flow (the main path)

Seven steps, ids `setup, layouts, generator, rewards, effort, build,
finalize`: segment amounts · board layouts · generator and lucky drops ·
small rewards (targets, drop rules, reward under tiles, Twister,
definitions) · effort distribution · build · test and finalize. Every other
tab is an advanced tool over the same state.

- `buildEvent` builds one phase for all segments, base segment first; others
  are solved against the base's shared drops (Recompletion: every segment
  against the normal event's). `buildSegment` loops up to 4 passes until the
  energy credit agrees within 0.5 DR or 1.5% of the DR the segment spends,
  whichever is more (`creditToleranceFor`, this app's own: merge energy lands
  near its target, in round values, not on it; **5% in Recompletion**, whose
  energy follows from boards made anew in every pass - 1.5% of a 300 DR
  demand is less than one energy item). Rebalances shared drops when
  they over-pay other segments.
- The effort distribution typed in step 5 is kept (saved across reloads) and
  the build picks, of 24 generated layouts, the one closest to it
  (`pickBoardsForEffort`), **judged with the build's own merge drops** - the
  same playthrough the step 6 chart shows. (Judged on the main chain alone it
  looked close while the chart showed rank 12 at 77% against 65% asked.)
  Step 5 itself can only judge the main chain: the drops do not exist yet.
- A build is a **draft** (saved separately from the project); Apply writes the
  build-owned fields and stamps the boards (`buildStamp`).
  `designConsistency` gives every tool one status (consistent / stale /
  unaccounted / manual / empty). Exports go through `ExportGate` and use the
  **applied** design only; the Syntax tab says when a newer build waits.
- Status words shown: Draft, Applied, Out of date, Ready, Can be improved,
  Needs a fix, Not built.
- Editing a board's layout clears that board's contents; a share link refuses
  unbuilt normal boards and leaves out an unbuilt Recompletion.

## Exports (Syntax tab)

Per-segment workbook / Google Sheet in the reference tab order (Event Data,
Multipliers, Board Layouts, Recompletion Board Layouts, Generator Weights,
Blocked Queue, Item Ladder, Small Rewards, Small Rewards Bank, Small Reward
Weights, Endless container tabs, V2 tabs), plus combined all-segment exports
(there each segment has its own "S{n} Small Rewards": the values are per
segment; Bank and Weights are one table for all). **The normal list and Recompletion are one event** (economist: "they
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
per segment only where it differs), and the one drop table is one "V2 Drop
Groups" tab; V2 Reward Chain and V2 Drop Groups list the event once ("Main +
RC", with ranks 13-14 as "RC") and no zero "(no drop)" lines; the Normal and
CC text views say what a list shares (lucky-drop EV, rank rewards, the EV
bumps) once at the top and write reward items by key. What still repeats is
the reference format itself and stays: one Generator Weights row per rank and
multiplier, Pool Number = Entry Number with Stock and Weight 1 in the Blocked
Queue, the Section name on every Board Layouts row. An automated Ops parser reads these:
transcribe headers and values literally (typos included where the reference
has them), never use merged cells, keep row order. `exceljs` for styling;
Google Sheets via a browser OAuth token, values only, `RAW` input. The
economist's live reference spreadsheet is the authority on format. Reward
keys in queue/layout cells and every V2 / Twister / Endless tab are
unverified and labelled so. The Twister rows of Small Rewards are written
`[dynamic(dr-twister:value)]` when no syntax was typed (`twisterSyntaxFor`;
`dr-twister` is our own name), and a typed one-amount syntax follows the
values the build sizes (`syntaxWithAmount`). Open questions on the Small Rewards sheets
(literal coins vs allowance, which extra tabs belong) were asked and not yet
answered.

## Play surfaces

- **Play Tester** (economist): any board, tier choice, jump to Recompletion /
  endless, compare to the simulator, warns when Recompletion boards are
  unbuilt.
- **A play link with no Recompletion ends at rank 12** (`endAtGoal`,
  `sessionEnded`): the generator stops, what is left can still be merged and
  tapped. (It used to go on for ever after "the chain is complete", every
  merge still dropping rewards - economist: "my friend did those amount in
  the normal only".) The Play Tester does not end there. Taps on a link are
  free, so a player who taps every reward item (and so never opens the reward
  under a tile) can still play far past the DR a segment is meant to spend.
- **Play Stage** (`?play&stage=...`, a shared link, no editor reachable). Made
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
- Stage links are **format 2** (`stageShare.js`): each list carries what its
  boards share once and leaves out editor-only fields (~37% shorter). Older
  links still open; a format-2 link opens only on a site deployed with it.
- **A link is letters and digits only** after the address (`urlCodec.js`:
  gzip, then base 62 behind the marker letter `A`). Economist: "we got a -
  and it breaks the link when sent" - base64url's "-" and "_" are where chat
  apps end or wrap a link. Never put another character in a share link.
  Decoding drops anything that is not a letter or digit (a full stop after
  the link, a line break inside it); the older base64url writing (starts
  `H4sI`) still opens. A link in a new writing opens only once the site that
  reads it is deployed - until then the tool makes links nobody can open.
- `?plan=...` is a read-only review of every segment's main list.
- All effects live in `PlayEffects.jsx`; the cell a player is about to tap
  never moves or resizes.

## Persistence

`localStorage` key `merge-mania-board-simulator`, `{ segments: [...] }`, written
by Save only. Separate entries: build drafts, the step-5 effort curve.
Backups export/import every segment; older shapes migrate
through `segmentsFromPersisted` (a pre-segment save lands on Segment 1, an
older second Recompletion list is kept for explicit recovery).

## Open questions (do not resolve silently)

- Production Ops mapping for reward keys and the V2 / Twister / Endless tabs.
- Twister spin outcomes, widget length, balance across the main -> RC boundary.
- Push / stall pacing (design intent only, nothing built).
- Whether a play link should stop at the DR a segment is meant to spend
  (taps are free there, so a tapping player can far out-earn the design).

## Verification

`npm run verify` - all engine suites (the last one, verify-real-play, plays a
built event with a robot on the real play engine and holds the simulator to
it). `npm run e2e` - every browser suite
(start `npm run dev` first; a suite can time out while the dev server is
reloading after many file changes - rerun it alone before calling it a
failure). A build has randomness in it: say "single run" when quoting one.
