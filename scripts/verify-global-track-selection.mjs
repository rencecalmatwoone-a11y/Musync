import assert from 'node:assert/strict'
import { selectGameTrack, pickWeightedTracks } from '../src/data/tracks.js'

const tracks = [
  { id: '1', source: 'spotify', providerTrackId: '1', popularity: 99, title: 'A', artist: 'Artist A' },
  { id: '2', source: 'spotify', providerTrackId: '2', popularity: 98, title: 'B', artist: 'Artist B' },
  { id: '3', source: 'spotify', providerTrackId: '3', popularity: 97, title: 'C', artist: 'Artist C' },
  { id: '4', source: 'spotify', providerTrackId: '4', popularity: 10, title: 'D', artist: 'Artist D' },
  { id: '5', source: 'spotify', providerTrackId: '5', popularity: 5, title: 'E', artist: 'Artist E' },
]

assert.equal(typeof selectGameTrack, 'function')
assert.equal(typeof pickWeightedTracks, 'function')

const selected = selectGameTrack(tracks, ['9'])
assert.ok(selected)
assert.ok(tracks.some((track) => track.id === selected.id || track.providerTrackId === selected.providerTrackId))

const sequence = pickWeightedTracks(tracks, 3, ['1'])
assert.equal(sequence.length, 3)
assert.equal(new Set(sequence.map((track) => track.id)).size, 3)

console.log('global track selector verification passed')
