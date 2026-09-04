import { useEffect, useState } from 'https://esm.sh/react@19'
import { html } from '../html.js'
import { searchCatalog } from '../spotify/client.js'

export default function GuessInput({ onSubmit, feedback, disabled = false }) {
  const [value, setValue] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [selected, setSelected] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const tone = feedback.startsWith('Correct')
    ? ' is-correct'
    : feedback
      ? ' is-wrong'
      : ''

  function submit(event) {
    event.preventDefault()
    if (disabled || !value.trim()) return
    onSubmit(selected || value)
    setValue('')
    setSelected(null)
    setSuggestions([])
    setSearchError('')
  }

  useEffect(() => {
    if (disabled || selected || value.trim().length < 2) {
      setSuggestions([])
      setSearching(false)
      return undefined
    }
    let alive = true
    const timeout = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await searchCatalog(value)
        if (alive) setSuggestions(results)
      } catch (error) {
        if (alive) {
          setSuggestions([])
          setSearchError(error?.quotaExceeded || error?.code === 'SPOTIFY_QUOTA_EXCEEDED' || /quota/i.test(error?.message || '')
            ? 'Spotify cannot be used at the moment because the development quota has been reached. Please try again later.'
            : 'Music provider temporarily unavailable. Please try again.')
        }
      } finally {
        if (alive) setSearching(false)
      }
    }, 180)
    return () => {
      alive = false
      clearTimeout(timeout)
    }
  }, [value, selected, disabled])

  function choose(song) {
    setSelected(song)
    setValue(`${song.title} — ${song.artist}`)
    setSuggestions([])
  }

  return html`
    <form className="guess-input" onSubmit=${submit}>
      <div className="guess-row">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l5 5" />
        </svg>
        <input
          value=${value}
          onChange=${(event) => {
            setValue(event.target.value)
            setSelected(null)
            setSearchError('')
          }}
          placeholder="What song is this?"
          aria-label="Song guess"
          disabled=${disabled}
        />
        <button type="submit" className="enter-badge" disabled=${disabled || !value.trim()}>ENTER ↵</button>
      </div>
      ${(searching || suggestions.length > 0 || searchError) && html`
        <div className="guess-suggestions" role="listbox" aria-label="Song suggestions">
          <div className="guess-suggestions__header">
            <strong>YOUR GUESS</strong>
            <span>${searching ? 'SEARCHING CATALOG...' : 'SELECT A MATCH'}</span>
          </div>
          ${searching && html`<div className="guess-suggestions__status">Finding songs that match your guess...</div>`}
          ${searchError && html`<div className="guess-suggestions__status">${searchError}</div>`}
          ${suggestions.map((song) => html`
            <button
              key=${song.id}
              type="button"
              className="guess-suggestion"
              onClick=${() => choose(song)}
              role="option"
            >
              ${song.artwork
                ? html`<img src=${song.artwork} alt="" />`
                : html`<span className="guess-suggestion__art" aria-hidden="true"></span>`}
              <span className="guess-suggestion__copy">
                <strong>${song.title}</strong>
                <small>${song.artist} · ${song.album}</small>
              </span>
            </button>
          `)}
        </div>
      `}
      <p className=${`feedback${tone}`}>${feedback}</p>
    </form>
  `
}
