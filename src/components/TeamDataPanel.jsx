import { useState } from 'react'
import { Check, CloudUpload, RefreshCw, TriangleAlert, Unplug } from 'lucide-react'
import Button from './ui/Button'
import { DATA_REPO, teamData } from '../lib/teamData'
import { collectAllData, hasAnyData } from '../lib/browserData'
import { useTeamStatus } from './useTeamStatus'

// TEAM DATA ON GITHUB (lib/teamData.js): connect this browser to the team's private data repository, see what
// reached the team, and choose when two people changed the same thing.
const REPO_URL = `https://github.com/${DATA_REPO.owner}/${DATA_REPO.repo}`
const OWNER_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'
const CLASSIC_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=Economy%20toolkit%20team%20data'
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')

function downloadBackup() {
  const blob = new Blob([JSON.stringify(collectAllData())], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `economy-toolkit-before-team-data_${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
const said = (r) =>
  [r.taken.length ? `brought in: ${r.taken.join(', ')}` : null, r.sent.length ? `sent to the team: ${r.sent.join(', ')}` : null].filter(Boolean).join('; ') || 'this browser and the team already agree'

export default function TeamDataPanel() {
  const status = useTeamStatus()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null) // { tone, text }
  const user = teamData.user()
  const connected = teamData.isConnected()

  async function connect() {
    setBusy(true)
    setMessage(null)
    // The way back: what this browser holds now, as a file, before anything is brought in.
    if (hasAnyData()) downloadBackup()
    const r = await teamData.connect(token)
    setBusy(false)
    if (!r.ok) return setMessage({ tone: 'error', text: r.message })
    setToken('')
    setMessage({ tone: 'ok', text: `Connected as ${r.user} - ${said(r)}. What this browser held was downloaded first.` })
  }
  async function refresh() {
    setBusy(true)
    const r = await teamData.sync()
    setBusy(false)
    setMessage({ tone: 'ok', text: `Done - ${said(r)}.` })
  }

  return (
    <section className="w-full rounded-3xl border border-slate-200 bg-white/80 p-6 text-left" data-testid="team-data" data-state={status.state}>
      <h2 className="font-display text-base font-bold text-slate-900">Team data on GitHub</h2>
      <p className="mt-1 max-w-3xl text-sm text-slate-500">
        Shared with everyone who connects: the Economy page, saved Merge events, Chef and Diamond Mine. Kept in the private repository{' '}
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="font-mono text-purple-700 hover:underline">
          {DATA_REPO.owner}/{DATA_REPO.repo}
        </a>
        , each save with who made it and when. Not connected, everything stays in this browser as before.
      </p>

      {!connected ? (
        <div className="mt-4 flex flex-col gap-3">
          <details className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-700" data-testid="team-data-howto">
            <summary className="cursor-pointer font-semibold">How to get a token (once, about a minute)</summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              <li>
                <span className="font-semibold">Not the owner?</span> First accept the invitation to {DATA_REPO.owner}/{DATA_REPO.repo} -{' '}
                <a href={`${REPO_URL}/invitations`} target="_blank" rel="noreferrer" className="text-purple-700 hover:underline">
                  open it
                </a>
                . Then make a classic token with &quot;repo&quot; ticked -{' '}
                <a href={CLASSIC_TOKEN_URL} target="_blank" rel="noreferrer" className="text-purple-700 hover:underline">
                  this page opens with it ready
                </a>
                : set an expiry, Generate, copy. (A fine-grained token cannot reach another person&apos;s repository.)
              </li>
              <li>
                <span className="font-semibold">The owner ({DATA_REPO.owner})</span> can use a narrower token -{' '}
                <a href={OWNER_TOKEN_URL} target="_blank" rel="noreferrer" className="text-purple-700 hover:underline">
                  fine-grained
                </a>
                : Only select repositories, {DATA_REPO.repo}; Permissions, Contents: Read and write; Generate, copy.
              </li>
              <li>Paste it below and Connect. It stays in this browser only - never in a backup file. On a shared computer, Disconnect when you leave.</li>
            </ol>
          </details>
          <div className="flex flex-wrap items-center gap-2">
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && token.trim() && !busy && connect()} placeholder="Paste the GitHub token" aria-label="GitHub token" autoComplete="off" spellCheck={false} className="w-80 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-sm" data-testid="team-data-token" />
            <Button variant="dark" size="sm" icon={CloudUpload} onClick={connect} disabled={!token.trim() || busy} data-testid="team-data-connect">
              {busy ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
          <p className="text-xs text-slate-500">Connecting brings in what the team already has and sends what is only here; what this browser holds is downloaded as a file first.</p>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700" data-testid="team-data-who">
            <span>
              Connected as <span className="font-semibold">{user?.login}</span>
            </span>
            <a href={`${REPO_URL}/commits/${DATA_REPO.branch}`} target="_blank" rel="noreferrer" className="text-purple-700 hover:underline">
              Every change, on GitHub
            </a>
          </p>
          <StatusLine status={status} />
          {status.conflicts.length > 0 && (
            <ul className="flex flex-col gap-2" data-testid="team-data-conflicts">
              {status.conflicts.map((c) => (
                <li key={c.path} className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-conflict={c.path}>
                  <span className="font-semibold">{c.label}</span> was changed by the team since this browser read it, and changed here too. Which one is kept?
                  <span className="mt-2 flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => teamData.resolve(c.path, 'theirs')} data-testid="team-data-theirs">
                      Keep the team&apos;s
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => teamData.resolve(c.path, 'mine')} data-testid="team-data-mine">
                      Keep mine, over the team&apos;s
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh} disabled={busy} data-testid="team-data-refresh" title="Bring in what the team changed, and send what changed here">
              Get the team&apos;s latest
            </Button>
            <Button variant="ghost" size="sm" icon={Unplug} onClick={() => teamData.disconnect()} data-testid="team-data-disconnect" title="This browser stops sharing; what it holds stays here">
              Disconnect
            </Button>
          </div>
        </div>
      )}

      {message && (
        <p className={`mt-3 flex items-start gap-1.5 text-sm ${message.tone === 'error' ? 'text-rose-700' : 'text-emerald-700'}`} data-testid="team-data-message">
          {message.tone === 'error' ? <TriangleAlert size={15} className="mt-0.5 shrink-0" /> : <Check size={15} className="mt-0.5 shrink-0" />}
          {message.text}
        </p>
      )}
    </section>
  )
}

function StatusLine({ status }) {
  const text = {
    idle: 'Connected.',
    syncing: 'Sending to the team…',
    saved: `Everything here is with the team${status.at ? ` (${time(status.at)})` : ''}.`,
    error: status.message,
    conflict: `${status.conflicts.length} to choose below.`,
  }[status.state]
  if (!text) return null
  return (
    <p className={`text-sm ${status.state === 'error' || status.state === 'conflict' ? 'text-amber-800' : 'text-slate-600'}`} data-testid="team-data-status">
      {text}
    </p>
  )
}
