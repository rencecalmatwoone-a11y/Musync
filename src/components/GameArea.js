import { useEffect, useRef, useState } from 'https://esm.sh/react@19'
import { html } from '../html.js'
import AudioPlayer from './AudioPlayer.js'
import GuessInput from './GuessInput.js'

const ERAS = [
  'Any Era', '1950s', '1960s', '1970s', '1980s', '1990s',
  '2000s', '2010s', '2020s',
]
const GENRES = [
  'Any Genre', 'Pop', 'Rock', 'Hip-Hop', 'R&B', 'Electronic',
  'Latin', 'Country',
]
const MUSIC_ORIGINS = ['International', 'OPM / Local']

function FilterCarousel({ label, options, value, onChange, disabled = false }) {
  const pageSize = 1
  const selectedIndex = Math.max(0, options.indexOf(value))
  const pageCount = options.length
  const [page, setPage] = useState(selectedIndex)
  const dragStart = useRef(null)
  const visibleStart = page
  const visible = options.slice(visibleStart, visibleStart + pageSize)

  useEffect(() => {
    if (selectedIndex >= 0) setPage(selectedIndex)
  }, [value])

  function changePage(delta) {
    if (disabled) return
    const next = (page + delta + pageCount) % pageCount
    setPage(next)
    onChange(options[next])
  }

  function stopArrowPointer(event) {
    event.stopPropagation()
    dragStart.current = null
  }

  function selectOption(event, option) {
    event.stopPropagation()
    onChange(option)
  }

  function handlePointerDown(event) {
    dragStart.current = event.clientX
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function handlePointerUp(event) {
    if (dragStart.current === null) return
    const distance = event.clientX - dragStart.current
    dragStart.current = null
    if (Math.abs(distance) < 35) return
    changePage(distance < 0 ? 1 : -1)
  }

  return html`
    <div className=${`filter-group filter-group--wide filter-group--${label.toLowerCase()}${options.length === 2 ? ' filter-group--origin' : ''}${disabled ? ' is-disabled' : ''}`}>
      <span className="filter-group__label">${label}</span>
      <div
        className="filter-carousel"
        onPointerDown=${handlePointerDown}
        onPointerUp=${handlePointerUp}
        onPointerCancel=${() => { dragStart.current = null }}
      >
        <button
          type="button"
          className="filter-carousel__arrow"
          aria-label=${`Previous ${label.toLowerCase()}`}
          onPointerDown=${stopArrowPointer}
          onPointerUp=${stopArrowPointer}
          onClick=${(event) => { event.stopPropagation(); changePage(-1) }}
          disabled=${disabled || pageCount <= 1}
        >
          ‹
        </button>
        <div className="filter-group__chips">
          ${visible.map((option) => html`
            <button
              key=${option}
              type="button"
              className=${`filter-chip${option === value ? ' is-active' : ''}`}
              aria-pressed=${option === value}
              disabled=${disabled}
              onPointerDown=${(event) => event.stopPropagation()}
              onClick=${(event) => selectOption(event, option)}
            >
              ${option}
            </button>
          `)}
        </div>
        <button
          type="button"
          className="filter-carousel__arrow"
          aria-label=${`Next ${label.toLowerCase()}`}
          onPointerDown=${stopArrowPointer}
          onPointerUp=${stopArrowPointer}
          onClick=${(event) => { event.stopPropagation(); changePage(1) }}
          disabled=${disabled || pageCount <= 1}
        >
          ›
        </button>
      </div>
      <span className="filter-carousel__count">${page + 1} / ${pageCount}</span>
    </div>
  `
}

export default function GameArea({
  era,
  genre,
  musicOrigin,
  onEraChange,
  onGenreChange,
  onMusicOriginChange,
  duration,
  trackId,
  onSubmit,
  feedback,
  playbackUrl,
  playbackType,
  audioLoading,
  audioError,
  onSkip,
  onExpire,
  onPlaybackPositionChange,
  revealActive = false,
  answerLocked = false,
  onPractice = null,
}) {
  return html`
    <section className="game-area">
      <h2 className="headline">HOW WELL DO YOU KNOW YOUR MUSIC?</h2>
      <div className="filter-bar">
        <${FilterCarousel} label="Songs" options=${MUSIC_ORIGINS} value=${musicOrigin} onChange=${onMusicOriginChange} />
        <div className="filter-bar__divider" aria-hidden="true"></div>
        <${FilterCarousel}
          label="Era"
          options=${ERAS}
          value=${era}
          onChange=${onEraChange}
          disabled=${musicOrigin === 'OPM / Local'}
        />
        <div className="filter-bar__divider" aria-hidden="true"></div>
        <${FilterCarousel}
          label="Genre"
          options=${GENRES}
          value=${genre}
          onChange=${onGenreChange}
          disabled=${musicOrigin === 'OPM / Local'}
        />
      </div>
      <div className=${`music-origin-badge music-origin-badge--${musicOrigin === 'OPM / Local' ? 'local' : 'international'}`}>
        ${musicOrigin === 'OPM / Local' ? 'OPM / LOCAL SONGS' : 'INTERNATIONAL SONGS'}
      </div>
      <p className="listen-label">LISTEN CAREFULLY</p>
      <${AudioPlayer}
        key=${trackId}
        duration=${duration}
        trackId=${trackId}
        playbackUrl=${playbackUrl}
        playbackType=${playbackType}
        audioLoading=${audioLoading}
        audioError=${audioError}
        onSkip=${onSkip}
        onExpire=${onExpire}
        onPlaybackPositionChange=${onPlaybackPositionChange}
        revealActive=${revealActive}
        onPractice=${onPractice}
      />
      <${GuessInput} onSubmit=${onSubmit} feedback=${feedback} disabled=${answerLocked} />
    </section>
  `
}
