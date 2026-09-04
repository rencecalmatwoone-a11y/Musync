import { html } from '../html.js'

const MODES = [
  { id: 'classic', label: 'Classic' },
  { id: 'multiplayer', label: 'Multiplayer' },
]

export default function ModeToggle({ value, onChange, disabled = false }) {
  function handleKeyDown(e) {
    if (disabled) return
    const current = MODES.findIndex((m) => m.id === value)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = (current + 1) % MODES.length
      onChange(MODES[next].id)
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = (current - 1 + MODES.length) % MODES.length
      onChange(MODES[prev].id)
    }
  }

  return html`
    <div className="mode-toggle" role="tablist" aria-label="Game mode" onKeyDown=${handleKeyDown}>
      ${MODES.map(
        (mode) => html`
          <button
            key=${mode.id}
            type="button"
            role="tab"
            aria-selected=${value === mode.id}
            tabIndex=${value === mode.id ? 0 : -1}
            disabled=${disabled}
            className=${`mode-toggle__btn${value === mode.id ? ' is-active' : ''}`}
            onClick=${() => !disabled && onChange(mode.id)}
          >
            ${mode.label}
          </button>
        `,
      )}
    </div>
  `
}
