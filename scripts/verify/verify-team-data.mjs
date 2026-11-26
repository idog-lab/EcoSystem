// TEAM DATA ON GITHUB (src/lib/teamData.js): two browsers - the economist and a coworker - sharing one data
// repository, against a stand-in for GitHub's API that behaves like it (a write with a stale or missing sha is
// refused, a bad token is refused, a file over the size limit comes by its blob).
//   npx vite-node scripts/verify/verify-team-data.mjs
import { createTeamData, SHARED_ITEMS, hashText } from '../../src/lib/teamData.js'
import { collectAllData } from '../../src/lib/browserData.js'
import { BIG, fakeGitHub } from './fakeGitHub.mjs'

let fails = 0
let total = 0
const check = (name, cond, extra = '') => {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}${!cond && extra ? `  [${extra}]` : ''}`)
}

function makeStorage(entries = {}) {
  const map = new Map(Object.entries(entries))
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map),
  }
}
// Timers the check runs by hand.
function makeTimers() {
  const queue = new Map()
  let id = 0
  return {
    setTimer: (f) => {
      const t = ++id
      queue.set(t, f)
      return t
    },
    clearTimer: (t) => queue.delete(t),
    flush: async () => {
      while (queue.size) {
        const [[t, f]] = queue
        queue.delete(t)
        await f()
      }
    },
  }
}
const browser = (gh, entries) => {
  const storage = makeStorage(entries)
  const timers = makeTimers()
  return { storage, timers, team: createTeamData({ fetchFn: gh.fetchFn, storage: () => storage, setTimer: timers.setTimer, clearTimer: timers.clearTimer }) }
}
const events = (s) => JSON.parse(s.getItem('merge-mania-saved-events') ?? '[]')
const ev = (id, name) => ({ id, name, startDate: '2026-12-01', days: 7, savedAt: 1 })

const gh = fakeGitHub()
const economy = JSON.stringify({ version: 6, resources: { coins: 1 }, currencies: [{ name: 'dr-pet', note: 'שלום 🐾' }] })
const A = browser(gh, {
  'superplay-economy': economy,
  'merge-mania-chef': JSON.stringify({ configs: [{ id: 'c1' }] }),
  'merge-mania-saved-events': JSON.stringify([ev('ev-1', 'Merge Mania 1-7 Dec 2026'), ev('ev-2', 'Black Friday')]),
  'merge-mania-saved-event:ev-1': 'DATA-ONE',
  'merge-mania-saved-event:ev-2': 'DATA-TWO',
  'merge-mania-board-simulator': '{"open project":"not shared"}',
})

console.log('--- 1. Connecting ---')
const bad = await createTeamData({ fetchFn: gh.fetchFn, storage: () => makeStorage() }).connect('wrong')
check(`a token GitHub refuses is not kept, and it says why (${bad.message})`, !bad.ok && /refused the token/.test(bad.message))
const a1 = await A.team.connect('token-a')
check(`the first browser connects: what it holds is sent to the data repository (${a1.sent.join(', ')})`, a1.ok && a1.user === 'idog-lab' && gh.files.has('economy/economy.json') && gh.files.has('chef/chefs.json') && gh.files.has('merge/saved-events/ev-1.json') && gh.files.has('merge/saved-events/ev-2.json'))
check('...the open Merge project and what is not shared stay in the browser', ![...gh.files.keys()].some((k) => k.includes('board-simulator')) && !gh.files.has('diamond-mine/state.json'))
check('...every write is a commit by who made it', gh.commits.length === 4 && gh.commits.every((c) => c.by === 'idog-lab' && /saved by idog-lab/.test(c.message)))
check('...a file reads as JSON, indented (the history reads)', JSON.parse(gh.files.get('economy/economy.json').text).currencies[0].name === 'dr-pet' && gh.files.get('economy/economy.json').text.includes('\n'))

const B = browser(gh, {})
const b1 = await B.team.connect('token-b')
check(`the coworker's empty browser connects and gets everything (${b1.taken.join(', ')})`, b1.ok && JSON.stringify(JSON.parse(B.storage.getItem('superplay-economy'))) === JSON.stringify(JSON.parse(economy)) && events(B.storage).map((e) => e.id).sort().join() === 'ev-1,ev-2' && B.storage.getItem('merge-mania-saved-event:ev-2') === 'DATA-TWO')
check('...text in any language comes across whole (Hebrew, an emoji)', JSON.parse(B.storage.getItem('superplay-economy')).currencies[0].note === 'שלום 🐾')
check('...a second sync with nothing changed sends nothing and takes nothing', (await B.team.sync()).sent.length === 0 && (await A.team.sync()).taken.length === 0)

console.log('--- 2. Changes go both ways ---')
A.storage.setItem('superplay-economy', JSON.stringify({ ...JSON.parse(economy), resources: { coins: 1, wild: 2.5 } }))
A.team.changed('superplay-economy')
await A.timers.flush()
check('a save here is sent after a short pause', JSON.parse(gh.files.get('economy/economy.json').text).resources.wild === 2.5)
const b2 = await B.team.sync()
check(`...and the coworker gets it when the app opens (${b2.taken.join(', ')})`, JSON.parse(B.storage.getItem('superplay-economy')).resources.wild === 2.5 && b2.taken.includes('Economy page'))
B.storage.setItem('merge-mania-saved-events', JSON.stringify(events(B.storage).map((e) => (e.id === 'ev-2' ? { ...e, name: 'Black Friday 2026' } : e))))
B.team.eventChanged('ev-2')
await B.timers.flush()
await A.team.sync()
check('a saved event renamed by the coworker is renamed here', events(A.storage).find((e) => e.id === 'ev-2').name === 'Black Friday 2026')
B.storage.setItem('merge-mania-saved-event:ev-3', 'DATA-THREE')
B.storage.setItem('merge-mania-saved-events', JSON.stringify([...events(B.storage), ev('ev-3', 'New event')]))
B.team.eventChanged('ev-3')
await B.timers.flush()
await A.team.sync()
check('a new saved event of the coworker arrives here', A.storage.getItem('merge-mania-saved-event:ev-3') === 'DATA-THREE' && events(A.storage).some((e) => e.id === 'ev-3'))
A.storage.removeItem('merge-mania-saved-event:ev-1')
A.storage.setItem('merge-mania-saved-events', JSON.stringify(events(A.storage).filter((e) => e.id !== 'ev-1')))
A.team.eventDeleted('ev-1')
await A.timers.flush()
const b3 = await B.team.sync()
check(`a saved event deleted here is deleted for the team (${b3.taken.join(', ')})`, !gh.files.has('merge/saved-events/ev-1.json') && B.storage.getItem('merge-mania-saved-event:ev-1') == null && !events(B.storage).some((e) => e.id === 'ev-1'))

console.log('--- 3. Two people changing the same thing ---')
const base = JSON.parse(A.storage.getItem('superplay-economy'))
A.storage.setItem('superplay-economy', JSON.stringify({ ...base, resources: { coins: 1, wild: 3 } }))
B.storage.setItem('superplay-economy', JSON.stringify({ ...base, resources: { coins: 1, wild: 4 } }))
A.team.changed('superplay-economy')
await A.timers.flush()
B.team.changed('superplay-economy')
await B.timers.flush()
const conflict = B.team.status().conflicts[0]
check(`the second save does not write over the first: the coworker is asked (${B.team.status().state}: ${conflict?.label})`, JSON.parse(gh.files.get('economy/economy.json').text).resources.wild === 3 && B.team.status().state === 'conflict' && conflict?.label === 'Economy page')
check('...and the coworker\'s own change is still in their browser until they choose', JSON.parse(B.storage.getItem('superplay-economy')).resources.wild === 4)
await B.team.resolve(conflict.path, 'theirs')
check('"the team\'s": their browser takes the file, nothing left to choose', JSON.parse(B.storage.getItem('superplay-economy')).resources.wild === 3 && B.team.status().conflicts.length === 0)
B.storage.setItem('superplay-economy', JSON.stringify({ ...base, resources: { coins: 1, wild: 5 } }))
A.storage.setItem('superplay-economy', JSON.stringify({ ...base, resources: { coins: 1, wild: 6 } }))
B.team.changed('superplay-economy')
await B.timers.flush()
A.team.changed('superplay-economy')
await A.timers.flush()
await A.team.resolve(A.team.status().conflicts[0].path, 'mine')
check('"mine": this browser\'s is written over the team\'s', JSON.parse(gh.files.get('economy/economy.json').text).resources.wild === 6 && A.team.status().conflicts.length === 0)
const before = gh.commits.length
await A.team.sync()
await B.team.sync()
check('...after which both browsers agree, with nothing more sent', JSON.parse(B.storage.getItem('superplay-economy')).resources.wild === 6 && gh.commits.length === before)

console.log('--- 4. Large files, no connection, leaving ---')
const big = JSON.stringify({ configs: Array.from({ length: 40 }, (_, i) => ({ id: `chef-${i}`, name: 'a chef with a long name' })) })
A.storage.setItem('merge-mania-chef', big)
A.team.changed('merge-mania-chef')
await A.timers.flush()
await B.team.sync()
check(`a file over GitHub's size for one read comes by its blob (${Buffer.byteLength(gh.files.get('chef/chefs.json').text)} bytes)`, Buffer.byteLength(gh.files.get('chef/chefs.json').text) > BIG && JSON.parse(B.storage.getItem('merge-mania-chef')).configs.length === 40)
gh.setDown(true)
A.storage.setItem('merge-mania-diamond-mine', '{"boards":[1]}')
A.team.changed('merge-mania-diamond-mine')
await A.timers.flush()
check(`GitHub not reachable: said, and the work stays in the browser (${A.team.status().message})`, A.team.status().state === 'error' && /could not be reached/.test(A.team.status().message) && A.storage.getItem('merge-mania-diamond-mine') === '{"boards":[1]}')
gh.setDown(false)
const a5 = await A.team.sync()
check(`...and it goes to the team at the next sync (${a5.sent.join(', ')})`, gh.files.has('diamond-mine/state.json') && a5.sent.includes('Diamond Mine'))
check('the token is never in "Download all my data"', !Object.keys(collectAllData(A.storage).items).some((k) => /token|ecotk/.test(k)) && Object.keys(collectAllData(A.storage).items).includes('superplay-economy'))
A.team.disconnect()
A.storage.setItem('superplay-economy', JSON.stringify({ ...base, resources: { coins: 9 } }))
A.team.changed('superplay-economy')
await A.timers.flush()
check('disconnected: nothing is sent, and the browser keeps working on its own', !A.team.isConnected() && JSON.parse(gh.files.get('economy/economy.json').text).resources.wild === 6 && A.team.status().state === 'off')
check('every shared item has its own file', new Set(SHARED_ITEMS.map((i) => i.path)).size === SHARED_ITEMS.length && hashText('a') !== hashText('b'))

console.log(fails ? `TEAM DATA: ${fails} OF ${total} CHECKS FAILED` : `TEAM DATA: ALL ${total} CHECKS PASSED`)
process.exit(fails ? 1 : 0)
