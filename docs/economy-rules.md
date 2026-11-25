# The economy: rules, where they live, what is open

The economist's "Economy Rules & Reward Syntax" (given in chat on 2026-11-24),
as this app holds them. One economy for the whole app: `src/lib/economy/`
(the rules) and the **Economy** page on the home screen
(`src/features/economy/`). Read this before touching a prize, a reward text, a
value table or a segment condition in any feature.

## How the app is taught (economist, 25 Nov 2026)

The economist and their coworker teach the app the economy, and later each
event, **by explaining in chat**; what they teach is **kept in the project**
(not in a browser), so both of them and the published site have the same.

- Every value taught is in `src/lib/economy/taught.js`: the value table, the
  Chef basket tiers, currencies (a worth, or values by date) and keys
  (presets, packs, chests, triggers, buckets, with a worth where they have
  one). Each entry carries `said` (their words), `on` (the day) and `by`.
  Write an entry only for what was said in so many words; a key is the
  game's, never made up.
- **A taught value wins over a browser's own.** The Economy page shows it with
  a "Taught" mark (the words in its hover), with no field to change it and no
  Remove button. A browser that held its own value is told once which it was;
  a file loaded from before says so too.
- What is typed on the Economy page and not taught stays in that browser. The
  Worth tab lists it ("Typed in this browser only") with **Copy as a message**,
  to paste in chat and have it taught.
- Teaching goes the usual way of the repo: a branch, a pull request the
  economist merges, the site published by the merge.

## Where the rules apply (economist)

> "all the rules u got now are applied only on prizes we will add to the tiers
> in the features. all the rules we got from befor for small reweards and
> twister are untouched."

- **Tier prizes of any feature** follow these rules.
- **Merge Mania's small rewards and the Twister keep their own rules**
  (`rewardChain.js`: `niceRewardValues`, `niceCoinValues`; `twisterCadence.js`:
  any whole price for a twist). Asked and answered:
  - Merge's small-reward rank values are **not** rounded by MergeRoundReward.
  - Merge's small coin values **keep up to 3 decimals** when small
    ("Keep 3 decimals when small"); a tier prize's coins have 2.
  - The Twister's price is **any whole number**, not the spin-cost steps.
- **Chef's grand prize follows RoundReward** ("Yes, RoundReward"); it was the
  nearest 5 at every size. A dish prize is still not rounded.

## 1. Value: everything in allowance

Value is always measured in **allowance** (also called coins). One table:

| Resource | Syntax | Worth of one |
|---|---|---|
| Coins | `allowance(coins:X)` | 1 (X is already allowance) |
| Wild | `free_wild:N` | 2.5 |
| Extra Stock | `free_stock:N` | 2 |
| Undo | `free_undo:N` | 0.25 |
| Free Round / Entry | `free_entry:N` | 1 |

Energy (`energy:N`) was in the first text and is removed ("u can remove this
energy"): it is not on the table, and `energy:N` is not an item the checker
reads. (Merge Mania's merge energy is the currency `dr-merge`.)

Sheet names: Wild → free_wild; Extra Stock / ExtraStock → free_stock; Undo →
free_undo; Free Round / FreeRound / Entry → free_entry (`resourceIdOf`).

**Worth of a prize** = coins + wilds x 2.5 + extra stock x 2 + undos x 0.25 +
free rounds x 1 + puzzle pieces x the puzzle value of the day + every currency
(DR) amount x its value + packs (worth 0) + Chef baskets (their tier) + preset value + ...
(`rewardWorth` in `parse.js`). Of `[a|b]` the player gets the first available,
so the first is counted. **A part with no worth makes the total unknown,
never smaller**; the known part is shown beside it.

## 2. Reward text

Atoms: `allowance(coins:X)`, `allowance:<bucket>(coins:X)`, `free_wild:N` and
the other resources (whole numbers), `dynamic(<dr-name>:<amount>)`,
`sticker_pack:<key>`, `preset:<key>`, `chest:<name>(<reward>)`,
`trigger:<name>`, `Missing(<bucket>,<i>)` / `Duplicate(<bucket>,<i>)`.
`+` is AND, `[a|b|c]` is "the first available", brackets nest. No spaces, `.`
for decimals, coins to 2 decimals. Hidden counter:
`[dynamic(dr-pack-counter:1)|[dynamic(dr-hidden:1)]]` (dr-hidden is worth 0).

**Order a tier is written in**: trigger, allowance, free_wild, free_stock,
free_undo, free_entry, preset, [sticker_pack], [pack counter], other
[dynamic], all in a chest. Two of the economist's four real examples are in
another order, so **the checker never calls an order wrong**; the builders
write this one.

**Golden rules**: never invent a key (currency, pack, preset, chest, trigger,
bucket - they come from the Economy page's lists; a key not on a list is a
warning to check, not made up); empty or invalid input gives an empty string,
never `dynamic(:0)`, `free_wild:0` or a stray `+` / `|`.

Builders (`syntax.js`): `rewardSyntax`, `coinsSyntax`, `resourceSyntax`,
`altReward` (DR_AltReward), `drSyntax` (DR_Syntax_V5), `counterSyntax`,
`packSyntax`, `chestSyntax`, `presetFor` (snaps to an amount that exists on the
list, falls back to `_allowance` for mini-games; never makes a key up),
`chefBasketSyntax`, `tierSyntax`. Reader and checker (`parse.js`):
`parseReward`, `formatReward` (writes it back exactly), `checkReward`,
`rewardWorth`.

## 3. Currencies (dynamic resources)

Name `dr-` + kebab-case. One worth: **game play** ("we will use only the
gameplay, u can remove all the pricing things from the app"; the Rate of
Economy, on-cards multiplier and currency factor are not used for now).

**Always in the game** (economist, 25 Nov 2026: "there are DRs that will
always be in the game ... puzzle, merge, picks, pet. those should be in a
different table, that also holds the dates that the value is relevant to";
`CORE_CURRENCIES`): **dr-puzzle** a value for each day, **dr-pet** a value
for each week it is live (7 days "From the day I type"), **dr-merge** and
**dr-pickaxe** (merge and picks, "like we got in the table now") **one fixed
worth** ("as for the picks and merge, we can give a fixed value for now" -
first they had a value "From date to date"). The puzzle and the pet hold
`periods` - `{ from, to, value }`, both days included, never two on one day -
and are worth only what they say: a worth without dates is not used (the page
says so when an older save has one). Merge and picks are their one worth on
every date; dates typed for them before are not used (said too).
They are always on the page, in a table of their own on the Worth tab, never
removed and never on the drop list. The puzzle's values saved in the dated
writing (`2026-11-30=0.0376875|...`) become one day each; that writing is
still what a puzzle list is pasted in.

**A date with no value is unknown** (asked: "Unknown"), never the nearest
date's: before the first, after the last, or a week the pet is not live. The
reader says "no value given for <date>". Event currencies with values by date
(the dated writing) read the last date before one between two, and nothing
outside them (`currencyValue`). With no date chosen, the first date is read,
and said.

**Adding a currency**: a drop list of the game's currencies not in the table
(`currencyChoices`: `GAME_CURRENCIES` in gameKeys.js - the economist's list
of 106, pasted 25 Nov 2026, copied as given: two names twice, and two that
may be cut short in their sheet, `dr-christmas-wheel-with-i` and
`dr-wicked-trails-dr-gold` - and the ones the page starts with). The basket
counter is on that list but never offered (removed by the economist on 24
Nov). Its last choice, "A new currency...", takes a new
name, which then stays in this browser until it is taught.

On the list to start: the names the economist gave (dr-puzzle, dr-pickaxe,
dr-midnight-blast-heel, dr-pet, dr-sugar-gp, dr-candy-catcher-red,
dr-totem-rush, dr-bonus-trail, dr-coins-booster-x2-15min, dr-pack-counter,
dr-hidden), and Merge Mania's dr-merge, dr-mf-charm and
dr-twister (the game's name - economist: "its the name of it"). dr-hidden and
dr-pack-counter are worth 0 ("packs are prices with 0"); every other worth is
for the economist to type. **The basket counter is gone** ("the basket counter
has no value. and also u can remove it, that logic is not up to date"): a Chef
basket is written as its preset alone. An economy saved before these answers is
brought up to date when opened (a worth someone typed is kept).

## 3b. The game's keys (given 24 Nov 2026, `gameKeys.js`)

- **608 sticker packs**, every one **worth 0** in a prize ("0 for every pack");
  only what is given in a pack's place has a worth.
- **Presets**: the list headed "baskets" (81: the Chef baskets, their
  `_pricing_` twins, Chef blast / specific blocker / push gift / trade / rank,
  market_*, pick_1 to pick_20, mystery box, scene boosts, joker basket ...) and
  a third list (21: Chef_Inject_* and Chef_Dish1..12_Complete - asked: they are
  presets), plus the four of the examples. Only the Chef baskets have a worth
  (their tier); the others are "not set" until a worth is given.
- **Chef baskets** are the `Chef__Basic|Rare|Epic_Phase_...` presets of the list -
  which kinds exist is the list's, not a pattern's (Basic: Undo, Allowance, Free
  round; Rare: Allowance, Free round, Extra stock; Epic: Extra stock, Wild,
  Free_round3). Worth by tier: Basic 0.25, Rare 1, Epic 4, the same every day for
  now ("when the chef model in the app will be better we will change its value
  daily"). The prize builder offers the 17 game-play ones (not `_pricing_`).
- **Coming from the economist** (the next thing to teach, 25 Nov 2026: "Finish the basics"): the presets' syntax. Mini-game presets are
  built from merge and picks: their values are to be held, the preset's text
  built from them, and that is its worth. Puzzle presets: the puzzle's daily
  values over a time range are to be held, and a preset's worth is the average
  puzzle value over the event's days.
- The keys lists on the Economy page are searched (a long list shows 12 at a
  time); a saved economy gets these keys added when opened, and keeps its own.

## 4. Segments

Weighted Brut Wins:
`(fn_DailyBrutWins_m4(3,1m,2m,4m,8m)*0.7m+fn_DailyBrutWins_m4(14,1m,2m,4m,8m)*0.3m)`;
the mode version uses `fn_DailyAvgModeMultiplier_m4`. Decimal literals take
`m`; integer thresholds stay bare. A band is above its start and at most its
end: first `BW <= max`, middle `BW > min && BW <= max`, last `BW > min`;
optional `&& (MODE < 3m)` / `&& (MODE >= 3m)`. Name
`<Feature>_BW_<min>_<max|Plus>[_Mode_0_3|_Mode_3_plus]`, key `def_<name>`.
Bands must be contiguous, not overlap, and cover 0 to no end (`checkBands`).

**The functions segments are made of** (economist, 25 Nov 2026: "the next
thing i want us to do is to learn the logic of as many functions as we can
that with them we create segments ... when building segments we will need
to create the best flow to create them with different logics"; "the BW and
avg mode are very very important"). A dictionary in the project,
`segmentFunctions.js` (`SEGMENT_FUNCTIONS`), each function with the words it
was explained in, an example, and what is not confirmed - never invented:
- `fn_DailyBrutWins_m4(days,1m,2m,4m,8m)`, `fn_DailyAvgModeMultiplier_m4(...)`
  (section 4 above; what 1m,2m,4m,8m stand for is not confirmed).
- `fn_DiamondMine_Progression(<event id>U)`, `fn_Merge_Progression(<event id>U)`:
  the player's progression in that event, in % ("the only thing important is
  the event Id"); `fn_DiamondMine_Progression(57634U) > 95` = above 95%
  (`progressionCondition`; a decimal % takes m).
- **The modes and their multipliers** - the 1m,2m,4m,8m of Brut Wins
  ("#m is the multiplier on the mode. each net win is a level win, each brut
  win is the net win * mode multiplier"): mode 1 x1, mode 2 x2, mode 3 x4,
  mode 4 x8 (`MODE_MULTIPLIERS`).
- `CoinsInAllowance` (the balance, in allowance - "mostly when we will use the
  balance to get a segment of users with low balance", OOC = out of coins) and
  `CurrentLevel`: names alone, no brackets. Their example:
  `CoinsInAllowance < 2 && CurrentLevel > 519`.
- **Parts are joined with `&&`** ("its another fucntions they are added up
  with &&"): progression is a part like any other.
The Segments tab builds a condition of parts (progression by event id,
balance, level; `buildCondition`), lists the functions, and
**reads any condition** (`readCondition`): in words, part by part; an event id
without U, a wrong number of inputs or a bracket left open must be fixed; a
function not in the dictionary is named "not known to the app yet", never
guessed at. How the logics combine into a flow is the next step.
Chef's live segments already follow this. Segment economics (multiplier,
burnout, effective multiplier, Total DR, target points) are given but not yet
built into a shared calculation.

## 5. Rounding (`rounding.js`; must match the sheets)

- **RoundReward**: under 90 → nearest 5, and a 5 becomes 10; 90 to 200 → down
  to the 10; above 200 → nearest 50; sign kept. Tier rewards and thresholds;
  the Chef grand prize.
- **MergeRoundReward**: ≤30 nearest 2 (at least 2); ≤150 nearest 5 (at least
  5); ≤200 nearest 10; else nearest 50. Tier prizes of a Merge feature - not
  Merge Mania's small rewards.
- **Spin or point cost**: step 10 above 100, 5 above 26, 2 above 10, else 1;
  at least 1. Not the Twister's price.
- **Alternative DR amount**: to the 5 above 8 units, else to the 1, at least 1.
- **Puzzle fallback**: to the 5, at least 5 (some features 10).
- **Resource alternative**: round(allowance / worth), at least 1, then the cap.
- **Coins in syntax**: 2 decimals.

MROUND = nearest multiple, a half away from zero (Excel).

## 6. Balancing a feature's tiers (`balance.js`, the "Balance tiers" tab)

The rules' checks: a tier's worth is its reward text read by the economy; gap =
worth - tier target, as a % of the target, per tier and cumulative, flagged
beyond +-X% (X is not given in the rules: typed, 10 to start - this app's own);
the grand prize (the last tier) as its share of the worth and of the target;
the currency amount to close a gap = round((target - the tier's worth without
that currency) / its worth), written as `dynamic(<name>:<amount>)` ("none
needed" when the tier is above its target). A part with no worth makes a tier
unknown - never a smaller number - and the running total unknown from there.
Tiers are typed or pasted from a sheet (tier, target, text - or target, text -
one a line, tab-separated) and kept in this browser as a working sheet.

## The Economy page

Home screen → Economy. Tabs: **Worth** (the value table, Chef basket tiers,
currencies with game-play, pricing and dated values), **Keys** (presets, packs
with their allowance, chests, triggers, allowance buckets - typed or pasted),
**Check a reward** (paste one or many texts: readable or not, what is off the
lists, the worth on a chosen date), **Balance tiers** (section 6), **Build a prize** (from parts, in the
standard order, checked and valued), **Segments** (band ends → names, keys and
conditions, copy as a table), **Rounding** (each rule with where it is used
and a number to try). Every change is kept in this browser at once; Download /
Load a file / Start again in the header.

Who reads it:
- **Chef**: its default value table is the economy's
  (`DEFAULT_REWARD_VALUES = chefValuesFromEconomy(createEconomy())`); a chef
  keeps its own copy, and step 2 (prizes) says when it differs from the
  Economy page's, with one click to take it. The grand prize by RoundReward.
- **Merge Mania**: the Syntax tab reads every small-reward item text with the
  checker (3 coin decimals allowed) - a reading only, nothing is changed. A
  backup file carries the economy; importing one asks before replacing this
  browser's. A saved event opened from the switcher never touches it.
- **Diamond Mine**: not connected (left alone until asked).

## Answered (24 Nov 2026)

- **A second currency as a fallback goes inside**: `[dynamic(a:N)|[dynamic(b:M)|last]]`
  ("it should be inside, but it can be not only coins, any core resource can
  be the last fallback. coins, undo, free round, extra stock, wild"). The V5
  side-by-side shape is not built.
- **Challenges weights**: "doesnt matter" - the page takes them as typed.
- **dr-twister** is the game's name ("its the name of it").
- **Counters**: the pack counter is worth 0; the basket counter is removed
  ("the basket counter has no value. and also u can remove it").
- **Chef's thresholds are not rounded by RoundReward** ("yes thats right").
- **Energy** (`energy:N`) is removed ("u can remove this energy").
- **Pricing** is removed: only the game-play worth; no Rate of Economy, on-cards
  multiplier or currency factor for now.
- **Chef basket worth**: by tier, the same every day for now.
- **Packs**: every pack is worth 0. **The third key list** (Chef_Inject_*,
  Chef_DishN_Complete) is presets.
- **Rounding**: nothing more needed - the six rules of section 5 stand.
- **Segment economics** are given per feature; the specific event does not
  matter for now ("we are just learning about the values presets, allowances,
  and syntax rules").

- **Prize values** (picks, pet, merge, puzzle): the economist enters them in
  the model itself when making a feature - nothing to give ahead.
- **Allowance buckets and triggers**: left as they are for now; a trigger can
  be added by hand (Keys tab, "Add").
- **Chests**: four, taught on 25 Nov 2026 - `wooden`, `silver`, `golden`,
  `purple`, written by the name alone ("here is an example chest:wooden(...");
  "Only the four": the pink-chest and yellow-chest taken from the reward
  examples are off the list, and off a list saved before (economy version 5).
  The economist types the chest's name (Build a prize: a box with the four
  offered; a name off the list is not named). The wrapping is
  `chest:<name>(<the whole reward>)` - everything of the tier inside the
  parentheses, `+` parts and `[a|b]` fallbacks included; no name, no wrapper;
  a chest is worth what is in it. Held by verify-economy (3b) and economy-page.
- **Puzzle fallback inputs (BaseAmount, PuzzleMult) and RoundReward under 2.5**:
  "leave it" - the builder takes a worth and a multiplier; RoundReward gives 0.

## Open questions (not settled)

None asked and waiting. The worths of the currencies and of the presets other
than the Chef baskets are "not set" until entered; a prize holding one reads
"unknown", never a smaller number.

## Checks

`scripts/verify/verify-economy.mjs` (in `npm run verify`): the value table,
every rounding rule on its edge cases, the reader and checker, the four real
examples read and written back exactly, every builder making them, empty
input giving nothing, worth with dated values, segment conditions to the
character, Chef reading the same table, the game's keys. `scripts/e2e/economy-page.mjs` (in
`npm run e2e`): the page in the browser, Chef's note, the Syntax tab's reading
and a Merge backup carrying the economy.
