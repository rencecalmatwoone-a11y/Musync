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
  if (url.pathname === '/v1/artists') {
    if (failArtists) throw new Error('Temporary artist metadata failure')
    return Response.json({ artists: url.searchParams.get('ids').split(',').map((id) => ({ id, genres: id === 'local' ? ['pinoy-pop'] : id === 'unknown' ? [] : ['pop'] })) })
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
  assert.deepEqual((await search({ musicOrigin: 'International', genre: 'Empty' })).map((t) => t.id), ['international'])
  assert.deepEqual((await search({ musicOrigin: 'Any' })).map((t) => t.id), mixed.map((t) => t.id), 'unfiltered multiplayer remains unfiltered')
})

test('all artist batches resolve and transient failures never classify unknown songs as International', async () => {
  catalog = [track('large-collaboration', Array.from({ length: 55 }, (_, i) => `batch-${i}`))]
  const before = requests.filter((u) => u.pathname === '/v1/artists').length
  const result = await search({ musicOrigin: 'International', offset: 100 })
  assert.equal(result.length, 1)
  assert.equal(requests.filter((u) => u.pathname === '/v1/artists').length - before, 2)
  catalog = [track('recoverable', ['recovery'])]
  failArtists = true
  assert.deepEqual(await search({ musicOrigin: 'International', offset: 200 }), [])
  failArtists = false
  assert.equal((await search({ musicOrigin: 'International', offset: 210 }))[0].id, 'recoverable')
})
