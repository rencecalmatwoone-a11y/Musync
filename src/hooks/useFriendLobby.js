import { useState, useCallback, useMemo, useEffect, useRef } from 'https://esm.sh/react@19'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function makeCode(len = 6) {
  let out = ''
  for (let i = 0; i < len; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  }
  return out
}

const HOST = { id: 'host', name: 'Elite Listener', you: true }

// Local private-lobby state for the Friend Lobby / Invite system.
// There is no backend in this build, so the "friend" is simulated locally as a
// guest player that joins/readies via the same ready-gates the host uses. The
// room code + invite link are real and the shape of the state maps 1:1 to a
// future signaling/websocket backend.
export default function useFriendLobby(displayName = 'Elite Listener') {
  const [code] = useState(() => makeCode(6))
  const [guest, setGuest] = useState(null)
  const [hostReady, setHostReady] = useState(false)
  const [copied, setCopied] = useState(false)
  const [started, setStarted] = useState(false)
  const guestReadyTimerRef = useRef(null)

  const inviteLink = useMemo(() => {
    try {
      const base = window.location.origin + window.location.pathname
      return `${base}?room=${code}`
    } catch {
      return `musync://join?room=${code}`
    }
  }, [code])

  // Invite a friend. In this local build the guest joins immediately; a real
  // backend would resolve this via the room code/signaling.
  const inviteFriend = useCallback(() => {
    if (guest) return
    const friend = { id: 'guest', name: 'Friend', you: false }
    setGuest(friend)
    setCopied(false)
    // Simulate the friend joining then marking ready after a short delay.
    guestReadyTimerRef.current = setTimeout(() => {
      setGuest((g) => (g ? { ...g, ready: true } : g))
    }, 1400)
  }, [guest])

  const toggleHostReady = useCallback(() => {
    setHostReady((r) => !r)
  }, [])

  const copyLink = useCallback(() => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(inviteLink)
      } else {
        const ta = document.createElement('textarea')
        ta.value = inviteLink
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* noop */ }
  }, [inviteLink])

  const bothReady = useMemo(
    () => hostReady && Boolean(guest && guest.ready && !started),
    [hostReady, guest, started],
  )

  const startMatch = useCallback(() => {
    setStarted(true)
  }, [])

  useEffect(() => {
    return () => {
      if (guestReadyTimerRef.current) clearTimeout(guestReadyTimerRef.current)
    }
  }, [])

  return {
    code,
    inviteLink,
    host: { ...HOST, name: displayName, ready: hostReady, guestJoined: Boolean(guest) },
    guest,
    copied,
    bothReady,
    started,
    hostReady,
    inviteFriend,
    toggleHostReady,
    copyLink,
    startMatch,
  }
}
