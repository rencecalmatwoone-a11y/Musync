// Opt-in catalog check. Uses app credentials, never a user's playback session.
// node --use-system-ca --env-file=.env scripts/spotify-filters.live.mjs
import assert from 'node:assert/strict'
import { searchTracks } from '../server/services/spotify.js'

assert.ok(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET, 'Spotify app credentials required')
const genres = ['Pop', 'Rock', 'Hip-Hop', 'R&B', 'Electronic', 'Latin', 'Country']
const cases = [
  { genre: 'Any Genre' },
  ...genres.map((genre) => ({ genre })),
  ...[1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020].map((yearFrom) => ({ genre: 'Any Genre', yearFrom, yearTo: yearFrom + 9 })),
  ...genres.map((genre) => ({ genre, yearFrom: 1990, yearTo: 1999 })),
]
for (const filters of cases) {
  const page = await searchTracks({ ...filters, clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET, musicOrigin: 'International', limit: 3, includePageInfo: true })
  assert.ok(page.tracks.length, `Empty results: ${JSON.stringify(filters)}`)
  for (const track of page.tracks) {
    assert.equal(track.provider, 'spotify')
    assert.equal(track.musicOrigin, 'International')
    assert.ok(track.providerTrackId && track.title && track.artist)
    if (filters.yearFrom) {
      const year = Number(track.releaseDate.slice(0, 4))
      assert.ok(year >= filters.yearFrom && year <= filters.yearTo)
    }
    if (filters.genre !== 'Any Genre') assert.ok(track.genre !== 'Unknown' && track.genreSource)
  }
  console.log('PASS', JSON.stringify(filters), JSON.stringify(page.tracks.map(({ title, artist, releaseDate, genre, genreSource }) => ({ title, artist, releaseDate, genre, genreSource }))))
}
console.log(`PASS: ${cases.length} live Spotify catalog filter selections (app credentials; account playback not tested)`)
