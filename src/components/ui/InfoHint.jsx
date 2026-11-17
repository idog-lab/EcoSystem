// A collapsed-by-default "i" explanation, plain <details>/<summary> (no JS
// state needed - native keyboard/click toggling for free). Several cards in
// BoardEditor.jsx (Total subsidy, Generator tiers, Lucky drops, Placement...)
// accumulated multiple long "why"/"how" paragraphs that made every card feel
// text-heavy at a glance just to explain itself - by explicit economist
// request ("we got a lot of text in those places, we can handle it with an i
// that can expand an explanation if wanted"), this tucks that same
// explanation one click away instead of deleting it - the sentences are real
// information (often the answer to "why does this number look odd"), not
// filler to trim.
export default function InfoHint({ children, className = '' }) {
  if (!children) return null
  return (
    <details className={`group text-xs text-slate-400 ${className}`}>
      <summary className="cursor-pointer select-none list-none inline-flex items-center gap-1.5 hover:text-purple-500 transition-colors marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-current text-[9px] font-bold leading-none shrink-0 group-open:bg-purple-500 group-open:border-purple-500 group-open:text-white transition-colors">
          i
        </span>
        <span className="group-open:hidden">More info</span>
        <span className="hidden group-open:inline">Hide</span>
      </summary>
      <p className="mt-1.5 leading-relaxed">{children}</p>
    </details>
  )
}
