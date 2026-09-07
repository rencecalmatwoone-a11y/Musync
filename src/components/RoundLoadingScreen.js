import { html } from '../html.js'
import { DIFFICULTIES } from '../difficulty.js'

export default function RoundLoadingScreen({ round, totalRounds, difficulty, practice, reducedMotion, onBack }) {
  const nextRound = (round % totalRounds) + 1

  return html`
    <section className=${`round-loading${reducedMotion ? ' is-still' : ''}`} aria-labelledby="round-loading-title">
      <header className="round-loading__header">
        <span className="round-loading__eyebrow">MUSYNC <span aria-hidden="true">/</span> <span className="round-loading__section-name">Sound check</span></span>
        <button type="button" className="round-loading__back" onClick=${onBack}>
          <span aria-hidden="true">←</span> Back to lobby
        </button>
      </header>

      <div className="round-loading__stage">
        <div className="round-loading__signal" aria-hidden="true">
          ${[20, 26, 30, 26, 20].map((height, i) => html`<span key=${i} style=${{ '--bar-height': `${height}px`, '--bar-delay': `${i * -0.23}s`, '--bar-duration': `${0.9 + i * 0.13}s` }}></span>`)}
        </div>
        <h1 id="round-loading-title">Preparing your round</h1>
        <p className="round-loading__status" role="status" aria-live="polite">
          ${nextRound === 1 ? 'Finding your first track…' : 'Finding your next track…'}
        </p>
        <div className="round-loading__context" aria-label="Match details">
          <span>${practice ? 'VS AI' : 'Private match'}</span>
          <span>Round <strong>${String(nextRound).padStart(2, '0')}</strong> / ${totalRounds}</span>
          <span className="round-loading__difficulty">${DIFFICULTIES[difficulty]?.label.toLowerCase() || 'medium'}</span>
        </div>
      </div>
    </section>
  `
}
