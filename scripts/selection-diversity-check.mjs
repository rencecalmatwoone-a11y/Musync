import { selectGameTrack, resetSessionTrackHistory } from '../src/data/tracks.js'

const base = [
  { id: 'spotify:1', providerTrackId: '1', source: 'spotify', popularity: 99, title: 'Song 1', artist: 'Artist A', album: 'Album 1', genre: 'Pop' },
  { id: 'spotify:2', providerTrackId: '2', source: 'spotify', popularity: 98, title: 'Song 2', artist: 'Artist B', album: 'Album 2', genre: 'Pop' },
  { id: 'spotify:3', providerTrackId: '3', source: 'spotify', popularity: 97, title: 'Song 3', artist: 'Artist C', album: 'Album 3', genre: 'Pop' },
  { id: 'spotify:4', providerTrackId: '4', source: 'spotify', popularity: 96, title: 'Song 4', artist: 'Artist D', album: 'Album 4', genre: 'Pop' },
  { id: 'spotify:5', providerTrackId: '5', source: 'spotify', popularity: 95, title: 'Song 5', artist: 'Artist E', album: 'Album 5', genre: 'Pop' },
  { id: 'spotify:6', providerTrackId: '6', source: 'spotify', popularity: 94, title: 'Song 6', artist: 'Artist F', album: 'Album 6', genre: 'Pop' },
  { id: 'spotify:7', providerTrackId: '7', source: 'spotify', popularity: 93, title: 'Song 7', artist: 'Artist A', album: 'Album 7', genre: 'Pop' },
  { id: 'spotify:8', providerTrackId: '8', source: 'spotify', popularity: 92, title: 'Song 8', artist: 'Artist G', album: 'Album 8', genre: 'Pop' },
  { id: 'spotify:9', providerTrackId: '9', source: 'spotify', popularity: 91, title: 'Song 9', artist: 'Artist H', album: 'Album 9', genre: 'Pop' },
  { id: 'spotify:10', providerTrackId: '10', source: 'spotify', popularity: 90, title: 'Song 10', artist: 'Artist I', album: 'Album 10', genre: 'Pop' },
  { id: 'spotify:11', providerTrackId: '11', source: 'spotify', popularity: 89, title: 'Song 11', artist: 'Artist J', album: 'Album 11', genre: 'Pop' },
  { id: 'spotify:12', providerTrackId: '12', source: 'spotify', popularity: 88, title: 'Song 12', artist: 'Artist K', album: 'Album 12', genre: 'Pop' },
  { id: 'spotify:13', providerTrackId: '13', source: 'spotify', popularity: 87, title: 'Song 13', artist: 'Artist L', album: 'Album 3', genre: 'Pop' },
  { id: 'spotify:14', providerTrackId: '14', source: 'spotify', popularity: 86, title: 'Song 14', artist: 'Artist M', album: 'Album 13', genre: 'Pop' },
  { id: 'spotify:15', providerTrackId: '15', source: 'spotify', popularity: 85, title: 'Song 15', artist: 'Artist N', album: 'Album 14', genre: 'Pop' },
  { id: 'spotify:16', providerTrackId: '16', source: 'spotify', popularity: 84, title: 'Song 16', artist: 'Artist O', album: 'Album 15', genre: 'Pop' },
  { id: 'spotify:17', providerTrackId: '17', source: 'spotify', popularity: 83, title: 'Song 17', artist: 'Artist P', album: 'Album 16', genre: 'Pop' },
  { id: 'spotify:18', providerTrackId: '18', source: 'spotify', popularity: 82, title: 'Song 18', artist: 'Artist Q', album: 'Album 17', genre: 'Pop' },
  { id: 'spotify:19', providerTrackId: '19', source: 'spotify', popularity: 81, title: 'Song 19', artist: 'Artist R', album: 'Album 18', genre: 'Pop' },
  { id: 'spotify:20', providerTrackId: '20', source: 'spotify', popularity: 80, title: 'Song 20', artist: 'Artist S', album: 'Album 19', genre: 'Pop' },
  { id: 'spotify:21', providerTrackId: '21', source: 'spotify', popularity: 79, title: 'Song 21', artist: 'Artist T', album: 'Album 20', genre: 'Pop' },
  { id: 'spotify:22', providerTrackId: '22', source: 'spotify', popularity: 78, title: 'Song 22', artist: 'Artist U', album: 'Album 21', genre: 'Pop' },
  { id: 'spotify:23', providerTrackId: '23', source: 'spotify', popularity: 77, title: 'Song 23', artist: 'Artist V', album: 'Album 22', genre: 'Pop' },
  { id: 'spotify:24', providerTrackId: '24', source: 'spotify', popularity: 76, title: 'Song 24', artist: 'Artist W', album: 'Album 23', genre: 'Pop' },
  { id: 'spotify:25', providerTrackId: '25', source: 'spotify', popularity: 75, title: 'Song 25', artist: 'Artist X', album: 'Album 24', genre: 'Pop' },
  { id: 'spotify:26', providerTrackId: '26', source: 'spotify', popularity: 74, title: 'Song 26', artist: 'Artist Y', album: 'Album 25', genre: 'Pop' },
  { id: 'spotify:27', providerTrackId: '27', source: 'spotify', popularity: 73, title: 'Song 27', artist: 'Artist Z', album: 'Album 26', genre: 'Pop' },
  { id: 'spotify:28', providerTrackId: '28', source: 'spotify', popularity: 72, title: 'Song 28', artist: 'Artist AA', album: 'Album 27', genre: 'Pop' },
  { id: 'spotify:29', providerTrackId: '29', source: 'spotify', popularity: 71, title: 'Song 29', artist: 'Artist AB', album: 'Album 28', genre: 'Pop' },
  { id: 'spotify:30', providerTrackId: '30', source: 'spotify', popularity: 70, title: 'Song 30', artist: 'Artist AC', album: 'Album 29', genre: 'Pop' },
  { id: 'spotify:31', providerTrackId: '31', source: 'spotify', popularity: 69, title: 'Song 31', artist: 'Artist AD', album: 'Album 30', genre: 'Pop' },
  { id: 'spotify:32', providerTrackId: '32', source: 'spotify', popularity: 68, title: 'Song 32', artist: 'Artist AE', album: 'Album 31', genre: 'Pop' },
  { id: 'spotify:33', providerTrackId: '33', source: 'spotify', popularity: 67, title: 'Song 33', artist: 'Artist AF', album: 'Album 32', genre: 'Pop' },
  { id: 'spotify:34', providerTrackId: '34', source: 'spotify', popularity: 66, title: 'Song 34', artist: 'Artist AG', album: 'Album 33', genre: 'Pop' },
  { id: 'spotify:35', providerTrackId: '35', source: 'spotify', popularity: 65, title: 'Song 35', artist: 'Artist AH', album: 'Album 34', genre: 'Pop' },
  { id: 'spotify:36', providerTrackId: '36', source: 'spotify', popularity: 64, title: 'Song 36', artist: 'Artist AI', album: 'Album 35', genre: 'Pop' },
  { id: 'spotify:37', providerTrackId: '37', source: 'spotify', popularity: 63, title: 'Song 37', artist: 'Artist AJ', album: 'Album 36', genre: 'Pop' },
  { id: 'spotify:38', providerTrackId: '38', source: 'spotify', popularity: 62, title: 'Song 38', artist: 'Artist AK', album: 'Album 37', genre: 'Pop' },
  { id: 'spotify:39', providerTrackId: '39', source: 'spotify', popularity: 61, title: 'Song 39', artist: 'Artist AL', album: 'Album 38', genre: 'Pop' },
  { id: 'spotify:40', providerTrackId: '40', source: 'spotify', popularity: 60, title: 'Song 40', artist: 'Artist AM', album: 'Album 39', genre: 'Pop' },
]

resetSessionTrackHistory()
const selections = []
let recent = []
for (let i = 0; i < 50; i += 1) {
  const pick = selectGameTrack(base, recent)
  selections.push(pick)
  recent = [...recent, pick.providerTrackId].slice(-30)
}

const ids = selections.map((s) => s.providerTrackId)
const artists = selections.map((s) => s.artist)
const uniqueTrackIds = new Set(ids).size
const uniqueArtists = new Set(artists).size
const duplicateCount = ids.filter((id, index) => ids.indexOf(id) !== index).length
const artistCounts = artists.reduce((acc, artist) => {
  acc[artist] = (acc[artist] || 0) + 1
  return acc
}, {})
const mostFrequentArtist = Object.entries(artistCounts).sort((a, b) => b[1] - a[1])[0]
const topPopular = selections.filter((s) => s.source === 'spotify' && Number(s.popularity) >= 80).length
console.log(JSON.stringify({
  selections: 50,
  uniqueTrackIds,
  duplicateCount,
  uniqueArtists,
  mostFrequentArtist,
  topPopular,
  firstTen: selections.slice(0, 10).map((s) => ({ id: s.providerTrackId, title: s.title, artist: s.artist, provider: s.source, popularity: s.popularity }))
}, null, 2))
