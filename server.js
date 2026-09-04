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
  checkSpotifyAvailability,
} from './spotify.js'

const root = fileURLToPath(new URL('.', import.meta.url))

// ---------------------------------------------------------------------------
// Minimal .env loader (no dependencies). Values merged over process.env so
// real env vars take precedence over the .env file.
// ---------------------------------------------------------------------------
function loadEnv() {
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

// Make the resolved credentials visible to the spotify module, which reads
// them from process.env.
if (!process.env.SPOTIFY_CLIENT_ID) process.env.SPOTIFY_CLIENT_ID = SPOTIFY_CLIENT_ID
if (!process.env.SPOTIFY_CLIENT_SECRET) process.env.SPOTIFY_CLIENT_SECRET = SPOTIFY_CLIENT_SECRET

const spotifyConfigured = Boolean(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET)
const configuredHost =
  process.env.PUBLIC_BASE_URL ||
  env.PUBLIC_BASE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  env.RENDER_EXTERNAL_URL ||
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
  (process.env.NODE_ENV === 'production' && SPOTIFY_PRODUCTION_REDIRECT_URI
    ? SPOTIFY_PRODUCTION_REDIRECT_URI
    : SPOTIFY_LOCAL_REDIRECT_URI)
const SPOTIFY_SCOPE = 'user-read-private user-read-email'

// Single in-memory CSRF state for the OAuth dance (single local user).
const oauthStates = new Map()

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function attachSpotifyPlayback(track) {
  const playbackUrl = track.playbackUrl
    ? `/api/audio-preview?url=${encodeURIComponent(track.playbackUrl)}`
    : null
  return {
    ...track,
    playbackUrl,
    playbackType: playbackUrl ? 'preview' : 'unavailable',
    playback: {
      available: Boolean(playbackUrl),
      provider: playbackUrl ? 'spotify' : null,
      previewUrl: playbackUrl,
      mimeType: null,
      durationMs: playbackUrl ? 30000 : 0,
    },
  }
}

function spotifyErrorPayload(error, fallbackCode) {
  const status = Number(error?.status) || 502
  const quotaExceeded = Boolean(error?.quotaExceeded || error?.code === 'SPOTIFY_QUOTA_EXCEEDED')
  return {
    success: false,
    error: error?.message || 'Spotify request failed.',
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  let relative = decodeURIComponent(url.pathname)
  if (relative === '/') relative = '/index.html'

  // Inject Spotify config into a browser-loadable module. Only exposes whether
  // Spotify is configured — never any client ID/secret.
  if (relative === '/src/spotify/config.js') {
    const status = spotifyAuthStatus()
    const body = [
      "export const isSpotifyConfigured = " + JSON.stringify(status.configured) + ";",
      "export const isSpotifyAuthed = " + JSON.stringify(status.authed) + ";",
      "",
    ].join('\n')
    res.writeHead(200, { 'Content-Type': types['.js'] })
    res.end(body)
    return
  }

  // Kick off Spotify user login (Authorization Code flow).
  if (relative === '/api/spotify/login') {
    if (!spotifyConfigured) {
      sendJson(res, 503, { error: 'SPOTIFY_NOT_CONFIGURED' })
      return
    }
    const state = randomBytes(16).toString('hex')
    oauthStates.set(state, Date.now() + 10 * 60 * 1000)
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

  // Spotify redirects back here after the user authorizes.
  if (relative === '/api/spotify/callback') {
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const err = url.searchParams.get('error')
    let redirect = '/?spotify=auth'
    try {
      if (err) throw new Error(`Spotify login error: ${err}`)
      if (!code) throw new Error('Spotify login missing code')
      if (!state || !oauthStates.has(state)) throw new Error('Spotify login state mismatch')
      oauthStates.delete(state)
      await exchangeCode({
        clientId: SPOTIFY_CLIENT_ID,
        clientSecret: SPOTIFY_CLIENT_SECRET,
        code,
        redirectUri: SPOTIFY_REDIRECT_URI,
      })
    } catch (e) {
      redirect = `/?spotify=error`
    }
    res.writeHead(302, { Location: redirect })
    res.end()
    return
  }

  // Live auth status for the "Connect Spotify" button.
  if (relative === '/api/spotify/status') {
    sendJson(res, 200, spotifyAuthStatus())
    return
  }

  if (relative === '/api/providers/status') {
    const spotifyAvailable = await checkSpotifyAvailability({ clientId: SPOTIFY_CLIENT_ID, clientSecret: SPOTIFY_CLIENT_SECRET })
    sendJson(res, 200, {
      spotify: { configured: spotifyConfigured, available: spotifyAvailable },
    })
    return
  }

  // Preview URLs are only proxied for Spotify's officially supplied preview.
  if (relative === '/api/audio-preview') {
    const source = url.searchParams.get('url') || ''
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const sourceUrl = new URL(source)
      const allowedAudioHosts = new Set(['p.scdn.co'])
      if (sourceUrl.protocol !== 'https:' || !allowedAudioHosts.has(sourceUrl.hostname)) {
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
    clearUserSession()
    sendJson(res, 200, { ok: true })
    return
  }

  // Proxy Spotify track searches. Uses the user token (for popularity) when the
  // user has logged in, otherwise falls back to client credentials and skips
  // the popularity filter. All credentials stay on the server.
  if (relative === '/api/spotify/tracks') {
    const genre = url.searchParams.get('genre') || 'Any Genre'
    const yearFrom = url.searchParams.get('yearFrom') || ''
    const yearTo = url.searchParams.get('yearTo') || ''
    const difficulty = url.searchParams.get('difficulty') || '0'
    const requestedLimit = Number(url.searchParams.get('limit') || 120)
    const requestedOffset = Number(url.searchParams.get('offset') || 0)
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 50)
      : 120
    const offset = Number.isFinite(requestedOffset)
      ? Math.min(Math.max(Math.floor(requestedOffset / 10) * 10, 0), 990)
      : 0
    try {
      if (!spotifyConfigured) throw Object.assign(new Error('Spotify is not configured.'), { code: 'SPOTIFY_NOT_CONFIGURED', status: 503 })
      const tracks = await searchTracks({
        clientId: SPOTIFY_CLIENT_ID,
        clientSecret: SPOTIFY_CLIENT_SECRET,
        genre,
        yearFrom,
        yearTo,
        difficulty,
        limit,
        offset,
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

  // Inject Supabase env vars into a browser-loadable config module.
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
  const pathParts = normalizedRelative.split(/[\\/]+/).filter(Boolean)
  if (pathParts.some((part) => part === '..' || part.startsWith('.'))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
    return
  }
  const filePath = join(root, normalizedRelative.replace(/^(\.\.[/\\])+/, ''))

  try {
    const body = await readFile(filePath)
    res.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
  }
})

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

startListening(port)
