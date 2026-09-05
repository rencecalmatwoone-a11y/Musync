import { useState, useEffect, useCallback, useRef } from 'https://esm.sh/react@19'
import { getSupabase, isSupabaseConfigured } from '../supabase/client.js'
import { fetchLeaderboard } from '../supabase/db.js'

export default function useSupabaseAuth() {
  const [status, setStatus] = useState(isSupabaseConfigured ? 'loading' : 'disabled')
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [leaderboard, setLeaderboard] = useState([])
  const [error, setError] = useState(null)

  const refreshProfile = useCallback(async (uid) => {
    try {
      const sb = await getSupabase()
      const { data } = await sb
        .from('profiles')
        .select('id, display_name, avatar_url')
        .eq('id', uid)
        .maybeSingle()
      if (data) setProfile(data)
    } catch {}
  }, [])

  useEffect(() => {
    let alive = true
    let unsubscribe = null

    ;(async () => {
      if (!isSupabaseConfigured) {
        setStatus('disabled')
        return
      }
      try {
        const sb = await getSupabase()
        const { data } = await sb.auth.getSession()
        if (data?.session?.user && alive) {
          setUser(data.session.user)
          setStatus('authenticated')
          refreshProfile(data.session.user.id)
        } else if (alive) {
          setStatus('signed_out')
        }

        const lb = await fetchLeaderboard()
        if (alive) setLeaderboard(lb)

        const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
          if (!alive) return
          if (session?.user) {
            setUser(session.user)
            setStatus('authenticated')
            refreshProfile(session.user.id)
          } else {
            setUser(null)
            setProfile(null)
            setStatus('signed_out')
          }
        })
        unsubscribe = sub?.subscription
      } catch (e) {
        if (alive) setStatus('error')
      }
    })()

    return () => {
      alive = false
      if (unsubscribe) unsubscribe()
    }
  }, [refreshProfile])

  const signInAnonymously = useCallback(async () => {
    setError(null)
    try {
      const sb = await getSupabase()
      const { data, error } = await sb.auth.signInAnonymously()
      if (error) throw error
      setUser(data.user)
      setStatus('authenticated')
    } catch (e) {
      setError(e.message)
    }
  }, [])

  const signUp = useCallback(async (email, password, displayName) => {
    setError(null)
    try {
      const sb = await getSupabase()
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
      })
      if (error) throw error
      setUser(data.user)
      setStatus('authenticated')
    } catch (e) {
      setError(e.message)
    }
  }, [])

  const signInWithEmail = useCallback(async (email, password) => {
    setError(null)
    try {
      const sb = await getSupabase()
      const { data, error } = await sb.auth.signInWithPassword({ email, password })
      if (error) throw error
      setUser(data.user)
      setStatus('authenticated')
    } catch (e) {
      setError(e.message)
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      const sb = await getSupabase()
      await sb.auth.signOut()
    } catch {}
    setUser(null)
    setProfile(null)
    setStatus('signed_out')
  }, [])

  return {
    status,
    user,
    profile,
    leaderboard,
    error,
    signInAnonymously,
    signUp,
    signInWithEmail,
    signOut,
  }
}
