import { html } from '../html.js'
import Difficulty from './Difficulty.js'

function FlameIcon() {
  return html`
    <svg className="flame" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5c.6 3.5-2.7 5.1-2.7 8.2 0 1.5 1 2.6 2.4 2.6 1.6 0 2.6-1.3 2.6-3.1 2.2 1.7 3.3 3.7 3.3 5.7 0 3.7-2.9 6.1-6.5 6.1S4.5 19.6 4.5 16c0-3.2 2.1-5.9 5.2-8.2-.1 1.4.2 2.3.8 3 .3-2.8 2.3-4.8 1.5-8.3Z" />
    </svg>
  `
}

export default function StatsPanel({
  round,
  score,
  streak,
  accuracy,
  difficulty,
  onDifficultyChange,
}) {
  return html`
    <aside className="stats-panel stats-panel--classic">
      <div className="stats-top">
        <span className="round-label">Round ${String(round).padStart(2, '0')}</span>
      </div>

      <div className="stat-block">
        <p className="stat-label">Total Score</p>
        <p className="stat-value">${score.toLocaleString()}</p>
      </div>

      <div className="stat-block stat-block--streak">
        <p className="stat-label">
          Current Streak
          <${FlameIcon} />
        </p>
        <p className="stat-value stat-value--accent">${streak}x</p>
      </div>

      <div className="stat-block">
        <p className="stat-label">Accuracy</p>
        <p className="stat-value">${accuracy}%</p>
      </div>

      <${Difficulty} value=${difficulty} onChange=${onDifficultyChange} />

    </aside>
  `
}
