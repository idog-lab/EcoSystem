# Chef proposal: a design experiment inside a budget range

23 November 2026. A test of the Chef proposal generator (build 02 and its
follow-up) on ONE configuration, inside a declared recipe-budget range, with
the full current → recipes alone → proposal results. Read with
`docs/chef-overview.md` (sections 3 to 5 define every term used here).

**The configuration is the synthetic example, which is made up.** It is the
Halloween chef with invented thresholds, Dish Master days, FU day,
checkpoint, Recompletion dishes and prizes, pantry caps, segment effort
factors, a joker and a catch-up preset. No real Chef event is complete in the
app yet (the real chefs have no thresholds, Dish Master days, FU day or
Recompletion prizes), so no real event could be tested. Nothing below is a
result for a real event.

## 1. What was set before running

| Setting | Value |
|---|---|
| Event | 21 days; odds period 1 = days 1-10, period 2 = days 11-21; Dish Master days 5-10 |
| Targets | 80% of every segment in Main FU on day 14; 80% with 6+ Main dishes by day 10 |
| Segments | 9, effort factors 0.5 to 3.5 (made up), supply and prize factors from the Halloween sheet |
| How players differ | "player activity and basket luck": a lasting activity level between 0.4x and 1.6x of the segment average, active on 55-100% of days (typed assumptions, never measured) |
| Recipe budget | **Within 225-275** Main ingredients at the base (a test range, not approved; the reference is 250). The current event asks for 378 |
| May change | recipe quantities, basket weights, threshold amounts and new schedules. Opening days locked |
| New ordinary schedules | up to 2, stepping only on days 4, 7, 10 or 13 |
| Blocker (Green Jelly) | 2 Main dishes (3 + 7); threshold 6 from day 1, lifted day 17 |
| Semi-blocker (Pumpkin) | schedule 0 / 2 from day 5 / 4 from day 7 / 6 from day 9 / lifted day 11 |
| Search | 150 versions, 100 players a segment; checked on 400 other players a segment. Three search numbers: 2026, 7, 99 |

## 2. The three searches

All three stayed inside 225-275 for every version tried (the log records each
version's total), and all ended at **225**, the bottom of the range. All three
miss the FU target in every segment.

| Search | In FU on day 14, the 9 segments | New ordinary schedules kept |
|---|---|---|
| 2026 | 47 58 57 59 61 64 66 61 60 % | none |
| 7 | 43 54 51 56 58 61 62 56 56 % | none |
| 99 | 48 59 61 61 64 68 69 64 62 % | Butter |

The three land within about 6 points of each other. A different search
number does not change the picture.

## 3. Current → recipes alone → proposal (search 2026, 400 players a segment)

"Recipes alone" is the current event with only the proposal's recipe
quantities; weights and schedules are as they are now. It shows how much of
the change comes from asking for less.

| Segment (effort) | In FU day 14 | 6+ dishes by day 10 | Dishes day 14 (avg) | Longest wait, 9 in 10 players (days) | Finish Main by day 21 | Paid (avg allowance) |
|---|---|---|---|---|---|---|
| P25 of DAU (0.5) | 0 → 1 → 47% | 48 → 75 → 76% | 7.2 → 8.9 → 9.4 | 8 → 9 → 10 | 0 → 0 → 0% | 62 → 73 → 73 |
| P50 of DAU (0.6) | 1 → 3 → 58% | 52 → 80 → 81% | 7.4 → 9.3 → 9.8 | 8 → 10 → 10 | 3 → 3 → 8% | 66 → 77 → 83 |
| P75 of DAU (0.75) | 1 → 11 → 57% | 48 → 77 → 79% | 7.3 → 9.4 → 9.8 | 8 → 9 → 10 | 10 → 10 → 14% | 73 → 85 → 90 |
| P90 of DAU (1) | 3 → 32 → 59% | 50 → 80 → 83% | 7.6 → 9.7 → 9.8 | 7 → 10 → 10 | 31 → 32 → 35% | 119 → 131 → 136 |
| P99 of DAU (1.7) | 2 → 51 → 61% | 53 → 82 → 86% | 7.7 → 9.8 → 9.9 | 7 → 9 → 9 | 45 → 66 → 69% | 142 → 181 → 185 |
| 10% of Revenue (3.5) | 3 → 55 → 64% | 56 → 86 → 87% | 7.8 → 9.9 → 10 | 7 → 8 → 8 | 50 → 78 → 82% | 185 → 244 → 251 |
| 20% of Revenue (3) | 3 → 55 → 66% | 56 → 86 → 88% | 7.9 → 9.9 → 10.1 | 7 → 9 → 9 | 49 → 76 → 81% | 184 → 241 → 249 |
| 50% of Revenue (1.6) | 3 → 49 → 61% | 53 → 81 → 85% | 7.6 → 9.7 → 9.9 | 8 → 9 → 9 | 46 → 67 → 72% | 142 → 182 → 189 |
| 100% of Revenue (1.25) | 2 → 30 → 60% | 52 → 79 → 83% | 7.5 → 9.6 → 9.9 | 8 → 10 → 10 | 27 → 20 → 34% | 95 → 97 → 114 |

**FU readings.** In every segment, nobody had finished Main on day 14
(current, recipes alone or proposal), so "ever in FU" equals "in FU".
Among the players in FU, the last dish was short of 4 Green Jelly now and 7
with the proposal.

**Payout.** It is complete because the example's prizes are made up. It rises
in every segment because more players progress; no prize was changed.

**Dish Master (Pumpkin's 3 dishes), every segment, all three columns:**
- cooked one before Dish Master: 0%;
- dishes by its last day (average): 0;
- all three by its last day: 0%;
- one after it ended: 98-99% now, 100% with the proposal.

## 4. What the proposal changed

| What | Change |
|---|---|
| Main recipes | 378 → 225 (-40%). Pumpkin in its 3 dishes 24 → 4. Which ingredients a dish needs is unchanged |
| Green Jelly (blocker) | threshold 6 → 3 from day 1, still lifted on day 17. Last dish short on the FU day: 4 → 7 |
| Green Jelly weights | rare and epic baskets 50 → 400 (epic period 2: 100 → 800, the most a weight may grow, x8). Basic baskets stay 0: a proposal never opens the blocker in a basket that never gives it |
| Sugar, Apple, Milk, Pumpkin weights | up 10-50% in the baskets that give them |
| Pumpkin schedule | unchanged |
| New ordinary schedules | none kept (Chocolate, Milk and Butter were each tried) |

## 5. Why the targets are missed inside this range

**1. It is not the total amount of supply.** By day 14 the middle player of
every segment has received MORE ordinary and semi-blocker ingredients than
FU needs with the proposal. For example, P25 receives 167 against 115
needed; P90, 318 against 215.

**2. It is not the mix either.** With the proposal, players lacking an
ingredient on day 14 are spread evenly, 12-35% for each ingredient; no single
ingredient stands out. An extra search step that fitted basket weights to the
recipe mix was tried, and it changed FU by about 1 point. It was removed.

**3. It is the spread between players.** "Player activity" lets one player
open 4 times as many baskets as another (0.4x to 1.6x). For 80% of a segment
to be in FU on day 14, the slowest fifth must already have everything. The
same proposal, on 400 other players, played two ways (single run; the search
behind it also tried that weight fit):

| Segment | In FU d14, player activity | In FU d14, basket luck only | Slowest fifth received by day 14 (activity / luck only) | FU needs |
|---|---|---|---|---|
| P25 of DAU | 48% | 83% | 101 / 152 | 115 |
| P50 of DAU | 59% | 94% | 120 / 177 | 128 |
| P75 of DAU | 55% | 88% | 147 / 220 | 170 |
| P90 of DAU | 59% | 97% | 202 / 299 | 215 |
| P99 of DAU | 62% | 100% | 339 / 534 | 366 |
| 10% of Revenue | 65% | 100% | 709 / 1114 | 760 |
| 20% of Revenue | 65% | 100% | 621 / 986 | 645 |
| 50% of Revenue | 60% | 98% | 315 / 491 | 343 |
| 100% of Revenue | 59% | 97% | 249 / 379 | 278 |

With the activity spread, the slowest fifth of every segment receives less
than FU needs by day 14, so 80% in FU cannot be reached inside 225-275. With
basket luck only, the generator, searching and checking that way inside the
same range, reached 78% for P25 and 90-100% for the rest. In that run 6+
dishes by day 10 was 100% everywhere, against 0% in FU for the current
event.

**4. Dish Master cannot progress as typed.** Pumpkin has weight 0 in every
basket of odds period 1 (days 1-10), which covers all of Dish Master (days
5-10). Nobody receives Pumpkin during Dish Master, whatever its schedule
says. A proposal never opens a weight of 0 by itself. The tool now says this
before generating: "No basket gives Pumpkin during Dish Master...".

## 6. What this means

- **The generator does keep the budget,** and it improves every segment inside
  it: from 0-3% to 47-66% in FU.
- **The remaining gap comes from an assumption, not from the search:** the
  assumed spread in player activity. Until that spread is measured, the FU
  target is judged against an invented player population.
- **"80% of every segment in FU on one day" conflicts with players who differ
  4x in activity, at this effort.** Lowering effort (the free search reached
  65-91% with recipes at about 100) only hides that conflict.

**Decisions for the economist:**
1. The real spread of player activity, per segment if possible. It is a
   setting in step 1, "How players differ".
2. Whether the FU target should hold for that whole spread, or be read
   differently (a later day, a lower share for low-activity players, or catch-up
   presets - build 03).
3. Whether Pumpkin should be given in period 1, so Dish Master can progress.
   This is the economist's choice; a proposal never opens a weight of 0 by
   itself.

**Recommended next step:** complete one real event (a reference chef) and run
this same experiment on it, with a measured or agreed activity spread. That
should come before building automatic catch-up presets.

## 7. How this was run

- The figures come from scripts run against the app's own library: the real
  engine, the generator as it is in the app.
- The suites were green at the end: verify-chef-proposal 133 checks,
  chef-flow 170 checks in a real browser, verify-chef 167.
- Every share is from one run of 400 players a segment. The range a share
  would land in with other players is about ±5 points near 50%.
