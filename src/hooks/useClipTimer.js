import { useState, useRef, useEffect, useCallback } from 'https://esm.sh/react@19'

export default function useClipTimer(duration = 15) {
  const [playing, setPlaying] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const startedAt = useRef(null)
  const baseElapsed = useRef(0)
  const frameRef = useRef(0)

  const clearFrame = useCallback(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
  }, [])

  useEffect(() => {
    if (!playing) {
      clearFrame()
      return undefined
    }

    startedAt.current = performance.now()
    const tick = (now) => {
      const next = Math.min(duration, baseElapsed.current + (now - startedAt.current) / 1000)
      setElapsed(next)
      if (next >= duration) {
        setPlaying(false)
        baseElapsed.current = duration
        return
      }
      frameRef.current = requestAnimationFrame(tick)
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => clearFrame()
  }, [playing, duration, clearFrame])

  const toggle = useCallback(() => {
    if (playing) {
      baseElapsed.current = elapsed
      setPlaying(false)
    } else if (elapsed >= duration) {
      baseElapsed.current = 0
      setElapsed(0)
      setPlaying(true)
    } else {
      baseElapsed.current = elapsed
      setPlaying(true)
    }
  }, [playing, elapsed, duration])

  // Start a fresh clip from the beginning (reset timer to 0 and begin playing).
  const play = useCallback(() => {
    clearFrame()
    baseElapsed.current = 0
    setElapsed(0)
    setPlaying(true)
  }, [clearFrame])

  const reset = useCallback(() => {
    clearFrame()
    setPlaying(false)
    setElapsed(0)
    baseElapsed.current = 0
  }, [clearFrame])

  useEffect(() => {
    return () => clearFrame()
  }, [clearFrame])

  return { playing, elapsed, toggle, play, reset }
}
