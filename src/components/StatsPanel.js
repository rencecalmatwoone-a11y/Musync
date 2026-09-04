import { html } from '../html.js'
import Difficulty from './Difficulty.js'

function FlameIcon() {
  return html`
    <svg className="flame" viewBox="0 0 12 14" aria-hidden="true">
      <path
        d="M6 1c.4 2.2-1.4 3.1-1.2 5.1C6.2 5.4 8 4.2 9.1 6.2 10.4 8.4 8.7 12.4 6 13c-3.2-.7-4.4-4.6-2.6-7.1C4.6 4.2 5.4 3.2 6 1z"
        fill="currentColor"
      />
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
