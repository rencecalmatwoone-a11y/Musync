const POPULAR_TRACKS = [
  ['Dancing Queen', 'ABBA', 1976, 'Pop', 98],
  ['Bohemian Rhapsody', 'Queen', 1975, 'Rock', 100],
  ['Hotel California', 'Eagles', 1976, 'Rock', 97],
  ['Sweet Child o Mine', 'Guns N Roses', 1987, 'Rock', 96],
  ['Billie Jean', 'Michael Jackson', 1982, 'Pop', 100],
  ['Like a Prayer', 'Madonna', 1989, 'Pop', 96],
  ['Livin on a Prayer', 'Bon Jovi', 1986, 'Rock', 97],
  ['Every Breath You Take', 'The Police', 1983, 'Rock', 95],
  ['I Wanna Dance with Somebody', 'Whitney Houston', 1987, 'Pop', 99],
  ['Smells Like Teen Spirit', 'Nirvana', 1991, 'Rock', 98],
  ['Wonderwall', 'Oasis', 1995, 'Rock', 96],
  ['Creep', 'Radiohead', 1992, 'Rock', 94],
  ['No Scrubs', 'TLC', 1999, 'R&B', 94],
  ['...Baby One More Time', 'Britney Spears', 1998, 'Pop', 98],
  ['Genie in a Bottle', 'Christina Aguilera', 1999, 'Pop', 93],
  ['All Star', 'Smash Mouth', 1999, 'Pop', 92],
  ['Bye Bye Bye', 'NSYNC', 2000, 'Pop', 94],
  ['In the End', 'Linkin Park', 2000, 'Rock', 99],
  ['Crazy in Love', 'Beyonce', 2003, 'R&B', 98],
  ['Yeah!', 'Usher', 2004, 'R&B', 97],
  ['Mr. Brightside', 'The Killers', 2003, 'Rock', 99],
  ['Seven Nation Army', 'The White Stripes', 2003, 'Rock', 96],
  ['Hey Ya!', 'Outkast', 2003, 'Hip-Hop', 97],
  ['Hips Dont Lie', 'Shakira', 2006, 'Latin', 96],
  ['Umbrella', 'Rihanna', 2007, 'Pop', 96],
  ['Poker Face', 'Lady Gaga', 2008, 'Pop', 98],
  ['Firework', 'Katy Perry', 2010, 'Pop', 96],
  ['Rolling in the Deep', 'Adele', 2010, 'Pop', 99],
  ['Get Lucky', 'Daft Punk', 2013, 'Electronic', 95],
  ['Uptown Funk', 'Mark Ronson', 2014, 'Pop', 99],
  ['Shape of You', 'Ed Sheeran', 2017, 'Pop', 100],
  ['Despacito', 'Luis Fonsi', 2017, 'Latin', 99],
  ['Havana', 'Camila Cabello', 2017, 'Pop', 96],
  ['Blinding Lights', 'The Weeknd', 2019, 'Pop', 100],
  ['Levitating', 'Dua Lipa', 2020, 'Pop', 98],
  ['As It Was', 'Harry Styles', 2022, 'Pop', 97],
  ['Flowers', 'Miley Cyrus', 2023, 'Pop', 97],
  ['Bad Guy', 'Billie Eilish', 2019, 'Pop', 96],
  ['Old Town Road', 'Lil Nas X', 2019, 'Hip-Hop', 95],
  ['Gods Plan', 'Drake', 2018, 'Hip-Hop', 96],
  ['HUMBLE.', 'Kendrick Lamar', 2017, 'Hip-Hop', 95],
  ['SICKO MODE', 'Travis Scott', 2018, 'Hip-Hop', 94],
  ['Stay', 'The Kid LAROI', 2021, 'Pop', 95],
  ['Anti-Hero', 'Taylor Swift', 2022, 'Pop', 98],
  ['Cruel Summer', 'Taylor Swift', 2019, 'Pop', 97],
  ['Espresso', 'Sabrina Carpenter', 2024, 'Pop', 95],
  ['APT.', 'ROSE and Bruno Mars', 2024, 'Pop', 96],
]

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export const popularTracks = POPULAR_TRACKS.map(([title, artist, year, genre, popularity]) => ({
  id: `popular-${slug(artist)}-${slug(title)}`,
  provider: 'deezer',
  providerTrackId: `popular-${slug(artist)}-${slug(title)}`,
  title,
  artist,
  album: '',
  artwork: null,
  releaseDate: `${year}-01-01`,
  genre,
  difficulty: 0,
  popularity,
  durationMs: 30000,
  externalUrl: null,
  spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(`${artist} ${title}`)}`,
  external_urls: {},
  source: 'popular-fallback',
  playbackType: 'preview',
  playbackUrl: null,
  spotifyPreviewUrl: null,
}))

export function getPopularFallbackTracks({ genre = 'Any Genre', yearFrom, yearTo, limit = 30 } = {}) {
  const filtered = popularTracks.filter((track) => {
    const year = Number(String(track.releaseDate).slice(0, 4))
    const genreMatches = !genre || genre === 'Any Genre' || track.genre === genre
    const yearMatches = (!yearFrom || year >= Number(yearFrom)) && (!yearTo || year <= Number(yearTo))
    return genreMatches && yearMatches
  })
  return filtered.slice(0, Math.max(Number(limit) || 30, 1))
}
