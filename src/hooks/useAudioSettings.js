import { useEffect, useState } from 'https://esm.sh/react@19'

const SETTINGS_KEY = 'musync-settings'
const VOLUME_EVENT = 'musync-volume-change'
const DEFAULT_VOLUME = 80

export function clampVolume(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_VOLUME
  return Math.max(0, Math.min(100, numeric))
}

export function getAudioVolume() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return clampVolume(saved.volume) / 100
  } catch {
    return DEFAULT_VOLUME / 100
  }
}

export function setAudioVolume(value) {
  const next = clampVolume(value)
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...saved, volume: next }))
    window.dispatchEvent(new CustomEvent(VOLUME_EVENT, { detail: next / 100 }))
  } catch {
  }
  return next
}

export default function useAudioVolume() {
  const [volume, setVolume] = useState(getAudioVolume)

  useEffect(() => {
    const update = (event) => {
      const next = event?.detail === undefined ? getAudioVolume() : Math.max(0, Math.min(1, Number(event.detail)))
      setVolume(next)
    }
    window.addEventListener(VOLUME_EVENT, update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener(VOLUME_EVENT, update)
      window.removeEventListener('storage', update)
    }
  }, [])

  return volume
}
