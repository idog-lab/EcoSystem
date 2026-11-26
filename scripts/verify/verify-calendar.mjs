// THE CALENDAR (src/lib/economy/economyModel.js): which mini game is live by period, a preset's worth as its amount x
// its DR's value on the date, and a feature's worth averaged over its days.
//   npx vite-node scripts/verify/verify-calendar.mjs
import { createCurrency, createEconomy, featureDays, liveMiniGame, normalizeCalendar, normalizeEconomy, presetValue } from '../../src/lib/economy/economyModel.js'
import { prizeAgainstWorth } from '../../src/lib/economy/prizeWorth.js'

let fails = 0
let total = 0
const check = (name, cond, extra = '') => {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}${!cond && extra ? `  [${extra}]` : ''}`)
}
const near = (a, b) => a != null && Math.abs(a - b) < 1e-9

const economy = createEconomy({
  currencies: [
    createCurrency({ name: 'dr-puzzle', periods: [{ from: '2026-12-01', to: '2026-12-01', value: 0.04 }, { from: '2026-12-02', to: '2026-12-02', value: 0.06 }] }),
    createCurrency({ name: 'dr-pet', periods: [{ from: '2026-11-30', to: '2026-12-06', value: 0.1 }] }),
    createCurrency({ name: 'dr-merge', valueGameplay: 0.3 }),
    createCurrency({ name: 'dr-pickaxe', valueGameplay: 0.5 }),
  ],
  calendar: { miniGames: [{ from: '2026-12-01', to: '2026-12-03', game: 'diamond-mine' }, { from: '2026-12-04', to: '2026-12-10', game: 'merge' }] },
})

// The calendar.
check('which mini game is live by day: Diamond Mine 1-3 Dec, Merge 4-10 Dec, none after', liveMiniGame(economy, '2026-12-02') === 'diamond-mine' && liveMiniGame(economy, '2026-12-04') === 'merge' && liveMiniGame(economy, '2026-12-11') === null && liveMiniGame(economy, null) === null)
check('a period that is not one is dropped (a date not real, the wrong way round, an unknown game)', normalizeCalendar({ miniGames: [{ from: '2026-12-05', to: '2026-12-01', game: 'merge' }, { from: '2026-02-30', to: '2026-03-01', game: 'merge' }, { from: '2026-12-01', to: '2026-12-02', game: 'chef' }] }).miniGames.length === 0)
check('kept through storage', JSON.stringify(normalizeEconomy(JSON.parse(JSON.stringify(economy))).calendar) === JSON.stringify(economy.calendar))
check('a feature\'s days', featureDays('2026-12-31', 2).join() === '2026-12-31,2027-01-01' && featureDays('', 2).length === 0)

// A preset's worth: its amount x its DR's value on the date.
check(`puzzle_gameplay_20 on 1 Dec: 20 x 0.04 = 0.8 (${presetValue(economy, 'puzzle_gameplay_20', { date: '2026-12-01' })?.value})`, near(presetValue(economy, 'puzzle_gameplay_20', { date: '2026-12-01' })?.value, 0.8))
check('the fallback ending does not change it: puzzle_gameplay_20_undo is 0.8 too', near(presetValue(economy, 'puzzle_gameplay_20_undo', { date: '2026-12-01' })?.value, 0.8))
check('a pet preset: mf_25_gameplay_wild = 25 x 0.1 that week', near(presetValue(economy, 'mf_25_gameplay_wild', { date: '2026-12-03' })?.value, 2.5) && near(presetValue(economy, 'mf_25_gameplay_wild_cross', { date: '2026-12-03' })?.value, 2.5))
check('a mini game preset: the live one by the calendar - Diamond Mine 2 Dec: 5 x 0.5; Merge 5 Dec: 5 x 0.3', near(presetValue(economy, 'mini_game_5_gameplay_allowance', { date: '2026-12-02' })?.value, 2.5) && near(presetValue(economy, 'mini_game_5_gameplay_allowance', { date: '2026-12-05' })?.value, 1.5))
const notSaid = presetValue(economy, 'mini_game_5_gameplay_allowance', { date: '2026-12-20' })
check(`the calendar not saying: the feature's own pick, else not known (${notSaid?.why})`, notSaid?.value == null && /which mini game is live/.test(notSaid.why) && near(presetValue(economy, 'mini_game_5_gameplay_allowance', { date: '2026-12-20', miniGame: 'merge' })?.value, 1.5))
const noValue = presetValue(economy, 'puzzle_gameplay_20', { date: '2026-12-25' })
check(`a date with no puzzle value: not known, and why (${noValue?.why})`, noValue?.value == null && /dr-puzzle has no value on 2026-12-25/.test(noValue.why))

// A feature over its days: the average.
const two = prizeAgainstWorth('preset:puzzle_gameplay_20', 1, economy, { date: '2026-12-01', days: 2 })
check(`over two days the puzzle changes 0.04 -> 0.06: the worth is the average, 1 (${two?.worth})`, near(two?.worth, 1) && two.gap === 0)
const oneDay = prizeAgainstWorth('preset:puzzle_gameplay_20', 1, economy, { date: '2026-12-01', days: 1 })
check('on its first day alone, 0.8', near(oneDay?.worth, 0.8))
const gap = prizeAgainstWorth('preset:puzzle_gameplay_20', 1, economy, { date: '2026-12-02', days: 2 })
check('a day of the feature with no value makes the worth not known', gap?.worth === null)

console.log(`\nCALENDAR: ${total - fails} of ${total} checks passed`)
process.exit(fails ? 1 : 0)
