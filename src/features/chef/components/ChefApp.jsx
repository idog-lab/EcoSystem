import { useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChefHat,
  Carrot,
  UtensilsCrossed,
  Gift,
  CalendarDays,
  Users,
  TrendingUp,
  Coins,
  Save,
  ShieldAlert,
  ClipboardCheck,
  Plus,
  Copy,
  Trash2,
  Download,
  Upload,
} from 'lucide-react'
import Button from '../../../components/ui/Button'
import IngredientsTab from './IngredientsTab'
import DishesTab from './DishesTab'
import BasketsTab from './BasketsTab'
import CalendarTab from './CalendarTab'
import SegmentsTab from './SegmentsTab'
import SimulationTab from './SimulationTab'
import BasketValueTab from './BasketValueTab'
import BlockerSourcesTab from './BlockerSourcesTab'
import ValidationTab from './ValidationTab'
import * as halloweenChefData from '../data/halloweenChefData'
import * as thanksgivingChefData from '../data/thanksgivingChefData'
const { INGREDIENTS, DISHES, RECOMPLETION_DISHES, RECOMPLETION_INGREDIENT_CAPS, BASKETS, CALENDAR, SEGMENTS, TOTAL_CHEF_PRIZE } = halloweenChefData
import { loadChefLibrary, saveChefLibrary, createConfigEntry, parseImportedLibrary } from '../lib/chefPersistence'
import { createGrant, createIngredient, createDish, createBasket, createSegment, createCalendar, removeIngredientEverywhere } from '../lib/chefModel'
import { validateChefConfig } from '../lib/chefValidation'

const TABS = [
  { id: 'ingredients', label: 'Ingredients', icon: Carrot },
  { id: 'dishes', label: 'Dishes', icon: UtensilsCrossed },
  { id: 'baskets', label: 'Baskets', icon: Gift },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'segments', label: 'Segments', icon: Users },
  { id: 'blocker-sources', label: 'Blocker sources', icon: ShieldAlert },
  { id: 'validation', label: 'Validation', icon: ClipboardCheck },
  { id: 'simulation', label: 'Simulation', icon: TrendingUp },
  { id: 'basket-value', label: 'Basket value', icon: Coins },
]

// `totalChefPrize` now travels WITH each config's own state rather than
// being read from one hardcoded module-level import - a real latent bug
// this file's own original single-chef design had (Halloween's
// TOTAL_CHEF_PRIZE was imported as a bare constant, never part of the
// saved state at all), only exposed once a SECOND real chef with its own
// Prize_sheet became possible to add. The two happen to carry identical
// values today, which is exactly why this went unnoticed until now.
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

// Every real chef dataset this app has been given so far, selectable as a
// starting point for a new config - by explicit economist request ("i
// inserted chef thanksgiving into the repo... let's create the new chef in
// the app"). Add a future chef here the same way once its own data has
// been transcribed into its own `src/features/chef/data/*.js` module.
const TEMPLATES = [
  { id: 'halloween', name: 'Halloween chef', mod: halloweenChefData },
  { id: 'thanksgiving', name: 'Thanksgiving chef', mod: thanksgivingChefData },
]

// A LIBRARY of chef configs, not just one - by explicit economist request
// ("multiple saved event configs... so the next event's design doesn't
// overwrite this one"), the top-ranked item from a GPT brainstorm review.
// Falls back to a single config seeded from the real Halloween data if
// nothing's ever been saved (see chefPersistence.js's migration note for
// how an OLDER, pre-library single-config save is handled).
function initialLibrary() {
  const persisted = loadChefLibrary()
  if (persisted?.configs?.length) return persisted
  const entry = createConfigEntry('Halloween chef', seedChefState(halloweenChefData))
  return { configs: [entry], activeConfigId: entry.id }
}

// Phase 1+ scope (per the economist's own stated priorities - see
// CLAUDE.md's Chef section): insert the real chef data, let it be
// viewed/edited/grown per-tab, the day-by-day completion simulator, the
// basket-value estimator, and (per a later GPT-brainstorm-review request)
// a "trustworthy-sim core" and a "reusable-configs core" - add/remove/
// duplicate for every entity list, multiple saved configs, and a portable
// backup file.
export default function ChefApp({ onHome }) {
  const [tab, setTab] = useState('ingredients')
  const [library, setLibrary] = useState(initialLibrary)
  const [savedAt, setSavedAt] = useState(null)
  const [importError, setImportError] = useState(null)
  const fileInputRef = useRef(null)

  const activeConfig = library.configs.find((c) => c.id === library.activeConfigId) ?? library.configs[0]
  const state = activeConfig.state
  const { ingredients, dishes, recompletionDishes, recompletionCaps, baskets, calendar, segments, grants } = state
  // A save from before totalChefPrize became part of a config's own state
  // (see seedChefState's doc comment) won't have this field yet - fall back
  // to the Halloween data's own value rather than crashing downstream.
  const totalChefPrize = state.totalChefPrize ?? TOTAL_CHEF_PRIZE

  // Every edit routes through this one updater - it's the only place that
  // knows HOW an edit reaches the active config inside the library array,
  // so every per-field setter below stays a simple, flat function.
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
    setLibrary((lib) => {
      const next = { ...lib, configs: lib.configs.map((c) => (c.id === lib.activeConfigId ? { ...c, updatedAt: new Date().toISOString() } : c)) }
      saveChefLibrary(next)
      return next
    })
    setSavedAt(new Date())
  }

  // --- Config library management ---
  // `templateId` of '' (the <select>'s own placeholder option) means a
  // genuinely blank config; any other value picks one of TEMPLATES' real
  // seed datasets as the new config's starting point.
  function handleNewConfig(templateId) {
    const template = TEMPLATES.find((t) => t.id === templateId)
    const name = template ? template.name : `New chef ${library.configs.length + 1}`
    const entry = createConfigEntry(name, template ? seedChefState(template.mod) : blankChefState())
    setLibrary((lib) => ({ ...lib, configs: [...lib.configs, entry], activeConfigId: entry.id }))
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

  // Deleting a whole saved config is meaningfully more destructive than
  // deleting one ingredient/dish/basket/segment (which stay no-confirm, per
  // this app's own established convention - see Diamond Mine's gem
  // deletion in CLAUDE.md) - real work across every tab can live in one
  // config, so this is the one delete in the feature that asks first.
  function handleDeleteConfig(id) {
    if (library.configs.length <= 1) return
    const target = library.configs.find((c) => c.id === id)
    if (!window.confirm(`Delete "${target?.name}"? This can't be undone.`)) return
    setLibrary((lib) => {
      const configs = lib.configs.filter((c) => c.id !== id)
      const activeConfigId = lib.activeConfigId === id ? configs[0].id : lib.activeConfigId
      return { ...lib, configs, activeConfigId }
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
        setImportError('That file doesn’t look like a Chef backup — nothing was changed.')
        return
      }
      setImportError(null)
      setLibrary(parsed)
      saveChefLibrary(parsed)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function updateIngredient(id, patch) {
    setIngredients((prev) => prev.map((ing) => (ing.id === id ? { ...ing, ...patch } : ing)))
  }

  function addIngredient() {
    setIngredients((prev) => [...prev, createIngredient({ name: `Ingredient ${prev.length + 1}` })])
  }

  function duplicateIngredient(id) {
    const ing = ingredients.find((i) => i.id === id)
    if (!ing) return
    setIngredients((prev) => [...prev, createIngredient({ ...ing, id: undefined, name: `${ing.name} copy` })])
  }

  function removeIngredient(id) {
    const cascaded = removeIngredientEverywhere(id, { dishes, recompletionDishes, baskets, grants })
    updateActiveState((s) => ({
      ...s,
      ingredients: s.ingredients.filter((i) => i.id !== id),
      dishes: cascaded.dishes,
      recompletionDishes: cascaded.recompletionDishes,
      baskets: cascaded.baskets,
      grants: cascaded.grants,
    }))
  }

  function updateDish(id, patch, list = 'main') {
    const setter = list === 'main' ? setDishes : setRecompletionDishes
    setter((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  function addDish(list = 'main') {
    const setter = list === 'main' ? setDishes : setRecompletionDishes
    setter((prev) => [...prev, createDish({ name: `Dish ${prev.length + 1}` })])
  }

  function duplicateDish(id, list = 'main') {
    const source = (list === 'main' ? dishes : recompletionDishes).find((d) => d.id === id)
    if (!source) return
    const setter = list === 'main' ? setDishes : setRecompletionDishes
    setter((prev) => [...prev, createDish({ ...source, id: undefined, name: `${source.name} copy` })])
  }

  function removeDish(id, list = 'main') {
    const setter = list === 'main' ? setDishes : setRecompletionDishes
    setter((prev) => prev.filter((d) => d.id !== id))
  }

  function updateSegment(id, patch) {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  function addSegment() {
    setSegments((prev) => [...prev, createSegment({ name: `Segment ${prev.length + 1}` })])
  }

  function duplicateSegment(id) {
    const seg = segments.find((s) => s.id === id)
    if (!seg) return
    setSegments((prev) => [...prev, createSegment({ ...seg, id: undefined, name: `${seg.name} copy` })])
  }

  function removeSegment(id) {
    setSegments((prev) => prev.filter((s) => s.id !== id))
  }

  function updateBasket(id, patch) {
    setBaskets((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }

  function addBasket() {
    const firstPhaseId = calendar.phases[0]?.id ?? null
    setBaskets((prev) => [
      ...prev,
      createBasket({ chestType: 'basic', phaseId: firstPhaseId, totalMin: 1, totalMax: 1, ingredientWeights: ingredients.map((i) => ({ ingredientId: i.id, min: 0, max: 1, weight: 0 })) }),
    ])
  }

  function duplicateBasket(id) {
    const basket = baskets.find((b) => b.id === id)
    if (!basket) return
    setBaskets((prev) => [...prev, createBasket({ ...basket, id: undefined })])
  }

  function removeBasket(id) {
    setBaskets((prev) => prev.filter((b) => b.id !== id))
  }

  function updateCalendarPhase(id, patch) {
    setCalendar((prev) => ({ ...prev, phases: prev.phases.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  }

  function updateCalendarStartDate(startDate) {
    setCalendar((prev) => ({ ...prev, startDate }))
  }

  function updateCalendarTotalDays(totalDays) {
    setCalendar((prev) => ({ ...prev, totalDays }))
  }

  function addGrant() {
    setGrants((prev) => [...prev, createGrant({ day: 1, ingredientId: ingredients[0]?.id, amount: 0 })])
  }

  function updateGrant(id, patch) {
    setGrants((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)))
  }

  function removeGrant(id) {
    setGrants((prev) => prev.filter((g) => g.id !== id))
  }

  function updateRecompletionCap(ingredientId, value) {
    setRecompletionCaps((prev) => ({ ...prev, [ingredientId]: value }))
  }

  const blockCount = useMemo(
    () => validateChefConfig({ ingredients, dishes, recompletionDishes, baskets, calendar, segments, grants }).filter((f) => f.severity === 'block').length,
    [ingredients, dishes, recompletionDishes, baskets, calendar, segments, grants]
  )

  return (
    <div className="min-h-screen">
      <div className="app-backdrop" aria-hidden="true" />
      <header className="max-w-6xl mx-auto px-6 pt-8 pb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onHome}
            className="grid place-items-center w-9 h-9 rounded-xl bg-white/80 border border-white ring-1 ring-slate-200/70 text-slate-500 hover:text-purple-600 transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-purple-600 to-fuchsia-500 text-white shadow-md shadow-purple-500/30">
            <ChefHat size={18} strokeWidth={2.25} />
          </span>
          <h1 className="font-display text-xl font-bold text-slate-900 tracking-tight">Chef</h1>
        </div>
        <div className="flex items-center gap-3">
          {savedAt && <span className="text-xs text-slate-400">Saved {savedAt.toLocaleTimeString()}</span>}
          <Button variant="dark" icon={Save} onClick={handleSave}>
            Save
          </Button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 mb-4 flex flex-wrap items-center gap-2 bg-white/70 border border-slate-200 rounded-2xl p-2.5">
        <select
          value={library.activeConfigId}
          onChange={(e) => handleSwitchConfig(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white/90 font-semibold text-slate-700"
        >
          {library.configs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          value={activeConfig.name}
          onChange={(e) => handleRenameConfig(e.target.value)}
          className="text-sm font-medium text-slate-600 bg-transparent border-b border-transparent focus:border-purple-300 focus:outline-none px-1 min-w-0 flex-1"
          placeholder="Config name"
        />
        <label className="flex items-center gap-1 text-xs font-semibold text-purple-600 px-2 py-1">
          <Plus size={13} />
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) handleNewConfig(e.target.value)
            }}
            className="bg-transparent focus:outline-none cursor-pointer"
            title="Start a new config — blank, or from a real chef dataset already in the app"
          >
            <option value="" disabled>
              New…
            </option>
            <option value="blank">Blank</option>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                From: {t.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={handleDuplicateConfig} className="flex items-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-800 px-2 py-1">
          <Copy size={13} /> Duplicate
        </button>
        <button
          type="button"
          onClick={() => handleDeleteConfig(activeConfig.id)}
          disabled={library.configs.length <= 1}
          className="flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-red-600 px-2 py-1 disabled:opacity-40 disabled:hover:text-slate-400"
        >
          <Trash2 size={13} /> Delete
        </button>
        <span className="w-px h-4 bg-slate-200" />
        <button type="button" onClick={handleExportBackup} className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-1">
          <Download size={13} /> Export backup
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-1">
          <Upload size={13} /> Import backup
        </button>
        <input ref={fileInputRef} type="file" accept="application/json" onChange={handleImportFile} className="hidden" />
      </div>

      {importError && (
        <div className="max-w-6xl mx-auto px-6 mb-4">
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{importError}</p>
        </div>
      )}

      <nav className="max-w-6xl mx-auto px-6 flex flex-wrap gap-2 mb-6">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === id ? 'bg-gradient-to-r from-purple-600 to-fuchsia-500 text-white shadow-md shadow-purple-500/30' : 'bg-white/70 text-slate-600 hover:bg-white'
            }`}
          >
            <Icon size={14} strokeWidth={2.5} /> {label}
            {id === 'validation' && blockCount > 0 && (
              <span className="grid place-items-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">{blockCount}</span>
            )}
          </button>
        ))}
      </nav>

      <main className="max-w-6xl mx-auto px-6 pb-16">
        {tab === 'ingredients' && (
          <IngredientsTab ingredients={ingredients} onUpdate={updateIngredient} onAdd={addIngredient} onDuplicate={duplicateIngredient} onRemove={removeIngredient} />
        )}
        {tab === 'dishes' && (
          <DishesTab
            ingredients={ingredients}
            dishes={dishes}
            recompletionDishes={recompletionDishes}
            recompletionCaps={recompletionCaps}
            totalChefPrize={totalChefPrize}
            onUpdate={updateDish}
            onUpdateRecompletionCap={updateRecompletionCap}
            onAdd={addDish}
            onDuplicate={duplicateDish}
            onRemove={removeDish}
          />
        )}
        {tab === 'baskets' && (
          <BasketsTab ingredients={ingredients} baskets={baskets} calendar={calendar} onUpdate={updateBasket} onAdd={addBasket} onDuplicate={duplicateBasket} onRemove={removeBasket} />
        )}
        {tab === 'calendar' && (
          <CalendarTab
            calendar={calendar}
            ingredients={ingredients}
            grants={grants}
            onUpdatePhase={updateCalendarPhase}
            onUpdateStartDate={updateCalendarStartDate}
            onUpdateTotalDays={updateCalendarTotalDays}
            onAddGrant={addGrant}
            onUpdateGrant={updateGrant}
            onRemoveGrant={removeGrant}
          />
        )}
        {tab === 'segments' && <SegmentsTab segments={segments} onUpdate={updateSegment} onAdd={addSegment} onDuplicate={duplicateSegment} onRemove={removeSegment} />}
        {tab === 'blocker-sources' && <BlockerSourcesTab ingredients={ingredients} baskets={baskets} calendar={calendar} grants={grants} />}
        {tab === 'validation' && (
          <ValidationTab ingredients={ingredients} dishes={dishes} recompletionDishes={recompletionDishes} baskets={baskets} calendar={calendar} segments={segments} grants={grants} />
        )}
        {tab === 'simulation' && (
          <SimulationTab
            segments={segments}
            dishes={dishes}
            recompletionDishes={recompletionDishes}
            baskets={baskets}
            calendar={calendar}
            grants={grants}
            ingredients={ingredients}
            totalChefPrize={totalChefPrize}
          />
        )}
        {tab === 'basket-value' && (
          <BasketValueTab
            dishes={dishes}
            recompletionDishes={recompletionDishes}
            baskets={baskets}
            calendar={calendar}
            totalChefPrize={totalChefPrize}
            ingredients={ingredients}
            segments={segments}
            grants={grants}
          />
        )}
      </main>
    </div>
  )
}
