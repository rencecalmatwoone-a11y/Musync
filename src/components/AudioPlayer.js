import { useEffect, useRef, useState } from 'https://esm.sh/react@19'
import { html } from '../html.js'
import usePreviewAudio from '../hooks/usePreviewAudio.js'
import { useSpotifyPlayback } from '../hooks/useTrackAudio.js'

const SIZE = 196
const STROKE = 7
const RADIUS = (SIZE - STROKE) / 2

const STAGES = [0.5, 2, 8, 15]
const WAVE_COUNT = 12

function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds))
  return `0:${String(whole).padStart(2, '0')}`
}

export default function AudioPlayer({
  duration = 15,
  trackId = null,
  artistHint = null,
  autoplay = false,
  playbackUrl = null,
  playbackType = 'unavailable',
  audioLoading = false,
  audioError = null,
  onSkip = null,
  onExpire = null,
  onPlaybackPositionChange = null,
  revealActive = false,
  onPractice = null,
  availablePoints = null,
}) {
  const [playing, setPlaying] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [selectedStage, setSelectedStage] = useState(0)
  const [stagePreview, setStagePreview] = useState(null)
  const selectedStageRef = useRef(0)
  const audio = usePreviewAudio()
  const spotify = useSpotifyPlayback(playbackType === 'spotify-sdk')
  const playAttempt = useRef(0)
  const autoplayAttempted = useRef(false)
  useEffect(() => {
    if (!playing || revealActive) audio.pause()
    if ((!playing || revealActive) && playbackType === 'spotify-sdk') spotify.pause()
    if (revealActive) { playAttempt.current++; setPlaying(false) }
  }, [playing, revealActive, playbackType, audio.pause, spotify.pause])
  useEffect(() => () => { playAttempt.current++; audio.stop() }, [audio.stop])
  const startedAt = useRef(null)
  const baseElapsed = useRef(0)
  const target = useRef(Math.min(STAGES[0], duration))
  const frame = useRef(0)
  const elapsedRef = useRef(0)
  const progressRef = useRef(null)
  const playheadRef = useRef(null)
  const positionCallback = useRef(onPlaybackPositionChange)
  positionCallback.current = onPlaybackPositionChange
  const atBoundary = elapsed >= target.current

  useEffect(() => {
    if (!playing || revealActive) return undefined

    startedAt.current = performance.now()
    const tick = (now) => {
      const limit = target.current
      const next = Math.min(limit, baseElapsed.current + (now - startedAt.current) / 1000)
      elapsedRef.current = next
      const start = selectedStageRef.current === 0 ? 0 : Math.min(STAGES[selectedStageRef.current - 1], duration)
      const filled = start + (limit - start) * (limit > 0 ? next / limit : 0)
      const ratio = Math.max(0, Math.min(1, filled / Math.max(1, Number(duration) || 1)))
      progressRef.current?.setAttribute('stroke-dashoffset', String(1 - ratio))
      playheadRef.current?.style.setProperty('--playhead-angle', `${ratio * 360}deg`)
      positionCallback.current?.(next)
      // Render timer text only when its displayed second changes.
      setElapsed((previous) => Math.floor(previous) === Math.floor(next) && next < limit ? previous : next)
      if (next >= limit) {
        setPlaying(false)
        baseElapsed.current = limit
        return
      }
      frame.current = requestAnimationFrame(tick)
    }

    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [playing, revealActive, duration])

  useEffect(() => {
    if (onPlaybackPositionChange) onPlaybackPositionChange(elapsedRef.current)
  }, [elapsed, onPlaybackPositionChange])

  async function toggle() {
    if (!playable || audioLoading || revealActive) return
    const attempt = ++playAttempt.current
    if (playing) {
      cancelAnimationFrame(frame.current)
      baseElapsed.current = elapsedRef.current
      setElapsed(elapsedRef.current)
      if (playbackType === 'spotify-sdk') spotify.pause()
      else audio.pause()
      setPlaying(false)
      return
    }
    if (atBoundary) {
      const index = selectedStageRef.current
      // Each stage unlocks a longer clip from the beginning. Replaying must
      // reach the same checkpoint, without selecting a different stage.
      baseElapsed.current = 0
      elapsedRef.current = 0
      target.current = Math.min(STAGES[index], duration)
      setElapsed(baseElapsed.current)
    } else baseElapsed.current = elapsedRef.current
    // Call play in the click gesture; only start the clip timer after the
    // existing public audio hook confirms that media playback succeeded.
    const started = playbackType === 'spotify-sdk'
      ? await spotify.playTrack(trackId, { classic: true, positionMs: baseElapsed.current * 1000 })
      : await audio.playFrom(playbackUrl, baseElapsed.current)
    if (attempt === playAttempt.current) {
      if (started) setStagePreview(null)
      setPlaying(started)
    }
  }

  function skip() {
    if (audioLoading || !playable || revealActive) return
    playAttempt.current++
    cancelAnimationFrame(frame.current)
    if (playbackType === 'spotify-sdk') spotify.pause()
    else audio.pause()
    const index = selectedStageRef.current
    if (index >= STAGES.length - 1 || STAGES[index] >= duration) {
      setStagePreview(Math.min(STAGES[index], duration))
      setPlaying(false)
      if (onSkip) onSkip()
      return
    }
    const nextIndex = index + 1
    selectedStageRef.current = nextIndex
    setSelectedStage(nextIndex)
    target.current = Math.min(STAGES[nextIndex], duration)
    setStagePreview(target.current)
    setPlaying(false)
    setElapsed(0)
    elapsedRef.current = 0
    baseElapsed.current = 0
  }

  const safeDuration = Math.max(1, Number(duration) || 1)
  // Skip previews the selected checkpoint. Playback animates from the previous one.
  const segmentStart = selectedStage === 0 ? 0 : Math.min(STAGES[selectedStage - 1], duration)
  const clipProgress = target.current > 0 ? Math.min(1, Math.max(0, elapsedRef.current / target.current)) : 0
  const indicatorElapsed = segmentStart + Math.max(0, target.current - segmentStart) * clipProgress
  const filledElapsed = stagePreview ?? indicatorElapsed
  const progressRatio = Math.max(0, Math.min(1, filledElapsed / safeDuration))
  const nextStageIndex = selectedStage
  const currentStage = selectedStage + 1
  const playable = Boolean(trackId && (playbackType === 'spotify-sdk' || (playbackUrl && playbackType === 'preview')))
  const playbackError = playbackType === 'spotify-sdk' ? spotify.error : audioError || audio.error
  const playbackMessage = revealActive ? '' : audioLoading ? 'Loading track...'
    : playbackError || (!playable ? 'No playable audio available.' : '')

  useEffect(() => {
    if (!autoplay || autoplayAttempted.current || audioLoading || !playable || revealActive) return
    autoplayAttempted.current = true
    void toggle()
  }, [autoplay, audioLoading, playable, revealActive])

  return html`
    <div className="audio-player">
      <audio ref=${audio.attach} src=${playbackUrl || undefined} preload="auto" onEnded=${() => setPlaying(false)} onError=${() => setPlaying(false)} style=${{ display: 'none' }} />
      <div
        className=${`player-ring${playing ? ' is-playing' : ''}${revealActive ? ' is-revealed' : ''}`}
        role="progressbar"
        aria-label="Classic mode listening progress"
        aria-valuemin="0"
        aria-valuemax=${duration}
        aria-valuenow=${filledElapsed}
      >
        <svg viewBox=${`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          <circle className="track" pathLength="1" cx=${SIZE / 2} cy=${SIZE / 2} r=${RADIUS} />
          <circle
            ref=${progressRef}
            className="progress"
            pathLength="1"
            cx=${SIZE / 2}
            cy=${SIZE / 2}
            r=${RADIUS}
            strokeDasharray="1"
            strokeDashoffset=${1 - progressRatio}
          />
        </svg>
        <div className="player-ring__markers" aria-hidden="true">
          <span
            ref=${playheadRef}
            className="player-ring__playhead"
            style=${{ '--playhead-angle': `${progressRatio * 360}deg` }}
          >
            <i></i>
          </span>
          ${STAGES.map((stage, index) => {
            const stageTime = Math.min(stage, safeDuration)
            const angle = (stageTime / safeDuration) * 360
            const reached = filledElapsed >= stageTime
            return html`
              <span
                key=${stage}
                className=${`player-ring__marker player-ring__marker--${index + 1}${reached ? ' is-reached' : ''}${index === nextStageIndex ? ' is-next' : ''}`}
                style=${{ '--marker-angle': `${angle}deg` }}
              >
                <i></i>
                <b>${availablePoints === null ? '' : `${availablePoints} PTS`}</b>
              </span>
            `
          })}
        </div>
        <button
          type="button"
          className=${`play-btn${playing || revealActive ? ' is-playing' : ''}`}
          onClick=${toggle}
          disabled=${audioLoading || !playable || revealActive}
          aria-label=${playing ? 'Pause clip' : 'Play clip'}
        >
          ${playing
            ? html`
                <svg viewBox="0 0 24 24" width="36" height="36">
                  <rect x="6" y="5" width="4.5" height="14" rx="1" fill="#111" />
                  <rect x="13.5" y="5" width="4.5" height="14" rx="1" fill="#111" />
                </svg>
              `
            : html`
                <svg viewBox="0 0 24 24" width="36" height="36">
                  <polygon points="8,5 20,12 8,19" fill="#111" />
                </svg>
              `}
        </button>
        <div className="wave-bars" aria-hidden="true">
          ${Array.from({ length: WAVE_COUNT }, (_, i) => i).map(
            (i) => html`<span key=${i} style=${{ '--i': i }} />`,
          )}
        </div>
      </div>
      <div className="timer">${formatTime(elapsed)}</div>
      ${artistHint && selectedStage === STAGES.length - 1 && !revealActive && html`<p className="audio-status" role="status">Artist hint: ${artistHint}</p>`}
      ${availablePoints !== null && html`
        <div className="player-stage-readout" aria-live="polite">
          <span>STAGE ${currentStage} / ${STAGES.length}</span>
          <strong>${availablePoints} PTS</strong>
        </div>
      `}
      ${playbackMessage && html`<p className="audio-status">${playbackMessage}</p>`}
      <button
        type="button"
        className="skip-btn"
        onClick=${skip}
        disabled=${audioLoading || !playable || revealActive}
      >
        SKIP
      </button>

    </div>
  `
}
