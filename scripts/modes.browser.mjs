// Run with Playwright installed, or MUSYNC_PLAYWRIGHT pointing to its index.mjs.
// Provider/auth/database fixtures are local; production components and game hooks run unchanged.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { once } from 'node:events'
import { resolve, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const { chromium } = await import(process.env.MUSYNC_PLAYWRIGHT ? pathToFileURL(resolve(process.env.MUSYNC_PLAYWRIGHT)).href : 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const tracks = Array.from({ length: 30 }, (_, i) => ({
  id: `track${i}`, providerTrackId: `track${i}`, title: `Song ${i}`, artist: `Artist ${i}`,
  album: 'Test Album', artwork: '/public/favicon.svg', externalUrl: `https://open.spotify.com/track/track${i}`,
  difficulty: 1, popularity: 90 - i, provider: 'spotify', source: 'spotify',
  playbackType: 'spotify-sdk', playbackUrl: null,
}))
const db = { lobby_members: [], lobbies: [], game_sessions: [], session_rounds: [], session_players: [], player_answers: [], match_results: [], leaderboard: [] }
let version = 0
const rpcLog = []
function rpc(name, args, user) {
  rpcLog.push({ name, user, args })
  version++
  const lobby = db.lobbies[0]
  const session = db.game_sessions[0]
  if (name === 'create_lobby') {
    const row = { id: 'lobby', code: 'ABCDEF', host_id: user, status: 'lobby' }
    db.lobbies = [row]
    db.lobby_members = [{ id: user, user_id: user, display_name: args.p_display_name, host: true, ready: false, lobby_id: row.id }]
    return row
  }
  if (name === 'join_lobby') {
    assert.equal(args.p_code, lobby.code)
    db.lobby_members.push({ id: user, user_id: user, display_name: args.p_display_name, host: false, ready: false, lobby_id: lobby.id })
    return lobby
  }
  if (name === 'set_ready') { db.lobby_members.find((m) => m.user_id === user).ready = args.p_ready; return null }
  if (name === 'start_match') {
    assert.equal(user, lobby.host_id)
    assert.equal(db.lobby_members.length, 2)
    assert.ok(db.lobby_members.every((m) => m.ready))
    assert.equal(new Set(args.p_song_order.map((t) => t.id)).size, 10)
    assert.ok(args.p_song_order.every((t) => t.provider === 'spotify' && t.playbackType === 'spotify-sdk' && !t.playbackUrl))
    db.game_sessions = [{ id: 'session', lobby_id: lobby.id, current_round: 1, status: 'live', round_end_at: new Date(Date.now() + 10000).toISOString() }]
    db.session_rounds = args.p_song_order.map((track, i) => ({ session_id: 'session', round_number: i + 1, track }))
    db.session_players = db.lobby_members.map((m) => ({ ...m, session_id: 'session', score: 0, streak: 0, correct: 0, asked: 0 }))
    lobby.status = 'live'
    return 'session'
  }
  if (name === 'submit_answer') {
    assert.ok(!db.player_answers.some((a) => a.user_id === user && a.round_number === args.p_round_number))
    const track = db.session_rounds[args.p_round_number - 1].track
    assert.equal(args.p_is_correct, args.p_answer_id === track.id)
    const player = db.session_players.find((p) => p.user_id === user)
    player.asked++; player.correct += Number(args.p_is_correct); player.score += args.p_points
    db.player_answers.push({ session_id: 'session', user_id: user, round_number: args.p_round_number, answer_id: args.p_answer_id, is_correct: args.p_is_correct, points: args.p_points })
    return null
  }
  if (name === 'advance_round') {
    assert.equal(user, lobby.host_id)
    if (session.current_round < 10) {
      session.current_round++
      session.round_end_at = new Date(Date.now() + 10000).toISOString()
    } else {
      session.status = 'finished'
      db.match_results = db.session_players.map((p, i) => ({ ...p, rank: i + 1 }))
    }
    return null
  }
  if (name === 'leave_lobby') return null
  throw new Error(`Unexpected RPC ${name}`)
}
const clientFixture = `
const user = { id: new URLSearchParams(location.search).get('user') || 'host', email: 'player@example.test', is_anonymous: false }
async function request(data) { return (await fetch('/test/db', { method: 'POST', body: JSON.stringify({ ...data, user: user.id }) })).json() }
const client = {
  auth: { getSession: async () => ({ data: { session: { user } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  rpc: (name, args) => request({ name, args }),
  from(table) {
    const query = { table, filters: [] }
    const builder = {
      select() { return this }, eq(k, v) { query.filters.push([k, v]); return this },
      order() { return this }, limit() { return this }, single() { query.single = true; return this }, maybeSingle() { query.single = true; return this },
      then(a, b) { return request(query).then(a, b) }
    }; return builder
  }
}
export const isSupabaseConfigured = true
export const getSupabase = () => client
export const ensureSupabase = async () => client
`
const realtimeFixture = `
function subscribe(callback, session) {
  let revision = -1
  const id = setInterval(async () => {
    const state = await (await fetch('/test/state')).json()
    if (revision === state.version) return
    revision = state.version
    if (session) {
      callback({ table: 'game_sessions', new: state.session || {} })
      callback({ table: 'session_players', new: {} })
    } else callback({})
  }, 100)
  return () => clearInterval(id)
}
export const subscribeLobby = async (_, callback) => subscribe(callback, false)
export const subscribeSession = async (_, callback) => subscribe(callback, true)
`
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    const json = (data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)) }
    if (url.pathname === '/test/state') return json({ version, session: db.game_sessions[0] })
    if (url.pathname === '/test/db') {
      let body = ''; for await (const part of req) body += part
      const query = JSON.parse(body)
      if (query.name) return json({ data: rpc(query.name, query.args, query.user), error: null })
      const rows = query.table === 'profiles' ? [{ id: query.user, display_name: query.user }] : db[query.table] || []
      const data = rows.filter((r) => query.filters.every(([k, v]) => r[k] === v))
      return json({ data: query.single ? data[0] || null : data, error: null })
    }
    let path = url.pathname === '/' ? '/index.html' : url.pathname
    if (path === '/src/supabase/client.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(clientFixture) }
    if (path === '/src/supabase/realtime.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(realtimeFixture) }
    if (path === '/src/spotify/config.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end('export const isSpotifyConfigured = true; export const isSpotifyAuthed = true') }
    const file = resolve(root, `.${path}`)
    if (!file.startsWith(root)) { res.statusCode = 404; return res.end() }
    let body = await readFile(file)
    if (path === '/src/App.js') {
      // Read-only test observability; state setters and answer functions stay original.
      body = body.toString().replace('const multiplayer =', 'window.__game = { game, onlineLobby, onlineGame, classicTrack, score, correct, attempts, classicStats }; const multiplayer =')
    }
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream')
    res.end(body)
  } catch (e) { res.statusCode = 500; res.end(e.message) }
})
server.listen(0, '127.0.0.1'); await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ channel: process.env.MUSYNC_BROWSER || 'chrome', headless: true })
const cdnCache = new Map()
const errors = []
async function newPage(user = 'host', mode = 'multiplayer', failure = null) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  const requests = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(({ mode, user, failure }) => {
    localStorage.setItem('musync-mode', JSON.stringify(mode))
    localStorage.setItem('musync-name', JSON.stringify(user))
    localStorage.setItem('musync-spotify-debug', 'off')
    if (mode === 'classic') {
      // Legacy demo counters must not become earned statistics.
      for (const [name, value] of Object.entries({ round: 4, score: 1250, streak: 5, correct: 23, attempts: 25 })) localStorage.setItem(`musync-${name}`, JSON.stringify(value))
    }
    window.__sdk = { created: 0, disconnected: 0, activated: 0 }
    window.Spotify = { Player: class {
      constructor() { this.listeners = {}; this.number = ++window.__sdk.created; window.__sdk.player = this }
      addListener(name, fn) { this.listeners[name] = fn }
      async connect() {
        if (failure === 'connect' && this.number === 1) {
          queueMicrotask(() => this.listeners.initialization_error({ message: 'Fixture device failure after connect' }))
          return true
        }
        this.listeners.ready({ device_id: 'test-device' }); return true
      }
      disconnect() { window.__sdk.disconnected++ }
      async setVolume() {}
      activateElement() { if (navigator.userActivation.isActive) window.__sdk.activated++ }
    } }
    // Playback calls are observed; a separate live test verifies real Deezer bytes.
    window.__media = []
    HTMLMediaElement.prototype.play = async function () { window.__media.push(this.src); this.dispatchEvent(new Event('play')) }
    HTMLMediaElement.prototype.pause = function () {}
    HTMLMediaElement.prototype.load = function () {}
  }, { mode, user, failure })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'esm.sh') {
      if (!cdnCache.has(url.href)) cdnCache.set(url.href, fetch(url).then(async (r) => { assert.ok(r.ok); return r.text() }))
      return route.fulfill({ contentType: 'text/javascript', body: await cdnCache.get(url.href), headers: { 'Access-Control-Allow-Origin': '*' } })
    }
    if (url.pathname.startsWith('/api/') || url.hostname === 'api.spotify.com') {
      requests.push(url.href)
      const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      if (url.pathname === '/api/spotify/status') return reply({ configured: true, authed: true })
      if (url.pathname === '/api/spotify/eligibility') return reply({ authenticated: true, premium: true })
      if (url.pathname === '/api/spotify/playback-token') return reply({ accessToken: 'fixture', expiresAt: Date.now() + 3600000 })
      if (url.pathname === '/api/spotify/tracks') {
        if (failure === 'quota') return reply({ code: 'SPOTIFY_QUOTA_EXCEEDED', error: 'Spotify quota exceeded' }, 503)
        const offset = Number(url.searchParams.get('offset'))
        if (failure === 'slow-catalog') await new Promise((resolve) => setTimeout(resolve, 700))
        const musicOrigin = url.searchParams.get('musicOrigin')
        const pool = musicOrigin ? tracks.filter((_, i) => musicOrigin === 'OPM' ? i % 2 === 1 : i % 2 === 0) : tracks
        return reply({ tracks: pool.slice(offset, offset + Number(url.searchParams.get('limit'))).map((t) => ({ ...t, musicOrigin })) })
      }
      if (url.pathname === '/api/vs-audio-tracks') return reply({ tracks: tracks.map((t) => ({ ...t, provider: 'deezer', source: 'vs-audio-catalog', playbackType: 'preview' })) })
      if (url.pathname === '/api/vs-audio-preview') {
        if (failure === 'missing-page' && Number(url.searchParams.get('trackId').replace('track', '')) < 10) return reply({ preview: null })
        if (failure === 'slow-preview' && requests.filter((u) => u.includes('/api/vs-audio-preview?')).length === 1) {
          await new Promise((resolve) => setTimeout(resolve, 3000))
          return reply({ preview: null })
        }
        return reply({ preview: { provider: 'deezer', previewUrl: `/api/audio-preview?url=${encodeURIComponent('https://cdn.dzcdn.net/' + url.searchParams.get('trackId') + '.mp3')}`, duration: 30000 } })
      }
      if (url.pathname === '/api/audio-preview') return route.fulfill({ contentType: 'audio/mpeg', body: Buffer.alloc(0) })
      if (url.pathname === '/api/catalog/search') return reply({ tracks })
      if (url.hostname === 'api.spotify.com') {
        if (url.pathname === '/v1/me/player/play') {
          const id = route.request().postDataJSON().uris[0].split(':').at(-1)
          await page.evaluate(({ id, classic }) => {
            const listeners = window.__sdk.player.listeners
            if (classic && !window.__sdk.activated) listeners.autoplay_failed?.()
            else listeners.player_state_changed?.({ paused: false, track_window: { current_track: { id } } })
          }, { id, classic: mode === 'classic' })
        }
        return route.fulfill({ status: 204 })
      }
      throw new Error(`Unexpected API ${url.pathname}`)
    }
    if (url.origin === base) return route.continue()
    return route.abort()
  })
  await page.goto(`${base}/?user=${user}`)
  await page.waitForFunction(() => window.__game)
  return { page, context, requests }
}
async function practice(page) {
  await page.getByRole('button').filter({ hasText: 'PRACTICE VS AI' }).click()
  await page.getByRole('button', { name: /START PRACTICE/ }).click()
  await page.waitForFunction(() => window.__game.game.phase === 'playing')
}
async function layout(page) {
  for (const width of [320, 375, 600, 768, 820, 1024, 1100, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    const valid = await page.locator('.standings').evaluate((section) => {
      const [player, score] = [...section.querySelectorAll('.standings-head span')].map((n) => n.getBoundingClientRect())
      return player.right + 5 <= score.left && [...section.querySelectorAll('.standings-row')].every((row) => {
        const name = row.querySelector('.standings-meta').getBoundingClientRect()
        const score = row.querySelector('.standings-score').getBoundingClientRect()
        return name.right + 5 <= score.left && row.scrollWidth <= row.clientWidth
      })
    })
    assert.ok(valid, `Standings overlap at ${width}px`)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
}
try {
  if (process.argv.includes('--startup-only')) {
    const startup = await newPage('startup', 'multiplayer', 'missing-page')
    await practice(startup.page)
    assert.ok(Number((await startup.page.evaluate(() => window.__game.game.currentSongId)).replace('track', '')) >= 10)
    assert.equal(startup.requests.filter((url) => url.includes('/api/spotify/tracks?')).length, 2)
    const previews = startup.requests.filter((url) => url.includes('/api/vs-audio-preview?'))
    assert.equal(new Set(previews).size, previews.length, 'unplayable first-page previews must not be fetched again')
    assert.deepEqual(errors, [])
    console.log('PASS: VS AI searches the next catalog page automatically when the first page has no playable previews; no duplicate preview requests')
    await startup.context.close()
  } else {
  if (!process.argv.includes('--classic-only')) {
  const ai = await newPage('PlayerWithAnExceptionallyLongUnbrokenDisplayName')
  await practice(ai.page)
  await layout(ai.page)
  await ai.page.clock.install()
  let correctAnswers = 0
  let expectedScore = 0
  for (let round = 1; round <= 10; round++) {
    await ai.page.waitForFunction((n) => window.__game.game.round === n && window.__game.game.phase === 'playing', round)
    const id = await ai.page.evaluate(() => window.__game.game.currentSongId)
    if (round !== 3) {
      const answerId = round === 2 ? await ai.page.evaluate(() => window.__game.game.roundOptions.find((t) => t.id !== window.__game.game.currentSongId).id) : id
      await ai.page.locator('.choice-btn').filter({ has: ai.page.getByText(tracks.find((t) => t.id === answerId).title, { exact: true }) }).click()
      assert.equal(await ai.page.locator('.choice-btn:disabled').count(), 4)
      if (answerId === id) {
        correctAnswers++
        const timeLeft = await ai.page.evaluate(() => window.__game.game.youState.pendingTimeLeft)
        expectedScore += 100 + Math.round(timeLeft / 10 * 50)
      }
    }
    await ai.page.clock.runFor(10500)
    await ai.page.locator('.song-reveal').waitFor()
    assert.equal(await ai.page.evaluate(() => window.__game.game.playerAsked), round)
    assert.equal(await ai.page.evaluate(() => window.__game.game.playerCorrect), correctAnswers)
    await ai.page.clock.runFor(5100)
  }
  await ai.page.getByText('BATTLE COMPLETE', { exact: true }).waitFor()
  assert.equal(await ai.page.evaluate(() => window.__game.game.playerScore), expectedScore)
  assert.equal(await ai.page.evaluate(() => window.__sdk.created), 0)
  assert.ok((await ai.page.evaluate(() => window.__media)).every((url) => url.includes('dzcdn.net')))
  assert.ok(!ai.requests.some((url) => /playback-token|eligibility|api.spotify.com/.test(url)))
  assert.equal(ai.requests.filter((url) => url.includes('/api/spotify/tracks?')).length, 1, 'AI starts from one catalog page')
  await ai.page.getByRole('button', { name: 'BACK TO CLASSIC', exact: true }).click()
  await ai.page.getByRole('button').filter({ hasText: 'PLAY WITH FRIENDS' }).click()
  await ai.page.getByRole('button', { name: /CREATE A NEW LOBBY/ }).waitFor()
  assert.equal(await ai.page.evaluate(() => window.__game.game.phase), 'lobby')
  assert.ok(!(await ai.page.evaluate(() => window.__game.game.players)).some((p) => p.id === 'ai-opponent'))
  console.log('PASS: completed VS AI returns directly to a usable private lobby, with AI state cleared')
  console.log('PASS: VS AI 10 rounds, original answer locking/reveal/scoring/results, Deezer-only audio; layout at 10 widths')
  await ai.context.close()

  const quota = await newPage('quota', 'multiplayer', 'quota')
  await practice(quota.page)
  assert.equal(await quota.page.evaluate(() => window.__game.game.correctSong.previewProvider), 'deezer')
  assert.equal(await quota.page.evaluate(() => window.__sdk.created), 0)
  console.log('PASS: VS AI starts with Spotify quota failure using the existing catalog fallback')
  await quota.context.close()

  const slow = await newPage('slow', 'multiplayer', 'slow-preview')
  await practice(slow.page)
  assert.ok(slow.requests.filter((url) => url.includes('/api/vs-audio-preview?')).length <= 3)
  assert.equal(await slow.page.evaluate(() => window.__game.game.round), 1)
  await slow.context.close()
  const cancelled = await newPage('cancelled', 'multiplayer', 'slow-catalog')
  await cancelled.page.getByRole('button').filter({ hasText: 'PRACTICE VS AI' }).click()
  await cancelled.page.getByRole('button', { name: /START PRACTICE/ }).click()
  await cancelled.page.getByRole('button', { name: 'BACK TO LOBBY', exact: true }).click()
  await cancelled.page.getByRole('button').filter({ hasText: 'PLAY WITH FRIENDS' }).click()
  await cancelled.page.getByRole('button', { name: /CREATE A NEW LOBBY/ }).waitFor()
  await cancelled.page.waitForTimeout(1000)
  assert.equal(await cancelled.page.evaluate(() => window.__game.game.phase), 'lobby')
  assert.equal(await cancelled.page.evaluate(() => window.__game.game.currentSongId), null)
  console.log('PASS: slow/missing previews do not block startup; cancelled startup cannot overwrite private lobby state')
  await cancelled.context.close()

  const host = await newPage('host', 'multiplayer', 'connect')
  const guest = await newPage('guest')
  for (const p of [host, guest]) await p.page.getByRole('button').filter({ hasText: 'PLAY WITH FRIENDS' }).click()
  await host.page.getByRole('button', { name: /CREATE A NEW LOBBY/ }).click()
  await guest.page.getByPlaceholder('ENTER 6-CHAR CODE').fill('ABCDEF')
  await guest.page.getByRole('button', { name: 'JOIN', exact: true }).click()
  for (const p of [host, guest]) await p.page.getByRole('button', { name: 'MARK READY', exact: true }).click()
  await host.page.getByRole('button', { name: /START MATCH/ }).click()
  await host.page.getByRole('button', { name: 'Try Again' }).click()
  for (const p of [host, guest]) await p.page.waitForFunction(() => window.__game.onlineGame.song)
  for (let round = 1; round <= 10; round++) {
    for (const p of [host, guest]) {
      await p.page.waitForFunction((n) => window.__game.onlineGame.currentRound === n && window.__game.onlineGame.phase === 'playing', round)
      const id = await p.page.evaluate(() => window.__game.onlineGame.song.id)
      assert.equal(id, db.session_rounds[round - 1].track.id)
      await Promise.all([
        p.page.waitForResponse((response) => response.url().endsWith('/test/db') && response.request().postDataJSON()?.name === 'submit_answer'),
        p.page.locator('.choice-btn').filter({ has: p.page.getByText(tracks.find((t) => t.id === id).title, { exact: true }) }).click(),
      ])
    }
    assert.equal(db.player_answers.filter((a) => a.round_number === round).length, 2)
    // Expire the shared server deadline; each unchanged online hook reveals it.
    db.game_sessions[0].round_end_at = new Date(Date.now() - 100).toISOString(); version++
    for (const p of [host, guest]) await p.page.locator('.song-reveal').waitFor()
    await host.page.waitForFunction((n) => window.__game.onlineGame.currentRound > n || window.__game.onlineLobby.gameOver, round)
  }
  for (const p of [host, guest]) {
    await p.page.getByText('BATTLE COMPLETE', { exact: true }).waitFor()
    assert.equal(p.requests.filter((url) => url.includes('api.spotify.com/v1/me/player/play')).length, 10)
    assert.ok(!p.requests.some((url) => /vs-audio|audio-preview/.test(url)))
  }
  assert.equal(await host.page.evaluate(() => window.__sdk.created), 2)
  assert.equal(rpcLog.filter((r) => r.name === 'start_match').length, 1)
  assert.equal(rpcLog.filter((r) => r.name === 'advance_round').length, 10)
  assert.ok(db.session_players.every((p) => p.asked === 10 && p.correct === 10 && p.score > 0))
  console.log('PASS: two-browser private lobby create/join/ready/start, failed Spotify connection retry, same 10 songs, answers, scores, reveals and completion; no Deezer requests')
  await host.context.close(); await guest.context.close()
  }

  const classic = await newPage('classic', 'classic')
  await classic.page.waitForFunction(() => window.__game.classicTrack)
  assert.equal(await classic.page.locator('.round-label').textContent(), 'Round 01')
  assert.deepEqual(await classic.page.locator('.stats-panel .stat-value').allTextContents(), ['0', '0x', '0%'])
  await Promise.all([
    classic.page.waitForResponse((r) => r.url().includes('api.spotify.com/v1/me/player/play')),
    classic.page.getByRole('button', { name: /Play/ }).first().click(),
  ])
  await classic.page.waitForFunction(() => window.__sdk.activated > 0)
  assert.equal(classic.requests.filter((url) => url.includes('/api/spotify/playback-token')).length, 1)
  const song = await classic.page.evaluate(() => window.__game.classicTrack.title)
  const before = await classic.page.evaluate(() => window.__game.score)
  await classic.page.getByRole('textbox', { name: 'Song guess' }).fill(song)
  await classic.page.locator('.guess-input button[type=submit]').click()
  await classic.page.locator('.song-reveal').waitFor()
  assert.equal(await classic.page.locator('.song-reveal__meta').count(), 0)
  assert.equal(await classic.page.locator('.song-reveal__details').count(), 0)
  await classic.page.getByRole('button', { name: 'View More Details', exact: true }).click()
  await classic.page.locator('.song-reveal__details').waitFor()
  for (const [width, height] of [[320, 568], [375, 667], [667, 320]]) {
    await classic.page.setViewportSize({ width, height })
    const fits = await classic.page.locator('.song-reveal').evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && el.scrollWidth <= el.clientWidth
    })
    assert.ok(fits, `Expanded answer must fit ${width}x${height}`)
  }
  await classic.page.setViewportSize({ width: 1440, height: 1000 })
  assert.ok(await classic.page.evaluate((score) => window.__game.score > score, before))
  assert.equal(await classic.page.locator('.round-label').textContent(), 'Round 01')
  assert.deepEqual(await classic.page.locator('.stats-panel .stat-value').allTextContents(), ['100', '1x', '100%'])
  await classic.page.locator('.song-reveal__continue').click()
  await classic.page.waitForFunction(() => window.__game.classicStats.round === 2)
  assert.equal(await classic.page.locator('.round-label').textContent(), 'Round 02')
  await classic.page.getByRole('textbox', { name: 'Song guess' }).fill('definitely not a song')
  await classic.page.locator('.guess-input button[type=submit]').click()
  assert.deepEqual(await classic.page.locator('.stats-panel .stat-value').allTextContents(), ['100', '0x', '50%'])
  const secondSong = await classic.page.evaluate(() => window.__game.classicTrack.title)
  await classic.page.getByRole('textbox', { name: 'Song guess' }).fill(secondSong)
  await classic.page.locator('.guess-input button[type=submit]').click()
  await classic.page.locator('.song-reveal').waitFor()
  await classic.page.locator('.song-reveal__continue').click()
  await classic.page.waitForFunction(() => window.__game.classicStats.round === 3)
  await classic.page.getByRole('button', { name: 'Statistics', exact: true }).click()
  assert.deepEqual(await classic.page.locator('.stats-grid strong').allTextContents(), ['200', '1x', '67%', '2'])
  await classic.page.getByRole('button', { name: 'Profile', exact: true }).click()
  assert.deepEqual(await classic.page.locator('.stat-tile__value').allTextContents(), ['200', '1x', '67%', '2'])
  await classic.page.reload()
  await classic.page.waitForFunction(() => window.__game.classicTrack)
  assert.equal(await classic.page.locator('.round-label').textContent(), 'Round 03')
  assert.deepEqual(await classic.page.locator('.stats-panel .stat-value').allTextContents(), ['200', '1x', '67%'])
  await classic.page.getByRole('button', { name: 'Play clip', exact: true }).click()
  await classic.page.getByRole('button', { name: 'Pause clip', exact: true }).click()
  for (let i = 0; i < 5; i++) await classic.page.locator('.skip-btn').click()
  await classic.page.locator('.song-reveal').waitFor()
  assert.equal(await classic.page.evaluate(() => window.__game.classicStats.roundsPlayed), 3)
  assert.deepEqual(await classic.page.locator('.stats-panel .stat-value').allTextContents(), ['200', '0x', '50%'])
  await classic.page.locator('.song-reveal__continue').click()
  await classic.page.waitForFunction(() => window.__game.classicStats.round === 4)
  await classic.page.getByRole('button', { name: 'Statistics', exact: true }).click()
  assert.deepEqual(await classic.page.locator('.stats-grid strong').allTextContents(), ['200', '1x', '50%', '3'])
  assert.ok(!classic.requests.some((url) => /vs-audio|audio-preview/.test(url)))
  await classic.page.getByRole('button', { name: 'Game', exact: true }).click()
  await classic.page.waitForFunction(() => window.__game.classicTrack)
  await classic.page.getByRole('button', { name: 'Next songs', exact: true }).click()
  await classic.page.waitForFunction(() => window.__game.classicTrack?.musicOrigin === 'OPM')
  await classic.page.getByRole('button', { name: 'Next songs', exact: true }).click()
  await classic.page.waitForFunction(() => window.__game.classicTrack?.musicOrigin === 'International')
  for (const width of [320, 375, 768]) {
    await classic.page.setViewportSize({ width, height: 568 })
    await classic.page.getByRole('button', { name: 'Open navigation menu', exact: true }).click()
    await classic.page.evaluate(() => { document.body.style.minHeight = '2400px'; window.scrollTo(0, 800) })
    const bounds = await classic.page.locator('.sidebar-menu').boundingBox()
    assert.equal(bounds.y, 70, `Navigation stays at viewport top while scrolling at ${width}px`)
    await classic.page.getByRole('button', { name: 'Close navigation menu', exact: true }).click()
    await classic.page.evaluate(() => window.scrollTo(0, 0))
  }
  console.log('PASS: Classic activates Spotify on a user gesture and reuses one playback token; responsive details, fixed mobile menu and category carousel transitions')
  console.log('PASS: Classic starts at round 1 with zero stats despite legacy demo values, advances 1/2/3/4 including a skipped song, updates score/streak/accuracy and Statistics/Profile, restores earned totals after reload; no Deezer')
  await classic.context.close()
  assert.deepEqual(errors, [])
  }
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
