import { html } from '../html.js'
import { DIFFICULTIES } from '../difficulty.js'

export default function RoundLoadingScreen({ round, totalRounds, difficulty, practice, reducedMotion, onBack }) {
  const nextRound = (round % totalRounds) + 1

  return html`
    <section className=${`round-loading${reducedMotion ? ' is-still' : ''}`} aria-labelledby="round-loading-title">
      <header className="round-loading__header">
        <span className="round-loading__eyebrow">MUSYNC <span aria-hidden="true">/</span> SOUND CHECK</span>
        <button type="button" className="round-loading__back" onClick=${onBack}>
          <span aria-hidden="true">←</span> BACK TO LOBBY
        </button>
      </header>

      <div className="round-loading__stage">
        <div className="round-loading__copy">
          <div className="round-loading__context">
            <span>${practice ? 'VS AI' : 'PRIVATE MATCH'}</span>
            <span>ROUND <strong>${String(nextRound).padStart(2, '0')}</strong> / ${totalRounds}</span>
            <span>${DIFFICULTIES[difficulty]?.label || 'Medium'}</span>
          </div>
          <h1 id="round-loading-title">${nextRound === 1 ? 'GET YOUR' : 'KEEP YOUR'}<br /><em>EARS READY.</em></h1>
          <p className="round-loading__description">${nextRound === 1 ? 'A fresh track is finding its way to you.' : 'The next track is almost ready.'}</p>
          <div className="round-loading__status" role="status" aria-live="polite">
            <span className="round-loading__status-dot" aria-hidden="true"></span>
            Finding your next track<span className="round-loading__ellipsis" aria-hidden="true">…</span>
          </div>
        </div>

        <div className="round-loading__visual" aria-hidden="true">
          <div className="round-loading__signal">
            ${[14, 28, 42, 22, 34, 18, 30, 46, 24, 38, 16, 28, 42, 20, 34].map((height, i) => html`<span key=${i} style=${{ '--bar-height': `${height}px`, '--bar-delay': `${i * -0.12}s` }}></span>`)}
          </div>
          <div className="round-loading__progress"><span></span></div>
          <span className="round-loading__signal-label">TUNING IN</span>
        </div>
      </div>
    </section>
  `
}
