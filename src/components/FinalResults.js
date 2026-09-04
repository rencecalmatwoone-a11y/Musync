import { html } from '../html.js'
import ModeToggle from './ModeToggle.js'

export default function FinalResults({ players, yourRank, you, accuracy, avgSpeed, totalRounds, onPlayAgain, onBackToLobby }) {
  return html`
    <div className="final-results">
      <div className="final-results__header">
        <h1>BATTLE COMPLETE</h1>
        <p className="final-results__subtitle">Final Standings</p>
      </div>

      <div className="final-results__grid">
        <div className="final-results__stat-card final-results__stat-card--rank">
          <span className="final-results__kicker">YOUR RANK</span>
          <span className="final-results__big">${yourRank}<small>/${players.length}</small></span>
        </div>
        <div className="final-results__stat-card">
          <span className="final-results__kicker">MATCH SCORE</span>
          <span className="final-results__big">${you?.score?.toLocaleString() ?? '0'}</span>
        </div>
        <div className="final-results__stat-card">
          <span className="final-results__kicker">ACCURACY</span>
          <span className="final-results__big">${accuracy}%</span>
        </div>
        <div className="final-results__stat-card">
          <span className="final-results__kicker">BEST STREAK</span>
          <span className="final-results__big">x${Math.max(you?.correct ?? 0, 3)}</span>
        </div>
        <div className="final-results__stat-card">
          <span className="final-results__kicker">AVG SPEED</span>
          <span className="final-results__big">${avgSpeed}s</span>
        </div>
        <div className="final-results__stat-card">
          <span className="final-results__kicker">CORRECT</span>
          <span className="final-results__big">${you?.correct ?? 0}<small>/${totalRounds}</small></span>
        </div>
      </div>

      <div className="final-results__leaderboard">
        <h2>FINAL LEADERBOARD</h2>
        <ol className="standings-list">
          ${players.map(
            (player) => html`
              <li
                key=${player.id}
                className=${`standings-row${player.you ? ' is-you' : ''}`}
              >
                <span className="standings-rank">${player.rank}</span>
                <div className="standings-meta">
                  <strong>${player.name}${player.you ? ' (You)' : ''}</strong>
                </div>
                <span className="standings-score">${player.score.toLocaleString()}</span>
              </li>
            `,
          )}
        </ol>
      </div>

      <div className="final-results__actions">
        <button type="button" className="final-results__btn final-results__btn--primary" onClick=${onPlayAgain}>
          PLAY AGAIN
        </button>
        <button type="button" className="final-results__btn" onClick=${onBackToLobby}>
          BACK TO CLASSIC
        </button>
      </div>
    </div>
  `
}
