import { useState, useEffect, useRef } from 'https://esm.sh/react@19'
import { html } from '../html.js'
import { isSupabaseConfigured } from '../supabase/client.js'

export default function AuthPanel({ auth, displayName, onClose, onAuthenticated, onDisplayNameChange }) {
  const [tab, setTab] = useState('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const authenticated = auth.status === 'authenticated' && Boolean(auth.user?.email) && !auth.user?.is_anonymous
  const previousAuthenticated = useRef(authenticated)

  useEffect(() => {
    const wasAuthenticated = previousAuthenticated.current
    previousAuthenticated.current = authenticated
    if (!wasAuthenticated && authenticated && !auth.recovering) (onAuthenticated || onClose)()
  }, [authenticated, auth.recovering, onAuthenticated, onClose])

  if (!isSupabaseConfigured) {
    return html`
      <div className="auth-modal">
        <div className="auth-modal__card">
          <h2>ONLINE MULTIPLAYER</h2>
          <p>
            Supabase is not configured. Add <code>SUPABASE_URL</code> and{' '}
            <code>SUPABASE_ANON_KEY</code> to a <code>.env</code> file, then
            restart the server.
          </p>
          <button type="button" className="auth-btn auth-btn--ghost" onClick=${onClose}>
            CLOSE
          </button>
        </div>
      </div>
    `
  }

  if (tab === 'forgot') {
    return html`
      <div className="auth-modal">
        <section className="auth-modal__card" role="dialog" aria-modal="true" aria-labelledby="forgot-password-title">
          <h2 id="forgot-password-title">Reset your password</h2>
          <p>Enter your account email and we’ll send you a reset link.</p>
          <form onSubmit=${(event) => { event.preventDefault(); auth.requestPasswordReset(email) }}>
            <label className="auth-field">
              EMAIL
              <input type="email" autoComplete="email" required value=${email} onInput=${(event) => setEmail(event.target.value)} placeholder="you@example.com" />
            </label>
            <button type="submit" className="auth-btn" disabled=${auth.pending}>${auth.pending ? 'Sending…' : 'Send reset link'}</button>
          </form>
          ${auth.error && html`<p className="auth-error" role="alert">${auth.error}</p>`}
          ${auth.notice && html`<p role="status">${auth.notice}</p>`}
          <button type="button" className="auth-btn auth-btn--ghost" disabled=${auth.pending} onClick=${() => { auth.clearMessages(); setTab('email') }}>Back to sign in</button>
          <button type="button" className="auth-btn auth-btn--ghost" onClick=${onClose}>Close</button>
        </section>
      </div>
    `
  }

  if (auth.status === 'authenticated' && auth.user && !auth.user.is_anonymous) {
    const display = auth.profile?.display_name || auth.user.email || 'Player'
    return html`
      <div className="auth-modal">
        <div className="auth-modal__card">
          <h2>CONNECTED</h2>
          <div className="auth-user">
            <span className="auth-user__avatar">${(display || '?').charAt(0).toUpperCase()}</span>
            <div>
              <strong>${display}</strong>
              <small>${auth.user.email}</small>
            </div>
          </div>
          <button type="button" className="auth-btn" onClick=${auth.signOut}>
            SIGN OUT
          </button>
          <button type="button" className="auth-btn auth-btn--ghost" onClick=${onClose}>
            CLOSE
          </button>
        </div>
      </div>
    `
  }

  return html`
    <div className="auth-modal">
      <div className="auth-modal__card">
        <h2>PLAYER SIGN IN</h2>
        <div className="auth-tabs">
          <button
            type="button"
            className=${`auth-tab${tab === 'email' ? ' is-active' : ''}`}
            onClick=${() => setTab('email')}
          >
            EMAIL SIGN IN
          </button>
        </div>

        ${html`
              <label className="auth-field">
                DISPLAY NAME
                <input
                  type="text"
                  value=${name}
                  onInput=${(e) => setName(e.target.value)}
                  placeholder="Elite Listener"
                />
              </label>
              <label className="auth-field">
                EMAIL
                <input
                  type="email"
                  value=${email}
                  onInput=${(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              <label className="auth-field">
                PASSWORD
                <input
                  type="password"
                  value=${password}
                  onInput=${(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </label>
              <button
                type="button"
                className="auth-btn"
                disabled=${auth.pending}
                onClick=${() => auth.signInWithEmail(email, password)}
              >
                SIGN IN
              </button>
              <button type="button" className="auth-forgot" disabled=${auth.pending} onClick=${() => { auth.clearMessages(); setTab('forgot') }}>Forgot password?</button>
              <div className="auth-actions">
                <button
                  type="button"
                  className="auth-btn auth-btn--ghost"
                  disabled=${auth.pending}
                  onClick=${() => auth.signUp(email, password, name || 'Player')}
                >
                  CREATE ACCOUNT
                </button>
                <button type="button" className="auth-btn auth-btn--ghost" onClick=${onClose}>
                  CLOSE
                </button>
              </div>
            `}

        ${auth.pending && html`<p role="status">Please wait…</p>`}
        ${auth.error && html`<p className="auth-error" role="alert">${auth.error}</p>`}
        ${auth.notice && html`<p role="status">${auth.notice}</p>`}
      </div>
    </div>
  `
}
