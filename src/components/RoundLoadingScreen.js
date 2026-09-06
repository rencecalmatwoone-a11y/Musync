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
        <div className="round-loading__visual" aria-hidden="true">
          <div className="round-loading__orbit"></div>
          <div className="round-loading__record">
            <div className="round-loading__label">
              <div className="round-loading__wave">
                ${[14, 26, 38, 22, 32].map((height, i) => html`<span key=${i} style=${{ '--bar-height': `${height}px`, '--bar-delay': `${i * -0.16}s` }}></span>`)}
              </div>
            </div>
          </div>
          <span className="round-loading__spark round-loading__spark--one">+</span>
          <span className="round-loading__spark round-loading__spark--two">+</span>
        </div>

        <div className="round-loading__context">
          <span>${practice ? 'VS AI' : 'PRIVATE MATCH'}</span>
          <span>ROUND <strong>${String(nextRound).padStart(2, '0')}</strong> / ${totalRounds}</span>
          <span>${DIFFICULTIES[difficulty]?.label || 'Medium'}</span>
        </div>
        <h1 id="round-loading-title">${nextRound === 1 ? 'GET YOUR' : 'KEEP YOUR'}<br /><em>EARS READY.</em></h1>
        <p className="round-loading__description">${nextRound === 1 ? 'A fresh track. A new challenge. Your stage.' : 'New track, same mission. Make the next guess count.'}</p>

        <div className="round-loading__status" role="status" aria-live="polite">
          <span className="round-loading__status-dot" aria-hidden="true"></span>
          Finding your next track<span className="round-loading__ellipsis" aria-hidden="true">…</span>
        </div>
        <p className="round-loading__hint">Your round starts automatically when the track is ready.</p>
      </div>

      <footer className="round-loading__footer">
        <span>LISTEN CLOSELY. GUESS QUICKLY.</span>
        <span className="round-loading__footer-bars" aria-hidden="true">${[1, 2, 3, 4, 5, 6, 7].map((i) => html`<i key=${i}></i>`)}</span>
        <span>LET THE MUSIC DO THE TALKING.</span>
      </footer>
    </section>
  `
}
