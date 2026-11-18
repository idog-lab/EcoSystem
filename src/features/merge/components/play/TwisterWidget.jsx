import Button from '../../../../components/ui/Button'
import GameArt from './GameArt'
import { twisterBalance, twisterEarned, canSpinTwister, sessionProgress, sessionHasTwister } from '../../lib/simulation/playSession'

// The Twister widget as an ECONOMY PREVIEW: the Twister DR balance, what a
// spin costs for the segment being played, a spin action that deducts that
// cost exactly once, and the spin count. It deliberately shows no spin
// result: no spin-prize table, completion prize or widget length has been
// specified, so none is invented here. Twister drops never stop because a
// spin count was reached.
// `mini`: a single line (balance and the spin button) for the play screen
// on a phone held sideways.
export default function TwisterWidget({ session, onSpin, compact = false, mini = false }) {
  if (!sessionHasTwister(session)) return null
  const balance = twisterBalance(session)
  const earned = twisterEarned(session)
  const cost = session.twisterSpinCost
  const costSet = Number.isFinite(cost) && cost > 0
  const canSpin = canSpinTwister(session)
  const objective = session.twisterSpinObjective
  const hasObjective = Number.isFinite(objective) && objective > 0
  const short = costSet ? Math.max(0, cost - balance) : null
  const fmt = (v) => v.toLocaleString(undefined, { maximumFractionDigits: 1 })

  if (mini) {
    return (
      <div className="flex items-center gap-1.5 rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50 to-cyan-50 px-1.5 py-1" data-testid="twister-widget">
        <GameArt asset="twister" size={20} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="font-display text-sm font-bold tabular-nums text-teal-800" data-testid="twister-balance">
            {fmt(balance)}
          </div>
          <div className="text-[9px] font-semibold uppercase tracking-wide text-teal-700 truncate">
            Twister DR · <span data-testid="twister-spins-used">{session.spinsUsed ?? 0}</span> spins
          </div>
        </div>
        <button
          type="button"
          onClick={onSpin}
          disabled={!canSpin}
          data-testid="twister-spin"
          title={costSet ? `Spin: ${fmt(cost)} Twister DR` : 'No cost per spin is set for this segment yet'}
          className="h-10 shrink-0 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 px-2.5 text-xs font-bold text-white shadow-sm active:scale-95 disabled:opacity-40"
        >
          {costSet ? `Spin −${fmt(cost)}` : 'Spin'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-cyan-50 p-2.5 sm:p-3" data-testid="twister-widget">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-teal-800">
          <GameArt asset="twister" size={18} /> Twister
        </span>
        <span className="text-[10px] font-semibold text-teal-700/80 rounded-full bg-white/70 px-2 py-0.5" title="Spending and spin counting only - no spin result, prize or widget length is modelled">
          economy preview
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="font-display text-2xl font-bold tabular-nums text-teal-800 leading-none" data-testid="twister-balance">
            {fmt(balance)}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-teal-700">Twister DR balance</div>
        </div>
        <div className="text-right text-[11px] text-teal-800">
          <div>
            Earned <span className="font-semibold tabular-nums" data-testid="twister-earned">{fmt(earned)}</span>
          </div>
          <div>
            Spins used <span className="font-semibold tabular-nums" data-testid="twister-spins-used">{session.spinsUsed ?? 0}</span>
          </div>
        </div>
      </div>
      <Button variant="primary" onClick={onSpin} disabled={!canSpin} data-testid="twister-spin">
        {costSet ? `Spin (−${fmt(cost)} Twister DR)` : 'Spin'}
      </Button>
      <div className="text-[11px] text-teal-800" data-testid="twister-cost">
        {costSet ? (
          <>
            Cost per spin: <span className="font-semibold">{fmt(cost)} Twister DR</span>
            {!canSpin && short > 0 && <span className="text-teal-700/80"> · {fmt(short)} more needed</span>}
          </>
        ) : (
          <span className="text-amber-700">No cost per spin is set for this segment yet, so spins are unavailable.</span>
        )}
      </div>
      {hasObjective && (
        <div data-testid="twister-objective">
          <div className="flex justify-between text-[11px] text-teal-800">
            <span>Widget progress</span>
            <span className="font-semibold tabular-nums">
              {Math.min(session.spinsUsed ?? 0, objective)} / {objective} spins
            </span>
          </div>
          <div className="mt-0.5 h-1.5 rounded-full bg-white/80 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-cyan-500" style={{ width: `${Math.min(100, ((session.spinsUsed ?? 0) / objective) * 100)}%` }} />
          </div>
        </div>
      )}
      {!compact && (
        <p className="text-[10px] text-teal-700/80 leading-snug">
          Twister DR is separate from merge energy and never funds the generator. Main-chain progress now:{' '}
          <span className="font-semibold" data-testid="twister-progress-pct">
            {(sessionProgress(session) * 100).toFixed(sessionProgress(session) < 0.1 ? 1 : 0)}%
          </span>
          .
        </p>
      )}
    </div>
  )
}
