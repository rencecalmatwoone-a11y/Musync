import { useEffect, useRef, useState } from 'https://esm.sh/react@19'
import { html } from '../html.js'
import { DIFFICULTIES } from '../difficulty.js'
import usePreviewAudio from '../hooks/usePreviewAudio.js'
import { fetchTracksByIds } from '../spotify/client.js'

export default function SongReveal({
  song,
  isCorrectAnswer,
  round,
  totalRounds,
  onContinue,
  userGuess = '',
  playbackUrl = null,
  playbackType = 'unavailable',
  startAt = 0,
  countdown = null,
}) {
  const [showDetails, setShowDetails] = useState(false)
  const [reviewSong, setReviewSong] = useState(song)
  const detailsRequestRef = useRef(null)
  const audio = usePreviewAudio()
  const prefs = audio.attach

  useEffect(() => {
    setReviewSong(song)
    setShowDetails(false)
    detailsRequestRef.current = null
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

  if (!reviewSong) return html`<div className="song-reveal" role="dialog" aria-modal="true" aria-label="Round answer">Loading...</div>`

  const spotifyTrackId = (reviewSong.provider === 'spotify' || reviewSong.source === 'spotify')
    ? (reviewSong.providerTrackId || String(reviewSong.id || ''))
    : ''
  const spotifyUrl = reviewSong.spotifyUrl || reviewSong.externalUrl || reviewSong.external_urls?.spotify || (spotifyTrackId ? `https://open.spotify.com/track/${encodeURIComponent(spotifyTrackId)}` : '')
  const initial = (reviewSong.artist || '?').charAt(0).toUpperCase()
  const artwork = reviewSong.artwork || reviewSong.image || null
  const points = isCorrectAnswer ? 150 : 0
  const difficulty = DIFFICULTIES[reviewSong.difficulty]?.label || 'UNKNOWN'

  return html`
    <div className="song-reveal-backdrop">
    <div className="song-reveal" role="dialog" aria-modal="true" aria-label="Round answer">
      <div className="song-reveal__badge">
        <span className="song-reveal__round">IT WAS ...</span>
        <span className=${`song-reveal__points${isCorrectAnswer ? ' is-earned' : ''}`}>
          ${isCorrectAnswer ? `+${points} PTS` : 'ROUND MISSED'}
        </span>
      </div>

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
          ${showDetails && html`
            <div className="song-reveal__details" id="song-reveal-details">
              <p><strong>ALBUM</strong> ${reviewSong.album}</p>
              <p><strong>YEAR</strong> ${reviewSong.year || reviewSong.releaseDate?.slice?.(0, 4) || 'Unknown'}</p>
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
        <button type="button" className="song-reveal__continue" onClick=${onContinue}>
          ${round >= totalRounds ? 'VIEW FINAL RESULTS →' : `NEXT ROUND${countdown !== null ? ` IN ${countdown}` : ''} →`}
        </button>
        <button type="button" className="song-reveal__details-btn" aria-expanded=${showDetails} aria-controls="song-reveal-details" onClick=${() => setShowDetails((value) => !value)}>
          ${showDetails ? 'Hide Details' : 'View More Details'}
        </button>
      </div>
          ${showDetails && spotifyUrl && html`<a className="song-reveal__source" href=${spotifyUrl} target="_blank" rel="noreferrer">OPEN IN SPOTIFY ↗</a>`}
    </div>
    </div>
  `
}
