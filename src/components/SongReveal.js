import { useEffect, useRef, useState } from 'https://esm.sh/react@19'
import { createPortal } from 'https://esm.sh/react-dom@19'
import { html } from '../html.js'
import { DIFFICULTIES } from '../difficulty.js'
import usePreviewAudio from '../hooks/usePreviewAudio.js'
import useAudioVolume, { getAudioVolume } from '../hooks/useAudioSettings.js'
import { fetchTracksByIds, searchCatalog } from '../spotify/client.js'
import { spotifyTrackUrl, matchingSpotifyUrl, spotifySearchUrl } from '../music/spotifyLink.js'
import { fetchTrackTrivia } from '../music/trivia.js'

export default function SongReveal({
  song,
  themeDifficulty = 0,
  isCorrectAnswer,
  points = 0,
  round,
  totalRounds,
  onContinue,
  userGuess = '',
  playbackUrl = null,
  playbackType = 'unavailable',
  startAt = 0,
  countdown = null,
  classicMode = false,
  nextLoading = false,
  nextError = '',
  nextRetryAt = null,
}) {
  const [showDetails, setShowDetails] = useState(false)
  const [reviewSong, setReviewSong] = useState(song)
  const [triviaText, setTriviaText] = useState('')
  const [resolvedSpotify, setResolvedSpotify] = useState(null)
  const [shareStatus, setShareStatus] = useState('')
  const [sharing, setSharing] = useState(false)
  const [manualShareUrl, setManualShareUrl] = useState('')
  const detailsRequestRef = useRef(null)
  const audio = usePreviewAudio({ fadeInMs: isCorrectAnswer ? 0 : 1000 })
  const prefs = audio.attach
  const missedSoundRef = useRef(null)
  const volume = useAudioVolume()

  useEffect(() => {
    if (isCorrectAnswer) return undefined
    const sound = new Audio('/public/sounds/fail.mp3')
    missedSoundRef.current = sound
    sound.volume = getAudioVolume()
    sound.play().catch(() => {})
    return () => {
      sound.pause()
      sound.removeAttribute('src')
      sound.load()
      missedSoundRef.current = null
    }
  }, [round, isCorrectAnswer])

  useEffect(() => {
    if (missedSoundRef.current) missedSoundRef.current.volume = volume
  }, [volume])

  useEffect(() => {
    if (!showDetails || !song || spotifyTrackUrl(song)) return undefined
    let alive = true
    searchCatalog(`track:"${song.title}" artist:"${song.artist}"`, 8, 'song-reveal-link')
      .then((tracks) => {
        const url = matchingSpotifyUrl(song, tracks)
        if (alive && url) setResolvedSpotify({ song, url })
      })
      .catch(() => {})
    return () => { alive = false }
  }, [song, showDetails])

  useEffect(() => {
    setReviewSong(song)
    setShareStatus('')
    setManualShareUrl('')
    setShowDetails(false)
    setTriviaText('')
    detailsRequestRef.current = null
    let alive = true
    fetchTrackTrivia(song).then((fact) => {
      if (alive) setTriviaText(fact || 'No song-specific trivia found for this track yet.')
    })
    return () => { alive = false }
  }, [song])

  useEffect(() => {
    if (!showDetails) return undefined
    const isSpotifyTrack = song?.provider === 'spotify' || song?.source === 'spotify'
    if (!isSpotifyTrack || !song?.providerTrackId || (song.title && song.artist && song.album && song.artwork && (song.externalUrl || song.external_urls?.spotify))) return undefined
    let alive = true
    if (!detailsRequestRef.current) detailsRequestRef.current = fetchTracksByIds([song.providerTrackId], { genre: 'Spotify', difficulty: song.difficulty, source: 'song-review' })
    detailsRequestRef.current
      .then(([metadata]) => {
        if (alive && metadata) setReviewSong((current) => ({ ...current, ...metadata }))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [song, showDetails])

  useEffect(() => {
    if (!playbackUrl || !['spotify', 'preview'].includes(playbackType)) return undefined
    audio.playFrom(playbackUrl, Math.max(0, Number(startAt) || 0))
    return () => audio.stop()
  }, [playbackUrl, playbackType, startAt])

  async function shareClassic() {
    if (!classicMode || sharing) return
    const url = new URL(window.location.pathname, window.location.origin)
    url.searchParams.set('mode', 'classic')
    const text = isCorrectAnswer
      ? `I earned ${points} points in MuSync Classic! Can you guess the song?`
      : 'Can you beat me at guessing songs? Play MuSync Classic!'
    setSharing(true)
    setShareStatus('')
    setManualShareUrl('')
    try {
      if (navigator.share) {
        try {
          await navigator.share({ title: 'MuSync Classic', text, url: url.href })
          setShareStatus('Shared!')
          return
        } catch (error) {
          if (error.name === 'AbortError') return
        }
      }
      await navigator.clipboard.writeText(url.href)
      setShareStatus('Link copied')
    } catch {
      setManualShareUrl(url.href)
      setShareStatus('Copy the link below')
    } finally {
      setSharing(false)
    }
  }

  if (!reviewSong) return html`<div className="song-reveal" role="dialog" aria-modal="true" aria-label="Round answer">Loading...</div>`

  const spotifyUrl = spotifyTrackUrl(reviewSong)
    || (resolvedSpotify?.song === song ? resolvedSpotify.url : '')
    || spotifySearchUrl(reviewSong)
  const sourceLabel = 'Open in Spotify'
  const initial = (reviewSong.artist || '?').charAt(0).toUpperCase()
  const artwork = reviewSong.artwork || reviewSong.image || null
  const difficulty = DIFFICULTIES[reviewSong.difficulty]?.label || 'UNKNOWN'
  const releaseYear = reviewSong.year || reviewSong.releaseDate?.slice?.(0, 4) || ''
  const theme = DIFFICULTIES[themeDifficulty] || DIFFICULTIES[0]
  const themeStyle = {
    '--yellow': theme.color,
    '--yellow-soft': theme.soft,
    '--dc-rgb': theme.color.slice(1).match(/../g).map((part) => parseInt(part, 16)).join(', '),
    '--dc-glow': theme.glow,
  }

  return createPortal(html`
    <div key=${`${song.id || song.title}-${round}-${isCorrectAnswer}`} style=${themeStyle} className=${`song-reveal-backdrop ${isCorrectAnswer ? 'is-correct' : 'is-wrong'}`}>
    <div className="song-reveal" role="dialog" aria-modal="true" aria-label="Round answer">
      <div className="song-reveal__badge">
        <span className="song-reveal__round">ROUND REVEAL</span>
        <span className=${`song-reveal__points${isCorrectAnswer ? ' is-earned' : ''}`}>
          ${isCorrectAnswer ? 'ROUND CLEARED' : 'ROUND MISSED'}
        </span>
      </div>

      <div className="song-reveal__body">
      <div className="song-reveal__card">
        <audio ref=${prefs} style=${{ display: 'none' }} />
        <div className="song-reveal__art" style=${{ background: song.color }}>
          ${artwork
            ? html`<img src=${artwork} alt="${reviewSong.album} album artwork" />`
            : html`<span>${initial}</span>`}
          <div className="song-reveal__art-gloss" aria-hidden="true"></div>
        </div>

        <div className="song-reveal__info">
          <p className="song-reveal__song-title">${reviewSong.title}</p>
          <p className="song-reveal__song-artist">${reviewSong.artist}</p>
          <p className=${`song-reveal__guess${userGuess ? '' : ' is-empty'}`}>
            <span className="song-reveal__guess-label">YOUR GUESS</span>
            <strong>${userGuess || 'No guess submitted'}</strong>
          </p>
          <aside className="song-reveal__trivia" aria-label="Track trivia">
            <div className="song-reveal__trivia-heading">
              <svg className="song-reveal__trivia-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M9 18h6M9 21h6M8.5 15.5a6 6 0 1 1 7 0c-.9.6-1.5 1.5-1.5 2.5h-4c0-1-.6-1.9-1.5-2.5Z" />
                <path d="M12 1V0M3.5 4.5l-1-1M20.5 4.5l1-1M2 11H1M23 11h-1" />
              </svg>
              <strong>TRACK TRIVIA</strong>
            </div>
            <p>${triviaText || 'Finding song-specific trivia...'}</p>
          </aside>
          ${showDetails && html`
            <div className="song-reveal__details" id="song-reveal-details">
              <p><strong>ALBUM</strong> ${reviewSong.album}</p>
              <p><strong>YEAR</strong> ${releaseYear || 'Unknown'}</p>
              <p><strong>GENRE</strong> ${reviewSong.genre}</p>
              <p><strong>DIFFICULTY</strong> ${difficulty}</p>
              ${reviewSong.popularity !== null && reviewSong.popularity !== undefined && html`<p><strong>POPULARITY</strong> ${reviewSong.popularity}</p>`}
              ${reviewSong.fact && html`<p className="song-reveal__fact">${reviewSong.fact}</p>`}
            </div>
          `}
        </div>
        ${audio.error && html`<p className="audio-status">${audio.error}</p>`}
      </div>

      <div className="song-reveal__actions">
        ${nextError && html`<p className="audio-status song-reveal__next-status" role="status">${nextError} ${nextRetryAt ? 'We’ll retry automatically after the cooldown.' : ''}</p>`}
        ${nextLoading && html`<p className="audio-status song-reveal__next-status" role="status">Loading the next song…</p>`}
        <button type="button" className="song-reveal__continue" onClick=${onContinue} disabled=${nextLoading || Boolean(nextRetryAt)}>
          ${classicMode ? 'NEXT ROUND →' : round >= totalRounds ? 'VIEW FINAL RESULTS →' : `NEXT ROUND${countdown !== null ? ` IN ${countdown}` : ''} →`}
        </button>
        <button type="button" className="song-reveal__details-btn" aria-expanded=${showDetails} aria-controls="song-reveal-details" onClick=${() => setShowDetails((value) => !value)}>
          ${showDetails ? 'Hide Details' : 'View More Details'}
        </button>
      </div>
        ${(classicMode || (showDetails && spotifyUrl)) && html`
          <div className="song-reveal__share-row">
            ${classicMode && html`<button type="button" className="song-reveal__share" onClick=${shareClassic} disabled=${sharing}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 16V3m-4 4 4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
              </svg>
              <span role="status" aria-live="polite">${sharing ? 'Sharing...' : shareStatus || 'Share with friends'}</span>
            </button>`}
            ${showDetails && spotifyUrl && html`<a className="song-reveal__source" href=${spotifyUrl} target="_blank" rel="noreferrer">${sourceLabel} <span aria-hidden="true">↗</span></a>`}
            ${manualShareUrl && html`<input className="song-reveal__share-url" aria-label="Classic mode share link" readOnly value=${manualShareUrl} onFocus=${(event) => event.target.select()} />`}
          </div>
        `}
      </div>
    </div>
    </div>
  `, document.body)
}
