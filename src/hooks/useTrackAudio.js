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
  tokenExpiresAt: 0,
  tokenSession: null,
  tokenRequest: null,
  tokenFailure: null,
  rejectedToken: null,
  eligibility: null,
  eligibilityRequest: null,
  initializationError: null,
  generation: 0,
  playRequest: null,
  pauseRequest: null,
  retryAt: 0,
  classicDevice: null,
  connectionReady: false,
  isPlaying: false,
  trackId: null,
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
  playback.generation += 1
  playback.readyReject?.(new Error('Spotify connection cancelled.'))
  if (playback.player) {
    try { await playback.player.disconnect() } catch {}
  }
  playback.player = null
  playback.token = null
  playback.tokenExpiresAt = 0
  playback.tokenSession = null
  playback.tokenRequest = null
  playback.tokenFailure = null
  playback.rejectedToken = null
  playback.eligibility = null
  playback.eligibilityRequest = null
  playback.initializationError = null
  playback.playRequest = null
  playback.pauseRequest = null
  playback.retryAt = 0
  playback.classicDevice = null
  playback.connectionReady = false
  playback.isPlaying = false
  playback.deviceId = null
  playback.initializing = null
  publishPlayback({ status: 'idle', error: null })
}

function playbackSnapshot() {
  return { status: playback.status, deviceId: playback.deviceId, error: playback.error, connectionReady: playback.connectionReady, trackId: playback.trackId }
}

function publishPlayback(next) {
  Object.assign(playback, next)
  const snapshot = playbackSnapshot()
  playbackListeners.forEach((listener) => listener(snapshot))
}

async function fetchPlaybackToken(rejectedToken = playback.rejectedToken) {
  const headers = spotifySessionHeaders()
  const session = headers['X-Musync-Spotify-Session'] || ''
  if (playback.tokenSession === session && playback.token && playback.token !== rejectedToken && playback.tokenExpiresAt > Date.now() + 30000) return playback.token
  if (playback.tokenFailure?.session === session && playback.tokenFailure.until > Date.now()) throw playback.tokenFailure.error
  const pending = playback.tokenRequest
  if (pending?.session === session) {
    const token = await pending.promise
    return token === rejectedToken ? fetchPlaybackToken(rejectedToken) : token
  }
  const generation = playback.generation
  const promise = (async () => {
    const response = await fetch('/api/spotify/playback-token', {
      headers: { ...headers, ...(rejectedToken ? { Authorization: `Bearer ${rejectedToken}` } : {}) },
      signal: AbortSignal.timeout(15000),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.accessToken) {
      const error = new Error(data.error || 'Spotify login is required for playback.')
      error.code = data.code || (response.status === 401 ? 'SPOTIFY_LOGIN_REQUIRED' : 'SPOTIFY_PLAYBACK_AUTH_ERROR')
      error.status = response.status
      error.retryAfterMs = (Number(response.headers.get('retry-after')) || Number(data.retryAfter) || 0) * 1000
      throw error
    }
    if (generation !== playback.generation) throw new Error('Spotify connection cancelled.')
    playback.token = data.accessToken
    playback.tokenExpiresAt = Number(data.expiresAt) || 0
    playback.tokenSession = session
    playback.tokenFailure = null
    playback.rejectedToken = null
    return playback.token
  })().catch((error) => {
    if (generation === playback.generation) playback.tokenFailure = { session, error, until: Date.now() + Math.max(2000, error.retryAfterMs || 0) }
    throw error
  }).finally(() => {
    if (playback.tokenRequest?.promise === promise) playback.tokenRequest = null
  })
  playback.tokenRequest = { session, promise }
  return promise
}

async function fetchPlaybackEligibility() {
  const headers = spotifySessionHeaders()
  const session = headers['X-Musync-Spotify-Session'] || ''
  if (playback.eligibility?.session === session && playback.eligibility.expiresAt > Date.now()) return playback.eligibility.data
  if (playback.eligibilityRequest?.session === session) return playback.eligibilityRequest.promise
  const generation = playback.generation
  const promise = (async () => {
    const response = await fetch('/api/spotify/eligibility', { headers, signal: AbortSignal.timeout(15000) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.authenticated) {
      const error = new Error(data.error || 'Spotify login is required for playback.')
      error.code = data.code || (response.status === 401 ? 'SPOTIFY_LOGIN_REQUIRED' : 'SPOTIFY_PLAYBACK_AUTH_ERROR')
      error.status = response.status
      error.retryAfterMs = (Number(response.headers.get('retry-after')) || Number(data.retryAfter) || 0) * 1000
      throw error
    }
    if (!data.premium) {
      const error = new Error('Spotify Premium is required to play Musync.')
      error.code = 'SPOTIFY_PREMIUM_REQUIRED'
      throw error
    }
    if (generation !== playback.generation) throw new Error('Spotify connection cancelled.')
    playback.eligibility = { session, data, expiresAt: Date.now() + 60000 }
    return data
  })().finally(() => {
    if (playback.eligibilityRequest?.promise === promise) playback.eligibilityRequest = null
  })
  playback.eligibilityRequest = { session, promise }
  return promise
}

function loadSpotifySdk() {
  if (window.Spotify?.Player) return Promise.resolve()
  if (playback.sdkLoading) return playback.sdkLoading
  playback.sdkLoading = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Spotify Web Playback SDK timed out.')), 10000)
    const previousReady = window.onSpotifyWebPlaybackSDKReady
    window.onSpotifyWebPlaybackSDKReady = () => {
      clearTimeout(timeout)
      if (typeof previousReady === 'function') previousReady()
      resolve()
    }
    const script = document.createElement('script')
    script.src = SPOTIFY_SDK_URL
    script.async = true
    script.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('Spotify Web Playback SDK could not load.'))
    }
    document.head.appendChild(script)
  }).finally(() => { playback.sdkLoading = null })
  return playback.sdkLoading
}

async function initializeSpotifyPlayer() {
  if (playback.initializing) return playback.initializing
  if (playback.player && playback.deviceId && playback.connectionReady) return playback.player
  if (playback.initializationError?.until > Date.now()) throw playback.initializationError.error
  const generation = playback.generation
  playback.initializing = (async () => {
    if (playback.player) {
      try { playback.player.disconnect() } catch {}
      playback.player = null
      playback.deviceId = null
      playback.connectionReady = false
      playback.classicDevice = null
      playback.isPlaying = false
    }
    publishPlayback({ status: 'connecting', error: null })
    let player = null
    let sdkToken = null
    let readyTimeout = null
    const ready = new Promise((resolve, reject) => {
      playback.readyResolve = resolve
      playback.readyReject = reject
    })
    // SDK errors may arrive while connect() is still pending.
    ready.catch(() => {})
    try {
      await fetchPlaybackEligibility()
      await Promise.all([fetchPlaybackToken(), loadSpotifySdk()])
      if (generation !== playback.generation) throw new Error('Spotify connection cancelled.')
      player = new window.Spotify.Player({
        name: SPOTIFY_PLAYER_NAME,
        getOAuthToken: async (callback) => {
          try {
            sdkToken = await fetchPlaybackToken()
            if (generation === playback.generation) callback(sdkToken)
          } catch { callback('') }
        },
        volume: getAudioVolume(),
      })
      const listen = (event, listener) => player.addListener(event, (payload) => {
        if (generation === playback.generation && playback.player === player) listener(payload)
      })
      listen('ready', ({ device_id: deviceId }) => {
        playback.deviceId = deviceId
        publishPlayback({ status: 'ready', deviceId, connectionReady: true, error: null })
        if (playback.readyResolve) playback.readyResolve(deviceId)
      })
      listen('not_ready', ({ device_id: deviceId }) => {
        if (playback.deviceId === deviceId) {
          playback.deviceId = null
          playback.classicDevice = null
          publishPlayback({ status: 'not-ready', deviceId: null, connectionReady: false })
        }
      })
      listen('initialization_error', ({ message }) => {
        playback.connectionReady = false
        const error = new Error(`Spotify player initialization failed: ${message}`)
        publishPlayback({ status: 'error', error: error.message })
        if (playback.readyReject) playback.readyReject(error)
      })
      listen('authentication_error', ({ message }) => {
        playback.connectionReady = false
        playback.rejectedToken = sdkToken || playback.token
        if (playback.token === playback.rejectedToken) playback.tokenExpiresAt = 0
        playback.eligibility = null
        const error = new Error(`Spotify authentication failed: ${message}`)
        publishPlayback({ status: 'error', error: error.message })
        if (playback.readyReject) playback.readyReject(error)
      })
      listen('account_error', () => {
        playback.connectionReady = false
        playback.eligibility = null
        const error = new Error('Spotify playback requires an eligible Premium account.')
        publishPlayback({ status: 'error', error: error.message })
        if (playback.readyReject) playback.readyReject(error)
      })
      listen('playback_error', ({ message }) => publishPlayback({ status: 'error', error: `Spotify playback failed: ${message}` }))
      listen('autoplay_failed', () => publishPlayback({ status: 'autoplay-blocked', isPlaying: false, error: 'Tap Play to enable audio in this browser.' }))
      listen('player_state_changed', (state) => {
        if (state) publishPlayback({ status: state.paused ? 'paused' : 'playing', isPlaying: !state.paused, trackId: state.track_window?.current_track?.id || null })
      })
      playback.player = player
      await Promise.race([
        (async () => {
          if (!await player.connect()) throw new Error('Spotify player could not connect.')
          await ready
        })(),
        new Promise((_, reject) => {
          readyTimeout = setTimeout(() => reject(new Error('Musync Spotify device was not ready.')), 10000)
        }),
      ])
      if (generation !== playback.generation) throw new Error('Spotify connection cancelled.')
      await applySpotifyVolume()
      playback.initializationError = null
      return player
    } catch (error) {
      if (player) {
        try { player.disconnect() } catch {}
      }
      if (generation !== playback.generation) throw error
      playback.player = null
      playback.deviceId = null
      playback.connectionReady = false
      playback.initializationError = error.status === 429 || error.code === 'SPOTIFY_QUOTA_EXCEEDED'
        ? { error, until: Date.now() + Math.max(1000, error.retryAfterMs || (error.code === 'SPOTIFY_QUOTA_EXCEEDED' ? 300000 : 1000)) }
        : null
      publishPlayback({
        status: error.code === 'SPOTIFY_LOGIN_REQUIRED' ? 'login-required' : error.code === 'SPOTIFY_PREMIUM_REQUIRED' ? 'premium-required' : 'error',
        error: error.message,
      })
      throw error
    } finally {
      clearTimeout(readyTimeout)
      if (generation === playback.generation) {
        playback.readyResolve = null
        playback.readyReject = null
        playback.initializing = null
      }
    }
  })()
  return playback.initializing
}

async function spotifyPlaybackRequest(path, options = {}) {
  if (playback.retryAt > Date.now()) {
    const error = new Error('Spotify is rate limited. Please wait before retrying playback.')
    error.status = 429
    throw error
  }
  const makeRequest = (token) => fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    signal: AbortSignal.timeout(15000),
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  const token = await fetchPlaybackToken()
  let response = await makeRequest(token)
  if (response.status === 401) response = await makeRequest(await fetchPlaybackToken(token))
  if (response.status === 429) playback.retryAt = Date.now() + Math.max(1000, (Number(response.headers.get('retry-after')) || 1) * 1000)
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    const quotaExceeded = String(detail?.error?.reason || '').toUpperCase() === 'QUOTA_EXCEEDED'
    const error = new Error(quotaExceeded
      ? 'Spotify quota is temporarily exceeded. Please wait before retrying playback.'
      : response.status === 403
      ? 'Spotify playback requires an eligible Premium account.'
      : `Spotify playback request failed (${response.status}).`)
    error.status = response.status
    if (quotaExceeded) {
      error.code = 'SPOTIFY_QUOTA_EXCEEDED'
      playback.retryAt = Date.now() + 300000
    }
    if (response.status === 401) {
      playback.rejectedToken = playback.token
      playback.tokenExpiresAt = 0
      playback.eligibility = null
      error.code = 'SPOTIFY_LOGIN_REQUIRED'
    }
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

  const playTrack = useCallback((trackId, { classic = false, positionMs = 0 } = {}) => {
    if (!trackId) return Promise.resolve(false)
    const key = `${classic}:${trackId}:${positionMs}`
    if (playback.playRequest?.key === key && (!playback.pauseRequest || playback.playRequest.afterPause === playback.pauseRequest)) return playback.playRequest.promise
    const pendingPlay = playback.playRequest?.promise
    const pendingPause = playback.pauseRequest
    const generation = playback.generation
    const promise = (async () => {
    let stopWaiting = () => {}
    try {
      if (pendingPlay) await pendingPlay
      if (pendingPause) await pendingPause
      if (generation !== playback.generation) return false
      await initializeSpotifyPlayer()
      await applySpotifyVolume()
      if (generation !== playback.generation) return false
      if (!playback.deviceId) throw new Error('Musync Spotify device is not ready yet.')
      if (!classic || playback.classicDevice !== playback.deviceId) await spotifyPlaybackRequest('/me/player', {
        method: 'PUT',
        body: JSON.stringify({ device_ids: [playback.deviceId], play: false }),
      })
      // A 204 acknowledges a command; it does not mean audio has started.
      // Start Classic's short clip timer only after the SDK confirms playback.
      const audible = classic ? new Promise((resolve, reject) => {
        const listener = (state) => {
          if (state.status === 'playing' && state.trackId === trackId) resolve()
          if (['error', 'autoplay-blocked', 'login-required', 'idle'].includes(state.status)) reject(new Error(state.error || 'Spotify playback stopped.'))
        }
        const timeout = setTimeout(() => reject(new Error('Spotify did not start audio. Tap Play to retry.')), 10000)
        playbackListeners.add(listener)
        stopWaiting = () => { clearTimeout(timeout); playbackListeners.delete(listener) }
      }) : Promise.resolve()
      audible.catch(() => {})
      await spotifyPlaybackRequest(`/me/player/play?device_id=${encodeURIComponent(playback.deviceId)}`, {
        method: 'PUT',
        body: JSON.stringify({ uris: [`spotify:track:${trackId}`], position_ms: Math.max(0, Math.round(positionMs)) }),
      })
      await audible
      if (generation !== playback.generation) return false
      if (playback.status === 'autoplay-blocked') return false
      playback.classicDevice = classic ? playback.deviceId : null
      publishPlayback({ status: 'playing', isPlaying: true, error: null })
      return true
    } catch (error) {
      if (generation !== playback.generation) return false
      playback.classicDevice = null
      publishPlayback({ status: error.code === 'SPOTIFY_LOGIN_REQUIRED' ? 'login-required' : playback.status === 'autoplay-blocked' ? 'autoplay-blocked' : 'error', error: error.message })
      return false
    } finally {
      stopWaiting()
    }
    })().finally(() => {
      if (playback.playRequest?.promise === promise) playback.playRequest = null
    })
    playback.playRequest = { key, promise, afterPause: pendingPause }
    return promise
  }, [])

  const ensureReady = useCallback(() => initializeSpotifyPlayer(), [])

  const activateElement = useCallback(() => {
    if (playback.player && typeof playback.player.activateElement === 'function') {
      playback.player.activateElement()?.catch?.(() => {})
      if (playback.status === 'autoplay-blocked') publishPlayback({ status: 'ready', error: null })
    }
  }, [])

  const pause = useCallback(() => {
    if (playback.pauseRequest) return playback.pauseRequest
    const pendingPlay = playback.playRequest?.promise
    const generation = playback.generation
    const promise = (async () => {
      if (pendingPlay) await pendingPlay
      if (generation !== playback.generation || !playback.deviceId || !playback.isPlaying) return
      try {
        await spotifyPlaybackRequest('/me/player/pause', { method: 'PUT' })
        if (generation === playback.generation) publishPlayback({ status: 'paused', isPlaying: false })
      } catch {}
    })().finally(() => {
      if (playback.pauseRequest === promise) playback.pauseRequest = null
    })
    playback.pauseRequest = promise
    return promise
  }, [])

  return { ...snapshot, ready: Boolean(snapshot.connectionReady && snapshot.deviceId), playTrack, ensureReady, activateElement, pause }
}
