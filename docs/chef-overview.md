# Chef: what the feature is, and how to work on it

State on 23 November 2026, after **Chef rebuild, build 01** (the accurate
event model and simulator) and its review (the cases of section 8 checked one
by one; a reference-chef workflow added) and **build 02** (a generated
proposal for recipes, basket weights and thresholds, reviewed beside the
current event and applied or not) and its follow-up (new ordinary and
semi-blocker schedules, the recipe budget as an explicit choice, only proved
conflicts called impossible). This is a briefing for an assistant who will take
tasks on the Chef feature. It is complete on its own: read it before the first
task, and treat sections 2, 9 and 10 as standing instructions.

## 1. What this is

**Chef** is a live-ops event in a mobile card game (Disney Solitaire), usually
about 21 days. Players open **baskets** that give random **ingredients** and
cook **dishes** when they hold what a recipe needs. Twelve dishes make the
**Main** round; cooking all of them pays a grand prize and starts
**Recompletion (RC)** at once - three new dishes, on the same calendar, the
same baskets and the same pantry.

The **Chef tool** is one feature of a browser app ("Economy design toolkit",
Vite + React 19 + Tailwind 4, no backend, no charting library). The other two
features are Merge Mania and Diamond Mine; Chef shares only `src/components/`
with them. Leave them alone unless a task names them.

**The delivery order.** Build 01 (done): accurate rules, editable inputs, a
trustworthy simulation, manual catch-up presets. Build 02 (done): the tool
PROPOSES recipe quantities, basket weights and threshold schedules against
the targets, shows the current event beside the proposal, and applies it only
when told to (section 5, "A proposal"). Build 03 (done, 24 November 2026): it
SUGGESTS targeted catch-up presets, judged the same way, added beside the
economist's own and applied only when told to (section 5, "Catch-up
suggestions").
One rule engine serves the simulation, the proposal and every later tool. A
proposal is the best of a bounded search, never "the optimum", and its values
are suggestions, not confirmed design values.

There is no export from Chef to the game's configuration (section 9).

## 2. Who you work for, and the rules of the work

The user is the event's **economist, not an engineer**.

- Plain words, compact tables, results on screen. No solver or statistics
  jargon: "the middle player" (not median), "most players" (not P10 to P90),
  "simulated players", "the same players every run" (not seed), "the range a
  share would land in with other players" (not confidence interval).
- **The economist decides the game's rules.** Section 3 holds the rules they
  confirmed. Do not change one because it makes code simpler or a number
  nicer. A suspected flaw is measured, said on screen and written down.
- **A limitation is never hidden; a warning is never turned into a success.**
- **Do not invent production values, behaviour or syntax.** What a source
  sheet did not say starts empty and is said to be empty. What is not
  confirmed about the real game is a visible setting (section 9), never a
  silent constant.
- **Verify in the real app**, not only in the library (section 8). Say "single
  run" when quoting one. For a small change run only the checks that cover it.
- **Publishing is the economist's call**: commit, push and deploy only when
  asked, each time.
- When two rules collide, or a task needs a rule that does not exist, ask a
  short question with options and a recommendation, at the fork.

## 3. The model (schema 2)

Plain data made by factory functions in `src/features/chef/lib/chefModel.js`.
One event setup is called a **chef**. Its state:

`{ schemaVersion: 2, ingredients, dishes, recompletionDishes, baskets,
calendar, segments, thresholds, sources, presets, targets, rewards, settings,
migration }`

| Thing | Fields | Notes |
|---|---|---|
| Ingredient | `id, name, rarity, pantryCap, sourceCap, art` | `rarity`: `common`, `rare`, `semi-blocker` (the sheets say "Epic"), `blocker`. `pantryCap` null = no limit. `sourceCap` is the sheet's "Cap", kept and NOT played: the sheet does not say which limit it is. |
| Dish | `id, name, recipe, reward, legacyWorth, blockerBySegment, art` | `recipe` is `[{ ingredientId, count }]` at the base segment. `reward` is the prize by component (null: unknown). `legacyWorth`: an older single prize number, counted as coins. |
| Basket | `id, chestType, phaseId, totalMin, totalMax, ingredientWeights, pricingIngredientWeights` | One per chest type (`basic` 3-5, `rare` 6-10, `epic` 12-20) and odds period. A weight row is `{ ingredientId, min, max, weight }`. `min` is stored, flagged when above 0, and not played. |
| Calendar | `startDate, totalDays, phases, dishMaster` | `phases` are the periods of basket odds. `dishMaster` is `{ startDay, endDay, dishIds? }`: `dishIds` are the Dish Master dishes picked in step 1 (economist: "i want to be able to ... pick the dishes for the dish master"); none picked: every Main dish with the semi-blocker. Dish Master progress (`dishMaster` in a run) is read on them; the checks say when they are not three or lack the semi-blocker. Shared by every segment. |
| Segment | `id, name, brutWinsMin, brutWinsMax, effortFactor, prizeFactor, burnout, supply, activityShape, definition?` | All typed. Brut Wins is kept for the record; nothing turns it into baskets. `definition`: the game's own definition, on the live segments. |
| Threshold | `id, ingredientId, round, steps` | A progression threshold: `steps` is `[{ fromDay, limit }]`, `limit: null` lifts it. Shared by every segment. |
| Source | `id, label, kind, day, ingredientId, amount, coveragePct, segmentIds, bypassThreshold` | `kind`: `ingredient` or `joker`. |
| Preset | `id, name, enabled, chestType, round, startDay, endDay, priority, segmentIds, eligibility, maxUses, sizeMode, allocations, fixedTotal, fixedContents, fallback` | A catch-up preset. |
| Targets | `mainFuDay, mainFuSharePct, checkpoints` | Shared. A checkpoint is `{ day, dishes, sharePct }`. |
| Rewards | `values, grandPrize: { main, rc }, itemRounding, cappedFactor` (an older save's `grandPrizeRoundTo` is dropped) | |

### The confirmed rules

**Recipes and effort.** The economist says which ingredients are in a recipe;
nothing adds, removes or swaps one. A segment's quantity of an ordinary or
semi-blocker ingredient is base x its effort factor, to the nearest whole
number, never below 1 (`recipeForSegment`; the rounding is this tool's own). A
blocker quantity is never scaled: it is a whole number typed for the segment
(`blockerBySegment`), else the base number. A dish marked **same for every
segment** (`sameForAllSegments`, the "all" box beside its name in step 2) is
cooked at its base quantities by every segment (economist, 24 November 2026,
of the Black Friday chef's first dish: "Yes, dish 1 never scales"); a proposal
still bounds its quantities as if it scaled (stricter, never wrong). About 250 recipe ingredients for
the Main round of the base segment over 21 days is a design reference, scaled
by duration, shown beside the total and never enforced.

**Three different limits, never to be mixed up.**

- *Pantry cap*: the most a player can HOLD. Cooking frees room. What a basket
  gives beyond it is lost, with nothing in its place.
- *Progression threshold*: how much a player may have RECEIVED in the round
  before ordinary baskets stop giving the ingredient. Cooking frees nothing.
  Special receipts count toward it too.
- *Most a basket*: the most one basket can roll of the ingredient.

Rolled, kept, lost to the pantry, cooked, on hand and received are tracked
apart, and every unit is accounted for (rolled = kept + lost; kept = cooked +
on hand).

**A basket.** Its size is drawn evenly between its smallest and largest. Its
units are drawn one at a time by weight among the ingredients that have a
weight, have not reached their most for this basket, and are not held back by
their threshold. An ingredient held back is left out and the others take its
place, so the basket keeps its size while they have room; if they have none
it comes up short and is counted - it never loops. What does not fit the
pantry is then lost.

**Calendar and FU.** No dish is locked by date. Thresholds pace the blocker,
the semi-blocker and, if wanted, ordinary ingredients. The semi-blocker is in
three Main dishes: a mild rise during the Dish Master, no limit after it (a
helper writes that schedule on request). The blocker is in two Main dishes:
its threshold lets one be cooked and leaves the last one short.

**Main FU** = every Main dish but one is cooked, the last one lacks ONLY
blockers, and the player has received as many blockers as the threshold in
force allows. Missing an ordinary ingredient is not FU; a player still below
the threshold is not in FU (still waiting for supply); a player who finished
is not in FU; with no threshold on the blocker nobody is in FU. The target is
a share (80%) of every segment sitting in FU on a calendar day. *In FU now*,
*ever in FU* and *finished* are three figures, never one for another. A
checkpoint is the share of players with at least N dishes by day D - not the
average number of dishes.

**Jokers and special sources.** A joker is spent on three different
ingredients: 10 of each ordinary or semi-blocker one, 1 of the blocker. Who
gets a source is typed (share of players, segments); nothing predicts
purchases. A source stops at a threshold unless it has the permission to pass
it; a catch-up preset never has it.

**Catch-up presets.** A player who qualifies opens the same basket and gets
guaranteed contents in its place - it replaces a basket, it is not one more.
Size: "by the basket's size" (the size is rolled as always and the preset
says what a basket of each size holds) or "always the same" (its own total,
inside the type's range). Who qualifies is read when the basket is opened:
day, round, segment, dishes cooked, an ingredient still missing, what was
received. Lowest priority number first, then list order; at most N uses a
player; when a threshold or the pantry stops the contents: the next preset
that fits, or the ordinary basket - a setting.

**Recompletion.** It starts the moment the last Main dish is cooked, on the
same days and the baskets that are left. The pantry is carried over; the count
of what was received starts again at zero and the Recompletion thresholds
apply. Its dishes can be cooked at once, and it is cooked one time. RC FU =
all its dishes but one cooked, only blockers missing, its threshold reached;
it is reported in days since entering as well as by event day.

**Prizes.** A prize is stored as what it is made of - coins (allowance),
wilds, extra stock, free rounds, undos - and its allowance worth comes from
the value table (1, 2.5, 2, 1, 0.25) - the economy's, shared by the whole app (docs/economy-rules.md; a chef keeps its own copy and step 2 says when it differs from the Economy page's, with one click to take it). For a segment the base prize is scaled
by prize factor x burnout: coins by all of it; free rounds and undos by 2 at
most (the limit is on the multiplier, not on the count); wilds and extra
stock not at all. A grand prize's worth is then rounded by the economy's RoundReward
(under 90 to the 5, a 5 becoming 10; 90 to 200 down to the 10; above 200 to
the 50 - economist: "Yes, RoundReward"; it was the nearest 5; raw kept
beside it); a dish prize is not. An unknown prize is unknown, not zero,
and makes the payout "incomplete". **A scaled amount is rounded down to whole
items** (economist, 24 November 2026, asked: "Always down" - 4.8 undos give 4;
it was a setting while not decided, and a save's `itemRounding` is no longer
read). Coins are not rounded to whole items. **A grand prize is its rounded
worth** (asked: "The rounded worth (100)"): 90 coins at x1.2 are 108, RoundReward
makes it 100, and the player gets 100 - the coins take up the difference, also
when wilds or undos are in it (108 coins + 1 wild = 110.5 -> 107.5 coins + 1
wild = 110). When the coins would have to go below 0 the items stay as scaled
and it is said (\`unmatched\`).

**The live segments** (economist, 24 November 2026: "the segments we got are
not the segments we are holding in the app", with the game's segment keys).
Nine (`LIVE_SEGMENT_SET`, `liveSegments()` in chefModel.js): **Chef_control**
- everyone outside A/B test 1109, not split by Brut Wins (asked: it is a
segment here) - and eight bands of daily Brut Wins inside the test, 0-10,
10-20, 20-40, 40-60, 60-100, 100-150, 150-240, 240+ (a band is above its
lower end and at most its upper end). Daily Brut Wins = 0.7 x the daily
average of the last 3 days + 0.3 x that of the last 14 days. Only names,
ranges and definitions are given: effort, prize factor and burnout start at
1 and baskets at 0, for the economist to type. Step 1, "Use the live
segments": replaces the open chef's segments after asking (asked: replace,
not add beside), with one undo (`state.segmentsBefore`, not part of the
fingerprint); what elsewhere names an old segment (a blocker quantity typed
for it, a source or preset limited to it) is left as it is, said in the
question and listed in the checks; the proposal's choice of segments goes
back to all, and returns with the undo. The two historical chefs keep the
segments they had (P25 of DAU ... 100% of Revenue). "Add a segment" adds one
more by hand.

**Supply.** A segment's baskets are typed as one average a day or as a number
for every day. Nothing is taken off for inactivity. An activity shape only
moves baskets between days: the typed average stays the real average.

### The two real chefs in the app

`src/features/chef/data/halloweenChefData.js` and `thanksgivingChefData.js`
hold the economist's workbooks (`reference/chef_*.xlsx`) as they were read, in
the OLDER shape (`chefLegacyModel.js`); `chefFromSource` brings one to schema
2 the same way an older save is brought. So a new chef made from one has: 12
dishes with prize components read from the workbook's prize sheet, 12
Recompletion dishes with no prizes (the rule is three - kept, flagged), 9
segments (prize factor 1 / 1.2 / 1.5 from the earlier tool's own guess,
effort and burnout 1), the sheet's "Cap" beside each ingredient and not
played, and NO thresholds, Dish Master days, FU day, jokers or presets. A
blue note on screen says so until dismissed.

## 4. The engine

`src/features/chef/lib/chefEngine.js`, version `chef-engine 1.0`.

**One player, day by day** (`simulatePlayer`): the day's special sources and
jokers; then the baskets (Basic, Rare, Epic), each rolled or replaced by a
preset; cooking after every delivery (or once a day - a setting), in list
order (or biggest prize first - a setting; a tie-breaker only: a player never
holds an affordable dish back); the move to Recompletion the moment Main is
done.

**How many baskets a player opens.** A player opens whole baskets; what is
typed is an expectation (0.4 Epic a day is 8.4 over 21 days), and a fraction
is never dropped. *Basket luck only*: the expected count runs up day by day
and a basket is opened each time the running total passes a whole number,
from a starting point of the player's own - so with 0.4 a day every player
opens 8 or 9 (8.4 on average) and players differ only in which days. *Player
activity too*: also a lasting multiplier (even between 0.4 and 1.6, scaled to
average 1) and days played in streaks (share between 0.55 and 1, persistence
0.5) - typed assumptions, not measurements. In both, the expected baskets of
every day are exactly what was typed.

**Both views, side by side** (economist, in planning: "show both views, but
use a player-variation assumption you can inspect and adjust" - "we will go
with ur recommendation"). The 80% targets depend on the activity assumption,
so every run plays both, on the same players' number: the view chosen ("Targets
judged with", default player activity) decides met / not met and the detail;
the other is shown beside it in blue columns ("With basket luck only": in FU
on the FU day and every checkpoint) and in the detail. A proposal's check plays
the current event and the proposal the other way too (`proposal.otherView`,
on the same check players; a reading only - the search, the verdicts and the
outcome use the view chosen). On the made-up example inside 225-275 (single
run): 47-68% in FU with activity, 84-100% with basket luck only.

**Randomness is keyed** (`chefRng.js`): every basket of every player has
streams of its own (size, draws), as have a player's activity and place among
the recipients. One more basket, a preset or other odds never changes what
another basket rolls, so two plays of the same players differ only by what
was changed. A change that changes nothing gives identical players.

**What a run returns** (`simulateSegment` / `summarize`), per segment: per
day the dishes of the middle player and of most players, the share with each
number of dishes, in FU, ever in FU, finished, in Recompletion and its FU; the
FU target and the checkpoints; when finishers finish (among finishers, with
the unfinished share beside); every dish; per ingredient given, kept, lost to
the pantry, cooked, left over, held back, past a limit, and what the
unfinished players lack; Recompletion (entered, FU and days since entering,
finished, and what the carried pantry allowed at once); the payout by part,
with what is unknown; baskets opened against expected. `meta` holds the
engine version, players, the players' number and what varied.

Also: `tracePlayer` (one player's event, step by step), `comparePaired` and
its uses `comparePresets` (with and without presets) and `oneMoreBasket`,
`supplySweep` (more or fewer baskets), `fingerprint` (a short mark of a
chef). `simulateSegmentAsync` plays in chunks so a long run does not freeze
the page. 400 players of a heavy segment take about half a second.

`shareInterval` gives the range a share would land in with other players
(Wilson). It is shown beside a share; it is not the spread of the players.

## 5. Other parts of the library

- `chefRewards.js`: `scaleReward`, `rewardWorth`, `dishPrize`, `grandPrize`,
  `prizeTable` (what a segment can be paid, and what is missing).
- `chefValidation.js`: `validateChefConfig(state)` returns findings
  `{ severity, area, step, message, entityId }` - `block` ("Needs a fix"),
  `review` ("Worth a look"), `info` ("Good to know"); `step` is the step that
  puts it right. It catches, among others: baskets that cannot give their
  size (also when thresholds hold ingredients back), a dish needing more than
  the pantry holds, schedules out of order, sources and presets outside the
  event, preset contents that do not add up or that a threshold forbids on
  every day, an FU day or checkpoint that cannot be, and says what a blocker's
  threshold leaves the last dish short of.
- `chefMigration.js`: `migrateChefState` (schema 1 to 2, with plain-word
  `notes` of what is missing), `chefFromSource`.
- `chefPersistence.js`: the library of chefs in `localStorage`
  (`merge-mania-chef`), versioned. An older chef is brought up to date when
  opened and the chef AS IT WAS is kept beside it (`legacy`) and can be
  downloaded ("More" menu). Ids are never changed.
- `chefBasketValue.js`: the OLDER basket estimate ("the sharing-out"), kept
  and labelled legacy.
- `chefReadiness.js`: `readiness(state)` - every input of the event with
  where it is typed and its state: **missing** (with what its absence
  stops), **to confirm** (there, but nobody confirmed it: a guess of the
  earlier tool, an empty list that may be meant, the unconfirmed rules),
  **optional** or **done**. A tick is the economist's, kept in
  `state.confirmed[id]` with a mark of the values it was given for, so
  changing them asks again. Only "no segment" and "nothing to cook" stop a
  simulation; a missing prize leaves the valuation incomplete and stops
  nothing.

### The Black Friday chef

`data/blackFridayChefData.js`, "New chef: from the Black Friday chef": the
economist's workbook `chef_BlackFriday_2411.xlsx` (repo root) read straight
into schema 2 on 24 November 2026 - 8 ingredients (Gold flakes the semi-
blocker, in 5 dishes; Caviar the blocker, in 2), 12 Main dishes (297 at the
base; Golden Chocolate Cubes the same for every segment), the production
basket strings of both periods (a draft: "the basket production is not 100%
finished yet"), the nine live segments with effort and baskets a day, pantry
caps 40/40/40/40/40/30/30/15, the Prize_sheet prizes. Where the sheets
disagreed the economist chose; what the workbook does not hold starts empty
and the chef's note says so (Dish Master days and dishes, the FU day,
thresholds, the three Recompletion dishes and prizes, prize factors, Chef_control,
jokers). The workbook is the source: a changed workbook is read again by hand.

### A reference chef, and the synthetic example

The historical chefs are complete as history and incomplete as the intended
event. **"Start a reference chef from this one"** ("More" menu) makes a
separate copy (`state.reference = { basedOn, startedAt }`, named "Reference:
..."), opens the list of what it still needs on every step, fills nothing in
and marks nothing as confirmed. The chef it was made from, and the older chef
kept beside it, are not touched. **Do not choose** the three Recompletion
recipes, thresholds, dates, prizes, segment factors or special sources for
it: those are the economist's to type.

**"New chef: a synthetic example (made up)"** (`data/syntheticExample.js`,
`state.synthetic = true`) is the Halloween chef with invented thresholds,
Dish Master days, FU day, checkpoint, three Recompletion dishes with prizes,
pantry caps, an effort factor for each segment (0.5 to 3.5, roughly in step
with what the segment opens - the source has none), a joker and a preset, so
the whole flow can be walked. As typed it is far from its FU target (0 to 3%
of the players in FU on day 14 against 80%): bringing it there is what a
proposal is tried on. A banner
on every step says it is made up and not an approved economy; a reference
chef cannot be started from it; nothing about it may be quoted as a result
for a real event.

### A proposal (build 02): `chefGenerator.js`

**What the economist does.** Step 4: says what may change, clicks Generate,
reads the current event beside the proposal, and applies it or not.

**What a proposal may change** - five switches (`plan.change`): base recipe
quantities of ordinary and semi-blocker ingredients (on), gameplay basket
weights inside the odds periods that exist (on), threshold amounts and new
schedules (on), threshold opening days (off), a blocker quantity of a
segment's own (off). Main only, or Main and Recompletion (`plan.rounds`).

**The recipe budget is chosen, never assumed** (`plan.budget.mode`, no
default). Before recipes may change the economist picks: `bounded` - a
range typed for the Main recipes at the base, all their ingredients
(blockers and semi-blockers too); every version played stays inside it,
from the first fit to the last step (`rebalance` moves units between free
cells: to what players are least short of, never back onto what a step just
made smaller; locks, quantity bounds, pantry fit and recipe membership
kept); or `free` - labelled as such in the review. A plan saved before the
choice existed asks again. "Fill in the reference ±10%" is an example to
edit, not an approved range. A range no recipe can reach is an invalid
setup, with its numbers; it is never widened by itself. Recompletion has its
own optional range (`rcMin/rcMax`), used only when its recipes may change.
The current event is always the comparison, even outside the range: the
search starts from a STARTING POINT made from it and named as such.

**New schedules.** With threshold amounts on, a proposal may create:
the blocker's Main schedule (when none); the semi-blocker's, when allowed
(`plan.semi.allow`, Dish Master days set): a limit before Dish Master (it
starts where no segment can cook one of its dishes - one shared limit read
against every segment's own quantities, `semiExposure`), a rise during it,
lifted the day after, inside the bounds typed (`plan.semi.early*`,
`dm*`); and ORDINARY schedules for allowed ingredients (`plan.pacing`:
`maxOrdinary` counts existing and new together, `excluded` = may not be
given one - an existing schedule is locked in Locks instead). A new ordinary
schedule starts on day 1, steps only on days allowed (opening days on: the
range typed; off: only the days typed in `dayOptions` - none typed, none
made), counts what was RECEIVED, and is lifted on its last day. The search
adds, swaps (another ingredient in its place), redays and removes them; each
new one is played without it before the check and stays away when the
targets do not suffer (`prunedSchedules`). A guided step paces only what
players are not short of (under 20% lacking on the day missed). The optional
"at most N% cook a semi-blocker dish before Dish Master" is a target only
when typed.

**What it never changes**: which ingredients a dish needs, a blocker's base
quantity, segments (effort, prize factor, burnout, supply, activity), basket
sizes and the most a basket gives, pantry caps, prizes, special sources and
jokers, dates, Dish Master days, targets, presets, pricing odds, every rule
setting. It never adds a basket, a purchase, a grant or an odds period. A
weight of 0 stays 0 unless the economist opens it (`plan.locks.open`) - and
a basket that never gives the BLOCKER is never opened to it; the blocker's
days and its steps after the FU day stay as typed: Main completion is never
raised by letting the blocker through ordinary baskets. A positive weight is
never closed.

**Locks** (`plan.locks`): a recipe cell, a whole dish, a basket weight, a
schedule. A locked value comes back exactly as it is.

**A blank quantity** (`count: null`; step 2: empty the field) means "this
ingredient is in the recipe, generate the number". It is not zero (zero: not
in the recipe). A dish with a blank is never cooked - it is not a free dish -
and the checks say so. A proposal fills it only where recipes may change and
the cell is free: a blank in a locked dish or cell, a blank blocker quantity
(always the economist's) and a blank Recompletion quantity without a
Recompletion target are unresolved inputs, said before anything runs.

**Targets** (`describeTargets`, shown in words before anything runs): the
FU target and the checkpoints of step 1, for every selected segment
(`plan.segmentIds`); optionally a limit on waiting (`plan.gap`) and a
Recompletion target (`plan.rc`: a share of the players who ENTER it in its
FU within so many days of entering). Recompletion has no approved speed:
without that target its values are left alone and its timing only reported.
`plan.tolerancePts`: points allowed under a target.

**Bounds** (hard): a budget range for the Main recipes when typed
(`plan.budget.min/max`; `target`, default 250 x days / 21, is only a
preference), quantity bounds, the most a weight may grow
(`plan.weight.maxFactor`, 8), steps per schedule, the days a step may start
on, how many ordinary ingredients may be paced, a blocker-shortage range.
**Every default number of the plan is this tool's own starting point, not an
approved design value, and the screen says so.**

**Rules every candidate keeps** (`infeasible`; a candidate that breaks one is
never played): whole quantities of 1 or more inside the bounds; every dish
fits the pantry at every segment's size (a cap is never raised); schedules in
order, rising, lifted only at their end; the blocker held back on the FU day
with a limit that lets through all its dishes but the largest and leaves the
last one short (per segment); every basket still able to give its size; the
event's own checks pass.

**What stops it, kept apart.** `inputProblems` - MISSING inputs (no target,
nothing allowed to change, no budget choice, unresolved blanks, no blocker
schedule with amounts locked). `configurationProblems` - an INVALID setup
(a check to fix, a basket minimum above 0, more ordinary schedules than
allowed, a bound below its other end, a budget range nothing can reach).
`structuralConflicts` - conflicts PROVED for every event a proposal may
make, each with its numbers and `assumptions`:
1. the blocker lifted on the FU day (a proposal never moves its days nor
   turns a lift back into a limit; the engine reads nobody in FU);
2. a segment whose luckiest player cannot have received enough blocker by
   the FU day - an analytic upper bound under the supply model in force
   (every basket that gives it at its largest, one more basket than the
   expected count; with activity, the day's expectation x the largest
   multiplier / the smallest active share), catch-up presets' contents,
   every source in full, a joker's blocker in full; blocker quantities that
   may change counted at 1;
3. a Main dish needing more of an ordinary or semi-blocker ingredient than
   the pantry holds at a segment's size, at the smallest quantity allowed
   (a blocker short of the pantry can still be the last dish of FU, so it is
   not a proof; Recompletion dishes do not stop Main FU);
4. locked recipes asking for more than all a player can have received (a
   joker counts as its three ingredients in full).
`searchWarnings` - RISKS, said and searched past: a special source giving the
blocker past its threshold (the first version called "at most 1 - coverage
can be in FU" proved; it was not - what a source gives counts toward the
threshold, so baskets give less, and recipients may lack other ingredients:
measured at 50% coverage, 60%+ of Strong still sit in FU), a semi-blocker
with no schedule or no Dish Master days, a locked semi schedule that still
restricts after Dish Master, pacing with no days or no room, a blocker row
opened in an older session.

**The search** (bounded, reproducible from `plan.search.seed`): the current
event is played first (brought inside the bounds if it is outside them, and
that is said); recipes are first fitted to what the slower players of the
weakest segment have received by the FU day; then candidates are played one
at a time on the REAL engine on `search.players` (100) search players. A
guided step reads, on the day the worst segment misses, which ingredients
its players lack, who is still under the blocker's threshold and who has
finished (`probes` in the engine's summary), and answers up to three of
those at once; the rest of the steps are random, more of them the longer
nothing improves. No candidate is played twice. It stops on the candidate
budget (60), on 25 tries without gain, when everything is met and settled, or
on a time limit. While searching, a target counts as met only 3 points above
it (`aimPts`), to leave room for the check.

**What counts as better** (`isBetter`, no hidden score): the shortfall of
the worst segment; then all segments' shortfalls added up; then the typed
preferences (distance from the budget, from the preferred blocker shortage,
ingredients lost or left over, how much was changed). A strong segment never
makes up for a weak one.

**The check.** The best candidate AND the current event are played on other
players (another seed, `validationPlayers` 400), the same ones for both.
Only those figures are shown; nothing is tuned after. Each share has a
verdict from its range: met, met but close, missed but close, missed. When
the proposal changed recipes and something else, the current event with
ONLY its recipes is played on the same players too (`recipesOnly`, the
"Recipes alone" column): how much came from asking for less. Outcomes
(`status`): `meets`, `misses` (better than now, can be applied with its
misses), `no-better` (nothing to apply), `conflict`, `invalid`, `inputs`,
`cancelled` (stopped while searching), `incomplete` (stopped while
checking) - nothing to apply in the last five.

**The proposal** (`state.generator.proposal`, saved with the chef; about
15 KB a segment, no player-by-player record): fingerprints of the event it
was made for and of the event it gives, the plan it was made under, engine
and search versions, seeds and player counts, why it stopped, the log of
candidates, the patch (`dishes, recompletionDishes, baskets, thresholds`),
the list of changes with what each was, per-segment figures for both events
(targets, day-by-day curves, ingredients, Recompletion, payout or
"incomplete"), and explanations built from those measurements.
`canApply` is false once the event or the plan was edited (`staleReason`).
`applyProposal` writes the patch at once and keeps what was there for ONE
undo (`state.generator.applied.previous`, `undoProposal`); the applied event
simulates to exactly the figures the proposal showed (same players, same
seed - checked in the browser suite). A proposal made by an earlier search
version (`chef-search 1.0`) is kept to read and cannot be applied
(`madeByOlderSearch`). The engine's summary also gives, for the semi-
blocker's dishes, who cooked one before Dish Master, how many by its last
day, all of them by then and by the end, and one after it (`dishMaster`).

**Its limits.** A hill climb with a small budget: it can stall, and another
search number can give another proposal. Worst segment first means a gain
for all segments together can lose to noise in the worst one. A free budget
lets recipes fall far under the reference (the made-up example: 378 to about
100 against 250); inside a range the made-up targets are not reached - and
`docs/chef-experiment-2026-11-23.md` shows why: not the amount nor the mix of
supply, but the assumed spread in player activity (the slowest fifth receives
less than FU needs by day 14; with basket luck only the same range reaches
78-100%). It also found that the made-up example gives no Pumpkin during
Dish Master; a warning now says so (`semi-no-supply`). A
ordinary schedule only helps where an over-supplied ingredient crowds out a
lacking one. It does not move or add odds periods. Raising progress raises
what players are paid; prizes are never changed, the payout before and after
is shown.

### Catch-up suggestions (build 03): `chefCatchup.js`

Step 4's second choice ("Suggest: Catch-up presets"). The tool suggests
catch-up presets that bring the segments closer to their targets. The
economist's four answers (24 November 2026, each the recommended one):

- **Who**: "Tool picks, both kinds" - players **behind pace** (at most N Main
  dishes, in a window of days before a target day) or **stuck on an
  ingredient** (still missing at least N of it for the dishes left).
- **What it holds**: "Common and rare only" - ordinary ingredients the Main
  recipes use, never the semi-blocker or the blocker. Like every preset, never
  past a threshold and never over the pantry (the engine's rule).
- **Between equals**: "Fewest players touched" - after build 02's order (the
  worst segment, then all segments), the set fewer players ever get a
  suggested basket from; then fewer presets; then fewer such baskets.
- **The economist's presets**: "Never touch them" - played as they are and
  going first; suggestions are added after (`origin: 'build-03'`, a later
  priority, ids of their own), marked "Suggested (step 4)" in step 3, and one
  undo takes them out.

How it searches: the event as it is first (already met on the check players:
nothing is suggested, and it says so); then sets of up to N presets on search
players - add one for the segment furthest from an FU or checkpoint target
(what that segment lacks on the target day, read from the engine's probe, sets
what a basket holds), move one (its days, who qualifies, how often, the basket
it replaces, its segments, what it holds) or take one away; each preset left
has to earn its place; the event and the suggestion are then checked on
others, in both views. Controls (this tool's own defaults, said on screen): at
most 3 presets, a player at most twice, Basic and Rare baskets (Epic off),
both kinds on; 40 sets on 100 players, checked on 400. Targets, segments and
the view are the proposal's. The engine counts the players who got a
suggested basket (`presets.suggestedShare`, a reading only).

On screen: the rules in words, the targets, the controls, Suggest / Stop; then
the outcome, each preset in words (who, segments, days, how often, the basket,
what a basket of the middle size holds, the share of players given it, the
target it was made for), one row a segment (each target now → with it and
its verdict, the other view, players touched, baskets a player), **what holds
players back on the FU day** (where they are and what they lack besides the
blocker - opened by itself when it is the semi-blocker, which a catch-up does
not give), Apply / Discard / Undo, out of date after an edit.

### Special-event suggestions: `chefEvents.js`

Step 4's third choice ("Suggest: Special events"). From the planning
(economist): "if the model will sence a danger for somehting missing, he can
suggest in the calender to do a special event that will give the players those
ingredients." The tool reads what players lack on the target days and suggests
special events - a day, one ingredient, an amount and the share of players it
reaches - played as the engine plays a special source (never past a threshold,
reaching its share by the chef's "who gets a special source" setting). The
economist's answers (24 November 2026): **a share the tool finds** (the
smallest that works); **common, rare and the semi-blocker**, never the
blocker; between equals **the fewest ingredients given** (as played: what the
events really gave a player, the economist's own sources cancelling out); **the
same event for every segment** (one calendar). The economist's sources are
played as they are; suggestions are added after (`origin: 'events-suggested'`,
"Suggested (step 4)" in step 3), one undo takes them out. Judged like a
proposal and a catch-up, on the same targets, players, verdicts and both views;
controls this tool's own (at most 3 events, at most 30 an event, a share from
10%). On screen: each event in words, the targets now → with it per segment,
what a player was given, what holds players back on the FU day (an event gives
the semi-blocker only up to its threshold - said when that is what holds them),
Apply / Discard / Undo. On the made-up example it gives Sugar and Flour and
still misses: Pumpkin's threshold is what holds players there (single run).

## 6. The screens

A **six-step flow**, on the same logic as the Merge "Build event" flow: a
step shows what is typed or judged and folds the rest (`Collapsible`); what is
wrong is shown at the top of the step that puts it right; results lead; rare
actions sit in one "More" menu; "Next" opens the next step at its top; as
little scrolling as possible at 1500 x 800. A step gets the whole chef
(`state`) and one way to change it (`update`).

| Step | In sight | Folded |
|---|---|---|
| 1. Event and players | Dates, odds periods, Dish Master days, the FU target (day, share), checkpoints. Segments: Brut Wins, effort, prize factor, burnout, baskets as an average or day by day, shape. | Baskets day by day. How players differ (assumptions). |
| 2. Ingredients and dishes | Ingredients with pantry caps (and the sheet's "Cap", with one click to use it). Recipes: the base, or a segment's (the blocker typed there); totals and the budget reference. | Prizes by component, grand prizes, the value table, whole-item rounding, each segment's totals. Dishes as cards. |
| 3. Baskets | The three baskets of a phase: weight, chance at the start, most a basket. | Progression thresholds (schedules, the semi-blocker helper, the two unconfirmed policies). Special sources and jokers. Catch-up presets. Where each blocker comes from. |
| 4. Proposal | A choice: recipes, weights and thresholds, or catch-up presets (build 03, above). For a proposal: what it may change (five switches), the targets in words and the segments it is judged on, the recipe budget (a range or free, chosen), what is missing / invalid / proved impossible (with its assumptions) / only a risk, Generate with progress and Stop. With a proposal: its outcome in plain words, the budget line (current, range, proposal, change), the starting point when it is not the current event, Apply / Discard / Undo, one row a segment (in FU now -> proposed with its range, the difference and met / missed / close; finished; ever in FU; recipes alone; checkpoints; longest wait; finish Main; Recompletion; paid), what got better / worse / is still not met, one segment day by day (dishes and FU, current beside proposed, Dish Master, checkpoint, threshold steps and FU target marked) and all segments in small. | Bounds and optional targets. Pacing (ordinary ingredients allowed a new schedule, the days, the semi-blocker's bounds and what its limit allows per segment). Locks (recipe cells, dishes, weights, opening a 0 - never the blocker's, schedules). How it searches. The semi-blocker and Dish Master. Every change with what it was (recipes at the base or a segment's size, weights with starting chances, schedules, what happens to each ingredient). Why these changes. The proposal without presets. What the search tried. |
| 5. Simulate | What this event still needs (folded; on every step of a reference chef). What needs a fix. One button. After a run, one row a segment: on the FU day (in FU with its range and met / not met, finished, ever in FU), checkpoints, dishes, finish Main, Recompletion, paid. What the run was played on. | A segment in detail. Day by day. With and without presets. One player's event. More or fewer baskets. What is not settled about the real game. All the checks. |
| 6. Basket value | A basket's worth day by day: for a segment, every day and every basket type it opens, one more basket played on the engine (the same players, each compared with themself) - its worth that day is what it adds to what a player is paid, in allowance, with how far it would move with other players - beside the tier worth of the Economy page; out of date after an edit. One more basket on one day, played both ways. The older estimate, labelled as one. | What one ingredient counts for (older estimate). |

A run is kept for the visit per chef with the chef's fingerprint; once the
chef changes it stays on screen marked "Out of date". It is not saved.

## 7. Words

FU; Main round; Recompletion; pantry cap; progression threshold; most a
basket; special source; joker; catch-up preset; allowance worth; effort
factor; prize factor; burnout; "basket luck only" / "player activity and
basket luck"; Needs a fix / Worth a look / Good to know; met / not met.

## 8. Code, and how it is checked

```
src/features/chef/
  components/  ChefApp, EventStep, DishesStep, BasketsStep, ProposalStep, CatchupPanel (build 03), EventsPanel,
               SimulateStep, ValueStep, ReadinessPanel, chefUi
  lib/         chefModel, chefEngine, chefGenerator (build 02), chefCatchup (build 03), chefEvents, chefRewards, chefValidation,
               chefReadiness, chefMigration, chefPersistence, chefRng, chefFormat,
               chefBasketWorth (a basket's worth day by day, on the engine),
               chefBasketValue (legacy), chefLegacyModel (the older factories, for data/ only)
  data/        the two real chefs, as read from the workbooks; the synthetic example
scripts/verify/verify-chef.mjs            the rules, one check each (182 checks, about 25 seconds)
scripts/verify/verify-chef-proposal.mjs   the proposal: what it may and may not change, the search,
                                          the check, apply and undo; new schedules, the budget,
                                          the semi-blocker, proofs and risks, both views (135 checks, about 65 seconds)
scripts/verify/verify-chef-catchup.mjs    catch-up suggestions: what stops one, what a preset may hold,
                                          the economist's presets untouched, the order of "better",
                                          apply, undo, out of date (42 checks, a few seconds)
scripts/e2e/chef-flow.mjs                 the flow in a real browser (185 checks, about 5 minutes)
scripts/verify/verify-chef-worth.mjs      a basket's worth day by day: every day and type, the same as
                                          "one more basket", the same players again, Basic < Rare < Epic (8 checks)
scripts/e2e/chef-catchup.mjs              step 4's catch-up suggestions in a real browser (17 checks)
scripts/e2e/chef-worth.mjs                step 6's basket worth in a real browser (7 checks)
scripts/verify/verify-chef-events.mjs     special-event suggestions: what stops one, what an event may be,
                                          the economist's sources untouched, fewest given, apply, undo (32 checks)
scripts/e2e/chef-events.mjs               step 4's special events in a real browser (11 checks)
scripts/verify/verify-chef-prize-text.mjs prizes as reward text: the economy's order and 2 decimals, what cannot be written (9 checks)
```

- `npx vite-node scripts/verify/verify-chef.mjs` and
  `npx vite-node scripts/verify/verify-chef-proposal.mjs` (both in `npm run verify`).
- `npm run dev` (port 5173), then `npx vite-node scripts/e2e/chef-flow.mjs`.
  Elements carry `data-testid` and `data-chef-step` hooks; keep them.
- `npm run lint` (oxlint) and `npm run build`.

Section 13 of `verify-chef.mjs` holds the review's cases on small events that
can be followed by hand, each line saying what is expected and printing what
was observed (0.4 Epic a day; FU at and past the threshold; 39 sugar under a
cap of 40; three baskets on the day Main is finished; a player who qualifies
for a preset beside one who does not). A sample mean is allowed 4 standard
errors from its expectation - a test count is not a proof; read the lines.

A change to a rule has to change `verify-chef.mjs` on purpose; a change to
what a proposal may do has to change `verify-chef-proposal.mjs` on purpose
(a search has luck in it, but every check there types a seed, so the same
event gives the same proposal on every run). A change to a
screen has to keep `chef-flow.mjs` passing or change it on purpose.

## 9. Not settled, and known limits

**Not confirmed about the real game - each is a visible setting, listed in
step 5 ("What is not settled about the real game"). Do not resolve silently.**

1. Whether overflow lost to the pantry counts toward a threshold (default:
   only what reached the pantry; both counts are tracked). Asked on 24
   November 2026; the economist: "the caps will always be a lot more than the
   threshold so practically it doesn't matter". The setting stays as it is.
2. Whether the pantry carried into Recompletion may cook a dish, reach FU or
   finish it at once. It may; the run counts how often. Nothing is removed.
3. What a basket minimum above 0 does (stored, flagged, not played).

**Settled with the economist on 24 November 2026, and played as rules** (every
chef, one saved before included - `CONFIRMED_SETTINGS`, chefMigration): a
threshold stops a player **exactly at the limit, inside a basket too** ("Stops
exactly at the limit" - it was "checked before each basket", where a basket
could go over); a player cooks **at once, in the order of the list**; a joker
goes to **the blocker while it is needed, then what is most missing**; a special
source reaches **the same players first**; a scaled prize is rounded **down** to
whole items. The other options stay in the engine only so the checks can play
them.

**Limits.**

- Catch-up suggestions (build 03) hold only common and rare ingredients (the
  economist's rule), so they cannot move players held back by the
  semi-blocker; the screen says when that is what holds them back. They were
  only run on small test events and the made-up example - never on a
  completed real event. On the made-up example they barely move the FU day
  (Pumpkin, the semi-blocker, is what 96-99% lack there) while reaching most
  players: "Fewest players touched" only decides between sets that meet the
  targets equally well.
- A proposal (build 02) is the best of a bounded search on simulated players:
  not the best possible event, and not a confirmed design. Every default of
  its controls is this tool's own. It was only ever run on small test events
  and on the made-up example - **never on a completed real event.** Not
  decided by the economist: the budget range of a real event, whether a
  weight may grow 8 times, the 3 points the search aims above a target, the
  0.05 a new ordinary schedule costs among the preferences, the 20% lacking
  above which a guided step does not pace an ingredient, the shape of a new
  ordinary schedule (a rising share of the most demanding segment's need).
- No export to the game's configuration; do not invent the syntax. Step 2 shows
  every prize as reward text by the economy's rules ("Prizes as reward text",
  `chefPrizeText.js`) - a reading to copy, nothing exported. A prize with a part
  that is not a whole item (4.8 undos, while "Whole items" is not decided) gets
  no text and says why; a grand prize says when RoundReward rounds its worth
  away from what its items add up to (which of the two the game pays is not
  settled).
- A basket's worth on the engine, day by day (step 6, `chefBasketWorth.js`)
  is a READING beside the economist's tier worths (Basic 0.25, Rare 1, Epic
  4 on the Economy page); nothing takes it as a value until the economist
  says so ("when the chef model in the app will be better we will change its
  value daily"). With unknown prizes it is too low, and it says so. On the
  made-up example it came out at about 0.5 / 2.5 / 5 (single run) - the
  example is made up and says nothing about a real event. The older
  estimate (the sharing-out) stays below it, labelled as older.
- The two real chefs have 12 Recompletion dishes with no prizes, no
  thresholds and no FU day: until those are typed, nobody is in FU and
  Recompletion's payout is unknown. **No real event has been completed and
  simulated: nothing says a real event meets its targets.** The readiness
  list of a reference chef says what is still to type.
- Segment prize factors of the real chefs are the earlier tool's guess.
- "What it would take" (the older averages solver) was removed with the
  averages model; build 02's proposal does that job on the engine.
- With a few hundred players and varied activity, the baskets opened by the
  players of one run can be a few % off the expected: the screen shows both.
- Thanksgiving's start date is probably not its real one. One Halloween
  Recompletion dish has no name in the source sheet.
- Art is emoji. Simulation results are not saved with a chef.

## 10. How to take a task

1. Say back in a sentence what the economist will see change.
2. If the task touches a rule of section 3 or something in section 9, it is
   their call: ask at the fork, with options and a recommendation.
3. Put a rule in the engine, and what a proposal may do in the generator
   (never in a screen), with a check in `verify-chef.mjs` or
   `verify-chef-proposal.mjs`.
4. Run the checks that cover the change, and look at the screen in a
   1500 x 800 window.
5. Report in plain words: what changed on screen, what was checked, what
   failed or is still open. Do not commit or deploy unless asked.
