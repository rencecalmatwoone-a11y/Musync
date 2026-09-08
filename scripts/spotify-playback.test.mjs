import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

let version = 0
async function withPlayer({ failures = [], tokenError = null } = {}, run) {
  let source = await readFile(new URL('../src/hooks/useTrackAudio.js', import.meta.url), 'utf8')
  source = source.replace(/^import .*$/gm, '')
  source = `
    const useCallback = (fn) => fn, useEffect = () => {}, useState = (value) => [value, () => {}];
    const spotifySessionHeaders = () => ({}), useAudioVolume = () => 1, getAudioVolume = () => 1;
    ${source}\n// test ${version++}
  `
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const requests = []
  let created = 0
  let disconnected = 0
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/spotify/playback-token')
    requests.push(options.headers)
    if (tokenError) return Response.json(tokenError, { status: 403 })
    return Response.json({ accessToken: `token-${requests.length}`, expiresAt: Date.now() + 3600000 })
  }
  globalThis.window = { Spotify: { Player: class {
    constructor(options) { this.options = options; this.listeners = {}; this.failure = failures[created++] }
    addListener(name, listener) { this.listeners[name] = listener }
    async connect() {
      await new Promise((resolve) => this.options.getOAuthToken(resolve))
      if (this.failure) this.listeners[this.failure]({ message: 'Fixture player error' })
      else this.listeners.ready({ device_id: 'device' })
      return true
    }
    async setVolume() {}
    disconnect() { disconnected++ }
  } } }
  try {
    const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
    await run(module.useSpotifyPlayback(false), { requests, created: () => created, disconnected: () => disconnected })
  } finally {
    globalThis.fetch = originalFetch
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }
}

test('match readiness refreshes an SDK-rejected token once and connects', async () => {
  await withPlayer({ failures: ['authentication_error'] }, async (player, observed) => {
    await Promise.all([player.ensureReady(), player.ensureReady()])
    assert.equal(observed.created(), 2)
    assert.equal(observed.disconnected(), 1)
    assert.equal(observed.requests.length, 2)
    assert.equal(observed.requests[1].Authorization, 'Bearer token-1')
    await player.ensureReady()
    assert.equal(observed.created(), 2)
    assert.equal(observed.requests.length, 2)
  })
})

test('persistent SDK authentication failure stops after one refresh', async () => {
  await withPlayer({ failures: ['authentication_error', 'authentication_error'] }, async (player, observed) => {
    await assert.rejects(player.ensureReady(), { code: 'SPOTIFY_SDK_AUTH_ERROR' })
    assert.equal(observed.created(), 2)
    assert.equal(observed.requests.length, 2)
  })
})

test('missing playback permissions reach the lobby without reconnect retries', async () => {
  await withPlayer({ tokenError: { code: 'SPOTIFY_SCOPE_REQUIRED', error: 'Reconnect Spotify to grant the required playback permissions.' } }, async (player, observed) => {
    await assert.rejects(player.ensureReady(), { code: 'SPOTIFY_SCOPE_REQUIRED' })
    assert.equal(observed.created(), 0)
    assert.equal(observed.requests.length, 1)
  })
})

test('device failures retain their cause and permit an explicit retry', async () => {
  await withPlayer({ failures: ['initialization_error'] }, async (player, observed) => {
    await assert.rejects(player.ensureReady(), /Fixture player error/)
    assert.equal(observed.created(), 1)
    await player.ensureReady()
    assert.equal(observed.created(), 2)
    assert.equal(observed.requests.length, 1)
  })
})
