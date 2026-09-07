import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { sessionStore } from './sessionStore.js'

const ACCOUNTS_URL = 'https://accounts.spotify.com/api/token'
const API_URL = 'https://api.spotify.com/v1'
const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize'
const AUDIO_CACHE_TTL_MS = 5 * 60 * 1000
const MAX_SPOTIFY_RETRIES = 1
const MAX_RETRY_DELAY_MS = 15000
const RETRY_JITTER_MS = 250

const userTokenRequests = new Map()
const cancelledTokenRequests = new WeakSet()
const accountCache = new Map()
const accountRequests = new Map()
const ACCOUNT_TTL_MS = 5 * 60 * 1000
const TOKEN_EXPIRY_MARGIN_MS = 30000
let ccTokenCache = null
let tokenRequest = null
const trackSearchCache = new Map()
const trackSearchRequests = new Map()
const trackLookupCache = new Map()
const trackLookupRequests = new Map()
const publicPlaylistCache = new Map()
const publicPlaylistRequests = new Map()
const forbiddenResponses = new Map()
const artistGenreCache = new Map()
const artistGenreRequests = new Map()
const SPOTIFY_GENRE_VALUES = new Map([
  ['pop', 'pop'],
  ['rock', 'rock'],
  ['hip-hop', 'hip-hop'],
  ['r&b', 'r-n-b'],
  ['electronic', 'electronic'],
  ['latin', 'latin'],
  ['country', 'country'],
  ['opm / local', 'opm'],
])
const REQUEST_TIMEOUT_MS = 15000
let spotifyBackoffUntil = 0
let accountsBackoffUntil = 0
let spotifyQuotaUntil = 0
let availabilityCache = null
let availabilityDiagnostics = {
  status: null,
  resultCount: null,
  responseTimeMs: null,
  cacheHit: false,
  checkedAt: null,
}

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
  error.retryAfterMs = Math.max(1000, spotifyQuotaUntil - Date.now())
  return error
}

async function spotifyApiError(response, label) {
  const reason = await spotifyErrorReason(response)
  const error = new Error(`${label}: ${reason || `Spotify returned HTTP ${response.status}.`}`)
  error.status = response.status
  error.spotifyReason = reason || null
  error.authenticationFailed = response.status === 401
  error.quotaExceeded = response.status === 403 && String(reason).toUpperCase() === 'QUOTA_EXCEEDED'
  if (error.quotaExceeded) error.code = 'SPOTIFY_QUOTA_EXCEEDED'
  else if (response.status === 403) {
    error.code = /user is not registered/i.test(reason) ? 'SPOTIFY_USER_NOT_ALLOWLISTED'
      : /scope/i.test(reason) ? 'SPOTIFY_SCOPE_REQUIRED' : 'SPOTIFY_FORBIDDEN'
  }
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
    const body = await response.clone().text()
    try {
      const data = JSON.parse(body)
      return String(data?.error?.reason || data?.error?.message || data?.error_description || data?.error || '').slice(0, 600)
    } catch {
      // Allowlist denials are plain text, not Spotify's usual JSON errors.
      return body.replace(/[\r\n\t]+/g, ' ').slice(0, 600)
    }
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
  const accountsRequest = new URL(url).origin === 'https://accounts.spotify.com'
  if (!accountsRequest && spotifyQuotaUntil > Date.now()) {
    throw quotaExceededError()
  }
  for (let attempt = 0; attempt <= MAX_SPOTIFY_RETRIES; attempt += 1) {
    const backoffUntil = accountsRequest ? accountsBackoffUntil : spotifyBackoffUntil
    if (attempt === 0 && backoffUntil > Date.now()) {
      const cooldownMs = backoffUntil - Date.now()
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
      if (!accountsRequest) spotifyQuotaUntil = Date.now() + 5 * 60 * 1000
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
    if (accountsRequest) accountsBackoffUntil = Date.now() + waitMs
    else spotifyBackoffUntil = Date.now() + waitMs
    console.warn('[Spotify] 429 Rate Limited')
    console.warn(`[Spotify] Retry-After: ${headerDelayMs ? Math.ceil(headerDelayMs / 1000) : 'missing'}`)
    if (attempt >= MAX_SPOTIFY_RETRIES || waitMs > MAX_RETRY_DELAY_MS) {
      console.warn(`[Spotify] Giving up after ${attempt + 1} attempts`)
      throw rateLimitError(headerDelayMs || waitMs)
    }
    console.warn(`[Spotify] Retrying attempt ${attempt + 2}/${MAX_SPOTIFY_RETRIES + 1}`)
    await sleep(waitMs)
  }
}

async function getUserSession(sessionId) {
  return sessionStore.get('spotify', sessionId)
}

async function isUserAuthed(sessionId) {
  const userSession = await getUserSession(sessionId)
  return Boolean(userSession && userSession.accessToken)
}

function getUserToken(sessionId, rejectedToken = null) {
  const pending = userTokenRequests.get(sessionId)
  if (pending) {
    return rejectedToken
      ? pending.then((token) => token === rejectedToken ? getUserToken(sessionId, rejectedToken) : token)
      : pending
  }
  const request = (async () => {
    const userSession = await getUserSession(sessionId)
    if (!userSession || !userSession.accessToken) return null
    if (userSession.clientId && userSession.clientId !== process.env.SPOTIFY_CLIENT_ID) {
      throw Object.assign(new Error('The Spotify app configuration changed. Reconnect Spotify.'), { status: 401, code: 'SPOTIFY_LOGIN_REQUIRED' })
    }
    if (userSession.expiresAt > Date.now() + TOKEN_EXPIRY_MARGIN_MS && userSession.accessToken !== rejectedToken) {
      if (process.env.SPOTIFY_DEBUG === '1') console.log('[Spotify] Token cache hit user (reused; no refresh)')
      return userSession.accessToken
    }
    if (!userSession.refreshToken) {
      await clearUserSession(sessionId)
      return null
    }

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
      const failure = await res.clone().json().catch(() => ({}))
      if (res.status === 400 && failure.error === 'invalid_grant') {
        await clearUserSession(sessionId)
        return null
      }
      // Transient outages/rate limits must not erase a usable refresh token.
      throw await spotifyApiError(res, 'Spotify token refresh failed')
    }
    const data = await res.json()
    if (!data.access_token) {
      throw new Error('Spotify token refresh returned no access token')
    }
    // Do not recreate a session removed by logout while refresh was pending.
    const currentSession = await getUserSession(sessionId)
    if (!currentSession || cancelledTokenRequests.has(request)) return null
    if (currentSession.accessToken !== userSession.accessToken && currentSession.expiresAt > Date.now() + TOKEN_EXPIRY_MARGIN_MS) return currentSession.accessToken
    userSession.accessToken = data.access_token
    if (data.refresh_token) userSession.refreshToken = data.refresh_token
    userSession.expiresAt = Date.now() + (data.expires_in || 3600) * 1000
    if (typeof data.scope === 'string') userSession.scope = data.scope
    await sessionStore.set('spotify', sessionId, userSession)
    if (cancelledTokenRequests.has(request)) {
      await sessionStore.delete('spotify', sessionId)
      return null
    }
    return userSession.accessToken
  })().finally(() => {
    if (userTokenRequests.get(sessionId) === request) userTokenRequests.delete(sessionId)
  })
  userTokenRequests.set(sessionId, request)
  return request
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
    ccTokenCache = { token: data.access_token, expiresAt: Date.now() + Math.max(0, (Number(data.expires_in) || 3600) * 1000 - TOKEN_EXPIRY_MARGIN_MS) }
    return ccTokenCache.token
  })()
  try {
    return await tokenRequest
  } finally {
    tokenRequest = null
  }
}

async function effectiveToken({ clientId, clientSecret }, sessionId, requireUser = false) {
  const hadSession = await isUserAuthed(sessionId)
  const user = await getUserToken(sessionId)
  if (user) return { token: user, userAuthorized: true }
  if (requireUser || hadSession) {
    throw Object.assign(new Error('Spotify login is required. Connect Spotify to load Classic songs.'), { status: 401, code: 'SPOTIFY_LOGIN_REQUIRED' })
  }
  return { token: await getClientCredentialsToken({ clientId, clientSecret }), userAuthorized: false }
}

async function fetchSpotifyApi(url, credentials, purpose, sessionId, requireUser = false) {
  const { token, userAuthorized } = await effectiveToken(credentials, sessionId, requireUser)
  const denialKey = `${sessionId || 'app'}:${new URL(url).pathname}`
  const denied = forbiddenResponses.get(denialKey)
  if (denied?.expiresAt > Date.now()) return denied.response.clone()
  forbiddenResponses.delete(denialKey)
  const rememberDenial = (response) => {
    if (response.status === 403) {
      for (const [key, entry] of forbiddenResponses) if (entry.expiresAt <= Date.now()) forbiddenResponses.delete(key)
      if (forbiddenResponses.size >= 200) forbiddenResponses.delete(forbiddenResponses.keys().next().value)
      forbiddenResponses.set(denialKey, { response: response.clone(), expiresAt: Date.now() + 60000 })
    }
    return response
  }
  let response = await fetchSpotify(url, {
    purpose,
    headers: { Authorization: `Bearer ${token}` },
  })
  if (response.status !== 401) return rememberDenial(response)

  console.warn(`[Spotify] 401 Unauthorized during ${purpose}; refreshing token once`)
  if (!userAuthorized && ccTokenCache?.token === token) ccTokenCache = null
  const refreshed = userAuthorized
    ? await getUserToken(sessionId, token)
    : await getClientCredentialsToken(credentials)
  if (!refreshed) return response
  return rememberDenial(await fetchSpotify(url, {
    purpose,
    headers: { Authorization: `Bearer ${refreshed}` },
  }))
}

export function buildAuthorizeUrl({ clientId, redirectUri, scope, state }) {
  const sp = new URLSearchParams()
  sp.set('client_id', clientId)
  sp.set('response_type', 'code')
  sp.set('redirect_uri', redirectUri)
  sp.set('scope', scope || '')
  sp.set('state', state)
  sp.set('show_dialog', 'true')
  return `${AUTHORIZE_URL}?${sp.toString()}`
}

export async function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const sp = new URLSearchParams()
  sp.set('grant_type', 'authorization_code')
  sp.set('code', code)
  sp.set('redirect_uri', redirectUri)
  const res = await fetchSpotify(ACCOUNTS_URL, {
    purpose: 'token-authorization-code',
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
  const sessionId = randomBytes(24).toString('hex')
  await sessionStore.set('spotify', sessionId, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    scope: typeof data.scope === 'string' ? data.scope : null,
    clientId,
  })
  return sessionId
}

export async function clearUserSession(sessionId) {
  const pending = userTokenRequests.get(sessionId)
  if (pending) cancelledTokenRequests.add(pending)
  accountCache.delete(sessionId)
  for (const key of forbiddenResponses.keys()) if (key.startsWith(`${sessionId}:`)) forbiddenResponses.delete(key)
  await sessionStore.delete('spotify', sessionId)
}

export async function spotifyAuthStatus(sessionId) {
  return {
    configured: Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET),
    authed: await isUserAuthed(sessionId),
  }
}

async function getSpotifyAccount(sessionId) {
  if (accountRequests.has(sessionId)) return accountRequests.get(sessionId)
  const request = (async () => {
    const token = await getUserToken(sessionId)
    if (!token) return null
    const cached = accountCache.get(sessionId)
    if (cached && cached.expiresAt > Date.now()) return cached.account
    const getAccount = (accessToken) => fetchSpotify(`${API_URL}/me`, {
      purpose: 'account-profile',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    let response = await getAccount(token)
    if (response.status === 401) {
      const refreshed = await getUserToken(sessionId, token)
      if (!refreshed) return null
      response = await getAccount(refreshed)
      if (response.status === 401) {
        await clearUserSession(sessionId)
        return null
      }
    }
    if (!response.ok) throw await spotifyApiError(response, 'Spotify account verification failed')
    const account = await response.json()
    for (const [id, entry] of accountCache) {
      if (entry.expiresAt <= Date.now()) accountCache.delete(id)
    }
    if (accountCache.size >= 200) accountCache.delete(accountCache.keys().next().value)
    accountCache.set(sessionId, { account, expiresAt: Date.now() + ACCOUNT_TTL_MS })
    return account
  })().finally(() => {
    if (accountRequests.get(sessionId) === request) accountRequests.delete(sessionId)
  })
  accountRequests.set(sessionId, request)
  return request
}

export async function getSpotifyUserProfile(sessionId) {
  const account = await getSpotifyAccount(sessionId)
  if (!account) return null
  return {
    id: account.id || null,
    displayName: account.display_name || account.id || 'Spotify user',
    email: account.email || null,
    product: account.product || null,
  }
}

export async function getSpotifyPlaybackToken(sessionId, rejectedToken = null) {
  const token = await getUserToken(sessionId, rejectedToken)
  if (token) {
    const session = await getUserSession(sessionId)
    if (typeof session?.scope === 'string') {
      const granted = new Set(session.scope.split(/\s+/))
      const required = ['streaming', 'user-read-private', 'user-read-email', 'user-modify-playback-state', 'user-read-playback-state']
      if (required.some((scope) => !granted.has(scope))) {
        throw Object.assign(new Error('Reconnect Spotify to grant the required playback permissions.'), { status: 403, code: 'SPOTIFY_SCOPE_REQUIRED' })
      }
    }
    return token
  }
  const error = new Error('Spotify login is required for playback.')
  error.status = 401
  error.code = 'SPOTIFY_LOGIN_REQUIRED'
  throw error
}

export async function getSpotifyPlaybackCredentials(sessionId, rejectedToken = null) {
  const accessToken = await getSpotifyPlaybackToken(sessionId, rejectedToken)
  const session = await getUserSession(sessionId)
  return { accessToken, expiresAt: session?.accessToken === accessToken ? session.expiresAt : Date.now() }
}

export async function getSpotifyPlaybackEligibility(sessionId) {
  await getSpotifyPlaybackToken(sessionId)
  // New Development Mode profiles omit product. Only the SDK/player can
  // establish playback eligibility; a stored login does not establish Premium.
  return { authenticated: true, premium: null }
}

export async function checkSpotifyAvailability({ clientId, clientSecret }) {
  if (!clientId || !clientSecret) return false
  if (availabilityCache && availabilityCache.expiresAt > Date.now()) {
    availabilityDiagnostics = { ...availabilityDiagnostics, cacheHit: true }
    return availabilityCache.available
  }
  const startedAt = Date.now()
  try {
    const response = await fetchSpotifyApi(`${API_URL}/search?type=track&limit=1&q=a&market=US`, { clientId, clientSecret }, 'availability')
    const available = response.ok
    const data = await response.clone().json().catch(() => null)
    availabilityDiagnostics = {
      status: response.status,
      resultCount: Array.isArray(data?.tracks?.items) ? data.tracks.items.length : null,
      responseTimeMs: Date.now() - startedAt,
      cacheHit: false,
      checkedAt: new Date().toISOString(),
    }
    availabilityCache = { available, expiresAt: Date.now() + 30 * 1000 }
    return available
  } catch (error) {
    availabilityDiagnostics = {
      status: Number(error?.status) || null,
      resultCount: null,
      responseTimeMs: Date.now() - startedAt,
      cacheHit: false,
      checkedAt: new Date().toISOString(),
    }
    availabilityCache = { available: false, expiresAt: Date.now() + 30 * 1000 }
    return false
  }
}

export function spotifyDiagnostics() {
  return {
    availability: { ...availabilityDiagnostics },
    cache: {
      availability: Boolean(availabilityCache),
      trackSearchEntries: trackSearchCache.size,
      trackLookupEntries: trackLookupCache.size,
      artistGenreEntries: artistGenreCache.size,
      clientCredentialsTokenCached: Boolean(ccTokenCache && ccTokenCache.expiresAt > Date.now()),
    },
  }
}

function decodeYear(year) {
  if (year === '' || year === null || year === undefined) return null
  const y = Number(year)
  return Number.isFinite(y) ? y : null
}

function spotifyGenreValue(genre) {
  const value = String(genre || '').trim()
  return SPOTIFY_GENRE_VALUES.get(value.toLowerCase()) || value.toLowerCase()
}

// Spotify genres describe artists. Match whole genre words, including common
// subgenres, rather than stamping the requested genre onto unrelated results.
function matchesGenre(track, genre) {
  if (!genre || genre === 'Any Genre') return true
  const patterns = {
    'pop': /\bpop\b/,
    'rock': /\b(rock|metal|punk|grunge)\b/,
    'hip-hop': /\b(hip hop|rap|trap|drill)\b/,
    'r&b': /\b(r b|r and b|r n b|soul|neo soul)\b/,
    'electronic': /\b(electronic|electronica|edm|house|techno|trance|dubstep|drum and bass|dance)\b/,
    'latin': /\b(latin|latino|reggaeton|salsa|bachata|bossa nova|samba)\b/,
    'country': /\b(country|bluegrass|americana)\b/,
  }
  const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const pattern = patterns[String(genre).toLowerCase()]
  return (track.resolvedGenres || []).some((value) => pattern
    ? pattern.test(normalize(value)) : normalize(value) === normalize(genre))
}

function normalizeTrack(track, genre, difficulty) {
  const artist = (track.artists || []).map((item) => item.name).join(', ')
  const album = track.album?.name || ''
  const year = track.album?.release_date ? Number(track.album.release_date.slice(0, 4)) : null
  const genreLabel = genre && genre !== 'Any Genre'
    ? (track.resolvedGenres || []).find((value) => matchesGenre({ resolvedGenres: [value] }, genre)) || track.resolvedGenre || 'Unknown'
    : track.resolvedGenre || 'Unknown'
  return {
    id: track.id,
    provider: 'spotify',
    title: track.name,
    artist,
    artistId: track.artists?.[0]?.id || null,
    musicOrigin: isOpmTrack(track) ? 'OPM' : hasArtistGenres(track) ? 'International' : null,
    album,
    artwork: track.album?.images?.[0]?.url || null,
    albumArt: track.album?.images?.[0]?.url || null,
    releaseDate: track.album?.release_date || null,
    genre: genreLabel,
    difficulty: Number(difficulty) || 0,
    popularity: typeof track.popularity === 'number' ? track.popularity : null,
    durationMs: track.duration_ms || 30000,
    externalUrl: track.external_urls?.spotify || null,
    spotifyUrl: track.external_urls?.spotify || null,
    external_urls: track.external_urls?.spotify ? { spotify: track.external_urls.spotify } : {},
    isrc: track.external_ids?.isrc || null,
    spotifyPreviewUrl: track.preview_url || null,
    source: 'spotify',
    providerTrackId: track.id,
    playbackType: 'spotify-sdk',
    playbackUrl: null,
  }
}

function decodePublicHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

async function fetchPublicPlaylistPageTracks(id) {
  const response = await fetch(`https://open.spotify.com/playlist/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!response.ok) return []
  const html = await response.text()
  const tracks = []
  const rowPattern = /data-testid="track-row"[^>]*aria-label="([^"]*)"[\s\S]*?href="\/track\/([A-Za-z0-9]+)"[\s\S]*?data-testid="internal-artist-link"[^>]*>([^<]+)</g
  for (const match of html.matchAll(rowPattern)) {
    const [, name, idValue, artist] = match
    tracks.push({
      id: idValue,
      name: decodePublicHtml(name),
      artists: [{ name: decodePublicHtml(artist) }],
      is_playable: true,
      is_local: false,
    })
  }
  return tracks
}

function isOpmTrack(track) {
  return (track.resolvedGenres || []).some((genre) => /(?:^|[^a-z])(?:opm|pinoy|filipino|philippine|tagalog)(?:[^a-z]|$)/i.test(String(genre)))
}

function hasArtistGenres(track) {
  return (track.artists || []).length > 0 && track.artists.every((artist) =>
    (artistGenreCache.get(artist.id) || []).some((genre) => genre && genre !== 'Unknown'))
}

async function resolveArtistGenres(tracks, credentials, sessionId, requireUser = false) {
  const ids = Array.from(new Set(tracks.flatMap((track) => (track.artists || []).map((artist) => artist.id)).filter(Boolean)))
  const missing = ids.filter((id) => !artistGenreCache.has(id))
  const resolveArtist = async (id) => {
    if (artistGenreCache.has(id)) return
    const requestKey = `${sessionId || 'app'}:${requireUser}:${id}`
    let request = artistGenreRequests.get(requestKey)
    if (!request) {
      request = (async () => {
        try {
          const response = await fetchSpotifyApi(`${API_URL}/artists/${encodeURIComponent(id)}`, credentials, 'artist-genres', sessionId, requireUser)
          if (response.ok) {
            const artist = await response.json()
            artistGenreCache.set(id, artist.genres?.length ? artist.genres : ['Unknown'])
          } else {
            throw await spotifyApiError(response, 'Spotify origin metadata failed')
          }
        } catch (error) {
          if ([401, 403, 429].includes(error.status)) throw error
          // Missing metadata stays unclassified and can be retried later.
        } finally {
          artistGenreRequests.delete(requestKey)
        }
      })()
      artistGenreRequests.set(requestKey, request)
    }
    await request
  }
  // Keep origin classification, without serially waiting for every artist.
  // Stop scheduling metadata work after an auth or rate-limit failure.
  let next = 0
  let failure = null
  await Promise.all(Array.from({ length: Math.min(3, missing.length) }, async () => {
    while (!failure && next < missing.length) {
      const id = missing[next++]
      try { await resolveArtist(id) } catch (error) { failure ||= error }
    }
  }))
  if (failure) throw failure
  return tracks.map((track) => ({
    ...track,
    resolvedGenres: (track.artists || []).flatMap((artist) => artistGenreCache.get(artist.id) || []),
    primaryArtistGenres: track.artists?.[0]?.id
      ? (artistGenreCache.get(track.artists[0].id) || [])
      : [],
    resolvedGenre: (track.artists || []).flatMap((artist) => artistGenreCache.get(artist.id) || []).find(Boolean) || 'Unknown',
  }))
}

async function withPlayablePreview(track) {
  return {
    ...track,
    playbackType: 'spotify-sdk',
    playbackUrl: null,
  }
}

export async function searchTracks({
  clientId,
  clientSecret,
  genre,
  musicOrigin = 'International',
  yearFrom,
  yearTo,
  difficulty,
  limit = 50,
  offset = 0,
  sessionId,
  requireUser = false,
  includePageInfo = false,
}) {
  // Check before serving a cached pool: expired/missing Classic sessions must
  // never silently switch to app credentials or another user's market results.
  if (requireUser) await getSpotifyPlaybackToken(sessionId)
  musicOrigin = musicOrigin === 'Any' ? 'Any' : /^(opm|opm\s*\/\s*local)$/i.test(String(musicOrigin).trim()) ? 'OPM' : 'International'
  const cacheKey = JSON.stringify({
    genre: String(genre || 'Any Genre').trim(),
    musicOrigin: String(musicOrigin || 'International').trim(),
    yearFrom: decodeYear(yearFrom),
    yearTo: decodeYear(yearTo),
    difficulty: Number(difficulty) || 0,
    limit: Math.min(Math.max(Number(limit) || 10, 1), 10),
    offset: Math.min(Math.max(Math.floor(Number(offset) || 0), 0), 990),
    sessionId: sessionId || null,
    requireUser,
  })
  const cached = trackSearchCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    console.log('[Spotify] Search cache hit')
    return includePageInfo ? cached.page : cached.page.tracks
  }
  if (trackSearchRequests.has(cacheKey)) {
    console.log('[Spotify] Search request in-flight deduplicated')
    const page = await trackSearchRequests.get(cacheKey)
    return includePageInfo ? page : page.tracks
  }
  const request = (async () => {
    const yFrom = decodeYear(yearFrom)
    const yTo = decodeYear(yearTo)
    const yearQuery = (yFrom !== null || yTo !== null
      ? ` year:${yFrom !== null ? yFrom : 1900}-${yTo !== null ? yTo : 2030}`
      : '')
    const genreQuery = musicOrigin === 'OPM'
      ? `genre:${spotifyGenreValue('OPM / Local')}`
      : (genre && genre !== 'Any Genre' ? `genre:${spotifyGenreValue(genre)}` : '')
    const originQuery = ''
    const q = `${originQuery} ${genreQuery}${yearQuery}`.trim() || `year:1950-${new Date().getUTCFullYear()}`
    const pageLimit = Math.min(Math.max(Number(limit) || 10, 1), 10)
    const pageOffset = Math.min(Math.max(Math.floor(Number(offset) || 0), 0), 990)
    const sp = new URLSearchParams({ type: 'track', limit: String(pageLimit), offset: String(pageOffset), market: 'US', q })
    let res = await fetchSpotifyApi(`${API_URL}/search?${sp.toString()}`, { clientId, clientSecret }, 'search', sessionId, requireUser)
    if (!res.ok) {
      if (res.status === 429) throw rateLimitError(retryAfterMs(res))
      throw await spotifyApiError(res, 'Spotify search failed')
    }
    let data = await res.json()
    let items = (data && data.tracks && data.tracks.items) || []
    const candidates = items.filter((track) => {
      if (!track || !track.id || track.is_playable === false || track.is_local || track.restrictions?.reason) return false
      const year = track.album?.release_date ? Number(track.album.release_date.slice(0, 4)) : null
      return !(yFrom !== null && (!Number.isFinite(year) || year < yFrom)) && !(yTo !== null && (!Number.isFinite(year) || year > yTo))
    })
    const genreResolved = musicOrigin === 'Any' && (!genre || genre === 'Any Genre') ? candidates
      : await resolveArtistGenres(candidates, { clientId, clientSecret }, sessionId, requireUser)
    // Resolve raw artist IDs before normalization. Unknown origins are never
    // silently treated as international, including search fallback results.
    const originTracks = genreResolved.filter((track) => matchesGenre(track, genre)
      && (musicOrigin === 'Any' || (musicOrigin === 'OPM'
        ? isOpmTrack(track) : hasArtistGenres(track) && !isOpmTrack(track))))
      .map((track) => normalizeTrack(track, genre, difficulty))
    const resolved = await Promise.all(originTracks.map(withPlayablePreview))
    const tracks = resolved.slice(0, pageLimit)
    // Pagination follows raw search results, even when all rows were filtered out.
    const hasMore = data.tracks?.next != null || (data.tracks?.next === undefined && items.length === pageLimit)
    const page = { tracks, nextOffset: hasMore && pageOffset + pageLimit <= 990 ? pageOffset + pageLimit : null }
    trackSearchCache.set(cacheKey, { page, expiresAt: Date.now() + AUDIO_CACHE_TTL_MS })
    return page
  })()
  trackSearchRequests.set(cacheKey, request)
  try {
    const page = await request
    return includePageInfo ? page : page.tracks
  } finally { trackSearchRequests.delete(cacheKey) }
}

export async function getTracksByIds({ clientId, clientSecret, ids = [], genre = 'Spotify', difficulty = 0, sessionId }) {
  const cleanIds = Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)))
    .slice(0, 50)
  if (!cleanIds.length) return []
  const cacheKey = JSON.stringify({ ids: cleanIds, genre, difficulty, sessionId: sessionId || null })
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
    const found = []
    for (const id of cleanIds) {
      const res = await fetchSpotifyApi(`${API_URL}/tracks/${encodeURIComponent(id)}?market=US`, { clientId, clientSecret }, 'track-lookup', sessionId)
      if (res.status === 404) continue
      if (!res.ok) throw await spotifyApiError(res, 'Spotify track lookup failed')
      const track = await res.json()
      if (track?.id && track.is_playable !== false && !track.is_local && !track.restrictions?.reason) found.push(normalizeTrack(track, genre, difficulty))
    }
    const tracks = cleanIds
      .map((id) => found.find((track) => track.providerTrackId === id || track.id === id))
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

export async function searchCatalog({ clientId, clientSecret, query, limit = 8, sessionId }) {
  const cleanQuery = String(query || '').trim()
  if (!cleanQuery) return []
  const sp = new URLSearchParams({
    type: 'track',
    limit: String(Math.min(Math.max(Number(limit) || 8, 1), 10)),
    market: 'US',
    q: cleanQuery,
  })
  const res = await fetchSpotifyApi(`${API_URL}/search?${sp.toString()}`, { clientId, clientSecret }, 'catalog-search', sessionId)
  if (!res.ok) {
    if (res.status === 429) throw rateLimitError(retryAfterMs(res))
    throw await spotifyApiError(res, 'Spotify catalog search failed')
  }
  const data = await res.json()
  const items = ((data && data.tracks && data.tracks.items) || [])
    .filter((track) => track && track.id)
  // Answer suggestions need titles and artists, not genre enrichment.
  return items.map((track) => normalizeTrack(track, null, 0))
}

export async function getPublicPlaylistTracks({ clientId, clientSecret, playlistIds = [], limit = 1500 }) {
  const ids = Array.from(new Set(playlistIds.map((id) => String(id || '').trim()).filter(Boolean)))
  if (!ids.length) return []
  const cacheKey = JSON.stringify(ids)
  const cached = publicPlaylistCache.get(cacheKey)
  if (cached?.expiresAt > Date.now()) return cached.tracks
  if (publicPlaylistRequests.has(cacheKey)) return publicPlaylistRequests.get(cacheKey)
  const request = (async () => {
    const responses = await Promise.allSettled(ids.map(async (id) => {
      const tracks = []
      try {
        for (let offset = 0; offset < 1000; offset += 100) {
          const params = new URLSearchParams({ limit: '100', market: 'US', offset: String(offset) })
          const response = await fetchSpotifyApi(`${API_URL}/playlists/${encodeURIComponent(id)}/tracks?${params}`, { clientId, clientSecret }, 'classic-guest-playlist')
          if (!response.ok) throw await spotifyApiError(response, 'Spotify playlist lookup failed')
          const data = await response.json()
          tracks.push(...(data.items || []).map((item) => item.track).filter(Boolean))
          if (tracks.length >= Number(data.total) || (data.items || []).length < 100) break
        }
      } catch {
        return fetchPublicPlaylistPageTracks(id)
      }
      return tracks
    }))
    const tracks = [...new Map(responses
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value)
      .filter((track) => track.id && track.name && track.artists?.length && track.is_playable !== false && !track.is_local)
      .map((track) => [track.id, track])).values()]
      .slice(0, Math.min(Math.max(Number(limit) || 1500, 1), 1500))
    publicPlaylistCache.set(cacheKey, { tracks, expiresAt: Date.now() + 30 * 60 * 1000 })
    return tracks
  })().finally(() => publicPlaylistRequests.delete(cacheKey))
  publicPlaylistRequests.set(cacheKey, request)
  return request
}
