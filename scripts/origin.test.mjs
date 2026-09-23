import assert from 'node:assert/strict'
import { test, after } from 'node:test'

process.env.VERCEL = '1'
process.env.SPOTIFY_CLIENT_ID = 'origin-test'
process.env.SPOTIFY_CLIENT_SECRET = 'origin-test'
const originalFetch = globalThis.fetch
after(() => { globalThis.fetch = originalFetch })
const requests = []
const artist = (id) => ({ id, name: id })
const track = (id, artists) => ({ id, name: id, artists: artists.map(artist), album: { release_date: '2020-01-01' } })
const mixed = [track('international', ['global']), track('local', ['local']), track('collaboration', ['global', 'local']), track('unknown', ['unknown'])]
let catalog = mixed
let failArtists = false
globalThis.fetch = async (input) => {
  const url = new URL(input)
  requests.push(url)
  if (url.hostname === 'accounts.spotify.com') return Response.json({ access_token: 'fixture', expires_in: 3600 })
  if (url.pathname === '/v1/search') {
    if (url.searchParams.get('q').includes('genre:Empty')) return Response.json({ tracks: { items: [] } })
    return Response.json({ tracks: { items: catalog } })
  }
  if (url.pathname.startsWith('/v1/artists/')) {
    if (failArtists) throw new Error('Temporary artist metadata failure')
    const id = url.pathname.split('/').at(-1)
    return Response.json({ id, genres: id === 'local' ? ['pinoy-pop'] : id === 'unknown' ? [] : ['pop'] })
  }
  throw new Error(`Unexpected request ${url.pathname}`)
}
const { searchTracks } = await import('../server/services/spotify.js')
const search = (options) => searchTracks({ clientId: 'origin-test', clientSecret: 'origin-test', ...options })

test('raw artist metadata isolates both origins, collaborations, aliases, cache and search fallbacks', async () => {
  const international = await search({ musicOrigin: 'International' })
  assert.deepEqual(international.map((t) => t.id), ['international'])
  assert.equal(international[0].genre, 'pop')
  assert.equal(international[0].musicOrigin, 'International')
  const local = await search({ musicOrigin: 'OPM' })
  assert.deepEqual(local.map((t) => t.id), ['local', 'collaboration'])
  assert.ok(local.every((t) => t.musicOrigin === 'OPM'))
  const count = requests.length
  assert.deepEqual(await search({ musicOrigin: 'OPM / Local' }), local)
  assert.deepEqual(await search({ musicOrigin: 'International' }), international)
  assert.equal(requests.length, count, 'origin-specific cached results need no new API requests')
  const emptyBefore = requests.length
  assert.deepEqual(await search({ musicOrigin: 'International', genre: 'Empty', offset: 300 }), [])
  assert.equal(requests.length, emptyBefore + 1, 'a Spotify no-results genre query must not retry without its genre')
  assert.deepEqual((await search({ musicOrigin: 'Any' })).map((t) => t.id), mixed.map((t) => t.id), 'unfiltered multiplayer remains unfiltered')
})

test('Spotify Classic maps every UI filter value into one combined Spotify query', async () => {
  const genres = [
    ['Pop', 'genre:pop'],
    ['Rock', 'genre:rock'],
    ['Hip-Hop', 'genre:hip-hop'],
    ['R&B', 'genre:r-n-b'],
    ['Electronic', 'genre:electronic'],
    ['Latin', 'genre:latin'],
    ['Country', 'genre:country'],
  ]
  for (const [label, expected] of genres) {
    const before = requests.length
    await search({ genre: label, musicOrigin: 'International', yearFrom: 2010, yearTo: 2019, offset: before * 10 })
    const request = requests.at(-1)
    assert.equal(request.pathname, '/v1/search')
    assert.match(request.searchParams.get('q'), new RegExp(`^${expected} year:2010-2019$`))
  }
  const before = requests.length
  await search({ genre: 'Any Genre', musicOrigin: 'OPM', offset: before * 10 })
  assert.equal(requests.at(-1).searchParams.get('q'), 'genre:opm')
})

test('supported single artist requests resolve collaborators; transient failures never classify unknown songs as International', async () => {
  catalog = [track('large-collaboration', Array.from({ length: 55 }, (_, i) => `batch-${i}`))]
  const before = requests.filter((u) => u.pathname.startsWith('/v1/artists/')).length
  const result = await search({ musicOrigin: 'International', offset: 100 })
  assert.equal(result.length, 1)
  assert.equal(requests.filter((u) => u.pathname.startsWith('/v1/artists/')).length - before, 55)
  assert.ok(!requests.some((u) => u.pathname === '/v1/artists'))
  catalog = [track('recoverable', ['recovery'])]
  failArtists = true
  assert.deepEqual(await search({ musicOrigin: 'International', offset: 200 }), [])
  failArtists = false
  assert.equal((await search({ musicOrigin: 'International', offset: 210 }))[0].id, 'recoverable')
})

test('signed-in Classic uses genre searches without artist lookups and keeps era, origin and playback restrictions', async () => {
  const { sessionStore } = await import('../server/services/sessionStore.js')
  const originalGet = sessionStore.get
  const beforeFetch = globalThis.fetch
  sessionStore.get = async () => ({ accessToken: 'classic-user', expiresAt: Date.now() + 3600000 })
  const queries = []
  globalThis.fetch = async (input, options) => {
    const url = new URL(input)
    assert.equal(options.headers.Authorization, 'Bearer classic-user')
    if (url.pathname === '/v1/search') {
      queries.push(url.searchParams.get('q'))
      const song = (id, name, extra = {}) => ({
        ...track(id, [id]), artists: [{ id, name }], album: { release_date: '2014-01-01' }, ...extra,
      })
      return Response.json({ tracks: { items: [
        song('empty-global', 'International Artist'),
        song('empty-opm', 'BINI'),
        song('empty-alias', 'Up Dharma Down'),
        song('empty-collaboration', 'International Artist', { artists: [{ id: 'empty-global', name: 'International Artist' }, { id: 'empty-opm', name: 'BINI' }] }),
        song('old', 'International Artist', { album: { release_date: '1980-01-01' } }),
        song('blocked', 'International Artist', { is_playable: false }),
        song('local-file', 'International Artist', { is_local: true }),
        song('restricted', 'International Artist', { restrictions: { reason: 'market' } }),
      ], next: null } })
    }
    assert.fail('Classic must not depend on an artist metadata endpoint')
  }
  try {
    const options = { requireUser: true, sessionId: 'empty-genres', musicOrigin: 'International', yearFrom: 2010, yearTo: 2019 }
    for (const genre of ['Any Genre', 'Pop', 'Rock', 'Hip-Hop', 'R&B', 'Electronic', 'Latin', 'Country']) {
      const songs = await search({ ...options, genre })
      assert.deepEqual(songs.map((song) => song.id), ['empty-global'])
      assert.equal(songs[0].musicOrigin, 'International')
      assert.equal(songs[0].genre, genre === 'Any Genre' ? 'Unknown' : genre)
      assert.equal(songs[0].playbackType, 'spotify-sdk')
    }
    assert.equal(queries[0], 'year:2010-2019')
    assert.equal(queries[4], 'genre:r-n-b year:2010-2019')
    // No era selection must work too, with no artist metadata available.
    assert.ok((await search({ ...options, yearFrom: undefined, yearTo: undefined })).length > 0)
    // Unavailable artist metadata must not discard a successful track search.
    globalThis.fetch = async (input) => {
      if (new URL(input).pathname === '/v1/search') return Response.json({ tracks: { items: [{ ...track('metadata-error', ['uncached-failure']), album: { release_date: '2014-01-01' } }], next: null } })
      throw new Error('Temporary metadata failure')
    }
    assert.equal((await search({ ...options, offset: 300 }))[0].id, 'metadata-error')
  } finally {
    sessionStore.get = originalGet
    globalThis.fetch = beforeFetch
  }
})
