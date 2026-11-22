import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ChefHat, ChevronDown, Copy, Download, Plus, Save, Trash2, Upload } from 'lucide-react'
import Button from '../../../components/ui/Button'
import EventStep from './EventStep'
import DishesStep from './DishesStep'
import BasketsStep from './BasketsStep'
import SimulateStep from './SimulateStep'
import ValueStep from './ValueStep'
import { StepFindings } from './chefUi'
import * as halloweenChefData from '../data/halloweenChefData'
import * as thanksgivingChefData from '../data/thanksgivingChefData'
import { loadChefLibrary, saveChefLibrary, createConfigEntry, parseImportedLibrary } from '../lib/chefPersistence'
import { CHEST_TYPES, createGrant, createIngredient, createDish, createBasket, createSegment, createCalendar, createPhase, removeIngredientEverywhere } from '../lib/chefModel'
import { validateChefConfig } from '../lib/chefValidation'

// THE CHEF FLOW. The same logic as the Merge "Build event" flow (economist:
// "apply the logic of how we build the merge also to the chef. the flow and
// etc."): five steps in the order the work is done, each saying what it is
// for; a step shows what has to be typed or judged and folds the rest; what
// is wrong is shown in the step that puts it right, never folded; results
// lead, with their detail one click away; the rarely used actions sit in one
// "More" menu; "Next" opens the next step at its top.
//
//   1 event      when it runs, its phases, the segments and their baskets a day
//   2 dishes     the ingredients, each dish's recipe and prize
//   3 baskets    what a basket gives in each phase; sales and events
//   4 simulate   the event played by many players: who cooks what, and when
//   5 value      what a basket is worth to a player
//
// Before this the feature was nine flat tabs (Ingredients, Dishes, Baskets,
// Calendar, Segments, Blocker sources, Validation, Simulation, Basket
// value). Nothing was taken away: every one of them is in a step - the
// checks of "Validation" are shown in the step each belongs to and listed
// whole in step 4, "Blocker sources" is a fold of step 3.
const STEPS = [
  { id: 'event', label: 'Event and players', purpose: 'when the event runs, the phases it is cut into, and how many baskets a day each segment opens' },
  { id: 'dishes', label: 'Ingredients and dishes', purpose: 'what players collect, and what they cook with it' },
  { id: 'baskets', label: 'Baskets', purpose: 'what a basket gives in each phase, and what is handed out besides' },
  { id: 'simulate', label: 'Simulate', purpose: 'the event played by many players: who cooks what, and when' },
  { id: 'value', label: 'Basket value', purpose: 'what a basket is worth to a player' },
]
const STEP_LABELS = Object.fromEntries(STEPS.map((s, i) => [s.id, `Step ${i + 1}`]))

// `totalChefPrize` travels WITH each chef's own state rather than being read
// from one module-level import (it was a bare Halloween constant once, never
// part of the saved state, which only showed when a second chef was added).
function seedChefState(mod) {
  return {
    ingredients: mod.INGREDIENTS,
    dishes: mod.DISHES,
    recompletionDishes: mod.RECOMPLETION_DISHES,
    recompletionCaps: mod.RECOMPLETION_INGREDIENT_CAPS,
    baskets: mod.BASKETS,
    calendar: mod.CALENDAR,
    segments: mod.SEGMENTS,
    totalChefPrize: mod.TOTAL_CHEF_PRIZE,
    grants: [],
  }
}

function blankChefState() {
  return {
    ingredients: [],
    dishes: [],
    recompletionDishes: [],
    recompletionCaps: {},
    baskets: [],
    calendar: createCalendar({ startDate: null, totalDays: 7, phases: [{ id: 'phase1', label: 'Phase 1', days: 7 }] }),
    segments: [],
    totalChefPrize: { low: 0, medium: 0, high: 0 },
    grants: [],
  }
}

// Every real chef this app has been given, to start a new one from
// (economist: "i inserted chef thanksgiving into the repo... let's create
// the new chef in the app"). A future chef is added the same way once its
// data has been transcribed into its own `data/*.js` module.
const TEMPLATES = [
  { id: 'halloween', name: 'Halloween chef', mod: halloweenChefData },
  { id: 'thanksgiving', name: 'Thanksgiving chef', mod: thanksgivingChefData },
]

// A LIBRARY of chefs, not one (economist: "multiple saved event configs...
// so the next event's design doesn't overwrite this one"). With nothing
// saved it starts as one chef made from the Halloween data.
function initialLibrary() {
  const persisted = loadChefLibrary()
  if (persisted?.configs?.length) return persisted
  const entry = createConfigEntry('Halloween chef', seedChefState(halloweenChefData))
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
  const { ingredients, dishes, recompletionDishes, recompletionCaps, baskets, calendar, segments, grants } = state
  // A save from before totalChefPrize became part of a chef's own state has
  // none: the Halloween values stand in rather than crash what reads it.
  const totalChefPrize = state.totalChefPrize ?? halloweenChefData.TOTAL_CHEF_PRIZE
  const configKey = useMemo(() => JSON.stringify(state), [state])
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
  function setField(field) {
    return (updater) => updateActiveState((s) => ({ ...s, [field]: typeof updater === 'function' ? updater(s[field]) : updater }))
  }
  const setIngredients = setField('ingredients')
  const setDishes = setField('dishes')
  const setRecompletionDishes = setField('recompletionDishes')
  const setBaskets = setField('baskets')
  const setCalendar = setField('calendar')
  const setSegments = setField('segments')
  const setGrants = setField('grants')
  const setRecompletionCaps = setField('recompletionCaps')

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
    const name = template ? template.name : `New chef ${library.configs.length + 1}`
    const entry = createConfigEntry(name, template ? seedChefState(template.mod) : blankChefState())
    setLibrary((lib) => ({ ...lib, configs: [...lib.configs, entry], activeConfigId: entry.id }))
    setStep('event')
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
  function handleExportBackup() {
    const blob = new Blob([JSON.stringify(library, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chef-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
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

  // --- Ingredients ---
  const updateIngredient = (id, patch) => setIngredients((prev) => prev.map((ing) => (ing.id === id ? { ...ing, ...patch } : ing)))
  const addIngredient = () => setIngredients((prev) => [...prev, createIngredient({ name: `Ingredient ${prev.length + 1}` })])
  function duplicateIngredient(id) {
    const ing = ingredients.find((i) => i.id === id)
    if (ing) setIngredients((prev) => [...prev, createIngredient({ ...ing, id: undefined, name: `${ing.name} copy` })])
  }
  // (Goes out of every recipe, basket and sale with it: removeIngredientEverywhere.)
  function removeIngredient(id) {
    updateActiveState((s) => {
      const cascaded = removeIngredientEverywhere(id, { dishes: s.dishes, recompletionDishes: s.recompletionDishes, baskets: s.baskets, grants: s.grants ?? [] })
      return { ...s, ingredients: s.ingredients.filter((i) => i.id !== id), ...cascaded }
    })
  }

  // --- Dishes (the two lists) ---
  const dishSetter = (list) => (list === 'main' ? setDishes : setRecompletionDishes)
  const updateDish = (id, patch, list = 'main') => dishSetter(list)((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  const addDish = (list = 'main') => dishSetter(list)((prev) => [...prev, createDish({ name: `Dish ${prev.length + 1}` })])
  function duplicateDish(id, list = 'main') {
    const source = (list === 'main' ? dishes : recompletionDishes).find((d) => d.id === id)
    if (source) dishSetter(list)((prev) => [...prev, createDish({ ...source, id: undefined, recipe: source.recipe.map((r) => ({ ...r })), name: `${source.name} copy` })])
  }
  const removeDish = (id, list = 'main') => dishSetter(list)((prev) => prev.filter((d) => d.id !== id))
  const updateRecompletionCap = (ingredientId, value) => setRecompletionCaps((prev) => ({ ...prev, [ingredientId]: value }))
  const updateTotalPrize = (tier, value) => updateActiveState((s) => ({ ...s, totalChefPrize: { ...(s.totalChefPrize ?? halloweenChefData.TOTAL_CHEF_PRIZE), [tier]: value } }))

  // --- Segments ---
  const updateSegment = (id, patch) => setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const addSegment = () => setSegments((prev) => [...prev, createSegment({ name: `Segment ${prev.length + 1}` })])
  function duplicateSegment(id) {
    const seg = segments.find((s) => s.id === id)
    if (seg) setSegments((prev) => [...prev, createSegment({ ...seg, id: undefined, avgBasketsPerDay: { ...seg.avgBasketsPerDay }, name: `${seg.name} copy` })])
  }
  const removeSegment = (id) => setSegments((prev) => prev.filter((s) => s.id !== id))

  // --- Baskets ---
  const updateBasket = (id, patch) => setBaskets((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  // A new basket goes to the phase in view, as the first type that phase has none of.
  function addBasket(phaseId = calendar.phases[0]?.id ?? null) {
    setBaskets((prev) => {
      const taken = new Set(prev.filter((b) => b.phaseId === phaseId).map((b) => b.chestType))
      const chestType = CHEST_TYPES.find((t) => !taken.has(t)) ?? 'basic'
      return [...prev, createBasket({ chestType, phaseId, totalMin: 1, totalMax: 1, ingredientWeights: ingredients.map((i) => ({ ingredientId: i.id, min: 0, max: 1, weight: 0 })) })]
    })
  }
  function duplicateBasket(id) {
    const basket = baskets.find((b) => b.id === id)
    if (basket) setBaskets((prev) => [...prev, createBasket({ ...JSON.parse(JSON.stringify(basket)), id: undefined })])
  }
  const removeBasket = (id) => setBaskets((prev) => prev.filter((b) => b.id !== id))

  // --- Calendar ---
  const updateCalendarPhase = (id, patch) => setCalendar((prev) => ({ ...prev, phases: prev.phases.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  const updateCalendarStartDate = (startDate) => setCalendar((prev) => ({ ...prev, startDate }))
  const updateCalendarTotalDays = (totalDays) => setCalendar((prev) => ({ ...prev, totalDays }))
  function addPhase() {
    setCalendar((prev) => {
      const ids = new Set(prev.phases.map((p) => p.id))
      let n = prev.phases.length + 1
      while (ids.has(`phase${n}`)) n += 1
      return { ...prev, phases: [...prev.phases, createPhase({ id: `phase${n}`, label: `Phase ${n}`, days: 1 })] }
    })
  }
  // (Its baskets go with it: a basket of no phase is never opened by anyone.)
  function removePhase(id) {
    updateActiveState((s) => ({ ...s, calendar: { ...s.calendar, phases: s.calendar.phases.filter((p) => p.id !== id) }, baskets: s.baskets.filter((b) => b.phaseId !== id) }))
  }

  // --- Sales and events ---
  const addGrant = () => setGrants((prev) => [...(prev ?? []), createGrant({ day: 1, ingredientId: ingredients[0]?.id, amount: 0 })])
  const updateGrant = (id, patch) => setGrants((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)))
  const removeGrant = (id) => setGrants((prev) => prev.filter((g) => g.id !== id))

  const safeGrants = grants ?? []
  const findings = useMemo(
    () => validateChefConfig({ ingredients, dishes, recompletionDishes, baskets, calendar, segments, grants: safeGrants }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ingredients, dishes, recompletionDishes, baskets, calendar, segments, grants],
  )
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
                <MenuItem icon={Copy} onClick={fromMenu(handleDuplicateConfig)}>
                  Duplicate this chef
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
        {step !== 'simulate' && step !== 'value' && <StepFindings findings={findingsOf(step)} />}

        {step === 'event' && (
          <EventStep
            key={activeConfig.id}
            calendar={calendar}
            segments={segments}
            onUpdateStartDate={updateCalendarStartDate}
            onUpdateTotalDays={updateCalendarTotalDays}
            onUpdatePhase={updateCalendarPhase}
            onAddPhase={addPhase}
            onRemovePhase={removePhase}
            onUpdateSegment={updateSegment}
            onAddSegment={addSegment}
            onDuplicateSegment={duplicateSegment}
            onRemoveSegment={removeSegment}
          />
        )}
        {step === 'dishes' && (
          <DishesStep
            key={activeConfig.id}
            ingredients={ingredients}
            dishes={dishes}
            recompletionDishes={recompletionDishes}
            recompletionCaps={recompletionCaps ?? {}}
            totalChefPrize={totalChefPrize}
            onUpdateIngredient={updateIngredient}
            onAddIngredient={addIngredient}
            onDuplicateIngredient={duplicateIngredient}
            onRemoveIngredient={removeIngredient}
            onUpdateDish={updateDish}
            onAddDish={addDish}
            onDuplicateDish={duplicateDish}
            onRemoveDish={removeDish}
            onUpdateRecompletionCap={updateRecompletionCap}
            onUpdateTotalPrize={updateTotalPrize}
          />
        )}
        {step === 'baskets' && (
          <BasketsStep
            key={activeConfig.id}
            ingredients={ingredients}
            baskets={baskets}
            calendar={calendar}
            grants={safeGrants}
            findings={findingsOf('baskets')}
            onUpdateBasket={updateBasket}
            onAddBasket={addBasket}
            onDuplicateBasket={duplicateBasket}
            onRemoveBasket={removeBasket}
            onAddGrant={addGrant}
            onUpdateGrant={updateGrant}
            onRemoveGrant={removeGrant}
          />
        )}
        {step === 'simulate' && (
          <SimulateStep
            key={activeConfig.id}
            segments={segments}
            dishes={dishes}
            recompletionDishes={recompletionDishes}
            baskets={baskets}
            calendar={calendar}
            grants={safeGrants}
            ingredients={ingredients}
            totalChefPrize={totalChefPrize}
            findings={findings}
            stepLabels={STEP_LABELS}
            configKey={configKey}
            sim={sims[activeConfig.id] ?? null}
            onSim={(run) => setSims((prev) => ({ ...prev, [activeConfig.id]: run }))}
            onGoTo={setStep}
          />
        )}
        {step === 'value' && (
          <ValueStep key={activeConfig.id} dishes={dishes} recompletionDishes={recompletionDishes} baskets={baskets} calendar={calendar} totalChefPrize={totalChefPrize} ingredients={ingredients} segments={segments} grants={safeGrants} />
        )}

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
