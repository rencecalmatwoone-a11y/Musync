import { html } from '../html.js'

function Status({ status }) {
  if (status === 'guessed') {
    return html`<span className="standings-status is-guessed">✓ Guessed</span>`
  }
  if (status === 'missed') {
    return html`<span className="standings-status is-missed">✕ Missed</span>`
  }
  return html`<span className="standings-status is-thinking">↻ Thinking...</span>`
}

export default function LobbyStandings({ players }) {
  return html`
    <section className="standings">
      <div className="standings-head">
        <span>Player</span>
        <span>Score</span>
      </div>
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
                <${Status} status=${player.status} />
              </div>
              <span className="standings-score">${player.score.toLocaleString()}</span>
            </li>
          `,
        )}
      </ol>
    </section>
  `
}
