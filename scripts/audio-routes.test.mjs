import assert from 'node:assert/strict'
import { test, after } from 'node:test'

// Exercise the actual API handler, without developer credentials or live services.
process.env.VERCEL = '1'
process.env.SPOTIFY_CLIENT_ID = 'test-client'
process.env.SPOTIFY_CLIENT_SECRET = 'test-secret'
const originalFetch = globalThis.fetch
after(() => { globalThis.fetch = originalFetch })
const calls = []
const previewUrl = 'https://cdn.dzcdn.net/test.mp3'
globalThis.fetch = async (input) => {
  const url = new URL(input)
  calls.push(url.hostname)
  if (url.hostname === 'accounts.spotify.com') return Response.json({ access_token: 'test-token' })
  if (url.hostname === 'api.spotify.com' && url.pathname === '/v1/search') return Response.json({ tracks: { items: [{
    id: 'spotify-track', name: 'Song', artists: [{ name: 'Artist' }], album: { name: 'Album', release_date: '2020-01-01' },
    external_urls: { spotify: 'https://open.spotify.com/track/spotify-track' }, preview_url: 'https://p.scdn.co/spotify.mp3',
  }] } })
  if (url.hostname === 'api.deezer.com') return Response.json({ data: [{ id: 1, title: 'Song', artist: { name: 'Artist' }, preview: previewUrl }] })
  throw new Error(`Unexpected request: ${url.origin}${url.pathname}`)
}
const { default: handler } = await import('../server/index.js')
async function invoke(path) {
  const result = { status: 200, headers: {} }
  await handler({ url: path, method: 'GET', headers: {} }, {
    setHeader(name, value) { result.headers[name] = value },
    writeHead(status) { result.status = status },
    end(body) { result.body = JSON.parse(body) },
  })
  return result
}

test('configured Spotify remains the multiplayer catalog/SDK provider before and after VS AI audio resolution', async () => {
  const path = '/api/spotify/tracks?limit=10&difficulty=2'
  const before = await invoke(path)
  assert.equal(before.status, 200)
  assert.equal(before.body.tracks[0].provider, 'spotify')
  assert.equal(before.body.tracks[0].difficulty, 2)
  assert.equal(before.body.tracks[0].playbackType, 'spotify-sdk')
  assert.equal(before.body.tracks[0].playbackUrl, null)
  assert.ok(!calls.includes('api.deezer.com'))
  const count = calls.length
  const audio = await invoke('/api/vs-audio-preview?trackId=spotify-track&title=Song&artist=Artist&spotifyPreviewUrl=https://p.scdn.co/spotify.mp3')
  assert.equal(audio.status, 200)
  assert.equal(audio.body.preview.provider, 'deezer')
  assert.equal(audio.body.preview.previewUrl, `/api/audio-preview?url=${encodeURIComponent(previewUrl)}`)
  assert.deepEqual(calls.slice(count), ['api.deezer.com'])
  assert.deepEqual((await invoke(path)).body, before.body)
  assert.equal((await invoke('/api/vs-audio-preview?trackId=missing')).status, 400)
})
