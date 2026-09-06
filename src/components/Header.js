import { useEffect, useState } from 'https://esm.sh/react@19'
import { html } from '../html.js'
import ModeToggle from './ModeToggle.js'
import { disconnectSpotifyPlayback } from '../hooks/useTrackAudio.js'
import { spotifyLoginUrl, spotifySessionHeaders, getSpotifyAuthStatus, clearSpotifyClientSession } from '../spotify/client.js'

export function SpotifyAccountControl() {
  const [spotifyAuthed, setSpotifyAuthed] = useState(false)
  const [spotifyProfile, setSpotifyProfile] = useState(null)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    let alive = true
    getSpotifyAuthStatus()
      .then((status) => {
        if (alive) {
          setSpotifyAuthed(Boolean(status.authed))
          setSpotifyProfile(status.profile || null)
        }
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  async function logoutSpotify() {
    setLoggingOut(true)
    try {
      await fetch('/api/spotify/logout', { method: 'POST', headers: spotifySessionHeaders() })
      await disconnectSpotifyPlayback()
      clearSpotifyClientSession()
      setSpotifyAuthed(false)
    } finally {
      setLoggingOut(false)
    }
  }

  return html`
    <div className="spotify-account">
      <div className="spotify-account__identity">
        <span className="spotify-account__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="M7.7 9.2c2.9-.8 5.9-.5 8.6.7M8.3 12.3c2.4-.6 4.9-.3 7.1.7M9.2 15.2c1.8-.4 3.6-.2 5.2.5" />
          </svg>
        </span>
        <span className="spotify-account__copy">
          <span className="spotify-account__label">SPOTIFY</span>
          <span className="spotify-account__status">${spotifyAuthed ? (spotifyProfile?.displayName || 'CONNECTED') : 'NOT CONNECTED'}</span>
        </span>
      </div>
      ${spotifyAuthed
        ? html`
            <button
              type="button"
              className="spotify-account__logout"
              onClick=${logoutSpotify}
              disabled=${loggingOut}
            >
              ${loggingOut ? 'SIGNING OUT...' : 'SIGN OUT'}
            </button>
          `
        : html`<a className="spotify-account__login" href=${spotifyLoginUrl()}>CONNECT</a>`}
    </div>
  `
}

export default function Header({ mode, onModeChange, showModeToggle }) {
  return html`
    <header className="header">
      ${showModeToggle &&
      html`<${ModeToggle} value=${mode} onChange=${onModeChange} />`}
    </header>
  `
}
