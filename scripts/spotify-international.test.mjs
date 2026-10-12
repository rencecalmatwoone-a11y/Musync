import assert from 'node:assert/strict'
import { test, after } from 'node:test'

process.env.VERCEL = '1'
const { sessionStore } = await import('../server/services/sessionStore.js')
sessionStore.get = async () => ({ accessToken: 'fixture', expiresAt: Date.now() + 3600000 })
const { searchTracks } = await import('../server/services/spotify.js')
const nativeFetch = globalThis.fetch
after(() => { globalThis.fetch = nativeFetch })

const cases = [
  ['Pop', 'dance pop', 'country'], ['Rock', 'alternative rock', 'pop'],
  ['Hip-Hop', 'hip hop', 'country'], ['R&B', 'neo soul', 'rock'],
  ['Electronic', 'house', 'country'], ['Latin', 'reggaeton', 'rock'],
  ['Country', 'bluegrass', 'pop'],
]
for (const [genre, matching, wrong] of cases) {
  test(`signed-in International ${genre} verifies genre, origin, era and playability`, async () => {
    const metadata = new Map()
    const track = (id, genres, extra = {}) => {
      const artistId = `${genre}-${id}`
      metadata.set(artistId, genres)
      return { id, name: id, artists: [{ id: artistId, name: id }],
        album: { release_date: '1995-01-01' }, ...extra }
    }
    const items = [
      track('match', [matching]), track('wrong-genre', [wrong]),
      track('unlisted-local', [matching, 'pinoy indie']), track('unknown', []),
      track('known-local', [matching], { artists: [{ id: 'bini', name: 'BINI' }] }),
      track('wrong-year', [matching], { album: { release_date: '2024-01-01' } }),
      track('missing-year', [matching], { album: {} }),
      track('blocked', [matching], { is_playable: false }),
      track('local-file', [matching], { is_local: true }),
      track('restricted', [matching], { restrictions: { reason: 'market' } }),
    ]
    const artistCalls = []
    globalThis.fetch = async (input, options) => {
      assert.equal(options.headers.Authorization, 'Bearer fixture')
      const url = new URL(input)
      if (url.pathname === '/v1/search') {
        assert.match(url.searchParams.get('q'), /year:1990-1999/)
        return Response.json({ tracks: { items, next: 'next-page' } })
      }
      const id = decodeURIComponent(url.pathname.split('/').at(-1))
      artistCalls.push(id)
      assert.ok(metadata.has(id), 'known local artists need no metadata lookup')
      return Response.json({ genres: metadata.get(id) })
    }
    const options = { sessionId: genre, requireUser: true, musicOrigin: 'International',
      genre, yearFrom: 1990, yearTo: 1999, includePageInfo: true }
    const page = await searchTracks(options)
    assert.deepEqual(page.tracks.map((song) => song.id), ['match'])
    assert.equal(page.tracks[0].genre, matching, 'return actual metadata, not the requested label')
    assert.equal(page.tracks[0].musicOrigin, 'International')
    assert.equal(page.nextOffset, 10)
    const callsBefore = artistCalls.length
    await searchTracks({ ...options, offset: 10 })
    assert.equal(artistCalls.length, callsBefore, 'artist metadata is reused across pages')
  })
}

test('an empty classified page retains its cursor and does not broaden filters', async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(input)
    if (url.pathname === '/v1/search') {
      assert.equal(url.searchParams.get('q'), 'genre:rock year:1990-1999')
      return Response.json({ tracks: { items: [{ id: 'unknown', name: 'Unknown',
        artists: [{ id: 'empty-page', name: 'Unknown' }], album: { release_date: '1995' } }], next: 'next' } })
    }
    return Response.json({ genres: [] })
  }
  assert.deepEqual(await searchTracks({ sessionId: 'empty', requireUser: true,
    musicOrigin: 'International', genre: 'Rock', yearFrom: 1990, yearTo: 1999,
    includePageInfo: true }), { tracks: [], nextOffset: 10 })
})
