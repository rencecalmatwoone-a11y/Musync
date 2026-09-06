const DEEZER_SEARCH_URL = 'https://api.deezer.com/search/track'
const RESOLUTION_TIMEOUT_MS = 5000
const CACHE_TTL_MS = 30 * 60 * 1000
const MISS_TTL_MS = 5 * 60 * 1000
const FEATURED_VS_ARTISTS = ['Frank Ocean', 'Miguel', 'Daniel Caesar', 'Sonder']
const previewCache = new Map()
const previewRequests = new Map()

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function sameRecording(result, track) {
  const wantedArtist = normalize(track.artist).split(' and ')[0]
  const resultArtist = normalize(result.artistName)
  const wantedTitle = normalize(track.title)
  const resultTitle = normalize(result.trackName)
  return wantedTitle && resultTitle && (resultTitle === wantedTitle || resultTitle.includes(wantedTitle) || wantedTitle.includes(resultTitle))
    && wantedArtist && resultArtist && (resultArtist === wantedArtist || resultArtist.includes(wantedArtist) || wantedArtist.includes(resultArtist))
}

async function searchDeezer(track) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RESOLUTION_TIMEOUT_MS)
  try {
    const query = `${track.artist} ${track.title}`.trim()
    const params = new URLSearchParams({ q: query, limit: '10' })
    const response = await fetch(`${DEEZER_SEARCH_URL}?${params}`, { signal: controller.signal })
    if (!response.ok) return null
    const data = await response.json()
    const match = (data.data || []).find((result) => result.preview && sameRecording({
      artistName: result.artist?.name,
      trackName: result.title,
    }, track))
    if (!match) return null
    return {
      provider: 'deezer',
      previewUrl: match.preview,
      duration: 30000,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function cacheKey(track) {
  return String(track.trackId || track.isrc || `${track.artist}:${track.title}`).trim().toLowerCase()
}

export async function resolveVSAudio(track) {
  const key = cacheKey(track)
  const cached = previewCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  if (previewRequests.has(key)) return previewRequests.get(key)
  const request = (async () => {
    let resolved = null
    try {
      resolved = await searchDeezer(track)
    } catch (error) {
      if (error?.name !== 'AbortError') console.warn('[VS Audio] Deezer lookup failed', error?.message || error)
    }
    // VS AI audio never falls back to Spotify, even when it is configured.
    previewCache.set(key, { value: resolved, expiresAt: Date.now() + (resolved ? CACHE_TTL_MS : MISS_TTL_MS) })
    return resolved
  })()
  previewRequests.set(key, request)
  try { return await request } finally { previewRequests.delete(key) }
}

export function vsAudioDiagnostics() {
  return { entries: previewCache.size, provider: 'deezer' }
}

export async function searchVSAudioTracks(genre = 'Any Genre', limit = 30) {
  const requestedLimit = Math.min(Math.max(Number(limit) || 30, 1), 50)
  const queries = [...FEATURED_VS_ARTISTS, genre && genre !== 'Any Genre' ? String(genre) : 'music']
  const responses = await Promise.allSettled(queries.map(async (query) => {
    const params = new URLSearchParams({ q: query, limit: String(requestedLimit) })
    const response = await fetch(`${DEEZER_SEARCH_URL}?${params}`, { signal: AbortSignal.timeout(RESOLUTION_TIMEOUT_MS) })
    if (!response.ok) return []
    const data = await response.json()
    return data.data || []
  }))
  const unique = [...new Map(responses.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .filter((track) => track.id && track.title && track.artist?.name && track.preview)
    .map((track) => [track.id, track])).values()]
  const featured = FEATURED_VS_ARTISTS.flatMap((artist) => unique.filter((track) => normalize(track.artist?.name) === normalize(artist)).slice(0, 3))
  const ordered = [...new Map([...featured, ...unique].map((track) => [track.id, track])).values()]
  return ordered
    .slice(0, requestedLimit)
    .map((track, index) => {
      // Reuse the exact preview returned by the catalog; no second search.
      previewCache.set(`deezer-${track.id}`, {
        value: { provider: 'deezer', previewUrl: track.preview, duration: 30000 },
        expiresAt: Date.now() + CACHE_TTL_MS,
      })
      return {
        id: `deezer-${track.id}`,
        provider: 'deezer',
        providerTrackId: String(track.id),
        title: track.title,
        artist: track.artist.name,
        album: track.album?.title || '',
        artwork: track.album?.cover_medium || null,
        releaseDate: null,
        genre: genre || 'Any Genre',
        difficulty: 0,
        popularity: 100 - index,
        durationMs: 30000,
        externalUrl: null,
        spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(`${track.artist.name} ${track.title}`)}`,
        external_urls: {},
        source: 'vs-audio-catalog',
        playbackType: 'preview',
        playbackUrl: null,
        spotifyPreviewUrl: null,
      }
    })
}
