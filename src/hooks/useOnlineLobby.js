// Supabase-backed lobby + match session lifecycle.
//
// Mirrors the local useFriendLobby surface (code, ready, start) so the same
// FriendLobby UI is reused, but state is authoritative in Supabase and fanned
// out to every client via Realtime. Requires an authenticated Supabase session.
import { useState, useCallback, useEffect, useMemo, useRef } from 'https://esm.sh/react@19'
import { isSupabaseConfigured } from '../supabase/client.js'
import {
  createLobby,
  joinLobby,
  setReady,
  leaveLobby,
  fetchLobbyMembers,
  fetchLobby,
  startMatch,
  advanceRound,
  fetchActiveSession,
  fetchRounds,
  fetchSessionPlayers,
  fetchResults,
  fetchLeaderboard,
} from '../supabase/db.js'
import { subscribeLobby, subscribeSession } from '../supabase/realtime.js'
import { pickWeightedTracks, resetSessionTrackHistory, setActivePool } from '../data/tracks.js'
import { fetchTracks, eraToYears } from '../spotify/client.js'

const ROUND_DURATION = 10

export default function useOnlineLobby({ user, profile, poolFilters }) {
  const displayName = useMemo(
    () => profile?.display_name || user?.user_metadata?.display_name || 'Player',
    [profile, user],
  )
  const [code, setCode] = useState(null)
  const [lobby, setLobby] = useState(null)
  const [members, setMembers] = useState([])
  const [myReady, setMyReady] = useState(false)
  const [session, setSession] = useState(null)
  const [rounds, setRounds] = useState([])
  const [roundPlayers, setRoundPlayers] = useState([])
  const [results, setResults] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [gameOver, setGameOver] = useState(false)
  const [error, setError] = useState(null)
  const [phase, setPhase] = useState('idle') // idle | lobby | live | results
  const [lobbyId, setLobbyId] = useState(null)
  const lobbyIdRef = useRef(null)
  const sessionIdRef = useRef(null)
  const lobbyUnsubRef = useRef(null)
  const sessionUnsubRef = useRef(null)
  const startInFlightRef = useRef(false)

  const userId = user?.id

  // Pull authoritative match state (rounds, live player stats, persisted
  // results). When results exist the match is over and we surface them.
  const refreshState = useCallback(async () => {
    if (!sessionIdRef.current) return
    const [rs, sp, res] = await Promise.all([
      fetchRounds(sessionIdRef.current),
      fetchSessionPlayers(sessionIdRef.current),
      fetchResults(sessionIdRef.current),
    ])
    setRounds(rs)
    setRoundPlayers(sp)
    if (res.length) {
      setResults(res)
      setPhase('results')
      setGameOver(true)
    }
  }, [])

  const stopSub = useCallback(() => {
    if (lobbyUnsubRef.current) lobbyUnsubRef.current()
    if (sessionUnsubRef.current) sessionUnsubRef.current()
    lobbyUnsubRef.current = null
    sessionUnsubRef.current = null
  }, [])

  const subscribeSessionUpdates = useCallback(async (sessionId) => {
    if (!sessionId || sessionUnsubRef.current) return
    const unsub = await subscribeSession(sessionId, (payload) => {
      if (payload.table === 'game_sessions') {
        setSession((prev) => ({ ...prev, ...payload.new }))
        if (payload.new?.status === 'finished') {
          setGameOver(true)
          refreshState()
        }
      }
      if (payload.table === 'session_players' || payload.table === 'session_rounds') refreshState()
      if (payload.table === 'match_results') refreshState()
    })
    sessionUnsubRef.current = unsub
  }, [refreshState])

  const refresh = useCallback(async () => {
    if (!lobbyIdRef.current) return
    const [mems, lob] = await Promise.all([
      fetchLobbyMembers(lobbyIdRef.current),
      fetchLobby(lobbyIdRef.current),
    ])
    setMembers(mems)
    setLobby(lob)
    const me = mems.find((m) => m.user_id === userId)
    if (me) setMyReady(me.ready)
    if (lob && lob.status !== 'lobby' && !sessionIdRef.current) {
      const s = await fetchActiveSession(lob.id)
      if (s) {
        sessionIdRef.current = s.id
        setSession(s)
        setPhase('live')
        await subscribeSessionUpdates(s.id)
      }
    }
    // Once we know about a session, also reflect authoritative match state so a
    // lobby-only client (e.g. the guest) transitions to results the moment the
    // match is finalized (including when the match ends with one player left).
    if (sessionIdRef.current) {
      await refreshState()
    }
  }, [userId, refreshState, subscribeSessionUpdates])

  // Subscribe to realtime lobby + members
  useEffect(() => {
    if (!lobbyId || !userId) return
    ;(async () => {
      stopSub()
      const unsub = await subscribeLobby(lobbyId, () => refresh())
      lobbyUnsubRef.current = unsub
    })()
    return () => stopSub()
  }, [lobbyId, userId, refresh, stopSub])

  // Realtime is the primary synchronization path; polling recovers from a
  // dropped event or a temporarily unavailable realtime connection.
  useEffect(() => {
    if (!lobbyId || !userId || phase !== 'lobby') return
    const interval = setInterval(() => {
      refresh().catch((e) => {
        console.error('Unable to refresh multiplayer lobby', e)
        setError(e?.message || 'Unable to refresh multiplayer lobby.')
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [lobbyId, userId, phase, refresh])

  const createRoom = useCallback(async () => {
    setError(null)
    try {
      const lob = await createLobby(displayName)
      lobbyIdRef.current = lob.id
      setLobbyId(lob.id)
      setLobby(lob)
      setCode(lob.code)
      setPhase('lobby')
      await refresh()
      return lob
    } catch (e) {
      setError(e.message)
      throw e
    }
  }, [displayName, refresh])

  const joinRoom = useCallback(async (joinCode) => {
    setError(null)
    try {
      const lob = await joinLobby(joinCode, displayName)
      lobbyIdRef.current = lob.id
      setLobbyId(lob.id)
      setLobby(lob)
      setCode(lob.code)
      setPhase('lobby')
      await refresh()
      return lob
    } catch (e) {
      setError(e.message)
      throw e
    }
  }, [displayName, refresh])

  const toggleReady = useCallback(async () => {
    if (!lobbyIdRef.current) return
    const next = !myReady
    setMyReady(next)
    try {
      await setReady(lobbyIdRef.current, next)
    } catch (e) {
      setError(e.message)
      setMyReady(!next)
    }
  }, [myReady])

  // Start the match with the authoritative song order
  const start = useCallback(async () => {
    const currentLobbyId = lobbyIdRef.current
    if (!currentLobbyId || startInFlightRef.current) return
    setError(null)
    startInFlightRef.current = true

    try {
      const latestMembers = await fetchLobbyMembers(currentLobbyId)
      const latestLobby = await fetchLobby(currentLobbyId)
      const currentMember = latestMembers.find((member) => member.user_id === userId)
      if (!currentMember?.host || latestLobby?.status !== 'lobby') throw new Error('Only the lobby host can start a lobby match.')
      if (latestMembers.length < 2) throw new Error('At least two players must join before starting.')
      if (latestMembers.some((member) => !member.ready)) throw new Error('Every player must be READY before starting.')

      resetSessionTrackHistory()

      // Build a randomized Spotify pool (genre / era / difficulty aligned) so
      // every client in the match resolves the host's exact song ids.
      const { genre, era, difficulty } = poolFilters || {}
      const { yearFrom, yearTo } = eraToYears(era)
      const tracks = await fetchTracks({ genre, yearFrom, yearTo, difficulty, limit: 50, offset: 0 })
      const pool = Array.isArray(tracks) ? tracks : []
      if (pool.length < 10) throw new Error('Spotify returned fewer than 10 tracks for this match.')
      setActivePool(pool)
      const songOrder = pickWeightedTracks(pool, 10)
      if (songOrder.length !== 10 || new Set(songOrder).size !== 10) throw new Error('Could not build a unique 10-song match sequence.')
      const sid = await startMatch(lobbyIdRef.current, songOrder, ROUND_DURATION)
      sessionIdRef.current = sid
      const s = await fetchActiveSession(lobbyIdRef.current)
      if (!s) throw new Error('Match started but its session could not be loaded.')
      setSession(s)
      setPhase('live')
      await subscribeSessionUpdates(sid)
      await refreshState()
    } catch (e) {
      console.error('Unable to start multiplayer match', e)
      setError(e?.message || 'Unable to start multiplayer match.')
    } finally {
      startInFlightRef.current = false
    }
  }, [userId, refreshState, subscribeSessionUpdates, poolFilters])

  const advance = useCallback(async () => {
    if (!sessionIdRef.current) return
    const currentMembers = await fetchLobbyMembers(lobbyIdRef.current)
    if (!currentMembers.some((member) => member.user_id === userId && member.host)) return
    await advanceRound(sessionIdRef.current, ROUND_DURATION)
    await refreshState()
  }, [userId, refreshState])

  // Safe exit: remove membership on the server, tear down realtime, and reset
  // all local state so the user lands back on the fresh online lobby screen.
  // The other player can keep playing — only this player's lobby membership and
  // session stats are removed.
  const leave = useCallback(async () => {
    const lid = lobbyIdRef.current
    stopSub()
    const reset = () => {
      lobbyIdRef.current = null
      sessionIdRef.current = null
      setLobbyId(null)
      setCode(null)
      setLobby(null)
      setMembers([])
      setMyReady(false)
      setSession(null)
      setRounds([])
      setRoundPlayers([])
      setResults([])
      setGameOver(false)
      setError(null)
      setPhase('idle')
    }
    // Even if the server call fails, still leave the local screen cleanly.
    if (lid) {
      try {
        await leaveLobby(lid)
      } catch {
        /* keep going: tear down local state regardless */
      }
    }
    reset()
  }, [stopSub])

  const hostMember = useMemo(
    () => members.find((member) => member.host || member.user_id === lobby?.host_id) || null,
    [members, lobby?.host_id],
  )

  const guest = useMemo(() => {
    const member = members.find((item) => item.user_id !== hostMember?.user_id)
    if (!member) return null
    return {
      id: member.user_id,
      name: member.display_name,
      ready: member.ready,
      you: false,
      isYou: member.user_id === userId,
    }
  }, [members, hostMember?.user_id, userId])

  const host = useMemo(
    () => ({
      id: hostMember?.user_id || userId || 'host',
      name: hostMember?.display_name || displayName,
      ready: hostMember?.ready || false,
      you: hostMember?.user_id === userId,
      isYou: hostMember?.user_id === userId,
      guestJoined: members.length > 1,
    }),
    [hostMember, userId, displayName, members.length],
  )

  // Poll leaderboard on results
  useEffect(() => {
    if (!gameOver) return
    fetchLeaderboard().then(setLeaderboard).catch(() => {})
  }, [gameOver])

  return {
    // Parking lot of online state for the dashboard
    phase,
    code,
    inviteLink: code ? `${window.location.origin}${window.location.pathname}?room=${code}` : null,
    lobby,
    members,
    session,
    rounds,
    roundPlayers,
    results,
    leaderboard,
    gameOver,
    error,
    // Mirrors useFriendLobby API used by FriendLobby
    host,
    guest,
    copied: false,
    bothReady: members.length >= 2 && members.every((m) => m.ready),
    started: phase !== 'lobby' && phase !== 'idle',
    hostReady: myReady,
    inviteFriend: createRoom,
    toggleHostReady: toggleReady,
    copyLink: null,
    startMatch: start,
    joinRoom,
    refresh,
    advance,
    leave,
  }
}
