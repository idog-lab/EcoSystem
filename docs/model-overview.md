# Merge Mania economy toolkit: the model and its logic

State on 21 November 2026. The live site (https://idoggk.github.io/Merge/) is
one round behind this document: the Twister rules, the demand calibration and
the per-segment Twister fit described here are built and tested but not
deployed.

## 1. What this is

A browser tool that designs the economy of **Merge Mania**, a 7-day merge
event inside a mobile game. Its user is the event's economist, who is not an
engineer. The economist types what each group of players should spend and
receive. The tool then builds the boards and reward drops that deliver it,
tests the result on simulated players, lets people play it through a shared
link, and exports the configuration sheets the Ops team loads into the game.

Three parts carry the logic:

1. **The game model**: the rules of the event as the tool understands them.
2. **The build**: turns the economist's inputs into a complete event.
3. **The simulator**: plays the built event to check it, and is itself
   checked against the real play screen.

Rules marked **(economist)** below were asked for by the economist and are
not to be changed for convenience. Numbers marked **(tool's own)** are the
tool's choices and can be tuned.

## 2. The game model

### Value, ranks and phases

- Items form a chain of ranks. Two items of the same rank merge into one of
  the next rank. An item of rank r is worth 2^(r-1) **DR**, the event's
  currency. Almost every calculation rests on this.
- **Normal event**: ends when the player holds a rank 12 (2,048 DR).
- **Recompletion (RC)**: starts at that moment on its own boards, and ends at
  rank 14 (8,192 DR). The player arrives with the rank 12, so RC's chase is
  6,144 DR. Everything on the board comes along.
- **Endless mode**: after rank 14, on play screens only. Same board, drops
  one rank lower, 1.5x per drop, 80% coins and merge energy (tool's own).
  Merge energy there is capped at 50 free taps per 100 DR so it can never pay
  for itself (tool's own).

### The generator and luck

- The generator sells items: 1 DR for a rank 1. Holding a rank 7 unlocks a
  x2 tier (2 DR for a rank 2), holding a rank 10 a x4 tier (4 DR for a
  rank 3). A tier locks again if the item that unlocked it is merged away.
- **Lucky drops**: a tap can give an item 1 or 2 ranks higher. One number per
  board list sets this: the EV, the average value a tap returns per DR
  (1 to 2.33, default 1.1). Lucky drops start once the x2 tier is unlocked.

### Boards and subsidy

- A board is a grid of tiles: **open**, **semi-blocked** (the item is visible
  and needs one merge into it to be freed) or **blocked** (the item is
  hidden).
- The items under the tiles are the **subsidy**: value the player gets
  without paying. The economist types each segment's **demand**. The DR typed
  on the boards is chase - demand (chase is 2,048 for the normal event, 6,144
  for RC).
- **Demand is the DR the average careful player really pays in the phase**
  **(economist)**. Players pay less than "chase - subsidy" suggests, because
  lucky drops return more value than a tap costs and merge energy pays for
  taps. So the build calibrates, in both directions: on top of the 80%
  merge-energy credit it takes subsidy off the later boards, or puts some
  back, until its simulated average player pays the demand (within 2%, 4% in
  RC). Board 1, rank limits, what a board's tiles can hold and pins are kept.
  The accounting is shown in separate steps: subsidy typed, energy credit,
  the signed calibration, what was generated. When the demand cannot be
  reached the build says which kind it is: a proven limit (the later boards
  have nothing left to give, or can hold no more), a spend that moves in
  jumps (two sets of boards with almost the same subsidy had the player pay
  on either side of the demand; seen in RC), or a search that ran out of
  passes.
- An event is a list of boards. Board 1 is the onboarding board: at most
  150 DR, small ascending items, a fixed opening. Every later board is a
  "wave" board of at most 3 rows that pushes in from the top once the board
  above is cleared. The last board's amount is never typed; it closes the
  gap.
- Each board's contents hit its DR exactly. Rank floors and ceilings per
  board are hard (for example Board 1 never above rank 8, Board 3 never
  ranks 1-2).
- RC boards: no item below rank 3, Board 1 holds 300 DR and is not an
  onboarding board **(economist)**. The generator holds the rank-3 floor
  itself, whatever lowest rank a board's saved data carries.

### Play rules (the same in the simulator and on the play screens)

- Merging does not depend on position. A free item can move to any empty
  open cell.
- A semi-blocked or just-revealed item is stuck: it can be merged into, but
  not moved, until it has been merged into once.
- A merge opens the locked tiles next to the cell it happens in.
- A board is cleared when no locked tile can still open and nothing on it is
  stuck, semi-blocked reward items included.
- "Reaching" a rank means holding a free item of it.

### Segments

There are 8 player segments.

- **Shared by all** (set on Segment 1): board layouts and count, rank limits,
  pinned ranks, milestone rewards, lucky-drop EV, dates, every reward rule
  and the one drop table.
- **Per segment**: demand (so subsidy), reward targets (a base amount times a
  segment factor), the rank values the build gives, and the Twister price.

## 3. Small rewards

### What they are

- Four resources with a target per segment: **coins** (expressed as a share
  of an allowance, so decimals), **puzzles**, **merge energy**, **charms**.
  A fifth, **Twister DR**, has no target; it pays for spins of a side wheel.
- Each resource is a chain of 4 reward ranks. Reward items sit on the board
  and merge like normal items. A rank 4 is collected at once. A lower rank
  can be tapped to collect it at that rank's smaller value.
- They reach the player two ways: **merge drops** (the larger part) and
  **under the tiles**.
- **Merge energy** pays for free x1 generator taps. Because that saves the
  player DR, 80% of the energy a segment collects is taken off the subsidy of
  its later boards (the "energy credit"). The credit is on energy collected,
  used or not: on test events about three quarters of it is used in the
  normal event and about four fifths in RC.

### Drop rules (economist, hard rules)

| The merge makes rank | Items dropped |
|---|---|
| below 5 | none |
| 5 | exactly one rank-1 Twister item, and nothing else (the other rewards start at rank 6; that start rank is never moved by the build) |
| 6 | exactly one |
| 7 | always two: its reward and the Twister item |
| 8-9 | exactly two |
| 10 and up | exactly three |

A dropped item is rank 3 at most, never a rank 4. The possible drops at a
rank are "containers" with weights out of 1,000; these are exactly the Ops
"Small Rewards Bank" and "Small Reward Weights" tables.

### Steady containers (tool's own design, on by default)

Every merge of a rank drops the same items; nothing about which reward drops
is left to chance.

- Rank 5: one rank-1 Twister item.
- Rank 6: always one rank-1 item of the reward that sits under the tiles.
- Rank 7: one reward and the Twister item, always.
- Ranks 8-9: one reward and the Twister item.
- Rank 10 and up: three rewards.

Which reward and what item size goes at which rank is solved so each reward
lands on its amount. The Twister item also has one size per merge rank.
Switching the option off (step 4) brings back the older containers, picked at
random by weight.

### Rank values

- The economist's typed values stay the definition.
- By default **the model gives the values, per segment, in round amounts**
  **(economist)**: whole numbers under 10, multiples of 5 up to 200, of 10
  up to 1,000; coins in hundredths.
- The values always reward merging: each rank is worth at least double the
  one below, so tapping an item early never pays more than merging it on.
- They are fitted last, on the segment's final boards, with 150 simulated
  players, so the average lands on the segment's amount.

### Under the tiles (economist)

One reward only (default coins). Board 1 holds none. Only Board 2 holds
items above rank 1. At most 4 reward items on a board before the last. At
most 40% of a reward comes from the tiles.

### Leftovers (economist)

When a phase's top rank is reached, what is still unmerged is merged as far
as it goes, then tapped and counted. This is what a player really ends with.

### Twister

The economist types the twists each segment should get. **The target is to
reach them when the player has paid 70-75% of the segment's DR demand**
**(economist)**, in steady, recurring chances to spin. Progress is paid
generator DR divided by the demand; free taps add nothing and it is not
clamped at 100%. A twist is bought whenever the balance affords one, several
from one collection, and the rest is kept.

After the boards and rewards are final, the build plays every segment and
gives it **its own four Twister values and its own price of a twist** so its
typical player lands in that window. Twister DR is its own currency, so only
the ratio of value to price matters; the build takes the simplest numbers
that fit (values not under 2/5/12/30, then the lowest price in the
economist's price steps). Typed Twister values are kept and only the price is
fitted. RC plays the normal event's values, so only its price is fitted and it
lands in the window less often.

Step 6 shows timing and cadence separately: when the twists are reached and
how far from the window, and how many chances to spin there are, how many
twists each pays for and the longest wait.

### Margins (economist)

A reward within 15% of its target counts as met; board DR within 5%. In RC
both are 25%. A reward amount never blocks a build.

## 4. The build

### What the economist enters (7 steps)

1. Segment amounts (demand, targets, factors).
2. Board layouts.
3. Generator and lucky drops.
4. Small rewards: targets, drop rules, reward under the tiles, Twister.
5. Effort distribution: at what share of the spend each rank should arrive.
6. Build.
7. Test and finalize.

### What the build does

1. **Boards.** For each segment, the subsidy is spread over the boards and
   each board's contents are generated. Of 24 generated layouts the build
   keeps the one whose playthrough is closest to the effort distribution
   from step 5.
2. **Drops.** The base segment is played to count merges per rank, and the
   one drop table is solved against that, under the drop rules. Every other
   segment uses the same table.
3. **Rank values.** Each segment gets its own round values, fitted so its
   average player lands on its amounts.
4. **Energy credit and demand.** The energy collected changes the subsidy,
   which changes the boards, which changes the energy and what the player
   pays. The build repeats up to 6 passes until the credit agrees (within
   0.5 DR or 1.5% of the demand, 5% in RC) and the average player pays the
   demand (within 2%, 4% in RC) (tool's own).
5. **Twister.** Each segment's values and price are fitted to the 70-75%
   window on the final boards.
6. **Recompletion.** The game has one reward table for both phases
   **(economist)**, so RC plays the normal event's drops and values. What an
   RC player gets therefore follows from the normal event and is only
   compared with its targets. RC's own: the reward under its tiles, and the
   two table rows only it reaches (the merges that make rank 13 and 14).

The result is a **draft**. Applying it writes it into the design. Exports and
play links use the applied design only. Status words on screen: Draft,
Applied, Out of date, Ready, Can be improved, Needs a fix, Not built.

## 5. The simulator

### How it plays

An automatic player on the built boards: it taps the generator at the
biggest unlocked tier (a smaller one when only that frees a tile), merges
whenever it can, uses merge energy as free taps, receives drops from the
table, and at the top rank merges and collects the leftovers. It reports DR
spent, each reward collected (by source and by phase), merges per rank, when
each rank was reached, Twister income over time, and boards reached.

### The players it knows

| Player | What they do | Used for |
|---|---|---|
| Careful merger | merges every reward item; opens semi-blocked items first; merges next to blocked tiles | every build is sized for this one |
| Merges without looking | merges free items together while a semi-blocked one waits | shown in step 7 |
| Taps when it pays | taps a reward item when no higher rank pays more per piece | shown in step 7 |
| Taps everything | never merges a reward | shown in step 7 |

### How it is checked

- A robot plays the real play screen's engine in the same ways. With steady
  containers, a careful robot collects exactly what the simulator says, for
  the same DR, in every test segment.
- Step 7 validates a build on 300 simulated players who each roll their own
  luck. It shows the average per reward, the range, how many players land
  within 15% of each amount, and how many are within 15% on every reward at
  once.

### Measured (single builds; a build has randomness in it)

| | Random containers | Steady containers |
|---|---|---|
| Players within 15% on every reward at once | 28 of 100 | 100 of 100 |
| Spread between players: puzzles / energy / charms | 17% / 32% / 15% | 0% |

What still differs between two careful players: DR spent (2-5%, generator
luck) and Twister income (4-6%). A player who merges without looking spent
35-50% more DR and collected 5-15% more in the segment with the most subsidy
on one build, and nothing more on others.

## 6. Outputs

- **Ops workbook / Google Sheet**, per segment or all segments, in the
  reference tab order. The normal event and RC are one event in it:
  Generator Weights to rank 14, one Blocked Queue (normal then RC), one Item
  Ladder of 14 tiers, one Small Rewards Bank and Weights table to tier 14.
  Rank values are per segment. An automated parser reads these, so headers
  and values follow the reference literally.
- **Play link**: a shared link that opens the event on a phone held sideways,
  with no editor reachable. Without RC it ends at rank 12. The link is
  letters and digits only.
- **Play Tester**: the economist's own play screen, any board, with a
  comparison to the simulator.

## 7. Known limits and open questions

Not yet confirmed by Ops or the game team (shown as "unverified" in the
tool):

- The production names for reward keys, and the Twister, Endless and extra
  reward tabs of the export.
- Whether coins are written as literal coins or as an allowance.
- Twister spin outcomes, widget length, and what crosses from the normal
  event into RC (Twister items on the board, an unspent balance). Measured
  three ways; it moves RC's timing by 2 to 5 points.

Limits of the model as it stands:

- RC amounts follow from the normal event and are not sized. On test builds
  they landed between 68% and 165% of their targets.
- Merge energy: the 80% credit is taken on energy collected. In the normal
  event about 16% of a phase's energy is collected only at the end and about
  a quarter is left unused, so the credit takes off more subsidy than the
  free taps give back. The two-way calibration now puts that back (small
  demands used to pay up to 22% over in the normal event). Whether the credit
  should follow the energy used is the economist's call.
- Small subsidies with a lucky generator: the boards have nothing left to
  take, and the player pays up to 33% under the demand. A proven limit,
  reported.
- RC spend moves in jumps from one set of boards to the next (the same
  subsidy gave 756 and 1,148 DR on two sets), so a segment there can end 7%
  to 25% from its demand on one build and inside the margin on the next.
- Twister timing: in the normal event 17 of 24 test segments land inside
  70-75% and all 24 within 5 points; in RC 9 of 24, because RC cannot have
  values of its own.
- Twister cadence in the segment with the most subsidy is still jumpy: 7 to
  10 chances to spin of 1.6 to 2.9 twists each.
- Bigger Twister items only in the drops of ranks 7 to 9 (rank 5 untouched)
  were measured: the same timing, more and smaller chances to spin in the
  normal event (17 chances of 1.1 twists against 15 of 1.4), no measured
  effect on the other rewards, mixed in RC. Not adopted; the economist's
  call.
- The build is sized for the careful player. Real players sit somewhere
  between that one and the one who merges without looking.
- Very small amounts (about 20) land within 25%, because round values move
  in big steps at that size.
- Taps are free on a play link, so a player who taps every reward item can
  play far past the DR a segment is meant to spend. Whether a link should
  stop at that DR is undecided.
- Pacing by push and stall is a design intent only; nothing is built.

## 8. Writing a prompt for the next round of work

The assistant doing the work has the whole project in front of it, including
a rules file (`CLAUDE.md`, the rules in force) and a history file
(`docs/history.md`, why each rule exists). A prompt does not need to restate
this overview. What it needs:

- **The goal in the economist's own words**, and what was seen that prompted
  it (a number, a screenshot, a friend's playthrough).
- **Any new or changed rule stated as a rule**, with its numbers, and whether
  it applies to the normal event, RC or both.
- **What must not change.**
- **How success will be judged**: a number to hit, or what should appear on
  screen.
- **Reference material**, if any (for example a sheet in the Ops format).
- **Whether to publish at the end.** Nothing is committed or deployed unless
  asked each time.

Where a request leaves a real design choice open, the assistant asks a short
question with options before building.
