import { html } from '../html.js'
import Difficulty from './Difficulty.js'
import Flame from './FlameIcon.js'

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
          <${Flame} className="flame" />
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
