import { useCallback, useEffect, useState } from 'react'
import { api } from './client'

export type Workspace = { id: string; slug: string; name: string }
export type SessionOptions = { google: boolean; devBypass: boolean }
export type Session =
  | { status: 'loading' }
  | { status: 'unavailable'; message: string }
  | { status: 'signed-out'; options: SessionOptions }
  | { status: 'signed-in'; options: SessionOptions; user: { email: string; name: string }; workspaces: Workspace[] }

export function useSession() {
  const [session, setSession] = useState<Session>({ status: 'loading' })

  const load = useCallback(async () => {
    const res = await api<{ options: SessionOptions; user: { email: string; name: string } | null; workspaces: Workspace[] }>('/session')
    if (!res.ok) return setSession({ status: 'unavailable', message: res.message })
    const { options, user, workspaces } = res.data
    setSession(user ? { status: 'signed-in', options, user, workspaces } : { status: 'signed-out', options })
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading from the server on mount
    void load()
  }, [load])

  const signInWithGoogle = useCallback(async () => {
    const res = await api<{ url: string }>('/auth/sign-in/social', {
      method: 'POST',
      body: { provider: 'google', callbackURL: window.location.href },
    })
    if (res.ok && res.data.url) window.location.assign(res.data.url)
    return res
  }, [])

  const devSignIn = useCallback(
    async (email: string) => {
      const res = await api('/dev/sign-in', { method: 'POST', body: { email } })
      if (res.ok) await load()
      return res
    },
    [load],
  )

  const signOut = useCallback(async () => {
    await api('/auth/sign-out', { method: 'POST', body: {} })
    if (session.status !== 'loading' && session.status !== 'unavailable' && session.options.devBypass) {
      await api('/dev/sign-out', { method: 'POST', body: {} })
    }
    await load()
  }, [load, session])

  return { session, signInWithGoogle, devSignIn, signOut }
}
