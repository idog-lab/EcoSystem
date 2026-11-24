import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ChefHat, ChevronDown, ClipboardCheck, Copy, Download, FlaskConical, History, Plus, Save, Trash2, Upload } from 'lucide-react'
import Button from '../../../components/ui/Button'
import EventStep from './EventStep'
import DishesStep from './DishesStep'
import BasketsStep from './BasketsStep'
import ProposalStep from './ProposalStep'
import SimulateStep from './SimulateStep'
import ValueStep from './ValueStep'
import ReadinessPanel from './ReadinessPanel'
import { StepFindings } from './chefUi'
import { syntheticExampleState, SYNTHETIC_NAME, SYNTHETIC_NOTE } from '../data/syntheticExample'
import * as halloweenChefData from '../data/halloweenChefData'
import * as thanksgivingChefData from '../data/thanksgivingChefData'
import { BLACK_FRIDAY_NAME, blackFridayChefState } from '../data/blackFridayChefData'
import { loadChefLibrary, saveChefLibrary, createConfigEntry, parseImportedLibrary } from '../lib/chefPersistence'
import { blankChefState } from '../lib/chefModel'
import { chefFromSource } from '../lib/chefMigration'
import { fingerprint } from '../lib/chefEngine'
import { validateChefConfig } from '../lib/chefValidation'

// THE CHEF FLOW. The same logic as the Merge "Build event" flow (economist:
// "apply the logic of how we build the merge also to the chef. the flow and
// etc."): six steps in the order the work is done, each saying what it is
// for; a step shows what has to be typed or judged and folds the rest; what
// is wrong is shown in the step that puts it right, never folded; results
// lead, with their detail one click away; the rarely used actions sit in one
// "More" menu; "Next" opens the next step at its top.
//
//   1 event      when it runs, its targets, the segments and their basket supply
//   2 dishes     the ingredients and their pantry caps, the recipes, the prizes
//   3 baskets    what a basket gives; progression thresholds, special sources
//                and jokers, catch-up presets
//   4 proposal   (build 02) what may change, a generated proposal beside the
//                current event, and applying it or not
//   5 simulate   the event played by many players, against its targets
//   6 value      one more basket, played; and the older basket estimate
//
// THE REBUILD (build 01). The steps are the same five; what they hold is the
// rebuilt event model (chefModel.js) played by one rule engine
// (chefEngine.js). A step gets the whole chef (`state`) and one way to change
// it (`update`), and makes its own edits.
//
// Before this the feature was nine flat tabs (Ingredients, Dishes, Baskets,
// Calendar, Segments, Blocker sources, Validation, Simulation, Basket
// value). Nothing was taken away: every one of them is in a step - the
// checks of "Validation" are shown in the step each belongs to and listed
// whole in step 5, "Blocker sources" is a fold of step 3.
const STEPS = [
  { id: 'event', label: 'Event and players', purpose: 'when the event runs, what it aims at, and what each segment opens' },
  { id: 'dishes', label: 'Ingredients and dishes', purpose: 'what players collect, what they cook with it, and what a dish pays' },
  { id: 'baskets', label: 'Baskets', purpose: 'what a basket gives, what holds an ingredient back, and what is handed out besides' },
  { id: 'proposal', label: 'Proposal', purpose: 'recipes, basket weights and thresholds, or catch-up presets, that bring every segment closer to the targets - to review, then apply or not' },
  { id: 'simulate', label: 'Simulate', purpose: 'the event played by many players, against its targets' },
  { id: 'value', label: 'Basket value', purpose: 'what one more basket changes for a player' },
]
const STEP_LABELS = Object.fromEntries(STEPS.map((s, i) => [s.id, `Step ${i + 1}`]))

// Every real chef this app has been given, to start a new one from
// (economist: "i inserted chef thanksgiving into the repo... let's create
// the new chef in the app"). A future chef is added the same way once its
// data has been transcribed into its own `data/*.js` module.
const TEMPLATES = [
  { id: 'halloween', name: 'Halloween chef', mod: halloweenChefData },
  { id: 'thanksgiving', name: 'Thanksgiving chef', mod: thanksgivingChefData },
  // (Read straight into the rebuilt model from the economist's workbook: `make` instead of an older data module.)
  { id: 'black-friday', name: BLACK_FRIDAY_NAME, make: blackFridayChefState },
]

// A LIBRARY of chefs, not one (economist: "multiple saved event configs...
// so the next event's design doesn't overwrite this one"). With nothing
// saved it starts as one chef made from the Halloween data.
function initialLibrary() {
  const persisted = loadChefLibrary()
  if (persisted?.configs?.length) return persisted
  const entry = createConfigEntry('Halloween chef', chefFromSource(halloweenChefData))
  return { configs: [entry], activeConfigId: entry.id }
}
// What "saved" compares: every chef's name and content (not which one is open, not when it was saved).
const contentOf = (library) => JSON.stringify(library.configs.map((c) => [c.id, c.name, c.state]))

function MenuItem({ icon: Icon, children, ...props }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-purple-50 hover:text-purple-800 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-700"
      {...props}
    >
      {Icon && <Icon size={14} className="shrink-0 text-slate-400" />}
      {children}
    </button>
  )
}

export default function ChefApp({ onHome }) {
  const [step, setStep] = useState('event')
  const [library, setLibrary] = useState(initialLibrary)
  const [baseline, setBaseline] = useState(() => contentOf(library))
  const [savedAt, setSavedAt] = useState(null)
  const [importError, setImportError] = useState(null)
  const [moreOpen, setMoreOpen] = useState(false)
  // The last simulation of each chef, with a fingerprint of the chef it was
  // played on (SimulateStep marks it out of date once the chef has changed).
  const [sims, setSims] = useState({})
  const fileInputRef = useRef(null)
  const moreRef = useRef(null)

  const activeConfig = library.configs.find((c) => c.id === library.activeConfigId) ?? library.configs[0]
  const state = activeConfig.state
  // What a run was played on: a short fingerprint of the chef.
  const configKey = useMemo(() => fingerprint(state), [state])
  const unsaved = useMemo(() => contentOf(library) !== baseline, [library, baseline])

  // A step opens at its top (economist, of the Merge flow: "it should take me
  // to the top part of the page and not make me scroll up").
  const openedStep = useRef(step)
  useEffect(() => {
    if (openedStep.current === step) return
    openedStep.current = step
    window.scrollTo({ top: 0 })
  }, [step])

  useEffect(() => {
    if (!moreOpen) return undefined
    const onDown = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setMoreOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])
  const fromMenu = (action) => () => {
    setMoreOpen(false)
    action()
  }

  // Every edit goes through this one updater - the only place that knows how
  // an edit reaches the open chef inside the library.
  function updateActiveState(updater) {
    setLibrary((lib) => ({
      ...lib,
      configs: lib.configs.map((c) => (c.id === lib.activeConfigId ? { ...c, state: typeof updater === 'function' ? updater(c.state) : updater } : c)),
    }))
  }

  function handleSave() {
    const next = { ...library, configs: library.configs.map((c) => (c.id === library.activeConfigId ? { ...c, updatedAt: new Date().toISOString() } : c)) }
    saveChefLibrary(next)
    setLibrary(next)
    setBaseline(contentOf(next))
    setSavedAt(new Date())
  }

  // --- The library of chefs ---
  function handleNewConfig(templateId) {
    const template = TEMPLATES.find((t) => t.id === templateId)
    const synthetic = templateId === 'synthetic'
    const name = synthetic ? SYNTHETIC_NAME : template ? template.name : `New chef ${library.configs.length + 1}`
    const entry = createConfigEntry(name, synthetic ? syntheticExampleState() : template ? (template.make ? template.make() : chefFromSource(template.mod)) : blankChefState())
    setLibrary((lib) => ({ ...lib, configs: [...lib.configs, entry], activeConfigId: entry.id }))
    setStep('event')
  }
  // A REFERENCE CHEF: a separate copy of the chef in view, to be completed into
  // the intended event. The chef it is made from is not touched (nor is the
  // older chef kept beside it), nothing is filled in, and nothing in the copy
  // starts as confirmed: the list of what it still needs opens with it.
  function handleStartReference() {
    const copy = JSON.parse(JSON.stringify(activeConfig.state))
    const entry = createConfigEntry(`Reference: ${activeConfig.name}`, { ...copy, reference: { basedOn: activeConfig.name, startedAt: new Date().toISOString() }, confirmed: {}, migration: copy.migration ? { ...copy.migration, dismissed: true } : null })
    setLibrary((lib) => ({ ...lib, configs: [...lib.configs, entry], activeConfigId: entry.id }))
    goTo('event', 'chef-readiness')
  }
  // To a step, and to the section of it where an input is typed.
  function goTo(id, foldId = null) {
    setStep(id)
    if (!foldId) return
    setTimeout(() => {
      const el = document.querySelector(`[data-collapsible="${foldId}"]`)
      if (!el) return
      el.open = true
      el.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, 80)
  }
  function handleDuplicateConfig() {
    const entry = createConfigEntry(`${activeConfig.name} copy`, JSON.parse(JSON.stringify(activeConfig.state)))
    setLibrary((lib) => ({ ...lib, configs: [...lib.configs, entry], activeConfigId: entry.id }))
  }
  function handleRenameConfig(name) {
    setLibrary((lib) => ({ ...lib, configs: lib.configs.map((c) => (c.id === lib.activeConfigId ? { ...c, name } : c)) }))
  }
  function handleSwitchConfig(id) {
    setLibrary((lib) => ({ ...lib, activeConfigId: id }))
  }
  // Deleting a whole chef takes the work of every step with it, so it is the
  // one delete in the feature that asks first.
  function handleDeleteConfig() {
    if (library.configs.length <= 1) return
    if (!window.confirm(`Delete "${activeConfig.name}"? This can't be undone.`)) return
    setLibrary((lib) => {
      const configs = lib.configs.filter((c) => c.id !== activeConfig.id)
      return { ...lib, configs, activeConfigId: configs[0].id }
    })
  }
  function download(content, fileName) {
    const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
  }
  const handleExportBackup = () => download(library, `chef-backup-${new Date().toISOString().slice(0, 10)}.json`)
  // The chef as it was before the rebuild, in the older tool's shape: the file opens here again (and is brought up to date again).
  const handleExportLegacy = () => activeConfig.legacy && download(activeConfig.legacy.state, `chef-as-it-was-${activeConfig.name.replace(/[^\w]+/g, ' ').trim().replace(/\s+/g, '-') || 'chef'}.json`)
  const dismissMigration = () => updateActiveState((st) => ({ ...st, migration: { ...st.migration, dismissed: true } }))
  function handleImportFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseImportedLibrary(String(reader.result))
      if (!parsed) {
        setImportError('That file is not a Chef backup. Nothing was changed.')
        return
      }
      setImportError(null)
      setLibrary(parsed)
      saveChefLibrary(parsed)
      setBaseline(contentOf(parsed))
      setSims({})
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const findings = useMemo(() => validateChefConfig(state), [state])
  const findingsOf = (id) => findings.filter((f) => f.step === id)
  const stepIndex = STEPS.findIndex((s) => s.id === step)
  const current = STEPS[stepIndex]
  const previous = STEPS[stepIndex - 1]
  const next = STEPS[stepIndex + 1]

  return (
    <div className="min-h-screen chef-app">
      <div className="app-backdrop" aria-hidden="true" />
      <header className="mx-auto flex max-w-[1760px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 pb-2 pt-4" data-testid="chef-header">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <button type="button" onClick={onHome} aria-label="Back to the features" title="Back to the features" className="grid h-9 w-9 place-items-center rounded-xl border border-white bg-white/80 text-slate-500 ring-1 ring-slate-200/70 transition-colors hover:text-purple-600">
            <ArrowLeft size={16} />
          </button>
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-purple-600 to-fuchsia-500 text-white shadow-md shadow-purple-500/30">
            <ChefHat size={18} strokeWidth={2.25} />
          </span>
          <h1 className="font-display text-xl font-bold tracking-tight text-slate-900">Chef</h1>
          {library.configs.length > 1 && (
            <select value={activeConfig.id} aria-label="The chef in view" data-testid="chef-picker" onChange={(e) => handleSwitchConfig(e.target.value)} className="rounded-lg border border-slate-200 bg-white/90 px-2 py-1.5 text-sm font-semibold text-slate-700">
              {library.configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <input
            value={activeConfig.name}
            aria-label="Name of this chef"
            data-testid="chef-name"
            onChange={(e) => handleRenameConfig(e.target.value)}
            className="w-56 min-w-0 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-semibold text-slate-700 hover:border-slate-200 focus:border-purple-300 focus:bg-white/80 focus:outline-none"
            placeholder="Name of this chef"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-medium ${unsaved ? 'text-amber-700' : 'text-slate-400'}`} data-testid="chef-save-state">
            {unsaved ? 'Unsaved changes' : savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : 'Saved'}
          </span>
          <div className="relative" ref={moreRef}>
            <Button variant="secondary" onClick={() => setMoreOpen((open) => !open)} aria-haspopup="menu" aria-expanded={moreOpen} data-testid="chef-more">
              More <ChevronDown size={14} />
            </Button>
            {moreOpen && (
              <div role="menu" data-testid="chef-more-panel" className="absolute right-0 z-30 mt-2 w-max min-w-[15rem] rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-purple-950/10">
                <MenuItem icon={Plus} onClick={fromMenu(() => handleNewConfig('blank'))}>
                  New chef: blank
                </MenuItem>
                {TEMPLATES.map((t) => (
                  <MenuItem key={t.id} icon={Plus} onClick={fromMenu(() => handleNewConfig(t.id))}>
                    New chef: from the {t.name}
                  </MenuItem>
                ))}
                <MenuItem icon={FlaskConical} onClick={fromMenu(() => handleNewConfig('synthetic'))} title="The Halloween chef with made-up thresholds, dates, Recompletion dishes and prizes, to try the whole flow. Not an approved economy." data-testid="chef-new-synthetic">
                  New chef: a synthetic example (made up)
                </MenuItem>
                <MenuItem icon={Copy} onClick={fromMenu(handleDuplicateConfig)}>
                  Duplicate this chef
                </MenuItem>
                <MenuItem
                  icon={ClipboardCheck}
                  onClick={fromMenu(handleStartReference)}
                  disabled={!!state.synthetic || !!state.reference}
                  title={state.synthetic ? 'A synthetic example is made up: a reference chef is started from a real one.' : state.reference ? 'This chef is already a reference chef.' : 'A separate copy of this chef to complete into the intended event. This chef stays as it is.'}
                  data-testid="chef-start-reference"
                >
                  Start a reference chef from this one
                </MenuItem>
                <MenuItem icon={Trash2} onClick={fromMenu(handleDeleteConfig)} disabled={library.configs.length <= 1} title={library.configs.length <= 1 ? 'The only chef cannot be deleted.' : undefined}>
                  Delete this chef
                </MenuItem>
                <div className="my-1 border-t border-slate-100" />
                <MenuItem icon={Download} onClick={fromMenu(handleExportBackup)} title="One file with every chef saved here.">
                  Export backup
                </MenuItem>
                <MenuItem icon={Upload} onClick={fromMenu(() => fileInputRef.current?.click())} title="Replaces every chef here with the ones in the file.">
                  Import backup
                </MenuItem>
                {activeConfig.legacy && (
                  <MenuItem icon={History} onClick={fromMenu(handleExportLegacy)} title="This chef was made with the older tool. The chef exactly as it was is kept, and this downloads it." data-testid="chef-legacy-download">
                    Download this chef as it was
                  </MenuItem>
                )}
              </div>
            )}
          </div>
          <Button variant="dark" icon={Save} onClick={handleSave} data-testid="chef-save">
            Save
          </Button>
          <input ref={fileInputRef} type="file" accept="application/json" onChange={handleImportFile} className="hidden" data-testid="chef-import-file" />
        </div>
      </header>

      {importError && (
        <div className="mx-auto max-w-[1760px] px-6 pb-2">
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="chef-import-error">
            {importError}
          </p>
        </div>
      )}

      <nav className="mx-auto max-w-[1760px] px-6 pb-3" aria-label="Steps">
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((s, i) => {
            const blocks = findingsOf(s.id).filter((f) => f.severity === 'block').length
            const looks = findingsOf(s.id).filter((f) => f.severity === 'review').length
            const active = s.id === step
            return (
              <li key={s.id}>
                <button
                  type="button"
                  data-chef-step={s.id}
                  aria-current={active ? 'step' : undefined}
                  onClick={() => setStep(s.id)}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors ${active ? 'bg-gradient-to-r from-purple-600 to-fuchsia-500 text-white shadow-md shadow-purple-500/30' : 'bg-white/70 text-slate-600 hover:bg-white'}`}
                >
                  <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${active ? 'bg-white/25 text-white' : 'bg-slate-200/80 text-slate-600'}`}>{i + 1}</span>
                  {s.label}
                  {blocks > 0 && (
                    <span className="grid h-[1.1rem] min-w-[1.1rem] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white" data-step-blocks title={`${blocks} to fix in this step`}>
                      {blocks}
                    </span>
                  )}
                  {blocks === 0 && looks > 0 && <span className="h-2 w-2 rounded-full bg-amber-400" data-step-looks title={`${looks} worth a look in this step`} />}
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      <main className="mx-auto flex max-w-[1760px] flex-col gap-4 px-6 pb-12" data-chef-page={step}>
        <p className="text-sm text-slate-600" data-testid="chef-step-purpose">
          <span className="font-semibold text-slate-800">
            Step {stepIndex + 1} of {STEPS.length}
          </span>{' '}
          · {current.purpose}.
        </p>
        {state.migration?.notes?.length > 0 && !state.migration.dismissed && (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900" data-testid="chef-migration">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="font-semibold">{state.migration.fromWorkbook ? `This chef was read from ${state.migration.fromWorkbook}. Nothing was made up; what the workbook does not hold starts empty:` : 'This chef comes from before the rebuild. Nothing it held was dropped, and nothing it did not hold was made up:'}</p>
              <span className="flex shrink-0 items-center gap-3">
                {activeConfig.legacy && (
                  <button type="button" onClick={handleExportLegacy} className="whitespace-nowrap text-xs font-semibold underline decoration-dotted underline-offset-2">
                    Download it as it was
                  </button>
                )}
                <button type="button" onClick={dismissMigration} className="whitespace-nowrap rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-sky-800 ring-1 ring-sky-200" data-testid="chef-migration-dismiss">
                  Got it
                </button>
              </span>
            </div>
            <ul className="ml-4 mt-1.5 list-disc space-y-0.5 text-[13px]">
              {state.migration.notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </div>
        )}
        {state.synthetic && (
          <p className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50 px-4 py-2.5 text-sm text-fuchsia-900" data-testid="chef-synthetic">
            <span className="font-semibold">Made up.</span> {SYNTHETIC_NOTE}
          </p>
        )}
        {state.reference && (
          <p className="text-sm text-slate-600" data-testid="chef-reference">
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-800">Reference chef</span> A copy of "{state.reference.basedOn}", to complete into the intended event. The original is as it was.
          </p>
        )}
        {(state.reference || step === 'simulate') && <ReadinessPanel state={state} update={updateActiveState} onGoTo={goTo} stepLabels={STEP_LABELS} />}
        {step !== 'simulate' && step !== 'value' && step !== 'proposal' && <StepFindings findings={findingsOf(step)} />}

        {step === 'event' && <EventStep key={activeConfig.id} state={state} update={updateActiveState} />}
        {step === 'dishes' && <DishesStep key={activeConfig.id} state={state} update={updateActiveState} />}
        {step === 'baskets' && <BasketsStep key={activeConfig.id} state={state} update={updateActiveState} findings={findingsOf('baskets')} />}
        {step === 'proposal' && <ProposalStep key={activeConfig.id} state={state} update={updateActiveState} onGoTo={goTo} />}
        {step === 'simulate' && (
          <SimulateStep
            key={activeConfig.id}
            state={state}
            update={updateActiveState}
            findings={findings}
            stepLabels={STEP_LABELS}
            configKey={configKey}
            sim={sims[activeConfig.id] ?? null}
            onSim={(run) => setSims((prev) => ({ ...prev, [activeConfig.id]: run }))}
            onGoTo={goTo}
          />
        )}
        {step === 'value' && <ValueStep key={activeConfig.id} state={state} />}

        <div className="flex items-center justify-between gap-3 pt-2" data-testid="chef-step-nav">
          {previous ? (
            <Button variant="secondary" icon={ArrowLeft} onClick={() => setStep(previous.id)} data-testid="chef-back">
              {previous.label}
            </Button>
          ) : (
            <span />
          )}
          {next && (
            <Button variant="primary" onClick={() => setStep(next.id)} data-testid="chef-next">
              Next: {next.label} <ArrowRight size={16} />
            </Button>
          )}
        </div>
      </main>
    </div>
  )
}
