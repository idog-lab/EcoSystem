import { Link } from '../platform/routing/Link'
import { useTeamStatus } from './useTeamStatus'

// A small mark in the corner of the toolkit's pages: whether what was saved here reached the team (lib/teamData.js).
// It leads to the Team data panel. A dot in the page's margin while all is well (its words in the hover), so it never
// covers a field; words when something needs the person - not sent, or something to choose.
export default function TeamDataBadge() {
  const status = useTeamStatus()
  const words = {
    off: 'Team data: off - not shared. Open to connect.',
    idle: 'Team data: connected.',
    syncing: 'Sending to the team…',
    saved: 'Team data: everything here is with the team.',
    error: `Team data: not sent - ${status.message}`,
    conflict: `Team data: ${status.conflicts.length} to choose`,
  }[status.state] ?? 'Team data'
  const loud = status.state === 'error' || status.state === 'conflict'
  const dot = { off: 'bg-slate-300', idle: 'bg-sky-400', syncing: 'bg-sky-400 animate-pulse', saved: 'bg-emerald-500' }[status.state] ?? 'bg-amber-500'
  return (
    <Link
      to="/browser-data"
      className={`fixed bottom-2 left-2 z-40 flex items-center gap-1.5 rounded-full text-xs font-semibold shadow-sm ring-1 backdrop-blur ${loud ? 'bg-amber-50 px-3 py-1 text-amber-900 ring-amber-300' : 'bg-white/80 p-1.5 ring-slate-200'}`}
      data-testid="team-data-badge"
      data-state={status.state}
      title={words}
      aria-label={words}
    >
      <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden="true" />
      {loud && <span>{status.state === 'conflict' ? words : 'Team data: not sent'}</span>}
    </Link>
  )
}
