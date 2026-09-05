import { ensureSupabase } from './client.js'


export async function createLobby(displayName) {
  const sb = await ensureSupabase()
  const { data, error } = await sb.rpc('create_lobby', {
    p_display_name: displayName || 'Player',
  })
  if (error) throw error
  return data
}

export async function joinLobby(code, displayName) {
  const sb = await ensureSupabase()
  const { data, error } = await sb.rpc('join_lobby', {
    p_code: String(code || '').trim().toUpperCase(),
    p_display_name: displayName || 'Player',
  })
  if (error) throw error
  return data
}

export async function setReady(lobbyId, ready) {
  const sb = await ensureSupabase()
  const { error } = await sb.rpc('set_ready', {
    p_lobby_id: lobbyId,
    p_ready: ready,
  })
  if (error) throw error
}

export async function leaveLobby(lobbyId) {
  const sb = await ensureSupabase()
  const { error } = await sb.rpc('leave_lobby', {
    p_lobby_id: lobbyId,
  })
  if (error) throw error
}

export async function fetchLobbyMembers(lobbyId) {
  const sb = await ensureSupabase()
  const { data, error } = await sb
    .from('lobby_members')
    .select('id, user_id, display_name, ready, host, joined_at')
    .eq('lobby_id', lobbyId)
  if (error) throw error
  return data || []
}

export async function fetchLobby(lobbyId) {
  const sb = await ensureSupabase()
  const { data, error } = await sb
    .from('lobbies')
    .select('id, code, host_id, status, created_at')
    .eq('id', lobbyId)
    .single()
  if (error) throw error
  return data
}


export async function startMatch(lobbyId, songOrder, roundDuration = 10) {
  const sb = await ensureSupabase()
  const { data, error } = await sb.rpc('start_match', {
    p_lobby_id: lobbyId,
    p_song_order: songOrder,
    p_round_duration: roundDuration,
  })
  if (error) throw error
  return data
}

export async function advanceRound(sessionId, roundDuration = 10) {
  const sb = await ensureSupabase()
  const { error } = await sb.rpc('advance_round', {
    p_session_id: sessionId,
    p_round_duration: roundDuration,
  })
  if (error) throw error
}

export async function fetchActiveSession(lobbyId) {
  const sb = await ensureSupabase()
  const { data, error } = await sb
    .from('game_sessions')
    .select('*')
    .eq('lobby_id', lobbyId)
    .single()
  if (error) return null
  return data
}

export async function fetchRounds(sessionId) {
  const sb = await ensureSupabase()
  const { data, error } = await sb
    .from('session_rounds')
    .select('*')
    .eq('session_id', sessionId)
    .order('round_number', { ascending: true })
  if (error) return []
  return data || []
}

export async function fetchSessionPlayers(sessionId) {
  const sb = await ensureSupabase()
  const { data, error } = await sb
    .from('session_players')
    .select('user_id, display_name, score, streak, correct, asked')
    .eq('session_id', sessionId)
    .order('score', { ascending: false })
  if (error) return []
  return data || []
}


export async function submitAnswer(sessionId, roundNumber, answerId, isCorrect, points) {
  const sb = await ensureSupabase()
  const { error } = await sb.rpc('submit_answer', {
    p_session_id: sessionId,
    p_round_number: roundNumber,
    p_answer_id: answerId,
    p_is_correct: isCorrect,
    p_points: points,
  })
  if (error) throw error
}

export async function fetchAnswers(sessionId, roundNumber) {
  const sb = await ensureSupabase()
  const { data, error } = await sb
    .from('player_answers')
    .select('id, user_id, answer_id, is_correct, points')
    .eq('session_id', sessionId)
    .eq('round_number', roundNumber)
  if (error) return []
  return data || []
}


export async function fetchResults(sessionId) {
  const sb = await ensureSupabase()
  const { data, error } = await sb
    .from('match_results')
    .select('*')
    .eq('session_id', sessionId)
    .order('rank', { ascending: true })
  if (error) return []
  return data || []
}

export async function fetchLeaderboard() {
  const sb = await ensureSupabase()
  const { data, error } = await sb
    .from('leaderboard')
    .select('*')
    .order('total_score', { ascending: false })
    .limit(50)
  if (error) return []
  return data || []
}
