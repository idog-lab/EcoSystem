import { useState, type FormEvent } from 'react'
import { Link } from '../routing/Link'
import type { Session } from '../api/useSession'
import type { ApiResult } from '../api/client'

// Who is signed in, and how to sign in. Folders are shared workspace data, so
// they appear only for a signed-in member.

type Props = {
  session: Session
  signInWithGoogle: () => Promise<ApiResult<{ url: string }>>
  devSignIn: (email: string) => Promise<ApiResult<unknown>>
  signOut: () => Promise<void>
}

export default function AccountPanel({ session, signInWithGoogle, devSignIn, signOut }: Props) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (session.status === 'loading') return <p className="text-slate-500">Connecting…</p>
  if (session.status === 'unavailable') {
    return <p className="text-xs text-slate-500">Shared folders are off: the toolkit server is not connected to this site.</p>
  }
  if (session.status === 'signed-in') {
    return (
      <div className="flex flex-col gap-1">
        {session.workspaces.length === 0 && (
          <p className="text-xs text-amber-700">You are signed in but not a member of a workspace yet. Ask an admin to add you.</p>
        )}
        <p className="truncate text-xs text-slate-500" title={session.user.email}>
          Signed in as <span className="font-medium text-slate-700">{session.user.email}</span>
        </p>
        <button type="button" onClick={() => void signOut()} className="self-start text-xs font-semibold text-purple-700 hover:underline">
          Sign out
        </button>
      </div>
    )
  }

  const submitDev = async (e: FormEvent) => {
    e.preventDefault()
    const res = await devSignIn(email)
    setError(res.ok ? null : res.message)
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-slate-500">Sign in to see and organize your team&apos;s folders.</p>
      {session.options.google && (
        <button
          type="button"
          onClick={async () => {
            const res = await signInWithGoogle()
            if (!res.ok) setError(res.message)
          }}
          className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700"
        >
          Sign in with Google
        </button>
      )}
      {session.options.devBypass && (
        <form onSubmit={submitDev} className="flex flex-col gap-1.5 rounded-lg border border-dashed border-amber-300 bg-amber-50/60 p-2">
          <label htmlFor="dev-email" className="text-xs font-semibold text-amber-800">
            Development sign-in (no password)
          </label>
          <input
            id="dev-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rounded-md border border-amber-200 bg-white px-2 py-1 text-xs"
          />
          <button type="submit" className="self-start rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700">
            Sign in
          </button>
        </form>
      )}
      {!session.options.google && !session.options.devBypass && <p className="text-xs text-rose-700">No sign-in method is configured on the server.</p>}
      {error && (
        <p role="alert" className="text-xs text-rose-700">
          {error}
        </p>
      )}
    </div>
  )
}

export function BrowserDataLink() {
  return (
    <Link to="/browser-data" className="text-xs text-slate-500 underline-offset-2 hover:text-purple-700 hover:underline">
      Data kept in this browser
    </Link>
  )
}
