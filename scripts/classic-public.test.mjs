import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test, after } from 'node:test'

const asModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
let client = await readFile(new URL('../src/spotify/client.js', import.meta.url), 'utf8')
client = client.replace(client.split(/\r?\n/)[0], 'const isSpotifyConfigured = false, isSpotifyAuthed = false')
for (const name of ['tracks', 'popularTracks']) client = client.replace(`../data/${name}.js`, new URL(`../src/data/${name}.js`, import.meta.url).href)
let source = await readFile(new URL('../src/data/classicTracks.js', import.meta.url), 'utf8')
source = source.replace('../spotify/client.js', asModule(client))
const { fetchClassicTrack, searchClassicCatalog } = await import(asModule(source))
const nativeFetch = globalThis.fetch
after(() => { globalThis.fetch = nativeFetch })
const requests = []
const tracks = [
  { id: 'deezer-1', provider: 'deezer', providerTrackId: '1', title: 'Song One', artist: 'Artist One', album: 'Album One', artwork: 'https://cdn.example/one.jpg', releaseDate: '2001-01-01', popularity: 80, difficulty: 2, playbackType: 'preview', playbackUrl: '/api/audio-preview?url=one' },
  { id: 'deezer-2', provider: 'deezer', providerTrackId: '2', title: 'Song Two', artist: 'Artist Two', album: 'Album Two', artwork: 'https://cdn.example/two.jpg', releaseDate: '2002-01-01', popularity: 120, difficulty: 2, playbackType: 'preview', playbackUrl: '/api/audio-preview?url=two' },
]
globalThis.fetch = async (url) => {
  requests.push(url)
  if (url === '/api/spotify/status') return Response.json({ configured: false, authed: false })
  if (url.startsWith('/api/classic/tracks?')) return Response.json({ provider: 'deezer', tracks })
  if (url.startsWith('/api/classic/guest-search?')) return Response.json({ provider: 'deezer', tracks })
  throw new Error(`Unexpected request: ${url}`)
}

test('logged-out selection uses only the dynamic Deezer Classic catalog and preserves details', async () => {
  const first = await fetchClassicTrack({ difficulty: 2 })
  assert.equal(first.provider, 'deezer')
  assert.ok(Number.isFinite(first.popularity))
  assert.ok(['Album One', 'Album Two'].includes(first.album))
  assert.ok(first.artwork.startsWith('https://cdn.example/'))
  assert.match(first.releaseDate, /^200[12]-01-01$/)
  assert.equal(first.difficulty, 2)
  assert.ok(first.playbackUrl)
  assert.ok(requests.every((url) => !/spotify\/tracks|catalog\/search|api\.spotify\.com|vs-audio-preview/.test(url)))
})

test('logged-out selection advances and searches the same Deezer provider', async () => {
  const first = await fetchClassicTrack({ difficulty: 2 })
  const next = await fetchClassicTrack({ recentIds: [first.id] })
  assert.notEqual(next.id, first.id)
  assert.ok((await searchClassicCatalog(first.title)).some((track) => track.id === first.id))
  assert.ok(requests.some((url) => url.startsWith('/api/classic/guest-search?')))
})

test('guest selection respects recently played exclusions at every difficulty', async () => {
  const easy = await fetchClassicTrack({ difficulty: 0, recentIds: ['deezer-2'] })
  const impossible = await fetchClassicTrack({ difficulty: 4, recentIds: ['deezer-1'] })
  assert.equal(easy.popularity, 80)
  assert.equal(impossible.popularity, 120)
  assert.notEqual(impossible.id, easy.id)
})

test('guest Classic samples low-ranked songs immediately and loads new candidates after four selections', async () => {
  const savedFetch = globalThis.fetch
  const savedRandom = Math.random
  let catalogCalls = 0
  let catalogSeed
  const initial = Array.from({ length: 4 }, (_, index) => ({ ...tracks[0], id: `rotation-${index}`, title: `Rotation ${index}`, popularity: 1000 - index * 300 }))
  const added = { ...tracks[0], id: 'new-addition', title: 'New Addition', popularity: 1 }
  globalThis.fetch = async (url) => {
    if (url.startsWith('/api/classic/tracks?')) {
      catalogCalls++
      const params = new URL(url, 'http://localhost').searchParams
      if (catalogCalls === 1) catalogSeed = params.get('catalogSeed')
      assert.equal(params.get('catalogSeed'), catalogSeed)
      assert.equal(Number(params.get('catalogOffset')), catalogCalls === 1 ? 0 : 24)
      return Response.json({ provider: 'deezer', tracks: catalogCalls === 1 ? initial : [added], catalogSeed: Number(catalogSeed), nextOffset: catalogCalls === 1 ? 24 : null })
    }
    return savedFetch(url)
  }
  Math.random = () => 0.999
  try {
    const selected = []
    for (let i = 0; i < 5; i++) selected.push(await fetchClassicTrack({ genre: 'expanded-catalog', difficulty: 0 }))
    assert.equal(selected[0].id, 'rotation-3', 'Easy must not force the highest-ranked songs first')
    assert.equal(new Set(selected.slice(0, 4).map((song) => song.id)).size, 4)
    assert.equal(selected[4].id, added.id)
    assert.equal(catalogCalls, 2)
  } finally {
    globalThis.fetch = savedFetch
    Math.random = savedRandom
  }
})

test('guest selection exhausts the catalog without caller-supplied recent IDs, then starts another cycle', async () => {
  const ids = []
  for (let i = 0; i < 4; i++) ids.push((await fetchClassicTrack({ genre: 'rotation-test', difficulty: 4 })).id)
  assert.equal(new Set(ids.slice(0, 2)).size, 2)
  assert.equal(new Set(ids.slice(2, 4)).size, 2)
})
