import assert from 'node:assert/strict'
import { test, after } from 'node:test'

// No developer credentials or live providers. Deployment tests cover the
// persistent store; these tests exercise the real Spotify request/token flow.
process.env.VERCEL = '1'
process.env.SPOTIFY_CLIENT_ID = 'auth-test'
process.env.SPOTIFY_CLIENT_SECRET = 'auth-secret'
const { sessionStore } = await import('../server/services/sessionStore.js')
const sessions = new Map()
sessionStore.get = async (kind, id) => structuredClone(sessions.get(`${kind}:${id}`) || null)
sessionStore.set = async (kind, id, data) => { sessions.set(`${kind}:${id}`, structuredClone(data)) }
sessionStore.delete = async (kind, id) => { sessions.delete(`${kind}:${id}`) }
const spotify = await import('../server/services/spotify.js')
const originalFetch = globalThis.fetch
after(() => { globalThis.fetch = originalFetch })
const scopes = 'streaming user-read-private user-read-email user-read-playback-state user-modify-playback-state'
const calls = []
let denied = false
let rejectOnce = false
let alwaysUnauthorized = false
let grantFailure = false
const rawTrack = (id) => ({ id, name: `Song ${id}`, artists: [{ id: 'artist', name: 'Artist' }], album: { release_date: '2020-01-01' }, duration_ms: 200000 })
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input)
  calls.push({ path: url.pathname, query: url.searchParams, authorization: options.headers.Authorization, body: options.body })
  if (url.hostname === 'accounts.spotify.com') {
    assert.equal(options.headers.Authorization, `Basic ${Buffer.from('auth-test:auth-secret').toString('base64')}`)
    const grant = new URLSearchParams(options.body).get('grant_type')
    if (grantFailure) return Response.json({ error: 'invalid_grant' }, { status: 400 })
    return Response.json({ access_token: grant === 'client_credentials' ? 'app-token' : grant === 'refresh_token' ? 'fresh-user' : 'oauth-user', refresh_token: 'rotated-refresh', scope: scopes, expires_in: 3600 })
  }
  assert.equal(url.hostname, 'api.spotify.com')
  assert.match(options.headers.Authorization, /^Bearer /)
  if (denied) return new Response('The user is not registered for this application. Please check your settings on https://developer.spotify.com/dashboard.', { status: 403 })
  if (rejectOnce || alwaysUnauthorized) { rejectOnce = false; return Response.json({ error: { message: 'Expired token' } }, { status: 401 }) }
  if (url.pathname === '/v1/search') {
    assert.ok(Number(url.searchParams.get('limit')) <= 10)
    return Response.json({ tracks: { items: [rawTrack(options.headers.Authorization), { ...rawTrack('blocked'), is_playable: false }] } })
  }
  if (url.pathname === '/v1/artists/artist') return Response.json({ id: 'artist', genres: ['pop'] })
  if (url.pathname.startsWith('/v1/tracks/')) return Response.json(rawTrack(url.pathname.split('/').at(-1)))
  throw new Error(`Unnecessary/unsupported endpoint ${url.pathname}`)
}
const credentials = { clientId: 'auth-test', clientSecret: 'auth-secret' }
const search = (options = {}) => spotify.searchTracks({ ...credentials, musicOrigin: 'Any', ...options })
async function seed(id, data = {}) {
  await sessionStore.set('spotify', id, { accessToken: `user-${id}`, refreshToken: 'refresh', expiresAt: Date.now() + 3600000, scope: scopes, ...data })
}

test('OAuth stores granted scopes and tokens; Classic/SDK reuse user token without /me or token refresh', async () => {
  const sessionId = await spotify.exchangeCode({ ...credentials, code: 'code', redirectUri: 'https://musync.example/api/spotify/callback' })
  const stored = await sessionStore.get('spotify', sessionId)
  assert.equal(stored.scope, scopes)
  assert.equal(stored.refreshToken, 'rotated-refresh')
  const before = calls.length
  const tracks = await search({ sessionId, requireUser: true, limit: 50 })
  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].provider, 'spotify')
  assert.equal(tracks[0].playbackType, 'spotify-sdk')
  assert.equal(tracks[0].playbackUrl, null)
  assert.equal((await spotify.getSpotifyPlaybackCredentials(sessionId)).accessToken, 'oauth-user')
  assert.deepEqual(await spotify.getSpotifyPlaybackEligibility(sessionId), { authenticated: true, premium: null })
  assert.deepEqual(calls.slice(before).map((c) => [c.path, c.authorization]), [['/v1/search', 'Bearer oauth-user']])
})

test('Classic requires a user token; app credentials are used only for unauthenticated catalog requests', async () => {
  const before = calls.length
  await assert.rejects(search({ sessionId: 'missing', requireUser: true }), { code: 'SPOTIFY_LOGIN_REQUIRED' })
  await assert.rejects(spotify.getSpotifyPlaybackToken('missing'), { code: 'SPOTIFY_LOGIN_REQUIRED' })
  assert.equal(calls.length, before)
  await search({ offset: 10 })
  assert.equal(calls.at(-1).authorization, 'Bearer app-token')
})

test('user pools are isolated across accounts and origin metadata uses supported single artist endpoint', async () => {
  await seed('one'); await seed('two')
  const one = await search({ sessionId: 'one', requireUser: true, musicOrigin: 'International' })
  const two = await search({ sessionId: 'two', requireUser: true, musicOrigin: 'International' })
  assert.notEqual(one[0].id, two[0].id)
  assert.equal(one[0].musicOrigin, 'International')
  assert.ok(calls.some((c) => c.path === '/v1/artists/artist'))
  const before = calls.length
  await spotify.searchCatalog({ ...credentials, sessionId: 'one', query: 'Song' })
  await spotify.getTracksByIds({ ...credentials, sessionId: 'one', ids: ['track1', 'track2'] })
  assert.deepEqual(calls.slice(before).map((c) => c.path), ['/v1/search', '/v1/tracks/track1', '/v1/tracks/track2'])
})

test('plain-text allowlist 403 is actionable and never refreshed, retried, or downgraded to app credentials', async () => {
  await seed('denied')
  const before = calls.length
  denied = true
  try {
    for (const offset of [0, 10]) await assert.rejects(search({ sessionId: 'denied', requireUser: true, offset }), (error) => {
      assert.equal(error.status, 403)
      assert.equal(error.code, 'SPOTIFY_USER_NOT_ALLOWLISTED')
      assert.match(error.message, /user is not registered/)
      return true
    })
  } finally { denied = false }
  assert.deepEqual(calls.slice(before).map((c) => c.path), ['/v1/search'])
})

test('expiration refresh is deduplicated and persisted; a 401 refreshes only once', async () => {
  await seed('expired', { expiresAt: 0 })
  const before = calls.length
  assert.deepEqual(await Promise.all(Array.from({ length: 5 }, () => spotify.getSpotifyPlaybackToken('expired'))), Array(5).fill('fresh-user'))
  assert.equal(calls.length - before, 1)
  assert.equal((await sessionStore.get('spotify', 'expired')).refreshToken, 'rotated-refresh')
  await seed('rejected')
  rejectOnce = true
  const start = calls.length
  await search({ sessionId: 'rejected', requireUser: true })
  assert.deepEqual(calls.slice(start).map((c) => c.path), ['/v1/search', '/api/token', '/v1/search'])
  await seed('still-rejected')
  const failedStart = calls.length
  alwaysUnauthorized = true
  try { await assert.rejects(search({ sessionId: 'still-rejected', requireUser: true }), { status: 401 }) }
  finally { alwaysUnauthorized = false }
  assert.equal(calls.length - failedStart, 3)
})

test('revoked sessions, missing scopes, and changed client configuration fail explicitly', async () => {
  await seed('revoked', { expiresAt: 0 })
  grantFailure = true
  try { await assert.rejects(search({ sessionId: 'revoked', requireUser: true }), { code: 'SPOTIFY_LOGIN_REQUIRED' }) }
  finally { grantFailure = false }
  assert.equal(await sessionStore.get('spotify', 'revoked'), null)
  await seed('scopes', { scope: 'user-read-private' })
  await assert.rejects(spotify.getSpotifyPlaybackToken('scopes'), { code: 'SPOTIFY_SCOPE_REQUIRED', status: 403 })
  await seed('changed-app', { clientId: 'old-client' })
  await assert.rejects(spotify.getSpotifyPlaybackToken('changed-app'), { code: 'SPOTIFY_LOGIN_REQUIRED' })
})
