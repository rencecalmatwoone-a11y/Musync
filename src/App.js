import { useMemo, useState, useEffect, useCallback, useRef } from 'https://esm.sh/react@19'
import { html } from './html.js'
import Sidebar from './components/Sidebar.js'
import Header from './components/Header.js'
import GameArea from './components/GameArea.js'
import StatsPanel from './components/StatsPanel.js'
import MultiplayerDashboard from './components/MultiplayerDashboard.js'
import useMultiplayerGame from './hooks/useMultiplayerGame.js'
import useFriendLobby from './hooks/useFriendLobby.js'
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

// Build a set of forgiving aliases from a track so a typed guess matches by
// title, "artist title", or a meaningful title token.
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
  const [classicDifficulty, setClassicDifficulty] = useState(() => loadStat('musync-classic-difficulty', loadStat('musync-difficulty', 1)))
  const [multiplayerDifficulty, setMultiplayerDifficulty] = useState(() => loadStat('musync-multiplayer-difficulty', loadStat('musync-difficulty', 1)))
  const [multiplayerPractice, setMultiplayerPractice] = useState(false)
  const [round, setRound] = useState(() => loadStat('musync-round', 4))
  const [score, setScore] = useState(() => loadStat('musync-score', 1250))
  const [streak, setStreak] = useState(() => loadStat('musync-streak', 5))
  const [correct, setCorrect] = useState(() => loadStat('musync-correct', 23))
  const [attempts, setAttempts] = useState(() => loadStat('musync-attempts', 25))
  const [displayName, setDisplayName] = useState(() =>
    loadStat('musync-name', 'Elite Listener'),
  )
  const [statsCollapsed, setStatsCollapsed] = useState(() =>
    loadStat('musync-stats-collapsed', false),
  )
  const [feedback, setFeedback] = useState('')
  const [classicReveal, setClassicReveal] = useState(false)
  const [classicAnswerLocked, setClassicAnswerLocked] = useState(false)
  const [classicResultCorrect, setClassicResultCorrect] = useState(false)
  const [classicRevealStartAt, setClassicRevealStartAt] = useState(0)

  // Classic-mode dynamic track sourced from the Spotify pool.
  const [classicTracks, setClassicTracks] = useState([])
  const [classicTrackId, setClassicTrackId] = useState(null)
  const [classicPoolLoading, setClassicPoolLoading] = useState(false)
  const [classicPoolError, setClassicPoolError] = useState('')
  const classicRecentRef = useRef([])
  const classicNextRef = useRef(null)
  const classicPlaybackPositionRef = useRef(0)
  const classicTrack = classicTracks.find((t) => t.id === classicTrackId) || null

  // Load a fresh Spotify pool whenever the classic filters change, then pick a
  // random starting track. This keeps genre / era / difficulty honest and
  // guarantees no repeats within the recent-song cooldown.
  // Resolve the active classic track from Spotify. Preview audio is optional in
  // Spotify's response and is handled by the existing player UI.
  async function resolveClassicTrack(recentIds) {
    const { yearFrom, yearTo } = eraToYears(era)
    const track = await fetchRandomTrack({ genre, yearFrom, yearTo, difficulty: classicDifficulty, recentIds })
    return track ? { source: track.source, track } : null
  }

  useEffect(() => {
    if (mode !== 'classic' || page !== 'game') return
    resetSessionTrackHistory()
    let alive = true
    setClassicPoolLoading(true)
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
    }
  }, [mode, page, genre, era, classicDifficulty])

  const classicDuration = (classicTrack && classicTrack.durationMs
    ? Math.min(15, Math.round(classicTrack.durationMs / 1000))
    : 15)

  // Keep the approved anonymous audio URL attached to the selected track.
  const classicAudio = useTrackAudio(
    classicTrack ? classicTrack.id : null,
    classicTrack && classicTrack.playbackUrl ? classicTrack.playbackUrl : null,
    classicTrack?.playbackType,
  )

  async function nextClassicTrack() {
    setClassicPoolLoading(true)
    setClassicPoolError(null)
    let resolved
    try {
      resolved = await resolveClassicTrack(classicRecentRef.current)
    } catch (error) {
      setClassicPoolLoading(false)
      setClassicPoolError(error?.message || 'Spotify could not load another song.')
      return
    }
    if (!resolved) {
      setClassicPoolLoading(false)
      setClassicPoolError('Could not find another unique song.')
      return
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
  }

  const game = useMultiplayerGame(displayName)
  const lobby = useFriendLobby(displayName)

  // Supabase online layer — available whenever it's configured. Sign-in is
  // prompted by the dashboard when opening the online lobby, so the PLAY ONLINE
  // option is always reachable (no deadlock on an already-authenticated user).
  const auth = useSupabaseAuth()
  const onlineActive = isSupabaseConfigured
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
      localStorage.setItem('musync-round', JSON.stringify(round))
      localStorage.setItem('musync-score', JSON.stringify(score))
      localStorage.setItem('musync-streak', JSON.stringify(streak))
      localStorage.setItem('musync-correct', JSON.stringify(correct))
      localStorage.setItem('musync-attempts', JSON.stringify(attempts))
      localStorage.setItem('musync-name', JSON.stringify(displayName))
      localStorage.setItem('musync-stats-collapsed', JSON.stringify(statsCollapsed))
    } catch { /* noop */ }
  }, [mode, classicDifficulty, multiplayerDifficulty, round, score, streak, correct, attempts, displayName, statsCollapsed])

  const accuracy = useMemo(
    () => Math.round((correct / Math.max(attempts, 1)) * 100),
    [correct, attempts],
  )

  const multiplayer = page === 'game' && mode === 'multiplayer'
  const multiplayerMode = mode === 'multiplayer'

  function submitGuess(raw) {
    if (classicReveal || classicAnswerLocked) return
    const active = classicTrack
    if (!active) return
    const guess = typeof raw === 'object'
      ? ''
      : raw.trim().toLowerCase()
    const selectedTrack = typeof raw === 'object' ? raw : null
    if (!selectedTrack && !guess) return
    const aliases = active.aliases || buildAliases(active)
    const normalize = (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    const normalizedGuess = normalize(guess)
    const hit = selectedTrack
      ? selectedTrack.id === active.id
      : aliases.some((alias) => normalizedGuess.includes(normalize(alias)))
    setAttempts((n) => n + 1)

    if (hit) {
      const bonus = (classicDifficulty + 1) * 50 + streak * 10
      setScore((n) => n + bonus)
      setStreak((n) => n + 1)
      setCorrect((n) => n + 1)
      setRound((n) => n + 1)
      setFeedback(`Correct — ${active.title} · +${bonus}`)
      setClassicAnswerLocked(true)
      setClassicResultCorrect(true)
      setClassicRevealStartAt(classicPlaybackPositionRef.current)
      setClassicReveal(true)
    } else {
      setStreak(0)
      setFeedback('Incorrect answer. Keep listening.')
    }
  }

  function advanceClassicRound() {
    nextClassicTrack()
    setClassicReveal(false)
    setClassicAnswerLocked(false)
    setClassicResultCorrect(false)
    setClassicRevealStartAt(0)
    classicPlaybackPositionRef.current = 0
    setFeedback('')
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

      <main key=${mode} className=${multiplayer ? 'center-column center-column--mp' : 'center-column'}>
        ${multiplayer
          ? html`<${MultiplayerDashboard}
              mode=${mode}
              onModeChange=${handleModeChange}
              game=${game}
              lobby=${lobby}
              onStartMatch=${() => game.startGame({ genre, era, difficulty: multiplayerDifficulty })}
              auth=${auth}
              onlineActive=${onlineActive}
              online=${onlineLobby}
              onlineGame=${onlineGame}
              difficulty=${multiplayerDifficulty}
              onDifficultyChange=${setMultiplayerDifficulty}
              onPracticeStateChange=${setMultiplayerPractice}
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
                  onEraChange=${setEra}
                  onGenreChange=${setGenre}
                  duration=${classicDuration}
                  trackId=${classicTrackId}
                  playbackUrl=${classicAudio.playbackUrl}
                  playbackType=${classicAudio.playbackType}
                  audioLoading=${classicPoolLoading || classicAudio.loading}
                  audioError=${classicPoolError || classicAudio.error}
                  onSkip=${(position) => {
                    const revealStart = Math.max(0, Number(position) || classicPlaybackPositionRef.current || 0)
                    setClassicAnswerLocked(true)
                    setClassicResultCorrect(false)
                    setClassicRevealStartAt(revealStart)
                    setClassicReveal(true)
                  }}
                  onExpire=${(position) => {
                    const revealStart = Math.max(0, Number(position) || classicPlaybackPositionRef.current || 0)
                    setClassicAnswerLocked(true)
                    setClassicResultCorrect(false)
                    setClassicRevealStartAt(revealStart)
                    setClassicReveal(true)
                  }}
                  onPlaybackPositionChange=${(position) => {
                    classicPlaybackPositionRef.current = Math.max(0, Number(position) || 0)
                  }}
                  answerLocked=${classicReveal || classicAnswerLocked}
                  revealActive=${classicReveal}
                  onSubmit=${submitGuess}
                  feedback=${feedback}
                />
                ${classicReveal && html`
                  <${SongReveal}
                    song=${classicTrack}
                    isCorrectAnswer=${classicResultCorrect}
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
                      <strong>${Math.max(streak, 5)}x</strong>
                    </article>
                    <article className="card">
                      <h3>ACCURACY</h3>
                      <strong>${accuracy}%</strong>
                    </article>
                    <article className="card">
                      <h3>ROUNDS PLAYED</h3>
                      <strong>${attempts}</strong>
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
                  accuracy=${accuracy}
                  attempts=${attempts}
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
