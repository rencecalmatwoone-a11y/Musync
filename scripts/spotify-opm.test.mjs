import assert from 'node:assert/strict'
import { test, after } from 'node:test'

process.env.VERCEL = '1'
process.env.SPOTIFY_CLIENT_ID = 'opm-test'
process.env.SPOTIFY_CLIENT_SECRET = 'opm-test'
const { sessionStore } = await import('../server/services/sessionStore.js')
const sessions = new Map()
sessionStore.get = async (kind, id) => structuredClone(sessions.get(id) || null)
sessionStore.set = async (kind, id, data) => { sessions.set(id, structuredClone(data)) }
const { searchTracks } = await import('../server/services/spotify.js')
const nativeFetch = globalThis.fetch
after(() => { globalThis.fetch = nativeFetch })
const track = (id, extra = {}) => ({ id, name: `Song ${id}`, artists: [{ id: `artist-${id}`, name: 'OPM Artist' }],
  album: { release_date: '2024-01-01' }, duration_ms: 180000, ...extra })
const search = (sessionId, extra = {}) => {
  sessions.set(sessionId, { accessToken: 'test-user-token', expiresAt: Date.now() + 3600000 })
  return searchTracks({ clientId: 'opm-test', clientSecret: 'opm-test', sessionId, requireUser: true,
    musicOrigin: 'OPM / Local', includePageInfo: true, ...extra })
}

test('Classic OPM keeps playable genre-search results without requiring artist metadata', async () => {
  const calls = []
  globalThis.fetch = async (input, options) => {
    const url = new URL(input)
    calls.push(url)
    assert.equal(options.headers.Authorization, 'Bearer test-user-token')
    if (url.pathname.startsWith('/v1/artists/')) return Response.json({ genres: [] })
    assert.equal(url.pathname, '/v1/search')
    return Response.json({ tracks: { items: [track('local'), track('blocked', { is_playable: false }),
      track('file', { is_local: true }), track('restricted', { restrictions: { reason: 'market' } })], next: null } })
  }
  const result = await search('metadata')
  assert.deepEqual(result.tracks.map((t) => t.id), ['local'])
  assert.equal(result.tracks[0].musicOrigin, 'OPM')
  assert.equal(result.tracks[0].playbackType, 'spotify-sdk')
  assert.equal(calls.length, 1, 'OPM playback must not depend on artist metadata requests')
  assert.equal(calls[0].searchParams.get('market'), 'PH')
})

test('Classic OPM ignores old era/genre values on the server and reuses its cache', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    const url = new URL(input)
    calls.push(url)
    assert.equal(url.searchParams.get('q'), 'genre:opm')
    return Response.json({ tracks: { items: [track('all-eras')], next: null } })
  }
  const first = await search('filters', { genre: 'Rock', yearFrom: 1950, yearTo: 1959 })
  assert.equal(first.tracks.length, 1)
  assert.deepEqual(await search('filters', { genre: 'Jazz', yearFrom: 1990, yearTo: 1999 }), first)
  assert.equal(calls.length, 1)
})

test('empty OPM search tries another local genre and preserves pagination', async () => {
  const queries = []
  globalThis.fetch = async (input) => {
    const url = new URL(input)
    assert.equal(url.pathname, '/v1/search')
    const q = url.searchParams.get('q')
    queries.push(q)
    return Response.json({ tracks: { items: q === 'genre:opm' ? [] : [track('pinoy')],
      next: q === 'genre:opm' ? null : 'next-page' } })
  }
  const page = await search('fallback')
  assert.deepEqual(queries, ['genre:opm', 'genre:"pinoy pop"'])
  assert.equal(page.tracks[0].id, 'pinoy')
  assert.equal(page.nextOffset, 10)
})

test('OPM never falls back to unrestricted International results', async () => {
  const queries = []
  globalThis.fetch = async (input) => {
    const url = new URL(input)
    queries.push(url.searchParams.get('q'))
    return Response.json({ tracks: { items: [], next: null } })
  }
  const page = await search('empty')
  assert.deepEqual(queries, ['genre:opm', 'genre:"pinoy pop"', 'genre:"pinoy rock"'])
  assert.deepEqual(page, { tracks: [], nextOffset: null })
})

test('OPM propagates authorization failures instead of hiding them with another query', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return Response.json({ error: { message: 'Insufficient scope' } }, { status: 403 })
  }
  await assert.rejects(search('denied'), { status: 403 })
  assert.equal(calls, 1)
})
