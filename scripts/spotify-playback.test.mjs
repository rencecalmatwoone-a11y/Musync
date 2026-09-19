import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

let version = 0
async function withPlayer({ failures = [], tokenError = null, emitState = true, pollState = false, playbackStatus = 204 } = {}, run) {
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
  const commands = []
  let sdkPlayer
  let activations = 0
  let created = 0
  let disconnected = 0
  globalThis.fetch = async (url, options) => {
    if (url.startsWith('https://api.spotify.com/')) {
      commands.push({ url, body: options.body ? JSON.parse(options.body) : null })
      if (url.includes('/player/play?')) {
        if (playbackStatus !== 204) return Response.json({ error: { message: 'Fixture playback denied' } }, { status: playbackStatus })
        const id = JSON.parse(options.body).uris[0].split(':').at(-1)
        if (!activations) sdkPlayer.listeners.autoplay_failed()
        else {
          const state = { paused: false, position: JSON.parse(options.body).position_ms, track_window: { current_track: { id } } }
          if (pollState) sdkPlayer.state = state
          if (emitState) sdkPlayer.listeners.player_state_changed(state)
        }
      }
      return new Response(null, { status: 204 })
    }
    assert.equal(url, '/api/spotify/playback-token')
    requests.push(options.headers)
    if (tokenError) return Response.json(tokenError, { status: 403 })
    return Response.json({ accessToken: `token-${requests.length}`, expiresAt: Date.now() + 3600000 })
  }
  globalThis.window = { Spotify: { Player: class {
    constructor(options) { this.options = options; this.listeners = {}; this.failure = failures[created++]; sdkPlayer = this }
    addListener(name, listener) { this.listeners[name] = listener }
    async connect() {
      await new Promise((resolve) => this.options.getOAuthToken(resolve))
      if (this.failure) this.listeners[this.failure]({ message: 'Fixture player error' })
      else this.listeners.ready({ device_id: 'device' })
      return true
    }
    async setVolume() {}
    activateElement() { activations++; return Promise.resolve() }
    async getCurrentState() { return this.state || null }
    disconnect() { disconnected++ }
  } } }
  try {
    const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
    await run(module.useSpotifyPlayback(false), { requests, commands, created: () => created, disconnected: () => disconnected,
      activations: () => activations, emit: (event, state) => sdkPlayer.listeners[event](state), snapshot: () => module.useSpotifyPlayback(false) })
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

test('Classic unlocks audio within the Play click and targets its own Spotify device', async () => {
  await withPlayer({}, async (player, observed) => {
    await player.ensureReady()
    const playing = player.playTrack('opm-hit', { classic: true, positionMs: 500 })
    assert.equal(observed.activations(), 1, 'activation must happen before the first await')
    assert.equal(await playing, true)
    assert.deepEqual(observed.commands[1].body, { uris: ['spotify:track:opm-hit'], position_ms: 500 })
    assert.match(observed.commands[1].url, /device_id=device/)
    await player.pause()
    assert.match(observed.commands.at(-1).url, /player\/pause\?device_id=device/)
  })
})

test('Classic waits for actual SDK playback after a successful HTTP command', async () => {
  await withPlayer({ emitState: false }, async (player, observed) => {
    await player.ensureReady()
    let resolved = false
    const playing = player.playTrack('opm-hit', { classic: true }).then((value) => { resolved = true; return value })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(observed.commands.length, 2)
    assert.equal(resolved, false, '204 must not start the half-second clip timer')
    observed.emit('player_state_changed', { paused: false, track_window: { current_track: { id: 'another-track' } } })
    await Promise.resolve()
    assert.equal(resolved, false)
    observed.emit('player_state_changed', { paused: false, track_window: { current_track: { id: 'opm-hit' } } })
    assert.equal(await playing, true)
  })
})

test('same-track replay confirms SDK state when no new playback event arrives', async () => {
  await withPlayer({ emitState: false, pollState: true }, async (player, observed) => {
    await player.ensureReady()
    assert.equal(await player.playTrack('opm-hit', { classic: true }), true)
    await player.pause()
    assert.equal(await player.playTrack('opm-hit', { classic: true, positionMs: 2000 }), true)
    assert.equal(observed.commands.filter((command) => command.url.endsWith('/me/player')).length, 1)
  })
})

test('browser blocks and API playback failures do not start the clip timer', async () => {
  await withPlayer({ emitState: false }, async (player, observed) => {
    await player.ensureReady()
    const playing = player.playTrack('opm-hit', { classic: true })
    await new Promise((resolve) => setImmediate(resolve))
    observed.emit('autoplay_failed')
    assert.equal(await playing, false)
    assert.match(observed.snapshot().error, /Tap Play/)
  })
  await withPlayer({ playbackStatus: 403 }, async (player, observed) => {
    await player.ensureReady()
    assert.equal(await player.playTrack('opm-hit', { classic: true }), false)
    assert.match(observed.snapshot().error, /Fixture playback denied/)
  })
})
