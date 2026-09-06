import { useMemo, useState, useEffect, useCallback, useRef, useReducer } from 'https://esm.sh/react@19'
import { html } from './html.js'
import Sidebar from './components/Sidebar.js'
import Header from './components/Header.js'
import GameArea from './components/GameArea.js'
import StatsPanel from './components/StatsPanel.js'
import MultiplayerDashboard from './components/MultiplayerDashboard.js'
import useMultiplayerGame from './hooks/useMultiplayerGame.js'
import useSupabaseAuth from './hooks/useSupabaseAuth.js'
import useOnlineLobby from './hooks/useOnlineLobby.js'
import useOnlineGame from './hooks/useOnlineGame.js'
import ProfilePanel from './components/ProfilePanel.js'
import SettingsPage from './components/SettingsPage.js'
import SongReveal from './components/SongReveal.js'
import { isSupabaseConfigured } from './supabase/client.js'
import { difficultyKeyClass } from './difficulty.js'
import useTrackAudio from './hooks/useTrackAudio.js'
import { fetchRandomTrack, eraToYears } from './spotify/client.js'
import { resetSessionTrackHistory } from './data/tracks.js'
import { CLASSIC_STATS_KEY, restoreClassicStats, classicStatsReducer } from './classicStats.js'

function buildAliases(track) {
  const title = String((track && track.title) || '').toLowerCase().trim()
  const artist = String((track && track.artist) || '').toLowerCase().trim()
  const aliases = new Set()
  if (title) aliases.add(title)
  if (title && artist) aliases.add(`${artist} ${title}`)
  if (title) {
    const tokens = title.split(/[^a-z0-9]+/i).filter(Boolean)
    if (tokens.length >= 2) aliases.add(tokens.join(' '))
  }
  return Array.from(aliases)
}

function loadStat(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v !== null ? JSON.parse(v) : fallback
  } catch { return fallback }
}

export default function App() {
  const [page, setPage] = useState('game')
  const [mode, setMode] = useState(() => loadStat('musync-mode', 'classic'))
  const [era, setEra] = useState('Any Era')
  const [genre, setGenre] = useState('Any Genre')
  const [musicOrigin, setMusicOrigin] = useState('International')
  const [classicDifficulty, setClassicDifficulty] = useState(() => loadStat('musync-classic-difficulty', loadStat('musync-difficulty', 1)))
  const [multiplayerDifficulty, setMultiplayerDifficulty] = useState(() => loadStat('musync-multiplayer-difficulty', loadStat('musync-difficulty', 1)))
  const [multiplayerPractice, setMultiplayerPractice] = useState(false)
  const [practiceLaunchRequested, setPracticeLaunchRequested] = useState(false)
  const [classicStats, updateClassicStats] = useReducer(classicStatsReducer, null, () => restoreClassicStats(loadStat(CLASSIC_STATS_KEY, null)))
  const { round, score, streak, bestStreak, correct, attempts, roundsPlayed } = classicStats
  const [displayName, setDisplayName] = useState(() =>
    loadStat('musync-name', 'Elite Listener'),
  )
  const [statsCollapsed, setStatsCollapsed] = useState(() =>
    loadStat('musync-stats-collapsed', false),
  )
  const [feedback, setFeedback] = useState('')
  const [classicUserGuess, setClassicUserGuess] = useState('')
  const [classicReveal, setClassicReveal] = useState(false)
  const [classicAnswerLocked, setClassicAnswerLocked] = useState(false)
  const [classicResultCorrect, setClassicResultCorrect] = useState(false)
  const [classicRevealStartAt, setClassicRevealStartAt] = useState(0)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('spotify') || params.has('spotify_reason')) {
      window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`)
    }
  }, [])

  const [classicTracks, setClassicTracks] = useState([])
  const [classicTrackId, setClassicTrackId] = useState(null)
  const [classicPoolLoading, setClassicPoolLoading] = useState(false)
  const [classicPoolError, setClassicPoolError] = useState('')
  const classicRecentRef = useRef([])
  const classicNextRef = useRef(null)
  const classicPlaybackPositionRef = useRef(0)
  const classicAdvancingRef = useRef(false)
  const classicGenerationRef = useRef(0)
  const classicTrack = classicTracks.find((t) => t.id === classicTrackId) || null

  async function resolveClassicTrack(recentIds) {
    const { yearFrom, yearTo } = musicOrigin === 'OPM / Local' ? {} : eraToYears(era)
    const searchGenre = musicOrigin === 'OPM / Local' ? 'Any Genre' : genre
    const track = await fetchRandomTrack({ genre: searchGenre, musicOrigin, yearFrom, yearTo, difficulty: classicDifficulty, recentIds, source: 'classic' })
    return track ? { source: track.source, track } : null
  }

  useEffect(() => {
    if (mode !== 'classic' || page !== 'game') return
    resetSessionTrackHistory()
    let alive = true
    const generation = ++classicGenerationRef.current
    setClassicPoolLoading(true)
    setClassicTracks([])
    setClassicTrackId(null)
    setClassicPoolError(null)
    setClassicReveal(false)
    setClassicAnswerLocked(false)
    setClassicResultCorrect(false)
    setClassicRevealStartAt(0)
    classicPlaybackPositionRef.current = 0
    console.log('[Track] loading started')
    console.log('[Track] request started')
    resolveClassicTrack([]).then((resolved) => {
      if (!alive) return
      const track = resolved ? resolved.track : null
      if (track) updateClassicStats({ type: 'advance' })
      const tracks = track ? [track] : []
      setClassicTracks(tracks)
      console.log(`[Track] tracks parsed: ${tracks.length}`)
      classicRecentRef.current = track ? [track.id] : []
      setClassicTrackId(track ? track.id : null)
      if (track) console.log('[Track] current song selected')
      setClassicPoolLoading(false)
      console.log('[Track] loading finished')
      setClassicPoolError(
        tracks.length
          ? null
          : 'No songs matched these filters. Try another genre or era.',
      )
    }).catch((error) => {
      if (!alive) return
      console.warn('[Track] loading failed', error?.message || error)
      setClassicTracks([])
      setClassicTrackId(null)
      setClassicPoolLoading(false)
      console.log('[Track] loading finished')
      setClassicPoolError(error?.message || 'Spotify could not load songs.')
    })
    return () => {
      alive = false
      if (classicGenerationRef.current === generation) classicGenerationRef.current += 1
    }
  }, [mode, page, genre, musicOrigin, era, classicDifficulty])

  const classicDuration = (classicTrack && classicTrack.durationMs
    ? Math.min(15, Math.round(classicTrack.durationMs / 1000))
    : 15)

  const classicAudio = useTrackAudio(
    classicTrack ? classicTrack.id : null,
    classicTrack && classicTrack.playbackUrl ? classicTrack.playbackUrl : null,
    classicTrack?.playbackType,
  )

  async function nextClassicTrack() {
    const generation = classicGenerationRef.current
    setClassicPoolLoading(true)
    setClassicPoolError(null)
    let resolved
    try {
      resolved = await resolveClassicTrack(classicRecentRef.current)
    } catch (error) {
      if (generation !== classicGenerationRef.current) return false
      setClassicPoolLoading(false)
      setClassicPoolError(error?.message || 'Spotify could not load another song.')
      return false
    }
    if (generation !== classicGenerationRef.current) return false
    if (!resolved) {
      setClassicPoolLoading(false)
      setClassicPoolError('Could not find another unique song.')
      return false
    }
    const next = resolved.track
    const recent = [...classicRecentRef.current, next.id].slice(-15)
    classicRecentRef.current = recent
    setClassicTracks([next])
    setClassicTrackId(next.id)
    setClassicPoolLoading(false)
    setClassicResultCorrect(false)
    setClassicRevealStartAt(0)
    classicPlaybackPositionRef.current = 0
    updateClassicStats({ type: 'advance' })
    return true
  }

  const auth = useSupabaseAuth()
  const onlineActive = isSupabaseConfigured
  const multiplayerDisplayName = auth.user ? displayName : 'Anon'
  const game = useMultiplayerGame(multiplayerDisplayName)
  const effectiveProfile = auth.profile ? { ...auth.profile, display_name: displayName } : { display_name: displayName }
  const onlineLobby = useOnlineLobby({ user: auth.user, profile: effectiveProfile, poolFilters: { genre, era, difficulty: multiplayerDifficulty } })
  const onlineGame = useOnlineGame({
    session: onlineLobby.session,
    rounds: onlineLobby.rounds,
    roundPlayers: onlineLobby.roundPlayers,
    user: auth.user,
    onAdvance: onlineLobby.advance,
    poolFilters: { genre, era, difficulty: multiplayerDifficulty },
  })

  useEffect(() => {
    try {
      localStorage.setItem('musync-mode', JSON.stringify(mode))
      localStorage.setItem('musync-classic-difficulty', JSON.stringify(classicDifficulty))
      localStorage.setItem('musync-multiplayer-difficulty', JSON.stringify(multiplayerDifficulty))
      localStorage.setItem(CLASSIC_STATS_KEY, JSON.stringify(classicStats))
      localStorage.setItem('musync-name', JSON.stringify(displayName))
      localStorage.setItem('musync-stats-collapsed', JSON.stringify(statsCollapsed))
    } catch {}
  }, [mode, classicDifficulty, multiplayerDifficulty, classicStats, displayName, statsCollapsed])

  const accuracy = useMemo(
    () => Math.round((correct / Math.max(attempts, 1)) * 100),
    [correct, attempts],
  )

  const multiplayer = page === 'game' && mode === 'multiplayer'
  const multiplayerMode = mode === 'multiplayer'

  function submitGuess(raw) {
    if (classicPoolLoading || classicReveal || classicAnswerLocked) return
    const active = classicTrack
    if (!active) return
    const guess = typeof raw === 'object'
      ? ''
      : raw.trim().toLowerCase()
    const selectedTrack = typeof raw === 'object' ? raw : null
    if (!selectedTrack && !guess) return
    setClassicUserGuess(selectedTrack ? `${selectedTrack.title} - ${selectedTrack.artist}` : raw.trim())
    const aliases = active.aliases || buildAliases(active)
    const normalize = (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    const normalizedGuess = normalize(guess)
    const hit = selectedTrack
      ? selectedTrack.id === active.id
      : aliases.some((alias) => normalizedGuess.includes(normalize(alias)))
    const bonus = (classicDifficulty + 1) * 50 + streak * 10
    updateClassicStats({ type: 'guess', correct: hit, points: bonus })

    if (hit) {
      setFeedback(`Correct — ${active.title} · +${bonus}`)
      setClassicAnswerLocked(true)
      setClassicResultCorrect(true)
      setClassicRevealStartAt(classicPlaybackPositionRef.current)
      setClassicReveal(true)
    } else {
      setFeedback('Incorrect answer. Keep listening.')
    }
  }

  async function advanceClassicRound() {
    if (classicAdvancingRef.current) return
    classicAdvancingRef.current = true
    let loaded
    try { loaded = await nextClassicTrack() } finally { classicAdvancingRef.current = false }
    if (!loaded) return
    setClassicReveal(false)
    setClassicAnswerLocked(false)
    setClassicResultCorrect(false)
    setClassicRevealStartAt(0)
    classicPlaybackPositionRef.current = 0
    setFeedback('')
    setClassicUserGuess('')
  }

  function revealMissedClassicRound(position) {
    if (!classicTrack || classicPoolLoading || classicReveal || classicAnswerLocked) return
    updateClassicStats({ type: 'miss' })
    const revealStart = Math.max(0, Number(position) || classicPlaybackPositionRef.current || 0)
    setClassicAnswerLocked(true)
    setClassicResultCorrect(false)
    setClassicRevealStartAt(revealStart)
    setClassicReveal(true)
  }

  function handleModeChange(newMode) {
    setMode(newMode)
    if (newMode === 'multiplayer' && page !== 'game') {
      setPage('game')
    }
  }

  return html`
    <div className=${`app-shell${multiplayerMode ? ' is-multiplayer' : ''}${multiplayerPractice ? ' is-mp-practice' : ''} ${difficultyKeyClass(multiplayerMode ? multiplayerDifficulty : classicDifficulty)}${!multiplayerMode && statsCollapsed ? ' stats-collapsed' : ''}`}>
      <${Sidebar}
        activePage=${page}
        onNavigate=${setPage}
      />

      <main key=${mode} className=${multiplayer ? 'center-column center-column--mp' : `center-column${page === 'game' ? ' center-column--game' : ''}`}>
        ${multiplayer
          ? html`<${MultiplayerDashboard}
              mode=${mode}
              onModeChange=${handleModeChange}
              game=${game}
              genre=${genre}
              era=${era}
              onStartMatch=${() => game.startGame({ genre, era, difficulty: multiplayerDifficulty })}
              auth=${auth}
              onlineActive=${onlineActive}
              online=${onlineLobby}
              onlineGame=${onlineGame}
              difficulty=${multiplayerDifficulty}
              onDifficultyChange=${setMultiplayerDifficulty}
              onPracticeStateChange=${setMultiplayerPractice}
              startInPractice=${practiceLaunchRequested}
              onPracticeLaunchHandled=${() => setPracticeLaunchRequested(false)}
              onDisplayNameChange=${setDisplayName}
              displayName=${displayName}
            />`
          : html`
              <${Header}
                mode=${mode}
                onModeChange=${handleModeChange}
                showModeToggle=${page === 'game'}
              />
              ${page === 'game' &&
              html`
                <${GameArea}
                  era=${era}
                  genre=${genre}
                  musicOrigin=${musicOrigin}
                  onEraChange=${setEra}
                  onGenreChange=${setGenre}
                  onMusicOriginChange=${setMusicOrigin}
                  duration=${classicDuration}
                  trackId=${classicTrackId}
                  playbackUrl=${classicAudio.playbackUrl}
                  playbackType=${classicAudio.playbackType}
                  audioLoading=${classicPoolLoading || classicAudio.loading}
                  audioError=${classicPoolError || classicAudio.error}
                  onSkip=${revealMissedClassicRound}
                  onExpire=${revealMissedClassicRound}
                  onPlaybackPositionChange=${(position) => {
                    classicPlaybackPositionRef.current = Math.max(0, Number(position) || 0)
                  }}
                  answerLocked=${classicReveal || classicAnswerLocked}
                  revealActive=${classicReveal}
                  onPractice=${() => { setPracticeLaunchRequested(true); setMode('multiplayer') }}
                  onSubmit=${submitGuess}
                  feedback=${feedback}
                />
                ${classicReveal && html`
                  <${SongReveal}
                    song=${classicTrack}
                    isCorrectAnswer=${classicResultCorrect}
                    userGuess=${classicUserGuess}
                    round=${round}
                    totalRounds=${10}
                    playbackUrl=${classicAudio.playbackUrl}
                    playbackType=${classicAudio.playbackType}
                    startAt=${classicRevealStartAt}
                    onContinue=${advanceClassicRound}
                  />
                `}
              `}
              ${page === 'statistics' &&
              html`
                <section className="page-panel">
                  <h2>STATISTICS</h2>
                  <p>Your listening performance across every round.</p>
                  <div className="stats-grid">
                    <article className="card">
                      <h3>LIFETIME SCORE</h3>
                      <strong>${score.toLocaleString()}</strong>
                    </article>
                    <article className="card">
                      <h3>BEST STREAK</h3>
                      <strong>${bestStreak}x</strong>
                    </article>
                    <article className="card">
                      <h3>ACCURACY</h3>
                      <strong>${accuracy}%</strong>
                    </article>
                    <article className="card">
                      <h3>ROUNDS PLAYED</h3>
                      <strong>${roundsPlayed}</strong>
                    </article>
                  </div>
                </section>
              `}
              ${page === 'profile' &&
              html`
                <${ProfilePanel}
                  profile=${effectiveProfile}
                  score=${score}
                  streak=${streak}
                  bestStreak=${bestStreak}
                  accuracy=${accuracy}
                  attempts=${attempts}
                  roundsPlayed=${roundsPlayed}
                  genre=${genre}
                  onGenreChange=${setGenre}
                  name=${displayName}
                  onSaveName=${setDisplayName}
                />
              `}
              ${page === 'settings' &&
              html`
                <${SettingsPage}
                  difficulty=${classicDifficulty}
                  onDifficultyChange=${setClassicDifficulty}
                  showDifficulty=${mode !== 'multiplayer'}
                />
              `}
            `}
      </main>

      ${!multiplayerMode &&
      html`
        <button
          type="button"
          className="stats-toggle"
          aria-label=${statsCollapsed ? 'Expand stats panel' : 'Collapse stats panel'}
          title=${statsCollapsed ? 'Expand stats' : 'Collapse stats'}
          onClick=${() => setStatsCollapsed((c) => !c)}
        >
          ${statsCollapsed
            ? html`<svg viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2 3 10l7 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
            : html`<svg viewBox="0 0 12 20" aria-hidden="true"><path d="M2 2l7 8-7 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`}
        </button>
        <${StatsPanel}
          round=${round}
          score=${score}
          streak=${streak}
          accuracy=${accuracy}
          difficulty=${classicDifficulty}
          onDifficultyChange=${setClassicDifficulty}
        />
      `}
    </div>
  `
}
