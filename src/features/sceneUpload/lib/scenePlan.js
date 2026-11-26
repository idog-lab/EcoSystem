// Puts a scene upload together: from what was read (sceneLoad.js) and what the
// economist chose on the page, every row each DCX tab gets, and every check.
// Pure - the page only renders what this returns.
import {
  AREA_COLUMNS, ALLOWANCE_COLUMNS, COPIED_LEVEL_COLUMNS, LEVEL_COLUMNS, STARS, allowanceRows, areaRow,
  levelCosts, levelValues, newLevelRows, rewardText, sceneReward, suggestRequirements,
} from './sceneEngine.js'
import { findArea, findTasks, starsFor, upcomingRows } from './sceneSources.js'

export const sceneKey = (s) => String(s.number)

/** The DCX every other one is compared with: the newest version's file that has the most scenes. */
function referenceFile(versions) {
  const files = versions[0]?.files ?? []
  return [...files].sort((a, b) => b.state.areaCount - a.state.areaCount || b.state.maxLevel - a.state.maxLevel)[0] ?? null
}

export function buildPlan({ data, draft, date, choices = {}, missingUpcoming = 'skip', levelScope = 'new' }) {
  const problems = []
  const notes = []
  const scenes = data.schedule.rows.filter((s) => s.date === date)
  const ref = referenceFile(data.dcx.versions)
  if (!ref) return { scenes: [], problems: ['No DCX file could be read.'], notes }
  const base = ref.state

  // Every DCX should be where the reference is; one that is behind is named.
  const files = data.dcx.versions.flatMap((v, vi) => v.files.map((f) => ({ ...f, version: v.name, vi })))
  for (const f of files) {
    if (f.state.areaCount !== base.areaCount || f.state.maxLevel !== base.maxLevel)
      notes.push(`${f.name} ends at scene ${f.state.areaCount} and level ${f.state.maxLevel}; ${ref.name} ends at scene ${base.areaCount} and level ${base.maxLevel}.`)
  }

  let chapter = base.lastChapter
  let end = base.maxLevel
  let coins = base.lastCoins
  let prevRegular = base.previousRegular
  let prevBonus = base.previousBonus
  const sceneRows = []

  scenes.forEach((s, i) => {
    const key = sceneKey(s)
    const kind = s.isBonus ? 'bonus' : 'regular'
    const stars = STARS[kind]
    const area = draft ? findArea(draft.areaRows, s) : null
    const tasks = area ? findTasks(draft.taskRows, area.areaId) : []
    const meta = starsFor(data.meta.rows, s)
    const count = tasks.length || meta?.missions.length || (kind === 'bonus' ? 6 : 11)
    const metaStars = meta ? meta.missions.map((m) => m.stars) : null
    const missionStars = kind === 'bonus' ? null : choices.stars?.[key] ?? (metaStars?.length === count ? metaStars : metaStars ? padTo(metaStars, count) : null)
    const suggested = suggestRequirements({
      stars: missionStars,
      count,
      total: stars,
      seed: `${area?.areaId ?? s.name}#${choices.seed?.[key] ?? 0}`,
      previous: kind === 'bonus' ? prevBonus : prevRegular,
    })
    const requirements = choices.req?.[key]?.length === count ? choices.req[key] : suggested
    const already = area && base.areaIds.includes(area.areaId)
    chapter += 1
    const startLevel = end + 1
    end += stars
    const pack = choices.pack?.[key] ?? ''
    sceneRows.push({ s, key, kind, stars, area, tasks, meta, count, missionStars, requirements, suggested, chapter, startLevel, endLevel: end, pack, already, nextIsBonus: scenes[i + 1]?.isBonus === true })
    if (kind === 'bonus') prevBonus = requirements
    else prevRegular = requirements
  })

  const maxLevel = end
  const costs = levelCosts(Math.max(maxLevel, base.maxLevel))

  // Rewards, in order: each scene's coins sit above the one before it.
  for (const r of sceneRows) {
    r.reward = sceneReward({ kind: r.kind, stars: r.stars, endLevel: r.endLevel, costs, previousCoins: coins, stickerPack: r.pack, nextIsBonus: r.nextIsBonus })
    const typed = choices.coins?.[r.key]
    if (typed != null) {
      r.reward = { ...r.reward, coins: typed, typed: true }
      r.reward.text = rewardText({ coins: typed, ...rewardParts(r), stickerPack: r.pack, puzzle: r.reward.puzzle, kind: r.kind, nextIsBonus: r.nextIsBonus })
      if (coins != null && typed <= coins) problems.push(`${r.s.name}: ${fmt(typed)} coins is not above the scene before (${fmt(coins)}).`)
    }
    coins = r.reward.coins
    const sum = r.requirements.reduce((a, b) => a + Number(b || 0), 0)
    if (!r.area) problems.push(`${r.s.name}: not found in the draft DCX${r.s.isBonus ? ` (looked for BonusArea_${r.s.bonusNo}_...)` : ` (looked for Area_${r.s.number}_...)`}.`)
    else if (!r.tasks.length) problems.push(`${r.s.name}: no missions found in the draft's Task list for ${r.area.areaId}.`)
    if (r.already) problems.push(`${r.area.areaId} is already in ${ref.name}.`)
    if (sum !== r.stars) problems.push(`${r.s.name}: the missions add up to ${sum}, not ${r.stars}.`)
    if (!r.pack) problems.push(`${r.s.name}: pick a sticker pack.`)
    if (r.kind === 'regular' && !r.meta) notes.push(`${r.s.name}: no stars in Tasks Meta Data for scene ${r.s.number} - the requirements are spread without them.`)
    if (r.kind === 'regular' && r.meta && r.tasks.length && r.meta.missions.length !== r.tasks.length)
      notes.push(`${r.s.name}: Tasks Meta Data has ${r.meta.missions.length} missions, the draft ${r.tasks.length}.`)
  }

  // ---- Area list, Task list
  const areaRowsOut = sceneRows.filter((r) => r.area).map((r) => areaRow({ areaId: r.area.areaId, asset: r.area.asset, reward: r.reward, stars: r.stars, chapter: r.chapter }))
  const taskRowsOut = sceneRows.flatMap((r) => r.tasks.map((t, i) => [t, Number(r.requirements[i] ?? 0)]))

  // ---- Level list V2, one block per DCX
  const levels = files.map((f) => {
    const names = f.vi === 0 ? data.names : data.olderNames ?? data.names
    const from = f.state.maxLevel + 1
    const copied = COPIED_LEVEL_COLUMNS.map((_, i) => f.state.lastLevelRow[10 + i] ?? '')
    const missing = []
    for (let l = from; l <= maxLevel; l++) if (!names.byLevel.get(l)) missing.push(l)
    // Layout names that changed on levels the DCX already has.
    const renamed = []
    for (const [level, name] of f.state.layoutByLevel) {
      const now = names.byLevel.get(level)
      if (now && now !== name) renamed.push({ level, was: name, now })
    }
    let rows = newLevelRows({ fromLevel: from, toLevel: maxLevel, costs, layoutOf: (l) => names.byLevel.get(l), puzzleLayouts: names.puzzles, copied })
    if (levelScope === 'all') rows = wholeLevelList({ f, names, costs, maxLevel, copied })
    return { file: f, from, to: maxLevel, rows, missing, renamed, namesTitle: names.title, namesVersion: names.version }
  })
  for (const l of levels) if (l.missing.length) problems.push(`${l.file.name}: no layout name for ${l.missing.length} new level(s), from level ${l.missing[0]}.`)

  // ---- Resource allowances (the whole tab: new costs add rows inside every group)
  const allowance = allowanceRows({ costs, maxLevel, baseline: ref.allowances })
  const same = files.filter((f) => f !== ref && !sameRows(f.allowances, ref.allowances))
  if (same.length) notes.push(`Resource allowances differ from ${ref.name} in: ${same.map((f) => f.name).join(', ')}. The tab below is built on ${ref.name}.`)

  // ---- Upcoming Areas
  const lastNumber = scenes.length ? scenes[scenes.length - 1].number : Math.max(...data.schedule.rows.filter((s) => s.date <= date).map((s) => s.number), 0)
  const upcoming = upcomingRows({ schedule: data.schedule.rows, afterNumber: lastNumber, assets: data.upcoming.assets, missing: missingUpcoming })

  return {
    scenes: sceneRows,
    reference: ref,
    files,
    maxLevel,
    costs,
    problems,
    notes,
    tabs: {
      area: { columns: AREA_COLUMNS, rows: areaRowsOut },
      tasks: { columns: ['Mission ID', 'Star cost'], rows: taskRowsOut },
      tasksV2: { columns: ['Mission ID', 'Task_Cost_Segment_default'], rows: taskRowsOut },
      levels,
      allowance: { columns: ALLOWANCE_COLUMNS, ...allowance },
      upcoming: { columns: ['Area ID', 'Area Asset'], rows: upcoming.rows.map((r) => ['Area_Coming_Soon', r.asset]), scenes: upcoming.rows.map((r) => r.scene), notFound: upcoming.notFound },
    },
    levelColumns: LEVEL_COLUMNS,
  }
}

function rewardParts(r) {
  return r.kind === 'bonus' ? { wild: 0, stock: 0, undo: 0, freeRound: 0 } : { wild: 1, stock: 1, undo: 3, freeRound: 1 }
}

function padTo(list, n) {
  const out = list.slice(0, n)
  while (out.length < n) out.push(out[out.length - 1] ?? 3)
  return out
}

function sameRows(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) for (let j = 0; j < 4; j++) if (String(a[i][j]) !== String(b[i][j]) && Number(a[i][j]) !== Number(b[i][j])) return false
  return true
}

/** The whole Level list: the model's values for every level, the DCX's own copied columns kept. */
function wholeLevelList({ f, names, costs, maxLevel, copied }) {
  const rows = []
  for (let l = 1; l <= maxLevel; l++) {
    const layout = names.byLevel.get(l) ?? f.state.layoutByLevel.get(l) ?? ''
    const v = levelValues(l, costs.cost[l], names.puzzles.has(layout))
    const own = l <= f.state.maxLevel ? f.state.levelRowByLevel.get(l)?.slice(10, 19) : null
    rows.push([l, layout, v.entry, v.wild, v.undo, v.stock, v.leftover, v.match, v.completion, v.streak, ...(own ?? copied)])
  }
  return rows
}

export const fmt = (n) => (n == null ? '' : Number(n).toLocaleString('en-US'))
