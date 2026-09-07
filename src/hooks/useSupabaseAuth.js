import { useState, useEffect, useCallback, useRef } from 'https://esm.sh/react@19'
import { getSupabase, isSupabaseConfigured } from '../supabase/client.js'
import { fetchLeaderboard } from '../supabase/db.js'

function authErrorMessage(error, action) {
  if (error?.code === 'over_email_send_rate_limit' || /email.*(?:rate )?limit.*exceeded/i.test(error?.message || '')) {
    if (action === 'reset') return 'Password-reset emails are temporarily limited. Please wait before requesting another link.'
    return 'Confirmation emails are temporarily limited. If your account is already confirmed, use Sign in. Otherwise, wait before trying Create account again.'
  }
  return error?.message || 'Authentication failed. Please try again.'
}

export default function useSupabaseAuth() {
  const [status, setStatus] = useState(isSupabaseConfigured ? 'loading' : 'disabled')
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [leaderboard, setLeaderboard] = useState([])
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [pending, setPending] = useState(false)
  const authRequestRef = useRef(false)
  const [recovering, setRecovering] = useState(() => new URLSearchParams(window.location.search).get('auth') === 'recovery' || new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery')
  const [passwordUpdated, setPasswordUpdated] = useState(false)

  const clearMessages = useCallback(() => { setError(null); setNotice(null) }, [])

  const closeRecovery = useCallback(() => {
    setRecovering(false)
    setPasswordUpdated(false)
    setError(null)
    setNotice(null)
    const url = new URL(window.location.href)
    if (url.searchParams.get('auth') === 'recovery') url.searchParams.delete('auth')
    const hash = new URLSearchParams(url.hash.slice(1))
    if (hash.has('error') || hash.get('type') === 'recovery') url.hash = ''
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

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
        if (!alive) return
        const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
          if (!alive) return
          if (event === 'PASSWORD_RECOVERY') {
            setRecovering(true)
            setPasswordUpdated(false)
            setError(null)
            setNotice(null)
          }
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
        const { data, error: sessionError } = await sb.auth.getSession()
        if (!alive) return
        if (sessionError) throw sessionError
        if (data?.session?.user) {
          setUser(data.session.user)
          setStatus('authenticated')
          refreshProfile(data.session.user.id)
        } else {
          setStatus('signed_out')
        }
        const lb = await fetchLeaderboard()
        if (alive) setLeaderboard(lb)
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
    if (authRequestRef.current) return
    authRequestRef.current = true
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      const sb = await getSupabase()
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
      })
      if (error) throw error
      if (data.session?.user) {
        setUser(data.session.user)
        setStatus('authenticated')
      } else {
        setNotice('Check your email to confirm your account, then sign in to continue.')
      }
    } catch (e) {
      setError(authErrorMessage(e))
    } finally {
      authRequestRef.current = false
      setPending(false)
    }
  }, [])

  const signInWithEmail = useCallback(async (email, password) => {
    if (authRequestRef.current) return
    authRequestRef.current = true
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      const sb = await getSupabase()
      const { data, error } = await sb.auth.signInWithPassword({ email, password })
      if (error) throw error
      if (!data.session?.user) throw new Error('Sign-in did not complete. Please try again.')
      setUser(data.session.user)
      setStatus('authenticated')
    } catch (e) {
      setError(authErrorMessage(e))
    } finally {
      authRequestRef.current = false
      setPending(false)
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

  const requestPasswordReset = useCallback(async (email) => {
    if (authRequestRef.current) return
    authRequestRef.current = true
    setPending(true)
    clearMessages()
    try {
      const sb = await getSupabase()
      const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/?auth=recovery`,
      })
      if (error) throw error
      setNotice('If an account exists for this email, you’ll receive a password-reset link. Check your inbox and spam folder.')
    } catch (error) {
      setError(authErrorMessage(error, 'reset'))
    } finally {
      authRequestRef.current = false
      setPending(false)
    }
  }, [clearMessages])

  const updatePassword = useCallback(async (password) => {
    if (authRequestRef.current) return
    clearMessages()
    if (!recovering || status !== 'authenticated' || !user) {
      setError('This reset link has expired or is invalid. Please request a new one.')
      return
    }
    authRequestRef.current = true
    setPending(true)
    try {
      const sb = await getSupabase()
      const { error } = await sb.auth.updateUser({ password })
      if (error) throw error
      setPasswordUpdated(true)
    } catch (error) {
      setError(authErrorMessage(error))
    } finally {
      authRequestRef.current = false
      setPending(false)
    }
  }, [clearMessages, recovering, status, user])

  return {
    status,
    user,
    profile,
    leaderboard,
    error,
    notice,
    pending,
    recovering,
    passwordUpdated,
    clearMessages,
    closeRecovery,
    requestPasswordReset,
    updatePassword,
    signInAnonymously,
    signUp,
    signInWithEmail,
    signOut,
  }
}
