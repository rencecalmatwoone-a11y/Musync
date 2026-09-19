import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { matchesOpmReference, opmReferenceOrder } from '../server/services/opmCatalog.js'

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
const track = (reference, extra = {}) => ({ id: `${reference.artist}:${reference.title}`, name: reference.title,
  artists: [{ id: reference.artist, name: reference.artist }], album: { release_date: '2024-01-01' }, duration_ms: 180000, ...extra })
const search = (sessionId, extra = {}) => {
  sessions.set(sessionId, { accessToken: 'test-user-token', expiresAt: Date.now() + 3600000 })
  return searchTracks({ clientId: 'opm-test', clientSecret: 'opm-test', sessionId, requireUser: true,
    musicOrigin: 'OPM / Local', includePageInfo: true, ...extra })
}
const queryFor = (reference) => `track:"${reference.title}" artist:"${reference.artist}" year:2000-2029`
function mockSearch(sessionId, results = (reference) => [track(reference)]) {
  const calls = []
  const references = opmReferenceOrder(sessionId)
  globalThis.fetch = async (input, options) => {
    const url = new URL(input)
    assert.equal(url.pathname, '/v1/search', 'no artist metadata, app token, or preview lookups')
    assert.equal(options.headers.Authorization, 'Bearer test-user-token')
    assert.equal(url.searchParams.get('market'), 'PH')
    assert.equal(url.searchParams.get('offset'), '0')
    const reference = references.find((song) => queryFor(song) === url.searchParams.get('q'))
    assert.ok(reference, 'only exact reference song searches are allowed')
    calls.push(reference)
    return Response.json({ tracks: { items: results(reference), next: null } })
  }
  return calls
}

test('reference pool rotates across artists, differs by session, and includes user-supplied hits', () => {
  const first = opmReferenceOrder('one')
  assert.ok(first.length > 150)
  assert.deepEqual(opmReferenceOrder('one'), first)
  assert.notDeepEqual(opmReferenceOrder('two').slice(0, 10), first.slice(0, 10))
  assert.equal(new Set(first.slice(0, 40).map((song) => song.artist)).size, 40)
  for (const [title, artist] of [['Multo', 'Cup of Joe'], ['Pantropiko', 'BINI'], ['Narda', 'Kamikazee'], ['Tadhana', 'UDD'], ['Kalapastangan', 'fitterkarma']]) {
    assert.ok(first.some((song) => song.title === title && song.artist === artist))
  }
  assert.equal(new Set(first.map((song) => `${song.artist}:${song.title}`)).size, first.length)
})

test('OPM resolves reference recordings and rejects deep cuts, covers, live versions and blocked audio', async () => {
  const calls = mockSearch('matches', (reference) => [
    track(reference, { id: 'obscure', name: 'An obscure album track', popularity: 100 }),
    track(reference, { id: 'cover', artists: [{ name: 'Cover Artist' }], popularity: 100 }),
    track(reference, { id: 'live', name: `${reference.title} - Live`, popularity: 100 }),
    track(reference, { id: 'blocked', is_playable: false }),
    track(reference, { id: 'file', is_local: true }),
    track(reference, { id: 'restricted', restrictions: { reason: 'market' } }),
    track(reference),
  ])
  const page = await search('matches')
  assert.equal(calls.length, 4)
  assert.deepEqual(page.tracks.map((song) => song.id), calls.map((song) => track(song).id))
  assert.ok(page.tracks.every((song) => song.musicOrigin === 'OPM' && song.playbackType === 'spotify-sdk'))
  assert.equal(page.nextOffset, 4)
})

test('OPM reuses cache and in-flight searches across inactive era and genre settings', async () => {
  const calls = mockSearch('cache')
  const [first, second] = await Promise.all([
    search('cache', { genre: 'Rock', yearFrom: 1950, yearTo: 1959 }),
    search('cache', { genre: 'Jazz', yearFrom: 1990, yearTo: 1999 }),
  ])
  assert.deepEqual(first, second)
  assert.deepEqual(await search('cache'), first)
  assert.equal(calls.length, 4)
})

test('OPM advances past unavailable references, never falls back to broad genre search, and ends at catalog boundary', async () => {
  const calls = mockSearch('pages', () => [])
  const first = await search('pages')
  assert.deepEqual(first, { tracks: [], nextOffset: 4 })
  const second = await search('pages', { offset: first.nextOffset })
  assert.equal(second.nextOffset, 8)
  assert.equal(new Set(calls.map(queryFor)).size, 8)
  const total = opmReferenceOrder('pages').length
  assert.deepEqual(await search('pages', { offset: total - 1 }), { tracks: [], nextOffset: null })
})

test('OPM includes all three decades and excludes old, future and unknown releases', async () => {
  for (const year of ['1999', '2000', '2009', '2010', '2019', '2020', '2029', '2030', 'unknown']) {
    const session = `year-${year}`
    mockSearch(session, (reference) => [track(reference, { album: { release_date: year } })])
    const page = await search(session, { limit: 1 })
    assert.equal(page.tracks.length, Number(Number(year) >= 2000 && Number(year) <= 2029))
    assert.equal(page.nextOffset, 1)
  }
})

test('reference matching supports official artist aliases and featured credits without accepting another song', () => {
  const reference = opmReferenceOrder('aliases').find((song) => song.title === 'Tadhana')
  assert.ok(matchesOpmReference(track(reference, { artists: [{ name: 'Up Dharma Down' }] }), reference))
  assert.ok(matchesOpmReference(track(reference, { name: 'Tadhana (feat. Artist)' }), reference))
  assert.equal(matchesOpmReference(track(reference, { name: 'Tadhana - Karaoke' }), reference), false)
})

test('OPM stops scheduling searches after authorization failure', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return Response.json({ error: { message: 'Insufficient scope' } }, { status: 403 })
  }
  await assert.rejects(search('denied'), { status: 403 })
  assert.ok(calls <= 2, 'only already-started requests may finish after failure')
})
