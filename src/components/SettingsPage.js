import { useEffect, useState } from 'https://esm.sh/react@19'
import { html } from '../html.js'
import { DIFFICULTIES } from '../difficulty.js'
import useAudioVolume, { setAudioVolume } from '../hooks/useAudioSettings.js'

const DEFAULT_SETTINGS = { sfx: true, volume: 80, reducedMotion: false }

function loadSettings() {
  try {
    const saved = localStorage.getItem('musync-settings')
    if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) }
  } catch {}
  return { ...DEFAULT_SETTINGS }
}

export default function SettingsPage({ difficulty, onDifficultyChange, showDifficulty = true }) {
  const [settings, setSettings] = useState(loadSettings)
  const audioVolume = useAudioVolume()

  useEffect(() => {
    const nextVolume = Math.round(audioVolume * 100)
    setSettings((current) => current.volume === nextVolume ? current : { ...current, volume: nextVolume })
  }, [audioVolume])

  function update(patch) {
    const next = { ...settings, ...patch }
    setSettings(next)
    if (patch.volume !== undefined) setAudioVolume(patch.volume)
    try {
      localStorage.setItem('musync-settings', JSON.stringify(next))
    } catch {}
  }

  const groups = [
    {
      title: 'PLAYBACK',
      hint: 'AUDIO',
      rows: html`
        <div className="settings-row">
          <div className="settings-row__info">
            <span className="settings-label">Sound Effects</span>
            <span className="settings-desc">Play sounds on correct / incorrect answers</span>
          </div>
          <button type="button" className=${`settings-toggle${settings.sfx ? ' is-on' : ''}`} aria-pressed=${settings.sfx} onClick=${() => update({ sfx: !settings.sfx })}><span className="settings-toggle__knob" /></button>
        </div>
        <div className="settings-row">
          <div className="settings-row__info">
            <span className="settings-label">Music Volume</span>
            <span className="settings-desc">Master volume for in-game audio (${settings.volume}%)</span>
          </div>
          <input type="range" min="0" max="100" value=${settings.volume} className="settings-range" onChange=${(e) => update({ volume: Number(e.target.value) })} />
        </div>
      `,
    },
    {
      title: 'GAME',
      hint: 'ROUNDS',
      rows: html`
        ${showDifficulty && html`
        <div className="settings-row">
          <div className="settings-row__info">
            <span className="settings-label">Difficulty</span>
            <span className="settings-desc">Affects point multipliers and pacing</span>
          </div>
          <div className="settings-diff">
            ${DIFFICULTIES.map((d, i) => html`
              <button key=${d.key} type="button" className=${`settings-diff__btn${difficulty === i ? ' is-active' : ''}`} style=${{ '--seg': d.color, '--seg-glow': d.glow }} onClick=${() => onDifficultyChange(i)}>${d.label}</button>
            `)}
          </div>
        </div>
        `}
        <div className="settings-row">
          <div className="settings-row__info">
            <span className="settings-label">Reduced Motion</span>
            <span className="settings-desc">Minimize animations across the app</span>
          </div>
          <button type="button" className=${`settings-toggle${settings.reducedMotion ? ' is-on' : ''}`} aria-pressed=${settings.reducedMotion} onClick=${() => update({ reducedMotion: !settings.reducedMotion })}><span className="settings-toggle__knob" /></button>
        </div>
      `,
    },
  ]

  return html`
    <div className="mp-page">
      <header className="mp-page__header">
        <span className="mp-page__eyebrow">PREFERENCES</span>
        <h1 className="mp-page__title">SETTINGS</h1>
        <p className="mp-page__sub">Tune Audioguide to your taste — audio, difficulty, and motion.</p>
      </header>

      <div className="mp-page__stack">
        ${groups.map((g) => html`
          <section className="panel-card" key=${g.title}>
            <div className="panel-card__head">
              <h3>${g.title}</h3>
              <span className="panel-card__hint">${g.hint}</span>
            </div>
            <div className="patch-panel-body">${g.rows}</div>
          </section>
        `)}
      </div>
    </div>
  `
}
