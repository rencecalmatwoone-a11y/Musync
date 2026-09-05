import { useCallback, useEffect, useState } from 'https://esm.sh/react@19'
import { spotifySessionHeaders } from '../spotify/client.js'
import useAudioVolume, { getAudioVolume } from './useAudioSettings.js'

export default function useTrackAudio(songId, knownPlaybackUrl = null, knownPlaybackType = 'unavailable') {
  const [state, setState] = useState({
    playbackUrl: knownPlaybackUrl || null,
    playbackType: knownPlaybackType,
    loading: false,
    error: null,
  })

  useEffect(() => {
    setState({
      playbackUrl: knownPlaybackUrl || null,
      playbackType: knownPlaybackType,
      loading: false,
      error: null,
    })
  }, [songId, knownPlaybackUrl, knownPlaybackType])

  return state
}

const SPOTIFY_SDK_URL = 'https://sdk.scdn.co/spotify-player.js'
const SPOTIFY_PLAYER_NAME = 'Musync Web Player'
const playbackListeners = new Set()
const playback = {
  status: 'idle',
  deviceId: null,
  error: null,
  player: null,
  initializing: null,
  sdkLoading: null,
  token: null,
  readyResolve: null,
  readyReject: null,
}

async function applySpotifyVolume(value = getAudioVolume()) {
  if (!playback.player || typeof playback.player.setVolume !== 'function') return
  try {
    await playback.player.setVolume(value)
  } catch {
  }
}

export async function disconnectSpotifyPlayback() {
  if (playback.player) {
    try { await playback.player.disconnect() } catch {}
  }
  playback.player = null
  playback.token = null
  playback.deviceId = null
  playback.initializing = null
  publishPlayback({ status: 'idle', error: null })
}

function playbackSnapshot() {
  return { status: playback.status, deviceId: playback.deviceId, error: playback.error }
}

function publishPlayback(next) {
  Object.assign(playback, next)
  const snapshot = playbackSnapshot()
  playbackListeners.forEach((listener) => listener(snapshot))
}

async function fetchPlaybackToken() {
  const response = await fetch('/api/spotify/playback-token', { headers: spotifySessionHeaders() })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.accessToken) {
    const error = new Error(data.error || 'Spotify login is required for playback.')
    error.code = data.code || (response.status === 401 ? 'SPOTIFY_LOGIN_REQUIRED' : 'SPOTIFY_PLAYBACK_AUTH_ERROR')
    throw error
  }
  playback.token = data.accessToken
  return playback.token
}

async function fetchPlaybackEligibility() {
  const response = await fetch('/api/spotify/eligibility', { headers: spotifySessionHeaders() })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.authenticated) {
    const error = new Error(data.error || 'Spotify login is required for playback.')
    error.code = data.code || (response.status === 401 ? 'SPOTIFY_LOGIN_REQUIRED' : 'SPOTIFY_PLAYBACK_AUTH_ERROR')
    throw error
  }
  if (!data.premium) {
    const error = new Error('Spotify Premium is required to play Musync.')
    error.code = 'SPOTIFY_PREMIUM_REQUIRED'
    throw error
  }
  return data
}

function loadSpotifySdk() {
  if (window.Spotify?.Player) return Promise.resolve()
  if (playback.sdkLoading) return playback.sdkLoading
  playback.sdkLoading = new Promise((resolve, reject) => {
    const previousReady = window.onSpotifyWebPlaybackSDKReady
    window.onSpotifyWebPlaybackSDKReady = () => {
      if (typeof previousReady === 'function') previousReady()
      resolve()
    }
    const script = document.createElement('script')
    script.src = SPOTIFY_SDK_URL
    script.async = true
    script.onerror = () => reject(new Error('Spotify Web Playback SDK could not load.'))
    document.head.appendChild(script)
  }).finally(() => { playback.sdkLoading = null })
  return playback.sdkLoading
}

async function initializeSpotifyPlayer() {
  if (playback.player) return playback.player
  if (playback.initializing) return playback.initializing
  playback.initializing = (async () => {
    publishPlayback({ status: 'connecting', error: null })
    const ready = new Promise((resolve, reject) => {
      playback.readyResolve = resolve
      playback.readyReject = reject
    })
    try {
      await fetchPlaybackEligibility()
      await fetchPlaybackToken()
      await loadSpotifySdk()
      const player = new window.Spotify.Player({
        name: SPOTIFY_PLAYER_NAME,
        getOAuthToken: async (callback) => {
          try { callback(await fetchPlaybackToken()) } catch { callback('') }
        },
        volume: getAudioVolume(),
      })
      player.addListener('ready', ({ device_id: deviceId }) => {
        playback.deviceId = deviceId
        publishPlayback({ status: 'ready', deviceId, error: null })
        if (playback.readyResolve) playback.readyResolve(deviceId)
      })
      player.addListener('not_ready', ({ device_id: deviceId }) => {
        if (playback.deviceId === deviceId) {
          playback.deviceId = null
          publishPlayback({ status: 'not-ready', deviceId: null })
        }
      })
      player.addListener('initialization_error', ({ message }) => {
        const error = new Error(`Spotify player initialization failed: ${message}`)
        publishPlayback({ status: 'error', error: error.message })
        if (playback.readyReject) playback.readyReject(error)
      })
      player.addListener('authentication_error', ({ message }) => {
        const error = new Error(`Spotify authentication failed: ${message}`)
        publishPlayback({ status: 'error', error: error.message })
        if (playback.readyReject) playback.readyReject(error)
      })
      player.addListener('account_error', () => {
        const error = new Error('Spotify playback requires an eligible Premium account.')
        publishPlayback({ status: 'error', error: error.message })
        if (playback.readyReject) playback.readyReject(error)
      })
      player.addListener('playback_error', ({ message }) => publishPlayback({ status: 'error', error: `Spotify playback failed: ${message}` }))
      player.addListener('player_state_changed', () => playbackListeners.forEach((listener) => listener(playbackSnapshot())))
      if (!await player.connect()) throw new Error('Spotify player could not connect.')
      playback.player = player
      await Promise.race([
        ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Musync Spotify device was not ready.')), 10000)),
      ])
      await applySpotifyVolume()
      return player
    } catch (error) {
      publishPlayback({
        status: error.code === 'SPOTIFY_LOGIN_REQUIRED' ? 'login-required' : error.code === 'SPOTIFY_PREMIUM_REQUIRED' ? 'premium-required' : 'error',
        error: error.message,
      })
      throw error
    } finally {
      playback.initializing = null
    }
  })()
  return playback.initializing
}

async function spotifyPlaybackRequest(path, options = {}) {
  const makeRequest = (token) => fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  let response = await makeRequest(await fetchPlaybackToken())
  if (response.status === 401) response = await makeRequest(await fetchPlaybackToken())
  if (!response.ok) {
    const error = new Error(response.status === 403
      ? 'Spotify playback requires an eligible Premium account.'
      : `Spotify playback request failed (${response.status}).`)
    error.status = response.status
    throw error
  }
  return response
}

export function useSpotifyPlayback(enabled = true) {
  const [snapshot, setSnapshot] = useState(playbackSnapshot())
  const volume = useAudioVolume()

  useEffect(() => {
    playbackListeners.add(setSnapshot)
    setSnapshot(playbackSnapshot())
    if (enabled && !playback.player && !playback.initializing) initializeSpotifyPlayer().catch(() => {})
    return () => playbackListeners.delete(setSnapshot)
  }, [enabled])

  useEffect(() => {
    if (playback.player && typeof playback.player.setVolume === 'function') {
      playback.player.setVolume(volume).catch?.(() => {})
    }
  }, [volume])

  const playTrack = useCallback(async (trackId) => {
    if (!trackId) return false
    try {
      await initializeSpotifyPlayer()
      await applySpotifyVolume()
      if (!playback.deviceId) throw new Error('Musync Spotify device is not ready yet.')
      await spotifyPlaybackRequest('/me/player', {
        method: 'PUT',
        body: JSON.stringify({ device_ids: [playback.deviceId], play: false }),
      })
      await spotifyPlaybackRequest(`/me/player/play?device_id=${encodeURIComponent(playback.deviceId)}`, {
        method: 'PUT',
        body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
      })
      publishPlayback({ status: 'playing', error: null })
      return true
    } catch (error) {
      publishPlayback({ status: error.code === 'SPOTIFY_LOGIN_REQUIRED' ? 'login-required' : 'error', error: error.message })
      return false
    }
  }, [])

  const ensureReady = useCallback(() => initializeSpotifyPlayer(), [])

  const activateElement = useCallback(() => {
    if (playback.player && typeof playback.player.activateElement === 'function') {
      playback.player.activateElement()
    }
  }, [])

  const pause = useCallback(async () => {
    if (!playback.deviceId) return
    try { await spotifyPlaybackRequest('/me/player/pause', { method: 'PUT' }) } catch {}
    publishPlayback({ status: 'paused' })
  }, [])

  return { ...snapshot, ready: ['ready', 'playing', 'paused'].includes(snapshot.status), playTrack, ensureReady, activateElement, pause }
}
