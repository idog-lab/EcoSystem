// A CHEF BASKET'S WORTH, DAY BY DAY, PLAYED ON THE ENGINE (chefBasketWorth.js).
//   npx vite-node scripts/verify/verify-chef-worth.mjs
import { oneMoreBasket } from '../../src/features/chef/lib/chefEngine.js'
import { basketWorthByDay, typesOpenedBy } from '../../src/features/chef/lib/chefBasketWorth.js'
import { syntheticExampleState } from '../../src/features/chef/data/syntheticExample.js'
import { createSupply } from '../../src/features/chef/lib/chefModel.js'

let fails = 0
let total = 0
const check = (name, cond) => {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}`)
}
const quiet = { tick: () => Promise.resolve() }
const state = syntheticExampleState()
const segment = state.segments[0]
const before = JSON.stringify(state)
const W = await basketWorthByDay(state, segment, { players: 200, seed: 7 }, quiet)
const types = typesOpenedBy(state, segment)
console.log(`      ${segment.name}: ${types.join(', ')}; over the event ${types.map((t) => `${t} ${W.byType[t].mean.toFixed(3)}`).join(', ')}`)
check(`every day and every basket type the segment opens is played (${W.rows.length} = ${state.calendar.totalDays} days x ${types.length} types)`, W.rows.length === state.calendar.totalDays * types.length && W.types.join() === types.join())
const sample = W.rows.find((r) => r.day === 5 && r.chestType === types[0])
const direct = oneMoreBasket(state, segment, { chestType: sample.chestType, day: 5, players: 200, seed: 7, variation: 'activity' })
check(`a day's worth is exactly "one more basket" on the same players (${sample.worth.toFixed(4)} = ${direct.payoutDelta.toFixed(4)})`, Math.abs(sample.worth - direct.payoutDelta) < 1e-9)
check('each worth comes with how far it would move with other players, and the share of players it changes', W.rows.every((r) => r.spread >= 0 && r.changedShare >= 0 && r.changedShare <= 1))
const again = await basketWorthByDay(state, segment, { players: 200, seed: 7 }, quiet)
check('the same players give the same worths', JSON.stringify(again.rows) === JSON.stringify(W.rows))
const wide = state.segments.find((s) => typesOpenedBy(state, s).length === 3)
const W3 = wide ? await basketWorthByDay(state, wide, { players: 200, seed: 7 }, quiet) : null
check(`over the event, a bigger basket is worth more: Basic < Rare < Epic (${wide?.name}: ${W3 ? ['basic', 'rare', 'epic'].map((t) => W3.byType[t].mean.toFixed(3)).join(' < ') : 'no segment opens all three'})`, !!W3 && W3.byType.basic.mean < W3.byType.rare.mean && W3.byType.rare.mean < W3.byType.epic.mean)
const noEpic = { ...state, segments: [{ ...segment, supply: createSupply({ average: { basic: 3, rare: 1, epic: 0 } }) }] }
check('a basket the segment never opens is not played', !typesOpenedBy(noEpic, noEpic.segments[0]).includes('epic'))
check('playing it changes nothing in the chef', JSON.stringify(state) === before)
const stopped = await basketWorthByDay(state, segment, { players: 100 }, { ...quiet, isCancelled: () => true })
check('stopped: nothing comes back', stopped === null)
console.log(fails ? `${fails} of ${total} checks FAILED` : `${total}/${total} checks passed`)
process.exit(fails ? 1 : 0)
