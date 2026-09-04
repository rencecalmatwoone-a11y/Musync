import { useEffect, useState, useMemo, useRef } from 'https://esm.sh/react@19'
import { html } from '../html.js'
import ModeToggle from './ModeToggle.js'
import LobbyStandings from './LobbyStandings.js'
import BattleArena from './BattleArena.js'
import BattleIntel from './BattleIntel.js'
import SettingsPanel from './SettingsPanel.js'
import FinalResults from './FinalResults.js'
import SongReveal from './SongReveal.js'
import FriendLobby from './FriendLobby.js'
import AuthPanel from './AuthPanel.js'
import Difficulty from './Difficulty.js'
import useTrackAudio from '../hooks/useTrackAudio.js'

export default function MultiplayerDashboard({
  mode,
  onModeChange,
  game,
  lobby,
  onStartMatch,
  auth,
  onlineActive,
  online,
  onlineGame,
  genre,
  era,
  difficulty,
  onDifficultyChange,
  onPracticeStateChange,
}) {
  const [showSettings, setShowSettings] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [showLeave, setShowLeave] = useState(false)
  // Landing screen: 'menu' shows the two mode cards, 'friends' shows the
  // create/join lobby, 'practice' shows the AI practice setup.
  const [screen, setScreen] = useState('menu')
  // Practice setup state.
  const [aiDifficulty, setAiDifficulty] = useState(0) // 0 Easy, 1 Medium, 2 Hard
  const [practiceStarting, setPracticeStarting] = useState(false)
  // Which lobby backend to use: 'online' (Supabase) or 'local' (simulation).
  // Defaults to online only when already configured (it is, since the PLAY
  // ONLINE button only shows under onlineActive).
  const [transport, setTransport] = useState('local')
  // Whether the player asked to go online and is waiting on an auth prompt.
  const wantOnlineRef = useRef(false)
  // True when the current local battle was launched as Practice vs AI, so that
  // "PLAY AGAIN" restarts the same AI battle rather than a friend match.
  const isPracticeRef = useRef(false)

  // If the player tapped PLAY ONLINE and then completed sign-in, drop them
  // straight into the online lobby instead of requiring a second click.
  useEffect(() => {
    if (wantOnlineRef.current && onlineActive && auth.status === 'authenticated') {
      wantOnlineRef.current = false
      setTransport('online')
    }
  }, [onlineActive, auth.status])

  const handlePlayOnline = () => {
    if (auth.status === 'authenticated') {
      setTransport('online')
    } else {
      wantOnlineRef.current = true
      setShowAuth(true)
    }
  }

  const {
    round,
    totalRounds,
    phase,
    players,
    yourRank,
    you,
    roundOptions,
    selectedAnswer,
    isCorrectAnswer,
    feedback,
    ticker,
    playerScore,
    playerStreak,
    playerCorrect,
    playerAsked,
    accuracy,
    avgSpeed,
    gameOver,
    settings,
    timer,
    clipDuration,
    correctSong,
    startGame,
    handleAnswer,
    advance,
    addFriend,
    updateSettings,
    resetToLobby,
  } = game

  const gap = you && players[1] ? you.score - players[1].score : 0

  // Keep the approved anonymous audio URL attached to the current song.
  const localAudio = useTrackAudio(
    game.currentSongId,
    game.correctSong ? game.correctSong.playbackUrl : null,
    game.correctSong?.playbackType,
  )
  const onlineAudio = useTrackAudio(
    onlineGame && onlineGame.song ? onlineGame.song.id : null,
    onlineGame && onlineGame.song ? onlineGame.song.playbackUrl : null,
    onlineGame?.song?.playbackType,
  )

  // When a friend joins the local lobby, add them as an independent player.
  useEffect(() => {
    if (transport === 'local' && lobby && lobby.guest) {
      addFriend(lobby.guest)
    }
  }, [transport, lobby, addFriend])

  const handleStart = () => {
    isPracticeRef.current = false
    if (onPracticeStateChange) onPracticeStateChange(false)
    if (onStartMatch) onStartMatch()
    else startGame()
  }

  // AI skill -> probability the opponent guesses correctly.
  // Easy ~35%, Medium ~65%, Hard ~90%.
  const AI_SKILL = [0.35, 0.65, 0.9]

  const practiceDifficulty = typeof difficulty === 'number' ? difficulty : 1

  useEffect(() => {
    setAiDifficulty(Math.min(2, Math.max(0, practiceDifficulty)))
  }, [practiceDifficulty])

  const handleDifficultyChange = (value) => {
    const nextDifficulty = typeof value === 'number' ? value : 1
    if (onDifficultyChange) onDifficultyChange(nextDifficulty)
    setAiDifficulty(Math.min(2, Math.max(0, nextDifficulty)))
  }

  const handleAiDifficultyChange = (value) => {
    const nextAiDifficulty = Math.min(2, Math.max(0, Number(value) || 0))
    setAiDifficulty(nextAiDifficulty)
    if (onDifficultyChange) onDifficultyChange(nextAiDifficulty)
  }

  const handleStartPractice = async () => {
    setPracticeStarting(true)
    try {
      isPracticeRef.current = true
      if (onPracticeStateChange) onPracticeStateChange(true)
      // Practice is always local — switch transport so the online early-return
      // does not block the local game render.
      setTransport('local')
      await startGame({
        genre,
        era,
        difficulty: practiceDifficulty,
        ai: {
          name: 'A.I.',
          skill: AI_SKILL[aiDifficulty] ?? 0.65,
        },
      })
      setScreen('menu')
    } finally {
      setPracticeStarting(false)
    }
  }

  const handlePlayAgain = () => {
    if (isPracticeRef.current) {
      startGame({
        genre,
        era,
        difficulty: practiceDifficulty,
        ai: { name: 'A.I.', skill: AI_SKILL[aiDifficulty] ?? 0.65 },
      })
    } else if (onStartMatch) {
      onStartMatch()
    } else {
      startGame()
    }
  }

  // ---------------------------------------------------------------------------
  // ONLINE (Supabase) rendering — drives the same UI components with live data.
  // ---------------------------------------------------------------------------
  const onlineMode = onlineActive && transport === 'online'

  const onlineOptions = useMemo(() => {
    return onlineGame?.options || []
  }, [onlineGame?.options])

  const onlineIntent = onlineActive && transport === 'online'

  if (onlineIntent) {
    // ---- Online lobby (idle / lobby) ----
    if (online.phase === 'idle' || online.phase === 'lobby') {
      const joinCode =
        new URLSearchParams(window.location.search).get('room') || ''
      return html`
        <div className="mp-dashboard">
          <div className="mp-top">
            <div className="mp-top__row">
              <${ModeToggle} value=${mode} onChange=${onModeChange} />
              <button type="button" className="auth-chip" onClick=${() => setShowAuth(true)}>
                ${auth.user?.email || auth.profile?.display_name || 'Player'}
              </button>
            </div>
          </div>

          ${screen === 'menu' && html`
            <${MultiplayerMenu}
              onFriends=${() => setScreen('friends')}
              onPractice=${() => { if (onPracticeStateChange) onPracticeStateChange(true); setScreen('practice') }}
            />
          `}

          ${screen === 'friends' && html`
            <${FriendLobby}
              lobby=${{
                ...online,
                code: online.code || null,
                host: online.host,
                guest: online.guest,
              }}
              joinCode=${joinCode}
              onJoin=${(c) => online.joinRoom(c)}
              onStart=${online.startMatch}
              onBack=${() => { if (onPracticeStateChange) onPracticeStateChange(false); setScreen('menu') }}
            />
          `}

          ${screen === 'practice' && html`
            <${PracticeSetup}
              aiDifficulty=${aiDifficulty}
              onAiDifficulty=${handleAiDifficultyChange}
              musicDifficulty=${practiceDifficulty}
              onMusicDifficulty=${handleDifficultyChange}
              starting=${practiceStarting}
              onBack=${() => setScreen('menu')}
              onStart=${handleStartPractice}
            />
          `}

          ${showAuth && html`<${AuthPanel} auth=${auth} onClose=${() => setShowAuth(false)} />`}
          ${online.error && html`<p className="mp-err">${online.error}</p>`}
        </div>
      `
    }

    // ---- Online game active ----
    if (online.phase === 'live' || online.phase === 'results') {
      const og = onlineGame
      const onlinePlayers = (online.roundPlayers || []).map((p, i) => ({
        ...p,
        rank: i + 1,
        status: 'guessed',
        you: p.user_id === auth.user?.id,
      }))

      if (og.phase === 'reveal') {
        return html`
          <div className="mp-dashboard mp-dashboard--reveal">
            <div className="mp-reveal-background" aria-hidden="true">
              <div className="mp-reveal-background__panel">
                <span>ROUND ${og.currentRound}/${og.totalRounds}</span>
                <strong>${og.song?.title || 'ROUND COMPLETE'}</strong>
                <small>${og.song?.artist || ''}</small>
              </div>
            </div>
            <div className="mp-top">
              <div className="mp-top__row">
                <${ModeToggle} value=${mode} onChange=${onModeChange} disabled />
                <button
                  type="button"
                  className="mp-exit-btn"
                  onClick=${() => setShowLeave(true)}
                >
                  EXIT GAME
                </button>
              </div>
            </div>
            <${SongReveal}
              song=${og.song}
              isCorrectAnswer=${og.isCorrect}
              round=${og.currentRound}
              totalRounds=${og.totalRounds}
              playbackUrl=${onlineAudio.playbackUrl}
              playbackType=${onlineAudio.playbackType}
              startAt=${10}
              onContinue=${() => online.advance()}
            />
            ${showLeave && html`
              <${LeaveModal}
                onCancel=${() => setShowLeave(false)}
                onLeave=${online.leave}
              />
            `}
          </div>
        `
      }

      if (og.phase === 'gameover') {
        return html`
          <div className="mp-dashboard">
            <div className="mp-top">
              <div className="mp-top__row">
                <${ModeToggle} value=${mode} onChange=${onModeChange} disabled />
                <button
                  type="button"
                  className="mp-exit-btn"
                  onClick=${() => setShowLeave(true)}
                >
                  EXIT GAME
                </button>
              </div>
            </div>
            <${FinalResults}
              players=${onlinePlayers}
              yourRank=${(onlinePlayers.find((p) => p.you) || {}).rank || 0}
              you=${onlinePlayers.find((p) => p.you)}
              accuracy=${((me) => (me && me.asked ? Math.round((me.correct / me.asked) * 100) : 0))(onlineGame.me)}
              avgSpeed=${' - '}
              totalRounds=${og.totalRounds}
              onPlayAgain=${() => { online.leave(); setScreen('menu') }}
              onBackToLobby=${() => { online.leave(); setScreen('menu') }}
            />
            ${showLeave && html`
              <${LeaveModal}
                onCancel=${() => setShowLeave(false)}
                onLeave=${online.leave}
              />
            `}
          </div>
        `
      }

      // playing
      return html`
        <div className="mp-dashboard">
          <div className="mp-top">
            <div className="mp-top__row">
              <${ModeToggle} value=${mode} onChange=${onModeChange} disabled />
              <span className="mp-online-badge">● ONLINE</span>
              <button
                type="button"
                className="mp-exit-btn"
                onClick=${() => setShowLeave(true)}
              >
                EXIT GAME
              </button>
            </div>
            <div className="mp-status">
              <div className="mp-status__left">
                <h2>LOBBY STANDINGS</h2>
                <span className="mp-chip">👤 ${onlinePlayers.length}/${onlinePlayers.length}</span>
                <span className="mp-chip mp-chip--battle">⚔ BATTLE ROUND ${og.currentRound}/${og.totalRounds}</span>
              </div>
              <div className="mp-timer">
                <span>TIME REMAINING</span>
                <strong>${og.formatted}</strong>
                <div className="mp-timer__watch" aria-hidden="true"></div>
              </div>
            </div>
          </div>

          <div className="mp-grid">
            <${LobbyStandings} players=${onlinePlayers} />
            <${BattleArena}
              roundOptions=${onlineOptions}
              selectedAnswer=${og.selectedAnswer}
              isCorrectAnswer=${og.isCorrect}
              correctSongId=${og.song?.id}
              onAnswer=${og.lockAnswer}
              clipDuration=${10}
              timerElapsed=${10 - og.remaining}
              timerDuration=${10}
              phase=${og.phase}
              playbackUrl=${onlineAudio.playbackUrl}
              playbackType=${onlineAudio.playbackType}
              trackId=${og.song?.id}
              audioLoading=${onlineAudio.loading}
              audioError=${onlineAudio.error || og.poolError}
            />
            <${BattleIntel}
              rank=${(onlinePlayers.find((p) => p.you) || {}).rank || 0}
              total=${onlinePlayers.length}
              gap=${0}
              score=${og.me?.score || 0}
              streak=${og.me?.streak || 0}
              avgSpeed=${' - '}
              accuracy=${og.me?.asked ? Math.round((og.me.correct / og.me.asked) * 100) : 0}
              correct=${og.me?.correct || 0}
              asked=${og.me?.asked || 0}
              remaining=${Math.max(0, og.totalRounds - (og.me?.asked || 0))}
            />
          </div>
          ${showLeave && html`
            <${LeaveModal}
              onCancel=${() => setShowLeave(false)}
              onLeave=${online.leave}
            />
          `}
        </div>
      `
    }

    // fallback: still online, show lobby
    return html`
      <div className="mp-dashboard">
        <div className="mp-top"><${ModeToggle} value=${mode} onChange=${onModeChange} /></div>
      </div>
    `
  }

  // ---------------------------------------------------------------------------
  // LOCAL (existing) rendering — unchanged
  // ---------------------------------------------------------------------------
  if (phase === 'lobby') {
    return html`
      <div className="mp-dashboard">
        <div className="mp-top">
          <div className="mp-top__row">
            <${ModeToggle} value=${mode} onChange=${onModeChange} />
            ${onlineActive && html`
              <button
                type="button"
                className="auth-chip"
                onClick=${handlePlayOnline}
              >
                🛰 ${auth.status === 'authenticated' ? 'PLAY ONLINE' : 'PLAY ONLINE · SIGN IN'}
              </button>
            `}
          </div>
        </div>
        ${showAuth && html`<${AuthPanel} auth=${auth} onClose=${() => setShowAuth(false)} />`}

        ${screen === 'menu' && html`
          <${MultiplayerMenu}
            onFriends=${() => setScreen('friends')}
            onPractice=${() => { if (onPracticeStateChange) onPracticeStateChange(true); setScreen('practice') }}
          />
        `}

        ${screen === 'friends' && html`
          <${FriendLobby} lobby=${lobby} onStart=${handleStart} onBack=${() => setScreen('menu')} />
        `}

        ${screen === 'practice' && html`
          <${PracticeSetup}
            aiDifficulty=${aiDifficulty}
            onAiDifficulty=${handleAiDifficultyChange}
            musicDifficulty=${practiceDifficulty}
            onMusicDifficulty=${handleDifficultyChange}
            starting=${practiceStarting}
            onBack=${() => { if (onPracticeStateChange) onPracticeStateChange(false); setScreen('menu') }}
            onStart=${handleStartPractice}
          />
        `}
      </div>
    `
  }

  if (gameOver) {
    return html`
      <div className="mp-dashboard">
        <div className="mp-top">
          <div className="mp-top__row">
            <${ModeToggle} value=${mode} onChange=${onModeChange} disabled />
            <button
              type="button"
              className="mp-exit-btn"
              onClick=${() => setShowLeave(true)}
            >
              EXIT GAME
            </button>
          </div>
        </div>
        <${FinalResults}
          players=${players}
          yourRank=${yourRank}
          you=${you}
          accuracy=${accuracy}
          avgSpeed=${avgSpeed}
          totalRounds=${totalRounds}
          onPlayAgain=${handlePlayAgain}
          onBackToLobby=${() => { resetToLobby(); setScreen('menu') }}
        />
        ${showLeave && html`
          <${LeaveModal}
            onCancel=${() => setShowLeave(false)}
            onLeave=${resetToLobby}
          />
        `}
      </div>
    `
  }

  if (phase === 'reveal') {
    return html`
      <div className="mp-dashboard mp-dashboard--reveal">
        <div className="mp-reveal-background" aria-hidden="true">
          <div className="mp-reveal-background__panel">
            <span>ROUND ${round}/${totalRounds}</span>
            <strong>${correctSong?.title || 'ROUND COMPLETE'}</strong>
            <small>${correctSong?.artist || ''}</small>
          </div>
        </div>
        <div className="mp-top">
          <div className="mp-top__row">
            <${ModeToggle} value=${mode} onChange=${onModeChange} disabled />
            <button
              type="button"
              className="mp-exit-btn"
              onClick=${() => setShowLeave(true)}
            >
              EXIT GAME
            </button>
          </div>
        </div>
        <${SongReveal}
          song=${correctSong}
          isCorrectAnswer=${isCorrectAnswer}
          round=${round}
          totalRounds=${totalRounds}
          playbackUrl=${localAudio.playbackUrl}
          playbackType=${localAudio.playbackType}
          startAt=${clipDuration}
          onContinue=${advance}
        />
        ${showLeave && html`
          <${LeaveModal}
            onCancel=${() => setShowLeave(false)}
            onLeave=${resetToLobby}
          />
        `}
      </div>
    `
  }

  return html`
    <div className="mp-dashboard">
      <div className="mp-top">
        <div className="mp-top__row">
          <${ModeToggle} value=${mode} onChange=${onModeChange} disabled />
          <button
            type="button"
            className="settings-gear"
            onClick=${() => setShowSettings(true)}
            aria-label="Settings"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 13a7.8 7.8 0 0 0 .1-2l2-1.5-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3h-6l-.4 2.1a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0 .1 2l-2 1.5 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1L9 21h6l.4-2.1a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4z" />
            </svg>
          </button>
          <button
            type="button"
            className="mp-exit-btn"
            onClick=${() => setShowLeave(true)}
          >
            EXIT GAME
          </button>
        </div>
        ${ticker && html`<p className="mp-ticker">📢 ${ticker}</p>`}
        <div className="mp-status">
          <div className="mp-status__left">
            <h2>LOBBY STANDINGS</h2>
            <span className="mp-chip">👤 ${players.length}/${players.length}</span>
            <span className="mp-chip mp-chip--battle">⚔ BATTLE ROUND ${round}/${totalRounds}</span>
          </div>
          <div className="mp-timer">
            <span>TIME REMAINING</span>
            <strong>${timer.formatted}</strong>
            <div className="mp-timer__watch" aria-hidden="true"></div>
          </div>
        </div>
      </div>

      <div className="mp-grid">
        <${LobbyStandings} players=${players} />
        <${BattleArena}
          roundOptions=${roundOptions}
          selectedAnswer=${selectedAnswer}
          isCorrectAnswer=${isCorrectAnswer}
          correctSongId=${game.currentSongId}
          onAnswer=${handleAnswer}
          clipDuration=${clipDuration}
          timerElapsed=${timer.elapsed}
          timerDuration=${timer.duration}
          phase=${phase}
          playbackUrl=${localAudio.playbackUrl}
          playbackType=${localAudio.playbackType}
          trackId=${game.currentSongId}
          audioLoading=${localAudio.loading}
          audioError=${localAudio.error}
        />
        <${BattleIntel}
          rank=${yourRank}
          total=${players.length}
          gap=${gap}
          score=${playerScore}
          streak=${playerStreak}
          avgSpeed=${avgSpeed}
          accuracy=${accuracy}
          correct=${playerCorrect}
          asked=${playerAsked}
          remaining=${Math.max(0, totalRounds - playerAsked)}
        />
      </div>

      ${showSettings && html`
        <${SettingsPanel}
          settings=${settings}
          onUpdate=${updateSettings}
          onClose=${() => setShowSettings(false)}
        />
      `}
      ${showLeave && html`
        <${LeaveModal}
          onCancel=${() => setShowLeave(false)}
          onLeave=${resetToLobby}
        />
      `}
    </div>
  `
}

// Confirmation modal for EXIT GAME. Never leaves instantly — the player must
// confirm. Cancel keeps them in the match; Leave Game safely exits the session.
function LeaveModal({ onCancel, onLeave }) {
  const [leaving, setLeaving] = useState(false)
  const [err, setErr] = useState(null)

  const handleLeave = async () => {
    if (leaving) return
    setLeaving(true)
    setErr(null)
    try {
      await onLeave()
      onCancel()
    } catch (e) {
      setErr((e && e.message) || 'Could not leave the game.')
      setLeaving(false)
    }
  }

  return html`
    <div className="leave-modal">
      <div className="leave-modal__card">
        <h2>LEAVE THIS GAME?</h2>
        <p>
          Leaving exits your multiplayer session and returns you to the lobby.
          The other player can keep playing.
        </p>
        ${err && html`<p className="auth-error">${err}</p>`}
        <div className="leave-modal__actions">
          <button
            type="button"
            className="auth-btn auth-btn--ghost"
            onClick=${onCancel}
            disabled=${leaving}
          >
            CANCEL
          </button>
          <button
            type="button"
            className="auth-btn leave-modal__confirm"
            onClick=${handleLeave}
            disabled=${leaving}
          >
            ${leaving ? 'LEAVING…' : 'LEAVE GAME'}
          </button>
        </div>
      </div>
    </div>
  `
}

const AI_LEVELS = [
  { key: 'easy', label: 'Easy', sub: 'Relaxed opponent · learns the ropes', pct: '~35% win rate for you' },
  { key: 'medium', label: 'Medium', sub: 'Balanced match · keeps you honest', pct: 'Even odds' },
  { key: 'hard', label: 'Hard', sub: 'Clutch player · near-perfect', pct: 'Beat it to brag' },
]

function MultiplayerMenu({ onFriends, onPractice }) {
  return html`
    <div className="mp-hub">
      <header className="mp-hub__header">
        <div className="mp-hub__kick">COMPETITIVE BATTLE ARENA</div>
        <h1 className="mp-hub__title">MULTIPLAYER</h1>
        <p className="mp-hub__sub">
          Battle head-to-head on the same rounds. Fastest ears win.
        </p>
      </header>

      <div className="mp-hub__grid">
        <button type="button" className="mp-card mp-card--friends" onClick=${onFriends}>
          <div className="mp-card__icon" aria-hidden="true">
            <span>VS</span>
          </div>
          <div className="mp-card__body">
            <h2 className="mp-card__title">PLAY WITH FRIENDS</h2>
            <p className="mp-card__desc">
              Create a private room and share the code, or jump into a Supabase lobby.
              Real-time standings, rounds, and final results.
            </p>
            <span className="mp-card__cta">CREATE / JOIN LOBBY →</span>
          </div>
        </button>

        <button type="button" className="mp-card mp-card--ai" onClick=${onPractice}>
          <div className="mp-card__icon" aria-hidden="true">
            <span>🤖</span>
          </div>
          <div className="mp-card__body">
            <h2 className="mp-card__title">PRACTICE VS AI</h2>
            <p className="mp-card__desc">
              Sharpen your ears against an adaptive bot. Pick an AI skill level, then
              pick a music difficulty, then run a full 10-round battle.
            </p>
            <span className="mp-card__cta">START PRACTICE →</span>
          </div>
        </button>
      </div>
    </div>
  `
}

function PracticeSetup({
  aiDifficulty,
  onAiDifficulty,
  musicDifficulty,
  onMusicDifficulty,
  starting,
  onBack,
  onStart,
}) {
  return html`
    <div className="mp-hub">
      <header className="mp-hub__header mp-hub__header--compact">
        <button type="button" className="mp-back" onClick=${onBack}>← BACK</button>
        <div className="mp-hub__kick">SOLO DRILLS</div>
        <h1 className="mp-hub__title">PRACTICE VS AI</h1>
      </header>

      <div className="mp-practice">
        <section className="mp-practice__block">
          <h3 className="mp-practice__label">AI SKILL</h3>
          <div className="mp-practice__levels" role="radiogroup" aria-label="AI skill level">
            ${AI_LEVELS.map(
              (lvl, index) => html`
                <button
                  key=${lvl.key}
                  type="button"
                  role="radio"
                  aria-checked=${aiDifficulty === index}
                  className=${`mp-practice__level${aiDifficulty === index ? ' is-on' : ''}`}
                  onClick=${() => onAiDifficulty(index)}
                >
                  <span className="mp-practice__level-name">${lvl.label}</span>
                  <span className="mp-practice__level-sub">${lvl.sub}</span>
                </button>
              `,
            )}
          </div>
        </section>

        <section className="mp-practice__block">
          <h3 className="mp-practice__label">MUSIC DIFFICULTY</h3>
          <${Difficulty} value=${musicDifficulty} onChange=${onMusicDifficulty} maxIndex=${2} />
        </section>

        <div className="mp-practice__actions">
          <button
            type="button"
            className="mp-practice__start"
            onClick=${onStart}
            disabled=${starting}
          >
            ${starting ? 'SPINNING UP ROUNDS…' : 'START PRACTICE →'}
          </button>
        </div>
      </div>
    </div>
  `
}
