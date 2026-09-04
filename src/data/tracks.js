export function secureShuffle(items) {
  const shuffled = [...(items || [])]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled
}

const TRACK_HISTORY_LIMIT = 30
const ARTIST_HISTORY_LIMIT = 12
const ALBUM_HISTORY_LIMIT = 8

const sessionSelectionHistory = {
  recentTrackIds: [],
  recentArtists: [],
  recentAlbums: [],
}

function normalizeTrackKey(track) {
  return String(track?.providerTrackId || track?.id || '').trim()
}

function normalizeArtist(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeAlbum(value) {
  return String(value || '').trim().toLowerCase()
}

export function resetSessionTrackHistory() {
  sessionSelectionHistory.recentTrackIds = []
  sessionSelectionHistory.recentArtists = []
  sessionSelectionHistory.recentAlbums = []
}

export function getSessionTrackHistory() {
  return {
    recentTrackIds: [...sessionSelectionHistory.recentTrackIds],
    recentArtists: [...sessionSelectionHistory.recentArtists],
    recentAlbums: [...sessionSelectionHistory.recentAlbums],
  }
}

export function recordSelectedTrack(track) {
  if (!track) return
  const providerTrackId = normalizeTrackKey(track)
  const artist = normalizeArtist(track.artist)
  const album = normalizeAlbum(track.album)

  if (providerTrackId) {
    sessionSelectionHistory.recentTrackIds = [providerTrackId, ...sessionSelectionHistory.recentTrackIds.filter((id) => id !== providerTrackId)].slice(0, TRACK_HISTORY_LIMIT)
  }
  if (artist) {
    sessionSelectionHistory.recentArtists = [artist, ...sessionSelectionHistory.recentArtists.filter((item) => item !== artist)].slice(0, ARTIST_HISTORY_LIMIT)
  }
  if (album) {
    sessionSelectionHistory.recentAlbums = [album, ...sessionSelectionHistory.recentAlbums.filter((item) => item !== album)].slice(0, ALBUM_HISTORY_LIMIT)
  }
}

function popularityValue(track) {
  if (track?.source === 'spotify' && Number.isFinite(Number(track.popularity))) {
    return Number(track.popularity)
  }
  return null
}

function normalizedPopularity(track, candidates) {
  const values = candidates
    .map((candidate) => popularityValue(candidate))
    .filter((value) => Number.isFinite(value))

  if (!values.length) return 0.5

  const min = Math.min(...values)
  const max = Math.max(...values)
  const raw = popularityValue(track)
  if (!Number.isFinite(raw) || max === min) return 0.5

  return (raw - min) / (max - min)
}

function diversityPenalty(track, recentTrackIds, recentArtists, recentAlbums) {
  const trackKey = normalizeTrackKey(track)
  const trackIndex = recentTrackIds.indexOf(trackKey)
  const recentTrackPenalty = trackIndex === -1 ? 1 : Math.max(0.12, 0.9 / (1 + trackIndex * 0.7))

  const artistKey = normalizeArtist(track.artist)
  const artistIndex = recentArtists.indexOf(artistKey)
  const recentArtistPenalty = artistIndex === -1 ? 1 : Math.max(0.18, 0.75 / (1 + artistIndex * 0.5))

  const albumKey = normalizeAlbum(track.album)
  const albumIndex = recentAlbums.indexOf(albumKey)
  const recentAlbumPenalty = albumIndex === -1 ? 1 : Math.max(0.45, 0.88 / (1 + albumIndex * 0.6))

  return {
    track: recentTrackPenalty,
    artist: recentArtistPenalty,
    album: recentAlbumPenalty,
  }
}

export function selectGameTrack(tracks, recentIds = [], options = {}) {
  const providedRecentIds = Array.isArray(recentIds) ? recentIds : []
  const recentTrackIds = Array.from(new Set([
    ...sessionSelectionHistory.recentTrackIds,
    ...providedRecentIds.map((id) => String(id || '').trim()).filter(Boolean),
  ])).slice(0, TRACK_HISTORY_LIMIT)
  const recentArtists = Array.from(new Set([
    ...sessionSelectionHistory.recentArtists,
    ...(Array.isArray(options.recentArtists) ? options.recentArtists : []).map((artist) => normalizeArtist(artist)),
  ])).slice(0, ARTIST_HISTORY_LIMIT)
  const recentAlbums = Array.from(new Set([
    ...sessionSelectionHistory.recentAlbums,
    ...(Array.isArray(options.recentAlbums) ? options.recentAlbums : []).map((album) => normalizeAlbum(album)),
  ])).slice(0, ALBUM_HISTORY_LIMIT)

  const baseCandidates = Array.isArray(tracks) ? tracks : []
  const candidates = baseCandidates.filter((track) => {
    if (!track) return false
    const key = normalizeTrackKey(track)
    return key ? !recentTrackIds.includes(key) : true
  })

  const eligible = candidates.length ? candidates : baseCandidates
  if (!eligible.length) return null

  const ranked = [...eligible].sort((a, b) => {
    const aValue = popularityValue(a)
    const bValue = popularityValue(b)
    if (aValue !== null && bValue !== null) return bValue - aValue
    if (aValue !== null) return -1
    if (bValue !== null) return 1
    return String(a.title || '').localeCompare(String(b.title || ''))
  })

  const shortlistSize = Math.max(10, Math.ceil(ranked.length * 0.7))
  const pool = ranked.slice(0, shortlistSize)

  const weights = pool.map((track) => {
    const popularity = normalizedPopularity(track, pool)
    const penalty = diversityPenalty(track, recentTrackIds, recentArtists, recentAlbums)
    const score = Math.max(0.08, popularity) * penalty.track * penalty.artist * penalty.album
    return Math.max(0.01, score ** 1.7) * (0.7 + Math.random() * 0.7)
  })

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let cursor = Math.random() * totalWeight
  let selected = pool[pool.length - 1]

  for (let index = 0; index < pool.length; index += 1) {
    cursor -= weights[index]
    if (cursor <= 0) {
      selected = pool[index]
      break
    }
  }

  if (selected && options.recordSelection !== false) {
    recordSelectedTrack(selected)
  }

  return selected
}

export function pickWeightedTrack(tracks, recentIds = []) {
  return selectGameTrack(tracks, recentIds)
}

export function pickWeightedTracks(tracks, count, recentIds = []) {
  const selected = []
  const blocked = new Set((recentIds || []).map((id) => String(id || '').trim()).filter(Boolean))
  while (selected.length < count) {
    const next = selectGameTrack(tracks, [...blocked, ...selected.map((item) => normalizeTrackKey(item))], {
      recentTrackIds: [...blocked],
      recordSelection: false,
    })
    if (!next) break
    selected.push(next)
    blocked.add(normalizeTrackKey(next))
    recordSelectedTrack(next)
  }
  return selected
}

let activePool = []

export function setActivePool(tracks) {
  activePool = Array.isArray(tracks) ? tracks : []
}

export function resetActivePool() {
  activePool = []
}

export function getActivePool() {
  return activePool
}

export function getTrackById(id) {
  return activePool.find((track) => track.id === id)
}

export function pickRoundTracks(correctTrack, count = 4) {
  const others = activePool.filter((track) => track.id !== correctTrack?.id)
  return secureShuffle([correctTrack, ...secureShuffle(others).slice(0, count - 1)]).filter(Boolean)
    .map((track) => ({ id: track.id, title: track.title, artist: track.artist }))
}
