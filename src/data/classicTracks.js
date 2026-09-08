import { fetchRandomTrack, getSpotifyAuthStatus, spotifySessionHeaders } from '../spotify/client.js'

const guestTrackCache = new Map()
const guestTrackRequests = new Map()
const guestPlayed = new Map()
const guestPages = new Map()

function catalogPage(key) {
  if (!guestPages.has(key)) {
    let saved
    try { saved = JSON.parse(sessionStorage.getItem(`musync-guest-catalog:v3:${key}`)) } catch {}
    guestPages.set(key, saved?.seed && Number.isInteger(saved.offset) ? saved : { seed: Math.floor(Math.random() * 4294967295) || 1, offset: 0 })
  }
  return guestPages.get(key)
}

function recordingKey(track) {
  return `${track.artist}|${track.title}`.toLowerCase().replace(/[^a-z0-9|]+/g, '')
}

function playedHistory(key) {
  if (!guestPlayed.has(key)) {
    let saved = []
    try { saved = JSON.parse(sessionStorage.getItem(`musync-guest-played:${key}`) || '[]') } catch {}
    guestPlayed.set(key, new Set(Array.isArray(saved) ? saved : []))
  }
  return guestPlayed.get(key)
}

function normalizeOrigin(musicOrigin) {
  return /^(opm|opm\s*\/\s*local)$/i.test(String(musicOrigin || '')) ? 'OPM' : 'International'
}

function getGuestRefreshTrackId() {
  try {
    return typeof sessionStorage === 'undefined' ? '' : sessionStorage.getItem('musync-guest-last-track') || ''
  } catch {
    return ''
  }
}

function setGuestRefreshTrackId(trackId) {
  try {
    if (typeof sessionStorage !== 'undefined' && trackId) sessionStorage.setItem('musync-guest-last-track', trackId)
  } catch {}
}

function guestKey({ genre = 'Any Genre', musicOrigin = 'International', yearFrom, yearTo, difficulty = 0, limit = 1500 } = {}) {
  return JSON.stringify([genre, normalizeOrigin(musicOrigin), yearFrom || '', yearTo || '', difficulty, limit])
}

async function fetchGuestTracks(filters = {}) {
  const key = guestKey(filters)
  const cached = guestTrackCache.get(key)
  const page = catalogPage(key)
  if (cached?.expiresAt > Date.now() && (cached.selections < 4 || page.offset === null)) return cached.tracks
  if (guestTrackRequests.has(key)) return guestTrackRequests.get(key)
  const request = (async () => {
    const params = new URLSearchParams({
      genre: filters.genre || 'Any Genre',
      musicOrigin: normalizeOrigin(filters.musicOrigin),
      difficulty: String(filters.difficulty || 0),
      limit: String(filters.limit || 1500),
      catalogSeed: String(page.seed),
      catalogOffset: String(page.offset || 0),
    })
    if (filters.yearFrom) params.set('yearFrom', String(filters.yearFrom))
    if (filters.yearTo) params.set('yearTo', String(filters.yearTo))
    const response = await fetch(`/api/classic/tracks?${params}`, { headers: spotifySessionHeaders(), signal: AbortSignal.timeout(15000) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(data.error || 'Guest Classic catalog failed.')
      error.code = data.code || 'GUEST_CLASSIC_ERROR'
      throw error
    }
    if (data.provider !== 'deezer') throw new Error('Guest Classic received a non-Deezer provider.')
    const incoming = Array.isArray(data.tracks) ? data.tracks : []
    const tracks = [...new Map([...(cached?.tracks || []), ...incoming].map((track) => [recordingKey(track), track])).values()]
    if (Object.hasOwn(data, 'nextOffset')) {
      page.offset = data.nextOffset
      if (data.catalogSeed) page.seed = data.catalogSeed
      try { sessionStorage.setItem(`musync-guest-catalog:v3:${key}`, JSON.stringify(page)) } catch {}
    }
    guestTrackCache.set(key, { tracks, selections: 0, expiresAt: Date.now() + 5 * 60 * 1000 })
    return tracks
  })().finally(() => guestTrackRequests.delete(key))
  guestTrackRequests.set(key, request)
  return request
}

export async function fetchClassicTrack({ recentIds = [], ...filters } = {}) {
  const status = await getSpotifyAuthStatus()
  if (status.authed) {
    const track = await fetchRandomTrack({ ...filters, recentIds, source: 'classic' })
    if (!track) return null
    const playbackUrl = track.spotifyPreviewUrl || null
    return {
      ...track,
      playbackType: playbackUrl ? 'preview' : 'spotify-sdk',
      playbackUrl,
    }
  }
  const historyKey = guestKey(filters)
  const played = playedHistory(historyKey)
  let tracks
  try {
    tracks = await fetchGuestTracks({ ...filters, limit: 1500 })
    // Empty/unplayable pages must not send us back to the old pool immediately.
    for (let pages = 1; pages < 3 && !tracks.some((track) => !played.has(recordingKey(track)) && !recentIds.includes(track.id)) && catalogPage(historyKey).offset !== null; pages++) {
      guestTrackCache.get(historyKey).selections = 4
      tracks = await fetchGuestTracks({ ...filters, limit: 1500 })
    }
  } catch (error) {
    tracks = guestTrackCache.get(guestKey(filters))?.tracks
    if (!tracks?.length) throw error
  }
  const recent = new Set(recentIds)
  if (!recentIds.length) {
    const lastRefreshTrackId = getGuestRefreshTrackId()
    if (lastRefreshTrackId) recent.add(lastRefreshTrackId)
  }
  let unplayed = tracks.filter((track) => !played.has(recordingKey(track)))
  if (!unplayed.some((track) => !recent.has(track.id))) {
    played.clear()
    unplayed = tracks
  }
  // Every unplayed recording has the same chance, regardless of rank or list order.
  const available = unplayed.filter((track) => !recent.has(track.id))
  if (!available.length) available.push(...unplayed.filter((track) => track.id !== getGuestRefreshTrackId()))
  if (!available.length) available.push(...unplayed)
  if (!available.length) return null
  const selected = available[Math.floor(Math.random() * available.length)]
  const cached = guestTrackCache.get(historyKey)
  if (cached) cached.selections += 1
  played.add(recordingKey(selected))
  try { sessionStorage.setItem(`musync-guest-played:${historyKey}`, JSON.stringify([...played])) } catch {}
  setGuestRefreshTrackId(selected.id)
  return selected
}

export async function searchClassicCatalog(query) {
  if (!String(query || '').trim()) return []
  const status = await getSpotifyAuthStatus()
  const path = status.authed
    ? `/api/catalog/search?q=${encodeURIComponent(query)}&limit=8`
    : `/api/classic/guest-search?q=${encodeURIComponent(query)}&limit=8`
  const response = await fetch(path, { headers: spotifySessionHeaders() })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Classic catalog search failed.')
  return Array.isArray(data.tracks) ? data.tracks : []
}
