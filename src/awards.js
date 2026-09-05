export const AWARDS = Object.freeze([
  { id: 'first-guess', label: 'First Guess' },
  { id: 'quick-thinker', label: 'Quick Thinker' },
  { id: 'hot-streak', label: 'Hot Streak' },
  { id: 'perfect-streak', label: 'Perfect Streak' },
  { id: 'sharpshooter', label: 'Sharpshooter' },
  { id: 'song-master', label: 'Song Master' },
  { id: 'genre-expert', label: 'Genre Expert' },
  { id: 'artist-expert', label: 'Artist Expert' },
  { id: 'comeback-king', label: 'Comeback King' },
  { id: 'last-second-hero', label: 'Last-Second Hero' },
  { id: 'unstoppable', label: 'Unstoppable' },
  { id: 'rising-star', label: 'Rising Star' },
  { id: 'elite-listener', label: 'Elite Listener' },
  { id: 'musync-champion', label: 'Musync Champion' },
])

const AWARD_IDS = new Set(AWARDS.map((award) => award.id))
const QUICK_ANSWER_MS = 3000
const LAST_SECOND_WINDOW_MS = 2000

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function asNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function isCorrect(answer) {
  return answer?.isCorrect === true || answer?.is_correct === true || answer?.correct === true
}

function answerTimeMs(answer, match) {
  if (answer?.timeMs != null) return Math.max(0, asNumber(answer.timeMs))
  if (answer?.elapsedMs != null) return Math.max(0, asNumber(answer.elapsedMs))
  if (answer?.time_ms != null) return Math.max(0, asNumber(answer.time_ms))

  const startedAt = answer?.roundStartedAt || answer?.round_started_at || match?.roundStartedAt
  const answeredAt = answer?.answeredAt || answer?.answered_at || answer?.timestamp
  if (startedAt != null && answeredAt != null) {
    const elapsed = new Date(answeredAt).getTime() - new Date(startedAt).getTime()
    if (Number.isFinite(elapsed)) return Math.max(0, elapsed)
  }

  return null
}

function normalizeAnswers(match) {
  const answers = asArray(match?.answers || match?.playerAnswers || match?.player_answers)
  return answers.map((answer) => ({
    ...answer,
    correct: isCorrect(answer),
    timeMs: answerTimeMs(answer, match),
    genre: answer.genre || answer.trackGenre || answer.track_genre,
    artist: answer.artist || answer.trackArtist || answer.track_artist,
  }))
}

function longestCorrectStreak(answers) {
  let current = 0
  let longest = 0
  for (const answer of answers) {
    current = answer.correct ? current + 1 : 0
    longest = Math.max(longest, current)
  }
  return longest
}

function countBy(answers, key) {
  return answers.reduce((counts, answer) => {
    const value = String(answer[key] || '').trim().toLowerCase()
    if (value) counts.set(value, (counts.get(value) || 0) + (answer.correct ? 1 : 0))
    return counts
  }, new Map())
}

function hasWinningComeback(match, previousMatches) {
  if (match?.comeback === true || match?.isComeback === true) return true
  const standings = asArray(match?.standings || match?.finalStandings)
  const player = match?.player || match?.me
  if (standings.length && player) {
    const previousRank = asNumber(player.previousRank || player.previous_rank, 0)
    const finalRank = asNumber(player.rank || player.finalRank || player.final_rank, 0)
    if (previousRank > 1 && finalRank === 1) return true
  }
  const previousLoss = previousMatches.some((item) => item?.won === false || item?.result === 'loss')
  return previousLoss && (match?.won === true || match?.result === 'win')
}

function matchWon(match) {
  return match?.won === true || match?.result === 'win' || match?.isWinner === true || match?.is_winner === true
}

export function getNewAwardIds(match = {}, options = {}) {
  const answers = normalizeAnswers(match)
  const correctAnswers = answers.filter((answer) => answer.correct)
  const asked = answers.length || asNumber(match?.player?.asked || match?.asked)
  const correct = correctAnswers.length || asNumber(match?.player?.correct || match?.correct)
  const accuracy = asked ? (correct / asked) * 100 : asNumber(match?.player?.accuracy || match?.accuracy)
  const totalRounds = asNumber(match?.totalRounds || match?.total_rounds, asked)
  const wins = asNumber(options.totalWins, 0) + (matchWon(match) ? 1 : 0)
  const previousMatches = asArray(options.winHistory)
  const newlyEarned = []

  const award = (id, condition) => {
    if (condition) newlyEarned.push(id)
  }

  award('first-guess', correctAnswers.length > 0 && answers.findIndex((answer) => answer.correct) === 0)
  award('quick-thinker', correctAnswers.some((answer) => answer.timeMs != null && answer.timeMs <= QUICK_ANSWER_MS))
  award('hot-streak', longestCorrectStreak(answers) >= 3)
  award('perfect-streak', totalRounds >= 5 && longestCorrectStreak(answers) >= 5)
  award('sharpshooter', asked >= 10 && accuracy >= 90)
  award('song-master', correct >= 10)
  award('genre-expert', Math.max(...countBy(correctAnswers, 'genre').values(), 0) >= 5)
  award('artist-expert', Math.max(...countBy(correctAnswers, 'artist').values(), 0) >= 5)
  award('comeback-king', hasWinningComeback(match, previousMatches))
  award('last-second-hero', correctAnswers.some((answer) => answer.timeMs != null && answer.timeMs >= Math.max(0, asNumber(match?.roundDurationMs, 10000) - LAST_SECOND_WINDOW_MS)))
  award('unstoppable', previousMatches.slice(-3).every(matchWon) && previousMatches.length >= 3 && matchWon(match))
  award('rising-star', wins >= 1 && wins <= 3)
  award('elite-listener', asNumber(options.totalAsked, 0) >= 25 && asNumber(options.totalAsked, 0) > 0 && (asNumber(options.totalCorrect, 0) / options.totalAsked) * 100 >= 90)
  award('musync-champion', wins >= 10)

  const unlocked = new Set(asArray(options.unlockedAwardIds).filter((id) => AWARD_IDS.has(id)))
  return newlyEarned.filter((id, index) => !unlocked.has(id) && newlyEarned.indexOf(id) === index)
}

export default getNewAwardIds
