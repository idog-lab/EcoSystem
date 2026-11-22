# Chef: what the feature is, and how to work on it

State on 22 November 2026. This is a briefing for an assistant who will take
tasks on the Chef feature. It is complete on its own: read it before the
first task, and treat sections 2, 9 and 10 as standing instructions.

## 1. What this is

**Chef** is a live-ops event in a mobile card game (Disney Solitaire). For two
or three weeks players open **baskets** that give random **ingredients**, and
cook **dishes** when they hold everything a recipe needs. Each dish pays a
prize; cooking all of them pays one more. After the dishes comes a second
round, **Recompletion**, with harder recipes on the same baskets.

The **Chef tool** is one feature of a browser app ("Economy design toolkit",
Vite + React 19 + Tailwind 4, no backend, no charting library). The event's
economist uses it to set an event up, play it with simulated players, and
judge what a basket is worth. The app has two other features, Merge Mania
and Diamond Mine. Chef shares only `src/components/` (Button, Card,
NumberField, Collapsible, InfoHint, HeroPage) with them. Leave the other two
alone unless a task names them.

There is no export from Chef to the game's configuration yet (section 9).

## 2. Who you work for, and the rules of the work

The user is the event's **economist, not an engineer**.

- Answer in plain words and show results on screen. No solver or statistics
  jargon in front of them: the screens say "the middle player" (not median),
  "most players, from the slow ones to the fast ones" (not P10 to P90),
  "simulated players" (not Monte Carlo runs), "the same players every run"
  (not seed).
- **The economist decides the game's rules and the model.** Do not change a
  formula, a constant of the simulator, the data of a real chef, or what a
  check counts as wrong because it makes code simpler or a number nicer. A
  suspected flaw in the model is written down and shown to the economist, not
  fixed on your own. Ordinary bugs in how things are shown or typed are fixed.
- **A limitation is never hidden, and a warning is never turned into a
  success message.** Section 9 lists the known ones; the screens state the
  first two.
- **Do not invent production values or syntax.** Numbers in the two real
  chefs were transcribed from the economist's spreadsheets; what a sheet did
  not say stays marked as unknown.
- **Verify in the real app**, not only in the library (section 8). Report
  what was checked and what failed. A simulation has randomness in it: say
  "single run" when quoting one, or fix the players.
- **Publishing is the economist's call**: commit, push and deploy only when
  asked, each time.
- When two rules collide, or a task needs a rule that does not exist, ask a
  short question with options and a recommendation, at the fork.

## 3. The model

Everything is plain data made by factory functions in
`src/features/chef/lib/chefModel.js`. One event setup is called a **chef**.

| Thing | Fields | Notes |
|---|---|---|
| Ingredient | `id, name, rarity, cap, art` | `rarity`: `common`, `rare`, `semi-blocker`, `blocker`. The source sheets call the semi-blocker tier "Epic". `cap` ("demand cap") is kept from the sheets and read by nothing. `art` is an emoji placeholder. |
| Dish | `id, name, recipe, prizeValue, art` | `recipe` is `[{ ingredientId, count }]`. `prizeValue` is the prize at the **low** prize size. |
| Basket | `id, chestType, phaseId, totalMin, totalMax, ingredientWeights, pricingIngredientWeights` | `chestType`: `basic`, `rare`, `epic`. One basket per chest type and phase. A weight row is `{ ingredientId, min, max, weight }`. |
| Calendar | `startDate, totalDays, phases` | `phases` is `[{ id, label, days }]`, one after the other from day 1. Dates are derived; a chef may have no start date. |
| Segment | `id, name, avgBasketsPerDay, prizeTier, activityShape` | `avgBasketsPerDay` is `{ basic, rare, epic }`. |
| Grant | `id, day, ingredientId, amount, coveragePct, label` | An ingredient handed out besides the baskets: a sale bundle, an event reward. |

A chef's state is `{ ingredients, dishes, recompletionDishes,
recompletionCaps, baskets, calendar, segments, totalChefPrize, grants }`.

- **Two dish lists.** `dishes` and `recompletionDishes` share the
  ingredients, baskets, calendar and segments. `recompletionCaps` (a demand
  cap per ingredient for that round) is data only.
- **How a basket rolls** (`rollBasket`). A total is drawn evenly from
  `totalMin` to `totalMax`. That many units are handed out one at a time by a
  weighted draw among the ingredients with a weight above 0 that have not yet
  reached their `max` for this basket. The roll stops early if none is left.
  `min` is carried from the source syntax and not used.
- **How a blocker opens.** There is no unlock schedule. An ingredient has a
  weight of 0 (or a low one) in an early phase's basket and more in a later
  phase's.
- **Segments** differ in three things only: baskets opened a day per chest
  type, **prize size** (`low` x1, `medium` x1.2, `high` x1.5, applied to every
  dish prize and to the prize for cooking every dish), and the spread of
  activity over the event (`flat`, `ramp-up`, `taper`, `weekend-boost`).
- **The prize for cooking every dish** is `totalChefPrize`, one value a prize
  size, paid once when the whole list is cooked.

### The two real chefs in the app

`src/features/chef/data/halloweenChefData.js` and `thanksgivingChefData.js`,
transcribed from the economist's workbooks (`reference/chef_*.xlsx`).

| | Halloween | Thanksgiving |
|---|---|---|
| Calendar | 21 days from 18 Oct 2026: Phase 1 10 days, Phase 2 11 | 14 days: Phase 1 10 days, Phase 2 4. Its start date is the same as Halloween's and is probably a template value left in the sheet. |
| Ingredients | Sugar, Flour, Butter (common); Apple, Chocolate, Milk (rare); Pumpkin (semi-blocker); Green Jelly (blocker) | Potato, Cream, Pumpkin (common); Turkey, Flour, Sugar (rare); Cranberries (semi-blocker); Sweet Potato (blocker) |
| Dishes | 12, prizes 1 to 14 at the low size | 12, recipes from the workbook's `Suggestions` sheet (the economist: "the suggestions are the actual data we are using") |
| Recompletion dishes | 12, **no prizes** (`prizeValue: null`). One is named "(unlabeled column in source sheet)": its header was blank. | 12, no prizes |
| Baskets | 6. Basic gives 3 to 5 ingredients, Rare 6 to 10, Epic 12 to 20. Pumpkin has weight 0 in every Phase 1 basket. Green Jelly is never in a Basic basket and is in Rare and Epic from day 1. | 6, same sizes. Cranberries are in every basket from day 1 at a lower weight. |
| Segments | 9: P25, P50, P75, P90, P99 of DAU and 10%, 20%, 50%, 100% of Revenue. Basic baskets a day from 2.6 to 11.6. | the same 9 (the sheet is identical) |
| Prize for every dish | 90 / 108 / 135 | 90 / 108 / 135 |

Every basket has pricing odds of its own. The prize sizes of the segments are
this app's own first guess (DAU groups low or medium, Revenue groups higher);
the sheet did not label them.

## 4. The simulator

`src/features/chef/lib/chefSimulation.js`. One call plays one segment.

`simulateMonteCarlo({ segment, dishes, baskets, calendar, grants, runs = 300,
strategy, seed, totalChefPrizeValue })` plays `runs` players through the
calendar and returns figures by day and by dish. For each player:

1. **Who the player is**, drawn once. A share-of-grants position between 0
   and 1: a grant with `coveragePct` 40 reaches the players below 0.4, so
   whoever gets a 20% grant also gets a 50% one. An activity multiplier,
   even between 0.4 and 1.6. A share of days played, even between 0.55 and 1.
2. **Each day.** Whether the player plays today follows a two-state chain
   with persistence 0.5, so played and missed days come in streaks while the
   long-run share stays the player's own. On a played day the baskets opened
   per chest type are `segment rate x the day's shape x the player's
   multiplier / the player's share of days`, turned into a whole number by
   chance (2.6 is 2 baskets, plus one more 60% of the time). On a missed day,
   none. Each basket is rolled as in section 3 with the odds of the day's
   phase.
3. **Grants** of that day are added to the pool for the players they reach.
4. **Cooking.** The player cooks every dish the pool can pay for in full,
   again and again until none is left; the recipe is taken out of the pool; a
   dish is cooked once. `strategy` sets the order tried: `list-order` (the
   order of the list) or `prize-first` (biggest prize for the segment first).

What comes back:

- `days[]`: per day the average, the middle player (`p50`), the slow and fast
  players (`p10`, `p90`), min and max, and `fullClearFraction` with
  `fullClearMarginOfError` (95%, normal approximation).
- `dishStats[]`: per dish the share of players who cook it, with its margin,
  and the day the fast, middle and slow players do.
- `leftoverStats[]`: per ingredient the average left in the pool at the end.
- `nearMissStats[]`: per ingredient the share of players who end with a dish
  that lacks that one ingredient only.
- `stalledStats`: day of the first dish (fast, middle, slow), the share who
  never cook, the longest run of days without a dish (middle, slow).
- `payoutStats` when `totalChefPrizeValue` is passed: the prizes a player ends
  with (dishes at the segment's prize size, plus the prize for every dish).

**The same players again.** `seed` makes a run repeat to the last digit
(`chefRng.js`, mulberry32). A run has four streams, kept apart so that a
change to the odds does not change who plays on which day: days of play,
grants, basket size, ingredient picks. Without a seed every run has new
players. 300 players of one segment take about 40 ms.

**Three smaller tools on the same model.**

- `simulateCompletion`: the event on averages, no luck, no grants, no
  differences between players. A basket gives the middle of its range,
  shared by weight and capped at each ingredient's most per basket.
- `runSensitivitySweep`: the event played seven ways, from 30% fewer to 30%
  more baskets a day, 150 players each.
- `solveRequiredBasketRate`: the smallest number to multiply a segment's
  baskets by so that a share of the dishes is cooked by a day. A search on
  `simulateCompletion`, up to 20 times; it does not count grants.

## 5. What a basket is worth

Two estimates, in prize value, never in money.

- **Day by day, a sharing-out** (`chefBasketValue.js`). Each dish's prize at
  the chosen prize size is shared evenly over the units its recipe needs. The
  prize for cooking every dish is shared evenly over all the units of all
  recipes. An ingredient counts, per unit, for the sum of those shares over
  the dishes that need it. A basket is worth what it gives on average, with
  its **pricing odds**, times those unit values. It shows which ingredients
  carry the prizes. It is not a price: it does not know that an ingredient is
  worth nothing without the others a recipe needs, or once a dish is cooked.
- **One more basket, played** (`estimateMarginalBasketValue`). The same
  players are played twice, once as they are and once with one more basket of
  a type on a day, and the prizes they end with are compared. A rough figure:
  see the first limit in section 9.

## 6. The checks

`validateChefConfig` in `chefValidation.js` returns findings `{ severity,
area, step, message, entityId }`. `severity` is `block` (on screen "Needs a
fix"), `review` ("Worth a look") or `info` ("Good to know"). `step` is the
step of the flow that puts it right. Messages use the names on screen, never
an internal id unless the thing no longer exists.

- **Needs a fix**: a basket whose smallest total is above its largest, or
  below zero; a basket where no ingredient has a weight; a basket set to give
  more than its ingredients allow; a weight or a most-per-basket below zero;
  a basket, recipe or grant naming an ingredient that no longer exists; a
  chest type with no basket in a phase; a recipe count of zero or less;
  phases that do not add up to the event's days; a phase with no days; a
  grant outside the event's days, below zero, or to a share outside 0 to
  100%; a segment opening fewer than zero baskets.
- **Worth a look**: a dish that needs nothing; an ingredient no dish needs
  and no basket gives; a blocker or semi-blocker that no basket and no grant
  gives.
- **Good to know**: an ingredient needed by 70% or more of a dish list; an
  ingredient baskets give but no dish needs; a blocker that only comes from
  grants.

Both real chefs have nothing to fix and nothing to look at.

## 7. The screens

The feature is a **five-step flow**, built on the same logic as the app's
Merge "Build event" flow at the economist's request ("apply the logic of how
we build the merge also to the chef. the flow and etc."). Keep to it:

- The steps follow the order of the work, and each says what it is for
  ("Step 2 of 5 · what players collect, and what they cook with it").
- A step shows what has to be typed or judged. The rest is folded, with a
  line saying what is inside (`Collapsible`, a native `<details>`).
- What is wrong is shown at the top of the step that puts it right, never
  folded, and counted on that step's button.
- Results lead; their detail is one click away.
- Rarely used actions sit in one "More" menu.
- "Next", bottom right, opens the next step at its top.
- As little scrolling as possible in the economist's window (1500 x 800):
  wide two-column layouts, low table rows (`data-dense`).
- A number is taken when its field is left or on Enter (`Num` in
  `chefUi.jsx`); an emptied field puts its value back.

| Step | In sight | Folded |
|---|---|---|
| 1. Event and players | Start date, days, the phases (name, days, dates; add, remove). The segments table: baskets a day per chest type, prize size, activity. Removing a phase removes its baskets. | - |
| 2. Ingredients and dishes | Ingredients (name, kind, demand cap). The recipe table for the dishes or the Recompletion dishes: one row a dish, one column an ingredient, the prize. The prize for cooking every dish. Removing an ingredient takes it out of every recipe, basket and grant. | The dishes as cards |
| 3. Baskets | One phase at a time, its three baskets side by side: how many ingredients, and per ingredient the weight, the chance and the most per basket. Every basket has a row for every ingredient; one added later starts at a weight of 0. A switch between real odds and pricing odds. | Sales and events (the grants). Where each blocker comes from, and when. |
| 4. Simulate | What needs a fix, with a link to its step. One "Run the simulation" button and a line saying what it plays. After a run, one row a segment: dishes cooked by the middle player, most players, the share who cook every dish, first dish, longest wait. | What is played (dish list, segments, player's order of cooking, players, the same players every run). Day by day per segment. All segments on one chart. One segment dish by dish. More or fewer baskets. What it would take. All the checks. |
| 5. Basket value | The dish list and prize size. The day-by-day chart and its table by phase. "One more basket", with the sentence that its figure is rough. | What one of each ingredient counts for |

The header holds the chef's name, a list of chefs when there is more than
one, "Unsaved changes" or "Saved", the "More" menu (new chef blank or from a
real chef, duplicate, delete, export backup, import backup) and Save.

A simulation is kept for the visit, per chef, with a fingerprint of the chef
it was played on. Once the chef changes it stays on screen marked "Out of
date" until it is run again. It is not saved.

Saving writes the whole library of chefs to the browser's `localStorage`
(key `merge-mania-chef`), on Save only. A backup file is that library as
JSON. A save from before there was a library still opens.

## 8. Code, and how it is checked

```
src/features/chef/
  components/
    ChefApp.jsx       state, the library of chefs, the header, the steps, Next and Back
    EventStep.jsx     step 1        DishesStep.jsx    step 2
    BasketsStep.jsx   step 3        SimulateStep.jsx  step 4
    ValueStep.jsx     step 5        chefUi.jsx        Num, Toggle, RowActions, Finding
  lib/
    chefModel.js        the factories, prize sizes, activity shapes, dates
    chefSimulation.js   rollBasket, the players, the what-ifs, one more basket
    chefBasketValue.js  the sharing-out
    chefValidation.js   the checks
    chefRng.js          the repeatable random streams, the 95% margin
    chefPersistence.js  save, load, backup, the older save
    chefFormat.js       how a day is written
  data/                 the two real chefs
scripts/verify/verify-chef.mjs   the model, held as it is (56 checks, a few seconds)
scripts/e2e/chef-flow.mjs        the flow in a real browser (104 checks, about a minute)
```

- `npx vite-node scripts/verify/verify-chef.mjs`, also part of `npm run verify`.
- `npm run dev` (port 5173), then `npx vite-node scripts/e2e/chef-flow.mjs`,
  also part of `npm run e2e`. It checks the flow as a first visit finds it.
  Elements carry `data-testid` and `data-chef-step` hooks for it; keep them.
- `npm run lint` (oxlint) and `npm run build`.

A change to the model has to change `verify-chef.mjs` on purpose. A change to
a screen has to keep `chef-flow.mjs` passing or change it on purpose. Section
8 of `verify-chef.mjs` holds the two limits below as checks, so that fixing
one is noticed and the sentence on screen is changed with it.

## 9. Known limits and open questions

Do not resolve these silently. Each is the economist's call.

1. **"One more basket" is noisy.** The extra basket takes its luck from the
   same streams as every other basket, so every basket opened after it rolls
   differently in the second play. Measured on Halloween with 300 players:
   one more basket that gives nothing moved the average prize by 0.63, and one
   more Basic basket on day 1 gave +3.4, +3.9, +3.5, +6.4, -0.6 and +2.4 on
   six sets of players. Step 5 says the figure is rough. Giving the extra
   basket a stream of its own would make the two plays differ by that basket
   alone. Offered, not done.
2. **An activity shape other than Flat changes how many baskets are opened**,
   although the intent was to move them between days. Over Halloween's 21
   days: slow start -5.7%, fade -8.6%, weekend boost +8.6%. Step 1 shows the
   figure beside the shape. Whether a shape should keep the total is open.
3. **Recompletion is played as an event of its own from day 1**, on the same
   baskets, not as what follows the dishes: nothing is carried over and it
   does not start when the dishes are done.
4. **The Recompletion dishes have no prizes.** Their basket value comes from
   the prize for cooking every dish alone, and "biggest prize first" is the
   list order there.
5. One Halloween Recompletion dish has no name in the source sheet.
6. The Thanksgiving start date is probably not its real one.
7. **There are no targets.** Nothing says what share of a segment should cook
   every dish, or by when. The tool shows figures and marks none as good or
   bad. Thanksgiving's `Suggestions` sheet has target completion days per
   dish; they were not brought in.
8. The source sheets have harder and easier recipe sets (0.8, 1.1, 1.4
   "difficulty multiplier" blocks). Only the baseline is modeled.
9. Demand caps are stored and shown, and read by nothing.
10. A dish prize is one number. The sheets build it from rewards (coins,
    wilds, undos) through a value table (`REWARD_VALUE` in the Halloween
    data), which nothing uses yet.
11. Players cook as soon as they can and never choose which basket to open.
    A segment opens its baskets at one rate all event, apart from the shape.
12. A grant's audience is fully nested (the most engaged first). Real sales
    data may look different.
13. **No export.** The game reads baskets as a "Reward String"
    (`random_group(3,5,TrueRandom,dynamic(sugar)(0,3,220),...)`), which the
    data was read from. Nothing writes it. Do not invent the rest of the
    syntax; ask for a reference sheet.
14. Art is emoji. Simulation results are not saved with a chef.

## 10. How to take a task

1. Say back in a sentence what the economist will see change.
2. If the task touches the model, the data of a real chef, or what counts as
   wrong, check sections 2 and 9. Ask when it is their call.
3. Make the change in the step it belongs to, in the words of section 2.
4. Run `verify-chef.mjs` and `chef-flow.mjs`, look at the screen in a
   1500 x 800 window, and add a check for what is new.
5. Report in plain words: what changed on screen, what was checked, what
   failed or is still open. Do not commit or deploy unless asked.
