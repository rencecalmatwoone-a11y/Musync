import { html } from '../html.js'
import { DIFFICULTIES } from '../difficulty.js'

export default function Difficulty({ value, onChange, maxIndex = DIFFICULTIES.length - 1 }) {
  const options = DIFFICULTIES.slice(0, maxIndex + 1)

  return html`
    <section className="difficulty">
      <h3 className="difficulty__title">DIFFICULTY</h3>
      <div className="difficulty__bar" role="group" aria-label="Difficulty">
        ${options.map(
          (d, index) => html`
            <button
              key=${d.key}
              type="button"
              className=${`diff-seg${index === value ? ' is-on' : ''}`}
              aria-label=${d.label}
              style=${{ '--seg': d.color, '--seg-glow': d.glow }}
              onClick=${() => onChange(index)}
            />
          `,
        )}
      </div>
      <div className="difficulty__labels">
        ${options.map(
          (d, index) => html`
            <button
              type="button"
              key=${d.key}
              className=${index === value ? 'is-active' : ''}
              style=${{ '--seg': d.color, '--seg-glow': d.glow }}
              aria-label=${`Select ${d.label} difficulty`}
              aria-pressed=${index === value}
              onClick=${() => onChange(index)}
            >
              ${d.label}
            </button>
          `,
        )}
      </div>
    </section>
  `
}
