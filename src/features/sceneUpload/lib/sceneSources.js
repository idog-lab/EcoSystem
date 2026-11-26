// READING THE SOURCES of a scene upload: the release schedule, the draft DCX
// sent in Slack, the DCX files of the two latest versions, the layout names,
// the stars per mission and the upcoming postcards. Pure functions over the
// rows Google gives back (arrays of cells) - the network is in googleRead.js.
import { coinsOf, stickerPackOf, taskPrefixOf } from './sceneEngine.js'

const text = (v) => (v == null ? '' : String(v).trim())

/** A date cell: "26/11/2026" (day first, as the schedule writes it) or a sheet serial number. */
export function parseDate(v) {
  if (typeof v === 'number' && v > 20000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)
    return d.toISOString().slice(0, 10)
  }
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text(v))
  if (!m) return null
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

/** "Scenes Date Release": Scene Number | Scene Name | Live in Game. A number with .5 is a bonus scene. */
export function parseSchedule(rows) {
  const out = []
  for (const r of rows.slice(1)) {
    const number = Number(text(r[0]))
    const date = parseDate(r[2])
    if (!Number.isFinite(number) || !date) continue
    const isBonus = !Number.isInteger(number) || /bonus/i.test(text(r[1]))
    const bonusNo = isBonus ? Number((/#\s*(\d+)/.exec(text(r[1])) || [])[1]) || null : null
    out.push({ number, name: text(r[1]), date, isBonus, bonusNo })
  }
  return out.sort((a, b) => a.number - b.number)
}

/** The Google Sheets link in a pasted Slack message (or a bare link). */
export function linkInMessage(message) {
  const m = /https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+[^\s)\]>|]*/.exec(String(message ?? ''))
  return m ? m[0] : null
}
/** The Area ID named in a Slack message ("Area_80_Aladdin_Market"), if any. */
export function areaIdInMessage(message) {
  const m = /\b((?:Bonus)?Area_\d+_[A-Za-z0-9_]+)/.exec(String(message ?? ''))
  return m ? m[1] : null
}

/** The scene's row in an Area list: Area_80_... for scene 80, BonusArea_27_... for bonus #27. */
export function findArea(areaRows, scene) {
  const re = scene.isBonus ? new RegExp(`^BonusArea_0*${scene.bonusNo}_`) : new RegExp(`^Area_0*${scene.number}_`)
  const row = areaRows.slice(1).find((r) => re.test(text(r[0])))
  return row ? { areaId: text(row[0]), asset: text(row[1]) } : null
}

/** A scene's mission names in a Task list: the rows whose name is <prefix>_NN. */
export function findTasks(taskRows, areaId) {
  const prefix = taskPrefixOf(areaId).toLowerCase()
  return taskRows
    .slice(1)
    .map((r) => text(r[0]))
    .filter((id) => id.replace(/_?\d+$/, '').toLowerCase() === prefix)
}

/** "Tasks Meta Data": Area ID | Mission ID | Task Internal Order | Visual Importance (stars). */
export function starsFor(metaRows, scene) {
  if (scene.isBonus) return null
  const rows = metaRows.slice(1).filter((r) => Number((/^Area_?0*(\d+)_/.exec(text(r[0])) || [])[1]) === scene.number)
  if (!rows.length) return null
  return { areaName: text(rows[0][0]), missions: rows.map((r) => ({ id: text(r[1]), stars: Number(r[3]) || null })) }
}

/** The state of one DCX file, read from its tabs. */
export function dcxState({ areaRows, levelRows, taskRows }) {
  const areas = areaRows.slice(1).filter((r) => text(r[0]))
  const last = areas[areas.length - 1] ?? []
  const levels = levelRows.slice(1).filter((r) => Number.isFinite(Number(r[0])) && text(r[0]) !== '')
  const lastLevel = levels[levels.length - 1] ?? []
  const packs = [...new Set(areas.map((r) => stickerPackOf(r[3])).filter(Boolean))]
  // Requirements of the last regular and last bonus scene, to keep the next one different.
  const tasks = taskRows.slice(1).filter((r) => text(r[0]))
  const blocks = []
  for (const r of tasks) {
    const pre = text(r[0]).replace(/_?\d+$/, '')
    if (!blocks.length || blocks[blocks.length - 1].pre !== pre) blocks.push({ pre, req: [] })
    blocks[blocks.length - 1].req.push(Number(r[1]))
  }
  const lastRegular = [...blocks].reverse().find((b) => !/^BonusScene/i.test(b.pre))
  const lastBonus = [...blocks].reverse().find((b) => /^BonusScene/i.test(b.pre))
  return {
    areaCount: areas.length,
    areaIds: areas.map((r) => text(r[0])),
    lastAreaId: text(last[0]),
    lastChapter: Number(last[7]) || areas.length,
    lastCoins: coinsOf(last[3]),
    maxLevel: Number(lastLevel[0]) || 0,
    lastLevelRow: lastLevel,
    layoutByLevel: new Map(levels.map((r) => [Number(r[0]), text(r[1])])),
    levelRowByLevel: new Map(levels.map((r) => [Number(r[0]), r])),
    packs,
    previousRegular: lastRegular?.req ?? [],
    previousBonus: lastBonus?.req ?? [],
    taskCount: tasks.length,
  }
}

/** "WR decrease - HB treatment 1.29.0" -> [1, 29, 0]. */
export function versionOf(name) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?\s*$/.exec(text(name))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null
}
const cmpVersion = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** The two newest version folders of the DCX folder. */
export function latestVersionFolders(items, isFolder) {
  return items
    .filter((f) => isFolder(f) && versionOf(f.name))
    .sort((a, b) => cmpVersion(versionOf(b.name), versionOf(a.name)))
    .slice(0, 2)
}
/** Low / medium / High DCX files of a version folder (other copies and tests left out). */
export function dcxFilesOf(items, isSheet) {
  const order = { low: 0, medium: 1, high: 2 }
  return items
    .filter((f) => isSheet(f) && /^(low|medium|high)_dcx_/i.test(f.name))
    .sort((a, b) => order[a.name.split('_')[0].toLowerCase()] - order[b.name.split('_')[0].toLowerCase()])
}

// ---------------------------------------------------------------- upcoming

const norm = (s) => text(s).toLowerCase().replace(/^the[\s_]+/, '').replace(/[^a-z0-9]/g, '')

/** The postcard asset of a scheduled scene ("Toy Story - Pizza Planet" -> upcoming_toy_story), or null. */
export function assetFor(sceneName, assets) {
  const film = norm(text(sceneName).split(' - ')[0])
  if (!film) return null
  const keys = assets.map((a) => ({ a, k: norm(a.replace(/^upcoming_/, '')) }))
  const exact = keys.find((x) => x.k === film)
  if (exact) return exact.a
  const near = keys.filter((x) => x.k.length >= 4 && film.length >= 4 && (x.k.startsWith(film) || film.startsWith(x.k)))
  return near.length === 1 ? near[0].a : null
}

/**
 * Upcoming Areas: the next 10 regular scenes after the last one uploaded.
 * missing: 'skip' (take the next scene instead) or 'blank' (a row to fill by hand).
 */
export function upcomingRows({ schedule, afterNumber, assets, missing = 'skip', count = 10 }) {
  const rows = []
  const notFound = []
  for (const s of schedule) {
    if (rows.length >= count) break
    if (s.number <= afterNumber || s.isBonus) continue
    const asset = assetFor(s.name, assets)
    if (!asset) {
      notFound.push(s)
      if (missing === 'blank') rows.push({ scene: s, asset: '' })
      continue
    }
    rows.push({ scene: s, asset })
  }
  return { rows, notFound }
}
