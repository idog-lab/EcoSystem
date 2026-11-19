import { AlertTriangle } from 'lucide-react'
import GameArt from './GameArt'
import { endlessArt, generatorArt } from '../../lib/play/artAssets'
import { endlessOfDesign, describeEndlessDrops, ENDLESS_DROP_VALUE_MULTIPLIER, ENDLESS_COIN_ENERGY_SHARE, ENDLESS_ENERGY_PAYBACK_MAX } from '../../lib/rewards/endlessMode'
import { REWARD_TYPES, REWARD_TARGET_LABELS, formatRewardAmount } from '../../lib/rewards/rewardChain'
import { RC_MAX_RANK } from '../../lib/core/ranks'
import ContainersTable from '../build/ContainersTable'

// How endless mode LOOKS, shared by the Play Tester and Play Stage. The rules
// are in lib/endlessMode.js; the look switches on the session's own phase
// (`session.phase === 'endless'`), never on a rank compared in a component.
//
// The artwork is the economist's endless pack (artAssets.js: endlessArt). Its
// nameplate is a blank picture - the words on it are live HTML - and its
// frame is used at its own proportions, as an emblem around the generator,
// never stretched around the board. Which theme a session is in, and the
// board surround of each, are in lib/playTileSurface.js (themeOf,
// BOARD_SURROUND).

// The pack's generator, for a Button's `icon` slot.
export function EndlessGeneratorIcon({ size = 16 }) {
  const art = generatorArt('endless')
  if (!art) return null
  return <img src={art.url} alt="" aria-hidden="true" draggable={false} className="object-contain shrink-0" style={{ width: size + 8, height: size + 8, margin: -4 }} />
}

// The infinity badge on the board's corner while endless mode is on.
export function EndlessBoardBadge() {
  const art = endlessArt('infinity-badge')
  if (!art) return null
  return <img src={art.url} alt="" aria-hidden="true" draggable={false} data-testid="endless-badge" className="absolute -top-3 -right-3 w-10 h-10 object-contain pointer-events-none select-none drop-shadow-md z-[5]" />
}

// The pack's blank nameplate with live text on it.
export function EndlessNameplate({ height = 44, children = 'Endless Mode' }) {
  const art = endlessArt('nameplate-blank')
  if (!art) return <span className="font-display text-sm font-bold text-white">{children}</span>
  return (
    <span className="relative inline-block shrink-0 select-none" style={{ height, width: height * 3 }}>
      <img src={art.url} alt="" aria-hidden="true" draggable={false} className="absolute inset-0 w-full h-full" />
      <span className="absolute inset-y-0 left-[33%] right-[6%] flex items-center justify-center font-display font-bold text-white whitespace-nowrap drop-shadow-[0_1px_1px_rgba(40,0,60,0.6)]" style={{ fontSize: Math.round(height * 0.3) }}>
        {children}
      </span>
    </span>
  )
}

// The frame, at its own proportions, around the endless generator.
function EndlessEmblem({ height = 68 }) {
  const frame = endlessArt('board-frame')
  const generator = generatorArt('endless')
  if (!frame) return null
  return (
    <span className="relative block shrink-0 select-none" aria-hidden="true" style={{ height, width: Math.round((height * 176) / 194) }}>
      <img src={frame.url} alt="" draggable={false} className="absolute inset-0 w-full h-full" />
      {generator && <img src={generator.url} alt="" draggable={false} className="absolute object-contain" style={{ left: '22%', right: '22%', top: '34%', bottom: '17%', width: '56%', height: '49%' }} />}
    </span>
  )
}

// What the endless drops come to, in numbers - shown to the economist (the
// Play Tester's banner and the Build event flow), never on the player's
// screen.
export function EndlessDropDetails({ endless, rewardChainConfig, targetEv, className = '' }) {
  const info = describeEndlessDrops(endless, rewardChainConfig, { targetEv })
  const dropping = REWARD_TYPES.filter((t) => info.perDrop[t].items > 0)
  const selfFunding = info.energyPer100Dr >= 100
  return (
    <div data-testid="endless-details" className={`flex flex-col gap-1.5 text-xs text-slate-700 ${className}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-purple-700">What the endless drops come to</span>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {dropping.map((t) => (
          <span key={t} data-testid={`endless-drop-${t}`} className="inline-flex items-center gap-1 whitespace-nowrap">
            <GameArt asset={t} rank={1} size={18} />
            <span className="font-semibold">{REWARD_TARGET_LABELS[t]}</span>
            <span className="text-slate-500">
              in {Math.round(info.perDrop[t].items * 100)}% of drops · about {formatRewardAmount(t, info.perDrop[t].payout * 100, { unit: true })} per 100 drops
            </span>
          </span>
        ))}
      </div>
      <span data-testid="endless-share">
        <span className="font-semibold">{Math.round(info.coinEnergyShare * 100)}%</span> of dropped items are coins or merge energy. An average drop carries{' '}
        <span className="font-semibold">{ENDLESS_DROP_VALUE_MULTIPLIER}×</span> what it did before rank {RC_MAX_RANK}.
      </span>
      <span data-testid="endless-energy" className={selfFunding ? 'flex items-start gap-1.5 font-semibold text-amber-700' : undefined}>
        {selfFunding && <AlertTriangle size={14} className="mt-px shrink-0" />}
        <span>
          About {Math.round(info.mergesPer100Dr)} merges drop for every 100 DR of generator taps, paying back about{' '}
          <span className="font-semibold">{Math.round(info.energyPer100Dr)} merge energy</span> ({Math.round(info.energyPer100Dr)} free taps) per 100 DR.
          {selfFunding ? ' That is 100 or more: endless play would pay for itself and never need DR.' : ''} An estimate.
        </span>
      </span>
      {endless.energyHeld && (
        <span data-testid="endless-energy-held">
          Merge energy is held to at most <span className="font-semibold">{Math.round(ENDLESS_ENERGY_PAYBACK_MAX * 100)} free taps per 100 DR</span>, so endless play can never pay for itself; what that takes off the merge energy
          drops as coins instead.
        </span>
      )}
      <span className="text-[11px] text-slate-500">
        The amounts ({ENDLESS_DROP_VALUE_MULTIPLIER}× per drop, {Math.round(ENDLESS_COIN_ENERGY_SHARE * 100)}% coins and merge energy, one rank lower, merge energy at most {Math.round(ENDLESS_ENERGY_PAYBACK_MAX * 100)} free taps per 100 DR) are this tool's starting numbers, not confirmed game values.
      </span>
    </div>
  )
}

// The banner shown while endless mode is on. `detailed` (the economist's
// Play Tester) adds what the endless drops come to; Play Stage (the player's
// screen) shows the short form.
export function EndlessBanner({ session, detailed = false, mini = false }) {
  const endless = session.endless
  if (session.phase !== 'endless' || !endless) return null
  // One short line, for the play screen on a phone held sideways.
  if (mini) {
    return (
      <div data-testid="endless-active" className="rounded-xl border border-amber-300 bg-gradient-to-r from-purple-800 via-fuchsia-700 to-purple-800 px-2 py-1 text-[11px] font-semibold leading-snug text-white">
        Endless mode — rank {RC_MAX_RANK} is yours, play never ends.{' '}
        <span data-testid="endless-rule" className="font-medium text-purple-100">
          {endless.hasDrops ? `Merges from rank ${endless.minDropRank} drop rewards.` : 'Merges drop nothing extra here.'}
        </span>
      </div>
    )
  }
  return (
    <div data-testid="endless-active" className="flex flex-col gap-2 rounded-2xl border-2 border-amber-300 bg-gradient-to-r from-purple-800 via-fuchsia-700 to-purple-800 px-3 py-2.5 text-white shadow-md shadow-purple-900/25">
      <div className="flex items-center gap-3">
        <EndlessEmblem />
        <div className="flex min-w-0 flex-col gap-1">
          <EndlessNameplate />
          <p className="text-xs font-medium leading-snug text-purple-50">
            You reached rank {RC_MAX_RANK} — the second grand prize is yours! The board keeps going, with no end.{' '}
            {endless.hasDrops ? (
              <span data-testid="endless-rule">
                Every merge that makes rank {endless.minDropRank} or higher now drops rewards (it was rank {endless.baseMinDropRank}), mostly coins and merge energy.
              </span>
            ) : (
              <span data-testid="endless-rule">No small reward has rank values on this stage, so endless merges drop nothing extra.</span>
            )}
          </p>
        </div>
      </div>
      {detailed && endless.hasDrops && <EndlessDropDetails endless={endless} rewardChainConfig={session.rewardChainConfig} targetEv={session.targetEv} className="rounded-xl bg-white/95 px-3 py-2" />}
    </div>
  )
}

// What endless mode will be for a design, before anyone plays it: read off a
// Recompletion list's first board (its merge drops, start rank and rank
// values are what endless is derived from). Used by the Build event flow.
export function EndlessPreview({ mainBoards, rcBoards }) {
  const endless = endlessOfDesign(mainBoards, rcBoards)
  const hasDrops = !!endless?.builtFromDrops
  const rcBoard = rcBoards?.[0] ?? null
  return (
    <div className="flex flex-col gap-2" data-testid="endless-preview">
      <div className="flex flex-wrap items-center gap-3">
        <EndlessEmblem height={56} />
        <ul className="flex-1 min-w-[18rem] list-disc pl-4 text-sm text-slate-600 leading-relaxed">
          <li>Starts the moment the player holds rank {RC_MAX_RANK}. Nothing on the board is taken away, and there is no end.</li>
          <li>
            Merge drops start one rank lower{endless ? <> (rank {endless.minDropRank} instead of rank {endless.baseMinDropRank})</> : null}, carry more, and are mostly coins and merge energy.
          </li>
          <li>The rank {RC_MAX_RANK} stays on the board. Two rank {RC_MAX_RANK}s do not merge (there is no rank {RC_MAX_RANK + 1}).</li>
        </ul>
      </div>
      {rcBoard && !hasDrops && (
        <p className="text-xs text-amber-700" data-testid="endless-preview-unbuilt">
          The applied Recompletion design has no merge drops yet, so the numbers below assume one item per merge before endless. Build and apply Recompletion to see the real ones.
        </p>
      )}
      {endless?.hasDrops ? (
        <>
          <EndlessDropDetails endless={endless} rewardChainConfig={endless.rewardChainConfig} targetEv={endless.targetEv} className="rounded-xl border border-purple-100 bg-purple-50/50 px-3 py-2" />
          <details className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2" data-testid="endless-containers">
            <summary className="cursor-pointer text-xs font-semibold text-slate-600">The endless containers and their weights</summary>
            <div className="mt-2">
              <ContainersTable dropGroups={endless.dropGroups} dropGroupsConfig={endless.dropGroupsConfig} minDropRank={endless.minDropRank} phase="rc" testid="endless-container-table" />
              <p className="mt-1 text-[11px] text-slate-500">Worked out from the Recompletion containers when rank {RC_MAX_RANK} is reached. Exported as "Endless Small Rewards Bank" and "Endless Small Reward Weights" (not in the Ops reference).</p>
            </div>
          </details>
        </>
      ) : (
        <p className="text-xs text-slate-500">No small reward has rank values in Recompletion, so endless merges would drop nothing extra.</p>
      )}
    </div>
  )
}
