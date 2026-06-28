import { useState, type FormEvent } from 'react'
import { login } from '../lib/api'
import { Signal } from './Icons'

/** Full-screen password gate. Calls /api/auth/login, then hands control back
 *  to App on success (the session cookie is set by the backend). */
export function Login({ onAuthed }: { onAuthed: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(password)
      onAuthed()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <form className="auth__card" onSubmit={submit}>
        <div className="auth__brand">
          <span className="auth__mark" aria-hidden="true">
            <Signal />
          </span>
          <span className="auth__brand-text">
            <strong>ONRAI STUDIO</strong>
            <small>Lead Radar · Melbourne</small>
          </span>
        </div>

        <h1 className="auth__title">Sign in</h1>
        <p className="auth__hint">Enter the dashboard password to continue.</p>

        <label className="auth__field">
          <span>Password</span>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
            autoComplete="current-password"
          />
        </label>

        {error && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}

        <button
          className="btn btn--primary auth__submit"
          type="submit"
          disabled={busy || !password}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
