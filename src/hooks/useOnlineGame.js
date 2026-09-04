// Online synchronized gameplay hook.
//
// Drives a Supabase-backed match so every player shares the same song, round
// number, and a 10-second timer derived from authoritative server timestamps
// (game_sessions.round_started_at / round_end_at), while each player's locked
// answer, score, and streak remain independent (session_players). Round state,
// scores, and results are fanned out over Realtime.
import { useState, useCallback, useEffect, useMemo, useRef } from 'https://esm.sh/react@19'
import { setActivePool, pickRoundTracks } from '../data/tracks.js'
import { submitAnswer, fetchAnswers } from '../supabase/db.js'

const ROUND_DURATION = 10
const REVEAL_SECONDS = 5

export default function useOnlineGame({
  session,           // game_sessions row (authoritative round + timings)
  rounds,            // session_rounds rows
  roundPlayers,      // session_players rows (live per-player score/streak)
  user,              // current Supabase user
  onAdvance,         // host advances to next round (RPC)
  onResults,         // called when match is finished
  poolFilters,       // { genre, era, difficulty } used to rebuild the shared pool
}) {
  const userId = user?.id

  const poolLoadedRef = useRef(false)
  const [poolRevision, setPoolRevision] = useState(0)
  const [poolError, setPoolError] = useState(null)
  const roundTracks = useMemo(() => (rounds || []).map((round) => round.track).filter(Boolean), [rounds])
  useEffect(() => {
    poolLoadedRef.current = false
  }, [session?.id])
  useEffect(() => {
    if (!session?.id || poolLoadedRef.current || !roundTracks.length) return
    setPoolError(null)
    let alive = true
    Promise.resolve(roundTracks).then((tracks) => {
      if (!alive) return
      if (tracks.length !== (rounds || []).length) {
        setPoolError('The match could not load all selected tracks.')
        poolLoadedRef.current = true
        return
      }
      setActivePool(tracks)
      setPoolRevision((revision) => revision + 1)
      poolLoadedRef.current = true
    }).catch(() => {
      if (alive) {
        poolLoadedRef.current = true
        setPoolError('The match could not load its selected tracks.')
      }
    })
    return () => {
      alive = false
    }
  }, [session?.id, roundTracks, rounds])

  const [remaining, setRemaining] = useState(ROUND_DURATION)
  const [selectedAnswer, setSelectedAnswer] = useState(null)
  const [revealed, setRevealed] = useState(false)
  const [showReveal, setShowReveal] = useState(false)
  const [answersMap, setAnswersMap] = useState({})
  const submittedRef = useRef(false)
  const revealTimerRef = useRef(null)

  const currentRound = session?.current_round || 0
  const status = session?.status || 'live'
  const roundEndAt = session?.round_end_at ? new Date(session.round_end_at).getTime() : null

  const roundRow = useMemo(
    () => (rounds || []).find((r) => r.round_number === currentRound) || null,
    [rounds, currentRound],
  )
  const song = useMemo(
    () => (roundRow ? roundRow.track : null),
    [roundRow, poolRevision],
  )
  const me = useMemo(
    () => (roundPlayers || []).find((p) => p.user_id === userId) || null,
    [roundPlayers, userId],
  )

  // Authoritative countdown to round_end_at
  useEffect(() => {
    if (!roundEndAt || status !== 'live') return
    const tick = () => {
      const secs = Math.max(0, Math.ceil((roundEndAt - Date.now()) / 1000))
      setRemaining(secs)
      if (secs <= 0) {
        setRevealed(true)
        setShowReveal(true)
      }
    }
    tick()
    const iv = setInterval(tick, 250)
    return () => clearInterval(iv)
  }, [roundEndAt, status, currentRound])

  // Reset per-round local state whenever the round changes
  useEffect(() => {
    submittedRef.current = false
    setSelectedAnswer(null)
    setRevealed(false)
    setShowReveal(false)
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current)
  }, [currentRound])

  // Auto-advance reveal after REVEAL_SECONDS. The RPC is idempotent for the
  // current round, so every client can recover if the host tab is backgrounded.
  useEffect(() => {
    if (showReveal && revealed) {
      revealTimerRef.current = setTimeout(() => {
        if (onAdvance && status === 'live') onAdvance()
      }, REVEAL_SECONDS * 1000)
      return () => clearTimeout(revealTimerRef.current)
    }
  }, [showReveal, revealed, status, onAdvance])

  // Grab existing answers for the current round (realtime-synced)
  useEffect(() => {
    if (!session?.id || !currentRound || !userId) return
    let alive = true
    fetchAnswers(session.id, currentRound).then((rows) => {
      if (!alive) return
      const map = {}
      rows.forEach((r) => {
        map[r.user_id] = { answer_id: r.answer_id, is_correct: r.is_correct, points: r.points }
      })
      setAnswersMap(map)
    })
    return () => {
      alive = false
    }
  }, [session?.id, currentRound, userId])

  const lockAnswer = useCallback(
    async (optionId) => {
      if (submittedRef.current || revealed || !session?.id || !song || status !== 'live') return
      const correct = optionId === song.id
      const timeLeft = remaining
      const base = (song.difficulty + 1) * 50
      const speedBonus = Math.round((timeLeft / ROUND_DURATION) * 50)
      const points = correct ? base + speedBonus : 0

      submittedRef.current = true
      setSelectedAnswer(optionId)
      try {
        await submitAnswer(session.id, currentRound, optionId, correct, points)
      } catch { /* keep local locked state even if push fails */ }
    },
    [session?.id, currentRound, song, revealed, remaining, status],
  )

  const myAnswer = answersMap[userId] || null
  const isCorrect = myAnswer ? myAnswer.is_correct : (selectedAnswer ? selectedAnswer === song?.id : null)
  const options = useMemo(
    () => (song ? pickRoundTracks(song, 4) : []),
    [song, poolRevision],
  )
  const userGuess = useMemo(() => {
    const answerId = myAnswer?.answer_id || selectedAnswer
    const answer = options.find((option) => option.id === answerId)
    return answer ? `${answer.artist} - ${answer.title}` : ''
  }, [myAnswer?.answer_id, selectedAnswer, options])

  return {
    currentRound,
    totalRounds: (rounds || []).length,
    song,
    options,
    poolLoading: Boolean(session?.id && roundTracks.length > 0 && !poolLoadedRef.current && !poolError),
    poolError,
    remaining,
    formatted: `00:${String(remaining).padStart(2, '0')}`,
    phase: status === 'live' ? (showReveal ? 'reveal' : 'playing') : (status === 'finished' ? 'gameover' : 'playing'),
    selectedAnswer,
    userGuess,
    isCorrect,
    answered: submittedRef.current || Boolean(myAnswer),
    me,
    players: roundPlayers || [],
    lockAnswer,
    showReveal,
  }
}
