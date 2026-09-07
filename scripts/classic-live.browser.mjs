// Opt-in live check: public previews and real browser audio; no credentials.
// Run with node --use-system-ca when your environment uses a system TLS CA.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

process.env.VERCEL = '1' // Prevent loading the developer's .env during import.
for (const key of ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[key]
const { default: handler } = await import('../server/index.js')
delete process.env.VERCEL // Serve the real public assets with the local store.
const { chromium } = await import(process.env.MUSYNC_PLAYWRIGHT ? pathToFileURL(resolve(process.env.MUSYNC_PLAYWRIGHT)).href : 'playwright')
const nativeFetch = globalThis.fetch
globalThis.fetch = (input, options) => {
  assert.ok(!/^(api|accounts)\.spotify\.com$/.test(new URL(input).hostname), 'Classic server requested Spotify')
  return nativeFetch(input, options)
}
const server = createServer(handler)
server.listen(0, '127.0.0.1'); await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ channel: process.env.MUSYNC_BROWSER || 'chrome', headless: true })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(60000)
  const errors = []
  const requests = []
  let resolvedTitle = ''
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error' || /^\[(Track|Audio)\]/.test(message.text())) console.log('Browser:', message.text()) })
  page.on('request', (request) => requests.push(request.url()))
  page.on('response', async (response) => {
    if (new URL(response.url()).pathname === '/api/vs-audio-preview') {
      const data = await response.json().catch(() => ({}))
      if (data.preview?.previewUrl) resolvedTitle = new URL(response.url()).searchParams.get('title')
    }
  })
  await page.route('https://esm.sh/**', async (route) => {
    const response = await fetch(route.request().url())
    assert.ok(response.ok)
    await route.fulfill({ contentType: 'text/javascript', body: await response.text(), headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  await page.goto(base)
  console.log('Live Classic page opened without credentials')
  assert.equal((await (await page.request.get(`${base}/api/spotify/status`)).json()).authed, false)
  const player = page.locator('.audio-player audio')
  await player.waitFor({ state: 'attached' })
  try {
    await page.waitForFunction(() => document.querySelector('.audio-player audio')?.readyState >= 2)
  } catch (error) {
    console.log(await player.evaluate((audio) => ({ src: audio.src, readyState: audio.readyState, error: audio.error?.message, status: document.querySelector('.audio-status')?.textContent })))
    throw error
  }
  console.log('Public preview decoded in browser')
  const title = resolvedTitle
  assert.ok(title)
  const available = Number((await page.locator('.guess-points').textContent()).match(/\d+/)[0])
  await page.getByRole('button', { name: 'Play clip', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.audio-player audio')?.currentTime > 0.1)
  await page.getByRole('textbox', { name: 'Song guess' }).fill(title)
  await page.locator('.guess-input button[type=submit]').click()
  await page.locator('.song-reveal').waitFor()
  assert.equal((await page.locator('.song-reveal__points').textContent()).trim(), `+${available} PTS`)
  assert.equal(Number((await page.locator('.stats-panel .stat-value').allTextContents())[0]), available)
  await page.locator('.song-reveal__continue').click()
  await page.waitForFunction(() => document.querySelector('.round-label')?.textContent === 'Round 02')
  await page.getByRole('button', { name: 'Play clip', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.audio-player audio')?.currentTime > 0.1)
  assert.notEqual(resolvedTitle, title)
  assert.ok(!requests.some((url) => /api\.spotify\.com|accounts\.spotify\.com|playback-token|eligibility|spotify\/tracks|catalog\/search/.test(url)))
  assert.deepEqual(errors, [])
  console.log('PASS: real logged-out Classic selects two public previews, decodes/plays audio, awards the displayed points, and advances without Spotify requests')
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  globalThis.fetch = nativeFetch
}
