// THE PRIZES LADDER (src/features/merge/lib/build/prizeLadder.js): a marked rank is worth the DR paid since the marked
// rank before it times the worth of one merge DR; another segment's worth and prize are the base's times its
// multiplier against the base unless it has its own; nothing typed leaves the boards (and so the Item Ladder) as
// they were.   npx vite-node scripts/verify/verify-prize-ladder.mjs
import { rankWorths, scaleReward, segmentLadder, segmentMultiplier, withLadder, laddersOfEvent, ladderRanks, milestoneTexts, prizeAgainstWorth } from '../../src/features/merge/lib/build/prizeLadder.js'
import { normalizeEconomy } from '../../src/lib/economy/economyModel.js'

let fails = 0
let total = 0
const check = (name, cond, extra = '') => {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}${!cond && extra ? `  [${extra}]` : ''}`)
}

// Worth of a rank: DR since the marked rank before.
const reached = { 1: 0, 6: 4, 8: 10, 10: 46, 11: 120, 12: 798, 13: 1300, 14: 2400 }
const w = rankWorths(reached, [12, 8, 10, 14], 0.05)
check('ranks come out in order', w.map((r) => r.rank).join() === '8,10,12,14')
check('the first marked rank counts from the start', w[0].since === null && w[0].dr === 10 && w[0].worth === 0.5)
check('each later rank counts from the marked rank before it, not from the rank just below', w[1].since === 8 && w[1].dr === 36 && w[2].since === 10 && w[2].dr === 752)
check('a Recompletion rank carries on from the normal event', w[3].since === 12 && w[3].dr === 1602 && w[3].worth === 80.1)
check('no worth of a merge DR: the DR is there, the worth is not', rankWorths(reached, [8], null)[0].dr === 10 && rankWorths(reached, [8], null)[0].worth === null)
const gap = rankWorths({ 8: 10, 12: 800 }, [8, 10, 12], 1)
check('a rank never reached has no worth, and the next counts from the last one reached', gap[1].dr === null && gap[2].since === 8 && gap[2].dr === 790)

// Multipliers and scaling.
check('Segment 1 is x1 whatever is typed; another segment its reward size', segmentMultiplier({ segmentFactor: 3 }, 0) === 1 && segmentMultiplier({ segmentFactor: 1.5 }, 2) === 1.5 && segmentMultiplier({}, 2) === 1)
check('coins scale to hundredths', scaleReward('allowance(coins:5)', 1.5) === 'allowance(coins:7.5)' && scaleReward('allowance(coins:0.33)', 0.5) === 'allowance(coins:0.17)')
const scaled = scaleReward('[dynamic(dr-puzzle:10)] + chest:wooden(allowance(coins:2))', 1.5)
check(`a currency amount scales to a whole number, the chest's name stays (${scaled})`, /dr-puzzle:15/.test(scaled) && /chest:wooden/.test(scaled) && /coins:3\b/.test(scaled))
check('a whole amount never goes under 1', /dr-puzzle:1\b/.test(scaleReward('[dynamic(dr-puzzle:1)]', 0.2)))
check('x1 and an unreadable text come back as they are', scaleReward('allowance(coins:5)', 1) === 'allowance(coins:5)' && scaleReward('not a reward ((', 2) === 'not a reward ((')

// Each segment's ladder.
const segs = [
  { segmentFactor: 1, prizeLadder: { main: { 10: 'allowance(coins:5)', 12: 'allowance(coins:50)' }, rc: { 14: 'allowance(coins:100)' } } },
  { segmentFactor: 2, prizeLadder: { main: { 12: 'allowance(coins:60)' }, rc: {} } },
  { segmentFactor: 0.5, prizeLadder: { main: {}, rc: {} } },
]
const l1 = segmentLadder(segs, 1, 0, [10, 12, 14])
check('another segment: the base scaled where it has none of its own, its own where typed', l1[10].text === 'allowance(coins:10)' && !l1[10].own && l1[12].text === 'allowance(coins:60)' && l1[12].own && l1[14].text === 'allowance(coins:200)')
const l0on2 = segmentLadder(segs, 0, 2, [10, 12, 14])
check('with Segment 3 (x0.5) as the base, Segment 1 is x2 of it, and has its own prizes', l0on2[12].own && l0on2[12].text === 'allowance(coins:50)')
const l1on2 = segmentLadder(segs, 1, 2, [10])
check('a base with no prize gives nothing to scale', Object.keys(l1on2).length === 0)

// On the boards.
const board = (extra = {}) => ({ rewardRanks: [10, 12], rewardSyntax: { 10: 'allowance(coins:1)' }, ...extra })
const mainBoards = [board(), { rewardRanks: [], rewardSyntax: {} }]
const rcBoards = [{ rewardRanks: [14], rewardSyntax: { 14: 'allowance(coins:9)' } }]
check('nothing typed: the very same boards come back', withLadder(mainBoards, {}, 'main') === mainBoards)
const put = withLadder(mainBoards, l1, 'main')
check('a ladder goes on the first board only, its phase\'s ranks only', put[0].rewardSyntax[10] === 'allowance(coins:10)' && put[0].rewardSyntax[12] === 'allowance(coins:60)' && put[0].rewardSyntax[14] === undefined && put[1] === mainBoards[1])
check('the marked ranks: normal 1-12 and Recompletion 13-14', ladderRanks(mainBoards, rcBoards).join() === '10,12,14')
check('the milestone texts of step 3, for "Start from them"', JSON.stringify(milestoneTexts(mainBoards, rcBoards)) === JSON.stringify({ 10: 'allowance(coins:1)', 14: 'allowance(coins:9)' }))
const event = [
  { main: { boards: mainBoards }, recompletion: { boards: rcBoards }, segmentFactor: 1, prizeLadder: { main: {}, rc: {} } },
  { main: { boards: mainBoards }, recompletion: { boards: rcBoards }, segmentFactor: 2, prizeLadder: { main: {}, rc: {} } },
]
const untouched = laddersOfEvent(event, 0, (s) => s.main.boards, (s) => s.recompletion.boards)
check('an event with no prize typed exports exactly what it did before', untouched.every((x) => x.main === mainBoards && x.rc === rcBoards))
event[0].prizeLadder = { main: { 12: 'allowance(coins:50)' }, rc: { 14: 'allowance(coins:100)' } }
const typed = laddersOfEvent(event, 0, (s) => s.main.boards, (s) => s.recompletion.boards)
check('typed on the base: each segment\'s Item Ladder gets its prize', typed[0].main[0].rewardSyntax[12] === 'allowance(coins:50)' && typed[1].main[0].rewardSyntax[12] === 'allowance(coins:100)' && typed[1].rc[0].rewardSyntax[14] === 'allowance(coins:200)')
check('a rank with no prize keeps its milestone text', typed[1].main[0].rewardSyntax[10] === 'allowance(coins:1)')

// How far a prize is.
const economy = normalizeEconomy({})
const a = prizeAgainstWorth('allowance(coins:50)', 40, economy)
check(`a prize's worth and difference (${a.worth}, ${a.gap}, ${a.gapPct}%)`, a.worth === 50 && a.gap === 10 && a.gapPct === 25)
check('an empty prize gives nothing', prizeAgainstWorth('  ', 40, economy) === null)
const bad = prizeAgainstWorth('[dynamic(dr-nothing-like-this:5)]', 40, economy)
check('an unknown currency is an error from the checker', bad && !bad.ok && bad.issues.some((i) => i.level === 'error'))

console.log(`\nPRIZE LADDER: ${total - fails} of ${total} checks passed`)
process.exit(fails ? 1 : 0)
