import { html } from '../html.js'

export default function BattleIntel({ rank, total, gap, score, streak, avgSpeed, accuracy, correct, asked, remaining }) {
  const segments = [
    ...Array.from({ length: correct }, () => 'hit'),
    ...Array.from({ length: Math.max(0, asked - correct) }, () => 'miss'),
    ...Array.from({ length: remaining }, () => 'todo'),
  ]

  return html`
    <aside className="intel intel--multiplayer">
      <h2 className="intel__title">BATTLE INTEL</h2>

      <article className="intel-card intel-card--rank">
        <p className="intel-kicker">CURRENT RANK</p>
        <p className="intel-rank">
          <span>${rank}<small>st</small></span>
          <span className="intel-rank__of">/ ${total}</span>
        </p>
        <div className="intel-gap">
          <span>GAP TO 2ND</span>
          <strong>+${gap} pts</strong>
        </div>
        <div className="intel-gap-bar">
          <i style=${{ width: '72%' }}></i>
        </div>
      </article>

      <article className="intel-card">
        <p className="intel-kicker">MATCH SCORE</p>
        <p className="intel-score">${score.toLocaleString()}</p>
        <div className="intel-mini">
          <span>🔥 STREAK <b>x${streak}</b></span>
          <span>⏱ AVG SPEED <b>${avgSpeed}s</b></span>
        </div>
      </article>

      <article className="intel-card">
        <p className="intel-kicker">ACCURACY</p>
        <p className="intel-acc">
          ${accuracy}% <small>${correct}/${asked} correct</small>
        </p>
        <div className="intel-pips">
          ${segments.map(
            (kind, index) => html`<i key=${index} className=${`pip pip--${kind}`}></i>`,
          )}
        </div>
      </article>
    </aside>
  `
}
