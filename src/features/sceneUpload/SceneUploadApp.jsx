import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Copy, ExternalLink, Image as ImageIcon, RefreshCw, TriangleAlert } from 'lucide-react'
import { connect, folderUrl, isConnected, sheetIdOf, sheetUrl, setBridgeUrl } from './lib/googleRead.js'
import { loadAll, loadDraft } from './lib/sceneLoad.js'
import { areaIdInMessage, linkInMessage } from './lib/sceneSources.js'
import { buildPlan, fmt } from './lib/scenePlan.js'
import { toTsv } from './lib/sceneEngine.js'

// SCENE UPLOAD (economist, 26 Nov 2026): everything the DCX needs for the
// week's scene - Area list, Task list, Level list V2, Resource allowances,
// Upcoming Areas - worked out with the model's formulas from what is in
// Google today. The tool only READS: the economist pastes the text into the
// DCX herself ("אתה כרגע לא מעדכן את הדיסאיקס עד שנגיד אחרת").

const BUTTON = 'inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-purple-300 hover:text-purple-700 disabled:opacity-50'
const PRIMARY = 'inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:brightness-105 disabled:opacity-50'
const INPUT = 'w-full rounded-lg border border-slate-200 bg-white/80 px-2 py-1 text-sm text-slate-800 focus:border-purple-400 focus:outline-none focus:ring-4 focus:ring-purple-200/60'
const CARD = 'rounded-2xl border border-white bg-white/85 p-4 shadow-sm ring-1 ring-slate-200/70'
const TH = 'px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap'
const TD = 'px-2 py-1 align-middle'

// The links are kept in this browser only (the app's code is public; the
// links are not written into it).
const LINKS_KEY = 'superplay-scene-upload-links'
const CHOICES_KEY = 'superplay-scene-upload-choices'
const LINK_FIELDS = [
  { key: 'bridge', label: 'Google connection - the Apps Script web app link (ends with /exec), set up once' },
  { key: 'schedule', label: 'Release schedule (Scenes Date Release)' },
  { key: 'levelNames', label: 'Level names of the newest version (DCX Level list for ...) - changes every upload' },
  { key: 'olderLevelNames', label: 'Level names of the older version - leave empty when they are the same', optional: true },
  { key: 'tasksMeta', label: 'Stars per mission (Tasks Meta Data)' },
  { key: 'upcoming', label: 'Upcoming postcard names' },
  { key: 'dcxFolder', label: 'DCX folder (Drive)' },
]

function readStore(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}
function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* the page works without it */
  }
}

const today = () => new Date().toISOString().slice(0, 10)

export default function SceneUploadApp({ onHome }) {
  const [links, setLinks] = useState(() => readStore(LINKS_KEY, {}))
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [date, setDate] = useState(today)
  const [message, setMessage] = useState('')
  const [draft, setDraft] = useState(null)
  const [choices, setChoices] = useState(() => readStore(CHOICES_KEY, {}))
  const [missingUpcoming, setMissingUpcoming] = useState('skip')
  const [levelScope, setLevelScope] = useState('new')
  const [showLinks, setShowLinks] = useState(() => !LINK_FIELDS.every((f) => f.optional || readStore(LINKS_KEY, {})[f.key]))

  useEffect(() => {
    writeStore(LINKS_KEY, links)
    setBridgeUrl(links.bridge)
  }, [links])
  useEffect(() => writeStore(CHOICES_KEY, choices), [choices])

  const plan = useMemo(() => {
    if (!data) return null
    try {
      return buildPlan({ data, draft, date, choices, missingUpcoming, levelScope })
    } catch (e) {
      return { error: e.message }
    }
  }, [data, draft, date, choices, missingUpcoming, levelScope])

  async function readEverything() {
    setError(null)
    try {
      setBusy('Signing in to Google')
      await connect()
      const d = await loadAll(links, setBusy)
      setData(d)
      setShowLinks(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  async function readDraft() {
    setError(null)
    const link = linkInMessage(message) ?? message.trim()
    try {
      setBusy('Reading the draft DCX')
      await connect()
      setDraft({ ...(await loadDraft(link)), areaInMessage: areaIdInMessage(message) })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  function choose(kind, key, value) {
    setChoices((c) => ({ ...c, [kind]: { ...(c[kind] ?? {}), [key]: value } }))
  }
  function forget(kind, key) {
    setChoices((c) => {
      const next = { ...(c[kind] ?? {}) }
      delete next[key]
      return { ...c, [kind]: next }
    })
  }

  return (
    <div className="min-h-screen economy-app text-slate-800" data-testid="scene-upload">
      <div className="app-backdrop" aria-hidden="true" />
      <header className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 pb-2 pt-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <button type="button" onClick={onHome} aria-label="Back to the features" title="Back to the features" className="grid h-9 w-9 place-items-center rounded-xl border border-white bg-white/80 text-slate-500 ring-1 ring-slate-200/70 transition-colors hover:text-purple-600">
            <ArrowLeft size={16} />
          </button>
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-purple-600 to-fuchsia-500 text-white shadow-md shadow-purple-500/30">
            <ImageIcon size={18} strokeWidth={2.25} />
          </span>
          <h1 className="font-display text-xl font-bold tracking-tight text-slate-900">Scene upload</h1>
          <span className="text-sm text-slate-500">Reads Google, works it out with the model's formulas, and gives you the text for each DCX tab. It never changes a file.</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BUTTON} onClick={() => setShowLinks((v) => !v)} data-testid="scene-links-toggle">
            {showLinks ? 'Hide the links' : 'Links'}
          </button>
          <button type="button" className={PRIMARY} onClick={readEverything} disabled={Boolean(busy)} data-testid="scene-read">
            <RefreshCw size={14} /> {data ? 'Read again' : 'Read from Google'}
          </button>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1500px] flex-col gap-4 px-6 pb-12">
        {busy && <p className="rounded-xl bg-purple-50 px-3 py-2 text-sm text-purple-800" data-testid="scene-busy">{busy}...</p>}
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800" data-testid="scene-error">{error}</p>}

        {showLinks && <LinksCard links={links} setLinks={setLinks} />}

        {!data && !busy && (
          <section className={CARD}>
            <p className="text-sm text-slate-600">
              Put the links in (once - they are kept in this browser), then <b>Read from Google</b>. Google asks you to sign in the first time; the access is read-only.
            </p>
          </section>
        )}

        {data && <SourcesCard data={data} connected={isConnected()} />}

        {data && (
          <section className={CARD} data-testid="scene-which">
            <h2 className="mb-2 font-display text-base font-bold text-slate-900">1. Which scene</h2>
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-sm text-slate-600">
                Upload date
                <input type="date" className={`${INPUT} mt-1 w-44`} value={date} onChange={(e) => setDate(e.target.value)} data-testid="scene-date" />
              </label>
              <div className="text-sm text-slate-700" data-testid="scene-of-date">
                {plan?.scenes?.length ? (
                  plan.scenes.map((s) => (
                    <div key={s.key}>
                      <b>{s.s.name}</b> - scene {s.s.number}
                      {s.kind === 'bonus' ? ' (bonus, 50 stars)' : ' (150 stars)'}
                    </div>
                  ))
                ) : (
                  <span className="text-amber-700">Nothing in the release schedule on this date.</span>
                )}
              </div>
            </div>
            {/* The one link that changes from upload to upload (economist, 26 Nov 2026), so it sits here, not only under Links. */}
            <label className="mt-3 block text-sm text-slate-600">
              Level names file of this upload (DCX Level list for ...)
              <input className={`${INPUT} mt-1`} value={links.levelNames ?? ''} onChange={(e) => setLinks((l) => ({ ...l, levelNames: e.target.value }))} data-testid="scene-level-names" />
            </label>
            {sheetIdOf(links.levelNames) !== data.names.id ? (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-amber-800" data-testid="scene-level-names-changed">
                A new level names file - read again to use it.
                <button type="button" className={BUTTON} onClick={readEverything} disabled={Boolean(busy)}>
                  <RefreshCw size={14} /> Read again
                </button>
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                In use: {data.names.title}, version {data.names.version || '?'}, levels up to {fmt(Math.max(0, ...data.names.byLevel.keys()))}.
              </p>
            )}
            <label className="mt-3 block text-sm text-slate-600">
              The Slack message (or the draft DCX link) from #disney-solitaire-new-scenes
              <textarea className={`${INPUT} mt-1 h-20 font-mono text-[12.5px]`} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Uploaded Scene  Area_80_Aladdin_Market  Ready for Prod!  Configured in https://docs.google.com/spreadsheets/d/..." data-testid="scene-message" />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button type="button" className={BUTTON} onClick={readDraft} disabled={!message.trim() || Boolean(busy)} data-testid="scene-read-draft">
                Read the draft
              </button>
              {draft && (
                <a className="inline-flex items-center gap-1 text-sm text-purple-700 hover:underline" href={sheetUrl(draft.id, draft.gid)} target="_blank" rel="noreferrer">
                  {draft.title} <ExternalLink size={12} />
                </a>
              )}
              {draft?.areaInMessage && plan?.scenes?.length > 0 && !plan.scenes.some((s) => s.area?.areaId === draft.areaInMessage) && (
                <span className="text-sm text-amber-700">The message names {draft.areaInMessage}, which is not a scene of this date.</span>
              )}
            </div>
          </section>
        )}

        {plan?.error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{plan.error}</p>}

        {plan?.scenes?.map((s, i) => (
          <SceneCard key={s.key} n={i + 2} s={s} plan={plan} choices={choices} choose={choose} forget={forget} />
        ))}

        {plan?.scenes && <ChecksCard plan={plan} />}
        {plan?.scenes?.length > 0 && (
          <OutputCard plan={plan} missingUpcoming={missingUpcoming} setMissingUpcoming={setMissingUpcoming} levelScope={levelScope} setLevelScope={setLevelScope} />
        )}
      </main>
    </div>
  )
}

function LinksCard({ links, setLinks }) {
  return (
    <section className={CARD} data-testid="scene-links">
      <h2 className="mb-1 font-display text-base font-bold text-slate-900">Links</h2>
      <p className="mb-3 text-sm text-slate-500">Kept in this browser only. Paste the link of each file (any link to the file works, the tab in it is kept).</p>
      <div className="grid gap-2 md:grid-cols-2">
        {LINK_FIELDS.map((f) => (
          <label key={f.key} className="text-sm text-slate-600">
            {f.label}
            <input className={`${INPUT} mt-1`} value={links[f.key] ?? ''} onChange={(e) => setLinks((l) => ({ ...l, [f.key]: e.target.value }))} data-link={f.key} />
          </label>
        ))}
      </div>
    </section>
  )
}

function SourcesCard({ data }) {
  const v = data.dcx.versions
  return (
    <section className={CARD} data-testid="scene-sources">
      <h2 className="mb-2 font-display text-base font-bold text-slate-900">What was read</h2>
      <ul className="grid gap-1 text-sm text-slate-700 md:grid-cols-2">
        <Src href={sheetUrl(data.schedule.id, data.schedule.gid)} name={data.schedule.title} what={`${data.schedule.rows.length} scenes with a date (tab ${data.schedule.tab})`} />
        <Src href={sheetUrl(data.names.id)} name={data.names.title} what={`${data.names.byLevel.size.toLocaleString('en-US')} level names, version ${data.names.version || '?'}; ${data.names.puzzles.size} puzzle layouts`} />
        {data.olderNames && <Src href={sheetUrl(data.olderNames.id)} name={data.olderNames.title} what={`${data.olderNames.byLevel.size.toLocaleString('en-US')} level names for the older version`} />}
        <Src href={sheetUrl(data.meta.id)} name={data.meta.title} what={`${data.meta.rows.length - 1} missions with stars`} />
        <Src href={sheetUrl(data.upcoming.id)} name={data.upcoming.title} what={`${data.upcoming.assets.length} postcard names`} />
      </ul>
      <h3 className="mb-1 mt-3 text-sm font-semibold text-slate-800">
        DCX files - the two newest versions{' '}
        <a className="font-normal text-purple-700 hover:underline" href={folderUrl(data.dcx.folderId)} target="_blank" rel="noreferrer">
          (folder)
        </a>
      </h3>
      <table className="text-sm" data-dense>
        <thead>
          <tr>
            <th className={TH}>Version</th>
            <th className={TH}>File</th>
            <th className={TH}>Last scene</th>
            <th className={TH}>Scenes</th>
            <th className={TH}>Last level</th>
          </tr>
        </thead>
        <tbody>
          {v.flatMap((ver) =>
            ver.files.map((f) => (
              <tr key={f.id} className="border-t border-slate-100">
                <td className={TD}>{ver.name.replace(/^.*?(\d+\.\d+(\.\d+)?)\s*$/, '$1')}</td>
                <td className={TD}>
                  <a className="text-purple-700 hover:underline" href={sheetUrl(f.id)} target="_blank" rel="noreferrer">
                    {f.name}
                  </a>
                </td>
                <td className={TD}>{f.state.lastAreaId}</td>
                <td className={`${TD} tabular-nums`}>{f.state.areaCount}</td>
                <td className={`${TD} tabular-nums`}>{fmt(f.state.maxLevel)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">Read at {new Date(data.readAt).toLocaleString()}.</p>
    </section>
  )
}

function Src({ href, name, what }) {
  return (
    <li>
      <a className="font-medium text-purple-700 hover:underline" href={href} target="_blank" rel="noreferrer">
        {name}
      </a>{' '}
      <span className="text-slate-500">- {what}</span>
    </li>
  )
}

const STAR_TEXT = (n) => '★'.repeat(n) + '☆'.repeat(5 - n)

function SceneCard({ n, s, plan, choices, choose, forget }) {
  // Every pack the DCX's scenes give, the latest first.
  const packs = useMemo(() => [...plan.reference.state.packs].reverse(), [plan.reference])
  const sum = s.requirements.reduce((a, b) => a + Number(b || 0), 0)
  const recentPacks = useMemo(() => plan.reference.state.packs.slice(-4).reverse(), [plan.reference])
  return (
    <section className={CARD} data-testid={`scene-card-${s.key}`}>
      <h2 className="font-display text-base font-bold text-slate-900">
        {n}. {s.s.name} {s.kind === 'bonus' && <span className="ml-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">Bonus</span>}
      </h2>
      <p className="mb-3 text-sm text-slate-600">
        {s.area ? (
          <>
            <b>{s.area.areaId}</b> · asset {s.area.asset}
          </>
        ) : (
          <span className="text-amber-700">Read the draft to get the Area ID and the missions.</span>
        )}{' '}
        · chapter {s.chapter} · levels {fmt(s.startLevel)}-{fmt(s.endLevel)} · {s.stars} stars
      </p>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col gap-3">
          <label className="text-sm text-slate-600">
            Sticker pack
            <select className={`${INPUT} mt-1`} value={s.pack} onChange={(e) => choose('pack', s.key, e.target.value)} data-testid={`scene-pack-${s.key}`}>
              <option value="">- pick a pack -</option>
              {packs.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">Last scenes: {recentPacks.join(' · ')}</span>
          </label>
          <div className="text-sm text-slate-700">
            <div className="flex flex-wrap items-center gap-2">
              Coins
              <input
                type="number"
                step={5000}
                className={`${INPUT} w-36 tabular-nums`}
                value={s.reward.coins}
                onChange={(e) => (e.target.value === '' ? forget('coins', s.key) : choose('coins', s.key, Number(e.target.value)))}
                data-testid={`scene-coins-${s.key}`}
              />
              {s.reward.typed && (
                <button type="button" className="text-xs text-purple-700 hover:underline" onClick={() => forget('coins', s.key)}>
                  back to the suggestion
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              The model: last level costs {fmt(s.reward.maxAllowance)} × 3 = {fmt(s.reward.modelCoins)}; to the nearest 5,000 and above the scene before.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Puzzle {s.reward.puzzle} · both charms {s.reward.charm}
              {s.kind === 'regular' ? ' · wild 1, stock 1, undo 3, free entry 1' : ''}
              {s.nextIsBonus ? ' · enters a bonus scene next' : ''}
            </p>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Completion reward</div>
            <code className="block break-all rounded-lg bg-slate-50 p-2 text-[12px] text-slate-800" data-testid={`scene-reward-${s.key}`}>
              {s.reward.text}
            </code>
          </div>
        </div>
        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Missions - {sum} of {s.stars}
              {sum !== s.stars && <span className="ml-1 text-rose-700">(must be {s.stars})</span>}
            </span>
            <button
              type="button"
              className="text-xs font-semibold text-purple-700 hover:underline"
              onClick={() => {
                forget('req', s.key)
                choose('seed', s.key, (choices.seed?.[s.key] ?? 0) + 1)
              }}
              title="A new suggestion inside each mission's star range"
            >
              Suggest again
            </button>
          </div>
          <table className="w-full text-sm" data-dense>
            <thead>
              <tr>
                <th className={TH}>#</th>
                <th className={TH}>Mission</th>
                {s.kind === 'regular' && <th className={TH}>Stars</th>}
                <th className={TH}>Requirement</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: s.count }, (_, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className={`${TD} text-slate-400`}>{i + 1}</td>
                  <td className={`${TD} font-mono text-[12.5px]`}>{s.tasks[i] ?? '-'}</td>
                  {s.kind === 'regular' && (
                    <td className={TD}>
                      <select
                        className="rounded border border-slate-200 bg-white px-1 text-amber-500"
                        value={s.missionStars?.[i] ?? 3}
                        onChange={(e) => {
                          const next = [...(s.missionStars ?? new Array(s.count).fill(3))]
                          next[i] = Number(e.target.value)
                          choose('stars', s.key, next)
                          forget('req', s.key)
                        }}
                      >
                        {[1, 2, 3, 4, 5].map((k) => (
                          <option key={k} value={k}>
                            {STAR_TEXT(k)}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td className={TD}>
                    <input
                      type="number"
                      className="w-20 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-center tabular-nums text-slate-800"
                      value={s.requirements[i] ?? ''}
                      onChange={(e) => {
                        const next = [...s.requirements]
                        next[i] = Number(e.target.value)
                        choose('req', s.key, next)
                      }}
                      data-testid={`scene-req-${s.key}-${i}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-slate-500">
            {s.kind === 'regular'
              ? s.meta
                ? `Stars from Tasks Meta Data (${s.meta.areaName}). The requirement is suggested inside each star's usual range, from the last 25 scenes.`
                : 'No stars found in Tasks Meta Data for this scene.'
              : 'Bonus scenes have no stars: 50 spread over the missions, 4 to 11 each.'}
          </p>
        </div>
      </div>
    </section>
  )
}

function ChecksCard({ plan }) {
  if (!plan.problems.length && !plan.notes.length) return null
  return (
    <section className={CARD} data-testid="scene-checks">
      <h2 className="mb-2 font-display text-base font-bold text-slate-900">Before you copy</h2>
      <ul className="space-y-1 text-sm">
        {plan.problems.map((p) => (
          <li key={p} className="flex gap-2 text-rose-800">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" /> {p}
          </li>
        ))}
        {plan.notes.map((p) => (
          <li key={p} className="flex gap-2 text-amber-800">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" /> {p}
          </li>
        ))}
      </ul>
    </section>
  )
}

const OUT_TABS = [
  { id: 'area', label: 'Area list' },
  { id: 'tasks', label: 'Task list' },
  { id: 'tasksV2', label: 'Task list V2' },
  { id: 'levels', label: 'Level list V2' },
  { id: 'allowance', label: 'Resource allowances' },
  { id: 'upcoming', label: 'Upcoming Areas' },
]

function OutputCard({ plan, missingUpcoming, setMissingUpcoming, levelScope, setLevelScope }) {
  const [tab, setTab] = useState('area')
  const [fileIx, setFileIx] = useState(0)
  const lv = plan.tabs.levels[Math.min(fileIx, plan.tabs.levels.length - 1)]
  return (
    <section className={CARD} data-testid="scene-output">
      <h2 className="mb-2 font-display text-base font-bold text-slate-900">The text for the DCX</h2>
      <nav className="mb-3 flex flex-wrap gap-1.5">
        {OUT_TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-pressed={tab === t.id} data-out-tab={t.id} className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${tab === t.id ? 'bg-purple-600 text-white shadow-sm' : 'bg-white/80 text-slate-600 ring-1 ring-slate-200/70 hover:text-purple-700'}`}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'area' && <Block note="Add these rows at the end of Area list, in this order." columns={plan.tabs.area.columns} rows={plan.tabs.area.rows} />}
      {tab === 'tasks' && <Block note="Add at the end of Task list." columns={plan.tabs.tasks.columns} rows={plan.tabs.tasks.rows} />}
      {tab === 'tasksV2' && <Block note="Add at the end of Task list V2 (the same numbers)." columns={plan.tabs.tasksV2.columns} rows={plan.tabs.tasksV2.rows} />}

      {tab === 'levels' && (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
            <select className={`${INPUT} w-auto`} value={fileIx} onChange={(e) => setFileIx(Number(e.target.value))} data-testid="scene-level-file">
              {plan.tabs.levels.map((l, i) => (
                <option key={l.file.id} value={i}>
                  {l.file.name}
                </option>
              ))}
            </select>
            <label className="inline-flex items-center gap-1">
              <input type="radio" checked={levelScope === 'new'} onChange={() => setLevelScope('new')} /> New levels only
            </label>
            <label className="inline-flex items-center gap-1">
              <input type="radio" checked={levelScope === 'all'} onChange={() => setLevelScope('all')} /> The whole list
            </label>
          </div>
          <p className="mb-2 text-xs text-slate-500">
            Entry cost to Streak Coin Reward from the model; Attempts Pity Counter to Extra Stock Index copied from the last level of {lv.file.name}. Layout names from {lv.namesTitle}.
            {levelScope === 'all' && ' The whole list: every level gets the model\'s values and the newest layout names; the copied columns stay what this DCX has.'}
          </p>
          {lv.renamed.length > 0 && (
            <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900" data-testid="scene-renamed">
              {lv.renamed.length} level(s) this DCX already has are named differently in the newest list (first: level {lv.renamed[0].level}, {lv.renamed[0].was} → {lv.renamed[0].now}). Pick "The whole list" to bring them up to date.
            </p>
          )}
          <Block note={levelScope === 'new' ? `Add at the end of Level list V2 (levels ${fmt(lv.from)}-${fmt(lv.to)}).` : 'Replace the whole Level list V2 (header included).'} columns={plan.levelColumns} rows={lv.rows} />
        </div>
      )}

      {tab === 'allowance' && (
        <div>
          <p className="mb-2 text-xs text-slate-500">
            The whole tab: {plan.tabs.allowance.uniqueCosts} level costs × 18 groups. New costs add rows inside every group, and album and MF rewards look further ahead now that the game has more levels, so paste over the whole tab.{' '}
            {plan.tabs.allowance.changed.length} row(s) are new or changed.
          </p>
          <Block note="Replace the whole Resource allowances tab (header included)." columns={plan.tabs.allowance.columns} rows={plan.tabs.allowance.rows} highlight={new Set(plan.tabs.allowance.changed.map((c) => `${c.group}|${c.level}`))} keyOf={(r) => `${r[0]}|${r[2]}`} />
        </div>
      )}

      {tab === 'upcoming' && (
        <div>
          {plan.tabs.upcoming.notFound.length > 0 && (
            <div className="mb-2 rounded-lg bg-amber-50 px-2 py-1 text-sm text-amber-900" data-testid="scene-upcoming-missing">
              No postcard name for: {plan.tabs.upcoming.notFound.map((s) => s.name).join(', ')}.{' '}
              <label className="ml-2 inline-flex items-center gap-1">
                <input type="radio" checked={missingUpcoming === 'skip'} onChange={() => setMissingUpcoming('skip')} /> skip them
              </label>
              <label className="ml-2 inline-flex items-center gap-1">
                <input type="radio" checked={missingUpcoming === 'blank'} onChange={() => setMissingUpcoming('blank')} /> leave an empty row to fill
              </label>
            </div>
          )}
          <p className="mb-2 text-xs text-slate-500">The next 10 scenes after this upload: {plan.tabs.upcoming.scenes.map((s) => s.number).join(', ')}.</p>
          <Block note="Replace the rows of Upcoming Areas (header included)." columns={plan.tabs.upcoming.columns} rows={plan.tabs.upcoming.rows} />
        </div>
      )}
    </section>
  )
}

const PREVIEW = 40

function Block({ note, columns, rows, highlight, keyOf }) {
  const [copied, setCopied] = useState(null)
  async function copy(withHeader) {
    const text = toTsv(withHeader ? [columns, ...rows] : rows)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(withHeader ? 'header' : 'rows')
      setTimeout(() => setCopied(null), 1800)
    } catch {
      setCopied('failed')
    }
  }
  const shown = rows.length > PREVIEW ? [...rows.slice(0, PREVIEW / 2), null, ...rows.slice(-PREVIEW / 2)] : rows
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" className={PRIMARY} onClick={() => copy(false)} disabled={!rows.length} data-testid="scene-copy">
          {copied === 'rows' ? <Check size={14} /> : <Copy size={14} />} Copy {rows.length.toLocaleString('en-US')} rows
        </button>
        <button type="button" className={BUTTON} onClick={() => copy(true)} disabled={!rows.length}>
          {copied === 'header' ? <Check size={14} /> : <Copy size={14} />} With the header
        </button>
        <span className="text-sm text-slate-600">{note}</span>
        {copied === 'failed' && <span className="text-sm text-rose-700">The browser did not allow copying.</span>}
      </div>
      <div className="max-h-[520px] overflow-auto rounded-lg border border-slate-100">
        <table className="w-full text-[12.5px]" data-dense>
          <thead className="sticky top-0 bg-white">
            <tr>
              {columns.map((c) => (
                <th key={c} className={TH}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) =>
              r === null ? (
                <tr key={`gap${i}`}>
                  <td colSpan={columns.length} className="px-2 py-1 text-center text-xs text-slate-400">
                    … {rows.length - PREVIEW} more rows (all of them are copied) …
                  </td>
                </tr>
              ) : (
                <tr key={i} className={`border-t border-slate-100 ${highlight?.has(keyOf(r)) ? 'bg-amber-50' : ''}`}>
                  {r.map((v, j) => (
                    <td key={j} className={`${TD} ${typeof v === 'number' ? 'tabular-nums' : 'break-all'}`}>
                      {v}
                    </td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
