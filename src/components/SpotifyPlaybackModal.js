import { html } from '../html.js'
import { createPortal } from 'https://esm.sh/react-dom@19'

export default function SpotifyPlaybackModal({ state, onRetry, onBack, onLogin, onPractice }) {
  if (!state) return null
  const connecting = state === 'connecting'
  const premium = state === 'premium-required'
  const quota = state === 'quota-exceeded'
  const failed = state === 'error'
  const login = state === 'login-required'

  return createPortal(html`
    <div className="spotify-modal-backdrop" role="presentation">
      <section className="spotify-modal" role="dialog" aria-modal="true" aria-labelledby="spotify-modal-title">
        <p className="spotify-modal__eyebrow">SPOTIFY REQUIRED</p>
        <h2 id="spotify-modal-title">${connecting ? 'Connecting to Spotify...' : premium ? 'Spotify Premium required' : quota ? 'Spotify temporarily unavailable' : failed ? 'Spotify playback unavailable' : 'Connect Spotify'}</h2>
        <p>
          ${premium
            ? 'Spotify Premium is required to play Musync.'
            : quota
            ? 'Spotify cannot be used at the moment because the development quota has been reached. Please try again later.'
            : failed
            ? "We couldn't start Spotify playback. Please make sure Spotify is open/available and try again."
            : login
            ? 'Connect your Spotify Premium account to play Musync.'
            : 'Preparing your Spotify player...'}
        </p>
        ${!connecting && html`
          <div className="spotify-modal__actions">
            ${login && html`<a className="auth-btn spotify-modal__primary" href="/api/spotify/login" onClick=${onLogin}>Continue with Spotify</a>`}
            ${(premium || failed || quota) && html`
              <div className="spotify-modal__button-row">
                <button type="button" className="auth-btn spotify-modal__primary" onClick=${onRetry}>Try Again</button>
                <button type="button" className="auth-btn auth-btn--ghost" onClick=${onBack}>Back</button>
              </div>
            `}
            ${(quota || failed) && onPractice && html`<button type="button" className="spotify-modal__practice" onClick=${onPractice}>Practice VS AI instead</button>`}
            ${login && html`<button type="button" className="auth-btn auth-btn--ghost" onClick=${onBack}>Back</button>`}
          </div>
        `}
      </section>
    </div>
  `, document.body)
}
