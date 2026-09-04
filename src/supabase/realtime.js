// Realtime synchronization helper.
//
// Subscribes to postgres_changes on the tables that drive lobby + game state so
// all clients converge on the same: lobby status, members/ready, the current
// round, authoritative round timing, and live per-player scores. The host still
// acts authoritatively (RPCs); Realtime fans state out to every member.
import { ensureSupabase } from './client.js'

const TABLE_WHITELIST = [
  'lobbies',
  'lobby_members',
  'game_sessions',
  'session_rounds',
  'session_players',
  'player_answers',
  'match_results',
]

function filterForTable(t) {
  return TABLE_WHITELIST.includes(t)
}

export async function subscribeLobby(lobbyId, onChange) {
  const sb = await ensureSupabase()
  const forward = (payload) => onChange(payload)
  const channel = sb
    .channel(`lobby-${lobbyId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'lobbies', filter: `id=eq.${lobbyId}` },
      forward,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'lobby_members', filter: `lobby_id=eq.${lobbyId}` },
      forward,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'game_sessions', filter: `lobby_id=eq.${lobbyId}` },
      forward,
    )
    .subscribe()
  return () => {
    sb.removeChannel(channel)
  }
}

export async function subscribeSession(sessionId, onChange) {
  const sb = await ensureSupabase()
  const forward = (payload) => onChange(payload)
  const channel = sb
    .channel(`session-${sessionId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'game_sessions', filter: `id=eq.${sessionId}` },
      forward,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'session_rounds', filter: `session_id=eq.${sessionId}` },
      forward,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'session_players', filter: `session_id=eq.${sessionId}` },
      forward,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'player_answers', filter: `session_id=eq.${sessionId}` },
      forward,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'match_results', filter: `session_id=eq.${sessionId}` },
      forward,
    )
    .subscribe()
  return () => {
    sb.removeChannel(channel)
  }
}
