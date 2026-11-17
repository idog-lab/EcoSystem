import { useMemo, useState } from 'react'
import { ArrowLeft, Gamepad2, Gem, LayoutGrid, FileCode2, Save, Pickaxe } from 'lucide-react'
import Button from '../../../components/ui/Button'
import GemLibrary from './GemLibrary'
import MineBoardList from './MineBoardList'
import MineBoardEditor from './MineBoardEditor'
import MinePlayTester from './MinePlayTester'
import MineSyntaxPage from './MineSyntaxPage'
import { createDefaultGems, createGem, removeGemEverywhere } from '../lib/gem'
import { createDiamondBoard, cloneDiamondBoard } from '../lib/diamondBoard'
import { loadDiamondState, saveDiamondState } from '../lib/diamondPersistence'

const TABS = [
  { id: 'boards', label: 'Boards', icon: LayoutGrid },
  { id: 'play', label: 'Play test', icon: Gamepad2 },
  { id: 'gems', label: 'Gems', icon: Gem },
  { id: 'syntax', label: 'Syntax', icon: FileCode2 },
]

function initialState() {
  const persisted = loadDiamondState()
  // Gate on boards alone, same as EditorApp's own initialState (App.jsx) -
  // an economist can legitimately empty the gem library down to zero (a
  // real, handled state - see GemLibrary's empty state and the generator's
  // no-op path), and that must not discard real saved boards on next load.
  if (persisted?.boards?.length) return { gems: persisted.gems ?? [], boards: persisted.boards }
  return { gems: createDefaultGems(), boards: [createDiamondBoard('Board 1', { rows: 5, cols: 6 })] }
}

export default function DiamondMineApp({ onHome }) {
  const [state, setState] = useState(initialState)
  const { gems, boards } = state
  const [activeId, setActiveId] = useState(() => state.boards[0].id)
  const [tab, setTab] = useState('boards')
  const [savedAt, setSavedAt] = useState(null)

  const gemsById = useMemo(() => Object.fromEntries(gems.map((g) => [g.id, g])), [gems])
  const activeBoard = boards.find((b) => b.id === activeId) ?? boards[0]
  const activeIndex = boards.findIndex((b) => b.id === activeBoard?.id)

  function updateBoard(updated) {
    setState((s) => ({ ...s, boards: s.boards.map((b) => (b.id === updated.id ? updated : b)) }))
  }

  function addBoard() {
    const board = createDiamondBoard(`Board ${boards.length + 1}`, { rows: 5, cols: 6 })
    setState((s) => ({ ...s, boards: [...s.boards, board] }))
    setActiveId(board.id)
  }

  function duplicateBoard(id) {
    const board = boards.find((b) => b.id === id)
    const copy = cloneDiamondBoard(board)
    const idx = boards.findIndex((b) => b.id === id)
    setState((s) => ({ ...s, boards: [...s.boards.slice(0, idx + 1), copy, ...s.boards.slice(idx + 1)] }))
    setActiveId(copy.id)
  }

  function removeBoard(id) {
    if (boards.length <= 1) return
    setState((s) => ({ ...s, boards: s.boards.filter((b) => b.id !== id) }))
    if (activeId === id) setActiveId(boards.filter((b) => b.id !== id)[0].id)
  }

  function moveBoard(from, to) {
    if (to < 0 || to >= boards.length) return
    setState((s) => {
      const next = [...s.boards]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { ...s, boards: next }
    })
  }

  function handleGenerate(generatedBoard) {
    const board = { ...generatedBoard, name: `Board ${boards.length + 1}` }
    setState((s) => ({ ...s, boards: [...s.boards, board] }))
    setActiveId(board.id)
  }

  function addGem(gem) {
    setState((s) => ({ ...s, gems: [...s.gems, gem] }))
  }

  function updateGem(id, patch) {
    setState((s) => ({ ...s, gems: s.gems.map((g) => (g.id === id ? { ...g, ...patch } : g)) }))
  }

  function deleteGem(id) {
    setState((s) => ({ ...s, gems: s.gems.filter((g) => g.id !== id), boards: removeGemEverywhere(id, s.boards) }))
  }

  function duplicateGem(id) {
    const gem = gems.find((g) => g.id === id)
    if (!gem) return
    addGem(createGem(`${gem.name} copy`, gem.rows, gem.cols, gem.color))
  }

  function handleSave() {
    saveDiamondState({ gems, boards })
    setSavedAt(new Date())
  }

  return (
    <div className="min-h-screen">
      <div className="app-backdrop" aria-hidden="true" />

      <header className="bg-white/80 backdrop-blur-md border-b border-white sticky top-0 z-30 shadow-sm shadow-purple-950/5">
        <div className="max-w-[1760px] mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onHome}>
              Features
            </Button>
            <div className="bg-gradient-to-br from-purple-600 to-fuchsia-500 text-white rounded-xl p-2 shadow-md shadow-purple-500/30">
              <Pickaxe size={20} strokeWidth={2.25} />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-slate-900 leading-tight tracking-tight">Diamond Mine</h1>
              <p className="text-xs text-slate-400 leading-tight">Gem & board builder</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-slate-100/80 rounded-xl p-1">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all duration-150 ${
                    tab === id ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-sm shadow-purple-500/30' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Icon size={14} strokeWidth={2.25} />
                  {label}
                </button>
              ))}
            </div>
            {savedAt && <span className="text-xs text-slate-400">Saved {savedAt.toLocaleTimeString()}</span>}
            <Button variant="dark" icon={Save} onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-[1760px] mx-auto px-6 py-6 flex gap-8">
        {tab === 'boards' && activeBoard && (
          <>
            <MineBoardList
              boards={boards}
              activeId={activeBoard.id}
              onSelect={setActiveId}
              onAdd={addBoard}
              onDuplicate={duplicateBoard}
              onRemove={removeBoard}
              onMove={moveBoard}
              gems={gems}
              onGenerate={handleGenerate}
            />
            <MineBoardEditor key={activeBoard.id} board={activeBoard} gems={gems} gemsById={gemsById} onUpdateBoard={updateBoard} />
          </>
        )}
        {tab === 'play' && activeBoard && (
          <>
            <MineBoardList
              boards={boards}
              activeId={activeBoard.id}
              onSelect={setActiveId}
              onAdd={addBoard}
              onDuplicate={duplicateBoard}
              onRemove={removeBoard}
              onMove={moveBoard}
              gems={gems}
              onGenerate={handleGenerate}
            />
            <MinePlayTester key={activeBoard.id} boards={boards} gemsById={gemsById} boardIndex={activeIndex} />
          </>
        )}
        {tab === 'gems' && (
          <GemLibrary
            gems={gems}
            boards={boards}
            onAdd={addGem}
            onUpdate={updateGem}
            onDelete={deleteGem}
            onDuplicate={duplicateGem}
          />
        )}
        {tab === 'syntax' && <MineSyntaxPage boards={boards} gemsById={gemsById} />}
      </main>
    </div>
  )
}
