import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('guests avoid session storage requests while OAuth sessions still restore', async () => {
  let source = await readFile(new URL('../src/spotify/client.js', import.meta.url), 'utf8')
  source = source.replace(source.split(/\r?\n/)[0], 'const isSpotifyConfigured = true, isSpotifyAuthed = false')
  for (const name of ['tracks', 'popularTracks']) source = source.replace(`../data/${name}.js`, new URL(`../src/data/${name}.js`, import.meta.url).href)
  const originals = Object.fromEntries(['fetch', 'window', 'sessionStorage'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const key = 'musync-spotify-tab-session'
  const oauthSession = 'a'.repeat(48)
  try {
    for (const scenario of ['fresh', 'legacy', 'saved', 'callback']) {
      const values = new Map()
      if (scenario === 'legacy') values.set(key, '12345678-1234-4123-8123-123456789abc')
      if (scenario === 'saved') values.set(key, oauthSession)
      let cleanedUrl
      Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
      } })
      globalThis.window = {
        location: { pathname: '/', search: scenario === 'callback' ? `?spotify=auth&spotify_session=${oauthSession}` : '', hash: '' },
        history: { replaceState: (_state, _title, url) => { cleanedUrl = url } },
      }
      const requests = []
      globalThis.fetch = async (url, options) => {
        requests.push({ url, headers: options.headers })
        return Response.json({ configured: true, authed: true })
      }
      const client = await import(`data:text/javascript;base64,${Buffer.from(source + `\n// ${scenario}`).toString('base64')}`)
      const authenticated = ['saved', 'callback'].includes(scenario)
      assert.equal((await client.getSpotifyAuthStatus()).authed, authenticated)
      assert.equal((await client.getSpotifyAuthStatus()).authed, authenticated)
      assert.equal(requests.length, authenticated ? 1 : 0)
      assert.deepEqual(client.spotifySessionHeaders(), authenticated ? { 'X-Musync-Spotify-Session': oauthSession } : {})
      assert.equal(values.get(key), authenticated ? oauthSession : undefined)
      if (authenticated) assert.equal(requests[0].url, '/api/spotify/status')
      if (scenario === 'callback') assert.equal(cleanedUrl, '/?spotify=auth')
    }
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})

test('logout switches to guest and ignores pending authenticated status', async () => {
  let source = await readFile(new URL('../src/spotify/client.js', import.meta.url), 'utf8')
  source = source.replace(source.split(/\r?\n/)[0], 'const isSpotifyConfigured = true, isSpotifyAuthed = true')
  for (const name of ['tracks', 'popularTracks']) source = source.replace(`../data/${name}.js`, new URL(`../src/data/${name}.js`, import.meta.url).href)
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const events = []
  globalThis.window = { dispatchEvent: (event) => events.push(event) }
  let release
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return new Promise((resolve) => { release = () => resolve(Response.json({ authed: true })) })
  }
  try {
    const client = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
    const pending = client.getSpotifyAuthStatus()
    client.clearSpotifyClientSession()
    assert.equal((await client.getSpotifyAuthStatus()).authed, false)
    release()
    assert.equal((await pending).authed, false)
    assert.equal((await client.getSpotifyAuthStatus()).authed, false)
    assert.equal(calls, 1)
    assert.equal(events[0].type, 'musync:spotify-auth-changed')
    assert.equal(events[0].detail.authed, false)
  } finally {
    globalThis.fetch = originalFetch
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }
})
