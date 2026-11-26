// SEGMENT SETS (src/lib/economy/segmentSets.js): the flow saved as a set, its efforts in Brut Wins, the same set taken by
// any feature with the feature's own names, a save of the same name keeping the efforts by segment.
//   npx vite-node scripts/verify/verify-segment-sets.mjs
import { createPlan } from '../../src/lib/economy/segmentFlow.js'
import { editSet, modeGroups, normalizeSets, saveFlowAsSet, setEffort, setEffortFollow, setEfforts, setForFeature, setModeFactor, setPlaceholder, setSegmentId } from '../../src/lib/economy/segmentSets.js'

let fails = 0
let total = 0
const check = (name, cond, extra = '') => {
  total += 1
  if (!cond) fails += 1
  console.log(`${cond ? '  OK' : 'FAIL'}  ${name}${!cond && extra ? `  [${extra}]` : ''}`)
}

const plan = { ...createPlan(), feature: 'Disco', cuts: '1000, 2500' }
check('a segment is kept by its name without the feature', setSegmentId('Disco_BW_0_1000', plan) === 'BW_0_1000' && setSegmentId('Other_X', plan) === 'Other_X')

const t1 = '2026-11-26T10:00:00.000Z'
check('a set needs a name - typed, or the feature typed in the flow', !!saveFlowAsSet([], { ...plan, feature: '' }, '  ').error && saveFlowAsSet([], plan, '  ').set?.name === 'Disco')
const first = saveFlowAsSet([], plan, 'Level features, 2 days', t1)
check(`the flow saved as a set: three bands, no effort yet (${first.set?.segments.map((s) => s.id).join(', ')})`, first.created && first.set.segments.length === 3 && first.set.segments.every((s) => s.effort === null) && first.set.updatedAt === t1)
let sets = setEffort(first.sets, first.set.id, 'BW_0_1000', 40, '2026-11-26T11:00:00.000Z')
sets = setEffort(sets, first.set.id, 'BW_1000_2500', '90', '2026-11-26T11:00:00.000Z')
check('an effort typed is kept, and the set gets a new time', sets[0].segments[0].effort === 40 && sets[0].segments[1].effort === 90 && sets[0].updatedAt !== t1)
check('an effort cleared or not a number is "not given"', setEffort(sets, first.set.id, 'BW_0_1000', '', t1)[0].segments[0].effort === null && setEffort(sets, first.set.id, 'BW_0_1000', -3, t1)[0].segments[0].effort === null)

const merge = setForFeature(sets[0], 'Merge')
check(`picked by Merge: Merge's names, the same conditions, the efforts (${merge.segments.map((s) => `${s.name}=${s.effort}`).join(', ')})`, merge.segments[0].name === 'Merge_BW_0_1000' && merge.segments[0].effort === 40 && merge.segments[1].effort === 90 && merge.segments[2].effort === null && merge.plan.feature === 'Merge' && merge.segments[0].condition === sets[0].segments[0].condition)

// Saved again with a mode split on the first band: the efforts of the segments it had are kept.
const wider = { ...plan, cuts: '1000, 2500, 5000' }
const again = saveFlowAsSet(sets, wider, 'level features, 2 DAYS', '2026-11-27T09:00:00.000Z')
check('the same name (any case) updates the set, it does not add one', !again.created && again.sets.length === 1 && again.set.id === first.set.id && again.set.name === 'level features, 2 DAYS')
check('its efforts are kept by segment, the new band has none', again.set.segments.length === 4 && again.set.segments[0].effort === 40 && again.set.segments[1].effort === 90 && again.set.segments.find((s) => s.id === 'BW_2500_5000')?.effort === null)
const two = saveFlowAsSet(again.sets, plan, 'Weekend features')
check('another name is another set', two.created && two.sets.length === 2)
check('a flow with something to fix is not saved', !!saveFlowAsSet([], { ...plan, cuts: '1000, abc' }, 'X').error)
check('rename through editSet', editSet(two.sets, first.set.id, () => ({ name: 'Renamed' }))[0].name === 'Renamed')

const generic = saveFlowAsSet([], { ...plan, feature: '2D_Levels' }, '')
check(`no name typed: the set is named after its placeholder, the feature typed (${generic.set?.name})`, generic.set?.name === '2D_Levels' && setPlaceholder(generic.set) === '2D_Levels' && generic.set.segments[0].id === 'BW_0_1000')
check('the placeholder changes with the feature that takes the set', setForFeature(generic.set, 'Disco').segments[0].name === 'Disco_BW_0_1000' && setForFeature(generic.set, 'Merge').segments[0].name === 'Merge_BW_0_1000')
// Generic segments: no feature typed, the set's name stands in for it.
const noFeature = { ...plan, feature: '' }
const gen = saveFlowAsSet([], noFeature, '2D_Levels')
check(`no feature typed: generic segments, the set's name the placeholder (${gen.set?.segments.map((s) => s.id).slice(0, 2).join(', ')})`, gen.created && setPlaceholder(gen.set) === '2D_Levels' && gen.set.segments[0].id === 'BW_0_1000' && gen.set.segments.length === 3)
check('a generic set is taken by any feature with its own name', setForFeature(gen.set, 'Disco').segments[0].name === 'Disco_BW_0_1000' && setForFeature(gen.set, 'Merge').segments[2].name === 'Merge_BW_2500_Plus')
check('a set name with spaces and signs makes a clean placeholder', setPlaceholder(saveFlowAsSet([], noFeature, 'Level features, 2 days').set) === 'Level_features_2_days')
check('a generic set needs a name, one with letters or digits', !!saveFlowAsSet([], noFeature, '').error && !!saveFlowAsSet([], noFeature, ' ,, ').error)
const genAgain = saveFlowAsSet(setEffort(gen.sets, gen.set.id, 'BW_0_1000', 12), noFeature, '2D_Levels')
check('saved again under its name: the same set, its efforts kept', !genAgain.created && genAgain.sets.length === 1 && genAgain.set.segments[0].effort === 12)

// Efforts that follow: a mode split's higher mode = the lower's x a factor (economist: "where we see a mode split i want
// to have a factor on the effort between those ones").
const modes = saveFlowAsSet([], { ...plan, feature: '2D_Levels', splits: [{ id: 'm', values: '3', segments: [0, 1] }] }, '').set
const ids = modes.segments.map((s) => s.id)
check(`a set with mode splits finds them (${modeGroups(modes).map((g) => g.join(' / ')).join(' | ')})`, modeGroups(modes).length === 2 && modeGroups(modes)[0].length === 2 && ids.includes('BW_0_1000_Mode_3_plus'))
let ms = setEffort([modes], modes.id, 'BW_0_1000_Mode_0_3', 40)
ms = setEffort(ms, modes.id, 'BW_1000_2500_Mode_0_3', 100)
ms = setModeFactor(ms, modes.id, 1.5)
let v = setEfforts(ms[0])
check(`"Apply" on the mode splits: each higher mode = the lower x 1.5 (${v.BW_0_1000_Mode_3_plus.value}, ${v.BW_1000_2500_Mode_3_plus.value})`, v.BW_0_1000_Mode_3_plus.value === 60 && v.BW_1000_2500_Mode_3_plus.value === 150 && v.BW_0_1000_Mode_0_3.value === 40)
ms = setEffort(ms, modes.id, 'BW_0_1000_Mode_0_3', 50)
check('the follower follows: 50 x 1.5 = 75', setEfforts(ms[0]).BW_0_1000_Mode_3_plus.value === 75)
ms = setEffortFollow(ms, modes.id, 'BW_2500_Plus', 'BW_1000_2500_Mode_3_plus', 2)
check('a chain: x a segment that itself follows (150 x 2 = 300)', setEfforts(ms[0]).BW_2500_Plus.value === 300)
const loop = setEffortFollow(setEffortFollow(ms, modes.id, 'BW_0_1000_Mode_0_3', 'BW_0_1000_Mode_3_plus', 1), modes.id, 'BW_0_1000_Mode_3_plus', 'BW_0_1000_Mode_0_3', 1)
check('two segments following each other: no effort, and why', setEfforts(loop[0]).BW_0_1000_Mode_0_3.value === null && /follows it back/.test(setEfforts(loop[0]).BW_0_1000_Mode_0_3.problem))
const typedAgain = setEffortFollow(ms, modes.id, 'BW_0_1000_Mode_3_plus', null)
check('typed again: it keeps the effort it had (75)', setEfforts(typedAgain[0]).BW_0_1000_Mode_3_plus.value === 75 && typedAgain[0].segments.find((s) => s.id === 'BW_0_1000_Mode_3_plus').effortOf === null)
const taken = setForFeature(ms[0], 'Wicked_Trails')
const tk = Object.fromEntries(taken.segments.map((s) => [s.name, s]))
check(`a feature takes the efforts worked out, and the link by its own keys (${tk.Wicked_Trails_BW_0_1000_Mode_3_plus.effort}, x ${tk.Wicked_Trails_BW_0_1000_Mode_3_plus.effortFactor} of ${tk.Wicked_Trails_BW_0_1000_Mode_3_plus.effortOf})`, tk.Wicked_Trails_BW_0_1000_Mode_3_plus.effort === 75 && tk.Wicked_Trails_BW_0_1000_Mode_3_plus.effortOf === tk.Wicked_Trails_BW_0_1000_Mode_0_3.key && tk.Wicked_Trails_BW_0_1000_Mode_3_plus.effortFactor === 1.5 && tk.Wicked_Trails_BW_0_1000_Mode_0_3.effortOf === null)
const resaved = saveFlowAsSet(ms, ms[0].plan, ms[0].name)
check('saved again from the flow: the links are kept', resaved.set.segments.find((s) => s.id === 'BW_0_1000_Mode_3_plus').effortOf === 'BW_0_1000_Mode_0_3' && setEfforts(resaved.set).BW_0_1000_Mode_3_plus.value === 75)
check('kept through storage', JSON.stringify(normalizeSets({ sets: ms })[0].segments) === JSON.stringify(ms[0].segments))
v = null

const read = normalizeSets(JSON.parse(JSON.stringify({ sets: two.sets })))
check('a stored list reads back the same', JSON.stringify(read) === JSON.stringify(two.sets))
check('nothing stored, or something else, reads as no set', normalizeSets(null).length === 0 && normalizeSets({ sets: [{ name: 'no plan' }] }).length === 0)

console.log(`\nSEGMENT SETS: ${total - fails} of ${total} checks passed`)
process.exit(fails ? 1 : 0)
