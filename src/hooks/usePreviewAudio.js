import { useCallback, useEffect, useRef, useState } from 'https://esm.sh/react@19'

// Plays an officially supplied provider preview for a track. This is a thin wrapper
// around an <audio> element: pass the elements the rendered <audio> node via
// `audioRef` (or use the returned `audioEl` node directly), and pass `src`
// (the preview URL) plus a `playing` boolean to keep playback in sync with the
// rest of the clip timer. Falls back to silence when there is no preview URL.
export default function usePreviewAudio() {
  const audioRef = useRef(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)

  const resolveSrc = useCallback((src) => {
    if (!src) return ''
    try {
      return new URL(src, window.location.href).href
    } catch {
      return src
    }
  }, [])

  const attach = useCallback((node) => {
    if (audioRef.current && audioRef.current !== node) {
      if (audioRef.current._musyncCleanup) audioRef.current._musyncCleanup()
      audioRef.current.pause()
      audioRef.current.removeAttribute('src')
      audioRef.current.load()
    }
    audioRef.current = node
    if (node) {
      node.volume = 1
      node.loop = false
      node.preload = 'auto'

      const handleCanPlay = () => {
        setStatus((s) => (s === 'loading' ? 'ready' : s))
        setError(null)
      }
      const handleError = () => {
        setStatus('error')
        setError('Audio preview could not be played.')
        console.warn('[Audio] playback failed', { error: node.error?.message || 'media error' })
      }
      const handleEnded = () => setStatus('ended')
      node.addEventListener('canplay', handleCanPlay)
      node.addEventListener('error', handleError)
      node.addEventListener('ended', handleEnded)
      node._musyncCleanup = () => {
        node.removeEventListener('canplay', handleCanPlay)
        node.removeEventListener('error', handleError)
        node.removeEventListener('ended', handleEnded)
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      const el = audioRef.current
      if (el && el._musyncCleanup) el._musyncCleanup()
    }
  }, [])

  // Drive playback from a (src, playing) pair whenever they change.
  const sync = useCallback((src, playing) => {
    const el = audioRef.current
    if (!el) return
    const nextSrc = resolveSrc(src)
    if (playing && src) {
      console.log('[Audio] loading', { source: nextSrc })
      if ((el.currentSrc || el.src) !== nextSrc) {
        el.src = nextSrc
        setStatus('loading')
        el.load()
      }
      setError(null)
      el.play()
        .then(() => {
          console.log('[Audio] play started')
          setStatus('playing')
        })
        .catch((e) => {
          setStatus('blocked')
          setError(
            e && e.name === 'NotAllowedError'
              ? 'Tap Play to start audio.'
              : 'Audio preview could not be played.',
          )
        })
    } else {
      el.pause()
      if (!src) {
        setStatus('idle')
        setError(null)
      } else {
        setStatus('paused')
      }
    }
  }, [resolveSrc])

  const playFrom = useCallback((src, seconds = 0) => {
    const el = audioRef.current
    if (!el || !src) return Promise.resolve(false)
    const nextSrc = resolveSrc(src)
    if ((el.currentSrc || el.src) !== nextSrc) {
      el.src = nextSrc
      setStatus('loading')
      el.load()
    }
    try {
      el.currentTime = Math.max(0, Number(seconds) || 0)
    } catch {
      /* Some browsers reject seeks before metadata; playback can still start. */
    }
    setError(null)
    return el.play()
      .then(() => {
        console.log('[Audio] play started')
        setStatus('playing')
        return true
      })
      .catch((e) => {
        console.warn('[Audio] playback failed', { error: e?.name || 'unknown' })
        setStatus('blocked')
        setError(
          e && e.name === 'NotAllowedError'
            ? 'Tap Play to start audio.'
            : 'Audio preview could not be played.',
        )
        return false
      })
  }, [resolveSrc])

  const stop = useCallback(() => {
    const el = audioRef.current
    if (el) {
      el.pause()
      el.currentTime = 0
      el.removeAttribute('src')
      el.load()
    }
    setStatus('idle')
    setError(null)
  }, [])

  const pause = useCallback(() => {
    const el = audioRef.current
    if (el) el.pause()
    setStatus((value) => (value === 'idle' || value === 'error' ? value : 'paused'))
  }, [])

  const currentTime = useCallback(() => {
    const el = audioRef.current
    return el ? el.currentTime : 0
  }, [])

  const seek = useCallback((seconds) => {
    const el = audioRef.current
    if (el) {
      try {
        el.currentTime = Math.max(0, Number(seconds) || 0)
      } catch {
        /* Ignore seeks before media metadata is available. */
      }
    }
  }, [])

  return { attach, sync, playFrom, pause, stop, seek, currentTime, status, error }
}
