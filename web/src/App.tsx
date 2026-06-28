import { useCallback, useEffect, useState } from 'react'
import { getAuthStatus } from './lib/api'
import { Login } from './components/Login'
import { Dashboard } from './components/Dashboard'

/** Auth gate: check the session once, show Login until authed, then the
 *  Dashboard. Mounting the Dashboard only when authed means its lead fetch
 *  never fires (and 401s) before the user has signed in. */
export default function App() {
  // null = still checking the session.
  const [authed, setAuthed] = useState<boolean | null>(null)
  // Whether the backend gates on a password — drives showing the logout button.
  const [passwordRequired, setPasswordRequired] = useState(false)

  useEffect(() => {
    getAuthStatus()
      .then((s) => {
        setPasswordRequired(s.password_required)
        setAuthed(s.authed || !s.password_required)
      })
      .catch(() => setAuthed(false)) // backend unreachable → show login
  }, [])

  const onSignedOut = useCallback(() => setAuthed(false), [])

  if (authed === null) {
    return (
      <div className="auth">
        <div className="auth__checking" aria-busy="true">
          Loading…
        </div>
      </div>
    )
  }

  if (!authed) {
    return <Login onAuthed={() => setAuthed(true)} />
  }

  return <Dashboard canLogout={passwordRequired} onSignedOut={onSignedOut} />
}
