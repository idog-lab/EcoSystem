# Twister cadence investigation

20 November 2026. This is the investigation as it stood: no drop rule had been
changed and every structure below was an experiment. Since then the
recommended structure was adopted, with demand calibration and a per-segment
Twister fit - see twister-validation.md for where things stand.

## The question

Each segment should reach the twists asked for when its player has paid
**70-75% of the segment's DR demand**, and the Twister should give steady,
recurring chances to spin rather than one late jump.

Progress is measured as paid generator DR in the phase divided by the
segment's configured DR demand. Free merge-energy taps add nothing to it. It
is not clamped at 100%.

## How it was measured

- One test event built with the real build: four segments with a DR demand of
  298, 748, 1,048 and 1,348, with 15 twists asked in the normal event and 10
  in Recompletion, and prices in steps of 10 Twister DR.
- 300 simulated players per segment and per drop structure, in both phases.
  Every structure is played with the same luck, so two of them differ by what
  they change and not by the draw.
- For each structure the Twister values and the price of a twist were fitted
  to the window: one set of values for both phases (the game has one table),
  one price per phase and segment. The fit takes the simplest numbers that
  land the typical player in the window: values not below 2/5/12/30, then the
  lowest price.
- This is one built event. A second build would move the numbers by a few
  points.

To run it again: `npx vite-node scripts/analysis/twister-cadence.mjs 300`.
In the app: step 6, "Twister, timed on the DR spent", then "Compare".

## What the current build does

| Segment (DR demand) | Twists reached at | Players there by 75% | Chances to spin | Twists per chance | Longest wait | First spin at |
|---|---|---|---|---|---|---|
| 1 (298) | 79% | 32 of 100 | 6 | 2.9 | 38 points | 18% |
| 2 (748) | 65% | 90 of 100 | 9 | 2.1 | 22 points | 6% |
| 3 (1,048) | 86% | 12 of 100 | 10 | 1.5 | 18 points | 5% |
| 4 (1,348) | 74% | 54 of 100 | 12 | 1.6 | 15 points | 1% |

The four segments land between 65% and 86%. The segment with the most subsidy
gets its twists in six jumps of about three.

## Three things found on the way

1. **Most players finish before they have paid 100% of the demand.** The
   normal event ends at 96 / 88 / 92 / 90% of the demand for the typical
   player, Recompletion at 78 / 81 / 78 / 86%. Lucky drops return more value
   than the DR paid. So the 70-75% target sits at about four fifths of what a
   normal-event player really pays, and nine tenths in Recompletion.
2. **Merges are spread evenly over the spend.** For every rank from 5 to 9,
   about a quarter to a third of the merges have happened by 25% of the
   demand, half to two thirds by 50%, and 70-85% by 75%. Starting the Twister
   at rank 5 therefore does not make it arrive earlier. It doubles how many
   items drop (30 / 61 / 80 / 100 rank-5 merges per player, against 16 / 33 /
   43 / 54 at rank 6).
3. **The current drops cannot hit the window by pricing alone.** With six to
   ten finished Twister items in a phase, the moment the twists are reached
   moves in jumps of 15 to 30 points when the price changes. Segment 1 can
   land at 50% or 79%, nothing in between. This is a limit of the drops, not
   of the price.

## The comparison (normal event, 15 twists)

Each value is Segment 1 / 2 / 3 / 4.

| Drop structure | Segments in the window | Twists reached at | Players within 10 points of the window | Chances to spin | Twists per chance | Longest wait (points) |
|---|---|---|---|---|---|---|
| Current drops, refitted | 1 of 4 | 79 / 65 / 70 / 74% | 47 / 89 / 94 / 95 | 6 / 9 / 10 / 12 | 3.3 / 2.2 / 1.7 / 1.5 | 38 / 22 / 18 / 15 |
| Twister from rank 5 | 2 of 4 | 62 / 67 / 70 / 74% | 59 / 100 / 100 / 100 | 9 / 16 / 18 / 18 | 2.1 / 1.1 / 1.0 / 1.0 | 23 / 13 / 14 / 11 |
| Twister in every rank-7 drop | 1 of 4 | 50 / 65 / 75 / 77% | 0 / 98 / 100 / 100 | 7 / 10 / 12 / 14 | 3.1 / 2.0 / 1.4 / 1.3 | 47 / 17 / 17 / 14 |
| Bigger Twister items | 3 of 4 | 79 / 73 / 72 / 74% | 47 / 89 / 88 / 94 | 9 / 14 / 17 / 18 | 1.9 / 1.3 / 1.0 / 1.0 | 27 / 17 / 12 / 13 |
| Rank 5 + bigger items | **4 of 4** | 74 / 72 / 75 / 74% | 85 / 100 / 99 / 100 | 17 / 18 / 17 / 18 | 1.2 / 1.0 / 1.0 / 1.0 | 16 / 12 / 11 / 9 |
| **Rank 5 + every rank-7 drop** | **4 of 4** | 74 / 74 / 72 / 74% | 100 / 100 / 100 / 100 | 10 / 18 / 17 / 18 | 1.7 / 1.0 / 1.0 / 1.0 | 23 / 12 / 12 / 10 |
| All three together | 2 of 4 | 74 / 70 / 70 / 72% | 100 / 100 / 100 / 100 | 19 / 18 / 18 / 18 | 1.1 / 1.0 / 1.0 / 1.0 | 16 / 12 / 10 / 8 |

(In "all three together" the two segments counted as outside the window are
at 69.6 and 69.9%.)

Two structures were tested and set aside because they take another reward's
place:

| Drop structure | What it costs |
|---|---|
| Twister in half the rank-6 drops | Coins fall to 59-66% of today's. In Segment 1 about 5 reward items under the tiles are never opened. |
| Twister in the three-item drops | Merge energy falls to 48-68% of today's, and players pay 4-21% more DR. |

The four Twister-only structures leave coins, puzzles, merge energy, charms,
DR paid, tile opening and board space exactly as they are.

## Recompletion (10 twists, same values as the normal event, its own price)

| Drop structure | Segments in the window | Twists reached at |
|---|---|---|
| Current drops, refitted | 0 of 4 | 77 / 67 / 69 / 69% |
| Twister from rank 5 | 4 of 4 | 71 / 71 / 74 / 70% |
| Bigger Twister items | 1 of 4 | 77 / 71 / 76 / 69% |
| Rank 5 + bigger items | 2 of 4 | 75 / 73 / 69 / 72% |
| **Rank 5 + every rank-7 drop** | 3 of 4 | 78 / 74 / 74 / 74% |
| All three together | 3 of 4 | 78 / 71 / 73 / 72% |

Recompletion is harder to land for two reasons: its phase ends at about 80%
of the demand, so the window is close to the end, and its values are the
normal event's, so only the price can move.

## Recommendation

**Twister from rank 5, together with the Twister item in every rank-7 drop.**

- Rule changes it needs:
  1. A merge that makes rank 5 drops one rank-1 Twister item. Rewards still
     start at rank 6.
  2. A merge that makes rank 7 always drops two items (its reward and the
     Twister item), instead of one or two.
- What it gives, normal event: all four segments in the window (72-74%),
  every player within 10 points of it, 10 to 18 chances to spin instead of 6
  to 12, and the longest wait down from 38 to 23 points in the segment with
  the most subsidy.
- Recompletion: three of four segments in the window; the fourth at 78%.
- Other rewards, DR paid and tile opening: unchanged.
- Fitted numbers on this test event (values, then price in the normal event
  and in Recompletion): Segment 1: 5/15/35/75, 40 and 120 DR. Segment 2:
  3/8/20/50, 50 and 110 DR. Segment 3: 3/7/15/40, 50 and 100 DR. Segment 4:
  2/6/15/35, 50 and 100 DR.

**If the rank-7 rule has to stay as it is:** Twister from rank 5 with bigger
Twister items. It also lands all four normal-event segments, gives the
steadiest spins (17-18 chances of about one twist each), and needs only the
rank-5 exception. It lands two of four Recompletion segments, and rank-1
Twister items almost disappear from the drops.

## What stays limited whichever is chosen

- The segment with the most subsidy still gets about 1.7 twists per chance
  under the recommended structure (10 chances). Only adding bigger items
  brings it to one twist per chance.
- About half the players reach the twists by 75% and half shortly after: the
  window is 5 points wide and the typical player is placed inside it.
- The Recompletion segment with the most subsidy reaches its twists at 78%.
  It also starts Recompletion with Twister items carried over from the normal
  event, so its first spin comes at 0%.
- Whether a Twister balance carries from the normal event into Recompletion
  is still an open question. Recompletion is measured from an empty balance.

## What changed in the tool this round, and what did not

Changed:

- Every rank value the model gives is now worth more than double the rank
  below (it was "at least double"), Twister included. A typed ladder that
  breaks this is flagged with fixes and never changed on its own.
- The simulator records the paid DR of every Twister drop, collection and
  merge, and marks what is collected at the end of a phase.
- Step 6 shows, for the build as it is priced, when each segment reaches the
  twists in % of DR demand spent, against the 70-75% target, and offers the
  comparison above for the segment on screen.

Not changed:

- The drop rules. No Twister item drops at rank 5 and rank 7 is still one or
  two items.
- How the build prices a twist. It still gives shared Twister values and a
  price per segment such that the typical player has the twists by the end of
  the phase. Switching it to per-segment values fitted to the 70-75% window
  is ready to be wired in once a drop structure is chosen, because on the
  current drops half the segments cannot land there at any price.
