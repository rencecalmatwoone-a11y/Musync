import { useCallback, useEffect, useRef, useState } from 'https://esm.sh/react@19'
import useAudioVolume from './useAudioSettings.js'

export default function usePreviewAudio() {
  const audioRef = useRef(null)
  const volume = useAudioVolume()
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
      node.volume = volume
      node.loop = false
      node.preload = 'auto'
      let loadTimeout = null

      const handleCanPlay = () => {
        if (loadTimeout) clearTimeout(loadTimeout)
        setStatus((s) => (s === 'loading' ? 'ready' : s))
        setError(null)
      }
      const handleLoadedData = handleCanPlay
      const handlePlay = () => setStatus('playing')
      const handleError = () => {
        if (loadTimeout) clearTimeout(loadTimeout)
        setStatus('error')
        setError('Audio preview could not be played.')
        console.warn('[Audio] playback failed', { error: node.error?.message || 'media error' })
      }
      const handleEnded = () => setStatus('ended')
      node.addEventListener('canplay', handleCanPlay)
      node.addEventListener('loadeddata', handleLoadedData)
      node.addEventListener('play', handlePlay)
      node.addEventListener('error', handleError)
      node.addEventListener('ended', handleEnded)
      loadTimeout = setTimeout(() => {
        if (node.readyState < 2) {
          setStatus('error')
          setError('Audio preview timed out.')
        }
      }, 8000)
      node._musyncCleanup = () => {
        if (loadTimeout) clearTimeout(loadTimeout)
        node.removeEventListener('canplay', handleCanPlay)
        node.removeEventListener('loadeddata', handleLoadedData)
        node.removeEventListener('play', handlePlay)
        node.removeEventListener('error', handleError)
        node.removeEventListener('ended', handleEnded)
      }
    }
  }, [volume])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  useEffect(() => {
    return () => {
      const el = audioRef.current
      if (el && el._musyncCleanup) el._musyncCleanup()
    }
  }, [])

  const sync = useCallback((src, playing) => {
    const el = audioRef.current
    if (!el) return Promise.resolve(false)
    const nextSrc = resolveSrc(src)
    if (playing && src) {
      console.log('[Audio] loading', { source: nextSrc })
      if ((el.currentSrc || el.src) !== nextSrc) {
        el.src = nextSrc
        setStatus('loading')
        el.load()
      }
      setError(null)
      return el.play()
        .then(() => {
          console.log('[Audio] play started')
          setStatus('playing')
          return true
        })
        .catch((e) => {
          setStatus('blocked')
          setError(
            e && e.name === 'NotAllowedError'
              ? 'Tap Play to start audio.'
              : 'Audio preview could not be played.',
          )
          return false
        })
    } else {
      el.pause()
      if (!src) {
        setStatus('idle')
        setError(null)
      } else {
        setStatus('paused')
      }
      return Promise.resolve(true)
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
      }
    }
  }, [])

  return { attach, sync, playFrom, pause, stop, seek, currentTime, status, error }
}
