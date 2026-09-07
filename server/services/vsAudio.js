const DEEZER_SEARCH_URL = 'https://api.deezer.com/search/track'
const RESOLUTION_TIMEOUT_MS = 5000
const CACHE_TTL_MS = 30 * 60 * 1000
const MISS_TTL_MS = 5 * 60 * 1000
const FEATURED_VS_ARTISTS = ['Frank Ocean', 'Miguel', 'Daniel Caesar', 'Sonder']
const previewCache = new Map()
const previewRequests = new Map()
const albumMetadataCache = new Map()
const albumMetadataRequests = new Map()
const CLASSIC_ARTISTS = [
  'Daniel Caesar', 'Frank Ocean', 'Sonder', 'Rex Orange County',
  'Tyler, The Creator', 'Kanye West', 'Miguel', 'Brent Faiyaz',
  'Steve Lacy', 'Giveon', 'The Weeknd', 'SZA', 'Drake', 'Joji',
]

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

async function getDeezerAlbumReleaseDate(albumId) {
  const key = String(albumId || '').trim()
  if (!key) return null
  const cached = albumMetadataCache.get(key)
  if (cached?.expiresAt > Date.now()) return cached.releaseDate
  if (albumMetadataRequests.has(key)) return albumMetadataRequests.get(key)
  const request = (async () => {
    try {
      const response = await fetch(`https://api.deezer.com/album/${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(RESOLUTION_TIMEOUT_MS) })
      if (!response.ok) return null
      const data = await response.json()
      return data.release_date || null
    } catch {
      return null
    }
  })().then((releaseDate) => {
    albumMetadataCache.set(key, { releaseDate, expiresAt: Date.now() + CACHE_TTL_MS })
    albumMetadataRequests.delete(key)
    return releaseDate
  }, () => {
    albumMetadataRequests.delete(key)
    return null
  })
  albumMetadataRequests.set(key, request)
  return request
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
  const requestedLimit = Math.min(Math.max(Number(limit) || 30, 1), 1500)
  const deezerSearchLimit = Math.min(requestedLimit, 100)
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

function deezerTrackToClassic(track, genre = 'Any Genre', musicOrigin = 'International', difficulty = 0) {
  const releaseDate = track.album?.release_date || track.release_date || null
  const artwork = track.album?.cover_xl || track.album?.cover_big || track.album?.cover_medium || null
  return {
    id: `deezer-${track.id}`,
    provider: 'deezer',
    providerTrackId: String(track.id),
    title: track.title,
    artist: track.artist.name,
    album: track.album?.title || '',
    artwork,
    albumArt: artwork,
    releaseDate,
    genre,
    musicOrigin,
    difficulty: Number(difficulty) || 0,
    popularity: track.rank || null,
    durationMs: Number(track.duration) > 0 ? Number(track.duration) * 1000 : 30000,
    externalUrl: track.link || null,
    spotifyUrl: null,
    external_urls: track.link ? { deezer: track.link } : {},
    source: 'deezer-classic',
    playbackType: 'preview',
    playbackUrl: track.preview ? `/api/audio-preview?url=${encodeURIComponent(track.preview)}` : null,
  }
}

export async function searchClassicDeezerTracks({ genre = 'Any Genre', musicOrigin = 'International', yearFrom, yearTo, difficulty = 0, limit = 30, query = '', playlistTracks = [] } = {}) {
  const requestedLimit = Math.min(Math.max(Number(limit) || 30, 1), 1500)
  const deezerSearchLimit = Math.min(requestedLimit, 100)
  const playlistQueries = musicOrigin === 'OPM' ? [] : playlistTracks
    .slice(0, 500)
    .map((track) => ({ term: `${track.artists?.map((artist) => artist.name).join(' ') || track.artist || ''} ${track.name || track.title || ''}`.trim(), track }))
    .filter(({ term }) => term)
  const queries = query
    ? [{ term: query }]
    : musicOrigin === 'OPM'
      ? ['OPM Filipino', 'Pinoy music', 'Filipino music'].map((term) => ({ term }))
      : CLASSIC_ARTISTS.map((term) => ({ term }))
        .concat(playlistQueries)
  const responses = await Promise.allSettled(queries.map(async ({ term, track: playlistTrack }) => {
    const params = new URLSearchParams({ q: term, limit: String(deezerSearchLimit) })
    const response = await fetch(`${DEEZER_SEARCH_URL}?${params}`, { signal: AbortSignal.timeout(RESOLUTION_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`Deezer search failed with HTTP ${response.status}.`)
    const data = await response.json()
    return { term, playlistTrack, tracks: data.data || [] }
  }))
  const normalizeArtistName = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const artistResults = responses
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => {
      const { term, playlistTrack, tracks: results } = result.value
      if (query || musicOrigin === 'OPM' || playlistTrack) return [{ term, playlistTrack, tracks: results }]
      const wanted = normalizeArtistName(term)
      const matches = results.filter((track) => {
        const artist = normalizeArtistName(track.artist?.name)
        return artist === wanted || artist.includes(wanted) || wanted.includes(artist)
      })
      return [{ term, tracks: matches.slice(0, 4) }]
    })
  const tracks = [...new Map(artistResults.flatMap(({ tracks: results }) => results)
    .filter((track) => track.id && track.title && track.artist?.name && track.preview)
    .filter((track) => !/\b(top 40|greatest hits|best of|karaoke|instrumental|tribute|cover band)\b/i.test(track.artist.name))
    .map((track) => [track.id, track])).values()]
  await Promise.all(tracks.map(async (track) => {
    if (!track.release_date && !track.album?.release_date) {
      const releaseDate = await getDeezerAlbumReleaseDate(track.album?.id)
      if (releaseDate) track.release_date = releaseDate
    }
  }))
  const filtered = tracks.filter((track) => {
    const releaseYear = Number(String(track.album?.release_date || track.release_date || '').slice(0, 4)) || null
    return (!yearFrom || (releaseYear && releaseYear >= Number(yearFrom)))
      && (!yearTo || (releaseYear && releaseYear <= Number(yearTo)))
  })
  const playlistResults = artistResults
    .filter(({ playlistTrack }) => playlistTrack)
    .flatMap(({ playlistTrack, tracks: results }) => {
      const wantedTitle = normalizeArtistName(playlistTrack.name || playlistTrack.title)
      const wantedArtist = normalizeArtistName(playlistTrack.artists?.[0]?.name || playlistTrack.artist)
      return results.filter((track) => normalizeArtistName(track.title) === wantedTitle
        && normalizeArtistName(track.artist?.name) === wantedArtist).slice(0, 1)
    })
    .filter((track) => filtered.includes(track))
  const balanced = query || musicOrigin === 'OPM'
    ? filtered
    : [...new Map([...CLASSIC_ARTISTS.flatMap((artist) => filtered
      .filter((track) => normalizeArtistName(track.artist?.name).includes(normalizeArtistName(artist)))
      .sort((a, b) => Number(b.rank || 0) - Number(a.rank || 0))
      .slice(0, 3)
      .map((track) => [track.id, track])), ...playlistResults.map((track) => [track.id, track])]).values()]
  return balanced
    .sort((a, b) => Number(b.rank || 0) - Number(a.rank || 0))
    .slice(0, requestedLimit)
    .map((track) => deezerTrackToClassic(track, genre, musicOrigin, difficulty))
}
