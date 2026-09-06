import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  searchTracks,
  getTracksByIds,
  searchCatalog,
  buildAuthorizeUrl,
  exchangeCode,
  clearUserSession,
  spotifyAuthStatus,
  getSpotifyUserProfile,
  getSpotifyPlaybackCredentials,
  getSpotifyPlaybackEligibility,
  checkSpotifyAvailability,
  spotifyDiagnostics,
} from './services/spotify.js'
import { resolveVSAudio, searchVSAudioTracks, vsAudioDiagnostics } from './services/vsAudio.js'
import { sessionStore } from './services/sessionStore.js'

const root = fileURLToPath(new URL('../', import.meta.url))

function loadEnv() {
  if (process.env.VERCEL) return {}
  const env = {}
  const envPath = join(root, '.env')
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.trim().match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const key = m[1]
      let value = m[2]
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      env[key] = value
    }
  }
  return env
}

const env = loadEnv()
const requestedPort = Number(process.env.PORT || env.PORT || 5173)
const port = Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : 5173

const SUPABASE_URL = process.env.SUPABASE_URL || env.SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || ''

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || env.SPOTIFY_CLIENT_ID || ''
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || env.SPOTIFY_CLIENT_SECRET || ''

if (!process.env.SPOTIFY_CLIENT_ID) process.env.SPOTIFY_CLIENT_ID = SPOTIFY_CLIENT_ID
if (!process.env.SPOTIFY_CLIENT_SECRET) process.env.SPOTIFY_CLIENT_SECRET = SPOTIFY_CLIENT_SECRET
for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!process.env[key] && env[key]) process.env[key] = env[key]
}

const spotifyConfigured = Boolean(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET)
const configuredHost =
  process.env.PUBLIC_BASE_URL ||
  env.PUBLIC_BASE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  env.RENDER_EXTERNAL_URL ||
  process.env.VERCEL_PROJECT_PRODUCTION_URL ||
  process.env.VERCEL_URL ||
  env.VERCEL_URL ||
  ''
const productionBaseUrl = configuredHost
  ? (configuredHost.startsWith('http') ? configuredHost : `https://${configuredHost}`)
  : ''
const SPOTIFY_LOCAL_REDIRECT_URI =
  process.env.SPOTIFY_LOCAL_REDIRECT_URI ||
  env.SPOTIFY_LOCAL_REDIRECT_URI ||
  `http://127.0.0.1:${port}/api/spotify/callback`
const SPOTIFY_PRODUCTION_REDIRECT_URI =
  process.env.SPOTIFY_PRODUCTION_REDIRECT_URI ||
  env.SPOTIFY_PRODUCTION_REDIRECT_URI ||
  (productionBaseUrl ? `${productionBaseUrl.replace(/\/$/, '')}/api/spotify/callback` : '')
const SPOTIFY_REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI ||
  env.SPOTIFY_REDIRECT_URI ||
  ((process.env.VERCEL || process.env.NODE_ENV === 'production') && SPOTIFY_PRODUCTION_REDIRECT_URI
    ? SPOTIFY_PRODUCTION_REDIRECT_URI
    : SPOTIFY_LOCAL_REDIRECT_URI)
const SPOTIFY_SCOPE = 'user-read-private user-read-email streaming user-read-playback-state user-modify-playback-state'

const oauthCookieName = 'musync_spotify_oauth'
const oauthCookieOptions = `Path=/api/spotify; HttpOnly; SameSite=Lax${SPOTIFY_REDIRECT_URI.startsWith('https:') ? '; Secure' : ''}`

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function spotifySessionId(req) {
  const tabSession = String(req.headers['x-musync-spotify-session'] || '').trim()
  return tabSession || null
}

function attachSpotifyPlayback(track) {
  return {
    ...track,
    playbackUrl: null,
    playbackType: 'spotify-sdk',
    playback: {
      available: true,
      provider: 'spotify',
      previewUrl: null,
      mimeType: null,
      durationMs: track.durationMs || 0,
    },
  }
}

function spotifyErrorPayload(error, fallbackCode) {
  const status = Number(error?.status) || 502
  const quotaExceeded = Boolean(error?.quotaExceeded || error?.code === 'SPOTIFY_QUOTA_EXCEEDED')
  return {
    success: false,
    error: quotaExceeded
      ? 'Spotify is temporarily unavailable because the development quota has been reached. Please try again later.'
      : error?.message || 'Spotify request failed.',
    code: error?.code || fallbackCode,
    status,
    spotifyStatus: status,
    spotifyReason: error?.spotifyReason || null,
    rateLimited: status === 429,
    quotaExceeded,
    authenticationFailed: status === 401,
    retryAfter: status === 429 ? Math.ceil((error?.retryAfterMs || 0) / 1000) : undefined,
    catalogTracksFound: Number(error?.catalogTracksFound) || 0,
    playableTracksFound: Number(error?.playableTracksFound) || 0,
  }
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

async function handleRequest(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  let relative = decodeURIComponent(url.pathname)
  if (relative === '/') relative = '/index.html'

  if (relative === '/src/spotify/config.js') {
    const status = await spotifyAuthStatus(spotifySessionId(req))
    const body = [
      "export const isSpotifyConfigured = " + JSON.stringify(status.configured) + ";",
      "export const isSpotifyAuthed = " + JSON.stringify(status.authed) + ";",
      "",
    ].join('\n')
    res.writeHead(200, { 'Content-Type': types['.js'] })
    res.end(body)
    return
  }

  if (relative === '/api/spotify/login') {
    if (!spotifyConfigured) {
      sendJson(res, 503, { error: 'SPOTIFY_NOT_CONFIGURED' })
      return
    }
    const state = randomBytes(16).toString('hex')
    await sessionStore.set('oauth', state, { valid: true }, 10 * 60 * 1000)
    res.setHeader('Set-Cookie', `${oauthCookieName}=${state}; Max-Age=600; ${oauthCookieOptions}`)
    const authUrl = buildAuthorizeUrl({
      clientId: SPOTIFY_CLIENT_ID,
      redirectUri: SPOTIFY_REDIRECT_URI,
      scope: SPOTIFY_SCOPE,
      state,
    })
    res.writeHead(302, { Location: authUrl })
    res.end()
    return
  }

  if (relative === '/api/spotify/callback') {
    res.setHeader('Set-Cookie', `${oauthCookieName}=; Max-Age=0; ${oauthCookieOptions}`)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const err = url.searchParams.get('error')
    let redirect = '/?spotify=auth'
    try {
      if (err) throw new Error(`Spotify login error: ${err}`)
      if (!code) throw new Error('Spotify login missing code')
      const cookieState = String(req.headers.cookie || '').split(';').map((part) => part.trim())
        .find((part) => part.startsWith(`${oauthCookieName}=`))?.slice(oauthCookieName.length + 1)
      if (!state || state !== cookieState) throw new Error('Spotify login state mismatch')
      const oauthState = await sessionStore.take('oauth', state)
      if (!oauthState) throw new Error('Spotify login state mismatch')
      const sessionId = await exchangeCode({
        clientId: SPOTIFY_CLIENT_ID,
        clientSecret: SPOTIFY_CLIENT_SECRET,
        code,
        redirectUri: SPOTIFY_REDIRECT_URI,
      })
      redirect = `/?spotify=auth&spotify_session=${encodeURIComponent(sessionId)}`
    } catch (e) {
      console.error('[Spotify] Login callback failed:', e?.message || e)
      redirect = `/?spotify=error&spotify_reason=${encodeURIComponent(e?.message || 'Spotify login failed')}`
    }
    res.writeHead(302, { Location: redirect })
    res.end()
    return
  }

  if (relative === '/api/spotify/status') {
    const sessionId = spotifySessionId(req)
    const status = await spotifyAuthStatus(sessionId)
    const profile = status.authed ? await getSpotifyUserProfile(sessionId).catch(() => null) : null
    if (status.authed && !profile) status.authed = (await spotifyAuthStatus(sessionId)).authed
    sendJson(res, 200, { ...status, profile })
    return
  }

  if (relative === '/api/spotify/playback-token') {
    try {
      const authorization = String(req.headers.authorization || '')
      const rejectedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : null
      sendJson(res, 200, await getSpotifyPlaybackCredentials(spotifySessionId(req), rejectedToken))
    } catch (error) {
      const status = Number(error?.status) === 401 ? 401 : Number(error?.status) === 429 ? 429 : 502
      if (error?.retryAfterMs) res.setHeader('Retry-After', String(Math.ceil(error.retryAfterMs / 1000)))
      sendJson(res, status, {
        error: error?.message || 'Spotify playback authentication failed.',
        code: error?.code || 'SPOTIFY_PLAYBACK_AUTH_ERROR',
      })
    }
    return
  }

  if (relative === '/api/spotify/eligibility') {
    try {
      sendJson(res, 200, await getSpotifyPlaybackEligibility(spotifySessionId(req)))
    } catch (error) {
      const status = Number(error?.status) === 401 ? 401 : Number(error?.status) === 429 ? 429 : 502
      if (error?.retryAfterMs) res.setHeader('Retry-After', String(Math.ceil(error.retryAfterMs / 1000)))
      sendJson(res, status, {
        authenticated: false,
        premium: false,
        error: error?.message || 'Spotify account verification failed.',
        code: error?.code || 'SPOTIFY_ELIGIBILITY_ERROR',
      })
    }
    return
  }

  if (relative === '/api/providers/status') {
    const spotifyAvailable = await checkSpotifyAvailability({ clientId: SPOTIFY_CLIENT_ID, clientSecret: SPOTIFY_CLIENT_SECRET })
    sendJson(res, 200, {
      spotify: { configured: spotifyConfigured, available: spotifyAvailable },
      vsAudio: vsAudioDiagnostics(),
    })
    return
  }

  if (relative === '/api/vs-audio-preview') {
    const track = {
      trackId: url.searchParams.get('trackId') || '',
      isrc: url.searchParams.get('isrc') || '',
      title: url.searchParams.get('title') || '',
      artist: url.searchParams.get('artist') || '',
      durationMs: Number(url.searchParams.get('durationMs')) || 30000,
    }
    if (!track.title || !track.artist || !track.trackId) {
      sendJson(res, 400, { success: false, error: 'TRACK_METADATA_REQUIRED' })
      return
    }
    try {
      const preview = await resolveVSAudio(track)
      const playablePreview = preview
        ? {
            ...preview,
            previewUrl: `/api/audio-preview?url=${encodeURIComponent(preview.previewUrl)}`,
          }
        : null
      sendJson(res, 200, { success: true, preview: playablePreview })
    } catch {
      sendJson(res, 200, { success: true, preview: null })
    }
    return
  }

  if (relative === '/api/vs-audio-tracks') {
    try {
      const tracks = await searchVSAudioTracks(url.searchParams.get('genre') || 'Any Genre', url.searchParams.get('limit') || 30)
      sendJson(res, 200, { success: true, provider: 'deezer', tracks })
    } catch (error) {
      sendJson(res, 502, { success: false, error: error?.message || 'VS AI catalog lookup failed.' })
    }
    return
  }

  if (relative === '/api/diagnostics/spotify') {
    const tokenLastChar = SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_ID.length > 4 ? SPOTIFY_CLIENT_ID.slice(-4) : 'NONE'
    const shortId = SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_ID.length > 0 ? `[${SPOTIFY_CLIENT_ID.slice(0, 4)}...${tokenLastChar}]` : 'UNCONFIGURED'
    const spotifyAvailable = await checkSpotifyAvailability({ clientId: SPOTIFY_CLIENT_ID, clientSecret: SPOTIFY_CLIENT_SECRET })
    sendJson(res, 200, {
      timestamp: new Date().toISOString(),
      spotify: {
        configured: spotifyConfigured,
        clientIdFingerprint: shortId,
        available: spotifyAvailable,
        environment: {
          hasProcessEnvId: Boolean(process.env.SPOTIFY_CLIENT_ID),
          hasProcessEnvSecret: Boolean(process.env.SPOTIFY_CLIENT_SECRET),
          hasEnvFileId: Boolean(env.SPOTIFY_CLIENT_ID),
          hasEnvFileSecret: Boolean(env.SPOTIFY_CLIENT_SECRET),
        },
        auth: {
          userAuthenticated: (await spotifyAuthStatus(spotifySessionId(req))).authed,
        },
      },
      caches: {
        ...spotifyDiagnostics(),
        note: 'All server caches are in memory and are cleared on restart.',
      },
    })
    return
  }

  if (relative === '/api/audio-preview') {
    const source = url.searchParams.get('url') || ''
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const sourceUrl = new URL(source)
      const allowedAudioHosts = new Set(['p.scdn.co'])
      const isDeezerPreview = sourceUrl.protocol === 'https:' && sourceUrl.hostname.endsWith('.dzcdn.net')
      if (sourceUrl.protocol !== 'https:' || (!allowedAudioHosts.has(sourceUrl.hostname) && !isDeezerPreview)) {
        sendJson(res, 400, { error: 'INVALID_AUDIO_SOURCE' })
        return
      }
      const range = req.headers.range
      const upstream = await fetch(sourceUrl, {
        signal: controller.signal,
        headers: range ? { Range: range } : {},
      })
      if (!upstream.ok) {
        sendJson(res, upstream.status, { error: 'AUDIO_SOURCE_UNAVAILABLE' })
        return
      }
      const body = Buffer.from(await upstream.arrayBuffer())
      const contentType = upstream.headers.get('content-type') || 'audio/mpeg'
      const responseHeaders = {
        'Content-Type': contentType,
        'Content-Length': body.length,
        'Cache-Control': 'private, max-age=300',
        'Accept-Ranges': 'bytes',
      }
      const contentRange = upstream.headers.get('content-range')
      if (contentRange) responseHeaders['Content-Range'] = contentRange
      res.writeHead(upstream.status, responseHeaders)
      res.end(body)
    } catch {
      sendJson(res, 502, { error: 'AUDIO_SOURCE_UNAVAILABLE' })
    } finally {
      clearTimeout(timeout)
    }
    return
  }

  if (relative === '/api/spotify/logout') {
    await clearUserSession(spotifySessionId(req))
    res.setHeader('Set-Cookie', 'musync_spotify_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')
    sendJson(res, 200, { ok: true })
    return
  }

  if (relative === '/api/spotify/tracks') {
    const genre = url.searchParams.get('genre') || 'Any Genre'
    const musicOrigin = url.searchParams.has('musicOrigin')
      ? (url.searchParams.get('musicOrigin') || 'International')
      : 'Any'
    const yearFrom = url.searchParams.get('yearFrom') || ''
    const yearTo = url.searchParams.get('yearTo') || ''
    const difficulty = url.searchParams.get('difficulty') || '0'
    const requestedLimit = Number(url.searchParams.get('limit') || 120)
    const requestedOffset = Number(url.searchParams.get('offset') || 0)
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 10)
      : 10
    const offset = Number.isFinite(requestedOffset)
      ? Math.min(Math.max(Math.floor(requestedOffset / 10) * 10, 0), 990)
      : 0
    try {
      if (!spotifyConfigured) throw Object.assign(new Error('Spotify is not configured.'), { code: 'SPOTIFY_NOT_CONFIGURED', status: 503 })
      const tracks = await searchTracks({
        clientId: SPOTIFY_CLIENT_ID,
        clientSecret: SPOTIFY_CLIENT_SECRET,
        genre,
        musicOrigin,
        yearFrom,
        yearTo,
        difficulty,
        limit,
        offset,
        sessionId: spotifySessionId(req),
      })
      if (tracks.length) {
        sendJson(res, 200, { success: true, provider: 'spotify', tracks: tracks.map(attachSpotifyPlayback) })
        return
      }
      sendJson(res, 200, { success: true, provider: 'spotify', tracks: [] })
    } catch (e) {
      console.warn('[spotify] track search failed', {
        status: e?.status || null,
        code: e?.code || null,
        retryAfterMs: e?.retryAfterMs || null,
      })
      const status = e?.code === 'SPOTIFY_QUOTA_EXCEEDED'
        ? 503
        : (Number(e?.status) >= 400 && Number(e?.status) < 600 ? Number(e.status) : 502)
      if (status === 429) res.setHeader('Retry-After', String(Math.ceil((e.retryAfterMs || 1500) / 1000)))
      sendJson(res, status, spotifyErrorPayload(e, 'SPOTIFY_TRACK_SEARCH_ERROR'))
    }
    return
  }

  if (relative === '/api/spotify/tracks-by-id') {
    if (!spotifyConfigured) {
      sendJson(res, 503, { success: false, error: 'Spotify is not configured.', code: 'SPOTIFY_NOT_CONFIGURED', status: 503 })
      return
    }
    const ids = (url.searchParams.get('ids') || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
    const genre = url.searchParams.get('genre') || 'Spotify'
    const difficulty = url.searchParams.get('difficulty') || '0'
    try {
      const tracks = await getTracksByIds({
        clientId: SPOTIFY_CLIENT_ID,
        clientSecret: SPOTIFY_CLIENT_SECRET,
        ids,
        genre,
        difficulty,
        sessionId: spotifySessionId(req),
      })
      sendJson(res, 200, { success: true, tracks: tracks.map(attachSpotifyPlayback) })
    } catch (e) {
      console.warn('[spotify] track lookup failed', {
        status: e?.status || null,
        code: e?.code || null,
        retryAfterMs: e?.retryAfterMs || null,
      })
      const status = e?.code === 'SPOTIFY_QUOTA_EXCEEDED'
        ? 503
        : (Number(e?.status) >= 400 && Number(e?.status) < 600 ? Number(e.status) : 502)
      if (status === 429) res.setHeader('Retry-After', String(Math.ceil((e.retryAfterMs || 1500) / 1000)))
      sendJson(res, status, spotifyErrorPayload(e, 'SPOTIFY_LOOKUP_ERROR'))
    }
    return
  }

  if (relative === '/api/catalog/search') {
    const query = url.searchParams.get('q') || ''
    if (!query.trim()) {
      sendJson(res, 200, { success: true, tracks: [] })
      return
    }
    try {
      if (!spotifyConfigured) throw Object.assign(new Error('Spotify is not configured.'), { code: 'SPOTIFY_NOT_CONFIGURED', status: 503 })
      const tracks = await searchCatalog({
        clientId: SPOTIFY_CLIENT_ID,
        clientSecret: SPOTIFY_CLIENT_SECRET,
        query,
        limit: url.searchParams.get('limit') || 8,
        sessionId: spotifySessionId(req),
      })
      sendJson(res, 200, { success: true, provider: 'spotify', tracks })
    } catch (e) {
      const status = e?.code === 'SPOTIFY_QUOTA_EXCEEDED'
        ? 503
        : (Number(e?.status) >= 400 && Number(e?.status) < 600 ? Number(e.status) : 502)
      if (status === 429) res.setHeader('Retry-After', String(Math.ceil((e.retryAfterMs || 1500) / 1000)))
      sendJson(res, status, spotifyErrorPayload(e, 'SPOTIFY_CATALOG_SEARCH_ERROR'))
    }
    return
  }

  if (relative === '/src/supabase/config.js') {
    const body = [
      "export const SUPABASE_URL = " + JSON.stringify(SUPABASE_URL) + ";",
      "export const SUPABASE_ANON_KEY = " + JSON.stringify(SUPABASE_ANON_KEY) + ";",
      "",
    ].join('\n')
    res.writeHead(200, { 'Content-Type': types['.js'] })
    res.end(body)
    return
  }

  const normalizedRelative = normalize(relative)
  // Vercel serves the build output itself; never read repository files there.
  if (process.env.VERCEL) {
    sendJson(res, 404, { error: 'NOT_FOUND' })
    return
  }
  const pathParts = normalizedRelative.split(/[\\/]+/).filter(Boolean)
  const isPublicFile = relative === '/index.html' || pathParts[0] === 'src' || pathParts[0] === 'public'
  if (!isPublicFile || pathParts.some((part) => part === '..' || part.startsWith('.'))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
    return
  }
  const filePath = join(root, normalizedRelative.replace(/^(\.\.[/\\])+/, ''))

  try {
    const body = await readFile(filePath)
    const contentType = types[extname(filePath)] || 'application/octet-stream'
    res.writeHead(200, {
      'Content-Type': contentType,
      ...(extname(filePath) === '.js' ? { 'Cache-Control': 'no-store' } : {}),
    })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // OAuth returns a temporary session identifier in the URL.
  res.setHeader('Referrer-Policy', 'no-referrer')
  try {
    await handleRequest(req, res)
  } catch (error) {
    const status = error instanceof URIError ? 400 : (error?.status === 503 ? 503 : 500)
    console.error('Request failed:', error?.code || error?.name || 'Error')
    if (!res.headersSent) sendJson(res, status, { error: status === 400 ? 'INVALID_REQUEST' : 'SERVER_UNAVAILABLE' })
    else res.end()
  }
}

let server

const host = process.env.HOST || env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1')
const maxPortAttempts = 20

function startListening(portToUse) {
  server.once('error', (error) => {
    if (error && error.code === 'EADDRINUSE' && portToUse < port + maxPortAttempts - 1) {
      const nextPort = portToUse + 1
      console.warn(`Port ${portToUse} is busy; retrying on ${nextPort}.`)
      startListening(nextPort)
      return
    }

    console.error('Musync server failed to start:', error)
    process.exit(1)
  })

  server.listen(portToUse, host, () => {
    const displayHost = host === '0.0.0.0' ? 'localhost' : host
    console.log(`Musync running at http://${displayHost}:${portToUse}`)
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      console.log('Supabase integration enabled.')
    } else {
      console.warn(
        'Supabase is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY to a .env file (see .env.example).',
      )
    }
    if (spotifyConfigured) {
      console.log(
        `Spotify configured. Redirect URI: ${SPOTIFY_REDIRECT_URI} (add the exact callback URL to the Spotify dashboard). Login via /api/spotify/login to enable difficulty tiers.`,
      )
    } else {
      console.warn(
        'Spotify is not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to a .env file to load playable tracks.',
      )
    }
  })
}

export function startServer() {
  server = createServer(handler)
  startListening(port)
  return server
}
