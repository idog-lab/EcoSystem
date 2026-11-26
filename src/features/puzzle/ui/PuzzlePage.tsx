import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Puzzle as PuzzleIcon } from 'lucide-react'
import type { ModelPageProps } from '../../../platform/registry/modules'
import { api } from '../../../platform/api/client'
import { useSession } from '../../../platform/api/useSession'
import { Link } from '../../../platform/routing/Link'
import { teamData } from '../../../lib/teamData'
import { useTeamStatus } from '../../../components/useTeamStatus'
import { createLocalBackend, PUZZLE_STORAGE_KEY } from './localBackend'
import { computeAll } from '../engine/compute'
import { RC_SEGMENTS, REGULAR_SEGMENTS, type PuzzleEvent } from '../engine/model'
import { CcPresets } from './CcPresets'
import { ConfigPreview } from './ConfigPreview'
import { Btn, Choice, Note, Pill } from './kit'
import { Optimize } from './Optimize'
import { Ctx, type Phase, type PuzzleCtx } from './shared'
import { SimulatorPanel } from './SimulatorPanel'
import { StepMechanics } from './StepMechanics'
import { StepReview } from './StepReview'
import { StepRewards } from './StepRewards'
import { StepEconomy, StepSetup } from './StepSetupEconomy'
import { usePuzzleEvents } from './usePuzzleEvents'

type Tab = 'build' | 'optimize' | 'cc' | 'preview'
const STEPS = [
  { id: 'setup', label: 'Setup', purpose: 'name, dates, length, inflation, MTX baseline and the event mode.' },
  { id: 'economy', label: 'Economy & progression', purpose: 'Wins for Economy per segment, the effort of the six boards and the daily plan.' },
  { id: 'rewards', label: 'Rewards', purpose: 'what each board gives, its worth against your target.' },
  { id: 'mechanics', label: 'Event mechanics', purpose: 'segment rules, Price Cut or Maleficent, the piece order.' },
  { id: 'review', label: 'Review & export', purpose: 'checks, changes, and the Google Sheets output.' },
] as const
type StepId = (typeof STEPS)[number]['id']

export default function PuzzlePage({ onHome }: ModelPageProps) {
  const { session, devSignIn, signInWithGoogle } = useSession()
  // No toolkit server here (the live site): the events are kept in this browser and shared with the team
  // through the private data repository, like the other tools. Where a server answers, it keeps them.
  const where: 'server' | 'browser' = session.status === 'unavailable' ? 'browser' : 'server'
  const local = useMemo(
    () =>
      createLocalBackend({
        onChange: () => teamData.changed(PUZZLE_STORAGE_KEY),
        who: () => (teamData.user() as { login?: string } | null)?.login ?? 'this browser',
      }),
    [],
  )
  const workspaceId = where === 'browser' ? 'local' : session.status === 'signed-in' ? (session.workspaces[0]?.id ?? null) : null
  const store = usePuzzleEvents(workspaceId, where === 'browser' ? local.call : api)
  // The team's newest file came in ("Get the team's latest", or at opening): show it.
  const team = useTeamStatus() as { state: string; at: string | null }
  const { refreshList } = store
  useEffect(() => {
    if (where === 'browser' && team.state === 'saved') void refreshList()
  }, [where, team.state, team.at, refreshList])

  let body
  if (session.status === 'loading') body = <Note>Loading…</Note>
  else if (where === 'browser') body = !store.doc || !store.draft ? <EventList store={store} where={where} /> : <Editor store={store} where={where} />
  else if (session.status === 'signed-out')
    body = (
      <div className="flex flex-col items-start gap-3">
        <Note>Sign in to open the team's Puzzle events.</Note>
        {session.options.google && <Btn variant="primary" onClick={() => void signInWithGoogle()}>Sign in with Google</Btn>}
        {session.options.devBypass && <Btn onClick={() => void devSignIn('ana@example.com')}>Development sign-in</Btn>}
      </div>
    )
  else if (!workspaceId) body = <Note tone="amber">You are not a member of a workspace yet.</Note>
  else if (!store.doc || !store.draft) body = <EventList store={store} where={where} />
  else body = <Editor store={store} where={where} />

  return (
    <div className="min-h-screen" data-testid="puzzle-page">
      <header className="sticky top-0 z-30 border-b border-white bg-white/80 shadow-sm shadow-purple-950/5 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1760px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-3">
          <div className="flex items-center gap-3">
            <Btn small variant="ghost" onClick={onHome}>
              <ArrowLeft size={14} /> Models
            </Btn>
            <div className="rounded-xl bg-gradient-to-br from-purple-600 to-fuchsia-500 p-2 text-white shadow-md shadow-purple-500/30">
              <PuzzleIcon size={20} strokeWidth={2.25} />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold leading-tight tracking-tight text-slate-900">Puzzle</h1>
              <p className="text-xs leading-tight text-slate-500" data-testid="puzzle-event-name">{store.draft ? store.draft.setup.name : 'Shared events'}</p>
            </div>
          </div>
          {store.doc && store.draft && <SaveBar store={store} />}
        </div>
      </header>
      <main className="mx-auto max-w-[1760px] px-6 py-5">{body}</main>
    </div>
  )
}

type Store = ReturnType<typeof usePuzzleEvents>

function SaveBar({ store }: { store: Store }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {store.dirty ? <Pill tone="amber">Unsaved changes</Pill> : <Pill tone="green">Saved · revision {store.doc!.revision}</Pill>}
      {store.status.kind === 'error' && <Pill tone="red">{store.status.message}</Pill>}
      <Btn small onClick={() => void store.clone()} testId="event-clone">Clone</Btn>
      <Btn small onClick={store.close} testId="event-list" title="Back to the list of events (unsaved edits are kept in this browser)">Events</Btn>
      <Btn small variant="primary" testId="event-save" disabled={!store.dirty || store.status.kind === 'saving'} onClick={() => void store.save()}>
        {store.status.kind === 'saving' ? 'Saving…' : 'Save'}
      </Btn>
    </div>
  )
}

function WhereNote({ where }: { where: 'server' | 'browser' }) {
  if (where === 'server') return null
  return (
    <p className="text-xs text-slate-500" data-testid="puzzle-where" data-note>
      Puzzle events are kept in this browser and shared with the team through{' '}
      <Link to="/browser-data" className="text-purple-700 underline">
        Team data
      </Link>{' '}
      once it is connected (the same as Chef, Diamond Mine and the Economy page).
    </p>
  )
}

function EventList({ store, where }: { store: Store; where: 'server' | 'browser' }) {
  return (
    <div className="flex max-w-3xl flex-col gap-3" data-testid="puzzle-events">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-slate-800">Puzzle events</h2>
        <Btn variant="primary" testId="event-new" onClick={() => void store.create()}>New event</Btn>
      </div>
      <WhereNote where={where} />
      {store.status.kind === 'error' && <Note tone="red">{store.status.message}</Note>}
      {store.list.length === 0 ? (
        <Note>No Puzzle event yet. A new event starts from the workbook's values (Disney Economy v1.5.75, copy for cc BF).</Note>
      ) : (
        <ul className="flex flex-col gap-2">
          {store.list.map((d) => (
            <li key={d.id}>
              <button type="button" data-testid="event-open" onClick={() => void store.open(d.id)} className="flex w-full items-center justify-between rounded-2xl border border-white bg-white/90 px-4 py-3 text-left shadow-sm ring-1 ring-slate-200/70 hover:ring-purple-300">
                <span className="font-semibold text-slate-800">{d.title}</span>
                <span className="text-xs text-slate-500">revision {d.revision} · {new Date(d.updatedAt).toLocaleString('en-GB')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Editor({ store, where }: { store: Store; where: 'server' | 'browser' }) {
  const ev = store.draft!
  const [tab, setTab] = useState<Tab>('build')
  const [step, setStep] = useState<StepId>('setup')
  const [phase, setPhase] = useState<Phase>('regular')
  const [segs, setSegs] = useState({ regular: 1, rc: 1 })
  const [sim, setSim] = useState(false)
  const [wide, setWide] = useState(false)
  const results = useMemo(() => computeAll(ev), [ev])
  const edit = useCallback(
    (fn: (e: PuzzleEvent) => void) =>
      store.setDraft((cur) => {
        const next = structuredClone(cur)
        fn(next)
        return next
      }),
    [store],
  )
  const ctx: PuzzleCtx = {
    ev,
    edit,
    results,
    phase,
    setPhase,
    segment: segs[phase],
    setSegment: (s) => setSegs((x) => ({ ...x, [phase]: s })),
    docId: store.doc!.id,
    revision: store.doc!.revision,
    dirty: store.dirty,
    base: store.base,
    call: store.call,
    where,
  }
  const stepIndex = STEPS.findIndex((s) => s.id === step)
  const segCount = phase === 'regular' ? REGULAR_SEGMENTS : RC_SEGMENTS
  const blocks = results.problems.filter((p) => p.level === 'block').length
  return (
    <Ctx.Provider value={ctx}>
      {store.conflict && (
        <Note tone="red" testId="conflict">
          Revision {store.conflict.revision} of this event was saved after these edits were started (by someone else, or in another tab). Your edits are still here; nothing was saved over.{' '}
          <span className="ml-2 inline-flex gap-2">
            <Btn small variant="primary" testId="conflict-keep-mine" onClick={() => void store.keepMine()}>Save mine on top</Btn>
            <Btn small testId="conflict-take-theirs" onClick={store.takeTheirs}>Take theirs (drop mine)</Btn>
          </span>
        </Note>
      )}
      {!store.conflict && store.newer && (
        <Note tone="amber" testId="newer">
          Revision {store.newer.revision} was saved by someone else. Saving will ask which to keep.{' '}
          <Btn small onClick={store.takeTheirs}>Load it (drop mine)</Btn>
        </Note>
      )}
      <div className="mt-3 flex gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Choice
              testId="puzzle-tabs"
              ariaLabel="Puzzle tools"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'build', label: 'Build event' },
                { value: 'optimize', label: 'Optimize' },
                { value: 'cc', label: 'CC Presets' },
                { value: 'preview', label: 'Config preview' },
              ]}
            />
            <Btn small testId="simulator-open" onClick={() => setSim((s) => !s)}>{sim ? 'Hide simulator' : 'Player simulator'}</Btn>
          </div>
          {tab === 'build' && (
            <div className="mt-3 rounded-3xl border border-white bg-white/85 px-5 py-3 shadow-sm">
              <ol className="flex flex-wrap gap-1.5" aria-label="Build event steps">
                {STEPS.map((s, i) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      data-step={s.id}
                      aria-current={s.id === step ? 'step' : undefined}
                      onClick={() => {
                        setStep(s.id)
                        window.scrollTo({ top: 0 })
                      }}
                      className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${s.id === step ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${s.id === step ? 'bg-white/25 text-white' : 'bg-white text-slate-500'}`}>{i + 1}</span>
                      {s.label}
                      {s.id === 'review' && blocks > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[10px] text-white">{blocks}</span>}
                    </button>
                  </li>
                ))}
              </ol>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-600" data-testid="step-purpose">
                  <span className="font-semibold text-slate-800">Step {stepIndex + 1} of {STEPS.length}:</span> {STEPS[stepIndex]!.purpose}
                </p>
                <div className="flex flex-wrap items-center gap-2" data-testid="scope">
                  <Choice testId="phase" ariaLabel="Phase" value={phase} onChange={setPhase} options={[{ value: 'regular', label: 'Regular' }, { value: 'rc', label: 'RC' }]} />
                  <label className="flex items-center gap-1 text-xs text-slate-600">
                    {phase === 'regular' ? 'Segment' : 'RC segment'}
                    <select data-testid="segment" className="rounded-lg border border-slate-200 px-2 py-1 text-sm" value={segs[phase]} onChange={(e) => setSegs((x) => ({ ...x, [phase]: Number(e.target.value) }))}>
                      {Array.from({ length: segCount }, (_, i) => (
                        <option key={i} value={i + 1}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="text-[11px] text-slate-400">all {segCount} are calculated</span>
                </div>
              </div>
            </div>
          )}
          <div className="mt-4">
            {tab === 'build' && step === 'setup' && <StepSetup />}
            {tab === 'build' && step === 'economy' && <StepEconomy />}
            {tab === 'build' && step === 'rewards' && <StepRewards />}
            {tab === 'build' && step === 'mechanics' && <StepMechanics />}
            {tab === 'build' && step === 'review' && <StepReview />}
            {tab === 'optimize' && <Optimize />}
            {tab === 'cc' && <CcPresets />}
            {tab === 'preview' && <ConfigPreview />}
          </div>
        </div>
        {sim && (
          <div className="sticky top-20 h-[calc(100vh-6rem)] shrink-0">
            <SimulatorPanel onClose={() => setSim(false)} wide={wide} onWide={() => setWide((w) => !w)} />
          </div>
        )}
      </div>
    </Ctx.Provider>
  )
}
