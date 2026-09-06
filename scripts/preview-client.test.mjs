import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('VS preview candidates reuse concurrent and completed requests without requesting Spotify credentials', async () => {
  let source = await readFile(new URL('../src/spotify/client.js', import.meta.url), 'utf8')
  source = source.replace(source.split(/\r?\n/)[0], 'const isSpotifyConfigured = true, isSpotifyAuthed = true')
  for (const name of ['tracks', 'popularTracks']) source = source.replace(`../data/${name}.js`, new URL(`../src/data/${name}.js`, import.meta.url).href)
  const { resolveVSAudioPreview } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
  const original = globalThis.fetch
  let calls = 0
  let release
  globalThis.fetch = async (url) => {
    calls++
    assert.ok(url.startsWith('/api/vs-audio-preview?'))
    return new Promise((resolve) => { release = () => resolve(Response.json({ preview: { provider: 'deezer', previewUrl: '/audio.mp3' } })) })
  }
  try {
    const song = { id: 'track', title: 'Song', artist: 'Artist' }
    const first = resolveVSAudioPreview(song)
    const second = resolveVSAudioPreview(song)
    release()
    assert.deepEqual(await first, await second)
    assert.deepEqual(await resolveVSAudioPreview(song), await first)
    assert.equal(calls, 1)
  } finally { globalThis.fetch = original }
})
