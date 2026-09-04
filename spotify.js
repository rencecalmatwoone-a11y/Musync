// Server-side Spotify integration. Spotify supplies catalog metadata and
// authenticated control for the browser Web Playback SDK.
import { Buffer } from 'node:buffer'

const ACCOUNTS_URL = 'https://accounts.spotify.com/api/token'
const API_URL = 'https://api.spotify.com/v1'
const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize'
const TOKEN_TTL_MS = 55 * 60 * 1000
const AUDIO_CACHE_TTL_MS = 5 * 60 * 1000
const MAX_SPOTIFY_RETRIES = 1
const MAX_RETRY_DELAY_MS = 15000
const RETRY_JITTER_MS = 250

let userSession = null
let ccTokenCache = null
let tokenRequest = null
const trackSearchCache = new Map()
const trackSearchRequests = new Map()
const trackLookupCache = new Map()
const trackLookupRequests = new Map()
const artistGenreCache = new Map()
const artistGenreRequests = new Map()
const REQUEST_TIMEOUT_MS = 15000
let spotifyBackoffUntil = 0
let availabilityCache = null

function rateLimitError(retryAfterMs = 1500) {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
  const error = new Error(`Spotify rate limit reached. Retry after ${seconds} seconds.`)
  error.status = 429
  error.code = 'SPOTIFY_RATE_LIMITED'
  error.retryAfterMs = retryAfterMs
  error.rateLimited = true
  return error
}

function quotaExceededError() {
  const error = new Error('Spotify Development Mode quota has been exceeded.')
  error.status = 403
  error.code = 'SPOTIFY_QUOTA_EXCEEDED'
  error.quotaExceeded = true
  return error
}

async function spotifyApiError(response, label) {
  const reason = await spotifyErrorReason(response)
  const error = new Error(`${label}: Spotify returned HTTP ${response.status}.`)
  error.status = response.status
  error.spotifyReason = reason || null
  error.authenticationFailed = response.status === 401
  error.quotaExceeded = response.status === 403 && String(reason).toUpperCase() === 'QUOTA_EXCEEDED'
  if (error.quotaExceeded) error.code = 'SPOTIFY_QUOTA_EXCEEDED'
  return error
}

function retryAfterMs(response) {
  const value = Number(response.headers.get('retry-after'))
  if (Number.isFinite(value) && value >= 0) return value * 1000
  return 0
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function spotifyErrorReason(response) {
  try {
    return (await response.clone().json())?.error?.reason || ''
  } catch {
    return ''
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchSpotify(url, options = {}) {
  const { purpose = 'request', ...requestOptions } = options
  for (let attempt = 0; attempt <= MAX_SPOTIFY_RETRIES; attempt += 1) {
    if (attempt === 0 && spotifyBackoffUntil > Date.now()) {
      const cooldownMs = spotifyBackoffUntil - Date.now()
      console.warn(`[Spotify] 429 Rate Limited; cooldown active for ${Math.ceil(cooldownMs / 1000)}s`)
      throw rateLimitError(cooldownMs)
    }
    console.log(`[Spotify] Request ${purpose} ${requestOptions.method || 'GET'} ${new URL(url).pathname}`)
    const response = await fetchWithTimeout(url, requestOptions)
      console.log(`[Spotify] Response status ${response.status}`)
    if (response.ok) {
      console.log(`[Spotify] ${response.status} Success`)
      return response
    }
    const reason = await spotifyErrorReason(response)
    if (String(reason).toUpperCase() === 'QUOTA_EXCEEDED') {
      console.warn('[Spotify] Quota exceeded')
      throw quotaExceededError()
    }
    if (response.status !== 429) return response

    const headerDelayMs = retryAfterMs(response)
    const exponentialDelayMs = Math.min(MAX_RETRY_DELAY_MS, 1000 * (2 ** attempt))
    const waitMs = headerDelayMs > 0
      ? headerDelayMs
      : Math.min(
        MAX_RETRY_DELAY_MS,
        exponentialDelayMs + Math.floor(Math.random() * RETRY_JITTER_MS),
      )
    spotifyBackoffUntil = Date.now() + waitMs
    console.warn('[Spotify] 429 Rate Limited')
    console.warn(`[Spotify] Retry-After: ${headerDelayMs ? Math.ceil(headerDelayMs / 1000) : 'missing'}`)
    if (attempt >= MAX_SPOTIFY_RETRIES) {
      console.warn(`[Spotify] Giving up after ${attempt + 1} attempts`)
      throw rateLimitError(headerDelayMs || waitMs)
    }
    console.warn(`[Spotify] Retrying attempt ${attempt + 2}/${MAX_SPOTIFY_RETRIES + 1}`)
    await sleep(waitMs)
  }
}

function isUserAuthed() {
  return Boolean(userSession && userSession.accessToken)
}

async function getUserToken() {
  if (!userSession || !userSession.accessToken) return null
  if (userSession.expiresAt > Date.now()) {
    console.log('[Spotify] Token cache hit user')
    return userSession.accessToken
  }
  if (!userSession.refreshToken) {
    userSession = null
    return null
  }

  if (tokenRequest) {
    console.log('[Spotify] Token request in-flight deduplicated')
    return tokenRequest
  }
  tokenRequest = (async () => {
    const basic = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`,
    ).toString('base64')
    const sp = new URLSearchParams()
    sp.set('grant_type', 'refresh_token')
    sp.set('refresh_token', userSession.refreshToken)
    const res = await fetchSpotify(ACCOUNTS_URL, {
      purpose: 'token-refresh',
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: sp.toString(),
    })
    if (!res.ok) {
      userSession = null
      return null
    }
    const data = await res.json()
    if (!data.access_token) {
      userSession = null
      return null
    }
    userSession.accessToken = data.access_token
    if (data.refresh_token) userSession.refreshToken = data.refresh_token
    userSession.expiresAt = Date.now() + (data.expires_in || 3600) * 1000
    return userSession.accessToken
  })()
  try {
    return await tokenRequest
  } finally {
    tokenRequest = null
  }
}

async function getClientCredentialsToken({ clientId, clientSecret }) {
  const now = Date.now()
  if (ccTokenCache && ccTokenCache.expiresAt > now) {
    console.log('[Spotify] Token cache hit client-credentials')
    return ccTokenCache.token
  }
  if (tokenRequest) {
    console.log('[Spotify] Token request in-flight deduplicated')
    return tokenRequest
  }
  tokenRequest = (async () => {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const sp = new URLSearchParams()
    sp.set('grant_type', 'client_credentials')
    const res = await fetchSpotify(ACCOUNTS_URL, {
      purpose: 'token-client-credentials',
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: sp.toString(),
    })
    if (!res.ok) throw await spotifyApiError(res, 'Spotify auth failed')
    const data = await res.json()
    if (!data.access_token) throw new Error('Spotify auth returned no token')
    ccTokenCache = { token: data.access_token, expiresAt: Date.now() + TOKEN_TTL_MS }
    return ccTokenCache.token
  })()
  try {
    return await tokenRequest
  } finally {
    tokenRequest = null
  }
}

async function effectiveToken({ clientId, clientSecret }) {
  const user = await getUserToken()
  if (user) return { token: user, userAuthorized: true }
  return { token: await getClientCredentialsToken({ clientId, clientSecret }), userAuthorized: false }
}

async function fetchSpotifyApi(url, credentials, purpose) {
  let { token } = await effectiveToken(credentials)
  let response = await fetchSpotify(url, {
    purpose,
    headers: { Authorization: `Bearer ${token}` },
  })
  if (response.status !== 401) return response

  console.warn(`[Spotify] 401 Unauthorized during ${purpose}; refreshing token once`)
  if (userSession) userSession.expiresAt = 0
  ccTokenCache = null
  const refreshed = await effectiveToken(credentials).catch(() => null)
  if (!refreshed?.token) return response
  return fetchSpotify(url, {
    purpose,
    headers: { Authorization: `Bearer ${refreshed.token}` },
  })
}

export function buildAuthorizeUrl({ clientId, redirectUri, scope, state }) {
  const sp = new URLSearchParams()
  sp.set('client_id', clientId)
  sp.set('response_type', 'code')
  sp.set('redirect_uri', redirectUri)
  sp.set('scope', scope || '')
  sp.set('state', state)
  sp.set('show_dialog', 'false')
  return `${AUTHORIZE_URL}?${sp.toString()}`
}

export async function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const sp = new URLSearchParams()
  sp.set('grant_type', 'authorization_code')
  sp.set('code', code)
  sp.set('redirect_uri', redirectUri)
  const res = await fetchSpotify(ACCOUNTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: sp.toString(),
  })
  if (!res.ok) throw await spotifyApiError(res, 'Spotify token exchange failed')
  const data = await res.json()
  if (!data.access_token) throw new Error('Spotify token exchange returned no access token')
  userSession = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  }
  return true
}

export function clearUserSession() {
  userSession = null
}

export function spotifyAuthStatus() {
  return {
    configured: Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET),
    authed: isUserAuthed(),
  }
}

export async function checkSpotifyAvailability({ clientId, clientSecret }) {
  if (!clientId || !clientSecret) return false
  if (availabilityCache && availabilityCache.expiresAt > Date.now()) return availabilityCache.available
  try {
    const response = await fetchSpotifyApi(`${API_URL}/search?type=track&limit=1&q=a&market=US`, { clientId, clientSecret }, 'availability')
    const available = response.ok
    availabilityCache = { available, expiresAt: Date.now() + 30 * 1000 }
    return available
  } catch {
    availabilityCache = { available: false, expiresAt: Date.now() + 30 * 1000 }
    return false
  }
}

const DIFFICULTY_POPULARITY = [
  { min: 70, max: 100 },
  { min: 50, max: 85 },
  { min: 30, max: 65 },
  { min: 10, max: 45 },
  { min: 0, max: 28 },
]

function decodeYear(year) {
  if (year === '' || year === null || year === undefined) return null
  const y = Number(year)
  return Number.isFinite(y) ? y : null
}

function normalizeTrack(track, genre, difficulty) {
  const artist = (track.artists || []).map((item) => item.name).join(', ')
  const album = track.album?.name || ''
  const year = track.album?.release_date ? Number(track.album.release_date.slice(0, 4)) : null
  const genreLabel = track.resolvedGenre || 'Unknown'
  return {
    id: `spotify:${track.id}`,
    provider: 'spotify',
    title: track.name,
    artist,
    album,
    artwork: track.album?.images?.[0]?.url || null,
    releaseDate: track.album?.release_date || null,
    genre: genreLabel,
    difficulty: Number(difficulty) || 0,
    popularity: typeof track.popularity === 'number' ? track.popularity : null,
    durationMs: track.duration_ms || 30000,
    externalUrl: track.external_urls?.spotify || null,
    external_urls: track.external_urls?.spotify ? { spotify: track.external_urls.spotify } : {},
    source: 'spotify',
    providerTrackId: track.id,
    playbackType: track.preview_url ? 'spotify' : 'unavailable',
    playbackUrl: track.preview_url || null,
  }
}

async function resolveArtistGenres(tracks, credentials) {
  const ids = Array.from(new Set(tracks.flatMap((track) => (track.artists || []).map((artist) => artist.id)).filter(Boolean)))
  const missing = ids.filter((id) => !artistGenreCache.has(id))
  if (missing.length) {
    const batch = missing.slice(0, 50)
    const requestKey = batch.join(',')
    let request = artistGenreRequests.get(requestKey)
    if (!request) {
      request = (async () => {
        try {
          const response = await fetchSpotifyApi(`${API_URL}/artists?ids=${encodeURIComponent(requestKey)}`, credentials, 'artist-genres')
          if (response.ok) {
            const data = await response.json()
            for (const artist of data.artists || []) {
              artistGenreCache.set(artist.id, artist.genres?.[0] || 'Unknown')
            }
          }
          for (const id of batch) {
            if (!artistGenreCache.has(id)) artistGenreCache.set(id, 'Unknown')
          }
        } catch {
          for (const id of batch) artistGenreCache.set(id, 'Unknown')
        } finally {
          artistGenreRequests.delete(requestKey)
        }
      })()
      artistGenreRequests.set(requestKey, request)
    }
    await request
  }
  return tracks.map((track) => ({
    ...track,
    resolvedGenre: (track.artists || []).map((artist) => artistGenreCache.get(artist.id)).find(Boolean) || 'Unknown',
  }))
}

async function withPlayablePreview(track) {
  return {
    ...track,
    playbackType: track.playbackUrl ? 'spotify' : 'unavailable',
  }
}

export async function searchTracks({
  clientId,
  clientSecret,
  genre,
  yearFrom,
  yearTo,
  difficulty,
  limit = 50,
  offset = 0,
}) {
  const cacheKey = JSON.stringify({
    genre: String(genre || 'Any Genre').trim(),
    yearFrom: decodeYear(yearFrom),
    yearTo: decodeYear(yearTo),
    difficulty: Number(difficulty) || 0,
    limit: Math.min(Math.max(Number(limit) || 10, 1), 10),
    offset: Math.min(Math.max(Math.floor(Number(offset) || 0), 0), 990),
    userAuthorized: isUserAuthed(),
  })
  const cached = trackSearchCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    console.log('[Spotify] Search cache hit')
    return cached.tracks
  }
  if (trackSearchRequests.has(cacheKey)) {
    console.log('[Spotify] Search request in-flight deduplicated')
    return trackSearchRequests.get(cacheKey)
  }
  const request = (async () => {
    const yFrom = decodeYear(yearFrom)
    const yTo = decodeYear(yearTo)
    const yearQuery = yFrom !== null || yTo !== null
      ? ` year:${yFrom !== null ? yFrom : 1900}-${yTo !== null ? yTo : 2030}`
      : ''
    const genreQuery = genre && genre !== 'Any Genre' ? `genre:${String(genre).trim()}` : ''
    const q = `${genreQuery}${yearQuery}`.trim() || 'a'
    const pageLimit = Math.min(Math.max(Number(limit) || 10, 1), 10)
    const pageOffset = Math.min(Math.max(Math.floor(Number(offset) || 0), 0), 990)
    const sp = new URLSearchParams({ type: 'track', limit: String(pageLimit), offset: String(pageOffset), market: 'US', q })
    let usedFallback = false
    let res = await fetchSpotifyApi(`${API_URL}/search?${sp.toString()}`, { clientId, clientSecret }, 'search')
    if (!res.ok && res.status === 400 && genreQuery) {
      const fallback = new URLSearchParams(sp)
      fallback.set('q', yearQuery.trim() || 'a')
      res = await fetchSpotifyApi(`${API_URL}/search?${fallback.toString()}`, { clientId, clientSecret }, 'search-fallback')
      usedFallback = true
    }
    if (!res.ok) {
      if (res.status === 429) throw rateLimitError(retryAfterMs(res))
      throw await spotifyApiError(res, 'Spotify search failed')
    }
    let data = await res.json()
    let items = (data && data.tracks && data.tracks.items) || []
    if (!items.length && genreQuery && !usedFallback) {
      const fallback = new URLSearchParams(sp)
      fallback.set('q', yearQuery.trim() || 'a')
      res = await fetchSpotifyApi(`${API_URL}/search?${fallback.toString()}`, { clientId, clientSecret }, 'search-empty-fallback')
      if (!res.ok) {
        if (res.status === 429) throw rateLimitError(retryAfterMs(res))
        throw await spotifyApiError(res, 'Spotify search failed')
      }
      data = await res.json()
      items = (data && data.tracks && data.tracks.items) || []
    }
    const win = DIFFICULTY_POPULARITY[Number(difficulty)] || DIFFICULTY_POPULARITY[0]
    const candidates = items.filter((track) => {
      if (!track || !track.id) return false
      const popularity = typeof track.popularity === 'number' ? track.popularity : null
      if (popularity !== null && (popularity < win.min || popularity > win.max)) return false
      const year = track.album?.release_date ? Number(track.album.release_date.slice(0, 4)) : null
      return !(yFrom !== null && (year === null || year < yFrom)) && !(yTo !== null && (year === null || year > yTo))
    }).map((track) => normalizeTrack(track, genre, difficulty))
    const genreResolved = await resolveArtistGenres(candidates, { clientId, clientSecret })
    const resolved = await Promise.all(genreResolved.map(withPlayablePreview))
    const tracks = resolved.slice(0, pageLimit)
    trackSearchCache.set(cacheKey, { tracks, expiresAt: Date.now() + AUDIO_CACHE_TTL_MS })
    return tracks
  })()
  trackSearchRequests.set(cacheKey, request)
  try { return await request } finally { trackSearchRequests.delete(cacheKey) }
}

export async function getTracksByIds({ clientId, clientSecret, ids = [], genre = 'Spotify', difficulty = 0 }) {
  const cleanIds = Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)))
    .slice(0, 50)
  if (!cleanIds.length) return []
  const cacheKey = JSON.stringify({ ids: cleanIds, genre, difficulty })
  const cached = trackLookupCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    console.log('[Spotify] Track lookup cache hit')
    return cached.tracks
  }
  if (trackLookupRequests.has(cacheKey)) {
    console.log('[Spotify] Track lookup in-flight deduplicated')
    return trackLookupRequests.get(cacheKey)
  }
  const request = (async () => {
    const queryIds = cleanIds.join(',')
    const res = await fetchSpotifyApi(`${API_URL}/tracks?ids=${encodeURIComponent(queryIds)}&market=US`, { clientId, clientSecret }, 'track-lookup')
  if (!res.ok) {
    if (res.status === 429) throw rateLimitError(retryAfterMs(res))
    throw await spotifyApiError(res, 'Spotify track lookup failed')
  }
  const data = await res.json()
  const found = Array.isArray(data?.tracks)
    ? await resolveArtistGenres(data.tracks.filter((track) => track && track.id), { clientId, clientSecret })
      .then((tracks) => tracks.map((track) => normalizeTrack(track, genre, difficulty)))
    : []
  const tracks = cleanIds
    .map((id) => found.find((track) => track.providerTrackId === id || track.id === id || track.id === `spotify:${id}`))
    .filter(Boolean)
  const enriched = await Promise.all(tracks.map(withPlayablePreview))
  trackLookupCache.set(cacheKey, { tracks: enriched, expiresAt: Date.now() + AUDIO_CACHE_TTL_MS })
  return enriched
  })()
  trackLookupRequests.set(cacheKey, request)
  try {
    return await request
  } finally {
    trackLookupRequests.delete(cacheKey)
  }
}

export async function searchCatalog({ clientId, clientSecret, query, limit = 8 }) {
  const cleanQuery = String(query || '').trim()
  if (!cleanQuery) return []
  const sp = new URLSearchParams({
    type: 'track',
    limit: String(Math.min(Math.max(Number(limit) || 8, 1), 10)),
    market: 'US',
    q: cleanQuery,
  })
  const res = await fetchSpotifyApi(`${API_URL}/search?${sp.toString()}`, { clientId, clientSecret }, 'catalog-search')
  if (!res.ok) {
    if (res.status === 429) throw rateLimitError(retryAfterMs(res))
    throw await spotifyApiError(res, 'Spotify catalog search failed')
  }
  const data = await res.json()
  const items = ((data && data.tracks && data.tracks.items) || [])
    .filter((track) => track && track.id)
  const resolved = await resolveArtistGenres(items, { clientId, clientSecret })
  return resolved.map((track) => normalizeTrack(track, null, 0))
}


