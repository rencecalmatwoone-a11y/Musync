import { html } from '../html.js'
import Difficulty from './Difficulty.js'

function FlameIcon() {
  return html`
    <svg className="flame" viewBox="0 0 12 14" fill="currentColor" aria-hidden="true">
      <path d="M6 1C6 1 9 5 9 8C9 10.2 7.5 11.5 6 11.5C4.5 11.5 3 10.2 3 8C3 5 6 1 6 1ZM6 12.5C7.5 12.5 8.5 13.2 8.5 14H3.5C3.5 13.2 4.5 12.5 6 12.5Z" />
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
