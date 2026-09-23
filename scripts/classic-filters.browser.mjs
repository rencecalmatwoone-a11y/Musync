// Exercise production Classic UI -> client -> HTTP route -> Spotify service.
// Only external Spotify responses and the SDK are simulated.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

process.env.VERCEL = '1'
process.env.SPOTIFY_CLIENT_ID = 'classic-browser-test'
process.env.SPOTIFY_CLIENT_SECRET = 'classic-browser-test'
delete process.env.SUPABASE_URL
delete process.env.SUPABASE_ANON_KEY
delete process.env.SUPABASE_SERVICE_ROLE_KEY
const { sessionStore } = await import('../server/services/sessionStore.js')
const session = 'classic-browser-session'
sessionStore.get = async (kind, id) => kind === 'spotify' && id === session ? {
  accessToken: 'fixture', expiresAt: Date.now() + 3600000,
  scope: 'streaming user-read-private user-read-email user-read-playback-state user-modify-playback-state',
} : null
const { default: handler } = await import('../server/index.js')
// Configuration was loaded without .env; now enable local static-file serving.
delete process.env.VERCEL
const { opmReferenceOrder } = await import('../server/services/opmCatalog.js')
const nativeFetch = globalThis.fetch
const searchCalls = []
const playbackCalls = []
const artistCalls = []
let denySearch = false
globalThis.fetch = async (input, options) => {
  const url = new URL(input)
  if (url.hostname !== 'api.spotify.com') return nativeFetch(input, options)
  assert.equal(options.headers.Authorization, 'Bearer fixture')
  if (url.pathname === '/v1/me') return Response.json({ id: 'fixture-user', product: 'premium' })
  if (url.pathname.startsWith('/v1/artists/')) {
    artistCalls.push(url.pathname)
    return Response.json({ error: { message: 'Metadata unavailable' } }, { status: 403 })
  }
  assert.equal(url.pathname, '/v1/search')
  const query = url.searchParams.get('q')
  searchCalls.push(query)
  if (denySearch) return Response.json({ error: { message: 'Search unavailable' } }, { status: 403 })
  const reference = opmReferenceOrder(session).find((song) => query.startsWith(`track:"${song.title}" artist:"${song.artist}"`))
  const id = createHash('sha256').update(query).digest('hex').slice(0, 22)
  const year = reference ? 2024 : Number(query.match(/year:(\d{4})/)?.[1] || 2024)
  const raw = {
    id, name: reference?.title || `Song ${id}`, uri: `spotify:track:${id}`,
    artists: [{ id: 'artist-' + id, name: reference?.artist || 'International Artist' }],
    album: { release_date: `${year}-01-01` }, is_playable: true, duration_ms: 180000,
  }
  return Response.json({ tracks: { items: reference ? [raw] : [
    raw,
    { ...raw, id: 'blocked', is_playable: false },
    { ...raw, id: 'opm', artists: [{ id: 'local', name: 'BINI' }] },
  ], next: null } })
}

const appSource = (await readFile(new URL('../src/App.js', import.meta.url), 'utf8'))
  .replace('const classicDuration =', 'window.__classicTest = { track: classicTrack, loading: classicPoolLoading }; const classicDuration =')
const server = createServer((req, res) => {
  if (req.url === '/src/App.js') {
    res.setHeader('Content-Type', 'text/javascript')
    res.end(appSource)
  } else void handler(req, res)
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`
const { chromium } = await import(process.env.MUSYNC_PLAYWRIGHT ? pathToFileURL(resolve(process.env.MUSYNC_PLAYWRIGHT)).href : 'playwright')
const browser = await chromium.launch({ channel: process.env.MUSYNC_BROWSER || 'chrome', headless: true })
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript((sessionId) => {
    sessionStorage.setItem('musync-spotify-tab-session', sessionId)
    localStorage.setItem('musync-mode', JSON.stringify('classic'))
    localStorage.setItem('musync-spotify-debug', 'off')
    window.Spotify = { Player: class {
      constructor(options) { this.options = options; this.listeners = {}; window.__sdkPlayer = this }
      addListener(event, fn) { this.listeners[event] = fn }
      async connect() { await new Promise((resolve) => this.options.getOAuthToken(resolve)); this.listeners.ready({ device_id: 'fixture-device' }); return true }
      activateElement() { this.activated = navigator.userActivation.isActive }
      async setVolume() {}
      disconnect() {}
      async getCurrentState() { return this.state || null }
    } }
  }, session)
  await page.route('https://esm.sh/**', async (route) => {
    const response = await nativeFetch(route.request().url())
    assert.ok(response.ok)
    await route.fulfill({ contentType: 'text/javascript', body: await response.text(), headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  await page.route('https://api.spotify.com/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/play')) {
      const body = route.request().postDataJSON()
      playbackCalls.push(body.uris[0])
      await page.evaluate(({ id, position }) => {
        const player = window.__sdkPlayer
        if (!player.activated) return player.listeners.autoplay_failed?.()
        player.state = { paused: false, position, track_window: { current_track: { id } } }
        player.listeners.player_state_changed(player.state)
      }, { id: body.uris[0].split(':').at(-1), position: body.position_ms })
    }
    await route.fulfill({ status: 204 })
  })
  await page.goto(base)
  async function playCurrent() {
    await page.waitForFunction(() => window.__classicTest?.track && !window.__classicTest.loading && !document.querySelector('.play-btn').disabled)
    const track = await page.evaluate(() => window.__classicTest.track)
    assert.equal(track.provider, 'spotify')
    assert.equal(track.playbackType, 'spotify-sdk')
    await page.getByRole('button', { name: 'Play clip', exact: true }).click()
    await page.getByRole('button', { name: 'Pause clip', exact: true }).waitFor()
    assert.equal(playbackCalls.at(-1), `spotify:track:${track.id}`)
    await page.getByRole('button', { name: 'Play clip', exact: true }).waitFor()
    return track
  }
  async function changeFilter(name) {
    const before = await page.evaluate(() => window.__classicTest.track?.id)
    await page.getByRole('button', { name, exact: true }).click()
    await page.waitForFunction((id) => window.__classicTest?.track && window.__classicTest.track.id !== id, before)
    return playCurrent()
  }
  await playCurrent()
  for (const genre of ['Pop', 'Rock', 'Hip-Hop', 'R&B', 'Electronic', 'Latin', 'Country']) {
    assert.equal((await changeFilter('Next genre')).genre, genre)
  }
  await changeFilter('Next genre') // Any Genre
  for (const year of [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020]) {
    const track = await changeFilter('Next era')
    assert.equal(Number(track.releaseDate.slice(0, 4)), year)
  }
  assert.equal((await changeFilter('Next genre')).genre, 'Pop')
  assert.ok(searchCalls.includes('genre:pop year:2020-2029'))
  assert.equal((await changeFilter('Next songs')).musicOrigin, 'OPM')
  assert.equal((await changeFilter('Next songs')).musicOrigin, 'International')
  assert.equal(artistCalls.length, 0, 'Artist requests must never block Classic filters')
  // An actual provider failure must remain visible.
  denySearch = true
  await page.getByRole('button', { name: 'Next genre', exact: true }).click()
  await page.getByRole('button', { name: 'Retry songs', exact: true }).waitFor()
  await page.locator('.audio-status').filter({ hasText: 'Search unavailable' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Play clip', exact: true }).isDisabled(), true)
  assert.deepEqual(errors, [])
  console.log(`PASS: real Classic API, initial playback, all seven genres, all eight eras, combined filters, both origins, ${playbackCalls.length} successful SDK starts, and visible provider errors`)
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
  globalThis.fetch = nativeFetch
}
