import assert from 'node:assert/strict'
import { test, after } from 'node:test'

const originalFetch = globalThis.fetch
after(() => { globalThis.fetch = originalFetch })
let revision = 0
const service = () => import(`../server/services/vsAudio.js?test=${++revision}`)
const track = { trackId: 'spotify-id', title: 'One More Time', artist: 'Daft Punk', spotifyPreviewUrl: 'https://p.scdn.co/spotify.mp3' }
const recording = { id: 1, title: track.title, artist: { name: track.artist }, preview: 'https://cdn.dzcdn.net/preview.mp3' }

test('VS AI resolves Deezer even with Spotify preview metadata; concurrent and repeated requests share a lookup', async () => {
  let calls = 0
  globalThis.fetch = async (input) => {
    assert.equal(new URL(input).hostname, 'api.deezer.com')
    calls++
    return Response.json({ data: [recording] })
  }
  const { resolveVSAudio } = await service()
  const results = await Promise.all([resolveVSAudio(track), resolveVSAudio(track)])
  assert.deepEqual(results[0], { provider: 'deezer', previewUrl: recording.preview, duration: 30000 })
  assert.deepEqual(results[1], results[0])
  assert.deepEqual(await resolveVSAudio(track), results[0])
  assert.equal(calls, 1)
})

test('missing, mismatched and failed Deezer previews never fall back to Spotify', async () => {
  for (const response of [[], [{ ...recording, artist: { name: 'Cover Artist' } }], [{ ...recording, preview: '' }], null]) {
    const { resolveVSAudio } = await service()
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      return response ? Response.json({ data: response }) : new Response(null, { status: 503 })
    }
    assert.equal(await resolveVSAudio(track), null)
    assert.equal(await resolveVSAudio(track), null)
    assert.equal(calls, 1)
  }
})

test('Deezer catalog tolerates a failed search, excludes silent tracks and reuses its exact preview', async () => {
  let calls = 0
  globalThis.fetch = async (input, options) => {
    calls++
    assert.ok(options.signal instanceof AbortSignal)
    if (new URL(input).searchParams.get('q') === 'Miguel') throw new Error('Network unavailable')
    return Response.json({ data: [recording, { ...recording, id: 2, preview: '' }] })
  }
  const { searchVSAudioTracks, resolveVSAudio } = await service()
  const tracks = await searchVSAudioTracks()
  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].id, 'deezer-1')
  assert.equal(tracks[0].provider, 'deezer')
  const catalogCalls = calls
  const preview = await resolveVSAudio({ ...tracks[0], trackId: tracks[0].id })
  assert.equal(preview.previewUrl, recording.preview)
  assert.equal(calls, catalogCalls)
})
