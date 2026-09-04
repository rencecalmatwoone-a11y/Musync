import { useEffect, useRef } from 'https://esm.sh/react@19'
import { html } from '../html.js'
import useClipTimer from '../hooks/useClipTimer.js'
import usePreviewAudio from '../hooks/usePreviewAudio.js'

const SIZE = 168
const STROKE = 5
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export default function BattleArena({
  roundOptions,
  selectedAnswer,
  isCorrectAnswer,
  correctSongId,
  onAnswer,
  clipDuration,
  timerElapsed,
  timerDuration,
  phase,
  playbackUrl,
  audioLoading = false,
  audioError = null,
}) {
  const clip = useClipTimer(clipDuration)
  const audio = usePreviewAudio()
  const prefs = audio.attach

  // Keep the Spotify preview in sync with the existing clip timer.
  useEffect(() => {
    if (phase === 'playing') audio.sync(playbackUrl, clip.playing)
    else audio.stop()
  }, [phase, playbackUrl, clip.playing])

  // A new round means a fresh clip: start playback from the beginning when we
  // enter a playing round, otherwise reset to idle. Keyed on round options so a
  // brand-new set of choices always triggers it.
  useEffect(() => {
    if (phase === 'playing') clip.play()
    else clip.reset()
  }, [roundOptions])

  // Stop playback whenever we leave a playing round (reveal / results / lobby).
  useEffect(() => {
    if (phase !== 'playing' && clip.playing) clip.toggle()
  }, [phase])

  const isLocked = Boolean(selectedAnswer)
  const showResult = phase === 'result'
  const hasPlayableAudio = Boolean(playbackUrl)
  const playbackMessage =
    audioLoading
      ? 'Loading audio...'
      : (audio.error || audioError || (!hasPlayableAudio && phase === 'playing' ? 'No playable audio found.' : ''))

  useEffect(() => {
    function handleKey(e) {
      if (phase !== 'playing' || isLocked) return
      const keyMap = { '1': 0, '2': 1, '3': 2, '4': 3 }
      const idx = keyMap[e.key]
      if (idx !== undefined && idx < roundOptions.length) {
        e.preventDefault()
        onAnswer(roundOptions[idx].id)
      }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        clip.toggle()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [phase, isLocked, roundOptions, onAnswer])

  const handlePlayback = async () => {
    clip.toggle()
  }

  return html`
    <section className="battle-arena">
      <audio ref=${prefs} style=${{ display: 'none' }} />
      <div className="radar">
        <div className="radar__rings" aria-hidden="true"></div>
        ${Array.from({ length: 36 }, (_, i) => i).map(
          (i) => html`
            <span
              key=${i}
              className="radar__tick"
              style=${{ '--i': i, '--n': 36 }}
            ></span>
          `,
        )}
        <button
          type="button"
          className=${`radar__play${clip.playing ? ' is-playing' : ''}`}
          onClick=${handlePlayback}
          disabled=${audioLoading || !hasPlayableAudio}
          aria-label=${clip.playing ? 'Pause clip' : 'Play clip'}
        >
          ${clip.playing
            ? html`
                <svg viewBox="0 0 24 24" width="28" height="28">
                  <rect x="6" y="5" width="4.5" height="14" rx="1" fill="#111" />
                  <rect x="13.5" y="5" width="4.5" height="14" rx="1" fill="#111" />
                </svg>
              `
            : html`
                <svg viewBox="0 0 24 24" width="28" height="28">
                  <polygon points="8,5 20,12 8,19" fill="#111" />
                </svg>
              `}
        </button>
      </div>

      <div className="clip-progress">
        <span>0:${String(Math.floor(clip.elapsed)).padStart(2, '0')}</span>
        <div className="clip-progress__track">
          <div
            className="clip-progress__fill"
            style=${{ width: `${Math.min(100, (clip.elapsed / clipDuration) * 100)}%` }}
          ></div>
        </div>
        <span>0:${String(clipDuration).padStart(2, '0')}</span>
      </div>
      ${playbackMessage && html`<p className="audio-status audio-status--battle">${playbackMessage}</p>`}

      ${showResult && html`
        <div className=${`round-result ${isCorrectAnswer ? 'is-correct' : 'is-wrong'}`}>
          ${isCorrectAnswer ? '✓ Correct!' : '✕ Missed!'}
          ${correctSongId && html`
            <span className="round-result__song">
              ${roundOptions.find(o => o.id === correctSongId)?.title}
              —
              ${roundOptions.find(o => o.id === correctSongId)?.artist}
            </span>
          `}
        </div>
      `}

      <h2 className="battle-question">WHAT IS PLAYING?</h2>

      <div className="choice-stack">
        ${roundOptions.map(
          (option, index) => {
            const isSelected = selectedAnswer === option.id
            const isCorrectOpt = showResult && option.id === correctSongId
            const isWrongSelected = showResult && isSelected && option.id !== correctSongId

            let cls = 'choice-btn'
            if (isSelected && !showResult) cls += ' is-locked'
            if (isCorrectOpt) cls += ' is-correct-choice'
            if (isWrongSelected) cls += ' is-wrong-choice'
            if (showResult && !isSelected && option.id !== correctSongId) cls += ' is-dimmed'

            return html`
              <button
                key=${option.id}
                type="button"
                disabled=${isLocked || showResult}
                className=${cls}
                onClick=${() => onAnswer(option.id)}
              >
                <span className="choice-btn__hotkey">${index + 1}</span>
                <span className="choice-btn__copy">
                  <strong>${option.title}</strong>
                  <small>${option.artist}</small>
                </span>
                ${isSelected && !showResult && html`
                  <span className="choice-btn__lock">
                    LOCKED IN
                    <svg viewBox="0 0 24 24" width="16" height="16">
                      <rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="1.8" />
                    </svg>
                  </span>
                `}
                ${isCorrectOpt && showResult && html`
                  <span className="choice-btn__result choice-btn__result--correct">✓</span>
                `}
                ${isWrongSelected && html`
                  <span className="choice-btn__result choice-btn__result--wrong">✕</span>
                `}
              </button>
            `
          },
        )}
      </div>
    </section>
  `
}
