// Reads every source of a scene upload from Google (read-only) and hands back
// plain data. The links are the economist's; nothing is written anywhere.
import { FOLDER_MIME, SHEET_MIME, folderIdOf, gidOf, listFolder, readRanges, sheetIdOf, sheetInfo } from './googleRead.js'
import { dcxFilesOf, dcxState, latestVersionFolders, parseSchedule } from './sceneSources.js'

const q = (tab) => `'${String(tab).replace(/'/g, "''")}'`

async function tabOf(id, gid, fallbackIndex = 0) {
  const info = await sheetInfo(id)
  const tab = info.tabs.find((t) => t.id === gid) ?? info.tabs[fallbackIndex]
  return { title: info.title, tab: tab?.title, tabs: info.tabs }
}

function need(link, what) {
  const id = sheetIdOf(link)
  if (!id) throw new Error(`The link for ${what} is missing or is not a Google Sheets link.`)
  return id
}

/** Level names of a version: "Level List to copy for DCX" (A1 the version, then Level | Layout Name). */
export async function loadLevelNames(link) {
  const id = need(link, 'the level names')
  const info = await sheetInfo(id)
  const listTab = info.tabs.find((t) => /level list to copy/i.test(t.title)) ?? info.tabs[0]
  const exportTab = info.tabs.find((t) => /data model export/i.test(t.title))
  const ranges = [`${q(listTab.title)}!A1:B`]
  if (exportTab) ranges.push(`${q(exportTab.title)}!A1:M`)
  const [list, exp = []] = await readRanges(id, ranges)
  const byLevel = new Map()
  for (const r of list) {
    const level = Number(r[0])
    if (Number.isInteger(level) && level > 0 && r[1]) byLevel.set(level, String(r[1]).trim())
  }
  // The model's Layout Data is this export: a layout is a puzzle when Puzzle, Puzzle 4 or Puzzle 6 is TRUE.
  const head = exp[0] ?? []
  const cols = ['Puzzle', 'Puzzle 4', 'Puzzle 6'].map((h) => head.findIndex((c) => String(c).trim() === h)).filter((i) => i >= 0)
  const puzzles = new Set()
  for (const r of exp.slice(1)) if (cols.some((i) => r[i] === true || String(r[i]).toUpperCase() === 'TRUE' || r[i] === 1)) puzzles.add(String(r[0]).trim())
  return {
    id,
    title: info.title,
    version: String(list[0]?.[0] ?? '').trim(),
    listTab: listTab.title,
    byLevel,
    puzzles,
    hasPuzzleList: Boolean(exportTab) && cols.length > 0,
  }
}

/** One DCX file: its state and its Resource allowances rows. */
async function loadDcx(file) {
  const [areaRows, levelRows, taskRows, allowRows] = await readRanges(file.id, [
    "'Area list'!A1:H",
    "'Level list V2'!A1:S",
    "'Task list'!A1:B",
    "'Resource allowances'!A1:D",
  ])
  return {
    name: file.name,
    id: file.id,
    state: dcxState({ areaRows, levelRows, taskRows }),
    allowances: allowRows.slice(1).filter((r) => r[0]),
  }
}

export async function loadAll(links, progress = () => {}) {
  progress('Reading the release schedule')
  const scheduleId = need(links.schedule, 'the release schedule')
  const sched = await tabOf(scheduleId, gidOf(links.schedule))
  const [scheduleRows] = await readRanges(scheduleId, [`${q(sched.tab)}!A1:C`])

  progress('Reading the level names')
  const names = await loadLevelNames(links.levelNames)
  const olderNames = links.olderLevelNames?.trim() ? await loadLevelNames(links.olderLevelNames) : null

  progress('Reading the stars of the missions')
  const metaId = need(links.tasksMeta, 'the Tasks Meta Data')
  const meta = await tabOf(metaId, gidOf(links.tasksMeta))
  const [metaRows] = await readRanges(metaId, [`${q(meta.tab)}!A1:D`])

  progress('Reading the upcoming postcard names')
  const upId = need(links.upcoming, 'the upcoming postcard names')
  const up = await tabOf(upId, gidOf(links.upcoming))
  const [upRows] = await readRanges(upId, [`${q(up.tab)}!A1:A`])
  const assets = upRows.map((r) => String(r[0] ?? '').trim()).filter((a) => /^upcoming_/.test(a))

  progress('Looking in the DCX folder')
  const folderId = folderIdOf(links.dcxFolder)
  if (!folderId) throw new Error('The DCX folder link is missing or is not a Google Drive folder link.')
  const versionFolders = latestVersionFolders(await listFolder(folderId), (f) => f.mimeType === FOLDER_MIME)
  if (!versionFolders.length) throw new Error('No version folders (names ending in a version like 1.29.0) were found in the DCX folder.')
  const versions = []
  for (const vf of versionFolders) {
    const files = dcxFilesOf(await listFolder(vf.id), (f) => f.mimeType === SHEET_MIME)
    const read = []
    for (const f of files) {
      progress(`Reading ${f.name}`)
      read.push(await loadDcx(f))
    }
    versions.push({ name: vf.name, id: vf.id, files: read })
  }

  return {
    schedule: { id: scheduleId, gid: gidOf(links.schedule), title: sched.title, tab: sched.tab, rows: parseSchedule(scheduleRows) },
    names,
    olderNames,
    meta: { id: metaId, title: meta.title, rows: metaRows },
    upcoming: { id: upId, title: up.title, assets },
    dcx: { folderId, versions },
    readAt: new Date().toISOString(),
  }
}

/** The draft DCX sent in Slack: its Area list and Task list. */
export async function loadDraft(link) {
  const id = need(link, 'the draft DCX')
  const info = await sheetInfo(id)
  const [areaRows, taskRows] = await readRanges(id, ["'Area list'!A1:B", "'Task list'!A1:A"])
  return { id, gid: gidOf(link), title: info.title, areaRows, taskRows }
}
