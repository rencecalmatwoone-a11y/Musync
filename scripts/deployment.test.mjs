import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { readFile, readdir, access } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'

// Never load developer credentials or contact live providers in these tests.
process.env.VERCEL = '1'
process.env.SUPABASE_URL = 'https://database.example'
process.env.SUPABASE_ANON_KEY = 'public-test-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'private-test-key'
process.env.SPOTIFY_CLIENT_ID = 'test-client'
process.env.SPOTIFY_CLIENT_SECRET = 'test-secret'
process.env.PUBLIC_BASE_URL = 'https://musync.example'
process.env.SPOTIFY_PRODUCTION_REDIRECT_URI = 'https://musync.example/api/spotify/callback'
delete process.env.SPOTIFY_REDIRECT_URI

const nativeFetch = globalThis.fetch
const rows = new Map()
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input)
  if (url.hostname === '127.0.0.1') return nativeFetch(input, options)
  if (url.hostname === 'database.example') {
    assert.equal(options.headers.apikey, 'private-test-key')
    assert.equal(options.headers.Authorization, 'Bearer private-test-key')
    assert.equal(url.pathname, '/rest/v1/server_sessions')
    const id = url.searchParams.get('id')?.slice(3)
    if (options.method === 'POST') {
      const row = JSON.parse(options.body)
      rows.set(row.id, row)
      return new Response(null, { status: 201 })
    }
    const row = rows.get(id)
    const active = row && new Date(row.expires_at).getTime() > Date.now()
    if (options.method === 'DELETE') rows.delete(id)
    if (options.method === 'DELETE' && !options.headers.Prefer) return new Response(null, { status: 204 })
    return Response.json(active ? [{ data: structuredClone(row.data) }] : [])
  }
  if (url.href === 'https://accounts.spotify.com/api/token') {
    const refresh = new URLSearchParams(options.body).get('grant_type') === 'refresh_token'
    return Response.json({ access_token: refresh ? 'refreshed-access' : 'test-access', refresh_token: 'test-refresh', expires_in: 3600 })
  }
  if (url.href === 'https://api.spotify.com/v1/me') {
    return Response.json({ id: 'test-user', product: 'premium' })
  }
  throw new Error(`Unexpected external request: ${url.origin}${url.pathname}`)
}
after(() => { globalThis.fetch = nativeFetch })

const { default: handler } = await import('../api/index.js')
const { sessionStore } = await import('../server/services/sessionStore.js')
const spotify = await import('../server/services/spotify.js')

async function invoke(path, headers = {}, requestHandler = handler) {
  const result = { status: 200, headers: {}, body: '' }
  const response = {
    headersSent: false,
    setHeader(name, value) { result.headers[name.toLowerCase()] = value },
    writeHead(status, values = {}) {
      result.status = status
      for (const [name, value] of Object.entries(values)) this.setHeader(name, value)
      this.headersSent = true
    },
    end(body = '') { result.body = String(body) },
  }
  await requestHandler({ url: path, method: 'GET', headers: { host: 'musync.example', ...headers } }, response)
  return result
}

test('browser build contains only public assets and resolves local imports', async () => {
  const root = new URL('../dist/', import.meta.url)
  assert.deepEqual((await readdir(root)).sort(), ['index.html', 'public', 'src'])
  assert.match(await readFile(new URL('index.html', root), 'utf8'), /\/src\/main\.js/)
  await access(new URL('public/favicon.svg', root))
  const generated = new Set(['src/spotify/config.js', 'src/supabase/config.js'])
  async function check(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
      if (entry.isDirectory()) { await check(path); continue }
      assert.ok(!entry.name.startsWith('.'))
      if (!entry.name.endsWith('.js')) continue
      const body = await readFile(path, 'utf8')
      assert.ok(!body.includes('SUPABASE_SERVICE_ROLE_KEY'))
      for (const [, specifier] of body.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']/g)) {
        const target = new URL(specifier, path)
        if (!generated.has(target.href.slice(root.href.length))) await access(target)
      }
    }
  }
  await check(root)
  for (const path of generated) await assert.rejects(access(new URL(path, root)))
})

test('API adapter serves real HTTP requests without starting its own listener', async () => {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/spotify/status`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { configured: true, authed: false, profile: null })
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('runtime configuration exposes only public values; repository files stay private', async () => {
  const config = await invoke('/src/supabase/config.js')
  assert.equal(config.status, 200)
  assert.match(config.headers['content-type'], /javascript/)
  assert.match(config.body, /public-test-key/)
  assert.ok(!config.body.includes('private-test-key'))
  assert.ok(!config.body.includes('test-secret'))
  assert.equal(config.headers['cache-control'], 'no-store')
  for (const path of ['/.env', '/server/index.js', '/supabase/schema.sql', '/api/missing']) {
    assert.equal((await invoke(path)).status, 404)
  }
  assert.equal((await invoke('/%ZZ')).status, 400)
})

test('sessions survive a fresh store instance, expire, and can be consumed only once', async () => {
  const { sessionStore: coldStore } = await import('../server/services/sessionStore.js?cold')
  await sessionStore.set('oauth', 'state', { valid: true })
  assert.deepEqual(await coldStore.take('oauth', 'state'), { valid: true })
  assert.equal(await sessionStore.take('oauth', 'state'), null)
  await sessionStore.set('spotify', 'expired', { accessToken: 'expired' }, -1)
  assert.equal(await coldStore.get('spotify', 'expired'), null)
})

test('OAuth crosses function instances, binds to browser cookie, and rejects replay', async () => {
  const login = await invoke('/api/spotify/login')
  assert.equal(login.status, 302)
  assert.match(login.headers['set-cookie'], /HttpOnly; SameSite=Lax; Secure/)
  const authUrl = new URL(login.headers.location)
  assert.equal(authUrl.searchParams.get('redirect_uri'), process.env.SPOTIFY_PRODUCTION_REDIRECT_URI)
  const state = authUrl.searchParams.get('state')
  const callback = `/api/spotify/callback?state=${state}&code=test-code`
  assert.match((await invoke(callback)).headers.location, /spotify=error/)
  const cookie = login.headers['set-cookie'].split(';')[0]
  const { default: coldHandler } = await import('../server/index.js?cold')
  const result = await invoke(callback, { cookie }, coldHandler)
  const sessionId = new URL(result.headers.location, 'https://musync.example').searchParams.get('spotify_session')
  assert.ok(sessionId)
  assert.match(result.headers['set-cookie'], /Max-Age=0/)
  assert.match((await invoke(callback, { cookie })).headers.location, /spotify=error/)
  const headers = { 'x-musync-spotify-session': sessionId }
  assert.equal(JSON.parse((await invoke('/api/spotify/status', headers)).body).authed, true)
  assert.equal(JSON.parse((await invoke('/api/spotify/playback-token', headers)).body).accessToken, 'test-access')
  assert.equal((await invoke('/api/spotify/logout', headers)).status, 200)
  assert.equal(JSON.parse((await invoke('/api/spotify/status', headers)).body).authed, false)
})

test('refreshed Spotify tokens are persisted for the next function instance', async () => {
  await sessionStore.set('spotify', 'refresh-session', { accessToken: 'old', refreshToken: 'test-refresh', expiresAt: 0 })
  assert.equal(await spotify.getSpotifyPlaybackToken('refresh-session'), 'refreshed-access')
  const { sessionStore: coldStore } = await import('../server/services/sessionStore.js?refresh')
  assert.equal((await coldStore.get('spotify', 'refresh-session')).accessToken, 'refreshed-access')
})

test('Vercel fails explicitly if persistent session credentials are missing', async () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  try {
    await assert.rejects(sessionStore.set('oauth', 'test', {}), { code: 'SESSION_STORE_NOT_CONFIGURED' })
    assert.equal((await invoke('/api/spotify/login')).status, 503)
    // The public status endpoint still works before configuration.
    assert.equal((await invoke('/api/spotify/status')).status, 200)
  } finally {
    process.env.SUPABASE_SERVICE_ROLE_KEY = key
  }
})
