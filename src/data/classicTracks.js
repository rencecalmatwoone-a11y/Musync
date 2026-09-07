import { fetchRandomTrack, getSpotifyAuthStatus, spotifySessionHeaders } from '../spotify/client.js'

const guestTrackCache = new Map()
const guestTrackRequests = new Map()

function normalizeOrigin(musicOrigin) {
  return /^(opm|opm\s*\/\s*local)$/i.test(String(musicOrigin || '')) ? 'OPM' : 'International'
}

function guestDifficultyPool(tracks, difficulty) {
  const sorted = [...tracks].sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0))
  const bands = [0.2, 0.4, 0.6, 0.8, 1]
  const band = bands[Math.min(Math.max(Number(difficulty) || 0, 0), bands.length - 1)]
  const eligible = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * band)))
  for (let index = eligible.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[eligible[index], eligible[swapIndex]] = [eligible[swapIndex], eligible[index]]
  }
  return eligible
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
  if (cached?.expiresAt > Date.now()) return cached.tracks
  if (guestTrackRequests.has(key)) return guestTrackRequests.get(key)
  const request = (async () => {
    const params = new URLSearchParams({
      genre: filters.genre || 'Any Genre',
      musicOrigin: normalizeOrigin(filters.musicOrigin),
      difficulty: String(filters.difficulty || 0),
      limit: String(filters.limit || 1500),
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
    const tracks = Array.isArray(data.tracks) ? data.tracks : []
    guestTrackCache.set(key, { tracks, expiresAt: Date.now() + 5 * 60 * 1000 })
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
  const tracks = await fetchGuestTracks({ ...filters, limit: 1500 })
  const recent = new Set(recentIds)
  if (!recentIds.length) {
    const lastRefreshTrackId = getGuestRefreshTrackId()
    if (lastRefreshTrackId) recent.add(lastRefreshTrackId)
  }
  const preferred = guestDifficultyPool(tracks, filters.difficulty)
  const available = preferred.filter((track) => !recent.has(track.id))
  if (!available.length) {
    available.push(...tracks
      .sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0))
      .filter((track) => !recent.has(track.id)))
  }
  if (!available.length) return null
  const selected = available[Math.floor(Math.random() * available.length)]
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
