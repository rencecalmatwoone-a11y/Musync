import { useEffect } from 'https://esm.sh/react@19'
import { html } from '../html.js'
import useClipTimer from '../hooks/useClipTimer.js'
import usePreviewAudio from '../hooks/usePreviewAudio.js'

export default function BattleArena({ roundOptions, selectedAnswer, isCorrectAnswer, correctSongId, onAnswer, clipDuration, timerElapsed, timerDuration, phase, roundKey = null, trackId = null, playbackUrl = null, audioLoading = false, audioError = null }) {
  const clip = useClipTimer(clipDuration)
  const { attach, sync, playFrom, error: previewError } = usePreviewAudio()
  const isLocked = Boolean(selectedAnswer)
  const showResult = phase === 'result'

  useEffect(() => {
    const playback = sync(playbackUrl, phase === 'playing' && clip.playing)
    playback.then((started) => {
      if (!started && phase === 'playing' && clip.playing) clip.reset()
    })
  }, [sync, playbackUrl, phase, clip.playing])

  useEffect(() => {
    clip.reset()
    if (phase === 'playing' && playbackUrl) clip.play()
  }, [roundKey, phase, playbackUrl])

  useEffect(() => {
    if (phase !== 'playing' && clip.playing) clip.toggle()
  }, [phase])

  const progressElapsed = Number.isFinite(timerElapsed)
    ? Math.max(0, Math.min(clipDuration, timerElapsed))
    : clip.elapsed
  const playbackMessage = audioLoading
    ? 'Preparing audio...'
    : (audioError || previewError || (!playbackUrl && phase === 'playing' ? 'Preparing audio...' : ''))

  function handlePlayback() {
    if (!playbackUrl) return
    if (clip.playing) {
      clip.toggle()
      return
    }
    clip.toggle()
    playFrom(playbackUrl, clip.elapsed)
  }

  useEffect(() => {
    function handleKey(event) {
      if (phase !== 'playing' || isLocked) return
      const index = { '1': 0, '2': 1, '3': 2, '4': 3 }[event.key]
      if (index !== undefined && index < roundOptions.length) {
        event.preventDefault()
        onAnswer(roundOptions[index].id)
      } else if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        handlePlayback()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [phase, isLocked, roundOptions, onAnswer, playbackUrl])

  return html`
    <section className="battle-arena">
      <div className=${`radar${clip.playing ? ' is-playing' : ''}`}>
        <div className="radar__rings" aria-hidden="true"></div>
        ${Array.from({ length: 36 }, (_, index) => html`<span key=${index} className="radar__tick" style=${{ '--i': index, '--n': 36 }}></span>`)}
        <button type="button" className=${`radar__play${clip.playing ? ' is-playing' : ''}`} onClick=${handlePlayback} disabled=${audioLoading || !trackId} aria-label=${clip.playing ? 'Pause clip' : 'Play clip'}>
          ${clip.playing
            ? html`<svg viewBox="0 0 24 24" width="28" height="28"><rect x="6" y="5" width="4.5" height="14" rx="1" fill="#111" /><rect x="13.5" y="5" width="4.5" height="14" rx="1" fill="#111" /></svg>`
            : html`<svg viewBox="0 0 24 24" width="28" height="28"><polygon points="8,5 20,12 8,19" fill="#111" /></svg>`}
        </button>
      </div>
      <audio ref=${attach} style=${{ display: 'none' }} />
      <div className="clip-progress">
        <span>0:${String(Math.floor(progressElapsed)).padStart(2, '0')}</span>
        <div className="clip-progress__track"><div className="clip-progress__fill" style=${{ width: `${Math.min(100, (progressElapsed / clipDuration) * 100)}%` }}></div></div>
        <span>0:${String(clipDuration).padStart(2, '0')}</span>
      </div>
      ${playbackMessage && html`<p className="audio-status audio-status--battle">${playbackMessage}</p>`}
      ${showResult && html`<div className=${`round-result ${isCorrectAnswer ? 'is-correct' : 'is-wrong'}`}>${isCorrectAnswer ? '✓ Correct!' : '✕ Missed!'}${correctSongId && html`<span className="round-result__song">${roundOptions.find((option) => option.id === correctSongId)?.title} — ${roundOptions.find((option) => option.id === correctSongId)?.artist}</span>`}</div>`}
      <h2 className="battle-question">WHAT IS PLAYING?</h2>
      <div className="choice-stack">
        ${roundOptions.map((option, index) => {
          const isSelected = selectedAnswer === option.id
          const isCorrectOption = showResult && option.id === correctSongId
          const isWrongSelected = showResult && isSelected && option.id !== correctSongId
          let className = 'choice-btn'
          if (isSelected && !showResult) className += ' is-locked'
          if (isCorrectOption) className += ' is-correct-choice'
          if (isWrongSelected) className += ' is-wrong-choice'
          if (showResult && !isSelected && option.id !== correctSongId) className += ' is-dimmed'
          return html`<button key=${option.id} type="button" disabled=${isLocked || showResult} className=${className} onClick=${() => onAnswer(option.id)}><span className="choice-btn__hotkey">${index + 1}</span><span className="choice-btn__copy"><strong>${option.title}</strong><small>${option.artist}</small></span>${isSelected && !showResult && html`<span className="choice-btn__lock">YOUR GUESS</span>`}${isCorrectOption && html`<span className="choice-btn__result choice-btn__result--correct">✓</span>`}${isWrongSelected && html`<span className="choice-btn__result choice-btn__result--wrong">✕</span>`}</button>`
        })}
      </div>
    </section>
  `
}
