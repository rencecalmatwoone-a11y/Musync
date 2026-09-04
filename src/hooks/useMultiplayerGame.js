import { useState, useCallback, useRef, useEffect, useMemo } from 'https://esm.sh/react@19'
import { getActivePool, getTrackById, pickRoundTracks, resetSessionTrackHistory, selectGameTrack, setActivePool, secureShuffle } from '../data/tracks.js'
import useRoundTimer from './useRoundTimer.js'
import { fetchTracks, eraToYears } from '../spotify/client.js'

const TOTAL_ROUNDS = 10
const ROUND_DURATION = 10
const CLIP_DURATION = 10
const REVEAL_DURATION = 5

const YOU_ID = 'you'

function calcPoints(difficulty, timeLeft, totalDuration) {
  const base = (difficulty + 1) * 50
  const speedBonus = Math.round((timeLeft / totalDuration) * 50)
  return base + speedBonus
}

// Every player (human + opponents) runs the same independent per-round
// lifecycle: same song, own 10s timer, one locked answer, own reveal, then the
// next round. Each player's actions only change their own score/streak/timer.
export default function useMultiplayerGame(displayName = 'Elite Listener') {
  const [round, setRound] = useState(0)
  const [phase, setPhase] = useState('lobby')
  const [gameOver, setGameOver] = useState(false)

  const [currentSongId, setCurrentSongId] = useState(null)
  const [roundOptions, setRoundOptions] = useState([])
  const songBagRef = useRef([])
  const recentSongsRef = useRef([])
  const roundFiltersRef = useRef({})
  const poolErrorRef = useRef(null)

  // Human player (you) — own independent state
  const [youState, setYouState] = useState({
    score: 0,
    streak: 0,
    correct: 0,
    asked: 0,
    totalSpeed: 0,
    selectedAnswerId: null,
    userGuess: '',
    locked: false,
    correctChoice: null,
    isCorrectAnswer: null,
    revealed: false,
  })

  const [feedback, setFeedback] = useState('')
  const [ticker, setTicker] = useState('')

  // Opponents — only invited friends who join the private lobby via the 6-char
  // code / invite link. No random/auto-matched players. Each runs the same
  // independent round lifecycle.
  const [bots, setBots] = useState(() =>
    [].filter(Boolean)
      .map((p) => ({
        ...p,
        you: false,
        score: 0,
        correct: 0,
        selectedAnswerId: null,
        userGuess: '',
        locked: false,
        correctChoice: null,
        isCorrectAnswer: null,
        revealed: false,
      })),
  )

  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('musync-settings')
      return saved ? JSON.parse(saved) : { sfx: true, volume: 80, reducedMotion: false, difficulty: 1 }
    } catch {
      return { sfx: true, volume: 80, reducedMotion: false, difficulty: 1 }
    }
  })

  const timer = useRoundTimer(ROUND_DURATION)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const botTimersRef = useRef([])
  const practiceBotRef = useRef(null)
  const youRef = useRef(youState)
  youRef.current = youState
  const botsRef = useRef(bots)
  botsRef.current = bots

  const correctSong = useMemo(
     () => (currentSongId ? getTrackById(currentSongId) : null),
    [currentSongId],
  )

  useEffect(() => {
    try {
      localStorage.setItem('musync-settings', JSON.stringify(settings))
    } catch { /* noop */ }
  }, [settings])

  const clearBotTimers = useCallback(() => {
    botTimersRef.current.forEach(clearTimeout)
    botTimersRef.current = []
  }, [])

  // Settle a bot's answer at its reveal time (timer = 0).
  const settleBot = useCallback((botId, songId, lockMs) => {
     const song = getTrackById(songId)
    if (!song) return

    setBots((prev) =>
      prev.map((b) => {
        if (b.id !== botId) return b
        if (b.selectedAnswerId) {
          // Bot already locked an answer — score it, reveal, keep locked.
          const correct = b.selectedAnswerId === songId
          const pts = correct
            ? calcPoints(song.difficulty, (ROUND_DURATION * 1000 - lockMs) / 1000, ROUND_DURATION)
            : 0
          return {
            ...b,
            score: b.score + pts,
            correct: b.correct + (correct ? 1 : 0),
            isCorrectAnswer: correct,
            revealed: true,
          }
        }
        // Bot never locked — it timed out / missed.
        return { ...b, isCorrectAnswer: false, revealed: true }
      }),
    )
  }, [])

  // Every bot follows the same lifecycle: lock an answer, then reveal at timer=0.
  const runBotRound = useCallback(
    (songId, roundDuration) => {
      clearBotTimers()
      const song = getTrackById(songId)
      if (!song) return

      const configuredBot = practiceBotRef.current
      const activeBots = botsRef.current.length ? botsRef.current : (configuredBot ? [configuredBot] : [])

      setBots((prev) => {
        const source = prev.length ? prev : (configuredBot ? [configuredBot] : [])
        return source.map((b) => {
          // Reset this round's per-player state, keep cumulative score/correct.
          const opts = pickRoundTracks(song, 4)
          const correctIdx = opts.findIndex((o) => o.id === songId)
          const lockMs = 2500 + Math.random() * 3000
          const willGuess = Math.random() < (b.skill ?? 0.65)
          const correctChoice =
            willGuess && correctIdx >= 0
              ? opts[correctIdx]
              : opts[(correctIdx + 1) % opts.length]
          return {
            ...b,
            selectedAnswerId: null,
            locked: false,
            correctChoice,
            isCorrectAnswer: null,
            revealed: false,
          }
        })
      })

      // Schedule each bot's independent lock + reveal.
      activeBots.forEach((b) => {
        const lockMs = 2500 + Math.random() * 3000
        const lockId = setTimeout(() => {
          setBots((p) =>
            p.map((x) =>
              x.id === b.id
                ? { ...x, selectedAnswerId: x.correctChoice ? x.correctChoice.id : null, locked: true }
                : x,
            ),
          )
        }, lockMs)
        const revealId = setTimeout(
          () => settleBot(b.id, songId, lockMs),
          roundDuration * 1000,
        )
        botTimersRef.current.push(lockId, revealId)
      })
    },
    [clearBotTimers, settleBot],
  )

  const startRound = useCallback(
    async (roundNum) => {
      const pool = getActivePool()
      if (!pool.length) {
        setFeedback('No playable Spotify tracks matched these filters.')
        setPhase('lobby')
        return
      }
      const available = pool.filter((item) => !recentSongsRef.current.includes(item.id))
      const song = selectGameTrack(available.length ? available : pool, recentSongsRef.current)
      if (!song) {
        setFeedback('No playable tracks matched these filters.')
        setPhase('lobby')
        return
      }
      recentSongsRef.current = [...recentSongsRef.current, song.id].slice(-15)
      setCurrentSongId(song.id)
      setRound(roundNum)
      setFeedback('')
      setTicker('')
      setPhase('playing')

        const options = pickRoundTracks(song, 4)
      setRoundOptions(options)

      // Reset human player's independent round state
      setYouState((s) => ({
        ...s,
        selectedAnswerId: null,
        locked: false,
        correctChoice: null,
        isCorrectAnswer: null,
        pendingPoints: 0,
        pendingTimeLeft: 0,
        revealed: false,
      }))

      timer.reset(ROUND_DURATION)
      timer.start(ROUND_DURATION)
      runBotRound(song.id, ROUND_DURATION)
    },
    [timer, runBotRound],
  )

  // Human player locks an answer (independent, locked, no reveal yet).
  const handleAnswer = useCallback(
    (optionId) => {
      const s = youRef.current
      if (s.locked || phaseRef.current !== 'playing' || !currentSongId) return

      const song = getTrackById(currentSongId)
      if (!song) return
      const correct = optionId === song.id
      const points = correct ? calcPoints(song.difficulty, timer.remaining, ROUND_DURATION) : 0

      setYouState((prev) => ({
        ...prev,
        selectedAnswerId: optionId,
        userGuess: `${song.artist} - ${song.title}`,
        locked: true,
        correctChoice: song,
        isCorrectAnswer: correct,
        pendingPoints: points,
        pendingTimeLeft: timer.remaining,
        // Score/streak/asked are applied at reveal time (their timer=0) so the
        // locked answer stays visible with no correct/wrong reveal yet.
      }))
      setFeedback('')
    },
    [currentSongId, timer.remaining],
  )

  // Settle the human player when the visible 10s timer reaches 0.
  const settleHuman = useCallback(() => {
    setYouState((prev) => {
      const asked = prev.asked + 1
      if (prev.selectedAnswerId) {
        const correct = prev.selectedAnswerId === currentSongId
        const song = getTrackById(currentSongId)
        const points = prev.pendingPoints || 0
        setFeedback(correct
          ? `Correct! +${points} pts`
          : `Missed! It was "${song.title}" by ${song.artist}`)
        if (correct) {
          setTicker(`${displayName} just guessed correctly! (+${points} pts)`)
        }
        return {
          ...prev,
          score: prev.score + points,
          streak: correct ? prev.streak + 1 : 0,
          correct: prev.correct + (correct ? 1 : 0),
          asked,
          totalSpeed: prev.totalSpeed + (correct ? ROUND_DURATION - prev.pendingTimeLeft : 0),
          revealed: true,
        }
      }
      // No answer selected — timeout / missed.
      setFeedback("Time's up! No guess submitted.")
      return {
        ...prev,
        asked,
        streak: 0,
        revealed: true,
      }
    })
  }, [currentSongId, displayName])

  const advance = useCallback(() => {
    if (round >= TOTAL_ROUNDS) {
      setGameOver(true)
      setPhase('gameover')
    } else {
      startRound(round + 1)
    }
  }, [round, startRound])

  useEffect(() => {
    if (phaseRef.current === 'playing' && timer.expired) {
      settleHuman()
      setPhase('reveal')
    }
  }, [timer.expired, settleHuman])

  // Auto-advance the reveal countdown before the next round.
  useEffect(() => {
    if (phase === 'reveal') {
      const id = setTimeout(() => advance(), REVEAL_DURATION * 1000)
      return () => clearTimeout(id)
    }
  }, [phase, round, youState.revealed])

  // Load a fresh Spotify pool (genre / era / difficulty aligned) and make it the
  // active pool for this game so every round and its distractors draw from the
  // same randomized pool.
  const loadGamePool = useCallback(async ({ genre, era, difficulty } = {}) => {
    roundFiltersRef.current = { genre, era, difficulty }
    poolErrorRef.current = null
    try {
      const { yearFrom, yearTo } = eraToYears(era)
      const tracks = await fetchTracks({ genre, yearFrom, yearTo, difficulty, limit: 50, offset: 0 })
      if (tracks && tracks.length > 0) {
        setActivePool(tracks)
        songBagRef.current = []
        recentSongsRef.current = []
        return tracks
      }
    } catch (error) {
      poolErrorRef.current = error?.message || 'Spotify is temporarily unavailable, please try again.'
      setFeedback(poolErrorRef.current)
      setActivePool([])
      return []
    }
    setActivePool([])
    return []
  }, [])

  const startGame = useCallback(
    async (opts) => {
      resetSessionTrackHistory()
      const pool = await loadGamePool(opts)
      if (!pool.length) {
        setFeedback(poolErrorRef.current || 'No playable Spotify tracks matched these filters.')
        setPhase('lobby')
        return
      }
      setGameOver(false)
      practiceBotRef.current = opts?.ai
        ? {
            id: 'ai-opponent',
            name: opts.ai.name || 'A.I.',
            skill: Number.isFinite(opts.ai.skill) ? opts.ai.skill : 0.65,
            you: false,
          }
        : null
      setRound(0)
      setYouState((s) => ({
        ...s,
        score: 0,
        streak: 0,
        correct: 0,
        asked: 0,
        totalSpeed: 0,
        selectedAnswerId: null,
        userGuess: '',
        locked: false,
        correctChoice: null,
        isCorrectAnswer: null,
        pendingPoints: 0,
        pendingTimeLeft: 0,
        revealed: false,
      }))
      setBots((prev) => {
        const source = opts?.ai && practiceBotRef.current ? [practiceBotRef.current] : prev
        return source.map((b) => ({
          ...b,
          score: 0,
          correct: 0,
          selectedAnswerId: null,
          locked: false,
          correctChoice: null,
          isCorrectAnswer: null,
          revealed: false,
        }))
      })
      setTicker('')
      startRound(1)
    },
    [startRound, loadGamePool],
  )

  // Exit back to the local Multiplayer lobby screen. Clears any running bot
  // timers, resets every player to a fresh lobby state, and returns to the
  // 'lobby' phase without touching the persistent settings.
  const resetToLobby = useCallback(() => {
    clearBotTimers()
    timer.clearTimer()
    setGameOver(false)
    setRound(0)
    setCurrentSongId(null)
    setRoundOptions([])
    setFeedback('')
    setTicker('')
    setYouState((s) => ({
      ...s,
      score: 0,
      streak: 0,
      correct: 0,
      asked: 0,
      totalSpeed: 0,
      selectedAnswerId: null,
      userGuess: '',
      locked: false,
      correctChoice: null,
      isCorrectAnswer: null,
      pendingPoints: 0,
      pendingTimeLeft: 0,
      revealed: false,
    }))
    setBots((prev) =>
      prev.map((b) => ({
        ...b,
        score: 0,
        correct: 0,
        selectedAnswerId: null,
        userGuess: '',
        locked: false,
        correctChoice: null,
        isCorrectAnswer: null,
        revealed: false,
      })),
    )
    setPhase('lobby')
  }, [clearBotTimers, timer])

  // Add a real friend who joined the private lobby to the independent roster.
  // Safe to call repeatedly; no-ops if the friend is already present.
  const addFriend = useCallback((friend) => {
    if (!friend) return
    setBots((prev) => {
      if (prev.some((b) => b.id === friend.id)) return prev
      return [
        {
          ...friend,
          you: false,
          score: 0,
          correct: 0,
          selectedAnswerId: null,
          locked: false,
          correctChoice: null,
          isCorrectAnswer: null,
          revealed: false,
        },
        ...prev,
      ]
    })
  }, [])

  const accuracy = useMemo(
    () => (youState.asked > 0 ? Math.round((youState.correct / youState.asked) * 100) : 0),
    [youState.correct, youState.asked],
  )

  const avgSpeed = useMemo(
    () => (youState.correct > 0 ? (youState.totalSpeed / youState.correct).toFixed(1) : '0.0'),
    [youState.totalSpeed, youState.correct],
  )

  const playerEntry = useMemo(
    () => ({
      id: YOU_ID,
      name: displayName,
      score: youState.score,
      streak: youState.streak,
      correct: youState.correct,
      asked: youState.asked,
      status: youState.revealed
        ? (youState.isCorrectAnswer ? 'guessed' : 'missed')
        : (youState.locked ? 'guessed' : 'thinking'),
      you: true,
      locked: youState.locked,
      revealed: youState.revealed,
      isCorrectAnswer: youState.isCorrectAnswer,
    }),
    [youState, displayName],
  )

  const allPlayers = useMemo(
    () => [playerEntry, ...bots.map((b) => ({
      ...b,
      streak: 0,
      asked: b.revealed ? 1 : 0,
      status: b.revealed ? (b.isCorrectAnswer ? 'guessed' : 'missed') : (b.locked ? 'guessed' : 'thinking'),
    }))],
    [playerEntry, bots],
  )

  const sortedPlayers = useMemo(() => {
    const ranked = [...allPlayers].sort((a, b) => b.score - a.score)
    return ranked.map((p, i) => ({ ...p, rank: i + 1 }))
  }, [allPlayers])

  const you = useMemo(() => sortedPlayers.find((p) => p.you), [sortedPlayers])
  const yourRank = you ? you.rank : sortedPlayers.length

  const updateSettings = useCallback((updates) => {
    setSettings((prev) => ({ ...prev, ...updates }))
  }, [])

  return {
    round,
    totalRounds: TOTAL_ROUNDS,
    phase,
    players: sortedPlayers,
    yourRank,
    you,
    currentSongId,
    correctSong,
    roundOptions,
    selectedAnswer: youState.selectedAnswerId,
    userGuess: youState.userGuess,
    isCorrectAnswer: youState.isCorrectAnswer,
    result: null,
    feedback,
    ticker,
    youState,
    playerScore: youState.score,
    playerStreak: youState.streak,
    playerCorrect: youState.correct,
    playerAsked: youState.asked,
    accuracy,
    avgSpeed,
    gameOver,
    settings,
    timer: {
      remaining: timer.remaining,
      formatted: timer.formatted,
      expired: timer.expired,
      duration: ROUND_DURATION,
      elapsed: ROUND_DURATION - timer.remaining,
    },
    clipDuration: CLIP_DURATION,
    startGame,
    handleAnswer,
    advance,
    addFriend,
    updateSettings,
    resetToLobby,
  }
}
