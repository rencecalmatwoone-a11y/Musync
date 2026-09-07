export const CLASSIC_STATS_KEY = 'musync-classic-stats-v1'

export function classicAvailablePoints(state, difficulty = 1) {
  return state.roundComplete ? 0 : (difficulty + 1) * 50 + state.streak * 10
}

export function createClassicStats() {
  return { round: 1, score: 0, streak: 0, bestStreak: 0, correct: 0, attempts: 0, roundsPlayed: 0, roundAttempts: 0, roundComplete: false, roundPoints: 0 }
}

export function restoreClassicStats(saved) {
  const initial = createClassicStats()
  if (!saved || typeof saved !== 'object') return initial
  for (const key of Object.keys(initial).filter((key) => !['roundComplete', 'roundPoints'].includes(key))) {
    if (!Number.isSafeInteger(saved[key]) || saved[key] < (key === 'round' ? 1 : 0)) return initial
  }
  if (saved.correct > saved.attempts || saved.streak > saved.bestStreak || saved.bestStreak > saved.correct) return initial
  // A reload loads a new song; a completed round resumes at the next number.
  return { ...initial, ...saved, round: saved.round + (saved.roundComplete ? 1 : 0), roundAttempts: 0, roundComplete: false, roundPoints: 0 }
}

export function classicStatsReducer(state, action) {
  if (action.type === 'advance') {
    return state.roundComplete ? { ...state, round: state.round + 1, roundAttempts: 0, roundComplete: false, roundPoints: 0 } : state
  }
  if (state.roundComplete) return state
  if (action.type === 'guess') {
    const streak = action.correct ? state.streak + 1 : 0
    const points = action.correct ? classicAvailablePoints(state, action.difficulty) : 0
    return {
      ...state,
      attempts: state.attempts + 1,
      roundAttempts: state.roundAttempts + 1,
      score: state.score + points,
      roundPoints: points,
      streak,
      bestStreak: Math.max(state.bestStreak, streak),
      correct: state.correct + Number(action.correct),
      roundsPlayed: state.roundsPlayed + Number(action.correct),
      roundComplete: action.correct,
    }
  }
  if (action.type === 'miss') {
    return {
      ...state,
      // An unanswered song counts as a miss; retries already count as attempts.
      attempts: state.attempts + (state.roundAttempts === 0 ? 1 : 0),
      streak: 0,
      roundsPlayed: state.roundsPlayed + 1,
      roundComplete: true,
      roundPoints: 0,
    }
  }
  return state
}
