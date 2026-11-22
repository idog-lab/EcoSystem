import { useEffect, useRef } from 'react'
import { ChevronRight } from 'lucide-react'

// A SECTION THAT STARTS FOLDED. A guided flow shows what an economist has to
// enter or judge; rules that already have working defaults, explanations and
// diagnostics sit one click away. `summary` says in a line what is inside
// (the settings in force, a count) so nothing has to be opened to know it is
// fine. Open/closed is remembered for the visit, per id, so moving between
// steps does not fold a section the economist was working in. `openWhen`
// opens it by itself when something inside needs attention.
// (Native <details>, not React state: the browser tests open every section
// through the DOM so they keep checking everything a section holds.)
// Shared by the Merge flow (buildUi.jsx re-exports it) and the Chef flow.
const collapsibleMemory = new Map()
export default function Collapsible({ id, title, summary, tag, defaultOpen = false, openWhen = false, children, className = '', tone = 'plain', ...props }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const remembered = collapsibleMemory.get(id)
    if (openWhen || (remembered ?? defaultOpen)) el.open = true
    const onToggle = () => collapsibleMemory.set(id, el.open)
    el.addEventListener('toggle', onToggle)
    return () => el.removeEventListener('toggle', onToggle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, openWhen])
  const tones = { plain: 'rounded-3xl bg-white/90 border-white ring-1 ring-slate-200/70 shadow-lg shadow-purple-950/5', inner: 'rounded-2xl bg-slate-50/60 border-slate-100' }
  const inner = tone === 'inner'
  return (
    <details ref={ref} className={`group min-w-0 border ${tones[tone] ?? tones.plain} ${className}`} data-collapsible={id} {...props}>
      <summary className={`flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden ${inner ? 'px-4 py-2.5' : 'px-5 py-3.5'}`}>
        <ChevronRight size={16} className="shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
        <span className="min-w-0 flex-1">
          <span className={inner ? 'text-sm font-semibold text-slate-700' : 'font-display text-[0.95rem] font-semibold tracking-tight text-slate-800'}>{title}</span>
          {summary && <span className="mt-0.5 block text-xs text-slate-500 group-open:hidden">{summary}</span>}
        </span>
        {tag}
        <span className="shrink-0 text-[11px] font-semibold text-purple-700 group-open:hidden">Show</span>
        <span className="hidden shrink-0 text-[11px] font-semibold text-slate-400 group-open:inline">Hide</span>
      </summary>
      <div className={`border-t border-slate-100 ${inner ? 'p-4' : 'p-5'}`}>{children}</div>
    </details>
  )
}
