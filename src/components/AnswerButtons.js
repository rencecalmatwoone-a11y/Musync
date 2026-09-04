import { html } from '../html.js'

export default function AnswerButtons({ options, value, onChange, label = '' }) {
  const index = options.indexOf(value)
  const hasPrev = index > 0
  const hasNext = index < options.length - 1

  function step(dir) {
    const next = Math.min(Math.max(index + dir, 0), options.length - 1)
    onChange(options[next])
  }

  return html`
    <div className="carousel" role="group" aria-label=${label}>
      <button
        type="button"
        className="carousel__zone carousel__zone--left"
        aria-label="Previous option"
        disabled=${!hasPrev}
        onClick=${() => step(-1)}
      />
      <div className="carousel__stage">
        ${options.map(
          (option, i) => {
            const diff = i - index
            return html`
              <button
                key=${option}
                type="button"
                className=${`carousel__item${diff === 0 ? ' is-active' : ''}`}
                style=${{
                  '--offset': `${diff * 118}%`,
                  '--scale': diff === 0 ? 1 : 0.78,
                  '--rotate': `${diff * 14}deg`,
                  '--fade': diff === 0 ? 1 : 0.4,
                  zIndex: 10 - Math.abs(diff),
                }}
                onClick=${() => onChange(option)}
                tabIndex=${diff === 0 ? 0 : -1}
              >
                ${option}
              </button>
            `
          },
        )}
      </div>
      <button
        type="button"
        className="carousel__zone carousel__zone--right"
        aria-label="Next option"
        disabled=${!hasNext}
        onClick=${() => step(1)}
      />
    </div>
  `
}