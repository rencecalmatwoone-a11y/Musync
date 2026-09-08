export function spotifyTrackUrl(song) {
  for (const value of [song?.spotifyUrl, song?.external_urls?.spotify, song?.externalUrl]) {
    const match = String(value || '').match(/^https:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([a-zA-Z0-9]{22})(?:[?#].*)?$/)
    if (match) return `https://open.spotify.com/track/${match[1]}`
  }
  if (song?.provider === 'spotify' || song?.source === 'spotify') {
    const id = String(song.providerTrackId || song.id || '')
    if (/^[a-zA-Z0-9]{22}$/.test(id)) return `https://open.spotify.com/track/${id}`
  }
  return ''
}

const normalized = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function matchingSpotifyUrl(song, candidates) {
  const match = candidates.find((candidate) => normalized(candidate.title) === normalized(song.title)
    && normalized(candidate.artist) === normalized(song.artist))
  return spotifyTrackUrl(match)
}

export function spotifySearchUrl(song) {
  return `https://open.spotify.com/search/${encodeURIComponent(`${song.artist || ''} ${song.title || ''}`.trim())}`
}
