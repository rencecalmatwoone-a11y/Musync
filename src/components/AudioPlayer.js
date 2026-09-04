import { useEffect, useRef, useState } from 'https://esm.sh/react@19'
import { html } from '../html.js'
import { useSpotifyPlayback } from '../hooks/useTrackAudio.js'
import SpotifyPlaybackModal from './SpotifyPlaybackModal.js'

const SIZE = 196
const STROKE = 7
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const STAGES = [0.5, 2, 8, 15]
const WAVE_COUNT = 12

function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds))
  return `0:${String(whole).padStart(2, '0')}`
}

function stageIndex(elapsed) {
  if (elapsed <= 0) return 0
  for (let i = 0; i < STAGES.length; i++) {
    if (elapsed <= STAGES[i]) return i
  }
  return STAGES.length - 1
}

function stageStart(index) {
  return index === 0 ? 0 : STAGES[index - 1]
}

export default function AudioPlayer({
  duration = 15,
  trackId = null,
  playbackUrl = null,
  playbackType = 'unavailable',
  audioLoading = false,
  audioError = null,
  onSkip = null,
  onExpire = null,
  onPlaybackPositionChange = null,
  revealActive = false,
  onPractice = null,
}) {
  const [playing, setPlaying] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const spotify = useSpotifyPlayback(false)
  const [modalState, setModalState] = useState(null)
  useEffect(() => {
    let intent = false
    try { intent = new URLSearchParams(window.location.search).get('spotify') === 'auth' && localStorage.getItem('musync-spotify-play-intent') === '1' } catch { /* noop */ }
    if (!intent || !trackId) return undefined
    setModalState('connecting')
    spotify.ensureReady().then(() => {
      try { localStorage.removeItem('musync-spotify-play-intent') } catch { /* noop */ }
      setModalState(null)
      setPlaying(true)
    }).catch((error) => setModalState(error.code === 'SPOTIFY_PREMIUM_REQUIRED' ? 'premium-required' : error.code === 'SPOTIFY_LOGIN_REQUIRED' ? 'login-required' : error.code === 'SPOTIFY_QUOTA_EXCEEDED' || /quota/i.test(error.message) ? 'quota-exceeded' : 'error'))
    return undefined
  }, [trackId])
  useEffect(() => {
    if (!trackId) return undefined
    if (playing) spotify.playTrack(trackId)
    else spotify.pause()
    return () => { spotify.pause() }
  }, [playing, trackId])
  const startedAt = useRef(null)
  const baseElapsed = useRef(0)
  const target = useRef(STAGES[0])
  const frame = useRef(0)
  const atBoundary = elapsed >= duration || STAGES.includes(elapsed)

  useEffect(() => {
    if (!playing) return undefined

    startedAt.current = performance.now()
    const tick = (now) => {
      const limit = target.current
      const next = Math.min(limit, baseElapsed.current + (now - startedAt.current) / 1000)
      setElapsed(next)
      if (next >= limit) {
        setPlaying(false)
        baseElapsed.current = limit
        if (limit >= duration && onExpire) onExpire()
        return
      }
      frame.current = requestAnimationFrame(tick)
    }

    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [playing])

  useEffect(() => {
    if (onPlaybackPositionChange) onPlaybackPositionChange(elapsed)
  }, [elapsed, onPlaybackPositionChange])

  async function toggle() {
    if (playing) {
      baseElapsed.current = elapsed
      setPlaying(false)
      return
    }
    if (!spotify.ready) {
      if (audioError && /quota/i.test(audioError)) {
        setModalState('quota-exceeded')
        return
      }
      setModalState(spotify.status === 'login-required' ? 'login-required' : spotify.status === 'premium-required' ? 'premium-required' : 'connecting')
      try {
        await spotify.ensureReady()
      } catch (error) {
        setModalState(error.code === 'SPOTIFY_LOGIN_REQUIRED' ? 'login-required' : error.code === 'SPOTIFY_PREMIUM_REQUIRED' ? 'premium-required' : error.code === 'SPOTIFY_QUOTA_EXCEEDED' || /quota/i.test(error.message) ? 'quota-exceeded' : 'error')
        return
      }
      setModalState(null)
    }
    if (!trackId) {
      setModalState('error')
      return
    }
    if (atBoundary) {
      const index = stageIndex(elapsed)
      baseElapsed.current = stageStart(index)
      target.current = STAGES[index]
      setElapsed(baseElapsed.current)
      setPlaying(true)
      return
    }
    baseElapsed.current = elapsed
    setPlaying(true)
  }

  function skip() {
    if (elapsed >= duration) {
      setPlaying(false)
      if (onSkip) onSkip()
      return
    }
    const nextBoundary = STAGES.find((stage) => stage > elapsed + 0.01)
    const boundary = nextBoundary || duration
    setPlaying(false)
    setElapsed(boundary)
    baseElapsed.current = boundary
  }

  const offset = CIRCUMFERENCE - (elapsed / duration) * CIRCUMFERENCE
  const playable = spotify.ready
  const playbackMessage =
    revealActive
      ? ''
      : (audioLoading
      ? 'Loading track...'
      : (audioError || spotify.error || (!playable
        ? (spotify.status === 'login-required'
          ? 'Spotify login required.'
          : spotify.status === 'premium-required'
          ? 'Spotify Premium is required.'
          : spotify.status === 'connecting'
          ? 'Connecting to Spotify...'
          : 'No playable audio available.')
        : '')))

  return html`
    <div className="audio-player">
      <div className="player-ring">
        <svg viewBox=${`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          <circle className="track" cx=${SIZE / 2} cy=${SIZE / 2} r=${RADIUS} />
          <circle
            className="progress"
            cx=${SIZE / 2}
            cy=${SIZE / 2}
            r=${RADIUS}
            strokeDasharray=${CIRCUMFERENCE}
            strokeDashoffset=${offset}
          />
        </svg>
        <button
          type="button"
          className=${`play-btn${playing || revealActive ? ' is-playing' : ''}`}
          onClick=${toggle}
          disabled=${audioLoading}
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
      ${playbackMessage && html`<p className="audio-status">${playbackMessage}</p>`}
      <button
        type="button"
        className="skip-btn"
        onClick=${skip}
        disabled=${audioLoading || !playable}
      >
        SKIP
      </button>
      <${SpotifyPlaybackModal}
        state=${modalState}
        onLogin=${() => { try { localStorage.setItem('musync-spotify-play-intent', '1') } catch { /* noop */ } }}
        onPractice=${onPractice}
        onRetry=${() => { setModalState('connecting'); spotify.ensureReady().then(() => setModalState(null)).catch((error) => setModalState(error.code === 'SPOTIFY_PREMIUM_REQUIRED' ? 'premium-required' : error.code === 'SPOTIFY_LOGIN_REQUIRED' ? 'login-required' : error.code === 'SPOTIFY_QUOTA_EXCEEDED' || /quota/i.test(error.message) ? 'quota-exceeded' : 'error')) }}
        onBack=${() => setModalState(null)}
      />
    </div>
  `
}
