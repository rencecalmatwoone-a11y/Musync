import { useEffect, useRef, useState, useCallback } from 'https://esm.sh/react@19'

export default function useRoundTimer(duration = 30) {
  const [remaining, setRemaining] = useState(duration)
  const [expired, setExpired] = useState(false)
  const intervalRef = useRef(null)

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const start = useCallback(
    (initial) => {
      clearTimer()
      const startVal = initial ?? duration
      setRemaining(startVal)
      setExpired(false)
      intervalRef.current = setInterval(() => {
        setRemaining((prev) => {
          if (prev <= 1) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
            setExpired(true)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    },
    [duration, clearTimer],
  )

  const reset = useCallback(
    (initial) => {
      clearTimer()
      setExpired(false)
      setRemaining(initial ?? duration)
    },
    [duration, clearTimer],
  )

  useEffect(() => {
    return () => clearTimer()
  }, [clearTimer])

  const formatted = `00:${String(remaining).padStart(2, '0')}`

  return { remaining, formatted, expired, start, reset, clearTimer }
}
