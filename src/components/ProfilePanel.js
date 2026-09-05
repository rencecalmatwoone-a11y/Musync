import { useState } from 'https://esm.sh/react@19'
import { html } from '../html.js'

export default function ProfilePanel({ name, onSaveName, profile, score, streak, accuracy, attempts, genre, onGenreChange }) {
  const [draft, setDraft] = useState(name || '')
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)

  const displayName = name || profile?.display_name || 'Elite Listener'
  const initial = (displayName || 'E').trim().charAt(0).toUpperCase()

  const stats = [
    { label: 'LIFETIME SCORE', value: score.toLocaleString(), accent: true },
    { label: 'BEST STREAK', value: `${Math.max(streak, 5)}x` },
    { label: 'ACCURACY', value: `${accuracy}%` },
    { label: 'ROUNDS PLAYED', value: attempts },
  ]

  const saveName = () => {
    const trimmed = (draft || '').trim() || 'Elite Listener'
    if (onSaveName) onSaveName(trimmed)
    setEditing(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  return html`
    <div className="mp-page">
      <header className="mp-page__header">
        <span className="mp-page__eyebrow">YOUR PROFILE</span>
        <h1 className="mp-page__title">PROFILE</h1>
        <p className="mp-page__sub">Your listening identity across every round of Musync.</p>
      </header>

      <section className="player-card">
        <div className="player-card__grad" aria-hidden="true"></div>
        <div className="player-card__row">
          <div className="player-avatar" aria-hidden="true">
            <span>${initial}</span>
          </div>
          <div className="player-card__id">
            <h2>${displayName}</h2>
            <div className="player-card__tags">
              <span className="plan-badge plan-badge--ghost">ELITE LISTENER</span>
            </div>
          </div>
        </div>
        <div className="player-card__stats">
          ${stats.map((s) => html`
            <div className=${`stat-tile${s.accent ? ' is-accent' : ''}`} key=${s.label}>
              <span className="stat-tile__label">${s.label}</span>
              <strong className="stat-tile__value">${s.value}</strong>
            </div>
          `)}
        </div>
      </section>

      <div className="mp-page__grid">
        <section className="panel-card">
          <div className="panel-card__head">
            <h3>ACCOUNT</h3>
            <span className="panel-card__hint">MEMBERSHIP</span>
          </div>
          <div className="account-form">
            <label className="mp-field">
              <span className="mp-field__label">DISPLAY NAME</span>
              ${editing
                ? html`<input className="mp-field__input" value=${draft} onInput=${(e) => setDraft(e.target.value)} />`
                : html`<input className="mp-field__input" value=${displayName} disabled />`}
            </label>
            <label className="mp-field">
              <span className="mp-field__label">FAVORITE GENRE</span>
              <select className="mp-field__input" value=${genre} onChange=${(e) => onGenreChange && onGenreChange(e.target.value)}>
                <option>Any Genre</option>
                <option>Pop</option>
                <option>Rock</option>
              </select>
            </label>
          </div>
          <div className="panel-card__actions">
            ${editing
              ? html`
                <button type="button" className="mp-btn mp-btn--gold" onClick=${saveName}>${saved ? 'SAVED ✓' : 'SAVE CHANGES'}</button>
                <button type="button" className="mp-btn mp-btn--ghost" onClick=${() => { setEditing(false); setDraft(displayName) }}>CANCEL</button>
              `
              : html`
                <button type="button" className="mp-btn mp-btn--gold" onClick=${() => { setDraft(displayName); setEditing(true) }}>EDIT PROFILE</button>
              `}
          </div>
        </section>

        <section className="panel-card">
          <div className="panel-card__head">
            <h3>PREFERENCES</h3>
            <span className="panel-card__hint">IN-GAME</span>
          </div>
          <div className="panel-prefs">
            <div className="panel-prefs__row">
              <div className="settings-row__info">
                <span className="settings-label">Show hints</span>
                <span className="settings-desc">Reveal artist hints while listening</span>
              </div>
              <button type="button" className="settings-toggle is-on" aria-pressed="true"><span className="settings-toggle__knob" /></button>
            </div>
            <div className="panel-prefs__row">
              <div className="settings-row__info">
                <span className="settings-label">Autoplay next clip</span>
                <span className="settings-desc">Skip straight into the next round</span>
              </div>
              <button type="button" className="settings-toggle is-on" aria-pressed="true"><span className="settings-toggle__knob" /></button>
            </div>
          </div>
        </section>
      </div>
    </div>
  `
}
