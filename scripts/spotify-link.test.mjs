import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spotifyTrackUrl, matchingSpotifyUrl, spotifySearchUrl } from '../src/music/spotifyLink.js'

const url = 'https://open.spotify.com/track/0123456789abcdefghijkl'
test('Spotify song links use track URLs and never Deezer IDs or URLs', () => {
  assert.equal(spotifyTrackUrl({ provider: 'deezer', providerTrackId: '123', externalUrl: 'https://www.deezer.com/track/123' }), '')
  assert.equal(spotifyTrackUrl({ spotifyUrl: `${url}?si=test` }), url)
  assert.equal(spotifyTrackUrl({ provider: 'spotify', providerTrackId: '0123456789abcdefghijkl' }), url)
})
test('matching requires both the revealed title and artist', () => {
  const song = { title: 'Song', artist: 'Artist' }
  const candidate = { ...song, spotifyUrl: url }
  assert.equal(matchingSpotifyUrl(song, [{ ...candidate, artist: 'Cover Artist' }]), '')
  assert.equal(matchingSpotifyUrl(song, [candidate]), url)
  assert.equal(spotifySearchUrl(song), 'https://open.spotify.com/search/Artist%20Song')
})
