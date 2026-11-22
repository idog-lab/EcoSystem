# Demand calibration, merge energy and the Twister: validation

20 November 2026. Nothing here is deployed.

## What is in force

1. **Twister drops.** A merge that makes rank 5 drops exactly one rank-1
   Twister item (Twister only; the other rewards still start at rank 6). A
   merge that makes rank 7 always drops two items: its reward and the Twister
   item. Everything else is unchanged, and the one table plays in both phases.
2. **Demand is the DR a player really pays.** On top of the 80% merge-energy
   credit the build moves the subsidy of the later boards - **off or back on**
   - until the average simulated player pays the demand. Board 1, every
   board's lowest and highest rank, what its tiles can hold and every pin are
   kept.
3. **Twister values and price per segment**, fitted on the final boards so the
   typical player reaches the twists asked at 70-75% of the DR demand spent.
4. **No rank 1 or 2 on a Recompletion board**, held by the generator itself.

## How it was validated

- Three different events, built with the real build: all 8 segments, the
  normal event and Recompletion, 48 segment-phases in all.
  - A: 3 normal boards, 4 Recompletion boards, demand 248 to 1,448, 15 and 10
    twists, price steps of 10.
  - B: 4 normal boards, a luckier generator (EV 1.25), demand 348 to 1,548,
    20 and 12 twists, price steps of 5.
  - C: a smaller first board, later generator tiers, smaller rewards, demand
    298 to 1,398, 10 and 8 twists, price steps of 10.
- Each segment-phase was then played by 200 players the build never saw
  (another seed, each with their own luck).
- For the before/after, every event was also built with the calibration
  switched off and played by the same players, and the run of the round
  before (subsidy only ever taken off) is kept for comparison.
- These are single builds. Events A and C are from the first build with the
  two-way calibration; event B was built again after a bound in it was
  corrected. Another build moves individual figures by a few points, and in
  Recompletion by more (see "The spend moves in jumps").

To run it again: `npx vite-node scripts/analysis/twister-validation.mjs 200`
(about 20 minutes).

## Before and after

| | No calibration | Subsidy only taken off | Off or back on (now) |
|---|---|---|---|
| Normal event: segments within 5% of the demand | 2 of 24 | 19 of 24 | 21 of 24 |
| Normal event: within 2% | - | 16 of 24 | 18 of 24 |
| Normal event: furthest over the demand | 18% over | 22% over | 2% over |
| Recompletion: segments within 5% | 3 of 24 | 19 of 24 | 17 of 24 |
| Recompletion: average distance from the demand | 23.9% | 8.2% | 4.8% |
| Recompletion: furthest over the demand | 41% over | 64% over | 25% over |

## Which overspending cases the two-way calibration fixes

Every case where a player paid more than the demand with nothing taken off.
The cause was the same each time: the 80% merge-energy credit took more
subsidy off than the free taps gave back (see "Where merge energy goes").

| Event / segment / phase | Demand | Taken off only | Off or back on |
|---|---|---|---|
| A / Segment 1 / normal | 248 | 301 (+22%) | 241 (-3%) |
| C / Segment 1 / normal | 298 | 309 (+4%) | 287 (-4%) |
| B / Segment 3 / Recompletion | 748 | 1,189 (+59%) | 765 (+2%), 586 DR put back |
| B / Segment 2 / Recompletion | 548 | 697 (+27%) | 593 (+8%); 542 (-1%) on the build before |
| B / Segment 1 / Recompletion | 348 | 569 (+64%) | 414 (+19%), not settled |

## Which cases remain

**Proven limits** - every later board is at the least it can hold, so the
player cannot be made to pay more:

| Event / segment / phase | Demand | Pays | |
|---|---|---|---|
| A / Segment 8 / normal | 1,448 | 1,381 (-5%) | |
| B / Segment 6 / normal | 1,248 | 1,095 (-12%) | a luckier generator and little subsidy |
| B / Segment 7 / normal | 1,398 | 1,056 (-24%) | the same |
| B / Segment 8 / normal | 1,548 | 1,014 (-35%) | the same; "Needs a fix" |

No segment hit the other limit (boards that can hold no more).

**Not limits** - Recompletion segments the search did not land on:

| Event / segment | Demand | Pays | What the passes found |
|---|---|---|---|
| A / Segment 1 | 248 | 310 (+25%) | players paying 132 to 584 |
| B / Segment 1 | 348 | 414 (+19%) | 192 to 712 |
| B / Segment 4 | 948 | 812 (-14%) | a jump: 808 and 1,136 with 24 DR of subsidy between |
| B / Segment 2 | 548 | 593 (+8%) | a jump: 436 and 956 with 12 DR between |
| A / Segment 6 | 1,098 | 1,181 (+8%) | 676 to 1,332 |
| C / Segment 1 | 298 | 320 (+7%) | 252 to 320 |

In the normal event two segments are inside 5% but outside the build's own
2% margin (A / Segment 1 at -3%, C / Segment 1 at -4%).

### The spend moves in jumps

In Recompletion what a player pays does not follow the subsidy smoothly. The
same segment with the same subsidy, two sets of boards: 756 and 1,148 DR.
Another: 1,300 DR on three sets running, then about 800 with 13 DR more
subsidy. Paid taps in Recompletion are x4 taps of 4 DR, and a set of boards
that needs 70 more of them costs 280 DR more; which items a set happens to
hold decides it. So a Recompletion segment can be inside the margin on one
build and 8% to 25% outside it on the next (B / Segment 2: -1% and +8%;
B / Segment 4: -1% and -14%). The build now reports this as what it is, with
the two figures, and not as a limit. Events A and C were built before that
wording existed, so their rows above say only what the passes found.

All of these are inside the 25% the economist allows a Recompletion miss.

## Where merge energy goes

The average player, per phase (three events):

| | Normal event | Recompletion |
|---|---|---|
| Carried in | 0 | 26 |
| Collected in play | 228 | 416 |
| Collected at the phase-end collection | 39 | 23 |
| Used on free taps | 202 | 394 |
| Left unused | 66 | 71 |
| Share of the energy collected that is used in the phase | 74% (45% to 91% by segment) | 81% (59% to 92%) |
| Credit taken off the subsidy | 207 DR | 310 DR |
| The same as a share of 80% of the energy collected | 98.7% | 88.4% |

- **Collected too late:** 16% of a normal-event player's energy arrives only
  when the phase ends (7% in Recompletion), and 26% of everything the phase
  had is still unused at the end (17%).
- The credit is 80% of the energy **collected**. A player who uses three
  quarters of it gets back less than was taken off - which is why small
  demands paid over. Example, A / Segment 1: 150 in play, 50 at the end, 131
  used, 69 left; the credit took 160 DR off, the free taps gave back 131.
- **Not counted twice:** energy carried into Recompletion is used there, and
  was credited once, in the normal event. Recompletion's credit is taken on
  what Recompletion collects.
- The 80% rule is unchanged and nothing is capped. The calibration puts back
  what it costs the player, as its own signed line next to the credit.

## When the twists are reached (timing)

| | Normal event | Recompletion |
|---|---|---|
| Segment medians inside 70-75% | 15 of 24 | 10 of 24 |
| Within 3 points of the window | 21 of 24 | 17 of 24 |
| Within 5 points | 23 of 24 | 22 of 24 |
| Average distance from the window | 0.9 points | 2.8 points |
| Furthest | 8.3 points | 29.7 points |
| Individual players: before 70% / inside / after 75% | 20 / 55 / 23 of 100 | 36 / 34 / 31 of 100 |
| Reach the twists only with the phase-end collection | 1 of 100 | 0 of 100 |
| Never reach them | 1 of 100 | 0 of 100 |

A segment median inside the window is not the same as its players being
inside it: the window is 5 points wide, so even a segment whose typical player
is at 72% has about four in ten players outside.

Recompletion lands less often because it plays the normal event's Twister
values (one table) and only its price can move.

## How the spins arrive (cadence)

| | Normal event | Recompletion |
|---|---|---|
| First spin | at 8% of demand, after 50 generator actions | at 0.8%, after 25 generator actions |
| Chances to spin | 7 to 22 (average 14.8) | 8 to 16 (average 12.1) |
| Twists per chance | average 1.39, highest 3.0 | average 1.03, highest 1.5 |
| Longest wait | average 15.0 points, highest 31 | average 17.9 points, highest 31 |

The segment with the most subsidy is still the jumpy one in the normal event:
7 chances of 3.0 twists (A), 10 of 2.2 (B), 7 of 2.9 (C).

## Bigger Twister items at ranks 7 to 9 (an experiment, not adopted)

The Twister item one rank bigger only in the drops of merges that make ranks
7, 8 and 9, rank 3 at most. **Rank 5 keeps its one rank-1 item.** Every reward
item, weight and item count is as it is. Values and price were fitted again
on the same boards, and the same players played both.

| | Drops in force | Bigger at ranks 7 to 9 |
|---|---|---|
| Normal: segment medians in the window | 15 of 24 | 16 of 24 |
| Normal: within 3 points | 21 of 24 | 23 of 24 |
| Normal: segments further from the window than now | - | none |
| Normal: chances to spin (average, range) | 14.8 (7-22) | 17.2 (10-26) |
| Normal: twists per chance (average, highest) | 1.39, 3.0 | 1.12, 1.9 |
| Normal: longest wait (average, highest) | 15.0, 31 points | 13.8, 26 points |
| Normal: other rewards and DR paid, against the drops in force | - | 100.0%, 100.0-100.3% |
| Normal: how full the board gets | 70% | 70% |
| Recompletion: segment medians in the window | 10 of 24 | 12 of 24 |
| Recompletion: furthest from the window | 29.7 points | 15.3 points |
| Recompletion: segments clearly further out | - | 2 (A / Segment 1: 2.4 to 15.2 points; A / Segment 3: 5.8 to 15.3) |
| Recompletion: other rewards, DR paid | - | 99.1-101.6%, 99.8-102.1% |

In the segment with the most subsidy (normal event): A goes from 7 chances of
3.0 twists to 10 of 1.9, B from 10 of 2.2 to 16 of 1.5, C from 7 of 2.9 to 10
of 1.5.

Reading: in the normal event the timing is the same and the cadence is
materially better - more chances to spin, about one twist each, shorter
waits - with no measured effect on anything else. In Recompletion it is
mixed: two more segments in the window, two clearly further from it.
Production keeps the drops in force until the economist chooses.

## The board

- Twister drops land on real cells under the same rules as play. No dropped
  item was thrown away in any run.
- Normal event: the typical player's board is at most 70% full. Fewer than 1
  in 100 players had a full board at some moment. Dropped items that had to
  wait off the board: 0.00 a player.
- Recompletion: typical peak 77%. 14 in 100 players had a full board at some
  moment, 0.02 dropped items a player waited off the board, and 0.24 forced
  taps a player.

## Paired players

Each player has one stream of generator luck and a separate stream for which
container a merge rolls, both seeded per player. A change to the Twister drops
cannot shift anybody's lucky drops. It can change where items sit on the
board, and with that a player's own sequence of taps: in one check 39 of 40
players paid exactly the same DR with bigger items, in another 19 of 40, with
the average within 1% both times.

## What crosses into Recompletion

Not decided by anyone yet. The same players were read three ways:

| Reading | First spin | Twists reached (average over segments) |
|---|---|---|
| Twister items on the board come along, balance starts at 0 (how the simulator plays) | 0.8% of demand, after 25 generator actions | 71.0% |
| Nothing comes along | 1.0%, after 35 generator actions | 76.9% |
| Items and the unspent normal-event balance come along | 0.7%; 1.4 twists can be bought before the first tap | 69.6% |

On average a player carries in 1.5 Twister items (worth 18 Twister DR), 13
Twister DR of unspent balance and 26 merge energy, and earns 874 Twister DR
inside Recompletion. A first spin "at 0.8%" is real play - 25 taps, most of
them free on carried energy - not a spin at the first moment; the percentage
is small because free taps do not count as DR paid.

## The other rewards

Normal event, against each segment's own targets: coins 99-101%, puzzles
97-103%, merge energy 94-104%, charms 96-105%.

Recompletion follows from the normal event and is not sized: coins 72-103%,
puzzles 83-145%, merge energy 69-150%, charms 83-139%.

## Checks

- Engine: all seven suites pass on the final code (336 build, 154 container,
  234 V2 rewards, 147 Twister, 43 endless, 70 real-play, 79 cadence). New in
  the cadence suite: the calibration in both directions and where it stops,
  the spend that jumps, where merge energy goes, the rank 7-9 candidate, and
  a Recompletion board generated from data that says "from rank 1".
- One engine check sat on the edge of the 15% margin and failed once (a
  build that paid 87% of an amount, where the check expected a reported
  shortfall). It now asks for clearly more than typed values can pay.
- Browser: all 17 suites pass in one full run on the final code. The full run
  before it had 16: one suite stopped when its page went blank mid-test (it
  passes alone; the same unexplained kind as in the round before - no page
  error was logged), and the same suite then caught a sentence on the build
  page that said "merge-energy credit", which is reworded.
- The production build compiles. Nothing is committed or deployed.
