import { useEffect, useState } from 'https://esm.sh/react@19'
import { html } from '../html.js'
import { setAudioVolume } from '../hooks/useAudioSettings.js'

export default function SettingsPanel({ settings, onUpdate, onClose }) {
  const [local, setLocal] = useState({ ...settings })

  useEffect(() => {
    setLocal({ ...settings })
  }, [settings])

  function handleChange(key, value) {
    const next = { ...local, [key]: value }
    setLocal(next)
    if (key === 'volume') setAudioVolume(value)
    onUpdate(next)
  }

  return html`
    <div className="settings-overlay" onClick=${(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="settings-modal" role="dialog" aria-label="Settings">
        <div className="settings-header">
          <h2>SETTINGS</h2>
          <button type="button" className="settings-close" onClick=${onClose} aria-label="Close settings">✕</button>
        </div>

        <div className="settings-body">
          <div className="settings-row">
            <div className="settings-row__info">
              <span className="settings-label">Sound Effects</span>
              <span className="settings-desc">Play sounds on correct/incorrect answers</span>
            </div>
            <button
              type="button"
              className=${`settings-toggle ${local.sfx ? 'is-on' : ''}`}
              onClick=${() => handleChange('sfx', !local.sfx)}
              aria-pressed=${local.sfx}
            >
              <span className="settings-toggle__knob" />
            </button>
          </div>

          <div className="settings-row">
            <div className="settings-row__info">
              <span className="settings-label">Music Volume</span>
              <span className="settings-desc">${local.volume}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value=${local.volume}
              onChange=${(e) => handleChange('volume', Number(e.target.value))}
              className="settings-range"
            />
          </div>

          <div className="settings-row">
            <div className="settings-row__info">
              <span className="settings-label">Reduced Motion</span>
              <span className="settings-desc">Minimize animations</span>
            </div>
            <button
              type="button"
              className=${`settings-toggle ${local.reducedMotion ? 'is-on' : ''}`}
              onClick=${() => handleChange('reducedMotion', !local.reducedMotion)}
              aria-pressed=${local.reducedMotion}
            >
              <span className="settings-toggle__knob" />
            </button>
          </div>
        </div>
      </div>
    </div>
  `
}
