// ALL MY DATA (src/lib/browserData.js): everything the app keeps in a browser,
// as one file, and back - on two made-up browsers, the old site and the new.
//   npx vite-node scripts/verify/verify-browser-data.mjs
import { collectAllData, planRestore, readDataFile, restoreAllData, DATA_FILE_KIND } from '../../src/lib/browserData.js'

let fails = 0
let total = 0
const check = (name, cond) => {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}`)
}

// A browser's storage, the way localStorage reads and writes. `room`: how many characters it holds.
function makeStorage(entries = {}, room = Infinity) {
  const map = new Map(Object.entries(entries))
  const used = () => [...map].reduce((s, [k, v]) => s + k.length + v.length, 0)
  return {
    get length() { return map.size },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      const before = map.get(k)
      map.set(k, String(v))
      if (used() > room) {
        if (before == null) map.delete(k)
        else map.set(k, before)
        const e = new Error('full')
        e.name = 'QuotaExceededError'
        throw e
      }
    },
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map),
  }
}
const index = (...events) => JSON.stringify(events)
const ev = (id, name) => ({ id, name, startDate: '2026-11-19', days: 7, savedAt: 1 })

const oldSite = makeStorage({
  'merge-mania-saved-events': index(ev('ev-a', 'Merge Mania 19-25 Nov 2026'), ev('ev-b', 'Black Friday')),
  'merge-mania-saved-event:ev-a': 'DATA-A',
  'merge-mania-saved-event:ev-b': 'DATA-B',
  'merge-mania-board-simulator': '{"segments":["old project"]}',
  'merge-mania-build-drafts': '{"drafts":"old"}',
  'merge-mania-chef': '{"chefs":["old chef"]}',
  'superplay-economy': '{"worth":"old"}',
  'merge-mania-diamond-mine': '{"gems":1}',
  'another-site-on-github-io': 'not ours',
})
const file = collectAllData(oldSite, 'https://idoggk.github.io/Merge/')
const text = JSON.stringify(file)
check(`the file holds every key of the app and nothing of another site on the same address (${Object.keys(file.items).length} keys)`, file.kind === DATA_FILE_KIND && Object.keys(file.items).length === 8 && !('another-site-on-github-io' in file.items) && file.items['merge-mania-saved-event:ev-b'] === 'DATA-B')
check('a file that is not one is refused, and says why', !readDataFile('not json').ok && !readDataFile('{"segments":[]}').ok && /Import backup/.test(readDataFile('{"segments":[]}').message))
const read = readDataFile(text)
check('the file is read back as it was written', read.ok && JSON.stringify(read.data.items) === JSON.stringify(file.items))

// 1. A new site with nothing yet: everything comes in.
const empty = makeStorage()
const plan1 = planRestore(read.data, empty)
check('an empty browser: both saved events are to be added, every part to be added', plan1.events.toAdd.length === 2 && plan1.parts.filter((p) => p.state === 'add').map((p) => p.id).join() === 'merge-project,chef,economy,diamond-mine')
const r1 = restoreAllData(read.data, {}, empty)
const sorted = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))))
check('...and after the restore the new site holds exactly what the old one did', r1.ok && r1.eventsAdded === 2 && sorted(empty.dump()) === sorted(file.items))
check('restoring the same file again does nothing at all', planRestore(read.data, empty).events.toAdd.length === 0 && planRestore(read.data, empty).parts.every((p) => p.state === 'same' || p.state === 'none'))

// 2. A new site that already has its own: saved events added, nothing replaced unless asked.
const busy = makeStorage({
  'merge-mania-saved-events': index(ev('ev-new', 'Made on the new site'), ev('ev-a', 'Merge Mania 19-25 Nov 2026')),
  'merge-mania-saved-event:ev-new': 'DATA-NEW',
  'merge-mania-saved-event:ev-a': 'DATA-A-EDITED-HERE',
  'merge-mania-board-simulator': '{"segments":["new project"]}',
  'merge-mania-effort-target': '{"main":{}}',
  'superplay-economy': '{"worth":"old"}',
})
const plan2 = planRestore(read.data, busy)
const state = (id) => plan2.parts.find((p) => p.id === id).state
check(`a browser with its own: one saved event to add, one already here (${plan2.events.toAdd.map((e) => e.id)}; ${plan2.events.alreadyHere} here)`, plan2.events.toAdd.length === 1 && plan2.events.toAdd[0].id === 'ev-b' && plan2.events.alreadyHere === 1)
check('...the open project differs, the economy is the same, Chef and Diamond Mine are to be added', state('merge-project') === 'differs' && state('economy') === 'same' && state('chef') === 'add' && state('diamond-mine') === 'add')
const r2 = restoreAllData(read.data, {}, busy)
const after2 = busy.dump()
const list2 = JSON.parse(after2['merge-mania-saved-events'])
check('...restored without asking to replace: the list holds all three events, the one here untouched, the open project untouched', r2.ok && list2.map((e) => e.id).join() === 'ev-new,ev-a,ev-b' && after2['merge-mania-saved-event:ev-a'] === 'DATA-A-EDITED-HERE' && after2['merge-mania-saved-event:ev-b'] === 'DATA-B' && after2['merge-mania-board-simulator'] === '{"segments":["new project"]}' && after2['merge-mania-chef'] === '{"chefs":["old chef"]}')
const busy3 = makeStorage({
  'merge-mania-board-simulator': '{"segments":["new project"]}',
  'merge-mania-effort-target': '{"main":{}}',
})
const r3 = restoreAllData(read.data, { replace: ['merge-project'] }, busy3)
const after3 = busy3.dump()
check('asked to replace the open project: it is the file\'s whole - its builds come with it, and an effort shape the file does not have goes', r3.ok && after3['merge-mania-board-simulator'] === '{"segments":["old project"]}' && after3['merge-mania-build-drafts'] === '{"drafts":"old"}' && !('merge-mania-effort-target' in after3))

// 3. A browser without room: nothing changes.
const small = makeStorage({ 'merge-mania-board-simulator': 'HERE' }, 120)
const r4 = restoreAllData(read.data, {}, small)
check(`a browser without room: refused, and nothing is changed (${r4.reason})`, !r4.ok && r4.reason === 'full' && JSON.stringify(small.dump()) === JSON.stringify({ 'merge-mania-board-simulator': 'HERE' }))

console.log(fails ? `${fails} of ${total} checks FAILED` : `${total}/${total} checks passed`)
process.exit(fails ? 1 : 0)
