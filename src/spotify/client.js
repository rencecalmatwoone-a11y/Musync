import { isSpotifyConfigured, isSpotifyAuthed } from './config.js'
import { selectGameTrack } from '../data/tracks.js'
import { getPopularFallbackTracks } from '../data/popularTracks.js'

export { isSpotifyConfigured, isSpotifyAuthed }

const REQUEST_TIMEOUT_MS = 80000
const TRACK_CACHE_TTL_MS = 5 * 60 * 1000
const TRACK_ERROR_TTL_MS = 60 * 1000
const trackCache = new Map()
const trackErrorCache = new Map()
const trackRequests = new Map()
const catalogCache = new Map()
const catalogErrorCache = new Map()
const catalogRequests = new Map()
const authStatusCache = new Map()
const authStatusRequests = new Map()
const vsPreviewCache = new Map()
const vsPreviewRequests = new Map()
const TAB_SESSION_KEY = 'musync-spotify-tab-session'
let returnedFromSpotify = false

function getTabSessionId() {
  try {
    let id = sessionStorage.getItem(TAB_SESSION_KEY)
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem(TAB_SESSION_KEY, id)
    }
    const params = new URLSearchParams(window.location.search)
    const returnedSession = params.get('spotify_session')
    if (returnedSession) {
      sessionStorage.setItem(TAB_SESSION_KEY, returnedSession)
      returnedFromSpotify = params.get('spotify') === 'auth'
      params.delete('spotify_session')
      const query = params.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
      id = returnedSession
    }
    return id
  } catch {
    return ''
  }
}

// Capture the callback session before any React effect cleans up the URL.
getTabSessionId()

export function hasSpotifyPlayIntent() {
  try { return returnedFromSpotify && localStorage.getItem('musync-spotify-play-intent') === '1' } catch { return false }
}

export function spotifySessionHeaders() {
  const id = getTabSessionId()
  return id ? { 'X-Musync-Spotify-Session': id } : {}
}

export function spotifyLoginUrl() {
  const id = getTabSessionId()
  return `/api/spotify/login?tab=${encodeURIComponent(id)}`
}

const requestCounters = new Map()
let dbgEnabled = true
try { dbgEnabled = localStorage.getItem('musync-spotify-debug') !== 'off' } catch {}

function trackLog(scope, source, label, extra = {}) {
  if (!dbgEnabled) return
  const key = `${scope}::${source}::${label}`
  requestCounters.set(key, (requestCounters.get(key) || 0) + 1)
  console.log(
    `[SpotifyInstrument] %c${label}%c source=${source} scope=${scope} at=${new Date().toLocaleTimeString()} count=${requestCounters.get(key)}`,
    'color:#facc15;font-weight:bold',
    'color:inherit',
    extra,
  )
}

const requestIdSeq = { n: 0 }
function nextRequestId() { requestIdSeq.n += 1; return `r${requestIdSeq.n}` }

function trackCacheKey({ genre = 'Any Genre', musicOrigin = 'Any', yearFrom, yearTo, difficulty = 0, limit = 50, offset = 0 } = {}) {
  return JSON.stringify({ genre, musicOrigin, yearFrom, yearTo, difficulty, limit, offset })
}

function attachSpotifyError(error, data, response) {
  error.status = Number(data?.status) || response?.status || null
  error.code = data?.code || error.code || null
  error.spotifyReason = data?.spotifyReason || null
  error.rateLimited = Boolean(data?.rateLimited || error.status === 429)
  error.quotaExceeded = Boolean(data?.quotaExceeded || data?.code === 'SPOTIFY_QUOTA_EXCEEDED')
  error.authenticationFailed = Boolean(data?.authenticationFailed || error.status === 401)
  error.retryAfter = Number(data?.retryAfter) || Number(response?.headers?.get('retry-after')) || 0
  return error
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      ...options,
      headers: { ...spotifySessionHeaders(), ...(options.headers || {}) },
      signal: controller.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const error = new Error(data.error || `Spotify request failed: ${res.status}`)
      throw attachSpotifyError(error, data, res)
    }
    return { res, data }
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Spotify request timed out. Please try again.')
      timeoutError.code = 'SPOTIFY_REQUEST_TIMEOUT'
      throw timeoutError
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function getSpotifyAuthStatus() {
  const headers = spotifySessionHeaders()
  const session = headers['X-Musync-Spotify-Session'] || ''
  const cached = authStatusCache.get(session)
  if (cached && cached.expiresAt > Date.now()) return cached.status
  if (authStatusRequests.has(session)) return authStatusRequests.get(session)
  const request = (async () => {
    try {
      const res = await fetch('/api/spotify/status', { headers, signal: AbortSignal.timeout(15000) })
      if (!res.ok) return { configured: isSpotifyConfigured, authed: isSpotifyAuthed }
      const status = await res.json()
      authStatusCache.set(session, { status, expiresAt: Date.now() + 30000 })
      return status
    } catch {
      return { configured: isSpotifyConfigured, authed: isSpotifyAuthed }
    }
  })().finally(() => {
    if (authStatusRequests.get(session) === request) authStatusRequests.delete(session)
  })
  authStatusRequests.set(session, request)
  return request
}

export function clearSpotifyClientSession() {
  returnedFromSpotify = false
  try {
    sessionStorage.removeItem(TAB_SESSION_KEY)
    localStorage.removeItem('musync-spotify-play-intent')
  } catch {}
  for (const cache of [authStatusCache, authStatusRequests, trackCache, trackErrorCache, trackRequests, catalogCache, catalogErrorCache, catalogRequests]) cache.clear()
}

export async function fetchTracks({
  genre = 'Any Genre',
  musicOrigin,
  yearFrom,
  yearTo,
  difficulty = 0,
  limit = 120,
  offset,
  source = 'unknown',
  reusePool = false,
  allowPartial = false,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  if (musicOrigin) musicOrigin = /^(opm|opm\s*\/\s*local)$/i.test(musicOrigin) ? 'OPM' : 'International'
  const requestedLimit = Math.min(Math.max(Number(limit) || 10, 1), 120)
  const effectiveOffset = Number.isFinite(offset) ? offset : 0
  const requestedOffset = Math.max(Math.floor(effectiveOffset / 10) * 10, 0)
  const cacheKey = JSON.stringify([getTabSessionId(), trackCacheKey({ genre, musicOrigin, yearFrom, yearTo, difficulty, limit: requestedLimit, offset: requestedOffset }), allowPartial, timeoutMs])
  const cached = trackCache.get(cacheKey)
  if (cached && (cached.expiresAt > Date.now() || (reusePool && cached.tracks.length))) {
    trackLog('fetchTracks', source, 'cache-hit', { query: { genre, yearFrom, yearTo, difficulty }, requestId: nextRequestId() })
    if (dbgEnabled) console.log(`[SpotifyInstrument]  -> served ${cached.tracks.length} tracks from cache`)
    return cached.tracks
  }
  const cachedError = trackErrorCache.get(cacheKey)
  if (cachedError && cachedError.expiresAt > Date.now()) {
    trackLog('fetchTracks', source, 'error-cache-hit', { code: cachedError.error?.code || cachedError.error?.status })
    throw cachedError.error
  }
  if (cachedError) trackErrorCache.delete(cacheKey)
  if (trackRequests.has(cacheKey)) {
    trackLog('fetchTracks', source, 'in-flight-dedup', { query: { genre, yearFrom, yearTo, difficulty } })
    return trackRequests.get(cacheKey)
  }
  const requestId = nextRequestId()
  trackLog('fetchTracks', source, 'request-start', { query: { genre, yearFrom, yearTo, difficulty }, requestId })

  const sp = new URLSearchParams()
  if (genre && genre !== 'Any Genre') sp.set('genre', genre)
  if (musicOrigin) sp.set('musicOrigin', musicOrigin)
  if (yearFrom) sp.set('yearFrom', String(yearFrom))
  if (yearTo) sp.set('yearTo', String(yearTo))
  sp.set('difficulty', String(difficulty))
  sp.set('limit', String(requestedLimit))
  sp.set('offset', String(requestedOffset))
  const request = (async () => {
   try {
    const tracks = []
    const seen = new Set()
    const pageSize = 10
    const maxPages = Math.ceil(requestedLimit / pageSize)
    for (let page = 0; page < maxPages; page += 1) {
      const pageParams = new URLSearchParams(sp)
      const remaining = requestedLimit - tracks.length
      pageParams.set('limit', String(Math.min(pageSize, remaining)))
      pageParams.set('offset', String(requestedOffset + page * pageSize))
      let result
      try {
        result = await fetchJson(`/api/spotify/tracks?${pageParams.toString()}`, { timeoutMs })
      } catch (error) {
        if (!allowPartial || !tracks.length) throw error
        break
      }
      const { res, data } = result
      console.log('[Track] response received')
      if (!res.ok) {
        const error = new Error(data.error || `Spotify request failed: ${res.status}`)
        error.code = data.code || data.error
        throw error
      }
      const pageTracks = Array.isArray(data.tracks) ? data.tracks : []
      for (const track of pageTracks) {
        if (track.id && track.title && track.artist && !seen.has(track.id)) {
          seen.add(track.id)
          tracks.push(track)
        }
      }
      console.log(`[Track] tracks normalized: ${tracks.length}`)
      if (tracks.length >= requestedLimit || pageTracks.length === 0) break
    }
    const usableTracks = tracks.slice(0, requestedLimit)
    trackCache.set(cacheKey, { tracks: usableTracks, expiresAt: Date.now() + TRACK_CACHE_TTL_MS })
    trackLog('fetchTracks', source, 'request-complete', { fetched: usableTracks.length, requestId })
    return usableTracks
  } catch (error) {
   trackErrorCache.set(cacheKey, { error, expiresAt: Date.now() + TRACK_ERROR_TTL_MS })
   trackLog('fetchTracks', source, 'request-error', { code: error?.code || error?.status || error?.message, requestId })
   throw error
  } finally {
    trackRequests.delete(cacheKey)
   }
  })()
  trackRequests.set(cacheKey, request)
  return request
}

export async function fetchTracksByIds(ids, { genre = 'Spotify', difficulty = 0, source = 'unknown' } = {}) {
  const cleanIds = Array.from(new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean)))
  if (!isSpotifyConfigured || !cleanIds.length) return []
  trackLog('fetchTracksByIds', source, 'request-start', { ids: cleanIds.length })
  const sp = new URLSearchParams()
  sp.set('ids', cleanIds.join(','))
  if (genre) sp.set('genre', genre)
  sp.set('difficulty', String(difficulty))
  try {
    const { res, data } = await fetchJson(`/api/spotify/tracks-by-id?${sp.toString()}`)
    if (!res.ok) {
      const error = new Error(data.error || `Spotify request failed: ${res.status}`)
      error.code = data.code || data.error
      throw error
    }
    const tracks = Array.isArray(data.tracks)
      ? data.tracks.filter((track) => track.id && track.title && track.artist)
      : []
    const byId = new Map(tracks.map((track) => [track.id, track]))
    trackLog('fetchTracksByIds', source, 'request-complete', { found: tracks.length, of: cleanIds.length })
    return cleanIds.map((id) => byId.get(id)).filter(Boolean)
  } catch (error) {
    trackLog('fetchTracksByIds', source, 'request-error', { code: error?.code || error?.status || error?.message })
    throw error
  }
}

export async function fetchRandomTrack({ genre, musicOrigin, yearFrom, yearTo, difficulty, recentIds = [] , source = 'unknown' } = {}) {
  const classic = source === 'classic'
  const tracks = await fetchTracks({ genre, musicOrigin, yearFrom, yearTo, difficulty, limit: classic ? 30 : 120, source, reusePool: classic, allowPartial: classic })
  return selectGameTrack(tracks, recentIds)
}

export async function resolveVSAudioPreview(track) {
  if (!track?.id || !track.title || !track.artist) return null
  const key = JSON.stringify([track.id, track.title, track.artist])
  const cached = vsPreviewCache.get(key)
  if (cached?.expiresAt > Date.now()) return cached.preview
  if (vsPreviewRequests.has(key)) return vsPreviewRequests.get(key)
  const params = new URLSearchParams({
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    durationMs: String(track.durationMs || 30000),
  })
  if (track.isrc) params.set('isrc', track.isrc)
  const request = (async () => {
  try {
    const response = await fetch(`/api/vs-audio-preview?${params}`, { signal: AbortSignal.timeout(7000) })
    const data = await response.json().catch(() => ({}))
    const preview = response.ok && data.preview?.provider === 'deezer' ? data.preview : null
    vsPreviewCache.set(key, { preview, expiresAt: Date.now() + (preview ? 5 * 60 * 1000 : 30000) })
    return preview
  } catch {
    return null
  } finally {
    vsPreviewRequests.delete(key)
  }
  })()
  vsPreviewRequests.set(key, request)
  return request
}

export async function fetchVSAudioTracks({ genre = 'Any Genre', yearFrom, yearTo, limit = 30 } = {}) {
  try {
    const params = new URLSearchParams({ genre, limit: String(limit) })
    const response = await fetch(`/api/vs-audio-tracks?${params}`, { signal: AbortSignal.timeout(7000) })
    const data = await response.json().catch(() => ({}))
    if (response.ok && Array.isArray(data.tracks) && data.tracks.length) return data.tracks
  } catch {
  }
  return getPopularFallbackTracks({ genre, yearFrom, yearTo, limit })
}

export async function searchCatalog(query, limit = 8, source = 'unknown') {
  if (!String(query || '').trim()) return []
  const cleanQuery = String(query).trim()
  const requestedLimit = Math.min(Math.max(Number(limit) || 8, 1), 10)
  const cacheKey = JSON.stringify({ session: getTabSessionId(), query: cleanQuery.toLowerCase(), limit: requestedLimit })
  const cached = catalogCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    trackLog('searchCatalog', source, 'cache-hit', { query: cleanQuery })
    return cached.tracks
  }
  if (catalogRequests.has(cacheKey)) {
    trackLog('searchCatalog', source, 'in-flight-dedup', { query: cleanQuery })
    return catalogRequests.get(cacheKey)
  }
  const cachedError = catalogErrorCache.get(cacheKey)
  if (cachedError && cachedError.expiresAt > Date.now()) {
    trackLog('searchCatalog', source, 'error-cache-hit', { code: cachedError.error?.code || cachedError.error?.status })
    throw cachedError.error
  }
  if (cachedError) catalogErrorCache.delete(cacheKey)
  trackLog('searchCatalog', source, 'request-start', { query: cleanQuery })
  const request = (async () => {
    const params = new URLSearchParams({ q: cleanQuery, limit: String(requestedLimit) })
    try {
      const { res, data } = await fetchJson(`/api/catalog/search?${params.toString()}`)
      if (!res.ok) {
        const error = new Error(data.error || `Spotify request failed: ${res.status}`)
        error.code = data.code || data.error
        throw error
      }
      const tracks = Array.isArray(data.tracks) ? data.tracks : []
      catalogCache.set(cacheKey, { tracks, expiresAt: Date.now() + TRACK_CACHE_TTL_MS })
      trackLog('searchCatalog', source, 'request-complete', { query: cleanQuery, found: tracks.length })
      return tracks
    } catch (error) {
      catalogErrorCache.set(cacheKey, { error, expiresAt: Date.now() + TRACK_ERROR_TTL_MS })
      trackLog('searchCatalog', source, 'request-error', { query: cleanQuery, code: error?.code || error?.status || error?.message })
      throw error
    } finally {
      catalogRequests.delete(cacheKey)
    }
  })()
  catalogRequests.set(cacheKey, request)
  return request
}

export function eraToYears(era) {
  if (!era || era === 'Any Era') return {}
  const m = String(era).match(/(\d{4})s/)
  if (!m) return {}
  const start = Number(m[1])
  return { yearFrom: start, yearTo: start + 9 }
}
