import { useState } from 'https://esm.sh/react@19'
import { html } from '../html.js'

export default function PasswordRecoveryModal({ auth }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [validationError, setValidationError] = useState('')
  const ready = auth.status === 'authenticated' && Boolean(auth.user)

  function submit(event) {
    event.preventDefault()
    if (password !== confirmPassword) {
      setValidationError('Passwords do not match.')
      return
    }
    setValidationError('')
    auth.updatePassword(password)
  }

  return html`
    <div className="auth-modal">
      <section className="auth-modal__card" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
        <h2 id="recovery-title">${auth.passwordUpdated ? 'Password updated' : 'Set a new password'}</h2>
        ${auth.passwordUpdated ? html`
          <p role="status">Your password has been updated. You can now continue to Musync.</p>
          <button type="button" className="auth-btn" onClick=${auth.closeRecovery}>Continue</button>
        ` : auth.status === 'loading' ? html`
          <p role="status">Checking your reset link…</p>
        ` : !ready ? html`
          <p role="alert">This reset link has expired or is invalid. Return to email sign-in and request a new link.</p>
          <button type="button" className="auth-btn auth-btn--ghost" onClick=${auth.closeRecovery}>Close</button>
        ` : html`
          <p>Choose a new password for your account.</p>
          <form onSubmit=${submit}>
            <label className="auth-field">NEW PASSWORD
              <input type="password" autoComplete="new-password" required minLength="6" value=${password} onInput=${(event) => setPassword(event.target.value)} />
            </label>
            <label className="auth-field">CONFIRM PASSWORD
              <input type="password" autoComplete="new-password" required minLength="6" value=${confirmPassword} onInput=${(event) => setConfirmPassword(event.target.value)} />
            </label>
            <button type="submit" className="auth-btn" disabled=${auth.pending}>${auth.pending ? 'Saving…' : 'Update password'}</button>
          </form>
          ${(validationError || auth.error) && html`<p className="auth-error" role="alert">${validationError || auth.error}</p>`}
          <button type="button" className="auth-btn auth-btn--ghost" disabled=${auth.pending} onClick=${auth.closeRecovery}>Cancel</button>
        `}
      </section>
    </div>
  `
}
